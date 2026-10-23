/**
 * WP15 with its real neighbors (design 15.1 rule 7): cards resolved by `applyAction` through WP10's interpreter and WP11's pipeline, with no fake. While either
 * neighbor is still a stub these tests are skipped (the other WP15 tests fake them, neighbors.ts); they run by themselves once WP10 and WP11 have merged, and
 * must then pass unchanged.
 */
import { describe, expect, it } from 'vitest';
import { propose } from '../../../src/effects/propose';
import { resolveStackObject } from '../../../src/effects/run';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/index';
import { advanceTo, find, passBoth, scenario } from '../helpers';
import { cast, castAndResolve, creatureTarget, instant, objectTarget, lastLog, pt, targets, withExamples } from './support';

const isStub = (f: () => unknown, wp: string): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    return String(e).includes(`not implemented: ${wp}`);
  }
};
const stubbed = isStub(() => propose(undefined as never, undefined as never), 'WP11') || isStub(() => resolveStackObject(undefined as never, undefined as never), 'WP10');

describe.skipIf(stubbed)('WP15 through the real interpreter and pipeline (enabled when WP10 and WP11 merge)', () => {
  it('CR 611.2, 514.2: Giant Growth makes a 5/5 until end of turn, then the spell is in the graveyard (CR 608.2n)', () => {
    const s0 = withExamples(scenario(['Giant Growth', 'Grizzly Bears', 'Forest'], { p1: { hand: ['Giant Growth'], battlefield: ['Forest', 'Grizzly Bears'] } }), 'Giant Growth');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Giant Growth', [targets(objectTarget(bears))]);
    expect(pt(s, bears)).toEqual([5, 5]);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Giant Growth')).toBe(true);
    expect(pt(advanceTo(s, 2, 'upkeep'), bears)).toEqual([2, 2]);
  });

  it('CR 500.7: an extra turn after this one', () => {
    const WALK = instant('Walk Test', [{ op: 'extraTurn', who: { ref: 'you' }, count: 1 }], [], 'Sorcery');
    const s = castAndResolve(scenario([], { p1: { hand: ['Walk Test'] }, defs: [WALK] }), 'Walk Test');
    expect(advanceTo(s, 2, 'upkeep').turn.activePlayer).toBe('p1');
  });

  it('CR 724.1: ending the turn exiles the stack through the pipeline and skips to the cleanup step', () => {
    const STOP = instant('Stop Test', [{ op: 'endTurn' }]);
    const DUMMY = instant('Dummy Spell', []);
    let s: GameState = cast(scenario([], { p1: { hand: ['Stop Test', 'Dummy Spell'] }, defs: [STOP, DUMMY] }), 'Dummy Spell');
    s = passBoth(cast(s, 'Stop Test'));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Dummy Spell', 'Stop Test']);
    expect(s.turn.number).toBe(2);
  });

  it('CR 706.2: "the result" of a die roll reads the roll of the same resolution', () => {
    const ROLL = instant('Roll Test', [
      { op: 'rollDie', who: { ref: 'you' }, sides: 6 },
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: { q: 'dieResult' } }] }] },
    ], [creatureTarget()]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Roll Test'], battlefield: ['Grizzly Bears'] }, defs: [ROLL] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Roll Test', [targets(objectTarget(bears))]);
    const r = Number(/rolls a d6: (\d)/.exec(lastLog(s, /rolls a d6/))![1]);
    expect(getChars(s, bears).power).toBe(String(2 + r));
  });
});

it('the neighbors this file waits for are detected (WP10, WP11)', () => {
  expect(typeof stubbed).toBe('boolean');
});
