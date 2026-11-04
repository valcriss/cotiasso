import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { OverviewPage } from './overview.page';

const complete = { fiscalYear: true, accounts: true, financialAccount: true, categories: true };
const view = (overrides: Record<string, unknown> = {}) => ({
  setup: complete,
  cash: { total: '1250.50', accounts: [{ id: 'f1', name: 'Compte courant', balance: '1000.50' }, { id: 'f2', name: 'Caisse', balance: '250.00' }] },
  month: { from: '2026-11-01', to: '2026-11-30', received: '300.00', spent: '45.20' },
  todo: [],
  ...overrides,
});

describe('OverviewPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<OverviewPage>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], body: object) => {
    await TestBed.configureTestingModule({
      imports: [OverviewPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OverviewPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/overview').flush(body);
    await settle();
  };

  afterEach(() => {
    controller.match(() => true);
  });

  it("montre l'argent disponible, le mois en cours et dit que tout est à jour quand il n'y a rien à faire", async () => {
    await create(['financial-accounts:view'], view());
    const text = root.textContent!;
    expect(root.querySelector('h1')!.textContent).toContain('Vue d’ensemble');
    expect(text).toContain('Argent disponible');
    expect(text).toContain('1 250,50 €');
    expect(text).toContain('Caisse : 250,00 €');
    expect(text).toContain('Reçu ce mois-ci');
    expect(text).toContain('300,00 €');
    expect(text).toContain('45,20 €');
    expect(text).toContain('tout est à jour');
    expect(text).not.toContain('Commençons par préparer');
  });

  it("ne propose plus « Démarrer » quand tout est prêt, même si le mode de démarrage n'a jamais été choisi (vu à l'essai sur téléphone)", async () => {
    await create(['settings.accounting:admin', 'financial-accounts:view'], view({ setup: { ...complete, startMode: null, openingSituation: 'NONE' } }));
    expect(root.textContent).not.toContain('Commençons par préparer');
    TestBed.resetTestingModule();
    await create(['settings.accounting:admin', 'financial-accounts:view'], view({ setup: { ...complete, categories: false, startMode: null, openingSituation: 'NONE' } }));
    expect(root.textContent).toContain('Commençons par préparer');
  });

  it('montre les dernières opérations avec leur situation en mots courants, et rien sans droit de lecture (#27)', async () => {
    const recent = [
      { id: 't1', date: '2026-11-02', label: 'Cotisation Dupont', amount: '30.00', accountName: 'Compte courant', situation: 'BOOKED' },
      { id: 't2', date: '2026-11-01', label: 'Prélèvement MAIF', amount: '-52.00', accountName: 'Compte courant', situation: 'TO_CLASSIFY' },
      { id: 't3', date: '2026-10-30', label: 'Vente gâteaux', amount: '80.00', accountName: 'Caisse', situation: 'DRAFT' },
    ];
    await create(['financial-accounts:view'], view({ recent }));
    const panel = root.querySelector('[aria-label="Dernières opérations"]')!;
    const rows = Array.from(panel.querySelectorAll('li')).map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual([
      '02/11/2026Cotisation DupontCompte courant · enregistrée dans les comptes30,00 €',
      '01/11/2026Prélèvement MAIFCompte courant · à classer-52,00 €',
      '30/10/2026Vente gâteauxCaisse · en brouillon80,00 €',
    ]);
    expect(panel.querySelector('a')!.getAttribute('href')).toBe('/comptes');
  });

  it('n’affiche pas de dernières opérations sans droit de lecture des comptes ni quand il n’y en a pas', async () => {
    await create([], view({ cash: null, month: null, recent: null }));
    expect(root.querySelector('[aria-label="Dernières opérations"]')).toBeNull();
    TestBed.resetTestingModule();
    await create(['financial-accounts:view'], view({ recent: [] }));
    expect(root.querySelector('[aria-label="Dernières opérations"]')).toBeNull();
  });

  it('ouvre l’écran concerné déjà filtré quand la tâche le demande (compte à classer, cotisations en retard)', async () => {
    await create(['financial-accounts:view', 'members:view'], view({
      todo: [
        { code: 'TO_CLASSIFY', level: 'TODO', title: '3 mouvements à classer', detail: 'x', count: 3, link: '/comptes', query: { compte: 'f1' }, actionLabel: 'Classer' },
        { code: 'MEMBERSHIPS_LATE', level: 'INFO', title: '2 cotisations restent à payer (60,00 €)', detail: 'y', count: 2, link: '/membres', query: { cotisation: 'late' }, actionLabel: 'Voir' },
      ],
    }));
    const hrefs = Array.from(root.querySelectorAll('ul.todo a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/comptes?compte=f1', '/membres?cotisation=late']);
  });

  it('liste ce qu’il reste à faire, chaque tâche renvoyant à l’écran qui la règle', async () => {
    await create(
      ['financial-accounts:view', 'entries:view'],
      view({
        todo: [
          { code: 'TO_CLASSIFY', level: 'TODO', title: '3 mouvements à classer', detail: "Dites d'où vient l'argent.", count: 3, link: '/comptes', actionLabel: 'Classer' },
          { code: 'DRAFTS', level: 'WARNING', title: '1 brouillon à relire', detail: 'Il ne compte pas encore.', count: 1, link: '/comptabilite', actionLabel: 'Relire' },
        ],
      }),
    );
    expect(root.textContent).toContain('3 mouvements à classer');
    expect(root.textContent).toContain('1 brouillon à relire');
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('ul.todo a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/comptes', '/comptabilite']);
    expect(root.textContent).not.toContain('tout est à jour');
  });

  it('propose les deux gestes du quotidien seulement à qui peut saisir', async () => {
    await create(['financial-accounts:view'], view());
    expect(root.querySelector('app-page-header button')).toBeNull();
  });

  it('propose « J’ai reçu » et « J’ai dépensé » à qui peut saisir et comptabiliser', async () => {
    TestBed.resetTestingModule();
    await create(['financial-accounts:view', 'transactions:manage', 'entries:create'], view());
    const buttons = Array.from(root.querySelectorAll('app-page-header button')).map((b) => b.textContent!.trim());
    expect(buttons.join('|')).toContain('J’ai reçu de l’argent');
    expect(buttons.join('|')).toContain('J’ai dépensé de l’argent');
  });

  it("accueille une installation vide par l'assistant de démarrage, pour qui peut l'administrer", async () => {
    TestBed.resetTestingModule();
    await create(['settings.accounting:admin'], view({ setup: { fiscalYear: false, accounts: false, financialAccount: false, categories: false }, cash: null, month: null }));
    expect(root.textContent).toContain('Commençons par préparer votre association');
    expect(root.querySelector('a[href="/demarrage"]')).not.toBeNull();
    expect(root.textContent).not.toContain('Argent disponible');
  });

  it("n'affiche pas l'assistant à qui ne peut pas l'utiliser", async () => {
    TestBed.resetTestingModule();
    await create(['financial-accounts:view'], view({ setup: { fiscalYear: false, accounts: false, financialAccount: false, categories: false } }));
    expect(root.textContent).not.toContain('Commençons par préparer');
  });

  it('explique l’échec de chargement au lieu de rester vide', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OverviewPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth([])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OverviewPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/overview').flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('vue d\'ensemble');
  });
});
