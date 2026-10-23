/**
 * Hidden information in events (CR 400.2). `viewFor` redacts the state, but the events `applyAction` returns (for animations) are not
 * redacted by the engine: a `zoneChanged` event carries the card's name and a snapshot of it, so the opponent's draw would name the card drawn.
 * Each player gets the events with what they may not see removed: the name, the snapshot and the new object's id (H1, CR 401.4: that a card from a public
 * zone was put into a library is public, its place there may not be). Which last known information a player may see is the engine's rule (`lkiVisible`).
 *
 * RPL-0 (replays design 2, 6): one redaction for every screen. It was packages/net `game/redact.ts` (online guests and the host's own browser), and the
 * client had a weaker copy for hot-seat and games against the computer (`connection/redactEvents.ts`: moves only, no hand ids). Both now call this one;
 * a replay that switches between seats needs the stricter rules. A null viewer is the public view (the hot-seat hand-off cover, a spectator), which may
 * see no hand at all. The open view of a replay (`openView`) gets every event as the engine returned it (`open`).
 *
 * NETFIX1 (M13-2 finding): the object ids in events are the viewer's own too. `viewFor` shows another player's hidden hand cards under per-viewer aliases
 * (audit m4: an object id tells when the card was drawn, and the same id named again later links the draw to the card played), so the real id of such a
 * card in an event (a `drew` event's `objectId`, a `zoneChanged` event's `oldId` out of that hand) gave back what the view hides.
 *
 * NETFIX2 (review of NETFIX1): naming such a card by its alias gave it back too. A `drew` event naming the drawn card by its alias in the new view told
 * which card of the hand is the new one (the view hides that), the alias stays the same until the hand changes, so the `oldId` of the card when it left
 * the hand matched it ("they played the card they just drew"), and blank-versus-alias told a fresh card from a held one. So an event never names another
 * player's hand card that the viewer cannot see, by any id: every such id (the card in the hand now, in the hand before the change, or last known as having
 * left it unseen) is `UNSEEN_ID`, every time. A card the viewer's view shows by its id (revealed to the viewer, CR 701.20b) keeps it. The board animates a
 * card with no id from or to that player's hand (packages/client fx).
 */
import type { Action } from '../types/actions';
import type { GameEvent } from '../types/events';
import type { PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { replayedEvents } from './apply';
import { canSee, lkiVisible } from './view';

type ZoneChanged = Extract<GameEvent, { type: 'zoneChanged' }>;

const HIDDEN_ZONES = new Set(['library', 'hand']);

/** The id an event gives another player's hand card hidden from the viewer: nothing to find, nothing to link (one value for all such cards, NETFIX2). */
export const UNSEEN_ID = '';

/** The same rule as viewFor: another player's cancellable action in progress is shown from the state it started from (CR 733.1). */
export function hiddenActionInProgress(state: GameState, viewer: PlayerId | null): boolean {
  return state.suspended !== null && state.pending !== null && state.pending.cancellable === true && state.pending.player !== viewer && state.pending.decidedBy !== viewer; // std-control-3: nor from its controller (CR 723.5)
}

/** `rec[key]` if it is the record's own entry (event strings are names too: "constructor" is no object). */
function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** May the viewer learn which card moved? Yes if they can see it where it is now (or, if it moved on, where it was last; or where the event put it). */
function moveVisible(state: GameState, e: ZoneChanged, viewer: PlayerId | null): boolean {
  if (e.newId !== null) {
    const now = own(state.objects, e.newId);
    if (now) return canSee(state, now, viewer);
    const l = own(state.lki, e.newId);
    if (l) return lkiVisible(state, l, viewer);
  }
  return !HIDDEN_ZONES.has(e.to); // a card that ended up in a public zone is public (CR 400.2)
}

/** The state `viewer` is shown (viewFor's `shownState`): another player's cancellable action in progress from the state it started from (CR 733.1). */
function shownState(state: GameState, viewer: PlayerId | null): GameState {
  return hiddenActionInProgress(state, viewer) ? state.suspended!.base : state;
}

/** The ids of the cards of other players' hands that `viewer` cannot see in `state` as it is shown to them (every hand card for the public view). */
function hiddenHandIds(state: GameState, viewer: PlayerId | null): Set<string> {
  const shown = shownState(state, viewer);
  const out = new Set<string>();
  for (const [owner, ids] of Object.entries(shown.zones.hand)) {
    if (owner === viewer) continue;
    for (const id of ids) {
      const o = own(shown.objects, id);
      if (o && !canSee(shown, o, viewer)) out.add(id);
    }
  }
  return out;
}

/** Every string of `x` (deeply) replaced by `f`; the same value where nothing changed (events are small plain JSON values). */
function mapStrings<T>(x: T, f: (s: string) => string): T {
  if (typeof x === 'string') return f(x) as T;
  if (Array.isArray(x)) {
    const out = x.map((v) => mapStrings(v, f));
    return (out.some((v, i) => v !== x[i]) ? out : x) as T;
  }
  if (x && typeof x === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      const w = mapStrings(v, f);
      if (w !== v) changed = true;
      out[k] = w;
    }
    return (changed ? out : x) as T;
  }
  return x;
}

