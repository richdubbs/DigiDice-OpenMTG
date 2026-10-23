/**
 * WP6: the Qty / Count and Cost hole grammars. Rules cited: CR 107.1a (halving states its rounding), 107.3 (X), 118.1-118.3 (costs), 119.4 (paying life),
 * 122 (counters), 601.2f-h (costs), 606.4 (loyalty costs), 608.2h (quantities are determined on resolution), 700.5 (devotion), 701.17 (sacrifice), 702.122 (crew).
 * Cost parts are the top 40 of the corpus table (analysis 7.4).
 */
import { describe, expect, it } from 'vitest';
import { ENV, full, one, rejects, toks } from './env';
import { runHole } from '../../../src/parser/holes';

const creature = { types: ['Creature'] };
const you = { ref: 'you' };

describe('WP6 Qty (CR 107.1a, 107.3, 608.2h)', () => {
  it.each([
    ['3', 3], ['X', { q: 'X' }], ['a', 1], ['five', 5],
    ['twice X', { q: 'math', op: '*', args: [2, { q: 'X' }] }],
    ['half X, rounded down', { q: 'math', op: 'floorDiv', args: [{ q: 'X' }, 2] }],
    ['half X, rounded up', { q: 'math', op: 'ceilDiv', args: [{ q: 'X' }, 2] }],
    ['X plus 1', { q: 'math', op: '+', args: [{ q: 'X' }, 1] }],
    ['the number of cards in your hand', { q: 'zoneSize', zone: 'hand', of: you }],
    ['the number of cards in your graveyard', { q: 'zoneSize', zone: 'graveyard', of: you }],
    ['the number of creature cards in your graveyard', { q: 'count', of: { ref: 'each', filter: { ...creature, zone: 'graveyard', owner: 'you', isCard: true } } }],
    ['the number of other creatures you control', { q: 'count', of: { ref: 'each', filter: { ...creature, other: true, controller: 'you' } } }],
    ['the total mana value of artifacts you control', { q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } }, sum: true }],
    ['your life total', { q: 'life', of: you }],
    ['the number of +1/+1 counters on ~', { q: 'counters', on: { ref: 'self' }, kind: '+1/+1' }],
    ['the number of counters on ~', { q: 'counters', on: { ref: 'self' }, kind: 'any' }],
    ['your devotion to green', { q: 'devotion', to: ['G'], of: you }],
    ['your devotion to black and red', { q: 'devotion', to: ['B', 'R'], of: you }],
    ['~\'s toughness', { q: 'stat', stat: 'toughness', of: { ref: 'self' } }],
    ['the result', { q: 'dieResult' }],
    ['the number of colors among permanents you control', { q: 'distinct', what: 'colors', among: { ref: 'each', filter: { controller: 'you' } } }],
    ['the number of creatures that died this turn', { q: 'happenedCount', event: { ev: 'zoneChange', subject: creature, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }],
    ["the number of spells you've cast this turn", { q: 'spellsCastThisTurn' }],
  ])('"%s"', (phrase, expected) => {
    expect(one('Qty', phrase)).toEqual(expected);
  });

  it('"that many" / "that much" are anaphor markers for the lowering pass (design 6.5 pass 5)', () => {
    expect(one('Qty', 'that many')).toEqual({ q: 'eventAmount', $anaphor: { sort: 'number', number: 'singular', text: 'that many' } });
    expect(one('Qty', 'twice that many')).toEqual({ q: 'math', op: '*', args: [2, { q: 'eventAmount', $anaphor: { sort: 'number', number: 'singular', text: 'that many' } }] });
  });

  it('"for each ..." is a count marked $forEach so the lowering pass can multiply', () => {
    expect(one('Qty', 'for each creature you control')).toEqual({ q: 'count', of: { ref: 'each', filter: { ...creature, controller: 'you' } }, $forEach: true });
  });

  it('statistics of one object: "its power", "target creature\'s power", "the power of target creature"', () => {
    const it = one('Qty', 'its power') as { q: string; stat: string };
    expect(it).toMatchObject({ q: 'stat', stat: 'power' });
    const t = one('Qty', "target creature's power") as { of: { ref: string } };
    expect(t.of.ref).toBe('target');
    expect(one('Qty', 'the power of target creature')).toEqual(t);
  });

  it('CR 107.1a: halving must state its rounding; an unknown word is no quantity', () => {
    expect(rejects('Qty', 'half X')).toBe(true);
    expect(rejects('Qty', 'zzz')).toBe(true);
    expect(rejects('Qty', 'the number of zzz')).toBe(true);
  });

  it('Count adds "any number of" (unbounded) to numbers, X and quantities', () => {
    expect(one('Count', 'any number of')).toBe('any');
    expect(one('Count', '2')).toBe(2);
    expect(one('Count', 'X')).toEqual({ q: 'X' });
  });
});

