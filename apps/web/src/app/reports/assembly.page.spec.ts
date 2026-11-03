import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { mockAuth } from '../testing/auth-mock';
import { AssemblyPage } from './assembly.page';

const year = (id: string, label: string, status = 'OPEN') => ({ id, label, start: `${label}-01-01`, end: `${label}-12-31`, status });
const group = (code: string, label: string, rows: [string, string, string, string | null][], total: string, previousTotal: string | null) => ({
  code,
  label,
  help: `Aide ${label}`,
  rows: rows.map(([rowCode, rowLabel, amount, previous]) => ({ code: rowCode, label: rowLabel, amount, previous })),
  total,
  previousTotal,
});
const base = (y: ReturnType<typeof year>) => ({ fiscalYear: y, previous: null, draftEntries: 0, carryWarning: null });
const figures = (opening: string, receipts: string, payments: string, closing: string) => ({ opening, receipts, payments, closing });
const bodies = (y: ReturnType<typeof year>, over: { result?: string; balanced?: boolean; drafts?: number } = {}) => ({
  income: {
    ...base(y),
    draftEntries: over.drafts ?? 0,
    sections: [group('OPERATING_PRODUCTS', "Produits d'exploitation", [['PRO_COTIS', 'Cotisations', '2000.00', null]], '2000.00', null)],
    intermediate: [],
    products: '2000.00',
    charges: '1500.00',
    result: over.result ?? '500.00',
    previousResult: null,
    defaulted: [],
    unclassified: [],
  },
  balance: {
    ...base(y),
    assets: [group('CASH', 'Disponibilités', [['ACT_DISPO', 'Banque et caisse', '1700.00', null]], '1700.00', null)],
    liabilities: [group('EQUITY', 'Fonds propres', [['PAS_RES', 'Résultat', '1700.00', null]], '1700.00', null)],
    totalAssets: '1700.00',
    totalLiabilities: '1700.00',
    previousTotalAssets: null,
    previousTotalLiabilities: null,
    difference: over.balanced === false ? '12.00' : '0.00',
    balanced: over.balanced ?? true,
    result: '500.00',
    unclassified: [],
  },
  treasury: {
    ...base(y),
    rows: [{ number: '5121', label: 'Banque', financialAccountName: 'Compte courant', ...figures('1200.00', '2000.00', '1500.00', '1700.00'), previous: null }],
    totals: figures('1200.00', '2000.00', '1500.00', '1700.00'),
    previousTotals: null,
  },
});
const grant = (over: object = {}) => ({ id: 'g1', title: 'Aide 2026', status: 'GRANTED', grantedAmount: '3000.00', received: '1000.00', funder: { name: 'Mairie' }, ...over });

describe('Dossier de l’assemblée générale (#23)', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<AssemblyPage>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], years: object[], b: ReturnType<typeof bodies> | null, grants: object[] | null = null) => {
    await TestBed.configureTestingModule({
      imports: [AssemblyPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AssemblyPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/fiscal-years').flush(years);
    await settle();
    if (b) {
      const id = (years.at(-1) as { id: string }).id;
      controller.expectOne((r) => r.url === '/api/reports/income-statement' && r.params.get('fiscalYearId') === id).flush(b.income);
      controller.expectOne((r) => r.url === '/api/reports/balance-sheet' && r.params.get('fiscalYearId') === id).flush(b.balance);
      controller.expectOne((r) => r.url === '/api/reports/treasury' && r.params.get('fiscalYearId') === id).flush(b.treasury);
      await settle();
      if (grants) {
        controller.expectOne((r) => r.url === '/api/grants').flush(grants);
        await settle();
      }
    }
  };

  afterEach(() => controller.verify());

  it('résume la période en une phrase, puis donne les états, l’argent sur les comptes et la zone d’approbation', async () => {
    const y = year('y2', '2026', 'CLOSED');
    await create(['reports:view'], [y], bodies(y));
    const text = root.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('l’association a reçu 2 000,00 € et dépensé 1 500,00 €');
    expect(text).toContain('excédent de 500,00 €');
    expect(text).toContain('il lui reste 1 700,00 € sur ses comptes de banque et de caisse');
    expect(text).toContain('Du 01/01/2026 au 31/12/2026');
    expect(text).toContain('Ce que l’association a reçu et dépensé (compte de résultat)');
    expect(text).toContain('Ce que l’association possède et doit (bilan)');
    expect(text).toContain('Compte courant');
    expect(text).toContain('assemblée générale du ……… / ……… / ………… et approuvés');
    expect(text).toContain('ne remplace pas l’avis d’un expert-comptable');
    expect(text).not.toContain('provisoire');
    expect(root.querySelector('section[aria-label="Les subventions"]')).toBeNull();
  });

  it('marque le dossier provisoire tant que la période n’est pas clôturée, et signale un bilan déséquilibré', async () => {
    const y = year('y2', '2026');
    await create(['reports:view'], [y], bodies(y, { result: '-80.00', balanced: false, drafts: 2 }));
    const text = root.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Dossier provisoire : la période n’est pas encore clôturée');
    expect(text).toContain('déficit de 80,00 €');
    expect(text).toContain('2 opération(s) en brouillon ne sont pas comptées');
    expect(text).toContain('ne sont pas égaux (écart de 12,00 €)');
    expect(root.querySelector('a[href="/rapports/figes"]')).not.toBeNull();
  });

  it('montre les subventions accordées seulement à qui peut les lire', async () => {
    const y = year('y2', '2026', 'CLOSED');
    await create(['reports:view', 'grants:view'], [y], bodies(y), [grant(), grant({ id: 'g2', title: 'Refusée', status: 'REFUSED', grantedAmount: null }), grant({ id: 'g3', title: 'Terminée', status: 'CLOSED', received: '500.00' })]);
    const section = root.querySelector('section[aria-label="Les subventions"]')!;
    const rows = Array.from(section.querySelectorAll('tbody tr')).map((tr) => tr.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Mairie — Aide 20263 000,00 €1 000,00 €En cours', 'Mairie — Terminée3 000,00 €500,00 €Terminée']);
  });

  it('dit quoi faire quand aucune période n’existe, et lance l’impression', async () => {
    await create(['reports:view'], [], null);
    expect(root.textContent).toContain('Aucune période de comptabilité');
    TestBed.resetTestingModule();
    const y = year('y2', '2026', 'CLOSED');
    await create(['reports:view'], [y], bodies(y));
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes('Imprimer'))!.click();
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });
});
