import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { ReimbursementAvailability } from '../reimbursements/reimbursement-availability.service';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { CircuitsPage } from './circuits.page';
import type { CircuitDocument, VersionView } from './workflows-api';

const PRESIDENT = '11111111-1111-4111-8111-111111111111';
const TESS = '22222222-2222-4222-8222-222222222222';
const TREASURER_ROLE = '33333333-3333-4333-8333-333333333333';

const doc = (withPresident = true, approvers = [{ kind: 'OFFICE' as const, id: PRESIDENT }]): CircuitDocument => {
  const nodes: CircuitDocument['nodes'] = [
    { id: 'start', type: 'START', label: 'Dépôt', approvers: [], requesterExempt: true },
    ...(withPresident ? [{ id: 'president', type: 'APPROVAL' as const, label: 'Accord du président', approvers, requesterExempt: true }] : []),
    { id: 'treasurer', type: 'PROCESSING', label: 'Remboursement', approvers: [{ kind: 'ROLE', id: TREASURER_ROLE }], requesterExempt: false },
    { id: 'end', type: 'END', label: 'Fin', approvers: [], requesterExempt: true },
  ];
  return { schemaVersion: 1, allowSelfProcessing: false, nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) };
};

const view = (overrides: Partial<VersionView> = {}): VersionView => ({
  id: 'v1',
  number: 1,
  status: 'ACTIVE',
  createdAt: '2026-11-01T10:00:00.000Z',
  activatedAt: '2026-11-02T10:00:00.000Z',
  retiredAt: null,
  subjectType: 'reimbursement',
  label: 'Demande de remboursement',
  revision: 1,
  document: doc(),
  issues: [],
  warnings: [],
  ...overrides,
});

const summary = (active: VersionView | null, draft: VersionView | null) => [
  { subjectType: 'reimbursement', label: 'Demande de remboursement', active: active && { ...active }, draft: draft && { ...draft } },
];

