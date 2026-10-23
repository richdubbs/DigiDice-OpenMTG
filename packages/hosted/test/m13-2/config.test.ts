/**
 * The table's pure pieces: `tableConfig` and the seating (design 2.4), the stranded-player rule (`offersNoAnswer`), the action checks on fixed inputs,
 * and the default placement rule and loss codes (design 7).
 */
import { describe, expect, it } from 'vitest';
import { createGame, type Decision, type GameState } from '@openmtg/engine';
import type { PreparedDeck } from '@openmtg/net/server-kit';
import { actionLegalityProblem, actionShapeProblem, defaultPlacements, lossOf, offersNoAnswer, seatingOrder, tableConfig, type PlacementSeat } from '../../src/table';
import { fixtureConfig } from './harness';

const deck = (main: string[], extra: Partial<PreparedDeck> = {}): PreparedDeck => ({ main, sideboard: [], commanders: [], defs: [], warnings: [], ...extra });

describe('M13-2: tableConfig and seating', () => {
  it('two seats keep their order (p1 is seat 1); sideboards only when not empty; no commander options outside a Commander format', () => {
    const { config, seating } = tableConfig('standard', [
      { seat: 2, name: 'Bea', deck: deck(['Forest'], { sideboard: ['Island'] }) },
      { seat: 1, name: 'Al', deck: deck(['Mountain']) },
    ], 'seed-1');
    expect(seating).toEqual([1, 2]);
    expect(config.players).toEqual([
      { id: 'p1', name: 'Al', deck: ['Mountain'] },
      { id: 'p2', name: 'Bea', deck: ['Forest'], sideboard: ['Island'] },
    ]);
    expect(config.seed).toBe('seed-1');
    expect(config.options).toBeUndefined();
  });

  it('a Commander format plays the variant (options.commander) with each player\'s commanders (CR 903.6)', () => {
    const { config } = tableConfig('commander', [
      { seat: 1, name: 'Al', deck: deck(['Forest'], { commanders: ['Cmdr A'] }) },
      { seat: 2, name: 'Bea', deck: deck(['Island'], { commanders: ['Cmdr B'] }) },
    ], 'seed-2');
    expect(config.options?.commander).toBeDefined();
    expect(config.players.map((p) => p.commanders)).toEqual([['Cmdr A'], ['Cmdr B']]);
  });

  it('3-4 seats are seated in a random order from the seed (M12 D2), the same for the same seed; without options.multiplayer the engine refuses them (M12-1; pods: M13-16 sets it)', () => {
    const seats = [1, 2, 3, 4] as const;
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const o = seatingOrder([...seats], `s${i}`);
      expect([...o].sort()).toEqual([1, 2, 3, 4]);
      expect(seatingOrder([...seats], `s${i}`)).toEqual(o);
      orders.add(o.join());
    }
    expect(orders.size).toBeGreaterThan(5);
    const base = fixtureConfig('three', { Forest: 20 }, { Forest: 20 });
    const { config } = tableConfig('casual', [1, 2, 3].map((s) => ({ seat: s as 1 | 2 | 3, name: `P${s}`, deck: deck(base.players[0]!.deck, { defs: base.defs as never }) })), 'seed-3');
    expect(config.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(() => createGame(config)).toThrow(/multiplayer/);
  });
});

describe('M13-2: the stranded-player rule', () => {
  const base = { id: 'd1', player: 'p1', prompt: '?', cancellable: true };
  const cases: [string, Decision, boolean][] = [
    ['objects: fewer than needed', { ...base, kind: 'chooseObjects', options: ['o1'], min: 2, max: 2 }, true],
    ['objects: enough', { ...base, kind: 'chooseObjects', options: ['o1', 'o2'], min: 2, max: 2 }, false],
    ['options: all disabled', { ...base, kind: 'chooseOption', options: [{ id: 'a', label: 'A', disabled: 'no' }], min: 1, max: 1 }, true],
    ['options: one enabled', { ...base, kind: 'chooseOption', options: [{ id: 'a', label: 'A' }], min: 1, max: 1 }, false],
    ['targets: none', { ...base, kind: 'chooseTargets', targetText: 'target creature', objects: [], players: [], min: 1, max: 1 }, true],
    ['targets: one', { ...base, kind: 'chooseTargets', targetText: 'target creature', objects: ['o1'], players: [], min: 1, max: 1 }, false],
    ['division: nothing to divide among', { ...base, kind: 'chooseDivision', what: 'damage', total: 3, targets: [] }, true],
    ['cost: unpayable, no sources', { ...base, kind: 'payCost', costText: '{R}', manaSources: [], autoPayable: false }, true],
    ['cost: payable', { ...base, kind: 'payCost', costText: '{R}', manaSources: [], autoPayable: true }, false],
    ['yes/no', { ...base, kind: 'yesNo' }, false],
  ];
  for (const [name, d, stranded] of cases) it(name, () => expect(offersNoAnswer(d)).toBe(stranded));
});

