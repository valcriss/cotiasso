import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { AccountPage } from './account.page';

/** Le panneau des clés d'accès lit son état à l'ouverture : on répond « désactivées », sans clé. */
const NO_PASSKEYS = { mode: 'DISABLED', usernameless: false, canRegister: false, items: [] };

const CURRENT = 'une phrase de passe correcte';
const NEXT = 'un nouveau mot de passe valide';

describe('AccountPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<AccountPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const fill = (current: string, next: string, confirmation: string) => {
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    [current, next, confirmation].forEach((value, index) => {
      inputs[index]!.value = value;
      inputs[index]!.dispatchEvent(new Event('input'));
    });
  };
  const submit = async () => {
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth([])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountPage);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    controller.expectOne('/api/auth/passkeys').flush(NO_PASSKEYS);
    await settle();
  });

  afterEach(() => controller.verify());

  it("affiche l'identité de l'utilisateur connecté", () => {
    expect(root.textContent).toContain('admin@asso.fr');
  });

  it("n'envoie rien quand la confirmation diffère ou que le mot de passe est trop court", async () => {
    fill(CURRENT, 'court', 'court');
    await submit();
    controller.expectNone('/api/auth/password');
    expect(root.textContent).toContain('au moins 12 caractères');

    fill(CURRENT, NEXT, 'autre chose entierement');
    await submit();
    controller.expectNone('/api/auth/password');
    expect(root.textContent).toContain('ne correspondent pas');
  });

  it('change le mot de passe, vide le formulaire et confirme', async () => {
    fill(CURRENT, NEXT, NEXT);
    await submit();
    const request = controller.expectOne('/api/auth/password');
    expect(request.request.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Mot de passe modifié');
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('input')).every((i) => i.value === '')).toBe(true);
  });

  it("affiche le refus du serveur quand le mot de passe actuel est incorrect", async () => {
    fill('mauvais mot de passe', NEXT, NEXT);
    await submit();
    controller
      .expectOne('/api/auth/password')
      .flush({ message: 'Le mot de passe actuel est incorrect.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('mot de passe actuel est incorrect');
    expect(root.querySelector('[role="status"]')).toBeNull();
  });
});

describe('AccountPage : vérification en deux étapes', () => {
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const render = async (mfa: { state: 'OK'; enabled: boolean; required: boolean }, extra: Record<string, unknown> = {}) => {
    await TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth([], mfa, extra)],
    }).compileComponents();
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/auth/passkeys').flush(NO_PASSKEYS);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  };
  const buttonWith = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));
  const typePassword = (root: HTMLElement, value: string) => {
    const input = root.querySelector<HTMLInputElement>('section input[type="password"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it("propose d'activer quand le second facteur est inactif", async () => {
    const { root } = await render({ state: 'OK', enabled: false, required: false });
    expect(root.querySelector('a[href="/mfa/activation"]')).not.toBeNull();
    expect(buttonWith(root, 'Désactiver')).toBeUndefined();
  });

  it("n'offre pas de désactivation quand un rôle l'exige", async () => {
    const { root } = await render({ state: 'OK', enabled: true, required: true });
    expect(root.textContent).toContain('Un de vos rôles l\'exige');
    expect(buttonWith(root, 'Régénérer')).toBeDefined();
    expect(buttonWith(root, 'Désactiver')).toBeUndefined();
  });

  it('exige le mot de passe avant de désactiver, puis désactive', async () => {
    const disableMfa = vi.fn(async () => {});
    const { fixture, root } = await render({ state: 'OK', enabled: true, required: false }, { disableMfa });

    buttonWith(root, 'Désactiver')!.click();
    await settle(fixture);
    expect(disableMfa).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Saisissez votre mot de passe actuel.');

    typePassword(root, 'une phrase de passe correcte');
    buttonWith(root, 'Désactiver')!.click();
    await settle(fixture);
    expect(disableMfa).toHaveBeenCalledWith('une phrase de passe correcte');
  });

  it('régénère les codes de secours et les affiche une seule fois', async () => {
    const regenerateRecoveryCodes = vi.fn(async () => ['AAAAA-BBBBB', 'CCCCC-DDDDD']);
    const { fixture, root } = await render({ state: 'OK', enabled: true, required: false }, { regenerateRecoveryCodes });

    typePassword(root, 'une phrase de passe correcte');
    buttonWith(root, 'Régénérer')!.click();
    await settle(fixture);
    expect(regenerateRecoveryCodes).toHaveBeenCalledWith('une phrase de passe correcte');
    expect(Array.from(root.querySelectorAll('ul.codes li')).map((li) => li.textContent?.trim())).toEqual(['AAAAA-BBBBB', 'CCCCC-DDDDD']);
    expect(root.textContent).toContain('ne seront plus affichés');
  });
});
