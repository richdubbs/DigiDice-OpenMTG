/**
 * Adapter to the format validator of @openmtg/cards (package F1, milestone 7: `validateDeck`, `FORMATS`, `findFormat`, `UnknownFormatError`). The
 * server codes against the small `FormatAdapter` interface below, so its tests can pass a fake; the real one is a plain import of F1 (C6: F1 is on main,
 * so the run-time lookup of the merge-time adapter is gone).
 */
import { FORMATS, UnknownFormatError, findFormat, validateDeck } from '@openmtg/cards';
import type { OracleCard } from '@openmtg/engine';

export type Severity = 'error' | 'warning' | 'note';
export type DeckPart = 'main' | 'sideboard' | 'commander' | 'companion';

/** F1's DeckToValidate (a ResolvedDecklist fits it). */
export interface AdapterDeck {
  main: { count: number; card: OracleCard }[];
  sideboard: { count: number; card: OracleCard }[];
  commander: { count: number; card: OracleCard }[];
  companion: { count: number; card: OracleCard }[];
  /** Names the index does not know: counted in deck sizes, never checked. */
  unresolved: { section: DeckPart; name: string; count: number }[];
}

/** The part of F1's FormatProblem the API reports. */
export interface AdapterProblem {
  severity: Severity;
  code: string;
  rule: string;
  message: string;
  card?: string;
}

export interface AdapterReport {
  formatId: string;
  valid: boolean;
  problems: AdapterProblem[];
  /** CMP1: the companion F1 read (FormatReport.companion, CR 702.139a), by Oracle name. */
  companion?: string;
}

export interface FormatAdapter {
  /** The report, or `unknownFormat` with the format ids the validator knows. */
  validate(deck: AdapterDeck, format: string): AdapterReport | { unknownFormat: true; known: string[] };
}

/** Format names that mean "no card-pool limit" (F1's casual format and its aliases). */
const NO_POOL: readonly string[] = ['casual', 'freeform', 'none', 'no restrictions', 'kitchen table'];

/**
 * The Scryfall legality key a format name filters search on, from F1's format table (id, display name or alias -> `legalityKey`); a name F1 does not
 * know is taken as a legality key itself. null for a format without a card pool (casual, freeform). The caller checks that the index has legality data
 * for the key.
 */
export function formatLegalityKey(format: string): string | null {
  const k = format.trim().toLowerCase();
  if (NO_POOL.includes(k)) return null;
  const f = findFormat(k);
  if (f) return f.legalityKey ?? null;
  return k;
}

/** F1's validator. */
export function f1Adapter(): FormatAdapter {
  const known = FORMATS.map((f) => f.id);
  return {
    validate(deck, format) {
      let report: ReturnType<typeof validateDeck>;
      try {
        report = validateDeck(deck, format);
      } catch (e) {
        if (e instanceof UnknownFormatError) return { unknownFormat: true, known };
        throw e;
      }
      return {
        formatId: report.format.id,
        valid: report.valid,
        problems: report.problems.map((p) => ({ severity: p.severity, code: p.code, rule: p.rule, message: p.message, ...(p.card !== undefined ? { card: p.card } : {}) })),
        ...(report.companion !== undefined ? { companion: report.companion } : {}),
      };
    },
  };
}
