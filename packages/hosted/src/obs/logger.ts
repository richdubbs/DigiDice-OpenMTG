/**
 * The structured logger (design 10.2, 6.3, 11; package M13-14): one JSON object per line on stdout, written by `StdoutLogger`; tests use `MemoryLogger`
 * (the same `formatLogLine`). Moved out of `../obs.ts`, which re-exports everything here, so every import of `./obs` is unchanged.
 *
 * Logs name games, seats and action types, never card names of hidden zones, decklists, tokens, passwords, invite codes, seeds or chat text
 * (design 6.3, 10.2). The logger enforces what it can, whatever the caller passes:
 * - fields whose key names a secret, a code, free text or a hidden zone (`isRedactedField`) are written as "[redacted]" (log an error code under
 *   `error`, a close code under `close`: keys ending in "code" are redacted);
 * - fields that name a client address are written as "[redacted]" in every event but a connection's (`isAddressField`): addresses live only in
 *   connection events, which are kept 14 days (design 10.2);
 * - every string value is scrubbed (`scrubLogText`) before it is cut and escaped: a session token or any other run of 64 hex digits, an invite code, a
 *   bearer token, the password of a URL, and the exact values of the configured secrets (`logScrubber`, `secretValuesOf`) become "[redacted]" even
 *   inside a free-text field such as an error message or a configuration warning;
 * - every string value is escaped (`escapeLogText`): control and bidi characters and unpaired surrogates that came from a client cannot rewrite a
 *   terminal or reorder a log line;
 * - values are flat (strings, numbers, booleans, null): no objects, so no action payload or view can be logged by accident.
 * Nothing here throws into the caller: a logger that cannot write drops the line.
 */
import { isBidiControl, isControlChar } from '../api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export type LogValue = string | number | boolean | null;
/** A log line's fields: flat values only. `game`, `seat`, `action` (the action's type) and `ms` are the common ones. */
export type LogFields = Readonly<Record<string, LogValue | undefined>>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line (a table's `game`, a worker's id). */
  child(fields: LogFields): Logger;
}

/**
 * Field keys are compared normalized: lowercase, everything but letters and digits removed ("invite_code", "Invite-Code" and "inviteCode" are all
 * "invitecode"). A key is redacted when it CONTAINS one of these (secrets and credentials; plurals included: "tokens", "passwords")...
 */
export const REDACTED_SUBSTRINGS = [
  'token', 'password', 'passwd', 'secret', 'salt', 'seed', 'cookie', 'authorization', 'auth', 'bearer', 'apikey', 'privatekey', 'credential',
  'databaseurl', 'dsn', 'invitecode', 'joincode', 'decklist',
] as const;
/** ...or IS or ENDS WITH one of these (codes, free text players type): "code", "codes", "errorCode", "reason", "voidReason", "title"... */
export const REDACTED_SUFFIXES = ['code', 'codes', 'reason', 'text', 'note', 'notes', 'title', 'chat', 'message', 'comment', 'body', 'words'] as const;
/** ...or IS one of these (decklists, hidden zones and the cards in them). */
export const REDACTED_FIELDS = ['deck', 'decks', 'hand', 'hands', 'library', 'libraries', 'cards', 'card', 'cardname', 'cardnames', 'sideboard'] as const;
/** Keys that name a client's address (normalized): logged in connection events only. */
export const ADDRESS_FIELDS = ['address', 'addr', 'ip', 'ipaddress', 'peer', 'remoteaddress', 'clientaddress', 'forwardedfor', 'xforwardedfor'] as const;

export function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isRedactedField(key: string): boolean {
  const k = normalizeFieldKey(key);
  return REDACTED_SUBSTRINGS.some((r) => k.includes(r)) || REDACTED_SUFFIXES.some((r) => k.endsWith(r)) || (REDACTED_FIELDS as readonly string[]).includes(k);
}

/** Whether `key` names a client's address (any spelling: "remote_address", "X-Forwarded-For"). */
export function isAddressField(key: string): boolean {
  return (ADDRESS_FIELDS as readonly string[]).includes(normalizeFieldKey(key));
}

/** The events that may carry a client address (their names start with "connection": `connectionOpen`, `connectionBehind`...). */
export function isConnectionEvent(event: string): boolean {
  return event.startsWith('connection');
}

/** A string safe for a log line: control and bidi characters and unpaired surrogates as `\u{...}` escapes; a backslash doubled. */
export function escapeLogText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
        continue;
      }
    }
    if (c === 0x5c) out += '\\\\';
    else if (isControlChar(c) || isBidiControl(c) || (c >= 0xd800 && c <= 0xdfff)) out += `\\u{${c.toString(16)}}`;
    else out += s[i]!;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Scrubbing values

/** What replaces a scrubbed value. */
export const REDACTED = '[redacted]';

/** A function from the text of a value to the text that may be logged. */
export type LogScrub = (text: string) => string;

// Any run of 64 or more hex digits: a guest session token (32 random bytes, `HOSTED_TOKEN`), `LEDGER_SECRET`, `METRICS_TOKEN`, a SHA-256 (token and
// invite hashes). Longer runs are caught as well: a secret that is part of a longer hex string is still there.
const HEX_RUN = /[0-9a-fA-F]{64,}/g;
// An invite code as the server shows it (net's `generateJoinCode`: 16 Crockford base32 characters in four groups), in any case, with dashes or spaces.
const INVITE_CODE = /(?<![0-9A-Za-z])[0-9A-HJKMNP-TV-Z]{4}(?:[- ][0-9A-HJKMNP-TV-Z]{4}){3}(?![0-9A-Za-z])/gi;
// "Bearer <credentials>" (an Authorization header that got into an error message).
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi;
// "scheme://user:password@host": the password of a connection string (DATABASE_URL) in an error message.
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*):[^\s@/]*@/gi;

