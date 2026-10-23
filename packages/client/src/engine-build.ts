/**
 * RPL-0 (replays design 5): the engine build this client was built with, the value the local server's handshake sends for the same build. A replay
 * records it (`ReplayFile.engine.build`); a replay of the same build is exact by construction, any other is checked against its digests. Null when the
 * build did not know it, and on the dev server, whose engine changes under it (vite.config.ts).
 */
export const ENGINE_BUILD: string | null = typeof __OPENMTG_ENGINE_BUILD__ === 'string' ? __OPENMTG_ENGINE_BUILD__ : null;

/**
 * RPL-0 review (replays design 4): the app a replay records it was saved by (`ReplayFile.app`, `BugReportFile.app`): the app's version as the local
 * server reports it, and the short commit of the build (null when it was not built from a git checkout). RPL-1 and RPL-4 write it as it is.
 */
export const APP: { version: string; commit: string | null } =
  typeof __OPENMTG_APP__ === 'object' && __OPENMTG_APP__ !== null
    ? { version: __OPENMTG_APP__.version, commit: __OPENMTG_APP__.commit }
    : { version: '0.0.0', commit: null };
