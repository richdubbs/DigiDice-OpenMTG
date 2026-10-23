/**
 * M14-3: the hashing pool with priorities (design 4.1, 8.2 rule 5; finding 38), driven by a fake hash function: served high, then normal, then low;
 * a full queue pushes out the newest queued job of a lower class (it answers busy, HasherBusyError with retryAfterMs) and refuses a new low job;
 * load() reports running, queued per class and the capacity. The hasher runs its hash, verify and dummy jobs in the caller's class.
 */
import { describe, expect, it } from 'vitest';
import { HasherBusyError, type HashPriority } from '../../src/crypto/api';
import { buildPasswordHasher, type Derive } from '../../src/crypto/hasher';
import { createHashPool } from '../../src/crypto/pool';
import { fixedRandom } from '../m14-1/support';

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('M14-3: the hashing pool', () => {
  it('serves high, then normal, then low; first come first served within a class', async () => {
    const pool = createHashPool({ concurrency: 1, queue: 16, retryAfterMs: () => 1_000 });
    const order: string[] = [];
    const gate = deferred<void>();
    const job = (name: string) => async () => {
      order.push(name);
    };
    const all: Promise<unknown>[] = [pool.run('low', async () => {
      order.push('blocker');
      await gate.promise;
    })];
    const plan: [HashPriority, string][] = [
      ['low', 'low1'], ['normal', 'normal1'], ['high', 'high1'], ['low', 'low2'], ['normal', 'normal2'], ['high', 'high2'],
    ];
    for (const [p, n] of plan) all.push(pool.run(p, job(n)));
    expect(pool.load()).toEqual({ running: 1, queued: { high: 2, normal: 2, low: 2 }, capacity: 16 });
    gate.resolve();
    await Promise.all(all);
    expect(order).toEqual(['blocker', 'high1', 'high2', 'normal1', 'normal2', 'low1', 'low2']);
    expect(pool.load()).toEqual({ running: 0, queued: { high: 0, normal: 0, low: 0 }, capacity: 16 });
  });

  it('runs up to `concurrency` jobs at once and queues the rest', async () => {
    const pool = createHashPool({ concurrency: 2, queue: 4, retryAfterMs: () => 1_000 });
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    let started = 0;
    const results = gates.map((g) => pool.run('normal', () => (started++, g.promise)));
    expect(started).toBe(2);
    expect(pool.load()).toMatchObject({ running: 2, queued: { high: 0, normal: 1, low: 0 } });
    gates[0]!.resolve(10);
    await settle();
    expect(started).toBe(3);
    gates[1]!.resolve(11);
    gates[2]!.resolve(12);
    expect(await Promise.all(results)).toEqual([10, 11, 12]);
  });

  it('a full queue pushes out the newest lower-class job (busy) and refuses a new low job at once (HasherBusyError)', async () => {
    const pool = createHashPool({ concurrency: 1, queue: 3, retryAfterMs: (load) => 500 * (load.running + 1) });
    const order: string[] = [];
    const outcome = new Map<string, string>();
    const gate = deferred<void>();
    const track = (p: HashPriority, name: string) => {
      const run = pool.run(p, async () => {
        order.push(name);
        if (name === 'blocker') await gate.promise;
      });
      run.then(
        () => outcome.set(name, 'done'),
        (e: unknown) => outcome.set(name, e instanceof HasherBusyError ? `busy ${e.retryAfterMs}` : `error ${String(e)}`),
      );
      return run.catch(() => undefined);
    };
    const all = [track('low', 'blocker'), track('low', 'low1'), track('low', 'low2'), track('normal', 'normal1')];
    expect(pool.load().queued).toEqual({ high: 0, normal: 1, low: 2 });

    // full: a high job pushes out the newest low job
    all.push(track('high', 'high1'));
    await settle();
    expect(outcome.get('low2')).toBe('busy 1000');
    expect(pool.load().queued).toEqual({ high: 1, normal: 1, low: 1 });

    // a new low job is refused at once
    all.push(track('low', 'low3'));
    await settle();
    expect(outcome.get('low3')).toMatch(/^busy \d+$/);

    // a normal job pushes out the newest low job; another normal one finds no lower class and is refused
    all.push(track('normal', 'normal2'));
    await settle();
    expect(outcome.get('low1')).toMatch(/^busy/);
    all.push(track('normal', 'normal3'));
    await settle();
    expect(outcome.get('normal3')).toMatch(/^busy/);
    expect(pool.load().queued).toEqual({ high: 1, normal: 2, low: 0 });

    // high jobs push out the newest normal jobs once no low job is left
    all.push(track('high', 'high2'));
    await settle();
    expect(outcome.get('normal2')).toMatch(/^busy/);
    all.push(track('high', 'high3'));
    await settle();
    expect(outcome.get('normal1')).toMatch(/^busy/);
    expect(pool.load().queued).toEqual({ high: 3, normal: 0, low: 0 });

    // nothing below high: a fourth high job is refused
    all.push(track('high', 'high4'));
    await settle();
    expect(outcome.get('high4')).toMatch(/^busy/);

    gate.resolve();
    await Promise.all(all);
    expect(order).toEqual(['blocker', 'high1', 'high2', 'high3']);
    for (const n of ['blocker', 'high1', 'high2', 'high3']) expect(outcome.get(n), n).toBe('done');
    for (const n of ['low1', 'low2', 'low3', 'normal1', 'normal2', 'normal3', 'high4']) expect(outcome.get(n), n).toMatch(/^busy/);
  });

  it('a queue of 0 refuses every job that cannot start at once; a failing job frees its slot', async () => {
    const pool = createHashPool({ concurrency: 1, queue: 0, retryAfterMs: () => 1 });
    const gate = deferred<void>();
    const first = pool.run('low', () => gate.promise);
    await expect(pool.run('high', async () => 1)).rejects.toBeInstanceOf(HasherBusyError);
    gate.resolve();
    await first;
    await expect(pool.run('normal', async () => {
      throw new Error('derive failed');
    })).rejects.toThrow('derive failed');
    await expect(pool.run('normal', () => {
      throw new Error('thrown at once');
    })).rejects.toThrow('thrown at once');
    expect(await pool.run('low', async () => 7)).toBe(7);
    expect(pool.load().running).toBe(0);
  });

  it('refuses unusable options and an unknown class', async () => {
    expect(() => createHashPool({ concurrency: 0, queue: 1, retryAfterMs: () => 1 })).toThrow(RangeError);
    expect(() => createHashPool({ concurrency: 1.5, queue: 1, retryAfterMs: () => 1 })).toThrow(RangeError);
    expect(() => createHashPool({ concurrency: 1, queue: -1, retryAfterMs: () => 1 })).toThrow(RangeError);
    const pool = createHashPool({ concurrency: 1, queue: 1, retryAfterMs: () => 1 });
    await expect(pool.run('urgent' as HashPriority, async () => 1)).rejects.toThrow(TypeError);
  });
});

