/**
 * RPL-2 (replays design 5): checking a game replay on this engine. The engine is deterministic only per build (m13 design D5), so a replay made on
 * another build is run again from its config and compared with its checkpoint digests (`gameDigest`, RPL-0) before it is shown: it plays exactly up to
 * the last checkpoint that matches. Under the same build the replay is exact by construction; the digests are still compared (cheap), and a difference
 * there is an engine bug (nondeterminism).
 *
 * `checkSteps` is the check itself, a generator that yields its progress, so the same code runs in the browser's checking worker (the client's
 * replays/viewer/checkWorker.ts, off the page's thread) and, in the local server or where the browser has no workers, in short slices (`inlineChecker`). It never throws: a config the
 * engine refuses, an action it rejects or cannot read, and anything it throws end the check where they happen (`startReplay`, `replayAction`).
 */
import { gameDigest, replayAction, startReplay, type GameState, type ReplayPlay } from '@openmtg/engine';

/** Why a check stopped before the end of the log: a digest that differs, the engine refusing the config or an action, or a log end no checkpoint covers. */
export type CheckCause = 'digest' | 'config' | 'shape' | 'illegal' | 'threw' | 'unchecked';

export interface CheckProblem {
  cause: CheckCause;
  /** The index of the action where the check stopped (-1: the config). */
  at: number;
  message: string;
}

export interface CheckOutcome {
  /**
   * The last position known to be exact: the number of actions applied at the last checkpoint that matched (the game's state there is the one recorded),
   * or -1 when no checkpoint matched (not even the start can be trusted: another build may deal other opening hands).
   */
  verified: number;
  /** The turn at `verified` (0 when none). */
  verifiedTurn: number;
  /** The log's length. */
  total: number;
  /** Null when every checkpoint matched and the last one is at the end of the log. */
  problem: CheckProblem | null;
}

export interface CheckProgress {
  done: number;
  total: number;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Every `PROGRESS_EVERY` actions the check reports how far it is. */
const PROGRESS_EVERY = 10;

/**
 * Run a replay's log from its config and compare each recorded checkpoint (the state right after its action, design 4) with this engine's digest of
 * that state. Yields progress; returns where the game is exact.
 */
export function* checkSteps(play: ReplayPlay): Generator<CheckProgress, CheckOutcome, void> {
  const total = play.actions.length;
  const start = startReplay(play.config);
  if (!start.ok) return { verified: -1, verifiedTurn: 0, total, problem: { cause: 'config', at: -1, message: start.rejection.error.message } };
  let state: GameState = start.state;
  let verified = -1;
  let verifiedTurn = 0;
  let next = 0; // the next recorded checkpoint
  const checkpoints = play.checkpoints;
  for (let i = 0; i < total; i++) {
    const r = replayAction(state, play.actions[i]!, i);
    if (!r.ok) return { verified, verifiedTurn, total, problem: { cause: r.rejection.cause, at: i, message: r.rejection.error.message } };
    state = r.state;
    while (next < checkpoints.length && checkpoints[next]!.action < i) next++;
    const c = checkpoints[next];
    if (c !== undefined && c.action === i) {
      next++;
      let digest: string;
      try {
        digest = gameDigest(state);
      } catch (e) {
        return { verified, verifiedTurn, total, problem: { cause: 'threw', at: i, message: `The engine failed on action ${i + 1}: ${messageOf(e)}` } };
      }
      if (c.turn !== state.turn.number || c.digest !== digest) {
        return { verified, verifiedTurn, total, problem: { cause: 'digest', at: i, message: `The game differs after action ${i + 1} (turn ${c.turn}).` } };
      }
      verified = i + 1;
      verifiedTurn = state.turn.number;
    }
    if ((i + 1) % PROGRESS_EVERY === 0) yield { done: i + 1, total };
  }
  // A recorder takes a checkpoint at the last action (design 4); a log whose end no checkpoint covers is exact only up to its last one.
  if (verified < total) {
    const at = Math.max(0, verified);
    return { verified, verifiedTurn, total, problem: { cause: 'unchecked', at, message: `No checkpoint covers the game after action ${at}.` } };
  }
  return { verified, verifiedTurn, total, problem: null };
}

/** Runs a check, reporting progress; `cancel` stops it (its promise then never settles). */
export interface ReplayChecker {
  check(play: ReplayPlay, onProgress: (p: CheckProgress) => void): Promise<CheckOutcome>;
  cancel(): void;
}

/** Timers the page's own work is scheduled with (setTimeout by default; tests pass their own). */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const DEFAULT_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The check on the page's own thread, in slices of about `sliceMs`, so the page stays responsive (where there is no worker). */
export function inlineChecker(timers: Timers = DEFAULT_TIMERS, sliceMs = 12): ReplayChecker {
  let stopped = false;
  let handle: unknown = null;
  return {
    check(play, onProgress) {
      stopped = false;
      const steps = checkSteps(play);
      return new Promise<CheckOutcome>((resolve) => {
        const slice = () => {
          handle = null;
          if (stopped) return;
          const until = Date.now() + sliceMs;
          for (;;) {
            const r = steps.next();
            if (r.done) return resolve(r.value);
            onProgress(r.value);
            if (Date.now() >= until) break;
          }
          handle = timers.set(slice, 0);
        };
        handle = timers.set(slice, 0);
      });
    },
    cancel() {
      stopped = true;
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
  };
}
