/**
 * RPL-3 (replays design 6, 7.2, 16.3): who gets what of an online game, in process (net's MemoryTransport: no sockets; normal traffic only), with 2, 3
 * and 4 players driven by the simple automatic player.
 *
 *  - The host keeps the game's record (record.ts) and tells its server each line: the start (config with the seed), one line per applied action, the end.
 *  - No game data reaches a guest without every person's agreement: every message every guest received is searched for the seed and for anything of the
 *    record, and no `replayGame` arrives while anyone has not agreed, nor during the game when everyone has.
 *  - When the game is over for everyone and every player agreed, each guest gets its own copy (saved by that guest) once; it is a valid replay file
 *    whose log plays to the host's final state, and every view the guest was shown live is the view its seat has in the replay.
 *  - A leaver's last choice counts (CR 104.3a, 800.4a): agreed and left, the others still get the game; left without agreeing, nobody does.
 *  - A guest's choices are paced per seat (the latest waiting one counts; nothing is shared while one waits); a choice made while the link is down is sent
 *    on the reconnection; the game shared while a guest was away reaches it on its resume, and a copy sent again is kept once; a lobby seat that opens
 *    again forgets its guest's choice.
 */
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAction, checkReplay, createGame, gameDigest, viewFor, type Action, type GameConfig, type GameState, type GameView, type PlayerId, type ReplayFile,
} from '@openmtg/engine';
import { NetError } from '../../src/errors';
import { GameGuest } from '../../src/game/guest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH } from '../../src/game/host';
import { MemoryTransport } from '../../src/link/memory';
import type { OnlineRecordAction, OnlineRecordEnd, OnlineRecordStart } from '../../src/game/record';
import { deck, fixtureDb } from '../helpers';
import { joinSeat, openTable, runBots, SEATS, TABLE_LINK, until, untilOver, type Seat, type Table } from '../m12/table';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** A short game: low life, no mulligans. */
const FAST_GAME = { gameOptions: { skipMulligans: true, startingLife: 4 } as never };

interface Watched {
  table: Table;
  /** The seed: it must never reach a guest before the end and everyone's agreement. */
  seed: string;
  lines: { start: OnlineRecordStart[]; actions: OnlineRecordAction[]; ends: OnlineRecordEnd[]; consent: PlayerId[][]; shared: boolean[] };
}

/** A table of `seats` (2: a two-player game, milestone 9's) with the host's record events watched. */
async function table(seats: 2 | 3 | 4, seedTag: string): Promise<Watched> {
  const seed = `rpl3-secret-seed-${seedTag}-${seats}`;
  let t: Table;
  if (seats === 2) {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const host = await GameHost.attach({ name: SEATS[0]!.name, deck: SEATS[0]!.deck, cards: fixtureDb(), seed, ...FAST_GAME }, transport);
    const hostViews: GameView[] = [];
    host.on('view', (v) => hostViews.push(v));
    const guest = await joinSeat(host, transport, 2);
    t = { host, transport, guests: [guest], hostViews, close: async () => { await guest.guest.close(); await host.close('test over', 200); } };
  } else {
    t = await openTable(seats, { seed, host: FAST_GAME });
  }
  cleanups.push(() => t.close());
  const lines: Watched['lines'] = { start: [], actions: [], ends: [], consent: [], shared: [] };
  // The game was created as its last seat was taken, before these listeners (the bridge listens from the start: packages/server online/bridge.ts).
  expect(t.host.replayRecord?.actions).toEqual([]);
  lines.start.push(t.host.replayRecord!.start);
  t.host.on('recordStart', (s) => lines.start.push(s));
  t.host.on('recordAction', (l) => lines.actions.push(l));
  t.host.on('recordEnd', (e) => lines.ends.push(e));
  t.host.on('replayConsent', (a) => lines.consent.push(a));
  t.host.on('replayShared', (ok) => lines.shared.push(ok));
  await until(() => t.guests.every((g) => g.guest.view !== null), 5000, 'the first views');
  return { table: t, seed, lines };
}

