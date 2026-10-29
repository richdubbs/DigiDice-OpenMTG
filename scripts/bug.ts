/**
 * RPL-4 (replays design 11; roadmap "In-game bug reports", developer side): reproduce a bug report a player saved with "Report a bug" in the client
 * (packages/client/src/bugs).
 *
 *   npm run bug -- replay <file> [--save <out.json>]
 *
 * 1. Reads the report (gzipped or plain JSON; at most 8 MB stored and 128 MB expanded) and checks it with RPL-0's validator (engine replay/*): a file
 *    that is too large, damaged, not JSON, not a bug report, of a newer format or malformed is refused with the reason, and nothing more is done.
 *    Nothing in a report is ever run as code, and its text is printed without control characters (no terminal escapes).
 * 2. Prints the report: the reporter's words, the card it is about, the app, browser and settings, the errors the page caught, and the replay's facts.
 * 3. Replays it under this build. A game (a local game's report, or a replay of one) is run with the engine from its config to the reported moment
 *    (`at`, the index of the action reported), taking its checkpoints as the recorder took them (design 4) and comparing those up to the moment:
 *    under the build the report was made on the game is exact by construction, so a difference there is an engine bug (nondeterminism); under another
 *    build it says where this build first plays differently (a checkpoint whose digest differs, an action the engine refuses or throws on) and up to
 *    where it matches. A recording (an online player's report: only what that player was shown) is not run: its frames are rebuilt up to the moment.
 * 4. Prints the moment (or where the game stopped): the turn and step, the decision pending, each player's life and zones, the stack and the
 *    battlefield, the last log lines, and where the card named in the report is.
 *
 * `--save <out.json>`: writes the game up to the moment as `{ config, actions }`, which `GameSession.fromJSON` reads: the start of a regression test.
 *
 * Exit code 0: the game plays as recorded up to the moment (a recording: it was read up to the moment); 1: the file was refused, or a usage error;
 * 2: this build plays the game differently before the moment (or cannot read the recording up to it).
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ABILITY_MODEL_VERSION, ENGINE_VIEW_SCHEMA, HIDDEN_DEF, OLDEST_READ_VIEW_SCHEMA, readsViewSchema, REPLAY_LIMITS, checkpointAfter, cleanText, getChars, readBugReportFile, recordingFrameView,
  replayAction, startReplay, type Action, type BugReportFile, type CardDef, type GameConfig, type GameState, type GameView, type RecordingKeyView,
  type ReplayCheckpoint, type ReplayFile, type ReplayLimits, type ReplayRejection,
} from '../packages/engine/src/index';
import { engineBuildFrom } from '../packages/net/src/protocol/fingerprint';

export const USAGE = 'Usage: npm run bug -- replay <file> [--save <out.json>]';

/** How many log lines of the moment are printed. */
const LOG_LINES = 12;

export interface BugRunOptions {
  /** This engine's build (the fingerprint of the engine's sources; null when it cannot be read). */
  build: string | null;
  /** The report's file name, for the first line. */
  name?: string;
}

export interface BugRun {
  /** 0: plays as recorded to the moment; 1: refused; 2: plays differently (or the recording cannot be read) before the moment. */
  code: 0 | 1 | 2;
  lines: string[];
  /** The game up to the moment (or to where it stopped), as `GameSession.fromJSON` reads it; null for a recording or a refused file. */
  game: { config: GameConfig; actions: Action[] } | null;
}

/** One line of text from a file, safe to print: no control characters (no terminal escapes), bounded. */
function shown(s: unknown, max = 500): string {
  const t = cleanText(String(s ?? ''));
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Text of several lines from a file, each line safe to print, indented. */
function block(s: string, indent: string, maxLines = 40): string[] {
  const lines = s.split(/\r\n|\r|\n/).map((l) => indent + shown(l, 1000));
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `${indent}... (${lines.length - maxLines} more lines)`] : lines;
}

const short = (build: string | null): string => (build === null ? 'unknown' : shown(build.slice(0, 12), 12));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const MODES: Record<string, string> = {
  hotseat: 'hot-seat',
  computer: 'against the computer',
  onlineHost: 'online, saved by the host',
  onlineGuest: 'online, saved by a guest',
  hosted: 'hosted',
};

function playerName(replay: ReplayFile, id: string | null): string {
  if (id === null) return 'nobody';
  return shown(replay.game.players.find((p) => p.id === id)?.name ?? id, 64);
}

