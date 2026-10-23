/**
 * M13-11: Play on the DigiDice server (hosted/room): the entry screen, a private table and its invite codes, joining by a code, the waiting room, the
 * capacity wait, the ready check, and the game opening at the start, with a fake socket the test drives as the hosted server would (normal traffic only:
 * no sockets, no network). Hosted design 4.1, 4.3, 4.6, 12.
 */
import type { HostedServerMessage } from '@openmtg/hosted/api';
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav, type Route } from '../../src/app/nav';
import { GameScreen } from '../../src/game/GameScreen';
import type { GameDeck } from '../../src/game/services';
import { HostedScreen } from '../../src/hosted/room/HostedScreen';
import type { HostedServices } from '../../src/hosted/room/services';
import { toHostedDeck } from '../../src/hosted/room/services';
import { MemoryHostedStorage } from '../../src/hosted/storage';
import { testSettings } from '../game-fixtures';
import { CODE, fakeHosted, flush, gameViews, seatView, SERVER, tableMsg, TOKEN, welcomeMsg } from './fakes';

const green: GameDeck = { id: 'saved:green', name: 'My green deck', format: 'casual', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [{ name: 'Test Bear', count: 2 }] } };
const commander: GameDeck = { id: 'saved:cmd', name: 'Commander deck', format: 'commander', deck: { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Test Bear', count: 1 }] } };
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const disabled = (el: Element) => (el as HTMLButtonElement).disabled;

type Fake = ReturnType<typeof fakeHosted>;

function setup(o: Parameters<typeof fakeHosted>[0] = {}, server: string | null = SERVER) {
  const f = fakeHosted(o);
  const opened: { server: string; name: string }[] = [];
  const services: HostedServices = {
    listDecks: async () => [green, commander],
    openLink: (url, name) => {
      opened.push({ server: url, name });
      f.link.setName(name);
      return f.link;
    },
  };
  let route: Route = { screen: 'home' };
  function Shell() {
    const nav = useNav();
    route = nav.route;
    if (nav.route.screen === 'hosted') return <HostedScreen services={services} settings={testSettings()} server={server} />;
    if (nav.route.screen === 'game')
      return <GameScreen connection={nav.route.connection} {...(nav.route.hosted ? { hosted: nav.route.hosted } : {})} coverDelayMs={0} settings={testSettings()} />;
    return (
      <>
        <p data-testid="route">{nav.route.screen}</p>
        <button type="button" onClick={nav.back}>
          Test back
        </button>
      </>
    );
  }
  const open = async () => {
    const view = render(
      <NavProvider initial={{ screen: 'hosted' }}>
        <Shell />
      </NavProvider>,
    );
    await reactAct(flush);
    await reactAct(flush);
    return view;
  };
  return { ...f, open, opened, route: () => route };
}

async function choose(label: string, value: string) {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

const press = (name: string | RegExp) => reactAct(async () => void fireEvent.click(screen.getByRole('button', { name })));
const push = (s: Fake, m: HostedServerMessage) => reactAct(async () => s.socket().push(m));

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
  vi.useRealTimers();
});

describe('the entry screen', () => {
  it('connects, offers the server\'s formats, and says what each button needs', async () => {
    const s = setup();
    await s.open();
    expect(screen.getByRole('heading', { name: 'Play on the DigiDice server' })).toBeTruthy();
    // the link is opened for this server under the name from Settings
    expect(s.opened).toEqual([{ server: SERVER, name: 'Player 1' }]);
    expect(s.socket().sent[0]).toMatchObject({ t: 'hello', protocol: 1, name: 'Player 1' });
    const formats = screen.getByLabelText('Format') as HTMLSelectElement;
    expect([...formats.options].map((o) => o.value)).toEqual(['casual', 'standard', 'commander']);
    expect(disabled(screen.getByRole('button', { name: 'Make a table' }))).toBe(true);
    expect(disabled(screen.getByRole('button', { name: 'Join the table' }))).toBe(true);
    expect(screen.getByText('Choose a deck.')).toBeTruthy();
    expect(screen.getByText(/15 minutes on their clock/)).toBeTruthy();
    expect(screen.getByText(/5 minutes of away time/)).toBeTruthy();
    await choose('Deck', green.id);
    expect(disabled(screen.getByRole('button', { name: 'Make a table' }))).toBe(false);
    // the code is what the join button also needs
    expect(disabled(screen.getByRole('button', { name: 'Join the table' }))).toBe(true);
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: CODE } });
    expect(disabled(screen.getByRole('button', { name: 'Join the table' }))).toBe(false);
  });

  it('a deck without a commander is not offered a Commander table, and a deck\'s own format is chosen for it', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', commander.id);
    expect((screen.getByLabelText('Format') as HTMLSelectElement).value).toBe('commander');
    await choose('Format', 'standard');
    expect(screen.getAllByText(/has a commander: choose a Commander format/).length).toBeGreaterThan(0);
    expect(disabled(screen.getByRole('button', { name: 'Make a table' }))).toBe(true);
  });

  it('a name the server would refuse is refused here first', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '   ' } });
    expect(disabled(screen.getByRole('button', { name: 'Make a table' }))).toBe(true);
    expect(screen.getAllByText(/The name is empty/).length).toBeGreaterThan(0);
  });

  it('says so when no game server is set up, and when the server cannot be reached (with Try again)', async () => {
    const none = setup({}, null);
    const view = await none.open();
    expect(screen.getByText('No game server is set up.')).toBeTruthy();
    expect(none.sockets).toHaveLength(0);
    view.unmount();

    const down = setup({ manual: true });
    await down.open();
    expect(down.sockets).toHaveLength(1);
    await reactAct(async () => down.socket().drop(1006));
    await waitFor(() => expect(screen.getByText(/The game server is not available right now/)).toBeTruthy());
    expect(screen.getByText(/did not answer/)).toBeTruthy();
    await press('Try again');
    expect(down.sockets).toHaveLength(2);
  });
});

