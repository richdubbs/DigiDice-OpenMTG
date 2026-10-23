/**
 * M13-13: the game log attached to a report on the server's side (design 4.8) and `npm run bug -- replay` for hosted games (13.1): a report's row names
 * the game; `Inbox.export` reads the game's log and config from the store, cuts it at the moment of the report and writes RPL-4's bug report file, which
 * the developer's script replays. A real engine game (two AI players) in a real store; the server's own checkpoint hashes are compared on this build.
 */
import { checkBugReport, gunzipBytes, REPLAY_LIMITS, writeGzippedJson, type BugReportFile } from '@openmtg/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportLines, Inbox, momentOf, type HostedExport } from '../../src/inbox';
import { MemoryStore } from '../../src/store';
import { runBugReport } from '../../../../scripts/bug';
import { clientAttachments, reportRow, SESSION_B, storeGame, T0, warmGame } from './helpers';

// the AI game the tests share is played once, here (a few seconds on a busy machine)
beforeAll(() => warmGame(), 120_000);

const at = (ms: number): Date => new Date(T0.getTime() + ms);

async function exported(inbox: Inbox, id: string): Promise<{ report: { id: string }; export: HostedExport }> {
  const made = await inbox.export(id);
  if (!made.ok) throw new Error(made.message);
  return made;
}

