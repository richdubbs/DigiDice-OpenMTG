/**
 * RPL-1 (replays design 10): the Replays screen lists every replay with its date, players, format, mode, result, length and badges; filters by format,
 * opponent and result and sorts by date; and watches, renames, keeps, exports, imports (file picker and drag and drop) and deletes replays. Watch goes
 * through the playback adapter (openReplay.ts), mocked here (test/replays/open-replay.test.ts opens real replays through it).
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReplayFile } from '@openmtg/engine';
import { useEffect } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { NavProvider, useNav, type Route } from '../../src/app/nav';
import type { GameConnection } from '../../src/connection/GameConnection';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { encodeReplay } from '../../src/replays/library';
import { GameRecorder } from '../../src/replays/recorder';
import { ReplaysScreen, filterReplays, NO_FILTERS } from '../../src/replays/ReplaysScreen';
import { duel, playUntil, settle, testEnv } from './helpers';

const opened = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../src/replays/openReplay', () => ({
  openReplay: opened.fn,
}));

/** The notice openReplay gives for a replay with nothing this client can show. */
const UNWATCHABLE = 'This replay cannot be watched: This replay holds nothing this version of OpenMTG can show.';

let base: ReplayFile;
beforeAll(async () => {
  const env = testEnv();
  const conn = new LocalConnection(duel('rpl1-screen'));
  const rec = GameRecorder.start(conn, { format: 'standard' }, env);
  await playUntil(conn, () => conn.session.actions.length >= 14);
  const read = await env.library.read((await rec.finish())!.key);
  if (!read.ok) throw new Error(read.error.message);
  base = read.value;
}, 60_000);

afterEach(() => {
  opened.fn.mockReset();
  vi.unstubAllGlobals();
});

/** A copy of the sample replay with other facts. */
function variant(id: string, patch: { title: string; day: number; format: string; mode?: ReplayFile['game']['mode']; savedBy?: string | null; names?: [string, string]; winner?: string | null; ended?: ReplayFile['game']['ended']; turns?: number; actions?: number; kind?: 'computer' }): ReplayFile {
  const at = new Date(Date.UTC(2026, 9, patch.day, 12, 0)).toISOString();
  const end = new Date(Date.UTC(2026, 9, patch.day, 12, 23)).toISOString();
  const [a, b] = patch.names ?? ['Alice', 'Bob'];
  const ended = patch.ended ?? 'finished';
  return {
    ...base,
    id,
    title: patch.title,
    createdAt: at,
    game: {
      ...base.game,
      mode: patch.mode ?? 'hotseat',
      format: patch.format,
      players: [
        { id: 'p1', name: a, kind: 'person' },
        { id: 'p2', name: b, kind: patch.kind === 'computer' ? 'computer' : 'person' },
      ],
      savedBy: patch.savedBy === undefined ? null : patch.savedBy,
      ended,
      result: ended === 'abandoned' ? null : { winner: patch.winner === undefined ? 'p1' : patch.winner, reason: 'Bob has 0 or less life' },
      turns: patch.turns ?? 14,
      actions: patch.actions ?? 92,
      startedAt: at,
      endedAt: end,
    },
  };
}

async function seeded() {
  const env = testEnv();
  await env.library.add(variant('r-a', { title: 'Alice vs Bob, Standard', day: 18, format: 'standard', turns: 14 }));
  await env.library.add(variant('r-b', { title: 'Alice vs Computer, Modern', day: 19, format: 'modern', mode: 'computer', savedBy: 'p1', names: ['Alice', 'Computer'], kind: 'computer', winner: 'p2', turns: 9 }));
  await env.library.add(variant('r-c', { title: 'Carol vs Dan, Standard', day: 20, format: 'standard', names: ['Carol', 'Dan'], ended: 'abandoned', turns: 6, actions: 40 }));
  await env.library.add(variant('r-d', { title: 'Alice vs Computer, Standard', day: 21, format: 'standard', mode: 'computer', savedBy: 'p1', names: ['Alice', 'Computer'], kind: 'computer', winner: 'p1', turns: 11 }));
  return env;
}

/** The screen in a navigation, with the current route readable. */
function renderScreen(env: ReturnType<typeof testEnv>, build: string | null = 'test-engine-build') {
  const routes: Route[] = [];
  function Probe() {
    const { route } = useNav();
    useEffect(() => {
      routes.push(route);
    }, [route]);
    return route.screen === 'replays' ? <ReplaysScreen env={env} build={build} /> : <p>{route.screen} screen</p>;
  }
  render(
    <NavProvider initial={{ screen: 'replays' }}>
      <Probe />
    </NavProvider>,
  );
  return routes;
}

const rows = () => within(screen.getByRole('list', { name: 'Your replays' })).getAllByRole('listitem').filter((li) => li.classList.contains('replays-row'));
const titles = () => rows().map((r) => within(r).getByRole('heading').textContent);
const row = (title: string) => screen.getByRole('listitem', { name: title });
const fact = (r: HTMLElement, term: string) => within(r).getByText(term).nextElementSibling!.textContent;

