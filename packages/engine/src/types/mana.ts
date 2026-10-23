/** Colors (CR 105.1) and mana symbols (CR 107.4). */
export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAMES: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** A type of mana (CR 106.1b): one of the five colors or colorless. */
export type ManaType = Color | 'C';

/** One mana symbol in a cost (CR 107.4). */
export type ManaSymbol =
  | { kind: 'generic'; amount: number } // {0}, {1}, {2}, ... (CR 107.4b)
  | { kind: 'colored'; color: Color } // {W} ... (CR 107.4a)
  | { kind: 'colorless' } // {C} (CR 107.4c)
  | { kind: 'hybrid'; colors: [Color, Color] } // {W/U} (CR 107.4e)
  | { kind: 'monoHybrid'; color: Color; generic: number } // {2/W} (CR 107.4e)
  | { kind: 'colorlessHybrid'; color: Color } // {C/W} (CR 107.4e)
  | { kind: 'phyrexian'; color: Color } // {W/P} (CR 107.4f)
  | { kind: 'hybridPhyrexian'; colors: [Color, Color] } // {W/U/P} (CR 107.4f)
  | { kind: 'variable'; name: 'X' | 'Y' | 'Z' } // {X} (CR 107.3)
  | { kind: 'snow' }; // {S} (CR 107.4h)

export type ManaCost = ManaSymbol[];

const isColor = (c: string): c is Color => c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G';

/** Parse a single symbol body such as "2", "W", "W/U", "2/W", "W/P", "W/U/P", "X". */
export function parseManaSymbol(body: string): ManaSymbol {
  const b = body.toUpperCase();
  if (/^\d+$/.test(b)) return { kind: 'generic', amount: Number(b) };
  if (isColor(b)) return { kind: 'colored', color: b };
  if (b === 'C') return { kind: 'colorless' };
  if (b === 'X' || b === 'Y' || b === 'Z') return { kind: 'variable', name: b };
  if (b === 'S') return { kind: 'snow' };
  const parts = b.split('/');
  if (parts.length === 2) {
    const [p, q] = parts as [string, string];
    if (isColor(p) && q === 'P') return { kind: 'phyrexian', color: p };
    if (isColor(p) && isColor(q)) return { kind: 'hybrid', colors: [p, q] };
    if (/^\d+$/.test(p) && isColor(q)) return { kind: 'monoHybrid', color: q, generic: Number(p) };
    if (p === 'C' && isColor(q)) return { kind: 'colorlessHybrid', color: q };
  }
  if (parts.length === 3) {
    const [p, q, r] = parts as [string, string, string];
    if (isColor(p) && isColor(q) && r === 'P') return { kind: 'hybridPhyrexian', colors: [p, q] };
  }
  throw new Error(`Unknown mana symbol {${body}}`);
}

/** Parse a mana cost string like "{2}{W}{U/P}". Returns null for an empty string (no mana cost, CR 202.1b). */
export function parseManaCost(text: string | undefined | null): ManaCost | null {
  if (text === undefined || text === null || text.trim() === '') return null;
  const out: ManaSymbol[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  let consumed = '';
  while ((m = re.exec(text)) !== null) {
    out.push(parseManaSymbol(m[1]!));
    consumed += m[0];
  }
  if (consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) throw new Error(`Bad mana cost "${text}"`);
  return out;
}

export function formatManaSymbol(s: ManaSymbol): string {
  switch (s.kind) {
    case 'generic': return `{${s.amount}}`;
    case 'colored': return `{${s.color}}`;
    case 'colorless': return '{C}';
    case 'hybrid': return `{${s.colors[0]}/${s.colors[1]}}`;
    case 'monoHybrid': return `{${s.generic}/${s.color}}`;
    case 'colorlessHybrid': return `{C/${s.color}}`;
    case 'phyrexian': return `{${s.color}/P}`;
    case 'hybridPhyrexian': return `{${s.colors[0]}/${s.colors[1]}/P}`;
    case 'variable': return `{${s.name}}`;
    case 'snow': return '{S}';
  }
}

export function formatManaCost(cost: ManaCost | null): string {
  return cost ? cost.map(formatManaSymbol).join('') : '';
}

/**
 * Standard round 5, r5-trig (CR 107.4, 202.1, 700.5): the mana symbols of a cost that are of `color`: a colored, Phyrexian or hybrid symbol with that color counts
 * once, as devotion counts them (Namor the Sub-Mariner: "one or more blue mana symbols in its mana cost").
 */
export function colorSymbolCount(cost: ManaCost | null | undefined, color: Color): number {
  let n = 0;
  for (const s of cost ?? []) {
    switch (s.kind) {
      case 'colored': case 'phyrexian': case 'monoHybrid': case 'colorlessHybrid': if (s.color === color) n++; break;
      case 'hybrid': case 'hybridPhyrexian': if (s.colors.includes(color)) n++; break;
      default: break;
    }
  }
  return n;
}

/**
 * Mana value of a cost (CR 202.3). X counts as 0 except on the stack (CR 202.3e),
 * which callers handle by passing `x`.
 */
export function manaValue(cost: ManaCost | null, x = 0): number {
  if (!cost) return 0;
  let total = 0;
  for (const s of cost) {
    switch (s.kind) {
      case 'generic': total += s.amount; break;
      case 'monoHybrid': total += Math.max(s.generic, 1); break; // CR 202.3f: largest component
      case 'variable': total += x; break;
      default: total += 1;
    }
  }
  return total;
}

/** Colors of a mana cost (CR 202.2): each colored symbol contributes its colors. */
export function costColors(cost: ManaCost | null): Color[] {
  const set = new Set<Color>();
  for (const s of cost ?? []) {
    if (s.kind === 'colored' || s.kind === 'phyrexian' || s.kind === 'monoHybrid' || s.kind === 'colorlessHybrid') set.add(s.color);
    if (s.kind === 'hybrid' || s.kind === 'hybridPhyrexian') { set.add(s.colors[0]); set.add(s.colors[1]); }
  }
  return sortColors(set);
}

export function sortColors(cs: Iterable<Color>): Color[] {
  const set = new Set(cs);
  return COLORS.filter((c) => set.has(c));
}

export function toColors(xs: readonly string[] | undefined): Color[] {
  return sortColors((xs ?? []).filter(isColor));
}

/**
 * FAST5 T37 (CR 601.2h, 106.1): was at least `spent.atLeast` of the mana spent to cast a spell of color `spent.color`? ("If at least three white mana was spent
 * to cast this spell", adamant.) \`units\` is the mana paid for the spell (CostsPaid.manaSpent); a spell that was not cast has paid none.
 */
export function spentAtLeast(units: readonly { type: ManaType }[] | undefined, spent: { color: Color; atLeast: number }): boolean {
  return (units ?? []).filter((u) => u.type === spent.color).length >= spent.atLeast;
}
