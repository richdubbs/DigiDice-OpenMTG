/**
 * M12-5b (docs/design/m12-multiplayer.md 6, one join code per seat): the Host and Join screens of a 3-4 player game with a fake local
 * server socket (normal traffic only). The host chooses the players, gets one code per guest seat with Copy and its taken status, and waits in the lobby
 * until every seat is taken; a guest joins with its seat's code and waits in the lobby; the game opens by itself at the start.
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatJoinCode, normalizeJoinCode } from '@openmtg/net';
import type { OnlineStatus, ServerMessage } from '@openmtg/server/online';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav, type Route } from '../../src/app/nav';
import type { GameDeck } from '../../src/game/services';
import { HostScreen } from '../../src/online/HostScreen';
import { JoinScreen } from '../../src/online/JoinScreen';
import { explainOnlineError } from '../../src/online/errors';
import { toOnlineDeck, type OnlineServices } from '../../src/online/setup';
import { testSettings } from '../game-fixtures';
import { IDLE, fakeLink, flush } from '../online-fakes';
import { CODES, codes, statusMsg, table, tableStatus, tableViews } from './fixtures';

const commander: GameDeck = { id: 'saved:cmd', name: 'Commander deck', deck: { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Test Bear', count: 1 }] } };
const green: GameDeck = { id: 'saved:green', name: 'My green deck', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [] } };
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const disabled = (el: Element) => (el as HTMLButtonElement).disabled;

function setup(initial?: ServerMessage[]) {
  const f = fakeLink(initial ? { initial } : {});
  const services: OnlineServices = { listDecks: async () => [green, commander], openLink: () => f.link };
  let route: Route = { screen: 'home' };
  function Shell() {
    const nav = useNav();
    route = nav.route;
    if (nav.route.screen === 'hostOnline') return <HostScreen services={services} settings={testSettings()} />;
    if (nav.route.screen === 'joinOnline') return <JoinScreen services={services} settings={testSettings()} />;
    return <p data-testid="route">{nav.route.screen}</p>;
  }
  const open = async (start: 'hostOnline' | 'joinOnline') => {
    render(
      <NavProvider initial={{ screen: start }}>
        <Shell />
      </NavProvider>,
    );
    await reactAct(flush);
    await reactAct(flush);
  };
  return { ...f, open, route: () => route };
}

async function choose(label: string, value: string) {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

const lobby = (s: Omit<Partial<OnlineStatus>, 'role' | 'me' | 'seats'>, taken: number, seats: 3 | 4 = 3): OnlineStatus =>
  tableStatus({ role: 'host', me: 'p1', phase: 'waiting', seats, players: table(seats, [], taken), codes: codes(seats, taken), ...s });

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('Host a game of 3 or 4 players', () => {
  it('Players: 2 / 3 / 4; Duel Commander stays a two-player format', async () => {
    const s = setup();
    await s.open('hostOnline');
    const players = screen.getByLabelText('Players') as HTMLSelectElement;
    expect([...players.options].map((o) => o.value)).toEqual(['2', '3', '4']);
    expect(players.value).toBe('2');
    await choose('Deck', commander.id);
    await choose('Players', '3');
    await choose('Format', 'duel');
    expect(screen.getAllByText(/Duel Commander is a two-player format/).length).toBeGreaterThan(0);
    expect(disabled(screen.getByRole('button', { name: 'Host game' }))).toBe(true);
    await choose('Format', 'commander');
    expect(disabled(screen.getByRole('button', { name: 'Host game' }))).toBe(false);
    expect(screen.getByText(/one join code for each other seat/)).toBeTruthy();
  });

  it('sends the seats, shows one code per guest seat with Copy and whether it is taken, the lobby, and opens the game when every seat is taken', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const s = setup();
    await s.open('hostOnline');
    await choose('Deck', green.id);
    await choose('Players', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Host game' }));
    await reactAct(flush);
    const sock = s.socket();
    expect(sock.last('host')).toMatchObject({ t: 'host', seats: 3, deck: toOnlineDeck(green.deck), format: 'casual' });
    reactAct(() => {
      sock.push(statusMsg(lobby({}, 1)));
      sock.reply('host');
    });
    await reactAct(flush);
    const region = screen.getByRole('region', { name: 'Lobby' });
    const codeList = within(region).getByRole('list', { name: 'Join codes' });
    expect(within(codeList).getAllByRole('listitem').map(text)).toEqual([`Seat 2 ${CODES[0]} Copy Open`, `Seat 3 ${CODES[1]} Copy Open`]);
    expect(text(within(region).getByLabelText('Join code for seat 3'))).toBe(CODES[1]);
    expect(text(within(region).getByRole('status'))).toBe('Waiting for 2 more players to join… The game starts when every seat is taken.');
    expect(within(within(region).getByRole('list', { name: 'Players at the table' })).getAllByRole('listitem').map(text)).toEqual([
      'Seat 1 Alice (you, the host)',
      'Seat 2 open',
      'Seat 3 open',
    ]);
    expect(text(within(region).getByText(/How the other players reach you/).closest('details')!)).toMatch(/the join code of their own seat/);
    // Copy the code of seat 3.
    fireEvent.click(within(region).getByRole('button', { name: 'Copy the code for seat 3' }));
    await reactAct(flush);
    expect(writeText).toHaveBeenCalledWith(CODES[1]);
    expect(text(within(region).getByRole('button', { name: 'Copy the code for seat 3' }))).toBe('Copied');
    // Bob takes seat 2 (its code is spent: no Copy any more).
    reactAct(() => {
      sock.push({ t: 'notice', kind: 'opponentJoined', text: 'Bob took seat 2.', player: 'p2' });
      sock.push(statusMsg(lobby({}, 2)));
    });
    expect(within(codeList).getAllByRole('listitem').map(text)).toEqual([`Seat 2 ${CODES[0]} Taken by Bob`, `Seat 3 ${CODES[1]} Copied Open`]);
    expect(text(within(region).getByRole('status'))).toBe('Waiting for 1 more player to join… The game starts when every seat is taken.');
    // Carol takes seat 3: the game starts, the screen opens the table.
    const g = tableViews(3);
    reactAct(() => {
      sock.push(statusMsg(tableStatus({ role: 'host', me: 'p1' })));
      sock.push(g.msg('p1'));
    });
    await waitFor(() => expect(s.route().screen).toBe('game'));
    const r = s.route() as Extract<Route, { screen: 'game' }>;
    expect(r.connection.view().viewer).toBe('p1');
    expect(r.connection.view().players).toHaveLength(3);
  });

  it('Stop hosting leaves the lobby', async () => {
    const s = setup([statusMsg(lobby({}, 2, 4))]);
    await s.open('hostOnline');
    const region = screen.getByRole('region', { name: 'Lobby' });
    expect(text(within(region).getByRole('status'))).toMatch('Waiting for 2 more players');
    fireEvent.click(within(region).getByRole('button', { name: 'Stop hosting' }));
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
  });
});

describe('Join a game of 3 or 4 players', () => {
  it('joins with the seat\'s code, waits in the lobby, and opens the game at the start', async () => {
    const s = setup();
    await s.open('joinOnline');
    expect(screen.getByText(/the code of your own seat/)).toBeTruthy();
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Host address and join code'), { target: { value: `203.0.113.7:47620 ${CODES[1]}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));
    await reactAct(flush);
    const sock = s.socket();
    // The code as the server reads it (net normalizeJoinCode): this fixture's L, which is not in the alphabet, is read as 1.
    expect(sock.last('join')).toMatchObject({ t: 'join', code: formatJoinCode(normalizeJoinCode(CODES[1]!)!), address: '203.0.113.7:47620' });
    // Seated in seat 3 of 4; Alice (the host) and Bob are there.
    const waiting = tableStatus({ role: 'guest', me: 'p3', phase: 'waiting', seats: 4, players: table(4, [], 3) });
    delete waiting.codes;
    reactAct(() => {
      sock.push(statusMsg(waiting));
      sock.reply('join');
    });
    await reactAct(flush);
    const region = screen.getByRole('region', { name: 'Lobby' });
    expect(text(within(region).getByRole('heading'))).toBe('You have seat 3');
    expect(within(within(region).getByRole('list', { name: 'Players at the table' })).getAllByRole('listitem').map(text)).toEqual([
      'Seat 1 Alice (the host)',
      'Seat 2 Bob',
      'Seat 3 Carol (you)',
      'Seat 4 open',
    ]);
    expect(text(within(region).getByRole('status'))).toBe('Waiting for 1 more player to join… The game starts when every seat is taken.');
    expect(screen.queryByRole('button', { name: 'Join game' })).toBeNull();
    // Dan takes the last seat: the game starts.
    const g = tableViews(4);
    reactAct(() => {
      sock.push(statusMsg(tableStatus({ role: 'guest', me: 'p3', seats: 4, players: table(4) })));
      sock.push(g.msg('p3'));
    });
    await waitFor(() => expect(s.route().screen).toBe('game'));
    expect((s.route() as Extract<Route, { screen: 'game' }>).connection.view().viewer).toBe('p3');
  });

  it('Leave the table gives the seat back', async () => {
    const waiting = tableStatus({ role: 'guest', me: 'p2', phase: 'waiting', players: table(3, [], 2) });
    const s = setup();
    await s.open('joinOnline');
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Host address and join code'), { target: { value: `${CODES[0]} 203.0.113.7` } });
    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));
    await reactAct(flush);
    reactAct(() => {
      s.socket().push(statusMsg(waiting));
      s.socket().reply('join');
    });
    await reactAct(flush);
    fireEvent.click(screen.getByRole('button', { name: 'Leave the table' }));
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    reactAct(() => {
      s.socket().push(statusMsg(IDLE));
      s.socket().reply('leave');
    });
    await reactAct(flush);
    expect(screen.queryByRole('region', { name: 'Lobby' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Join game' })).toBeTruthy();
  });

  it('explains a seat that is taken (its code is spent) and a game that waits for every seat', () => {
    expect(explainOnlineError({ code: 'gameFull', message: 'Seat 3 is taken (each join code admits one player).' })).toEqual({
      message: 'That seat is taken.',
      hint: 'Seat 3 is taken (each join code admits one player). Each join code admits one player: ask the host for the code of a seat that is still open.',
    });
    expect(explainOnlineError({ code: 'gameFull', message: 'This game already has two players.' }).message).toBe('The host already has another player in this game.');
    expect(explainOnlineError({ code: 'notStarted', message: 'The game starts when every seat is taken.' }).message).toBe('The game starts when every seat is taken.');
    expect(explainOnlineError({ code: 'notStarted', message: 'The game starts when the guest joins.' }).message).toBe('The game starts when the other player joins.');
  });

  it('a game the server has open: the other players are named, and the lobby is said', async () => {
    const waiting = tableStatus({ role: 'guest', me: 'p2', phase: 'waiting', players: table(3, [], 2) });
    const s = setup([statusMsg(waiting)]);
    await s.open('hostOnline');
    expect(text(screen.getByRole('region', { name: 'Open game' }))).toMatch('You are in a game with Alice on this OpenMTG server (waiting in the lobby).');
  });
});
