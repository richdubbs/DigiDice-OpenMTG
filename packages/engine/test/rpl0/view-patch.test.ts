/**
 * RPL-0 (replays design 4 "Recording frames"): the view patches of milestone 13 (core/view-patch.ts, moved from packages/hosted/src/api/patch.ts on the
 * parked m13 branch, with its tests, test/m13-1/patch.test.ts there). Pure diffs of two views of the same viewer rebuild the next view exactly, on
 * hand-made values and on real engine views of seeded AI-against-AI games (packages/ai/test/harness.ts), for each seat, the public view and the open view.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatch, applyViewPatch, diffJson, diffViews, jsonEqual, nextView, openView, PATCH_MAX_WORK, PatchError, viewFor, type GameState, type GameView, type PatchOp,
  type PlayerId,
} from '../../src/index';
import { aiGame } from './games';

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Diff, send as JSON, apply to the parsed previous value: the JSON text of the result is the JSON text of `next`. */
function rebuilds(prev: unknown, next: unknown): PatchOp[] {
  const ops = diffJson(prev, next);
  const sent = roundTrip(ops);
  const out = applyPatch(roundTrip(prev), sent);
  expect(JSON.stringify(out)).toBe(JSON.stringify(next));
  return ops;
}

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

function refusedPatch(apply: () => unknown): void {
  let error: unknown;
  try {
    apply();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(PatchError);
  expect((error as Error).message).toMatch(/more work than/);
}

function at(root: unknown, path: readonly (string | number)[]): unknown {
  let cur = root;
  for (const seg of path) cur = (cur as Record<string | number, unknown>)[seg];
  return cur;
}

describe('RPL-0 (M13-1): diffJson and applyPatch on fixed values', () => {
  const cases: [string, unknown, unknown][] = [
    ['equal values', { a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }],
    ['a changed number deep inside', { p: { life: 20, hand: ['x'] } }, { p: { life: 17, hand: ['x'] } }],
    ['a key added and one deleted', { a: 1, b: 2 }, { a: 1, c: 3 }],
    ['keys reordered', { a: 1, b: 2, c: 3 }, { c: 3, a: 1, b: 2 }],
    ['a key added in the middle of the order', { a: 1, c: 3 }, { a: 1, b: 2, c: 3 }],
    ['integer-like keys (JavaScript orders them first)', { b: 1, '2': 2 }, { b: 1, '1': 0, '2': 2, a: 5 }],
    ['a list appended to', { log: [{ t: 1 }, { t: 2 }] }, { log: [{ t: 1 }, { t: 2 }, { t: 3 }, { t: 4 }] }],
    ['a list cut short', { l: [1, 2, 3, 4] }, { l: [1, 2] }],
    ['an element removed from the middle', { l: ['a', 'b', 'c', 'd', 'e'] }, { l: ['a', 'b', 'd', 'e'] }],
    ['an element inserted at the front', { l: ['a', 'b'] }, { l: ['z', 'a', 'b'] }],
    ['a list shuffled', { l: [1, 2, 3, 4, 5, 6] }, { l: [6, 3, 1, 5, 2, 4] }],
    ['an element changed in place and the list grown', { l: [{ n: 1 }, { n: 2 }] }, { l: [{ n: 1 }, { n: 9 }, { n: 3 }] }],
    ['types changed', { a: [1], b: { x: 1 }, c: 'x', d: null }, { a: { 0: 1 }, b: [1], c: null, d: 0 }],
    ['the root replaced', [1, 2], { a: 1 }],
    ['a primitive root', 3, 'three'],
    ['empty containers', { a: {}, b: [] }, { a: { k: [] }, b: [{}] }],
    ['unicode text', { s: 'Ætherling' }, { s: 'Jötun Grunt 🐉' }],
  ];
  for (const [name, prev, next] of cases) {
    it(`rebuilds exactly: ${name}`, () => {
      const ops = rebuilds(prev, next);
      if (jsonEqual(prev, next)) expect(ops).toEqual([]);
    });
  }

  it('treats undefined as JSON does (an absent key; null in a list)', () => {
    const prev = { a: 1, gone: undefined, l: [undefined, 2] };
    const next = { a: 1, b: undefined, l: [null, 2], c: 2 };
    expect(diffJson(prev, next)).toEqual([{ op: 'set', path: ['c'], value: 2 }]);
    expect(JSON.stringify(applyPatch(prev, diffJson(prev, next)))).toBe(JSON.stringify(next));
    // A key that is present but undefined in the base counts as absent: setting it puts it last, as in `next`.
    const base = { x: undefined, y: 1 };
    expect(JSON.stringify(applyPatch(base, diffJson(base, { y: 1, x: 2 })))).toBe('{"y":1,"x":2}');
  });

  it('never changes its input, and shares what did not change', () => {
    const prev = deepFreeze({ a: { deep: [1, 2, 3] }, b: { untouched: { n: 1 } }, c: [{ k: 1 }] });
    const next = { a: { deep: [1, 2, 3, 4] }, b: { untouched: { n: 1 } }, c: [{ k: 2 }] };
    const out = applyPatch(prev, diffJson(prev, next));
    expect(out).toEqual(next);
    expect(out.b).toBe(prev.b);
    expect(prev.a.deep).toEqual([1, 2, 3]);
  });

  it('keeps "__proto__" a plain key, as JSON.parse does (no prototype change)', () => {
    const prev = JSON.parse('{"defs":{"x":1}}') as Record<string, unknown>;
    const next = JSON.parse('{"defs":{"x":1,"__proto__":{"polluted":true}}}') as Record<string, unknown>;
    const ops = roundTrip(diffJson(prev, next));
    const out = applyPatch(prev, ops) as { defs: Record<string, unknown> };
    expect(JSON.stringify(out)).toBe(JSON.stringify(next));
    expect(Object.getPrototypeOf(out.defs)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out.defs, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // and deleting it again
    expect(JSON.stringify(applyPatch(out, diffJson(out, prev)))).toBe(JSON.stringify(prev));
  });

  it('refuses ops that do not fit (PatchError; a replay then falls back to the frame\'s key view)', () => {
    const v = { a: { b: [1, 2] }, s: 'x' };
    const bad: unknown[] = [
      [{ op: 'set', path: ['missing', 'x'], value: 1 }],
      [{ op: 'set', path: ['a', 'b', 5], value: 1 }],
      [{ op: 'set', path: ['a', 'b', 'k'], value: 1 }],
      [{ op: 'set', path: ['a', 0], value: 1 }],
      [{ op: 'set', path: ['s', 'x'], value: 1 }],
      [{ op: 'set', path: ['a'] }],
      [{ op: 'del', path: ['nope'] }],
      [{ op: 'del', path: [] }],
      [{ op: 'del', path: ['a', 'b', 0] }],
      [{ op: 'splice', path: ['a', 'b'], at: 3, del: 0, add: [] }],
      [{ op: 'splice', path: ['a', 'b'], at: 1, del: 2, add: [] }],
      [{ op: 'splice', path: ['a', 'b'], at: -1, del: 0, add: [] }],
      [{ op: 'splice', path: ['a', 'b'], at: 0, del: 0, add: 'x' }],
      [{ op: 'splice', path: ['a'], at: 0, del: 0, add: [] }],
      [{ op: 'keys', path: ['a'], keys: ['b', 'c'] }],
      [{ op: 'keys', path: ['a'], keys: [] }],
      [{ op: 'keys', path: ['a', 'b'], keys: [] }],
      [{ op: 'move', path: ['a'] }],
      [{ op: 'set', path: 'a', value: 1 }],
      [{ op: 'set', path: [1.5], value: 1 }],
      [null],
      'not a list',
    ];
    for (const ops of bad) expect(() => applyPatch(v, ops as PatchOp[]), JSON.stringify(ops)).toThrow(PatchError);
    expect(v).toEqual({ a: { b: [1, 2] }, s: 'x' });
  });

  it('nextView: applies a patch to the view of its base only', () => {
    const v1 = { viewer: 'p1', turn: 1 } as unknown as GameView;
    const v2 = { viewer: 'p1', turn: 2 } as unknown as GameView;
    const ops = diffViews(v1, v2);
    expect(nextView({ seq: 4, view: v1 }, { seq: 5, base: 4, ops })).toEqual({ seq: 5, view: v2 });
    expect(nextView({ seq: 3, view: v1 }, { seq: 5, base: 4, ops })).toBeNull();
    expect(nextView(null, { seq: 5, base: 4, ops })).toBeNull();
    expect(nextView({ seq: 4, view: v1 }, { seq: 4, base: 4, ops })).toBeNull();
    expect(nextView({ seq: 4, view: v1 }, { seq: 5, base: 4, ops: [{ op: 'del', path: ['nope'] }] })).toBeNull();
  });

  it('nextView: the result must be a view of the same viewer (a root set to 42, null, a list or the view of another seat is refused)', () => {
    const v1 = { viewer: 'p1', turn: 1 } as unknown as GameView;
    for (const value of [42, null, 'view', [1, 2], { viewer: 'p2', turn: 2 }, { turn: 2 }]) {
      expect(nextView({ seq: 1, view: v1 }, { seq: 2, base: 1, ops: [{ op: 'set', path: [], value }] }), JSON.stringify(value)).toBeNull();
    }
    expect(nextView({ seq: 1, view: v1 }, { seq: 2, base: 1, ops: [{ op: 'del', path: ['viewer'] }] })).toBeNull();
    expect(nextView({ seq: 1, view: v1 }, { seq: 2, base: 1, ops: [{ op: 'set', path: ['viewer'], value: 'p2' }] })).toBeNull();
    // a spectator view (viewer null) stays a spectator view
    const spectator = { viewer: null, turn: 1 } as unknown as GameView;
    expect(nextView({ seq: 1, view: spectator }, { seq: 2, base: 1, ops: [{ op: 'set', path: ['turn'], value: 2 }] })?.view).toEqual({ viewer: null, turn: 2 });
  });

  it('applies a splice of 500,000 elements (no argument spreading: Safari caps call arguments near 65,536)', () => {
    const n = 500_000;
    const prev = { log: [0, 1, 2] };
    const add = Array.from({ length: n }, (_, i) => i + 3);
    const ops: PatchOp[] = [{ op: 'splice', path: ['log'], at: 1, del: 1, add }];
    refusedPatch(() => applyPatch(prev, ops)); // more work than PATCH_MAX_WORK
    const big = { maxWork: 2_000_000 };
    const out = applyPatch(prev, ops, big);
    expect(out.log).toHaveLength(n + 2);
    expect(out.log.slice(0, 3)).toEqual([0, 3, 4]);
    expect(out.log[out.log.length - 1]).toBe(2);
    expect(prev.log).toEqual([0, 1, 2]);
    // and the diff of such a change, applied, rebuilds it
    const next = { log: [...prev.log, ...add] };
    expect(applyPatch(prev, diffJson(prev, next), big).log).toHaveLength(n + 3);
  });

  it('RPL-0 review: a patch costs bounded work, whatever its size on file (2,000 splices on a list of a million entries hung playback)', () => {
    const million = { viewer: 'p1', log: new Array<number>(1_000_000).fill(0) } as unknown as GameView;
    const noop: PatchOp = { op: 'splice', path: ['log'], at: 0, del: 0, add: [] };
    const t0 = Date.now();
    // Copying the million-entry list for the patch is over the bound already: refused before the copy.
    refusedPatch(() => applyViewPatch(million, new Array<PatchOp>(2000).fill(noop)));
    expect(Date.now() - t0).toBeLessThan(1000);
    // Within the bound, a no-op splice moves nothing (native splice), and inserting at the front moves the whole list each time: refused once the
    // moves pass the bound, long before 2,000 of them.
    const large = { viewer: 'p1', log: new Array<number>(100_000).fill(0) } as unknown as GameView;
    const t1 = Date.now();
    expect(applyViewPatch(large, new Array<PatchOp>(2000).fill(noop)).log).toHaveLength(100_000);
    const front: PatchOp = { op: 'splice', path: ['log'], at: 0, del: 0, add: [1] };
    refusedPatch(() => applyViewPatch(large, new Array<PatchOp>(2000).fill(front)));
    expect(Date.now() - t1).toBeLessThan(1000);
    // Every op counts, and so does reordering keys.
    refusedPatch(() => applyPatch({ a: 1 }, new Array<PatchOp>(PATCH_MAX_WORK).fill({ op: 'set', path: ['a'], value: 2 })));
    expect(applyPatch({ a: 1, b: 2 }, [{ op: 'keys', path: [], keys: ['b', 'a'] }], { maxWork: 10 })).toEqual({ b: 2, a: 1 });
    refusedPatch(() => applyPatch({ a: 1, b: 2 }, [{ op: 'keys', path: [], keys: ['b', 'a'] }], { maxWork: 4 }));
  });

  it('diffViews refuses views of two different seats (a patch is always within one viewer)', () => {
    const a = { viewer: 'p1' } as unknown as GameView;
    const b = { viewer: 'p2' } as unknown as GameView;
    expect(() => diffViews(a, b)).toThrow(/different viewers/);
  });
});

type Perspective = PlayerId | null | 'open';
const viewOf = (s: GameState, p: Perspective): GameView => (p === 'open' ? openView(s) : viewFor(s, p));

describe('RPL-0 (M13-1): patches on real engine views (seeded AI-against-AI games, packages/ai/test/harness.ts)', { timeout: 300_000 }, () => {
  const games: [string, number, number][] = [
    ['rpl0-patch-a', 0, 1],
    ['rpl0-patch-b', 2, 0],
  ];
  for (const [seed, d1, d2] of games) {
    it(`every change of ${seed}, for each seat, the public view and the open view: the patch rebuilds the next view exactly and carries only its values`, () => {
      const states = aiGame(seed, d1, d2).states;
      expect(states.length).toBeGreaterThan(30);
      const perspectives: Perspective[] = [...states[0]!.players.map((p) => p.id), null, 'open'];
      let fullBytes = 0;
      let patchBytes = 0;
      let changes = 0;
      for (const p of perspectives) {
        // What a replay holds: the parsed JSON of the last frame's view.
        let held = roundTrip(viewOf(states[0]!, p));
        let prevView = viewOf(states[0]!, p);
        for (let i = 1; i < states.length; i++) {
          const next = viewOf(states[i]!, p);
          const ops = diffViews(prevView, next);
          const wire = JSON.stringify(ops);
          const nextText = JSON.stringify(next);
          const rebuilt = applyViewPatch(held, JSON.parse(wire) as PatchOp[]);
          expect(JSON.stringify(rebuilt), `${seed} ${String(p)} change ${i}`).toBe(nextText);
          // Nothing but the next view's own values (m13 design 6.3): each value a set or splice carries is the next view's value at that place.
          const parsedNext = JSON.parse(nextText) as unknown;
          for (const op of JSON.parse(wire) as PatchOp[]) {
            if (op.op === 'set') expect(jsonEqual(op.value, at(parsedNext, op.path))).toBe(true);
            if (op.op === 'splice') op.add.forEach((v, k) => expect(jsonEqual(v, at(parsedNext, [...op.path, op.at + k]))).toBe(true));
          }
          fullBytes += nextText.length;
          patchBytes += wire.length;
          changes++;
          held = rebuilt;
          prevView = next;
        }
      }
      // Patches are what makes a recording small (replays design 12): far smaller than full views.
      expect(patchBytes / changes).toBeLessThan((fullBytes / changes) * 0.15);
    });
  }
});
