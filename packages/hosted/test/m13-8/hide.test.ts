/**
 * M13-8: the operator's admin command that hides a table from the lobby (design 4.2): the command file's records, what it hides and lifts, a file that
 * cannot be read, a file that is too big, the reader on a timer, and the whole thing against the real lobby browser. Real temporary files (no network, no
 * socket); every time is a fixed number.
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HIDE_TTL_MS, LobbyBrowser } from '../../src/lobby';
import {
  appendHide, effectiveHides, HIDE_FILE, HIDE_FILE_READ_MAX, hideFileOf, HideList, hideTable, parseHideRecords, unhideTable, type HideRecord,
} from '../../src/moderation';
import { MemoryLogger } from '../../src/obs';
import { ids, listings, lobbyGateway } from './helpers';
import { createTable, guest } from '../m13-6/harness';

const T = 1_800_000_000_000;
const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'm13-8-hide-'));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const rec = (op: HideRecord['op'], table: string, at = T): string => `${JSON.stringify({ op, table, at })}\n`;

describe('M13-8 the command file: records', () => {
  it('hideTable and unhideTable append one JSON line each to hidden-tables.jsonl in DATA_DIR, which is made when it is not there', async () => {
    const dir = join(await tmp(), 'data', 'deeper');
    expect(hideFileOf(dir)).toBe(join(dir, HIDE_FILE));
    expect(HIDE_FILE).toBe('hidden-tables.jsonl');
    expect(await hideTable(dir, '01JABCDEFGHJKMNPQRSTVWXYZ0', T)).toEqual({ op: 'hide', table: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: T });
    expect(await unhideTable(dir, '01JABCDEFGHJKMNPQRSTVWXYZ0', T + 5)).toEqual({ op: 'unhide', table: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: T + 5 });
    await hideTable(dir, 'T002', T + 9);
    const lines = (await readFile(hideFileOf(dir), 'utf8')).split('\n');
    expect(lines.map((l) => (l ? JSON.parse(l) : null))).toEqual([
      { op: 'hide', table: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: T }, { op: 'unhide', table: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: T + 5 }, { op: 'hide', table: 'T002', at: T + 9 }, null,
    ]);
  });

  it('a table id that is not one is refused before anything is written: a path, a space, a line break, too long, empty, not text', async () => {
    const dir = await tmp();
    for (const bad of ['', '../../etc/passwd', 'a b', 'a\nb', 'x'.repeat(65), 'table/1', 'ta\u0000ble', '日本', null, undefined, 42, {}]) {
      await expect(appendHide(hideFileOf(dir), 'hide', bad as string, T), JSON.stringify(bad)).rejects.toBeInstanceOf(RangeError);
    }
    await expect(readFile(hideFileOf(dir), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(appendHide(hideFileOf(dir), 'hide', 'x'.repeat(64), T)).resolves.toMatchObject({ table: 'x'.repeat(64) });
  });

  it('parseHideRecords keeps the records in order and counts the lines that are not records', () => {
    const text = [
      rec('hide', 'A').trim(), '', '   ', 'not json', '{"op":"hide"}', JSON.stringify({ op: 'ban', table: 'B', at: T }), JSON.stringify({ op: 'hide', table: '../x', at: T }),
      JSON.stringify({ op: 'hide', table: 'C', at: 'now' }), JSON.stringify({ op: 'hide', table: 'D', at: null }), '[]', 'null', '42', '"hide"',
      JSON.stringify({ op: 'unhide', table: 'A', at: T + 1, extra: 'ignored' }), `${rec('hide', 'E', T + 2).trim()}\r`,
    ].join('\n');
    const r = parseHideRecords(text);
    expect(r.records).toEqual([{ op: 'hide', table: 'A', at: T }, { op: 'unhide', table: 'A', at: T + 1 }, { op: 'hide', table: 'E', at: T + 2 }]);
    expect(r.skipped).toBe(10);
    expect(parseHideRecords('')).toEqual({ records: [], skipped: 0 });
  });

  it('a table\'s last command decides, and a hide lasts 24 hours', () => {
    const records: HideRecord[] = [
      { op: 'hide', table: 'A', at: T }, { op: 'hide', table: 'B', at: T }, { op: 'unhide', table: 'B', at: T + 1 }, { op: 'unhide', table: 'C', at: T },
      { op: 'hide', table: 'C', at: T + 2 }, { op: 'hide', table: 'D', at: T }, { op: 'hide', table: 'D', at: T + 10 },
    ];
    expect([...effectiveHides(records, T + 100)]).toEqual([['A', T], ['C', T + 2], ['D', T + 10]]);
    expect([...effectiveHides(records, T + HIDE_TTL_MS - 1).keys()]).toEqual(['A', 'C', 'D']);
    expect([...effectiveHides(records, T + HIDE_TTL_MS).keys()]).toEqual(['C', 'D']);
    expect([...effectiveHides(records, T + HIDE_TTL_MS + 10).keys()]).toEqual([]);
  });
});

describe('M13-8 the reader: HideList keeps the lobby\'s hidden set equal to the file', () => {
  function rig(file: string, over: Partial<ConstructorParameters<typeof HideList>[0]> = {}) {
    const logger = new MemoryLogger();
    const lobby = new LobbyBrowser({ now: () => T, logger });
    for (const l of listings(4)) lobby.changed(l.table, l);
    const list = new HideList({ file, lobby, now: () => T + 1_000, logger, ...over });
    const shown = () => ids(lobby.browse({ t: 'browse', id: 1, filter: {}, sort: 'newest', page: 0 }, T).tables);
    return { lobby, list, logger, shown };
  }

  it('no file: nothing is hidden; a hide shows after the next poll; an unhide lifts it; a poll with no change reads nothing again', async () => {
    const dir = await tmp();
    const { list, shown, logger } = rig(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T002', 'T001']);
    await hideTable(dir, 'T003', T);
    await list.poll();
    expect(shown()).toEqual(['T004', 'T002', 'T001']);
    await list.poll();
    await list.poll();
    expect(logger.lines.filter((l) => l.includes('"tableHidden"'))).toHaveLength(1);
    await hideTable(dir, 'T001', T + 1);
    await list.poll();
    expect(shown()).toEqual(['T004', 'T002']);
    await unhideTable(dir, 'T003', T + 2);
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T002']);
  });

  it('what the file already said when the server started applies at the first poll, for a table that is listed later too', async () => {
    const dir = await tmp();
    await mkdir(dir, { recursive: true });
    await writeFile(hideFileOf(dir), rec('hide', 'T002') + rec('hide', 'LATER'), 'utf8');
    const { list, lobby, shown } = rig(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    lobby.changed('LATER', { ...listings(1)[0]!, table: 'LATER' });
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
  });

  it('a hide older than 24 hours is not applied; a deleted file lifts every hide', async () => {
    const dir = await tmp();
    await mkdir(dir, { recursive: true });
    await writeFile(hideFileOf(dir), rec('hide', 'T001', T - HIDE_TTL_MS - 1) + rec('hide', 'T002', T), 'utf8');
    const { list, shown } = rig(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    await rm(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T002', 'T001']);
  });

  it('lines that are not records are skipped and counted in the log; the records around them apply', async () => {
    const dir = await tmp();
    await mkdir(dir, { recursive: true });
    await writeFile(hideFileOf(dir), `garbage\n${rec('hide', 'T002')}{"op":"hide","table":"../x","at":1}\n${rec('hide', 'T003')}`, 'utf8');
    const { list, shown, logger } = rig(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T001']);
    expect(logger.entries().find((e) => e['event'] === 'hideFileSkipped')).toMatchObject({ lines: 2, level: 'warn' });
    expect(logger.lines.join('\n')).not.toContain('garbage');
  });

  it('a file that cannot be read is logged by its reason code and keeps what was applied; the next poll tries again', async () => {
    const dir = await tmp();
    await hideTable(dir, 'T002', T);
    const { list, shown, logger } = rig(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    await rm(hideFileOf(dir));
    await mkdir(hideFileOf(dir)); // a directory where the file should be
    await list.poll();
    expect(logger.entries().find((e) => e['event'] === 'hideFileError')).toMatchObject({ level: 'error', error: expect.stringMatching(/^E[A-Z]+$/) });
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    await rm(hideFileOf(dir), { recursive: true });
    await hideTable(dir, 'T004', T);
    await list.poll();
    expect(shown()).toEqual(['T003', 'T002', 'T001']);
  });

  it('only the end of a big file is read (the last 1 MiB, from a whole line); a command in it still applies', async () => {
    const dir = await tmp();
    await mkdir(dir, { recursive: true });
    const filler = `${'x'.repeat(99)}\n`.repeat(Math.ceil((HIDE_FILE_READ_MAX + 5_000) / 100));
    await writeFile(hideFileOf(dir), `${rec('hide', 'T001')}${filler}${rec('hide', 'T002')}`, 'utf8');
    const { list, shown, logger } = rig(hideFileOf(dir));
    await list.poll();
    // T001's command is beyond the read; T002's is in it
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    // what is read is the last 1 MiB from the first whole line in it: every one of those lines but the last (T002's) is filler that is not a record
    const text = await readFile(hideFileOf(dir), 'utf8');
    const end = text.slice(text.length - HIDE_FILE_READ_MAX);
    const whole = end.slice(end.indexOf('\n') + 1).split('\n').filter((line) => line !== '');
    expect(whole.at(-1)).toContain('T002');
    expect(logger.entries().find((e) => e['event'] === 'hideFileSkipped')).toMatchObject({ lines: whole.length - 1 });
  });

  it('a read window that starts exactly at a line keeps that line (M13-8 review, finding 5)', async () => {
    const dir = await tmp();
    await mkdir(dir, { recursive: true });
    const line = (text: string) => `${text.padEnd(127, ' ')}\n`; // 128 bytes a line: JSON with trailing spaces is still a record
    const lines = HIDE_FILE_READ_MAX / 128;
    // one line more than the window: the window starts at the second line, which is T002's hide
    const text = line('first, outside the window') + line(rec('hide', 'T002').trim()) + line('filler').repeat(lines - 1);
    expect(Buffer.byteLength(text)).toBe(HIDE_FILE_READ_MAX + 128);
    await writeFile(hideFileOf(dir), text, 'utf8');
    const { list, shown } = rig(hideFileOf(dir));
    await list.poll();
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
  });

  it('the same read error again is logged once, not every poll; a new error or a good read in between logs again (M13-8 review, finding 7)', async () => {
    const dir = await tmp();
    await mkdir(hideFileOf(dir), { recursive: true }); // a directory where the file should be
    const { list, logger } = rig(hideFileOf(dir));
    for (let i = 0; i < 5; i++) await list.poll();
    expect(logger.entries().filter((e) => e['event'] === 'hideFileError')).toHaveLength(1);
    await rm(hideFileOf(dir), { recursive: true });
    await hideTable(dir, 'T001', T);
    await list.poll();
    await rm(hideFileOf(dir));
    await mkdir(hideFileOf(dir));
    await list.poll();
    expect(logger.entries().filter((e) => e['event'] === 'hideFileError')).toHaveLength(2);
  });

  it('start resolves once the first read is applied, so the server can wait for it before it listens (M13-8 review, finding 7)', async () => {
    const dir = await tmp();
    await hideTable(dir, 'T002', T);
    const { list, shown } = rig(hideFileOf(dir), { pollMs: 60_000 });
    await list.start();
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    list.stop();
  });

  it('overlapping polls are one: a poll that finds another running does nothing', async () => {
    const dir = await tmp();
    await hideTable(dir, 'T002', T);
    const { list, shown, logger } = rig(hideFileOf(dir));
    await Promise.all([list.poll(), list.poll(), list.poll()]);
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    expect(logger.lines.filter((l) => l.includes('"tableHidden"'))).toHaveLength(1);
  });

  it('start polls at once and on a timer; stop ends it', async () => {
    const dir = await tmp();
    const { list, shown } = rig(hideFileOf(dir), { pollMs: 20 });
    list.start();
    list.start();
    await hideTable(dir, 'T002', T);
    for (let i = 0; i < 100 && shown().includes('T002'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
    list.stop();
    list.stop();
    await appendFile(hideFileOf(dir), rec('hide', 'T003', T));
    await new Promise((r) => setTimeout(r, 120));
    expect(shown()).toEqual(['T004', 'T003', 'T001']);
  });
});

describe('M13-8 the admin hide against the real gateway: the table goes on, only the lobby stops showing it', () => {
  it('a hidden table is not browsed, cannot be found by a new browser, and still starts its game with the people at it', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const viewer = await guest(t, 'Viewer');
    const { table } = await createTable(a, { title: 'Questionable title' });
    expect((await viewer.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 })).ok).toBe(true);
    expect(t.lobby.hide(table)).toBe(true);
    t.clock.advance(1_000);
    const r = await viewer.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
    expect(r).toMatchObject({ ok: true, total: 0, tables: [] });
    expect(t.gateway.tables.has(table)).toBe(true);
    expect(a.last('table')!.table).toMatchObject({ title: 'Questionable title', status: 'lobby' });
    // the table is still the creator's: other players that were told its id before can still sit down (hide is not close)
    t.clock.advance(1_000);
    const friend = await guest(t, 'Friend');
    expect((await friend.cmd({ t: 'join', table, deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] } })).ok).toBe(true);
  });
});
