/**
 * What a WP12 step reports (`StepResult`, design 8.3) and what one damage step is as an event (CR 120.3f, 702.15e): `count` is the number of objects and
 * players the step ACTUALLY affected (what `as` binds, and what the renderer prints for `{q:'resultCount'}`: "the number of <them>"), measured from what
 * the performers did, so damage prevented by protection or by a shield and life a player can't lose are not counted. The WP11 pipeline is faked
 * (pipeline.ts); its performers call milestone 4's primitives, which apply protection (CR 702.16e) and "can't lose life" (CR 119.8).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { addPlayerRestriction } from '../../../src/rules/restrictions';
import type { EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { chosenObject, chosenPlayer, ctxOn } from '../eval/helpers';
import { find, lifeOf, scenario } from '../helpers';
import { pipeline } from './pipeline';
import { putOnStack, runOne } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const CARDS = ['Lightning Bolt', 'Grizzly Bears', "Galina's Knight", 'Hill Giant', 'Vampire Nighthawk', "Ajani's Pridemate"];

function board(): GameState {
  return scenario(CARDS, {
    p1: { hand: ['Lightning Bolt'], battlefield: ['Vampire Nighthawk', "Ajani's Pridemate"] },
    p2: { battlefield: ['Grizzly Bears', "Galina's Knight", 'Hill Giant'] },
  });
}

const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const OPP_CREATURES: Extract<EffectStep, { op: 'damage' }>['to'] = { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } };
const gainResult = (step: string): EffectStep => ({ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'resultCount', step } });

/** Run every step of `program` on a Lightning Bolt (a red source) put on the stack by hand, or on a white spell (Ajani's Pridemate) with `white`. */
function runBolt(s: GameState, program: EffectProgram, targets: Parameters<typeof putOnStack>[1]['targets'] = [], white = false) {
  const state = structuredClone(s);
  const id = putOnStack(state, { name: white ? "Ajani's Pridemate" : 'Lightning Bolt', targets });
  const cx = ctxOn(state, id, program);
  return { state, cx, results: program.steps.map((st) => runOne(cx, st)) };
}

describe('StepResult.count is the number of recipients actually affected (design 8.3, q:resultCount)', () => {
  it('CR 702.16e: a creature whose damage protection prevents was not dealt damage and is not counted', () => {
    const s = board();
    const knight = find(s, "Galina's Knight", 'battlefield');
    const { state, cx, results } = runBolt(s, prog([{ op: 'damage', source: { ref: 'self' }, to: OPP_CREATURES, amount: 2, as: 'hit' }, gainResult('hit')]));
    expect(state.objects[knight]!.damage).toBe(0); // protection from red
    expect(results[0]).toMatchObject({ performed: true, count: 2 });
    expect(cx.bindings.get('hit')!.objects.map((h) => h.id)).not.toContain(knight);
    expect(lifeOf(state, 'p1')).toBe(22); // "the number of creatures dealt damage this way" is 2, not 3
  });

  it('CR 615.7: damage a prevention shield prevents entirely (the event is modified to 0, then performed) is not counted', () => {
    pipeline.modify = (e) => (e.ev === 'damage' ? { ...e, amount: 0 } : e);
    const { state, results } = runBolt(board(), prog([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3, as: 'hit' }], [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }]), [[chosenPlayer('p2')]]);
    expect(lifeOf(state, 'p2')).toBe(20);
    expect(results[0]).toMatchObject({ performed: false, count: 0 });
  });

  it('CR 119.8: a player who can\'t lose life lost none: not counted, and "if you do" (cond:did) is false', () => {
    const s = board();
    addPlayerRestriction(new Game(s), 'p2', 'cantLoseLife');
    const { state, results } = runBolt(s, prog([{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 3, as: 'drain' }, gainResult('drain')]));
    expect(lifeOf(state, 'p2')).toBe(20);
    expect(results[0]).toMatchObject({ performed: false, count: 0 });
    expect(lifeOf(state, 'p1')).toBe(20);
  });

  it('CR 119.3: "each player loses 2 life" counts the two players', () => {
    const { results } = runBolt(board(), prog([{ op: 'loseLife', who: { ref: 'each', who: 'player' }, amount: 2 }]));
    expect(results[0]).toMatchObject({ performed: true, count: 2 });
  });

  it('CR 701.14a, 702.16e: a fight where one creature\'s damage is prevented still happens; only the damage that was dealt is marked', () => {
    const s = board();
    const [giant, knight] = [find(s, 'Hill Giant', 'battlefield'), find(s, "Galina's Knight", 'battlefield')];
    const creature = (id: string): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } });
    const { state, results } = runBolt(s, prog([{ op: 'fight', a: { ref: 'target', id: 't0' }, b: { ref: 'target', id: 't1' } }], [creature('t0'), creature('t1')]), [[chosenObject(giant)], [chosenObject(knight)]], true); // a white spell: the Knight (protection from red) is a legal target
    expect([state.objects[giant]!.damage, state.objects[knight]!.damage]).toEqual([2, 0]);
    expect(results[0]).toMatchObject({ performed: true, count: 2 }); // the two creatures fought
  });

  it('CR 122.1: counters a holder could not get are not counted', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    pipeline.veto = (e) => e.ev === 'counters' && typeof e.on !== 'string' && e.on.id === bears;
    const { results } = runBolt(s, prog([{ op: 'putCounters', on: OPP_CREATURES, kind: '+1/+1', count: 2 }]));
    expect(results[0]).toMatchObject({ performed: true, count: 2 }); // the Knight and the Giant, not the Bears
  });
});

describe('one damage step is one damage event: lifelink gains life once per source (CR 120.3f, 702.15e)', () => {
  // WP18 review: a lifelink source that is not a meld card (Gisela, the Broken Blade is capped manual by design 12.4 until melding is implemented)
  function gisela(s: GameState) {
    const state = structuredClone(s);
    const source = find(state, 'Vampire Nighthawk', 'battlefield');
    const id = putOnStack(state, { name: 'Vampire Nighthawk', kind: 'activated', sourceId: source });
    const program = prog([{ op: 'damage', source: { ref: 'self' }, to: OPP_CREATURES, amount: 1 }]);
    const cx = ctxOn(state, id, program);
    return { state, cx, result: runOne(cx, program.steps[0]!) };
  }

  it('CR 120.3f, 702.15e: one lifelink source damaging three creatures gains life once (Ajani\'s Pridemate would trigger once)', () => {
    const { state, cx } = gisela(board());
    const gains = cx.g.events.filter((e) => e.type === 'lifeChanged' && e.player === 'p1');
    expect(gains).toEqual([expect.objectContaining({ delta: 3 })]);
    expect(lifeOf(state, 'p1')).toBe(23);
  });

  it('CR 119.7, 120.4c: the lifelink gain goes through the pipeline as a life event, so "can\'t gain life" applies to it', () => {
    pipeline.veto = (e) => e.ev === 'life';
    const { state } = gisela(board());
    expect(pipeline.proposals.filter((p) => p.ev === 'life')).toEqual([{ ev: 'life', change: 'gain', player: 'p1', amount: 3 }]);
    expect(lifeOf(state, 'p1')).toBe(20);
  });
});
