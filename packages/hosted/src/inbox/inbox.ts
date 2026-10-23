/**
 * The owner's side of the bug inbox (design 4.8; package M13-13): reading the reports the intake stored (`ReportIntake`), their status, and the bug
 * report file of a hosted game's report. The `openmtg-hosted inbox` command (cli.ts) is a thin layer over this. It runs in its own process against the
 * same store the server uses (design 4.8: a command on the server, never a network endpoint), so nothing here is ever reachable by a player.
 *
 * - **Reading**: `GameStore.reports(since, limit)` gives reports oldest first, with their attachments; `list` pages through them (`reports` below),
 *   keeps only a summary of each, and gives the newest first. A report's id is a ULID made at its creation time, so `get` starts its search there.
 * - **The game log** is attached here, when the report is read, not copied into the row (intake.ts): the game's config, seed and records come from the
 *   store (`loadForRecovery`, from the first record) and are cut at the moment of the report (`export.ts`). A game that retention purged (design 8.3:
 *   90 days after its end) has no log; the report says so and keeps the player's words.
 * - **Nothing here changes a report but its status** (`new`, `read`, `closed`).
 */
import type { Checked } from '@openmtg/engine';
import type { GameStore, ReportRow } from '../store/api';
import { StoreError } from '../store/rules';
import { readClientDetails, type ClientDetails } from './client';
import { hostedBugReport, type HostedExport } from './export';
import { TITLE_ATTACHMENT, type TitleEvidence } from './intake';

export type ReportStatus = ReportRow['status'];
export const REPORT_STATUSES: readonly ReportStatus[] = ['new', 'read', 'closed'];

/** The store methods the owner's side uses. */
export type InboxStore = Pick<GameStore, 'reports' | 'setReportStatus' | 'tableRow' | 'loadForRecovery'>;

export interface ReportQuery {
  /** Reports made at or after this (default: the beginning of time). */
  since?: Date;
  status?: ReportStatus | 'all';
  kind?: ReportRow['kind'];
  /** The newest this many (default 50). */
  limit?: number;
}

/** A report without its attachments' text (the listing). */
export interface ReportSummary {
  id: string;
  kind: ReportRow['kind'];
  status: ReportStatus;
  createdAt: Date;
  session: string;
  game: string | null;
  seat: number | null;
  /** The player's words as sent (not cut: the command cuts what it prints). */
  text: string;
  attachments: { kind: string; bytes: number }[];
}

