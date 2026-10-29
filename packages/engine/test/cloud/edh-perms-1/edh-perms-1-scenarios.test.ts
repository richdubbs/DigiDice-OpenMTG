/**
 * Commander lane edh-perms, round edh-perms-1: the round's parser readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.1a, 614.5, 111.10       "If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token."
 *   CR 614.1a, 614.5, 111.1        "If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead."
 *   CR 614.1a, 616.1g              "If one or more tokens would be created, twice that many of those tokens are created instead." (any player)
 *   CR 614.1a, 614.6               "If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens ... are created instead."
 *   CR 111.1, 608.2h               "You create a number of Treasure tokens equal to ..." / "Each opponent creates a number of ..."
 *   CR 106.12, 603.2, 605.1b       "Whenever you tap ~ for mana, ..." / "Whenever you tap a permanent for {C}, add an additional {C}." (a triggered mana ability)
 *   CR 603.8                       "When ~ has no ice counters on it, sacrifice it. If you do, create ..." (a state trigger of the object itself)
 *   CR 614.1c, 614.12, 707.5       "You may have ~ enter tapped as a copy of any land on the battlefield."
 *   CR 613.1d, 613.1f, 509.1b      "Equipped creature has ward {2}, is an Assassin in addition to its other types, and can't be blocked."
 *   CR 109.2                       "... target creature you control other than ~" (the source is never a legal target)
 *   CR 107.3, 608.2h, 613.4b       "Target land you control becomes an X/X Elemental creature with trample and haste until end of turn, where X is ..." (X read once)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';
const poolOf = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).sort().join('');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** The objects (tokens included) named `name` on the battlefield, controlled by `controller`. */
const objs = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name.replace(/ Token$/, '') === name);
const count = (s: GameState, name: string, controller: 'p1' | 'p2'): number => objs(s, name, controller).length;

interface Picks { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: TargetChoice[][]; color?: string }
/** Answer every decision until a player has priority: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options!, s) : p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (o.color ?? 'G') as never });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
/** Cast the card `name` from p1's hand with {C} in the pool for its {1} and resolve everything. */
function castAndResolve(s0: GameState, name: string, o: Picks = {}): GameState {
  s0.players[0]!.manaPool.push({ type: 'C' } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const opp: TargetChoice = { kind: 'player', id: 'p2' };

describe('CR 614.1a, 614.5, 111.10: "If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token."', () => {
  const XORN = card('Test Ore Spirit', 'Creature — Elemental', 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.', { pt: ['3', '2'], cost: '{2}{R}', colors: ['R'] });
  const GOLD = card('Test Gold Rush', 'Sorcery', 'Create a Treasure token.', { cost: '{1}' });
  const GOLDS = card('Test Gold Flood', 'Sorcery', 'Create three Treasure tokens.', { cost: '{1}' });
  const FEAST = card('Test Small Feast', 'Sorcery', 'Create a Food token.', { cost: '{1}' });
  const defs = [XORN, GOLD, GOLDS, FEAST];
  it('is automated; one Treasure becomes two (the added token is not replaced again), three become four', () => {
    expect(automated(XORN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Ore Spirit'], hand: ['Test Gold Rush'] }, defs });
    expect(count(castAndResolve(s0, 'Test Gold Rush'), 'Treasure', 'p1')).toBe(2);
    const s1 = scenario([], { p1: { battlefield: ['Test Ore Spirit'], hand: ['Test Gold Flood'] }, defs });
    expect(count(castAndResolve(s1, 'Test Gold Flood'), 'Treasure', 'p1')).toBe(4);
  });
  it('without it nothing is added; another token kind (Food) is not changed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gold Rush'] }, defs });
    expect(count(castAndResolve(s0, 'Test Gold Rush'), 'Treasure', 'p1')).toBe(1);
    const s1 = scenario([], { p1: { battlefield: ['Test Ore Spirit'], hand: ['Test Small Feast'] }, defs });
    const r = castAndResolve(s1, 'Test Small Feast');
    expect(count(r, 'Food', 'p1')).toBe(1);
    expect(count(r, 'Treasure', 'p1')).toBe(0);
  });
  it('only the tokens you would create: a Treasure an opponent creates is not changed', () => {
    const GIFT = card('Test Gold Gift', 'Sorcery', 'Target opponent creates a Treasure token.', { cost: '{1}' });
    const s0 = scenario([], { p1: { battlefield: ['Test Ore Spirit'], hand: ['Test Gold Gift'] }, defs: [...defs, GIFT] });
    expect(count(castAndResolve(s0, 'Test Gold Gift', { targets: [[opp]] }), 'Treasure', 'p2')).toBe(1);
  });
});

