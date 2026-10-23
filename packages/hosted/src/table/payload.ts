/**
 * Everything of the game that leaves the table (design 6.3). One function builds what a seat receives about the game, `seatPayload`: `viewFor` for
 * that seat only, the change's events through net's `eventsFor` (CR 400.2) with hidden hand ids aliased (`seatEvents`), the seat's `legalActions`, and the patch between that seat's last view and
 * its new one (`diffViews`, computed on the views as they are serialized: a patch can carry nothing a view does not carry, and the browser's result is
 * the next view, design D8). The state, the seed, the RNG, `suspended`, other seats' decks and the action log never leave the table.
 *
 * The other things a seat receives are not game state: by-hand change proposals described for each approver from the full state with `canSee`
 * (`proposalView`, CR 400.2), the clocks (public), notices (fixed texts), chat, and the result with public placements only.
 */
import { canSee, legalActions, unaliasAction, viewFor, type GameEvent, type GameState, type GameView, type ManualOp, type PlayerId } from '@openmtg/engine';
import { describeOps, eventsFor, unaliasOps } from '@openmtg/net/server-kit';
import { diffViews, type ProposalView, type SeatNumber } from '../api';

/** A seat's last view as its connection holds it (the patch base) and its serialized form (the `sync` cache: design 2.1). */
export interface SeatBase {
  seq: number;
  /** The view as the browser parsed it (`JSON.parse` of `viewJson`): what patches are computed against. */
  view: GameView;
  viewJson: string;
  /** The seat's legal priority actions at `seq`, serialized. */
  legalJson: string;
}

/**
 * The real id -> alias of every hidden hand card of another player in `view` (the m4 aliases of `viewFor`), recovered with the engine's own
 * `unaliasAction` (the translation `applyAction` makes): the view lists the aliases, the engine maps them back.
 */
function handAliasMap(state: GameState, viewer: PlayerId, view: GameView): Map<string, string> {
  const aliases: string[] = [];
  for (const p of view.players) if (p.id !== viewer) for (const id of view.zones.hand[p.id] ?? []) if (!state.objects[id]) aliases.push(id);
  const out = new Map<string, string>();
  if (aliases.length === 0) return out;
  const real = unaliasAction(state, { player: viewer, ids: aliases }).ids;
  real.forEach((id, i) => {
    if (id !== aliases[i]) out.set(id, aliases[i]!);
  });
  return out;
}

/** `x` with every string that is a key of `map` replaced by its value (events are small plain JSON values). */
function swapIds<T>(x: T, map: ReadonlyMap<string, string>): T {
  if (typeof x === 'string') return (map.get(x) ?? x) as T;
  if (Array.isArray(x)) return x.map((v) => swapIds(v, map)) as T;
  if (x && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = swapIds(v, map);
    return o as T;
  }
  return x;
}

/**
 * The change's events for one seat: net's `eventsFor` (names, snapshots and new ids of moves the seat cannot see removed, CR 400.2), and then no
 * event names another player's hidden hand card at all, by real id or by alias (M13-2 findings and re-review A: an alias in a `drew` that matched the
 * `oldId` of a later cast showed "they played the card they just drew"; blank-or-alias told fresh cards from held ones):
 * - a `drew` of another player names its card only when the seat can see it now (a real id that is an object of the seat's new view), else '';
 * - a `zoneChanged` out of another player's hand names the card only when the seat's previous view showed it (a revealed card: its real id is an
 *   object of `prev.view`), else '';
 * - any other string that is the real id of another player's hidden hand card, before or after the change, is ''.
 * The client takes '' as an unknown origin (client/src/board/fx/plan.ts). NETFIX2 (fix/netfix2) makes net's `eventsFor` do the same; once it is merged
 * this may call it alone through the server kit.
 */
