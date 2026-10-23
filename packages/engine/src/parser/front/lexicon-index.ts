/**
 * Lookup tables over the lexicon (design 6.11) for the front end: lower-case sets, the keyword name matcher, number words. Pure; memoized per lexicon object.
 *
 * The lexicon itself is generated from the Comprehensive Rules (scripts/gen-lexicon.ts); this module adds nothing to it except the *forms* of words the
 * rules state in prose ("<x>walk" for landwalk, "<x>cycling" for typecycling, number words), which are structure rather than vocabulary.
 */
import generated from '../lexicon.generated.json';
import indexGenerated from '../lexicon.index.generated.json';
import type { Lexicon, ParseOptions } from '../types';

/** The words of the Comprehensive Rules alone (lexicon.generated.json; the CR edition is recorded inside). */
export const CR_LEXICON: Lexicon = generated as unknown as Lexicon;

/**
 * The checked-in lexicon: the CR words plus the subtypes that cards of the Oracle index use and the CR edition does not list yet (lexicon.index.generated.json,
 * design 6.11). Tests and tools that have no `ParseOptions` use this one.
 */
export const GENERATED_LEXICON: Lexicon = { ...CR_LEXICON, subtypes: [...CR_LEXICON.subtypes, ...(indexGenerated as unknown as { subtypes: Lexicon['subtypes'] }).subtypes] };

export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  // std-rg: the number words past twenty that Oracle spells as one hyphenated word, "twenty-five" (Jace, Reality Sculptor); the tens, and tens-and-ones up to ninety-nine
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ...Object.fromEntries(
    Object.entries({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }).flatMap(([tens, t]) =>
      Object.entries({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }).map(([ones, o]) => [`${tens}-${ones}`, t + o] as const)),
  ),
};

export interface LexiconIndex {
  readonly lexicon: Lexicon;
  /** Lower-case card types / supertypes / colors / subtype singulars and plurals. */
  readonly cardTypes: ReadonlySet<string>;
  readonly supertypes: ReadonlySet<string>;
  readonly colors: ReadonlySet<string>;
  readonly subtypes: ReadonlySet<string>;
  /** Subtypes of the non-creature classes, lower case (artifact, enchantment, land, planeswalker, battle, spell types). */
  readonly nonCreatureSubtypes: ReadonlySet<string>;
  /** Lower-case ability words (CR 207.2c). */
  readonly abilityWords: ReadonlySet<string>;
  /** Lower-case keyword ability name (and registry alias) to its canonical name. */
  readonly keywordNames: ReadonlyMap<string, string>;
  /** Keyword names by first word, longest first. */
  readonly keywordsByFirstWord: ReadonlyMap<string, readonly string[]>;
}

const cache = new WeakMap<Lexicon, WeakMap<object, LexiconIndex>>();
const NO_KEYWORDS: object = {};

export function lexiconIndex(lexicon: Lexicon = GENERATED_LEXICON, keywords?: ParseOptions['keywords']): LexiconIndex {
  let byKeywords = cache.get(lexicon);
  if (!byKeywords) cache.set(lexicon, (byKeywords = new WeakMap()));
  const key = keywords ?? NO_KEYWORDS;
  const hit = byKeywords.get(key);
  if (hit) return hit;
  const built = build(lexicon, keywords);
  byKeywords.set(key, built);
  return built;
}