describe('CircuitsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<CircuitsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  /** Répond à tout ce que la page demande (les requêtes apparaissent au fil des attentes), jusqu'à ce que plus rien n'attende. */
  const answer = async (state: { active: VersionView | null; draft: VersionView | null }, versions: object[] = []) => {
    for (let round = 0; round < 8; round++) {
      await settle();
      const pending: TestRequest[] = controller.match(() => true);
      if (pending.length === 0) return;
      for (const request of pending) {
        const url = request.request.url;
        if (url === '/api/users') request.flush([{ id: TESS, displayName: 'Tess Test', email: 't@t.fr', status: 'ACTIVE', roleAssignments: [] }]);
        else if (url === '/api/roles') request.flush([{ id: TREASURER_ROLE, key: 'treasurer', name: 'Trésorier', description: '', permissions: [], requiresMfa: false, version: 1 }]);
        else if (url === '/api/office-roles') request.flush([{ id: PRESIDENT, name: 'Président', active: true, mandateCount: 1 }]);
        else if (url === '/api/reimbursements/status') request.flush({ enabled: true, ready: true, canRequest: true, reason: null });
        else if (url === '/api/workflows') request.flush(summary(state.active, state.draft));
        else if (url === '/api/workflows/reimbursement') request.flush({ subjectType: 'reimbursement', label: 'Demande de remboursement', versions });
        else if (state.active && url === `/api/workflow-versions/${state.active.id}`) request.flush(state.active);
        else if (state.draft && url === `/api/workflow-versions/${state.draft.id}`) request.flush(state.draft);
        else throw new Error(`Requête inattendue : ${request.request.method} ${url}`);
      }
    }
  };

  const create = async (permissions: string[], state: { active: VersionView | null; draft: VersionView | null }, versions: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [CircuitsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CircuitsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await answer(state, versions);
  };
  const click = async (label: string) => {
    const found = Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent!.trim().includes(label));
    expect(found, label).toBeTruthy();
    found!.click();
    await settle();
  };

  afterEach(() => {
    ui?.closeAll();
    controller?.verify();
  });

  it('dit qu’aucune demande n’est possible sans circuit et propose de préparer le circuit de départ', async () => {
    await create(['workflows:view', 'workflows:admin'], { active: null, draft: null });
    expect(root.textContent).toContain('Aucun circuit n’est en vigueur');
    expect(root.textContent).toContain('ne peuvent pas encore faire de demande');
    const state = { active: null as VersionView | null, draft: view({ id: 'v1', status: 'DRAFT', activatedAt: null }) as VersionView | null };
    await click('Préparer le circuit de départ');
    const request = controller.expectOne('/api/workflows/reimbursement/draft');
    expect(request.request.body).toEqual({ source: 'STARTER' });
    request.flush(state.draft, { status: 201, statusText: 'Created' });
    await answer(state as { active: VersionView | null; draft: VersionView });
    expect(root.textContent).toContain('Brouillon (version 1)');
    expect(ui.snackbar).toContain('Brouillon préparé');
  });

  it('montre le circuit en vigueur avec qui décide à chaque étape, et signale une étape sans personne', async () => {
    const warning = { nodeId: 'president', code: 'NOBODY_ELIGIBLE', message: 'Aujourd’hui, personne ne peut décider de l’étape « Accord du président ».' };
    await create(['workflows:view'], { active: view({ warnings: [warning] }), draft: null });
    const text = root.textContent!;
    expect(text).toContain('En vigueur');
    expect(text).toContain('version 1');
    expect(root.querySelector('app-circuit-diagram')!.textContent).toContain('Fonction « Président »');
    expect(root.querySelector('app-circuit-diagram')!.textContent).toContain('Rôle « Trésorier »');
    expect(text).toContain('personne ne peut décider');
    // En lecture seule : aucun bouton de modification.
    expect(root.querySelectorAll('button')).toHaveLength(0);
  });

  it('bloque la mise en vigueur d’un brouillon incomplet et dit quoi régler', async () => {
    const draft = view({ id: 'v2', number: 2, status: 'DRAFT', activatedAt: null, document: doc(true, []), issues: [{ nodeId: 'president', code: 'NO_APPROVERS', message: 'Désignez au moins une personne, un rôle ou une fonction pour l’étape « Accord du président ».' }] });
    await create(['workflows:view', 'workflows:admin'], { active: view(), draft });
    expect(root.textContent).toContain('À régler avant de pouvoir le mettre en vigueur');
    expect(root.textContent).toContain('Désignez au moins une personne');
    const activate = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes('Mettre en vigueur'))!;
    expect(activate.disabled).toBe(true);
    // Préparer une nouvelle version n'est pas proposé tant qu'un brouillon existe.
    expect(root.textContent).not.toContain('Préparer une nouvelle version');
  });

  it('modifie le brouillon : ajoute une étape, la nomme et enregistre le circuit complet', async () => {
    const draft = view({ id: 'v2', number: 2, status: 'DRAFT', activatedAt: null });
    const state = { active: view(), draft };
    await create(['workflows:view', 'workflows:admin'], state);
    await click('Modifier le brouillon');
    expect(ui.title).toContain('version 2');
    expect(ui.text).toContain('Étape 1 : accord');
    await ui.click('Ajouter une étape d’accord');
    expect(ui.text).toContain('Étape 2 : accord');
    // L'aperçu se met à jour pendant la saisie.
    expect(ui.dialog!.querySelector('app-circuit-diagram')!.textContent).toContain('Accord n° 2');
    await ui.click('Monter l’étape 2');
    expect(ui.dialog!.querySelector('app-circuit-diagram')!.textContent!.indexOf('Accord n° 2')).toBeLessThan(ui.dialog!.querySelector('app-circuit-diagram')!.textContent!.indexOf('Accord du président'));
    await ui.submit();
    const save = controller.expectOne('/api/workflow-versions/v2');
    expect(save.request.method).toBe('PUT');
    const body = save.request.body as { revision: number; document: CircuitDocument };
    expect(body.revision).toBe(1);
    expect(body.document.nodes.map((n) => n.id)).toEqual(['start', 'step-2', 'president', 'treasurer', 'end']);
    expect(body.document.edges).toHaveLength(4);
    save.flush(draft);
    await answer({ active: state.active, draft });
    expect(ui.snackbar).toContain('Brouillon enregistré');
  });

  it('met en vigueur après avoir expliqué la conséquence, puis affiche le nouveau circuit', async () => {
    const draft = view({ id: 'v2', number: 2, status: 'DRAFT', activatedAt: null });
    await create(['workflows:view', 'workflows:admin'], { active: view(), draft });
    await click('Mettre en vigueur');
    expect(ui.title).toContain('Mettre en vigueur la version 2');
    expect(ui.text).toContain('Les demandes déjà déposées gardent le circuit qu’elles suivent');
    await ui.click('Mettre en vigueur');
    const request = controller.expectOne('/api/workflow-versions/v2/activate');
    request.flush({ ...draft, status: 'ACTIVE' });
    await answer({ active: view({ id: 'v2', number: 2 }), draft: null });
    // Le menu des remboursements est mis à jour tout de suite (la requête d'état est répondue par `answer`).
    expect(TestBed.inject(ReimbursementAvailability).ready()).toBe(true);
    expect(ui.snackbar).toContain('Circuit mis en vigueur');
    expect(root.textContent).toContain('version 2');
  });
});
