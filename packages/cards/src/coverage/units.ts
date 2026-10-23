/**
 * The chart units the parser ACTUALLY used on a card (design 6.2-6.3), read from its own output instead of guessed: the ledger of each face says which
 * range of the normalized text was one unit, whether a template consumed it (`by`: the template ids of the derivation) or it stayed manual (with the
 * parser's diagnostics for that range: code, reason, where the chart stopped, the competing readings). The goal of a consumed unit is the kind of its
 * templates (trigger, cost, effect, static, ...).
 *
 * The chart is re-run only where the parser's output does not carry what a tool needs: the template ids of the readings of an AMBIGUOUS unit (guard G5),
 * which tell an equal-priority template conflict (design 6.3 rule 3) from an ambiguity inside one template's holes. The re-run tokenizes the unit from
 * the parser's own parse text (self references as "~", reminder text blank), so it sees the tokens the parser saw.
 */
import {
  adaptTokens, chartInputFrom, faceContexts, parseUnit, preprocessFace, selfExtents, tokenize,
  type ChartGoal, type Derivation, type Diagnostic, type OracleCard, type ParseOptions, type ParseResult, type PreprocessedFace, type Template,
} from '@openmtg/engine';

export interface UnitTrace {
  face: number;
  range: [number, number];
  text: string;
  status: 'consumed' | 'manual';
  /** Consumed: the template ids of the derivation (or the structure that claimed it: `kw.line`, `cost`, `modal`, `rider`). */
  by: string[];
  /** Consumed: the chart goals those templates belong to. */
  goals: string[];
  /** Manual: why (the ledger's reason). */
  reason?: string;
  /** The parser's diagnostics whose range overlaps the unit. */
  diagnostics: Diagnostic[];
}

const overlaps = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

/** The preprocessed faces of a card, in the order of `parseCard`'s faces (null when the front end cannot read the card). */
export function preprocessedFaces(card: OracleCard, opts: ParseOptions): (PreprocessedFace | null)[] {
  let contexts: ReturnType<typeof faceContexts>;
  try {
    contexts = faceContexts(card, opts);
  } catch {
    return [];
  }
  return contexts.map((ctx) => {
    try {
      return preprocessFace(ctx, opts);
    } catch {
      return null;
    }
  });
}

/** Every unit of every face, in text order. */
export function unitTraces(card: OracleCard, parse: ParseResult, opts: ParseOptions, templates: readonly Template[]): UnitTrace[] {
  const kindOf = new Map(templates.map((t) => [t.id, t.kind]));
  const pres = preprocessedFaces(card, opts);
  const out: UnitTrace[] = [];
  parse.faces.forEach((f, fi) => {
    const text = pres[fi]?.normalized ?? '';
    for (const e of [...f.ledger].sort((a, b) => a.range[0] - b.range[0])) {
      if (e.status !== 'consumed' && e.status !== 'manual') continue;
      const by = e.by ? e.by.split(',').filter(Boolean) : [];
      out.push({
        face: fi, range: e.range, text: text.slice(e.range[0], e.range[1]), status: e.status, by,
        goals: [...new Set(by.map((id) => kindOf.get(id)).filter((k): k is NonNullable<typeof k> => k !== undefined))],
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
        diagnostics: f.diagnostics.filter((d) => d.range !== undefined && overlaps(d.range, e.range)),
      });
    }
  });
  return out;
}

/** The goals a unit may have been charted with (design 6.2: whole effect sentences, riders, trigger clauses, costs, statics, ability lines). */
export const UNIT_GOALS: readonly ChartGoal[] = ['effects', 'rider', 'trigger', 'cost', 'static', 'ability', 'condition', 'duration'];

/** The tokens of one unit as the parser read them (from the parse text), without a trailing comma (a trigger or cost clause ends with one). */
export function unitTokens(pre: PreprocessedFace, range: readonly [number, number], opts: ParseOptions): ReturnType<typeof adaptTokens> {
  const toks = tokenize(pre.parse, { from: range[0], to: range[1], lexicon: opts.lexicon, selfExtents: selfExtents(pre), ...(opts.cardNames ? { cardNames: opts.cardNames } : {}) });
  while (toks.length > 0 && toks[toks.length - 1]!.kind === 'PUNCT' && toks[toks.length - 1]!.norm === ',') toks.pop();
  return adaptTokens(toks);
}

/** The readings of an ambiguous unit with their templates: the first goal whose chart is ambiguous on the unit's tokens, or null. */
export function ambiguousReadings(pre: PreprocessedFace, range: readonly [number, number], opts: ParseOptions): { goal: ChartGoal; alternatives: Derivation[] } | null {
  const toks = unitTokens(pre, range, opts);
  if (toks.length === 0) return null;
  for (const goal of UNIT_GOALS) {
    try {
      const r = parseUnit(chartInputFrom(opts, toks, goal));
      if (r.status === 'ambiguous') return { goal, alternatives: r.alternatives };
    } catch {
      /* a goal the chart cannot run on these tokens */
    }
  }
  return null;
}
