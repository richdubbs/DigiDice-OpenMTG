/** New game (docs/design/m8-client.md screen 5): decks, names, format checks, options, starting a hot-seat game; config building (config.ts). */
import { cleanup, act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CardDef } from '@openmtg/engine';
import type { DeckList, DefsResponse, ValidateResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../src/app/nav';
import type { GameConnection } from '../src/connection/GameConnection';
import { LocalConnection } from '../src/connection/LocalConnection';
import { ConfigBuildError, PLAYER_IDS, buildGameConfig, randomSeat, deckCardNames, deckNotes, mainCardNames, unplayableReason } from '../src/game/config';
import { NewGameScreen } from '../src/game/NewGameScreen';
import { PRACTICE_DECKS } from '../src/game/practiceDecks';
import { defaultServices, type GameDeck, type GameServices } from '../src/game/services';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/settings/settings';
import { FIXTURE_DEFS, memoryStorage } from './game-fixtures';
import { stubFetch } from './helpers';

const DEFS: Record<string, CardDef> = Object.fromEntries(FIXTURE_DEFS.map((d) => [d.name, d]));

const red: GameDeck = {
  id: 'saved:red',
  name: 'My red deck',
  format: 'modern',
  deck: { main: [{ name: 'Mountain', count: 20 }, { name: 'Test Shock', count: 20 }], sideboard: [{ name: 'Test Raider', count: 3 }] },
};
const green: GameDeck = { id: 'saved:green', name: 'My green deck', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [] } };
const commander: GameDeck = { id: 'saved:cmd', name: 'Commander deck', deck: { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Test Bear', count: 1 }] } };

function services(over: Partial<GameServices> = {}): GameServices {
  return {
    listDecks: async () => [red, green, commander, ...PRACTICE_DECKS],
    validateDeck: async (_deck: DeckList, format: string): Promise<ValidateResponse> => ({ format, checkedAs: format, valid: true, status: 'legal', problems: [] }),
    compileDefs: vi.fn(async (names: string[]) => ({ defs: Object.fromEntries(names.map((n) => [n, DEFS[n]!])), failed: [], compilerVersion: 'test' })),
    newSeed: () => 'seed-1',
    ...over,
  };
}

// FXH (audit m5): the route carries only a sealed connection (game/sealed.ts), so the tests read the game through the LocalConnections the screen made.
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

let shown: LocalConnection | null = null;
let shownRoute: GameConnection | null = null;
let shownRematch: (() => unknown) | undefined;
function Shell({ svc, settings }: { svc: GameServices; settings: SettingsStore }) {
  const { route } = useNav();
  if (route.screen === 'newGame') return <NewGameScreen services={svc} settings={settings} />;
  if (route.screen === 'game') {
    shownRoute = route.connection;
    shown = made[made.length - 1] as LocalConnection;
    shownRematch = route.rematch;
  }
  return <p data-testid="route">{route.screen}</p>;
}

async function open(svc = services(), settings = new SettingsStore(memoryStorage())) {
  shown = null;
  shownRoute = null;
  render(
    <NavProvider initial={{ screen: 'newGame' }}>
      <Shell svc={svc} settings={settings} />
    </NavProvider>,
  );
  await screen.findByRole('region', { name: 'Player 1' });
}

const player = (n: 1 | 2) => within(screen.getByRole('region', { name: `Player ${n}` }));
async function pick(n: 1 | 2, deckName: string) {
  await reactAct(async () => {
    fireEvent.change(player(n).getByRole('combobox', { name: 'Deck' }), { target: { value: [red, green, commander, ...PRACTICE_DECKS].find((d) => d.name === deckName)!.id } });
  });
}
const startButton = () => screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('New game screen', () => {
  it('lists saved and practice decks, starts with the names from Settings, and preselects the first deck format', async () => {
    const settings = new SettingsStore(memoryStorage());
    settings.update({ playerNames: ['Ann', 'Ben', 'Player 3', 'Player 4'] });
    await open(services(), settings);
    expect((player(1).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ann');
    expect((player(2).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ben');
    const options = within(player(1).getByRole('combobox', { name: 'Deck' })).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a deck…', 'My red deck', 'My green deck', 'Commander deck', 'Practice: Red burn', 'Practice: Green stompy', 'Commander: Lumra lands', 'Commander: Baron aristocrats', 'Commander: Mabel mice', 'Commander: Vivi spellslinger']);
    expect(startButton().disabled).toBe(true);
    await pick(1, 'My red deck');
    expect((screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement).value).toBe('modern');
    expect(player(1).getByText(/The sideboard \(3 cards\) stays outside the game \(CR 100\.4\)/)).toBeTruthy();
  });

  describe('CL3: New game remembers the player names (STATUS, wave M8-C6 verification gap 4)', () => {
    const name = (n: 1 | 2) => player(n).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    async function startWith(settings: SettingsStore, names: [string, string], vsComputer = false) {
      await open(services(), settings);
      await pick(1, 'My red deck');
      await pick(2, 'My green deck');
      fireEvent.change(name(1), { target: { value: names[0] } });
      if (vsComputer) fireEvent.click(player(2).getByRole('radio', { name: 'The computer' }));
      else fireEvent.change(name(2), { target: { value: names[1] } });
      const go = () => screen.getByRole('button', { name: vsComputer ? 'Play vs computer' : 'Start game' }) as HTMLButtonElement;
      await waitFor(() => expect(go().disabled).toBe(false));
      await reactAct(async () => {
        fireEvent.click(go());
      });
      expect(screen.getByTestId('route').textContent).toBe('game');
    }

    it('a started hot-seat game keeps its (trimmed) names: the next New game, and a new page reading the same storage, start with them', async () => {
      const storage = memoryStorage();
      const settings = new SettingsStore(storage);
      await startWith(settings, ['  Ann ', 'Ben']);
      expect(settings.get().playerNames).toEqual(['Ann', 'Ben', 'Player 3', 'Player 4']); // M12-4b: four names
      cleanup();
      await open(services(), settings);
      expect(name(1).value).toBe('Ann');
      expect(name(2).value).toBe('Ben');
      cleanup();
      await open(services(), new SettingsStore(storage));
      expect(name(1).value).toBe('Ann');
      expect(name(2).value).toBe('Ben');
    });

    it('names typed but never started are not kept', async () => {
      const settings = new SettingsStore(memoryStorage());
      await open(services(), settings);
      fireEvent.change(name(1), { target: { value: 'Ann' } });
      cleanup();
      expect(settings.get().playerNames).toEqual(DEFAULT_SETTINGS.playerNames);
    });

    it("against the computer only player 1's name is kept; player 2's stays a person's name for the next hot-seat game", async () => {
      const settings = new SettingsStore(memoryStorage());
      settings.update({ playerNames: ['Ann', 'Ben', 'Player 3', 'Player 4'] });
      await startWith(settings, ['Cat', ''], true);
      expect(settings.get().playerNames).toEqual(['Cat', 'Ben', 'Player 3', 'Player 4']);
      cleanup();
      await open(services(), settings);
      expect(name(1).value).toBe('Cat');
      expect(name(2).value).toBe('Ben');
    });

    it('storage that cannot be written (private window, blocked) still starts the game; the names last until the page is closed', async () => {
      const settings = new SettingsStore(memoryStorage({}, true));
      await startWith(settings, ['Ann', 'Ben']);
      expect(settings.persisted).toBe(false);
      expect(settings.get().playerNames).toEqual(['Ann', 'Ben', 'Player 3', 'Player 4']); // M12-4b: four names
    });
  });

  it('starts a hot-seat game: compiles the cards, embeds them, applies the stops from Settings and the options', async () => {
    const svc = services();
    const settings = new SettingsStore(memoryStorage());
    settings.update({ fullControl: true });
    await open(svc, settings);
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Starting life' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Who plays first' }), { target: { value: '1' } });
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByTestId('route').textContent).toBe('game');
    expect(svc.compileDefs).toHaveBeenCalledWith(['Forest', 'Mountain', 'Test Bear', 'Test Raider', 'Test Shock'], { signal: expect.any(AbortSignal) }); // FAST5 MX7: the sideboard too
    const config = shown!.session.config;
    expect(config.seed).toBe('seed-1');
    expect(config.players.map((p) => [p.name, p.deck.length])).toEqual([
      ['Player 1', 40],
      ['Player 2', 40],
    ]);
    expect(config.players[0]!.stops).toEqual({ ...DEFAULT_SETTINGS.stops, fullControl: true });
    expect(config.options).toEqual({ startingLife: 30, startingPlayer: 'p2' });
    expect(shown!.session.state.players.map((p) => p.life)).toEqual([30, 30]); // CR 103.4
    expect(shown!.handoff()).not.toBeNull();
    // FXH (audit m5, CR 400.2): the route holds the sealed connection, which reaches no session.
    expect(shownRoute).not.toBe(shown);
    expect(shownRoute).not.toBeInstanceOf(LocalConnection);
    expect(Object.values(shownRoute!).every((v) => typeof v === 'function' || v === 'local')).toBe(true);
    expect(shownRoute!.handoff()).toBe(shown!.handoff());
    // The route carries the rematch: the same config with a new seed.
    shownRematch!();
    const again = made[made.length - 1] as LocalConnection;
    expect(again).not.toBe(shown);
    expect({ ...again.session.config, seed: 'x' }).toEqual({ ...config, seed: 'x' });
  });

  it('shows deck problems with their rules and needs "Play anyway" before starting', async () => {
    const validateDeck = vi.fn(async (deck: DeckList, format: string): Promise<ValidateResponse> =>
      deck.main.some((e) => e.name === 'Test Shock')
        ? { format, checkedAs: format, valid: false, status: 'illegal', problems: [{ kind: 'copies', severity: 'error', message: 'Test Shock: 20 copies (at most 4).', card: 'Test Shock', rules: ['CR 100.2a'] }] }
        : { format, checkedAs: format, valid: true, status: 'legal', problems: [] },
    );
    await open(services({ validateDeck }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    expect(await player(1).findByText('Test Shock: 20 copies (at most 4). (CR 100.2a)')).toBeTruthy();
    expect(player(2).getByText('Legal in this format.')).toBeTruthy();
    expect(startButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Play anyway/ }));
    expect(startButton().disabled).toBe(false);
    // Another format re-checks both decks and asks again.
    await reactAct(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), { target: { value: 'pauper' } });
    });
    expect(validateDeck).toHaveBeenLastCalledWith(green.deck, 'pauper');
    expect((screen.getByRole('checkbox', { name: /Play anyway/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('CR 100.6: a deck the server could not fully check ("unchecked", valid with warnings) is never shown as legal and needs "Play anyway"', async () => {
    const validateDeck = vi.fn(async (deck: DeckList, format: string): Promise<ValidateResponse> =>
      deck.main.some((e) => e.name === 'Test Shock')
        ? {
            format, checkedAs: format, valid: true, status: 'unchecked',
            problems: [
              { kind: 'unknown', severity: 'warning', message: 'Test Shock has no legality data for this format.', card: 'Test Shock', rules: ['CR 100.6'] },
              { kind: 'sideboard', severity: 'note', message: 'A note only.', rules: [] },
            ],
          }
        : { format, checkedAs: format, valid: true, status: 'legal', problems: [] },
    );
    await open(services({ validateDeck }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    expect(await player(1).findByText('Test Shock has no legality data for this format. (CR 100.6)')).toBeTruthy();
    expect(player(1).queryByText('Legal in this format.')).toBeNull();
    expect(player(1).queryByText(/A note only/)).toBeNull();
    expect(startButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Play anyway/ }));
    expect(startButton().disabled).toBe(false);
  });

  it('says when the decks could not be checked, and still lets the players start', async () => {
    await open(services({ validateDeck: async () => null }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    expect(player(1).getByText(/Deck checks are not available yet/)).toBeTruthy();
    expect(startButton().disabled).toBe(false);
  });

  it('needs two different names, and plays a deck with a commander only in a Commander format (M11-2)', async () => {
    await open();
    await pick(1, 'Commander deck');
    expect(player(1).getByText(/This deck has a commander: choose a Commander format to play it/)).toBeTruthy();
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    fireEvent.change(player(2).getByRole('textbox', { name: 'Name' }), { target: { value: ' player 1 ' } });
    expect(screen.getByText('The players need different names.')).toBeTruthy();
    expect(startButton().disabled).toBe(true);
    fireEvent.change(player(2).getByRole('textbox', { name: 'Name' }), { target: { value: '' } });
    expect(screen.getByText('Each player needs a name.')).toBeTruthy();
  });

  it('names the cards that could not be compiled and stays on the screen', async () => {
    const compileDefs = async () => ({ defs: {}, failed: [{ name: 'Test Shock', code: 'rejected' as const, reason: 'unknown card' }], compilerVersion: 'test' });
    await open(services({ compileDefs }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByRole('alert').textContent).toBe('These cards could not be loaded: Test Shock (unknown card).');
    expect(screen.queryByTestId('route')).toBeNull();
  });

  it('FAST5 MX7: a sideboard card that could not be compiled does not stop the game (it stays out of the game)', async () => {
    const compileDefs = async (names: string[]) => ({
      defs: Object.fromEntries(names.filter((n) => n !== 'Test Raider').map((n) => [n, DEFS[n]!])),
      failed: [{ name: 'Test Raider', code: 'rejected' as const, reason: 'unknown card' }],
      compilerVersion: 'test',
    });
    await open(services({ compileDefs }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('route').textContent).toBe('game');
  });

  it('offers Historic and Timeless, and preselects a deck format by the ids of the deck library (C3) and the format rules (F1)', async () => {
    const deckIn = (format: string): GameDeck => ({ ...green, id: `saved:${format}`, name: `Deck for ${format}`, format });
    const library = [deckIn('historic'), deckIn('timeless'), deckIn('casual'), deckIn('freeform'), ...PRACTICE_DECKS];
    await open(services({ listDecks: async () => library }));
    const formatBox = () => screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement;
    expect(within(formatBox()).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual([
      'casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'duel', 'brawl', 'standardbrawl', 'historic', 'timeless',
    ]);
    for (const [deck, expected] of [
      ['historic', 'historic'],
      ['timeless', 'timeless'],
      ['casual', 'casual'],
      ['freeform', 'casual'],
    ] as const) {
      await reactAct(async () => {
        fireEvent.change(player(1).getByRole('combobox', { name: 'Deck' }), { target: { value: `saved:${deck}` } });
      });
      expect(formatBox().value).toBe(expected);
    }
  });

  it('leaving while the cards are being fetched cancels the start: the player is not pulled into a game', async () => {
    let finish: (() => void) | null = null;
    let signal: AbortSignal | undefined;
    const compileDefs = vi.fn(
      (names: string[], opts?: { signal?: AbortSignal }) =>
        new Promise<DefsResponse>((resolve) => {
          signal = opts?.signal;
          finish = () => resolve({ defs: Object.fromEntries(names.map((n) => [n, DEFS[n]!])), failed: [], compilerVersion: 'test' });
        }),
    );
    await open(services({ compileDefs }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(compileDefs).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('route').textContent).toBe('home');
    expect(signal?.aborted).toBe(true);
    await reactAct(async () => {
      finish!();
    });
    expect(screen.getByTestId('route').textContent).toBe('home');
    expect(shown).toBeNull();
  });

  it('says why Start game cannot be clicked yet', async () => {
    const waiting: (() => void)[] = [];
    const validateDeck = vi.fn(async (deck: DeckList, format: string): Promise<ValidateResponse> => {
      if (format === 'pauper') await new Promise<void>((r) => waiting.push(r));
      return deck.main.some((e) => e.name === 'Test Shock')
        ? { format, checkedAs: format, valid: false, status: 'illegal', problems: [{ kind: 'copies', severity: 'error', message: 'Test Shock: 20 copies (at most 4).', card: 'Test Shock', rules: ['CR 100.2a'] }] }
        : { format, checkedAs: format, valid: true, status: 'legal', problems: [] };
    });
    await open(services({ validateDeck }));
    const reason = () => {
      const id = startButton().getAttribute('aria-describedby');
      return id ? (document.getElementById(id)?.textContent ?? null) : null;
    };
    expect(startButton().disabled).toBe(true);
    expect(reason()).toBe('Choose a deck for each player.');
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    expect(reason()).toBe('Tick Play anyway to start with these deck problems.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Play anyway/ }));
    expect(startButton().disabled).toBe(false);
    expect(reason()).toBeNull();
    await reactAct(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), { target: { value: 'pauper' } });
    });
    expect(startButton().disabled).toBe(true);
    expect(reason()).toBe('Checking the decks…');
    await reactAct(async () => {
      waiting.forEach((r) => r());
    });
  });

  it('a start error goes away when the choices change, so it never describes other choices', async () => {
    const compileDefs = async () => ({ defs: {}, failed: [{ name: 'Test Shock', code: 'rejected' as const, reason: 'unknown card' }], compilerVersion: 'test' });
    await open(services({ compileDefs }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    const changes: (() => void)[] = [
      () => fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), { target: { value: 'standard' } }),
      () => fireEvent.change(player(1).getByRole('textbox', { name: 'Name' }), { target: { value: 'Ann' } }),
      () => fireEvent.change(screen.getByRole('spinbutton', { name: 'Starting life' }), { target: { value: '25' } }),
      () => fireEvent.change(screen.getByRole('combobox', { name: 'Who plays first' }), { target: { value: '0' } }),
      () => fireEvent.change(player(2).getByRole('combobox', { name: 'Deck' }), { target: { value: 'practice:green' } }),
    ];
    for (const change of changes) {
      await reactAct(async () => {
        fireEvent.click(startButton());
      });
      expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/);
      await reactAct(async () => {
        change();
      });
      expect(screen.queryByRole('alert')).toBeNull();
    }
  });

  it('reports a server that does not answer', async () => {
    await open(services({ compileDefs: async () => Promise.reject(new Error('HTTP 500')) }));
    await pick(1, 'My red deck');
    await pick(2, 'My green deck');
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByRole('alert').textContent).toBe('The game could not be started: HTTP 500');
  });
});

describe('default services', () => {
  it('offer the practice decks and the Commander precons, and treat a 501 deck checker as "not available"', async () => {
    const ids = (await defaultServices.listDecks()).map((d) => d.id);
    expect(ids.slice(0, 6)).toEqual(['practice:red', 'practice:green', 'commander:lumra', 'commander:baron', 'commander:mabel', 'commander:vivi']);
    expect(ids.slice(6)).toHaveLength(197);
    expect(ids.slice(6).every((id) => id.startsWith('precon:'))).toBe(true);
    stubFetch(() => ({ status: 501, body: { error: 'Not implemented', todo: [] } }));
    expect(await defaultServices.validateDeck(red.deck, 'modern')).toBeNull();
    // The real server (C1) answers 503 with a code when it has no card data yet.
    stubFetch(() => ({ status: 503, body: { error: 'No card data', code: 'noCardData' } }));
    expect(await defaultServices.validateDeck(red.deck, 'modern')).toBeNull();
    stubFetch(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(defaultServices.validateDeck(red.deck, 'modern')).rejects.toThrow('boom');
    expect(defaultServices.newSeed()).toMatch(/^[0-9a-f]{32}$/);
    expect(defaultServices.newSeed()).not.toBe(defaultServices.newSeed());
  });

  it('the practice decks are 60 cards each with no sideboard', () => {
    for (const d of PRACTICE_DECKS.filter((d) => d.format === 'casual')) {
      expect(d.deck.main.reduce((n, e) => n + e.count, 0)).toBe(60);
      expect(unplayableReason(d.deck)).toBeNull();
    }
  });

  it('the built-in Commander decks are 100 cards: one commander and 99 singleton cards (basics excepted)', () => {
    const commanderDecks = PRACTICE_DECKS.filter((d) => d.format === 'commander');
    expect(commanderDecks).toHaveLength(4);
    for (const d of commanderDecks) {
      expect(d.deck.commander).toHaveLength(1);
      expect(d.deck.main.reduce((n, e) => n + e.count, 0)).toBe(99);
      expect(d.deck.main.filter((e) => e.count > 1).every((e) => ['Forest', 'Plains', 'Swamp', 'Island', 'Mountain'].includes(e.name))).toBe(true);
      expect(unplayableReason(d.deck, 'commander')).toBeNull();
    }
  });
});

describe('buildGameConfig', () => {
  const stops = { ownTurn: ['main1' as const], opponentTurn: [], fullControl: false };
  const players = [
    { name: ' Ann ', deck: red.deck },
    { name: 'Ben', deck: green.deck },
  ] as const;

  it('turns each main deck into definition ids, embeds only the used definitions, and picks a random first player from the seed (nobody is asked)', () => {
    const config = buildGameConfig({ players, defs: DEFS, seed: 's', start: { startingLife: 20, firstPlayer: 'random' }, stops });
    expect(config.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(config.players[0]!.name).toBe('Ann');
    expect(config.players[0]!.deck.filter((id) => id === DEFS['Mountain']!.id)).toHaveLength(20);
    expect((config.defs as CardDef[]).map((d) => d.name).sort()).toEqual(['Forest', 'Mountain', 'Test Bear', 'Test Raider', 'Test Shock']);
    // FAST5 MX7 (CR 400.11a, 701.48a): the sideboard is passed as data, outside the game
    expect(config.players[0]!.sideboard).toEqual([DEFS['Test Raider']!.id, DEFS['Test Raider']!.id, DEFS['Test Raider']!.id]);
    expect('sideboard' in config.players[1]!).toBe(false);
    expect(config.options).toEqual({ startingLife: 20, startingPlayer: PLAYER_IDS[randomSeat('s', 2)] });
    expect(config.players[0]!.stops).toEqual(stops);
    expect(config.players[0]!.stops!.ownTurn).not.toBe(stops.ownTurn);
    expect(() => new LocalConnection(config)).not.toThrow();
  });

  it('a random first player depends only on the seed, and both seats come up', () => {
    expect(randomSeat('abc', 2)).toBe(randomSeat('abc', 2));
    const seats = new Set(Array.from({ length: 40 }, (_, i) => randomSeat(`seed-${i}`, 2)));
    expect([...seats].sort()).toEqual([0, 1]);
  });

  it('FAST5 MX7: a sideboard card without a definition stays out of the game and does not block the start', () => {
    const defs = { ...DEFS };
    delete defs['Test Raider'];
    const config = buildGameConfig({ players, defs, seed: 's', start: { startingLife: 20, firstPlayer: 0 }, stops });
    expect('sideboard' in config.players[0]!).toBe(false);
  });

  it('throws naming every card without a definition', () => {
    const defs = { Mountain: DEFS['Mountain']!, Forest: DEFS['Forest']! };
    expect(() => buildGameConfig({ players, defs, seed: 's', start: { startingLife: 20, firstPlayer: 0 }, stops })).toThrow(
      new ConfigBuildError('No card definition for: Test Bear, Test Shock.'),
    );
  });

  it('lists the card names once each, and notes what stays outside the game', () => {
    expect(deckCardNames(players)).toEqual(['Forest', 'Mountain', 'Test Bear', 'Test Raider', 'Test Shock']);
    expect(mainCardNames(players)).toEqual(['Forest', 'Mountain', 'Test Bear', 'Test Shock']);
    expect(deckNotes(green.deck)).toEqual([]);
    expect(deckNotes({ main: [], sideboard: [], companion: [{ name: 'Test Bear', count: 1 }] })[0]).toMatch(/CR 702\.139a/);
    expect(unplayableReason({ main: [], sideboard: [] })).toMatch(/no cards/);
  });
});
