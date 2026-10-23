/**
 * ui/arena: the event feed (GameConnection.events) and the pacing connection that shows each change after the board animated it.
 * - LocalConnection gives each applied action's events, redacted for the player on screen (CR 400.2), with a sequence number that only actions advance.
 * - PacedConnection shows changes one at a time, refuses a click on a stale prompt (CR 117.3), and never holds a change back without an animator.
 */
import { GameSession, type Action, type GameEvent, type GameView } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventBatch, GameConnection } from '../src/connection/GameConnection';
import { LocalConnection } from '../src/connection/LocalConnection';
import { BUSY_MESSAGE, PacedConnection, type BoardAnimator } from '../src/connection/PacedConnection';
import { eventsForViewer } from '../src/connection/redactEvents';
import { smallConfig } from './helpers';

type ZoneChanged = Extract<GameEvent, { type: 'zoneChanged' }>;

/** Pass priority for whoever has it (p1 here; the computer seat p2 through its own connection) until `until` holds or the step budget runs out. */
async function passUntil(conn: LocalConnection, until: () => boolean, steps = 60): Promise<void> {
  const p2 = conn.seat('p2');
  for (let i = 0; i < steps && !until(); i++) {
    const d = conn.view().pending;
    if (!d) return;
    const seat = d.player === 'p1' ? conn : p2;
    const sd = seat.view().pending!;
    let a: Action;
    if (sd.kind === 'priority') a = { type: 'pass', player: sd.player };
    else if (sd.kind === 'chooseObjects') a = { type: 'answer', player: sd.player, decisionId: sd.id, answer: { kind: 'chooseObjects', ids: sd.options.slice(0, sd.min) } };
    else throw new Error(`unexpected decision ${sd.kind}`);
    const r = await seat.act(a);
    if (!r.ok) throw new Error(r.error.message);
  }
}

