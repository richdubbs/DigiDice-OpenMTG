/**
 * The closed vocabulary of the hole grammars (design 6.11, guard G2): card types, supertypes, subtypes with plurals, colors, counter kinds, predefined
 * tokens and keywords, indexed by lower-case surface form. Built from the generated lexicon (parser/lexicon.generated.json, WP5), which is the one source
 * of everything that grows with the game (subtypes, keywords, counter kinds, predefined tokens: CR 111.10 gets a new entry about once a year). Only the
 * sets that cannot change are written here: card types (CR 205.2a), supertypes (CR 205.4) and colors (CR 105.1), so the grammars work while the generated
 * lexicon is still empty. Owner: WP6.
 *
 * The caches below are keyed by the lexicon object and the keywords array; both are loaded once and not edited.
 */
import type { Color } from '../../types/mana';
import type { Lexicon, ParseOptions } from '../types';

/** FAST5 T59: subtypes whose Oracle plural is spelled like the singular although the generated lexicon says otherwise. */
const SAME_PLURAL: ReadonlySet<string> = new Set(['spacecraft', 'equipment']); // std-rg: Oracle writes "Equipment" for the plural too ("any number of target Equipment you control")

/** `both`: the plural is spelled like the singular (Eldrazi, Merfolk, Plains, Sheep): the entry is `plural: false, both: true` and means either number. */
export interface WordEntry { name: string; plural: boolean; both?: boolean }
export interface SubtypeEntry extends WordEntry { cls: string }
export interface KeywordEntry { name: string; params: string[] }

export interface Vocab {
  types: ReadonlyMap<string, WordEntry>;
  supertypes: ReadonlyMap<string, WordEntry>;
  subtypes: ReadonlyMap<string, SubtypeEntry>;
  colors: ReadonlyMap<string, Color>;
  counterKinds: ReadonlySet<string>;
  predefined: ReadonlyMap<string, WordEntry>;
  keywords: ReadonlyMap<string, KeywordEntry>;
  /** Longest multi-word entry (in words) of subtypes and keywords, bounding the lookahead. */
  maxWords: number;
}

const CR_TYPES: [string, string][] = [
  ['artifact', 'artifacts'], ['battle', 'battles'], ['creature', 'creatures'], ['enchantment', 'enchantments'], ['instant', 'instants'],
  ['kindred', 'kindreds'], ['land', 'lands'], ['planeswalker', 'planeswalkers'], ['sorcery', 'sorceries'],
];
const CR_SUPERTYPES = ['basic', 'legendary', 'ongoing', 'snow', 'world'];
const CR_COLORS: [string, Color][] = [['white', 'W'], ['blue', 'U'], ['black', 'B'], ['red', 'R'], ['green', 'G']];

const cap = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));
const capWords = (s: string): string => s.split(' ').map(cap).join(' ');
const key = (s: string): string => s.toLowerCase().replace(/’/g, "'");

const cache = new WeakMap<object, Map<ParseOptions['keywords'], Vocab>>();

/** The vocabulary for a lexicon and keyword list (memoized per pair). */
export function vocabOf(lexicon: Lexicon, keywords: ParseOptions['keywords']): Vocab {
  let byKw = cache.get(lexicon);
  if (byKw === undefined) { byKw = new Map(); cache.set(lexicon, byKw); }
  const hit = byKw.get(keywords);
  if (hit !== undefined) return hit;
  const v = build(lexicon, keywords);
  byKw.set(keywords, v);
  return v;
}

function build(lex: Lexicon, keywords: ParseOptions['keywords']): Vocab {
  const types = new Map<string, WordEntry>();
  for (const [s, p] of CR_TYPES) { types.set(s, { name: cap(s), plural: false }); types.set(p, { name: cap(s), plural: true }); }
  for (const t of lex.cardTypes) {
    const name = cap(t);
    const k = key(t);
    if (!types.has(k)) {
      types.set(k, { name, plural: false });
      types.set(k.endsWith('y') ? `${k.slice(0, -1)}ies` : `${k}s`, { name, plural: true });
    }
  }
  const supertypes = new Map<string, WordEntry>();
  for (const s of [...CR_SUPERTYPES, ...lex.supertypes.map(key)]) supertypes.set(s, { name: cap(s), plural: false });

  const subtypes = new Map<string, SubtypeEntry>();
  let maxWords = 1;
  for (const st of lex.subtypes) {
    const singular = key(st.singular);
    const plural = key(st.plural);
    // FAST5 T59: Oracle writes "Spacecraft" for the plural too ("Exile all creatures and Spacecraft"); the generated lexicon spells it "Spacecrafts"
    if (plural === singular || SAME_PLURAL.has(singular)) subtypes.set(singular, { name: st.singular, plural: false, both: true, cls: st.class });
    else {
      subtypes.set(singular, { name: st.singular, plural: false, cls: st.class });
      if (!subtypes.has(plural)) subtypes.set(plural, { name: st.singular, plural: true, cls: st.class });
    }
    maxWords = Math.max(maxWords, singular.split(' ').length, plural.split(' ').length);
    // pc-keywords-mana-1 (CR 205.3i): the land type "Urza's" (Urza's Mine, Urza's Tower, Urza's Power-Plant) has a possessive: two tokens for the tokenizer ("urza", "'s"),
    // as in a keyword name below
    const split = singular.replace(/(\w)'s\b/g, "$1 's");
    if (split !== singular) {
      subtypes.set(split, subtypes.get(singular)!);
      maxWords = Math.max(maxWords, split.split(' ').length);
    }
  }

  const colors = new Map<string, Color>(CR_COLORS);
  for (const c of lex.colors) if (/^[WUBRG]$/.test(c.color)) colors.set(key(c.word), c.color as Color);

  const counterKinds = new Set<string>(lex.counterKinds.map(key));

  const predefined = new Map<string, WordEntry>();
  for (const n of lex.predefinedTokens.map((p) => p.name)) {
    predefined.set(key(n), { name: capWords(n), plural: false });
    predefined.set(`${key(n)}s`, { name: capWords(n), plural: true });
    maxWords = Math.max(maxWords, n.split(' ').length);
  }

  const kws = new Map<string, KeywordEntry>();
  for (const k of keywords) {
    const entry = { name: k.name, params: [...k.params] };
    kws.set(key(k.name), entry);
    // FAST5X-4: a name ending in "!" ("Start your engines!", CR 702.179) is looked up by its words; the Keyword hole (holes/misc.ts) then wants the "!" token
    if (k.name.endsWith('!')) kws.set(key(k.name.slice(0, -1)), entry);
    for (const a of k.aliases) kws.set(key(a), entry);
    // cmd1 (CR 702.124m): a possessive in a keyword name ("Doctor's companion") is two words for the tokenizer ("doctor", "'s"), as after a subtype or "~"
    const split = key(k.name).replace(/(\w)'s\b/g, "$1 's");
    if (split !== key(k.name)) kws.set(split, entry);
    maxWords = Math.max(maxWords, split.split(' ').length);
  }
  if (keywords.length === 0) for (const k of lex.keywordAbilities) { kws.set(key(k.name), { name: key(k.name), params: [] }); maxWords = Math.max(maxWords, k.name.split(' ').length); }

  return { types, supertypes, subtypes, colors, counterKinds, predefined, keywords: kws, maxWords };
}
