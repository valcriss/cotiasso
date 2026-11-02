import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { actionLabel } from './audit-labels';
import { AuditPage, dayBound } from './audit.page';

const entry = (seq: number, overrides: Record<string, unknown> = {}) => ({
  seq,
  id: `id-${seq}`,
  occurredAt: '2026-11-01T10:00:00.000Z',
  action: 'auth.login.success',
  objectType: 'User',
  objectId: `u-${seq}`,
  justification: null,
  details: { ipAddress: '203.0.113.7' },
  actor: { id: 'a1', displayName: 'Marie Dupont', email: 'marie@asso.fr' },
  ...overrides,
});
const facets = { actions: ['auth.login.success', 'role.assigned', 'action.inconnue'], objectTypes: ['User', 'Role'] };

describe('helpers', () => {
  it('traduit les actions connues et laisse les autres telles quelles', () => {
    expect(actionLabel('role.assigned')).toBe('Rôle attribué');
    expect(actionLabel('action.inconnue')).toBe('action.inconnue');
  });

  it('borne une période sur des jours entiers en heure locale', () => {
    expect(dayBound('', false)).toBeUndefined();
    expect(dayBound('pas-une-date', false)).toBeUndefined();
    const from = new Date(dayBound('2026-11-01', false)!);
    const to = new Date(dayBound('2026-11-01', true)!);
    expect(to.getTime() - from.getTime()).toBe(86_400_000 - 1);
  });
});

describe('AuditPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<AuditPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (firstPage: object) => {
    await TestBed.configureTestingModule({
      imports: [AuditPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['audit:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AuditPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/audit/facets').flush(facets);
    await settle();
    controller.expectOne((req) => req.url === '/api/audit').flush(firstPage);
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  afterEach(() => controller.verify());

  it("affiche les événements avec l'acteur, l'action traduite et les détails repliés", async () => {
    await create({ items: [entry(2), entry(1, { action: 'role.assigned', actor: null, details: null })], nextCursor: null });
    const text = root.textContent!;
    expect(text).toContain('Marie Dupont');
    expect(text).toContain('marie@asso.fr');
    expect(text).toContain('Connexion réussie');
    expect(text).toContain('Rôle attribué');
    expect(text).toContain('Système ou inconnu');
    expect(root.querySelectorAll('details')).toHaveLength(1);
    expect(root.querySelector('details pre')!.textContent).toContain('203.0.113.7');
    expect(root.textContent).not.toContain('Charger plus');
  });

  it('indique quand aucun événement ne correspond', async () => {
    await create({ items: [], nextCursor: null });
    expect(root.textContent).toContain('Aucun événement ne correspond');
  });

  it('charge la page suivante à partir du curseur et ajoute les événements', async () => {
    await create({ items: [entry(5), entry(4)], nextCursor: 4 });
    buttonWith('Charger plus')!.click();
    await settle();
    const request = controller.expectOne((req) => req.url === '/api/audit');
    expect(request.request.params.get('before')).toBe('4');
    expect(request.request.params.get('limit')).toBe('50');
    request.flush({ items: [entry(3)], nextCursor: null });
    await settle();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(root.textContent).not.toContain('Charger plus');
  });

  it('envoie les critères du filtre et repart du début', async () => {
    await create({ items: [entry(5)], nextCursor: null });
    const dates = root.querySelectorAll<HTMLInputElement>('input[type="date"]');
    dates[0]!.value = '2026-11-01';
    dates[0]!.dispatchEvent(new Event('input'));
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();

    const request = controller.expectOne((req) => req.url === '/api/audit');
    expect(request.request.params.get('from')).toBe(dayBound('2026-11-01', false));
    expect(request.request.params.has('before')).toBe(false);
    request.flush({ items: [entry(9)], nextCursor: null });
    await settle();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it("propose l'export CSV du journal complet, puis des seuls critères réellement recherchés", async () => {
    await create({ items: [entry(5)], nextCursor: null });
    const link = () => root.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(link().getAttribute('href')).toBe('/api/audit/csv?');
    expect(link().textContent).toContain('Exporter (CSV)');

    // Saisir un critère sans lancer la recherche ne change pas l'export : il reprend ce qui est affiché.
    const dates = root.querySelectorAll<HTMLInputElement>('input[type="date"]');
    dates[0]!.value = '2026-11-01';
    dates[0]!.dispatchEvent(new Event('input'));
    await settle();
    expect(link().getAttribute('href')).toBe('/api/audit/csv?');

    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    controller.expectOne((req) => req.url === '/api/audit').flush({ items: [entry(9)], nextCursor: null });
    await settle();
    expect(link().getAttribute('href')).toBe(`/api/audit/csv?from=${encodeURIComponent(dayBound('2026-11-01', false)!)}`);
  });

  it("annonce une chaîne intacte, avec les événements antérieurs non vérifiables", async () => {
    await create({ items: [entry(1)], nextCursor: null });
    buttonWith("Vérifier l'intégrité")!.click();
    await settle();
    controller.expectOne('/api/audit/verify').flush({ ok: true, checked: 42, unchained: 3, firstBrokenSeq: null, reason: null });
    await settle();
    const text = root.querySelector('[role="status"]')!.textContent!;
    expect(text).toContain('Chaîne intacte');
    expect(text).toContain('42 événement');
    expect(text).toContain('3 événement(s) antérieur');
  });

  it("signale l'événement où une altération est détectée", async () => {
    await create({ items: [entry(1)], nextCursor: null });
    buttonWith("Vérifier l'intégrité")!.click();
    await settle();
    controller
      .expectOne('/api/audit/verify')
      .flush({ ok: false, checked: 10, unchained: 0, firstBrokenSeq: 11, reason: "Le contenu de l'événement a été modifié." });
    await settle();
    const alert = root.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('n° 11');
    expect(alert).toContain('modifié');
  });
});
