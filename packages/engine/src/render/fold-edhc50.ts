/**
 * Commander lane edh-c, round edh-c-50: the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhC50` after the other slices' own folds). A fold applies
 * only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { countParts } from './qty';
import type { RenderState } from './state';
import { alt } from './text';

/**
 * "For each artifact or creature card in target opponent's graveyard, add {C} and you gain 1 life." (Spoils of Evil; CR 106.1, 119.1, 608.2c): colorless mana and life, each one per
 * object of the same count, the count said once as "for each". Exactly the two steps the template eff.edhv50.forEach.addC.gainLife builds.
 */
function forEachAddColorlessGainLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'addMana' || b?.op !== 'gainLife' || a.dynamic === undefined || a.dynamic.kind !== 'ofType' || a.dynamic.type !== 'C' || a.units !== undefined) return null;
  if (JSON.stringify(a.who) !== '{"ref":"you"}' || JSON.stringify(b.who) !== '{"ref":"you"}' || typeof b.amount !== 'object' || JSON.stringify(b.amount) !== JSON.stringify(a.dynamic.count)) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'dynamic'].includes(k)) || Object.keys(a.dynamic).some((k) => !['kind', 'type', 'count'].includes(k)) || Object.keys(b).some((k) => !['op', 'who', 'amount'].includes(k))) return null;
  const per = countParts(b.amount, st);
  if (per === null) return null;
  return { clauses: [plain(`for each ${per.singular}, add {C} and you gain 1 life`, { standalone: true })], consumed: 2 };
}

/**
 * "Choose a card at random that was exiled with ~. Put that card into its owner's hand." (Skyship Weatherlight; CR 607.2a, 608.2d, 400.3): one card chosen at random, by no player,
 * among those a linked ability exiled, then moved to its owner's hand. Exactly the chooseObjects step of the template eff.edhv50.linked.chooseRandom and the move of the card it chose
 * (the template eff.move.hand's step), nothing reading the choice after it.
 */
function chooseRandomLinkedToOwnersHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (a.from.ref !== 'linked' || a.from.link !== 'exiled') return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.what.ref !== 'bound' || m.what.name !== a.as) return null;
  if (JSON.stringify(m.to) !== '{"zone":"hand"}' || list.slice(i + 2).some((x) => JSON.stringify(x).includes(JSON.stringify(a.as)))) return null;
  const me = K.obj({ ref: 'self' }, st, 'object').text;
  // edh-d-2 (CR 607.2a, 608.2d; Gorex, the Tombshell; family choose-random-exiled-with-and-put): or one sentence, "choose a card at random exiled with ~ and put that card into its owner's hand"
  return { clauses: [plain(alt(`choose a card at random that was exiled with ${me}. put that card into its owner's hand`, `choose a card at random exiled with ${me} and put that card into its owner's hand`), { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-50 (render/fold.ts#foldAt). */
export function foldEdhC50(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return forEachAddColorlessGainLife(list, i, st) ?? chooseRandomLinkedToOwnersHand(list, i, st);
}
