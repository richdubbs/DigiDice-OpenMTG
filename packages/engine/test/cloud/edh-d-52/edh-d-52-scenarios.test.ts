/**
 * Coordinator D, round edh-d-52 (lane d-rank-2, EDHREC ranks 12,001-13,500): the round's readings and engine changes played through the engine with synthetic cards (invented names
 * and wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites are from memory (no rules/cr in a cloud session) and listed as unverified in the round's record.
 *
 *   CR 701.8a, 700.4, 608.2h             "Destroy all creatures target player controls. For each creature that died this way, that player creates two ... tokens." (Mogg Infestation)
 *   CR 701.14a, 611.2a, 608.2c           "... gets +1/+1 until end of turn and fights target creature you don't control." (Ent's Fury)
 *   CR 701.14a, 608.2c                   "... fights ... The creature you control gets +2/+2 until end of turn before it fights if you control a creature with power 4 or greater." (Savage Punch)
 *   CR 109.5, 603.4                      "If that player is you, create a Treasure token." (The Ghoul, Gunslinger)
 *   CR 205.4a, 613.1d                    "Permanents with ice counters on them are snow." (Rimefeather Owl)
 *   CR 121.2, 608.2h                     "you may draw cards equal to its power. If you do, discard that many cards." (Horrid Shadowspinner)
 *   CR 122.1                             "Target player loses all rad counters." (Survivor's Med Kit)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; keywords?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: opts.cost ?? '{0}', colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const bf = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();

/** Answer every pending decision the way `answers` says (yes to a "may" unless 'no'; the first options of a choice) until priority returns with an empty stack. */
function settle(s0: GameState, opts: { may?: 'yes' | 'no'; pick?: (options: ObjectId[], min: number, max: number, s: GameState) => ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && !s.result && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending;
    if (p && p.kind !== 'priority') {
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: opts.may !== 'no' });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') {
        const ids = opts.pick ? opts.pick(p.options, p.min, p.max, s) : p.options.slice(0, Math.max(p.min, Math.min(p.max, p.options.length)));
        s = answer(s, { kind: 'chooseObjects', ids });
      } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj((p as unknown as { objects: ObjectId[] }).objects[0]!)] });
      else throw new Error(`unexpected decision ${p.kind}`);
    } else s = pass(s);
  }
  return s;
}
/** Cast a card of `player` and answer its decisions (targets by `pick`, payment automatic) until it is on the stack. */
function castWith(s0: GameState, name: string, player: 'p1' | 'p2', pick: (offered: ObjectId[]) => TargetChoice[] = () => []): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick(s.pending.objects) });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

