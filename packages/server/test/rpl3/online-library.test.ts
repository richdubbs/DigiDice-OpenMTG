/**
 * RPL-3 for a page without a library of its own (`library` on host and join): the online bridge keeps the game's replay in the server's library. One
 * host bridge and one guest bridge joined by packages/net's in-memory link, each driven by a fake browser, with a library in memory.
 *
 *  - The host's record goes to the library when the game is over (the status says `saved`), again after a later choice, and leaves the record store
 *    once the game is left.
 *  - The guest's server records what its player was shown (online/guestRecording.ts) and keeps it in the library when the game is over: a recording
 *    whose frames rebuild to the last view; once every player agreed, the game the host shared replaces it, with the recording as its fallback.
 *  - Without `library`, nothing goes to the library (the browser keeps its own).
 *  - At a server's start, what a server that is gone left behind (a guest's recording file, a host's record begun for the library) goes to the library.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CardDatabase } from '@openmtg/cards';
import { checkReplay, readBugReportFile, recordingFrameView, type OracleCard, type PlayerId, type RecordingKeyView, type ReplayFile } from '@openmtg/engine';
import { autoAction, GameGuest, GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, MemoryTransport, prepareDeck } from '@openmtg/net';
import type { ClientMessage, OnlineDeck, OnlineStatus, ServerMessage } from '../../src/online/api';
import { OnlineBridge, type ClientHandle, type ClientPort } from '../../src/online/bridge';
import { finishLeftRecordings, GuestRecording, type OnlineLibrary } from '../../src/online/guestRecording';
import { TableService } from '../../src/table/socket';
import { FakeClient, TOKEN } from '../table/helpers';
import { parseClientMessage } from '../../src/online/messages';
import { OnlineReplayStore } from '../../src/online/replays';
import { OnlineService } from '../../src/online/socket';

const FAST_LINK = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 50, idleTimeout: 400 };
const APP = { version: '9.9.9', commit: null };
/** A process id no process has. */
const GONE_PID = 2147483646;

let db: CardDatabase | undefined;
function fixtureDb(): CardDatabase {
  if (!db) {
    const data = JSON.parse(readFileSync(new URL('../../../engine/test/fixtures/cards.json', import.meta.url), 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
    db = CardDatabase.fromCards(data.cards, { tokens: data.tokens ?? [] });
  }
  return db;
}

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });
const HANA = deck({ Forest: 16, 'Grizzly Bears': 24 });
const GUS = deck({ Mountain: 16, 'Raging Goblin': 12, 'Hill Giant': 12 });

async function until(cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 3));
  }
}

type Reply = Extract<ServerMessage, { t: 'reply' }>;
type ViewMsg = Extract<ServerMessage, { t: 'view' }>;
type Cmd = ClientMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

class FakeBrowser implements ClientPort {
  readonly inbox: ServerMessage[] = [];
  readonly handle: ClientHandle;
  private nextId = 1;

  constructor(bridge: OnlineBridge) {
    this.handle = bridge.attach(this);
  }

  send(m: ServerMessage): void {
    this.inbox.push(JSON.parse(JSON.stringify(m)) as ServerMessage);
  }

  close(): void {
    this.handle.closed();
  }

  async cmd(m: Cmd, ms = 5000): Promise<Reply> {
    const id = this.nextId++;
    this.handle.message(JSON.stringify({ ...m, id }));
    let reply: Reply | undefined;
    await until(() => (reply = this.inbox.find((x): x is Reply => x.t === 'reply' && x.id === id)) !== undefined, ms, `the reply to ${m.t}`);
    return reply!;
  }

  get status(): OnlineStatus | undefined {
    return [...this.inbox].reverse().find((x): x is Extract<ServerMessage, { t: 'status' }> => x.t === 'status')?.status;
  }

  get last(): ViewMsg | undefined {
    return [...this.inbox].reverse().find((x): x is ViewMsg => x.t === 'view');
  }
}

