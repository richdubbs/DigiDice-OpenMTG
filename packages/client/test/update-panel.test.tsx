/** UPD1: the Update button on About (UpdatePanel): starts POST /api/update, shows the progress it polls from GET /api/update, the result, offline and failures. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UpdateJob, UpdateResult, UpdateStatusResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { UpdatePanel } from '../src/screens/UpdatePanel';
import { stubFetch } from './helpers';

const FAST = { running: 20, coverage: 20 };
const MANIFEST = 'https://packs.example.invalid/openmtg-rules-pack.manifest.json';

const COUNTS_BEFORE = { full: 100, partial: 50, manual: 50, total: 200 };
const COUNTS_AFTER = { full: 102, partial: 50, manual: 49, total: 201 };

function result(over: Partial<UpdateResult> = {}): UpdateResult {
  return {
    outcome: 'updated',
    offline: false,
    cardData: { state: 'refreshed', detail: 'downloaded (Scryfall has newer data)' },
    cardsAdded: 1,
    newCards: ['Upd Test Spark'],
    pack: { state: 'installed', version: '2026.10.13-1', entries: 12, rejected: 1, verified: true },
    templates: { before: 0, after: 3, added: 3 },
    coverage: { before: COUNTS_BEFORE, after: COUNTS_AFTER, afterPending: false },
    delta: { newlyAutomated: 4, lessAutomated: 0, stillManual: 2 },
    needsNewer: { count: 0, names: [] },
    refusedForYourText: 0,
    ...over,
  };
}

function job(over: Partial<UpdateJob> = {}): UpdateJob {
  return { id: 1, state: 'done', phase: null, startedAt: '2026-10-13T10:00:00Z', finishedAt: '2026-10-13T10:01:00Z', log: ['Card data: downloaded'], progress: null, result: result(), ...over };
}

const status = (j: UpdateJob | null, packConfigured = true): UpdateStatusResponse => ({ packConfigured, packUrl: packConfigured ? MANIFEST : null, job: j });

/** A scripted server: POST answers `post`; each GET answers the next entry of `gets` (the last one repeats). */
function server(opts: { gets: UpdateStatusResponse[]; post?: { status: number; body: unknown } }) {
  let i = 0;
  return stubFetch((url, init) => {
    if (url === '/api/update' && init?.method === 'POST') return opts.post ?? { status: 200, body: status(job({ state: 'running', phase: 'cards', finishedAt: null, result: null, log: [] })) };
    if (url === '/api/update') return { status: 200, body: opts.gets[Math.min(i++, opts.gets.length - 1)] };
    return { status: 404, body: { error: 'no' } };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UpdatePanel', () => {
  it('says the rules-pack part is off until a pack URL is set, and offers Check for updates', async () => {
    server({ gets: [status(null, false)] });
    render(<UpdatePanel pollMs={FAST} />);
    expect(await screen.findByText(/Rules-pack updates are off/)).toBeTruthy();
    expect(screen.getByText(/OPENMTG_PACK_URL/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Check for updates' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not show the pack-off note when a pack URL is configured', async () => {
    server({ gets: [status(null, true)] });
    render(<UpdatePanel pollMs={FAST} />);
    await screen.findByRole('button', { name: 'Check for updates' });
    expect(screen.queryByText(/Rules-pack updates are off/)).toBeNull();
  });

  it('starts the update, shows progress while it runs, then the result: cards added, templates added, coverage before and after', async () => {
    const running = (phase: UpdateJob['phase'], line: string) => status(job({ state: 'running', phase, finishedAt: null, result: null, log: [line] }));
    const fetchMock = server({
      gets: [status(null), running('pack', 'Card data: downloaded (Scryfall has newer data)'), running('compile', 'Rules pack 2026.10.13-1 installed'), status(job())],
    });
    const onFinished = vi.fn();
    render(<UpdatePanel onFinished={onFinished} pollMs={{ running: 60, coverage: 60 }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/update', expect.objectContaining({ method: 'POST', body: '{}' }));
    const progress = await screen.findByRole('status');
    expect(within(progress).getByText(/Checking Scryfall for new card data|Getting the rules pack|Compiling/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement).disabled).toBe(true);

    expect(await screen.findByText('Update installed.', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/1 \(Upd Test Spark\)/)).toBeTruthy();
    expect(screen.getByText(/2026\.10\.13-1 installed, checked against its published SHA-256: 12 card entries, 1 refused by the validator/)).toBeTruthy();
    expect(screen.getByText(/3 \(rules-pack templates: 0 before, 3 now\)/)).toBeTruthy();
    expect(screen.getByText('50.0% full, 25.0% partial, 25.0% manual (200 cards)')).toBeTruthy();
    expect(screen.getByText('50.7% full, 24.9% partial, 24.4% manual (201 cards)')).toBeTruthy();
    expect(screen.getByText('4 more automated, 0 less automated, 2 still manual')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('shows how far the summary compile is (a first card download compiles the whole pool: about a minute)', async () => {
    const compiling = status(job({ state: 'running', phase: 'compile', finishedAt: null, result: null, log: ['New cards known: 30000'], progress: { done: 12345, total: 30000 } }));
    server({ gets: [compiling] });
    render(<UpdatePanel pollMs={{ running: 10_000, coverage: 10_000 }} />);
    const progress = await screen.findByRole('status');
    expect(within(progress).getByText(/Compiling the new and changed cards/)).toBeTruthy();
    expect(within(progress).getByText('12,345 of 30,000 cards compiled')).toBeTruthy();
    const bar = within(progress).getByLabelText('Update progress') as HTMLProgressElement;
    expect([bar.value, bar.max]).toEqual([12345, 30000]);
  });

  it('shows "being computed" for the new coverage and reports again once it is ready', async () => {
    const pending = status(job({ result: result({ coverage: { before: COUNTS_BEFORE, after: null, afterPending: true } }) }));
    server({ gets: [status(null), pending, pending, status(job())], post: { status: 200, body: status(job({ state: 'running', phase: 'cards', finishedAt: null, result: null })) } });
    const onFinished = vi.fn();
    render(<UpdatePanel onFinished={onFinished} pollMs={FAST} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(/being computed for the new card data/)).toBeTruthy();
    expect(await screen.findByText('50.7% full, 24.9% partial, 24.4% manual (201 cards)', {}, { timeout: 3000 })).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(2); // the update finished; then its coverage arrived
  });

  it('offline: says nothing could be downloaded and the local data is unchanged', async () => {
    const offline = result({
      outcome: 'failed', offline: true, cardData: { state: 'failed', detail: 'fetch failed' }, cardsAdded: 0, newCards: [],
      pack: { state: 'failed', error: 'cannot download https://packs.example.invalid/x: fetch failed', kept: '2026.10.01-1' },
      templates: { before: 2, after: 2, added: 0 }, coverage: { before: COUNTS_BEFORE, after: COUNTS_BEFORE, afterPending: false },
      delta: { newlyAutomated: 0, lessAutomated: 0, stillManual: 0 },
    });
    server({ gets: [status(null), status(job({ result: offline }))] });
    render(<UpdatePanel pollMs={FAST} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('The update failed: nothing was changed.', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/You seem to be offline: nothing could be downloaded/);
    expect(screen.getByText('Not refreshed: fetch failed. Your local card data is unchanged.')).toBeTruthy();
    expect(screen.getByText(/Not installed: cannot download .*fetch failed \(still using 2026\.10\.01-1\)\./)).toBeTruthy();
  });

  it('a partial update names the part that failed', async () => {
    const partial = result({ outcome: 'partial', pack: { state: 'failed', error: "the pack's SHA-256 is abc; the manifest says def: download damaged or tampered with, not installed", kept: null } });
    server({ gets: [status(null), status(job({ result: partial }))] });
    render(<UpdatePanel pollMs={FAST} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(/Update partly installed/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/Not installed: the pack's SHA-256 is abc/)).toBeTruthy();
  });

  it('cards that need a newer OpenMTG are listed', async () => {
    server({ gets: [status(job({ result: result({ needsNewer: { count: 2, names: ['Card A', 'Card B'] } }) }))] });
    render(<UpdatePanel pollMs={FAST} />);
    expect(await screen.findByText(/2 card\(s\) need a newer OpenMTG and play with manual resolution until then \(Card A, Card B\)/)).toBeTruthy();
  });

  it('an update already running (409) is followed instead of started twice', async () => {
    const fetchMock = server({
      gets: [status(null), status(job({ state: 'running', phase: 'pack', finishedAt: null, result: null, log: ['Card data: already current'] }))],
      post: { status: 409, body: { error: 'An update is already running.', code: 'updateRunning' } },
    });
    render(<UpdatePanel pollMs={FAST} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    const progress = await screen.findByRole('status');
    expect(within(progress).getByText('Getting the rules pack…')).toBeTruthy();
    expect(within(progress).getByText('Card data: already current')).toBeTruthy();
    expect(screen.queryByText(/Could not start the update/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('a server error when starting is shown', async () => {
    server({ gets: [status(null)], post: { status: 500, body: { error: 'Internal server error' } } });
    render(<UpdatePanel pollMs={FAST} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not start the update: Internal server error');
  });

  it('a crashed update says so and that the local data is unchanged', async () => {
    server({ gets: [status(job({ state: 'failed', result: null, error: 'disk full', log: ['Update failed: disk full'] }))] });
    render(<UpdatePanel pollMs={FAST} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/The update stopped with an error: disk full\. Your local data is unchanged\./);
  });

  it('a server without the update endpoints: the panel says so and points to the CLI', async () => {
    stubFetch(() => ({ status: 404, body: { error: 'No API endpoint /api/update' } }));
    render(<UpdatePanel pollMs={FAST} />);
    expect(await screen.findByText(/The local server cannot run updates right now \(No API endpoint \/api\/update\)\. From a terminal: npm run cards -- update/)).toBeTruthy();
  });

  it('is on the About screen, and About reloads the status after an update', async () => {
    let statusCalls = 0;
    const base = { app: { name: 'OpenMTG', version: '0.0.0' }, compilerVersion: 'c', cardData: null, coverage: null };
    let updates = 0;
    stubFetch((url, init) => {
      if (url === '/api/status') return { status: 200, body: { ...base, rulesPack: statusCalls++ === 0 ? null : '2026.10.13-1' } };
      if (url === '/api/update' && init?.method === 'POST') return { status: 200, body: status(job({ state: 'running', phase: 'cards', finishedAt: null, result: null })) };
      return { status: 200, body: updates++ === 0 ? status(null) : status(job()) };
    });
    render(<App initial={{ screen: 'about' }} />);
    const card = screen.getByRole('region', { name: 'Card data' });
    expect(await within(card).findByText('None installed')).toBeTruthy();
    fireEvent.click(await within(card).findByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(within(card).getAllByText(/2026\.10\.13-1/).length).toBeGreaterThan(0), { timeout: 5000 });
    expect(await within(card).findByText('2026.10.13-1', {}, { timeout: 5000 })).toBeTruthy(); // the Rules pack line of the status
  }, 20000);
});
