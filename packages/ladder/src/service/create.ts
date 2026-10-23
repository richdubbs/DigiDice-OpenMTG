/**
 * M15-3: the ladder service (design 13.4, 7, 8, 10, 11.2-11.3). Owned by M15-3 since M15-1's stub.
 *
 * `createLadderService(ports)` checks the configuration (a RangeError naming the first problem) and puts the parts together:
 *   src/service/core.ts       the shared state: ports, the serial queue, the memory of running starts and cooldowns, listeners, report filing
 *   src/service/queue.ts      eligibility, matcherContext, entryFor, readyCheckMissed, registerStart, stakes
 *   src/service/intake.ts     intake: the adapter, computeApplication, applyGame / markSkipped, conflicts
 *   src/service/sweep.ts      sweep: the ledger read and its cursor, reconciliation, season closes (seasons.ts), the daily abuse run, the outbox
 *   src/service/reads.ts      status, leaderboard, history, profile (with views.ts and the sealed cursors of cursor.ts)
 *   src/service/rights.ts     exportAccount, forgetAccount, resetRating (reset.ts), standingChanged
 * Wiring at sync (M15-8): `const ladder = createLadderService(ports); await ladder.open(); const ranked =
 * createRatedMatcher(ladder.matcherContext(sessionBusy)); ladder.attachQueue(ranked);` then the first `sweep()`. `open()` must run first: every
 * method that reads or keeps the memory of running starts and cooldowns refuses before it.
 *
 * src/index.ts re-exports this file with `export *` and is never edited after M15-1, so what else of M15-3 hosted needs from the package root is
 * re-exported here: the memory and file stores (src/store/{memory,file}.ts), the cursors' shape check (parseCursor, src/service/cursor.ts) and the
 * default configuration (src/service/config.ts).
 */
import type { LadderPorts, LadderService } from './api';
import { ServiceCore } from './core';
import { intakeRecord } from './intake';
import * as queue from './queue';
import * as reads from './reads';
import * as rights from './rights';
import { sweep, SweepState } from './sweep';

export { createMemoryLadderStore, LadderStoreError, MemoryLadderStore, type LadderStoreErrorCode, type MemoryLadderStoreOptions } from '../store/memory';
export {
  FileLadderStore, LADDER_FILE_STORE_FILES, LADDER_STORE_IN_USE, openFileLadderStore, type FileLadderStoreOptions,
} from '../store/file';
export { LadderCursorError, parseCursor, type HistoryCursor, type LadderCursor, type LeaderboardCursor } from './cursor';
export { checkLadderConfig, DEFAULT_LADDER_CONFIG } from './config';

/** The ladder service on its ports (13.4). Hosted then calls `open()` once, before anything else. */
export function createLadderService(ports: LadderPorts): LadderService {
  const core = new ServiceCore(ports);
  const state = new SweepState();
  const open = (what: string) => core.mustBeOpen(what);
  return {
    open: () =>
      core.serial(async () => {
        if (core.opened) return;
        const now = core.nowIso();
        for (const s of await core.store.runningStarts()) for (const seat of s.seats) if (seat.account !== null) core.busy.set(seat.account, s.game);
        for (const p of await core.store.activeCooldowns(now)) if (p.cooldownUntil !== null) core.cooldowns.set(p.account, Date.parse(p.cooldownUntil));
        core.opened = true;
        core.log.info('ladder.opened', { running: core.busy.size, cooldowns: core.cooldowns.size });
      }),
    eligibility: (account, ladder) => queue.eligibility(core, account, ladder),
    accountBusy: (account) => core.busy.has(account),
    cooldownUntil: (account) => queue.cooldownUntil(core, account),
    matcherContext: (sessionBusy) => queue.matcherContext(core, sessionBusy),
    attachQueue: (q) => {
      for (const m of ['queued', 'status', 'window', 'accounts'] as const) {
        if (typeof q?.[m] !== 'function') throw new TypeError(`attachQueue: the queue has no ${m}()`);
      }
      core.queue = q;
    },
    entryFor: async (q, queued) => {
      open('entryFor');
      return queue.entryFor(core, q, queued);
    },
    blockedAmong: async (accounts) => core.ports.accounts.blockedAmong(accounts),
    readyCheckMissed: (match, accounts) => core.serial(() => queue.readyCheckMissed(core, match, accounts)),
    registerStart: (s) => core.serial(() => queue.registerStart(core, s)),
    stakes: async (game) => queue.stakes(core, game),
    intake: (record) =>
      core.serial(async () => {
        open('intake');
        return intakeRecord(core, record);
      }),
    sweep: async () => sweep(core, state),
    standingChanged: (accounts) => core.serial(() => rights.standingChanged(core, accounts)),
    status: async (viewer) => reads.status(core, viewer),
    leaderboard: async (q, viewer) => reads.leaderboard(core, q, viewer),
    history: async (q, viewer) => reads.history(core, q, viewer),
    profile: async (account, viewer) => reads.profile(core, account, viewer),
    exportAccount: (account) => core.serial(() => rights.exportAccount(core, account)),
    forgetAccount: (account) => core.serial(() => rights.forgetAccount(core, account)),
    resetRating: (account, ladder, by, reason) => core.serial(() => rights.resetRating(core, account, ladder, by, reason)),
    onRated: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('onRated: the listener is not a function');
      core.rated.add(listener);
      return () => void core.rated.delete(listener);
    },
    onNotRated: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('onNotRated: the listener is not a function');
      core.notRated.add(listener);
      return () => void core.notRated.delete(listener);
    },
  };
}
