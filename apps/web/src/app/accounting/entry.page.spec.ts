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
const owed = { id: 'a3', number: '411', label: 'Adhérents', active: true, reportLine: null };
const marie = { id: 't1', kind: 'MEMBER', name: 'Marie Dupont', memberId: 'm1', funderId: null, note: '', archived: false };
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
  const create = async (permissions: string[], loaded: object = entry(), projects: object[] = [], projectRequired = false, thirdParties: object[] = []) => {
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
    controller.expectOne('/api/accounts').flush([bank, sales, owed]);
    await settle();
    controller.expectOne('/api/projects').flush(projects);
    await settle();
    controller.expectOne('/api/third-parties').flush(thirdParties);
    await settle();
    controller.expectOne('/api/entries/e1').flush(loaded);
    controller.expectOne('/api/accounting/settings').flush({ projectRequired });
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

  describe('projet obligatoire', () => {
    const permanent = { ...festival, id: 'p0', code: 'FONC', name: 'Fonctionnement', permanent: true };

    it('prévient avant la comptabilisation, en trois temps, et rattache les lignes sans projet à « Fonctionnement » d\'un clic', async () => {
      await create(['entries:view', 'entries:create'], entry(), [permanent, festival], true);
      const panel = root.querySelector('.hint-panel')!;
      expect(panel.textContent).toContain('Une ligne de dépense ou de recette n’a pas de projet');
      expect(panel.textContent).toContain('ce que chaque projet coûte et rapporte');
      expect(panel.textContent).toContain('À faire');
      await click('Rattacher cette ligne à « Fonctionnement »');
      expect(root.querySelector('.hint-panel')).toBeNull();
      // Le choix est bien dans le formulaire : il part avec l'enregistrement.
      await click('Enregistrer le brouillon');
      const put = controller.expectOne('/api/entries/e1');
      expect(put.request.body.lines[1].allocations).toEqual([{ projectId: 'p0', amount: '50.00' }]);
      put.flush(entry());
      await settle();
    });

    it('sans projet permanent proposé, nomme les lignes à corriger', async () => {
      await create(['entries:view', 'entries:create'], entry(), [festival], true);
      expect(root.querySelector('.hint-panel')!.textContent).toContain('lignes 2');
      expect(root.querySelector('.hint-panel button')).toBeNull();
    });

    it("ne dit rien quand la règle n'est pas exigée", async () => {
      await create(['entries:view', 'entries:create'], entry(), [permanent], false);
      expect(root.querySelector('.hint-panel')).toBeNull();
    });

    it('affiche le message du serveur à trois temps quand la comptabilisation est refusée', async () => {
      await create(['entries:view', 'entries:create', 'entries:post'], entry(), [festival], false);
      await click('Comptabiliser');
      await ui.click('Comptabiliser');
      const put = controller.expectOne('/api/entries/e1');
      put.flush(entry());
      await settle();
      controller
        .expectOne('/api/entries/e1/post')
        .flush(
          { message: "L'écriture ne peut pas être comptabilisée.", issues: [{ code: 'PROJECT_REQUIRED', message: 'Ligne 2 (compte 706) : cette recette n’est rattachée à aucun projet. À faire : choisissez le projet de cette ligne.' }] },
          { status: 422, statusText: 'Unprocessable Entity' },
        );
      await settle();
      expect(root.querySelector('[role="alert"]')!.textContent).toContain("L'écriture ne peut pas être comptabilisée.");
      expect(root.textContent).toContain('Ligne 2 (compte 706)');
      expect(root.textContent).toContain('À faire');
    });
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

  describe('tiers (ADR 0030)', () => {
    const receivable = (extra: Record<string, unknown> = {}) => ({ ...line(1, 'a3', '50.00', '0.00'), accountNumber: '411', accountLabel: 'Adhérents', ...extra });

    it("ne demande « Qui ? » que sur les comptes de tiers, et propose les tiers connus", async () => {
      await create(['entries:view', 'entries:create'], entry({ lines: [receivable(), line(2, 'a2', '0.00', '50.00')] }), [], false, [marie]);
      expect(root.querySelectorAll('mat-select[formcontrolname="thirdPartyId"]')).toHaveLength(1);
      expect(root.textContent).toContain('Qui ?');
    });

    it("conserve le tiers d'une ligne et l'envoie avec elle, sans l'inventer pour les autres lignes", async () => {
      const withParty = entry({ lines: [receivable({ thirdParty: { id: 't1', name: 'Marie Dupont', kind: 'MEMBER' } }), line(2, 'a2', '0.00', '50.00')] });
      await create(['entries:view', 'entries:create'], withParty, [], false, [marie]);
      await click('Enregistrer le brouillon');
      const put = controller.expectOne('/api/entries/e1');
      expect(put.request.body.lines[0].thirdPartyId).toBe('t1');
      expect(put.request.body.lines[1].thirdPartyId).toBeUndefined();
      put.flush(withParty);
      await settle();
    });

    it('une écriture comptabilisée affiche le nom du tiers de ses lignes', async () => {
      const posted = entry({ status: 'POSTED', number: 3, lines: [receivable({ thirdParty: { id: 't1', name: 'Marie Dupont', kind: 'MEMBER' } }), line(2, 'a2', '0.00', '50.00')] });
      await create(['entries:view'], posted);
      expect(root.querySelector('table')!.textContent).toContain('Marie Dupont');
    });

    it('ajoute un tiers depuis l’écran, sans quitter l’écriture, et le propose aussitôt', async () => {
      await create(['entries:view', 'entries:create'], entry({ lines: [receivable(), line(2, 'a2', '0.00', '50.00')] }));
      await click('Ajouter un tiers');
      controller.expectOne('/api/members').flush({ members: [], next: null });
      controller.expectOne('/api/funders').flush([]);
      await settle();
      expect(ui.title).toBe('Ajouter un tiers');
      expect(ui.text).toContain('savoir, plus tard, qui vous doit quoi');
      await ui.type('input[formcontrolname="name"]', 'Imprimerie Martin');
      await ui.submit();
      const post = controller.expectOne('/api/third-parties');
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ kind: 'SUPPLIER', name: 'Imprimerie Martin' });
      post.flush({ id: 't9', kind: 'SUPPLIER', name: 'Imprimerie Martin', memberId: null, funderId: null, note: '', archived: false }, { status: 201, statusText: 'Created' });
      await settle();
      expect(ui.snackbar).toContain('« Imprimerie Martin » ajouté aux tiers');
    });

    it("explique le refus du serveur (doublon) et garde la boîte ouverte", async () => {
      await create(['entries:view', 'entries:create']);
      await click('Ajouter un tiers');
      controller.expectOne('/api/members').flush({ members: [], next: null });
      controller.expectOne('/api/funders').flush([]);
      await settle();
      await ui.type('input[formcontrolname="name"]', 'Imprimerie Martin');
      await ui.submit();
      controller.expectOne('/api/third-parties').flush({ message: '« Imprimerie Martin » existe déjà dans vos tiers.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(ui.error).toContain('existe déjà');
      expect(ui.isOpen).toBe(true);
    });

    it("n'offre pas d'ajouter un tiers sans le droit de saisir", async () => {
      await create(['entries:view']);
      expect(root.textContent).not.toContain('Ajouter un tiers');
    });
  });

  it('sans droit de comptabiliser, ni bouton Comptabiliser ni Contrepasser', async () => {
    await create(['entries:view', 'entries:create'], entry({ status: 'POSTED', number: 3 }));
    expect(root.textContent).not.toContain('Contrepasser');
  });
});
