// @vitest-environment node
/**
 * RPL-4 (replays design 11): `npm run bug -- replay <file>` (scripts/bug.ts) on a fixed fixture report, a report of a hot-seat duel made mid-game
 * (fixtures/duel.openmtg-bug-report, made by `makeFixtureReport`). The script checks the report, prints it, replays its game under this build to the
 * reported moment comparing the checkpoints, and says where another build plays differently; a refused file is refused with its reason, never thrown on.
 *
 * The fixture is a file as a player saves it, made on an earlier engine build. If an engine change makes this little game play differently (the script
 * then says where), write it again: `OPENMTG_WRITE_BUG_FIXTURE=1 npx vitest run packages/client/test/bugs/bug-script.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { GameSession, viewFor, type BugReportFile } from '@openmtg/engine';
import { afterAll, describe, expect, it } from 'vitest';
import { bugReport, seatReplay } from '../../src/bugs/report';
import { main, runBugReport } from '../../../../scripts/bug';
import { FIXED_ENV, FIXTURE_ACTIONS, FIXTURE_CARD, FIXTURE_PATH, fixtureBytes, fixtureReport, makeFixtureReport } from './helpers';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
/** The engine build the fixture was made on (the client's tests build, vitest.config.ts). */
const FIXTURE_BUILD = 'test-engine-build';
/** Some other build, as a developer's checkout has. */
const OTHER_BUILD = 'f'.repeat(64);

const gz = (r: unknown): Uint8Array => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(r))));
const text = (lines: readonly string[]) => lines.join('\n');

const temp = mkdtempSync(join(tmpdir(), 'rpl4-bug-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe.runIf(process.env['OPENMTG_WRITE_BUG_FIXTURE'] === '1')('RPL-4: writing the fixture report again', () => {
  it('writes fixtures/duel.openmtg-bug-report', async () => {
    const report = await makeFixtureReport();
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, gzipSync(Buffer.from(JSON.stringify(report))));
  }, 120_000);
});

