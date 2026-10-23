/**
 * Online errors in words a player can act on (milestone 9): the server's reply errors (`OnlineError`, packages/server/src/online/api.ts) and the link's
 * own (OnlineLink.ts), each with what to check. The server's own message is kept as the detail: it names the port, the address or the deck problem.
 * M12-5b: a 3-4 player game's `gameFull` (a seat taken, its code spent) and `notStarted` (every seat must be taken) have their own words.
 */
import type { OnlineError } from '@openmtg/server/online';

export interface ExplainedError {
  /** One sentence: what went wrong. */
  message: string;
  /** What to do about it (absent when the message says it all). */
  hint?: string;
  /** Lines to list (a deck's problems). */
  details?: string[];
}

/** `port`: the UDP port the guest tried or the host chose, for the port-forwarding hint. */
export function explainOnlineError(e: OnlineError, ctx: { port?: number } = {}): ExplainedError {
  const port = ctx.port !== undefined ? `UDP ${ctx.port}` : 'the game port (UDP)';
  const details = e.details?.length ? { details: [...e.details] } : {};
  switch (e.code) {
    case 'badCode':
      return {
        message: 'Wrong join code: the host did not accept it.',
        hint: 'Check the code with the host (four groups of four letters and digits). A host who leaves and hosts again gets a new code.',
      };
    case 'timeout':
      return {
        message: 'The host did not answer in time.',
        hint:
          `Check the address and the port, and that the host is still on the "Waiting for the other player" screen. The host's router must forward ${port} ` +
          "to the host's PC, and the host's firewall must allow OpenMTG (Node.js) on that port.",
      };
    case 'hostNotFound':
      return { message: 'That address could not be found.', hint: `${e.message} Check the address the host gave you: an IP address such as 203.0.113.7, or a name.` };
    case 'version':
      return {
        message: 'The two OpenMTG versions do not match.',
        hint: `${e.message} Both players need the same OpenMTG version: update the older one, then try again.`,
      };
    case 'rulesPack':
      return { message: 'The two rules packs do not match.', hint: `${e.message} Both players need the same rules pack: update the older one.` };
    case 'gameFull':
      // M12-5b: in a 3-4 player game each join code admits one player into its seat; a code that seated someone already is spent.
      return /seat/i.test(e.message)
        ? { message: 'That seat is taken.', hint: `${e.message} Each join code admits one player: ask the host for the code of a seat that is still open.` }
        : { message: 'The host already has another player in this game.', hint: 'Ask the host to leave and host a new game.' };
    case 'deckRejected':
      return { message: 'The deck was refused for this game.', hint: e.message, ...details };
    case 'portInUse':
      return { message: e.message, hint: 'Pick another port (and forward that one on the router instead), or close the program that uses it.' };
    case 'noCardData':
      return { message: 'Hosting needs the card data on this PC.', hint: e.message };
    case 'busy':
      return { message: 'A game is already open on this OpenMTG server.', hint: 'Return to it, or leave it first.' };
    case 'disconnected':
      return { message: e.message || 'Lost the connection.', hint: 'Check that OpenMTG is still running; the game waits for a short while.' };
    case 'closed':
      return { message: e.message || 'The game is closed.' };
    case 'stale':
      return { message: 'The game moved on before that action arrived.', hint: 'Look at the board again and choose once more.' };
    case 'notStarted':
      return { message: /every seat/i.test(e.message) ? 'The game starts when every seat is taken.' : 'The game starts when the other player joins.' };
    case 'rateLimited':
      return { message: 'Too many actions at once; wait a moment.' };
    case 'manualRejected':
      return { message: e.message || 'The host did not accept your adjustments by hand.' };
    case 'badMessage':
      return { message: e.message, ...details };
    default:
      return { message: e.message, ...details };
  }
}
