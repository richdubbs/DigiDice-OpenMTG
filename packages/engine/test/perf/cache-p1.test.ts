/**
 * Package P1 (engine performance): the faster characteristics cache must give exactly the answers of the old one.
 *  - util/data-snapshot.ts: "the snapshot still matches" is true exactly when JSON.stringify of the data is unchanged (never true when the JSON differs).
 *  - rules/characteristics.ts: a fresh state object (a clone, as every action makes) reuses a recent entry only when its layer inputs are the same; an
 *    edited clone, another definitions map or an edit made in place after the entry was taken is recomputed.
 *  - statics/stable-scope.ts: the new read-only scopes (rule hookpoints, findObjects, attack/block candidates, castCheck, activationDenial, the attachment
 *    state-based actions) really hold their state still over the real soak games (STABLE_READS.verify throws an EngineBug otherwise).
 */
import { describe, expect, it } from 'vitest';
import { getChars, type AbilityDef, type GameState, type ObjectId } from '../../src/index';
import { CHARS_CACHE_STATS, FINGERPRINTED, LAYER_WALK_ORDER, STABLE_READS, allChars } from '../../src/rules/characteristics';
import { computeAll } from '../../src/statics/layers';
import * as stableScope from '../../src/statics/stable-scope';
import { holdStill } from '../../src/statics/stable-scope';
import { cloneState } from '../../src/util/clone';
import { matchesSnapshot, snapshotOf } from '../../src/util/data-snapshot';
import { board, continuous, creature, each, enchantment, nth, staticOf } from '../m5/statics/fixtures';
import { measureReal, measureSoak } from './harness';
import { describeSlow } from '../slow';

describe('P1 util/data-snapshot: an exact replacement for comparing JSON.stringify output', () => {
  const sample = (): Record<string, unknown> => ({
    a: 1, b: 'x', c: [1, 2, { d: true, e: null }], f: { g: { h: [] as unknown[], i: {} }, j: undefined }, k: [[], [[]]], l: -0, m: 'o12',
  });

  it('an unchanged value matches its snapshot; undefined properties are skipped as JSON skips them', () => {
    const v = sample();
    const snap = snapshotOf(v);
    expect(matchesSnapshot(snap, v)).toBe(true);
    expect(matchesSnapshot(snap, structuredClone(v))).toBe(true);
    (v['f'] as Record<string, unknown>)['j'] = undefined;
    (v as Record<string, unknown>)['z'] = undefined;
    expect(JSON.stringify(v)).toBe(JSON.stringify(sample()));
    expect(matchesSnapshot(snap, v)).toBe(true);
  });

  it('a value holding NaN matches its own snapshot (NaN is the same NaN; NaN against null is still a change)', () => {
    const v = { a: 1, b: { c: NaN }, d: [NaN] };
    expect(matchesSnapshot(snapshotOf(v), v)).toBe(true);
    expect(matchesSnapshot(snapshotOf(v), structuredClone(v))).toBe(true);
    expect(matchesSnapshot(snapshotOf(v), { a: 1, b: { c: null }, d: [NaN] })).toBe(false);
    expect(matchesSnapshot(snapshotOf({ x: 0 }), { x: -0 })).toBe(true); // as JSON: -0 is written 0
  });

  it('a seeded series of edits in place (NaN among the values): the snapshot matches exactly when the JSON, NaN told apart from null, is the same', () => {
    let seed = 7;
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const values: unknown[] = [0, 1, 2, '1', 'a', true, false, null, NaN, [], {}, [1], { a: 1 }, [NaN]];
    // JSON.stringify, except that NaN is written apart from null (the snapshot reports NaN against null as a change: a miss, never a stale answer)
    const jsonOf = (x: unknown): string => JSON.stringify(x, (_k, y: unknown) => (typeof y === 'number' && Number.isNaN(y) ? '\u0000NaN' : y));
    const v = sample();
    let snap = snapshotOf(v);
    let json = jsonOf(v);
    let changed = 0;
    for (let step = 0; step < 3000; step++) {
      // pick a random container inside v and edit, add, delete or reorder one key / element
      const containers: (Record<string, unknown> | unknown[])[] = [];
      const walk = (x: unknown): void => {
        if (x === null || typeof x !== 'object') return;
        containers.push(x as Record<string, unknown>);
        for (const y of Object.values(x as object)) walk(y);
      };
      walk(v);
      const c = containers[rnd(containers.length)]!;
      const val = structuredClone(values[rnd(values.length)]);
      if (Array.isArray(c)) {
        const op = rnd(3);
        if (op === 0 && c.length > 0) c[rnd(c.length)] = val;
        else if (op === 1) c.push(val);
        else c.pop();
      } else {
        const keys = Object.keys(c);
        const op = rnd(4);
        if (op === 0 && keys.length > 0) c[keys[rnd(keys.length)]!] = val;
        else if (op === 1) c[`k${rnd(5)}`] = val;
        else if (op === 2 && keys.length > 0) delete c[keys[rnd(keys.length)]!];
        else if (keys.length > 1) { const k = keys[0]!; const x = c[k]; delete c[k]; c[k] = x; } // same content, another key order: JSON differs
      }
      const now = jsonOf(v);
      expect(matchesSnapshot(snap, v), `step ${step}`).toBe(now === json);
      if (now !== json) changed++;
      if (rnd(4) === 0) { snap = snapshotOf(v); json = now; }
    }
    expect(changed).toBeGreaterThan(1000);
  });
});

