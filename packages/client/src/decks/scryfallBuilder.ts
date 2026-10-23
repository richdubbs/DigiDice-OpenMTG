/**
 * The Advanced search form's helpers (SearchPanel.tsx): the fields that write Scryfall syntax (https://scryfall.com/docs/syntax) into the query box, the
 * cheat sheet's examples, and the keywords that are not available. The syntax itself is read by the server (packages/server/src/scryfall-search.ts).
 * Pure.
 */

export const SCRYFALL_SYNTAX_URL = 'https://scryfall.com/docs/syntax';

/** The form's fields; every one is optional (empty = not used). */
export interface BuilderFields {
  name: string;
  oracle: string;
  type: string;
  keyword: string;
  colors: string;
  colorsOp: ColorOp;
  identity: string;
  identityOp: ColorOp;
  mv: string;
  mvOp: CompareOp;
  power: string;
  powerOp: CompareOp;
  toughness: string;
  toughnessOp: CompareOp;
  format: string;
  /** A set code (dmu) or name (Dominaria United). */
  set: string;
  produces: string;
  is: string;
}

export type CompareOp = '=' | '>=' | '<=' | '>' | '<' | '!=';
/** How a color set is compared: ":" is Scryfall's default (c: at least these colors, id: within these colors). */
export type ColorOp = ':' | '=' | '>=' | '<=' | '>' | '<';

export const EMPTY_BUILDER: BuilderFields = {
  name: '', oracle: '', type: '', keyword: '', colors: '', colorsOp: ':', identity: '', identityOp: ':', mv: '', mvOp: '=', power: '', powerOp: '=', toughness: '',
  toughnessOp: '=', format: '', set: '', produces: '', is: '',
};

export const COMPARE_OPS: readonly { op: CompareOp; label: string }[] = [
  { op: '=', label: 'equals' },
  { op: '>=', label: 'at least' },
  { op: '<=', label: 'at most' },
  { op: '>', label: 'more than' },
  { op: '<', label: 'less than' },
  { op: '!=', label: 'not' },
];

export const COLOR_OPS: readonly { op: ColorOp; label: string }[] = [
  { op: ':', label: 'including / within' },
  { op: '=', label: 'exactly' },
  { op: '>=', label: 'at least' },
  { op: '<=', label: 'at most' },
  { op: '>', label: 'more than' },
  { op: '<', label: 'fewer than' },
];

/** Formats offered by the form (any other can be typed in the query itself). */
export const FORMAT_CHOICES: readonly string[] = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'brawl', 'historic', 'timeless', 'oathbreaker'];

/** `is:` properties offered by the form. */
export const IS_CHOICES: readonly string[] = ['commander', 'permanent', 'spell', 'historic', 'vanilla', 'frenchvanilla', 'split', 'transform', 'mdfc', 'dfc', 'adventure', 'hybrid'];

