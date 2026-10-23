/**
 * Sound on the game screen (docs/design/sound.md), the pure choices: which sound each moment of a change makes, the events the animator never shows, the
 * condensed sound of a change shown without animation, the paced connection reporting those changes, and the "your move" rules.
 */
import type { GameEvent, GameView } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planBatch } from '../../src/board/fx/plan';
import {
  alignAccent,
  CONDENSED_CAP, EVENT_CUE_CAP, UNANIMATED_CAP, bannerSound, condensedCues, damageGain, eventCues, exitCue, hitSound, manaSound, panFor, unanimatedCues,
} from '../../src/board/fx/sounds';
import type { EventBatch, GameConnection } from '../../src/connection/GameConnection';
import { PacedConnection, type BoardAnimator } from '../../src/connection/PacedConnection';
import { RateLimit, SoundClock } from '../../src/game/sound';
import { yourMoveClear, yourMoveHeard } from '../../src/prompts/PromptBar';

function def(id: string, name: string, colors: string[], type = 'Creature', power?: string) {
  return { id, name, layout: 'normal', faces: [{ name, colors, typeLine: type, manaCost: '', oracleText: '', abilities: [], ...(power ? { power, toughness: power } : {}) }], automation: { level: 'full' } };
}

type Obj = { defId: string; zone: string; controller?: string; kind?: string; stack?: object };

/** A small hand-made view for Alice (p1) against Bob (p2). */
function viewOf(objects: Record<string, Obj>, stack: string[] = [], viewer: string | null = 'p1'): GameView {
  const defs = {
    bolt: def('bolt', 'Lightning Bolt', ['R'], 'Instant'),
    bears: def('bears', 'Grizzly Bears', ['G'], 'Creature', '2'),
    giant: def('giant', 'Hill Giant', ['R'], 'Creature', '4'),
    forest: def('forest', 'Forest', [], 'Basic Land — Forest'),
    growth: def('growth', 'Giant Growth', ['G'], 'Instant'),
  };
  const objs = Object.fromEntries(
    Object.entries(objects).map(([id, o]) => [
      id,
      { id, kind: o.kind ?? 'card', owner: o.controller ?? 'p1', controller: o.controller ?? 'p1', zone: o.zone, defId: o.defId, counters: {}, damage: 0, tapped: false, face: 0, ...(o.stack ? { stack: o.stack } : {}) },
    ]),
  );
  return {
    viewer, players: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }], objects: objs, defs, lki: {},
    zones: { stack, battlefield: Object.keys(objects).filter((k) => objects[k]!.zone === 'battlefield'), hand: {}, library: {}, graveyard: {}, exile: [], command: [] },
  } as unknown as GameView;
}

const ids = (cues: { id: string }[]) => cues.map((c) => c.id);