describe('M13-13 a hosted report as a bug report file', () => {
  it('holds the whole game as the server stored it, cut at the moment of the report, with the reporter\'s own part', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 250 });
    const n = g.actions.length;
    expect(n).toBeGreaterThan(200); // two of the table's checkpoints (every 100th record)
    // made 130 seconds into the game: records 1..130 had been committed (one per second)
    const report = reportRow({ game: g.id, seat: 2, session: SESSION_B, createdAt: at(130_500), text: 'The attack was not declared', attachments: clientAttachments() });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    const f = x.file;

    expect(f.replay.kind).toBe('game');
    expect(f.replay.game).toMatchObject({ mode: 'hosted', format: 'standard', savedBy: 'p2', actions: n });
    expect(f.replay.game.players).toEqual([{ id: 'p1', name: 'One', kind: 'person' }, { id: 'p2', name: 'Two', kind: 'person' }]);
    expect(f.replay.engine.build).toBe('build-test');
    expect(f.replay.reveal).toEqual({ policy: 'own', agreed: [] });
    // the log and the config are the store's: every committed action, in order, with the stored seed
    expect(f.replay.play!.actions).toEqual(g.actions);
    expect(f.replay.play!.config.seed).toBe('m13-13-seed');
    expect(f.replay.play!.config.defs.length).toBeGreaterThan(5);
    expect(f.replay.play!.times).toHaveLength(n);
    expect(f.replay.play!.times[0]).toBe(1_000);
    expect(f.replay.play!.times[n - 1]).toBe(n * 1_000);
    // the moment: the last action committed when the report was made
    expect(f.at.action).toBe(129);
    // the reporter's part
    expect(f.words).toBe('The attack was not declared');
    expect(f.card).toBe('Llanowar Elves');
    expect(f.app).toEqual({ version: '1.2.3', commit: 'abc1234' });
    expect(f.browser).toEqual({ userAgent: 'Mozilla/5.0 (test)', language: 'en-US', screen: 'window 1280x720, screen 1920x1080, 2x' });
    expect(f.settings).toMatchObject({ animationSpeed: 'fast', reducedMotion: false, 'hosted.report': report.id, 'hosted.kind': 'bug', 'hosted.game': g.id, 'hosted.seat': 2 });
    expect(f.errors).toEqual([{ message: 'TypeError: x is undefined', stack: 'at f (a.js:1:1)', time: '2026-10-20T12:02:00.000Z' }]);
    // it is a bug report file as RPL-0's validator reads it, from the JSON it is written as
    expect(checkBugReport(JSON.parse(JSON.stringify(f))).ok).toBe(true);
  });

  it('this build reproduces the server\'s own checkpoint hashes (every 100th record): the file carries this build\'s digests, and the notes say nothing is wrong', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 250 });
    const report = reportRow({ game: g.id, seat: 1, createdAt: at(300_000) });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    expect(x.checks).toMatchObject({ applied: g.actions.length, records: g.actions.length, compared: 2, mismatches: [], stopped: null });
    expect(x.file.replay.play!.checkpoints.length).toBeGreaterThan(2);
    expect(x.file.replay.play!.checkpoints.at(-1)!.action).toBe(g.actions.length - 1);
    expect(x.notes).toEqual([]);
    expect(exportLines(x, { file: null }).join('\n')).toMatch(/2 checkpoints compared, every one matches/);
  });

  it('npm run bug -- replay reads the exported file and plays the game to the reported moment', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 250 });
    const report = reportRow({ game: g.id, seat: 1, createdAt: at(130_500), text: 'Look at the stack', attachments: clientAttachments() });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    const gz = await writeGzippedJson(x.file);
    if (!gz.ok) throw new Error(gz.error.message);
    expect(gz.value.length).toBeLessThan(REPLAY_LIMITS.maxFileBytes);
    const run = await runBugReport(gz.value, { build: 'build-test', name: 'hosted.openmtg-bug-report' });
    const text = run.lines.join('\n');
    expect(run.code).toBe(0);
    expect(text).toContain('Look at the stack');
    expect(text).toContain('Played hosted, standard');
    expect(text).toContain('hosted.game=');
    expect(text).toContain(`Moment reported: after action 130 of ${g.actions.length}`);
    expect(text).toContain('Plays as recorded up to the moment');
    expect(text).toContain('the build the report was made on');
    expect(run.game!.actions).toEqual(g.actions.slice(0, 130));
    // the file holds the whole game's start, not what one player saw: a replay of it needs no recording
    expect(x.file.replay.recording).toBeUndefined();
  });

  it('another build that plays the game differently is found by the server\'s hashes: the notes say where, and the file carries no digests', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 250, wrongCheckAt: 100 });
    const report = reportRow({ game: g.id, seat: 1, createdAt: at(300_000) });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    expect(x.checks.mismatches).toEqual([100]);
    expect(x.checks.compared).toBe(2);
    expect(x.file.replay.play!.checkpoints).toEqual([]);
    expect(x.notes.join('\n')).toMatch(/plays the game differently from the server: its checkpoint hash differs at record 100/);
    expect(x.notes.join('\n')).toMatch(/no checkpoints of its own/);
  });

  it('an action this build refuses stops the replay there: the notes name the record, the file still holds the log as stored', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 40, illegalAt: 25 });
    const report = reportRow({ game: g.id, seat: 1, createdAt: at(300_000) });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    expect(x.checks.stopped).toMatchObject({ seq: 25 });
    expect(x.checks.applied).toBe(24);
    expect(x.notes.join('\n')).toMatch(/stops playing the log at record 25/);
    expect(x.file.replay.play!.actions).toHaveLength(40);
    expect(x.file.replay.play!.checkpoints).toEqual([]);
    expect(x.file.replay.game.ended).toBe('abandoned');
    // and the developer's script says so too
    const gz = await writeGzippedJson(x.file);
    if (!gz.ok) throw new Error(gz.error.message);
    const run = await runBugReport(gz.value, { build: 'build-test' });
    expect(run.code).toBe(2);
    expect(run.lines.join('\n')).toMatch(/refuses action 25/);
  });

  it('a short game has no server checkpoint to compare, and says so', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 30 });
    const report = reportRow({ game: g.id, seat: 1, createdAt: at(300_000) });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    expect(x.checks).toMatchObject({ applied: 30, compared: 0, mismatches: [], stopped: null });
    expect(x.notes.join('\n')).toMatch(/no server checkpoint to compare/);
    expect(x.file.replay.play!.checkpoints).toEqual([]);
  });

  it('the moment is the last action committed when the report was made: before the first record it is 0, after the last it is the last', () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({ at: at((i + 1) * 1_000).toISOString() })) as unknown as Parameters<typeof momentOf>[0];
    expect(momentOf(recs, at(0))).toBe(0);
    expect(momentOf(recs, at(1_000))).toBe(0);
    expect(momentOf(recs, at(3_999))).toBe(2);
    expect(momentOf(recs, at(4_000))).toBe(3);
    expect(momentOf(recs, at(99_000))).toBe(4);
    expect(momentOf([], at(1))).toBe(0);
  });

  it('client details that are not what the client sends are left out with a note, never fatal; every text is bounded and safe to show', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 12 });
    const huge = 'x'.repeat(60_000);
    const report = reportRow({
      game: g.id, seat: 1, createdAt: at(30_000), text: 'odd attachments',
      attachments: [
        { kind: 'client', json: JSON.stringify({ app: { version: 7 }, browser: { userAgent: `UA\u0007${huge}` }, errors: [{ message: 'ok' }, 'not an object', { message: 5 }, { message: 'e', time: 'yesterday' }], card: `C\u001b[2Jard` }) },
        { kind: 'settings', json: '[1, 2, 3]' },
      ],
    });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    expect(x.file.app).toEqual({ version: 'unknown', commit: null });
    expect(x.file.browser.userAgent).toHaveLength(1_000);
    expect(x.file.browser.userAgent).not.toContain('\u0007');
    expect(x.file.errors).toEqual([{ message: 'ok' }, { message: 'e' }]);
    expect(x.file.card).toBe('C[2Jard');
    expect(x.notes.join('\n')).toMatch(/settings: not an object/);
    const dead = reportRow({ game: g.id, seat: 1, createdAt: at(31_000), attachments: [{ kind: 'client', json: '{"a":' }, { kind: 'settings', json: 'null' }] });
    await store.putReport(dead);
    const y = (await exported(new Inbox(store), dead.id)).export;
    expect(y.notes.join('\n')).toMatch(/client details: .*not JSON/i);
    expect(y.file.words).toBe('It broke');
  });

  it('why a report has no game log: no game, a title report, a game retention purged, a table that never started', async () => {
    const store = new MemoryStore();
    const inbox = new Inbox(store);
    const none = reportRow({ createdAt: at(1_000) });
    const title = reportRow({ kind: 'title', game: 'T1', createdAt: at(2_000) });
    const purged = reportRow({ game: 'GONE', seat: 1, createdAt: at(3_000) });
    await store.createGame({ id: 'LOBBY', format: 'standard', variant: null, seats: 2, source: 'listed', title: 'Unstarted', passwordHash: null, passwordSalt: null, createdAt: T0, seatRows: [] });
    const lobby = reportRow({ game: 'LOBBY', seat: 1, createdAt: at(4_000) });
    for (const r of [none, title, purged, lobby]) await store.putReport(r);
    expect(await inbox.export(none.id)).toMatchObject({ ok: false, message: expect.stringMatching(/about no game/) });
    expect(await inbox.export(title.id)).toMatchObject({ ok: false, message: expect.stringMatching(/table-title report/) });
    expect(await inbox.export(purged.id)).toMatchObject({ ok: false, message: expect.stringMatching(/no longer stored.*90 days/) });
    expect(await inbox.export(lobby.id)).toMatchObject({ ok: false, message: expect.stringMatching(/never started/) });
    expect(await inbox.export('0'.repeat(26))).toMatchObject({ ok: false, message: expect.stringMatching(/No report/) });
  });

  it("the file expands within the replay format's bounds", async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 120 });
    const report = reportRow({ game: g.id, seat: 1, createdAt: at(300_000) });
    await store.putReport(report);
    const { export: x } = await exported(new Inbox(store), report.id);
    const gz = await writeGzippedJson(x.file as BugReportFile);
    if (!gz.ok) throw new Error(gz.error.message);
    const raw = await gunzipBytes(gz.value, REPLAY_LIMITS.maxTextBytes);
    expect(raw.ok).toBe(true);
  });
});
