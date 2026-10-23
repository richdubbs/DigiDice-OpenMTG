/**
 * p2-counters-move-1 (lane p2-counters-move): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 122.5, 608.2d   "Move a counter from target creature onto a second target creature.": one counter, its kind chosen as it resolves; one object for both moves nothing
 *   CR 122.5           "Move all counters from target creature onto another target creature.": every counter of every kind
 *   CR 122.5, 608.2d   "Move any number of counters from ... onto ...": how many of each kind, chosen as it resolves, none to all
 *   CR 701.34a, 603.2  "Whenever you proliferate, ...": once per proliferate, also one that chose nothing; "Proliferate X times."
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState, ObjectId } from '../../../src/index';
import { activate, target } from '../../m5/cr-examples/helpers';
import { castWith, drive, find, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const counters = (s: GameState, id: ObjectId): Record<string, number> => Object.fromEntries(Object.entries(s.objects[id]!.counters ?? {}).filter(([, n]) => n > 0));
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const option = (id: string): DecisionAnswer => ({ kind: 'chooseOption', ids: [id] });
const number = (n: number): DecisionAnswer => ({ kind: 'chooseNumber', n });

const MOVER = synthetic('Test Counter Ferry', 'Artifact', '{1}', '{1}: Move a counter from target creature onto a second target creature.');
const ALL = synthetic('Test Grand Transfer', 'Sorcery', '{1}{U}', 'Move all counters from target creature onto another target creature.');
const SOME = synthetic('Test Careful Ferry', 'Artifact', '{1}', '{2}: Move any number of counters from target creature onto a second target creature.');
const BEAR = synthetic('Test Grey Bear', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2' });
const ELK = synthetic('Test Grey Elk', 'Creature — Elk', '{1}{G}', '', { power: '2', toughness: '2' });
const WATCHER = synthetic('Test Spore Watcher', 'Creature — Fungus', '{1}{G}', 'Whenever you proliferate, you gain 2 life.', { power: '1', toughness: '1' });
const SPREAD = synthetic('Test Double Spread', 'Sorcery', '{1}{G}', 'Proliferate twice.');
const XSPREAD = synthetic('Test Wide Spread', 'Sorcery', '{X}{G}', 'Proliferate X times.');
const AGAIN = synthetic('Test Spore Burst', 'Sorcery', '{1}{G}', 'Proliferate, then proliferate again.');
const DEFS = [MOVER, ALL, SOME, BEAR, ELK, WATCHER, SPREAD, XSPREAD, AGAIN];

/** A board with the bear (two +1/+1 counters and a charge counter) and the elk (no counters) on p1's side. */
function board(extra: string[] = [], hand: string[] = []): { s: GameState; bear: ObjectId; elk: ObjectId } {
  const s = scenario(['Forest', 'Island'], { defs: DEFS, p1: { hand, battlefield: ['Test Grey Bear', 'Test Grey Elk', ...extra, ...lands('Forest', 4), ...lands('Island', 2)] } });
  const bear = find(s, 'Test Grey Bear', 'battlefield');
  const elk = find(s, 'Test Grey Elk', 'battlefield');
  s.objects[bear]!.counters = { '+1/+1': 2, charge: 1 };
  return { s, bear, elk };
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card with text plays fully', () => {
    for (const d of DEFS.filter((x) => x !== BEAR && x !== ELK)) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 122.5, 608.2d: "Move a counter from target creature onto a second target creature."', () => {
  it('CR 608.2d: with two kinds there, the controller chooses which one moves: one charge counter leaves the bear and goes on the elk', () => {
    const { s: s0, bear, elk } = board(['Test Counter Ferry']);
    const s = resolveAll(activate(s0, find(s0, 'Test Counter Ferry', 'battlefield'), [target(bear), target(elk)]), [option('charge')]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 2 });
    expect(counters(s, elk)).toEqual({ charge: 1 });
  });
  it('CR 115.3, 122.5: one creature chosen for both targets: nothing moves', () => {
    const { s: s0, bear } = board(['Test Counter Ferry']);
    const s = resolveAll(activate(s0, find(s0, 'Test Counter Ferry', 'battlefield'), [target(bear), target(bear)]), [option('charge')]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 1 });
  });
  it('CR 122.5: from a creature with no counters, nothing moves', () => {
    const { s: s0, bear, elk } = board(['Test Counter Ferry']);
    const s = resolveAll(activate(s0, find(s0, 'Test Counter Ferry', 'battlefield'), [target(elk), target(bear)]));
    expect(counters(s, elk)).toEqual({});
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 1 });
  });
});

