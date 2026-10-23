/**
 * Stack acceleration (more than 5 objects on the stack speed the resolutions up, back to normal at 5).
 * Client pacing only (board/fx/stackPace.ts):
 * the board's animator plays each resolution faster on a pile above 5, the pacer gives such a change the time to show it, and the computer passes sooner
 * on it. Timing is checked with a fake clock.
 */
import type { Decision, GameEvent, GameObject, GameView } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventBatch, GameConnection } from '../../src/connection/GameConnection';
import { PacedConnection, type BoardAnimator } from '../../src/connection/PacedConnection';
import { Animator } from '../../src/board/fx/Animator';
import { planBatch, type StepA } from '../../src/board/fx/plan';
import type { Vfx } from '../../src/board/fx/vfx';
import {
  RESOLUTION_BUDGET_MS, STACK_PACE_FLOOR, STACK_PACE_THRESHOLD, acceleratedBudgetMs, stackDepths, stackPace,
} from '../../src/board/fx/stackPace';
import { runComputer } from '../../src/game/computer';

afterEach(() => {
  vi.useRealTimers();
});

describe('the pace curve', () => {
  it('normal up to 5 objects; faster with every object above 5, smoothly; never faster than a quarter', () => {
    for (const n of [0, 1, 4, 5]) expect(stackPace(n)).toBe(1);
    expect(STACK_PACE_THRESHOLD).toBe(5);
    const above = Array.from({ length: 40 }, (_, i) => stackPace(6 + i));
    expect(above[0]).toBeLessThan(1);
    expect(above[0]).toBeCloseTo(25 / 36, 6); // 6 objects: (5/6)^2
    for (let i = 1; i < above.length; i++) expect(above[i]!).toBeLessThanOrEqual(above[i - 1]!); // never slower with a bigger pile
    expect(stackPace(8)).toBeCloseTo(0.391, 3);
    expect(stackPace(9)).toBeGreaterThan(STACK_PACE_FLOOR);
    expect(stackPace(10)).toBe(STACK_PACE_FLOOR);
    expect(stackPace(500)).toBe(STACK_PACE_FLOOR);
    // Back down: the same curve, so the pile slows down one resolution at a time and is at normal speed again at 5.
    const down = [14, 10, 9, 8, 7, 6, 5].map(stackPace);
    for (let i = 1; i < down.length; i++) expect(down[i]!).toBeGreaterThanOrEqual(down[i - 1]!);
    expect(down[down.length - 1]).toBe(1);
  });

  it('the stack as each step begins: up with each spell or ability put on it, down after each resolution', () => {
    const steps = [
      { kind: 'ability' }, { kind: 'resolve' }, { kind: 'resolve' }, { kind: 'cast' }, { kind: 'countered' }, { kind: 'resolve' }, { kind: 'combat' },
    ] as StepA[];
    expect(stackDepths(steps, 22)).toEqual([23, 23, 22, 22, 22, 21, 20]);
  });

  it('the pacer gets extra time only for resolutions above 5, at their faster pace: nothing changes on a stack of 5 or fewer', () => {
    const resolves = (n: number) => Array.from({ length: n }, () => ({ kind: 'resolve' }) as StepA);
    expect(acceleratedBudgetMs(resolves(5), 5)).toBe(0);
    expect(acceleratedBudgetMs(resolves(2), 3)).toBe(0);
    expect(acceleratedBudgetMs(resolves(2), 7)).toBe(Math.round(RESOLUTION_BUDGET_MS * (stackPace(7) + stackPace(6))));
  });
});

// ---- the animator, with a fake clock -------------------------------------------------------------------------------------------

const vfx = () => ({ scale: 1, fit: () => {}, clear: () => {}, flare: () => {}, impact: () => {}, motes: () => {} }) as unknown as Vfx;