export function summaryOf(r: ReportRow): ReportSummary {
  return {
    id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt, session: r.session, game: r.game, seat: r.seat, text: r.text,
    attachments: r.attachments.map((a) => ({ kind: a.kind, bytes: a.json.length })),
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The time a ULID (`gateway/ids.ts ulid`) was made at, or null when `id` is not one. */
export function ulidTime(id: string): Date | null {
  if (id.length !== 26) return null;
  let t = 0;
  for (let i = 0; i < 10; i++) {
    const v = CROCKFORD.indexOf(id[i]!);
    if (v < 0) return null;
    t = t * 32 + v;
  }
  return Number.isSafeInteger(t) && t >= 0 && t <= 8_640_000_000_000_000 ? new Date(t) : null;
}

/**
 * Every report made at or after `since`, oldest first, a page at a time (`GameStore.reports` is limited and inclusive: the next page starts at the last
 * report's time and skips what was seen at that instant; a page of one instant is widened, so every report is seen once whatever their times).
 */
export async function* reports(store: Pick<GameStore, 'reports'>, since: Date, pageSize = 200): AsyncGenerator<ReportRow> {
  let from = since;
  let atFrom = new Set<string>();
  let limit = pageSize;
  for (;;) {
    const rows = await store.reports(from, limit);
    for (const r of rows) {
      if (r.createdAt.getTime() === from.getTime()) {
        if (atFrom.has(r.id)) continue;
        atFrom.add(r.id);
      }
      yield r;
    }
    if (rows.length < limit) return;
    const last = rows[rows.length - 1]!.createdAt;
    if (last.getTime() === from.getTime()) limit *= 2;
    else {
      from = last;
      atFrom = new Set(rows.filter((r) => r.createdAt.getTime() === last.getTime()).map((r) => r.id));
    }
  }
}

/** What `show` knows of a report beyond its row. */
export interface ReportDetails {
  report: ReportRow;
  client: ClientDetails;
  /** A title report's evidence (the title as it was). */
  title: TitleEvidence | null;
  /** The game's row as the store has it now (null: no game named, or purged). */
  game: { format: string; status: string; seats: { seat: number; name: string | null; session: string | null }[]; startedAt: Date | null } | null;
}

export type ExportResult = { ok: true; report: ReportRow; export: HostedExport } | { ok: false; message: string };

export class Inbox {
  private readonly now: () => Date;

  constructor(private readonly store: InboxStore, o: { now?: () => Date } = {}) {
    this.now = o.now ?? (() => new Date());
  }

  /** The reports of `q`, newest first. */
  async list(q: ReportQuery = {}): Promise<ReportSummary[]> {
    const out: ReportSummary[] = [];
    for await (const r of reports(this.store, q.since ?? new Date(0))) {
      if (q.status !== undefined && q.status !== 'all' && r.status !== q.status) continue;
      if (q.kind !== undefined && r.kind !== q.kind) continue;
      out.push(summaryOf(r));
    }
    out.reverse();
    return out.slice(0, Math.max(0, q.limit ?? 50));
  }

  /** The report `id`, or null. */
  async get(id: string): Promise<ReportRow | null> {
    const at = ulidTime(id);
    for await (const r of reports(this.store, at ?? new Date(0))) {
      if (r.id === id) return r;
      if (at !== null && r.createdAt.getTime() > at.getTime()) return null;
    }
    return null;
  }

  /** The report with what the store knows around it, or null. */
  async details(id: string): Promise<ReportDetails | null> {
    const report = await this.get(id);
    if (!report) return null;
    const raw = report.attachments.find((a) => a.kind === TITLE_ATTACHMENT)?.json;
    let title: TitleEvidence | null = null;
    if (raw !== undefined) {
      try {
        const x = JSON.parse(raw) as Partial<TitleEvidence>;
        if (typeof x.title === 'string') title = { title: x.title, creator: typeof x.creator === 'string' ? x.creator : null };
      } catch {
        // an attachment of the server's own that does not parse: shown as missing
      }
    }
    const row = report.game !== null ? await this.store.tableRow(report.game) : null;
    return {
      report,
      client: readClientDetails(report.attachments),
      title,
      game: row ? { format: row.format, status: row.status, seats: row.seatRows.map((s) => ({ seat: s.seat, name: s.name, session: s.session })), startedAt: row.startedAt } : null,
    };
  }

  /** Sets a report's status; false when there is no such report. */
  async setStatus(id: string, status: ReportStatus): Promise<boolean> {
    try {
      await this.store.setReportStatus(id, status);
      return true;
    } catch (e) {
      if (e instanceof StoreError && e.code === 'notFound') return false;
      throw e;
    }
  }

  /** The bug report file of report `id` (export.ts), or why there is none. */
  async export(id: string): Promise<ExportResult> {
    const report = await this.get(id);
    if (!report) return { ok: false, message: `No report ${id}.` };
    if (report.game === null) return { ok: false, message: `Report ${id} is about no game (it was made in the lobby or about the client): there is no game log to replay.` };
    if (report.kind === 'title') return { ok: false, message: `Report ${id} is a table-title report: there is no game log to replay.` };
    const row = await this.store.tableRow(report.game);
    if (!row) return { ok: false, message: `The game ${report.game} is no longer stored (retention keeps game logs 90 days after the end): the report keeps only the player's words.` };
    if (row.startedAt === null) return { ok: false, message: `The table ${report.game} never started: it has no game log.` };
    let log;
    try {
      log = await this.store.loadForRecovery(report.game, { ignoreSnapshots: true });
    } catch (e) {
      return { ok: false, message: `The log of game ${report.game} cannot be read: ${e instanceof Error ? e.message : String(e)}` };
    }
    const made: Checked<HostedExport> = hostedBugReport(report, { row, log }, { exportedAt: this.now() });
    if (!made.ok) return { ok: false, message: `The report file is not valid: ${made.error.message}${made.error.path ? ` (at ${made.error.path})` : ''}` };
    return { ok: true, report, export: made.value };
  }
}
