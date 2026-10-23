/**
 * FAST5 T40 (replacement, prevention and trigger-doubling variants): the templates of parser/templates/zz-fast5/t40.json (and the engine support they needed)
 * played through the engine with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it
 * checks.
 *
 *   CR 614.1a, 614.5, 120.3   "If a creature you control would deal damage to a permanent or player, it deals double that damage instead."
 *   CR 614.1a, 120.3          "... it deals that much damage plus N instead." (a list of creature types)
 *   CR 614.1a, 120.2b         "If a source you control would deal noncombat damage ... while there are N or more card types among cards in your graveyard, ... double"
 *   CR 614.1a, 607.2d         "Double all damage that sources you control of the chosen type would deal."
 *   CR 614.1a, 119.3          "If an opponent would lose life during your turn, they lose twice that much life instead."
 *   CR 614.1a, 122.6          "If one or more counters would be put on a creature, ... you control, twice that many of each of those kinds of counters are put on it instead."
 *   CR 615.1, 510.1           "Prevent all combat damage that would be dealt to and dealt by ~."
 *   CR 615.1, 120.2b          "Prevent all noncombat damage that would be dealt to other creatures you control."
 *   CR 615.1, 611.2a          "Prevent all damage that would be dealt to creatures you control this turn."
 *   CR 614.1a, 614.6          "If that permanent would die this turn, exile it instead."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, passBoth, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);

const PING = '{T}: ~ deals 2 damage to any target.';
const DOUBLER = card('Test Doubler', 'Enchantment', 'If a creature you control would deal damage to a permanent or player, it deals double that damage instead.', { colors: ['R'] });
const BOOSTER = card('Test Booster', 'Enchantment', 'If a Goblin, Rat, Elf, or Wizard you control would deal damage to a permanent or player, it deals that much damage plus 2 instead.', { colors: ['R'] });
const DELIRIOUS = card('Test Delirious', 'Enchantment', 'If a source you control would deal noncombat damage to a permanent or player while there are two or more card types among cards in your graveyard, it deals double that damage instead.', { colors: ['R'] });
const CHOOSER = card('Test Chooser', 'Enchantment', 'As this enchantment enters, choose a creature type.\nDouble all damage that sources you control of the chosen type would deal.', { colors: ['R'] });
const LOSSY = card('Test Lossy', 'Creature — Vampire', 'If an opponent would lose life during your turn, they lose twice that much life instead.', { pt: ['2', '2'], colors: ['B'] });
const COUNTER_DOUBLER = card('Test Counter Doubler', 'Enchantment', 'If one or more counters would be put on a creature, Vehicle, or Planet you control, twice that many of each of those kinds of counters are put on it instead.', { colors: ['G'] });
const FOG = card('Test Fog Wall', 'Creature — Wall', 'Defender\nPrevent all combat damage that would be dealt to and dealt by this creature.', { pt: ['3', '3'], colors: ['U'] });
const BARRICADE = card('Test Barricade', 'Artifact Creature — Wall', 'Prevent all noncombat damage that would be dealt to other creatures you control.', { pt: ['0', '4'], colors: [] });
const SHIELD = card('Test Shield', 'Instant', 'Prevent all damage that would be dealt to creatures you control this turn.', { colors: ['W'] });
const HEX = card('Test Hex', 'Instant', '~ deals 3 damage to target black or green creature or planeswalker. If that permanent would die this turn, exile it instead.', { colors: ['R'] });

const GOBLIN = card('Test Goblin', 'Creature — Goblin', PING, { pt: ['1', '1'], colors: ['R'] });
const ELF = card('Test Elf', 'Creature — Elf', PING, { pt: ['1', '1'], colors: ['G'] });
const BEAR = card('Test Bear', 'Creature — Bear', PING, { pt: ['2', '2'], colors: ['G'] });
const BIGBEAR = card('Test Big Bear', 'Creature — Bear', '', { pt: ['4', '4'], colors: ['G'] });
const BLACK = card('Test Black Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['B'] });
const TUTOR = card('Test Tutor', 'Creature — Human', '{T}: Put a +1/+1 counter on target creature.', { pt: ['1', '1'], colors: ['G'] });
const BOLT = card('Test Bolt', 'Instant', '~ deals 2 damage to any target.', { colors: ['R'] });
const RELIC = card('Test Relic', 'Artifact', '', { colors: [] });
const ALL = [DOUBLER, BOOSTER, DELIRIOUS, CHOOSER, LOSSY, COUNTER_DOUBLER, FOG, BARRICADE, SHIELD, HEX, GOBLIN, ELF, BEAR, BIGBEAR, BLACK, TUTOR, BOLT, RELIC];

describe('design 6.9: every T40 sentence is compiled to data, none left manual', () => {
  it('no manual ability on the T40 test cards', () => {
    for (const d of [DOUBLER, BOOSTER, DELIRIOUS, CHOOSER, COUNTER_DOUBLER, FOG, BARRICADE, SHIELD, HEX]) expect(noManual(d), d.name).toEqual([]);
  });
});

/** Activate the first ability of `source`, announce the targets, pay automatically (the ability is on the stack). */
function activate(s0: GameState, source: string, targets: TargetChoice[] = [], player = 'p1'): GameState {
  let s = act(s0, { type: 'activate', player, source, ability: 'p:0:0' });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
function castSpell(s0: GameState, name: string, targets: TargetChoice[] = [], player = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const toP2 = (s: GameState): TargetChoice[] => [{ kind: 'player', id: 'p2' }, ...(s ? [] : [])];
const obj = (id: ObjectId): TargetChoice[] => [{ kind: 'object', id }];
const inGrave = (s: GameState, name: string, owner: 'p1' | 'p2'): boolean => s.zones.graveyard[owner]!.some((id) => s.objects[id]!.defId === name);
const inExile = (s: GameState, name: string): boolean => s.zones.exile.some((id) => s.objects[id]!.defId === name);
const onBf = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

describe('CR 614.1a, 614.5, 120.3: "If a creature you control would deal damage to a permanent or player, it deals double that damage instead."', () => {
  const board = (extra: { p1?: string[]; p2?: string[]; hand?: string[] } = {}): GameState =>
    scenario([], { defs: ALL, p1: { battlefield: ['Test Doubler', 'Test Bear', ...(extra.p1 ?? [])], hand: extra.hand ?? [] }, p2: { battlefield: extra.p2 ?? [] } });
  it('a creature of yours that deals damage to a player deals twice that much', () => {
    let s = board();
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(16);
  });
  it('damage to a creature is doubled too: a permanent is a recipient (2 doubled to 4 kills a 3/3)', () => {
    let s = board({ p2: ['Test Fog Wall'] });
    const wall = find(s, 'Test Fog Wall', 'battlefield', 'p2');
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), obj(wall)));
    expect(inGrave(s, 'Test Fog Wall', 'p2')).toBe(true);
  });
  it('a spell of yours is not a creature: its damage is not doubled', () => {
    let s = board({ hand: ['Test Bolt'] });
    s = passBoth(castSpell(s, 'Test Bolt', toP2(s)));
    expect(life(s, 'p2')).toBe(18);
  });
  it("another player's creature is not one you control: the opponent's Doubler does not double your damage", () => {
    let s = scenario([], { defs: ALL, p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Doubler'] } });
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 614.1a, 120.3: "... it deals that much damage plus 2 instead." for a list of creature types', () => {
  const board = (): GameState => scenario([], { defs: ALL, p1: { battlefield: ['Test Booster', 'Test Goblin', 'Test Elf', 'Test Bear'] } });
  it('a Goblin and an Elf of yours deal 2 plus 2; a Bear (not in the list) deals 2', () => {
    let s = board();
    s = passBoth(activate(s, find(s, 'Test Goblin', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(16);
    s = passBoth(activate(s, find(s, 'Test Elf', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(12);
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(10);
  });
});

describe('CR 614.1a, 120.2b: noncombat damage doubled while there are two or more card types among cards in your graveyard', () => {
  const board = (graveyard: string[]): GameState =>
    scenario([], { defs: ALL, p1: { battlefield: ['Test Delirious', 'Test Bear', 'Test Big Bear'], hand: ['Test Bolt'], graveyard }, p2: {} });
  it('with an instant and an artifact in the graveyard, a source of yours (a spell, a creature) deals twice its noncombat damage', () => {
    let s = board(['Test Bolt', 'Test Relic']);
    s = passBoth(castSpell(s, 'Test Bolt', toP2(s)));
    expect(life(s, 'p2')).toBe(16);
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(12);
  });
  it('with only one card type in the graveyard nothing is doubled', () => {
    let s = board(['Test Bolt', 'Test Bolt']);
    s = passBoth(castSpell(s, 'Test Bolt', toP2(s)));
    expect(life(s, 'p2')).toBe(18);
  });
  it('combat damage is never doubled (it is not noncombat damage)', () => {
    let s = board(['Test Bolt', 'Test Relic']);
    const big = find(s, 'Test Big Bear', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[big]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers', 12);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(life(s, 'p2')).toBe(16);
  });
});

describe('CR 614.1a, 607.2d: "Double all damage that sources you control of the chosen type would deal."', () => {
  const board = (): GameState => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Chooser', 'Test Bolt'], battlefield: ['Test Goblin', 'Test Elf'] } });
    s = castSpell(s, 'Test Chooser');
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'chooseName' });
    return answer(s, { kind: 'chooseName', name: 'Goblin' });
  };
  it('a Goblin of yours deals twice its damage; an Elf and a spell do not', () => {
    let s = board();
    s = passBoth(activate(s, find(s, 'Test Goblin', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(16);
    s = passBoth(activate(s, find(s, 'Test Elf', 'battlefield'), toP2(s)));
    expect(life(s, 'p2')).toBe(14);
    s = passBoth(castSpell(s, 'Test Bolt', toP2(s)));
    expect(life(s, 'p2')).toBe(12);
  });
});

describe('CR 614.1a, 119.3, 120.3a: "If an opponent would lose life during your turn, they lose twice that much life instead." doubles the life loss damage causes', () => {
  // Cloud r3-repl: rules/damage.ts proposes the life loss that damage dealt to a player causes (CR 120.3a), so the replacement applies to it (Bloodletter of
  // Aclazotz is mostly damage). The damage itself is not doubled: lifelink would gain the damage dealt, not the life lost (CR 702.15b).
  it('is automated now (the template\'s need is registered)', () => {
    expect(noManual(LOSSY)).toEqual([]);
  });
  it('on your turn an opponent dealt 2 damage loses 4 life; your own life loss is not doubled', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Bolt', 'Test Bolt'], battlefield: ['Test Lossy'] } });
    s = passBoth(castSpell(s, 'Test Bolt', toP2(s)));
    expect(life(s, 'p2')).toBe(16);
    s = passBoth(castSpell(s, 'Test Bolt', [{ kind: 'player', id: 'p1' }]));
    expect(life(s, 'p1')).toBe(18);
  });
  it('an opponent\'s permanent with it does not double your loss on your turn (they are the controller: it is not their turn)', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Bolt'] }, p2: { battlefield: ['Test Lossy'] } });
    s = passBoth(castSpell(s, 'Test Bolt', [{ kind: 'player', id: 'p1' }]));
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 614.1a, 122.6: counters on a creature you control are doubled, of every kind', () => {
  it('a +1/+1 counter put on your creature is two; on an opponent\'s creature it is one', () => {
    let s = scenario([], { defs: ALL, p1: { battlefield: ['Test Counter Doubler', 'Test Tutor', 'Test Bear'] }, p2: { battlefield: ['Test Goblin'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = passBoth(activate(s, find(s, 'Test Tutor', 'battlefield'), obj(bear)));
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    s = tweak(s, (t) => { t.objects[find(t, 'Test Tutor', 'battlefield')]!.tapped = false; });
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p2');
    s = passBoth(activate(s, find(s, 'Test Tutor', 'battlefield'), obj(goblin)));
    expect(s.objects[goblin]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 615.1, 510.1: "Prevent all combat damage that would be dealt to and dealt by ~."', () => {
  it('a blocking wall neither takes nor deals combat damage', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Big Bear'] }, p2: { battlefield: ['Test Fog Wall'] } });
    const bear = find(s0, 'Test Big Bear', 'battlefield');
    const wall = find(s0, 'Test Fog Wall', 'battlefield', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[wall, bear]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(dmg(s, wall)).toBe(0);
    expect(dmg(s, bear)).toBe(0);
    expect(onBf(s, 'Test Fog Wall')).toBe(true);
  });
  it('an unblocked attacker with the wall as the attacker: the wall (not a defender here) would deal no combat damage to the player', () => {
    const s0 = scenario([], { defs: [...ALL, card('Test Fog Runner', 'Creature — Wall', 'Prevent all combat damage that would be dealt to and dealt by this creature.', { pt: ['3', '3'], colors: ['U'] })], p1: { battlefield: ['Test Fog Runner'] } });
    const runner = find(s0, 'Test Fog Runner', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[runner]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers', 12);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(life(s, 'p2')).toBe(20);
  });
  it('noncombat damage to the wall is not prevented', () => {
    let s = scenario([], { defs: ALL, p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Fog Wall'] } });
    const wall = find(s, 'Test Fog Wall', 'battlefield', 'p2');
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), obj(wall)));
    expect(dmg(s, wall)).toBe(2);
  });
});

describe('CR 615.1, 120.2b: "Prevent all noncombat damage that would be dealt to other creatures you control."', () => {
  const board = (): GameState => scenario([], { defs: ALL, p1: { battlefield: ['Test Barricade', 'Test Bear', 'Test Elf'] }, p2: { battlefield: ['Test Goblin'] } });
  it("another creature of yours takes no noncombat damage; the barricade itself, and the opponent's creature, do", () => {
    let s = board();
    const bear = find(s, 'Test Bear', 'battlefield');
    s = passBoth(activate(s, find(s, 'Test Elf', 'battlefield'), obj(bear)));
    expect(dmg(s, bear)).toBe(0);
    const wall = find(s, 'Test Barricade', 'battlefield');
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), obj(wall)));
    expect(dmg(s, wall)).toBe(2);
    s = tweak(s, (t) => { t.objects[find(t, 'Test Bear', 'battlefield')]!.tapped = false; });
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), obj(find(s, 'Test Goblin', 'battlefield', 'p2'))));
    expect(inGrave(s, 'Test Goblin', 'p2')).toBe(true);
  });
  it('combat damage to your other creatures is not prevented', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Barricade', 'Test Goblin'] }, p2: { battlefield: ['Test Big Bear'] } });
    let s = advanceTo(s0, 2, 'main1');
    const big = find(s, 'Test Big Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[big]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[find(s, 'Test Goblin', 'battlefield', 'p1'), big]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(inGrave(s, 'Test Goblin', 'p1')).toBe(true);
  });
});

describe('CR 615.1, 611.2a: "Prevent all damage that would be dealt to creatures you control this turn."', () => {
  const board = (): GameState => scenario([], { defs: ALL, p1: { hand: ['Test Shield'], battlefield: ['Test Bear', 'Test Elf'] }, p2: { battlefield: ['Test Goblin'], hand: ['Test Bolt'] } });
  it('every creature you control is safe this turn (also one that arrives after it resolved); the opponent\'s is not', () => {
    let s = board();
    s = passBoth(castSpell(s, 'Test Shield'));
    const bear = find(s, 'Test Bear', 'battlefield');
    s = passBoth(activate(s, find(s, 'Test Elf', 'battlefield'), obj(bear)));
    expect(dmg(s, bear)).toBe(0);
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Black Bear'); });
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), obj(find(s, 'Test Black Bear', 'battlefield'))));
    expect(dmg(s, find(s, 'Test Black Bear', 'battlefield'))).toBe(0);
    s = tweak(s, (t) => { t.objects[find(t, 'Test Bear', 'battlefield')]!.tapped = false; });
    s = passBoth(activate(s, find(s, 'Test Bear', 'battlefield'), obj(find(s, 'Test Goblin', 'battlefield', 'p2'))));
    expect(inGrave(s, 'Test Goblin', 'p2')).toBe(true);
  });
  it('it lasts this turn only: on the next turn the damage is dealt', () => {
    let s = board();
    s = passBoth(castSpell(s, 'Test Shield'));
    s = advanceTo(s, 2, 'main1');
    s = passBoth(castSpell(s, 'Test Bolt', obj(find(s, 'Test Bear', 'battlefield', 'p1')), 'p2'));
    expect(inGrave(s, 'Test Bear', 'p1')).toBe(true);
  });
});

describe('CR 614.1a, 614.6: "If that permanent would die this turn, exile it instead." (a spell that deals damage to a black or green creature or planeswalker)', () => {
  it('the black creature that dies is exiled, not put into the graveyard', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Hex'] }, p2: { battlefield: ['Test Black Bear'] } });
    const bear = find(s, 'Test Black Bear', 'battlefield', 'p2');
    s = passBoth(castSpell(s, 'Test Hex', obj(bear)));
    expect(inExile(s, 'Test Black Bear')).toBe(true);
    expect(inGrave(s, 'Test Black Bear', 'p2')).toBe(false);
  });
  it('a green creature that survives is not exiled', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Hex'] }, p2: { battlefield: ['Test Big Bear'] } });
    s = passBoth(castSpell(s, 'Test Hex', obj(find(s, 'Test Big Bear', 'battlefield', 'p2'))));
    expect(onBf(s, 'Test Big Bear')).toBe(true);
  });
});



/** Resolve everything on the stack: triggers of one controller are ordered as offered, then both players pass until the stack is empty. */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60; i++) {
    const p = s.pending;
    if (!p) break;
    if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else if (p.kind === 'priority') break;
    else break;
  }
  return s;
}

describe('CR 603.2d, 603.10a: "If a triggered ability of a Ninja creature you control triggers, that ability triggers an additional time."', () => {
  const TWIN = card('Test Twin', 'Legendary Creature — Ninja Rat', 'If a triggered ability of a Ninja creature you control triggers, that ability triggers an additional time.\nWhen this creature dies, you gain 3 life.', { pt: ['1', '1'], colors: ['B'] });
  const NINJA = card('Test Ninja', 'Creature — Human Ninja', 'When this creature enters, you gain 1 life.\nWhen this creature dies, you gain 3 life.', { pt: ['1', '1'], colors: ['B'] });
  const ELFLIKE = card('Test Elfling', 'Creature — Elf', 'When this creature enters, you gain 1 life.\nWhen this creature dies, you gain 3 life.', { pt: ['1', '1'], colors: ['G'] });
  const defs = [...ALL, TWIN, NINJA, ELFLIKE];
  it('is compiled to data', () => expect(noManual(TWIN)).toEqual([]));
  it("an enters trigger of a Ninja of yours happens twice; an Elf's once", () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ninja', 'Test Elfling'], battlefield: ['Test Twin'] } });
    s = settle(castSpell(s, 'Test Ninja'));
    expect(life(s, 'p1')).toBe(22);
    s = settle(castSpell(s, 'Test Elfling'));
    expect(life(s, 'p1')).toBe(23);
  });
  it('a dies trigger of a Ninja looks back at the doubler, which is still there: twice', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bolt'], battlefield: ['Test Twin', 'Test Ninja'] } });
    s = settle(castSpell(s, 'Test Bolt', obj(find(s, 'Test Ninja', 'battlefield'))));
    expect(inGrave(s, 'Test Ninja', 'p1')).toBe(true);
    expect(life(s, 'p1')).toBe(26);
  });
  it('the doubler that dies itself: its own dies trigger is doubled (it was a Ninja you controlled as it died)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bolt'], battlefield: ['Test Twin'] } });
    s = settle(castSpell(s, 'Test Bolt', obj(find(s, 'Test Twin', 'battlefield'))));
    expect(inGrave(s, 'Test Twin', 'p1')).toBe(true);
    expect(life(s, 'p1')).toBe(26);
  });
  it('a Ninja that dies together with the doubler: both are counted (the doubler is looked back at too)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Twin', 'Test Ninja'] } });
    // both die at the same moment (state-based actions, CR 704.5g): lethal damage marked on each
    s = tweak(s, (t) => { t.objects[find(t, 'Test Twin', 'battlefield')]!.damage = 1; t.objects[find(t, 'Test Ninja', 'battlefield')]!.damage = 1; });
    s = settle(pass(s));
    expect(inGrave(s, 'Test Twin', 'p1')).toBe(true);
    expect(inGrave(s, 'Test Ninja', 'p1')).toBe(true);
    expect(life(s, 'p1')).toBe(32);
  });
  it("an opponent's Ninja is not one you control", () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Twin'] }, p2: { hand: ['Test Ninja'] } });
    s = advanceTo(s, 2, 'main1');
    s = settle(castSpell(s, 'Test Ninja', [], 'p2'));
    expect(life(s, 'p2')).toBe(21);
  });
});

