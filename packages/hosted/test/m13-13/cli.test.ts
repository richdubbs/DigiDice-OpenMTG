/**
 * M13-13: the owner's side of the inbox (design 4.8): `Inbox` and the `openmtg-hosted inbox` command (`src/cli.ts`): listing, showing, statuses, the
 * export, what is printed (nothing a player wrote can drive the terminal), and the store the command opens (the file store only while no server runs).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBugReportFile } from '@openmtg/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../../src/cli';
import { Inbox, liveHolder, openConfiguredStore, reports, RunLockedError, takeRunLock, ulidTime } from '../../src/inbox';
import { startHosted } from '../../src/main';
import { MemoryLogger } from '../../src/obs';
import { FileStore, MemoryStore } from '../../src/store';
import type { ReportRow } from '../../src/store/api';
import { FIXTURE_CARDS, RIG_SECRET } from '../m13-6/harness';
import { clientAttachments, reportRow, SESSION_A, SESSION_B, storeGame, T0, warmGame } from './helpers';

// the AI game the tests share is played once, here (a few seconds on a busy machine)
beforeAll(() => warmGame(), 120_000);

const at = (ms: number): Date => new Date(T0.getTime() + ms);

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5 });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'omtg-m1313-'));
  dirs.push(d);
  return d;
}

/** The command with its output collected. */
async function run(store: MemoryStore | FileStore, args: string[], o: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, { store, out: (t) => out.push(t), err: (t) => err.push(t), now: () => at(10 * 60_000), ...(o.cwd ? { cwd: o.cwd } : {}) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function filled(): Promise<{ store: MemoryStore; rows: ReportRow[] }> {
  const store = new MemoryStore();
  const rows = [
    reportRow({ createdAt: at(1_000), text: 'first bug', session: SESSION_A }),
    reportRow({ createdAt: at(2_000), text: 'a title', kind: 'title', game: 'T1', attachments: [{ kind: 'title', json: JSON.stringify({ title: 'Rude title', creator: 'Mallory' }) }] }),
    reportRow({ createdAt: at(3_000), text: 'second bug', status: 'read', session: SESSION_B }),
    reportRow({ createdAt: at(4_000), text: 'third bug', status: 'closed' }),
    reportRow({ createdAt: at(5_000), text: 'fourth bug', attachments: clientAttachments() }),
  ];
  for (const r of rows) await store.putReport(r);
  return { store, rows };
}

describe('M13-13 reading reports', () => {
  it('every report is seen once, oldest first, whatever the page size and however many share one instant', async () => {
    const store = new MemoryStore();
    const made: ReportRow[] = [];
    for (const [t, n] of [[0, 5], [1_000, 3], [2_000, 1], [3_000, 4]] as const) {
      for (let i = 0; i < n; i++) made.push(reportRow({ createdAt: at(t), text: `t${t}-${i}` }));
    }
    for (const r of made) await store.putReport(r);
    for (const page of [1, 2, 3, 5, 200]) {
      const seen: string[] = [];
      for await (const r of reports(store, new Date(0), page)) seen.push(r.id);
      expect(seen.sort(), `page size ${page}`).toEqual(made.map((r) => r.id).sort());
    }
    const ordered: Date[] = [];
    for await (const r of reports(store, at(1_000), 2)) ordered.push(r.createdAt);
    expect(ordered.map((d) => d.getTime() - T0.getTime())).toEqual([1_000, 1_000, 1_000, 2_000, 3_000, 3_000, 3_000, 3_000]);
  });

  it('list gives the newest first with the filters; get finds a report by its id from the time it carries', async () => {
    const { store, rows } = await filled();
    const inbox = new Inbox(store);
    expect((await inbox.list()).map((r) => r.text)).toEqual(['fourth bug', 'third bug', 'second bug', 'a title', 'first bug']);
    expect((await inbox.list({ status: 'new' })).map((r) => r.text)).toEqual(['fourth bug', 'a title', 'first bug']);
    expect((await inbox.list({ kind: 'bug', status: 'all', limit: 2 })).map((r) => r.text)).toEqual(['fourth bug', 'third bug']);
    expect((await inbox.list({ since: at(3_000) })).map((r) => r.text)).toEqual(['fourth bug', 'third bug', 'second bug']);
    expect((await inbox.list({ limit: 0 }))).toEqual([]);
    const summary = (await inbox.list({ limit: 1 }))[0]!;
    expect(summary.attachments.map((a) => a.kind)).toEqual(['client', 'settings', 'view']);
    expect(await inbox.get(rows[2]!.id)).toEqual(rows[2]);
    expect(await inbox.get(rows[0]!.id.replace(/.$/, 'Z'))).toBeNull();
    expect(await inbox.get('not-a-ulid')).toBeNull();
    expect(ulidTime(rows[3]!.id)).toEqual(at(4_000));
    expect(ulidTime('short')).toBeNull();
    expect(ulidTime('U'.repeat(26))).toBeNull();
  });

  it('statuses change; an unknown report is told', async () => {
    const { store, rows } = await filled();
    const inbox = new Inbox(store);
    expect(await inbox.setStatus(rows[0]!.id, 'closed')).toBe(true);
    expect((await inbox.get(rows[0]!.id))!.status).toBe('closed');
    expect(await inbox.setStatus('0'.repeat(26), 'read')).toBe(false);
  });

  it('details: the client\'s part, a title report\'s evidence, the game\'s row', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 8 });
    const r = reportRow({ game: g.id, seat: 1, attachments: clientAttachments() });
    await store.putReport(r);
    const d = (await new Inbox(store).details(r.id))!;
    expect(d.client).toMatchObject({ card: 'Llanowar Elves', app: { version: '1.2.3' }, settings: { animationSpeed: 'fast' } });
    expect(d.game).toMatchObject({ format: 'standard', status: 'running', seats: [{ seat: 1, name: 'Alice' }, { seat: 2, name: 'Bob' }] });
    const { store: s2, rows } = await filled();
    expect((await new Inbox(s2).details(rows[1]!.id))!.title).toEqual({ title: 'Rude title', creator: 'Mallory' });
    expect(await new Inbox(s2).details('0'.repeat(26))).toBeNull();
  });
});

