import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ImportPanel } from './import-panel';
import type { FinancialAccountInfo, ImportInfo, ImportLineInfo } from '../admin/admin-api.service';
import { ThemeService } from '../theme/theme.service';

/** Les tests historiques décrivent l'affichage comptable ; les tests « affichage simple » le demandent explicitement. */
let view: 'simple' | 'accounting' = 'accounting';
beforeEach(() => {
  view = 'accounting';
});

const account = { id: 'f1', name: 'Compte courant' } as FinancialAccountInfo;

const line = (overrides: Partial<ImportLineInfo> = {}): ImportLineInfo => ({
  id: 'l1',
  position: 1,
  status: 'NEW',
  fitId: 'FIT-1',
  operationDate: '2026-03-05',
  amount: '150.00',
  label: 'VIREMENT M. DUPONT',
  reference: null,
  errors: [],
  candidates: [],
  matchedTransactionId: null,
  decision: null,
  transactionId: null,
  ...overrides,
});
const batch = (lines: ImportLineInfo[], overrides: Partial<ImportInfo> = {}): ImportInfo => ({
  id: 'b1',
  financialAccountId: 'f1',
  fileName: 'releve.ofx',
  format: 'SGML',
  status: 'ANALYZED',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  ledgerBalance: '1089.40',
  ledgerBalanceDate: '2026-03-31',
  accountHint: '5678',
  summary: { total: lines.length, new: 0, duplicate: 0, probableMatch: 0, error: 0 },
  createdAt: '2026-11-01T10:00:00.000Z',
  committedAt: null,
  lines,
  ...overrides,
});

const mixed = [
  line(),
  line({
    id: 'l2',
    position: 2,
    status: 'PROBABLE_MATCH',
    amount: '-42.30',
    label: 'CARTE BOULANGERIE',
    fitId: 'FIT-2',
    candidates: [{ transactionId: 't9', operationDate: '2026-03-09', label: 'Courses', score: 90 }],
  }),
  line({ id: 'l3', position: 3, status: 'DUPLICATE', fitId: 'FIT-3', matchedTransactionId: 't1' }),
  line({ id: 'l4', position: 4, status: 'ERROR', fitId: null, errors: ['Identifiant bancaire (FITID) absent.'] }),
];

