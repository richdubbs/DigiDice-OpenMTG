/**
 * edh-next-90 (top-rank-6, code edhn90): the folds of its templates (parser/templates/zz-cloud/edh-next-90.json), called from render/fold.ts#foldAt.
 *
 * `searchMayPutInsteadOfHand` (CR 701.23a, 608.2c, 614.15; Caravan Vigil): "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.
 * Morbid -- You may put that card onto the battlefield instead of putting it into your hand if a creature died this turn." The parser's rider
 * rid.edhn90.instead.mayPutThatCardBattlefield.if puts "you may put the found card onto the battlefield under your control" (guarded by C, recording whether it was done) right before the move of the
 * card to the hand, which then runs only if that was not done (parser/lower/riders.ts, `@before` with `@alsoStep` and `@guardPrevious`): the engine follows a card that moved, so without
 * the guard the card would be moved again. Only that exact shape: a search of your library for ONE card that it reveals, the optional move, the guarded move to your hand, your shuffle.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function searchMayPutInsteadOfHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s, may, hand, sh] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (s?.op !== 'search' || s.as === undefined || s.reveal !== true || s.max !== 1 || s.zone !== 'library' || s.guard !== undefined || s.who.ref !== 'you') return null;
  if (may?.op !== 'may' || may.guard === undefined || may.as === undefined || may.who.ref !== 'you' || may.do.length !== 1 || may.otherwise !== undefined || may.anyOne !== undefined || may.villainous !== undefined || may.gather !== undefined) return null;
  const bf = may.do[0]!;
  const found = JSON.stringify({ ref: 'bound', name: s.as });
  if (bf.op !== 'move' || JSON.stringify(bf.what) !== found || bf.as !== undefined || bf.guard !== undefined || bf.until !== undefined || bf.link !== undefined || bf.remember !== undefined) return null;
  if (JSON.stringify(bf.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (hand?.op !== 'move' || JSON.stringify(hand.what) !== found || hand.as !== undefined || JSON.stringify(hand.guard) !== JSON.stringify({ cond: 'did', step: may.as, not: true }) || hand.until !== undefined || JSON.stringify(hand.to) !== JSON.stringify({ zone: 'hand' })) return null;
  if (sh?.op !== 'shuffle' || sh.guard !== undefined || JSON.stringify(sh.who) !== JSON.stringify({ ref: 'you' })) return null;
  if (JSON.stringify(list.slice(i + 4)).includes(found)) return null;
  const head = K.steps([s, { ...hand, guard: undefined }, sh], st);
  const cond = K.cond(may.guard, st);
  return { clauses: [plain(`${head}. you may put that card onto the battlefield instead of putting it into your hand if ${cond}`, { standalone: true })], consumed: 4 };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
type StaticEffect = Record<string, any>; // a static effect of the lasting effect, read by shape only

/**
 * `preventAllByChosenColorSources` (CR 615.1, 615.6, 608.2d, 105.1, 609.7a, 611.2a; Prismatic Strands, eff.edhn90.prevent.byChosenColorSources): "Prevent all damage that sources of the color
 * of your choice would deal this turn.": the choice of a color as the effect resolves (edh-d-17's link, Avacyn's "to <recipient>" is its sibling) and the lasting effect that prevents all
 * damage dealt by sources of that color, to anything. Only that exact shape: no recipient, no combat restriction.
 */
function preventAllByChosenColorSources(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseValue' || b?.op !== 'effect') return null;
  if (a.guard !== undefined || a.what !== 'color' || a.options !== undefined || !same(a.who, { ref: 'you' }) || a.link !== 'preventColor' || a.as !== 'preventColor') return null;
  if (b.guard !== undefined || b.as !== undefined || b.effects.length !== 1 || Object.keys(b).some((k) => !['op', 'duration', 'effects'].includes(k))) return null;
  const e = b.effects[0] as unknown as StaticEffect;
  if (e.s !== 'replace' || !same(e.body, { b: 'prevent', amount: 'all' }) || Object.keys(e).some((k) => !['s', 'replaces', 'body'].includes(k))) return null;
  const r = e.replaces as StaticEffect;
  if (r.ev !== 'damage' || Object.keys(r).length !== 2 || !same(r.source, { chosen: { link: 'preventColor', quality: 'color' } })) return null;
  const dur = K.dur(b.duration, st);
  if (!dur) return null;
  return { clauses: [plain(`prevent all damage that sources of the color of your choice would deal ${dur}`, { standalone: true })], consumed: 2 };
}

/**
 * `loyaltyTwiceThisTurn` (CR 606.3, 602.5b, 611.2a; Urza Assembles the Titans, eff.edhn90.loyalty.twiceThisTurn): "You may activate the loyalty abilities of planeswalkers you control twice this
 * turn rather than only once.": the lasting rule of edh-players-6's static (Oath of Teferi, "twice each turn") for the rest of the turn. Only that exact shape.
 */
function loyaltyTwiceThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const b = list[i];
  if (b?.op !== 'effect' || b.guard !== undefined || b.as !== undefined || b.effects.length !== 1 || Object.keys(b).some((k) => !['op', 'duration', 'effects'].includes(k))) return null;
  if (!same(b.duration, { d: 'endOfTurn' })) return null;
  const e = b.effects[0] as unknown as StaticEffect;
  if (e.s !== 'rule' || e.rule !== 'additionalActivation' || e.keyword !== 'loyalty:twice' || e.of === undefined || e.of.is !== undefined || Object.keys(e).some((k) => !['s', 'rule', 'keyword', 'of'].includes(k))) return null;
  return { clauses: [plain(`you may activate the loyalty abilities of ${K.np(e.of, st, { det: 'none', plural: true })} twice this turn rather than only once`, { standalone: true })], consumed: 1 };
}

export function foldEdhN90(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchMayPutInsteadOfHand(list, i, st) ?? preventAllByChosenColorSources(list, i, st) ?? loyaltyTwiceThisTurn(list, i, st);
}
