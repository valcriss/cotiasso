import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { ImportBatch, ImportLine, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { rankCandidates, MATCH_WINDOW_DAYS, type MatchCandidate } from "./ofx/matching.js";
import { OfxError, parseOfx, type OfxStatement } from "./ofx/parser.js";

/** Taille maximale d'un fichier OFX (un relevé d'une année tient largement en dessous). */
export const OFX_MAX_BYTES = 5 * 1024 * 1024;
/** Nombre maximal d'opérations analysées dans un fichier. */
export const OFX_MAX_LINES = 5000;

export const IMPORT_SOURCE = "OFX";

export class ImportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRefusedError";
  }
}

const commitInput = z
  .object({
    decisions: z
      .array(
        z
          .object({
            lineId: z.uuid(),
            action: z.enum(["CREATE", "LINK", "SKIP"]),
            transactionId: z.uuid().optional(),
          })
          .strict(),
      )
      .max(OFX_MAX_LINES)
      .default([]),
    /** Enregistre aussi le solde du fichier comme solde de relevé (preuve datée, jamais un rapprochement). */
    recordStatement: z.boolean().default(false),
  })
  .strict();

export interface ImportLineView {
  id: string;
  position: number;
  status: ImportLine["status"];
  fitId: string | null;
  operationDate: string | null;
  amount: string | null;
  label: string;
  reference: string | null;
  errors: string[];
  candidates: MatchCandidate[];
  matchedTransactionId: string | null;
  decision: ImportLine["decision"];
  transactionId: string | null;
}

export interface ImportSummary {
  total: number;
  new: number;
  duplicate: number;
  probableMatch: number;
  error: number;
  /** Renseigné à la confirmation. */
  result?: { created: number; linked: number; skipped: number };
}

export interface ImportView {
  id: string;
  financialAccountId: string;
  fileName: string;
  format: string;
  status: ImportBatch["status"];
  periodStart: string | null;
  periodEnd: string | null;
  ledgerBalance: string | null;
  ledgerBalanceDate: string | null;
  accountHint: string | null;
  summary: ImportSummary;
  createdAt: string;
  committedAt: string | null;
  lines: ImportLineView[];
}

export interface ImportListItem extends Omit<ImportView, "lines"> {}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);
const amountText = (value: { toFixed(places: number): string } | null) => (value ? value.toFixed(2) : null);

const batchView = (batch: ImportBatch): ImportListItem => ({
  id: batch.id,
  financialAccountId: batch.financialAccountId,
  fileName: batch.fileName,
  format: batch.format,
  status: batch.status,
  periodStart: day(batch.periodStart),
  periodEnd: day(batch.periodEnd),
  ledgerBalance: amountText(batch.ledgerBalance),
  ledgerBalanceDate: day(batch.ledgerBalanceDate),
  accountHint: batch.accountHint,
  summary: batch.summary as unknown as ImportSummary,
  createdAt: batch.createdAt.toISOString(),
  committedAt: batch.committedAt?.toISOString() ?? null,
});

const lineView = (line: ImportLine): ImportLineView => ({
  id: line.id,
  position: line.position,
  status: line.status,
  fitId: line.fitId,
  operationDate: day(line.operationDate),
  amount: amountText(line.amount),
  label: line.label,
  reference: line.reference,
  errors: line.errors as unknown as string[],
  candidates: line.candidates as unknown as MatchCandidate[],
  matchedTransactionId: line.matchedTransactionId,
  decision: line.decision,
  transactionId: line.transactionId,
});

