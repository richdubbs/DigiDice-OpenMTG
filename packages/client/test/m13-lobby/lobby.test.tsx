/**
 * M13-12: the lobby browser, open tables with passwords, quick match and the wait for room on a busy server, on the Play on the DigiDice server screen,
 * with a fake socket the test drives as the hosted server would (normal traffic only: no sockets, no network). Hosted design 4.2, 4.3, 4.5, 4.6, 12.
 */
import type { HostedServerMessage, LobbyListing } from '@openmtg/hosted/api';
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../../src/app/nav';
import type { GameDeck } from '../../src/game/services';
import { HostedScreen } from '../../src/hosted/room/HostedScreen';
import type { HostedServices } from '../../src/hosted/room/services';
import { toHostedDeck } from '../../src/hosted/room/services';
import { testSettings } from '../game-fixtures';
import { CLOCK, fakeHosted, flush, seatView, SERVER, tableMsg, welcomeMsg } from '../m13/fakes';

const green: GameDeck = { id: 'saved:green', name: 'My green deck', format: 'casual', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [] } };
const commander: GameDeck = { id: 'saved:cmd', name: 'Commander deck', format: 'commander', deck: { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Test Bear', count: 1 }] } };
const T = Date.now();

function listing(table: string, o: Partial<LobbyListing> = {}): LobbyListing {
  return { table, title: `Table ${table}`, format: 'casual', variant: null, seats: 2, filled: 1, locked: false, clock: CLOCK, creator: 'Bob', ranked: false, createdAt: T - 120_000, ...o };
}

type Fake = ReturnType<typeof fakeHosted>;

function setup(o: Parameters<typeof fakeHosted>[0] = {}) {
  const f = fakeHosted(o);
  const services: HostedServices = {
    listDecks: async () => [green, commander],
    openLink: (_url, name) => {
      f.link.setName(name);
      return f.link;
    },
  };
  function Shell() {
    const nav = useNav();
    if (nav.route.screen === 'hosted') return <HostedScreen services={services} settings={testSettings()} server={SERVER} />;
    return <p data-testid="route">{nav.route.screen}</p>;
  }
  const open = async () => {
    render(
      <NavProvider initial={{ screen: 'hosted' }}>
        <Shell />
      </NavProvider>,
    );
    await reactAct(flush);
    await reactAct(flush);
  };
  return { ...f, open };
}

const press = (name: string | RegExp) => reactAct(async () => void fireEvent.click(screen.getByRole('button', { name })));
const push = (s: Fake, m: HostedServerMessage) => reactAct(async () => s.socket().push(m));
const choose = (label: string, value: string) => reactAct(async () => void fireEvent.change(screen.getByLabelText(label), { target: { value } }));

/** Answers the lobby feed's first `watchLobby` and the `browse` after it with `tables`. */
async function serveLobby(s: Fake, tables: LobbyListing[], total = tables.length) {
  await waitFor(() => expect(s.socket().all('watchLobby').length).toBeGreaterThan(0));
  await reactAct(async () => s.socket().reply('watchLobby'));
  await waitFor(() => expect(s.socket().all('browse').length).toBeGreaterThan(0));
  await reactAct(async () => s.socket().reply('browse', { ok: true, tables, total }));
}

const tablesList = () => screen.getByRole('list', { name: 'Tables' });

afterEach(() => {
  vi.useRealTimers();
});

describe('M13-12 the lobby browser', () => {
  it('watches first, then asks for the page; shows each table with its format, seats, clocks, maker and age', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, [listing('T1', { title: 'Friday casual' }), listing('T2', { title: 'Locked one', locked: true, createdAt: T - 600_000 })]);
    // the watch comes before the page, so no change falls between the two
    const order = s.socket().sent.map((m) => m['t']).filter((t) => t === 'watchLobby' || t === 'browse');
    expect(order.slice(0, 2)).toEqual(['watchLobby', 'browse']);
    expect(s.socket().last('watchLobby')['filter']).toEqual({ open: true });
    const rows = within(tablesList()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/Friday casual/);
    expect(rows[0]!.textContent).toMatch(/Casual · 1 of 2 seats taken · 15 min each, 5 s free per decision · made by Bob · 2 min ago/);
    expect(rows[1]!.textContent).toMatch(/password/);
    expect(screen.getByText(/The list updates by itself/)).toBeTruthy();
  });

  it('a live batch adds, changes and removes tables', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, [listing('T1'), listing('T2')]);
    await push(s, { t: 'lobbyUpdate', added: [listing('T3', { title: 'Brand new', createdAt: T })], changed: [listing('T2', { title: 'Renamed' })], removed: ['T1'] });
    const text = tablesList().textContent ?? '';
    expect(text).toMatch(/Brand new/);
    expect(text).toMatch(/Renamed/);
    expect(text).not.toMatch(/Table T1/);
    // a table that filled leaves the "free seat" list
    await push(s, { t: 'lobbyUpdate', added: [], changed: [listing('T2', { title: 'Renamed', filled: 2 })], removed: [] });
    expect(tablesList().textContent).not.toMatch(/Renamed/);
  });

  it('a filter is sent to the server as a new watch and a new page', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, []);
    expect(screen.getByText(/No open tables match/)).toBeTruthy();
    await choose('Show passwords', 'no');
    await waitFor(() => expect(s.socket().all('browse').length).toBe(2));
    expect(s.socket().last('browse')).toMatchObject({ filter: { open: true, locked: false }, sort: 'newest', page: 0 });
    await reactAct(async () => s.socket().reply('browse', { ok: true, tables: [], total: 0 }));
    await choose('Sort by', 'filled');
    await waitFor(() => expect(s.socket().last('browse')['sort']).toBe('filled'));
  });

  it('a server that cannot give a live view: the page refreshes on its own, and says so', async () => {
    const s = setup();
    await s.open();
    await waitFor(() => expect(s.socket().all('watchLobby').length).toBe(1));
    await reactAct(async () => s.socket().reply('watchLobby', { error: { code: 'limitReached', message: 'The live lobby is full right now.', retryAfterMs: 60_000 } }));
    await waitFor(() => expect(s.socket().all('browse').length).toBe(1));
    await reactAct(async () => s.socket().reply('browse', { ok: true, tables: [listing('T1')], total: 1 }));
    expect(screen.getByText(/The list refreshes every 10 seconds/)).toBeTruthy();
  });

  it('Join sits at an open table with the deck chosen above; no deck, no join', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, [listing('T1', { title: 'Friday casual' })]);
    const join = screen.getByRole('button', { name: 'Join Friday casual' }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    expect(join.title).toMatch(/Choose a deck/);
    await choose('Deck', green.id);
    expect(join.disabled).toBe(false);
    await press('Join Friday casual');
    await waitFor(() => expect(s.socket().all('join').length).toBe(1));
    expect(s.socket().last('join')).toMatchObject({ t: 'join', table: 'T1', deck: toHostedDeck(green.deck) });
    expect(s.socket().last('join')['password']).toBeUndefined();
    s.socket().reply('join', { ok: true, table: 'T1' });
    await push(s, tableMsg({ table: 'T1', title: 'Friday casual', source: 'listed', you: 2, creator: 1, seats: [seatView(1, 'Bob'), seatView(2, 'Alice')] }));
    expect(screen.getByRole('region', { name: 'Waiting room' }).textContent).toMatch(/Open table · 2 players/);
  });

  it('a deck for another format cannot sit at that table, and says why', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, [listing('T1', { title: 'Casual table' })]);
    await choose('Deck', green.id);
    expect((screen.getByRole('button', { name: 'Join Casual table' }) as HTMLButtonElement).disabled).toBe(false);
    await choose('Deck', commander.id);
    expect((screen.getByRole('button', { name: 'Join Casual table' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(tablesList()).getByText('Your deck cannot be played in Casual.')).toBeTruthy();
  });

  it('a table with a password asks for it; a wrong one is said by the table and is never stored', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, [listing('T1', { title: 'Secret club', locked: true })]);
    await choose('Deck', green.id);
    await press('Join Secret club');
    const field = screen.getByLabelText('Password for Secret club');
    expect((screen.getByRole('button', { name: 'Join with this password' }) as HTMLButtonElement).disabled).toBe(true);
    await reactAct(async () => void fireEvent.change(field, { target: { value: 'abc' } }));
    expect(screen.getByText(/too short/)).toBeTruthy();
    await reactAct(async () => void fireEvent.change(field, { target: { value: 'wrong one' } }));
    await press('Join with this password');
    await waitFor(() => expect(s.socket().all('join').length).toBe(1));
    expect(s.socket().last('join')).toMatchObject({ table: 'T1', password: 'wrong one' });
    await reactAct(async () => s.socket().reply('join', { error: { code: 'badPassword', message: 'That is not the password of this table.' } }));
    expect(within(tablesList()).getByText('That is not the password of this table.')).toBeTruthy();
    // the prompt stays, emptied
    expect((screen.getByLabelText('Password for Secret club') as HTMLInputElement).value).toBe('');
    // the password is never kept anywhere the page stores
    expect(JSON.stringify(s.storage.session)).not.toMatch(/wrong one/);
  });

  it('Report sends a title report for that table, once, and thanks the player', async () => {
    const s = setup();
    await s.open();
    await serveLobby(s, [listing('T1', { title: 'Bad words here' })]);
    await press('Report the title Bad words here');
    await reactAct(async () => void fireEvent.change(screen.getByLabelText(/What is wrong with this title/), { target: { value: 'Rude' } }));
    await press('Send the report');
    await waitFor(() => expect(s.socket().all('report').length).toBe(1));
    expect(s.socket().last('report')).toMatchObject({ t: 'report', kind: 'title', table: 'T1', text: 'Rude' });
    await reactAct(async () => s.socket().reply('report'));
    expect(screen.getByText('Reported. Thank you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Report the title Bad words here' })).toBeNull();
  });
});

