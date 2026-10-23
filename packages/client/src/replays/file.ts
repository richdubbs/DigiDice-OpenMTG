/**
 * RPL-1 (replays design 4, 6, 10): building a game replay file from what the recorder kept, and the facts the library shows of one. Pure: no storage,
 * no clock (times are passed in).
 *
 * The reveal policy (design 6, D4; the owner's adopted answers 1 and 2 of 2026-10-21): a game against the computer with one person needs nobody's
 * agreement (the computer's hand is nobody's secret), so its policy is `'all'` with that person as `agreed`. A game with several people at the screen
 * (hot-seat, with or without computers) opens on the public view, and every seat and the open view need every person's agreement: the end screen's
 * "Show my cards in replays", default off. `agreed` records who ticked it; the policy is `'all'` once every person has.
 */
import {
  REPLAY_FORMAT, REPLAY_FORMAT_VERSION, cleanText, type Action, type GameConfig, type GameResult, type GameState, type PlayerId, type ReplayApp,
  type ReplayCheckpoint, type ReplayEnd, type ReplayEngine, type ReplayFile, type ReplayGameInfo, type ReplayKind, type ReplayMode, type ReplayPlayer,
  type ReplayReveal,
} from '@openmtg/engine';
import { formatOption } from '../decks/formats';

/** What the recorder knows of a game when it starts (and keeps in its in-progress record, inProgress.ts). */
export interface RecordedGameInfo {
  /** The replay's id ("r-" and random hexadecimal digits): the library's key. */
  id: string;
  /** ISO 8601: when the game started. */
  createdAt: string;
  app: ReplayApp;
  engine: ReplayEngine;
  mode: Extract<ReplayMode, 'hotseat' | 'computer'>;
  /** The format played (a New game format id: "standard", "commander", "casual", ...). */
  format: string;
  players: ReplayPlayer[];
  /** The one person at the screen against the computer; null when several people sat at it (hot-seat). */
  savedBy: PlayerId | null;
  config: GameConfig;
}

/** The game's log as recorded: one time (ms since the start) per action, and the checkpoints taken (design 4). */
export interface RecordedLog {
  actions: readonly Action[];
  times: readonly number[];
  checkpoints: readonly ReplayCheckpoint[];
}

/** How the game ended, when it did (CR 104): its result, and whether it ended by a concession (CR 104.3a). */
export interface GameEnding {
  result: GameResult;
  ended: Exclude<ReplayEnd, 'abandoned'>;
  turns: number;
}

/** The id of a new replay: "r-" and 20 random hexadecimal digits (the browser's crypto RNG). */
export function newReplayId(): string {
  const words = new Uint32Array(3);
  globalThis.crypto.getRandomValues(words);
  return `r-${Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('').slice(0, 20)}`;
}

/** A format's name in a title ("Standard", "Commander"; the New game screen's "casual" is "Casual"). */
export function formatLabel(format: string): string {
  if (format === '' || format === 'casual') return 'Casual';
  return formatOption(format).name;
}

/** The longest title a replay may have (the replay validator's bound, engine replay/validate.ts). */
export const TITLE_MAX = 200;

/** The title a replay starts with (the player may rename it): "Alice vs Bob, Standard". */
export function defaultTitle(players: readonly { name: string }[], format: string): string {
  return cleanText(`${players.map((p) => p.name).join(' vs ')}, ${formatLabel(format)}`).slice(0, TITLE_MAX);
}

/** The people of a game (computer seats need no agreement, design 6). */
export function peopleOf(players: readonly ReplayPlayer[]): ReplayPlayer[] {
  return players.filter((p) => p.kind === 'person');
}

/** Whether the end screen asks each person for "Show my cards in replays": when more than one person sat at the screen (design 6). */
export function asksAgreement(players: readonly ReplayPlayer[]): boolean {
  return peopleOf(players).length > 1;
}

/**
 * The reveal record of a game (design 6, D4): `agreed` holds the people who agreed, in seating order; the policy is `'all'` when every person has.
 * One person against the computer has agreed by playing (adopted answer 1): nobody else's cards are secret from them.
 */
export function revealOf(players: readonly ReplayPlayer[], agreed: Iterable<PlayerId>): ReplayReveal {
  const people = peopleOf(players);
  const said = new Set(agreed);
  if (people.length === 1) said.add(people[0]!.id);
  const list = people.filter((p) => said.has(p.id)).map((p) => p.id);
  return { policy: people.length > 0 && list.length === people.length ? 'all' : 'own', agreed: list };
}

