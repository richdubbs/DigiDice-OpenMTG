/**
 * The lobby browser (hosted design 4.2, 4.3, 12; package M13-12): the listed tables of the DigiDice server, a page at a time, kept current by the lobby
 * feed (watcher.ts), with filters (format, players, a free seat, a password) and three orders. A table is joined with the deck chosen above it (and its
 * password when it has one), or its title reported to the server's owner.
 *
 * Joining is the screen's (HostedScreen.tsx `sit`): this list only says which table and which password. Nothing is sent until a button is pressed; the
 * password is held in this component's state only while its prompt is open, and never stored.
 */
import { checkPassword, HOSTED_LIMITS, type HostedFormatId, type LobbyFilter, type LobbyListing, type LobbySort, type TableSize } from '@openmtg/hosted/api';
import { useState } from 'react';
import { explainHostedError, type ExplainedHostedError } from '../errors';
import { useNow } from '../game/useNow';
import type { HostedLink } from '../HostedLink';
import { HostedErrorBox } from '../room/HostedErrorBox';
import { useLobby } from './useLobby';
import { ageText, clockShort, formatShort, seatsText } from './words';

export interface LobbyBrowserProps {
  link: HostedLink;
  /** The formats this server offers, with their labels (the filter's choices). */
  formats: readonly { id: string; label: string }[];
  /** The table sizes any of them allows (the players filter shows only when there is more than one). */
  sizes: readonly TableSize[];
  /** Why the player cannot sit at a table of this format now (no deck, a deck for another format, a name the server would refuse), or null. */
  cannotSit: (format: HostedFormatId) => string | null;
  /** Sits at the table: null when it worked, else what went wrong (shown by the table). */
  sit: (table: LobbyListing, password: string | undefined) => Promise<ExplainedHostedError | null>;
  /** A sit is under way (every Join waits). */
  busy: boolean;
}

/** What the filter controls hold: '' is "any". */
interface Filters {
  format: string;
  seats: string;
  open: boolean;
  locked: '' | 'yes' | 'no';
}

function toFilter(f: Filters): LobbyFilter {
  const out: LobbyFilter = {};
  if (f.format !== '') out.format = f.format as HostedFormatId;
  if (f.seats !== '') out.seats = Number(f.seats) as TableSize;
  if (f.open) out.open = true;
  if (f.locked !== '') out.locked = f.locked === 'yes';
  return out;
}

const MODE_TEXT = {
  loading: 'Loading the tables…',
  live: 'The list updates by itself.',
  polling: 'The list refreshes every 10 seconds.',
  unavailable: null,
} as const;

/** One open prompt at a time: a password to join with, or a title report. */
type Prompt = { table: string; kind: 'password' | 'report' } | null;

