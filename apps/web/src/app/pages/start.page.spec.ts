import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { StartPage } from './start.page';
import { endOfTwelveMonths, yearLabel } from './start-dialogs';

const setup = (
  done: Partial<Record<'fiscalYear' | 'categories' | 'financialAccount', boolean>> & { startMode?: 'HISTORY' | 'OPENING' | null; openingSituation?: 'NONE' | 'DRAFT' | 'POSTED' } = {},
) => ({
  setup: { fiscalYear: false, accounts: false, financialAccount: false, categories: false, startMode: 'HISTORY', openingSituation: 'NONE', ...done },
  cash: null,
  month: null,
  todo: [],
});

describe('Aides de la période', () => {
  it('calcule le dernier jour d’une période de 12 mois, y compris à cheval sur deux années et en année bissextile', () => {
    expect(endOfTwelveMonths('2026-01-01')).toBe('2026-12-31');
    expect(endOfTwelveMonths('2026-09-01')).toBe('2027-08-31');
    expect(endOfTwelveMonths('2027-03-01')).toBe('2028-02-29');
    expect(endOfTwelveMonths('pas une date')).toBe('');
  });

  it('nomme l’exercice d’après ses années', () => {
    expect(yearLabel('2026-01-01', '2026-12-31')).toBe('Exercice 2026');
    expect(yearLabel('2026-09-01', '2027-08-31')).toBe('Exercice 2026-2027');
  });
});

