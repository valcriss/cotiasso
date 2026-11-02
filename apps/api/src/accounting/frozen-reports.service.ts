import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { canonicalJson } from "../audit/audit-chain.js";
import type { FrozenReportKind, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { parse } from "./schemas.js";
import { StatementsService, type BalanceSheet, type IncomeStatement, type TreasuryStatement } from "./statements.service.js";

/** Version du calcul des états figés : à incrémenter si la façon de construire le contenu change (ADR 0031). */
export const FROZEN_CALC_VERSION = 1;

const freezeInput = z
  .object({
    label: z.string().trim().max(120, "Libellé trop long (120 caractères).").optional(),
    reason: z.string().trim().max(300, "Motif trop long (300 caractères).").optional(),
  })
  .strict();
const approveInput = z
  .object({
    meetingDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
      .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "Date inexistante."),
    note: z.string().trim().max(300, "Note trop longue (300 caractères).").optional(),
  })
  .strict();

export interface FrozenReportContent {
  meta: {
    generatedAt: string;
    calcVersion: number;
    provisional: boolean;
    draftEntries: number;
    fiscalYear: { id: string; label: string; start: string; end: string; status: string };
  };
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  treasury: TreasuryStatement;
}

export interface FrozenReportSummary {
  id: string;
  fiscalYearId: string;
  number: number;
  kind: FrozenReportKind;
  provisional: boolean;
  label: string;
  reason: string | null;
  /** Numéro de la version remplacée, absent pour la première. */
  supersedesNumber: number | null;
  /** Vrai tant qu'aucune version plus récente n'a été figée. */
  latest: boolean;
  calcVersion: number;
  createdAt: string;
  sha256: string;
  approval: { meetingDate: string; note: string; approvedAt: string } | null;
}

