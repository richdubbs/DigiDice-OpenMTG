/**
 * RPL-2 (replays design 5): the checking worker. It receives a game replay's `play` (config, log, checkpoints), runs the game again on this engine off
 * the page's thread and posts its progress and the outcome (check.ts `checkSteps`). It holds nothing but the replay it was given and posts back only
 * where the game is exact, never a state.
 */
import type { ReplayPlay } from '@openmtg/engine';
import { checkSteps, type CheckWorkerMessage } from './check';

/** The worker's global scope, as far as this file uses it (the client is typed against the page's DOM library, not the worker's). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ play: ReplayPlay }>) => void) | null;
  postMessage(message: CheckWorkerMessage): void;
};

scope.onmessage = (e) => {
  const steps = checkSteps(e.data.play);
  for (;;) {
    const r = steps.next();
    if (r.done) {
      scope.postMessage({ type: 'done', outcome: r.value });
      return;
    }
    scope.postMessage({ type: 'progress', done: r.value.done, total: r.value.total });
  }
};
