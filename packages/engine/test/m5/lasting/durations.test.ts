/**
 * The object form of `Duration` (design 3.7; core/durations.ts and the WP15 edits of core/turn.ts and core/steps.ts): every kind ends exactly when the rules say,
 * for resolved continuous effects, delayed triggers with a stated duration and the chips of manual shields. Each duration is created by an `effect` step of an
 * activated ability of a synthetic "Test Banner" and observed with real turns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import type { ContinuousEffectRec, Duration, GameState } from '../../../src/index';
import { advanceTo, find, pass, passBoth, scenario } from '../helpers';
import { activate, activated, castAndResolve, creatureTarget, instant, objectTarget, permanent, pt, setup, targets } from './support';

vi.mock('../../../src/effects/propose', async (o) => (await import('./neighbors')).proposeMock(await o()));
vi.mock('../../../src/effects/manual', async (o) => (await import('./neighbors')).manualMock(await o()));
vi.mock('../../../src/effects/run', async (o) => (await import('./neighbors')).runMock(await o()));
vi.mock('../../../src/core/resolve', async (o) => (await import('./neighbors')).resolveMock(await o()));

beforeEach(setup);

const DURATIONS: Duration[] = [
  { d: 'whileSource', as: 'onBattlefield' }, // 0 "for as long as ~ remains on the battlefield"
  { d: 'asLongAs', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } } }, // 1 "for as long as you control a Forest"
  { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } }, // 2 "until ~ leaves the battlefield"
  { d: 'untilNextTurn', whose: { ref: 'you' } }, // 3 "until your next turn"
  { d: 'untilNextStep', step: 'end' }, // 4 "until the beginning of the next end step"
  { d: 'endOfCombat' }, // 5 "until end of combat"
  { d: 'untilNextStep', step: 'end', whose: 'opponent' }, // 6 "until the beginning of the next end step of an opponent"
];

const BANNER = permanent('Test Banner', 'Artifact', DURATIONS.map((duration, i) => activated(`Banner ${i}`, {
  targets: [creatureTarget()],
  steps: [{ op: 'effect', duration, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }],
})));

/** "Put target artifact into its owner's graveyard." (the move is WP14's; neighbors.ts fakes it): the source leaving during a real action. */
const SHATTER = instant('Shatter Test', [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'graveyard' } }], [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target artifact', filter: { types: ['Artifact'] } }]);

const board = (): GameState => scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Shatter Test'], battlefield: ['Test Banner', 'Grizzly Bears', 'Forest'] }, defs: [BANNER, SHATTER] });
const records = (s: GameState): ContinuousEffectRec[] => s.continuousEffects;

function moveAway(s: GameState, id: string, to: 'graveyard' | 'hand' = 'graveyard'): GameState {
  const t = structuredClone(s);
  moveObject(new Game(t), id, to, { cause: 'test' });
  return t;
}

/** Activate banner ability `i` targeting the bears and let it resolve. */
function pump(s: GameState, i: number): GameState {
  return passBoth(activate(s, find(s, 'Test Banner', 'battlefield'), i, [targets(objectTarget(find(s, 'Grizzly Bears', 'battlefield')))]));
}

describe('CR 611.2b: "for as long as" (whileSource, asLongAs)', () => {
  it('whileSource: the effect stops applying when the source leaves, and its record is deleted the next time a player would get priority', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = pump(s0, 0);
    expect(pt(s, bears)).toEqual([3, 3]);
    s = moveAway(s, find(s, 'Test Banner', 'battlefield'));
    expect(pt(s, bears)).toEqual([2, 2]); // statics/live.ts: never applied once over
    expect(records(s)).toHaveLength(1);
    s = pass(s);
    expect(records(s)).toEqual([]);
    expect(s.log.some((l) => /"for as long as" duration is over/.test(l.text) && l.rules?.includes('CR 611.2b'))).toBe(true);
  });

  it('whileSource: if the source has left before the ability resolves, the effect never starts', () => {
    const s0 = board();
    const s1 = activate(s0, find(s0, 'Test Banner', 'battlefield'), 0, [targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield')))]);
    const s = passBoth(moveAway(s1, find(s1, 'Test Banner', 'battlefield')));
    expect(records(s)).toEqual([]);
    expect(s.log.some((l) => /does nothing: its "for as long as" duration is already over/.test(l.text))).toBe(true);
  });

  it('asLongAs: ends the first time the condition is false (and never restarts, design 3.7)', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = pump(s0, 1);
    expect(pt(s, bears)).toEqual([3, 3]);
    s = pass(moveAway(s, find(s, 'Forest', 'battlefield'), 'hand'));
    expect(records(s)).toEqual([]);
    expect(pt(s, bears)).toEqual([2, 2]);
  });

  it('asLongAs: a condition already false on resolution: the effect does nothing', () => {
    const b = board();
    expect(records(pump(moveAway(b, find(b, 'Forest', 'battlefield'), 'hand'), 1))).toEqual([]);
  });
});

describe('CR 610.3, 611.2a: "until [event]"', () => {
  it('ends when the event happens after the effect began', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = pump(s0, 2);
    expect(pt(s, bears)).toEqual([3, 3]);
    s = passBoth(s); // to the beginning of combat: the record is checked at every priority
    expect(records(s)).toHaveLength(1); // nothing happened
    s = castAndResolve(s, 'Shatter Test', [targets(objectTarget(find(s, 'Test Banner', 'battlefield')))]);
    expect(records(s)).toEqual([]);
    expect(pt(s, bears)).toEqual([2, 2]);
    expect(s.log.some((l) => /the event it lasted until happened/.test(l.text) && l.rules?.includes('CR 610.3'))).toBe(true);
  });

  it('CR 610.3a: an event that happened before the effect began (earlier in the same resolution) does not end it; the next one does', () => {
    const DIES = { ev: 'zoneChange' as const, subject: { types: ['Creature'] }, from: 'battlefield' as const, to: 'graveyard' as const };
    const GRIM = instant('Grim Pump', [
      { op: 'move', what: { ref: 'target', id: 't1' }, to: { zone: 'graveyard' } },
      { op: 'effect', duration: { d: 'until', event: DIES }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] },
    ], [creatureTarget('t0'), creatureTarget('t1')]);
    const KILL = instant('Kill Test', [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'graveyard' } }], [creatureTarget()]);
    const s0 = scenario(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves'], { p1: { hand: ['Grim Pump', 'Kill Test'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, defs: [GRIM, KILL] });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castAndResolve(s0, 'Grim Pump', [targets(objectTarget(giant)), targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield')))]);
    expect(records(s)).toHaveLength(1); // the Bears died first, in the same resolution
    expect(pt(s, giant)).toEqual([4, 4]);
    s = castAndResolve(s, 'Kill Test', [targets(objectTarget(find(s, 'Llanowar Elves', 'battlefield')))]);
    expect(records(s)).toEqual([]);
  });

  it('"until ~ leaves the battlefield" whose source has already left: the effect does nothing (it would never end)', () => {
    const s0 = board();
    const s1 = activate(s0, find(s0, 'Test Banner', 'battlefield'), 2, [targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield')))]);
    expect(records(passBoth(moveAway(s1, find(s1, 'Test Banner', 'battlefield'))))).toEqual([]);
  });
});

