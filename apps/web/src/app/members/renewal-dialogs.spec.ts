import { describe, expect, it } from 'vitest';
import { nextCampaignName, shiftYear } from './renewal-dialogs';

describe('campagne suivante : propositions de nom et de dates (#21)', () => {
  it("fait avancer chaque année du nom d'un an, ou marque la suite", () => {
    expect(nextCampaignName('Adhésions 2025-2026')).toBe('Adhésions 2026-2027');
    expect(nextCampaignName('Saison 2026')).toBe('Saison 2027');
    expect(nextCampaignName('Adhésions')).toBe('Adhésions (saison suivante)');
  });

  it("décale une date d'un an sans fuseau, le 29 février devenant le 28 février d'une année non bissextile", () => {
    expect(shiftYear('2025-09-29', 1)).toBe('2026-09-29');
    expect(shiftYear('2026-09-28', 1)).toBe('2027-09-28');
    expect(shiftYear('2027-12-31', 1)).toBe('2028-12-31');
    expect(shiftYear('2027-02-28', 1)).toBe('2028-02-28');
    expect(shiftYear('2028-02-29', 1)).toBe('2029-02-28');
    expect(shiftYear('2028-02-29', 4)).toBe('2032-02-29');
    expect(shiftYear('pas une date', 1)).toBe('');
  });
});
