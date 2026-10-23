/**
 * M14-2: an account name's display form (design 6.1). Browser-safe: no `node:` imports, here or in anything this file imports. Exposed only through
 * the named re-export at the end of ../api.ts (checkAccountName); the other exports of this file are for the server's names part (src/names).
 * Imports: values only from ./limits (ACCOUNT_LIMITS) and from ../text (M14-1's leaf copy of m13's text rules, MAX_COMBINING_MARKS, 11.8); from
 * ../api types only (`import type`). ../api re-exports this file, so a value taken from ../api would be undefined while the contract loads (a cycle;
 * test/m14-1/load.test.ts refuses one).
 *
 * Every class below is read from the running JavaScript engine's Unicode tables (`\p{...}` in regular expressions), as m13's `invisibleTextProblem`
 * does: a browser may run older tables than the server, and the server's verdict is the one that counts (6.1).
 */
import type { NameProblem } from '../api';
import { ACCOUNT_LIMITS } from './limits';
import { collapseWhitespace, MAX_COMBINING_MARKS } from '../text';

/** The five separators of an account name (6.1), also dropped by the canonical key (6.3 step 2.5). */
export const ACCOUNT_NAME_SEPARATORS = " _-.'";

/** What each problem tells the player (shown as they type; no problem repeats the name). */
export const NAME_PROBLEM_MESSAGES: Readonly<Record<NameProblem, string>> = {
  type: 'A name must be text.',
  short: `A name needs at least ${ACCOUNT_LIMITS.nameMin} characters.`,
  long: `A name can have at most ${ACCOUNT_LIMITS.nameMax} characters.`,
  character: "A name can hold only letters, the digits 0-9, spaces and the characters _ - . '",
  separator: "Spaces and the characters _ - . ' cannot start or end a name, or come twice in a row of them.",
  noLetter: 'A name needs at least one letter.',
  marks: `Accents and other marks must follow a letter, at most ${MAX_COMBINING_MARKS} in a row.`,
  scripts: 'A name must be written in one script (Latin may be mixed with Chinese, Japanese or Korean); a right-to-left name starts with a letter.',
};

const LETTER = /^\p{L}$/u;
const MARK = /^\p{M}$/u;
const DIGIT = /^[0-9]$/;
/** Default-ignorable code points are invisible even when they are letters or marks (U+115F, U+1160, U+3164 and U+FFA0 are Lo; U+034F is Mn). */
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const isSeparator = (ch: string): boolean => ch.length === 1 && ACCOUNT_NAME_SEPARATORS.includes(ch);

// ---- the script rule: UTS #39's "Highly Restrictive" level (section 5.2), on Script_Extensions ------------------------------------------------

/**
 * Every script value of Unicode 17.0 (PropertyValueAliases.txt, `sc`), by its short name, but Common, Inherited, Unknown and Katakana_Or_Hiragana
 * (no character has that one as its script). A value the running engine does not know is skipped: its characters are unassigned there, so they are
 * not letters and never reach the rule. (scripts/gen-unicode-data.ts reads it too, for the Script of a letter.)
 */
export const UNICODE_SCRIPTS: readonly string[] = (
  'Adlm Aghb Ahom Arab Armi Armn Avst Bali Bamu Bass Batk Beng Berf Bhks Bopo Brah Brai Bugi Buhd Cakm Cans Cari Cham Cher Chrs Copt Cpmn Cprt ' +
  'Cyrl Deva Diak Dogr Dsrt Dupl Egyp Elba Elym Ethi Gara Geor Glag Gong Gonm Goth Gran Grek Gujr Gukh Guru Hang Hani Hano Hatr Hebr Hira Hluw ' +
  'Hmng Hmnp Hung Ital Java Kali Kana Kawi Khar Khmr Khoj Kits Knda Krai Kthi Lana Laoo Latn Lepc Limb Lina Linb Lisu Lyci Lydi Mahj Maka Mand ' +
  'Mani Marc Medf Mend Merc Mero Mlym Modi Mong Mroo Mtei Mult Mymr Nagm Nand Narb Nbat Newa Nkoo Nshu Ogam Olck Onao Orkh Orya Osge Osma Ougr ' +
  'Palm Pauc Perm Phag Phli Phlp Phnx Plrd Prti Rjng Rohg Runr Samr Sarb Saur Sgnw Shaw Shrd Sidd Sidt Sind Sinh Sogd Sogo Sora Soyo Sund Sunu ' +
  'Sylo Syrc Tagb Takr Tale Talu Taml Tang Tavt Tayo Telu Tfng Tglg Thaa Thai Tibt Tirh Tnsa Todr Tols Toto Tutg Ugar Vaii Vith Wara Wcho Xpeo ' +
  'Xsux Yezi Yiii Zanb'
).split(' ');

