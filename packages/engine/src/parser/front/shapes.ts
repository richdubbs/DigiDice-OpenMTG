/**
 * Line shapes (design 6.2 step 5): the small recognizers the segmenter's decision list is made of. All of them read the parse text (reminders blank, "~" for the
 * object) and return ranges of the normalized text. Pure.
 */
import { firstDash } from './labels';
import type { Range } from './types';

/**
 * End of a prefix whose regular expression ended in `\s*`. The parse text blanks reminder text and every self reference (spaces, then "~" on the last
 * character), so those spaces would swallow the first letters of a card name that follows the prefix ("+2: Angrath deals" -> "+2: Angrat"). The prefix ends at
 * the prefix characters and the spaces the NORMALIZED text really has after them.
 */
export function prefixEnd(parse: string, normalized: string, start: number, end: number): number {
  let e = end;
  while (e > start && parse[e - 1] === ' ') e--; // the last character of the prefix itself
  while (e < end && normalized[e] === ' ') e++; // then the spaces the text really has
  return e;
}

/** First position at or after `at` (before `limit`) that is not a space of the normalized text: skipping blanked names and reminders is not skipping spaces. */
export function skipSpaces(normalized: string, at: number, limit: number): number {
  let s = at;
  while (s < limit && normalized[s] === ' ') s++;
  return s;
}

export interface LoyaltyPrefix {
  sign: '+' | '-' | '0';
  amount: number | 'X';
  /** "+2:" including the colon and the spaces after it. */
  range: Range;
}

/** `+2:` `-X:` `0:` at the start of the body (CR 606.4). */
export function loyaltyPrefix(parse: string, normalized: string, body: Range): LoyaltyPrefix | undefined {
  const m = /^(?:([+-])(\d+|X)|(0)):\s*/.exec(parse.slice(body[0], body[1]));
  if (!m) return undefined;
  const range: Range = [body[0], prefixEnd(parse, normalized, body[0], body[0] + m[0].length)];
  if (m[3] !== undefined) return { sign: '0', amount: 0, range };
  return { sign: m[1] as '+' | '-', amount: m[2] === 'X' ? 'X' : Number(m[2]), range };
}

export interface ChapterPrefix {
  chapters: number[];
  /** "I, II -- " including the dash and the spaces after it. */
  range: Range;
}

const ROMAN: Readonly<Record<string, number>> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
};

/** `I -- `, `I, II -- ` at the start of the body (CR 714.2). */
export function chapterPrefix(parse: string, normalized: string, body: Range): ChapterPrefix | undefined {
  const m = /^((?:[IVX]+)(?:, [IVX]+)*) --\s*/.exec(parse.slice(body[0], body[1]));
  if (!m) return undefined;
  const chapters = m[1]!.split(', ').map((r) => ROMAN[r]);
  if (chapters.some((c) => c === undefined)) return undefined;
  return { chapters: chapters as number[], range: [body[0], prefixEnd(parse, normalized, body[0], body[0] + m[0].length)] };
}

export interface LevelHeader {
  min: number;
  max: number | null;
}

/** `LEVEL 3-7`, `LEVEL 8+` (CR 711.2). */
export function levelHeader(parse: string, body: Range): LevelHeader | undefined {
  const m = /^LEVEL (\d+)(?:-(\d+)|(\+))$/i.exec(parse.slice(body[0], body[1]).trim());
  if (!m) return undefined;
  return { min: Number(m[1]), max: m[3] ? null : Number(m[2]) };
}

/** A bare power/toughness line such as `4/4` (the second line of a level bracket). */
export function ptLine(parse: string, body: Range): { power: string; toughness: string } | undefined {
  const m = /^(\d+|\*|X)(\+\*)?\/(\d+|\*|X)(\+\*)?$/.exec(parse.slice(body[0], body[1]).trim());
  return m ? { power: m[1]! + (m[2] ?? ''), toughness: m[3]! + (m[4] ?? '') } : undefined;
}

export interface ClassLevelLine {
  level: number;
  /** The mana cost to reach the level: `{1}{R}` in `{1}{R}: Level 2`. */
  cost: Range;
}