describe('RPL-4: npm run bug -- replay <file> on the fixture report (replays design 11)', { timeout: 120_000 }, () => {
  it('reads the fixture: a game report of a hot-seat duel, made mid-game, at its last action', () => {
    const r = fixtureReport();
    expect(r.format).toBe('openmtg-bug-report');
    expect(r.replay.kind).toBe('game');
    expect(r.replay.game.mode).toBe('hotseat');
    expect(r.replay.play!.actions).toHaveLength(FIXTURE_ACTIONS);
    expect(r.at.action).toBe(FIXTURE_ACTIONS - 1);
    expect(r.replay.engine.build).toBe(FIXTURE_BUILD);
  });

  it('prints the report and replays it on another build to the moment: every checkpoint matches (exit code 0)', async () => {
    const run = await runBugReport(fixtureBytes(), { build: OTHER_BUILD, name: 'duel.openmtg-bug-report' });
    const out = text(run.lines);
    expect(run.code, out).toBe(0);
    expect(out).toMatch(/^Bug report duel\.openmtg-bug-report/);
    // the reporter's words, line by line, the card, the app, the browser, the settings and the errors the page caught
    expect(out).toContain('    Test Shock was cast at Bob, but his life did not go down.\n    I expected 2 damage.');
    expect(out).toContain(`The card it is about: ${FIXTURE_CARD}`);
    expect(out).toContain('Made with OpenMTG 0.0.0-test (commit testcommit)');
    expect(out).toContain('Browser: TestBrowser/1.0; en-GB; window 1280x720, screen 1920x1080, 1x');
    expect(out).toContain('animationSpeed=normal');
    expect(out).toMatch(/Errors the page caught: 1\n {4}1\. 2026-10-22T12:00:05\.000Z \[GameScreen\] concede rejected Error: test\n {7}Error: test/);
    // the replay, the builds, the moment
    expect(out).toContain('Replay "Alice vs Bob, Casual": the game itself');
    expect(out).toContain('Played hot-seat, casual: Alice (p1, person), Bob (p2, person); saved by the players at one screen');
    expect(out).toContain(': another build');
    expect(out).toContain(`Moment reported: after action ${FIXTURE_ACTIONS} of ${FIXTURE_ACTIONS}`);
    expect(out).toMatch(/Plays as recorded up to the moment: \d+ checkpoints compared, every one matches\./);
    // the game at the moment: the turn, each player, the battlefield, the log and the card named
    expect(out).toContain(`The game at the moment (after action ${FIXTURE_ACTIONS} of ${FIXTURE_ACTIONS}):`);
    expect(out).toMatch(/ {2}Turn \d+: (Alice|Bob), \w+/);
    expect(out).toMatch(/ {2}Alice \(p1\): life -?\d+, hand \d+, library \d+, graveyard \d+/);
    expect(out).toMatch(/ {2}Bob's battlefield: /);
    expect(out).toMatch(/The last \d+ log lines?:/);
    expect(out).toMatch(/ {2}"Test Shock" \(automation full\): \d+ in Alice's library; \d+ in Alice's graveyard \[o\d+(, o\d+)*\]/);
    // the game up to the moment, for a regression test
    expect(run.game!.actions).toHaveLength(FIXTURE_ACTIONS);
    expect(() => GameSession.fromJSON(run.game!)).not.toThrow();
  });

  it('on the build the report was made on it says so, and the game is exact by construction', async () => {
    const run = await runBugReport(fixtureBytes(), { build: FIXTURE_BUILD });
    expect(run.code).toBe(0);
    expect(text(run.lines)).toContain(': the build the report was made on');
  });

  it('says where another build plays differently: a checkpoint whose digest differs, with the last one that matches (exit code 2)', async () => {
    const r = fixtureReport();
    const cps = r.replay.play!.checkpoints;
    expect(cps.length).toBeGreaterThan(2);
    const bad = cps[2]!;
    bad.digest = `${bad.digest.slice(0, -2)}00`;
    const run = await runBugReport(gz(r), { build: OTHER_BUILD });
    const out = text(run.lines);
    expect(run.code, out).toBe(2);
    expect(out).toContain(`Plays differently on this build: after action ${bad.action + 1} (turn ${bad.turn}) the game is not the one recorded (its digest differs).`);
    expect(out).toContain(`It matches up to action ${cps[1]!.action + 1} (turn ${cps[1]!.turn}), the last checkpoint that matches.`);
    expect(out).toContain('The report was made on another build (commit testcommit)');
    expect(out).toContain('The game where this build stopped');
    // under the build it was made on, a difference is an engine bug
    const same = await runBugReport(gz(r), { build: FIXTURE_BUILD });
    expect(same.code).toBe(2);
    expect(text(same.lines)).toContain('the difference is an engine bug (nondeterminism)');
  });

  it('says where an action is refused on this build, and stops there (exit code 2)', async () => {
    const r = fixtureReport();
    const actions = r.replay.play!.actions;
    // An action of the other player, who does not have priority there: the engine refuses it (CR 117), never half-applies it (CR 733).
    const i = actions.findIndex((a, k) => k > 4 && a.type === 'pass');
    const a = actions[i] as Extract<(typeof actions)[number], { type: 'pass' }>;
    actions[i] = { ...a, player: a.player === 'p1' ? 'p2' : 'p1' };
    const run = await runBugReport(gz(r), { build: OTHER_BUILD });
    const out = text(run.lines);
    expect(run.code, out).toBe(2);
    expect(out).toContain(`Plays differently on this build: it refuses action ${i + 1}: `);
    expect(run.game!.actions).toHaveLength(i);
    expect(out).toContain(`The game where this build stopped (after action ${i} of ${FIXTURE_ACTIONS})`);
  });

  it('a moment past the end of the log is said, and the whole log is run', async () => {
    const r = fixtureReport();
    r.at.action = 500;
    const run = await runBugReport(gz(r), { build: OTHER_BUILD });
    expect(run.code).toBe(0);
    expect(text(run.lines)).toContain(`(the report names action 501, past the end of its log)`);
  });

  it('prints a file\'s text without control characters: a report cannot write terminal escapes', async () => {
    const r = fixtureReport();
    r.words = 'clear the screen \u001b[2J\u001b]52;c;aGVsbG8=\u0007 and ring\u0007 the bell\nsecond line';
    r.errors = [{ message: 'boom \u001b[31mred\u001b[0m' }];
    const run = await runBugReport(gz(r), { build: OTHER_BUILD });
    const out = text(run.lines);
    expect(run.code).toBe(0);
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(out).toContain('    clear the screen [2J]52;c;aGVsbG8= and ring the bell\n    second line');
  });

  it('a recording (what one seat was shown) is read to the moment, not run on the engine', async () => {
    const r = fixtureReport();
    const s = GameSession.fromJSON({ config: r.replay.play!.config, actions: r.replay.play!.actions }).state;
    const replay = seatReplay({
      view: viewFor(s, 'p2'), events: [], changes: FIXTURE_ACTIONS, mode: 'onlineGuest', format: 'casual', id: 'r-seat', now: '2026-10-22T12:00:00.000Z',
      app: FIXED_ENV.app, engine: r.replay.engine,
    });
    const made = bugReport({ replay, at: 0, holds: 'view' }, { words: 'What I saw.' }, FIXED_ENV);
    if (!made.ok) throw new Error(made.error.message);
    const run = await runBugReport(gz(made.value), { build: OTHER_BUILD });
    const out = text(run.lines);
    expect(run.code, out).toBe(0);
    // the seats in the view's (the game's) turn order
    expect(out).toMatch(/Replay "(Alice vs Bob|Bob vs Alice), Casual": a recording of Bob's view/);
    expect(out).toContain('Played online, saved by a guest, casual: ');
    expect(out).toContain('; saved by Bob');
    expect(out).toContain('This report holds a recording: only what its player was shown, so there is no game to run on the engine.');
    expect(out).toContain('The view at the moment (frame 1, Bob\'s view):');
    expect(run.game).toBeNull();
  });
});

describe('RPL-4: npm run bug refuses malformed and oversized files without throwing (exit code 1)', { timeout: 120_000 }, () => {
  const refused = async (bytes: Uint8Array, why: RegExp, code: string) => {
    const run = await runBugReport(bytes, { build: OTHER_BUILD, name: 'x.openmtg-bug-report' });
    expect(run.code).toBe(1);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toMatch(/^Refused x\.openmtg-bug-report: /);
    expect(run.lines[0]).toMatch(why);
    expect(run.lines[0]).toContain(`[${code}]`);
    expect(run.game).toBeNull();
  };
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it('damaged, not UTF-8, not JSON, not a bug report, too deep, of a newer format, or malformed', async () => {
    const good = fixtureBytes();
    await refused(good.slice(0, good.length >> 1), /damaged/, 'badCompression');
    await refused(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), /not UTF-8/, 'badText');
    await refused(utf8('{"format": "openmtg-bug-report", '), /not JSON/, 'notJson');
    await refused(gz(fixtureReport().replay), /not an OpenMTG bug report/, 'notReplay');
    await refused(utf8(`{"format":"openmtg-bug-report","x":${'['.repeat(100_000)}${']'.repeat(100_000)}}`), /nested more than/, 'tooDeep');
    await refused(gz({ ...fixtureReport(), formatVersion: 2 }), /newer OpenMTG/, 'newerFormat');
    const r: BugReportFile = fixtureReport();
    (r.replay.play!.actions[3] as unknown as Record<string, unknown>)['type'] = 'teleport';
    await refused(gz(r), /\(at replay\.play\.actions\[3\]\.type\)/, 'malformed');
    const words = fixtureReport();
    words.words = 'x'.repeat(20_001);
    await refused(gz(words), /\(at words\)/, 'malformed');
  });

  it('oversized: a file over 8 MB is refused before it is read, and one that expands past the bound while it expands', async () => {
    const big = join(temp, 'big.openmtg-bug-report');
    writeFileSync(big, Buffer.alloc(8 * 1024 * 1024 + 1));
    const errors: string[] = [];
    const code = await main(['replay', big], { log: () => {}, error: (s) => errors.push(s), cwd: temp, build: () => OTHER_BUILD });
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/Refused big\.openmtg-bug-report: the file is larger than 8388608 bytes\. \[tooLarge\]/);
    await refused(new Uint8Array(8 * 1024 * 1024 + 1), /larger than 8388608 bytes/, 'tooLarge');
    // a few KB of gzip that expand to 64 MB of spaces, read with a 1 MB bound
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x20)));
    expect(bomb.length).toBeLessThan(256 * 1024);
    const run = await runBugReport(bomb, { build: OTHER_BUILD }, { maxFileBytes: 8 * 1024 * 1024, maxTextBytes: 1024 * 1024, maxDepth: 256, maxString: 1024 * 1024, maxValues: 10_000_000 });
    expect(run.code).toBe(1);
    expect(run.lines[0]).toMatch(/expands to more than 1048576 bytes/);
  });

  it('usage: no command, another command, no file, a file that is not there, an unknown option', async () => {
    for (const argv of [[], ['check', FIXTURE_PATH], ['replay'], ['replay', join(temp, 'missing')], ['replay', FIXTURE_PATH, '--verbose']]) {
      const errors: string[] = [];
      expect(await main(argv, { log: () => {}, error: (s) => errors.push(s), cwd: temp, build: () => OTHER_BUILD }), argv.join(' ')).toBe(1);
      expect(errors.join('\n')).toMatch(/Usage: npm run bug -- replay <file>|Cannot read/);
    }
  });
});