function build(lexicon: Lexicon, keywords: ParseOptions['keywords'] | undefined): LexiconIndex {
  const lower = (xs: readonly string[]): Set<string> => new Set(xs.map((x) => x.toLowerCase()));
  const subtypes = new Set<string>();
  const nonCreature = new Set<string>();
  for (const s of lexicon.subtypes) {
    for (const w of [s.singular, s.plural]) {
      subtypes.add(w.toLowerCase());
      if (s.class !== 'creature') nonCreature.add(w.toLowerCase());
    }
  }
  const keywordNames = new Map<string, string>();
  for (const k of lexicon.keywordAbilities) keywordNames.set(k.name.toLowerCase(), k.name);
  for (const k of keywords ?? []) {
    keywordNames.set(k.name.toLowerCase(), k.name);
    for (const a of k.aliases) keywordNames.set(a.toLowerCase(), k.name);
  }
  const byFirst = new Map<string, string[]>();
  for (const name of keywordNames.keys()) {
    const first = name.split(' ')[0]!;
    const list = byFirst.get(first);
    if (list) list.push(name);
    else byFirst.set(first, [name]);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return {
    lexicon,
    cardTypes: lower(lexicon.cardTypes),
    supertypes: lower(lexicon.supertypes),
    colors: new Set(lexicon.colors.map((c) => c.word.toLowerCase())),
    subtypes,
    nonCreatureSubtypes: nonCreature,
    abilityWords: lower(lexicon.abilityWords),
    keywordNames,
    keywordsByFirstWord: byFirst,
  };
}

const WORD_CHAR = /[\p{L}\p{N}'-]/u;

/** `text` (lower case) has `word` at `pos` and the word ends there. */
function wordAt(text: string, pos: number, word: string): boolean {
  if (!text.startsWith(word, pos)) return false;
  const next = text[pos + word.length];
  return next === undefined || !WORD_CHAR.test(next);
}

const WALK_MODIFIERS = new Set(['snow', 'nonbasic', 'legendary', 'basic']);

export interface KeywordHit {
  /** Canonical keyword name (lexicon / registry spelling). */
  name: string;
  /** Length in characters of the keyword name as written, from `pos`. */
  length: number;
}

/**
 * The keyword ability whose name starts at `pos` of `lower` (the text, lower case), or undefined. Longest name wins. Families the rules describe in prose are
 * recognised as well: "<x>walk" and "[nonbasic|legendary|snow] landwalk" are landwalk (CR 702.14), "<x>cycling" and "basic landcycling" are cycling (CR 702.29),
 * "commander ninjutsu" is the keyword of that name, or ninjutsu when the keyword library is not loaded (CR 702.49d).
 */
export function keywordAt(ix: LexiconIndex, lower: string, pos: number): KeywordHit | undefined {
  if (lower[pos] === '∞') return ix.keywordNames.has('∞') ? { name: '∞', length: 1 } : undefined; // CR 702.186
  const m = /^[\p{L}][\p{L}'-]*/u.exec(lower.slice(pos, pos + 40));
  if (!m) return undefined;
  const first = m[0];
  const cands = ix.keywordsByFirstWord.get(first);
  if (cands) {
    for (const name of cands) if (wordAt(lower, pos, name)) return { name: ix.keywordNames.get(name)!, length: name.length };
  }
  if (first === 'commander') {
    // M11-4 (CR 702.49d): commander ninjutsu is its own keyword (keywords/data/commander-ninjutsu.json: it also functions in the command zone); only a lexicon
    // without the keyword library's names reads it as ninjutsu, the variant it is
    const rest = /^commander ninjutsu\b/.exec(lower.slice(pos));
    if (rest) return { name: ix.keywordNames.get('commander ninjutsu') ?? ix.keywordNames.get('ninjutsu') ?? 'Ninjutsu', length: rest[0].length };
  }
  const family = (word: string, suffix: string, canonical: string): KeywordHit | undefined =>
    word.length > suffix.length && word.endsWith(suffix) && word !== 'planeswalk' ? { name: ix.keywordNames.get(canonical.toLowerCase()) ?? canonical, length: word.length } : undefined;
  const fw = family(first, 'walk', 'Landwalk') ?? family(first, 'cycling', 'Cycling');
  if (fw) return fw;
  if (WALK_MODIFIERS.has(first)) {
    const second = /^ ([\p{L}-]+)/u.exec(lower.slice(pos + first.length, pos + first.length + 30));
    if (second) {
      const hit = family(second[1]!, 'walk', 'Landwalk') ?? family(second[1]!, 'cycling', 'Cycling');
      if (hit) return { name: hit.name, length: first.length + 1 + hit.length };
    }
  }
  return undefined;
}