describe('M13-13 the command', () => {
  it('inbox lists the new reports, newest first; --status, --kind, --since and --limit narrow it', async () => {
    const { store } = await filled();
    const r = await run(store, ['inbox']);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n');
    expect(lines.filter((l) => /\b(bug|title)\b/.test(l) && /new/.test(l)).map((l) => /fourth|a title|first/.exec(l)?.[0])).toEqual(['fourth', 'a title', 'first']);
    expect(r.out).toContain('3 reports (newest first).');
    expect(r.out).not.toContain('third bug');
    expect((await run(store, ['inbox', 'list', '--status', 'all', '--limit', '2'])).out).toContain('2 reports');
    expect((await run(store, ['inbox', '--status', 'closed'])).out).toContain('third bug');
    expect((await run(store, ['inbox', '--kind', 'title', '--status', 'all'])).out).toContain('a title');
    expect((await run(store, ['inbox', '--since', '2026-10-20', '--status', 'all'])).out).toContain('5 reports');
    expect((await run(store, ['inbox', '--since', '1d', '--status', 'all'])).out).toContain('5 reports');
    expect((await run(new MemoryStore(), ['inbox'])).out).toBe('No reports.');
  });

  it('show prints one report in full and marks a new one read, unless --keep', async () => {
    const { store, rows } = await filled();
    const id = rows[4]!.id;
    const kept = await run(store, ['inbox', 'show', id, '--keep']);
    expect(kept.code).toBe(0);
    expect(kept.out).toContain('fourth bug');
    expect(kept.out).toContain('The card it is about: Llanowar Elves');
    expect(kept.out).toContain('Made with OpenMTG 1.2.3 (commit abc1234)');
    expect(kept.out).toContain('TypeError: x is undefined');
    expect(kept.out).toContain('Attachments: client (');
    expect((await new Inbox(store).get(id))!.status).toBe('new');
    const shown = await run(store, ['inbox', 'show', id]);
    expect(shown.out).toContain('(marked read)');
    expect((await new Inbox(store).get(id))!.status).toBe('read');
    // a closed report stays closed
    const closed = await run(store, ['inbox', 'show', rows[3]!.id]);
    expect(closed.out).not.toContain('marked read');
    expect((await new Inbox(store).get(rows[3]!.id))!.status).toBe('closed');
    expect((await run(store, ['inbox', 'show', rows[1]!.id, '--keep'])).out).toContain('The title reported: "Rude title", by Mallory');
    expect(await run(store, ['inbox', 'show', '0'.repeat(26)])).toMatchObject({ code: 1, err: expect.stringContaining('no report') });
  });

  it('read, close and reopen set the status', async () => {
    const { store, rows } = await filled();
    expect(await run(store, ['inbox', 'close', rows[0]!.id])).toMatchObject({ code: 0, out: expect.stringContaining('is now closed') });
    expect((await new Inbox(store).get(rows[0]!.id))!.status).toBe('closed');
    expect((await run(store, ['inbox', 'reopen', rows[0]!.id])).code).toBe(0);
    expect((await new Inbox(store).get(rows[0]!.id))!.status).toBe('new');
    expect((await run(store, ['inbox', 'read', rows[0]!.id])).out).toContain('is now read');
    expect((await run(store, ['inbox', 'read', '0'.repeat(26)])).code).toBe(1);
  });

  it('what a player wrote cannot drive the terminal: no control character reaches the output, every line is bounded', async () => {
    const store = new MemoryStore();
    // the hosted text rules keep control characters out of what is stored; a row that holds them anyway (an older server, a hand-edited store) is still printed safely
    const words = `A\u001b]52;c;ZXZpbA==\u0007B\u001b[2Jfine ${'w'.repeat(3_000)}`;
    const attachments = [{ kind: 'client', json: JSON.stringify({ app: { version: 'v\u001b[31m1', commit: null }, browser: { userAgent: 'UA\u001b]0;pwned\u0007' }, errors: [{ message: 'boom\u001b[H', stack: `s\u0000\n${'k'.repeat(5_000)}` }], card: 'Card‮Name' }) }];
    const row = reportRow({ text: words, attachments, game: 'G\u001bX' });
    await store.putReport(row);
    const r = await run(store, ['inbox', 'show', row.id, '--keep']);
    const listed = await run(store, ['inbox']);
    for (const text of [r.out, listed.out]) {
      // eslint-disable-next-line no-control-regex
      expect(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(text), 'a control or bidi character').toBe(false);
      for (const line of text.split('\n')) expect(line.length).toBeLessThan(1_400);
    }
    expect(r.out).toContain('fine');
  });

  it('export writes the bug report file for a hosted game\'s report, tells how this build plays it, and refuses to overwrite', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 150 });
    const rep = reportRow({ game: g.id, seat: 1, createdAt: at(60_000), text: 'broken', attachments: clientAttachments() });
    await store.putReport(rep);
    const dir = await tmp();
    const first = await run(store, ['inbox', 'export', rep.id, '--out', 'mine.openmtg-bug-report'], { cwd: dir });
    expect(first.code).toBe(0);
    expect(first.out).toContain('Replayed under this build');
    expect(first.out).toContain('both players\' cards and the seed');
    const file = join(dir, 'mine.openmtg-bug-report');
    const read = await readBugReportFile(new Uint8Array(await readFile(file)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.words).toBe('broken');
    expect(read.value.replay.game.mode).toBe('hosted');
    expect(read.value.at.action).toBe(59);
    expect(await run(store, ['inbox', 'export', rep.id, '--out', 'mine.openmtg-bug-report'], { cwd: dir })).toMatchObject({ code: 1, err: expect.stringContaining('it exists') });
    const dflt = await run(store, ['inbox', 'export', rep.id], { cwd: dir });
    expect(dflt.out).toContain(`hosted-${rep.id}.openmtg-bug-report`);
    expect((await run(store, ['inbox', 'export', '0'.repeat(26)], { cwd: dir })).code).toBe(1);
    expect(await run(store, ['inbox', 'export', (await filledId(store))], { cwd: dir })).toMatchObject({ code: 1, err: expect.stringContaining('no game') });
  });

  it('export exits 3 when this build plays the game differently from the server (the file is written, the notes say where)', async () => {
    const store = new MemoryStore();
    const g = await storeGame(store, { moves: 150, wrongCheckAt: 100 });
    const rep = reportRow({ game: g.id, seat: 1, createdAt: at(200_000) });
    await store.putReport(rep);
    const r = await run(store, ['inbox', 'export', rep.id, '--out', 'x.openmtg-bug-report'], { cwd: await tmp() });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/1 of 1 differ on this build \(first at record 100\)/);
  });

  it('usage problems exit 2 and print the usage', async () => {
    const store = new MemoryStore();
    for (const args of [['inbox', 'show'], ['inbox', 'show', 'a', 'b'], ['inbox', '--status', 'weird'], ['inbox', '--kind', 'x'], ['inbox', '--since', 'soon'], ['inbox', '--limit', '0'],
      ['inbox', '--bogus'], ['inbox', 'list', 'x'], ['inbox', 'nonsense'], ['inbox', '--status'], ['frobnicate'], []]) {
      const r = await run(store, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.err, args.join(' ')).toContain('usage: openmtg-hosted inbox');
    }
    expect(await run(store, ['help'])).toMatchObject({ code: 0, out: expect.stringContaining('usage: openmtg-hosted inbox') });
  });
});

