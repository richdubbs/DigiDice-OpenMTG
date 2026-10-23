/**
 * Equal-priority template conflicts over a corpus (design 6.3 rule 3: "a CI check fails on any such pair over the corpus"; 15.4 release gate "no
 * equal-priority template conflicts"). The chart ranks the derivations of a unit by fewer unspecific holes, then by priority; when two readings with
 * DIFFERENT JSON still tie, the unit is ambiguous (guard G5) and manual. That is safe for the card, but when the tied readings come from different
 * templates, two templates claim the same sentence at the same priority: the template set itself is inconsistent, and the next template edit decides
 * silently which one wins. Readings that differ only inside one template's holes are G5 ambiguity, not a template conflict.
 *
 * The parser's diagnostic keeps the readings' JSON, not their templates, so each chart-ambiguous unit is charted again on the parser's own tokens
 * (coverage/units.ts) to name the templates of each reading. A unit whose ambiguity the re-run cannot reproduce is listed as unattributed.
 */
import type { Diagnostic, ParseOptions, PreprocessedFace } from '@openmtg/engine';
import type { CardRun } from './engine';
import { ambiguousReadings, preprocessedFaces } from './units';

export interface TemplateConflict {
  /** The templates only one reading used, against those only the other used: "a = b", sorted. */
  pair: string;
  units: number;
  /** Up to three card names. */
  examples: string[];
}

export interface ConflictReport {
  /** Units the chart left ambiguous (diagnostics with readings). */
  ambiguousUnits: number;
  /** Ambiguous units whose readings come from different templates at the same priority, grouped by template pair. */
  conflicts: TemplateConflict[];
  /** Ambiguous units whose readings use the same templates (ambiguity inside the holes, guard G5 only). */
  withinTemplates: number;
  /** Ambiguous units the re-run could not reproduce (card name and unit text). */
  unattributed: { name: string; text: string }[];
}

/**
 * The re-run of a unit charted again after a refusal (parse.ts#retried, guard G10: "lowered without A, B (guard G10)"): the chart without the templates
 * left out, as the parser charted it when the ambiguity arose; each retry the face records is tried, the first ambiguous one is taken.
 */
function withoutRefused(pre: PreprocessedFace, range: readonly [number, number], opts: ParseOptions, diags: readonly Diagnostic[]): ReturnType<typeof ambiguousReadings> {
  for (const d of diags) {
    const ids = /^lowered without (.+) \(guard G10\)/.exec(d.message)?.[1]?.split(', ');
    if (!ids) continue;
    const r = ambiguousReadings(pre, range, { ...opts, templates: opts.templates.filter((t) => !ids.includes(t.id)) });
    if (r) return r;
  }
  return null;
}

export function templateConflicts(runs: readonly CardRun[], opts: ParseOptions): ConflictReport {
  const out: ConflictReport = { ambiguousUnits: 0, conflicts: [], withinTemplates: 0, unattributed: [] };
  const pairs = new Map<string, TemplateConflict>();
  for (const run of runs) {
    const ambiguous = run.parse.faces.map((f) => f.diagnostics.filter((d) => d.code === 'ambiguous' && Array.isArray(d.alternatives) && d.alternatives.length > 1));
    if (ambiguous.every((l) => l.length === 0)) continue;
    const pres = preprocessedFaces(run.card, opts);
    ambiguous.forEach((list, fi) => {
      for (const d of list) {
        out.ambiguousUnits++;
        const text = /"([^"]*)"\s*$/.exec(d.message)?.[1] ?? d.message;
        const pre = pres[fi];
        const readings = pre && d.range ? ambiguousReadings(pre, d.range, opts) ?? withoutRefused(pre, d.range, opts, run.parse.faces[fi]!.diagnostics) : null;
        if (!readings) {
          out.unattributed.push({ name: run.card.name, text });
          continue;
        }
        const keys = new Set<string>();
        const alts = readings.alternatives.map((a) => new Set(a.templatesUsed));
        for (let i = 0; i < alts.length; i++) {
          for (let j = i + 1; j < alts.length; j++) {
            const onlyA = [...alts[i]!].filter((t) => !alts[j]!.has(t)).sort();
            const onlyB = [...alts[j]!].filter((t) => !alts[i]!.has(t)).sort();
            if (onlyA.length === 0 && onlyB.length === 0) continue;
            keys.add([onlyA.join('+') || '(none)', onlyB.join('+') || '(none)'].sort().join(' = '));
          }
        }
        if (keys.size === 0) out.withinTemplates++;
        for (const k of keys) {
          const c = pairs.get(k) ?? { pair: k, units: 0, examples: [] };
          c.units++;
          if (c.examples.length < 3 && !c.examples.includes(run.card.name)) c.examples.push(run.card.name);
          pairs.set(k, c);
        }
      }
    });
  }
  out.conflicts = [...pairs.values()].sort((a, b) => b.units - a.units || (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0));
  return out;
}