describe('turn and step boundaries', () => {
  it('untilNextTurn: lasts through the opponent\'s turn and ends as its controller\'s next turn begins', () => {
    let s = pump(board(), 3);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, bears)).toEqual([3, 3]);
    expect(records(s)[0]!.duration).toEqual({ d: 'untilNextTurn', whose: { ref: 'fixed', players: ['p1'] } }); // the player fixed as it was created
    s = advanceTo(s, 3, 'upkeep');
    expect(records(s)).toEqual([]);
    expect(pt(s, bears)).toEqual([2, 2]);
  });

  it('untilNextStep: ends as the next end step begins (any player\'s)', () => {
    let s = pump(board(), 4);
    s = advanceTo(s, 1, 'main2');
    expect(records(s)).toHaveLength(1);
    s = advanceTo(s, 1, 'end');
    expect(records(s)).toEqual([]);
  });

  it('untilNextStep with a player: only that player\'s end step ends it', () => {
    let s = pump(board(), 6);
    s = advanceTo(s, 1, 'end');
    expect(records(s)).toHaveLength(1); // p1's end step: not an opponent's
    s = advanceTo(s, 2, 'end');
    expect(records(s)).toEqual([]);
  });

  it('CR 500.5a: "until end of combat" ends at the end of the combat phase, not at the beginning of the end of combat step', () => {
    let s = advanceTo(board(), 1, 'beginCombat');
    s = pump(s, 5);
    expect(records(s)).toHaveLength(1);
    s = advanceTo(s, 1, 'endCombat');
    expect(records(s)).toHaveLength(1);
    s = advanceTo(s, 1, 'main2');
    expect(records(s)).toEqual([]);
  });

  it('CR 514.2: "until end of turn" ends in the cleanup step: the chips of manual shields too; "until your next turn" chips at that turn', () => {
    let s = structuredClone(board());
    s.reminders = [
      { id: 'r1', text: 'If it would die this turn, exile it instead.', sourceName: 'Test', controller: 'p1', until: { d: 'endOfTurn' }, createdTurn: 1 },
      { id: 'r2', text: 'Until your next turn, ...', sourceName: 'Test', controller: 'p1', until: { d: 'untilNextTurn', whose: { ref: 'fixed', players: ['p1'] } }, createdTurn: 1 },
    ];
    s = advanceTo(s, 2, 'upkeep');
    expect(s.reminders.map((r) => r.id)).toEqual(['r2']);
    s = advanceTo(s, 3, 'upkeep');
    expect(s.reminders).toEqual([]);
  });
});

