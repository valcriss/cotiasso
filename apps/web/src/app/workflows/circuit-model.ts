import type { CircuitDocument, CircuitNode, Designation } from './workflows-api';

/** Une étape de validation telle qu'on la modifie à l'écran. */
export interface EditableStep {
  id: string;
  label: string;
  approvers: Designation[];
  /** Le demandeur est dispensé de cette étape s'il fait partie des personnes désignées. */
  exempt: boolean;
}

export interface EditableCircuit {
  steps: EditableStep[];
  processing: { id: string; label: string; approvers: Designation[] };
  allowSelfProcessing: boolean;
}

export const MAX_STEPS = 3;

/** Noms connus des personnes, rôles et fonctions, pour afficher qui est désigné. */
export interface Lookups {
  users: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
  offices: ReadonlyMap<string, string>;
}

/** Lit un circuit (graphe) comme une suite d'étapes à modifier. Le graphe de la première version est un enchaînement simple. */
export function toEditable(document: CircuitDocument): EditableCircuit {
  const byId = new Map(document.nodes.map((n) => [n.id, n]));
  const next = new Map(document.edges.map((e) => [e.from, e.to]));
  const start = document.nodes.find((n) => n.type === 'START');
  const ordered: CircuitNode[] = [];
  for (let id = start ? next.get(start.id) : undefined; id !== undefined && ordered.length < 20; id = next.get(id)) {
    const node = byId.get(id);
    if (!node || node.type === 'END') break;
    ordered.push(node);
  }
  const processing = ordered.find((n) => n.type === 'PROCESSING');
  return {
    steps: ordered.filter((n) => n.type === 'APPROVAL').map((n) => ({ id: n.id, label: n.label, approvers: n.approvers.map((a) => ({ ...a })), exempt: n.requesterExempt })),
    processing: { id: processing?.id ?? 'processing', label: processing?.label ?? 'Remboursement', approvers: (processing?.approvers ?? []).map((a) => ({ ...a })) },
    allowSelfProcessing: document.allowSelfProcessing,
  };
}

/** Reconstruit le circuit complet : début, étapes de validation dans l'ordre, traitement, fin. */
export function toDocument(circuit: EditableCircuit): CircuitDocument {
  const nodes: CircuitNode[] = [
    { id: 'start', type: 'START', label: 'Dépôt de la demande', approvers: [], requesterExempt: true },
    ...circuit.steps.map<CircuitNode>((s) => ({ id: s.id, type: 'APPROVAL', label: s.label.trim() || 'Accord', approvers: s.approvers, requesterExempt: s.exempt })),
    { id: circuit.processing.id, type: 'PROCESSING', label: circuit.processing.label.trim() || 'Remboursement', approvers: circuit.processing.approvers, requesterExempt: false },
    { id: 'end', type: 'END', label: 'Remboursée', approvers: [], requesterExempt: true },
  ];
  return { schemaVersion: 1, allowSelfProcessing: circuit.allowSelfProcessing, nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) };
}

/** Identifiant libre pour une nouvelle étape. */
export function newStepId(steps: readonly EditableStep[]): string {
  let n = steps.length + 1;
  while (steps.some((s) => s.id === `step-${n}`) || ['start', 'end'].includes(`step-${n}`)) n++;
  return `step-${n}`;
}

/** « Une personne », « Un rôle » ou « Une fonction » devant le nom, pour que la désignation soit claire. */
export function designationText(designation: Designation, lookups: Lookups): string {
  switch (designation.kind) {
    case 'USER':
      return lookups.users.get(designation.id) ?? 'Personne introuvable';
    case 'ROLE':
      return `Rôle « ${lookups.roles.get(designation.id) ?? 'introuvable'} »`;
    case 'OFFICE':
      return `Fonction « ${lookups.offices.get(designation.id) ?? 'introuvable'} »`;
  }
}

/** Qui décide d'une étape, en une phrase. */
export function whoText(approvers: readonly Designation[], lookups: Lookups): string {
  return approvers.length === 0 ? 'Personne désignée' : approvers.map((a) => designationText(a, lookups)).join(', ');
}
