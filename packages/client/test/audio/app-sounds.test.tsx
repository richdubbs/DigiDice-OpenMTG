/**
 * The sounds of the app's own screens (not the game): the deckbuilder's deck.add / deck.remove and the format check's deck.legal / deck.illegal, the
 * deck library's dialog, delete and import, the export panel, the Update panel's outcome, and the online link's net.* sounds. The page engine with the
 * delegated interface sounds installed (as main.tsx does); recordSounds() sees what would play.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UpdateJob, ValidateResponse } from '@openmtg/server/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../../src/app/nav';
import { recordSounds, resetSoundEngineForTests, soundEngine, type SoundRecording } from '../../src/audio/sfx';
import { installUiSounds } from '../../src/audio/uiSounds';
import { DecksProvider } from '../../src/decks/context';
import { DeckbuilderScreen } from '../../src/decks/DeckbuilderScreen';
import { DecksScreen } from '../../src/decks/DecksScreen';
import type { Deck } from '../../src/decks/model';
import { MemoryDeckStore } from '../../src/decks/store';
import { OnlineGamePanel } from '../../src/online/OnlineGamePanel';
import { watchLinkSounds } from '../../src/online/sounds';
import { finishedSound } from '../../src/screens/UpdatePanel';
import { deckFixture, fakeServer } from '../decks-fixtures';
import { IDLE, fakeLink, flush } from '../online-fakes';

let rec: SoundRecording;
let uninstall: () => void;

beforeEach(() => {
  resetSoundEngineForTests();
  uninstall = installUiSounds(document, soundEngine());
  rec = recordSounds();
});

afterEach(() => {
  rec.stop();
  uninstall();
  resetSoundEngineForTests();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => undefined);
async function press(el: HTMLElement) {
  fireEvent.click(el);
  await settle();
}
const NOW = '2026-10-13T12:00:00.000Z';
const LEGAL: ValidateResponse = { format: 'modern', checkedAs: 'modern', valid: true, status: 'legal', problems: [] };
const ILLEGAL: ValidateResponse = {
  format: 'modern', checkedAs: 'modern', valid: false, status: 'illegal',
  problems: [{ kind: 'banned', severity: 'error', message: 'Ancient Grudge is banned in Modern.', card: 'Ancient Grudge', rules: ['CR 100.6'] }],
};

describe('deckbuilder', () => {
  function renderBuilder(validate: (b: { deck: Deck }) => ValidateResponse) {
    fakeServer({ validate });
    const deck = deckFixture();
    render(
      <DecksProvider store={new MemoryDeckStore([deck])}>
        <NavProvider>
          <DeckbuilderScreen deckId={deck.id} now={() => NOW} validateDelayMs={0} autoSearch={false} />
        </NavProvider>
      </DecksProvider>,
    );
  }
  const status = () => screen.getByRole('region', { name: 'Format check' }).textContent ?? '';

  it('+ and − sound deck.add and deck.remove instead of a click', async () => {
    renderBuilder(() => ILLEGAL);
    await screen.findByText('Not legal in Modern: 1 problem.');
    rec.ids.length = 0;
    await press(screen.getByRole('button', { name: 'Add one Grizzly Bears' }));
    await press(screen.getByRole('button', { name: 'Remove one Grizzly Bears' }));
    await press(screen.getByRole('button', { name: 'Remove one Lightning Bolt' }));
    expect(rec.ids).toEqual(['deck.add', 'deck.remove', 'deck.remove']);
  });

  it('the format check sounds when its answer changes (legal, then illegal again), not on the first answer nor when it agrees', async () => {
    renderBuilder(({ deck }) => (deck.sideboard.length ? ILLEGAL : LEGAL));
    await screen.findByText('Not legal in Modern: 1 problem.');
    // Opening a deck that is not legal is not news.
    expect(rec.ids.filter((id) => id.startsWith('deck.'))).toEqual([]);
    await press(screen.getByRole('button', { name: 'Remove one Ancient Grudge' }));
    await waitFor(() => expect(screen.queryByText(/Re-checking/)).toBeNull());
    // Still illegal (one copy left): no new verdict.
    expect(rec.ids).toEqual(['deck.remove']);
    await press(screen.getByRole('button', { name: 'Remove one Ancient Grudge' }));
    await screen.findByText('Legal in Modern.');
    await waitFor(() => expect(rec.ids).toEqual(['deck.remove', 'deck.remove', 'deck.legal']));
    await press(screen.getByRole('button', { name: 'Add one Mountain' }));
    await waitFor(() => expect(status()).toBe('Format: ModernLegal in Modern.'));
    expect(rec.ids).toEqual(['deck.remove', 'deck.remove', 'deck.legal', 'deck.add']);
    await press(screen.getByRole('button', { name: /Move Mountain to sideboard/ }));
    await screen.findByText('Not legal in Modern: 1 problem.');
    await waitFor(() => expect(rec.ids.slice(-1)).toEqual(['deck.illegal']));
  });

  it('a check that cannot be done sounds ui.error once', async () => {
    renderBuilder(() => {
      throw new Error('server unreachable');
    });
    await screen.findByText('Could not check the deck: server unreachable');
    await press(screen.getByRole('button', { name: 'Add one Mountain' }));
    await waitFor(() => expect(screen.getByText('Could not check the deck: server unreachable')).toBeTruthy());
    await settle();
    expect(rec.ids.filter((id) => id === 'ui.error')).toEqual(['ui.error']);
  });
});

describe('deck library', () => {
  async function renderLibrary(store = new MemoryDeckStore([deckFixture()])) {
    fakeServer({ validate: () => LEGAL });
    render(
      <DecksProvider store={store}>
        <NavProvider initial={{ screen: 'decks' }}>
          <DecksScreen now={() => NOW} />
        </NavProvider>
      </DecksProvider>,
    );
    await waitFor(() => expect(screen.queryByText('Loading decks…')).toBeNull());
    await settle();
    rec.ids.length = 0;
    return store;
  }

  it('the delete confirmation opens with ui.open, its Cancel closes it (ui.close), a confirmed delete sounds ui.delete (not a click first)', async () => {
    const store = await renderLibrary();
    const row = screen.getByRole('listitem', { name: 'Gruul Test' });
    await press(within(row).getByRole('button', { name: 'Delete' }));
    expect(rec.ids).toEqual(['ui.open']);
    await press(within(row).getByRole('button', { name: 'Cancel' }));
    expect(rec.ids).toEqual(['ui.open', 'ui.close']);
    await press(within(row).getByRole('button', { name: 'Delete' }));
    await press(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete deck' }));
    await screen.findByText('Deleted “Gruul Test”.');
    expect(rec.ids).toEqual(['ui.open', 'ui.close', 'ui.open', 'ui.delete']);
    expect(await store.list()).toEqual([]);
  });

  it('Escape closes a dialog with ui.close; an import that is saved ends with ui.success', async () => {
    fakeServer({
      validate: () => LEGAL,
      resolve: () => ({ cards: [{ section: 'main', count: 4, name: 'Grizzly Bears', oracleId: 'oid-grizzly-bears', automation: 'full' }], unknown: [], errors: [], links: [], ignored: 0 }),
    });
    await renderLibrary(new MemoryDeckStore());
    await press(screen.getByRole('button', { name: 'Import' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await settle();
    expect(rec.ids).toEqual(['ui.open', 'ui.close']);
    await press(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByLabelText('Decklist or deck link'), { target: { value: '4 Grizzly Bears' } });
    await press(within(screen.getByRole('region', { name: 'Import a deck' })).getByRole('button', { name: 'Import deck' }));
    await screen.findByText(/Imported “Imported deck”/);
    await waitFor(() => expect(rec.ids).toEqual(['ui.open', 'ui.close', 'ui.open', 'ui.confirm', 'ui.success']));
  });

  it('Copy in the export panel sounds ui.success when copied, ui.error when the browser refuses', async () => {
    await renderLibrary();
    const row = screen.getByRole('listitem', { name: 'Gruul Test' });
    await press(within(row).getByRole('button', { name: 'Export' }));
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await press(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Copied to the clipboard.');
    writeText.mockRejectedValueOnce(new Error('denied'));
    await press(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText(/Could not copy automatically/);
    expect(rec.ids).toEqual(['ui.open', 'ui.success', 'ui.error']);
  });
});

describe('Update panel', () => {
  const job = (over: Partial<UpdateJob>): UpdateJob => ({ id: 1, state: 'done', phase: null, startedAt: NOW, finishedAt: NOW, log: [], ...over }) as UpdateJob;
  const result = (outcome: string) => ({ outcome }) as unknown as NonNullable<UpdateJob['result']>;

  it('an update\'s end sounds its outcome', () => {
    expect(finishedSound(job({ state: 'running' }))).toBeNull();
    expect(finishedSound(job({ result: result('updated') }))).toBe('ui.success');
    expect(finishedSound(job({ result: result('current') }))).toBe('ui.success');
    expect(finishedSound(job({ result: result('partial') }))).toBe('ui.notify');
    expect(finishedSound(job({ result: result('failed') }))).toBe('ui.error');
    expect(finishedSound(job({ state: 'failed', error: 'boom' }))).toBe('ui.error');
  });
});

describe('online link', () => {
  it('net.lost when the socket drops or the other player leaves or drops, net.restored when either comes back; old notices stay silent', async () => {
    const f = fakeLink();
    await f.link.connect();
    f.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'old news' });
    const ids: string[] = [];
    const stop = watchLinkSounds(f.link, { play: (id) => ids.push(id) });
    f.socket().push({ t: 'notice', kind: 'opponentDropped', text: 'The link to the host dropped; reconnecting...' });
    f.socket().push({ t: 'notice', kind: 'opponentBack', text: 'Reconnected to the host.' });
    f.socket().push({ t: 'notice', kind: 'refused', text: 'Refused a connection.' });
    expect(ids).toEqual(['net.lost', 'net.restored']);
    f.socket().drop();
    expect(f.link.linkState()).toBe('lost');
    expect(ids).toEqual(['net.lost', 'net.restored', 'net.lost']);
    // The link opens a new socket after retryMs; the fake opens it and sends the status.
    await waitFor(() => expect(f.link.linkState()).toBe('open'));
    expect(ids).toEqual(['net.lost', 'net.restored', 'net.lost', 'net.restored']);
    f.socket().push({ t: 'notice', kind: 'opponentLeft', text: 'Gus left the game.' });
    // Closed by the page: not a lost link.
    f.link.close();
    expect(ids).toEqual(['net.lost', 'net.restored', 'net.lost', 'net.restored', 'net.lost']);
    stop();
  });

  it('a first connection that fails is not a lost link (the setup screen shows the error)', async () => {
    const f = fakeLink({ auto: false });
    const ids: string[] = [];
    watchLinkSounds(f.link, { play: (id) => ids.push(id) });
    const connecting = f.link.connect().catch(() => undefined);
    await flush();
    f.socket().drop();
    await connecting;
    expect(f.link.linkState()).not.toBe('open');
    expect(ids).toEqual([]);
    f.link.close();
  });

  it('in the game, a chat line from the other player sounds net.chat (not my own lines)', async () => {
    const f = fakeLink({ initial: [{ t: 'status', status: { ...IDLE, role: 'guest', phase: 'playing', me: 'p2', opponent: 'Hana', opponentConnected: true } }] });
    await f.link.connect();
    render(<OnlineGamePanel link={f.link} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chat with Hana/ })); // M12F: the chat opens in an overlay
    rec.ids.length = 0;
    act(() => f.socket().push({ t: 'chat', text: 'good luck' }));
    expect(rec.ids).toEqual(['net.chat']);
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'you too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(flush);
    act(() => f.socket().reply('chat'));
    await act(flush);
    // My line: only the Send button's confirm.
    expect(rec.ids).toEqual(['net.chat', 'ui.confirm']);
  });
});
