/**
 * Standard round rx10 (std-rx10, wave 2 slice s17): the readings this round added, played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified:
 * rules/cr/ is not in the cloud checkout).
 *
 *   CR 115.1, 701.14a     "Choose target creature you control and target creature you don't control. ... Then those creatures fight each other.": the two targets fight
 *   CR 400.7, 608.2c      "If the creature you control entered this turn, put a +1/+1 counter on it.": a creature cast this turn; one that was there before is not
 *   CR 701.14b, 608.2b    an illegal target at resolution: no fight, the instructions about the legal target still happen
 *   CR 208.1              "a creature card with total power and toughness 5 or less": a 2/3 may be put onto the battlefield, a 3/3 may not
 *   CR 601.3b, 118.8      "You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it.": at instant speed only with a Dragon
 *                         to behold; at sorcery timing nothing extra is asked
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { lifeOf, logHas } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' || d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The answers to the decisions of a cast, in order of kind; mana payment is automatic. Stops at the next priority decision. */
interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const castable = (s: GameState, name: string, player = 'p1'): boolean => {
  const id = find(s, name, 'hand', player);
  return legalActions(s, player).some((a) => a.action.type === 'cast' && a.action.card === id);
};
const damage = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;
const counters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;
const zone = (s: GameState, id: ObjectId): string | undefined => s.objects[id]?.zone;

const CLASH = card('Test Grove Clash', 'Sorcery', 'Choose target creature you control and target creature you don\'t control. If the creature you control entered this turn, put a +1/+1 counter on it. Then those creatures fight each other.');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{0}', ['3', '3']);
const SNAP = card('Test Snap', 'Instant', 'Return target creature to its owner\'s hand.');
const SCORCH = card('Test Wyrm Scorch', 'Sorcery', 'You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it.\nTest Wyrm Scorch deals 4 damage to target creature.');
const WHELP = card('Test Whelp', 'Creature — Dragon', '', '{5}', ['2', '2']);
const GAIN = card('Test Gain', 'Instant', 'You gain 1 life.');
const SLIP = card('Test Sly Entry', 'Enchantment', '{0}: You may put a creature card with total power and toughness 5 or less from your hand onto the battlefield. That creature gains haste. At the beginning of the next end step, sacrifice that creature.');
const PUP = card('Test Pup', 'Creature — Dog', '', '{4}', ['2', '3']);
const DEFS = [CLASH, BEAR, BRUTE, SNAP, SCORCH, WHELP, GAIN, SLIP, PUP];

describe('std-rx10 cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [CLASH, SCORCH, SLIP]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 115.1, 701.14a, 400.7: "Choose target creature you control and target creature you don\'t control. If the creature you control entered this turn, ..."', () => {
  it('a creature cast this turn gets the counter, then the two fight: the 3/3 Bear and the 3/3 Brute deal 3 damage to each other', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grove Clash', 'Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    s = resolveAll(cast(s, 'Test Bear'));
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Grove Clash', { targets: [[obj(bear)], [obj(brute)]] }));
    expect(zone(s, bear)).not.toBe('battlefield'); // 3 damage on a 3/3 (CR 704.5g)
    expect(zone(s, brute)).not.toBe('battlefield'); // without the counter the Bear would deal only 2
  });
  it('a creature that was there before the turn gets no counter: the 2/2 Bear deals 2 to the Brute and dies', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grove Clash'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Grove Clash', { targets: [[obj(bear)], [obj(brute)]] }));
    expect(zone(s, bear)).not.toBe('battlefield');
    expect(damage(s, brute)).toBe(2);
  });
  it('CR 701.14b, 608.2b: the creature you don\'t control left before resolution: the counter is still put, there is no fight', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grove Clash', 'Test Bear'] }, p2: { battlefield: ['Test Brute'], hand: ['Test Snap'] } });
    s = resolveAll(cast(s, 'Test Bear'));
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = cast(s, 'Test Grove Clash', { targets: [[obj(bear)], [obj(brute)]] });
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    s = cast(s, 'Test Snap', { targets: [[obj(brute)]] }, 'p2');
    s = resolveAll(s);
    expect(zone(s, brute)).not.toBe('battlefield');
    expect(zone(s, bear)).toBe('battlefield');
    expect(counters(s, bear)).toBe(1);
    expect(damage(s, bear)).toBe(0);
  });
});

describe('CR 601.3b, 118.8: "You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it."', () => {
  it('at sorcery timing it is cast as usual, with no Dragon to behold', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Wyrm Scorch'] }, p2: { battlefield: ['Test Brute'] } });
    expect(castable(s, 'Test Wyrm Scorch')).toBe(true);
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Wyrm Scorch', { targets: [[obj(brute)]] }));
    expect(zone(s, brute)).not.toBe('battlefield');
  });
  it('with a spell on the stack, it can be cast only with a Dragon to behold; the Dragon card revealed from the hand stays there', () => {
    const base = (hand: string[]): GameState => cast(scenario([], { defs: DEFS, p1: { hand: ['Test Gain', ...hand] }, p2: { battlefield: ['Test Brute'] } }), 'Test Gain');
    const without = base(['Test Wyrm Scorch']);
    expect(without.zones.stack).toHaveLength(1);
    expect(castable(without, 'Test Wyrm Scorch')).toBe(false);
    let s = base(['Test Wyrm Scorch', 'Test Whelp']);
    expect(castable(s, 'Test Wyrm Scorch')).toBe(true);
    const whelp = find(s, 'Test Whelp', 'hand', 'p1');
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = cast(s, 'Test Wyrm Scorch', { objects: [[whelp]], targets: [[obj(brute)]] });
    expect(s.zones.stack).toHaveLength(2);
    expect(logHas(s, /behold/i)).toBe(true);
    s = resolveAll(s);
    expect(zone(s, brute)).not.toBe('battlefield');
    expect(zone(s, whelp)).toBe('hand');
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});

describe('CR 208.1: "You may put a creature card with total power and toughness 5 or less from your hand onto the battlefield."', () => {
  it('a 2/3 (total 5) can be put onto the battlefield; a 3/3 (total 6) is not offered', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Pup', 'Test Brute'], battlefield: ['Test Sly Entry'] } });
    const pup = find(s, 'Test Pup', 'hand', 'p1');
    const brute = find(s, 'Test Brute', 'hand', 'p1');
    const slip = find(s, 'Test Sly Entry', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === slip)!;
    s = drive(act(s, la.action));
    let offered: ObjectId[] = [];
    s = passBoth(s);
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') { offered = p.options; s = answer(s, { kind: 'chooseObjects', ids: [pup] }); } else s = drive(s, { yes: [true] });
    }
    expect(offered).toContain(pup);
    expect(offered).not.toContain(brute);
    const names = s.zones.battlefield.map((id) => s.objects[id]!.defId);
    expect(names).toContain('Test Pup');
    expect(zone(s, brute)).toBe('hand');
  });
});
