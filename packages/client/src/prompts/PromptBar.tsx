/**
 * The bottom bar of the game board (docs/design/m8-client.md screens 6-7): the pending decision of the player on screen, its buttons, Cancel where the
 * decision is cancellable (CR 733.1), and the engine's explanation and rule when an action is rejected. It talks to the game only through `GameConnection`
 * (docs/design/online.md), so the same bar serves hot-seat and online play.
 *
 * Shortcuts: Space = OK / pass, Esc = cancel. Space after a mouse click is the OK too (the click left the focus on a chip or a board card, and pressing it
 * again would undo the click); Space on a control focused with the keyboard (Tab) is left to that control.
 * Click safety: a new prompt's actions work only `armDelayMs` after it appears, so the second click of a double click (which lands on the next prompt's
 * button in the same place, e.g. Pass priority) does not act twice.
 * Accessibility: the prompt text is a polite live region; when the focused button goes away with the old prompt, the focus moves to the new prompt's text.
 * Sound (docs/design/sound.md): a decision of the player on screen says "your move" (priority.mine, see `yourMoveHeard` for when), and a rejection is
 * heard (ui.error).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { decidingPlayer, type Action, type ActionError, type DecisionAnswer } from '@openmtg/engine';
import { useSfxOn } from '../audio/useSfxOn';
import type { GameConnection } from '../connection/GameConnection';
import { useGameView, useHandoff, useLegalActions } from '../connection/useGame';
import { gameSfx, soundClock, type SoundClock } from '../game/sound';
import { Rules } from './Chips';
import { CardNameSearchContext, serverCardNameSearch } from './ChooseNamePrompt';
import { DecisionPrompt } from './DecisionPrompt';
import { FOCUS_KEYS, isPressable, KeysContext, keyOwnedByTarget, type KeyHandlers } from './keys';
import { playerName } from './names';
import { redirectedPrompt } from './PlayerChoicePrompts';
import type { CardNameSearch } from './types';
import { PromptActions } from './PromptActions';
import { StageHostContext } from './stage';
import './prompts.css';

export interface PromptBarProps {
  connection: GameConnection;
  /** Card-name search for "choose a card name" (defaults to the local server's search). */
  searchCardNames?: CardNameSearch;
  /** How long after a new prompt appears its actions start to work (default 300 ms; tests pass 0). */
  armDelayMs?: number;
}

const isSpace = (e: KeyboardEvent) => e.key === ' ' || e.code === 'Space';

/** "Your move" waits this long after its decision appears: the turn banner, which says it louder, comes with the same new view and wins. */
export const YOUR_MOVE_DELAY_MS = 250;

/**
 * Whether a decision of the player on screen that just appeared says "your move" (priority.mine). Not when it only continues what that player just did on
 * this bar (a cast asks for its targets, then its cost; a pass moves on to their own next step): the previous decision here was theirs and they acted on
 * it. Heard when the decision comes back from the other player (CR 117.3: priority passes to them), or is the first this bar shows (after the pass
 * cover), or replaces one of theirs they did not act on (an undo, the other player's response).
 */
export function yourMoveHeard(prevMine: boolean, acted: boolean): boolean {
  return !prevMine || !acted;
}

/**
 * ... and whether it may sound now: at most once a second, never over the player's own turn banner or the game's start (they already say it), nor
 * right after the lock-on warning of the other player's spell or ability aimed at the player (it says "respond" already, CR 115.1).
 */
export function yourMoveClear(clock: SoundClock): boolean {
  return (
    !clock.recent('priority.mine', 1000) && !clock.recent('turn.mine', 1500) && !clock.recent('game.start', 2500) && !clock.recent('card.targeted', 700)
  );
}

