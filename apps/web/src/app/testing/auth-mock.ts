import { signal } from '@angular/core';
import { AuthService, type AuthUser, type MfaStatus } from '../auth/auth.service';

export const TEST_USER: AuthUser = {
  id: 'u-self',
  email: 'admin@asso.fr',
  displayName: 'Admin',
  status: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
};

/** Faux AuthService pour les tests de pages : l'utilisateur détient exactement les permissions données. */
export function mockAuth(
  permissions: string[],
  mfa: MfaStatus = { state: 'OK', enabled: false, required: false },
  extra: Record<string, unknown> = {},
) {
  const granted = signal<ReadonlySet<string>>(new Set(permissions));
  return {
    provide: AuthService,
    useValue: {
      user: signal(TEST_USER).asReadonly(),
      mfa: signal(mfa).asReadonly(),
      permissions: granted.asReadonly(),
      can: (permission: string | undefined) => permission === undefined || granted().has(permission),
      ...extra,
    },
  };
}
