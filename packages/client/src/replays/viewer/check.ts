/**
 * RPL-2 (replays design 5): checking a game replay on this engine. The check itself (`checkSteps`, `inlineChecker`) moved to @openmtg/play (the local
 * server plays replays to the Godot app too); the browser's checking worker stays here.
 */
import type { ReplayPlay } from '@openmtg/engine';
import { DEFAULT_TIMERS, inlineChecker, type CheckOutcome, type ReplayChecker, type Timers } from '@openmtg/play/replay/check';

export * from '@openmtg/play/replay/check';

/** A message from the checking worker (checkWorker.ts). */
export type CheckWorkerMessage = { type: 'progress'; done: number; total: number } | { type: 'done'; outcome: CheckOutcome };

/**
 * The check in a Web Worker (design 5: 4-8 ms an action, 1-3 s for a game of a few hundred, off the page's thread), or null where the browser has none
 * or it cannot start. A worker that fails is answered by the inline check.
 */
export function workerChecker(): ReplayChecker | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker | null = null;
  let fallback: ReplayChecker | null = null;
  const stop = () => {
    worker?.terminate();
    worker = null;
  };
  return {
    check(play, onProgress) {
      return new Promise<CheckOutcome>((resolve) => {
        const inline = () => {
          stop();
          fallback = inlineChecker();
          void fallback.check(play, onProgress).then(resolve);
        };
        try {
          worker = new Worker(new URL('./checkWorker.ts', import.meta.url), { type: 'module' });
        } catch {
          return inline();
        }
        worker.onmessage = (e: MessageEvent<CheckWorkerMessage>) => {
          const m = e.data;
          if (m.type === 'progress') onProgress({ done: m.done, total: m.total });
          else {
            stop();
            resolve(m.outcome);
          }
        };
        worker.onerror = (e) => {
          e.preventDefault();
          inline();
        };
        worker.postMessage({ play });
      });
    },
    cancel() {
      stop();
      fallback?.cancel();
    },
  };
}

/** The checker a replay uses by default: the worker where there is one, else the inline check. */
export function defaultChecker(timers: Timers = DEFAULT_TIMERS): ReplayChecker {
  return workerChecker() ?? inlineChecker(timers);
}
