/**
 * edh-d-35 (Commander coordinator D, lane dig, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-35.json), called from render/fold.ts#foldAt. Each applies
 * only when every part is exactly what the idiom says, with no guard, name, duration or link on any step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { acting } from './clause';
import { K } from './kernel';
import { movedInfo } from './moved';
import { AMBIGUOUS, groupPool, restOfGroup } from './refs';
import { cloneState } from './state';
import { alt } from './text';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const plainMove = (s: EffectStep | undefined): s is Extract<EffectStep, { op: 'move' }> =>
  s?.op === 'move' && s.guard === undefined && s.as === undefined && s.until === undefined && s.link === undefined && s.remember === undefined;

/**
 * `putAllRevealedThenShuffleRest` (CR 701.20a, 701.24a, 608.2c; Mass Polymorph, eff.edhd35.putAll.revealed.bf.thenShuffleRest): "Put all creature cards revealed this way onto the
 * battlefield, then shuffle the rest of the revealed cards into your library.": the revealed cards of the description go onto the battlefield under your control, the other revealed
 * cards still in the library stay there, and you shuffle. Only that exact shape.
 */
function putAllRevealedThenShuffleRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (!plainMove(a) || !plainMove(b) || c?.op !== 'shuffle' || c.guard !== undefined || c.as !== undefined || c.ifSearched !== undefined || !same(c.who, { ref: 'you' })) return null;
  if (a.what.ref !== 'each' || b.what.ref !== 'each') return null;
  if (!same(a.to, { zone: 'battlefield', controller: { ref: 'you' } }) || !same(b.to, { zone: 'library' })) return null;
  const fa = a.what.filter;
  const fb = b.what.filter;
  if (fa.is?.ref !== 'bound' || fb.is?.ref !== 'bound' || fa.is.name !== fb.is.name || !same({ ...fb, is: undefined }, { zone: 'library', is: undefined })) return null;
  if (st.info.get(`b:${fa.is.name}`)?.thisWay !== 'revealed this way') return null;
  const them = K.obj(a.what, st, 'object');
  if (!them.plural) return null;
  return { clauses: [plain(`put ${them.text} onto the battlefield, then shuffle the rest of the revealed cards into your library`, { standalone: true })], consumed: 3 };
}

/**
 * `iterationControllerRevealsAndPuts` (CR 608.2c, 608.2f, 701.20a, 701.24a, 110.2a, 400.3; Divergent Transformations, Chaos Mutation, Chaotic Transformation,
 * eff.edhd35.forEach.controllerRevealsUntil.*): inside "For each <permanent exiled this way>, ...", "its controller reveals cards from the top of their library until they reveal
 * <a card>, puts that card onto the battlefield, then shuffles the rest into their library" (or "..., then puts the rest on the bottom of their library in a random order"):
 * the controller of the permanent the loop is on reveals from their own library, puts the card it stopped at onto the battlefield (the library is its owner's: the player who
 * revealed is the one who puts it) and the other revealed cards go back (shuffled, or to the bottom in a random order). Only those steps, in that order, right after the reveal.
 */
function iterationControllerRevealsAndPuts(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [rv, a, b, c] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (rv?.op !== 'revealUntil' || rv.guard !== undefined || rv.who.ref !== 'controllerOf' || rv.who.object.ref !== 'bound' || rv.count !== undefined) return null;
  if (!plainMove(a) || !plainMove(b) || a.what.ref !== 'bound' || b.what.ref !== 'each' || a.what.name !== rv.as) return null;
  if (!same(a.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const rest = restOfGroup(b.what.filter);
  if (rest === null || rest.chosen !== a.what.name || rest.group !== rv.revealed) return null;
  const shuffled = same(b.to, { zone: 'library' });
  if (shuffled ? (c?.op !== 'shuffle' || c.guard !== undefined || c.as !== undefined || c.ifSearched !== undefined || !same(c.who, rv.who)) : !same(b.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  const probe = cloneState(st);
  K.clause(rv, probe);
  if (K.obj(a.what, probe, 'object').text.includes(AMBIGUOUS)) return null;
  const first = K.clause(rv, st);
  const that = K.obj(a.what, st, 'object');
  const restText = K.obj(b.what, st, 'object').text;
  const tail = shuffled ? `then shuffles ${restText} into their library` : `then puts ${restText} on the bottom of their library in a random order`;
  const text = `${first.sub}, puts ${that.text} onto the battlefield, ${tail}`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: shuffled ? 4 : 3 };
}

/**
 * `putAnyNumberHandRestGraveyard` (CR 701.20e, 608.2c-d, 404.1; Search for Blex, eff.edhd35.dig.putAnyNumber.hand.restGraveyard): after a look at the top cards of your library, "put any
 * number of them into your hand and the rest into your graveyard.": your choice of any number (none included) of the group, their move into your hand (named, for "You lose 3
 * life for each card you put into your hand this way") and the move of every other card of the group into your graveyard (a card goes to its owner's graveyard, CR 404.1).
 */
function putAnyNumberHandRestGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m, r] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any') return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.as === undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'hand' })) return null;
  if (!plainMove(r) || r.as !== undefined || r.what.ref !== 'each' || !same(r.to, { zone: 'graveyard' })) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null) return null;
  const rest = restOfGroup(r.what.filter);
  if (rest === null || rest.chosen !== a.as || pool.group.ref !== 'bound' || rest.group !== pool.group.name) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const text = `you may put any number of ${them.text} into your hand and the rest into your graveyard`;
  st.info.set(`r:${m.as}`, movedInfo('hand', ['card']));
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 3 };
}