describe('M13-12 an open table of your own', () => {
  it('"Anyone" makes a listed table, with its name and an optional password', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    await reactAct(async () => void fireEvent.click(screen.getByLabelText('Anyone: show it in Open tables')));
    await choose('Table name (optional)', '  Friday   night  ');
    await choose('Table password (optional)', 'open sesame');
    expect(screen.getByText(/only players who know the password can sit/)).toBeTruthy();
    await press('Make a table');
    await waitFor(() => expect(s.socket().all('create').length).toBe(1));
    expect(s.socket().last('create')).toMatchObject({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title: 'Friday night', password: 'open sesame' });
  });

  it('a name or password the server would refuse is refused here first; a private table has no password field', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    expect(screen.queryByLabelText('Table password (optional)')).toBeNull();
    await choose('Table name (optional)', 'ab');
    expect((screen.getByRole('button', { name: 'Make a table' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/too short/)).toBeTruthy();
    await choose('Table name (optional)', '');
    await reactAct(async () => void fireEvent.click(screen.getByLabelText('Anyone: show it in Open tables')));
    await choose('Table password (optional)', 'abc');
    expect((screen.getByRole('button', { name: 'Make a table' }) as HTMLButtonElement).disabled).toBe(true);
    await choose('Table password (optional)', '');
    expect((screen.getByRole('button', { name: 'Make a table' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('M13-12 quick match', () => {
  it('Find a game queues for the format chosen above; while it looks the screen says for what, for how long, and how many wait', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    await press('Find a game');
    await waitFor(() => expect(s.socket().all('queue').length).toBe(1));
    expect(s.socket().last('queue')).toMatchObject({ t: 'queue', format: 'casual', size: 2, deck: toHostedDeck(green.deck) });
    await reactAct(async () => s.socket().reply('queue'));
    const panel = screen.getByRole('region', { name: 'Looking for a game' });
    expect(panel.textContent).toMatch(/Casual, two players/);
    expect(screen.queryByRole('button', { name: 'Make a table' })).toBeNull();
    await push(s, { t: 'queueStatus', queue: { kind: 'match', format: 'casual', size: 2, waiting: 3, estimatedWaitMs: 90_000 } });
    expect(panel.textContent).toMatch(/3 players are waiting for this kind of game, you included\. The server expects a match in about 2 minutes\./);
  });

  it('Stop looking leaves the queue and brings the choices back', async () => {
    const s = setup({ welcome: welcomeMsg({ queue: { kind: 'match', format: 'standard', size: 2, waiting: 1, estimatedWaitMs: null } }) });
    await s.open();
    // a reload while queued: the search is found again from the welcome
    expect(screen.getByRole('region', { name: 'Looking for a game' }).textContent).toMatch(/Standard, two players/);
    expect(screen.getByText(/Nobody else is waiting/)).toBeTruthy();
    await press('Stop looking');
    await waitFor(() => expect(s.socket().all('unqueue').length).toBe(1));
    await reactAct(async () => s.socket().reply('unqueue'));
    expect(screen.queryByRole('region', { name: 'Looking for a game' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Find a game' })).toBeTruthy();
  });

  it('a match found goes to the waiting room and its ready check; a check that fails after you confirmed puts you back in the queue', async () => {
    const s = setup();
    await s.open();
    await choose('Deck', green.id);
    await press('Find a game');
    await waitFor(() => expect(s.socket().all('queue').length).toBe(1));
    await reactAct(async () => s.socket().reply('queue'));
    await push(s, tableMsg({ table: 'M1', title: 'Quick match', source: 'matched', status: 'readyCheck', creator: null, seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    await push(s, { t: 'readyCheck', start: 'S1', deadlineAt: Date.now() + 15_000, players: [{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: false }] });
    const room = screen.getByRole('region', { name: 'Waiting room' });
    expect(room.textContent).toMatch(/Quick match · 2 players/);
    await press("I'm ready");
    await waitFor(() => expect(s.socket().all('ready').length).toBe(1));
    await reactAct(async () => s.socket().reply('ready'));
    await push(s, { t: 'notice', kind: 'readyCheckFailed', text: 'Not every player confirmed in time: you are back in the queue.' });
    expect(screen.queryByRole('region', { name: 'Waiting room' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Looking for a game' })).toBeTruthy();
  });

  it('a pod is offered only for a format whose tables can seat more than two', async () => {
    const pods = welcomeMsg();
    pods.server.formats = [...pods.server.formats.filter((f) => f.id !== 'commander'), { id: 'commander', seats: [2, 3, 4], clock: CLOCK }];
    const s = setup({ welcome: pods });
    await s.open();
    expect(screen.queryByLabelText('Game size')).toBeNull();
    await choose('Deck', commander.id);
    await choose('Game size', 'pod');
    await press('Find a game');
    await waitFor(() => expect(s.socket().all('queue').length).toBe(1));
    expect(s.socket().last('queue')).toMatchObject({ format: 'commander', size: 'pod' });
  });
});

describe('M13-12 a busy server', () => {
  it('the entry screen says when new games wait for room, or cannot start', async () => {
    const busy = welcomeMsg();
    busy.server = { ...busy.server, capacity: 'queueing' };
    const s = setup({ welcome: busy });
    await s.open();
    expect(screen.getByRole('note').textContent).toMatch(/a new game may wait in line for room/);
  });

  it('a full table waiting for room shows its place, the estimate and the time waited; Leave stands up', async () => {
    const s = setup();
    await s.open();
    await push(s, tableMsg({ status: 'waitingCapacity', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    await push(s, { t: 'queueStatus', queue: { kind: 'capacity', table: 'T1', position: 3, unitsAhead: 5, estimatedWaitMs: 30_000 } });
    const wait = screen.getByRole('group', { name: 'Waiting for room on the server' });
    expect(wait.textContent).toMatch(/you are number 3 in line, less than a minute\./);
    expect(within(wait).getByRole('timer').textContent).toMatch(/^0:0\d$/);
    await push(s, { t: 'queueStatus', queue: { kind: 'capacity', table: 'T1', position: 1, unitsAhead: 0, estimatedWaitMs: 40 * 60_000 } });
    expect(wait.textContent).toMatch(/number 1 in line, 20 minutes at the most\./);
    await press('Close the table');
    await waitFor(() => expect(s.socket().all('leave').length).toBe(1));
  });
});
