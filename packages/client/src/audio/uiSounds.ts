/**
 * The interface sounds every screen gets without writing them (docs/design/sound.md): delegated listeners on the page (main.tsx installs them on the
 * document) that turn ordinary controls into ui.* sounds, so a new button, checkbox or text field is never silent.
 *
 * - click on a button, [role=button], a link, a summary or a label styled as a button: the element's `data-sfx` (a sound id, or "none" to stay silent);
 *   else ui.confirm for a primary or submit button, ui.cancel for Back and for Cancel, Close, Clear, Dismiss or Skip, but ui.close for a Cancel,
 *   Close or Dismiss inside a dialog (it folds the dialog away: one sound per action, never cancel and close together; a confirm that closes its
 *   dialog is only the confirm); ui.open / ui.close for a summary (its panel opens or folds away); else ui.click. A handler that played a more specific sound for the same click wins: the page counts the sounds
 *   asked for (SoundEngine.playCount) when the click starts (capture phase) and plays the generic sound only if nothing was played by the time the
 *   click and React's work for it are done (a microtask after the bubble phase, so a dialog's ui.open on mount or a ui.navigate also count).
 * - change: a checkbox -> ui.toggleOn / ui.toggleOff; a radio or a select -> ui.select. A slider moving -> ui.tick (rate-limited).
 * - a printable key, Backspace or Delete in a text field -> ui.type (rate-limited; never Enter, Escape or a shortcut with Ctrl, Alt or Meta).
 * - the mouse or pen entering a button or link (not moving between its children) -> ui.hover (rate-limited).
 *
 * Inside an element marked data-sfx-scope="manual" (the game board) none of this plays: that code makes its own sounds.
 */
import { SOUND_META, type SoundId } from './catalog';
import type { SoundPlayer } from './engine';
import { soundEngine } from './sfx';

/** What the delegation needs of the engine: play, and the count of sounds asked for (to see whether a handler already made one). */
export type UiSoundPlayer = SoundPlayer & { readonly playCount: number };

export interface UiSoundOptions {
  /** Milliseconds clock for the rate limits (tests pass their own). */
  now?: () => number;
}

/** The shortest gaps between two of these sounds (a sweep across a toolbar, a dragged slider, fast typing). */
export const HOVER_GAP_MS = 70;
export const TICK_GAP_MS = 45;
export const TYPE_GAP_MS = 35;

const PRESSABLE = 'button, [role="button"], a[href], summary, label.button, input[type="button"], input[type="submit"], input[type="reset"]';
const HOVERABLE = 'button, [role="button"], a[href]';
const MANUAL_SCOPE = '[data-sfx-scope="manual"]';
/** Text fields: the input types a player types into. */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);
/** Accessible names that mean "back out" (catalog: ui.cancel). "Done" closes the deckbuilder having kept everything, so it is a confirm. */
const CANCEL_WORDS = /^(cancel|back|close|clear|dismiss|skip)\b/i;
/** Inside a dialog these close it ("Clear search" in a dialog only clears its field, Back is a screen's). */
const CLOSE_WORDS = /^(cancel|close|dismiss)\b/i;
const DIALOG = '[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]';

/** The first element on the event's path (fixed when it was dispatched, so a control React removed meanwhile still counts) matching `selector`. */
function onPath(e: Event, selector: string): Element | null {
  for (const node of e.composedPath()) if (node instanceof Element && node.matches(selector)) return node;
  return null;
}

function inManualScope(e: Event): boolean {
  return onPath(e, MANUAL_SCOPE) !== null;
}

function isDisabled(el: Element): boolean {
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.disabled;
}

function accessibleText(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
}

function isSoundId(v: string): v is SoundId {
  return Object.prototype.hasOwnProperty.call(SOUND_META, v);
}

