/** The app shell: Home (branding slot 1), footer (slot 6), navigation to every screen and back, About (slot 8). */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import type { StatusResponse } from '@openmtg/server/api';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, preloadScreens } from '../src/app/App';
import { APP_TITLE, BRAND, CREATOR_CREDIT, FAN_CONTENT_DISCLAIMER, donationUrl } from '../src/branding/brand';
import { LocalConnection } from '../src/connection/LocalConnection';
import { smallConfig, stubFetch } from './helpers';

const STATUS: StatusResponse = {
  app: { name: 'OpenMTG', version: '0.0.0' },
  compilerVersion: 'test-compiler',
  cardData: { updatedAt: '2026-10-11T21:01:56.537+00:00', downloadedAt: '2026-10-11T22:15:00.384Z', cards: 34473 },
  rulesPack: null,
  coverage: null,
};

/** Donate shows exactly when brand.json sets a donation URL (branding.md); the tests hold whichever way the shipped brand.json is set. */
const donateShown = donationUrl(BRAND) !== null;

// The screens are separate chunks (App.tsx); load them once before the tests, under this hook's own timeout, so a busy machine's module loading is not
// counted against a test's or a findBy's timeout (CL3: this file's lazy-loading tests timed out under full-suite load).
beforeAll(() => preloadScreens(), 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Home', () => {
  it('shows the DigiDice logo, "OpenMTG by DigiDice", the main menu, and a Donate button only when brand.json sets a URL', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: APP_TITLE })).toBeTruthy();
    expect(screen.getByAltText('DigiDice logo').getAttribute('src')).toBe('/brand/digidice-mark-transparent.png');
    const menu = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['Play', 'Decks', 'Images', 'Settings', 'About']);
    expect(screen.queryAllByText('Donate').length > 0).toBe(donateShown);
  });

  it('has the footer with "OpenMTG by DigiDice" and the exact Fan Content disclaimer', () => {
    render(<App />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(APP_TITLE)).toBeTruthy();
    expect(within(footer).getByText(FAN_CONTENT_DISCLAIMER)).toBeTruthy();
  });
});

describe('top navigation bar', () => {
  it('has the logo (Home) and the tabs Play, Decks, Replays, Images, Settings, About on every screen but the game; the current screen is aria-current', async () => {
    stubFetch(() => ({ status: 200, body: STATUS }));
    render(<App />);
    const bar = () => screen.getByRole('navigation', { name: 'Sections' });
    expect(within(bar()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Play', 'Decks', 'Replays', 'Images', 'Settings', 'About']);
    expect(within(bar()).queryByRole('button', { current: 'page' })).toBeNull();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 15000 })).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'Settings', current: 'page' })).toBeTruthy();
    fireEvent.click(within(bar()).getByRole('button', { name: 'About' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'About', current: 'page' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { level: 1, name: APP_TITLE })).toBeTruthy();
  }, 20000);
});

describe('navigation', () => {
  it.each([
    ['Play', 'New game'],
    ['Decks', 'Decks'],
    ['Images', 'Card images'],
    ['Settings', 'Settings'],
  ])('%s opens the %s screen (loaded on first use), Back returns Home, and the footer stays', async (button, title) => {
    stubFetch(() => ({ status: 200, body: STATUS }));
    render(<App />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('button', { name: button }));
    expect(await screen.findByRole('heading', { level: 1, name: title }, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: APP_TITLE })).toBeTruthy();
  }, 20000);

  it('opens the deckbuilder and the game screen from routes; the game screen has no footer', async () => {
    render(<App initial={{ screen: 'deckbuilder', deckId: 'd1' }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Deckbuilder' }, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByText(/Deck: d1/)).toBeTruthy();
    render(<App initial={{ screen: 'game', connection: new LocalConnection(smallConfig()) }} />);
    // A hot-seat game opens behind the pass cover (C7), which hides everything.
    expect(await screen.findByRole('dialog', { name: /^Pass to / }, { timeout: 15000 })).toBeTruthy();
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    // The game has its own bar: no top navigation of the shell.
    expect(screen.getAllByRole('navigation', { name: 'Sections' })).toHaveLength(1);
  }, 20000);

  it("passes the game route's rematch to the game screen", async () => {
    const conn = new LocalConnection(smallConfig());
    const rematch = vi.fn(() => new LocalConnection(smallConfig()));
    render(<App initial={{ screen: 'game', connection: conn, rematch }} />);
    await screen.findByRole('dialog', { name: /^Pass to / }, { timeout: 15000 });
    const player = conn.session.state.players[0]!.id;
    await reactAct(async () => {
      await conn.act({ type: 'concede', player });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(rematch).toHaveBeenCalledTimes(1);
  });
});

describe('About', () => {
  it('shows the creator credit, the disclaimer, Scryfall credit, licenses and the card-data date from /api/status', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: STATUS }));
    render(<App />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('button', { name: 'About' }));
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
    expect(screen.getByText(CREATOR_CREDIT)).toBeTruthy();
    const fan = screen.getByRole('region', { name: 'Fan Content' });
    expect(within(fan).getByText(FAN_CONTENT_DISCLAIMER)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Scryfall' }).getAttribute('href')).toBe('https://scryfall.com');
    expect(screen.getByText(/not produced by or endorsed by Scryfall/)).toBeTruthy();
    expect(screen.getByText(/MIT License, copyright © 2026 DigiDice LLC/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'MIT License' }).getAttribute('href')).toBe('/legal/LICENSE.txt');
    expect(screen.getByRole('link', { name: 'Third-party notices' }).getAttribute('href')).toBe('/legal/THIRD_PARTY_NOTICES.md');
    expect(await screen.findByText(/Scryfall Oracle data of 2026-10-11 \(downloaded 2026-10-11, 34,473 cards\)/)).toBeTruthy();
    expect(screen.getByText('None installed')).toBeTruthy();
    expect(screen.getByText('Not computed yet')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.objectContaining({ method: 'GET' }));
    expect(screen.queryAllByText('Donate').length > 0).toBe(donateShown);
  });

  it('says so when the card data has not been downloaded', async () => {
    stubFetch(() => ({ status: 200, body: { ...STATUS, cardData: null } }));
    render(<App initial={{ screen: 'about' }} />);
    expect(await screen.findByText(/Not downloaded yet/)).toBeTruthy();
  });

  it('shows the server error instead of the versions when /api/status fails', async () => {
    stubFetch(() => ({ status: 500, body: { error: 'Internal server error' } }));
    render(<App initial={{ screen: 'about' }} />);
    expect(await screen.findByText(/The local server did not answer \(Internal server error\)/)).toBeTruthy();
  });
});
