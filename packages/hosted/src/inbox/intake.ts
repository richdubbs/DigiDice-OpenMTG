/**
 * The bug inbox's intake (design 4.8, answer 15; package M13-13): the gateway's `ReportService`. `report` stores what the player sent in `bug_reports`
 * (`GameStore.putReport`); nothing is ever e-mailed, and the owner reads the inbox with `openmtg-hosted inbox` (cli.ts, ./inbox.ts).
 *
 * - **`kind: 'bug'`**: the player's words (at most 10 KB, the hosted text rules), the client's attachments (the view, the settings, the client details: at
 *   most 4, each kind once, 64 KB in all, kept as TEXT) and the game id and seat where the player sits. A report may also name a game the session sat at
 *   before (`table`), checked against the seats of the stored game. The game's own log and config are NOT copied into the report: the row names the game,
 *   and the owner's command attaches the log (read from the game's tables, up to the moment the report was made) when it shows or exports the report.
 *   A server-side copy would put a game log of megabytes into every row, and the store lists reports with their attachments. The log stays on the server:
 *   the reply is a bare `ok`, nothing of it is ever sent to the reporter or to anyone else at the table (CR 400.2: it holds the seed and every seat's cards).
 * - **`kind: 'title'`**: a table-title report (the Report button of the lobby browser, design 4.2): `table` names a listed table, and the title as it was is
 *   kept with the report (one server attachment of kind `title`), since the table may close or be purged before anyone reads it.
 * - **Limits**: one report per minute per session (design 3.6, 4.8: the gateway's own bucket is per connection, this one survives a reconnect), and
 *   `perAddress` per hour per address key (M13-13: sessions are cheap, so the session limit alone would not bound the inbox; the key is a counter in memory,
 *   never stored). The gateway has refused a bad frame before this runs; the checks are repeated here so the service is safe on its own.
 * - **Nothing that fails reaches the caller as an exception**: a store that fails answers `busy`, a limit `rateLimited` (with `retryAfterMs`).
 */
import {
  HOSTED_LIMITS, hostedTextProblem, reportAttachmentsProblem, TEXT_PROBLEM_MESSAGES, type HostedError, type ReportMessage, type SeatNumber,
} from '../api';
import type { ReportService } from '../gateway/hooks';
import { ulid } from '../gateway/ids';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { GameStore, ReportRow } from '../store/api';
import type { TableReply, Who } from '../tables/tables';

/** The intake's limits (design 3.6, 4.8; `perAddress` is M13-13's own addition). */
export interface IntakeLimits {
  /** One report per this long per session (60 s). */
  sessionEveryMs: number;
  /** At most `perAddress` reports per `addressWindowMs` per address key. */
  perAddress: number;
  addressWindowMs: number;
}

export const DEFAULT_INTAKE_LIMITS: Readonly<IntakeLimits> = { sessionEveryMs: 60_000, perAddress: 12, addressWindowMs: 3_600_000 };

/** The kind of the server's own attachment of a title report (`TitleEvidence` as JSON). Not one of `REPORT_ATTACHMENT_KINDS`: a client cannot send it. */
export const TITLE_ATTACHMENT = 'title';

/** What a title report keeps of the table: its title as it was and the creator's display name. */
export interface TitleEvidence {
  title: string;
  creator: string | null;
}

export interface IntakeOptions {
  store: Pick<GameStore, 'putReport' | 'tableRow'>;
  /**
   * A listed table's title and creator (a title report names it), or null for a table that is unknown or not listed (a private or matched table's title is
   * never the reporter's to see). The tables layer gives it: `gateway.tables.viewFor(id, null)`.
   */
  titleOf: (table: string) => TitleEvidence | null;
  now?: () => number;
  limits?: Partial<IntakeLimits>;
  logger?: Logger;
  metrics?: Metrics;
}

const err = (code: HostedError['code'], message: string, extra: Partial<HostedError> = {}): TableReply => ({ ok: false, error: { code, message, ...extra } });

/** Counts per key over a window, forgetting what is older (bounded by the keys that reported within it). */
class Window {
  private readonly at = new Map<string, number[]>();

  /** The wait in milliseconds until `key` may report again (0: it may now): at most `n` within `windowMs`. */
  wait(key: string, n: number, windowMs: number, now: number): number {
    const list = (this.at.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length === 0) this.at.delete(key);
    else this.at.set(key, list);
    return list.length < n ? 0 : Math.max(1, list[list.length - n]! + windowMs - now);
  }

  add(key: string, now: number): void {
    const list = this.at.get(key);
    if (list) list.push(now);
    else this.at.set(key, [now]);
  }

  /** Takes back the latest entry of `key` that is `now` (a report that was not stored). */
  undo(key: string, now: number): void {
    const list = this.at.get(key);
    const i = list ? list.lastIndexOf(now) : -1;
    if (!list || i < 0) return;
    list.splice(i, 1);
    if (list.length === 0) this.at.delete(key);
  }

  /** Drops the keys with nothing within the window (so the map stays as small as the traffic). */
  sweep(windowMs: number, now: number): void {
    for (const [k, list] of this.at) if (list.every((t) => now - t >= windowMs)) this.at.delete(k);
  }

