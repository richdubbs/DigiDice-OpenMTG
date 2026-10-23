/**
 * Text that crosses the network (player names, chat, reasons, error messages) is shown in terminals and UIs, so it carries no control characters:
 * C0 and C1 controls (ESC starts terminal escape sequences: screen clearing, window titles, OSC 52 clipboard writes), DEL, and the Unicode
 * line separators and bidirectional overrides that can make text read other than it is.
 *
 * RPL-0 review: the rule is the engine's (`util/shown-text.ts`), shared with the replay validator and the browser's game setup.
 */
import { CONTROL_CLASS, cleanText, hasControl } from '@openmtg/engine';

export { cleanText, hasControl };

const CONTROL = new RegExp(`[${CONTROL_CLASS}]`, 'g');

/** For printing anything that came from the network to a terminal: each control character becomes a visible escape such as "\x1b". */
export function printable(s: string): string {
  return s.replace(CONTROL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