describe('CR 122.5: "Move all counters from target creature onto another target creature."', () => {
  it('CR 122.5: every counter of every kind moves', () => {
    const { s: s0, bear, elk } = board([], ['Test Grand Transfer']);
    const s = resolveAll(castWith(s0, 'Test Grand Transfer', [target(bear), target(elk)]));
    expect(counters(s, bear)).toEqual({});
    expect(counters(s, elk)).toEqual({ '+1/+1': 2, charge: 1 });
  });
});

describe('CR 122.5, 608.2d: "Move any number of counters from target creature onto a second target creature."', () => {
  it('CR 608.2d: for each kind, how many: one +1/+1 counter and no charge counter move', () => {
    const { s: s0, bear, elk } = board(['Test Careful Ferry']);
    const s = resolveAll(activate(s0, find(s0, 'Test Careful Ferry', 'battlefield'), [target(bear), target(elk)]), [number(1), number(0)]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 1, charge: 1 });
    expect(counters(s, elk)).toEqual({ '+1/+1': 1 });
  });
  it('CR 608.2d: none of either kind is a legal choice: nothing moves', () => {
    const { s: s0, bear, elk } = board(['Test Careful Ferry']);
    const s = resolveAll(activate(s0, find(s0, 'Test Careful Ferry', 'battlefield'), [target(bear), target(elk)]), [number(0), number(0)]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 1 });
    expect(counters(s, elk)).toEqual({});
  });
});

describe('CR 701.34a, 603.2: "Whenever you proliferate, you gain 2 life."', () => {
  it('CR 701.34a: "Proliferate twice." triggers it twice, once per proliferate (the bear gets one more counter of each kind each time)', () => {
    const { s: s0, bear } = board(['Test Spore Watcher'], ['Test Double Spread']);
    const s = resolveAll(castWith(s0, 'Test Double Spread'), [{ kind: 'chooseOption', ids: [`object:${bear}`] }, { kind: 'chooseOption', ids: [`object:${bear}`] }]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 4, charge: 3 });
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 4);
  });
  it('CR 701.34a: a proliferate that chooses nothing is still a proliferate: "proliferate, then proliferate again" with no choices gains 4 life', () => {
    const { s: s0, bear } = board(['Test Spore Watcher'], ['Test Spore Burst']);
    const s = resolveAll(castWith(s0, 'Test Spore Burst'), [{ kind: 'chooseOption', ids: [] }, { kind: 'chooseOption', ids: [] }]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 1 });
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 4);
  });
  it('CR 603.2: without the watcher, proliferating gains no life (the trigger is the watcher\'s, not the action\'s)', () => {
    const { s: s0 } = board([], ['Test Double Spread']);
    const s = resolveAll(castWith(s0, 'Test Double Spread'), [{ kind: 'chooseOption', ids: [] }, { kind: 'chooseOption', ids: [] }]);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe('CR 701.34a, 107.3a: "Proliferate X times."', () => {
  it('CR 107.3a: X is announced as the spell is cast: X = 3 gives the bear three more counters of each kind', () => {
    const { s: s0, bear } = board([], ['Test Wide Spread']);
    const pick = { kind: 'chooseOption', ids: [`object:${bear}`] } as DecisionAnswer;
    const s = resolveAll(castWith(s0, 'Test Wide Spread', [number(3)]), [pick, pick, pick]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 5, charge: 4 });
  });
  it('CR 107.3a: X = 0 proliferates no times', () => {
    const { s: s0, bear } = board([], ['Test Wide Spread']);
    const s = drive(resolveAll(castWith(s0, 'Test Wide Spread', [number(0)])));
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 1 });
  });
});
