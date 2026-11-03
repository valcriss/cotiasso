import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { mockAuth } from '../testing/auth-mock';
import { AccountingPage, parseAccountCsv } from './accounting.page';

const year = { id: 'y1', label: 'Exercice 2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' };
const journal = { id: 'j1', code: 'OD', label: 'Opérations diverses', type: 'MISC', active: true };
const account = { id: 'a1', number: '512', label: 'Banque', active: true, reportLine: null };

describe('AccountingPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<AccountingPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const flushLists = async (accounts: object[] = [account], rules = { projectRequired: true }) => {
    controller.expectOne('/api/fiscal-years').flush([year]);
    controller.expectOne('/api/journals').flush([journal]);
    controller.expectOne('/api/accounts').flush(accounts);
    controller.expectOne('/api/accounting/settings').flush(rules);
    await settle();
  };
  const create = async (permissions: string[], categories: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [AccountingPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountingPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/operation-categories/all').flush(categories);
    await flushLists();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('affiche exercices, journaux et comptes en lecture seule sans le droit d’administrer', async () => {
    await create(['entries:view']);
    const text = root.textContent!;
    expect(text).toContain('Exercice 2026');
    expect(text).toContain('Opérations diverses');
    expect(text).toContain('Banque');
    expect(text).toContain('mais pas la modifier');
    expect(text).toContain('Ouvert');
    expect(root.querySelector('app-action-bar button')).toBeNull();
    expect(root.querySelector('input[type="file"]')).toBeNull();
  });

  it('guide vers les catégories de départ quand il n’y en a pas encore, puis les installe après confirmation', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    expect(root.textContent).toContain('Aucune catégorie pour l’instant');
    await click('Installer les catégories de départ');
    expect(ui.title).toContain('Installer les catégories de départ');
    expect(ui.text).toContain('à faire relire par votre expert-comptable');
    await ui.click('Installer');
    const post = controller.expectOne('/api/starter-template');
    expect(post.request.method).toBe('POST');
    post.flush({ accountsCreated: 23, categoriesCreated: 16 });
    await settle();
    controller.expectOne('/api/operation-categories/all').flush([
      { id: 'c1', direction: 'OUT', label: 'Assurance', hint: 'Prime annuelle', active: true, account: { id: 'a616', number: '616', label: 'Primes d’assurance' } },
    ]);
    await settle();
    controller.expectOne('/api/fiscal-years').flush([year]);
    controller.expectOne('/api/journals').flush([journal]);
    controller.expectOne('/api/accounts').flush([account]);
    controller.expectOne('/api/accounting/settings').flush({ projectRequired: true });
    await settle();
    expect(ui.snackbar).toContain('16 catégorie(s)');
    expect(root.textContent).toContain('Assurance');
    expect(root.textContent).toContain('616 — Primes d’assurance');
  });

  it('propose de retrouver l’assistant « Démarrer » (réglages de départ) à qui peut administrer la comptabilité (#10)', async () => {
    await create(['settings.accounting:admin', 'entries:view']);
    const link = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('Réglages de départ'))!;
    expect(link.getAttribute('href')).toBe('/demarrage');
    TestBed.resetTestingModule();
    await create(['entries:view']);
    expect(Array.from(root.querySelectorAll('a')).some((a) => a.textContent!.includes('Réglages de départ'))).toBe(false);
  });

  it('propose les créations dans la barre d’action et explique chaque partie', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    const buttons = Array.from(root.querySelectorAll('app-action-bar button')).map((b) => b.textContent!.trim());
    expect(buttons.join('|')).toContain('Nouvel exercice');
    expect(buttons.join('|')).toContain('Nouveau journal');
    expect(buttons.join('|')).toContain('Nouveau compte');
    expect(buttons.join('|')).toContain('Importer un plan');
    expect(root.querySelector('app-action-bar .help')!.textContent).toContain('exercices (périodes comptables)');
  });

  it('affiche l’obligation de projet sans permettre de la modifier sans droit', async () => {
    await create(['entries:view']);
    const box = root.querySelector<HTMLInputElement>('mat-checkbox input')!;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('désactive l’obligation de projet avec settings.accounting:admin, et confirme par un bandeau', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    root.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    await settle();
    const put = controller.expectOne('/api/accounting/settings');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ projectRequired: false });
    put.flush({ changed: true, value: { projectRequired: false } });
    await settle();
    await flushLists([account], { projectRequired: false });
    expect(ui.snackbar).toContain("n'est plus obligatoire");
  });

  it('crée un exercice dans une boîte de dialogue puis recharge les listes', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    await click('Nouvel exercice');
    expect(ui.title).toBe('Nouvel exercice comptable');
    expect(ui.text).toContain('la période sur laquelle vous arrêtez vos comptes');
    await ui.type('input[formcontrolname="label"]', 'Exercice 2027');
    await ui.type('input[formcontrolname="start"]', '2027-01-01');
    await ui.type('input[formcontrolname="end"]', '2027-12-31');
    await ui.submit();

    const request = controller.expectOne('/api/fiscal-years');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ label: 'Exercice 2027', start: '2027-01-01', end: '2027-12-31' });
    request.flush({ ...year, id: 'y2' }, { status: 201, statusText: 'Created' });
    await settle();
    await flushLists();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('créé.');
  });

  it('affiche le refus du serveur dans la boîte, par exemple un chevauchement, sans perdre la saisie', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    await click('Nouvel exercice');
    await ui.type('input[formcontrolname="label"]', 'X');
    await ui.type('input[formcontrolname="start"]', '2026-06-01');
    await ui.type('input[formcontrolname="end"]', '2027-06-01');
    await ui.submit();
    controller
      .expectOne('/api/fiscal-years')
      .flush({ message: "Ces dates chevauchent l'exercice « Exercice 2026 »." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('chevauchent');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="start"]').value).toBe('2026-06-01');
  });

  it('crée un journal et un compte, avec des aides en langage courant', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    await click('Nouveau journal');
    expect(ui.text).toContain("Un journal est un cahier dans lequel on classe les écritures");
    await ui.type('input[formcontrolname="code"]', 'VT');
    await ui.type('input[formcontrolname="label"]', 'Ventes');
    await ui.choose('mat-select[formcontrolname="type"]', 'Produits (ventes');
    await ui.submit();
    const journalRequest = controller.expectOne('/api/journals');
    expect(journalRequest.request.body).toEqual({ code: 'VT', label: 'Ventes', type: 'REVENUE' });
    journalRequest.flush({ ...journal, id: 'j2', code: 'VT' }, { status: 201, statusText: 'Created' });
    await settle();
    await flushLists();
    expect(ui.snackbar).toContain('Journal VT créé');

    await click('Nouveau compte');
    expect(ui.text).toContain('6 charges (ce que vous dépensez)');
    await ui.type('input[formcontrolname="number"]', '12');
    await ui.type('input[formcontrolname="label"]', 'Trop court');
    await ui.submit();
    expect(ui.text).toContain('3 à 8 chiffres');
    await ui.type('input[formcontrolname="number"]', '706');
    await ui.submit();
    const accountRequest = controller.expectOne('/api/accounts');
    expect(accountRequest.request.body).toEqual({ number: '706', label: 'Trop court' });
    accountRequest.flush({ id: 'a2', number: '706', label: 'Trop court', active: true, reportLine: null }, { status: 201, statusText: 'Created' });
    await settle();
    await flushLists();
    expect(ui.snackbar).toContain('Compte 706 créé');
  });

  it('désactive un compte directement depuis la liste', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    await click('Désactiver 512');
    const patch = controller.expectOne('/api/accounts/a1');
    expect(patch.request.body).toEqual({ active: false });
    patch.flush({ ...account, active: false });
    await settle();
    await flushLists([{ ...account, active: false }]);
    expect(ui.snackbar).toContain('Compte 512 désactivé');
  });

  it('filtre le plan de comptes et guide quand rien ne correspond', async () => {
    await create(['entries:view']);
    const filterInput = root.querySelector<HTMLInputElement>('section[aria-labelledby="ac-title"] input')!;
    filterInput.value = 'zzz';
    filterInput.dispatchEvent(new Event('input'));
    await settle();
    expect(root.textContent).toContain('Aucun compte ne correspond à ce filtre');
  });

  it('ouvre la clôture d’un exercice dans une boîte de dialogue (droit fiscal-years:close)', async () => {
    await create(['entries:view', 'fiscal-years:close']);
    await click('Clôture de Exercice 2026');
    controller.expectOne('/api/fiscal-years/y1/closing').flush({
      fiscalYearId: 'y1',
      status: 'OPEN',
      checks: [{ code: 'NO_NEXT_YEAR', level: 'BLOCKING', message: "Créez l'exercice suivant." }],
      canStart: false,
      canClose: false,
      preview: { accountCount: 2, result: { kind: 'SURPLUS', amount: '181.00' } },
    });
    await settle();
    expect(ui.title).toBe("Clôture de l'exercice Exercice 2026");
    expect(ui.text).toContain("Créez l'exercice suivant.");
    expect(ui.button('Fermer à la saisie').disabled).toBe(true);
    ui.dialog!.querySelector<HTMLButtonElement>('.mat-mdc-dialog-actions button')!.click();
    await settle();
    await flushLists();
    expect(ui.isOpen).toBe(false);
  });
});

describe('parseAccountCsv', () => {
  it('lit « numéro;libellé », ignore l’en-tête et les lignes vides', () => {
    const result = parseAccountCsv('Numéro;Libellé\r\n512;Banque\r\n\r\n"530";"Caisse"\r\n706\tPrestations');
    expect(result.errors).toEqual([]);
    expect(result.accounts).toEqual([
      { number: '512', label: 'Banque' },
      { number: '530', label: 'Caisse' },
      { number: '706', label: 'Prestations' },
    ]);
  });

  it('signale les numéros invalides et les libellés manquants avec leur numéro de ligne', () => {
    const result = parseAccountCsv('512;Banque\n12;Trop court\n530;\n9;X');
    expect(result.accounts).toEqual([{ number: '512', label: 'Banque' }]);
    expect(result.errors).toEqual([
      'Ligne 2 : numéro « 12 » invalide.',
      'Ligne 3 : libellé manquant.',
      'Ligne 4 : numéro « 9 » invalide.',
    ]);
  });

  it('conserve les libellés contenant un point-virgule après le premier séparateur', () => {
    expect(parseAccountCsv('601;Achats; matières').accounts).toEqual([{ number: '601', label: 'Achats; matières' }]);
  });
});
