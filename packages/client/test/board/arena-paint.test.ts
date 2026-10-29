/**
 * ui/arena performance (review 2026-10-26 F20-F23): the animator animates only transforms and opacity (shadows and glows are painted once on layers of
 * their own and fade), measures the new view one frame after it is committed in one read pass (finish() cancels that wait), reads a card picture's
 * computed transform only when its card is turned, and breaks a card into six pieces at most (a crowd breaking at once falls away whole).
 */
import type { GameEvent, GameView } from '@openmtg/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBatch } from '../../src/connection/GameConnection';
import { Animator } from '../../src/board/fx/Animator';
import { chunkPolygons, snapshotBoard } from '../../src/board/fx/dom';
import type { Vfx } from '../../src/board/fx/vfx';

interface Played {
  el: Element;
  frames: Keyframe[];
}

let played: Played[] = [];
const realAnimate = (Element.prototype as { animate?: unknown }).animate;

beforeEach(() => {
  played = [];
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: Element, frames: Keyframe[]) {
      played.push({ el: this, frames });
      return { finished: Promise.resolve(), cancel: () => {} };
    },
  });
});

afterEach(() => {
  if (realAnimate === undefined) delete (Element.prototype as { animate?: unknown }).animate;
  else Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: realAnimate });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** A canvas that draws nothing. */
const vfx = () =>
  new Proxy({ scale: 1 } as Record<string | symbol, unknown>, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => {}) }) as unknown as Vfx;

