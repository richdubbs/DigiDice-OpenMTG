/**
 * `@openmtg/hosted/api`: the browser-safe contract of the hosted game server (milestone 13; docs/design/m13-hosted-server.md sections 3, 4, 5, 7).
 *
 * The browser (the desktop app's page, from milestone 16 the web client) talks to the hosted server over one WebSocket (`HOSTED_SOCKET_PATH`) with the
 * messages below, as JSON text frames. Like `@openmtg/server/online` for milestone 9: types, plain constants and pure functions only; it imports nothing
 * but types from `@openmtg/engine` and the pure view-patch functions of `./api/patch` (checked by `tsconfig.api.json`, which compiles this file without
 * Node's types, and by `test/m13-1/browser-safe.test.ts`).
 *
 * Trust: the server checks everything a browser sends (frames, fields, strings, the seat's player, `seq`, legality: design 6.1); the browser applies
 * only what the server sends. Only views (`viewFor` for the receiving seat) and public data leave the server (design 6.3).
 */
import type { Action, CommanderVariant, GameEvent, GameResult, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { PatchOp } from './api/patch';

export * from './api/patch';
export * from './api/rope';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Connection

/** Version of these messages, in `hello` and `welcome`. A browser with another version is closed with `CLOSE_VERSION`. */
export const HOSTED_PROTOCOL = 1;
/** The WebSocket path on the gateway's HTTP server (design 3.1). `/metrics` is never on this server (design 10.2). */
export const HOSTED_SOCKET_PATH = '/ws';
export const HEALTH_PATH = '/healthz';
export const READY_PATH = '/readyz';

/** Largest frame the gateway accepts (the `ws` server's `maxPayload`), and the deepest nesting, checked on the text before `JSON.parse` (design 3.1). */
export const MAX_FRAME_BYTES = 256 * 1024;
export const MAX_FRAME_DEPTH = 24;

/** WebSocket close codes (4000-4999 are for applications, RFC 6455 section 7.4.2; design 3.1). */
export const CLOSE_REPLACED = 4001; // a second socket with the same token took over
export const CLOSE_PROTOCOL = 4002; // a binary frame, a malformed frame, no hello in time
export const CLOSE_STOPPING = 4003; // the server stops
export const CLOSE_REFUSED = 4004; // limits: too many sockets, strikes, the outbound budget
export const CLOSE_VERSION = 4005; // another protocol version
export type HostedCloseCode = typeof CLOSE_REPLACED | typeof CLOSE_PROTOCOL | typeof CLOSE_STOPPING | typeof CLOSE_REFUSED | typeof CLOSE_VERSION;

/** Times of the connection and the lobby, in milliseconds (design 3.1, 3.3, 3.4, 4.1, 4.4, 4.5, 4.6). */
export const HOSTED_TIMING = {
  /** `hello` must arrive within this time after the upgrade, else the socket closes (`CLOSE_PROTOCOL`). */
  helloMs: 5_000,
  /** The server pings every 20 s; a connection silent for 45 s is dead. */
  pingEveryMs: 20_000,
  deadAfterMs: 45_000,
  /** At most one full view per connection per 5 s answers `sync`; more are coalesced. */
  syncEveryMs: 5_000,
  /** `lobbyUpdate` batches at most once per second per connection; `queueStatus` at most once per 5 s. */
  lobbyUpdateEveryMs: 1_000,
  queueStatusEveryMs: 5_000,
  /** Ready checks: 30 s for listed and private tables, 15 s for matchmaking matches. */
  readyCheckTableMs: 30_000,
  readyCheckMatchMs: 15_000,
  /** An unstarted table expires 5 minutes after the last join by another player (design 4.1). */
  lobbyExpiryMs: 5 * 60_000,
  /** While nobody still in the game is connected, the game is void after 5 minutes (design 4.4). */
  abandonMs: 5 * 60_000,
  /** The table stays loaded after the end for "good game" chat (design 4.4). */
  lingerMs: 10 * 60_000,
  /**
   * M13-6 INTERFACE CHANGE (additive): a session with no connection for this long is gone for good as far as matchmaking is concerned (`MatchService.gone`:
   * its queue entry leaves). A shorter drop loses nothing: the entry keeps its place (design 4.5), as a seat keeps its table (3.3). The same five minutes
   * as a table's drop clock and abandonment.
   */
  goneAfterMs: 5 * 60_000,
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Guest session tokens (design D6, 3.2; review 10)

/**
 * A guest session token: 32 random bytes as 64 lowercase hex digits, issued by the server in `welcome`, kept by the browser (`localStorage`, one key per
 * server), sent only in `hello` (never in a URL or a cookie). The server stores only its SHA-256. Anything else is refused before any lookup. (Net's
 * 16-byte `SESSION_TOKEN` of milestone 9 is not used here.)
 */
export const HOSTED_TOKEN = /^[0-9a-f]{64}$/;
export const HOSTED_TOKEN_BYTES = 32;

export function isHostedToken(x: unknown): x is string {
  return typeof x === 'string' && x.length === 2 * HOSTED_TOKEN_BYTES && HOSTED_TOKEN.test(x);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The hosted text rules (design 6.1 step 1, 3.2, 4.2; review 2)

/**
 * Why a string is refused. Every string anywhere in a message from a browser (an action's values and keys, names, titles, passwords, chat, reports) is
 * refused when it holds:
 * - `nul`: U+0000 (PostgreSQL's text and jsonb refuse it: one such string would fail a whole group commit, review 2);
 * - `surrogate`: an unpaired UTF-16 surrogate (U+D800-U+DFFF not in a high-low pair; jsonb refuses those too, and they are not text);
 * - `bidi`: a bidirectional control (U+061C, U+200E-U+200F, U+202A-U+202E, U+2066-U+2069): text that reads other than it is;
 * - `control`: the rest of milestone 9's control set (`cleanText`: C0 U+0001-U+001F, DEL and C1 U+007F-U+009F, U+2028-U+2029).
 * Refused, not cleaned: what the server stores and shows is exactly what was sent.
 */
export type TextProblem = 'nul' | 'surrogate' | 'bidi' | 'control';

export const TEXT_PROBLEM_MESSAGES: Readonly<Record<TextProblem, string>> = {
  nul: 'The text contains a NUL character.',
  surrogate: 'The text contains a broken character (an unpaired surrogate).',
  bidi: 'The text contains a bidirectional control character.',
  control: 'The text contains a control character.',
};

/** The bidirectional controls (design 6.1). */
export function isBidiControl(c: number): boolean {
  return c === 0x061c || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
}

/** Milestone 9's control set (packages/net protocol/text.ts `cleanText`), NUL and the bidi controls included. */
export function isControlChar(c: number): boolean {
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || isBidiControl(c);
}

/** The first problem of `s` under the hosted text rules, or null. One pass over the UTF-16 code units; no regular expression. */
export function hostedTextProblem(s: string): TextProblem | null {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return 'nul';
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (d >= 0xdc00 && d <= 0xdfff) {
        i++;
        continue;
      }
      return 'surrogate';
    }
    if (c >= 0xdc00 && c <= 0xdfff) return 'surrogate';
    if (isBidiControl(c)) return 'bidi';
    if (isControlChar(c)) return 'control';
  }
  return null;
}

/** Characters (code points) of a string that passed `hostedTextProblem` (so every surrogate is paired). */
export function codePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
    n++;
  }
  return n;
}

