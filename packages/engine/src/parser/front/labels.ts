/**
 * Labels (design 6.2 step 4): an ability word or flavor word is a prefix of a few words followed by "--" at the start of a line (CR 207.2c-d) and has no
 * rules meaning. A KEYWORD written with a dash (`Ward--Pay 3 life`, `Escape--{3}{R}{R}`, `Boast--{1}: ...`, `Cumulative upkeep--Pay 1 life`) is not a label: its
 * text is part of the ability and is never claimed as a label, so a keyword that matters (exhaust: once per game) can never be hidden behind one.
 *
 * Order: the keyword registry first, then the ability-word list, then an unknown prefix of at most eight words.
 */
import { keywordAt, type LexiconIndex } from './lexicon-index';
import { trimRange } from './text';
import type { KeywordDash, LineLabel, Range } from './types';

/** The most words an unknown (flavor) prefix may have: "I've Come Up with a New Recipe!" has seven. */
const MAX_FLAVOR_WORDS = 8;
const ROMAN_LIST = /^(?:[IVX]+)(?:, [IVX]+)*$/;
/**
 * Cloud std-fin (CR 207.2d): a flavor word that starts with a number, "10,000 Needles -- Whenever ~ attacks, ...": a number (thousands separated by commas) followed
 * only by capitalized words is a title. A die result before a dash ("1 --", "1 or 2 --", CR 706.2) is never one: it has no capitalized word, or a lower-case one.
 */
const NUMBER_TITLE = /^\p{N}{1,3}(?:,\p{N}{3})*(?:\s+\p{Lu}[\p{L}'-]*)+$/u;

/**
 * Words that make a prefix a piece of rules text instead of a name: a flavor word is a title, and hiding "Each opponent faces a villainous choice" behind the label
 * status would mark an instruction as understood. A prefix with one of these stays ordinary text (and is then manual, never wrong).
 */
const NOT_A_TITLE = new Set(['each', 'you', 'your', 'they', 'them', 'their', 'if', 'when', 'whenever', 'while', 'target', 'may', 'must', 'opponent', 'opponents', 'faces', 'choose', 'chosen', 'then', 'or', 'it', 'its', 'that']);

/**
 * r4-mech (CR 207.2d): a flavor word written as an exclamation or a question in title case ("A Test of Your Reflexes!", "Do You Like Squirrels?") is a name even
 * with a word of NOT_A_TITLE in it: rules text never ends in "!" or "?". Every word is capitalized but a few short function words, so "Bring it Down!" stays text.
 */
const TITLE_SMALL = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'with', 'up', 'at', 'by']);
function exclaimedTitle(prefix: string): boolean {
  if (!/[!?]$/.test(prefix)) return false;
  return prefix.slice(0, -1).split(/\s+/).every((w, i) => /^\p{Lu}/u.test(w) || (i > 0 && TITLE_SMALL.has(w)));
}

/**
 * trek-2 (CR 207.2d): a flavor word of two or more words in title case ("Shaka, When the Walls Fell", "Make Them Pay", "Gather Your Courage") is a name even with
 * a word of NOT_A_TITLE in it, as long as that word is capitalized: rules text writes "when", "them", "your" in lower case after its first word, so a prefix where
 * every word after the first is capitalized (but a few short function words) is never a piece of rules text. "Each opponent faces a villainous choice" and
 * "Bring it Down!" stay text.
 */
function titleCased(prefix: string): boolean {
  const words = prefix.split(/\s+/);
  if (words.length < 2) return false;
  return words.every((w, i) => /^\p{Lu}/u.test(w) || (i > 0 && TITLE_SMALL.has(w)));
}

/**
 * A keyword ability inside the prefix with its parameter ("Commander Suspend 4", "Thing Kicker {2}") or written in lower case ("Fixed commander ninjutsu"):
 * that is rules text, and calling it a label (CR 207.2d: no rules meaning) would hide it. A title that merely contains a keyword word ("Gift of Chaos",
 * "Wild Magic Surge") is a name and stays one.
 */
