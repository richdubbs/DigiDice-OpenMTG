/**
 * Mana and other rules-text symbols as our own lettered circles (docs/design/m8-client.md "Visual design": no Wizards mana symbols; "a 2 circle and a
 * green G circle"). Pure: turns "{2}{G/P}" into glyph descriptions; ManaGlyph.tsx draws them.
 *
 * Symbols (CR 107.4): generic {0}..{N} (CR 107.4b), colored {W}{U}{B}{R}{G} (107.4a), colorless {C} (107.4c), hybrid {W/U} (107.4e), monocolored hybrid
 * {2/W} (107.4e), colorless hybrid {C/W}, Phyrexian {W/P} and {W/U/P} (107.4f), the generic Phyrexian symbol {H} (107.4g), variable {X}{Y}{Z} (107.3),
 * snow {S} (107.4h), and the other symbols of rules text: tap {T} (107.5), untap {Q} (107.6), chaos {CHAOS} (107.12), energy {E} (107.14), the pawprint
 * {P} that marks modes and is not mana (107.18), half mana {HW} (107.4) and anything else (shown as written).
 */
import type { Color } from '@openmtg/engine';

export type GlyphColor = Color | 'C' | 'none';

export interface Glyph {
  /** The symbol as written, without braces ("2", "G/P", "T"). */
  symbol: string;
  /** Text inside the circle. */
  label: string;
  /** Fill colors: one for a plain symbol, two for a hybrid (split fill). */
  colors: GlyphColor[];
  /** Spoken name, for screen readers and the tooltip ("one green mana", "tap"). */
  name: string;
  phyrexian: boolean;
}

const COLOR_WORD: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const isColor = (s: string): s is Color => s === 'W' || s === 'U' || s === 'B' || s === 'R' || s === 'G';

/** Describe one symbol body ("2", "W/U", "T"). Never throws: an unknown symbol is shown as written. */
export function glyphOf(body: string): Glyph {
  const b = body.trim().toUpperCase();
  const g = (label: string, colors: GlyphColor[], name: string, phyrexian = false): Glyph => ({ symbol: b, label, colors, name, phyrexian });
  if (/^\d+$/.test(b)) return g(b, ['none'], `${b} generic mana`);
  if (b === '½' || b === '1/2') return g('½', ['none'], 'half a generic mana');
  if (isColor(b)) return g(b, [b], `one ${COLOR_WORD[b]} mana`);
  if (b === 'C') return g('C', ['C'], 'one colorless mana');
  if (b === 'X' || b === 'Y' || b === 'Z') return g(b, ['none'], `${b} generic mana`);
  if (b === 'S') return g('S', ['none'], 'one snow mana');
  if (b === 'T') return g('T', ['none'], 'tap');
  if (b === 'Q') return g('Q', ['none'], 'untap');
  if (b === 'E') return g('E', ['none'], 'one energy');
  if (b === 'CHAOS') return g('CH', ['none'], 'chaos');
  // CR 107.18: the pawprint marks the modes of some modal spells; it is not a cost, mana, counters or any other resource.
  if (b === 'P') return g('P', ['none'], 'pawprint (marks a mode)');
  // CR 107.4g: {H} with no colored background means any of the fifteen Phyrexian mana symbols.
  if (b === 'H') return g('Φ', ['none'], 'any Phyrexian mana symbol', true);
  if (/^H[WUBRG]$/.test(b)) {
    const c = b[1] as Color;
    return g(`½${c}`, [c], `half a ${COLOR_WORD[c]} mana`);
  }
  const parts = b.split('/');
  if (parts.length === 2) {
    const [p, q] = parts as [string, string];
    if (isColor(p) && q === 'P') return g(p, [p], `one ${COLOR_WORD[p]} Phyrexian mana`, true);
    if (isColor(p) && isColor(q)) return g(`${p}/${q}`, [p, q], `one ${COLOR_WORD[p]} or ${COLOR_WORD[q]} mana`);
    if (/^\d+$/.test(p) && isColor(q)) return g(`${p}/${q}`, ['none', q], `${p} generic or one ${COLOR_WORD[q]} mana`);
    if (p === 'C' && isColor(q)) return g(`C/${q}`, ['C', q], `one colorless or ${COLOR_WORD[q]} mana`);
  }
  if (parts.length === 3) {
    const [p, q, r] = parts as [string, string, string];
    if (isColor(p) && isColor(q) && r === 'P') return g(`${p}/${q}`, [p, q], `one ${COLOR_WORD[p]} or ${COLOR_WORD[q]} Phyrexian mana`, true);
  }
  return g(b, ['none'], `symbol ${b}`);
}

/** The glyphs of a mana cost ("{2}{G}" -> [2, G]); an empty or missing cost has none (CR 202.1b). Text outside braces is ignored. */
export function manaGlyphs(cost: string | null | undefined): Glyph[] {
  if (!cost) return [];
  const out: Glyph[] = [];
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) out.push(glyphOf(m[1]!));
  return out;
}

/** Rules text split into plain text and symbols ("{T}: Add {G}." -> [T, ": Add ", G, "."]). */
export type TextPiece = { kind: 'text'; text: string } | { kind: 'glyph'; glyph: Glyph };

export function splitSymbols(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([^{}]{1,8})\}/g)) {
    const i = m.index;
    if (i > at) out.push({ kind: 'text', text: text.slice(at, i) });
    out.push({ kind: 'glyph', glyph: glyphOf(m[1]!) });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/** A spoken form of a whole cost ("{2}{G}" -> "2 generic mana, one green mana"); "no mana cost" when there is none. */
export function manaCostName(cost: string | null | undefined): string {
  const gs = manaGlyphs(cost);
  return gs.length === 0 ? 'no mana cost' : gs.map((g) => g.name).join(', ');
}
