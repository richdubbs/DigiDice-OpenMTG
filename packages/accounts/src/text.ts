/**
 * A NAMED COPY (design 11.8; owner M14-1) of milestone 13's text rules (`packages/hosted/src/api.ts`: `hostedTextProblem`, `invisibleTextProblem`,
 * `MAX_COMBINING_MARKS` and their helpers) and of its store rules for text and ids (`packages/hosted/src/store/rules.ts`: `STORE_ID`, `textProblem`,
 * `jsonbProblem`). Accounts imports no workspace package (D1), so it keeps these lines itself. At the sync M14-10 adds a test that pins each copy
 * against the original over a fixed list of inputs; a difference is reported, and the copy follows the original. Change nothing here but to follow it.
 *
 * Browser-safe (no `node:` imports): ./api/* may import it, and tsconfig.api.json compiles it then.
 *
 * The service applies these rules to every string it takes (names, passwords' raw form, report and appeal text, email addresses, notes), since in the
 * first wave no gateway does it first; every store refuses text with NUL or an unpaired surrogate ('value'), as m13's stores do.
 */

// ---- m13 src/api.ts: the hosted text rules (m13 design 6.1 step 1, 3.2, 4.2; review 2) ------------------------------------------------------

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

/** The bidirectional controls (m13 design 6.1). */
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

/** Runs of whitespace (any Unicode white space, line breaks included) as one space, and none at either end. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/gu, ' ').trim();
}

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
 * (before a ZWJ, a base character followed by U+FE0F counts as that base: emoji ZWJ sequences such as ❤️‍🔥 and 🏳️‍🌈), and U+FE0E/U+FE0F (text and
 * emoji presentation) only right after a base character. Also refused: more than `MAX_COMBINING_MARKS` combining marks in a row, and text without
 * any letter, digit, symbol or punctuation (`\p{L}`, `\p{N}`, `\p{S}`, `\p{P}`). Run it on a string that passed `hostedTextProblem` (every surrogate
 * paired).
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

// ---- m13 src/store/rules.ts: ids and text every store refuses (m13 design 8.1; review 2) -------------------------------------------------

/** Ids are 1-64 characters of `[0-9A-Za-z_-]` (ULIDs and the like): the mail and export files use them in file names, so every store refuses others. */
export const STORE_ID = /^[0-9A-Za-z_-]{1,64}$/;

/** NUL, or an unpaired surrogate: text PostgreSQL would refuse (NUL) or silently change (a lone surrogate becomes U+FFFD); null when neither. */
export function textProblem(s: string): 'nul' | 'surrogate' | null {
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
  }
  return null;
}

/**
 * The first string or key of a value (objects, arrays, strings; Dates and byte arrays skipped) that `textProblem` refuses, as "path: problem"; null
 * when none. A jsonb column refuses exactly these (the JSON escapes `\u0000` and an unpaired `\udXXX`).
 */
export function jsonbProblem(v: unknown, path = '$', depth = 0): string | null {
  if (depth > 256) return `${path}: nested too deep`;
  if (typeof v === 'string') {
    const p = textProblem(v);
    return p ? `${path}: ${p === 'nul' ? 'a NUL character' : 'an unpaired surrogate'}` : null;
  }
  if (v === null || typeof v !== 'object' || v instanceof Date || v instanceof Uint8Array) return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = jsonbProblem(v[i], `${path}[${i}]`, depth + 1);
      if (p) return p;
    }
    return null;
  }
  for (const [k, x] of Object.entries(v)) {
    const kp = textProblem(k);
    if (kp) return `${path}: a key with ${kp === 'nul' ? 'a NUL character' : 'an unpaired surrogate'}`;
    const p = jsonbProblem(x, `${path}.${k}`, depth + 1);
    if (p) return p;
  }
  return null;
}
