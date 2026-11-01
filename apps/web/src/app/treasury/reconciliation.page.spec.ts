import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ReconciliationPage } from './reconciliation.page';

const account = {
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
  balances: { opening: '1000.00', computed: '1032.00', accounting: '0.00', reconciled: null, lastStatement: null },
};
const statement = (id: string, periodEnd: string, closingBalance: string) => ({ id, periodStart: '2026-01-01', periodEnd, closingBalance });
const reconciliation = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  financialAccountId: 'f1',
  statementId: 's1',
  periodEnd: '2026-03-31',
  status: 'IN_PROGRESS',
  openingBalance: '1000.00',
  closingBalance: '1020.00',
  pointedCount: 0,
  pointedTotal: '0.00',
  pointedBalance: '1000.00',
  gap: '20.00',
  outstandingCount: 2,
  outstandingTotal: '20.00',
  checks: [{ code: 'GAP', level: 'BLOCKING', message: 'Il reste un écart de 20.00 € entre le relevé et les transactions pointées.' }],
  canValidate: false,
  createdAt: '2026-04-01T10:00:00.000Z',
  validatedAt: null,
  cancelledAt: null,
  ...overrides,
});
const transaction = (id: string, label: string, amount: string, overrides: Record<string, unknown> = {}) => ({
  id,
  financialAccountId: 'f1',
  operationDate: '2026-03-05',
  valueDate: null,
  amount,
  label,
  reference: null,
  origin: 'MANUAL',
  externalId: null,
  bankIdentified: false,
  projectId: null,
  projectCode: null,
  counterpartAccountId: null,
  counterpartAccountNumber: null,
  qualified: false,
  accounting: 'POSTED',
  entry: null,
  transfer: null,
  financialLock: null,
  deletable: true,
  reconciliation: null,
  version: 1,
  ...overrides,
});

