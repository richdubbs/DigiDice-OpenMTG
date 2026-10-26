/**
 * Round pc-players-1 (precon lane pc-players), played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 119.1, 608.2h         "you may gain life equal to the power of target creature you control": the controller's choice; the target's power
 *   CR 118.12a, 701.21a      "loses life equal to the number of creatures they control unless they sacrifice a creature of their choice": the player decides
 *   CR 121.1, 102.3          "draw two cards for each opponent who controls fewer creatures than you": each opponent judged alone, a tie is not fewer
 *   CR 119.1, 102.3          "if you have more life than an opponent": one opponent with less life is enough
 *   CR 107.3, 608.2h         "return each creature ... with toughness X or less ..., where X is the number of Islands you control"
 *   CR 110.4, 205.2a, 701.21a  "each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest"
 *   CR 101.4, 608.2d         "For each player, you choose from among the permanents that player controls ...": you choose, lands may be chosen and never sacrificed
 *   CR 101.4, 608.2d, 701.8a "Each player chooses a creature they control. Destroy the rest."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, find, findAll, life, put, scenario, answer } from '../../m3/scenario';
import { card, full, named, permanentsOf, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const cast = (s0: GameState, name: string, p: Parameters<typeof settle>[0] extends never ? never : Parameters<typeof settle>[1] = {}): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), p), p);

const SIPHON = card('Test Siphon', 'Sorcery', 'You may gain life equal to the power of target creature you control.');
const DRAIN = card('Test Drain', 'Sorcery', 'Target opponent loses life equal to the number of creatures they control unless they sacrifice a creature of their choice.');
const BOUNTY = card('Test Bounty', 'Sorcery', 'Draw two cards for each opponent who controls fewer creatures than you.');
const EDGE = card('Test Edge', 'Sorcery', 'You gain 2 life. Then if you have more life than an opponent, draw a card.');
const TIDE = card('Test Tide', 'Sorcery', 'Return each creature your opponents control with toughness X or less to its owner\'s hand, where X is the number of Islands you control.');
const GEAR = card('Test Gear', 'Sorcery', 'Each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest.');
const ARROGANCE = card('Test Arrogance', 'Sorcery', 'For each player, you choose from among the permanents that player controls an artifact, a creature, an enchantment, and a planeswalker. Then each player sacrifices all other nonland permanents they control.');
const RECKONING = card('Test Reckoning', 'Sorcery', 'Each player chooses a creature they control. Destroy the rest.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '4']);
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
const IDOL = card('Test Idol', 'Artifact', '');
const FORGE = card('Test Forge', 'Artifact Land', '');
const ISLE = card('Test Isle', 'Land — Island', '');
const SHRINE = card('Test Shrine', 'Enchantment', '');
const SAGE = card('Test Sage', 'Planeswalker — Sage', '');
const SIEGE = card('Test Siege', 'Battle — Siege', '');
const DEFS = [SIPHON, DRAIN, BOUNTY, EDGE, TIDE, GEAR, ARROGANCE, RECKONING, BEAR, OGRE, WALL, GOLEM, IDOL, FORGE, ISLE, SHRINE, SAGE, SIEGE];

describe('the synthetic cards are automated', () => {
  it('every synthetic spell plays fully', () => {
    for (const d of [SIPHON, DRAIN, BOUNTY, EDGE, TIDE, GEAR, ARROGANCE, RECKONING]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 119.1, 608.2h: "you may gain life equal to the power of target creature you control"', () => {
  const run = (yes: boolean): GameState => {
    const s = scenario([], { p1: { hand: ['Test Siphon'], battlefield: ['Test Ogre', 'Test Bear'] }, defs: DEFS });
    return cast(s, 'Test Siphon', { targets: [obj(find(s, 'Test Ogre', 'battlefield', 'p1'))], yes });
  };
  it('yes: the target Ogre has power 3, so Alice gains 3 (not the Bear\'s 2)', () => expect(life(run(true), 'p1')).toBe(23));
  it('no: "may" is her choice, she gains nothing', () => expect(life(run(false), 'p1')).toBe(20));
});

describe('CR 118.12a, 701.21a: "loses life equal to the number of creatures they control unless they sacrifice a creature of their choice"', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Drain'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Ogre'] }, defs: DEFS });
  it('Bob declines to sacrifice: he loses 3 (one for each of his three creatures)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Drain', { targets: [player('p2')], yes: false });
    expect(life(s, 'p2')).toBe(17);
    expect(permanentsOf(s, 'p2').length).toBe(3);
  });
  it('Bob sacrifices a creature of his choice: he loses nothing and has two creatures left', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Drain', { targets: [player('p2')], yes: true });
    expect(life(s, 'p2')).toBe(20);
    expect(permanentsOf(s, 'p2').length).toBe(2);
  });
});

describe('CR 121.1, 102.3: "draw two cards for each opponent who controls fewer creatures than you"', () => {
  it('Bob controls fewer creatures (1 against 2): Alice draws 2', () => {
    const s = scenario([], { p1: { hand: ['Test Bounty'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const before = handSize(s, 'p1');
    expect(handSize(cast(s, 'Test Bounty'), 'p1')).toBe(before - 1 + 2);
  });
  it('a tie is not fewer (2 against 2): Alice draws nothing', () => {
    const s = scenario([], { p1: { hand: ['Test Bounty'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    const before = handSize(s, 'p1');
    expect(handSize(cast(s, 'Test Bounty'), 'p1')).toBe(before - 1);
  });
});

describe('CR 119.1, 102.3: "if you have more life than an opponent"', () => {
  it('Alice gains 2 and has more life than Bob: she draws', () => {
    const s = scenario([], { p1: { hand: ['Test Edge'] }, defs: DEFS });
    const before = handSize(s, 'p1');
    const t = cast(s, 'Test Edge');
    expect([life(t, 'p1'), handSize(t, 'p1')]).toEqual([22, before - 1 + 1]);
  });
  it('Bob has more life (30 against 22): she does not draw', () => {
    const s = scenario([], { p1: { hand: ['Test Edge'] }, defs: DEFS });
    s.players.find((p) => p.id === 'p2')!.life = 30;
    const before = handSize(s, 'p1');
    const t = cast(s, 'Test Edge');
    expect([life(t, 'p1'), handSize(t, 'p1')]).toEqual([22, before - 1]);
  });
});

describe('CR 107.3, 608.2h: "toughness X or less, where X is the number of Islands you control"', () => {
  it('with two Islands, the opponent\'s creatures with toughness 2 or less return to hand; the Wall (toughness 4) and Alice\'s own Bear stay', () => {
    const s = scenario([], { p1: { hand: ['Test Tide'], battlefield: ['Test Isle', 'Test Isle', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Wall'] }, defs: DEFS });
    const t = cast(s, 'Test Tide');
    expect(named(t, 'Test Bear').length).toBe(1);
    expect(named(t, 'Test Wall').length).toBe(1);
    expect(permanentsOf(t, 'p1').some((id) => t.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect((t.zones.hand['p2'] ?? []).map((id) => t.objects[id]!.defId)).toContain('Test Bear');
  });
  it('with no Island, X is 0 and nothing returns', () => {
    const s = scenario([], { p1: { hand: ['Test Tide'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    expect(named(cast(s, 'Test Tide'), 'Test Bear').length).toBe(1);
  });
});

describe('CR 110.4, 205.2a, 701.21a: "each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest"', () => {
  it('Alice keeps the Golem as her artifact and the Bear she picks as her creature; the Wall is sacrificed; lands and the other player\'s lone artifact stay', () => {
    const s = scenario([], { p1: { hand: ['Test Gear'], battlefield: ['Test Golem', 'Test Bear', 'Test Wall', 'Test Isle'] }, p2: { battlefield: ['Test Idol', 'Test Isle'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const t = cast(s, 'Test Gear', { objects: [bear] });
    const names = (p: string) => permanentsOf(t, p).map((id) => t.objects[id]!.defId).sort();
    expect(names('p1')).toEqual(['Test Bear', 'Test Golem', 'Test Isle']);
    expect(names('p2')).toEqual(['Test Idol', 'Test Isle']);
  });
  it('a permanent of two types answers for both (CR 205.2a): a lone Golem is kept as the artifact and as the creature', () => {
    const s = scenario([], { p1: { hand: ['Test Gear'], battlefield: ['Test Golem', 'Test Shrine'] }, defs: DEFS });
    const t = cast(s, 'Test Gear');
    expect(permanentsOf(t, 'p1').map((id) => t.objects[id]!.defId).sort()).toEqual(['Test Golem', 'Test Shrine']);
  });
  it('with other candidates the same permanent may answer for two types (CR 205.2a): the Golem chosen as the creature too, so the Bear is sacrificed', () => {
    const s = scenario([], { p1: { hand: ['Test Gear'], battlefield: ['Test Golem', 'Test Bear'] }, defs: DEFS });
    const golem = find(s, 'Test Golem', 'battlefield', 'p1');
    const t = cast(s, 'Test Gear', { objects: [golem] });
    expect(permanentsOf(t, 'p1').map((id) => t.objects[id]!.defId)).toEqual(['Test Golem']);
  });
  it('a battle is not one of the four types: it is sacrificed', () => {
    const s = scenario([], { p1: { hand: ['Test Gear'], battlefield: ['Test Siege', { name: 'Test Sage', counters: { loyalty: 3 } }] }, defs: DEFS });
    const t = cast(s, 'Test Gear');
    expect(permanentsOf(t, 'p1').map((id) => t.objects[id]!.defId)).toEqual(['Test Sage']);
  });
});

describe('CR 101.4, 608.2d: "For each player, you choose from among the permanents that player controls an artifact, a creature, ..."', () => {
  it('Alice (not Bob) chooses for Bob; the artifact land Bob controls may be chosen as his artifact, so his Idol is sacrificed', () => {
    let s = scenario([], { p1: { hand: ['Test Arrogance'] }, p2: { battlefield: ['Test Idol', 'Test Forge', 'Test Bear'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Arrogance', 'hand', 'p1') }), {});
    let asked = 0;
    for (let guard = 0; guard < 10 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseObjects') {
        asked++;
        expect(d.player).toBe('p1'); // Alice chooses for Bob
        const forge = find(s, 'Test Forge', 'battlefield', 'p2');
        s = answer(s, { kind: 'chooseObjects', ids: d.options.includes(forge) ? [forge] : d.options.slice(0, d.min) });
      } else s = settle(s, {});
    }
    expect(asked).toBeGreaterThan(0);
    expect(permanentsOf(s, 'p2').map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Forge']);
  });
});

describe('CR 101.4, 608.2d, 701.8a: "Each player chooses a creature they control. Destroy the rest."', () => {
  it('each player keeps the creature they choose and every other creature is destroyed; a lone creature needs no choice', () => {
    const s = scenario([], { p1: { hand: ['Test Reckoning'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const t = cast(s, 'Test Reckoning', { objects: [ogre] });
    expect(permanentsOf(t, 'p1').map((id) => t.objects[id]!.defId)).toEqual(['Test Ogre']);
    expect(permanentsOf(t, 'p2').map((id) => t.objects[id]!.defId)).toEqual(['Test Wall']);
  });
  it('only creatures are destroyed (the artifact stays)', () => {
    const s = scenario([], { p1: { hand: ['Test Reckoning'], battlefield: ['Test Bear', 'Test Idol'] }, defs: DEFS });
    const t = cast(s, 'Test Reckoning');
    expect(permanentsOf(t, 'p1').map((id) => t.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Idol']);
  });
});
void findAll; void put;
