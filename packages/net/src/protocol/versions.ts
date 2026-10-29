/**
 * Version check of the handshake (docs/design/online.md): both sides must run the same protocol and the same engine. "The same engine" is the
 * engine build: a hash of every source file of the engine package (`build`), so any change to engine code (views, actions, decisions, legal
 * actions, rules) makes two builds incompatible, not only a change of the compiler or ability-model version. When the engine sources cannot be read
 * (a bundled build), `build` is null and only the version constants are compared, with a warning.
 *
 * The rules pack only has to match when the host asks for it: the host's compiled card definitions travel in the game state, so a different pack on
 * the guest cannot desynchronise the game; it is reported as a warning (the guest's own card browser may show other automation levels).
 */
import { ABILITY_MODEL_VERSION, COMPILER_VERSION } from '@openmtg/engine';
import type { NetErrorCode } from '../errors';
import { engineBuildFrom } from './fingerprint';
import { PROTOCOL_VERSION, type Versions } from './messages';

// RPL-0: the fingerprint itself lives in fingerprint.ts (Node only, no other import), so the client's Vite config can compute the same build at build time.
export { fingerprintDirectory } from './fingerprint';

/**
 * RPL-0 review: the engine build a bundled server was made with. The installer's bundle (scripts/build-installer.mjs: the Electron main process with the
 * server; there is no standalone exe) ships no engine sources to hash, so the build script defines the fingerprint it computed for the bundle and for
 * the browser's build alike; undefined when not bundled.
 */
declare const __OPENMTG_SERVER_ENGINE_BUILD__: string | undefined;
const BUNDLED_ENGINE_BUILD: string | undefined = typeof __OPENMTG_SERVER_ENGINE_BUILD__ === 'string' ? __OPENMTG_SERVER_ENGINE_BUILD__ : undefined;

let engineBuild: string | null | undefined;

/**
 * The engine build of this process (computed once): the build a bundle was made with, else the fingerprint of the engine package's source directory,
 * or null when it cannot be read.
 */
export function localEngineBuild(): string | null {
  if (engineBuild === undefined) engineBuild = BUNDLED_ENGINE_BUILD ?? engineBuildFrom(import.meta.url);
  return engineBuild;
}

export function localVersions(rulesPack: string | null = null): Versions {
  return { protocol: PROTOCOL_VERSION, engine: COMPILER_VERSION, model: ABILITY_MODEL_VERSION, build: localEngineBuild(), rulesPack };
}

export interface VersionCheck {
  fatal?: { code: NetErrorCode; message: string };
  warnings: string[];
}

const SAME_VERSION = 'Both players need the same OpenMTG version.';

export function compareVersions(host: Versions, guest: Versions, requireSameRulesPack = false): VersionCheck {
  if (guest.protocol !== host.protocol) return { fatal: { code: 'version', message: `Different OpenMTG network protocols (host ${host.protocol}, guest ${guest.protocol}). ${SAME_VERSION}` }, warnings: [] };
  if (guest.engine !== host.engine || guest.model !== host.model) {
    return { fatal: { code: 'version', message: `Different OpenMTG engines (host ${host.engine} / model ${host.model}, guest ${guest.engine} / model ${guest.model}). ${SAME_VERSION}` }, warnings: [] };
  }
  const warnings: string[] = [];
  if (host.build !== null && guest.build !== null) {
    if (host.build !== guest.build) {
      return { fatal: { code: 'version', message: `Different OpenMTG engine builds (host ${host.build.slice(0, 12)}, guest ${guest.build.slice(0, 12)}). ${SAME_VERSION}` }, warnings: [] };
    }
  } else {
    warnings.push('The engine build could not be compared (a bundled build); make sure both players run the same OpenMTG version.');
  }
  if (guest.rulesPack !== host.rulesPack) {
    const text = `Different rules packs (host ${host.rulesPack ?? 'none'}, guest ${guest.rulesPack ?? 'none'}).`;
    if (requireSameRulesPack) return { fatal: { code: 'rulesPack', message: `${text} The host requires the same rules pack: use Update on both machines.` }, warnings: [] };
    warnings.push(`${text} The game uses the host's card automation.`);
  }
  return { warnings };
}