describe('a private table', () => {
  async function made() {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    await press('Make a table');
    return s;
  }

  it('sends the table: a private one for two, the deck by names (the sideboard too), under the name typed', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    await press('Make a table');
    expect(s.socket().last('create')).toMatchObject({
      t: 'create', format: 'casual', seats: 2, visibility: 'private',
      deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [{ name: 'Test Bear', count: 2 }] },
    });
    expect(toHostedDeck(green.deck)).toEqual(s.socket().last('create')['deck']);
    expect(screen.getByRole('button', { name: 'Making the table…' })).toBeTruthy();
  });

  it('says hello again under a name typed after the page connected, then sends the table on the new socket', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '  Alicia   B  ' } });
    await press('Make a table');
    await reactAct(flush);
    expect(s.sockets).toHaveLength(2);
    expect(s.sockets[1]!.sent[0]).toMatchObject({ t: 'hello', name: 'Alicia B', token: TOKEN });
    expect(s.sockets[1]!.last('create')).toBeDefined();
    expect(s.sockets[0]!.closedWith).toMatchObject({ code: 1000 });
  });

  it('shows the waiting room: the seats, an invite code for the open one with Copy, and how many players the table waits for', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const s = await made();
    await push(s, tableMsg());
    s.socket().reply('create', { ok: true, table: 'T1', codes: [CODE] });
    await reactAct(flush);
    const room = screen.getByRole('region', { name: 'Waiting room' });
    expect(within(room).getByRole('heading', { name: "Alice's table" })).toBeTruthy();
    const seats = within(room).getAllByRole('listitem').map(text);
    expect(seats[0]).toBe('Seat 1 Alice (you, made the table) · here, deck ready');
    expect(seats[1]).toMatch(/Seat 2 open/);
    expect(screen.getByLabelText('Invite code for seat 2').textContent).toBe(CODE);
    await press('Copy the code for seat 2');
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(screen.getByRole('button', { name: 'Copy the code for seat 2' }).textContent).toBe('Copied');
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for 1 more player to join/);
    expect(screen.getByText(/Send each code only to the player it is for/)).toBeTruthy();
    expect(screen.getByText(/15 minutes on their clock/)).toBeTruthy();
  });

  it('New codes asks the server and shows the new ones for the seats still open', async () => {
    const s = await made();
    await push(s, tableMsg({ seats: [seatView(1, 'Alice'), seatView(2, null)] }));
    s.socket().reply('create', { ok: true, table: 'T1', codes: [CODE] });
    await reactAct(flush);
    await press('New codes');
    expect(s.socket().last('codes')).toBeDefined();
    s.socket().reply('codes', { ok: true, table: 'T1', codes: ['AAAA-BBBB-CCCC-DDDD'] });
    await reactAct(flush);
    expect(screen.getByLabelText('Invite code for seat 2').textContent).toBe('AAAA-BBBB-CCCC-DDDD');
  });

  it('after a reload the codes come back from the page\'s storage; a seat with no code says to make new ones', async () => {
    const storage = new MemoryHostedStorage({ token: TOKEN, nextId: 9, name: 'Alice', table: null, codes: { table: 'T1', list: [{ seat: 2, code: CODE }] } });
    const s = setup({ storage, welcome: welcomeMsg({ resumed: true, table: 'T1', seat: 1 }) });
    await s.open();
    await push(s, tableMsg({ seats: [seatView(1, 'Alice'), seatView(2, null), seatView(3, null)] }));
    expect(screen.getByLabelText('Invite code for seat 2').textContent).toBe(CODE);
    expect(screen.getByText(/no code to show here: make new ones/)).toBeTruthy();
  });

  it('shows what the server refuses, in words, with a deck\'s problems listed', async () => {
    const s = await made();
    s.socket().reply('create', { error: { code: 'deckRejected', message: 'The deck is not legal for this table.', details: ['Forest: more than 4 copies.'] } });
    await reactAct(flush);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/The deck was refused for this table/);
    expect(within(alert).getByText('Forest: more than 4 copies.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make a table' })).toBeTruthy();
  });

  it('a table the server closes (nobody joined, or its creator left) is gone from the room, with the server\'s words', async () => {
    const s = await made();
    await push(s, tableMsg());
    s.socket().reply('create', { ok: true, table: 'T1', codes: [CODE] });
    await reactAct(flush);
    expect(screen.getByRole('region', { name: 'Waiting room' })).toBeTruthy();
    await push(s, { t: 'notice', kind: 'tableExpired', text: 'The table expired: nobody joined for 5 minutes.' });
    expect(screen.queryByRole('region', { name: 'Waiting room' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make a table' })).toBeTruthy();
  });

  it('Close the table stands the creator up (the server closes the table), and leaving the screen does too', async () => {
    const s = await made();
    await push(s, tableMsg());
    s.socket().reply('create', { ok: true, table: 'T1', codes: [CODE] });
    await reactAct(flush);
    await press('Close the table');
    expect(s.socket().last('leave')).toBeDefined();
    s.socket().reply('leave');
    await reactAct(flush);
    expect(screen.getByRole('button', { name: 'Make a table' })).toBeTruthy();
  });

  it('leaving the screen from the waiting room leaves the table first and then closes the socket', async () => {
    const s = await made();
    await push(s, tableMsg());
    s.socket().reply('create', { ok: true, table: 'T1', codes: [CODE] });
    await reactAct(flush);
    await press('Back');
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    s.socket().reply('leave');
    await reactAct(flush);
    expect(s.link.linkState()).toBe('closed');
  });
});

describe('joining with an invite code', () => {
  it('sends the code as typed, with the deck, and shows the table the server puts the player at', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: ` ${CODE.toLowerCase()} ` } });
    await press('Join the table');
    expect(s.socket().last('join')).toMatchObject({ t: 'join', code: CODE.toLowerCase(), deck: { main: expect.any(Array) } });
    await push(s, tableMsg({ you: 2, seats: [seatView(1, 'Bob'), seatView(2, 'Alice')], creator: 1, title: "Bob's table" }));
    s.socket().reply('join', { ok: true, table: 'T1', warnings: ['Companion was not checked.'] });
    await reactAct(flush);
    const room = screen.getByRole('region', { name: 'Waiting room' });
    expect(within(room).getByRole('heading', { name: "Bob's table" })).toBeTruthy();
    expect(text(within(room).getAllByRole('listitem')[1]!)).toMatch(/Seat 2 Alice \(you\)/);
    // only the creator sees codes; a joiner stands up with "Leave the table"
    expect(screen.queryByText('Invite codes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave the table' })).toBeTruthy();
    expect(screen.getByLabelText('Deck warnings').textContent).toContain('Companion was not checked.');
  });

  it('a code that is not valid says what to check', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: CODE } });
    await press('Join the table');
    s.socket().reply('join', { error: { code: 'badCode', message: 'That invite code is not valid (or its seat is taken).' } });
    await reactAct(flush);
    expect(screen.getByRole('alert').textContent).toMatch(/That invite code is not valid\. Check it with the player who made the table/);
    expect(screen.getByRole('button', { name: 'Join the table' })).toBeTruthy();
  });

  it('a busy server and a session already in a game are explained', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: CODE } });
    await press('Join the table');
    s.socket().reply('join', { error: { code: 'serverBusy', message: 'The server is busy; please try again in a few minutes.', retryAfterMs: 180_000 } });
    await reactAct(flush);
    expect(screen.getByRole('alert').textContent).toMatch(/The server is busy right now\. Please try again in about 3 minutes/);
  });
});

