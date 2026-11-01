import { checkEntryForPosting, Money, type PostingError } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { EntryKind, EntryStatus, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import {
  entryDraftInput,
  entryDraftUpdate,
  entryListQuery,
  entryReverseInput,
  type EntryDraftInput,
} from "./entries.schemas.js";
import { parse } from "./schemas.js";

export interface EntryLineView {
  position: number;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  debit: string;
  credit: string;
  label: string | null;
  /** Ventilation par projet (lignes de charge ou de produit) ; vide si la ligne n'est pas ventilée. */
  allocations: { projectId: string; projectCode: string; amount: string }[];
}

export interface EntryView {
  id: string;
  fiscalYearId: string;
  journalId: string;
  journalCode: string;
  date: string;
  label: string;
  reference: string | null;
  kind: EntryKind;
  status: EntryStatus;
  /** Numéro attribué à la comptabilisation, par journal et par exercice ; absent d'un brouillon. */
  number: number | null;
  version: number;
  postedAt: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  totalDebit: string;
  totalCredit: string;
  lines: EntryLineView[];
}

/** Échec de comptabilisation attendu et expliqué (déséquilibre, exercice fermé…) : rien n'est écrit. */
export class EntryPostingRefusedError extends Error {
  constructor(readonly errors: { code: string; message: string; lineIndex?: number }[]) {
    super("L'écriture ne peut pas être comptabilisée.");
    this.name = "EntryPostingRefusedError";
  }
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const money = (value: { toFixed(places: number): string }) => value.toFixed(2);

const withLines = {
  journal: { select: { code: true } },
  reversedBy: { select: { id: true } },
  lines: {
    orderBy: { position: "asc" as const },
    include: {
      account: { select: { number: true, label: true } },
      allocations: { include: { project: { select: { code: true } } }, orderBy: { project: { code: "asc" as const } } },
    },
  },
} satisfies Prisma.JournalEntryInclude;

type LoadedEntry = Prisma.JournalEntryGetPayload<{ include: typeof withLines }>;

function view(entry: LoadedEntry): EntryView {
  const total = (side: "debit" | "credit") =>
    entry.lines.reduce((sum, l) => sum.add(Money.parse(money(l[side]))), Money.zero()).toString();
  return {
    id: entry.id,
    fiscalYearId: entry.fiscalYearId,
    journalId: entry.journalId,
    journalCode: entry.journal.code,
    date: day(entry.date),
    label: entry.label,
    reference: entry.reference,
    kind: entry.kind,
    status: entry.status,
    number: entry.number,
    version: entry.version,
    postedAt: entry.postedAt?.toISOString() ?? null,
    reversalOfId: entry.reversalOfId,
    reversedById: entry.reversedBy?.id ?? null,
    totalDebit: total("debit"),
    totalCredit: total("credit"),
    lines: entry.lines.map((l) => ({
      position: l.position,
      accountId: l.accountId,
      accountNumber: l.account.number,
      accountLabel: l.account.label,
      debit: money(l.debit),
      credit: money(l.credit),
      label: l.label,
      allocations: l.allocations.map((a) => ({ projectId: a.projectId, projectCode: a.project.code, amount: money(a.amount) })),
    })),
  };
}

const REFUSAL_FRAGMENTS = [
  "Écriture déséquilibrée",
  "L'exercice n'est pas ouvert",
  "hors de l'exercice",
  "au moins deux lignes",
  "est désactivé",
  "peut l'être",
  "immuable",
  "ne se supprime pas",
  "exercice clôturé",
  "Projet obligatoire",
  "ventilation par projet",
  "ventilation analytique",
  "projet archivé",
  "Seules les lignes de charge",
];

/** Texte lisible d'un refus levé par un déclencheur SQL (RAISE EXCEPTION), ou `null` si l'erreur est autre. */
function databaseRefusal(error: unknown): string | null {
  const text = `${(error as Error)?.message ?? ""}\n${String((error as { cause?: unknown })?.cause ?? "")}`;
  const line = text.split("\n").find((candidate) => REFUSAL_FRAGMENTS.some((fragment) => candidate.includes(fragment)));
  return line ? line.replace(/^.*?ERROR:\s*/, "").trim() : null;
}

@Injectable()
export class EntriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(query: unknown): Promise<{ entries: EntryView[]; next: string | null }> {
    const filters = parse(entryListQuery, query);
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        ...(filters.fiscalYearId && { fiscalYearId: filters.fiscalYearId }),
        ...(filters.journalId && { journalId: filters.journalId }),
        ...(filters.status && { status: filters.status }),
      },
      include: withLines,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.after && { cursor: { id: filters.after }, skip: 1 }),
    });
    const page = rows.slice(0, filters.limit);
    return { entries: page.map(view), next: rows.length > filters.limit ? page[page.length - 1]!.id : null };
  }

  async get(id: string): Promise<EntryView> {
    return view(await this.load(id));
  }

  async createDraft(body: unknown, actorId: string): Promise<EntryView> {
    const input = parse(entryDraftInput, body);
    const fiscalYearId = await this.fiscalYearFor(input.date);
    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          fiscalYearId,
          journalId: input.journalId,
          date: asDate(input.date),
          label: input.label,
          reference: input.reference ?? null,
          createdBy: actorId,
          lines: { create: this.lineData(input).map((line) => ({ ...line, allocations: { create: line.allocations } })) },
        },
        select: { id: true },
      });
      return entry.id;
    }).catch((error) => this.rethrow(error));
    await this.audit.record({ action: "entry.created", objectType: "JournalEntry", objectId: created, actorId });
    return this.get(created);
  }

  async updateDraft(id: string, body: unknown, actorId: string): Promise<EntryView> {
    const input = parse(entryDraftUpdate, body);
    const fiscalYearId = await this.fiscalYearFor(input.date);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.journalEntry.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new AccountingNotFoundError("Écriture");
      if (current.status !== "DRAFT") throw new AccountingConflictError("Seul un brouillon se modifie : contrepassez l'écriture.");

      // Contrôle de version optimiste : la mise à jour ne passe que si personne n'a modifié le brouillon entre-temps.
      const updated = await tx.journalEntry.updateMany({
        where: { id, version: input.version, status: "DRAFT" },
        data: {
          fiscalYearId,
          journalId: input.journalId,
          date: asDate(input.date),
          label: input.label,
          reference: input.reference ?? null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new AccountingConflictError("Ce brouillon a été modifié entre-temps. Rechargez-le avant de l'enregistrer.");
      }
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      for (const line of this.lineData(input)) {
        await tx.journalLine.create({ data: { ...line, entryId: id, allocations: { create: line.allocations } } });
      }
    }).catch((error) => this.rethrow(error));
    await this.audit.record({ action: "entry.updated", objectType: "JournalEntry", objectId: id, actorId });
    return this.get(id);
  }

  async deleteDraft(id: string, actorId: string): Promise<void> {
    const current = await this.prisma.journalEntry.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new AccountingNotFoundError("Écriture");
    if (current.status !== "DRAFT") throw new AccountingConflictError("Une écriture comptabilisée ne se supprime pas : contrepassez-la.");
    await this.prisma.journalEntry.deleteMany({ where: { id, status: "DRAFT" } }).catch((error) => this.rethrow(error));
    await this.audit.record({ action: "entry.deleted", objectType: "JournalEntry", objectId: id, actorId });
  }

  /**
   * Comptabilise un brouillon : contrôles lisibles ici, puis passage à « comptabilisée » dans une transaction où le
   * déclencheur SQL revérifie tout (équilibre, exercice ouvert sous verrou, comptes actifs) et attribue le numéro.
   * Un refus n'écrit rien (CA-03) ; la concurrence avec la clôture est tranchée par le verrou d'exercice (CA-04).
   */
  async post(id: string, actorId: string): Promise<EntryView> {
    const entry = await this.load(id);
    if (entry.status !== "DRAFT") throw new AccountingConflictError("Cette écriture est déjà comptabilisée.");

    const year = await this.prisma.fiscalYear.findUniqueOrThrow({ where: { id: entry.fiscalYearId } });
    const check = checkEntryForPosting(
      {
        date: day(entry.date),
        lines: entry.lines.map((l) => ({
          accountNumber: l.account.number,
          debit: money(l.debit),
          credit: money(l.credit),
          ...(l.allocations[0] && { projectId: l.allocations[0].projectId }),
        })),
      },
      {
        fiscalYear: { start: day(year.start), end: day(year.end), status: year.status.toLowerCase() as "open" | "closing" | "closed" },
        projectRequiredOnIncomeAndExpense: await this.projectRequired(),
      },
    );
    if (!check.ok) throw new EntryPostingRefusedError(check.errors satisfies PostingError[]);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.journalEntry.update({ where: { id }, data: { status: "POSTED", postedBy: actorId } });
      });
    } catch (error) {
      const refusal = databaseRefusal(error);
      if (refusal) throw new EntryPostingRefusedError([{ code: "REFUSED", message: refusal }]);
      throw error;
    }
    const posted = await this.get(id);
    await this.audit.record({
      action: "entry.posted",
      objectType: "JournalEntry",
      objectId: id,
      actorId,
      details: { journal: posted.journalCode, number: posted.number, fiscalYearId: posted.fiscalYearId },
    });
    return posted;
  }

  /** Contrepasse une écriture comptabilisée : nouvelle écriture inversée, reliée à l'originale, comptabilisée d'un bloc. */
  async reverse(id: string, body: unknown, actorId: string): Promise<EntryView> {
    const input = parse(entryReverseInput, body);
    const original = await this.load(id);
    if (original.status !== "POSTED") {
      throw new AccountingConflictError(
        original.status === "REVERSED" ? "Cette écriture est déjà contrepassée." : "Seule une écriture comptabilisée se contrepasse.",
      );
    }
    if (original.kind === "REVERSAL") throw new AccountingConflictError("Une contrepassation ne se contrepasse pas : saisissez une nouvelle écriture.");

    const date = input.date ?? day(original.date);
    const fiscalYearId = await this.fiscalYearFor(date);

    let reversalId: string;
    try {
      reversalId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.journalEntry.create({
          data: {
            fiscalYearId,
            journalId: original.journalId,
            date: asDate(date),
            label: input.label ?? `Contrepassation : ${original.label}`,
            reference: original.reference,
            kind: "REVERSAL",
            reversalOfId: original.id,
            createdBy: actorId,
            lines: {
              create: original.lines.map((l) => ({
                position: l.position,
                accountId: l.accountId,
                debit: l.credit,
                credit: l.debit,
                label: l.label,
                allocations: { create: l.allocations.map((a) => ({ projectId: a.projectId, amount: a.amount })) },
              })),
            },
          },
          select: { id: true },
        });
        await tx.journalEntry.update({ where: { id: created.id }, data: { status: "POSTED", postedBy: actorId } });
        await tx.journalEntry.update({ where: { id: original.id }, data: { status: "REVERSED" } });
        return created.id;
      });
    } catch (error) {
      const refusal = databaseRefusal(error);
      if (refusal) throw new EntryPostingRefusedError([{ code: "REFUSED", message: refusal }]);
      if (/P2002|Unique constraint|reversalOfId/i.test(String((error as Error)?.message))) {
        throw new AccountingConflictError("Cette écriture est déjà contrepassée.");
      }
      throw error;
    }
    const reversal = await this.get(reversalId);
    await this.audit.record({
      action: "entry.reversed",
      objectType: "JournalEntry",
      objectId: id,
      actorId,
      details: { reversalId, journal: reversal.journalCode, number: reversal.number },
    });
    return reversal;
  }

  private async load(id: string): Promise<LoadedEntry> {
    const entry = await this.prisma.journalEntry.findUnique({ where: { id }, include: withLines });
    if (!entry) throw new AccountingNotFoundError("Écriture");
    return entry;
  }

  private async fiscalYearFor(date: string): Promise<string> {
    const year = await this.prisma.fiscalYear.findFirst({
      where: { start: { lte: asDate(date) }, end: { gte: asDate(date) } },
      select: { id: true },
    });
    if (!year) throw new AccountingConflictError("Aucun exercice ne couvre cette date. Créez l'exercice d'abord.");
    return year.id;
  }

  /** Obligation de projet en vigueur : la même fonction que celle qui la fait respecter à la comptabilisation. */
  private async projectRequired(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ required: boolean }[]>`SELECT accounting_project_required() AS required`;
    return rows[0]?.required ?? true;
  }

  private lineData(input: EntryDraftInput) {
    return input.lines.map((line, index) => ({
      position: index + 1,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      label: line.label ?? null,
      allocations: (line.allocations ?? []).map((a) => ({ projectId: a.projectId, amount: a.amount })),
    }));
  }

  /** Références inexistantes ou refus de la base traduits en erreurs lisibles. */
  private rethrow(error: unknown): never {
    if (error instanceof AccountingValidationError || error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    const text = String((error as Error)?.message ?? "");
    if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Journal ou compte inexistant.");
    const refusal = databaseRefusal(error);
    if (refusal) throw new AccountingConflictError(refusal);
    throw error;
  }
}
