/**
 * A hosted bug report as a bug report file (design 4.8, 13.1 M13-13; package M13-13): the report's row, the client's attachments and the game's full log
 * and config, put into RPL-4's `BugReportFile` (engine replay/format.ts) so that `npm run bug -- replay <file>` reads it as it reads a local game's report
 * (`replay.game.mode` is 'hosted'). For the developer only: unlike a local report it holds the whole game, both players' cards and the seed (CR 400.2;
 * a guest's own report holds only what they were shown), so a file made here is never handed back to a reporter or to a player. It says so in `reveal`
 * (`policy: 'own'`, saved by the reporter's seat: a replay viewer shows that seat's view only).
 *
 * - **The game**: `config` is the stored config with the stored seed (the log replays from them alone), `actions` the committed records' actions in
 *   order, `times` each record's time since the start. The reported moment (`at.action`) is the last action committed when the report was made (the
 *   records' `at` against the report's `createdAt`), so the replay stops where the reporter was.
 * - **Checkpoints** (replays design 4): the hosted table's own checkpoint hash (`LogRecord.check`, every 100th record, `table/limits.ts checkpointOf`) is
 *   not the replay format's digest (`gameDigest`, which is built to survive other builds), so the two are never compared with each other. This build plays the
 *   log and compares every server hash with the state it reaches (`checks`): when it reproduces all of them, the file carries this build's digests
 *   (the game as the server played it, up to the checks), so another build that reads the file later is compared against that; when it cannot, the file
 *   has none, and `checks` says where this build first plays differently.
 * - **The reporter's own part**: the words, the card, the client's app, browser, settings and recent errors, read from the attachments
 *   (`readClientDetails`, bounded). The hosted facts (report, kind, game, seat) are in `settings` under `hosted.*`: the format has no field for them, and
 *   `npm run bug -- replay` prints settings.
 *
 * Pure and synchronous apart from `checkBugReport`'s own work; never throws for data from the store (a game that cannot be set up or played is described
 * in `checks`, and the file holds what was read).
 */
import {
  BUG_REPORT_FORMAT, BUG_REPORT_FORMAT_VERSION, checkBugReport, checkpointAfter, cleanText, currentEngine, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, replayAction,
  startReplay, type Action, type BugReportFile, type Checked, type GameConfig, type GameResult, type GameState, type ReplayCheckpoint, type ReplayFile,
} from '@openmtg/engine';
import type { LogRecord, RecoveryData, ReportRow, TableRow } from '../store/api';
import { checkpointOf } from '../table/limits';
import { readClientDetails } from './client';

/** A report's game as the store has it: the row (format, seats, start) and the log (config, seed, seating, build, records). */
export interface HostedGame {
  row: TableRow;
  log: RecoveryData;
}

/** What replaying the log under this build found out about the server's own checkpoint hashes. */
export interface ServerChecks {
  /** Records the replay applied, of how many the log holds. */
  applied: number;
  records: number;
  /** Checkpoint hashes the server wrote (every 100th record) up to the last record applied, and the `seq` of those this build does not reproduce. */
  compared: number;
  mismatches: number[];
  /** Where this build stopped playing the log: an action it refuses or throws on, or a game it cannot set up (record 0). Null: it played the whole log. */
  stopped: { seq: number; message: string } | null;
  /** The game's state at the end of what was applied (null: it could not be set up). */
  final: Pick<GameState, 'turn' | 'result'> | null;
}

export interface HostedExport {
  file: BugReportFile;
  checks: ServerChecks;
  /** What the owner should know about how the file was made (parts left out, checks that failed). */
  notes: string[];
}

/** The replay of a log (the one pass: the server's checks and this build's checkpoints). Never throws. */
export function playLog(config: GameConfig, records: readonly LogRecord[]): { checks: ServerChecks; checkpoints: ReplayCheckpoint[] } {
  const checks: ServerChecks = { applied: 0, records: records.length, compared: 0, mismatches: [], stopped: null, final: null };
  const checkpoints: ReplayCheckpoint[] = [];
  const start = startReplay(config);
  if (!start.ok) {
    checks.stopped = { seq: 0, message: start.rejection.error.message };
    return { checks, checkpoints };
  }
  let state = start.state;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const r = replayAction(state, rec.action, i);
    if (!r.ok) {
      checks.stopped = { seq: rec.seq, message: r.rejection.error.message };
      break;
    }
    try {
      const c = checkpointAfter(i, state.turn.number, r.state, i === records.length - 1);
      if (c) checkpoints.push(c);
      if (rec.check !== undefined) {
        checks.compared++;
        if (checkpointOf(r.state).hash !== rec.check) checks.mismatches.push(rec.seq);
      }
    } catch (e) {
      checks.stopped = { seq: rec.seq, message: `The engine failed on action ${i + 1}: ${e instanceof Error ? e.message : String(e)}` };
      break;
    }
    state = r.state;
    checks.applied = i + 1;
  }
  checks.final = { turn: state.turn, result: state.result };
  return { checks, checkpoints };
}

