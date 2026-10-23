/**
 * p2-intervening-2 (lane p2-intervening): the round adds no template, only readings of the `Cond` hole (parser/holes/p2iv2.ts, wired in parser/holes/cond.ts#atoms),
 * their words in render/p2iv2.ts (a wrapper of the condition renderer, render/boot.ts) and the lowering of "it" in a trigger on the source leaving the battlefield to
 * the source's own history (parser/lower/ability.ts#resolveCondAnaphors). One test per reading: a synthetic intervening "if" (design 6.10) compiles by the game's
 * default compiler to the expected condition and passes the exact render gate (the card is full); its near misses stay manual (fail closed). The behavior is in
 * p2-intervening-2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { localIndex } from '../../m5/parser/support';

const compile = (text: string, type = 'Creature — Human'): CardDef =>
  compileCard({ name: 'Test Vigil Keeper', layout: 'normal', mana_cost: '{2}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(/Creature/.test(type) ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const ifOf = (d: CardDef): unknown => (d.faces[0]!.abilities[0] as { interveningIf?: unknown }).interveningIf;

/** [the rule, the synthetic line, the condition it compiles to]. */
const READINGS: readonly [string, string, unknown][] = [
  ['CR 303.4: "this creature is enchanted"', 'At the beginning of your end step, if this creature is enchanted, draw a card.',
    { cond: 'matches', object: { ref: 'self' }, filter: { enchanted: true } }],
  ['CR 508.1: "you didn\'t attack with a creature this turn"', "At the beginning of your end step, if you didn't attack with a creature this turn, draw a card.",
    { cond: 'not', of: { cond: 'happened', event: { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' } }, scope: 'turn' } }],
  ['CR 601.2i: "that player didn\'t cast a spell this turn"', "At the beginning of each opponent's end step, if that player didn't cast a spell this turn, you draw a card.",
    { cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: { ref: 'event', role: 'player' } }, scope: 'turn' } }],
  ['CR 208.1: "that creature\'s power is greater than this creature\'s"', "Whenever another creature you control dies, if that creature's power is greater than this creature's, draw a card.",
    { cond: 'compare', left: { q: 'stat', stat: 'power', of: { ref: 'event', role: 'subject' } }, op: '>', right: { q: 'stat', stat: 'power', of: { ref: 'self' } } }],
  ['CR 608.2h: "it didn\'t have flying" (as it last existed)', "Whenever another creature you control dies, if it didn't have flying, you gain 1 life.",
    { cond: 'not', of: { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { keyword: 'flying' } } }],
  ['CR 105.2: "all creatures you control are green"', 'At the beginning of your upkeep, if all creatures you control are green, you gain 1 life.',
    { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you', notColors: ['G'] } } } }],
  ['CR 402.1: "you control no permanents other than ~ and have no cards in hand"', 'At the beginning of your upkeep, if you control no permanents other than this creature and have no cards in hand, draw two cards.',
    { cond: 'all', of: [{ cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { other: true, controller: 'you' } } } }, { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, op: '==', right: 0 }] }],
  ['CR 122.6: "it\'s the first time charge counters have been put on that permanent this turn"', "Whenever one or more charge counters are put on another permanent you control, if it's the first time charge counters have been put on that permanent this turn, draw a card.",
    { cond: 'firstTime', object: { ref: 'event', role: 'subject' }, event: { ev: 'counters', change: 'put', kind: 'charge', on: {} } }],
  ['CR 122.6: "a charge counter was put on a permanent under your control this turn"', 'At the beginning of your end step, if a charge counter was put on a permanent under your control this turn, draw a card.',
    { cond: 'happened', event: { ev: 'counters', change: 'put', kind: 'charge', on: { controller: 'you' } }, scope: 'turn' }],
  ['CR 603.10a, 510.2: "it dealt combat damage to a player this turn" (the source dies)', 'When this creature dies, if it dealt combat damage to a player this turn, draw a card.',
    { cond: 'happened', event: { ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }, scope: 'turn' }],
  ['CR 603.10a, 120.1: "5 or more damage was dealt to it this turn" (the source dies)', 'When this creature dies, if 5 or more damage was dealt to it this turn, draw a card.',
    { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'damage', recipient: { object: { self: true } } }, scope: 'turn', sum: 'amount' }, op: '>=', right: 5 }],
];

/** Near misses: each stays manual ("it" that is not the source; a bare count without "or more"; another possessive). */
const NEAR_MISSES: readonly string[] = [
  'Whenever another creature you control dies, if it dealt combat damage to a player this turn, draw a card.',
  'When this creature dies, if 5 damage was dealt to it this turn, draw a card.',
  'Whenever another creature you control dies, if 5 or more damage was dealt to it this turn, draw a card.',
  "At the beginning of your end step, if you didn't attack with a creature this game, draw a card.",
  'At the beginning of your upkeep, if all creatures an opponent controls are green, you gain 1 life.',
];

describe('p2-intervening-2: each new intervening "if" reading compiles and passes the render gate (CR 603.4)', () => {
  for (const [rule, text, want] of READINGS) {
    it(`${rule}: "${text}"`, () => {
      const d = compile(text);
      expect(d.automation.level, JSON.stringify(d.automation)).toBe('full');
      expect(ifOf(d)).toEqual(want);
    });
  }
});

describe('p2-intervening-2: near misses stay manual (fail closed)', () => {
  for (const text of NEAR_MISSES) it(`"${text}"`, () => expect(compile(text).automation.level).not.toBe('full'));
});

const index = localIndex();

describe.skipIf(index === null)('p2-intervening-2 design 6.10 (local index): synthetic wordings', () => {
  it('no reading or near miss is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    for (const l of [...READINGS.map((r) => r[1]), ...NEAR_MISSES]) {
      expect(lines.has(l), l).toBe(false);
      expect(lines.has(l.replace(/\bthis creature\b/g, '~')), l).toBe(false);
    }
  });
});
