/**
 * The coverage commands of the card tool (design 6.9, 6.12, 15.2 WP25): `coverage` (with --diff, --mine, --promote, --gate), `try`, `unmatched`,
 * `snapshot`, plus `smoke` and `mutate` (the executability smoke test and the G2/G9 mutation harness on their own). Each returns an exit code.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { OracleCard } from '@openmtg/engine';
import type { Io } from '../commands';
import { CardDatabase } from '../database';
import { repoRoot } from '../paths';
import { loadCorpus, type CorpusSource, type Halves } from './corpus';
import { createCoverageEngine, type CardRun, type CoverageEngine } from './engine';
import { ACCEPTANCE, CI_JOBS, backlogText, formatGates, gatesPass, releaseGateChecks, type AcceptanceResult } from './gates';
import { formatClusters, mine, queueHeader, queueRuns, unmatched } from './mine';
import { nearMissMutations, nonsenseMutations, sampleBySeed } from './mutation';
import { promote, type ReviewedAbility } from './promote';
import { defaultBulkFile, formatBreakdown, formatBreakdownLines, formatWeighted, loadEdhrecRanks, weightHeader, weightedUnmatched } from './popularity';
import { buildReport, formatReport } from './report';
import { buildSnapshot, cardKey, diffSnapshots, parseSnapshot, refineWithRuns, serializeSnapshot, type Snapshot, type SnapshotDiff } from './snapshot';
import { defaultTemplatesDir } from './templates';
import { loadTemplates, type TemplateSet } from './templates';
import { formatTry, syntheticCard } from './try';
import { formatSmoke, isSmokeCandidate, smokeCard, summarize, type SmokeSummary } from '../smoke/run';

export const COVERAGE_COMMANDS = ['coverage', 'try', 'unmatched', 'snapshot', 'smoke', 'mutate'] as const;

export const COVERAGE_USAGE = `
Coverage tools (milestone 5; corpus = the local index, or --fixtures for the committed fixture cards):
  coverage [corpus options] [--json FILE] [--top N]
                                The coverage report (design 6.12): levels by layout and keyword, reasons, missing capabilities,
                                top unparsed shapes, templates, render-gate reject rate, ambiguity, ledger, out-of-sample retention.
           --diff [BASELINE]    Compare with a snapshot (default: the one 'snapshot' wrote); exit 1 if a formerly automated unit changed (G10).
           --mine               Template mining: residue clusters with where the chart stopped.
           --by-format [--bulk FILE]
                                Levels per format (Standard, Pioneer, Modern, Pauper, Legacy, Commander: legal or restricted in the index's
                                legalities) and per EDHREC top 100 ... 10,000 (edhrec_rank read from the cached bulk file, default
                                .cache/scryfall/oracle-cards.jsonl.gz); with --json FILE the breakdown is written as JSON.
           --promote FILE       Propose experimental templates from reviewed abilities ([{card, ability}]) and check G9/G10.
           --gate RN            Release-gate checks (15.4): adds the smoke test, the G2/G9 mutations and the gate's acceptance
                                cards (15.5); writes the top 50 unparsed shapes (the next gate's backlog); exit 1 on a FAIL.
           --backlog FILE       Where --gate writes the backlog (default .cache/coverage/backlog.<gate>.txt); commit it.
  try <card name | "sentence"> [--type "Type Line"] [--json]
                                Parse trace of one card or sentence (tokens, chart, templates, JSON, gate, ledger, level).
  unmatched [--top N] [--weight played [--bulk FILE]] [corpus options]
                                The most frequent unparsed sentence shapes, by cards a template would unlock. --weight played ranks them by
                                played cards unlocked: a card weighs 3 if Standard-legal, 2 if in the EDHREC top 2,500, else 1.
  snapshot [corpus options] [--out FILE]
                                Write the whole-corpus snapshot (G10): per card the templates used and a hash per ability.
  smoke [corpus options]        Executability smoke test: every automated ability on a generated board, no EngineBug (G11).
  mutate [--g2 N] [--seed S] [corpus options]
                                Mutation harness: N nonsense-word card mutations (G2, default 500) and near misses of every template (G9).
Corpus options: --fixtures | --every N | --limit N | --match TEXT | --format F (only cards legal in format F, e.g. standard); --templates DIR (default: the game path, compileCard with the default
                                compiler's template set, which is every file under the engine's parser/templates).`;

interface Args { positional: string[]; flags: Set<string>; values: Map<string, string> }

const VALUED = new Set(['--json', '--top', '--every', '--limit', '--match', '--templates', '--promote', '--gate', '--type', '--out', '--g2', '--seed', '--backlog', '--weight', '--bulk', '--format']);
const OPTIONAL_VALUE = new Set(['--diff']);

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { positional: [], flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (!x.startsWith('--')) {
      a.positional.push(x);
      continue;
    }
    const eq = x.indexOf('=');
    const name = eq > 0 ? x.slice(0, eq) : x;
    if (eq > 0) a.values.set(name, x.slice(eq + 1));
    else if (VALUED.has(name) && argv[i + 1] !== undefined) a.values.set(name, argv[++i]!);
    else if (OPTIONAL_VALUE.has(name) && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) a.values.set(name, argv[++i]!);
    a.flags.add(name);
  }
  return a;
}

const num = (a: Args, k: string, d: number): number => {
  const v = a.values.get(k);
  const n = v === undefined ? d : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
};

/**
 * The message of a fixture baseline written by another pipeline. Guard G10 is never skipped: the baseline is regenerated in the commit that changes the
 * pipeline (the WP18 merge), BEFORE any template package merges, so every template package is still diffed against a baseline of the code before it.
 */
