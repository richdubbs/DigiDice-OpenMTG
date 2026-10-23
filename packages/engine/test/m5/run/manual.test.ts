/**
 * WP10, effects/manual.ts and guard G11 (design 8.9, 10.1, 10.5): manual steps in the middle of a resolution, steps the engine has no handler for (never
 * skipped: their players resolve them by hand), the context a manual prompt shows (bound names, sentences done, the reason), reminder chips, the step budget
 * (design 8.8 rule 6) and an ability whose definition can't be found.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, EffectStep, GameState, ManualResolveDecision } from '../../../src/index';
import { STEP_BUDGET } from '../../../src/effects/run';
import { answer, byHand, castAuto, drainManual, find, instant, logHas, mark, passBoth, pendingOf, putOnStack, scenario, synth, withFakes, withoutHandlers } from './helpers';

const cast = (s: GameState, name: string): GameState => passBoth(castAuto(s, name));
const decision = (s: GameState): ManualResolveDecision => {
  if (s.pending?.kind !== 'manualResolve') throw new Error(`expected manualResolve, got ${s.pending?.kind}`);
  return s.pending;
};

describe('guard G11: a step without a handler is resolved by hand, never skipped', () => {
  it('steps without spans stand for the text of their ability: one prompt for the run of them', () => withoutHandlers(['tap', 'untap'], () => {
    const card = instant('Test Unhandled', { steps: [{ op: 'tap', what: { ref: 'each', filter: { types: ['Creature'] } } }, { op: 'untap', what: { ref: 'self' } }] }, 'Tap all creatures, then untap this.');
    const s = cast(scenario([], { p1: { hand: ['Test Unhandled'] }, defs: [card] }), 'Test Unhandled');
    expect(decision(s)).toMatchObject({ player: 'p1', sourceName: 'Test Unhandled', text: 'Tap all creatures, then untap this.', reason: 'the engine cannot perform this step yet (tap, untap)' });
    expect(pendingOf(byHand(s))).toBe('p1 priority');
  }));

  it('steps with their own sentences: the sentences; a step the engine can run splits the run in two prompts', () => withoutHandlers(['tap', 'untap'], () => withFakes(() => {
    const steps: EffectStep[] = [
      { op: 'tap', what: { ref: 'self' }, span: 'Tap it.' }, { op: 'untap', what: { ref: 'self' }, span: 'Untap it.' },
      { op: 'draw', who: { ref: 'you' }, count: 1, span: 'Draw a card.' },
      { op: 'tap', what: { ref: 'self' }, span: 'Tap it again.' },
    ];
    const { seen } = drainManual(cast(scenario([], { p1: { hand: ['Test Spans'] }, defs: [instant('Test Spans', { steps })] }), 'Test Spans'));
    expect(seen).toEqual(['Tap it. Untap it.', 'Tap it again.']);
  })));

  it('a manual ability of an instant is resolved by hand where it is printed, after the spell ability before it (CR 608.2c)', () => {
    const card = synth({ name: 'Test Mixed', cost: '{0}', type: 'Instant', abilities: [
      { kind: 'spell', text: 'First.', effect: { targets: [], steps: [mark('first')] } },
      { kind: 'manual', text: 'Something the compiler did not understand.', reason: 'no template', shape: 'spell' },
    ] });
    const { seen } = drainManual(cast(scenario([], { p1: { hand: ['Test Mixed'] }, defs: [card] }), 'Test Mixed'));
    expect(seen).toEqual(['first', 'Something the compiler did not understand.']);
  });
});

describe('design 10.5: what a manual prompt shows', () => {
  const card = (): CardDef => instant('Test Context', {
    steps: [
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 1, max: 1, as: 'it', span: 'Choose a creature.' },
      mark('Exile it until this leaves the battlefield.', { reason: 'no template for "until"' }),
    ],
  });

  it('the names bound so far with what they stand for, the sentences already done and the reason', () => {
    const s = cast(scenario(['Grizzly Bears'], { p1: { hand: ['Test Context'], battlefield: ['Grizzly Bears'] }, defs: [card()] }), 'Test Context');
    expect(decision(s)).toMatchObject({
      text: 'Exile it until this leaves the battlefield.', reason: 'no template for "until"', bound: [{ name: 'it', objects: ['Grizzly Bears'] }], done: ['Choose a creature.'],
      prompt: 'Resolve Test Context by hand: Exile it until this leaves the battlefield.',
    });
    expect(decision(s).resolvingId).toBe(find(s, 'Test Context', 'stack'));
  });

  it('a card the deciding player may not see is not named (CR 400.2)', () => {
    const peek = instant('Test Peek', {
      steps: [
        { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', controller: 'opponent' } }, min: 1, max: 1, random: true, as: 'card' },
        mark('Look at it.'),
      ],
    });
    const s = cast(scenario(['Grizzly Bears'], { p1: { hand: ['Test Peek'] }, p2: { hand: ['Grizzly Bears'] }, defs: [peek] }), 'Test Peek');
    expect(decision(s).bound).toEqual([{ name: 'card', objects: ['a card'] }]);
  });

  it('the manual operations of the answer are applied and logged at level manual', () => {
    let s = cast(scenario(['Grizzly Bears'], { p1: { hand: ['Test Context'], battlefield: ['Grizzly Bears'] }, defs: [card()] }), 'Test Context');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = byHand(s, [{ op: 'move', object: bears, to: 'exile' }]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Grizzly Bears');
    expect(logHas(s, /moves Grizzly Bears to exile by hand/)).toBe(true);
  });

  it('a manual shield leaves a reminder chip with its duration after the answer', () => {
    const shield = instant('Test Shield', { steps: [mark('If it would die this turn, exile it instead.', { reminder: { d: 'endOfTurn' } })] });
    let s = cast(scenario([], { p1: { hand: ['Test Shield'] }, defs: [shield] }), 'Test Shield');
    expect(decision(s).reminder).toEqual({ d: 'endOfTurn' });
    s = byHand(s);
    expect(s.reminders).toEqual([expect.objectContaining({ text: 'If it would die this turn, exile it instead.', sourceName: 'Test Shield', controller: 'p1', until: { d: 'endOfTurn' }, createdTurn: 1 })]);
  });
});

describe('design 8.8 rule 6: the step budget', () => {
  it(`a resolution that executes more than ${STEP_BUDGET} steps stops and its controller finishes it by hand (reason "budget")`, () => {
    const loop = instant('Test Loop', { steps: [{ op: 'repeat', times: STEP_BUDGET * 2, do: [{ op: 'let', name: 'x', value: 1 }] }, mark('never reached')] });
    let s = cast(scenario([], { p1: { hand: ['Test Loop'] }, defs: [loop] }), 'Test Loop');
    expect(decision(s)).toMatchObject({ reason: 'budget' });
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 priority');
    expect(logHas(s, /executed more than 10000 steps/, 'CR 608.2c')).toBe(true);
  });
});

describe('an ability whose definition the engine can\'t find is resolved by hand, not dropped', () => {
  it('a manualResolve names the source', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    putOnStack(s0, { name: 'Grizzly Bears', kind: 'activated' });
    const s = passBoth(s0);
    expect(decision(s)).toMatchObject({ sourceName: 'Grizzly Bears', reason: 'ability not found' });
    expect(pendingOf(answer(s, { kind: 'manualResolve', ops: [] }))).toBe('p1 priority');
    expect(s.zones.stack).toHaveLength(1);
  });
});