/** A library in memory: the files by id, and how often each was written. */
class MemoryLibrary implements OnlineLibrary {
  readonly files = new Map<string, ReplayFile>();
  readonly writes = new Map<string, number>();
  async add(file: ReplayFile): Promise<void> {
    const checked = checkReplay(JSON.parse(JSON.stringify(file)));
    if (!checked.ok) throw new Error(`not a replay file: ${checked.error.message}`);
    this.files.set(file.id, checked.value);
    this.writes.set(file.id, (this.writes.get(file.id) ?? 0) + 1);
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

beforeAll(async () => {
  for (const d of [HANA, GUS]) {
    const r = await prepareDeck(d, { cards: fixtureDb(), format: 'casual' });
    if (!r.ok) throw new Error(`the test deck does not prepare: ${JSON.stringify(r)}`);
  }
}, 60_000);

const tempDir = (tag: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), `openmtg-rpl3-${tag}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

interface Side { me: PlayerId; browser: FakeBrowser; bridge: OnlineBridge; library: MemoryLibrary }
interface Game { host: Side; guest: Side; games: { host?: GameHost }; store: OnlineReplayStore; dir: string; guestDir: string }

/** A two-player game, both browsers asking for the library when `library`. */
async function game(tag: string, library: boolean): Promise<Game> {
  const dir = tempDir(`${tag}-host`);
  const guestDir = tempDir(`${tag}-guest`);
  const store = new OnlineReplayStore(dir);
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const games: Game['games'] = {};
  const hostLibrary = new MemoryLibrary();
  const hostBridge = new OnlineBridge({
    cards: async () => fixtureDb(), link: FAST_LINK, replays: store, app: APP, library: hostLibrary,
    backends: {
      startHost: async (h) => (games.host = await GameHost.attach({ ...h, seed: `rpl3-library-${tag}`, gameOptions: { skipMulligans: true, startingLife: 4 } as never }, transport)),
      joinGuest: () => Promise.reject(new Error('the host bridge only hosts')),
    },
  });
  cleanups.push(() => hostBridge.close());
  const host: Side = { me: 'p1', browser: new FakeBrowser(hostBridge), bridge: hostBridge, library: hostLibrary };
  expect(await host.browser.cmd({ t: 'host', name: 'Hana', deck: HANA, port: 0, ...(library ? { library: true as const } : {}) })).toMatchObject({ ok: true });
  const guestLibrary = new MemoryLibrary();
  const guestBridge = new OnlineBridge({
    cards: () => Promise.reject(new Error('no card data')), link: FAST_LINK, app: APP, library: guestLibrary, guestRecordings: guestDir,
    backends: {
      startHost: () => Promise.reject(new Error('guests only join')),
      joinGuest: (g) => GameGuest.join({ ...g, connector: (x) => transport.connect(x.link, x.code) }),
    },
  });
  cleanups.push(() => guestBridge.close());
  const guest: Side = { me: 'p2', browser: new FakeBrowser(guestBridge), bridge: guestBridge, library: guestLibrary };
  const code = host.browser.status!.code!;
  expect(await guest.browser.cmd({ t: 'join', address: '203.0.113.5:47620', code, name: 'Gus', deck: GUS, ...(library ? { library: true as const } : {}) })).toMatchObject({ ok: true });
  await until(() => host.browser.last !== undefined && guest.browser.last !== undefined, 5000, 'the first views');
  return { host, guest, games, store, dir, guestDir };
}

async function play(sides: Side[], go: () => boolean, ms = 90000): Promise<void> {
  const end = Date.now() + ms;
  while (go()) {
    if (Date.now() > end) throw new Error('the game did not get there');
    let acted = false;
    for (const s of sides) {
      const v = s.browser.last;
      if (!v || v.view.result || (s.browser.status?.phase !== 'playing' && s.browser.status?.phase !== 'over')) continue;
      const a = autoAction(v.view, v.legal as never, s.me);
      if (!a) continue;
      acted = true;
      await s.browser.cmd({ t: 'act', action: a }, 10000);
    }
    if (!acted) await new Promise((r) => setTimeout(r, 3));
  }
}

/** A recording's frames rebuilt as playback does: every one fits, and the last view. */
function lastViewOf(file: ReplayFile): RecordingKeyView {
  const rec = file.recording!;
  let v: RecordingKeyView | null = null;
  for (const f of rec.frames) {
    const r = recordingFrameView(v, f, { viewer: rec.viewer, defs: rec.defs });
    if (!r.ok) throw new Error(r.error.message);
    v = r.value;
  }
  return v!;
}

describe('RPL-3: `library` on host and join', () => {
  it('is a flag of host and join, true or left out', () => {
    const d = { main: [{ name: 'Forest', count: 40 }], sideboard: [] };
    expect(parseClientMessage(JSON.stringify({ t: 'host', id: 1, name: 'Hana', deck: d, library: true }))).toMatchObject({ ok: true, message: { library: true } });
    expect(parseClientMessage(JSON.stringify({ t: 'join', id: 2, name: 'Gus', deck: d, address: '203.0.113.5:47620', code: '7KQ2-M9XD-4TRB-HC8P', library: true })))
      .toMatchObject({ ok: true, message: { library: true } });
    const off = parseClientMessage(JSON.stringify({ t: 'host', id: 3, name: 'Hana', deck: d, library: false }));
    expect(off.ok && 'library' in off.message).toBe(false);
  });

  it('the host\'s record and the guest\'s recording go to their servers\' libraries at the end; the shared game replaces the recording; both go from disk once left', async () => {
    const g = await game('both', true);
    const hostId = g.games.host!.replayId;
    const guestId = g.guest.browser.status!.replay!.id;
    expect(readdirSync(g.guestDir)).toEqual([`${guestId}.jsonl`]);
    expect(await g.guest.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await play([g.host, g.guest], () => !g.games.host?.state?.result);
    await until(() => g.host.browser.status?.replay?.saved === true && g.guest.browser.status?.replay?.saved === true, 5000, 'both saved');

    // The host: its record as a game replay, in its own library under the record's id.
    const hostFile = g.host.library.files.get(hostId)!;
    expect(hostFile).toMatchObject({ id: hostId, kind: 'game', game: { mode: 'onlineHost', savedBy: 'p1', actions: g.games.host!.seq }, reveal: { policy: 'own', agreed: ['p2'] } });
    // The guest: what it was shown, as a recording whose last view has the result.
    const recording = g.guest.library.files.get(guestId)!;
    expect(recording).toMatchObject({ id: guestId, kind: 'recording', game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { agreed: ['p2'] } });
    expect(recording.game.players.map((p) => p.name).sort()).toEqual(['Gus', 'Hana']);
    expect(recording.recording!.viewer).toBe('p2');
    expect(lastViewOf(recording).result).toEqual(g.games.host!.state!.result);
    expect(recording.game.result?.winner).toBe(g.games.host!.state!.result!.winner);
    expect(JSON.stringify(recording).includes('rpl3-library-both')).toBe(false); // no seed: only what the guest was shown (CR 400.2)

    // The host agrees after the end: its library copy follows; the host shares the game, which replaces the guest's recording.
    expect(await g.host.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await until(() => g.guest.library.files.get(guestId)?.kind === 'game', 5000, 'the shared game in the guest\'s library');
    await until(() => g.host.library.files.get(hostId)?.reveal.policy === 'all', 5000, 'the host\'s copy with every choice');
    const shared = g.guest.library.files.get(guestId)!;
    expect(shared).toMatchObject({ id: guestId, kind: 'game', app: APP, game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { policy: 'all' } });
    expect(shared.play!.actions).toHaveLength(g.games.host!.seq);
    expect(shared.recording!.frames.length).toBe(recording.recording!.frames.length); // the recording stays, as its fallback
    expect(readdirSync(g.guestDir)).toEqual([]); // final: its file goes

    // Both leave: the host's record leaves the store; nothing is left on disk.
    expect(await g.guest.browser.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(await g.host.browser.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    await until(() => readdirSync(g.dir).length === 0, 3000, 'the host\'s record to go');
    expect(g.host.library.files.get(hostId)?.reveal.policy).toBe('all');
    expect(g.guest.library.files.get(guestId)?.kind).toBe('game');
  });

  it('a guest who leaves a game in progress keeps its recording as conceded, and its file goes', async () => {
    const g = await game('leave', true);
    const guestId = g.guest.browser.status!.replay!.id;
    await play([g.host, g.guest], () => (g.games.host?.seq ?? 0) < 10);
    expect(await g.guest.browser.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    await until(() => g.guest.library.files.has(guestId), 3000, 'the recording');
    const file = g.guest.library.files.get(guestId)!;
    expect(file).toMatchObject({ kind: 'recording', game: { mode: 'onlineGuest', ended: 'conceded' } });
    expect(lastViewOf(file).players.find((p) => p.id === 'p2')?.conceded).toBe(true);
    expect(readdirSync(g.guestDir)).toEqual([]);
    // The host's game ended with the concession: its record is kept too, and leaves the store once the host leaves.
    await until(() => g.host.library.files.size === 1, 3000, 'the host\'s copy');
    expect(await g.host.browser.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    await until(() => readdirSync(g.dir).length === 0, 3000, 'the host\'s record to go');
  });

  it('without `library` nothing goes to the library: the browser keeps its own (the record stays for its page)', async () => {
    const g = await game('none', false);
    const hostId = g.games.host!.replayId;
    await play([g.host, g.guest], () => !g.games.host?.state?.result);
    await until(() => g.host.browser.status?.phase === 'over' && g.guest.browser.status?.phase === 'over', 5000, 'game over');
    await new Promise((r) => setTimeout(r, 100));
    expect(g.host.library.files.size + g.guest.library.files.size).toBe(0);
    expect(g.host.browser.status!.replay!.saved).toBeUndefined();
    expect(readdirSync(g.guestDir)).toEqual([]);
    expect(await g.host.browser.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(readdirSync(g.dir)).toEqual([hostId]);
  });

  it('at a start, what a server that is gone left goes to the library: a guest\'s recording file and a host\'s record begun for it; a live server\'s stays', async () => {
    // A guest's recording written as it went, by a server that then stopped (a crash: no close).
    const guestDir = tempDir('left-guest');
    const g = await game('left', true);
    await play([g.host, g.guest], () => (g.games.host?.seq ?? 0) < 8);
    const id = 'r-' + 'a'.repeat(20);
    const left = new GuestRecording({ dir: guestDir, id, me: 'p2', format: 'casual', app: APP, library: new MemoryLibrary() });
    const views = g.guest.browser.inbox.filter((m): m is ViewMsg => m.t === 'view');
    for (const v of views) left.shown(v.seq, v.view as never, v.events as never);
    const file = path.join(guestDir, `${id}.jsonl`);
    const rows = readFileSync(file, 'utf8').trim().split('\n');
    expect(rows.length).toBeGreaterThan(2);
    // Written by another server (its last line torn): while that server runs, it stays; once it is gone, it goes to the library, abandoned at its last view.
    writeFileSync(file, rows.map((r, i) => (i === 0 ? JSON.stringify({ ...JSON.parse(r), owner: { pid: GONE_PID, host: JSON.parse(r).owner.host } }) : r)).join('\n') + '\n{"t":"fra');
    const library = new MemoryLibrary();
    expect(await finishLeftRecordings(guestDir, library, () => true)).toBe(0);
    expect(readdirSync(guestDir)).toEqual([`${id}.jsonl`]);
    expect(await finishLeftRecordings(guestDir, library, () => false)).toBe(1);
    expect(readdirSync(guestDir)).toEqual([]);
    const kept = library.files.get(id)!;
    expect(kept).toMatchObject({ kind: 'recording', game: { mode: 'onlineGuest', ended: 'abandoned', result: null, actions: views.at(-1)!.seq } });
    expect(kept.recording!.frames).toHaveLength(new Set(views.map((v) => v.seq)).size);

    // A host's record begun for the library by a server that is gone: the next server's start keeps it as abandoned and removes it.
    const hostDir = tempDir('left-host');
    const before = new OnlineReplayStore(hostDir);
    const hostId = g.games.host!.replayId;
    const record = g.store.read(hostId)!;
    before.begin({ ...record.start }, [], true);
    for (const [i, action] of record.actions.entries()) before.append(hostId, { i, t: record.times[i]!, action } as never);
    const owner = path.join(hostDir, hostId, 'owner.json');
    writeFileSync(owner, JSON.stringify({ ...JSON.parse(readFileSync(owner, 'utf8')), pid: GONE_PID }));
    // One not begun for the library stays for its page.
    const other = { ...record.start, id: 'r-' + 'b'.repeat(20) };
    before.begin(other);
    writeFileSync(path.join(hostDir, other.id, 'owner.json'), JSON.stringify({ ...JSON.parse(readFileSync(path.join(hostDir, other.id, 'owner.json'), 'utf8')), pid: GONE_PID }));
    const hostLibrary = new MemoryLibrary();
    const service = new OnlineService(async () => fixtureDb(), { replaysDir: hostDir, app: APP, library: hostLibrary, guestRecordingsDir: tempDir('none') });
    cleanups.push(() => service.close());
    await service.left;
    expect(hostLibrary.files.get(hostId)).toMatchObject({ kind: 'game', game: { mode: 'onlineHost', ended: 'abandoned', actions: record.actions.length } });
    expect(readdirSync(hostDir)).toEqual([other.id]);
  });

  it('Report a bug during an online game (ONLINE_TABLE on the table channel): the guest\'s recording so far, the host\'s view on screen', async () => {
    const g = await game('bug', true);
    await play([g.host, g.guest], () => (g.games.host?.seq ?? 0) < 8);
    const environment = {
      app: { version: '2.0.0', commit: null }, browser: { userAgent: 'OpenMTG test', language: 'en', screen: 'window 1600x900' },
      settings: { animationSpeed: 'normal', reducedMotion: false }, errors: [],
    };
    for (const [side, holds] of [[g.guest, 'recording'], [g.host, 'view']] as const) {
      const service = new TableService({ token: TOKEN, version: '9', onlineCapture: (app) => side.bridge.bugCapture(app) });
      try {
        const c = new FakeClient(service);
        await c.hello();
        c.send({ t: 'bugReport', table: 'online', id: 1, words: 'Too early.', environment });
        expect((await c.next('bugReportFile', (m) => m.id === 1)).error).toContain('Open the report again');
        c.send({ t: 'bugCapture', table: 'online', id: 2 });
        const captured = await c.next('bugCaptured', (m) => m.id === 2);
        expect(captured).toMatchObject({ table: 'online', holds, kind: 'recording' });
        c.send({ t: 'bugReport', table: 'online', id: 3, words: 'The goblin did not attack.', environment });
        const file = await c.next('bugReportFile', (m) => m.id === 3);
        const read = await readBugReportFile(new Uint8Array(Buffer.from(file.data!, 'base64')));
        expect(read.ok).toBe(true);
        if (read.ok) {
          expect(read.value.replay.recording!.viewer).toBe(side.me);
          expect(read.value.replay.game.mode).toBe(side === g.host ? 'onlineHost' : 'onlineGuest');
          expect(JSON.stringify(read.value).includes('rpl3-library-bug')).toBe(false); // never the seed: only what this player saw
        }
      } finally {
        await service.close();
      }
    }
    // No online game: the report says so.
    const service = new TableService({ token: TOKEN, version: '9', onlineCapture: () => null });
    try {
      const c = new FakeClient(service);
      await c.hello();
      c.send({ t: 'bugCapture', table: 'online', id: 1 });
      expect((await c.next('bugCaptured', (m) => m.id === 1)).error).toBe('There is no online game to report on.');
    } finally {
      await service.close();
    }
  });
});
