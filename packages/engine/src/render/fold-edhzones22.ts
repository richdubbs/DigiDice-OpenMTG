/**
 * edh-zones-22 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-22.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `mayPutHandCardAttacking` (CR 701.20e, 608.2d, 110.2a, 508.4, 702.116a; Zara, Renegade Recruiter): "You may put a creature card from it onto the battlefield under your control
 * tapped and attacking that player or a planeswalker they control.": your optional choice of one card of the hand an earlier sentence looked at, and its move onto the battlefield under
 * your control, tapped and attacking the player or a planeswalker that player controls. Exactly the two steps of template eff.edhz22.mayPut.handCard.bf.attackingWhom.
 *
 * `putAllRevealedUntilThenRest` (CR 701.20a, 608.2c, 401.4, 404.1; Old Stickfingers): "Put all creature cards revealed this way into your graveyard, then put the rest on the bottom of
 * your library in a random order." after "reveal cards ... until you reveal X creature cards": the cards that reveal stopped at (the group `revealed this way`) into your graveyard,
 * then the rest of the cards it revealed on the bottom of your library in a random order. Exactly the two steps of template eff.edhz22.putAll.revealedUntil.graveyard.restBottomRandom.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { restOfGroup } from './refs';
import { bind, handChoiceFromIt } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function mayPutHandCardAttacking(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || typeof a.as !== 'string' || b.as !== undefined || b.until !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 1 || a.random === true || !same(b.what, { ref: 'bound', name: a.as }) || b.link !== undefined || b.remember !== undefined) return null;
  const to = b.to;
  if (to.zone !== 'battlefield' || !same(to.controller, { ref: 'you' }) || to.tapped !== true || Object.keys(to).length !== 4 || typeof to.attacking !== 'object' || !('defender' in to.attacking) || to.attacking.orPlaneswalkers !== true
    || Object.keys(to.attacking).length !== 2) return null;
  const inHand = handChoiceFromIt(a, st);
  if (inHand === null) return null;
  const whom = K.player(to.attacking.defender, st, 'object').text;
  const desc = (a.from as { filter: { anyOf?: Parameters<typeof K.nounsOf>[0][] } }).filter.anyOf?.[0];
  // the card put onto the battlefield is a permanent there, named by its noun later ("Return that creature to its owner's hand", CR 400.7j)
  bind(st, a.as, { nouns: [...new Set([...(desc === undefined ? [] : K.nounsOf(desc)), 'permanent'])], plural: false, optional: true });
  const text = `you may put ${inHand} onto the battlefield under your control tapped and attacking ${whom} or a planeswalker they control`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

function putAllRevealedUntilThenRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'move' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.until !== undefined || b.until !== undefined) return null;
  if (a.link !== undefined || b.link !== undefined || a.remember !== undefined || b.remember !== undefined) return null;
  if (a.what.ref !== 'each' || b.what.ref !== 'each' || !('filter' in a.what) || !('filter' in b.what)) return null;
  const fa = a.what.filter;
  const keys = Object.keys(fa).filter((k) => (fa as Record<string, unknown>)[k] !== undefined).sort().join(',');
  if (keys !== 'anyOf,is,zone' || fa.zone !== 'library' || fa.anyOf?.length !== 1 || fa.is?.ref !== 'bound' || st.info.get(`b:${fa.is.name}`)?.thisWay !== 'revealed this way') return null;
  const rest = restOfGroup(b.what.filter);
  if (rest === null || rest.chosen !== fa.is.name || !same(a.to, { zone: 'graveyard' }) || !same(b.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  const cards = K.np({ ...fa.anyOf[0]!, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  // (all of the cards the reveal stopped at, not a part of them: a narrower description would leave the others out of both moves)
  if (st.info.get(`b:${fa.is.name}`)?.hitsAre !== cards) return null;
  return { clauses: [acting('you', `put all ${cards} revealed this way into your graveyard, then put the rest on the bottom of your library in a random order`, `you put all ${cards} revealed this way into your graveyard, then put the rest on the bottom of your library in a random order`, { standalone: true })], consumed: 2 };
}

export function foldEdhZones22(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return mayPutHandCardAttacking(list, i, st) ?? putAllRevealedUntilThenRest(list, i, st);
}
