/**
 * M12-4b (docs/design/m12-multiplayer.md 5.3 item 1, D1, D2): New game for two to four players, and the config it builds. Seats are
 * added and removed, each is a person at this screen or the computer, every seat has its own name and deck; three or four players make a Free-for-All
 * (CR 806, 802, 800.1) seated at random from the seed (CR 806.3), Commander and Brawl start at their multiplayer life (CR 903.7, 903.12f), Duel
 * Commander stays two players only. A two-player config is exactly as before.
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GameSession, type CardDef, type GameConfig } from '@openmtg/engine';
import type { DeckList, ValidateResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../../src/app/nav';
import type { LocalConnection } from '../../src/connection/LocalConnection';
import {
  ConfigBuildError, PLAYER_IDS, buildGameConfig, formatProblem, randomSeat, seatAtRandom, startingLifeFor,
} from '../../src/game/config';
import { NewGameScreen, computerName, multiplayerSummary, variantSummary } from '../../src/game/NewGameScreen';
import { PRACTICE_DECKS } from '../../src/game/practiceDecks';
import type { GameDeck, GameServices } from '../../src/game/services';
import { DEFAULT_SETTINGS, SettingsStore } from '../../src/settings/settings';
import { FIXTURE_DEFS, memoryStorage } from '../game-fixtures';

const DEFS: Record<string, CardDef> = Object.fromEntries(FIXTURE_DEFS.map((d) => [d.name, d]));
const red: GameDeck = { id: 'saved:red', name: 'My red deck', deck: { main: [{ name: 'Mountain', count: 20 }, { name: 'Test Shock', count: 20 }], sideboard: [] } };
const green: GameDeck = { id: 'saved:green', name: 'My green deck', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [] } };
const raiders: GameDeck = { id: 'saved:raiders', name: 'Raiders', deck: { main: [{ name: 'Mountain', count: 20 }, { name: 'Test Raider', count: 20 }], sideboard: [] } };
const commander: GameDeck = { id: 'saved:cmd', name: 'Commander deck', deck: { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Test Bear', count: 1 }] } };
const ALL = [red, green, raiders, commander, ...PRACTICE_DECKS];

function services(over: Partial<GameServices> = {}): GameServices {
  return {
    listDecks: async () => ALL,
    validateDeck: async (_deck: DeckList, format: string): Promise<ValidateResponse> => ({ format, checkedAs: format, valid: true, status: 'legal', problems: [] }),
    compileDefs: vi.fn(async (names: string[]) => ({ defs: Object.fromEntries(names.map((n) => [n, DEFS[n]!])), failed: [], compilerVersion: 'test' })),
    newSeed: () => 'seed-m12',
    ...over,
  };
}

// The route carries only a sealed connection (game/sealed.ts): the tests read the game through the LocalConnections the screen made.
const made = vi.hoisted(() => [] as unknown[]);
vi.mock('../../src/connection/LocalConnection', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/connection/LocalConnection')>();
  class Recorded extends m.LocalConnection {
    constructor(...args: ConstructorParameters<typeof m.LocalConnection>) {
      super(...args);
      made.push(this);
    }
  }
  return { ...m, LocalConnection: Recorded };
});

function Shell({ svc, settings }: { svc: GameServices; settings: SettingsStore }) {
  const { route } = useNav();
  if (route.screen === 'newGame') return <NewGameScreen services={svc} settings={settings} />;
  return <p data-testid="route">{route.screen}</p>;
}

async function open(svc = services(), settings = new SettingsStore(memoryStorage())) {
  render(
    <NavProvider initial={{ screen: 'newGame' }}>
      <Shell svc={svc} settings={settings} />
    </NavProvider>,
  );
  await screen.findByRole('region', { name: 'Player 1' });
  return settings;
}

const player = (n: number) => within(screen.getByRole('region', { name: `Player ${n}` }));
async function pick(n: number, deck: GameDeck) {
  await reactAct(async () => {
    fireEvent.change(player(n).getByRole('combobox', { name: 'Deck' }), { target: { value: deck.id } });
  });
}
const players = async (n: number) => {
  await reactAct(async () => {
    fireEvent.click(screen.getByRole('radio', { name: `${n} players` }));
  });
};
const formatBox = () => screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement;
const lifeBox = () => screen.getByRole('spinbutton', { name: 'Starting life' }) as HTMLInputElement;
const nameBox = (n: number) => player(n).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
const lastLocal = () => made[made.length - 1] as LocalConnection;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('config (m12 design D1, D2, 5.3 item 1)', () => {
  const deck = (d: GameDeck) => ({ name: d.name, deck: d.deck });
  const base = { defs: DEFS, start: { startingLife: 20, firstPlayer: 'random' as const }, stops: { ownTurn: [], opponentTurn: [], fullControl: false } };

  it('two players: exactly as before (no seating shuffle, no options.multiplayer)', () => {
    const c = buildGameConfig({ ...base, players: [deck(red), deck(green)], seed: 's2' });
    expect(c.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(c.options).toEqual({ startingLife: 20, startingPlayer: PLAYER_IDS[randomSeat('s2', 2)] });
  });

  it('CR 806.3, 800.1: three or four players are a Free-for-All seated at random from the seed; each keeps the id of its seat', () => {
    const four = [deck(red), deck(green), deck(raiders), { ...deck(green), name: 'Dan' }];
    const c = buildGameConfig({ ...base, players: four, seed: 'seat-a' });
    expect(c.options?.multiplayer).toEqual({ variant: 'freeForAll', attack: 'multiple' });
    expect([...c.players.map((p) => p.id)].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    // the same seed seats them the same way (the config replays); some seed gives another order
    expect(buildGameConfig({ ...base, players: four, seed: 'seat-a' }).players.map((p) => p.id)).toEqual(c.players.map((p) => p.id));
    const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => buildGameConfig({ ...base, players: four, seed: x }).players.map((p) => p.id).join()));
    expect(orders.size).toBeGreaterThan(1);
    // names follow their ids
    const named = Object.fromEntries(c.players.map((p) => [p.id, p.name]));
    expect(named).toEqual({ p1: 'My red deck', p2: 'My green deck', p3: 'Raiders', p4: 'Dan' });
    // the engine creates it (M12-1: 3-4 players need options.multiplayer)
    const session = new GameSession({ ...c, options: { ...c.options, skipMulligans: true } });
    expect(session.state.players).toHaveLength(4);
  });

  it('seatAtRandom is a permutation and a pure function of the seed', () => {
    expect([...seatAtRandom([1, 2, 3, 4], 'x')].sort()).toEqual([1, 2, 3, 4]);
    expect(seatAtRandom([1, 2, 3], 'y')).toEqual(seatAtRandom([1, 2, 3], 'y'));
  });

  it('the player chosen to play first is the seat chosen, whatever the seating; a seat that is not in the game is refused', () => {
    const three = [deck(red), deck(green), deck(raiders)];
    const c = buildGameConfig({ ...base, players: three, seed: 'z', start: { startingLife: 20, firstPlayer: 2 } });
    expect(c.options?.startingPlayer).toBe('p3');
    expect(() => buildGameConfig({ ...base, players: three, seed: 'z', start: { startingLife: 20, firstPlayer: 3 } })).toThrow(ConfigBuildError);
    expect(() => buildGameConfig({ ...base, players: [deck(red)], seed: 'z' })).toThrow(/2 to 4 players/);
  });

  it('CR 903.7, 903.12f: the starting life of a Commander variant with three or four players; Duel Commander is two players only', () => {
    expect(startingLifeFor('commander', 4)).toBe(40);
    expect(startingLifeFor('brawl', 3)).toBe(30);
    expect(startingLifeFor('standardbrawl', 4)).toBe(30);
    expect(startingLifeFor('brawl', 2)).toBe(25);
    expect(startingLifeFor('brawl')).toBe(25);
    expect(startingLifeFor('modern', 4)).toBe(20);
    expect(formatProblem('duel', 3)).toMatch(/Duel Commander is a two-player format/);
    expect(formatProblem('duel', 2)).toBeNull();
    expect(formatProblem('commander', 4)).toBeNull();
    expect(variantSummary('brawl', 4)).toMatch(/^Brawl: 30 life \(CR 903\.12f\).*the first mulligan is free \(CR 103\.5c, 800\.6\)\.$/);
    expect(variantSummary('commander', 3)).toMatch(/^Commander: 40 life \(CR 903\.7\); 21 combat damage/);
    expect(variantSummary('commander')).toBe(variantSummary('commander', 2));
  });

  it('a computer seat is named "Computer", or "Computer 3" when another seat has that name', () => {
    const seats = [{ name: 'Ann', deckId: '', by: 'person' as const }, { name: 'Computer', deckId: '', by: 'computer' as const }, { name: 'Player 3', deckId: '', by: 'person' as const }];
    expect(computerName(seats, 1)).toBe('Computer');
    expect(computerName(seats, 2)).toBe('Computer 3');
  });
});

describe('New game with three or four players (m12 design 5.3 item 1)', () => {
  it('Players 2 / 3 / 4: seats are added with the names from Settings and removed; two players look as before', async () => {
    const settings = new SettingsStore(memoryStorage());
    settings.update({ playerNames: ['Ann', 'Ben', 'Cat', 'Dan'] });
    await open(services(), settings);
    expect(screen.queryByRole('region', { name: 'Player 3' })).toBeNull();
    expect((screen.getByRole('radio', { name: '2 players' }) as HTMLInputElement).checked).toBe(true);
    await players(4);
    expect(nameBox(3).value).toBe('Cat');
    expect(nameBox(4).value).toBe('Dan');
    expect(player(3).getByRole('radio', { name: 'A person at this screen (hot-seat)' })).toBeTruthy();
    // "Who plays first" lists every seat
    expect(within(screen.getByRole('combobox', { name: 'Who plays first' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Random', 'Ann', 'Ben', 'Cat', 'Dan']);
    expect(screen.getByText(/^Free-for-All with 4 players \(CR 806\)/)).toBeTruthy();
    // Remove player 3: Dan moves up
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove player 3' }));
    });
    expect(nameBox(3).value).toBe('Dan');
    expect(screen.queryByRole('region', { name: 'Player 4' })).toBeNull();
    expect((screen.getByRole('radio', { name: '3 players' }) as HTMLInputElement).checked).toBe(true);
    await players(2);
    expect(screen.queryByRole('region', { name: 'Player 3' })).toBeNull();
    expect(screen.queryByText(/^Free-for-All/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove player/ })).toBeNull();
  });

  it('each seat needs a deck and a name of its own', async () => {
    await open();
    await players(3);
    await pick(1, red);
    await pick(2, green);
    expect(screen.getByText('Choose a deck for each player.')).toBeTruthy();
    await pick(3, raiders);
    fireEvent.change(nameBox(3), { target: { value: ' player 2 ' } });
    expect(screen.getByText('The players need different names.')).toBeTruthy();
    fireEvent.change(nameBox(3), { target: { value: 'Cat' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('CR 903.7, 903.12f: Commander starts at 40 and Brawl at 30 with three or four; Duel Commander is offered only for two', async () => {
    await open();
    await reactAct(async () => {
      fireEvent.change(formatBox(), { target: { value: 'brawl' } });
    });
    expect(lifeBox().value).toBe('25');
    await players(3);
    expect(lifeBox().value).toBe('30');
    expect(screen.getByText(/^Brawl: 30 life \(CR 903\.12f\)/)).toBeTruthy();
    const duel = within(formatBox()).getAllByRole('option').find((o) => (o as HTMLOptionElement).value === 'duel') as HTMLOptionElement;
    expect(duel.disabled).toBe(true);
    expect(duel.textContent).toBe('Duel Commander (two players only)');
    await players(2);
    await reactAct(async () => {
      fireEvent.change(formatBox(), { target: { value: 'duel' } });
    });
    await players(4);
    expect(screen.getByText(/Duel Commander is a two-player format/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts a four-player hot-seat game: four seats at one screen, a Free-for-All seated from the seed; the names are kept for next time', async () => {
    const settings = await open();
    await players(4);
    for (const [n, d] of [[1, red], [2, green], [3, raiders], [4, green]] as const) await pick(n, d);
    fireEvent.change(nameBox(1), { target: { value: 'Ann' } });
    fireEvent.change(nameBox(4), { target: { value: 'Dan' } });
    const go = screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    await reactAct(async () => {
      fireEvent.click(go);
    });
    expect(screen.getByTestId('route').textContent).toBe('game');
    const conn = lastLocal();
    const config: GameConfig = conn.session.config;
    expect(config.options?.multiplayer).toEqual({ variant: 'freeForAll', attack: 'multiple' });
    expect(config.players.map((p) => p.id)).toEqual(seatAtRandom(['p1', 'p2', 'p3', 'p4'], 'seed-m12')); // CR 806.3: seated from the seed
    expect(conn.seated()).toHaveLength(4); // hot-seat: every player at this screen
    expect(conn.session.state.players.map((p) => p.life)).toEqual([20, 20, 20, 20]);
    expect(settings.get().playerNames).toEqual(['Ann', 'Player 2', 'Player 3', 'Dan']);
  });

  it('one person against three computers: a ComputerGame with the person seated alone; the computers\' names are not kept', async () => {
    const settings = await open();
    await players(4);
    for (const [n, d] of [[1, red], [2, green], [3, raiders], [4, green]] as const) await pick(n, d);
    for (const n of [2, 3, 4]) fireEvent.click(player(n).getByRole('radio', { name: 'The computer' }));
    expect([2, 3, 4].map((n) => nameBox(n).value)).toEqual(['Computer', 'Computer 3', 'Computer 4']);
    const go = screen.getByRole('button', { name: 'Play vs 3 computers' }) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    await reactAct(async () => {
      fireEvent.click(go);
    });
    expect(screen.getByTestId('route').textContent).toBe('game');
    const conn = lastLocal();
    expect(conn.seated()).toEqual(['p1']);
    expect(conn.view().viewer).toBe('p1');
    // the computers play with the AI stops (computer.ts withComputerStops)
    expect(conn.session.config.players.filter((p) => p.id !== 'p1').every((p) => p.stops && !p.stops.fullControl)).toBe(true);
    expect(settings.get().playerNames).toEqual(DEFAULT_SETTINGS.playerNames);
    // back to a person: the person's name again
  });

  it('a mix: two people and a computer start a hot-seat game between the two people; the computer plays its own seat', async () => {
    await open();
    await players(3);
    for (const [n, d] of [[1, red], [2, green], [3, raiders]] as const) await pick(n, d);
    fireEvent.click(player(3).getByRole('radio', { name: 'The computer' }));
    expect(nameBox(3).value).toBe('Computer');
    fireEvent.click(player(3).getByRole('radio', { name: 'A person at this screen (hot-seat)' }));
    expect(nameBox(3).value).toBe('Player 3');
    fireEvent.click(player(3).getByRole('radio', { name: 'The computer' }));
    const go = screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    await reactAct(async () => {
      fireEvent.click(go);
    });
    expect(lastLocal().seated().slice().sort()).toEqual(['p1', 'p2']);
  });

  it('lists the multiplayer rules under the options', () => {
    expect(multiplayerSummary(3)).toMatch(/Free-for-All with 3 players \(CR 806\).*\(CR 802\).*at random \(CR 806\.3\).*free \(CR 800\.6\).*first draw \(CR 800\.7\)/);
  });
});
