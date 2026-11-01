import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Zone authentifiée : installation, connexion et second facteur requis, ou accès. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.initialize();
  if (auth.setupRequired()) return router.parseUrl('/installation');
  if (!auth.user()) return router.parseUrl('/connexion');
  if (auth.mfa().state === 'VERIFICATION_REQUIRED') return router.parseUrl('/mfa/verification');
  if (auth.mfa().state === 'ENROLLMENT_REQUIRED') return router.parseUrl('/mfa/activation');
  return true;
};

/** Page de vérification du second facteur : seulement quand il est attendu pour la session. */
export const mfaVerifyGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.initialize();
  if (!auth.user()) return router.parseUrl('/connexion');
  return auth.mfa().state === 'VERIFICATION_REQUIRED' ? true : router.parseUrl('/');
};

/** Page d'activation : ouverte à tout utilisateur connecté dont la session n'attend pas de vérification. */
export const mfaEnrollGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.initialize();
  if (!auth.user()) return router.parseUrl('/connexion');
  if (auth.mfa().state === 'VERIFICATION_REQUIRED') return router.parseUrl('/mfa/verification');
  return auth.mfa().enabled ? router.parseUrl('/compte') : true;
};

/** Page de connexion : inaccessible une fois connecté, ou tant que l'installation n'est pas faite. */
export const loginGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.initialize();
  if (auth.setupRequired()) return router.parseUrl('/installation');
  if (auth.user()) return router.parseUrl('/');
  return true;
};

/** Assistant d'installation : uniquement tant qu'aucun compte n'existe. */
export const setupGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.initialize();
  return auth.setupRequired() ? true : router.parseUrl(auth.user() ? '/' : '/connexion');
};

/** Rubrique protégée : la route déclare data.permission ; sans cette permission, retour à l'accueil. */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const permission = route.data['permission'] as string | undefined;
  return auth.can(permission) ? true : router.parseUrl('/');
};
