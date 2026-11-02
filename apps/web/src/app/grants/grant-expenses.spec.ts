import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { GrantExpenses } from './grant-expenses';

const grant = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  funder: { id: 'f1', name: 'Région', type: 'LOCAL_AUTHORITY', archived: false },
  reference: null,
  title: 'Aide au festival',
  status: 'GRANTED',
  requestedAmount: '900.00',
  grantedAmount: '900.00',
  requestedOn: null,
  decidedOn: '2026-03-15',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  conditions: '',
  note: '',
  reason: null,
  closedOn: null,
  residual: null,
  residualNote: null,
  allocations: [],
  allocatedTotal: '900.00',
  received: '0.00',
  ...over,
});
const expense = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  amount: '250.00',
  coFinancingReason: null,
  cancelled: false,
  cancelReason: null,
  counted: true,
  reversed: false,
  outOfPeriod: false,
  entry: { id: 'e1', number: 12, journalCode: 'OD', date: '2026-03-01', label: 'Facture traiteur' },
  account: { number: '606', label: 'Achats' },
  project: { id: 'p1', code: 'ATELIERS', name: 'Ateliers' },
  expenseAmount: '300.00',
  ...over,
});
const info = (over: Record<string, unknown> = {}) => ({
  grantId: 'g1',
  granted: '900.00',
  spent: '250.00',
  overGranted: false,
  overBy: null,
  expenses: [expense()],
  warnings: [],
  ...over,
});