describe('CR 614.1a, 614.5, 111.1: "If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead."', () => {
  const FANG = card('Test Nut Chief', 'Legendary Creature — Squirrel', 'If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.', { pt: ['3', '3'], cost: '{2}{G}', colors: ['G'] });
  const GOLDS = card('Test Gold Pair', 'Sorcery', 'Create two Treasure tokens.', { cost: '{1}' });
  const ONE = card('Test Gold Rush', 'Sorcery', 'Create a Treasure token.', { cost: '{1}' });
  const defs = [FANG, GOLDS, ONE];
  it('is automated; two Treasures bring two Squirrels, one brings one (as many as the event\'s number)', () => {
    expect(automated(FANG)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Nut Chief'], hand: ['Test Gold Pair'] }, defs });
    const r = castAndResolve(s0, 'Test Gold Pair');
    expect(count(r, 'Treasure', 'p1')).toBe(2);
    expect(count(r, 'Squirrel', 'p1')).toBe(2);
    const s1 = scenario([], { p1: { battlefield: ['Test Nut Chief'], hand: ['Test Gold Rush'] }, defs });
    const r1 = castAndResolve(s1, 'Test Gold Rush');
    expect(count(r1, 'Treasure', 'p1')).toBe(1);
    expect(count(r1, 'Squirrel', 'p1')).toBe(1);
  });
  it('the Squirrels are not replaced again by the same effect (no chain), and without it no Squirrel appears', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Nut Chief'], hand: ['Test Gold Pair'] }, defs });
    expect(count(castAndResolve(s0, 'Test Gold Pair'), 'Squirrel', 'p1')).toBe(2); // not 4, not 6
    const s1 = scenario([], { p1: { hand: ['Test Gold Pair'] }, defs });
    expect(count(castAndResolve(s1, 'Test Gold Pair'), 'Squirrel', 'p1')).toBe(0);
  });
});

