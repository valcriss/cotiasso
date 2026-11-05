import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { MembersPage } from './members.page';

const member = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  firstName: 'Marie',
  lastName: 'Dupont',
  email: 'marie@asso.fr',
  phone: null,
  addressLine: '1 rue des Fleurs',
  postalCode: '69001',
  city: 'Lyon',
  categoryId: 'c1',
  categoryName: 'Adulte',
  status: 'ACTIVE',
  joinedOn: '2020-09-29',
  leftOn: null,
  hasAccount: false,
  note: null,
  anonymized: false,
  currentOffices: ['Trésorière'],
  version: 1,
  ...overrides,
});
const categories = [
  { id: 'c1', name: 'Adulte', active: true, memberCount: 1 },
  { id: 'c2', name: 'Ancienne catégorie', active: false, memberCount: 0 },
];

const officeRoles = [
  { id: 'r1', name: 'Secrétaire', active: true, mandateCount: 0 },
  { id: 'r2', name: 'Trésorière', active: true, mandateCount: 1 },
  { id: 'r3', name: 'Ancienne fonction', active: false, mandateCount: 2 },
];

describe('MembersPage', () => {
  let controller: HttpTestingController;
  let harness: RouterTestingHarness;
  const fixture = { detectChanges: () => harness.fixture.detectChanges(), whenStable: () => harness.fixture.whenStable() };
  /** La page courante : la liste et la fiche sont deux adresses, donc deux instances. */
  const root = () => harness.routeNativeElement as HTMLElement;
  const routes = [
    { path: 'membres/liste', component: MembersPage },
    { path: 'membres/liste/:id', component: MembersPage },
  ];
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  let currentRoles: object[] = officeRoles;
  const create = async (permissions: string[], list: object[] = [member()], roles: object[] = officeRoles) => {
    currentRoles = roles;
    await TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/membres/liste', MembersPage);
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(roles);
    await settle();
    controller.expectOne((r) => r.url === '/api/members').flush({ members: list, next: null });
    await settle();
  };
  const button = (label: string) => {
    const found = Array.from(root().querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label));
    expect(found, label).toBeTruthy();
    return found!;
  };
  const click = async (label: string) => {
    button(label).click();
    await settle();
  };
  const reload = async (_list: object[], detail: { member: object; offices: object[] }) => {
    controller.expectOne(`/api/members/${(detail.member as { id: string }).id}`).flush(detail);
    await settle();
  };
  const openFirst = async (offices: object[] = [], m: object = member()) => {
    await click('Ouvrir la fiche de Marie Dupont');
    // La fiche est une autre page (`/membres/liste/m1`) : nouvelle instance, donc catalogues rechargés.
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(currentRoles);
    await settle();
    controller.expectOne('/api/members/m1').flush({ member: m, offices });
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("liste les membres avec leur catégorie, leurs fonctions en cours et leur état, sans action en lecture seule", async () => {
    await create(['members:view']);
    const text = root().textContent!;
    expect(text).toContain('Dupont Marie');
    expect(text).toContain('Adulte');
    expect(text).toContain('Trésorière');
    expect(root().querySelector('.help')!.textContent).toContain("pas besoin d'un compte de connexion");
    expect(text).not.toContain('Nouveau membre');
  });

  it("montre la cotisation de la saison en cours de chaque membre, et le filtre qui la sélectionne (#20)", async () => {
    await TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), mockAuth(['members:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/membres/liste', MembersPage);
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(officeRoles);
    await settle();
    const states = ['UP_TO_DATE', 'EXEMPT', 'PARTIAL', 'DUE', 'NONE'];
    controller
      .expectOne((r) => r.url === '/api/members')
      .flush({ members: states.map((s, i) => member({ id: `m${i}`, firstName: `P${i}`, membershipStatus: s })), next: null, campaign: { id: 'c1', name: 'Saison 2026-2027' } });
    await settle();
    const rows = Array.from(root().querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[4]!.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['check_circle À jour', 'check_circle À jour (exonéré)', 'warning Payée en partie', 'warning En retard', 'radio_button_unchecked Pas inscrit']);
    expect(root().textContent).toContain('Cotisation — Saison 2026-2027');

    // Choisir « En retard » demande la liste filtrée au serveur.
    root().querySelector<HTMLElement>('mat-select[formcontrolname="membershipStatus"] .mat-mdc-select-trigger')!.click();
    await settle();
    Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container .mat-mdc-option')).find((o) => o.textContent!.includes('En retard'))!.click();
    await settle();
    await click('Rechercher');
    const filtered = controller.expectOne((r) => r.url === '/api/members');
    expect(filtered.request.params.get('membershipStatus')).toBe('LATE');
    filtered.flush({ members: [member({ id: 'm3', membershipStatus: 'DUE' })], next: null, campaign: { id: 'c1', name: 'Saison 2026-2027' } });
    await settle();
  });

  it("sans saison en cours, ne montre aucune situation de cotisation et le dit", async () => {
    await create(['members:view'], [member({ membershipStatus: null })]);
    expect(root().querySelector('tbody tr')!.querySelectorAll('td')[4]!.textContent!.trim()).toBe('—');
    expect(root().textContent).toContain('Aucune saison de cotisation n’est en cours.');
  });

  it("ouvre la liste déjà filtrée sur les cotisations en retard quand le lien de la vue d'ensemble le demande (?cotisation=late)", async () => {
    await TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ cotisation: 'late' }), paramMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({})) } },
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(['members:view']),
        NO_MATERIAL_ANIMATIONS,
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    const direct = TestBed.createComponent(MembersPage);
    harness = { fixture: direct, routeNativeElement: direct.nativeElement } as unknown as RouterTestingHarness;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(officeRoles);
    await settle();
    const request = controller.expectOne((r) => r.url === '/api/members');
    expect(request.request.params.get('membershipStatus')).toBe('LATE');
    request.flush({ members: [member({ membershipStatus: 'DUE' })], next: null, campaign: { id: 'c1', name: 'Saison' } });
    await settle();
    expect(root().textContent).toContain('En retard');
  });

  it("ouvre la fiche par un vrai lien vers sa propre page, et la liste garde ses colonnes secondaires pour le grand écran", async () => {
    await create(['members:view']);
    const link = root().querySelector<HTMLAnchorElement>('a.member-link')!;
    expect(link.getAttribute('href')).toBe('/membres/liste/m1');
    // Sur téléphone, seules les colonnes Nom et Cotisation restent visibles (classe `wide-only` masquée par la feuille de style).
    const hidden = Array.from(root().querySelectorAll('thead th.wide-only')).map((th) => th.textContent!.trim());
    expect(hidden).toEqual(['Catégorie', 'Fonctions', 'État', 'Ouvrir']);
  });

  it("charge directement la fiche de l'adresse (/membres/liste/m1), avec un retour vers la liste et sans charger la liste", async () => {
    await TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), mockAuth(['members:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/membres/liste/m1', MembersPage);
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(officeRoles);
    await settle();
    controller.expectOne('/api/members/m1').flush({ member: member(), offices: [] });
    await settle();
    expect(root().querySelector('section[aria-label="Fiche de Marie Dupont"]')).toBeTruthy();
    expect(root().querySelector('a[href="/membres/liste"]')!.textContent).toContain('Retour aux membres');
    expect(root().querySelector('table')).toBeNull();
    expect(root().querySelector('form.filters')).toBeNull();
  });

  it("dit en trois temps qu'une fiche est introuvable (404) et propose de revenir à la liste", async () => {
    await TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), mockAuth(['members:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/membres/liste/inconnu', MembersPage);
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(officeRoles);
    await settle();
    controller.expectOne('/api/members/inconnu').flush({ message: 'Introuvable' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root().textContent).toContain('Cette fiche est introuvable');
    expect(root().querySelector('a[href="/membres/liste"]')).toBeTruthy();
  });

  it("guide l'utilisateur quand il n'y a aucun membre", async () => {
    await create(['members:view', 'members:manage'], []);
    expect(root().textContent).toContain('Commencez par « Nouveau membre »');
  });

  it("crée un membre avec seulement le prénom et le nom, puis ouvre sa fiche", async () => {
    await create(['members:view', 'members:manage'], []);
    await click('Nouveau membre');
    expect(ui.title).toBe('Nouveau membre');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.type('input[formcontrolname="firstName"]', 'Léa');
    await ui.type('input[formcontrolname="lastName"]', 'Bernard');
    await ui.submit();
    const request = controller.expectOne('/api/members');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ firstName: 'Léa', lastName: 'Bernard', email: null, categoryId: null });
    request.flush(member({ id: 'm9', firstName: 'Léa', lastName: 'Bernard' }), { status: 201, statusText: 'Created' });
    await settle();
    // On arrive sur la page de la nouvelle fiche (`/membres/liste/m9`).
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne('/api/office-roles').flush(officeRoles);
    await settle();
    await reload([], { member: member({ id: 'm9', firstName: 'Léa', lastName: 'Bernard' }), offices: [] });
    expect(ui.snackbar).toContain('Fiche de Léa Bernard créée');
    expect(root().querySelector('section[aria-label="Fiche de Léa Bernard"]')).toBeTruthy();
  });

  it("explique un doublon d'email refusé par le serveur", async () => {
    await create(['members:view', 'members:manage'], []);
    await click('Nouveau membre');
    await ui.type('input[formcontrolname="firstName"]', 'Paul');
    await ui.type('input[formcontrolname="lastName"]', 'Martin');
    await ui.submit();
    controller.expectOne('/api/members').flush({ message: 'Un membre a déjà cette adresse email : vérifiez qu\'il ne s\'agit pas d\'un doublon.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.error).toContain('adresse email');
    expect(ui.isOpen).toBe(true);
  });

  it("affiche la fiche avec ses fonctions et propose d'en terminer une", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst([{ id: 'o1', officeRoleId: 'r2', title: 'Trésorière', startsOn: '2020-10-01', endsOn: null, note: null, current: true }]);
    const text = root().querySelector('section[aria-label="Fiche de Marie Dupont"]')!.textContent!;
    expect(text).toContain('1 rue des Fleurs, 69001 Lyon');
    expect(text).toContain('Trésorière');
    expect(text).toContain('en cours');
    await click('Terminer la fonction Trésorière');
    const patch = controller.expectOne('/api/member-offices/o1');
    expect(patch.request.body).toEqual({ endsOn: new Date().toISOString().slice(0, 10) });
    patch.flush({});
    await settle();
    await reload([member({ currentOffices: [] })], { member: member(), offices: [] });
    expect(ui.snackbar).toContain('terminée');
  });

  it("ajoute une fonction avec ses dates", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst();
    await click('Ajouter une fonction');
    expect(ui.title).toContain('Nouvelle fonction de Marie Dupont');
    await ui.choose('mat-select[formcontrolname="officeRoleId"]', 'Secrétaire');
    await ui.type('input[formcontrolname="startsOn"]', '2024-01-01');
    await ui.submit();
    const request = controller.expectOne('/api/members/m1/offices');
    expect(request.request.body).toEqual({ officeRoleId: 'r1', startsOn: '2024-01-01', endsOn: null });
    request.flush({ id: 'o2', officeRoleId: 'r1', title: 'Secrétaire', startsOn: '2024-01-01', endsOn: null, note: null, current: true }, { status: 201, statusText: 'Created' });
    await settle();
    await reload([member()], { member: member(), offices: [] });
    expect(ui.snackbar).toContain('Fonction « Secrétaire » ajoutée');
  });

  it("marque un membre comme sorti après confirmation, en rassurant sur l'historique", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst();
    await click('Marquer comme sorti');
    expect(ui.text).toContain('historique');
    await ui.click('Marquer comme sorti');
    const request = controller.expectOne('/api/members/m1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ status: 'FORMER', version: 1 });
    request.flush(member({ status: 'FORMER', leftOn: '2026-11-02', version: 2 }));
    await settle();
    await reload([member({ status: 'FORMER' })], { member: member({ status: 'FORMER', leftOn: '2026-11-02', version: 2 }), offices: [] });
    expect(ui.snackbar).toContain('sorti');
  });

  it("n'anonymise qu'un ancien membre, avec un motif, en prévenant que c'est définitif", async () => {
    await create(['members:view', 'members:manage'], [member({ status: 'FORMER', leftOn: '2026-01-01' })]);
    await openFirst([], member({ status: 'FORMER', leftOn: '2026-01-01' }));
    await click('Anonymiser');
    expect(ui.text).toContain('pour toujours');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.type('input[formcontrolname="reason"]', 'Demande de la personne');
    await ui.submit();
    const request = controller.expectOne('/api/members/m1/anonymize');
    expect(request.request.body).toEqual({ reason: 'Demande de la personne' });
    const anonymous = member({ status: 'FORMER', firstName: 'Ancien', lastName: 'membre', email: null, anonymized: true });
    request.flush(anonymous);
    await settle();
    await reload([anonymous], { member: anonymous, offices: [] });
    expect(ui.snackbar).toContain('Membre anonymisé');
    expect(root().textContent).toContain('est anonymisé');
  });

  it("dit si la fiche a un compte de connexion, sans proposer de lier à qui n'a pas le droit", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst();
    expect(root().textContent).toContain('Compte de connexion');
    expect(root().textContent).toContain('Aucun (pas nécessaire pour être membre)');
    expect(root().textContent).not.toContain('Associer à un compte utilisateur');
  });

  it("associe une fiche à un compte disponible, avec le droit de relier un membre à un compte", async () => {
    await create(['members:view', 'members.account:link']);
    await openFirst();
    expect(root().textContent).toContain('Le lien se fait tout seul quand un compte a la même adresse email');
    await click('Associer à un compte utilisateur');
    expect(ui.title).toContain('Associer Marie Dupont à un compte');
    controller.expectOne('/api/member-accounts/available').flush([
      { id: 'u1', email: 'marie.d@asso.fr', displayName: 'Marie D.' },
      { id: 'u2', email: 'autre@asso.fr', displayName: 'Autre' },
    ]);
    await settle();
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.choose('mat-select[formcontrolname="userId"]', 'Marie D. — marie.d@asso.fr');
    await ui.submit();
    const request = controller.expectOne('/api/members/m1/account');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ userId: 'u1' });
    request.flush({ hasAccount: true });
    await settle();
    controller.expectOne('/api/members/m1').flush({ member: member({ hasAccount: true }), offices: [] });
    await settle();
    expect(ui.snackbar).toContain('est associé(e) à un compte de connexion');
    expect(root().textContent).toContain('Relié : peut se connecter');
    expect(root().textContent).toContain('Détacher du compte');
  });

  it("explique quoi faire quand aucun compte n'est disponible, et garde la boîte ouverte si le serveur refuse", async () => {
    await create(['members:view', 'members.account:link']);
    await openFirst();
    await click('Associer à un compte utilisateur');
    controller.expectOne('/api/member-accounts/available').flush([{ id: 'u1', email: 'marie.d@asso.fr', displayName: 'Marie D.' }]);
    await settle();
    await ui.choose('mat-select[formcontrolname="userId"]', 'Marie D. — marie.d@asso.fr');
    await ui.submit();
    controller.expectOne('/api/members/m1/account').flush({ message: 'Ce compte est déjà relié à la fiche de Paul Martin.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('déjà relié à la fiche de Paul Martin');
  });

  it("détache le compte après confirmation, en rassurant sur la fiche et l'historique", async () => {
    await create(['members:view', 'members.account:link'], [member({ hasAccount: true })]);
    await openFirst([], member({ hasAccount: true }));
    expect(root().textContent).toContain('Relié : peut se connecter');
    expect(root().textContent).not.toContain('Associer à un compte utilisateur');
    await click('Détacher du compte');
    expect(ui.text).toContain('La fiche, ses adhésions et son historique sont conservés');
    await ui.click('Détacher');
    const request = controller.expectOne('/api/members/m1/account');
    expect(request.request.method).toBe('DELETE');
    request.flush({ hasAccount: false });
    await settle();
    controller.expectOne('/api/members/m1').flush({ member: member({ hasAccount: false }), offices: [] });
    await settle();
    expect(ui.snackbar).toContain('détachée du compte');
    expect(root().textContent).toContain('Associer à un compte utilisateur');
  });

  it("ne propose pas de lier une fiche d'ancien membre", async () => {
    await create(['members:view', 'members.account:link']);
    await openFirst([], member({ status: 'FORMER', leftOn: '2026-01-01' }));
    expect(root().textContent).not.toContain('Associer à un compte utilisateur');
  });

  it("gère les fonctions du bureau : liste, ajout et archivage, sans suppression", async () => {
    await create(['members:view', 'members:manage']);
    await click('Fonctions');
    expect(ui.title).toBe('Fonctions du bureau');
    expect(ui.text).toContain('Trésorière · 1 mandat(s)');
    expect(ui.text).toContain('(archivée)');
    expect(ui.text).not.toContain('Supprimer');
    await ui.type('input[formcontrolname="name"]', 'Vice-présidente');
    ui.dialog!.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    const created = controller.expectOne('/api/office-roles');
    expect(created.request.body).toEqual({ name: 'Vice-présidente' });
    created.flush({ id: 'r4', name: 'Vice-présidente', active: true, mandateCount: 0 }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/office-roles').flush([...officeRoles, { id: 'r4', name: 'Vice-présidente', active: true, mandateCount: 0 }]);
    await settle();
    expect(ui.text).toContain('Vice-présidente');
    (ui.dialog!.querySelector('button[aria-label="Archiver Secrétaire"]') as HTMLElement).click();
    await settle();
    const archived = controller.expectOne('/api/office-roles/r1');
    expect(archived.request.body).toEqual({ active: false });
    archived.flush({});
    await settle();
    controller.expectOne('/api/office-roles').flush(officeRoles.map((r) => (r.id === 'r1' ? { ...r, active: false } : r)));
    await settle();
    expect(ui.text).toContain('Secrétaire · 0 mandat(s) (archivée)');
  });

  it("propose les fonctions usuelles quand le catalogue est vide", async () => {
    await create(['members:view', 'members:manage'], [member()], []);
    await click('Fonctions');
    expect(ui.text).toContain('Aucune fonction pour l’instant');
    const starter = Array.from(ui.dialog!.querySelectorAll<HTMLElement>('.starters button')).find((b) => b.textContent!.trim() === 'Président')!;
    starter.click();
    await settle();
    const created = controller.expectOne('/api/office-roles');
    expect(created.request.body).toEqual({ name: 'Président' });
    created.flush({ id: 'r9', name: 'Président', active: true, mandateCount: 0 }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/office-roles').flush([{ id: 'r9', name: 'Président', active: true, mandateCount: 0 }]);
    await settle();
    expect(ui.text).toContain('Président · 0 mandat(s)');
  });

  it("n'ajoute pas de fonction à un membre tant que le catalogue est vide, et dit quoi faire", async () => {
    await create(['members:view', 'members:manage'], [member()], []);
    await openFirst();
    await click('Ajouter une fonction');
    expect(ui.text).toContain('Aucune fonction n’est disponible');
  });

  it("gère les catégories : liste, ajout et désactivation", async () => {
    await create(['members:view', 'members:manage']);
    await click('Catégories');
    expect(ui.title).toBe('Catégories de membres');
    expect(ui.text).toContain('Adulte · 1 membre(s)');
    expect(ui.text).toContain('(désactivée)');
    await ui.type('input[formcontrolname="name"]', 'Étudiant');
    ui.dialog!.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    controller.expectOne('/api/member-categories').flush({ id: 'c3', name: 'Étudiant', active: true, memberCount: 0 }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/member-categories').flush([...categories, { id: 'c3', name: 'Étudiant', active: true, memberCount: 0 }]);
    await settle();
    expect(ui.text).toContain('Étudiant');
  });
});
