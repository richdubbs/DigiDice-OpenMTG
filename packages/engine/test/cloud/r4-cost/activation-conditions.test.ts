/**
 * r4-cost: conditions of "Activate only if ..." restrictions the Cond hole did not read (parser/holes/cost-conds.ts; actions/announce-cond.ts reads them when the
 * ability is activated), played through the engine with synthetic cards (design 6.10).
 *
 *   CR 602.5b, 120.1a, 120.2b   "an opponent has been dealt noncombat damage this turn": offered only after a spell dealt damage to an opponent
 *   CR 602.5b, 510.2, 120.1     "an opponent was dealt combat damage by a legendary creature this turn": the source as it dealt the damage; a nonlegendary
 *                               attacker's damage does not count
 *   CR 602.5b, 402.1            "a player has one or fewer cards in hand": any player, the activating player included
 *   CR 602.5b, 110.4, 205.2a    "there are four or more permanent types among cards in your graveyard": an artifact creature card is two permanent types; an
 *                               instant or a sorcery card is none
 *   CR 602.5b, 603.10a, 205.3m  "a Bird, Frog, Otter, or Rat entered the battlefield under your control this turn": any one of the listed creature types
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { activations, attackWith, card, cast, find, full, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const REPRISER = card('Test Ember Watch', 'Artifact', '{T}: Draw a card. Activate only if an opponent has been dealt noncombat damage this turn.', '{1}');
const BLITZ = card('Test Arena Horn', 'Artifact', '{T}: Draw a card. Activate only if an opponent was dealt combat damage by a legendary creature this turn.', '{1}');
const HANDS = card('Test Lean Altar', 'Artifact', '{T}: You gain 3 life. Activate only if a player has one or fewer cards in hand and only as a sorcery.', '{1}');
const TYPES = card('Test Ossuary Gate', 'Artifact', '{T}: You gain 3 life. Activate only if there are four or more permanent types among cards in your graveyard.', '{1}');
const POND = card('Test Pond Shrine', 'Artifact', '{T}: You gain 3 life. Activate only if a Bird, Frog, Otter, or Rat entered the battlefield under your control this turn.', '{1}');
const SHOCK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', '{0}');
const HERO = card('Test Named Hero', 'Legendary Creature — Human Knight', '', '{2}', PT);
const GRUNT = card('Test Plain Grunt', 'Creature — Human Soldier', '', '{2}', PT);
const FROG = card('Test Pond Frog', 'Creature — Frog', '', '{0}', ['1', '1']);
const NEWT = card('Test Bog Newt', 'Creature — Salamander', '', '{0}', ['1', '1']);
const GOLEM = card('Test Iron Golem', 'Artifact Creature — Golem', '', '{3}', PT);
const WARD = card('Test Ward Glyph', 'Enchantment', '', '{1}');
const SOIL = card('Test Fresh Soil', 'Land', '', '');
const DEFS = [REPRISER, BLITZ, HANDS, TYPES, POND, SHOCK, HERO, GRUNT, FROG, NEWT, GOLEM, WARD, SOIL];

const offered = (s: GameState, name: string): boolean => activations(s, name).length > 0;

describe('r4-cost: activation restrictions on this turn\'s history and the board (CR 602.5b)', () => {
  it('the cards are automated', () => {
    for (const d of [REPRISER, BLITZ, HANDS, TYPES, POND]) expect(full(d), d.name).toBe(true);
  });

  it('CR 120.1a, 602.5b: "an opponent has been dealt noncombat damage this turn": not before, offered after a spell deals damage to the opponent', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ember Watch'], hand: ['Test Spark', 'Test Spark'], library: ['Test Fresh Soil', 'Test Fresh Soil'] } });
    expect(offered(s, 'Test Ember Watch')).toBe(false);
    const me = cast(s, 'Test Spark', { targets: [[{ kind: 'player', id: 'p1' }]] });
    expect(offered(resolveAll(me), 'Test Ember Watch')).toBe(false); // damage to yourself is not damage to an opponent
    s = resolveAll(cast(s, 'Test Spark', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(offered(s, 'Test Ember Watch')).toBe(true);
  });

  it('CR 510.2, 120.1: "dealt combat damage by a legendary creature this turn": a legendary attacker\'s damage counts, a nonlegendary one\'s does not', () => {
    const base = scenario([], { defs: DEFS, p1: { battlefield: ['Test Arena Horn', 'Test Named Hero', 'Test Plain Grunt'], library: ['Test Fresh Soil', 'Test Fresh Soil'] } });
    expect(offered(base, 'Test Arena Horn')).toBe(false);
    const grunt = attackWith(base, [find(base, 'Test Plain Grunt', 'battlefield', 'p1')]);
    expect(grunt.players.find((p) => p.id === 'p2')!.life).toBeLessThan(20);
    expect(offered(grunt, 'Test Arena Horn')).toBe(false);
    const hero = attackWith(base, [find(base, 'Test Named Hero', 'battlefield', 'p1')]);
    expect(offered(hero, 'Test Arena Horn')).toBe(true);
  });

  it('CR 402.1, 602.5b: "a player has one or fewer cards in hand": either player\'s hand counts; with two cards each it is not offered', () => {
    const none = scenario([], { defs: DEFS, p1: { battlefield: ['Test Lean Altar'], hand: ['Test Spark', 'Test Spark'] }, p2: { hand: ['Test Spark', 'Test Spark'] } });
    expect(offered(none, 'Test Lean Altar')).toBe(false);
    const theirs = scenario([], { defs: DEFS, p1: { battlefield: ['Test Lean Altar'], hand: ['Test Spark', 'Test Spark'] }, p2: { hand: ['Test Spark'] } });
    expect(offered(theirs, 'Test Lean Altar')).toBe(true);
    const mine = scenario([], { defs: DEFS, p1: { battlefield: ['Test Lean Altar'] }, p2: { hand: ['Test Spark', 'Test Spark', 'Test Spark'] } });
    expect(offered(mine, 'Test Lean Altar')).toBe(true);
  });

  it('CR 110.4: "four or more permanent types among cards in your graveyard": an artifact creature is two, an instant none', () => {
    const three = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ossuary Gate'], graveyard: ['Test Iron Golem', 'Test Fresh Soil', 'Test Spark'] } });
    expect(offered(three, 'Test Ossuary Gate')).toBe(false); // artifact, creature, land (the instant is no permanent type)
    const four = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ossuary Gate'], graveyard: ['Test Iron Golem', 'Test Fresh Soil', 'Test Ward Glyph'] } });
    expect(offered(four, 'Test Ossuary Gate')).toBe(true);
    const theirs = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ossuary Gate'] }, p2: { graveyard: ['Test Iron Golem', 'Test Fresh Soil', 'Test Ward Glyph'] } });
    expect(offered(theirs, 'Test Ossuary Gate')).toBe(false); // "your graveyard"
  });

  it('CR 603.10a, 205.3m: "a Bird, Frog, Otter, or Rat entered the battlefield under your control this turn": a Frog does, a Salamander does not', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pond Shrine'], hand: ['Test Pond Frog', 'Test Bog Newt'] } });
    expect(offered(s0, 'Test Pond Shrine')).toBe(false);
    expect(offered(resolveAll(cast(s0, 'Test Bog Newt')), 'Test Pond Shrine')).toBe(false);
    expect(offered(resolveAll(cast(s0, 'Test Pond Frog')), 'Test Pond Shrine')).toBe(true);
  });
});