/** The report's own facts (step 2 of the file comment). */
function describeReport(r: BugReportFile, name: string | undefined): string[] {
  const out: string[] = [`Bug report${name ? ` ${shown(name, 200)}` : ''}`];
  out.push('  What happened:');
  out.push(...(r.words.trim() === '' ? ['    (nothing written)'] : block(r.words, '    ')));
  if (r.card !== undefined) out.push(`  The card it is about: ${shown(r.card, 200)}`);
  out.push(`  Made with OpenMTG ${shown(r.app.version, 40)} (${r.app.commit === null ? 'no commit' : `commit ${shown(r.app.commit, 64)}`})`);
  const b = r.browser;
  out.push(`  Browser: ${shown(b.userAgent, 300) || '(not given)'}${b.language ? `; ${shown(b.language, 64)}` : ''}${b.screen ? `; ${shown(b.screen, 64)}` : ''}`);
  const settings = Object.entries(r.settings).map(([k, v]) => `${shown(k, 64)}=${shown(v, 100)}`);
  out.push(`  Settings: ${settings.length === 0 ? '(none)' : settings.join(', ')}`);
  out.push(`  Errors the page caught: ${r.errors.length === 0 ? 'none' : r.errors.length}`);
  r.errors.forEach((e, i) => {
    out.push(`    ${i + 1}. ${e.time ? `${shown(e.time, 40)} ` : ''}${shown(e.message, 1000)}`);
    if (e.stack) out.push(...block(e.stack, '       ', 6));
  });
  return out;
}

/** The replay's facts and the moment reported. */
function describeReplay(r: BugReportFile, build: string | null): string[] {
  const p = r.replay;
  const g = p.game;
  const what = p.kind === 'game' ? 'the game itself' : `a recording of ${p.recording?.viewer == null ? 'the public view' : `${playerName(p, p.recording.viewer)}'s view`}`;
  const out = [`Replay "${shown(p.title, 200)}": ${what}`];
  const players = g.players.map((x) => `${shown(x.name, 64)} (${shown(x.id, 64)}, ${x.kind})`).join(', ');
  out.push(`  Played ${MODES[g.mode] ?? shown(g.mode, 40)}${g.format ? `, ${shown(g.format, 40)}` : ''}: ${players}; saved by ${g.savedBy === null ? 'the players at one screen' : playerName(p, g.savedBy)}`);
  const result = g.result === null ? 'no result' : g.result.winner === null ? `a draw: ${shown(g.result.reason)}` : `${playerName(p, g.result.winner)} won: ${shown(g.result.reason)}`;
  out.push(`  ${g.ended === 'abandoned' ? 'Unfinished' : g.ended === 'conceded' ? 'Ended by a concession' : 'Finished'} (${result}), ${plural(g.turns, 'turn')}, ${plural(g.actions, 'action')}`);
  const e = p.engine;
  const same = e.build !== null && build !== null && e.build === build;
  out.push(`  Engine: build ${short(e.build)}, compiler ${shown(e.compiler, 200)}, card model ${e.model}, view schema ${e.viewSchema}`);
  out.push(`  This engine: build ${short(build)}, card model ${ABILITY_MODEL_VERSION}, view schema ${ENGINE_VIEW_SCHEMA}: ${same ? 'the build the report was made on' : e.build === null || build === null ? 'the build cannot be compared' : 'another build'}`);
  return out;
}

/** "after action 14 of 92", "the start of the game", "frame 3 of 40". */
function momentLabel(applied: number, total: number): string {
  return applied === 0 ? 'the start of the game' : `after action ${applied} of ${total}`;
}

