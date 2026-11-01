// Les tests sérialisent parfois des lignes Prisma entières (AuditEvent.seq est un BigInt) : on les rend sérialisables.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};
