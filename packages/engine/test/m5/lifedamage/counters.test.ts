/**
 * The counter rules of CR 122 that need more than one event or more than the stack object: moving is all or nothing (CR 122.5), the counters of an object
 * that left the battlefield are used only when CR 122.8 (triggered abilities that check it left) or CR 122.9 (activated abilities that sacrificed it as a
 * cost) say so, a division of counters announced on casting is honored (CR 601.2d), and every counters action is logged (design 8.6 stage 5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import type { EventContext } from '../../../src/types/state';
import { chosenObject, ctxOn, handle, moveTo } from '../eval/helpers';
import { find, scenario } from '../helpers';
import { pipeline } from './pipeline';
import { putOnStack, runOne, runStep } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

function board(): GameState {
  return scenario(['Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Craw Wurm'], {
    p1: { hand: ['Lightning Bolt'], battlefield: ['Craw Wurm'] },
    p2: { battlefield: ['Grizzly Bears', { name: 'Hill Giant', counters: { '+1/+1': 3 } }] },
  });
}

const creature = (id = 't0', more: Partial<TargetSpec> = {}): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] }, ...more });
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const BOLT = { name: 'Lightning Bolt' };
const counters = (s: GameState, id: string) => s.objects[id]!.counters;

describe('CR 122.5: moving a counter is all or nothing', () => {
  const MOVE = prog([{ op: 'moveCounters', from: { ref: 'target', id: 't0' }, to: { ref: 'target', id: 't1' }, kind: '+1/+1', count: 2 }], [creature('t0'), creature('t1')]);

  it('CR 122.5: if the second object can\'t have counters put on it, no counter is removed from the first', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    pipeline.forbid = (e) => e.ev === 'counters' && e.change === 'put';
    const { state, result } = runStep(s, { ...BOLT, targets: [[chosenObject(giant)], [chosenObject(bears)]] }, MOVE);
    expect(counters(state, giant)).toEqual({ '+1/+1': 3 });
    expect(counters(state, bears)).toEqual({});
    expect(result).toEqual({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
  });

  it('CR 122.5: if the counters can\'t be removed, none is put on the second object', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    pipeline.forbid = (e) => e.ev === 'counters' && e.change === 'removed';
    const { state } = runStep(s, { ...BOLT, targets: [[chosenObject(giant)], [chosenObject(bears)]] }, MOVE);
    expect([counters(state, giant), counters(state, bears)]).toEqual([{ '+1/+1': 3 }, {}]);
  });

  it('CR 122.5: a move is logged with the counters that moved', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const { state, result } = runStep(s, { ...BOLT, targets: [[chosenObject(giant)], [chosenObject(bears)]] }, MOVE);
    expect(result).toEqual({ performed: true, count: 1 });
    expect(state.log.some((l) => l.level === 'action' && l.rules?.includes('CR 122.5') && /2 \+1\/\+1 counters/.test(l.text))).toBe(true);
  });

  it('a move that names more than one object on a side goes to the players (never guesses)', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const program = prog([{ op: 'moveCounters', from: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, to: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 1 }], [creature('t0')]);
    const { result } = runStep(s, { ...BOLT, targets: [[chosenObject(bears)]] }, program);
    expect(result.performed).toBe(false);
    expect(pipeline.manual).toHaveLength(1);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('the counters of an object that left the battlefield (CR 122.5, 122.8, 122.9)', () => {
  /** Hill Giant (three +1/+1 counters) is the source of a triggered ability; `event` is what triggered it. */
  function trigger(event: (s: GameState, giant: string, bears: string) => EventContext, beforeResolving: (s: GameState, giant: string) => void, from: Extract<EffectStep, { op: 'moveCounters' }>['from']) {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const state = structuredClone(s);
    const program = prog([{ op: 'moveCounters', from, to: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 'all' }], [creature('t0')]);
    const id = putOnStack(state, { name: 'Hill Giant', kind: 'triggered', sourceId: giant, targets: [[chosenObject(bears)]], event: event(state, giant, bears) });
    beforeResolving(state, giant);
    const cx = ctxOn(state, id, program);
    return { state, bears, result: runOne(cx, program.steps[0]!) };
  }

  it('CR 122.5, 122.8: graft whose source left in response moves nothing (its trigger condition does not check that it left)', () => {
    const entered = (_s: GameState, _giant: string, bears: string): EventContext => ({ ev: 'zoneChange', roles: { subject: { objects: [{ id: bears, zone: 'battlefield' }] } }, before: {} });
    const { state, bears, result } = trigger(entered, (st, giant) => { moveTo(ctxOn(st, giant), giant, 'hand'); }, { ref: 'self' });
    expect(result).toEqual({ performed: false, count: 0 });
    expect(counters(state, bears)).toEqual({});
    expect(pipeline.proposals).toEqual([]);
  });

  it('CR 122.8: "when this dies, put its +1/+1 counters on target creature" puts the number it had (modular)', () => {
    let died = '';
    const dies = (st: GameState, giant: string): EventContext => {
      const before = { [giant]: { object: structuredClone(st.objects[giant]!), chars: null, leftZone: 'battlefield' as const } };
      died = moveTo(ctxOn(st, giant), giant, 'graveyard')!;
      return { ev: 'zoneChange', roles: { subject: { objects: [{ id: died, zone: 'graveyard' }] } }, before: { [giant]: { ...before[giant]!, newId: died } } };
    };
    const { state, bears, result } = trigger(dies, () => {}, { ref: 'self' });
    expect(counters(state, bears)).toEqual({ '+1/+1': 3 });
    expect(result).toEqual({ performed: true, count: 1 });
    expect(pipeline.proposals).toEqual([expect.objectContaining({ ev: 'counters', change: 'put', count: 3 })]); // nothing to remove: those counters ceased to exist (CR 400.7)
    expect(state.log.some((l) => l.rules?.includes('CR 122.8'))).toBe(true);
  });

  it('CR 122.9: an activated ability whose cost sacrificed the object puts the counters it had (Joraga Peach)', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const state = structuredClone(s);
    const sacrificed = moveTo(ctxOn(state, giant), giant, 'graveyard')!;
    const program = prog([{ op: 'moveCounters', from: { ref: 'self' }, to: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 'all' }], [creature('t0', { min: 0 })]);
    const id = putOnStack(state, { name: 'Hill Giant', kind: 'activated', sourceId: giant, targets: [[chosenObject(bears)]], costsPaid: { costObjects: [sacrificed] } });
    const result = runOne(ctxOn(state, id, program), program.steps[0]!);
    expect(counters(state, bears)).toEqual({ '+1/+1': 3 });
    expect(result.performed).toBe(true);
    expect(state.log.some((l) => l.rules?.includes('CR 122.9'))).toBe(true);
  });

  it('CR 122.5: an activated ability whose source left some other way (not as its cost) moves nothing', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const state = structuredClone(s);
    const program = prog([{ op: 'moveCounters', from: { ref: 'self' }, to: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 'all' }], [creature('t0')]);
    const id = putOnStack(state, { name: 'Hill Giant', kind: 'activated', sourceId: giant, targets: [[chosenObject(bears)]] });
    moveTo(ctxOn(state, giant), giant, 'graveyard');
    expect(runOne(ctxOn(state, id, program), program.steps[0]!)).toEqual({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
    expect(handle(state, bears).zone).toBe('battlefield');
  });
});

