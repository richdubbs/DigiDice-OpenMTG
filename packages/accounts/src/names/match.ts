/**
 * M14-2: word lists compared by their keys (design 6.2 and 6.4). One list holds words matched anywhere in a key, words matched only as a whole key,
 * and exceptions (the Scunthorpe problem): an occurrence of a word inside an occurrence of an exception does not count, so "badminton" keeps "admin"
 * from refusing it, while "badmintonadmin" is still refused for its second "admin".
 *
 * The key has no separators, so an exception would excuse a word the display shows on its own: "S Cunt Horpe" keys to "scunthorpe". When the display
 * is known, an exception counts only inside one of its words (review of M14-2, finding 7): `wordStarts` gives where the words' keys begin in the key.
 */
import { ACCOUNT_NAME_SEPARATORS } from '../api/names';

/** A list of keys (never literals: every entry is keyed once, when the list is built). */
export interface KeyList {
  readonly contains: readonly string[];
  readonly whole: ReadonlySet<string>;
  readonly exceptions: readonly string[];
}

/** Every start of `needle` in `hay` (overlapping ones too). */
function starts(hay: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * Where the keys of a display's words begin in its key (each word is a run between separators, keyed alone), or null when the words' keys do not
 * add up to the key (a composition across a separator, Hangul jamo: then no exception counts).
 */
export function wordStarts(display: string, key: (s: string) => string, whole: string): number[] | null {
  const words = display.split(new RegExp(`[${ACCOUNT_NAME_SEPARATORS.replace(/[-\]\\^]/g, '\\$&')}]+`)).filter((w) => w !== '');
  const out: number[] = [];
  let at = 0;
  for (const w of words) {
    const k = key(w);
    if (!whole.startsWith(k, at)) return null;
    out.push(at);
    at += k.length;
  }
  return at === whole.length ? out : null;
}

/**
 * True when `key` equals a whole entry, or holds a contains entry at a place no exception covers. With `words` (from `wordStarts`), an exception
 * covers only within one word: an occurrence that crosses a word's start excuses nothing; `words` null: no exception counts. Without it (a key
 * alone, as `NameRules.reservedProblem` gets it), an exception covers anywhere.
 */
export function matchesKeyList(list: KeyList, key: string, words?: readonly number[] | null): boolean {
  if (key === '') return false;
  if (list.whole.has(key)) return true;
  const inOneWord = (a: number, b: number): boolean => words === undefined || (words !== null && !words.some((w) => a < w && w < b));
  let covers: [number, number][] | null = null;
  for (const word of list.contains) {
    const at = starts(key, word);
    if (at.length === 0) continue;
    covers ??= list.exceptions.flatMap((e) => starts(key, e).map((s): [number, number] => [s, s + e.length])).filter(([a, b]) => inOneWord(a, b));
    if (at.some((s) => !covers!.some(([a, b]) => a <= s && s + word.length <= b))) return true;
  }
  return false;
}

/**
 * A list file's lines (MODERATION_WORDS_FILE's format, 6.4): one entry per line, `=word` only as a whole key, `!word` an exception, anything else
 * matched anywhere in a key; blank lines and lines starting with "#" are skipped. Each entry is keyed by `key`; an entry whose key is empty is skipped.
 */
export function parseKeyList(text: string, key: (s: string) => string): KeyList {
  const contains = new Set<string>();
  const whole = new Set<string>();
  const exceptions = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const kind = line[0] === '=' ? whole : line[0] === '!' ? exceptions : contains;
    const k = key(kind === contains ? line : line.slice(1).trim());
    if (k !== '') kind.add(k);
  }
  return { contains: [...contains], whole, exceptions: [...exceptions] };
}
