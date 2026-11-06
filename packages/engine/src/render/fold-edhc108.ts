/**
 * edh-c-108 (Commander effort, coordinator C): the folds of its templates (parser/templates/zz-cloud/edh-c-108.json), called from render/fold.ts#foldAtPlain. Each applies only
 * when every part is exactly what the idiom says.
 *
 * `chooseFromGraveyardOrHandExile` (CR 701.13a, 608.2d, 406.3, 400.3; Memory Leak, eff.edhv108.youChoose.fromGraveyardOrHand.exile): "You choose a nonland card from that player's
 * graveyard or hand and exile it.": you choose exactly one card of a description among the cards in one player's graveyard and hand, then exile the card chosen. Only that shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { bind } from './steps-util';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function chooseFromGraveyardOrHandExile(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'exile' })) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || !same(a.from.filter.zone, ['graveyard', 'hand']) || a.from.filter.owner === undefined) return null;
  const { zone: _zone, owner, ...desc } = a.from.filter;
  if (Object.keys(desc).length === 0 || a.from.filter.owner === undefined) return null;
  const what = K.np({ ...desc, zone: 'hand', owner }, st, { det: 'a' });
  if (!/hand$/.test(what)) return null;
  bind(st, a.as, { nouns: ['card'], plural: false });
  return { clauses: [plain(`you choose ${what.replace(/hand$/, 'graveyard or hand')} and exile it`)], consumed: 2 };
}

/**
 * `exileOtherRevealedLoseLife` (CR 701.20a, 701.13a, 406.1, 119.3, 608.2c; Spoils of the Vault, eff.edhv108.exile.otherRevealed.loseLifeEach): "Exile all other cards revealed this way, and you lose 1 life
 * for each of the exiled cards.": the cards a reveal-until revealed other than the one it found (still in the library) go to exile together, then you lose 1 life for each of them. Only that shape.
 */
function exileOtherRevealedLoseLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'move' || b?.op !== 'loseLife' || a.guard !== undefined || b.guard !== undefined || a.as === undefined || a.until !== undefined) return null;
  if (!same(a.what, { ref: 'each', filter: { is: { ref: 'bound', name: 'revealed' }, not: { is: { ref: 'bound', name: 'hit' } }, zone: 'library' } }) || !same(a.to, { zone: 'exile' })) return null;
  if (!same(b.who, { ref: 'you' }) || !same(b.amount, { q: 'count', of: { ref: 'bound', name: a.as } })) return null;
  return { clauses: [plain('exile all other cards revealed this way, and you lose 1 life for each of the exiled cards', { standalone: true })], consumed: 2 };
}

export function foldEdhC108(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseFromGraveyardOrHandExile(list, i, st) ?? exileOtherRevealedLoseLife(list, i, st);
}
