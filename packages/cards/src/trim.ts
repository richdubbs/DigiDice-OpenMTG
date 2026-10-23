/**
 * Trim Scryfall card objects to the rules fields OpenMTG needs (OracleCard).
 * Image URLs: only Scryfall's normal/large image_uris, for the client's opt-in setting that
 * hot-links card images from Scryfall (never downloaded or redistributed by OpenMTG; never in
 * fixtures), with the artist of that picture, so it is credited wherever it is shown. No prices, no flavor text or set info
 * (apart from set_type and border_color, used only to filter out-of-scope cards).
 * Game cards keep Scryfall's per-format `legalities` (format validation, docs/design/decks-and-formats.md; WP24) and, when the rules do not cover them
 * (CR 100.7: silver border, acorn stamp, playtest card), the `unsanctioned` flag (design 12.3); tokens keep neither.
 */
import type { OracleCard, OracleFace, OracleRelatedPart } from '@openmtg/engine';
import { trimLegalities, type IndexedCard } from './legalities';
import { normalizeName } from './normalize';

export type RawCard = Record<string, unknown>;

/** What a bulk-file object is for. */
export type CardScope = 'card' | 'token' | 'art_series' | 'front_card' | 'funny';

const TOKEN_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem']);

export function isTokenLayout(layout: string | undefined): boolean {
  return layout !== undefined && TOKEN_LAYOUTS.has(layout);
}

/**
 * Art Series, "front_card" (deck-type indicator cards: not game objects, and some share a name with a
 * real card) and silver-border / acorn-stamped cards are out of scope. Tokens and emblems go to the token
 * index. A token is recognised by layout, by set_type "token" (this also catches flip-layout Role
 * tokens, Poison Counter, Experience, the Dungeon cards and other non-deck objects) or by a "Token"
 * type line, whatever the layout. Dungeons are not tokens but are never put in a deck, so they live
 * in the token/non-deck index too.
 *
 * Only silver-border and acorn-stamped cards count as "funny": black-bordered Unfinity-type cards that
 * are legal in real formats stay in. This must look at the raw object (trimCard drops security_stamp).
 */
export function classifyCard(raw: RawCard): CardScope {
  if (raw.layout === 'art_series') return 'art_series';
  if (raw.layout === 'front_card') return 'front_card';
  if (raw.set_type === 'token' || isTokenLayout(str(raw.layout)) || /\bToken\b/.test(str(raw.type_line) ?? '')) return 'token';
  if (raw.border_color === 'silver' || raw.security_stamp === 'acorn') return 'funny';
  return 'card';
}

/**
 * CR 100.7: a card the Comprehensive Rules do not cover (casual play only): a silver-border or acorn-stamped card, or a Mystery Booster / Unknown Event
 * playtest card (Scryfall promo_types "playtest": black-, white- or gold-bordered, not legal in any format). Such a card is flagged `unsanctioned` and
 * compiles manual-only (design 12.3). Silver-border and acorn cards stay out of the default index (`classifyCard` "funny"); playtest cards were always in it
 * and stay, flagged. Must look at the raw object (trimCard keeps neither security_stamp nor promo_types).
 */
export function isCasualOnly(raw: RawCard): boolean {
  return raw.border_color === 'silver' || raw.security_stamp === 'acorn' || (Array.isArray(raw.promo_types) && raw.promo_types.includes('playtest'));
}

/**
 * Objects that are never game cards a player can put in a deck: tokens, emblems, Art Series and
 * deck-type indicators. Used to refuse such objects when Scryfall returns them for a name lookup.
 */
export function isNonGameObject(raw: RawCard): boolean {
  const scope = classifyCard(raw);
  return scope === 'token' || scope === 'art_series' || scope === 'front_card';
}

/** Keep only the normal and large Scryfall image URLs (https, Scryfall's own image host). */
function displayImages(v: unknown): { normal?: string; large?: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const ok = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.scryfall\.io\//.test(u);
  const out: { normal?: string; large?: string } = {};
  if (ok(o.normal)) out.normal = o.normal;
  if (ok(o.large)) out.large = o.large;
  return out.normal || out.large ? out : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function strArr(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}
function asObj(v: unknown): RawCard | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as RawCard) : undefined;
}

/** Assign defined values in the given order (stable JSON key order). */
function build<T extends object>(entries: Array<[string, unknown]>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) if (v !== undefined) out[k] = v;
  return out as T;
}

function trimFace(raw: RawCard): OracleFace {
  return build<OracleFace>([
    ['name', str(raw.name) ?? ''],
    ['mana_cost', str(raw.mana_cost)],
    ['type_line', str(raw.type_line)],
    ['oracle_text', str(raw.oracle_text)],
    ['power', str(raw.power)],
    ['toughness', str(raw.toughness)],
    ['loyalty', str(raw.loyalty)],
    ['defense', str(raw.defense)],
    ['colors', strArr(raw.colors)],
    ['color_indicator', strArr(raw.color_indicator)],
    ['image_uris', displayImages(raw.image_uris)],
    ['artist', str(raw.artist)],
  ]);
}

