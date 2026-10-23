/**
 * Outbound memory (design D8, 3.5; review 4): a slow reader must never grow the main process's memory.
 *
 * - **Per connection**: the gateway keeps its own small send queue in front of the socket and hands the socket more only while the bytes it has handed
 *   over and not seen written (`inflight`, the socket's own buffer) are under 256 KB. When queued plus in-flight bytes pass **1 MB**, the connection goes
 *   **behind**: its queued game payloads (views, patches, clocks, chat) are dropped and nothing more of them is queued; the other
 *   messages (replies, notices, the table, the result, and the lobby updates and queue status: state that nothing sends again, and bounded by their own
 *   pacing of one batch a second and one status per 5 s) still go, within a hard cap (2 MB: past it the connection is closed, 4004).
 *   Once everything it was handed is written, it **catches up**: one fresh full view (the seat's cached view, `sync` with no id: `catchUp`, which the table
 *   answers with the clocks too), and until that view arrives, patches (whose base it no longer has) are dropped.
 * - **In total** (`OUTBOUND_BUDGET_MB`, default 256): above 80% the connections with the largest backlogs are put behind first; at 100% the largest
 *   offenders are closed (4004; they can reconnect).
 */
import { RUNTIME_LIMITS } from '../config';
import type { HostedServerType } from '../api';

/** What the gateway needs of a socket: send a text frame, and hear when it was written (or failed). */
export interface OutSocket {
  send(text: string, done: (err?: Error) => void): void;
}

/**
 * Game payloads a connection that is behind does without: the catch-up's full view and clocks replace them (review 3: lobby updates and queue status are not
 * among them: nothing sends them again to a connection that is not seated, so dropping them left a stale listing and queue position).
 */
const DROPPABLE: ReadonlySet<HostedServerType> = new Set<HostedServerType>(['view', 'patch', 'clock', 'chat']);

export type OutboundState = 'normal' | 'behind' | 'catchup';

export interface OutboundHooks {
  /** Everything handed over was written after being behind: ask for one fresh full view. False: no view will come (not seated); back to normal. */
  catchUp(): boolean;
  /** Past the hard cap, or closed by the total budget: close the connection (4004). */
  overflow(reason: 'behind' | 'outbound'): void;
  /** The connection went behind (metrics). */
  behind?(): void;
}

export interface OutboundLimits {
  /** Hand the socket more only while in-flight bytes are under this (256 KB). */
  highWater: number;
  /** Queued plus in-flight past this: behind (1 MB). */
  connection: number;
  /** Control messages queued while behind at most (2 MB). */
  hardCap: number;
}

export const DEFAULT_OUTBOUND_LIMITS: Readonly<OutboundLimits> = {
  highWater: RUNTIME_LIMITS.socketHighWaterBytes,
  connection: RUNTIME_LIMITS.connectionBudgetBytes,
  hardCap: 2 * RUNTIME_LIMITS.connectionBudgetBytes,
};

interface Item {
  t: HostedServerType;
  text: string;
  bytes: number;
}

/** Above 80% the connections are sorted by backlog; that is done at most this often (at 100% at once). */
export const REBALANCE_EVERY_MS = 100;

/** The total outbound budget over every connection (design 3.5). */
export class OutboundBudget {
  used = 0;
  readonly conns = new Set<Outbound>();
  /** Rebalances done (metrics, tests). */
  rebalances = 0;
  private checking = false;
  private last = -Infinity;

  constructor(readonly limitBytes: number, readonly behindAt = RUNTIME_LIMITS.outboundBehindAt, private readonly now: () => number = Date.now) {}

  /** The share in use, 0..1 (admission's `outbound` signal). */
  fraction(): number {
    return this.limitBytes > 0 ? Math.min(1, this.used / this.limitBytes) : 0;
  }

  /** Connections behind now (metrics). */
  behindCount(): number {
    let n = 0;
    for (const c of this.conns) if (c.state !== 'normal') n++;
    return n;
  }

  change(delta: number): void {
    this.used += delta;
    if (this.used <= this.limitBytes * this.behindAt) return;
    // Sorting every connection costs far more than a send (51 us against 0.4 us with 2,000 sockets), and above 80% every send and every acknowledgement
    // would do it, when the main thread is busiest. Above 80% it is done at most every 100 ms (and by the gateway's tick); at 100% at once.
    const t = this.now();
    if (this.used < this.limitBytes && t - this.last < REBALANCE_EVERY_MS) return;
    this.last = t;
    this.rebalance();
  }

