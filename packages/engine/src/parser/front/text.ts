/**
 * Text normalization (design 6.2 step 1) and small text helpers. Pure.
 *
 * `normalizeText` keeps an offset map back to the original, so that ranges decided on the normalized text (ledger entries, tokens) can be painted on the
 * Oracle text a player sees.
 */
import type { Range } from './types';

export interface Normalized {
  text: string;
  /** `offsets[i]` = index in the original of the character that produced `text[i]`; the last entry is the original length. */
  offsets: number[];
}

const SPACE_LIKE = /[   -   　\t\v\f]/;
const INVISIBLE = /[​‌‍⁠﻿­]/;
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/**
 * - curly quotes and apostrophes become ASCII;
 * - U+2212 (minus) becomes "-"; en and em dashes become "-" between digits ("1-6") and "--" elsewhere (a label or cost separator, design 6.2);
 * - non-breaking and other Unicode spaces become " "; zero-width characters disappear;
 * - runs of spaces become one space, spaces next to a line break disappear, "\r\n" and "\r" become "\n";
 * - bullets and everything else are kept as they are.
 */
export function normalizeText(original: string): Normalized {
  const out: string[] = [];
  const offsets: number[] = [];
  // One entry per UTF-16 code unit (`offsets[i]` belongs to `text[i]`): an astral character contributes two entries that share its original index.
  const push = (s: string, at: number): void => {
    for (let k = 0; k < s.length; k++) {
      out.push(s[k]!);
      offsets.push(at);
    }
  };
  let i = 0;
  while (i < original.length) {
    const ch = original[i]!;
    if (ch === '\r') {
      push('\n', i);
      if (original[i + 1] === '\n') i++;
    } else if (ch === '\n') push('\n', i);
    else if (ch === '‘' || ch === '’' || ch === '‛' || ch === 'ʼ') push("'", i);
    else if (ch === '“' || ch === '”' || ch === '‟') push('"', i);
    else if (ch === '−') push('-', i);
    else if (ch === '–' || ch === '—') {
      const prev = original[i - 1];
      const next = original[i + 1];
      push(isDigit(prev) && isDigit(next) ? '-' : '--', i);
    } else if (ch === ' ' || SPACE_LIKE.test(ch)) push(' ', i);
    else if (INVISIBLE.test(ch)) {
      /* dropped */
    } else {
      // Keep surrogate pairs together so offsets stay on character boundaries.
      const cp = original.codePointAt(i)!;
      const s = String.fromCodePoint(cp);
      push(s, i);
      i += s.length - 1;
    }
    i++;
  }
  // Collapse runs of spaces and drop spaces around line breaks.
  const text: string[] = [];
  const offs: number[] = [];
  for (let k = 0; k < out.length; k++) {
    const ch = out[k]!;
    if (ch === ' ') {
      const prev = text[text.length - 1];
      if (prev === ' ' || prev === '\n' || prev === undefined) continue;
      if (out[k + 1] === '\n') continue;
      let j = k + 1;
      while (out[j] === ' ') j++;
      if (j >= out.length) continue; // trailing space at the end of the text
      if (out[j] === '\n') continue;
    }
    text.push(ch);
    offs.push(offsets[k]!);
  }
  offs.push(original.length);
  return { text: text.join(''), offsets: offs };
}

/** Maps a range of the normalized text back to the original Oracle text. */
export function originalRange(offsets: readonly number[], r: Range): Range {
  const end = offsets[offsets.length - 1]!;
  // The end is the original position of the character after the range, so an expanded dash ("--" from one em dash) is covered whole.
  return [offsets[r[0]] ?? end, offsets[r[1]] ?? end];
}

/** Lines of the text as ranges (no line break included). Always at least one line, as `"".split("\n")` is. */
export function lineRanges(text: string): Range[] {
  const out: Range[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      out.push([start, i]);
      start = i + 1;
    }
  }
  return out;
}

/** Trims whitespace at both ends of a range of `text`. */
export function trimRange(text: string, r: Range): Range {
  let [a, b] = r;
  while (a < b && /\s/.test(text[a]!)) a++;
  while (b > a && /\s/.test(text[b - 1]!)) b--;
  return [a, b];
}

/** Display text of a set of ranges of the parse text: whitespace collapsed, ranges joined by the given separator. */
export function collapse(parse: string, ranges: readonly Range[], sep = '\n'): string {
  return ranges
    .map(([a, b]) => parse.slice(a, b).replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '')
    .join(sep);
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
