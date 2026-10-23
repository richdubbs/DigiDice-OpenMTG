/**
 * RPL-3 test helpers: an online game in process, from the page down (normal traffic only; no sockets, no network): each player's page is an OnlineLink
 * whose "socket" hands its JSON text to that player's own OnlineBridge (packages/server online/bridge.ts) and back, the bridges play over packages/net's
 * in-memory link, and the host's page reads its replays API through a fetch that calls the server's request handler (online/replays.ts). Each page has
 * its RemoteConnection, its replay (online/replays.ts `recordOnlineGame`) and a replay library in memory.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CardDatabase } from '@openmtg/cards';
import type { GameView, OracleCard, PlayerId, ReplayFile } from '@openmtg/engine';
import { autoAction, GameGuest, GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, localEngineBuild, MemoryTransport } from '@openmtg/net';
import { OnlineBridge, OnlineReplayStore, replayRequest } from '@openmtg/server';
import { ONLINE_PROTOCOL, ONLINE_REPLAYS_PATH, ONLINE_SESSION_PATH, type OnlineDeck, type ServerMessage } from '@openmtg/server/online';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { OnlineLink, type SocketLike } from '../../src/online/OnlineLink';
import { recordOnlineGame, type OnlineReplay } from '../../src/online/replays';
import type { ReplayEnv } from '../../src/replays/env';
import { inlineCompleter, testEnv } from '../replays/helpers';

export const FAST_LINK = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 50, idleTimeout: 400 };
export const TOKEN = 'cd'.repeat(32);
/** The engine build of this process: the one the host's server records, so the pages' replays are exact (replays design 5.2). */
export const BUILD = localEngineBuild();

let db: CardDatabase | undefined;
export function fixtureDb(): CardDatabase {
  if (!db) {
    const data = JSON.parse(readFileSync(new URL('../../../engine/test/fixtures/cards.json', import.meta.url), 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
    db = CardDatabase.fromCards(data.cards, { tokens: data.tokens ?? [] });
  }
  return db;
}

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });
export const NAMES = ['Hana', 'Gus', 'Bianca', 'Dana'];
export const DECKS: Record<string, OnlineDeck> = {
  Hana: deck({ Forest: 16, 'Grizzly Bears': 24 }),
  Gus: deck({ Mountain: 16, 'Raging Goblin': 12, 'Hill Giant': 12 }),
  Bianca: deck({ Plains: 16, 'Elite Vanguard': 24 }),
  Dana: deck({ Forest: 16, 'Runeclaw Bear': 24 }),
};

export async function until(cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 3));
  }
}

/** `until` for a condition that has to be read (a library file). */
export async function untilAsync(cond: () => Promise<boolean>, ms = 5000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A page's socket to its own server: the bridge in process. Opens on the next turn, as a real socket does. */
function bridgeSocket(bridge: OnlineBridge): SocketLike {
  const s: SocketLike & { readyState: number } = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data: string) => handle.message(data),
    close: () => {
      s.readyState = 3;
      handle.closed();
    },
  };
  let handle: ReturnType<OnlineBridge['attach']>;
  queueMicrotask(() => {
    s.readyState = 1;
    s.onopen?.({});
    handle = bridge.attach({
      send: (m: ServerMessage) => s.readyState === 1 && s.onmessage?.({ data: JSON.stringify(m) }),
      close: (code, reason) => {
        s.readyState = 3;
        s.onclose?.({ code, reason });
      },
    });
  });
  return s;
}

/** The page's fetch: the token request and the replays API of its own server (online/replays.ts `replayRequest`). */
function pageFetch(bridge: OnlineBridge, store: OnlineReplayStore | null) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url, 'http://127.0.0.1:47600');
    if (u.pathname === ONLINE_SESSION_PATH) return new Response(JSON.stringify({ token: TOKEN, protocol: ONLINE_PROTOCOL }), { status: 200 });
    if (u.pathname === ONLINE_REPLAYS_PATH || u.pathname.startsWith(`${ONLINE_REPLAYS_PATH}/`)) {
      const r = replayRequest(init?.method ?? 'GET', u.pathname, {
        store, running: (id) => bridge.running(id), open: bridge.openReplay(), app: { version: '9.9.9', commit: null }, base: ONLINE_REPLAYS_PATH,
      });
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };
}

/** A page's link to its own server (another tab, a reloaded page, an online setup screen). Not connected yet. */
export function pageLink(bridge: OnlineBridge, store: OnlineReplayStore | null = null): OnlineLink {
  return new OnlineLink({ fetch: pageFetch(bridge, store), socket: () => bridgeSocket(bridge), retryMs: 5 });
}

export interface Page {
  name: string;
  me: PlayerId;
  bridge: OnlineBridge;
  link: OnlineLink;
  conn: RemoteConnection;
  env: ReplayEnv;
  replay: OnlineReplay;
  /** Every change the page was shown: the view and its seq (the actions the host had applied). */
  shown: { seq: number; view: GameView }[];
}