describe('ReconciliationPage', () => {
  let controller: HttpTestingController;
  let harness: RouterTestingHarness;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    harness.detectChanges();
    await harness.fixture.whenStable();
  };
  /** Ouvre la page avec l'état serveur voulu : rapprochements, relevés, et transactions si un rapprochement est en cours. */
  const open = async (
    permissions: string[],
    state: { reconciliations?: object[]; statements?: object[]; transactions?: { transaction: object; pointed: boolean }[] } = {},
  ) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'comptes/:id/rapprochement', component: ReconciliationPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(permissions),
        NO_MATERIAL_ANIMATIONS,
      ],
    });
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    ui = new DialogTester(settle);
    const navigation = harness.navigateByUrl('/comptes/f1/rapprochement', ReconciliationPage);
    await settle();
    controller.expectOne('/api/financial-accounts').flush([account]);
    await settle();
    await flushReload(state);
    await navigation;
    root = harness.routeNativeElement as HTMLElement;
    await settle();
  };
  const flushReload = async (state: { reconciliations?: object[]; statements?: object[]; transactions?: { transaction: object; pointed: boolean }[] }) => {
    controller.expectOne('/api/financial-accounts/f1/reconciliations').flush(state.reconciliations ?? []);
    controller.expectOne('/api/financial-accounts/f1/statements').flush(state.statements ?? []);
    await settle();
    const inProgress = (state.reconciliations ?? []).some((r) => (r as { status: string }).status === 'IN_PROGRESS');
    if (inProgress) {
      controller.expectOne('/api/reconciliations/r1/transactions').flush(state.transactions ?? []);
      await settle();
    }
  };
  const button = (label: string) => {
    const found = Array.from(root.querySelectorAll<HTMLElement>('button, a')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    expect(found, label).toBeTruthy();
    return found!;
  };
  const click = async (label: string) => {
    button(label).click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("explique qu'il faut d'abord enregistrer le solde d'un relevé quand il n'y en a aucun", async () => {
    await open(['financial-accounts:view', 'imports:post']);
    expect(root.querySelector('h1')!.textContent).toContain('Rapprochement de Compte courant');
    expect(root.querySelector('.description')!.textContent).toContain("l'écart soit zéro");
    expect(root.textContent).toContain("il faut d'abord enregistrer le solde indiqué sur un relevé");
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Enregistrer un solde de relevé'))).toBe(true);
  });

  it('commence un rapprochement sur le relevé choisi', async () => {
    await open(['financial-accounts:view', 'imports:post'], { statements: [statement('s1', '2026-03-31', '1020.00')] });
    expect(root.textContent).toContain("le solde d'ouverture du compte");
    await ui_choose();
    await click('Commencer');
    const request = controller.expectOne('/api/financial-accounts/f1/reconciliations');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ statementId: 's1' });
    request.flush(reconciliation());
    await settle();
    await flushReload({ reconciliations: [reconciliation()], statements: [statement('s1', '2026-03-31', '1020.00')], transactions: [{ transaction: transaction('t1', 'Cotisation', '50.00'), pointed: false }] });
    expect(root.textContent).toContain('Relevé au 2026-03-31');
    expect(ui.snackbar).toContain('Rapprochement commencé');
  });

  it("affiche les soldes, l'écart, les opérations en circulation et les contrôles qui bloquent", async () => {
    await open(['financial-accounts:view', 'imports:post'], {
      reconciliations: [reconciliation()],
      transactions: [{ transaction: transaction('t1', 'Cotisation', '50.00'), pointed: false }],
    });
    const text = root.textContent!;
    expect(text).toContain('1 020,00 €');
    expect(text).toContain('Doit être à zéro pour valider');
    expect(text).toContain('En circulation');
    expect(text).toContain('Il reste un écart');
    expect((button('Valider le rapprochement') as HTMLButtonElement).disabled).toBe(true);
  });

  it('coche une transaction : le pointage est enregistré et les chiffres se mettent à jour', async () => {
    await open(['financial-accounts:view', 'imports:post'], {
      reconciliations: [reconciliation()],
      transactions: [{ transaction: transaction('t1', 'Cotisation', '20.00'), pointed: false }],
    });
    const box = root.querySelector<HTMLInputElement>('mat-checkbox input')!;
    box.click();
    await settle();
    const request = controller.expectOne('/api/reconciliations/r1/point');
    expect(request.request.body).toEqual({ transactionIds: ['t1'] });
    request.flush(reconciliation({ pointedCount: 1, pointedTotal: '20.00', pointedBalance: '1020.00', gap: '0.00', checks: [], canValidate: true }));
    await settle();
    expect(root.textContent).toContain('Ça tombe juste');
    expect(root.querySelector<HTMLInputElement>('mat-checkbox input')!.checked).toBe(true);
    expect((button('Valider le rapprochement') as HTMLButtonElement).disabled).toBe(false);

    root.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    await settle();
    const undo = controller.expectOne('/api/reconciliations/r1/unpoint');
    undo.flush(reconciliation());
    await settle();
  });

  it("montre en avertissement, sans bloquer, les écritures de banque sans transaction", async () => {
    await open(['financial-accounts:view', 'imports:post'], {
      reconciliations: [
        reconciliation({
          gap: '0.00',
          canValidate: true,
          checks: [{ code: 'ENTRIES_WITHOUT_TRANSACTION', level: 'WARNING', message: '1 écriture(s) comptabilisée(s) touchent ce compte de banque sans transaction associée.' }],
        }),
      ],
    });
    expect(root.textContent).toContain('sans transaction associée');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect((button('Valider le rapprochement') as HTMLButtonElement).disabled).toBe(false);
  });

  it('propose de cocher les transactions importées et dit combien ont été cochées', async () => {
    await open(['financial-accounts:view', 'imports:post'], { reconciliations: [reconciliation()] });
    await click('Cocher les transactions importées');
    controller.expectOne('/api/reconciliations/r1/point-imported').flush(reconciliation({ pointedCount: 3 }));
    await settle();
    await flushReload({ reconciliations: [reconciliation({ pointedCount: 3 })] });
    expect(ui.snackbar).toContain('3 transaction(s) importée(s) cochée(s)');
  });

  it("demande confirmation avant de valider, en expliquant que les transactions seront figées", async () => {
    const ready = reconciliation({ pointedCount: 2, gap: '0.00', checks: [], canValidate: true });
    await open(['financial-accounts:view', 'imports:post'], { reconciliations: [ready] });
    await click('Valider le rapprochement');
    expect(ui.title).toBe('Valider ce rapprochement ?');
    expect(ui.text).toContain('ne pourront plus être modifiées');
    expect(ui.text).toContain('annuler ce rapprochement');
    await ui.click('Valider');
    controller.expectOne('/api/reconciliations/r1/validate').flush({ ...ready, status: 'VALIDATED' });
    await settle();
    await flushReload({ reconciliations: [{ ...ready, status: 'VALIDATED' }] });
    expect(ui.snackbar).toContain('Rapprochement validé');
  });

  it("affiche le refus du serveur à la validation, avec ce qu'il faut faire", async () => {
    const ready = reconciliation({ pointedCount: 1, gap: '0.00', checks: [], canValidate: true });
    await open(['financial-accounts:view', 'imports:post'], { reconciliations: [ready] });
    await click('Valider le rapprochement');
    await ui.click('Valider');
    controller
      .expectOne('/api/reconciliations/r1/validate')
      .flush({ message: "Une transaction pointée n'est pas comptabilisée : comptabilisez-la ou retirez-la du pointage" }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("pas comptabilisée");
  });

  it('abandonne le rapprochement après confirmation', async () => {
    await open(['financial-accounts:view', 'imports:post'], { reconciliations: [reconciliation()] });
    await click('Abandonner');
    expect(ui.text).toContain('décochées');
    await ui.click('Abandonner');
    const request = controller.expectOne('/api/reconciliations/r1/cancel');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await flushReload({});
    expect(ui.snackbar).toContain('Rapprochement abandonné');
  });

  it("liste l'historique et n'offre l'annulation qu'au dernier rapprochement validé", async () => {
    const older = reconciliation({ id: 'r0', status: 'VALIDATED', periodEnd: '2026-02-28', pointedCount: 4 });
    const last = reconciliation({ id: 'r1', status: 'VALIDATED', periodEnd: '2026-03-31', pointedCount: 2 });
    await open(['financial-accounts:view', 'imports:post'], { reconciliations: [last, older] });
    expect(root.textContent).toContain('Rapproché au 2026-03-31');
    expect(root.textContent).toContain('Rapproché au 2026-02-28');
    expect(Array.from(root.querySelectorAll('button')).filter((b) => b.textContent!.includes('Annuler ce rapprochement'))).toHaveLength(1);

    await click('Annuler le rapprochement du 2026-03-31');
    expect(ui.text).toContain('pourront de nouveau être modifiées');
    await ui.click('Annuler le rapprochement');
    controller.expectOne('/api/reconciliations/r1/cancel').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await flushReload({ reconciliations: [{ ...last, status: 'CANCELLED' }, older] });
    expect(ui.snackbar).toContain('Rapprochement annulé');
  });

  it("en lecture seule, aucune action de rapprochement n'est proposée", async () => {
    await open(['financial-accounts:view'], {
      reconciliations: [reconciliation()],
      transactions: [{ transaction: transaction('t1', 'Cotisation', '20.00'), pointed: false }],
    });
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Valider'))).toBe(false);
    expect(root.querySelector<HTMLInputElement>('mat-checkbox input')!.disabled).toBe(true);
  });

  /** Choisit le premier relevé proposé dans la liste déroulante de la page (hors boîte de dialogue). */
  async function ui_choose(): Promise<void> {
    root.querySelector<HTMLElement>('mat-select .mat-mdc-select-trigger')!.click();
    await settle();
    const option = document.querySelector<HTMLElement>('.mat-mdc-option');
    expect(option).toBeTruthy();
    option!.click();
    await settle();
  }
});
