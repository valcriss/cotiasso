import { createHash } from "node:crypto";

/**
 * JSON canonique : clés triées récursivement. PostgreSQL (jsonb) ne conserve pas l'ordre des clés, donc l'empreinte
 * doit être calculée sur une forme indépendante de cet ordre, à l'écriture comme à la vérification.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export interface ChainedFields {
  id: string;
  occurredAt: Date;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  justification: string | null;
  details: unknown;
}

/** Empreinte d'un événement, chaînée à celle du précédent : modifier ou retirer une ligne rompt la chaîne. */
export function computeEventHash(previousHash: string | null, fields: ChainedFields): string {
  const body = canonicalJson([
    fields.id,
    fields.occurredAt.toISOString(),
    fields.actorId,
    fields.action,
    fields.objectType,
    fields.objectId,
    fields.justification,
    fields.details ?? null,
  ]);
  return createHash("sha256").update(`${previousHash ?? "genesis"}|${body}`).digest("hex");
}
