/**
 * The `delay` (CR 603.7) and `reflexive` (CR 603.12) ops, and the section 13 cards with delayed or linked abilities: Pact of Negation, Sneak Attack, Fiend
 * Hunter. The records are WP8's (triggers/delayed.ts fires them, triggers/stack.ts puts them on the stack); the handlers here create them with what the
 * resolution knew fixed (CR 603.7c, 608.2h). Spine, pipeline and the ops of other families are the fakes of neighbors.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/index';
import { advanceTo, answer, find, passBoth, scenario } from '../helpers';
import { cast, castAndResolve, creatureTarget, example, instant, objectTarget, permanent, programOf, pt, setup, targets, withExamples } from './support';
import { activate } from './support';

vi.mock('../../../src/effects/propose', async (o) => (await import('./neighbors')).proposeMock(await o()));
vi.mock('../../../src/effects/manual', async (o) => (await import('./neighbors')).manualMock(await o()));
vi.mock('../../../src/effects/run', async (o) => (await import('./neighbors')).runMock(await o()));
vi.mock('../../../src/core/resolve', async (o) => (await import('./neighbors')).resolveMock(await o()));

beforeEach(setup);

function moveAway(s: GameState, id: string, to: 'graveyard' | 'hand' | 'battlefield' = 'graveyard'): GameState {
  const t = structuredClone(s);
  moveObject(new Game(t), id, to, { cause: 'test' });
  return t;
}

const yes = { kind: 'yesNo' as const, yes: true };
const no = { kind: 'yesNo' as const, yes: false };

describe('Pact of Negation: "At the beginning of your next upkeep, pay {3}{U}{U}. If you don\'t, you lose the game." (CR 603.7, 118.12)', () => {
  const PACT = instant('Pact of Negation', programOf('Pact of Negation').steps, programOf('Pact of Negation').targets);
  const DUMMY = instant('Dummy Spell', []);
  const board = (): GameState => scenario([], { p1: { hand: ['Pact of Negation', 'Dummy Spell'] }, defs: [PACT, DUMMY] });

  function resolved(): GameState {
    const s0 = cast(board(), 'Dummy Spell');
    const dummy = s0.zones.stack[0]!;
    return passBoth(cast(s0, 'Pact of Negation', [targets(objectTarget(dummy))]));
  }

  it('CR 603.7a, 603.7d: the spell creates a delayed trigger whose source is the spell and whose controller is its controller', () => {
    const s = resolved();
    expect(s.delayedTriggers).toHaveLength(1);
    const rec = s.delayedTriggers[0]!;
    expect(rec.controller).toBe('p1');
    expect(rec.when).toEqual({ at: 'step', step: 'upkeep', whose: 'you', next: true });
    expect(rec.createdTurn).toBe(1);
    expect(s.objects[rec.source.id] ?? s.lki[rec.source.id]?.object).toMatchObject({ defId: 'Pact of Negation' });
  });

  it('CR 603.7: it does not trigger in the opponent\'s upkeep; in its controller\'s next upkeep it triggers, and not paying loses the game (CR 104.3e)', () => {
    let s = advanceTo(resolved(), 2, 'upkeep');
    expect(s.zones.stack).toEqual([]);
    expect(s.delayedTriggers).toHaveLength(1);
    s = advanceTo(s, 3, 'upkeep');
    expect(s.zones.stack).toHaveLength(1); // the delayed triggered ability
    expect(s.delayedTriggers).toEqual([]); // CR 603.7b: it triggers only once
    s = answer(passBoth(s), no);
    expect(s.result).toMatchObject({ winner: 'p2' });
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true);
  });

  it('CR 118.12: paying keeps the game going', () => {
    const s = answer(passBoth(advanceTo(resolved(), 3, 'upkeep')), yes);
    expect(s.result).toBeNull();
  });
});

describe('Sneak Attack: "... That creature gains haste. Sacrifice the creature at the beginning of the next end step." (CR 603.7c, 611.2a)', () => {
  const SNEAK = permanent('Sneak Attack', 'Enchantment', example('Sneak Attack'));
  const board = (): GameState => scenario(['Grizzly Bears', 'Mountain'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Sneak Attack', 'Mountain'] }, defs: [SNEAK] });

  function sneak(): { s: GameState; bears: string } {
    const s0 = board();
    const inHand = find(s0, 'Grizzly Bears', 'hand');
    const s = answer(passBoth(activate(s0, find(s0, 'Sneak Attack', 'battlefield'))), { kind: 'chooseObjects', ids: [inHand] });
    return { s, bears: find(s, 'Grizzly Bears', 'battlefield') };
  }

  it('CR 611.2c: the creature put onto the battlefield gains haste (the bound name followed it there, CR 400.7j)', () => {
    const { s, bears } = sneak();
    expect(getChars(s, bears).keywords.map((k) => k.keyword)).toContain('haste');
  });

  it('CR 603.7c: the delayed trigger captured the creature with the zone it is expected in, and sacrifices it at the next end step', () => {
    const { s, bears } = sneak();
    expect(s.delayedTriggers[0]!.captured).toEqual({ c: [{ id: bears, zone: 'battlefield' }] });
    let t = advanceTo(s, 1, 'end');
    expect(t.zones.stack).toHaveLength(1);
    t = passBoth(t);
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Grizzly Bears')).toBe(false);
    expect(t.zones.graveyard['p1']!.some((id) => t.objects[id]!.defId === 'Grizzly Bears')).toBe(true);
  });

  it('CR 603.7c, 400.7: a creature that left and came back is a new object: the delayed trigger does nothing to it', () => {
    const { s, bears } = sneak();
    let t = moveAway(s, bears, 'hand');
    t = moveAway(t, find(t, 'Grizzly Bears', 'hand'), 'battlefield');
    t = passBoth(advanceTo(t, 1, 'end'));
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Grizzly Bears')).toBe(true);
  });

  it('did c guards the rest: choosing no card creates neither the effect nor the delayed trigger', () => {
    const s0 = board();
    const s = answer(passBoth(activate(s0, find(s0, 'Sneak Attack', 'battlefield'))), { kind: 'chooseObjects', ids: [] });
    expect(s.delayedTriggers).toEqual([]);
    expect(s.continuousEffects).toEqual([]);
  });
});

describe('Fiend Hunter: linked enters and leaves abilities (CR 607.2a, 400.7, the famous race)', () => {
  const KILL = instant('Kill Test', [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'graveyard' } }], [creatureTarget()]);
  const board = (): GameState =>
    withExamples(scenario(['Fiend Hunter', 'Grizzly Bears', 'Plains'], { p1: { hand: ['Fiend Hunter', 'Kill Test'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [KILL] }), 'Fiend Hunter');

  /** Cast Fiend Hunter; its enters trigger is on the stack targeting the bears. */
  function entered(): { s: GameState; bears: string } {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = answer(passBoth(cast(s0, 'Fiend Hunter')), targets(objectTarget(bears)));
    return { s, bears };
  }

  it('CR 607.2a: the exiled card is linked to THIS Fiend Hunter and returns when it leaves', () => {
    const { s: s1, bears } = entered();
    let s = answer(passBoth(s1), yes);
    const hunter = find(s, 'Fiend Hunter', 'battlefield');
    const exiled = find(s, 'Grizzly Bears', 'exile');
    expect(s.objects[hunter]!.links).toEqual({ exiled: { objects: [{ id: exiled, zone: 'exile' }] } });
    expect(s.objects[bears]).toBeUndefined();
    s = castAndResolve(s, 'Kill Test', [targets(objectTarget(hunter))]);
    s = passBoth(s); // the leaves trigger
    expect(find(s, 'Grizzly Bears', 'battlefield', 'p2')).toBeTruthy();
    expect(s.objects[find(s, 'Grizzly Bears', 'battlefield')]!.controller).toBe('p2'); // CR 610.3c: under its owner's control
  });

  it('the race: Fiend Hunter leaves before its enters ability resolves: the leaves ability returns nothing, then the creature is exiled for good', () => {
    const { s: s1 } = entered();
    let s = cast(s1, 'Kill Test', [targets(objectTarget(find(s1, 'Fiend Hunter', 'battlefield')))]);
    s = passBoth(s); // Kill Test resolves: Fiend Hunter dies
    expect(s.zones.stack).toHaveLength(2); // the leaves trigger is above the enters trigger
    s = passBoth(s); // the leaves trigger: nothing is linked yet (CR 607.2a)
    s = answer(passBoth(s), yes); // the enters trigger exiles the bears
    expect(find(s, 'Grizzly Bears', 'exile')).toBeTruthy();
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Grizzly Bears')).toBe(false);
  });
});

