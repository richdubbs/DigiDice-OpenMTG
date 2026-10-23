/**
 * Pass 8, optionality (design 6.5). Owner: WP17.
 *
 * "You may" is built by templates (`{op:'may', who, do}`; CR 608.2d: the choice is made on resolution; in a triggered ability too, CR 603.5). The nesting
 * that the rules require, "[X] unless [player] pays" with the payer deciding FIRST and the "you may" inside its `else` (CR 118.12a, Rhystic Study, design
 * D3), is fixed by the wrapper templates and cannot be composed in the other order. This pass checks what the templates cannot: every `may` names who
 * chooses (design 1.1.3: no default actor) and has something to do; a `pay` names its payer and its cost. A node that fails is never repaired by a guess:
 * its sentence is manual.
 */
import { stepsInOrder } from './mentions';
import type { Draft } from './types';
import { cloneDraft, isRec, sequences, setManual } from './util';

/** Pass 8. */
export function lowerOptionality(input: Draft): Draft {
  const d = cloneDraft(input);
  for (const seq of sequences(d)) {
    for (const u of seq) {
      if (u.manual) continue;
      for (const { step } of stepsInOrder(u.steps)) {
        if (step['op'] === 'may' && (!isRec(step['who']) || !Array.isArray(step['do']) || (step['do'] as unknown[]).length === 0)) {
          setManual(u, { code: 'lint', reason: 'a "may" without a chooser or without an effect (CR 608.2d)' });
          break;
        }
        if (step['op'] === 'pay' && (!isRec(step['who']) || !isRec(step['cost']))) {
          setManual(u, { code: 'lint', reason: 'a payment without a payer or a cost (CR 118.12)' });
          break;
        }
      }
    }
  }
  return d;
}
