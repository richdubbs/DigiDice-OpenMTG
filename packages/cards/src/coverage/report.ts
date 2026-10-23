/**
 * The coverage report of design 6.12 / 10.5 over a corpus (the whole local index, or the fixture set): cards by level, per layout and per keyword;
 * abilities by kind and level; manual units by reason (no template, unknown word, ambiguous, gate mismatch, needs-engine, contagion, ...); the missing
 * capabilities ranked by cards; the top unparsed sentence shapes of the TUNING half ranked by cards unlocked (the next gate's backlog, design 15.4;
 * templates are written looking at the tuning half only, 6.12); templates used and unused; the render gate's reject rate (an upper bound of its
 * false-reject rate; G6 is never loosened because of it); the ambiguity rate and list (G5) and the equal-priority template conflicts behind it (6.3
 * rule 3); compiled cards with a card-level lint error (6.1 step 8); ledger completeness (G4, must be 100%); out-of-sample retention (held-out /
 * tuning over the halves of the whole source, at least 90% at every release gate).
 *
 * Built from `CardRun`s only, deterministically: the same corpus and template set give a byte-identical report.
 */
import {
  RETENTION_GATE, ambiguityList, ambiguityRate, classifyAbility, faceContexts, ledgerProblems, measureGate, normalizeText, residueClusters,
  type AbilityDef, type AmbiguityEntry, type AutomationLevel, type CapabilitySet, type GateDiff, type GateResult, type GateSample, type HalfCoverage,
  type ParseOptions, type ResidueCluster, type Retention, type Template,
} from '@openmtg/engine';
import { templateConflicts, type ConflictReport } from './conflicts';
import { halvesOf, oracleKey, type Halves } from './corpus';
import { cardLintErrors, type CardRun } from './engine';
import { outcomesOf, queueRuns } from './mine';
import { cardKey } from './snapshot';

export interface LevelCounts { cards: number; full: number; partial: number; manual: number }

export interface CoverageReport {
  meta: { pipeline: string; compilerVersion: string; corpus: string; corpusTotal: number; templates: number; templateProblems: number; capabilities: number };
  levels: LevelCounts;
  byLayout: Record<string, LevelCounts>;
  /** Scryfall's per-card keyword list (keyword abilities and actions), with whether the engine has `keyword:<name>`. */
  byKeyword: (LevelCounts & { keyword: string; implemented: boolean })[];
  abilities: { total: number; full: number; partial: number; manual: number; byKind: Record<string, { total: number; full: number; partial: number; manual: number }> };
  /** Manual diagnostics of the parser by code: units (diagnostics) and distinct cards; plus `needs-engine` for cards a missing capability holds back. */
  reasons: { code: string; units: number; cards: number }[];
  missingCapabilities: { capability: string; cards: number }[];
  /** The top unparsed shapes of the TUNING half (design 6.12: templates are written looking at it only); `from` = cards of that half in the corpus. */
  unparsedShapes: ResidueCluster[];
  unparsedFrom: number;
  /** Equal-priority template conflicts (design 6.3 rule 3, 15.4). */
  conflicts: ConflictReport;
  /** Compiled cards with a card-level lint error (design 6.1 step 8; an unlinked consumer reads nothing in play, CR 607.1). Must be none. */
  cardLint: { cards: number; list: { name: string; level: AutomationLevel; problem: string }[] };
  templates: { used: { id: string; cards: number }[]; unused: string[]; experimentalUsed: string[] };
  gate: { gated: number; accepted: number; rejected: number; rejectRate: number; unrenderable: number; diffs: GateDiff[]; rejects: { id: string; rendered: string; expected: string }[] };
  ambiguity: { rate: number; count: number; list: AmbiguityEntry[] };
  ledger: { faces: number; complete: number; problems: { name: string; face: number; problem: string }[] };
  /** Out-of-sample retention over the halves of the WHOLE source (design 6.12). Not measured when a half has no card in this corpus (a sample of one half only). */
  retention: Retention & { gate: number; measured: boolean; note: string };
  /** Cards the tools could not process. `blocking`: a parser error or a pipeline that threw (contract C1); a face shell the fallback path cannot build (an unknown mana symbol before WP18) is listed but not blocking. */
  errors: { name: string; error: string; blocking: boolean }[];
  blockingErrors: number;
  errorCount: number;
}

