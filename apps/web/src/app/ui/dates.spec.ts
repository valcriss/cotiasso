import { describe, expect, it } from 'vitest';
import { formatDate, formatDateLong, todayLocalIso } from './dates';

describe('dates', () => {
  it('donne la date locale, pas la date UTC', () => {
    // 1er janvier 2027, 00 h 30 à l'heure locale : toISOString() pourrait donner 2026-12-31 selon le fuseau.
    expect(todayLocalIso(new Date(2027, 0, 1, 0, 30))).toBe('2027-01-01');
    expect(todayLocalIso(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(todayLocalIso(new Date(2024, 1, 29, 12, 0))).toBe('2024-02-29');
  });

  it('affiche jj/mm/aaaa sans décalage de fuseau', () => {
    expect(formatDate('2026-11-02')).toBe('02/11/2026');
    expect(formatDate('2024-02-29')).toBe('29/02/2024');
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
  });

  it('rend une valeur vide ou inattendue sans échouer', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('demain')).toBe('demain');
    expect(formatDateLong('2026-13-01')).toBe('2026-13-01');
  });

  it('écrit la date en toutes lettres', () => {
    expect(formatDateLong('2026-11-02')).toBe('2 novembre 2026');
    expect(formatDateLong('2026-09-01')).toBe('1er septembre 2026');
  });
});