describe('CR 611.2b: "for as long as" durations judged on fresh information', () => {
  it('CR 611.2b, 603.10: an asLongAs over the history ("for as long as no creature died this turn") ends at the first priority check after the death', () => {
    const DIES = { ev: 'zoneChange' as const, subject: { types: ['Creature'] }, from: 'battlefield' as const, to: 'graveyard' as const };
    const VIGIL = instant('Vigil Pump', [{
      op: 'effect', duration: { d: 'asLongAs', cond: { cond: 'not', of: { cond: 'happened', event: DIES, scope: 'turn' } } },
      effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }],
    }], [creatureTarget()]);
    const KILL = instant('Kill Test', [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'graveyard' } }], [creatureTarget()]);
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { hand: ['Vigil Pump', 'Kill Test'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [VIGIL, KILL] });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castAndResolve(s0, 'Vigil Pump', [targets(objectTarget(giant))]);
    expect(records(s)).toHaveLength(1);
    s = castAndResolve(s, 'Kill Test', [targets(objectTarget(find(s, 'Grizzly Bears', 'battlefield')))]);
    expect(records(s)).toEqual([]); // the history was brought up to date before the condition was judged (triggers/stack.ts#syncHistory)
    expect(pt(s, giant)).toEqual([3, 3]);
  });

  it('CR 611.2b: "for as long as ~ remains attached to it" ends when the Equipment is attached to another creature', () => {
    const BLADE = permanent('Test Blade', 'Artifact — Equipment', [activated('Bond', {
      targets: [],
      steps: [{ op: 'effect', duration: { d: 'whileSource', as: 'attached' }, effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }],
    })]);
    let s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Test Blade', 'Grizzly Bears', 'Hill Giant'] }, defs: [BLADE] });
    const blade = find(s0, 'Test Blade', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    s0 = structuredClone(s0);
    s0.objects[blade]!.attachedTo = bears;
    let s = passBoth(activate(s0, blade));
    expect(pt(s, bears)).toEqual([3, 3]);
    s = structuredClone(s);
    s.objects[blade]!.attachedTo = giant; // re-equipped (CR 301.5c)
    expect(pt(s, bears)).toEqual([2, 2]); // statics/live.ts: no longer applied
    expect(pt(s, giant)).toEqual([3, 3]);
    s = pass(s);
    expect(records(s)).toEqual([]);
  });
});

describe('manual chips end like the effects they stand for', () => {
  it('CR 611.2b: a chip "for as long as ~ is on the battlefield" ends when its source leaves; one "until ~ leaves the battlefield" too (CR 610.3)', () => {
    let s = structuredClone(board());
    const banner = find(s, 'Test Banner', 'battlefield');
    s.reminders = [
      { id: 'r1', text: 'While it is here, ...', sourceName: 'Test Banner', controller: 'p1', until: { d: 'whileSource', as: 'onBattlefield' }, createdTurn: 1, source: { id: banner, zone: 'battlefield' } },
      { id: 'r2', text: 'Until it leaves, ...', sourceName: 'Test Banner', controller: 'p1', until: { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } }, createdTurn: 1, source: { id: banner, zone: 'battlefield' } },
    ];
    s = passBoth(s);
    expect(s.reminders.map((r) => r.id)).toEqual(['r1', 'r2']);
    s = castAndResolve(s, 'Shatter Test', [targets(objectTarget(banner))]);
    expect(s.reminders).toEqual([]);
  });
});
