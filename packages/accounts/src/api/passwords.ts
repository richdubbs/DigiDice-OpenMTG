/**
 * M14-3: the password policy without the blocklist (design 4.2) and the recovery-code format (4.4). Browser-safe: no `node:` imports, here or in
 * anything this file imports. Exposed only through the named re-exports at the end of ../api.ts (passwordShapeProblem, normalizeRecoveryCode,
 * formatRecoveryCode); the server's policy (src/crypto/policy.ts) and recovery codes (src/crypto/tools.ts) import the other exports of this file
 * directly, so the browser and the server run the same rules.
 * Imports: values only from ./limits (ACCOUNT_LIMITS) and ../text (the text-rule copy, a leaf that imports nothing); from ../api types only
 * (`import type`). ../api re-exports this file, so a value taken from ../api would be undefined while the contract loads (test/m14-1/load.test.ts).
 *
 * The policy, in this order (the first problem found is the answer):
 *  1. `type`: not a string. `long`: more than ACCOUNT_LIMITS.passwordRawMax UTF-16 units as typed (checked before any other work).
 *  2. `character`: NUL, an unpaired surrogate or a control character (bidirectional controls included): m13's text rules (../text). No trimming;
 *     spaces and emoji are fine.
 *  3. `long` / `short`: more than ACCOUNT_LIMITS.passwordMax code points after NFKC, or fewer than the minimum, as typed or after NFKC (the
 *     smaller count: a character NFKC expands, such as U+FDFA's 18, is still one typed character, and combining marks NFKC joins still count once).
 *     The minimum is the server's (server.accounts.limits.passwordMin in the browser, PASSWORD_MIN on the server), never only the constant.
 *  Every later rule reads the NFKC, lower-cased form ("the form").
 *  4. `repeated`: the form is one character, or a block of up to 4 characters, repeated ("aaaaaaaaaaaa", "abababababab").
 *  5. `sequence` / `keyboard`: the form is made entirely of runs of at least 3 characters, each run one character repeated, a step through the
 *     alphabet or the digits (up or down: "abcdefghijkl", "123456789012", the digits wrapping 9 to 0 and the letters z to a), or a walk along one
 *     keyboard row (QWERTY, AZERTY and QWERTZ rows, shifted symbols read as their keys: "qwertyuiop[]", "asdfghjkl;'"). So "qwerty123456" and
 *     "abc123def456" are refused; a passphrase is not. The answer is `repeated` when every run repeats one character, else the kind of the
 *     longest run that does not (`keyboard` for a row walk, `sequence` for a step through the alphabet or the digits).
 *  6. `containsName` / `containsEmail`: the form equals or contains the name (also without its separators, or with other separators where it has
 *     them) or, on the server, its canonical key, or the email's local part (also without a "+tag"), when that is 4 characters or more; a shorter
 *     one only with nothing but digits, separators or one repeated character added ("bob123456789"). The password's own separators are kept: a
 *     name is not found across two of its words ("Sean" in "the sea nymph").
 *  7. `context`: "openmtg", "digidice" or "magicthegathering" (separators ignored: "Magic: The Gathering") with nothing but digits or one repeated
 *     character added ("openmtg2026", "digidice!!!!").
 *  8. `common` (server only, src/crypto/policy.ts): the form is on the blocklist (4.3).
 * No composition rules, no forced changes, no hints (4.2).
 */
import type { ClientLimits, PasswordProblem } from '../api';
import { ACCOUNT_LIMITS } from './limits';
import { hostedTextProblem } from '../text';

// ---- The form ----------------------------------------------------------------------------------------------------------------------------------

/** NFKC, lower-cased: the form every rule after the length reads (4.2). Run it on text that passed the text rules. */
export function passwordForm(password: string): string {
  return password.normalize('NFKC').toLowerCase();
}

/** Code points of a string whose surrogates are paired. */
function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
    n++;
  }
  return n;
}

