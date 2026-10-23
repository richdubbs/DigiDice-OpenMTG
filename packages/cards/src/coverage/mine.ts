/**
 * The template-mining loop (design 6.9 step 1, 6.12 `coverage --mine`, `unmatched --top N`): the parser's residue (the sentences left manual) clustered by
 * abstract shape (numbers, mana symbols, P/T, types, subtypes, colors and keywords abstracted: parser/metrics.ts#abstractShape) and ranked by the cards
 * a template for that shape would unlock, then by the cards it appears on. `--mine` adds, per cluster, where the chart stopped: the most frequent
 * furthest token and what the grammar expected there (the same diagnostics that feed the LLM repair prompt, design 11.2), which tells a template author
 * which hole or literal is missing.
 */
import { abstractShape, residueClusters, type ParseOutcome, type ResidueCluster } from '@openmtg/engine';
import { tuningHalf, type Halves } from './corpus';
import type { CardRun } from './engine';
import { cardKey } from './snapshot';

export interface MinedCluster extends ResidueCluster {
  /** Diagnostic codes of the units of this shape, most frequent first. */
  codes: { code: string; count: number }[];
  /** Where the chart stopped: furthest token -> how often, and the tokens expected there (most frequent first). */
  stops: { token: string; count: number; expected: string[] }[];
}

export const outcomesOf = (runs: readonly CardRun[]): ParseOutcome[] => runs.map((r) => ({ oracleId: cardKey(r), name: r.card.name, result: r.parse }));

/**
 * Design 6.12: templates are written while looking at the TUNING half only, so the work queue (its shapes and its example cards) is built from the
 * tuning half of `runs`; the held-out half stays unseen for the retention measurement. `halves` are the halves of the whole source (corpus.ts), so a
 * sample keeps each card's own half; without it, `runs` are taken to be the whole source.
 */
export function queueRuns(runs: readonly CardRun[], halves?: Halves): CardRun[] {
  return tuningHalf(runs, halves);
}

/** The header line of a work queue: which half it was built from. */
export const queueHeader = (queued: number, all: number): string => `Work queue from the tuning half only (design 6.12): ${queued} of ${all} cards; the held-out half is kept for the retention measurement.`;

/** `unmatched --top N`: the work queue (tuning half). */
export function unmatched(runs: readonly CardRun[], top: number, examples = 3, halves?: Halves): ResidueCluster[] {
  return residueClusters(outcomesOf(queueRuns(runs, halves)), { top, examples });
}

/** `coverage --mine`: the clusters with the chart's stopping points (tuning half). */
export function mine(all: readonly CardRun[], top: number, examples = 5, halves?: Halves): MinedCluster[] {
  const runs = queueRuns(all, halves);
  const clusters = residueClusters(outcomesOf(runs), { top, examples });
  const wanted = new Set(clusters.map((c) => c.shape));
  const codes = new Map<string, Map<string, number>>();
  const stops = new Map<string, Map<string, { count: number; expected: Map<string, number> }>>();
  for (const run of runs) {
    run.parse.faces.forEach((f) => {
      for (const d of f.diagnostics) {
        if (d.level !== 'manual') continue;
        // the diagnostic's unit: the parser quotes the sentence at the end of its message ('no template matches the sentence: "..."')
        const quoted = /"([^"]+)"\s*$/.exec(d.message)?.[1];
        if (quoted === undefined) continue;
        const shapes = quoted.split(/(?<=\.)\s+(?=\S)/).map((s) => abstractShape(s.trim())).filter((s) => wanted.has(s));
        for (const shape of new Set(shapes)) {
          const c = codes.get(shape) ?? new Map<string, number>();
          c.set(d.code, (c.get(d.code) ?? 0) + 1);
          codes.set(shape, c);
          if (d.furthest) {
            const s = stops.get(shape) ?? new Map();
            const e = s.get(d.furthest.token) ?? { count: 0, expected: new Map<string, number>() };
            e.count++;
            for (const x of d.furthest.expected) e.expected.set(x, (e.expected.get(x) ?? 0) + 1);
            s.set(d.furthest.token, e);
            stops.set(shape, s);
          }
        }
      }
    });
  }
  const sortCount = <T extends { count: number }>(key: (t: T) => string) => (a: T, b: T): number => b.count - a.count || (key(a) < key(b) ? -1 : 1);
  return clusters.map((c) => ({
    ...c,
    codes: [...(codes.get(c.shape) ?? new Map<string, number>())].map(([code, count]) => ({ code, count })).sort(sortCount((x) => x.code)),
    stops: [...(stops.get(c.shape) ?? new Map<string, { count: number; expected: Map<string, number> }>())]
      .map(([token, e]) => ({ token, count: e.count, expected: [...e.expected].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([x]) => x) }))
      .sort(sortCount((x) => x.token))
      .slice(0, 3),
  }));
}

export function formatClusters(clusters: readonly (ResidueCluster | MinedCluster)[]): string[] {
  const out: string[] = [];
  clusters.forEach((c, i) => {
    out.push(`${String(i + 1).padStart(4)}. unlocks ${String(c.unlocks).padStart(5)}  cards ${String(c.cards).padStart(5)}  ${c.shape}`);
    out.push(`        e.g. ${c.examples.join('; ')}`);
    if ('codes' in c) {
      if (c.codes.length) out.push(`        why: ${c.codes.map((x) => `${x.code} x${x.count}`).join(', ')}`);
      for (const s of c.stops) out.push(`        stopped at "${s.token}" x${s.count}, expected: ${s.expected.join(' | ')}`);
    }
  });
  return out;
}
