/**
 * Texte d'un refus levé par un déclencheur SQL (`RAISE EXCEPTION`). Prisma recopie dans son message un extrait du code
 * appelant : on lit donc d'abord le message du pilote, qui est exactement le texte levé par la base.
 */
export function triggerMessage(error: unknown): string | null {
  const e = error as {
    meta?: { driverAdapterError?: { cause?: { message?: string; originalMessage?: string } } };
    cause?: { message?: string; originalMessage?: string };
  };
  const driver = e?.meta?.driverAdapterError?.cause;
  const message = driver?.originalMessage ?? driver?.message ?? e?.cause?.originalMessage ?? e?.cause?.message;
  return typeof message === "string" && message.length > 0 ? message.replace(/^.*?ERROR:\s*/, "").trim() : null;
}