/** Length limits, in characters (code points) unless named otherwise (design 3.2, 4.2, 4.3, 4.8, 6.1). */
export const HOSTED_LIMITS = {
  /** Display names: 1-40 after whitespace is collapsed, shown as "Name (guest)". */
  nameMin: 1,
  nameMax: 40,
  /** Table titles: 3-60 after whitespace is collapsed. */
  titleMin: 3,
  titleMax: 60,
  /** Table passwords: 4-64, taken as typed (not trimmed). */
  passwordMin: 4,
  passwordMax: 64,
  /** A chat line. */
  chat: 500,
  /** Every string in an action (UTF-16 code units): free text players type (a note, a manual token's text) is at most 500... */
  actionString: 500,
  /** ...and the names they type (`chooseName`, a manual token's name) at most 200 (the engine's own limit, core/validate.ts). */
  actionName: 200,
  /** Strings and keys of one action walked at most (`checkAction` bounds an action to 8,192 values first). */
  actionStrings: 16_384,
  /** A report's text, and its attachments in total (UTF-16 code units). */
  reportText: 10 * 1024,
  reportAttachments: 64 * 1024,
  reportAttachmentCount: 4,
  /** Listings per `browse` page. */
  browsePage: 50,
  /** Invite codes: 16 Crockford base32 characters (80 random bits; net's join codes), shown in groups of four. */
  inviteCode: 16,
  /** Command ids: positive integers up to this. */
  commandId: 2 ** 31 - 1,
} as const;

export type TextRefusal = TextProblem | 'invisible' | 'type' | 'short' | 'long' | 'word';
export type TextCheck = { ok: true; value: string } | { ok: false; reason: TextRefusal; message: string };

const refuse = (reason: TextRefusal, message: string): TextCheck => ({ ok: false, reason, message });

/** Runs of whitespace (any Unicode white space, line breaks included) as one space, and none at either end. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/gu, ' ').trim();
}

/** Bounds the raw string before any work on it (a frame is at most 256 KB anyway). */
const RAW_MAX = 4 * 1024;

// The visible-text rule of names and titles (M13-1 review). Code points as the running JavaScript engine's Unicode tables know them: the server's
// verdict is the one that counts (a browser may run older tables).
/** U+00AD, 034F, 115F-1160, 17B4-17B5, 180B-180F, 200B-200F, 2060-206F, 3164, FE00-FE0F, FEFF, FFA0, E0000-E0FFF. */
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const PRIVATE_OR_UNASSIGNED = /^[\p{Co}\p{Cn}]$/u;
const MARK = /^\p{M}$/u;
const SPACE = /^\s$/u;
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
/** At most this many combining marks in a row (no "Zalgo" text). */
export const MAX_COMBINING_MARKS = 2;

const isIgnorable = (cp: number): boolean => IGNORABLE.test(String.fromCodePoint(cp));
const isSpace = (cp: number): boolean => SPACE.test(String.fromCodePoint(cp));
/** A base character: not ignorable, not white space, not a combining mark. */
const isBase = (cp: number): boolean => !isIgnorable(cp) && !isSpace(cp) && !MARK.test(String.fromCodePoint(cp));