const replayGames = (s: Seat): { type: string; data: string }[] =>
  s.inbox.filter((m): m is { type: string; data: string } => (m as { type?: string }).type === 'replayGame');

/** No message a guest received holds the seed or anything of the record (CR 400.2: it would reveal every hidden card), and none is a replayGame. */
function expectNothingShared(w: Watched): void {
  for (const g of w.table.guests) {
    expect(replayGames(g), g.player).toEqual([]);
    for (const m of g.inbox) {
      const text = JSON.stringify(m);
      expect(text.includes(w.seed), `${g.player} received the seed`).toBe(false);
      expect(/"(config|checkpoints|seed)"/.test(text), `${g.player} received a record's field`).toBe(false);
    }
    expect(g.guest.replayData).toBeNull();
  }
}

function decode(data: string): ReplayFile {
  const checked = checkReplay(JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8')));
  if (!checked.ok) throw new Error(checked.error.message);
  return checked.value;
}

/** The states of a replay's game: `states[i]` after `i` actions. */
function statesOf(config: GameConfig, actions: readonly Action[]): GameState[] {
  let s = createGame(config);
  const out = [s];
  for (const a of actions) {
    const r = applyAction(s, a);
    if (r.error) throw new Error(r.error.message);
    s = r.state;
    out.push(s);
  }
  return out;
}

/** Each guest's copy: one, saved by that guest, the whole game with everyone's agreement; its log plays to the host's end, and shows every live view. */
function expectShared(w: Watched): void {
  const host = w.table.host;
  const final = host.state!;
  for (const g of w.table.guests.filter((x) => x.guest.connected)) {
    const got = replayGames(g);
    expect(got, g.player).toHaveLength(1);
    expect(g.guest.replayData).toBe(got[0]!.data);
    const file = decode(got[0]!.data);
    expect(file).toMatchObject({ kind: 'game', id: host.replayId, game: { mode: 'onlineGuest', savedBy: g.player, ended: expect.stringMatching(/finished|conceded/) } });
    // The seats in seating order (the config's, CR 806.3; the state's list starts with the starting player, CR 103.1), every one a person who agreed.
    const seating = file.play!.config.players.map((p) => p.id!);
    expect(new Set(seating)).toEqual(new Set(final.players.map((p) => p.id)));
    expect(file.reveal).toEqual({ policy: 'all', agreed: seating });
    expect(file.game.players.map((p) => [p.id, p.kind])).toEqual(seating.map((id) => [id, 'person']));
    expect(file.play!.config.seed).toBe(w.seed);
    expect(file.play!.actions).toHaveLength(host.seq);
    expect(file.game.result).toEqual({ winner: final.result!.winner, reason: final.result!.reason });
    const states = statesOf(file.play!.config, file.play!.actions);
    expect(gameDigest(states[states.length - 1]!)).toBe(gameDigest(final));
    // Every checkpoint is the digest of the state after its action (the replay checks itself, design 5).
    for (const c of file.play!.checkpoints) expect(gameDigest(states[c.action + 1]!), `checkpoint ${c.action}`).toBe(c.digest);
    expect(file.play!.checkpoints.at(-1)!.action).toBe(host.seq - 1);
    // The views this guest was shown live are its seat's views of the replay at the same point.
    let views = 0;
    for (const m of g.inbox as { type?: string; seq?: number; view?: GameView }[]) {
      if (m.type !== 'view') continue;
      expect(viewFor(states[m.seq!]!, g.player), `${g.player} view ${m.seq}`).toEqual(m.view);
      views++;
    }
    expect(views).toBeGreaterThan(5);
  }
  expect(w.lines.shared).toEqual([true]);
  expect(host.replayShared).toBe(true);
}

/** The record lines the host told its server: one start with the seed, one line per applied action in order, one end. */
function expectRecord(w: Watched): void {
  const host = w.table.host;
  expect(w.lines.start).toHaveLength(1);
  expect(w.lines.start[0]).toMatchObject({ id: host.replayId, host: 'p1', config: { seed: w.seed } });
  expect(w.lines.actions.map((l) => l.i)).toEqual([...Array(host.seq).keys()]);
  expect(w.lines.ends).toHaveLength(1);
  expect(w.lines.ends[0]!.result).toEqual({ winner: host.state!.result!.winner, reason: host.state!.result!.reason });
}

describe('RPL-3: no game data reaches a guest without every person\'s agreement', () => {
  for (const seats of [2, 3, 4] as const) {
    it(`${seats} players: everyone but one agreed: nothing of the game reaches a guest, before or after the end`, async () => {
      const w = await table(seats, 'none');
      const bots = runBots(w.table);
      // Everyone but the last guest agrees (the host by its own UI, the guests by message).
      w.table.host.setReplayConsent(true);
      for (const g of w.table.guests.slice(0, -1)) g.guest.setReplayConsent(true);
      await untilOver(w.table);
      bots.stop();
      await new Promise((r) => setTimeout(r, 100));
      expect([...w.table.host.replayAgreed].sort()).toEqual(['p1', ...w.table.guests.slice(0, -1).map((g) => g.player)].sort());
      expectNothingShared(w);
      expect(w.lines.shared).toEqual([]);
      expect(w.table.host.replayShared).toBeNull();
      expectRecord(w);
    });
  }

  it('everyone agrees during the game: still nothing before the end (the seed would reveal the hidden cards), then each guest gets its copy', async () => {
    const w = await table(2, 'during');
    w.table.host.setReplayConsent(true);
    w.table.guests[0]!.guest.setReplayConsent(true);
    await until(() => w.table.host.replayAgreed.length === 2, 3000, 'both choices');
    const bots = runBots(w.table);
    await until(() => w.table.host.seq > 10, 30000, 'some actions');
    expectNothingShared(w); // everyone agreed, but the game is not over
    await untilOver(w.table);
    bots.stop();
    await until(() => replayGames(w.table.guests[0]!).length === 1, 5000, 'the copy');
    expectShared(w);
    expectRecord(w);
  });
});

describe('RPL-3: the game is shared after the end, when every player agreed (2, 3 and 4 players)', () => {
  for (const seats of [2, 3, 4] as const) {
    it(`${seats} players: the last agreement comes after the end; each guest gets its own copy once, and later choices change nothing`, async () => {
      const w = await table(seats, 'after');
      const bots = runBots(w.table);
      for (const g of w.table.guests) g.guest.setReplayConsent(true);
      await untilOver(w.table);
      bots.stop();
      await new Promise((r) => setTimeout(r, 100));
      expectNothingShared(w); // the host has not agreed yet
      w.table.host.setReplayConsent(true); // the end screen's toggle
      await until(() => w.table.guests.every((g) => replayGames(g).length === 1), 5000, 'every copy');
      expectShared(w);
      // Final: a later choice is not even recorded, and nothing is sent again.
      const consents = w.lines.consent.length;
      w.table.host.setReplayConsent(false);
      w.table.guests[0]!.guest.setReplayConsent(false);
      await new Promise((r) => setTimeout(r, 150));
      expect(w.lines.consent).toHaveLength(consents);
      for (const g of w.table.guests) expect(replayGames(g)).toHaveLength(1);
      expect(w.lines.shared).toEqual([true]);
    });
  }

  it('a choice taken back before the end counts as taken back (the last choice counts)', async () => {
    const w = await table(2, 'back');
    w.table.host.setReplayConsent(true);
    const g = w.table.guests[0]!;
    g.guest.setReplayConsent(true);
    g.guest.setReplayConsent(false);
    const bots = runBots(w.table);
    await untilOver(w.table);
    bots.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(w.table.host.replayAgreed).toEqual(['p1']);
    expectNothingShared(w);
  });
});

describe('RPL-3: a leaver\'s last choice counts (CR 104.3a, 800.4a)', () => {
  it('3 players: a guest agrees and leaves during the game; when the others agree after the end, the guest still there gets the game', async () => {
    const w = await table(3, 'leaver-yes');
    const [p2, p3] = w.table.guests as [Seat, Seat];
    p3.guest.setReplayConsent(true);
    await until(() => w.table.host.replayAgreed.includes('p3'), 3000, 'p3\'s choice');
    const bots = runBots(w.table);
    await until(() => w.table.host.seq > 6, 30000, 'some actions');
    await p3.guest.close('the guest left the game'); // a bye: its concession (CR 104.3a); the game goes on for the others
    await until(() => w.table.host.state!.players.find((p) => p.id === 'p3')!.hasLost, 5000, 'p3\'s concession');
    w.table.host.setReplayConsent(true);
    p2.guest.setReplayConsent(true);
    await untilOver(w.table);
    bots.stop();
    await until(() => replayGames(p2).length === 1, 5000, 'p2\'s copy');
    // Seating order (CR 806.3), the leaver included.
    expect(w.table.host.replayAgreed).toEqual(w.lines.start[0]!.players.map((p) => p.id));
    expectShared(w);
    expect(replayGames(p3)).toEqual([]); // it left: it keeps its own recording only
  });

  it('3 players: a guest leaves without agreeing; the others agree; nobody gets the game', async () => {
    const w = await table(3, 'leaver-no');
    const [p2, p3] = w.table.guests as [Seat, Seat];
    const bots = runBots(w.table);
    await until(() => w.table.host.seq > 6, 30000, 'some actions');
    await p3.guest.close('the guest left the game');
    w.table.host.setReplayConsent(true);
    p2.guest.setReplayConsent(true);
    await untilOver(w.table);
    bots.stop();
    await new Promise((r) => setTimeout(r, 150));
    expect(w.table.host.replayAgreed.sort()).toEqual(['p1', 'p2']);
    expectNothingShared(w);
  });

  it('2 players: the guest agreed, then its link closed after the end; the host agreeing later shares nothing with it, and nothing throws', async () => {
    const w = await table(2, 'gone');
    const g = w.table.guests[0]!;
    g.guest.setReplayConsent(true);
    const bots = runBots(w.table);
    await untilOver(w.table);
    bots.stop();
    await g.guest.close('the guest left the game');
    await until(() => !w.table.host.connected('p2'), 3000, 'the guest gone');
    w.table.host.setReplayConsent(true);
    expect(w.table.host.replayShared).toBe(true); // made, but there is nobody to send it to
    expect(replayGames(g)).toEqual([]);
  });
});

type Inbound = { type?: string; code?: string; data?: string };

/**
 * A two-player game in process (`host`: more host options), its host's replay choices watched; the guest's every message is kept (`onMessage` sees each
 * as it arrives). `cut`: while `on`, the guest's reconnection finds no host (a cut link; it tries again every 50 ms); `transport.cut()` drops the link.
 */
async function duel(
  tag: string,
  host: Partial<Parameters<typeof GameHost.attach>[0]> = {},
  o: { cut?: { on: boolean }; onMessage?: (m: Inbound, guest: GameGuest) => void } = {},
) {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const h = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), cards: fixtureDb(), seed: `rpl3-duel-${tag}`, ...host }, transport);
  cleanups.push(() => h.close('test over', 100));
  const seen: PlayerId[][] = [];
  h.on('replayConsent', (a) => seen.push(a));
  const inbox: Inbound[] = [];
  let joined: GameGuest | null = null;
  const g = await GameGuest.join({
    host: 'memory', port: 0, code: h.code, name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }), link: TABLE_LINK, reconnect: { attempts: 400, delayMs: 50 },
    connector: (x) => (o.cut?.on ? Promise.reject(new NetError('timeout', 'No answer from the host (the link is cut).')) : transport.connect(x.link)),
    inspect: (m) => {
      inbox.push(m as Inbound);
      if (joined) o.onMessage?.(m as Inbound, joined);
    },
  });
  joined = g;
  cleanups.push(() => g.close());
  await until(() => g.view !== null, 3000, 'the first view');
  return { host: h, guest: g, transport, seen, inbox };
}

