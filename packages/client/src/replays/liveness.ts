/**
 * RPL-1 (replays design 7.1): which in-progress records still have a game screen. At start, a record whose game screen is gone (a closed tab, a crash)
 * becomes an abandoned replay; one that another open tab is still recording is left alone. A recording page holds a Web Lock named after the record
 * for as long as it records (the browser releases it when the page goes away, crashes included), and a starting page asks which of those locks are
 * held. A browser without Web Locks tells by time instead: a record whose last action is older than `STALE_MS` is taken as abandoned.
 */

/** Without Web Locks, a record untouched for this long counts as abandoned. */
export const STALE_MS = 30 * 60_000;

export interface Liveness {
  /** Mark the record `id` as recorded by this page, until the returned function is called. */
  hold(id: string): () => void;
  /** The ids of the records some page holds now, or null when this browser cannot tell (then time decides, `STALE_MS`). */
  held(): Promise<ReadonlySet<string> | null>;
}

const PREFIX = 'openmtg-replay:';

interface LockManagerLike {
  request(name: string, options: { mode: 'exclusive' }, callback: () => Promise<void>): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

/** Nothing to ask: every record is judged by time. */
export const timeLiveness: Liveness = {
  hold: () => () => {},
  held: async () => null,
};

/** The browser's Web Locks, or `timeLiveness` without them. */
export function browserLiveness(): Liveness {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  if (!locks || typeof locks.request !== 'function' || typeof locks.query !== 'function') return timeLiveness;
  return {
    hold(id) {
      let release = () => {};
      const holding = new Promise<void>((resolve) => {
        release = resolve;
      });
      locks.request(PREFIX + id, { mode: 'exclusive' }, () => holding).catch((e: unknown) => console.error('[Replays] lock', e));
      return () => release();
    },
    async held() {
      try {
        const q = await locks.query();
        return new Set((q.held ?? []).flatMap((l) => (l.name?.startsWith(PREFIX) ? [l.name.slice(PREFIX.length)] : [])));
      } catch {
        return null;
      }
    },
  };
}

/** A record is still being played when a page holds it, or (without Web Locks) when it was touched within `STALE_MS`. */
export function stillPlayed(id: string, lastSign: number, now: number, held: ReadonlySet<string> | null): boolean {
  return held !== null ? held.has(id) : now - lastSign < STALE_MS;
}
