/**
 * Parser metrics for the coverage CLI (design 6.12). Owner: WP17. Pure functions over `ParseResult`s; no I/O.
 *
 *  - Out-of-sample retention: templates are written while looking at the TUNING half of the corpus (cards whose key hashes even, `halfOfKey`); coverage
 *    is also measured on the HELD-OUT half, and held-out / tuning must be at least 90% at every release gate (a fixed template list that memorizes
 *    sentences scores 73-83%, corpus analysis 9.3). The half is a function of the card's key, so a Scryfall refresh does not move cards between halves.
 *  - Ambiguity list and rate: every unit the chart refused because two readings had different JSON (guard G5), with the readings.
 *  - Residue clustering: the sentences left manual, abstracted to a shape (numbers, mana symbols, types, subtypes, colors and keywords become
 *    placeholders), clustered by shape and ranked by the cards a template for that shape would unlock (cards whose only residue is that shape), then by
 *    the cards it appears on. This is the work queue of `coverage --mine` (design 6.9).
 * `levelOf` defaults to a parse-only level (no capability set): `full` when nothing is manual, `manual` when nothing is automated. The CLI passes the
 * classification of cards/pipeline.ts instead.
 */
import type { AbilityDef } from '../types/ability';
import type { Diagnostic, Lexicon, ParseResult } from './types';
import { GENERATED_LEXICON } from './front/lexicon-index';

export const OWNER = 'WP17' as const;

export type ParseLevel = 'full' | 'partial' | 'manual';

/** One parsed card as the metrics see it. */
export interface CardOutcome {
  oracleId: string;
  name: string;
  result: ParseResult;
}

type Rec = Record<string, unknown>;

/**
 * The manual texts of an ability and whether anything of it runs automatically: a keyword or static ability; a trigger that is detected; a cost that is
 * paid; a target that is announced; a step that is not manual.
 */
function manualTexts(def: AbilityDef): { manual: string[]; automated: boolean } {
  if (def.kind === 'manual') return { manual: [def.text], automated: def.effect !== undefined || def.cost !== undefined };
  const manual: string[] = [];
  let steps = 0;
  let targets = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Rec;
    if (o['op'] === 'manual') { if (typeof o['text'] === 'string') manual.push(o['text']); return; }
    if (typeof o['op'] === 'string') steps++;
    if (Array.isArray(o['targets'])) targets += (o['targets'] as unknown[]).length;
    for (const [k, x] of Object.entries(o)) if (k !== 'text') walk(x);
  };
  walk(def);
  const automated = def.kind === 'keyword' || def.kind === 'static' || def.kind === 'activated' || def.kind === 'triggered' || steps > 0 || targets > 0;
  return { manual, automated };
}

/** The level of a card from its parse alone (no capability set). */
export function parseLevel(result: ParseResult): ParseLevel {
  let manual = 0;
  let automated = 0;
  for (const f of result.faces) for (const a of f.abilities) {
    const m = manualTexts(a);
    manual += m.manual.length;
    if (m.automated) automated++;
  }
  if (manual === 0) return 'full';
  return automated > 0 ? 'partial' : 'manual';
}

/** Design 6.12: the tuning half (templates may be written while looking at it) and the held-out half (never tuned toward). */
export type Half = 'tuning' | 'heldOut';

/**
 * FNV-1a, 32 bits, over the UTF-8 bytes of `s` (Fowler-Noll-Vo; offset basis 2166136261, prime 16777619). Fixed here forever: the retention split of
 * design 6.12 is a function of this hash, so changing it would move cards between the halves.
 */
