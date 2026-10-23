/**
 * The deck's format check (POST /api/decks/validate): legal, or each problem with the rule it breaks. Card problems also appear next to the card. While
 * a new check runs, the last answer stays, dimmed, with a small "Re-checking…" marker.
 */
import type { DeckProblem, ValidateResponse } from '@openmtg/server/api';
import type { ValidationState } from './useValidation';

/** Problems grouped by the card they are about. */
export function problemsByCard(problems: readonly DeckProblem[]): Map<string, DeckProblem[]> {
  const m = new Map<string, DeckProblem[]>();
  for (const p of problems) if (p.card) m.set(p.card, [...(m.get(p.card) ?? []), p]);
  return m;
}

function Result({ result, formatName, stale, open }: { result: ValidateResponse; formatName: string; stale: boolean; open: boolean }) {
  // The server's `status`, never `valid` alone: a deck with warnings ("unchecked": an unknown card, no legality data) is never shown as legal
  // (server api.ts ValidateResponse). Notes are informational and stay out of the problem list.
  const shown = result.problems.filter((p) => p.severity !== 'note');
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <div className={stale ? 'deck-stale' : undefined}>
      {result.status === 'legal' ? (
        <p role={stale ? undefined : 'status'} className="deck-ok">
          Legal in {formatName}.
        </p>
      ) : (
        <details className="deck-problem-box" open={open}>
          <summary>
            <span role={stale ? undefined : 'status'} className="deck-error">
              {result.status === 'illegal'
                ? `Not legal in ${formatName}: ${count(shown.length, 'problem')}.`
                : `Not fully checked for ${formatName}: ${count(shown.length, 'warning')}.`}
            </span>
          </summary>
          <ul className="problems" aria-label="Deck problems">
            {shown.map((p, i) => (
              <li key={i}>
                {p.message} {p.rules.length > 0 && <span className="rule">({p.rules.join(', ')})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** `expanded`: show the list of problems open (Deck Details has room; the deck list's narrow column keeps it closed under its one-line summary). */
export function ValidationPanel({ state, formatName, expanded = false }: { state: ValidationState; formatName: string; expanded?: boolean }) {
  return (
    <section className="deck-validation" aria-label="Format check" tabIndex={-1} aria-busy={state.status === 'checking'}>
      {/* The one-line answer already names the format; the heading is for screen readers unless there is room for it. */}
      <h2 className={expanded ? undefined : 'sr-only'}>
        Format: {formatName}
        {state.status === 'checking' && (
          <span role="status" className="deck-rechecking">
            {state.previous ? 'Re-checking…' : 'Checking…'}
          </span>
        )}
      </h2>
      {state.status === 'checking' && state.previous && <Result result={state.previous} formatName={formatName} stale open={expanded} />}
      {state.status === 'error' && (
        <p role="alert" className="deck-error">
          Could not check the deck: {state.message}
        </p>
      )}
      {state.status === 'done' && <Result result={state.result} formatName={formatName} stale={false} open={expanded} />}
    </section>
  );
}