describe('the ready check and the capacity wait', () => {
  async function inRoom(table: Parameters<typeof tableMsg>[0] = {}) {
    const s = setup({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    await s.open();
    await push(s, tableMsg({ seats: [seatView(1, 'Alice'), seatView(2, 'Bob')], ...table }));
    return s;
  }

  it('a full table that waits for room says its place in line and the estimate', async () => {
    const s = await inRoom({ status: 'waitingCapacity' });
    await push(s, { t: 'queueStatus', queue: { kind: 'capacity', table: 'T1', position: 2, unitsAhead: 3, estimatedWaitMs: 150_000 } });
    expect(screen.getByRole('status').textContent).toMatch(/The server is busy right now\. Your game starts as soon as there is room: you are number 2 in line, about 3 minutes\./);
    // without an estimate
    await push(s, { t: 'queueStatus', queue: { kind: 'capacity', table: 'T1', position: 1, unitsAhead: 0, estimatedWaitMs: null } });
    expect(screen.getByRole('status').textContent).toMatch(/you are number 1 in line\./);
  });

  it('the ready check counts down, confirms with the check\'s own id, and waits for the others', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await inRoom({ status: 'readyCheck' });
    await push(s, { t: 'readyCheck', start: 'RC1', deadlineAt: 0, players: [{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: true }] });
    expect(screen.getByRole('group', { name: 'Ready check' })).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'Time left to confirm' }).textContent).toBe('0:30');
    reactAct(() => vi.advanceTimersByTime(7000));
    expect(screen.getByRole('timer', { name: 'Time left to confirm' }).textContent).toBe('0:23');
    const seats = within(screen.getByRole('list', { name: 'Players at the table' })).getAllByRole('listitem').map(text);
    expect(seats[0]).toBe('Seat 1 Alice (you, made the table) · here, not ready yet');
    expect(seats[1]).toBe('Seat 2 Bob · here, ready');
    await press("I'm ready");
    expect(s.socket().last('ready')).toMatchObject({ t: 'ready', start: 'RC1' });
    s.socket().reply('ready', { ok: true, table: 'T1' });
    await reactAct(async () => {
      s.socket().push({ t: 'readyCheck', start: 'RC1', deadlineAt: 0, players: [{ seat: 1, name: 'Alice', ready: true }, { seat: 2, name: 'Bob', ready: true }] });
    });
    const waiting = screen.getByRole('button', { name: 'Waiting for the others…' });
    expect(disabled(waiting)).toBe(true);
  });

  it('a check that failed puts the table back in the lobby with the server\'s words', async () => {
    const s = await inRoom({ status: 'readyCheck' });
    await push(s, { t: 'readyCheck', start: 'RC1', deadlineAt: 0, players: [] });
    await push(s, { t: 'notice', kind: 'readyCheckFailed', text: 'Not every player confirmed in time; the table is open again.' });
    await push(s, tableMsg({ status: 'lobby', seats: [seatView(1, 'Alice'), seatView(2, null)] }));
    expect(screen.queryByRole('group', { name: 'Ready check' })).toBeNull();
    expect(screen.getByText('Not every player confirmed in time; the table is open again.')).toBeTruthy();
  });
});

