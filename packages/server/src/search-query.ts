/**
 * GET /api/cards/search query -> card predicate (api.ts SearchQuery explains each parameter). Pure: no I/O. Invalid parameter syntax, an unknown
 * parameter name and an unbalanced quote are reported as an error message (the handler answers 400), never ignored, so a filter the player set is never
 * silently dropped. The format is checked against the index's legality data by the handler (search.ts), which knows the store.
 */
import type { IndexedCard } from '@openmtg/cards';
import type { AutomationLevel, Color } from '@openmtg/engine';
import { formatLegalityKey } from './formats-adapter';
import { parseScryfall } from './scryfall-search';
import { cardColors, cardIdentity, facesOf } from './summary';

/** Searchable data of one card, computed once per index (store.derived). */
export interface SearchRow {
  card: IndexedCard;
  /** Folded full name and face names, one per line. */
  names: string;
  /** The same names as a list (relevance ranking). */
  nameList: readonly string[];
  /** Folded rules text of every face. */
  text: string;
  /** Lower-case words of every face's type line (types, supertypes, subtypes). */
  typeWords: ReadonlySet<string>;
  colors: number;
  identity: number;
  mv: number;
  powers: readonly string[];
  toughnesses: readonly string[];
  keywords: ReadonlySet<string>;
}

/** Case-, accent- and quote-insensitive form for substring matching. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/ ?\/\/ ?/g, ' // '); // the split-card separator, typed with or without spaces
}

const BIT: Readonly<Record<Color, number>> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
const mask = (colors: readonly Color[]): number => colors.reduce((m, c) => m | BIT[c], 0);

export function searchRow(card: IndexedCard): SearchRow {
  const faces = facesOf(card);
  const multi = faces.length > 1 || faces[0] !== card;
  const nameList = [card.name, ...(multi ? faces.map((f) => f.name) : [])].map(fold);
  return {
    card,
    names: nameList.join('\n'),
    nameList,
    text: fold(faces.map((f) => f.oracle_text ?? '').join('\n')),
    typeWords: new Set(faces.flatMap((f) => (f.type_line ?? '').toLowerCase().split(/[\s—]+/).filter((w) => w !== '' && w !== '//'))),
    colors: mask(cardColors(card)),
    identity: mask(cardIdentity(card)),
    mv: card.cmc ?? 0,
    powers: faces.flatMap((f) => (f.power !== undefined ? [f.power] : [])),
    toughnesses: faces.flatMap((f) => (f.toughness !== undefined ? [f.toughness] : [])),
    keywords: new Set((card.keywords ?? []).map((k) => k.toLowerCase())),
  };
}

export type RowTest = (row: SearchRow) => boolean;

export interface ParsedSearch {
  tests: RowTest[];
  /** Relevance tier of a matching row (lower first), when the query names a card (`q` or `name`). */
  rank?: (row: SearchRow) => number;
  /** The Scryfall legality key to filter on (an alias already mapped), when the query has a format with a card pool. */
  formatKey?: string;
  /** Scryfall legality keys named by the `scry` query (f:, banned:, restricted:); the handler checks the index has data for each. */
  scryFormats: string[];
  /** Sets named by the `scry` query (s:, set:, e:, edition:) and the map the handler fills with their cards (scryfall-search.ts ScryfallSearch). */
  scrySets: string[];
  scrySetCards: Map<string, ReadonlySet<string>>;
  automation?: AutomationLevel;
  page: number;
  pageSize: number;
  images: boolean;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
const MAX_TEXT = 500;

/** Words, with "double-quoted phrases" kept together (curly quotes count as straight ones). */
export function terms(input: string): string[] {
  const out: string[] = [];
  for (const m of input.replace(/[“”]/g, '"').matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = fold((m[1] ?? m[2] ?? '').trim());
    if (t) out.push(t);
  }
  return out;
}

export type Op = '=' | '!=' | '<' | '<=' | '>' | '>=';