describe('ImportPanel', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ImportPanel>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[] = []) => {
    await TestBed.configureTestingModule({
      imports: [ImportPanel],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    TestBed.inject(ThemeService).setViewMode(view);
    fixture = TestBed.createComponent(ImportPanel);
    fixture.componentRef.setInput('account', account);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
  };
  const upload = async (response: ImportInfo | { failure: { status: number; message: string } }) => {
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['OFXHEADER:100'], 'releve.ofx');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    const request = controller.expectOne('/api/financial-accounts/f1/imports');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeInstanceOf(FormData);
    if ('failure' in response) request.flush({ message: response.failure.message }, { status: response.failure.status, statusText: 'Error' });
    else request.flush(response, { status: 201, statusText: 'Created' });
    await settle();
  };
  const select = (label: string) => root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const choose = async (label: string, value: string) => {
    const element = select(label);
    element.value = value;
    element.dispatchEvent(new Event('change'));
    await settle();
  };
  const button = (label: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLButtonElement;

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("analyse d'abord : montre le classement des lignes avant toute création", async () => {
    await create();
    expect(root.textContent).toContain('aucune transaction n\'est créée avant votre confirmation');
    await upload(batch(mixed, { summary: { total: 4, new: 1, duplicate: 1, probableMatch: 1, error: 1 } }));
    const text = root.textContent!;
    expect(text).toContain('releve.ofx');
    expect(text).toContain('OFX 1.x');
    expect(text).toContain('compte se terminant par 5678');
    expect(text).toContain('1 à rapprocher');
    expect(text).toContain('Nouvelle');
    expect(text).toContain('Déjà importée');
    expect(text).toContain('Identifiant bancaire (FITID) absent.');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it("dit que le fichier d'origine est conservé, et ne propose de le télécharger qu'à qui peut lire les documents restreints", async () => {
    await create(['financial-accounts:view', 'documents:view']);
    await upload(batch(mixed, { documentId: 'd1' }));
    expect(root.textContent).toContain("Le fichier d'origine est conservé comme document restreint");
    expect(root.querySelector('a[href="/api/documents/d1/download"]')).toBeNull();

    TestBed.resetTestingModule();
    await create(['financial-accounts:view', 'documents:view', 'documents.restricted:view']);
    await upload(batch(mixed, { documentId: 'd1' }));
    expect(root.querySelector('a[href="/api/documents/d1/download"]')!.textContent).toContain("Télécharger le fichier d'origine");
  });

  it("n'annonce rien quand aucun fichier d'origine n'est conservé", async () => {
    await create(['documents:view', 'documents.restricted:view']);
    await upload(batch(mixed, { documentId: null }));
    expect(root.textContent).not.toContain("fichier d'origine");
    expect(root.querySelector('a[href^="/api/documents/"]')).toBeNull();
  });

  it("affichage simple : les saisies proches d'un mouvement de la banque sont « à relier », pas « à rapprocher »", async () => {
    view = 'simple';
    await create();
    await upload(batch(mixed, { summary: { total: 4, new: 1, duplicate: 1, probableMatch: 1, error: 1 } }));
    expect(root.textContent).toContain('1 à relier');
    expect(root.textContent).toContain('1 ligne(s) à relier attendent votre choix');
    expect(root.textContent).not.toContain('à rapprocher');
  });

  it('exige un choix explicite pour une ligne à rapprocher, sans valeur par défaut', async () => {
    await create();
    await upload(batch(mixed));
    expect(select('Décision de la ligne 2').value).toBe('');
    expect(select('Décision de la ligne 1').value).toBe('CREATE');
    expect(button('Confirmer').disabled).toBe(true);
    expect(root.textContent).toContain('1 ligne(s) à rapprocher attendent votre choix');

    await choose('Décision de la ligne 2', 'LINK:t9');
    expect(button('Confirmer').disabled).toBe(false);
  });

  it('confirme avec le rattachement choisi, les créations par défaut et le solde du relevé', async () => {
    await create();
    let imported: { created: number; linked: number; skipped: number } | null = null;
    fixture.componentInstance.imported.subscribe((result) => (imported = result));
    await upload(batch(mixed));
    await choose('Décision de la ligne 2', 'LINK:t9');
    root.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    await settle();
    button('Confirmer').click();
    await settle();

    const commit = controller.expectOne('/api/imports/b1/commit');
    expect(commit.request.body).toEqual({
      decisions: [
        { lineId: 'l1', action: 'CREATE' },
        { lineId: 'l2', action: 'LINK', transactionId: 't9' },
      ],
      recordStatement: true,
    });
    commit.flush(batch(mixed, { status: 'COMMITTED', summary: { total: 4, new: 1, duplicate: 1, probableMatch: 1, error: 1, result: { created: 1, linked: 1, skipped: 2 } } }));
    await settle();
    expect(ui.snackbar).toContain('1 créée(s), 1 rapprochée(s), 2 ignorée(s)');
    expect(imported).toEqual({ created: 1, linked: 1, skipped: 2 });
  });

  it('permet de créer quand même un paiement distinct, ou d’ignorer une ligne', async () => {
    await create();
    await upload(batch(mixed));
    await choose('Décision de la ligne 2', 'CREATE');
    await choose('Décision de la ligne 1', 'SKIP');
    button('Confirmer').click();
    await settle();
    const commit = controller.expectOne('/api/imports/b1/commit');
    expect(commit.request.body.decisions).toEqual([
      { lineId: 'l1', action: 'SKIP' },
      { lineId: 'l2', action: 'CREATE' },
    ]);
    expect(commit.request.body.recordStatement).toBe(false);
    commit.flush({ message: 'Une saisie proposée n\'est plus disponible.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("n'est plus disponible");
  });

  it('affiche la raison du refus d’un fichier non pris en charge', async () => {
    await create();
    await upload({ failure: { status: 422, message: 'Ce fichier contient des relevés de carte bancaire.' } });
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('carte bancaire');
    expect(root.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("annule l'analyse sans rien créer", async () => {
    await create();
    await upload(batch(mixed));
    button("Annuler l'analyse").click();
    await settle();
    const cancel = controller.expectOne('/api/imports/b1/cancel');
    cancel.flush(batch(mixed, { status: 'CANCELLED' }));
    await settle();
    expect(ui.snackbar).toContain('aucune transaction créée');
    expect(root.querySelector('input[type="file"]')).toBeTruthy();
  });
});