function div(cls: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

/** A board on the page: a table with cards and Bob's disc. */
function board(cards: string[]) {
  const root = div('game-board');
  const arena = div('arena');
  arena.dataset.fx = 'arena';
  const layer = div('fx-ghosts');
  for (const id of cards) {
    const card = div('board-card');
    card.dataset.objectId = id;
    card.appendChild(div('board-card-image'));
    arena.appendChild(card);
  }
  const panel = document.createElement('section');
  panel.dataset.fx = 'avatar';
  panel.dataset.playerId = 'p2';
  const disc = div('avatar-disc');
  const life = document.createElement('span');
  life.className = 'stat stat-life';
  life.textContent = '20';
  disc.appendChild(life);
  panel.appendChild(disc);
  root.append(arena, panel, layer);
  document.body.appendChild(root);
  return { root, arena, layer };
}

function view(cards: string[], life: number): GameView {
  const objects = Object.fromEntries(cards.map((id) => [id, { id, kind: 'card', owner: 'p1', controller: 'p1', zone: 'battlefield', defId: 'x', counters: {}, damage: 0, tapped: false, face: 0 }]));
  return {
    viewer: 'p1',
    players: [
      { id: 'p1', name: 'Alice', life: 20 },
      { id: 'p2', name: 'Bob', life },
    ],
    objects,
    defs: {},
    lki: {},
    zones: { stack: [], battlefield: cards, hand: {}, library: {}, graveyard: {}, exile: [], command: [] },
  } as unknown as GameView;
}

/** Play a change to its end on a fake clock. */
async function play(a: Animator, batch: EventBatch, from: GameView, to: GameView): Promise<void> {
  vi.useFakeTimers();
  let done = false;
  void a.play(batch, from, to, async () => {}).then(() => (done = true));
  for (let t = 0; !done && t < 20_000; t += 5) await vi.advanceTimersByTimeAsync(5);
  expect(done).toBe(true);
  // The stand-in animations end at once: what is timed to them (a blow landing) comes later.
  await vi.advanceTimersByTimeAsync(1000);
}

const PAINTED = ['boxShadow', 'textShadow', 'letterSpacing', 'filter'];

describe('the animator animates only transforms and opacity (F20)', () => {
  it('a combat blow, its life loss and a new turn: shadows and glows fade on layers of their own, and leave the board afterwards', async () => {
    const { root, arena, layer } = board(['c1']);
    const a = new Animator({ root, arena, layer, under: vfx(), over: vfx(), scale: () => 1 });
    const events: GameEvent[] = [
      { type: 'lifeChanged', player: 'p2', delta: -3, life: 17 },
      { type: 'damageDealt', source: 'c1', target: 'p2', amount: 3, combat: true },
      { type: 'turnBegan', turn: 2, activePlayer: 'p2' },
    ] as GameEvent[];
    await play(a, { seq: 1, events }, view(['c1'], 20), view(['c1'], 17));
    expect(played.length).toBeGreaterThan(0);
    for (const p of played) for (const f of p.frames) for (const k of PAINTED) expect(f, `${(p.el as HTMLElement).className} ${k}`).not.toHaveProperty(k);
    // The swinging creature's rest, high and lift shadows crossfade; the disc's red glow flashes; the life total's glow is a copy of it.
    const glows = played.filter((p) => p.el.matches('.fx-glow'));
    expect(new Set(glows.map((p) => (p.el as HTMLElement).dataset.glow))).toEqual(new Set(['rest', 'high', 'lift', 'hit']));
    for (const p of glows) for (const f of p.frames) expect(Object.keys(f).filter((k) => k !== 'offset' && k !== 'easing')).toEqual(expect.arrayContaining(['opacity']));
    expect(played.some((p) => p.el.matches('.fx-text-glow'))).toBe(true);
    expect(root.querySelectorAll('.fx-glow, .fx-text-glow')).toHaveLength(0);
  });

  it('a destroyed card of our own frame breaks into six pieces at most; three or more at once fall away whole', async () => {
    const shards = async (n: number) => {
      played = [];
      document.body.innerHTML = '';
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const { root, arena, layer } = board(ids);
      const a = new Animator({ root, arena, layer, under: vfx(), over: vfx(), scale: () => 1 });
      const events = ids.map((id, i) => ({ type: 'zoneChanged', oldId: id, newId: `g${i}`, from: 'battlefield', to: 'graveyard', owner: 'p1', controller: 'p1', name: 'Bear' })) as GameEvent[];
      await play(a, { seq: 1, events }, view(ids, 20), view([], 20));
      return new Set(played.filter((p) => p.el.matches('.fx-shard')).map((p) => p.el)).size;
    };
    expect(await shards(1)).toBe(6);
    expect(await shards(3)).toBe(3);
    for (let seed = 1; seed < 200; seed++) expect(chunkPolygons(2, 3, seed, 6)).toHaveLength(6);
    for (let seed = 1; seed < 200; seed++) expect(chunkPolygons(3, 3, seed, 6).length).toBeGreaterThanOrEqual(9);
  });
});

describe('the new view is measured one frame after it is committed (F22)', () => {
  it('waits for the frame, and finish() cancels the wait', async () => {
    let frame: FrameRequestCallback | null = null;
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb;
      return 7;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const { root, arena, layer } = board([]);
    const a = new Animator({ root, arena, layer, under: vfx(), over: vfx(), scale: () => 1 });
    const v = view([], 20);
    let committed = false;
    let done = false;
    void a.play({ seq: 1, events: [] }, v, v, async () => void (committed = true)).then(() => (done = true));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(committed).toBe(true);
    expect(frame).not.toBeNull();
    expect(done).toBe(false);
    a.finish();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(done).toBe(true);
  });
});

describe('the board is measured without reading every card\'s style (F23)', () => {
  it('only a turned (tapped) card\'s picture has its computed transform read', () => {
    const { root, arena } = board(['a', 'b', 'c']);
    arena.querySelector('[data-object-id="b"]')!.classList.add('is-tapped');
    const spy = vi.spyOn(window, 'getComputedStyle');
    const snap = snapshotBoard(root);
    expect(snap.cards.size).toBe(3);
    expect(spy.mock.calls.map(([el]) => (el as HTMLElement).closest<HTMLElement>('[data-object-id]')?.dataset.objectId)).toEqual(['b']);
    spy.mockRestore();
  });
});