export function PromptBar({ connection, searchCardNames = serverCardNameSearch, armDelayMs = 300 }: PromptBarProps) {
  const view = useGameView(connection);
  const legal = useLegalActions(connection);
  const handoff = useHandoff(connection);
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  // Where a decision drawn on the board's stage wants the action buttons (stage.tsx); null while no stage is shown.
  const [stageActions, setStageActions] = useState<HTMLElement | null>(null);
  const stageHost = useMemo(() => ({ actions: stageActions, setActions: setStageActions }), [stageActions]);
  const keys = useRef<KeyHandlers>({ primary: null, escape: null });
  const textRef = useRef<HTMLParagraphElement>(null);
  const armedAt = useRef(0);
  const d = view.pending;
  const mine = d !== null && handoff === null && view.viewer !== null && decidingPlayer(d) === view.viewer; // std-control-3: also a decision of a player this seat controls (CR 723.5)
  const decisionId = d?.id ?? null;

  useEffect(() => setError(null), [decisionId]);
  useSfxOn('ui.error', error);

  // "Your move": decided when the decision appears, heard a moment later if nothing louder said it meanwhile and the decision is still the one on screen.
  const shownDecision = useRef<{ key: string | null; mine: boolean }>({ key: null, mine: false });
  const acted = useRef(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decisionKey = decisionId === null ? null : `${decisionId}:${mine ? 'mine' : 'theirs'}`;
  useEffect(() => {
    const prev = shownDecision.current;
    if (decisionKey === prev.key) return;
    shownDecision.current = { key: decisionKey, mine };
    const heard = mine && yourMoveHeard(prev.mine, acted.current);
    acted.current = false;
    if (!heard) return;
    if (moveTimer.current) clearTimeout(moveTimer.current);
    const key = decisionKey;
    moveTimer.current = setTimeout(() => {
      moveTimer.current = null;
      if (shownDecision.current.key === key && yourMoveClear(soundClock)) gameSfx('priority.mine');
    }, YOUR_MOVE_DELAY_MS);
  }, [decisionKey, mine]);
  // Unmounted: nothing more to say (and StrictMode's remount decides afresh).
  useEffect(
    () => () => {
      if (moveTimer.current) clearTimeout(moveTimer.current);
      moveTimer.current = null;
      shownDecision.current = { key: null, mine: false };
    },
    [],
  );

  // A new prompt: arm its actions after the delay, and give the focus to its text when the focused button went away with the old prompt.
  useLayoutEffect(() => {
    armedAt.current = Date.now() + armDelayMs;
    const active = document.activeElement;
    if (mine && (active === null || active === document.body)) textRef.current?.focus({ preventScroll: true });
  }, [decisionId, mine, armDelayMs]);

  const armed = useCallback(() => armDelayMs <= 0 || Date.now() >= armedAt.current, [armDelayMs]);

  const send = useCallback(
    async (a: Action) => {
      if (!armed()) return;
      acted.current = true;
      setBusy(true);
      try {
        const r = await connection.act(a);
        setError(r.ok ? null : r.error);
      } finally {
        setBusy(false);
      }
    },
    [connection, armed],
  );

  const answer = useCallback(
    (a: DecisionAnswer) => {
      if (d) void send({ type: 'answer', player: d.player, decisionId: d.id, answer: a });
    },
    [d, send],
  );
  // Auto pay: a cost with only one way to pay (the engine's `onlyWay`: the same source names whichever way, no life for
  // Phyrexian mana, no X) is paid at once, without the arm delay and without showing the payment prompt. Once per decision (StrictMode runs effects twice).
  const autoPay = mine && d?.kind === 'payCost' && d.autoPayable && d.onlyWay === true;
  const autoPaid = useRef<string | null>(null);
  useEffect(() => {
    if (!autoPay || !d || autoPaid.current === d.id) return;
    autoPaid.current = d.id;
    acted.current = true;
    void connection.act({ type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'payCost', auto: true } }).then((r) => setError(r.ok ? null : r.error));
  }, [autoPay, d, connection]);

  // Auto target (owner 2026-10-21): "target opponent" (or any target choice whose one legal choice is a single opponent, with nothing else to pick) is
  // answered at once with that opponent: there is nothing to choose (CR 601.2c, 115.1). Once per decision, like auto pay.
  const onlyOpponent =
    mine && d?.kind === 'chooseTargets' && d.objects.length === 0 && d.players.length === 1 && d.min === 1 && d.players[0] !== view.viewer ? d.players[0]! : null;
  const autoTargeted = useRef<string | null>(null);
  useEffect(() => {
    if (onlyOpponent === null || !d || autoTargeted.current === d.id) return;
    autoTargeted.current = d.id;
    acted.current = true;
    void connection
      .act({ type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: onlyOpponent }] } })
      .then((r) => setError(r.ok ? null : r.error));
  }, [onlyOpponent, d, connection]);

  const cancel = useCallback(() => {
    if (d?.cancellable) void send({ type: 'cancel', player: d.player });
  }, [d, send]);

  // Keyboard shortcuts read the latest state through a ref, so the listeners are installed once.
  const latest = useRef({ mine, busy, cancel });
  latest.current = { mine, busy, cancel };
  useEffect(() => {
    let pointerFocus = false; // the focus was last moved by a mouse / touch click, not by the keyboard
    const onPointer = () => {
      pointerFocus = true;
    };
    // Capture phase: runs before the focused element's own handler (a board card presses itself on Space and calls preventDefault).
    const onKeyCapture = (e: KeyboardEvent) => {
      if (FOCUS_KEYS.includes(e.key)) pointerFocus = false;
      if (!isSpace(e) || !pointerFocus || !isPressable(e.target) || !latest.current.mine) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).blur(); // the keyup must not press it either
      if (latest.current.busy || e.repeat) return;
      keys.current.primary?.();
    };
    const onKey = (e: KeyboardEvent) => {
      const now = latest.current;
      if (e.defaultPrevented || !now.mine || now.busy) return;
      if (isSpace(e)) {
        if (keyOwnedByTarget(e.target) || e.repeat || !keys.current.primary) return;
        e.preventDefault();
        keys.current.primary();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (keys.current.escape?.()) return;
        now.cancel();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Any interaction with the prompt makes a shown rejection stale (the choice it was about is being changed).
  const clearError = () => {
    if (error) setError(null);
  };

  // M12-4b (m12 design D8, 5.3 item 6): the player on screen has left a multiplayer game that goes on (they conceded or lost): they watch the others.
  const viewerOut = !view.result && view.viewer !== null && view.players.some((p) => p.id === view.viewer && p.hasLost);
  // M12-4b (CR 800.4g-h): a decision redirected to this player because its player left the game says so above the choice.
  const redirected = mine && d ? redirectedPrompt(d.prompt) : null;
  let text: string | null;
  let body = null;
  if (view.result) text = 'The game is over.';
  else if (handoff !== null) text = `Pass the screen to ${playerName(view, handoff)}.`;
  else if (viewerOut) text = `You have left the game; it goes on for the others${d ? `. Waiting for ${playerName(view, d.player)}.` : '.'}`;
  else if (!d) text = null;
  else if (!mine) text = `Waiting for ${playerName(view, d.player)}.`;
  else if (autoPay) text = d.prompt;
  else {
    text = redirected ? redirected.rest : d.prompt;
    body = (
      <>
        {redirected && (
          <p className="prompt-redirected" role="note">
            {redirected.who} left the game: you make this choice for them ({redirected.rule}).
          </p>
        )}
        <DecisionPrompt d={d} view={view} legal={legal} answer={answer} act={(a) => void send(a)} busy={busy} />
        {d.cancellable && (
          <PromptActions className="prompt-cancel">
            <button type="button" disabled={busy} onClick={cancel} title="Esc">
              Cancel
            </button>
          </PromptActions>
        )}
      </>
    );
  }

  return (
    <KeysContext.Provider value={keys}>
      <StageHostContext.Provider value={stageHost}>
        <CardNameSearchContext.Provider value={searchCardNames}>
          <section
            className="prompt-bar"
            aria-label="Prompt"
            data-decision={mine ? d?.kind : undefined}
            onClickCapture={clearError}
            onChangeCapture={clearError}
          >
            <div className="prompt-live" aria-live="polite" aria-atomic="true">
              {text !== null && (
                <p className="prompt-text" ref={textRef} tabIndex={-1}>
                  {text} {mine && d ? <Rules rules={d.rules} /> : null}
                </p>
              )}
            </div>
            {body}
            {error && (
              <div className="prompt-error" role="alert">
                <strong>Not allowed:</strong> {error.message} <Rules rules={error.rules} />
              </div>
            )}
          </section>
        </CardNameSearchContext.Provider>
      </StageHostContext.Provider>
    </KeysContext.Provider>
  );
}
