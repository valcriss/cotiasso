import { z } from "zod";

/**
 * Description déclarative d'un circuit de validation (ADR 0035). C'est un graphe (nœuds et liens), pas une liste,
 * pour accueillir plus tard conditions et branches sans migrer les circuits existants. Aucun script : chaque type de
 * nœud est connu du code. Ce fichier ne dépend ni de Nest ni de Prisma.
 */

export const CIRCUIT_SCHEMA_VERSION = 1;

/** Types de nœud disponibles. */
export const NODE_TYPES = ["START", "APPROVAL", "PROCESSING", "END"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Types réservés pour les évolutions prévues : explicitement indisponibles, jamais acceptés à moitié. */
export const RESERVED_NODE_TYPES = ["CONDITION", "PARALLEL"] as const;

export const MAX_APPROVAL_STEPS = 3;
export const MAX_DESIGNATIONS = 20;

/** Qui peut décider d'une étape : une personne, un rôle, ou une fonction du bureau (catalogue). */
export const DESIGNATION_KINDS = ["USER", "ROLE", "OFFICE"] as const;
export type DesignationKind = (typeof DESIGNATION_KINDS)[number];

const designationSchema = z.object({ kind: z.enum(DESIGNATION_KINDS), id: z.uuid() }).strict();
export interface Designation {
  kind: DesignationKind;
  id: string;
}

const nodeSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    type: z.string(),
    label: z.string().trim().min(1, "Donnez un nom à l'étape.").max(80),
    /** Personnes habilitées à décider (étapes de validation et de traitement). */
    approvers: z.array(designationSchema).max(MAX_DESIGNATIONS, `Vingt désignations au plus par étape.`).default([]),
    /** Le demandeur est dispensé de cette étape s'il fait partie des personnes désignées. */
    requesterExempt: z.boolean().default(true),
  })
  .strict();

const edgeSchema = z.object({ from: z.string().trim().min(1).max(40), to: z.string().trim().min(1).max(40) }).strict();

export const circuitSchema = z
  .object({
    schemaVersion: z.literal(CIRCUIT_SCHEMA_VERSION),
    /** Faux par défaut : personne ne traite sa propre demande (ADR 0035). */
    allowSelfProcessing: z.boolean().default(false),
    nodes: z.array(nodeSchema).min(1).max(20),
    edges: z.array(edgeSchema).max(40),
  })
  .strict();

export interface CircuitNode {
  id: string;
  type: NodeType;
  label: string;
  approvers: Designation[];
  requesterExempt: boolean;
}

export interface Circuit {
  schemaVersion: typeof CIRCUIT_SCHEMA_VERSION;
  allowSelfProcessing: boolean;
  nodes: CircuitNode[];
  edges: { from: string; to: string }[];
}

export interface CircuitIssue {
  /** Étape concernée, quand il y en a une. */
  nodeId?: string;
  code: string;
  message: string;
}

/**
 * Lit un document de circuit. Renvoie les problèmes de forme (jamais d'exception) ; un type de nœud réservé est
 * refusé avec son motif.
 */
export function parseCircuit(raw: unknown): { circuit: Circuit | null; issues: CircuitIssue[] } {
  const parsed = circuitSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      circuit: null,
      issues: parsed.error.issues.map((issue) => ({ code: "INVALID_DOCUMENT", message: `${issue.path.join(".") || "circuit"} : ${issue.message}` })),
    };
  }
  const issues: CircuitIssue[] = [];
  const nodes: CircuitNode[] = [];
  for (const node of parsed.data.nodes) {
    if ((RESERVED_NODE_TYPES as readonly string[]).includes(node.type)) {
      issues.push({
        nodeId: node.id,
        code: "NODE_TYPE_UNAVAILABLE",
        message: `Le type d'étape « ${node.type} » n'est pas disponible : les conditions et les étapes en parallèle ne sont pas encore prises en charge.`,
      });
    } else if (!(NODE_TYPES as readonly string[]).includes(node.type)) {
      issues.push({ nodeId: node.id, code: "NODE_TYPE_UNKNOWN", message: `Type d'étape inconnu : « ${node.type} ».` });
    } else {
      nodes.push({ ...node, type: node.type as NodeType });
    }
  }
  if (issues.length > 0) return { circuit: null, issues };
  return { circuit: { ...parsed.data, nodes }, issues: [] };
}

