/**
 * M14-2: the canonical key of a name (design 6.3), on the tables of one name data version (./data.ts). Pure: the tables come in, nothing is read from
 * outside but the running engine's normalization and `\p{...}` classes. scripts/gen-unicode-data.ts runs `keyRound` on every entry of the tables it
 * generates (each settles within KEY_ROUNDS_CHECKED rounds), so the generator and the server share one algorithm.
 */
import { ACCOUNT_NAME_SEPARATORS } from '../api/names';

/**
 * The tables of one name data version, by code point, as the key reads them: Unicode's two tables with OpenMTG's derived entries applied
 * (./table.ts, applyOverrides: a derived entry takes its character out of the case folding and makes the entry's target its prototype).
 */
export interface KeyTables {
  /** CaseFolding.txt, statuses C and F (full case folding), but the characters of the derived entries. */
  readonly caseFolding: ReadonlyMap<number, string>;
  /** confusables.txt (UTS #39): each character to its prototype; for the characters of the derived entries, the entry's target. */
  readonly confusables: ReadonlyMap<number, string>;
  /** OpenMTG's supplement, applied last in each round ("i" to "l", 6.3 step 2.6). */
  readonly supplement: ReadonlyMap<number, string>;
}

/** The generator refuses tables in which an entry needs more rounds than this to settle (6.3 step 2). */
export const KEY_ROUNDS_CHECKED = 3;
/** The key stops after this many rounds even if a string (not a single entry) still changed; never reached by a string of settled entries. */
export const KEY_ROUNDS_MAX = 8;

const MARK = /^\p{M}$/u;
/** A letter whose combining marks the key drops (6.3 step 2.4): Latin, Greek or Cyrillic by its Script property. */
const LGC_LETTER = /^(?=\p{L})[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]$/u;
const SEPARATORS: ReadonlySet<number> = new Set(Array.from(ACCOUNT_NAME_SEPARATORS, (c) => c.codePointAt(0)!));

function mapEach(s: string, table: ReadonlyMap<number, string>): string {
  let out = '';
  for (const ch of s) out += table.get(ch.codePointAt(0)!) ?? ch;
  return out;
}

/** 6.3 step 2.4: NFKD (see keyRound), then every combining mark in a run that follows a Latin, Greek or Cyrillic letter dropped. */
function dropMarks(s: string): string {
  let out = '';
  let afterLgc = false;
  for (const ch of s.normalize('NFKD')) {
    if (MARK.test(ch)) {
      if (!afterLgc) out += ch;
      continue;
    }
    afterLgc = LGC_LETTER.test(ch);
    out += ch;
  }
  return out;
}

function dropSeparators(s: string): string {
  let out = '';
  for (const ch of s) if (!SEPARATORS.has(ch.codePointAt(0)!)) out += ch;
  return out;
}

/**
 * One round of 6.3 step 2: full case folding; each character to its confusable prototype; full case folding again; the marks after a Latin, Greek or
 * Cyrillic letter dropped; the separators dropped; the supplement.
 *
 * Each of the three mappings reads decomposed text (NFD), and step 2.4 decomposes with NFKD rather than NFD (INTERFACE CHANGE: a refinement of
 * 6.3's steps), as Unicode's own matching does it: the canonical caseless match folds NFD text (core specification 3.13) and UTS #39's skeleton
 * maps NFD text. Two things go wrong otherwise:
 *  - confusables.txt gives some precomposed letters a prototype of another letter or script (ö to Arabic ة, ņ to ɲ, ț to ƫ, ṃ to ꭑ), so those
 *    diacritics would make a name different after all ("Jörg" and "Jorg"), against step 2.4. Decomposed first, the letter maps as its base and the
 *    mark is dropped. In Unicode 17.0's data this changes the key of 59 of the 143,529 letters and marks, against the literal order.
 *  - a prototype holding a compatibility character (confusables.txt maps "%" to "º/₀") would key differently a second time, after step 1's NFKC;
 *    with NFKD inside the round a key is its own key (key(key(x)) = key(x)).
 * scripts/gen-unicode-data.ts checks every entry of the tables it writes: it settles within KEY_ROUNDS_CHECKED rounds, and its key is its own key.
 */
export function keyRound(t: KeyTables, s: string): string {
  let x = mapEach(s.normalize('NFD'), t.caseFolding);
  x = mapEach(x.normalize('NFD'), t.confusables);
  x = mapEach(x.normalize('NFD'), t.caseFolding);
  x = dropMarks(x);
  x = dropSeparators(x);
  return mapEach(x, t.supplement);
}

/** The rounds of 6.3 step 2 from `s` until one changes nothing (at most KEY_ROUNDS_MAX), and how many changed something. */
export function settle(t: KeyTables, s: string): { value: string; rounds: number } {
  let x = s;
  for (let rounds = 0; rounds < KEY_ROUNDS_MAX; rounds++) {
    const next = keyRound(t, x);
    if (next === x) return { value: x, rounds };
    x = next;
  }
  return { value: x, rounds: KEY_ROUNDS_MAX };
}

/** 6.3: NFKC, the rounds until stable, NFC. Total: any string has a key (the empty string's is empty). */
export function canonicalKey(t: KeyTables, display: string): string {
  return settle(t, display.normalize('NFKC')).value.normalize('NFC');
}

/**
 * The key of a name's UTS #39 skeleton: each character of its NFD form to its prototype BEFORE any case folding, then the key. The key folds first,
 * so a capital whose small letter has a look-alike of its own keys by the small letter ("Н" by "н", not by "H"; the closure of the derived table
 * follows the capital only where that keeps two letters of one script apart). Word lists (the filter, 6.4) check this key too, so "ЅНІТ" is
 * refused like "SHIT". Never a name's identity: two names with one skeleton key may both exist.
 */
export function skeletonKey(t: KeyTables, display: string): string {
  return canonicalKey(t, mapEach(display.normalize('NFD'), t.confusables));
}
