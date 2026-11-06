/**
 * Shortcuts (CR 727.2b, docs/design/shortcuts.md 3, 6): another player proposed to repeat their last steps a number of times. This player lets it run (Space),
 * or names the point where they want priority instead of being passed for: a pass (1 to the number of times) and a step of that pass (default the last).
 * The engine gives them priority the first time it comes at or after that point; until then, and for a player who answered "let it run", it passes for
 * them as the shortcut does. The decision is never cancellable.
 */
import { useState } from 'react';
import { usePrimary } from './keys';
import { playerName } from './names';
import { PromptActions } from './PromptActions';
import type { PromptProps } from './types';

/** "Alice proposes to repeat these 2 steps 100 times". */
export function shortcutTitle(proposer: string, steps: number, times: number): string {
  return `${proposer} proposes to repeat ${steps === 1 ? 'this step' : `these ${steps} steps`} ${times} time${times === 1 ? '' : 's'}`;
}

export function ShortcutPrompt({ d, view, answer, busy }: PromptProps<'shortcut'>) {
  const [pass, setPass] = useState(1);
  const [step, setStep] = useState(d.steps.length);
  const letRun = () => answer({ kind: 'shortcut' });
  usePrimary(letRun);
  const numbers = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  return (
    <>
      <p className="prompt-heading">{shortcutTitle(playerName(view, d.proposer), d.steps.length, d.times)}</p>
      <ol className="prompt-list" aria-label="The steps of one pass">
        {d.steps.map((label, i) => (
          <li key={i}>
            <span className="prompt-order-pos">{i + 1}.</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <p className="prompt-hint">
        Stopping gives you priority the first time it comes at or after that point; a player with nothing to do is passed for as usual (CR 727.2b).
      </p>
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy} onClick={letRun} title="Space">
          Let it run
        </button>
        <span className="prompt-field">
          <button type="button" disabled={busy} onClick={() => answer({ kind: 'shortcut', stop: { pass, step } })} title={`Take priority at pass ${pass}, after step ${step}`}>
            Stop
          </button>
          <label className="prompt-field">
            at pass
            <select aria-label="Pass" value={pass} disabled={busy} onChange={(e) => setPass(Number(e.target.value))}>
              {numbers(d.times).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="prompt-field">
            after step
            <select aria-label="Step" value={step} disabled={busy} onChange={(e) => setStep(Number(e.target.value))}>
              {numbers(d.steps.length).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </span>
      </PromptActions>
    </>
  );
}
