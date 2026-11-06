/**
 * edh-next-131 (must-finish round, group copies): the folds of its templates (parser/templates/zz-cloud/edh-next-131.json), called from render/fold.ts#foldAt. As every fold, one
 * applies only when every part is exactly what the idiom says. No value import of render/fold.ts (an import cycle).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { graveyardInsteadText } from './steps-zones';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * March of Progress (CR 707.2, 111.1, 115.1, 608.2c, 702.96a; template eff.edhn131.forEachChosen.copyToken): "Choose target artifact creature you control. For each creature chosen this
 * way, create a token that's a copy of it.": one `forEach` over the one target the "choose" sentence announced (render/program.ts#chosenFirst said it), one token copy of the element made
 * by "you". Overloaded (effects/overload.ts) the target becomes every such creature, and the step makes one copy of each.
 */
function forEachChosenCopy(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.inDirection !== undefined || f.over.ref !== 'target' || f.do.length !== 1) return null;
  if (st.chosen?.key !== `t:${f.over.id}`) return null;
  const c = f.do[0]!;
  if (c.op !== 'copy' || c.result !== 'token' || !same(c.who, { ref: 'you' }) || !same(c.what, { ref: 'bound', name: f.as })) return null;
  if (Object.keys(c).sort().join(',') !== 'op,result,what,who') return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"${f.as}"`))) return null;
  const info = st.info.get(`t:${f.over.id}`);
  if (info === undefined || info.plural === true || !(info.nouns ?? []).includes('creature')) return null;
  const it = K.obj(f.over, st, 'object');
  if (it.plural) return null;
  return { clauses: [plain(`for each creature chosen this way, create 1 token that is 1 copy of ${it.text}`, { standalone: true })], consumed: 1 };
}

/** The two target specs of a cast step of `{ref:'union', of:[t0, t1]}`: up to one instant card and up to one sorcery card in your graveyard, each of mana value X or less. */
function instantAndOrSorcery(st: RenderState, ids: string[]): boolean {
  const specs = ids.map((id) => st.specs.get(id));
  const want = (type: string) => ({ types: [type], zone: 'graveyard', owner: 'you', isCard: true, manaValue: { op: '<=', value: { q: 'X' } } });
  return specs.length === 2 && specs.every((t, k) => t !== undefined && t.kind === 'object' && t.min === 0 && t.max === 1 && Object.keys(t).sort().join(',') === 'filter,id,kind,max,min,text' && same(t.filter, want(k === 0 ? 'Instant' : 'Sorcery')));
}

/**
 * Finale of Promise (CR 601.2, 115.1, 601.2c, 107.3, 608.2g, 118.9, 614.1a; template eff.edhn131.cast.upToOneInstantAndOrSorcery.free): "You may cast up to one target instant card and/or up to one
 * target sorcery card from your graveyard each with mana value X or less without paying their mana costs. If a spell cast this way would be put into your graveyard, exile it instead.": one
 * optional free `cast` of the union of exactly those two targets, the caster choosing which and in what order (`select`, no limit), the spells bound for "those spells", each exiled instead of
 * going to your graveyard (the rider sentence, when it follows).
 */
function castInstantAndOrSorcery(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'cast' || c.guard !== undefined || c.what.ref !== 'union' || c.as === undefined || !same(c.who, { ref: 'you' }) || c.free !== true || c.optional !== true || !same(c.select, {})) return null;
  const gi = c.graveyardInstead;
  if (Object.keys(c).filter((k) => k !== 'graveyardInstead').sort().join(',') !== 'as,free,op,optional,select,what,who' || (gi !== undefined && !same(gi, { to: { zone: 'exile' }, yours: true }))) return null;
  const ids = c.what.of.map((r) => (r.ref === 'target' ? r.id : ''));
  if (ids.length !== 2 || ids.some((id) => id === '') || !instantAndOrSorcery(st, ids)) return null;
  for (const id of ids) { st.used.add(id); st.mentioned.add(`t:${id}`); }
  bind(st, c.as, { nouns: ['spell'], plural: true, alts: ['those spells', 'each of those spells'] });
  const head = 'you may cast up to 1 target instant card and/or up to 1 target sorcery card from your graveyard each with mana value x or less without paying their mana costs';
  return { clauses: [plain(`${head}${gi === undefined ? '' : graveyardInsteadText(gi)}`, { standalone: true })], consumed: 1 };
}

/**
 * Mirage Phalanx (CR 707.2, 707.9b, 702.10, 702.95, 613.1f; template eff.edhn131.copyToken.hasteLosesKeyword): "create a token that's a copy of this creature, except it has haste and loses
 * soulbond": one token copy made by "you" whose exceptions are exactly haste added and soulbond removed (two layer 6 modifications of the copiable values, CR 707.9b).
 */
function copyHasteLosesSoulbond(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'copy' || c.guard !== undefined || c.result !== 'token' || !same(c.who, { ref: 'you' }) || Object.keys(c).sort().join(',') !== 'except,op,result,what,who') return null;
  if (!same(c.except, [{ layer: 6, add: [{ kind: 'keyword', text: 'Haste', keyword: 'haste' }] }, { layer: 6, remove: ['soulbond'] }])) return null;
  const of = K.obj(c.what, st, 'object');
  if (of.plural) return null;
  return { clauses: [plain(`create 1 token that is 1 copy of ${of.text}, except it has haste and loses soulbond`)], consumed: 1 };
}

/**
 * Arna Kennerüd, Skycaptain (CR 707.2, 111.1, 303.4f, 301.5c, 608.2c; template eff.edhn131.forEachAttached.copyTokenAttached): "Then for each nontoken permanent attached to it, create a token that's
 * a copy of that permanent attached to that creature.": one `forEach` over the nontoken permanents attached to one object, one token copy of the element made by "you" that enters attached to that
 * same object (the copy step's `attachTo`, effects/handlers/tokens-copy.ts).
 */
function forEachAttachedCopy(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.inDirection !== undefined || f.over.ref !== 'each' || !('filter' in f.over) || f.do.length !== 1) return null;
  const flt = f.over.filter;
  if (flt === undefined || Object.keys(flt).sort().join(',') !== 'attachedToObject,token' || flt.token !== false || flt.attachedToObject === undefined) return null;
  const c = f.do[0]!;
  if (c.op !== 'copy' || c.result !== 'token' || !same(c.who, { ref: 'you' }) || !same(c.what, { ref: 'bound', name: f.as }) || !same(c.attachTo, flt.attachedToObject)) return null;
  if (Object.keys(c).sort().join(',') !== 'attachTo,op,result,what,who') return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"${f.as}"`))) return null;
  const host = K.obj(flt.attachedToObject as never, st, 'object');
  if (host.plural) return null;
  const again = K.obj(flt.attachedToObject as never, st, 'object');
  return { clauses: [plain(`for each nontoken permanent attached to ${host.text}, create 1 token that is 1 copy of that permanent attached to ${again.text}`, { standalone: true, leadThen: true })], consumed: 1 };
}