function trimParts(v: unknown, withTypeLine: boolean): OracleRelatedPart[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const parts: OracleRelatedPart[] = [];
  for (const p of v) {
    const o = asObj(p);
    const component = str(o?.component);
    const name = str(o?.name);
    if (!o || !component || !name) continue;
    parts.push(build<OracleRelatedPart>([['component', component], ['name', name], ['type_line', withTypeLine ? str(o.type_line) : undefined]]));
  }
  return parts.length ? parts : undefined;
}

/**
 * Raw Scryfall object -> OracleCard. Tokens keep only the compact all_parts (component, name),
 * which records which cards create them; all other cards keep component/name/type_line, their
 * legalities and, for a card the rules do not cover (CR 100.7, `isCasualOnly`), `unsanctioned: true` (a silver-border or acorn card only reaches the index
 * with --include-unsanctioned, or through a one-off name lookup; a playtest card is in the default index).
 */
export function trimCard(raw: RawCard, kind: 'card' | 'token' = 'card'): IndexedCard {
  const facesRaw = Array.isArray(raw.card_faces) ? raw.card_faces.map(asObj).filter((f): f is RawCard => f !== undefined) : [];
  const faces = facesRaw.map(trimFace);
  // Reversible cards carry oracle_id and cmc on their faces only.
  const oracleId = str(raw.oracle_id) ?? str(facesRaw[0]?.oracle_id);
  const card = kind === 'card';
  return build<IndexedCard>([
    ['oracle_id', oracleId],
    ['name', str(raw.name) ?? ''],
    ['layout', str(raw.layout) ?? 'normal'],
    ['mana_cost', str(raw.mana_cost)],
    ['cmc', num(raw.cmc) ?? num(facesRaw[0]?.cmc)],
    ['type_line', str(raw.type_line)],
    ['oracle_text', str(raw.oracle_text)],
    ['power', str(raw.power)],
    ['toughness', str(raw.toughness)],
    ['loyalty', str(raw.loyalty)],
    ['defense', str(raw.defense)],
    ['colors', strArr(raw.colors)],
    ['color_indicator', strArr(raw.color_indicator)],
    ['color_identity', strArr(raw.color_identity)],
    ['keywords', strArr(raw.keywords)],
    ['produced_mana', strArr(raw.produced_mana)],
    ['card_faces', faces.length ? faces : undefined],
    ['all_parts', trimParts(raw.all_parts, card)],
    ['set_type', str(raw.set_type)],
    ['border_color', str(raw.border_color)],
    ['legalities', card ? trimLegalities(raw.legalities) : undefined],
    ['unsanctioned', card && isCasualOnly(raw) ? true : undefined],
    ['image_uris', displayImages(raw.image_uris)],
    ['artist', str(raw.artist)],
  ]);
}

function fixtureParts(card: OracleCard, isToken: boolean, creatorNames?: ReadonlySet<string>): OracleRelatedPart[] | undefined {
  if (!isToken) return card.all_parts?.map((p) => build<OracleRelatedPart>([['component', p.component], ['name', p.name], ['type_line', p.type_line]]));
  if (!creatorNames) return undefined;
  const parts = (card.all_parts ?? []).filter((p) => creatorNames.has(normalizeName(p.name))).map((p) => build<OracleRelatedPart>([['component', p.component], ['name', p.name]]));
  return parts.length ? parts : undefined;
}

function minimalFace(f: OracleFace): OracleFace {
  const { image_uris: _images, artist: _artist, layout: _layout, ...rest } = f;
  return rest;
}

/**
 * Stored OracleCard -> minimal test-fixture card: Oracle rules fields only. No images or artists, no set
 * info. M11-4 (m11 design D5): the color identity is kept (CR 903.4: the compiler copies it into
 * CardDef.colorIdentity for Commander games). For tokens (`isToken`) all_parts keeps only (component, name) of the
 * parts whose normalized name is in `creatorNames` (the fixture cards that create them), so a test can
 * tell which token variant a card makes; with no `creatorNames` a token keeps no all_parts.
 */
export function toFixtureCard(card: OracleCard, isToken = false, creatorNames?: ReadonlySet<string>): OracleCard {
  return build<OracleCard>([
    ['oracle_id', card.oracle_id],
    ['name', card.name],
    ['layout', card.layout],
    ['mana_cost', card.mana_cost],
    ['cmc', card.cmc],
    ['type_line', card.type_line],
    ['oracle_text', card.oracle_text],
    ['power', card.power],
    ['toughness', card.toughness],
    ['loyalty', card.loyalty],
    ['defense', card.defense],
    ['colors', card.colors],
    ['color_indicator', card.color_indicator],
    ['color_identity', card.color_identity],
    ['keywords', card.keywords],
    ['produced_mana', card.produced_mana],
    ['card_faces', card.card_faces?.map(minimalFace)],
    ['all_parts', fixtureParts(card, isToken, creatorNames)],
  ]);
}
