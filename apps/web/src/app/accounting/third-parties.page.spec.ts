import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ThirdPartiesPage } from './third-parties.page';

const years = [
  { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' },
  { id: 'y26', label: '2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' },
];
const parties = [
  { id: 't1', kind: 'MEMBER', name: 'Marie Dupont', memberId: 'm1', funderId: null, note: '', archived: false },
  { id: 't2', kind: 'SUPPLIER', name: 'Imprimerie Martin', memberId: null, funderId: null, note: 'Affiches', archived: false },
];
const report = (overrides: Record<string, unknown> = {}) => ({
  fiscalYear: { id: 'y26', label: '2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' },
  rows: [
    { id: 't1', name: 'Marie Dupont', kind: 'MEMBER', net: '140.00', owedToYou: '140.00', youOwe: '0.00', accounts: [{ number: '411', label: 'Adhérents', net: '140.00' }] },
    { id: 't2', name: 'Imprimerie Martin', kind: 'SUPPLIER', net: '-120.00', owedToYou: '0.00', youOwe: '120.00', accounts: [{ number: '401', label: 'Fournisseurs', net: '-120.00' }] },
  ],
  totals: { owedToYou: '140.00', youOwe: '120.00' },
  untracked: { lines: 0, net: '0.00' },
  carryWarning: null,
  ...overrides,
});

describe('ThirdPartiesPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ThirdPartiesPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], data: object | 'error' = report(), list: object[] = parties) => {
    await TestBed.configureTestingModule({
      imports: [ThirdPartiesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ThirdPartiesPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/fiscal-years').flush(years);
    controller.expectOne('/api/third-parties').flush(list);
    await settle();
    const request = controller.expectOne('/api/reports/third-parties');
    if (data === 'error') request.flush({ message: 'Accès refusé.' }, { status: 403, statusText: 'Forbidden' });
    else request.flush(data);
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes(label) || b.getAttribute('aria-label')?.includes(label));
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('dit qui doit quoi, personne par personne, avec les totaux et les comptes concernés', async () => {
    await create(['entries:view']);
    const text = root.textContent!;
    expect(text).toContain('Qui vous doit de l’argent');
    expect(text).toContain('exercice 2026');
    const rows = Array.from(root.querySelectorAll('section[aria-label="Sommes par personne"] tbody tr')).map((tr) => tr.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Marie Dupont');
    expect(rows[0]).toContain('Adhérent');
    expect(rows[0]).toContain('140,00 €');
    expect(rows[0]).toContain('411 Adhérents');
    expect(rows[1]).toContain('Imprimerie Martin');
    expect(rows[1]).toContain('120,00 €');
    const total = root.querySelector('section[aria-label="Sommes par personne"] tfoot')!.textContent!.replace(/\s+/g, ' ');
    expect(total).toContain('140,00 €');
    expect(total).toContain('120,00 €');
  });

  it('prévient quand l’exercice précédent n’est pas clôturé et signale les lignes sans tiers, sans les inclure', async () => {
    await create(['entries:view'], report({ carryWarning: 'L’exercice précédent (« 2025 ») n’est pas clôturé.', untracked: { lines: 2, net: '7.00' } }));
    expect(root.querySelector('[role="status"]')!.textContent).toContain('n’est pas clôturé');
    expect(root.textContent).toContain('2 ligne(s) de comptes de tiers n’ont pas de tiers indiqué');
    expect(root.textContent).toContain('7,00 €');
  });

  it('dit quoi faire en premier quand rien n’est suivi par personne', async () => {
    await create(['entries:view'], report({ rows: [], totals: { owedToYou: '0.00', youOwe: '0.00' } }), []);
    expect(root.textContent).toContain('Aucune somme à recevoir ou à payer n’est suivie par personne');
    expect(root.textContent).toContain('Aucun tiers pour l’instant');
    expect(root.querySelector('section[aria-label="Sommes par personne"] table')).toBeNull();
  });

  it('change d’exercice en rechargeant les sommes de cet exercice', async () => {
    await create(['entries:view']);
    const select = root.querySelector('mat-select[aria-label="Exercice"]') as HTMLElement;
    select.querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await settle();
    const option = Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-option')).find((o) => o.textContent!.includes('2025'))!;
    option.click();
    await settle();
    const request = controller.expectOne((r) => r.url === '/api/reports/third-parties');
    expect(request.request.params.get('fiscalYearId')).toBe('y25');
    request.flush(report({ fiscalYear: { id: 'y25', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'CLOSED' }, rows: [], totals: { owedToYou: '0.00', youOwe: '0.00' } }));
    await settle();
    expect(root.textContent).toContain('exercice 2025');
  });

  it('archive un tiers seulement après confirmation, en disant que cela ne se défait pas', async () => {
    await create(['entries:view', 'entries:create', 'settings.accounting:admin']);
    await click('Archiver Imprimerie Martin');
    expect(ui.title).toContain('Archiver « Imprimerie Martin » ?');
    expect(ui.text).toContain('ne se défait pas');
    await ui.click('Archiver');
    const post = controller.expectOne('/api/third-parties/t2/archive');
    expect(post.request.method).toBe('POST');
    post.flush({ ...parties[1], archived: true });
    await settle();
    controller.expectOne('/api/third-parties').flush([parties[0]]);
    await settle();
    expect(ui.snackbar).toContain('« Imprimerie Martin » archivé');
  });

  it('ne propose ni ajout ni archivage sans les droits correspondants', async () => {
    await create(['entries:view']);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Ajouter un tiers'))).toBe(false);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Archiver'))).toBe(false);
  });

  it('ajoute un tiers puis recharge la liste', async () => {
    await create(['entries:view', 'entries:create']);
    await click('Ajouter un tiers');
    controller.expectOne('/api/members').flush({ members: [], next: null });
    controller.expectOne('/api/funders').flush([]);
    await settle();
    await ui.type('input[formcontrolname="name"]', 'Mairie');
    await ui.submit();
    controller.expectOne('/api/third-parties').flush({ id: 't3', kind: 'OTHER', name: 'Mairie', memberId: null, funderId: null, note: '', archived: false }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne((r) => r.method === 'GET' && r.url === '/api/third-parties').flush([...parties, { id: 't3', kind: 'OTHER', name: 'Mairie', memberId: null, funderId: null, note: '', archived: false }]);
    await settle();
    expect(root.textContent).toContain('Mairie');
  });

  it('affiche le refus du serveur', async () => {
    await create(['entries:view'], 'error');
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Accès refusé');
  });
});
