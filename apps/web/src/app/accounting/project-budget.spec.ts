import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ProjectBudget } from './project-budget';

const project = {
  id: 'p1',
  code: 'FESTIVAL',
  name: 'Festival',
  description: '',
  status: 'ACTIVE',
  permanent: false,
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  managerId: null,
};
const summary = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  projectId: 'p1',
  number: 1,
  label: 'Budget voté',
  status: 'APPROVED',
  approvedAt: '2026-05-10T09:00:00.000Z',
  createdAt: '2026-05-01T09:00:00.000Z',
  lineCount: 2,
  charges: '620.50',
  products: '900.00',
  result: '279.50',
  ...over,
});
const lines = [
  { id: 'l1', kind: 'CHARGE', label: 'Location de salle', accountId: null, periodStart: '2026-06-01', periodEnd: '2026-06-30', amount: '620.50' },
  { id: 'l2', kind: 'PRODUCT', label: 'Billetterie', accountId: null, periodStart: '2026-06-01', periodEnd: '2026-06-30', amount: '900.00' },
];
const detail = (over: Record<string, unknown> = {}) => ({ ...summary(over), lines });

describe('ProjectBudget', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ProjectBudget>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Monte le panneau ; `versions` est ce que renvoie la liste, `shown` le détail de la version affichée d'office. */
  const create = async (permissions: string[], versions: unknown[], shown?: unknown) => {
    await TestBed.configureTestingModule({
      imports: [ProjectBudget],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectBudget);
    fixture.componentRef.setInput('project', project);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/projects/p1/budgets').flush(versions);
    await settle();
    if (shown) {
      const target = (shown as { id: string }).id;
      controller.expectOne(`/api/budgets/${target}`).flush(shown);
      await settle();
    }
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };
  const buttons = () => Array.from(root.querySelectorAll('button')).map((b) => b.textContent!.trim());

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('explique à quoi sert un budget et quoi faire en premier quand il n’y en a pas', async () => {
    await create(['projects:view', 'budgets:update'], []);
    expect(root.textContent).toContain("elle ne crée aucune écriture comptable");
    expect(root.textContent).toContain('Cliquez sur « Préparer un budget »');
    expect(buttons().some((b) => b.includes('Préparer un budget'))).toBe(true);
  });

  it('en lecture seule, ne propose aucune action', async () => {
    await create(['projects:view'], []);
    expect(root.textContent).toContain("Aucun budget n'a encore été préparé");
    expect(buttons().filter((b) => b)).toEqual([]);
  });

  it('affiche les versions, leurs totaux et les lignes de la version en vigueur, sans action de modification', async () => {
    await create(['projects:view', 'budgets:update', 'budgets:approve'], [summary()], detail());
    const text = root.textContent!;
    expect(text).toContain('Budget voté');
    expect(text).toContain('En vigueur');
    expect(text).toContain('620,50');
    expect(text).toContain('900,00');
    expect(text).toContain('279,50');
    expect(text).toContain('Location de salle');
    expect(text).toContain('Dépense prévue (charge)');
    expect(text).toContain('Il ne se modifie plus');
    expect(buttons().some((b) => b.includes('Modifier les lignes') || b.includes('Approuver'))).toBe(false);
  });

  it('prépare un budget en reprenant la dernière version, puis l’affiche', async () => {
    await create(['projects:view', 'budgets:update'], [summary()], detail());
    await click('Préparer un budget');
    expect(ui.title).toBe('Préparer un budget');
    expect(ui.text).toContain('Les lignes de cette version sont recopiées');
    await ui.type('input[formcontrolname="label"]', 'Budget révisé');
    await ui.submit();
    const request = controller.expectOne('/api/projects/p1/budgets');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ label: 'Budget révisé', fromBudgetId: 'b1' });
    request.flush(detail({ id: 'b2', number: 2, label: 'Budget révisé', status: 'DRAFT', approvedAt: null }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/projects/p1/budgets').flush([summary({ id: 'b2', number: 2, label: 'Budget révisé', status: 'DRAFT', approvedAt: null }), summary({ status: 'SUPERSEDED' })]);
    await settle();
    controller.expectOne('/api/budgets/b2').flush(detail({ id: 'b2', number: 2, label: 'Budget révisé', status: 'DRAFT', approvedAt: null }));
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Budget n° 2 préparé');
    expect(root.textContent).toContain('En préparation');
    // Un seul brouillon à la fois : le bouton est grisé et le texte dit pourquoi.
    expect((Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes('Préparer un budget')) as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain('Un budget est déjà en préparation');
  });

  it('affiche l’erreur du serveur dans la boîte sans la fermer', async () => {
    await create(['projects:view', 'budgets:update'], []);
    await click('Préparer un budget');
    await ui.type('input[formcontrolname="label"]', 'Budget');
    await ui.submit();
    controller.expectOne('/api/projects/p1/budgets').flush({ message: 'Un budget est déjà en préparation pour ce projet.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('déjà en préparation');
  });

  it('modifie les lignes d’un brouillon : totaux en direct, montants à la française envoyés en décimales exactes', async () => {
    const draft = detail({ status: 'DRAFT', approvedAt: null, lineCount: 0, charges: '0.00', products: '0.00', result: '0.00' });
    draft.lines = [];
    await create(['projects:view', 'budgets:update'], [summary({ status: 'DRAFT', approvedAt: null, lineCount: 0, charges: '0.00', products: '0.00', result: '0.00' })], draft);
    expect(root.textContent).toContain('Ce budget est vide');
    await click('Modifier les lignes');
    controller.expectOne('/api/accounts').flush([{ id: 'a6', number: '606', label: 'Achats', active: true, reportLine: null }]);
    await settle();
    expect(ui.text).toContain('Aucune ligne pour l\'instant');

    await ui.click('Ajouter une dépense prévue');
    await ui.type('.line input[formcontrolname="label"]', 'Affiche');
    await ui.type('.line input[formcontrolname="amount"]', '120,5');
    await ui.click('Ajouter une recette prévue');
    const lineFields = Array.from(ui.dialog!.querySelectorAll<HTMLInputElement>('.line'))[1]!;
    const set = async (selector: string, value: string) => {
      const input = lineFields.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    };
    await set('input[formcontrolname="label"]', 'Billetterie');
    await set('input[formcontrolname="amount"]', '1 000');
    expect(ui.text).toContain('Dépenses prévues : 120,50 €');
    expect(ui.text).toContain('Recettes prévues : 1 000,00 €');
    expect(ui.text).toContain('Résultat prévu : 879,50 €');

    await ui.submit();
    const request = controller.expectOne('/api/budgets/b1');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.lines).toEqual([
      { kind: 'CHARGE', label: 'Affiche', accountId: null, periodStart: '2026-06-01', periodEnd: '2026-06-30', amount: '120.50' },
      { kind: 'PRODUCT', label: 'Billetterie', accountId: null, periodStart: '2026-06-01', periodEnd: '2026-06-30', amount: '1000.00' },
    ]);
    request.flush(draft);
    await settle();
    controller.expectOne('/api/projects/p1/budgets').flush([]);
    await settle();
  });

  it('refuse d’envoyer une ligne sans montant valide et dit quoi corriger', async () => {
    const draft = detail({ status: 'DRAFT', approvedAt: null });
    await create(['projects:view', 'budgets:update'], [summary({ status: 'DRAFT', approvedAt: null })], draft);
    await click('Modifier les lignes');
    controller.expectOne('/api/accounts').flush([]);
    await settle();
    await ui.type('.line input[formcontrolname="amount"]', 'douze');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    expect(ui.text).toContain('Saisissez un montant positif');
  });

  it('demande confirmation avant d’approuver, en disant les conséquences', async () => {
    const draft = detail({ id: 'b2', number: 2, status: 'DRAFT', approvedAt: null });
    await create(['projects:view', 'budgets:approve'], [summary({ id: 'b2', number: 2, status: 'DRAFT', approvedAt: null }), summary({ number: 1 })], draft);
    expect(buttons().some((b) => b.includes('Modifier les lignes'))).toBe(false);
    await click('Approuver');
    expect(ui.title).toBe('Approuver le budget n° 2 ?');
    expect(ui.text).toContain('ne pourra plus être modifié');
    expect(ui.text).toContain('Le budget n° 1 sera conservé comme « remplacé »');
    expect(ui.text).toContain("Aucune écriture comptable n'est créée");
    await ui.click('Approuver');
    const request = controller.expectOne('/api/budgets/b2/approve');
    expect(request.request.method).toBe('POST');
    request.flush(detail({ id: 'b2', number: 2 }));
    await settle();
    controller.expectOne('/api/projects/p1/budgets').flush([summary({ id: 'b2', number: 2 }), summary({ status: 'SUPERSEDED' })]);
    await settle();
    controller.expectOne('/api/budgets/b2').flush(detail({ id: 'b2', number: 2 }));
    await settle();
    expect(ui.snackbar).toContain('approuvé');
  });

  it('supprime un brouillon seulement après confirmation', async () => {
    const draft = detail({ status: 'DRAFT', approvedAt: null });
    await create(['projects:view', 'budgets:update'], [summary({ status: 'DRAFT', approvedAt: null })], draft);
    await click('Supprimer ce brouillon');
    expect(ui.title).toBe('Supprimer ce brouillon ?');
    await ui.click('Annuler');
    controller.expectNone('/api/budgets/b1');
    await click('Supprimer ce brouillon');
    await ui.click('Supprimer');
    const request = controller.expectOne('/api/budgets/b1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('/api/projects/p1/budgets').flush([]);
    await settle();
    expect(root.textContent).toContain('Aucun budget pour l');
  });

  it('ne propose pas de préparer un budget pour un projet archivé', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectBudget],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['projects:view', 'budgets:update']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectBudget);
    fixture.componentRef.setInput('project', { ...project, status: 'ARCHIVED' });
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/projects/p1/budgets').flush([]);
    await settle();
    expect(buttons().some((b) => b.includes('Préparer un budget'))).toBe(false);
  });
});