describe('RPL-1: the Replays screen lists the library (design 10)', () => {
  it('shows each replay with its date, players, format, mode, result, length and badges, newest first', async () => {
    const env = await seeded();
    renderScreen(env);
    await screen.findByRole('list', { name: 'Your replays' });
    expect(screen.getByRole('heading', { level: 1, name: 'Replays' })).toBeTruthy();
    expect(screen.getByText('4 replays')).toBeTruthy();
    expect(titles()).toEqual(['Alice vs Computer, Standard', 'Carol vs Dan, Standard', 'Alice vs Computer, Modern', 'Alice vs Bob, Standard']);
    const a = row('Alice vs Bob, Standard');
    expect(fact(a, 'Date')).toMatch(/^2026-10-18 \d\d:\d\d$/);
    expect(fact(a, 'Players')).toBe('Alice vs Bob');
    expect(fact(a, 'Format')).toBe('Standard');
    expect(fact(a, 'Mode')).toBe('Hot-seat');
    expect(fact(a, 'Result')).toBe('Alice won on turn 14');
    expect(fact(a, 'Length')).toBe('14 turns · 92 actions · 23 min');
    expect(within(within(a).getByRole('list', { name: 'Badges' })).getAllByRole('listitem').map((b) => b.textContent)).toEqual(['Game', 'Exact']);
    const b = row('Alice vs Computer, Modern');
    expect(fact(b, 'Players')).toBe('Alice vs Computer (computer)');
    expect(fact(b, 'Mode')).toBe('Against the computer');
    expect(fact(b, 'Result')).toBe('Computer won on turn 9');
    expect(fact(row('Carol vs Dan, Standard'), 'Result')).toBe('Abandoned on turn 6');
  });

  it('a replay saved by another build is "Checked when watched" (design 5.3)', async () => {
    const env = await seeded();
    renderScreen(env, 'another-build');
    await screen.findByRole('list', { name: 'Your replays' });
    expect(within(row('Alice vs Bob, Standard')).getByText('Checked when watched')).toBeTruthy();
  });

  it('with no replays it says that every game is kept', async () => {
    renderScreen(testEnv());
    expect(await screen.findByText(/No replays yet/)).toBeTruthy();
  });

  it('the Replays tab of the top bar opens it', async () => {
    render(<App initial={{ screen: 'about' }} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Replays' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Replays' }, { timeout: 15000 })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Replays', current: 'page' })).toBeTruthy();
  }, 20000);
});

