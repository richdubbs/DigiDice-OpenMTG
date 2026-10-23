/**
 * The Replays screen (replays design 10; RPL-1): every replay kept in this browser, newest first, with its date, players, format, mode, result
 * ("Alice won on turn 14", "Abandoned on turn 6"), length, and badges for its kind and what it can be watched as (Exact, Checked when watched,
 * Recording only, Needs a newer OpenMTG). Filters by format, opponent and result; sort by date. Each replay can be watched (the game screen with a
 * replay connection, openReplay.ts), renamed, marked Keep, exported as a `.openmtg-replay` file and deleted. Import takes files from the file picker
 * or dropped anywhere on the screen; a file that is not a replay, or is too large, is refused with the reason.
 *
 * The retention setting is here too: of the replays not marked Keep, the newest 10, 50 or 200 stay (library.ts).
 *
 * Text from a file (titles, names, reasons) is rendered as text, never as markup (design 4: "Data, never code").
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { REPLAY_EXTENSION, type ReplayGameInfo } from '@openmtg/engine';
import { useNav } from '../app/nav';
import { ScreenHeader } from '../app/ScreenHeader';
import { sfx } from '../audio/sfx';
import { ENGINE_BUILD } from '../engine-build';
import { pageReplays, type ReplayEnv } from './env';
import { formatLabel, lengthText, modeLabel, resultText } from './file';
import {
  RETENTION_CHOICES, STATUS_LABEL, exportFileName, replayStatus, retentionLimit, setRetentionLimit, type LibraryEntry, type RetentionLimit,
} from './library';
import { openReplay } from './openReplay';
import './replays.css';

export type ResultFilter = 'any' | 'won' | 'lost' | 'draw' | 'abandoned';

export interface ReplayFilters {
  /** A format id, or '' for every format. */
  format: string;
  /** An opponent's name, or '' for anyone. */
  opponent: string;
  result: ResultFilter;
  sort: 'newest' | 'oldest';
}

export const NO_FILTERS: ReplayFilters = { format: '', opponent: '', result: 'any', sort: 'newest' };

/** The players a replay was played against: everyone but its saver (in hot-seat, where nobody saved it alone, everyone). */
export function opponentsOf(game: ReplayGameInfo): string[] {
  return game.players.filter((p) => p.id !== game.savedBy).map((p) => p.name);
}

function resultMatches(game: ReplayGameInfo, want: ResultFilter): boolean {
  const winner = game.result?.winner;
  switch (want) {
    case 'any':
      return true;
    case 'abandoned':
      return game.ended === 'abandoned';
    case 'draw':
      return game.result !== null && winner === null;
    case 'won':
      return game.savedBy !== null && game.result !== null && winner === game.savedBy;
    case 'lost':
      return game.savedBy !== null && game.result !== null && winner !== null && winner !== game.savedBy;
  }
}

/** The replays the filters let through, in the chosen order (pure). */
export function filterReplays(entries: readonly LibraryEntry[], f: ReplayFilters): LibraryEntry[] {
  const out = entries.filter((e) => {
    const g = e.summary.game;
    return (f.format === '' || g.format === f.format) && (f.opponent === '' || opponentsOf(g).includes(f.opponent)) && resultMatches(g, f.result);
  });
  const dir = f.sort === 'newest' ? -1 : 1;
  return out.sort((a, b) => dir * (a.summary.createdAt.localeCompare(b.summary.createdAt) || a.addedAt - b.addedAt));
}

