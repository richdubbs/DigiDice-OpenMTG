/**
 * Test harness for the decision prompts: a GameConnection over a real engine state (boards built with the engine's scenario helper from real fixture cards,
 * packages/engine/test/m3/scenario.ts), a stand-in board that shows what the prompt makes clickable, and helpers to read what was sent to the engine.
 */
import { act as reactAct, fireEvent, render, screen } from '@testing-library/react';
import {
  applyAction, legalActions, viewFor, type Action, type ActionError, type DecisionAnswer, type GameState, type GameView, type LegalAction, type PlayerId,
} from '@openmtg/engine';
import type { ActResult, GameConnection } from '../../src/connection/GameConnection';
import { PromptBar } from '../../src/prompts/PromptBar';
import { useBoardInteraction } from '../../src/game/interaction';
import { PromptSelectionProvider, SelectionStore } from '../../src/prompts/selection';
import type { CardNameSearch } from '../../src/prompts/types';

export { act, answer, find, findAll, pass, passBoth, scenario, castAuto, advanceTo } from '../../../engine/test/m3/scenario';
export { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, tweak, lifeOf, creature } from '../../../engine/test/m4/helpers';

/**
 * A connection that always shows the player the engine waits for (no hand-off cover: the hand-off is LocalConnection's job, tested elsewhere). Every
 * action goes through `applyAction`, exactly as LocalConnection's session does; `sent` records them and `errors` the rejections.
 */
export class StateConnection implements GameConnection {
  readonly kind = 'local' as const;
  readonly sent: Action[] = [];
  readonly errors: ActionError[] = [];
  private cachedView: GameView | null = null;
  private cachedLegal: readonly LegalAction[] | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(public state: GameState) {}

  private viewer(): PlayerId | null {
    return this.state.pending?.player ?? null;
  }

  readonly view = (): GameView => (this.cachedView ??= viewFor(this.state, this.viewer()));
  readonly legalActions = (): readonly LegalAction[] => {
    const v = this.viewer();
    this.cachedLegal ??= v !== null && this.state.pending?.kind === 'priority' ? legalActions(this.state, v) : [];
    return this.cachedLegal;
  };
  readonly subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  readonly act = async (action: Action): Promise<ActResult> => {
    this.sent.push(action);
    const r = applyAction(this.state, action);
    if (r.error) {
      this.errors.push(r.error);
      return { ok: false, error: r.error };
    }
    this.set(r.state);
    return { ok: true };
  };
  readonly canUndo = () => false;
  readonly undo = () => false;
  readonly handoff = () => null;
  readonly acceptHandoff = () => {};

  /** Replace the state (test setup between prompts). */
  set(state: GameState): void {
    this.state = state;
    this.cachedView = null;
    this.cachedLegal = null;
    for (const l of [...this.listeners]) l();
  }

  /** The answers sent so far. */
  answers(): DecisionAnswer[] {
    return this.sent.flatMap((a) => (a.type === 'answer' ? [a.answer] : []));
  }

  /**
   * The player's last answer. A cost with only one way to pay is paid at once after the answer that led to it (the prompt bar's auto pay, `onlyWay`):
   * that automatic payment is not counted when an answer came before it (`answers()` has every one).
   */
  lastAnswer(): DecisionAnswer | undefined {
    const all = this.answers();
    const last = all.at(-1);
    return last?.kind === 'payCost' && last.auto && all.length > 1 ? all.at(-2) : last;
  }
}

/**
 * Stand-in for the board (C4), shaped like C4's CardSlot (branch m8/c4 board/CardSlot.tsx): every clickable card is a focusable `role="button"` div whose
 * own Space / Enter handler calls preventDefault and clicks it. It reads the bridge through the game screen's own adapter (game/interaction.ts).
 */
function FakeBoard({ connection, store }: { connection: GameConnection; store: SelectionStore }) {
  const b = useBoardInteraction(connection, store);
  return (
    <div aria-label="Board">
      {b.selectable.map((id) => (
        <div
          key={id}
          role="button"
          tabIndex={0}
          aria-label={`Board ${id}`}
          data-selected={b.selected.includes(id)}
          data-mark={b.marks[id] ?? ''}
          onClick={() => b.onObjectClick(id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              b.onObjectClick(id);
            }
          }}
        >
          {id}
        </div>
      ))}
    </div>
  );
}

export function renderPrompt(state: GameState, opts: { searchCardNames?: CardNameSearch; armDelayMs?: number } = {}) {
  const conn = new StateConnection(state);
  const store = new SelectionStore();
  const utils = render(
    <PromptSelectionProvider store={store}>
      <FakeBoard connection={conn} store={store} />
      <PromptBar connection={conn} armDelayMs={opts.armDelayMs ?? 0} {...(opts.searchCardNames ? { searchCardNames: opts.searchCardNames } : {})} />
    </PromptSelectionProvider>,
  );
  return { conn, ...utils };
}

/**
 * A mouse click as a browser does it: pointerdown / mousedown, the element takes the focus (buttons and tabIndex elements do), mouseup, click. Modelling the
 * focus matters: Space after a click goes to the clicked element (review finding: Space = OK after a pointer click).
 */
export function pointerClick(el: Element): void {
  fireEvent.pointerDown(el);
  fireEvent.mouseDown(el);
  if (el instanceof HTMLElement && (el.tabIndex >= 0 || el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) el.focus();
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}

/** Click a button by its accessible name (with the focus move of a real click) and let the async action settle. */
export async function click(name: string | RegExp): Promise<void> {
  await reactAct(async () => {
    pointerClick(screen.getByRole('button', { name }));
  });
}

/** Click an element by role and accessible name (options, checkboxes). */
export async function clickRole(role: string, name: string | RegExp): Promise<void> {
  await reactAct(async () => {
    pointerClick(screen.getByRole(role, { name }));
  });
}

export async function clickEl(el: Element): Promise<void> {
  await reactAct(async () => {
    pointerClick(el);
  });
}

/** Press a key where the browser sends it: the focused element (the body when nothing has the focus); it bubbles to window, where the PromptBar listens. */
export async function press(key: string, target?: Element | Window): Promise<void> {
  await reactAct(async () => {
    fireEvent.keyDown(target ?? document.activeElement ?? document.body, { key, code: key === ' ' ? 'Space' : key });
  });
}

/** Tab to an element: a keyboard focus (the browser shows the focus ring, and Space activates the element itself). */
export async function tabTo(el: HTMLElement): Promise<void> {
  await reactAct(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', code: 'Tab' });
    el.focus();
  });
}

/** Replace the connection's state from a test (setup between prompts), inside act so React renders the new prompt. */
export async function setState(conn: StateConnection, state: GameState): Promise<void> {
  await reactAct(async () => {
    conn.set(state);
  });
}

export function pendingKind(conn: StateConnection): string | undefined {
  return conn.state.pending?.kind;
}

/** Answer whatever the engine asks with these answers in order, outside the UI (setup). */
export function drive(state: GameState, answers: DecisionAnswer[]): GameState {
  let s = state;
  for (const a of answers) {
    const r = applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: a });
    if (r.error) throw new Error(`setup answer rejected: ${r.error.message}`);
    s = r.state;
  }
  return s;
}
