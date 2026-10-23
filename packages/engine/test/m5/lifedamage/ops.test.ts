/**
 * One scenario per WP12 op (design 8.7: damage, gainLife, loseLife, setLife, fight, putCounters, removeCounters, moveCounters), each step run by its real
 * handler on a spell or ability put on the stack by hand, with the WP11 pipeline faked (pipeline.ts): what each handler PROPOSES is pinned, and the fake
 * performer shows the result milestone 4's primitives give.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeedDecision } from '../../../src/core/errors';
import type { Decision, EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { bind, chosenObject, chosenPlayer, ctxOn, handle, moveTo } from '../eval/helpers';
import { find, lifeOf, poisonOf, scenario } from '../helpers';
import { rebase } from '../../../src/effects/refs';
import { pipeline } from './pipeline';
import { putOnStack, runOne, runStep } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

function board(): GameState {
  return scenario(['Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Craw Wurm', 'Mountain', 'Prodigal Pyromancer'], {
    p1: { hand: ['Lightning Bolt'], battlefield: ['Craw Wurm', 'Mountain', { name: 'Prodigal Pyromancer', counters: { '+1/+1': 2, charge: 1 } }] },
    p2: { battlefield: ['Grizzly Bears', { name: 'Hill Giant', counters: { '+1/+1': 3 } }] },
  });
}

const anyTarget = (id = 't0', max = 1): TargetSpec => ({ id, kind: 'anyTarget', min: 1, max, text: 'any target' });
const creatureTarget = (id = 't0'): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } });
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const BOLT = { name: 'Lightning Bolt' };

/** Run `fn` and return the decision it asks for (the re-execution model: no answer yet throws NeedDecision). */
function decisionOf(fn: () => unknown): Decision {
  try {
    fn();
  } catch (e) {
    if (e instanceof NeedDecision) return e.decision;
    throw e;
  }
  throw new Error('no decision was asked');
}

