/**
 * M12-5b (docs/design/m12-multiplayer.md 6): the game screen of a 3-4 player online game, with the fake local server socket (normal
 * traffic only) and real views of a 3-player game: presence with a dropped player's forfeit clock counting down, back and forfeited news; the host ending
 * the game for a guest that left without conceding; by-hand changes that every other player approves (the proposer sees whom it waits for; outcomes);
 * chat with sender names; the host's Leave (concede and keep serving, a spectator; a second Leave stops it) and a guest's Leave; the end screen.
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PlayerId } from '@openmtg/engine';
import type { OnlineStatus } from '@openmtg/server/online';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { renderGameApp } from '../game-fixtures';
import { fakeLink, flush } from '../online-fakes';
import { concede } from '../../../engine/test/m12/rules/helpers';
import { statusMsg, table, tableStatus, tableViews } from './fixtures';

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

async function inGame(role: 'host' | 'guest', me: PlayerId, over: Omit<Partial<OnlineStatus>, 'role' | 'me' | 'seats'> = {}) {
  const g = tableViews(3);
  const f = fakeLink({ initial: [statusMsg(tableStatus({ role, me, ...over })), g.msg(me)] });
  await f.link.connect();
  render(renderGameApp(new RemoteConnection(f.link), { online: f.link }));
  await screen.findByLabelText('Online game');
  const push = (s: Omit<Partial<OnlineStatus>, 'role' | 'me' | 'seats'>) => reactAct(() => f.socket().push(statusMsg(tableStatus({ role, me, ...s }))));
  return { ...f, g, push };
}

const presence = () => within(screen.getByRole('list', { name: 'Players online' })).getAllByRole('listitem').map(text);
/** M12F: the table news are in the chat overlay (opened by the rail's chat button, closed again after reading). */
const news = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Table chat/ }));
  const lines = within(screen.getByRole('list', { name: 'Table news' })).getAllByRole('listitem').map(text);
  fireEvent.click(screen.getByRole('button', { name: 'Close table chat' }));
  return lines;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('presence: links, the forfeit clock, back and forfeited (m12 design 6)', () => {
  it('a dropped player\'s clock counts down on every screen; they come back; later they forfeit', async () => {
    const s = await inGame('guest', 'p2');
    expect(presence()).toEqual(['Alice: connected', 'Bob (you): connected', 'Carol: connected']);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await s.push({ players: table(3, [{ id: 'p3', connected: false, forfeitAt: Date.now() + 252_000 }]) });
    reactAct(() => s.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'Carol\'s link dropped: 5:00 until they forfeit (CR 104.3a).', player: 'p3' }));
    expect(presence()[2]).toBe('Carol: disconnected: 4:12 until they forfeit');
    expect(screen.getByRole('timer')).toBeTruthy();
    reactAct(() => vi.advanceTimersByTime(3000));
    expect(presence()[2]).toBe('Carol: disconnected: 4:09 until they forfeit');
    expect(news()).toEqual(['Carol\'s link dropped: 5:00 until they forfeit (CR 104.3a).']);
    // The screen's own status line stays quiet: the table's presence is the panel's.
    expect(screen.queryByText(/waiting for them to come back/)).toBeNull();
    // Back within the 5 minutes: the clock is gone.
    await s.push({ players: table(3) });
    reactAct(() => s.socket().push({ t: 'notice', kind: 'opponentBack', text: 'Carol is back.', player: 'p3' }));
    expect(presence()[2]).toBe('Carol: connected');
    expect(screen.queryByRole('timer')).toBeNull();
    // Dropped again, and the 5 minutes run out: the host applies the forfeit.
    await s.push({ players: table(3, [{ id: 'p3', connected: false, left: true }]) });
    reactAct(() => s.socket().push({ t: 'notice', kind: 'opponentLeft', text: 'Carol did not come back within 5 minutes: they forfeit the game (CR 104.3a).', player: 'p3' }));
    expect(presence()[2]).toBe('Carol: left the game');
    expect(news()).toEqual([
      'Carol\'s link dropped: 5:00 until they forfeit (CR 104.3a).',
      'Carol is back.',
      'Carol did not come back within 5 minutes: they forfeit the game (CR 104.3a).',
    ]);
  });

  it('the host can end the game for a guest that left without conceding (its server stopped), naming that guest (CR 104.3a)', async () => {
    const s = await inGame('host', 'p1');
    await s.push({ players: table(3, [{ id: 'p2', connected: false }]) });
    // A drop alone has its clock: no button.
    reactAct(() => s.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'Bob\'s link dropped.', player: 'p2' }));
    expect(screen.queryByRole('button', { name: /they forfeit/ })).toBeNull();
    reactAct(() => s.socket().push({ t: 'notice', kind: 'opponentLeft', text: 'Bob left.', player: 'p2' }));
    fireEvent.click(screen.getByRole('button', { name: 'End the game for Bob: they forfeit' }));
    await reactAct(flush);
    expect(s.socket().last('forfeit')).toMatchObject({ t: 'forfeit', player: 'p2' });
  });
});