/** A view with `n` triggered abilities on the stack (nothing drawn: each resolution is just its pause, 140 ms at normal speed, scaled). */
function stackView(n: number): GameView {
  const objects: Record<string, GameObject> = {};
  const stack: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `t${i}`;
    stack.push(id);
    objects[id] = { id, kind: 'ability', defId: 'src', owner: 'p1', controller: 'p1', zone: 'stack', stack: { sourceId: null, sourceName: 'Trigger', targets: [] } } as unknown as GameObject;
  }
  return { viewer: 'p1', players: [], zones: { stack, battlefield: [], command: [], exile: [], hand: {}, library: {}, graveyard: {} }, objects, defs: {}, lki: {} } as unknown as GameView;
}

/** Resolve the top `k` of `n` objects in one change (every player passed: the smart auto-pass). */
function resolveBatch(n: number, k: number): { batch: EventBatch; from: GameView; to: GameView } {
  const from = stackView(n);
  const to = stackView(n - k);
  const events: GameEvent[] = [];
  for (let i = n - 1; i >= n - k; i--) events.push({ type: 'resolved', objectId: `t${i}` });
  return { batch: { seq: 1, events }, from, to };
}

function animator(scale = 1): Animator {
  const root = document.createElement('div');
  (root as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), cancel: () => {} });
  const arena = document.createElement('div');
  const layer = document.createElement('div');
  root.append(arena, layer);
  return new Animator({ root, arena, layer, under: vfx(), over: vfx(), scale: () => scale });
}

/** How long (fake ms) the animator takes to play the change. */
async function playTime(a: Animator, batch: EventBatch, from: GameView, to: GameView): Promise<number> {
  vi.useFakeTimers();
  let done = false;
  const start = Date.now();
  void a.play(batch, from, to, async () => {}).then(() => (done = true));
  let elapsed = 0;
  while (!done && elapsed < 60_000) {
    await vi.advanceTimersByTimeAsync(1);
    elapsed = Date.now() - start;
  }
  return elapsed;
}

describe('the animator plays a big pile faster (fake clock)', () => {
  it('each resolution on a stack of 5 or fewer takes its normal time', async () => {
    const { batch, from, to } = resolveBatch(5, 5);
    expect(planBatch(batch.events, from, to).a.map((s) => s.kind)).toEqual(Array(5).fill('resolve'));
    expect(await playTime(animator(), batch, from, to)).toBe(5 * 140);
  });

  it('above 5 each resolution is faster with the pile, and back at normal speed from 5 down (the player\'s speed setting multiplies it)', async () => {
    const { batch, from, to } = resolveBatch(12, 10); // 12 .. 3 objects as each resolves
    const expected = (base: number) =>
      Array.from({ length: 10 }, (_, i) => 12 - i).reduce((t, d) => t + Math.round(140 * Math.max(0.2, base * stackPace(d))), 0);
    const normal = await playTime(animator(1), batch, from, to);
    expect(normal).toBe(expected(1));
    expect(normal).toBeLessThan(10 * 140);
    // The last three (5 .. 3) still take their full 140 ms each: decelerated back to normal.
    expect(normal - 3 * 140).toBe(Array.from({ length: 7 }, (_, i) => 12 - i).reduce((t, d) => t + Math.round(140 * stackPace(d)), 0));
    vi.useRealTimers();
    const slow = await playTime(animator(1.7), batch, from, to);
    expect(slow).toBe(expected(1.7));
    vi.useRealTimers();
    const fast = await playTime(animator(0.6), batch, from, to);
    expect(fast).toBe(expected(0.6)); // capped by the animator's floor (0.2 of normal) so it stays readable
  });
});

// ---- the pacer's deadline --------------------------------------------------------------------------------------------------

