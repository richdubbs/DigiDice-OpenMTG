/**
 * RPL-0 (docs/design/replays.md in the archive, section 13): the replay contracts, exported from the engine's public entry. Browser-safe throughout.
 */
export {
  REPLAY_FORMAT, REPLAY_FORMAT_VERSION, BUG_REPORT_FORMAT, BUG_REPORT_FORMAT_VERSION, REPLAY_EXTENSION, ENGINE_STATE_SCHEMA, RECORDING_MAX_PATCH_RUN, currentEngine,
  type ReplayKind, type ReplayMode, type ReplayEnd, type ReplayApp, type ReplayEngine, type ReplayPlayer, type ReplayGameInfo, type ReplayReveal,
  type ReplayCheckpoint, type ReplayPlay, type RecordingKeyView, type RecordingFrame, type ReplayRecording, type ReplayFile, type BugReportFile,
} from './format';
export type { ReplayError, ReplayErrorCode, Checked } from './errors';
export { REPLAY_LIMITS, type ReplayLimits } from './bounded';
export {
  REPLAY_UPGRADES, BUG_REPORT_UPGRADES, upgradeFile, upgradeReplay, upgradeBugReport, type Upgrader, type UpgradeTable, type UpgradeChain, type JsonRecord,
} from './upgrade';
export {
  checkReplay, checkBugReport, parseReplay, parseBugReport, parseBoundedJson, checkRecordingView, recordingFrameView, type RecordingViewContext,
} from './validate';
export { isGzip, gzipBytes, gunzipBytes, fileText, readReplayFile, readBugReportFile, writeGzippedJson } from './gzip';
export {
  checkpointAfter, checkpointsOf, firstDivergence, startReplay, replayAction, type CheckpointRun, type ReplayRejection, type ReplayRejectionCause,
} from './checkpoints';