  /** The housekeeping tick's check (once a second): a total above 80% that no send has dealt with since the last 100 ms. */
  check(): void {
    if (this.used <= this.limitBytes * this.behindAt) return;
    this.last = this.now();
    this.rebalance();
  }

  /** Above 80%: the largest backlogs go behind; at 100%: the largest offenders are closed. */
  private rebalance(): void {
    if (this.checking) return;
    this.checking = true;
    this.rebalances++;
    try {
      const largest = [...this.conns].sort((a, b) => b.backlog - a.backlog);
      for (const c of largest) {
        if (this.used <= this.limitBytes * this.behindAt) break;
        if (c.backlog === 0) break;
        if (c.state === 'normal') c.goBehind();
      }
      for (const c of largest) {
        if (this.used < this.limitBytes) break;
        if (c.backlog === 0) break;
        c.fail('outbound');
      }
    } finally {
      this.checking = false;
    }
  }
}

export class Outbound {
  state: OutboundState = 'normal';
  private readonly queue: Item[] = [];
  private queued = 0;
  private inflight = 0;
  private closed = false;
  private pumping = false;

  constructor(
    private readonly socket: OutSocket,
    private readonly budget: OutboundBudget,
    private readonly hooks: OutboundHooks,
    private readonly limits: OutboundLimits = DEFAULT_OUTBOUND_LIMITS,
  ) {
    budget.conns.add(this);
  }

  /** Bytes queued here plus bytes handed to the socket and not yet written. */
  get backlog(): number {
    return this.queued + this.inflight;
  }

  /** Queues one message (JSON text) for the socket. */
  send(t: HostedServerType, text: string): void {
    if (this.closed) return;
    if (this.state === 'behind' && DROPPABLE.has(t)) return;
    if (this.state === 'catchup') {
      if (t === 'patch') return; // its base is gone; the full view that ends the catch-up is on its way
      if (t === 'view') this.state = 'normal';
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    this.queue.push({ t, text, bytes });
    this.queued += bytes;
    this.budget.change(bytes);
    if (this.closed) return; // the total budget closed it
    if (this.state === 'normal' && this.backlog > this.limits.connection) this.goBehind();
    else if (this.state !== 'normal' && this.queued > this.limits.hardCap) return this.fail('behind');
    this.pump();
  }

  /** Behind: queued game payloads go; only control messages are queued from now on, until the catch-up. */
  goBehind(): void {
    if (this.closed || this.state === 'behind') return;
    this.state = 'behind';
    let dropped = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const it = this.queue[i]!;
      if (DROPPABLE.has(it.t)) {
        dropped += it.bytes;
        this.queue.splice(i, 1);
      }
    }
    this.queued -= dropped;
    this.budget.change(-dropped);
    this.hooks.behind?.();
    this.pump();
  }

  /** Closed by a limit: forget the queue (the gateway closes the socket). */
  fail(reason: 'behind' | 'outbound'): void {
    if (this.closed) return;
    this.dispose();
    this.hooks.overflow(reason);
  }

  /** The connection ended: its bytes leave the budget. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.budget.change(-this.queued - this.inflight);
    this.queue.length = 0;
    this.queued = 0;
    this.inflight = 0;
    this.budget.conns.delete(this);
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.closed && this.queue.length > 0 && this.inflight < this.limits.highWater) {
        const it = this.queue.shift()!;
        this.queued -= it.bytes;
        this.inflight += it.bytes;
        let done = false;
        this.socket.send(it.text, () => {
          if (done) return;
          done = true;
          this.written(it.bytes);
        });
      }
    } finally {
      this.pumping = false;
    }
    this.maybeCaughtUp();
  }

  private written(bytes: number): void {
    if (this.closed) return;
    this.inflight -= bytes;
    this.budget.change(-bytes);
    this.pump();
  }

  private maybeCaughtUp(): void {
    if (this.closed || this.state !== 'behind' || this.queue.length > 0 || this.inflight > 0) return;
    this.state = 'catchup';
    if (!this.hooks.catchUp()) this.state = 'normal';
  }
}
