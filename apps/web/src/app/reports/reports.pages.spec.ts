import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BalanceSheetPage } from './balance-sheet.page';
import { IncomeStatementPage } from './income-statement.page';
import { TreasuryStatementPage } from './treasury.page';

const year = (id: string, label: string, status = 'OPEN') => ({ id, label, start: `${label}-01-01`, end: `${label}-12-31`, status });
const years = [year('y1', '2025', 'CLOSED'), year('y2', '2026')];
const group = (code: string, label: string, rows: [string, string, string, string | null][], total: string, previousTotal: string | null) => ({
  code,
  label,
  help: `Aide ${label}`,
  rows: rows.map(([rowCode, rowLabel, amount, previous]) => ({ code: rowCode, label: rowLabel, amount, previous })),
  total,
  previousTotal,
});
const incomeStatement = (overrides: Record<string, unknown> = {}) => ({
  fiscalYear: year('y2', '2026'),
  previous: year('y1', '2025', 'CLOSED'),
  draftEntries: 0,
  carryWarning: null,
  sections: [
    group('OPERATING_PRODUCTS', "Produits d'exploitation", [['PRO_COTIS', 'Cotisations', '200.00', '150.00']], '200.00', '150.00'),
    group('OPERATING_CHARGES', "Charges d'exploitation", [['CHG_ACHATS', 'Achats', '50.00', '20.00']], '50.00', '20.00'),
  ],
  intermediate: [{ code: 'OPERATING', label: "Résultat d'exploitation", amount: '150.00', previous: '130.00' }],
  products: '200.00',
  charges: '50.00',
  result: '150.00',
  previousResult: '130.00',
  defaulted: [{ number: '756', label: 'Cotisations' }],
  unclassified: [],
  ...overrides,
});
const balanceSheet = (overrides: Record<string, unknown> = {}) => ({
  fiscalYear: year('y2', '2026'),
  previous: year('y1', '2025', 'CLOSED'),
  draftEntries: 0,
  carryWarning: null,
  assets: [group('CASH', 'Disponibilités', [['ACT_DISPO', 'Banque et caisse', '1200.00', '1000.00']], '1200.00', '1000.00')],
  liabilities: [group('EQUITY', 'Fonds propres', [['PAS_RESULTAT', "Résultat de l'exercice", '1200.00', '1000.00']], '1200.00', '1000.00')],
  totalAssets: '1200.00',
  totalLiabilities: '1200.00',
  previousTotalAssets: '1000.00',
  previousTotalLiabilities: '1000.00',
  difference: '0.00',
  balanced: true,
  result: '150.00',
  unclassified: [],
  ...overrides,
});

describe('états de synthèse', () => {
  let controller: HttpTestingController;
  let harness: RouterTestingHarness;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    harness.detectChanges();
    await harness.fixture.whenStable();
  };
  const open = async <T>(component: new () => T, path: string, endpoint: string, body: object) => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path, component }]), provideHttpClient(), provideHttpClientTesting()],
    });
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl(`/${path}`, component);
    await settle();
    controller.expectOne('/api/fiscal-years').flush(years);
    await settle();
    controller.expectOne((r) => r.url === endpoint && r.params.get('fiscalYearId') === 'y2').flush(body);
    await navigation;
    await settle();
    return harness.routeNativeElement as HTMLElement;
  };

  afterEach(() => controller.verify());

  it('compte de résultat : rubriques, résultats, colonne précédente et explication du résultat', async () => {
    const root = await open(IncomeStatementPage, 'resultat', '/api/reports/income-statement', incomeStatement());
    const text = root.textContent!;
    expect(text).toContain('Ce que l\'association a gagné');
    expect(text).toContain('Cotisations');
    expect(text).toContain('200,00');
    expect(text).toContain('150,00');
    expect(text).toContain('2025');
    expect(text).toContain('Excédent');
    expect(text).toContain('Ces comptes n\'ont pas de rubrique choisie');
    expect(root.querySelectorAll('thead th')[2]!.textContent).toContain('2025');
  });

  it("compte de résultat sans exercice précédent : la colonne de comparaison est absente, pas remplie de zéros", async () => {
    const root = await open(
      IncomeStatementPage,
      'resultat',
      '/api/reports/income-statement',
      incomeStatement({
        previous: null,
        previousResult: null,
        sections: [group('OPERATING_PRODUCTS', "Produits d'exploitation", [['PRO_COTIS', 'Cotisations', '200.00', null]], '200.00', null)],
        intermediate: [{ code: 'OPERATING', label: "Résultat d'exploitation", amount: '150.00', previous: null }],
      }),
    );
    expect(root.textContent).toContain('Aucun exercice précédent');
    expect(root.querySelectorAll('thead th')).toHaveLength(2);
  });

  it('compte de résultat : signale un déficit, les brouillons ignorés et les comptes sans rubrique', async () => {
    const root = await open(
      IncomeStatementPage,
      'resultat',
      '/api/reports/income-statement',
      incomeStatement({ result: '-20.00', draftEntries: 2, unclassified: [{ number: '864', label: 'Bénévolat', amount: '10.00' }] }),
    );
    expect(root.textContent).toContain('Déficit');
    expect(root.textContent).toContain('2 brouillon(s) d\'écriture ne sont pas pris en compte');
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('864 Bénévolat');
  });

  it("bilan équilibré : totaux de l'actif et du passif et confirmation", async () => {
    const root = await open(BalanceSheetPage, 'bilan', '/api/reports/balance-sheet', balanceSheet());
    const text = root.textContent!;
    expect(text).toContain('Total de l\'actif : 1 200,00 €');
    expect(text).toContain('Total du passif : 1 200,00 €');
    expect(text).toContain('Le bilan est équilibré');
    expect(text).toContain('Banque et caisse');
  });

  it("bilan : avertit quand l'exercice précédent n'est pas clôturé, et quand l'actif et le passif diffèrent", async () => {
    const root = await open(
      BalanceSheetPage,
      'bilan',
      '/api/reports/balance-sheet',
      balanceSheet({
        carryWarning: "L'exercice « 2025 » n'est pas clôturé : ses soldes ne sont pas encore reportés.",
        balanced: false,
        difference: '-10.00',
        unclassified: [{ number: '864', label: 'Bénévolat', amount: '10.00' }],
      }),
    );
    const alerts = Array.from(root.querySelectorAll('.alert')).map((a) => a.textContent);
    expect(alerts.join(' ')).toContain("n'est pas clôturé");
    expect(alerts.join(' ')).toContain("ne sont pas égaux");
    expect(root.textContent).toContain('864 Bénévolat');
    expect(root.textContent).not.toContain('Le bilan est équilibré');
  });
});

