/**
 * Generates the parser's word lists (design 6.11, WP5):
 *
 *   packages/engine/src/parser/lexicon.generated.json         from the Comprehensive Rules (a function of the CR edition alone)
 *   packages/engine/src/parser/lexicon.index.generated.json   the subtypes that cards of the local Oracle index use and the CR edition does not list yet
 *                                                             (sets newer than the rules: "Officer", "Klingon"), with their classes and plurals
 *
 *   npx tsx scripts/gen-lexicon.ts            write the files
 *   npx tsx scripts/gen-lexicon.ts --check    exit 1 when a checked-in file differs from what its inputs produce (the staleness tests do the same)
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
  card_faces?: { type_line?: string }[];
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
 */
export function indexSubtypes(cards: Iterable<IndexCard>, lex: Pick<Lexicon, 'cardTypes' | 'supertypes' | 'subtypes'>): IndexSubtype[] {
  const known = new Set(lex.subtypes.flatMap((s) => [s.singular, s.plural]));
  const typeWords = new Set([...lex.cardTypes, ...lex.supertypes, 'Tribal']);
  const found = new Map<string, IndexSubtype['class']>();
  for (const card of cards) {
    const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : [card];
    for (const f of faces) {
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
  const order = ['creature', 'spell', 'artifact', 'enchantment', 'land'];
  return [...found.entries()]
    .sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([singular, cls]) => ({ singular, plural: pluralize(singular), class: cls }));
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

function main(): void {
  const check = process.argv.includes('--check');
  const crRoot = findCrRoot();
  if (!crRoot) {
    console.error('gen-lexicon: the Comprehensive Rules (rules/cr) were not found. Set OPENMTG_RULES_DIR or run from a checkout that has them.');
    process.exit(2);
  }
  const lex = generateLexicon(crRoot);
  const text = serializeLexicon(lex);
  const cardsFile = findCardsFile();
  const indexText = cardsFile ? serializeIndexLexicon(indexSubtypes(readIndexCards(cardsFile), lex)) : undefined;
  const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '');
  if (check) {
    let stale = false;
    if (read(LEXICON_PATH) !== text) {
      console.error('gen-lexicon: parser/lexicon.generated.json is stale. Run: npx tsx scripts/gen-lexicon.ts');
      stale = true;
    }
    if (indexText !== undefined && read(INDEX_LEXICON_PATH) !== indexText) {
      console.error('gen-lexicon: parser/lexicon.index.generated.json is stale. Run: npx tsx scripts/gen-lexicon.ts');
      stale = true;
    }
    if (stale) process.exit(1);
    console.log('gen-lexicon: up to date');
    return;
  }
  writeFileSync(LEXICON_PATH, text);
  console.log(`gen-lexicon: wrote ${LEXICON_PATH} (CR ${JSON.parse(text).crEdition})`);
  if (indexText !== undefined) {
    writeFileSync(INDEX_LEXICON_PATH, indexText);
    console.log(`gen-lexicon: wrote ${INDEX_LEXICON_PATH} (${(JSON.parse(indexText) as { subtypes: unknown[] }).subtypes.length} subtypes from the Oracle index)`);
  } else console.log('gen-lexicon: no Oracle index on this machine, lexicon.index.generated.json left as it is');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
