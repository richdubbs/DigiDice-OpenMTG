/**
 * RPL-2 (replays design 9, "Keys"): Space play and pause, Left and Right a step, Shift+Left and Shift+Right a turn, `[` and `]` the speed, Home and End
 * the start and the end, Esc leaves the replay.
 *
 * The keys are read on the window in the capture phase, before the table's camera (which pans with the arrows and recentres with Home) and the
 * timeline slider: on the replay screen these keys belong to the replay. They are left alone while the player types or works a select (which uses the
 * arrows and Space itself), with a modifier held, and Space on a button or check box focused with the keyboard presses that control as usual (after a
 * mouse click, Space means play or pause, as in the prompt bar). Esc is left to an open dialog, menu or card zoom, which it closes.
 */
import { useEffect, useRef } from 'react';
import type { ReplayController } from '../../connection/ReplayConnection';
import { isPressable } from '../../prompts/keys';

/** A text field, a select or editable text: the key is the control's own. */
function ownedByControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  return !['range', 'checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type);
}

/** Something Esc should close first: a dialog (a zone viewer, the game bar's confirms), the game menu, or a card zoom. */
function somethingToClose(): boolean {
  return document.querySelector('[role="dialog"], #game-menu, .zoom:not(.zoom-empty)') !== null;
}

export function useReplayKeys(controller: ReplayController, onLeave: () => void): void {
  const leave = useRef(onLeave);
  leave.current = onLeave;
  useEffect(() => {
    let pointerFocus = false;
    const onPointer = () => {
      pointerFocus = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') pointerFocus = false;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || ownedByControl(e.target)) return;
      const c = controller;
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          if (isPressable(e.target) && !pointerFocus) return;
          if (e.repeat) break;
          if (isPressable(e.target)) (e.target as HTMLElement).blur(); // the keyup must not press it either
          c.toggle();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) c.previousTurn();
          else c.step(-1);
          break;
        case 'ArrowRight':
          if (e.shiftKey) c.nextTurn();
          else c.step(1);
          break;
        case '[':
          c.changeSpeed(-1);
          break;
        case ']':
          c.changeSpeed(1);
          break;
        case 'Home':
          c.seek(0);
          break;
        case 'End':
          c.seek(c.state().last);
          break;
        case 'Escape':
          if (somethingToClose()) return;
          leave.current();
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [controller]);
}
