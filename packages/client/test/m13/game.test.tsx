/**
 * M13-11: the game screen of a game on the DigiDice server (hosted/game): the existing board and prompts over a HostedConnection, the clocks and the rope,
 * the server's notices, chat, the approval of another player's adjustments by hand, the result with its placements, and Leave; with a fake socket the test
 * drives as the hosted server would, and real views of a small game (normal traffic only). Hosted design 4.4, 5, 12.
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PlayerId } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostedConnection } from '../../src/connection/HostedConnection';
import { renderGameApp } from '../game-fixtures';
import { clockMsg, fakeHosted, flush, gameViews, seatView, tableMsg, welcomeMsg } from './fakes';

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The game of `gameViews`, from the seat of the player who must decide first (the start of a game: who plays first). */
async function inGame(o: { fakeTimers?: boolean; retryMs?: number } = {}) {
  if (o.fakeTimers) vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const g = gameViews();
  const me = g.session.state.pending!.player as PlayerId;
  const seat: 1 | 2 = me === 'p1' ? 1 : 2;
  const other: 1 | 2 = seat === 1 ? 2 : 1;
  const names = ['Alice', 'Bob'];
  const f = fakeHosted({ welcome: welcomeMsg({ table: 'T1', seat }), ...(o.retryMs ? { opts: { retryMs: o.retryMs } } : {}) });
  await f.link.connect();
  f.socket().push(tableMsg({ status: 'playing', you: seat, creator: 1, seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
  f.socket().push({ t: 'start', table: 'T1', players: [{ id: 'p1', name: 'Alice', seat: 1 }, { id: 'p2', name: 'Bob', seat: 2 }] });
  f.socket().push(g.full(me));
  render(renderGameApp(new HostedConnection(f.link), { hosted: f.link }));
  await screen.findByLabelText('Game on the DigiDice server');
  const push = (m: Parameters<ReturnType<typeof f.socket>['push']>[0]) => reactAct(async () => f.socket().push(m));
  return { ...f, g, me, seat, other, myName: names[seat - 1]!, otherName: names[other - 1]!, push };
}

const press = (name: string | RegExp) => reactAct(async () => void fireEvent.click(screen.getByRole('button', { name })));
/** A new prompt's buttons work only a moment after it appears (prompts/PromptBar.tsx: the second click of a double click must not answer the next decision). */
const armed = () => reactAct(() => new Promise<void>((r) => setTimeout(r, 400)));
const clocks = () => within(screen.getByRole('list', { name: 'Clocks' })).getAllByRole('listitem').map(text);

afterEach(() => {
  vi.useRealTimers();
});

describe('the game on the server', () => {
  it('shows the usual board and prompt, and sends the player\'s answer with the view\'s seq and the next command number', async () => {
    const s = await inGame();
    expect(screen.getByText('Choose who takes the first turn.')).toBeTruthy();
    await armed();
    await press('I play first');
    expect(s.socket().last('act')).toMatchObject({ t: 'act', seq: 1, action: { type: 'answer', player: s.me, answer: { kind: 'playFirst', player: s.me } } });
    // the server's ok, then the change as a patch: the board follows
    s.socket().reply('act');
    const events = s.g.step();
    await s.push(s.g.patch(s.me, 1, events));
    await waitFor(() => expect(screen.queryByText('Choose who takes the first turn.')).toBeNull());
  });

  it('a refusal from the server is shown in its own words', async () => {
    const s = await inGame();
    await armed();
    await press('I play first');
    await s.push({ t: 'reply', id: s.socket().last('act').id, ok: false, error: { code: 'stale', message: 'The game moved on.' } });
    await waitFor(() => expect(screen.getByText(/The game moved on before that action arrived/)).toBeTruthy());
  });

  it('has no Undo (the game is the server\'s) and no Rematch after the end', async () => {
    const s = await inGame();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    const full = s.g.full(s.me);
    await s.push({ ...full, seq: 5, view: { ...full.view, result: { winner: s.other === 1 ? 'p1' : 'p2', reason: 'The other player won.', rules: [] } } as never, legal: [] });
    await screen.findByRole('button', { name: 'New game' });
    expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
  });

  it('a lost link is shown in the screen\'s own status, and gone when it is back', async () => {
    const s = await inGame({ retryMs: 5 });
    await reactAct(async () => s.socket().drop(1006));
    expect(screen.getByRole('alert').textContent).toMatch(/Lost the connection to the game server; trying again/);
    expect(screen.getByRole('alert').textContent).toMatch(/waits for you only when you must decide/);
    await waitFor(() => expect(s.sockets).toHaveLength(2));
    await reactAct(async () => s.socket().push(welcomeMsg({ resumed: true, table: 'T1', seat: s.seat })));
    expect(screen.queryByText(/Lost the connection to the game server/)).toBeNull();
    // the new socket said hello with the guest token
    expect(s.socket().sent[0]).toMatchObject({ t: 'hello', token: expect.any(String) });
  });
});

describe('the clocks', () => {
  it('show every player\'s bank with the running one marked and the free delay of its decision, counting down by themselves', async () => {
    const s = await inGame({ fakeTimers: true });
    await s.push(clockMsg(0, [{ seat: s.seat, bankMs: 872_000, running: true, delayMs: 5000 }, { seat: s.other, bankMs: 900_000 }]));
    const c = clocks();
    expect(c[s.seat - 1]).toBe('You 14:32 +5 s free');
    expect(c[s.other - 1]).toBe(`${s.otherName} 15:00`);
    expect(within(screen.getByRole('list', { name: 'Clocks' })).getAllByRole('listitem').filter((li) => li.hasAttribute('data-running'))).toHaveLength(1);
    // two seconds into the free delay: the bank has not moved; 7 s: the delay is spent and the bank runs
    reactAct(() => vi.advanceTimersByTime(2000));
    expect(clocks().find((c) => c.startsWith('You'))).toMatch(/^You 14:32 \+3 s free$/);
    reactAct(() => vi.advanceTimersByTime(5000));
    expect(clocks().find((c) => c.startsWith('You'))).toBe('You 14:30');
    expect(screen.getByRole('timer', { name: 'Your time' })).toBeTruthy();
  });

  it('the rope shows beside the prompt\'s buttons once the delay is spent, and is urgent under a minute of bank', async () => {
    const s = await inGame({ fakeTimers: true });
    await s.push(clockMsg(0, [{ seat: s.seat, bankMs: 62_000, running: true, delayMs: 3000 }, { seat: s.other }]));
    expect(screen.queryByRole('timer', { name: 'Your time' })).toBeNull();
    reactAct(() => vi.advanceTimersByTime(3500));
    const rope = screen.getByRole('timer', { name: 'Your time' });
    expect(rope.textContent).toMatch(/Your time 1:02/);
    expect(rope.hasAttribute('data-urgent')).toBe(false);
    // on the table, beside the prompt's own buttons (the board's actions slot)
    expect(rope.closest('.table-actions')).not.toBeNull();
    reactAct(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('timer', { name: 'Your time' }).hasAttribute('data-urgent')).toBe(true);
    expect(screen.getByRole('timer', { name: 'Your time' }).textContent).toMatch(/Your time 1:00/);
  });

  it('there is no rope while the other player\'s clock runs, and none once the game is over', async () => {
    const s = await inGame({ fakeTimers: true });
    await s.push(clockMsg(0, [{ seat: s.seat }, { seat: s.other, running: true, delayMs: 0 }]));
    reactAct(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('timer', { name: 'Your time' })).toBeNull();
    expect(clocks().find((c) => c.startsWith(s.otherName))).toBeDefined();
    await s.push(clockMsg(0, [{ seat: s.seat, running: true, delayMs: 0 }, { seat: s.other }]));
    expect(screen.getByRole('timer', { name: 'Your time' })).toBeTruthy();
    const full = s.g.full(s.me);
    await s.push({ ...full, seq: 9, view: { ...full.view, result: { winner: null, reason: 'Draw.', rules: [] } } as never, legal: [] });
    expect(screen.queryByRole('timer', { name: 'Your time' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Clocks' })).toBeNull();
  });

  it('a player whose link dropped shows their away time counting down, and the abandonment timer shows when nobody is connected', async () => {
    const s = await inGame({ fakeTimers: true });
    await s.push({ t: 'notice', kind: 'playerDropped', seat: s.other, text: 'Seat lost the connection.' });
    await s.push(clockMsg(0, [{ seat: s.seat }, { seat: s.other, dropRunning: true, dropMs: 252_000 }]));
    expect(clocks().find((c) => c.startsWith(s.otherName))).toMatch(/away, 4:12 left to come back/);
    reactAct(() => vi.advanceTimersByTime(3000));
    expect(clocks().find((c) => c.startsWith(s.otherName))).toMatch(/away, 4:09 left to come back/);
    // the screen's own line says it too (a two-player game)
    expect(screen.getByRole('alert').textContent).toMatch(new RegExp(`${s.otherName} lost the connection\\. The game waits for them only when they must decide`));
    await s.push({ t: 'notice', kind: 'playerBack', seat: s.other, text: 'Seat is back.' });
    await s.push(clockMsg(0, [{ seat: s.seat }, { seat: s.other }], 200_000));
    expect(screen.getByText(/Nobody in the game is connected: it ends without a result in/).textContent).toMatch(/3:20/);
  });
});

describe('notices and chat', () => {
  it('says the notices with the players\' names, the latest on one line and all of them in the chat overlay', async () => {
    const s = await inGame();
    await s.push({ t: 'notice', kind: 'playerDropped', seat: s.other, text: 'Seat 2 lost the connection; the game waits for them only when they must decide.' });
    expect(screen.getByTitle(new RegExp(`^${s.otherName} lost the connection`)).textContent).toMatch(new RegExp(`^${s.otherName} lost the connection`));
    await s.push({ t: 'notice', kind: 'playerBack', seat: s.other, text: 'Seat 2 is back.' });
    expect(screen.getByTitle(`${s.otherName} is back.`)).toBeTruthy();
    await press(/^Table chat/);
    const news = within(screen.getByRole('list', { name: 'Table news' })).getAllByRole('listitem').map(text);
    expect(news).toHaveLength(2);
    expect(news[1]).toBe(`${s.otherName} is back.`);
    // the server's own words stay for what only it can say
    await s.push({ t: 'notice', kind: 'serverDraining', text: 'The server restarts soon; this game may finish, but no new games start.' });
    expect(screen.getByTitle(/The server restarts soon/)).toBeTruthy();
  });

  it('chat: a line shows once the server has sent it back, with who said it; a line from the other player marks the button until it is read', async () => {
    const s = await inGame();
    await press(/^Table chat/);
    const box = screen.getByLabelText('Chat message');
    fireEvent.change(box, { target: { value: 'good luck' } });
    await press('Send');
    expect(s.socket().last('chat')).toMatchObject({ t: 'chat', text: 'good luck' });
    expect(within(screen.getByRole('list', { name: 'Chat' })).queryAllByRole('listitem')).toHaveLength(0);
    await s.push({ t: 'chat', from: s.seat, text: 'good luck' });
    s.socket().reply('chat');
    await reactAct(flush);
    expect((screen.getByLabelText('Chat message') as HTMLInputElement).value).toBe('');
    await s.push({ t: 'chat', from: s.other, text: 'you too' });
    const lines = within(screen.getByRole('list', { name: 'Chat' })).getAllByRole('listitem').map(text);
    expect(lines).toEqual(['You: good luck', `${s.otherName}: you too`]);
    // closed: the next line from the other player says so on the button
    fireEvent.click(screen.getByRole('button', { name: 'Close table chat: ' + 'Alice\'s table'.toLowerCase().replace(/^./, (c) => c) }));
    expect(screen.getByRole('button', { name: /^Table chat$/ })).toBeTruthy();
    await s.push({ t: 'chat', from: s.other, text: 'one more' });
    expect(screen.getByRole('button', { name: /^Table chat \(new\)$/ })).toBeTruthy();
    await press(/^Table chat/);
    fireEvent.click(screen.getByRole('button', { name: /^Close table chat/ }));
    expect(screen.getByRole('button', { name: /^Table chat$/ })).toBeTruthy();
  });

  it('a refused line (too many at once) says so under the box and keeps the text', async () => {
    const s = await inGame();
    await press(/^Table chat/);
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'hello' } });
    await press('Send');
    s.socket().reply('chat', { error: { code: 'rateLimited', message: 'Too many chat messages; wait a moment.' } });
    await reactAct(flush);
    expect(screen.getByRole('alert').textContent).toMatch(/Too many actions at once|Too many chat messages/);
    expect((screen.getByLabelText('Chat message') as HTMLInputElement).value).toBe('hello');
  });
});

describe('adjustments by hand of another player', () => {
  const proposal = { id: 4, seat: 1 as const, sourceName: 'Odd Card', text: 'Do something odd.', lines: ['Alice gains 1 life.', 'A hidden card goes to the graveyard.'] };

  it('Accept sends the vote; the proposal is gone when the server closes it, and how it ended is said', async () => {
    const s = await inGame();
    await s.push({ t: 'proposal', proposal: { ...proposal, seat: s.other } });
    const box = screen.getByRole('alertdialog', { name: 'Adjustments by hand' });
    expect(text(box)).toContain(`${s.otherName} resolves Odd Card by hand and asks you to accept these changes`);
    expect(within(box).getAllByRole('listitem').map(text)).toEqual(proposal.lines);
    await press('Accept');
    expect(s.socket().last('vote')).toMatchObject({ t: 'vote', proposal: 4, accept: true });
    s.socket().reply('vote');
    await s.push({ t: 'proposalClosed', proposal: 4, outcome: 'approved' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('The adjustments by hand were approved.')).toBeTruthy();
  });

  it('Reject sends the reason too', async () => {
    const s = await inGame();
    await s.push({ t: 'proposal', proposal: { ...proposal, seat: s.other } });
    fireEvent.change(screen.getByLabelText(/Reason if you reject/), { target: { value: 'That is not what it says.' } });
    await press('Reject');
    expect(s.socket().last('vote')).toMatchObject({ t: 'vote', proposal: 4, accept: false, reason: 'That is not what it says.' });
  });

  it('a vote the server refuses is shown, and the proposal stays to answer again', async () => {
    const s = await inGame();
    await s.push({ t: 'proposal', proposal: { ...proposal, seat: s.other } });
    await press('Accept');
    s.socket().reply('vote', { error: { code: 'notAllowed', message: 'That proposal is closed.' } });
    await reactAct(flush);
    expect(screen.getByRole('alertdialog').textContent).toContain('That proposal is closed.');
  });
});

describe('the result', () => {
  it('shows who won and every player\'s place and how they lost, after the end', async () => {
    const s = await inGame();
    const winner = s.seat;
    const full = s.g.full(s.me);
    await s.push({ ...full, seq: 7, view: { ...full.view, result: { winner: s.me, reason: `${s.otherName} ran out of time.`, rules: ['CR 104.3a'] } } as never, legal: [] });
    await s.push({
      t: 'result', outcome: 'win', reason: `${s.otherName} ran out of time.`, result: { winner: s.me, reason: 'x', rules: [] } as never,
      placements: [
        { seat: s.other, name: s.otherName, place: 2, loss: 'timeout', lossRule: null, outTurn: 6 },
        { seat: winner as 1 | 2, name: s.myName, place: 1, loss: null, lossRule: null, outTurn: null },
      ],
    });
    const result = screen.getByRole('region', { name: 'Result' });
    expect(within(result).getByRole('heading').textContent).toBe('You win');
    expect(within(result).getAllByRole('listitem').map(text)).toEqual([`1st: ${s.myName} (you)`, `2nd: ${s.otherName} (ran out of time, turn 6)`]);
  });

  it('a game that ended without a result says why, and the screen says Leave to go back', async () => {
    const s = await inGame();
    await s.push({ t: 'result', outcome: 'void', reason: 'Nobody stayed connected for 5 minutes.', result: null, placements: [] });
    const result = screen.getByRole('region', { name: 'Result' });
    expect(within(result).getByRole('heading').textContent).toBe('The game ended without a result');
    expect(result.textContent).toContain('Nobody stayed connected for 5 minutes.');
    expect(screen.getByRole('alert').textContent).toMatch(/The game ended without a result: Nobody stayed connected for 5 minutes\. Leave to go back/);
  });
});

describe('Concede and Leave', () => {
  it('Concede sends the concession as an action of this player', async () => {
    const s = await inGame();
    await press('Concede');
    await press(/concedes$/);
    expect(s.socket().last('act')).toMatchObject({ t: 'act', action: { type: 'concede', player: s.me } });
  });

  it('Leave says it concedes, tells the server (the table is left), closes the link and goes home', async () => {
    const s = await inGame();
    await press('Leave');
    expect(screen.getByRole('dialog', { name: 'Leave the game' }).textContent).toMatch(/Leaving concedes it: you lose, and the other player is told they won/);
    await press('Leave the game');
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    s.socket().reply('leave');
    await waitFor(() => expect(s.link.linkState()).toBe('closed'));
    expect(screen.getByTestId('route').textContent).toBe('home');
  });

  it('after the end Leave goes at once, and New game leaves the table as well', async () => {
    const s = await inGame();
    const full = s.g.full(s.me);
    await s.push({ ...full, seq: 7, view: { ...full.view, result: { winner: s.me, reason: 'Won.', rules: [] } } as never, legal: [] });
    await press('New game');
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    s.socket().reply('leave');
    await waitFor(() => expect(s.link.linkState()).toBe('closed'));
    expect(screen.getByTestId('route').textContent).toBe('newGame');
  });
});
