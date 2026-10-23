/**
 * RPL-1 (replays design 3): the Web Worker that completes a game replay after the game (fallback.ts `completeGame`): it runs the game again, checks its
 * digests and makes the fallback recording, off the page's thread (1-3 s for a game of a few hundred actions, design 12). One job per worker: it gets
 * `{ file, build }` and answers once with `{ ok: true, done }` or `{ ok: false, message }`.
 */
import type { ReplayFile } from '@openmtg/engine';
import { completeGame, type CompletedGame } from './fallback';

export interface CompleteRequest {
  file: ReplayFile;
  build: string | null;
}

export type CompleteReply = { ok: true; done: CompletedGame } | { ok: false; message: string };

/** The worker's global scope, typed by the two members used here (the client compiles with the DOM's types, not the worker's). */
const scope = globalThis as unknown as {
  onmessage: ((e: { data: CompleteRequest }) => void) | null;
  postMessage(message: CompleteReply): void;
};

scope.onmessage = (e) => {
  let reply: CompleteReply;
  try {
    reply = { ok: true, done: completeGame(e.data.file, e.data.build) };
  } catch (err) {
    reply = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(reply);
};