/**
 * The visible-text rule of names and titles (chat keeps only the hosted text rules). Refused (`'invisible'`) when the text holds a default-ignorable
 * code point, a private-use or unassigned one, U+FFF9-FFFB (interlinear annotation) or U+2800 (the blank braille pattern), with two exceptions that
 * real scripts and emoji need: U+200C/U+200D (zero-width non-joiner and joiner) only between two characters that are neither ignorable nor white space
 * (before a ZWJ, a base character followed by U+FE0F counts as that base: emoji ZWJ sequences such as ❤️‍🔥 and 🏳️‍🌈), and U+FE0E/U+FE0F (text and emoji presentation) only right after a base character. Also refused: more than `MAX_COMBINING_MARKS` combining marks in a
 * row, and text without any letter, digit, symbol or punctuation (`\p{L}`, `\p{N}`, `\p{S}`, `\p{P}`). Run it on a string that passed
 * `hostedTextProblem` (every surrogate paired).
 *
 * Not here: Unicode normalization (NFKC) and UTS #39 confusable skeletons ("Аlice" with a Cyrillic A). Display names are not unique in milestone 13
 * (guests are shown as "Name (guest)"); milestone 14's unique account names need both.
 */
export function invisibleTextProblem(s: string): 'invisible' | null {
  const cps = Array.from(s, (c) => c.codePointAt(0)!);
  let marks = 0;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    const ch = String.fromCodePoint(cp);
    if (MARK.test(ch)) {
      if (++marks > MAX_COMBINING_MARKS) return 'invisible';
    } else marks = 0;
    if (cp === ZWNJ || cp === ZWJ) {
      const ok = (x: number | undefined) => x !== undefined && !isIgnorable(x) && !isSpace(x);
      // An emoji presentation sequence (a base character + U+FE0F) counts as its base before a ZWJ: ❤️‍🔥, 🏳️‍🌈.
      const presentation = cp === ZWJ && cps[i - 1] === VS16 && cps[i - 2] !== undefined && isBase(cps[i - 2]!);
      if (!(ok(cps[i - 1]) || presentation) || !ok(cps[i + 1])) return 'invisible';
      continue;
    }
    if (cp === VS15 || cp === VS16) {
      const before = cps[i - 1];
      if (before === undefined || !isBase(before)) return 'invisible';
      continue;
    }
    if (isIgnorable(cp) || PRIVATE_OR_UNASSIGNED.test(ch) || (cp >= 0xfff9 && cp <= 0xfffb) || cp === 0x2800) return 'invisible';
  }
  return VISIBLE.test(s) ? null : 'invisible';
}

const INVISIBLE_MESSAGE = 'The text contains invisible or unassigned characters, or nothing visible.';

function checkLine(raw: unknown, what: string, min: number, max: number): TextCheck {
  if (typeof raw !== 'string') return refuse('type', `The ${what} must be text.`);
  if (raw.length > RAW_MAX) return refuse('long', `The ${what} is too long (at most ${max} characters).`);
  const problem = hostedTextProblem(raw);
  if (problem) return refuse(problem, TEXT_PROBLEM_MESSAGES[problem]);
  // On the raw text: collapsing whitespace would turn U+FEFF (white space to `\s`) into a plain space. Blank text is "too short" below.
  if (raw.trim() !== '' && invisibleTextProblem(raw)) return refuse('invisible', INVISIBLE_MESSAGE);
  const value = collapseWhitespace(raw);
  const n = codePoints(value);
  if (n < min) return refuse('short', min === 1 ? `The ${what} is empty.` : `The ${what} is too short (at least ${min} characters).`);
  if (n > max) return refuse('long', `The ${what} is too long (at most ${max} characters).`);
  return { ok: true, value };
}

/**
 * A display name (design 3.2): the text rules, the visible-text rule (`invisibleTextProblem`), whitespace collapsed, 1-40 characters. The word filter
 * (M13-8) is the server's own next step.
 */
export function checkName(raw: unknown): TextCheck {
  return checkLine(raw, 'name', HOSTED_LIMITS.nameMin, HOSTED_LIMITS.nameMax);
}

/**
 * A table title (design 4.2): the text rules, the visible-text rule (`invisibleTextProblem`), whitespace collapsed, 3-60 characters. The word filter
 * (M13-8) is the server's own next step.
 */
export function checkTitle(raw: unknown): TextCheck {
  return checkLine(raw, 'title', HOSTED_LIMITS.titleMin, HOSTED_LIMITS.titleMax);
}

/** The title of a table created without one (design 4.2). A name that passed `checkName` gives a title that passes `checkTitle`. */
export function defaultTitle(name: string): string {
  return `${name}'s table`;
}

/** A table password (design 4.3): the text rules, 4-64 characters, exactly as typed. Never logged, never sent to any client. */
export function checkPassword(raw: unknown): TextCheck {
  if (typeof raw !== 'string') return refuse('type', 'The password must be text.');
  if (raw.length > RAW_MAX) return refuse('long', `The password is too long (at most ${HOSTED_LIMITS.passwordMax} characters).`);
  const problem = hostedTextProblem(raw);
  if (problem) return refuse(problem, TEXT_PROBLEM_MESSAGES[problem]);
  const n = codePoints(raw);
  if (n < HOSTED_LIMITS.passwordMin) return refuse('short', `The password is too short (at least ${HOSTED_LIMITS.passwordMin} characters).`);
  if (n > HOSTED_LIMITS.passwordMax) return refuse('long', `The password is too long (at most ${HOSTED_LIMITS.passwordMax} characters).`);
  return { ok: true, value: raw };
}

