/**
 * Deck statistics for the deckbuilder (docs/design/decks-and-formats.md "Stats"): mana curve, colored mana symbols in costs vs. lands that can make
 * each color, card types, land count. These are building aids read from the printed card text, not rules decisions; cards whose data has not loaded
 * yet are counted as "not loaded" instead of being guessed.
 */
import type { CardSummary } from '@openmtg/server/api';
import type { Color } from '@openmtg/engine';
import type { Deck, DeckEntry } from './model';

export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAME: Record<Color, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
/** Card types counted in the type breakdown (CR 300.1), in display order. */
export const CARD_TYPES = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Kindred', 'Land'] as const;
/** Mana curve buckets: 0..6 and "7+". */
export const CURVE_BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'] as const;

/** The Arena-style mana curve buckets: 1 or less, 2, 3, 4, 5, 6 or more. */
export const ARENA_BUCKETS = ['1-', '2', '3', '4', '5', '6+'] as const;
/** Card-type groups of the type breakdown (each card counted once, under the first of these it has; CR 300.1), in display order. */
export const TYPE_GROUPS = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Kindred', 'Land'] as const;
/** The order a card is assigned to a group in: a land creature is a creature, an artifact land is a land. */
const GROUP_PRIORITY = ['Creature', 'Land', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Kindred'] as const;

export interface TypeGroup {
  type: (typeof TYPE_GROUPS)[number];
  count: number;
  /** Subtypes (the words after the dash of the type line) with their copy counts, most copies first. */
  subtypes: { name: string; count: number }[];
}

export interface DeckStats {
  /** Non-land cards per Arena curve bucket (ARENA_BUCKETS), split by creature and non-creature. */
  curveCreature: number[];
  curveOther: number[];
  /** Average mana value of the non-land cards (0 without any). */
  average: number;
  /** Non-land cards counted. */
  spells: number;
  /** Cards per type group (each card once), with subtypes; empty groups are left out. */
  groups: TypeGroup[];
  /** Non-land cards per mana value bucket (main deck and commander). */
  curve: number[];
  /** Colored mana symbols in the costs of main-deck and commander cards. */
  pips: Record<Color, number>;
  /** Main-deck lands that can produce each color. */
  sources: Record<Color, number>;
  types: Record<(typeof CARD_TYPES)[number], number>;
  lands: number;
  /** Copies whose card data is not loaded (or unknown), left out of the numbers above. */
  notLoaded: number;
}

const BASIC_TYPE_COLOR: Record<string, Color> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

const frontTypeLine = (c: CardSummary) => c.faces[0]?.typeLine ?? '';
export const isLand = (c: CardSummary) => /\bLand\b/.test(frontTypeLine(c));

/** Colored symbols of a mana cost: "{1}{G}{G}" -> G 2; hybrid "{G/W}" counts for both colors; Phyrexian "{G/P}" counts as G. */
export function costPips(cost: string | null | undefined): Record<Color, number> {
  const out: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const m of (cost ?? '').matchAll(/\{([^}]+)\}/g)) for (const ch of new Set(m[1]!.split('/'))) if ((COLORS as readonly string[]).includes(ch)) out[ch as Color] += 1;
  return out;
}

/** Colors a land can produce, read from its type line (basic land types, CR 305.6) and "Add {X}" / "mana of any color" in its text. */
export function landColors(c: CardSummary): Set<Color> {
  const out = new Set<Color>();
  const face = c.faces[0];
  if (!face) return out;
  for (const [type, color] of Object.entries(BASIC_TYPE_COLOR)) if (new RegExp(`\\b${type}\\b`).test(face.typeLine)) out.add(color);
  const text = face.oracleText;
  if (/mana of any (?:one )?color|any color of mana/i.test(text)) COLORS.forEach((col) => out.add(col));
  for (const add of text.matchAll(/Add ([^.]*)/g)) for (const m of add[1]!.matchAll(/\{([WUBRG])\}/g)) out.add(m[1] as Color);
  return out;
}

function costOf(c: CardSummary): string {
  return c.layout === 'split' ? c.faces.map((f) => f.manaCost ?? '').join('') : (c.faces[0]?.manaCost ?? '');
}

export function deckStats(deck: Deck, cards: ReadonlyMap<string, CardSummary>): DeckStats {
  const s: DeckStats = {
    curve: CURVE_BUCKETS.map(() => 0),
    pips: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    sources: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    types: Object.fromEntries(CARD_TYPES.map((t) => [t, 0])) as DeckStats['types'],
    lands: 0,
    notLoaded: 0,
    curveCreature: [],
    curveOther: [],
    average: 0,
    spells: 0,
    groups: [],
  };
  const playing: DeckEntry[] = [...deck.main, ...deck.commander];
  const arena = { creature: ARENA_BUCKETS.map(() => 0), other: ARENA_BUCKETS.map(() => 0) };
  const sub = new Map<string, Map<string, number>>();
  const groupCount = new Map<string, number>();
  let mvTotal = 0;
  let spells = 0;
  for (const e of playing) {
    const c = cards.get(e.name);
    if (!c) {
      s.notLoaded += e.count;
      continue;
    }
    const typeLine = frontTypeLine(c);
    const group = GROUP_PRIORITY.find((t) => new RegExp(`\\b${t}\\b`).test(typeLine));
    if (group) {
      groupCount.set(group, (groupCount.get(group) ?? 0) + e.count);
      const subs = sub.get(group) ?? new Map<string, number>();
      for (const w of subtypesOf(typeLine)) subs.set(w, (subs.get(w) ?? 0) + e.count);
      sub.set(group, subs);
    }
    for (const t of CARD_TYPES) if (new RegExp(`\\b${t}\\b`).test(typeLine)) s.types[t] += e.count;
    if (isLand(c)) {
      s.lands += e.count;
      for (const col of landColors(c)) s.sources[col] += e.count;
      continue;
    }
    s.curve[Math.min(Math.max(0, Math.floor(c.manaValue)), 7)]! += e.count;
    const bucket = Math.min(Math.max(1, Math.floor(c.manaValue)), 6) - 1;
    (/\bCreature\b/.test(typeLine) ? arena.creature : arena.other)[bucket]! += e.count;
    mvTotal += c.manaValue * e.count;
    spells += e.count;
    const pips = costPips(costOf(c));
    for (const col of COLORS) s.pips[col] += pips[col] * e.count;
  }
  s.curveCreature = arena.creature;
  s.curveOther = arena.other;
  s.spells = spells;
  s.average = spells ? mvTotal / spells : 0;
  s.groups = TYPE_GROUPS.filter((t) => (groupCount.get(t) ?? 0) > 0).map((t) => ({
    type: t,
    count: groupCount.get(t)!,
    subtypes: [...(sub.get(t) ?? new Map<string, number>())].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }));
  return s;
}

/** The subtypes of a type line: the words after the em dash ("Legendary Creature — Elf Druid" -> Elf, Druid). */
export function subtypesOf(typeLine: string): string[] {
  const i = typeLine.indexOf('—');
  return i < 0 ? [] : typeLine.slice(i + 1).trim().split(/\s+/).filter(Boolean);
}