describe('CR 616.1, 614.5: two "plus" effects on one event (Xorn, then Chatterfang)', () => {
  const XORN = card('Test Ore Spirit', 'Creature — Elemental', 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.', { pt: ['3', '2'] });
  const FANG = card('Test Nut Chief', 'Legendary Creature — Squirrel', 'If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.', { pt: ['3', '3'] });
  const ONE = card('Test Gold Rush', 'Sorcery', 'Create a Treasure token.', { cost: '{1}' });
  const DOUBLER = card('Test Wild Growth', 'Enchantment', 'If one or more tokens would be created, twice that many of those tokens are created instead.');
  const run = (first: string, order: string[] = [first], extra: string[] = []): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ore Spirit', 'Test Nut Chief', ...extra], hand: ['Test Gold Rush'] }, defs: [XORN, FANG, ONE, DOUBLER] });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gold Rush', 'hand', 'p1') });
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending as unknown as { kind: string; options?: { id: string; label: string }[] };
      if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: (d.options!.find((o) => o.label.includes(order.shift() ?? first)) ?? d.options![0]!).id });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d.kind}`);
    }
    return s;
  };
  it('the Squirrels are as many as the tokens the event holds when Chatterfang applies: Xorn first two Treasures and two Squirrels, Chatterfang first one Squirrel (CR 616.1)', () => {
    const a = run('Ore Spirit');
    expect([count(a, 'Treasure', 'p1'), count(a, 'Squirrel', 'p1')]).toEqual([2, 2]);
    const c = run('Ore Spirit', ['Ore Spirit', 'Wild Growth', 'Nut Chief'], ['Test Wild Growth']); // Xorn, then the doubler, then Chatterfang: 4 Treasures, 4 Squirrels
    expect([count(c, 'Treasure', 'p1'), count(c, 'Squirrel', 'p1')]).toEqual([4, 4]);
    const b = run('Nut Chief');
    expect([count(b, 'Treasure', 'p1'), count(b, 'Squirrel', 'p1')]).toEqual([2, 1]);
  });
});

describe('CR 614.1a, 616.1g: "If one or more tokens would be created, twice that many of those tokens are created instead." (any player)', () => {
  const VIGOR = card('Test Wild Growth', 'Enchantment', 'If one or more tokens would be created, twice that many of those tokens are created instead.', { cost: '{2}{G}', colors: ['G'] });
  const PAIR = card('Test Gold Pair', 'Sorcery', 'Create two Treasure tokens.', { cost: '{1}' });
  const GIFT = card('Test Gold Gift', 'Sorcery', 'Target opponent creates a Treasure token.', { cost: '{1}' });
  const defs = [VIGOR, PAIR, GIFT];
  it('is automated; your two Treasures become four', () => {
    expect(automated(VIGOR)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Growth'], hand: ['Test Gold Pair'] }, defs });
    expect(count(castAndResolve(s0, 'Test Gold Pair'), 'Treasure', 'p1')).toBe(4);
  });
  it('an opponent\'s tokens are doubled too (it names no player); without it nothing is doubled', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Growth'], hand: ['Test Gold Gift'] }, defs });
    expect(count(castAndResolve(s0, 'Test Gold Gift', { targets: [[opp]] }), 'Treasure', 'p2')).toBe(2);
    const n0 = scenario([], { p1: { hand: ['Test Gold Pair'] }, defs });
    expect(count(castAndResolve(n0, 'Test Gold Pair'), 'Treasure', 'p1')).toBe(2);
  });
});

describe('CR 614.1a, 614.6: "If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead."', () => {
  const VISIT = card('Test Choir Hall', 'Enchantment', 'If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.', { cost: '{3}{W}', colors: ['W'] });
  const SOLDIERS = card('Test Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.', { cost: '{1}' });
  const GOLD = card('Test Gold Rush', 'Sorcery', 'Create a Treasure token.', { cost: '{1}' });
  const defs = [VISIT, SOLDIERS, GOLD];
  it('is automated; two Soldiers become two Angels (not four), and no Soldier is made', () => {
    expect(automated(VISIT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Choir Hall'], hand: ['Test Muster'] }, defs });
    const r = castAndResolve(s0, 'Test Muster');
    expect(count(r, 'Angel', 'p1')).toBe(2);
    expect(count(r, 'Soldier', 'p1')).toBe(0);
  });
  it('a noncreature token (Treasure) is not replaced; without it the Soldiers are made', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Choir Hall'], hand: ['Test Gold Rush'] }, defs });
    const r = castAndResolve(s0, 'Test Gold Rush');
    expect(count(r, 'Treasure', 'p1')).toBe(1);
    expect(count(r, 'Angel', 'p1')).toBe(0);
    const s1 = scenario([], { p1: { hand: ['Test Muster'] }, defs });
    expect(count(castAndResolve(s1, 'Test Muster'), 'Soldier', 'p1')).toBe(2);
  });
});

describe('CR 614.6, 508.4, 111.1: tokens made instead keep the instruction\'s "tapped and attacking" and "they gain haste" (Divine Visitation with an attack trigger)', () => {
  const VISIT = card('Test Choir Hall', 'Enchantment', 'If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.', { cost: '{3}{W}', colors: ['W'] });
  const HERO = card('Test Banner Hero', 'Creature — Human Knight', 'Whenever this creature attacks, create two 1/1 white Soldier creature tokens that are tapped and attacking.', { pt: ['3', '4'], cost: '{2}{W}', colors: ['W'] });
  const defs = [VISIT, HERO];
  const attack = (withVisit: boolean): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Banner Hero', ...(withVisit ? ['Test Choir Hall'] : [])] }, defs });
    let s = toDeclareAttackers(advanceTo(s0, 3, 'main1'));
    s = declareAttackers(s, [[find(s, 'Test Banner Hero', 'battlefield', 'p1')]]);
    return resolveAll(s);
  };
  it('with it, the two Angels enter tapped and attacking (and no Soldier is made)', () => {
    const s = attack(true);
    const angels = objs(s, 'Angel', 'p1');
    expect(angels.length).toBe(2);
    expect(count(s, 'Soldier', 'p1')).toBe(0);
    for (const a of angels) {
      expect(s.objects[a]!.tapped).toBe(true);
      expect(s.combat?.attackers.some((x) => x.id === a)).toBe(true);
    }
  });
  it('without it, the Soldiers are tapped and attacking (the negative case)', () => {
    const s = attack(false);
    expect(count(s, 'Angel', 'p1')).toBe(0);
    const soldiers = objs(s, 'Soldier', 'p1');
    expect(soldiers.length).toBe(2);
    for (const a of soldiers) expect(s.combat?.attackers.some((x) => x.id === a)).toBe(true);
  });
});

describe('CR 614.1c, 603.2e: only the tokens made instead enter tapped, not the ones a plus effect adds', () => {
  const FANG = card('Test Nut Chief', 'Legendary Creature — Squirrel', 'If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.', { pt: ['3', '3'] });
  const TAPPED = card('Test Cold Gold', 'Sorcery', 'Create a tapped Treasure token.', { cost: '{1}' });
  it('Chatterfang with a tapped Treasure: the Treasure is tapped, the added Squirrel is not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Nut Chief'], hand: ['Test Cold Gold'] }, defs: [FANG, TAPPED] });
    const s = castAndResolve(s0, 'Test Cold Gold');
    expect(objs(s, 'Treasure', 'p1').map((id) => s.objects[id]!.tapped)).toEqual([true]);
    expect(objs(s, 'Squirrel', 'p1').map((id) => s.objects[id]!.tapped)).toEqual([false]);
  });
});

describe('CR 111.1, 608.2h: "You create a number of Treasure tokens equal to ..." and "Each opponent creates a number of ..."', () => {
  const MINE = card('Test Tithe', 'Sorcery', 'You create a number of Treasure tokens equal to the number of creatures you control.', { cost: '{1}' });
  const THEIRS = card('Test Tribute', 'Sorcery', 'Each opponent creates a number of Treasure tokens equal to the number of creatures you control.', { cost: '{1}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const defs = [MINE, THEIRS, BEAR];
  it('is automated; you create as many Treasures as you control creatures (three bears: three; none: none)', () => {
    expect(automated(MINE) && automated(THEIRS)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'], hand: ['Test Tithe'] }, defs });
    expect(count(castAndResolve(s0, 'Test Tithe'), 'Treasure', 'p1')).toBe(3);
    const s1 = scenario([], { p1: { hand: ['Test Tithe'] }, defs });
    expect(count(castAndResolve(s1, 'Test Tithe'), 'Treasure', 'p1')).toBe(0);
  });
  it('"each opponent creates": the opponent gets them (counted from YOUR creatures), you get none; the opponent\'s own creatures do not count', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plain Bear', 'Test Plain Bear'], hand: ['Test Tribute'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const r = castAndResolve(s0, 'Test Tribute');
    expect(count(r, 'Treasure', 'p2')).toBe(2);
    expect(count(r, 'Treasure', 'p1')).toBe(0);
  });
});

describe('CR 706.2, 608.2h, 111.1, 122.6: a die roll\'s result as a number of tokens and of counters', () => {
  const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'];
  const TOKENS = card('Test Lucky Mine', 'Sorcery', 'Roll a d20. You create a number of Treasure tokens equal to the result.', { cost: '{1}' });
  const COUNTERS = card('Test Lucky Rite', 'Sorcery', 'Roll a d20. When you do, put X +1/+1 counters on each of up to two target creatures, where X is the result.', { cost: '{1}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const defs = [TOKENS, COUNTERS, BEAR];
  /** The result of the (only) die rolled in the game's log. */
  const rolled = (s: GameState): number => {
    for (const l of s.log) { const m = /rolls a d\d+: (\d+)\./.exec(l.text); if (m) return Number(m[1]); }
    throw new Error('no roll in the log');
  };
  it('is automated; you create exactly as many Treasures as the die showed (seeded rolls)', () => {
    expect(automated(TOKENS) && automated(COUNTERS)).toBe(true);
    for (const seed of SEEDS) {
      const s0 = scenario([], { p1: { hand: ['Test Lucky Mine'] }, defs, seed });
      const s = castAndResolve(s0, 'Test Lucky Mine');
      expect(count(s, 'Treasure', 'p1'), `${seed}: rolled ${rolled(s)}`).toBe(rolled(s));
      expect(count(s, 'Treasure', 'p2')).toBe(0);
    }
  });
  it('each of the (up to two) targets gets as many +1/+1 counters as the die showed; a target left out gets none', () => {
    for (const seed of SEEDS) {
      const s0 = scenario([], { p1: { hand: ['Test Lucky Rite'], battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, defs, seed });
      const [a, b, c] = objs(s0, 'Test Plain Bear', 'p1') as [ObjectId, ObjectId, ObjectId];
      const s = castAndResolve(s0, 'Test Lucky Rite', { targets: [[{ kind: 'object', id: a }, { kind: 'object', id: b }]] });
      const r = rolled(s);
      expect([s.objects[a]!.counters['+1/+1'], s.objects[b]!.counters['+1/+1']], `${seed}: rolled ${r}`).toEqual([r, r]);
      expect(s.objects[c]!.counters['+1/+1'] ?? 0).toBe(0);
    }
  });
});

describe('CR 106.12, 603.2: "Whenever you tap ~ for mana, target opponent creates a 1/1 colorless Spirit creature token."', () => {
  const ORCHARD = card('Test Strange Grove', 'Land', '{T}: Add one mana of any color.\nWhenever you tap this land for mana, target opponent creates a 1/1 colorless Spirit creature token.');
  const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
  const defs = [ORCHARD, FOREST];
  /** Activate the (only) mana ability of `name`; the opponent is the target when asked; returns the state after the stack settled. */
  const tap = (s0: GameState, name: string): GameState => {
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s0, name, 'battlefield', 'p1'));
    if (!a) throw new Error('no mana ability offered');
    return resolveAll(act(s0, a.action), { targets: [[opp]] });
  };
  it('is automated; tapping it for mana gives the opponent a Spirit (the trigger has a target, so it uses the stack)', () => {
    expect(automated(ORCHARD)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Strange Grove'] }, defs });
    const s = tap(s0, 'Test Strange Grove');
    expect(count(s, 'Spirit', 'p2')).toBe(1);
    expect(count(s, 'Spirit', 'p1')).toBe(0);
    expect(poolOf(s).length).toBe(1);
  });
  it('tapping another land for mana does not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Strange Grove', 'Test Forest'] }, defs });
    const s = tap(s0, 'Test Forest');
    expect(count(s, 'Spirit', 'p2')).toBe(0);
    expect(poolOf(s)).toBe('G');
  });
});

describe('CR 106.12, 605.1b: "Whenever you tap a permanent for {C}, add an additional {C}." (a triggered mana ability)', () => {
  const MONUMENT = card('Test Grey Obelisk', 'Artifact', 'Whenever you tap a permanent for {C}, add an additional {C}.', { cost: '{3}' });
  const WASTES = card('Test Wastes', 'Basic Land', '{T}: Add {C}.');
  const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
  const ROCK = card('Test Grey Rock', 'Artifact', '{T}: Add {C}.', { cost: '{1}' });
  const TOMB = card('Test Twin Tomb', 'Land', '{T}: Add {C}{C}.');
  const defs = [MONUMENT, WASTES, FOREST, ROCK, TOMB];
  const tap = (s0: GameState, name: string, player: 'p1' | 'p2' = 'p1'): GameState => {
    const a = legalActions(s0, player).find((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s0, name, 'battlefield', player));
    if (!a) throw new Error('no mana ability offered');
    const s = act(s0, a.action);
    expect(s.zones.stack.length).toBe(0); // a mana ability and its triggered mana ability use no stack (CR 605.3b, 605.4a)
    return s;
  };
  it('is automated; a land tapped for {C} adds {C} and one more', () => {
    expect(automated(MONUMENT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Grey Obelisk', 'Test Wastes'] }, defs });
    expect(poolOf(tap(s0, 'Test Wastes'))).toBe('CC');
  });
  it('a nonland permanent tapped for {C} (an artifact\'s mana ability with {T}) adds the extra {C} too; a land producing {C}{C} adds one extra, once', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grey Obelisk', 'Test Grey Rock'] }, defs });
    expect(poolOf(tap(s0, 'Test Grey Rock'))).toBe('CC');
    const s1 = scenario([], { p1: { battlefield: ['Test Grey Obelisk', 'Test Twin Tomb'] }, defs });
    expect(poolOf(tap(s1, 'Test Twin Tomb'))).toBe('CCC');
  });
  it('mana of another type ({G}) adds nothing; without the permanent nothing is added; the extra {C} does not trigger it again (no chain)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grey Obelisk', 'Test Forest'] }, defs });
    expect(poolOf(tap(s0, 'Test Forest'))).toBe('G');
    const s1 = scenario([], { p1: { battlefield: ['Test Wastes'] }, defs });
    expect(poolOf(tap(s1, 'Test Wastes'))).toBe('C');
    const s2 = scenario([], { p1: { battlefield: ['Test Grey Obelisk', 'Test Wastes'] }, defs });
    expect(poolOf(tap(s2, 'Test Wastes')).length).toBe(2);
  });
  it('"you tap": a land of the opponent tapped for {C} does not trigger your permanent', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grey Obelisk'] }, p2: { battlefield: ['Test Wastes'] }, defs });
    const s1 = pass(s0); // p2 receives priority
    expect(s1.pending!.player).toBe('p2');
    const a = legalActions(s1, 'p2').find((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s1, 'Test Wastes', 'battlefield', 'p2'));
    if (!a) throw new Error('no mana ability offered');
    const s = act(s1, a.action);
    expect(poolOf(s, 1)).toBe('C');
    expect(poolOf(s, 0)).toBe('');
  });
});

describe('CR 603.8: "When ~ has no ice counters on it, sacrifice it. If you do, create a 5/5 token." (a state trigger of the object itself)', () => {
  const DEPTHS = card('Test Frozen Deep', 'Land', 'This land enters with two ice counters on it.\n{1}: Remove an ice counter from this land.\nWhen this land has no ice counters on it, sacrifice it. If you do, create a 5/5 black Avatar creature token with flying.');
  const defs = [DEPTHS];
  const removeOne = (s0: GameState): GameState => {
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === find(s0, 'Test Frozen Deep', 'battlefield', 'p1') && l.isMana !== true);
    if (!a) throw new Error('no ability offered');
    return resolveAll(act(s0, a.action));
  };
  it('is automated; removing the last counter sacrifices the land and makes the token', () => {
    expect(automated(DEPTHS)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Frozen Deep', counters: { ice: 1 } }] }, defs });
    const s = removeOne(s0);
    expect(count(s, 'Test Frozen Deep', 'p1')).toBe(0);
    expect(count(s, 'Avatar', 'p1')).toBe(1);
  });
  it('with counters left nothing happens', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Frozen Deep', counters: { ice: 2 } }] }, defs });
    const s = removeOne(s0);
    expect(count(s, 'Test Frozen Deep', 'p1')).toBe(1);
    expect(count(s, 'Avatar', 'p1')).toBe(0);
    expect(s.objects[find(s, 'Test Frozen Deep', 'battlefield', 'p1')]!.counters['ice']).toBe(1);
  });
});

describe('CR 614.1c, 614.12, 707.5: "You may have ~ enter tapped as a copy of any land on the battlefield."', () => {
  const VESUVA = card('Test Mimic Flats', 'Land', 'You may have this land enter tapped as a copy of any land on the battlefield.');
  const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
  const defs = [VESUVA, FOREST];
  /** Play the land and answer the copy question: the Forest when `copy`, nothing otherwise. */
  const play = (copy: boolean): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Mimic Flats'], battlefield: ['Test Forest'] }, defs });
    return resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Mimic Flats', 'hand', 'p1') }), { yes: copy, pick: (options) => (copy ? options.slice(0, 1) : []) });
  };
  it('is automated; copying the Forest it enters tapped and is a Forest', () => {
    expect(automated(VESUVA)).toBe(true);
    const s = play(true);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Test Mimic Flats')!;
    expect(s.objects[id]!.tapped).toBe(true);
    expect(chars(s, id).name).toBe('Test Forest');
  });
  it('declining the copy: it enters untapped, as itself', () => {
    const s = play(false);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Test Mimic Flats')!;
    expect(s.objects[id]!.tapped).toBe(false);
    expect(chars(s, id).name).toBe('Test Mimic Flats');
  });
});

describe('CR 613.1d, 613.1f, 509.1b: "Equipped creature has ward {2}, is an Assassin in addition to its other types, and can\'t be blocked."', () => {
  const SASH = card('Test Dark Sash', 'Artifact — Equipment', 'Equipped creature has ward {2}, is an Assassin in addition to its other types, and can\'t be blocked.\nEquip {1}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const defs = [SASH, BEAR];
  const start = (equipped: boolean): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Dark Sash', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    if (equipped) s.objects[find(s, 'Test Dark Sash', 'battlefield', 'p1')]!.attachedTo = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    return toDeclareAttackers(advanceTo(s, 3, 'main1'));
  };
  it('is automated; equipped, the Bear is also an Assassin (still a Bear), has ward and cannot be blocked', () => {
    expect(automated(SASH)).toBe(true);
    let s = start(true);
    const mine = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect([...chars(s, mine).subtypes].sort()).toEqual(['Assassin', 'Bear']);
    expect(chars(s, mine).keywords.some((k) => k.keyword === 'ward')).toBe(true);
    s = declareAttackers(s, [[mine]]);
    expect(hookpoints.canBlock(gameOf(s), find(s, 'Test Plain Bear', 'battlefield', 'p2'), mine)).not.toBeNull();
  });
  it('unequipped, the Bear is only a Bear, has no ward and can be blocked', () => {
    let s = start(false);
    const mine = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect([...chars(s, mine).subtypes]).toEqual(['Bear']);
    expect(chars(s, mine).keywords.some((k) => k.keyword === 'ward')).toBe(false);
    s = declareAttackers(s, [[mine]]);
    expect(hookpoints.canBlock(gameOf(s), find(s, 'Test Plain Bear', 'battlefield', 'p2'), mine)).toBeNull();
  });
});

describe('CR 109.2: "put a +1/+1 counter on target creature you control other than ~"', () => {
  const HOST = card('Test Garden Host', 'Creature — Halfling', 'Whenever you create a token, put a +1/+1 counter on target creature you control other than this creature.', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const GOLD = card('Test Gold Rush', 'Sorcery', 'Create a Treasure token.', { cost: '{1}' });
  const defs = [HOST, BEAR, GOLD];
  it('is automated; with the host alone on the battlefield there is no legal target (no counter anywhere)', () => {
    expect(automated(HOST)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Garden Host'], hand: ['Test Gold Rush'] }, defs });
    const s = castAndResolve(s0, 'Test Gold Rush');
    expect(count(s, 'Treasure', 'p1')).toBe(1);
    expect(s.objects[find(s, 'Test Garden Host', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('with another creature: that creature gets the counter, the host does not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Garden Host', 'Test Plain Bear'], hand: ['Test Gold Rush'] }, defs });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const s = castAndResolve(s0, 'Test Gold Rush', { targets: [[{ kind: 'object', id: bear }]] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(s.objects[find(s, 'Test Garden Host', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 107.3, 608.2h, 613.4b: "Target land you control becomes an X/X Elemental creature with trample and haste until end of turn, where X is the number of enchantments you control. It\'s still a land."', () => {
  const WEAVER = card('Test Grove Weaver', 'Creature — Elf', '{G}: Target land you control becomes an X/X Elemental creature with trample and haste until end of turn, where X is the number of enchantments you control. It\'s still a land.', { pt: ['1', '1'], cost: '{1}{G}', colors: ['G'] });
  const BOON = card('Test Quiet Boon', 'Enchantment', '');
  const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
  const defs = [WEAVER, BOON, FOREST];
  const animate = (boons: number): { s: GameState; land: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grove Weaver', 'Test Forest', ...Array(boons).fill('Test Quiet Boon')] }, defs });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const land = find(s0, 'Test Forest', 'battlefield', 'p1');
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === find(s0, 'Test Grove Weaver', 'battlefield', 'p1'));
    if (!a) throw new Error('no ability offered');
    return { s: resolveAll(act(s0, a.action), { targets: [[{ kind: 'object', id: land }]] }), land };
  };
  it('is automated; with two enchantments the land is a 2/2 Elemental creature with trample and haste that is still a land', () => {
    expect(automated(WEAVER)).toBe(true);
    const { s, land } = animate(2);
    const c = chars(s, land);
    expect([c.power, c.toughness]).toEqual(['2', '2']);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Elemental']));
    expect(c.keywords.map((k) => k.keyword).sort()).toEqual(expect.arrayContaining(['haste', 'trample']));
  });
  it('X is read once, as the ability resolves: a third enchantment arriving later does not change it; with none it is a 0/0 (and dies as a state-based action)', () => {
    const { s, land } = animate(2);
    put(s, 'p1', 'battlefield', 'Test Quiet Boon'); // a third enchantment after the ability resolved
    expect(chars(s, land).power).toBe('2');
    const none = animate(0);
    expect(none.s.zones.battlefield.includes(none.land)).toBe(false); // a 0/0 creature land is put into the graveyard (CR 704.5f)
  });
});
