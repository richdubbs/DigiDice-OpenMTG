/**
 * RPL-4 (replays design 11, D7): the bug report file, built on RPL-0's types (engine replay/format.ts `BugReportFile`): the game as a replay (section
 * 4), the moment reported (`at`), the reporter's own words and, optionally, the card it is about, the app, the browser, the display settings and the
 * errors the page caught. Nothing else goes in. Pure: no storage, no clock, no page (times and ids are passed in).
 *
 * Whose view (design 6, 11; roadmap "a report never shows the reporter anything they could not see"): a report holds no more than the reporter's own
 * replay of the game may hold, so it never holds more than this machine already had (design 6, "What enforces it"):
 *  - a local game (hot-seat, against the computer) carries the game itself, as its replay does (`'game'`): the engine ran here;
 *  - a replay being watched carries that replay as the player has it (`'replay'`), but the game replay of an online game that not every person agreed
 *    to show (the host's own file holds the guests' cards) carries what the saver's seat was shown up to that moment (`'recording'`, or `'view'`);
 *  - an online game carries what this page was shown of it, as a guest's replay is its recording: the recording so far when one is registered for
 *    the game (`'recording'`, bugs/capture.ts), else what this screen shows, a recording of one frame: the view on screen with its log and the events
 *    of the last change, redacted for the reporter's seat as they were shown (`'view'`, `seatReplay`). Only when every person agreed (the reveal
 *    policy `'all'`) may an online report carry the game itself.
 *
 * Every report is checked by RPL-0's validator (`checkBugReport`) as the JSON it will be saved as, so a report the player saves is one the developer's
 * `npm run bug -- replay` reads.
 */
import {
  BUG_REPORT_FORMAT, BUG_REPORT_FORMAT_VERSION, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, checkBugReport, cleanText, writeGzippedJson, type BugReportFile,
  type Checked, type GameEvent, type GameState, type GameView, type PlayerId, type ReplayApp, type ReplayEngine, type ReplayFile, type ReplayMode,
  type ReplayPlayer,
} from '@openmtg/engine';
import { defaultTitle, endingOf } from '../replays/file';

/** The file name extension of a saved bug report. */
export const BUG_REPORT_EXTENSION = '.openmtg-bug-report';
/** The longest description and card name a report holds (the validator's bounds, engine replay/validate.ts). */
export const WORDS_MAX = 20_000;
export const CARD_MAX = 200;
/** The most errors a report holds (the validator allows 200; the page keeps fewer, errors.ts). */
const ERRORS_MAX = 200;

/** Which replay a report carries (see the file comment; `'recording'`: an online game's recording so far, bugs/capture.ts). */
export type ReportHolds = 'game' | 'replay' | 'recording' | 'view';

/** What a report carries of the game: the replay, the moment reported in it, and which kind of replay that is. */
export interface ReportContent {
  replay: ReplayFile;
  /** The index of the action reported (a game: the last one applied, 0 before any), or of the frame (a recording). */
  at: number;
  holds: ReportHolds;
}

/** The page the report was made on (design 11: app, browser, settings, errors). */
export interface ReportEnvironment {
  app: ReplayApp;
  browser: BugReportFile['browser'];
  settings: BugReportFile['settings'];
  errors: BugReportFile['errors'];
}

/** What the reporter wrote: what happened and what they expected, and the card it is about (optional). */
export interface ReporterWords {
  words: string;
  card?: string | null;
}

/**
 * The reported moment of a replay watched at `position` (the replay viewer's position: the number of actions applied, or the frame shown): for a game
 * replay the index of the last action applied (0 at the start), for a recording the frame. A game replay's fallback recording has one frame per
 * position (replays/fallback.ts), so the formula holds there too.
 */
export function momentOf(replay: ReplayFile, position: number): number {
  const p = Number.isFinite(position) ? Math.max(0, Math.floor(position)) : 0;
  if (replay.kind === 'game' && replay.play) return Math.min(Math.max(0, p - 1), Math.max(0, replay.play.actions.length - 1));
  return Math.min(p, Math.max(0, (replay.recording?.frames.length ?? 1) - 1));
}

/** A shown name: no control characters (util/shown-text.ts), within the validator's 64, never empty. */
function seatName(name: string, id: string): string {
  return cleanText(name).trim().slice(0, 64) || id;
}