describe('M13-2: the action checks on fixed inputs', () => {
  const s = createGame(fixtureConfig('m13-2-pure', { Forest: 20 }, { Forest: 20 }));
  it('shape and text', () => {
    expect(actionShapeProblem({ type: 'pass', player: 'p1' })).toBeNull();
    expect(actionShapeProblem({ type: 'concede', player: 'p1⁦' })).toMatchObject({ code: 'badMessage' });
    expect(actionShapeProblem({ type: 'pass' })).toMatchObject({ code: 'badMessage' });
    expect(actionShapeProblem(undefined)).toMatchObject({ code: 'badMessage' });
  });
  it('legality on the full state', () => {
    const d = s.pending!;
    const other = d.player === 'p1' ? 'p2' : 'p1';
    expect(actionLegalityProblem(s, other, { type: 'pass', player: d.player })).toMatchObject({ code: 'notYourPlayer' });
    expect(actionLegalityProblem(s, other, { type: 'pass', player: other })).toMatchObject({ code: 'stale' });
    expect(actionLegalityProblem(s, other, { type: 'concede', player: other })).toBeNull();
    expect(actionLegalityProblem(s, d.player, { type: 'answer', player: d.player, decisionId: 'nope', answer: { kind: 'yesNo', yes: true } } as never)).toMatchObject({ code: 'stale' });
  });
});

describe('M13-2: placements and loss codes', () => {
  it('lossOf maps the engine reasons and the table causes', () => {
    expect(lossOf('has 0 or less life', null)).toEqual({ loss: 'life', lossRule: 'CR 704.5a' });
    expect(lossOf('attempted to draw from an empty library', null)).toEqual({ loss: 'emptyLibrary', lossRule: 'CR 704.5b' });
    expect(lossOf('has ten or more poison counters', null)).toEqual({ loss: 'poison', lossRule: 'CR 704.5c' });
    expect(lossOf('conceded', null)).toEqual({ loss: 'concession', lossRule: 'CR 104.3a' });
    expect(lossOf('conceded', 'timeout').loss).toBe('timeout');
    expect(lossOf('conceded', 'disconnect').loss).toBe('disconnect');
    expect(lossOf('conceded', 'left').loss).toBe('left');
    expect(lossOf('Al won the game', null).loss).toBe('opponentWon');
    expect(lossOf('something else', null).loss).toBe('effect');
  });

  const seat = (n: 1 | 2, player: string, outOrder: number | null): PlacementSeat => ({ seat: n, player, name: `P${n}`, cause: null, outOrder, outTurn: outOrder ? 7 : null, timeUsedMs: 0, timeouts: 0, disconnectedMs: 0 });
  const st = (result: GameState['result'], lost: Record<string, string>): GameState => ({
    result, players: ['p1', 'p2'].map((id) => ({ id, hasLost: id in lost, lostReason: lost[id], conceded: false })),
  }) as unknown as GameState;

  it('a win: the winner 1st, the loser 2nd with the engine\'s reason', () => {
    const out = defaultPlacements(st({ winner: 'p2', reason: 'x' }, { p1: 'has 0 or less life' }), [seat(1, 'p1', 1), seat(2, 'p2', null)]);
    expect(out.map((p) => [p.seat, p.place, p.loss, p.outTurn])).toEqual([[1, 2, 'life', 7], [2, 1, null, null]]);
  });

  it('a draw (CR 104.4a): both share the 1st place with loss "draw"', () => {
    const out = defaultPlacements(st({ winner: null, reason: 'all players lost simultaneously' }, { p1: 'has 0 or less life', p2: 'has 0 or less life' }), [seat(1, 'p1', 1), seat(2, 'p2', 1)]);
    expect(out.map((p) => [p.seat, p.place, p.loss])).toEqual([[1, 1, 'draw'], [2, 1, 'draw']]);
  });
});