describe('damage (CR 120)', () => {
  it('CR 120.2b, 608.2f: "deals 1 damage to each creature" proposes one noncombat damage event per creature', () => {
    const s = board();
    const { state, result } = runStep(s, BOLT, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', filter: { types: ['Creature'] } }, amount: 1 }]));
    expect(pipeline.proposals).toHaveLength(4);
    expect(pipeline.proposals.every((p) => p.ev === 'damage' && p.amount === 1 && !p.combat)).toBe(true);
    expect(state.objects[find(s, 'Grizzly Bears', 'battlefield')]!.damage).toBe(1);
    expect(result).toMatchObject({ performed: true, count: 4 });
  });

  it('"deals 2 damage to each opponent": players, through rules/damage.ts (CR 120.3a)', () => {
    const { state } = runStep(board(), BOLT, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', who: 'opponent' }, amount: 2 }]));
    expect([lifeOf(state, 'p1'), lifeOf(state, 'p2')]).toEqual([20, 18]);
  });

  it('CR 107.1b: an amount that computes to less than 0 is 0, and 0 damage is no event (CR 120.8)', () => {
    const { result } = runStep(board(), { ...BOLT, targets: [[chosenPlayer('p2')]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: { q: 'math', op: '-', args: [1, 5] } }], [anyTarget()]));
    expect(result).toMatchObject({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
  });

  it('"can\'t be prevented" is carried to the pipeline (CR 615.12)', () => {
    runStep(board(), { ...BOLT, targets: [[chosenPlayer('p2')]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2, unpreventable: true }], [anyTarget()]));
    expect(pipeline.proposals[0]).toMatchObject({ ev: 'damage', unpreventable: true });
  });

  it('CR 615.6: damage the pipeline prevents is not counted as dealt', () => {
    pipeline.veto = (e) => e.ev === 'damage';
    const { state, result } = runStep(board(), { ...BOLT, targets: [[chosenPlayer('p2')]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3, as: 'hit' }], [anyTarget()]));
    expect(result).toMatchObject({ performed: false, count: 0 });
    expect(lifeOf(state, 'p2')).toBe(20);
  });

  it('CR 113.7a, 608.2h: an ability whose source has left deals damage as that source (last known information)', () => {
    const s = board();
    const pyro = find(s, 'Prodigal Pyromancer', 'battlefield');
    const state = structuredClone(s);
    const id = putOnStack(state, { name: 'Prodigal Pyromancer', kind: 'activated', sourceId: pyro, targets: [[chosenPlayer('p2')]] });
    const program = prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 1 }], [anyTarget()]);
    const cx = ctxOn(state, id, program);
    moveTo(cx, pyro, 'graveyard');
    expect(runOne(cx, program.steps[0]!)).toMatchObject({ performed: true, count: 1 });
    expect(pipeline.proposals[0]).toMatchObject({ ev: 'damage', source: { id: pyro, zone: 'battlefield' }, to: 'p2', amount: 1 });
    expect(lifeOf(state, 'p2')).toBe(19);
    expect(state.log.some((l) => /Prodigal Pyromancer deals 1 damage to Bob/.test(l.text))).toBe(true);
  });

  it('`as` binds what was dealt damage, for a later "that creature" (design 2.3)', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { cx } = runStep(s, { ...BOLT, targets: [[chosenObject(bears)]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2, as: 'hit' }], [anyTarget()]));
    expect(cx.bindings.get('hit')?.objects).toEqual([{ id: bears, zone: 'battlefield' }]);
  });

  it('evenlyRoundUp: 5 damage divided evenly, rounded up, between two targets is 3 each', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    runStep(s, { ...BOLT, targets: [[chosenObject(bears), chosenPlayer('p2')]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 5, divided: 'evenlyRoundUp' }], [anyTarget('t0', 2)]));
    expect(pipeline.proposals.map((p) => p.ev === 'damage' && p.amount)).toEqual([3, 3]);
  });

  it('never guesses: an "announced" division with no announced amounts for two targets goes to the players (manual)', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { result } = runStep(s, { ...BOLT, targets: [[chosenObject(bears), chosenPlayer('p2')]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2, divided: 'announced' }], [anyTarget('t0', 2)]));
    expect(result.performed).toBe(false);
    expect(pipeline.proposals).toEqual([]);
    expect(pipeline.manual).toHaveLength(1);
  });

  it('CR 601.2c, 601.2d: "divided as you choose among any number of targets" cast with zero targets deals no damage and asks nothing (Rolling Thunder)', () => {
    const spec: TargetSpec = { ...anyTarget('t0'), min: 0, max: 'any', divide: { what: 'damage', total: 3 } };
    const { result } = runStep(board(), { ...BOLT, targets: [[]] }, prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3, divided: 'announced' }], [spec]));
    expect(result).toMatchObject({ performed: false, count: 0 });
    expect(pipeline.manual).toEqual([]);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('gainLife, loseLife (CR 119.3)', () => {
  it('"You gain 3 life"', () => {
    const { state, result } = runStep(board(), BOLT, prog([{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }]));
    expect(lifeOf(state, 'p1')).toBe(23);
    expect(result).toMatchObject({ performed: true, count: 1 }); // one player gained life (design 8.3)
    expect(pipeline.proposals).toEqual([{ ev: 'life', change: 'gain', player: 'p1', amount: 3 }]);
  });

  it('CR 101.4, 608.2e: "Each player loses 2 life" proposes in APNAP order', () => {
    const { state } = runStep(board(), BOLT, prog([{ op: 'loseLife', who: { ref: 'each', who: 'player' }, amount: 2 }]));
    expect(pipeline.proposals.map((p) => p.ev === 'life' && p.player)).toEqual(['p1', 'p2']);
    expect([lifeOf(state, 'p1'), lifeOf(state, 'p2')]).toEqual([18, 18]);
  });

  it('CR 608.2b (Sorin\'s Thirst): life equal to something about an illegal target fails to determine: no life is gained', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const state = structuredClone(s);
    const id = putOnStack(state, { ...BOLT, targets: [[chosenObject(bears)]] });
    const program = prog([{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'toughness', of: { ref: 'target', id: 't0' } } }], [creatureTarget()]);
    moveTo(ctxOn(state, id, program), bears, 'hand');
    const cx = ctxOn(state, id, program); // the legality check is made when resolution begins
    expect(runOne(cx, program.steps[0]!)).toMatchObject({ performed: false, count: 0 });
    expect(lifeOf(state, 'p1')).toBe(20);
  });

  it('life the pipeline stops (a "can\'t gain life" effect, CR 119.7) is not counted', () => {
    pipeline.veto = (e) => e.ev === 'life';
    const { result } = runStep(board(), BOLT, prog([{ op: 'gainLife', who: { ref: 'you' }, amount: 4 }]));
    expect(result).toMatchObject({ performed: false, count: 0 });
  });
});