/** The shapes of the secrets this server makes or reads, as text (no configured values needed): see the list above. */
export function scrubLogText(text: string): string {
  return text
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(URL_PASSWORD, `$1:${REDACTED}@`)
    .replace(HEX_RUN, REDACTED)
    .replace(INVITE_CODE, REDACTED);
}

/** Configured secrets shorter than this are not searched for (a short value would blank every line that happens to contain it). */
export const MIN_SECRET_LENGTH = 8;

/** The environment variables whose values are secrets (config.ts `SECRET_VARIABLES` and the accounts package's): never logged, in any field. */
export const SECRET_ENV_VARIABLES = ['DATABASE_URL', 'METRICS_TOKEN', 'LEDGER_SECRET', 'PASSWORD_PEPPERS', 'SHOPIFY_CLIENT_SECRET'] as const;

/** The secret values of an environment (for `logScrubber`): each secret variable's value and, for a URL, its password; each pepper's secret. */
export function secretValuesOf(env: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  for (const name of SECRET_ENV_VARIABLES) {
    const v = env[name]?.trim();
    if (!v) continue;
    out.push(v);
    if (name === 'DATABASE_URL') {
      try {
        const password = new URL(v).password;
        if (password) out.push(password, decodeURIComponent(password));
      } catch {
        // not a URL: the whole value is scrubbed
      }
    }
    if (name === 'PASSWORD_PEPPERS') {
      for (const entry of v.split(',')) {
        const colon = entry.indexOf(':');
        if (colon >= 0) out.push(entry.slice(colon + 1).trim());
      }
    }
  }
  return out;
}

/** A scrub function that also removes every occurrence of the exact values in `secrets` (longest first), then scrubs by shape. */
export function logScrubber(secrets: readonly string[] = []): LogScrub {
  const exact = [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort((a, b) => b.length - a.length);
  if (exact.length === 0) return scrubLogText;
  return (text) => {
    let out = text;
    for (const s of exact) if (out.includes(s)) out = out.split(s).join(REDACTED);
    return scrubLogText(out);
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Lines

/** Longest string value written (longer ones are cut, marked with "..."). */
export const LOG_VALUE_MAX = 300;

/**
 * One log line as JSON text: `{ time, level, event, ...fields }`, redacted, scrubbed and escaped. Pure. A string is scrubbed before it is cut (a secret
 * that straddles the cut never leaves a piece behind) and escaped last.
 */
export function formatLogLine(time: Date, level: LogLevel, event: string, fields: LogFields = {}, scrub: LogScrub = scrubLogText): string {
  const out: Record<string, LogValue> = { time: time.toISOString(), level, event: escapeLogText(scrub(event)) };
  const addresses = isConnectionEvent(event);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || k === 'time' || k === 'level' || k === 'event') continue;
    const key = escapeLogText(k);
    if (isRedactedField(k) || (!addresses && isAddressField(k))) out[key] = REDACTED;
    else if (typeof v === 'string') {
      const clean = scrub(v);
      out[key] = escapeLogText(clean.length > LOG_VALUE_MAX ? `${clean.slice(0, LOG_VALUE_MAX)}...` : clean);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[key] = v;
    else out[key] = '[not a flat value]';
  }
  return JSON.stringify(out);
}

/** The test double: lines kept in memory, formatted as the real logger formats them. */
export class MemoryLogger implements Logger {
  readonly lines: string[];

  constructor(
    private readonly base: LogFields = {},
    lines?: string[],
    private readonly clock: () => Date = () => new Date(),
    private readonly scrub: LogScrub = scrubLogText,
  ) {
    this.lines = lines ?? [];
  }

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    this.lines.push(formatLogLine(this.clock(), level, event, { ...this.base, ...fields }, this.scrub));
  }

  child(fields: LogFields): Logger {
    return new MemoryLogger({ ...this.base, ...fields }, this.lines, this.clock, this.scrub);
  }

  /** The lines parsed. */
  entries(): Record<string, LogValue>[] {
    return this.lines.map((l) => JSON.parse(l) as Record<string, LogValue>);
  }
}

export const NULL_LOGGER: Logger = { log: () => {}, child: () => NULL_LOGGER };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The process's logger

// An error on stdout (a closed pipe: EPIPE) is an 'error' event, which with no listener ends the process: it stops the output instead.
let stdoutBroken = false;
let stdoutGuarded = false;

function writeStdoutLine(line: string): void {
  if (stdoutBroken) return;
  if (!stdoutGuarded) {
    stdoutGuarded = true;
    process.stdout.on('error', () => {
      stdoutBroken = true;
    });
  }
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    stdoutBroken = true;
  }
}

/**
 * One JSON line per log entry on stdout (`formatLogLine`: redacted, scrubbed, escaped), lines below `level` dropped. `write` is the sink (stdout by
 * default; tests pass their own), `scrub` the value scrubber: by default it also removes the secret values of the process's own environment
 * (`secretValuesOf(process.env)`), whatever the field they are in.
 */
export class StdoutLogger implements Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly base: LogFields = {},
    private readonly write: (line: string) => void = writeStdoutLine,
    private readonly scrub: LogScrub = logScrubber(secretValuesOf(process.env)),
  ) {}

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.level)) return;
    try {
      this.write(formatLogLine(new Date(), level, event, { ...this.base, ...fields }, this.scrub));
    } catch {
      // a line that cannot be written is dropped: logging never breaks the caller
    }
  }

  child(fields: LogFields): Logger {
    return new StdoutLogger(this.level, { ...this.base, ...fields }, this.write, this.scrub);
  }
}