export interface ReportOptions {
  corpus: string;
  corpusTotal: number;
  pipeline: string;
  compilerVersion: string;
  caps: CapabilitySet;
  templates: readonly Template[];
  templateProblems: number;
  parseOptions: ParseOptions;
  /** Rows of the unparsed-shape table (default 50: the backlog list of design 15.4). */
  topShapes?: number;
  /** Rows of the other long lists (default 25). */
  top?: number;
  /** The halves of the whole source (corpus.ts#halvesOf); default: the runs are the whole source. */
  halves?: Halves;
}

const half = (cards: number): HalfCoverage => ({ cards, full: 0, partial: 0, manual: 0, coverage: 0 });

/** Design 6.12 retention over the source's halves: held-out coverage (share of full cards) / tuning coverage. */
export function retentionOf(runs: readonly CardRun[], halves: Halves): CoverageReport['retention'] {
  const t = half(0);
  const h = half(0);
  for (const r of runs) {
    const c = halves.get(oracleKey(r.card)) === 'heldOut' ? h : t;
    c.cards++;
    c[r.level]++;
  }
  for (const c of [t, h]) c.coverage = c.cards === 0 ? 0 : c.full / c.cards;
  const measured = t.cards > 0 && h.cards > 0;
  const ratio = !measured ? Number.NaN : t.coverage === 0 ? (h.coverage === 0 ? 1 : Number.POSITIVE_INFINITY) : h.coverage / t.coverage;
  const note = measured ? `tuning ${t.cards} cards, held-out ${h.cards} cards (halves of the whole source)` : `not measured: this corpus has ${t.cards} tuning and ${h.cards} held-out cards (a sample of one half only)`;
  return { tuning: t, heldOut: h, ratio, passes: measured && ratio >= RETENTION_GATE, gate: RETENTION_GATE, measured, note };
}

const zero = (): LevelCounts => ({ cards: 0, full: 0, partial: 0, manual: 0 });
const bump = (c: LevelCounts, l: AutomationLevel): void => {
  c.cards++;
  c[l]++;
};
const byCountThenName = <T extends { cards: number }>(key: (t: T) => string) => (a: T, b: T): number => b.cards - a.cards || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

const NOT_GATED = (g: GateResult): boolean => !g.ok && g.rendered === '' && g.expected === '';