describe('CR 603.2d: "If a triggered ability of a legendary creature you control triggers, that ability triggers an additional time."', () => {
  const ANNIE = card('Test Annie', 'Legendary Enchantment', 'If a triggered ability of a legendary creature you control triggers, that ability triggers an additional time.', { colors: ['R'] });
  const LEGEND = card('Test Legend', 'Legendary Creature — Human', 'When this creature enters, you gain 1 life.', { pt: ['1', '1'], colors: ['W'] });
  const COMMON = card('Test Commoner', 'Creature — Human', 'When this creature enters, you gain 1 life.', { pt: ['1', '1'], colors: ['W'] });
  it('a legendary creature of yours enters: twice; a nonlegendary one: once', () => {
    const defs = [...ALL, ANNIE, LEGEND, COMMON];
    expect(noManual(ANNIE)).toEqual([]);
    let s = scenario([], { defs, p1: { hand: ['Test Legend', 'Test Commoner'], battlefield: ['Test Annie'] } });
    s = settle(castSpell(s, 'Test Legend'));
    expect(life(s, 'p1')).toBe(22);
    s = settle(castSpell(s, 'Test Commoner'));
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 603.2d, 301.5: "If a triggered ability of equipped creature triggers, that ability triggers an additional time."', () => {
  const STAFF = card('Test Staff', 'Artifact — Equipment', 'If a triggered ability of equipped creature triggers, that ability triggers an additional time.\nEquip {0}', { colors: [] });
  const SCOUT = card('Test Scout', 'Creature — Human Scout', 'Whenever this creature attacks, you gain 1 life.\nWhen this creature dies, you gain 3 life.', { pt: ['1', '1'], colors: ['W'] });
  const defs = [...ALL, STAFF, SCOUT];
  const equipped = (): GameState => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Staff', 'Test Scout', 'Test Goblin'], hand: ['Test Bolt'] } });
    return tweak(s, (t) => { t.objects[find(t, 'Test Staff', 'battlefield')]!.attachedTo = find(t, 'Test Scout', 'battlefield'); });
  };
  it('is compiled to data', () => expect(noManual(STAFF)).toEqual([]));
  it('an attack trigger of the equipped creature happens twice', () => {
    let s = equipped();
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Scout', 'battlefield')]]);
    s = settle(s);
    expect(life(s, 'p1')).toBe(22);
  });
  it('the same trigger of a creature that is not equipped happens once', () => {
    let s = tweak(equipped(), (t) => { t.objects[find(t, 'Test Staff', 'battlefield')]!.attachedTo = find(t, 'Test Goblin', 'battlefield'); });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Scout', 'battlefield')]]);
    s = settle(s);
    expect(life(s, 'p1')).toBe(21);
  });
  it('a dies trigger of the equipped creature: twice (the equipment is looked back at, CR 603.10a)', () => {
    let s = equipped();
    s = settle(castSpell(s, 'Test Bolt', obj(find(s, 'Test Scout', 'battlefield'))));
    expect(inGrave(s, 'Test Scout', 'p1')).toBe(true);
    expect(life(s, 'p1')).toBe(26);
  });
});
