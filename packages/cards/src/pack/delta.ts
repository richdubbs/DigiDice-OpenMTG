/**
 * What an update changes (updates.md step 3, design 12.5): new cards known, cards newly automated, cards still manual, and cards needing a newer
 * OpenMTG. Pure: the CLI hands in the card lists and the compile sources before and after.
 *
 * Both comparisons compile cards, up to the whole pool (a first card download makes every card new; changed pack templates reach every card), which
 * takes a minute or more. So each is a generator with one step per compiled card: `coverageDelta` and `packApplicability` run the steps at once (the
 * CLI, build-pack), and `runSliced` runs them in time slices, pausing between slices (the local server's Update button: its event loop also serves the
 * API, the client's progress polling and online play).
 */
import { ABILITY_MODEL_VERSION, ENGINE_CAPABILITIES, compileCardDetailed, type AutomationLevel, type CompileSources, type OracleCard, type CapabilitySet } from '@openmtg/engine';
import { checkPackEntry } from './check';
import type { ValidatedPack } from './format';

const RANK: Readonly<Record<AutomationLevel, number>> = { manual: 0, partial: 1, full: 2 };

export interface LevelCounts { full: number; partial: number; manual: number }

export interface CoverageDelta {
  cards: number;
  before: LevelCounts;
  after: LevelCounts;
  /** Cards whose level went up / down, with the levels. */
  up: { name: string; from: AutomationLevel; to: AutomationLevel }[];
  down: { name: string; from: AutomationLevel; to: AutomationLevel }[];
}

const zero = (): LevelCounts => ({ full: 0, partial: 0, manual: 0 });

/** Steps of a comparison: one per compiled card, the result at the end. */
export type Steps<T> = Generator<void, T, void>;

/** Run every step at once. */
export function runAll<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** How a long comparison shares its thread: steps run for about `ms` milliseconds, then `pause()` (the server: one turn of the event loop). */
export interface TimeSlice {
  ms: number;
  pause: () => Promise<void>;
}

/** Run the steps in time slices; `onStep` after each step (progress). */
export async function runSliced<T>(steps: Steps<T>, slice: TimeSlice, onStep: () => void = () => {}): Promise<T> {
  let start = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    onStep();
    if (performance.now() - start >= slice.ms) {
      await slice.pause();
      start = performance.now();
    }
  }
}

/**
 * Compile each card with both sources and compare levels, one step per card. Only cards a pack or cache entry touches can differ, so callers pass just
 * those, unless the pack templates change: templates reach every card's parse, so then callers pass every card. `sameSources(card)` true: the two
 * sources compile this card alike (no pack entry for it either side, the same templates), so it is compiled once and its level counts for both.
 */
export function* coverageDeltaSteps(cards: readonly OracleCard[], before: CompileSources, after: CompileSources, sameSources?: (card: OracleCard) => boolean): Steps<CoverageDelta> {
  const out: CoverageDelta = { cards: cards.length, before: zero(), after: zero(), up: [], down: [] };
  for (const c of cards) {
    const a = compileCardDetailed(c, before).def.automation.level;
    const b = sameSources?.(c) ? a : compileCardDetailed(c, after).def.automation.level;
    out.before[a]++;
    out.after[b]++;
    if (RANK[b] > RANK[a]) out.up.push({ name: c.name, from: a, to: b });
    if (RANK[b] < RANK[a]) out.down.push({ name: c.name, from: a, to: b });
    yield;
  }
  return out;
}

/** `coverageDeltaSteps`, all at once. */
export function coverageDelta(cards: readonly OracleCard[], before: CompileSources, after: CompileSources, sameSources?: (card: OracleCard) => boolean): CoverageDelta {
  return runAll(coverageDeltaSteps(cards, before, after, sameSources));
}

export interface PackApplicability {
  /** Pack entries for cards in the local index whose text matches and that pass the gates on the player's own text (they drive play). */
  matching: number;
  /** Entries for the player's text that the render gate, lint, coverage or card-text check refuses (design 12.5): reported, never used. */
  rejected: { name: string; reason: string }[];
  /** Entries whose card is in the index with another text (errata since the pack was made): not used, the card falls back to the parser. */
  textChanged: string[];
  /** Entries for oracle ids the local index does not know (refresh the card data). */
  unknown: number;
  /** Cards of the local index that need engine features this build lacks, with the missing capabilities. */
  needsNewer: { name: string; missing: string[] }[];
}

/**
 * How the pack's entries meet the player's data: each entry with a known card is compiled on the player's own text (`base`: the player's sources,
 * pack templates included) and judged by pack/check.ts. A card needs a newer OpenMTG when the pack's `requiresEngine` names a capability this build
 * lacks, or its entry is for a newer ability model. One step per pack entry.
 */
export function* packApplicabilitySteps(v: ValidatedPack, byId: ReadonlyMap<string, OracleCard>, base: CompileSources, caps: CapabilitySet = ENGINE_CAPABILITIES): Steps<PackApplicability> {
  const out: PackApplicability = { matching: 0, rejected: [], textChanged: [], unknown: 0, needsNewer: [] };
  for (const [id, e] of v.entries) {
    const c = byId.get(id);
    if (!c) {
      out.unknown++;
      continue;
    }
    const check = checkPackEntry(c, e, base);
    if (check.status === 'apply') out.matching++;
    else if (check.status === 'textChanged') out.textChanged.push(c.name);
    else if (check.status === 'rejected') out.rejected.push({ name: c.name, reason: check.reason });
    yield;
  }
  const ids = new Set([...Object.keys(v.pack.requiresEngine), ...[...v.entries.values()].filter((e) => e.modelVersion > ABILITY_MODEL_VERSION).map((e) => e.oracleId)]);
  for (const id of [...ids].sort()) {
    const c = byId.get(id);
    if (!c) continue;
    const missing = new Set((v.pack.requiresEngine[id] ?? []).filter((cap) => !caps.has(cap)));
    const e = v.entries.get(id);
    if (e && e.modelVersion > ABILITY_MODEL_VERSION) missing.add(`model:${e.modelVersion}`);
    if (missing.size > 0) out.needsNewer.push({ name: c.name, missing: [...missing] });
  }
  out.textChanged.sort();
  out.rejected.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/** `packApplicabilitySteps`, all at once. */
export function packApplicability(v: ValidatedPack, byId: ReadonlyMap<string, OracleCard>, base: CompileSources, caps: CapabilitySet = ENGINE_CAPABILITIES): PackApplicability {
  return runAll(packApplicabilitySteps(v, byId, base, caps));
}
