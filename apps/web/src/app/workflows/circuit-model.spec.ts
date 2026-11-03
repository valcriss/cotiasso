import { describe, expect, it } from 'vitest';
import { newStepId, toDocument, toEditable, whoText, type EditableCircuit } from './circuit-model';
import type { CircuitDocument } from './workflows-api';

const ID = '11111111-1111-4111-8111-111111111111';

const document: CircuitDocument = {
  schemaVersion: 1,
  allowSelfProcessing: false,
  nodes: [
    { id: 'start', type: 'START', label: 'Dépôt', approvers: [], requesterExempt: true },
    { id: 'president', type: 'APPROVAL', label: 'Accord du président', approvers: [{ kind: 'OFFICE', id: ID }], requesterExempt: true },
    { id: 'treasurer', type: 'PROCESSING', label: 'Remboursement', approvers: [{ kind: 'ROLE', id: ID }], requesterExempt: false },
    { id: 'end', type: 'END', label: 'Fin', approvers: [], requesterExempt: true },
  ],
  edges: [
    { from: 'start', to: 'president' },
    { from: 'president', to: 'treasurer' },
    { from: 'treasurer', to: 'end' },
  ],
};

describe('circuit-model', () => {
  it('lit un circuit comme une suite d’étapes et le reconstruit à l’identique', () => {
    const editable = toEditable(document);
    expect(editable.steps).toEqual([{ id: 'president', label: 'Accord du président', approvers: [{ kind: 'OFFICE', id: ID }], exempt: true }]);
    expect(editable.processing).toMatchObject({ id: 'treasurer', label: 'Remboursement' });
    const rebuilt = toDocument(editable);
    expect(rebuilt.nodes.map((n) => [n.id, n.type])).toEqual(document.nodes.map((n) => [n.id, n.type]));
    expect(rebuilt.edges).toEqual(document.edges);
  });

  it('ajoute, retire et réordonne des étapes en gardant un enchaînement simple', () => {
    const editable = toEditable(document);
    const added: EditableCircuit = { ...editable, steps: [...editable.steps, { id: newStepId(editable.steps), label: 'Accord du bureau', approvers: [], exempt: true }] };
    const rebuilt = toDocument(added);
    expect(rebuilt.nodes.map((n) => n.id)).toEqual(['start', 'president', 'step-2', 'treasurer', 'end']);
    expect(rebuilt.edges).toHaveLength(4);
    const reversed = toDocument({ ...added, steps: [...added.steps].reverse() });
    expect(reversed.nodes.map((n) => n.id)).toEqual(['start', 'step-2', 'president', 'treasurer', 'end']);
    expect(toDocument({ ...editable, steps: [] }).nodes.map((n) => n.id)).toEqual(['start', 'treasurer', 'end']);
  });

  it('nomme l’étape par défaut et ne réutilise jamais un identifiant', () => {
    expect(toDocument({ steps: [{ id: 'a', label: '  ', approvers: [], exempt: true }], processing: { id: 'p', label: '', approvers: [] }, allowSelfProcessing: false }).nodes.map((n) => n.label)).toEqual(['Dépôt de la demande', 'Accord', 'Remboursement', 'Remboursée']);
    expect(newStepId([{ id: 'step-2', label: '', approvers: [], exempt: true }])).toBe('step-3');
  });

  it('dit qui décide, en distinguant personnes, rôles et fonctions', () => {
    const lookups = { users: new Map([[ID, 'Claire Test']]), roles: new Map([[ID, 'Trésorier']]), offices: new Map([[ID, 'Président']]) };
    expect(whoText([{ kind: 'USER', id: ID }, { kind: 'ROLE', id: ID }, { kind: 'OFFICE', id: ID }], lookups)).toBe('Claire Test, Rôle « Trésorier », Fonction « Président »');
    expect(whoText([], lookups)).toBe('Personne désignée');
    expect(whoText([{ kind: 'OFFICE', id: 'inconnu' }], lookups)).toContain('introuvable');
  });
});
