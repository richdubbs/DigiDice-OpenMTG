/**
 * Generates the parser's word lists (design 6.11, WP5):
 *
 *   packages/engine/src/parser/lexicon.generated.json         from the Comprehensive Rules (a function of the CR edition alone)
 *   packages/engine/src/parser/lexicon.index.generated.json   the subtypes that cards of the local Oracle index use and the CR edition does not list yet
 *                                                             (sets newer than the rules: "Officer", "Klingon"), with their classes and plurals
 *   packages/engine/src/statics/printed-creature-types.generated.json   the creature types printed on cards of the game's own sets that the CR edition does not
 *                                                             list yet, certain ones only: what the rules engine adds to its creature-type list (trek-10). It only
 *                                                             grows (an older index cannot drop a type); the check against an index is one-way
 *
 *   npx tsx scripts/gen-lexicon.ts            write the files
 *   npx tsx scripts/gen-lexicon.ts --check    exit 1 when a checked-in file differs from what its inputs produce (the staleness tests do the same)
 *   npx tsx scripts/gen-lexicon.ts --index-only [--check]   without rules/cr (a cloud session): the checked-in lexicon.generated.json stands for the rules; only the
 *                                             two files read from the Oracle index are written (or checked)
 *
 * Input: the split rules in <repo>/rules/cr/ (git-ignored Wizards text: only names are copied into the output, never rule prose) and the Oracle index
 * <repo>/.cache/scryfall/cards.jsonl (git-ignored Scryfall data: only subtype words are copied). Override the locations with OPENMTG_RULES_DIR and
 * OPENMTG_CACHE_DIR. In a git worktree without its own rules/ or .cache/ folder the main checkout's is used. Without the index the second file is left as it is.
 *
 * The output holds words only: card types (CR 205.2a), supertypes (205.4a), subtypes with plural forms (205.3g-q), colors (105.1),
 * keyword abilities (702 headings), keyword actions (701 headings, with verb forms), counter kinds (122, 702, 714...),
 * predefined tokens (111.10) and ability words (207.2c). Everything is a function of the rules text plus the short tables below
 * (irregular plurals and verbs, which the rules do not contain). Output is deterministic: no clock, no ordering by hash.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Lexicon } from '../packages/engine/src/parser/types';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const LEXICON_PATH = join(REPO_ROOT, 'packages/engine/src/parser/lexicon.generated.json');
export const INDEX_LEXICON_PATH = join(REPO_ROOT, 'packages/engine/src/parser/lexicon.index.generated.json');
export const PRINTED_CREATURE_TYPES_PATH = join(REPO_ROOT, 'packages/engine/src/statics/printed-creature-types.generated.json');

/** Finds rules/cr: OPENMTG_RULES_DIR, then <repo>/rules/cr, then (git worktree) the main checkout's rules/cr. Undefined when the rules are not on this machine. */
export function findCrRoot(repoRoot: string = REPO_ROOT, env: Record<string, string | undefined> = process.env): string | undefined {
  const override = env['OPENMTG_RULES_DIR']?.trim();
  if (override) return existsSync(join(override, 'INDEX.md')) ? override : existsSync(join(override, 'cr', 'INDEX.md')) ? join(override, 'cr') : undefined;
  const own = join(repoRoot, 'rules', 'cr');
  if (existsSync(join(own, 'INDEX.md'))) return own;
  const main = mainCheckout(repoRoot);
  const cand = main ? join(main, 'rules', 'cr') : undefined;
  return cand && existsSync(join(cand, 'INDEX.md')) ? cand : undefined;
}

/** The main checkout when `repoRoot` is a git worktree (its ".git" is a FILE: "gitdir: <main>/.git/worktrees/<name>"), else undefined. */
function mainCheckout(repoRoot: string): string | undefined {
  const dotGit = join(repoRoot, '.git');
  if (!existsSync(dotGit) || readdirSafe(dotGit)) return undefined;
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
  return m ? resolve(resolve(repoRoot, m[1]!.trim()), '..', '..', '..') : undefined;
}

/** Finds the local Oracle index (cards.jsonl): OPENMTG_CACHE_DIR, then <repo>/.cache/scryfall, then (git worktree) the main checkout's. Undefined when there is none. */
export function findCardsFile(repoRoot: string = REPO_ROOT, env: Record<string, string | undefined> = process.env): string | undefined {
  const override = env['OPENMTG_CACHE_DIR']?.trim();
  const main = mainCheckout(repoRoot);
  const candidates = override ? [join(override, 'cards.jsonl')] : [join(repoRoot, '.cache', 'scryfall', 'cards.jsonl'), ...(main ? [join(main, '.cache', 'scryfall', 'cards.jsonl')] : [])];
  return candidates.find((c) => existsSync(c));
}

