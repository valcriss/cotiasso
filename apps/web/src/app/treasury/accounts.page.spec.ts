import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { mockAuth } from '../testing/auth-mock';
import { AccountsPage } from './accounts.page';

@Component({ template: '' })
class EntryStub {}

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'Compte courant',
  type: 'BANK',
  currency: 'EUR',
  reference: null,
  accountId: 'a512',
  accountNumber: '512',
  journalId: 'j1',
  journalCode: 'BQ-1',
  openedOn: '2026-01-01',
  archivedOn: null,
  balances: {
    opening: '900.00',
    computed: '969.50',
    accounting: '400.00',
    reconciled: null,
    lastStatement: { periodEnd: '2026-03-31', closingBalance: '950.00', computedAtEnd: '969.50', gap: '-19.50' },
  },
  ...overrides,
});
const chart = [
  { id: 'a512', number: '512', label: 'Banque', active: true, reportLine: null },
  { id: 'a530', number: '530', label: 'Caisse', active: true, reportLine: null },
  { id: 'a411', number: '411', label: 'Usagers', active: true, reportLine: null },
  { id: 'a706', number: '706', label: 'Prestations', active: true, reportLine: null },
];
const transaction = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  financialAccountId: 'f1',
  operationDate: '2026-03-05',
  valueDate: null,
  amount: '-30.50',
  label: 'Frais',
  reference: null,
  origin: 'MANUAL',
  externalId: null,
  bankIdentified: false,
  projectId: null,
  projectCode: null,
  counterpartAccountId: null,
  counterpartAccountNumber: null,
  qualified: false,
  accounting: 'NONE',
  entry: null,
  transfer: null,
  financialLock: null,
  deletable: true,
  version: 1,
  ...overrides,
});

