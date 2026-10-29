/**
 * The host-authoritative game (docs/design/online.md, "Model"; M12-5a: docs/design/m12-multiplayer.md section 6). The host's process holds the only full
 * game state (an engine GameSession); the guests send Actions and receive views:
 *
 * - An action is accepted only from the side that controls its `player` (the host's own UI for p1, each guest's connection for its own player).
 * - After every applied action each side gets its view plus the events with hidden information removed (redact.ts) and its legal priority actions.
 *   A guest never receives the full state, the seed or the RNG, so it cannot learn another player's hand or the order of a library (CR 400.2, 701.24a):
 *   `viewFor` shows hidden cards as blank cards and links no old id to an object the guest cannot see; a shuffle, a reorder and a secret arrangement
 *   (CR 401.4) give library cards new object ids in the engine (H1); `eventsFor` drops the new id of a move the guest cannot see. So no card a guest
 *   once knew can be followed into a library (to a place nobody told it) or through a shuffle. With several guests, each gets its own `viewFor` and
 *   `eventsFor` (per viewer, with the state of the last view that guest was given): nothing of one guest reaches another but what `viewFor` shows.
 * - Manual adjustments (cards resolved by hand, manual.ts): in a two-player game a guest's are applied only once the host player accepts them; in a 3-4
 *   player game every player's need the approval of **every other player** still in the game, each one shown them as they may know it.
 *   The host player's own need the guest's approval in a two-player game too (the same proposal, `manualProposal` / `manualVote` /
 *   `manualClosed`, as with 3-4 players).
 * - A guest action is applied at most once: a repeat of the last applied id is answered with an `ack` (or the current view, if the guest's
 *   connection does not have it yet), and an action chosen from an older view is refused as 'stale' (messages.ts, ActionMessage). F28: a view that
 *   is older only by stop changes (`setStops`, anyone's) is not older: the action applies (`lastProgressSeq`, as packages/hosted's TableActor).
 * - Undo is off online (every player would have to agree; later), so the host keeps no history of states (session.ts, audit 2026-10-12 M4).
 * - Flood control (audit M4, M5, m7): each guest's messages are paced and its syncs coalesced (limits.ts, one gate per seat), a `setStops` is applied
 *   only when it changes something while the game runs (stops.ts), join attempts are rate-limited, and nothing a guest sends can throw out of here: a
 *   failing handler closes that guest's connection only (C4), also when it runs later from the gate's timers (GuestGate catches and reports to `fail`).
 * - A guest that drops can take its seat back with the session token from `welcome` (a new handshake, then `sync`), also from a new process.
 *
 * M12-5a, 3-4 players (m12 design 6):
 * - **Seats and codes**: the host chooses 3 or 4 seats and gets one join code per guest seat (`codes`); a code admits one guest into its seat (seat n
 *   plays `p<n>`, seating.ts) and is spent once that guest is seated: a later hello with it must carry the seat's session token (a resume). The UDP
 *   handshake keys each connection with the code it used (link/handshake.ts), so a code holder reaches only its own seat.
 * - **Lobby and start**: guests join in any order and everyone gets `lobby` messages; the game is created when every seat is taken, with the players
 *   seated at random from the host's seed (CR 806.3, D2; the `start` message carries the table in seating order).
 * - **Drop clock**: a guest whose link drops keeps its seat; everyone sees a clock (`presence`, `forfeitInMs`); a return within
 *   `forfeitAfterMs` (5 minutes) cancels it, otherwise the host applies that player's concession (CR 104.3a, by the table's rule) and the engine's leave
 *   procedure runs (CR 800.4a). In the lobby the clock frees the seat instead (its code admits a new guest).
 * - **Leaving**: a guest that says bye during the game concedes (CR 104.3a: leaving is a concession) and the game goes on for the others; the host player
 *   leaving (`leave`) concedes too, and this process keeps running the game for the others (the host's page is a spectator, `spectating`) until it ends
 *   or the host closes it (`close`: the game ends for everyone without a result).
 * A two-player game is milestone 9's exactly (the session is created on the guest's hello; no lobby, start, presence or notice messages; no drop clock
 * unless `forfeitAfterMs` is given; the host answers the guest's manual adjustments), except that the host's own
 * manual adjustments wait for the guest's answer (`manualProposal` and `manualClosed` to the guest, its `manualVote`), as in a 3-4 player game.
 *
 * RPL-3 (replays design 6, 7.2, 16.3): replays of online games. The host keeps the game's record (record.ts: the config, every applied action with its
 * time and checkpoint, how it ended) and tells its server each line as it goes (`recordStart`, `recordAction`, `recordEnd`), which writes it to its data
 * directory for the host's page. Every player's "Show my cards in replays" (default off) is kept here: the host player's (`setReplayConsent`) and each
 * guest's (`replayConsent`, handled beside the gate like a vote, paced per seat like stop changes with only the latest waiting choice applied); a player
 * who left keeps their last choice. Only once the game is over for everyone (CR 104; in a 3-4 player game, not when one player has lost) and every
 * player of the game agreed does the host send each guest the whole game (`replayGame`: its own copy, saved by that guest), once; a guest that comes
 * back later gets it on its resume. Nothing of the record reaches a guest before (CR 400.2: the seed and the log reveal every hidden card). Later
 * choices change nothing.
 *
 * Known limitation (design): the host's machine holds the full state, so a dishonest host could inspect it.
 */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  applyAction, commanderOptions, currentEngine, legalActions, mayActAs, playersInGame, replayedEvents, viewFor,
  type AbilityCompiler, type Action, type ActionError, type CardDef, type GameConfig, type GameEvent, type GameResult, type GameState,
  type GameView, type LegalAction, type PlayerId, type ReplayApp, type StopSettings,
} from '@openmtg/engine';
import { NetError, type NetErrorCode } from '../errors';
import type { LinkOptions } from '../link/channel';
import type { Connection } from '../link/connection';
import { HostEndpoint, DEFAULT_PORT, type HostLimits } from '../link/endpoint';
import type { FaultInjector } from '../link/faults';
import { TokenBucket } from '../link/ratelimit';
import {
  errorMessage, msg, parseGuestMessage,
  type AckMessage, type ActionMessage, type DeckSubmission, type GuestMessage, type HelloMessage, type HostMessage, type LobbyMessage, type ManualClosedMessage,
  type ManualOutcome, type ManualProposalMessage, type ManualVoteMessage, type NoticeKind, type PresenceMessage, type PresencePlayer, type ReplayGameMessage,
  type SeatPlayer, type StartMessage, type ViewMessage, type WelcomeMessage,
} from '../protocol/messages';
import { cleanText } from '../protocol/text';
import { compareVersions, localEngineBuild, localVersions } from '../protocol/versions';
import { checkProof } from '../wire/crypto';
import { formatJoinCode, generateJoinCode, normalizeJoinCode } from '../wire/codes';
import { CASUAL, commanderVariantOf, prepareDeck, type CardSource, type DeckValidator, type PreparedDeck } from './deck';
import { Emitter } from './emitter';
import { DEFAULT_GUEST_LIMITS, GuestGate, type GuestLimits } from './limits';
import { describeProposal, ManualVotes, needsConsent, type ManualProposal } from './manual';
import {
  encodeReplayGame, newReplayId, OnlineRecord, onlineReplayFile, REPLAY_ID, type OnlineRecordAction, type OnlineRecordData, type OnlineRecordEnd,
  type OnlineRecordStart,
} from './record';
import { eventsFor } from './redact';
import { playerOfSeat, seatAtRandom } from './seating';
import { newSessionToken, OnlineSession, sameSessionToken } from './session';
import { stopsVerdict } from './stops';

export type { ManualProposal } from './manual';

export interface HostOptions {
  /** The host player's name and deck (names only, resolved like the guests'). */
  name: string;
  deck: DeckSubmission;
  cards: CardSource;
  /** Format every deck is validated for (default "casual": no restrictions but the size limits). */
  format?: string;
  validate?: DeckValidator;
  compiler?: AbilityCompiler;
  /** Join code (default: a new random one). In a 3-4 player game: seat 2's code, unless `codes` is given. */
  code?: string;
  /** M12-5a (m12 design 6): the seats at the table, the host's included (default 2: milestone 9's game). */
  seats?: 2 | 3 | 4;
  /** M12-5a: the guest seats' join codes in seat order (seat 2 first; tests and the test CLI). Default: a new random code per seat. */
  codes?: string[];
  port?: number;
  /** Address to bind (default 0.0.0.0: every interface, so the guests can reach the host through port forwarding). */
  address?: string;
  /** Game seed. Default: 128 random bits. Never sent to a guest (a known seed would reveal every shuffle). Also seats a 3-4 player table (CR 806.3). */
  seed?: string;
  gameOptions?: GameConfig['options'];
  /** Stops: the host's, and every guest's (`guest`). */
  stops?: { host?: Partial<StopSettings>; guest?: Partial<StopSettings> };
  rulesPack?: string | null;
  requireSameRulesPack?: boolean;
  link?: Partial<LinkOptions>;
  faults?: FaultInjector;
  /** How long a new connection may take to say hello (ms, default 5 s; audit m6: a connection that does not join is not kept long). */
  helloTimeout?: number;
  /** Flood control of each guest's messages and of join attempts (limits.ts; tests lower them). */
  guestLimits?: Partial<GuestLimits>;
  /** Connection limits of the UDP endpoint (handshake.ts). */
  endpointLimits?: Partial<HostLimits>;
  /**
   * M12-5a: how long a guest whose link dropped keeps its seat before it forfeits (ms). Default 5 minutes in a 3-4 player game, and no
   * clock in a two-player game (milestone 9: the host ends it with `forfeitGuest`); null: no clock.
   */
  forfeitAfterMs?: number | null;
  /**
   * RPL-3: the game's replays (record.ts). `app`: the app the guests' copies record they were made by (default version 0.0.0, no commit; a guest's page
   * records its own when it keeps one); `id`: the replay id (`REPLAY_ID`; default a new one); `now`: the clock of the record (epoch ms, default Date.now).
   */
  replay?: { app?: ReplayApp; id?: string; now?: () => number };
}

