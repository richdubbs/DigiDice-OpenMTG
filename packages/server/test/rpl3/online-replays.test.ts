/**
 * RPL-3 (replays design 6, 7.2, 16.3): the online bridge's replays, in process: one host bridge and its guests' bridges joined by packages/net's
 * in-memory link (no sockets; normal traffic only), each driven by a fake browser that sends api.ts's messages as JSON text, with 2, 3 and 4 players.
 *
 *  - Each browser's "Show my cards in replays" (`replayConsent`, default off) and the status's `replay` (the id, this player's choice, the host's list of
 *    who agreed, whether the game was shared).
 *  - No game data reaches a guest's browser without every person's agreement: no `replayGame`, and no message holds the seed.
 *  - When the game is over and every player agreed, every guest's browser gets `replayGame` once, and a new socket gets it again.
 *  - A leaver's last choice counts.
 *  - The host's record in the data directory (online/replays.ts) and the replays API its page reads it through: 409 while the game runs, the replay file
 *    after the end (or as abandoned when the game was left unfinished), removed once the page kept it; a torn record reads up to its last whole line;
 *    a second server on the same data folder leaves the first one's game in progress alone (the record's owner, owner.json).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CardDatabase } from '@openmtg/cards';
import { applyAction, checkReplay, createGame, gameDigest, type GameState, type OracleCard, type PlayerId, type ReplayFile } from '@openmtg/engine';
import {
  autoAction, GameGuest, GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, MemoryTransport, NetError, prepareDeck, REPLAY_GAME_MAX_BYTES as NET_MAX,
} from '@openmtg/net';
import { ONLINE_PROTOCOL, ONLINE_REPLAYS_PATH, REPLAY_GAME_MAX_BYTES, type ClientMessage, type OnlineDeck, type OnlineStatus, type ServerMessage } from '../../src/online/api';
import { OnlineBridge, type ClientHandle, type ClientPort } from '../../src/online/bridge';
import { parseClientMessage } from '../../src/online/messages';
import { KEEP_RECORDS, OnlineReplayStore, replayRequest } from '../../src/online/replays';
import { OnlineService } from '../../src/online/socket';

const FAST_LINK = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 50, idleTimeout: 400 };
const APP = { version: '9.9.9', commit: null };

let db: CardDatabase | undefined;
function fixtureDb(): CardDatabase {
  if (!db) {
    const data = JSON.parse(readFileSync(new URL('../../../engine/test/fixtures/cards.json', import.meta.url), 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
    db = CardDatabase.fromCards(data.cards, { tokens: data.tokens ?? [] });
  }
  return db;
}

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });
const NAMES = ['Hana', 'Gus', 'Bianca', 'Dana'];
const DECKS: Record<string, OnlineDeck> = {
  Hana: deck({ Forest: 16, 'Grizzly Bears': 24 }),
  Gus: deck({ Mountain: 16, 'Raging Goblin': 12, 'Hill Giant': 12 }),
  Bianca: deck({ Plains: 16, 'Elite Vanguard': 24 }),
  Dana: deck({ Forest: 16, 'Runeclaw Bear': 24 }),
};

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

  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.inbox.filter((x): x is Extract<ServerMessage, { t: T }> => x.t === t);
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

// Every deck compiled once before the games: the first join of a fresh worker compiles its cards inside the host's handling of the hello, which on a
// loaded machine can outlast the fast link's idle timeout (FAST_LINK.idleTimeout) and look like a host that never answered.
beforeAll(async () => {
  for (const d of Object.values(DECKS)) {
    const r = await prepareDeck(d, { cards: fixtureDb(), format: 'casual' });
    if (!r.ok) throw new Error(`the test deck does not prepare: ${JSON.stringify(r)}`);
  }
}, 60_000);

interface Side { name: string; me: PlayerId; browser: FakeBrowser; bridge: OnlineBridge }
interface Game { host: Side; guests: Side[]; games: { host?: GameHost }; store: OnlineReplayStore; dir: string; seed: string; transport: MemoryTransport }

/**
 * A host bridge with a record store in a fresh folder, and one bridge per guest; every guest joins (seat 2 first). `beforeJoin`: what happens before
 * each seat's guest joins (the host waiting, the lobby), with the guests seated so far. `cut`: while `on`, a guest's reconnection finds no host (a cut
 * link; it tries again every 50 ms).
 */