  get size(): number {
    return this.at.size;
  }
}

/** Why a report message cannot be stored (null: it can). The gateway checks the same before it calls the service. */
export function reportProblem(m: ReportMessage): string | null {
  if (m.kind !== 'bug' && m.kind !== 'title') return 'The report kind must be bug or title.';
  if (typeof m.text !== 'string' || m.text.length > HOSTED_LIMITS.reportText) return `The report text is too long (at most ${HOSTED_LIMITS.reportText / 1024} KB).`;
  const text = hostedTextProblem(m.text);
  if (text) return TEXT_PROBLEM_MESSAGES[text];
  if (m.kind === 'bug' && m.text.trim() === '') return 'Please say what went wrong.';
  const atts = reportAttachmentsProblem(m.attachments);
  if (atts) return atts;
  const kinds = (m.attachments ?? []).map((a) => a.kind);
  if (new Set(kinds).size !== kinds.length) return 'An attachment kind may be given once.';
  if (m.kind === 'title' && m.table === undefined) return 'A title report names the table.';
  return null;
}

export class ReportIntake implements ReportService {
  private readonly now: () => number;
  private readonly limits: IntakeLimits;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly sessions = new Window();
  private readonly addresses = new Window();
  private swept = 0;

  constructor(private readonly o: IntakeOptions) {
    this.now = o.now ?? Date.now;
    this.limits = { ...DEFAULT_INTAKE_LIMITS, ...o.limits };
    this.logger = o.logger ?? NULL_LOGGER;
    this.metrics = o.metrics ?? NULL_METRICS;
  }

  async report(who: Who, m: ReportMessage, seat: { table: string; seat: SeatNumber } | null): Promise<TableReply> {
    const now = this.now();
    const problem = reportProblem(m);
    if (problem) return err('badMessage', problem);
    const wait = this.reserve(who, now);
    if (wait > 0) {
      this.metrics.inc(METRICS.refusals, { reason: 'rateLimited' });
      return err('rateLimited', 'Reports are limited: please wait a little before sending another.', { retryAfterMs: wait });
    }
    try {
      const row = await this.rowOf(who, m, seat, now);
      if ('ok' in row) {
        this.release(who, now);
        return row;
      }
      await this.o.store.putReport(row);
      this.logger.log('info', 'reportFiled', { kind: row.kind, game: row.game, seat: row.seat });
      return { ok: true };
    } catch (e) {
      this.release(who, now);
      this.logger.log('error', 'reportFailed', { kind: m.kind, error: e instanceof Error ? e.name : 'error' });
      return err('busy', 'The server could not save the report; please try again in a moment.');
    }
  }

  /** The row to store, or the refusal. */
  private async rowOf(who: Who, m: ReportMessage, seat: { table: string; seat: SeatNumber } | null, now: number): Promise<ReportRow | TableReply> {
    let game: string | null = null;
    let at: number | null = null;
    const attachments: ReportRow['attachments'] = (m.attachments ?? []).map((a) => ({ kind: a.kind, json: a.json }));
    if (m.kind === 'bug') {
      if (m.table === undefined || seat?.table === m.table) {
        // where the session sits now (or nowhere: a bug of the lobby or the client)
        if (seat) {
          game = seat.table;
          at = seat.seat;
        }
      } else {
        // a game the session took part in before (the result screen after leaving): its stored seats say so
        const row = await this.o.store.tableRow(m.table);
        const s = row?.seatRows.find((x) => x.session === who.session);
        if (!row || !s) return err('noTable', 'You did not take part in that game.');
        game = row.id;
        at = s.seat;
      }
    } else {
      const evidence = this.o.titleOf(m.table!);
      if (!evidence) return err('noTable', 'That table is not listed any more.');
      game = m.table!;
      at = seat?.table === game ? seat.seat : null;
      attachments.push({ kind: TITLE_ATTACHMENT, json: JSON.stringify(evidence) });
    }
    return { id: ulid(now), kind: m.kind, session: who.session, game, seat: at, text: m.text, attachments, createdAt: new Date(now), status: 'new' };
  }

  /** Takes the session's and the address key's place for this report; the wait in milliseconds when either limit is used up (nothing taken then). */
  private reserve(who: Who, now: number): number {
    if (now - this.swept >= this.limits.addressWindowMs) {
      this.swept = now;
      this.sessions.sweep(this.limits.sessionEveryMs, now);
      this.addresses.sweep(this.limits.addressWindowMs, now);
    }
    const s = this.sessions.wait(who.session, 1, this.limits.sessionEveryMs, now);
    const a = who.key === '' ? 0 : this.addresses.wait(who.key, this.limits.perAddress, this.limits.addressWindowMs, now);
    if (s > 0 || a > 0) return Math.max(s, a);
    this.sessions.add(who.session, now);
    if (who.key !== '') this.addresses.add(who.key, now);
    return 0;
  }

  private release(who: Who, now: number): void {
    this.sessions.undo(who.session, now);
    if (who.key !== '') this.addresses.undo(who.key, now);
  }

  /** How many sessions and address keys the limits remember now (tests). */
  get remembered(): { sessions: number; addresses: number } {
    return { sessions: this.sessions.size, addresses: this.addresses.size };
  }
}