/**
 * What the host needs from its transport: the UDP endpoint (endpoint.ts), or an in-process stand-in in tests. Each connection it reports has passed
 * the handshake (it knows a join code; `Connection.joinCode` says which, null when the transport does not say).
 */
export interface HostTransport {
  readonly port: number;
  /** Datagrams dropped (malformed, unknown connection, failed authentication, replays, rate limits). */
  readonly dropped: number;
  onConnection(l: (c: Connection) => void): void;
  close(): Promise<void>;
}

/** M12-5a: a guest seat's join code (`GameHost.codes`). */
export interface SeatCode {
  seat: number;
  player: PlayerId;
  /** As shown to the player (groups of four). */
  code: string;
}

/** M12-5a: one seat of the table as the host's UI shows it (`GameHost.players`). */
export interface HostPlayerStatus {
  id: PlayerId;
  seat: number;
  /** Empty while the seat is open. */
  name: string;
  /** False while the seat is open (lobby). */
  taken: boolean;
  /** The guest's link is up (the host: always). */
  connected: boolean;
  /** Left the game (CR 104.5, 800.4a: lost or conceded). */
  left?: boolean;
  /** While a guest's link is down: milliseconds until they forfeit (the drop clock). */
  forfeitInMs?: number;
}

type HostEvents = {
  /** The host player's view changed (after every action). */
  view: [view: GameView, events: GameEvent[]];
  /** A guest took its seat (M12-5a: `player`, its player id). */
  guestJoined: [name: string, player: PlayerId];
  /**
   * A guest's link dropped or it said bye. `final`: the game is over, so no resume is expected; otherwise the seat is kept for a resume. `bye`: the
   * guest said bye (it left on purpose: Leave, or its server stopped) rather than its link dropping; it is not expected back, though the seat stays
   * (CL4, INTERFACE CHANGE: third argument). M12-5a: `player`, which guest.
   */
  guestLeft: [reason: string, final: boolean, bye: boolean, player: PlayerId];
  guestResumed: [player: PlayerId];
  /** A connection was refused (wrong version, bad deck, game full...). */
  rejected: [reason: string];
  /** A chat line of a guest (M12-5a: `from`, its player). */
  chat: [text: string, from: PlayerId];
  /** Manual adjustments for the host player to answer with `answerManual` (nothing is applied before). Described as the host may know the game. */
  manualProposal: [proposal: ManualProposal];
  /** The proposal the host was asked about was withdrawn (its player sent another action meanwhile). */
  manualWithdrawn: [id: number];
  /** M12-5a: the host player's own manual adjustments wait for every other player's answer (a 3-4 player game: the guest's, with two). */
  manualPending: [proposal: ManualProposal];
  /** M12-5a: a proposal closed (applied, rejected by `by`, withdrawn, or failed when it was applied). */
  manualClosed: [id: number, outcome: ManualOutcome, by: PlayerId | undefined, reason: string | undefined];
  gameOver: [result: GameResult];
  /** M12-5a: the table changed (a seat taken or freed, a link up or down, a drop clock, a player who left). */
  table: [players: HostPlayerStatus[]];
  /** M12-5a: the 3-4 player game was created: the table in seating order (CR 806.3). */
  start: [players: { id: PlayerId; name: string; seat: number }[]];
  /** M12-5a: what every guest is told about a player (joined, left, dropped, back, forfeited): the same line for the host's UI. */
  notice: [kind: NoticeKind, player: PlayerId, text: string];
  /**
   * RPL-3: the game was created and its record began (record.ts): its start, which holds the seed, and the players who agree so far (the choices made
   * in the lobby, seating order). For the host's own server only.
   */
  recordStart: [start: OnlineRecordStart, agreed: PlayerId[]];
  /** RPL-3: an action was applied: the record's line for it. */
  recordAction: [line: OnlineRecordAction];
  /** RPL-3: the game ended (CR 104): how. Emitted before `gameOver`. */
  recordEnd: [end: OnlineRecordEnd];
  /** RPL-3: a player's "Show my cards in replays" changed: the players who agree now (seating order once the game exists, seat order before). */
  replayConsent: [agreed: PlayerId[]];
  /**
   * RPL-3: the game is over and every player agreed: each guest was sent its copy (`ok`), or the game was too large to send (`ok` false:
   * REPLAY_GAME_MAX_BYTES; the guests keep their recordings). Once per game.
   */
  replayShared: [ok: boolean];
};

export type ActResult = { ok: true } | { ok: false; error: ActionError & { code?: NetErrorCode } };

interface GuestSeat {
  seat: number;
  player: PlayerId;
  conn: Connection | null;
  name: string;
  token: string;
  deck: PreparedDeck;
  /** The id of the last action of this guest that was applied (0: none). */
  lastAction: number;
  /** The seq of the last full view queued for `conn` (-1: none yet on this connection). */
  viewSeq: number;
  /** NETFIX1: the state that view was made from (null: none yet on this connection): which other hand cards the guest was shown (redact.ts). */
  viewState: GameState | null;
  /** The flood gate of `conn` (limits.ts). */
  gate: GuestGate | null;
  /** M12-5a: the drop clock: when the guest forfeits (performance.now() ms) and its timer. */
  forfeitAt: number | null;
  clock: NodeJS.Timeout | null;
  /**
   * M12-5a (security review): the drop allowance left (ms): the time this guest may still spend disconnected in the whole game (5 minutes in all, not per
   * drop: a return does not reset it); null: all of it. It starts over when the game starts (time away in the lobby does not count).
   */
  allowance: number | null;
  /** When the current drop began (performance.now() ms), while the clock runs. */
  droppedAt: number | null;
  /** RPL-3: the pace of this seat's replay choices (`limits.consent`): its bucket, the latest choice waiting for a token, and the timer that applies it. */
  consent: { bucket: TokenBucket; waiting: boolean | null; timer: NodeJS.Timeout | null } | null;
}

/** A proposal of manual adjustments waiting for answers (manual.ts). */
interface Pending {
  votes: ManualVotes;
  action: ManualAnswer;
  /** The id of the proposer's action message (a guest's), answered when the proposal closes. */
  ref?: number;
  sourceName: string;
  text: string;
}

type ManualAnswer = Extract<Action, { type: 'answer' }> & { answer: { kind: 'manualResolve' } };

export const HOST_PLAYER: PlayerId = 'p1';
/** The guest of a two-player game (M12-5a: also seat 2's player of a 3-4 player game). */
export const GUEST_PLAYER: PlayerId = 'p2';
/** The largest message a guest may send (JSON, after decompression). Its largest legitimate one, a hello with a full decklist, is far smaller. */
export const GUEST_MESSAGE_BYTES = 256 * 1024;
/** The deepest nesting a guest's message may have (codec.ts; an action is checked against LIMITS.actionDepth too). Audit C4. */
export const GUEST_MESSAGE_DEPTH = 32;
/** Bytes of views waiting to go to a guest at most; a guest that stops reading is disconnected past it (channel.ts, audit M5). It can resume. */
export const GUEST_SEND_QUEUE_BYTES = 16 * 1024 * 1024;
/** M12-5a: how long a dropped guest of a 3-4 player game keeps its seat before it forfeits. */
export const FORFEIT_AFTER_MS = 5 * 60 * 1000;
/** Actions that do not depend on the state they were chosen from, so they are never stale (CR 104.3a: a player may concede at any time). */
const STATELESS: ReadonlySet<Action['type']> = new Set<Action['type']>(['concede', 'setStops']);

