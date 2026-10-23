/**
 * WP25: the CLI commands `coverage` (--diff, --mine, --promote, --gate), `try`, `unmatched`, `snapshot`, `smoke`, `mutate` on the fixture set, and the
 * committed fixture baseline of guard G10 (packages/cards/test/coverage/fixtures.snapshot.json, design 6.8, 6.9 step 4).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, type Io } from '../../src/commands';
import type { Template } from '@openmtg/engine';
import { BASELINE_STALE, defaultSnapshotPath, parseArgs, staleBaseline } from '../../src/coverage/cli';
import { buildSnapshot, cardKey, diffSnapshots, parseSnapshot, refineWithRuns } from '../../src/coverage/snapshot';
import { fixtureRuns, fullEngine, gameEngine, gameFixtureRuns, synthetic, templateSet } from './support';
import { itSlow } from '../../../engine/test/slow';

function capture(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l), readStdin: async () => '' };
}

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('WP25 CLI arguments', { timeout: 60_000 }, () => {
  it('reads valued options in both spellings, flags, and an optional value for --diff', () => {
    const a = parseArgs(['coverage', '--top', '7', '--every=3', '--fixtures', '--diff', 'base.json', '--mine']);
    expect(a.positional).toEqual(['coverage']);
    expect(a.values.get('--top')).toBe('7');
    expect(a.values.get('--every')).toBe('3');
    expect(a.values.get('--diff')).toBe('base.json');
    expect([...a.flags].sort()).toEqual(['--diff', '--every', '--fixtures', '--mine', '--top']);
    expect(parseArgs(['--diff', '--fixtures']).values.has('--diff')).toBe(false);
  });
});

describe('WP25 CLI commands on the fixture set', { timeout: 60_000 }, () => {
  it('try: a sentence is parsed as a synthetic card and traced (tokens, chart, templates, gate, ledger, level)', async () => {
    const io = capture();
    expect(await main(['try', 'Target player draws four cards.', '--type', 'Sorcery'], io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toContain('consumed by [eff.draw] (goal: effect)');
    expect(text).toContain('gate (G6): ok');
    expect(text).toMatch(/level full/);
    expect(text).toContain('ledger:');
  });
  it('CR 603.1: try traces the units the parser actually charted, with their real goals (a trigger line is a trigger unit and an effect unit)', async () => {
    const io = capture();
    expect(await main(['try', 'When ~ enters, draw a card.'], io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toContain('consumed by [trg.enters] (goal: trigger)');
    expect(text).toContain('consumed by [eff.draw.you] (goal: effect)');
    expect(text).toContain('tokens: WORD:when SELF:~ WORD:enters');
    expect(text).not.toContain('no derivation');
    expect(text).toMatch(/ability 0: triggered \(full\)/);
  });
  it('try: a manual unit shows the parser\'s own diagnostic (where the chart stopped, what it expected)', async () => {
    const io = capture();
    expect(await main(['try', 'Glorp target marblefex.', '--type', 'Instant'], io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toMatch(/MANUAL: /);
    expect(text).toMatch(/diagnostic manual (unknown-word|no-template): .*\[stopped at "/);
  });
  it('coverage: the report on the fixture set, written as JSON with --json', async () => {
    const io = capture();
    const json = path.join(mkdtempSync(path.join(tmpdir(), 'wp25-cli-')), 'report.json');
    const code = await main(['coverage', '--fixtures', '--json', json], io);
    expect(code).toBe(0);
    expect(io.lines[0]).toMatch(/^Coverage of the fixture set \(\d+ of \d+ cards\)/);
    expect(JSON.parse(readFileSync(json, 'utf8')).levels.cards).toBe(fixtureRuns().length);
  }, 180_000); // M5Z: the fixture set grew from 195 to 246 cards; inside a full-suite run this CLI pass can exceed Vitest's 5 s default.
  // 2026-10-21: 54 s alone on a 4-CPU cloud machine, over 60 s in a loaded shard, so 180 s
  it('coverage --diff exits 1 and lists the violation when a formerly automated unit changed (a doctored baseline)', async () => {
    const base = parseSnapshot(readFileSync(defaultSnapshotPath('fixtures'), 'utf8'));
    const key = Object.keys(base.cards).find((k) => Object.values(base.cards[k]!.units).some((u) => u[0] === 'f'))!;
    const unit = Object.keys(base.cards[key]!.units).find((u) => base.cards[key]!.units[u]![0] === 'f')!;
    base.cards[key]!.units[unit] = ['f', '0000000000000000'];
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'wp25-cli-')), 'doctored.json');
    writeFileSync(file, JSON.stringify(base));
    const io = capture();
    expect(await main(['coverage', '--fixtures', '--diff', file], io)).toBe(1);
    expect(io.lines.join('\n')).toContain(`VIOLATION changed: ${base.cards[key]!.name} unit ${unit}`);
  }, 60_000); // FAST5X E28: a whole-fixture pass (709 cards) takes over the default 5 s on a loaded machine
  it('coverage --mine, unmatched, snapshot --out, mutate', async () => {
    let io = capture();
    expect(await main(['coverage', '--fixtures', '--mine', '--top', '5'], io)).toBe(0);
    expect(io.lines.some((l) => /^ {3}1\. unlocks/.test(l))).toBe(true);
    io = capture();
    expect(await main(['unmatched', '--fixtures', '--top', '3'], io)).toBe(0);
    expect(io.lines.filter((l) => /^ {3}\d\. unlocks/.test(l)).length).toBeLessThanOrEqual(3);
    io = capture();
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'wp25-cli-')), 'snap.json');
    expect(await main(['snapshot', '--fixtures', '--out', out], io)).toBe(0);
    expect(Object.keys(parseSnapshot(readFileSync(out, 'utf8')).cards).length).toBe(fixtureRuns().length);
    io = capture();
    expect(await main(['mutate', '--fixtures', '--g2', '30'], io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/G2 nonsense words: \d+ mutations of 30 cards; .* 0 VIOLATION/);
  }, 900_000); // merge of lines C and D: mutate checks every template's near misses, and the merged set (about 1,620 templates) takes about 135 s alone (109 s before); merge wave 7: 2,126 templates, about 280 s alone on a shared 4-CPU machine (240 s was the limit); merge train 20261021T1919: 2,631 templates, 415-494 s in a sharded suite run (480 s was the limit)
  it('coverage --promote proposes and checks templates from a reviewed file', async () => {
    const ability = fullEngine().run(synthetic('Sample Source', 'Instant', 'Sample Source deals 6 damage to any target.')).parse.faces[0]!.abilities[0]!;
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'wp25-cli-')), 'reviewed.json');
    writeFileSync(file, JSON.stringify([{ card: 'Sample Source', ability }]));
    const io = capture();
    expect(await main(['coverage', '--fixtures', '--promote', file], io)).toBe(0);
    expect(io.lines.join('\n')).toContain('proposed promoted.damage.0 (experimental): ~ deals {n0:Qty} damage to {t0:Recipient}');
  }, 120_000);
  // QT: about 25 s, the whole release gate R1 again (smoke, mutations, G10 diff: each also has its own test in the default suite); a slow test
  // (npm run test:all). The merge step also runs the gate itself: npm run cards -- coverage --fixtures --gate R1 --diff.
  itSlow('coverage --gate on the fixture set PASSES every check (exit 0, no FAIL line), prints the CI jobs and writes the backlog', async () => {
    const io = capture();
    const backlog = path.join(mkdtempSync(path.join(tmpdir(), 'wp25-cli-')), 'backlog.txt');
    const code = await main(['coverage', '--fixtures', '--gate', 'R1', '--g2', '30', '--diff', '--backlog', backlog], io);
    const text = io.lines.join('\n');
    expect(text).toContain('Release gate checks (design 15.4):');
    expect(text).toContain('PASS  zero EngineBug in the smoke run (G11)');
    expect(text).toContain('PASS  no equal-priority template conflicts');
    expect(text).toContain('PASS  no compiled card with a card-level lint error');
    expect(text).toContain('PASS  every template has at least one near-miss-checked example (G9)');
    expect(text).toContain('PASS  snapshot diff: only formerly-manual units changed (G10)');
    expect(text).toContain('CI job definitions:');
    expect(text, text.split('\n').filter((l) => l.startsWith('FAIL')).join('\n')).not.toMatch(/^FAIL {2}/m);
    expect(code).toBe(0);
    const written = readFileSync(backlog, 'utf8');
    expect(written).toMatch(/^# Backlog after release gate R1: the top \d+ unparsed sentence shapes/);
    expect(written).toContain('tuning half only');
  }, 600_000); // merge wave 7: the gate's G9 pass over 2,126 templates takes about 335 s alone on a shared 4-CPU machine (300 s was the limit; 286 s on the base)
  it('an unknown option of an old command is still refused; the usage lists the coverage commands', async () => {
    const io = capture();
    expect(await main(['help'], io)).toBe(0);
    for (const c of ['coverage [', 'try <card name', 'unmatched [', 'snapshot [', 'smoke [', 'mutate [']) expect(io.lines.join('\n')).toContain(c);
  });
});

/**
 * Guard G10 in CI (design 6.9 step 4): the fixture set against the committed baseline. A baseline made by a different compile pipeline (WP18's
 * compileCardV2 replacing the fallback) is a deliberate change of every unit's source: the test FAILS (never skips) until the baseline is regenerated,
 * and the regeneration belongs in the same commit as the pipeline change (the WP18 merge), before any template package merges, so the template
 * packages are diffed against it.
 */
