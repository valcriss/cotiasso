import type { Prisma } from "../generated/prisma/client.js";

/** Ce que la liaison fiche de membre ↔ compte de connexion lit et écrit : utilisable seul ou dans la transaction de l'appelant. */
export type AccountLinkDb = Pick<Prisma.TransactionClient, "member" | "user">;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Relie la fiche au compte si elle est encore libre, actuelle et non anonymisée. Faux si quelqu'un l'a relié entre-temps. */
async function attach(db: AccountLinkDb, memberId: string, userId: string): Promise<boolean> {
  try {
    const done = await db.member.updateMany({
      where: { id: memberId, userId: null, status: "ACTIVE", anonymizedAt: null },
      data: { userId, version: { increment: 1 } },
    });
    return done.count === 1;
  } catch (error) {
    // Un compte ne correspond qu'à une fiche (index unique) : un autre appel l'a pris avant nous.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Liaison automatique : une fiche de membre actuel qui porte la même adresse email qu'un compte (majuscules ignorées) est reliée
 * à ce compte, à condition que ni l'un ni l'autre ne soit déjà relié. Renvoie l'identifiant du compte relié, sinon null.
 */
export async function linkMemberToMatchingAccount(db: AccountLinkDb, memberId: string): Promise<string | null> {
  const member = await db.member.findUnique({ where: { id: memberId }, select: { email: true, userId: true, status: true, anonymizedAt: true } });
  if (!member?.email || member.userId || member.status !== "ACTIVE" || member.anonymizedAt) return null;
  const user = await db.user.findFirst({ where: { email: { equals: member.email, mode: "insensitive" } }, select: { id: true, member: { select: { id: true } } } });
  if (!user || user.member) return null;
  return (await attach(db, memberId, user.id)) ? user.id : null;
}

/** L'autre sens : un compte qui vient d'être créé retrouve la fiche de membre actuel qui porte la même adresse. Renvoie la fiche reliée. */
export async function linkAccountToMatchingMember(db: AccountLinkDb, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, member: { select: { id: true } } } });
  if (!user || user.member) return null;
  const member = await db.member.findFirst({
    where: { email: { equals: user.email, mode: "insensitive" }, userId: null, status: "ACTIVE", anonymizedAt: null },
    select: { id: true },
  });
  if (!member) return null;
  return (await attach(db, member.id, userId)) ? member.id : null;
}