export const BASELINE_STALE = 'the committed G10 baseline (packages/cards/test/coverage/fixtures.snapshot.json) is stale: regenerate it with '
  + '`npm run cards -- snapshot --fixtures` in the commit that changes the pipeline (the WP18 merge), before any template package merges';

export function defaultSnapshotPath(source: CorpusSource): string {
  return source === 'fixtures' ? path.join(repoRoot(), 'packages', 'cards', 'test', 'coverage', 'fixtures.snapshot.json') : path.join(repoRoot(), '.cache', 'coverage', 'snapshot.index.json');
}

interface Ctx { set: TemplateSet; engine: CoverageEngine; source: CorpusSource; cards: OracleCard[]; total: number; halves: Halves }

/**
 * The coverage engine of a command: the GAME path (`compileCard(card)`, the default compiler, W3b) unless `--templates DIR` names another template set.
 * The game's template set must be the files on disk (parser/template-set.ts imports them statically): a difference is reported, never ignored.
 */
export function engineFor(dir: string | undefined, io: Pick<Io, 'err'>): { set: TemplateSet; engine: CoverageEngine } {
  const disk = loadTemplates(dir);
  for (const p of disk.problems.slice(0, 10)) io.err(`template problem: ${p.id}: ${p.message}`);
  if (dir !== undefined) return { set: disk, engine: createCoverageEngine({ templates: disk.templates }) };
  const engine = createCoverageEngine();
  const game = engine.parseOptions.templates;
  const ids = (ts: readonly { id: string }[]): string => ts.map((t) => t.id).join('\n');
  if (ids(game) !== ids(disk.templates)) {
    io.err(`warning: the default compiler parses with ${game.length} templates, the template files hold ${disk.templates.length}: `
      + 'packages/engine/src/parser/template-set.ts is out of date (it must import every file under parser/templates in path order)');
  }
  return { set: { ...disk, templates: [...game] }, engine };
}