/** A value as one term needs it: quoted when it holds spaces, quotes or parentheses. */
export function termValue(value: string): string {
  const v = value.trim();
  return /[\s"'()]/.test(v) ? `"${v.replace(/"/g, '')}"` : v;
}

/** The terms the filled fields make, in a fixed order ("t:creature", "c>=rg", "mv<=3", ...). */
export function builderTerms(f: BuilderFields): string[] {
  const out: string[] = [];
  const add = (key: string, op: string, value: string) => {
    if (value.trim()) out.push(`${key}${op}${termValue(value)}`);
  };
  add('name', ':', f.name);
  add('o', ':', f.oracle);
  add('t', ':', f.type);
  add('kw', ':', f.keyword);
  add('c', f.colorsOp, f.colors);
  add('id', f.identityOp, f.identity);
  add('mv', f.mvOp, f.mv);
  add('pow', f.powerOp, f.power);
  add('tou', f.toughnessOp, f.toughness);
  add('f', ':', f.format);
  add('s', ':', f.set);
  add('produces', ':', f.produces);
  add('is', ':', f.is);
  return out;
}

/** The query box's text with the form's terms added (a space between; nothing changes when the form is empty). */
export function appendTerms(query: string, terms: readonly string[]): string {
  if (terms.length === 0) return query;
  const base = query.trim();
  return base ? `${base} ${terms.join(' ')}` : terms.join(' ');
}

/** Cheat sheet rows: what to type and what it finds. */
export const SYNTAX_EXAMPLES: readonly { query: string; finds: string }[] = [
  { query: 't:creature c:g mv<=3', finds: 'Cheap green creatures (words are ANDed)' },
  { query: 'o:"draw a card" -t:creature', finds: 'Rules text containing a phrase, minus creatures (- negates)' },
  { query: 'o:"~ deals" (c:r or c:u)', finds: '~ is the card\'s own name; ( ) group and "or" alternates' },
  { query: 'id<=esper', finds: 'Color identity within a set of colors (names, guilds, shards, letters)' },
  { query: 'c=rg', finds: 'Exactly red and green (= >= <= > < != compare color sets)' },
  { query: 'c:c', finds: 'Colorless (c:m is multicolor)' },
  { query: 'm:{2}{R}{R}', finds: 'Mana cost containing these symbols (m={1}{G} for exactly)' },
  { query: 'mv:even pow>=4', finds: 'Mana value even / odd, or compared with a number' },
  { query: 'pow>tou', finds: 'One stat against another (pow, tou, mv, loy, def)' },
  { query: 'kw:flying t:angel', finds: 'A keyword the card has, with a type' },
  { query: 'f:modern -banned:legacy', finds: 'Legal in a format (f:, banned:, restricted:)' },
  { query: 's:dmu t:creature', finds: 'Printed in a set: its code or name (s:, set:, e:, edition:)' },
  { query: 'is:commander id<=wb', finds: 'Can be a commander (also is:permanent, is:spell, is:historic, is:vanilla, is:mdfc ...)' },
  { query: 'produces:g', finds: 'Mana a card can make' },
  { query: '!"Lightning Bolt"', finds: 'The exact card name' },
  { query: 'name:/^jace/ or t:/saga/', finds: '/regex/ for names, rules text (o:), and types (t:)' },
];

/** What the card data cannot answer (said in the panel; the server names the keyword if one is used anyway). */
export const UNAVAILABLE_NOTE = 'Not available (the card data has no printing details): block, rarity, artist, flavor text, year or date, prices and tags.';

/**
 * Scryfall's search keywords (https://scryfall.com/docs/syntax), the ones the server reads and the ones it names as unavailable. The main search box
 * sends its text as Scryfall syntax when it uses one of them (looksLikeScryfall); other text searches names and rules text as before.
 */
const SCRYFALL_KEYWORDS: ReadonlySet<string> = new Set([
  'name', 'c', 'color', 'colors', 'id', 'identity', 'ci', 'commander', 't', 'type', 'o', 'oracle', 'fo', 'fulloracle', 'kw', 'keyword', 'm', 'mana', 'mv',
  'cmc', 'manavalue', 'pow', 'power', 'tou', 'toughness', 'pt', 'powtou', 'loy', 'loyalty', 'def', 'defense', 'f', 'format', 'legal', 'banned',
  'restricted', 'is', 'not', 'has', 'layout', 'produces', 'devotion', 's', 'set', 'e', 'edition',
  'st', 'b', 'block', 'r', 'rarity', 'a', 'artist', 'ft', 'flavor', 'wm', 'watermark', 'cn', 'number', 'stamp', 'frame', 'border', 'lang', 'language',
  'year', 'date', 'in', 'new', 'game', 'prints', 'sets', 'paperprints', 'papersets', 'cheapest', 'usd', 'eur', 'tix', 'function', 'oracletag', 'otag',
  'art', 'arttag', 'atag', 'order', 'direction', 'unique', 'prefer', 'display', 'include',
]);

const KEYWORD_TERM = /(?:^|[\s(])-?([a-z]+)(?:!=|<=|>=|:|=|<|>)/gi;

/** The text uses Scryfall syntax: a keyword term (t:creature, -s:dmu, mv<=2) or an exact name (!"Lightning Bolt"). "Protection: Red" does not. */
export function looksLikeScryfall(text: string): boolean {
  for (const m of text.matchAll(KEYWORD_TERM)) if (SCRYFALL_KEYWORDS.has(m[1]!.toLowerCase())) return true;
  return /(?:^|\s)!\S/.test(text);
}
