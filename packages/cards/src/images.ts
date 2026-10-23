/**
 * Name resolution for card images (design 12.2, docs/ARCHITECTURE.md "Card images"): which image slot(s) a name given with an uploaded image binds to.
 * Real cards resolve by full or face name; tokens by name and variant ("Spirit (1/1 W Creature — Spirit; Flying)"); Art Series names, which are not in
 * the index, resolve to the real cards they depict. Images never affect rules automation (contract C3). Pure: no I/O.
 */
import {
  artSeriesNames, compileCard, imageSlots, noAbilityCompiler, oracleTokenVariantKeys, tokenBaseName, type CardDef, type FaceDef, type ImageSlot, type OracleCard,
} from '@openmtg/engine';
import { normalizeName } from './normalize';

/** What image matching needs from the card database (CardDatabase satisfies it). */
export interface ImageLookup {
  lookup(name: string): OracleCard | undefined;
  lookupTokens(name: string): OracleCard[];
}

export interface ImageMatch {
  /** The slot key the image is stored under. */
  key: string;
  label: string;
  /** Oracle name of the card or token the slot belongs to. */
  card: string;
  /** How the name was understood: a card name or face name, a token name (or token slot key), or an Art Series name. */
  via: 'card' | 'token' | 'artSeries';
}

/**
 * A definition with only what image slots read (layout, names, token look, meld parts), for a card the engine cannot compile (a mana symbol it does not
 * know, such as {D} or {C/P} in 2026): images never depend on rules (contract C3), so such a card still gets its slots.
 */
function lookOnlyDef(card: OracleCard): CardDef {
  const faces = (card.card_faces && card.card_faces.length > 0 ? card.card_faces : [card]).map((f) => ({
    name: f.name, manaCost: null, typeLine: f.type_line ?? '', supertypes: [], types: [], subtypes: [], oracleText: f.oracle_text ?? '', colors: [...(f.colors ?? card.colors ?? [])] as FaceDef['colors'], keywords: [],
    abilities: [], ...(f.power !== undefined ? { power: f.power } : {}), ...(f.toughness !== undefined ? { toughness: f.toughness } : {}),
  }));
  const parts = card.all_parts ?? [];
  const result = parts.find((p) => p.component === 'meld_result')?.name;
  const isToken = ['token', 'double_faced_token', 'emblem'].includes(card.layout) || /\bToken\b/.test(card.type_line ?? '');
  return {
    id: card.name, name: card.name, layout: card.layout, faces, isToken, automation: { level: 'manual', unsupported: [], source: 'none' },
    ...(card.layout === 'meld' ? { meld: result === card.name ? { isResult: true } : { isResult: false, ...(result ? { result } : {}) } } : {}),
  };
}

/** The image slots of an index card. Abilities play no part in images, so nothing is parsed; never throws. */
export function slotsOfCard(card: OracleCard): ImageSlot[] {
  let def: CardDef;
  try {
    def = compileCard(card, noAbilityCompiler);
  } catch {
    def = lookOnlyDef(card);
  }
  return imageSlots(def);
}

const same = (a: string, b: string): boolean => normalizeName(a) === normalizeName(b);
const match = (s: ImageSlot, card: string, via: ImageMatch['via']): ImageMatch => ({ key: s.key, label: s.label, card, via });

function cardMatches(db: ImageLookup, name: string, via: ImageMatch['via']): ImageMatch[] {
  const card = db.lookup(name);
  if (!card) return [];
  const slots = slotsOfCard(card);
  const named = slots.filter((s) => s.names.some((n) => same(n, name)));
  return (named.length > 0 ? named : slots.slice(0, 1)).map((s) => match(s, card.name, via));
}

/** "Spirit (1/1 W Creature — Spirit; Flying)" -> "Spirit"; "Treasure Token" -> "Treasure". */
const tokenNameOf = (name: string): string => tokenBaseName(/^(.*?)\s*\(.*\)$/.exec(name.trim())?.[1] ?? name);

function tokenMatches(db: ImageLookup, name: string): ImageMatch[] {
  const variants = db.lookupTokens(tokenNameOf(name));
  const out: ImageMatch[] = [];
  for (const card of variants) for (const s of slotsOfCard(card)) out.push(match(s, card.name, 'token'));
  const exact = out.filter((m) => m.key === name.trim());
  return exact.length > 0 ? exact : out;
}

/**
 * The image slots a name resolves to, best first; empty when nothing in the index has that name (the client may then offer a stub card, whose one slot
 * is the name as given, `stubCardDef(name, 'image')`). Several matches mean the player chooses (a token name with several variants, a name that is both a
 * card and a token, an Art Series card showing two different cards).
 */
export function matchImageName(db: ImageLookup, name: string): ImageMatch[] {
  const wanted = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (wanted === '') return [];
  const direct = [...cardMatches(db, wanted, 'card'), ...tokenMatches(db, wanted)];
  if (direct.length > 0) return direct;
  // An Art Series card shows real cards or tokens ("Map // Map", "Spider // Spider"): both are looked up by the depicted names.
  const depicted = artSeriesNames(wanted).filter((n) => !same(n, wanted));
  const seen = new Set<string>();
  return depicted
    .flatMap((n) => [...cardMatches(db, n, 'artSeries'), ...tokenMatches(db, n).map((m) => ({ ...m, via: 'artSeries' as const }))])
    .filter((m) => !seen.has(m.key) && seen.add(m.key) !== undefined);
}

/**
 * Token variant lookup: the variants in the local index (tokens.jsonl) of the token a definition describes, matched by slot key (name, P/T, colors, type
 * line, text). Empty when the index has no such variant (an inline token no printed token shows): its image is then bound by key alone.
 */
export function tokenVariantsFor(db: ImageLookup, def: CardDef): OracleCard[] {
  if (!def.isToken) return [];
  const want = new Set(imageSlots(def).map((s) => s.key));
  // By the token's name, then by each face name (a side of a double-faced token, a Role printed on one half of a flip-layout card).
  const names = [...new Set([def.name, ...def.faces.map((f) => f.name)].map(tokenBaseName))];
  const found = new Set<OracleCard>();
  for (const n of names) for (const t of db.lookupTokens(n)) if (oracleTokenVariantKeys(t).some((k) => want.has(k))) found.add(t);
  return [...found];
}
