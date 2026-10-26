/**
 * The game screen's own parts (C7): pass cover, slots and the prompt-board bridge, undo key, concede, leave, the in-game menu (branding slot 3), game
 * over (branding slot 7), page-exit guard, online-shaped connections.
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND, type Brand } from '../src/branding/brand';
import type { GameConnection } from '../src/connection/GameConnection';
import { LocalConnection } from '../src/connection/LocalConnection';
import { useGameView } from '../src/connection/useGame';
import { usePublishSelection } from '../src/game/interaction';
import { localRematch } from '../src/game/services';
import { BoardSlot, type BoardSlotProps, type PromptSlotProps } from '../src/game/slots';
import { applyLook, TEMPLATE_IDS, templateLook } from '../src/profiles/profiles';
import { SettingsStore } from '../src/settings/settings';
import { injectCss, paintsOver } from './css-rules';
import { CARD_NAMES, hotSeatConfig, memoryStorage, renderGameApp } from './game-fixtures';

afterEach(() => {
  vi.useRealTimers();
});

function started(seed = 'c7-screen'): LocalConnection {
  return new LocalConnection({ ...hotSeatConfig(seed), options: { startingLife: 20, skipMulligans: true, startingPlayer: 'p1' } });
}

/** A hot-seat game at Alice's opening-hand decision (CR 103.5), which the board draws large on its stage over the table. */
function atOpeningHand(): LocalConnection {
  return new LocalConnection({ ...hotSeatConfig('c7-opening-hand'), options: { startingLife: 20, startingPlayer: 'p1' } });
}

/** The stylesheets the game screen is drawn with: every look's (theme/, loaded by main.tsx), then the bar's, the board's and the prompts'. */
const GAME_CSS = [
  ...readdirSync(path.resolve(__dirname, '../src/theme'))
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => `theme/${f}`),
  'game/game.css',
  'board/board.css',
  'board/arena.css',
  'board/table/table.css',
  'prompts/prompts.css',
];

const brandWith = (donationUrl: string | null): Brand => ({ ...BRAND, donationUrl });

/** The same game behind a connection shaped like milestone 9's RemoteConnection: no hand-offs, no undo, not a LocalConnection. */
function remoteLike(local: LocalConnection): GameConnection {
  local.acceptHandoff();
  const remote: GameConnection = { ...local, kind: 'remote', handoff: () => null, acceptHandoff: () => {}, canUndo: () => false, undo: () => false };
  delete (remote as { seated?: unknown }).seated; // online: only the viewer sits at this screen
  return remote;
}

async function concede(player: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
  const dialog = screen.getByRole('dialog', { name: 'Concede' });
  await reactAct(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: `${player} concedes` }));
  });
}

const acceptCover = (name = 'Alice') => fireEvent.click(screen.getByRole('button', { name: `I am ${name}: continue` }));

/** Alice passes until her precombat main phase (clicking through any cover). */
async function toAliceMain(conn: LocalConnection) {
  while (conn.view().turn.step !== 'main1') {
    await reactAct(async () => {
      await conn.act({ type: 'pass', player: 'p1' });
    });
    if (conn.handoff()) fireEvent.click(screen.getByRole('button', { name: /^I am / }));
  }
}