describe('StartPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<StartPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const loads = async (overview: object, accounts: object[] = [], years: object[] = []) => {
    controller.expectOne('/api/overview').flush(overview);
    controller.expectOne('/api/financial-accounts').flush(accounts);
    controller.expectOne('/api/fiscal-years').flush(years);
    await settle();
  };
  const create = async (overview: object, accounts: object[] = [], years: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [StartPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['settings.accounting:admin']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StartPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    await loads(overview, accounts, years);
  };
  const stepButtons = () => Array.from(root.querySelectorAll<HTMLButtonElement>('ol.steps li:not(:first-child) button'));
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes(label));
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('déroule quatre étapes dans l’ordre : une étape ne se débloque qu’une fois la précédente faite', async () => {
    await create(setup());
    expect(root.querySelector('h1')!.textContent).toContain('Démarrer');
    expect(root.querySelectorAll('ol.steps li').length).toBe(4);
    const buttons = stepButtons();
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true]);
    expect(root.textContent).toContain('Terminez d’abord l’étape précédente');
    expect(root.textContent).not.toContain('Tout est prêt');
  });

  it('crée la période en douze mois par défaut, puis recharge et débloque l’étape suivante', async () => {
    await create(setup());
    await click('Définir la période');
    expect(ui.title).toBe('La période de votre comptabilité');
    expect(ui.text).toContain('exercice');
    await ui.type('input[formcontrolname="start"]', '2026-09-01');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="end"]').value).toBe('2027-08-31');
    await ui.submit();
    const request = controller.expectOne('/api/fiscal-years');
    expect(request.request.body).toEqual({ label: 'Exercice 2026-2027', start: '2026-09-01', end: '2027-08-31' });
    request.flush({ id: 'y1', label: 'Exercice 2026-2027', start: '2026-09-01', end: '2027-08-31', status: 'OPEN' }, { status: 201, statusText: 'Created' });
    await settle();
    await loads(setup({ fiscalYear: true }));
    expect(ui.snackbar).toContain('Période enregistrée');
    const buttons = stepButtons();
    // L'étape faite n'a plus de bouton ; la suivante est ouverte, la dernière reste verrouillée.
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
  });

  it('installe les catégories seulement après confirmation, en disant que rien n’est écrasé', async () => {
    await create(setup({ fiscalYear: true }));
    await click('Installer les catégories');
    expect(ui.title).toContain('Installer les catégories de départ');
    expect(ui.text).toContain('Rien n’est écrasé');
    await ui.click('Installer');
    const request = controller.expectOne('/api/starter-template');
    expect(request.request.method).toBe('POST');
    request.flush({ accountsCreated: 23, categoriesCreated: 16 });
    await settle();
    await loads(setup({ fiscalYear: true, categories: true }));
    expect(ui.snackbar).toContain('16 catégorie(s)');
  });

  it('ajoute le compte bancaire en réutilisant le compte 512 libre du plan, sans le demander à la personne', async () => {
    await create(setup({ fiscalYear: true, categories: true }));
    await click('Ajouter mon compte');
    expect(ui.title).toBe('Ajouter un compte bancaire ou une caisse');
    await ui.type('input[formcontrolname="name"]', 'Compte courant');
    await ui.type('input[formcontrolname="openingBalance"]', '1250,00');
    await ui.submit();
    controller.expectOne('/api/accounts').flush([
      { id: 'a512', number: '512', label: 'Banque', active: true, reportLine: null },
      { id: 'a530', number: '530', label: 'Caisse', active: true, reportLine: null },
    ]);
    await settle();
    const request = controller.expectOne('/api/financial-accounts');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ name: 'Compte courant', type: 'BANK', accountId: 'a512', openingBalance: '1250.00' });
    request.flush({ id: 'f1', name: 'Compte courant', type: 'BANK', accountId: 'a512', accountNumber: '512', journalCode: 'BQ-1', balances: {} }, { status: 201, statusText: 'Created' });
    await settle();
    await loads(setup({ fiscalYear: true, categories: true, financialAccount: true }), [{ id: 'f1', accountId: 'a512', name: 'Compte courant' }]);
    expect(root.textContent).toContain('Tout est prêt');
    expect(root.querySelector('a[href="/vue-d-ensemble"]')).not.toBeNull();
  });

  it('pour un deuxième compte bancaire, crée le compte du plan suivant (5121) au lieu de réutiliser le 512 déjà pris', async () => {
    await create(setup({ fiscalYear: true, categories: true, financialAccount: true }), [{ id: 'f1', accountId: 'a512', name: 'Compte courant' }]);
    await click('Ajouter un autre compte');
    await ui.type('input[formcontrolname="name"]', 'Livret');
    await ui.submit();
    controller.expectOne('/api/accounts').flush([{ id: 'a512', number: '512', label: 'Banque', active: true, reportLine: null }]);
    await settle();
    const created = controller.expectOne('/api/accounts');
    expect(created.request.method).toBe('POST');
    expect(created.request.body).toEqual({ number: '5121', label: 'Banque — Livret' });
    created.flush({ id: 'a5121', number: '5121', label: 'Banque — Livret', active: true, reportLine: null }, { status: 201, statusText: 'Created' });
    await settle();
    expect(controller.expectOne('/api/financial-accounts').request.body).toMatchObject({ accountId: 'a5121', type: 'BANK' });
  });

  describe('mode de démarrage', () => {
    it('demande d’abord comment on commence : la période reste verrouillée tant que le mode n’est pas choisi', async () => {
      await create(setup({ startMode: null }));
      expect(root.querySelector('ol.steps li')!.textContent).toContain('Comment commencez-vous ?');
      expect(root.querySelector('ol.steps li')!.textContent).toContain('recommandée si vous n’avez pas de relevés anciens');
      expect(stepButtons().map((b) => b.disabled)).toEqual([true, true, true]);
      expect(Array.from(root.querySelectorAll('ol.steps li:first-child button')).map((b) => b.textContent!.trim())).toEqual([
        'Je pars d’une situation de départ',
        'Je reprends mon historique',
      ]);
    });

    it('enregistre le choix puis affiche l’étape « situation de départ » à la fin du parcours', async () => {
      await create(setup({ startMode: null }));
      await click('Je pars d’une situation de départ');
      const request = controller.expectOne('/api/start-mode');
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ mode: 'OPENING' });
      request.flush({ mode: 'OPENING' });
      await settle();
      await loads(setup({ startMode: 'OPENING' }));
      expect(ui.snackbar).toContain('situation de départ');
      expect(root.querySelectorAll('ol.steps li').length).toBe(5);
      expect(root.querySelector('ol.steps li:last-child')!.textContent).toContain('Votre situation de départ');
    });

    it('explique pourquoi le changement de mode est refusé, sans rien perdre', async () => {
      await create(setup({ startMode: 'HISTORY', fiscalYear: true }));
      await click('Je pars d’une situation de départ');
      controller.expectOne('/api/start-mode').flush({ message: 'Une reprise de l’historique est déjà commencée.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(root.querySelector('[role="alert"]')!.textContent).toContain('déjà commencée');
    });

    it('ne bloque pas « Tout est prêt » pour une installation commencée avant le choix du mode', async () => {
      await create(setup({ startMode: null, fiscalYear: true, categories: true, financialAccount: true }));
      expect(root.textContent).toContain('Tout est prêt');
    });

    it('propose la date de départ du premier exercice aux nouveaux comptes quand on repart d’une situation', async () => {
      await create(setup({ startMode: 'OPENING', fiscalYear: true, categories: true }), [], [{ id: 'y1', label: 'Exercice 2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' }]);
      await click('Ajouter mon compte');
      expect(ui.field<HTMLInputElement>('input[formcontrolname="openedOn"]').value).toBe('2026-01-01');
    });
  });

  describe('situation de départ', () => {
    const situation = (overrides: object = {}) => ({
      mode: 'OPENING',
      date: '2026-01-01',
      accounts: [
        { id: 'f1', name: 'Banque', openedOn: '2026-01-01', openingBalance: '1000.00' },
        { id: 'f2', name: 'Caisse', openedOn: '2026-01-01', openingBalance: '50.00' },
      ],
      misaligned: [],
      kinds: [
        { key: 'MEMBERSHIP_DUE', side: 'RECEIVABLE', label: 'Cotisation ou participation pas encore reçue', hint: '', available: true },
        { key: 'SUPPLIER_OWED', side: 'PAYABLE', label: 'Facture reçue, pas encore payée', hint: '', available: true },
      ],
      equityAccounts: [{ id: 'a102', number: '102', label: 'Fonds associatifs' }],
      suggestedEquityAccountId: 'a102',
      existing: null,
      fiscalYear: true,
      ...overrides,
    });
    const parties = [{ id: 't1', kind: 'MEMBER', name: 'Marie Dupont', memberId: 'm1', funderId: null, note: '', archived: false }];
    const open = async (view: object = situation()) => {
      await create(setup({ startMode: 'OPENING', fiscalYear: true, categories: true, financialAccount: true }), [{ id: 'f1', accountId: 'a5121', name: 'Banque' }]);
      await click('Indiquer ma situation');
      controller.expectOne('/api/opening-situation').flush(view);
      await settle();
      controller.expectOne('/api/third-parties').flush(parties);
      await settle();
    };

    it('reprend l’argent des comptes, calcule le fonds et montre ce que verra l’expert-comptable', async () => {
      await open();
      expect(ui.title).toBe('Votre situation de départ');
      expect(ui.text).toContain('au 01/01/2026');
      expect(ui.text).toContain('Banque');
      expect(ui.text).toContain('1 000,00 €');
      expect(ui.text).toContain('Total de l’argent');
      expect(ui.text).toContain('1 050,00 €');
      expect(ui.text).toContain('Ce que verra l’expert-comptable');
      expect(ui.text).toContain('Les deux totaux sont égaux');
    });

    it('recalcule le fonds quand on ajoute ce qu’on nous doit et ce qu’on doit, puis envoie ce que la personne a lu', async () => {
      await open();
      await ui.click('Ajouter une somme qu’on me doit');
      const rows = () => Array.from(ui.dialog!.querySelectorAll('[formarrayname="receivables"] .item'));
      expect(rows()).toHaveLength(1);
      const receivable = rows()[0]!;
      const set = async (root: Element, name: string, value: string) => {
        const input = root.querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await settle();
      };
      await set(receivable, 'label', 'Marie Dupont');
      await set(receivable, 'amount', '30,00');
      await ui.click('Ajouter une somme que je dois');
      const payable = ui.dialog!.querySelector('[formarrayname="payables"] .item')!;
      await set(payable, 'label', 'Imprimeur');
      await set(payable, 'amount', '120');
      expect(ui.text).toContain('960,00 €');
      await ui.type('input[formcontrolname="explanation"]', 'Fonds apportés à la création');

      await ui.submit();
      const request = controller.expectOne('/api/opening-situation');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        date: '2026-01-01',
        receivables: [{ kind: 'MEMBERSHIP_DUE', label: 'Marie Dupont', amount: '30.00' }],
        payables: [{ kind: 'SUPPLIER_OWED', label: 'Imprimeur', amount: '120.00' }],
        equityAmount: '960.00',
        equityAccountId: 'a102',
        explanation: 'Fonds apportés à la création',
      });
      request.flush({ entryId: 'e1', posted: true, journalCode: 'AN', number: 1, equity: '960.00', lines: 5 }, { status: 201, statusText: 'Created' });
      await settle();
      await loads(setup({ startMode: 'OPENING', fiscalYear: true, categories: true, financialAccount: true, openingSituation: 'POSTED' }));
      expect(ui.snackbar).toContain('Situation de départ enregistrée dans les comptes');
      expect(root.textContent).toContain('Tout est prêt');
    });

    it('envoie la fiche tiers choisie au lieu d’un nom, sans ressaisie', async () => {
      await open();
      await ui.click('Ajouter une somme qu’on me doit');
      await ui.choose('mat-select[formcontrolname="thirdPartyId"]', 'Marie Dupont');
      // Une fois une fiche choisie, le champ « Nom » disparaît.
      expect(ui.dialog!.querySelector('[formarrayname="receivables"] input[formcontrolname="label"]')).toBeNull();
      const amount = ui.dialog!.querySelector<HTMLInputElement>('[formarrayname="receivables"] input[formcontrolname="amount"]')!;
      amount.value = '30';
      amount.dispatchEvent(new Event('input'));
      await settle();
      await ui.type('input[formcontrolname="explanation"]', 'Fonds apportés à la création');
      await ui.submit();
      const request = controller.expectOne('/api/opening-situation');
      expect(request.request.body.receivables).toEqual([{ kind: 'MEMBERSHIP_DUE', thirdPartyId: 't1', amount: '30.00' }]);
      request.flush({ entryId: 'e1', posted: true, journalCode: 'AN', number: 1, equity: '1080.00', lines: 4 }, { status: 201, statusText: 'Created' });
      await settle();
      await loads(setup({ startMode: 'OPENING', fiscalYear: true, categories: true, financialAccount: true, openingSituation: 'POSTED' }));
    });

    it('demande d’où vient le fonds, et garde la boîte ouverte sans appeler le serveur', async () => {
      await open();
      await ui.submit();
      expect(ui.error).toContain('où ranger le fonds');
      controller.expectNone('/api/opening-situation');
      expect(ui.isOpen).toBe(true);
    });

    it('refuse une ligne incomplète avec une phrase claire', async () => {
      await open();
      await ui.click('Ajouter une somme qu’on me doit');
      await ui.type('input[formcontrolname="explanation"]', 'Fonds apportés à la création');
      await ui.submit();
      expect(ui.error).toContain('une personne (choisie ou nommée)');
      controller.expectNone('/api/opening-situation');
    });

    it('bloque et explique quand un compte n’est pas daté comme la situation', async () => {
      await open(situation({ misaligned: [{ id: 'f2', name: 'Caisse', openedOn: '2026-03-01' }] }));
      expect(ui.dialog!.querySelector('.alert')!.textContent).toContain('« Caisse »');
      expect(ui.dialog!.querySelector('.alert')!.textContent).toContain('même date');
      await ui.submit();
      expect(ui.error).toContain('Alignez d’abord');
      controller.expectNone('/api/opening-situation');
    });

    it('garde les saisies et affiche le motif quand le serveur refuse', async () => {
      await open();
      await ui.type('input[formcontrolname="explanation"]', 'Fonds apportés à la création');
      await ui.submit();
      controller.expectOne('/api/opening-situation').flush({ message: 'Aucun exercice ne couvre le 01/01/2026.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(ui.error).toContain('Aucun exercice');
      expect(ui.isOpen).toBe(true);
      expect(ui.field<HTMLInputElement>('input[formcontrolname="explanation"]').value).toBe('Fonds apportés à la création');
    });

    it('n’offre pas les lignes dont le compte manque au plan', async () => {
      await open(situation({ kinds: [{ key: 'MEMBERSHIP_DUE', side: 'RECEIVABLE', label: 'x', hint: '', available: false }] }));
      expect(ui.button('Ajouter une somme qu’on me doit').disabled).toBe(true);
      expect(ui.text).toContain('installez les catégories de départ');
    });

    it('dit qu’une situation en brouillon attend sa validation, au lieu de proposer de la refaire', async () => {
      await create(setup({ startMode: 'OPENING', fiscalYear: true, categories: true, financialAccount: true, openingSituation: 'DRAFT' }));
      expect(root.textContent).toContain('pas encore enregistrée dans les comptes');
      expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Indiquer ma situation'))).toBe(false);
    });
  });
});
