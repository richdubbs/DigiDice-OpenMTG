/** Deck sleeves: one for every color and every combination; a deck's sleeve is the one of its colors (never chosen), drawn on that player's hidden cards in a game. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COLORS, type Color } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardDef } from '@openmtg/engine';
import { NavProvider, useNav } from '../src/app/nav';
import { CardBack, GameBoard, type PlayerSleeves } from '../src/board';
import { SleeveContext } from '../src/cards/CardBack';
import { CLASSIC_SLEEVE, SLEEVES, deckSleeve, sleeveForColors, sleeveTracersUrl, sleeveUrl } from '../src/branding/sleeves';
import { DecksProvider } from '../src/decks/context';
import { DeckbuilderScreen } from '../src/decks/DeckbuilderScreen';
import { DecksScreen } from '../src/decks/DecksScreen';
import { toDeckList } from '../src/decks/model';
import { MemoryDeckStore } from '../src/decks/store';
import { PLAYER_IDS } from '../src/game/config';
import { NewGameScreen } from '../src/game/NewGameScreen';
import {
  IMPACT,
  MANA_LIGHT,
  MIRROR_BOUNDS,
  fractureLightsSvg,
  fractureLightsUrl,
  fractureSleeveSvg,
  fractureSleeveUrl,
  logoMatrix,
  polygonArea,
  sleeveGone,
  sleeveSerial,
  sleeveShards,
} from '../src/profiles/fractureSleeve';
import { ProfilesStore, resetProfilesStoreForTests, templateProfileId } from '../src/profiles/profiles';
import { deckSleeveOf, savedDecks, type GameDeck, type GameServices } from '../src/game/services';
import { SettingsStore } from '../src/settings/settings';
import { ALICE, BOB, playGame } from './board/fixtures';
import { deckFixture, fakeServer } from './decks-fixtures';
import { FIXTURE_DEFS, memoryStorage } from './game-fixtures';

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

describe("Reality Fracture's sleeves", () => {
  afterEach(() => {
    resetProfilesStoreForTests();
  });

  it('draws every sleeve, and the colorless one, as a shattered mirror in its own colors, the same shards on each, drawn here and fetched from nowhere', () => {
    const shards = (svg: string) => [...svg.matchAll(/<clipPath id="s\d+"><path d="([^"]+)"/g)].map((m) => m[1]);
    const classic = fractureSleeveSvg([], 'Colorless');
    expect(shards(classic).length).toBeGreaterThanOrEqual(20);
    for (const s of SLEEVES) {
      const back = fractureSleeveSvg(s.colors, s.name);
      const lights = fractureLightsSvg(s.colors, s.name);
      expect(back, s.id).toContain(`<title>Reality Fracture card back, ${s.name} sleeve</title>`);
      // The still mirror is drawn once; the lights are what moves.
      expect(back, s.id).not.toContain('<animate');
      expect(lights.match(/<animate /g)?.length ?? 0, s.id).toBeGreaterThanOrEqual(20);
      for (const c of s.colors) expect(back, `${s.id} ${c}`).toContain(MANA_LIGHT[c]);
      expect(shards(back), s.id).toEqual(shards(classic));
      expect(fractureSleeveSvg(s.colors, s.name), s.id).toBe(back);
      // Nothing is fetched: the only picture is the logo, embedded once and drawn once; every other reference is inside.
      for (const svg of [back, lights]) {
        expect([...svg.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/^data:image\/png;base64,.*/, 'data:png')).filter((h) => !h.startsWith('#')), s.id).toEqual(
          svg === back ? ['data:png'] : [],
        );
        expect(svg, s.id).not.toMatch(/url\((?!#)/);
      }
      expect(back.match(/<use xlink:href="#mark"/g), s.id).toHaveLength(1);
      // The serial, as the DigiDice sleeves carry theirs: at the top and upside down at the bottom.
      expect(back.split(sleeveSerial(s.colors)).length - 1, s.id).toBe(2);
    }
    expect(sleeveSerial(['W', 'U'])).toBe('DIGIDICE · RF-WU · ECHO');
    expect(sleeveSerial([])).toBe('DIGIDICE · RF-C · ECHO');
  });

  it('recolors the DigiDice logo the way the DigiDice sleeves do: its blue to the first color, its magenta to the second, its white kept', () => {
    const apply = (values: string, hex: string) => {
      const m = values.split(' ').map(Number);
      const n = parseInt(hex.slice(1), 16);
      const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
      return [0, 1, 2].map((row) => Math.round((m[row * 5]! * v[0]! + m[row * 5 + 1]! * v[1]! + m[row * 5 + 2]! * v[2]!) * 255));
    };
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const values = logoMatrix(MANA_LIGHT.R, MANA_LIGHT.G);
    for (const [from, to] of [
      ['#1fb8ff', MANA_LIGHT.R],
      ['#f500f5', MANA_LIGHT.G],
      ['#f2f4ff', '#ffffff'],
    ] as const) {
      apply(values, from).forEach((v, i) => expect(Math.abs(v - rgb(to)[i]!), `${from} to ${to}`).toBeLessThanOrEqual(1));
    }
    expect(fractureSleeveSvg(['R', 'G'], 'Red-Green')).toContain(`values="${values}"`);
    // The colorless sleeve keeps the DigiDice colors.
    expect(fractureSleeveSvg([], 'Colorless')).not.toContain(`<feColorMatrix type="matrix"`);
  });

  it('breaks the mirror into pieces that tile it, the hole and the fallen pieces among them, and the card turned round is the same card', () => {
    const shards = sleeveShards();
    const gone = sleeveGone();
    const total = [...shards.map((s) => s.cell), ...gone].reduce((sum, cell) => sum + polygonArea(cell), 0);
    expect(Math.abs(total - polygonArea(MIRROR_BOUNDS))).toBeLessThan(1);
    // The hole the logo broke through is in the middle, and there is more than one piece gone.
    expect(gone.length).toBeGreaterThanOrEqual(6);
    const middle = { x: IMPACT.x, y: IMPACT.y };
    expect(gone.some((cell) => polygonArea(cell) > 0 && Math.min(...cell.map((p) => Math.hypot(p.x - middle.x, p.y - middle.y))) < 60)).toBe(true);
    expect(shards.filter((s) => s.foil).length).toBeGreaterThanOrEqual(4);
    // Two pieces are mirror and two show the echo world, never foil too.
    expect(shards.filter((s) => s.kind === 'mirror')).toHaveLength(2);
    expect(shards.filter((s) => s.kind === 'echo')).toHaveLength(2);
    expect(shards.some((s) => s.kind !== 'glass' && s.foil)).toBe(false);
    // Every piece has its echo, turned half round the middle; foil, mirror and echo pieces come in echoed pairs.
    const mid = (cell: readonly { x: number; y: number }[]) => {
      const n = cell.length;
      return { x: cell.reduce((t, p) => t + p.x, 0) / n, y: cell.reduce((t, p) => t + p.y, 0) / n };
    };
    for (const s of shards) {
      const m = mid(s.cell);
      const t = { x: 2 * IMPACT.x - m.x, y: 2 * IMPACT.y - m.y };
      const echo = shards.find((o) => Math.hypot(mid(o.cell).x - t.x, mid(o.cell).y - t.y) < 1);
      expect(echo, `${m.x.toFixed(0)},${m.y.toFixed(0)}`).toBeDefined();
      expect(echo!.foil).toBe(s.foil);
      expect(echo!.kind).toBe(s.kind);
    }
  });

  it('draws a sleeve shown small with its fine detail dropped and its first cracks bold, by the size it is drawn at', () => {
    for (const svg of [fractureSleeveSvg([], 'Colorless'), fractureSleeveSvg(['U', 'B'], 'Blue-Black')]) {
      expect(svg).toMatch(/<style>\.small\{display:none\}@media \(max-width: \d+px\)\{\.fine\{display:none\}\.small\{display:inline\}\}<\/style>/);
      expect(svg).toContain('<g class="small">');
      expect(svg.match(/class="fine"/g)?.length ?? 0).toBeGreaterThan(3);
      // The serial is fine detail: it is still there twice for a sleeve drawn large.
      expect(svg.split('class="fine"><text').length - 1).toBe(1);
    }
    expect(fractureLightsSvg([], 'Colorless')).toMatch(/@media \(max-width: \d+px\)\{\.fine\{display:none\}\}/);
  });

  it('card backs follow the profile: the cracked mirror in Reality Fracture, in the deck\'s colors, and the DigiDice sleeve in the other looks', () => {
    const store = new ProfilesStore(memoryStorage());
    resetProfilesStoreForTests(store);
    const { container } = render(
      <SleeveContext.Provider value="br">
        <CardBack size="large" />
      </SleeveContext.Provider>,
    );
    const back = () => container.querySelector<HTMLImageElement>('img.card-back')!;
    const lights = () => container.querySelector<HTMLImageElement>('img.card-back-tracers')!;
    expect(back().getAttribute('src')).toBe('/brand/sleeves/sleeve-br.svg');
    act(() => store.select(templateProfileId('fracture')));
    expect(back().getAttribute('src')).toBe(fractureSleeveUrl('br'));
    expect(back().getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(back().getAttribute('src')!)).toContain('Black-Red sleeve');
    expect(lights().getAttribute('src')).toBe(fractureLightsUrl('br'));
    expect(back().dataset['sleeve']).toBe('br');
    // An unknown sleeve, or none, is the colorless mirror.
    expect(fractureSleeveUrl('no-such-sleeve')).toBe(fractureSleeveUrl(undefined));
    act(() => store.select(templateProfileId('lcars')));
    expect(back().getAttribute('src')).toBe('/brand/sleeves/sleeve-br.svg');
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
    // The small backs on the table are the still sleeve alone: the moving lights (an SVG that animates on its own) on every one made a four-player table
    // run at 7 fps (cards/CardBack.tsx). Only a large back carries them.
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

describe("a deck's sleeve is the one of its colors", () => {
  it('mono-black gets the black sleeve, five colors the five-color one; a colorless deck, or colors not known yet, the classic back', () => {
    expect(deckSleeve(['B'])).toBe('b');
    expect(deckSleeve(['G', 'R'])).toBe('rg');
    expect(deckSleeve([...COLORS] as Color[])).toBe(sleeveForColors([...COLORS] as Color[])!.id);
    expect(deckSleeve([])).toBeUndefined();
    expect(deckSleeve(null)).toBeUndefined();
  });

  it("a game reads it from the cards' data: lands and the sideboard add no color, a card that cannot be read adds none", async () => {
    fakeServer({ cards: 'down' });
    expect(await deckSleeveOf(toDeckList(deckFixture()))).toBeUndefined();
    vi.unstubAllGlobals();
    fakeServer({});
    // Lightning Bolt and Grizzly Bears; Mountain and Stomping Ground are lands, Ancient Grudge is in the sideboard.
    expect(await deckSleeveOf(toDeckList(deckFixture()))).toBe('rg');
    expect(await deckSleeveOf({ main: [{ name: 'Mountain', count: 20 }, { name: 'Lightning Bolt', count: 4 }], sideboard: [{ name: 'Boros Charm', count: 2 }] })).toBe('r');
    expect(await deckSleeveOf({ main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Grizzly Bears', count: 1 }] })).toBe('g');
  });

  it('the deck library and Deck Details show it, nothing offers another one, and the saved deck keeps no sleeve', async () => {
    fakeServer({});
    const store = new MemoryDeckStore([deckFixture()]);
    const { unmount } = render(
      <DecksProvider store={store}>
        <NavProvider>
          <DecksScreen />
        </NavProvider>
      </DecksProvider>,
    );
    await waitFor(() => expect(document.querySelector('.deck-tile img.deck-box-face')?.getAttribute('data-sleeve')).toBe('rg'));
    unmount();
    render(
      <DecksProvider store={store}>
        <NavProvider>
          <DeckbuilderScreen deckId="deck-1" now={() => '2026-10-18T12:00:00.000Z'} validateDelayMs={0} autoSearch={false} />
        </NavProvider>
      </DecksProvider>,
    );
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    await waitFor(() => expect(document.querySelector('.deck-showcase img.deck-box-face')?.getAttribute('src')).toBe('/brand/sleeves/sleeve-rg.svg'));
    expect(screen.queryByRole('button', { name: /sleeve/i })).toBeNull();
    expect(await store.get('deck-1')).not.toHaveProperty('sleeve');
    expect((await savedDecks(store))[0]).not.toHaveProperty('sleeve');
  });

  it("New game shows each chosen deck in its sleeve, and the game draws each player's backs in it", async () => {
    const defs: Record<string, CardDef> = Object.fromEntries(FIXTURE_DEFS.map((d) => [d.name, d]));
    const red: GameDeck = { id: 'saved:red', name: 'My red deck', deck: { main: [{ name: 'Mountain', count: 20 }, { name: 'Test Shock', count: 20 }], sideboard: [] } };
    const green: GameDeck = { id: 'saved:green', name: 'My green deck', deck: { main: [{ name: 'Forest', count: 20 }, { name: 'Test Bear', count: 20 }], sideboard: [] } };
    const svc: GameServices = {
      listDecks: async () => [red, green],
      validateDeck: async (_deck, format) => ({ format, checkedAs: format, valid: true, status: 'legal', problems: [] }),
      compileDefs: async (names) => ({ defs: Object.fromEntries(names.map((n) => [n, defs[n]!])), failed: [], compilerVersion: 'test' }),
      newSeed: () => 'seed-1',
      deckSleeve: async (deck) => (deck.main.some((e) => e.name === 'Test Shock') ? 'r' : 'g'),
    };
    const settings = new SettingsStore(memoryStorage());
    let routeSleeves: PlayerSleeves | undefined;
    function Shell() {
      const { route } = useNav();
      if (route.screen === 'newGame') return <NewGameScreen services={svc} settings={settings} />;
      if (route.screen === 'game') routeSleeves = route.sleeves;
      return <p data-testid="route">{route.screen}</p>;
    }
    render(
      <NavProvider initial={{ screen: 'newGame' }}>
        <Shell />
      </NavProvider>,
    );
    const seat = async (n: 1 | 2, deck: GameDeck) => {
      const region = within(await screen.findByRole('region', { name: `Player ${n}` }));
      fireEvent.change(region.getByRole('combobox', { name: 'Deck' }), { target: { value: deck.id } });
    };
    await seat(1, red);
    await seat(2, green);
    const box = (n: number) => document.querySelector(`.new-game-preview[data-player="${n}"] img.deck-box-face`)?.getAttribute('data-sleeve');
    await waitFor(() => expect([box(1), box(2)]).toEqual(['r', 'g']));
    const start = screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByTestId('route');
    expect(routeSleeves).toEqual({ [PLAYER_IDS[0]!]: 'r', [PLAYER_IDS[1]!]: 'g' });
  });
});
