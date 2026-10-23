/**
 * What the reporter's own client attached to a report (design 4.8; package M13-13), read for the owner's command. The attachments are kept as the text the
 * client sent (api.ts `ReportAttachment`: never jsonb), so they are parsed only here, in the owner's process, bounded and without ever throwing:
 *
 * - `client`: the client details of the bug-report item (the page it was made on, `packages/client/src/bugs/environment.ts`), as JSON:
 *   `{ app?: { version, commit }, browser?: { userAgent, language?, screen? }, errors?: [{ message, stack?, time? }], card? }`.
 * - `settings`: the settings that change what the screen shows, as one JSON object of plain values (`reportSettings`).
 * - `view`: the client's view of the game when it reported, a game view as JSON; kept and shown by size only (the owner has the game's log).
 *
 * Every value is cut to the bounds of the replay file's validator (engine replay/validate.ts) and its text made safe to show (no control characters), so
 * what comes out always fits `BugReportFile`. A part that cannot be read is left out with a note, never fatal.
 */
import { cleanText, parseBoundedJson, REPLAY_LIMITS, type BugReportFile, type ReplayApp } from '@openmtg/engine';
import type { ReportRow } from '../store/api';

/** The text bounds of `checkBugReport`. */
const BOUNDS = {
  version: 40, commit: 64, userAgent: 1_000, language: 64, screen: 64, card: 200, message: 10_000, stack: 50_000, errors: 200, settings: 500, setting: 1_000, key: 200,
} as const;

export interface ClientDetails {
  app: ReplayApp | null;
  browser: BugReportFile['browser'] | null;
  errors: BugReportFile['errors'];
  card: string | null;
  settings: BugReportFile['settings'];
  /** Why a part of the attachments was left out ("client: not JSON"), for the owner to see. */
  notes: string[];
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})$/;

/** Text safe to show, cut to `max`; null when it is not text or nothing is left. */
function text(x: unknown, max: number, o: { empty?: boolean } = {}): string | null {
  if (typeof x !== 'string') return null;
  const t = cleanText(x).slice(0, max);
  return t === '' && o.empty !== true ? null : t;
}

function parse(source: string, notes: string[], what: string): unknown {
  const r = parseBoundedJson(source, { ...REPLAY_LIMITS, maxTextBytes: 4 * 1024 * 1024 });
  if (r.ok) return r.value;
  notes.push(`${what}: ${r.error.message}`);
  return undefined;
}

/** The attachment of `kind` (the first), or null. */
export function attachmentOf(atts: ReportRow['attachments'], kind: string): string | null {
  return atts.find((a) => a.kind === kind)?.json ?? null;
}

/** The client details and settings of a report's attachments. */
export function readClientDetails(atts: ReportRow['attachments']): ClientDetails {
  const out: ClientDetails = { app: null, browser: null, errors: [], card: null, settings: {}, notes: [] };
  const client = attachmentOf(atts, 'client');
  if (client !== null) {
    const x = parse(client, out.notes, 'client details');
    if (isRec(x)) {
      if (isRec(x['app'])) {
        const version = text(x['app']['version'], BOUNDS.version);
        const commit = text(x['app']['commit'], BOUNDS.commit);
        if (version !== null) out.app = { version, commit };
      }
      if (isRec(x['browser'])) {
        const b = x['browser'];
        const language = text(b['language'], BOUNDS.language);
        const screen = text(b['screen'], BOUNDS.screen);
        out.browser = { userAgent: text(b['userAgent'], BOUNDS.userAgent, { empty: true }) ?? '', ...(language !== null ? { language } : {}), ...(screen !== null ? { screen } : {}) };
      }
      if (Array.isArray(x['errors'])) {
        for (const e of x['errors'].slice(-BOUNDS.errors)) {
          if (!isRec(e)) continue;
          const message = text(e['message'], BOUNDS.message, { empty: true });
          if (message === null) continue;
          const stack = text(e['stack'], BOUNDS.stack);
          const time = typeof e['time'] === 'string' && e['time'].length <= 40 && ISO_TIME.test(e['time']) ? e['time'] : null;
          out.errors.push({ message, ...(stack !== null ? { stack } : {}), ...(time !== null ? { time } : {}) });
        }
      }
      out.card = text(x['card'], BOUNDS.card);
    } else if (x !== undefined) out.notes.push('client details: not an object');
  }
  const settings = attachmentOf(atts, 'settings');
  if (settings !== null) {
    const x = parse(settings, out.notes, 'settings');
    if (isRec(x)) {
      for (const [k, v] of Object.entries(x).slice(0, BOUNDS.settings)) {
        const key = text(k, BOUNDS.key);
        if (key === null) continue;
        if (typeof v === 'string') out.settings[key] = cleanText(v).slice(0, BOUNDS.setting);
        else if (typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v))) out.settings[key] = v;
      }
    } else if (x !== undefined) out.notes.push('settings: not an object');
  }
  return out;
}
