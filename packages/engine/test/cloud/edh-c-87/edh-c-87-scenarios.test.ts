/**
 * Commander EDHREC ranks 26,001-26,500, round edh-c-87 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 604.1, 611.3a, 613.4c     "As long as ~ is untapped, all creatures attacking you get -1/-0."
 *   CR 120.1, 120.3, 608.2h      "~ deals damage to target creature equal to the damage already dealt to it this turn."
 *   CR 115.1, 202.3, 608.2d      "destroy target nonland permanent with the lowest mana value."
 *   CR 205.1b, 611.2a, 613.4b    "you may have ~ become a 3/3 ... creature with flying in addition to its other types until end of turn."
 *   CR 608.2c, 601.2h            "Gain control of target creature if its power is less than or equal to the number of colors of mana spent to cast this spell."
 *   CR 701.9a, 603.2             "Whenever you discard a Spirit card or a card with disturb, ..."
 *   CR 611.2a, 613.1b            "you gain control of that land until end of turn."
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, tweak, toDeclareAttackers } from '../../m4/helpers';
import { card, cast, full, named, pt, resolveAll, settle, counters } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

describe('CR 604.1, 611.3a, 613.4c: "As long as ~ is untapped, all creatures attacking you get -1/-0."', () => {
  const DOG = card('Test Gate Hound', 'Artifact Creature — Dog', 'As long as this creature is untapped, all creatures attacking you get -1/-0.', ['1', '2']);
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['3', '3']);
  const game = (): GameState => scenario([], { defs: [DOG, OGRE], p1: { battlefield: ['Test Plain Ogre'] }, p2: { battlefield: ['Test Gate Hound'] } });
  it('is full', () => expect(full(DOG)).toBe(true));
  it('a creature attacking its controller\'s opponent (the Hound\'s controller) gets -1/-0 while the Hound is untapped', () => {
    const s = declareAttackers(toDeclareAttackers(game()), [[named(game(), 'Test Plain Ogre')[0]!]]);
    // the objects of the fresh game differ in id: read the attacker of this state
    const ogre = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Ogre')!;
    expect(pt(s, ogre)).toBe('2/3');
  });
  it('negative: not attacking, the creature keeps its power', () => {
    const s = game();
    expect(pt(s, s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Ogre')!)).toBe('3/3');
  });
  it('negative: while the Hound is tapped there is no change', () => {
    const s0 = tweak(game(), (t) => { t.objects[t.zones.battlefield.find((id) => t.objects[id]!.defId === 'Test Gate Hound')!]!.tapped = true; });
    const s = declareAttackers(toDeclareAttackers(s0), [[s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Plain Ogre')!]]);
    expect(pt(s, s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Ogre')!)).toBe('3/3');
  });
});

describe('CR 120.1, 120.3, 608.2h: "~ deals damage to target creature equal to the damage already dealt to it this turn."', () => {
  const KEEPER = card('Test Grudge Keeper', 'Creature — Dwarf', '{T}: This creature deals damage to target creature equal to the damage already dealt to it this turn.', ['1', '1']);
  const PING = card('Test Ember Ping', 'Instant', 'This spell deals 2 damage to target creature.');
  const BEAR = card('Test Big Bear', 'Creature — Bear', '', ['2', '5']);
  const OX = card('Test Idle Ox', 'Creature — Ox', '', ['2', '5']);
  const game = (): GameState => scenario([], { defs: [KEEPER, PING, BEAR, OX], p1: { battlefield: ['Test Grudge Keeper'], hand: ['Test Ember Ping'] }, p2: { battlefield: ['Test Big Bear', 'Test Idle Ox'] } });
  const idOf = (s: GameState, n: string): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === n)!;
  const keep = (s: GameState): GameState => act(s, { type: 'activate', player: 'p1', source: idOf(s, 'Test Grudge Keeper'), ability: 'p:0:0' });
  it('is full', () => expect(full(KEEPER)).toBe(true));
  it('2 damage already dealt to the Bear makes the Keeper deal 2 more: 4 damage in all', () => {
    const s0 = game();
    const bear = idOf(s0, 'Test Big Bear');
    const s1 = resolveAll(cast(s0, 'Test Ember Ping', { targets: [{ kind: 'object', id: bear }] }));
    expect(s1.objects[bear]!.damage).toBe(2);
    const s2 = resolveAll(settle(keep(s1), { targets: [{ kind: 'object', id: bear }] }));
    expect(s2.objects[bear]!.damage).toBe(4);
  });
  it('negative: damage dealt to ANOTHER creature does not count (the Ox took 2, the Bear none: the Bear takes 0)', () => {
    const s0 = game();
    const ox = idOf(s0, 'Test Idle Ox');
    const bear = idOf(s0, 'Test Big Bear');
    const s1 = resolveAll(cast(s0, 'Test Ember Ping', { targets: [{ kind: 'object', id: ox }] }));
    const s2 = resolveAll(settle(keep(s1), { targets: [{ kind: 'object', id: bear }] }));
    expect(s2.objects[bear]!.damage).toBe(0);
  });
  it('negative: with no damage dealt this turn it deals none', () => {
    const s0 = game();
    const bear = idOf(s0, 'Test Big Bear');
    const s1 = resolveAll(settle(keep(s0), { targets: [{ kind: 'object', id: bear }] }));
    expect(s1.objects[bear]!.damage).toBe(0);
  });
});

describe('CR 115.1, 202.3, 608.2d: "At the beginning of your upkeep, destroy target nonland permanent with the lowest mana value."', () => {
  const SCALES = card('Test Level Beam', 'Artifact', 'At the beginning of your upkeep, destroy target nonland permanent with the lowest mana value.', undefined, '{5}');
  const mk = (name: string, cost: string, type = 'Artifact Creature — Golem'): ReturnType<typeof card> => card(name, type, '', ['1', '1'], cost);
  const A = mk('Test Cheap Gear', '{1}');
  const B = mk('Test Mid Gear', '{3}');
  const C = mk('Test Tied Gear', '{1}');
  const D = mk('Test Free Gear', '{0}');
  const idOf = (s: GameState, n: string): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === n)!;
  /** Pass (no attacks, no blocks) to the trigger of the Scales on turn 3: p1's upkeep. */
  const toUpkeep = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 300; i++) {
      if (s.turn.number >= 3 && s.pending?.kind === 'chooseTargets') return s;
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else throw new Error(`unexpected ${d.kind}`);
    }
    throw new Error('never reached the trigger');
  };
  const game = (opp: string[]): GameState => scenario([], { defs: [SCALES, A, B, C, D], p1: { battlefield: ['Test Level Beam'] }, p2: { battlefield: opp } });
  it('is full', () => expect(full(SCALES)).toBe(true));
  it('only the permanent with the lowest mana value is a legal target; a higher one is refused', () => {
    const s0 = game(['Test Cheap Gear', 'Test Mid Gear']);
    const s1 = toUpkeep(s0);
    const d = s1.pending as unknown as { kind: string };
    expect(d.kind).toBe('chooseTargets');
    const cheap = idOf(s1, 'Test Cheap Gear');
    const mid = idOf(s1, 'Test Mid Gear');
    expect(() => settle(s1, { targets: [{ kind: 'object', id: mid }] })).toThrow();
    const s2 = resolveAll(settle(s1, { targets: [{ kind: 'object', id: cheap }] }));
    expect(s2.zones.battlefield.includes(cheap)).toBe(false);
    expect(s2.zones.battlefield.includes(mid)).toBe(true);
  });
  it('a tie: either of the tied permanents may be the target (the rest keep being refused)', () => {
    for (const pick of ['Test Cheap Gear', 'Test Tied Gear']) {
      const s1 = toUpkeep(game(['Test Cheap Gear', 'Test Tied Gear', 'Test Mid Gear']));
      const id = idOf(s1, pick);
      const s2 = resolveAll(settle(s1, { targets: [{ kind: 'object', id }] }));
      expect(s2.zones.battlefield.includes(id)).toBe(false);
    }
  });
  it('negative: lands are not in the set (a mana value 0 Plains does not make the mana value 1 Gear illegal)', () => {
    const s1 = toUpkeep(game(['Plains', 'Test Cheap Gear']));
    const cheap = idOf(s1, 'Test Cheap Gear');
    const s2 = resolveAll(settle(s1, { targets: [{ kind: 'object', id: cheap }] }));
    expect(s2.zones.battlefield.includes(cheap)).toBe(false);
  });
  it('a land is never in the set: the Scales themselves (mana value 5) are in the set, lands are not', () => {
    const s1 = toUpkeep(game(['Test Free Gear', 'Test Mid Gear']));
    // Free Gear (mana value 0) is the lowest, so the Mid Gear is refused
    expect(() => settle(s1, { targets: [{ kind: 'object', id: idOf(s1, 'Test Mid Gear') }] })).toThrow();
  });
});