async function context(a: Args, io: Io): Promise<Ctx> {
  const { set, engine } = engineFor(a.values.get('--templates'), io);
  const source: CorpusSource = a.flags.has('--fixtures') ? 'fixtures' : 'index';
  const corpus = await loadCorpus({ source, every: num(a, '--every', 1), ...(a.values.has('--limit') ? { limit: num(a, '--limit', 0) } : {}), ...(a.values.has('--match') ? { match: a.values.get('--match')! } : {}), ...(a.values.has('--format') ? { format: a.values.get('--format')! } : {}) }, (m) => io.err(m));
  return { set, engine, source, cards: corpus.cards, total: corpus.total, halves: corpus.halves };
}

/** `git` in the repository; null when git is not available (a snapshot then records no revision). */
function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** The revision of the checkout, with "+dirty" when its working tree has changes (the snapshot header, F10 of the WP25 review). */
function revision(): string {
  const head = git(['rev-parse', '--short=12', 'HEAD']);
  if (head === null) return '';
  return git(['status', '--porcelain'])?.length ? `${head}+dirty` : head;
}

/** Uncommitted changes under the template directory (relative paths), or null when git cannot tell. */
function templateChanges(dir: string): string[] | null {
  const out = git(['status', '--porcelain', '--', path.relative(repoRoot(), dir) || '.']);
  return out === null ? null : out.split('\n').filter(Boolean);
}

