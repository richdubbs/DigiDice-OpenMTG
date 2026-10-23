/**
 * The hosted server's errors in words a player can act on (hosted design 3.4 error codes): the replies' `HostedError`s and the link's own
 * (HostedLink.ts: the socket dropped before an answer, no answer in time). The server's own message is kept where it says something specific.
 */
import type { HostedError, HostedErrorCode } from '@openmtg/hosted/api';

/** An error code of a reply, or of the link itself. */
export type LinkErrorCode = HostedErrorCode | 'disconnected' | 'timeout';

export interface LinkError extends Omit<HostedError, 'code'> {
  code: LinkErrorCode;
}

export interface ExplainedHostedError {
  /** One sentence: what went wrong. */
  message: string;
  /** What to do about it (absent when the message says it all). */
  hint?: string;
  /** Lines to list (a deck's problems). */
  details?: string[];
}

/** "about 3 minutes" for a retry time (seconds under a minute); a few minutes when the server did not say. */
export function waitText(ms: number | undefined): string {
  if (ms === undefined) return 'a few minutes';
  if (ms < 55_000) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return seconds === 1 ? 'a second' : `about ${seconds} seconds`;
  }
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

export function explainHostedError(e: LinkError): ExplainedHostedError {
  const details = e.details?.length ? { details: [...e.details] } : {};
  switch (e.code) {
    case 'disconnected':
      return {
        message: e.message || 'The connection to the server dropped before it answered.',
        hint: 'Look at the table again: if it did not happen, do it once more.',
      };
    case 'timeout':
      return { message: 'The server did not answer in time.', hint: 'Check the table before you try again: it may have gone through.' };
    case 'stale':
      return { message: 'The game moved on before that action arrived.', hint: 'Look at the board again and choose once more.' };
    case 'rateLimited':
      // A pause the server names (joining after too many wrong passwords, quick match after missed confirmations, one report a minute) is told in full;
      // the short ones are only "too fast".
      if (e.retryAfterMs !== undefined && e.retryAfterMs > 5000) return { message: e.message, hint: `Please try again in ${waitText(e.retryAfterMs)}.` };
      return { message: 'Too many actions at once; wait a moment.' };
    case 'deckRejected':
      return { message: 'The deck was refused for this table.', hint: e.message, ...details };
    case 'version':
      return { message: 'This page and the game server are different versions.', hint: 'Update OpenMTG, then try again.' };
    case 'tableFull':
      return { message: 'That table is full.', hint: 'Ask the player who made it for a new invite code.' };
    case 'badCode':
      return {
        message: 'That invite code is not valid.',
        hint: 'Check it with the player who made the table (sixteen letters and digits). A code works once, and only until the game starts.',
      };
    case 'badPassword':
      return { message: e.message || 'That is not the password.' };
    case 'noTable':
      return { message: 'That table is gone.', hint: 'It may have started without you, or the player who made it left.' };
    case 'serverBusy':
      return { message: 'The server is busy right now.', hint: `Please try again in ${waitText(e.retryAfterMs)}.` };
    case 'draining':
      return { message: 'The server is restarting soon, so no new games can start.', hint: 'Try again in a few minutes.' };
    case 'notStarted':
      return { message: e.message || 'You are not in a game right now.' };
    default:
      // badMessage, illegalAction, notYourPlayer, engineError, manualRejected, busy, limitReached, notYet, notAllowed: the server's own words say it
      // (with the wait it names, when it names one)
      return { message: e.message, ...(e.retryAfterMs !== undefined ? { hint: `Please try again in ${waitText(e.retryAfterMs)}.` } : {}), ...details };
  }
}

/** The error as one text for a line under a button (the message, then the hint). */
export function hostedErrorText(e: LinkError): string {
  const x = explainHostedError(e);
  return x.hint ? `${x.message} ${x.hint}` : x.message;
}
