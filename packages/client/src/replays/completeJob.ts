/**
 * RPL-1 (replays design 3): the job that completes a game replay after the game (fallback.ts `completeGame`): it runs the game again, checks its digests
 * and makes the fallback recording, off the page's thread (1-3 s for a game of a few hundred actions, design 12). It runs in the page's engine worker
 * (connection/game.worker.ts, review 2026-10-26 F1: one worker bundle carries the engine for both jobs, so the build makes the engine's worker once). One
 * job per worker: it gets `{ file, build }` and answers once with `{ ok: true, done }` or `{ ok: false, message }`.
 */
import type { ReplayFile } from '@openmtg/engine';
import { completeGame, type CompletedGame } from './fallback';

export interface CompleteRequest {
  file: ReplayFile;
  build: string | null;
}

export type CompleteReply = { ok: true; done: CompletedGame } | { ok: false; message: string };

/** Whether a message to the engine worker is this job's (the game's messages all carry `t`, connection/gameWorkerProtocol.ts). */
export function isCompleteRequest(m: unknown): m is CompleteRequest {
  return typeof m === 'object' && m !== null && 'file' in m && !('t' in m);
}

/** Do the job. Never throws. */
export function answerComplete(req: CompleteRequest): CompleteReply {
  try {
    return { ok: true, done: completeGame(req.file, req.build) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