const isoOf = (ms: number): string => new Date(Number.isFinite(ms) ? ms : 0).toISOString();

/** The index of the last action committed when the report was made (0 when none was). */
export function momentOf(records: readonly LogRecord[], reportedAt: Date): number {
  const t = reportedAt.getTime();
  let n = 0;
  for (const r of records) {
    if (Date.parse(r.at) <= t) n++;
    else break;
  }
  return Math.max(0, n - 1);
}

/** The bug report file of `report` and its game (see the file comment). Check the result with `checkBugReport` (done here: `file` passed it). */
export function hostedBugReport(report: ReportRow, game: HostedGame, o: { exportedAt: Date }): Checked<HostedExport> {
  const { row, log } = game;
  const config = { ...log.config, seed: log.seed } as GameConfig;
  const played = playLog(config, log.records);
  const { checks } = played;
  const notes: string[] = [];
  const details = readClientDetails(report.attachments);
  notes.push(...details.notes.map((n) => `Client attachment left out: ${n}.`));
  const verified = checks.stopped === null && checks.mismatches.length === 0 && checks.compared > 0;
  if (checks.stopped !== null) notes.push(`This build stops playing the log at record ${checks.stopped.seq}: ${cleanText(checks.stopped.message)}`);
  else if (checks.mismatches.length > 0) notes.push(`This build plays the game differently from the server: its checkpoint hash differs at record ${checks.mismatches[0]}.`);
  else if (checks.compared === 0) notes.push('The game has no server checkpoint to compare (they are taken every 100th record).');
  if (!verified) notes.push('The file carries no checkpoints of its own.');

  const players = config.players.map((p, i) => ({ id: `p${i + 1}`, name: cleanText(p.name).slice(0, 64) || `p${i + 1}`, kind: 'person' as const }));
  const idx = report.seat === null ? -1 : log.seating.indexOf(report.seat as (typeof log.seating)[number]);
  const savedBy = idx >= 0 && players[idx] ? players[idx]!.id : null;
  const startedAt = row.startedAt ?? new Date(Date.parse(log.records[0]?.at ?? '') || report.createdAt.getTime());
  const last = log.records[log.records.length - 1];
  const result: GameResult | null = checks.final?.result ? { winner: checks.final.result.winner, reason: cleanText(checks.final.result.reason).slice(0, 500) } : null;
  const startMs = startedAt.getTime();
  const actions: Action[] = log.records.map((r) => r.action);

  const replay: ReplayFile = {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'game',
    id: `r-hosted-${row.id}`.slice(0, 64),
    title: `Hosted ${cleanText(row.format)} game ${row.id}`.slice(0, 200),
    createdAt: o.exportedAt.toISOString(),
    // The saving app is the hosted server; its version is not recorded with a game, the engine build is.
    app: { version: 'hosted', commit: null },
    engine: currentEngine(log.engineBuild),
    game: {
      mode: 'hosted',
      format: cleanText(row.format).slice(0, 40),
      players,
      savedBy,
      ended: result ? 'finished' : 'abandoned',
      result,
      turns: checks.final?.turn.number ?? 0,
      actions: actions.length,
      startedAt: startedAt.toISOString(),
      endedAt: isoOf(last ? Date.parse(last.at) : startMs),
    },
    reveal: { policy: 'own', agreed: [] },
    play: {
      config,
      actions,
      times: log.records.map((r) => Math.max(0, (Date.parse(r.at) || startMs) - startMs)),
      checkpoints: verified ? played.checkpoints : [],
    },
  };

  const hosted: BugReportFile['settings'] = {
    'hosted.report': report.id,
    'hosted.kind': report.kind,
    'hosted.game': row.id,
    'hosted.seat': report.seat,
    'hosted.engineBuild': cleanText(log.engineBuild).slice(0, 128),
  };
  const file: BugReportFile = {
    format: BUG_REPORT_FORMAT,
    formatVersion: BUG_REPORT_FORMAT_VERSION,
    replay,
    at: { action: momentOf(log.records, report.createdAt) },
    words: report.text.slice(0, 20_000),
    ...(details.card !== null ? { card: details.card } : {}),
    app: details.app ?? { version: 'unknown', commit: null },
    browser: details.browser ?? { userAgent: '' },
    settings: { ...details.settings, ...hosted },
    errors: details.errors,
  };
  // Checked as the JSON it is written as (a key whose value is undefined is not in the file).
  const checked = checkBugReport(JSON.parse(JSON.stringify(file)) as unknown);
  return checked.ok ? { ok: true, value: { file: checked.value, checks, notes } } : checked;
}