/** A chat line: the text rules, at most 500 characters, not empty after trimming; line breaks are refused (they are controls). */
export function checkChat(raw: unknown): TextCheck {
  if (typeof raw !== 'string') return refuse('type', 'The message must be text.');
  if (raw.length > RAW_MAX) return refuse('long', `The message is too long (at most ${HOSTED_LIMITS.chat} characters).`);
  const problem = hostedTextProblem(raw);
  if (problem) return refuse(problem, TEXT_PROBLEM_MESSAGES[problem]);
  const value = raw.trim();
  if (!value) return refuse('short', 'The message is empty.');
  if (codePoints(value) > HOSTED_LIMITS.chat) return refuse('long', `The message is too long (at most ${HOSTED_LIMITS.chat} characters).`);
  return { ok: true, value };
}

/** Where in an action a string was refused (the path of keys and indexes; `key: true` when the key itself was refused), and why. */
export interface ActionTextRefusal {
  path: (string | number)[];
  key: boolean;
  reason: TextProblem | 'long' | 'tooLarge';
  message: string;
}

/** A step of the walk: its key or index and its parent (a path is built only for a refusal, so the walk stays linear in the action's size). */
interface WalkNode {
  seg: string | number;
  parent: WalkNode | null;
  depth: number;
}

function pathOf(n: WalkNode | null): (string | number)[] {
  const out: (string | number)[] = [];
  for (let x = n; x; x = x.parent) out.push(x.seg);
  return out.reverse();
}

/** Strings players type as names (design 6.1): `answer.name` of a `chooseName` answer, `answer.ops[i].name` of a manual `token` op. */
function isNameField(n: WalkNode | null): boolean {
  if (!n || n.seg !== 'name') return false;
  if (n.depth === 2) return n.parent!.seg === 'answer';
  if (n.depth === 4) return n.parent!.parent!.seg === 'ops' && n.parent!.parent!.parent!.seg === 'answer';
  return false;
}

/**
 * The string check of every action (design 6.1 step 1, review 2): each string anywhere in `action`, values and object keys, is refused if it breaks the
 * hosted text rules; strings are at most 500 UTF-16 code units, the names players type (`chooseName`, a manual token's name) at most 200. Iterative (an
 * explicit stack of parent-linked steps: linear in the action's size whatever its depth) and bounded by `HOSTED_LIMITS.actionStrings`; the gateway runs
 * net's `checkAction` (depth, values, size) first. Null: the action passes.
 */
export function actionTextProblem(action: unknown): ActionTextRefusal | null {
  const stack: { value: unknown; node: WalkNode | null }[] = [{ value: action, node: null }];
  let seen = 0;
  const tooLarge = (n: WalkNode | null): ActionTextRefusal => ({ path: pathOf(n), key: false, reason: 'tooLarge', message: 'The action is too large.' });
  while (stack.length) {
    const { value, node } = stack.pop()!;
    if (++seen > HOSTED_LIMITS.actionStrings) return tooLarge(node);
    const depth = node ? node.depth : 0;
    if (typeof value === 'string') {
      const problem = hostedTextProblem(value);
      if (problem) return { path: pathOf(node), key: false, reason: problem, message: TEXT_PROBLEM_MESSAGES[problem] };
      const max = isNameField(node) ? HOSTED_LIMITS.actionName : HOSTED_LIMITS.actionString;
      if (value.length > max) return { path: pathOf(node), key: false, reason: 'long', message: `A text in the action is too long (at most ${max} characters).` };
    } else if (Array.isArray(value)) {
      if (stack.length + value.length > HOSTED_LIMITS.actionStrings) return tooLarge(node);
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], node: { seg: i, parent: node, depth: depth + 1 } });
    } else if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      if (stack.length + keys.length > HOSTED_LIMITS.actionStrings) return tooLarge(node);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]!;
        const child: WalkNode = { seg: k, parent: node, depth: depth + 1 };
        if (++seen > HOSTED_LIMITS.actionStrings) return tooLarge(node);
        const problem = hostedTextProblem(k);
        if (problem) return { path: pathOf(child), key: true, reason: problem, message: TEXT_PROBLEM_MESSAGES[problem] };
        if (k.length > HOSTED_LIMITS.actionString) return { path: pathOf(child), key: true, reason: 'long', message: 'A key in the action is too long.' };
        stack.push({ value: (value as Record<string, unknown>)[k], node: child });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Formats, seats and clocks (design 4.1, 5.2)

/** Hosted formats (owner answer 10): 1v1 in every one; pods (3-4 seats, with `PODS_ENABLED`) in the Free-for-All Commander formats. */
export const HOSTED_FORMATS = [
  { id: 'standard', pods: false },
  { id: 'pioneer', pods: false },
  { id: 'modern', pods: false },
  { id: 'pauper', pods: false },
  { id: 'legacy', pods: false },
  { id: 'vintage', pods: false },
  { id: 'casual', pods: false },
  { id: 'duel', pods: false }, // Duel Commander stays two-player (M12)
  { id: 'commander', pods: true },
  { id: 'brawl', pods: true },
  { id: 'standardbrawl', pods: true },
] as const;
export type HostedFormatId = (typeof HOSTED_FORMATS)[number]['id'];

export function isHostedFormat(x: unknown): x is HostedFormatId {
  return typeof x === 'string' && HOSTED_FORMATS.some((f) => f.id === x);
}

