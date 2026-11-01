import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { EntriesPage } from './entries.page';

const year = { id: 'y1', label: 'Exercice 2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' };
const journal = { id: 'j1', code: 'OD', label: 'Opérations diverses', type: 'MISC', active: true };
const bank = { id: 'a1', number: '512', label: 'Banque', active: true, reportLine: null };
const sales = { id: 'a2', number: '706', label: 'Prestations', active: true, reportLine: null };

const line = (position: number, accountId: string, debit: string, credit: string) => ({
  position,
  accountId,
  accountNumber: accountId === 'a1' ? '512' : '706',
  accountLabel: accountId === 'a1' ? 'Banque' : 'Prestations',
  debit,
  credit,
  label: null,
  allocations: [],
});
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  fiscalYearId: 'y1',
  journalId: 'j1',
  journalCode: 'OD',
  date: '2026-03-15',
  label: 'Cotisation',
  reference: null,
  kind: 'NORMAL',
  status: 'DRAFT',
  number: null,
  version: 1,
  postedAt: null,
  reversalOfId: null,
  reversedById: null,
  totalDebit: '50.00',
  totalCredit: '50.00',
  lines: [line(1, 'a1', '50.00', '0.00'), line(2, 'a2', '0.00', '50.00')],
  ...overrides,
});

