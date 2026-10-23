/**
 * Quoted abilities (`gains "{T}: Add {C}."`, with nested single quotes `'...'` inside double quotes, CR 113.1 and the way Oracle writes granted abilities).
 *
 * Pure scanner over the normalized (ASCII quote) text. Quotes never span a line break. A single quote is a delimiter only inside a double-quoted span; anywhere
 * else it is an apostrophe ("creature's", "players'"). Unmatched double quotes are reported, never guessed at.
 */
import type { Range } from './types';

export interface QuoteSpan {
  /** Index of the opening quote character. */
  open: number;
  /** Index of the closing quote character. */
  close: number;
  kind: '"' | "'";
  /** 0 for a span that is not inside another one. */
  depth: number;
}

export interface QuoteScan {
  /** Matched spans, ordered by `open`. */
  spans: QuoteSpan[];
  /** Indices of double quotes that never closed on their line (and stray closers). */
  unmatched: number[];
}

const WS = /\s/;
const CLOSER_FOLLOW = /[\s.,;:!?)"]/;

/**
 * After a possible plural possessive: is the next single quote on this line (before any double quote) a closer (a non-space before it, a boundary after it)
 * rather than an opener? Then the quote in question was an apostrophe.
 */
function closerAhead(text: string, from: number, to: number): boolean {
  for (let j = from; j < to; j++) {
    const c = text[j]!;
    if (c === '\n' || c === '"') return false;
    if (c !== "'") continue;
    const prev = text[j - 1];
    const next = text[j + 1];
    return prev !== undefined && !WS.test(prev) && (next === undefined || next === '\n' || CLOSER_FOLLOW.test(next) || j + 1 >= to);
  }
  return false;
}

/**
 * Scans `text[from, to)`. `inside` says the range is the inside of a quoted span (so a single quote can open one): used when the contents of a quote
 * are scanned again by the tokenizer.
 */
export function scanQuotes(text: string, from = 0, to: number = text.length, inside?: '"' | "'"): QuoteScan {
  const spans: QuoteSpan[] = [];
  const unmatched: number[] = [];
  const stack: { ch: '"' | "'"; pos: number }[] = [];
  const base = inside ? 1 : 0; // a virtual open quote below the real stack
  const depthOf = (): number => stack.length;
  const flushLine = (): void => {
    for (const s of stack) if (s.ch === '"') unmatched.push(s.pos);
    stack.length = 0;
  };
  for (let i = from; i < to; i++) {
    const c = text[i]!;
    if (c === '\n') {
      flushLine();
      continue;
    }
    if (c === '"') {
      // A double quote closes the nearest open double quote; single quotes left open inside it were apostrophes after all.
      let k = stack.length - 1;
      while (k >= 0 && stack[k]!.ch !== '"') k--;
      if (k >= 0) {
        const open = stack[k]!;
        stack.length = k;
        spans.push({ open: open.pos, close: i, kind: '"', depth: depthOf() });
      } else stack.push({ ch: '"', pos: i });
      continue;
    }
    if (c === "'") {
      const inQuote = base + stack.length > 0;
      if (!inQuote) continue; // an apostrophe
      const top = stack[stack.length - 1];
      const prev = text[i - 1];
      const next = text[i + 1];
      if (top && top.ch === "'") {
        // A closer follows a non-space and precedes a boundary; "creature's" has a letter after the apostrophe and stays an apostrophe.
        // "players' hands" is the other ambiguity: a plural possessive that is followed by a space looks like a closer. It is an apostrophe when a real closer
        // comes later in the same double-quoted span (before another opener), and a closer otherwise.
        if (prev !== undefined && !WS.test(prev) && (next === undefined || next === '\n' || CLOSER_FOLLOW.test(next) || i + 1 >= to) && !(prev === 's' && next !== undefined && WS.test(next) && closerAhead(text, i + 1, to))) {
          stack.pop();
          spans.push({ open: top.pos, close: i, kind: "'", depth: depthOf() });
          continue;
        }
      }
      const opens = (prev === undefined || i === from || WS.test(prev) || prev === '"' || prev === '(') && next !== undefined && next !== '\n' && !WS.test(next) && i + 1 < to;
      if (opens) stack.push({ ch: "'", pos: i });
    }
  }
  flushLine();
  spans.sort((a, b) => a.open - b.open);
  unmatched.sort((a, b) => a - b);
  return { spans, unmatched };
}

/** True when `pos` is inside (between the delimiters of) one of the spans. */
export function insideAny(spans: readonly QuoteSpan[], pos: number): boolean {
  return spans.some((s) => pos > s.open && pos < s.close);
}

/** Positions of `text[range]` that are outside every quote span, braces and the given spans' delimiters. Helper for "outside quotes" scans. */
export function topLevelMask(text: string, range: Range, spans: readonly QuoteSpan[]): boolean[] {
  const mask: boolean[] = new Array(range[1] - range[0]).fill(true);
  for (const s of spans) {
    for (let i = Math.max(s.open, range[0]); i <= Math.min(s.close, range[1] - 1); i++) mask[i - range[0]] = false;
  }
  let depth = 0;
  for (let i = range[0]; i < range[1]; i++) {
    const c = text[i];
    if (c === '{') depth++;
    if (depth > 0) mask[i - range[0]] = false;
    if (c === '}' && depth > 0) depth--;
  }
  return mask;
}