describe('pass cover (hot-seat hidden information, CR 400.2)', () => {
  it('keeps its button disabled for a moment, so a key still held by the previous player cannot click through it', () => {
    vi.useFakeTimers();
    const conn = started();
    render(renderGameApp(conn, { coverDelayMs: 600 }));
    const button = screen.getByRole('button', { name: 'I am Alice: continue' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.activeElement).not.toBe(button);
    reactAct(() => {
      vi.advanceTimersByTime(600);
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(conn.view().viewer).toBe('p1');
  });

  it('renders neither the board nor the prompt until the next player clicks; then the board gets the view, legal actions, interaction and the prompt', () => {
    const conn = started();
    const Board = vi.fn(({ view, legalActions, interaction, prompt }: BoardSlotProps) => (
      <div>
        <p>
          board for {view.viewer}, {legalActions.length} actions, {typeof interaction.onObjectClick}
        </p>
        <div data-testid="board-prompt">{prompt}</div>
      </div>
    ));
    const Prompt = vi.fn(({ connection }: PromptSlotProps) => <p>prompt for {connection.view().viewer}</p>);
    render(renderGameApp(conn, { slots: { Board, Prompt } }));
    expect(Board).not.toHaveBeenCalled();
    expect(Prompt).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Pass to Alice' })).toBeTruthy();
    acceptCover();
    expect(Board.mock.lastCall![0].view).toBe(conn.view());
    expect(Board.mock.lastCall![0].legalActions).toBe(conn.legalActions());
    expect(screen.getByText(`board for p1, ${conn.legalActions().length} actions, function`)).toBeTruthy();
    // The prompt is drawn by the board, in its bar below the zones.
    expect(within(screen.getByTestId('board-prompt')).getByText('prompt for p1')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CR 400.2, CR 104.3a: the cover hides everything, even the turn and the battlefield, and keeps only Concede and Leave', async () => {
    const conn = started();
    const { container } = render(renderGameApp(conn));
    const covered = () => {
      const cover = screen.getByRole('dialog', { name: /^Pass to / });
      expect(within(cover).getAllByRole('button').map((b) => b.textContent)).toEqual(['Concede', 'Leave', expect.stringMatching(/^I am .*: continue$/)]);
      expect(container.querySelector('.game-bar-turn')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Menu/ })).toBeNull();
      for (const name of CARD_NAMES) expect(container.textContent).not.toContain(name);
      expect(container.textContent).not.toMatch(/Turn \d/);
    };
    covered();
    acceptCover();
    await toAliceMain(conn);
    expect(screen.getByText('Turn 1: Alice, Precombat main')).toBeTruthy();
    const land = conn.legalActions().find((l) => l.kind === 'playLand')!;
    await reactAct(async () => {
      await conn.act(land.action);
    });
    expect(container.textContent).toContain('Mountain');
    // Alice passes until Bob must act: the cover hides her land on the battlefield and the turn as well.
    for (let i = 0; i < 50 && !conn.handoff(); i++) {
      await reactAct(async () => {
        await conn.act({ type: 'pass', player: conn.view().viewer! });
      });
    }
    expect(conn.handoff()).toBe('p2');
    covered();
  });

  it('a11y: the cover moves focus nowhere, and after it the keyboard starts at the prompt', () => {
    const { container } = render(renderGameApp(started()));
    acceptCover();
    expect(document.activeElement).toBe(container.querySelector('.game-prompt-slot'));
  });
});

describe('prompt and board (docs/design/m8-client.md screen 7)', () => {
  /** A prompt that lets the player pick the first card of their hand or the opponent, the way chooseTargets does. */
  function PickingPrompt({ connection }: PromptSlotProps) {
    const view = useGameView(connection);
    const [picked, setPicked] = useState<string[]>([]);
    const first = view.zones.hand[view.viewer!]![0]!;
    usePublishSelection({ selectable: [first, 'p2'], selected: picked, marks: { [first]: 'target' }, click: (id) => setPicked((p) => [...p, id]) });
    return <p>picked: {picked.join(', ') || 'nothing'}</p>;
  }

  it('CR 115.1: objects and players the prompt makes selectable are clickable on the board (C4), and the clicks reach the prompt (C5 store)', () => {
    const conn = started();
    const { container } = render(renderGameApp(conn, { slots: { Board: BoardSlot, Prompt: PickingPrompt } }));
    acceptCover();
    const first = conn.view().zones.hand.p1![0]!;
    const cardOf = () => container.querySelector<HTMLElement>(`.board-card[data-object-id="${first}"]`)!;
    // The selectable card is a toggle; the prompt's mark is drawn in its marker strip, outside the card image.
    expect(cardOf().getAttribute('role')).toBe('button');
    expect(cardOf().getAttribute('aria-pressed')).toBe('false');
    expect(cardOf().querySelector('.marker-pending')!.textContent).toBe('target');
    expect(cardOf().querySelector('.board-card-image .marker-pending')).toBeNull();
    fireEvent.click(cardOf());
    expect(screen.getByText(`picked: ${first}`)).toBeTruthy();
    expect(cardOf().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Bob' }));
    expect(screen.getByText(`picked: ${first}, p2`)).toBeTruthy();
    // A click on Bob's life total picks him too (anywhere on a choosable player's panel, STATUS M8-W1 gap 6).
    fireEvent.click(container.querySelector('[data-player-id="p2"] .stat-life')!);
    expect(screen.getByText(`picked: ${first}, p2, p2`)).toBeTruthy();
  });

  it('a click on something the prompt did not offer is ignored', () => {
    const conn = started();
    let interaction: BoardSlotProps['interaction'] | null = null;
    const Board = (p: BoardSlotProps) => {
      interaction = p.interaction;
      return <>{p.prompt}</>;
    };
    render(renderGameApp(conn, { slots: { Board, Prompt: PickingPrompt } }));
    acceptCover();
    reactAct(() => interaction!.onPlayerClick('p1'));
    expect(screen.getByText('picked: nothing')).toBeTruthy();
  });

  it('a stop toggled on the board reaches the game as a setStops action', async () => {
    const conn = started();
    const stops = { ownTurn: ['upkeep' as const], opponentTurn: [], fullControl: false };
    const Board = ({ interaction }: BoardSlotProps) => (
      <button type="button" onClick={() => interaction.onSetStops({ type: 'setStops', player: 'p1', stops })}>
        Toggle stop
      </button>
    );
    render(renderGameApp(conn, { slots: { Board, Prompt: () => null } }));
    acceptCover();
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle stop' }));
    });
    expect(conn.session.state.players.find((p) => p.id === 'p1')!.stops).toEqual(stops);
  });

  it("the default slots are C4's board with C2's card pictures and C5's prompt bar", () => {
    const { container } = render(renderGameApp(started()));
    acceptCover();
    expect(container.querySelector('.game-board')).not.toBeNull();
    expect(container.querySelector('.board-prompt .prompt-bar')).not.toBeNull();
    // Alice's hand is face up, drawn by C2's text frame (no image uploaded, Scryfall off); Bob's hand is card backs only (CR 400.2).
    const own = container.querySelectorAll('.hand-own .board-card');
    expect(own.length).toBe(7);
    expect(container.querySelectorAll('.hand-own .board-card-image .card-frame')).toHaveLength(7);
    expect(container.querySelectorAll('.hand-hidden .board-card-back')).toHaveLength(7);
    expect(container.querySelector('.hand-hidden .card-frame')).toBeNull();
  });
});

describe('undo (hot-seat, CR 733.1)', () => {
  it('Z takes back the last action, but not while typing or with a modifier key', async () => {
    const conn = started('c7-undo');
    const Board = ({ view }: BoardSlotProps) => <input aria-label="notes" defaultValue={view.viewer ?? ''} />;
    render(renderGameApp(conn, { slots: { Board, Prompt: () => null } }));
    acceptCover();
    while (conn.view().turn.step !== 'main1') {
      await reactAct(async () => {
        await conn.act({ type: 'pass', player: 'p1' });
      });
    }
    const land = conn.legalActions().find((l) => l.kind === 'playLand')!;
    await reactAct(async () => {
      await conn.act(land.action);
    });
    const button = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'z' });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(conn.view().zones.battlefield).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Z' });
    expect(conn.view().zones.battlefield).toHaveLength(0);
    expect(button.disabled).toBe(true);
  });
});