describe('the game begins', () => {
  async function started() {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    await press('Make a table');
    await push(s, tableMsg());
    s.socket().reply('create', { ok: true, table: 'T1', codes: [CODE] });
    await reactAct(flush);
    return s;
  }

  it('opens the game screen with the first view, over a connection to the server', async () => {
    const s = await started();
    const g = gameViews();
    await push(s, tableMsg({ status: 'playing', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    expect(screen.getByRole('status').textContent).toMatch(/The game is starting/);
    await push(s, { t: 'start', table: 'T1', players: [{ id: 'p1', name: 'Alice', seat: 1 }, { id: 'p2', name: 'Bob', seat: 2 }] });
    await push(s, g.full('p1'));
    await waitFor(() => expect(s.route().screen).toBe('game'));
    expect(await screen.findByLabelText('Game on the DigiDice server')).toBeTruthy();
    // the link now belongs to the game: leaving the entry screen did not stand the player up
    expect(s.socket().all('leave')).toHaveLength(0);
    expect(s.link.linkState()).toBe('open');
  });
});

describe('a game that is open already (a reload, another window)', () => {
  it('offers to return to it, and leaving it concedes', async () => {
    const storage = new MemoryHostedStorage({ token: TOKEN, nextId: 20, name: 'Alice', table: null, codes: null });
    const s = setup({ storage, welcome: welcomeMsg({ resumed: true, table: 'T1', seat: 1 }) });
    await s.open();
    const g = gameViews();
    await push(s, g.full('p1'));
    await push(s, tableMsg({ status: 'playing', title: 'Friday game', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    const panel = screen.getByRole('region', { name: 'Open game' });
    expect(panel.textContent).toMatch(/Friday game/);
    expect(panel.textContent).toMatch(/leaving a game that is not over concedes it/);
    // no entry form while a game is open
    expect(screen.queryByRole('button', { name: 'Make a table' })).toBeNull();
    // the command counter went on from the page's storage
    expect(s.socket().sent[0]).toMatchObject({ t: 'hello', token: TOKEN });
    await press('Leave that game');
    // the first command of this page took id 20 (the lobby browser, shown until the table arrived, may have asked for the list first)
    expect((s.socket().sent.find((m) => typeof m['id'] === 'number') as { id: number }).id).toBe(20);
    expect(s.socket().last('leave').id).toBeGreaterThanOrEqual(20);
    s.socket().reply('leave');
    await reactAct(flush);
    expect(screen.getByRole('button', { name: 'Make a table' })).toBeTruthy();
  });

  it('Return to the game opens the game screen', async () => {
    const s = setup({ welcome: welcomeMsg({ resumed: true, table: 'T1', seat: 1 }) });
    await s.open();
    const g = gameViews();
    await push(s, g.full('p1'));
    await push(s, tableMsg({ status: 'playing', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    await press('Return to the game');
    expect(s.route().screen).toBe('game');
  });
});
