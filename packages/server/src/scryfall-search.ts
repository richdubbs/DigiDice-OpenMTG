/**
 * Scryfall search syntax (https://scryfall.com/docs/syntax) -> card predicate, for the deckbuilder's "Advanced search" (GET /api/cards/search `scry`).
 * Pure: no I/O, no network. The local index holds one entry per Oracle card, so everything about a card's rules is supported and everything about its
 * printings (rarity, artist, flavor text, release date, prices, ...) is not: such a keyword is reported by name, never ignored and never guessed,
 * so a result list is never silently wrong. Any syntax error is reported the same way (the handler answers 400 with the message). The set keywords
 * (s, set, e, edition) are the exception: the parse names the sets, and the handler fills `setCards` with each set's cards (sets.ts) before testing.
 *
 * Grammar: terms separated by spaces are ANDed ("and" is optional); `or` / `OR` binds looser than AND; parentheses group; a leading `-` negates a term or
 * a group. A term is a bare word (name), "quoted words" or 'quoted words' (name), `/regex/` (name), `!name` / `!"exact name"` (exact card name), or
 * `keyword<op>value` with op one of : = != < <= > >=. Values may be "quoted" or /regex/ where the keyword takes text.
 *
 * Supported keywords (aliases in parentheses): name, c (color), id (identity), t (type), o (oracle), fo (fulloracle), kw (keyword), m (mana),
 * mv (cmc, manavalue), pow (power), tou (toughness), pt (powtou), loy (loyalty), def (defense), f (format, legal), banned, restricted, is, not, has,
 * layout, produces, devotion, s (set, e, edition). See SUPPORTED_KEYWORDS, IS_VALUES and UNSUPPORTED below.
 */
import { legalityIn } from '@openmtg/cards';
import { compareNumber, fold, type Op, type RowTest, type SearchRow } from './search-query';
import { formatLegalityKey } from './formats-adapter';
import { facesOf } from './summary';

/** The result of a successful parse: the row test, and the Scryfall legality keys the query names (the handler checks the index knows them). */
export interface ScryfallSearch {
  test: RowTest;
  formats: string[];
  /** The sets the query names (s:, set:, e:, edition:), as typed in lower case: a code or a name. */
  sets: string[];
  /** Each named set's Oracle ids, by the text in `sets`: the handler fills it before the test runs (a set missing here matches nothing). */
  setCards: Map<string, ReadonlySet<string>>;
}

export const SCRYFALL_DOCS = 'https://scryfall.com/docs/syntax';

class ScryError extends Error {}

