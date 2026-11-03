import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { RecoveryPage } from './recovery.page';

const financial = (overrides: Record<string, unknown> = {}) => ({
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
  balances: { opening: '1000.00', computed: '1000.00', accounting: '0.00', reconciled: null, lastStatement: null },
  ...overrides,
});
const chart = [
  { id: 'a512', number: '512', label: 'Banque', active: true, reportLine: null },
  { id: 'a102', number: '102', label: 'Fonds associatifs', active: true, reportLine: null },
  { id: 'a706', number: '706', label: 'Cotisations', active: true, reportLine: null },
];
const batch = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  name: 'Reprise 2026',
  note: null,
  status: 'OPEN',
  createdAt: '2026-11-02T10:00:00.000Z',
  closedAt: null,
  abandonedAt: null,
  drafts: 2,
  posted: 0,
  total: 2,
  ...overrides,
});
const item = (entryId: string, label: string, overrides: Record<string, unknown> = {}) => ({
  entryId,
  kind: 'TRANSACTION',
  financialAccountId: 'f1',
  financialAccountName: 'Compte courant',
  date: '2026-03-05',
  label,
  status: 'DRAFT',
  journalCode: 'BQ-1',
  number: null,
  amount: '50.00',
  ...overrides,
});

describe('RecoveryPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<RecoveryPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const FULL = ['entries:view', 'entries:create', 'entries:post', 'transactions:manage', 'financial-accounts:view'];
  const create = async (permissions: string[], batches: object[] = [batch()]) => {
    await TestBed.configureTestingModule({
      imports: [RecoveryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RecoveryPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/recovery-batches').flush(batches);
    await settle();
    controller.expectOne('/api/financial-accounts').flush([financial(), financial({ id: 'f2', name: 'Livret', accountId: 'a5122', balances: { ...financial().balances, opening: '0.00' } })]);
    await settle();
    controller.expectOne('/api/accounts').flush(chart);
    await settle();
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
  /** Ouvre le lot b1 avec ses écritures. */
  const openBatch = async (items: object[] = [item('e1', 'Cotisation de Marie'), item('e2', 'Fournitures', { amount: '30.00' })], b: object = batch()) => {
    await click('Ouvrir le lot Reprise 2026');
    controller.expectOne('/api/recovery-batches/b1').flush({ batch: b, items });
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("guide l'utilisateur quand il n'y a aucun lot", async () => {
    await create(FULL, []);
    expect(root.textContent).toContain('Aucun lot de reprise');
    expect(root.textContent).toContain('qualifier les transactions');
    expect(root.textContent).toContain('Nouveau lot');
  });

  it("liste les lots avec leur état et le nombre de brouillons, sans actions de modification en lecture seule", async () => {
    await create(['entries:view'], [batch(), batch({ id: 'b2', name: 'Ancien lot', status: 'ABANDONED', drafts: 0, posted: 3, total: 3 })]);
    expect(root.textContent).toContain('En préparation · 2 brouillon(s) · 0 comptabilisée(s)');
    expect(root.textContent).toContain('Abandonné · 0 brouillon(s) · 3 comptabilisée(s)');
    expect(root.textContent).not.toContain('Nouveau lot');
  });

  it('crée un lot et l\'ouvre', async () => {
    await create(FULL, []);
    await click('Nouveau lot');
    expect(ui.title).toBe('Nouveau lot de reprise');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.type('input[formcontrolname="name"]', 'Reprise 2026');
    await ui.submit();
    const request = controller.expectOne('/api/recovery-batches');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Reprise 2026' });
    request.flush(batch({ drafts: 0, total: 0 }));
    await settle();
    controller.expectOne('/api/recovery-batches').flush([batch({ drafts: 0, total: 0 })]);
    await settle();
    controller.expectOne('/api/recovery-batches/b1').flush({ batch: batch({ drafts: 0, total: 0 }), items: [] });
    await settle();
    expect(ui.snackbar).toContain('Lot « Reprise 2026 » créé');
    expect(root.textContent).toContain('Ce lot est vide');
  });

  it("affiche les écritures du lot en brouillon et propose les actions d'un lot en préparation", async () => {
    await create(FULL);
    await openBatch([item('e1', 'Solde d’ouverture', { kind: 'OPENING', amount: '1000.00' }), item('e2', 'Fournitures', { status: 'POSTED', number: 4 })]);
    const text = root.textContent!;
    expect(text).toContain('Solde de départ');
    expect(text).toContain('Brouillon');
    expect(text).toContain('BQ-1 n° 4');
    for (const label of ['Reprendre un solde de départ', "Préparer les écritures d'un compte", 'Comptabiliser le lot', 'Abandonner le lot']) {
      expect(button(label), label).toBeTruthy();
    }
  });

  it("reprend un solde de départ : compte de capitaux choisi et origine expliquée", async () => {
    await create(FULL);
    await openBatch();
    await click('Reprendre un solde de départ');
    expect(ui.title).toBe('Reprendre un solde de départ');
    expect(ui.text).toContain("n'est pas une recette");
    // Seul le compte avec un solde d'ouverture non nul est proposé, et seulement les comptes de classe 1.
    expect(await ui.options('mat-select[formcontrolname="financialAccountId"]')).toEqual(['Compte courant — 1000.00 € au 01/01/2026']);
    expect(await ui.options('mat-select[formcontrolname="counterpartAccountId"]')).toEqual(['102 — Fonds associatifs']);

    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.choose('mat-select[formcontrolname="counterpartAccountId"]', 'Fonds associatifs');
    await ui.type('input[formcontrolname="explanation"]', 'Fonds apportés à la création');
    await ui.submit();
    const request = controller.expectOne('/api/recovery-batches/b1/opening');
    expect(request.request.body).toEqual({ financialAccountId: 'f1', counterpartAccountId: 'a102', explanation: 'Fonds apportés à la création' });
    request.flush(item('e9', 'Solde d’ouverture', { kind: 'OPENING', amount: '1000.00' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/recovery-batches').flush([batch()]);
    await settle();
    controller.expectOne('/api/recovery-batches/b1').flush({ batch: batch(), items: [item('e9', 'Solde d’ouverture', { kind: 'OPENING' })] });
    await settle();
    expect(ui.snackbar).toContain('Brouillon du solde de départ préparé');
  });

  it("prépare les écritures d'un compte et montre le compte rendu avec la raison de chaque transaction ignorée", async () => {
    await create(FULL);
    await openBatch();
    await click("Préparer les écritures d'un compte");
    await ui.type('input[formcontrolname="from"]', '2026-01-01');
    await ui.submit();
    const request = controller.expectOne('/api/recovery-batches/b1/prepare-entries');
    expect(request.request.body).toEqual({ financialAccountId: 'f1', from: '2026-01-01' });
    request.flush({
      created: 4,
      skipped: [{ transactionId: 't9', date: '2026-03-12', label: 'Don à classer', amount: '12.00', reason: 'NOT_QUALIFIED', message: 'Pas de compte de contrepartie : qualifiez la transaction d’abord.' }],
      skippedByReason: { NOT_QUALIFIED: 1 },
    });
    await settle();
    controller.expectOne('/api/recovery-batches').flush([batch()]);
    await settle();
    controller.expectOne('/api/recovery-batches/b1').flush({ batch: batch(), items: [] });
    await settle();
    const report = root.querySelector('section[aria-label="Compte rendu"]')!.textContent!;
    expect(report).toContain('4 brouillon(s) préparé(s)');
    expect(report).toContain('1 transaction(s) ignorée(s)');
    expect(report).toContain('Don à classer');
    expect(report).toContain('qualifiez la transaction');
  });

  it("demande confirmation avant de comptabiliser le lot et affiche ce qui est refusé, resté en brouillon", async () => {
    await create(FULL);
    await openBatch();
    await click('Comptabiliser le lot');
    expect(ui.title).toBe('Comptabiliser ce lot ?');
    expect(ui.text).toContain('ne peut plus être modifiée ni supprimée');
    expect(ui.text).toContain('restent en brouillon');
    await ui.click('Comptabiliser le lot');
    controller.expectOne('/api/recovery-batches/b1/post').flush({
      posted: 1,
      failed: [{ entryId: 'e2', date: '2026-03-10', label: 'Fournitures', messages: ['La ligne de banque de l’écriture ne correspond plus à la transaction liée.'] }],
      remainingDrafts: 1,
      completed: false,
    });
    await settle();
    controller.expectOne('/api/recovery-batches').flush([batch({ drafts: 1, posted: 1 })]);
    await settle();
    controller.expectOne('/api/recovery-batches/b1').flush({ batch: batch({ drafts: 1, posted: 1 }), items: [item('e2', 'Fournitures')] });
    await settle();
    const report = root.querySelector('section[aria-label="Compte rendu"]')!.textContent!;
    expect(report).toContain('1 écriture(s) comptabilisée(s)');
    expect(report).toContain('1 refusée(s), restée(s) en brouillon');
    expect(report).toContain('ne correspond plus');
    expect(ui.snackbar).toContain('1 refusée(s)');
  });

  it("n'offre pas « Comptabiliser le lot » sans le droit de comptabiliser, ni sans brouillon", async () => {
    await create(['entries:view', 'entries:create', 'transactions:manage']);
    await openBatch();
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Comptabiliser le lot'))).toBe(false);
  });

  it("abandonne le lot après avoir expliqué que le comptabilisé n'est pas touché", async () => {
    await create(FULL);
    await openBatch([item('e1', 'Cotisation'), item('e2', 'Fournitures', { status: 'POSTED', number: 1 })], batch({ drafts: 1, posted: 1 }));
    await click('Abandonner le lot');
    expect(ui.text).toContain('ne sont pas touchées');
    await ui.click('Abandonner le lot');
    controller.expectOne('/api/recovery-batches/b1/abandon').flush({ deleted: 1, kept: 1 });
    await settle();
    controller.expectOne('/api/recovery-batches').flush([batch({ status: 'ABANDONED', drafts: 0, posted: 1 })]);
    await settle();
    controller.expectOne('/api/recovery-batches/b1').flush({ batch: batch({ status: 'ABANDONED', drafts: 0, posted: 1 }), items: [item('e2', 'Fournitures', { status: 'POSTED', number: 1 })] });
    await settle();
    expect(ui.snackbar).toContain('1 brouillon(s) supprimé(s), 1 écriture(s) comptabilisée(s) conservée(s)');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Abandonner le lot'))).toBe(false);
  });
});