describe('AccountsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<AccountsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], accounts: object[] = [account()]) => {
    await TestBed.configureTestingModule({
      imports: [AccountsPage],
      providers: [provideRouter([{ path: 'comptabilite/ecritures/:id', component: EntryStub }]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/financial-accounts').flush(accounts);
    await settle();
    controller.expectOne('/api/accounts').flush(chart);
    await settle();
    controller.expectOne('/api/projects').flush([]);
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button, a')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    ) as HTMLElement | undefined;
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };
  const openTransactions = async (list: object[] = [transaction()]) => {
    await click('Ouvrir Compte courant');
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: list, next: null });
    await settle();
  };
  const reloadAfterWrite = async (list: object[] = []) => {
    controller.expectOne('/api/financial-accounts').flush([account()]);
    await settle();
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: list, next: null });
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("présente la page et affiche chaque solde séparément, sans présenter le compte comme rapproché", async () => {
    await create(['financial-accounts:view']);
    expect(root.querySelector('h1')!.textContent).toContain('Comptes');
    expect(root.querySelector('.description')!.textContent).toContain('combien il y a dessus');
    const text = root.textContent!;
    expect(text).toContain('Compte courant');
    expect(text).toContain('BQ-1');
    expect(text).toContain('969,50');
    expect(text).toContain('Solde comptable (écritures)');
    expect(text).toContain('Relevé au 2026-03-31');
    expect(text).toContain('-19,50');
    // Un relevé enregistré n'est pas un rapprochement : tant qu'aucun n'est validé, le compte n'est pas dit rapproché.
    expect(text).toContain('Pas encore rapproché');
    expect(text).not.toContain('Rapproché au');
    expect(text).not.toContain('Nouveau compte');
  });

  it("indique « rapproché » seulement pour un rapprochement validé, et propose d'en commencer un", async () => {
    const validated = account({ balances: { ...account().balances, reconciled: { periodEnd: '2026-03-31', closingBalance: '950.00' } } });
    await create(['financial-accounts:view', 'imports:post'], [validated]);
    expect(root.textContent).toContain('Rapproché au 2026-03-31');
    const link = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('Rapprocher'));
    expect(link?.getAttribute('href')).toBe('/comptes/f1/rapprochement');
  });

  it("guide l'utilisateur quand il n'y a aucun compte", async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin'], []);
    expect(root.textContent).toContain('Commençons par votre compte bancaire');
    expect(root.textContent).toContain('Nouveau compte');
  });

  it('crée un compte dans une boîte de dialogue, avec seulement les comptes de trésorerie libres', async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin']);
    await click('Nouveau compte');
    expect(ui.title).toBe('Nouveau compte financier');
    // 512 est déjà utilisé, 411 et 706 ne sont pas de classe 5 : seule la caisse 530 est proposée.
    expect(await ui.options('mat-select[formcontrolname="accountId"]')).toEqual(['530 — Caisse']);

    await ui.type('input[formcontrolname="name"]', 'Caisse');
    await ui.choose('mat-select[formcontrolname="type"]', 'Caisse (espèces)');
    await ui.choose('mat-select[formcontrolname="accountId"]', '530');
    await ui.type('input[formcontrolname="openedOn"]', '2026-01-01');
    await ui.type('input[formcontrolname="openingBalance"]', '50,5');
    await ui.submit();

    const post = controller.expectOne('/api/financial-accounts');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      name: 'Caisse',
      type: 'CASH',
      reference: null,
      accountId: 'a530',
      openedOn: '2026-01-01',
      openingBalance: '50.50',
    });
    post.flush(account({ id: 'f2', name: 'Caisse', type: 'CASH', journalCode: 'CA-1' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account(), account({ id: 'f2', name: 'Caisse', journalCode: 'CA-1' })]);
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('journal CA-1');
  });

  it('explique ce qui manque et garde la boîte ouverte quand le serveur refuse', async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin']);
    await click('Nouveau compte');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    expect(ui.text).toContain('Donnez un nom à ce compte');

    await ui.type('input[formcontrolname="name"]', 'X');
    await ui.choose('mat-select[formcontrolname="accountId"]', '530');
    await ui.type('input[formcontrolname="openedOn"]', '2026-01-01');
    await ui.submit();
    controller
      .expectOne('/api/financial-accounts')
      .flush({ message: 'Le compte 530 est déjà utilisé par « Caisse ».' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('déjà utilisé');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="name"]').value).toBe('X');
  });

  it('enregistre un solde de relevé, avec le signe saisi', async () => {
    await create(['financial-accounts:view', 'imports:post']);
    await click('Relevé de Compte courant');
    expect(ui.title).toBe('Solde du relevé — Compte courant');
    await ui.type('input[formcontrolname="periodStart"]', '2026-04-01');
    await ui.type('input[formcontrolname="periodEnd"]', '2026-04-30');
    await ui.type('input[formcontrolname="closingBalance"]', '-120,40');
    await ui.submit();
    const post = controller.expectOne('/api/financial-accounts/f1/statements');
    expect(post.request.body).toEqual({ periodStart: '2026-04-01', periodEnd: '2026-04-30', closingBalance: '-120.40' });
    post.flush({}, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account()]);
    await settle();
    expect(ui.snackbar).toContain('Solde de relevé enregistré');
  });

  it("demande confirmation avant d'archiver, en expliquant les conséquences", async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin']);
    await click('Archiver Compte courant');
    expect(ui.title).toBe('Archiver « Compte courant » ?');
    expect(ui.text).toContain('ne peut pas être réactivé');
    await ui.click('Annuler');
    controller.expectNone('/api/financial-accounts/f1');

    await click('Archiver Compte courant');
    await ui.click('Archiver');
    const patch = controller.expectOne('/api/financial-accounts/f1');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ archived: true });
    patch.flush(account({ archivedOn: '2026-11-01' }));
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account({ archivedOn: '2026-11-01' })]);
    await settle();
    expect(ui.snackbar).toContain('archivé');
    expect(root.textContent).toContain('Archivé');
  });

  it('liste les transactions du compte avec leur sens et leur état de qualification', async () => {
    await create(['financial-accounts:view']);
    await openTransactions([
      transaction(),
      transaction({ id: 't2', amount: '100.00', label: 'Cotisations', counterpartAccountNumber: '706', qualified: true, projectCode: 'ATELIERS', origin: 'IMPORT', bankIdentified: true, financialLock: 'BANK', deletable: false, externalId: 'FIT-2' }),
    ]);
    const rows = Array.from(root.querySelectorAll('section tbody tr')).map((r) => r.textContent!);
    expect(rows[0]).toContain('-30,50');
    expect(rows[0]).toContain('À qualifier');
    expect(rows[1]).toContain('100,00');
    expect(rows[1]).toContain('706');
    expect(rows[1]).toContain('ATELIERS');
    expect(rows[1]).toContain('Importée');
    expect(root.textContent).not.toContain('Ajouter une transaction');
  });

  it("propose l'import d'un relevé sur sa page dédiée", async () => {
    await create(['financial-accounts:view', 'imports:post']);
    await openTransactions([]);
    const link = Array.from(root.querySelectorAll('a')).find((a) => a.textContent!.includes('Importer un relevé OFX'))!;
    expect(link.getAttribute('href')).toBe('/comptes/f1/import');
  });

  it('ajoute un décaissement : le montant est envoyé signé et les soldes rechargés', async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([]);
    await click('Ajouter une transaction');
    expect(ui.title).toBe('Nouvelle transaction');
    await ui.choose('mat-select[formcontrolname="direction"]', 'Argent dépensé');
    await ui.type('input[formcontrolname="amount"]', '12,5');
    await ui.type('input[formcontrolname="operationDate"]', '2026-05-02');
    await ui.type('input[formcontrolname="label"]', 'Courses');
    await ui.submit();

    const post = controller.expectOne('/api/financial-accounts/f1/transactions');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      operationDate: '2026-05-02',
      amount: '-12.50',
      label: 'Courses',
      reference: null,
      projectId: null,
      counterpartAccountId: null,
    });
    post.flush(transaction({ amount: '-12.50' }), { status: 201, statusText: 'Created' });
    await settle();
    await reloadAfterWrite([transaction({ amount: '-12.50' })]);
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Transaction ajoutée');
  });

  it('refuse un montant nul sans appeler le serveur, avec une explication', async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([]);
    await click('Ajouter une transaction');
    await ui.type('input[formcontrolname="amount"]', '0');
    await ui.type('input[formcontrolname="operationDate"]', '2026-05-02');
    await ui.type('input[formcontrolname="label"]', 'Rien');
    await ui.submit();
    expect(ui.error).toContain('montant supérieur à zéro');
    expect(ui.isOpen).toBe(true);
  });

  it("une transaction identifiée par la banque garde son montant et sa date : seule la qualification est envoyée", async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([transaction({ origin: 'IMPORT', externalId: 'FIT-1', bankIdentified: true, financialLock: 'BANK', deletable: false })]);
    await click('Modifier Frais');
    expect(ui.title).toBe('Modifier la transaction');
    expect(ui.text).toContain('vient de votre relevé bancaire');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').disabled).toBe(true);
    expect(ui.dialog!.textContent).not.toContain('Supprimer cette transaction');
    await ui.submit();

    const patch = controller.expectOne('/api/transactions/t1');
    expect(patch.request.body.amount).toBeUndefined();
    expect(patch.request.body.operationDate).toBeUndefined();
    expect(patch.request.body.version).toBe(1);
    patch.flush(transaction({ origin: 'IMPORT', version: 2 }));
    await settle();
    await reloadAfterWrite([]);
    expect(ui.snackbar).toContain('Transaction enregistrée');
  });

  it("supprime une saisie manuelle après confirmation", async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([transaction()]);
    await click('Modifier Frais');
    await ui.click('Supprimer cette transaction');
    expect(ui.title).toBe('Supprimer cette transaction ?');
    await ui.click('Supprimer');
    const del = controller.expectOne('/api/transactions/t1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await reloadAfterWrite([]);
    expect(ui.snackbar).toContain('Transaction supprimée');
  });

  const entryRef = (overrides: Record<string, unknown> = {}) => ({ id: 'e1', status: 'DRAFT', journalCode: 'BQ-1', number: null, ...overrides });
  const FULL = ['financial-accounts:view', 'transactions:manage', 'entries:create', 'entries:view'];

  it("affiche pour chaque transaction son état de comptabilisation et l'écriture liée", async () => {
    await create(FULL);
    await openTransactions([
      transaction({ id: 't1', label: 'À faire' }),
      transaction({ id: 't2', label: 'En cours', accounting: 'IN_PROGRESS', entry: entryRef(), financialLock: 'ENTRY', deletable: false }),
      transaction({ id: 't3', label: 'Faite', accounting: 'POSTED', entry: entryRef({ id: 'e3', status: 'POSTED', number: 4 }), financialLock: 'ENTRY', deletable: false }),
    ]);
    const text = root.textContent!;
    expect(text).toContain('À comptabiliser');
    expect(text).toContain('En cours de comptabilisation');
    expect(text).toContain('Comptabilisée');
    expect(text).toContain('BQ-1 n° 4');
    expect(text).toContain("une écriture validée enregistre ce mouvement");
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/comptabilite/ecritures/e1');
    expect(links).toContain('/comptabilite/ecritures/e3');
  });

  it("prépare un brouillon d'écriture depuis une transaction puis ouvre l'écriture", async () => {
    await create(FULL);
    await openTransactions([transaction({ counterpartAccountId: 'a706', counterpartAccountNumber: '706', qualified: true })]);
    await click('Comptabiliser Frais');
    const request = controller.expectOne('/api/transactions/t1/entry');
    expect(request.request.method).toBe('POST');
    request.flush({ transaction: transaction({ accounting: 'IN_PROGRESS', entry: entryRef() }), entryId: 'e1' });
    await settle();
    expect(ui.snackbar).toContain("Brouillon d'écriture préparé");
  });

  it("explique quoi faire quand le serveur refuse de préparer (compte de contrepartie manquant)", async () => {
    await create(FULL);
    await openTransactions();
    await click('Comptabiliser Frais');
    controller
      .expectOne('/api/transactions/t1/entry')
      .flush({ message: "Choisissez d'abord le compte de contrepartie de la transaction (modifiez-la)." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('compte de contrepartie');
  });

  it("sans le droit de saisir des écritures, aucune action de liaison n'est proposée", async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions();
    expect(root.textContent).not.toContain('Comptabiliser Frais');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Associer'))).toBe(false);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Nouveau virement'))).toBe(false);
  });

  it("associe une transaction à une écriture existante parmi celles qui correspondent", async () => {
    await create(FULL);
    await openTransactions();
    await click('Associer Frais');
    controller.expectOne('/api/transactions/t1/entry-candidates').flush([
      { id: 'e7', date: '2026-03-05', label: 'Frais de banque', status: 'POSTED', journalCode: 'BQ-1', number: 7 },
    ]);
    await settle();
    expect(ui.title).toBe('Associer à une écriture');
    await ui.choose('mat-select[formcontrolname="entryId"]', 'Frais de banque');
    await ui.submit();
    const link = controller.expectOne('/api/transactions/t1/link');
    expect(link.request.body).toEqual({ entryId: 'e7' });
    link.flush(transaction({ accounting: 'POSTED', entry: entryRef({ id: 'e7', status: 'POSTED', number: 7 }) }));
    await settle();
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: [], next: null });
    await settle();
    expect(ui.snackbar).toContain('associée');
  });

  it("dit qu'aucune écriture ne correspond et renvoie vers « Comptabiliser »", async () => {
    await create(FULL);
    await openTransactions();
    await click('Associer Frais');
    controller.expectOne('/api/transactions/t1/entry-candidates').flush([]);
    await settle();
    expect(ui.text).toContain('Aucune écriture ne correspond');
    expect(ui.text).toContain('Comptabiliser');
    expect(ui.button('Associer').disabled).toBe(true);
  });

  it("dissocie un brouillon après confirmation, en rassurant sur le brouillon", async () => {
    await create(FULL);
    await openTransactions([transaction({ accounting: 'IN_PROGRESS', entry: entryRef(), financialLock: 'ENTRY', deletable: false })]);
    await click('Dissocier Frais');
    expect(ui.text).toContain("n'est pas supprimée");
    await ui.click('Dissocier');
    const request = controller.expectOne('/api/transactions/t1/link');
    expect(request.request.method).toBe('DELETE');
    request.flush(transaction());
    await settle();
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: [], next: null });
    await settle();
    expect(ui.snackbar).toContain('dissociée');
  });

  it("une transaction liée à une écriture explique pourquoi son montant ne change plus", async () => {
    await create(FULL);
    await openTransactions([transaction({ accounting: 'POSTED', entry: entryRef({ status: 'POSTED', number: 2 }), financialLock: 'ENTRY', deletable: false })]);
    await click('Modifier Frais');
    expect(ui.text).toContain('contrepassez');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').disabled).toBe(true);
    expect(ui.dialog!.textContent).not.toContain('Supprimer cette transaction');
  });

  it("enregistre un virement interne : deux comptes, montant positif, brouillon préparé", async () => {
    const savings = account({ id: 'f2', name: 'Livret', accountId: 'a530', accountNumber: '530', journalCode: 'BQ-2' });
    await create(FULL, [account(), savings]);
    await click('Nouveau virement interne');
    expect(ui.title).toBe('Nouveau virement interne');
    expect(ui.text).toContain("Ce n'est ni une dépense ni une recette");

    // Un montant manquant est expliqué sans appeler le serveur.
    await ui.submit();
    expect(ui.error).toContain('compte de départ');
    await ui.choose('mat-select[formcontrolname="toAccountId"]', 'Livret');
    await ui.type('input[formcontrolname="amount"]', '300,00');
    await ui.type('input[formcontrolname="date"]', '2026-03-20');
    await ui.submit();
    const request = controller.expectOne('/api/transfers');
    expect(request.request.body).toEqual({ fromAccountId: 'f1', toAccountId: 'f2', amount: '300.00', date: '2026-03-20', prepareEntry: true });
    request.flush({ id: 'v1', out: transaction(), in: transaction(), entryId: 'e9' }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account(), savings]);
    await settle();
    expect(ui.snackbar).toContain('Virement enregistré');
    expect(ui.snackbar).toContain('relisez-le');
  });

  it("annule un virement après confirmation, tant qu'il n'est lié à aucune écriture", async () => {
    await create(FULL);
    await openTransactions([
      transaction({ transfer: { id: 'v1', direction: 'OUT', otherAccountId: 'f2', otherAccountName: 'Livret' }, financialLock: 'TRANSFER', deletable: false }),
    ]);
    expect(root.textContent).toContain('Virement vers Livret');
    await click('Annuler le virement Frais');
    expect(ui.text).toContain('Livret');
    await ui.click('Annuler le virement');
    const request = controller.expectOne('/api/transfers/v1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await reloadAfterWrite([]);
    expect(ui.snackbar).toContain('Virement annulé');
  });
});
