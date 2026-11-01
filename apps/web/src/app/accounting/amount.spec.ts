import { centsToApi, formatApiAmount, formatCents, parseAmountToCents } from './amount';

describe('montants', () => {
  it('lit les saisies françaises en centimes entiers', () => {
    expect(parseAmountToCents('12,5')).toBe(1250);
    expect(parseAmountToCents('12.50')).toBe(1250);
    expect(parseAmountToCents(' 1 250,05 ')).toBe(125005);
    expect(parseAmountToCents('0,1')).toBe(10);
    expect(parseAmountToCents('7')).toBe(700);
    expect(parseAmountToCents('')).toBe(0);
    expect(parseAmountToCents(null)).toBe(0);
  });

  it('refuse ce qui n’est pas un montant exact à deux décimales', () => {
    for (const bad of ['abc', '1,234', '-5', '1e3', '1,2,3', '12 €', '1234567890123']) {
      expect(parseAmountToCents(bad), bad).toBeNull();
    }
  });

  it('évite les erreurs de flottant', () => {
    expect(parseAmountToCents('0,1')! + parseAmountToCents('0,2')!).toBe(parseAmountToCents('0,3'));
  });

  it('formate pour l’API et pour l’affichage', () => {
    expect(centsToApi(125005)).toBe('1250.05');
    expect(centsToApi(5)).toBe('0.05');
    expect(formatCents(125005)).toBe('1 250,05');
    expect(formatCents(0)).toBe('0,00');
    expect(formatApiAmount('1250.50')).toBe('1 250,50');
  });
});
