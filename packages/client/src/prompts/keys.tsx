/**
 * Keyboard shortcuts of the prompt bar (docs/design/m8-client.md "Visual design"): Space = the prompt's OK / pass, Esc = close an open menu, otherwise
 * cancel a cancellable decision (CR 733.1). A prompt names its OK action with `usePrimary` and an Esc handler with `useEscape`.
 */
import { createContext, useContext, useEffect, useRef, type MutableRefObject } from 'react';

export interface KeyHandlers {
  primary: (() => void) | null;
  escape: (() => boolean) | null;
}

export const KeysContext = createContext<MutableRefObject<KeyHandlers> | null>(null);

/** Register the prompt's OK action (null or `enabled = false`: Space does nothing). */
export function usePrimary(fn: (() => void) | null, enabled = true): void {
  const ref = useContext(KeysContext);
  const latest = useRef(fn);
  latest.current = enabled ? fn : null;
  useEffect(() => {
    if (!ref) return;
    ref.current.primary = () => latest.current?.();
    return () => {
      ref.current.primary = null;
    };
  }, [ref]);
}

/** Register an Esc handler that runs before cancel; return true when it handled the key (closed a menu, cleared a pick). */
export function useEscape(fn: () => boolean): void {
  const ref = useContext(KeysContext);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!ref) return;
    ref.current.escape = () => latest.current();
    return () => {
      ref.current.escape = null;
    };
  }, [ref]);
}

/** Space is left to the element when typing or when a button, link or form control has the focus (it activates that element itself). */
export function keyOwnedByTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName);
}

const PRESSABLE_ROLES = ['button', 'option', 'menuitem', 'checkbox', 'radio', 'switch', 'tab'];

/**
 * An element that Space would "press" (a button, link, check box or a `role="button"` element such as C4's board cards), as opposed to a text field or a
 * select, where Space types or opens. After a mouse click focused such an element, Space means the prompt's OK, not "press it again" (which would undo the
 * click: a chosen target, attacker or mana source would be toggled off).
 */
export function isPressable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.isContentEditable) return false;
  if (target.tagName === 'BUTTON' || target.tagName === 'A') return true;
  if (target.tagName === 'INPUT') return ['checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type);
  if (['TEXTAREA', 'SELECT'].includes(target.tagName)) return false;
  return PRESSABLE_ROLES.includes(target.getAttribute('role') ?? '');
}

/** Keys that move the focus by keyboard: after one of them the focused element was chosen with the keyboard and keeps its own Space. */
export const FOCUS_KEYS = ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