describe('RPL-4: the command line', { timeout: 120_000 }, () => {
  it('`npm run bug -- replay <file> --save <out>` runs the script with tsx: exit code 0, and the game up to the moment saved for a regression test', () => {
    expect((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['bug']).toBe('tsx scripts/bug.ts');
    const out = join(temp, 'game.json');
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/bug.ts'), 'replay', FIXTURE_PATH, '--save', out], { cwd: ROOT, encoding: 'utf8' });
    expect(stdout).toMatch(/Plays as recorded up to the moment/);
    // this checkout's engine build is computed (a SHA-256 of the engine's sources), not the fixture's
    expect(stdout).toMatch(/This engine: build [0-9a-f]{12}, /);
    expect(stdout).toContain(`Saved the game up to action ${FIXTURE_ACTIONS}`);
    const saved = JSON.parse(readFileSync(out, 'utf8')) as ReturnType<GameSession['toJSON']>;
    expect(GameSession.fromJSON(saved).actions).toHaveLength(FIXTURE_ACTIONS);
  });

  it('a refused file exits with code 1 and says why on stderr', () => {
    const bad = join(temp, 'bad.openmtg-bug-report');
    writeFileSync(bad, 'not a report');
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/bug.ts'), 'replay', bad], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      status = (e as { status: number }).status;
      stderr = String((e as { stderr: string }).stderr);
    }
    expect(status).toBe(1);
    expect(stderr).toMatch(/Refused bad\.openmtg-bug-report: This file is not a replay: it is not JSON\. \[notJson\]/);
  });
});