function hidesKeyword(ix: LexiconIndex, prefix: string): boolean {
  const lower = prefix.toLowerCase();
  for (const m of lower.matchAll(/(?<![\p{L}'-])\p{L}[\p{L}'-]*/gu)) {
    const hit = keywordAt(ix, lower, m.index!);
    if (!hit) continue;
    if (/^\s*[{\dX]/.test(prefix.slice(m.index! + hit.length))) return true;
    if (prefix[m.index!] !== prefix[m.index!]!.toUpperCase()) return true;
  }
  return false;
}

/** Index of the first "--" of `text[range]` outside braces and double quotes, or -1. */
export function firstDash(text: string, range: Range): number {
  let depth = 0;
  let quote = false;
  for (let i = range[0]; i < range[1] - 1; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}' && depth > 0) depth--;
    else if (c === '"') quote = !quote;
    else if (c === '-' && text[i + 1] === '-' && depth === 0 && !quote) return i;
  }
  return -1;
}

export interface Lead {
  label?: LineLabel;
  keywordDash?: KeywordDash;
  /** The line after the label (or the trimmed line when it has none). */
  body: Range;
}

/** Looks at the start of one line of the parse text (reminders blanked, self references as "~"). */
export function detectLead(parse: string, line: Range, ix: LexiconIndex): Lead {
  const trimmed = trimRange(parse, line);
  const dash = firstDash(parse, trimmed);
  if (dash <= trimmed[0]) return { body: trimmed };
  const prefixEnd = trimRange(parse, [trimmed[0], dash])[1];
  const prefix = parse.slice(trimmed[0], prefixEnd);
  let bodyStart = dash + 2;
  while (bodyStart < trimmed[1] && parse[bodyStart] === ' ') bodyStart++;
  const body: Range = [bodyStart, trimmed[1]];

  // 1. A keyword with a dash.
  const lower = prefix.toLowerCase();
  const hit = keywordAt(ix, lower, 0);
  // What may follow the keyword name before the dash: nothing, a cost or number ("Prototype {1}{W}--", "Reinforce 1--"), or "from" / "with" / "onto" (a quality).
  if (hit && hit.length <= prefix.length && /^(?:$|[{\dX]|(?:from|with|onto)\b)/.test(prefix.slice(hit.length).trim())) {
    return {
      keywordDash: { text: prefix, name: hit.name, nameRange: [trimmed[0], trimmed[0] + hit.length], dashRange: [dash, dash + 2] },
      body,
    };
  }
  // 2./3. Chapter numerals, modal headers and case lines are structure, not labels.
  if (ROMAN_LIST.test(prefix) || body[1] <= body[0] || lower === 'to solve' || lower.startsWith('choose')) return { body: trimmed };
  // 2. An ability word, 3. an unknown prefix that reads like a name.
  const words = prefix.split(/\s+/);
  if (words.length > MAX_FLAVOR_WORDS) return { body: trimmed };
  if (!ix.abilityWords.has(lower) && ((/^\p{N}/u.test(prefix) && !NUMBER_TITLE.test(prefix)) || hidesKeyword(ix, prefix) || (!exclaimedTitle(prefix) && !titleCased(prefix) && words.some((w) => NOT_A_TITLE.has(w.toLowerCase().replace(/[^\p{L}']/gu, '')))))) return { body: trimmed };
  if (!/^[\p{Lu}\p{N}]/u.test(prefix) || /[{}:.;()"~]/.test(prefix) || !/\p{L}/u.test(prefix)) return { body: trimmed };
  const label: LineLabel = { text: prefix, range: [trimmed[0], bodyStart], kind: ix.abilityWords.has(lower) ? 'ability-word' : 'flavor-word' };
  return { label, body };
}