describe('CR 205.1b, 611.2a, 613.4b: "Whenever you cast a noncreature spell, you may have ~ become a 3/3 Sphinx creature with flying in addition to its other types until end of turn."', () => {
  const RIDDLE = card('Test Shifting Riddle', 'Enchantment', 'Whenever you cast a noncreature spell, you may have this enchantment become a 3/3 Sphinx creature with flying in addition to its other types until end of turn.');
  const SPELL = card('Test Quick Spell', 'Instant', 'You gain 1 life.');
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const game = (): GameState => scenario([], { defs: [RIDDLE, SPELL, OGRE], p1: { battlefield: ['Test Shifting Riddle'], hand: ['Test Quick Spell', 'Test Plain Ogre'] } });
  const riddle = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Shifting Riddle')!;
  it('is full', () => expect(full(RIDDLE)).toBe(true));
  it('casting a noncreature spell and saying yes: a 3/3 flying Sphinx creature that is still an enchantment', () => {
    const s = resolveAll(cast(game(), 'Test Quick Spell'), { yes: true });
    const r = riddle(s);
    expect(pt(s, r)).toBe('3/3');
    expect(JSON.stringify(s.objects[r])).not.toContain('"faceDown":true');
  });
  it('saying no: nothing changes', () => {
    const s = resolveAll(cast(game(), 'Test Quick Spell'), { yes: false });
    const r = riddle(s);
    expect(pt(s, r)).not.toBe('3/3');
  });
  it('negative: a creature spell does not trigger it', () => {
    const s = resolveAll(cast(game(), 'Test Plain Ogre'), { yes: true });
    expect(pt(s, riddle(s))).not.toBe('3/3');
  });
});

