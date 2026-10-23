/**
 * RPL-1 (replays design 3, 7.1): after a game replay comes into the library, it is completed in a Web Worker (recording.worker.ts, fallback.ts): the
 * game is run again, and the fallback recording and the facts the record could not know are merged into the stored file. Jobs run one at a time.
 * Without Web Workers (an old browser, the tests' jsdom) the replay stays as it was saved: it still plays exactly under the same build.
 *
 * The work survives the page (design 14.1: the recording is what keeps a replay watchable after the next engine update, and only this build can make
 * it). A replay saved of a game played here carries the library's completion mark until its recording is merged in. At start (`resume`), every
 * replay still marked is completed again: a page closed while its worker ran, or a crash right after the save, is caught up while the build still
 * matches. The mark is removed when the recording lands, and when completing it is given up: the replay is of another build by then, the game does
 * not play here as it was recorded (it never will under this build), or `COMPLETION_TRIES` runs failed (a worker error or its time-out). An imported
 * replay has no mark: it is kept as it was given. RPL-3: a replay saved with a recording of its own to be replaced (an online guest's live recording of
 * the game the host shared, `CompletionMark.replace`) keeps it until the worker's lands, and keeps it for good when the worker makes none.
 */
import type { ReplayFile } from '@openmtg/engine';
import { withCompleted, type CompletedGame } from './fallback';
import type { ReplayLibrary } from './library';
import type { CompleteReply, CompleteRequest } from './recording.worker';

/** Runs `completeGame` for a file somewhere (a worker), or answers null when it could not. */
export type Completer = (file: ReplayFile, build: string | null) => Promise<CompletedGame | null>;

/** A worker gets this long before it is stopped (a game of thousands of actions takes seconds, design 14.4). */
const WORKER_TIMEOUT_MS = 120_000;

/** Runs that failed (the worker erred or timed out) before completing a replay is given up. A run cut short by the page closing does not count. */
export const COMPLETION_TRIES = 3;

/** The completer that runs each job in a fresh module worker; null when this browser has no Web Workers. */
export function workerCompleter(): Completer | null {
  if (typeof Worker === 'undefined') return null;
  return (file, build) =>
    new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./recording.worker.ts', import.meta.url), { type: 'module', name: 'openmtg-replay-recording' });
      } catch (e) {
        console.error('[Replays] the recording worker could not start', e);
        resolve(null);
        return;
      }
      const finish = (done: CompletedGame | null) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(done);
      };
      const timer = setTimeout(() => finish(null), WORKER_TIMEOUT_MS);
      worker.onmessage = (e: MessageEvent<CompleteReply>) => {
        if (!e.data.ok) console.error('[Replays] the recording worker failed:', e.data.message);
        finish(e.data.ok ? e.data.done : null);
      };
      worker.onerror = (e) => {
        console.error('[Replays] the recording worker failed', e.message);
        finish(null);
      };
      const request: CompleteRequest = { file, build };
      worker.postMessage(request);
    });
}

/** Completes the library's game replays one at a time (see the file comment). */
export class CompletionQueue {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly library: ReplayLibrary,
    private readonly complete: Completer,
    private readonly build: string | null,
  ) {}

  /** Complete the replay `id` after the jobs before it. The promise settles when it is done (never rejects). */
  enqueue(id: string): Promise<void> {
    const job = this.queue.then(() => this.run(id));
    this.queue = job.catch((e: unknown) => console.error('[Replays] a replay could not be completed', e));
    return this.queue;
  }

  /**
   * At start: queue every replay still waiting for its recording (see the file comment); a mark that can no longer be met (another build, a recording
   * already there) is removed without a run. Returns the ids queued; their jobs run after this settles. Never rejects.
   */
  async resume(): Promise<string[]> {
    const queued: string[] = [];
    try {
      for (const entry of await this.library.list()) {
        if (!entry.completion) continue;
        const s = entry.summary;
        if (s.kind !== 'game' || (s.hasRecording && !entry.completion.replace) || s.engine.build !== this.build) await this.library.markCompletion(entry.key, () => null);
        else {
          queued.push(entry.key);
          void this.enqueue(entry.key);
        }
      }
    } catch (e) {
      console.error('[Replays] the replays waiting for their recordings could not be read', e);
    }
    return queued;
  }

  private async run(id: string): Promise<void> {
    const read = await this.library.read(id);
    // RPL-3: a recording the file carries until the worker's lands (`CompletionMark.replace`) is replaced only by a recording the worker made.
    const replace = (await this.library.entry(id))?.completion?.replace === true;
    if (!read.ok || read.value.kind !== 'game' || (read.value.recording !== undefined && !replace) || read.value.engine.build !== this.build) {
      await this.library.markCompletion(id, () => null);
      return;
    }
    const done = await this.complete(read.value, this.build);
    // The worker failed: tried again at the next start, a few times. A game that does not play here as recorded never will under this build (a
    // recording the file carries stays).
    if (!done) await this.library.markCompletion(id, (m) => (m.tries + 1 < COMPLETION_TRIES ? { ...m, tries: m.tries + 1 } : null));
    else if (!done.recording) await this.library.markCompletion(id, () => null);
    // Merged into the file as it is stored by then: a rename or a toggle made while the worker ran is kept. The mark goes with the recording.
    else await this.library.update(id, (f) => (f.recording !== undefined && !replace ? null : withCompleted(f, done)));
  }
}