describe('WP25 guard G10 (W3b: of the GAME path): the fixture set against the committed baseline', { timeout: 60_000 }, () => {
  const base = parseSnapshot(readFileSync(defaultSnapshotPath('fixtures'), 'utf8'));
  it('was written by the pipeline that runs now, the default compiler (else: regenerate it in the commit that changes the pipeline)', () => {
    expect(base.pipeline, `${BASELINE_STALE}: the baseline was written by "${base.pipeline}", the coverage tools now run "${gameEngine().pipeline()}"`).toBe(gameEngine().pipeline());
  });
  it('no formerly automated unit changed (regenerate the baseline after a reviewed change: npm run cards -- snapshot --fixtures)', () => {
    const runs = gameFixtureRuns();
    const engine = gameEngine();
    const now = buildSnapshot(runs, { pipeline: engine.pipeline(), compilerVersion: engine.compilerVersion, templates: engine.parseOptions.templates, caps: engine.caps });
    const d = refineWithRuns(diffSnapshots(base, now), base, new Map(runs.map((r) => [cardKey(r), r])), engine.caps);
    expect(d.violations).toEqual([]);
    expect(d.removed).toEqual([]);
  }, 60_000); // FAST5X E28: a whole-fixture pass (709 cards) takes over the default 5 s on a loaded machine
  it('a baseline from another pipeline makes the check fail with the regeneration command, never skip', () => {
    expect(BASELINE_STALE).toContain('npm run cards -- snapshot --fixtures');
  });
});