function readdirSafe(p: string): string[] | undefined {
  try {
    return readdirSync(p);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------------------------------------------------------------------

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...filesUnder(p));
    else if (name.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Curly apostrophes and quotes to ASCII: the parser normalizes Oracle text the same way (design 6.2). */
const ascii = (s: string): string => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

class Rules {
  private readonly lines: string[] = [];
  constructor(readonly root: string) {
    for (const f of filesUnder(root)) for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) this.lines.push(ascii(line));
  }
  /** The text of rule `num` (e.g. "205.3m", "702.9."), without its number. Throws when missing: a changed edition must be looked at, not guessed. */
  rule(num: string): string {
    const re = new RegExp(`^${num.replace(/\./g, '\\.')}\\.? (.*)$`);
    for (const l of this.lines) {
      const m = re.exec(l);
      if (m) return m[1]!;
    }
    throw new Error(`gen-lexicon: rule ${num} not found in ${this.root}`);
  }
  /** Every line matching `re` (applied to the line, number included). */
  grep(re: RegExp): string[] {
    return this.lines.filter((l) => re.test(l));
  }
  /** Section headings "70x.N. Name" (a rule line with a short name and no sentence). */
  headings(section: 701 | 702): { num: string; name: string }[] {
    const out: { num: string; name: string }[] = [];
    const re = new RegExp(`^(${section}\\.\\d+)\\. (.{1,60})$`);
    for (const l of this.lines) {
      const m = re.exec(l);
      if (!m) continue;
      const name = m[2]!;
      if (/[.]$/.test(name) || name.split(' ').length > 8) continue; // 701.1 / 702.1 are sentences
      if (m[1] === `${section}.1`) continue;
      out.push({ num: m[1]!, name });
    }
    return out;
  }
  edition(): string {
    const idx = readFileSync(join(this.root, 'INDEX.md'), 'utf8');
    const m = /effective (\d{4}-\d{2}-\d{2})/.exec(idx);
    if (!m) throw new Error('gen-lexicon: cannot read the CR edition date from INDEX.md');
    return m[1]!;
  }
}

/** "a, b (see rule 3), c, and d." -> ["a","b","c","d"] */
function splitList(list: string): string[] {
  const clean = list.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  // "a and b" (a list of two has no comma); a longer list is "a, b, and c".
  return (clean.includes(',') ? clean.split(/\s*,\s*/) : clean.split(/\s+and\s+/))
    .map((s) => s.trim().replace(/^and\s+/, '').replace(/\.$/, ''))
    .filter(Boolean);
}

/** The list after the first occurrence of `marker`, up to the first sentence end (". " or end of line). */
function listAfter(text: string, marker: string): string[] {
  const i = text.indexOf(marker);
  if (i < 0) throw new Error(`gen-lexicon: marker "${marker}" not found in "${text.slice(0, 80)}"`);
  const rest = text.slice(i + marker.length);
  const end = rest.search(/\.(\s|$)/);
  return splitList(end < 0 ? rest : rest.slice(0, end));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Short tables the rules do not contain
// ---------------------------------------------------------------------------------------------------------------------------------

/** Irregular plurals of subtypes, checked against the plural usage in the Oracle corpus (see test/m5/parser/lexicon.test.ts). Keyed by singular. */
export const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  Dwarf: 'Dwarves',
  Elf: 'Elves',
  Wolf: 'Wolves',
  Werewolf: 'Werewolves',
  Fungus: 'Fungi',
  Mouse: 'Mice',
  Ox: 'Oxen',
  Child: 'Children',
  Pegasus: 'Pegasi',
  Cyclops: 'Cyclopes',
  Homunculus: 'Homunculi',
  Octopus: 'Octopuses',
  Walrus: 'Walruses',
  Nautilus: 'Nautiluses',
  Mongoose: 'Mongooses',
  Hero: 'Heroes',
  Cyberman: 'Cybermen',
  Borg: 'Borg',
  'Time Lord': 'Time Lords',
  Plains: 'Plains',
  // Same form in the singular and the plural.
  Aetherborn: 'Aetherborn',
  Astartes: 'Astartes',
  Aurochs: 'Aurochs',
  Custodes: 'Custodes',
  Gith: 'Gith',
  Kree: 'Kree',
  Myr: 'Myr',
  Qu: 'Qu',
  Samurai: 'Samurai',
  Elk: 'Elk',
  "Urza's": "Urza's",
  "Ulamog's": "Ulamog's",
  Bison: 'Bison',
  Caribou: 'Caribou',
  Dauthi: 'Dauthi',
  Djinn: 'Djinn',
  Eldrazi: 'Eldrazi',
  Fish: 'Fish',
  Kithkin: 'Kithkin',
  Kor: 'Kor',
  Merfolk: 'Merfolk',
  Moonfolk: 'Moonfolk',
  Nephilim: 'Nephilim',
  Sheep: 'Sheep',
  Soltari: 'Soltari',
  Spawn: 'Spawn',
  Starfish: 'Starfish',
  Surrakar: 'Surrakar',
  Thalakos: 'Thalakos',
  Treefolk: 'Treefolk',
  Zubera: 'Zubera',
  "C'tan": "C'tan",
  "Shi'ar": "Shi'ar",
};

export function pluralize(singular: string): string {
  const irregular = IRREGULAR_PLURALS[singular];
  if (irregular !== undefined) return irregular;
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`;
  return `${singular}s`;
}

/** Verb forms of a keyword action: [base, third person, past participle, gerund] (lower case). The rules name the verb phrase; only the verb word is inflected. */
const VERB_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  fight: ['fights', 'fought', 'fighting'],
  cast: ['casts', 'cast', 'casting'],
  set: ['sets', 'set', 'setting'],
  tap: ['taps', 'tapped', 'tapping'],
  untap: ['untaps', 'untapped', 'untapping'],
  scry: ['scries', 'scried', 'scrying'],
  surveil: ['surveils', 'surveilled', 'surveilling'],
  mill: ['mills', 'milled', 'milling'],
  roll: ['rolls', 'rolled', 'rolling'],
  open: ['opens', 'opened', 'opening'],
  learn: ['learns', 'learned', 'learning'],
  behold: ['beholds', 'beheld', 'beholding'],
  monstrosity: [],
};

function verbForms(word: string): string[] {
  const ex = VERB_EXCEPTIONS[word];
  if (ex) return [word, ...ex]; // an empty list = a noun-named action that has no verb forms ("monstrosity 3")
  const third = /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
  const past = word.endsWith('e') ? `${word}d` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ied` : `${word}ed`;
  const ger = word.endsWith('e') && !word.endsWith('ee') ? `${word.slice(0, -1)}ing` : `${word}ing`;
  return [word, third, past, ger];
}

/** Which word of the action name is the verb (default: the first). */
const VERB_INDEX: Readonly<Record<string, number>> = { 'time travel': 1 };

/** Phrases that are fixed expressions rather than a verb plus complement. */
const FIXED_ACTIONS: Readonly<Record<string, string[]>> = { 'the ring tempts you': ['the ring tempts you'] };

function actionForms(name: string): string[] {
  const phrase = name.toLowerCase();
  const fixed = FIXED_ACTIONS[phrase];
  if (fixed) return fixed;
  const words = phrase.split(' ');
  const vi = VERB_INDEX[phrase] ?? 0;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of verbForms(words[vi]!)) {
    const full = [...words.slice(0, vi), f, ...words.slice(vi + 1)].join(' ');
    if (!seen.has(full)) {
      seen.add(full);
      out.push(full);
    }
  }
  return out;
}

