/**
 * RPL-4 (replays design 11; roadmap "In-game bug reports": "recent client errors"): the errors this page caught, kept for a bug report's `errors`. The
 * page's uncaught errors, its unhandled promise rejections and what its code reports with `console.error` (every module logs what it caught that way:
 * "[LocalConnection] engine error", "[Replays] ...") are kept here, the newest `ERROR_TRAIL_SIZE`, each cut to the bounds the report validator
 * allows (engine replay/validate.ts). Nothing leaves the page: a report holds them only when the player saves one, and the dialog lists them first.
 *
 * Installed once by main.tsx. Tests record into it directly (`recordError`) and empty it (`clearErrorTrail`).
 */
import type { BugReportFile } from '@openmtg/engine';

export type CaughtError = BugReportFile['errors'][number];

/** How many errors are kept (the newest). */
export const ERROR_TRAIL_SIZE = 20;
/** The longest message and stack kept (the validator allows 10,000 and 50,000). */
export const ERROR_MESSAGE_MAX = 2000;
export const ERROR_STACK_MAX = 8000;
/** The longest text one logged value adds to a message (an action, a decision: never a whole state). */
const VALUE_MAX = 500;

const trail: CaughtError[] = [];

function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** One value of a `console.error` call as text: an error by its name and message, a string as it is, anything else as JSON (bounded). */
function valueText(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return String(v);
  try {
    return cut(JSON.stringify(v) ?? String(v), VALUE_MAX);
  } catch {
    return cut(String(v), VALUE_MAX);
  }
}

/** Keep an error (the oldest goes once there are `ERROR_TRAIL_SIZE`). */
export function recordError(message: string, stack?: string, time: string = new Date().toISOString()): void {
  const e: CaughtError = { message: cut(message, ERROR_MESSAGE_MAX), time };
  if (stack !== undefined && stack !== '') e.stack = cut(stack, ERROR_STACK_MAX);
  trail.push(e);
  if (trail.length > ERROR_TRAIL_SIZE) trail.splice(0, trail.length - ERROR_TRAIL_SIZE);
}

/** What `console.error(...args)` reported, as one error (the stack of the first Error among the values). */
export function recordLogged(args: readonly unknown[]): void {
  const error = args.find((a): a is Error => a instanceof Error);
  recordError(args.map(valueText).join(' '), error?.stack);
}

/** The errors kept, oldest first (copies). */
export function recentErrors(): CaughtError[] {
  return trail.map((e) => ({ ...e }));
}

/** Tests only: forget every error kept. */
export function clearErrorTrail(): void {
  trail.length = 0;
}

let installed: (() => void) | null = null;

/**
 * Start keeping the page's errors (once; a second call does nothing). `console.error` still prints as before. Returns the function that stops it and
 * puts `console.error` back.
 */
export function installErrorTrail(win: Window = window): () => void {
  if (installed) return installed;
  const original = console.error;
  // The original console.error, then the trail; a failure to record never stops the logging.
  const logged = (...args: unknown[]): void => {
    original.apply(console, args);
    try {
      recordLogged(args);
    } catch {
      // nothing: the trail is a help, never a new failure
    }
  };
  const onError = (e: ErrorEvent) => {
    const err: unknown = e.error;
    recordError(err instanceof Error ? `${err.name}: ${err.message}` : e.message || 'An error', err instanceof Error ? err.stack : undefined);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason;
    recordError(`Unhandled rejection: ${valueText(r)}`, r instanceof Error ? r.stack : undefined);
  };
  console.error = logged;
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  installed = () => {
    if (console.error === logged) console.error = original;
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
    installed = null;
  };
  return installed;
}
