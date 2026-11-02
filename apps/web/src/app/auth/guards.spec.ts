import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { authGuard, loginGuard, mfaEnrollGuard, mfaVerifyGuard, permissionGuard, setupGuard } from './guards';
import type { MfaStatus } from './auth.service';

function configure(state: { setupRequired: boolean; user: object | null; permissions?: string[]; mfa?: MfaStatus }) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: {
          initialize: () => Promise.resolve(),
          setupRequired: signal(state.setupRequired).asReadonly(),
          user: signal(state.user).asReadonly(),
          mfa: signal(state.mfa ?? { state: 'OK', enabled: false, required: false }).asReadonly(),
          can: (permission: string | undefined) => permission === undefined || (state.permissions ?? []).includes(permission),
          canAny: (permission: string | undefined) => permission === undefined || (state.permissions ?? []).includes(permission),
        },
      },
    ],
  });
}

const run = (guard: typeof authGuard) =>
  TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

const target = (result: unknown): string => (result instanceof UrlTree ? result.toString() : String(result));

describe('guards', () => {
  it("authGuard : renvoie vers l'installation tant qu'aucun compte n'existe", async () => {
    configure({ setupRequired: true, user: null });
    expect(target(await run(authGuard))).toBe('/installation');
  });

  it('authGuard : renvoie vers la connexion sans session, laisse passer avec une session', async () => {
    configure({ setupRequired: false, user: null });
    expect(target(await run(authGuard))).toBe('/connexion');

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' } });
    expect(await run(authGuard)).toBe(true);
  });

  it("loginGuard : ouvre la page de connexion seulement aux visiteurs d'une installation faite", async () => {
    configure({ setupRequired: false, user: null });
    expect(await run(loginGuard)).toBe(true);

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' } });
    expect(target(await run(loginGuard))).toBe('/');

    TestBed.resetTestingModule();
    configure({ setupRequired: true, user: null });
    expect(target(await run(loginGuard))).toBe('/installation');
  });

  it("setupGuard : n'ouvre l'assistant que si l'installation est requise", async () => {
    configure({ setupRequired: true, user: null });
    expect(await run(setupGuard)).toBe(true);

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: null });
    expect(target(await run(setupGuard))).toBe('/connexion');

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' } });
    expect(target(await run(setupGuard))).toBe('/');
  });

  it("permissionGuard : laisse passer avec la permission, renvoie à l'accueil sinon", () => {
    const route = { data: { permission: 'entries:view' } } as unknown as ActivatedRouteSnapshot;
    const check = () => TestBed.runInInjectionContext(() => permissionGuard(route, {} as RouterStateSnapshot));

    configure({ setupRequired: false, user: { id: '1' }, permissions: ['entries:view'] });
    expect(check()).toBe(true);

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' }, permissions: ['projects:view'] });
    expect(target(check())).toBe('/');
  });

  it("authGuard : renvoie vers la vérification ou l'activation du second facteur selon l'état de la session", async () => {
    configure({ setupRequired: false, user: { id: '1' }, mfa: { state: 'VERIFICATION_REQUIRED', enabled: true, required: true } });
    expect(target(await run(authGuard))).toBe('/mfa/verification');

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' }, mfa: { state: 'ENROLLMENT_REQUIRED', enabled: false, required: true } });
    expect(target(await run(authGuard))).toBe('/mfa/activation');
  });

  it('mfaVerifyGuard : ouvre la page seulement quand une vérification est attendue', async () => {
    configure({ setupRequired: false, user: { id: '1' }, mfa: { state: 'VERIFICATION_REQUIRED', enabled: true, required: true } });
    expect(await run(mfaVerifyGuard)).toBe(true);

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' } });
    expect(target(await run(mfaVerifyGuard))).toBe('/');

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: null });
    expect(target(await run(mfaVerifyGuard))).toBe('/connexion');
  });

  it("mfaEnrollGuard : ouvre l'activation sauf si le second facteur est déjà actif ou à vérifier", async () => {
    configure({ setupRequired: false, user: { id: '1' } });
    expect(await run(mfaEnrollGuard)).toBe(true);

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' }, mfa: { state: 'OK', enabled: true, required: false } });
    expect(target(await run(mfaEnrollGuard))).toBe('/compte');

    TestBed.resetTestingModule();
    configure({ setupRequired: false, user: { id: '1' }, mfa: { state: 'VERIFICATION_REQUIRED', enabled: true, required: true } });
    expect(target(await run(mfaEnrollGuard))).toBe('/mfa/verification');
  });
});