describe('GrantExpenses', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<GrantExpenses>>;
  let root: HTMLElement;
  let ui: DialogTester;
  let changes: number;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (data: object, options: { permissions?: string[]; canManage?: boolean; grant?: Record<string, unknown> } = {}) => {
    await TestBed.configureTestingModule({
      imports: [GrantExpenses],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(options.permissions ?? ['grants:view', 'grants:manage', 'entries:view']),
        NO_MATERIAL_ANIMATIONS,
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantExpenses);
    fixture.componentRef.setInput('grant', grant(options.grant));
    fixture.componentRef.setInput('canManage', options.canManage ?? true);
    changes = 0;
    fixture.componentInstance.changed.subscribe(() => changes++);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/grants/g1/expenses').flush(data);
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };
  const buttons = () => Array.from(root.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent!.replace(/\s+/g, ' ').trim());
  const text = () => root.textContent!.replace(/\s+/g, ' ');
  const figures = () =>
    Array.from(root.querySelectorAll('dl.figures > div')).map((d) => `${d.querySelector('dt')!.textContent!.trim()}: ${d.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim()}`);

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('explique que la dépense doit être déjà comptabilisée et que rien n’est écrit en comptabilité', async () => {
    await create(info());
    expect(text()).toContain('déjà comptabilisée');
    expect(text()).toContain('ne crée aucune écriture');
    expect(figures()).toEqual(['Accordé: 900,00 €', 'Dépenses affectées: 250,00 €', 'Encore affectable: 650,00 €']);
  });

  it('liste les dépenses avec leur poste, leur projet et leur part', async () => {
    await create(info());
    const cells = Array.from(root.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells[0]).toBe('2026-03-01');
    expect(cells[1]).toBe('Facture traiteur 606 — Achats');
    expect(cells.slice(2, 4)).toEqual(['ATELIERS', '250,00']);
  });

  it('signale en toutes lettres un dépassement, une dépense hors période et une écriture annulée', async () => {
    await create(
      info({
        spent: '1000.00',
        overGranted: true,
        overBy: '100.00',
        warnings: ['Les dépenses affectées (1000.00 €) dépassent le montant accordé (900.00 €) de 100.00 €.'],
        expenses: [
          expense({ outOfPeriod: true, coFinancingReason: 'Complété par les fonds propres' }),
          expense({ id: 'x2', counted: false, reversed: true, amount: '80.00' }),
        ],
      }),
    );
    expect(figures()).toContain('Au-delà du montant accordé: 100,00 €');
    expect(text()).toContain('dépassent le montant accordé (900.00 €) de 100.00 €');
    expect(text()).toContain('Hors période financée');
    expect(text()).toContain('Écriture annulée : ne compte plus');
    expect(text()).toContain('Cofinancement : Complété par les fonds propres');
  });

  it('n’expose pas le libellé d’une écriture hors de la portée de l’utilisateur', async () => {
    await create(info({ expenses: [expense({ entry: { id: 'e9', number: 7, journalCode: 'OD', date: '2026-03-01', label: null } })] }), { canManage: false });
    expect(text()).toContain('Écriture OD n° 7');
    expect(text()).not.toContain('Facture traiteur');
  });

  it('barre une affectation annulée et rappelle son motif', async () => {
    await create(info({ expenses: [expense({ cancelled: true, counted: false, cancelReason: 'Mauvaise subvention' })] }));
    expect(root.querySelector('tbody tr')!.classList.contains('cancelled')).toBe(true);
    expect(text()).toContain('Annulée : Mauvaise subvention');
    expect(buttons().filter((b) => b.startsWith("Annuler l'affectation"))).toEqual([]);
  });

  it('ne propose aucune action en lecture seule, sans entries:view, ou une fois la subvention clôturée', async () => {
    await create(info(), { canManage: false });
    expect(buttons()).toEqual([]);
    TestBed.resetTestingModule();
    await create(info(), { permissions: ['grants:view', 'grants:manage'] });
    expect(buttons()).toEqual([]);
    TestBed.resetTestingModule();
    await create(info(), { grant: { status: 'CLOSED' } });
    expect(buttons()).toEqual([]);
  });

  it('dit quoi faire quand aucune dépense n’est encore affectée', async () => {
    await create(info({ expenses: [], spent: '0.00' }));
    expect(text()).toContain("Aucune dépense affectée pour l'instant. Cliquez sur « Affecter une dépense »");
  });

  it('affecte une dépense : la part libre est proposée et une dépense hors période est signalée avant validation', async () => {
    await create(info({ expenses: [], spent: '0.00' }));
    await click('Affecter une dépense');
    expect(ui.title).toBe('Affecter une dépense');
    expect(ui.text).toContain('ne crée aucune écriture');
    controller.expectOne('/api/grants/g1/expense-candidates').flush([
      { allocationId: 'a1', entry: { id: 'e1', number: 12, journalCode: 'OD', date: '2026-03-01', label: 'Facture traiteur' }, account: { number: '606', label: 'Achats' }, project: { id: 'p1', code: 'ATELIERS', name: 'Ateliers' }, amount: '300.00', remaining: '50.00', outOfPeriod: false },
      { allocationId: 'a2', entry: { id: 'e3', number: 14, journalCode: 'OD', date: '2027-02-01', label: 'Matériel' }, account: { number: '606', label: 'Achats' }, project: { id: 'p2', code: 'FESTIVAL', name: 'Festival' }, amount: '100.00', remaining: '100.00', outOfPeriod: true },
    ]);
    await settle();
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');

    await ui.choose('mat-select[formcontrolname="allocationId"]', 'Matériel');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').value).toBe('100,00');
    expect(ui.text).toContain('datée du 2027-02-01, hors de la période financée');
    expect(ui.text).toContain('Disponible sur cette dépense : 100,00 € (sur 100,00 €).');
    await ui.type('textarea[formcontrolname="coFinancingReason"]', 'Cofinancé par la mairie');
    await ui.submit();
    const request = controller.expectOne('/api/grants/g1/expenses');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ allocationId: 'a2', amount: '100.00', coFinancingReason: 'Cofinancé par la mairie' });
    request.flush(info({ spent: '100.00', expenses: [expense({ outOfPeriod: true })] }));
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Dépense affectée.');
    expect(changes).toBe(1);
  });

  it('garde la boîte ouverte avec le message du serveur quand la dépense n’a plus assez de part libre', async () => {
    await create(info());
    await click('Affecter une dépense');
    controller.expectOne('/api/grants/g1/expense-candidates').flush([
      { allocationId: 'a1', entry: { id: 'e1', number: 12, journalCode: 'OD', date: '2026-03-01', label: 'Facture' }, account: { number: '606', label: 'Achats' }, project: { id: 'p1', code: 'ATELIERS', name: 'Ateliers' }, amount: '300.00', remaining: '50.00', outOfPeriod: false },
    ]);
    await settle();
    await ui.choose('mat-select[formcontrolname="allocationId"]', 'Facture');
    await ui.type('input[formcontrolname="amount"]', '80');
    await ui.submit();
    controller.expectOne('/api/grants/g1/expenses').flush({ message: 'Il ne reste que 50.00 € de cette dépense à affecter.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('Il ne reste que 50.00 €');
  });

  it('dit quoi faire quand aucune dépense n’est disponible, et pourquoi la liste est parfois absente', async () => {
    await create(info());
    await click('Affecter une dépense');
    controller.expectOne('/api/grants/g1/expense-candidates').flush([]);
    await settle();
    expect(ui.text).toContain('Aucune dépense disponible');
    expect(ui.text).toContain('bien comptabilisée et affectée à l\'un de ces projets');
    expect(ui.button("Affecter la dépense").disabled).toBe(true);
    ui.closeAll();

    await click('Affecter une dépense');
    controller.expectOne('/api/grants/g1/expense-candidates').flush({ message: 'Accès refusé.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(ui.text).toContain("La liste des dépenses n'est pas accessible avec vos droits");
  });

  it('annule une affectation seulement avec un motif', async () => {
    await create(info());
    await click("Annuler l'affectation du 2026-03-01");
    expect(ui.title).toBe("Annuler l'affectation");
    expect(ui.text).toContain("rien n'est effacé");
    await ui.submit();
    expect(ui.error).toContain('Indiquez le motif');
    controller.expectNone('/api/grant-expenses/x1/cancel');
    await ui.type('textarea[formcontrolname="reason"]', 'Mauvaise subvention');
    await ui.submit();
    const request = controller.expectOne('/api/grant-expenses/x1/cancel');
    expect(request.request.body).toEqual({ reason: 'Mauvaise subvention' });
    request.flush(info({ spent: '0.00', expenses: [expense({ cancelled: true, counted: false, cancelReason: 'Mauvaise subvention' })] }));
    await settle();
    expect(ui.snackbar).toContain('Affectation annulée.');
    expect(figures()).toContain('Dépenses affectées: 0,00 €');
    expect(changes).toBe(1);
  });

  it('affiche un message clair si le chargement échoue', async () => {
    await TestBed.configureTestingModule({
      imports: [GrantExpenses],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantExpenses);
    fixture.componentRef.setInput('grant', grant());
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/grants/g1/expenses').flush({ message: 'Subvention introuvable.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('introuvable');
  });
});
