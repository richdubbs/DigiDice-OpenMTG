/**
 * edh-mana-keywords-8 (Commander lane edh-mana-keywords): the folds of its templates (parser/templates/zz-cloud/edh-mana-keywords-8.json), called from render/fold.ts#foldAt.
 *
 * `convokersConnive` (CR 702.51a, 701.50a; eff.edhmk8.convokers.connive; Lethal Scheme): "each creature that convoked ~ connives": one step per creature tapped to convoke
 * the spell (`{ref:'convokers'}`), each connives under its controller's control. Only that shape: a `forEach` over those creatures with the one `connive`
 * action on the creature, no count.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function convokersConnive(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.guard !== undefined || a.gather !== undefined || a.over.ref !== 'convokers' || a.do.length !== 1) return null;
  const b = a.do[0]!;
  if (b.op !== 'action' || b.action !== 'connive' || b.guard !== undefined || b.n !== undefined || b.arg !== undefined || b.choices !== undefined || b.as !== undefined) return null;
  const it = { ref: 'bound', name: a.as };
  if (!same(b.subject, it) || !same(b.who, { ref: 'controllerOf', object: it })) return null;
  return { clauses: [plain(`each creature that convoked ${K.obj({ ref: 'self' }, st, 'object').text} connives`)], consumed: 1 };
}

/**
 * `exileExceptSharing` (CR 702.51a, 205.3m, 406.2, 608.2c; eff.edhmk8.exile.exceptConvokerTypes; Everything Comes to Dust): "exile all creatures except those that share a creature type
 * with a creature that convoked ~, all artifacts, and all enchantments": the one `move` to exile of every creature that has no creature type in common with one of a described set,
 * every artifact and every enchantment. Only that shape.
 */
function exileExceptSharing(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'move' || a.guard !== undefined || a.until !== undefined || a.link !== undefined || a.remember !== undefined || a.as !== undefined || a.what.ref !== 'each' || !('filter' in a.what)) return null;
  if (!same(a.to, { zone: 'exile' })) return null;
  const f = a.what.filter;
  const [c, art, ench] = f.anyOf ?? [];
  if (Object.keys(f).length !== 1 || f.anyOf?.length !== 3 || !same(art, { types: ['Artifact'] }) || !same(ench, { types: ['Enchantment'] })) return null;
  const sw = c?.not?.sharesWith;
  if (c === undefined || Object.keys(c).length !== 2 || !same(c.types, ['Creature']) || sw === undefined || sw.quality !== 'creatureType' || sw.other !== undefined || sw.with.ref !== 'convokers') return null;
  return { clauses: [plain(`exile all creatures except those that share a creature type with a creature that convoked ${K.obj({ ref: 'self' }, st, 'object').text}, all artifacts, and all enchantments`)], consumed: 1 };
}

/**
 * `ifCountersRemoveAllOfThem` (CR 122.1, 608.2c, 603.4; eff.edhmk8.thenIf.removeAllCounters.and; Replicating Ring): "Then if it has eight or more night counters on it, remove all of
 * them and create ...": when the object has that many counters of a kind, all counters of that kind leave it, and the other instructions follow. Only that shape: an `if` with no
 * otherwise whose first instruction removes all counters of the kind its condition counts from the object the condition is about.
 */
function ifCountersRemoveAllOfThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'if' || a.else !== undefined || a.guard !== undefined || a.then.length < 2) return null;
  const c = a.cond;
  if (c.cond !== 'matches' || !same(c.object, { ref: 'self' }) || Object.keys(c.filter).join(',') !== 'counters') return null;
  const k = c.filter.counters;
  const r = a.then[0]!;
  if (k === undefined || k.kind === 'any' || k.cmp?.op !== '>=' || r.op !== 'removeCounters' || r.count !== 'all' || r.kind !== k.kind || !same(r.from, { ref: 'self' }) || r.guard !== undefined || r.upTo === true) return null;
  const rest = K.steps(a.then.slice(1), st);
  // edh-top-10 (family remove-them-all-counters; Strixhaven Stadium): Oracle also says "remove them all"
  return { clauses: [plain(`if ${K.cond(c, st)}, ${alt('remove all of them', 'remove them all')} and ${rest}`, { standalone: true, leadThen: true })], consumed: 1 };
}

/** The folds of edh-mana-keywords-8 (render/fold.ts#foldAt). */
export function foldEdhMk8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return convokersConnive(list, i, st) ?? exileExceptSharing(list, i, st) ?? ifCountersRemoveAllOfThem(list, i, st);
}
