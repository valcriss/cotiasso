import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { EntryPage } from './entry.page';

const journal = { id: 'j1', code: 'OD', label: 'Opérations diverses', type: 'MISC', active: true };
const bank = { id: 'a1', number: '512', label: 'Banque', active: true, reportLine: null };
const sales = { id: 'a2', number: '706', label: 'Prestations', active: true, reportLine: null };
const festival = { id: 'p1', code: 'FESTIVAL', name: 'Festival', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null };

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

describe('EntryPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<EntryPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Ouvre la page de l'écriture `e1` avec les données déjà chargées. */
  const create = async (permissions: string[], loaded: object = entry(), projects: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [EntryPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(permissions),
        NO_MATERIAL_ANIMATIONS,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'e1' })) } },
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EntryPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/journals').flush([journal]);
    controller.expectOne('/api/accounts').flush([bank, sales]);
    await settle();
    controller.expectOne('/api/projects').flush(projects);
    await settle();
    controller.expectOne('/api/entries/e1').flush(loaded);
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.trim().includes(label));
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("explique ce qu'est une écriture et propose de revenir à la liste", async () => {
    await create(['entries:view', 'entries:create']);
    expect(root.querySelector('h1')!.textContent).toContain('Écriture comptable');
    expect(root.textContent).toContain('doit toujours égaler');
    expect(root.textContent).toContain('Retour à la liste');
  });

  it('affiche les totaux en direct et signale un écart sur un brouillon déséquilibré', async () => {
    await create(['entries:view', 'entries:create'], entry({ lines: [line(1, 'a1', '50.00', '0.00'), line(2, 'a2', '0.00', '49.00')] }));
    expect(root.textContent).toContain('Écart à équilibrer : 1,00');
    expect(root.querySelector('button[type="submit"]')!.textContent).toContain('Enregistrer le brouillon');
    expect(root.textContent).not.toContain('Comptabiliser');
  });

  it('enregistre le brouillon avec la version lue et des montants normalisés', async () => {
    await create(['entries:view', 'entries:create']);
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
    expect(ui.snackbar).toContain('Brouillon enregistré');
  });

  it('comptabilise : enregistre puis comptabilise, et affiche le numéro attribué', async () => {
    await create(['entries:view', 'entries:create', 'entries:post']);
    await click('Comptabiliser');
    await ui.click('Comptabiliser');

    controller.expectOne((r) => r.method === 'PUT' && r.url === '/api/entries/e1').flush(entry());
    await settle();
    controller.expectOne((r) => r.method === 'POST' && r.url === '/api/entries/e1/post').flush(entry({ status: 'POSTED', number: 3 }));
    await settle();

    expect(ui.snackbar).toContain('Écriture comptabilisée : OD n° 3');
    // Désormais en lecture seule : plus de formulaire de saisie.
    expect(root.querySelector('input[formcontrolname="label"]')).toBeNull();
  });

  it('explique les conséquences avant de comptabiliser et ne fait rien si on renonce', async () => {
    await create(['entries:view', 'entries:create', 'entries:post']);
    await click('Comptabiliser');
    expect(ui.text).toContain('ne peut plus être modifiée');
    expect(ui.text).toContain('contrepasser');
    await ui.click('Annuler');
    controller.expectNone((r) => r.method === 'PUT');
    expect(ui.isOpen).toBe(false);
  });

  it('affiche les motifs de refus de la comptabilisation (422)', async () => {
    await create(['entries:view', 'entries:create', 'entries:post']);
    await click('Comptabiliser');
    await ui.click('Comptabiliser');
    controller.expectOne((r) => r.method === 'PUT').flush(entry());
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
    await create(['entries:view', 'entries:create', 'entries:post'], entry({ status: 'POSTED', number: 3 }));
    expect(root.querySelector('input[formcontrolname="label"]')).toBeNull();
    expect(root.textContent).toContain('ne se modifie plus');

    await click('Contrepasser');
    const post = controller.expectOne('/api/entries/e1/reverse');
    expect(post.request.body).toEqual({ date: '2026-03-15' });
    post.flush(entry({ id: 'e9', kind: 'REVERSAL', status: 'POSTED', number: 4, reversalOfId: 'e1' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/entries/e1').flush(entry({ status: 'REVERSED', number: 3, reversedById: 'e9' }));
    await settle();
    expect(ui.snackbar).toContain('Contrepassation comptabilisée : OD n° 4');
    expect(root.textContent).not.toContain('Contrepasser');
  });

  it('envoie la ventilation par projet des lignes de produit avec leur montant', async () => {
    const withProject = entry({
      lines: [line(1, 'a1', '50.00', '0.00'), { ...line(2, 'a2', '0.00', '50.00'), allocations: [{ projectId: 'p1', projectCode: 'FESTIVAL', amount: '50.00' }] }],
    });
    await create(['entries:view', 'entries:create'], withProject, [festival]);
    // Seule la ligne de produit (706) propose un projet ; la ligne de banque n'en a pas.
    expect(root.querySelectorAll('mat-select[formcontrolname="projectId"]')).toHaveLength(1);
    await click('Enregistrer le brouillon');
    const put = controller.expectOne('/api/entries/e1');
    expect(put.request.body.lines[0].allocations).toBeUndefined();
    expect(put.request.body.lines[1].allocations).toEqual([{ projectId: 'p1', amount: '50.00' }]);
    put.flush(withProject);
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
    await create(['entries:view', 'entries:create'], split, [festival]);
    await click('Enregistrer le brouillon');
    const put = controller.expectOne('/api/entries/e1');
    expect(put.request.body.lines[1].allocations).toEqual([
      { projectId: 'p1', amount: '60.00' },
      { projectId: 'p2', amount: '40.00' },
    ]);
    put.flush(split);
    await settle();
  });

  it('une écriture comptabilisée affiche le projet de ses lignes', async () => {
    const posted = entry({
      status: 'POSTED',
      number: 3,
      lines: [line(1, 'a1', '50.00', '0.00'), { ...line(2, 'a2', '0.00', '50.00'), allocations: [{ projectId: 'p1', projectCode: 'FESTIVAL', amount: '50.00' }] }],
    });
    await create(['entries:view'], posted, [festival]);
    expect(root.textContent).toContain('FESTIVAL');
  });

  it('sans droit de comptabiliser, ni bouton Comptabiliser ni Contrepasser', async () => {
    await create(['entries:view', 'entries:create'], entry({ status: 'POSTED', number: 3 }));
    expect(root.textContent).not.toContain('Contrepasser');
  });
});
