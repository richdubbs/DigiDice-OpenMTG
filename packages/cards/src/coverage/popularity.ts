/**
 * Coverage by format and by popularity (package COV1): `coverage --by-format` and `unmatched --weight played`.
 *
 * - Formats: a card counts in a format when the index's Scryfall `legalities` say `legal` or `restricted` there (legalities.ts; a card with no
 *   legalities, such as a fixture card, is in no format row). Formats: Standard, Pioneer, Modern, Pauper, Legacy, Commander.
 * - Popularity: Scryfall's `edhrec_rank`, read at report time from the cached bulk file (`.cache/scryfall/oracle-cards.jsonl.gz`). The shared index is
 *   never changed or rebuilt for it (it does not keep `edhrec_rank`). "EDHREC top N" is the first N oracle ids of the bulk file in rank order, then the
 *   cards of the measured corpus among them (a top-N row can count fewer than N cards when some ranked cards are not in the corpus).
 * - Played weight (`unmatched --weight played`): a card weighs PLAYED_WEIGHTS.standard (3) if it is Standard-legal, else PLAYED_WEIGHTS.edhrecTop (2) if it
 *   is in the EDHREC top PLAYED_EDHREC_TOP (2,500), else PLAYED_WEIGHTS.other (1). The first rule that applies wins (weights do not add up). A shape is
 *   ranked by the summed weight of the cards a template for it would unlock (the cards whose only manual shape it is), then by the summed weight of
 *   every card it appears on.
 *
 * Read-only tooling: nothing here changes how a card compiles or plays.
 */
import { existsSync } from 'node:fs';
import { abstractShape, residueOf, type AutomationLevel, type OracleCard } from '@openmtg/engine';
import { bulkLines, parseBulkLine } from '../index-store';
import { legalityIn } from '../legalities';
import { cacheFiles, defaultCacheDir } from '../paths';
import { oracleKey, tuningHalf, type Halves } from './corpus';
import type { CardRun } from './engine';

/** The formats of the by-format report, as Scryfall spells them. */
export const REPORT_FORMATS = ['standard', 'pioneer', 'modern', 'pauper', 'legacy', 'commander'] as const;
/** The EDHREC top-N rows of the by-format report. */
export const EDHREC_TOPS = [100, 500, 1000, 2500, 5000, 10000] as const;

/** Weights of `unmatched --weight played` (see the module comment): the first rule that applies wins. */
export const PLAYED_WEIGHTS = { standard: 3, edhrecTop: 2, other: 1 } as const;
/** A card in the EDHREC top this many weighs PLAYED_WEIGHTS.edhrecTop (unless it is Standard-legal). */
export const PLAYED_EDHREC_TOP = 2500;

/** Oracle id -> EDHREC rank (1 = most played). */
export type EdhrecRanks = ReadonlyMap<string, number>;

/** The default bulk file: the cached Scryfall Oracle bulk download (the same file the index is built from). */
export function defaultBulkFile(): string {
  return cacheFiles(defaultCacheDir()).bulkJsonlGz;
}

/**
 * Read `edhrec_rank` per oracle id from a Scryfall bulk file (`.jsonl.gz`, or a plain `.json`/`.jsonl` file). Lines that do not parse and cards with no
 * rank are skipped; an oracle id listed twice keeps its best rank.
 */
export async function readEdhrecRanks(file: string): Promise<Map<string, number>> {
  const format = /\.gz$/i.test(file) ? 'jsonl.gz' : 'json';
  const ranks = new Map<string, number>();
  for await (const line of bulkLines(file, format)) {
    const raw = parseBulkLine(line, format);
    if (raw === null || raw === 'error') continue;
    const id = (raw as { oracle_id?: unknown }).oracle_id;
    const rank = (raw as { edhrec_rank?: unknown }).edhrec_rank;
    if (typeof id !== 'string' || typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) continue;
    const prev = ranks.get(id);
    if (prev === undefined || rank < prev) ranks.set(id, rank);
  }
  return ranks;
}

