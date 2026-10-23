/**
 * RPL-1: what the recorder, the end screen and the Replays screen share: the library (IndexedDB `openmtg-replays`), the Web Locks that tell a live
 * record from an abandoned one, the worker that completes a replay after the game, the clock, and the engine build and app the replays record. One
 * set per page (`pageReplays`); tests make their own (`replayEnv`).
 */
import type { ReplayApp } from '@openmtg/engine';
import { APP, ENGINE_BUILD } from '../engine-build';
import { CompletionQueue, workerCompleter, type Completer } from './completion';
import { defaultReplayDb, type ReplayDb } from './db';
import { ReplayLibrary, type LibraryOptions } from './library';
import { browserLiveness, type Liveness } from './liveness';

export interface ReplayEnv {
  library: ReplayLibrary;
  liveness: Liveness;
  /** Completes a replay after the game (the fallback recording); null without Web Workers. */
  completion: CompletionQueue | null;
  /** Epoch milliseconds. */
  now: () => number;
  /** The engine build this client was built with (engine-build.ts; null on the dev server). */
  build: string | null;
  /** The app the replays record they were saved by. */
  app: ReplayApp;
}

/** An environment over `db` (tests: a MemoryReplayDb, a fixed clock, a completer of their own or none). */
export function replayEnv(db: ReplayDb, opts: { now?: () => number; liveness?: Liveness; completer?: Completer | null; build?: string | null; app?: ReplayApp; library?: LibraryOptions } = {}): ReplayEnv {
  const now = opts.now ?? (() => Date.now());
  const build = opts.build === undefined ? ENGINE_BUILD : opts.build;
  const library = new ReplayLibrary(db, { now, ...opts.library });
  const completer = opts.completer === undefined ? workerCompleter() : opts.completer;
  return {
    library,
    liveness: opts.liveness ?? browserLiveness(),
    completion: completer ? new CompletionQueue(library, completer, build) : null,
    now,
    build,
    app: opts.app ?? APP,
  };
}

let page: ReplayEnv | null = null;

/** This page's replays: the browser's database, Web Locks and worker. */
export function pageReplays(): ReplayEnv {
  page ??= replayEnv(defaultReplayDb());
  return page;
}
