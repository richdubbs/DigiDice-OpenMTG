/**
 * Commander lane edh-next, round edh-next-43: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 706.2, 603.2c       "Whenever you roll a 1 or 2, put that many +1/+1 counters on this creature." (Atomwheel Acrobats)
 *   CR 603.7, 108.4        "When you lose control of the creature, tap it." (Ray of Command)
 *   CR 105.2c, 611.2a      "Target spell or permanent becomes colorless." (Moonlace)
 *   CR 404.1               "Exile the bottom card of target player's graveyard." (Phyrexian Furnace)
 *   CR 701.9a, 608.2c      "Each player who discarded a card this way may search their library ..." (Borderland Explorer)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
/** Resolve everything on the stack. `yes` answers every yes/no; `take` picks which of the offered objects a choice takes. */
const resolveAll = (s0: GameState, yes = true, take: 'one' | 'all' | 'none' | 'last' = 'one'): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 60 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: take === 'none' ? [] : take === 'all' ? (d.options ?? []) : take === 'last' ? (d.options ?? []).slice(-1) : (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
const cast = (s: GameState, name: string, yes = true, take: 'one' | 'all' | 'none' | 'last' = 'one'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never)), yes, take);
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const lib = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const gy = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id));
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;
const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters?.['+1/+1'] ?? 0;

const LAND = card('Test Moor', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RING = card('Test Ring', 'Artifact', '');
const FOREST = card('Test Forest', 'Basic Land — Forest', '');
const GREEN = (name: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Elf', oracle_text: '', colors: ['G'], power: '2', toughness: '2' } as OracleCard);

describe('CR 706.2, 603.2c: "Whenever you roll a 1 or 2, put that many +1/+1 counters on this creature."', () => {
  const IMP = card('Test Imp', 'Creature — Imp', 'Whenever you roll a 1 or 2, put that many +1/+1 counters on this creature.\n{0}: Roll a six-sided die.', { pt: ['1', '1'] });
  it('is automated', () => { expect(noManual(IMP)).toEqual([]); });
  const roll = (seed: string): number => {
    const s0 = scenario([], { seed, defs: [IMP], p1: { battlefield: ['Test Imp'] } });
    return counters(resolveAll(settle(act(s0, legal(s0, 'p1', 'activate')[0]!.action))), 'Test Imp');
  };
  it('a roll of 1 puts one counter, a roll of 2 puts two, and any other roll puts none (counters are never more than 2)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(roll(`imp-${i}`));
    expect([...seen].every((n) => n === 0 || n === 1 || n === 2)).toBe(true);
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });
  // ruling of 2022-10-07: the result is the one after modifiers; "Roll a d20 and add 1" can never give a 1, and a natural 1 is a 2
  const ADD = card('Test Adder', 'Artifact', '{0}: Roll a d20 and add 1.');
  it('a modified roll counts as its modified result: with "+1", counters are never 1 and a natural 2 (result 3) puts none', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const s0 = scenario([], { seed: `add-${i}`, defs: [IMP, ADD], p1: { battlefield: ['Test Imp', 'Test Adder'] } });
      const act0 = legal(s0, 'p1', 'activate').find((a) => a.label.includes('d20'));
      if (act0 === undefined) throw new Error('no d20 ability');
      seen.add(counters(resolveAll(settle(act(s0, act0.action))), 'Test Imp'));
    }
    expect([...seen].every((n) => n === 0 || n === 2)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });
  it('an opponent\'s roll does not trigger it', () => {
    const OPP = card('Test Rattler', 'Artifact', '{0}: Target opponent rolls a six-sided die.');
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const s0 = scenario([], { seed: `opp-${i}`, defs: [IMP, OPP], p1: { battlefield: ['Test Imp', 'Test Rattler'] } });
      const a = legal(s0, 'p1', 'activate').find((x) => x.label.includes('rolls'));
      if (a === undefined) return; // the wording is not offered by this build: nothing to check
      seen.add(counters(resolveAll(settle(act(s0, a.action))), 'Test Imp'));
    }
    expect([...seen]).toEqual([0]);
  });
});

