/**
 * Flood control for a seated guest (audit 2026-10-12, M4 and M5). Every message costs the host work: an action runs `applyAction` and renders two
 * views, a sync renders a view, chat goes to the host's screen. So, per connection:
 *
 * - Actions (and anything else but sync, chat and bye) are paced by a token bucket: within the rate they run at once; above it they wait in a short
 *   queue, in order, and run as tokens come back (a fast but honest client, such as the automatic player, just slows down). A message that finds
 *   the queue full is refused with 'rateLimited'.
 * - Stop changes (`setStops`) also need a token of their own, smaller bucket: they change the state without any game progress, so the action rate
 *   alone would let a guest make one every 50 ms for the whole game (M4).
 * - Syncs are coalesced: at most one view per `syncEveryMs`; a sync inside that time is answered once at its end.
 * - Chat has its own, smaller bucket; chat above it is refused with 'rateLimited'.
 * - Every refusal is a strike, and so is a message that fails validation (`strike`); strikes have a bucket too: a connection that keeps flooding
 *   is closed.
 * - A handler that throws stops the gate and is reported to `fail` (which closes that guest's connection), also when it runs later from a timer
 *   (a queued action, a delayed sync answer): nothing a guest sends can throw out of a timer and end the host process (C4).
 *
 * Time comes from `clock` (milliseconds), so tests can drive it.
 */
import { performance } from 'node:perf_hooks';
import { TokenBucket, type RateConfig } from '../link/ratelimit';
import type { GuestMessage } from '../protocol/messages';

export interface GuestLimits {
  /** Actions and other messages per second, and the burst (default 20/s, 50). */
  actions: RateConfig;
  /** Messages waiting for a token at most (default 32). */
  queue: number;
  /** Stop changes (`setStops` actions) per second, and the burst (default 1/s, 5): audit M4. */
  stops: RateConfig;
  /** Chat messages per second, and the burst (default 2/s, 5). */
  chat: RateConfig;
  /** At most one view per this many milliseconds answers syncs (default 500). */
  syncEveryMs: number;
  /** Refusals tolerated: per second, and in a burst (default 2/s, 30); past them the connection is closed. */
  strikes: RateConfig;
  /** Join attempts (hellos of guests that are not seated) per second over all connections, and the burst (default 1/s, 5): audit m7. */
  joins: RateConfig;
  /**
   * RPL-3: a seat's "Show my cards in replays" changes per second, and the burst (default 1/s, 5, like stop changes): host.ts paces them beside the
   * gate, keeping only the latest one waiting (the last choice counts, so none is refused).
   */
  consent: RateConfig;
}

export const DEFAULT_GUEST_LIMITS: GuestLimits = {
  actions: { rate: 20, burst: 50 },
  queue: 32,
  stops: { rate: 1, burst: 5 },
  chat: { rate: 2, burst: 5 },
  syncEveryMs: 500,
  strikes: { rate: 2, burst: 30 },
  joins: { rate: 1, burst: 5 },
  consent: { rate: 1, burst: 5 },
};

export interface GateHandlers {
  /** Handle a message now. */
  run(m: GuestMessage): void;
  /** Answer a refused message ('rateLimited'). */
  refuse(m: GuestMessage, why: string): void;
  /** Answer the guest's syncs (one view). */
  sync(): void;
  /** The guest kept flooding: close its connection. */
  abuse(): void;
  /** A handler threw (the gate is stopped already): close that guest's connection (audit C4). Must not throw. */
  fail(e: unknown): void;
}

export class GuestGate {
  private readonly actions: TokenBucket;
  private readonly stops: TokenBucket;
  private readonly chat: TokenBucket;
  private readonly strikes: TokenBucket;
  private readonly waiting: GuestMessage[] = [];
  private drainTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSync = -Infinity;
  private stopped = false;

  constructor(private readonly limits: GuestLimits, private readonly h: GateHandlers, private readonly clock: () => number = () => performance.now()) {
    const now = clock();
    this.actions = new TokenBucket(limits.actions, now);
    this.stops = new TokenBucket(limits.stops, now);
    this.chat = new TokenBucket(limits.chat, now);
    this.strikes = new TokenBucket(limits.strikes, now);
  }

  /** Messages waiting for a token. */
  get queued(): number {
    return this.waiting.length;
  }

  offer(m: GuestMessage): void {
    if (this.stopped) return;
    const now = this.clock();
    switch (m.type) {
      case 'bye':
        return this.run(m);
      case 'sync':
        return this.onSync(now);
      case 'chat':
        if (this.chat.take(now)) return this.run(m);
        return this.refuse(m, 'Too many chat messages; wait a moment.');
      default:
        if (m.type === 'action' && m.action.type === 'setStops' && !this.stops.take(now)) return this.refuse(m, 'Too many stop changes; wait a moment.');
        if (!this.waiting.length && this.actions.take(now)) return this.run(m);
        if (this.waiting.length < this.limits.queue) {
          this.waiting.push(m);
          return this.schedule(now);
        }
        return this.refuse(m, 'Too many actions in a short time; wait for the answers before sending more.');
    }
  }

  /** A message of this guest failed validation (it was answered already): it counts as a strike. */
  strike(): void {
    if (this.stopped) return;
    if (!this.strikes.take(this.clock())) {
      this.stop();
      this.h.abuse();
    }
  }

  /** Stop: forget the queue, cancel the timers (the connection ended). */
  stop(): void {
    this.stopped = true;
    this.waiting.length = 0;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.drainTimer = this.syncTimer = null;
  }

  /** Run a handler; if it throws, stop and report it (C4: this also runs from timers, where a throw would end the process). */
  private guard(f: () => void): void {
    try {
      f();
    } catch (e) {
      this.stop();
      this.h.fail(e);
    }
  }

  private run(m: GuestMessage): void {
    this.guard(() => this.h.run(m));
  }

  private onSync(now: number): void {
    if (this.syncTimer) return; // one answer is already due: it covers this sync too
    const due = this.lastSync + this.limits.syncEveryMs - now;
    if (due <= 0) {
      this.lastSync = now;
      return this.guard(() => this.h.sync());
    }
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (this.stopped) return;
      this.lastSync = this.clock();
      this.guard(() => this.h.sync());
    }, due);
    this.syncTimer.unref?.();
  }

  private schedule(now: number): void {
    if (this.drainTimer || this.stopped) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, Math.max(1, this.actions.wait(now)));
    this.drainTimer.unref?.();
  }

  /** Run what waits, in order, while there are tokens (a handler may stop the gate). */
  drain(): void {
    while (!this.stopped && this.waiting.length && this.actions.take(this.clock())) this.run(this.waiting.shift()!);
    if (!this.stopped && this.waiting.length) this.schedule(this.clock());
  }

  private refuse(m: GuestMessage, why: string): void {
    this.guard(() => this.h.refuse(m, why));
    this.strike();
  }
}
