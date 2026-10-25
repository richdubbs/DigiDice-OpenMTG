/**
 * Text-changing effects, layer 3 (CR 612, 613.1c; m6 design 3.5, D9, E9). Owner: M6-8.
 *
 *   rewriteAbility  a pure rewrite of the typed positions of an ability's JSON where a word is used as a color word, a land type or a creature type (CR 612.2):
 *                   the colors of filters, tokens, layer 5 changes and devotion; the subtypes of filters, tokens and layer 4 changes; the qualities of
 *                   protection, hexproof and landwalk ("color:R", "subtype:goblins", "snow swamp"); the values of a color or type choice and of the condition
 *                   that reads it; a token's name when it is the creature type it is named after (CR 612.2a). Mana symbols are not words and never change:
 *                   costs, `addMana` units, mana production; a hybrid symbol keeps its own `colors` (isHybridSymbol). Card names are never changed (CR 612.2). The display text of
 *                   the ability is rewritten too, word by word, with the object's names protected. The ability keeps its key (it is the same ability, changed).
 *   LAYER_3         the layer 3 applier (statics/layers.ts#LAYER_TABLE): every ability that is rules text of the object is rewritten: origin `printed`, the
 *                   expansions of its keywords (`keyword`: Magical Hack turns swampwalk into islandwalk), `copied` (copied abilities and "except it has"
 *                   abilities are rules text of the copy, CR 707.2a, 707.9a; merged components' abilities have that origin too). Granted abilities (layer 6)
 *                   and the abilities the rules give are not text of the object and keep their words (CR 612.3). The words of the type line change as well
 *                   (CR 612.1: "the text that appears in its type line"; CR 612.4: a token's subtypes): a creature type or land type among the object's subtypes.
 *
 * Fail closed. An ability is rewritten only when its current text (or, for a keyword's expansion, its keyword's text) uses the word: a typed position whose value
 * does not come from a word of the text (the five enumerated answers of "the color of your choice", a domain count over the basic land types) is not a word
 * the effect can find, so it is left alone. Words the model holds as free text (a manual ability) are not rewritten: such a card is not full anyway.
 *
 * A word to change given as a choice (`{chosen: link}`) is the value a resolved effect fixed as it began (effects/handlers/lasting-fix.ts#fixChosen); a static
 * ability's is read from its source's link store. A word that is not a word of its kind, or a change of a word to itself, changes nothing.
 *
 * Import rules (m6 design 4.4): statics value-imports types, keywords, statics, util and rules/base-chars only; this module is GameState-level and pure.
 */
import type { AbilityDef, ChosenWord, Modification } from '../types/ability';
import type { Color } from '../types/mana';
import type { GameState } from '../types/state';
import type { Chars } from '../rules/characteristics';
import { pluralForms } from '../util/plurals';
import { keywordsOfAbilities } from './abilities';
import type { ApplyMods, CharAbility } from './api';
import { readLink } from './links';
import { colorFromWord } from './match';
import { CREATURE_TYPES, LAND_TYPES } from './subtypes';

export type WordKind = Extract<Modification, { layer: 3 }>['changeWord']['kind'];

/** A text change with both words known: a color as its letter, a land or creature type as the type line prints it. */
export interface WordChange {
  kind: WordKind;
  from: string;
  to: string;
}

const COLOR_WORD: Readonly<Record<Color, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** The canonical form of a word of this kind (a color letter, a land or creature type as printed), or undefined when it is not such a word. */
export function canonicalWord(kind: WordKind, word: string): string | undefined {
  if (kind === 'color') return colorFromWord(word);
  const list = kind === 'landType' ? LAND_TYPES : CREATURE_TYPES;
  const w = word.trim().replace(/’/g, "'").toLowerCase();
  return list.find((t) => t.toLowerCase() === w);
}

/** The word a `from` / `to` stands for: the word itself, or the value chosen for a link (on the source of a static ability; resolved effects store the value). */
function wordOf(w: string | ChosenWord, s: GameState, source: string | null): string | undefined {
  if (typeof w === 'string') return w;
  return readLink(source === null ? undefined : s.objects[source], w.chosen)?.values?.[0];
}

