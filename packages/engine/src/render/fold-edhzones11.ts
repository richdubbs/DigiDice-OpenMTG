/**
 * edh-zones-11 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-11.json), called from render/fold.ts#foldAt. Each applies only
 * when every part is exactly what the idiom says.
 *
 * `revealAnyNumberFromGroup` (CR 701.20a, 701.20e, 608.2c-d; Karumonix, the Rat King): "You may reveal any number of Rat cards from among them and put the revealed cards into
 * your hand.": your choice of any number (including none) of the cards of one description among a group looked at, the reveal of exactly those cards, and the move of exactly
 * those cards into your hand. Only that exact shape, with nothing after it reading the choice but "the rest" of the group.
 *
 * `exileTopThenPutOneControl` (CR 406.1, 701.13a, 608.2c-d, 110.2a; Lord of the Void): "Exile the top seven cards of that player's library, then put a creature card from among
 * them onto the battlefield under your control.": the move of the top cards of one library into exile (the cards it exiled are the group `them`), your choice of exactly one
 * card of a description among them, and its move onto the battlefield under your control. Only that exact shape, with nothing after it reading either name.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { groupPool, restOfGroup } from './refs';
import { alt } from './text';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Nothing after the fold's steps reads the choice named `name`, except the move of "the rest" of it. */
const unreadExceptRest = (list: EffectStep[], from: number, name: string): boolean =>
  !list.slice(from).some((x) => JSON.stringify(x).includes(`"name":"${name}"`) && !(x.op === 'move' && x.what.ref === 'each' && restOfGroup(x.what.filter)?.chosen === name));

function revealAnyNumberFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, r, m] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || r?.op !== 'reveal' || m?.op !== 'move' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any') return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' }) || !same(r.what, { ref: 'bound', name: a.as }) || (r.to !== undefined && r.to !== 'all')) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'hand' })) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || !unreadExceptRest(list, i + 3, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  const text = `you may reveal any number of ${np} from among ${them.text} and put ${alt('the revealed cards', 'them')} into your hand`; // edh-c-15 (family put-them-after-reveal; You Meet in a Tavern): the cards just revealed are also "them"
  bind(st, a.as, { nouns: K.nounsOf(pool.desc), plural: true });
  return { clauses: [acting('you', text.replace(/^you /, ''), text, { closesScope: true })], consumed: 3 };
}

function exileTopThenPutOneControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m, c, p] = [list[i], list[i + 1], list[i + 2]];
  if (m?.op !== 'move' || c?.op !== 'chooseObjects' || p?.op !== 'move' || m.as === undefined || c.as === undefined) return null;
  if (m.guard !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.what.ref !== 'topCards' || !same(m.to, { zone: 'exile' })) return null;
  if (c.guard !== undefined || c.random === true || c.distinct !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || !same(c.who, { ref: 'you' }) || c.min !== 1 || c.max !== 1) return null;
  if (p.guard !== undefined || p.as !== undefined || p.until !== undefined || p.link !== undefined || p.remember !== undefined || !same(p.what, { ref: 'bound', name: c.as })
    || !same(p.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (c.from.ref !== 'each') return null;
  const { anyOf, is, zone, ...others } = c.from.filter;
  if (anyOf?.length !== 1 || zone !== 'exile' || !same(is, { ref: 'bound', name: m.as }) || Object.values(others).some((v) => v !== undefined)) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${m.as}"`) || JSON.stringify(x).includes(`"name":"${c.as}"`))) return null;
  const exile = K.clause(m, st).imp;
  const np = K.np({ ...anyOf[0]!, zone: 'exile' }, st, { det: 'a', noZone: true });
  const text = `${exile}, then put ${np} from among them onto the battlefield under your control`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

export function foldEdhZones11(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealAnyNumberFromGroup(list, i, st) ?? exileTopThenPutOneControl(list, i, st);
}