async function filledId(store: MemoryStore): Promise<string> {
  const r = reportRow({ createdAt: at(90_000) });
  await store.putReport(r);
  return r.id;
}

describe('M13-13 the store the command opens', () => {
  it('the file store of a data directory: the reports are read; a live server\'s run lock refuses it; a directory without a store is not made into one', async () => {
    const dir = await tmp();
    const fs = await FileStore.open(dir);
    const rep = reportRow({ createdAt: at(1_000), text: 'in a file' });
    await fs.putReport(rep);
    await fs.close();
    const env = { STORE: 'file', DATA_DIR: dir };
    const opened = await openConfiguredStore(env);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await new Inbox(opened.store).list({ status: 'all' })).map((r) => r.text)).toEqual(['in a file']);
    await opened.close();

    const lock = await takeRunLock(dir);
    expect(await liveHolder(dir)).toMatchObject({ pid: process.pid });
    const refused = await openConfiguredStore(env);
    expect(refused).toMatchObject({ ok: false, code: 1 });
    if (!refused.ok) expect(refused.problems.join(' ')).toMatch(/in use by the server.*stop the server first, or use PostgreSQL/);
    const out: string[] = [];
    expect(await main(['inbox'], { env, out: (t) => out.push(t), err: (t) => out.push(t) })).toBe(1);
    expect(out.join('\n')).toMatch(/in use by the server/);
    await lock.release();
    expect(await liveHolder(dir)).toBeNull();
    expect((await openConfiguredStore(env)).ok).toBe(true);

    const empty = await tmp();
    expect(await openConfiguredStore({ STORE: 'file', DATA_DIR: join(empty, 'nothing') })).toMatchObject({ ok: false, code: 1 });
  });

  it('the memory store and a bad configuration are refused (exit 2)', async () => {
    expect(await openConfiguredStore({ STORE: 'memory' })).toMatchObject({ ok: false, code: 2 });
    expect(await openConfiguredStore({ STORE: 'tape' })).toMatchObject({ ok: false, code: 2 });
    expect(await openConfiguredStore({ STORE: 'postgres' })).toMatchObject({ ok: false, code: 2 });
  });
});