export function LobbyBrowser({ link, formats, sizes, cannotSit, sit, busy }: LobbyBrowserProps) {
  const [filters, setFilters] = useState<Filters>({
    format: '',
    seats: '',
    open: true,
    locked: '',
  });
  const [sort, setSort] = useState<LobbySort>('newest');
  const [page, setPage] = useState(0);
  const lobby = useLobby(link, { filter: toFilter(filters), sort, page });
  const now = useNow(true, 30_000);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [password, setPassword] = useState('');
  const [reportText, setReportText] = useState('');
  const [problems, setProblems] = useState<ReadonlyMap<string, ExplainedHostedError>>(new Map());
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);

  const change = (next: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(0);
  };
  const problemFor = (table: string, e: ExplainedHostedError | null) =>
    setProblems((m) => {
      const next = new Map(m);
      if (e) next.set(table, e);
      else next.delete(table);
      return next;
    });
  const openPrompt = (table: string, kind: 'password' | 'report') => {
    setPrompt({ table, kind });
    setPassword('');
    setReportText('');
    problemFor(table, null);
  };

  const join = async (l: LobbyListing, pw?: string) => {
    problemFor(l.table, null);
    const e = await sit(l, pw);
    if (e) problemFor(l.table, e);
    else setPrompt(null);
    setPassword('');
  };

  const report = async (l: LobbyListing) => {
    setSending(l.table);
    problemFor(l.table, null);
    const r = await link.command({ t: 'report', kind: 'title', table: l.table, text: reportText.trim() }, { timeoutMs: 15_000, maxPaceMs: 0 });
    setSending(null);
    if (!r.ok) problemFor(l.table, explainHostedError(r.error));
    else {
      setReported((s) => new Set(s).add(l.table));
      setPrompt(null);
    }
  };

  const passwordCheck = password === '' ? null : checkPassword(password);
  const statusText = MODE_TEXT[lobby.mode];

  return (
    <section className="hud-panel hosted-panel hosted-lobby" aria-label="Open tables">
      <h2>Open tables</h2>
      <div className="hosted-form hosted-lobby-filters">
        <label>
          Show format
          <select value={filters.format} onChange={(e) => change({ format: e.target.value })}>
            <option value="">Any format</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {sizes.length > 1 && (
          <label>
            Show players
            <select value={filters.seats} onChange={(e) => change({ seats: e.target.value })}>
              <option value="">Any number</option>
              {sizes.map((n) => (
                <option key={n} value={String(n)}>
                  {n} players
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Show passwords
          <select value={filters.locked} onChange={(e) => change({ locked: e.target.value as Filters['locked'] })}>
            <option value="">Tables with or without one</option>
            <option value="no">Only tables without a password</option>
            <option value="yes">Only tables with a password</option>
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => (setSort(e.target.value as LobbySort), setPage(0))}>
            <option value="newest">Newest first</option>
            <option value="filled">Fullest first</option>
            <option value="format">Format</option>
          </select>
        </label>
        <label className="hosted-check">
          <input type="checkbox" checked={filters.open} onChange={(e) => change({ open: e.target.checked })} />
          Only tables with a free seat
        </label>
      </div>

      {lobby.problem && <HostedErrorBox error={lobby.problem} />}
      {statusText && (
        <p className="hosted-note" role="status">
          {statusText}{' '}
          <button type="button" className="hosted-link-button" onClick={lobby.refresh} disabled={lobby.mode === 'unavailable'}>
            Refresh
          </button>
        </p>
      )}

      {lobby.loaded && lobby.listings.length === 0 && lobby.mode !== 'unavailable' && (
        <p className="hosted-status">No open tables match. Make one above, or use quick match.</p>
      )}
      {lobby.listings.length > 0 && (
        <ul className="hosted-tables" aria-label="Tables" aria-busy={!lobby.loaded || undefined}>
          {lobby.listings.map((l) => {
            const full = l.filled >= l.seats;
            const why = full ? 'This table is full.' : cannotSit(l.format);
            const problem = problems.get(l.table);
            const open = prompt?.table === l.table ? prompt.kind : null;
            return (
              <li key={l.table} data-locked={l.locked || undefined}>
                <div className="hosted-table-head">
                  <b className="hosted-table-title">{l.title}</b>
                  {l.locked && <span className="hosted-table-lock"> · password</span>}
                </div>
                <div className="hosted-table-meta">
                  {formatShort(l.format)} · {seatsText(l.filled, l.seats)} · {clockShort(l.clock)} · made by {l.creator} · {ageText(l.createdAt, now)}
                </div>
                {open === 'password' ? (
                  <form
                    className="hosted-inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (passwordCheck?.ok) void join(l, password);
                    }}
                  >
                    <label>
                      Password for {l.title}
                      <input
                        type="password"
                        value={password}
                        maxLength={HOSTED_LIMITS.passwordMax * 2}
                        autoComplete="off"
                        autoFocus
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                    <div className="hosted-buttons">
                      <button type="submit" className="button-primary" disabled={busy || !passwordCheck?.ok}>
                        {busy ? 'Joining…' : 'Join with this password'}
                      </button>
                      <button type="button" onClick={() => setPrompt(null)}>
                        Cancel
                      </button>
                    </div>
                    {passwordCheck && !passwordCheck.ok && <p className="hosted-note">{passwordCheck.message}</p>}
                  </form>
                ) : open === 'report' ? (
                  <form
                    className="hosted-inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void report(l);
                    }}
                  >
                    <label>
                      What is wrong with this title? (you may leave it empty)
                      <textarea value={reportText} rows={2} maxLength={500} onChange={(e) => setReportText(e.target.value)} />
                    </label>
                    <div className="hosted-buttons">
                      <button type="submit" className="button-primary" disabled={sending === l.table}>
                        {sending === l.table ? 'Sending…' : 'Send the report'}
                      </button>
                      <button type="button" onClick={() => setPrompt(null)}>
                        Cancel
                      </button>
                    </div>
                    <p className="hosted-note">The server keeps the title as it is now, for the person who runs it to read.</p>
                  </form>
                ) : (
                  <div className="hosted-buttons">
                    <button
                      type="button"
                      className="button-primary"
                      aria-label={`Join ${l.title}`}
                      disabled={busy || why !== null}
                      title={why ?? undefined}
                      onClick={() => (l.locked ? openPrompt(l.table, 'password') : void join(l))}
                    >
                      Join
                    </button>
                    {reported.has(l.table) ? (
                      <span className="hosted-note">Reported. Thank you.</span>
                    ) : (
                      <button type="button" aria-label={`Report the title ${l.title}`} onClick={() => openPrompt(l.table, 'report')}>
                        Report
                      </button>
                    )}
                    {why && !full && <span className="hosted-note">{why}</span>}
                  </div>
                )}
                {problem && <HostedErrorBox error={problem} />}
              </li>
            );
          })}
        </ul>
      )}

      {lobby.pages > 1 && (
        <div className="hosted-buttons hosted-pager" role="navigation" aria-label="Pages of tables">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </button>
          <span className="hosted-note">
            Page {Math.min(page + 1, lobby.pages)} of {lobby.pages} ({lobby.total} tables)
          </span>
          <button type="button" disabled={page + 1 >= lobby.pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
