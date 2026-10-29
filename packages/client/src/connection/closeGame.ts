/**
 * Review 2026-10-26 F1: a game that holds something to stop when it leaves the screen for good (the game worker of a WorkerConnection), found by its
 * connection, sealed or not, as the navigation holds it (app/nav.tsx calls `closeGame` when a game route leaves the back stack, after its replay is
 * saved). A leaf module with no imports, so the navigation's chunk does not carry the game's code.
 */
const closers = new WeakMap<object, () => void>();

/** Register what stops the game on each form of its connection. */
export function registerGameCloser(connections: readonly object[], close: () => void): void {
  for (const c of connections) closers.set(c, close);
}

/** The game on `connection` left the screen for good: stop it (nothing for a game without a closer). Never throws. */
export function closeGame(connection: object): void {
  const close = closers.get(connection);
  if (!close) return;
  closers.delete(connection);
  try {
    close();
  } catch (e) {
    console.error('[closeGame] the game could not be stopped', e);
  }
}
