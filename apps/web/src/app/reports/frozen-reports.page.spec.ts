import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { FrozenReportsPage } from './frozen-reports.page';

const years = [
  { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' },
  { id: 'y26', label: '2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' },
];
const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  fiscalYearId: 'y25',
  number: 1,
  kind: 'CLOSED',
  provisional: false,
  label: "Comptes de l'exercice clôturé",
  reason: null,
  supersedesNumber: null,
  latest: true,
  calcVersion: 1,
  createdAt: '2026-01-15T10:00:00.000Z',
  sha256: 'a'.repeat(64),
  approval: null,
  ...overrides,
});
const group = { code: 'G', label: 'Produits', help: '', rows: [{ code: 'R', label: 'Cotisations', amount: '300.00', previous: null }], total: '300.00', previousTotal: null };
const detail = (overrides: Record<string, unknown> = {}) => ({
  ...version(),
  intact: true,
  content: {
    meta: { generatedAt: '2026-01-15T10:00:00.000Z', calcVersion: 1, provisional: false, draftEntries: 0, fiscalYear: { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' } },
    incomeStatement: { fiscalYear: { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' }, previous: null, draftEntries: 0, carryWarning: null, sections: [group], intermediate: [], products: '300.00', charges: '0.00', result: '300.00', previousResult: null, defaulted: [], unclassified: [] },
    balanceSheet: { fiscalYear: { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' }, previous: null, draftEntries: 0, carryWarning: null, assets: [group], liabilities: [group], totalAssets: '1300.00', totalLiabilities: '1300.00', previousTotalAssets: null, previousTotalLiabilities: null, difference: '0.00', balanced: true, result: '300.00', unclassified: [] },
    treasury: { fiscalYear: { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' }, previous: null, draftEntries: 0, carryWarning: null, rows: [{ number: '512', label: 'Banque', financialAccountName: 'Compte courant', opening: '0.00', receipts: '1300.00', payments: '0.00', closing: '1300.00', previous: null }], totals: { opening: '0.00', receipts: '1300.00', payments: '0.00', closing: '1300.00' }, previousTotals: null },
  },
  ...overrides,
});

describe('FrozenReportsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<FrozenReportsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], versions: object[] = [version()], list: object[] = years) => {
    await TestBed.configureTestingModule({
      imports: [FrozenReportsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FrozenReportsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/fiscal-years').flush(list);
    await settle();
    if (list.length > 0) {
      controller.expectOne((r) => r.url.startsWith('/api/fiscal-years/') && r.url.endsWith('/frozen-reports')).flush(versions);
      await settle();
    }
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes(label) || b.getAttribute('aria-label')?.includes(label));
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };
  const flushDocuments = async () => {
    controller.expectOne((r) => r.url === '/api/documents' && r.params.get('objectType') === 'frozen-report').flush({ items: [], total: 0, pageSize: 50 });
    controller.expectOne('/api/documents/options').flush({ categories: [], objectTypes: [], allowedExtensions: [] });
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("explique à quoi servent les rapports figés et liste les versions de l'exercice, la plus récente d'abord", async () => {
    await create(['reports:view'], [version({ id: 'f2', number: 2, supersedesNumber: 1, reason: 'Facture oubliée' }), version({ latest: false })]);
    expect(root.textContent).toContain('enregistrés pour ne plus changer');
    const items = Array.from(root.querySelectorAll('.card-item')).map((li) => li.textContent!.replace(/\s+/g, ' '));
    expect(items[0]).toContain('Version 2');
    expect(items[0]).toContain('Remplace la version 1');
    expect(items[0]).toContain('Motif : Facture oubliée');
    expect(items[0]).toContain('Version à jour');
    expect(items[0]).toContain('Définitive (exercice clôturé)');
    expect(items[1]).toContain('Remplacée par une version plus récente');
  });

  it('dit quoi attendre quand rien n’est encore figé', async () => {
    await create(['reports:view'], []);
    expect(root.textContent).toContain('Aucun rapport figé pour cet exercice');
    expect(root.textContent).toContain('arrêté provisoire sera figé automatiquement');
    expect(root.textContent).not.toContain('Figer maintenant');
  });

  it('ouvre une version : comptes figés, résultat, bilan équilibré, trésorerie, empreinte et dépôt du procès-verbal', async () => {
    await create(['reports:view', 'documents:create']);
    await click('Consulter la version 1');
    controller.expectOne('/api/frozen-reports/f1').flush(detail());
    await settle();
    await flushDocuments();
    const text = root.textContent!;
    expect(text).toContain('Exercice 2025 — version 1');
    expect(text).toContain('Rapports définitifs');
    expect(text).toContain('aaaaaaaaaaaa…');
    expect(text).toContain("Ce n’est pas un archivage à valeur légale");
    expect(text).toContain('Résultat : 300,00 €');
    expect(text).toContain('Total de l’actif : 1 300,00 €');
    expect(root.querySelector('section[aria-label="Trésorerie figée"]')!.textContent).toContain('Compte courant');
    expect(text).toContain('procès-verbal');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('alerte clairement quand le contenu enregistré ne correspond plus à son empreinte', async () => {
    await create(['reports:view']);
    await click('Consulter la version 1');
    controller.expectOne('/api/frozen-reports/f1').flush(detail({ intact: false }));
    await settle();
    await flushDocuments();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('ne correspond plus à son empreinte');
  });

  it('fige à la demande, avec un motif exigé dès la deuxième version, puis ouvre la nouvelle version', async () => {
    await create(['reports:view', 'fiscal-years:close']);
    await click('Figer maintenant');
    expect(ui.title).toBe('Figer les rapports');
    expect(ui.text).toContain('Rien ne s’efface');
    expect(ui.text).toContain('Pourquoi une nouvelle version');
    await ui.submit();
    expect(ui.error).toContain('pourquoi');
    controller.expectNone((r) => r.method === 'POST');
    await ui.type('input[formcontrolname="reason"]', 'Une facture avait été oubliée');
    await ui.submit();
    const post = controller.expectOne((r) => r.method === 'POST' && r.url === '/api/fiscal-years/y26/frozen-reports');
    expect(post.request.body).toEqual({ reason: 'Une facture avait été oubliée' });
    post.flush(version({ id: 'f2', number: 2, supersedesNumber: 1 }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne((r) => r.method === 'GET' && r.url === '/api/fiscal-years/y26/frozen-reports').flush([version({ id: 'f2', number: 2 }), version({ latest: false })]);
    await settle();
    controller.expectOne('/api/frozen-reports/f2').flush(detail({ id: 'f2', number: 2 }));
    await settle();
    await flushDocuments();
    expect(ui.snackbar).toContain('Rapports figés : version 2');
  });

  it('la première version se fige sans motif', async () => {
    await create(['reports:view', 'fiscal-years:close'], []);
    await click('Figer maintenant');
    expect(ui.text).not.toContain('Pourquoi une nouvelle version');
    await ui.submit();
    const post = controller.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toEqual({});
    post.flush({ message: 'Aucun exercice.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(ui.error).toContain('Aucun exercice');
    expect(ui.isOpen).toBe(true);
  });

  it('propose l’approbation par l’assemblée seulement pour la dernière version définitive non approuvée, et la fait confirmer', async () => {
    await create(['reports:view', 'fiscal-years:close'], [version(), version({ id: 'f0', number: 0, latest: false })]);
    expect(Array.from(root.querySelectorAll('button')).filter((b) => b.textContent!.includes('Approuver par l’assemblée'))).toHaveLength(1);
    await click('Approuver la version 1');
    expect(ui.title).toBe('Approuver les comptes');
    expect(ui.text).toContain('facultative');
    await ui.submit();
    expect(ui.error).toContain('date');
    await ui.type('input[formcontrolname="meetingDate"]', '2026-06-14');
    await ui.type('input[formcontrolname="note"]', 'Approuvés à l’unanimité');
    await ui.submit();
    const post = controller.expectOne('/api/frozen-reports/f1/approve');
    expect(post.request.body).toEqual({ meetingDate: '2026-06-14', note: 'Approuvés à l’unanimité' });
    post.flush(version({ approval: { meetingDate: '2026-06-14', note: 'Approuvés à l’unanimité', approvedAt: '2026-06-15T09:00:00.000Z' } }));
    await settle();
    controller.expectOne((r) => r.method === 'GET' && r.url.endsWith('/frozen-reports')).flush([version({ approval: { meetingDate: '2026-06-14', note: 'Approuvés à l’unanimité', approvedAt: '2026-06-15T09:00:00.000Z' } })]);
    await settle();
    controller.expectOne('/api/frozen-reports/f1').flush(detail());
    await settle();
    await flushDocuments();
    expect(ui.snackbar).toContain('Approbation enregistrée');
    expect(root.textContent).toContain('Approuvés par l’assemblée générale du 14/06/2026');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Approuver par l’assemblée'))).toBe(false);
  });

  it('ne propose ni figement ni approbation sans le droit de clôturer, ni pour une version provisoire ou remplacée', async () => {
    await create(['reports:view'], [version()]);
    expect(root.textContent).not.toContain('Figer maintenant');
    expect(root.textContent).not.toContain('Approuver par l’assemblée');
    TestBed.resetTestingModule();
    await create(['reports:view', 'fiscal-years:close'], [version({ provisional: true, kind: 'CLOSING' }), version({ id: 'f0', number: 0, latest: false })]);
    expect(root.textContent).not.toContain('Approuver par l’assemblée');
    expect(root.textContent).toContain('Provisoire (exercice non clôturé)');
  });

  it('sans exercice, dit quoi faire en premier', async () => {
    await create(['reports:view'], [], []);
    expect(root.textContent).toContain('Aucun exercice n’est encore créé');
  });

  it('affiche le refus du serveur', async () => {
    await TestBed.configureTestingModule({
      imports: [FrozenReportsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['reports:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FrozenReportsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/fiscal-years').flush(years);
    await settle();
    controller.expectOne((r) => r.url.endsWith('/frozen-reports')).flush({ message: 'Accès refusé.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Accès refusé');
  });
});
