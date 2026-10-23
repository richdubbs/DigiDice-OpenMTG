/**
 * Sound on the game screen (docs/design/sound.md), through the real components: "your move" and its quiet rules, passing, combat picks, targets, keeping a
 * hand, the pass cover, the result screen, the card zoom's rate limit, and a whole hot-seat game screen (its start, and a change shown without animation,
 * as every change is in jsdom, still sounds). The engine has no Web Audio here: `recordSounds` hears what the page asks for.
 */
import { act as reactAct, fireEvent, render, screen } from '@testing-library/react';
import { createGame, viewFor, type GameState, type GameView } from '@openmtg/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordSounds, resetSoundEngineForTests, type SoundRecording } from '../src/audio/sfx';
import { GameBoard, ZOOM_SOUND_MS } from '../src/board/GameBoard';
import { LocalConnection } from '../src/connection/LocalConnection';
import { PassCover } from '../src/game/PassCover';
import { resetSoundClockForTests, soundClock } from '../src/game/sound';
import { PromptBar, YOUR_MOVE_DELAY_MS } from '../src/prompts/PromptBar';
import { ALICE, BOB, editable, playGame } from './board/fixtures';
import { hotSeatConfig, renderGameApp } from './game-fixtures';
import {
  StateConnection, act, click, declareAttackers, drive, find, findAll, press, renderPrompt, scenario, setState, toDeclareAttackers, toDeclareBlockers,
} from './prompts/harness';
import { smallConfig } from './helpers';

let rec: SoundRecording;

beforeEach(() => {
  resetSoundEngineForTests();
  resetSoundClockForTests();
  rec = recordSounds();
});

afterEach(() => {
  rec.stop();
  vi.useRealTimers();
  resetSoundEngineForTests();
  resetSoundClockForTests();
});

const count = (id: string) => rec.ids.filter((x) => x === id).length;
/** Let the page's microtasks and the "your move" delay run. */
async function wait(ms = YOUR_MOVE_DELAY_MS + 50): Promise<void> {
  await reactAct(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const priorityBoard = () => scenario(['Mountain', 'Lightning Bolt', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });

/** Alice's screen whatever the engine waits for (the harness's own connection shows whoever must act). */
class AliceConnection extends StateConnection {
  private seen: GameState | null = null;
  private cached: GameView | null = null;
  override readonly view = (): GameView => {
    if (this.seen !== this.state || !this.cached) {
      this.seen = this.state;
      this.cached = viewFor(this.state, 'p1');
    }
    return this.cached;
  };
}

describe('"your move" (priority.mine)', () => {
  it("sounds a moment after the player's decision appears, once; not over the player's turn banner", async () => {
    vi.useFakeTimers();
    renderPrompt(priorityBoard());
    expect(count('priority.mine')).toBe(0);
    await wait();
    expect(count('priority.mine')).toBe(1);
    await wait(2000);
    expect(count('priority.mine')).toBe(1);
  });

  it('stays quiet when the turn banner for the player just played', async () => {
    vi.useFakeTimers();
    soundClock.note('turn.mine');
    renderPrompt(priorityBoard());
    await wait();
    expect(count('priority.mine')).toBe(0);
  });

  it("stays quiet for the follow-ups of the player's own action (CR 601.2: a cast asks for its targets, then its cost)", async () => {
    vi.useFakeTimers();
    const s = priorityBoard();
    renderPrompt(s);
    await wait();
    await wait(2000);
    expect(count('priority.mine')).toBe(1);
    await click(/^Lightning Bolt/);
    await click(/^Cast Lightning Bolt/);
    expect(screen.getAllByText(/any target/).length).toBeGreaterThan(0);
    await wait(2000);
    expect(count('priority.mine')).toBe(1);
  });

  it('sounds again when the decision comes back from the other player (CR 117.3)', async () => {
    vi.useFakeTimers();
    const s = priorityBoard();
    const conn = new AliceConnection(s);
    render(<PromptBar connection={conn} armDelayMs={0} />);
    await wait();
    await wait(2000);
    expect(count('priority.mine')).toBe(1);
    await setState(conn, { ...s, pending: { ...s.pending!, player: 'p2' } });
    expect(screen.getByText(/Waiting for Bob/)).toBeTruthy();
    await wait();
    expect(count('priority.mine')).toBe(1);
    await setState(conn, { ...s });
    await wait();
    expect(count('priority.mine')).toBe(2);
  });
});

describe('prompt sounds', () => {
  it('Pass priority (the button and Space) is priority.pass, and nothing else', async () => {
    const s = priorityBoard();
    const { conn } = renderPrompt(s);
    await click('Pass priority');
    expect(rec.ids.filter((x) => x.startsWith('priority.pass'))).toEqual(['priority.pass']);
    await setState(conn, s);
    await press(' ');
    expect(count('priority.pass')).toBe(2);
  });

  it('a rejection ("Not allowed") is heard (ui.error)', async () => {
    const conn = new StateConnection(priorityBoard());
    (conn as { act: StateConnection['act'] }).act = async () => ({ ok: false, error: { message: 'Not now.', rules: ['CR 117.1'] } });
    render(<PromptBar connection={conn} armDelayMs={0} />);
    await click('Pass priority');
    expect(screen.getByRole('alert').textContent).toContain('Not now.');
    expect(rec.ids).toContain('ui.error');
  });

  it('CR 601.2c: choosing a target locks on (card.target), on a chip, a player button or the board; taking it back ticks', async () => {
    const s = priorityBoard();
    const cast = act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
    const bears = find(cast, 'Grizzly Bears', 'battlefield');
    renderPrompt(cast);
    await click('Bob');
    expect(rec.ids).toContain('card.target');
    await click('Bob');
    expect(rec.ids.at(-1)).toBe('ui.tick');
    await click(`Board ${bears}`);
    expect(count('card.target')).toBe(2);
  });

  it('CR 508.1a: arming an attacker and Attack with all are combat.arm; CR 509.1a: a blocker and the attacker it blocks are combat.assign', async () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } });
    s = toDeclareAttackers(s);
    const [a] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    const first = renderPrompt(s);
    await click(`Board ${a}`);
    await click('Attack with all');
    expect(count('combat.arm')).toBe(2);
    first.unmount();

    let b = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
    b = toDeclareBlockers(declareAttackers(toDeclareAttackers(b), [[find(b, 'Grizzly Bears', 'battlefield', 'p1')]]));
    const blocker = find(b, 'Grizzly Bears', 'battlefield', 'p2');
    const attacker = find(b, 'Grizzly Bears', 'battlefield', 'p1');
    renderPrompt(b);
    await click(`Board ${blocker}`);
    await click(`Board ${attacker}`);
    expect(count('combat.assign')).toBe(2);
  });

  it('CR 103.5: Keep locks the hand in (game.keep); the Mulligan button leaves its sound to the mulligan event', async () => {
    let s = createGame(smallConfig('sound-keep'));
    s = drive(s, [{ kind: 'playFirst', player: s.pending!.player }]);
    renderPrompt(s);
    expect(screen.getByRole('button', { name: /^Mulligan/ }).getAttribute('data-sfx')).toBe('none');
    await click(/^Keep/);
    expect(rec.ids).toContain('game.keep');
  });
});

