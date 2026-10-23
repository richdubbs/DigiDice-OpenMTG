import { describe, expect, it } from 'vitest';
import { parseManaCost, formatManaCost, manaValue, costColors, parseTypeLine } from '../../src/index';

describe('mana costs (CR 107.4, 202)', () => {
  it('parses every symbol family', () => {
    const c = parseManaCost('{X}{2}{W}{U/B}{2/R}{C/G}{G/P}{W/U/P}{C}{S}')!;
    expect(c.map((s) => s.kind)).toEqual(['variable', 'generic', 'colored', 'hybrid', 'monoHybrid', 'colorlessHybrid', 'phyrexian', 'hybridPhyrexian', 'colorless', 'snow']);
    expect(formatManaCost(c)).toBe('{X}{2}{W}{U/B}{2/R}{C/G}{G/P}{W/U/P}{C}{S}');
  });

  it('distinguishes no mana cost from {0} (CR 202.1b)', () => {
    expect(parseManaCost('')).toBeNull();
    expect(parseManaCost('{0}')).toEqual([{ kind: 'generic', amount: 0 }]);
  });

  it('computes mana value (CR 202.3), X = 0 off the stack (CR 202.3e)', () => {
    expect(manaValue(parseManaCost('{2}{W}{W}'))).toBe(4);
    expect(manaValue(parseManaCost('{X}{R}'))).toBe(1);
    expect(manaValue(parseManaCost('{X}{R}'), 3)).toBe(4);
    expect(manaValue(parseManaCost('{2/W}{2/W}'))).toBe(4); // CR 202.3f
    expect(manaValue(parseManaCost('{W/P}'))).toBe(1);
  });

  it('computes colors from cost (CR 202.2)', () => {
    expect(costColors(parseManaCost('{2}{G/W}{U/P}'))).toEqual(['W', 'U', 'G']);
    expect(costColors(parseManaCost('{4}'))).toEqual([]);
  });

  it('rejects malformed costs', () => {
    expect(() => parseManaCost('{Q}')).toThrow();
    expect(() => parseManaCost('2W')).toThrow();
  });
});

describe('type lines (CR 205)', () => {
  it('splits supertypes, types and subtypes', () => {
    expect(parseTypeLine('Legendary Creature — Human Wizard')).toEqual({ supertypes: ['Legendary'], types: ['Creature'], subtypes: ['Human', 'Wizard'] });
    expect(parseTypeLine('Land Creature — Forest Dryad')).toEqual({ supertypes: [], types: ['Land', 'Creature'], subtypes: ['Forest', 'Dryad'] });
    expect(parseTypeLine('Basic Snow Land — Island').supertypes).toEqual(['Basic', 'Snow']);
    expect(parseTypeLine('Instant')).toEqual({ supertypes: [], types: ['Instant'], subtypes: [] });
  });
  it('keeps the two-word creature type Time Lord (CR 205.3m)', () => {
    expect(parseTypeLine('Legendary Creature — Time Lord Doctor').subtypes).toEqual(['Time Lord', 'Doctor']);
  });
});
