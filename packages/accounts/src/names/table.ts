/**
 * M14-2: the text form of the name tables (design 6.3), shared by src/names/data.ts and scripts/gen-unicode-data.ts (which must not load the
 * generated files it writes). A table is text, one entry per line: the source code point, ">", the target's code points separated by spaces, all in
 * lowercase hex ("df>73 73": "ß" to "ss").
 */
import type { KeyTables } from './key';

const hex = (cp: number): string => cp.toString(16);

/** What scripts/gen-unicode-data.ts writes into ./unicode-data.ts (and moves into ./unicode-data-prev.ts at the next version). */
export interface GeneratedNameData {
  /** NAME_DATA_VERSION: a positive integer, bumped whenever the tables change. */
  readonly version: number;
  /** The Unicode version of the files, e.g. "17.0.0". */
  readonly unicodeVersion: string;
  /** The files the tables were read from, with the dates in their headers (and their SHA-256). */
  readonly sources: string;
  /** OpenMTG's supplement (6.3 step 2.6). */
  readonly supplement: string;
  /**
   * OpenMTG's derived table (not Unicode data; scripts/gen-unicode-data.ts, `deriveOverrides`): each entry REPLACES its character's case folding
   * and prototype, so the character keys to the entry's target (see `applyOverrides`). Absent or empty: none (hand-made tables in tests).
   */
  readonly overrides?: string;
  /** What the generator says about the derived table (written into the header as it is); absent: nothing. */
  readonly notes?: string;
  /** CaseFolding.txt, statuses C and F. */
  readonly caseFolding: string;
  /** confusables.txt. */
  readonly confusables: string;
}

/** A table as text (./unicode-data.ts's format) from [source character, target string] pairs, sorted by source. */
export function encodeNameTable(entries: Iterable<readonly [string, string]>): string {
  const rows: [number, string][] = [];
  for (const [source, target] of entries) {
    const cps = Array.from(source, (c) => c.codePointAt(0)!);
    if (cps.length !== 1) throw new Error(`a name table source must be one code point: ${JSON.stringify(source)}`);
    if (target.length === 0) throw new Error(`a name table target is empty (source U+${hex(cps[0]!)})`);
    rows.push([cps[0]!, `${hex(cps[0]!)}>${Array.from(target, (c) => hex(c.codePointAt(0)!)).join(' ')}`]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows.map((r) => r[1]).join('\n');
}

/** A table's text back as a map; throws on a malformed line or a repeated source. */
export function decodeNameTable(text: string): Map<number, string> {
  const out = new Map<number, string>();
  if (text.trim() === '') return out;
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{1,6})>([0-9a-f]{1,6}(?: [0-9a-f]{1,6})*)$/.exec(line.trim());
    if (!m) throw new Error(`a malformed name table line: ${JSON.stringify(line)}`);
    const source = parseInt(m[1]!, 16);
    const target = m[2]!.split(' ').map((h) => parseInt(h, 16));
    if ([source, ...target].some((cp) => cp > 0x10ffff)) throw new Error(`a code point out of range: ${JSON.stringify(line)}`);
    if (out.has(source)) throw new Error(`a repeated name table source: U+${hex(source)}`);
    out.set(source, String.fromCodePoint(...target));
  }
  return out;
}

/**
 * The key tables with the derived entries applied (INTERFACE CHANGE: a refinement of 6.3, see GeneratedNameData.overrides). An entry `c > T` takes `c`
 * out of the case folding and makes `T` its prototype: in a round of the key, the first fold leaves `c` alone, the look-alike map turns it into `T`,
 * and `T` (a key: folded, mapped and settled already) goes through the rest of the round unchanged. So the key's steps stay those of 6.3; only the
 * tables they read change.
 */
export function applyOverrides(
  caseFolding: ReadonlyMap<number, string>, confusables: ReadonlyMap<number, string>, supplement: ReadonlyMap<number, string>,
  overrides: ReadonlyMap<number, string>,
): KeyTables {
  const fold = new Map(caseFolding);
  const map = new Map(confusables);
  for (const [cp, target] of overrides) {
    fold.delete(cp);
    map.set(cp, target);
  }
  return Object.freeze({ caseFolding: fold, confusables: map, supplement });
}

/** The key tables of generated (or hand-made) data, its derived entries applied. */
export function keyTablesOf(g: GeneratedNameData): KeyTables {
  return applyOverrides(decodeNameTable(g.caseFolding), decodeNameTable(g.confusables), decodeNameTable(g.supplement), decodeNameTable(g.overrides ?? ''));
}