/** Headings that name two keywords at once. */
const SPLIT_HEADINGS: Readonly<Record<string, string[]>> = {
  'Daybound and Nightbound': ['Daybound', 'Nightbound'],
  'Tap and Untap': ['Tap', 'Untap'],
};

/** The mathematical-symbol keyword is written by its symbol in card text (702.186). */
const HEADING_ALIASES: Readonly<Record<string, string[]>> = { '∞ (Infinity)': ['∞'] };

/** Words that precede "counter(s)" in the rules without naming a kind of counter. */
const COUNTER_STOPWORDS = new Set([
  'a', 'an', 'the', 'those', 'of', 'or', 'more', 'and', 'keyword', 'move', 'given', 'with', 'using', 'to', 'that', 'states', 'specifically', 's', 'received',
  'putting', 'no', 'new', 'its', 'have', 'game', 'each', 'any', 'another', 'adds', 'additional', 'these', 'one', 'this', 'such', 'all', 'other', 'same', 'is', 'in',
  'on', 'it', 'they', 'if', 'for', 'as', 'by', 'than', 'both', 'either', 'every', 'which', 'when', 'how', 'many', 'much', 'can',
]);

// ---------------------------------------------------------------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------------------------------------------------------------

export type Generated = Lexicon & { _comment: string };

