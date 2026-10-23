/**
 * M13-8: the services as main.ts wires them (`startHosted`, without a network: the gateway is driven through the in-process transport): the lobby browser
 * is the gateway's `lobby` service and its listing sink (a restart's restored tables included), passwords are the scrypt hook, names and titles go
 * through the word filter on `MODERATION_WORDS_FILE`'s list (a list that cannot be read stops the start), and the admin hide command's file in DATA_DIR
 * reaches the running server. The real runtime and timers; normal traffic only.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_PROTOCOL } from '../../src/api';
import { InProcessTransport } from '../../src/gateway/in-process';
import { startHosted, type HostedServer } from '../../src/main';
import { hideTable, unhideTable } from '../../src/moderation';
import { MemoryLogger } from '../../src/obs';
import { MemoryStore } from '../../src/store';
import { Browser, createTable, FIXTURE_CARDS, freshPeer, guest, RIG_SECRET, TEST_DECK } from '../m13-6/harness';

const open: HostedServer[] = [];
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'm13-8-wired-'));
  dirs.push(d);
  return d;
}

async function start(env: Record<string, string> = {}, o: { store?: MemoryStore; logger?: MemoryLogger } = {}): Promise<{ server: HostedServer; rig: { transport: InProcessTransport } }> {
  const server = await startHosted({
    env: { STORE: 'memory', WORKERS: '1', LEDGER_SECRET: RIG_SECRET, ...env },
    listenPort: null,
    metricsListenPort: null,
    cards: { module: FIXTURE_CARDS },
    engineBuild: 'build-test',
    logger: o.logger ?? new MemoryLogger(),
    ...(o.store ? { store: o.store } : {}),
  });
  open.push(server);
  return { server, rig: { transport: new InProcessTransport(server.gateway) } };
}

afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('M13-8 the process wires the lobby, passwords and moderation', () => {
  it('browse, watchLobby, a password table and the word filter all work on a started server (none is answered notYet)', async () => {
    const { server, rig } = await start();
    const alice = await guest(rig, 'Alice');
    const bob = await guest(rig, 'Bob');
    const watcher = await guest(rig, 'Watcher');
    expect(await alice.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 })).toMatchObject({ ok: true, total: 0, tables: [] });
    expect(await watcher.cmd({ t: 'watchLobby', filter: { locked: true } })).toMatchObject({ ok: true });
    // a password table: the default scrypt settings, for real
    const { table } = await createTable(alice, { title: 'Grape juice commander', password: 'tangerine-8841' });
    expect(await bob.cmd({ t: 'browse', filter: { locked: true }, sort: 'newest', page: 0 })).toMatchObject({ ok: true, total: 1, tables: [{ table, title: 'Grape juice commander', locked: true, creator: 'Alice' }] });
    expect(server.lobby.stats()).toMatchObject({ visible: 1, watchers: 1 });
    // the batch reaches the watcher on the lobby's own timer
    await watcher.client.until(() => watcher.of('lobbyUpdate').length > 0, 5_000);
    expect(watcher.of('lobbyUpdate')[0]).toMatchObject({ added: [{ table, locked: true }], changed: [], removed: [] });
    expect(await bob.cmd({ t: 'join', table, password: 'tangerine-8842', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badPassword' } });
    // the word filter on titles and names
    const carol = await guest(rig, 'Carol');
    expect(await carol.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title: 'f.u.c.k club', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    const rude = Browser.connect(rig.transport, { peer: freshPeer() });
    rude.client.send({ t: 'hello', protocol: 1, name: 'B1tch' });
    await rude.client.until(() => rude.client.closed !== null);
    expect(rude.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
  }, 60_000);

  it('the real scrypt hook sits a joiner down (the default settings)', async () => {
    const { rig } = await start();
    const alice = await guest(rig, 'Alice');
    const bob = await guest(rig, 'Bob');
    const { table } = await createTable(alice, { password: 'tangerine-8841' });
    expect(await bob.cmd({ t: 'join', table, password: 'tangerine-8841', deck: TEST_DECK })).toMatchObject({ ok: true, table });
  }, 60_000);

  it('the lobby is in step from the start: tables a restart restores are listed at once, and drain empties the list', async () => {
    const store = new MemoryStore();
    const first = await start({}, { store });
    const a = await guest(first.rig, 'Alice');
    const { table } = await createTable(a, { title: 'Survives a restart' });
    await first.server.close();
    open.splice(open.indexOf(first.server), 1);
    const second = await start({}, { store });
    const viewer = await guest(second.rig, 'Viewer');
    expect(await viewer.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 })).toMatchObject({ ok: true, total: 1, tables: [{ table, title: 'Survives a restart', filled: 1 }] });
    expect(second.server.lobby.stats()).toMatchObject({ visible: 1, held: 1 });
    second.server.gateway.drain();
    expect(second.server.lobby.stats()).toMatchObject({ visible: 0, held: 0 });
  }, 60_000);

  it('the lobby settles against the tables layer by itself (a report that never came is not lost for good)', async () => {
    const { server, rig } = await start();
    const a = await guest(rig, 'Alice');
    const { table } = await createTable(a);
    server.lobby.changed(table, null); // a report that goes wrong: the index forgets a table that is listed
    expect(server.lobby.stats().visible).toBe(0);
    server.lobby.tick(Date.now() + 31_000);
    expect(server.lobby.stats().visible).toBe(1);
  }, 60_000);
});

describe('M13-8 MODERATION_WORDS_FILE', () => {
  it('the list the operator names replaces the built-in one, for titles and for names', async () => {
    const dir = await tmp();
    const file = join(dir, 'words.txt');
    await writeFile(file, '# the operator\'s list\ngoblin\n', 'utf8');
    const { rig } = await start({ MODERATION_WORDS_FILE: file });
    const a = await guest(rig, 'Alice');
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title: 'G.o.b.l.i.n night', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    // the built-in words are not on this list
    const b = await guest(rig, 'Bob');
    expect(await b.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', title: 'Fuck this', deck: TEST_DECK })).toMatchObject({ ok: true });
    const gob = Browser.connect(rig.transport, { peer: freshPeer() });
    gob.client.send({ t: 'hello', protocol: 1, name: 'Hobgoblin' });
    await gob.client.until(() => gob.client.closed !== null);
    expect(gob.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
  }, 60_000);

  it('a file that is named and cannot be read stops the start before anything runs, with the path and the reason in the message', async () => {
    const dir = await tmp();
    const missing = join(dir, 'missing.txt');
    const logger = new MemoryLogger();
    const err = await startHosted({ env: { STORE: 'memory', WORKERS: '1', MODERATION_WORDS_FILE: missing }, listenPort: null, cards: { module: FIXTURE_CARDS }, logger }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(`MODERATION_WORDS_FILE: cannot use ${missing} (ENOENT).`);
    expect(logger.lines.join('\n')).not.toContain('"listening"');
  });
});

describe('M13-8 the admin hide command reaches the running server through DATA_DIR', () => {
  it('a line in hidden-tables.jsonl hides the table at the next poll and an unhide lists it again; the table goes on', async () => {
    const dir = await tmp();
    const { server, rig } = await start({ DATA_DIR: dir }, { store: new MemoryStore() });
    expect(server.hidden).not.toBeNull();
    const a = await guest(rig, 'Alice');
    const viewer = await guest(rig, 'Viewer');
    const { table } = await createTable(a, { title: 'Questionable title' });
    const total = async () => {
      const r = await viewer.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
      return r.ok ? r.total : -1;
    };
    expect(await total()).toBe(1);
    await hideTable(dir, table);
    await server.hidden!.poll();
    expect(await total()).toBe(0);
    expect(server.gateway.tables.has(table)).toBe(true);
    await unhideTable(dir, table);
    await server.hidden!.poll();
    expect(await total()).toBe(1);
  }, 60_000);

  it('without a store of its own (memory, as the tests start it) there is no command file to read', async () => {
    const { server } = await start();
    expect(server.hidden).toBeNull();
  }, 60_000);
});
