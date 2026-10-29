/**
 * "Report a bug" over the table channel (the Godot app's dialog; the browser client's bugs/capture.ts and BugReportDialog.tsx): the moment is taken when
 * the dialog opens (`replayCapture`, `gameCapture`), and the report is made with the reporter's words when they save it (`makeBugReport`, @openmtg/play
 * bugs/report.ts) and handed back as the bytes of the file to save. Nothing is sent anywhere.
 *
 * What a report holds (client bugs/report.ts): a replay being watched, that replay and the moment on screen; a local game, the game so far (its replay:
 * the engine ran here, so the report holds every player's cards, as the player's own replay does); a local game with no action yet, the view on screen as
 * a recording of one frame.
 */
import {
  REPLAY_FORMAT, REPLAY_FORMAT_VERSION, cleanText, currentEngine, type GameEvent, type GameView, type PlayerId, type ReplayApp, type ReplayFile, type ReplayMode,
  type ReplayPlayer,
} from '@openmtg/engine';
import { bugReport, bugReportFileName, encodeBugReport, momentOf, type ReportContent, type ReportEnvironment } from '@openmtg/play/bugs/report';
import { engineBuild } from '../engineBuild';
import { defaultTitle, newReplayId } from '../library/replays';

/** The report's game part, taken at one moment. */
export interface BugCapture {
  content: ReportContent;
  /** The kind of replay it carries: the game itself, or a recording. */
  kind: 'game' | 'recording';
  /** The number of actions (a game) or frames (a recording) it holds. */
  length: number;
}

/** What the screen shows of a local game now, for a report made before its first action. */
export interface ScreenFacts {
  view: GameView;
  events: readonly GameEvent[];
  /** How many changes the screen was shown. */
  changes: number;
  mode: ReplayMode;
  format: string;
  /** The seats the computer plays. */
  computers: readonly PlayerId[];
}

function lengthOf(r: ReplayFile): number {
  return r.kind === 'game' && r.play ? r.play.actions.length : r.recording?.frames.length ?? 0;
}

/** A replay being watched at `position` (the actions applied on screen): the replay as the player has it, and the moment. */
export function replayCapture(file: ReplayFile, position: number): BugCapture {
  return { content: { replay: file, at: momentOf(file, position), holds: 'replay' }, kind: file.kind, length: lengthOf(file) };
}

/** A local game: the game so far (`soFar`, its replay), else, before its first action, what the screen shows. */
export function gameCapture(soFar: ReplayFile | null, screen: ScreenFacts, app: ReplayApp): BugCapture {
  if (soFar && soFar.kind === 'game' && soFar.play && soFar.play.actions.length > 0) {
    return { content: { replay: soFar, at: soFar.play.actions.length - 1, holds: 'game' }, kind: 'game', length: soFar.play.actions.length };
  }
  const replay = screenReplay(screen, app);
  return { content: { replay, at: 0, holds: 'view' }, kind: 'recording', length: lengthOf(replay) };
}

/** The view on screen as a recording of one frame of its viewer (client bugs/report.ts `seatReplay`). */
function screenReplay(f: ScreenFacts, app: ReplayApp): ReplayFile {
  const { defs, ...key } = f.view;
  const computers = new Set(f.computers);
  const players: ReplayPlayer[] = f.view.players.map((p) => ({
    id: p.id, name: cleanText(p.name).trim().slice(0, 64) || p.id, kind: computers.has(p.id) ? 'computer' : 'person',
  }));
  const now = new Date().toISOString();
  const result = f.view.result ?? null;
  const conceded = result !== null && f.view.players.some((p) => p.hasLost && p.conceded);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'recording',
    id: newReplayId(),
    title: defaultTitle(players, f.format),
    createdAt: now,
    app: { ...app },
    engine: currentEngine(engineBuild()),
    game: {
      mode: f.mode,
      format: cleanText(f.format).slice(0, 40),
      players,
      savedBy: f.view.viewer,
      ended: result ? (conceded ? 'conceded' : 'finished') : 'abandoned',
      result: result ? { winner: result.winner, reason: result.reason } : null,
      turns: f.view.turn.number,
      actions: Math.max(0, Math.floor(f.changes)),
      startedAt: now,
      endedAt: now,
    },
    reveal: { policy: 'own', agreed: [] },
    recording: { viewer: f.view.viewer, defs: { ...defs }, frames: [{ seq: 0, t: 0, key, events: [...f.events] }] },
  };
}

/** The environment a screen sends, as the report's (anything else is left out; the report's validator checks the rest). */
export function environmentOf(raw: unknown): ReportEnvironment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const app = e['app'] as Record<string, unknown> | undefined;
  const browser = e['browser'] as Record<string, unknown> | undefined;
  const settings = e['settings'];
  const errors = e['errors'];
  if (!app || typeof app['version'] !== 'string' || !browser || typeof browser['userAgent'] !== 'string') return null;
  if (typeof settings !== 'object' || settings === null || !Array.isArray(errors)) return null;
  return {
    app: { version: app['version'], commit: typeof app['commit'] === 'string' ? app['commit'] : null },
    browser: {
      userAgent: browser['userAgent'],
      ...(typeof browser['language'] === 'string' ? { language: browser['language'] } : {}),
      ...(typeof browser['screen'] === 'string' ? { screen: browser['screen'] } : {}),
    },
    settings: settings as ReportEnvironment['settings'],
    errors: errors as ReportEnvironment['errors'],
  };
}

/** The report of `capture` with the reporter's words: the file's name and its bytes (base64), or why it could not be made. */
export async function makeBugReport(
  capture: BugCapture,
  words: string,
  card: string | null,
  env: ReportEnvironment,
): Promise<{ name: string; data: string } | { error: string }> {
  const report = bugReport(capture.content, { words, card }, env);
  if (!report.ok) return { error: `The report could not be made: ${report.error.message}` };
  try {
    const bytes = await encodeBugReport(report.value);
    return { name: bugReportFileName(new Date()), data: Buffer.from(bytes).toString('base64') };
  } catch (e) {
    return { error: `The report could not be made: ${e instanceof Error ? e.message : String(e)}` };
  }
}