export function compareNumber(op: Op, a: number, b: number): boolean {
  switch (op) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
}

/** "3", "<=2", ">=5", "!=1" -> a number test; null when the text is not a comparison. */
export function numberTest(input: string): ((n: number) => boolean) | null {
  const m = /^\s*(<=|>=|!=|<|>|=)?\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input);
  if (!m) return null;
  const op = (m[1] ?? '=') as Op;
  const want = Number(m[2]);
  return (n) => compareNumber(op, n, want);
}

/** Power or toughness values ("2", "*", "1+*"): numeric comparison for numbers, exact text otherwise (so "*" finds the star creatures). */
function statTest(input: string): ((values: readonly string[]) => boolean) | null {
  const num = numberTest(input);
  if (num) return (values) => values.some((v) => /^-?\d+(\.\d+)?$/.test(v) && num(Number(v)));
  const text = input.trim();
  if (!text || text.length > 10 || /[<>=]/.test(text)) return null;
  return (values) => values.includes(text);
}

/**
 * Color letters with an optional operator. ">=" at least these colors, "=" exactly, "<=" nothing outside them, ">" / "<" strictly. "C" alone means
 * colorless (with any operator but "!=", which means "has a color").
 */
export function colorTest(input: string, defaultOp: '>=' | '<='): ((m: number) => boolean) | null {
  const m = /^\s*(<=|>=|!=|<|>|=)?\s*([wubrgcWUBRGC]+)\s*$/.exec(input);
  if (!m) return null;
  const op = (m[1] ?? defaultOp) as Op;
  const letters = [...new Set(m[2]!.toUpperCase())];
  if (letters.includes('C')) {
    if (letters.length > 1) return null;
    return op === '!=' ? (c) => c !== 0 : (c) => c === 0;
  }
  const want = mask(letters as Color[]);
  switch (op) {
    case '=': return (c) => c === want;
    case '!=': return (c) => c !== want;
    case '>=': return (c) => (c & want) === want;
    case '>': return (c) => (c & want) === want && c !== want;
    case '<=': return (c) => (c & ~want) === 0;
    case '<': return (c) => (c & ~want) === 0 && c !== want;
  }
}

function positiveInt(v: string | undefined, fallback: number, max: number, name: string): number | string {
  if (v === undefined || v === '') return fallback;
  if (!/^\d+$/.test(v)) return `${name} must be a positive whole number`;
  const n = Number(v);
  if (n < 1 || n > max) return `${name} must be between 1 and ${max}`;
  return n;
}

const LEVELS: readonly string[] = ['full', 'partial', 'manual'];
const list = (v: string): string[] => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Type words as typed: commas, spaces and the type-line dash separate them ("Legendary Creature — Elf", "creature - elf", "creature,elf"); a hyphen
 * inside a word stays ("Assembly-Worker").
 */
