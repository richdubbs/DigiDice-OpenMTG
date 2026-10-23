/**
 * What the hosted screens need from the rest of the app, as one small adapter (tests pass their own): the decks a player can pick (like New game) and a new
 * link to the hosted server. The server's address is `GET /api/status`'s `hostedUrl` (hosted/config.ts).
 */
import type { DeckList } from '@openmtg/server/api';
import type { HostedDeck } from '@openmtg/hosted/api';
import { defaultServices, type GameDeck } from '../../game/services';
import { HostedLink } from '../HostedLink';
import { hostedStorageFor } from '../storage';

export interface HostedServices {
  /** The decks a player can pick (the deck library and the practice decks, like New game). */
  listDecks(): Promise<GameDeck[]>;
  /** A new link to the hosted server at `server` (its WebSocket origin), saying `name` (not connected yet). */
  openLink(server: string, name: string): HostedLink;
}

export const defaultHostedServices: HostedServices = {
  listDecks: () => defaultServices.listDecks(),
  openLink: (server, name) => new HostedLink({ server, name, storage: hostedStorageFor(server) }),
};

/**
 * The deck as the server takes it: names and counts of the main deck and the sideboard (the sideboard stays outside the game, CR 100.4), the commander
 * section when the deck has one (CR 903.3, 702.124) and the companion (CR 702.139a). The deck library stays on the player's machine; the server finds the
 * cards by name and checks the deck for the table's format.
 */
export function toHostedDeck(deck: DeckList): HostedDeck {
  const keep = (list: readonly { name: string; count: number }[] | undefined) => (list ?? []).filter((e) => e.count > 0).map((e) => ({ name: e.name, count: e.count }));
  const commander = keep(deck.commander);
  const companion = keep(deck.companion);
  return { main: keep(deck.main), sideboard: keep(deck.sideboard), ...(commander.length > 0 ? { commander } : {}), ...(companion.length > 0 ? { companion } : {}) };
}
