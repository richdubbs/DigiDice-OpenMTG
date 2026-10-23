/**
 * RPL-2 (replays design 8, 9): a replay on the game screen. The replay bar is drawn on the table in place of the prompt's action buttons (the rail
 * keeps its place), with the label, the timeline and the transport; the rail holds the read-only prompt, the perspective picker and the status; there
 * is no undo, no concede and no hot-seat cover. The keys of design 9 drive it, and the speed sets the board's animation time base (design 8's table).
 * The perspective "All cards" (design 6) draws what the open view holds: every hand face up and every library in order.
 */
import { act as reactAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { recordSounds } from '../../../src/audio/sfx';
import { createReplayConnection, type ReplayConnection } from '../../../src/connection/ReplayConnection';
import { gameSoundsMuted } from '../../../src/game/sound';
import type { BoardSlotProps } from '../../../src/game/slots';
import { inlineChecker, type CheckOutcome, type ReplayChecker } from '../../../src/replays/viewer/check';
import { OPEN, seat as seatOf } from '../../../src/replays/viewer/policy';
import { readOnlyPrompt } from '../../../src/replays/viewer/ReplayPrompt';
import { hotSeatConfig, renderGameApp } from '../../game-fixtures';
import { playedGame, replayFileOf, TEST_BUILD, type PlayedGame } from '../../connection/replay-files';

let game: PlayedGame | null = null;
/** A short seeded game of the game screen's fixture decks, both seats played by the AI. */
function aGame(): PlayedGame {
  game ??= playedGame({ ...hotSeatConfig('rpl2-viewer', 8), options: { startingLife: 8, skipMulligans: true, startingPlayer: 'p1' } }, 'rpl2-viewer', 400);
  return game;
}

const opened: ReplayConnection[] = [];
afterEach(() => {
  for (const c of opened.splice(0)) c.controller.dispose();
});

async function open(file = replayFileOf(aGame()), opts: Parameters<typeof createReplayConnection>[1] = {}): Promise<ReplayConnection> {
  const conn = createReplayConnection(file, { engineBuild: TEST_BUILD, ...opts });
  opened.push(conn);
  if (!opts.checker) await reactAct(() => conn.controller.ready());
  return conn;
}

const key = (k: string, init: KeyboardEventInit = {}) => reactAct(() => void fireEvent.keyDown(document.body, { key: k, ...init }));
const bar = () => screen.getByRole('group', { name: 'Replay controls' });

describe('RPL-2: the replay viewer on the game screen (replays design 9)', { timeout: 300_000 }, () => {
  it('draws the replay bar on the table where the action buttons go, and the read-only prompt in the rail; no undo, concede or cover', async () => {
    const g = aGame();
    const conn = await open();
    render(renderGameApp(conn));
    const b = bar();
    // On the table, in the slot of the prompt's action buttons (the rail never moves or resizes).
    expect(b.closest('.table-actions')).not.toBeNull();
    expect(b.closest('.board-side')).toBeNull();
    const rail = screen.getByRole('region', { name: 'Prompt' });
    expect(within(rail).getByLabelText('Replay')).toBeTruthy();
    expect(within(b).getByText(new RegExp(`action 0 of ${g.actions.length}$`))).toBeTruthy();
    for (const name of ['Previous turn', 'Step back', 'Play', 'Step forward', 'Next turn']) expect(within(b).getByRole('button', { name })).toBeTruthy();
    expect(within(b).getByRole('combobox', { name: 'Speed' })).toBeTruthy();
    const slider = within(b).getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-valuetext')).toMatch(/action 0$/);
    expect(slider.getAttribute('max')).toBe(String(g.actions.length));
    // The status, the perspective picker (the person's seat, the public view and all cards: a game against the computer) and the sound toggle.
    expect(within(rail).getByText('Exact')).toBeTruthy();
    const picker = within(rail).getByRole('combobox', { name: 'Whose view' }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Alice', 'Bob', 'Public', 'All cards']);
    expect(within(rail).getByRole('checkbox', { name: 'Mute sound above 4×' })).toBeTruthy();
    // Nothing of a game being played.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Concede' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /^Pass to/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pass/ })).toBeNull();
    // The turn ticks, one at every turn's start.
    expect(b.querySelectorAll('.replay-tick').length).toBe(conn.controller.state().ticks.length);
    expect(conn.controller.state().ticks.length).toBeGreaterThan(2);
  });

  it('its keys work: Space, Left and Right, Shift+Left and Shift+Right, [ and ], Home and End, Esc leaves', async () => {
    const g = aGame();
    const conn = await open();
    render(renderGameApp(conn));
    const c = conn.controller;
    await key('ArrowRight');
    expect(c.state().position).toBe(1);
    expect(within(bar()).getByText(new RegExp(`action 1 of ${g.actions.length}$`))).toBeTruthy();
    await key('ArrowRight');
    await key('ArrowLeft');
    expect(c.state().position).toBe(1);
    await key('ArrowRight', { shiftKey: true });
    const t2 = c.state();
    expect(t2.ticks.some((t) => t.position === t2.position)).toBe(true);
    await key('ArrowRight', { shiftKey: true });
    expect(c.state().turn).toBe(t2.turn + 1);
    await key('ArrowLeft', { shiftKey: true });
    expect(c.state().position).toBe(t2.position);
    await key(']');
    expect(c.state().speed).toBe(2);
    await key(']');
    await key('[');
    await key('[');
    await key('[');
    expect(c.state().speed).toBe(0.5);
    await key('End');
    expect(c.state().position).toBe(g.actions.length);
    await key('Home');
    expect(c.state().position).toBe(0);
    await key(' ');
    expect(c.state().playing).toBe(true);
    expect(within(bar()).getByRole('button', { name: 'Pause' })).toBeTruthy();
    await key(' ');
    expect(c.state().playing).toBe(false);
    // Keys with a modifier, and keys typed into a control, are not the replay's.
    await key('ArrowRight', { ctrlKey: true });
    expect(c.state().position).toBe(0);
    const speed = within(bar()).getByRole('combobox', { name: 'Speed' });
    await reactAct(() => void fireEvent.keyDown(speed, { key: 'ArrowRight' }));
    expect(c.state().position).toBe(0);
    // Esc leaves the replay (back to the screen it was opened from: here the first screen, Home).
    await key('Escape');
    expect(screen.getByTestId('route').textContent).toBe('home');
  });

  it('its buttons and the timeline work, and Leave goes at once', async () => {
    const g = aGame();
    const conn = await open();
    render(renderGameApp(conn));
    const c = conn.controller;
    fireEvent.click(within(bar()).getByRole('button', { name: 'Step forward' }));
    expect(c.state().position).toBe(1);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Next turn' }));
    const p = c.state().position;
    expect(p).toBeGreaterThan(1);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Step back' }));
    expect(c.state().position).toBe(p - 1);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Previous turn' }));
    expect(c.state().position).toBeLessThan(p - 1);
    fireEvent.change(within(bar()).getByRole('slider', { name: 'Timeline' }), { target: { value: String(Math.floor(g.actions.length / 2)) } });
    expect(c.state().position).toBe(Math.floor(g.actions.length / 2));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Play' }));
    expect(c.state().playing).toBe(true);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pause' }));
    expect(c.state().playing).toBe(false);
    fireEvent.change(within(bar()).getByRole('combobox', { name: 'Speed' }), { target: { value: 'real' } });
    expect(c.state().speed).toBe('real');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByTestId('route').textContent).toBe('home');
  });

  it('the perspective picker switches at once to what the policy allows; hot-seat without agreement offers the public view only', async () => {
    const conn = await open();
    render(renderGameApp(conn));
    const rail = screen.getByRole('region', { name: 'Prompt' });
    expect(conn.view().viewer).toBe('p1');
    await reactAct(() => void fireEvent.change(within(rail).getByRole('combobox', { name: 'Whose view' }), { target: { value: 'open' } }));
    expect(conn.view().open).toBe(true);
    await reactAct(() => void fireEvent.change(within(rail).getByRole('combobox', { name: 'Whose view' }), { target: { value: 'public' } }));
    expect(conn.view().viewer).toBeNull();
    expect(conn.view().open).toBeUndefined();
  });

  it('replays design 6: "All cards" draws every hand face up by name and lists each library in order; the seat view hides them again (CR 400.2)', async () => {
    const conn = await open();
    render(renderGameApp(conn));
    const c = conn.controller;
    await reactAct(() => void c.seek(6));
    const seatView = conn.view();
    expect(seatView.viewer).toBe('p1');
    expect(document.querySelectorAll('.hand-back').length).toBe(seatView.zones.hand.p2!.length);
    await reactAct(() => void c.setPerspective(OPEN));
    const v = conn.view();
    expect(v.open).toBe(true);
    const nameOf = (id: string) => v.defs[v.objects[id]!.defId]!.name;
    // Every hand: each of its cards face up under its own name, in the hand of its player; no card back anywhere.
    expect(document.querySelectorAll('.hand-back, .hand-hidden')).toHaveLength(0);
    for (const p of v.players) {
      const ids = v.zones.hand[p.id]!;
      expect(ids.length).toBeGreaterThan(0);
      const hand = screen.getByRole('region', { name: `${p.name}'s hand (${ids.length})` });
      for (const id of ids) {
        const card = hand.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
        expect(card?.getAttribute('data-face'), `${p.name}: ${nameOf(id)}`).toBe('up');
        expect(card?.getAttribute('aria-label')).toBe(nameOf(id));
      }
    }
    // Every library: its zone viewer lists its cards in order, top first, each by name; the pile no longer says "you may look at the top card"
    // (CR 401.5).
    expect(screen.queryByLabelText(/you may look at the top card/)).toBeNull();
    for (const p of v.players) {
      const ids = v.zones.library[p.id]!;
      await reactAct(() => void fireEvent.click(screen.getByRole('button', { name: `${p.name}'s library: ${ids.length} cards` })));
      const dialog = screen.getByRole('dialog', { name: `${p.name}'s library` });
      const listed = [...dialog.querySelectorAll<HTMLElement>('.zone-viewer-cards [data-object-id]')];
      expect(listed.map((el) => el.getAttribute('data-object-id'))).toEqual(ids);
      expect(listed.map((el) => el.getAttribute('aria-label'))).toEqual(ids.map((id) => `${nameOf(id)} (${p.name})`));
      expect(listed.every((el) => el.getAttribute('data-face') === 'up')).toBe(true);
      await reactAct(() => void fireEvent.click(within(dialog).getByRole('button', { name: 'Close' })));
    }
    // Back on Alice's seat: Bob's hand is card backs and the libraries are piles again (CR 400.2).
    await reactAct(() => void c.setPerspective(seatOf('p1')));
    expect(conn.view().viewer).toBe('p1');
    expect(document.querySelectorAll('.hand-back').length).toBe(conn.view().zones.hand.p2!.length);
    expect(document.querySelectorAll('.hand-open')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /library/ })).toBeNull();
  });

  it('CR 400.2: a hot-seat replay without everyone\'s agreement offers only the public view', async () => {
    const conn = await open(replayFileOf(aGame(), { mode: 'hotseat', agreed: ['p1'] }));
    render(renderGameApp(conn));
    const rail = screen.getByRole('region', { name: 'Prompt' });
    const picker = within(rail).getByRole('combobox', { name: 'Whose view' }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Public']);
    // Every decision is someone else's on the public view: the prompt says who decides, never what (as the engine's view redacts it).
    expect(rail.textContent).toMatch(/Waiting for (Alice|Bob)\./);
  });

  it('the read-only prompt names the decision only where the perspective sees it', async () => {
    const conn = await open();
    const c = conn.controller;
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < 40 && c.step(1); i++) {
      const v = conn.view();
      const text = readOnlyPrompt(v);
      if (!v.pending) continue;
      if (v.pending.player === 'p1') {
        mine++;
        expect(text).toBe(`Alice: ${v.pending.prompt}`);
      } else {
        theirs++;
        expect(text).toBe('Waiting for Bob.');
      }
    }
    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBeGreaterThan(0);
  });

  it('the caption names what the change just shown did, from its log lines as the perspective sees them', async () => {
    const conn = await open();
    render(renderGameApp(conn));
    const c = conn.controller;
    let prev = conn.view();
    const captions: string[] = [];
    for (let i = 0; i < 120 && c.state().position < c.state().last; i++) {
      await reactAct(() => void c.step(1));
      const v = conn.view();
      const since = prev.log.length === 0 ? -1 : prev.log[prev.log.length - 1]!.seq;
      const want = v.log.filter((e) => e.seq > since && e.level === 'action').map((e) => e.text).join(' ') || null;
      expect(c.state().caption, `after action ${c.state().position}`).toBe(want);
      if (want !== null) {
        captions.push(want);
        expect(screen.getByRole('region', { name: 'Prompt' }).querySelector('.replay-caption')?.textContent).toBe(want);
      }
      prev = v;
    }
    expect(captions.some((t) => / attacks with /.test(t))).toBe(true);
  });

  it('design 8: the speed sets the board\'s animation time base; above 4x nothing is animated and the game\'s sounds are muted by default', async () => {
    const conn = await open();
    const scales: number[] = [];
    const Board = ({ prompt, animationScale }: BoardSlotProps & { prompt: ReactNode }) => {
      scales.push(animationScale ?? NaN);
      return <div data-testid="board">{prompt}</div>;
    };
    render(renderGameApp(conn, { slots: { Board, Prompt: () => null } }));
    const c = conn.controller;
    const last = () => scales[scales.length - 1];
    for (const [speed, base] of [[0.25, 4], [0.5, 2], [1, 1], [2, 0.5], [4, 0.25]] as const) {
      await reactAct(() => c.setSpeed(speed));
      expect(last(), `${speed}x`).toBeCloseTo(base);
      expect(gameSoundsMuted()).toBe(false);
    }
    await reactAct(() => c.setSpeed(8));
    expect(gameSoundsMuted()).toBe(true);
    await reactAct(() => c.setMuteFast(false));
    expect(gameSoundsMuted()).toBe(false);
    await reactAct(() => c.setMuteFast(true));
    await reactAct(() => c.setSpeed(1));
    expect(gameSoundsMuted()).toBe(false);
    // The bar is drawn in the prompt's place when the board has no table slot for it.
    expect(within(screen.getByTestId('board')).getByRole('group', { name: 'Replay controls' })).toBeTruthy();
  });

  it('design 8: a jump is shown without sound; stepping into the same moment sounds as live', async () => {
    const g = aGame();
    expect(g.states[g.states.length - 1]!.result).not.toBeNull();
    const results = (ids: readonly string[]) => ids.filter((id) => id === 'game.victory' || id === 'game.defeat' || id === 'game.drawn');
    const conn = await open();
    const rec = recordSounds();
    try {
      render(renderGameApp(conn));
      await key('End');
      expect(conn.controller.state().position).toBe(g.actions.length);
      expect(results(rec.ids)).toEqual([]);
    } finally {
      rec.stop();
    }
    cleanup();
    const again = await open();
    const heard = recordSounds();
    try {
      render(renderGameApp(again));
      await reactAct(() => void again.controller.seek(g.actions.length - 1));
      await reactAct(() => new Promise((r) => setTimeout(r, 120)));
      await key('ArrowRight');
      expect(results(heard.ids).length).toBe(1);
    } finally {
      heard.stop();
    }
  });

  it('design 5.3: a replay of another build is checked before its table is drawn, with its progress', async () => {
    let release: () => void = () => {};
    const held: ReplayChecker = {
      check(play, onProgress) {
        return new Promise<CheckOutcome>((resolve) => {
          release = () => void inlineChecker().check(play, onProgress).then(resolve);
        });
      },
      cancel() {},
    };
    const conn = await open(replayFileOf(aGame(), { build: 'a'.repeat(64) }), { checker: held });
    render(renderGameApp(conn));
    expect(screen.getByRole('heading', { name: 'Checking this replay' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Checking the replay' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Replay controls' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Prompt' })).toBeNull();
    await reactAct(async () => {
      release();
      await conn.controller.ready();
    });
    expect(screen.queryByRole('heading', { name: 'Checking this replay' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Prompt' })).getByText('Checked on this version')).toBeTruthy();
    expect(bar()).toBeTruthy();
  });
});
