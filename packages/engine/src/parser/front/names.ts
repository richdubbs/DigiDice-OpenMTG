/**
 * The card-name index of the front end (design 6.2 step 3): the names of `ParseOptions.cardNames` as the parser sees them. Owner: WP5. Pure.
 *
 * Names are normalized like the Oracle text (CR 201.2: a dash, a curly apostrophe or a no-break space in a name is the same name once the text is normalized).
 * Built once per name set AND size: a set that grows between calls (a local index that is still loading) gets a fresh index, so a result never depends on
 * call history.
 */
import { normalizeText } from './text';

export interface NameIndex {
  /** Every name, normalized. */
  all: ReadonlySet<string>;
  /** Names that contain a comma ("Bruna, the Fading Light") by their first word, longest first: they are one token wherever they appear. */
  comma: ReadonlyMap<string, readonly string[]>;
  /** Every name by its first word (up to the first space or comma; an apostrophe stays), longest first. */
  byFirstWord: ReadonlyMap<string, readonly string[]>;
}

const cache = new WeakMap<ReadonlySet<string>, { size: number; index: NameIndex }>();
const PLAIN_ASCII = /^[ -~]*$/;

/** A name as the normalized text writes it. */
export const normalizeName = (name: string): string => (PLAIN_ASCII.test(name) ? name : normalizeText(name).text);

/** The first word of a name or of the text at a position: up to the first space or comma. */
export const firstWordOf = (s: string): string => /^[^ ,]*/.exec(s)![0];

export function nameIndex(names: ReadonlySet<string>): NameIndex {
  const hit = cache.get(names);
  if (hit && hit.size === names.size) return hit.index;
  const all = new Set<string>();
  const comma = new Map<string, string[]>();
  const byFirstWord = new Map<string, string[]>();
  for (const raw of names) {
    const n = normalizeName(raw);
    all.add(n);
    const key = firstWordOf(n); // "Nicol Bolas, Dragon-God" is keyed by "Nicol"
    const list = byFirstWord.get(key);
    if (list) list.push(n);
    else byFirstWord.set(key, [n]);
    if (n.indexOf(', ') > 0) {
      const c = comma.get(key);
      if (c) c.push(n);
      else comma.set(key, [n]);
    }
  }
  const longestFirst = (a: string, b: string): number => b.length - a.length || (a < b ? -1 : 1);
  for (const list of comma.values()) list.sort(longestFirst);
  for (const list of byFirstWord.values()) list.sort(longestFirst);
  const index: NameIndex = { all, comma, byFirstWord };
  cache.set(names, { size: names.size, index });
  return index;
}