describe('CR 601.2d: counters divided among targets on casting', () => {
  const DISTRIBUTE = prog(
    [{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 2 }],
    [creature('t0', { max: 2, text: 'one or two target creatures', divide: { what: 'counters', total: 2 } })],
  );
  function distribute(division: number[] | undefined, bounce?: 'Grizzly Bears') {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const state = structuredClone(s);
    const id = putOnStack(state, { ...BOLT, targets: [[chosenObject(bears), chosenObject(giant)]] });
    if (division) state.objects[id]!.stack!.division = { t0: division };
    if (bounce) moveTo(ctxOn(state, bears), bears, 'hand');
    const result = runOne(ctxOn(state, id, DISTRIBUTE), DISTRIBUTE.steps[0]!);
    return { state, giant, bears, result };
  }

  it('CR 601.2d: "distribute two +1/+1 counters among one or two target creatures" puts the announced share on each', () => {
    const { state, giant, bears, result } = distribute([1, 1]);
    expect([counters(state, bears), counters(state, giant)]).toEqual([{ '+1/+1': 1 }, { '+1/+1': 4 }]);
    expect(result).toEqual({ performed: true, count: 2 });
  });

  it('CR 608.2b: the share of a target that became illegal is lost', () => {
    const { state, giant } = distribute([1, 1], 'Grizzly Bears');
    expect(counters(state, giant)).toEqual({ '+1/+1': 4 });
    expect(pipeline.proposals).toHaveLength(1);
  });

  it('never guesses: a division with no announced amounts for two targets goes to the players', () => {
    const { result } = distribute(undefined);
    expect(result.performed).toBe(false);
    expect(pipeline.manual).toHaveLength(1);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('design 8.6 stage 5: counters actions are logged at level action with their rules', () => {
  it('CR 122.1, 122.6: putting counters', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { state } = runStep(s, { ...BOLT, targets: [[chosenObject(bears)]] }, prog([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 2 }], [creature()]));
    expect(state.log.some((l) => l.level === 'action' && l.rules?.includes('CR 122.6') && /2 \+1\/\+1 counters put on Grizzly Bears/.test(l.text))).toBe(true);
  });

  it('CR 122.1: removing counters', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const { state } = runStep(s, { ...BOLT, targets: [[chosenObject(giant)]] }, prog([{ op: 'removeCounters', from: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 1 }], [creature()]));
    expect(state.log.some((l) => l.level === 'action' && l.rules?.includes('CR 122.1') && /1 \+1\/\+1 counter removed from Hill Giant/.test(l.text))).toBe(true);
  });
});
