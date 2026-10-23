/**
 * M12-5a (m12 design 6, sites S1-S13): the online bridge with 3-4 players, in process: one host bridge and its guests' bridges joined by packages/net's
 * in-memory link (no sockets; normal traffic only), each driven by a fake browser that sends api.ts's messages as JSON text. Covers the host's per-seat
 * codes and the lobby, the start, the table in every status (links, drop clocks, players who left), notices about a player, chat with its sender, a guest
 * leaving, the host leaving and spectating while the game goes on, forfeiting a dropped guest, and the checks of the new command fields.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CardDatabase } from '@openmtg/cards';
import { HIDDEN_DEF, type OracleCard, type PlayerId } from '@openmtg/engine';
import { autoAction, GameGuest, GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, MemoryTransport } from '@openmtg/net';
import type { ClientMessage, OnlineDeck, OnlineStatus, ServerMessage } from '../../src/online/api';
import { OnlineBridge, type ClientHandle, type ClientPort } from '../../src/online/bridge';
import { parseClientMessage } from '../../src/online/messages';

const FAST_LINK = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 50, idleTimeout: 400 };

let db: CardDatabase | undefined;
function fixtureDb(): CardDatabase {
  if (!db) {
    const data = JSON.parse(readFileSync(new URL('../../../engine/test/fixtures/cards.json', import.meta.url), 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
    db = CardDatabase.fromCards(data.cards, { tokens: data.tokens ?? [] });
  }
  return db;
}

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });
const DECKS: Record<string, OnlineDeck> = {
  Hana: deck({ Forest: 16, 'Grizzly Bears': 21, 'Abzan Charm': 3 }),
  Gus: deck({ Mountain: 16, 'Raging Goblin': 12, 'Hill Giant': 9, 'Chief of the Scale': 3 }),
  Bianca: deck({ Plains: 16, 'Elite Vanguard': 21, 'Cuboid Colony': 3 }),
  Dana: deck({ Forest: 16, 'Runeclaw Bear': 21, 'Bard Class': 3 }),
};
const MARKERS: Record<string, string> = { Hana: 'Abzan Charm', Gus: 'Chief of the Scale', Bianca: 'Cuboid Colony', Dana: 'Bard Class' };

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

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

interface Side { name: string; me: PlayerId; browser: FakeBrowser; bridge: OnlineBridge }

/** A host bridge with `seats` and one bridge per guest; the guests join with their seats' codes (seat 3 first). */
async function table(seats: 3 | 4, o: { forfeitAfterMs?: number; reconnect?: number } = {}) {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const games: { host?: GameHost; guests: GameGuest[] } = { guests: [] };
  const hostBridge = new OnlineBridge({
    cards: async () => fixtureDb(), link: FAST_LINK,
    backends: {
      startHost: async (h) => (games.host = await GameHost.attach({ ...h, seed: `bridge-table-${seats}`, gameOptions: { skipMulligans: true } as never, ...(o.forfeitAfterMs ? { forfeitAfterMs: o.forfeitAfterMs } : {}) }, transport)),
      joinGuest: () => Promise.reject(new Error('the host bridge only hosts')),
    },
  });
  const host: Side = { name: 'Hana', me: 'p1', browser: new FakeBrowser(hostBridge), bridge: hostBridge };
  cleanups.push(() => hostBridge.close());
  expect(await host.browser.cmd({ t: 'host', name: 'Hana', deck: DECKS['Hana']!, port: 0, seats })).toMatchObject({ ok: true });
  const st = host.browser.status!;
  expect(st).toMatchObject({ role: 'host', phase: 'waiting', me: 'p1', seats });
  expect(st.opponent).toBeUndefined();
  expect(st.codes!.map((c) => [c.seat, c.player, c.taken])).toEqual(Array.from({ length: seats - 1 }, (_, i) => [i + 2, `p${i + 2}`, false]));
  expect(st.code).toBe(st.codes![0]!.code);
  expect(st.players!.map((p) => [p.id, p.taken])).toEqual([['p1', true], ...Array.from({ length: seats - 1 }, (_, i) => [`p${i + 2}`, false])]);
  const names = ['Gus', 'Bianca', 'Dana'].slice(0, seats - 1);
  const guests: Side[] = [];
  for (const seat of Array.from({ length: seats - 1 }, (_, i) => seats - i)) {
    const name = names[seat - 2]!;
    const bridge = new OnlineBridge({
      cards: () => Promise.reject(new Error('no card data')), link: FAST_LINK,
      backends: {
        startHost: () => Promise.reject(new Error('guests only join')),
        joinGuest: async (g) => {
          const guest = await GameGuest.join({ ...g, connector: (x) => transport.connect(x.link, x.code), ...(o.reconnect !== undefined ? { reconnect: { attempts: o.reconnect, delayMs: 50 } } : {}) });
          games.guests.push(guest);
          return guest;
        },
      },
    });
    cleanups.push(() => bridge.close());
    const side: Side = { name, me: `p${seat}`, browser: new FakeBrowser(bridge), bridge };
    const code = st.codes!.find((c) => c.seat === seat)!.code;
    expect(await side.browser.cmd({ t: 'join', address: '203.0.113.5:47620', code, name, deck: DECKS[name]! })).toMatchObject({ ok: true });
    guests.push(side);
  }
  guests.sort((a, b) => a.me.localeCompare(b.me));
  return { host, guests, games, transport };
}

