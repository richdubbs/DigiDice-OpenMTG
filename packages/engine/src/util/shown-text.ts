/**
 * Text that is shown on screens and in terminals (player names, chat, reasons, titles) carries no control characters: C0 and C1 controls (ESC starts
 * terminal escape sequences: screen clearing, window titles, OSC 52 clipboard writes), DEL, and the Unicode line separators and bidirectional overrides
 * that can make text read other than it is.
 *
 * RPL-0 review: moved from packages/net (`protocol/text.ts`, which re-exports it), so the replay validator, the online protocol and the browser's own
 * game setup clean and check names by one rule: a name typed for a local game is cleaned as an online guest's is, and a replay that records it is not
 * refused by its own import.
 *
 * Browser-safe: plain strings only.
 */

/** The ranges of control characters, by code point. */
export const CONTROL_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x00, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069],
] as const);
/** The ranges as the body of a regular expression character class. */
export const CONTROL_CLASS = CONTROL_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('');
const CONTROL = new RegExp(`[${CONTROL_CLASS}]`, 'g');
const ANY_CONTROL = new RegExp(`[${CONTROL_CLASS}]`);

/** The text without control characters. */
export function cleanText(s: string): string {
  return s.replace(CONTROL, '');
}

/** Does the text hold a control character? */
export function hasControl(s: string): boolean {
  return ANY_CONTROL.test(s);
}
