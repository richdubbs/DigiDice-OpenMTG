/** Deck sleeves: one for every color and every combination, chosen per deck, and drawn on that player's hidden cards in a game. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COLORS, type Color } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../src/app/nav';
import { CardBack, GameBoard } from '../src/board';
import { SleeveContext } from '../src/cards/CardBack';
import { CLASSIC_SLEEVE, SLEEVES, sleeveForColors, sleeveTracersUrl, sleeveUrl } from '../src/branding/sleeves';
import { DecksProvider } from '../src/decks/context';
import { DeckbuilderScreen } from '../src/decks/DeckbuilderScreen';
import { MemoryDeckStore } from '../src/decks/store';
import { savedDecks } from '../src/game/services';
import { ALICE, BOB, playGame } from './board/fixtures';
import { deckFixture, fakeServer } from './decks-fixtures';

const brandDir = path.resolve(__dirname, '..', '..', '..', 'assets', 'brand');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sleeves', () => {
  it('there is exactly one for every color and every combination of colors (31), and each file exists', () => {
    const subsets = (1 << COLORS.length) - 1;
    expect(SLEEVES).toHaveLength(subsets);
    const keys = new Set(SLEEVES.map((s) => [...s.colors].sort().join('')));
    expect(keys.size).toBe(subsets);
    for (const s of SLEEVES) {
      expect(s.id).toBe(s.colors.join('').toLowerCase());
      const file = path.join(brandDir, s.file);
      expect(existsSync(file), s.file).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain(`${s.name} sleeve`);
    }
  });

  it('finds the sleeve of a deck\'s colors in any order; colorless and unknown ids fall back to the classic back', () => {
    expect(sleeveForColors(['G', 'R'])?.id).toBe('rg');
    expect(sleeveForColors(['U', 'W', 'G'])?.id).toBe('gwu');
    expect(sleeveForColors([...COLORS] as Color[])?.name).toBe('All five colors');
    expect(sleeveForColors([])).toBeUndefined();
    expect(sleeveUrl('wu')).toBe('/brand/sleeves/sleeve-wu.svg');
    expect(sleeveUrl(undefined)).toBe('/brand/sleeves/sleeve-classic.svg');
    expect(sleeveUrl('no-such-sleeve')).toBe('/brand/sleeves/sleeve-classic.svg');
    expect(sleeveTracersUrl('wu')).toBe('/brand/sleeves/sleeve-wu-tracers.svg');
    expect(sleeveTracersUrl(undefined)).toBe('/brand/sleeves/sleeve-classic-tracers.svg');
  });

  it("every sleeve's moving lights run along its lines, each in a color of the sleeve's own lines", () => {
    for (const s of [...SLEEVES, { id: 'classic', file: 'sleeves/sleeve-classic.svg', tracers: 'sleeves/sleeve-classic-tracers.svg' }]) {
      const back = readFileSync(path.join(brandDir, s.file), 'utf8');
      const lights = readFileSync(path.join(brandDir, s.tracers), 'utf8');
      // The still card back has no animation (it is drawn once); the lights are what moves.
      expect(back, s.id).not.toContain('<animate');
      expect(lights.match(/<animate /g)?.length ?? 0, s.id).toBeGreaterThanOrEqual(40);
      const lineColors = new Set([...back.matchAll(/<path d="[^"]+" stroke="(#[0-9A-F]{6})" stroke-width="3.2"\/>/g)].map((m) => m[1]));
      const paths = [...lights.matchAll(/<path d="([^"]+)" stroke="(#[0-9A-F]{6})" stroke-opacity="0.35" stroke-width="15"/g)];
      expect(paths.length, s.id).toBeGreaterThan(0);
      for (const [, d, color] of paths) {
        expect(lineColors.has(color!), `${s.id} ${color}`).toBe(true);
        // The comet's halo is the line's own color (its body and core are brighter shades); it runs on a line of the card back (or on two that join).
        expect(back.includes(d!.split(' L').slice(0, 2).join(' L')) || back.includes(d!.split(' L').reverse().slice(0, 2).join(' L')), `${s.id} ${d}`).toBe(true);
      }
    }
  });
});

describe('sleeves in a game', () => {
  const game = playGame(2);

  it("each player's library and hidden hand are drawn in their own deck's sleeve", () => {
    const c = game.captured.find((x) => x.view.viewer === ALICE && x.step === 'main1')!;
    const { container } = render(<GameBoard view={c.view} sleeves={{ [ALICE]: 'wu', [BOB]: 'br' }} />);
    const backs = (sel: string) => [...container.querySelectorAll<HTMLImageElement>(`${sel} img.card-back`)];
    const bobHand = backs(`.hand-hidden[data-player-id="${BOB}"]`);
    expect(bobHand.length).toBeGreaterThan(0);
    for (const img of bobHand) expect(img.getAttribute('src')).toBe('/brand/sleeves/sleeve-br.svg');
    expect(backs(`.pile-library[data-player-id="${ALICE}"]`).map((i) => i.dataset['sleeve'])).toEqual(['wu']);
    expect(backs(`.pile-library[data-player-id="${BOB}"]`).map((i) => i.dataset['sleeve'])).toEqual(['br']);
    // The small backs on the table are the still sleeve alone: the moving lights (an SVG that animates on its own, re-rasterized every frame per copy) made
    // a four-player table run at 7 fps. Only a large back carries them.
    expect(container.querySelector('.board-back-small img.card-back-tracers')).toBeNull();
    expect(container.querySelector('.board-back-normal img.card-back-tracers')).toBeNull();
  });

  it("a large back (the zoom) carries its sleeve's moving lights, laid over it and hidden from screen readers", () => {
    const { container } = render(
      <SleeveContext.Provider value="br">
        <CardBack size="large" />
      </SleeveContext.Provider>,
    );
    const lights = container.querySelector<HTMLImageElement>('.board-back-large img.card-back-tracers')!;
    expect(lights.getAttribute('src')).toBe('/brand/sleeves/sleeve-br-tracers.svg');
    expect(lights.getAttribute('aria-hidden')).toBe('true');
    expect(render(<CardBack size="small" />).container.querySelector('img.card-back-tracers')).toBeNull();
  });

  it('without sleeves every back is the classic one', () => {
    const c = game.captured.find((x) => x.view.viewer === ALICE && x.step === 'main1')!;
    const { container } = render(<GameBoard view={c.view} />);
    const backs = [...container.querySelectorAll<HTMLImageElement>('img.card-back')];
    expect(backs.length).toBeGreaterThan(0);
    for (const img of backs) expect(img.dataset['sleeve']).toBe(CLASSIC_SLEEVE);
  });
});

describe('choosing a deck\'s sleeve', () => {
  it('Deck Details opens the sleeve picker, marks the one matching the deck\'s colors, and saves the pick', async () => {
    fakeServer({});
    const store = new MemoryDeckStore([deckFixture()]);
    render(
      <DecksProvider store={store}>
        <NavProvider>
          <DeckbuilderScreen deckId="deck-1" now={() => '2026-10-18T12:00:00.000Z'} validateDelayMs={0} autoSearch={false} />
        </NavProvider>
      </DecksProvider>,
    );
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sleeve' }));
    const picker = screen.getByRole('dialog', { name: 'Choose a sleeve' });
    expect(within(picker).getAllByRole('button').filter((b) => b.classList.contains('sleeve-option'))).toHaveLength(SLEEVES.length + 1);
    expect(within(picker).getByRole('button', { name: 'Classic' }).getAttribute('aria-pressed')).toBe('true');
    // The Gruul deck is red and green (Lightning Bolt, Grizzly Bears) once its cards' data has arrived.
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'Red-Green Matches this deck' })).toBeTruthy());
    fireEvent.click(within(picker).getByRole('button', { name: 'Red-Green Matches this deck' }));
    expect(screen.queryByRole('dialog', { name: 'Choose a sleeve' })).toBeNull();
    await waitFor(async () => expect((await store.get('deck-1'))!.sleeve).toBe('rg'));
    expect(document.querySelector('.deck-showcase img.deck-box-face')?.getAttribute('src')).toBe('/brand/sleeves/sleeve-rg.svg');
    // The game gets it with the deck.
    expect((await savedDecks(store))[0]!.sleeve).toBe('rg');
    // Classic takes the sleeve off again.
    fireEvent.click(screen.getByRole('button', { name: 'Sleeve' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose a sleeve' })).getByRole('button', { name: 'Classic' }));
    await waitFor(async () => expect((await store.get('deck-1'))!.sleeve).toBeUndefined());
  });
});