/** A table entry by its own key (typed text such as "constructor" is not a keyword). */
const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);
const fail = (message: string): never => {
  throw new ScryError(message);
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Keywords

/** Keyword (lower case) -> canonical name, for the keywords this module supports. */
const ALIASES: Readonly<Record<string, string>> = {
  name: 'name',
  c: 'c', color: 'c', colors: 'c',
  id: 'id', identity: 'id', ci: 'id', commander: 'id',
  t: 't', type: 't',
  o: 'o', oracle: 'o',
  fo: 'fo', fulloracle: 'fo',
  kw: 'kw', keyword: 'kw',
  m: 'm', mana: 'm',
  mv: 'mv', cmc: 'mv', manavalue: 'mv',
  pow: 'pow', power: 'pow',
  tou: 'tou', toughness: 'tou',
  pt: 'pt', powtou: 'pt',
  loy: 'loy', loyalty: 'loy',
  def: 'def', defense: 'def',
  f: 'f', format: 'f', legal: 'f',
  banned: 'banned',
  restricted: 'restricted',
  is: 'is',
  not: 'not',
  has: 'has',
  layout: 'layout',
  produces: 'produces',
  devotion: 'devotion',
  s: 's', set: 's', e: 's', edition: 's',
};

/** The keywords as the player is told about them. */
export const SUPPORTED_KEYWORDS: readonly string[] = [
  'name', 'c/color', 'id/identity', 't/type', 'o/oracle', 'fo/fulloracle', 'kw/keyword', 'm/mana', 'mv/cmc', 'pow/power', 'tou/toughness', 'pt/powtou',
  'loy/loyalty', 'def/defense', 'f/format/legal', 'banned', 'restricted', 'is', 'not', 'has', 'layout', 'produces', 'devotion', 's/set/e/edition',
];

const PRINTING = 'the local card index has one entry per Oracle card and keeps no printing data (rarity, artist, flavor text, release date, collector number)';
const PRICES = 'the local card index keeps no prices';
const TAGS = "the local card index keeps no Scryfall Tagger (function/art) data";
const RESULTS = 'result options (sorting, grouping, display) are not supported: results come by relevance, then in Oracle-name order';

/** Scryfall keywords that exist but need data the local index does not have: keyword -> (what it is, why it is unsupported). */
const UNSUPPORTED: Readonly<Record<string, readonly [string, string]>> = {
  st: ['set type', PRINTING], b: ['block', PRINTING], block: ['block', PRINTING],
  r: ['rarity', PRINTING], rarity: ['rarity', PRINTING],
  a: ['artist', PRINTING], artist: ['artist', PRINTING],
  ft: ['flavor text', PRINTING], flavor: ['flavor text', PRINTING],
  wm: ['watermark', PRINTING], watermark: ['watermark', PRINTING],
  cn: ['collector number', PRINTING], number: ['collector number', PRINTING],
  stamp: ['security stamp', PRINTING], frame: ['frame', PRINTING], border: ['border', PRINTING],
  lang: ['language', PRINTING], language: ['language', PRINTING],
  year: ['release year', PRINTING], date: ['release date', PRINTING],
  in: ['printed in', PRINTING], new: ['new printing', PRINTING], game: ['game', PRINTING],
  prints: ['printing count', PRINTING], sets: ['printing count', PRINTING], paperprints: ['printing count', PRINTING], papersets: ['printing count', PRINTING],
  cheapest: ['cheapest printing', PRICES],
  usd: ['price in US dollars', PRICES], eur: ['price in euros', PRICES], tix: ['price in tickets', PRICES],
  function: ['function tag', TAGS], oracletag: ['oracle tag', TAGS], otag: ['oracle tag', TAGS], art: ['art tag', TAGS], arttag: ['art tag', TAGS], atag: ['art tag', TAGS],
  order: ['result order', RESULTS], direction: ['result direction', RESULTS], unique: ['result grouping', RESULTS], prefer: ['preferred printing', RESULTS],
  display: ['result display', RESULTS], include: ['extra results', RESULTS],
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Lexer

interface Val {
  text: string;
  quoted: boolean;
  regex: boolean;
}
type Tok =
  | { k: 'lp' | 'rp' | 'or' | 'and' | 'not' }
  | { k: 'term'; neg: boolean; key: string | null; op: ':' | Op | null; val: Val; raw: string };

const OP_PATTERN = /^(!=|<=|>=|:|=|<|>)/;
const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

/** The value starting at `i`: "quoted", 'quoted', /regex/ or a bare run up to a space or `)`. Returns the value and the index after it. */
function readValue(s: string, i: number, after: string): [Val, number] {
  const c = s[i];
  if (c === '"' || c === "'" || c === '/') {
    let j = i + 1;
    let text = '';
    for (; j < s.length && s[j] !== c; j++) {
      if (s[j] === '\\' && j + 1 < s.length) {
        // \" and \' unescape; in a regex every escape stays for the regex engine.
        if (c === '/' || (s[j + 1] !== c && s[j + 1] !== '\\')) text += s[j];
        j++;
      }
      text += s[j];
    }
    if (j >= s.length) return fail(c === '/' ? `The regular expression after "${after}" is missing its closing "/"` : `The quote after "${after}" is missing its closing ${c}`);
    if (!isSpace(s[j + 1]) && s[j + 1] !== ')') return fail(`Unexpected text after the closing ${c} of the value after "${after}"`);
    return [{ text, quoted: c !== '/', regex: c === '/' }, j + 1];
  }
  let j = i;
  while (j < s.length && !isSpace(s[j]) && s[j] !== ')') j++;
  return [{ text: s.slice(i, j), quoted: false, regex: false }, j];
}

function lex(input: string): Tok[] {
  const s = input.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      out.push({ k: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ k: 'rp' });
      i++;
      continue;
    }
    let neg = false;
    let start = i;
    if (c === '-') {
      if (s[i + 1] === '(') {
        out.push({ k: 'not' });
        i++;
        continue;
      }
      if (isSpace(s[i + 1])) return fail('A "-" must be directly followed by the term it negates, e.g. -t:land');
      neg = true;
      i++;
    }
    const first = s[i]!;
    if (first === '!') {
      const [val, end] = readValue(s, i + 1, '!');
      if (!val.text) return fail('"!" needs a card name after it, e.g. !"Lightning Bolt"');
      out.push({ k: 'term', neg, key: '!', op: ':', val, raw: s.slice(start, end) });
      i = end;
      continue;
    }
    const key = /^[A-Za-z_]+/.exec(s.slice(i))?.[0];
    const op = key ? OP_PATTERN.exec(s.slice(i + key.length))?.[1] : undefined;
    if (key && op) {
      const [val, end] = readValue(s, i + key.length + op.length, key + op);
      if (!val.text && !val.quoted) return fail(`Missing value after "${key}${op}"`);
      out.push({ k: 'term', neg, key: key.toLowerCase(), op: op as ':' | Op, val, raw: s.slice(start, end) });
      i = end;
      continue;
    }
    // A bare word, "quoted words" or /regex/: a card name. `or` / `and` on their own are operators.
    if (first === '"' || first === "'" || first === '/') {
      const [val, end] = readValue(s, i, first);
      out.push({ k: 'term', neg, key: null, op: null, val, raw: s.slice(start, end) });
      i = end;
      continue;
    }
    let j = i;
    while (j < s.length && !isSpace(s[j]) && s[j] !== ')' && s[j] !== '(') j++;
    const word = s.slice(i, j);
    const lower = word.toLowerCase();
    if (!neg && (lower === 'or' || lower === 'and')) out.push({ k: lower as 'or' | 'and' });
    else out.push({ k: 'term', neg, key: null, op: null, val: { text: word, quoted: false, regex: false }, raw: s.slice(start, j) });
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Row data (computed once per row, on first use by an advanced search)

interface FaceData {
  /** Folded names, type line and rules text (text keeps its line breaks). */
  name: string;
  type: string;
  text: string;
  /** As printed. */
  rawName: string;
  rawType: string;
  rawText: string;
  cost: string[];
  power: number | null;
  toughness: number | null;
  loyalty: number | null;
  defense: number | null;
  powerText: string;
  toughnessText: string;
}
interface RowData {
  faces: FaceData[];
  layout: string;
}

const foldLines = (s: string): string => s.split('\n').map(fold).join('\n');

/** A printed power, toughness, loyalty or defense as a number: "*" counts as 0 and "1+*" as 1 (as Scryfall does); "X" and "?" have no value. */
function statValue(s: string | undefined): number | null {
  if (s === undefined) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.includes('*')) {
    const m = /-?\d+/.exec(s);
    return m ? Number(m[0]) : 0;
  }
  return null;
}

/** Mana symbols of a cost, normalized: upper case, the parts of a hybrid symbol in alphabetical order ("{w/u}" and "{U/W}" are the same symbol). */
function costSymbols(cost: string | undefined): string[] {
  return [...(cost ?? '').matchAll(/\{([^}]+)\}/g)].map((m) => normalizeSymbol(m[1]!));
}
const normalizeSymbol = (s: string): string => s.toUpperCase().replace(/\s+/g, '').split('/').sort().join('/');

