/**
 * The game log with its rule citations (docs/ARCHITECTURE.md "Rules citations everywhere": every log entry carries `rules`). Newest entry first, a filter by turn,
 * and an expand toggle: collapsed, the panel shows the latest entries only. Entries the view replaced with public text (`privateText`, CR 400.2) arrive already
 * redacted from `viewFor`.
 *
 * Hidden behind the Log button of the side rail: open, it is a drawer over the table's right edge, so
 * opening or closing it moves nothing in the rail.
 */
import { useState } from 'react';
import type { LogEntry } from '@openmtg/engine';
import { useBoard } from './context';
import { logTurns } from './model';

/** Entries shown while the log is collapsed. */
export const COLLAPSED_ENTRIES = 30;

export type TurnFilter = 'all' | 'current' | number;

export function filterLog(log: readonly LogEntry[], filter: TurnFilter, currentTurn: number): LogEntry[] {
  if (filter === 'all') return [...log];
  const turn = filter === 'current' ? currentTurn : filter;
  return log.filter((e) => e.turn === turn);
}

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <li className={`log-entry log-${entry.level ?? 'info'}`} data-seq={entry.seq}>
      <span className="log-turn" title={`Turn ${entry.turn}`}>
        T{entry.turn}
      </span>
      <span className="log-text">{entry.text}</span>
      {entry.rules && entry.rules.length > 0 && (
        <span className="log-rules" aria-label="Rules">
          {entry.rules.map((r, i) => (
            <cite key={`${r}-${i}`} className="rule-chip">
              {r}
            </cite>
          ))}
        </span>
      )}
    </li>
  );
}

/** The rail's Log button: opens and closes the log drawer. */
export function LogButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { view } = useBoard();
  return (
    <button type="button" className={`log-toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls="game-log" onClick={onToggle}>
      Log <span className="log-count">{view.log.length}</span>
    </button>
  );
}

export function GameLog({ onClose }: { onClose?: () => void }) {
  const { view } = useBoard();
  const [filter, setFilter] = useState<TurnFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const turns = logTurns(view);
  const entries = filterLog(view.log, filter, view.turn.number).reverse();
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ENTRIES);
  return (
    <section id="game-log" className={`game-log${expanded ? ' is-expanded' : ''}`} aria-label="Game log">
      <div className="log-header">
        <h2 className="panel-title">Log</h2>
        <label className="log-filter">
          <span className="sr-only">Show turn</span>
          <select
            aria-label="Filter log by turn"
            value={String(filter)}
            onChange={(e) => {
              const v = e.target.value;
              setFilter(v === 'all' || v === 'current' ? v : Number(v));
            }}
          >
            <option value="all">All turns</option>
            <option value="current">This turn</option>
            {turns.map((t) => (
              <option key={t} value={String(t)}>
                Turn {t}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="log-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Less' : 'More'}
        </button>
        {onClose && (
          <button type="button" className="log-close" aria-label="Close the log" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ol className="log-list">
          {shown.map((e) => (
            <LogLine key={e.seq} entry={e} />
          ))}
        </ol>
      )}
      {!expanded && entries.length > shown.length && <p className="muted">{entries.length - shown.length} older entries hidden.</p>}
    </section>
  );
}