/** Drop the duel's link and keep it down (`cut.on`) until the guest has noticed (its idle timeout). */
async function cutLink(d: { transport: MemoryTransport; guest: GameGuest }, cut: { on: boolean }): Promise<void> {
  cut.on = true;
  d.transport.cut();
  await until(() => !d.guest.connected, 5000, 'the guest noticing the cut link');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RPL-3: a guest\'s choices are paced per seat like its stop changes (the last choice counts)', { timeout: 30_000 }, () => {
  it('beyond the burst the latest choice waits for a token and is applied alone; none is refused', async () => {
    const d = await duel('pace', { guestLimits: { consent: { rate: 10, burst: 2 } } });
    for (const agree of [true, false, true, false, true]) expect(d.guest.setReplayConsent(agree)).toBe(true);
    await until(() => d.seen.length >= 3, 3000, 'the waiting choice');
    await sleep(250);
    // Two within the burst at once; of the three beyond it only the last (agree) counts, when a token came back.
    expect(d.seen).toEqual([['p2'], [], ['p2']]);
    expect(d.host.replayAgreed).toEqual(['p2']);
    expect(d.inbox.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('the game is not shared while a choice that takes the agreement back waits for its pace', async () => {
    const d = await duel('pace-share', { guestLimits: { consent: { rate: 0.5, burst: 1 } } });
    d.host.setReplayConsent(true);
    d.guest.setReplayConsent(true);
    await until(() => d.host.replayAgreed.length === 2, 3000, 'both choices');
    d.guest.setReplayConsent(false); // no token for 2 s: it waits
    await sleep(150);
    // The host concedes (CR 104.3a): the game is over and both had agreed, but the guest's last choice is still on its way.
    expect(d.host.act({ type: 'concede', player: 'p1' }).ok).toBe(true);
    expect(d.host.state!.result).toBeTruthy();
    expect(d.host.replayShared).toBeNull();
    await until(() => !d.host.replayAgreed.includes('p2'), 5000, 'the guest\'s last choice');
    await sleep(100);
    expect(d.host.replayShared).toBeNull();
    expect(d.guest.replayData).toBeNull();
    expect(d.inbox.filter((m) => m.type === 'replayGame')).toEqual([]);
  });
});

describe('RPL-3: a guest whose link drops (a reconnection, a resume)', { timeout: 30_000 }, () => {
  it('a choice made while the link is down is sent on the reconnection: the host gets the last choice', async () => {
    const cut = { on: false };
    const d = await duel('resend', {}, { cut });
    d.host.setReplayConsent(true);
    await cutLink(d, cut);
    expect(d.guest.setReplayConsent(true)).toBe(false); // not sent now: the link is down
    await sleep(100);
    expect(d.host.replayAgreed).toEqual(['p1']);
    cut.on = false;
    await until(() => d.host.replayAgreed.length === 2, 10000, 'the choice sent on the reconnection');
    expect(d.host.replayAgreed).toEqual(['p1', 'p2']);
  });

  it('the game shared while the guest was away reaches it on its resume, once', async () => {
    const cut = { on: false };
    const d = await duel('resume-copy', {}, { cut });
    d.host.setReplayConsent(true);
    d.guest.setReplayConsent(true);
    await until(() => d.host.replayAgreed.length === 2, 3000, 'both choices');
    await cutLink(d, cut);
    // The host concedes while the guest is away (CR 104.3a): the game is over and every player agreed, so it is shared; the guest's link is down.
    expect(d.host.act({ type: 'concede', player: 'p1' }).ok).toBe(true);
    expect(d.host.replayShared).toBe(true);
    expect(d.guest.replayData).toBeNull();
    cut.on = false;
    await until(() => d.guest.replayData !== null, 10000, 'the copy on the resume');
    expect(decode(d.guest.replayData!)).toMatchObject({ kind: 'game', id: d.host.replayId, game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { policy: 'all' } });
    await until(() => d.guest.view?.result != null, 3000, 'the final view');
    expect(d.inbox.filter((m) => m.type === 'replayGame')).toHaveLength(1);
  });

  it('a copy sent again (the link dropped again before the final view came) is kept and told once', async () => {
    const cut = { on: false };
    let copies = 0;
    // The resume sends the copy right after its welcome, before the view the guest's sync asks for: the link drops again just after the copy.
    const d = await duel('copy-twice', {}, { cut, onMessage: (m, g) => m.type === 'replayGame' && ++copies === 1 && setImmediate(() => g.connection?.destroy('the link dropped again')) });
    const told: string[] = [];
    d.guest.on('replayGame', (data) => told.push(data));
    d.host.setReplayConsent(true);
    d.guest.setReplayConsent(true);
    await until(() => d.host.replayAgreed.length === 2, 3000, 'both choices');
    await cutLink(d, cut);
    expect(d.host.act({ type: 'concede', player: 'p1' }).ok).toBe(true);
    cut.on = false;
    await until(() => copies === 2, 15000, 'the copy of the second resume');
    await until(() => d.guest.view?.result != null, 5000, 'the final view');
    expect(told).toHaveLength(1);
    expect(d.guest.replayData).toBe(told[0]);
  });
});

describe('RPL-3: a lobby seat that opens again forgets its guest\'s choice', { timeout: 60_000 }, () => {
  it('3 players: p3 agrees in the lobby and leaves; the new p3 never agrees: nobody gets the game', async () => {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const seed = 'rpl3-secret-seed-reseat';
    const host = await GameHost.attach({ name: SEATS[0]!.name, deck: SEATS[0]!.deck, cards: fixtureDb(), seats: 3, seed, ...FAST_GAME }, transport);
    const first = await joinSeat(host, transport, 3);
    first.guest.setReplayConsent(true);
    await until(() => host.replayAgreed.includes('p3'), 3000, 'p3\'s choice in the lobby');
    await first.guest.close('the guest left the table'); // a bye in the lobby: the seat opens again
    await until(() => !host.replayAgreed.includes('p3'), 3000, 'the freed seat\'s choice forgotten');
    const p3 = await joinSeat(host, transport, 3);
    const p2 = await joinSeat(host, transport, 2);
    const t: Table = { host, transport, guests: [p2, p3], hostViews: [], close: async () => { await p2.guest.close(); await p3.guest.close(); await host.close('test over', 200); } };
    cleanups.push(() => t.close());
    await until(() => t.guests.every((g) => g.guest.view !== null), 5000, 'the first views');
    host.setReplayConsent(true);
    p2.guest.setReplayConsent(true);
    await until(() => host.replayAgreed.length === 2, 3000, 'the others\' choices');
    const bots = runBots(t);
    await untilOver(t);
    bots.stop();
    await sleep(150);
    expect([...host.replayAgreed].sort()).toEqual(['p1', 'p2']);
    expect(host.replayShared).toBeNull();
    expectNothingShared({ table: t, seed, lines: { start: [], actions: [], ends: [], consent: [], shared: [] } });
  });
});

describe('RPL-3: a guest of a new process says nothing of its own accord', () => {
  it('GameGuest sends a choice only when its player makes one', async () => {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const host = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), cards: fixtureDb(), seed: 'rpl3-consent' }, transport);
    cleanups.push(() => host.close('test over', 100));
    const seen: PlayerId[][] = [];
    host.on('replayConsent', (a) => seen.push(a));
    const guest = await GameGuest.join({ host: 'memory', port: 0, code: host.code, name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }), link: TABLE_LINK, connector: (o) => transport.connect(o.link) });
    cleanups.push(() => guest.close());
    await until(() => guest.view !== null, 3000, 'the first view');
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([]);
    expect(guest.setReplayConsent(true)).toBe(true);
    await until(() => seen.length === 1, 3000, 'the choice');
    expect(seen).toEqual([['p2']]);
    expect(host.replayAgreed).toEqual(['p2']);
  });
});
