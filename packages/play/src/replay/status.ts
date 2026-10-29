/**
 * RPL-2 (replays design 5, 10): what a replay of the library can be watched as on this OpenMTG, the library's status badge. Shared by the browser
 * client's library (packages/client replays/library.ts) and the local server's (packages/server library/replays.ts).
 */
import { ABILITY_MODEL_VERSION, ENGINE_VIEW_SCHEMA, REPLAY_FORMAT_VERSION, type ReplayEngine } from '@openmtg/engine';

export type ReplayStatus = 'exact' | 'checked' | 'recordingOnly' | 'needsNewer';

/** The facts of a replay the status is read from. */
export interface ReplayStatusFacts {
  formatVersion: number;
  kind: 'game' | 'recording';
  engine: Pick<ReplayEngine, 'build' | 'model' | 'viewSchema'>;
  hasRecording: boolean;
}

export function replayStatus(s: ReplayStatusFacts, build: string | null): ReplayStatus {
  if (s.formatVersion > REPLAY_FORMAT_VERSION) return 'needsNewer';
  if (s.kind === 'recording') return s.engine.viewSchema > ENGINE_VIEW_SCHEMA ? 'needsNewer' : 'recordingOnly';
  // A game whose ability model this engine cannot read plays its recording only (design 5.4).
  if (s.engine.model !== ABILITY_MODEL_VERSION) return s.hasRecording && s.engine.viewSchema <= ENGINE_VIEW_SCHEMA ? 'recordingOnly' : 'needsNewer';
  return build !== null && s.engine.build === build ? 'exact' : 'checked';
}

export const STATUS_LABEL: Record<ReplayStatus, string> = {
  exact: 'Exact',
  checked: 'Checked when watched',
  recordingOnly: 'Recording only',
  needsNewer: 'Needs a newer OpenMTG',
};