export function typeList(v: string): string[] {
  return v
    .toLowerCase()
    .split(/[\s,—–]+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

/** Every parameter of api.ts SearchQuery; any other name answers 400. */
export const SEARCH_PARAMS: readonly string[] = ['q', 'name', 'text', 'colors', 'identity', 'types', 'mv', 'pow', 'tou', 'keywords', 'format', 'automation', 'scry', 'page', 'pageSize', 'images'];

/**
 * Relevance tier of a row for the words a player typed as a card name (lower first): 0 the full name is the phrase, 1 a face name is, 2 a name starts
 * with it, 3 the names hold every word, 4 the words are only in the rules text.
 */
export function relevance(phrase: string, words: readonly string[]): (row: SearchRow) => number {
  return (r) => {
    if (r.nameList[0] === phrase) return 0;
    if (r.nameList.includes(phrase)) return 1;
    if (r.nameList.some((n) => n.startsWith(phrase))) return 2;
    if (words.every((w) => r.names.includes(w))) return 3;
    return 4;
  };
}

/** Parse the query parameters; a string is the error message for a 400 answer. */
export function parseSearch(query: Record<string, string>): ParsedSearch | string {
  const unknown = Object.keys(query).filter((k) => !SEARCH_PARAMS.includes(k));
  if (unknown.length) return `Unknown search parameter${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')}; the parameters are ${SEARCH_PARAMS.join(', ')}`;
  for (const [k, v] of Object.entries(query)) if (v.length > MAX_TEXT) return `Parameter ${k} is too long (max ${MAX_TEXT} characters)`;
  for (const k of ['q', 'name', 'text'] as const) {
    if (query[k] && (query[k].replace(/[“”]/g, '"').match(/"/g) ?? []).length % 2 === 1) return `${k} has an opening quote without a closing one`;
  }
  const tests: RowTest[] = [];
  if (query.q) for (const t of terms(query.q)) tests.push((r) => r.names.includes(t) || r.text.includes(t));
  if (query.name) for (const t of terms(query.name)) tests.push((r) => r.names.includes(t));
  if (query.text) for (const t of terms(query.text)) tests.push((r) => r.text.includes(t));
  if (query.types) for (const t of typeList(query.types)) tests.push((r) => r.typeWords.has(t));
  if (query.keywords) for (const k of list(query.keywords)) tests.push((r) => r.keywords.has(k));
  if (query.colors) {
    const c = colorTest(query.colors, '>=');
    if (!c) return 'colors must be color letters (WUBRG, or C for colorless) with an optional operator (=, <=, >=, <, >, !=)';
    tests.push((r) => c(r.colors));
  }
  if (query.identity) {
    const c = colorTest(query.identity, '<=');
    if (!c) return 'identity must be color letters (WUBRG, or C for colorless) with an optional operator (=, <=, >=, <, >, !=)';
    tests.push((r) => c(r.identity));
  }
  if (query.mv) {
    const n = numberTest(query.mv);
    if (!n) return 'mv must be a number with an optional comparison, e.g. 3, <=2, >=5';
    tests.push((r) => n(r.mv));
  }
  for (const [param, field] of [['pow', 'powers'], ['tou', 'toughnesses']] as const) {
    const v = query[param];
    if (!v) continue;
    const s = statTest(v);
    if (!s) return `${param} must be a number with an optional comparison (e.g. >=4) or a printed value such as *`;
    tests.push((r) => s(r[field]));
  }
  let scryFormats: string[] = [];
  let scrySets: string[] = [];
  let scrySetCards = new Map<string, ReadonlySet<string>>();
  if (query.scry !== undefined && query.scry.trim() !== '') {
    const scry = parseScryfall(query.scry);
    if (typeof scry === 'string') return scry;
    tests.push(scry.test);
    scryFormats = scry.formats;
    scrySets = scry.sets;
    scrySetCards = scry.setCards;
  }
  let formatKey: string | null = null;
  if (query.format) {
    const format = query.format.trim().toLowerCase();
    if (!/^[a-z0-9 _-]{1,40}$/.test(format)) return 'format must be a Scryfall format name, e.g. modern';
    formatKey = formatLegalityKey(format); // null: freeform / casual, no card-pool filter
  }
  let automation: AutomationLevel | undefined;
  if (query.automation) {
    if (!LEVELS.includes(query.automation)) return 'automation must be full, partial or manual';
    automation = query.automation as AutomationLevel;
  }
  const page = positiveInt(query.page, 1, 1_000_000, 'page');
  if (typeof page === 'string') return page;
  const pageSize = positiveInt(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 'pageSize');
  if (typeof pageSize === 'string') return pageSize;
  const out: ParsedSearch = { tests, scryFormats, scrySets, scrySetCards, page, pageSize, images: query.images === '1' };
  if (automation) out.automation = automation;
  if (formatKey) out.formatKey = formatKey;
  const asName = query.q || query.name;
  if (asName) {
    const words = terms(asName);
    if (words.length) out.rank = relevance(fold(words.join(' ')), words);
  }
  return out;
}