describe('concede and leave', () => {
  it('CR 104.3a: either hot-seat player can concede, after a confirmation; the other player wins', async () => {
    const conn = started();
    render(renderGameApp(conn));
    acceptCover();
    fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
    const dialog = screen.getByRole('dialog', { name: 'Concede' });
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Alice concedes', 'Bob concedes', 'Keep playing']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep playing' }));
    expect(conn.view().result).toBeNull();
    await concede('Bob');
    expect(conn.view().result?.winner).toBe('p1');
    const over = screen.getByRole('region', { name: 'Game over' });
    expect(within(over).getByRole('heading', { name: 'Alice wins' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Concede' })).toBeNull();
  });

  it('CR 104.3a: a player can concede even while the pass cover is up', async () => {
    const conn = started();
    render(renderGameApp(conn));
    expect(conn.handoff()).toBe('p1');
    await concede('Alice');
    expect(conn.view().result?.winner).toBe('p2');
    expect(screen.queryByRole('dialog', { name: /^Pass to/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Bob wins' })).toBeTruthy();
  });

  it('CR 104.3a: on the pass cover the Concede and Leave confirms open over the cover\'s own content, which would otherwise take their clicks', () => {
    const removeCss = injectCss(...GAME_CSS);
    try {
      const { container } = render(renderGameApp(started()));
      const body = container.querySelector('.pass-cover-body')!;
      fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
      expect(paintsOver(screen.getByRole('dialog', { name: 'Concede' }), body)).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
      expect(paintsOver(screen.getByRole('dialog', { name: 'Leave the game' }), body)).toBe(true);
    } finally {
      removeCss();
    }
  });

  it('Leave asks first, then returns home', () => {
    render(renderGameApp(started()));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the game' })).getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByRole('dialog', { name: 'Pass to Alice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave the game' }));
    expect(screen.getByTestId('route').textContent).toBe('home');
  });

  it('a11y: a confirm takes the focus on its safe button; Esc closes it (and only it) and gives the focus back', () => {
    render(renderGameApp(started()));
    acceptCover();
    const seen: string[] = [];
    const promptLike = (e: KeyboardEvent) => {
      if (!e.defaultPrevented) seen.push(e.key);
    };
    window.addEventListener('keydown', promptLike);
    try {
      for (const [opener, dialogName] of [
        ['Concede', 'Concede'],
        ['Leave', 'Leave the game'],
      ] as const) {
        const button = screen.getByRole('button', { name: opener });
        button.focus();
        fireEvent.click(button);
        const dialog = screen.getByRole('dialog', { name: dialogName });
        expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep playing' }));
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: dialogName })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: opener }));
      }
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('keydown', promptLike);
    }
  });

  it('warns before a reload, tab close or browser Back while the game is in progress, and not once it is over', async () => {
    const view = render(renderGameApp(started()));
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(true);
    acceptCover();
    expect(unload()).toBe(true);
    await concede('Bob');
    expect(unload()).toBe(false);
    view.unmount();
    render(renderGameApp(started())).unmount();
    expect(unload()).toBe(false);
  });
});

