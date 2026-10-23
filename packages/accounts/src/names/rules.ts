/**
 * M14-2: NameRules (design 6.2, 6.3, 9.4): the canonical key under a name data version, the static reserved-name rules, and the forced-rename
 * series. Server only.
 */
import { ACCOUNT_LIMITS } from '../api/limits';
import type { CreateNameRules, NameData, NameRules } from './api';
import { CURRENT_NAME_DATA, PREVIOUS_NAME_DATA, tablesOf } from './data';
import { canonicalKey } from './key';
import { matchesKeyList, wordStarts, type KeyList } from './match';
import {
  DEFAULT_RESERVED_NAMES, RENAME_SERIES_DIGITS, RENAME_SERIES_PREFIX, RESERVED_CONTAINS, RESERVED_EXACT, RESERVED_EXCEPTIONS, RESERVED_SUFFIX,
} from './reserved';

/** 6.2's static rules with every word keyed under one data version. */
interface Reserved {
  /** The built-in words (equal and contains, with their exceptions). */
  builtIn: KeyList;
  /** The lines of RESERVED_NAMES_FILE (or its default), each matched as a whole key; its `!word` lines are exceptions of the contains-rules. */
  file: ReadonlySet<string>;
  suffix: string;
  /** The forced-rename series: the prefix's key, then keys of the digits. */
  seriesPrefix: string;
  digitKeys: readonly string[];
}

function reservedUnder(key: (s: string) => string, fileText: string): Reserved {
  const file = new Set<string>();
  const exceptions = new Set(RESERVED_EXCEPTIONS.map(key));
  for (const raw of fileText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('!')) exceptions.add(key(line.slice(1).trim()));
    else file.add(key(line));
  }
  file.delete('');
  exceptions.delete('');
  const builtIn: KeyList = {
    contains: [...new Set(RESERVED_CONTAINS.map(key))].filter((k) => k !== ''),
    whole: new Set(RESERVED_EXACT.map(key).filter((k) => k !== '')),
    exceptions: [...exceptions],
  };
  const digitKeys = [...new Set(Array.from('0123456789', key))].filter((k) => k !== '');
  return { builtIn, file, suffix: key(RESERVED_SUFFIX), seriesPrefix: key(RENAME_SERIES_PREFIX), digitKeys };
}

/**
 * The longest key `reservedProblem` reads; a longer one is reserved. A valid name has at most ACCOUNT_LIMITS.nameMax code points and no character
 * keys to more than 15 (U+FDFA; test/m14-2/key.test.ts checks it), so no name's key comes near; the bound only keeps the work small.
 */
export const RESERVED_KEY_MAX = 4 * ACCOUNT_LIMITS.nameRawMax;

/** NameRules as createNameRules makes them: `reservedProblem` also takes the display (see createNameRules). */
export interface DisplayAwareNameRules extends NameRules {
  reservedProblem(key: string, display?: string): 'reserved' | null;
}

/** True when `rest` is one or more keys of the digit alphabet, end to end (a key of a digit may be longer than one character). */
function digitsOnly(rest: string, digitKeys: readonly string[]): boolean {
  if (rest === '') return false;
  const reach = new Array<boolean>(rest.length + 1).fill(false);
  reach[0] = true;
  for (let i = 0; i < rest.length; i++) {
    if (!reach[i]) continue;
    for (const d of digitKeys) if (rest.startsWith(d, i)) reach[i + d.length] = true;
  }
  return reach[rest.length]!;
}

function isReserved(r: Reserved, key: string, words: readonly number[] | null | undefined): boolean {
  if (matchesKeyList(r.builtIn, key, words)) return true;
  if (r.file.has(key)) return true;
  if (r.suffix !== '' && key.endsWith(r.suffix)) return true;
  return r.seriesPrefix !== '' && key.startsWith(r.seriesPrefix) && digitsOnly(key.slice(r.seriesPrefix.length), r.digitKeys);
}

