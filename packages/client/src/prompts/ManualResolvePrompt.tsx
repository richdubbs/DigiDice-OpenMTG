/**
 * Resolving by hand (ARCHITECTURE "Manual resolution": never silently skipped). Shows the text the engine could not run, why, what already happened and
 * what was chosen so far; the players apply its effect with manual adjustments, then confirm. The adjustments are sent together as one answer and the
 * engine logs each of them.
 *
 * Confirming with no adjustments means nothing of the effect happens, so it is never a one-key action: Space confirms only when there are adjustments, and
 * "Done (no changes)" asks first. An adjustment that names a card an earlier one moved is refused with the reason (CR 400.7, `staleReference`).
 *
 * In steps (FAST3 CL1, C6 gap 6; docs/design/m8-client.md "Manual resolution in steps"): "Apply and continue" sends the adjustments so far with
 * `continue: true`; the engine applies them at once and asks again (a new decision, so this prompt starts over with an empty list) with the game after
 * them, so text that depends on what an earlier part did can be followed (Brainstorm: draw three, see them in the hand, then put two back; CR 608.2c).
 * "Done" ends the resolution. After a step nothing can be cancelled any more (the player may have seen hidden cards, CR 733.1, 400.2): the engine
 * re-issues the decision as not cancellable, and on a cancellable first prompt this one says so next to "Apply and continue". Once steps were applied,
 * "Done" with no further adjustments is an ordinary confirmation (the effect may be complete), not "nothing happens".
 */
import { useState } from 'react';
import { MANUAL_MAX_STEPS, type ManualOp } from '@openmtg/engine';
import { usePrimary } from './keys';
import { ManualPanel } from './ManualPanel';
import { describeOp, staleReference } from './manualOps';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';

export function ManualResolvePrompt({ d, view, answer, busy }: PromptProps<'manualResolve'>) {
  const [ops, setOps] = useState<ManualOp[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const submit = () => answer({ kind: 'manualResolve', ops });
  const step = d.step ?? 0;
  // The engine refuses `continue` once `step` reaches MANUAL_MAX_STEPS - 1: the last prompt can only be confirmed.
  const canContinue = step < MANUAL_MAX_STEPS - 1;
  const applyAndContinue = () => answer({ kind: 'manualResolve', ops, continue: true });
  usePrimary(submit, ops.length > 0);
  const add = (op: ManualOp): string | null => {
    const stale = staleReference(view, ops, op);
    if (stale === null) setOps((l) => [...l, op]);
    return stale;
  };
  return (
    <div className="prompt-manual-resolve">
      <div className="prompt-manual-card">
        <h3>
          {d.sourceName}
          {step > 0 && <span className="prompt-manual-step"> · Step {step + 1}</span>}
        </h3>
        <p className="prompt-manual-text">{d.text}</p>
        {d.reason && <p className="prompt-hint">Why by hand: {d.reason}</p>}
        {d.done && d.done.length > 0 && (
          <div>
            <span className="prompt-hint">Already done by the engine:</span>
            <ul className="prompt-list">{d.done.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        )}
        {d.bound && d.bound.length > 0 && (
          <div>
            <span className="prompt-hint">Chosen so far:</span>
            <ul className="prompt-list">{d.bound.map((b, i) => <li key={i}>{b.name}: {b.objects.join(', ') || 'nothing'}</li>)}</ul>
          </div>
        )}
        {step > 0 && (
          <p className="prompt-hint" role="note">
            {step} step{step === 1 ? '' : 's'} already applied: the board and the log show {step === 1 ? 'it' : 'them'}. Add what is left, then Done.
          </p>
        )}
        {d.reminder && <p className="prompt-hint">The game will keep a reminder of this effect for its duration.</p>}
      </div>
      <ManualPanel view={view} {...(d.resolvingId ? { exclude: d.resolvingId } : {})} busy={busy} onAdd={add} />
      <ol className="prompt-list prompt-manual-ops" aria-label="Adjustments to apply">
        {ops.map((op, i) => (
          <li key={i}>
            {describeOp(view, op)}
            <button type="button" className="prompt-button-small" aria-label={`Remove: ${describeOp(view, op)}`} disabled={busy} onClick={() => setOps((l) => l.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      {ops.length === 0 && step === 0 && confirmEmpty ? (
        <PromptActions>
          <p className="prompt-warning">Resolve with no changes? Nothing of this effect will happen.</p>
          <button type="button" disabled={busy} onClick={submit}>
            Resolve with no changes
          </button>
          <button type="button" className="button-primary" disabled={busy} onClick={() => setConfirmEmpty(false)}>
            Back
          </button>
        </PromptActions>
      ) : (
        <PromptActions>
          {ops.length > 0 ? (
            <button type="button" className="button-primary" disabled={busy} onClick={submit} title="Space">
              Done: apply {ops.length} adjustment{ops.length === 1 ? '' : 's'}
            </button>
          ) : step > 0 ? (
            <button type="button" disabled={busy} onClick={submit}>
              Done
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmEmpty(true)}>
              Done (no changes)
            </button>
          )}
          {canContinue && (
            <button
              type="button"
              disabled={busy || ops.length === 0}
              onClick={applyAndContinue}
              title="Apply these adjustments now and keep resolving: see what they did before the rest of the text"
            >
              Apply and continue
            </button>
          )}
          {canContinue && d.cancellable && step === 0 && (
            <p className="prompt-hint">"Apply and continue" commits this action: after it, it can no longer be cancelled (CR 733.1).</p>
          )}
          {!canContinue && <p className="prompt-hint">The last step ({MANUAL_MAX_STEPS} at most): finish with Done.</p>}
        </PromptActions>
      )}
    </div>
  );
}