let scriptTests: { script: string; re: RegExp }[] | null = null;
/** Built on first use, so loading the contract costs nothing. */
function scriptRegExps(): { script: string; re: RegExp }[] {
  if (scriptTests === null) {
    scriptTests = [];
    for (const script of UNICODE_SCRIPTS) {
      try {
        scriptTests.push({ script, re: new RegExp(`^\\p{Script_Extensions=${script}}$`, 'u') });
      } catch {
        // a script newer than this engine's tables
      }
    }
  }
  return scriptTests;
}
const COMMON_OR_INHERITED = /^[\p{Script_Extensions=Zyyy}\p{Script_Extensions=Zinh}]$/u;

/** UTS #39 5.1's augmentation: Han also counts as Hanb, Jpan and Kore; Hiragana and Katakana as Jpan; Hangul as Kore; Bopomofo as Hanb. */
const AUGMENT: Readonly<Record<string, readonly string[]>> = {
  Hani: ['Hanb', 'Jpan', 'Kore'], Hira: ['Jpan'], Kana: ['Jpan'], Hang: ['Kore'], Bopo: ['Hanb'],
};

/** The augmented Script_Extensions of one character, or null for "every script" (Common and Inherited go with any). */
function augmentedScripts(ch: string): Set<string> | null {
  if (COMMON_OR_INHERITED.test(ch)) return null;
  const out = new Set<string>();
  for (const { script, re } of scriptRegExps()) {
    if (!re.test(ch)) continue;
    out.add(script);
    for (const a of AUGMENT[script] ?? []) out.add(a);
  }
  // A character of no script this list names (impossible for an assigned letter): a script of its own, so it mixes with nothing.
  if (out.size === 0) out.add(`U+${ch.codePointAt(0)!.toString(16)}`);
  return out;
}

/**
 * A right-to-left letter (Bidi_Class R or AL), by the blocks Unicode gives those classes (DerivedBidiClass.txt's defaults: Hebrew, Arabic, Syriac,
 * Thaana, N'Ko, Samaritan, Mandaic and their extensions and presentation forms, and the right-to-left ranges of plane 1). JavaScript's regular
 * expressions have no Bidi_Class; every letter in these blocks is R or AL and no letter outside them is (DerivedBidiClass.txt 17.0.0, checked
 * against every letter of the engine's Unicode 16 tables).
 */
const RTL_LETTER = /^(?=\p{L})[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]$/u;

/**
 * RFC 5893's rule 1 for a name: one that holds a right-to-left letter starts with a right-to-left letter. The key keeps characters in their logical
 * order, while a page shows them in their display order: on a left-to-right page "שלום 123" and "123 שלום" look the same, so only the first may be a
 * name (review of M14-2, finding 6; INTERFACE CHANGE: a refinement of 6.1, answered as 'scripts').
 */
export function rightToLeftStartsRight(chars: readonly string[]): boolean {
  return !chars.some((ch) => RTL_LETTER.test(ch)) || RTL_LETTER.test(chars[0] ?? '');
}