/** What the board shows of a state or view (step 4 of the file comment). */
function describeState(s: Pick<GameState, 'players' | 'zones' | 'objects' | 'turn' | 'pending' | 'log' | 'result'> & { defs: Record<string, CardDef> }, card: string | undefined, state: GameState | null): string[] {
  const out: string[] = [];
  const name = (id: string): string => (s.players.find((p) => p.id === id)?.name ?? id);
  const defName = (defId: string): string => (defId === HIDDEN_DEF ? 'a hidden card' : s.defs[defId]?.name ?? defId);
  const objectText = (id: string): string => {
    const o = s.objects[id];
    if (!o) return `${shown(id, 64)} (missing)`;
    const parts = [shown(o.faceDown ? `face-down ${defName(o.defId)}` : defName(o.defId), 200)];
    if (state) {
      try {
        const ch = getChars(state, id);
        if (ch.types.includes('Creature') && ch.power !== undefined) parts.push(`${ch.power}/${ch.toughness ?? '?'}`);
      } catch {
        // the characteristics are a help here, never a new failure
      }
    }
    if (o.tapped) parts.push('tapped');
    return `${parts.join(' ')} [${shown(id, 64)}]`;
  };
  const t = s.turn;
  out.push(`  ${t.number <= 0 ? 'Before the first turn' : `Turn ${t.number}: ${shown(name(t.activePlayer), 64)}, ${shown(t.step, 64)}`}`);
  if (s.result) out.push(`  The game is over: ${s.result.winner === null ? 'a draw' : `${shown(name(s.result.winner), 64)} won`} (${shown(s.result.reason)})`);
  else if (s.pending) out.push(`  Waiting for ${shown(name(s.pending.player), 64)}: ${shown(s.pending.kind, 64)}, "${shown(s.pending.prompt)}"`);
  for (const p of s.players) {
    const n = (z: Record<string, string[]>) => z[p.id]?.length ?? 0;
    const status = p.hasLost ? ', out of the game' : '';
    out.push(`  ${shown(p.name, 64)} (${shown(p.id, 64)}): life ${p.life}${p.poison ? `, poison ${p.poison}` : ''}, hand ${n(s.zones.hand)}, library ${n(s.zones.library)}, graveyard ${n(s.zones.graveyard)}${status}`);
  }
  out.push(`  Stack: ${s.zones.stack.length === 0 ? '(empty)' : [...s.zones.stack].reverse().map(objectText).join('; ')}`);
  for (const p of s.players) {
    const mine = s.zones.battlefield.filter((id) => s.objects[id]?.controller === p.id);
    out.push(`  ${shown(p.name, 64)}'s battlefield: ${mine.length === 0 ? '(empty)' : mine.map(objectText).join('; ')}`);
  }
  const log = s.log.slice(-LOG_LINES);
  out.push(`  The last ${plural(log.length, 'log line')}:`);
  for (const l of log) {
    const priv = l.privateText ? ` [to ${l.privateText.players.map((x) => shown(x, 64)).join(', ')}: ${shown(l.privateText.text)}]` : '';
    out.push(`    ${l.seq}. ${shown(l.text)}${priv}`);
  }
  if (card !== undefined) {
    const want = card.toLowerCase();
    const def = Object.values(s.defs).find((d) => d.name.toLowerCase() === want);
    const level = def
      ? ` (automation ${shown(def.automation.level, 64)}${def.automation.unsupported.length > 0 ? `; by hand: ${def.automation.unsupported.map((u) => shown(u, 200)).join('; ')}` : ''})`
      : ' (no card of that name in the game)';
    // Where its objects are: how many in each player's zone, with the ids of those in the zones everybody sees.
    const where = new Map<string, string[]>();
    for (const o of Object.values(s.objects)) {
      if (o.defId === HIDDEN_DEF || s.defs[o.defId]?.name.toLowerCase() !== want) continue;
      const key = `${shown(name(o.zone === 'battlefield' || o.zone === 'stack' ? o.controller : o.owner), 64)}'s ${shown(o.zone, 64)}`;
      where.set(key, [...(where.get(key) ?? []), shown(o.id, 64)]);
    }
    const listed = [...where].map(([zone, ids]) => `${ids.length} in ${zone}${zone.endsWith('library') || zone.endsWith('hand') ? '' : ` [${ids.join(', ')}]`}`);
    out.push(`  "${shown(card, 200)}"${level}: ${listed.length === 0 ? 'not in the game at this moment' : listed.join('; ')}`);
  }
  return out;
}

interface GameRun {
  /** How many actions were applied. */
  applied: number;
  state: GameState | null;
  rejection: ReplayRejection | null;
  /** The first recorded checkpoint this build does not match, with what this build has there (null: it took none there). */
  mismatch: { recorded: ReplayCheckpoint; computed: ReplayCheckpoint | null } | null;
  /** The last recorded checkpoint this build matched, and how many it compared and matched. */
  lastMatch: ReplayCheckpoint | null;
  compared: number;
}

/** Run a game replay's log up to `upto` actions, taking the checkpoints as the recorder did and comparing them (step 3). Never throws. */
function runGame(replay: ReplayFile, upto: number): GameRun {
  const play = replay.play!;
  const total = play.actions.length;
  const start = startReplay(play.config);
  if (!start.ok) return { applied: 0, state: null, rejection: start.rejection, mismatch: null, lastMatch: null, compared: 0 };
  let state = start.state;
  const computed = new Map<number, ReplayCheckpoint>();
  let rejection: ReplayRejection | null = null;
  let applied = 0;
  for (let i = 0; i < upto; i++) {
    const r = replayAction(state, play.actions[i]!, i);
    if (!r.ok) {
      rejection = r.rejection;
      break;
    }
    try {
      const c = checkpointAfter(i, state.turn.number, r.state, i === total - 1);
      if (c) computed.set(i, c);
    } catch (e) {
      rejection = { index: i, cause: 'threw', error: { message: `The engine failed on action ${i + 1}: ${e instanceof Error ? e.message : String(e)}`, rules: [] } };
      break;
    }
    state = r.state;
    applied = i + 1;
  }
  let mismatch: GameRun['mismatch'] = null;
  let lastMatch: ReplayCheckpoint | null = null;
  let compared = 0;
  for (const c of play.checkpoints) {
    if (c.action >= applied) break; // past the moment, or not reached
    compared++;
    const mine = computed.get(c.action) ?? null;
    if (!mine || mine.turn !== c.turn || mine.digest !== c.digest) {
      mismatch = { recorded: c, computed: mine };
      break;
    }
    lastMatch = c;
  }
  return { applied, state, rejection, mismatch, lastMatch, compared };
}

