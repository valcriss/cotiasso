import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { RolesPage, groupPermissions } from './roles.page';

const catalog = [
  { key: 'entries:view', label: 'Consulter les écritures' },
  { key: 'entries:post', label: 'Comptabiliser les écritures' },
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

describe('RolesPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
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
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RolesPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    flushLists();
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  afterEach(() => controller.verify());

  it('liste les rôles sans boutons de modification pour un simple lecteur', async () => {
    await create(['users:view']);
    expect(root.textContent).toContain('Lecteur');
    expect(root.textContent).toContain('1 permission(s)');
    expect(buttonWith('Modifier')).toBeUndefined();
    expect(buttonWith('Nouveau rôle')).toBeUndefined();
  });

  it("modifie les permissions d'un rôle et envoie le brouillon complet", async () => {
    await create(['users:view', 'users:admin']);
    buttonWith('Modifier')!.click();
    await settle();

    const boxes = root.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]');
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
    boxes[1]!.click();
    await settle();

    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
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
  });

  it('crée un rôle avec une clé valide et affiche le motif de refus du serveur', async () => {
    await create(['users:view', 'users:admin']);
    buttonWith('Nouveau rôle')!.click();
    await settle();

    const set = (index: number, value: string) => {
      const inputs = root.querySelectorAll<HTMLInputElement>('form input[matInput], form input.mat-mdc-input-element');
      inputs[index]!.value = value;
      inputs[index]!.dispatchEvent(new Event('input'));
    };
    set(0, 'Cle Invalide');
    set(1, 'Secrétaire');
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    controller.expectNone('/api/roles');
    expect(root.textContent).toContain('Minuscules, chiffres et tirets');

    set(0, 'secretaire');
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    const request = controller.expectOne('/api/roles');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ key: 'secretaire', name: 'Secrétaire', permissions: [] });
    request.flush({ message: 'Un rôle existe déjà avec cette clé.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('existe déjà');
  });
});
