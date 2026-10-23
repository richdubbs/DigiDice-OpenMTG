/**
 * WP25: the coverage report of design 6.12 on the fixture set (the harness tests itself on the fixture set, design 15.2), the mining queue
 * (`unmatched`, `coverage --mine`, design 6.9) and the release-gate checks of design 15.4.
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, type AbilityDef, type Template } from '@openmtg/engine';
import { buildReport, formatReport, type CoverageReport, type ReportOptions } from '../../src/coverage/report';
import { formatClusters, mine, unmatched } from '../../src/coverage/mine';
import { ACCEPTANCE, CI_JOBS, FORECAST, acceptanceProblems, backlogText, formatGates, gatesPass, releaseGateChecks } from '../../src/coverage/gates';
import { fixtureCards, halvesOf, oracleKey, sampleCards } from '../../src/coverage/corpus';
import { createCoverageEngine, type CardRun, type CoverageEngine } from '../../src/coverage/engine';
import { fixtureRuns, fullEngine, synthetic, templateSet } from './support';

const optionsOf = (e: CoverageEngine, runs: readonly CardRun[], templates: readonly Template[] = templateSet().templates, extra: Partial<ReportOptions> = {}): ReportOptions => ({
  corpus: 'the fixture set', corpusTotal: runs.length, pipeline: e.pipeline(), compilerVersion: e.compilerVersion, caps: e.caps, templates, templateProblems: 0, parseOptions: e.parseOptions, ...extra,
});
const reportOf = (): CoverageReport => {
  const e = fullEngine();
  const runs = fixtureRuns();
  return buildReport(runs, { ...optionsOf(e, runs), templateProblems: templateSet().problems.length });
};
const gateCheck = (r: CoverageReport, name: RegExp) => releaseGateChecks({ report: r }).find((c) => name.test(c.name))!;

describe('WP25 equal-priority template conflicts (design 6.3 rule 3, 15.4)', () => {
  // two test-only templates (never committed) that read the same invented sentence at the same priority with different JSON
  const a: Template = { id: 'test.wp25.draw-you', kind: 'effect', cr: ['CR 121.1'], pattern: 'draw {n:Qty} card[s]', build: { op: 'draw', who: { ref: 'you' }, count: '$n' }, subject: 'none', examples: [{ text: 'Draw two cards.' }], counterExamples: ['a', 'b'], status: 'stable', since: 1 } as Template;
  const b: Template = { ...a, id: 'test.wp25.draw-opponent', build: { op: 'draw', who: { ref: 'anOpponent' }, count: '$n' } } as Template;
  const set = [...BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.draw.you'), a, b];
  it('CR 608.2c: two templates tying on one sentence are listed as a conflicting pair, and the gate check FAILS', () => {
    const e = createCoverageEngine({ templates: set });
    const runs = [e.run(synthetic('Twin Reading', 'Sorcery', 'Draw two cards.'))];
    const r = buildReport(runs, optionsOf(e, runs, set));
    expect(r.conflicts.ambiguousUnits).toBe(1);
    expect(r.conflicts.conflicts.map((c) => c.pair)).toEqual(['test.wp25.draw-opponent = test.wp25.draw-you']);
    expect(r.conflicts.conflicts[0]!.examples).toEqual(['Twin Reading']);
    const check = gateCheck(r, /equal-priority template conflicts/);
    expect(check.pass).toBe(false);
    expect(check.advisory).toBeUndefined();
    expect(check.detail).toContain('test.wp25.draw-opponent = test.wp25.draw-you');
    expect(gatesPass(releaseGateChecks({ report: r }))).toBe(false);
  });
  it('with a higher priority on one of them the other is outranked: no conflict', () => {
    const ranked = [...BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.draw.you'), { ...a, priority: 1 } as Template, b];
    const e = createCoverageEngine({ templates: ranked });
    const runs = [e.run(synthetic('Twin Reading', 'Sorcery', 'Draw two cards.'))];
    expect(buildReport(runs, optionsOf(e, runs, ranked)).conflicts.conflicts).toEqual([]);
  });
  it('the fixture set with the merged templates has none', () => {
    expect(reportOf().conflicts.conflicts).toEqual([]);
  });
});

describe('WP25 the card-level lint in the report and the gates (design 6.1 step 8, CR 607.1)', () => {
  it('CR 607.1: a compiled card whose ability reads a link nobody produces is counted, and the gate check FAILS', () => {
    const e = fullEngine();
    const bolt = fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!;
    const reads = { kind: 'spell', text: 'Return the exiled card to the battlefield.', src: [0], effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'battlefield' } }] } } as unknown as AbilityDef;
    const broken: CardRun = { ...bolt, def: { ...bolt.def!, faces: [{ ...bolt.def!.faces[0]!, abilities: [reads] }] } };
    const r = buildReport([broken], optionsOf(e, [broken]));
    expect(r.cardLint.cards).toBe(1);
    expect(r.cardLint.list[0]!.problem).toMatch(/link "exiled" is read here but no ability of this card produces it/);
    expect(gateCheck(r, /card-level lint/).pass).toBe(false);
    expect(reportOf().cardLint.cards).toBe(0);
  });
});

describe('WP25 the halves of design 6.12: the work queue looks at the tuning half only; retention uses the halves of the whole source', () => {
  it('no example card of the queue (unmatched, --mine, the report backlog) belongs to the held-out half', () => {
    const runs = fixtureRuns();
    const halves = halvesOf(runs.map((r) => r.card));
    const heldOut = new Set(runs.filter((r) => halves.get(oracleKey(r.card)) === 'heldOut').map((r) => r.card.name));
    expect(heldOut.size).toBeGreaterThan(0);
    const names = [...unmatched(runs, 50, 50), ...mine(runs, 50, 50)].flatMap((c) => c.examples);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => heldOut.has(n))).toEqual([]);
    expect(reportOf().unparsedShapes.flatMap((s) => s.examples).filter((n) => heldOut.has(n))).toEqual([]);
    expect(reportOf().unparsedFrom).toBe(runs.length - heldOut.size);
  });
  it('a sample keeps each card\'s own half: a sample holding the tuning half only has retention NOT measured and the gate check fails', () => {
    const e = fullEngine();
    const all = fixtureCards();
    const halves = halvesOf(all);
    // the tuning half exactly (since the hash split of 2026-10-19 no `--every n` is one half; `unmatched` and `--mine` sample it this way)
    const sample = all.filter((c) => halves.get(oracleKey(c)) === 'tuning').map((c) => fixtureRuns().find((r) => r.card.name === c.name)!);
    expect(sample.length).toBeGreaterThan(0);
    const r = buildReport(sample, { ...optionsOf(e, sample), halves });
    expect(r.retention.measured).toBe(false);
    expect(r.retention.heldOut.cards).toBe(0);
    expect(r.retention.note).toMatch(/not measured/);
    expect(gateCheck(r, /out-of-sample retention/).pass).toBe(false);
    // every third card: both halves present, each card counted in its own half of the whole source
    const third = sampleCards(all, { every: 3 }).map((c) => fixtureRuns().find((x) => x.card.name === c.name)!);
    const r3 = buildReport(third, { ...optionsOf(e, third), halves });
    expect(r3.retention.measured).toBe(true);
    expect(r3.retention.tuning.cards).toBe(third.filter((x) => halves.get(oracleKey(x.card)) === 'tuning').length);
  });
});

describe('WP25 release gate: the acceptance cards of design 15.5 and the backlog file', () => {
  it('the table is cumulative and states the documented levels (Think Twice partial at R1, full from R4)', () => {
    const names = (g: string) => ACCEPTANCE[g]!.map((x) => x.card);
    expect(names('R0')).toEqual(['Serra Angel', 'Llanowar Elves']);
    for (const c of names('R1')) expect(names('R2')).toContain(c);
    expect(ACCEPTANCE['R1']!.find((x) => x.card === 'Think Twice')!.level).toBe('partial');
    expect(ACCEPTANCE['R4']!.find((x) => x.card === 'Think Twice')!.level).toBe('full');
    expect(names('R2')).toContain('Fiend Hunter');
  });
  it('an acceptance card below its documented level, or missing from the index, fails the gate check', () => {
    expect(acceptanceProblems([{ card: 'Lightning Bolt', expected: 'full', level: 'full' }, { card: 'Think Twice', expected: 'partial', level: 'full' }])).toEqual([]);
    expect(acceptanceProblems([{ card: 'Counterspell', expected: 'full', level: 'partial' }, { card: 'Mana Leak', expected: 'full', level: null }])).toEqual(['Counterspell: partial, documented full', 'Mana Leak: not in the local index']);
    const r = reportOf();
    const check = releaseGateChecks({ report: r, gate: 'R1', acceptance: [{ card: 'Counterspell', expected: 'full', level: 'manual' }] }).find((c) => c.name.includes('acceptance cards'))!;
    expect(check.pass).toBe(false);
    expect(check.advisory).toBeUndefined();
  });
  it('the backlog is the report\'s top unparsed shapes of the tuning half, with no clock (the same report writes the same file)', () => {
    const r = reportOf();
    const text = backlogText(r, 'R1');
    expect(text.split('\n').filter((l) => /^\s+\d+\s+\d+\s/.test(l)).length).toBe(r.unparsedShapes.length);
    expect(backlogText(reportOf(), 'R1')).toBe(text);
  });
});

describe('WP25 coverage report (design 6.12)', () => {
  const r = reportOf();
  it('counts every card once by level, per layout and in the ability totals', () => {
    expect(r.levels.cards).toBe(fixtureRuns().length);
    expect(r.levels.full + r.levels.partial + r.levels.manual).toBe(r.levels.cards);
    expect(Object.values(r.byLayout).reduce((n, c) => n + c.cards, 0)).toBe(r.levels.cards);
    expect(r.abilities.full + r.abilities.partial + r.abilities.manual).toBe(r.abilities.total);
    expect(Object.values(r.abilities.byKind).reduce((n, c) => n + c.total, 0)).toBe(r.abilities.total);
  });
  it('per keyword (Scryfall keywords), with whether the engine has keyword:<name> (design 5.2)', () => {
    const flying = r.byKeyword.find((k) => k.keyword === 'Flying')!;
    expect(flying.implemented).toBe(true);
    expect(flying.full + flying.partial + flying.manual).toBe(flying.cards);
    expect(r.byKeyword.find((k) => k.keyword === 'Kicker')?.implemented ?? false).toBe(fullEngine().caps.has('keyword:kicker'));
  });
  it('G4: the ledger of every face is complete (100%); G6: every gated derivation is accepted or rejected; the rates are consistent', () => {
    expect(r.ledger.complete).toBe(r.ledger.faces);
    expect(r.gate.accepted + r.gate.rejected).toBe(r.gate.gated);
    expect(r.gate.rejectRate).toBe(r.gate.gated === 0 ? 0 : r.gate.rejected / r.gate.gated);
    expect(r.ambiguity.list.length).toBeLessThanOrEqual(r.ambiguity.count);
  });
  it('reasons come from the parser diagnostics and the capability degrade; missing capabilities are ranked by cards', () => {
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const x of r.reasons) expect(x.cards).toBeLessThanOrEqual(x.units);
    const counts = r.missingCapabilities.map((m) => m.cards);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
  it('out-of-sample retention (6.12): halves of the oracle_id order, ratio held-out / tuning', () => {
    const ret = r.retention;
    expect(ret.tuning.cards + ret.heldOut.cards).toBe(r.levels.cards);
    expect(ret.tuning.full + ret.heldOut.full).toBe(r.levels.full);
    expect(ret.gate).toBe(0.9);
  });
  it('templates used are counted per card; unused templates are listed; nothing blocks on the fixture set', () => {
    expect(r.templates.used.find((t) => t.id === 'eff.damage')!.cards).toBeGreaterThan(0);
    expect(new Set([...r.templates.used.map((t) => t.id), ...r.templates.unused]).size).toBe(r.meta.templates);
    expect(r.blockingErrors).toBe(0);
  });
  it('is deterministic: the same corpus and templates give the same report', () => {
    expect(JSON.stringify(reportOf())).toBe(JSON.stringify(r));
  });
  it('prints every section', () => {
    const text = formatReport(r).join('\n');
    for (const h of ['By layout:', 'By keyword', 'Manual units by reason', 'Missing capabilities', 'Top unparsed sentence shapes', 'Render gate (G6)', 'Ambiguity (G5)', 'Ledger (G4)', 'Out-of-sample retention']) expect(text).toContain(h);
  });
});

describe('WP25 mining queue (design 6.9 step 1, 6.12 --mine)', () => {
  it('unmatched: shapes ranked by cards unlocked, then by cards, at most N rows', () => {
    const rows = unmatched(fixtureRuns(), 10);
    expect(rows.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      expect(a.unlocks > b.unlocks || (a.unlocks === b.unlocks && a.cards >= b.cards)).toBe(true);
    }
  });
  it('--mine adds the diagnostic codes and where the chart stopped (the furthest token and what was expected there)', () => {
    const rows = mine(fixtureRuns(), 20);
    expect(rows.some((c) => c.codes.length > 0)).toBe(true);
    expect(rows.some((c) => c.stops.length > 0 && c.stops[0]!.expected.length > 0)).toBe(true);
    expect(formatClusters(rows).some((l) => l.includes('stopped at'))).toBe(true);
  });
});

describe('WP25 release gates (design 15.4) and the forecast (15.5)', () => {
  it('pass on the fixture set report alone; a failing check fails the run, an advisory one does not', () => {
    const r = reportOf();
    const checks = releaseGateChecks({ report: r });
    expect(gatesPass(checks)).toBe(true);
    const broken = { ...r, ledger: { ...r.ledger, complete: r.ledger.faces - 1 } };
    expect(gatesPass(releaseGateChecks({ report: broken }))).toBe(false);
    const forecast = releaseGateChecks({ report: r, gate: 'R0' }).find((c) => c.name.includes('forecast'))!;
    expect(forecast.advisory).toBe(true);
    expect(formatGates(checks).every((l) => /^(PASS|WARN|FAIL) {2}/.test(l))).toBe(true);
  });
  it('the forecast table is the one of design 15.5 and the CI jobs name their commands', () => {
    expect(FORECAST).toMatchObject({ R0: 3.6, R1: 9.2, R2: 16.3, R3: 34.2, R4: 50.2, R5: 69.7, R6: 75.8 });
    expect(CI_JOBS.map((j) => j.command)).toContain('npm test');
    expect(CI_JOBS.some((j) => j.command.includes('coverage --fixtures --gate'))).toBe(true);
  });
});