/** The separators a name or a context word may be written with, ignored when the rules look for one inside a password. */
const SEPARATOR = String.raw`[\s_\-.:'’]`;
const SEPARATORS = new RegExp(SEPARATOR, 'gu');
const SEPARATOR_RUNS = new RegExp(`${SEPARATOR}+`, 'gu');
function squeeze(s: string): string {
  return s.replace(SEPARATORS, '');
}
/** Every run of separators as one space: "Ann-Lee" and "ann  lee" read alike, and no two words of the text are joined. */
function spaced(s: string): string {
  return s.replace(SEPARATOR_RUNS, ' ');
}

// ---- Rule 4: a short block repeated ------------------------------------------------------------------------------------------------------------

/** The largest block that counts as "one character repeated" in a wider sense ("abababababab"). */
const REPEAT_BLOCK_MAX = 4;

function repeatsBlock(cps: readonly number[]): boolean {
  for (let period = 1; period <= REPEAT_BLOCK_MAX && period < cps.length; period++) {
    let ok = true;
    for (let i = period; i < cps.length && ok; i++) ok = cps[i] === cps[i - period];
    if (ok) return true;
  }
  return false;
}

// ---- Rule 5: runs ------------------------------------------------------------------------------------------------------------------------------

/** Keyboard rows, unshifted, lower case (QWERTY; then AZERTY's and QWERTZ's rows that differ). */
const KEYBOARD_ROWS: readonly string[] = [
  '`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./',
  'azertyuiop', 'qsdfghjklm', 'wxcvbn',
  'qwertzuiop', 'yxcvbnm',
];
/** Shifted symbols read as their keys (US layout). */
const SHIFTED: Readonly<Record<string, string>> = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
};
/** For each key, its (row, position) pairs. */
const KEY_POSITIONS: ReadonlyMap<string, readonly (readonly [number, number])[]> = (() => {
  const m = new Map<string, [number, number][]>();
  KEYBOARD_ROWS.forEach((row, r) => {
    Array.from(row).forEach((k, i) => {
      const list = m.get(k) ?? [];
      list.push([r, i]);
      m.set(k, list);
    });
  });
  return m;
})();

/** The relation names of a pair of neighbouring characters: what a run may keep doing from one character to the next. */
function relations(a: number, b: number): string[] {
  const out: string[] = [];
  if (a === b) out.push('same');
  const step = (lo: number, hi: number, wrap: boolean, tag: string) => {
    if (a < lo || a > hi || b < lo || b > hi) return;
    const size = hi - lo + 1;
    const d = (b - a + size) % size;
    if (d === 1 && (wrap || b > a)) out.push(`${tag}+`);
    if (d === size - 1 && (wrap || b < a)) out.push(`${tag}-`);
  };
  step(0x30, 0x39, true, 'digit'); // 0-9, 9 wraps to 0 ("1234567890")
  step(0x61, 0x7a, true, 'latin'); // a-z
  step(0x3b1, 0x3c9, false, 'greek'); // α-ω
  step(0x430, 0x44f, false, 'cyrillic'); // а-я
  const ka = String.fromCodePoint(a), kb = String.fromCodePoint(b);
  const pa = KEY_POSITIONS.get(SHIFTED[ka] ?? ka), pb = KEY_POSITIONS.get(SHIFTED[kb] ?? kb);
  if (pa && pb) {
    for (const [ra, ia] of pa) {
      for (const [rb, ib] of pb) {
        if (ra !== rb) continue;
        if (ib === ia + 1) out.push(`row${ra}+`);
        if (ib === ia - 1) out.push(`row${ra}-`);
      }
    }
  }
  return out;
}

type RunKind = 'repeated' | 'sequence' | 'keyboard';
function runKind(rel: string): RunKind {
  return rel === 'same' ? 'repeated' : rel.startsWith('row') ? 'keyboard' : 'sequence';
}

/** The shortest run that counts in rule 5. */
const RUN_MIN = 3;

