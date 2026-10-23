/**
 * RPL-4 (replays design 11): what a bug report carries of the game on a screen, taken at the moment the player asks to report (report.ts has the
 * rules of whose view):
 *  - a replay being watched (connection kind `'replay'`): the replay file it plays (bugs/watched.ts) and the position on screen; but for the game
 *    replay of an online game that not every person agreed to show (RPL-3: the host's file holds the guests' cards, its server ran the game), only what
 *    the saver's seat was shown up to that position: the file's fallback recording when it is that seat's, else the view on screen;
 *  - a recorded local game (replays/live.ts, `LiveReplay.soFar`): the game so far, at its last action;
 *  - an online game whose replay so far is registered for its connection (the same `LiveReplay.soFar`; RPL-3's recorders may register one): its
 *    recording (what this player was shown), or the game itself only when its reveal policy is `'all'` (every person agreed; roadmap: an online
 *    report carries only the reporter's own view "unless both players agree");
 *  - anything else (an online game without one, a local game that is not recorded): the view on screen, as a one-frame recording of its viewer.
 *
 * FXH (audit m5, CR 400.2): a local game's file holds the whole game (its seed, every deck), so it is kept in the closure of the frozen object this
 * returns, never in the dialog's props or state: React DevTools shows the facts and the functions, not the game.
 */
import { currentEngine, type BugReportFile, type Checked, type PlayerId, type ReplayApp, type ReplayFile, type ReplayMode } from '@openmtg/engine';
import type { GameConnection } from '../connection/GameConnection';
import { APP, ENGINE_BUILD } from '../engine-build';
import { newReplayId } from '../replays/file';
import { liveReplayOf } from '../replays/live';
import { replayControllerOf } from '../replays/viewer/controllerOf';
import { everyoneAgreed } from '../replays/viewer/policy';
import { bugReport, momentOf, seatReplay, type ReportContent, type ReportEnvironment, type ReporterWords, type ReportHolds } from './report';
import { watchedReplayOf } from './watched';

/** The online game's side of this screen, when the game is online (the game screen's online status). */
export interface ReportOnline {
  role: 'host' | 'guest' | 'none';
  format?: string;
}

export interface ReportContext {
  online?: ReportOnline | null;
  /** Epoch milliseconds (default Date.now). */
  now?: () => number;
  /** This client's engine build and app (default engine-build.ts). */
  build?: string | null;
  app?: ReplayApp;
}

/** A report's game part, taken at one moment: what the dialog may show of it, and the report it makes with the reporter's words. */
export interface ReportCapture {
  readonly holds: ReportHolds;
  /** The kind of replay the report carries: the game itself, or a recording. */
  readonly kind: 'game' | 'recording';
  /** The moment: the action's index (a game), or the frame's (a recording). */
  readonly at: number;
  /** The number of actions (a game) or frames (a recording) the replay holds. */
  readonly length: number;
  readonly report: (said: ReporterWords, env: ReportEnvironment) => Checked<BugReportFile>;
}

/** Where an online game's seat report says it was played; a local game that is not recorded says hot-seat or against the computer. */
function modeOf(connection: GameConnection, ctx: ReportContext, computers: readonly PlayerId[]): ReplayMode {
  if (connection.kind === 'remote') return ctx.online?.role === 'host' ? 'onlineHost' : 'onlineGuest';
  return computers.length > 0 ? 'computer' : 'hotseat';
}

/** The modes of games played on this machine, whose game replay a report may carry as the player has it (the engine ran here). */
const LOCAL_MODES: ReadonlySet<ReplayMode> = new Set<ReplayMode>(['hotseat', 'computer']);

/**
 * A watched game replay of an online game without every person's agreement (see the file comment): the saver's seat's recording up to `position` (the
 * actions applied on screen), cut from the file's fallback recording when that is the seat's; null when it has none.
 */
function savedSeatRecording(file: ReplayFile, position: number): ReportContent | null {
  const rec = file.recording;
  if (!rec || rec.viewer === null || rec.viewer !== file.game.savedBy) return null;
  const frames = rec.frames.filter((f) => f.seq <= position);
  if (frames.length === 0) return null;
  const { play: _play, recording: _recording, ...rest } = file;
  const replay: ReplayFile = {
    ...rest, kind: 'recording', game: { ...file.game, actions: frames[frames.length - 1]!.seq }, recording: { viewer: rec.viewer, defs: { ...rec.defs }, frames },
  };
  return { replay, at: frames.length - 1, holds: 'recording' };
}

