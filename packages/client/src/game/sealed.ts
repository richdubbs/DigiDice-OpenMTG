/**
 * FXH (audit 2026-10-12 m5, CR 400.2): what the game screen and everything it renders hold of a game is a sealed connection: a frozen object with only the
 * members of `GameConnection`, each a function. A hot-seat `LocalConnection` keeps the whole game (`session`: both hands, both libraries, the RNG) and a
 * `ComputerGame` keeps the `LocalConnection` (`local`); a route, React props or component state that held them would let the full state be read from the
 * React tree (React DevTools, a `__reactProps` key on a DOM node) by the player at the screen. Through the sealed object only `view()` is reachable, which is
 * `viewFor` of the shown player (a spectator view while a hand-off is pending), and `legalActions()` of that player.
 *
 * Limits (docs/design/m8-client.md "Data flow"): in hot-seat the engine runs in the same page, so the full state is still in memory, and a debugger can reach
 * it through the closures below. Sealing stops casual reading of another player's hand from the UI, not a player who opens the debugger: hot-seat play
 * relies on the players at the screen, as online play relies on an honest host (docs/design/online.md).
 */
import type { GameConnection } from '../connection/GameConnection';
import { linkReplayController } from '../replays/viewer/registry';

const sealed = new WeakSet<GameConnection>();
/** One sealed form per connection, so sealing on every render gives the same object (React keys and subscriptions stay put). */
const forms = new WeakMap<GameConnection, GameConnection>();

/** The sealed form of `conn` (itself when it is sealed already; the same object on every call). Every member forwards to `conn`; none exposes it. */
export function sealConnection(conn: GameConnection): GameConnection {
  if (sealed.has(conn)) return conn;
  const known = forms.get(conn);
  if (known) return known;
  const seated = conn.seated;
  const status = conn.status;
  // ui/arena: the event feed for the board's animations, already redacted for the shown player like `view()` (CR 400.2).
  const events = conn.events;
  // M13-11: a hosted game's clocks, as the connection holds them.
  const clocks = conn.clocks;
  const out: GameConnection = Object.freeze({
    kind: conn.kind,
    view: () => conn.view(),
    legalActions: () => conn.legalActions(),
    act: (action: Parameters<GameConnection['act']>[0]) => conn.act(action),
    subscribe: (listener: () => void) => conn.subscribe(listener),
    canUndo: () => conn.canUndo(),
    undo: () => conn.undo(),
    handoff: () => conn.handoff(),
    acceptHandoff: () => conn.acceptHandoff(),
    ...(seated ? { seated: () => seated() } : {}),
    ...(status ? { status: () => status() } : {}),
    ...(events ? { events: () => events() } : {}),
    ...(clocks ? { clocks: () => clocks() } : {}),
  });
  sealed.add(out);
  forms.set(conn, out);
  // RPL-2: a replay's sealed form is driven by the same controller (play, seek, perspective), which the game screen finds by the connection it holds.
  linkReplayController(conn, out);
  return out;
}

/** A rematch factory whose connections are sealed. */
export function sealedFactory(make: () => GameConnection): () => GameConnection {
  return () => sealConnection(make());
}