async function game(
  seats: 2 | 3 | 4,
  tag: string,
  o: { beforeJoin?: (host: Side, seat: number, guests: Side[]) => Promise<void>; cut?: { on: boolean } } = {},
): Promise<Game> {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OnlineReplayStore(dir);
  const seed = `rpl3-bridge-secret-${tag}-${seats}`;
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const games: Game['games'] = {};
  const hostBridge = new OnlineBridge({
    cards: async () => fixtureDb(), link: FAST_LINK, replays: store, app: APP,
    backends: {
      startHost: async (h) => (games.host = await GameHost.attach({ ...h, seed, gameOptions: { skipMulligans: true, startingLife: 4 } as never }, transport)),
      joinGuest: () => Promise.reject(new Error('the host bridge only hosts')),
    },
  });
  cleanups.push(() => hostBridge.close());
  const host: Side = { name: 'Hana', me: 'p1', browser: new FakeBrowser(hostBridge), bridge: hostBridge };
  expect(await host.browser.cmd({ t: 'host', name: 'Hana', deck: DECKS['Hana']!, port: 0, ...(seats > 2 ? { seats: seats as 3 | 4 } : {}) })).toMatchObject({ ok: true });
  const st = host.browser.status!;
  const codes = st.codes ?? [{ seat: 2, code: st.code! }];
  const guests: Side[] = [];
  for (let seat = 2; seat <= seats; seat++) {
    await o.beforeJoin?.(host, seat, guests);
    const name = NAMES[seat - 1]!;
    const bridge = new OnlineBridge({
      cards: () => Promise.reject(new Error('no card data')), link: FAST_LINK,
      backends: {
        startHost: () => Promise.reject(new Error('guests only join')),
        joinGuest: (g) =>
          GameGuest.join({
            ...g, ...(o.cut ? { reconnect: { attempts: 400, delayMs: 50 } } : {}),
            connector: (x) => (o.cut?.on ? Promise.reject(new NetError('timeout', 'No answer from the host (the link is cut).')) : transport.connect(x.link, x.code)),
          }),
      },
    });
    cleanups.push(() => bridge.close());
    const side: Side = { name, me: `p${seat}`, browser: new FakeBrowser(bridge), bridge };
    const code = codes.find((c) => c.seat === seat)!.code;
    expect(await side.browser.cmd({ t: 'join', address: '203.0.113.5:47620', code, name, deck: DECKS[name]! })).toMatchObject({ ok: true });
    guests.push(side);
  }
  await until(() => [host, ...guests].every((s) => s.browser.last !== undefined), 5000, 'the first views');
  return { host, guests, games, store, dir, seed, transport };
}

/** Every side acts with the automatic player on its latest view while `go()`. */
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

const over = (g: Game) => () => !g.games.host?.state?.result;
const replayGames = (s: Side) => s.browser.of('replayGame');