/** `{1}{R}: Level 2` (CR 716.2). */
export function classLevelLine(parse: string, body: Range): ClassLevelLine | undefined {
  const text = parse.slice(body[0], body[1]);
  const m = /^((?:\{[^}]+\})+): Level (\d+)$/.exec(text.trim());
  if (!m) return undefined;
  return { level: Number(m[2]), cost: [body[0], body[0] + m[1]!.length] };
}

export interface DicePrefix {
  min: number;
  max: number | null;
  /** `1-9 | ` including the bar and the spaces after it. */
  range: Range;
}

/** `1-9 | `, `20 | `, `15+ | ` (CR 706.2). */
export function dicePrefix(parse: string, normalized: string, body: Range): DicePrefix | undefined {
  const m = /^(\d+)(?:-(\d+)|(\+)| or less)?\s*\|\s*/.exec(parse.slice(body[0], body[1]));
  if (!m) return undefined;
  const lo = Number(m[1]);
  const range: Range = [body[0], prefixEnd(parse, normalized, body[0], body[0] + m[0].length)];
  if (m[3]) return { min: lo, max: null, range };
  if (m[2]) return { min: lo, max: Number(m[2]), range };
  if (/or less/.test(m[0])) return { min: 1, max: lo, range };
  return { min: lo, max: lo, range };
}

export interface SpreePrefix {
  plus: Range;
  cost: Range;
  dash: Range;
  /** The effect after the dash. */
  rest: Range;
}

/** `+ {1} -- Effect` (the lines of a Spree spell, CR 702.172). */
export function spreeLine(parse: string, normalized: string, body: Range): SpreePrefix | undefined {
  const text = parse.slice(body[0], body[1]);
  const m = /^\+\s*(?=\{)/.exec(text);
  if (!m) return undefined;
  const dash = firstDash(parse, body);
  if (dash < 0) return undefined;
  let costEnd = dash;
  while (costEnd > body[0] + m[0].length && parse[costEnd - 1] === ' ') costEnd--;
  const restStart = skipSpaces(normalized, dash + 2, body[1]);
  return { plus: [body[0], body[0] + 1], cost: [body[0] + m[0].length, costEnd], dash: [dash, dash + 2], rest: [restStart, body[1]] };
}

/** std-blb (CR 700.2i): one mode of a "Choose up to N {P} worth of modes" spell, `{P}{P} -- Effect`: the pawprint symbols, how many, the dash and the effect. */
export interface PawprintPrefix {
  marker: Range;
  pawprints: number;
  dash: Range;
  rest: Range;
}

/** `{P} -- Effect`, `{P}{P}{P} -- Effect` (one to five pawprints, then the dash right after them). */
export function pawprintLine(parse: string, normalized: string, body: Range): PawprintPrefix | undefined {
  const m = /^((?:\{P\}){1,5})\s*--/.exec(parse.slice(body[0], body[1]));
  if (!m) return undefined;
  const dash = firstDash(parse, body);
  if (dash !== body[0] + m[0].length - 2) return undefined;
  const marker: Range = [body[0], body[0] + m[1]!.length];
  return { marker, pawprints: m[1]!.length / 3, dash: [dash, dash + 2], rest: [skipSpaces(normalized, dash + 2, body[1]), body[1]] };
}

/** The line is a modal bullet; returns the range of the bullet and the text after it. */
export function bulletLine(parse: string, normalized: string, body: Range): { bullet: Range; rest: Range } | undefined {
  if (parse[body[0]] !== '•') return undefined;
  return { bullet: [body[0], body[0] + 1], rest: [skipSpaces(normalized, body[0] + 1, body[1]), body[1]] };
}

/** First words of a cost: the verbs and symbols that can start the left side of an activated ability's colon (CR 118, 602.1). */
export const COST_STARTS: ReadonlySet<string> = new Set([
  'sacrifice', 'tap', 'untap', 'remove', 'pay', 'discard', 'exile', 'return', 'put', 'reveal', 'mill', 'exert', 'collect', 'forage', 'blight', 'behold',
  'waterbend', 'earthbend', 'airbend', 'unattach', 'mark',
]);
