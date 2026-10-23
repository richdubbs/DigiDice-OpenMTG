/**
 * The online bridge (src/online/bridge.ts) in process: two bridges, the host's and the guest's, joined by packages/net's in-memory link (no sockets),
 * each driven by a fake browser that sends the messages of src/online/api.ts as JSON text and keeps what it receives. Covers: a whole game played
 * only through the browsers' messages, each browser getting only its own player's view (CR 400.2), the link kept after game over until a side leaves
 * (FIX-NET gap 1), a second socket taking over, the checks of what a browser sends, and the guest's manual adjustments reaching the host's browser in
 * words only, named as the host may know them (FXH review finding 1).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CardDatabase } from '@openmtg/cards';
import { HIDDEN_DEF, viewFor, type Action, type GameView, type OracleCard, type PlayerId } from '@openmtg/engine';
import { autoAction, GameGuest, GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, MemoryTransport } from '@openmtg/net';
import type { ClientMessage, OnlineDeck, OnlineError, OnlineStatus, ServerMessage } from '../src/online/api';
import { OnlineBridge, type ClientHandle, type ClientPort } from '../src/online/bridge';

const FAST_LINK = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 50, idleTimeout: 400 };
const MARKER = 'Abzan Charm';

let db: CardDatabase | undefined;
function fixtureDb(): CardDatabase {
  if (!db) {
    const data = JSON.parse(readFileSync(new URL('../../engine/test/fixtures/cards.json', import.meta.url), 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
    db = CardDatabase.fromCards(data.cards, { tokens: data.tokens ?? [] });
  }
  return db;
}

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });

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

/** A browser tab: what it sends goes through the bridge as JSON text, what it gets is kept as it would arrive (JSON). */
class FakeBrowser implements ClientPort {
  readonly inbox: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;
  readonly handle: ClientHandle;
  private nextId = 1;

  constructor(bridge: OnlineBridge) {
    this.handle = bridge.attach(this);
  }

