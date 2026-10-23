/**
 * RemoteConnection (milestone 9, src/connection/RemoteConnection.ts): the GameConnection of an online game over the link to the local server, with a
 * fake socket. The screen gets exactly what the server sends (this player's view, CR 400.2; its legal actions, CR 117.1; the change's events for the
 * arena animations); actions go to the server and its reply decides (CR 733); no undo or hand-off online; the link's problems are the screen's status.
 */
import type { BoardAnimator } from '../src/connection/PacedConnection';
import { describe, expect, it, vi } from 'vitest';
import { PacedConnection } from '../src/connection/PacedConnection';
import { RemoteConnection } from '../src/connection/RemoteConnection';
import { sealConnection } from '../src/game/sealed';
import { fakeLink, gameViews } from './online-fakes';
import type { OnlineStatus } from '@openmtg/server/online';

const PLAYING = (over: Partial<OnlineStatus> = {}): OnlineStatus => ({ role: 'guest', phase: 'playing', me: 'p2', opponent: 'Hana', opponentConnected: true, warnings: [], ...over });

async function seated(role: 'host' | 'guest' = 'guest') {
  const g = gameViews();
  const me = role === 'host' ? 'p1' : 'p2';
  const f = fakeLink({ initial: [{ t: 'status', status: PLAYING({ role, me, opponent: role === 'host' ? 'Gus' : 'Hana' }) }, g.msg(me)] });
  await f.link.connect();
  return { ...f, g, me, conn: new RemoteConnection(f.link) };
}

describe('RemoteConnection', () => {
  it('needs the first view; then shows the server\'s view, legal actions and events, stable between changes', async () => {
    const empty = fakeLink();
    await empty.link.connect();
    expect(() => new RemoteConnection(empty.link)).toThrow(/no view yet/);

    const { conn, g, me, socket } = await seated();
    expect(conn.kind).toBe('remote');
    const v = conn.view();
    expect(v.viewer).toBe(me);
    expect(conn.view()).toBe(v);
    expect(conn.legalActions()).toBe(conn.legalActions());
    expect(conn.events()).toEqual({ seq: 0, events: [] });
    const listener = vi.fn();
    conn.subscribe(listener);
    // A chat line or a notice is no change of the game: the view, the events and the subscribers stay put.
    socket().push({ t: 'chat', text: 'hi' });
    expect(listener).not.toHaveBeenCalled();
    const events = g.step();
    socket().push(g.msg(me, events));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(conn.view()).not.toBe(v);
    expect(conn.events()).toEqual({ seq: 1, events });
    expect(conn.events()).toBe(conn.events());
    // A resend (another socket, `status`): the same seq without events, so nothing is animated twice.
    socket().push({ ...g.msg(me), events: [] });
    expect(conn.events()).toEqual({ seq: 1, events: [] });
  });

  it('sends actions to the server and answers with its reply: the engine\'s refusal keeps its rules (CR 733), a stale action says why', async () => {
    const { conn, socket, me } = await seated();
    const pass = conn.act({ type: 'pass', player: me });
    expect(socket().last('act')).toMatchObject({ t: 'act', action: { type: 'pass', player: me } });
    socket().reply('act');
    expect(await pass).toEqual({ ok: true });
    const cast = conn.act({ type: 'cast', player: me, card: 'o9' });
    socket().reply('act', { code: 'illegalAction', message: 'That is not one of your legal actions now.', rules: ['CR 117.1'] });
    expect(await cast).toEqual({ ok: false, error: { message: 'That is not one of your legal actions now.', rules: ['CR 117.1'] } });
    const late = conn.act({ type: 'pass', player: me });
    socket().reply('act', { code: 'stale', message: 'stale' });
    const r = await late;
    expect(!r.ok && r.error.message).toMatch(/moved on/);
  });

  it('acts only for this player (not even a concession for the other, CR 104.3a), never undoes or hands off, and seats only this player', async () => {
    const { conn, socket, me } = await seated();
    const other = me === 'p2' ? 'p1' : 'p2';
    expect(await conn.act({ type: 'concede', player: other })).toMatchObject({ ok: false });
    expect(await conn.act({ type: 'pass', player: other })).toMatchObject({ ok: false });
    expect(await conn.act({ type: 'startGame' })).toMatchObject({ ok: false });
    expect(socket().sent.filter((m) => m['t'] === 'act')).toEqual([]);
    const concede = conn.act({ type: 'concede', player: me });
    socket().reply('act');
    expect(await concede).toEqual({ ok: true });
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
    expect(conn.handoff()).toBeNull();
    expect(conn.seated()).toEqual([me]);
  });

  it('a dropped local socket answers the action "disconnected" instead of hanging', async () => {
    const { conn, socket, me } = await seated();
    const pass = conn.act({ type: 'pass', player: me });
    socket().drop(1006);
    const r = await pass;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toMatch(/dropped before it answered/);
  });

  it('says what the screen must show: the host reconnecting, the guest dropped or gone, the game closed, the local server lost', async () => {
    const guest = await seated('guest');
    expect(guest.conn.status()).toBeNull();
    guest.socket().push({ t: 'status', status: PLAYING({ phase: 'reconnecting', opponentConnected: false }) });
    expect(guest.conn.status()).toMatch(/reconnecting/);
    guest.socket().push({ t: 'status', status: PLAYING({ phase: 'closed', opponentConnected: false, closedReason: 'host left: the host left the game' }) });
    expect(guest.conn.status()).toBe('The game is closed: host left: the host left the game. Leave to go back.');
    expect(guest.conn.view().viewer).toBe('p2'); // the board stays

    const host = await seated('host');
    host.socket().push({ t: 'status', status: PLAYING({ role: 'host', me: 'p1', opponent: 'Gus', opponentConnected: false }) });
    host.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'dropped' });
    expect(host.conn.status()).toMatch(/Gus's link dropped; waiting/);
    host.socket().push({ t: 'notice', kind: 'opponentLeft', text: 'The guest left.' });
    expect(host.conn.status()).toMatch(/Gus left the game.*Forfeit/);
    host.socket().drop(4003);
    expect(host.conn.status()).toMatch(/server stopped/);
  });

  it('feeds the arena animations: PacedConnection over it plays the server\'s event batch on the board (sealed like every game route)', async () => {
    const { conn, g, me, socket } = await seated();
    const sealed = sealConnection(conn);
    expect(sealed.events!()).toEqual({ seq: 0, events: [] });
    const paced = new PacedConnection(sealed);
    paced.subscribe(() => undefined); // the game screen's subscription
    const plays: number[] = [];
    const animator: BoardAnimator = {
      play: async (batch, _from, _to, commit) => {
        plays.push(batch.seq);
        await commit();
      },
      finish: () => undefined,
    };
    paced.attach(animator);
    const events = g.step();
    expect(events.length).toBeGreaterThan(0);
    socket().push(g.msg(me, events));
    expect(plays).toEqual([1]);
    expect(paced.status!()).toBeNull();
  });
});
