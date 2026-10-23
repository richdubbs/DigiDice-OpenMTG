/**
 * Names on the server (design section 6, 11.3; M14-1): the canonical key and its data versions, reserved names, the word filter. Built by M14-2 in
 * src/names/* (the factories in src/names/index.ts). The browser-safe display check is ./api/names (checkAccountName).
 */

/** The generated tables of 6.3, with their NAME_DATA_VERSION. */
export interface NameData { readonly version: number; readonly unicodeVersion: string }
export interface NameRules {
  readonly current: NameData;
  /** The previous data during a rekey (6.3), else null. */
  readonly previous: NameData | null;
  /** 6.3 under `data` (the current one by default). */
  key(display: string, data?: NameData): string;
  /** 6.2's static rules for a key (built-in words by their keys, contains-rules with exceptions, the guest suffix, the forced-rename series, the file). */
  reservedProblem(key: string): 'reserved' | null;
  /** A name in the forced-rename series, never held by a player (9.4). */
  generatedRenameName(random: (n: number) => Uint8Array): string;
}
/** The word filter (6.4): entries compared by their keys, the leet fold before keying. */
export interface NameFilter {
  check(name: { display: string; key: string }): { ok: true } | { ok: false; reason: 'word' };
}
export type CreateNameRules = (opts: { reservedNamesText: string | null; data?: NameData; previous?: NameData | null }) => NameRules;
export type CreateListNameFilter = (wordsText: string | null, rules: NameRules) => NameFilter;