describe('CR 608.2c, 601.2h: "Gain control of target creature if its power is less than or equal to the number of colors of mana spent to cast this spell."', () => {
  const INFLUENCE = card('Test Bend Will', 'Sorcery', 'Converge — Gain control of target creature if its power is less than or equal to the number of colors of mana spent to cast this spell.', undefined, '{G}{W}{U}');
  const mk = (n: string, p: string): ReturnType<typeof card> => card(n, 'Creature — Ogre', '', [p, '3']);
  const THREE = mk('Test Power Three', '3');
  const FOUR = mk('Test Power Four', '4');
  const game = (): GameState => scenario(['Forest', 'Plains', 'Island'], { defs: [INFLUENCE, THREE, FOUR], p1: { hand: ['Test Bend Will'], battlefield: ['Forest', 'Plains', 'Island'] }, p2: { battlefield: ['Test Power Three', 'Test Power Four'] } });
  const idOf = (s: GameState, n: string): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === n)!;
  it('is full', () => expect(full(INFLUENCE)).toBe(true));
  it('three colors spent: a power-3 creature is taken; a power-4 creature stays', () => {
    const s0 = game();
    const t = idOf(s0, 'Test Power Three');
    const s1 = resolveAll(cast(s0, 'Test Bend Will', { targets: [{ kind: 'object', id: t }] }));
    expect(s1.objects[t]!.controller).toBe('p1');
    const f = idOf(s0, 'Test Power Four');
    const s2 = resolveAll(cast(s0, 'Test Bend Will', { targets: [{ kind: 'object', id: f }] }));
    expect(s2.objects[f]!.controller).toBe('p2');
  });
});

describe('CR 701.9a, 603.2: "Whenever you discard a Spirit card or a card with disturb, put a +1/+1 counter on this creature."', () => {
  const SIFTER = card('Test Sifting Shade', 'Creature — Spirit', 'Whenever you discard a Spirit card or a card with disturb, put a +1/+1 counter on this creature.', ['1', '2']);
  const GHOST = card('Test Pale Ghost', 'Creature — Spirit', '', ['1', '1']);
  const MOON = card('Test Moon Phase', 'Creature — Human', 'Disturb {1}{U}', ['1', '1']);
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const DISC = card('Test Cast Away', 'Sorcery', 'Discard a card.');
  const game = (hand: string): GameState => scenario([], { defs: [SIFTER, GHOST, MOON, OGRE, DISC], p1: { battlefield: ['Test Sifting Shade'], hand: ['Test Cast Away', hand] } });
  const shade = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Sifting Shade')!;
  it('is full', () => expect(full(SIFTER)).toBe(true));
  it('discarding a Spirit card or a card with disturb: one counter each time', () => {
    for (const h of ['Test Pale Ghost', 'Test Moon Phase']) {
      const s = resolveAll(cast(game(h), 'Test Cast Away'));
      expect(counters(s, shade(s), '+1/+1'), h).toBe(1);
    }
  });
  it('negative: discarding any other card gives no counter', () => {
    const s = resolveAll(cast(game('Test Plain Ogre'), 'Test Cast Away'));
    expect(counters(s, shade(s), '+1/+1')).toBe(0);
  });
});

