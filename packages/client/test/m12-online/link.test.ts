/**
 * M12-5b (docs/design/m12-multiplayer.md 6): the link's side of a 3-4 player game, with the fake local server socket (normal traffic only): hosting with
 * seats, forfeiting a named guest, chat lines and notices that name their player, how a manual adjustments proposal ended, and the online protocol the page
 * and the server agree on.
 */
import { ONLINE_PROTOCOL } from '@openmtg/server/online';
import { describe, expect, it } from 'vitest';
import { watchLinkSounds } from '../../src/online/sounds';
import { fakeLink } from '../online-fakes';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { statusMsg, table, tableStatus, tableViews } from './fixtures';

async function open(role: 'host' | 'guest' = 'host') {
  const f = fakeLink({ initial: [statusMsg(tableStatus({ role, me: role === 'host' ? 'p1' : 'p2' }))] });
  await f.link.connect();
  return f;
}

describe('the online link with 3-4 players', () => {
  it('the page and the server speak online protocol 3 (2: the 3-4 player fields; RPL-3: the replay messages)', () => {
    expect(ONLINE_PROTOCOL).toBe(3);
  });

  it('hosts with seats (3 or 4), and a two-player host sends none', async () => {
    const f = fakeLink();
    await f.link.connect();
    const deck = { main: [{ name: 'Forest', count: 40 }], sideboard: [] };
    void f.link.host({ name: 'Alice', deck, seats: 4, port: 0 });
    expect(f.socket().last('host')).toEqual({ t: 'host', id: 1, name: 'Alice', deck, port: 0, seats: 4 });
    void f.link.host({ name: 'Alice', deck });
    expect(f.socket().last('host')).toEqual({ t: 'host', id: 2, name: 'Alice', deck });
  });

  it('forfeits a named guest (or the only one, as before)', async () => {
    const f = await open();
    void f.link.forfeit('p3');
    expect(f.socket().last('forfeit')).toEqual({ t: 'forfeit', id: 1, player: 'p3' });
    void f.link.forfeit();
    expect(f.socket().last('forfeit')).toEqual({ t: 'forfeit', id: 2 });
  });

  it('keeps who sent each chat line and whom each notice is about', async () => {
    const f = await open('guest');
    f.socket().push({ t: 'chat', text: 'hi all', from: 'p3' });
    f.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'Carol\'s link dropped: 5:00 until they forfeit.', player: 'p3' });
    expect(f.link.chat()).toEqual([{ n: 1, from: 'opponent', text: 'hi all', player: 'p3' }]);
    expect(f.link.notices()).toEqual([{ n: 2, kind: 'opponentDropped', text: 'Carol\'s link dropped: 5:00 until they forfeit.', player: 'p3' }]);
  });

  it('sounds: a player taking a seat in the lobby is net.joined; any other player leaving net.lost, coming back net.restored, chatting net.chat', async () => {
    const f = await open('host');
    const ids: string[] = [];
    const stop = watchLinkSounds(f.link, { play: (id) => ids.push(id) });
    f.socket().push({ t: 'notice', kind: 'opponentJoined', text: 'Bob took seat 2.', player: 'p2' });
    f.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'Carol\'s link dropped.', player: 'p3' });
    f.socket().push({ t: 'notice', kind: 'opponentBack', text: 'Carol is back.', player: 'p3' });
    f.socket().push({ t: 'chat', text: 'hi', from: 'p3' });
    f.socket().push({ t: 'notice', kind: 'opponentLeft', text: 'Bob left the game and conceded (CR 104.3a).', player: 'p2' });
    stop();
    expect(ids).toEqual(['net.joined', 'net.lost', 'net.restored', 'net.chat', 'net.lost']);
  });

  it('M12F: the chat the local server sends again to a reloaded page (chatHistory) is not news: no net.chat', async () => {
    const f = await open('guest');
    const ids: string[] = [];
    const stop = watchLinkSounds(f.link, { play: (id) => ids.push(id) });
    f.socket().push({ t: 'chatHistory', lines: [{ text: 'hi all', from: 'p3' }, { text: 'hello', mine: true }] });
    expect(f.link.chat()).toHaveLength(2);
    expect(ids).toEqual([]);
    f.socket().push({ t: 'chat', text: 'welcome back', from: 'p3' });
    stop();
    expect(ids).toEqual(['net.chat']);
  });

  it('a RemoteConnection acts for the status\'s player (a guest\'s seat, p2-p4) and leaves the other players\' presence to the panel', async () => {
    const g = tableViews(4);
    const f = fakeLink({ initial: [statusMsg(tableStatus({ role: 'guest', me: 'p4', seats: 4, players: table(4) })), g.msg('p4')] });
    await f.link.connect();
    const conn = new RemoteConnection(f.link);
    expect(conn.seated()).toEqual(['p4']);
    expect((await conn.act({ type: 'pass', player: 'p2' })).ok).toBe(false);
    f.socket().push(statusMsg(tableStatus({ role: 'guest', me: 'p4', seats: 4, players: table(4, [{ id: 'p2', connected: false, forfeitAt: Date.now() + 1000 }]) })));
    expect(conn.status()).toBeNull();
    f.socket().push(statusMsg(tableStatus({ role: 'guest', me: 'p4', seats: 4, phase: 'reconnecting' })));
    expect(conn.status()).toMatch(/reconnecting/);
  });

  it('a spectating host\'s connection says its server keeps running the game', async () => {
    const g = tableViews(3);
    const f = fakeLink({ initial: [statusMsg(tableStatus({ role: 'host', me: 'p1', phase: 'spectating' })), g.msg('p1')] });
    await f.link.connect();
    expect(new RemoteConnection(f.link).status()).toMatch(/^You left the game and conceded\. Your OpenMTG server keeps running the game for the others/);
  });

  it('remembers how a proposal ended (applied, rejected by whom), with whose it was and for what; a new game forgets it', async () => {
    const f = await open('guest');
    const s = f.socket();
    s.push({ t: 'manualProposal', proposal: { id: 4, sourceName: 'Fork', text: '', lines: ['Bob\'s life -3.'], player: 'p1', waiting: ['p2', 'p3'] } });
    expect(f.link.proposal()?.waiting).toEqual(['p2', 'p3']);
    s.push({ t: 'manualClosed', proposal: 4, outcome: 'rejected', by: 'p3' });
    expect(f.link.proposal()).toBeNull();
    expect(f.link.manualOutcome()).toMatchObject({ proposal: 4, outcome: 'rejected', by: 'p3', player: 'p1', sourceName: 'Fork' });
    s.push({ t: 'manualProposal', proposal: { id: 5, sourceName: 'Twincast', text: '', lines: [], player: 'p2', waiting: ['p1', 'p3'] } });
    s.push({ t: 'manualClosed', proposal: 5, outcome: 'applied' });
    expect(f.link.manualOutcome()).toMatchObject({ proposal: 5, outcome: 'applied', player: 'p2', sourceName: 'Twincast' });
    // A two-player game's manualClosed has no outcome: nothing is recorded.
    s.push({ t: 'manualClosed', proposal: 9 });
    expect(f.link.manualOutcome()?.proposal).toBe(5);
    s.push(statusMsg({ role: 'none', phase: 'idle', warnings: [] }));
    expect(f.link.manualOutcome()).toBeNull();
  });
});
