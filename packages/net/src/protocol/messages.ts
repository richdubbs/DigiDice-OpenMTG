/**
 * The game protocol (docs/design/online.md, "Transport"): versioned JSON messages `{ v, type, ... }` carried by the reliable link.
 *
 *   guest -> host   hello (join-code proof, versions, name, decklist by names; `resume` token after a drop), action, sync, chat, bye,
 *                   manualVote (protocol 4: an answer to another player's manual adjustments), replayConsent (protocol 5: this player's "Show my
 *                   cards in replays")
 *   host -> guest   welcome (player id, the host player, format, session token, warnings; the seat in a 3-4 player game), view (viewFor + redacted
 *                   events + legal actions), ack (an action that changed nothing), error, chat (with its sender), bye; and in a 3-4 player game
 *                   (protocol 4, m12 design 6): lobby (who sits where before the start), start (the table in seating order), presence (links, drop
 *                   clocks, players who left), notice (a player joined, left, dropped, came back or forfeited), manualProposal and manualClosed
 *                   (manual adjustments, in words as this player may know the game, CR 400.2); replayGame (protocol 5: the whole game as a replay file,
 *                   after the end and only when every player agreed)
 *
 * Keep-alive pings are link-level (a flag in the datagram payload, wire/frame.ts), not JSON messages. Everything a guest sends is checked
 * here before the host looks at it (`parseGuestMessage`): the host trusts nothing from the network. Texts that cross the network lose their
 * control characters on the way in (text.ts).
 */