describe('the pacer: an accelerated pile gets the time to be shown', () => {
  it('the deadline function gets the change, so it can add the faster resolutions\' time', async () => {
    let view = stackView(12);
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
      canUndo: () => false,
      undo: () => false,
      handoff: () => null,
      acceptHandoff: () => {},
      events: () => batch,
    } satisfies GameConnection;
    const deadline = vi.fn((b: EventBatch, from: GameView, to: GameView) => 6000 + acceleratedBudgetMs(planBatch(b.events, from, to).a, from.zones.stack.length));
    const paced = new PacedConnection(inner, { deadlineMs: deadline });
    paced.subscribe(() => {});
    const animator: BoardAnimator = { play: () => new Promise<void>(() => {}), finish: () => {} };
    paced.attach(animator);
    const change = resolveBatch(12, 9);
    view = change.to;
    batch = change.batch;
    for (const l of [...listeners]) l();
    expect(deadline).toHaveBeenCalledTimes(1);
    const [b, from, to] = deadline.mock.calls[0]!;
    expect(b.events).toHaveLength(9);
    expect(from.zones.stack).toHaveLength(12);
    expect(to.zones.stack).toHaveLength(3);
    // 7 resolutions above 5 (12 .. 6) get their budget at their pace; the two at 5 and 4 none.
    expect(deadline.mock.results[0]!.value).toBe(6000 + Math.round(Array.from({ length: 7 }, (_, i) => RESOLUTION_BUDGET_MS * stackPace(12 - i)).reduce((a, x) => a + x, 0)));
  });
});

// ---- the computer's pause ----------------------------------------------------------------------------------------------------

describe('the computer passes sooner on a big pile (fake clock)', () => {
  function seat(stackSize: number) {
    const d = { id: 'd1', kind: 'priority', player: 'p2', prompt: '' } as unknown as Decision;
    let v = { ...stackView(stackSize), viewer: 'p2', pending: d, result: null } as unknown as GameView;
    const act = vi.fn(async () => {
      v = { ...v, pending: null } as GameView;
      return { ok: true as const };
    });
    const conn = {
      kind: 'local' as const, view: () => v, legalActions: () => [], act, subscribe: () => () => {}, canUndo: () => false, undo: () => false,
      handoff: () => null, acceptHandoff: () => {},
    } satisfies GameConnection;
    return { conn, act };
  }

  it.each([
    [3, 750],
    [5, 750],
    [7, Math.round(750 * stackPace(7))],
    [60, Math.round(750 * STACK_PACE_FLOOR)],
  ])('with %i objects on the stack it waits %i ms (750 at normal speed)', async (n, wait) => {
    vi.useFakeTimers();
    const { conn, act } = seat(n);
    const stop = runComputer(conn, { delayMs: 750, seed: 's', choose: (_v, d) => ({ type: 'pass', player: d.player }) });
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(act).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(act).toHaveBeenCalledWith({ type: 'pass', player: 'p2' });
    stop();
  });
});

// ---- the commander damage pop (M11-2, CR 903.10a) ----------------------------------------------------------------------------

describe('the animator pops a commander damage line on its event', () => {
  it("the line of that commander on the damaged player's disc, and no other", async () => {
    const root = document.createElement('div');
    (root as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), cancel: () => {} });
    const arena = document.createElement('div');
    const layer = document.createElement('div');
    const panel = (player: string, card: string) => {
      const p = document.createElement('section');
      p.dataset.fx = 'avatar';
      p.dataset.playerId = player;
      const line = document.createElement('span');
      line.dataset.commanderDamage = card;
      const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: () => {} }));
      (line as unknown as { animate: typeof animate }).animate = animate;
      p.append(line);
      root.append(p);
      return animate;
    };
    const hit = panel('p1', 'card-kraum');
    const otherCard = panel('p1', 'card-tymna');
    const otherPlayer = panel('p2', 'card-kraum');
    root.append(arena, layer);
    const a = new Animator({ root, arena, layer, under: vfx(), over: vfx(), scale: () => 1 });
    const v = stackView(0);
    const events: GameEvent[] = [{ type: 'commanderDamage', player: 'p1', commander: 'card-kraum', source: 'o9', amount: 5, total: 17 }];
    await playTime(a, { seq: 2, events }, v, v);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(otherCard).not.toHaveBeenCalled();
    expect(otherPlayer).not.toHaveBeenCalled();
  });
});

