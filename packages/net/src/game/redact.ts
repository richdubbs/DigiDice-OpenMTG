/**
 * Hidden information in events (CR 400.2): each player gets the events of a change with what they may not see removed (the name, the snapshot and the
 * new object's id of a move they cannot follow, and every id of another player's hand card hidden from them: NETFIX1, NETFIX2).
 *
 * RPL-0 (replays design 2, 6): the rules moved to the engine (`core/view-events.ts#eventsFor`), so the online host, the browser's local games and replays
 * redact events with one function. This module keeps net's names for the host (host.ts) and the tests.
 */
export { eventsFor, hiddenActionInProgress, UNSEEN_ID, type EventsForOptions } from '@openmtg/engine';