/** A stored ISO time as the player's own date and time ("2026-10-21 14:05"). */
export function localDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Save bytes as a file through a temporary link (nothing leaves the player's machine). False when the browser cannot. */
export function downloadBytes(fileName: string, bytes: Uint8Array, type = 'application/gzip'): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Its click is not the player's (audio/uiSounds.ts).
  a.dataset.sfx = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

const RESULT_OPTIONS: { id: ResultFilter; label: string }[] = [
  { id: 'any', label: 'Any result' },
  { id: 'won', label: 'I won' },
  { id: 'lost', label: 'I lost' },
  { id: 'draw', label: 'Draw' },
  { id: 'abandoned', label: 'Abandoned' },
];

type RowAction = 'rename' | 'delete';

export function ReplaysScreen({ env = pageReplays(), build = ENGINE_BUILD }: { env?: ReplayEnv; build?: string | null }) {
  const nav = useNav();
  const { library } = env;
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [filters, setFilters] = useState<ReplayFilters>(NO_FILTERS);
  const [retention, setRetention] = useState<RetentionLimit>(retentionLimit);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; action: RowAction } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = useId();

  const reload = useCallback(
    () =>
      library.list().then(setEntries, (e: unknown) => {
        setEntries([]);
        setError(`Could not open the replays: ${e instanceof Error ? e.message : String(e)}`);
      }),
    [library],
  );
  useEffect(() => {
    void reload();
    return library.subscribe(() => void reload());
  }, [library, reload]);

  const formats = useMemo(() => [...new Set((entries ?? []).map((e) => e.summary.game.format))].sort(), [entries]);
  const opponents = useMemo(() => [...new Set((entries ?? []).flatMap((e) => opponentsOf(e.summary.game)))].sort((a, b) => a.localeCompare(b)), [entries]);
  const shown = useMemo(() => filterReplays(entries ?? [], filters), [entries, filters]);
  const set = (patch: Partial<ReplayFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const fail = (text: string) => {
    setMessage(null);
    setError(text);
    sfx('ui.error');
  };
  const done = (text: string) => {
    setError(null);
    setMessage(text);
  };

  const importFiles = async (files: readonly File[]) => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    const ok: string[] = [];
    const refused: string[] = [];
    for (const f of files) {
      const r = await library.importFile(f);
      if (r.ok) ok.push(r.entry.summary.title || 'Untitled replay');
      else refused.push(r.message);
    }
    setBusy(false);
    if (refused.length > 0) fail(refused.join(' '));
    else setError(null);
    if (ok.length > 0) {
      setMessage(ok.length === 1 ? `Imported “${ok[0]}”.` : `Imported ${ok.length} replays.`);
      if (refused.length === 0) sfx('ui.success');
    } else if (refused.length === 0) setMessage(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFiles([...(e.dataTransfer?.files ?? [])]);
  };

  const watch = async (entry: LibraryEntry) => {
    const read = await library.read(entry.key);
    if (!read.ok) return fail(`“${entry.summary.title}” cannot be watched: ${read.error.message}`);
    const opened = await openReplay(read.value);
    if (!opened.connection) return fail(opened.notice);
    nav.go({ screen: 'game', connection: opened.connection });
  };

  const exportOne = async (entry: LibraryEntry) => {
    const bytes = await library.bytes(entry.key);
    if (!bytes) return fail('This replay is no longer in the library.');
    if (!downloadBytes(exportFileName(entry.summary.title), bytes)) return fail('This browser cannot save files.');
    done(`Exported “${entry.summary.title}”.`);
    sfx('ui.success');
  };

  const run = async (work: () => Promise<unknown>, text: string) => {
    try {
      await work();
      setOpen(null);
      done(text);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={`screen replays-screen${dragging ? ' replays-dragging' : ''}`}
      onDragOver={(e) => {
        if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <ScreenHeader title="Replays">
        {entries !== null && entries.length > 0 && <span className="replays-total">{entries.length === 1 ? '1 replay' : `${entries.length} replays`}</span>}
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          className="replays-file-input"
          accept={`${REPLAY_EXTENSION},application/gzip,application/json`}
          multiple
          aria-label="Import replay files"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            void importFiles(files);
          }}
        />
      </ScreenHeader>
      {!library.persistent && (
        <p className="replays-note" role="note">
          This browser is not keeping site storage, so replays last only until the page is closed. Export a replay to keep it.
        </p>
      )}
      {error && (
        <p className="replays-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="replays-message" role="status">
          {message}
        </p>
      )}
      <div className="replays-tools hud-panel" role="group" aria-label="Filter and sort">
        <label>
          Format
          <select value={filters.format} onChange={(e) => set({ format: e.target.value })}>
            <option value="">Every format</option>
            {formats.map((f) => (
              <option key={f} value={f}>
                {formatLabel(f)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent
          <select value={filters.opponent} onChange={(e) => set({ opponent: e.target.value })}>
            <option value="">Anyone</option>
            {opponents.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Result
          <select value={filters.result} onChange={(e) => set({ result: e.target.value as ResultFilter })}>
            {RESULT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as ReplayFilters['sort'] })}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <label className="replays-retention">
          Keep automatically
          <select
            value={retention}
            aria-describedby={`${ids}-retention`}
            onChange={(e) => {
              const n = Number(e.target.value) as RetentionLimit;
              setRetention(n);
              setRetentionLimit(n);
            }}
          >
            {RETENTION_CHOICES.map((n) => (
              <option key={n} value={n}>
                The newest {n}
              </option>
            ))}
          </select>
        </label>
        <span id={`${ids}-retention`} className="replays-hint">
          Replays marked Keep are never removed; of the others, older ones beyond this many are removed when a new replay is saved.
        </span>
      </div>
      <p className="replays-hint">Drop {REPLAY_EXTENSION} files anywhere here to import them.</p>
      {entries === null ? (
        <p role="status">Loading replays…</p>
      ) : entries.length === 0 ? (
        <p className="replays-empty hud-panel">No replays yet. Every game you play here is kept as a replay: finished, conceded or left unfinished.</p>
      ) : shown.length === 0 ? (
        <p className="replays-empty hud-panel">No replay matches these filters.</p>
      ) : (
        <ul className="replays-list" aria-label="Your replays">
          {shown.map((e) => (
            <ReplayRow
              key={e.key}
              entry={e}
              build={build}
              action={open?.id === e.key ? open.action : null}
              setAction={(a) => setOpen(a ? { id: e.key, action: a } : null)}
              onWatch={() => void watch(e)}
              onExport={() => void exportOne(e)}
              onKeep={() => void run(() => library.setKeep(e.key, !e.keep), e.keep ? `“${e.summary.title}” is no longer kept.` : `Keeping “${e.summary.title}”.`)}
              onRename={(title) => void run(() => library.rename(e.key, title), `Renamed to “${title}”.`)}
              onDelete={() =>
                void run(async () => {
                  await library.remove(e.key);
                  sfx('ui.delete');
                }, `Deleted “${e.summary.title}”.`)
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReplayRow({
  entry,
  build,
  action,
  setAction,
  onWatch,
  onExport,
  onKeep,
  onRename,
  onDelete,
}: {
  entry: LibraryEntry;
  build: string | null;
  action: RowAction | null;
  setAction: (a: RowAction | null) => void;
  onWatch: () => void;
  onExport: () => void;
  onKeep: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const s = entry.summary;
  const g = s.game;
  const title = s.title.trim() || 'Untitled replay';
  const [name, setName] = useState(s.title);
  const status = replayStatus(s, build);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (action === 'delete') cancel.current?.focus();
  }, [action]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onRename(name.trim());
  };
  const players = g.players.map((p) => (p.kind === 'computer' ? `${p.name} (computer)` : p.name)).join(' vs ');
  return (
    <li className="replays-row hud-panel" aria-label={title} data-replay-id={entry.key}>
      <div className="replays-row-main">
        <h2 className="replays-row-title">{title}</h2>
        <dl className="replays-facts">
          <div>
            <dt>Date</dt>
            <dd>{localDateTime(s.createdAt)}</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>{players}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{formatLabel(g.format)}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{modeLabel(g.mode)}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>{resultText(g)}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{lengthText(g)}</dd>
          </div>
        </dl>
        <ul className="replays-badges" aria-label="Badges">
          <li className="replays-badge">{s.kind === 'game' ? 'Game' : 'Recording'}</li>
          <li className={`replays-badge replays-badge-${status}`}>{STATUS_LABEL[status]}</li>
          {entry.keep && <li className="replays-badge replays-badge-kept">Kept</li>}
        </ul>
      </div>
      <div className="replays-row-actions">
        <button type="button" className="button-primary" onClick={onWatch} disabled={status === 'needsNewer'}>
          Watch
        </button>
        <button type="button" onClick={() => setAction(action === 'rename' ? null : 'rename')} aria-expanded={action === 'rename'}>
          Rename
        </button>
        <button type="button" onClick={onKeep} aria-pressed={entry.keep}>
          Keep
        </button>
        <button type="button" onClick={onExport} data-sfx="none">
          Export
        </button>
        <button type="button" className="button-danger" onClick={() => setAction(action === 'delete' ? null : 'delete')} aria-expanded={action === 'delete'}>
          Delete
        </button>
      </div>
      {action === 'rename' && (
        <form className="replays-row-form" onSubmit={submit} aria-label={`Rename ${title}`}>
          <input aria-label="New title" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="submit" className="button-primary" disabled={!name.trim()}>
            Save title
          </button>
          <button type="button" className="button-link" onClick={() => setAction(null)}>
            Cancel
          </button>
        </form>
      )}
      {action === 'delete' && (
        <div className="replays-row-form" role="alertdialog" aria-label={`Delete ${title}`}>
          <p>Delete “{title}”? This cannot be undone; export it first to keep a copy.</p>
          <button type="button" className="button-danger" data-sfx="none" onClick={onDelete}>
            Delete replay
          </button>
          <button type="button" className="button-link" onClick={() => setAction(null)} ref={cancel}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