/** Steps 3 and 4 for a game replay. */
function replayGame(r: BugReportFile, same: boolean): { code: 0 | 2; lines: string[]; game: BugRun['game'] } {
  const replay = r.replay;
  const play = replay.play!;
  const total = play.actions.length;
  const at = r.at.action;
  const upto = total === 0 ? 0 : Math.min(at, total - 1) + 1;
  const out: string[] = [];
  out.push(`  Moment reported: ${momentLabel(upto, total)}${at > total - 1 && total > 0 ? ` (the report names action ${at + 1}, past the end of its log)` : ''}`);
  out.push('', 'Replaying it on this build to the moment reported ...');
  if (replay.engine.model !== ABILITY_MODEL_VERSION) out.push(`  Note: the game was made with card model ${replay.engine.model}; this engine reads model ${ABILITY_MODEL_VERSION}.`);
  const run = runGame(replay, upto);
  let code: 0 | 2 = 0;
  const stoppedBy = run.rejection;
  if (run.mismatch) {
    const m = run.mismatch;
    const where = `after action ${m.recorded.action + 1} (turn ${m.recorded.turn})`;
    out.push(`  Plays differently on this build: ${where} the game is not the one recorded (${m.computed === null ? 'this build took no checkpoint there' : m.computed.turn !== m.recorded.turn ? `turn ${m.computed.turn} here` : 'its digest differs'}).`);
    code = 2;
  } else if (stoppedBy) {
    const what = stoppedBy.cause === 'config' ? 'cannot set up the game' : stoppedBy.cause === 'illegal' ? `refuses action ${stoppedBy.index + 1}` : stoppedBy.cause === 'shape' ? `cannot read action ${stoppedBy.index + 1}` : `fails on action ${stoppedBy.index + 1}`;
    out.push(`  Plays differently on this build: it ${what}: ${shown(stoppedBy.error.message, 1000)}`);
    if (stoppedBy.error.rules.length > 0) out.push(`    (${stoppedBy.error.rules.map((x) => shown(x, 40)).join(', ')})`);
    code = 2;
  } else {
    out.push(`  Plays as recorded up to the moment: ${run.compared === 0 ? 'no checkpoint before it to compare' : `${plural(run.compared, 'checkpoint')} compared, every one matches`}.`);
  }
  if (code === 2) {
    out.push(`  It matches up to ${run.lastMatch ? `action ${run.lastMatch.action + 1} (turn ${run.lastMatch.turn}), the last checkpoint that matches` : 'no checkpoint: none before the difference matched'}.`);
    if (same) out.push('  This is the build the report was made on, where the game is exact by construction: the difference is an engine bug (nondeterminism).');
    else out.push(`  The report was made on another build (commit ${shown(replay.app.commit ?? 'unknown', 64)}): check it out to see the game as it was played.`);
  }
  if (run.state) {
    out.push('', `The game ${code === 0 ? 'at the moment' : 'where this build stopped'} (${momentLabel(run.applied, total)}):`);
    out.push(...describeState(run.state, r.card, run.state));
  }
  return { code, lines: out, game: { config: play.config, actions: play.actions.slice(0, run.applied) } };
}

