/**
 * M13-11: the way into a game on the DigiDice server (hosted design 12, D17): New game offers "Play on the DigiDice server" when the local server says a
 * hosted server is configured (`hostedUrl` of GET /api/status), and the button opens the hosted screen. Otherwise (owner, 2026-10-22) the button is shown
 * switched off with a diagonal "Coming soon" ribbon, and nothing is opened.
 */
import { act as reactAct, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../../src/app/nav';
import { NewGameScreen } from '../../src/game/NewGameScreen';
import type { GameServices } from '../../src/game/services';
import { hostedServerUrl, resetHostedServerUrl } from '../../src/hosted/config';
import { SettingsStore } from '../../src/settings/settings';
import { memoryStorage } from '../game-fixtures';
import { stubFetch } from '../helpers';

const services: GameServices = {
  listDecks: async () => [],
  validateDeck: async () => null,
  compileDefs: async () => ({ defs: {}, failed: [], compilerVersion: 'test' }),
  newSeed: () => 'seed',
};

const STATUS = { app: { name: 'OpenMTG', version: '1.0.0' }, compilerVersion: 'x', cardData: null, rulesPack: null, coverage: null };

function Shell({ hostedServer }: { hostedServer?: string | null }) {
  const { route } = useNav();
  if (route.screen === 'newGame') {
    return <NewGameScreen services={services} settings={new SettingsStore(memoryStorage())} {...(hostedServer !== undefined ? { hostedServer } : {})} />;
  }
  return <p data-testid="route">{route.screen}</p>;
}

async function open(hostedServer?: string | null) {
  render(
    <NavProvider initial={{ screen: 'newGame' }}>
      <Shell {...(hostedServer !== undefined ? { hostedServer } : {})} />
    </NavProvider>,
  );
  await screen.findByRole('navigation', { name: 'Play online' });
}

beforeEach(() => resetHostedServerUrl());
afterEach(() => {
  vi.unstubAllGlobals();
  resetHostedServerUrl();
});

describe('New game', () => {
  it('offers the hosted server beside the two online buttons when one is configured, and the button opens the hosted screen', async () => {
    await open('ws://127.0.0.1:47700');
    const nav = screen.getByRole('navigation', { name: 'Play online' });
    expect(nav.textContent).toContain('Host an online game');
    expect(nav.textContent).toContain('Join an online game');
    await reactAct(async () => void fireEvent.click(screen.getByRole('button', { name: 'Play on the DigiDice server' })));
    expect(screen.getByTestId('route').textContent).toBe('hosted');
  });

  it('shows it switched off with a Coming soon ribbon when none is configured; pressing it opens nothing', async () => {
    await open(null);
    expect(screen.queryByRole('button', { name: 'Play on the DigiDice server' })).toBeNull();
    const soon = screen.getByRole('button', { name: 'Play on the DigiDice server (coming soon)' }) as HTMLButtonElement;
    expect(soon.disabled).toBe(true);
    expect(soon.querySelector('.coming-soon-ribbon')?.textContent).toBe('Coming soon');
    await reactAct(async () => void fireEvent.click(soon));
    expect(screen.queryByTestId('route')).toBeNull();
    expect(screen.getByRole('button', { name: 'Host an online game' })).toBeTruthy();
  });

  it('asks the local server once: the button comes with `hostedUrl` of /api/status, and not without it', async () => {
    const fetchMock = stubFetch((url) => (url.endsWith('/api/status') ? { status: 200, body: { ...STATUS, hostedUrl: 'wss://play.example.net' } } : { status: 404, body: { error: 'no' } }));
    await open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play on the DigiDice server' })).toBeTruthy());
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/status'))).toHaveLength(1);
    // another screen in the same page does not ask again
    expect(await hostedServerUrl()).toBe('wss://play.example.net');
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/status'))).toHaveLength(1);
  });

  it('a local server without one gives only the Coming soon button', async () => {
    stubFetch(() => ({ status: 200, body: STATUS }));
    await open();
    await reactAct(async () => {
      await hostedServerUrl();
    });
    expect(screen.queryByRole('button', { name: 'Play on the DigiDice server' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Play on the DigiDice server (coming soon)' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await hostedServerUrl()).toBeNull();
  });

  it('a status that cannot be read gives no working button, and the next screen asks again', async () => {
    const fetchMock = stubFetch(() => ({ status: 500, body: { error: 'broken' } }));
    expect(await hostedServerUrl()).toBeNull();
    expect(await hostedServerUrl()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stubFetch(() => ({ status: 200, body: { ...STATUS, hostedUrl: 'ws://127.0.0.1:1' } }));
    expect(await hostedServerUrl()).toBe('ws://127.0.0.1:1');
  });
});