describe('the sound of a moment', () => {
  it('a blow by its damage: 1-2 light, 3-5 medium, 6+ heavy on a creature, its own sound on a player; louder with more damage', () => {
    expect([1, 2, 3, 5, 6, 12].map((n) => hitSound(n, false))).toEqual(['hit.light', 'hit.light', 'hit.medium', 'hit.medium', 'hit.heavy', 'hit.heavy']);
    expect(hitSound(1, true)).toBe('hit.player');
    expect(hitSound(9, true)).toBe('hit.player');
    expect(damageGain(0)).toBeCloseTo(0.6);
    expect(damageGain(3)).toBeCloseTo(0.8);
    expect(damageGain(6)).toBeCloseTo(1);
    expect(damageGain(20)).toBeCloseTo(1);
  });

  it('pans with where it happens on the table, never fully to one side', () => {
    const arena = { left: 100, width: 800 };
    expect(panFor(500, arena)).toBeCloseTo(0);
    expect(panFor(100, arena)).toBeCloseTo(-0.7);
    expect(panFor(900, arena)).toBeCloseTo(0.7);
    expect(panFor(5000, arena)).toBeCloseTo(0.7);
    expect(panFor(700, arena)).toBeCloseTo(0.35);
    expect(panFor(700, { left: 0, width: 0 })).toBe(0);
  });

  it('cards leaving: destroyed shatter, sacrificed sink, exiled vanish, returned recall; a finished spell is softer; a token outside play just vanishes (CR 111.7)', () => {
    const m = (kind: string, token = false) => ({ oldId: 'a', newId: 'b', from: 'battlefield', to: 'graveyard', owner: 'p1', controller: 'p1', kind, token, shownInA: false }) as never;
    expect(exitCue(m('die'))).toEqual({ id: 'card.destroy' });
    expect(exitCue(m('sacrifice'))).toEqual({ id: 'card.sacrifice' });
    expect(exitCue(m('exile'))).toEqual({ id: 'card.exile' });
    expect(exitCue(m('bounce'))).toEqual({ id: 'card.bounce' });
    expect(exitCue(m('toLibrary'))).toEqual({ id: 'card.toLibrary' });
    expect(exitCue(m('toGraveyard'))).toEqual({ id: 'card.toGraveyard' });
    expect(exitCue(m('toGraveyard'), true)).toEqual({ id: 'card.toGraveyard', gain: 0.6 });
    expect(exitCue(m('bounce', true))).toEqual({ id: 'card.exile', gain: 0.4 });
    expect(exitCue(m('die', true))).toEqual({ id: 'card.destroy' });
    expect(manaSound('G')).toBe('mana.G');
    expect(manaSound(undefined)).toBe('mana.C');
  });

  it("the turn banner: the viewer's turn or the other's; the first turn's banner gives way to the game's start", () => {
    expect(bannerSound({ number: 3, player: 'p1' }, 'p1', Infinity)).toBe('turn.mine');
    expect(bannerSound({ number: 3, player: 'p2' }, 'p1', Infinity)).toBe('turn.theirs');
    expect(bannerSound({ number: 1, player: 'p1' }, 'p1', 500)).toBeNull();
    expect(bannerSound({ number: 1, player: 'p1' }, 'p1', 10_000)).toBe('turn.mine');
    expect(bannerSound({ number: 2, player: 'p1' }, 'p1', 500)).toBe('turn.mine');
  });
});

