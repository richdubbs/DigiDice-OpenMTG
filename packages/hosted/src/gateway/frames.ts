/**
 * Frames from browsers (design 3.1, 6.1 step 1; review 2): text only; at most `MAX_FRAME_BYTES` (the `ws` server's `maxPayload` refuses bigger ones
 * first); nesting at most `MAX_FRAME_DEPTH`, measured on the text BEFORE `JSON.parse`; then strict per-type fields (`CLIENT_MESSAGE_FIELDS`: unknown
 * fields are refused) and value checks. Actions go through net's `checkAction` (64 KB, depth 12, 8,192 values, only the fields the engine reads) and
 * the hosted string check (`actionTextProblem`: no NUL, unpaired surrogate, control or bidi character anywhere; free text bounded). Decks through net's
 * `checkDeckSubmission` and the hosted text rules on every name.
 *
 * A frame that is not a message at all (binary, too large, too deep, not JSON, no known type, a missing or malformed command id) is FATAL: the
 * connection is closed (`CLOSE_PROTOCOL`), as nothing can be answered. A known command with bad fields is answered `badMessage` with its id (a strike).
 * Pure: no I/O, no clock; never throws.
 */
import { checkAction, checkDeckSubmission, jsonTextDepth } from '@openmtg/net/server-kit';
import {
  actionTextProblem, CLIENT_MESSAGE_FIELDS, HOSTED_LIMITS, hostedTextProblem, isHostedFormat, LOBBY_FILTER_FIELDS, MAX_FRAME_BYTES, MAX_FRAME_DEPTH,
  reportAttachmentsProblem, type HostedClientMessage, type HostedClientType, type HostedError,
} from '../api';

export type FatalFrame = 'binary' | 'frame' | 'depth' | 'json' | 'type' | 'id';

export type FrameResult =
  | { ok: true; msg: HostedClientMessage }
  | { ok: false; fatal: FatalFrame }
  | { ok: false; fatal: null; t: HostedClientType; id: number; error: HostedError };

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isInt = (x: unknown, min: number, max: number): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
/** Short opaque strings from browsers (table ids, ready-check ids, invite codes as typed). */
const isShort = (x: unknown, max = 64): x is string => typeof x === 'string' && x.length > 0 && x.length <= max && hostedTextProblem(x) === null;
/** Raw text bounded before any later check (names, titles, passwords, chat, reasons). */
const isText = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;

/** Table ids are ULIDs (and the store's `STORE_ID` charset). */
export const TABLE_ID = /^[0-9A-Za-z_-]{1,64}$/;

const bad = (t: HostedClientType, id: number, message: string): FrameResult => ({ ok: false, fatal: null, t, id, error: { code: 'badMessage', message } });

/** A frame's text as the `ws` library hands it over (a Buffer, an array of fragments, or a string from the in-process transport). */
export type FrameData = string | Buffer | ArrayBuffer | Buffer[];

function asBuffer(data: FrameData): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}

/** A deck's own fields and its entries' fields (unknown ones refused). The sections are main, sideboard, commander and (CMP1, CR 702.139a) companion. */
export function deckProblem(x: unknown): string | null {
  if (!isRec(x)) return 'The deck is missing.';
  for (const k of Object.keys(x)) if (k !== 'main' && k !== 'sideboard' && k !== 'commander' && k !== 'companion') return `Unknown deck field "${k.slice(0, 40)}".`;
  const shape = checkDeckSubmission(x);
  if (shape) return `The deck is malformed (${shape}).`;
  for (const part of ['main', 'sideboard', 'commander', 'companion'] as const) {
    const list = x[part];
    if (list === undefined) continue;
    for (const e of list as unknown[]) {
      const keys = Object.keys(e as object);
      if (keys.length !== 2 || !has(e as object, 'name') || !has(e as object, 'count')) return 'A deck entry has unknown fields.';
      if (hostedTextProblem((e as Rec)['name'] as string)) return 'A card name in the deck has a character that is not allowed.';
    }
  }
  return null;
}

function filterProblem(x: unknown): string | null {
  if (!isRec(x)) return 'The filter is malformed.';
  for (const k of Object.keys(x)) if (!(LOBBY_FILTER_FIELDS as readonly string[]).includes(k)) return 'The filter has unknown fields.';
  if (x['format'] !== undefined && !isHostedFormat(x['format'])) return 'Unknown format.';
  if (x['seats'] !== undefined && x['seats'] !== 2 && x['seats'] !== 3 && x['seats'] !== 4) return 'Seats must be 2, 3 or 4.';
  if (x['open'] !== undefined && typeof x['open'] !== 'boolean') return 'The filter is malformed.';
  if (x['locked'] !== undefined && typeof x['locked'] !== 'boolean') return 'The filter is malformed.';
  return null;
}