const utf8 = new TextEncoder();
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const byte of utf8.encode(s)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The half of a card from its key alone (`oracle_id`, else `name:<name>`, as cards/coverage/corpus.ts#oracleKey and snapshot.ts#cardKey): even hash -> tuning,
 * odd hash -> held-out. Design 6.12: the split is a property of the card, not of its position in the index, so a Scryfall refresh that adds or removes cards
 * moves no other card between the halves (until 2026-10-19 the halves alternated by index in `oracle_id` order, and every refresh reshuffled them).
 */
export function halfOfKey(key: string): Half {
  return (fnv1a32(key) & 1) === 0 ? 'tuning' : 'heldOut';
}

/** The tuning half and the held-out half of `outcomes` (each in `oracleId` order), by `halfOfKey` of each card's key, design 6.12. */
export function splitHalves<T extends { oracleId: string }>(outcomes: readonly T[]): { tuning: T[]; heldOut: T[] } {
  const sorted = [...outcomes].sort((a, b) => (a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0));
  return { tuning: sorted.filter((o) => halfOfKey(o.oracleId) === 'tuning'), heldOut: sorted.filter((o) => halfOfKey(o.oracleId) === 'heldOut') };
}

export interface HalfCoverage { cards: number; full: number; partial: number; manual: number; coverage: number }
export interface Retention { tuning: HalfCoverage; heldOut: HalfCoverage; ratio: number; passes: boolean }

/** The release-gate threshold (design 6.12). */
export const RETENTION_GATE = 0.9;

function coverageOf(outcomes: readonly CardOutcome[], levelOf: (o: CardOutcome) => ParseLevel): HalfCoverage {
  const c: HalfCoverage = { cards: outcomes.length, full: 0, partial: 0, manual: 0, coverage: 0 };
  for (const o of outcomes) c[levelOf(o)]++;
  c.coverage = c.cards === 0 ? 0 : c.full / c.cards;
  return c;
}

/**
 * Out-of-sample retention: coverage (share of `full` cards) on the held-out half divided by coverage on the tuning half. With no full card in the tuning
 * half the ratio is 1 when the held-out half has none either (nothing to retain), else the held-out coverage itself exceeds it (ratio capped at 1 is NOT
 * applied: a ratio above 1 is reported as it is).
 */
export function retention(outcomes: readonly CardOutcome[], levelOf: (o: CardOutcome) => ParseLevel = (o) => parseLevel(o.result)): Retention {
  const { tuning, heldOut } = splitHalves(outcomes);
  const t = coverageOf(tuning, levelOf);
  const h = coverageOf(heldOut, levelOf);
  const ratio = t.coverage === 0 ? (h.coverage === 0 ? 1 : Number.POSITIVE_INFINITY) : h.coverage / t.coverage;
  return { tuning: t, heldOut: h, ratio, passes: ratio >= RETENTION_GATE };
}

export interface AmbiguityEntry { oracleId: string; name: string; face: number; message: string; range?: [number, number]; alternatives: unknown[] }

/** Every ambiguous unit (guard G5) with its readings. */
export function ambiguityList(outcomes: readonly CardOutcome[]): AmbiguityEntry[] {
  const out: AmbiguityEntry[] = [];
  for (const o of outcomes) o.result.faces.forEach((f, face) => {
    for (const d of f.diagnostics) if (d.code === 'ambiguous') out.push({ oracleId: o.oracleId, name: o.name, face, message: d.message, ...(d.range ? { range: d.range } : {}), alternatives: d.alternatives ?? [] });
  });
  return out;
}

/** Ambiguous units per unit the chart decided (ok, manual for any reason, ambiguous). Units are counted from the diagnostics and the ledger. */
export function ambiguityRate(outcomes: readonly CardOutcome[]): number {
  let ambiguous = 0;
  let units = 0;
  for (const o of outcomes) for (const f of o.result.faces) {
    ambiguous += f.diagnostics.filter((d: Diagnostic) => d.code === 'ambiguous').length;
    units += f.ledger.filter((e) => e.status === 'consumed' || e.status === 'manual').length;
  }
  return units === 0 ? 0 : ambiguous / units;
}

// ---------------------------------------------------------------------------
// residue
// ---------------------------------------------------------------------------

/** The sentences of a card that are manual (the residue), in text order. */
export function residueOf(result: ParseResult): string[] {
  const out: string[] = [];
  for (const f of result.faces) for (const a of f.abilities) {
    for (const t of manualTexts(a).manual) out.push(...t.split(/(?<=\.)\s+(?=\S)/).map((s) => s.trim()).filter((s) => s !== ''));
  }
  return out;
}

interface ShapeVocab { words: Map<string, string> }
const vocabs = new WeakMap<Lexicon, ShapeVocab>();

function shapeVocab(lex: Lexicon): ShapeVocab {
  let v = vocabs.get(lex);
  if (v) return v;
  const words = new Map<string, string>();
  const add = (w: string, tag: string): void => { const k = w.toLowerCase(); if (!words.has(k)) words.set(k, tag); };
  for (const t of lex.cardTypes) { add(t, '<type>'); add(`${t}s`, '<types>'); }
  for (const s of lex.subtypes) { add(s.singular, '<subtype>'); add(s.plural, '<subtypes>'); }
  for (const c of lex.colors) add(c.word, '<color>');
  for (const k of lex.keywordAbilities) if (!k.name.includes(' ')) add(k.name, '<keyword>');
  v = { words };
  vocabs.set(lex, v);
  return v;
}

const NUMBER_WORDS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);