/** Seats 1-4 (players p1-p4 in seating order); a table has 2, 3 or 4. */
export type SeatNumber = 1 | 2 | 3 | 4;
export type TableSize = 2 | 3 | 4;

/** The table sizes a format allows: 2 for a 1v1 format; 2, 3 or 4 for a pod format when pods are on (design 4.1). */
export function seatsAllowed(format: HostedFormatId, podsEnabled: boolean): TableSize[] {
  const f = HOSTED_FORMATS.find((x) => x.id === format)!;
  return f.pods && podsEnabled ? [2, 3, 4] : [2];
}

/** A table's clocks (design 5): the bank per player, the free delay per control period, the disconnect allowance per game (all in milliseconds). */
export interface ClockSettings {
  bankMs: number;
  delayMs: number;
  dropMs: number;
}

/** Owner answer 7 and 8: 15 minutes 1v1, 20 in pods, 5 s free per control period, 5 minutes of disconnects per game. `CLOCK_DEFAULTS` overrides. */
export const DEFAULT_CLOCKS: Readonly<Record<'1v1' | 'pod', ClockSettings>> = {
  '1v1': { bankMs: 15 * 60_000, delayMs: 5_000, dropMs: 5 * 60_000 },
  pod: { bankMs: 20 * 60_000, delayMs: 5_000, dropMs: 5 * 60_000 },
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Shared shapes

/** A decklist by Oracle names only (the same shape as `@openmtg/server/online`'s `OnlineDeck` and net's `DeckSubmission`; the server resolves it). */
export interface DeckLine {
  name: string;
  count: number;
}
export interface HostedDeck {
  main: DeckLine[];
  sideboard: DeckLine[];
  /** The commander section (one card, or two partners: CR 903.3, 702.124) in a Commander format; refused in any other. */
  commander?: DeckLine[];
  /** The companion section (CMP1, net's `DeckSubmission.companion`): at most one card (CR 702.139a), in any format. Absent: no companion. */
  companion?: DeckLine[];
}

export type TableVisibility = 'listed' | 'private';
/** How a table came to be: created listed or private, or made by matchmaking (never listed). */
export type TableSource = TableVisibility | 'matched';
export type TableStatus = 'lobby' | 'waitingCapacity' | 'readyCheck' | 'playing' | 'over';
/** A matchmaking queue's table size: 2 (1v1) or a pod (fills to 4, starts with 3 after a wait: design 4.5). */
export type QueueSize = 2 | 'pod';

export interface LobbyFilter {
  format?: HostedFormatId;
  seats?: TableSize;
  /** Only tables with an open seat. */
  open?: boolean;
  /** Only tables with (true) or without (false) a password. */
  locked?: boolean;
}
export type LobbySort = 'newest' | 'filled' | 'format';

/** One listed table in the lobby browser (design 4.2). Only unstarted listed tables are listed in milestone 13. */
export interface LobbyListing {
  table: string;
  title: string;
  format: HostedFormatId;
  variant: CommanderVariant | null;
  seats: TableSize;
  filled: number;
  /** A password is needed to sit. */
  locked: boolean;
  clock: ClockSettings;
  /** The creator's display name. */
  creator: string;
  /** Always false in milestone 13 (ranked games come only from the ranked queue, milestone 15). */
  ranked: false;
  /** When the table was created (server time, milliseconds since the epoch); the browser shows its age. */
  createdAt: number;
}

export interface SeatView {
  seat: SeatNumber;
  /** The player's display name; null for an open seat. */
  name: string | null;
  connected: boolean;
  /** The seat's deck passed the table's format check. */
  deckAccepted: boolean;
  /** Confirmed the running ready check. */
  ready: boolean;
  /** Left the game (conceded: CR 104.3a), in a pod that goes on. */
  left: boolean;
}

/** The table as a player may see it (design 3.4 `table`). Never another seat's deck, a password, a code or a session id. */
export interface TableView {
  table: string;
  title: string;
  format: HostedFormatId;
  variant: CommanderVariant | null;
  source: TableSource;
  status: TableStatus;
  seats: SeatView[];
  locked: boolean;
  clock: ClockSettings;
  /** This connection's seat, or null (not seated). */
  you: SeatNumber | null;
  /** The creator's seat (seat 1 for a created table; null for a matched one). */
  creator: SeatNumber | null;
  createdAt: number;
}

/** `queueStatus` (design 4.5, 4.6): a matchmaking queue (how many wait, rounded, never who) or the capacity queue (position and the units ahead). */
export type QueueStatus =
  | { kind: 'match'; format: HostedFormatId; size: QueueSize; waiting: number; estimatedWaitMs: number | null }
  | { kind: 'capacity'; table: string; position: number; unitsAhead: number; estimatedWaitMs: number | null };

/** A seat's clock (design 5): the bank left, whether it runs, the delay left in the current control period, the disconnect allowance left. */
export interface SeatClock {
  seat: SeatNumber;
  bankMs: number;
  running: boolean;
  delayMs: number;
  dropMs: number;
  /** The drop clock runs (the player is disconnected and someone in the game is connected). */
  dropRunning: boolean;
}

/** The clocks at server time `at` (sent when a clock starts or stops, never per second; the browser counts down itself). */
export interface ClockView {
  at: number;
  seats: SeatClock[];
  /** While nobody still in the game is connected: the time left before the game is void (design 4.4). */
  abandonMs?: number;
}

/** How a player lost (design 7): CR 104.3 and the server's own causes. */
export type LossCode =
  | 'life' // CR 104.3b, 704.5a
  | 'emptyLibrary' // CR 104.3c, 704.5b
  | 'poison' // CR 104.3d, 704.5c
  | 'commanderDamage' // CR 104.3j, 704.6c
  | 'effect' // CR 104.3e: an effect says the player loses
  | 'opponentWon' // CR 104.2b: another player won by an effect
  | 'concession' // CR 104.3a: the player conceded in game
  | 'left' // CR 104.3a: Leave (a concession that also left the table)
  | 'timeout' // design 5.1: the bank ran out (a concession by the table's rule)
  | 'disconnect' // design 5.3: the disconnect allowance ran out (a concession by the table's rule)
  | 'draw'; // CR 104.4a-c: the game was a draw while this player was still in it

export const LOSS_CODES: readonly LossCode[] = ['life', 'emptyLibrary', 'poison', 'commanderDamage', 'effect', 'opponentWon', 'concession', 'left', 'timeout', 'disconnect', 'draw'];

/**
 * A player's place as every player of the game may see it (design 7, review 7): never the session, the account, the deck fingerprint or the timing
 * details, which stay on the server (`Placement`, ledger/types.ts).
 */
export interface PublicPlacement {
  seat: SeatNumber;
  name: string;
  /** 1 = winner; players out at the same time share a place (four players, two out together first: 1, 2, 3, 3). */
  place: SeatNumber;
  loss: LossCode | null;
  lossRule: string | null;
  outTurn: number | null;
}

/** The fields of `PublicPlacement`, in order: everything else of a ledger placement is server-only. */
export const PUBLIC_PLACEMENT_KEYS = ['seat', 'name', 'place', 'loss', 'lossRule', 'outTurn'] as const satisfies readonly (keyof PublicPlacement)[];

export type GameOutcome = 'win' | 'draw' | 'void';

/**
 * A report's attachment (design 4.8): the client's view, its settings, or the client details of the bug-report item, as JSON text.
 *
 * NOTE for M13-13 (the bug inbox) and M13-4 (storage): store `json` as TEXT, never as jsonb. The text passes `hostedTextProblem` (no literal NUL or
 * unpaired surrogate), but JSON escapes such as a backslash-u0000 or a lone backslash-ud800 inside it are ordinary text until parsed, and PostgreSQL's jsonb refuses
 * them: a report stored as jsonb could fail its insert (review 2's case). Code that parses an attachment walks every string of the parsed value with
 * `hostedTextProblem` before storing any part of it in a jsonb column.
 */
export interface ReportAttachment {
  kind: 'view' | 'settings' | 'client';
  json: string;
}

export const REPORT_ATTACHMENT_KINDS = ['view', 'settings', 'client'] as const satisfies readonly ReportAttachment['kind'][];

/** The attachments of a report (design 4.8): at most 4, of the listed kinds, the text rules on their text, 64 KB in all. Null: they pass. */
export function reportAttachmentsProblem(x: unknown): string | null {
  if (x === undefined) return null;
  if (!Array.isArray(x) || x.length > HOSTED_LIMITS.reportAttachmentCount) return 'attachments malformed';
  let total = 0;
  for (const a of x) {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return 'attachment malformed';
    const keys = Object.keys(a);
    const { kind, json } = a as Record<string, unknown>;
    if (keys.length !== 2 || !(REPORT_ATTACHMENT_KINDS as readonly unknown[]).includes(kind) || typeof json !== 'string') return 'attachment malformed';
    total += json.length;
    if (total > HOSTED_LIMITS.reportAttachments) return 'attachments too large';
    const problem = hostedTextProblem(json);
    if (problem) return TEXT_PROBLEM_MESSAGES[problem];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Browser -> server (design 3.4). Every message but `hello` and `ping` has an `id` (a positive integer the browser picks, normally counting up) and
// gets exactly one `reply` with that id; an `act`'s reply comes after the view or patch of the change it caused (a resend of the seat's last applied
// id is answered without a change). Unknown fields are refused (`CLIENT_MESSAGE_FIELDS`).

export interface HelloMessage { t: 'hello'; protocol: number; token?: string; name: string }
export interface BrowseMessage { t: 'browse'; id: number; filter: LobbyFilter; sort: LobbySort; page: number }
export interface WatchLobbyMessage { t: 'watchLobby'; id: number; filter: LobbyFilter | null }
export interface CreateMessage {
  t: 'create'; id: number; format: HostedFormatId; seats: TableSize; visibility: TableVisibility; title?: string; password?: string; deck: HostedDeck;
}
/** Sit at a listed table (`table`, plus `password` when it is locked) or at a private table by an invite code (`code`): exactly one of `table`, `code`. */
export interface JoinMessage { t: 'join'; id: number; table?: string; password?: string; code?: string; deck: HostedDeck }
export interface CodesMessage { t: 'codes'; id: number }
export interface QueueMessage { t: 'queue'; id: number; format: HostedFormatId; size: QueueSize; deck: HostedDeck }
export interface UnqueueMessage { t: 'unqueue'; id: number }
export interface ReadyMessage { t: 'ready'; id: number; start: string }
export interface LeaveMessage { t: 'leave'; id: number }
export interface ActMessage { t: 'act'; id: number; seq: number; action: Action }
export interface VoteMessage { t: 'vote'; id: number; proposal: number; accept: boolean; reason?: string }
export interface SyncMessage { t: 'sync'; id: number }
export interface ChatMessage { t: 'chat'; id: number; text: string }
export interface ReportMessage { t: 'report'; id: number; kind: 'bug' | 'title'; table?: string; text: string; attachments?: ReportAttachment[] }
export interface PingMessage { t: 'ping' }
/**
 * M13-6 INTERFACE CHANGE (additive): this session's match history, newest first (at most 50 games of the last 90 days): the public projection of each
 * ledger record (ledger/history.ts `publicRecord`) and the session's own public placement. Answered in `reply.history`.
 */
export interface HistoryMessage { t: 'history'; id: number }
/** Reserved: refused with `notYet` (spectators come after milestone 15, owner answer 14). */
export interface SpectateMessage { t: 'spectate'; id: number; table?: string }

export type HostedClientMessage =
  | HelloMessage | BrowseMessage | WatchLobbyMessage | CreateMessage | JoinMessage | CodesMessage | QueueMessage | UnqueueMessage | ReadyMessage
  | LeaveMessage | ActMessage | VoteMessage | SyncMessage | ChatMessage | ReportMessage | PingMessage | SpectateMessage | HistoryMessage;
export type HostedClientType = HostedClientMessage['t'];

/** Each message's fields (the gateway refuses any other field: design 3.1). Pinned against the types by `test/m13-1/messages.test.ts`. */
export const CLIENT_MESSAGE_FIELDS = {
  hello: { required: ['t', 'protocol', 'name'], optional: ['token'] },
  browse: { required: ['t', 'id', 'filter', 'sort', 'page'], optional: [] },
  watchLobby: { required: ['t', 'id', 'filter'], optional: [] },
  create: { required: ['t', 'id', 'format', 'seats', 'visibility', 'deck'], optional: ['title', 'password'] },
  join: { required: ['t', 'id', 'deck'], optional: ['table', 'password', 'code'] },
  codes: { required: ['t', 'id'], optional: [] },
  queue: { required: ['t', 'id', 'format', 'size', 'deck'], optional: [] },
  unqueue: { required: ['t', 'id'], optional: [] },
  ready: { required: ['t', 'id', 'start'], optional: [] },
  leave: { required: ['t', 'id'], optional: [] },
  act: { required: ['t', 'id', 'seq', 'action'], optional: [] },
  vote: { required: ['t', 'id', 'proposal', 'accept'], optional: ['reason'] },
  sync: { required: ['t', 'id'], optional: [] },
  chat: { required: ['t', 'id', 'text'], optional: [] },
  report: { required: ['t', 'id', 'kind', 'text'], optional: ['table', 'attachments'] },
  ping: { required: ['t'], optional: [] },
  spectate: { required: ['t', 'id'], optional: ['table'] },
  history: { required: ['t', 'id'], optional: [] },
} as const satisfies Record<HostedClientType, { required: readonly string[]; optional: readonly string[] }>;

/** The fields of a lobby filter (unknown fields refused). */
export const LOBBY_FILTER_FIELDS = ['format', 'seats', 'open', 'locked'] as const satisfies readonly (keyof LobbyFilter)[];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Server -> browser (design 3.4)

/** Error codes of `reply`: milestone 9's (packages/net `NetErrorCode` subset) plus the hosted server's own (design 3.4). */
export const HOSTED_ERROR_CODES = [
  'badMessage', 'stale', 'illegalAction', 'notYourPlayer', 'notStarted', 'rateLimited', 'engineError', 'deckRejected', 'manualRejected', 'version',
  // the table has no open seat; the invite code or the password is wrong; the table does not exist (or is not for this session to see)
  'tableFull', 'badCode', 'badPassword', 'noTable',
  // the session already takes part in a game (seated, queued, waiting for capacity), or the deck pool is full
  'busy',
  // the capacity queue is full or the start waited too long: try again later (`retryAfterMs`)
  'serverBusy',
  'draining', 'limitReached', 'notYet', 'notAllowed',
] as const;
export type HostedErrorCode = (typeof HOSTED_ERROR_CODES)[number];

export interface HostedError {
  code: HostedErrorCode;
  message: string;
  /** CR citations of an engine refusal. */
  rules?: string[];
  /** Lines to list (a deck's problems). */
  details?: string[];
  retryAfterMs?: number;
}

/** What the server tells a new connection about itself. */
export interface ServerInfo {
  protocol: number;
  /** The engine build (games recover only under the same build: design D5). */
  engineBuild: string;
  /** The formats this server offers, with the table sizes allowed and the default clocks. */
  formats: { id: HostedFormatId; seats: TableSize[]; clock: ClockSettings }[];
  /** 'open': starts are admitted at once; 'queueing': new starts wait in the capacity queue; 'full': the capacity queue is full (`serverBusy`). */
  capacity: 'open' | 'queueing' | 'full';
}

/**
 * A notice's kinds (design 3.4), plus the lobby's own (M13-1 additions: tableClosed, tableExpired, readyCheckFailed, queueLost, capacityTimeout) and
 * M13-6's `cancelsUsed` (INTERFACE CHANGE, additive: the seat has used its cancels of this control period, CR 733.1, design 5.5; it was a
 * `limitWarning` before).
 */
export const NOTICE_KINDS = [
  'playerDropped', 'playerBack', 'playerLeft', 'timeout', 'forfeit', 'abandoning', 'serverDraining', 'degraded', 'voided', 'limitWarning',
  'tableClosed', 'tableExpired', 'readyCheckFailed', 'queueLost', 'capacityTimeout', 'cancelsUsed',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Another player's by-hand changes in words, as this seat may know the game (D12, CR 400.2); answer with `vote`. */
export interface ProposalView {
  id: number;
  seat: SeatNumber;
  /** The card being resolved by hand (on the stack: public), and its text. */
  sourceName: string;
  text: string;
  lines: string[];
}

export interface WelcomeMessage {
  t: 'welcome';
  /** A new session's token, minted by this hello; absent on a resume (the client keeps the token it sent: the server never echoes it back). */
  token?: string;
  /** The session id (public within this connection only; never the token). */
  session: string;
  name: string;
  resumed: boolean;
  table?: string;
  seat?: SeatNumber;
  queue?: QueueStatus;
  server: ServerInfo;
}
export type ReplyMessage =
  | {
      t: 'reply'; id: number; ok: true;
      /** `create` of a private table and `codes`: the invite codes of the open seats (formatted in groups of four; the server cannot show them again). */
      codes?: string[];
      /** `browse`: one page of listings, and how many match in all. */
      tables?: LobbyListing[];
      total?: number;
      /** `create`, `join`: the table. */
      table?: string;
      /** Deck warnings (what the format check could not check). */
      warnings?: string[];
      /** `history` (M13-6 INTERFACE CHANGE, additive): the session's games, newest first. */
      history?: HistoryEntryView[];
    }
  | { t: 'reply'; id: number; ok: false; error: HostedError };
/**
 * One game of a session's match history (`history`; M13-6 INTERFACE CHANGE, additive): ledger/history.ts `HistoryEntry` (the record's public
 * projection, `publicRecord`, and the session's own placement), pinned equal by test/m13-6. Never a session id, an account, a deck fingerprint or timings.
 */
export interface HistoryEntryView {
  game: string;
  format: string;
  variant: CommanderVariant | null;
  seats: TableSize;
  source: TableSource;
  ranked: boolean;
  outcome: GameOutcome;
  reason: string;
  turns: number;
  startedAt: string;
  endedAt: string;
  /** Best place first, ties in seat order. */
  placements: PublicPlacement[];
  /** This session's own place. */
  you: PublicPlacement;
}
export interface LobbyUpdateMessage { t: 'lobbyUpdate'; added: LobbyListing[]; changed: LobbyListing[]; removed: string[] }
export interface TableMessage { t: 'table'; table: TableView }
export interface QueueStatusMessage { t: 'queueStatus'; queue: QueueStatus }
export interface ReadyCheckMessage { t: 'readyCheck'; start: string; deadlineAt: number; players: { seat: SeatNumber; name: string; ready: boolean }[] }
/** The game starts: the players in seating order (M12-1's `StartMessage` shape: `players: { id, name, seat }[]`). */
export interface StartMessage { t: 'start'; table: string; players: { id: PlayerId; name: string; seat: SeatNumber }[] }
/**
 * The full view: `viewFor` for this seat only, the change's events redacted for this seat (net's `eventsFor`), this seat's legal priority actions.
 * `seq` (actions applied so far) only goes up.
 */
export interface ViewMessage { t: 'view'; seq: number; view: GameView; events: GameEvent[]; legal: LegalAction[] }
/** `ops` turn this seat's view of `base` into its view of `seq` (`applyViewPatch`). A browser without the view of `base` sends `sync`. */
export interface PatchMessage { t: 'patch'; seq: number; base: number; ops: PatchOp[]; events: GameEvent[]; legal: LegalAction[] }
export interface ClockMessage extends ClockView { t: 'clock' }
export interface ProposalMessage { t: 'proposal'; proposal: ProposalView }
export interface ProposalClosedMessage { t: 'proposalClosed'; proposal: number; outcome: 'approved' | 'rejected' | 'withdrawn' }
export interface NoticeMessage { t: 'notice'; kind: NoticeKind; seat?: SeatNumber; text: string }
export interface TableChatMessage { t: 'chat'; from: SeatNumber; text: string }
/** The end of the game: the engine's result (null for a void game), the outcome and its reason, and the public placements only (review 7). */
export interface ResultMessage { t: 'result'; outcome: GameOutcome; reason: string; result: GameResult | null; placements: PublicPlacement[] }
export interface ByeMessage { t: 'bye'; reason: string }
/**
 * M13-6 INTERFACE CHANGE (additive): the answer to `ping` (the browser's own heartbeat: it cannot see WebSocket pings), sent within the ping's limit (5 at once, then
 * 1 a second); a browser that sends a ping and hears no `pong` (or anything else) in a few seconds knows the socket is half open.
 */
export interface PongMessage { t: 'pong' }

export type HostedServerMessage =
  | WelcomeMessage | ReplyMessage | LobbyUpdateMessage | TableMessage | QueueStatusMessage | ReadyCheckMessage | StartMessage | ViewMessage | PatchMessage
  | ClockMessage | ProposalMessage | ProposalClosedMessage | NoticeMessage | TableChatMessage | ResultMessage | ByeMessage | PongMessage;
export type HostedServerType = HostedServerMessage['t'];
