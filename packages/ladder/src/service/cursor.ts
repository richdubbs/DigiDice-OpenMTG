/**
 * M15-3: the read cursors (design 10.1, 10.2, 13.4 "Errors", 13.6). Server only. Opaque to the client: at most LADDER_LIMITS.cursorMax (200)
 * characters, checked strictly when they come back.
 *
 * - A leaderboard cursor is the keyset position of a page's last row (10.1): its key (the standing, or the final standing of a closed season), its
 *   season games and its sortKey (an account id, or a deleted row's 'deleted:' marker in a closed season, 8.7).
 * - A history cursor is the last entry's (endedAt, game) (10.2).
 *
 * **Sealed, not plain.** 10.1 writes the cursor as base64url of the triple. A page can end on a "Hidden player" row, whose sortKey is the account id
 * and whose games count is exactly what that row must not show (10.1, 10.3): a plain triple would hand both to whoever pages past it. So each cursor
 * is its kind's letter ('l' or 'h') and base64url of AES-256-GCM over the JSON of its fields, under a key derived from LadderConfig.secret, with a
 * synthetic IV (an HMAC of the fields): the same position always gives the same text, a changed byte never opens, and nothing of the position can be
 * read from it. Hosted checks the shape with the keyless `parseCursor` first and answers a bad one as `badMessage`; the service opens it with
 * `openCursor`, and a well-shaped cursor that does not open (tampered, or sealed under another secret) is refused with a LadderCursorError, which
 * hosted answers as `badMessage` too.
 */
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { ACCOUNT_ID_SHAPE, LADDER_LIMITS } from '../api';
import { isoMs } from '../api/season';
import { isDeletedSortKey } from '../ids';
import { secretKey } from './config';

export interface LeaderboardCursor { kind: 'leaderboard'; key: number; games: number; sortKey: string }
export interface HistoryCursor { kind: 'history'; endedAt: string; game: string }
export type LadderCursor = LeaderboardCursor | HistoryCursor;

/** A cursor the service cannot open: a RangeError, so callers that answer bad input as `badMessage` treat it like any other. */
export class LadderCursorError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'LadderCursorError';
  }
}

/** The keys of the cursors: one to encrypt, one to make the synthetic IV, both derived from LadderConfig.secret (never the dedupe key itself). */
export interface CursorKeys { readonly enc: Buffer; readonly iv: Buffer }

export function cursorKeys(secret: string): CursorKeys {
  const k = secretKey(secret);
  return {
    enc: createHmac('sha256', k).update('openmtg-ladder cursor encryption v1', 'utf8').digest(),
    iv: createHmac('sha256', k).update('openmtg-ladder cursor iv v1', 'utf8').digest(),
  };
}

/** A game id as the ledger keeps it (m13's store id rule: 1-64 characters of [0-9A-Za-z_-]). */
const GAME_ID = /^[0-9A-Za-z_-]{1,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PREFIX = { leaderboard: 'l', history: 'h' } as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function fieldsOf(c: LadderCursor): unknown[] {
  return c.kind === 'leaderboard' ? [PREFIX.leaderboard, c.key, c.games, c.sortKey] : [PREFIX.history, c.endedAt, c.game];
}

function isTime(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  try {
    isoMs(x);
    return true;
  } catch {
    return false;
  }
}

/** The cursor of these fields, or null when they are not a valid position (the same checks openCursor makes). */
function checked(j: unknown): LadderCursor | null {
  if (!Array.isArray(j)) return null;
  if (j.length === 4 && j[0] === PREFIX.leaderboard) {
    const [, key, games, sortKey] = j as unknown[];
    if (typeof key === 'number' && Number.isSafeInteger(key) && typeof games === 'number' && Number.isSafeInteger(games) && games >= 0
      && typeof sortKey === 'string' && (ACCOUNT_ID_SHAPE.test(sortKey) || isDeletedSortKey(sortKey))) {
      return { kind: 'leaderboard', key, games, sortKey };
    }
    return null;
  }
  if (j.length === 3 && j[0] === PREFIX.history) {
    const [, endedAt, game] = j as unknown[];
    if (isTime(endedAt) && typeof game === 'string' && GAME_ID.test(game)) return { kind: 'history', endedAt, game };
  }
  return null;
}

/** The text of a cursor (a position the service read: its fields are valid; a RangeError otherwise). */
export function sealCursor(keys: CursorKeys, c: LadderCursor): string {
  const fields = fieldsOf(c);
  if (checked(fields) === null) throw new RangeError(`sealCursor: not a valid ${c.kind} position`);
  const plain = Buffer.from(JSON.stringify(fields), 'utf8');
  const iv = createHmac('sha256', keys.iv).update(plain).digest().subarray(0, IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keys.enc, iv);
  const body = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const text = PREFIX[c.kind] + body.toString('base64url');
  if (text.length > LADDER_LIMITS.cursorMax) throw new RangeError('sealCursor: the cursor would be longer than LADDER_LIMITS.cursorMax');
  return text;
}

export function leaderboardCursor(keys: CursorKeys, p: { key: number; games: number; sortKey: string }): string {
  return sealCursor(keys, { kind: 'leaderboard', ...p });
}

export function historyCursor(keys: CursorKeys, p: { endedAt: string; game: string }): string {
  return sealCursor(keys, { kind: 'history', ...p });
}

/** The sealed bytes of a well-shaped cursor, or null. */
function shape(raw: unknown, kind?: LadderCursor['kind']): { kind: LadderCursor['kind']; body: Buffer } | null {
  if (typeof raw !== 'string' || raw.length < 2 || raw.length > LADDER_LIMITS.cursorMax) return null;
  const k = raw[0] === PREFIX.leaderboard ? 'leaderboard' : raw[0] === PREFIX.history ? 'history' : null;
  if (k === null || (kind !== undefined && k !== kind)) return null;
  const text = raw.slice(1);
  if (!BASE64URL.test(text)) return null;
  const body = Buffer.from(text, 'base64url');
  if (body.toString('base64url') !== text || body.length < IV_BYTES + TAG_BYTES + 2) return null;
  return { kind: k, body };
}

/**
 * Hosted's check before it calls a read (13.4 "Errors", 13.6): the kind of a well-shaped cursor (its letter, then canonical base64url of at least
 * the IV, the tag and two bytes, at most 200 characters in all), or null. Keyless: it cannot tell a tampered cursor from a good one; the read
 * refuses that one (LadderCursorError).
 */
export function parseCursor(raw: unknown, kind?: LadderCursor['kind']): LadderCursor['kind'] | null {
  return shape(raw, kind)?.kind ?? null;
}

/** The position in `raw`, or null when it is not a cursor this service sealed (of `kind`, when given), exactly as sealed. */
export function openCursor(keys: CursorKeys, raw: unknown, kind?: LadderCursor['kind']): LadderCursor | null {
  const s = shape(raw, kind);
  if (s === null) return null;
  let plain: Buffer;
  try {
    const iv = s.body.subarray(0, IV_BYTES);
    const tag = s.body.subarray(s.body.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', keys.enc, iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(s.body.subarray(IV_BYTES, s.body.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return null;
  }
  let j: unknown;
  try {
    j = JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
  const c = checked(j);
  if (c === null || c.kind !== s.kind) return null;
  // canonical: the position seals to exactly this text
  return sealCursor(keys, c) === raw ? c : null;
}