describe('by-hand changes: every other player approves', () => {
  it('another player\'s proposal, described for this player, with Accept / Reject and a reason; how it ended', async () => {
    const s = await inGame('guest', 'p2');
    const sock = s.socket();
    reactAct(() => sock.push({ t: 'manualProposal', proposal: { id: 7, sourceName: 'Fork', text: 'Copy target spell.', lines: ['Move a hidden card to exile.', 'Carol\'s life -3.'], player: 'p1', waiting: ['p2', 'p3'] } }));
    const dialog = screen.getByRole('alertdialog', { name: 'Adjustments by hand' });
    expect(text(dialog)).toMatch('Alice resolves Fork by hand and asks every other player to accept these changes:');
    expect(within(dialog).getAllByRole('listitem').map(text)).toEqual(['Move a hidden card to exile.', 'Carol\'s life -3.']);
    expect(text(dialog)).toMatch('Still to answer: you and Carol.');
    fireEvent.change(within(dialog).getByLabelText('Reason if you reject (optional)'), { target: { value: 'That card was not exiled.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await reactAct(flush);
    expect(sock.last('manual')).toMatchObject({ t: 'manual', proposal: 7, accept: false, reason: 'That card was not exiled.' });
    reactAct(() => {
      sock.reply('manual');
      sock.push({ t: 'manualClosed', proposal: 7, outcome: 'rejected', by: 'p2' });
    });
    await reactAct(flush);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Alice\'s adjustments by hand for Fork were rejected by you.')).toBeTruthy();

    // Accepted: the proposal stays, saying whom it still waits for; then applied.
    reactAct(() => sock.push({ t: 'manualProposal', proposal: { id: 8, sourceName: 'Fork', text: '', lines: ['Carol\'s life -3.'], player: 'p1', waiting: ['p2', 'p3'] } }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Accept' }));
    await reactAct(flush);
    expect(sock.last('manual')).toEqual({ t: 'manual', id: expect.any(Number), proposal: 8, accept: true });
    reactAct(() => {
      sock.reply('manual');
      sock.push({ t: 'manualProposal', proposal: { id: 8, sourceName: 'Fork', text: '', lines: ['Carol\'s life -3.'], player: 'p1', waiting: ['p3'] } });
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(text(screen.getByRole('status', { name: 'Adjustments by hand' }))).toMatch('You accepted; waiting for: Carol.');
    expect(within(screen.getByRole('status', { name: 'Adjustments by hand' })).queryByRole('button')).toBeNull();
    reactAct(() => sock.push({ t: 'manualClosed', proposal: 8, outcome: 'applied' }));
    expect(screen.getByText('Alice\'s adjustments by hand for Fork were applied: every other player accepted.')).toBeTruthy();
  });

  it('the proposer sees whom it waits for, then who rejected it', async () => {
    const s = await inGame('guest', 'p2');
    reactAct(() => s.socket().push({ t: 'manualProposal', proposal: { id: 3, sourceName: 'Twincast', text: '', lines: ['Your life +2.'], player: 'p2', waiting: ['p1', 'p3'] } }));
    const mine = screen.getByRole('status', { name: 'Your adjustments by hand' });
    expect(text(mine)).toMatch('You resolve Twincast by hand. Every other player must accept these changes; waiting for Alice and Carol.');
    expect(within(mine).queryByRole('button')).toBeNull();
    reactAct(() => s.socket().push({ t: 'manualProposal', proposal: { id: 3, sourceName: 'Twincast', text: '', lines: ['Your life +2.'], player: 'p2', waiting: ['p3'] } }));
    expect(text(screen.getByRole('status', { name: 'Your adjustments by hand' }))).toMatch('waiting for Carol.');
    reactAct(() => s.socket().push({ t: 'manualClosed', proposal: 3, outcome: 'rejected', by: 'p3' }));
    expect(screen.queryByRole('status', { name: 'Your adjustments by hand' })).toBeNull();
    expect(screen.getByText('Your adjustments by hand for Twincast were rejected by Carol.')).toBeTruthy();
    reactAct(() => s.socket().push({ t: 'manualProposal', proposal: { id: 4, sourceName: 'Twincast', text: '', lines: [], player: 'p2', waiting: ['p1', 'p3'] } }));
    reactAct(() => s.socket().push({ t: 'manualClosed', proposal: 4, outcome: 'withdrawn' }));
    expect(screen.getByText('Your adjustments by hand for Twincast were withdrawn.')).toBeTruthy();
  });
});

describe('chat with the table', () => {
  it('every line shows its sender', async () => {
    const s = await inGame('guest', 'p2');
    reactAct(() => {
      s.socket().push({ t: 'chat', text: 'hi all', from: 'p3' });
      s.socket().push({ t: 'chat', text: 'good luck', from: 'p1' });
    });
    expect(screen.getByText(/Table chat \(new\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Table chat/ }));
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'you too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await reactAct(flush);
    expect(s.socket().last('chat')).toMatchObject({ t: 'chat', text: 'you too' });
    reactAct(() => s.socket().reply('chat'));
    await reactAct(flush);
    expect(within(screen.getByRole('list', { name: 'Chat' })).getAllByRole('listitem').map(text)).toEqual(['Carol: hi all', 'Alice: good luck', 'You: you too']);
  });

  it('M12F: the chat and the table news open over the table (the board stage layer), never in the rail; the rail keeps one compact line', async () => {
    const s = await inGame('guest', 'p2');
    reactAct(() => {
      s.socket().push({ t: 'notice', kind: 'opponentDropped', text: "Carol's link dropped: 5:00 until they forfeit (CR 104.3a).", player: 'p3' });
      s.socket().push({ t: 'notice', kind: 'opponentBack', text: 'Carol is back.', player: 'p3' });
      s.socket().push({ t: 'chat', text: 'hi all', from: 'p3' });
    });
    const rail = document.querySelector('.board-side')!;
    // closed: no chat anywhere; the rail shows the latest news on one line and the chat button
    expect(screen.queryByRole('list', { name: 'Chat' })).toBeNull();
    expect(text(rail.querySelector('.online-news-latest')!)).toBe('Carol is back.');
    expect(rail.querySelector('.online-news')).toBeNull();
    fireEvent.click(within(rail as HTMLElement).getByRole('button', { name: 'Table chat (new)' }));
    const overlay = screen.getByRole('region', { name: 'Table chat' });
    expect(overlay.closest('.decision-stage')).not.toBeNull();
    expect(rail.contains(overlay)).toBe(false);
    expect(within(overlay).getByRole('list', { name: 'Table news' })).toBeTruthy();
    expect(within(overlay).getAllByRole('listitem').map(text)).toContain('Carol: hi all');
    expect(screen.getByRole('button', { name: 'Table chat' }).getAttribute('aria-expanded')).toBe('true');
    // Escape closes it
    fireEvent.keyDown(within(overlay).getByLabelText('Chat message'), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Table chat' })).toBeNull();
  });

  it('M12F: the chat a reloaded page gets back is shown, but not as new', async () => {
    const s = await inGame('guest', 'p2');
    reactAct(() => s.socket().push({ t: 'chatHistory', lines: [{ text: 'hi all', from: 'p3' }, { text: 'hello', mine: true }, { text: 'gl', from: 'p1' }] }));
    expect(screen.getByRole('button', { name: 'Table chat' })).toBeTruthy(); // no "(new)"
    fireEvent.click(screen.getByRole('button', { name: 'Table chat' }));
    expect(within(screen.getByRole('list', { name: 'Chat' })).getAllByRole('listitem').map(text)).toEqual(['Carol: hi all', 'You: hello', 'Alice: gl']);
  });
});

describe('leaving a 3-4 player online game', () => {
  it('the host\'s Leave concedes and keeps serving the game as a spectator; a second Leave stops it for everyone', async () => {
    const s = await inGame('host', 'p1');
    const sock = s.socket();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave the game' });
    expect(text(dialog)).toMatch('You concede: you lose and leave the game (CR 104.3a, 800.4a). Your OpenMTG keeps running the game for the others');
    expect(text(dialog)).toMatch('Leave again to stop it, which ends the game for everyone without a result.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Concede and keep serving' }));
    await reactAct(flush);
    expect(sock.last('leave')).toBeDefined();
    // The server conceded for the host and keeps running the game (`spectating`).
    const after = concede(s.g.state, 'p1').state;
    reactAct(() => {
      sock.reply('leave');
      s.g.set(after);
      sock.push(s.g.msg('p1'));
      sock.push(statusMsg(tableStatus({ role: 'host', me: 'p1', phase: 'spectating', players: table(3, [{ id: 'p1', left: true }]) })));
      sock.push({ t: 'notice', kind: 'opponentLeft', text: 'Alice left the game and conceded (CR 104.3a); their OpenMTG keeps running the game for the others.', player: 'p1' });
    });
    await reactAct(flush);
    expect(sock.closedWith).toBeNull();
    expect(screen.queryByTestId('route')).toBeNull();
    expect(text(screen.getByRole('alert'))).toMatch('Your OpenMTG server keeps running the game for the others: keep OpenMTG open until it ends.');
    expect(presence()[0]).toBe('Alice (you): left the game');
    expect(screen.queryByRole('button', { name: 'Concede' })).toBeNull();
    // The second Leave stops the game for everyone.
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const stop = screen.getByRole('dialog', { name: 'Leave the game' });
    expect(text(stop)).toMatch('Stop running the game? It ends at once for every other player, without a result.');
    fireEvent.click(within(stop).getByRole('button', { name: 'Stop the game for everyone' }));
    await reactAct(flush);
    expect(sock.sent.filter((m) => m['t'] === 'leave')).toHaveLength(2);
    reactAct(() => sock.reply('leave'));
    await reactAct(flush);
    expect(sock.closedWith).toMatchObject({ code: 1000 });
    expect(text(screen.getByTestId('route'))).toBe('home');
  });

  it('with one other player left, the host\'s Leave concedes and the end screen shows here (CR 104.2a)', async () => {
    const s = await inGame('host', 'p1');
    const sock = s.socket();
    reactAct(() => {
      s.g.set(concede(s.g.state, 'p2').state);
      sock.push(s.g.msg('p1'));
    });
    await reactAct(flush);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave the game' });
    expect(text(dialog)).toMatch('Leaving concedes it: you lose, and the last other player wins (CR 104.3a). The result shows here; leave again to close the game.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Concede' }));
    await reactAct(flush);
    expect(sock.last('leave')).toBeDefined();
    const st = concede(s.g.state, 'p1').state;
    expect(st.result?.winner).toBe('p3');
    reactAct(() => {
      sock.reply('leave');
      s.g.set(st);
      sock.push(s.g.msg('p1'));
    });
    expect(await screen.findByRole('region', { name: 'Game over' })).toBeTruthy();
    expect(sock.closedWith).toBeNull();
  });

  it('a guest\'s Leave concedes and the game goes on for the others', async () => {
    const s = await inGame('guest', 'p3');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave the game' });
    expect(text(dialog)).toMatch('Leaving concedes it: you lose and leave the game, and it goes on for the others (CR 104.3a, 800.4a).');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave the game' }));
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    reactAct(() => s.socket().reply('leave'));
    await reactAct(flush);
    expect(s.socket().closedWith).toMatchObject({ code: 1000 });
    expect(text(screen.getByTestId('route'))).toBe('home');
  });

  it('a player already out of the running game leaves the table without another concession', async () => {
    const s = await inGame('guest', 'p2');
    reactAct(() => {
      s.g.set(concede(s.g.state, 'p2').state);
      s.socket().push(s.g.msg('p2'));
    });
    await reactAct(flush);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave the game' });
    expect(text(dialog)).toMatch(/^Leave the table\? You are out of the game already; it goes on for the others\./);
    expect(within(dialog).getByRole('button', { name: 'Leave the table' })).toBeTruthy();
  });
});

describe('the end of an online game of 3-4 players', () => {
  it('the end screen shows the finishing order (M12-4b) to every player', async () => {
    const s = await inGame('guest', 'p3');
    let st = concede(s.g.state, 'p2').state;
    st = concede(st, 'p3').state;
    expect(st.result?.winner).toBe('p1');
    reactAct(() => {
      s.g.set(st);
      s.socket().push(s.g.msg('p3'));
      s.socket().push(statusMsg(tableStatus({ role: 'guest', me: 'p3', phase: 'over', result: st.result!, players: table(3, [{ id: 'p2', left: true }, { id: 'p3', left: true }]) })));
    });
    const over = await screen.findByRole('region', { name: 'Game over' });
    await waitFor(() => expect(within(over).getByRole('list', { name: 'Finishing order' })).toBeTruthy());
    const rows = within(within(over).getByRole('list', { name: 'Finishing order' })).getAllByRole('listitem').map(text);
    expect(rows[0]).toMatch(/^1st ?Alice ?Winner$/);
    expect(rows).toHaveLength(3);
    // No clock and no forfeit once the game is over.
    expect(screen.queryByRole('timer')).toBeNull();
    // The host's server closes the finished game (idle, no table in the status): the panel still speaks of the table.
    reactAct(() => s.socket().push(statusMsg({ role: 'none', phase: 'idle', warnings: [] })));
    expect(screen.getByText(/^Table chat/)).toBeTruthy();
    expect(screen.queryByText(/Chat with/)).toBeNull();
  });
});