export interface SeatReplayArgs {
  /** The view on screen (the reporter's seat; a spectator's view has viewer null). */
  view: GameView;
  /** The events of the last change shown, as the screen got them (redacted for the view's viewer). */
  events: readonly GameEvent[];
  /** How many changes the screen was shown (its event batches' `seq`). */
  changes: number;
  mode: ReplayMode;
  /** The format played ('' when not known). */
  format: string;
  /** The seats the computer plays (a local game); every other seat is a person. */
  computers?: readonly PlayerId[];
  /** The replay's id ("r-..."). */
  id: string;
  /** ISO 8601: now. */
  now: string;
  app: ReplayApp;
  engine: ReplayEngine;
}

/**
 * The replay of what this screen shows (see the file comment, `'view'`): a recording of the view's viewer with one key frame, the view on screen
 * without its definitions (the recording keeps them once) and the events of the last change. It holds exactly that view and those events.
 */
export function seatReplay(a: SeatReplayArgs): ReplayFile {
  const { defs, ...key } = a.view;
  const computers = new Set(a.computers ?? []);
  const players: ReplayPlayer[] = a.view.players.map((p) => ({ id: p.id, name: seatName(p.name, p.id), kind: computers.has(p.id) ? 'computer' : 'person' }));
  const ending = endingOf(a.view as unknown as GameState);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'recording',
    id: a.id,
    title: defaultTitle(players, a.format),
    createdAt: a.now,
    app: { ...a.app },
    engine: { ...a.engine },
    game: {
      mode: a.mode,
      format: cleanText(a.format).slice(0, 40),
      players,
      savedBy: a.view.viewer,
      ended: ending?.ended ?? 'abandoned',
      result: ending?.result ?? null,
      turns: a.view.turn.number,
      actions: Math.max(0, Math.floor(a.changes)),
      startedAt: a.now,
      endedAt: a.now,
    },
    reveal: { policy: 'own', agreed: [] },
    recording: { viewer: a.view.viewer, defs: { ...defs }, frames: [{ seq: 0, t: 0, key, events: [...a.events] }] },
  };
}

/** The card a report is about: a shown name (no control characters), within the bound; null when none was given. */
export function reportCard(card: string | null | undefined): string | null {
  const c = cleanText(card ?? '').trim().slice(0, CARD_MAX).trim();
  return c === '' ? null : c;
}

/**
 * The bug report (design 11) of `content` with the reporter's words and the page's environment, as the JSON it is saved as, checked by RPL-0's
 * validator. Never throws: a report that would not pass is refused with the validator's reason.
 */
export function bugReport(content: ReportContent, said: ReporterWords, env: ReportEnvironment): Checked<BugReportFile> {
  const card = reportCard(said.card);
  const report: BugReportFile = {
    format: BUG_REPORT_FORMAT,
    formatVersion: BUG_REPORT_FORMAT_VERSION,
    replay: content.replay,
    at: { action: Number.isFinite(content.at) ? Math.max(0, Math.floor(content.at)) : 0 },
    words: said.words.slice(0, WORDS_MAX),
    ...(card !== null ? { card } : {}),
    app: { version: env.app.version, commit: env.app.commit },
    browser: { ...env.browser },
    settings: { ...env.settings },
    errors: env.errors.slice(-ERRORS_MAX).map((e) => ({ ...e })),
  };
  // Checked as the JSON it is saved as: a key whose value is undefined is not in the file, and the validator reads the file.
  let json: unknown;
  try {
    json = JSON.parse(JSON.stringify(report));
  } catch (e) {
    return { ok: false, error: { code: 'malformed', message: `The report could not be written: ${e instanceof Error ? e.message : String(e)}` } };
  }
  return checkBugReport(json);
}

/** The bytes of a report to save: its JSON, gzipped (as JSON text when this browser cannot compress; the reader takes both). */
export async function encodeBugReport(report: BugReportFile): Promise<Uint8Array> {
  const gz = await writeGzippedJson(report);
  if (gz.ok) return gz.value;
  if (gz.error.code !== 'unavailable') throw new Error(gz.error.message);
  return new TextEncoder().encode(JSON.stringify(report));
}

/** The file name a report is saved as: "openmtg-bug-2026-10-22-1530.openmtg-bug-report" (local time). */
export function bugReportFileName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `openmtg-bug-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${BUG_REPORT_EXTENSION}`;
}
