import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { formatBalance } from './amount';
import { JournalBookPage } from './journal-book.page';
import { LedgerPage } from './ledger.page';
import { TrialBalancePage } from './trial-balance.page';

const years = [
  { id: 'y0', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' },
  { id: 'y1', label: '2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' },
];
const journals = [{ id: 'j1', code: 'OD', label: 'Opérations diverses', type: 'MISC', active: true }];
const accounts = [{ id: 'a1', number: '512', label: 'Banque', active: true, reportLine: null }];

describe('formatBalance', () => {
  it('affiche le sens du solde', () => {
    expect(formatBalance('1180.00')).toBe('1 180,00 D');
    expect(formatBalance('-300.00')).toBe('300,00 C');
    expect(formatBalance('0.00')).toBe('0,00');
  });
});

describe('états de lecture', () => {
  let controller: HttpTestingController;
  let fixture: ComponentFixture<unknown>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async <T>(page: Type<T>, lists: string[]) => {
    await TestBed.configureTestingModule({
      imports: [page],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['entries:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(page);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/fiscal-years').flush(years);
    for (const list of lists) {
      controller.expectOne(`/api/${list}`).flush(list === 'journals' ? journals : accounts);
    }
    await settle();
  };

  afterEach(() => controller.verify());

  it("grand livre : charge l'exercice ouvert par défaut et affiche les soldes cumulés avec leur sens", async () => {
    await create(LedgerPage, ['accounts']);
    const request = controller.expectOne((r) => r.url === '/api/reports/ledger');
    expect(request.request.params.get('fiscalYearId')).toBe('y1');
    request.flush({
      accounts: [
        {
          accountId: 'a1',
          number: '512',
          label: 'Banque',
          totalDebit: '1300.00',
          totalCredit: '120.00',
          balance: '1180.00',
          lines: [
            { date: '2026-01-10', journalCode: 'OD', entryId: 'e1', entryNumber: 1, entryLabel: 'Apport', reference: null, lineLabel: null, debit: '1000.00', credit: '0.00', balance: '1000.00' },
            { date: '2026-06-01', journalCode: 'OD', entryId: 'e3', entryNumber: 3, entryLabel: 'Fournitures', reference: null, lineLabel: null, debit: '0.00', credit: '120.00', balance: '880.00' },
          ],
        },
      ],
    });
    await settle();
    const text = root.textContent!;
    expect(text).toContain('512 — Banque');
    expect(text).toContain('Apport');
    expect(text).toContain('1 000,00 D');
    expect(text).toContain('1 180,00 D');
    expect(text).toContain('Totaux');
  });

  it('grand livre : affiche le refus du serveur quand l’état est trop volumineux', async () => {
    await create(LedgerPage, ['accounts']);
    controller
      .expectOne((r) => r.url === '/api/reports/ledger')
      .flush({ message: 'Plus de 5000 lignes : choisissez un compte.' }, { status: 422, statusText: 'Unprocessable Entity' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Plus de 5000 lignes');
  });

  it('balance : annonce une balance équilibrée avec ses totaux', async () => {
    await create(TrialBalancePage, []);
    controller.expectOne((r) => r.url === '/api/reports/trial-balance').flush({
      rows: [
        { accountId: 'a1', number: '512', label: 'Banque', debit: '1350.00', credit: '170.00', debitBalance: '1180.00', creditBalance: '0.00' },
        { accountId: 'a2', number: '102', label: 'Fonds', debit: '0.00', credit: '1000.00', debitBalance: '0.00', creditBalance: '1000.00' },
      ],
      totals: { debit: '1350.00', credit: '1170.00', debitBalance: '1180.00', creditBalance: '1000.00' },
      balanced: true,
    });
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Balance équilibrée');
    expect(root.textContent).toContain('1 350,00');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('balance : signale une anomalie quand elle est déséquilibrée', async () => {
    await create(TrialBalancePage, []);
    controller.expectOne((r) => r.url === '/api/reports/trial-balance').flush({
      rows: [{ accountId: 'a1', number: '512', label: 'Banque', debit: '10.00', credit: '0.00', debitBalance: '10.00', creditBalance: '0.00' }],
      totals: { debit: '10.00', credit: '0.00', debitBalance: '10.00', creditBalance: '0.00' },
      balanced: false,
    });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('déséquilibrée');
  });

  it('livre-journal : liste les écritures avec leur état et leurs totaux', async () => {
    await create(JournalBookPage, ['journals']);
    controller.expectOne((r) => r.url === '/api/reports/journal').flush({
      entries: [
        {
          id: 'e4', date: '2026-07-01', journalCode: 'OD', number: 4, label: 'Erreur', reference: 'FA-12', kind: 'NORMAL', status: 'REVERSED',
          lines: [
            { accountNumber: '606', accountLabel: 'Achats', label: null, debit: '50.00', credit: '0.00' },
            { accountNumber: '512', accountLabel: 'Banque', label: null, debit: '0.00', credit: '50.00' },
          ],
          totalDebit: '50.00', totalCredit: '50.00',
        },
      ],
    });
    await settle();
    const text = root.textContent!;
    expect(text).toContain('OD n° 4 — Erreur');
    expect(text).toContain('Réf. FA-12');
    expect(text).toContain('Contrepassée');
    expect(text).toContain('606 — Achats');
  });

  it('livre-journal : message clair quand il n’y a aucune écriture', async () => {
    await create(JournalBookPage, ['journals']);
    controller.expectOne((r) => r.url === '/api/reports/journal').flush({ entries: [] });
    await settle();
    expect(root.textContent).toContain('Aucune écriture comptabilisée');
  });
});
