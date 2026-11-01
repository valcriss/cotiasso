import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { AccountsPage } from './accounts.page';

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
  version: 1,
  ...overrides,
});

describe('AccountsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<AccountsPage>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], accounts: object[] = [account()]) => {
    await TestBed.configureTestingModule({
      imports: [AccountsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountsPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/financial-accounts').flush(accounts);
    await settle();
    controller.expectOne('/api/accounts').flush(chart);
    await settle();
    controller.expectOne('/api/projects').flush([]);
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
  const type = (selector: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const openTransactions = async (list: object[] = [transaction()]) => {
    await click('Ouvrir Compte courant');
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: list, next: null });
    await settle();
  };

  afterEach(() => controller.verify());

  it("affiche chaque solde séparément et l'écart de relevé, sans parler de rapprochement", async () => {
    await create(['financial-accounts:view']);
    const text = root.textContent!;
    expect(text).toContain('Compte courant');
    expect(text).toContain('BQ-1');
    expect(text).toContain('969,50');
    expect(text).toContain('Solde comptable (écritures)');
    expect(text).toContain('400,00');
    expect(text).toContain('Relevé au 2026-03-31');
    expect(text).toContain('-19,50');
    expect(text.toLowerCase()).not.toContain('rapproché');
    expect(text).not.toContain('Nouveau compte');
  });

  it('crée un compte avec un compte de trésorerie libre uniquement', async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin']);
    await click('Nouveau compte');
    // 512 est déjà utilisé, 411 et 706 ne sont pas de classe 5 : seule la caisse 530 est proposée.
    const options = (fixture.componentInstance as unknown as { freeAccounts(): { number: string }[] }).freeAccounts();
    expect(options.map((a) => a.number)).toEqual(['530']);

    type('input[formcontrolname="name"]', 'Caisse');
    type('input[formcontrolname="openedOn"]', '2026-01-01');
    type('input[formcontrolname="openingBalance"]', '50,5');
    (fixture.componentInstance as unknown as { form: { patchValue(v: object): void } }).form.patchValue({ type: 'CASH', accountId: 'a530' });
    await settle();
    await click('Créer le compte');

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
    expect(root.querySelector('[role="status"]')!.textContent).toContain('journal CA-1');
  });

  it('affiche le refus du serveur lors de la création', async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin']);
    await click('Nouveau compte');
    type('input[formcontrolname="name"]', 'X');
    type('input[formcontrolname="openedOn"]', '2026-01-01');
    (fixture.componentInstance as unknown as { form: { patchValue(v: object): void } }).form.patchValue({ accountId: 'a530' });
    await settle();
    await click('Créer le compte');
    controller
      .expectOne('/api/financial-accounts')
      .flush({ message: 'Le compte 530 est déjà utilisé par « Caisse ».' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('déjà utilisé');
  });

  it('enregistre un solde de relevé, avec le signe saisi', async () => {
    await create(['financial-accounts:view', 'imports:post']);
    await click('Relevé de Compte courant');
    type('input[formcontrolname="periodStart"]', '2026-04-01');
    type('input[formcontrolname="periodEnd"]', '2026-04-30');
    type('input[formcontrolname="closingBalance"]', '-120,40');
    await settle();
    await click('Enregistrer le solde');
    const post = controller.expectOne('/api/financial-accounts/f1/statements');
    expect(post.request.body).toEqual({ periodStart: '2026-04-01', periodEnd: '2026-04-30', closingBalance: '-120.40' });
    post.flush({}, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account()]);
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Solde de relevé enregistré');
  });

  it('archive un compte', async () => {
    await create(['financial-accounts:view', 'settings.accounting:admin']);
    await click('Archiver Compte courant');
    const patch = controller.expectOne('/api/financial-accounts/f1');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ archived: true });
    patch.flush(account({ archivedOn: '2026-11-01' }));
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account({ archivedOn: '2026-11-01' })]);
    await settle();
    expect(root.textContent).toContain('Archivé');
  });

  it('liste les transactions du compte avec leur sens et leur état de qualification', async () => {
    await create(['financial-accounts:view']);
    await openTransactions([
      transaction(),
      transaction({ id: 't2', amount: '100.00', label: 'Cotisations', counterpartAccountNumber: '706', qualified: true, projectCode: 'ATELIERS', origin: 'IMPORT', bankIdentified: true, externalId: 'FIT-2' }),
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

  it('ajoute un décaissement : le montant est envoyé signé et les soldes rechargés', async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([]);
    await click('Ajouter une transaction');
    (fixture.componentInstance as unknown as { selected(): unknown }).selected();
    const panel = root.querySelector('app-transactions-panel')!;
    expect(panel).toBeTruthy();
    type('input[formcontrolname="amount"]', '12,5');
    type('input[formcontrolname="operationDate"]', '2026-05-02');
    type('input[formcontrolname="label"]', 'Courses');
    await settle();
    // Sens « décaissement » : le formulaire est piloté par le composant du panneau.
    const instance = (fixture.debugElement.query((d) => d.name === 'app-transactions-panel').componentInstance) as {
      form: { patchValue(v: object): void };
    };
    instance.form.patchValue({ direction: 'out' });
    await settle();
    await click('Enregistrer');

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
    controller.expectOne('/api/financial-accounts').flush([account()]);
    await settle();
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: [transaction({ amount: '-12.50' })], next: null });
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Transaction ajoutée');
  });

  it('refuse un montant nul ou invalide sans appeler le serveur', async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([]);
    await click('Ajouter une transaction');
    type('input[formcontrolname="amount"]', '0');
    type('input[formcontrolname="operationDate"]', '2026-05-02');
    type('input[formcontrolname="label"]', 'Rien');
    await settle();
    await click('Enregistrer');
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('montant positif');
  });

  it("une transaction importée n'envoie que sa qualification à la modification", async () => {
    await create(['financial-accounts:view', 'transactions:manage']);
    await openTransactions([transaction({ origin: 'IMPORT', externalId: 'FIT-1', bankIdentified: true })]);
    await click('Modifier Frais');
    await click('Enregistrer');
    const patch = controller.expectOne('/api/transactions/t1');
    expect(patch.request.body.amount).toBeUndefined();
    expect(patch.request.body.operationDate).toBeUndefined();
    expect(patch.request.body.version).toBe(1);
    patch.flush(transaction({ origin: 'IMPORT', version: 2 }));
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account()]);
    await settle();
    controller.expectOne((r) => r.url === '/api/financial-accounts/f1/transactions').flush({ transactions: [], next: null });
    await settle();
  });
});