/**
 * Whether the form is made entirely of runs of RUN_MIN or more characters, and the kind to answer. A run keeps one relation (and one direction)
 * from its first character to its last; the cover is found by dynamic programming over the at most 128 code points (a few thousand steps).
 */
function runCover(cps: readonly number[]): RunKind | null {
  const n = cps.length;
  if (n < RUN_MIN) return null;
  const pairs: string[][] = [];
  for (let i = 0; i + 1 < n; i++) pairs.push(relations(cps[i]!, cps[i + 1]!));
  // best[e]: one run [from, e) of a cover of [0, e), with the first relation it keeps throughout
  const best: ({ from: number; rel: string } | null)[] = new Array<{ from: number; rel: string } | null>(n + 1).fill(null);
  const covered: boolean[] = new Array<boolean>(n + 1).fill(false);
  covered[0] = true;
  for (let j = 0; j < n; j++) {
    if (!covered[j]) continue;
    let live = pairs[j] ?? [];
    for (let e = j + 2; e <= n && live.length > 0; e++) {
      // [j, e) holds e - j characters and e - j - 1 pairs, the pairs j .. e - 2
      if (e - j - 1 > 1) live = live.filter((r) => pairs[e - 2]!.includes(r));
      if (live.length === 0) break;
      if (e - j >= RUN_MIN && !covered[e]) {
        covered[e] = true;
        best[e] = { from: j, rel: live[0]! };
      }
    }
  }
  if (!covered[n]) return null;
  // walk back over the cover: 'repeated' only when every run repeats one character, else the kind of the longest other run
  let longest: { len: number; kind: RunKind } | null = null;
  for (let e = n; e > 0; ) {
    const b = best[e]!;
    const kind = runKind(b.rel);
    const len = e - b.from;
    if (kind !== 'repeated' && (longest === null || len >= longest.len)) longest = { len, kind };
    e = b.from;
  }
  return longest === null ? 'repeated' : longest.kind;
}

// ---- Rules 6 and 7: words inside the password --------------------------------------------------------------------------------------------------

/** The context words of 4.2 (rule 7), in the form (lower case, no separators). The blocklist generator adds them to the blocklist too (4.3). */
export const PASSWORD_CONTEXT_WORDS: readonly string[] = ['openmtg', 'digidice', 'magicthegathering'];

/** The length from which a name or an email local part is refused anywhere inside a password (rule 6). */
const CONTAINS_MIN = 4;

/** `s` with every `word` taken out is empty, only digits, or one character repeated. */
function onlyPaddingAround(s: string, word: string): boolean {
  if (word.length === 0 || !s.includes(word)) return false;
  const rest = s.split(word).join('');
  if (rest === '' || /^[0-9]+$/.test(rest)) return true;
  const cps = Array.from(rest);
  return cps.every((c) => c === cps[0]);
}

/**
 * Rule 6 for one word (the name, its key or the email local part), in the form. A word of CONTAINS_MIN or more is looked for in the password as
 * typed: written as it is (or with other separators where it has them), or without its separators. The password's own separators are kept, so a
 * name is never found across two words of a passphrase ("Sean" in "the sea nymph"; review of M14-3). Only the padding test squeezes the password,
 * where separators count as padding ("bob 1234 5678").
 */
function containsWord(form: string, word: string): boolean {
  const w = passwordForm(word);
  const ws = squeeze(w);
  if (ws === '') return false;
  if (cpLength(ws) >= CONTAINS_MIN && (spaced(form).includes(spaced(w)) || form.includes(ws))) return true;
  return onlyPaddingAround(squeeze(form), ws);
}

// ---- The policy --------------------------------------------------------------------------------------------------------------------------------

/**
 * Rules 1 to 7 (everything but the blocklist), shared by the browser (passwordShapeProblem) and the server (CredentialTools.passwordProblem, which
 * adds the name's canonical key and the blocklist). `min` is the minimum in code points after NFKC.
 */
