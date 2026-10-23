/**
 * RPL-0 (replays design 5.1): the upgrade chain. A replay or bug report of an older `formatVersion` is brought to the current one step by step, by the
 * function for each version (`upgrade1to2` is the entry for 1, and so on). A newer one is refused: "This replay was made by a newer OpenMTG. Update to watch
 * it." Version 1 is the first, so the tables are empty; a change of the format adds its function here and bumps the version in format.ts.
 *
 * An upgrade function takes the parsed JSON of one version and returns the JSON of the next one. It may throw on something it cannot read; the chain
 * turns that into a refusal (`malformed`), so reading a file still never throws.
 */
import { refuse, type Checked } from './errors';
import { BUG_REPORT_FORMAT_VERSION, REPLAY_FORMAT_VERSION } from './format';

export type JsonRecord = Record<string, unknown>;
/** Brings the JSON of version n to version n + 1. */
export type Upgrader = (file: JsonRecord) => JsonRecord;
/** Upgrade functions by the version they read (the entry for 1 is `upgrade1to2`). */
export type UpgradeTable = Readonly<Record<number, Upgrader>>;

/** The replay format's upgrade functions. None yet: formatVersion 1 is the first. */
export const REPLAY_UPGRADES: UpgradeTable = Object.freeze({});
/** The bug report format's upgrade functions. None yet. */
export const BUG_REPORT_UPGRADES: UpgradeTable = Object.freeze({});

export interface UpgradeChain {
  /** The version this reader reads. */
  current: number;
  upgrades: UpgradeTable;
  /** What the file is, for messages ("replay", "bug report"). */
  what: string;
  /** What updating lets the player do ("watch it", "open it"). */
  use: string;
}

const isRecord = (x: unknown): x is JsonRecord => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Bring `file` (parsed JSON with a `formatVersion`) to `chain.current`, or say why not. */
export function upgradeFile(file: JsonRecord, chain: UpgradeChain): Checked<JsonRecord> {
  const v = file['formatVersion'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return refuse('unsupportedFormat', `This ${chain.what} has no readable format version.`, 'formatVersion');
  if (v > chain.current) return refuse('newerFormat', `This ${chain.what} was made by a newer OpenMTG (format ${v}; this one reads ${chain.current}). Update to ${chain.use}.`);
  let out = file;
  for (let at = v; at < chain.current; at++) {
    const up = Object.hasOwn(chain.upgrades, at) ? chain.upgrades[at] : undefined;
    if (!up) return refuse('unsupportedFormat', `This ${chain.what} is in format ${v}, which this OpenMTG can no longer read.`);
    let next: unknown;
    try {
      next = up(out);
    } catch (e) {
      return refuse('malformed', `This ${chain.what} could not be brought from format ${at} to ${at + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!isRecord(next) || next['formatVersion'] !== at + 1) return refuse('malformed', `The upgrade of this ${chain.what} from format ${at} did not give format ${at + 1}.`);
    out = next;
  }
  return { ok: true, value: out };
}

/** The replay chain: brings a replay to `REPLAY_FORMAT_VERSION` (`upgrades` and `current` replaceable for tests). */
export function upgradeReplay(file: JsonRecord, upgrades: UpgradeTable = REPLAY_UPGRADES, current: number = REPLAY_FORMAT_VERSION): Checked<JsonRecord> {
  return upgradeFile(file, { current, upgrades, what: 'replay', use: 'watch it' });
}

/** The bug report chain: brings a bug report to `BUG_REPORT_FORMAT_VERSION` (the replay inside it has its own chain). */
export function upgradeBugReport(file: JsonRecord, upgrades: UpgradeTable = BUG_REPORT_UPGRADES, current: number = BUG_REPORT_FORMAT_VERSION): Checked<JsonRecord> {
  return upgradeFile(file, { current, upgrades, what: 'bug report', use: 'open it' });
}
