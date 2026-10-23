/**
 * M13-11: `HostedConnection`, a game on the DigiDice server as a `GameConnection` (connection/HostedConnection.ts): what the screen gets, how actions are
 * answered, and what `status()` says about the link and the server. The board, prompts and the pacer see the same interface as for a local or an online game.
 */
import { describe, expect, it, vi } from 'vitest';
import { HostedConnection } from '../../src/connection/HostedConnection';
import { PacedConnection } from '../../src/connection/PacedConnection';
import { sealConnection } from '../../src/game/sealed';
import { clockMsg, fakeHosted, gameViews, seatView, tableMsg, welcomeMsg } from './fakes';

/** A link in a running game: seat 1 is p1 and has the first view. */
async function inGame(o: { seats?: number } = {}) {
  const h = fakeHosted({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
  await h.link.connect();
  const seats = Array.from({ length: o.seats ?? 2 }, (_, i) => seatView((i + 1) as 1 | 2 | 3 | 4, ['Alice', 'Bob', 'Carol', 'Dan'][i]!));
  h.socket().push(tableMsg({ status: 'playing', seats }));
  const g = gameViews();
  h.socket().push(g.full('p1'));
  const conn = new HostedConnection(h.link);
  return { ...h, g, conn };
}

describe('HostedConnection', () => {
  it('needs a game that has a view', async () => {
    const h = fakeHosted();
    await h.link.connect();
    expect(() => new HostedConnection(h.link)).toThrow(/no view yet/);
  });

  it('is a remote game of one player: no undo, no hand-off, only this player seated', async () => {
    const { conn, g } = await inGame();
    expect(conn.kind).toBe('remote');
    expect(conn.view().viewer).toBe('p1');
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
    expect(conn.handoff()).toBeNull();
    expect(conn.seated()).toEqual(['p1']);
    expect(conn.legalActions()).toEqual(g.full('p1').legal);
    expect(conn.status()).toBeNull();
    expect(conn.clocks()).toBeNull();
  });

  it('follows the link: a patch is a new view, its events are the batch for the board, and a resend of the same seq is not a new batch', async () => {
    const { conn, g, socket } = await inGame();
    const seen = vi.fn();
    conn.subscribe(seen);
    const first = conn.view();
    expect(conn.events()).toEqual({ seq: 1, events: [] });
    const events = g.step();
    socket().push(g.patch('p1', 1, events));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(conn.view()).not.toBe(first);
    expect(conn.events().seq).toBe(g.seq);
    expect(conn.events().events).toEqual(events);
    const batch = conn.events();
    // a new socket resends the view held, without events: the board does not play the same change twice
    socket().push({ ...g.full('p1'), events: [] });
    expect(conn.events()).toBe(batch);
  });

  it('is stable between changes, and unsubscribing stops the notices', async () => {
    const { conn, g, socket } = await inGame();
    const seen = vi.fn();
    const stop = conn.subscribe(seen);
    expect(conn.view()).toBe(conn.view());
    expect(conn.legalActions()).toBe(conn.legalActions());
    stop();
    g.step();
    socket().push(g.patch('p1', 1));
    expect(seen).not.toHaveBeenCalled();
    expect(conn.view().turn).toBeDefined();
  });

  it('announces the clocks and holds them as the link does', async () => {
    const { conn, socket } = await inGame();
    const seen = vi.fn();
    conn.subscribe(seen);
    socket().push(clockMsg(5000, [{ seat: 1, running: true, delayMs: 5000 }, { seat: 2 }]));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(conn.clocks()?.seats.map((s) => s.seat)).toEqual([1, 2]);
    expect(conn.clocks()).toBe(conn.clocks());
  });

  it('sends this player\'s actions, with the next command number, and answers ok on the server\'s ok', async () => {
    const { conn, socket, g } = await inGame();
    const p = conn.act({ type: 'pass', player: 'p1' });
    await Promise.resolve();
    expect(socket().last('act')).toMatchObject({ t: 'act', seq: g.seq, action: { type: 'pass', player: 'p1' } });
    socket().reply('act');
    expect(await p).toEqual({ ok: true });
  });

  it('refuses at once what the server would refuse: another player\'s action, the start of a game', async () => {
    const { conn, socket } = await inGame();
    expect(await conn.act({ type: 'pass', player: 'p2' })).toMatchObject({ ok: false, error: { message: /Only your own player/ } });
    expect(await conn.act({ type: 'startGame' } as never)).toMatchObject({ ok: false, error: { message: /already started/ } });
    expect(socket().all('act')).toHaveLength(0);
  });

  it('explains a refusal in words, with its rules; a stale action says to look again', async () => {
    const { conn, socket } = await inGame();
    let p = conn.act({ type: 'pass', player: 'p1' });
    await Promise.resolve();
    socket().reply('act', { error: { code: 'illegalAction', message: 'You cannot pass priority now.', rules: ['CR 117.3'] } });
    expect(await p).toEqual({ ok: false, error: { message: 'You cannot pass priority now.', rules: ['CR 117.3'] } });
    p = conn.act({ type: 'pass', player: 'p1' });
    await Promise.resolve();
    socket().reply('act', { error: { code: 'stale', message: 'The game moved on since the view this action was chosen from; choose again from the latest view.' } });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/moved on.*choose once more/);
  });

  it('never throws: a dropped socket is a rejection too', async () => {
    const { conn, socket } = await inGame();
    socket().drop(4001);
    const r = await conn.act({ type: 'pass', player: 'p1' });
    expect(r).toMatchObject({ ok: false, error: { message: expect.stringMatching(/another window|connection/) } });
  });

  it('has no legal actions once the game is over', async () => {
    const { conn, g, socket } = await inGame();
    const legal = [{ type: 'pass', label: 'Pass priority' }] as never;
    const full = g.full('p1');
    socket().push({ ...full, seq: 2, legal });
    expect(conn.legalActions()).toHaveLength(1);
    socket().push({ ...full, seq: 3, legal, view: { ...full.view, result: { winner: 'p2', reason: 'Alice conceded.', rules: ['CR 104.3a'] } } as never });
    expect(conn.view().result).not.toBeNull();
    expect(conn.legalActions()).toEqual([]);
  });

  describe('status', () => {
    it('says the link to the server is down, and that the game waits only when this player must decide', async () => {
      vi.useFakeTimers();
      try {
        const { conn, socket } = await inGame();
        socket().drop(1006);
        expect(conn.status()).toMatch(/Lost the connection to the game server; trying again/);
        expect(conn.status()).toMatch(/waits for you only when you must decide/);
        await vi.advanceTimersByTimeAsync(1000);
        socket().push(welcomeMsg({ resumed: true, table: 'T1', seat: 1 }));
        expect(conn.status()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('says another window took the game over, and the server closing the connection, with Leave', async () => {
      const { conn, socket } = await inGame();
      socket().drop(4001, 'replaced');
      expect(conn.status()).toMatch(/another window.*Leave to go back/);
    });

    it('says a game that ended without a result, in the server\'s words', async () => {
      const { conn, socket } = await inGame();
      socket().push({ t: 'result', outcome: 'void', reason: 'nobody stayed connected.', result: null, placements: [] });
      expect(conn.status()).toBe('The game ended without a result: nobody stayed connected. Leave to go back.');
    });

    it('says what the server says about a restart or a limit', async () => {
      const { conn, socket } = await inGame();
      socket().push({ t: 'notice', kind: 'serverDraining', text: 'The server restarts soon; this game may finish, but no new games start.' });
      expect(conn.status()).toBe('The server restarts soon; this game may finish, but no new games start.');
    });

    it('says in a two-player game that the other player\'s link dropped, until they are back', async () => {
      const { conn, socket } = await inGame();
      socket().push({ t: 'notice', kind: 'playerDropped', seat: 2, text: 'Seat 2 lost the connection; the game waits for them only when they must decide.' });
      expect(conn.status()).toMatch(/Bob lost the connection\. The game waits for them only when they must decide/);
      socket().push({ t: 'notice', kind: 'playerBack', seat: 2, text: 'Seat 2 is back.' });
      expect(conn.status()).toBeNull();
    });

    it('leaves the other players of a 3-4 player game to the panel', async () => {
      const { conn, socket } = await inGame({ seats: 3 });
      socket().push({ t: 'notice', kind: 'playerDropped', seat: 2, text: 'Seat 2 lost the connection.' });
      expect(conn.status()).toBeNull();
    });

    it('says nobody in the game is connected while the abandonment timer runs', async () => {
      const { conn, socket } = await inGame();
      socket().push(clockMsg(1000, [{ seat: 1 }, { seat: 2 }], 200_000));
      expect(conn.status()).toMatch(/Nobody in the game is connected/);
    });

    it('is nothing once this page closed the link itself (leaving)', async () => {
      const { conn, link } = await inGame();
      link.close();
      expect(conn.status()).toBeNull();
    });
  });

  describe('under the screen\'s own wrappers', () => {
    it('the sealed form and the paced connection both carry the clocks and the status', async () => {
      const { conn, socket } = await inGame();
      const sealed = sealConnection(conn);
      const paced = new PacedConnection(sealed, { enabled: () => false });
      const un = paced.subscribe(() => undefined);
      expect(sealed.clocks?.()).toBeNull();
      expect(paced.clocks?.()).toBeNull();
      socket().push(clockMsg(5000, [{ seat: 1, running: true }, { seat: 2 }]));
      expect(sealed.clocks?.()?.seats).toHaveLength(2);
      expect(paced.clocks?.()?.seats).toHaveLength(2);
      socket().push({ t: 'notice', kind: 'serverDraining', text: 'The server restarts soon.' });
      expect(paced.status()).toBe('The server restarts soon.');
      expect(Object.keys(sealed)).not.toContain('link');
      un();
    });

    it('a connection without clocks has none on its sealed form either', () => {
      const { conn } = { conn: sealConnection({ ...baseOf() }) };
      expect(conn.clocks).toBeUndefined();
    });
  });
});

/** The members every connection has, for a connection without clocks. */
function baseOf() {
  const view = gameViews().full('p1').view;
  return {
    kind: 'remote' as const,
    view: () => view,
    legalActions: () => [],
    act: async () => ({ ok: true as const }),
    subscribe: () => () => undefined,
    canUndo: () => false,
    undo: () => false,
    handoff: () => null,
    acceptHandoff: () => undefined,
  };
}
