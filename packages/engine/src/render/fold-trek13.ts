/**
 * trek-13: the fold of its templates eff.trek13.they.revealUntil, eff.trek13.assimilate.oneOfRevealed and eff.trek13.then.eachOpponent.putOtherBottomRandom
 * (parser/templates/zz-cloud/trek-13.json), called from render/fold.ts#foldAt. The Star Trek mechanic assimilate has no Comprehensive Rules text yet: its reminder text is the rule source.
 *
 * `giftOfPerfection` (CR 701.20a-b, 401.4, 608.2c, 101.4): "Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature
 * cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order." (Gift of Perfection): each opponent's reveal
 * until one card of a description, your choice of one of the cards they stopped at, its assimilation, and the move of every other card revealed to the bottom of its owner's library in a
 * random order. Only that exact body, with nothing reading the names afterwards.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const isBound = (ref: ObjRef | undefined, name: string | undefined): boolean => name !== undefined && ref?.ref === 'bound' && ref.name === name;
const unread = (list: EffectStep[], from: number, ...names: (string | undefined)[]): boolean =>
  !list.slice(from).some((x) => names.some((n) => n !== undefined && JSON.stringify(x).includes(`"name":"${n}"`)));

function giftOfPerfection(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  const c = list[i + 1];
  const a = list[i + 2];
  const m = list[i + 3];
  if (r?.op !== 'revealUntil' || c?.op !== 'chooseObjects' || a?.op !== 'action' || m?.op !== 'move') return null;
  if (r.guard !== undefined || r.who.ref !== 'each' || r.who.who !== 'opponent' || r.as === undefined || r.revealed === undefined || r.count !== undefined) return null;
  if (c.guard !== undefined || c.who.ref !== 'you' || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.link !== undefined) return null;
  if (c.from.ref !== 'each' || Object.keys(c.from.filter).sort().join() !== 'anyOf,is,zone' || c.from.filter.zone !== 'library' || !isBound(c.from.filter.is, r.as) || c.from.filter.anyOf?.length !== 1) return null;
  if (a.guard !== undefined || a.action !== 'assimilate' || a.who.ref !== 'you' || a.n !== undefined || a.arg !== undefined || a.choices !== undefined || !isBound(a.subject as ObjRef, c.as)) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.what.ref !== 'each') return null;
  if (JSON.stringify(m.what.filter) !== JSON.stringify({ is: { ref: 'bound', name: r.revealed }, not: { is: { ref: 'bound', name: c.as } }, zone: 'library' })) return null;
  if (JSON.stringify(m.to) !== '{"zone":"library","position":"bottom","order":"random"}' || !unread(list, i + 4, r.as, r.revealed, c.as)) return null;
  const kind = c.from.filter.anyOf[0]!;
  const cards = K.np({ ...kind, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  // (the reveal of several players is said only here, with its three sentences: "that card" of a lone reveal-until of each opponent would name one card for each of them)
  const until = K.np({ ...r.filter, zone: 'library' }, st, { det: 'a', noZone: true });
  return {
    clauses: [
      plain(`each opponent reveals cards from the top of their library until they reveal ${until}`),
      plain(`assimilate one of the ${cards} revealed this way`),
      acting('you', 'each opponent puts the other cards they revealed this way on the bottom of their library in a random order', 'each opponent puts the other cards they revealed this way on the bottom of their library in a random order', { leadThen: true }),
    ],
    consumed: 4,
  };
}

export function foldTrek13(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return giftOfPerfection(list, i, st);
}