/** The covering sets of the Highly Restrictive level: Latin + Japanese (Han, Hiragana, Katakana), Latin + Han + Bopomofo, Latin + Han + Hangul. */
const COVERS: readonly (readonly string[])[] = [['Latn', 'Jpan'], ['Latn', 'Hanb'], ['Latn', 'Kore']];

/**
 * UTS #39's "Highly Restrictive" level for the characters of a name: its resolved script set (the intersection of every character's augmented
 * Script_Extensions, Common and Inherited counting as every script) is not empty, or one of COVERS shares a script with every character.
 */
export function highlyRestrictive(chars: readonly string[]): boolean {
  const sets: Set<string>[] = [];
  for (const ch of chars) {
    const s = augmentedScripts(ch);
    if (s !== null) sets.push(s);
  }
  if (sets.length === 0) return true;
  let resolved = new Set(sets[0]);
  for (const s of sets.slice(1)) resolved = new Set([...resolved].filter((x) => s.has(x)));
  if (resolved.size > 0) return true;
  return COVERS.some((cover) => sets.every((s) => cover.some((c) => s.has(c))));
}

/**
 * 6.1: an account name's display form (whitespace collapsed, NFC, 3-20 code points, the allow-list, the separators, the script rule), without the key,
 * reserved names or the word filter (server only).
 *
 * In order: not a string ('type'); more than ACCOUNT_LIMITS.nameRawMax UTF-16 units before any work ('long'); then, on the display form (every run of
 * white space one space, none at either end, NFC), fewer than nameMin or more than nameMax code points ('short', 'long'); a character outside the
 * allow-list, which is letters (`\p{L}`), combining marks (`\p{M}`), the ASCII digits 0-9 and the five separators, never a default-ignorable code
 * point ('character': so NUL, unpaired surrogates, control and bidi characters, joiners, emoji, symbols and other digits never pass); a combining
 * mark that does not follow a letter, or more than MAX_COMBINING_MARKS of them in a row ('marks'); a separator first or last, or one twice in a run
 * of separators ('separator': 6.1's "never doubled"; two different ones may meet, as in "St. John", but ". ." is doubled); no letter ('noLetter');
 * letters of more than one script beyond UTS #39's Highly Restrictive level, or a right-to-left letter in a name that does not start with one
 * ('scripts').
 */
export function checkAccountName(raw: unknown): { ok: true; display: string } | { ok: false; problem: NameProblem; message: string } {
  const fail = (problem: NameProblem) => ({ ok: false as const, problem, message: NAME_PROBLEM_MESSAGES[problem] });
  if (typeof raw !== 'string') return fail('type');
  if (raw.length > ACCOUNT_LIMITS.nameRawMax) return fail('long');
  const display = collapseWhitespace(raw).normalize('NFC');
  const chars = Array.from(display);
  if (chars.length < ACCOUNT_LIMITS.nameMin) return fail('short');
  if (chars.length > ACCOUNT_LIMITS.nameMax) return fail('long');

  for (const ch of chars) {
    if (IGNORABLE.test(ch)) return fail('character');
    if (!(LETTER.test(ch) || MARK.test(ch) || DIGIT.test(ch) || isSeparator(ch))) return fail('character');
  }
  let marks = 0;
  let afterLetter = false;
  for (const ch of chars) {
    if (MARK.test(ch)) {
      if (!afterLetter || ++marks > MAX_COMBINING_MARKS) return fail('marks');
    } else {
      marks = 0;
      afterLetter = LETTER.test(ch);
    }
  }
  let run = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (!isSeparator(ch)) {
      run = '';
      continue;
    }
    if (i === 0 || i === chars.length - 1 || run.includes(ch)) return fail('separator');
    run += ch;
  }
  if (!chars.some((ch) => LETTER.test(ch))) return fail('noLetter');
  if (!highlyRestrictive(chars.filter((ch) => LETTER.test(ch) || MARK.test(ch)))) return fail('scripts');
  if (!rightToLeftStartsRight(chars)) return fail('scripts');
  return { ok: true, display };
}
