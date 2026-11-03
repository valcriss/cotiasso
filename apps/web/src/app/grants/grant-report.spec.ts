import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { GrantReport } from './grant-report';

const grant = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  funder: { id: 'f1', name: 'Région', type: 'LOCAL_AUTHORITY', archived: false },
  reference: 'RF-14',
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
const report = (over: Record<string, unknown> = {}) => ({
  grant: { id: 'g1', title: 'Aide au festival', funder: 'Région', reference: 'RF-14', periodStart: '2026-01-01', periodEnd: '2026-12-31' },
  period: { from: '2026-01-01', to: '2026-12-31' },
  granted: '900.00',
  groups: [
    { accountNumber: '606', accountLabel: 'Achats', count: 2, amount: '350.00' },
    { accountNumber: '607', accountLabel: 'Fournitures', count: 1, amount: '120.00' },
  ],
  spent: '470.00',
  payments: [{ operationDate: '2026-05-10', amount: '400.00' }],
  received: '400.00',
  residual: '-70.00',
  overGranted: false,
  coFinancingReasons: [],
  warnings: [],
  ...over,
});

describe('GrantReport', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<GrantReport>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (data: object, grantOver: Record<string, unknown> = {}) => {
    await TestBed.configureTestingModule({
      imports: [GrantReport],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantReport);
    fixture.componentRef.setInput('grant', grant(grantOver));
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne((r) => r.url === '/api/grants/g1/report').flush(data);
    await settle();
  };
  const text = () => root.textContent!.replace(/\s+/g, ' ');
  const rows = (table: number) =>
    Array.from(root.querySelectorAll('table')[table]!.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim()),
    );
  const figures = () =>
    Array.from(root.querySelectorAll('dl.figures > div')).map((d) => `${d.querySelector('dt')!.textContent!.trim()}: ${d.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim()}`);

  afterEach(() => controller.verify());

  it('part de la période financée par la subvention et demande le compte rendu sur cette période', async () => {
    await TestBed.configureTestingModule({
      imports: [GrantReport],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantReport);
    fixture.componentRef.setInput('grant', grant());
    root = fixture.nativeElement as HTMLElement;
    await settle();
    const request = controller.expectOne((r) => r.url === '/api/grants/g1/report');
    expect(request.request.params.get('from')).toBe('2026-01-01');
    expect(request.request.params.get('to')).toBe('2026-12-31');
    request.flush(report());
    await settle();
    expect(root.querySelectorAll<HTMLInputElement>('app-date-field input')[0]!.value).toBe('01/01/2026');
  });

  it('explique à quoi sert le compte rendu et montre les chiffres clés', async () => {
    await create(report());
    expect(text()).toContain('Ce que le financeur demande en général');
    expect(text()).toContain('Aide au festival — Région (réf. RF-14)');
    expect(figures()).toEqual(['Montant accordé: 900,00 €', 'Dépenses affectées: 470,00 €', 'Versements reçus: 400,00 €', 'Reliquat (reçu − dépenses): -70,00 €']);
  });

  it('regroupe les dépenses par poste et liste les versements reçus', async () => {
    await create(report());
    expect(rows(0)).toEqual([
      ['606 — Achats', '2', '350,00'],
      ['607 — Fournitures', '1', '120,00'],
    ]);
    expect(rows(1)).toEqual([['2026-05-10', '400,00']]);
    expect(root.querySelector('tfoot')!.textContent).toContain('Total des dépenses affectées');
  });

  it('affiche les avertissements et l’explication du cofinancement', async () => {
    await create(report({ overGranted: true, warnings: ['Les dépenses affectées dépassent le montant accordé de 20.00 €.'], coFinancingReasons: ['Complété par les fonds propres'] }));
    expect(text()).toContain('dépassent le montant accordé de 20.00 €');
    expect(text()).toContain('Cofinancement : Complété par les fonds propres');
  });

  it('dit qu’il n’y a rien sur la période quand il n’y a ni dépense ni versement', async () => {
    await create(report({ groups: [], payments: [], spent: '0.00', received: '0.00', residual: '0.00' }));
    expect(text()).toContain('Aucune dépense affectée sur cette période.');
    expect(text()).toContain('Aucun versement reçu sur cette période.');
  });

  it('recharge pour une autre période et reporte la période dans l’export CSV', async () => {
    await create(report());
    const link = () => root.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(link().getAttribute('href')).toBe('/api/grants/g1/report/csv?from=2026-01-01&to=2026-12-31');
    expect(text()).toContain('Imprimer');

    const to = root.querySelectorAll<HTMLInputElement>('app-date-field input')[1]!;
    to.value = '2026-06-30';
    to.dispatchEvent(new Event('input'));
    await settle();
    const request = controller.expectOne((r) => r.url === '/api/grants/g1/report' && r.params.get('to') === '2026-06-30');
    expect(request.request.params.get('from')).toBe('2026-01-01');
    request.flush(report({ period: { from: '2026-01-01', to: '2026-06-30' } }));
    await settle();
    expect(link().getAttribute('href')).toBe('/api/grants/g1/report/csv?from=2026-01-01&to=2026-06-30');
  });

  it('sans période financée, ne limite pas le compte rendu', async () => {
    await create(report({ grant: { id: 'g1', title: 'Aide au festival', funder: 'Région', reference: null, periodStart: null, periodEnd: null } }), { periodStart: null, periodEnd: null });
    expect(text()).toContain('Période financée : non précisée.');
  });

  it('affiche un message clair si le chargement échoue', async () => {
    await TestBed.configureTestingModule({
      imports: [GrantReport],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantReport);
    fixture.componentRef.setInput('grant', grant());
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne((r) => r.url === '/api/grants/g1/report').flush({ message: 'Subvention introuvable.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('introuvable');
  });
});