describe('EntriesPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<EntriesPage>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const festival = { id: 'p1', code: 'FESTIVAL', name: 'Festival', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null };
  const create = async (permissions: string[], listed = [entry()], projects: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [EntriesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EntriesPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/fiscal-years').flush([year]);
    controller.expectOne('/api/journals').flush([journal]);
    controller.expectOne('/api/accounts').flush([bank, sales]);
    await settle();
    controller.expectOne('/api/projects').flush(projects);
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: listed, next: null });
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.trim().includes(label));
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };
  const openFirst = async (loaded: object) => {
    await click('Ouvrir');
    controller.expectOne('/api/entries/e1').flush(loaded);
    await settle();
  };

  afterEach(() => controller.verify());

  it('liste les écritures avec leur état, montant et numéro', async () => {
    await create(['entries:view'], [entry(), entry({ id: 'e2', status: 'POSTED', number: 7, label: 'Loyer' })]);
    const text = root.textContent!;
    expect(text).toContain('Cotisation');
    expect(text).toContain('Brouillon');
    expect(text).toContain('Comptabilisée');
    expect(text).toContain('50,00');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(text).not.toContain('Nouvelle écriture');
  });

  it('affiche les totaux en direct et signale un écart sur un brouillon déséquilibré', async () => {
    await create(['entries:view', 'entries:create']);
    await openFirst(entry({ lines: [line(1, 'a1', '50.00', '0.00'), line(2, 'a2', '0.00', '49.00')] }));
    expect(root.textContent).toContain('Écart à équilibrer : 1,00');
    expect(root.querySelector('button[type="submit"]')!.textContent).toContain('Enregistrer le brouillon');
    expect(root.textContent).not.toContain('Comptabiliser');
  });

  it('enregistre le brouillon avec la version lue et des montants normalisés', async () => {
    await create(['entries:view', 'entries:create']);
    await openFirst(entry());
    expect(root.textContent).toContain('Écriture équilibrée');

    const debit = root.querySelector<HTMLInputElement>('input[formcontrolname="debit"]')!;
    debit.value = '50,5';
    debit.dispatchEvent(new Event('input'));
    const credit = root.querySelectorAll<HTMLInputElement>('input[formcontrolname="credit"]')[1]!;
    credit.value = '50,50';
    credit.dispatchEvent(new Event('input'));
    await settle();
    await click('Enregistrer le brouillon');

    const put = controller.expectOne('/api/entries/e1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toMatchObject({
      version: 1,
      journalId: 'j1',
      date: '2026-03-15',
      lines: [
        { accountId: 'a1', debit: '50.50', credit: '0.00' },
        { accountId: 'a2', debit: '0.00', credit: '50.50' },
      ],
    });
    put.flush(entry({ version: 2, totalDebit: '50.50', totalCredit: '50.50' }));
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [entry({ version: 2 })], next: null });
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Brouillon enregistré');
  });

  it('comptabilise : enregistre puis comptabilise, et affiche le numéro attribué', async () => {
    await create(['entries:view', 'entries:create', 'entries:post']);
    await openFirst(entry());
    await click('Comptabiliser');

    controller.expectOne((r) => r.method === 'PUT' && r.url === '/api/entries/e1').flush(entry());
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [entry()], next: null });
    await settle();
    controller.expectOne((r) => r.method === 'POST' && r.url === '/api/entries/e1/post').flush(entry({ status: 'POSTED', number: 3 }));
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [entry({ status: 'POSTED', number: 3 })], next: null });
    await settle();

    expect(root.textContent).toContain('Écriture comptabilisée : OD n° 3');
    // Désormais en lecture seule : plus de formulaire de saisie.
    expect(root.querySelector('input[formcontrolname="label"]')).toBeNull();
  });

  it('affiche les motifs de refus de la comptabilisation (422)', async () => {
    await create(['entries:view', 'entries:create', 'entries:post']);
    await openFirst(entry());
    await click('Comptabiliser');
    controller.expectOne((r) => r.method === 'PUT').flush(entry());
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [entry()], next: null });
    await settle();
    controller
      .expectOne((r) => r.url === '/api/entries/e1/post')
      .flush(
        { message: "L'écriture ne peut pas être comptabilisée.", issues: [{ code: 'UNBALANCED', message: 'Écriture déséquilibrée : débit 50.00, crédit 49.00.' }] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('ne peut pas être comptabilisée');
    expect(root.textContent).toContain('Écriture déséquilibrée : débit 50.00');
  });

  it('une écriture comptabilisée est en lecture seule et se contrepasse', async () => {
    await create(['entries:view', 'entries:create', 'entries:post'], [entry({ status: 'POSTED', number: 3 })]);
    await openFirst(entry({ status: 'POSTED', number: 3 }));
    expect(root.querySelector('input[formcontrolname="label"]')).toBeNull();
    expect(root.textContent).toContain('ne se modifie plus');

    await click('Contrepasser');
    const post = controller.expectOne('/api/entries/e1/reverse');
    expect(post.request.body).toEqual({ date: '2026-03-15' });
    post.flush(entry({ id: 'e9', kind: 'REVERSAL', status: 'POSTED', number: 4, reversalOfId: 'e1' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/entries/e1').flush(entry({ status: 'REVERSED', number: 3, reversedById: 'e9' }));
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [], next: null });
    await settle();
    expect(root.textContent).toContain('Contrepassation comptabilisée : OD n° 4');
    expect(root.textContent).not.toContain('Contrepasser');
  });

  it('envoie la ventilation par projet des lignes de produit avec leur montant', async () => {
    const withProject = entry({
      lines: [line(1, 'a1', '50.00', '0.00'), { ...line(2, 'a2', '0.00', '50.00'), allocations: [{ projectId: 'p1', projectCode: 'FESTIVAL', amount: '50.00' }] }],
    });
    await create(['entries:view', 'entries:create'], [withProject], [festival]);
    await openFirst(withProject);
    // Seule la ligne de produit (706) propose un projet ; la ligne de banque n'en a pas.
    expect(root.querySelectorAll('mat-select[formcontrolname="projectId"]')).toHaveLength(1);
    await click('Enregistrer le brouillon');
    const put = controller.expectOne('/api/entries/e1');
    expect(put.request.body.lines[0].allocations).toBeUndefined();
    expect(put.request.body.lines[1].allocations).toEqual([{ projectId: 'p1', amount: '50.00' }]);
    put.flush(withProject);
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [withProject], next: null });
    await settle();
  });

  it("conserve une ventilation entre plusieurs projets tant qu'on ne la remplace pas", async () => {
    const split = entry({
      lines: [
        line(1, 'a1', '100.00', '0.00'),
        {
          ...line(2, 'a2', '0.00', '100.00'),
          allocations: [
            { projectId: 'p1', projectCode: 'FESTIVAL', amount: '60.00' },
            { projectId: 'p2', projectCode: 'ATELIERS', amount: '40.00' },
          ],
        },
      ],
    });
    await create(['entries:view', 'entries:create'], [split], [festival]);
    await openFirst(split);
    await click('Enregistrer le brouillon');
    const put = controller.expectOne('/api/entries/e1');
    expect(put.request.body.lines[1].allocations).toEqual([
      { projectId: 'p1', amount: '60.00' },
      { projectId: 'p2', amount: '40.00' },
    ]);
    put.flush(split);
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: [split], next: null });
    await settle();
  });

  it('une écriture comptabilisée affiche le projet de ses lignes', async () => {
    const posted = entry({
      status: 'POSTED',
      number: 3,
      lines: [line(1, 'a1', '50.00', '0.00'), { ...line(2, 'a2', '0.00', '50.00'), allocations: [{ projectId: 'p1', projectCode: 'FESTIVAL', amount: '50.00' }] }],
    });
    await create(['entries:view'], [posted], [festival]);
    await openFirst(posted);
    expect(root.textContent).toContain('FESTIVAL');
  });

  it('sans droit de comptabiliser, ni bouton Comptabiliser ni Contrepasser', async () => {
    await create(['entries:view', 'entries:create'], [entry({ status: 'POSTED', number: 3 })]);
    await openFirst(entry({ status: 'POSTED', number: 3 }));
    expect(root.textContent).not.toContain('Contrepasser');
  });
});