function decode(data: string): ReplayFile {
  const checked = checkReplay(JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8')));
  if (!checked.ok) throw new Error(checked.error.message);
  return checked.value;
}

function finalOf(file: ReplayFile): GameState {
  let s = createGame(file.play!.config);
  for (const a of file.play!.actions) {
    const r = applyAction(s, a);
    if (r.error) throw new Error(r.error.message);
    s = r.state;
  }
  return s;
}

/** No message any guest's browser got holds the seed or a replay of the game (CR 400.2). */
function expectNothingShared(g: Game): void {
  for (const s of g.guests) {
    expect(replayGames(s), s.me).toEqual([]);
    for (const m of s.browser.inbox) expect(JSON.stringify(m).includes(g.seed), `${s.me} got the seed`).toBe(false);
    expect(s.browser.status?.replay?.shared ?? false).toBe(false);
  }
}

describe('RPL-3: the browser protocol', () => {
  it('online protocol 3, and the browser\'s replayConsent is checked like every command', () => {
    expect(ONLINE_PROTOCOL).toBe(3);
    expect(REPLAY_GAME_MAX_BYTES).toBe(NET_MAX);
    expect(parseClientMessage(JSON.stringify({ t: 'replayConsent', id: 3, agree: true }))).toEqual({ ok: true, message: { t: 'replayConsent', id: 3, agree: true } });
    expect(parseClientMessage(JSON.stringify({ t: 'replayConsent', id: 3, agree: 'yes' }))).toEqual({ ok: false, id: 3, error: 'agree must be true or false' });
    expect(parseClientMessage(JSON.stringify({ t: 'replayConsent', id: 3 }))).toEqual({ ok: false, id: 3, error: 'agree must be true or false' });
    expect(parseClientMessage(JSON.stringify({ t: 'replayConsent', id: 3, agree: true, all: true }))).toEqual({ ok: false, id: 3, error: 'unknown field "all"' });
  });
});

describe('RPL-3: online replays through the bridges (2, 3 and 4 players)', () => {
  for (const seats of [2, 3, 4] as const) {
    it(`${seats} players: every browser chooses; after the end every guest's browser gets the game once, and a new socket gets it again`, async () => {
      const g = await game(seats, 'all');
      const hostId = g.games.host!.replayId;
      expect(g.host.browser.status!.replay).toEqual({ id: hostId, agree: false, agreed: [], shared: false });
      const guestIds = g.guests.map((s) => s.browser.status!.replay!.id);
      for (const s of g.guests) expect(s.browser.status!.replay).toEqual({ id: expect.stringMatching(/^r-[0-9a-f]{20}$/), agree: false, shared: false });
      expect(new Set([hostId, ...guestIds]).size).toBe(seats); // each player's library key of its own

      for (const s of g.guests) {
        expect(await s.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
        expect(s.browser.status!.replay!.agree).toBe(true);
      }
      await until(() => g.host.browser.status!.replay!.agreed!.length === seats - 1, 3000, 'the guests\' choices at the host');
      expect(g.host.browser.status!.replay!.agree).toBe(false);
      await play([g.host, ...g.guests], over(g));
      await until(() => [g.host, ...g.guests].every((s) => s.browser.status?.phase === 'over'), 5000, 'game over everywhere');
      await new Promise((r) => setTimeout(r, 100));
      expectNothingShared(g); // the host has not agreed
      expect(await g.host.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
      await until(() => g.guests.every((s) => replayGames(s).length === 1), 5000, 'every guest\'s copy');
      await until(() => g.host.browser.status!.replay!.shared, 3000, 'the host\'s status');
      expect(g.host.browser.status!.replay).toMatchObject({ id: hostId, agree: true, shared: true });
      const final = g.games.host!.state!;
      for (const s of g.guests) {
        expect(s.browser.status!.replay).toMatchObject({ agree: true, shared: true });
        const file = decode(replayGames(s)[0]!.data);
        expect(file).toMatchObject({ kind: 'game', game: { mode: 'onlineGuest', savedBy: s.me }, reveal: { policy: 'all' } });
        expect(gameDigest(finalOf(file))).toBe(gameDigest(final));
        // A reloaded page (a new socket) gets the status, the last view and the game again.
        const again = new FakeBrowser(s.bridge);
        expect(again.of('replayGame')).toEqual(replayGames(s));
        expect(again.inbox.map((m) => m.t)).toEqual(['status', 'view', 'chatHistory', 'replayGame']);
        s.browser = again;
      }
      // Final: a later choice changes nothing.
      expect(await g.guests[0]!.browser.cmd({ t: 'replayConsent', agree: false })).toMatchObject({ ok: true });
      expect(g.guests[0]!.browser.status!.replay).toMatchObject({ agree: true, shared: true });
    });
  }

  it('2 players: without every person\'s agreement nothing of the game reaches the guest\'s browser, before or after the end', async () => {
    const g = await game(2, 'none');
    expect(await g.host.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await until(() => g.host.browser.status!.replay!.agreed!.length === 1, 3000, 'the host\'s choice');
    expect(g.host.browser.status!.replay).toMatchObject({ agree: true, agreed: ['p1'] });
    await play([g.host, ...g.guests], over(g));
    await new Promise((r) => setTimeout(r, 150));
    expectNothingShared(g);
  });

  it('3 players: a leaver\'s last choice counts: Bianca agrees and leaves; when the others agree, Gus\'s browser gets the game', async () => {
    const g = await game(3, 'leaver');
    const [gus, bianca] = g.guests as [Side, Side];
    expect(await bianca.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await until(() => g.host.browser.status!.replay!.agreed!.includes('p3'), 3000, 'Bianca\'s choice');
    await play([g.host, gus, bianca], () => (g.games.host?.seq ?? 0) < 6);
    expect(await bianca.browser.cmd({ t: 'leave' })).toMatchObject({ ok: true }); // concedes (CR 104.3a); the game goes on for the others
    expect(bianca.browser.status!.phase).toBe('idle');
    for (const s of [g.host, gus]) expect(await s.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await play([g.host, gus], over(g));
    await until(() => replayGames(gus).length === 1, 5000, 'Gus\'s copy');
    expect(decode(replayGames(gus)[0]!.data).reveal.agreed).toHaveLength(3);
    expect(replayGames(bianca)).toEqual([]);
  });
});

/** The start line of a record that is not a game played here (the store's own checks: begin, list, prune). */
const fixtureStart = (i: number) => ({
  version: 1, id: `r-${String(i).padStart(20, '0')}`, startedAt: `2026-10-2${i}T10:00:00.000Z`, startMs: i, format: 'casual', host: 'p1',
  players: [{ id: 'p1', name: 'Hana', kind: 'person' as const }, { id: 'p2', name: 'Gus', kind: 'person' as const }],
  engine: { build: null, compiler: 'x', model: 4, stateSchema: 1, viewSchema: 1 }, config: { seed: 's', players: [], defs: [] },
});

describe('RPL-3: the replays API answers this server\'s own page only (the token request\'s check, guard.ts)', () => {
  it('fixed header sets: its own same-origin fetch is answered; another site, a sandboxed page and a rebinding Host are refused and change nothing', () => {
    const PORT = 47600;
    const OWN = `http://127.0.0.1:${PORT}`;
    const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-guard-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const service = new OnlineService(async () => fixtureDb(), { replaysDir: dir, token: 'ab'.repeat(32) });
    cleanups.push(() => service.close());
    // The HTTP server it is attached to, bound to PORT (nothing listens: the requests are calls in process).
    service.attach({ address: () => ({ address: '127.0.0.1', family: 'IPv4', port: PORT }), on: () => undefined } as unknown as Server);
    const s = fixtureStart(1);
    service.replayStore!.begin(s);
    service.replayStore!.settle(s.id); // a game over and closed: its record waits for its page
    const ask = (method: string, h: { host?: string; origin?: string; fetchSite?: string }, rest = '') => {
      const headers: Record<string, string> = { host: 'host' in h ? h.host! : `127.0.0.1:${PORT}` };
      if (h.origin !== undefined) headers['origin'] = h.origin;
      if (h.fetchSite !== undefined) headers['sec-fetch-site'] = h.fetchSite;
      const out: { status: number; body: unknown } = { status: 0, body: null };
      const res = {
        writeHead: (status: number) => {
          out.status = status;
          return res;
        },
        end: (text: string) => {
          out.body = JSON.parse(text);
        },
      };
      service.replays({ method, headers } as unknown as IncomingMessage, res as unknown as ServerResponse, `${ONLINE_REPLAYS_PATH}${rest}`);
      return out;
    };
    expect(ask('GET', { fetchSite: 'same-origin' })).toMatchObject({ status: 200, body: { replays: [{ id: s.id }], open: null } });
    expect(ask('GET', { origin: OWN, fetchSite: 'same-origin' }).status).toBe(200);
    expect(ask('GET', {}).status).toBe(200); // an older browser without Sec-Fetch-Site
    const refused = [
      { origin: 'https://evil.test', fetchSite: 'cross-site' }, { fetchSite: 'cross-site' }, { fetchSite: 'same-site' }, { origin: 'null' },
      { host: `evil.test:${PORT}`, fetchSite: 'same-origin' },
    ];
    for (const h of refused) {
      expect(ask('GET', h), JSON.stringify(h)).toMatchObject({ status: 403, body: { error: expect.any(String) } });
      expect(ask('GET', h, `/${s.id}`).status, JSON.stringify(h)).toBe(403);
      expect(ask('DELETE', h, `/${s.id}`).status, JSON.stringify(h)).toBe(403);
    }
    expect(readdirSync(dir)).toEqual([s.id]);
    expect(ask('DELETE', { fetchSite: 'same-origin' }, `/${s.id}`)).toEqual({ status: 200, body: { ok: true } });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('RPL-3: a guest\'s choice made while its link to the host is down', () => {
  /** Both agree; then the guest's link is cut, and its server notices (reconnecting). */
  async function cutAfterAgreeing(tag: string) {
    const cut = { on: false };
    const g = await game(2, tag, { cut });
    const gus = g.guests[0]!;
    for (const s of [g.host, gus]) expect(await s.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await until(() => g.host.browser.status!.replay!.agreed!.length === 2, 3000, 'both choices');
    cut.on = true;
    g.transport.cut();
    await until(() => gus.browser.status?.phase === 'reconnecting', 5000, 'the guest reconnecting');
    return { g, gus, cut };
  }

  it('the status keeps the choice the host has (pending: the new one) until the link is back; a game that ends meanwhile counts the earlier one', async () => {
    const { g, gus, cut } = await cutAfterAgreeing('cut-end');
    expect(await gus.browser.cmd({ t: 'replayConsent', agree: false })).toMatchObject({ ok: true });
    expect(gus.browser.status!.replay).toMatchObject({ agree: true, pending: false, shared: false });
    // Back to the choice the host has: nothing waits any more.
    expect(await gus.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    expect(gus.browser.status!.replay).not.toHaveProperty('pending');
    expect(await gus.browser.cmd({ t: 'replayConsent', agree: false })).toMatchObject({ ok: true });
    // The game ends while the link is down (the host concedes, CR 104.3a): the host has the guest's agreement, and shares the game.
    expect(g.games.host!.act({ type: 'concede', player: 'p1' }).ok).toBe(true);
    await until(() => g.host.browser.status!.replay!.shared, 3000, 'the host sharing');
    expect(gus.browser.status!.replay).toMatchObject({ agree: true, pending: false, shared: false });
    // The link is back: the guest's copy comes with its resume, and its status says what counted (every player agreed).
    cut.on = false;
    await until(() => replayGames(gus).length === 1, 10000, 'the guest\'s copy on its resume');
    await until(() => gus.browser.status?.phase === 'over', 3000, 'the guest\'s game over');
    expect(gus.browser.status!.replay).toEqual({ id: expect.stringMatching(/^r-/), agree: true, shared: true });
  });

  it('a choice made while the link is down reaches the host when the link is back (the guest sends it on its reconnection)', async () => {
    const { g, gus, cut } = await cutAfterAgreeing('cut-back');
    expect(await gus.browser.cmd({ t: 'replayConsent', agree: false })).toMatchObject({ ok: true });
    expect(gus.browser.status!.replay).toMatchObject({ agree: true, pending: false });
    await new Promise((r) => setTimeout(r, 100));
    expect(g.host.browser.status!.replay!.agreed).toEqual(['p1', 'p2']); // the host has the earlier choice
    cut.on = false;
    await until(() => g.host.browser.status!.replay!.agreed!.length === 1, 10000, 'the choice at the host');
    expect(g.host.browser.status!.replay!.agreed).toEqual(['p1']);
    await until(() => gus.browser.status?.phase === 'playing', 3000, 'the guest back');
    expect(gus.browser.status!.replay).toEqual({ id: expect.stringMatching(/^r-/), agree: false, shared: false });
  });
});

describe('RPL-3: the host\'s record and the replays API', () => {
  const api = (g: Game, method: string, rest = '') =>
    replayRequest(method, `${ONLINE_REPLAYS_PATH}${rest}`, {
      store: g.store, running: (id) => g.host.bridge.running(id), open: g.host.bridge.openReplay(), app: APP, base: ONLINE_REPLAYS_PATH,
    });

  it('two servers on one data folder: the second neither serves, removes nor prunes the first one\'s game in progress; once over, it is any server\'s', async () => {
    const g = await game(2, 'two-servers');
    const id = g.games.host!.replayId;
    await play([g.host, ...g.guests], () => (g.games.host?.seq ?? 0) < 8);
    // A second server started from the same checkout (`npm run play -- --port 47601`): its own store on the same folder, no game of its own.
    const other = new OnlineReplayStore(g.dir, 2);
    const theirs = (method: string, rest = '') =>
      replayRequest(method, `${ONLINE_REPLAYS_PATH}${rest}`, { store: other, running: () => false, app: APP, base: ONLINE_REPLAYS_PATH });
    expect(theirs('GET')).toMatchObject({ status: 200, body: { replays: [{ id, over: false, running: true }] } });
    expect(theirs('GET', `/${id}`)).toMatchObject({ status: 409 });
    expect(theirs('DELETE', `/${id}`)).toMatchObject({ status: 409 });
    expect(other.file(id, APP)).toBe('running');
    // Its own games begin (newer ones) and prune past `keep` (2): never the other server's game in progress, the oldest record.
    for (const i of [1, 2, 3]) other.begin({ ...fixtureStart(i), startedAt: `2999-01-0${i}T10:00:00.000Z` });
    expect(readdirSync(g.dir)).toContain(id);
    expect(readdirSync(g.dir)).toHaveLength(3);
    // The first server writes on, and its own page's API is unchanged (409 while it runs).
    const seq = g.games.host!.seq;
    await play([g.host, ...g.guests], () => (g.games.host?.seq ?? 0) < seq + 4);
    expect(g.store.read(id)!.actions.length).toBeGreaterThan(seq);
    expect(api(g, 'GET', `/${id}`)).toMatchObject({ status: 409 });
    // Over (its end written), it is a finished game: the second server's page may keep it.
    await play([g.host, ...g.guests], over(g));
    await until(() => g.host.browser.status?.phase === 'over', 3000, 'game over');
    expect(theirs('GET', `/${id}`)).toMatchObject({ status: 200, body: { id, kind: 'game', game: { mode: 'onlineHost', ended: expect.stringMatching(/finished|conceded/) } } });
  });

  it('an unfinished record whose server is gone (a crash) is an abandoned game for any server; one written on another machine counts as running', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-owner-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const first = new OnlineReplayStore(dir);
    const id = fixtureStart(1).id;
    first.begin(fixtureStart(1));
    expect(JSON.parse(readFileSync(path.join(dir, id, 'owner.json'), 'utf8'))).toEqual(first.owner);
    expect(first.owner).toMatchObject({ pid: process.pid, launch: expect.stringMatching(/^[0-9a-f]{16}$/) });
    // Its own launch: the bridge tells whether its game runs (`running`); another launch of a live process: running.
    expect(first.list()).toMatchObject([{ id, running: false }]);
    expect(new OnlineReplayStore(dir).list()).toMatchObject([{ id, running: true }]);
    // The first server's process is gone: abandoned, for any server to keep and remove.
    const later = new OnlineReplayStore(dir, KEEP_RECORDS, { alive: () => false });
    expect(later.list()).toMatchObject([{ id, over: false, running: false }]);
    expect(later.remove(id)).toBe('removed');
    // Written on another machine (a shared folder): nothing can be asked there, so it counts as running.
    const second = new OnlineReplayStore(dir);
    second.begin(fixtureStart(2));
    const owner = path.join(dir, fixtureStart(2).id, 'owner.json');
    writeFileSync(owner, JSON.stringify({ ...JSON.parse(readFileSync(owner, 'utf8')), host: 'another-machine' }));
    expect(new OnlineReplayStore(dir, KEEP_RECORDS, { alive: () => false }).list()).toMatchObject([{ running: true }]);
    // Its end written, it is finished wherever it was played.
    writeFileSync(path.join(dir, fixtureStart(2).id, 'end.json'), '{}');
    expect(new OnlineReplayStore(dir, KEEP_RECORDS, { alive: () => false }).list()).toMatchObject([{ running: false, over: true }]);
  });

  it('409 while the game runs; after the end the replay file of the host (kind game, mode onlineHost); removed once the page kept it', async () => {
    const g = await game(2, 'api');
    const id = g.games.host!.replayId;
    expect(readdirSync(g.dir)).toEqual([id]);
    expect(api(g, 'GET')).toEqual({
      status: 200, body: { replays: [{ id, startedAt: expect.any(String), players: ['Hana', 'Gus'], over: false, running: true }], open: id },
    });
    // A guest's server says which game it has open (its page's sweep leaves that game's recording alone), and keeps no records.
    const guestId = g.guests[0]!.browser.status!.replay!.id;
    expect(g.guests[0]!.bridge.openReplay()).toBe(guestId);
    expect(replayRequest('GET', ONLINE_REPLAYS_PATH, { store: null, running: () => false, open: guestId, app: APP, base: ONLINE_REPLAYS_PATH })).toEqual({
      status: 200, body: { replays: [], open: guestId },
    });
    expect(api(g, 'GET', `/${id}`)).toMatchObject({ status: 409 });
    expect(api(g, 'DELETE', `/${id}`)).toMatchObject({ status: 409 });
    expect(await g.guests[0]!.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await play([g.host, ...g.guests], over(g));
    await until(() => g.host.browser.status?.phase === 'over', 3000, 'game over');
    const list = api(g, 'GET');
    expect(list).toMatchObject({ status: 200, body: { replays: [{ id, over: true, running: false }] } });
    const r = api(g, 'GET', `/${id}`);
    expect(r.status).toBe(200);
    const file = r.body as ReplayFile;
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const host = g.games.host!;
    expect(file).toMatchObject({
      id, kind: 'game', app: APP, game: { mode: 'onlineHost', savedBy: 'p1', ended: expect.stringMatching(/finished|conceded/), actions: host.seq },
      reveal: { policy: 'own', agreed: ['p2'] }, play: { config: { seed: g.seed } },
    });
    expect(file.game.result).toEqual({ winner: host.state!.result!.winner, reason: host.state!.result!.reason });
    expect(gameDigest(finalOf(file))).toBe(gameDigest(host.state!));
    expect(file.play!.checkpoints.at(-1)!.action).toBe(host.seq - 1);
    // The host's own choice after the end is in the record too.
    expect(await g.host.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
    await until(() => (api(g, 'GET', `/${id}`).body as ReplayFile).reveal.policy === 'all', 3000, 'the record\'s consent');
    expect(api(g, 'DELETE', `/${id}`)).toEqual({ status: 200, body: { ok: true } });
    expect(readdirSync(g.dir)).toEqual([]);
    expect(api(g, 'GET', `/${id}`)).toMatchObject({ status: 404 });
    expect(api(g, 'DELETE', `/${id}`)).toMatchObject({ status: 404 });
    expect(api(g, 'GET', '/not-an-id')).toMatchObject({ status: 404 });
    expect(api(g, 'GET', `/${id}/more`)).toMatchObject({ status: 404 });
    expect(api(g, 'POST')).toMatchObject({ status: 405 });
  });

  it('a game left unfinished (the host\'s server stopped) reads as abandoned, at its last action', async () => {
    const g = await game(2, 'abandoned');
    const id = g.games.host!.replayId;
    await play([g.host, ...g.guests], () => (g.games.host?.seq ?? 0) < 12);
    const seq = g.games.host!.seq;
    await g.host.bridge.close(); // no concession: a bye without a result
    const r = api(g, 'GET', `/${id}`);
    expect(r.status).toBe(200);
    const file = r.body as ReplayFile;
    expect(file.game).toMatchObject({ ended: 'abandoned', result: null, actions: seq });
    expect(file.play!.actions).toHaveLength(seq);
  });

  it('a record whose last write was torn reads up to its last whole line; an end that does not follow its log is not trusted', async () => {
    const g = await game(2, 'torn');
    const id = g.games.host!.replayId;
    await play([g.host, ...g.guests], over(g));
    await g.host.bridge.close();
    const n = g.games.host!.seq;
    const log = path.join(g.dir, id, 'log.jsonl');
    const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(n);
    writeFileSync(log, `${lines.slice(0, n - 2).join('\n')}\n${lines[n - 2]!.slice(0, 15)}`);
    const file = api(g, 'GET', `/${id}`).body as ReplayFile;
    expect(file.play!.actions).toHaveLength(n - 2);
    expect(file.game.ended).toBe('abandoned'); // its end named n actions
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    appendFileSync(log, 'not json\n');
    expect((api(g, 'GET', `/${id}`).body as ReplayFile).play!.actions).toHaveLength(n - 2);
    // A line whose index does not follow (a line written twice) ends the log there too.
    writeFileSync(log, `${[...lines.slice(0, 5), lines[4]!, ...lines.slice(5)].join('\n')}\n`);
    expect((api(g, 'GET', `/${id}`).body as ReplayFile).play!.actions).toHaveLength(5);
  });

  it('the local server answers its own page on the replays path (http.ts routes it to the online service; the records live next to the card cache)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-http-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const { startServer } = await import('../../src/http');
    const srv = await startServer({ port: 0, clientDist: null, cacheDir: path.join(dir, 'scryfall'), version: '9.9.9' });
    cleanups.push(() => srv.close());
    expect(srv.online!.replayStore!.dir).toBe(path.join(dir, 'replays', 'online'));
    const list = await fetch(`${srv.url}${ONLINE_REPLAYS_PATH}`);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(await list.json()).toEqual({ replays: [], open: null });
    const one = await fetch(`${srv.url}${ONLINE_REPLAYS_PATH}/r-${'0'.repeat(20)}`);
    expect(one.status).toBe(404);
    expect(await one.json()).toEqual({ error: 'There is no such replay.' });
  });

  it('keeps at most `keep` records: the oldest go first when a game begins', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-keep-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = new OnlineReplayStore(dir, 3);
    const start = fixtureStart;
    for (let i = 1; i <= 5; i++) store.begin(start(i));
    expect(readdirSync(dir).sort()).toEqual([3, 4, 5].map((i) => start(i).id));
    expect(store.list().map((e) => e.id)).toEqual([5, 4, 3].map((i) => start(i).id));
  });

  it('the choices made before the game exists are in its record from its start (the host waiting, a player in the lobby); nothing is written before', async () => {
    const errors = vi.spyOn(console, 'error');
    try {
      const g = await game(3, 'lobby-choices', {
        beforeJoin: async (host, seat, guests) => {
          if (seat === 2) expect(await host.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
          if (seat !== 3) return;
          expect(await guests[0]!.browser.cmd({ t: 'replayConsent', agree: true })).toMatchObject({ ok: true });
          await until(() => host.browser.status!.replay!.agreed!.includes('p2'), 3000, 'p2\'s choice in the lobby');
        },
      });
      const id = g.games.host!.replayId;
      const written = JSON.parse(readFileSync(path.join(g.dir, id, 'consent.json'), 'utf8')) as { agreed: PlayerId[] };
      expect([...written.agreed].sort()).toEqual(['p1', 'p2']);
      // Nobody changes their choice after the start: the record still says who agreed.
      await play([g.host, ...g.guests], () => (g.games.host?.seq ?? 0) < 10);
      await g.host.bridge.close();
      const file = api(g, 'GET', `/${id}`).body as ReplayFile;
      expect(file.reveal.policy).toBe('own');
      expect([...file.reveal.agreed].sort()).toEqual(['p1', 'p2']);
      expect(errors.mock.calls.filter((c) => String(c[0]).includes('could not be written'))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('the players\' choices are written together (CONSENT_WRITE_MS), one taken back at once; a read writes them first; only records begun here', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-consent-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = new OnlineReplayStore(dir);
    const s = fixtureStart(1);
    store.begin(s, ['p1']);
    const written = () => (JSON.parse(readFileSync(path.join(dir, s.id, 'consent.json'), 'utf8')) as { agreed: PlayerId[] }).agreed;
    expect(written()).toEqual(['p1']);
    for (const agreed of [['p1', 'p2'], ['p1'], ['p1', 'p2']]) store.consent(s.id, agreed);
    expect(written()).toEqual(['p1']); // not yet: written together
    expect(store.read(s.id)!.agreed).toEqual(['p1', 'p2']);
    expect(written()).toEqual(['p1', 'p2']);
    store.consent(s.id, ['p2']); // p1 takes theirs back: at once
    expect(written()).toEqual(['p2']);
    store.consent(s.id, ['p1', 'p2']);
    await until(() => written().length === 2, 2000, 'the choices written together');
    // A record this store did not begin (another server's, or one whose game has not begun) is not written to.
    const other = `r-${'9'.repeat(20)}`;
    store.consent(other, ['p1']);
    store.append(other, { i: 0, action: { type: 'pass', player: 'p1' } as never, t: 0 });
    expect(readdirSync(dir)).toEqual([s.id]);
  });

  it('a record its page kept while its game is open stays until the game is closed or shared; it goes then unless a choice changed since', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-settle-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = new OnlineReplayStore(dir);
    const [a, b, c] = [fixtureStart(1), fixtureStart(2), fixtureStart(3)];
    for (const s of [a, b, c]) store.begin(s, ['p1']);
    // Kept while open, unchanged: it goes when its game is settled.
    expect(store.remove(a.id)).toBe('kept');
    expect(readdirSync(dir)).toContain(a.id);
    store.settle(a.id);
    expect(readdirSync(dir)).not.toContain(a.id);
    // Kept while open, then a choice changed: it stays for the page's next start, which removes it.
    expect(store.remove(b.id)).toBe('kept');
    store.consent(b.id, ['p1', 'p2']);
    store.settle(b.id);
    expect(store.read(b.id)!.agreed).toEqual(['p1', 'p2']);
    expect(store.remove(b.id)).toBe('removed');
    // Not kept before it was settled: it stays until its page keeps it.
    store.settle(c.id);
    expect(readdirSync(dir)).toEqual([c.id]);
    expect(store.remove(c.id)).toBe('removed');
    expect(store.remove(c.id)).toBe('missing');
    expect(readdirSync(dir)).toEqual([]);
  });
});
