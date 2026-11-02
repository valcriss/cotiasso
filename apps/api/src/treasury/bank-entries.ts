import type { PrismaService } from "../prisma/prisma.service.js";

/**
 * Écritures comptabilisées qui touchent le compte comptable d'un compte financier sans transaction associée (frais saisis
 * directement, écriture à la main…), entre deux dates (`after` exclue, `upTo` incluse). Hors écritures d'ouverture.
 * Source unique : le rapprochement bancaire (avertissement) et le tableau de progression de la reprise la partagent.
 */
export async function countBankEntriesWithoutTransaction(
  prisma: Pick<PrismaService, "$queryRaw">,
  query: { financialAccountId: string; accountId: string; after: Date; upTo: Date },
): Promise<number> {
  const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM "JournalEntry" e
    WHERE e."status" = 'POSTED' AND e."kind" = 'NORMAL' AND e."date" > ${query.after}
      AND NOT EXISTS (SELECT 1 FROM "Journal" j WHERE j."id" = e."journalId" AND j."type" = 'OPENING') AND e."date" <= ${query.upTo}
      AND EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId" = e."id" AND l."accountId" = ${query.accountId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM "TreasuryMatch" m WHERE m."entryId" = e."id" AND m."financialAccountId" = ${query.financialAccountId}::uuid AND m."status" = 'ACTIVE')`;
  return Number(row?.count ?? 0);
}
