import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { Account, Commitment, EntryStatus, Journal, JournalEntry } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { assertProjectAccess } from "./project-access.js";
import { parse } from "./schemas.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Date inexistante.");
const label = z.string().trim().min(1, "Libellé obligatoire.").max(160, "Libellé trop long (160 caractères).");
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (12 chiffres et 2 décimales au plus).")
  .refine((value) => Number(value) > 0, "Le montant doit être positif.");

const createInput = z
  .object({ label, amount, committedOn: isoDate, accountId: z.uuid("Compte invalide.").nullish(), note: z.string().trim().max(1000).default("") })
  .strict();
const patchInput = z
  .object({ label: label.optional(), amount: amount.optional(), committedOn: isoDate.optional(), accountId: z.uuid("Compte invalide.").nullable().optional(), note: z.string().trim().max(1000).optional() })
  .strict();
const settleInput = z.object({ entryId: z.uuid("Écriture invalide.") }).strict();
const cancelInput = z.object({ reason: z.string().trim().min(1, "Indiquez pourquoi l'engagement est annulé.").max(500) }).strict();

/**
 * État vu de l'utilisateur. `REOPENED` : l'engagement avait été soldé, mais son écriture a été contrepassée (la dépense
 * n'existe plus au réalisé) ; il compte de nouveau comme engagé, sinon il disparaîtrait des deux côtés.
 */
export type CommitmentState = "OPEN" | "SETTLED" | "REOPENED" | "CANCELLED";

export interface CommitmentView {
  id: string;
  projectId: string;
  label: string;
  amount: string;
  committedOn: string;
  accountId: string | null;
  accountNumber: string | null;
  accountLabel: string | null;
  note: string;
  state: CommitmentState;
  /** Vrai tant que l'engagement pèse sur le « reste disponible » (ouvert, ou rouvert après contrepassation). */
  engaged: boolean;
  settledEntry: { id: string; number: number | null; date: string; label: string; journalCode: string; status: EntryStatus } | null;
  cancelReason: string | null;
}

export interface EntryCandidate {
  id: string;
  number: number | null;
  date: string;
  label: string;
  journalCode: string;
  /** Dépense ventilée sur le projet par cette écriture. */
  projectAmount: string;
}

type Row = Commitment & {
  account: Pick<Account, "number" | "label"> | null;
  settledEntry: (Pick<JournalEntry, "id" | "number" | "date" | "label" | "status"> & { journal: Pick<Journal, "code"> }) | null;
};

const include = {
  account: { select: { number: true, label: true } },
  settledEntry: { select: { id: true, number: true, date: true, label: true, status: true, journal: { select: { code: true } } } },
} as const;

const day = (date: Date) => date.toISOString().slice(0, 10);
export const commitmentState = (row: Pick<Commitment, "status"> & { settledEntry: { status: EntryStatus } | null }): CommitmentState => {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.status === "OPEN") return "OPEN";
  return row.settledEntry?.status === "REVERSED" ? "REOPENED" : "SETTLED";
};

const view = (row: Row): CommitmentView => {
  const state = commitmentState(row);
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    amount: row.amount.toFixed(2),
    committedOn: day(row.committedOn),
    accountId: row.accountId,
    accountNumber: row.account?.number ?? null,
    accountLabel: row.account?.label ?? null,
    note: row.note,
    state,
    engaged: state === "OPEN" || state === "REOPENED",
    settledEntry: row.settledEntry
      ? {
          id: row.settledEntry.id,
          number: row.settledEntry.number,
          date: day(row.settledEntry.date),
          label: row.settledEntry.label,
          journalCode: row.settledEntry.journal.code,
          status: row.settledEntry.status,
        }
      : null,
    cancelReason: row.cancelReason,
  };
};

/**
 * Engagements d'un projet (ADR 0024, tranche 4.2) : des dépenses promises, pas encore comptabilisées. Ce n'est pas de la
 * comptabilité. Un engagement se solde par une écriture comptabilisée qui pèse sur le projet : il cesse alors de compter
 * comme engagé, c'est le réalisé qui le remplace. La base refuse de solder sans cette dépense (jamais de trou).
 */