export function passwordRuleProblem(
  password: unknown,
  ctx: { name: string | null; key?: string | null; emailLocal: string | null },
  min: number,
): PasswordProblem | null {
  if (typeof password !== 'string') return 'type';
  if (password.length > ACCOUNT_LIMITS.passwordRawMax) return 'long';
  if (hostedTextProblem(password) !== null) return 'character';
  const nfkc = password.normalize('NFKC');
  if (hostedTextProblem(nfkc) !== null) return 'character';
  const n = cpLength(nfkc);
  if (n > ACCOUNT_LIMITS.passwordMax) return 'long';
  // the minimum counts what was typed as well: one character NFKC expands ("ﷺ" gives 18) is still one character (review of M14-3)
  if (Math.min(n, cpLength(password)) < min) return 'short';
  const form = nfkc.toLowerCase();
  const cps = Array.from(form, (c) => c.codePointAt(0)!);
  if (repeatsBlock(cps)) return 'repeated';
  const run = runCover(cps);
  if (run !== null) return run;
  const names = [ctx.name, ctx.key ?? null].filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (names.some((w) => containsWord(form, w))) return 'containsName';
  if (typeof ctx.emailLocal === 'string' && ctx.emailLocal.length > 0) {
    const local = ctx.emailLocal;
    const plus = local.indexOf('+');
    const words = plus > 0 ? [local, local.slice(0, plus)] : [local];
    if (words.some((w) => containsWord(form, w))) return 'containsEmail';
  }
  const squeezed = squeeze(form);
  if (PASSWORD_CONTEXT_WORDS.some((w) => onlyPaddingAround(squeezed, w))) return 'context';
  return null;
}

/** A minimum the server sent, if it is a usable one; otherwise ACCOUNT_LIMITS.passwordMin. */
function minimumOf(limits: Pick<ClientLimits, 'passwordMin'> | undefined): number {
  const m = limits?.passwordMin;
  return typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= ACCOUNT_LIMITS.passwordMax ? m : ACCOUNT_LIMITS.passwordMin;
}

/** 4.2 without the blocklist (the browser's check); `limits` from server.accounts.limits, ACCOUNT_LIMITS.passwordMin (./limits) when absent. */
export function passwordShapeProblem(
  password: unknown,
  ctx: { name: string | null; emailLocal: string | null },
  limits?: Pick<ClientLimits, 'passwordMin'>,
): PasswordProblem | null {
  const c = typeof ctx === 'object' && ctx !== null ? ctx : { name: null, emailLocal: null };
  return passwordRuleProblem(password, { name: c.name, emailLocal: c.emailLocal }, minimumOf(limits));
}

// ---- Recovery codes (4.4): a named copy of net's join-code alphabet and look-alike map (design 11.8; packages/net/src/wire/codes.ts) -----------

/** Crockford base32: no I, L, O, U (net's ALPHABET). */
export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 characters of 5 bits from 10 bytes, most significant bits first (net's randomCode, with the bytes passed in). */
export function recoveryCodeFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 10) throw new RangeError('a recovery code takes exactly 10 bytes (80 bits)');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += RECOVERY_ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/**
 * 4.4: 16 characters with look-alikes mapped (also used for CONFIRM_CODE's 8), or null. As net's normalizeJoinCode: case, white space and dashes
 * are ignored, O reads as 0, I and L as 1; the result must be 16 (a recovery code) or 8 (a provider confirmation code) characters of the alphabet.
 * Input longer than ACCOUNT_LIMITS.recoveryRawMax answers null before any work.
 */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > ACCOUNT_LIMITS.recoveryRawMax) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== ACCOUNT_LIMITS.recoveryCodeLength && s.length !== ACCOUNT_LIMITS.confirmCodeLength) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}

/** 4.4: in groups of four ("7KQ2-M9XD-4TRB-HC8P"); a typed code is normalized first when it can be. */
export function formatRecoveryCode(code: string): string {
  const s = normalizeRecoveryCode(code) ?? String(code);
  return (s.match(/.{1,4}/gu) ?? []).join('-');
}