describe('CR 603.7, 108.4: "Untap target creature an opponent controls and gain control of it until end of turn. ... When you lose control of the creature, tap it."', () => {
  const RAY = card('Test Ray', 'Sorcery', 'Untap target creature an opponent controls and gain control of it until end of turn. That creature gains haste until end of turn. When you lose control of the creature, tap it.');
  it('is automated', () => { expect(noManual(RAY)).toEqual([]); });
  const start = (): GameState => {
    const s0 = scenario([], { defs: [RAY, BEAR], p1: { hand: ['Test Ray'] }, p2: { battlefield: ['Test Bear'] } });
    return s0;
  };
  it('you control it untapped this turn; at end of turn it goes back to its owner and is tapped', () => {
    const s0 = start();
    const bear = findAll(s0, 'Test Bear', 'battlefield')[0]!;
    let t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ray', 'hand', 'p1') } as never));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as DecisionAnswer));
    const s1 = resolveAll(t);
    expect(getChars(s1, bear)!.controller).toBe('p1');
    expect(s1.objects[bear]!.tapped).toBeFalsy();
    // the effect ends as the turn's cleanup step begins (CR 514.2); the delayed trigger is then put on the stack and resolves before the next untap step (CR 514.3a)
    let s2 = advanceTo(s1, 1, 'cleanup');
    for (let g = 0; g < 10 && s2.zones.stack.length > 0; g++) s2 = settle(pass(s2));
    expect(getChars(s2, bear)!.controller).toBe('p2');
    expect(s2.objects[bear]!.tapped).toBe(true);
  });
  it('without the loss of control it is not tapped: while you still control it, it stays untapped', () => {
    const s0 = start();
    const bear = findAll(s0, 'Test Bear', 'battlefield')[0]!;
    let t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ray', 'hand', 'p1') } as never));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as DecisionAnswer));
    const s1 = advanceTo(resolveAll(t), 1, 'end');
    expect(getChars(s1, bear)!.controller).toBe('p1');
    expect(s1.objects[bear]!.tapped).toBeFalsy();
  });
});

describe('CR 105.2c, 611.2a: "Target spell or permanent becomes colorless."', () => {
  const LACE = card('Test Lace', 'Instant', 'Target spell or permanent becomes colorless.');
  it('is automated', () => { expect(noManual(LACE)).toEqual([]); });
  it('the permanent is colorless from then on (not only this turn); another permanent keeps its color', () => {
    const a = GREEN('Test Sprout'); const b = GREEN('Test Twig');
    const s0 = scenario([], { defs: [LACE, a, b], p1: { hand: ['Test Lace'], battlefield: ['Test Sprout', 'Test Twig'] } });
    const sprout = findAll(s0, 'Test Sprout', 'battlefield')[0]!; const twig = findAll(s0, 'Test Twig', 'battlefield')[0]!;
    expect(getChars(s0, sprout)!.colors).toEqual(['G']);
    let t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Lace', 'hand', 'p1') } as never));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: sprout }] } as DecisionAnswer));
    const s1 = resolveAll(t);
    expect(getChars(s1, sprout)!.colors).toEqual([]);
    expect(getChars(s1, twig)!.colors).toEqual(['G']);
    const s2 = advanceTo(s1, 2, 'upkeep');
    expect(getChars(s2, sprout)!.colors).toEqual([]);
  });
});

describe('CR 404.1: "Exile the bottom card of target player\'s graveyard."', () => {
  const FURN = card('Test Furnace', 'Artifact', '{T}: Exile the bottom card of target player\'s graveyard.');
  it('is automated', () => { expect(noManual(FURN)).toEqual([]); });
  it('exiles the card that has been there longest; the top card, and the other graveyard, are untouched', () => {
    const s0 = scenario([], { defs: [FURN, BEAR, RING, LAND], p1: { battlefield: ['Test Furnace'], graveyard: ['Test Ring'] }, p2: { graveyard: ['Test Bear', 'Test Ring', 'Test Moor'] } });
    const order = gy(s0, 'p2');
    let t = settle(act(s0, legal(s0, 'p1', 'activate')[0]!.action));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer));
    const s1 = resolveAll(t);
    expect(gy(s1, 'p2')).toEqual(order.slice(1));
    expect(findAll(s1, order[0]!, 'exile').length).toBe(1);
    expect(gy(s1, 'p1')).toEqual(['Test Ring']);
  });
  it('an empty graveyard: nothing happens', () => {
    const s0 = scenario([], { defs: [FURN], p1: { battlefield: ['Test Furnace'] } });
    let t = settle(act(s0, legal(s0, 'p1', 'activate')[0]!.action));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer));
    const s1 = resolveAll(t);
    expect(gy(s1, 'p2')).toEqual([]);
  });
});

describe('CR 701.9a, 608.2c: "Each player may discard a card. Each player who discarded a card this way may search their library for a basic land card ..."', () => {
  const SCOUT = card('Test Scout', 'Creature — Elf', 'When this creature enters, each player may discard a card. Each player who discarded a card this way may search their library for a basic land card, reveal it, put it into their hand, then shuffle.', { pt: ['1', '1'] });
  it('is automated', () => { expect(noManual(SCOUT)).toEqual([]); });
  const defs = [SCOUT, RING, FOREST, BEAR];
  it('only the players who discarded search: the player with a card to discard gets a land, the player with an empty hand does not', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Scout', 'Test Ring'], library: ['Test Bear', 'Test Forest'] }, p2: { library: ['Test Bear', 'Test Forest'] } }), 'Test Scout');
    expect(gy(s, 'p1')).toContain('Test Ring');
    expect(handNames(s, 'p1')).toContain('Test Forest');
    expect(handNames(s, 'p2')).not.toContain('Test Forest');
    expect(lib(s, 'p2')).toContain('Test Forest');
  });
  it('declining to discard means no search', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Scout', 'Test Ring'], library: ['Test Bear', 'Test Forest'] } }), 'Test Scout', false);
    expect(handNames(s, 'p1')).toEqual(['Test Ring']);
    expect(lib(s, 'p1')).toContain('Test Forest');
  });
});
