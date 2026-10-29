/**
 * Review 2026-10-26 F1 test helper: the game worker run in the test's own thread. The real worker logic (src/connection/gameHost.ts, all game.worker.ts
 * does is pump its messages) behind a `WorkerLike` that delivers each message as a browser does: later (a task of its own, in order) and structured-cloned,
 * so nothing is shared between the two sides by reference. Every message the "worker" posts is kept, for the hidden-information checks.
 *
 * `microtasks`: deliver as microtasks instead (still later, in order, cloned), for tests with fake timers, whose `setTimeout(0)` would wait for the clock.
 */
import { GameHost, type GameHostOptions } from '../../src/connection/gameHost';
import type { FromWorker, ToWorker } from '../../src/connection/gameWorkerProtocol';
import type { WorkerLike } from '../../src/connection/WorkerConnection';

export class InThreadWorker implements WorkerLike {
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  readonly host: GameHost;
  /** What the page sent and what the worker posted, in order (as delivered: clones). */
  readonly toWorker: ToWorker[] = [];
  readonly fromWorker: FromWorker[] = [];
  terminated = false;

  private readonly later: (fn: () => void) => void;

  constructor(opts: GameHostOptions & { microtasks?: boolean } = {}) {
    const { microtasks, ...hostOpts } = opts;
    this.later = microtasks ? (fn) => queueMicrotask(fn) : (fn) => setTimeout(fn, 0);
    this.host = new GameHost((m) => {
      const copy = structuredClone(m);
      this.later(() => {
        if (this.terminated) return;
        this.fromWorker.push(copy);
        this.onmessage?.({ data: copy });
      });
    }, hostOpts);
  }

  postMessage(message: ToWorker): void {
    if (this.terminated) throw new Error('the worker was terminated');
    const copy = structuredClone(message);
    this.later(() => {
      if (this.terminated) return;
      this.toWorker.push(copy);
      this.host.receive(copy);
    });
  }

  terminate(): void {
    this.terminated = true;
    this.host.dispose();
  }

  /** The worker dies (an uncaught error in its thread). */
  crash(message: string): void {
    this.terminated = true;
    this.host.dispose();
    this.onerror?.({ message });
  }
}

/** Let the messages both ways be delivered (each hop is a task). */
export async function deliver(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