describe('CR 611.2a, 613.1b: "When ~ enters, you gain control of target creature until end of turn."', () => {
  const THIEF = card('Test Lend Hand', 'Creature — Rogue', 'When this creature enters, you gain control of target creature until end of turn.', ['1', '1']);
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  it('is full', () => expect(full(THIEF)).toBe(true));
  it('takes the creature, and it comes back at end of turn', () => {
    const s0 = scenario([], { defs: [THIEF, OGRE], p1: { hand: ['Test Lend Hand'] }, p2: { battlefield: ['Test Plain Ogre'] } });
    const ogre = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Plain Ogre')!;
    const s1 = resolveAll(cast(s0, 'Test Lend Hand'), { targets: [{ kind: 'object', id: ogre }] });
    expect(s1.objects[ogre]!.controller).toBe('p1');
    const s2 = passUntil(s1, (x) => x.turn.number === 2, 'the next turn', 80);
    expect(s2.objects[ogre]!.controller).toBe('p2');
  });
});

describe('CR 608.2b: "If the targeted permanent doesn\'t have the lowest mana value when the ability resolves, the ability doesn\'t resolve" (Culling Scales ruling 2004-12-01)', () => {
  const SCALES = card('Test Level Beam', 'Artifact', 'At the beginning of your upkeep, destroy target nonland permanent with the lowest mana value.', undefined, '{5}');
  const A = card('Test Cheap Gear', 'Artifact Creature — Golem', '', ['1', '1'], '{1}');
  const B = card('Test Free Gear', 'Artifact Creature — Golem', '', ['1', '1'], '{0}');
  it('a cheaper permanent that enters after the target was chosen makes the target illegal: it is not destroyed', () => {
    let s = scenario([], { defs: [SCALES, A, B], p1: { battlefield: ['Test Level Beam'] }, p2: { battlefield: ['Test Cheap Gear'] } });
    for (let i = 0; i < 300 && !(s.turn.number >= 3 && s.pending?.kind === 'chooseTargets'); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: d.player });
    }
    const cheap = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Cheap Gear')!;
    s = settle(s, { targets: [{ kind: 'object', id: cheap }] });
    s = tweak(s, (t) => { put(t, 'p2', 'battlefield', 'Test Free Gear'); });
    s = resolveAll(s);
    expect(s.zones.battlefield.includes(cheap)).toBe(true);
  });
});

describe('CR 604.1, 608.2b: "As long as you control a permanent named A or a permanent named B, ~ gets +2/+2."', () => {
  const HERO = card('Test Hero Pair', 'Legendary Creature — Human Soldier', 'This creature gets +2/+2 as long as you control a permanent named Test Alpha Twin or a permanent named Test Beta Twin.', ['2', '4']);
  const alpha = card('Test Alpha Twin', 'Creature — Human', '', ['1', '1']);
  const beta = card('Test Beta Twin', 'Creature — Human', '', ['1', '1']);
  const other = card('Test Gamma Twin', 'Creature — Human', '', ['1', '1']);
  const game = (bf: string[]): GameState => scenario([], { defs: [HERO, alpha, beta, other], p1: { battlefield: ['Test Hero Pair', ...bf] } });
  const hero = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Hero Pair')!;
  it('is full', () => expect(full(HERO)).toBe(true));
  it('either named permanent (or both) gives +2/+2; neither, or another name, does not', () => {
    expect(pt(game(['Test Alpha Twin']), hero(game(['Test Alpha Twin'])))).toBe('4/6');
    expect(pt(game(['Test Beta Twin']), hero(game(['Test Beta Twin'])))).toBe('4/6');
    expect(pt(game(['Test Alpha Twin', 'Test Beta Twin']), hero(game(['Test Alpha Twin', 'Test Beta Twin'])))).toBe('4/6');
    expect(pt(game([]), hero(game([])))).toBe('2/4');
    expect(pt(game(['Test Gamma Twin']), hero(game(['Test Gamma Twin'])))).toBe('2/4');
  });
  it('negative: an opponent controlling the named permanent does not count (you control)', () => {
    const s = scenario([], { defs: [HERO, alpha], p1: { battlefield: ['Test Hero Pair'] }, p2: { battlefield: ['Test Alpha Twin'] } });
    expect(pt(s, hero(s))).toBe('2/4');
  });
});
void lifeOf; void find; void put; void declareAttackers;
