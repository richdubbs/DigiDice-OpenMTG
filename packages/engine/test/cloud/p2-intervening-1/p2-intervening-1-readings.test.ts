/**
 * p2-intervening-1 (lane p2-intervening): the round adds no template, only readings of the `Cond` hole (parser/holes/p2iv1.ts, wired in parser/holes/cond.ts#atoms),
 * their words in render/p2iv1.ts and render/cond.ts, the lowering of "it" / "that spell" to the event's object (parser/lower/ability.ts#resolveCondAnaphors) and the
 * cast record of a spell on the stack (effects/eval.ts#castRecordOf). One test per reading: a synthetic intervening "if" (design 6.10) compiles by the game's default
 * compiler to the expected condition and passes the exact render gate (the card is full); its near misses stay manual (fail closed). The behavior is in
 * p2-intervening-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { localIndex } from '../../m5/parser/support';

const compile = (text: string, type = 'Creature — Human'): CardDef =>
  compileCard({ name: 'Test Vigil Keeper', layout: 'normal', mana_cost: '{2}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(/Creature/.test(type) ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const ifOf = (d: CardDef): unknown => (d.faces[0]!.abilities[0] as { interveningIf?: unknown }).interveningIf;

/** [the rule, the synthetic line, the condition it compiles to (undefined: only checked to be full)]. */
const READINGS: readonly [string, string, unknown][] = [
  ['CR 603.4: "no artifacts are on the battlefield"', 'At the beginning of your end step, if no artifacts are on the battlefield, draw a card.',
    { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Artifact'] } } } }],
  ['CR 404.1: "you have three or more land cards in your graveyard"', 'At the beginning of your upkeep, if you have three or more land cards in your graveyard, you gain 1 life.',
    { cond: 'exists', of: { ref: 'each', filter: { types: ['Land'], zone: 'graveyard', owner: 'you', isCard: true } }, atLeast: 3 }],
  ['CR 404.1: "ten or more land cards are in your graveyard"', 'At the beginning of your end step, if ten or more land cards are in your graveyard, draw a card.',
    { cond: 'exists', of: { ref: 'each', filter: { types: ['Land'], isCard: true, zone: 'graveyard', owner: 'you' } }, atLeast: 10 }],
  ['CR 122.1: "~ has charge counters on it"', 'At the beginning of your upkeep, if this creature has charge counters on it, draw a card.',
    { cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: 'charge' } } }],
  ['CR 122.1: "~ has counters on it"', 'At the beginning of your upkeep, if this creature has counters on it, draw a card.',
    { cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: 'any' } } }],
  // p2-counters-state-1's reading (parser/holes/cond.ts#thereAre), reused: the counters of that kind on the object itself compared with 0
  ['CR 122.1: "there are no charge counters on ~"', 'At the beginning of your upkeep, if there are no charge counters on this creature, sacrifice it.',
    { cond: 'compare', left: { q: 'counters', on: { ref: 'self' }, kind: 'charge' }, op: '==', right: 0 }],
  ['CR 119.3, 500.1: "an opponent lost life last turn"', 'At the beginning of your end step, if an opponent lost life last turn, draw a card.',
    { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'lastTurn' }],
  ['CR 119.3: "you didn\'t lose life this turn"', "At the beginning of your end step, if you didn't lose life this turn, draw a card.",
    { cond: 'not', of: { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'you' }, scope: 'turn' } }],
  ['CR 402.1: "you have a card in hand"', 'At the beginning of your end step, if you have a card in hand, you lose 1 life.',
    { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, op: '>=', right: 1 }],
  ['CR 402.1: "that player has no cards in hand"', "At the beginning of each opponent's upkeep, if that player has no cards in hand, you gain 1 life.",
    { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'event', role: 'player' } }, op: '==', right: 0 }],
  ['CR 402.1, 506.2: "defending player has one or fewer cards in hand"', 'Whenever this creature attacks, if defending player has one or fewer cards in hand, draw a card.',
    { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'defending' } }, op: '<=', right: 1 }],
  ['CR 603.4: "you control exactly two creatures"', 'At the beginning of your upkeep, if you control exactly two creatures, you gain 2 life.',
    { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, op: '==', right: 2 }],
  ['CR 508.1: pack tactics, "you attacked with creatures with total power 8 or greater this combat"', 'Whenever this creature attacks, if you attacked with creatures with total power 8 or greater this combat, you gain 2 life.',
    { cond: 'happened', event: { ev: 'attacks', attacker: { controller: 'you' }, power: { op: '>=', value: 8 } }, scope: 'combat' }],
  ['CR 506.2: "defending player controls more creatures than you"', 'Whenever this creature attacks, if defending player controls more creatures than you, draw a card.',
    { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: { ref: 'defending' } } } }, op: '>', right: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } }],
  ['CR 202.3: "you control the creature with the greatest mana value or tied for the greatest mana value"', 'At the beginning of your upkeep, if you control the creature with the greatest mana value or tied for the greatest mana value, you gain 1 life.',
    { cond: 'all', of: [{ cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, { cond: 'compare', left: { q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, agg: 'max' }, op: '>=', right: { q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: { types: ['Creature'] } }, agg: 'max' } }] }],
  ['CR 601.2a, 400.7d: "you didn\'t cast it from your hand" (the creature that entered)', "Whenever a creature you control enters, if you didn't cast it from your hand, you gain 1 life.",
    { cond: 'not', of: { cond: 'wasCast', from: 'hand', object: { ref: 'event', role: 'subject' } } }],
  ['CR 601.2h: "no mana was spent to cast it" (the spell of a cast trigger)', 'Whenever an opponent casts a spell, if no mana was spent to cast it, you draw a card.',
    { cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '==', right: 0 }],
  ['CR 122.1: "there are ten or more counters among creatures you control"', 'At the beginning of your upkeep, if there are ten or more counters among creatures you control, you gain 5 life.',
    { cond: 'compare', left: { q: 'counters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: 'any' }, op: '>=', right: 10 }],
  ['CR 701.9: "a player discarded a card this turn"', 'At the beginning of your end step, if a player discarded a card this turn, you gain 1 life.',
    { cond: 'happened', event: { ev: 'action', verb: 'discard' }, scope: 'turn' }],
  ['CR 500.1: "it\'s not that player\'s turn"', "Whenever a player casts a spell, if it's not that player's turn, you gain 1 life.",
    { cond: 'not', of: { cond: 'turnOf', whose: { ref: 'event', role: 'player' } } }],
  ['CR 603.4: "that player controls an untapped artifact"', "At the beginning of each player's upkeep, if that player controls an untapped artifact, you gain 1 life.", undefined],
  ['CR 401.1: "you have 100 or more cards in your library"', 'At the beginning of your upkeep, if you have 100 or more cards in your library, draw a card.',
    { cond: 'compare', left: { q: 'zoneSize', zone: 'library', of: { ref: 'you' } }, op: '>=', right: 100 }],
  ['CR 120.1: "~ dealt damage to an opponent this turn"', 'At the beginning of your end step, if this creature dealt damage to an opponent this turn, you gain 2 life.',
    { cond: 'happened', event: { ev: 'damage', source: { self: true }, recipient: { player: 'opponent' } }, scope: 'turn' }],
  ['CR 508.1: "no creatures attacked this turn"', 'At the beginning of your end step, if no creatures attacked this turn, you gain 2 life.',
    { cond: 'not', of: { cond: 'happened', event: { ev: 'attacks', attacker: { types: ['Creature'] } }, scope: 'turn' } }],
  ['CR 702.33d: "that spell was kicked"', 'Whenever you cast a spell, if that spell was kicked, draw a card.',
    { cond: 'wasCast', kicked: true, object: { ref: 'event', role: 'spell' } }],
  ['CR 201.2: "it doesn\'t have the same name as another artifact you control or an artifact card in your graveyard"', "Whenever an artifact you control enters, if it doesn't have the same name as another artifact you control or an artifact card in your graveyard, you gain 1 life.", undefined],
];

/** Near misses: each stays manual (a bare number is never "at least"; another comparison; "it" or "that spell" that is not the event's object). */
const NEAR_MISSES: readonly string[] = [
  'At the beginning of your upkeep, if you have three land cards in your graveyard, you gain 1 life.',
  'Whenever this creature attacks, if you attacked with creatures with total power 8 or less this combat, you gain 2 life.',
  'Whenever this creature attacks, if defending player controls more creatures than an opponent, draw a card.',
  "At the beginning of your upkeep, if it wasn't cast, draw a card.",
  'Whenever a creature dies, if that spell was kicked, draw a card.',
  'At the beginning of your upkeep, if you control exactly creatures, you gain 2 life.',
];

describe('p2-intervening-1: each new intervening "if" reading compiles and passes the render gate (CR 603.4)', () => {
  for (const [rule, text, want] of READINGS) {
    it(`${rule}: "${text}"`, () => {
      const d = compile(text);
      expect(d.automation.level, JSON.stringify(d.automation)).toBe('full');
      if (want !== undefined) expect(ifOf(d)).toEqual(want);
    });
  }
});

describe('p2-intervening-1: near misses stay manual (fail closed)', () => {
  for (const text of NEAR_MISSES) it(`"${text}"`, () => expect(compile(text).automation.level).not.toBe('full'));
});

const index = localIndex();

describe.skipIf(index === null)('p2-intervening-1 design 6.10 (local index): synthetic wordings', () => {
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
    const ours = [...READINGS.map((r) => r[1]), ...NEAR_MISSES];
    for (const l of ours) {
      expect(lines.has(l), l).toBe(false);
      expect(lines.has(l.replace(/\bthis creature\b/g, '~')), l).toBe(false);
    }
  });
});
