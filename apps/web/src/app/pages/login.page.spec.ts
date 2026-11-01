import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
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