/** The sound a press of `el` makes (null: silent). */
export function clickSound(el: Element): SoundId | null {
  const own = el.getAttribute('data-sfx');
  if (own === 'none') return null;
  if (own && isSoundId(own)) return own;
  if (el instanceof HTMLElement && el.tagName === 'SUMMARY') {
    const details = el.parentElement;
    // The click comes before the toggle: a closed panel is about to open.
    return details instanceof HTMLDetailsElement && details.open ? 'ui.close' : 'ui.open';
  }
  if (el.matches('.screen-back, .deck-back')) return 'ui.cancel';
  if (el.matches('.button-primary, button[type="submit"], input[type="submit"]')) return 'ui.confirm';
  const text = accessibleText(el);
  if (CLOSE_WORDS.test(text) && el.closest(DIALOG)) return 'ui.close';
  if (CANCEL_WORDS.test(text)) return 'ui.cancel';
  return 'ui.click';
}

function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.getAttribute('type')?.toLowerCase() ?? '') && !el.readOnly && !el.disabled;
}

/** A key that types or erases a character (not Enter, Escape, Tab, arrows, or a shortcut). */
function isTypingKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  return e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete';
}

/**
 * Installs the delegated interface sounds on `root` (the document, or an element in tests); returns the uninstall. Only one install per page: two
 * would play every sound twice.
 */
export function installUiSounds(root: Document | HTMLElement, player: UiSoundPlayer = soundEngine(), opts: UiSoundOptions = {}): () => void {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const last = new Map<SoundId, number>();
  /** Plays `id` unless the same sound played less than `gap` ms ago. */
  const limited = (id: SoundId, gap: number) => {
    const t = now();
    const prev = last.get(id);
    if (prev !== undefined && t - prev < gap) return;
    last.set(id, t);
    player.play(id);
  };

  let countAtClick = 0;
  const onClickCapture = () => {
    countAtClick = player.playCount;
  };
  const onClick = (e: Event) => {
    if (inManualScope(e)) return;
    const el = onPath(e, PRESSABLE);
    if (!el || isDisabled(el)) return;
    const id = clickSound(el);
    if (!id) return;
    const before = countAtClick;
    // React renders the click's state change in a microtask queued during the click (React 18), so its sounds (a dialog's ui.open, ui.navigate)
    // are counted by the time this one runs.
    queueMicrotask(() => {
      if (player.playCount === before) player.play(id);
    });
  };

  const onChange = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement) || inManualScope(e)) return;
    if (t instanceof HTMLSelectElement) return player.play('ui.select');
    if (t.type === 'checkbox') return player.play(t.checked ? 'ui.toggleOn' : 'ui.toggleOff');
    if (t.type === 'radio') return player.play('ui.select');
  };

  const onInput = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'range' && !inManualScope(e)) limited('ui.tick', TICK_GAP_MS);
  };

  const onKey = (e: Event) => {
    const k = e as KeyboardEvent;
    if (!isTypingKey(k) || !isTextField(k.target) || inManualScope(e)) return;
    limited('ui.type', TYPE_GAP_MS);
  };

  const onOver = (e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerType !== 'mouse' && p.pointerType !== 'pen') return;
    if (inManualScope(e)) return;
    const el = onPath(e, HOVERABLE);
    if (!el || isDisabled(el)) return;
    // Moving from the button's label onto its icon is not entering it.
    const from = p.relatedTarget instanceof Element ? p.relatedTarget.closest(HOVERABLE) : null;
    if (from === el) return;
    limited('ui.hover', HOVER_GAP_MS);
  };

  const listeners: [string, (e: Event) => void, boolean][] = [
    ['click', onClickCapture, true],
    ['click', onClick, false],
    ['change', onChange, false],
    ['input', onInput, false],
    ['keydown', onKey, false],
    ['pointerover', onOver, false],
  ];
  for (const [type, fn, capture] of listeners) root.addEventListener(type, fn, capture);
  return () => {
    for (const [type, fn, capture] of listeners) root.removeEventListener(type, fn, capture);
  };
}