const FLYING: AbilityDef = { kind: 'keyword', text: 'Flying', keyword: 'flying' };
const ANTHEM = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
const SKYLORD = creature('Test Skylord', '2', '2', [staticOf('Other creatures you control have flying.', [continuous(each({ types: ['Creature'], controller: 'you', other: true }), [{ layer: 6, add: [FLYING] }])])]);
const BEAR = creature('Test Bear', '2', '2');
const layered = (): GameState => board([ANTHEM, SKYLORD, BEAR], ['Test Anthem', 'Test Skylord', 'Test Bear'], ['Test Bear']);
const everyObject = (s: GameState): ObjectId[] => Object.keys(s.objects);
const agrees = (s: GameState): void => {
  const fresh = computeAll(s);
  for (const id of everyObject(s)) expect(getChars(s, id), id).toEqual(fresh.get(id));
};

describe('P1 rules/characteristics: recent entries are reused only for the same layer inputs', () => {
  it('a clone (what every action runs on) reuses the entry of the state it was cloned from, without computing again', () => {
    const s = layered();
    const all = allChars(s);
    const t = cloneState(s);
    const misses = CHARS_CACHE_STATS.misses;
    expect(allChars(t)).toBe(all);
    expect(CHARS_CACHE_STATS.misses).toBe(misses);
    agrees(t);
  });

  it('a clone edited before its first read is computed again, and is right; the original keeps its answer', () => {
    const s = layered();
    const bear = nth(s, 'Test Bear');
    const before = getChars(s, bear).power;
    const t = cloneState(s);
    t.objects[bear]!.counters['+1/+1'] = 3;
    expect(Number(getChars(t, bear).power)).toBe(Number(before) + 3);
    agrees(t);
    expect(getChars(s, bear).power).toBe(before);
  });

  it('an edit in place after the entry was reused is seen at once (the reused entry is checked like any other)', () => {
    const s = layered();
    allChars(s);
    const t = cloneState(s);
    allChars(t);
    const bear = nth(t, 'Test Bear');
    t.objects[bear]!.controller = 'p2'; // the anthem and the skylord no longer reach it
    expect(getChars(t, bear).power).toBe('2');
    expect(getChars(t, bear).keywords).toEqual([]);
    agrees(t);
  });

  it('another definitions map is never answered from an entry of the first one', () => {
    const s = layered();
    allChars(s);
    const t: GameState = { ...cloneState(s), defs: { ...s.defs } };
    const misses = CHARS_CACHE_STATS.misses;
    allChars(t);
    expect(CHARS_CACHE_STATS.misses).toBe(misses + 1);
    agrees(t);
  });

  it('a read-only scope answers from one check, and a state changed inside a scope is an EngineBug when verification is on', () => {
    const s = layered();
    const bear = nth(s, 'Test Bear');
    allChars(s);
    const hits = CHARS_CACHE_STATS.hits;
    holdStill(s, () => { for (let i = 0; i < 10; i++) getChars(s, bear); });
    expect(CHARS_CACHE_STATS.hits).toBe(hits + 1);
    STABLE_READS.verify = true;
    try {
      expect(() => holdStill(s, () => { s.objects[bear]!.tapped = true; })).toThrow(/promised to hold still/);
    } finally {
      STABLE_READS.verify = false;
    }
  });
});

describe('P1 rules/characteristics: the cache key is FINGERPRINTED, the list the state-key pins check (design 9.2)', () => {
  it('the snapshot walks exactly the keys of FINGERPRINTED (its order is derived from that list, so a key added there is walked)', () => {
    expect([...LAYER_WALK_ORDER].sort()).toEqual([...FINGERPRINTED].sort());
    expect(LAYER_WALK_ORDER.length).toBe(FINGERPRINTED.length);
  });

  it('every walked key, replaced by an edited copy, makes the next read compute again', () => {
    // Review 2026-10-26: the combat is a volatile part (statics/layer-reads.ts), in the key only of an entry whose computation read it; nothing on this board
    // reads it (test/perf/layer-reads.test.ts covers both cases)
    for (const k of LAYER_WALK_ORDER.filter((x) => x !== 'combat')) {
      const s = layered();
      allChars(s);
      const misses = CHARS_CACHE_STATS.misses;
      const v = s[k] as unknown;
      // an extra property on an object part, an extra entry on a list: the layer inputs changed
      (s as unknown as Record<string, unknown>)[k] = v === null ? {} : Array.isArray(v) ? [...v, 'p1'] : { ...(v as object), p1Probe: 1 };
      try { allChars(s); } catch { /* the probe is not a real state; only the cache decision matters */ }
      expect(CHARS_CACHE_STATS.misses, k).toBe(misses + 1);
    }
  });
});

describe('P1 statics/stable-scope: holdStill is the only way to open a scope', () => {
  it('the module exports no other scope setter (swapStableScope would skip the verifier and the nesting rule)', () => {
    expect(Object.keys(stableScope).sort()).toEqual(['holdStill', 'installScopeVerifier', 'stableScopeFor']);
  });
});

// QT: about 15 s (three whole games, two of them twice); a slow suite (npm run test:all). The scope checks on random games stay in the default suite
// (statics/wp30-performance.test.ts).
describeSlow('P1 scopes over real games: every read-only scope holds its state still', () => {
  // soak game 3 is the one with the most layered states (static abilities on the battlefield for most of the game), so the most scope checks
  it('soak game 3 and two M4 real games run with STABLE_READS.verify on, and play exactly as with it off', () => {
    const plain = measureSoak(1, undefined, 3);
    STABLE_READS.verify = true;
    let checked: ReturnType<typeof measureSoak>;
    let real: ReturnType<typeof measureReal>;
    try {
      checked = measureSoak(1, undefined, 3);
      real = measureReal(2);
    } finally {
      STABLE_READS.verify = false;
    }
    expect(checked.fingerprint).toBe(plain.fingerprint);
    expect(checked.tally).toEqual(plain.tally);
    expect(real.fingerprint).toBe(measureReal(2).fingerprint);
  }, 300_000);
});