describe('screens', () => {
  it('the pass cover sounds once as it appears (game.handoff)', () => {
    const { rerender } = render(<PassCover name="Bob" onAccept={() => {}} armDelayMs={0} />);
    rerender(<PassCover name="Bob" onAccept={() => {}} armDelayMs={0} />);
    expect(rec.ids).toEqual(['game.handoff']);
  });

  const game = playGame(3);
  const ended = (winner: string | null): GameView => {
    const v = editable(game.captured[game.captured.length - 1]!.view);
    (v as { result: unknown }).result = { winner, reason: 'test' };
    return v;
  };

  it('CR 104: the result screen says victory or defeat for the one player at the screen, the neutral end otherwise, once', () => {
    const win = render(<GameBoard view={ended(ALICE)} seats={[ALICE]} />);
    win.rerender(<GameBoard view={ended(ALICE)} seats={[ALICE]} />);
    expect(rec.ids.filter((x) => x.startsWith('game.'))).toEqual(['game.victory']);
    win.unmount();
    rec.ids.length = 0;
    render(<GameBoard view={ended(ALICE)} seats={[BOB]} />).unmount();
    render(<GameBoard view={ended(null)} seats={[BOB]} />).unmount();
    render(<GameBoard view={ended(ALICE)} seats={[ALICE, BOB]} />).unmount();
    expect(rec.ids.filter((x) => x.startsWith('game.'))).toEqual(['game.defeat', 'game.drawn', 'game.drawn']);
  });

  it('after the final blow, the result waits for the crash to land', () => {
    soundClock.note('game.finalBlow');
    render(<GameBoard view={ended(ALICE)} seats={[ALICE]} />);
    const call = rec.calls.find((c) => c.id === 'game.victory')!;
    expect(call.opts.delay).toBeGreaterThan(0.5);
    expect(call.opts.delay).toBeLessThanOrEqual(0.7);
  });

  it(`the card zoom is heard softly, at most once per ${ZOOM_SOUND_MS} ms however fast the pointer sweeps`, () => {
    vi.useFakeTimers();
    const v = game.captured.find((c) => c.view.zones.battlefield.length >= 3)!.view;
    const { container } = render(<GameBoard view={v} />);
    const cards = [...container.querySelectorAll<HTMLElement>('.board-card[data-object-id]')].filter((el) => el.dataset.face === 'up');
    expect(cards.length).toBeGreaterThanOrEqual(3);
    fireEvent.mouseEnter(cards[0]!);
    fireEvent.mouseEnter(cards[1]!);
    expect(count('card.zoom')).toBe(1);
    vi.advanceTimersByTime(ZOOM_SOUND_MS + 10);
    fireEvent.mouseEnter(cards[2]!);
    expect(count('card.zoom')).toBe(2);
  });
});

describe('the game screen', () => {
  it('a fresh hot-seat game: the pass cover, then the start of the game once its table appears; a land played without animation still sounds', async () => {
    const conn = new LocalConnection({ ...hotSeatConfig('sound-screen'), options: { startingLife: 20, skipMulligans: true, startingPlayer: 'p1' } });
    render(renderGameApp(conn));
    expect(rec.ids).toContain('game.handoff');
    expect(count('game.start')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'I am Alice: continue' }));
    await reactAct(async () => {});
    expect(count('game.start')).toBe(1);
    while (conn.view().turn.step !== 'main1') {
      await reactAct(async () => {
        await conn.act({ type: 'pass', player: 'p1' });
      });
      if (conn.handoff()) fireEvent.click(screen.getByRole('button', { name: /^I am / }));
    }
    const v = conn.view();
    const mountain = (v.zones.hand.p1 ?? []).find((id) => v.defs[v.objects[id]!.defId]?.name === 'Mountain')!;
    await reactAct(async () => {
      const r = await conn.act({ type: 'playLand', player: 'p1', card: mountain });
      expect(r.ok).toBe(true);
    });
    expect(rec.ids).toContain('card.land');
    expect(count('game.start')).toBe(1);
  });
});