export function buildReport(runs: readonly CardRun[], opts: ReportOptions): CoverageReport {
  const top = opts.top ?? 25;
  const levels = zero();
  const byLayout: Record<string, LevelCounts> = {};
  const kw = new Map<string, LevelCounts>();
  const abilities: CoverageReport['abilities'] = { total: 0, full: 0, partial: 0, manual: 0, byKind: {} };
  const reasonUnits = new Map<string, number>();
  const reasonCards = new Map<string, number>();
  const missing = new Map<string, number>();
  const tplCards = new Map<string, number>();
  const experimentalUsed = new Set<string>();
  const gateResults = new Map<AbilityDef, GateResult>();
  const samples: GateSample[] = [];
  const ledger: CoverageReport['ledger'] = { faces: 0, complete: 0, problems: [] };
  const errors: CoverageReport['errors'] = [];
  const cardLint: CoverageReport['cardLint'] = { cards: 0, list: [] };

  for (const run of runs) {
    const { card } = run;
    bump(levels, run.level);
    if (run.def) {
      const lint = cardLintErrors(run.def.faces);
      if (lint.length > 0) {
        cardLint.cards++;
        if (cardLint.list.length < top) cardLint.list.push({ name: card.name, level: run.level, problem: `${lint[0]!.path}: ${lint[0]!.message}` });
      }
    }
    bump((byLayout[card.layout] ??= zero()), run.level);
    for (const k of new Set(card.keywords ?? [])) {
      const c = kw.get(k) ?? zero();
      bump(c, run.level);
      kw.set(k, c);
    }
    if (run.error) errors.push({ name: card.name, error: run.error, blocking: !run.error.startsWith('compileCard:') });
    for (const f of run.parse.faces) for (const d of f.diagnostics) if (d.code === 'parser-error') errors.push({ name: card.name, error: `parser-error: ${d.message}`, blocking: true });

    // abilities as the game plays them
    if (run.def) {
      run.def.faces.forEach((face, fi) => face.abilities.forEach((a, ai) => {
        const level: AutomationLevel = a.kind === 'manual' ? 'manual' : (run.def!.automation.faces?.[fi]?.abilities[ai] ?? classifyAbility(a, opts.caps)).level;
        abilities.total++;
        abilities[level]++;
        const k = (abilities.byKind[a.kind] ??= { total: 0, full: 0, partial: 0, manual: 0 });
        k.total++;
        k[level]++;
      }));
    }

    // reasons
    const codes = new Set<string>();
    for (const f of run.parse.faces) for (const d of f.diagnostics) {
      if (d.level !== 'manual') continue;
      reasonUnits.set(d.code, (reasonUnits.get(d.code) ?? 0) + 1);
      codes.add(d.code);
    }
    if (run.requiresEngine.length > 0) {
      codes.add('needs-engine (degrade)');
      reasonUnits.set('needs-engine (degrade)', (reasonUnits.get('needs-engine (degrade)') ?? 0) + run.requiresEngine.length);
    }
    for (const c of codes) reasonCards.set(c, (reasonCards.get(c) ?? 0) + 1);
    for (const c of new Set(run.requiresEngine)) missing.set(c, (missing.get(c) ?? 0) + 1);

    // templates
    for (const t of new Set(run.parse.faces.flatMap((f) => f.templatesUsed))) tplCards.set(t, (tplCards.get(t) ?? 0) + 1);
    for (const f of run.parse.faces) f.experimental.forEach((t) => experimentalUsed.add(t));

    // gate (G6): every ability the chart derived and lowered went through the exact gate
    run.parse.faces.forEach((f, fi) => f.abilities.forEach((a, ai) => {
      const g = f.gate[ai];
      if (!g || NOT_GATED(g)) return;
      gateResults.set(a, g);
      samples.push({ id: `${card.name}#${fi}.${ai}`, def: a, oracle: [], ctx: { selfNames: [] } });
    }));

    // ledger (G4)
    let contexts: { text: string }[] = [];
    try {
      contexts = faceContexts(card, opts.parseOptions);
    } catch (e) {
      ledger.problems.push({ name: card.name, face: -1, problem: `faceContexts: ${e instanceof Error ? e.message : String(e)}` });
    }
    run.parse.faces.forEach((f, fi) => {
      ledger.faces++;
      const ctx = contexts[fi];
      const problems = ctx ? ledgerProblems(normalizeText(ctx.text).text, f.ledger) : ['no face context'];
      if (problems.length === 0) ledger.complete++;
      else if (ledger.problems.length < top) ledger.problems.push({ name: card.name, face: fi, problem: problems[0]! });
    });
  }

  const gate = measureGate(samples, (def) => gateResults.get(def)!, { maxRejects: top });
  const outcomes = outcomesOf(runs);
  const halves = opts.halves ?? halvesOf(runs.map((r) => r.card));
  const tuning = queueRuns(runs, halves);
  const ambiguities = ambiguityList(outcomes);
  const usedIds = new Set(tplCards.keys());

  return {
    meta: {
      pipeline: opts.pipeline, compilerVersion: opts.compilerVersion, corpus: opts.corpus, corpusTotal: opts.corpusTotal, templates: opts.templates.length,
      templateProblems: opts.templateProblems, capabilities: opts.caps.size,
    },
    levels,
    byLayout: Object.fromEntries(Object.keys(byLayout).sort().map((k) => [k, byLayout[k]!])),
    byKeyword: [...kw].map(([keyword, c]) => ({ keyword, ...c, implemented: opts.caps.has(`keyword:${keyword.toLowerCase()}`) })).sort(byCountThenName((x) => x.keyword)),
    abilities: { ...abilities, byKind: Object.fromEntries(Object.keys(abilities.byKind).sort().map((k) => [k, abilities.byKind[k]!])) },
    reasons: [...reasonCards].map(([code, cards]) => ({ code, units: reasonUnits.get(code) ?? 0, cards })).sort(byCountThenName((x) => x.code)),
    missingCapabilities: [...missing].map(([capability, cards]) => ({ capability, cards })).sort(byCountThenName((x) => x.capability)).slice(0, top),
    unparsedShapes: residueClusters(outcomesOf(tuning), { top: opts.topShapes ?? 50 }),
    unparsedFrom: tuning.length,
    conflicts: templateConflicts(runs, opts.parseOptions),
    cardLint,
    templates: {
      used: [...tplCards].map(([id, cards]) => ({ id, cards })).sort(byCountThenName((x) => x.id)),
      unused: opts.templates.map((t) => t.id).filter((id) => !usedIds.has(id)).sort(),
      experimentalUsed: [...experimentalUsed].sort(),
    },
    gate: { gated: gate.total, accepted: gate.accepted, rejected: gate.rejected, rejectRate: gate.rejectRate, unrenderable: gate.unrenderable, diffs: gate.diffs.slice(0, top), rejects: gate.rejects },
    ambiguity: { rate: ambiguityRate(outcomes), count: ambiguities.length, list: ambiguities.slice(0, top) },
    ledger,
    retention: retentionOf(runs, halves),
    errors: errors.slice(0, top),
    blockingErrors: errors.filter((e) => e.blocking).length,
    errorCount: errors.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// text form
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${((100 * n) / d).toFixed(1)}%`);
const row = (c: LevelCounts): string => `${String(c.cards).padStart(6)}  full ${String(c.full).padStart(6)} (${pct(c.full, c.cards).padStart(6)})  partial ${String(c.partial).padStart(6)} (${pct(c.partial, c.cards).padStart(6)})  manual ${String(c.manual).padStart(6)} (${pct(c.manual, c.cards).padStart(6)})`;

export function formatReport(r: CoverageReport, opts: { top?: number } = {}): string[] {
  const top = opts.top ?? 25;
  const out: string[] = [];
  out.push(`Coverage of ${r.meta.corpus} (${r.levels.cards} of ${r.meta.corpusTotal} cards); pipeline ${r.meta.pipeline}; ${r.meta.compilerVersion}`);
  out.push(`Templates: ${r.meta.templates} (${r.meta.templateProblems} problems); engine capabilities: ${r.meta.capabilities}`);
  out.push('');
  out.push(`Cards  ${row(r.levels)}`);
  out.push(`Abilities: ${r.abilities.total}, full ${r.abilities.full}, partial ${r.abilities.partial}, manual ${r.abilities.manual}`);
  for (const [k, c] of Object.entries(r.abilities.byKind)) out.push(`  ${k.padEnd(10)} ${String(c.total).padStart(6)}  full ${c.full}, partial ${c.partial}, manual ${c.manual}`);
  out.push('');
  out.push('By layout:');
  for (const [k, c] of Object.entries(r.byLayout)) out.push(`  ${k.padEnd(20)} ${row(c)}`);
  out.push('');
  out.push(`By keyword (top ${top}; * = keyword:<name> not in the engine):`);
  for (const k of r.byKeyword.slice(0, top)) out.push(`  ${(k.implemented ? ' ' : '*') + k.keyword.padEnd(22)} ${row(k)}`);
  out.push('');
  out.push('Manual units by reason (parser diagnostics; needs-engine from the capability degrade):');
  for (const x of r.reasons) out.push(`  ${x.code.padEnd(24)} units ${String(x.units).padStart(7)}  cards ${String(x.cards).padStart(6)}`);
  out.push('');
  out.push(`Missing capabilities by cards (top ${top}):`);
  for (const x of r.missingCapabilities) out.push(`  ${x.capability.padEnd(40)} ${x.cards}`);
  out.push('');
  out.push(`Top unparsed sentence shapes (by cards a template would unlock; ${r.unparsedShapes.length} rows; tuning half only, ${r.unparsedFrom} cards, design 6.12):`);
  for (const s of r.unparsedShapes) out.push(`  unlocks ${String(s.unlocks).padStart(5)}  cards ${String(s.cards).padStart(5)}  ${s.shape}   [${s.examples.join('; ')}]`);
  out.push('');
  out.push(`Templates used: ${r.templates.used.length} of ${r.meta.templates}; unused: ${r.templates.unused.length}${r.templates.experimentalUsed.length ? `; experimental templates that matched (cap at partial): ${r.templates.experimentalUsed.length}` : ''}`);
  for (const t of r.templates.used.slice(0, top)) out.push(`  ${t.id.padEnd(32)} ${t.cards}`);
  out.push('');
  out.push(`Render gate (G6): ${r.gate.gated} derivations gated, ${r.gate.accepted} accepted, ${r.gate.rejected} rejected: reject rate ${pct(r.gate.rejected, r.gate.gated)} (upper bound of the false-reject rate; target below 5%)${r.gate.unrenderable ? `, ${r.gate.unrenderable} unrenderable` : ''}`);
  for (const d of r.gate.diffs.slice(0, top)) out.push(`  ${String(d.count).padStart(5)}  rendered "${d.rendered}" where the Oracle text has "${d.expected}"   [${d.examples.join('; ')}]`);
  out.push(`Ambiguity (G5): ${r.ambiguity.count} ambiguous units, rate ${(100 * r.ambiguity.rate).toFixed(2)}%`);
  for (const a of r.ambiguity.list.slice(0, top)) out.push(`  ${a.name} (face ${a.face}): ${a.message}`);
  const c = r.conflicts;
  out.push(`Equal-priority template conflicts (design 6.3 rule 3; must be none): ${c.conflicts.length} template pair(s) in ${c.ambiguousUnits} chart-ambiguous unit(s); ${c.withinTemplates} inside one template's holes (G5 only); ${c.unattributed.length} not reproducible`);
  for (const x of c.conflicts.slice(0, top)) out.push(`  CONFLICT ${x.pair}: ${x.units} unit(s) [${x.examples.join('; ')}]`);
  for (const x of c.unattributed.slice(0, top)) out.push(`  unattributed: ${x.name}: "${x.text}"`);
  out.push(`Card-level lint (design 6.1 step 8, CR 607.1; must be none): ${r.cardLint.cards} compiled card(s) with an error`);
  for (const x of r.cardLint.list) out.push(`  ${x.name} (${x.level}): ${x.problem}`);
  out.push(`Ledger (G4): ${r.ledger.complete} of ${r.ledger.faces} faces complete (${pct(r.ledger.complete, r.ledger.faces)}; must be 100%)`);
  for (const p of r.ledger.problems) out.push(`  ${p.name} face ${p.face}: ${p.problem}`);
  const ret = r.retention;
  out.push(ret.measured
    ? `Out-of-sample retention (6.12): tuning ${pct(ret.tuning.full, ret.tuning.cards)} full, held-out ${pct(ret.heldOut.full, ret.heldOut.cards)} full, ratio ${Number.isFinite(ret.ratio) ? ret.ratio.toFixed(3) : 'inf'} (gate ${ret.gate}): ${ret.passes ? 'PASS' : 'FAIL'}; ${ret.note}`
    : `Out-of-sample retention (6.12): ${ret.note}`);
  if (r.errors.length) {
    out.push(`Errors (${r.errorCount}, ${r.blockingErrors} blocking):`);
    for (const e of r.errors) out.push(`  ${e.blocking ? 'BLOCKING ' : ''}${e.name}: ${e.error}`);
  }
  return out;
}
