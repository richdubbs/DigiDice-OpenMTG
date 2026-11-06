/**
 * edh-c-104: the folds of its templates (parser/templates/zz-cloud/edh-c-104.json), called from render/fold.ts#foldAt.
 *
 * `ownerExilesChosen`: "Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player exiles that card." (Specter's Shriek; CR 406.1, 608.2c):
 * the card you chose out of a player's hand (RefInfo.handOwner, steps-flow.ts#chooseObjects) is exiled; Oracle says that with the hand's owner as the subject. A card in a hand is
 * exiled the same whoever exiles it (family owner-exiles-chosen-card), so the move keeps its own meaning and only its wording gains the owner. Only a plain move of that card into
 * exile, the owner a target player.
 */
import type { EffectStep } from '../types/ability';
import { acting, fragment, within } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, withVariants, type RenderState } from './state';
import { alt } from './text';

function ownerExilesChosen(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.what.ref !== 'bound' || m.guard !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (JSON.stringify(m.to) !== '{"zone":"exile"}') return null;
  const owner = st.info.get(`b:${m.what.name}`)?.handOwner;
  if (owner === undefined || !/^\{"ref":"target","id":"t\d+"\}$/.test(owner)) return null;
  const ownerRef = JSON.parse(owner) as { ref: 'target'; id: string };
  const [folded, apart] = withVariants<{ imp: string; sub: string }>(st, [
    (v) => {
      const cm = K.clause(m, v); // (binds what the move bound, as the plain reading does)
      const who = K.player(ownerRef as never, cloneState(v), 'subject').text;
      const what = K.obj(m.what, cloneState(v), 'object').text;
      void cm;
      const text = `${who} exiles ${what}`;
      return { imp: text, sub: text };
    },
    (v) => {
      const cm = K.clause(m, v);
      return { imp: within(cm, 'you'), sub: fragment(cm) };
    },
  ]);
  return { clauses: [acting('you', alt(folded!.imp, apart!.imp), alt(folded!.sub, apart!.sub))], consumed: 1 };
}

export function foldEdhC104(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return ownerExilesChosen(list, i, st);
}
