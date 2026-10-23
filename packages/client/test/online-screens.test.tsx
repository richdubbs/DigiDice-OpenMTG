/**
 * Milestone 9 screens (src/online/HostScreen.tsx, JoinScreen.tsx, OnlineGamePanel.tsx; docs/design/online.md) with a fake local server socket: hosting
 * shows the join code, the port and the port-forwarding help, and opens the game when the guest joins; joining sends the address and the code and
 * explains a wrong code, a timeout and a version mismatch; a game the server already has can be returned to or left; leaving the setup screen stops
 * hosting; in the game, Leave leaves the online game and the host answers the guest's adjustments by hand.
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OnlineStatus, ServerMessage } from '@openmtg/server/online';
import { describe, expect, it } from 'vitest';
import { NavProvider, useNav, type Route } from '../src/app/nav';
import { RemoteConnection } from '../src/connection/RemoteConnection';
import { NewGameScreen } from '../src/game/NewGameScreen';
import type { GameDeck } from '../src/game/services';
import { HostScreen } from '../src/online/HostScreen';
import { JoinScreen, addressProblem } from '../src/online/JoinScreen';
import type { OnlineLink } from '../src/online/OnlineLink';
import { toOnlineDeck, type OnlineServices } from '../src/online/setup';
import { PRACTICE_DECKS } from '../src/game/practiceDecks';
import { renderGameApp, testSettings } from './game-fixtures';
import { IDLE, fakeLink, flush, gameViews } from './online-fakes';

const green: GameDeck = { id: 'saved:green', name: 'My green deck', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [{ name: 'Test Bear', count: 2 }] } };
const commander: GameDeck = { id: 'saved:cmd', name: 'Commander deck', deck: { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Test Bear', count: 1 }] } };
const CODE = 'K7Q2-M9XD-4TPA-HW3N';
const text = (el: Element) => el.textContent ?? '';
const disabled = (el: Element) => (el as HTMLButtonElement).disabled;

function setup(initial?: ServerMessage[]) {
  const f = fakeLink(initial ? { initial } : {});
  const services: OnlineServices = { listDecks: async () => [green, commander, ...PRACTICE_DECKS], openLink: () => f.link };
  let route: Route = { screen: 'home' };
  function Shell({ start }: { start: 'hostOnline' | 'joinOnline' }) {
    const nav = useNav();
    route = nav.route;
    if (nav.route.screen === 'hostOnline') return <HostScreen services={services} settings={testSettings()} />;
    if (nav.route.screen === 'joinOnline') return <JoinScreen services={services} settings={testSettings()} />;
    return (
      <>
        <p data-testid="route">{nav.route.screen}</p>
        <button type="button" onClick={() => nav.go({ screen: start })}>
          Open again
        </button>
        <button type="button" onClick={nav.back}>
          Test back
        </button>
      </>
    );
  }
  const open = async (start: 'hostOnline' | 'joinOnline') => {
    render(
      <NavProvider initial={{ screen: start }}>
        <Shell start={start} />
      </NavProvider>,
    );
    await reactAct(flush);
    await reactAct(flush);
  };
  return { ...f, open, route: () => route };
}

const status = (s: Partial<OnlineStatus>): ServerMessage => ({ t: 'status', status: { ...IDLE, ...s } });

async function choose(label: string, value: string) {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

describe('Host an online game', () => {
  it('sends the deck and options, shows the code, the port and the port-forwarding help, and opens the game when the guest joins', async () => {
    const s = setup();
    await s.open('hostOnline');
    expect(disabled(screen.getByRole('button', { name: 'Host game' }))).toBe(true);
    await choose('Deck', green.id);
    const port = screen.getByLabelText('UDP port');
    expect((port as HTMLInputElement).value).toBe('47620');
    fireEvent.change(port, { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Host game' }));
    await reactAct(flush);
    const sock = s.socket();
    expect(sock.last('host')).toMatchObject({ t: 'host', name: 'Player 1', format: 'casual', port: 50000, deck: toOnlineDeck(green.deck) });
    expect(toOnlineDeck(green.deck)).toEqual({ main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [{ name: 'Test Bear', count: 2 }] });
    reactAct(() => {
      sock.push(status({ role: 'host', phase: 'starting', me: 'p1', format: 'casual' }));
      sock.push(status({ role: 'host', phase: 'waiting', me: 'p1', format: 'casual', code: CODE, port: 50000, opponentConnected: false, warnings: ['2 cards have no legality data.'] }));
      sock.reply('host');
    });
    await reactAct(flush);
    const waiting = screen.getByRole('region', { name: 'Waiting for the other player' });
    expect(text(within(waiting).getByLabelText('Join code'))).toMatch(CODE);
    expect(text(within(waiting).getByLabelText('Port'))).toMatch('50000');
    expect(text(within(waiting).getByRole('status'))).toMatch('Waiting for the other player to join…');
    expect(within(waiting).getByText('2 cards have no legality data.')).toBeTruthy();
    const help = within(waiting).getByText(/How the other player reaches you/).closest('details')!;
    expect(text(help)).toMatch('Forward UDP port 50000 on your router to this PC.');
    expect(text(help)).toMatch(/public IP address/);
    expect(text(help)).toMatch(/OpenMTG does not look it up by itself/);
    expect(text(help)).toMatch(/Windows firewall/);
    // The guest joins: the game screen opens on a RemoteConnection over the same link.
    const g = gameViews();
    reactAct(() => {
      sock.push(status({ role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: true, code: CODE, port: 50000 }));
      sock.push(g.msg('p1'));
    });
    await waitFor(() => expect(s.route().screen).toBe('game'));
    const r = s.route() as Extract<Route, { screen: 'game' }>;
    expect(r.connection.kind).toBe('remote');
    expect(r.connection.view().viewer).toBe('p1');
    expect(r.online).toBe(s.link);
    expect(r.rematch).toBeUndefined();
    expect(sock.sent.map((m) => m['t'])).toEqual(['host']); // nothing left behind
  });

  it('explains a port in use, and refuses a Commander deck outside a Commander format before asking the server (M11-2)', async () => {
    const s = setup();
    await s.open('hostOnline');
    await choose('Deck', commander.id);
    expect(screen.getByText(/This deck has a commander: choose a Commander format to play it/)).toBeTruthy();
    expect(disabled(screen.getByRole('button', { name: 'Host game' }))).toBe(true);
    await choose('Deck', green.id);
    fireEvent.click(screen.getByRole('button', { name: 'Host game' }));
    await reactAct(flush);
    reactAct(() => s.socket().reply('host', { code: 'portInUse', message: 'UDP port 47620 is in use (another game or program); pick another port.' }));
    const alert = await screen.findByRole('alert');
    expect(text(alert)).toMatch('UDP port 47620 is in use');
    expect(text(alert)).toMatch(/Pick another port/);
    expect(disabled(screen.getByRole('button', { name: 'Host game' }))).toBe(false);
  });

  it('stops hosting when the player leaves the waiting screen (the port closes), and Stop hosting does the same', async () => {
    const s = setup();
    await s.open('hostOnline');
    await choose('Deck', green.id);
    fireEvent.click(screen.getByRole('button', { name: 'Host game' }));
    await reactAct(flush);
    const sock = s.socket();
    reactAct(() => {
      sock.push(status({ role: 'host', phase: 'waiting', me: 'p1', code: CODE, port: 47620 }));
      sock.reply('host');
    });
    await reactAct(flush);
    fireEvent.click(screen.getByRole('button', { name: 'Stop hosting' }));
    await reactAct(flush);
    expect(sock.last('leave')).toMatchObject({ t: 'leave' });
    reactAct(() => {
      sock.push(status({}));
      sock.reply('leave');
    });
    await reactAct(flush);
    expect(screen.getByRole('button', { name: 'Host game' })).toBeTruthy();
    // Host again, then leave the screen with Back: the hosted game is left and the socket closed.
    fireEvent.click(screen.getByRole('button', { name: 'Host game' }));
    await reactAct(flush);
    reactAct(() => {
      sock.push(status({ role: 'host', phase: 'waiting', me: 'p1', code: CODE, port: 47620 }));
      sock.reply('host');
    });
    await reactAct(flush);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await reactAct(flush);
    expect(sock.sent.filter((m) => m['t'] === 'leave')).toHaveLength(2);
    reactAct(() => sock.reply('leave'));
    await reactAct(flush);
    expect(sock.closedWith).toMatchObject({ code: 1000 });
  });

  it('offers to return to a game the server has open (after a reload), or to leave it', async () => {
    const g = gameViews();
    const s = setup([status({ role: 'guest', phase: 'playing', me: 'p2', opponent: 'Hana', opponentConnected: true }), g.msg('p2')]);
    await s.open('hostOnline');
    const panel = screen.getByRole('region', { name: 'Open game' });
    expect(text(panel)).toMatch('You are in a game with Hana on this OpenMTG server (in progress).');
    expect(screen.queryByRole('button', { name: 'Host game' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Leave that game' }));
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    reactAct(() => {
      s.socket().push(status({}));
      s.socket().reply('leave');
    });
    await reactAct(flush);
    expect(screen.queryByRole('region', { name: 'Open game' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Host game' })).toBeTruthy();
  });

  it('after a reload, shows the code of a game it still hosts (no guest yet); the Join screen points there', async () => {
    const waiting = status({ role: 'host', phase: 'waiting', me: 'p1', code: CODE, port: 47620, opponentConnected: false });
    const j = setup([waiting]);
    await j.open('joinOnline');
    const panel = screen.getByRole('region', { name: 'Open game' });
    expect(text(panel)).toMatch('You are hosting a game on this OpenMTG server (waiting for the other player).');
    fireEvent.click(within(panel).getByRole('button', { name: 'Show the join code' }));
    expect(j.route().screen).toBe('hostOnline');
  });

  it('the Host screen takes over a game it still hosts after a reload', async () => {
    const s = setup([status({ role: 'host', phase: 'waiting', me: 'p1', code: CODE, port: 47620, opponentConnected: false })]);
    await s.open('hostOnline');
    expect(text(screen.getByLabelText('Join code'))).toBe(CODE);
    expect(screen.queryByRole('region', { name: 'Open game' })).toBeNull();
    const g = gameViews();
    reactAct(() => {
      s.socket().push(status({ role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: true }));
      s.socket().push(g.msg('p1'));
    });
    await waitFor(() => expect(s.route().screen).toBe('game'));
  });

  it('returns to the open game', async () => {
    const g = gameViews();
    const s = setup([status({ role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: true }), g.msg('p1')]);
    await s.open('hostOnline');
    fireEvent.click(screen.getByRole('button', { name: 'Return to the game' }));
    await waitFor(() => expect(s.route().screen).toBe('game'));
    expect(s.socket().sent).toEqual([]);
  });

  it('says when the local server is not there, and tries again', async () => {
    const f = fakeLink({ session: { f: () => Promise.reject(new TypeError('Failed to fetch')), calls: [] } });
    const services: OnlineServices = { listDecks: async () => [green], openLink: () => f.link };
    render(
      <NavProvider initial={{ screen: 'hostOnline' }}>
        <HostScreen services={services} settings={testSettings()} />
      </NavProvider>,
    );
    const alert = await screen.findByRole('alert');
    expect(text(alert)).toMatch('Online play is not available right now.');
    expect(text(alert)).toMatch(/npm run play/);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Join an online game', () => {
  async function fillAndJoin(s: ReturnType<typeof setup>, address = '203.0.113.7:47620') {
    await s.open('joinOnline');
    await choose('Deck', green.id);
    fireEvent.change(screen.getByLabelText('Host address'), { target: { value: address } });
    fireEvent.change(screen.getByLabelText('Join code'), { target: { value: CODE.toLowerCase() } });
    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));
    await reactAct(flush);
  }

  it('sends the address, the code, the name and the deck; opens the game with the first view', async () => {
    const s = setup();
    await fillAndJoin(s);
    const sock = s.socket();
    expect(sock.last('join')).toEqual({ t: 'join', id: 1, address: '203.0.113.7:47620', code: CODE.toLowerCase(), name: 'Player 1', deck: toOnlineDeck(green.deck) });
    reactAct(() => sock.push(status({ role: 'guest', phase: 'joining', address: '203.0.113.7:47620' })));
    expect(text(screen.getByRole('status'))).toMatch('Connecting to 203.0.113.7:47620…');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    const g = gameViews();
    reactAct(() => {
      sock.push(status({ role: 'guest', phase: 'playing', me: 'p2', opponent: 'Hana', opponentConnected: true, address: '203.0.113.7:47620' }));
      sock.push(g.msg('p2'));
      sock.reply('join');
    });
    await waitFor(() => expect(s.route().screen).toBe('game'));
    expect((s.route() as Extract<Route, { screen: 'game' }>).connection.view().viewer).toBe('p2');
  });

  it.each([
    ['badCode', 'The join code does not match.', /Wrong join code.*Check the code with the host/],
    ['timeout', 'No answer from the host.', /did not answer in time.*router must forward UDP 47620.*firewall/],
    ['version', 'The host runs engine 0.2, you run 0.1.', /versions do not match.*The host runs engine 0.2.*same OpenMTG version/],
    ['gameFull', 'This game already has two players.', /already has another player/],
    ['hostNotFound', 'Cannot find the host "nope".', /could not be found.*Cannot find the host "nope"/],
  ])('explains %s', async (code, message, shown) => {
    const s = setup();
    await fillAndJoin(s, code === 'timeout' ? '203.0.113.7' : '203.0.113.7:47620');
    reactAct(() => {
      s.socket().push(status({}));
      s.socket().reply('join', { code, message });
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(shown);
    expect(s.route().screen).toBe('joinOnline');
    expect(disabled(screen.getByRole('button', { name: 'Join game' }))).toBe(false);
  });

  it('lists the problems of a refused deck', async () => {
    const s = setup();
    await fillAndJoin(s);
    reactAct(() => s.socket().reply('join', { code: 'deckRejected', message: 'Your deck is not legal in modern.', details: ['Test Bear: not legal in modern (CR 100.2a)'] }));
    const alert = await screen.findByRole('alert');
    expect(text(alert)).toMatch('The deck was refused for this game. Your deck is not legal in modern.');
    expect(text(within(alert).getByRole('listitem'))).toMatch('Test Bear: not legal in modern (CR 100.2a)');
  });

  it('checks the address before sending', () => {
    expect(addressProblem('')).toMatch(/Enter the host's address/);
    expect(addressProblem('203.0.113.7')).toBeNull();
    expect(addressProblem('203.0.113.7:47620')).toBeNull();
    expect(addressProblem('[2001:db8::7]:47620')).toBeNull();
    expect(addressProblem('2001:db8::7')).toMatch(/ip:port/);
    expect(addressProblem('host.example:99999')).toMatch(/1 to 65535/);
  });
});

describe('New game links to the online screens', () => {
  it('has Host and Join buttons', async () => {
    let route: Route = { screen: 'newGame' };
    function Shell() {
      const nav = useNav();
      route = nav.route;
      return nav.route.screen === 'newGame' ? (
        <NewGameScreen services={{ listDecks: async () => [green], validateDeck: async () => null, compileDefs: async () => ({ defs: {}, failed: [], compilerVersion: 't' }), newSeed: () => 's' }} settings={testSettings()} />
      ) : (
        <p>{nav.route.screen}</p>
      );
    }
    render(
      <NavProvider initial={{ screen: 'newGame' }}>
        <Shell />
      </NavProvider>,
    );
    const online = await screen.findByRole('navigation', { name: 'Play online' });
    fireEvent.click(within(online).getByRole('button', { name: 'Join an online game' }));
    expect(route.screen).toBe('joinOnline');
  });
});

describe('the game screen online', () => {
  async function inGame(role: 'host' | 'guest') {
    const g = gameViews();
    const me = role === 'host' ? 'p1' : 'p2';
    const f = fakeLink({ initial: [status({ role, phase: 'playing', me, opponent: role === 'host' ? 'Gus' : 'Hana', opponentConnected: true }), g.msg(me)] });
    await f.link.connect();
    render(renderGameAppOnline(new RemoteConnection(f.link), f.link));
    await screen.findByRole('region', { name: 'Online game' }).catch(() => screen.findByLabelText('Online game'));
    return { ...f, g, me };
  }

  function renderGameAppOnline(conn: RemoteConnection, link: OnlineLink) {
    return renderGameApp(conn, { online: link });
  }

  it('the host answers the guest\'s adjustments by hand (in words only), and can end the game for a guest who left (CR 104.3a)', async () => {
    const s = await inGame('host');
    const sock = s.socket();
    reactAct(() => sock.push({ t: 'manualProposal', proposal: { id: 7, sourceName: 'Fork', text: 'Copy target instant or sorcery spell.', lines: ['Move a hidden card to exile.', 'Alice\'s life -3.'] } }));
    const dialog = screen.getByRole('alertdialog', { name: 'Adjustments by hand' });
    expect(text(dialog)).toMatch('Gus resolves Fork by hand and asks you to accept these changes:');
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Move a hidden card to exile.', 'Alice\'s life -3.']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await reactAct(flush);
    expect(sock.last('manual')).toMatchObject({ t: 'manual', proposal: 7, accept: true });
    reactAct(() => {
      sock.reply('manual');
      sock.push({ t: 'manualClosed', proposal: 7 });
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The guest leaves for good: the screen says so and offers the forfeit.
    reactAct(() => {
      sock.push(status({ role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: false }));
      sock.push({ t: 'notice', kind: 'opponentLeft', text: 'The guest left (the guest left the game).' });
    });
    await waitFor(() => expect(screen.getByText(/Gus left the game\. You can end it for them/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'End the game: Gus forfeits' }));
    await reactAct(flush);
    expect(sock.last('forfeit')).toMatchObject({ t: 'forfeit' });
  });

  it("the guest answers the host's adjustments by hand (Accept / Reject with a reason); the outcome is shown", async () => {
    const s = await inGame('guest');
    const sock = s.socket();
    reactAct(() => sock.push({ t: 'manualProposal', proposal: { id: 3, sourceName: 'Fork', text: 'Copy target instant or sorcery spell.', lines: ["Move a hidden card (Hana's hand) to exile.", "Gus's life -2."], player: 'p1', waiting: ['p2'] } }));
    const dialog = screen.getByRole('alertdialog', { name: 'Adjustments by hand' });
    expect(text(dialog)).toMatch('Hana resolves Fork by hand and asks you to accept these changes:');
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(["Move a hidden card (Hana's hand) to exile.", "Gus's life -2."]);
    fireEvent.change(within(dialog).getByLabelText('Reason if you reject (optional)'), { target: { value: 'Fork has nothing to copy' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await reactAct(flush);
    expect(sock.last('manual')).toMatchObject({ t: 'manual', proposal: 3, accept: false, reason: 'Fork has nothing to copy' });
    reactAct(() => {
      sock.reply('manual');
      sock.push({ t: 'manualClosed', proposal: 3, outcome: 'rejected', by: 'p2' });
    });
    await reactAct(flush);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText("Hana's adjustments by hand for Fork were rejected by you.")).toBeTruthy();
    // A second proposal, accepted this time.
    reactAct(() => sock.push({ t: 'manualProposal', proposal: { id: 4, sourceName: 'Fork', text: '', lines: ["Hana's life +1."], player: 'p1', waiting: ['p2'] } }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Adjustments by hand' })).getByRole('button', { name: 'Accept' }));
    await reactAct(flush);
    expect(sock.last('manual')).toMatchObject({ t: 'manual', proposal: 4, accept: true });
    expect(sock.last('manual')).not.toHaveProperty('reason');
  });

  it("the host's own adjustments by hand wait for the guest (no Accept for the host); the outcome is shown", async () => {
    const s = await inGame('host');
    const sock = s.socket();
    reactAct(() => sock.push({ t: 'manualProposal', proposal: { id: 5, sourceName: 'Fork', text: '', lines: ["Gus's life -2."], player: 'p1', waiting: ['p2'] } }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const mine = screen.getByRole('status', { name: 'Your adjustments by hand' });
    expect(text(mine).replace(/\s+/g, ' ')).toMatch('You resolve Fork by hand. Gus must accept these changes; waiting for Gus.');
    expect(within(mine).queryByRole('button')).toBeNull();
    reactAct(() => sock.push({ t: 'manualClosed', proposal: 5, outcome: 'applied' }));
    expect(screen.queryByRole('status', { name: 'Your adjustments by hand' })).toBeNull();
    expect(screen.getByText('Your adjustments by hand for Fork were applied: every other player accepted.')).toBeTruthy();
  });

  it('Leave leaves the online game at the server and closes the socket', async () => {
    const s = await inGame('guest');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    // CL4: online, leaving a running game concedes it (the server concedes before its bye), and the dialog says so.
    expect(text(screen.getByRole('dialog', { name: 'Leave the game' }))).toMatch('Leaving concedes it: you lose, and the other player is told they won (CR 104.3a).');
    fireEvent.click(screen.getByRole('button', { name: 'Leave the game' }));
    await reactAct(flush);
    expect(s.socket().last('leave')).toBeDefined();
    reactAct(() => s.socket().reply('leave'));
    await reactAct(flush);
    expect(s.socket().closedWith).toMatchObject({ code: 1000 });
    expect(text(screen.getByTestId('route'))).toMatch('home');
  });

  it('CL4: the side that stays sees that it won and why when the other player left (and so conceded, CR 104.3a)', async () => {
    const s = await inGame('host');
    const sock = s.socket();
    const guest = s.g.session.state.players.find((p) => p.id === 'p2')!.name;
    const host = s.g.session.state.players.find((p) => p.id === 'p1')!.name;
    expect(s.g.session.apply({ type: 'concede', player: 'p2' }).ok).toBe(true);
    reactAct(() => {
      sock.push({ ...s.g.msg('p1'), seq: 50 });
      sock.push(status({ role: 'host', phase: 'over', me: 'p1', opponent: 'Gus', opponentConnected: false, result: s.g.session.state.result! }));
      sock.push({ t: 'notice', kind: 'opponentLeft', text: 'Gus left the game and conceded (CR 104.3a).' });
    });
    const over = await screen.findByRole('region', { name: 'Game over' });
    expect(text(over)).toMatch(`${host} wins`);
    expect(text(over)).toMatch(`${guest} conceded (CR 104.3a).`);
    expect(screen.getByText('Gus left the game and conceded (CR 104.3a).').className).toBe('online-presence');
    expect(screen.queryByText(/link dropped/)).toBeNull();
    expect(screen.queryByRole('button', { name: /forfeits/ })).toBeNull();
  });

  it('chat goes to the other player and their lines are shown', async () => {
    const s = await inGame('guest');
    reactAct(() => s.socket().push({ t: 'chat', text: 'good luck' }));
    expect(screen.getByText(/Chat with Hana \(new\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Chat with Hana/ })); // M12F: the chat opens over the table
    expect(screen.getByRole('region', { name: 'Chat with Hana' }).closest('.decision-stage')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'you too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await reactAct(flush);
    expect(s.socket().last('chat')).toMatchObject({ t: 'chat', text: 'you too' });
    reactAct(() => s.socket().reply('chat'));
    await reactAct(flush);
    expect(text(screen.getByRole('list', { name: 'Chat' }))).toMatch(/Hana: good luck.*You: you too/);
  });
});