describe('WP6 Cost (CR 118, 601.2f-h, 602.2, 606.4)', () => {
  it.each([
    ['{T}', { tap: true }],
    ['{Q}', { untap: true }],
    ['{2}{W}, {T}, sacrifice ~', { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'W' }], tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }],
    ['sacrifice a creature', { other: [{ kind: 'sacrifice', filter: creature, count: 1 }] }],
    ['sacrifice another creature', { other: [{ kind: 'sacrifice', filter: { ...creature, other: true }, count: 1 }] }],
    ['sacrifice two artifacts', { other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 2 }] }],
    ['sacrifice an artifact or creature', { other: [{ kind: 'sacrifice', filter: { types: ['Artifact', 'Creature'] }, count: 1 }] }],
    ['discard a card', { other: [{ kind: 'discard', count: 1 }] }],
    ['discard two cards', { other: [{ kind: 'discard', count: 2 }] }],
    ['discard ~', { other: [{ kind: 'discard', count: 1, self: true }] }],
    ['discard your hand', { other: [{ kind: 'discard', count: 'any', hand: true }] }],
    ['discard a card at random', { other: [{ kind: 'discard', count: 1, random: true }] }],
    ['discard a creature card', { other: [{ kind: 'discard', count: 1, filter: creature }] }],
    ['pay 3 life', { other: [{ kind: 'payLife', amount: 3 }] }],
    ['pay {E}', { other: [{ kind: 'payEnergy', amount: 1 }] }],
    ['pay {E}{E}{E}', { other: [{ kind: 'payEnergy', amount: 3 }] }],
    ['exile ~ from your graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }] }],
    ['exile ~ from your hand', { other: [{ kind: 'exileFrom', zone: 'hand', count: 1, self: true }] }],
    ['exile a creature card from your graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, filter: creature }] }],
    ['exile two cards from your graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 2 }] }],
    ['tap an untapped creature you control', { other: [{ kind: 'tapUntapped', filter: { ...creature, controller: 'you' }, count: 1 }] }],
    ['tap two untapped Elves you control', { other: [{ kind: 'tapUntapped', filter: { subtypes: ['Elf'], controller: 'you' }, count: 2 }] }],
    ['tap another untapped creature you control', { other: [{ kind: 'tapUntapped', filter: { ...creature, controller: 'you' }, count: 1, other: true }] }],
    ['tap any number of untapped creatures you control with total power 4 or greater', { other: [{ kind: 'tapPower', filter: { ...creature, controller: 'you' }, power: 4 }] }],
    ['remove a +1/+1 counter from ~', { other: [{ kind: 'removeCounters', counter: '+1/+1', count: 1, self: true }] }],
    ['remove three charge counters from ~', { other: [{ kind: 'removeCounters', counter: 'charge', count: 3, self: true }] }],
    ['remove a +1/+1 counter from a creature you control', { other: [{ kind: 'removeCounters', counter: '+1/+1', count: 1, filter: { ...creature, controller: 'you' } }] }],
    ['put a -1/-1 counter on a creature you control', { other: [{ kind: 'putCounters', counter: '-1/-1', count: 1, filter: { ...creature, controller: 'you' } }] }],
    ["return ~ to its owner's hand", { other: [{ kind: 'returnToHand', filter: { self: true }, count: 1, self: true }] }],
    ["return a creature you control to its owner's hand", { other: [{ kind: 'returnToHand', filter: { ...creature, controller: 'you' }, count: 1 }] }],
    ['reveal ~ from your hand', { other: [{ kind: 'reveal', zone: 'hand', count: 1, self: true }] }],
    ['mill two cards', { other: [{ kind: 'mill', count: 2 }] }],
    ['forage', { other: [{ kind: 'action', action: 'forage' }] }],
    ['waterbend {5}', { other: [{ kind: 'action', action: 'waterbend', arg: 5 }] }],
    ['+1', { loyalty: 1 }],
    ['-2', { loyalty: -2 }],
    ['{1}{G}, {T}, discard a card', { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'G' }], tap: true, other: [{ kind: 'discard', count: 1 }] }],
    ['pay 2 life and sacrifice ~', { other: [{ kind: 'payLife', amount: 2 }, { kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }],
  ])('"%s"', (phrase, expected) => {
    expect(one('Cost', phrase)).toEqual(expected);
  });

  it('"exile ~" with no zone assumes the battlefield (CR 113.6) and says so with a flag', () => {
    const alts = full('Cost', 'exile ~');
    expect(alts).toHaveLength(1);
    expect(alts[0]!.value).toEqual({ other: [{ kind: 'exileFrom', zone: 'battlefield', count: 1, self: true }] });
    expect(alts[0]!.flags).toEqual(['assumed:zone=battlefield']);
  });

  it('a loyalty cost of 0 needs the colon of a loyalty ability after it', () => {
    const t = toks('0: Draw a card.');
    expect(runHole('Cost', t, 0, ENV).map((a) => a.value)).toEqual([{ loyalty: 0 }]);
    expect(rejects('Cost', '0')).toBe(true);
  });

  it('every prefix of a cost list is offered, so a template can stop at the colon', () => {
    const t = toks('{T}, sacrifice ~: add {C}');
    const ends = runHole('Cost', t, 0, ENV).map((a) => a.end);
    expect(ends).toEqual([1, 4]);
  });

  it('two mana runs or two taps in one cost do not parse (the same cost part twice)', () => {
    expect(rejects('Cost', '{T}, {T}')).toBe(true);
    expect(rejects('Cost', '{1}, {G}')).toBe(true);
  });

  it('G2: unknown cost words fail; "sacrifice creature" (no article or number) and "tap a creature" (no "untapped") are not cost parts', () => {
    for (const bad of ['zzz', 'sacrifice zzz', 'sacrifice creature', 'discard zzz', 'tap an untapped zzz', 'tap a creature you control', 'exile a card', 'remove a zzz counter']) {
      // "remove a zzz counter" has no "from ..." so it is no cost; the others contain an unknown word or are not complete cost parts
      expect(rejects('Cost', bad), bad).toBe(true);
    }
  });
});
