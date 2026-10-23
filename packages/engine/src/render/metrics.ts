/**
 * The false-reject measurement hook of the render gate (design 6.8 G6, 6.12; consumed by WP25's coverage report). The gate is one-sided: it can reject a
 * correct parse, which costs automation and never correctness, and the rate is a tracked metric that drives renderer work (never a reason to loosen the
 * gate). `measureGate` runs the gate over parsed abilities with their Oracle lines and says how often and WHERE (which word) it disagreed.
 */
import type { AbilityDef } from '../types/ability';
import type { GateResult, RenderContext, RenderGate } from './api';
import { gateTokens } from './equivalence';
import { renderGate } from './gate';

export interface GateSample {
  /** Anything that names the sample in a report (oracle id, ability key). */
  id: string;
  def: AbilityDef;
  /** The Oracle line(s) of the ability. */
  oracle: string[];
  ctx: RenderContext;
}

export interface GateDiff {
  /** The word the renderer expected at the first difference (empty: the text ended) and the Oracle word found there. */
  rendered: string;
  expected: string;
  count: number;
  examples: string[];
}

export interface GateReport {
  total: number;
  accepted: number;
  rejected: number;
  /** rejected / total, 0 for an empty run. */
  rejectRate: number;
  /** Rejections because a node has no renderer or the JSON is malformed (the rendering threw). */
  unrenderable: number;
  /** The disagreements grouped by the pair of words at the first difference, most frequent first. */
  diffs: GateDiff[];
  /** The first rejections in full (capped by `maxRejects`). */
  rejects: { id: string; rendered: string; expected: string; firstDiff?: number }[];
}

export function measureGate(samples: Iterable<GateSample>, gate: RenderGate = renderGate, opts: { maxRejects?: number } = {}): GateReport {
  const maxRejects = opts.maxRejects ?? 50;
  const report: GateReport = { total: 0, accepted: 0, rejected: 0, rejectRate: 0, unrenderable: 0, diffs: [], rejects: [] };
  const groups = new Map<string, GateDiff>();
  for (const s of samples) {
    report.total++;
    // one malformed sample must not abort a whole run: a gate that throws is a rejection, counted as unrenderable (the real gate never throws)
    let r: GateResult;
    try {
      r = gate(s.def, s.oracle, s.ctx);
    } catch (e) {
      r = { ok: false, rendered: `<cannot render: ${e instanceof Error ? e.message : String(e)}>`, expected: '', firstDiff: 0 };
    }
    if (r.ok) {
      report.accepted++;
      continue;
    }
    report.rejected++;
    if (report.rejects.length < maxRejects) report.rejects.push({ id: s.id, rendered: r.rendered, expected: r.expected, firstDiff: r.firstDiff });
    if (r.rendered.startsWith('<cannot render')) {
      report.unrenderable++;
      continue;
    }
    const at = r.firstDiff ?? 0;
    const exp = gateTokens(r.expected)[at] ?? '';
    const ren = gateTokens(r.rendered)[at] ?? '';
    const key = `${ren}\u0000${exp}`;
    const g = groups.get(key) ?? { rendered: ren, expected: exp, count: 0, examples: [] };
    g.count++;
    if (g.examples.length < 3) g.examples.push(s.id);
    groups.set(key, g);
  }
  report.rejectRate = report.total === 0 ? 0 : report.rejected / report.total;
  report.diffs = [...groups.values()].sort((a, b) => b.count - a.count);
  return report;
}