/** The change a layer 3 modification makes, or null when a word is undetermined, not a word of its kind, or the same word twice. */
export function wordChangeOf(m: Extract<Modification, { layer: 3 }>['changeWord'], s: GameState, source: string | null): WordChange | null {
  const fromRaw = wordOf(m.from, s, source);
  const toRaw = wordOf(m.to, s, source);
  if (fromRaw === undefined || toRaw === undefined) return null;
  const from = canonicalWord(m.kind, fromRaw);
  const to = canonicalWord(m.kind, toRaw);
  return from === undefined || to === undefined || from === to ? null : { kind: m.kind, from, to };
}

// ---- words in the display text ---------------------------------------------------------------------------------------------------------------------

const PLURALS: Readonly<Record<string, string>> = {
  elf: 'elves', wolf: 'wolves', dwarf: 'dwarves', werewolf: 'werewolves', ox: 'oxen', mouse: 'mice', fungus: 'fungi', child: 'children', pegasus: 'pegasi',
  cyclops: 'cyclopes', homunculus: 'homunculi', cyberman: 'cybermen', merfolk: 'merfolk', elk: 'elk', fish: 'fish', sheep: 'sheep', moonfolk: 'moonfolk',
  djinn: 'djinn', kithkin: 'kithkin', sphinx: 'sphinxes',
};

/** "Elf" -> "Elves", "Swamp" -> "Swamps", "Plains" -> "Plains" (display text and protection qualities; the rules read every form, rules/quality.ts). */
export function printedPlural(t: string): string {
  const irregular = PLURALS[t.toLowerCase()];
  if (irregular !== undefined) return sameCase(t, irregular);
  if (/s$/i.test(t)) return t; // Plains
  if (/(?:x|z|ch|sh)$/i.test(t)) return `${t}es`;
  if (/[^aeiou]y$/i.test(t)) return `${t.slice(0, -1)}ies`;
  return `${t}s`;
}

/** `word` with the case of `model`'s first letter ("Red" -> "Blue", "swamp" -> "island"). */
function sameCase(model: string, word: string): string {
  const upper = model[0] !== undefined && model[0] !== model[0].toLowerCase();
  return upper ? word[0]!.toUpperCase() + word.slice(1) : word.toLowerCase();
}

const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+').replace(/'/g, "['’]");

/** The singular and plural spellings of the word a change replaces, longest first (the regular expression tries them in order). */
function spellings(ch: WordChange): string[] {
  if (ch.kind === 'color') return [COLOR_WORD[ch.from as Color]];
  return [...new Set([...pluralForms(ch.from), printedPlural(ch.from).toLowerCase()])].sort((a, b) => b.length - a.length);
}

const REGEX = new Map<string, RegExp>();
/**
 * The words of `ch.from` in a text: "red" and "nonred" for a color word; "Swamp", "Swamps", "swampwalk", "swampcycling", "non-Swamp" for a land type;
 * "Goblin", "Goblins", "non-Goblin" for a creature type. Groups: 1 the "non" prefix, 2 the word, 3 a landwalk or landcycling suffix.
 */
