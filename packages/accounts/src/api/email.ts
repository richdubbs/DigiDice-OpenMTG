/**
 * M14-8: the email address grammar (design 3.4, 11.1 `emailProblem`), the same check in the browser and on the server. Browser-safe: no `node:`
 * imports, here or in anything this file imports. Exposed only through the named re-export at the end of ../api.ts (emailProblem); the server's
 * email part (src/email) imports EMAIL_RAW_MAX from this file directly, so both bound the typed text alike.
 * Imports: values only from ./limits (ACCOUNT_LIMITS) or files of this part's own; from ../api types only (`import type`). ../api re-exports this
 * file, so a value taken from ../api would be undefined while the contract loads (a cycle; test/m14-1/load.test.ts refuses one).
 *
 * An address is exactly one RFC 5322 addr-spec in its dot-atom form and nothing else. The checks, in this order (the first problem is the answer):
 *  1. `type`: not a string.
 *  2. `long`: more than EMAIL_RAW_MAX UTF-16 units as typed (checked before any other work).
 *  Then the text is trimmed (white space at both ends, String.prototype.trim), and every later rule reads the trimmed text.
 *  3. `nonAscii`: a character beyond ASCII. Internationalized addresses are refused in this milestone (adopted default 23).
 *  4. `long`: more than ACCOUNT_LIMITS.emailMax (254) characters.
 *  5. `syntax`: not one plain addr-spec: white space or a control character inside; a character that only RFC 5322's wider forms use (the angle
 *     brackets of a display name, the parentheses of a comment, the quotes and backslash of a quoted local part, the square brackets of an IP
 *     literal, the comma or semicolon of a list, the colon of a group or route); or not exactly one "@".
 *  6. `local`: the part before the "@" is not a dot-atom of 1-64 characters of ASCII letters, digits and !#$%&'*+/=?^_`{|}~- with dots never first,
 *     last or doubled.
 *  7. `domain`: the part after it is not 2 or more labels of ASCII letters, digits and hyphens, each 1-63 characters, never starting or ending with a
 *     hyphen, the last one not all digits (so no IP address and no trailing dot).
 * The answer's address is the stored form: trimmed, the domain lower-cased, the local part as typed (its case may matter to the receiving server).
 */
import type { EmailProblem } from '../api';
import { ACCOUNT_LIMITS } from './limits';

/** The most UTF-16 units an address may have as typed, before trimming: the address and some white space around it. */
export const EMAIL_RAW_MAX = ACCOUNT_LIMITS.emailMax + 64;

/** What each problem tells the player (no message repeats the address). */
export const EMAIL_PROBLEM_MESSAGES: Readonly<Record<EmailProblem, string>> = {
  type: 'An email address must be text.',
  long: `An email address can have at most ${ACCOUNT_LIMITS.emailMax} characters.`,
  syntax: 'Please enter one email address only, like name@example.org, without a name, spaces, quotes or brackets.',
  local: `The part before the @ can hold letters, digits and the characters !#$%&'*+/=?^_\`{|}~-, at most ${ACCOUNT_LIMITS.emailLocalMax} of them, with dots only between them.`,
  domain: 'The part after the @ must be a domain name, like example.org.',
  nonAscii: 'Email addresses with letters beyond A to Z are not supported yet.',
};

/** RFC 5322's atext besides letters and digits. */
const ATEXT_SYMBOLS = "!#$%&'*+/=?^_`{|}~-";
/** Printable ASCII that only the wider forms of RFC 5322 use: display names, comments, quoted strings, IP literals, lists, groups. */
const WIDER_SYNTAX = '()<>[]:;,\\"';

function isLetterOrDigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** A dot-atom of 1 to emailLocalMax characters (step 6). */
function localOk(local: string): boolean {
  if (local.length < 1 || local.length > ACCOUNT_LIMITS.emailLocalMax) return false;
  let previousDot = true; // a dot may not come first
  for (let i = 0; i < local.length; i++) {
    const c = local.charCodeAt(i);
    if (c === 0x2e) {
      if (previousDot) return false;
      previousDot = true;
      continue;
    }
    if (!isLetterOrDigit(c) && !ATEXT_SYMBOLS.includes(local[i]!)) return false;
    previousDot = false;
  }
  return !previousDot; // nor last
}

/** Two or more host-name labels, the last not all digits (step 7). */
function domainOk(domain: string): boolean {
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length < 1 || label.length > ACCOUNT_LIMITS.emailLabelMax) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    for (let i = 0; i < label.length; i++) {
      const c = label.charCodeAt(i);
      if (!isLetterOrDigit(c) && c !== 0x2d) return false;
    }
  }
  return !/^[0-9]+$/.test(labels[labels.length - 1]!);
}

function refused(problem: EmailProblem): { ok: false; problem: EmailProblem } {
  return { ok: false, problem };
}

/** 3.4's grammar: exactly one addr-spec; the stored form (trimmed, the domain lower-cased, the local part as typed). */
export function emailProblem(raw: unknown): { ok: true; address: string } | { ok: false; problem: EmailProblem } {
  if (typeof raw !== 'string') return refused('type');
  if (raw.length > EMAIL_RAW_MAX) return refused('long');
  const s = raw.trim();
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return refused('nonAscii');
  if (s.length > ACCOUNT_LIMITS.emailMax) return refused('long');
  let at = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // white space, C0 controls and DEL; the wider forms' characters; a second "@"
    if (c <= 0x20 || c === 0x7f || WIDER_SYNTAX.includes(s[i]!)) return refused('syntax');
    if (c === 0x40) {
      if (at >= 0) return refused('syntax');
      at = i;
    }
  }
  if (at < 0) return refused('syntax');
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!localOk(local)) return refused('local');
  if (!domainOk(domain)) return refused('domain');
  return { ok: true, address: `${local}@${domain.toLowerCase()}` };
}
