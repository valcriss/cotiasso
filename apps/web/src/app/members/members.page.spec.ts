import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

describe('MembersPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<MembersPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], list: object[] = [member()]) => {
    await TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MembersPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/member-categories').flush(categories);
    await settle();
    controller.expectOne((r) => r.url === '/api/members').flush({ members: list, next: null });
    await settle();
  };
  const button = (label: string) => {
    const found = Array.from(root.querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label));
    expect(found, label).toBeTruthy();
    return found!;
  };
  const click = async (label: string) => {
    button(label).click();
    await settle();
  };
  const reload = async (list: object[], detail: { member: object; offices: object[] }) => {
    controller.expectOne((r) => r.url === '/api/members').flush({ members: list, next: null });
    await settle();
    controller.expectOne(`/api/members/${(detail.member as { id: string }).id}`).flush(detail);
    await settle();
  };
  const openFirst = async (offices: object[] = [], m: object = member()) => {
    await click('Ouvrir la fiche de Marie Dupont');
    controller.expectOne('/api/members/m1').flush({ member: m, offices });
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("liste les membres avec leur catégorie, leurs fonctions en cours et leur état, sans action en lecture seule", async () => {
    await create(['members:view']);
    const text = root.textContent!;
    expect(text).toContain('Dupont Marie');
    expect(text).toContain('Adulte');
    expect(text).toContain('Trésorière');
    expect(root.querySelector('.description')!.textContent).toContain("pas besoin d'un compte de connexion");
    expect(text).not.toContain('Nouveau membre');
  });

  it("guide l'utilisateur quand il n'y a aucun membre", async () => {
    await create(['members:view', 'members:manage'], []);
    expect(root.textContent).toContain('Commencez par « Nouveau membre »');
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
    await reload([member({ id: 'm9', firstName: 'Léa', lastName: 'Bernard' })], { member: member({ id: 'm9', firstName: 'Léa', lastName: 'Bernard' }), offices: [] });
    expect(ui.snackbar).toContain('Fiche de Léa Bernard créée');
    expect(root.querySelector('section[aria-label="Fiche de Léa Bernard"]')).toBeTruthy();
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
    await openFirst([{ id: 'o1', title: 'Trésorière', startsOn: '2020-10-01', endsOn: null, note: null, current: true }]);
    const text = root.querySelector('section[aria-label="Fiche de Marie Dupont"]')!.textContent!;
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
    await ui.type('input[formcontrolname="title"]', 'Secrétaire');
    await ui.type('input[formcontrolname="startsOn"]', '2024-01-01');
    await ui.submit();
    const request = controller.expectOne('/api/members/m1/offices');
    expect(request.request.body).toEqual({ title: 'Secrétaire', startsOn: '2024-01-01', endsOn: null });
    request.flush({ id: 'o2', title: 'Secrétaire', startsOn: '2024-01-01', endsOn: null, note: null, current: true }, { status: 201, statusText: 'Created' });
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
    expect(root.textContent).toContain('est anonymisé');
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
