/**
 * RPL-3 (replays design 6, 7.2, 16.3; D1, D5): the host's record of an online game, and the replay files made of it.
 *
 * The game runs on the host's machine (GameHost, OnlineSession), so the host keeps the game itself: the config with the seed and the compiled card
 * definitions, every applied action with its time and, where the checkpoint rule takes one (each turn start, every 20th action, the last action), its
 * digest (engine `checkpointAfter`), how it ended, and every player's "Show my cards in replays" (default off; a player who left keeps their last
 * choice, CR 104.3a, 800.4a). The local server writes the same record to its data directory as the game goes (packages/server online/replays.ts), so a
 * crash or a closed page keeps it, and the host's page reads it from there as a replay file of kind 'game' (`onlineReplayFile`, mode 'onlineHost').
 *
 * Each guest gets the game only after it is over for everyone (CR 104) and only when every player agreed (design D5, adopted answer 3): the host's
 * GameHost then sends each guest its own copy (`replayGame`, saved by that guest, mode 'onlineGuest'), gzipped and in base64 (`encodeReplayGame`). During
 * the game the record never leaves the host: its seed and log would reveal every hidden card (CR 400.2).
 *
 * Node only (the server and net): the browser reads the files with the engine's replay reader.
 */
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  REPLAY_FORMAT, REPLAY_FORMAT_VERSION, checkpointAfter, cleanText, type Action, type GameConfig, type GameResult, type GameState, type PlayerId,
  type ReplayApp, type ReplayCheckpoint, type ReplayEnd, type ReplayEngine, type ReplayFile, type ReplayMode, type ReplayPlayer, type ReplayReveal,
} from '@openmtg/engine';
import { REPLAY_GAME_MAX_BYTES } from '../protocol/messages';

/** The version of the record's shape (its start line), for a later change. */
export const ONLINE_RECORD_VERSION = 1;

/** A replay id: "r-" and 20 random hexadecimal digits (the client's ids have the same form, packages/client replays/file.ts). */
export const REPLAY_ID = /^r-[0-9a-f]{20}$/;

/** A new replay id (`REPLAY_ID`). */
export function newReplayId(): string {
  return `r-${randomBytes(10).toString('hex')}`;
}

/** What the record knows when the game is created: written once (the record's start). */
export interface OnlineRecordStart {
  version: number;
  /** The replay id (`REPLAY_ID`): the host's library key, the record's folder on the server. */
  id: string;
  /** ISO 8601. */
  startedAt: string;
  /** Epoch milliseconds of the start: an action's time is milliseconds since then. */
  startMs: number;
  /** The format played (at most 40 characters, as a replay file takes it). */
  format: string;
  /** The host's player (p1). */
  host: PlayerId;
  /** The seats in seating order (CR 101.4); every seat of an online game is a person. */
  players: ReplayPlayer[];
  /** The engine that plays the game (its build, packages/net protocol/versions.ts). */
  engine: ReplayEngine;
  /** The game's config, seed included: never sent to anyone before the game is over and every player agreed. */
  config: GameConfig;
}

/** One applied action of the record (the server writes one line per action). */
export interface OnlineRecordAction {
  /** Its index in the log. */
  i: number;
  action: Action;
  /** Milliseconds since the start. */
  t: number;
  /** The checkpoint taken right after it (design 4), if the rule takes one there. */
  checkpoint?: ReplayCheckpoint;
}

/** How the game ended (CR 104), written when it ended. */
export interface OnlineRecordEnd {
  /** ISO 8601. */
  endedAt: string;
  ended: Exclude<ReplayEnd, 'abandoned'>;
  result: GameResult;
  turns: number;
  /** The actions applied when it ended (a reader trusts an end only with the whole log before it). */
  actions: number;
  /** The last action's checkpoint when the rule had not taken one there already (a replay's last action always has one, design 4). */
  checkpoint: ReplayCheckpoint | null;
}

/** A record as it is read back: the start, the log, every player's choice and the end (null: the game was left unfinished). */
export interface OnlineRecordData {
  start: OnlineRecordStart;
  actions: readonly Action[];
  times: readonly number[];
  checkpoints: readonly ReplayCheckpoint[];
  /** The players who agreed to show their cards in replays (their last choice). */
  agreed: readonly PlayerId[];
  end: OnlineRecordEnd | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * How a finished game ended (CR 104), as the replay library lists it: `'conceded'` when the last player to leave the game conceded (CR 104.3a),
 * `'finished'` otherwise; null while the game is not over. The rule of the client's local games (packages/client replays/file.ts `endingOf`).
 */
export function endingOf(state: GameState): Omit<OnlineRecordEnd, 'endedAt' | 'checkpoint' | 'actions'> | null {
  if (!state.result) return null;
  const out = state.players.filter((p) => p.hasLost);
  const withOrder = out.filter((p) => p.left !== undefined);
  const last = withOrder.length > 0 ? withOrder.reduce((a, b) => (b.left!.order > a.left!.order ? b : a)) : null;
  const conceded = last ? last.conceded : out.some((p) => p.conceded);
  return { result: { winner: state.result.winner, reason: state.result.reason }, ended: conceded ? 'conceded' : 'finished', turns: state.turn.number };
}

/** The host's record of the game it runs (see the file comment). */
export class OnlineRecord implements OnlineRecordData {
  readonly start: OnlineRecordStart;
  readonly actions: Action[] = [];
  readonly times: number[] = [];
  readonly checkpoints: ReplayCheckpoint[] = [];
  private readonly choices = new Map<PlayerId, boolean>();
  end: OnlineRecordEnd | null = null;

