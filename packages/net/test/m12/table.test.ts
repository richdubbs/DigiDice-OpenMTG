/**
 * M12-5a (docs/design/m12-multiplayer.md section 6): online games of 3 and 4 players in process (MemoryTransport, normal traffic only: no
 * hostile network testing). The lobby and the start when every seat is taken, random seating from the seed (CR 806.3), per-player views and events
 * (CR 400.2: every message each guest receives is scanned), the drop clock and its forfeit (CR 104.3a), a return within the clock, a
 * guest leaving and the host leaving while the game goes on for the others (CR 104.5, 800.4a).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seatAtRandom } from '../../src/game/seating';
import { openTable, runBots, scanInbox, SEATS, until, untilOver, type Table } from './table';

const open: Table[] = [];
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});

async function table(...args: Parameters<typeof openTable>): Promise<Table> {
  const t = await openTable(...args);
  open.push(t);
  return t;
}

/** Messages of a type a guest received. */
const received = (inbox: unknown[], type: string) => inbox.filter((m) => (m as { type?: string }).type === type) as Record<string, unknown>[];

describe('M12-5a: a 3-player online game (one host, two guests)', () => {
  it('lobby in any order, start when every seat is taken, seated at random from the seed; a whole game where nobody sees another\'s hidden cards (CR 400.2)', async () => {
    const t = await table(3, { order: [3, 2] });
    const { host, guests } = t;
    expect(host.codes.map((c) => c.seat)).toEqual([2, 3]);
    expect(new Set(host.codes.map((c) => c.code)).size).toBe(2); // one code per seat (owner)
    await until(() => guests.every((g) => g.guest.started), 5000, 'the start at every guest');
    expect(guests.map((g) => g.guest.seat)).toEqual([2, 3]);
    expect(guests.map((g) => g.guest.seats)).toEqual([3, 3]);
    // Seat 3 joined first: it saw the lobby with seat 2 open, then with everyone.
    const lobbies = received(guests[1]!.inbox, 'lobby');
    expect((lobbies[0]!['players'] as { id: string }[]).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect((lobbies.at(-1)!['players'] as { id: string }[]).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    // CR 806.3, m12 D2: the table in seating order, shuffled from the seed (the host's state agrees).
    const start = received(guests[0]!.inbox, 'start')[0]!['players'] as { id: string; seat: number }[];
    expect(start.map((p) => p.id)).toEqual(seatAtRandom(['p1', 'p2', 'p3'], 'm12-table-3'));
    expect(received(guests[1]!.inbox, 'start')[0]!['players']).toEqual(start);
    expect(host.state!.options.multiplayer).toEqual({ variant: 'freeForAll', attack: 'multiple' });
    expect(guests[0]!.guest.players.map((p) => p.id)).toEqual(start.map((p) => p.id));

    const bots = runBots(t);
    await untilOver(t);
    bots.stop();
    expect(bots.problems).toEqual([]);
    expect(host.state!.turn.number).toBeGreaterThan(3);
    for (const g of guests) {
      const others = SEATS.slice(0, 3).filter((s) => s.name !== g.name).map((s) => s.marker);
      const scan = scanInbox(g, others);
      expect(scan.views).toBeGreaterThan(20);
      expect(scan.hidden).toBeGreaterThan(100);
      expect(g.guest.view!.result).toEqual(host.state!.result);
    }
    // The host's page: only the host's view; the guests' markers never in it.
    const hostText = JSON.stringify(t.hostViews);
    for (const m of [SEATS[1]!.marker, SEATS[2]!.marker]) expect(hostText).not.toContain(m);
    expect(t.hostViews.every((v) => v.viewer === 'p1')).toBe(true);
  }, 180000);
});

describe('M12-5a: a 4-player online game (one host, three guests)', () => {
  it('a guest leaves mid-game (concession, CR 104.3a): the game goes on for the others to the end; nobody sees another\'s hidden cards', async () => {
    const t = await table(4, { order: [2, 4, 3], host: { gameOptions: { skipMulligans: true } as never } });
    const { host, guests } = t;
    await until(() => host.started, 5000, 'the start');
    expect(host.state!.players).toHaveLength(4);
    const bots = runBots(t);
    await until(() => (host.state?.turn.number ?? 0) >= 3, 60000, 'turn 3');
    // Bianca (p3) leaves: her page's Leave concedes first, then says bye (bridge.ts, CL4).
    const bianca = guests.find((g) => g.player === 'p3')!;
    expect((await bianca.guest.act({ type: 'concede', player: 'p3' })).ok).toBe(true);
    await bianca.guest.close('the guest left the game');
    const gus = guests.find((g) => g.player === 'p2')!;
    await until(() => received(gus.inbox, 'notice').some((n) => n['kind'] === 'left' && n['player'] === 'p3'), 5000, 'the notice');
    expect(received(gus.inbox, 'notice').find((n) => n['player'] === 'p3' && n['kind'] === 'left')!['text']).toBe('Bianca left the game and conceded (CR 104.3a).');
    expect(host.state!.result).toBeNull(); // the game goes on (CR 104.5, 800.4a)
    expect(host.state!.players.find((p) => p.id === 'p3')!.left).toBeDefined();
    await until(() => gus.guest.players.find((p) => p.id === 'p3')?.left === true, 5000, 'presence: p3 left');
    await untilOver(t);
    bots.stop();
    expect(bots.problems).toEqual([]);
    for (const g of guests) {
      const others = SEATS.filter((s) => s.name !== g.name).map((s) => s.marker);
      expect(scanInbox(g, others).views).toBeGreaterThan(5);
    }
  }, 180000);
});

describe('M12-5a: links that drop', () => {
  it('a guest whose link drops and does not come back forfeits when the clock runs out (CR 104.3a); everyone saw the clock', async () => {
    const t = await table(3, { host: { forfeitAfterMs: 1500, gameOptions: { skipMulligans: true } as never }, guest: { reconnect: { attempts: 0 } } });
    const { host, guests } = t;
    await until(() => host.started, 5000, 'the start');
    const [gus, bianca] = guests as [typeof guests[0], typeof guests[0]];
    const bots = runBots(t);
    await until(() => (host.state?.actionCount ?? 0) > 10, 30000, 'some actions');
    gus.guest.connection!.destroy('cable cut'); // no bye: the host notices by its idle timeout
    await until(() => bianca.guest.players.find((p) => p.id === 'p2')?.forfeitAt !== undefined, 5000, 'the clock at the other guest');
    const clock = bianca.guest.players.find((p) => p.id === 'p2')!;
    expect(clock.connected).toBe(false);
    expect(clock.forfeitAt! - Date.now()).toBeGreaterThan(0);
    expect(clock.forfeitAt! - Date.now()).toBeLessThanOrEqual(1500);
    expect(host.players().find((p) => p.id === 'p2')!.forfeitInMs).toBeGreaterThan(0);
    expect(received(bianca.inbox, 'notice').some((n) => n['kind'] === 'dropped' && n['player'] === 'p2')).toBe(true);
    await until(() => host.state!.players.find((p) => p.id === 'p2')!.hasLost, 5000, 'the forfeit');
    expect(host.state!.players.find((p) => p.id === 'p2')!.conceded).toBe(true);
    await until(() => received(bianca.inbox, 'notice').some((n) => n['kind'] === 'forfeited' && n['player'] === 'p2'), 3000, 'the forfeit notice');
    expect(received(bianca.inbox, 'notice').find((n) => n['kind'] === 'forfeited')!['text']).toBe('Gus was disconnected for 2 seconds in all: they forfeit the game (CR 104.3a).');
    // The game goes on between the two left (CR 800.4a) to its end.
    await until(() => host.state!.result !== null, 120000, 'the end');
    bots.stop();
    expect(bots.problems).toEqual([]);
  }, 180000);

  it('a guest that comes back within the clock takes its seat back: the clock is cancelled and the game goes on as if nothing happened', async () => {
    const t = await table(3, { host: { forfeitAfterMs: 5000, gameOptions: { skipMulligans: true } as never }, guest: { reconnect: { attempts: 40, delayMs: 50 } } });
    const { host, guests } = t;
    await until(() => host.started, 5000, 'the start');
    const [gus, bianca] = guests as [typeof guests[0], typeof guests[0]];
    const bots = runBots(t);
    await until(() => (host.state?.actionCount ?? 0) > 10, 30000, 'some actions');
    const events: string[] = [];
    gus.guest.on('disconnected', () => events.push('disconnected'));
    gus.guest.on('reconnected', () => events.push('reconnected'));
    gus.guest.connection!.destroy('cable cut');
    await until(() => events.includes('reconnected'), 10000, 'the return');
    await until(() => host.connected('p2') && bianca.guest.players.find((p) => p.id === 'p2')?.connected === true, 5000, 'presence: back');
    expect(host.players().find((p) => p.id === 'p2')!.forfeitInMs).toBeUndefined();
    expect(host.state!.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
    await untilOver(t);
    bots.stop();
    expect(bots.problems).toEqual([]);
    expect(scanInbox(gus, [SEATS[0]!.marker, SEATS[2]!.marker]).views).toBeGreaterThan(5);
  }, 180000);
});

describe('M12-5a: the host leaves', () => {
  it('the host concedes and its machine keeps running the game for the others to the end; the host\'s page watches', async () => {
    const t = await table(3, { host: { gameOptions: { skipMulligans: true } as never } });
    const { host, guests } = t;
    await until(() => host.started, 5000, 'the start');
    const bots = runBots(t);
    await until(() => (host.state?.turn.number ?? 0) >= 2, 30000, 'turn 2');
    expect(host.leave()).toEqual({ ok: true });
    expect(host.spectating).toBe(true);
    expect(host.state!.players.find((p) => p.id === 'p1')!.conceded).toBe(true);
    expect(host.state!.result).toBeNull();
    for (const g of guests) {
      await until(() => received(g.inbox, 'notice').some((n) => n['kind'] === 'left' && n['player'] === 'p1'), 5000, 'the notice');
    }
    expect(received(guests[0]!.inbox, 'notice').find((n) => n['player'] === 'p1')!['text']).toMatch(/Hana left the game and conceded \(CR 104\.3a\); their OpenMTG keeps running the game/);
    const before = t.hostViews.length;
    await untilOver(t);
    bots.stop();
    expect(bots.problems).toEqual([]);
    expect(host.state!.result!.winner === 'p2' || host.state!.result!.winner === 'p3' || host.state!.result!.winner === null).toBe(true);
    // The host's page kept getting views as a spectator: no hand any more (its cards left the game with it, CR 800.4a).
    expect(t.hostViews.length).toBeGreaterThan(before);
    expect(t.hostViews.at(-1)!.zones.hand['p1'] ?? []).toEqual([]);
  }, 180000);

  it('M12 gaps (STATUS "Wave M12" gap 5): with one other player left, the host\'s leave ends the game (CR 104.2a): game over, no spectator, a notice that says so', async () => {
    const t = await table(3, { host: { gameOptions: { skipMulligans: true } as never } });
    const { host, guests } = t;
    await until(() => host.started && guests.every((g) => g.guest.view !== null), 5000, 'the start');
    const [gus, bianca] = guests as [typeof guests[0], typeof guests[0]];
    expect((await bianca.guest.act({ type: 'concede', player: 'p3' })).ok).toBe(true);
    await until(() => host.state!.players.find((p) => p.id === 'p3')!.hasLost, 5000, 'Bianca out');
    let over = false;
    host.on('gameOver', () => { over = true; });
    expect(host.leave()).toEqual({ ok: true });
    expect(over).toBe(true);
    expect(host.state!.result).toMatchObject({ winner: 'p2' });
    expect(host.spectating).toBe(false);
    await until(() => received(gus.inbox, 'notice').some((n) => n['kind'] === 'left' && n['player'] === 'p1'), 5000, 'the notice');
    const text = received(gus.inbox, 'notice').find((n) => n['kind'] === 'left' && n['player'] === 'p1')!['text'] as string;
    expect(text).toBe('Hana left the game and conceded (CR 104.3a), which ends it (CR 104.2a).');
    expect(text).not.toMatch(/keeps running/);
    expect(host.leave()).toMatchObject({ ok: false }); // the game is over already: a second Leave is a close, not another leave
  }, 60000);

  it('M12 gaps: a host already out of the game (it conceded) who leaves is not said to concede again; its OpenMTG keeps running the game', async () => {
    const t = await table(4, { host: { gameOptions: { skipMulligans: true } as never } });
    const { host, guests } = t;
    await until(() => host.started && guests.every((g) => g.guest.view !== null), 5000, 'the start');
    expect(host.act({ type: 'concede', player: 'p1' }).ok).toBe(true);
    expect(host.state!.result).toBeNull();
    expect(host.leave()).toEqual({ ok: true });
    expect(host.spectating).toBe(true);
    await until(() => received(guests[0]!.inbox, 'notice').some((n) => n['kind'] === 'left' && n['player'] === 'p1'), 5000, 'the notice');
    expect(received(guests[0]!.inbox, 'notice').find((n) => n['kind'] === 'left' && n['player'] === 'p1')!['text']).toBe('Hana left; their OpenMTG keeps running the game for the others.');
  }, 60000);
});

describe('M12-5a: the lobby (one code per seat)', () => {
  it('a seat\'s code is spent once its guest sits: another guest with it is refused; a guest leaving the lobby frees its seat for a new one', async () => {
    const t = await table(3, { order: [2] });
    const { host, transport } = t;
    expect(host.started).toBe(false);
    const { GameGuest } = await import('../../src/game/guest');
    const { deck, FAST_LINK } = await import('../helpers');
    const seat2 = host.codes[0]!.code;
    const intruder = GameGuest.join({ host: 'memory', port: 0, code: seat2, name: 'Ivy', deck: deck({ Forest: 40 }), link: FAST_LINK, connector: (g) => transport.connect(g.link, g.code) });
    await expect(intruder).rejects.toMatchObject({ code: 'gameFull' });
    // A code that is not this game's.
    const stranger = GameGuest.join({ host: 'memory', port: 0, code: '9SGB-3RYP-M8EN-6XDV', name: 'Ivy', deck: deck({ Forest: 40 }), link: FAST_LINK, connector: (g) => transport.connect(g.link, g.code) });
    await expect(stranger).rejects.toMatchObject({ code: 'badCode' });
    // Gus leaves the lobby: seat 2 is open again and its code admits a new guest.
    await t.guests[0]!.guest.close('changed my mind');
    t.guests.length = 0;
    await until(() => host.players().find((p) => p.seat === 2)!.taken === false, 3000, 'the free seat');
    const { joinSeat } = await import('./table');
    t.guests.push(await joinSeat(host, transport, 2), await joinSeat(host, transport, 3));
    await until(() => host.started, 5000, 'the start');
  }, 60000);

  it('a dropped lobby guest that does not come back loses its seat when the clock runs out', async () => {
    const t = await table(4, { order: [3], host: { forfeitAfterMs: 300 }, guest: { reconnect: { attempts: 0 } } });
    const { host } = t;
    t.guests[0]!.guest.connection!.destroy('cable cut');
    await until(() => host.players().find((p) => p.seat === 3)!.connected === false, 3000, 'the drop');
    expect(host.players().find((p) => p.seat === 3)!.taken).toBe(true);
    await until(() => host.players().find((p) => p.seat === 3)!.taken === false, 3000, 'the seat to open');
    expect(host.started).toBe(false);
  }, 30000);
});