describe('M13-13 the server holds the run lock of a file store while it runs', () => {
  it('startHosted takes it and gives it back: the command is refused while the server runs and works after it stopped; a second server on the directory is refused', async () => {
    const dir = await tmp();
    const env = { STORE: 'file', DATA_DIR: dir, WORKERS: '1', LEDGER_SECRET: RIG_SECRET };
    const start = () => startHosted({ env, listenPort: null, cards: { module: FIXTURE_CARDS }, engineBuild: 'build-test', logger: new MemoryLogger() });
    const server = await start();
    expect(await liveHolder(dir)).toMatchObject({ pid: process.pid });
    const out: string[] = [];
    expect(await main(['inbox'], { env: { STORE: 'file', DATA_DIR: dir }, out: (t) => out.push(t), err: (t) => out.push(t) })).toBe(1);
    expect(out.join(' ')).toMatch(/in use by the server/);
    await expect(start()).rejects.toBeInstanceOf(RunLockedError);
    // the refused second start did not take the first one's lock away
    expect(await liveHolder(dir)).not.toBeNull();
    await server.close();
    expect(await liveHolder(dir)).toBeNull();
    const out2: string[] = [];
    expect(await main(['inbox'], { env: { STORE: 'file', DATA_DIR: dir }, out: (t) => out2.push(t), err: (t) => out2.push(t) })).toBe(0);
    expect(out2).toEqual(['No reports.']);
    // and a server can start again on the same directory
    await (await start()).close();
  }, 60_000);
});

describe('M13-13 the run lock', () => {
  it('a second process (or a second opener here) is refused; a lock whose process is gone is taken over; release only removes one\'s own', async () => {
    const dir = await tmp();
    const a = await takeRunLock(dir);
    expect(a.takenOver).toBe(false);
    await expect(takeRunLock(dir)).rejects.toBeInstanceOf(RunLockedError);
    await a.release();
    await a.release();
    // a lock a dead process left (a pid that cannot be running) is stale
    await writeFile(join(dir, 'hosted.lock'), JSON.stringify({ pid: 2_147_483_000, startedAt: '2026-01-01T00:00:00.000Z' }));
    expect(await liveHolder(dir)).toBeNull();
    const b = await takeRunLock(dir);
    expect(b.takenOver).toBe(true);
    // a lock that is not a lock (half written) holds nobody
    await b.release();
    await writeFile(join(dir, 'hosted.lock'), '{"pid"');
    expect(await liveHolder(dir)).toBeNull();
    const c = await takeRunLock(dir);
    expect(c.takenOver).toBe(true);
    // released: another holder's lock is not removed by a release that is not its own
    await writeFile(join(dir, 'hosted.lock'), JSON.stringify({ pid: 1, startedAt: 'x' }));
    await c.release();
    expect(JSON.parse(await readFile(join(dir, 'hosted.lock'), 'utf8'))).toEqual({ pid: 1, startedAt: 'x' });
  });
});