/** The abstract shape of a sentence: numbers, mana symbols, P/T, types, subtypes, colors and one-word keywords become placeholders; case folded. */
export function abstractShape(sentence: string, lexicon: Lexicon = GENERATED_LEXICON): string {
  const v = shapeVocab(lexicon);
  return sentence
    .replace(/(\{[^}]+\})+/g, ' {M} ')
    .replace(/[+-]?(?:\d+|X|\*)\/[+-]?(?:\d+|X|\*)/g, ' <pt> ')
    .split(/(\s+|[.,:;"()])/)
    .map((w) => {
      if (w === '{M}' || w === '<pt>') return w;
      const k = w.toLowerCase();
      if (/^\d+$/.test(k) || NUMBER_WORDS.has(k)) return 'N';
      return v.words.get(k) ?? k;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:;])/g, '$1')
    .trim();
}

export interface ResidueCluster {
  shape: string;
  /** Cards on which the shape appears. */
  cards: number;
  /** Cards whose ONLY residue shape is this one: a template for it would make them fully parsed. */
  unlocks: number;
  /** Up to `examples` card names (in oracle_id order). */
  examples: string[];
}

/** Residue clusters ranked by cards unlocked, then by cards, then by shape (deterministic). */
export function residueClusters(outcomes: readonly CardOutcome[], opts: { lexicon?: Lexicon; examples?: number; top?: number } = {}): ResidueCluster[] {
  const lex = opts.lexicon ?? GENERATED_LEXICON;
  const byShape = new Map<string, { cards: Set<string>; unlocks: number; names: string[] }>();
  const sorted = [...outcomes].sort((a, b) => (a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0));
  for (const o of sorted) {
    const shapes = [...new Set(residueOf(o.result).map((s) => abstractShape(s, lex)))];
    for (const s of shapes) {
      const c = byShape.get(s) ?? { cards: new Set<string>(), unlocks: 0, names: [] };
      if (!c.cards.has(o.oracleId)) { c.cards.add(o.oracleId); if (c.names.length < (opts.examples ?? 3)) c.names.push(o.name); }
      if (shapes.length === 1) c.unlocks++;
      byShape.set(s, c);
    }
  }
  const out = [...byShape].map(([shape, c]) => ({ shape, cards: c.cards.size, unlocks: c.unlocks, examples: c.names }));
  out.sort((a, b) => b.unlocks - a.unlocks || b.cards - a.cards || (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0));
  return opts.top !== undefined ? out.slice(0, opts.top) : out;
}
