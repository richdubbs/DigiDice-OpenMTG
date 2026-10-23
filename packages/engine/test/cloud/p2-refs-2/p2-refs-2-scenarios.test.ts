/**
 * p2-refs-2 (Phase 2 lane p2-refs): the round's changes played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.19c        "A creature destroyed this way can't be regenerated": a regeneration shield does not save it; without the sentence it does
 *   CR 608.2c, 701.19c  "Destroy target creature if it's white. A creature destroyed this way can't be regenerated.": a white creature dies, another is untouched
 *   CR 608.2d         "You may tap or untap target permanent, then you may tap or untap another target permanent": two choices, one for each target
 *   CR 702.3b, 603.7  "~ can attack this turn as though it didn't have defender. Exile it at the beginning of the next end step.": ~ is exiled at the end step
 *   CR 702.33d        "If this spell was kicked, it deals 3 damage to that player" / "if this creature wasn't kicked, sacrifice it" / "... it deals 4 damage ... instead"
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, advanceTo, answer, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll } from '../cmd3/helpers';

const sideOf = (s: GameState, player: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player).map((id) => s.objects[id]!.defId);
const handSize = (s: GameState, player: string): number => (s.zones.hand[player] ?? []).length;

const TROLL = card('Test Troll', 'Creature — Troll', '{0}: Regenerate this creature.', ['2', '2']);
const PALE = card('Test Pale Troll', 'Creature — Troll', '{0}: Regenerate this creature.', ['2', '2']);
const SMITE = card('Test Smite', 'Instant', "Destroy target creature. A creature destroyed this way can't be regenerated.");
const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
const REND = card('Test Rend', 'Instant', "Destroy target creature if it's white. A creature destroyed this way can't be regenerated.");
const PURGE = card('Test Purge', 'Sorcery', "Destroy all creatures. Creatures destroyed this way can't be regenerated.");
const TOIL = card('Test Toil', 'Instant', 'You may tap or untap target permanent, then you may tap or untap another target permanent.');
const RELIC = card('Test Relic', 'Artifact', '');
const MAZE = card('Test Maze', 'Creature — Wall', "Defender\n{0}: This creature can attack this turn as though it didn't have defender. Exile it at the beginning of the next end step.", ['4', '2']);
const SABOTAGE = card('Test Sabotage', 'Sorcery', 'Kicker {1}\nTarget player discards two cards. If this spell was kicked, it deals 3 damage to that player.');
const BRUTE = card('Test Brute', 'Creature — Goblin', "Kicker {1}\nAt the beginning of the end step, if this creature wasn't kicked, sacrifice it.", ['4', '4']);
const SURGE = card('Test Surge', 'Sorcery', 'Kicker {1}\nTest Surge deals 1 damage to each creature and each player. If this spell was kicked, it deals 3 damage to each creature and each player instead.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const DEFS = [TROLL, PALE, SMITE, SWAT, REND, PURGE, TOIL, RELIC, MAZE, SABOTAGE, BRUTE, SURGE, BEAR];
const whiteTroll = { ...PALE, faces: PALE.faces.map((f) => ({ ...f, colors: ['W'] })) } as typeof PALE;

describe('the synthetic p2-refs-2 cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [SMITE, REND, PURGE, TOIL, MAZE, SABOTAGE, BRUTE, SURGE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** A troll of p1 with a regeneration shield, then `spell` cast on it by p1. */
function shielded(spell: string, troll = 'Test Troll', defs = DEFS): GameState {
  const s0 = scenario([], { defs, p1: { hand: [spell], battlefield: [troll] } });
  const id = find(s0, troll, 'battlefield', 'p1');
  let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }));
  s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') }), { targets: [{ kind: 'object', id }] });
  return s;
}

describe('CR 701.19c: "A creature destroyed this way can\'t be regenerated"', () => {
  it('the shielded creature dies', () => expect(sideOf(shielded('Test Smite'), 'p1')).toEqual([]));
  it('without the sentence, the shield saves it', () => expect(sideOf(shielded('Test Swat'), 'p1')).toEqual(['Test Troll']));
  it('"Creatures destroyed this way can\'t be regenerated": a shielded creature dies to the sweeper', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Purge'], battlefield: ['Test Troll'] } });
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Troll', 'battlefield', 'p1'), ability: 'p:0:0' }));
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand', 'p1') }));
    expect(sideOf(s, 'p1')).toEqual([]);
  });
});