describe('état de trésorerie et exports', () => {
  let controller: HttpTestingController;
  let harness: RouterTestingHarness;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    harness.detectChanges();
    await harness.fixture.whenStable();
  };
  const open = async (component: new () => unknown, path: string, endpoint: string, body: object) => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path, component }]), provideHttpClient(), provideHttpClientTesting()] });
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl(`/${path}`, component as never);
    await settle();
    controller.expectOne('/api/fiscal-years').flush(years);
    await settle();
    controller.expectOne((r) => r.url === endpoint && r.params.get('fiscalYearId') === 'y2').flush(body);
    await navigation;
    await settle();
    return harness.routeNativeElement as HTMLElement;
  };

  afterEach(() => controller.verify());

  const figures = (opening: string, receipts: string, payments: string, closing: string) => ({ opening, receipts, payments, closing });
  const treasury = (overrides: Record<string, unknown> = {}) => ({
    fiscalYear: year('y2', '2026'),
    previous: year('y1', '2025', 'CLOSED'),
    draftEntries: 0,
    carryWarning: null,
    rows: [{ number: '5121', label: 'Banque', financialAccountName: 'Compte courant', ...figures('1000.00', '300.00', '120.00', '1180.00'), previous: figures('0.00', '1000.00', '0.00', '1000.00') }],
    totals: figures('1000.00', '300.00', '120.00', '1180.00'),
    previousTotals: figures('0.00', '1000.00', '0.00', '1000.00'),
    ...overrides,
  });

  it("trésorerie : départ, encaissements, décaissements, clôture, total et colonne précédente", async () => {
    const root = await open(TreasuryStatementPage, 'tresorerie', '/api/reports/treasury', treasury());
    const text = root.textContent!;
    expect(text).toContain('Compte courant');
    expect(text).toContain('compte 5121');
    expect(text).toContain('1 180,00');
    expect(text).toContain('Clôture 2025');
    expect(text).toContain('Un virement');
  });

  it("trésorerie sans exercice précédent ni mouvement : colonne absente et message utile", async () => {
    const root = await open(TreasuryStatementPage, 'tresorerie', '/api/reports/treasury', treasury({ previous: null, previousTotals: null, rows: [] }));
    expect(root.textContent).toContain('Aucun exercice précédent');
    expect(root.textContent).toContain('Aucun mouvement comptabilisé');
  });

  it("propose l'export CSV de l'exercice choisi et l'impression en PDF", async () => {
    const root = await open(TreasuryStatementPage, 'tresorerie', '/api/reports/treasury', treasury());
    const link = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('Exporter (CSV)'))!;
    expect(link.getAttribute('href')).toBe('/api/reports/treasury/csv?fiscalYearId=y2');
    expect(link.hasAttribute('download')).toBe(true);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes('Imprimer'))!.click();
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it("compte de résultat et bilan proposent aussi l'export", async () => {
    const income = await open(IncomeStatementPage, 'resultat', '/api/reports/income-statement', incomeStatement());
    expect(Array.from(income.querySelectorAll<HTMLAnchorElement>('a')).some((a) => a.getAttribute('href') === '/api/reports/income-statement/csv?fiscalYearId=y2')).toBe(true);
  });
});
