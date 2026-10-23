/**
 * Which parts of which cards go to the model (design 11.1). Pure.
 *
 * The unit is the FACE: the parser's accepted abilities are context, and only the units (abilities with the same `src` lines) the parser left manual are
 * requested. A unit is requestable when every ability of it is manual (or only its costs and targets were understood) for a reason other than a missing
 * engine capability: a node the parser understood but this build cannot run is "unavailable" (design 10.1), and an overlay could never replace it
 * (cards/pipeline.ts#overlayFace). Cards whose whole structure the engine lacks (layout caps, Alchemy, Rooms, unsanctioned cards) are not selected.
 */
import { LAYOUT_CAPS, compileCardDetailed, type AbilityDef, type CardDef, type CompileReport, type CompileSources, type OracleCard } from '@openmtg/engine';
import { lineDiagnostics } from './diagnostics';

export interface UnitWork {
  /** The unit's `src` lines. */
  src: number[];
  /** Why the parser left it manual (the manual nodes' reasons). */
  reasons: string[];
  /** The parser's own diagnostics for the unit's lines, with its "stuck at ... expected ..." (design 11.2; llm/diagnostics.ts). */
  diagnostics?: string[];
}

export interface FaceWork {
  face: number;
  units: UnitWork[];
}

export interface CardWork {
  card: OracleCard;
  /** The parser-only compile (no LLM data): the baseline the overlay is judged against. */
  def: CardDef;
  report: CompileReport;
  faces: FaceWork[];
}

const srcKey = (a: AbilityDef): string => (Array.isArray(a.src) ? a.src.join(',') : '');

/** Is the whole card outside what the engine implements (design 12.3, 12.4, 10.6, CR 709.5)? */
export function cardCapped(card: OracleCard): string | null {
  if (LAYOUT_CAPS[card.layout] !== undefined) return LAYOUT_CAPS[card.layout]!;
  if (card.set_type === 'alchemy') return 'Alchemy (digital-only)';
  if (card.unsanctioned === true) return 'unsanctioned (CR 100.7)';
  if (card.layout === 'split' && /\bRoom\b/.test(card.type_line ?? '')) return 'Room';
  return null;
}

const ENGINE_REASON = /^needs-engine\b/;

/** The units of a compiled face the parser left manual (requestable from the model), in order of first appearance. */
export function manualUnits(def: CardDef, face: number): UnitWork[] {
  const f = def.faces[face];
  const auto = def.automation.faces?.[face];
  if (!f) return [];
  const groups = new Map<string, number[]>();
  f.abilities.forEach((a, i) => {
    const k = srcKey(a);
    if (k !== '') groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const out: UnitWork[] = [];
  for (const [key, idx] of groups) {
    const reasons: string[] = [];
    let requestable = true;
    for (const i of idx) {
      const a = f.abilities[i]!;
      const level = auto?.abilities[i]?.level ?? (a.kind === 'manual' ? 'manual' : 'full');
      if (level !== 'manual') {
        requestable = false;
        break;
      }
      const rs = a.kind === 'manual' ? [a.reason] : (auto?.abilities[i]?.manual ?? []).map((m) => m.reason);
      if (rs.length > 0 && rs.every((r) => ENGINE_REASON.test(r))) {
        requestable = false;
        break;
      }
      reasons.push(...rs);
    }
    if (requestable) out.push({ src: key.split(',').map(Number), reasons: [...new Set(reasons)] });
  }
  return out;
}

/** The work for one card under the parser's sources, or null when there is nothing to request. */
export function cardWork(card: OracleCard, sources: CompileSources): CardWork | null {
  if (cardCapped(card) !== null || typeof card.oracle_id !== 'string') return null;
  const { def, report } = compileCardDetailed(card, { ...sources, llm: undefined });
  if (def.automation.level === 'full') return null;
  const faces: FaceWork[] = [];
  def.faces.forEach((_, i) => {
    const units = manualUnits(def, i);
    if (units.length > 0) faces.push({ face: i, units });
  });
  if (faces.length === 0) return null;
  const diags = lineDiagnostics(card, sources.parse);
  for (const f of faces) {
    for (const u of f.units) u.diagnostics = [...new Set(u.src.flatMap((l) => diags.get(f.face)?.get(l) ?? []))];
  }
  return { card, def, report, faces };
}

export interface SelectOptions {
  only?: 'partial' | 'manual';
  limit?: number;
  oracleIds?: ReadonlySet<string>;
  /** Oracle names from the owner's decks: selected first (design 11.1, "cards in the owner's decks first"). */
  priority?: ReadonlySet<string>;
}

/** Order: priority names first, then oracle_id order (deterministic). */
export function orderCards(cards: readonly OracleCard[], priority: ReadonlySet<string> = new Set()): OracleCard[] {
  const key = (c: OracleCard): string => c.oracle_id ?? `~${c.name}`;
  return [...cards].sort((a, b) => {
    const pa = priority.has(a.name) ? 0 : 1;
    const pb = priority.has(b.name) ? 0 : 1;
    return pa - pb || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  });
}

/** Select the cards to send, compiling lazily until `limit` cards with work are found. */
export function selectWork(cards: readonly OracleCard[], sources: CompileSources, opts: SelectOptions = {}, skip: (card: OracleCard, work: CardWork) => boolean = () => false): CardWork[] {
  const out: CardWork[] = [];
  for (const card of orderCards(cards, opts.priority)) {
    if (opts.limit !== undefined && out.length >= opts.limit) break;
    if (opts.oracleIds && !opts.oracleIds.has(card.oracle_id ?? '')) continue;
    const w = cardWork(card, sources);
    if (w === null) continue;
    if (opts.only !== undefined && w.def.automation.level !== opts.only) continue;
    if (skip(card, w)) continue;
    out.push(w);
  }
  return out;
}
