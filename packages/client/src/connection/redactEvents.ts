/**
 * Hidden information in events (CR 400.2), for the board's animations. `viewFor` redacts the state, but the events `applyAction` returns are not redacted by
 * the engine: a `zoneChanged` event carries the card's name and a snapshot of it, so the opponent's draw would name the card drawn.
 *
 * RPL-0 (replays design 2, 6): this delegates to the engine's `eventsFor` (core/view-events.ts), the same function packages/net uses for online guests, so
 * local games get its stricter rules too: besides a move the viewer may not follow losing its name, its snapshot and the new object's id (H1, CR 401.4),
 * no event names another player's hand card hidden from the viewer by any id (NETFIX1, NETFIX2). `viewer` null is the public view (the hot-seat hand-off
 * cover), which sees no hand.
 */
import { eventsFor, type EventsForOptions, type GameEvent, type GameState, type PlayerId } from '@openmtg/engine';

/**
 * The events of an action as `viewer` may see them, given the state right after the action. `opts.before`: the state of the last view this viewer was
 * shown, so a card of another player's hand that was revealed to the viewer keeps its id as it leaves that hand.
 */
export function eventsForViewer(state: GameState, events: readonly GameEvent[], viewer: PlayerId | null, opts: EventsForOptions = {}): GameEvent[] {
  return eventsFor(state, events, viewer, opts);
}
