/**
 * edh-d-43 (Commander coordinator D, lane counter-modes, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-43.json), called from render/fold.ts#foldAt. Each applies
 * only when every part is exactly what the idiom says. A new fold file never imports a value from render/fold.ts (an import cycle).
 *
 * `playerMayDiscardUpTo` (CR 701.9a, 608.2c, 608.2d; Mishra's Command, eff.edhd43.player.mayDiscardUpTo): "Target player may discard up to X cards.": a player other than you chooses
 * between none and a number of cards in their own hand, then discards exactly those; the discard reports the cards for a later "for each card discarded this way".
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { playerKey } from './state';
import { bind, modal } from './steps-util';
import { alt, conjAny, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerMayDiscardUpTo(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'discard' || a.as === undefined || a.random === true || a.guard !== undefined || b.guard !== undefined || b.mode !== undefined) return null;
  if (a.who.ref === 'you') return null;
  // a group of players would choose from the union of their hands: no wording for that, fail closed
  if (a.who.ref !== 'target' && a.who.ref !== 'event') return null; // (the older folds say it, or the gate refuses it)
  if (a.min !== 0 || a.max === 'any' || a.groupLimit !== undefined || a.perPlayer !== undefined || !same(a.who, b.who)) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || !same(a.from.filter, { zone: 'hand', owner: a.who })) return null;
  if (!same(b.filter, { is: { ref: 'bound', name: a.as } }) || !same(b.count, { q: 'count', of: { ref: 'bound', name: a.as } })) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"name":"${a.as}"`))) return null;
  const max = typeof a.max === 'number' ? (a.max >= 1 ? numWord(a.max) : null) : K.qty(a.max, st);
  if (max === null) return null;
  const cards = `up to ${max} ${a.max === 1 ? 'card' : 'cards'}`;
  const subj = K.player(a.who, st, 'subject');
  const forms = [`${subj.text} may discard ${cards}`, `${subj.text} ${conjAny('discard', subj.person)} ${cards}`, ...(subj.they === true ? [`they may discard ${cards}`, `they discard ${cards}`] : [])];
  const said = alt(...forms);
  const clause = acting(playerKey(a.who) ?? 'x', said, said);
  bind(st, a.as, { nouns: ['card'], plural: true, optional: true });
  if (b.as !== undefined) st.info.set(`r:${b.as}`, { nouns: ['card'], plural: true, thisWay: 'discarded this way', moved: 'discarded' });
  return { clauses: [clause], consumed: 2 };
}

/**
 * `counterExileThenCastFree` (CR 701.6a, 614.15, 608.2c, 118.9, 601.2b; Transcendent Dragon, rid.edhd43.countered.exileInstead.thenCastFree): "Counter target spell. If that spell is
 * countered this way, exile it instead of putting it into its owner's graveyard, then you may cast it without paying its mana cost.": the counter that exiles the spell it counters, then
 * the controller's optional free cast of that card, said as one sentence.
 */
function counterExileThenCastFree(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'counter' || b?.op !== 'cast' || a.as === undefined || a.guard !== undefined || b.guard !== undefined) return null;
  if (a.to?.zone !== 'exile' || Object.keys(a.to).length !== 1 || a.toIf !== undefined || a.sourceEffect !== undefined || a.sourceThen !== undefined) return null;
  if (!same(b.who, { ref: 'you' }) || !same(b.what, { ref: 'bound', name: a.as }) || b.free !== true || b.optional !== true || Object.keys(b).some((k) => !['op', 'who', 'what', 'free', 'optional'].includes(k))) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"name":"${a.as}"`))) return null;
  const counter = K.steps([a], st);
  return { clauses: [plain(`${counter}, then you may cast it without paying its mana cost`, { standalone: true })], consumed: 2 };
}

/**
 * `playerMayChooseAnyNumberPayEach` (CR 608.2c, 608.2d, 118.12, 107.1; Dream Tides, Mudslide, eff.edhd43.player.mayChooseAnyNumber.payEach): "That player may choose any number of tapped nongreen creatures
 * they control and pay {2} for each creature chosen this way.": a player chooses any number of the permanents of one description, then may pay a cost once for each chosen. The choice is
 * read by the steps after it ("untap those creatures").
 */
function playerMayChooseAnyNumberPayEach(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'pay' || a.as === undefined || a.random === true || a.guard !== undefined || b.guard !== undefined) return null;
  if (a.min !== 0 || a.max !== 'any' || a.groupLimit !== undefined || a.perPlayer !== undefined || a.distinct !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined) return null;
  if (a.who.ref === 'you' || !same(a.who, b.who) || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  if (!same(b.times, { q: 'count', of: { ref: 'bound', name: a.as } }) || b.upTo !== undefined || b.anyAmount !== undefined || b.mandatory === true || b.else !== undefined || b.xMax !== undefined || b.everyPlayer !== undefined) return null;
  const mana = b.cost.mana;
  if (mana === undefined || Object.keys(b.cost).length !== 1) return null;
  const f = a.from.filter;
  if (f.controller === undefined || !same(f.controller, a.who)) return null; // "they control": the chosen player's own permanents
  const what = K.np({ ...f, controller: undefined }, st, { det: 'none', plural: true });
  if (f.types === undefined || f.types.length !== 1) return null; // (the counted noun is the card type alone: "for each creature chosen this way")
  const noun = K.np({ types: f.types }, st, { det: 'none', plural: false });
  const cost = K.cost(b.cost, st);
  const may = modal(a.who, st, `may choose any number of ${what} ${K.player(a.who, st, 'subject').text === 'you' ? 'you' : 'they'} control and pay ${cost} for each ${noun} chosen this way`);
  bind(st, a.as, { nouns: [noun], plural: true, optional: true });
  // "If the player does, untap those creatures.": the one instruction on the payment, naming the chosen permanents (an `if` on the payment, folded into its `then` by the lowering)
  const t = b.then;
  if (t !== undefined) {
    if (t.length !== 1 || t[0]!.op !== 'untap' || t[0]!.guard !== undefined || !same(t[0]!.what, { ref: 'bound', name: a.as })) return null;
    const rest = plain(`if ${alt('the player does', 'that player does')}, untap those ${noun}s`, { standalone: true });
    return { clauses: [{ ...may, standalone: true }, rest], consumed: 2 };
  }
  return { clauses: [{ ...may, standalone: true }], consumed: 2 };
}

export function foldEdhD43(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerMayDiscardUpTo(list, i, st) ?? counterExileThenCastFree(list, i, st) ?? playerMayChooseAnyNumberPayEach(list, i, st);
}