/**
 * How a finished game ended (CR 104): `'conceded'` when the last player to leave the game conceded (CR 104.3a; in a two-player game, the loser),
 * `'finished'` otherwise. Null while the game is not over.
 */
export function endingOf(state: GameState): GameEnding | null {
  if (!state.result) return null;
  const out = state.players.filter((p) => p.hasLost);
  const withOrder = out.filter((p) => p.left !== undefined);
  const last = withOrder.length > 0 ? withOrder.reduce((a, b) => (b.left!.order > a.left!.order ? b : a)) : null;
  const conceded = last ? last.conceded : out.some((p) => p.conceded);
  return { result: { winner: state.result.winner, reason: state.result.reason }, ended: conceded ? 'conceded' : 'finished', turns: state.turn.number };
}

/** The turn the log reached, from its checkpoints (one is taken at every turn start, design 4); 0 before the first. */
export function turnsOf(log: RecordedLog): number {
  return log.checkpoints.reduce((n, c) => Math.max(n, c.turn), 0);
}

/**
 * The game replay file (design 4) of a recorded game: the config and the log, the facts of the game, the reveal record and the title. `ending` is null
 * for a game left unfinished (`'abandoned'`); `endedAt` is when it ended (or was last played).
 */
export function gameReplayFile(args: {
  info: RecordedGameInfo;
  log: RecordedLog;
  ending: GameEnding | null;
  /** The turn the game reached when it is known (the state's); else the last checkpoint's. */
  turns?: number;
  endedAt: string;
  agreed: Iterable<PlayerId>;
  title?: string;
}): ReplayFile {
  const { info, log, ending } = args;
  const game: ReplayGameInfo = {
    mode: info.mode,
    format: info.format,
    players: info.players.map((p) => ({ ...p })),
    savedBy: info.savedBy,
    ended: ending?.ended ?? 'abandoned',
    result: ending?.result ?? null,
    turns: ending?.turns ?? args.turns ?? turnsOf(log),
    actions: log.actions.length,
    startedAt: info.createdAt,
    endedAt: args.endedAt,
  };
  const kind: ReplayKind = 'game';
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind,
    id: info.id,
    title: args.title ?? defaultTitle(info.players, info.format),
    createdAt: info.createdAt,
    app: { ...info.app },
    engine: { ...info.engine },
    game,
    reveal: revealOf(info.players, args.agreed),
    play: { config: info.config, actions: [...log.actions], times: [...log.times], checkpoints: log.checkpoints.map((c) => ({ ...c })) },
  };
}

/** A player's name in a replay's facts. */
export function nameIn(game: Pick<ReplayGameInfo, 'players'>, id: PlayerId | null): string {
  return game.players.find((p) => p.id === id)?.name ?? (id ?? 'nobody');
}

/** The result as the library lists it: "Alice won on turn 14", "Draw on turn 9", "Abandoned on turn 6" (design 10). */
export function resultText(game: ReplayGameInfo): string {
  if (game.ended === 'abandoned' || game.result === null) return `Abandoned on turn ${game.turns}`;
  if (game.result.winner === null) return `Draw on turn ${game.turns}`;
  const won = `${nameIn(game, game.result.winner)} won on turn ${game.turns}`;
  return game.ended === 'conceded' ? `${won} (a concession)` : won;
}

/** "Hot-seat", "Against the computer", ... */
export function modeLabel(mode: ReplayMode): string {
  switch (mode) {
    case 'hotseat':
      return 'Hot-seat';
    case 'computer':
      return 'Against the computer';
    case 'onlineHost':
      return 'Online (host)';
    case 'onlineGuest':
      return 'Online (guest)';
    case 'hosted':
      return 'Hosted';
  }
}

/** The game's length: "14 turns · 92 actions · 23 min". */
export function lengthText(game: ReplayGameInfo): string {
  const parts = [game.turns === 1 ? '1 turn' : `${game.turns} turns`, game.actions === 1 ? '1 action' : `${game.actions} actions`];
  const ms = Date.parse(game.endedAt) - Date.parse(game.startedAt);
  if (Number.isFinite(ms) && ms >= 0) {
    const min = Math.round(ms / 60_000);
    parts.push(min < 1 ? 'under a minute' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);
  }
  return parts.join(' · ');
}
