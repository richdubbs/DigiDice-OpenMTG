/**
 * The release gates of design 15.4 as mechanical checks, and the coverage forecast of 15.5 they are compared with. `coverage --gate R<n>` runs them;
 * they are also the CI job definitions of WP25 (`CI_JOBS`): what a CI run executes, in order, and what makes it fail. Corpus jobs need the local Oracle
 * index (git-ignored Scryfall data); without it they run on the fixture set.
 */
import type { AutomationLevel } from '@openmtg/engine';
import type { NearMissResult, NonsenseResult } from './mutation';
import type { CoverageReport } from './report';
import type { SnapshotDiff } from './snapshot';
import type { SmokeSummary } from '../smoke/run';

/** Design 15.5: expected share of `full` cards per release gate (percent of the corpus). */
export const FORECAST: Readonly<Record<string, number>> = { R0: 3.6, R1: 9.2, R2: 16.3, R3: 34.2, R4: 50.2, R5: 69.7, R6: 75.8, R7: 85 };
/** "within 5 points of the forecast (otherwise the forecast table is corrected)". */
export const FORECAST_TOLERANCE = 5;

const LEVEL_RANK: Readonly<Record<AutomationLevel, number>> = { manual: 0, partial: 1, full: 2 };

/**
 * Design 15.5 "Acceptance cards" per release gate, cumulative (a card accepted at R1 stays accepted), with the level each must reach. The level is the
 * one section 13 documents ("Classification"), except where the gate row says otherwise: Think Twice is partial at R1 ("no flashback yet") and full
 * from R4; Magma Spray is partial in milestone 5 (section 13) and full in its M6 form (R5); the shock and check lands of R4 are section 13's Hallowed
 * Fountain and Glacial Fortress. R0 also names "all vanilla, reminder-only and keyword-only cards classified" and R6 "the 40 hard cards of the corpus
 * analysis": those are corpus measurements (the report), not named cards here.
 */
export const ACCEPTANCE: Readonly<Record<string, readonly { card: string; level: AutomationLevel }[]>> = (() => {
  const full = (...cards: string[]) => cards.map((card) => ({ card, level: 'full' as const }));
  const rows: [string, { card: string; level: AutomationLevel }[]][] = [
    ['R0', full('Serra Angel', 'Llanowar Elves')],
    ['R1', [...full('Lightning Bolt', 'Counterspell', 'Mana Leak', 'Doom Blade', 'Swords to Plowshares', 'Wrath of God', 'Raise the Alarm', 'Path to Exile', 'Rabid Bite'), { card: 'Think Twice', level: 'partial' }]],
    ['R2', full('Blood Artist', 'Flametongue Kavu', 'Rhystic Study', 'Smothering Tithe', 'Mana Vault', 'Fiend Hunter', 'Sneak Attack')],
    ['R3', full('Giant Growth', 'Aspect of Hydra', 'Glorious Anthem', 'Rancor', 'Bonesplitter', 'Sword of Fire and Ice', 'Jace Beleren', 'Humility', 'Opalescence', 'Oko, Thief of Crowns', 'Mutavault', 'Thalia, Guardian of Thraben')],
    ['R4', full('Jace, the Mind Sculptor', 'Fact or Fiction', 'Paradise Plume', 'Kavu Titan', 'Think Twice', 'Cryptic Command', 'Fireball', 'Fire // Ice', 'Death-Rattle Oni', 'Cavern of Souls', 'Hallowed Fountain', 'Glacial Fortress')],
    ['R5', full('Doubling Season', 'Leyline of the Void', 'Rest in Peace', 'Clone', 'Magma Spray', 'Blood Moon')],
    ['R6', []],
    ['R7', []],
  ];
  const out: Record<string, { card: string; level: AutomationLevel }[]> = {};
  const acc = new Map<string, AutomationLevel>();
  for (const [gate, cards] of rows) {
    for (const c of cards) acc.set(c.card, c.level); // a later gate raises the documented level
    out[gate] = [...acc].map(([card, level]) => ({ card, level }));
  }
  return out;
})();

/** One acceptance card as measured: its level, or null when the local index does not have it. */
export interface AcceptanceResult { card: string; expected: AutomationLevel; level: AutomationLevel | null }

export function acceptanceProblems(results: readonly AcceptanceResult[]): string[] {
  return results.flatMap((r) => (r.level === null ? [`${r.card}: not in the local index`] : LEVEL_RANK[r.level] < LEVEL_RANK[r.expected] ? [`${r.card}: ${r.level}, documented ${r.expected}`] : []));
}

