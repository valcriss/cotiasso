import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { GrantFinance } from './grant-finance';

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
  periodStart: null,
  periodEnd: null,
  conditions: '',
  note: '',
  reason: null,
  closedOn: null,
  residual: null,
  residualNote: null,
  allocations: [],
  allocatedTotal: '900.00',
  received: '450.00',
  ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  dueOn: '2026-05-01',
  amount: '300.00',
  condition: 'À la signature',
  received: '0.00',
  state: 'PENDING',
  overdue: false,
  ...over,
});
const payment = (over: Record<string, unknown> = {}) => ({
  id: 'pay1',
  transactionId: 't1',
  operationDate: '2026-05-10',
  amount: '300.00',
  scheduleId: 'l1',
  note: null,
  cancelled: false,
  cancelReason: null,
  ...over,
});
const finance = (over: Record<string, unknown> = {}) => ({
  grantId: 'g1',
  granted: '900.00',
  planned: '700.00',
  received: '450.00',
  remaining: '450.00',
  unplanned: '200.00',
  overReceived: false,
  schedule: [
    line({ id: 'l1', state: 'RECEIVED', received: '300.00' }),
    line({ id: 'l2', dueOn: '2026-11-01', amount: '400.00', condition: 'Après bilan', received: '150.00', state: 'PARTIAL', overdue: true }),
  ],
  payments: [payment(), payment({ id: 'pay2', transactionId: 't2', operationDate: '2027-01-15', amount: '150.00', scheduleId: 'l2' })],
  ...over,
});

