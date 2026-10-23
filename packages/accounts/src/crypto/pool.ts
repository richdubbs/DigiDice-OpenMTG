/**
 * M14-3: the bounded hashing pool with priorities (design 4.1, 8.2 rule 5). At most `concurrency` jobs run at once (HASH_CONCURRENCY, 2); at most
 * `queue` wait (HASH_QUEUE, 64), over three classes:
 *  - served `high` first (an attempt with a valid device proof), then `normal` (an address key without a recent failure), then `low`; first come,
 *    first served within a class;
 *  - when the queue is full, a new `high` or `normal` job pushes out the NEWEST queued job of a lower class (`low` first, then, for a `high` job,
 *    `normal`): that job is rejected with HasherBusyError (the service answers `busy` with its retryAfterMs) and the new one takes its place; with
 *    no lower-class job to push out, or for a new `low` job, the new job is refused at once with HasherBusyError.
 * The per-address and per-(name, address) limits on jobs in flight are the service's (8.1); the pool knows nothing of addresses or accounts.
 * Generic over the job, so the tests drive it with a fake hash function; src/crypto/hasher.ts runs scrypt in it. Plain TypeScript, no Node API.
 */
import { HasherBusyError, type HashPriority } from './api';

export const HASH_PRIORITIES: readonly HashPriority[] = ['high', 'normal', 'low'];

export interface HashPoolOptions {
  concurrency: number;
  queue: number;
  /** How long a refused or pushed-out caller should wait, given the pool's load at that moment. */
  retryAfterMs(load: HashPoolLoad): number;
}
export interface HashPoolLoad { running: number; queued: Record<HashPriority, number>; capacity: number }
export interface HashPool {
  /** Runs `job` when its turn comes; rejects with HasherBusyError when the queue has no room for it, or when a higher-class job pushes it out. */
  run<T>(priority: HashPriority, job: () => Promise<T>): Promise<T>;
  /** Jobs running, jobs queued per class, and the queue's capacity (HASH_QUEUE). */
  load(): HashPoolLoad;
}

interface Waiting { start: () => void; refuse: (e: Error) => void }

export function createHashPool(opts: HashPoolOptions): HashPool {
  const { concurrency, queue: capacity } = opts;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('the hashing pool needs a concurrency of at least 1');
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('the hashing queue needs a whole, non-negative capacity');
  const queues: Record<HashPriority, Waiting[]> = { high: [], normal: [], low: [] };
  let running = 0;

  const queuedTotal = () => queues.high.length + queues.normal.length + queues.low.length;
  const load = (): HashPoolLoad => ({
    running, queued: { high: queues.high.length, normal: queues.normal.length, low: queues.low.length }, capacity,
  });
  const busy = () => new HasherBusyError(Math.max(1, Math.ceil(opts.retryAfterMs(load()))));

  function next(): void {
    while (running < concurrency) {
      const w = queues.high.shift() ?? queues.normal.shift() ?? queues.low.shift();
      if (w === undefined) return;
      w.start();
    }
  }

  /** The newest queued job of a class below `priority`, lowest class first. */
  function victimFor(priority: HashPriority): Waiting[] | null {
    const below = priority === 'high' ? (['low', 'normal'] as const) : priority === 'normal' ? (['low'] as const) : ([] as const);
    for (const c of below) if (queues[c].length > 0) return queues[c];
    return null;
  }

  return {
    run<T>(priority: HashPriority, job: () => Promise<T>): Promise<T> {
      if (!HASH_PRIORITIES.includes(priority)) return Promise.reject(new TypeError(`unknown hashing priority: ${String(priority)}`));
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          running++;
          let p: Promise<T>;
          try {
            p = Promise.resolve(job());
          } catch (e) {
            p = Promise.reject(e);
          }
          // the slot is free before the caller hears back, so a caller that awaits its job finds the pool already moved on
          const done = () => {
            running--;
            next();
          };
          p.then(
            (v) => {
              done();
              resolve(v);
            },
            (e: unknown) => {
              done();
              reject(e);
            },
          );
        };
        if (running < concurrency && queuedTotal() === 0) {
          start();
          return;
        }
        if (queuedTotal() >= capacity) {
          const from = victimFor(priority);
          if (from === null) {
            reject(busy());
            return;
          }
          from.pop()!.refuse(busy());
        }
        queues[priority].push({ start, refuse: reject });
      });
    },
    load,
  };
}
