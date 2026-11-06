import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PasskeyService } from '../auth/passkey.service';
import { LoginPage } from './login.page';

const session = {
  user: { id: '1', email: 'm@asso.fr', displayName: 'M', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' },
  permissions: ['projects:view'],
  mfa: { state: 'OK', enabled: false, required: false },
  csrfToken: 'csrf-1',
  expiresAt: '2026-11-02T00:00:00.000Z',
};

describe('LoginPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<LoginPage>>;

  const fill = (email: string, password: string) => {
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    inputs[0]!.value = email;
    inputs[0]!.dispatchEvent(new Event('input'));
    inputs[1]!.value = password;
    inputs[1]!.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const alert = () => root.querySelector('[role="alert"]')?.textContent?.trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoginPage);
    root = fixture.nativeElement as HTMLElement;
    controller.expectOne('/api/auth/methods').flush({ passkeys: { mode: 'DISABLED', usernameless: false } });
    await fixture.whenStable();
  });

  afterEach(() => controller.verify());

  it("n'envoie rien tant que les champs sont vides", async () => {
    await submit();
    controller.expectNone('/api/auth/login');
    expect(root.textContent).toContain('Saisissez votre adresse email.');
  });

  it('se connecte puis ouvre la zone authentifiée', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill('m@asso.fr', 'secret');
    const done = submit();
    controller.expectOne('/api/auth/login').flush(session);
    await done;
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('affiche une erreur générique sur des identifiants invalides et vide le mot de passe', async () => {
    fill('m@asso.fr', 'mauvais');
    const done = submit();
    controller.expectOne('/api/auth/login').flush({ message: 'Identifiants invalides.' }, { status: 401, statusText: 'Unauthorized' });
    await done;
    await fixture.whenStable();
    expect(alert()).toBe('Identifiants invalides.');
    expect(root.querySelectorAll<HTMLInputElement>('input')[1]!.value).toBe('');
    expect(root.querySelectorAll<HTMLInputElement>('input')[0]!.value).toBe('m@asso.fr');
    expect(root.textContent).not.toContain('Saisissez votre mot de passe.');
  });

  it("indique le délai d'attente quand le serveur ralentit les tentatives", async () => {
    fill('m@asso.fr', 'mauvais');
    const done = submit();
    controller
      .expectOne('/api/auth/login')
      .flush({ message: 'Trop de tentatives. Réessayez dans 8 secondes.' }, { status: 429, statusText: 'Too Many Requests' });
    await done;
    await fixture.whenStable();
    expect(alert()).toContain('Réessayez dans 8 secondes');
  });

  it("signale un serveur injoignable", async () => {
    fill('m@asso.fr', 'x');
    const done = submit();
    controller.expectOne('/api/auth/login').error(new ProgressEvent('error'));
    await done;
    await fixture.whenStable();
    expect(alert()).toContain('injoignable');
  });
});

describe('LoginPage : clé d’accès', () => {
  const fake = (methods: { mode: string; usernameless: boolean }, supported = true) => ({
    supported: () => supported,
    methods: vi.fn(async () => methods),
    login: vi.fn(async () => {}),
  });

  const render = async (service: ReturnType<typeof fake>) => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: PasskeyService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(LoginPage);
    const root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    fixture.detectChanges();
    const button = () => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('clé d’accès'));
    const typeEmail = (value: string) => {
      const input = root.querySelector<HTMLInputElement>('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    return { fixture, root, button, typeEmail };
  };

  it('ne propose rien tant que l’association ne permet pas la connexion complète', async () => {
    for (const mode of ['DISABLED', 'SECOND_FACTOR']) {
      TestBed.resetTestingModule();
      const { button } = await render(fake({ mode, usernameless: false }));
      expect(button()).toBeUndefined();
    }
  });

  it('ne propose rien si le navigateur ne gère pas les clés d’accès', async () => {
    const { button } = await render(fake({ mode: 'FULL', usernameless: false }, false));
    expect(button()).toBeUndefined();
  });

  it('demande d’abord l’adresse email quand l’association l’exige, sans rien envoyer', async () => {
    const service = fake({ mode: 'FULL', usernameless: false });
    const { fixture, root, button } = await render(service);
    expect(root.textContent).toContain('Se connecter avec une clé d’accès');
    expect(root.textContent).toContain('Saisissez d’abord votre adresse email');
    button()!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.login).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('adresse email');
  });

  it('se connecte avec l’adresse saisie, puis ouvre la zone authentifiée', async () => {
    const service = fake({ mode: 'FULL', usernameless: false });
    const { fixture, button, typeEmail } = await render(service);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    typeEmail(' m@asso.fr ');
    button()!.click();
    await fixture.whenStable();
    expect(service.login).toHaveBeenCalledWith('m@asso.fr');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('se connecte sans adresse quand l’association l’autorise', async () => {
    const service = fake({ mode: 'FULL', usernameless: true });
    const { fixture, root, button } = await render(service);
    expect(root.textContent).not.toContain('Saisissez d’abord votre adresse email.');
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button()!.click();
    await fixture.whenStable();
    expect(service.login).toHaveBeenCalledWith(null);
  });

  it('explique en clair l’échec de la clé d’accès, sans jargon', async () => {
    const service = fake({ mode: 'FULL', usernameless: true });
    service.login.mockRejectedValue({ name: 'NotAllowedError' });
    const { fixture, root, button } = await render(service);
    button()!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('annulée');
    expect(root.querySelector('[role="alert"]')!.textContent).not.toContain('NotAllowedError');
  });
});