describe('RPL-1: filters and sort (design 10: by format, opponent and result; by date)', () => {
  it('filters by format, by opponent and by result, and sorts oldest first', async () => {
    const env = await seeded();
    renderScreen(env);
    await screen.findByRole('list', { name: 'Your replays' });
    const select = (name: string) => screen.getByRole('combobox', { name });
    fireEvent.change(select('Format'), { target: { value: 'modern' } });
    expect(titles()).toEqual(['Alice vs Computer, Modern']);
    fireEvent.change(select('Format'), { target: { value: '' } });
    expect(within(select('Opponent')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Anyone', 'Alice', 'Bob', 'Carol', 'Computer', 'Dan']);
    fireEvent.change(select('Opponent'), { target: { value: 'Computer' } });
    expect(titles()).toEqual(['Alice vs Computer, Standard', 'Alice vs Computer, Modern']);
    fireEvent.change(select('Result'), { target: { value: 'won' } });
    expect(titles()).toEqual(['Alice vs Computer, Standard']);
    fireEvent.change(select('Result'), { target: { value: 'lost' } });
    expect(titles()).toEqual(['Alice vs Computer, Modern']);
    fireEvent.change(select('Opponent'), { target: { value: '' } });
    fireEvent.change(select('Result'), { target: { value: 'abandoned' } });
    expect(titles()).toEqual(['Carol vs Dan, Standard']);
    fireEvent.change(select('Result'), { target: { value: 'draw' } });
    expect(screen.getByText('No replay matches these filters.')).toBeTruthy();
    fireEvent.change(select('Result'), { target: { value: 'any' } });
    fireEvent.change(select('Sort'), { target: { value: 'oldest' } });
    expect(titles()).toEqual(['Alice vs Bob, Standard', 'Alice vs Computer, Modern', 'Carol vs Dan, Standard', 'Alice vs Computer, Standard']);
  });

  it('filterReplays is the same rule, pure', async () => {
    const env = await seeded();
    const all = await env.library.list();
    expect(filterReplays(all, { ...NO_FILTERS, format: 'standard', result: 'won' }).map((e) => e.key)).toEqual(['r-d']);
  });
});

describe('RPL-1: the actions of a replay', () => {
  it('Watch opens the game screen with the connection the playback adapter made', async () => {
    const env = await seeded();
    const connection = { kind: 'replay' } as unknown as GameConnection;
    opened.fn.mockResolvedValue({ connection, notice: null });
    const routes = renderScreen(env);
    await screen.findByRole('list', { name: 'Your replays' });
    fireEvent.click(within(row('Alice vs Bob, Standard')).getByRole('button', { name: 'Watch' }));
    await waitFor(() => expect(routes[routes.length - 1]).toEqual({ screen: 'game', connection }));
    expect((opened.fn.mock.calls[0]![0] as ReplayFile).id).toBe('r-a');
  });

  it('Watch says why when the replay cannot be watched', async () => {
    const env = await seeded();
    opened.fn.mockResolvedValue({ connection: null, notice: UNWATCHABLE });
    renderScreen(env);
    await screen.findByRole('list', { name: 'Your replays' });
    fireEvent.click(within(row('Alice vs Bob, Standard')).getByRole('button', { name: 'Watch' }));
    expect((await screen.findByRole('alert')).textContent).toBe(UNWATCHABLE);
  });

  it('Rename, Keep and Delete change the library', async () => {
    const env = await seeded();
    renderScreen(env);
    await screen.findByRole('list', { name: 'Your replays' });
    fireEvent.click(within(row('Alice vs Bob, Standard')).getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New title' }), { target: { value: 'The comeback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    expect(await screen.findByRole('listitem', { name: 'The comeback' })).toBeTruthy();
    const read = await env.library.read('r-a');
    expect(read.ok && read.value.title).toBe('The comeback');

    const keep = within(row('The comeback')).getByRole('button', { name: 'Keep' });
    expect(keep.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(keep);
    await waitFor(() => expect(within(row('The comeback')).getByRole('button', { name: 'Keep' }).getAttribute('aria-pressed')).toBe('true'));
    expect(within(row('The comeback')).getByText('Kept')).toBeTruthy();
    expect((await env.library.entry('r-a'))!.keep).toBe(true);

    fireEvent.click(within(row('Carol vs Dan, Standard')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete replay' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Carol vs Dan, Standard' })).toBeNull());
    expect(await env.library.entry('r-c')).toBeUndefined();
  });

  it('Export saves the stored file as a .openmtg-replay', async () => {
    const env = await seeded();
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push(b), 'blob:fake/1'), revokeObjectURL: () => {} }));
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    renderScreen(env);
    await screen.findByRole('list', { name: 'Your replays' });
    fireEvent.click(within(row('Alice vs Bob, Standard')).getByRole('button', { name: 'Export' }));
    await screen.findByText('Exported “Alice vs Bob, Standard”.');
    expect(names).toEqual(['Alice vs Bob, Standard.openmtg-replay']);
    const saved = await new Promise<ArrayBuffer>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.readAsArrayBuffer(blobs[0]!);
    });
    expect(Array.from(new Uint8Array(saved))).toEqual(Array.from((await env.library.bytes('r-a'))!));
    click.mockRestore();
  });
});

describe('RPL-1: Import by the file picker and by drag and drop (design 10)', () => {
  it('imports a replay file chosen in the picker, and refuses one that is not a replay with the reason', async () => {
    const env = testEnv();
    renderScreen(env);
    await screen.findByText(/No replays yet/);
    const input = screen.getByLabelText('Import replay files') as HTMLInputElement;
    const good = new File([(await encodeReplay(variant('r-new', { title: 'Imported game', day: 3, format: 'pioneer' }))) as BlobPart], 'game.openmtg-replay');
    reactAct(() => {
      fireEvent.change(input, { target: { files: [good] } });
    });
    expect(await screen.findByRole('listitem', { name: 'Imported game' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Imported “Imported game”.');
    const bad = new File(['{"not":"a replay"}'], 'notes.openmtg-replay');
    reactAct(() => {
      fireEvent.change(input, { target: { files: [bad] } });
    });
    expect((await screen.findByRole('alert')).textContent).toBe('“notes.openmtg-replay” was not imported: This is not an OpenMTG replay.');
    expect(rows()).toHaveLength(1);
  });

  it('imports files dropped on the screen, and refuses an oversized one', async () => {
    const env = testEnv();
    renderScreen(env);
    await screen.findByText(/No replays yet/);
    const target = document.querySelector('.replays-screen')!;
    const good = new File([(await encodeReplay(variant('r-drop', { title: 'Dropped game', day: 4, format: 'standard' }))) as BlobPart], 'dropped.openmtg-replay');
    const huge = { name: 'huge.openmtg-replay', size: 9 * 1024 * 1024, arrayBuffer: vi.fn() } as unknown as File;
    fireEvent.dragOver(target, { dataTransfer: { types: ['Files'], files: [] } });
    expect(target.classList.contains('replays-dragging')).toBe(true);
    fireEvent.drop(target, { dataTransfer: { types: ['Files'], files: [good, huge] } });
    expect(await screen.findByRole('listitem', { name: 'Dropped game' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toMatch(/“huge\.openmtg-replay” was not imported: at 9\.0 MB it is larger than a replay can be/);
    expect(target.classList.contains('replays-dragging')).toBe(false);
    await settle();
  });
});
