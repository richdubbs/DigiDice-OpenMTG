/**
 * edh-next-71 (Commander lane instead, second round; CR cites from memory, unverified unless marked).
 *
 * Words of the replacements of the round: "their graveyard" (a spell cast from an opponent's graveyard, Arcane Heist, zz-cloud/edh-next-71.json rid.edhn71.cast.theirGraveyard.exileInstead) and
 * a replacement whose instructions run on over several sentences (Eruth, Tomorrow; parser/lower/ability.ts#drawInsteadSequence).
 */
import type { EffectStep } from '../types/ability';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt, NoRenderer } from './text';

/** "put into your graveyard" when it is yours; otherwise "a graveyard" or "their graveyard" (the spell cast from an opponent's graveyard goes to its owner's: Arcane Heist). */
export function graveyardOfWord(yours: boolean): string {
  return yours ? 'your' : alt('a', 'their');
}

/**
 * A replacement whose instructions run on over several sentences (Eruth: "If you would draw a card, exile the top two cards of your library instead. You may play those cards this
 * turn."): "instead" closes the first sentence, the other steps are the sentences after it. The first sentence may be any number of the steps, so every cut is offered (each said with
 * its own copy of the state, so the words that name what an earlier step moved follow); null when there is only one step or no cut can be said.
 */
export function insteadClosesFirstSentence(steps: readonly EffectStep[], st: RenderState): string | null {
  const said: string[] = [];
  for (let k = 1; k < steps.length; k++) {
    const fork = cloneState(st);
    try {
      const first = K.steps(steps.slice(0, k) as EffectStep[], fork);
      const rest = K.steps(steps.slice(k) as EffectStep[], fork);
      said.push(`${first} instead. ${rest}`);
    } catch (e) {
      if (!(e instanceof NoRenderer)) throw e;
    }
  }
  return said.length === 0 ? null : alt(...said);
}
