/**
 * Sending commands to the DigiDice server no faster than it takes them (hosted design 3.6, review 12). The server gives every command its own bucket per
 * connection, and a command refused for it is answered `rateLimited` and counts as a strike; strikes past a small budget close the connection. A page that
 * waits its turn is never refused, so `HostedLink.command` asks this pacer before it sends.
 *
 * These are the server's own figures (packages/hosted/src/config.ts `COMMAND_LIMITS`, which test/m13-lobby/pacing.test.ts pins this table against), each
 * made 5% slower so a timer that fires a few milliseconds early still lands on the server after its token is back. `queue` and `unqueue` share one bucket,
 * as they do there. Commands without a bucket here (a game's actions and chat have their own gate) are never delayed.
 *
 * Pure: the time comes from the caller.
 */
import type { HostedClientType } from '@openmtg/hosted/api';

export type PacedBucket = 'browse' | 'watchLobby' | 'create' | 'join' | 'codes' | 'queue' | 'ready' | 'vote' | 'leave' | 'report';

export interface Pace {
  /** Milliseconds for one token to come back. */
  everyMs: number;
  /** Tokens a bucket starts with and never holds more than. */
  burst: number;
}

const SLOWER = 1.05;
const pace = (everyMs: number, burst: number): Pace => ({ everyMs: Math.ceil(everyMs * SLOWER), burst });

/** The server's `COMMAND_LIMITS` (rate per second, burst) as milliseconds per token. */
export const PACE: Readonly<Record<PacedBucket, Pace>> = {
  browse: pace(500, 4),
  watchLobby: pace(5_000, 1),
  create: pace(10_000, 1),
  join: pace(1_000, 2),
  codes: pace(10_000, 1),
  queue: pace(5_000, 1),
  ready: pace(500, 4),
  vote: pace(500, 4),
  leave: pace(1_000, 2),
  report: pace(60_000, 1),
};

/** The bucket a command draws from, or null when it has none. */
export function bucketOf(t: HostedClientType): PacedBucket | null {
  switch (t) {
    case 'unqueue':
      return 'queue';
    case 'browse':
    case 'watchLobby':
    case 'create':
    case 'join':
    case 'codes':
    case 'queue':
    case 'ready':
    case 'vote':
    case 'leave':
    case 'report':
      return t;
    default:
      return null;
  }
}

export class Pacer {
  private readonly state = new Map<PacedBucket, { tokens: number; at: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The bucket's tokens now (a bucket never seen is full). */
  private tokens(b: PacedBucket): { tokens: number; at: number } {
    const p = PACE[b];
    const t = this.now();
    const s = this.state.get(b);
    if (!s) return { tokens: p.burst, at: t };
    // A clock that went backwards refills nothing.
    return { tokens: Math.min(p.burst, s.tokens + Math.max(0, t - s.at) / p.everyMs), at: t };
  }

  /** Milliseconds until `t` could be sent without waiting (0: now), without taking anything. */
  delay(t: HostedClientType): number {
    const b = bucketOf(t);
    if (b === null) return 0;
    const { tokens } = this.tokens(b);
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * PACE[b].everyMs);
  }

  /**
   * Takes the next slot for `t` and says how long to wait before sending (0: now). Slots are taken in order: a second command asks for the slot after the
   * first. When the wait would be longer than `maxWaitMs`, nothing is taken and the wait is returned negated (the caller refuses to send and says when).
   */
  reserve(t: HostedClientType, maxWaitMs = Infinity): number {
    const b = bucketOf(t);
    if (b === null) return 0;
    const s = this.tokens(b);
    const left = s.tokens - 1;
    const wait = left >= 0 ? 0 : Math.ceil(-left * PACE[b].everyMs);
    if (wait > maxWaitMs) return -wait;
    this.state.set(b, { tokens: left, at: s.at });
    return wait;
  }
}
