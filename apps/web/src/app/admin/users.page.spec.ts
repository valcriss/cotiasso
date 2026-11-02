import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { UsersPage } from './users.page';

const roles = [
  { id: 'r-admin', key: 'technical-admin', name: 'Administrateur technique', description: '', permissions: ['users:admin'], requiresMfa: false, version: 1 },
  { id: 'r-reader', key: 'reader', name: 'Lecteur', description: '', permissions: ['projects:view'], requiresMfa: false, version: 1 },
];
const users = [
  {
    id: 'u-self',
    email: 'admin@asso.fr',
    displayName: 'Admin',
    status: 'ACTIVE',
    roleAssignments: [{ id: 'a1', startsAt: '', endsAt: null, role: { id: 'r-admin', key: 'technical-admin', name: 'Administrateur technique' } }],
  },
  { id: 'u-marie', email: 'marie@asso.fr', displayName: 'Marie', status: 'ACTIVE', roleAssignments: [] },
  { id: 'u-paul', email: 'paul@asso.fr', displayName: 'Paul', status: 'DISABLED', roleAssignments: [] },
];

describe('UsersPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let ui: DialogTester;
  let fixture: ReturnType<typeof TestBed.createComponent<UsersPage>>;

  const create = async (permissions: string[], projects: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UsersPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    await flushLists(projects);
    await settle();
  };
  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const flushLists = async (projects: object[] = []) => {
    controller.expectOne('/api/users').flush(users);
    controller.expectOne('/api/roles').flush(roles);
    await settle();
    controller.expectOne('/api/projects').flush(projects);
  };
  const click = async (selector: string, index = 0) => {
    root.querySelectorAll<HTMLElement>(selector)[index]!.click();
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('liste les utilisateurs avec leurs rôles et leur état', async () => {
    await create(['users:view']);
    const text = root.textContent!;
    expect(text).toContain('Marie');
    expect(text).toContain('marie@asso.fr');
    expect(text).toContain('Administrateur technique');
    expect(text).toContain('Désactivé');
  });

  it("n'offre aucune action d'administration sans la permission users:admin", async () => {
    await create(['users:view']);
    expect(buttonWith('Inviter')).toBeUndefined();
    expect(buttonWith('Gérer')).toBeUndefined();
    expect(root.querySelector('.chip-remove')).toBeNull();
  });

  it("invite un utilisateur et affiche une seule fois le lien complet", async () => {
    await create(['users:view', 'users:admin']);
    buttonWith('Inviter')!.click();
    await settle();

    await ui.type('input[formControlName="displayName"]', 'Nouvelle Personne');
    await ui.type('input[formControlName="email"]', 'nouvelle@asso.fr');
    await ui.submit();

    const request = controller.expectOne('/api/users');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ displayName: 'Nouvelle Personne', email: 'nouvelle@asso.fr', roleIds: [] });
    request.flush({
      user: users[1],
      invitation: { token: 't', path: '/reinitialisation#token=t', expiresAt: '2026-11-04T10:00:00.000Z', purpose: 'INVITATION' },
    });
    await settle();
    await flushLists();
    await settle();

    const shown = ui.field<HTMLInputElement>('input[readonly]');
    expect(shown.value).toBe(`${window.location.origin}/reinitialisation#token=t`);
    expect(ui.text).toContain('ne sera plus affiché');
  });

  it('demande confirmation avant de désactiver, puis désactive', async () => {
    await create(['users:view', 'users:admin']);
    await click('td.row-actions button', 1);
    expect(buttonWith('Désactiver')).toBeDefined();

    buttonWith('Désactiver')!.click();
    await settle();
    controller.expectNone('/api/users/u-marie/disable');
    expect(ui.text).toContain('Désactiver Marie ?');

    await ui.click('Désactiver');
    controller.expectOne('/api/users/u-marie/disable').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await flushLists();
    await settle();
    expect(ui.snackbar).toContain('Marie est désactivé(e).');
  });

  it('ne propose pas de désactiver son propre compte', async () => {
    await create(['users:view', 'users:admin']);
    await click('td.row-actions button', 0);
    expect(buttonWith('Désactiver')).toBeUndefined();
    expect(buttonWith('Lien de réinitialisation')).toBeDefined();
  });

  it('affiche le motif de refus du serveur, par exemple pour le dernier administrateur', async () => {
    await create(['users:view', 'users:admin']);
    root.querySelector<HTMLButtonElement>('.chip-remove')!.click();
    await settle();
    controller
      .expectOne('/api/assignments/a1')
      .flush({ message: 'Cette action retirerait le dernier compte actif pouvant administrer les utilisateurs.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('dernier compte actif');
  });

  it('propose de réactiver un compte désactivé', async () => {
    await create(['users:view', 'users:admin']);
    await click('td.row-actions button', 2);
    expect(buttonWith('Réactiver')).toBeDefined();
    expect(buttonWith('Désactiver')).toBeUndefined();
  });

  it("propose de limiter un rôle à un projet et envoie le projet choisi", async () => {
    await create(['users:view', 'users:admin'], [{ id: 'p1', code: 'ATELIERS', name: 'Ateliers' }]);
    await click('td.row-actions button', 1);
    expect(root.textContent).toContain('Portée du rôle ajouté');

    // Le sélecteur de portée est le premier de la zone ; on choisit le projet puis un rôle.
    const [scope, role] = Array.from(root.querySelectorAll<HTMLElement>('.detail-actions mat-select'));
    scope!.querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await settle();
    Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-option')).find((o) => o.textContent!.includes('Projet ATELIERS'))!.click();
    await settle();
    role!.querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await settle();
    Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-option')).find((o) => o.textContent!.includes('Lecteur'))!.click();
    await settle();

    const request = controller.expectOne('/api/users/u-marie/assignments');
    expect(request.request.body).toEqual({ roleId: 'r-reader', projectId: 'p1' });
    request.flush({});
    await settle();
    await flushLists([{ id: 'p1', code: 'ATELIERS', name: 'Ateliers' }]);
    await settle();
  });

  it("montre le projet d'une attribution à portée projet à côté du rôle", async () => {
    users[1] = { ...users[1]!, roleAssignments: [{ id: 'a9', startsAt: '', endsAt: null, role: { id: 'r-reader', key: 'reader', name: 'Lecteur' }, project: { id: 'p1', code: 'ATELIERS', name: 'Ateliers' } }] } as never;
    await create(['users:view']);
    expect(root.textContent).toContain('Lecteur · ATELIERS');
  });

  it("affiche les accès effectifs : droits sur toute l'association et sur un projet, avec le rôle qui les accorde", async () => {
    await create(['users:view', 'users:admin']);
    await click('td.row-actions button', 1);
    buttonWith('Voir les accès')!.click();
    await settle();
    controller.expectOne('/api/users/u-marie/access').flush({
      permissions: [{ permission: 'documents:view', label: 'Consulter les documents', grantedBy: [{ assignmentId: 'a1', roleId: 'r-reader', roleKey: 'reader', roleName: 'Lecteur' }] }],
      projectPermissions: [
        { permission: 'projects:update', label: 'Modifier les projets', projectId: 'p1', projectCode: 'ATELIERS', projectName: 'Ateliers', grantedBy: { assignmentId: 'a2', roleId: 'r-pm', roleKey: 'project-manager', roleName: 'Chef de projet' } },
      ],
    });
    await settle();
    const text = document.querySelector('.mat-mdc-dialog-container')!.textContent!;
    expect(text).toContain('Accès de Marie');
    expect(text).toContain('Consulter les documents');
    expect(text).toContain('Lecteur');
    expect(text).toContain('ATELIERS');
    expect(text).toContain('Chef de projet');
    ui.closeAll();
  });
});
