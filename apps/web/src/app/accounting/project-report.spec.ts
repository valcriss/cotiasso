import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ProjectReport } from './project-report';

const project = { id: 'p1', code: 'FESTIVAL', name: 'Festival', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null };
const years = [
  { id: 'y1', label: '2026', start: '2026-01-01', end: '2026-12-31' },
  { id: 'y2', label: '2027', start: '2027-01-01', end: '2027-12-31' },
];
const row = (over: Record<string, unknown>) => ({
  key: 'k',
  label: '606 — Achats',
  accountNumber: '606',
  budget: '1000.00',
  engaged: '300.00',
  actual: '200.00',
  remaining: '500.00',
  outOfBudget: false,
  note: null,
  ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  project: { id: 'p1', code: 'FESTIVAL', name: 'Festival' },
  scope: { kind: 'GLOBAL', fiscalYear: null },
  fiscalYears: years,
  budget: { id: 'b1', number: 2, label: 'Budget voté', approvedAt: '2026-05-10T09:00:00.000Z' },
  formula: 'Reste disponible (dépenses) = budget − dépensé − engagé non soldé. Périmètre : toute la vie du projet.',
  charges: {
    rows: [row({}), row({ key: 'o', label: '607 — Fournitures', accountNumber: '607', budget: null, engaged: '0.00', actual: '30.00', remaining: null, outOfBudget: true, note: 'Compte non indiqué dans le budget' })],
    total: { budget: '1000.00', engaged: '300.00', actual: '230.00', remaining: '470.00' },
  },
  products: {
    rows: [row({ key: 'p', label: '706 — Prestations', accountNumber: '706', budget: '800.00', engaged: null, actual: '500.00', remaining: '300.00' })],
    total: { budget: '800.00', engaged: null, actual: '500.00', remaining: '300.00' },
  },
  warnings: [],
  ...over,
});

describe('ProjectReport', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ProjectReport>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (data: object) => {
    await TestBed.configureTestingModule({
      imports: [ProjectReport],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['projects:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectReport);
    fixture.componentRef.setInput('project', project);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/projects/p1/budget-report').flush(data);
    await settle();
  };
  const text = () => root.textContent!.replace(/\s+/g, ' ');
  /** Texte de chaque cellule d'une ligne dont la première cellule commence par `start`. */
  const cells = (start: string): string[] => {
    const found = Array.from(root.querySelectorAll('tr')).find((tr) => tr.querySelector('td')?.textContent!.trim().startsWith(start));
    expect(found, start).toBeTruthy();
    return Array.from(found!.querySelectorAll('td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
  };

  afterEach(() => {
    TestBed.inject(OverlayContainer).getContainerElement().innerHTML = '';
    controller.verify();
  });

  it('explique ce que compare le suivi, et montre prévu, engagé, dépensé et reste en euros', async () => {
    await create(report());
    expect(text()).toContain('ce que vous aviez prévu');
    expect(text()).toContain('promis mais pas encore payé');
    expect(text()).toContain('Budget en vigueur : n° 2 — Budget voté.');
    expect(cells('606')).toEqual(['606 — Achats', '1 000,00', '300,00', '200,00', '500,00']);
    expect(cells('Total des dépenses')).toEqual(['Total des dépenses', '1 000,00', '300,00', '230,00', '470,00']);
    expect(cells('706')).toEqual(['706 — Prestations', '800,00', '500,00', '300,00']);
    expect(cells('Total des recettes')).toEqual(['Total des recettes', '800,00', '500,00', '300,00']);
    expect(text()).toContain('Reste à recevoir');
  });

  it('montre la formule du reste disponible et son périmètre', async () => {
    await create(report());
    expect(text()).toContain('Comment lire le reste disponible ?');
    expect(text()).toContain('budget − dépensé − engagé non soldé');
    expect(text()).toContain('toute la vie du projet');
  });

  it('signale un compte hors budget sans le cacher, et met « — » là où la comparaison n’a pas de sens', async () => {
    await create(report());
    const other = Array.from(root.querySelectorAll('tbody tr.other'));
    expect(other).toHaveLength(1);
    expect(other[0]!.textContent).toContain('607 — Fournitures');
    expect(other[0]!.textContent).toContain('Compte non indiqué dans le budget');
    expect(cells('607').slice(1)).toEqual(['—', '0,00', '30,00', '—']);
  });

  it('dit « Dépassement » en toutes lettres quand le reste est négatif, sans se fier à la couleur', async () => {
    const data = report();
    data.charges.rows[0] = row({ remaining: '-120.00' });
    data.charges.total.remaining = '-120.00';
    await create(data);
    expect(root.querySelectorAll('.chip')).toHaveLength(2);
    expect(cells('606')[4]).toBe('-120,00 Dépassement');
  });

  it('sans budget en vigueur, affiche l’avertissement et aucun reste', async () => {
    await create(
      report({
        budget: null,
        warnings: ["Aucun budget n'est en vigueur pour ce projet : seul le réalisé est affiché."],
        charges: { rows: [row({ budget: null, engaged: '0.00', remaining: null, outOfBudget: true })], total: { budget: null, engaged: '0.00', actual: '200.00', remaining: null } },
        products: { rows: [], total: { budget: null, engaged: null, actual: '0.00', remaining: null } },
      }),
    );
    expect(text()).toContain("Aucun budget n'est en vigueur");
    expect(text()).not.toContain('Budget en vigueur :');
    expect(cells('Total des dépenses')).toEqual(['Total des dépenses', '—', '0,00', '200,00', '—']);
    expect(text()).toContain('Aucune recette prévue ni enregistrée');
  });

  it('propose le CSV et l’impression, et recharge pour l’exercice choisi', async () => {
    await create(report());
    const link = () => root.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(link().getAttribute('href')).toBe('/api/projects/p1/budget-report/csv?');
    expect(text()).toContain('Imprimer');

    root.querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await settle();
    const options = Array.from(TestBed.inject(OverlayContainer).getContainerElement().querySelectorAll<HTMLElement>('.mat-mdc-option'));
    expect(options.map((o) => o.textContent!.trim())).toEqual(['Toute la vie du projet', 'Exercice 2026', 'Exercice 2027']);
    options[2]!.click();
    await settle();
    const request = controller.expectOne((r) => r.url === '/api/projects/p1/budget-report' && r.params.get('fiscalYearId') === 'y2');
    request.flush(report({ scope: { kind: 'YEAR', fiscalYear: years[1] } }));
    await settle();
    expect(link().getAttribute('href')).toBe('/api/projects/p1/budget-report/csv?fiscalYearId=y2');
  });

  it('dit quoi faire quand le suivi ne se charge pas', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectReport],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['projects:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectReport);
    fixture.componentRef.setInput('project', project);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/projects/p1/budget-report').flush({ message: 'Projet introuvable.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('introuvable');
  });
});
