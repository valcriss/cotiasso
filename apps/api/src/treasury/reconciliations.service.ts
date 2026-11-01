import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Money } from "@cotiasso/accounting-domain";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { ReconciliationStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "./db-refusal.js";
import { transactionInclude, transactionView, type TransactionView } from "./transactions.service.js";

const startInput = z.object({ statementId: z.uuid() }).strict();
const pointInput = z.object({ transactionIds: z.array(z.uuid()).min(1, "Choisissez au moins une transaction.").max(500) }).strict();

export interface ReconciliationCheck {
  code: "GAP" | "UNPOSTED_POINTED" | "ENTRIES_WITHOUT_TRANSACTION";
  level: "BLOCKING" | "WARNING";
  message: string;
}

export interface ReconciliationView {
  id: string;
  financialAccountId: string;
  statementId: string;
  periodEnd: string;
  status: ReconciliationStatus;
  /** Solde rapproché de départ (dernier rapprochement validé, ou solde d'ouverture du compte). */
  openingBalance: string;
  /** Solde de clôture du relevé. */
  closingBalance: string;
  pointedCount: number;
  pointedTotal: string;
  /** Solde rapproché : départ + transactions pointées. */
  pointedBalance: string;
  /** Relevé moins solde rapproché : doit être nul pour valider. */
  gap: string;
  /** Opérations en circulation : transactions datées jusqu'à la fin du relevé et pas (encore) pointées. */
  outstandingCount: number;
  outstandingTotal: string;
  /** Contrôles de validation (seulement pour un rapprochement en cours). */
  checks: ReconciliationCheck[];
  canValidate: boolean;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
}

export interface PointableTransaction {
  transaction: TransactionView;
  pointed: boolean;
}

/** Textes lisibles des refus levés par les déclencheurs SQL du rapprochement. */
const REFUSALS = ["rapprochement", "pointe", "pointée", "relevé", "Seul le dernier", "Abandonnez", "rapprochée"];

function refusal(error: unknown): string | null {
  const raised = triggerMessage(error);
  if (raised && REFUSALS.some((fragment) => raised.includes(fragment))) return raised;
  const text = `${(error as Error)?.message ?? ""}\n${String((error as { cause?: unknown })?.cause ?? "")}`;
  const line = text.split("\n").find((candidate) => REFUSALS.some((fragment) => candidate.includes(fragment)));
  return line ? line.replace(/^.*?ERROR:\s*/, "").trim() : null;
}

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  if (/P2002|Unique constraint|23505|duplicate key/i.test(text)) {
    throw new AccountingConflictError("Un rapprochement est déjà en cours pour ce compte, ou ce relevé est déjà rapproché.");
  }
  if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Relevé ou compte inexistant.");
  const message = refusal(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: { toFixed(places: number): string } | string | null | undefined) => Money.parse(value == null ? "0" : typeof value === "string" ? value : value.toFixed(2));

/**
 * Rapprochement bancaire (ADR 0018) : on pointe les transactions qui figurent sur un relevé jusqu'à ce que le solde
 * rapproché égale le solde du relevé. Validation, figement et annulation sont garantis par les déclencheurs SQL ; ce service
 * calcule les contrôles lisibles, traduit les refus et audite.
 */
@Injectable()
export class ReconciliationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(accountId: string): Promise<ReconciliationView[]> {
    await this.assertAccount(accountId);
    const rows = await this.prisma.reconciliation.findMany({ where: { financialAccountId: accountId }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }] });
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async get(id: string): Promise<ReconciliationView> {
    return this.view(await this.load(id));
  }

  /** Démarre le rapprochement d'un relevé : solde de départ repris du dernier rapprochement validé (ou de l'ouverture du compte). */
  async start(accountId: string, body: unknown, actorId: string): Promise<ReconciliationView> {
    const { statementId } = parse(startInput, body);
    const account = await this.prisma.financialAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new AccountingNotFoundError("Compte financier");
    const statement = await this.prisma.bankStatement.findUnique({ where: { id: statementId } });
    if (!statement || statement.financialAccountId !== accountId) throw new AccountingNotFoundError("Relevé");
    const last = await this.prisma.reconciliation.findFirst({
      where: { financialAccountId: accountId, status: "VALIDATED" },
      orderBy: { periodEnd: "desc" },
    });
    const created = await this.prisma.reconciliation
      .create({
        data: {
          financialAccountId: accountId,
          statementId,
          periodEnd: statement.periodEnd,
          openingBalance: (last ? last.closingBalance : account.openingBalance).toFixed(2),
          closingBalance: statement.closingBalance.toFixed(2),
          createdBy: actorId,
        },
      })
      .catch(rethrow);
    await this.audit.record({ action: "reconciliation.started", objectType: "Reconciliation", objectId: created.id, actorId, details: { accountId, periodEnd: day(created.periodEnd) } });
    return this.view(created);
  }

  /** Transactions à pointer : celles déjà pointées ici et celles datées jusqu'à la fin du relevé, pas encore pointées. */
  async transactions(id: string): Promise<PointableTransaction[]> {
    const rec = await this.load(id);
    const rows = await this.prisma.transaction.findMany({
      where: {
        financialAccountId: rec.financialAccountId,
        OR: [{ reconciliationId: id }, { reconciliationId: null, operationDate: { lte: rec.periodEnd } }],
      },
      include: transactionInclude,
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      take: 1000,
    });
    return rows.map((row) => ({ transaction: transactionView(row), pointed: row.reconciliationId === id }));
  }

  async point(id: string, body: unknown, actorId: string): Promise<ReconciliationView> {
    const { transactionIds } = parse(pointInput, body);
    const rec = await this.loadInProgress(id);
    await this.change(rec.id, rec.financialAccountId, transactionIds, "point", actorId);
    return this.get(id);
  }

  async unpoint(id: string, body: unknown, actorId: string): Promise<ReconciliationView> {
    const { transactionIds } = parse(pointInput, body);
    const rec = await this.loadInProgress(id);
    await this.change(rec.id, rec.financialAccountId, transactionIds, "unpoint", actorId);
    return this.get(id);
  }

  /** Propose de pointer d'un coup les transactions venues du fichier de la banque, datées jusqu'à la fin du relevé. */
  async pointImported(id: string, actorId: string): Promise<ReconciliationView> {
    const rec = await this.loadInProgress(id);
    const rows = await this.prisma.transaction.findMany({
      where: { financialAccountId: rec.financialAccountId, reconciliationId: null, externalId: { not: null }, operationDate: { lte: rec.periodEnd } },
      select: { id: true },
      take: 500,
    });
    if (rows.length > 0) await this.change(rec.id, rec.financialAccountId, rows.map((r) => r.id), "point", actorId);
    return this.get(id);
  }

  async validate(id: string, actorId: string): Promise<ReconciliationView> {
    const rec = await this.loadInProgress(id);
    await this.prisma.reconciliation
      .update({ where: { id }, data: { status: "VALIDATED", validatedAt: new Date(), validatedBy: actorId } })
      .catch(rethrow);
    await this.audit.record({
      action: "reconciliation.validated",
      objectType: "Reconciliation",
      objectId: id,
      actorId,
      details: { accountId: rec.financialAccountId, periodEnd: day(rec.periodEnd), closingBalance: money(rec.closingBalance).toString() },
    });
    return this.get(id);
  }

  /** Abandonne un rapprochement en cours (le pointage est libéré) ou annule le dernier rapprochement validé du compte. */
  async cancel(id: string, actorId: string): Promise<void> {
    const rec = await this.load(id);
    if (rec.status === "IN_PROGRESS") {
      await this.prisma.reconciliation.delete({ where: { id } }).catch(rethrow);
      await this.audit.record({ action: "reconciliation.abandoned", objectType: "Reconciliation", objectId: id, actorId, details: { accountId: rec.financialAccountId } });
      return;
    }
    if (rec.status !== "VALIDATED") throw new AccountingConflictError("Ce rapprochement est déjà annulé.");
    await this.prisma.reconciliation
      .update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: actorId } })
      .catch(rethrow);
    await this.audit.record({
      action: "reconciliation.cancelled",
      objectType: "Reconciliation",
      objectId: id,
      actorId,
      details: { accountId: rec.financialAccountId, periodEnd: day(rec.periodEnd) },
    });
  }

  private async change(id: string, accountId: string, transactionIds: string[], mode: "point" | "unpoint", actorId: string): Promise<void> {
    const unique = [...new Set(transactionIds)];
    const changed = await this.prisma
      .$transaction(async (db) => {
        const result = await db.transaction.updateMany({
          where: { id: { in: unique }, financialAccountId: accountId, reconciliationId: mode === "point" ? null : id },
          data: { reconciliationId: mode === "point" ? id : null },
        });
        if (result.count !== unique.length) {
          // Rien n'est modifié : un pointage partiel serait trompeur.
          throw new AccountingConflictError(
            mode === "point"
              ? "Certaines transactions ne peuvent pas être pointées : elles sont déjà pointées dans un autre rapprochement, ou n'appartiennent pas à ce compte."
              : "Certaines transactions ne sont pas pointées dans ce rapprochement.",
          );
        }
        return result.count;
      })
      .catch(rethrow);
    await this.audit.record({
      action: "reconciliation.points.changed",
      objectType: "Reconciliation",
      objectId: id,
      actorId,
      details: { mode, count: changed },
    });
  }

  private async load(id: string) {
    const row = await this.prisma.reconciliation.findUnique({ where: { id } });
    if (!row) throw new AccountingNotFoundError("Rapprochement");
    return row;
  }

  private async loadInProgress(id: string) {
    const row = await this.load(id);
    if (row.status !== "IN_PROGRESS") throw new AccountingConflictError("Ce rapprochement n'est plus en cours : il ne se modifie plus.");
    return row;
  }

  private async assertAccount(id: string): Promise<void> {
    if (!(await this.prisma.financialAccount.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Compte financier");
    }
  }

  private async view(rec: Awaited<ReturnType<ReconciliationsService["load"]>>): Promise<ReconciliationView> {
    const [pointed] = await this.prisma.$queryRaw<{ count: bigint; total: string | null }[]>`
      SELECT count(*) AS count, sum("amount")::text AS total FROM "Transaction" WHERE "reconciliationId" = ${rec.id}::uuid`;
    const pointedTotal = money(pointed?.total);
    const opening = money(rec.openingBalance);
    const closing = money(rec.closingBalance);
    const balance = opening.add(pointedTotal);
    const gap = closing.subtract(balance);
    const base = {
      id: rec.id,
      financialAccountId: rec.financialAccountId,
      statementId: rec.statementId,
      periodEnd: day(rec.periodEnd),
      status: rec.status,
      openingBalance: opening.toString(),
      closingBalance: closing.toString(),
      pointedCount: Number(pointed?.count ?? 0),
      pointedTotal: pointedTotal.toString(),
      pointedBalance: balance.toString(),
      gap: gap.toString(),
      createdAt: rec.createdAt.toISOString(),
      validatedAt: rec.validatedAt?.toISOString() ?? null,
      cancelledAt: rec.cancelledAt?.toISOString() ?? null,
    };
    if (rec.status !== "IN_PROGRESS") return { ...base, outstandingCount: 0, outstandingTotal: "0.00", checks: [], canValidate: false };

    const [outstanding] = await this.prisma.$queryRaw<{ count: bigint; total: string | null }[]>`
      SELECT count(*) AS count, sum("amount")::text AS total FROM "Transaction"
      WHERE "financialAccountId" = ${rec.financialAccountId}::uuid AND "reconciliationId" IS NULL AND "operationDate" <= ${rec.periodEnd}`;
    const checks = await this.checks(rec, gap);
    return {
      ...base,
      outstandingCount: Number(outstanding?.count ?? 0),
      outstandingTotal: money(outstanding?.total).toString(),
      checks,
      canValidate: checks.every((check) => check.level !== "BLOCKING"),
    };
  }

  private async checks(rec: Awaited<ReturnType<ReconciliationsService["load"]>>, gap: Money): Promise<ReconciliationCheck[]> {
    const checks: ReconciliationCheck[] = [];
    if (!gap.isZero()) {
      checks.push({
        code: "GAP",
        level: "BLOCKING",
        message: `Il reste un écart de ${gap.toString()} € entre le relevé et les transactions pointées : pointez celles qui manquent, ou retirez celles qui ne figurent pas sur le relevé.`,
      });
    }
    const [unposted] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "Transaction" t
      WHERE t."reconciliationId" = ${rec.id}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM "TreasuryMatch" m JOIN "JournalEntry" e ON e."id" = m."entryId"
          WHERE m."transactionId" = t."id" AND m."status" = 'ACTIVE' AND e."status" = 'POSTED')`;
    const unpostedCount = Number(unposted?.count ?? 0);
    if (unpostedCount > 0) {
      checks.push({
        code: "UNPOSTED_POINTED",
        level: "BLOCKING",
        message: `${unpostedCount} transaction(s) pointée(s) ne sont pas encore comptabilisée(s) : comptabilisez-les (bouton « Comptabiliser » de la liste des transactions) avant de valider.`,
      });
    }
    // Écritures comptabilisées sur le compte de banque sans transaction, depuis le dernier rapprochement validé.
    const last = await this.prisma.reconciliation.findFirst({
      where: { financialAccountId: rec.financialAccountId, status: "VALIDATED", periodEnd: { lt: rec.periodEnd } },
      orderBy: { periodEnd: "desc" },
      select: { periodEnd: true },
    });
    const account = await this.prisma.financialAccount.findUniqueOrThrow({ where: { id: rec.financialAccountId }, select: { accountId: true, openedOn: true } });
    const since = last?.periodEnd ?? new Date(account.openedOn.getTime() - 86_400_000);
    const [orphans] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "JournalEntry" e
      WHERE e."status" = 'POSTED' AND e."kind" = 'NORMAL' AND e."date" > ${since} AND e."date" <= ${rec.periodEnd}
        AND EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId" = e."id" AND l."accountId" = ${account.accountId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM "TreasuryMatch" m WHERE m."entryId" = e."id" AND m."financialAccountId" = ${rec.financialAccountId}::uuid AND m."status" = 'ACTIVE')`;
    const orphanCount = Number(orphans?.count ?? 0);
    if (orphanCount > 0) {
      checks.push({
        code: "ENTRIES_WITHOUT_TRANSACTION",
        level: "WARNING",
        message: `${orphanCount} écriture(s) comptabilisée(s) touchent ce compte de banque sans transaction associée (frais saisis directement, écriture à la main…). Vérifiez-les : elles ne bloquent pas la validation.`,
      });
    }
    return checks;
  }
}
