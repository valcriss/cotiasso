import { evaluateSplit, type SplitRow } from './category-field';

const row = (categoryId: string, amount: string, manual = true): SplitRow => ({ categoryId, amount, manual });

describe('evaluateSplit', () => {
  it('est valide quand toutes les parts ont une catégorie et un montant, et que le total est exact (en centimes)', () => {
    const state = evaluateSplit([row('a', '10'), row('b', '10,00')], 2000);
    expect(state).toMatchObject({ valid: true, assigned: 2000, remaining: 0 });
    expect(state.parts).toEqual([{ categoryId: 'a', amount: '10.00' }, { categoryId: 'b', amount: '10.00' }]);
  });

  it('ne se trompe pas sur les centimes (pas de flottant)', () => {
    expect(evaluateSplit([row('a', '0,10'), row('b', '0,20')], 30)).toMatchObject({ valid: true, remaining: 0 });
    expect(evaluateSplit([row('a', '33,33'), row('b', '33,33'), row('c', '33,34')], 10000).valid).toBe(true);
    expect(evaluateSplit([row('a', '33,33'), row('b', '33,33'), row('c', '33,33')], 10000)).toMatchObject({ valid: false, remaining: 1 });
  });

  it('dit ce qu’il reste, ou de combien on dépasse', () => {
    expect(evaluateSplit([row('a', '10'), row('b', '4,50')], 2000)).toMatchObject({ valid: false, remaining: 550 });
    expect(evaluateSplit([row('a', '10'), row('b', '12')], 2000)).toMatchObject({ valid: false, remaining: -200 });
  });

  it('refuse une part sans catégorie, sans montant, ou en doublon, et une seule part', () => {
    expect(evaluateSplit([row('a', '10'), row('', '10')], 2000).valid).toBe(false);
    expect(evaluateSplit([row('a', '20'), row('b', '')], 2000).valid).toBe(false);
    expect(evaluateSplit([row('a', '20'), row('b', 'abc')], 2000).valid).toBe(false);
    expect(evaluateSplit([row('a', '10'), row('a', '10')], 2000).valid).toBe(false);
    expect(evaluateSplit([row('a', '20')], 2000).valid).toBe(false);
  });

  it('n’est jamais valide tant que le montant à répartir est inconnu ou nul', () => {
    expect(evaluateSplit([row('a', '10'), row('b', '10')], null).valid).toBe(false);
    expect(evaluateSplit([row('a', '10'), row('b', '10')], 0).valid).toBe(false);
  });
});