  constructor(
    o: { id: string; format: string; host: PlayerId; engine: ReplayEngine; config: GameConfig },
    private readonly now: () => number,
    choices: ReadonlyMap<PlayerId, boolean> = new Map(),
  ) {
    const startMs = now();
    this.start = {
      version: ONLINE_RECORD_VERSION,
      id: o.id,
      startedAt: iso(startMs),
      startMs,
      format: cleanText(o.format).slice(0, 40),
      host: o.host,
      players: o.config.players.map((p, i) => ({ id: p.id ?? `p${i + 1}`, name: cleanText(p.name).slice(0, 64), kind: 'person' })),
      engine: { ...o.engine },
      config: o.config,
    };
    for (const [p, agree] of choices) this.choices.set(p, agree);
  }

  /** The players who agreed, in seating order. */
  get agreed(): PlayerId[] {
    return this.start.players.filter((p) => this.choices.get(p.id) === true).map((p) => p.id);
  }

  /** Every player of the game agreed (design 6: a person's agreement each; there are no computer seats online). */
  get everyoneAgreed(): boolean {
    return this.start.players.every((p) => this.choices.get(p.id) === true);
  }

  /** A player's choice (their last one counts). Returns whether it changed anything. */
  choose(player: PlayerId, agree: boolean): boolean {
    if (!this.start.players.some((p) => p.id === player) || (this.choices.get(player) ?? false) === agree) return false;
    this.choices.set(player, agree);
    return true;
  }

  /** An applied action (`before`: the state it was applied to, `after`: the state it made). Returns the record's new line. */
  add(action: Action, before: GameState, after: GameState): OnlineRecordAction {
    const i = this.actions.length;
    const t = Math.max(0, this.now() - this.start.startMs, this.times[i - 1] ?? 0);
    const checkpoint = checkpointAfter(i, before.turn.number, after, false);
    this.actions.push(action);
    this.times.push(t);
    if (checkpoint) this.checkpoints.push(checkpoint);
    return { i, action, t, ...(checkpoint ? { checkpoint } : {}) };
  }

  /** The game is over (`state.result`, CR 104): how it ended, once. Null while it is not over, and when it was recorded already. */
  finish(state: GameState): OnlineRecordEnd | null {
    if (this.end) return null;
    const ending = endingOf(state);
    if (!ending) return null;
    const last = this.actions.length - 1;
    const checkpoint = last >= 0 && !this.checkpoints.some((c) => c.action === last) ? checkpointAfter(last, state.turn.number, state, true) : null;
    if (checkpoint) this.checkpoints.push(checkpoint);
    this.end = { ...ending, actions: this.actions.length, endedAt: iso(this.now()), checkpoint };
    return this.end;
  }
}

/** The reveal record (design 6, D4): `'all'` when every player agreed; online every seat is a person. */
export function revealOf(players: readonly ReplayPlayer[], agreed: readonly PlayerId[]): ReplayReveal {
  const said = new Set(agreed);
  const list = players.filter((p) => said.has(p.id)).map((p) => p.id);
  return { policy: players.length > 0 && list.length === players.length ? 'all' : 'own', agreed: list };
}

/**
 * The replay file of a record (design 4) for one player: the game itself (kind 'game': the config, the log, a time per action, the checkpoints), saved
 * by `savedBy` in `mode` ('onlineHost' for the host's page, 'onlineGuest' for a guest's copy), with every player's choice as its reveal record. A record
 * without an end was left unfinished (`'abandoned'`, at its last action's time).
 */
export function onlineReplayFile(r: OnlineRecordData, o: { savedBy: PlayerId; mode: Extract<ReplayMode, 'onlineHost' | 'onlineGuest'>; app: ReplayApp }): ReplayFile {
  const { start, end } = r;
  const checkpoints = [...r.checkpoints];
  if (end?.checkpoint && !checkpoints.some((c) => c.action === end.checkpoint!.action)) checkpoints.push(end.checkpoint);
  const lastTime = r.times[r.times.length - 1] ?? 0;
  const turns = end?.turns ?? checkpoints.reduce((n, c) => Math.max(n, c.turn), 0);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'game',
    id: start.id,
    title: cleanText(`${start.players.map((p) => p.name).join(' vs ')}, ${start.format || 'casual'}`).slice(0, 200),
    createdAt: start.startedAt,
    app: { version: o.app.version, commit: o.app.commit },
    engine: { ...start.engine },
    game: {
      mode: o.mode,
      format: start.format,
      players: start.players.map((p) => ({ ...p })),
      savedBy: o.savedBy,
      ended: end?.ended ?? 'abandoned',
      result: end ? { winner: end.result.winner, reason: end.result.reason } : null,
      turns,
      actions: r.actions.length,
      startedAt: start.startedAt,
      endedAt: end?.endedAt ?? iso(start.startMs + lastTime),
    },
    reveal: revealOf(start.players, r.agreed),
    play: { config: start.config, actions: [...r.actions], times: [...r.times], checkpoints },
  };
}

/**
 * The text of a `replayGame` (protocol 5): the file's JSON, gzipped, in base64; null when the gzip is larger than REPLAY_GAME_MAX_BYTES (the guests then
 * keep their recordings).
 */
export function encodeReplayGame(file: ReplayFile): string | null {
  const gz = gzipSync(Buffer.from(JSON.stringify(file), 'utf8'));
  return gz.length > REPLAY_GAME_MAX_BYTES ? null : gz.toString('base64');
}