export interface OnlineTable {
  host: Page;
  guests: Page[];
  pages: Page[];
  store: OnlineReplayStore;
  dir: string;
  hostGame: () => GameHost;
  close(): Promise<void>;
}

/** A table of `seats`, every page connected and in the game (its RemoteConnection and replay started as the setup screens start them). */
export async function onlineTable(seats: 2 | 3 | 4, tag: string, o: { completer?: boolean } = {}): Promise<OnlineTable> {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-rpl3-client-'));
  const store = new OnlineReplayStore(dir);
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  let host: GameHost | undefined;
  const bridges: OnlineBridge[] = [];
  const hostBridge = new OnlineBridge({
    cards: async () => fixtureDb(), link: FAST_LINK, replays: store, app: { version: '9.9.9', commit: null },
    backends: {
      startHost: async (h) => (host = await GameHost.attach({ ...h, seed: `rpl3-client-${tag}-${seats}`, gameOptions: { skipMulligans: true, startingLife: 4 } as never }, transport)),
      joinGuest: () => Promise.reject(new Error('the host bridge only hosts')),
    },
  });
  bridges.push(hostBridge);
  const link = pageLink;
  const hostLink = link(hostBridge, store);
  await hostLink.connect();
  const hosted = await hostLink.host({ name: 'Hana', deck: DECKS['Hana']!, port: 0, ...(seats > 2 ? { seats: seats as 3 | 4 } : {}) });
  if (!hosted.ok) throw new Error(hosted.error.message);
  await until(() => hostLink.status().phase === 'waiting', 3000, 'hosting');
  const st = hostLink.status();
  const codes = st.codes ?? [{ seat: 2, code: st.code! }];
  const guestLinks: { name: string; me: PlayerId; bridge: OnlineBridge; link: OnlineLink }[] = [];
  for (let seat = 2; seat <= seats; seat++) {
    const name = NAMES[seat - 1]!;
    const bridge = new OnlineBridge({
      cards: () => Promise.reject(new Error('no card data')), link: FAST_LINK,
      backends: { startHost: () => Promise.reject(new Error('guests only join')), joinGuest: (g) => GameGuest.join({ ...g, connector: (x) => transport.connect(x.link, x.code) }) },
    });
    bridges.push(bridge);
    const l = link(bridge, null);
    await l.connect();
    const joined = await l.join({ address: '203.0.113.5:47620', code: codes.find((c) => c.seat === seat)!.code, name, deck: DECKS[name]! });
    if (!joined.ok) throw new Error(joined.error.message);
    guestLinks.push({ name, me: `p${seat}`, bridge, link: l });
  }
  const all = [{ name: 'Hana', me: 'p1' as PlayerId, bridge: hostBridge, link: hostLink }, ...guestLinks];
  await until(() => all.every((p) => p.link.view() !== null && (p.link.status().phase === 'playing' || p.link.status().phase === 'over')), 5000, 'every page in the game');
  const pages = all.map((p): Page => {
    const env = testEnv({ build: BUILD, completer: o.completer === false ? null : inlineCompleter, now: () => Date.now() });
    const conn = new RemoteConnection(p.link);
    const shown: Page['shown'] = [{ seq: conn.events().seq, view: conn.view() }];
    conn.subscribe(() => {
      const seq = conn.events().seq;
      if (seq !== shown[shown.length - 1]!.seq) shown.push({ seq, view: conn.view() });
    });
    const replay = recordOnlineGame(conn, p.link, env);
    return { ...p, conn, env, replay, shown };
  });
  return {
    host: pages[0]!,
    guests: pages.slice(1),
    pages,
    store,
    dir,
    hostGame: () => host!,
    close: async () => {
      for (const b of bridges) await b.close();
      for (const p of pages) p.link.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Every page acts with the simple automatic player on its view while `go()` (a refused action is retried on a newer view). */
export async function playUntil(t: OnlineTable, go: () => boolean, ms = 90000, pages: Page[] = t.pages): Promise<void> {
  const end = Date.now() + ms;
  while (go()) {
    if (Date.now() > end) throw new Error('the game did not get there');
    let acted = false;
    for (const p of pages) {
      const v = p.conn.view();
      const a = autoAction(v, p.conn.legalActions() as never, p.me);
      if (!a) continue;
      acted = true;
      await p.conn.act(a);
    }
    if (!acted) await new Promise((r) => setTimeout(r, 3));
  }
}

/** The game is over on every page still in it. */
export const allOver = (t: OnlineTable, pages: Page[] = t.pages) => () => !pages.every((p) => p.conn.view().result != null);

/** A page's library file (the one replay of the game it kept). */
export async function keptFile(p: Page): Promise<ReplayFile> {
  const list = await p.env.library.list();
  if (list.length !== 1) throw new Error(`${p.me} keeps ${list.length} replays`);
  const read = await p.env.library.read(list[0]!.key);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}
