/**
 * Review 2026-10-26 F1: the page's engine worker. The engine and the AI of a local game (hot-seat, or against the computer) run here, off the page's
 * thread, so the board never drops a frame while the computer thinks or a big action resolves. Its logic is gameHost.ts (tested in-thread); this file
 * only pumps the messages (gameWorkerProtocol.ts). One game per worker; the page terminates it when the game leaves the screen for good.
 *
 * The same worker also completes a game replay after the game (replays/completeJob.ts, started by replays/completion.ts with a `{ file, build }` job):
 * one bundle carries the engine for both, so the build makes (and the browser caches) the engine's worker once.
 */
import { answerComplete, isCompleteRequest, type CompleteReply } from '../replays/completeJob';
import { GameHost } from './gameHost';
import type { FromWorker, ToWorker } from './gameWorkerProtocol';

/** The worker's global scope, typed by the two members used here (the client compiles with the DOM's types, not the worker's). */
const scope = globalThis as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: FromWorker | CompleteReply): void;
};

let host: GameHost | null = null;

scope.onmessage = (e) => {
  if (isCompleteRequest(e.data)) {
    scope.postMessage(answerComplete(e.data));
    return;
  }
  host ??= new GameHost((message) => scope.postMessage(message));
  host.receive(e.data as ToWorker);
};
