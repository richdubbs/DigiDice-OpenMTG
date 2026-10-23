/**
 * C6 integration (STATUS.md wave M8-W1 known gaps): saved decks on New game (C3's store), stub cards on New game (C1's `stubs`), "The computer" as
 * player 2, the game screen's default slots (C4 board with C2 pictures, C5 prompt bar), the board drawing the prompt's marks, and the settings' copy of the
 * engine's turn order (kept out of the first chunk).
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import { AI_STOPS } from '@openmtg/ai';
import { DEFAULT_STOPS, STEP_ORDER, type CardDef } from '@openmtg/engine';
import type { DefsResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav, type Route } from '../src/app/nav';
import { GameBoard } from '../src/board';
import type { GameConnection } from '../src/connection/GameConnection';
import { LocalConnection } from '../src/connection/LocalConnection';
import { emptyDeck } from '../src/decks/model';
import { MemoryDeckStore } from '../src/decks/store';
import { renderBoardCard } from '../src/game/boardCards';
import { ComputerGame } from '../src/game/computer';
import { NewGameScreen } from '../src/game/NewGameScreen';
import { PRACTICE_DECKS } from '../src/game/practiceDecks';
import { defaultServices, savedDecks, type GameDeck, type GameServices } from '../src/game/services';
import { BoardSlot, DEFAULT_SLOTS, PromptSlot } from '../src/game/slots';
import { ENGINE_DEFAULT_STOPS, ENGINE_STEP_ORDER, SettingsStore } from '../src/settings/settings';
import { FIXTURE_DEFS, hotSeatConfig, memoryStorage } from './game-fixtures';
import { stubFetch } from './helpers';

const made = vi.hoisted(() => [] as unknown[]);
vi.mock('../src/connection/LocalConnection', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/connection/LocalConnection')>();
  class Recorded extends m.LocalConnection {
    constructor(...args: ConstructorParameters<typeof m.LocalConnection>) {
      super(...args);
      made.push(this);
    }
  }
  return { ...m, LocalConnection: Recorded };
});

const DEFS: Record<string, CardDef> = Object.fromEntries(FIXTURE_DEFS.map((d) => [d.name, d]));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saved decks on New game (gap 1: C3 deck store)', () => {
  it("lists the deck library's decks, newest first, as game decks with their format", async () => {
    const a = { ...emptyDeck('Older', 'modern', '2026-01-01T00:00:00.000Z', 'a'), main: [{ name: 'Mountain', count: 20 }] };
    const b = { ...emptyDeck('Newer', 'casual', '2026-10-01T00:00:00.000Z', 'b'), main: [{ name: 'Forest', count: 20 }], commander: [] };
    const decks = await savedDecks(new MemoryDeckStore([a, b]));
    expect(decks.map((d) => [d.id, d.name, d.format])).toEqual([
      ['b', 'Newer', 'casual'],
      ['a', 'Older', 'modern'],
    ]);
    expect(decks[1]!.deck).toEqual({ main: [{ name: 'Mountain', count: 20 }], sideboard: [] });
  });

  it('compileDefs sends the confirmed stub names (DefsRequest.stubs) and nothing extra otherwise', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { defs: {}, failed: [], compilerVersion: 't' } }));
    await defaultServices.compileDefs(['Forest']);
    await defaultServices.compileDefs(['Forest', 'Homebrew Card'], { stubs: ['Homebrew Card'] });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]!.body)));
    expect(bodies).toEqual([{ names: ['Forest'] }, { names: ['Forest', 'Homebrew Card'], stubs: ['Homebrew Card'] }]);
  });
});

const red: GameDeck = { id: 'saved:red', name: 'Red', deck: { main: [{ name: 'Mountain', count: 20 }, { name: 'Test Shock', count: 20 }], sideboard: [] } };
const green: GameDeck = { id: 'saved:green', name: 'Green', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 19 }, { name: 'Homebrew Bear', count: 1 }], sideboard: [] } };

function services(compile: GameServices['compileDefs']): GameServices {
  return {
    listDecks: async () => [red, green, ...PRACTICE_DECKS],
    validateDeck: async () => null,
    compileDefs: compile,
    newSeed: () => 'seed-c6',
  };
}

let route: Route | null = null;
function Shell({ svc }: { svc: GameServices }) {
  const nav = useNav();
  route = nav.route;
  if (nav.route.screen === 'newGame') return <NewGameScreen services={svc} settings={new SettingsStore(memoryStorage())} />;
  return <p>{nav.route.screen}</p>;
}

async function openNewGame(svc: GameServices) {
  route = null;
  render(
    <NavProvider initial={{ screen: 'newGame' }}>
      <Shell svc={svc} />
    </NavProvider>,
  );
  await screen.findByRole('region', { name: 'Player 1' });
  const player = (n: 1 | 2) => within(screen.getByRole('region', { name: `Player ${n}` }));
  await reactAct(async () => {
    fireEvent.change(player(1).getByRole('combobox', { name: 'Deck' }), { target: { value: red.id } });
    fireEvent.change(player(2).getByRole('combobox', { name: 'Deck' }), { target: { value: green.id } });
  });
  return player;
}

const known = (names: string[], stubs: string[] = []): DefsResponse => ({
  defs: Object.fromEntries([...names.filter((n) => DEFS[n]), ...stubs].map((n) => [n, DEFS[n] ?? { ...DEFS['Test Bear']!, id: n, name: n }])),
  // The reason is deliberately not the server's wording: the client must go by `code` only.
  failed: names.filter((n) => !DEFS[n] && !stubs.includes(n)).map((n) => ({ name: n, code: 'unknown' as const, reason: `The card data has no "${n}"` })),
  compilerVersion: 't',
});

describe('New game: stub cards (never dropped or guessed)', () => {
  it('names the unknown card (by the server code "unknown", whatever the wording) and starts with it as a stub only after the player clicks', async () => {
    const compile = vi.fn(async (names: string[], opts?: { stubs?: string[] }) => known(names, opts?.stubs ?? []));
    await openNewGame(services(compile));
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('Homebrew Bear');
    expect(route!.screen).toBe('newGame');
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play with stub cards' }));
    });
    expect(compile).toHaveBeenLastCalledWith(expect.arrayContaining(['Homebrew Bear']), expect.objectContaining({ stubs: ['Homebrew Bear'] }));
    expect(route!.screen).toBe('game');
  });

  it('offers no stubs when a known card failed to compile (a stub would hide it)', async () => {
    const compile = vi.fn(async (names: string[]) => ({ ...known(names, ['Homebrew Bear']), failed: [{ name: 'Test Shock', code: 'rejected' as const, reason: 'The compiler rejected Test Shock: boom' }] }));
    await openNewGame(services(compile));
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('The compiler rejected Test Shock');
    expect(screen.queryByRole('button', { name: 'Play with stub cards' })).toBeNull();
  });
});

describe('New game: player 2 played by the computer', () => {
  it('names player 2 "Computer", starts a ComputerGame for player 1, and its rematch is a fresh game against the computer', async () => {
    const compile = vi.fn(async (names: string[]) => known(names, ['Homebrew Bear']));
    const player = await openNewGame(services(compile));
    fireEvent.click(player(2).getByRole('radio', { name: 'The computer' }));
    expect((player(2).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Computer');
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play vs computer' }));
    });
    expect(route!.screen).toBe('game');
    // FXH (audit m5, CR 400.2): the route holds the sealed form of the ComputerGame (game/sealed.ts); the game is read through the LocalConnection it made.
    const game = (route as Extract<Route, { screen: 'game' }>).connection;
    expect(game).not.toBeInstanceOf(ComputerGame);
    expect(Object.values(game).every((v) => typeof v === 'function' || v === 'local')).toBe(true);
    expect(game.seated!()).toEqual(['p1']); // the human sits here; the computer plays p2 through its own seat
    const local = made[made.length - 1] as LocalConnection;
    expect(local.session.state.players.map((p) => p.name)).toEqual(['Player 1', 'Computer']);
    expect(local.session.state.players[1]!.stops).toEqual(AI_STOPS);
    expect(game.view().players.map((p) => p.name)).toEqual(['Player 1', 'Computer']);
    const again = (route as Extract<Route, { screen: 'game' }>).rematch!();
    expect(again).not.toBe(game);
    expect(made[made.length - 1]).not.toBe(local);
    expect(again.seated!()).toEqual(['p1']);
  });
});

describe('New game against the computer: its manual text (CR 113.1) is skipped, without a warning', () => {
  it("starts at once when the computer's deck has manual or partial cards: one compile, no confirmation, a status while the cards load", async () => {
    const partial = (names: string[]): DefsResponse => {
      const r = known(names, ['Homebrew Bear']);
      const bear = r.defs['Test Bear']!;
      return { ...r, defs: { ...r.defs, 'Test Bear': { ...bear, automation: { ...bear.automation, level: 'partial' } } } };
    };
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => (release = resolve));
    const compile = vi.fn(async (names: string[]) => {
      await loaded;
      return partial(names);
    });
    const player = await openNewGame(services(compile));
    fireEvent.click(player(2).getByRole('radio', { name: 'The computer' }));
    expect(screen.queryByText(/The computer skips/)).toBeNull();
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play vs computer' }));
    });
    expect(screen.getByText('Loading the cards…').getAttribute('role')).toBe('status');
    await reactAct(async () => {
      release();
      await loaded;
    });
    expect(route!.screen).toBe('game');
    expect(compile).toHaveBeenCalledTimes(1);
  });
});

describe('game screen wiring (gap 1, 2)', () => {
  it("the default slots are C4's board (with C2's card pictures) and C5's prompt bar", () => {
    expect(DEFAULT_SLOTS).toEqual({ Board: BoardSlot, Prompt: PromptSlot });
  });

  it('the board draws the prompt marks next to objects and players, outside the card image (pending attackers, CR 508.1)', () => {
    const conn = new LocalConnection({ ...hotSeatConfig('c6-marks'), options: { startingLife: 20, skipMulligans: true, startingPlayer: 'p1' } }, { seats: ['p1'] });
    const v = conn.view();
    const card = v.zones.hand.p1![0]!;
    const { container } = render(<GameBoard view={v} renderCard={renderBoardCard} interaction={{ selectable: [card, 'p2'], marks: { [card]: 'Attacking Bob', p2: '1' } }} />);
    const slot = container.querySelector(`.board-card[data-object-id="${card}"]`)!;
    expect(slot.querySelector('.marker-pending')!.textContent).toBe('Attacking Bob');
    expect(slot.querySelector('.board-card-image')!.textContent).not.toContain('Attacking Bob');
    expect(container.querySelector('[data-player-id="p2"].player-panel .marker-pending')!.textContent).toBe('1');
  });

  it('a seat connection is a full GameConnection (the shape the computer uses)', () => {
    const conn = new LocalConnection(hotSeatConfig('c6-shape'), { seats: ['p1'] });
    const seat: GameConnection = conn.seat('p2');
    expect(seat.view().viewer).toBe('p2');
    expect(seat.handoff()).toBeNull();
  });
});

describe('settings without the engine in the first chunk', () => {
  it("the settings' turn order and default stops equal the engine's (CR 500.1)", () => {
    expect(ENGINE_STEP_ORDER).toEqual(STEP_ORDER);
    expect(ENGINE_DEFAULT_STOPS).toEqual(DEFAULT_STOPS);
  });
});
