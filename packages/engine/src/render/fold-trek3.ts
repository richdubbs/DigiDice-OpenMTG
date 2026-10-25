/**
 * trek-3: the folds of its templates (parser/templates/zz-cloud/trek-3.json), called from render/fold.ts#foldAt.
 *
 * `ownerExilesChosenThenDraws`: "Look at target opponent's hand. You may choose a nonland card from it. If you do, that player exiles that card, then draws a card."
 * (Salt Vampire; CR 406.1, 121.1, 608.2c): the card you chose from a player's hand (RefInfo.handOwner, steps-flow.ts#chooseObjects) is exiled, then that same player
 * draws. Oracle says the exile with the hand's owner as its subject, so the two instructions are one predicate of that player. A card in a hand is exiled the same
 * whoever exiles it (family owner-exiles-chosen-card), so the move needs no performer; the wording of before ("exile that card. that player draws a card") stays a
 * reading. Only a plain move of that card into exile right before a draw by the player whose hand it was.
 */
import type { EffectStep } from '../types/ability';
import { acting, fragment, within } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, playerKey, withVariants, type RenderState } from './state';
import { alt } from './text';

function ownerExilesChosenThenDraws(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const d = list[i + 1];
  if (m?.op !== 'move' || d?.op !== 'draw' || m.what.ref !== 'bound' || m.guard !== undefined || d.guard !== undefined) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.as !== undefined || d.as !== undefined || JSON.stringify(m.to) !== '{"zone":"exile"}') return null;
  const owner = st.info.get(`b:${m.what.name}`)?.handOwner;
  if (owner === undefined || owner !== JSON.stringify(d.who) || playerKey(d.who) === 'you') return null;
  if (K.clause(d, cloneState(st)).pred === undefined) return null;
  const [folded, apart] = withVariants<{ imp: string; sub: string }>(st, [
    (v) => {
      const pred = K.clause(d, v).pred!;
      const who = K.player(d.who, cloneState(v), 'subject').text;
      const text = `${who} exiles ${K.obj(m.what, v, 'object').text}, then ${pred}`;
      return { imp: text, sub: text };
    },
    // the two instructions written apart, as without this fold
    (v) => {
      const cm = K.clause(m, v);
      const cd = K.clause(d, v);
      const sep = alt('. ', ' and ', ', then ', ', ', '. then ');
      return { imp: `${within(cm, 'you')}${sep}${within(cd, 'you')}`, sub: `${fragment(cm)}${sep}${fragment(cd)}` };
    },
  ]);
  return { clauses: [acting('you', alt(folded!.imp, apart!.imp), alt(folded!.sub, apart!.sub))], consumed: 2 };
}

export function foldTrek3(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return ownerExilesChosenThenDraws(list, i, st);
}
