import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { EntriesPage } from './entries.page';

const year = { id: 'y1', label: 'Exercice 2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' };
const journal = { id: 'j1', code: 'OD', label: 'Opérations diverses', type: 'MISC', active: true };
const bank = { id: 'a1', number: '512', label: 'Banque', active: true, reportLine: null };
const sales = { id: 'a2', number: '706', label: 'Prestations', active: true, reportLine: null };

const line = (position: number, accountId: string, debit: string, credit: string) => ({
  position,
  accountId,
  accountNumber: accountId === 'a1' ? '512' : '706',
  accountLabel: accountId === 'a1' ? 'Banque' : 'Prestations',
  debit,
  credit,
  label: null,
  allocations: [],
});
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  fiscalYearId: 'y1',
  journalId: 'j1',
  journalCode: 'OD',
  date: '2026-03-15',
  label: 'Cotisation',
  reference: null,
  kind: 'NORMAL',
  status: 'DRAFT',
  number: null,
  version: 1,
  postedAt: null,
  reversalOfId: null,
  reversedById: null,
  totalDebit: '50.00',
  totalCredit: '50.00',
  lines: [line(1, 'a1', '50.00', '0.00'), line(2, 'a2', '0.00', '50.00')],
  ...overrides,
});

describe('EntriesPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<EntriesPage>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], listed = [entry()]) => {
    await TestBed.configureTestingModule({
      imports: [EntriesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EntriesPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/fiscal-years').flush([year]);
    controller.expectOne('/api/journals').flush([journal]);
    await settle();
    controller.expectOne((r) => r.url === '/api/entries').flush({ entries: listed, next: null });
    await settle();
  };

  afterEach(() => controller.verify());

  it('liste les écritures avec leur état, montant et numéro', async () => {
    await create(['entries:view'], [entry(), entry({ id: 'e2', status: 'POSTED', number: 7, label: 'Loyer' })]);
    const text = root.textContent!;
    expect(text).toContain('Cotisation');
    expect(text).toContain('Brouillon');
    expect(text).toContain('Comptabilisée');
    expect(text).toContain('50,00');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(text).not.toContain('Nouvelle écriture');
  });

  it('propose de saisir une écriture et ouvre chaque écriture sur sa page', async () => {
    await create(['entries:view', 'entries:create']);
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).map((a) => [a.textContent!.replace('add', '').trim(), a.getAttribute('href')]);
    expect(links).toContainEqual(['Nouvelle écriture', '/ecritures/nouvelle']);
    expect(links).toContainEqual(['Ouvrir', '/ecritures/e1']);
  });

  it("guide l'utilisateur quand il n'y a encore aucune écriture", async () => {
    await create(['entries:view', 'entries:create'], []);
    expect(root.textContent).toContain('Aucune écriture');
    expect(root.textContent).toContain('Cliquez sur « Nouvelle écriture »');
  });
});