describe('M14-3: the hasher runs its jobs in the caller\'s class', () => {
  it('hash, verify and dummy wait in their class; a full queue refuses a low one with HasherBusyError and a retryAfterMs', async () => {
    const gates: Deferred<void>[] = [];
    const seen: number[] = [];
    // a fake hash function: the key is the input's first byte repeated, and each call waits for its gate
    const derive: Derive = async (input, _salt, _params, keyLength) => {
      const g = deferred<void>();
      gates.push(g);
      await g.promise;
      seen.push(input[0]!);
      return new Uint8Array(keyLength).fill(input[0]!);
    };
    const hasher = buildPasswordHasher(
      { scrypt: { ln: 10, r: 8, p: 1 }, concurrency: 1, queue: 2, peppers: [], random: fixedRandom('m14-3 pool'), equal: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) },
      { derive, now: () => 0 },
    );
    const a = hasher.hash('A long enough password', { priority: 'low' }); // runs
    const b = hasher.dummy('B long enough password', { priority: 'low' }); // queued low
    const c = hasher.hash('C long enough password', { priority: 'high' }); // queued high
    await settle();
    expect(hasher.load()).toEqual({ running: 1, queued: { high: 1, normal: 0, low: 1 }, capacity: 2 });
    const d = hasher.hash('D long enough password', { priority: 'low' });
    const err = await d.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HasherBusyError);
    expect((err as HasherBusyError).retryAfterMs).toBeGreaterThan(0);
    expect((err as HasherBusyError).name).toBe('HasherBusyError');
    // a normal verify pushes out the queued low dummy
    const e = hasher.verify(`$scrypt$ln=10,r=8,p=1$${'A'.repeat(22)}$${'A'.repeat(43)}`, 'E', { priority: 'normal' });
    await expect(b).rejects.toBeInstanceOf(HasherBusyError);
    for (let i = 0; i < 3; i++) {
      await settle();
      gates[i]?.resolve();
    }
    await Promise.all([a, c, e]);
    // served: A (running), then C (high), then E (normal)
    expect(seen.map((x) => String.fromCharCode(x))).toEqual(['A', 'C', 'E']);
  });
});
