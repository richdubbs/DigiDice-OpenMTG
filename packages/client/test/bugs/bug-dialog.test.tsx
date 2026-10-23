/**
 * RPL-4 (replays design 11, 5.2): "Report a bug" on the game screen. The game menu offers it during a game and while a replay is watched, the end
 * screen offers it, and a replay that plays differently on the build it was made on offers it in its rail. The dialog asks what happened and which
 * card, says what the report holds, and saves the report as a file; nothing is sent. While it is open the game's keys do nothing, and the React tree
 * holds no game file (FXH, CR 400.2); the card names it offers are those of the view on screen.
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readBugReportFile, type BugReportFile, type ReplayFile } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameConnection } from '../../src/connection/GameConnection';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { sealConnection } from '../../src/game/sealed';
import { openReplay } from '../../src/replays/openReplay';
import { recordLocalGame } from '../../src/replays/record';
import { replayControllerOf } from '../../src/replays/viewer/controllerOf';
import { hotSeatConfig, renderGameApp } from '../game-fixtures';
import { playedGame, replayFileOf, TEST_BUILD } from '../connection/replay-files';
import { playUntil, settle, testEnv } from '../replays/helpers';

const saved = vi.hoisted(() => ({ files: [] as { name: string; bytes: Uint8Array }[], can: true }));
vi.mock('../../src/bugs/download', () => ({
  saveBytes: (name: string, bytes: Uint8Array) => {
    if (!saved.can) return false;
    saved.files.push({ name, bytes });
    return true;
  },
}));

afterEach(() => {
  saved.files.length = 0;
  saved.can = true;
});

/** A recorded hot-seat game on the game screen, its route holding the sealed connection, as the New game screen does; Alice's cover clicked through. */
function hotSeat(seed: string, startingLife = 20): LocalConnection {
  const conn = recordLocalGame(new LocalConnection({ ...hotSeatConfig(seed), options: { startingLife, skipMulligans: true, startingPlayer: 'p1' } }), { format: 'casual' }, testEnv());
  render(renderGameApp(sealConnection(conn)));
  fireEvent.click(screen.getByRole('button', { name: 'I am Alice: continue' }));
  return conn;
}

const dialog = () => screen.getByRole('dialog', { name: 'Report a bug' });
const words = () => within(dialog()).getByRole('textbox', { name: 'What happened, and what did you expect?' }) as HTMLTextAreaElement;
const saveButton = () => within(dialog()).getByRole('button', { name: /^Save/ }) as HTMLButtonElement;

function openFromMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Game menu' })).getByRole('button', { name: 'Report a bug' }));
}