describe('WP25 G10: a baseline written after the change under review is refused (it would hide the change)', { timeout: 60_000 }, () => {
  const engine = fullEngine();
  const snapWith = (templates: readonly Template[]) => buildSnapshot(fixtureRuns().slice(0, 3), { pipeline: engine.pipeline(), compilerVersion: engine.compilerVersion, templates, caps: engine.caps });
  it('the same template hash as the working tree, while the working tree changes templates: refused', () => {
    const now = snapWith(templateSet().templates);
    expect(staleBaseline(now, now, [' M packages/engine/src/parser/templates/effect/draw.json'])).toMatch(/written with the current template set/);
  });
  it('a baseline of another template set, or a clean working tree: accepted', () => {
    const now = snapWith(templateSet().templates);
    const older = snapWith(templateSet().templates.slice(1));
    expect(staleBaseline(older, now, [' M packages/engine/src/parser/templates/effect/draw.json'])).toBeNull();
    expect(staleBaseline(now, now, [])).toBeNull();
  });
});

describe('WP25 the template work queue is built from the tuning half only (design 6.12)', { timeout: 60_000 }, () => {
  it('unmatched and --mine say so and list no held-out card', async () => {
    let io = capture();
    expect(await main(['unmatched', '--fixtures', '--top', '10'], io)).toBe(0);
    expect(io.lines[0]).toMatch(/^Work queue from the tuning half only \(design 6\.12\): \d+ of \d+ cards/);
    io = capture();
    expect(await main(['coverage', '--fixtures', '--mine', '--top', '10'], io)).toBe(0);
    expect(io.lines[0]).toMatch(/^Work queue from the tuning half only/);
  }, 120_000); // FAST5X E19: two whole-fixture passes (478 cards) take over the default 5 s on a loaded machine; merge train 20261021T1919: 44-52 s alone, 60 s was too close
});
