/**
 * M14-2: name data versions (design 6.3). A `NameData` is the public face of one generated table set (its NAME_DATA_VERSION and Unicode version);
 * its tables stay behind it here, so `NameRules.key(display, data)` can only be asked about data this module built. The current data comes from
 * ./unicode-data.ts, the one before it (kept for one release, while the operator runs `rekey`) from ./unicode-data-prev.ts; both are written by
 * scripts/gen-unicode-data.ts.
 */
import type { NameData } from './api';
import type { KeyTables } from './key';
import { keyTablesOf, type GeneratedNameData } from './table';
import { UNICODE_DATA } from './unicode-data';
import { PREVIOUS_UNICODE_DATA } from './unicode-data-prev';

const TABLES = new WeakMap<NameData, KeyTables>();

/** A NameData for generated (or, in tests, hand-made) tables. Each call makes a new NameData; `NameRules` compares them by identity. */
export function createNameData(g: GeneratedNameData): NameData {
  if (!Number.isSafeInteger(g.version) || g.version < 1) throw new Error(`NAME_DATA_VERSION must be a positive integer: ${g.version}`);
  if (typeof g.unicodeVersion !== 'string' || g.unicodeVersion === '') throw new Error('the name data needs its Unicode version');
  const data: NameData = Object.freeze({ version: g.version, unicodeVersion: g.unicodeVersion });
  TABLES.set(data, keyTablesOf(g));
  return data;
}

/** The tables behind a NameData this module built; throws for any other object. */
export function tablesOf(data: NameData): KeyTables {
  const t = TABLES.get(data);
  if (t === undefined) throw new Error(`unknown name data (version ${String((data as { version?: unknown } | null)?.version)}): make it with createNameData`);
  return t;
}

/** The generated data the server runs on. */
export const CURRENT_NAME_DATA: NameData = createNameData(UNICODE_DATA);
/** The data before it, while a release still ships it (6.3), else null. */
export const PREVIOUS_NAME_DATA: NameData | null = PREVIOUS_UNICODE_DATA === null ? null : createNameData(PREVIOUS_UNICODE_DATA);