/** Nom de fichier affichable : sans chemin ni caractère de contrôle, borné. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned === "" ? "releve.ofx" : cleaned;
}

/**
 * Import de relevés OFX en deux temps. L'analyse n'écrit aucune transaction : elle conserve les lignes brutes, les classe
 * (nouvelle, doublon, rapprochement proposé, erreur) et attend la décision. La confirmation crée ou rattache, tout ou rien.
 * Les doublons s'identifient par l'identifiant bancaire dans le périmètre du compte ; deux paiements identiques de même
 * jour ne sont jamais fusionnés ; une saisie manuelle semblable n'est proposée qu'en rapprochement, choisi par l'utilisateur.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(accountId: string): Promise<ImportListItem[]> {
    await this.assertAccount(accountId);
    const batches = await this.prisma.importBatch.findMany({ where: { financialAccountId: accountId }, orderBy: { createdAt: "desc" }, take: 100 });
    return batches.map(batchView);
  }

  async get(id: string): Promise<ImportView> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!batch) throw new AccountingNotFoundError("Import");
    return { ...batchView(batch), lines: batch.lines.map(lineView) };
  }

  /** Analyse un fichier OFX sans rien créer côté transactions ; renvoie l'import à confirmer. */
  async analyze(accountId: string, file: { name: string; bytes: Buffer }, actorId: string): Promise<ImportView> {
    const account = await this.prisma.financialAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new AccountingNotFoundError("Compte financier");
    if (account.archivedOn) throw new AccountingConflictError("Le compte financier est archivé : aucun import n'est possible.");

    const fileHash = createHash("sha256").update(file.bytes).digest("hex");
    const already = await this.prisma.importBatch.findFirst({ where: { financialAccountId: accountId, fileHash, status: "COMMITTED" } });
    if (already) {
      throw new AccountingConflictError(
        `Ce fichier a déjà été importé le ${already.committedAt!.toISOString().slice(0, 10)} : il ne peut pas l'être une seconde fois.`,
      );
    }

    let statement: OfxStatement;
    try {
      statement = parseOfx(file.bytes);
    } catch (error) {
      if (error instanceof OfxError) throw new ImportRefusedError(error.message);
      throw error;
    }
    if (statement.lines.length === 0) throw new ImportRefusedError("Le fichier ne contient aucune opération.");
    if (statement.lines.length > OFX_MAX_LINES) {
      throw new ImportRefusedError(`Plus de ${OFX_MAX_LINES} opérations dans le fichier : découpez-le par période.`);
    }

    const valid = statement.lines.filter((line) => line.errors.length === 0);
    const fitIds = valid.map((line) => line.fitId!);
    const existing = new Map(
      (
        await this.prisma.transaction.findMany({
          where: { financialAccountId: accountId, source: IMPORT_SOURCE, externalId: { in: fitIds } },
          select: { id: true, externalId: true },
        })
      ).map((t) => [t.externalId!, t.id]),
    );

    // Saisies manuelles encore sans identifiant bancaire, de même montant et proches en date : candidates au rapprochement.
    const dates = valid.map((line) => line.date!).sort();
    const manual =
      valid.length === 0
        ? []
        : (
            await this.prisma.transaction.findMany({
              where: {
                financialAccountId: accountId,
                externalId: null,
                amount: { in: [...new Set(valid.map((line) => line.amount!))] },
                operationDate: {
                  gte: new Date(Date.parse(`${dates[0]}T00:00:00Z`) - MATCH_WINDOW_DAYS * 86_400_000),
                  lte: new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + MATCH_WINDOW_DAYS * 86_400_000),
                },
              },
              select: { id: true, operationDate: true, amount: true, label: true },
            })
          ).map((t) => ({ id: t.id, operationDate: day(t.operationDate)!, amount: t.amount.toFixed(2), label: t.label }));

    const seen = new Set<string>();
    const lines = statement.lines.map((line) => {
      const errors = [...line.errors];
      if (errors.length === 0) {
        if (seen.has(line.fitId!)) errors.push("Identifiant bancaire répété dans le fichier : une seule des deux lignes peut être importée.");
        else if (line.date! < day(account.openedOn)!) errors.push("L'opération précède l'ouverture du compte financier.");
        seen.add(line.fitId ?? "");
      }
      const duplicateOf = errors.length === 0 ? existing.get(line.fitId!) : undefined;
      const candidates =
        errors.length === 0 && !duplicateOf ? rankCandidates({ date: line.date!, amount: line.amount!, label: line.label }, manual) : [];
      const status = errors.length > 0 ? "ERROR" : duplicateOf ? "DUPLICATE" : candidates.length > 0 ? "PROBABLE_MATCH" : "NEW";
      return { line, errors, duplicateOf, candidates, status } as const;
    });

    const summary: ImportSummary = {
      total: lines.length,
      new: lines.filter((l) => l.status === "NEW").length,
      duplicate: lines.filter((l) => l.status === "DUPLICATE").length,
      probableMatch: lines.filter((l) => l.status === "PROBABLE_MATCH").length,
      error: lines.filter((l) => l.status === "ERROR").length,
    };

    const batch = await this.prisma.importBatch.create({
      data: {
        financialAccountId: accountId,
        fileName: safeFileName(file.name),
        fileHash,
        format: statement.format,
        periodStart: asDate(statement.periodStart),
        periodEnd: asDate(statement.periodEnd),
        ledgerBalance: statement.ledgerBalance?.amount ?? null,
        ledgerBalanceDate: asDate(statement.ledgerBalance?.date),
        accountHint: statement.account.accountId ? statement.account.accountId.slice(-4) : null,
        summary: summary as unknown as Prisma.InputJsonObject,
        createdBy: actorId,
        lines: {
          create: lines.map(({ line, errors, duplicateOf, candidates, status }) => ({
            position: line.index,
            raw: line.raw as Prisma.InputJsonObject,
            fitId: line.fitId,
            operationDate: asDate(line.date),
            amount: line.amount,
            label: line.label,
            reference: line.reference,
            status,
            errors: errors as unknown as Prisma.InputJsonArray,
            candidates: candidates as unknown as Prisma.InputJsonArray,
            matchedTransactionId: duplicateOf ?? null,
          })),
        },
      },
      select: { id: true },
    });
    await this.audit.record({
      action: "import.analyzed",
      objectType: "ImportBatch",
      objectId: batch.id,
      actorId,
      details: { accountId, fileHash: fileHash.slice(0, 12), ...summary },
    });
    return this.get(batch.id);
  }

  async cancel(id: string, actorId: string): Promise<ImportView> {
    const changed = await this.prisma.importBatch.updateMany({ where: { id, status: "ANALYZED" }, data: { status: "CANCELLED" } });
    if (changed.count !== 1) {
      await this.get(id);
      throw new AccountingConflictError("Cet import est déjà confirmé ou annulé.");
    }
    await this.audit.record({ action: "import.cancelled", objectType: "ImportBatch", objectId: id, actorId });
    return this.get(id);
  }

  /**
   * Confirme l'import : crée les transactions nouvelles, rattache l'identifiant bancaire aux saisies manuelles choisies,
   * ignore le reste. Tout ou rien. Une ligne à rapprocher exige une décision explicite (jamais de choix par défaut).
   */
  async commit(id: string, body: unknown, actorId: string): Promise<ImportView> {
    const input = parse(commitInput, body ?? {});

    await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ImportBatch" WHERE id = ${id}::uuid FOR UPDATE`;
        const batch = await tx.importBatch.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
        if (!batch) throw new AccountingNotFoundError("Import");
        if (batch.status !== "ANALYZED") throw new AccountingConflictError("Cet import est déjà confirmé ou annulé.");

        const byId = new Map(batch.lines.map((line) => [line.id, line]));
        const chosen = new Map<string, (typeof input.decisions)[number]>();
        for (const decision of input.decisions) {
          if (!byId.has(decision.lineId)) throw new ImportRefusedError("Une décision désigne une ligne qui n'appartient pas à cet import.");
          if (chosen.has(decision.lineId)) throw new ImportRefusedError("Une ligne ne reçoit qu'une seule décision.");
          chosen.set(decision.lineId, decision);
        }

        const missing = batch.lines.filter((l) => l.status === "PROBABLE_MATCH" && !chosen.has(l.id));
        if (missing.length > 0) {
          throw new ImportRefusedError(
            `${missing.length} ligne(s) ressemblent à une saisie manuelle : choisissez de les rattacher, de les créer quand même ou de les ignorer.`,
          );
        }

        const linkedTargets = new Set<string>();
        const plan = batch.lines.map((line) => {
          const decision = chosen.get(line.id);
          const action = decision?.action ?? (line.status === "NEW" ? "CREATE" : "SKIP");
          if (action === "CREATE" && (line.status === "DUPLICATE" || line.status === "ERROR")) {
            throw new ImportRefusedError(
              line.status === "DUPLICATE"
                ? `La ligne ${line.position} est un doublon : elle ne se crée pas une seconde fois.`
                : `La ligne ${line.position} est en erreur : elle ne peut pas être importée.`,
            );
          }
          if (action === "LINK") {
            if (line.status !== "PROBABLE_MATCH") throw new ImportRefusedError(`La ligne ${line.position} n'a aucune saisie à laquelle se rattacher.`);
            const target = decision?.transactionId;
            const candidates = line.candidates as unknown as MatchCandidate[];
            if (!target || !candidates.some((c) => c.transactionId === target)) {
              throw new ImportRefusedError(`La ligne ${line.position} ne peut se rattacher qu'à l'une des saisies proposées.`);
            }
            if (linkedTargets.has(target)) throw new ImportRefusedError("Une même saisie ne peut se rattacher qu'à une seule ligne.");
            linkedTargets.add(target);
          }
          return { line, action, target: decision?.transactionId };
        });

        let created = 0;
        let linked = 0;
        let skipped = 0;
        for (const { line, action, target } of plan) {
          if (action === "SKIP") {
            await tx.importLine.update({ where: { id: line.id }, data: { decision: "SKIP" } });
            skipped++;
          } else if (action === "CREATE") {
            const transaction = await tx.transaction.create({
              data: {
                financialAccountId: batch.financialAccountId,
                operationDate: line.operationDate!,
                amount: line.amount!,
                label: line.label,
                reference: line.reference,
                origin: "IMPORT",
                source: IMPORT_SOURCE,
                externalId: line.fitId,
                createdBy: actorId,
              },
              select: { id: true },
            });
            await tx.importLine.update({ where: { id: line.id }, data: { decision: "CREATE", transactionId: transaction.id } });
            created++;
          } else {
            await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${target}::uuid FOR UPDATE`;
            const manual = await tx.transaction.findUnique({ where: { id: target! } });
            if (!manual || manual.financialAccountId !== batch.financialAccountId || manual.externalId !== null) {
              throw new AccountingConflictError("Une saisie proposée n'est plus disponible (déjà rattachée ou supprimée). Relancez l'analyse.");
            }
            // La saisie garde ses données ; elle reçoit l'identifiant bancaire, une seule fois.
            await tx.transaction.update({
              where: { id: manual.id },
              data: { source: IMPORT_SOURCE, externalId: line.fitId, version: { increment: 1 } },
            });
            await tx.importLine.update({ where: { id: line.id }, data: { decision: "LINK", transactionId: manual.id } });
            linked++;
          }
        }

        if (input.recordStatement) {
          const end = batch.periodEnd ?? batch.ledgerBalanceDate;
          if (batch.ledgerBalance === null || !end) {
            throw new ImportRefusedError("Le fichier ne fournit pas de solde de relevé à enregistrer.");
          }
          await tx.bankStatement.create({
            data: {
              financialAccountId: batch.financialAccountId,
              periodStart: batch.periodStart ?? end,
              periodEnd: end,
              closingBalance: batch.ledgerBalance,
              createdBy: actorId,
            },
          });
        }

        const summary: ImportSummary = { ...(batch.summary as unknown as ImportSummary), result: { created, linked, skipped } };
        await tx.importBatch.update({
          where: { id },
          data: { status: "COMMITTED", committedBy: actorId, summary: summary as unknown as Prisma.InputJsonObject },
        });
      })
      .catch((error) => this.rethrow(error));

    const view = await this.get(id);
    await this.audit.record({
      action: "import.committed",
      objectType: "ImportBatch",
      objectId: id,
      actorId,
      details: { ...view.summary.result, statement: input.recordStatement },
    });
    return view;
  }

  private async assertAccount(id: string): Promise<void> {
    if (!(await this.prisma.financialAccount.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Compte financier");
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingNotFoundError || error instanceof AccountingConflictError || error instanceof ImportRefusedError) throw error;
    const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
    if (/P2002|Unique constraint|duplicate key/i.test(text)) {
      throw new AccountingConflictError(
        "Une transaction avec le même identifiant bancaire existe déjà (import concurrent ou fichier déjà confirmé). Relancez l'analyse.",
      );
    }
    const line = text.split("\n").find((l) => /précède l'ouverture|archivé|Un import|décision/i.test(l));
    if (line) throw new AccountingConflictError(line.replace(/^.*?ERROR:\s*/, "").trim());
    throw error;
  }
}
