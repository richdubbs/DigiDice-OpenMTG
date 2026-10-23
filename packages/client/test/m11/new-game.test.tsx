/**
 * M11-2 (docs/design/m11-commander.md 5.1): starting a Commander game from the New game screen. The format list has the Commander variants (one data
 * array, config.ts COMMANDER_GAME_VARIANTS), the deck's commander section becomes `PlayerConfig.commanders` (the 99 the deck), `options.commander` the
 * variant's rules, the starting life follows the variant, and the deck checks block on an error (warnings are shown and need "Play anyway").
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COMMANDER_VARIANTS, commanderOptions, type CardDef } from '@openmtg/engine';
import type { DeckList, ValidateResponse } from '@openmtg/server/api';
import { describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../../src/app/nav';
import { LocalConnection } from '../../src/connection/LocalConnection';
import {
  COMMANDER_GAME_VARIANTS, DEFAULT_START, FORMATS, buildGameConfig, commanderVariantOf, deckCardNames, offeredFormat, startingLifeFor, unplayableReason,
} from '../../src/game/config';
import { NewGameScreen, variantSummary } from '../../src/game/NewGameScreen';
import { PRACTICE_DECKS } from '../../src/game/practiceDecks';
import type { GameDeck, GameServices } from '../../src/game/services';
import { SettingsStore } from '../../src/settings/settings';
import { memoryStorage } from '../game-fixtures';
import { BEAR, FOREST, KRAUM, TITANIA, TYMNA } from './fixtures';

const DEFS: Record<string, CardDef> = Object.fromEntries([FOREST, BEAR, TITANIA, KRAUM, TYMNA].map((d) => [d.name, d]));

const titania: GameDeck = {
  id: 'saved:titania', name: 'Titania deck', format: 'commander',
  deck: { main: [{ name: 'Forest', count: 60 }, { name: 'Test Bear', count: 39 }], sideboard: [], commander: [{ name: 'Test Titania', count: 1 }] },
};
const partners: GameDeck = {
  id: 'saved:partners', name: 'Partners deck', format: 'commander',
  deck: { main: [{ name: 'Forest', count: 98 }], sideboard: [], commander: [{ name: 'Test Kraum', count: 1 }, { name: 'Test Tymna', count: 1 }] },
};
const green: GameDeck = { id: 'saved:green', name: 'My green deck', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [] } };
const ALL = [titania, partners, green, ...PRACTICE_DECKS];

const legal = (format: string): ValidateResponse => ({ format, checkedAs: format, valid: true, status: 'legal', problems: [] });

function services(over: Partial<GameServices> = {}): GameServices {
  return {
    listDecks: async () => ALL,
    validateDeck: async (_deck: DeckList, format: string) => legal(format),
    compileDefs: vi.fn(async (names: string[]) => ({ defs: Object.fromEntries(names.map((n) => [n, DEFS[n]!])), failed: [], compilerVersion: 'test' })),
    newSeed: () => 'seed-m11',
    ...over,
  };
}

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

function Shell({ svc, deckId }: { svc: GameServices; deckId?: string }) {
  const { route } = useNav();
  if (route.screen === 'newGame') return <NewGameScreen services={svc} settings={new SettingsStore(memoryStorage())} {...(deckId ? { deckId } : {})} />;
  return <p data-testid="route">{route.screen}</p>;
}

async function open(svc = services(), deckId?: string) {
  render(
    <NavProvider initial={{ screen: 'newGame' }}>
      <Shell svc={svc} {...(deckId ? { deckId } : {})} />
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
const formatBox = () => screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement;
const lifeBox = () => screen.getByRole('spinbutton', { name: 'Starting life' }) as HTMLInputElement;
const startButton = () => screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
async function setFormat(id: string) {
  await reactAct(async () => {
    fireEvent.change(formatBox(), { target: { value: id } });
  });
}

describe('M11-2: the Commander formats (config.ts)', () => {
  it('ONE list of variants drives the format list: Commander, Duel Commander, Brawl and Standard Brawl', () => {
    expect(COMMANDER_GAME_VARIANTS).toEqual(['commander', 'duel', 'brawl', 'standardbrawl']);
    for (const v of COMMANDER_GAME_VARIANTS) expect(FORMATS.some((f) => f.id === v)).toBe(true);
    expect(FORMATS.filter((f) => commanderVariantOf(f.id) !== null).map((f) => f.label)).toEqual(['Commander', 'Duel Commander', 'Brawl', 'Standard Brawl']);
    expect(commanderVariantOf('modern')).toBeNull();
    expect(offeredFormat('EDH')).toBe('commander');
  });

  it('CR 903.7, 103.4: the starting life comes from the variant data', () => {
    expect(startingLifeFor('modern')).toBe(20);
    for (const v of COMMANDER_GAME_VARIANTS) expect(startingLifeFor(v)).toBe(COMMANDER_VARIANTS[v].startingLife);
    expect(startingLifeFor('commander')).toBe(40);
  });

  it('the variant summary reads the variant data (no commander damage line when its limit is null)', () => {
    expect(variantSummary('commander')).toContain('21 combat damage from one commander loses the game (CR 903.10a)');
    expect(variantSummary('brawl')).toContain('no commander damage rule');
    expect(variantSummary('brawl')).toContain('the first mulligan is free (CR 903.12g)');
  });

  it('CR 903.3: a commander deck plays only in a Commander format, a Commander game needs one or two commanders', () => {
    expect(unplayableReason(titania.deck, 'modern')).toMatch(/This deck has a commander: choose a Commander format/);
    expect(unplayableReason(titania.deck, 'commander')).toBeNull();
    expect(unplayableReason(partners.deck, 'duel')).toBeNull();
    expect(unplayableReason(green.deck, 'commander')).toMatch(/A Commander game needs a commander/);
    expect(unplayableReason({ ...titania.deck, commander: [{ name: 'A', count: 1 }, { name: 'B', count: 1 }, { name: 'C', count: 1 }] }, 'commander')).toMatch(/3 commanders/);
    expect(unplayableReason(green.deck, 'modern')).toBeNull();
  });

  it('the commanders are compiled with the deck; they become PlayerConfig.commanders, the 99 the deck, options.commander the variant', () => {
    const players = [{ name: 'Ann', deck: titania.deck }, { name: 'Ben', deck: partners.deck }] as const;
    expect(deckCardNames(players)).toEqual(['Forest', 'Test Bear', 'Test Kraum', 'Test Titania', 'Test Tymna']);
    const config = buildGameConfig({ players, defs: DEFS, seed: 's', start: { ...DEFAULT_START, startingLife: 40, firstPlayer: 0 }, stops: { ownTurn: [], opponentTurn: [], fullControl: false }, commander: 'commander' });
    expect(config.players.map((p) => p.commanders)).toEqual([[TITANIA.id], [KRAUM.id, TYMNA.id]]);
    expect(config.players.map((p) => p.deck.length)).toEqual([99, 98]);
    expect(config.players[0]!.deck).not.toContain(TITANIA.id);
    expect(config.options).toMatchObject({ startingLife: 40, commander: commanderOptions('commander') });
    // A normal game: no commander anywhere in the config (a normal game works exactly as before).
    const normal = buildGameConfig({ players: [{ name: 'Ann', deck: green.deck }, { name: 'Ben', deck: green.deck }], defs: DEFS, seed: 's', start: DEFAULT_START, stops: { ownTurn: [], opponentTurn: [], fullControl: false } });
    expect(normal.options?.commander).toBeUndefined();
    expect(normal.players.every((p) => p.commanders === undefined)).toBe(true);
  });
});

describe('M11-2: starting a Commander game', () => {
  it('a commander deck preselects Commander and 40 life; the hot-seat game starts with the commanders in the command zone', async () => {
    const svc = services();
    await open(svc);
    await pick(1, titania);
    await pick(2, partners);
    expect(formatBox().value).toBe('commander');
    expect(lifeBox().valueAsNumber).toBe(40);
    expect(screen.getByText(/^Commander: 40 life \(CR 903\.7\)/)).toBeTruthy();
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await reactAct(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByTestId('route').textContent).toBe('game');
    expect(svc.compileDefs).toHaveBeenCalledWith(['Forest', 'Test Bear', 'Test Kraum', 'Test Titania', 'Test Tymna'], expect.anything());
    const conn = made[made.length - 1] as LocalConnection;
    const s = conn.session.state;
    expect(s.options.commander).toEqual(commanderOptions('commander'));
    expect(s.players.map((p) => p.life)).toEqual([40, 40]);
    expect(s.zones.command.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Kraum', 'Test Titania', 'Test Tymna']);
    expect((s.zones.library.p1?.length ?? 0) + (s.zones.hand.p1?.length ?? 0)).toBe(99);
  });

  it('the starting life follows the format until the player types one (Brawl 25, back to 20 for a normal format)', async () => {
    await open();
    await setFormat('brawl');
    expect(lifeBox().valueAsNumber).toBe(25);
    await setFormat('modern');
    expect(lifeBox().valueAsNumber).toBe(20);
    fireEvent.change(lifeBox(), { target: { value: '33' } });
    await setFormat('commander');
    expect(lifeBox().valueAsNumber).toBe(33);
  });

  it('a deck check error blocks a Commander game (no "Play anyway"); a warning is shown and needs "Play anyway"', async () => {
    let severity: 'error' | 'warning' = 'error';
    const validateDeck = async (deck: DeckList, format: string): Promise<ValidateResponse> =>
      deck.commander?.[0]?.name === 'Test Kraum'
        ? {
            format, checkedAs: format, valid: severity !== 'error', status: severity === 'error' ? 'illegal' : 'unchecked',
            problems: [{ kind: severity === 'error' ? 'commander' : 'unknown', severity, message: severity === 'error' ? "Test Kraum and Test Tymna can't be commanders together." : 'Test Kraum has no legality data.', rules: [severity === 'error' ? 'CR 702.124f' : 'CR 100.6'] }],
          }
        : legal(format);
    await open(services({ validateDeck }));
    await pick(1, titania);
    await pick(2, partners);
    await screen.findByText("Test Kraum and Test Tymna can't be commanders together. (CR 702.124f)");
    expect(screen.queryByRole('checkbox', { name: /Play anyway/ })).toBeNull();
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText('A deck breaks the rules of this Commander format (see above): fix it in the deckbuilder.')).toBeTruthy();
    severity = 'warning';
    await setFormat('duel');
    await screen.findByText('Test Kraum has no legality data. (CR 100.6)');
    expect(startButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Play anyway/ }));
    expect(startButton().disabled).toBe(false);
  });

  it('a deck without a commander cannot start a Commander game', async () => {
    await open();
    await setFormat('commander');
    await pick(1, green);
    expect(player(1).getByText(/A Commander game needs a commander/)).toBeTruthy();
    expect(startButton().disabled).toBe(true);
  });

  it('opened from the deckbuilder ("Play this deck"): player 1 has the deck and its format', async () => {
    await open(services(), partners.id);
    await waitFor(() => expect((player(1).getByRole('combobox', { name: 'Deck' }) as HTMLSelectElement).value).toBe(partners.id));
    expect(formatBox().value).toBe('commander');
  });
});