describe('GameConnection.events (LocalConnection)', () => {
  it('starts empty, advances once per applied action, and keeps its number across a hand-off', async () => {
    const conn = new LocalConnection(smallConfig('ev-seq', { options: { skipMulligans: true, startingPlayer: 'p1' } }), { seats: ['p1'] });
    expect(conn.events()).toEqual({ seq: 0, events: [] });
    let seq = 0;
    await passUntil(conn, () => {
      expect(conn.events().seq).toBe(seq++ === 0 ? 0 : conn.events().seq);
      return conn.events().events.length > 0;
    });
    const after = conn.events();
    expect(after.seq).toBeGreaterThan(0);
    expect(after.events.length).toBeGreaterThan(0);
    expect(conn.events()).toBe(after); // stable between changes, like view()
    const hot = new LocalConnection(smallConfig('ev-seq-hot', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    hot.acceptHandoff();
    expect(hot.events().seq).toBe(0); // a hand-off is no action
  });

  it("CR 400.2: a card moving into the opponent's hand names no card and links no new object for the viewer", async () => {
    const conn = new LocalConnection(smallConfig('ev-draw', { options: { skipMulligans: true, startingPlayer: 'p1' } }), { seats: ['p1'] });
    // Play until the opponent has drawn (the engine reports a draw as `drew`, with the new hand object's id only).
    let drew: GameEvent | undefined;
    await passUntil(conn, () => (drew = conn.events().events.find((e) => e.type === 'drew' && e.player === 'p2')) !== undefined, 120);
    expect(drew, 'the opponent drew').toBeDefined();
    const state = conn.session.state;
    const oppCard = state.zones.hand.p2![0]!;
    const moved: ZoneChanged = { type: 'zoneChanged', oldId: 'gone', newId: oppCard, from: 'battlefield', to: 'hand', owner: 'p2', controller: 'p2', name: 'Secret' };
    const [seen] = eventsForViewer(state, [moved], 'p1');
    expect(seen).toMatchObject({ type: 'zoneChanged', name: '', newId: null });
    expect((seen as ZoneChanged).before).toBeUndefined();
    const [own] = eventsForViewer(state, [moved], 'p2');
    expect(own).toMatchObject({ name: 'Secret', newId: oppCard });
  });

  it('a spectator (hot-seat hand-off view) sees no card drawn by anyone', () => {
    const s = new GameSession(smallConfig('ev-spectator', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    const hand = s.state.zones.hand.p1!;
    const draw: ZoneChanged = { type: 'zoneChanged', oldId: 'old', newId: hand[0]!, from: 'library', to: 'hand', owner: 'p1', controller: 'p1', name: 'Secret' };
    const [seen] = eventsForViewer(s.state, [draw], null);
    expect(seen).toMatchObject({ type: 'zoneChanged', name: '', newId: null });
    const [own] = eventsForViewer(s.state, [draw], 'p1');
    expect(own).toMatchObject({ name: 'Secret', newId: hand[0] });
  });
});

// ---- PacedConnection with a scripted inner connection ----------------------------------------------------------------------

function viewWith(decisionId: number, player = 'p1'): GameView {
  return { pending: { id: decisionId, player, kind: 'priority', prompt: '' }, players: [], zones: {}, objects: {} } as unknown as GameView;
}

function scriptedInner() {
  let view = viewWith(1);
  let batch: EventBatch = { seq: 0, events: [] };
  let handoff: string | null = null;
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
    handoff: () => handoff,
    acceptHandoff: vi.fn(),
    events: () => batch,
  } satisfies GameConnection;
  return {
    inner,
    /** A new view; with `events`, as the result of a new action. */
    change(next: GameView, events?: GameEvent[], nextHandoff: string | null = null) {
      view = next;
      handoff = nextHandoff;
      if (events) batch = { seq: batch.seq + 1, events };
      for (const l of [...listeners]) l();
    },
  };
}

const TAP: GameEvent[] = [{ type: 'tapped', objectId: 'o1' }];

/** An animator whose plays are resolved by the test. */
function manualAnimator() {
  const plays: { batch: EventBatch; from: GameView; to: GameView; commit: () => Promise<void>; resolve: () => void }[] = [];
  const animator: BoardAnimator & { finish: ReturnType<typeof vi.fn> } = {
    play: (batch, from, to, commit) => new Promise<void>((resolve) => plays.push({ batch, from, to, commit, resolve })),
    finish: vi.fn(),
  };
  return { animator, plays };
}

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('PacedConnection', () => {
  afterEach(() => vi.useRealTimers());

  it('without an animator, every change is shown at once', () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    const seen = vi.fn();
    paced.subscribe(seen);
    const v2 = viewWith(2);
    s.change(v2, TAP);
    expect(paced.view()).toBe(v2);
    expect(paced.busy()).toBe(false);
    expect(seen).toHaveBeenCalled();
  });

  it('with an animator, a change waits for its animation: from, commit, then the next change in order', async () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    paced.subscribe(() => {});
    const { animator, plays } = manualAnimator();
    paced.attach(animator);
    const v1 = paced.view();
    const v2 = viewWith(2);
    const v3 = viewWith(3);
    s.change(v2, TAP);
    s.change(v3, TAP);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.from).toBe(v1);
    expect(plays[0]!.to).toBe(v2);
    expect(plays[0]!.batch.events).toEqual(TAP);
    expect(paced.view()).toBe(v1); // still the old view during the first half of the animation
    expect(paced.busy()).toBe(true);
    const committed = plays[0]!.commit();
    expect(paced.view()).toBe(v2);
    paced.committed(v2);
    await committed;
    plays[0]!.resolve();
    await flushPromises();
    expect(plays).toHaveLength(2); // the second change starts only now
    expect(plays[1]!.from).toBe(v2);
    plays[1]!.resolve();
    await flushPromises();
    expect(paced.view()).toBe(v3); // shown even though the animator never committed
    expect(paced.busy()).toBe(false);
  });

  it('a change without new events (undo, hand-off, stop toggle) is shown at once', () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    paced.subscribe(() => {});
    const { animator, plays } = manualAnimator();
    paced.attach(animator);
    const v2 = viewWith(2);
    s.change(v2); // same seq
    expect(plays).toHaveLength(0);
    expect(paced.view()).toBe(v2);
  });

  it('CR 400.2: a change that hands the screen to another player plays out on its (spectator) view first, then the cover comes', async () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    paced.subscribe(() => {});
    const { animator, plays } = manualAnimator();
    paced.attach(animator);
    const spectator = viewWith(2, 'p2');
    s.change(spectator, TAP, 'p2');
    expect(plays).toHaveLength(1);
    expect(paced.handoff()).toBeNull();
    const committed = plays[0]!.commit();
    expect(paced.view()).toBe(spectator); // the view handed over: the spectator view, every hand hidden
    expect(paced.handoff()).toBeNull(); // the cover waits for the end of the animation
    expect(paced.legalActions()).toEqual([]);
    paced.committed(spectator);
    await committed;
    plays[0]!.resolve();
    await flushPromises();
    expect(paced.handoff()).toBe('p2');
  });

  it('CR 117.3: an action on a stale prompt is refused while the board catches up; one on the current decision and a concession go through', async () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    paced.subscribe(() => {});
    const { animator } = manualAnimator();
    paced.attach(animator);
    s.change(viewWith(2), TAP); // the game moved on to decision 2; the screen still shows decision 1
    const stale = await paced.act({ type: 'pass', player: 'p1' });
    expect(stale).toEqual({ ok: false, error: { message: BUSY_MESSAGE, rules: [] } });
    expect(s.inner.act).not.toHaveBeenCalled();
    const concede = await paced.act({ type: 'concede', player: 'p1' });
    expect(concede.ok).toBe(true);
    expect(s.inner.act).toHaveBeenCalledTimes(1);

    const s2 = scriptedInner();
    const paced2 = new PacedConnection(s2.inner);
    paced2.subscribe(() => {});
    paced2.attach(manualAnimator().animator);
    s2.change(viewWith(1), TAP); // same decision (a mana ability, say): the player may keep acting
    expect(paced2.busy()).toBe(true);
    expect((await paced2.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
  });

  it('undo and accepting a hand-off skip to the latest change first, cutting the animation short', () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    paced.subscribe(() => {});
    const { animator } = manualAnimator();
    paced.attach(animator);
    const v2 = viewWith(2);
    const v3 = viewWith(3);
    s.change(v2, TAP);
    s.change(v3, TAP);
    expect(paced.canUndo()).toBe(false); // never while catching up
    paced.undo();
    expect(animator.finish).toHaveBeenCalled();
    expect(paced.view()).toBe(v3);
    expect(paced.busy()).toBe(false);
    expect(s.inner.undo).toHaveBeenCalled();
  });

  it('a stuck animation is cut off at the deadline; animations off or a long backlog skip animating', async () => {
    vi.useFakeTimers();
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner, { deadlineMs: 1000 });
    paced.subscribe(() => {});
    const { animator, plays } = manualAnimator();
    paced.attach(animator);
    const v2 = viewWith(2);
    s.change(v2, TAP);
    expect(plays).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(animator.finish).toHaveBeenCalled();
    expect(paced.view()).toBe(v2);

    let on = false;
    const s2 = scriptedInner();
    const off = new PacedConnection(s2.inner, { enabled: () => on });
    off.subscribe(() => {});
    const m2 = manualAnimator();
    off.attach(m2.animator);
    s2.change(viewWith(5), TAP);
    expect(m2.plays).toHaveLength(0);
    on = true;
    s2.change(viewWith(6), TAP);
    expect(m2.plays).toHaveLength(1);
  });

  it('detaching the animator (the board left the screen) shows the latest change', () => {
    const s = scriptedInner();
    const paced = new PacedConnection(s.inner);
    paced.subscribe(() => {});
    const { animator } = manualAnimator();
    const detach = paced.attach(animator);
    const v2 = viewWith(2);
    s.change(v2, TAP);
    detach();
    expect(paced.view()).toBe(v2);
    expect(paced.busy()).toBe(false);
  });
});