describe('CR 603.7c, 608.2h: what a delayed trigger knows about the resolution that created it is fixed', () => {
  const LATER = instant('Later Pump', [{
    op: 'delay', when: { at: 'step', step: 'end', next: true },
    do: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: { q: 'X' }, toughness: { q: 'X' } }] }] }],
  }], [creatureTarget()], 'Instant', '{X}');

  it('the target becomes a fixed handle and X its number; at the next end step the creature gets +X/+X', () => {
    const s0 = scenario(['Grizzly Bears', 'Plains'], { p1: { hand: ['Later Pump'], battlefield: ['Grizzly Bears', 'Plains', 'Plains', 'Plains'] }, defs: [LATER] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = castAndResolve(s0, 'Later Pump', [{ kind: 'chooseNumber', n: 3 }, targets(objectTarget(bears))]);
    expect(s.delayedTriggers[0]!.do).toEqual([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [{ s: 'continuous', affects: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: 3, toughness: 3 }] }],
    }]);
    expect(pt(s, bears)).toEqual([2, 2]);
    s = passBoth(advanceTo(s, 1, 'end'));
    expect(pt(s, bears)).toEqual([5, 5]);
  });

  it('CR 603.7b: a delayed trigger with a stated duration ("this turn") is forgotten when the duration ends', () => {
    const THIS_TURN = instant('This Turn', [{ op: 'delay', when: { at: 'event', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' } }, duration: { d: 'endOfTurn' }, do: [] }]);
    const s0 = scenario([], { p1: { hand: ['This Turn'] }, defs: [THIS_TURN] });
    let s = castAndResolve(s0, 'This Turn');
    expect(s.delayedTriggers[0]!.duration).toEqual({ d: 'endOfTurn' });
    s = advanceTo(s, 2, 'upkeep');
    expect(s.delayedTriggers).toEqual([]);
  });
});

describe('CR 603.12: "When you do, ..." (reflexive)', () => {
  const REFLEX = instant('Reflex Test', [
    { op: 'may', who: { ref: 'you' }, do: [], as: 'm' },
    { op: 'reflexive', when: { did: 'm' }, targets: [creatureTarget('t1')], do: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't1' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }] }] },
  ]);
  const board = (): GameState => scenario(['Grizzly Bears'], { p1: { hand: ['Reflex Test'], battlefield: ['Grizzly Bears'] }, defs: [REFLEX] });

  it('it triggers when the player did it; its target is chosen as it is put on the stack (CR 603.3d), after the spell finished resolving', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = answer(passBoth(cast(s0, 'Reflex Test')), yes);
    expect(s.pending?.kind).toBe('chooseTargets'); // the reflexive trigger goes on the stack the next time a player would get priority
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Reflex Test')).toBe(true);
    s = answer(s, targets(objectTarget(bears)));
    s = passBoth(s);
    expect(pt(s, bears)).toEqual([4, 4]);
  });

  it('declining: nothing triggers', () => {
    const s = answer(passBoth(cast(board(), 'Reflex Test')), no);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack).toEqual([]);
    expect(s.pendingTriggers).toEqual([]);
  });
});