  send(m: ServerMessage): void {
    this.inbox.push(JSON.parse(JSON.stringify(m)) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.handle.closed();
  }

  raw(text: string): void {
    this.handle.message(text);
  }

  async cmd(m: Cmd, ms = 5000): Promise<Reply> {
    const id = this.nextId++;
    this.raw(JSON.stringify({ ...m, id }));
    let reply: Reply | undefined;
    await until(() => (reply = this.inbox.find((x): x is Reply => x.t === 'reply' && x.id === id)) !== undefined, ms, `the reply to ${m.t}`);
    return reply!;
  }

  get status(): OnlineStatus | undefined {
    return [...this.inbox].reverse().find((x): x is Extract<ServerMessage, { t: 'status' }> => x.t === 'status')?.status;
  }

  get views(): ViewMsg[] {
    return this.inbox.filter((x): x is ViewMsg => x.t === 'view');
  }

  get last(): ViewMsg | undefined {
    return this.views.at(-1);
  }

  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.inbox.filter((x): x is Extract<ServerMessage, { t: T }> => x.t === t);
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** A host bridge and a guest bridge on one in-memory link; `games.host` is the host's GameHost (the test's look at the full state). */
function bridges(seed = 'bridge-1') {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const games: { host?: GameHost; guest?: GameGuest } = {};
  const noJoin = () => Promise.reject(new Error('this test bridge only hosts'));
  const hostBridge = new OnlineBridge({
    cards: async () => fixtureDb(), link: FAST_LINK,
    backends: { startHost: async (o) => (games.host = await GameHost.attach({ ...o, seed, gameOptions: { skipMulligans: true } as never }, transport)), joinGuest: noJoin },
  });
  const guestBridge = new OnlineBridge({
    cards: () => Promise.reject(new Error('no card data on the guest\'s machine')), link: FAST_LINK,
    backends: { startHost: () => Promise.reject(new Error('this test bridge only joins')), joinGuest: async (o) => (games.guest = await GameGuest.join({ ...o, connector: (g) => transport.connect(g.link) })) },
  });
  cleanups.push(async () => {
    await guestBridge.close();
    await hostBridge.close();
  });
  return { hostBridge, guestBridge, games, transport };
}

/** Host and join through the browsers. */
async function seated(hostDeck: OnlineDeck, guestDeck: OnlineDeck, seed?: string) {
  const b = bridges(seed);
  const host = new FakeBrowser(b.hostBridge);
  const guest = new FakeBrowser(b.guestBridge);
  expect(host.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
  expect(await host.cmd({ t: 'host', name: 'Hana', deck: hostDeck, port: 0 })).toEqual({ t: 'reply', id: 1, ok: true });
  const hs = host.status!;
  expect(hs).toMatchObject({ role: 'host', phase: 'waiting', me: 'p1', format: 'casual', opponentConnected: false });
  expect(hs.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(await guest.cmd({ t: 'join', address: '203.0.113.5:47620', code: hs.code!, name: 'Gus', deck: guestDeck })).toEqual({ t: 'reply', id: 1, ok: true });
  await until(() => host.last !== undefined && guest.last !== undefined, 5000, 'the first views');
  expect(host.status).toMatchObject({ phase: 'playing', opponent: 'Gus', opponentConnected: true });
  expect(guest.status).toMatchObject({ role: 'guest', phase: 'playing', me: 'p2', opponent: 'Hana', opponentConnected: true, address: '203.0.113.5:47620' });
  return { ...b, host, guest };
}

/** The view of `b` when it must act now: its latest view, if it has the pending decision. */
function myTurn(b: FakeBrowser, me: PlayerId): ViewMsg | null {
  const v = b.last;
  return v && !v.view.result && v.view.pending?.player === me ? v : null;
}

describe('a game played through two bridges (in process)', () => {
  it('plays to the end with each browser getting only its own view (CR 400.2); the link stays up after game over until a side leaves', async () => {
    const s = await seated(deck({ Forest: 20, 'Grizzly Bears': 20 }), deck({ Mountain: 20, 'Hill Giant': 20 }));
    const problems: string[] = [];
    const deadline = Date.now() + 90000;
    while (!(s.host.last?.view.result && s.guest.last?.view.result)) {
      if (Date.now() > deadline) throw new Error('the game did not end');
      let acted = false;
      for (const [b, me] of [[s.host, 'p1'], [s.guest, 'p2']] as const) {
        const v = myTurn(b, me);
        const a = v ? autoAction(v.view, v.legal, me) : null;
        if (!a) continue;
        acted = true;
        const r = await b.cmd({ t: 'act', action: a });
        if (!r.ok && r.error.code !== 'stale') problems.push(`${me}: ${r.error.code} ${r.error.message}`);
      }
      if (!acted) await new Promise((r) => setTimeout(r, 2));
    }
    expect(problems).toEqual([]);
    const state = s.games.host!.state!;
    expect(state.turn.number).toBeGreaterThan(3);

    // Each browser got only its own player's view, never the full state (no seed, no RNG), and the host's hand and library stay hidden from the guest.
    for (const [b, me] of [[s.host, 'p1'], [s.guest, 'p2']] as const) {
      expect(b.views.length).toBeGreaterThan(20);
      for (const m of b.views) {
        expect(m.view.viewer).toBe(me);
        for (const key of ['rng', 'seed', 'suspended']) expect(key in m.view).toBe(false);
      }
    }
    let hidden = 0;
    for (const m of s.guest.views) {
      for (const o of Object.values(m.view.objects)) {
        if (o.owner !== 'p1' || (o.zone !== 'hand' && o.zone !== 'library') || o.revealedTo?.includes('p2')) continue;
        expect(o.defId).toBe(HIDDEN_DEF);
        hidden++;
      }
    }
    expect(hidden).toBeGreaterThan(100);
    // The final views are exactly viewFor of the host's state for each player, and the event feed came with them.
    const json = (v: GameView) => JSON.parse(JSON.stringify(v)) as unknown;
    expect(s.host.last!.view).toEqual(json(viewFor(state, 'p1')));
    expect(s.guest.last!.view).toEqual(json(viewFor(state, 'p2')));
    expect(s.guest.last!.seq).toBe(s.games.host!.seq);
    expect(s.guest.views.some((m) => m.events.length > 0)).toBe(true);

    // Game over (CR 104.1): both statuses say so, and the link stays up past several idle timeouts (FIX-NET gap 1).
    await until(() => s.host.status?.phase === 'over' && s.guest.status?.phase === 'over', 3000, 'both statuses over');
    expect(s.guest.status!.result).toEqual(state.result);
    await new Promise((r) => setTimeout(r, 4 * FAST_LINK.idleTimeout));
    expect(s.guest.status).toMatchObject({ phase: 'over', opponentConnected: true });
    expect(s.host.status).toMatchObject({ phase: 'over', opponentConnected: true });
    expect(s.guest.of('notice')).toEqual([]);

    // The guest leaves: the host's browser is told, the guest's bridge is idle again; then the host leaves too.
    expect((await s.guest.cmd({ t: 'leave' })).ok).toBe(true);
    expect(s.guest.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    await until(() => s.host.of('notice').some((n) => n.kind === 'opponentLeft'), 3000, 'the host to hear of it');
    expect(s.host.status).toMatchObject({ phase: 'over', opponentConnected: false });
    expect((await s.host.cmd({ t: 'leave' })).ok).toBe(true);
    expect(s.host.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
  }, 120000);

  it('the host leaving closes the guest\'s game with the host\'s bye, and a new socket takes over from the old one', async () => {
    const s = await seated(deck({ Forest: 20, 'Grizzly Bears': 20 }), deck({ Mountain: 20, 'Hill Giant': 20 }), 'bridge-2');
    // A reload: the new socket gets the status and the current view (without its events: they were shown already); the old one is closed.
    const again = new FakeBrowser(s.hostBridge);
    expect(s.host.closedWith).toMatchObject({ code: 4001 });
    expect(again.status).toMatchObject({ role: 'host', phase: 'playing' });
    expect(again.last).toMatchObject({ seq: s.host.last!.seq, events: [] });
    const before = s.host.inbox.length;
    expect((await again.cmd({ t: 'leave' })).ok).toBe(true);
    expect(s.host.inbox.length).toBe(before); // the replaced socket gets nothing more
    await until(() => s.guest.status?.phase === 'closed', 3000, 'the guest\'s game to close');
    // CL4: leaving a running game concedes it first (CR 104.3a): the guest got the view with its win before the bye, and is told why.
    expect(s.games.host!.state!.result).toMatchObject({ winner: 'p2' });
    expect(s.guest.last!.view.result).toMatchObject({ winner: 'p2' });
    expect(s.guest.last!.view.players.find((p) => p.id === 'p1')!.conceded).toBe(true);
    expect(s.guest.status).toMatchObject({ phase: 'closed', result: { winner: 'p2' } });
    expect(s.guest.status!.closedReason).toBe('host left: the host left the game and conceded (CR 104.3a)');
    expect(s.guest.of('notice').map((n) => [n.kind, n.text])).toEqual([['opponentLeft', 'Hana left the game and conceded (CR 104.3a).']]);
    // A closed game is cleared by a new join or a leave.
    expect((await s.guest.cmd({ t: 'leave' })).ok).toBe(true);
    expect(s.guest.status!.phase).toBe('idle');
  });

  it('checks what a browser sends: the player, the legal actions, the pending decision, the role, one game at a time', async () => {
    const s = await seated(deck({ Forest: 20, 'Grizzly Bears': 20 }), deck({ Mountain: 20, 'Hill Giant': 20 }), 'bridge-3');
    const err = async (b: FakeBrowser, m: Cmd): Promise<OnlineError> => {
      const r = await b.cmd(m);
      if (r.ok) throw new Error(`${m.t} was accepted`);
      return r.error;
    };
    const count = () => s.games.host!.state!.actionCount;
    const n = count();
    // Another player's action, from either side.
    expect(await err(s.host, { t: 'act', action: { type: 'pass', player: 'p2' } })).toMatchObject({ code: 'notYourPlayer' });
    expect(await err(s.guest, { t: 'act', action: { type: 'concede', player: 'p1' } })).toMatchObject({ code: 'notYourPlayer' });
    // Whoever does not have the decision cannot act; an answer must name the pending decision; a cast must be one of the legal actions.
    const p1Turn = s.host.last!.view.pending?.player === 'p1';
    const [active, idle, me, other] = p1Turn ? [s.host, s.guest, 'p1', 'p2'] as const : [s.guest, s.host, 'p2', 'p1'] as const;
    expect(await err(idle, { t: 'act', action: { type: 'pass', player: other } })).toMatchObject({ code: 'stale' });
    const d = active.last!.view.pending!;
    if (d.kind === 'priority') {
      const card = active.last!.view.zones.hand[me]![0]!;
      const legalCard = active.last!.legal.some((l) => l.action.type === 'cast' && l.action.card === card);
      if (!legalCard) expect(await err(active, { t: 'act', action: { type: 'cast', player: me, card } })).toMatchObject({ code: 'illegalAction', rules: ['CR 117.1'] });
    }
    expect(await err(active, { t: 'act', action: { type: 'answer', player: me, decisionId: 'd-old', answer: { kind: 'chooseObjects', ids: [] } } as Action })).toMatchObject({ code: 'stale' });
    // Malformed: unknown fields, shapes the engine does not read, a message without an id, text that is not JSON.
    expect(await err(active, { t: 'act', action: { type: 'pass', player: me, extra: 1 } as unknown as Action })).toMatchObject({ code: 'badMessage' });
    expect(await err(active, { t: 'chat', text: 'x'.repeat(501) })).toMatchObject({ code: 'badMessage' });
    active.raw('{"t":"status"}');
    active.raw('not json');
    await until(() => active.of('notice').length >= 2, 2000, 'the notices');
    expect(active.of('notice').map((x) => x.kind)).toEqual(['hostError', 'hostError']);
    // Roles and one game at a time.
    // a two-player guest answers the host's proposals (here there is none).
    expect(await err(s.guest, { t: 'manual', proposal: 1, accept: true })).toMatchObject({ code: 'manualRejected' });
    expect(await err(s.guest, { t: 'forfeit' })).toMatchObject({ code: 'notAllowed' });
    expect(await err(s.host, { t: 'forfeit' })).toMatchObject({ code: 'illegalAction' }); // the guest is connected
    expect(await err(s.host, { t: 'host', name: 'Hana', deck: deck({ Forest: 40 }) })).toMatchObject({ code: 'busy' });
    expect(await err(s.guest, { t: 'join', address: '203.0.113.5', code: s.host.status!.code!, name: 'Gus', deck: deck({ Mountain: 40 }) })).toMatchObject({ code: 'busy' });
    expect(count()).toBe(n); // nothing reached the game
    // Chat goes across, as plain text.
    expect((await s.guest.cmd({ t: 'chat', text: 'gl\u0007hf' })).ok).toBe(true);
    await until(() => s.host.of('chat').length === 1, 2000, 'the chat line');
    expect(s.host.of('chat')[0]!.text).toBe('glhf');
  });

  it('refuses a host without card data or with a deck the format does not allow, and a join to a bad address, and stays idle', async () => {
    const guestSide = bridges('bridge-4').guestBridge;
    const g = new FakeBrowser(guestSide);
    expect((await g.cmd({ t: 'host', name: 'Gus', deck: deck({ Mountain: 40 }) })).ok).toBe(false);
    expect(g.of('reply')[0]).toMatchObject({ ok: false, error: { code: 'noCardData' } });
    expect((await g.cmd({ t: 'join', address: 'not an address', code: 'X', name: 'Gus', deck: deck({ Mountain: 40 }) }))).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(g.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    const h = new FakeBrowser(bridges('bridge-5').hostBridge);
    const r = await h.cmd({ t: 'host', name: 'Hana', deck: deck({ Forest: 20, 'No Such Card': 20 }) });
    expect(r).toMatchObject({ ok: false, error: { code: 'deckRejected' } });
    expect(!r.ok && r.error.details?.join('\n')).toMatch(/No Such Card/);
    expect(h.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
  });
});

describe('CL4: Leave concedes a running game (CR 104.3a); a dropped link still waits for a reconnect', () => {
  const DECKS = [deck({ Forest: 20, 'Grizzly Bears': 20 }), deck({ Mountain: 20, 'Hill Giant': 20 })] as const;

  it('the guest leaving concedes: the host sees that it won and why, not a dropped link', async () => {
    const s = await seated(...DECKS, 'cl4-1');
    expect(s.games.host!.state!.result).toBeNull();
    expect((await s.guest.cmd({ t: 'leave' })).ok).toBe(true);
    expect(s.guest.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    await until(() => s.host.of('notice').some((n) => n.kind === 'opponentLeft'), 3000, 'the host to hear of it');
    expect(s.games.host!.state!.result).toMatchObject({ winner: 'p1' });
    expect(s.games.host!.state!.players.find((p) => p.id === 'p2')!.conceded).toBe(true);
    expect(s.host.last!.view.result).toMatchObject({ winner: 'p1' });
    expect(s.host.status).toMatchObject({ phase: 'over', opponentConnected: false, result: { winner: 'p1' } });
    expect(s.host.of('notice').map((n) => [n.kind, n.text])).toEqual([['opponentLeft', 'Gus left the game and conceded (CR 104.3a).']]);
  });

  it('a leave after game over concedes nothing more; a leave while waiting for a guest just stops hosting', async () => {
    const s = await seated(...DECKS, 'cl4-2');
    expect((await s.host.cmd({ t: 'act', action: { type: 'concede', player: 'p1' } })).ok).toBe(true);
    await until(() => s.guest.status?.phase === 'over', 3000, 'the guest to see the result');
    const actions = s.games.host!.state!.actionCount;
    expect((await s.guest.cmd({ t: 'leave' })).ok).toBe(true);
    await until(() => s.host.of('notice').some((n) => n.kind === 'opponentLeft'), 3000, 'the host to hear of it');
    expect(s.games.host!.state!.actionCount).toBe(actions);
    expect(s.games.host!.state!.result).toMatchObject({ winner: 'p2' });

    const b = bridges('cl4-3');
    const lone = new FakeBrowser(b.hostBridge);
    expect((await lone.cmd({ t: 'host', name: 'Hana', deck: DECKS[0], port: 0 })).ok).toBe(true);
    expect((await lone.cmd({ t: 'leave' })).ok).toBe(true);
    expect(lone.status).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    expect(b.games.host!.state).toBeNull();
  });

  it('a dropped guest link is not a concession: the host waits ("link dropped") and the guest comes back to the same game', async () => {
    const s = await seated(...DECKS, 'cl4-4');
    s.games.guest!.connection!.destroy('cable pulled');
    await until(() => s.host.of('notice').some((n) => n.kind === 'opponentDropped'), 5000, 'the host to notice the drop');
    expect(s.host.of('notice').find((n) => n.kind === 'opponentDropped')!.text).toMatch(/link dropped .*waiting for them to come back/);
    expect(s.host.of('notice').some((n) => n.kind === 'opponentLeft')).toBe(false);
    expect(s.games.host!.state!.result).toBeNull();
    expect(s.host.status).toMatchObject({ phase: 'playing', opponentConnected: false });
    await until(() => s.host.of('notice').some((n) => n.kind === 'opponentBack'), 10000, 'the guest to come back');
    await until(() => s.guest.status?.phase === 'playing' && s.guest.status.opponentConnected === true, 5000, 'the guest to be back');
    expect(s.games.host!.state!.result).toBeNull();
  }, 20000);

  it('a guest whose server stops says bye without conceding: the host is told it left and may end the game (Forfeit, CR 104.3a)', async () => {
    const s = await seated(...DECKS, 'cl4-5');
    await s.guestBridge.close();
    await until(() => s.host.of('notice').some((n) => n.kind === 'opponentLeft'), 3000, 'the host to hear of it');
    expect(s.games.host!.state!.result).toBeNull();
    expect(s.host.of('notice').find((n) => n.kind === 'opponentLeft')!.text).toMatch(/^Gus left the game \(.*\)\. You can end it for them \(Forfeit, CR 104\.3a\) or leave\.$/);
    expect((await s.host.cmd({ t: 'forfeit' })).ok).toBe(true);
    expect(s.games.host!.state!.result).toMatchObject({ winner: 'p1' });
  });
});

describe('the guest\'s manual adjustments at the host\'s browser (consent, FXH review finding 1)', () => {
  it('reach the host\'s browser in words only, naming the host\'s own card the guest chose by alias; the host\'s answer settles the guest\'s action', async () => {
    const s = await seated(deck({ Forest: 20, [MARKER]: 20 }), deck({ Mountain: 20, Fork: 20 }), 'bridge-manual');
    // The host passes; the guest plays Mountains and casts Fork (fully manual in the fixtures) until Fork resolves by hand.
    const deadline = Date.now() + 20000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('Fork never resolved by hand');
      const gv = myTurn(s.guest, 'p2');
      if (gv?.view.pending?.kind === 'manualResolve' && gv.seq === s.games.host!.seq) break;
      const hv = myTurn(s.host, 'p1');
      if (hv) {
        const a = autoAction(hv.view, hv.legal, 'p1');
        if (a) await s.host.cmd({ t: 'act', action: a });
        continue;
      }
      if (gv && gv.seq === s.games.host!.seq) {
        let a: Action | null = autoAction(gv.view, gv.legal, 'p2');
        if (gv.view.pending!.kind === 'priority') a = (gv.legal.find((l) => l.kind === 'playLand') ?? gv.legal.find((l) => l.kind === 'cast'))?.action ?? a;
        if (a) await s.guest.cmd({ t: 'act', action: a });
        continue;
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    const v = s.guest.last!.view;
    const d = v.pending!;
    const alias = v.zones.hand['p1']![0]!; // the host's hand as the guest sees it: m4 aliases
    expect(s.games.host!.state!.objects[alias]).toBeUndefined();
    const id = 1000;
    s.guest.raw(JSON.stringify({ t: 'act', id, action: { type: 'answer', player: 'p2', decisionId: d.id, answer: { kind: 'manualResolve', ops: [{ op: 'move', object: alias, to: 'exile' }, { op: 'life', player: 'p1', delta: -3 }] } } }));
    await until(() => s.host.of('manualProposal').length === 1, 3000, 'the proposal at the host\'s browser');
    const p = s.host.of('manualProposal')[0]!.proposal;
    expect(p).toEqual({ id: p.id, sourceName: 'Fork', text: expect.any(String) as string, lines: [`Move ${MARKER} (Hana's hand) to exile.`, 'Hana\'s life -3.'] });
    expect(Object.keys(p)).not.toContain('ops'); // the raw ops never reach the host's screen (m4)
    expect(s.guest.of('reply').some((r) => r.id === id)).toBe(false); // waiting for the host
    const life = s.games.host!.state!.players.find((x) => x.id === 'p1')!.life;
    expect((await s.host.cmd({ t: 'manual', proposal: p.id, accept: true })).ok).toBe(true);
    expect(s.host.of('manualClosed')).toEqual([{ t: 'manualClosed', proposal: p.id }]);
    await until(() => s.guest.of('reply').some((r) => r.id === id), 3000, 'the guest\'s reply');
    expect(s.guest.of('reply').find((r) => r.id === id)).toEqual({ t: 'reply', id, ok: true });
    const st = s.games.host!.state!;
    expect(st.players.find((x) => x.id === 'p1')!.life).toBe(life - 3);
    expect(st.zones.exile.map((x) => st.objects[x]!.defId)).toContain(MARKER);
  }, 40000);
});

describe("the two-player host's manual adjustments wait for the guest's browser", () => {
  it("the host's browser sees its proposal waiting for the guest; the guest's browser answers it in words only; both hear it applied", async () => {
    const s = await seated(deck({ Mountain: 20, Fork: 20 }), deck({ Forest: 20, [MARKER]: 20 }), 'bridge-host-manual');
    // The guest passes; the host plays Mountains and casts Fork (fully manual in the fixtures) until Fork resolves by hand.
    const deadline = Date.now() + 20000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('Fork never resolved by hand');
      const hv = myTurn(s.host, 'p1');
      if (hv?.view.pending?.kind === 'manualResolve') break;
      if (hv) {
        let a: Action | null = autoAction(hv.view, hv.legal, 'p1');
        if (hv.view.pending!.kind === 'priority') a = (hv.legal.find((l) => l.kind === 'playLand') ?? hv.legal.find((l) => l.kind === 'cast'))?.action ?? a;
        if (a) await s.host.cmd({ t: 'act', action: a });
        continue;
      }
      const gv = myTurn(s.guest, 'p2');
      if (gv && gv.seq === s.games.host!.seq) {
        const a = autoAction(gv.view, gv.legal, 'p2');
        if (a) await s.guest.cmd({ t: 'act', action: a });
        continue;
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    const d = s.host.last!.view.pending!;
    const own = s.host.last!.view.zones.hand['p1']![0]!;
    const ownName = s.host.last!.view.defs[s.host.last!.view.objects[own]!.defId]!.name;
    expect((await s.host.cmd({ t: 'act', action: { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'manualResolve', ops: [{ op: 'move', object: own, to: 'exile' }, { op: 'life', player: 'p2', delta: -2 }] } } })).ok).toBe(true);
    await until(() => s.host.of('manualProposal').length === 1 && s.guest.of('manualProposal').length === 1, 3000, 'the proposal at both browsers');
    const mine = s.host.of('manualProposal')[0]!.proposal;
    expect(mine).toEqual({ id: mine.id, sourceName: 'Fork', text: expect.any(String) as string, lines: [`Move ${ownName} (Hana's hand) to exile.`, "Gus's life -2."], player: 'p1', waiting: ['p2'] });
    const theirs = s.guest.of('manualProposal')[0]!.proposal;
    expect(theirs).toEqual({ id: mine.id, sourceName: 'Fork', text: expect.any(String) as string, lines: ["Move a hidden card (Hana's hand) to exile.", "Gus's life -2."], player: 'p1', waiting: ['p2'] });
    expect(Object.keys(theirs)).not.toContain('ops');
    expect(s.games.host!.state!.players.find((x) => x.id === 'p2')!.life).toBe(20);
    // The host cannot answer its own; the guest accepts.
    expect((await s.host.cmd({ t: 'manual', proposal: mine.id, accept: true })).ok).toBe(false);
    expect((await s.guest.cmd({ t: 'manual', proposal: mine.id, accept: true })).ok).toBe(true);
    await until(() => s.host.of('manualClosed').length === 1 && s.guest.of('manualClosed').length === 1, 3000, 'the close at both browsers');
    expect(s.host.of('manualClosed')).toEqual([{ t: 'manualClosed', proposal: mine.id, outcome: 'applied' }]);
    expect(s.guest.of('manualClosed')).toEqual([{ t: 'manualClosed', proposal: mine.id, outcome: 'applied' }]);
    expect(s.games.host!.state!.players.find((x) => x.id === 'p2')!.life).toBe(18);
  }, 40000);
});

describe('M12F: the table chat survives a page reload (the local server keeps it)', () => {
  const DECKS = [deck({ Forest: 20, 'Grizzly Bears': 20 }), deck({ Mountain: 20, 'Hill Giant': 20 })] as const;
  const history = (b: FakeBrowser) => b.of('chatHistory').at(-1)?.lines;

  it("a new socket gets the game's chat so far, both sides' lines, oldest first; a new game starts its own", async () => {
    const s = await seated(...DECKS, 'chat-1');
    expect(history(s.host)).toEqual([]); // the first socket, before any game: nothing to tell
    expect((await s.guest.cmd({ t: 'chat', text: 'gl\u0007hf' })).ok).toBe(true);
    await until(() => s.host.of('chat').length === 1, 2000, 'the guest line');
    expect((await s.host.cmd({ t: 'chat', text: 'you too' })).ok).toBe(true);
    await until(() => s.guest.of('chat').length === 1, 2000, 'the host line');
    // the host reloads: the new socket gets the status, the view and the chat (the guest's line as net delivered it, cleaned; the host's own line marked)
    const again = new FakeBrowser(s.hostBridge);
    expect(again.inbox.map((m) => m.t)).toEqual(['status', 'view', 'chatHistory']);
    expect(history(again)).toEqual([{ text: 'glhf' }, { text: 'you too', mine: true }]);
    // the guest reloads too
    const guestAgain = new FakeBrowser(s.guestBridge);
    expect(history(guestAgain)).toEqual([{ text: 'glhf', mine: true }, { text: 'you too' }]);
    // a `status` request resends it as well
    expect((await again.cmd({ t: 'status' })).ok).toBe(true);
    expect(again.of('chatHistory')).toHaveLength(2);
    // leaving ends the game and its chat
    expect((await again.cmd({ t: 'leave' })).ok).toBe(true);
    const third = new FakeBrowser(s.hostBridge);
    expect(history(third)).toEqual([]);
  });

  it(`keeps the last ${200} lines (CHAT_HISTORY_LINES)`, async () => {
    const { CHAT_HISTORY_LINES } = await import('../src/online/api');
    expect(CHAT_HISTORY_LINES).toBe(200);
    const s = await seated(...DECKS, 'chat-2');
    for (let i = 0; i < CHAT_HISTORY_LINES + 5; i++) expect((await s.host.cmd({ t: 'chat', text: `line ${i}` })).ok).toBe(true);
    const lines = history(new FakeBrowser(s.hostBridge))!;
    expect(lines).toHaveLength(CHAT_HISTORY_LINES);
    expect(lines[0]).toEqual({ text: 'line 5', mine: true });
    expect(lines.at(-1)).toEqual({ text: `line ${CHAT_HISTORY_LINES + 4}`, mine: true });
  });
});