import { ACTION_BOUNDS, actionShapeProblem, type Action, type ActionError, type GameEvent, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import type { NetErrorCode } from '../errors';
import { normalizeSteps } from '../game/stops';
import { cleanText, hasControl } from './text';

/**
 * The protocol version. Bump it whenever a message changes shape, and whenever the engine's GameView, Action, Decision or LegalAction change shape
 * (the guest renders the views and sends the actions). The handshake also compares the engine build (versions.ts), which catches any engine change.
 */
// 2: `ack` (audit 2026-10-12, M5). 3: `DeckSubmission.commander` and the Commander state in the views (M11-3, CR 903).
// 4 (M12-5a, m12 design 6): 3-4 player games. `WelcomeMessage.host` replaces `opponent` (the one other player of a two-player game), plus `seat` and
// `seats`; `lobby`, `start`, `presence`, `notice`, `manualProposal`, `manualClosed` (host -> guest) and `manualVote` (guest -> host); the multiplayer
// state of the views (PlayerState.left, CR 104.5, 800.4a; the `playerLeft` event). A version-3 peer is refused with 'version' in a message it can read.
// CMP1 (merged into m12/main with main 9ff1626d) adds `DeckSubmission.companion` and the `PlayerState.companion` view field within protocol 4, in
// two-player and 3-4 player games alike (host.ts#tableConfigFor): the engine build compared in the handshake (versions.ts) already refuses two versions
// that differ in them.
// 5 (RPL-3, replays design 6 and 16.3): replays of online games, with 2-4 players. `replayConsent` (guest -> host: this player's "Show my cards in replays",
// default off; the host keeps every player's last choice, a leaver's too) and `replayGame` (host -> each guest: the whole game as a replay file, sent only
// after the game is over and only when every player agreed; `REPLAY_GAME_MAX_BYTES`). A version-4 peer is refused with 'version' in a message it can read,
// as a version-3 peer was by version 4 (`parseGuestMessage`'s `peerVersion`; a guest reads an older host's refusal, `otherVersionError`).
export const PROTOCOL_VERSION = 5;

export interface DeckEntry {
  name: string;
  count: number;
}

/**
 * A decklist by Oracle names only: the host resolves and compiles it with its own card data. `commander` (M11-3, m11 design 6): the deck's commander
 * section, one card or two partners (CR 903.3, 702.124); `main` is then the rest of the deck (the 99 with one commander). It is used in a format with a
 * command zone (Commander, Duel Commander, Brawl, Standard Brawl) and refused in any other (CR 903.3: only those formats have commanders).
 */
export interface DeckSubmission {
  main: DeckEntry[];
  sideboard: DeckEntry[];
  commander?: DeckEntry[];
  /**
   * CMP1 INTERFACE CHANGE (additive, optional; no protocol bump: absent means no companion, exactly as before): the deck's Companion section, at most one
   * card (CR 702.139a: a player reveals at most one). In constructed play the companion is one of the sideboard's cards (CR 100.4), and lists name it in
   * both places (Arena); the host takes one copy out of the sideboard for it. Used in every format.
   */
  companion?: DeckEntry[];
}

export interface Versions {
  protocol: number;
  /** The engine's compiler version (COMPILER_VERSION) and ability-model version (ABILITY_MODEL_VERSION). */
  engine: string;
  model: number;
  /** The engine build: a hash of the engine package's sources (versions.ts); null when they cannot be read (a bundled build). */
  build: string | null;
  /** The installed rules pack (docs/design/updates.md), or null when none is installed. */
  rulesPack: string | null;
}

export interface HelloMessage { v: number; type: 'hello'; versions: Versions; name: string; deck: DeckSubmission; proof: string; resume?: string }
export interface WelcomeMessage {
  v: number;
  type: 'welcome';
  player: PlayerId;
  /**
   * The host's player (protocol 4: replaces milestone 9's `opponent`, the one other player of a two-player game, which was the host too). The table of a
   * 3-4 player game comes in `lobby`, `start` and `presence`.
   */
  host: { id: PlayerId; name: string };
  format: string;
  /** Token that lets this guest take its seat back after a drop, also from a new process (GuestOptions.resume). */
  session: string;
  versions: Versions;
  warnings: string[];
  resumed: boolean;
  /** The id of the last action of this guest the host applied (0: none). The guest continues its ids after it. */
  lastAction: number;
  /**
   * M12-1, M12-5a (m12 design 4.6, section 6): the seat the join code was for (each guest seat has its own code; 1 is the host's seat, guests 2-4; the
   * player id is `p<seat>`). Absent in a two-player game.
   */
  seat?: number;
  /** M12-5a: the seats at the table, the host's included (3 or 4). Absent in a two-player game. */
  seats?: number;
}
/**
 * M12-1, M12-5a (m12 design 4.6, section 6; PROTOCOL_VERSION 4): the messages of a 3-4 player online game. A two-player game never sends them (its guest
 * learns everything from `welcome` and the views, as in milestone 9); `chat` every game has.
 */
/** One seated player as the lobby shows them: the host is seat 1 (p1), guests p2-p4 by the seat of their code. */
export interface SeatPlayer { id: PlayerId; name: string; seat: number; connected: boolean }
/**
 * Host -> every guest: who sits where before the game starts (the game starts when every seat is taken), in seat order; a seat missing
 * from `players` is open.
 */
export interface LobbyMessage { v: number; type: 'lobby'; seats: number; players: SeatPlayer[] }
/** Host -> every guest: the table in seating order (random from the host's seed, CR 806.3; m12 design D2), sent when the game is created. */
export interface StartMessage { v: number; type: 'start'; players: { id: PlayerId; name: string; seat: number }[] }
/**
 * One player of a running 3-4 player game as everyone may know it: whether their link is up, whether they left the game (CR 104.5, 800.4a), and while
 * their link is down how long until they forfeit (the host's clock: 5 minutes; milliseconds from when the message was sent, so the
 * machines' clocks need not agree).
 */
export interface PresencePlayer { id: PlayerId; name: string; seat: number; connected: boolean; left?: boolean; forfeitInMs?: number }
/** Host -> every guest: the table's links and drop clocks (m12 design 6), in seating order once the game runs. */
export interface PresenceMessage { v: number; type: 'presence'; players: PresencePlayer[] }
/** What happened to a player: joined the lobby, left (Leave; the host leaving keeps serving), their link dropped, came back, or forfeited (the clock). */
export type NoticeKind = 'joined' | 'left' | 'dropped' | 'back' | 'forfeited';
/** Host -> every guest: a line about one player for the table (m12 design 6: "Bianca left the game and conceded"). */
export interface NoticeMessage { v: number; type: 'notice'; kind: NoticeKind; player: PlayerId; text: string }
/**
 * Host -> each player involved in a 3-4 player game: manual adjustments of `player` (cards resolved by hand), in words as the receiver may know the game
 * (CR 400.2; the raw operations never leave the host), and the players whose answer is still awaited (`waiting`). The proposer gets it too, described
 * as they see the game. Sent again when someone answers. Every other player still in the game must accept.
 */
export interface ManualProposalMessage {
  v: number;
  type: 'manualProposal';
  proposal: { id: number; player: PlayerId; sourceName: string; text: string; lines: string[]; waiting: PlayerId[] };
}
/** How a proposal ended: applied (all accepted), rejected (by `by`), withdrawn (its player acted otherwise), failed (the engine refused it then). */
export type ManualOutcome = 'applied' | 'rejected' | 'withdrawn' | 'failed';
/** Host -> each player involved: the proposal is closed. */
export interface ManualClosedMessage { v: number; type: 'manualClosed'; proposal: number; outcome: ManualOutcome; by?: PlayerId; reason?: string }
/** Guest -> host: this player's approval or rejection of another player's proposal of manual adjustments (every other player approves). */
export interface ManualVoteMessage { v: number; type: 'manualVote'; proposal: number; accept: boolean; reason?: string }
/**
 * RPL-3 (protocol 5; replays design 6, 16.3), guest -> host: this player's "Show my cards in replays" (their hand, face-down cards and decklist), default
 * off. Sent whenever the player changes it, during the game or after its end; the host keeps every player's last choice (a player who left keeps theirs,
 * CR 104.3a, 800.4a). Once the game was shared (`replayGame`), a later choice changes nothing.
 */
export interface ReplayConsentMessage { v: number; type: 'replayConsent'; agree: boolean }
/**
 * RPL-3 (protocol 5; replays design 6, D5), host -> each guest: the whole game as a replay file (packages/engine replay/format.ts, kind 'game', saved by
 * that guest), gzipped and in base64 (`data`), at most REPLAY_GAME_MAX_BYTES of gzip. The host sends it only after the game is over for everyone (CR 104)
 * and only when every player of the game agreed (`replayConsent`): during a game the seed and the log would reveal every hidden card (CR 400.2). The link
 * fragments it like a view. The guest's browser checks it as any replay file before keeping it (engine `readReplayFile`).
 */
export interface ReplayGameMessage { v: number; type: 'replayGame'; data: string }

/** RPL-3: the largest replay file a host sends a guest, in bytes of gzip (replays design 6: at most 1 MB; a game replay is 5-40 KB gzipped, design 12). */
export const REPLAY_GAME_MAX_BYTES = 1024 * 1024;
/** RPL-3: the longest `replayGame` text: the base64 of REPLAY_GAME_MAX_BYTES bytes. */
export const REPLAY_GAME_MAX_TEXT = 4 * Math.ceil(REPLAY_GAME_MAX_BYTES / 3);
/**
 * An action of the guest. `id` goes up with every action the guest sends; a repeat of the last applied id is answered with the current view instead
 * of being applied again. `seq` is the seq of the view the action was chosen from: the host refuses the action as 'stale' when the game has moved on
 * since (concede and setStops excepted: they do not depend on the state). So an action can always be resent safely after a drop.
 */
export interface ActionMessage { v: number; type: 'action'; id: number; seq: number; action: Action }
export interface ViewMessage {
  v: number;
  type: 'view';
  /** Number of actions applied so far: views only move forward. */
  seq: number;
  view: GameView;
  events: GameEvent[];
  /** The receiver's legal priority actions (legalActions), empty unless it has priority. */
  legal: LegalAction[];
  /** The id of the receiver's action this view answers, if any. */
  ref?: number;
}
/**
 * The answer to an action that changed nothing (a resend of the last applied id, an unchanged setStops) when the guest has the current view already:
 * the view at `seq` is still current. It costs the host no view (audit 2026-10-12, M5: these answers were full views, one per message).
 */
export interface AckMessage { v: number; type: 'ack'; seq: number; ref: number }
export interface ErrorMessage { v: number; type: 'error'; code: NetErrorCode; message: string; rules?: string[]; details?: string[]; ref?: number; fatal?: boolean }
export interface SyncMessage { v: number; type: 'sync' }
export interface ChatMessage { v: number; type: 'chat'; text: string; from?: PlayerId }
export interface ByeMessage { v: number; type: 'bye'; reason: string }

export type NetMessage =
  | HelloMessage | WelcomeMessage | ActionMessage | ViewMessage | AckMessage | ErrorMessage | SyncMessage | ChatMessage | ByeMessage
  | LobbyMessage | StartMessage | PresenceMessage | NoticeMessage | ManualProposalMessage | ManualClosedMessage | ManualVoteMessage
  | ReplayConsentMessage | ReplayGameMessage;
/**
 * The messages of a guest that go through its flood gate (limits.ts). Milestone 9's five types: the hosted server's kit pins this union
 * (packages/hosted, server-kit test). A vote (`manualVote`) is handled beside the gate: GuestToHostMessage.
 */
export type GuestMessage = HelloMessage | ActionMessage | SyncMessage | ChatMessage | ByeMessage;
/**
 * M12-5a: every message a guest may send (protocol 4): GuestMessage and its answers to other players' manual adjustments. RPL-3 (protocol 5): and its
 * "Show my cards in replays" (`replayConsent`), handled beside the gate like a vote.
 */
export type GuestToHostMessage = GuestMessage | ManualVoteMessage | ReplayConsentMessage;
export type HostMessage =
  | WelcomeMessage | ViewMessage | AckMessage | ErrorMessage | ChatMessage | ByeMessage
  | LobbyMessage | StartMessage | PresenceMessage | NoticeMessage | ManualProposalMessage | ManualClosedMessage | ReplayGameMessage;

type Body<M> = M extends unknown ? Omit<M, 'v'> : never;
export function msg<M extends NetMessage>(m: Body<M>): M {
  return { v: PROTOCOL_VERSION, ...m } as M;
}

export function errorMessage(code: NetErrorCode, message: string, extra: { rules?: string[]; details?: string[]; ref?: number; fatal?: boolean } = {}): ErrorMessage {
  return msg<ErrorMessage>({ type: 'error', code, message, ...extra });
}

export function actionErrorMessage(e: ActionError, ref: number): ErrorMessage {
  return errorMessage('illegalAction', e.message, { rules: e.rules, ref });
}

// ---- validation of what the guest sends

/** `mainCards` and `sideboardCards` hold in every format, casual included: a guest must not make the host build a game of 75,000 cards. */
export const LIMITS = {
  name: 40, chat: 500, deckEntries: 300, cardName: 200, copies: 250, mainCards: 250, sideboardCards: 15,
  /** A deck has one commander, or two with a partner ability (CR 903.3, 702.124a); the engine refuses more (core/create.ts). */
  commanderCards: 2,
  /** CMP1: a player reveals at most one companion (CR 702.139a). */
  companionCards: 1,
  /** An action's estimated JSON size, nesting depth and number of values (audit C4: checked without recursion; the engine's ACTION_BOUNDS). */
  actionBytes: ACTION_BOUNDS.maxBytes, actionDepth: ACTION_BOUNDS.maxDepth, actionNodes: ACTION_BOUNDS.maxValues,
} as const;
/** The session token of `welcome` and `resume`: 16 random bytes in lowercase hex (audit M3: anything else is refused before it is compared). */
export const SESSION_TOKEN = /^[0-9a-f]{32}$/;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

function checkVersions(x: unknown): string | null {
  if (!isRec(x)) return 'versions missing';
  if (!isInt(x['protocol'], 0, 1e6) || !isStr(x['engine'], 200) || !isInt(x['model'], 0, 1e6)) return 'versions malformed';
  if (x['build'] !== null && !isStr(x['build'], 128)) return 'engine build malformed';
  if (x['rulesPack'] !== null && !isStr(x['rulesPack'], 200)) return 'rules pack version malformed';
  return null;
}

export function checkDeckSubmission(x: unknown): string | null {
  if (!isRec(x) || !Array.isArray(x['main']) || !Array.isArray(x['sideboard'])) return 'decklist missing';
  if (x['commander'] !== undefined && !Array.isArray(x['commander'])) return 'decklist commander section malformed';
  if (x['companion'] !== undefined && !Array.isArray(x['companion'])) return 'decklist companion section malformed';
  const commander = (x['commander'] as unknown[] | undefined) ?? [];
  const companion = (x['companion'] as unknown[] | undefined) ?? [];
  const entries = [...(x['main'] as unknown[]), ...(x['sideboard'] as unknown[]), ...commander, ...companion];
  if (entries.length > LIMITS.deckEntries) return 'decklist too long';
  for (const e of entries) {
    if (!isRec(e) || !isStr(e['name'], LIMITS.cardName) || e['name'] === '' || hasControl(e['name']) || !isInt(e['count'], 1, LIMITS.copies)) return 'decklist entry malformed';
  }
  // Copies, not entries: repeated names add up.
  const total = (list: unknown[]) => list.reduce<number>((n, e) => n + ((e as Rec)['count'] as number), 0);
  const main = total(x['main'] as unknown[]);
  const side = total(x['sideboard'] as unknown[]);
  if (main > LIMITS.mainCards) return `decklist too long: too many cards (${main}; at most ${LIMITS.mainCards})`;
  if (side > LIMITS.sideboardCards) return `decklist too long: the sideboard has ${side} cards (at most ${LIMITS.sideboardCards})`;
  const commanders = total(commander);
  if (commanders > LIMITS.commanderCards) return `decklist malformed: ${commanders} commanders (at most ${LIMITS.commanderCards}: one, or two partners, CR 903.3, 702.124a)`;
  const companions = total(companion);
  if (companions > LIMITS.companionCards) return `decklist malformed: ${companions} companions (at most ${LIMITS.companionCards}, CR 702.139a)`;
  return null;
}

/**
 * Shape check of an Action from the network. The engine validates the rest (legality, decision answers, CR 733); `startGame` is internal to the
 * engine and never accepted. `setStops` is checked fully because the engine copies it into the state as it is. RPL-0: the check is the engine's
 * (`actionShapeProblem`, core/action-shape.ts), shared with the replay reader; the network also refuses any field the engine does not read (audit M4).
 */
export function checkAction(x: unknown): string | null {
  return actionShapeProblem(x, { exactFields: true });
}

/**
 * Validate a message from a guest. Its texts come back without control characters (text.ts). A message of another protocol version is refused with
 * `version`, and `peerVersion` (the version it named, when that is a small integer) lets the host answer in a message that version can read (M12-5a).
 */
export function parseGuestMessage(x: unknown): { ok: true; message: GuestToHostMessage } | { ok: false; error: string; version?: boolean; peerVersion?: number } {
  if (!isRec(x) || typeof x['type'] !== 'string') return { ok: false, error: 'not a message' };
  if (x['v'] !== PROTOCOL_VERSION) {
    const peer = isInt(x['v'], 1, 1000) ? { peerVersion: x['v'] } : {};
    return { ok: false, error: `different OpenMTG network protocols (host ${PROTOCOL_VERSION}, guest ${String(x['v'])}). ${SAME_OPENMTG}`, version: true, ...peer };
  }
  const bad = (error: string) => ({ ok: false as const, error });
  switch (x['type']) {
    case 'hello': {
      const problem = checkVersions(x['versions']) ?? checkDeckSubmission(x['deck']);
      if (problem) return bad(problem);
      if (!isStr(x['name'], LIMITS.name) || !isStr(x['proof'], 64)) return bad('hello malformed');
      if (x['resume'] !== undefined && !(typeof x['resume'] === 'string' && SESSION_TOKEN.test(x['resume']))) return bad('resume token malformed');
      return { ok: true, message: { ...(x as unknown as HelloMessage), name: cleanText(x['name']) } };
    }
    case 'action': {
      if (!isInt(x['id'], 0, Number.MAX_SAFE_INTEGER)) return bad('action id missing');
      if (!isInt(x['seq'], 0, Number.MAX_SAFE_INTEGER)) return bad('action seq missing');
      const problem = checkAction(x['action']);
      if (problem) return bad(problem);
      const m = x as unknown as ActionMessage;
      if (m.action.type !== 'setStops') return { ok: true, message: m };
      const { ownTurn, opponentTurn, fullControl, holdPriority } = m.action.stops;
      const stops = { ownTurn: normalizeSteps(ownTurn), opponentTurn: normalizeSteps(opponentTurn), fullControl, ...(holdPriority !== undefined ? { holdPriority } : {}) };
      return { ok: true, message: { ...m, action: { ...m.action, stops } } };
    }
    case 'chat':
      if (!isStr(x['text'], LIMITS.chat)) return bad('chat text too long');
      return { ok: true, message: { ...(x as unknown as ChatMessage), text: cleanText(x['text']) } };
    case 'bye':
      if (!isStr(x['reason'], 200)) return bad('bye malformed');
      return { ok: true, message: { ...(x as unknown as ByeMessage), reason: cleanText(x['reason']) } };
    case 'sync':
      return { ok: true, message: x as unknown as SyncMessage };
    case 'manualVote':
      if (!isInt(x['proposal'], 1, Number.MAX_SAFE_INTEGER) || typeof x['accept'] !== 'boolean') return bad('manual vote malformed');
      if (x['reason'] !== undefined && !isStr(x['reason'], LIMITS.chat)) return bad('manual vote reason too long');
      return {
        ok: true,
        message: { v: PROTOCOL_VERSION, type: 'manualVote', proposal: x['proposal'], accept: x['accept'], ...(x['reason'] !== undefined ? { reason: cleanText(x['reason'] as string) } : {}) },
      };
    case 'replayConsent':
      // RPL-3: one boolean; nothing else of the message is kept.
      if (typeof x['agree'] !== 'boolean') return bad('replay consent malformed');
      return { ok: true, message: { v: PROTOCOL_VERSION, type: 'replayConsent', agree: x['agree'] } };
    default:
      return bad(`unknown message type "${String(x['type'])}"`);
  }
}

// M6-11: 'special' (engine m6 design 2.3, D8: turning a face-down permanent face up, CR 116.2b). Without it every view that offered the guest a special
// action was refused as malformed, so a guest who controlled a face-down permanent it could turn face up never got the view (the same legal actions the
// host sends, nothing more). A table over the engine's kinds, so a kind the engine adds does not compile until it is listed here.
const LEGAL_KIND_TABLE: Record<LegalAction['kind'], true> = { pass: true, playLand: true, cast: true, activate: true, special: true, manualTrigger: true, manualStatic: true };
const LEGAL_KINDS: ReadonlySet<string> = new Set(Object.keys(LEGAL_KIND_TABLE));

function isLegalAction(x: unknown): boolean {
  return isRec(x) && isRec(x['action']) && typeof x['kind'] === 'string' && LEGAL_KINDS.has(x['kind']) && typeof x['label'] === 'string'
    && typeof x['isMana'] === 'boolean' && (x['object'] === undefined || typeof x['object'] === 'string');
}

/**
 * Light check of a message from the host (the host is trusted with the game, but a bug must not crash the guest). Texts the guest may print come
 * back without control characters (text.ts).
 */
export function parseHostMessage(x: unknown): HostMessage | null {
  if (!isRec(x)) return null;
  if (x['v'] !== PROTOCOL_VERSION) return otherVersionError(x);
  switch (x['type']) {
    case 'welcome': {
      const host = x['host'];
      if (!isStr(x['player'], 64) || !isStr(x['session'], 64) || !isRec(host) || !isStr(host['id'], 64) || typeof host['name'] !== 'string' || !strings(x['warnings'])) return null;
      if ((x['seat'] !== undefined && !isInt(x['seat'], 2, 4)) || (x['seats'] !== undefined && !isInt(x['seats'], 3, 4))) return null;
      const w = x as unknown as WelcomeMessage;
      return {
        ...w, host: { id: w.host.id, name: cleanText(w.host.name) }, warnings: w.warnings.map(cleanText),
        lastAction: isInt(x['lastAction'], 0, Number.MAX_SAFE_INTEGER) ? x['lastAction'] : 0,
      };
    }
    case 'lobby': {
      if (!isInt(x['seats'], 3, 4) || !Array.isArray(x['players']) || !x['players'].every(isSeatPlayer)) return null;
      const m = x as unknown as LobbyMessage;
      return { v: PROTOCOL_VERSION, type: 'lobby', seats: m.seats, players: m.players.map((p) => ({ id: p.id, name: cleanText(p.name), seat: p.seat, connected: p.connected })) };
    }
    case 'start': {
      if (!Array.isArray(x['players']) || !x['players'].every((p) => isRec(p) && isStr(p['id'], 64) && typeof p['name'] === 'string' && isInt(p['seat'], 1, 4))) return null;
      const m = x as unknown as StartMessage;
      return { v: PROTOCOL_VERSION, type: 'start', players: m.players.map((p) => ({ id: p.id, name: cleanText(p.name), seat: p.seat })) };
    }
    case 'presence': {
      const ok = (p: unknown) => isSeatPlayer(p) && (p['left'] === undefined || typeof p['left'] === 'boolean') && (p['forfeitInMs'] === undefined || isInt(p['forfeitInMs'], 0, 1e9));
      if (!Array.isArray(x['players']) || !x['players'].every(ok)) return null;
      const m = x as unknown as PresenceMessage;
      return {
        v: PROTOCOL_VERSION, type: 'presence',
        players: m.players.map((p) => ({
          id: p.id, name: cleanText(p.name), seat: p.seat, connected: p.connected, ...(p.left ? { left: true } : {}), ...(p.forfeitInMs !== undefined ? { forfeitInMs: p.forfeitInMs } : {}),
        })),
      };
    }
    case 'notice':
      return typeof x['kind'] === 'string' && NOTICE_KINDS.has(x['kind']) && isStr(x['player'], 64) && typeof x['text'] === 'string'
        ? { v: PROTOCOL_VERSION, type: 'notice', kind: x['kind'] as NoticeKind, player: x['player'], text: cleanText(x['text']) }
        : null;
    case 'manualProposal': {
      const p = x['proposal'];
      if (!isRec(p) || !isInt(p['id'], 1, Number.MAX_SAFE_INTEGER) || !isStr(p['player'], 64) || typeof p['sourceName'] !== 'string' || typeof p['text'] !== 'string') return null;
      if (!strings(p['lines']) || !strings(p['waiting'])) return null;
      const q = (x as unknown as ManualProposalMessage).proposal;
      return {
        v: PROTOCOL_VERSION, type: 'manualProposal',
        proposal: { id: q.id, player: q.player, sourceName: cleanText(q.sourceName), text: cleanText(q.text), lines: q.lines.map(cleanText), waiting: [...q.waiting] },
      };
    }
    case 'manualClosed': {
      if (!isInt(x['proposal'], 1, Number.MAX_SAFE_INTEGER) || typeof x['outcome'] !== 'string' || !OUTCOMES.has(x['outcome'])) return null;
      if ((x['by'] !== undefined && !isStr(x['by'], 64)) || (x['reason'] !== undefined && typeof x['reason'] !== 'string')) return null;
      const m = x as unknown as ManualClosedMessage;
      return {
        v: PROTOCOL_VERSION, type: 'manualClosed', proposal: m.proposal, outcome: m.outcome, ...(m.by !== undefined ? { by: m.by } : {}),
        ...(m.reason !== undefined ? { reason: cleanText(m.reason) } : {}),
      };
    }
    case 'view':
      return isInt(x['seq'], 0, Number.MAX_SAFE_INTEGER) && isRec(x['view']) && Array.isArray(x['events']) && Array.isArray(x['legal']) && x['legal'].every(isLegalAction)
        ? (x as unknown as ViewMessage)
        : null;
    case 'ack':
      return isInt(x['seq'], 0, Number.MAX_SAFE_INTEGER) && isInt(x['ref'], 0, Number.MAX_SAFE_INTEGER) ? (x as unknown as AckMessage) : null;
    case 'error': {
      if (typeof x['code'] !== 'string' || typeof x['message'] !== 'string' || (x['details'] !== undefined && !strings(x['details']))) return null;
      const e = x as unknown as ErrorMessage;
      return { ...e, message: cleanText(e.message), ...(e.details ? { details: e.details.map(cleanText) } : {}) };
    }
    case 'chat':
      return isStr(x['text'], LIMITS.chat) ? { ...(x as unknown as ChatMessage), text: cleanText(x['text']) } : null;
    case 'bye':
      return typeof x['reason'] === 'string' ? { ...(x as unknown as ByeMessage), reason: cleanText(x['reason']) } : null;
    case 'replayGame':
      // RPL-3: base64 text of at most REPLAY_GAME_MAX_BYTES of gzip; anything else is dropped (the guest keeps its own recording). What the text holds is
      // checked by the guest's browser as any replay file (engine readReplayFile: bounded expansion, the file's shape).
      return isReplayGameData(x['data']) ? { v: PROTOCOL_VERSION, type: 'replayGame', data: x['data'] } : null;
    default:
      return null;
  }
}

/**
 * RPL-3: whether `x` is the text of a `replayGame`: base64 (RFC 4648 section 4, padded to groups of four) of 1 to REPLAY_GAME_MAX_BYTES bytes. One pass
 * over the characters, no regular expression; never throws.
 */
export function isReplayGameData(x: unknown): x is string {
  if (typeof x !== 'string' || x.length === 0 || x.length > REPLAY_GAME_MAX_TEXT || x.length % 4 !== 0) return false;
  const pad = x.endsWith('==') ? 2 : x.endsWith('=') ? 1 : 0;
  for (let i = 0; i < x.length - pad; i++) {
    const c = x.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47; // A-Z a-z 0-9 + /
    if (!ok) return false;
  }
  return true;
}

const SAME_OPENMTG = 'Both players need the same OpenMTG version.';
const NOTICE_KINDS: ReadonlySet<string> = new Set<NoticeKind>(['joined', 'left', 'dropped', 'back', 'forfeited']);
const OUTCOMES: ReadonlySet<string> = new Set<ManualOutcome>(['applied', 'rejected', 'withdrawn', 'failed']);

function isSeatPlayer(p: unknown): p is Rec {
  return isRec(p) && isStr(p['id'], 64) && typeof p['name'] === 'string' && isInt(p['seat'], 1, 4) && typeof p['connected'] === 'boolean';
}

/**
 * M12-5a: an `error` from a host of another protocol version (a version-3 host refusing this guest's hello) is still read, so the player learns why: its
 * shape has not changed since version 1. Anything else of another version is dropped.
 */
function otherVersionError(x: Rec): ErrorMessage | null {
  if (x['type'] !== 'error' || !isInt(x['v'], 1, 1000) || typeof x['message'] !== 'string') return null;
  return {
    v: PROTOCOL_VERSION, type: 'error', code: 'version', fatal: x['fatal'] === true,
    message: `The host runs another OpenMTG version (network protocol ${x['v']}; this one speaks ${PROTOCOL_VERSION}). ${SAME_OPENMTG} (The host said: ${cleanText(x['message'])})`,
  };
}