function wordRegex(ch: WordChange): RegExp {
  const key = `${ch.kind}|${ch.from}`;
  let re = REGEX.get(key);
  if (!re) {
    const suffix = ch.kind === 'landType' ? '(walk|cycling)?' : '()';
    // trek-10: not inside braces either: "Q" is a creature type and "{Q}" is the untap symbol, which is no word (CR 107.7)
    re = new RegExp(`(?<![A-Za-z'’{-])(non-?)?(${spellings(ch).map(escapeRe).join('|')})${suffix}(?![A-Za-z'’}])`, 'gi');
    REGEX.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/** The text with every occurrence of these names replaced by a placeholder (CR 612.2: a name is never changed), and the way back. */
function protectNames(text: string, names: readonly string[]): { text: string; restore: (t: string) => string } {
  const list = [...new Set(names.filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return { text, restore: (t) => t };
  let out = text;
  list.forEach((n, i) => { out = out.split(n).join(`\u0001${i}\u0001`); });
  return { text: out, restore: (t) => t.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => list[Number(i)]!) };
}

/** Does the text use the word a change replaces, other than inside one of the object's names? */
export function mentionsWord(text: string, ch: WordChange, names: readonly string[] = []): boolean {
  if (text.length === 0) return false;
  return wordRegex(ch).test(protectNames(text, names).text);
}

/** The display text with the word replaced (case kept: "Red" -> "Blue", "nonred" -> "nonblue", "swampwalk" -> "islandwalk", "Goblins" -> "Elves"). */
export function rewriteText(text: string, ch: WordChange, names: readonly string[] = []): string {
  const p = protectNames(text, names);
  const singular = ch.kind === 'color' ? COLOR_WORD[ch.from as Color] : ch.from.toLowerCase();
  const out = p.text.replace(wordRegex(ch), (_m: string, non: string | undefined, word: string, suffix: string | undefined) => {
    const toWord = ch.kind === 'color' ? COLOR_WORD[ch.to as Color] : word.toLowerCase() === singular || suffix ? ch.to : printedPlural(ch.to);
    return `${non ?? ''}${sameCase(word, toWord)}${suffix ?? ''}`;
  });
  return p.restore(out);
}

// ---- the typed positions -----------------------------------------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

interface Walk {
  ch: WordChange;
  names: readonly string[];
}

/** One value of a word position: a color letter or word (kept in its own form), a type as printed. */
function mapWord(x: unknown, w: Walk): unknown {
  if (typeof x !== 'string') return x;
  if (w.ch.kind === 'color') {
    if (colorFromWord(x) !== w.ch.from) return x;
    return x.trim().length === 1 ? w.ch.to : sameCase(x, COLOR_WORD[w.ch.to as Color]);
  }
  return canonicalWord(w.ch.kind, x) === w.ch.from ? w.ch.to : x;
}

/** A list of word values, without the duplicates a change can make ("white or blue" changed blue -> white is just white). */
function mapList(x: unknown, w: Walk): unknown {
  if (!Array.isArray(x)) return x;
  let changed = false;
  const out: unknown[] = [];
  for (const v of x) {
    const y = mapWord(v, w);
    if (y !== v) changed = true;
    if (!out.includes(y)) out.push(y);
    else changed = true;
  }
  return changed ? out : x;
}

/** A list of word values, or a change of one (`{set, add, remove}`: layer 4 type changes, layer 5 color changes), each list rewritten. */
function mapChange(x: unknown, w: Walk): unknown {
  if (!isRec(x)) return mapList(x, w);
  let out: Rec | undefined;
  for (const k of ['set', 'add', 'remove'] as const) {
    if (!(k in x)) continue;
    const y = mapList(x[k], w);
    if (y !== x[k]) (out ??= { ...x })[k] = y;
  }
  return out ?? x;
}

/** A keyword's quality: "color:R" (protection, hexproof), "subtype:goblins" (any printed plural, rules/quality.ts#hasQuality), landwalk's words ("snow swamp"). */
function mapQuality(q: string, keyword: unknown, w: Walk): string {
  const { kind, from, to } = w.ch;
  if (kind === 'color') return q === `color:${from}` ? `color:${to}` : q;
  if (q.startsWith('subtype:')) {
    if (!pluralForms(from).includes(q.slice('subtype:'.length))) return q;
    const plural = printedPlural(to).toLowerCase();
    return `subtype:${pluralForms(to).includes(plural) ? plural : to.toLowerCase()}`;
  }
  if (keyword === 'landwalk' && kind === 'landType') return q.split(' ').map((x) => (x === from.toLowerCase() ? to.toLowerCase() : x)).join(' ');
  return q;
}

/**
 * Is this a hybrid or hybrid Phyrexian mana symbol (types/mana.ts#ManaSymbol: `{kind: 'hybrid' | 'hybridPhyrexian', colors}`)? Its `colors` are the colors of a
 * mana symbol, not words (CR 612.2, 107.4e, 107.4f), wherever the symbol sits (an ability's cost, a granted ability's cost, a cost change). The other mana
 * symbols hold a color under `color`, which is not a word position here.
 */
const isHybridSymbol = (o: Rec): boolean => (o['kind'] === 'hybrid' || o['kind'] === 'hybridPhyrexian') && Array.isArray(o['colors']);

/** Does this step choose a word of the change's kind? */
const choosesKind = (o: Rec, w: Walk): boolean => o['op'] === 'chooseValue' && o['what'] === w.ch.kind;

function field(o: Rec, k: string, x: unknown, w: Walk): unknown {
  if (k === 'text' && typeof x === 'string' && typeof o['kind'] === 'string') return rewriteText(x, w.ch, w.names); // an ability's display text
  if (k === 'quality' && typeof x === 'string') return mapQuality(x, o['keyword'], w);
  if (k === 'equals' && o['cond'] === 'chosen') return mapWord(x, w); // "if you chose red": the value the choice is compared with
  if ((k === 'options' || k === 'exclude') && choosesKind(o, w)) return mapList(x, w);
  if (k === 'token' && isRec(x)) {
    // CR 612.2a: the creature types of a token-creating instruction name the token too
    const t = walk(x, w) as Rec;
    return w.ch.kind === 'creatureType' && t['name'] === w.ch.from ? { ...t, name: w.ch.to } : t;
  }
  if (w.ch.kind === 'color') {
    if (k === 'colors' && isHybridSymbol(o)) return x; // CR 612.2: a mana symbol is not a word ({R/W} in a cost, a granted ability's cost, a cost change)
    if (k === 'colors' || k === 'notColors') return mapChange(x, w); // filters and tokens (a list), layer 5 (set / add / remove)
    if (k === 'to' && o['q'] === 'devotion') return mapList(x, w);
  } else if (k === 'subtypes' || k === 'notSubtypes') {
    return mapChange(x, w); // filters and tokens (a list), layer 4 type changes (set / add / remove)
  }
  return walk(x, w);
}

function walk(v: unknown, w: Walk): unknown {
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = walk(x, w);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  if (!isRec(v)) return v;
  let out: Rec | undefined;
  for (const k of Object.keys(v)) {
    const x = v[k];
    const y = field(v, k, x, w);
    if (y !== x) (out ??= { ...v })[k] = y;
  }
  return out ?? v;
}

const MEMO = new WeakMap<AbilityDef, Map<string, AbilityDef>>();

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const x of Object.values(v as object)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/**
 * CR 612.2: the ability with every typed position where `ch.from` is used as a word of its kind changed to `ch.to`, and its display text rewritten with `names`
 * protected. The same object when nothing changes. Pure; memoized per frozen definition (a memo of a pure function of immutable data, like
 * statics/abilities.ts#namespacedAbility).
 */
export function rewriteAbility(def: AbilityDef, ch: WordChange, names: readonly string[] = []): AbilityDef {
  if (!Object.isFrozen(def)) return walk(def, { ch, names }) as AbilityDef;
  const key = `${ch.kind}|${ch.from}|${ch.to}|${names.join('|')}`;
  let byChange = MEMO.get(def);
  if (!byChange) MEMO.set(def, (byChange = new Map()));
  let out = byChange.get(key);
  if (!out) byChange.set(key, (out = deepFreeze(walk(def, { ch, names }) as AbilityDef)));
  return out;
}

// ---- the applier (layer 3) ---------------------------------------------------------------------------------------------------------------------------

/** The origins of the abilities that are rules text of the object (CR 612.3: not the granted ones, not the ones the rules give). */
const TEXT_ORIGINS: ReadonlySet<CharAbility['origin']> = new Set(['printed', 'keyword', 'copied']);

/** The characteristics after one text change (CR 612.1-612.4): the rules-text abilities rewritten where their text uses the word, and the type line's words. */
export function applyWordChange(c: Chars, ch: WordChange): Chars {
  const names = c.names.length > 0 ? c.names : [c.name];
  const texts = new Map(c.abilities.map((a) => [a.key, a.def.text]));
  let changed = false;
  const abilities = c.abilities.map((a) => {
    if (!TEXT_ORIGINS.has(a.origin)) return a;
    // fail closed (file comment): the ability's own text, or its keyword's for an expansion, must use the word
    const parent = a.parent === undefined ? '' : texts.get(a.parent) ?? '';
    if (!mentionsWord(a.def.text, ch, names) && !mentionsWord(parent, ch, names)) return a;
    const def = rewriteAbility(a.def, ch, names);
    if (def === a.def) return a;
    changed = true;
    return { ...a, def };
  });
  let subtypes = c.subtypes;
  if (ch.kind !== 'color' && c.subtypes.includes(ch.from)) {
    subtypes = [...new Set(c.subtypes.map((t) => (t === ch.from ? ch.to : t)))];
    changed = true;
  }
  if (!changed) return c;
  return { ...c, abilities, keywords: keywordsOfAbilities(abilities), subtypes };
}

/** M6-8: the layer 3 applier. Each text change of the effect, in the order written (CR 613.1c); an undetermined or meaningless one changes nothing. */
export const LAYER_3: ApplyMods | null = (c, mods, _subject, s, _all, fx) => {
  let out = c;
  for (const m of mods) {
    if (m.layer !== 3) continue;
    const ch = wordChangeOf(m.changeWord, s, fx?.source ?? null);
    if (ch) out = applyWordChange(out, ch);
  }
  return out;
};