/** Checks one frame; see the module comment. */
export function parseFrame(data: FrameData, isBinary: boolean): FrameResult {
  if (isBinary) return { ok: false, fatal: 'binary' };
  const buf = asBuffer(data);
  if (buf.length > MAX_FRAME_BYTES) return { ok: false, fatal: 'frame' };
  // Depth on the text first: JSON.parse of a deeply nested frame costs the main thread, and later walks must not recurse (audit C4).
  if (jsonTextDepth(buf, MAX_FRAME_DEPTH) === null) return { ok: false, fatal: 'depth' };
  let x: unknown;
  try {
    x = JSON.parse(buf.toString('utf8'));
  } catch {
    return { ok: false, fatal: 'json' };
  }
  if (!isRec(x) || typeof x['t'] !== 'string' || !has(CLIENT_MESSAGE_FIELDS, x['t'])) return { ok: false, fatal: 'type' };
  const t = x['t'] as HostedClientType;
  const fields = CLIENT_MESSAGE_FIELDS[t];
  const needsId = (fields.required as readonly string[]).includes('id');
  if (needsId && !isInt(x['id'], 1, HOSTED_LIMITS.commandId)) return { ok: false, fatal: 'id' };
  const id = needsId ? (x['id'] as number) : 0;
  const allowed = new Set<string>([...fields.required, ...fields.optional]);
  for (const k of Object.keys(x)) if (!allowed.has(k)) return bad(t, id, `Unknown field "${k.slice(0, 40)}".`);
  for (const k of fields.required) if (!has(x, k)) return bad(t, id, `Missing field "${k}".`);
  const problem = valueProblem(t, x);
  if (problem) return bad(t, id, problem);
  return { ok: true, msg: x as unknown as HostedClientMessage };
}

function valueProblem(t: HostedClientType, x: Rec): string | null {
  switch (t) {
    case 'hello':
      if (!isInt(x['protocol'], 0, 1_000_000)) return 'The protocol must be a whole number.';
      if (x['token'] !== undefined && !isText(x['token'], 128)) return 'The token is malformed.';
      return isText(x['name'], 4096) ? null : 'The name must be text.';
    case 'browse':
      if (filterProblem(x['filter'])) return filterProblem(x['filter']);
      if (x['sort'] !== 'newest' && x['sort'] !== 'filled' && x['sort'] !== 'format') return 'Sort by newest, filled or format.';
      return isInt(x['page'], 0, 10_000) ? null : 'The page must be a whole number.';
    case 'watchLobby':
      return x['filter'] === null ? null : filterProblem(x['filter']);
    case 'create':
      if (!isHostedFormat(x['format'])) return 'Unknown format.';
      if (x['seats'] !== 2 && x['seats'] !== 3 && x['seats'] !== 4) return 'Seats must be 2, 3 or 4.';
      if (x['visibility'] !== 'listed' && x['visibility'] !== 'private') return 'Visibility must be listed or private.';
      if (x['title'] !== undefined && !isText(x['title'], 4096)) return 'The title must be text.';
      if (x['password'] !== undefined && !isText(x['password'], 4096)) return 'The password must be text.';
      return deckProblem(x['deck']);
    case 'join': {
      const byTable = x['table'] !== undefined;
      const byCode = x['code'] !== undefined;
      if (byTable === byCode) return 'Give exactly one of table and code.';
      if (byTable && !(typeof x['table'] === 'string' && TABLE_ID.test(x['table']))) return 'The table id is malformed.';
      if (byCode && !isShort(x['code'], 40)) return 'The invite code is malformed.';
      if (x['password'] !== undefined && (!byTable || !isText(x['password'], 4096))) return 'A password goes with a table id only.';
      return deckProblem(x['deck']);
    }
    case 'queue':
      if (!isHostedFormat(x['format'])) return 'Unknown format.';
      if (x['size'] !== 2 && x['size'] !== 'pod') return 'The size must be 2 or pod.';
      return deckProblem(x['deck']);
    case 'ready':
      return isShort(x['start']) ? null : 'The ready check id is malformed.';
    case 'act': {
      if (!isInt(x['seq'], 0, Number.MAX_SAFE_INTEGER)) return 'The action has no valid seq.';
      const shape = checkAction(x['action']);
      if (shape) return `The action is malformed (${shape}).`;
      const text = actionTextProblem(x['action']);
      return text ? text.message : null;
    }
    case 'vote':
      if (!isInt(x['proposal'], 1, HOSTED_LIMITS.commandId)) return 'The proposal id is malformed.';
      if (typeof x['accept'] !== 'boolean') return 'accept must be true or false.';
      if (x['reason'] !== undefined && !(isText(x['reason'], HOSTED_LIMITS.actionString) && hostedTextProblem(x['reason']) === null)) return 'The reason is malformed.';
      return null;
    case 'chat':
      return isText(x['text'], 4096) ? null : 'The message must be text.';
    case 'report': {
      if (x['kind'] !== 'bug' && x['kind'] !== 'title') return 'The report kind must be bug or title.';
      if (x['table'] !== undefined && !(typeof x['table'] === 'string' && TABLE_ID.test(x['table']))) return 'The table id is malformed.';
      if (!isText(x['text'], HOSTED_LIMITS.reportText) || hostedTextProblem(x['text']) !== null) return 'The report text is malformed or too long.';
      return reportAttachmentsProblem(x['attachments']);
    }
    case 'spectate':
      return x['table'] === undefined || (typeof x['table'] === 'string' && TABLE_ID.test(x['table'])) ? null : 'The table id is malformed.';
    case 'codes':
    case 'unqueue':
    case 'leave':
    case 'sync':
    case 'ping':
    case 'history':
      return null;
  }
}
