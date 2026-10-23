/**
 * M14-2: ListNameFilter (design 6.4), the default NameFilter. It reads MODERATION_WORDS_FILE's text (the file m13's title filter reads), or a short
 * built-in list when that is unset. Every entry is compared by its key, computed once when the filter is built; a name is checked by its key, and
 * again by the key of its "leet" fold. Server only.
 */
import type { CreateListNameFilter, NameFilter } from './api';
import { ACCOUNT_LIMITS } from '../api/limits';
import { tablesOf } from './data';
import { skeletonKey, type KeyTables } from './key';
import { matchesKeyList, parseKeyList, wordStarts } from './match';

/** What the service tells the player for a filtered name (`nameFiltered`); it never repeats the matched word. */
export const NAME_FILTERED_MESSAGE = 'This name is not allowed';

/**
 * The built-in list, in MODERATION_WORDS_FILE's format (one entry per line; `=word` only as a whole key; `!word` an exception; "#" comments).
 * Short on purpose: an operator supplies a real list. Short words that hide inside ordinary names are whole-key entries ("Yoshito" holds "shit").
 */
export const DEFAULT_MODERATION_WORDS = `# Built-in name filter (MODERATION_WORDS_FILE unset). word: anywhere in the key; =word: the whole key; !word: an exception.
=shit
bullshit
shithead
fuck
cunt
!scunthorpe
bitch
whore
=slut
nigger
nigga
faggot
hitler
=rape
`;

/** The leet fold of 6.4, only for the filter: 4 to a, 3 to e, 5 to s, 7 to t (the key already reads 1 and i as "l", and 0 as "o"). */
const LEET: Readonly<Record<string, string>> = { '4': 'a', '3': 'e', '5': 's', '7': 't' };
export function leetFold(s: string): string {
  return s.replace(/[4357]/g, (d) => LEET[d]!);
}

/**
 * The word filter over `wordsText` (null: DEFAULT_MODERATION_WORDS), keyed by `rules.key` under the current data. `check` refuses a name when the key
 * it is given, its key under the current data, or the key of its leet-folded NFKC display form matches an entry; the answer names no word.
 *
 * It also checks the skeleton keys of both forms (./key.ts, skeletonKey: each character to its prototype before case folding; INTERFACE CHANGE,
 * review of M14-2), so a capital that the key reads by its small letter still spells the word: "ЅНІТ" (Cyrillic, key "sʜlt") is refused like
 * "SHIT". A filter may refuse more than the key keeps apart; it decides nothing about who owns a name. Rules on data this module did not make (a
 * test's fake) get no skeleton check.
 *
 * An exception counts only inside one word of the display (./match.ts, wordStarts; review of M14-2): "Scunthorpe" and "Scunthorpe FC" pass,
 * "S Cunt Horpe" does not. The key it is given (perhaps under the other data version during a rekey) has no display to split, so there an
 * exception counts anywhere; the display's own keys are checked by words in any case.
 */
export const createListNameFilter: CreateListNameFilter = (wordsText, rules) => {
  const list = parseKeyList(wordsText ?? DEFAULT_MODERATION_WORDS, (w) => rules.key(w));
  let tables: KeyTables | null = null;
  try {
    tables = tablesOf(rules.current);
  } catch {
    tables = null;
  }
  const filter: NameFilter = {
    check(name) {
      const leet = leetFold(name.display.normalize('NFKC'));
      const forms: [string, (s: string) => string][] = [[name.display, (s) => rules.key(s)], [leet, (s) => rules.key(s)]];
      if (tables !== null && name.display.length <= ACCOUNT_LIMITS.nameRawMax) {
        const t = tables;
        forms.push([name.display, (s) => skeletonKey(t, s)], [leet, (s) => skeletonKey(t, s)]);
      }
      for (const [display, key] of forms) {
        const k = key(display);
        if (matchesKeyList(list, k, wordStarts(display, key, k))) return { ok: false, reason: 'word' };
      }
      if (matchesKeyList(list, name.key)) return { ok: false, reason: 'word' };
      return { ok: true };
    },
  };
  return Object.freeze(filter);
};
