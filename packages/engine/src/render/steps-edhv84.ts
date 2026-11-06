/**
 * edh-c-84 (CR 608.2e, 701.21a, 701.9a; Magus of the Balance, Restore Balance): the clause of the `balance` step, in the two orders the cards print the later parts.
 */
import { plain, type Clause } from './clause';
import type { EffectStep } from '../types/ability';
import type { RenderState } from './state';
import { NoRenderer } from './text';

const LEAD = 'each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest';

export const CLAUSES_EDHV84 = {
  balance: (s: Extract<EffectStep, { op: 'balance' }>, _st: RenderState): Clause => {
    const p = s.parts.join(',');
    if (p === 'lands') return plain(LEAD);
    if (p === 'lands,creatures,cards') return plain(`${LEAD}. players sacrifice creatures and discard cards the same way`, { standalone: true });
    if (p === 'lands,cards,creatures') return plain(`${LEAD}. players discard cards and sacrifice creatures the same way`, { standalone: true });
    throw new NoRenderer('a balance of other parts than lands, then creatures and cards in either order');
  },
};
