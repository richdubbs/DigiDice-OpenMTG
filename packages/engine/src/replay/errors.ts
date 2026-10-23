/**
 * RPL-0: why a replay or bug report file was refused. Reading a file never throws (design 4: malformed and oversized files are refused without
 * throwing); every refusal is one of these, with a message the replay library can show as it is.
 */

export type ReplayErrorCode =
  /** Over a size bound: the file (8 MB), the text it expands to (128 MB), or the number of values in it. */
  | 'tooLarge'
  /** Arrays and objects nested deeper than the bound. */
  | 'tooDeep'
  /** A string (or a key) longer than the bound. */
  | 'stringTooLong'
  /** Gzip data that does not decompress. */
  | 'badCompression'
  /** Text that is not UTF-8. */
  | 'badText'
  /** Not JSON. */
  | 'notJson'
  /** JSON, but not an OpenMTG replay (or bug report). */
  | 'notReplay'
  /** Made by a newer OpenMTG: its `formatVersion` is newer than this reader's (design 5.1). */
  | 'newerFormat'
  /** A `formatVersion` this reader cannot bring up to date (no upgrade function for it, or not a version number). */
  | 'unsupportedFormat'
  /** The file's contents do not have the shape of the format (`path` says where). */
  | 'malformed'
  /** This browser cannot decompress or compress (no CompressionStream). */
  | 'unavailable';

export interface ReplayError {
  code: ReplayErrorCode;
  message: string;
  /** For `malformed`: where in the file, as a JSON path ("play.actions[3].type"). */
  path?: string;
}

/** A checked value, or the reason it was refused. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: ReplayError };

export const refuse = (code: ReplayErrorCode, message: string, path?: string): { ok: false; error: ReplayError } => ({
  ok: false,
  error: path === undefined ? { code, message } : { code, message, path },
});