export function generateLexicon(crRoot: string): Generated {
  const cr = new Rules(crRoot);
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  const cardTypes = listAfter(cr.rule('205.2a'), 'The card types are ').map(cap);
  const supertypes = listAfter(cr.rule('205.4a'), 'The supertypes are ').map(cap);

  const subtypeLists: [Lexicon['subtypes'][number]['class'], string[]][] = [
    ['artifact', listAfter(cr.rule('205.3g'), 'The artifact types are ')],
    ['enchantment', listAfter(cr.rule('205.3h'), 'The enchantment types are ')],
    ['land', listAfter(cr.rule('205.3i'), 'The land types are ')],
    ['planeswalker', listAfter(cr.rule('205.3j'), 'The planeswalker types are ')],
    ['spell', listAfter(cr.rule('205.3k'), 'The spell types are ')],
    ['creature', ['Time Lord', ...listAfter(cr.rule('205.3m'), 'All other creature types are one word long: ')]],
    ['battle', listAfter(cr.rule('205.3q'), 'That battle type is ')],
  ];
  const subtypes: Lexicon['subtypes'] = [];
  for (const [cls, names] of subtypeLists) for (const singular of names) subtypes.push({ singular, plural: pluralize(singular), class: cls });

  const colors: Lexicon['colors'] = listAfter(cr.rule('105.1'), 'There are five colors in the Magic game: ').map((word) => ({
    word,
    color: ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as Record<string, string>)[word] ?? word,
  }));

  const keywordAbilities: Lexicon['keywordAbilities'] = [];
  for (const h of cr.headings(702)) {
    const names = HEADING_ALIASES[h.name] ?? SPLIT_HEADINGS[h.name] ?? [h.name];
    for (const name of names) keywordAbilities.push({ name, rule: h.num });
  }

  // Variants the rules name in prose: "Megamorph is a variant of the morph ability" (702.37b), and the partner abilities of 702.124.
  const seen = new Set(keywordAbilities.map((k) => k.name.toLowerCase()));
  for (const l of cr.grep(/^702\.\d+[a-z] /)) {
    const m = /^(702\.\d+[a-z]) ([A-Z][A-Za-z' -]+?) is a variant of /.exec(l);
    if (m && !seen.has(m[2]!.toLowerCase())) {
      seen.add(m[2]!.toLowerCase());
      keywordAbilities.push({ name: m[2]!, rule: m[1]! });
    }
  }
  for (const l of cr.grep(/^702\.124[a-z] /)) {
    const m = /^(702\.124[a-z]) "([A-Z][A-Za-z' ]+?)(?: \[[^\]]*\])?" (?:represents|means)/.exec(l);
    if (m && !seen.has(m[2]!.toLowerCase())) {
      seen.add(m[2]!.toLowerCase());
      keywordAbilities.push({ name: m[2]!, rule: m[1]! });
    }
  }

  const keywordActions: Lexicon['keywordActions'] = [];
  for (const h of cr.headings(701)) {
    for (const name of SPLIT_HEADINGS[h.name] ?? [h.name]) keywordActions.push({ name, rule: h.num, forms: actionForms(name) });
  }

  const counterKinds = new Set<string>();
  for (const l of cr.grep(/^\d{3}\.\d+[a-z]?\.? /)) {
    for (const m of l.matchAll(/\b([a-z]+) counters?\b/g)) if (!COUNTER_STOPWORDS.has(m[1]!)) counterKinds.add(m[1]!);
  }
  // 122.1b: the keywords a keyword counter can be.
  const kw = cr.rule('122.1b').replace(/, as well as .*$/, '.');
  for (const k of listAfter(kw, 'The keywords that a keyword counter can be are ')) counterKinds.add(k);
  // 122.1a / 122.3: the +N/+N and -N/-N families (written as in the rules text).
  for (const m of cr.rule('122.3').matchAll(/[+-]\d+\/[+-]\d+/g)) counterKinds.add(m[0]);

  const predefinedTokens: Lexicon['predefinedTokens'] = [];
  for (const l of cr.grep(/^111\.10[a-z] /)) {
    const m = /^(111\.10[a-z]) An? (.+?) token is /.exec(l);
    if (m) predefinedTokens.push({ name: m[2]!, rule: m[1]! });
  }

  const abilityWords = listAfter(cr.rule('207.2c'), 'The ability words are ');

  return {
    _comment:
      'GENERATED by scripts/gen-lexicon.ts (WP5) from rules/cr/ (design 6.11). Do not edit: run `npx tsx scripts/gen-lexicon.ts`. A test fails if this file is stale. Words only, no rules text.',
    crEdition: cr.edition(),
    cardTypes,
    supertypes,
    subtypes,
    colors,
    keywordAbilities,
    keywordActions,
    counterKinds: [...counterKinds].sort(),
    predefinedTokens,
    abilityWords,
  };
}

export function serializeLexicon(lex: Generated): string {
  // One entry per line for the long lists keeps diffs reviewable; the order of keys is fixed by `generateLexicon`.
  const line = (v: unknown): string => JSON.stringify(v);
  const arr = (a: unknown[]): string => (a.length === 0 ? '[]' : `[\n${a.map((x) => `    ${line(x)}`).join(',\n')}\n  ]`);
  return [
    '{',
    `  "_comment": ${line(lex._comment)},`,
    `  "crEdition": ${line(lex.crEdition)},`,
    `  "cardTypes": ${line(lex.cardTypes)},`,
    `  "supertypes": ${line(lex.supertypes)},`,
    `  "subtypes": ${arr(lex.subtypes)},`,
    `  "colors": ${arr(lex.colors)},`,
    `  "keywordAbilities": ${arr(lex.keywordAbilities)},`,
    `  "keywordActions": ${arr(lex.keywordActions)},`,
    `  "counterKinds": ${line(lex.counterKinds)},`,
    `  "predefinedTokens": ${arr(lex.predefinedTokens)},`,
    `  "abilityWords": ${line(lex.abilityWords)}`,
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Subtypes of the local Oracle index that the rules do not list yet
// ---------------------------------------------------------------------------------------------------------------------------------

/** The part of an Oracle card the index reader needs. */
export interface IndexCard {
  type_line?: string;
  oracle_text?: string;
  /** Scryfall's set type: "funny" (Un-sets, playtest cards) text invents words that are no game types and is not read for token types. */
  set_type?: string;
  card_faces?: { type_line?: string; oracle_text?: string }[];
}

export type IndexSubtype = Lexicon['subtypes'][number];

/** Class of a type line's left side (its card types): creature types are shared with kindred (CR 205.3m); undefined for a type whose subtypes are not read. */
function classOf(lefts: readonly string[]): IndexSubtype['class'] | undefined {
  if (lefts.some((w) => w === 'Creature' || w === 'Kindred' || w === 'Tribal')) return 'creature';
  if (lefts.some((w) => w === 'Instant' || w === 'Sorcery')) return 'spell';
  if (lefts.includes('Artifact')) return 'artifact';
  if (lefts.includes('Enchantment')) return 'enchantment';
  if (lefts.includes('Land')) return 'land';
  return undefined;
}

/**
 * Subtypes used on the faces of `cards` that `lex` does not list (CR 205.3 lags behind the newest sets). Only the classes whose words appear in rules text are
 * read (creature, spell, artifact, enchantment, land); a face whose type line has a word that is not a card type or supertype of the rules (Plane, Phenomenon,
 * Conspiracy, Universewalker) is not a card of the game and is skipped. Sorted by class and name: deterministic, no clock, no hash order.
 *
 * trek-3: also the creature types a card's rules text gives the creature tokens it creates ("create two 2/2 black Romulan creature tokens"): a token's
 * subtypes are the ones the effect that creates it names (CR 111.4, 111.10), and a creature type printed only on a token is still a creature type
 * (CR 205.3m) that other text can name. Read from token descriptions of the form "<P>/<T> [<colors>] <Capitalized words> [artifact|enchantment|...] creature
 * token(s)", and not from cards of a funny set (Un-sets invent words there: "an 0/0 Blue Elemental creature token"). A word a type line already gives a
 * class keeps that class.
 */
export function indexSubtypes(cards: Iterable<IndexCard>, lex: Pick<Lexicon, 'cardTypes' | 'supertypes' | 'subtypes'> & Partial<Pick<Lexicon, 'colors'>>): IndexSubtype[] {
  const known = new Set(lex.subtypes.flatMap((s) => [s.singular, s.plural]));
  const typeWords = new Set([...lex.cardTypes, ...lex.supertypes, 'Tribal']);
  const found = new Map<string, IndexSubtype['class']>();
  const tokenTypes = new Set<string>();
  const tokenDesc = tokenDescription(lex.colors ?? []);
  for (const card of cards) {
    const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : [card];
    for (const f of faces) {
      if (card.set_type !== 'funny') {
        for (const m of (f.oracle_text ?? card.oracle_text ?? '').matchAll(tokenDesc)) {
          for (const w of m[1]!.trim().split(' ')) if (/^\p{Lu}[\p{L}'-]*$/u.test(w) && !known.has(w)) tokenTypes.add(w);
        }
      }
      const typeLine = f.type_line ?? card.type_line ?? '';
      const [left = '', right = ''] = typeLine.split(' — ');
      if (!right) continue;
      const lefts = left.split(' ').filter(Boolean);
      if (lefts.some((w) => !typeWords.has(w))) continue;
      const cls = classOf(lefts);
      if (!cls) continue;
      for (const w of right.replace('Time Lord', 'TimeLord').split(' ')) {
        if (w === 'TimeLord' || !/^\p{Lu}[\p{L}'-]*$/u.test(w) || known.has(w)) continue;
        if (!found.has(w)) found.set(w, cls);
      }
    }
  }
  for (const w of tokenTypes) if (!found.has(w)) found.set(w, 'creature');
  const order = ['creature', 'spell', 'artifact', 'enchantment', 'land'];
  return [...found.entries()]
    .sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([singular, cls]) => ({ singular, plural: pluralize(singular), class: cls }));
}

/**
 * The token description of rules text whose capitalized words (group 1) are the token's subtypes: "<P>/<T>", the colors (CR 105.1, and "colorless", CR 105.2c)
 * joined as Oracle joins them, the subtypes, other card types and supertypes in lower case, then "creature token(s)".
 */
function tokenDescription(colors: readonly { word: string }[]): RegExp {
  const color = `(?:${[...colors.map((c) => c.word), 'colorless'].join('|')})`;
  return new RegExp(`\\b(?:\\d+|X)/(?:\\d+|X) (?:${color}(?:(?:,? and |, )${color})* )?((?:\\p{Lu}[\\p{L}'-]* )+)(?:(?:artifact|enchantment|legendary|snow) )*creature tokens?\\b`, 'gu');
}

/** Reads cards.jsonl (one Oracle card per line). */
export function readIndexCards(file: string): IndexCard[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as IndexCard);
}

export function serializeIndexLexicon(subtypes: readonly IndexSubtype[]): string {
  const comment =
    'GENERATED by scripts/gen-lexicon.ts (WP5) from the local Oracle index (design 6.11): subtypes the CR edition of lexicon.generated.json does not list yet. Do not edit: run `npx tsx scripts/gen-lexicon.ts`. A test fails if this file is stale (and is skipped on a machine without the index). Words only.';
  const list = subtypes.length === 0 ? '[]' : `[\n${subtypes.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
  return `{\n  "_comment": ${JSON.stringify(comment)},\n  "subtypes": ${list}\n}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Creature types printed on cards that the rules do not list yet (the rules engine's list, statics/subtypes.ts)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Scryfall set types whose cards are cards of the game: the sets a player builds a deck from or opens (core, expansion, Commander precons, draft-innovation
 * sets such as Conspiracy and Jumpstart). Not "masters" (it holds the Mystery Booster playtest cards: "Armored Dragon", "Cow", "Spuzzem"), "funny" (Un-sets),
 * "memorabilia", "alchemy" (digital rebalances, whose "Chorus" the rules do not list either), "promo" and the rest: a type printed only there is not certain.
 */
export const GAME_SET_TYPES: readonly string[] = ['core', 'expansion', 'commander', 'draft_innovation'];

/** Card types whose subtypes can stand on a creature's type line beside creature types ("Artifact Creature — Android Scientist", CR 205.3d). */
const MIXABLE_CARD_TYPES: readonly string[] = ['Artifact', 'Enchantment', 'Land'];

export interface PrintedCreatureEvidence {
  /** The words the index proves to be creature types (before the rules' own words are taken away). */
  readonly proved: readonly string[];
  /** The words some card of any set prints as the subtype of a card that is not a creature (an artifact type, a land type, a spell type, a planeswalker type...). */
  readonly otherClass: ReadonlySet<string>;
}

/**
 * trek-10 (CR 205.3m): what the Oracle index says about creature types the rules do not list yet. A word is PROVED when
 *   - a type line of a card of a game set (`GAME_SET_TYPES`) has it on a card whose card types are creature or kindred, alone or beside artifact, enchantment or
 *     land ("Artifact Creature — Android Scientist": the same footing as a creature token that is an artifact, below), or a token description in the rules text
 *     of such a card gives it to a creature token (as `indexSubtypes` reads them, "a 2/2 black Romulan creature token", "a 1/1 colorless Zorgian artifact creature
 *     token"), and
 *   - it is not in `otherClass`: no type line of ANY card, funny sets included, has it on a card that is not a creature (an artifact type, a land type, a spell
 *     type, a planeswalker or battle type: "Key", "Cloud", "Chorus", "Communicator").
 * A type line that also has a planeswalker, battle, instant or sorcery (a kindred spell) is not read: its subtypes are of other classes too and nothing says
 * which. Type lines with a word that is no card type of the rules (Plane, Conspiracy, an Un-card's invention) are not read. Words of funny, playtest ("masters")
 * and other sets that are not game sets prove nothing, and they keep a word out only when they print it as another class's subtype.
 */
export function printedCreatureEvidence(cards: Iterable<IndexCard>, lex: Pick<Lexicon, 'cardTypes' | 'supertypes'> & Partial<Pick<Lexicon, 'colors'>>): PrintedCreatureEvidence {
  const typeWords = new Set([...lex.cardTypes, ...lex.supertypes, 'Tribal']);
  const supertypes = new Set(lex.supertypes);
  const creatureWords = new Set(['Creature', 'Kindred', 'Tribal']);
  const tokenDesc = tokenDescription(lex.colors ?? []);
  const word = /^\p{Lu}[\p{L}'-]*$/u;
  const proved = new Set<string>();
  const otherClass = new Set<string>();
  for (const card of cards) {
    const game = GAME_SET_TYPES.includes(card.set_type ?? '');
    const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : [card];
    for (const f of faces) {
      if (game) for (const m of (f.oracle_text ?? card.oracle_text ?? '').matchAll(tokenDesc)) for (const w of m[1]!.trim().split(' ')) if (word.test(w)) proved.add(w);
      const [left = '', right = ''] = (f.type_line ?? card.type_line ?? '').split(' — ');
      if (!right) continue;
      const lefts = left.split(' ').filter(Boolean);
      if (lefts.some((w) => !typeWords.has(w))) continue;
      const creature = lefts.some((w) => creatureWords.has(w));
      if (creature && !lefts.every((w) => creatureWords.has(w) || supertypes.has(w) || MIXABLE_CARD_TYPES.includes(w))) continue;
      for (const w of right.replace('Time Lord', 'TimeLord').split(' ')) {
        if (w === 'TimeLord' || !word.test(w)) continue;
        if (!creature) otherClass.add(w);
        else if (game) proved.add(w);
      }
    }
  }
  return { proved: [...proved], otherClass };
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The list for statics/printed-creature-types.generated.json: the words the index proves (`printedCreatureEvidence`) and the words `previous` (the checked-in
 * list) already has, less the words the rules list (any class, singular or plural) and the words some card prints as another class's subtype. Keeping what
 * `previous` has means an OLDER index (the archive's default one, from before the Star Trek cards) cannot take a type away by being the one that regenerates it;
 * a type leaves the list when the rules list it or an index shows it as another class's subtype. Sorted: deterministic, no clock, no hash order.
 */
export function printedCreatureTypes(
  cards: Iterable<IndexCard>,
  lex: Pick<Lexicon, 'cardTypes' | 'supertypes' | 'subtypes'> & Partial<Pick<Lexicon, 'colors'>>,
  previous: readonly string[] = [],
): string[] {
  const known = new Set(lex.subtypes.flatMap((s) => [s.singular, s.plural]));
  const ev = printedCreatureEvidence(cards, lex);
  return [...new Set([...ev.proved, ...previous])].filter((w) => !ev.otherClass.has(w) && !known.has(w)).sort(byName);
}

/**
 * The staleness check of the checked-in list against a local index, ONE WAY: what is wrong with `listed` given this index. Every word the index proves must be
 * listed (a newer index that adds a creature type fails until the generator reruns), and no listed word may be one the rules list or one this index prints as another
 * class's subtype. A word listed that this index does not prove is fine: an older index (the archive's default, 2026-10-11) has fewer cards, and regenerating from
 * it must not be what the check asks for.
 */
export function printedCreatureProblems(
  listed: readonly string[],
  cards: Iterable<IndexCard>,
  lex: Pick<Lexicon, 'cardTypes' | 'supertypes' | 'subtypes'> & Partial<Pick<Lexicon, 'colors'>>,
): string[] {
  const known = new Set(lex.subtypes.flatMap((s) => [s.singular, s.plural]));
  const ev = printedCreatureEvidence(cards, lex);
  const has = new Set(listed);
  return [
    ...ev.proved.filter((w) => !known.has(w) && !ev.otherClass.has(w) && !has.has(w)).sort(byName).map((w) => `${w}: the index proves it a creature type, the list lacks it`),
    ...listed.filter((w) => known.has(w)).map((w) => `${w}: the rules list it now`),
    ...listed.filter((w) => ev.otherClass.has(w)).map((w) => `${w}: the index prints it as another class's subtype`),
  ];
}

export function serializePrintedCreatureTypes(types: readonly string[]): string {
  const comment =
    'GENERATED by scripts/gen-lexicon.ts (trek-10) from the local Oracle index: the creature types that cards of the game\'s own sets print and the CR edition of lexicon.generated.json does not list yet (certain ones only: see printedCreatureEvidence). Regenerating keeps the types already listed, so an older index cannot take one away. Do not edit: run `npx tsx scripts/gen-lexicon.ts`. A test fails if the local index proves a type this file lacks, or this file lists one the index prints as another class\'s subtype (skipped on a machine without the index). Words only.';
  const list = types.length === 0 ? '[]' : `[\n${types.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
  return `{\n  "_comment": ${JSON.stringify(comment)},\n  "creatureTypes": ${list}\n}\n`;
}

function main(): void {
  const check = process.argv.includes('--check');
  // trek-10: `--index-only` is for a machine without the rules (a cloud session): the checked-in lexicon.generated.json, a function of the CR edition alone, stands for
  // them, and only the two files read from the Oracle index are written (or checked)
  const indexOnly = process.argv.includes('--index-only');
  const crRoot = findCrRoot();
  if (!crRoot && !indexOnly) {
    console.error('gen-lexicon: the Comprehensive Rules (rules/cr) were not found. Set OPENMTG_RULES_DIR or run from a checkout that has them (--index-only: only the files read from the Oracle index).');
    process.exit(2);
  }
  const lex = crRoot ? generateLexicon(crRoot) : (JSON.parse(readFileSync(LEXICON_PATH, 'utf8')) as Lexicon);
  const text = crRoot ? serializeLexicon(lex as Generated) : undefined;
  const cardsFile = findCardsFile();
  const indexCards = cardsFile ? readIndexCards(cardsFile) : undefined;
  const indexText = indexCards ? serializeIndexLexicon(indexSubtypes(indexCards, lex)) : undefined;
  const listedPrinted = existsSync(PRINTED_CREATURE_TYPES_PATH) ? (JSON.parse(readFileSync(PRINTED_CREATURE_TYPES_PATH, 'utf8')) as { creatureTypes: string[] }).creatureTypes : [];
  const printedText = indexCards ? serializePrintedCreatureTypes(printedCreatureTypes(indexCards, lex, listedPrinted)) : undefined;
  const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '');
  if (check) {
    let stale = false;
    if (text !== undefined && read(LEXICON_PATH) !== text) {
      console.error('gen-lexicon: parser/lexicon.generated.json is stale. Run: npx tsx scripts/gen-lexicon.ts');
      stale = true;
    }
    if (indexText !== undefined && read(INDEX_LEXICON_PATH) !== indexText) {
      console.error('gen-lexicon: parser/lexicon.index.generated.json is stale. Run: npx tsx scripts/gen-lexicon.ts');
      stale = true;
    }
    // one way (an older index proves fewer types and must not be asked to drop any): see printedCreatureProblems
    for (const problem of indexCards ? printedCreatureProblems(listedPrinted, indexCards, lex) : []) {
      console.error(`gen-lexicon: statics/printed-creature-types.generated.json is stale: ${problem}. Run: npx tsx scripts/gen-lexicon.ts`);
      stale = true;
    }
    if (stale) process.exit(1);
    console.log('gen-lexicon: up to date');
    return;
  }
  if (text !== undefined) {
    writeFileSync(LEXICON_PATH, text);
    console.log(`gen-lexicon: wrote ${LEXICON_PATH} (CR ${JSON.parse(text).crEdition})`);
  }
  if (indexText !== undefined) {
    writeFileSync(INDEX_LEXICON_PATH, indexText);
    console.log(`gen-lexicon: wrote ${INDEX_LEXICON_PATH} (${(JSON.parse(indexText) as { subtypes: unknown[] }).subtypes.length} subtypes from the Oracle index)`);
  } else console.log('gen-lexicon: no Oracle index on this machine, lexicon.index.generated.json left as it is');
  if (printedText !== undefined) {
    writeFileSync(PRINTED_CREATURE_TYPES_PATH, printedText);
    console.log(`gen-lexicon: wrote ${PRINTED_CREATURE_TYPES_PATH} (${(JSON.parse(printedText) as { creatureTypes: unknown[] }).creatureTypes.length} creature types)`);
  } else console.log('gen-lexicon: no Oracle index on this machine, printed-creature-types.generated.json left as it is');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