describe('CR 608.2c, 701.19c: "Destroy target creature if it\'s white. A creature destroyed this way can\'t be regenerated."', () => {
  const defs = [...DEFS.filter((d) => d !== PALE), whiteTroll];
  it('a shielded white creature dies', () => expect(sideOf(shielded('Test Rend', 'Test Pale Troll', defs), 'p1')).toEqual([]));
  it('a creature that is not white is not destroyed', () => expect(sideOf(shielded('Test Rend', 'Test Troll', defs), 'p1')).toEqual(['Test Troll']));
});

/** Cast Test Toil on `a` then `b` (one target decision each), answering every yes/no with `yes`. */
function toil(s0: GameState, a: string, b: string, yes: boolean): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Toil', 'hand', 'p1') });
  const queue = [a, b];
  for (let i = 0; i < 6 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: queue.shift()! }] });
  return resolveAll(s, { yes });
}

describe('CR 608.2d: "You may tap or untap target permanent, then you may tap or untap another target permanent"', () => {
  it('each target is tapped (the first choice taken for each)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Toil'] }, p2: { battlefield: ['Test Bear', 'Test Relic'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const s = toil(s0, bear, relic, true);
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.objects[relic]!.tapped).toBe(true);
  });
  it('declining both leaves both untapped', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Toil'] }, p2: { battlefield: ['Test Bear', 'Test Relic'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const s = toil(s0, bear, relic, false);
    expect(s.objects[bear]!.tapped || s.objects[relic]!.tapped).toBe(false);
  });
});

describe('CR 702.3b, 603.7: "~ can attack this turn as though it didn\'t have defender. Exile it at the beginning of the next end step."', () => {
  it('activated: at the end step it is exiled; not activated: it stays', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Maze'] } });
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Maze', 'battlefield', 'p1'), ability: 'p:0:1' }));
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(sideOf(s, 'p1')).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Maze']);
    const t = resolveAll(advanceTo(s0, 1, 'end'));
    expect(sideOf(t, 'p1')).toEqual(['Test Maze']);
  });
});

describe('CR 702.33d: "if this spell was kicked" / "if this creature wasn\'t kicked" name the object itself', () => {
  const sabotage = (kick: boolean): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Sabotage'], battlefield: ['Plains'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sabotage', 'hand', 'p1') }), { yes: kick, targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('kicked: two cards discarded and 3 damage to that player; not kicked: no damage', () => {
    const k = sabotage(true);
    expect(handSize(k, 'p2')).toBe(1);
    expect(life(k, 'p2')).toBe(17);
    const n = sabotage(false);
    expect(handSize(n, 'p2')).toBe(1);
    expect(life(n, 'p2')).toBe(20);
  });
  it('"if this creature wasn\'t kicked, sacrifice it": not kicked, it is sacrificed at the end step; kicked, it stays', () => {
    for (const kick of [false, true]) {
      const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Brute'], battlefield: ['Plains'] } });
      let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Brute', 'hand', 'p1') }), { yes: kick });
      s = resolveAll(advanceTo(s, 1, 'end'));
      expect(sideOf(s, 'p1').includes('Test Brute'), `kicked ${kick}`).toBe(kick);
    }
  });
  it('"If this spell was kicked, it deals 3 damage to each creature and each player instead": 3 kicked, 1 not', () => {
    for (const [kick, dmg] of [[true, 3], [false, 1]] as const) {
      const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Surge'], battlefield: ['Plains'] }, p2: { battlefield: ['Test Troll'] } });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Surge', 'hand', 'p1') }), { yes: kick });
      expect([life(s, 'p1'), life(s, 'p2')], `kicked ${kick}`).toEqual([20 - dmg, 20 - dmg]);
      expect(sideOf(s, 'p2').length, `kicked ${kick}`).toBe(dmg >= 2 ? 0 : 1);
    }
  });
});