/** Steps 3 and 4 for a recording: rebuild its frames up to the moment (each checked as the board reads it). */
function replayRecording(r: BugReportFile): { code: 0 | 2; lines: string[] } {
  const rec = r.replay.recording!;
  const frames = rec.frames;
  const at = Math.min(r.at.action, Math.max(0, frames.length - 1));
  const out = [`  Moment reported: frame ${at + 1} of ${frames.length}${r.at.action > at ? ` (the report names frame ${r.at.action + 1}, past the end)` : ''}`];
  out.push('', 'This report holds a recording: only what its player was shown, so there is no game to run on the engine.');
  if (!readsViewSchema(r.replay.engine.viewSchema)) {
    out.push(`  Its views are of view schema ${r.replay.engine.viewSchema}; this build reads ${OLDEST_READ_VIEW_SCHEMA} to ${ENGINE_VIEW_SCHEMA}: it cannot be read here.`);
    return { code: 2, lines: out };
  }
  let view: RecordingKeyView | null = null;
  const ctx = { viewer: rec.viewer, defs: rec.defs };
  for (let i = 0; i <= at; i++) {
    const next = recordingFrameView(view, frames[i]!, ctx);
    if (!next.ok) {
      out.push(`  Frame ${i + 1} cannot be read here: ${shown(next.error.message, 1000)}`);
      if (view) out.push('', `The view of frame ${i} (the last that could be read):`, ...describeState({ ...view, defs: rec.defs } as unknown as GameView, r.card, null));
      return { code: 2, lines: out };
    }
    view = next.value;
  }
  if (view) out.push('', `The view at the moment (frame ${at + 1}, ${rec.viewer === null ? 'the public view' : `${playerName(r.replay, rec.viewer)}'s view`}):`, ...describeState({ ...view, defs: rec.defs } as unknown as GameView, r.card, null));
  return { code: 0, lines: out };
}

/** Read, check and replay a bug report's bytes (see the file comment). Never throws on a bad file: it is refused with the reason. */
export async function runBugReport(bytes: Uint8Array, opts: BugRunOptions, limits: ReplayLimits = REPLAY_LIMITS): Promise<BugRun> {
  const read = await readBugReportFile(bytes, limits);
  if (!read.ok) {
    const where = read.error.path ? ` (at ${shown(read.error.path, 200)})` : '';
    return { code: 1, lines: [`Refused${opts.name ? ` ${shown(opts.name, 200)}` : ''}: ${shown(read.error.message, 1000)}${where} [${read.error.code}]`], game: null };
  }
  const r = read.value;
  const lines = [...describeReport(r, opts.name), '', ...describeReplay(r, opts.build)];
  const same = r.replay.engine.build !== null && opts.build !== null && r.replay.engine.build === opts.build;
  if (r.replay.kind === 'game' && r.replay.play) {
    const g = replayGame(r, same);
    return { code: g.code, lines: [...lines, ...g.lines], game: g.game };
  }
  const rec = replayRecording(r);
  return { code: rec.code, lines: [...lines, ...rec.lines], game: null };
}

/** The command line (see the file comment). Returns the exit code. `cwd`: where relative paths are read from (npm runs scripts at the root). */
export async function main(argv: readonly string[], io: { log: (s: string) => void; error: (s: string) => void; cwd: string; build?: () => string | null }): Promise<number> {
  const [command, file, ...rest] = argv;
  let save: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--save' && rest[i + 1] !== undefined) save = rest[++i]!;
    else {
      io.error(`Unknown option ${shown(rest[i], 200)}.\n${USAGE}`);
      return 1;
    }
  }
  if (command !== 'replay' || file === undefined) {
    io.error(USAGE);
    return 1;
  }
  const path = resolve(io.cwd, file);
  let bytes: Uint8Array;
  try {
    const size = statSync(path).size;
    if (size > REPLAY_LIMITS.maxFileBytes) {
      io.error(`Refused ${shown(basename(path), 200)}: the file is larger than ${REPLAY_LIMITS.maxFileBytes} bytes. [tooLarge]`);
      return 1;
    }
    const buf = readFileSync(path);
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (e) {
    io.error(`Cannot read ${shown(file, 500)}: ${e instanceof Error ? shown(e.message, 500) : 'unknown error'}`);
    return 1;
  }
  const run = await runBugReport(bytes, { build: (io.build ?? (() => engineBuildFrom(import.meta.url)))(), name: basename(path) });
  (run.code === 1 ? io.error : io.log)(run.lines.join('\n'));
  if (save !== null) {
    if (run.game === null) io.error(run.code === 1 ? 'Nothing saved: the report was refused.' : 'Nothing saved: a recording holds no game to save.');
    else {
      const out = resolve(io.cwd, save);
      writeFileSync(out, `${JSON.stringify(run.game)}\n`);
      const n = run.game.actions.length;
      io.log(`\nSaved the game ${n === 0 ? 'at its start' : `up to action ${n}`} to ${out} (GameSession.fromJSON reads it).`);
    }
  }
  return run.code;
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  void main(process.argv.slice(2), {
    log: (s) => console.log(s),
    error: (s) => console.error(s),
    cwd: process.env['INIT_CWD'] ?? process.cwd(),
  }).then((code) => {
    process.exitCode = code;
  });
}