function runAll(ctx: Ctx, io: Io): CardRun[] {
  const runs: CardRun[] = [];
  const started = Date.now();
  ctx.cards.forEach((c, i) => {
    runs.push(ctx.engine.run(c));
    if ((i + 1) % 5000 === 0) io.err(`  ${i + 1} of ${ctx.cards.length} cards (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  });
  io.err(`Parsed and compiled ${runs.length} cards in ${((Date.now() - started) / 1000).toFixed(1)} s (${ctx.engine.pipeline()}, ${ctx.set.templates.length} templates).`);
  return runs;
}

/** The smoke test over every candidate, with progress on stderr. */
function smokeAll(runs: readonly CardRun[], io: Io): SmokeSummary {
  const candidates = runs.filter((r) => r.def && isSmokeCandidate(r.def));
  const started = Date.now();
  const results = candidates.map((r, i) => {
    if (i > 0 && i % 1000 === 0) io.err(`  smoke: ${i} of ${candidates.length} cards (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    return smokeCard(r.def!);
  });
  return summarize(results, runs.length);
}

const snapshotOf = (ctx: Ctx, runs: readonly CardRun[], rev = ''): Snapshot => buildSnapshot(runs, { pipeline: ctx.engine.pipeline(), compilerVersion: ctx.engine.compilerVersion, templates: ctx.set.templates, caps: ctx.engine.caps, revision: rev });

/**
 * The baseline must describe the code BEFORE the change under review: a baseline written after a template edit has that edit's template hash, and the
 * diff against it is empty however much the edit changed (G10 would pass silently). Returns the reason to refuse, or null.
 */
export function staleBaseline(base: Snapshot, now: Snapshot, changes: readonly string[] | null): string | null {
  if (!base.templatesHash || base.templatesHash !== now.templatesHash || !changes || changes.length === 0) return null;
  return `the baseline was written with the current template set (hash ${base.templatesHash}), but the working tree changes templates (${changes.slice(0, 3).join('; ')}${changes.length > 3 ? ' ...' : ''}): `
    + 'a diff against it cannot show what the change did. Write the baseline from the base revision (git stash; npm run cards -- snapshot; git stash pop) or pass --diff <a snapshot of the base revision>';
}

function headerLines(base: Snapshot, now: Snapshot): string[] {
  const h = (s: Snapshot): string => `templates ${s.templates} (hash ${s.templatesHash || '-'}), capabilities ${s.capabilities} (hash ${s.capabilitiesHash}), ${s.pipeline}, ${s.compilerVersion}, revision ${s.revision || '-'}`;
  return [`  baseline: ${h(base)}`, `  current:  ${h(now)}`];
}

/** The gate's acceptance cards (design 15.5): from the corpus when it has them, else from the local index; run through the coverage engine. */
async function acceptanceOf(gate: string, ctx: Ctx, runs: readonly CardRun[], io: Io): Promise<AcceptanceResult[]> {
  const byName = new Map(runs.map((r) => [r.card.name, r]));
  let db: CardDatabase | undefined;
  const out: AcceptanceResult[] = [];
  for (const { card, level: expected } of ACCEPTANCE[gate] ?? []) {
    let run = byName.get(card);
    if (!run) {
      try {
        db ??= await CardDatabase.open({ allowEmpty: true });
        const found = db.lookup(card);
        if (found && found.name === card) run = ctx.engine.run(found);
      } catch (e) {
        io.err(`acceptance card ${card}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    out.push({ card, expected, level: run ? run.level : null });
  }
  return out;
}

function formatDiff(d: SnapshotDiff, top: number): string[] {
  const out = [`Snapshot diff (G10): ${d.violations.length} violation(s); ${d.up.length} card(s) up, ${d.down.length} down; ${d.improvedUnits} formerly manual unit(s) changed; ${d.added.length} added, ${d.removed.length} removed`];
  out.push(`  moves: ${Object.entries(d.moves).filter(([k]) => k.split('->')[0] !== k.split('->')[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  for (const v of d.violations.slice(0, top)) out.push(`  VIOLATION ${v.kind}: ${v.name} unit ${v.unit} (${v.before} -> ${v.after ?? 'gone'})`);
  if (d.fullChanged.length) out.push(`  formerly full cards whose output changed: ${d.fullChanged.slice(0, top).join('; ')}${d.fullChanged.length > top ? ' ...' : ''}`);
  for (const x of d.down.slice(0, top)) out.push(`  down: ${x.name} ${x.from} -> ${x.to}`);
  for (const x of d.up.slice(0, top)) out.push(`  up: ${x.name} ${x.from} -> ${x.to}`);
  return out;
}

function readBaseline(file: string): Snapshot {
  return parseSnapshot(readFileSync(file, 'utf8'));
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export async function coverageCommand(command: string, argv: readonly string[], io: Io): Promise<number> {
  const a = parseArgs(argv);
  const top = num(a, '--top', 25);
  switch (command) {
    case 'try': {
      const what = a.positional.join(' ').trim();
      if (!what) {
        io.err('Usage: try <card name | "sentence"> [--type "Type Line"] [--json]');
        return 2;
      }
      const { engine } = engineFor(a.values.get('--templates'), io);
      let card: OracleCard | undefined;
      if (!a.values.has('--type')) {
        try {
          card = (await CardDatabase.open({ allowEmpty: true })).lookup(what);
        } catch {
          card = undefined;
        }
      }
      card ??= syntheticCard(what, a.values.get('--type'));
      formatTry(engine.run(card), engine, { json: a.flags.has('--json') }).forEach(io.out);
      return 0;
    }
    case 'unmatched': {
      const weight = a.values.get('--weight');
      if (a.flags.has('--weight') && weight !== 'played') {
        io.err('Usage: unmatched --weight played [--bulk FILE] (the only weighting is "played")');
        return 2;
      }
      const ctx = await context(a, io);
      const runs = runAll(ctx, io);
      io.out(queueHeader(queueRuns(runs, ctx.halves).length, runs.length));
      if (weight === 'played') {
        const { ranks, problem } = await loadEdhrecRanks(a.values.get('--bulk') ?? defaultBulkFile());
        if (problem) io.err(`EDHREC ranks not available: ${problem}`);
        io.out(weightHeader(ranks !== null));
        formatWeighted(weightedUnmatched(runs, ranks, num(a, '--top', 40), 3, ctx.halves)).forEach(io.out);
        return 0;
      }
      formatClusters(unmatched(runs, num(a, '--top', 40), 3, ctx.halves)).forEach(io.out);
      return 0;
    }
    case 'snapshot': {
      const ctx = await context(a, io);
      const runs = runAll(ctx, io);
      const file = a.values.get('--out') ?? defaultSnapshotPath(ctx.source);
      write(file, serializeSnapshot(snapshotOf(ctx, runs, ctx.source === 'fixtures' ? '' : revision())));
      io.out(`Wrote the snapshot of ${runs.length} cards to ${file}`);
      return 0;
    }
    case 'smoke': {
      const ctx = await context(a, io);
      const runs = runAll(ctx, io);
      const s = smokeAll(runs, io);
      formatSmoke(s, top).forEach(io.out);
      return s.failures.some((f) => f.kind !== 'stuck') ? 1 : 0;
    }
    case 'mutate': {
      const ctx = await context(a, io);
      const g2 = nonsenseMutations(sampleBySeed(ctx.cards, num(a, '--g2', 500), a.values.get('--seed') ?? 'g2'), ctx.engine, { seed: a.values.get('--seed') ?? 'g2' });
      io.out(`G2 nonsense words: ${g2.mutations} mutations of ${g2.cards} cards; ${g2.rejected} left no full ability, ${g2.absorbed} absorbed (no ability), ${g2.labelOnly} in an ability-word or flavor-word label only (counted, not judged), ${g2.violations.length} VIOLATION(S)`);
      for (const v of g2.violations.slice(0, top)) io.out(`  ${v.name}: "${v.mutated}" -> full ability "${v.ability}"`);
      const g9 = nearMissMutations(ctx.set.templates, ctx.engine);
      io.out(`G9 near misses: ${g9.mutations} mutations of ${g9.examples} examples of ${g9.templates} templates; ${g9.unparsedExamples.length} example(s) not fully parsed; ${g9.uncheckedTemplates.length} template(s) with no checked example; ${g9.gatedTemplates.length} waiting for an engine capability; ${g9.violations.length} VIOLATION(S)`);
      for (const v of g9.violations.slice(0, top)) io.out(`  ${v.template} (${v.kind}): "${v.example}" -> "${v.mutated}" parses to the same JSON`);
      for (const t of g9.uncheckedTemplates.slice(0, top)) io.out(`  UNCHECKED ${t}: no example parses fully automated, so no near miss was tried`);
      return g2.violations.length + g9.violations.length + g9.uncheckedTemplates.length > 0 ? 1 : 0;
    }
    case 'coverage': {
      const ctx = await context(a, io);
      if (a.flags.has('--promote')) {
        const file = a.values.get('--promote');
        if (!file) {
          io.err('Usage: coverage --promote <reviewed.json>');
          return 2;
        }
        const reviewed = JSON.parse(readFileSync(file, 'utf8')) as ReviewedAbility[];
        let failed = false;
        for (const p of promote(reviewed, ctx.set.templates, ctx.cards)) {
          io.out(`${p.card}: ${p.sentence}`);
          if (!p.template) {
            io.out(`  refused: ${p.refused}`);
            continue;
          }
          io.out(`  proposed ${p.template.id} (experimental): ${p.template.pattern}`);
          if (p.checks!.g9.length || p.checks!.g10.length) failed = true;
          io.out(`  G9: ${p.checks!.g9.length ? p.checks!.g9.join('; ') : 'ok'}; G10: ${p.checks!.g10.length ? `${p.checks!.g10.length} violation(s)` : 'ok'}; ${p.checks!.changedCards} card(s) change level`);
          io.out(`  ${JSON.stringify(p.template)}`);
        }
        return failed ? 1 : 0;
      }
      const runs = runAll(ctx, io);
      if (a.flags.has('--mine')) {
        io.out(queueHeader(queueRuns(runs, ctx.halves).length, runs.length));
        formatClusters(mine(runs, num(a, '--top', 50), 5, ctx.halves)).forEach(io.out);
        return 0;
      }
      if (a.flags.has('--by-format')) {
        const { ranks, problem } = await loadEdhrecRanks(a.values.get('--bulk') ?? defaultBulkFile());
        const breakdown = formatBreakdown(runs, ranks);
        formatBreakdownLines(breakdown, ctx.source === 'fixtures' ? 'the fixture set' : 'the local index', problem).forEach(io.out);
        const json = a.values.get('--json');
        if (json) {
          write(json, `${JSON.stringify(breakdown, null, 1)}
`);
          io.err(`Wrote the breakdown to ${json}`);
        }
        return 0;
      }
      const report = buildReport(runs, {
        corpus: ctx.source === 'fixtures' ? 'the fixture set' : 'the local index', corpusTotal: ctx.total, pipeline: ctx.engine.pipeline(), compilerVersion: ctx.engine.compilerVersion,
        caps: ctx.engine.caps, templates: ctx.set.templates, templateProblems: ctx.set.problems.length, parseOptions: ctx.engine.parseOptions, top, halves: ctx.halves,
      });
      let code = 0;
      formatReport(report, { top }).forEach(io.out);
      let diff: SnapshotDiff | undefined;
      if (a.flags.has('--diff')) {
        const file = a.values.get('--diff') ?? defaultSnapshotPath(ctx.source);
        let base: Snapshot;
        try {
          base = readBaseline(file);
        } catch (e) {
          io.err(`Cannot read the baseline snapshot ${file}: ${e instanceof Error ? e.message : String(e)}. Write one with: npm run cards -- snapshot${ctx.source === 'fixtures' ? ' --fixtures' : ''}`);
          return 1;
        }
        const now = snapshotOf(ctx, runs);
        io.out('');
        const stale = staleBaseline(base, now, templateChanges(a.values.get('--templates') ?? defaultTemplatesDir()));
        if (stale) {
          headerLines(base, now).forEach(io.out);
          io.err(`Refusing the G10 diff: ${stale}`);
          return 1;
        }
        diff = refineWithRuns(diffSnapshots(base, now), base, new Map(runs.map((r) => [cardKey(r), r])), ctx.engine.caps);
        formatDiff(diff, top).forEach(io.out);
        headerLines(base, now).forEach(io.out);
        if (diff.violations.length) code = 1;
      }
      if (a.flags.has('--gate')) {
        const gate = a.values.get('--gate') ?? 'R1';
        io.err('Running the smoke test and the mutation harness for the gate checks...');
        const smoke = smokeAll(runs, io);
        const nonsense = nonsenseMutations(sampleBySeed(ctx.cards, num(a, '--g2', 5000), 'g2'), ctx.engine);
        const nearMiss = nearMissMutations(ctx.set.templates, ctx.engine);
        // the forecast and the acceptance cards are measured on the local index only (the fixture set is not the corpus of 15.5)
        const acceptance = ctx.source === 'index' ? await acceptanceOf(gate, ctx, runs, io) : undefined;
        const checks = releaseGateChecks({ report, ...(ctx.source === 'index' ? { gate } : {}), ...(diff ? { diff } : {}), smoke, nonsense, nearMiss, ...(acceptance ? { acceptance } : {}) });
        const backlog = a.values.get('--backlog') ?? path.join(repoRoot(), '.cache', 'coverage', `backlog.${gate}.txt`);
        write(backlog, backlogText(report, gate));
        io.err(`Wrote the next gate's backlog (top ${report.unparsedShapes.length} unparsed shapes) to ${backlog}; commit it (design 15.4).`);
        io.out('');
        formatSmoke(smoke, top).forEach(io.out);
        io.out('');
        io.out('Release gate checks (design 15.4):');
        formatGates(checks).forEach(io.out);
        io.out('');
        io.out('CI job definitions:');
        for (const j of CI_JOBS) io.out(`  ${j.name}: ${j.command}  (fails when: ${j.fails})`);
        if (!gatesPass(checks)) code = 1;
      }
      const json = a.values.get('--json');
      if (json) {
        write(json, `${JSON.stringify(report, null, 1)}\n`);
        io.err(`Wrote the report to ${json}`);
      }
      return code;
    }
    default:
      io.err(`Unknown coverage command ${command}`);
      return 2;
  }
}
