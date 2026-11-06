import { HttpErrorResponse } from '@angular/common/http';
import { describePasskeyError } from './passkey-errors';

describe('describePasskeyError', () => {
  const FALLBACK = 'Action impossible. Réessayez.';

  it('reprend le message rédigé par le serveur', () => {
    const error = new HttpErrorResponse({ status: 409, error: { message: 'Les clés d’accès ne sont pas activées.' } });
    expect(describePasskeyError(error, FALLBACK).message).toBe('Les clés d’accès ne sont pas activées.');
  });

  it('signale un serveur injoignable et garde le message de repli sans détail technique', () => {
    expect(describePasskeyError(new HttpErrorResponse({ status: 0 }), FALLBACK).message).toContain('injoignable');
    expect(describePasskeyError(new HttpErrorResponse({ status: 500, error: {} }), FALLBACK).message).toBe(FALLBACK);
    expect(describePasskeyError(new Error('boom'), FALLBACK).message).toBe(FALLBACK);
  });

  it('explique en trois temps une annulation par la personne ou un délai dépassé', () => {
    const cancelled = describePasskeyError({ name: 'NotAllowedError' }, FALLBACK).message;
    expect(cancelled).toContain('annulée');
    expect(cancelled).toContain('Rien n’a été modifié');
    expect(cancelled).toContain('Recommencez');
    expect(describePasskeyError({ code: 'ERROR_CEREMONY_ABORTED' }, FALLBACK).message).toContain('annulée');
  });

  it('explique une clé déjà enregistrée, une adresse refusée et un appareil incompatible', () => {
    expect(describePasskeyError({ name: 'InvalidStateError' }, FALLBACK).message).toContain('déjà une clé d’accès');
    expect(describePasskeyError({ name: 'SecurityError' }, FALLBACK).message).toContain('adresse officielle');
    expect(describePasskeyError({ name: 'NotSupportedError' }, FALLBACK).message).toContain('ne gère pas');
  });

  it('ne laisse jamais apparaître un nom de code technique', () => {
    for (const error of [{ name: 'NotAllowedError' }, { name: 'SecurityError' }, { code: 'ERROR_CEREMONY_ABORTED' }]) {
      expect(describePasskeyError(error, FALLBACK).message).not.toMatch(/Error|ERROR_/);
    }
  });
});