/** What the report carries of the game on `connection` now (see the file comment). */
export function reportContent(connection: GameConnection, ctx: ReportContext = {}): ReportContent {
  if (connection.kind === 'replay') {
    const watched = watchedReplayOf(connection) as ReplayFile | null;
    if (watched) {
      const position = replayControllerOf(connection)?.state().position ?? 0;
      if (watched.kind !== 'game' || LOCAL_MODES.has(watched.game.mode) || everyoneAgreed(watched)) {
        return { replay: watched, at: momentOf(watched, position), holds: 'replay' };
      }
      // RPL-3: the host's file of an online game holds every player's cards; without every person's agreement only the saver's seat goes in a report.
      const seat = savedSeatRecording(watched, position);
      if (seat) return seat;
      return { replay: screenReplay(connection, ctx, watched.game.mode, watched.game.format, position), at: 0, holds: 'view' };
    }
  }
  const soFar = connection.kind === 'replay' ? null : liveReplayOf(connection)?.soFar?.() ?? null;
  if (soFar && soFar.kind === 'game' && soFar.play && (connection.kind === 'local' || soFar.reveal.policy === 'all')) {
    return { replay: soFar, at: Math.max(0, soFar.play.actions.length - 1), holds: 'game' };
  }
  if (soFar && soFar.kind === 'recording' && soFar.recording && soFar.recording.frames.length > 0) {
    return { replay: soFar, at: soFar.recording.frames.length - 1, holds: 'recording' };
  }
  const seated = connection.kind === 'local' ? connection.seated?.() : undefined;
  // In a local game the seats nobody sits at are the computer's; online, every seat is a person.
  const computers = seated ? connection.view().players.map((p) => p.id).filter((p) => !seated.includes(p)) : [];
  return { replay: screenReplay(connection, ctx, modeOf(connection, ctx, computers), ctx.online?.format ?? '', null, computers), at: 0, holds: 'view' };
}

/** The view on screen as a one-frame recording of its viewer (`seatReplay`); `changes`: how many changes it follows (default the screen's event batches). */
function screenReplay(
  connection: GameConnection,
  ctx: ReportContext,
  mode: ReplayMode,
  format: string,
  changes: number | null,
  computers: PlayerId[] = [],
): ReplayFile {
  const batch = connection.events?.();
  return seatReplay({
    view: connection.view(),
    events: batch?.events ?? [],
    changes: changes ?? batch?.seq ?? 0,
    mode,
    format,
    computers,
    id: newReplayId(),
    now: new Date((ctx.now ?? Date.now)()).toISOString(),
    app: ctx.app ?? APP,
    engine: currentEngine(ctx.build !== undefined ? ctx.build : ENGINE_BUILD),
  });
}

/** Take the report's game part now (see the file comment). */
export function captureReport(connection: GameConnection, ctx: ReportContext = {}): ReportCapture {
  const content = reportContent(connection, ctx);
  const r = content.replay;
  return Object.freeze({
    holds: content.holds,
    kind: r.kind,
    at: content.at,
    length: r.kind === 'game' && r.play ? r.play.actions.length : r.recording?.frames.length ?? 0,
    report: (said: ReporterWords, env: ReportEnvironment) => bugReport(content, said, env),
  });
}

/** The replay statuses (ReplayConnection's `ReplayBadge`) of a game that does not play here as it was recorded. */
const DIFFERS = new Set(['recordingFrom', 'watchingUpTo', 'unplayable']);

/**
 * Whether a replay being watched offers a bug report by itself (replays design 5.2): a game replay made on this very engine build that plays
 * differently here is an engine bug (nondeterminism). `badge`: the replay's status now. Never on the dev server, which knows no build.
 */
export function replayOffersReport(connection: GameConnection, badge: string | null, build: string | null = ENGINE_BUILD): boolean {
  if (connection.kind !== 'replay' || badge === null || !DIFFERS.has(badge) || build === null) return false;
  const watched = watchedReplayOf(connection) as ReplayFile | null;
  return watched !== null && watched.kind === 'game' && watched.engine.build === build;
}