export function seatEvents(state: GameState, events: readonly GameEvent[], viewer: PlayerId, view: GameView, prev: { state: GameState; view: GameView } | null = null): GameEvent[] {
  const redacted = eventsFor(state, events, viewer);
  if (redacted.length === 0) return redacted;
  const hidden = new Map<string, string>();
  for (const id of handAliasMap(state, viewer, view).keys()) hidden.set(id, '');
  if (prev) for (const id of handAliasMap(prev.state, viewer, prev.view).keys()) hidden.set(id, '');
  const out = hidden.size === 0 ? redacted : swapIds(redacted, hidden);
  return out.map((e) => {
    if (e.type === 'drew' && e.player !== viewer && e.objectId !== '' && !(e.objectId in view.objects && state.objects[e.objectId])) return { ...e, objectId: '' };
    if (e.type === 'zoneChanged' && e.from === 'hand' && e.owner !== viewer && e.oldId !== '' && !(prev && e.oldId in prev.view.objects && prev.state.objects[e.oldId])) return { ...e, oldId: '' };
    return e;
  });
}

export interface SeatPayload {
  /** The new patch base. */
  base: SeatBase;
  /** `view` (a full view) or `patch`. */
  t: 'view' | 'patch';
  /** The message, serialized. */
  json: string;
}

/** The full-view message of a base, without events (join, reconnect, `sync`, catch-up): the cached serialized view, no new work. */
export function fullViewJson(base: SeatBase, eventsJson = '[]'): string {
  return `{"t":"view","seq":${base.seq},"view":${base.viewJson},"events":${eventsJson},"legal":${base.legalJson}}`;
}

/**
 * The one function that builds what a seat receives about the game after a change (design 6.3): the seat's view at `seq`, the change's `events`
 * redacted for the seat (`seatEvents`; `prevState` is the state `last` was the view of), its legal actions, and either a full view (no `last`: a new
 * or returning connection) or a patch against `last` (the view the connection received last). A patch larger than the full view is sent as the full
 * view.
 */
export function seatPayload(state: GameState, player: PlayerId, seq: number, events: readonly GameEvent[], last: SeatBase | null, prevState: GameState | null = null): SeatPayload {
  const view = viewFor(state, player);
  const viewJson = JSON.stringify(view);
  const base: SeatBase = { seq, view: JSON.parse(viewJson) as GameView, viewJson, legalJson: JSON.stringify(legalActions(state, player)) };
  const prev = last && prevState && last.seq === seq - 1 ? { state: prevState, view: last.view } : null;
  const eventsJson = JSON.stringify(seatEvents(state, events, player, view, prev));
  const full = (): SeatPayload => ({ base, t: 'view', json: fullViewJson(base, eventsJson) });
  if (!last) return full();
  const ops = diffViews(last.view, base.view);
  const json = `{"t":"patch","seq":${seq},"base":${last.seq},"ops":${JSON.stringify(ops)},"events":${eventsJson},"legal":${base.legalJson}}`;
  return json.length < viewJson.length ? { base, t: 'patch', json } : full();
}

/**
 * A by-hand change proposal as `approver` may know the game (D12, CR 400.2): the operations in words from the full state with `canSee` (`describeOps`
 * after `unaliasOps`, as milestone 9's host does), so a card the approver cannot see reads "a hidden card"; the card being resolved by hand and its text
 * only when the approver can see that card.
 */
export function proposalView(state: GameState, id: number, proposer: { seat: SeatNumber; player: PlayerId }, ops: ManualOp[], approver: PlayerId): ProposalView {
  const d = state.pending?.kind === 'manualResolve' ? state.pending : null;
  const subject = d ? state.objects[d.resolvingId ?? d.subjectId ?? ''] : undefined;
  const visible = !subject || canSee(state, subject, approver);
  return {
    id,
    seat: proposer.seat,
    sourceName: d && visible ? d.sourceName : 'a hidden card',
    text: d && visible ? d.text : '',
    lines: describeOps(state, unaliasOps(state, proposer.player, ops), approver),
  };
}
