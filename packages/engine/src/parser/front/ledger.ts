/**
 * The character ledger (design 6.2 step 7, guard G4): every non-space character of the normalized text belongs to exactly one entry. The front end claims what
 * it understands (`reminder`, `label`, `structure`); the rest starts as `manual` ("not parsed yet") and later packages move ranges to `consumed` with the
 * template that interpreted them (`markLedger`). A gap or an overlap is a test failure.
 */
import type { LedgerEntry } from '../types';
import type { Range } from './types';

const sortEntries = (xs: readonly LedgerEntry[]): LedgerEntry[] => [...xs].sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);

/** Whitespace-trimmed sub-range of `text[range]`, or undefined when it holds nothing but whitespace. */
function nonBlank(text: string, [a, b]: Range): Range | undefined {
  let s = a;
  let e = b;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return s < e ? [s, e] : undefined;
}

/**
 * Completes a ledger: `claimed` entries (any order, not overlapping) are kept, and every maximal run of unclaimed non-space text in a gap is filled with a
 * `manual` entry whose reason is `reason`. Entries are trimmed of leading and trailing whitespace and returned in text order.
 */
export function completeLedger(text: string, claimed: readonly LedgerEntry[], reason = 'not parsed'): LedgerEntry[] {
  const sorted = sortEntries(claimed);
  const out: LedgerEntry[] = [];
  let at = 0;
  const fill = (to: number): void => {
    // A gap may hold several words separated by line breaks; one entry per line keeps ranges aligned with lines.
    let lineStart = at;
    for (let i = at; i <= to; i++) {
      if (i === to || text[i] === '\n') {
        const r = nonBlank(text, [lineStart, i]);
        if (r) out.push({ range: r, status: 'manual', reason });
        lineStart = i + 1;
      }
    }
  };
  for (const e of sorted) {
    if (e.range[0] < at) throw new Error(`ledger entries overlap at ${e.range[0]}`);
    if (e.range[0] > at) fill(e.range[0]);
    const r = nonBlank(text, e.range);
    if (r) out.push({ ...e, range: r });
    at = Math.max(at, e.range[1]);
  }
  if (at < text.length) fill(text.length);
  return out;
}

/**
 * Returns a copy of `ledger` in which the non-space characters of `range` belong to one entry with the given status. Entries that only partly overlap the
 * range are cut around it. Used by later packages when a template consumes a span (`consumed`) or when a unit falls back to `manual`.
 */
export function markLedger(text: string, ledger: readonly LedgerEntry[], range: Range, status: LedgerEntry['status'], by?: string, reason?: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const e of sortEntries(ledger)) {
    if (e.range[1] <= range[0] || e.range[0] >= range[1]) {
      out.push(e);
      continue;
    }
    if (e.range[0] < range[0]) out.push({ ...e, range: [e.range[0], range[0]] });
    if (e.range[1] > range[1]) out.push({ ...e, range: [range[1], e.range[1]] });
  }
  const entry: LedgerEntry = { range, status };
  if (by !== undefined) entry.by = by;
  if (reason !== undefined) entry.reason = reason;
  out.push(entry);
  return completeLedger(text, out).filter((e) => nonBlank(text, e.range) !== undefined);
}

/** Problems of a ledger against its text: overlaps, entries outside the text, and non-space characters that no entry covers. Empty = tiled. */
export function ledgerProblems(text: string, ledger: readonly LedgerEntry[]): string[] {
  const problems: string[] = [];
  const covered = new Uint8Array(text.length);
  for (const e of ledger) {
    const [a, b] = e.range;
    if (a < 0 || b > text.length || a >= b) {
      problems.push(`bad range [${a},${b}) for text of length ${text.length}`);
      continue;
    }
    for (let i = a; i < b; i++) {
      if (covered[i]) problems.push(`overlap at ${i}`);
      covered[i] = 1;
    }
  }
  for (let i = 0; i < text.length; i++) {
    if (!covered[i] && !/\s/.test(text[i]!)) problems.push(`uncovered character ${JSON.stringify(text[i])} at ${i}`);
  }
  return problems.length > 20 ? [...problems.slice(0, 20), `... ${problems.length - 20} more`] : problems;
}