describe('setLife (CR 119.5)', () => {
  const setTo = (value: number, life?: number) => {
    const s = board();
    if (life !== undefined) s.players[1]!.life = life;
    return runStep(s, { ...BOLT, targets: [[chosenPlayer('p2')]] }, prog([{ op: 'setLife', who: { ref: 'target', id: 't0' }, value }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]));
  };

  it('CR 119.5: a player at 20 whose life total becomes 10 LOSES 10 life', () => {
    const { state, result } = setTo(10);
    expect(pipeline.proposals).toEqual([{ ev: 'life', change: 'loss', player: 'p2', amount: 10 }]);
    expect(lifeOf(state, 'p2')).toBe(10);
    expect(result).toMatchObject({ performed: true, count: 1 });
  });

  it('CR 119.5: a player at 5 whose life total becomes 10 GAINS 5 life', () => {
    setTo(10, 5);
    expect(pipeline.proposals).toEqual([{ ev: 'life', change: 'gain', player: 'p2', amount: 5 }]);
  });

  it('setting a life total to what it already is changes nothing', () => {
    expect(setTo(20).result).toMatchObject({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
  });

  it('CR 107.1b: a life total may be set to a negative number', () => {
    const { state } = setTo(-3);
    expect(lifeOf(state, 'p2')).toBe(-3);
  });
});

describe('fight (CR 701.14)', () => {
  const fightProgram = prog([{ op: 'fight', a: { ref: 'target', id: 't0' }, b: { ref: 'target', id: 't1' } }], [creatureTarget('t0'), creatureTarget('t1')]);

  it('CR 701.14a, 701.14d: each deals noncombat damage equal to its power to the other', () => {
    const s = board();
    const [wurm, giant] = [find(s, 'Craw Wurm', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const { state, result } = runStep(s, { ...BOLT, targets: [[chosenObject(wurm)], [chosenObject(giant)]] }, fightProgram);
    expect(state.objects[giant]!.damage).toBe(6);
    expect(state.objects[wurm]!.damage).toBe(6); // Hill Giant with three +1/+1 counters has power 6 (CR 613.4c)
    expect(pipeline.proposals.every((p) => p.ev === 'damage' && !p.combat)).toBe(true);
    expect(result).toMatchObject({ performed: true, count: 2 }); // the two creatures that fought
  });

  it('CR 701.14b: if one creature is an illegal target (it left), neither fights or deals damage', () => {
    const s = board();
    const [wurm, giant] = [find(s, 'Craw Wurm', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const state = structuredClone(s);
    const id = putOnStack(state, { ...BOLT, targets: [[chosenObject(wurm)], [chosenObject(giant)]] });
    moveTo(ctxOn(state, id, fightProgram), giant, 'hand');
    const cx = ctxOn(state, id, fightProgram);
    expect(runOne(cx, fightProgram.steps[0]!)).toMatchObject({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
    expect(state.log.some((l) => l.rules?.includes('CR 701.14b'))).toBe(true);
  });

  it('CR 701.14b: a creature that is no longer a creature does not fight', () => {
    const s = board();
    const [wurm, mountain] = [find(s, 'Craw Wurm', 'battlefield'), find(s, 'Mountain', 'battlefield')];
    const program = prog([{ op: 'fight', a: { ref: 'target', id: 't0' }, b: { ref: 'bound', name: 'land' } }], [creatureTarget('t0')]);
    const state = structuredClone(s);
    const id = putOnStack(state, { ...BOLT, targets: [[chosenObject(wurm)]] });
    const cx = ctxOn(state, id, program);
    bind(cx, 'land', [handle(state, mountain)]);
    expect(runOne(cx, program.steps[0]!).performed).toBe(false);
    expect(pipeline.proposals).toEqual([]);
  });

  it('CR 701.14c: a creature that fights itself is dealt damage equal to twice its power', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { state } = runStep(s, { ...BOLT, targets: [[chosenObject(bears)], [chosenObject(bears)]] }, fightProgram);
    expect(pipeline.proposals).toEqual([{ ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: { id: bears, zone: 'battlefield' }, amount: 4, combat: false, unpreventable: false }]);
    expect(state.objects[bears]!.damage).toBe(4);
  });
});

describe('putCounters (CR 122.1, 122.6)', () => {
  it('"Put two +1/+1 counters on target creature"', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { state, result } = runStep(s, { ...BOLT, targets: [[chosenObject(bears)]] }, prog([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 2 }], [creatureTarget()]));
    expect(state.objects[bears]!.counters).toEqual({ '+1/+1': 2 });
    expect(result).toMatchObject({ performed: true, count: 1 }); // one object got counters (design 8.3)
    expect(pipeline.proposals).toEqual([{ ev: 'counters', change: 'put', on: { id: bears, zone: 'battlefield' }, kind: '+1/+1', count: 2, by: 'p1' }]); // FAST5X E21: the controller of the effect puts them (CR 122.6)
  });

  it('CR 122.1f: counters on a player (poison)', () => {
    const { state } = runStep(board(), { ...BOLT, targets: [[chosenPlayer('p2')]] }, prog([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: 'poison', count: 3 }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]));
    expect(poisonOf(state, 'p2')).toBe(3);
  });

  it('"a +1/+1 counter on each creature you control": one event per creature', () => {
    runStep(board(), BOLT, prog([{ op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: '+1/+1', count: 1 }]));
    expect(pipeline.proposals).toHaveLength(2);
  });

  it('zero counters is no event', () => {
    expect(runStep(board(), BOLT, prog([{ op: 'putCounters', on: { ref: 'you' }, kind: 'energy', count: 0 }])).result.performed).toBe(false);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('removeCounters (CR 122.1)', () => {
  const remove = (step: Omit<Extract<EffectStep, { op: 'removeCounters' }>, 'op' | 'from'>, who = 'Hill Giant', answers: Parameters<typeof runStep>[3] = []) => {
    const s = board();
    const id = find(s, who, 'battlefield');
    return { ...runStep(s, { ...BOLT, targets: [[chosenObject(id)]] }, prog([{ op: 'removeCounters', from: { ref: 'target', id: 't0' }, ...step }], [creatureTarget()]), answers), id };
  };

  it('"Remove a +1/+1 counter from target creature"', () => {
    const { state, id, result } = remove({ kind: '+1/+1', count: 1 });
    expect(state.objects[id]!.counters).toEqual({ '+1/+1': 2 });
    expect(result).toMatchObject({ performed: true, count: 1 });
  });

  it('CR 122.1: counters that are not there can\'t be removed: "remove five" from a creature with three removes three', () => {
    const { state, id, result } = remove({ kind: '+1/+1', count: 5 });
    expect(state.objects[id]!.counters).toEqual({});
    expect(result).toMatchObject({ performed: true, count: 1 });
    expect(pipeline.proposals).toEqual([expect.objectContaining({ change: 'removed', kind: '+1/+1', count: 3 })]);
  });

  it('"Remove all counters from target creature" removes every kind', () => {
    const { state, id, result } = remove({ kind: 'any', count: 'all' }, 'Prodigal Pyromancer');
    expect(state.objects[id]!.counters).toEqual({});
    expect(result).toMatchObject({ performed: true, count: 1 });
  });

  it('CR 608.2d: "remove a counter" from a permanent with two kinds asks which kind, before anything is removed', () => {
    const d = decisionOf(() => remove({ kind: 'any', count: 1 }, 'Prodigal Pyromancer'));
    expect(d).toMatchObject({ kind: 'chooseOption', player: 'p1', min: 1, max: 1 });
    expect((d as Extract<Decision, { kind: 'chooseOption' }>).options.map((o) => o.id)).toEqual(['+1/+1', 'charge']);
    expect(pipeline.proposals).toEqual([]);
    const { state, id } = remove({ kind: 'any', count: 1 }, 'Prodigal Pyromancer', [{ kind: 'chooseOption', ids: ['charge'] }]);
    expect(state.objects[id]!.counters).toEqual({ '+1/+1': 2 });
  });

  it('with a single kind there is nothing to choose', () => {
    const { state, id } = remove({ kind: 'any', count: 1 });
    expect(state.objects[id]!.counters).toEqual({ '+1/+1': 2 });
  });

  it('counter names are data: a kind named like an object member ("toString") is simply absent', () => {
    expect(remove({ kind: 'toString', count: 1 }).result).toMatchObject({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('moveCounters (CR 122, 122.8)', () => {
  const MOVE = (count: number | 'all') => prog([{ op: 'moveCounters', from: { ref: 'target', id: 't0' }, to: { ref: 'target', id: 't1' }, kind: '+1/+1', count }], [creatureTarget('t0'), creatureTarget('t1')]);

  it('"Move two +1/+1 counters from one target creature onto another": removed from the first, put on the second', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const { state, result } = runStep(s, { ...BOLT, targets: [[chosenObject(giant)], [chosenObject(bears)]] }, MOVE(2));
    expect([state.objects[giant]!.counters['+1/+1'], state.objects[bears]!.counters['+1/+1']]).toEqual([1, 2]);
    expect(pipeline.proposals.map((p) => p.ev === 'counters' && p.change)).toEqual(['removed', 'put']);
    expect(result).toMatchObject({ performed: true, count: 1 }); // one object got the counters
  });

  it('"all": moves as many as there are', () => {
    const s = board();
    const [giant, bears] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    const { state } = runStep(s, { ...BOLT, targets: [[chosenObject(giant)], [chosenObject(bears)]] }, MOVE('all'));
    expect([state.objects[giant]!.counters['+1/+1'], state.objects[bears]!.counters['+1/+1']]).toEqual([undefined, 3]);
  });

  const leftProgram = prog([{ op: 'moveCounters', from: { ref: 'bound', name: 'gone' }, to: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 'all' }], [creatureTarget('t0')]);
  function afterLeaving(kind: 'spell' | 'triggered') {
    const s = board();
    const [giant, bears, wurm] = [find(s, 'Hill Giant', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Craw Wurm', 'battlefield')];
    const state = structuredClone(s);
    const id = putOnStack(state, kind === 'spell' ? { ...BOLT, targets: [[chosenObject(bears)]] } : { name: 'Craw Wurm', kind, sourceId: wurm, targets: [[chosenObject(bears)]] });
    const cx = ctxOn(state, id, leftProgram);
    bind(cx, 'gone', [handle(state, giant)]);
    const now = moveTo(cx, giant, 'graveyard')!; // an earlier step of this resolution sacrificed it: the binding follows it (CR 400.7j, design 3.1)
    rebase(cx, giant, { id: now, zone: 'graveyard' });
    return { state, bears, result: runOne(cx, leftProgram.steps[0]!) };
  }

  it('CR 122.8: a triggered ability whose effect moved the object off the battlefield, then moves its counters, puts the same number it had', () => {
    const { state, bears, result } = afterLeaving('triggered');
    expect(state.objects[bears]!.counters['+1/+1']).toBe(3);
    expect(pipeline.proposals).toEqual([expect.objectContaining({ ev: 'counters', change: 'put', count: 3 })]); // nothing to remove: the counters ceased to exist (CR 400.7)
    expect(result).toMatchObject({ performed: true, count: 1 });
    expect(state.log.some((l) => l.rules?.includes('CR 122.8'))).toBe(true);
  });

  it('CR 400.7: any other effect can\'t find the object that left, so nothing moves', () => {
    const { result } = afterLeaving('spell');
    expect(result.performed).toBe(false);
    expect(pipeline.proposals).toEqual([]);
  });
});