async function saveWith(text: string, card?: string): Promise<BugReportFile> {
  fireEvent.change(words(), { target: { value: text } });
  if (card !== undefined) fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Which card? (optional)' }), { target: { value: card } });
  await reactAct(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(within(dialog()).getByRole('status').textContent).toMatch(/^Saved as openmtg-bug-\d{4}-\d{2}-\d{2}-\d{4}\.openmtg-bug-report\. Nothing was sent\.$/));
  const last = saved.files[saved.files.length - 1]!;
  const read = await readBugReportFile(last.bytes);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

describe('RPL-4: Report a bug during a game (the game menu)', () => {
  it('opens the dialog with the focus in the words; Save waits for them; the report holds the game so far, the words and the card', async () => {
    const conn = hotSeat('rpl4-dialog');
    // a few actions of the game first
    for (let i = 0; i < 3; i++) {
      await reactAct(async () => {
        await conn.act({ type: 'pass', player: conn.view().pending!.player });
      });
      if (conn.handoff()) fireEvent.click(screen.getByRole('button', { name: /^I am / }));
    }
    openFromMenu();
    const d = dialog();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(words());
    expect(within(d).getByText(/^Nothing is sent anywhere: the report is saved as a file on this computer\./)).toBeTruthy();
    expect(within(d).getByText(/^The game so far, so it can be played again exactly to this moment/)).toBeTruthy();
    expect(within(d).getByText(/It holds every player's cards, hidden ones too\./)).toBeTruthy();
    expect(within(d).getByText(`The moment reported: turn ${conn.view().turn.number}, after action ${conn.session.actions.length}.`)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(words(), { target: { value: '   ' } });
    expect(saveButton().disabled).toBe(true);
    const report = await saveWith('The Raider did not attack.\nI clicked it twice.', 'Test Raider');
    expect(report.replay.kind).toBe('game');
    expect(report.replay.play!.actions).toEqual(JSON.parse(JSON.stringify(conn.session.actions)));
    expect(report.at.action).toBe(conn.session.actions.length - 1);
    expect(report.words).toBe('The Raider did not attack.\nI clicked it twice.');
    expect(report.card).toBe('Test Raider');
    expect(report.app).toEqual({ version: '0.0.0-test', commit: 'testcommit' });
    expect(report.settings['animationSpeed']).toBe('normal');
    expect(saved.files[0]!.name).toMatch(/\.openmtg-bug-report$/);
    // Close: the dialog goes and the focus returns to the Menu button
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Report a bug' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Menu/ }));
  });

  it('offers the card names of the view on screen only: nothing of the other player\'s hidden hand or library', () => {
    hotSeat('rpl4-names');
    openFromMenu();
    const options = [...dialog().querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);
    // Alice sees her own hand (Mountains, Test Shocks, Test Raiders); Bob's Forests and Bears are in his hand and library.
    expect(options.length).toBeGreaterThan(0);
    expect(options).not.toContain('Test Bear');
    expect(options).not.toContain('Forest');
  });

  it('while it is open the game\'s keys do nothing: Space, Z and H typed or pressed on its buttons; Esc closes it and cancels nothing', async () => {
    const conn = hotSeat('rpl4-keys');
    // Alice plays a land first: Z would take it back (an undoable action of the player on screen).
    const land = conn.legalActions().find((a) => a.action.type === 'playLand');
    await reactAct(async () => {
      expect((await conn.act(land!.action)).ok).toBe(true);
    });
    expect(conn.canUndo()).toBe(true);
    openFromMenu();
    const log = JSON.stringify(conn.session.actions);
    const unchanged = async (what: string) => {
      await settle();
      expect(JSON.stringify(conn.session.actions), what).toBe(log);
      expect(conn.session.state.players[0]!.stops.holdPriority === true, what).toBe(false);
      expect(dialog(), what).toBeTruthy();
    };
    for (const key of [' ', 'z', 'h', 'Enter']) {
      fireEvent.keyDown(words(), { key });
      await unchanged(`${key} in the text`);
    }
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    for (const key of [' ', 'z', 'Z', 'h', 'H', 'ArrowLeft']) {
      // after a click on the button (Space then means the prompt's OK in a game, prompts/keys.tsx)
      fireEvent.pointerDown(cancel);
      cancel.focus();
      fireEvent.keyDown(cancel, { key });
      await unchanged(`${key} on a button`);
    }
    // Tab and Shift+Tab stay in the dialog: from its last control to its first, and back
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(words());
    fireEvent.keyDown(words(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Report a bug' })).toBeNull();
    // Esc closed the dialog only: nothing was cancelled or undone
    expect(JSON.stringify(conn.session.actions)).toBe(log);
  });

  it('holds no game file in the React tree while it is open: no config, seed or action log (FXH, CR 400.2)', async () => {
    const conn = hotSeat('rpl4-tree');
    await reactAct(async () => {
      await conn.act({ type: 'pass', player: 'p1' });
    });
    if (conn.handoff()) fireEvent.click(screen.getByRole('button', { name: /^I am / }));
    openFromMenu();
    fireEvent.change(words(), { target: { value: 'typed' } });
    const seed = conn.session.config.seed;
    const hit = treeHolds((o) => ('seed' in o && 'players' in o && 'defs' in o) || ('play' in o && o['format'] === 'openmtg-replay') || ('actions' in o && 'config' in o) || Object.values(o).includes(seed));
    expect(hit).toBeNull();
  });

  it('says so when this browser cannot save files', async () => {
    hotSeat('rpl4-nosave');
    saved.can = false;
    openFromMenu();
    fireEvent.change(words(), { target: { value: 'x' } });
    await reactAct(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(within(dialog()).getByRole('alert').textContent).toBe('This browser cannot save files.'));
  });

  it('an online game (a remote connection): the report holds what the screen shows, a recording of the player\'s view', async () => {
    const local = new LocalConnection({ ...hotSeatConfig('rpl4-online'), options: { startingLife: 20, skipMulligans: true, startingPlayer: 'p1' } });
    local.acceptHandoff();
    const remote: GameConnection = { ...local, kind: 'remote', handoff: () => null, acceptHandoff: () => {}, canUndo: () => false, undo: () => false };
    delete (remote as { seated?: unknown }).seated;
    render(renderGameApp(remote));
    openFromMenu();
    expect(within(dialog()).getByText(/^What this screen shows of the game now: the view, its log and the last change\. Nothing that is hidden from this screen\./)).toBeTruthy();
    const report = await saveWith('Lag.');
    expect(report.replay.kind).toBe('recording');
    expect(report.replay.play).toBeUndefined();
    expect(report.replay.recording!.viewer).toBe('p1');
    expect(report.replay.game.mode).toBe('onlineGuest');
    expect(JSON.stringify(report)).not.toContain(local.session.config.seed);
  });
});

describe('RPL-4: Report a bug on the end screen', () => {
  it('the game-over panel has "Report a bug": the report holds the finished game at its last action', async () => {
    const env = testEnv();
    const conn = recordLocalGame(new LocalConnection({ ...hotSeatConfig('rpl4-end', 4), options: { startingLife: 4, skipMulligans: true, startingPlayer: 'p1' } }), { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    expect(conn.session.state.result).not.toBeNull();
    render(renderGameApp(sealConnection(conn)));
    const over = screen.getByRole('region', { name: 'Game over' });
    fireEvent.click(within(over).getByRole('button', { name: 'Report a bug' }));
    const report = await saveWith('The game ended too soon.');
    expect(report.replay.game.ended).not.toBe('abandoned');
    expect(report.replay.game.result).not.toBeNull();
    expect(report.replay.play!.actions).toHaveLength(conn.session.actions.length);
    expect(report.at.action).toBe(conn.session.actions.length - 1);
  });
});

describe('RPL-4: Report a bug while watching a replay', { timeout: 300_000 }, () => {
  let game: ReturnType<typeof playedGame> | null = null;
  const aGame = () => (game ??= playedGame({ ...hotSeatConfig('rpl4-watch', 8), options: { startingLife: 8, skipMulligans: true, startingPlayer: 'p1' } }, 'rpl4-watch', 400));

  async function watching(file: ReplayFile) {
    const opened = await openReplay(file, { engineBuild: TEST_BUILD, sliceMs: 40 });
    const connection = opened.connection!;
    const controller = replayControllerOf(connection)!;
    await reactAct(() => controller.ready());
    render(renderGameApp(connection));
    return { connection, controller };
  }

  it('from the game menu: the report holds the replay as the player has it, at the position on screen; the replay pauses', async () => {
    const file = JSON.parse(JSON.stringify(replayFileOf(aGame()))) as ReplayFile;
    const { controller } = await watching(file);
    await reactAct(async () => {
      controller.seek(9);
    });
    reactAct(() => controller.play());
    expect(controller.state().playing).toBe(true);
    openFromMenu();
    const position = controller.state().position;
    expect(controller.state().playing).toBe(false);
    expect(within(dialog()).getByText('This replay as you have it, and the moment you are watching.')).toBeTruthy();
    const report = await saveWith('The Bear should have died here.');
    expect(report.replay).toEqual(file);
    expect(position).toBeGreaterThanOrEqual(9);
    expect(report.at.action).toBe(position - 1);
    controller.dispose();
  });

  it('a replay that plays differently on the very build it was made on offers "Report this bug" in its rail (design 5.2)', async () => {
    const file = JSON.parse(JSON.stringify(replayFileOf(aGame(), { build: TEST_BUILD }))) as ReplayFile;
    const cps = file.play!.checkpoints;
    cps[2]!.digest = `${cps[2]!.digest.slice(0, -2)}00`;
    const { controller } = await watching(file);
    await waitFor(() => expect(['recordingFrom', 'watchingUpTo']).toContain(controller.state().badge), { timeout: 30_000 });
    const rail = screen.getByRole('region', { name: 'Prompt' });
    fireEvent.click(await within(rail).findByRole('button', { name: 'Report this bug' }));
    const report = await saveWith('Nondeterminism.');
    expect(report.replay.engine.build).toBe(TEST_BUILD);
    controller.dispose();
  });

  it('an exact replay, or one of another build, offers no "Report this bug" in its rail', async () => {
    const { controller } = await watching(JSON.parse(JSON.stringify(replayFileOf(aGame()))) as ReplayFile);
    expect(controller.state().badge).toBe('exact');
    expect(screen.queryByRole('button', { name: 'Report this bug' })).toBeNull();
    controller.dispose();
  });
});

/** The first object any component of the tree holds (props, hooks' state) that `bad` says is game data, as "what in which component". */
function treeHolds(bad: (o: Record<string, unknown>) => boolean): string | null {
  const fibers = new Set<object>();
  for (const el of document.body.querySelectorAll('*')) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? ((el as unknown as Record<string, unknown>)[key] as { return: unknown } | null) : null;
    while (f && !fibers.has(f)) {
      fibers.add(f);
      f = f.return as { return: unknown } | null;
    }
  }
  const scan = (x: unknown, seen: Set<unknown>, depth: number): boolean => {
    if (x === null || typeof x !== 'object' || seen.has(x) || depth > 8) return false;
    seen.add(x);
    if (typeof Node !== 'undefined' && x instanceof Node) return false;
    const o = x as Record<string, unknown>;
    if ('stateNode' in o && 'return' in o) return false;
    if (bad(o)) return true;
    return Object.values(o).some((v) => scan(v, seen, depth + 1));
  };
  for (const f of fibers as Set<{ memoizedProps?: unknown; memoizedState?: unknown; type?: { name?: string } }>) {
    if (scan(f.memoizedProps, new Set(), 0) || scan(f.memoizedState, new Set(), 0)) return typeof f.type === 'function' ? f.type.name : String(f.type);
  }
  return null;
}