/** Cast a card and answer its target decisions in order with `picks` (one list of choices for each target group). */
function castTargets(s0: GameState, name: string, player: 'p1' | 'p2', picks: TargetChoice[][]): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  let k = 0;
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: picks[k++] ?? [] });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const player = (id: 'p1' | 'p2'): TargetChoice => ({ kind: 'player', id });
const tokens = (s: GameState, p: 'p1' | 'p2', n: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token' && s.objects[id]!.defId.includes(n)).length;

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', { pt: ['0', '2'] });
const MOGG = card('Test Infestation', 'Sorcery', 'Destroy all creatures target player controls. For each creature that died this way, that player creates two 1/1 red Goblin creature tokens.');
const FURY = card('Test Fury', 'Sorcery', 'Put a +1/+1 counter on target creature you control if its power is 4 or greater. Then that creature gets +1/+1 until end of turn and fights target creature you don\'t control.');
const PUNCH = card('Test Punch', 'Sorcery', 'Target creature you control fights target creature you don\'t control.\nFerocious — The creature you control gets +2/+2 until end of turn before it fights if you control a creature with power 4 or greater.');
const KIT = card('Test Kit', 'Sorcery', 'Target player loses all rad counters.');
const RADS = card('Test Rads', 'Sorcery', 'Target player gets two rad counters.');
const COMMON = [BEAR, OGRE, WALL];

describe('the synthetic cards are automated', () => {
  it('every card of this file compiles to full automation', () => {
    for (const d of [MOGG, FURY, PUNCH, KIT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.8a, 700.4, 608.2h: "For each creature that died this way, that player creates two tokens" (Mogg Infestation)', () => {
  const start = () => scenario([], {
    p1: { hand: ['Test Infestation'], battlefield: ['Test Bear'] },
    p2: { battlefield: ['Test Bear', 'Test Ogre', 'Test Wall'] },
    defs: [...COMMON, MOGG],
  });
  it('every creature the target player controls dies; they get two Goblins for each one that died, an indestructible creature that did not die is not counted, and the caster\'s creatures stay', () => {
    const s = settle(castTargets(start(), 'Test Infestation', 'p1', [[player('p2')]]));
    expect(bf(s, 'p2').filter((n) => n.startsWith('Test'))).toEqual(['Test Wall']);
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Test Bear', 'Test Ogre']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.kind === 'token')).toHaveLength(4);
    expect(bf(s, 'p1')).toEqual(['Test Bear']);
  });
  it('negative: aimed at the caster the caster gets the tokens; a player with no creatures gets none', () => {
    const s = settle(castTargets(start(), 'Test Infestation', 'p1', [[player('p1')]]));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token')).toHaveLength(2);
    const s0 = scenario([], { p1: { hand: ['Test Infestation'] }, p2: { battlefield: ['Test Wall'] }, defs: [...COMMON, MOGG] });
    const t = settle(castTargets(s0, 'Test Infestation', 'p1', [[player('p2')]]));
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token')).toHaveLength(0);
  });
});

describe('CR 701.14a, 611.2a, 608.2c: "gets +1/+1 until end of turn and fights target creature you don\'t control" (Ent\'s Fury)', () => {
  const start = (mine: string) => scenario([], {
    p1: { hand: ['Test Fury'], battlefield: [mine] },
    p2: { battlefield: ['Test Bear'] },
    defs: [...COMMON, FURY],
  });
  it('a creature of power four or more gets the counter, then +1/+1 and fights: the 4/4 becomes 6/6 for the turn and the bear dies', () => {
    const s0 = start('Test Ogre');
    const s = settle(castTargets(s0, 'Test Fury', 'p1', [[obj(find(s0, 'Test Ogre', 'battlefield', 'p1'))], [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]]));
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    expect(s.objects[ogre]!.counters['+1/+1']).toBe(1);
    expect(Number(getChars(s, ogre).power)).toBe(6);
    expect(s.objects[ogre]!.damage).toBe(2);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
  });
  it('negative: a creature of power three or less gets no counter (but still the +1/+1 and the fight)', () => {
    const s0 = start('Test Bear');
    const s = settle(castTargets(s0, 'Test Fury', 'p1', [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))], [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]]));
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(s.objects[mine]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(Number(getChars(s, mine).power)).toBe(3);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
  });
});

describe('CR 701.14a, 608.2c: "gets +2/+2 until end of turn before it fights if you control a creature with power 4 or greater" (Savage Punch)', () => {
  it('with a creature of power four or more the creature gets +2/+2 before the fight: the 2/2 deals 4 damage, enough to kill the 4/4 it fights (without the pump it would deal 2)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Punch'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] }, defs: [...COMMON, PUNCH] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = settle(castTargets(s0, 'Test Punch', 'p1', [[obj(bear)], [obj(find(s0, 'Test Ogre', 'battlefield', 'p2'))]]));
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear'); // a 4/4 after the pump, it takes 4 damage back and dies as well
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ogre']);
  });
  it('negative: without a creature of power four or more there is no pump and the weaker creature dies', () => {
    const s0 = scenario([], { p1: { hand: ['Test Punch'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [...COMMON, PUNCH] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = settle(castTargets(s0, 'Test Punch', 'p1', [[obj(bear)], [obj(find(s0, 'Test Ogre', 'battlefield', 'p2'))]]));
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
  });
});

describe('CR 122.1: "Target player loses all rad counters" (Survivor\'s Med Kit)', () => {
  it('removes every rad counter of the target player and no one else\'s', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rads', 'Test Rads', 'Test Kit'] }, p2: { }, defs: [...COMMON, KIT, RADS] });
    let s = settle(castTargets(s0, 'Test Rads', 'p1', [[player('p2')]]));
    s = settle(castTargets(s, 'Test Rads', 'p1', [[player('p1')]]));
    expect(s.players.find((x) => x.id === 'p2')!.counters['rad']).toBe(2);
    s = settle(castTargets(s, 'Test Kit', 'p1', [[player('p2')]]));
    expect(s.players.find((x) => x.id === 'p2')!.counters['rad'] ?? 0).toBe(0);
  });
});

/** `settle` where a target choice names a player (the first one offered, or `pick`). */
function settleTo(s0: GameState, pick: 'p1' | 'p2'): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && !s.result && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending;
    if (p && p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [player(pick)] });
    else if (p && p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p && p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else s = pass(s);
  }
  return s;
}

describe('CR 109.5, 603.4: "If that player is you, create a Treasure token" (The Ghoul, Gunslinger)', () => {
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', 'Whenever ~ dies, target player gets two rad counters. If that player is you, create a Treasure token.', { pt: ['1', '1'] });
  const BOLT = card('Test Bolt', 'Sorcery', '~ deals 3 damage to any target.');
  const start = () => scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Ghoul'] }, p2: {}, defs: [...COMMON, GHOUL, BOLT] });
  const kill = (s0: GameState, who: 'p1' | 'p2'): GameState => settleTo(castTargets(s0, 'Test Bolt', 'p1', [[obj(find(s0, 'Test Ghoul', 'battlefield', 'p1'))]]), who);
  it('aimed at its controller: two rad counters and a Treasure token', () => {
    const s = kill(start(), 'p1');
    expect(s.players.find((x) => x.id === 'p1')!.counters['rad']).toBe(2);
    expect(tokens(s, 'p1', 'Treasure')).toBe(1);
  });
  it('negative: aimed at an opponent: the rad counters go to them and nobody gets a Treasure', () => {
    const s = kill(start(), 'p2');
    expect(s.players.find((x) => x.id === 'p2')!.counters['rad']).toBe(2);
    expect(s.players.find((x) => x.id === 'p1')!.counters['rad'] ?? 0).toBe(0);
    expect(tokens(s, 'p1', 'Treasure') + tokens(s, 'p2', 'Treasure')).toBe(0);
  });
});

describe('CR 121.2, 608.2h: "you may draw cards equal to its power. If you do, discard that many cards" (Horrid Shadowspinner)', () => {
  const SPINNER = card('Test Spinner', 'Creature — Horror', 'Whenever ~ attacks, you may draw cards equal to its power. If you do, discard that many cards.', { pt: ['3', '3'] });
  it('attacking with a 3/3: three cards are drawn and three are discarded; declining draws nothing', () => {
    const base = scenario([], { p1: { battlefield: ['Test Spinner'] }, p2: {}, defs: [...COMMON, SPINNER] });
    const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
    const attack = (s0: GameState, may: 'yes' | 'no'): GameState => {
      let s = s0;
      for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Spinner', 'battlefield', 'p1'), defender: 'p2' }] });
      return settle(s, { may, pick: (options, min, max) => options.slice(0, Math.max(min, Math.min(max, options.length))) });
    };
    const s = attack(base, 'yes');
    expect(handSize(s)).toBe(0);
    expect(zoneNames(s, 'graveyard', 'p1')).toHaveLength(3);
    const n = attack(base, 'no');
    expect(handSize(n)).toBe(0);
    expect(zoneNames(n, 'graveyard', 'p1')).toHaveLength(0);
  });
});

describe('CR 121.2, 608.2h, 614.1a: the discard repeats the number chosen for the draw, even when a replacement changes the cards drawn (Horrid Shadowspinner ruling)', () => {
  const SPINNER = card('Test Spinner', 'Creature — Horror', 'Whenever ~ attacks, you may draw cards equal to its power. If you do, discard that many cards.', { pt: ['3', '3'] });
  const DOUBLER = card('Test Doubler', 'Enchantment', 'If you would draw a card, draw two cards instead.');
  it('with a draw doubler, 3 power draws 6 cards and still discards 3', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spinner', 'Test Doubler'] }, p2: {}, defs: [...COMMON, SPINNER, DOUBLER] });
    for (let g = 0; g < 40 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Spinner', 'battlefield', 'p1'), defender: 'p2' }] });
    s = settle(s, { pick: (options, min, max) => options.slice(0, Math.max(min, Math.min(max, options.length))) });
    expect(zoneNames(s, 'graveyard', 'p1')).toHaveLength(3);
    expect(s.zones.hand['p1']).toHaveLength(3);
  });
});

describe('CR 205.4a, 613.1d: "Permanents with ice counters on them are snow" (Rimefeather Owl)', () => {
  const OWL = card('Test Owl', 'Snow Creature — Bird', 'Flying\nTest Owl\'s power and toughness are each equal to the number of snow permanents on the battlefield.\nPermanents with ice counters on them are snow.', { pt: ['0', '0'] });
  it('a permanent with an ice counter is snow and counts for the owl\'s size, whoever controls it; one without a counter does not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Owl', 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Ogre', counters: { ice: 1 } }, 'Test Bear'] }, defs: [...COMMON, OWL] });
    const owl = find(s, 'Test Owl', 'battlefield', 'p1');
    expect(Number(getChars(s, owl).power)).toBe(2); // the owl itself (a Snow creature) and the Ogre with an ice counter
    const t = scenario([], { p1: { battlefield: ['Test Owl', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] }, defs: [...COMMON, OWL] });
    expect(Number(getChars(t, find(t, 'Test Owl', 'battlefield', 'p1')).power)).toBe(1);
  });
});