/**
 * NameRules on `data` (the generated current data by default) and `previous` (by default the generated previous data when `data` is the default
 * too, else none). `reservedNamesText` is RESERVED_NAMES_FILE's text; null takes DEFAULT_RESERVED_NAMES. A line of it is a name, compared by its key;
 * a line `!word` adds an exception to the contains-rules beside RESERVED_EXCEPTIONS (a "!" never occurs in a name, so the two cannot be confused).
 *
 * During a rekey (`previous` set), every reserved word is keyed under both versions and a key is reserved when it matches either, so a key computed
 * under the version the store still uses is checked as strictly as one under the new data (6.3: registration and rename check both keys).
 *
 * `reservedProblem('')` is 'reserved' (INTERFACE CHANGE, review of M14-2): a name of letters that look like apostrophes keys to nothing, so the
 * service answers nameReserved, the same for every such name, and no account holds the empty key. So is a key longer than RESERVED_KEY_MAX. `key`
 * of a display longer than ACCOUNT_LIMITS.nameRawMax is '' (INTERFACE CHANGE): the work of a key is bounded whoever calls it.
 *
 * `reservedProblem(key, display)` (INTERFACE CHANGE: an optional second argument that ./api.ts's NameRules does not declare yet): given the display
 * the key was made from, an exception of the contains-rules counts only inside one of its words, as in the word filter, so "B Admin Ton" (key
 * "badrnlnton", the key of "badminton") is reserved while "Badminton Club" is not. Without it, an exception counts anywhere in the key.
 */
export const createNameRules: CreateNameRules = (opts) => {
  const current = opts.data ?? CURRENT_NAME_DATA;
  const previous = opts.previous !== undefined ? opts.previous : opts.data === undefined ? PREVIOUS_NAME_DATA : null;
  tablesOf(current);
  if (previous !== null) {
    tablesOf(previous);
    if (previous.version === current.version) throw new Error(`the previous name data has the current version (${current.version})`);
  }
  const text = opts.reservedNamesText ?? DEFAULT_RESERVED_NAMES;
  // A display longer than nameRawMax UTF-16 units (never a valid name: checkAccountName refuses it before any work) keys to '' without any work,
  // the key no account holds (reservedProblem('') is 'reserved'); so a caller that keys a raw client string first (sign-in, guest names at hello)
  // still gets an answer in bounded time.
  const key = (display: string, data: NameData = current): string => {
    if (typeof display !== 'string') throw new TypeError('a name key needs a string');
    const tables = tablesOf(data);
    return display.length > ACCOUNT_LIMITS.nameRawMax ? '' : canonicalKey(tables, display);
  };
  const reserved = [current, ...(previous === null ? [] : [previous])].map((d) => reservedUnder((s) => key(s, d), text));

  const rules: DisplayAwareNameRules = {
    current,
    previous,
    key,
    // The empty key is reserved: a name made only of letters that look like apostrophes ("ʼʼʼ", 6.1 counts them as letters) keys to nothing, and
    // no account may hold the one key every such name shares.
    reservedProblem(k: string, display?: string) {
      if (k === '' || k.length > RESERVED_KEY_MAX) return 'reserved';
      // With the display, an exception counts only inside one of its words, in the key's own version ("B Admin Ton" is reserved, "Badminton Club"
      // is not); with the key alone, anywhere.
      let words: number[] | null | undefined;
      if (typeof display === 'string' && display.length <= ACCOUNT_LIMITS.nameRawMax) {
        const made = [current, ...(previous === null ? [] : [previous])].find((d) => key(display, d) === k);
        if (made !== undefined) words = wordStarts(display, (s) => key(s, made), k);
      }
      return reserved.some((r) => isReserved(r, k, words)) ? 'reserved' : null;
    },
    generatedRenameName(random) {
      let digits = '';
      // Uniform digits by rejection: a byte of 250 or more is drawn again. A source that never gives a usable byte is a bug, not bad luck.
      for (let draws = 0; digits.length < RENAME_SERIES_DIGITS; draws++) {
        if (draws >= 64) throw new Error('generatedRenameName: the random source gave no usable bytes');
        const bytes = random(RENAME_SERIES_DIGITS * 2);
        if (!(bytes instanceof Uint8Array)) throw new TypeError('generatedRenameName: the random source must give a Uint8Array');
        for (const b of bytes) if (b < 250 && digits.length < RENAME_SERIES_DIGITS) digits += String(b % 10);
      }
      return `${RENAME_SERIES_PREFIX} ${digits}`;
    },
  };
  return Object.freeze(rules);
};