describe('GrantFinance', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<GrantFinance>>;
  let root: HTMLElement;
  let ui: DialogTester;
  let changes: number;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (data: object, options: { canManage?: boolean; grant?: Record<string, unknown> } = {}) => {
    await TestBed.configureTestingModule({
      imports: [GrantFinance],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view', 'grants:manage']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantFinance);
    fixture.componentRef.setInput('grant', grant(options.grant));
    fixture.componentRef.setInput('canManage', options.canManage ?? true);
    changes = 0;
    fixture.componentInstance.changed.subscribe(() => changes++);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/grants/g1/finance').flush(data);
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
  /** Chiffres clés sous la forme « libellé: valeur ». */
  const figures = () =>
    Array.from(root.querySelectorAll('dl.figures > div')).map((d) => `${d.querySelector('dt')!.textContent!.trim()}: ${d.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim()}`);
  const cells = (table: number, row: number) =>
    Array.from(root.querySelectorAll('table')[table]!.querySelectorAll('tbody tr')[row]!.querySelectorAll('td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim());

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('distingue le montant accordé de l’argent arrivé, et montre les chiffres clés', async () => {
    await create(finance());
    expect(text()).toContain('Le montant accordé est la décision du financeur');
    expect(text()).toContain("Rien n'est écrit dans la comptabilité");
    expect(figures()).toEqual(['Accordé: 900,00 €', 'Prévu en échéances: 700,00 €', 'Reçu: 450,00 €', 'Reste à recevoir: 450,00 €']);
  });

  it('liste les échéances avec leur état et signale celles en retard', async () => {
    await create(finance());
    expect(cells(0, 0).slice(0, 5)).toEqual(['2026-05-01', 'À la signature', '300,00', '300,00', 'Reçu']);
    expect(cells(0, 1).slice(0, 4)).toEqual(['2026-11-01', 'Après bilan', '400,00', '150,00']);
    expect(cells(0, 1)[4]).toContain('Partiellement reçu');
    expect(cells(0, 1)[4]).toContain('En retard');
    expect(cells(0, 0)[4]).not.toContain('En retard');
  });

  it('liste les versements reçus et barre ceux qui sont annulés, avec leur motif', async () => {
    await create(finance({ payments: [payment(), payment({ id: 'pay3', cancelled: true, cancelReason: 'Rattaché par erreur', amount: '50.00', scheduleId: null })] }));
    expect(cells(1, 0).slice(0, 3)).toEqual(['2026-05-10', '2026-05-01 — 300,00 €', '300,00']);
    expect(root.querySelectorAll('table')[1]!.querySelectorAll('tbody tr')[1]!.classList.contains('cancelled')).toBe(true);
    expect(text()).toContain('Annulé : Rattaché par erreur');
    // Un versement annulé n'a plus d'action.
    expect(buttons().filter((b) => b.startsWith('Annuler le versement'))).toEqual(['Annuler le versement du 2026-05-10']);
  });

  it('signale un trop-perçu en toutes lettres', async () => {
    await create(finance({ received: '1000.00', remaining: '-100.00', overReceived: true }));
    expect(figures()).toContain('Reçu en trop: 100,00 €');
    expect(text()).toContain('Le financeur a versé plus que le montant accordé');
  });

  it('en lecture seule, ne propose aucune action', async () => {
    await create(finance(), { canManage: false });
    expect(buttons()).toEqual([]);
  });

  it('sur une subvention clôturée, ne propose plus aucune action et le dit', async () => {
    await create(finance(), { grant: { status: 'CLOSED', closedOn: '2027-04-01', residual: 'NONE' } });
    expect(buttons()).toEqual([]);
    expect(text()).toContain('Cette subvention est clôturée : son échéancier et ses versements ne changent plus.');
  });

  it('dit quoi faire quand rien n’est encore prévu ni reçu', async () => {
    await create(finance({ schedule: [], payments: [], planned: '0.00', received: '0.00', remaining: '900.00', unplanned: '900.00' }));
    expect(text()).toContain('Aucune échéance prévue. Ajoutez les versements que vous attendez');
    expect(text()).toContain('900,00 € restent à planifier');
    expect(text()).toContain('Aucun versement reçu pour l\'instant');
  });

  it('ajoute une échéance en rappelant ce qu’il reste à planifier', async () => {
    await create(finance());
    await click('Ajouter une échéance');
    expect(ui.title).toBe('Ajouter une échéance');
    expect(ui.text).toContain("Ce n'est qu'un plan");
    expect(ui.text).toContain('Reste à planifier : 200,00 €.');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    await ui.type('input[formcontrolname="dueOn"]', '2027-03-01');
    await ui.type('input[formcontrolname="amount"]', '150,5');
    await ui.type('input[formcontrolname="condition"]', 'Solde');
    await ui.submit();
    const request = controller.expectOne('/api/grants/g1/schedule');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ dueOn: '2027-03-01', amount: '150.50', condition: 'Solde' });
    request.flush(finance({ planned: '850.50', unplanned: '49.50' }));
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Échéance ajoutée.');
    expect(changes).toBe(1);
    expect(figures()).toContain('Prévu en échéances: 850,50 €');
  });

  it('garde la boîte ouverte avec le message du serveur quand les échéances dépassent le montant accordé', async () => {
    await create(finance());
    await click('Ajouter une échéance');
    await ui.type('input[formcontrolname="dueOn"]', '2027-03-01');
    await ui.type('input[formcontrolname="amount"]', '500');
    await ui.submit();
    controller.expectOne('/api/grants/g1/schedule').flush({ message: 'Les échéances prévues dépasseraient le montant accordé (900.00 €). Il ne reste que 200.00 € à planifier.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('Il ne reste que 200.00 € à planifier');
  });

  it('modifie une échéance, et ne propose de retirer que celles sans versement', async () => {
    await create(finance({ schedule: [line({ id: 'l1', state: 'RECEIVED', received: '300.00' }), line({ id: 'l3', dueOn: '2028-01-01', amount: '100.00' })] }));
    expect(buttons().filter((b) => b.startsWith("Retirer l'échéance"))).toEqual(["Retirer l'échéance du 2026-05-01".replace('2026-05-01', '2028-01-01')]);
    await click("Modifier l'échéance du 2028-01-01");
    expect(ui.title).toBe("Modifier l'échéance");
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').value).toBe('100,00');
    await ui.type('input[formcontrolname="amount"]', '120');
    await ui.submit();
    const request = controller.expectOne('/api/grant-schedule/l3');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toMatchObject({ amount: '120.00', dueOn: '2028-01-01' });
    request.flush(finance());
    await settle();
    expect(ui.snackbar).toContain('Échéance enregistrée.');
  });

  it('retire une échéance seulement après confirmation', async () => {
    await create(finance({ schedule: [line({ id: 'l3', dueOn: '2028-01-01', amount: '100.00' })], payments: [] }));
    await click("Retirer l'échéance du 2028-01-01");
    expect(ui.title).toBe('Retirer cette échéance ?');
    expect(ui.text).toContain('Aucun versement n\'y est rattaché');
    await ui.click('Annuler');
    controller.expectNone('/api/grant-schedule/l3');
    await click("Retirer l'échéance du 2028-01-01");
    await ui.click('Retirer');
    const request = controller.expectOne('/api/grant-schedule/l3');
    expect(request.request.method).toBe('DELETE');
    request.flush(finance({ schedule: [] }));
    await settle();
    expect(ui.snackbar).toContain('Échéance retirée.');
    expect(changes).toBe(1);
  });

  it('enregistre un versement : l’encaissement propose sa part disponible, l’échéance est facultative', async () => {
    await create(finance());
    await click('Enregistrer un versement reçu');
    expect(ui.title).toBe('Enregistrer un versement reçu');
    expect(ui.text).toContain('ne crée aucune écriture comptable');
    controller.expectOne('/api/grants/g1/payment-candidates').flush([
      { id: 't9', operationDate: '2026-12-01', label: 'VIR REGION', accountName: 'Banque', amount: '500.00', remaining: '350.00' },
    ]);
    await settle();
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    await ui.choose('mat-select[formcontrolname="transactionId"]', 'VIR REGION');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').value).toBe('350,00');
    expect(ui.text).toContain('Disponible sur cet encaissement : 350,00 €.');
    await ui.type('input[formcontrolname="amount"]', '250');
    await ui.choose('mat-select[formcontrolname="scheduleId"]', '2026-11-01');
    await ui.submit();
    const request = controller.expectOne('/api/grants/g1/payments');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ transactionId: 't9', amount: '250.00', scheduleId: 'l2', note: null });
    request.flush(finance({ received: '700.00', remaining: '200.00' }));
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Versement enregistré.');
    expect(changes).toBe(1);
    expect(figures()).toContain('Reçu: 700,00 €');
  });

  it('dit quoi faire quand aucun encaissement n’est disponible, et grise la validation', async () => {
    await create(finance());
    await click('Enregistrer un versement reçu');
    controller.expectOne('/api/grants/g1/payment-candidates').flush([]);
    await settle();
    expect(ui.text).toContain("Aucun encaissement disponible. Importez ou saisissez d'abord le versement dans la page Comptes");
    expect(ui.button('Enregistrer le versement').disabled).toBe(true);
  });

  it('explique pourquoi la liste des encaissements est absente quand les droits manquent', async () => {
    await create(finance());
    await click('Enregistrer un versement reçu');
    controller.expectOne('/api/grants/g1/payment-candidates').flush({ message: 'Accès refusé.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(ui.text).toContain("La liste des encaissements n'est pas accessible avec vos droits");
  });

  it('annule un versement seulement avec un motif', async () => {
    await create(finance());
    await click('Annuler le versement du 2026-05-10');
    expect(ui.title).toBe('Annuler le versement');
    expect(ui.text).toContain("rien n'est effacé");
    await ui.submit();
    expect(ui.error).toContain('Indiquez le motif');
    controller.expectNone('/api/grant-payments/pay1/cancel');
    await ui.type('textarea[formcontrolname="reason"]', 'Mauvaise subvention');
    await ui.submit();
    const request = controller.expectOne('/api/grant-payments/pay1/cancel');
    expect(request.request.body).toEqual({ reason: 'Mauvaise subvention' });
    request.flush(finance({ received: '150.00', remaining: '750.00' }));
    await settle();
    expect(ui.snackbar).toContain('Versement annulé.');
    expect(figures()).toContain('Reçu: 150,00 €');
  });

  it('affiche un message clair si le chargement échoue', async () => {
    await TestBed.configureTestingModule({
      imports: [GrantFinance],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantFinance);
    fixture.componentRef.setInput('grant', grant());
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/grants/g1/finance').flush({ message: 'Subvention introuvable.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('introuvable');
  });
});