/**
 * Eumidian Wastewaker (CR 121.1, 608.2c, 400.7, 111.7; template eff.edhn131.draw.forEachLandCard.thisWay): "You draw a card for each land card put into a graveyard this way." right after the
 * `discardOrSacrifice` step that binds what it put into graveyards: a draw of the number of those objects that are land cards in a graveyard now (a land token, or a card that is no land card
 * there, is not counted: rulings 2025-07-25).
 */
function drawForLandCardsThisWay(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const d = list[i];
  const prev = list[i - 1];
  if (d?.op !== 'draw' || d.guard !== undefined || d.upTo !== undefined || !same(d.who, { ref: 'you' }) || prev?.op !== 'discardOrSacrifice' || prev.as === undefined) return null;
  if (!same(d.count, { q: 'count', of: { ref: 'each', filter: { is: { ref: 'bound', name: prev.as }, types: ['Land'], isCard: true, zone: 'graveyard' } } })) return null;
  return { clauses: [plain('you draw 1 card for each land card put into 1 graveyard this way', { standalone: true, breakBefore: true })], consumed: 1 };
}

/** The folds of edh-next-131 (render/fold.ts#foldAt). */
export function foldEdhN131(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return forEachChosenCopy(list, i, st) ?? castInstantAndOrSorcery(list, i, st) ?? copyHasteLosesSoulbond(list, i, st) ?? forEachAttachedCopy(list, i, st) ?? drawForLandCardsThisWay(list, i, st);
}
