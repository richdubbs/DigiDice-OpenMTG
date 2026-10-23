/**
 * The in-process transport (design 9.3, 13.1 M13-6): fake connections that call the gateway's handlers directly, with no socket and no network traffic.
 * The tests and M13-15's capacity simulation drive the real gateway through it. Delivery both ways is asynchronous (a microtask), as a network's is,
 * so no handler runs inside another.
 *
 * Flow control for the outbound-budget tests: a client normally reports every frame written at once; `stall()` stops that (frames still arrive but
 * stay "in flight", as on a socket whose reader does not read), `release()` reports them all written.
 */
import type { ConnectionHandle, Gateway, GatewaySocket, UpgradeRequest } from './gateway';

export interface InProcessConnectOptions {
  origin?: string;
  peer?: string;
  forwardedFor?: string;
}

export class InProcessClient {
  /** Every text frame received, in order. */
  readonly frames: string[] = [];
  /** Every frame's bytes received (UTF-8), in all. */
  bytes = 0;
  closed: { code: number; reason: string } | null = null;
  /** The gateway destroyed the socket (no closing handshake) instead of closing it. */
  terminated = false;
  pings = 0;
  /** Called with each frame received (after it was recorded). */
  onFrame: ((text: string) => void) | null = null;
  private stalled = false;
  private readonly pending: (() => void)[] = [];
  private waiters: { test: () => boolean; resolve: () => void }[] = [];
  handle!: ConnectionHandle;

  /** The socket the gateway writes to. */
  readonly socket: GatewaySocket = {
    send: (text, done) => {
      if (this.closed) {
        queueMicrotask(() => done(new Error('closed')));
        return;
      }
      this.frames.push(text);
      this.bytes += Buffer.byteLength(text, 'utf8');
      queueMicrotask(() => {
        this.onFrame?.(text);
        this.wake();
      });
      if (this.stalled) this.pending.push(() => done());
      else queueMicrotask(() => done());
    },
    close: (code, reason) => {
      if (this.closed) return;
      this.closed = { code, reason };
      queueMicrotask(() => {
        this.handle.closed();
        this.wake();
      });
    },
    ping: () => {
      this.pings++;
    },
    terminate: (code, reason) => {
      if (this.closed) return;
      this.terminated = true;
      this.closed = { code, reason };
      queueMicrotask(() => {
        this.handle.closed();
        this.wake();
      });
    },
  };

  /** Sends a message (an object as JSON, or raw text) to the gateway. */
  send(m: object | string, binary = false): void {
    if (this.closed) return;
    const text = typeof m === 'string' ? m : JSON.stringify(m);
    queueMicrotask(() => {
      if (!this.closed) this.handle.message(binary ? Buffer.from(text) : text, binary);
    });
  }

  /** Answers the gateway's ping. */
  pong(): void {
    this.handle.pong();
  }

  /** Stop reporting frames as written (a reader that does not read). */
  stall(): void {
    this.stalled = true;
  }

  /** Report every frame written so far, and from now on at once again. */
  release(): void {
    this.stalled = false;
    for (const f of this.pending.splice(0)) f();
  }

  /** The client closes its end. */
  close(): void {
    if (this.closed) return;
    this.closed = { code: 1000, reason: 'client' };
    queueMicrotask(() => this.handle.closed());
  }

  /** Every frame parsed. */
  messages<T = { t: string } & Record<string, unknown>>(): T[] {
    return this.frames.map((f) => JSON.parse(f) as T);
  }

  /** Resolves when `test` holds (checked after every frame and close), or rejects after `ms`. */
  until(test: () => boolean, ms = 30_000): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { test, resolve: () => undefined as void };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`in-process client: condition not met in ${ms} ms`));
      }, ms);
      w.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(w);
    });
  }

  private wake(): void {
    for (const w of [...this.waiters]) {
      if (w.test()) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }
}

export class InProcessTransport {
  constructor(private readonly gateway: Gateway) {}

  /** A new connection, as a browser's WebSocket upgrade would make it; the refusal (status and why) when the gateway refuses the upgrade. */
  connect(o: InProcessConnectOptions = {}): InProcessClient | { refused: { status: number; why: string } } {
    // `origin: undefined` given explicitly: no Origin header (refused).
    const req: UpgradeRequest = { peer: o.peer ?? '127.0.0.1', origin: 'origin' in o ? o.origin : 'http://127.0.0.1:5173', forwardedFor: o.forwardedFor };
    const d = this.gateway.upgrade(req);
    if (!d.ok) return { refused: { status: d.status, why: d.why } };
    const client = new InProcessClient();
    client.handle = this.gateway.open(client.socket, d);
    return client;
  }
}