/**
 * `revealUntilMayCastRestBottom` (CR 701.20a-b, 601.2a, 401.4, 608.2c; parser/lower/mentions.ts#revealedNotCastOf; Treasure Keeper, Neera, Plargg): "Reveal cards from the top of your
 * library until you reveal a nonland card with mana value 3 or less. You may cast that card without paying its mana cost. Put all revealed cards not cast this way on the bottom
 * of your library in a random order.": your reveal until one card of a description, your option to cast that card, and the move of every revealed card still in the library (the
 * card it stopped at included, when it was not cast) to the bottom in a random order. Only that exact body, with nothing after it reading the reveal.
 */
function revealUntilMayCastRestBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, m, b] = [list[i], list[i + 1], list[i + 2]];
  if (r?.op !== 'revealUntil' || m?.op !== 'cast' || b?.op !== 'move' || r.guard !== undefined || r.who.ref !== 'you' || r.revealed === undefined || r.count !== undefined || r.as === undefined) return null;
  if (m.guard !== undefined || m.free !== true || m.optional !== true || !same(m.who, { ref: 'you' }) || !same(m.what, { ref: 'bound', name: r.as }) || !plainMove(b)) return null;
  if (Object.keys(m).some((k) => !['op', 'who', 'what', 'free', 'optional'].includes(k) && (m as unknown as Record<string, unknown>)[k] !== undefined)) return null;
  if (b.what.ref !== 'each' || !same(b.what.filter, { is: { ref: 'bound', name: r.revealed }, zone: 'library' }) || !same(b.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${r.as}"`) || JSON.stringify(x).includes(`"name":"${r.revealed}"`))) return null;
  const first = K.clause(r, st);
  const second = K.clause(m, st);
  const rest = 'put all revealed cards not cast this way on the bottom of your library in a random order';
  return { clauses: [first, second, acting('you', rest, `you ${rest}`, { leadThen: true })], consumed: 3 };
}

/**
 * `tapAnyNumber` (CR 701.26a, 608.2c-d; Augusta, Dean of Order, eff.edhd35.tap.anyNumber): "tap any number of creatures you control.": your choice of any number (none included) of the
 * permanents of a description, and the tap of exactly those. Only those two steps, the choice read by nothing after them.
 */
function tapAnyNumber(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'tap' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || a.min !== 0 || a.max !== 'any' || !same(a.who, { ref: 'you' })) return null;
  if (a.random === true || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.from.ref !== 'each') return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || Object.keys(b).some((k) => !['op', 'what'].includes(k) && (b as unknown as Record<string, unknown>)[k] !== undefined)) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const text = `tap any number of ${K.np(a.from.filter, cloneState(st), { det: 'none', plural: true })}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * edh-d-98 (CR 701.20a, 701.24a, 608.2c; Synthetic Destiny, eff.edhd98.revealUntil.creatures.putAll.bf.shuffleRest.oneSentence; family reveal-until-put-all-one-sentence): the reveal and
 * `putAllRevealedThenShuffleRest` above are also one sentence, "reveal cards ... until you reveal that many creature cards, put all creature cards revealed this way onto the battlefield,
 * then shuffle the rest of the revealed cards into your library"; the two sentences stay a reading. Only a reveal until that is the first instruction of its list (Mass Polymorph's,
 * after "Exile ..., then", is untouched), followed by exactly that fold (tried on a copy first).
 */
function revealUntilThenPutAllOneSentence(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  if (i !== 0 || r?.op !== 'revealUntil' || r.guard !== undefined) return null; // the first instruction of its list (a delayed trigger's): no "then" joins it to an earlier one
  const w = cloneState(st);
  try {
    K.clause(r, w);
    if (putAllRevealedThenShuffleRest(list, i + 1, w) === null) return null;
  } catch {
    return null; // a reveal the renderers have no words for (another player's, a group's): the other folds and renderers decide, as before
  }
  const c = K.clause(r, st);
  const f = putAllRevealedThenShuffleRest(list, i + 1, st)!;
  const rest = f.clauses[0]!.imp;
  return { clauses: [plain(`${c.imp}${ALT_TWO_OR_ONE(rest)}`, { standalone: true })], consumed: 1 + f.consumed };
}
/** The join of the two parts: a new sentence (Mass Polymorph) or a comma (Synthetic Destiny). */
const ALT_TWO_OR_ONE = (rest: string): string => alt(`. ${rest}`, `, ${rest}`);

export function foldEdhD35(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealUntilThenPutAllOneSentence(list, i, st) ?? putAllRevealedThenShuffleRest(list, i, st) ?? iterationControllerRevealsAndPuts(list, i, st) ?? putAnyNumberHandRestGraveyard(list, i, st) ?? revealUntilMayCastRestBottom(list, i, st) ?? tapAnyNumber(list, i, st);
}