/** Each side acts with the automatic player on its latest view while `go()`. */
async function play(sides: Side[], go: () => boolean, ms = 90000): Promise<string[]> {
  const problems: string[] = [];
  const deadline = Date.now() + ms;
  while (go()) {
    if (Date.now() > deadline) throw new Error('timed out playing');
    let acted = false;
    for (const s of sides) {
      const v = s.browser.last;
      if (!v || v.view.result || v.view.pending?.player !== s.me) continue;
      const a = autoAction(v.view, v.legal, s.me);
      if (!a) continue;
      acted = true;
      const r = await s.browser.cmd({ t: 'act', action: a });
      if (!r.ok && r.error.code !== 'stale') problems.push(`${s.me}: ${r.error.code} ${r.error.message}`);
    }
    if (!acted) await new Promise((r) => setTimeout(r, 2));
  }
  return problems;
}

describe('M12-5a: the bridge with 3-4 players (in process)', () => {
  it('3 players: per-seat codes, the lobby, the start; each browser only its own view; a guest leaves, then the host leaves and spectates while the game goes on', async () => {
    const { host, guests, games } = await table(3);
    const [gus, bianca] = guests as [Side, Side];
    await until(() => [host, gus, bianca].every((s) => s.browser.status?.phase === 'playing' && s.browser.last !== undefined), 5000, 'the start everywhere');
    // Every status has the table in seating order (CR 806.3), no two-player fields.
    const seating = games.host!.state!.players.map((p) => p.id);
    for (const s of [host, gus, bianca]) {
      expect(s.browser.status!.players!.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
      expect(s.browser.status!.players!.every((p) => p.connected)).toBe(true);
      expect(s.browser.status!.opponentConnected).toBeUndefined();
    }
    expect(gus.browser.status).toMatchObject({ role: 'guest', me: 'p2', seat: 2, seats: 3 });
    expect(bianca.browser.status).toMatchObject({ role: 'guest', me: 'p3', seat: 3, seats: 3 });
    expect(host.browser.status!.codes!.every((c) => c.taken)).toBe(true);
    expect(seating).toHaveLength(3);
    // Lobby notices named the player who joined.
    expect(host.browser.of('notice').filter((n) => n.kind === 'opponentJoined').map((n) => n.player).sort()).toEqual(['p2', 'p3']);

    // Chat: to everyone, with its sender.
    expect((await gus.browser.cmd({ t: 'chat', text: 'good luck' })).ok).toBe(true);
    await until(() => host.browser.of('chat').length === 1 && bianca.browser.of('chat').length === 1, 3000, 'the chat');
    expect(host.browser.of('chat')[0]).toEqual({ t: 'chat', text: 'good luck', from: 'p2' });
    expect(bianca.browser.of('chat')[0]).toEqual({ t: 'chat', text: 'good luck', from: 'p2' });

    const problems = await play([host, gus, bianca], () => (games.host!.state!.turn.number < 3));
    expect(problems).toEqual([]);

    // The host leaves: it concedes, its server keeps the game for the others; its page spectates.
    expect((await host.browser.cmd({ t: 'leave' })).ok).toBe(true);
    expect(host.browser.status!.phase).toBe('spectating');
    expect(games.host!.isClosed).toBe(false);
    await until(() => gus.browser.of('notice').some((n) => n.player === 'p1' && n.kind === 'opponentLeft'), 3000, 'the guests told');
    await until(() => gus.browser.status!.players!.find((p) => p.id === 'p1')!.left === true, 3000, 'the table: p1 left');
    expect(games.host!.state!.result).toBeNull();

    // Bianca leaves too (her Leave concedes first): Gus is the last player and wins (CR 104.2a).
    expect((await bianca.browser.cmd({ t: 'leave' })).ok).toBe(true);
    expect(bianca.browser.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    await until(() => gus.browser.status!.phase === 'over', 5000, 'the end at Gus');
    expect(gus.browser.status!.result).toMatchObject({ winner: 'p2' });
    await until(() => host.browser.status!.phase === 'over', 3000, 'the end at the host');
    await until(() => host.browser.of('notice').some((n) => n.player === 'p3' && n.kind === 'opponentLeft'), 3000, 'the host told Bianca left');
    expect(host.browser.of('notice').find((n) => n.player === 'p3' && n.kind === 'opponentLeft')!.text).toBe('Bianca left the game and conceded (CR 104.3a).');

    // Nobody's browser ever got another player's hidden cards (CR 400.2).
    for (const s of [host, gus, bianca]) {
      const text = JSON.stringify(s.browser.inbox);
      for (const [name, marker] of Object.entries(MARKERS)) if (name !== s.name) expect(text).not.toContain(marker);
      for (const m of s.browser.of('view')) {
        expect(m.view.viewer).toBe(s.me);
        for (const obj of Object.values(m.view.objects)) if (obj.owner !== s.me && (obj.zone === 'hand' || obj.zone === 'library')) expect(obj.defId).toBe(HIDDEN_DEF);
      }
    }
    // Gus leaves: every guest is gone after the end, so the spectating host closes its game by itself.
    expect((await gus.browser.cmd({ t: 'leave' })).ok).toBe(true);
    await until(() => host.browser.status!.phase === 'idle', 5000, 'the host to close');
    expect(games.host!.isClosed).toBe(true);
  }, 120000);

  it('4 players: a guest whose link drops shows a clock to everyone; the host can forfeit them by name before it runs out', async () => {
    const { host, guests, games } = await table(4, { forfeitAfterMs: 60000, reconnect: 0 });
    const [gus, bianca, dana] = guests as [Side, Side, Side];
    await until(() => [host, ...guests].every((s) => s.browser.status?.phase === 'playing'), 5000, 'the start everywhere');
    expect(games.host!.state!.players).toHaveLength(4);
    const danaGame = games.guests.find((g) => g.player === 'p4')!;
    danaGame.connection!.destroy('cable cut');
    await until(() => gus.browser.status!.players!.find((p) => p.id === 'p4')?.forfeitAt !== undefined, 5000, 'the clock at Gus');
    const clock = gus.browser.status!.players!.find((p) => p.id === 'p4')!;
    expect(clock.connected).toBe(false);
    expect(clock.forfeitAt! - Date.now()).toBeGreaterThan(50000);
    expect(host.browser.status!.players!.find((p) => p.id === 'p4')!.forfeitAt).toBeGreaterThan(Date.now());
    expect(bianca.browser.of('notice').some((n) => n.kind === 'opponentDropped' && n.player === 'p4')).toBe(true);
    // A guest cannot forfeit anyone; the host must name a guest that is down.
    expect(await gus.browser.cmd({ t: 'forfeit', player: 'p4' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    expect(await host.browser.cmd({ t: 'forfeit', player: 'p2' })).toMatchObject({ ok: false, error: { code: 'illegalAction' } });
    expect((await host.browser.cmd({ t: 'forfeit', player: 'p4' })).ok).toBe(true);
    expect(games.host!.state!.players.find((p) => p.id === 'p4')!.conceded).toBe(true);
    await until(() => gus.browser.status!.players!.find((p) => p.id === 'p4')!.left === true, 3000, 'the table: p4 left');
    expect(gus.browser.status!.players!.find((p) => p.id === 'p4')!.forfeitAt).toBeUndefined();
    void dana;
  }, 60000);

  it('the spectating host leaving again stops the game: it ends for everyone without a result', async () => {
    const { host, guests, games } = await table(3);
    await until(() => [host, ...guests].every((s) => s.browser.status?.phase === 'playing'), 5000, 'the start');
    expect((await host.browser.cmd({ t: 'leave' })).ok).toBe(true);
    expect(host.browser.status!.phase).toBe('spectating');
    expect((await host.browser.cmd({ t: 'leave' })).ok).toBe(true);
    expect(host.browser.status!.phase).toBe('idle');
    expect(games.host!.isClosed).toBe(true);
    for (const g of guests) {
      await until(() => g.browser.status?.phase === 'closed', 5000, 'the guests closed');
      expect(g.browser.status!.closedReason).toMatch(/the host stopped running the game \(it ends without a result\)/);
      expect(g.browser.status!.result).toBeUndefined();
    }
  }, 30000);

  it('M12 gaps (STATUS "Wave M12" gap 5): the host leaving with one other player left ends the game (CR 104.2a): the host page is over, not spectating', async () => {
    const { host, guests, games } = await table(3);
    const [gus, bianca] = guests as [Side, Side];
    await until(() => [host, ...guests].every((s) => s.browser.status?.phase === 'playing'), 5000, 'the start');
    expect((await bianca.browser.cmd({ t: 'leave' })).ok).toBe(true); // her Leave concedes first
    await until(() => games.host!.state!.players.find((p) => p.id === 'p3')!.hasLost, 5000, 'Bianca out');
    expect((await host.browser.cmd({ t: 'leave' })).ok).toBe(true);
    expect(games.host!.state!.result).toMatchObject({ winner: 'p2' });
    expect(host.browser.status).toMatchObject({ phase: 'over', result: { winner: 'p2' } });
    await until(() => gus.browser.status!.phase === 'over', 5000, 'the end at Gus');
    await until(() => gus.browser.of('notice').some((n) => n.player === 'p1' && n.kind === 'opponentLeft'), 3000, 'Gus told');
    expect(gus.browser.of('notice').find((n) => n.player === 'p1' && n.kind === 'opponentLeft')!.text).toBe('Hana left the game and conceded (CR 104.3a), which ends it (CR 104.2a).');
    // Leave again closes the finished game (it was never "running for the others")
    expect((await host.browser.cmd({ t: 'leave' })).ok).toBe(true);
    expect(host.browser.status!.phase).toBe('idle');
    expect(games.host!.isClosed).toBe(true);
  }, 30000);

  it('a guest of a 3-4 player game answers proposals with `manual`; without one it is told there is none', async () => {
    const { guests } = await table(3);
    const gus = guests[0]!;
    await until(() => gus.browser.status?.phase === 'playing', 5000, 'the start');
    expect(await gus.browser.cmd({ t: 'manual', proposal: 7, accept: true })).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
  }, 30000);
});

describe('M12-5a: the new command fields are checked', () => {
  it('host: seats 3 or 4 only; forfeit: a guest seat\'s player only', () => {
    const host = (seats: unknown) => parseClientMessage(JSON.stringify({ t: 'host', id: 1, name: 'H', deck: { main: [], sideboard: [] }, seats }));
    expect(host(3)).toMatchObject({ ok: true, message: { seats: 3 } });
    expect(host(4)).toMatchObject({ ok: true, message: { seats: 4 } });
    expect(host(2)).toMatchObject({ ok: false });
    expect(host(5)).toMatchObject({ ok: false });
    expect(parseClientMessage(JSON.stringify({ t: 'forfeit', id: 2, player: 'p3' }))).toEqual({ ok: true, message: { t: 'forfeit', id: 2, player: 'p3' } });
    expect(parseClientMessage(JSON.stringify({ t: 'forfeit', id: 2 }))).toEqual({ ok: true, message: { t: 'forfeit', id: 2 } });
    expect(parseClientMessage(JSON.stringify({ t: 'forfeit', id: 2, player: 'p1' }))).toMatchObject({ ok: false });
    expect(parseClientMessage(JSON.stringify({ t: 'forfeit', id: 2, player: { x: 1 } }))).toMatchObject({ ok: false });
  });
});