@Injectable()
export class CommitmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(projectId: string, access?: ProjectAccess): Promise<CommitmentView[]> {
    assertProjectAccess(projectId, access);
    await this.requireProject(projectId);
    const rows = await this.prisma.commitment.findMany({ where: { projectId }, include, orderBy: [{ committedOn: "desc" }, { createdAt: "desc" }] });
    return rows.map(view);
  }

  async create(projectId: string, body: unknown, actorId: string): Promise<CommitmentView> {
    const input = parse(createInput, body);
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (!project) throw new AccountingNotFoundError("Projet");
    if (project.status === "ARCHIVED") {
      throw new AccountingConflictError("Ce projet est archivé : on n'y enregistre plus d'engagement.");
    }
    const row = await this.guard(() =>
      this.prisma.commitment.create({
        data: { projectId, label: input.label, amount: input.amount, committedOn: new Date(`${input.committedOn}T00:00:00Z`), accountId: input.accountId ?? null, note: input.note, createdBy: actorId },
        include,
      }),
    );
    await this.audit.record({ action: "commitment.created", objectType: "Commitment", objectId: row.id, actorId, details: { projectId } });
    return view(row);
  }

  async update(id: string, body: unknown, actorId: string): Promise<CommitmentView> {
    const patch = parse(patchInput, body);
    const current = await this.require(id);
    if (current.status !== "OPEN") {
      throw new AccountingConflictError("Cet engagement est soldé ou annulé : il ne se modifie plus.");
    }
    const row = await this.guard(() =>
      this.prisma.commitment.update({
        where: { id },
        data: {
          ...(patch.label !== undefined && { label: patch.label }),
          ...(patch.amount !== undefined && { amount: patch.amount }),
          ...(patch.committedOn !== undefined && { committedOn: new Date(`${patch.committedOn}T00:00:00Z`) }),
          ...(patch.accountId !== undefined && { accountId: patch.accountId }),
          ...(patch.note !== undefined && { note: patch.note }),
        },
        include,
      }),
    );
    await this.audit.record({ action: "commitment.updated", objectType: "Commitment", objectId: id, actorId, details: { projectId: current.projectId, fields: Object.keys(patch) } });
    return view(row);
  }

  /** Solde l'engagement par une écriture comptabilisée qui porte une dépense ventilée sur le projet. */
  async settle(id: string, body: unknown, actorId: string): Promise<CommitmentView> {
    const input = parse(settleInput, body);
    const current = await this.require(id);
    if (current.status === "CANCELLED") throw new AccountingConflictError("Cet engagement est annulé : il ne peut plus être soldé.");
    if (commitmentState(current) === "SETTLED") {
      throw new AccountingConflictError("Cet engagement est déjà soldé par une écriture comptabilisée.");
    }
    const row = await this.guard(() =>
      this.prisma.commitment.update({ where: { id }, data: { status: "SETTLED", settledEntryId: input.entryId, settledAt: new Date() }, include }),
    );
    await this.audit.record({
      action: "commitment.settled",
      objectType: "Commitment",
      objectId: id,
      actorId,
      details: { projectId: current.projectId, entryId: input.entryId },
    });
    return view(row);
  }

  /** Annule un engagement abandonné (devis refusé, commande annulée) : il cesse de compter, l'historique reste. */
  async cancel(id: string, body: unknown, actorId: string): Promise<CommitmentView> {
    const input = parse(cancelInput, body);
    const current = await this.require(id);
    if (current.status === "CANCELLED") throw new AccountingConflictError("Cet engagement est déjà annulé.");
    if (commitmentState(current) === "SETTLED") {
      throw new AccountingConflictError(
        "Cet engagement est soldé par une écriture comptabilisée : annulez d'abord cette écriture (contrepassation) si elle est erronée.",
      );
    }
    const row = await this.guard(() =>
      this.prisma.commitment.update({
        where: { id },
        data: { status: "CANCELLED", cancelReason: input.reason, cancelledAt: new Date(), settledEntryId: null, settledAt: null },
        include,
      }),
    );
    await this.audit.record({ action: "commitment.cancelled", objectType: "Commitment", objectId: id, actorId, justification: input.reason, details: { projectId: current.projectId } });
    return view(row);
  }

  /** Écritures comptabilisées qui portent une dépense ventilée sur le projet de l'engagement : les seules qui peuvent le solder. */
  async candidates(id: string): Promise<EntryCandidate[]> {
    const current = await this.require(id);
    const rows = await this.prisma.$queryRaw<{ id: string; number: number | null; date: Date; label: string; code: string; weight: string }[]>`
      SELECT e."id", e."number", e."date", e."label", j."code", commitment_entry_weight(e."id", ${current.projectId}::uuid)::text AS "weight"
      FROM "JournalEntry" e
      JOIN "Journal" j ON j."id" = e."journalId"
      WHERE e."status" = 'POSTED'
        AND e."id" IN (
          SELECT l."entryId" FROM "AnalyticalAllocation" al JOIN "JournalLine" l ON l."id" = al."lineId"
          WHERE al."projectId" = ${current.projectId}::uuid)
        AND commitment_entry_weight(e."id", ${current.projectId}::uuid) > 0
      ORDER BY e."date" DESC, e."number" DESC NULLS LAST
      LIMIT 50`;
    return rows.map((row) => ({ id: row.id, number: row.number, date: day(row.date), label: row.label, journalCode: row.code, projectAmount: row.weight }));
  }

  private async require(id: string): Promise<Row> {
    const row = await this.prisma.commitment.findUnique({ where: { id }, include });
    if (!row) throw new AccountingNotFoundError("Engagement");
    return row;
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Projet");
    }
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      if (/aucune dépense ventilée/i.test(text)) {
        throw new AccountingConflictError(
          "Cette écriture ne contient aucune dépense affectée à ce projet : elle ne peut pas solder cet engagement. Choisissez une écriture qui porte la facture de ce projet.",
        );
      }
      if (/Seule une écriture comptabilisée/i.test(text)) {
        throw new AccountingConflictError("Cette écriture n'est pas comptabilisée. Comptabilisez-la d'abord : un engagement ne se solde que par une dépense enregistrée.");
      }
      if (/classe 6/i.test(text)) throw new AccountingConflictError("Un engagement se rattache à un compte de charges (classe 6).");
      if (/déjà soldé/i.test(text)) throw new AccountingConflictError("Cet engagement est déjà soldé par une écriture comptabilisée.");
      if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Le compte ou l'écriture indiqué n'existe pas.");
      if (/ne se modifie plus|ne change plus|ne s'annule pas|ne revient pas/i.test(text)) {
        throw new AccountingConflictError("Cet engagement ne peut plus être modifié dans cet état.");
      }
      throw error;
    }
  }
}