describe('events without a visual (eventCues)', () => {
  const v = viewOf({ a: { defId: 'bears', zone: 'battlefield' }, b: { defId: 'bears', zone: 'battlefield', controller: 'p2' }, l: { defId: 'forest', zone: 'battlefield' } });
  const cues = (events: GameEvent[], viewer: string | null = 'p1') => eventCues(events, v, v, viewer);

  it('each event kind has its sound', () => {
    const one = (e: GameEvent) => ids(cues([e]));
    expect(one({ type: 'tapped', objectId: 'a' })).toEqual(['card.tap']);
    expect(one({ type: 'untapped', objectId: 'a' })).toEqual(['card.untap']);
    expect(one({ type: 'shuffled', player: 'p1' })).toEqual(['game.shuffle']);
    expect(one({ type: 'mulligan', player: 'p2', count: 1 })).toEqual(['game.mulligan']);
    expect(one({ type: 'coinFlipped', player: 'p1', won: true })).toEqual(['game.coin']);
    expect(one({ type: 'dieRolled', player: 'p1', sides: 20, result: 7 })).toEqual(['game.dice']);
    expect(one({ type: 'dayNight', to: 'night' })).toEqual(['world.night']);
    expect(one({ type: 'dayNight', to: 'day' })).toEqual(['world.day']);
    expect(one({ type: 'designationChanged', what: 'monarch', to: 'p2' })).toEqual(['world.crown']);
    expect(one({ type: 'designationChanged', what: 'initiative', to: 'p1' })).toEqual(['world.crown']);
    expect(one({ type: 'controlChanged', objectId: 'b', from: 'p2', to: 'p1' })).toEqual(['card.control']);
    expect(one({ type: 'attached', objectId: 'x', to: 'a' })).toEqual(['card.attach']);
    expect(one({ type: 'attached', objectId: 'x', to: null })).toEqual([]);
    expect(one({ type: 'phasedOut', objectId: 'a' })).toEqual(['card.phase']);
    expect(one({ type: 'spellCopied', objectId: 's2', copyOf: 's1' })).toEqual(['spell.copied']);
    for (const type of ['turnedFaceDown', 'flipped'] as const) expect(one({ type, objectId: 'a' })).toEqual(['card.flip']);
    expect(one({ type: 'melded', objectId: 'a', from: ['x', 'y'] })).toEqual(['card.flip']);
    expect(one({ type: 'mutated', objectId: 'a', spell: 's', over: true })).toEqual(['card.flip']);
    expect(one({ type: 'actionPerformed', verb: 'search', actor: 'p1' })).toEqual(['card.search']);
    for (const verb of ['reveal', 'scry', 'surveil']) expect(one({ type: 'actionPerformed', verb, actor: 'p1' })).toEqual(['card.reveal']);
    expect(one({ type: 'actionPerformed', verb: 'destroy', actor: 'p1' })).toEqual([]);
    expect(one({ type: 'damagePrevented', effect: 'e', batch: 1, amount: 2, source: ['b'], target: ['a'] })).toEqual(['damage.prevented']);
    expect(one({ type: 'zoneChanged', oldId: 'x', newId: 'y', from: 'library', to: 'graveyard', owner: 'p1', controller: 'p1', name: 'Forest' })).toEqual(['card.toGraveyard']);
  });

  it('CR 115.1: a lock-on alert only for the other player aiming at the viewer or what the viewer controls', () => {
    const target = (objectId: string, by: string): GameEvent => ({ type: 'becameTarget', objectId, byStackId: 's', byController: by });
    expect(ids(cues([target('a', 'p2')]))).toEqual(['card.targeted']);
    expect(ids(cues([target('p1', 'p2')]))).toEqual(['card.targeted']);
    expect(ids(cues([target('b', 'p2')]))).toEqual([]); // Bob's own creature
    expect(ids(cues([target('a', 'p1')]))).toEqual([]); // Alice's own spell
    expect(ids(cues([target('p2', 'p1')]))).toEqual([]);
    expect(ids(cues([target('a', 'p2')], null))).toEqual([]); // a spectator (hot-seat hand-off view)
    // From Bob's seat the same events read the other way round.
    expect(ids(cues([target('b', 'p1')], 'p2'))).toEqual(['card.targeted']);
  });

  it('a tap is not heard for an attacker (the attack is) or a mana source (its mana is), at most three, 30 ms apart', () => {
    const attack: GameEvent = { type: 'attackersDeclared', attackers: [{ attacker: 'a', defender: 'p2' }] };
    expect(cues([attack, { type: 'tapped', objectId: 'a' }])).toEqual([]);
    expect(cues([{ type: 'tapped', objectId: 'l' }, { type: 'manaAdded', player: 'p1', mana: ['G'], sourceId: 'l' }])).toEqual([]);
    const taps = cues(['t1', 't2', 't3', 't4', 't5'].map((objectId): GameEvent => ({ type: 'tapped', objectId })));
    expect(ids(taps)).toEqual(['card.tap', 'card.tap', 'card.tap']);
    expect(taps.map((c) => c.delay ?? 0)).toEqual([0, 0.03, 0.06]);
  });

  it("CR 502.3: untapping is one sweep for the whole board, softer for the other player's permanents", () => {
    const mine = cues([{ type: 'untapped', objectId: 'a' }, { type: 'untapped', objectId: 'l' }]);
    expect(mine).toEqual([{ id: 'card.untap' }]);
    expect(cues([{ type: 'untapped', objectId: 'b' }])).toEqual([{ id: 'card.untap', gain: 0.6 }]);
  });

  it('each sound once, at most EVENT_CUE_CAP, spaced out', () => {
    const events: GameEvent[] = [
      { type: 'shuffled', player: 'p1' }, { type: 'shuffled', player: 'p2' }, { type: 'coinFlipped', player: 'p1', won: true },
      { type: 'dieRolled', player: 'p1', sides: 6, result: 1 }, { type: 'phasedOut', objectId: 'a' }, { type: 'controlChanged', objectId: 'b', from: 'p2', to: 'p1' },
      { type: 'spellCopied', objectId: 's2', copyOf: 's1' }, { type: 'damagePrevented', effect: 'e', batch: 1, amount: 1, source: [], target: [] },
    ];
    const out = cues(events);
    expect(out.length).toBe(EVENT_CUE_CAP);
    expect(new Set(ids(out)).size).toBe(out.length);
    expect(ids(out).filter((i) => i === 'game.shuffle')).toEqual(['game.shuffle']);
    expect(out.map((c) => c.delay ?? 0)).toEqual([0, 0.07, 0.14, 0.21, 0.28, 0.35]);
  });

  it('a new step ticks only when the change has nothing louder, and never for the untap or cleanup step', () => {
    expect(ids(cues([{ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' }]))).toEqual(['turn.step']);
    expect(ids(cues([{ type: 'stepBegan', step: 'untap', activePlayer: 'p1' }]))).toEqual([]);
    expect(ids(cues([{ type: 'stepBegan', step: 'cleanup', activePlayer: 'p1' }]))).toEqual([]);
    expect(ids(cues([{ type: 'stepBegan', step: 'draw', activePlayer: 'p1' }, { type: 'shuffled', player: 'p1' }]))).toEqual(['game.shuffle']);
    // A new turn (the banner) is louder.
    expect(ids(cues([{ type: 'turnBegan', turn: 4, activePlayer: 'p1' }, { type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' }]))).toEqual([]);
  });
});

describe('a change shown without animation (condensed)', () => {
  it('keeps the most important moments, in the order they would have happened, a beat apart', () => {
    const from = viewOf({ a: { defId: 'bears', zone: 'battlefield' }, b: { defId: 'bears', zone: 'battlefield', controller: 'p2' } });
    const to = viewOf({});
    const events: GameEvent[] = [
      { type: 'damageDealt', source: 'a', target: 'b', amount: 2, combat: true },
      { type: 'damageDealt', source: 'b', target: 'a', amount: 2, combat: true },
      { type: 'zoneChanged', oldId: 'a', newId: 'a2', from: 'battlefield', to: 'graveyard', owner: 'p1', controller: 'p1', name: 'Grizzly Bears' },
      { type: 'zoneChanged', oldId: 'b', newId: 'b2', from: 'battlefield', to: 'graveyard', owner: 'p2', controller: 'p2', name: 'Grizzly Bears' },
      { type: 'turnBegan', turn: 5, activePlayer: 'p2' },
    ];
    const cues = condensedCues(planBatch(events, from, to), events, to, 'p1');
    // The blow (CR 510.2), then the deaths (CR 704.5g), then the new turn.
    expect(ids(cues)).toEqual(['hit.light', 'card.destroy', 'turn.theirs']);
    expect(cues.map((c) => c.delay ?? 0)).toEqual([0, 0.08, 0.16]);
    expect(cues[0]!.gain).toBeCloseTo(damageGain(2));
  });

  it('the heaviest blow decides: a spell at a player is its impact... no, the player takes it (hit.player), a big spell at a creature is its element', () => {
    const v = viewOf({ s: { defId: 'bolt', zone: 'stack' }, g: { defId: 'giant', zone: 'battlefield', controller: 'p2' } }, ['s']);
    const after = viewOf({ g: { defId: 'giant', zone: 'battlefield', controller: 'p2' } });
    const atPlayer: GameEvent[] = [{ type: 'lifeChanged', player: 'p2', delta: -3, life: 17 }, { type: 'damageDealt', source: 's', target: 'p2', amount: 3, combat: false }, { type: 'resolved', objectId: 's' }];
    expect(ids(condensedCues(planBatch(atPlayer, v, after), atPlayer, after, 'p1'))).toContain('hit.player');
    const atCreature: GameEvent[] = [{ type: 'damageDealt', source: 's', target: 'g', amount: 3, combat: false }, { type: 'resolved', objectId: 's' }];
    const c = condensedCues(planBatch(atCreature, v, after), atCreature, after, 'p1');
    expect(ids(c)).toContain('impact.lightning');
    expect(ids(c)).toContain('spell.resolve');
  });

  it('cards arriving: a land locks in (CR 305.1), a big creature lands heavy, a draw by the other player is softer', () => {
    const from = viewOf({ h: { defId: 'forest', zone: 'hand' } });
    const land = viewOf({ l2: { defId: 'forest', zone: 'battlefield' } });
    const played: GameEvent[] = [
      { type: 'zoneChanged', oldId: 'h', newId: 'l2', from: 'hand', to: 'battlefield', owner: 'p1', controller: 'p1', name: 'Forest' },
      { type: 'landPlayed', objectId: 'l2', player: 'p1' },
    ];
    expect(ids(unanimatedCues(played, from, land))).toEqual(['card.land']);
    const giant = viewOf({ g: { defId: 'giant', zone: 'battlefield' } });
    const entered: GameEvent[] = [{ type: 'zoneChanged', oldId: 's', newId: 'g', from: 'stack', to: 'battlefield', owner: 'p1', controller: 'p1', name: 'Hill Giant' }];
    expect(ids(unanimatedCues(entered, viewOf({}), giant))).toEqual(['card.enterHeavy']);
    const bears = viewOf({ g: { defId: 'bears', zone: 'battlefield' } });
    expect(ids(unanimatedCues(entered, viewOf({}), bears))).toEqual(['card.enter']);
    const draw: GameEvent[] = [{ type: 'drew', player: 'p2', objectId: 'x' }];
    expect(unanimatedCues(draw, viewOf({}), viewOf({}))).toEqual([{ id: 'card.draw', gain: 0.6 }]);
    expect(unanimatedCues([{ type: 'drew', player: 'p1', objectId: 'x' }], viewOf({}), viewOf({}))).toEqual([{ id: 'card.draw' }]);
  });

  it('the end of the game comes first; the first turn after the game started is not announced over the start', () => {
    const v = viewOf({});
    const over: GameEvent[] = [{ type: 'playerLost', player: 'p2', reason: 'life' }, { type: 'gameOver', winner: 'p1', reason: 'life' }];
    expect(ids(unanimatedCues(over, v, v))).toEqual(['game.finalBlow']);
    const first: GameEvent[] = [{ type: 'turnBegan', turn: 1, activePlayer: 'p1' }];
    expect(ids(unanimatedCues(first, v, v, 400))).toEqual([]);
    expect(ids(unanimatedCues(first, v, v))).toEqual(['turn.mine']);
  });

  it(`at most ${CONDENSED_CAP} moments and ${UNANIMATED_CAP} sounds in all, each once; event cues come after the moments`, () => {
    const from = viewOf({ a: { defId: 'bears', zone: 'battlefield' }, b: { defId: 'bears', zone: 'battlefield', controller: 'p2' }, h: { defId: 'forest', zone: 'hand' } });
    const to = viewOf({ l2: { defId: 'forest', zone: 'battlefield' } });
    const events: GameEvent[] = [
      { type: 'abilityTriggered', objectId: 't', sourceId: 'a', player: 'p1' },
      { type: 'zoneChanged', oldId: 'h', newId: 'l2', from: 'hand', to: 'battlefield', owner: 'p1', controller: 'p1', name: 'Forest' },
      { type: 'lifeChanged', player: 'p1', delta: 3, life: 23 },
      { type: 'damageDealt', source: 'a', target: 'b', amount: 7, combat: true },
      { type: 'zoneChanged', oldId: 'b', newId: 'b2', from: 'battlefield', to: 'graveyard', owner: 'p2', controller: 'p2', name: 'Grizzly Bears' },
      { type: 'zoneChanged', oldId: 'a', newId: 'a2', from: 'battlefield', to: 'exile', owner: 'p1', controller: 'p1', name: 'Grizzly Bears' },
      { type: 'shuffled', player: 'p1' }, { type: 'coinFlipped', player: 'p1', won: false }, { type: 'dieRolled', player: 'p1', sides: 6, result: 2 },
      { type: 'turnBegan', turn: 6, activePlayer: 'p1' },
    ];
    const out = unanimatedCues(events, from, to);
    expect(out.length).toBe(UNANIMATED_CAP);
    expect(new Set(ids(out)).size).toBe(UNANIMATED_CAP);
    expect(ids(out).slice(0, CONDENSED_CAP)).toEqual(['hit.heavy', 'card.destroy', 'card.exile', 'turn.mine']);
    expect(ids(out).slice(CONDENSED_CAP)).toEqual(['game.shuffle', 'game.coin']);
    const delays = out.map((c) => c.delay ?? 0);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
  });
});

describe('"your move" (priority.mine)', () => {
  it('is heard when the decision comes back from the other player or the bar shows its first one, not when it only continues the own action', () => {
    expect(yourMoveHeard(false, false)).toBe(true); // the first decision, or back from the other player
    expect(yourMoveHeard(false, true)).toBe(true);
    expect(yourMoveHeard(true, true)).toBe(false); // cast -> targets -> cost: the player's own follow-ups
    expect(yourMoveHeard(true, false)).toBe(true); // replaced without the player acting (an undo, the other player's response)
  });

  it('at most once a second, never over the own turn banner or the start of the game', () => {
    let now = 10_000;
    const clock = new SoundClock(() => now);
    expect(yourMoveClear(clock)).toBe(true);
    clock.note('priority.mine');
    now += 500;
    expect(yourMoveClear(clock)).toBe(false);
    now += 600;
    expect(yourMoveClear(clock)).toBe(true);
    clock.note('turn.mine');
    expect(yourMoveClear(clock)).toBe(false);
    now += 1600;
    expect(yourMoveClear(clock)).toBe(true);
    clock.note('turn.theirs');
    expect(yourMoveClear(clock)).toBe(true); // the other player's banner does not say "your move"
    clock.note('game.start');
    now += 2000;
    expect(yourMoveClear(clock)).toBe(false);
    now += 600;
    expect(yourMoveClear(clock)).toBe(true);
    // A sound scheduled for later counts as recent until it has started and the time has passed.
    clock.note('turn.mine', 0.5);
    now += 1800;
    expect(yourMoveClear(clock)).toBe(false);
    now += 1000;
    expect(yourMoveClear(clock)).toBe(true);
    // The other player's spell aimed at you already says "respond" (its lock-on warning).
    clock.note('card.targeted');
    now += 500;
    expect(yourMoveClear(clock)).toBe(false);
    now += 300;
    expect(yourMoveClear(clock)).toBe(true);
  });

  it('a rate limit lets one go through per period', () => {
    let now = 0;
    const limit = new RateLimit(120, () => now);
    expect(limit.take()).toBe(true);
    now = 50;
    expect(limit.take()).toBe(false);
    now = 119;
    expect(limit.take()).toBe(false);
    now = 121;
    expect(limit.take()).toBe(true);
  });
});

// ---- the paced connection reports the changes it shows without animation ------------------------------------------------------------------------

function viewWith(decisionId: number): GameView {
  return { pending: { id: decisionId, player: 'p1', kind: 'priority', prompt: '' }, players: [], zones: {}, objects: {} } as unknown as GameView;
}

function scriptedInner() {
  let view = viewWith(1);
  let batch: EventBatch = { seq: 0, events: [] };
  const listeners = new Set<() => void>();
  const inner = {
    kind: 'local' as const,
    view: () => view,
    legalActions: () => [],
    act: vi.fn(async () => ({ ok: true as const })),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    canUndo: () => true,
    undo: vi.fn(() => true),
    handoff: () => null,
    acceptHandoff: vi.fn(),
    events: () => batch,
  } satisfies GameConnection;
  return {
    inner,
    change(next: GameView, events?: GameEvent[]) {
      view = next;
      if (events) batch = { seq: batch.seq + 1, events };
      for (const l of [...listeners]) l();
    },
  };
}

function manualAnimator() {
  const plays: { batch: EventBatch; resolve: () => void }[] = [];
  const animator: BoardAnimator = {
    play: (batch, _from, _to, commit) =>
      new Promise<void>((resolve) => {
        void commit();
        plays.push({ batch, resolve });
      }),
    finish: vi.fn(),
  };
  return { animator, plays };
}

const TAP: GameEvent[] = [{ type: 'tapped', objectId: 'o1' }];
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('PacedConnection: changes shown without animation are reported for their sound', () => {
  afterEach(() => vi.useRealTimers());

  it('without an animator every change with new events is reported once, with the view before it; a change without events is not', () => {
    const s = scriptedInner();
    const unanimated = vi.fn();
    const paced = new PacedConnection(s.inner, { unanimated });
    paced.subscribe(() => {});
    const v1 = paced.view();
    const v2 = viewWith(2);
    s.change(v2, TAP);
    expect(unanimated).toHaveBeenCalledTimes(1);
    expect(unanimated.mock.calls[0]![0]).toMatchObject({ seq: 1, events: TAP });
    expect(unanimated.mock.calls[0]![1]).toBe(v1);
    expect(unanimated.mock.calls[0]![2]).toBe(v2);
    s.change(viewWith(3)); // an undo or a hand-off: no action, no events
    expect(unanimated).toHaveBeenCalledTimes(1);
  });

  it('an animated change is never reported; a catch-up reports only the newest change, and none when an animation follows it', async () => {
    const s = scriptedInner();
    const unanimated = vi.fn();
    let animate = true;
    const paced = new PacedConnection(s.inner, { unanimated, enabled: () => animate, maxBacklog: 2 });
    const { animator, plays } = manualAnimator();
    paced.attach(animator);
    paced.subscribe(() => {});
    s.change(viewWith(2), TAP);
    expect(plays.length).toBe(1);
    // Three more changes wait; then the animations are turned off: the screen shows all three at once, and only the newest is heard.
    s.change(viewWith(3), TAP);
    s.change(viewWith(4), TAP);
    s.change(viewWith(5), TAP);
    animate = false;
    plays[0]!.resolve();
    await flushPromises();
    expect(unanimated).toHaveBeenCalledTimes(1);
    expect(unanimated.mock.calls[0]![0].seq).toBe(4);
    // With animations on again, a backlog skips its oldest change silently and animates the rest: the animation makes the sound.
    animate = true;
    unanimated.mockClear();
    s.change(viewWith(6), TAP);
    expect(plays.length).toBe(2);
    s.change(viewWith(7), TAP);
    s.change(viewWith(8), TAP);
    plays[1]!.resolve();
    await flushPromises();
    expect(plays.length).toBe(3);
    expect(unanimated).not.toHaveBeenCalled();
  });

  it('a flush (undo, hand-off, the board going away) reports the waiting change it skips to, never the one being animated', async () => {
    const s = scriptedInner();
    const unanimated = vi.fn();
    const paced = new PacedConnection(s.inner, { unanimated });
    const { animator, plays } = manualAnimator();
    paced.attach(animator);
    paced.subscribe(() => {});
    s.change(viewWith(2), TAP);
    const v3 = viewWith(3);
    s.change(v3, TAP);
    const v4 = viewWith(4);
    s.change(v4, TAP);
    expect(plays.length).toBe(1);
    paced.flush();
    expect(unanimated).toHaveBeenCalledTimes(1);
    expect(unanimated.mock.calls[0]![0].seq).toBe(3);
    expect(unanimated.mock.calls[0]![1]).toBe(v3);
    expect(unanimated.mock.calls[0]![2]).toBe(v4);
    // The animation that was running is cut short: flushing again with nothing waiting reports nothing.
    s.change(viewWith(5), TAP);
    expect(plays.length).toBe(2);
    paced.flush();
    expect(unanimated).toHaveBeenCalledTimes(1);
  });

  it("a listener's problem never stops the game", () => {
    const s = scriptedInner();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const paced = new PacedConnection(s.inner, {
      unanimated: () => {
        throw new Error('no sound');
      },
    });
    paced.subscribe(() => {});
    const v2 = viewWith(2);
    s.change(v2, TAP);
    expect(paced.view()).toBe(v2);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('accent alignment (animation speed)', () => {
  it('starts a sound part-way in when the animation is faster, later when it is slower, as is at normal speed', () => {
    // A destroy shatters 0.32 s into its sound and into its animation.
    expect(alignAccent(0.32, 0.32, 1)).toEqual({ offset: 0, delay: 0 });
    // Fast (0.48x): the visual shatter comes at 0.154 s, so the sound starts 0.166 s in.
    expect(alignAccent(0.32, 0.32, 0.48)).toEqual({ offset: 0.166, delay: 0 });
    // Slow (2x): the shatter comes at 0.64 s, so the sound waits 0.32 s.
    const slow = alignAccent(0.32, 0.32, 2);
    expect(slow.offset).toBe(0);
    expect(slow.delay).toBeCloseTo(0.32, 6);
    // A Scryfall picture breaks at 0.22 s: at normal speed the sound starts 0.1 s in.
    expect(alignAccent(0.32, 0.22, 1)).toEqual({ offset: 0.1, delay: 0 });
  });
});
