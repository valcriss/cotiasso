import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { rethrowLink } from "./transaction-links.service.js";
import { transactionInclude, transactionView, type TransactionView } from "./transactions.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

const transferInput = z
  .object({
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amount: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant positif attendu, avec au plus deux décimales.")
      .refine((value) => Number(value) > 0, "Le montant doit être supérieur à zéro."),
    date: isoDate,
    label: z.string().trim().min(1).max(200).optional(),
    reference: z.string().trim().max(100).nullish(),
    /** Prépare aussi le brouillon d'écriture banque à banque (par défaut). */
    prepareEntry: z.boolean().default(true),
  })
  .strict();

export interface TransferView {
  id: string;
  out: TransactionView;
  in: TransactionView;
  /** Brouillon d'écriture préparé, le cas échéant. */
  entryId: string | null;
}

/**
 * Virement interne (CA-05) : deux transactions reliées, sans charge ni produit, et par défaut un brouillon d'écriture
 * banque à banque lié aux deux (ADR 0017). Tout est créé dans une seule transaction SQL.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(body: unknown, actorId: string): Promise<TransferView> {
    const input = parse(transferInput, body);
    if (input.fromAccountId === input.toAccountId) {
      throw new AccountingConflictError("Choisissez deux comptes différents : un virement va d'un compte vers un autre.");
    }
    const [from, to] = await Promise.all([
      this.prisma.financialAccount.findUnique({ where: { id: input.fromAccountId } }),
      this.prisma.financialAccount.findUnique({ where: { id: input.toAccountId } }),
    ]);
    if (!from || !to) throw new AccountingNotFoundError("Compte financier");
    const date = new Date(`${input.date}T00:00:00Z`);
    let year: { id: string } | null = null;
    if (input.prepareEntry) {
      year = await this.prisma.fiscalYear.findFirst({ where: { start: { lte: date }, end: { gte: date } }, select: { id: true } });
      if (!year) throw new AccountingConflictError("Aucun exercice ne couvre cette date. Créez l'exercice d'abord.");
    }

    const created = await this.prisma
      .$transaction(async (db) => {
        const make = (accountId: string, amount: string, label: string) =>
          db.transaction.create({
            data: { financialAccountId: accountId, operationDate: date, amount, label, reference: input.reference ?? null, createdBy: actorId },
            select: { id: true },
          });
        const out = await make(from.id, `-${input.amount}`, input.label ?? `Virement interne vers ${to.name}`);
        const into = await make(to.id, input.amount, input.label ?? `Virement interne depuis ${from.name}`);
        const transfer = await db.transfer.create({
          data: { outTransactionId: out.id, inTransactionId: into.id, createdBy: actorId },
          select: { id: true },
        });
        let entryId: string | null = null;
        if (year) {
          const entry = await db.journalEntry.create({
            data: {
              fiscalYearId: year.id,
              journalId: from.journalId,
              date,
              label: input.label ?? `Virement interne ${from.name} → ${to.name}`,
              reference: input.reference ?? null,
              createdBy: actorId,
              lines: {
                create: [
                  { position: 1, accountId: to.accountId, debit: input.amount, credit: "0" },
                  { position: 2, accountId: from.accountId, debit: "0", credit: input.amount },
                ],
              },
            },
            select: { id: true },
          });
          await db.treasuryMatch.create({ data: { transactionId: out.id, entryId: entry.id, financialAccountId: from.id, createdBy: actorId } });
          await db.treasuryMatch.create({ data: { transactionId: into.id, entryId: entry.id, financialAccountId: to.id, createdBy: actorId } });
          entryId = entry.id;
        }
        return { id: transfer.id, outId: out.id, inId: into.id, entryId };
      })
      .catch(rethrowLink);
    await this.audit.record({
      action: "transfer.created",
      objectType: "Transfer",
      objectId: created.id,
      actorId,
      details: { from: from.id, to: to.id, amount: input.amount, entryId: created.entryId },
    });
    return this.build(created.id, created.entryId);
  }

  /** Annule un virement : tant qu'aucune de ses transactions n'est liée à une écriture ni identifiée par la banque. */
  async cancel(id: string, actorId: string): Promise<void> {
    const transfer = await this.prisma.transfer.findUnique({ where: { id } });
    if (!transfer) throw new AccountingNotFoundError("Virement");
    await this.prisma
      .$transaction(async (db) => {
        // Le virement d'abord (ses garde-fous), puis ses deux transactions devenues libres.
        await db.transfer.delete({ where: { id } });
        await db.transaction.delete({ where: { id: transfer.outTransactionId } });
        await db.transaction.delete({ where: { id: transfer.inTransactionId } });
      })
      .catch((error) => {
        if (/relevé|écriture/i.test(String((error as Error)?.message))) {
          throw new AccountingConflictError(
            "Ce virement est lié à une écriture ou à un relevé : il ne s'annule plus. Dissociez le brouillon, ou contrepassez l'écriture comptabilisée.",
          );
        }
        return rethrowLink(error);
      });
    await this.audit.record({ action: "transfer.cancelled", objectType: "Transfer", objectId: id, actorId });
  }

  private async build(id: string, entryId: string | null): Promise<TransferView> {
    const transfer = await this.prisma.transfer.findUniqueOrThrow({
      where: { id },
      include: { outTransaction: { include: transactionInclude }, inTransaction: { include: transactionInclude } },
    });
    return { id, out: transactionView(transfer.outTransaction), in: transactionView(transfer.inTransaction), entryId };
  }
}