export interface GateCheck { name: string; pass: boolean; detail: string; /** A failed advisory check is reported but does not fail the run. */ advisory?: boolean }

export interface GateInputs {
  report: CoverageReport;
  gate?: string;
  diff?: SnapshotDiff;
  smoke?: SmokeSummary;
  nonsense?: NonsenseResult;
  nearMiss?: NearMissResult;
  /** The gate's acceptance cards (ACCEPTANCE[gate]) run through the coverage engine. */
  acceptance?: AcceptanceResult[];
}

export function releaseGateChecks(i: GateInputs): GateCheck[] {
  const r = i.report;
  const checks: GateCheck[] = [];
  checks.push({ name: 'templates well formed (G9 data, design 6.9)', pass: r.meta.templateProblems === 0, detail: `${r.meta.templateProblems} problem(s) in ${r.meta.templates} templates` });
  checks.push({ name: 'ledger complete for 100% of faces (G4)', pass: r.ledger.complete === r.ledger.faces, detail: `${r.ledger.complete} of ${r.ledger.faces}` });
  checks.push({ name: 'no parser or pipeline error (contract C1)', pass: r.blockingErrors === 0, detail: `${r.blockingErrors} blocking error(s); ${r.errorCount - r.blockingErrors} card(s) the fallback path cannot build (unknown mana symbols, WP18 makes them manual stubs)` });
  checks.push({ name: 'no compiled card with a card-level lint error (design 6.1 step 8, CR 607.1)', pass: r.cardLint.cards === 0, detail: `${r.cardLint.cards} card(s)${r.cardLint.list.length ? `: ${r.cardLint.list.slice(0, 5).map((x) => `${x.name} (${x.level})`).join('; ')}` : ''}` });
  checks.push({ name: 'no equal-priority template conflicts (design 6.3 rule 3, 15.4)', pass: r.conflicts.conflicts.length === 0, detail: `${r.conflicts.conflicts.length} template pair(s)${r.conflicts.conflicts.length ? `: ${r.conflicts.conflicts.slice(0, 5).map((c) => `${c.pair} (${c.units})`).join('; ')}` : ''}; ${r.conflicts.ambiguousUnits} chart-ambiguous unit(s)` });
  if (r.conflicts.unattributed.length > 0) checks.push({ name: 'every chart-ambiguous unit attributed to its templates (6.3 rule 3)', pass: false, detail: `${r.conflicts.unattributed.length} unit(s) the re-run did not reproduce; check them by hand with \`try\``, advisory: true });
  checks.push({ name: `out-of-sample retention >= ${r.retention.gate} (6.12)`, pass: r.retention.passes, detail: r.retention.measured ? `ratio ${Number.isFinite(r.retention.ratio) ? r.retention.ratio.toFixed(3) : 'inf'}; ${r.retention.note}` : r.retention.note });
  if (i.smoke) checks.push({ name: 'zero EngineBug in the smoke run (G11)', pass: i.smoke.byKind.EngineBug === 0 && i.smoke.byKind.exception === 0 && i.smoke.byKind.invariant === 0 && i.smoke.byKind['unexpected-manual'] === 0, detail: `EngineBug ${i.smoke.byKind.EngineBug}, exception ${i.smoke.byKind.exception}, invariant ${i.smoke.byKind.invariant}, unexpected manual ${i.smoke.byKind['unexpected-manual']} (stuck ${i.smoke.byKind.stuck}, advisory)` });
  if (i.nonsense) checks.push({ name: 'nonsense-word mutations never leave a full ability (G2)', pass: i.nonsense.violations.length === 0, detail: `${i.nonsense.violations.length} violation(s) in ${i.nonsense.mutations} mutations of ${i.nonsense.cards} cards; ${i.nonsense.labelOnly} in an ability-word or flavor-word label only (counted, not judged)` });
  if (i.nearMiss) checks.push({ name: 'near-miss mutations of every template fail or differ (G9)', pass: i.nearMiss.violations.length === 0, detail: `${i.nearMiss.violations.length} violation(s) in ${i.nearMiss.mutations} mutations; ${i.nearMiss.unparsedExamples.length} example(s) not fully parsed` });
  if (i.nearMiss) checks.push({ name: 'every template has at least one near-miss-checked example (G9)', pass: i.nearMiss.uncheckedTemplates.length === 0, detail: `${i.nearMiss.uncheckedTemplates.length} template(s) with no example that parses fully${i.nearMiss.uncheckedTemplates.length ? `: ${i.nearMiss.uncheckedTemplates.slice(0, 8).join(', ')}` : ''}` });
  if (i.gate && i.acceptance) {
    const problems = acceptanceProblems(i.acceptance);
    checks.push({ name: `the ${i.gate} acceptance cards reach their documented level (15.5)`, pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${i.acceptance.length} card(s)` });
  }
  if (i.diff) checks.push({ name: 'snapshot diff: only formerly-manual units changed (G10)', pass: i.diff.violations.length === 0, detail: `${i.diff.violations.length} violation(s); ${i.diff.up.length} cards up, ${i.diff.down.length} down` });
  checks.push({ name: 'render gate reject rate below 5% (6.12, tracked)', pass: r.gate.gated === 0 || r.gate.rejectRate < 0.05, detail: `${(100 * r.gate.rejectRate).toFixed(1)}% of ${r.gate.gated}`, advisory: true });
  if (i.gate) {
    const expected = FORECAST[i.gate];
    const full = r.levels.cards === 0 ? 0 : (100 * r.levels.full) / r.levels.cards;
    checks.push(expected === undefined
      ? { name: `forecast ${i.gate}`, pass: false, detail: `unknown gate (one of ${Object.keys(FORECAST).join(', ')})` }
      : { name: `full within ${FORECAST_TOLERANCE} points of the ${i.gate} forecast (15.5)`, pass: Math.abs(full - expected) <= FORECAST_TOLERANCE, detail: `measured ${full.toFixed(1)}%, forecast ${expected}%: ${Math.abs(full - expected) <= FORECAST_TOLERANCE ? 'within' : 'outside, correct the forecast table'}`, advisory: true });
  }
  return checks;
}

export const gatesPass = (checks: readonly GateCheck[]): boolean => checks.every((c) => c.pass || c.advisory);

/**
 * The next gate's backlog (design 15.4: "the list of the top 50 unparsed sentence shapes is committed as the next gate's backlog"): the report's
 * unparsed shapes (tuning half, design 6.12), as a plain text file with no clock, so the same corpus and templates write the same file.
 */
export function backlogText(r: CoverageReport, gate: string): string {
  const lines = [
    `# Backlog after release gate ${gate}: the top ${r.unparsedShapes.length} unparsed sentence shapes (design 15.4), by cards a template would unlock`,
    `# corpus: ${r.meta.corpus}, ${r.levels.cards} of ${r.meta.corpusTotal} cards; shapes from the tuning half only (${r.unparsedFrom} cards, design 6.12)`,
    `# pipeline ${r.meta.pipeline}; ${r.meta.compilerVersion}; ${r.meta.templates} templates; ${r.meta.capabilities} engine capabilities`,
    '# unlocks  cards  shape  [example cards]',
    ...r.unparsedShapes.map((s) => `${String(s.unlocks).padStart(9)}  ${String(s.cards).padStart(5)}  ${s.shape}  [${s.examples.join('; ')}]`),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatGates(checks: readonly GateCheck[]): string[] {
  return checks.map((c) => `${c.pass ? 'PASS' : c.advisory ? 'WARN' : 'FAIL'}  ${c.name}: ${c.detail}`);
}

/** The CI job definitions of WP25 (design 15.2): one per gate check; the corpus jobs fall back to the fixture set where the index is absent. */
export const CI_JOBS: readonly { name: string; command: string; fails: string }[] = [
  { name: 'unit and golden tests', command: 'npm test', fails: 'any test fails (template G9 examples, golden JSON and design section 13, the harness self-tests, the fixture G10 baseline: a baseline written by another pipeline FAILS, so the WP18 merge regenerates it in the same commit, before any template package merges)' },
  { name: 'typecheck', command: 'npm run typecheck', fails: 'any type error' },
  { name: 'coverage gates on the fixture set', command: 'npm run cards -- coverage --fixtures --gate R1 --diff', fails: 'a FAIL line (ledger, errors, card-level lint, template conflicts, retention, smoke, G2, G9, G10 against packages/cards/test/coverage/fixtures.snapshot.json)' },
  { name: 'coverage gates on the local index', command: 'npm run cards -- coverage --gate R1 --diff --backlog docs/coverage/backlog-R1.txt', fails: 'a FAIL line (also: an acceptance card of the gate below its documented level, 15.5); the top 50 unparsed shapes of the tuning half are written to the --backlog file, which is committed as the next gate\'s backlog (design 15.4)' },
];
