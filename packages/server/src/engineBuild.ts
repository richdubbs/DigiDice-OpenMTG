/**
 * The engine build of this server: packages/net's fingerprint of the engine's source, the same value the browser client's build carries
 * (client vite.config.ts). A replay records it (`ReplayFile.engine.build`), and a replay of the same build plays exactly without being checked first
 * (replays design 5). A bundled server has no engine source to read: it is given the value in `OPENMTG_ENGINE_BUILD`, or built with it, or knows none
 * (null).
 */
import { engineBuildFrom } from '@openmtg/net/fingerprint';

/** The value a bundle was built with (scripts/build-installer.mjs, scripts/build-godot-server.mjs). */
declare const __OPENMTG_SERVER_ENGINE_BUILD__: string | undefined;
const BUNDLED: string | undefined = typeof __OPENMTG_SERVER_ENGINE_BUILD__ === 'string' ? __OPENMTG_SERVER_ENGINE_BUILD__ : undefined;

const BUILD_RE = /^[0-9a-f]{64}$/;
let build: string | null | undefined;

export function engineBuild(): string | null {
  if (build === undefined) {
    const given = process.env['OPENMTG_ENGINE_BUILD'];
    build = given !== undefined && BUILD_RE.test(given) ? given : BUNDLED !== undefined && BUILD_RE.test(BUNDLED) ? BUNDLED : engineBuildFrom(import.meta.url);
  }
  return build;
}
