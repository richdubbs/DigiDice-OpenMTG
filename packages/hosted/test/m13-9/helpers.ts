/**
 * Test helpers for matchmaking (fake time only: every instant is an explicit number of milliseconds; fixed inputs, no randomness). A `Rig` is a matcher
 * with a clock the test moves, the lobby's "busy" and "connected" sets, and a record of every entry it made (so a test can put entries back).
 */
import { DEFAULT_MATCH_POLICY, FifoMatcher, type EnterRefusal, type Match, type MatchEntry, type MatchPolicy, type QueueKey } from '../../src/match';
import { MemoryMetrics } from '../../src/obs';

export const SEC = 1_000;
export const MIN = 60_000;

/** The queues the tests use. */
export const STANDARD: QueueKey = { format: 'standard', size: 2 };
export const PAUPER: QueueKey = { format: 'pauper', size: 2 };
export const DUEL: QueueKey = { format: 'commander', size: 2 };
export const POD: QueueKey = { format: 'commander', size: 'pod' };

export interface JoinOptions {
  key?: QueueKey;
  /** The address key (default: one per session, so no limit comes into play). */
  address?: string;
  /** The sessions it played last. */
  recent?: string[];
  /** Default: now. */
  at?: number;
}

export interface RigOptions {
  policy?: Partial<MatchPolicy>;
  /** Default: every queue. */
  offered?: (key: QueueKey) => boolean;
}

export class Rig {
  /** An arbitrary start that is not 0 (so a waiting time of 0 and "never waited" cannot be confused). */
  now = 1_000_000;
  readonly busy = new Set<string>();
  readonly absent = new Set<string>();
  readonly metrics = new MemoryMetrics();
  readonly matcher: FifoMatcher;
  readonly made = new Map<string, MatchEntry>();
  offered: (key: QueueKey) => boolean;

  constructor(o: RigOptions = {}) {
    this.offered = o.offered ?? (() => true);
    this.matcher = new FifoMatcher(
      { sessionBusy: (s) => this.busy.has(s), offered: (k) => this.offered(k), policy: { ...DEFAULT_MATCH_POLICY, ...o.policy } },
      { metrics: this.metrics, matchable: (s) => !this.absent.has(s) },
    );
  }

  advance(ms: number): this {
    this.now += ms;
    return this;
  }

  /** The entry a session would send at `now` (or `o.at`). */
  entry(session: string, o: JoinOptions = {}): MatchEntry {
    return {
      session,
      addressKey: o.address ?? `addr-${session}`,
      key: o.key ?? STANDARD,
      deck: `deck-${session}`,
      enteredAt: o.at ?? this.now,
      recentOpponents: o.recent ?? [],
    };
  }

  /** `enter` at `now`: null when queued, else the refusal. The entry is kept in `made`. */
  join(session: string, o: JoinOptions = {}): EnterRefusal | null {
    const e = this.entry(session, o);
    this.made.set(session, e);
    return this.matcher.enter(e, this.now);
  }

  /** Several sessions join, each `gapMs` after the one before (none after the last). */
  joinAll(sessions: string[], o: JoinOptions = {}, gapMs = 0): void {
    sessions.forEach((s, i) => {
      expectQueued(this.join(s, o));
      if (gapMs > 0 && i < sessions.length - 1) this.advance(gapMs);
    });
  }

  tick(): Match[] {
    return this.matcher.tick(this.now);
  }

  /** The entries `made` for these sessions, in this order. */
  entries(...sessions: string[]): MatchEntry[] {
    return sessions.map((s) => this.made.get(s)!);
  }
}

function expectQueued(r: EnterRefusal | null): void {
  if (r !== null) throw new Error(`the test setup was refused: ${r}`);
}

/** The sessions of a match in its order. */
export const who = (m: Match): string[] => m.entries.map((e) => e.session);

/** The sessions of every match of a tick, as "a+b" strings: ["a+b", "c+d"]. */
export const pairs = (ms: Match[]): string[] => ms.map((m) => who(m).join('+'));