const data = new WeakMap<SearchRow, RowData>();
function dataOf(row: SearchRow): RowData {
  let d = data.get(row);
  if (!d) {
    const card = row.card;
    d = {
      layout: card.layout,
      faces: facesOf(card).map((f) => ({
        name: fold(f.name),
        type: fold(f.type_line ?? ''),
        text: foldLines(f.oracle_text ?? ''),
        rawName: f.name,
        rawType: f.type_line ?? '',
        rawText: f.oracle_text ?? '',
        cost: costSymbols(f.mana_cost),
        power: statValue(f.power),
        toughness: statValue(f.toughness),
        loyalty: statValue(f.loyalty),
        defense: statValue(f.defense),
        powerText: f.power ?? '',
        toughnessText: f.toughness ?? '',
      })),
    };
    data.set(row, d);
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Operators and value readers

const ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
const BIT: Readonly<Record<string, number>> = { W: 1, U: 2, B: 4, R: 8, G: 16, C: 32 };
const maskOf = (letters: string): number => [...letters.toUpperCase()].reduce((m, l) => m | (own(BIT, l) ?? 0), 0);
const bitCount = (n: number): number => {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
};

/** Two sets (bit masks) compared: = equal, >= superset, > strict superset, <= subset, < strict subset. */
function setCompare(op: Op, have: number, want: number): boolean {
  switch (op) {
    case '=': return have === want;
    case '!=': return have !== want;
    case '>=': return (have & want) === want;
    case '>': return (have & want) === want && have !== want;
    case '<=': return (have & ~want) === 0;
    case '<': return (have & ~want) === 0 && have !== want;
  }
}

const textOp = (key: string, op: string): void => {
  if (op !== ':') fail(`"${key}" takes ":" only (e.g. ${key}:value), not "${op}"`);
};
/** Operators of a comparison keyword: ":" means "=" unless the keyword gives it another meaning. */
const cmpOp = (op: string, colon: Op = '='): Op => (op === ':' ? colon : (op as Op));

function regexOf(src: string, key: string): RegExp {
  try {
    return new RegExp(src, 'im');
  } catch (e) {
    return fail(`The regular expression /${src}/ after "${key}" is not valid: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const COLOR_WORDS: Readonly<Record<string, string>> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'GW', orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'RW', simic: 'GU',
  bant: 'GWU', esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'RGW', abzan: 'WBG', jeskai: 'URW', sultai: 'BGU', mardu: 'RWB', temur: 'GUR',
  chaos: 'UBRG', aggression: 'WBRG', altruism: 'WURG', growth: 'WUBG', artifice: 'WUBR',
};

/** c: and id: values. `:` is ">=" for colors ("at least these") and "<=" for identity ("fits a deck of these colors"). */
function colorTest(key: 'c' | 'id', op: string, raw: string, color: (r: SearchRow) => number): RowTest {
  const v = raw.trim().toLowerCase();
  const plain = cmpOp(op, key === 'c' ? '>=' : '<=');
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    const o = cmpOp(op, '=');
    return (r) => compareNumber(o, bitCount(color(r)), n);
  }
  if (v === 'm' || v === 'multicolor' || v === 'multicolored') {
    if (op !== ':' && op !== '=' && op !== '>=' && op !== '!=') fail(`"${key}${op}${raw}": multicolor (m) works with ":", "=", ">=" and "!=" only`);
    return op === '!=' ? (r) => bitCount(color(r)) < 2 : (r) => bitCount(color(r)) >= 2;
  }
  let want: number;
  if (v === 'c' || v === 'colorless') want = 0;
  else if (own(COLOR_WORDS, v)) want = maskOf(own(COLOR_WORDS, v)!);
  else if (/^[wubrg]+$/.test(v)) want = maskOf(v);
  else return fail(`"${raw}" is not a color for ${key}: use letters (${ORDER.join('')}), c for colorless, m for multicolor, a color, guild, shard or wedge name, or a number of colors`);
  // "c:c" is "colorless", not "at least nothing".
  const o: Op = want === 0 && op === ':' ? '=' : plain;
  return (r) => setCompare(o, color(r), want);
}

/** Mana symbols typed after m: / devotion: — `{2}{R}{R}`, or the short form `2RR` (a number is one generic symbol; a hybrid is `R/G` or `{R/G}`). */
function manaSymbols(raw: string, key: string): string[] {
  const out: string[] = [];
  let rest = raw.trim();
  while (rest) {
    const m = /^\{([^}]+)\}|^(\d+)(?:\/([WUBRGP]))?|^([WUBRGCXSP])(?:\/([WUBRGP2]))?/i.exec(rest);
    if (!m) return fail(`"${raw}" after "${key}" is not a list of mana symbols; write them like {2}{R}{R} or 2RR`);
    out.push(normalizeSymbol(m[1] ?? (m[2] !== undefined ? (m[3] ? `${m[2]}/${m[3]}` : m[2]) : m[5] ? `${m[4]}/${m[5]}` : m[4]!)));
    rest = rest.slice(m[0].length);
  }
  return out;
}

function multiset(symbols: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of symbols) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

/** Multisets compared as sets of counted symbols (see setCompare). */
function multisetCompare(op: Op, have: Map<string, number>, want: Map<string, number>): boolean {
  const covers = (a: Map<string, number>, b: Map<string, number>) => [...b].every(([s, n]) => (a.get(s) ?? 0) >= n);
  const same = covers(have, want) && covers(want, have);
  switch (op) {
    case '=': return same;
    case '!=': return !same;
    case '>=': return covers(have, want);
    case '>': return covers(have, want) && !same;
    case '<=': return covers(want, have);
    case '<': return covers(want, have) && !same;
  }
}

type Field = 'pow' | 'tou' | 'mv' | 'loy' | 'def';
const FIELDS: Readonly<Record<string, Field>> = {
  pow: 'pow', power: 'pow', tou: 'tou', toughness: 'tou', mv: 'mv', cmc: 'mv', manavalue: 'mv', loy: 'loy', loyalty: 'loy', def: 'def', defense: 'def',
};

/** One number per face (cmc: one for the card). Missing values are null. */
function fieldValues(row: SearchRow, field: Field | 'pt'): (number | null)[] {
  if (field === 'mv') return [row.mv];
  const faces = dataOf(row).faces;
  switch (field) {
    case 'pow': return faces.map((f) => f.power);
    case 'tou': return faces.map((f) => f.toughness);
    case 'loy': return faces.map((f) => f.loyalty);
    case 'def': return faces.map((f) => f.defense);
    case 'pt': return faces.map((f) => (f.power !== null && f.toughness !== null ? f.power + f.toughness : null));
  }
}

/** mv/pow/tou/pt/loy/def: against a number, `even` / `odd` (mv), `*` (pow, tou: the printed star) or another of those fields (`pow>tou`). */
function numberKeyTest(key: Field | 'pt', op: string, raw: string): RowTest {
  const v = raw.trim().toLowerCase();
  const o = cmpOp(op);
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return (r) => fieldValues(r, key).some((a) => a !== null && compareNumber(o, a, n));
  }
  if (key === 'mv' && (v === 'even' || v === 'odd')) {
    if (o !== '=' && o !== '!=') fail(`"mv${op}${raw}": even and odd work with ":" and "=" (or "!=") only`);
    const want = v === 'even' ? 0 : 1;
    return (r) => Number.isInteger(r.mv) && (r.mv % 2 === want) === (o === '=');
  }
  if (v === '*' && (key === 'pow' || key === 'tou')) {
    if (o !== '=' && o !== '!=') fail(`"${key}${op}*": the star works with ":" and "=" (or "!=") only`);
    return (r) => dataOf(r).faces.some((f) => (key === 'pow' ? f.powerText : f.toughnessText).includes('*')) === (o === '=');
  }
  const other = own(FIELDS, v);
  if (other) {
    return (r) => {
      const a = fieldValues(r, key);
      const b = fieldValues(r, other);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[Math.min(i, a.length - 1)];
        const y = b[Math.min(i, b.length - 1)];
        if (x !== null && x !== undefined && y !== null && y !== undefined && compareNumber(o, x, y)) return true;
      }
      return false;
    };
  }
  return fail(`"${raw}" is not a number for ${key}${op}: use a number${key === 'mv' ? ', even, odd' : ''}${key === 'pow' || key === 'tou' ? ', *' : ''} or another stat (pow, tou, mv, loy, def)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// is: / not: / has: / layout:

const PERMANENT = /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/;
const has = (row: SearchRow, f: (d: FaceData) => boolean): boolean => dataOf(row).faces.some(f);
const layoutIs = (...layouts: string[]): RowTest => (r) => layouts.includes(r.card.layout);

/** Can this card be a commander (CR 903.3): a legendary creature, a legendary Vehicle or Spacecraft with power and toughness, or one that says so. */
function canBeCommander(r: SearchRow): boolean {
  const front = dataOf(r).faces[0];
  if (!front) return false;
  if (/\blegendary\b/.test(front.type) && /\bcreature\b/.test(front.type)) return true;
  if (/\blegendary\b/.test(front.type) && /\b(vehicle|spacecraft)\b/.test(front.type) && front.powerText !== '') return true;
  return has(r, (f) => f.text.includes('can be your commander'));
}

/** A creature whose rules text is only keyword abilities (reminder text aside): every segment of every line starts with one of the card's keywords. */
function frenchVanilla(r: SearchRow): boolean {
  const d = dataOf(r);
  if (!has(r, (f) => /\bcreature\b/.test(f.type)) || r.keywords.size === 0) return false;
  const keywords = [...r.keywords].map(fold);
  return d.faces.every((f) =>
    f.text
      .replace(/\([^)]*\)/g, '')
      .split('\n')
      .flatMap((line) => line.split(/[,;]/))
      .map((seg) => seg.trim())
      .filter(Boolean)
      .every((seg) => keywords.some((k) => seg === k || seg.startsWith(`${k} `))),
  );
}

const IS: Readonly<Record<string, RowTest>> = {
  commander: canBeCommander,
  permanent: (r) => has(r, (f) => PERMANENT.test(f.type)),
  spell: (r) => {
    const faces = dataOf(r).faces;
    return r.card.layout === 'modal_dfc' ? faces.some((f) => !/\bland\b/.test(f.type)) : !!faces[0] && !/\bland\b/.test(faces[0].type);
  },
  historic: (r) => has(r, (f) => /\b(artifact|legendary|saga)\b/.test(f.type)),
  vanilla: (r) => has(r, (f) => /\bcreature\b/.test(f.type)) && dataOf(r).faces.every((f) => f.rawText.trim() === ''),
  frenchvanilla: frenchVanilla,
  companion: (r) => has(r, (f) => /^companion\s+-/m.test(f.text)),
  hybrid: (r) => has(r, (f) => f.cost.some((s) => s.includes('/') && !s.includes('P'))),
  phyrexian: (r) => has(r, (f) => f.cost.some((s) => s.split('/').includes('P'))),
  funny: (r) => r.card.unsanctioned === true,
  split: layoutIs('split'),
  flip: layoutIs('flip'),
  transform: layoutIs('transform'),
  meld: layoutIs('meld'),
  leveler: layoutIs('leveler'),
  class: layoutIs('class'),
  case: layoutIs('case'),
  saga: layoutIs('saga'),
  adventure: layoutIs('adventure'),
  battle: layoutIs('battle'),
  prototype: layoutIs('prototype'),
  mutate: layoutIs('mutate'),
  augment: layoutIs('augment'),
  host: layoutIs('host'),
  planar: layoutIs('planar'),
  scheme: layoutIs('scheme'),
  vanguard: layoutIs('vanguard'),
  modal: layoutIs('modal_dfc'),
  mdfc: layoutIs('modal_dfc'),
  modal_dfc: layoutIs('modal_dfc'),
  dfc: layoutIs('transform', 'modal_dfc', 'meld', 'double_faced_token', 'reversible_card'),
  reversible: layoutIs('reversible_card'),
};

/** Properties of a printing, not of the card: `is:` with one of these is reported, not guessed. */
const IS_PRINTING = new Set([
  'reprint', 'promo', 'foil', 'nonfoil', 'etched', 'digital', 'spotlight', 'reserved', 'booster', 'fullart', 'textless', 'full', 'extended', 'borderless',
  'oversize', 'new', 'unique', 'universesbeyond', 'ub', 'gamechanger', 'masterpiece', 'concept', 'paper', 'mtgo', 'arena', 'unfinity',
]);

/** Names of the `is:` values this module supports (for the help and the messages). */
export const IS_VALUES: readonly string[] = Object.keys(IS);

const HAS: Readonly<Record<string, RowTest>> = {
  indicator: (r) => r.card.card_faces?.some((f) => (f.color_indicator?.length ?? 0) > 0) === true || (r.card.color_indicator?.length ?? 0) > 0,
  pt: (r) => has(r, (f) => f.powerText !== '' && f.toughnessText !== ''),
  loyalty: (r) => has(r, (f) => f.loyalty !== null),
  defense: (r) => has(r, (f) => f.defense !== null),
};

/** Scryfall's layout names. */
const LAYOUTS = [
  'normal', 'split', 'flip', 'transform', 'modal_dfc', 'meld', 'leveler', 'saga', 'adventure', 'planar', 'scheme', 'vanguard', 'token', 'double_faced_token',
  'emblem', 'augment', 'host', 'art_series', 'reversible_card', 'class', 'case', 'mutate', 'prototype', 'battle',
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Terms

interface Ctx {
  formats: string[];
  sets: string[];
  setCards: Map<string, ReadonlySet<string>>;
}

function unsupported(key: string, op: string): never {
  const u = own(UNSUPPORTED, key)!;
  return fail(`"${key}${op}" (${u[0]}) is not supported: ${u[1]}`);
}

function compileTerm(t: Extract<Tok, { k: 'term' }>, ctx: Ctx): RowTest {
  const v = t.val;
  if (!v.text.trim()) fail(`Missing value in ${t.raw}`);
  // A card name: bare word, "quoted words" or /regex/.
  if (t.key === null || t.key === 'name') {
    if (t.key === 'name') textOp('name', t.op!);
    if (v.regex) {
      const re = regexOf(v.text, 'name:');
      return (r) => r.card.name.match(re) !== null || facesOf(r.card).some((f) => re.test(f.name));
    }
    const needle = fold(v.text);
    return (r) => r.nameList.some((n) => n.includes(needle));
  }
  if (t.key === '!') {
    const needle = fold(v.text);
    return (r) => r.nameList.includes(needle);
  }
  const canonical = own(ALIASES, t.key);
  if (!canonical) {
    if (own(UNSUPPORTED, t.key)) return unsupported(t.key, t.op!);
    return fail(`Unknown search keyword "${t.key}". Supported keywords: ${SUPPORTED_KEYWORDS.join(', ')}. See ${SCRYFALL_DOCS}`);
  }
  const op = t.op!;
  const text = v.text;
  if (v.regex && !['o', 'fo', 't'].includes(canonical)) fail(`Regular expressions (/.../) are supported for name, o, fo and t only, not for "${t.key}"`);
  switch (canonical) {
    case 'c':
      return colorTest('c', op, text, (r) => r.colors);
    case 'id':
      return colorTest('id', op, text, (r) => r.identity);
    case 't': {
      textOp(t.key, op);
      if (v.regex) {
        const re = regexOf(text, 't:');
        return (r) => has(r, (f) => re.test(f.rawType));
      }
      const needle = fold(text);
      return (r) => has(r, (f) => f.type.includes(needle));
    }
    case 'o':
    case 'fo': {
      textOp(t.key, op);
      const full = canonical === 'fo';
      if (v.regex) {
        const re = regexOf(text, `${t.key}:`);
        return (r) => has(r, (f) => re.test(full ? `${f.rawName}\n${f.rawType}\n${f.rawText}` : f.rawText));
      }
      const needle = foldLines(text);
      // "~" stands for the card's own name (the face's, or the whole card's).
      return (r) => {
        const d = dataOf(r);
        return d.faces.some((f) => {
          const hay = full ? `${f.name}\n${f.type}\n${f.text}` : f.text;
          if (!needle.includes('~')) return hay.includes(needle);
          return [f.name, fold(r.card.name)].some((n) => hay.includes(needle.replace(/~/g, n)));
        });
      };
    }
    case 'kw': {
      textOp(t.key, op);
      const want = fold(text);
      return (r) => [...r.keywords].some((k) => fold(k) === want);
    }
    case 'm': {
      const want = multiset(manaSymbols(text, `${t.key}${op}`));
      const o = cmpOp(op, '>=');
      return (r) => has(r, (f) => multisetCompare(o, multiset(f.cost), want));
    }
    case 'mv':
    case 'pow':
    case 'tou':
    case 'pt':
    case 'loy':
    case 'def':
      return numberKeyTest(canonical, op, text);
    case 'f':
    case 'banned':
    case 'restricted': {
      textOp(t.key, op === '=' ? ':' : op);
      const name = text.trim().toLowerCase();
      if (!/^[a-z0-9 _-]{1,40}$/.test(name)) return fail(`"${text}" is not a format name; use one like modern, commander or pioneer`);
      const key = formatLegalityKey(name);
      if (key === null) return fail(`"${text}" is a format without a card pool, so "${t.key}:" cannot filter on it`);
      ctx.formats.push(key);
      if (canonical === 'f') return (r) => ['legal', 'restricted'].includes(legalityIn(r.card, key) ?? '');
      return (r) => legalityIn(r.card, key) === canonical;
    }
    case 's': {
      textOp(t.key, op === '=' ? ':' : op);
      const name = text.trim().toLowerCase();
      if (name.length > 60) return fail(`"${text}" is too long for a set code or name`);
      ctx.sets.push(name);
      const cards = ctx.setCards;
      return (r) => {
        const id = r.card.oracle_id;
        return id !== undefined && cards.get(name)?.has(id) === true;
      };
    }
    case 'is':
    case 'not': {
      textOp(t.key, op);
      const name = text.trim().toLowerCase();
      const test = own(IS, name);
      if (!test) {
        if (IS_PRINTING.has(name)) return fail(`"${t.key}:${name}" is not supported: ${PRINTING}`);
        return fail(`"${t.key}:${name}" is not a supported property. Supported: ${IS_VALUES.join(', ')}`);
      }
      return canonical === 'not' ? (r) => !test(r) : test;
    }
    case 'has': {
      textOp(t.key, op);
      const name = text.trim().toLowerCase();
      const test = own(HAS, name === 'power' || name === 'toughness' ? 'pt' : name);
      if (!test) return fail(`"has:${name}" is not supported. Supported: ${Object.keys(HAS).join(', ')}`);
      return test;
    }
    case 'layout': {
      textOp(t.key, op);
      const name = text.trim().toLowerCase();
      if (!LAYOUTS.includes(name)) return fail(`"${name}" is not a card layout. Layouts: ${LAYOUTS.join(', ')}`);
      return (r) => r.card.layout === name;
    }
    case 'produces': {
      const raw = text.trim().toLowerCase();
      if (!/^[wubrgc]+$/.test(raw) && !own(COLOR_WORDS, raw) && raw !== 'colorless') {
        return fail(`"${text}" is not a list of mana colors for produces: use letters (WUBRGC) or a color, guild, shard or wedge name`);
      }
      const want = raw === 'colorless' ? BIT.C! : own(COLOR_WORDS, raw) ? maskOf(own(COLOR_WORDS, raw)!) : maskOf(raw);
      const o = cmpOp(op, '>=');
      // A card that produces no mana is never a match, whatever the comparison ("produces<=ug" is not every card that makes nothing).
      return (r) => {
        const have = maskOf((r.card.produced_mana ?? []).join(''));
        return have !== 0 && setCompare(o, have, want);
      };
    }
    case 'devotion': {
      const symbols = manaSymbols(text, `${t.key}${op}`);
      // Devotion to each color named (CR 700.5): the symbols of that color in the mana cost, a hybrid symbol counting for each of its colors.
      const needs = new Map<string, number>();
      for (const s of symbols) {
        const colors = s.split('/').filter((p) => /^[WUBRG]$/.test(p));
        if (colors.length === 0) fail(`devotion counts colored mana symbols; "{${s}}" has none`);
        for (const c of colors) needs.set(c, (needs.get(c) ?? 0) + 1);
      }
      const o = cmpOp(op, '>=');
      return (r) =>
        has(r, (f) => [...needs].every(([c, n]) => compareNumber(o, f.cost.filter((s) => s.split('/').includes(c)).length, n)));
    }
  }
  return fail(`Unknown search keyword "${t.key}"`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Parser

function build(tokens: Tok[], ctx: Ctx): RowTest {
  let pos = 0;
  const peek = (): Tok | undefined => tokens[pos];

  const expr = (): RowTest => {
    const parts = [conj()];
    while (peek()?.k === 'or') {
      pos++;
      if (peek() === undefined || peek()!.k === 'rp') fail('"or" needs a search on its right side');
      parts.push(conj());
    }
    return parts.length === 1 ? parts[0]! : (r) => parts.some((p) => p(r));
  };

  const conj = (): RowTest => {
    const parts: RowTest[] = [];
    let dangling = false;
    for (let t = peek(); t && t.k !== 'rp' && t.k !== 'or'; t = peek()) {
      if (t.k === 'and') {
        pos++;
        if (parts.length === 0 || dangling) fail('"and" needs a search on its left side');
        dangling = true;
        continue;
      }
      dangling = false;
      parts.push(unary());
    }
    if (dangling) fail('"and" needs a search on its right side');
    if (parts.length === 0) fail(peek()?.k === 'rp' ? 'A ")" has no matching "("' : '"or" needs a search on its left side');
    return parts.length === 1 ? parts[0]! : (r) => parts.every((p) => p(r));
  };

  const unary = (): RowTest => {
    const t = tokens[pos++];
    if (!t) return fail('A "-" needs a search after it');
    if (t.k === 'not') {
      const inner = unary();
      return (r) => !inner(r);
    }
    if (t.k === 'lp') {
      if (peek()?.k === 'rp') return fail('Empty parentheses ()');
      const inner = expr();
      if (peek()?.k !== 'rp') return fail('A "(" is missing its closing ")"');
      pos++;
      return inner;
    }
    if (t.k === 'term') {
      const test = compileTerm(t, ctx);
      return t.neg ? (r) => !test(r) : test;
    }
    return fail(`Unexpected "${t.k === 'rp' ? ')' : t.k}"`);
  };

  const test = expr();
  if (pos < tokens.length) fail(tokens[pos]!.k === 'rp' ? 'A ")" has no matching "("' : `Unexpected "${tokens[pos]!.k}"`);
  return test;
}

/** Parse a Scryfall query; a string is the error message (naming the keyword or character at fault). */
export function parseScryfall(input: string): ScryfallSearch | string {
  try {
    const tokens = lex(input);
    if (tokens.length === 0) return `Type a search in Scryfall syntax, e.g. t:creature c:g mv<=3 (${SCRYFALL_DOCS})`;
    const ctx: Ctx = { formats: [], sets: [], setCards: new Map() };
    const test = build(tokens, ctx);
    return { test, formats: [...new Set(ctx.formats)], sets: [...new Set(ctx.sets)], setCards: ctx.setCards };
  } catch (e) {
    if (e instanceof ScryError) return e.message;
    throw e;
  }
}