/** The ranks of a bulk file, or null (with the reason) when the file is missing or unreadable: the report then leaves the EDHREC rows out. */
export async function loadEdhrecRanks(file: string): Promise<{ ranks: Map<string, number> | null; problem?: string }> {
  if (!existsSync(file)) return { ranks: null, problem: `no bulk file at ${file} (npm run cards -- refresh; from a worktree set OPENMTG_CACHE_DIR)` };
  try {
    return { ranks: await readEdhrecRanks(file) };
  } catch (e) {
    return { ranks: null, problem: `cannot read ${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The oracle ids in rank order (best first; ties by oracle id, so the order is deterministic). */
export function rankedIds(ranks: EdhrecRanks): string[] {
  return [...ranks].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id]) => id);
}

/** Is the card legal (or restricted) in the format, by the index's legalities? */
export function inFormat(card: OracleCard, format: string): boolean {
  const l = legalityIn(card, format);
  return l === 'legal' || l === 'restricted';
}

export interface LevelTally { label: string; cards: number; full: number; partial: number; manual: number }

export function tally(label: string, runs: Iterable<Pick<CardRun, 'level'>>): LevelTally {
  const t: LevelTally = { label, cards: 0, full: 0, partial: 0, manual: 0 };
  for (const r of runs) {
    t[r.level as AutomationLevel]++;
    t.cards++;
  }
  return t;
}

export interface FormatBreakdown {
  whole: LevelTally;
  formats: LevelTally[];
  /** Null when no ranks were available (no bulk file). */
  edhrec: LevelTally[] | null;
}

/** The levels of the corpus, per format (legal or restricted) and per EDHREC top N. */
export function formatBreakdown(runs: readonly CardRun[], ranks: EdhrecRanks | null): FormatBreakdown {
  const formats = REPORT_FORMATS.map((f) => tally(f, runs.filter((r) => inFormat(r.card, f))));
  let edhrec: LevelTally[] | null = null;
  if (ranks) {
    const ordered = rankedIds(ranks);
    edhrec = EDHREC_TOPS.map((n) => {
      const top = new Set(ordered.slice(0, n));
      return tally(`EDHREC top ${n.toLocaleString('en-US')}`, runs.filter((r) => top.has(oracleKey(r.card))));
    });
  }
  return { whole: tally('whole corpus', runs), formats, edhrec };
}

const pct = (k: number, n: number): string => (n === 0 ? '-' : `${((100 * k) / n).toFixed(1)}%`);

export function formatTally(t: LevelTally): string {
  const cell = (k: number): string => `${String(k).padStart(6)} ${pct(k, t.cards).padStart(6)}`;
  return `  ${t.label.padEnd(18)} ${String(t.cards).padStart(6)}   full ${cell(t.full)}   partial ${cell(t.partial)}   manual ${cell(t.manual)}`;
}

export function formatBreakdownLines(b: FormatBreakdown, corpus: string, problem?: string): string[] {
  const out = [`Coverage by format and popularity (${corpus}): cards, then full / partial / manual as count and share of the row`];
  out.push(formatTally(b.whole));
  out.push('Formats (legal or restricted in the index\'s Scryfall legalities):');
  b.formats.forEach((t) => out.push(formatTally(t)));
  if (b.edhrec) {
    out.push('EDHREC popularity (edhrec_rank of the cached bulk file; a row counts the ranked cards that are in the corpus):');
    b.edhrec.forEach((t) => out.push(formatTally(t)));
  } else {
    out.push(`EDHREC popularity: not measured: ${problem ?? 'no ranks'}`);
  }
  return out;
}

/** The played weight of a card (see PLAYED_WEIGHTS). `top` is the set of oracle ids in the EDHREC top PLAYED_EDHREC_TOP. */
export function playedWeight(card: OracleCard, top: ReadonlySet<string>): number {
  if (inFormat(card, 'standard')) return PLAYED_WEIGHTS.standard;
  if (top.has(oracleKey(card))) return PLAYED_WEIGHTS.edhrecTop;
  return PLAYED_WEIGHTS.other;
}

export interface WeightedCluster {
  shape: string;
  /** Summed played weight of the cards a template for this shape would unlock (their only manual shape). */
  unlockedWeight: number;
  /** Cards it would unlock. */
  unlocks: number;
  /** Summed played weight of every card the shape appears on. */
  weight: number;
  cards: number;
  /** Up to `examples` card names, heaviest first (then oracle id order). */
  examples: string[];
}

/**
 * `unmatched --weight played`: the residue shapes of the work queue (the tuning half, design 6.12, as `unmatched`) ranked by played cards unlocked:
 * summed weight unlocked, then summed weight, then cards unlocked, then shape (deterministic).
 */
export function weightedUnmatched(all: readonly CardRun[], ranks: EdhrecRanks | null, top: number, examples = 3, halves?: Halves): WeightedCluster[] {
  const topIds = new Set(ranks ? rankedIds(ranks).slice(0, PLAYED_EDHREC_TOP) : []);
  const runs = [...tuningHalf(all, halves)].sort((a, b) => (oracleKey(a.card) < oracleKey(b.card) ? -1 : oracleKey(a.card) > oracleKey(b.card) ? 1 : 0));
  const byShape = new Map<string, { unlockedWeight: number; unlocks: number; weight: number; cards: Set<string>; named: { name: string; w: number; i: number }[] }>();
  runs.forEach((r, i) => {
    const shapes = [...new Set(residueOf(r.parse).map((s) => abstractShape(s)))];
    if (shapes.length === 0) return;
    const w = playedWeight(r.card, topIds);
    const key = oracleKey(r.card);
    for (const s of shapes) {
      const c = byShape.get(s) ?? { unlockedWeight: 0, unlocks: 0, weight: 0, cards: new Set<string>(), named: [] };
      if (c.cards.has(key)) continue;
      c.cards.add(key);
      c.weight += w;
      c.named.push({ name: r.card.name, w, i });
      if (shapes.length === 1) {
        c.unlocks++;
        c.unlockedWeight += w;
      }
      byShape.set(s, c);
    }
  });
  const out = [...byShape].map(([shape, c]) => ({
    shape, unlockedWeight: c.unlockedWeight, unlocks: c.unlocks, weight: c.weight, cards: c.cards.size,
    examples: [...c.named].sort((a, b) => b.w - a.w || a.i - b.i).slice(0, examples).map((x) => x.name),
  }));
  out.sort((a, b) => b.unlockedWeight - a.unlockedWeight || b.weight - a.weight || b.unlocks - a.unlocks || (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0));
  return out.slice(0, top);
}

export const weightHeader = (ranked: boolean): string =>
  `Weighted by played cards: a card weighs ${PLAYED_WEIGHTS.standard} if Standard-legal, ${PLAYED_WEIGHTS.edhrecTop} if in the EDHREC top ${PLAYED_EDHREC_TOP.toLocaleString('en-US')}, else ${PLAYED_WEIGHTS.other}`
  + (ranked ? '' : ' (no EDHREC ranks: only the Standard rule applies)')
  + '; "played" = summed weight of the cards a template would unlock, "seen" = summed weight of every card with the shape.';

export function formatWeighted(clusters: readonly WeightedCluster[]): string[] {
  const out: string[] = [];
  clusters.forEach((c, i) => {
    out.push(`${String(i + 1).padStart(4)}. played ${String(c.unlockedWeight).padStart(5)} (unlocks ${String(c.unlocks).padStart(4)})  seen ${String(c.weight).padStart(5)} (cards ${String(c.cards).padStart(4)})  ${c.shape}`);
    out.push(`        e.g. ${c.examples.join('; ')}`);
  });
  return out;
}
