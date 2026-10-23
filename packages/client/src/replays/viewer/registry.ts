/**
 * RPL-2: which replay controller drives a replay connection. The game screen gets a route's connection, and everything below it holds only its sealed
 * form (game/sealed.ts, which keeps only the members of `GameConnection`), so the controller (play, pause, seek, speed, perspective) is found here by the
 * connection, sealed or not. A leaf module with no imports, so the seal does not pull the replay code into every bundle.
 */

/** The controller as this registry holds it; connection/ReplayConnection.ts has its type. */
type Controller = object;

const controllers = new WeakMap<object, Controller>();

export function registerReplayController(connection: object, controller: Controller): void {
  controllers.set(connection, controller);
}

/** The sealed form of a connection drives the same replay as the connection itself. */
export function linkReplayController(from: object, to: object): void {
  const c = controllers.get(from);
  if (c) controllers.set(to, c);
}

export function registeredReplayController(connection: object): Controller | null {
  return controllers.get(connection) ?? null;
}
