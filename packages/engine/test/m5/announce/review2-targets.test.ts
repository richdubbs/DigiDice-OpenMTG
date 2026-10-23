/**
 * WP7 review 2, targets: computed quantities in `divide` / `groupLimit` are not offered instead of crashing the engine (CR 601.2c-d, 115.1); only targets that can
 * still be completed are offered (CR 601.2c, 115.3); phased-out permanents don't exist for targeting (CR 702.26b); the announcement helpers keep the arities the
 * triggers (WP8) call (design 8.2.7: "the same functions").
 */
import { describe, expect, it } from 'vitest';
import type { EffectProgram, ObjectId, PlayerId, TargetChoice } from '../../../src/index';
import { legalActions, type GameState } from '../../../src/index';
import { chooseModes, chooseTargets, effectivePrograms, unsupportedForms } from '../../../src/actions/announce';
import { Game } from '../../../src/core/game';
import { cloneState } from '../../../src/util/clone';
import { targetSpecForms } from '../../../src/model/forms';
import { targetOptions } from '../../../src/rules/targets';
import { answer, find, legal, reject, scenario } from '../helpers';
import { castCard, objectTarget, spec, spell } from './support';

const board = (hand: string[], defs: ReturnType<typeof spell>[]): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant', 'Serra Angel'], {
    p1: { hand, battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Grizzly Bears'] },
    p2: { battlefield: ['Hill Giant'] },
    defs,
  });
const bears = (s: GameState) => find(s, 'Grizzly Bears', 'battlefield');
const giant = (s: GameState) => find(s, 'Hill Giant', 'battlefield');

const computed = { q: 'count' as const, of: { ref: 'each' as const, filter: { types: ['Creature' as const] } } };
/** cloud std-tdm: a count of permanents is read when the division is announced (actions/announce-targets.ts#withFixedCounts); a life total is not. */
const unreadTotal = { q: 'life' as const, of: { ref: 'you' as const } };

describe('CR 601.2d, 115.1: a computed quantity in divide.total or groupLimit.cmp.value is a missing capability, not a crash', () => {
  const divided = spell('Test Divide Computed', '{R}', [spec({ kind: 'objectOrPlayer', min: 1, max: 3, text: 'up to three targets', divide: { what: 'damage', total: unreadTotal } })]);
  const limited = spell('Test Limit Computed', '{R}', [spec({ min: 0, max: 'any', text: 'creatures with total power at most the creature count', groupLimit: { stat: 'power', cmp: { op: '<=', value: computed } } })]);

  it('the forms name feature:count.quantity for both fields (so the degrade pass keeps such a card manual)', () => {
    expect(targetSpecForms(spec({ kind: 'objectOrPlayer', divide: { what: 'damage', total: unreadTotal } }))).toContain('feature:count.quantity');
    // cloud std-tdm (CR 601.2d, 603.3d): "where X is the number of lands you control" is counted as the division is announced
    expect(targetSpecForms(spec({ kind: 'objectOrPlayer', divide: { what: 'damage', total: computed } }))).not.toContain('feature:count.quantity');
    expect(targetSpecForms(spec({ groupLimit: { stat: 'power', cmp: { op: '<=', value: computed } } }))).toContain('feature:count.quantity');
    expect(targetSpecForms(spec({ divide: { what: 'damage', total: { q: 'X' } }, groupLimit: { stat: 'power', cmp: { op: '<=', value: { q: 'X' } } } }))).not.toContain('feature:count.quantity');
  });

  it('a computed divide total: legalActions does not throw, the spell is not offered, a cast request is refused with the reason', () => {
    const s = board(['Test Divide Computed'], [divided]);
    expect(() => legalActions(s, 'p1')).not.toThrow();
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Divide Computed', 'hand') }).message).toContain("can't announce part of this yet");
  });

  it('a computed group limit (even with min 0, where it used to crash later when targets were chosen): not offered', () => {
    const s = board(['Test Limit Computed'], [limited]);
    expect(() => legalActions(s, 'p1')).not.toThrow();
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    expect(unsupportedForms({ targets: [spec({ min: 0, max: 'any', groupLimit: { stat: 'power', cmp: { op: '<=', value: computed } } })], steps: [] })).toEqual(['feature:count.quantity']);
  });

  it('X as the divide total or the limit is still read (the announced X)', () => {
    const byX = spell('Test Divide X', '{X}{R}', [spec({ kind: 'objectOrPlayer', min: 0, max: 2, text: 'up to two targets', divide: { what: 'damage', total: { q: 'X' } } })], { type: 'Sorcery' });
    const s = board(['Test Divide X'], [byX]);
    expect(legal(s, 'p1', 'cast')).toHaveLength(1);
  });
});