export interface EventsForOptions {
  /**
   * The state before the change (the state of the last view the viewer was given): a card that left another player's hand keeps its id only if the
   * viewer's view of this state showed it (revealed to the viewer). Without it every card that left another player's hand gets `UNSEEN_ID`.
   */
  before?: GameState;
  /** RPL-0: the open view of a replay (`openView`, replays design 6): every event as the engine returned it, whoever `viewer` is. */
  open?: boolean;
}

/**
 * The events of a change as `viewer` may know them, given the state right after the change (CR 400.2): nothing of another player's cancellable action in
 * progress (CR 733.1), no name, snapshot or new id of a move the viewer cannot follow, no snapshot of a card as it was in a zone hidden from the viewer,
 * and no id of another player's hand card hidden from the viewer (NETFIX1, NETFIX2). `viewer` null is the public view, which sees no hand.
 */
export function eventsFor(state: GameState, events: readonly GameEvent[], viewer: PlayerId | null, opts: EventsForOptions = {}): GameEvent[] {
  if (opts.open === true) return [...events];
  if (hiddenActionInProgress(state, viewer)) return [];
  const redacted = events.map((e): GameEvent => {
    if (e.type !== 'zoneChanged') return e;
    if (!moveVisible(state, e, viewer)) {
      const { before: _before, ...rest } = e;
      return { ...rest, name: '', newId: null };
    }
    // Another player's card that left a zone hidden from the viewer (a hand card discarded): its snapshot there is not the viewer's to see (its
    // timestamp tells when it was drawn), as the view's last known information is not (lkiVisible).
    if (e.before && e.before.object.owner !== viewer && !lkiVisible(state, e.before, viewer)) {
      const { before: _before, ...rest } = e;
      return rest;
    }
    return e;
  });
  return blankHiddenHands(state, redacted, viewer, opts);
}

/** `events` with every id of another player's hand card hidden from the viewer replaced by `UNSEEN_ID` (see the file comment). */
function blankHiddenHands(state: GameState, events: GameEvent[], viewer: PlayerId | null, opts: EventsForOptions): GameEvent[] {
  if (events.length === 0) return events;
  const now = hiddenHandIds(state, viewer);
  const then = opts.before ? hiddenHandIds(opts.before, viewer) : new Set<string>();
  const shownBefore = opts.before ? shownState(opts.before, viewer) : null;
  /** Shown by its id in the viewer's view after the change (a hand card revealed to the viewer, CR 701.20b, or any card in a public zone). */
  const shownNow = (id: string): boolean => {
    const o = own(state.objects, id);
    return o !== undefined && canSee(state, o, viewer);
  };
  /** Shown by its id in the viewer's view before the change (a card revealed to the viewer; one revealed only as it was cast, CR 601.2a, was not). */
  const shownThen = (id: string): boolean => {
    const o = shownBefore ? own(shownBefore.objects, id) : undefined;
    return o !== undefined && canSee(shownBefore!, o, viewer);
  };
  /** A card last known in another player's hand that the viewer's view before the change did not show by its id (without the state before: none was). */
  const leftHiddenHand = (id: string): boolean => {
    const l = own(state.lki, id);
    return l !== undefined && l.leftZone === 'hand' && l.object.owner !== viewer && !shownThen(id);
  };
  const blank = (id: string): string => {
    if (now.has(id)) return UNSEEN_ID;
    if (shownNow(id)) return id;
    if (then.has(id) || leftHiddenHand(id)) return UNSEEN_ID;
    return id;
  };
  return events.map((e) => {
    const out = mapStrings(e, blank);
    // What the ids above cannot recognize (a card drawn and gone again with nothing left of it, such as a mulligan's hand, CR 103.5): another player's
    // draw, and a card leaving their hand, name a card only if a view of the viewer shows it by that id.
    if (out.type === 'drew' && out.player !== viewer && out.objectId !== UNSEEN_ID && !shownNow(out.objectId)) return { ...out, objectId: UNSEEN_ID };
    if (out.type === 'zoneChanged' && out.from === 'hand' && out.owner !== viewer && out.oldId !== UNSEEN_ID && !shownNow(out.oldId) && !shownThen(out.oldId)) {
      return { ...out, oldId: UNSEEN_ID };
    }
    return out;
  });
}

/**
 * How many of the events `applyAction(prev, action)` returned a perspective was given already, to drop before `eventsFor` (replays design 8: a replay's
 * events are the action's batch minus these, as `LocalConnection` does). Answering a decision runs the suspended action again from the state it started
 * from, so its events begin with the ones reported when it stopped (`Suspension.emitted`):
 *  - a seat or the public view: `replayedEvents` (none for a viewer from whom `prev` hid another player's cancellable action in progress, CR 733.1);
 *  - the open view (`open`, RPL-0 review): it was given every event at the stop, whoever was deciding (`eventsFor` with `open`), so all of them are
 *    replayed. With the public view's count it was shown them twice (a card moving to the stack animated again).
 * Only the newest stop is known (see `replayedEvents`).
 */
export function replayedEventsFor(prev: GameState, action: Action, viewer: PlayerId | null, opts: Pick<EventsForOptions, 'open'> = {}): number {
  if (opts.open !== true) return replayedEvents(prev, action, viewer);
  const sus = prev.suspended;
  return action.type === 'answer' && sus !== null && sus.emitted !== undefined ? sus.emitted : 0;
}
