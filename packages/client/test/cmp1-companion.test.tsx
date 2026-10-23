/**
 * CMP1 (CR 702.139a, 116.2g): companion in the client. The New game screen plays the deck's companion (the Companion section, or the one the deck check read
 * from an MTGO sideboard) as `PlayerConfig.companion` and blocks the start on a companion error in any format; the board shows each player's revealed
 * companion; the priority prompt offers the special action as a button of its own (the card is outside the game: nothing on the board to click).
 */
import { act as reactAct, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createGame, viewFor, type CardDef, type GameState } from '@openmtg/engine';
import type { DeckList, ValidateResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../src/app/nav';
import { GameBoard } from '../src/board';
import type { LocalConnection } from '../src/connection/LocalConnection';
import { ConfigBuildError, DEFAULT_START, buildGameConfig, companionOf, deckCardNames, deckNotes } from '../src/game/config';
import { NewGameScreen } from '../src/game/NewGameScreen';
import type { GameDeck, GameServices } from '../src/game/services';
import { toOnlineDeck } from '../src/online/setup';
import { SettingsStore } from '../src/settings/settings';
import { clone } from '../../engine/src/util/clone';
import { compiledDefs } from '../../engine/test/fixtures';
import { act, put } from '../../engine/test/m3/scenario';
import { memoryStorage } from './game-fixtures';
import { click, renderPrompt } from './prompts/harness';

afterEach(cleanup);

const LURRUS = 'Lurrus of the Dream-Den';
const DEFS: Record<string, CardDef> = Object.fromEntries(compiledDefs(['Plains', 'Mountain', 'Grizzly Bears', 'Kitchen Finks', LURRUS]).map((d) => [d.name, d]));
const STOPS = { ownTurn: [], opponentTurn: [], fullControl: false };
const arena: DeckList = { main: [{ name: 'Plains', count: 40 }, { name: 'Grizzly Bears', count: 20 }], sideboard: [{ name: LURRUS, count: 1 }, { name: 'Kitchen Finks', count: 2 }], companion: [{ name: LURRUS, count: 1 }] };
const plain: DeckList = { main: [{ name: 'Plains', count: 60 }], sideboard: [] };

/** A started game where Alice revealed Lurrus, at her first main phase with `lands` Mountains. */
function companionGame(lands = 3): GameState {
  const deck = Array(40).fill('Plains') as string[];
  let s = clone(createGame({
    seed: 'cmp1-client',
    players: [{ id: 'p1', name: 'Alice', deck, companion: LURRUS, stops: { fullControl: true } }, { id: 'p2', name: 'Bob', deck, stops: { fullControl: true } }],
    defs: Object.values(DEFS),
    options: { startingPlayer: 'p1', skipMulligans: true },
  }));
  for (let i = 0; i < lands; i++) put(s, 'p1', 'battlefield', 'Mountain');
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

describe('CMP1: the game config (game/config.ts)', () => {
  it('CR 702.139a: the Companion section becomes PlayerConfig.companion; its sideboard copy (Arena lists it there too) leaves the sideboard', () => {
    const players = [{ name: 'Ann', deck: arena }, { name: 'Ben', deck: plain }] as const;
    expect(deckCardNames(players)).toEqual(['Grizzly Bears', 'Kitchen Finks', LURRUS, 'Plains']);
    const config = buildGameConfig({ players, defs: DEFS, seed: 's', start: { ...DEFAULT_START, firstPlayer: 0 }, stops: STOPS });
    expect(config.players[0]).toMatchObject({ companion: LURRUS, sideboard: ['Kitchen Finks', 'Kitchen Finks'] });
    expect(config.players[1]).not.toHaveProperty('companion');
    expect((config.defs as CardDef[]).map((d) => d.name)).toContain(LURRUS);
  });

  it("the deck check's reading wins: an MTGO sideboard companion it read is played; null plays none", () => {
    const mtgo: DeckList = { main: arena.main, sideboard: arena.sideboard };
    expect(companionOf({ name: 'A', deck: mtgo })).toBeNull();
    expect(companionOf({ name: 'A', deck: mtgo, companion: LURRUS })).toBe(LURRUS);
    expect(companionOf({ name: 'A', deck: arena, companion: null })).toBeNull();
    const config = buildGameConfig({ players: [{ name: 'Ann', deck: mtgo, companion: LURRUS }, { name: 'Ben', deck: plain }], defs: DEFS, seed: 's', start: DEFAULT_START, stops: STOPS });
    expect(config.players[0]).toMatchObject({ companion: LURRUS, sideboard: ['Kitchen Finks', 'Kitchen Finks'] });
  });

  it('a companion whose card does not load stops the start (the player expects it), with its name', () => {
    const { [LURRUS]: _gone, ...without } = DEFS;
    expect(() => buildGameConfig({ players: [{ name: 'Ann', deck: arena }, { name: 'Ben', deck: plain }], defs: without, seed: 's', start: DEFAULT_START, stops: STOPS })).toThrow(ConfigBuildError);
  });

  it('the deck note says how the companion works (CR 702.139a, 116.2g); the online deck carries the section', () => {
    expect(deckNotes(arena).join(' ')).toMatch(/Lurrus of the Dream-Den is your companion: it starts outside the game.*pay \{3\}.*CR 702\.139a, 116\.2g/);
    expect(deckNotes(plain)).toEqual([]);
    expect(toOnlineDeck(arena).companion).toEqual([{ name: LURRUS, count: 1 }]);
    expect(toOnlineDeck(plain)).not.toHaveProperty('companion');
  });
});

describe('CR 702.139a: the board shows each revealed companion to every viewer', () => {
  it('outside the game, then in the game once put into the hand', () => {
    const s = companionGame();
    for (const viewer of ['p1', 'p2'] as const) {
      render(<GameBoard view={viewFor(s, viewer)} />);
      expect(screen.getByRole('group', { name: `Alice's companion, ${LURRUS}: Companion: outside the game` })).toBeTruthy();
      expect(screen.queryByRole('group', { name: /Bob's companion/ })).toBeNull();
      cleanup();
    }
    s.players.find((p) => p.id === 'p1')!.companion!.inHand = 1;
    render(<GameBoard view={viewFor(s, 'p2')} />);
    expect(screen.getByRole('group', { name: `Alice's companion, ${LURRUS}: Companion: put into the hand on turn 1` })).toBeTruthy();
  });
});

describe('CR 116.2g: the special action is a button of the priority prompt', () => {
  it('is shown when the engine lists it and sends exactly that action (the payment follows)', async () => {
    const s = companionGame();
    const { conn } = renderPrompt(s);
    await click(`Companion: pay {3} and put ${LURRUS} into your hand`);
    expect(conn.sent[0]).toEqual({ type: 'special', player: 'p1', kind: 'companion' });
    expect(conn.errors).toEqual([]);
    // auto-payment answered the {3} (PAY1), so the card is in the hand
    expect(conn.state.players.find((p) => p.id === 'p1')!.companion?.inHand).toBe(conn.state.turn.number);
  });

  it('is not shown when it is not legal (no {3})', () => {
    renderPrompt(companionGame(2));
    expect(screen.queryByRole('button', { name: /^Companion:/ })).toBeNull();
  });
});

// ---- the New game screen

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

const lurrusDeck: GameDeck = { id: 'saved:lurrus', name: 'Lurrus deck', deck: arena };
const plainDeck: GameDeck = { id: 'saved:plain', name: 'Plain deck', deck: plain };

function services(validate: (deck: DeckList, format: string) => ValidateResponse | null): GameServices {
  return {
    listDecks: async () => [lurrusDeck, plainDeck],
    validateDeck: async (deck, format) => validate(deck, format),
    compileDefs: vi.fn(async (names: string[]) => ({ defs: Object.fromEntries(names.map((n) => [n, DEFS[n]!])), failed: [], compilerVersion: 'test' })),
    newSeed: () => 'seed-cmp1',
  };
}

function Shell({ svc }: { svc: GameServices }) {
  const { route } = useNav();
  if (route.screen === 'newGame') return <NewGameScreen services={svc} settings={new SettingsStore(memoryStorage())} />;
  return <p data-testid="route">{route.screen}</p>;
}

async function open(svc: GameServices) {
  render(
    <NavProvider initial={{ screen: 'newGame' }}>
      <Shell svc={svc} />
    </NavProvider>,
  );
  await screen.findByRole('region', { name: 'Player 1' });
}
const player = (n: 1 | 2) => within(screen.getByRole('region', { name: `Player ${n}` }));
async function pick(n: 1 | 2, deck: GameDeck) {
  await reactAct(async () => {
    fireEvent.change(player(n).getByRole('combobox', { name: 'Deck' }), { target: { value: deck.id } });
  });
}
const startButton = () => screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
const ok = (format: string, companion?: string): ValidateResponse => ({ format, checkedAs: format, valid: true, status: 'legal', problems: [], ...(companion ? { companion } : {}) });

describe('CMP1: New game', () => {
  it('CR 702.139a: a deck with a companion starts with it outside the game, revealed', async () => {
    const svc = services((deck, format) => ok(format, deck.companion?.length ? LURRUS : undefined));
    await open(svc);
    await pick(1, lurrusDeck);
    await pick(2, plainDeck);
    expect(player(1).getByText(/Lurrus of the Dream-Den is your companion/)).toBeTruthy();
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByTestId('route').textContent).toBe('game');
    const s = (made[made.length - 1] as LocalConnection).session.state;
    expect(s.players.find((p) => p.id === 'p1')!.companion).toEqual({ defId: LURRUS });
    expect(s.outside?.['p1']).toEqual(['Kitchen Finks', 'Kitchen Finks', LURRUS]);
  });

  it('CR 702.139a: a companion error blocks the start in any format (no "Play anyway")', async () => {
    const svc = services((deck, format) =>
      deck.companion?.length
        ? { format, checkedAs: format, valid: false, status: 'illegal', companion: LURRUS, problems: [{ kind: 'companion', severity: 'error', message: "Lurrus of the Dream-Den's companion condition is not met.", card: LURRUS, rules: ['CR 702.139a'] }] }
        : ok(format),
    );
    await open(svc);
    await pick(1, lurrusDeck);
    await pick(2, plainDeck);
    await screen.findByText("Lurrus of the Dream-Den's companion condition is not met. (CR 702.139a)");
    expect(screen.queryByRole('checkbox', { name: /Play anyway/ })).toBeNull();
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText("A deck's companion can't be revealed (see above, CR 702.139a): fix the deck or remove the companion in the deckbuilder.")).toBeTruthy();
  });

  it('CR 702.139a: when the deck check is unavailable, the companion is not revealed unchecked: "Play anyway" first (then it is)', async () => {
    const svc = services(() => null);
    await open(svc);
    await pick(1, lurrusDeck);
    await pick(2, plainDeck);
    await screen.findByText('Tick Play anyway to reveal a companion whose condition was not checked (CR 702.139a).');
    expect(startButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Play anyway/ }));
    expect(startButton().disabled).toBe(false);
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    const s = (made[made.length - 1] as LocalConnection).session.state;
    expect(s.players.find((p) => p.id === 'p1')!.companion).toEqual({ defId: LURRUS });
  });

  it('two decks without a companion and no deck check start as before (no tick needed in a normal format)', async () => {
    await open(services(() => null));
    await pick(1, plainDeck);
    await pick(2, plainDeck);
    await waitFor(() => expect(startButton().disabled).toBe(false));
  });
});