describe('in-game menu (branding slot 3)', () => {
  it('the Menu button carries the DigiDice logo and opens Settings and About without ending the game', () => {
    const conn = started();
    render(renderGameApp(conn, { brand: brandWith(null) }));
    acceptCover();
    const menuButton = screen.getByRole('button', { name: /Menu/ });
    expect(within(menuButton).getByRole('img', { name: 'DigiDice logo' })).toBeTruthy();
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton);
    const menu = screen.getByRole('group', { name: 'Game menu' });
    expect(within(menu).queryByRole('link', { name: 'Donate' })).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('route').textContent).toBe('settings');
    fireEvent.click(screen.getByRole('button', { name: 'Test back' }));
    // The same game, same player, no new cover.
    expect(screen.queryByRole('dialog', { name: /^Pass to/ })).toBeNull();
    expect(conn.view().viewer).toBe('p1');
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.getByTestId('route').textContent).toBe('about');
  });

  it('opens Home, Decks, Replays and Images too, without ending the game (owner, 2026-10-25)', () => {
    render(renderGameApp(started(), { brand: brandWith(null) }));
    acceptCover();
    for (const [name, route] of [['Home', 'home'], ['Decks', 'decks'], ['Replays', 'replays'], ['Images', 'images']] as const) {
      fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
      fireEvent.click(within(screen.getByRole('group', { name: 'Game menu' })).getByRole('button', { name }));
      expect(screen.getByTestId('route').textContent).toBe(route);
      fireEvent.click(screen.getByRole('button', { name: 'Test back' }));
      // Back on the same game, no new cover.
      expect(screen.queryByTestId('route')).toBeNull();
      expect(screen.queryByRole('dialog', { name: /^Pass to/ })).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    expect(within(screen.getByRole('group', { name: 'Game menu' })).queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('holds a quiet Donate link only when brand.json has a URL; Esc closes the menu', () => {
    render(renderGameApp(started(), { brand: brandWith('https://example.org/donate') }));
    acceptCover();
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    const link = within(screen.getByRole('group', { name: 'Game menu' })).getByRole('link', { name: 'Donate' });
    expect(link.className).toContain('donate-quiet');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Game menu' })).toBeNull();
  });

  it('opens, as the confirms do, over the opening-hand stage and the board\'s other layers in every look: none dims it or takes its clicks', async () => {
    const removeCss = injectCss(...GAME_CSS);
    const root = document.documentElement;
    try {
      for (const look of TEMPLATE_IDS) {
        applyLook(root, templateLook(look));
        const { container, unmount } = render(renderGameApp(atOpeningHand()));
        acceptCover();
        // Queries inside the bar: a role query over the whole board reads every element's computed style, slow with the stylesheets in.
        const bar = within(container.querySelector<HTMLElement>('.game-bar')!);
        fireEvent.click(container.querySelector('.log-toggle')!);
        // The stage holds the opening hand; the zoom, the log drawer and the fx layer are the board's other layers over the table.
        const layers = ['.prompt-stage', '.zoom', '.game-log', '.fx-overlay'].map((s) => [s, container.querySelector(s)] as const);
        for (const [opener, panel] of [
          [/Menu/, () => bar.getByRole('group', { name: 'Game menu' })],
          ['Concede', () => bar.getByRole('dialog', { name: 'Concede' })],
          ['Leave', () => bar.getByRole('dialog', { name: 'Leave the game' })],
        ] as const) {
          fireEvent.click(bar.getByRole('button', { name: opener }));
          for (const [s, layer] of layers) expect(layer !== null && paintsOver(panel(), layer), `${look}: ${String(opener)} over ${s}`).toBe(true);
        }
        // CR 104: the result drawn across the table once the game is over.
        fireEvent.click(bar.getByRole('button', { name: 'Concede' }));
        await reactAct(async () => {
          fireEvent.click(bar.getByRole('button', { name: 'Alice concedes' }));
        });
        fireEvent.click(bar.getByRole('button', { name: /Menu/ }));
        const result = container.querySelector('.result-screen');
        expect(result !== null && paintsOver(bar.getByRole('group', { name: 'Game menu' }), result), `${look}: Menu over .result-screen`).toBe(true);
        unmount();
      }
    } finally {
      removeCss();
      for (const k of Object.keys(root.dataset)) delete root.dataset[k];
      root.removeAttribute('style');
    }
  }, 20_000);

  it('the bar lies under an open zone viewer, the modal list of a pile (CR 404); a menu opened before the list stays over it', () => {
    const { container } = render(renderGameApp(started()));
    acceptCover();
    const openList = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Bob's graveyard/ }));
      return screen.getByRole('dialog', { name: "Bob's graveyard" });
    };
    // The stylesheets go in only for each check: role queries read computed styles, slow with them in.
    const drawnOver = (a: Element, b: Element) => {
      const removeCss = injectCss(...GAME_CSS);
      try {
        return paintsOver(a, b);
      } finally {
        removeCss();
      }
    };
    expect(drawnOver(openList(), container.querySelector('.game-bar')!)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    const list = openList();
    expect(drawnOver(screen.getByRole('group', { name: 'Game menu' }), list)).toBe(true);
  });
});

describe('game over (branding slot 7)', () => {
  it('offers Home and New game, and folds away to show the final board', async () => {
    const conn = started();
    render(renderGameApp(conn));
    acceptCover();
    await concede('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Show the board' }));
    expect(screen.getByRole('region', { name: 'Game over' }).textContent).toContain('Bob wins');
    expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the result' }));
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByTestId('route').textContent).toBe('newGame');
  });

  it('a11y: the result takes the keyboard focus, so it is announced', async () => {
    render(renderGameApp(started()));
    acceptCover();
    await concede('Alice');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Bob wins' }));
  });

  it('Home returns to the title screen', async () => {
    render(renderGameApp(started()));
    await concede('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByTestId('route').textContent).toBe('home');
  });

  it('a finished game leaves without asking', async () => {
    render(renderGameApp(started()));
    await concede('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.queryByRole('dialog', { name: 'Leave the game' })).toBeNull();
    expect(screen.getByTestId('route').textContent).toBe('home');
  });

  it('shows a quiet, dismissible Donate link only when brand.json has a URL', async () => {
    const first = render(renderGameApp(started(), { brand: brandWith(null) }));
    await concede('Bob');
    expect(screen.queryByText('Donate')).toBeNull();
    first.unmount();

    const conn = started();
    render(renderGameApp(conn, { brand: brandWith('https://example.org/donate') }, localRematch(conn.session.config, () => 'seed-2')));
    await concede('Bob');
    const link = screen.getByRole('link', { name: 'Donate' });
    expect(link.getAttribute('href')).toBe('https://example.org/donate');
    expect(link.className).toContain('donate-quiet');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Donate' }));
    expect(screen.queryByRole('link', { name: 'Donate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeTruthy(); // never blocking
  });

  it('a rematch keeps the players, decks and options with a new seed, through the route (not the connection type)', async () => {
    const old = started();
    const newSeed = vi.fn(() => 'rematch-seed');
    const factory = localRematch(old.session.config, newSeed);
    const made: LocalConnection[] = [];
    render(
      renderGameApp(old, {}, () => {
        const c = factory();
        made.push(c);
        return c;
      }),
    );
    await concede('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(newSeed).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(1);
    const config = made[0]!.session.config;
    expect(config.seed).toBe('rematch-seed');
    expect(config.players).toEqual(old.session.config.players);
    expect(config.defs).toEqual(old.session.config.defs);
    expect(config.options).toEqual(old.session.config.options);
    expect(screen.queryByRole('region', { name: 'Game over' })).toBeNull();
    // The options say Alice starts (startingPlayer p1), so the new game opens with a cover for her; both players are in it again.
    acceptCover();
    await concede('Alice');
    // The next rematch is offered again.
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(made).toHaveLength(2);
  });
});

describe('an online-shaped connection (milestone 9 plugs in without UI changes)', () => {
  it('offers no Undo and no Rematch, and only the local player can concede', async () => {
    const conn = remoteLike(started());
    render(renderGameApp(conn));
    expect(screen.queryByRole('dialog', { name: /^Pass to/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
    expect(within(screen.getByRole('dialog', { name: 'Concede' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Alice concedes', 'Keep playing']);
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Alice concedes' }));
    });
    expect(screen.getByRole('heading', { name: 'Bob wins' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
  });
});

describe('settings on the game screen', () => {
  it('publishes the animation speed as --anim-ms for the board', () => {
    const settings = new SettingsStore(memoryStorage());
    settings.update({ animationSpeed: 'slow' });
    const { container } = render(renderGameApp(started(), { settings }));
    const root = container.querySelector('.game-screen') as HTMLElement;
    expect(root.style.getPropertyValue('--anim-ms')).toBe('500ms');
    expect(root.dataset.animation).toBe('slow');
  });
});
