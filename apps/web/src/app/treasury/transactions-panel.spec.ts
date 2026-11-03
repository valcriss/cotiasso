import { describe, expect, it } from 'vitest';
import { periodRange } from './transactions-panel';

describe('periodRange', () => {
  it('donne les bornes du mois en cours et du mois dernier, février bissextile compris', () => {
    expect(periodRange('month', new Date(2028, 1, 10))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('last-month', new Date(2026, 2, 5))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('revient à décembre de l’année précédente en janvier', () => {
    expect(periodRange('last-month', new Date(2027, 0, 15))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('donne l’année civile en cours', () => {
    expect(periodRange('year', new Date(2026, 10, 3))).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});
