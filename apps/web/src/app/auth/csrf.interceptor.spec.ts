import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { csrfInterceptor } from './csrf.interceptor';

const session = {
  user: { id: '1', email: 'm@asso.fr', displayName: 'M', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' },
  permissions: ['projects:view'],
  mfa: { state: 'OK', enabled: false, required: false },
  csrfToken: 'csrf-1',
  expiresAt: '2026-11-02T00:00:00.000Z',
};

describe('csrfInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let auth: AuthService;

  const logIn = async () => {
    const login = auth.login('m@asso.fr', 'x');
    controller.expectOne('/api/auth/login').flush(session);
    await login;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([csrfInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => controller.verify());

  it('joint le jeton CSRF aux requêtes modifiantes une fois connecté', async () => {
    await logIn();
    http.post('/api/projets', {}).subscribe();
    expect(controller.expectOne('/api/projets').request.headers.get('x-csrf-token')).toBe('csrf-1');
  });

  it('ne joint pas le jeton aux lectures', async () => {
    await logIn();
    http.get('/api/projets').subscribe();
    expect(controller.expectOne('/api/projets').request.headers.has('x-csrf-token')).toBe(false);
  });

  it("n'envoie aucun jeton avant la connexion", () => {
    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    expect(controller.expectOne('/api/auth/login').request.headers.has('x-csrf-token')).toBe(false);
  });

  it('renvoie vers la connexion quand la session a expiré côté serveur', async () => {
    await logIn();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    http.get('/api/projets').subscribe({ error: () => undefined });
    controller.expectOne('/api/projets').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(auth.user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/connexion');
  });

  it('laisse la page de connexion gérer elle-même un 401', async () => {
    await logIn();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    controller.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(navigate).not.toHaveBeenCalled();
    expect(auth.user()).not.toBeNull();
  });
});
