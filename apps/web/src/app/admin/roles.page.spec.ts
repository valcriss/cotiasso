import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { groupPermissions, roleKeyFrom, themePermissions } from './role-dialog';
import { RolesPage } from './roles.page';

const catalog = [
  { key: 'entries:view', label: 'Consulter les écritures' },
  { key: 'entries:post', label: 'Comptabiliser les écritures', sensitive: true },
  { key: 'users:admin', label: 'Administrer les utilisateurs' },
];
const roles = [
  { id: 'r-reader', key: 'reader', name: 'Lecteur', description: 'Consultation', permissions: ['entries:view'], requiresMfa: false, version: 1 },
];

describe('groupPermissions', () => {
  it('regroupe les permissions par ressource en conservant leur ordre', () => {
    expect(groupPermissions(catalog)).toEqual([
      { resource: 'entries', permissions: [catalog[0], catalog[1]] },
      { resource: 'users', permissions: [catalog[2]] },
    ]);
  });
});

describe('themePermissions (#31)', () => {
  it('range les droits par grand thème, dans un ordre stable, sans rien perdre', () => {
    const all = groupPermissions([
      { key: 'users:admin', label: 'Créer des comptes' },
      { key: 'members:view', label: 'Voir la liste des membres' },
      { key: 'entries:post', label: 'Enregistrer définitivement', sensitive: true },
      { key: 'inconnu:view', label: 'Un droit futur' },
      { key: 'documents:view', label: 'Voir les documents' },
    ]);
    const themes = themePermissions(all);
    expect(themes.map((t) => t.title)).toEqual(['L’argent et la comptabilité', 'Les membres', 'Les documents', 'L’administration', 'Autres']);
    expect(themes.flatMap((t) => t.groups).length).toBe(all.length);
    expect(themes.at(-1)!.groups[0]!.resource).toBe('inconnu');
  });
});

describe('roleKeyFrom', () => {
  it("déduit un identifiant valide du nom, sans accents ni espaces", () => {
    expect(roleKeyFrom('Secrétaire général')).toBe('secretaire-general');
    expect(roleKeyFrom('2024 bureau')).toBe('role-2024-bureau');
  });
});

describe('RolesPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let ui: DialogTester;
  let fixture: ReturnType<typeof TestBed.createComponent<RolesPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const flushLists = () => {
    controller.expectOne('/api/roles').flush(roles);
    controller.expectOne('/api/authz/permissions').flush(catalog);
  };
  const create = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [RolesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RolesPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    flushLists();
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('range les droits par grand thème et signale ceux à confier avec soin (#31)', async () => {
    await create(['users:view', 'users:admin']);
    buttonWith('Nouveau rôle')!.click();
    await settle();
    expect(ui.text).toContain('L’argent et la comptabilité');
    expect(ui.text).toContain('L’administration');
    expect(ui.text).toMatch(/Comptabiliser les écritures\s*À confier avec soin/);
    expect(ui.text).not.toMatch(/Consulter les écritures\s*À confier avec soin/);
    expect(ui.text).toContain('donnent accès à la sécurité');
  });

  it('liste les rôles sans boutons de modification pour un simple lecteur', async () => {
    await create(['users:view']);
    expect(root.textContent).toContain('Lecteur');
    expect(root.textContent).toContain('1 droit(s)');
    expect(buttonWith('Modifier')).toBeUndefined();
    expect(buttonWith('Nouveau rôle')).toBeUndefined();
  });

  it("modifie les permissions d'un rôle et envoie le brouillon complet", async () => {
    await create(['users:view', 'users:admin']);
    buttonWith('Modifier')!.click();
    await settle();
    expect(ui.title).toContain('Modifier le rôle Lecteur');

    const boxes = ui.dialog!.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]');
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
    boxes[1]!.click();
    await settle();

    await ui.submit();
    const request = controller.expectOne('/api/roles/r-reader');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      name: 'Lecteur',
      description: 'Consultation',
      permissions: ['entries:view', 'entries:post'],
      requiresMfa: false,
    });
    request.flush({ ...roles[0], permissions: ['entries:view', 'entries:post'] });
    await settle();
    flushLists();
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Rôle « Lecteur » enregistré.');
  });

  it("crée un rôle sans demander d'identifiant technique et affiche le motif de refus du serveur", async () => {
    await create(['users:view', 'users:admin']);
    buttonWith('Nouveau rôle')!.click();
    await settle();

    await ui.submit();
    controller.expectNone('/api/roles');
    expect(ui.error).toContain('Vérifiez les champs');

    await ui.type('input[formControlName="name"]', 'Secrétaire');
    await ui.submit();
    const request = controller.expectOne('/api/roles');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ key: 'secretaire', name: 'Secrétaire', permissions: [] });
    request.flush({ message: 'Un rôle existe déjà avec cette clé.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.error).toContain('existe déjà');
  });
});