describe('CR 601.2c, 115.3: only targets that leave the rest of the targets satisfiable are offered', () => {
  const picky = spell('Test Picky Two', '{R}', [spec({ id: 't0' }), spec({ id: 't1', filter: { types: ['Creature'], power: { op: '>=', value: 3 } }, distinctFrom: ['t0'], text: 'another creature with power 3 or more' })]);

  it('t0 may be the Bears or the Giant, but the Giant would leave nothing for t1: it is not offered (it used to be offered and then refused)', () => {
    let s = castCard(board(['Test Picky Two'], [picky]), 'Test Picky Two');
    expect((s.pending as unknown as { objects: string[] }).objects).toEqual([bears(s)]);
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: [giant(s)] });
  });

  it('a controller reference to an earlier target filters the earlier choice the same way', () => {
    const owner = spell('Test Owner Pair', '{R}', [
      spec({ id: 't0' }),
      spec({ id: 't1', kind: 'player', filter: undefined, players: { who: { ref: 'controllerOf', object: { ref: 'target', id: 't0' } } }, text: 'target player who controls it' }),
    ]);
    const s = castCard(board(['Test Owner Pair'], [owner]), 'Test Owner Pair');
    expect((s.pending as unknown as { objects: string[] }).objects.sort()).toEqual([bears(s), giant(s)].sort()); // both have a controller who can be targeted
  });
});

describe('CR 702.26b: a phased-out permanent is treated as though it does not exist', () => {
  it('it is not a legal target and not a candidate for a cost', () => {
    const s = board(['Test Poke Phase'], [spell('Test Poke Phase', '{R}', [spec({})])]);
    s.objects[giant(s)]!.phasedOut = true;
    const opts = targetOptions(s, spec({}), 'p1', find(s, 'Test Poke Phase', 'hand'));
    expect(opts.objects).toEqual([bears(s)]);
  });
});

describe('design 8.2.7: triggered abilities announce with the same functions — the arities WP8 calls keep working', () => {
  it('the exact shape of the TriggerAnnouncer of WP8 (triggers/wiring.ts) is still assignable (a compile-time check: typecheck covers the tests)', () => {
    interface TriggerAnnouncer {
      chooseModes(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string): number[] | undefined;
      chooseTargets(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, x: number): TargetChoice[][];
      effectivePrograms(programs: EffectProgram[], modes: number[] | undefined): EffectProgram[];
    }
    const announcer: TriggerAnnouncer = { chooseModes, chooseTargets, effectivePrograms };
    expect(Object.keys(announcer)).toEqual(['chooseModes', 'chooseTargets', 'effectivePrograms']);
  });

  it('chooseModes(g, player, programs, source, stack, what) works without an announcement environment', () => {
    const s = board([], []);
    const modal: EffectProgram = { targets: [], steps: [], modes: { min: 1, max: 1, options: [{ text: 'a', program: { targets: [], steps: [] } }, { text: 'b', program: { targets: [], steps: [] } }] } };
    const g = new Game(cloneState(s), [{ kind: 'chooseOption', ids: ['1'] }]);
    expect(chooseModes(g, 'p1', [modal], bears(s), bears(s), 'a trigger')).toEqual([1]);
  });

  it('chooseTargets(..., what, x: number) still returns one list per spec', () => {
    const s = board([], []);
    const program: EffectProgram = { targets: [spec({ id: 't0', filter: { types: ['Creature'], controller: 'opponent' } })], steps: [] };
    const g = new Game(cloneState(s), [{ kind: 'chooseTargets', targets: [objectTarget(giant(s))] }]);
    const out: TargetChoice[][] = chooseTargets(g, 'p1', [program], bears(s), bears(s), 'a trigger', 0);
    expect(out).toEqual([[objectTarget(giant(s))]]);
  });

  it('a trigger spec with a division is refused loudly through the old shape instead of losing the division', () => {
    const s = board([], []);
    const program: EffectProgram = { targets: [spec({ id: 't0', min: 1, max: 2, divide: { what: 'damage', total: 3 } })], steps: [] };
    const g = new Game(cloneState(s), [{ kind: 'chooseTargets', targets: [objectTarget(giant(s))] }]);
    expect(() => chooseTargets(g, 'p1', [program], bears(s), bears(s), 'a trigger', 0)).toThrow(/division/);
  });
});