function mergeDefs(...lists: CardDef[][]): CardDef[] {
  const byId = new Map<string, CardDef>();
  for (const list of lists) for (const d of list) if (!byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}

/** FAST5 MX7: a sideboard as the game config takes it (outside the game, CR 400.11a; learn, CR 701.48a); nothing when it is empty. */
const side = (sideboard: readonly string[]): { sideboard?: string[] } => (sideboard.length > 0 ? { sideboard: [...sideboard] } : {});

const failure = (code: NetErrorCode, message: string, rules: string[] = []): ActResult => ({ ok: false, error: { code, message, rules } });

/** M12-5a: one player of an online table, for `tableConfigFor`. */
export interface TablePlayer {
  id: PlayerId;
  name: string;
  deck: PreparedDeck;
  stops?: Partial<StopSettings>;
}

/**
 * The engine configuration of an online game. M11-3 (m11 design 6, D1): in a format with a command zone (Commander, Duel Commander, Brawl, Standard
 * Brawl) the game is a Commander game of that variant: `options.commander = commanderOptions(variant)` (its starting life, commander damage, tax and
 * mulligan are the variant's data, CR 903.7, 903.8, 903.10a, 903.12f-h; `gameOptions` may still override them) and each player's commanders start in the
 * command zone (`PlayerConfig.commanders`, CR 903.6). FAST5 MX7: each player's sideboard (outside the game, CR 400.11a) when it is not empty. CMP1: each
 * player's revealed companion (`PlayerConfig.companion`, CR 702.139a), in any format and with any number of players; a deck without one makes exactly
 * the configuration it made before.
 *
 * M12-5a (m12 design D1, D2): with 3-4 players the game is a multiplayer game (`options.multiplayer`: Free-for-All with the attack multiple players
 * option, CR 806, 802, 800.1; a Commander variant's multiplayer life, CR 903.7, 903.12f) and the players are seated at random from the seed (CR 806.3,
 * seating.ts): `players` is the seating order. Two players make exactly the configuration they made before (no shuffle, no `multiplayer`).
 */
export function tableConfigFor(o: Pick<HostOptions, 'format' | 'gameOptions'>, g: { seed: string; players: readonly TablePlayer[] }): GameConfig {
  const variant = commanderVariantOf(o.format ?? CASUAL);
  const commanders = (d: PreparedDeck) => ({ ...(variant ? { commanders: [...d.commanders] } : {}), ...(d.companion !== undefined ? { companion: d.companion } : {}) });
  const base = variant ? { commander: commanderOptions(variant), ...o.gameOptions } : o.gameOptions;
  const multiplayer = g.players.length > 2;
  const options = multiplayer ? { ...base, multiplayer: { variant: 'freeForAll' as const, attack: 'multiple' as const } } : base;
  const seated = multiplayer ? seatAtRandom(g.players, g.seed) : g.players;
  return {
    seed: g.seed,
    players: seated.map((p) => ({ id: p.id, name: p.name, deck: p.deck.main, ...side(p.deck.sideboard), ...commanders(p.deck), ...(p.stops ? { stops: p.stops } : {}) })),
    defs: mergeDefs(...g.players.map((p) => p.deck.defs)),
    ...(options ? { options } : {}),
  };
}

/** The configuration of a two-player online game (milestone 9's signature; `tableConfigFor` with the host and the guest). */
export function gameConfigFor(
  o: Pick<HostOptions, 'format' | 'gameOptions' | 'stops'>,
  g: { seed: string; hostName: string; hostDeck: PreparedDeck; guestName: string; guestDeck: PreparedDeck },
): GameConfig {
  return tableConfigFor(o, {
    seed: g.seed,
    players: [
      { id: HOST_PLAYER, name: g.hostName, deck: g.hostDeck, ...(o.stops?.host ? { stops: o.stops.host } : {}) },
      { id: GUEST_PLAYER, name: g.guestName, deck: g.guestDeck, ...(o.stops?.guest ? { stops: o.stops.guest } : {}) },
    ],
  });
}

/** The guest seats' codes (normalized), seat 2 first. */
function seatCodes(o: HostOptions, seats: number): string[] {
  const given = o.codes ?? (o.code !== undefined ? [o.code] : []);
  const out: string[] = [];
  for (let i = 0; i < seats - 1; i++) {
    const code = normalizeJoinCode(given[i] ?? generateJoinCode());
    if (!code) throw new NetError('badCode', 'That is not a valid join code.');
    out.push(code);
  }
  if (new Set(out).size !== out.length) throw new NetError('badCode', 'Each seat needs its own join code.');
  return out;
}

function seatsOf(o: HostOptions): number {
  const seats = o.seats ?? 2;
  if (seats !== 2 && seats !== 3 && seats !== 4) throw new NetError('badMessage', `A game has 2 to 4 seats (CR 800.1), not ${String(seats)}.`);
  // Duel Commander is a two-player format (m12 design 10 Q8): the engine refuses it with more players (CR 903.7 has no multiplayer life for it).
  if (seats > 2 && commanderVariantOf(o.format ?? CASUAL) === 'duel') throw new NetError('deckRejected', 'Duel Commander is a two-player format: host it with 2 seats, or choose Commander.');
  return seats;
}

export class GameHost extends Emitter<HostEvents> {
  readonly player = HOST_PLAYER;
  /** The guest of a two-player game (in a 3-4 player game: seat 2's player). */
  readonly guestPlayer = GUEST_PLAYER;
  /** The join code as shown to the player (groups of four). In a 3-4 player game: seat 2's (see `codes`). */
  readonly code: string;
  /** M12-5a: every guest seat's join code (one in a two-player game). */
  readonly codes: readonly SeatCode[];
  /** M12-5a: the seats at the table, the host's included. */
  readonly seats: number;
  /** Warnings about the host's own deck (cards without legality data...). */
  readonly warnings: readonly string[];
  private readonly name: string;
  private readonly multiplayer: boolean;
  private readonly forfeitAfterMs: number | null;
  private readonly seatOfCode = new Map<string, number>();
  private session: OnlineSession | null = null;
  /**
   * F28: the seq after the last applied action that was not a `setStops` (as TableActor.lastProgressSeq in packages/hosted). A stop change does not
   * change what another player may do, so an action chosen from a view at or after this seq is not stale although the seq moved on.
   */
  private lastProgressSeq = 0;
  /** The table in seating order, once a 3-4 player game was created. */
  private table: { id: PlayerId; name: string; seat: number }[] | null = null;
  private readonly guests = new Map<number, GuestSeat>();
  private pending: Pending | null = null;
  private proposals = 0;
  /** Seats whose hello is being handled (its deck is being checked). */
  private readonly joining = new Set<number>();
  private broadcasting = false;
  /** `after`: the action and the state it was applied to (an answer's events repeat what each player was given before it, engine `replayedEvents`). */
  private readonly queued: { events: GameEvent[]; ref?: { player: PlayerId; id: number }; after?: { prev: GameState; action: Action } }[] = [];
  /** NETFIX1: the state of the last view the host's own UI was given (which other hand cards it was shown, redact.ts). */
  private hostViewState: GameState | null = null;
  private announcedResult = false;
  private hostLeft = false;
  private closed = false;
  private readonly limits: GuestLimits;
  /**
   * Join attempts per guest seat (audit m7: a first hello makes the host resolve and check a whole decklist), and resumes per seat (a token compared in
   * constant time). Security review of M12-5a: one bucket for the whole host, charged on every hello, let one invited guest keep it empty by resuming
   * over and over, so nobody else could join or come back. Keyed by seat (the code the handshake used), a code holder spends only its own seat's budget.
   */
  private readonly budgets = new Map<number, { joins: TokenBucket; resumes: TokenBucket }>();
  /** Connections refused already: their later messages are ignored (one error, one 'rejected' event and one close per connection). */
  private readonly refusing = new WeakSet<Connection>();
  /** Connections whose guest said bye: their close is a leave, not a drop (guestLeft's `bye`). */
  private readonly said = new WeakSet<Connection>();
  /** RPL-3: the replay id of this game (record.ts): the record's id, the host's library key. */
  readonly replayId: string;
  /** RPL-3: the game's record, once the game was created. */
  private record: OnlineRecord | null = null;
  /** RPL-3: each seat's "Show my cards in replays" before the game exists (the lobby); the record takes them over when it begins. */
  private readonly consents = new Map<PlayerId, boolean>();
  /** RPL-3: whether the game was shared (null: not yet), and each guest's copy once it was (record.ts `encodeReplayGame`). */
  private sharing: { ok: boolean; copies: Map<PlayerId, string> } | null = null;

  private constructor(private readonly o: HostOptions, private readonly endpoint: HostTransport, private readonly hostDeck: PreparedDeck, codes: string[]) {
    super();
    this.seats = codes.length + 1;
    this.multiplayer = this.seats > 2;
    this.codes = codes.map((c, i) => ({ seat: i + 2, player: playerOfSeat(i + 2), code: formatJoinCode(c) }));
    codes.forEach((c, i) => this.seatOfCode.set(c, i + 2));
    this.code = this.codes[0]!.code;
    this.warnings = hostDeck.warnings;
    this.name = cleanText(o.name).slice(0, 40).trim() || 'Host';
    this.forfeitAfterMs = o.forfeitAfterMs !== undefined ? o.forfeitAfterMs : this.multiplayer ? FORFEIT_AFTER_MS : null;
    this.limits = { ...DEFAULT_GUEST_LIMITS, ...o.guestLimits };
    this.replayId = o.replay?.id !== undefined && REPLAY_ID.test(o.replay.id) ? o.replay.id : newReplayId();
    const now = performance.now();
    for (let seat = 2; seat <= this.seats; seat++) this.budgets.set(seat, { joins: new TokenBucket(this.limits.joins, now), resumes: new TokenBucket(this.limits.joins, now) });
    endpoint.onConnection((c) => this.onConnection(c));
  }

  /** Check the host's own deck, open the UDP port and wait for the guests. */
  static async start(o: HostOptions): Promise<GameHost> {
    const seats = seatsOf(o);
    const deck = await GameHost.hostDeck(o);
    const codes = seatCodes(o, seats);
    const endpoint = await HostEndpoint.listen({
      code: codes[0]!, codes, port: o.port ?? DEFAULT_PORT, address: o.address ?? '0.0.0.0',
      link: { maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH, maxSendQueueBytes: GUEST_SEND_QUEUE_BYTES, ...o.link },
      ...(o.faults ? { faults: o.faults } : {}), ...(o.endpointLimits ? { limits: o.endpointLimits } : {}),
    });
    return new GameHost(o, endpoint, deck, codes);
  }

  /**
   * A host on another transport (in-process tests). Its codes are those its connections were keyed with; in a 3-4 player game each connection's
   * `joinCode` must be one of them (its seat).
   */
  static async attach(o: HostOptions, transport: HostTransport): Promise<GameHost> {
    const seats = seatsOf(o);
    const deck = await GameHost.hostDeck(o);
    return new GameHost(o, transport, deck, seatCodes(o, seats));
  }

  private static async hostDeck(o: HostOptions): Promise<PreparedDeck> {
    const format = o.format ?? CASUAL;
    const deck = await prepareDeck(o.deck, { cards: o.cards, format, ...(o.validate ? { validate: o.validate } : {}), ...(o.compiler ? { compiler: o.compiler } : {}) });
    if (!deck.ok) throw new NetError('deckRejected', `Your deck cannot be used for ${format}.`, deck.errors);
    return deck.deck;
  }

  get port(): number {
    return this.endpoint.port;
  }

  get format(): string {
    return this.o.format ?? CASUAL;
  }

  /** True once the game was created (two players: when the guest joined; 3-4: when every seat was taken). */
  get started(): boolean {
    return this.session !== null;
  }

  /** Actions applied so far (the `seq` of the views; -1 before the game starts). */
  get seq(): number {
    return this.session ? this.session.actions.length : -1;
  }

  /** True once `close` was called. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Every guest seat is taken and its link is up (a two-player game: the guest is connected). */
  get guestConnected(): boolean {
    return this.guests.size === this.seats - 1 && [...this.guests.values()].every((g) => g.conn !== null);
  }

  /** M12-5a: whether `player`'s link is up (the host: always). */
  connected(player: PlayerId): boolean {
    if (player === HOST_PLAYER) return true;
    return this.seatByPlayer(player)?.conn != null;
  }

  /**
   * M12-5a: the host player left the running game (`leave`) and this process keeps serving it for the others: the host's UI is a spectator. M12 gaps:
   * false when that leave ended the game (the host's concession left one player, CR 104.2a).
   */
  get spectating(): boolean {
    return this.hostLeft;
  }

  /** Datagrams dropped by the endpoint (malformed, unknown connection, failed authentication). */
  get droppedDatagrams(): number {
    return this.endpoint.dropped;
  }

  /** The full game state. It exists only on the host's machine; never send it anywhere. */
  get state(): GameState | null {
    return this.session?.state ?? null;
  }

  /** Manual adjustments waiting for the host player's answer, if any (described as the host may know the game). */
  get pendingManual(): ManualProposal | null {
    const q = this.pending;
    if (!q || !q.votes.waiting.includes(HOST_PLAYER)) return null;
    return this.proposalFor(q, HOST_PLAYER);
  }

  /** M12-5a: the table: every seat (host first, then by seat; in seating order once the 3-4 player game was created). */
  players(): HostPlayerStatus[] {
    const s = this.session?.state;
    const now = performance.now();
    const status = (id: PlayerId, seat: number): HostPlayerStatus => {
      const g = seat === 1 ? null : this.guests.get(seat);
      const left = s?.players.find((p) => p.id === id)?.hasLost === true;
      if (seat !== 1 && !g) return { id, seat, name: '', taken: false, connected: false };
      const forfeit = g?.forfeitAt != null ? { forfeitInMs: Math.max(0, Math.round(g.forfeitAt - now)) } : {};
      return { id, seat, name: g ? g.name : this.name, taken: true, connected: g ? g.conn !== null : true, ...(left ? { left: true } : {}), ...forfeit };
    };
    const order = this.table ?? Array.from({ length: this.seats }, (_, i) => ({ id: playerOfSeat(i + 1), seat: i + 1 }));
    return order.map((p) => status(p.id, p.seat));
  }

  /** The host player's view. */
  view(): GameView | null {
    return this.session ? viewFor(this.session.state, HOST_PLAYER) : null;
  }

  /** The host player's legal priority actions. */
  legal(): LegalAction[] {
    return this.session ? legalActions(this.session.state, HOST_PLAYER) : [];
  }

  /**
   * The host player's own action. M12-5a: in a 3-4 player game, manual adjustments (`needsConsent`) become a proposal for every other player
   * (`manualPending`, then `manualClosed`); any other action of the host withdraws the host's own waiting proposal. In a two-player
   * game too (the guest answers them).
   */
  act(action: Action): ActResult {
    if (this.pending?.votes.player === HOST_PLAYER) this.closePending('withdrawn');
    if (needsConsent(action) && this.session && mayActAs(this.session.state, HOST_PLAYER, action)) return this.propose(action, HOST_PLAYER); // std-control-3: also for a player the host controls
    return this.apply(action, HOST_PLAYER);
  }

  /**
   * The host player's answer to manual adjustments (`manualProposal`). A two-player game: accepted ones are applied like the guest's answer (the engine
   * checks them). A 3-4 player game: one answer of every other player's; the proposal is applied once all have accepted, rejected by any rejection.
   */
  answerManual(id: number, accept: boolean, reason?: string): ActResult {
    return this.vote(HOST_PLAYER, id, accept, reason);
  }

  /**
   * End the game for a guest that left and does not come back: it is treated as the guest's concession (CR 104.3a). A two-player game: the guest. M12-5a:
   * `player`, which guest (default: the only guest whose link is down).
   */
  forfeitGuest(player?: PlayerId): ActResult {
    if (!this.session) return failure('notStarted', 'The game has not started yet.');
    const seat = player !== undefined ? this.seatByPlayer(player) : this.multiplayer ? this.onlyDropped() : this.guests.get(2);
    if (!seat) return failure('illegalAction', player !== undefined ? `${player} is not a guest of this game.` : 'Name the guest to forfeit: no guest, or more than one, has its link down.');
    if (seat.conn) return failure('illegalAction', 'The guest is connected; only a guest that left can be forfeited.');
    if (this.session.state.result) return failure('illegalAction', 'The game is over already.');
    if (!this.inGame(seat.player)) return failure('illegalAction', `${seat.name} has left the game already.`);
    this.stopClock(seat);
    const r = this.commit({ type: 'concede', player: seat.player }, seat.player);
    if (r.ok && this.multiplayer) {
      this.notify('forfeited', seat.player, `${seat.name} forfeits the game: the host ended it for them (CR 104.3a).`);
      this.sendPresence();
    }
    return r;
  }

  /**
   * M12-5a: the host player leaves a running 3-4 player game: their concession (CR 104.3a; the leave procedure, CR 800.4a), and this
   * process keeps running the game for the others (`spectating`; the host's view is the table without a hand). `close` ends it for everyone.
   * M12 gaps: a concession that leaves one player in the game ends it (CR 104.2a): then the host is not a spectator, the game is over as usual.
   */
  leave(): ActResult {
    if (!this.multiplayer) return failure('illegalAction', 'A two-player game ends when the host leaves: close it.');
    if (!this.session) return failure('notStarted', 'The game has not started yet: close it instead.');
    if (this.session.state.result) return failure('illegalAction', 'The game is over already.');
    if (this.pending?.votes.player === HOST_PLAYER) this.closePending('withdrawn');
    const conceding = this.inGame(HOST_PLAYER);
    if (conceding) {
      const r = this.commit({ type: 'concede', player: HOST_PLAYER }, HOST_PLAYER);
      if (!r.ok) return r;
    }
    // M12 gaps (STATUS "Wave M12" gap 5): with one other player left, the concession ends the game (CR 104.2a): there is nothing to keep running, so the
    // host is not a spectator and the notice says the game is over (the result and the end screen follow from `gameOver`)
    const over = this.session.state.result != null;
    this.hostLeft = !over;
    const did = conceding ? `${this.name} left the game and conceded (CR 104.3a)` : `${this.name} left`; // out of the game already: as a guest's `left`
    this.notify('left', HOST_PLAYER, over ? `${did}, which ends it (CR 104.2a).` : `${did}; their OpenMTG keeps running the game for the others.`);
    this.sendPresence();
    return { ok: true };
  }

  /** A chat line of the host player, to every guest. */
  chat(text: string): void {
    const m = msg({ type: 'chat', text: cleanText(text).slice(0, 500), from: HOST_PLAYER });
    for (const g of this.guests.values()) g.conn?.send(m);
  }

  // ---- replays (RPL-3)

  /** The host player's "Show my cards in replays" (default off; replays design 6). Their last choice counts, also after they left. */
  setReplayConsent(agree: boolean): void {
    this.choose(HOST_PLAYER, agree);
  }

  /** The players who agreed to show their cards in replays (their last choices), in seating order (seat order before the game exists). */
  get replayAgreed(): PlayerId[] {
    if (this.record) return this.record.agreed;
    return Array.from({ length: this.seats }, (_, i) => playerOfSeat(i + 1)).filter((p) => this.consents.get(p) === true);
  }

  /** Whether the game was sent to every guest (null: not yet; false: it was too large to send). */
  get replayShared(): boolean | null {
    return this.sharing ? this.sharing.ok : null;
  }

  /** The game's record (record.ts), once the game was created: for the host's own server; it holds the seed. Never send it anywhere. */
  get replayRecord(): OnlineRecordData | null {
    return this.record;
  }

  /** A player's choice: kept (the last one counts), told to the server, and the game shared when it is over and everyone agreed. Once shared, final. */
  private choose(player: PlayerId, agree: boolean): void {
    if (this.sharing) return;
    let changed: boolean;
    if (this.record) changed = this.record.choose(player, agree);
    else {
      changed = (this.consents.get(player) ?? false) !== agree;
      this.consents.set(player, agree);
    }
    if (!changed) return;
    this.emit('replayConsent', this.replayAgreed);
    this.maybeShare();
  }

  /**
   * A guest's choice (`replayConsent`), paced like its stop changes (`limits.consent`, by default 1/s with a burst of 5): within the rate it counts at
   * once; beyond it the latest one waits for a token and only it is applied (the last choice counts: none is refused, so the host never keeps a choice
   * the player has changed since). The game is not shared while a choice waits (`maybeShare`).
   */
  private paceConsent(seat: GuestSeat, agree: boolean): void {
    const now = performance.now();
    const pace = (seat.consent ??= { bucket: new TokenBucket(this.limits.consent, now), waiting: null, timer: null });
    if (pace.waiting === null && pace.bucket.take(now)) return this.choose(seat.player, agree);
    pace.waiting = agree;
    this.consentLater(seat);
  }

  /** The waiting choice of `seat` is applied when its bucket has a token again. */
  private consentLater(seat: GuestSeat): void {
    const pace = seat.consent;
    if (!pace || pace.timer || pace.waiting === null) return;
    pace.timer = setTimeout(() => {
      pace.timer = null;
      if (this.closed || this.guests.get(seat.seat) !== seat || pace.waiting === null) return;
      if (!pace.bucket.take(performance.now())) return this.consentLater(seat);
      const agree = pace.waiting;
      pace.waiting = null;
      try {
        this.choose(seat.player, agree);
        // Unchanged by it, the game may still be due: it was held back while this choice waited.
        this.maybeShare();
      } catch (e) {
        this.emit('rejected', `The host failed on a replay choice: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, Math.max(1, pace.bucket.wait(performance.now())));
    pace.timer.unref?.();
  }

  /** The game was created: its record begins, with the choices made in the lobby. */
  private beginRecord(): void {
    const s = this.session!;
    this.record = new OnlineRecord(
      { id: this.replayId, format: this.format, host: HOST_PLAYER, engine: currentEngine(localEngineBuild()), config: s.config },
      this.o.replay?.now ?? (() => Date.now()),
      this.consents,
    );
    this.emit('recordStart', this.record.start, this.record.agreed);
  }

  /**
   * Share the game when it is over for everyone (CR 104) and every player agreed (design 6, D5): each guest's own copy (saved by that guest, with the
   * reveal record of everyone's agreement), made once and sent to every guest whose link is up; one that comes back later gets it on its resume. Not
   * while a guest's later choice waits for its pace (`paceConsent`): it may take the agreement back.
   */
  private maybeShare(): void {
    const r = this.record;
    if (this.sharing || !r || !this.session?.state.result || !r.everyoneAgreed) return;
    if ([...this.guests.values()].some((g) => g.consent?.waiting != null)) return;
    const app = this.o.replay?.app ?? { version: '0.0.0', commit: null };
    const copies = new Map<PlayerId, string>();
    let ok = true;
    for (const g of this.guests.values()) {
      const data = encodeReplayGame(onlineReplayFile(r, { savedBy: g.player, mode: 'onlineGuest', app }));
      if (data === null) {
        ok = false;
        break;
      }
      copies.set(g.player, data);
    }
    this.sharing = { ok, copies: ok ? copies : new Map() };
    if (ok) for (const g of this.guests.values()) this.sendCopy(g);
    this.emit('replayShared', ok);
  }

  /** A guest's copy of the shared game, when there is one and its link is up. */
  private sendCopy(seat: GuestSeat): void {
    const data = this.sharing?.copies.get(seat.player);
    if (data !== undefined && seat.conn) seat.conn.send(msg<ReplayGameMessage>({ type: 'replayGame', data }));
  }

  /**
   * Close the game: every guest gets a `bye` (after every view still queued for it), then the link's own bye datagrams (endpoint.ts). The host keeps the
   * links up after game over until this is called (FIX-NET gap 1: every player sees the result, and the links close when they leave, not by timeout).
   * M12-5a: a game still running ends for everyone without a result (the host stopped serving it).
   */
  async close(reason = 'host closed the game', flushMs = 2000): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const flushes: Promise<unknown>[] = [];
    for (const g of this.guests.values()) {
      this.stopClock(g);
      const c = g.conn;
      if (c && !c.closed) {
        c.send(msg({ type: 'bye', reason }));
        flushes.push(c.flush(flushMs));
      }
    }
    await Promise.all(flushes);
    for (const g of this.guests.values()) g.gate?.stop();
    await this.endpoint.close();
  }

  // ---- connections

  private onConnection(conn: Connection): void {
    let state: 'new' | 'hello' | 'seated' = 'new';
    const timer = setTimeout(() => {
      if (state === 'new') conn.close('no hello');
    }, this.o.helloTimeout ?? 5000);
    timer.unref();
    conn.onClose((reason) => {
      clearTimeout(timer);
      const seat = this.seatOfConn(conn);
      if (!seat) return;
      seat.conn = null;
      seat.gate?.stop();
      seat.gate = null;
      if (this.closed) return;
      const bye = this.said.has(conn);
      this.emit('guestLeft', reason, this.session?.state.result != null, bye, seat.player);
      if (this.multiplayer || this.forfeitAfterMs !== null) this.seatClosed(seat, bye);
    });
    conn.onMessage((raw) => {
      if (this.refusing.has(conn)) return; // refused already: it is being closed
      const r = parseGuestMessage(raw);
      if (!r.ok) {
        const id = (raw as { id?: unknown } | null)?.id;
        const ref = typeof id === 'number' && Number.isSafeInteger(id) ? { ref: id } : {};
        const err = errorMessage(r.version ? 'version' : 'badMessage', `Message rejected: ${r.error}`, { fatal: state !== 'seated' || r.version === true, ...ref });
        // M12-5a: a guest of another protocol version gets the refusal in a message its version reads (an error's shape has not changed since version 1).
        conn.send(r.peerVersion !== undefined ? { ...err, v: r.peerVersion } : err);
        if (state !== 'seated' || r.version) return this.refuse(conn, r.error);
        // A seated guest's bad message costs a strike (audit M5): a guest that keeps sending them is closed.
        this.seatOfConn(conn)?.gate?.strike();
        return;
      }
      const m = r.message;
      if (state === 'new') {
        if (m.type !== 'hello') return this.refuse(conn, 'expected hello', 'protocol');
        state = 'hello';
        clearTimeout(timer);
        // A hello that makes the host fail must not end the process as an unhandled rejection (audit M3): it closes this connection only.
        this.onHello(conn, m).then(
          (seated) => {
            state = seated ? 'seated' : 'hello';
          },
          (e: unknown) => this.refuse(conn, `The host failed on this join: ${e instanceof Error ? e.message : String(e)}`, 'engineError'),
        );
        return;
      }
      if (state !== 'seated') return;
      const seat = this.seatOfConn(conn);
      if (!seat) return;
      // A vote is handled beside the gate (its union is milestone 9's, limits.ts): one answer per player and proposal, so it cannot repeat work; a vote
      // that does not fit costs a strike. Nothing it does may throw out of here (C4).
      if (m.type === 'manualVote') {
        try {
          this.onGuestVote(seat, conn, m);
        } catch (e) {
          conn.close(`protocol error: the host failed on a message (${e instanceof Error ? e.message : String(e)})`);
        }
        return;
      }
      // RPL-3: a player's replay choice, beside the gate too: it sets one value (the game is shared once at most, its copies made once), paced per seat
      // like stop changes (`paceConsent`). C4 as above.
      if (m.type === 'replayConsent') {
        try {
          if (seat.conn === conn) this.paceConsent(seat, m.agree);
        } catch (e) {
          conn.close(`protocol error: the host failed on a message (${e instanceof Error ? e.message : String(e)})`);
        }
        return;
      }
      seat.gate?.offer(m);
    });
  }

  /** Seat a connection: it no longer counts as pending at the endpoint (audit m6), and its messages go through a new flood gate (limits.ts). */
  private seatConnection(seat: GuestSeat, conn: Connection): void {
    conn.admit();
    seat.conn = conn;
    seat.viewSeq = -1;
    seat.viewState = null;
    seat.gate?.stop();
    seat.gate = new GuestGate(this.limits, {
      run: (m) => this.onGuestMessage(seat, conn, m),
      refuse: (m, why) => void conn.send(errorMessage('rateLimited', why, m.type === 'action' ? { ref: m.id } : {})),
      sync: () => {
        if (seat.conn !== conn) return;
        if (this.session) this.sendGuestView(seat, [], undefined, true);
        else this.sendLobby(seat);
      },
      abuse: () => conn.close('protocol error: too many messages (rate limit)'),
      // Audit C4: a handler that failed on this guest's message (also from the gate's timers) closes this connection only; the seat stays for a resume.
      fail: (e) => conn.close(`protocol error: the host failed on a message (${e instanceof Error ? e.message : String(e)})`),
    });
  }

  /** Send a fatal error and close the connection once it is delivered. Once per connection: later calls do nothing. */
  private refuse(conn: Connection, reason: string, code?: NetErrorCode, details: string[] = []): void {
    if (this.refusing.has(conn)) return;
    this.refusing.add(conn);
    if (code) conn.send(errorMessage(code, reason, { fatal: true, details }));
    this.emit('rejected', reason);
    void conn.flush(1000).then(() => conn.close(`refused: ${reason}`));
  }

  private async onHello(conn: Connection, m: HelloMessage): Promise<boolean> {
    if (!checkProof(conn.keys, conn.connId, m.proof)) {
      this.refuse(conn, 'join code proof failed', 'badCode');
      return false;
    }
    const local = localVersions(this.o.rulesPack ?? null);
    const versions = compareVersions(local, m.versions, this.o.requireSameRulesPack);
    if (versions.fatal) {
      this.refuse(conn, versions.fatal.message, versions.fatal.code);
      return false;
    }
    // M12-5a: the seat is the code's (one per seat); a two-player game has the one guest seat whatever its transport says.
    const seatNo = this.multiplayer ? (conn.joinCode !== null ? this.seatOfCode.get(conn.joinCode) ?? null : null) : 2;
    if (seatNo === null) {
      this.refuse(conn, 'That join code is not one of this game\'s.', 'badCode');
      return false;
    }
    const budget = this.budgets.get(seatNo)!;
    const taken = this.guests.get(seatNo);
    if (taken) {
      // A resume resolves no deck: its own small budget, per seat (security review of M12-5a).
      if (!budget.resumes.take(performance.now())) {
        this.refuse(conn, 'Too many attempts to take this seat back; try again in a few seconds.', 'rateLimited');
        return false;
      }
      return this.resume(conn, m, taken, local.rulesPack);
    }
    if (this.joining.has(seatNo) || this.closed) {
      this.refuse(conn, this.multiplayer ? `Another player is joining seat ${seatNo}.` : 'Another player is joining this game.', 'gameFull');
      return false;
    }
    // Audit m7: a first join resolves and checks a whole decklist; this seat's join budget pays for it.
    if (!budget.joins.take(performance.now())) {
      this.refuse(conn, 'Too many join attempts; try again in a few seconds.', 'rateLimited');
      return false;
    }
    this.joining.add(seatNo);
    try {
      const deck = await prepareDeck(m.deck, {
        cards: this.o.cards, format: this.format, ...(this.o.validate ? { validate: this.o.validate } : {}), ...(this.o.compiler ? { compiler: this.o.compiler } : {}),
      });
      if (conn.closed) return false;
      if (!deck.ok) {
        this.refuse(conn, `Your deck cannot be used for ${this.format}.`, 'deckRejected', deck.errors);
        return false;
      }
      if (this.closed || this.guests.has(seatNo)) {
        this.refuse(conn, 'This seat is taken.', 'gameFull');
        return false;
      }
      const name = this.uniqueName(m.name, seatNo);
      const seat: GuestSeat = {
        seat: seatNo, player: playerOfSeat(seatNo), conn: null, name, token: newSessionToken(), deck: deck.deck, lastAction: 0, viewSeq: -1, viewState: null, gate: null,
        forfeitAt: null, clock: null, allowance: null, droppedAt: null, consent: null,
      };
      if (!this.multiplayer) {
        // Milestone 9: the game starts when the guest joins.
        try {
          this.session = new OnlineSession(gameConfigFor(this.o, { seed: this.o.seed ?? randomBytes(16).toString('hex'), hostName: this.name, hostDeck: this.hostDeck, guestName: name, guestDeck: deck.deck }));
        } catch (e) {
          this.refuse(conn, `The game could not be created: ${e instanceof Error ? e.message : String(e)}`, 'engineError');
          return false;
        }
        this.beginRecord();
      }
      this.guests.set(seatNo, seat);
      this.seatConnection(seat, conn);
      conn.send(this.welcome(seat, false, [...versions.warnings, ...deck.deck.warnings]));
      this.emit('guestJoined', name, seat.player);
      if (!this.multiplayer) {
        this.broadcast([]);
        return true;
      }
      this.notify('joined', seat.player, `${name} took seat ${seatNo}.`);
      this.sendLobby();
      if (this.guests.size === this.seats - 1) this.startGame();
      return true;
    } finally {
      this.joining.delete(seatNo);
    }
  }

  /**
   * A name nobody else at the table has (a second "Gus" reads "Gus (seat 3)"; names compare without case). A guest cannot write that disambiguation
   * itself ("Hana (seat 1)" to pass for the host): "(seat N)" is taken out of the name it sends (security review of M12-5a).
   */
  private uniqueName(given: string, seat: number): string {
    const name = given.replace(/\(\s*seat\s*\d*\s*\)/gi, ' ').replace(/\s+/g, ' ').trim() || 'Guest';
    const used = new Set([this.name, ...[...this.guests.values()].map((g) => g.name)].map((n) => n.toLowerCase()));
    return used.has(name.toLowerCase()) ? `${name} (seat ${seat})` : name;
  }

  /** A seated guest takes its seat back after a drop (design: "resume") with the token from `welcome`; it then asks for the view with `sync`. */
  private resume(conn: Connection, m: HelloMessage, seat: GuestSeat, rulesPack: string | null): boolean {
    if (!sameSessionToken(m.resume, seat.token)) {
      this.refuse(conn, this.multiplayer ? `Seat ${seat.seat} is taken (each join code admits one player).` : 'This game already has two players.', 'gameFull');
      return false;
    }
    const old = seat.conn;
    this.seatConnection(seat, conn);
    if (old && old !== conn) old.destroy('replaced by a resumed connection');
    conn.send(this.welcome(seat, true, rulesPack === m.versions.rulesPack ? [] : ['Different rules packs; the game uses the host\'s card automation.']));
    const wasDropped = seat.forfeitAt !== null;
    this.stopClock(seat);
    this.emit('guestResumed', seat.player);
    if (this.multiplayer) {
      // What the returning guest missed of the table (the view follows its sync), and the proposal it is part of.
      if (this.table) conn.send(msg<StartMessage>({ type: 'start', players: this.table.map((p) => ({ ...p })) }));
      else this.sendLobby(); // everyone's lobby shows the seat connected again (security review minor 4)
      if (wasDropped) this.notify('back', seat.player, `${seat.name} is back.`);
      if (this.session) this.sendPresence();
      if (this.pending) this.sendProposalTo(seat, this.pending);
    } else if (this.pending) {
      // the host's own proposal the guest is to answer (sendProposalTo sends nothing for the guest's own in a two-player game).
      this.sendProposalTo(seat, this.pending);
    }
    // RPL-3: the game was shared while this guest was away: its copy (the link keeps the order of what is sent).
    this.sendCopy(seat);
    return true;
  }

  private welcome(seat: GuestSeat, resumed: boolean, warnings: string[]): WelcomeMessage {
    return msg<WelcomeMessage>({
      type: 'welcome', player: seat.player, host: { id: HOST_PLAYER, name: this.name }, format: this.format, session: seat.token,
      versions: localVersions(this.o.rulesPack ?? null), warnings, resumed, lastAction: seat.lastAction,
      ...(this.multiplayer ? { seat: seat.seat, seats: this.seats } : {}),
    });
  }

  /** M12-5a: every seat is taken: create the game, the players seated at random from the seed (CR 806.3), and tell everyone the table. */
  private startGame(): void {
    const seed = this.o.seed ?? randomBytes(16).toString('hex');
    const players: TablePlayer[] = [
      { id: HOST_PLAYER, name: this.name, deck: this.hostDeck, ...(this.o.stops?.host ? { stops: this.o.stops.host } : {}) },
      ...[...this.guests.values()].sort((a, b) => a.seat - b.seat).map((g) => ({ id: g.player, name: g.name, deck: g.deck, ...(this.o.stops?.guest ? { stops: this.o.stops.guest } : {}) })),
    ];
    let config: GameConfig;
    try {
      config = tableConfigFor(this.o, { seed, players });
      this.session = new OnlineSession(config);
    } catch (e) {
      const why = `The game could not be created: ${e instanceof Error ? e.message : String(e)}`;
      this.emit('rejected', why);
      void this.close(why);
      return;
    }
    this.beginRecord();
    const byId = new Map(players.map((p) => [p.id, p] as const));
    const seatOf = (id: PlayerId) => (id === HOST_PLAYER ? 1 : [...this.guests.values()].find((g) => g.player === id)!.seat);
    const table = config.players.map((p) => {
      const id = p.id!; // tableConfigFor names every player
      return { id, name: byId.get(id)!.name, seat: seatOf(id) };
    });
    this.table = table;
    // The drop allowance counts in the game only (security review minor 2): a guest still away keeps its clock, from a whole allowance.
    for (const g of this.guests.values()) {
      const away = g.clock !== null;
      this.stopClock(g);
      g.allowance = null;
      if (away) this.startClock(g);
    }
    const start = msg<StartMessage>({ type: 'start', players: table.map((p) => ({ ...p })) });
    for (const g of this.guests.values()) g.conn?.send(start);
    this.emit('start', table.map((p) => ({ ...p })));
    this.sendPresence();
    this.broadcast([]);
  }

  private onGuestMessage(seat: GuestSeat, conn: Connection, m: GuestMessage): void {
    if (seat.conn !== conn) return; // a connection that was replaced by a resume
    switch (m.type) {
      case 'action':
        return this.onGuestAction(seat, conn, m);
      case 'sync':
        if (this.session) return this.sendGuestView(seat, [], undefined, true);
        return this.sendLobby(seat);
      case 'chat':
        return this.onChat(seat, m.text);
      case 'bye':
        this.said.add(conn);
        conn.close(`guest left: ${m.reason}`);
        return;
      case 'hello':
        conn.send(errorMessage('badMessage', 'Already joined.'));
        return;
    }
  }

  /** A guest's chat: to the host's UI, and (3-4 players) to every other guest with its sender. */
  private onChat(seat: GuestSeat, text: string): void {
    this.emit('chat', text, seat.player);
    if (!this.multiplayer) return;
    const m = msg({ type: 'chat', text, from: seat.player });
    for (const g of this.guests.values()) if (g !== seat) g.conn?.send(m);
  }

  private onGuestAction(seat: GuestSeat, conn: Connection, m: ActionMessage): void {
    const refuse = (code: NetErrorCode, message: string) => void conn.send(errorMessage(code, message, { ref: m.id }));
    if (!this.session) return refuse('notStarted', this.multiplayer ? 'The game starts when every seat is taken.' : 'The game has not started yet.');
    // Applied once: the last applied id again is a resend (answered like an action that changed nothing), an older id is out of date.
    if (seat.lastAction > 0 && m.id === seat.lastAction) return this.answerUnchanged(seat, m.id);
    if (m.id < seat.lastAction) return refuse('stale', `Action ${m.id} is older than the last one applied (${seat.lastAction}).`);
    const action = m.action;
    // F28: views after the last progress differ only by stop changes (anyone's), so an action chosen from any of them still applies.
    if (!STATELESS.has(action.type) && (m.seq < this.lastProgressSeq || m.seq > this.session.actions.length)) {
      return refuse('stale', 'The game moved on since the view this action was chosen from; choose again from the latest view.');
    }
    // The proposer acting otherwise withdraws its proposal (milestone 9: the guest's was the only one).
    if (this.pending?.votes.player === seat.player) this.closePending('withdrawn');
    if (needsConsent(action) && mayActAs(this.session.state, seat.player, action)) { // std-control-3: also for a player the guest controls (CR 723.5)
      const r = this.propose(action, seat.player, m.id);
      if (!r.ok) conn.send(errorMessage(r.error.code ?? 'illegalAction', r.error.message, { rules: r.error.rules, ref: m.id }));
      return;
    }
    const r = this.apply(action, seat.player, m.id);
    if (!r.ok) refuse(r.error.code ?? 'illegalAction', r.error.message);
  }

  // ---- manual adjustments (manual.ts)

  /**
   * Manual adjustments of `proposer` (its manualResolve answer): checked by the engine first (decision id, objects, zones), so nobody is asked about
   * adjustments that cannot be applied; then shown to every voter: every other player still in the game (two players: the other one; the host's own
   * need the guest's answer).
   */
  private propose(action: ManualAnswer, proposer: PlayerId, ref?: number): ActResult {
    const state = this.session!.state;
    let error: ActionError | undefined;
    try {
      error = applyAction(state, action).error;
    } catch (e) {
      error = { message: `The engine failed on these adjustments (the game is unchanged): ${e instanceof Error ? e.message : String(e)}`, rules: [] };
    }
    if (error) return { ok: false, error: { ...error, code: 'illegalAction' } };
    const d = state.pending?.kind === 'manualResolve' ? state.pending : null;
    const voters = playersInGame(state); // ManualVotes leaves the proposer out: two players, the other one
    const q: Pending = { votes: new ManualVotes(++this.proposals, proposer, voters), action, ...(ref !== undefined ? { ref } : {}), sourceName: d?.sourceName ?? '', text: d?.text ?? '' };
    this.pending = q;
    if (q.votes.done === 'accepted') return this.applyPending(); // nobody left to ask (cannot happen while two players are in the game)
    this.announce(q);
    return { ok: true };
  }

  /**
   * The proposal as `viewer` may know the game (CR 400.2; FXH review finding 1: the proposer names other players' hand cards by the m4 aliases of its
   * view, which are described unaliased, the translation applyAction makes when the proposal is applied).
   */
  private proposalFor(q: Pending, viewer: PlayerId): ManualProposal {
    const state = this.session!.state;
    return {
      id: q.votes.id, player: q.votes.player, sourceName: q.sourceName, text: q.text, ops: q.action.answer.ops,
      lines: describeProposal(state, q.votes.player, q.action.answer.ops, viewer), ...(this.shared(q) ? { waiting: q.votes.waiting } : {}),
    };
  }

  /**
   * Whether a proposal goes to the guests by message (`manualProposal`, `manualClosed`) and carries `waiting`: every proposal of a 3-4 player game;
   * in a two-player game the host's own, while the guest's stay milestone 9's (only the host's UI is asked).
   */
  private shared(q: Pending): boolean {
    return this.multiplayer || q.votes.player === HOST_PLAYER;
  }

  /** Tell everyone involved about a proposal (again, after an answer): the host's UI by event, each guest (`shared`) by message. */
  private announce(q: Pending): void {
    if (q.votes.player === HOST_PLAYER) this.emit('manualPending', this.proposalFor(q, HOST_PLAYER));
    else if (q.votes.waiting.includes(HOST_PLAYER)) this.emit('manualProposal', this.proposalFor(q, HOST_PLAYER));
    if (this.shared(q)) for (const g of this.guests.values()) this.sendProposalTo(g, q);
  }

  /** A proposal to one guest (`shared`), described as it may know the game; the raw operations never leave the host. */
  private sendProposalTo(g: GuestSeat, q: Pending): void {
    if (!this.shared(q) || !g.conn) return;
    const p = this.proposalFor(q, g.player);
    g.conn.send(msg<ManualProposalMessage>({ type: 'manualProposal', proposal: { id: p.id, player: p.player, sourceName: p.sourceName, text: p.text, lines: p.lines, waiting: p.waiting ?? [] } }));
  }

  private onGuestVote(seat: GuestSeat, conn: Connection, m: ManualVoteMessage): void {
    const r = this.vote(seat.player, m.proposal, m.accept, m.reason);
    if (!r.ok) {
      conn.send(errorMessage(r.error.code ?? 'manualRejected', r.error.message));
      seat.gate?.strike();
    }
  }

  /** One player's answer to the waiting proposal. */
  private vote(voter: PlayerId, id: number, accept: boolean, reason?: string): ActResult {
    const q = this.pending;
    if (!q || q.votes.id !== id) return failure('manualRejected', 'There is no such proposal (it was answered or withdrawn).');
    switch (q.votes.vote(voter, accept)) {
      case 'notVoter':
        return failure('manualRejected', 'These are your own adjustments: the other players answer them.');
      case 'answered':
        return failure('manualRejected', 'You have answered this proposal already (or it is not yours to answer).');
      case 'pending':
        this.announce(q);
        return { ok: true };
      case 'rejected':
        this.closePending('rejected', voter, reason);
        return { ok: true };
      case 'accepted':
        return this.applyPending();
    }
  }

  /** Every voter accepted: apply the proposal as its player's answer (the engine checks it again). */
  private applyPending(): ActResult {
    const q = this.pending!;
    this.pending = null;
    const proposer = q.votes.player;
    const r = this.apply(q.action, proposer, q.ref);
    const seat = this.seatByPlayer(proposer);
    if (!r.ok && seat && q.ref !== undefined) seat.conn?.send(errorMessage(r.error.code ?? 'illegalAction', r.error.message, { rules: r.error.rules, ref: q.ref }));
    this.proposalClosed(q, r.ok ? 'applied' : 'failed', undefined, r.ok ? undefined : r.error.message);
    return r;
  }

  /** Close the waiting proposal without applying it (rejected by `by`, or withdrawn). */
  private closePending(outcome: 'rejected' | 'withdrawn', by?: PlayerId, reason?: string): void {
    const q = this.pending;
    if (!q) return;
    this.pending = null;
    const why = reason ? `: ${cleanText(reason).slice(0, 500)}` : '.';
    const seat = this.seatByPlayer(q.votes.player);
    if (seat && q.ref !== undefined) {
      const text = outcome === 'withdrawn'
        ? `Withdrawn: you sent another action before ${this.multiplayer ? 'every other player' : 'the host'} answered.`
        : `${this.multiplayer ? this.nameOf(by!) : 'The host'} did not accept your manual adjustments${why}`;
      seat.conn?.send(errorMessage('manualRejected', text, { ref: q.ref }));
    }
    if (outcome === 'withdrawn' && q.votes.player !== HOST_PLAYER) this.emit('manualWithdrawn', q.votes.id);
    this.proposalClosed(q, outcome, by, reason);
  }

  /** The proposal closed: everyone involved is told (every guest when `shared`; the host's UI by event). */
  private proposalClosed(q: Pending, outcome: ManualOutcome, by?: PlayerId, reason?: string): void {
    const clean = reason !== undefined ? cleanText(reason).slice(0, 500) : undefined;
    this.emit('manualClosed', q.votes.id, outcome, by, clean);
    if (!this.shared(q)) return;
    const m = msg<ManualClosedMessage>({ type: 'manualClosed', proposal: q.votes.id, outcome, ...(by !== undefined ? { by } : {}), ...(clean !== undefined ? { reason: clean } : {}) });
    for (const g of this.guests.values()) g.conn?.send(m);
  }

  /**
   * After a change: a proposal whose player left the game is withdrawn; a voter who left no longer counts (CR 800.4a), which may complete it.
   */
  private reviewPending(): void {
    const q = this.pending;
    if (!q || !this.session) return;
    if (this.session.state.result || !this.inGame(q.votes.player)) return this.closePending('withdrawn');
    let done: 'pending' | 'accepted' | 'rejected' = 'pending';
    for (const p of q.votes.waiting) if (!this.inGame(p)) done = q.votes.drop(p);
    if (done === 'accepted') void this.applyPending();
    else if (done === 'pending' && q.votes.waiting.length > 0) this.announce(q);
  }

  // ---- drops, the clock and leaving (M12-5a)

  /** A guest's link closed (`bye`: it said bye). 3-4 players, or a two-player game with a clock. */
  private seatClosed(seat: GuestSeat, bye: boolean): void {
    if (!this.multiplayer) {
      // A two-player game with a clock (`forfeitAfterMs` given): only a drop starts it; a bye leaves the host to end the game (milestone 9).
      if (!bye && this.session && !this.session.state.result && this.inGame(seat.player)) this.startClock(seat);
      return;
    }
    if (!this.session) {
      // The lobby: a guest that left frees its seat (its code admits a new guest); a dropped one has the clock to come back.
      if (bye) return this.freeSeat(seat, `${seat.name} left the table.`);
      this.startClock(seat);
      this.sendLobby();
      return;
    }
    if (this.session.state.result) {
      // After the end (CR 104.1) a guest that leaves is told to the table; nothing is waited for any more.
      if (bye) this.notify('left', seat.player, this.conceded(seat.player) ? `${seat.name} left the game and conceded (CR 104.3a).` : `${seat.name} left.`);
      this.sendPresence();
      return;
    }
    if (bye) {
      // Leaving a game in progress is a concession (CR 104.3a; a guest's Leave concedes before its bye): the game goes on for the others.
      const stillIn = this.inGame(seat.player);
      if (stillIn) this.commit({ type: 'concede', player: seat.player }, seat.player);
      this.notify('left', seat.player, stillIn || this.conceded(seat.player) ? `${seat.name} left the game and conceded (CR 104.3a).` : `${seat.name} left.`);
    } else if (this.inGame(seat.player)) {
      this.startClock(seat);
      this.notify('dropped', seat.player, seat.forfeitAt !== null
        ? `${seat.name}'s link dropped: they forfeit in ${clockText(seat.forfeitAt - performance.now())} unless they come back.`
        : `${seat.name}'s link dropped; waiting for them to come back.`);
    }
    this.sendPresence();
  }

  /**
   * The drop clock starts (or goes on): it runs down the guest's allowance, the time it may spend disconnected in the whole game (`forfeitAfterMs` in all,
   * not per drop: security review of M12-5a, as the hosted server's rule), so dropping and coming back over and over cannot hold a table forever.
   */
  private startClock(seat: GuestSeat): void {
    if (this.forfeitAfterMs === null || seat.clock) return;
    const left = Math.max(0, seat.allowance ?? this.forfeitAfterMs);
    const now = performance.now();
    seat.droppedAt = now;
    seat.forfeitAt = now + left;
    seat.clock = setTimeout(() => {
      try {
        this.clockRanOut(seat);
      } catch (e) {
        this.emit('rejected', `The host failed on a drop clock: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, left);
    seat.clock.unref?.();
  }

  /** The clock stops (the guest is back, or it no longer matters): what the drop used is taken from the allowance. */
  private stopClock(seat: GuestSeat): void {
    if (seat.clock) clearTimeout(seat.clock);
    if (seat.droppedAt !== null && this.forfeitAfterMs !== null) {
      seat.allowance = Math.max(0, (seat.allowance ?? this.forfeitAfterMs) - (performance.now() - seat.droppedAt));
    }
    seat.clock = null;
    seat.forfeitAt = null;
    seat.droppedAt = null;
  }

  /** The drop clock ran out: the guest forfeits (CR 104.3a, by the table's rule), or in the lobby its seat is freed. */
  private clockRanOut(seat: GuestSeat): void {
    seat.clock = null;
    seat.forfeitAt = null;
    seat.droppedAt = null;
    seat.allowance = 0;
    if (this.closed || seat.conn || this.guests.get(seat.seat) !== seat) return;
    if (!this.session) return this.freeSeat(seat, `${seat.name} did not come back: seat ${seat.seat} is open again.`);
    if (this.session.state.result || !this.inGame(seat.player)) return this.sendPresence();
    const r = this.commit({ type: 'concede', player: seat.player }, seat.player);
    if (r.ok && this.multiplayer) this.notify('forfeited', seat.player, `${seat.name} was disconnected for ${minutes(this.forfeitAfterMs ?? 0)} in all: they forfeit the game (CR 104.3a).`);
    this.sendPresence();
  }

  /** A lobby seat opens again: its guest is forgotten and its code admits a new one. */
  private freeSeat(seat: GuestSeat, text: string): void {
    this.stopClock(seat);
    seat.gate?.stop();
    this.guests.delete(seat.seat);
    // RPL-3: the seat's next guest makes its own choice (a choice of this one still waiting for its pace is dropped with it).
    if (seat.consent?.timer) clearTimeout(seat.consent.timer);
    if (this.consents.delete(seat.player)) this.emit('replayConsent', this.replayAgreed);
    this.notify('left', seat.player, text);
    this.sendLobby();
  }

  // ---- actions and views

  private apply(action: Action, from: PlayerId, ref?: number): ActResult {
    if (!this.session) return failure('notStarted', this.multiplayer ? 'The game starts when every seat is taken.' : 'The game has not started yet.');
    // std-control-3 (CR 723.5): a connection also acts for a player its player controls (never their concession or stops), and not for its own player while another one does
    if (action.type === 'startGame' || !('player' in action) || !mayActAs(this.session.state, from, action)) return failure('notYourPlayer', `This connection controls ${from} only.`);
    const stops = stopsVerdict(this.session.state, action);
    if (stops === 'over') return failure('illegalAction', 'The game is over; stops cannot change any more.', ['CR 104.1']);
    if (stops === 'unchanged') {
      // Nothing to apply (audit M4): the same answer as for an applied action, without a new state.
      const seat = this.seatByPlayer(from);
      if (seat && ref !== undefined) {
        seat.lastAction = ref;
        this.answerUnchanged(seat, ref);
      }
      return { ok: true };
    }
    return this.commit(action, from, ref);
  }

  private commit(action: Action, from: PlayerId, ref?: number): ActResult {
    const prev = this.session!.state;
    let r: ReturnType<OnlineSession['apply']>;
    try {
      r = this.session!.apply(action);
    } catch (e) {
      // applyAction is pure: the state is unchanged. A guest's malformed answer must not take the host down.
      return failure('engineError', `The engine failed on this action (the game is unchanged): ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!r.ok) return { ok: false, error: { ...r.error, code: 'illegalAction' } };
    if (action.type !== 'setStops') this.lastProgressSeq = this.session!.actions.length;
    // RPL-3: the record's line first, so the game's end (in broadcast) finds the action that ended it.
    if (this.record) this.emit('recordAction', this.record.add(action, prev, this.session!.state));
    const seat = from === HOST_PLAYER ? undefined : this.seatByPlayer(from);
    if (seat && ref !== undefined) seat.lastAction = ref;
    const left = this.multiplayer ? this.leftPlayers() : '';
    this.broadcast(r.events, seat && ref !== undefined ? { player: from, id: ref } : undefined, { prev, action });
    if (this.multiplayer) {
      if (this.leftPlayers() !== left) this.sendPresence();
      this.reviewPending();
    } else if (this.pending && this.shared(this.pending)) {
      this.reviewPending(); // the host's own proposal is withdrawn when the game ends (a concession of either player)
    }
    return { ok: true };
  }

  /** Send every player their view. Re-entrant calls (a listener acting on a view) are queued so views go out in order. */
  private broadcast(events: GameEvent[], ref?: { player: PlayerId; id: number }, after?: { prev: GameState; action: Action }): void {
    this.queued.push({ events, ...(ref ? { ref } : {}), ...(after ? { after } : {}) });
    if (this.broadcasting) return;
    this.broadcasting = true;
    try {
      for (let next = this.queued.shift(); next; next = this.queued.shift()) {
        const state = this.session!.state;
        // An answer re-runs its action from the start (engine core/apply.ts): what a player was given while the decision waited is not sent again
        // (a trigger that resolved before the cleanup's discard, CR 514.1, was animated twice)
        const { events: all, after } = next;
        const fresh = (viewer: PlayerId): GameEvent[] => {
          const n = after ? replayedEvents(after.prev, after.action, viewer) : 0;
          return n > 0 ? all.slice(n) : all;
        };
        for (const g of this.guests.values()) this.sendGuestView(g, fresh(g.player), next.ref?.player === g.player ? next.ref.id : undefined);
        // NETFIX1, NETFIX2: events name no other player's hand card hidden from the host (redact.ts); one that left that hand keeps its id only if the
        // view the host's UI was given last showed it
        const view = viewFor(state, HOST_PLAYER);
        const events = eventsFor(state, fresh(HOST_PLAYER), HOST_PLAYER, { ...(this.hostViewState ? { before: this.hostViewState } : {}) });
        this.hostViewState = state;
        this.emit('view', view, events);
        if (state.result && !this.announcedResult) {
          this.announcedResult = true;
          const end = this.record?.finish(state);
          if (end) this.emit('recordEnd', end);
          this.emit('gameOver', state.result);
          // RPL-3: after every player's last view: the game, if every player agreed already.
          this.maybeShare();
        }
      }
    } finally {
      this.broadcasting = false;
    }
  }

  /**
   * The answer to a guest action that changed nothing (a resend of the last applied id, an unchanged setStops): a small `ack` when the guest's
   * connection has the current view queued or delivered already, otherwise that view, once (audit M5: these answers rendered a full view each, at
   * the action rate, outside the sync limit).
   */
  private answerUnchanged(seat: GuestSeat, ref: number): void {
    if (!this.session || !seat.conn) return;
    const seq = this.session.actions.length;
    if (seat.viewSeq === seq) seat.conn.send(msg<AckMessage>({ type: 'ack', seq, ref }));
    else this.sendGuestView(seat, [], ref);
  }

  /**
   * A guest's view: `viewFor` and the events it may see (redact.ts). `latest`: an answer to a sync, without events or ref, so it replaces an
   * earlier one the link has not started to send (audit M5: at most one such view waits per guest).
   *
   * Deviation from the audit's M5 ("at most one queued view per guest"): views that answer an action or follow a change carry events and a ref the
   * guest needs, so they are not replaced. They are bounded by the action rate (limits.ts), by game progress (each one follows an applied action),
   * and by the send-queue cap (GUEST_SEND_QUEUE_BYTES: a guest that stops reading is disconnected and can resume).
   */
  private sendGuestView(seat: GuestSeat, events: GameEvent[], ref: number | undefined, latest = false): void {
    if (!this.session) return;
    const conn = seat.conn;
    if (!conn) return;
    const state = this.session.state;
    const seq = this.session.actions.length;
    // NETFIX1, NETFIX2: the guest's events name no other player's hand card hidden from it (redact.ts); one that left that hand keeps its id only if the
    // last view queued on this connection (`viewState`) showed it
    const view = viewFor(state, seat.player);
    const sent = conn.send(msg<ViewMessage>({
      type: 'view', seq, view, events: eventsFor(state, events, seat.player, { ...(seat.viewState ? { before: seat.viewState } : {}) }),
      legal: legalActions(state, seat.player), ...(ref !== undefined ? { ref } : {}),
    }), latest ? { replace: 'syncView' } : {});
    if (sent) {
      seat.viewSeq = seq;
      seat.viewState = state;
    }
  }

  // ---- the table (M12-5a)

  /** The lobby (seated players by seat), to one guest or to all; the host's UI gets `table`. */
  private sendLobby(only?: GuestSeat): void {
    const players: SeatPlayer[] = [
      { id: HOST_PLAYER, name: this.name, seat: 1, connected: true },
      ...[...this.guests.values()].sort((a, b) => a.seat - b.seat).map((g) => ({ id: g.player, name: g.name, seat: g.seat, connected: g.conn !== null })),
    ];
    const m = msg<LobbyMessage>({ type: 'lobby', seats: this.seats, players });
    if (only) {
      only.conn?.send(m);
      return;
    }
    for (const g of this.guests.values()) g.conn?.send(m);
    this.emit('table', this.players());
  }

  /** Links, drop clocks and players who left, to every guest; the host's UI gets `table`. */
  private sendPresence(): void {
    if (!this.multiplayer) return;
    if (!this.session) return this.sendLobby();
    const players = this.players();
    const m = msg<PresenceMessage>({
      type: 'presence',
      players: players.map((p): PresencePlayer => ({
        id: p.id, name: p.name, seat: p.seat, connected: p.connected, ...(p.left ? { left: true } : {}), ...(p.forfeitInMs !== undefined ? { forfeitInMs: p.forfeitInMs } : {}),
      })),
    });
    for (const g of this.guests.values()) g.conn?.send(m);
    this.emit('table', players);
  }

  /** A notice about `player` to every guest of a 3-4 player game, and to the host's UI. */
  private notify(kind: NoticeKind, player: PlayerId, text: string): void {
    const m: HostMessage = msg({ type: 'notice', kind, player, text });
    for (const g of this.guests.values()) g.conn?.send(m);
    this.emit('notice', kind, player, text);
  }

  // ---- lookups

  private seatOfConn(conn: Connection): GuestSeat | undefined {
    for (const g of this.guests.values()) if (g.conn === conn) return g;
    return undefined;
  }

  private seatByPlayer(player: PlayerId): GuestSeat | undefined {
    for (const g of this.guests.values()) if (g.player === player) return g;
    return undefined;
  }

  /** The only guest still in the game whose link is down (3-4 players: `forfeitGuest` without a player). */
  private onlyDropped(): GuestSeat | undefined {
    const down = [...this.guests.values()].filter((g) => g.conn === null && this.inGame(g.player));
    return down.length === 1 ? down[0] : undefined;
  }

  private nameOf(player: PlayerId): string {
    return player === HOST_PLAYER ? this.name : this.seatByPlayer(player)?.name ?? player;
  }

  /** Still in the game (CR 104.5, 800.4a: not lost or conceded). */
  private inGame(player: PlayerId): boolean {
    const p = this.session?.state.players.find((x) => x.id === player);
    return p !== undefined && !p.hasLost;
  }

  private conceded(player: PlayerId): boolean {
    return this.session?.state.players.find((x) => x.id === player)?.conceded === true;
  }

  /** The players who have left, as a key (a change sends presence). */
  private leftPlayers(): string {
    return (this.session?.state.players ?? []).filter((p) => p.hasLost).map((p) => p.id).join(',');
  }
}

/** "5 minutes", "30 seconds". */
function minutes(ms: number): string {
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000} minute${ms === 60000 ? '' : 's'}`;
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? '' : 's'}`;
}

/** A clock reading: "4:12", "0:05" (what is left of a drop allowance). */
function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