export interface FrozenReportDetail extends FrozenReportSummary {
  content: FrozenReportContent;
  /** Faux si le contenu enregistré ne correspond plus à son empreinte (altération en base). */
  intact: boolean;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const sha = (content: unknown) => createHash("sha256").update(canonicalJson(content)).digest("hex");

const KIND_LABELS: Record<FrozenReportKind, string> = {
  CLOSING: "Arrêté provisoire (exercice fermé à la saisie)",
  CLOSED: "Comptes de l'exercice clôturé",
  MANUAL: "Rapports figés à la demande",
};

type Row = Prisma.FrozenReportSetGetPayload<{ include: { approval: true; supersedes: { select: { number: true } } } }>;
const include = { approval: true, supersedes: { select: { number: true } } } as const;

/**
 * Rapports figés (ADR 0031) : compte de résultat, bilan et état de trésorerie d'un exercice (avec N−1) enregistrés sans
 * modification possible, à la fermeture et à la clôture de l'exercice ou à la demande. Une correction n'écrase rien : elle
 * produit une nouvelle version numérotée, qui dit laquelle elle remplace et pourquoi. L'empreinte permet de vérifier que le
 * contenu n'a pas été touché en base ; ce n'est pas un archivage à valeur probante (cadrage §11.2).
 */
@Injectable()
export class FrozenReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StatementsService) private readonly statements: StatementsService,
  ) {}

  async list(fiscalYearId: string): Promise<FrozenReportSummary[]> {
    await this.year(fiscalYearId);
    const rows = await this.prisma.frozenReportSet.findMany({ where: { fiscalYearId }, orderBy: { number: "desc" }, include });
    return rows.map((row, index) => this.summary(row, index === 0));
  }

  async get(id: string): Promise<FrozenReportDetail> {
    const row = await this.prisma.frozenReportSet.findUnique({ where: { id }, include });
    if (!row) throw new AccountingNotFoundError("Jeu de rapports");
    const newest = await this.prisma.frozenReportSet.aggregate({ where: { fiscalYearId: row.fiscalYearId }, _max: { number: true } });
    const content = row.payload as unknown as FrozenReportContent;
    return { ...this.summary(row, row.number === newest._max.number), content, intact: sha(content) === row.sha256 };
  }

  /** Figement à la demande (« Figer maintenant »). Une nouvelle version, quand il en existe déjà, demande un motif. */
  async freezeManually(fiscalYearId: string, body: unknown, actorId: string): Promise<FrozenReportSummary> {
    const input = parse(freezeInput, body ?? {});
    const year = await this.year(fiscalYearId);
    const existing = await this.prisma.frozenReportSet.count({ where: { fiscalYearId } });
    if (existing > 0 && (input.reason ?? "").length < 5) {
      throw new AccountingConflictError("Des rapports sont déjà figés pour cet exercice. Pour en figer une nouvelle version, dites en quelques mots pourquoi (5 caractères au moins) : l'ancienne version reste consultable.");
    }
    const label = input.label || (year.status === "CLOSED" ? KIND_LABELS.CLOSED : `Rapports provisoires du ${day(new Date())}`);
    return this.freeze(fiscalYearId, "MANUAL", label, input.reason ?? null, actorId);
  }

  /** Figement automatique à la fermeture (provisoire) ou à la clôture (définitif) : un échec est rendu, jamais avalé. */
  async freezeAutomatically(fiscalYearId: string, kind: "CLOSING" | "CLOSED", actorId: string): Promise<{ number: number; provisional: boolean } | { error: string }> {
    try {
      const created = await this.freeze(fiscalYearId, kind, KIND_LABELS[kind], null, actorId);
      return { number: created.number, provisional: created.provisional };
    } catch (error) {
      await this.audit.record({ action: "frozen-report.failed", objectType: "FiscalYear", objectId: fiscalYearId, actorId, details: { kind } });
      return { error: error instanceof AccountingConflictError ? error.message : "Les rapports n'ont pas pu être figés automatiquement." };
    }
  }

  async approve(id: string, body: unknown, actorId: string): Promise<FrozenReportSummary> {
    const input = parse(approveInput, body);
    const row = await this.prisma.frozenReportSet.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new AccountingNotFoundError("Jeu de rapports");
    await this.prisma.frozenReportApproval
      .create({ data: { setId: id, meetingDate: new Date(`${input.meetingDate}T00:00:00Z`), note: input.note ?? "", approvedBy: actorId } })
      .catch((error) => this.rethrow(error));
    await this.audit.record({ action: "frozen-report.approved", objectType: "FrozenReportSet", objectId: id, actorId, details: { meetingDate: input.meetingDate } });
    return (await this.get(id)) satisfies FrozenReportSummary;
  }

  private async freeze(fiscalYearId: string, kind: FrozenReportKind, label: string, reason: string | null, actorId: string): Promise<FrozenReportSummary> {
    const year = await this.year(fiscalYearId);
    const params = { fiscalYearId };
    const [incomeStatement, balanceSheet, treasury] = await Promise.all([
      this.statements.incomeStatement(params),
      this.statements.balanceSheet(params),
      this.statements.treasuryStatement(params),
    ]);
    const content: FrozenReportContent = {
      meta: {
        generatedAt: new Date().toISOString(),
        calcVersion: FROZEN_CALC_VERSION,
        provisional: year.status !== "CLOSED",
        draftEntries: incomeStatement.draftEntries,
        fiscalYear: { id: year.id, label: year.label, start: day(year.start), end: day(year.end), status: year.status },
      },
      incomeStatement,
      balanceSheet,
      treasury,
    };

    const created = await this.prisma
      .$transaction(async (db) => {
        const last = await db.frozenReportSet.findFirst({ where: { fiscalYearId }, orderBy: { number: "desc" }, select: { id: true, number: true } });
        return db.frozenReportSet.create({
          data: {
            fiscalYearId,
            number: (last?.number ?? 0) + 1,
            kind,
            provisional: year.status !== "CLOSED",
            label,
            reason,
            supersedesId: last?.id ?? null,
            calcVersion: FROZEN_CALC_VERSION,
            payload: content as unknown as Prisma.InputJsonObject,
            sha256: sha(content),
            createdBy: actorId,
          },
          include,
        });
      })
      .catch((error) => this.rethrow(error));
    await this.audit.record({
      action: "frozen-report.created",
      objectType: "FrozenReportSet",
      objectId: created.id,
      actorId,
      details: { number: created.number, kind, provisional: created.provisional },
    });
    return this.summary(created, true);
  }

  private summary(row: Row, latest: boolean): FrozenReportSummary {
    return {
      id: row.id,
      fiscalYearId: row.fiscalYearId,
      number: row.number,
      kind: row.kind,
      provisional: row.provisional,
      label: row.label,
      reason: row.reason,
      supersedesNumber: row.supersedes?.number ?? null,
      latest,
      calcVersion: row.calcVersion,
      createdAt: row.createdAt.toISOString(),
      sha256: row.sha256,
      approval: row.approval ? { meetingDate: day(row.approval.meetingDate), note: row.approval.note, approvedAt: row.approval.approvedAt.toISOString() } : null,
    };
  }

  private async year(id: string) {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!year) throw new AccountingNotFoundError("Exercice");
    return year;
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    const refusal = triggerMessage(error);
    if (refusal) throw new AccountingConflictError(refusal);
    if (/P2002|Unique constraint|23505|duplicate key/i.test(`${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`)) {
      throw new AccountingConflictError("Ces rapports ont déjà été approuvés, ou une autre version vient d'être figée. Actualisez.");
    }
    throw error;
  }
}