/**
 * Chemin de la première version : un seul enchaînement de START à END, sans branche. `null` si le graphe n'est pas
 * un enchaînement simple (les causes sont détaillées par `circuitIssues`).
 */
export function linearPath(circuit: Circuit): string[] | null {
  const starts = circuit.nodes.filter((n) => n.type === "START");
  if (starts.length !== 1) return null;
  const next = new Map<string, string>();
  for (const edge of circuit.edges) {
    if (next.has(edge.from)) return null;
    next.set(edge.from, edge.to);
  }
  const ids = new Set(circuit.nodes.map((n) => n.id));
  const path = [starts[0]!.id];
  const seen = new Set(path);
  for (let current = next.get(path[0]!); current !== undefined; current = next.get(current)) {
    if (!ids.has(current) || seen.has(current)) return null;
    path.push(current);
    seen.add(current);
  }
  return path.length === circuit.nodes.length ? path : null;
}

/**
 * Règles de la première version (ADR 0035) : un début, une fin, une étape de traitement obligatoire et unique en
 * dernier, de 0 à 3 étapes de validation. `complete` (à l'activation) exige en plus des personnes désignées à
 * chaque étape ; un brouillon peut être incomplet.
 */
export function circuitIssues(circuit: Circuit, options: { complete: boolean }): CircuitIssue[] {
  const issues: CircuitIssue[] = [];
  const count = (type: NodeType) => circuit.nodes.filter((n) => n.type === type).length;
  const ids = circuit.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) issues.push({ code: "DUPLICATE_NODE", message: "Deux étapes portent le même identifiant." });
  if (count("START") !== 1) issues.push({ code: "START_COUNT", message: "Un circuit a exactement un début." });
  if (count("END") !== 1) issues.push({ code: "END_COUNT", message: "Un circuit a exactement une fin." });
  if (count("PROCESSING") !== 1) {
    issues.push({ code: "PROCESSING_COUNT", message: "Un circuit a exactement une étape de traitement (rembourser et enregistrer)." });
  }
  if (count("APPROVAL") > MAX_APPROVAL_STEPS) {
    issues.push({ code: "TOO_MANY_APPROVALS", message: `Un circuit compte ${MAX_APPROVAL_STEPS} étapes de validation au plus.` });
  }
  const known = new Set(ids);
  for (const edge of circuit.edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) issues.push({ code: "UNKNOWN_EDGE", message: "Un lien part de ou arrive à une étape inexistante." });
  }
  if (issues.length === 0) {
    const path = linearPath(circuit);
    if (!path) {
      issues.push({ code: "NOT_LINEAR", message: "Les étapes doivent s'enchaîner l'une après l'autre, sans branche ni étape isolée." });
    } else {
      const types = path.map((id) => circuit.nodes.find((n) => n.id === id)!.type);
      if (types[0] !== "START" || types.at(-1) !== "END" || types.at(-2) !== "PROCESSING" || types.slice(1, -2).some((t) => t !== "APPROVAL")) {
        issues.push({ code: "WRONG_ORDER", message: "L'ordre doit être : début, étapes de validation, puis traitement, puis fin." });
      }
    }
  }
  if (options.complete) {
    for (const node of circuit.nodes) {
      if ((node.type === "APPROVAL" || node.type === "PROCESSING") && node.approvers.length === 0) {
        issues.push({ nodeId: node.id, code: "NO_APPROVERS", message: `Désignez au moins une personne, un rôle ou une fonction pour l'étape « ${node.label} ».` });
      }
    }
  }
  return issues;
}
