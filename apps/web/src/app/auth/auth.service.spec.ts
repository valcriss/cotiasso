import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, type AuthUser } from './auth.service';

const user: AuthUser = {
  id: '1',
  email: 'marie@asso.fr',
  displayName: 'Marie',
  status: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
};
const session = { user, csrfToken: 'csrf-1', expiresAt: '2026-11-02T00:00:00.000Z' };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("signale l'installation requise sans chercher de session", async () => {
    const done = auth.initialize();
    http.expectOne('/api/setup/status').flush({ setupRequired: true });
    await done;
    expect(auth.setupRequired()).toBe(true);
    expect(auth.user()).toBeNull();
    http.expectNone('/api/auth/me');
  });

  it('restaure une session existante et son jeton CSRF', async () => {
    const done = auth.initialize();
    http.expectOne('/api/setup/status').flush({ setupRequired: false });
    await tick();
    http.expectOne('/api/auth/me').flush(session);
    await done;
    expect(auth.user()?.email).toBe('marie@asso.fr');
    expect(auth.csrfToken).toBe('csrf-1');
  });

  it("reste déconnecté quand il n'y a pas de session", async () => {
    const done = auth.initialize();
    http.expectOne('/api/setup/status').flush({ setupRequired: false });
    await tick();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(auth.user()).toBeNull();
    expect(auth.csrfToken).toBeNull();
  });

  it('ne plante pas quand le serveur est injoignable', async () => {
    const done = auth.initialize();
    http.expectOne('/api/setup/status').error(new ProgressEvent('error'));
    await done;
    expect(auth.user()).toBeNull();
    expect(auth.setupRequired()).toBe(false);
  });

  it("n'initialise qu'une seule fois", async () => {
    const first = auth.initialize();
    const second = auth.initialize();
    expect(second).toBe(first);
    http.expectOne('/api/setup/status').flush({ setupRequired: true });
    await first;
  });

  it("ouvre une session à la connexion et l'oublie à la déconnexion", async () => {
    const login = auth.login('marie@asso.fr', 'secret');
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ email: 'marie@asso.fr', password: 'secret' });
    request.flush(session);
    await login;
    expect(auth.user()?.displayName).toBe('Marie');
    expect(auth.csrfToken).toBe('csrf-1');

    const logout = auth.logout();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(auth.user()).toBeNull();
    expect(auth.csrfToken).toBeNull();
  });

  it('oublie la session même quand la déconnexion échoue côté serveur', async () => {
    const login = auth.login('marie@asso.fr', 'secret');
    http.expectOne('/api/auth/login').flush(session);
    await login;

    const logout = auth.logout().catch(() => undefined);
    http.expectOne('/api/auth/logout').flush({}, { status: 500, statusText: 'Server Error' });
    await logout;
    expect(auth.user()).toBeNull();
  });

  it("termine l'installation et ouvre la session", async () => {
    const done = auth.completeSetup({ token: 't', email: 'marie@asso.fr', displayName: 'Marie', password: 'x'.repeat(12) });
    http.expectOne('/api/setup').flush(session);
    await done;
    expect(auth.setupRequired()).toBe(false);
    expect(auth.user()?.id).toBe('1');
  });
});
