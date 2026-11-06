/**
 * edh-d-9 (Commander coordinator D, EDHREC ranks 13,751-15,000, third pass): the folds of its templates (parser/templates/zz-cloud/edh-d-9.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { groupPool, restOfGroup } from './refs';
import { cloneState, type RenderState } from './state';
import { alt } from './text';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Nothing after the fold's steps reads the choice named `name`, except the move of "the rest" of it. */
const unreadExceptRest = (list: EffectStep[], from: number, name: string): boolean =>
  !list.slice(from).some((x) => JSON.stringify(x).includes(`"name":"${name}"`) && !(x.op === 'move' && x.what.ref === 'each' && restOfGroup(x.what.filter)?.chosen === name));

/**
 * `putAnyFromGroup` (CR 701.20a, 608.2c-d, 404.1; Glacial Revelation, eff.edhd9.dig.putAny.hand): "You may put any number of snow permanent cards from among them into your
 * hand." (optional, none included), the rest of the group in a sentence of its own. Only the move into your hand, with nothing after it reading the choice but "the rest"
 * of the group: the older template that says the rest in the same sentence ("... into your hand and the rest into your graveyard", Dihada, Binder of Wills) names its
 * move of the rest, which the older fold (render/fold.ts#putAnyFromGroupAndRest) writes.
 */
function putAnyFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m, rest] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || m?.op !== 'move' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any') return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'hand' })) return null;
  if (rest?.op === 'move' && rest.as !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || !unreadExceptRest(list, i + 2, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  const text = `you may put any number of ${np} from among ${them.text} into your hand`;
  bind(st, a.as, { nouns: K.nounsOf(pool.desc), plural: true });
  return { clauses: [acting('you', text.replace(/^you /, ''), text, { closesScope: true })], consumed: 2 };
}

/**
 * `revealOneOfTwoDescs` (CR 701.20a, 701.20e, 608.2c-d; Garruk's Harbinger): "You may reveal a creature card or Garruk planeswalker card from among them and put it into
 * your hand.": your choice of at most one card of either of two descriptions among a group looked at, its reveal and its move into your hand. The two descriptions are
 * said apart, "a creature card or Garruk planeswalker card" (each with its own "card", the second with or without its article), besides the joined "a creature or Garruk
 * planeswalker card" the generic fold writes. Only that exact shape, with nothing after it reading the choice but "the rest" of the group.
 */
function revealOneOfTwoDescs(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, r, m] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || r?.op !== 'reveal' || m?.op !== 'move' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 1) return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' }) || !same(r.what, { ref: 'bound', name: a.as }) || (r.to !== undefined && r.to !== 'all')) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'hand' })) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || !unreadExceptRest(list, i + 3, a.as)) return null;
  const parts = pool.desc.anyOf;
  if (parts?.length !== 2 || Object.keys(pool.desc).some((k) => k !== 'anyOf' && (pool.desc as Record<string, unknown>)[k] !== undefined)) return null;
  // only plain types and subtypes: a limit (mana value, power, counters) is written with one article by older readings (trek-9), never by this fold
  if (parts.some((p) => Object.keys(p).some((k) => (p as Record<string, unknown>)[k] !== undefined && k !== 'types' && k !== 'subtypes'))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const [first, second] = [parts[0]!, parts[1]!];
  const one = K.np({ ...first, zone: 'library' }, cloneState(st), { det: 'a', noZone: true });
  const two = K.np({ ...second, zone: 'library' }, cloneState(st), { det: 'a', noZone: true });
  const twoBare = K.np({ ...second, zone: 'library' }, cloneState(st), { det: 'none', noZone: true });
  const joined = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may reveal ${alt(joined, `${one} or ${two}`, `${one} or ${twoBare}`)} from among ${them.text} and put ${alt('it', 'that card')} into your hand`;
  bind(st, a.as, { nouns: ['card'], plural: false });
  return { clauses: [acting('you', text.replace(/^you /, ''), text, { closesScope: true })], consumed: 3 };
}

/**
 * `returnCardPerDiscarded` (CR 404.1, 701.9a, 608.2c-d; Recall, eff.edhd9.return.cardPer.graveyardToHand): "Discard X cards, then return a card from your graveyard to your
 * hand for each card discarded this way.": you choose exactly as many cards of your graveyard (of one description, or any) as the cards the discard of the same ability
 * moved, and put exactly those into your hand. Only that shape, with nothing after it reading the choice.
 */
function returnCardPerDiscarded(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || m?.op !== 'move' || a.as === undefined || !same(a.who, { ref: 'you' }) || typeof a.min !== 'object' || !same(a.min, a.max)) return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'hand' })) return null;
  const c = a.min;
  if (c.q !== 'resultCount' || c.which?.isCard !== true || st.info.get(`r:${c.step}`)?.thisWay !== 'discarded this way' || a.from.ref !== 'each') return null;
  const { anyOf, zone, owner, isCard, ...others } = a.from.filter;
  if (zone !== 'graveyard' || owner !== 'you' || isCard !== true || Object.values(others).some((v) => v !== undefined) || (anyOf !== undefined && anyOf.length !== 1)) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const np = anyOf === undefined ? 'a card' : K.np({ ...anyOf[0]!, zone: 'graveyard' }, cloneState(st), { det: 'a', noZone: true });
  const text = `return ${np} from your graveyard to your hand for each card discarded this way`;
  bind(st, a.as, { nouns: ['card'], plural: true });
  return { clauses: [acting('you', text.replace(/^you /, ''), text, { closesScope: true })], consumed: 2 };
}

export function foldEdhD9(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putAnyFromGroup(list, i, st) ?? revealOneOfTwoDescs(list, i, st) ?? returnCardPerDiscarded(list, i, st);
}
