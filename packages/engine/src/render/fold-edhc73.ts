/**
 * edh-c-73 (Commander lane edh-c, EDHREC ranks 22,501 to 23,000, second pass): the folds of its readings (parser/templates/zz-cloud/edh-c-73.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 *
 * `drawDifference` (CR 701.9a, 121.1, 608.2c, 608.2h; Skull Raid, eff.edhv73.draw.difference.ifFewerDiscarded): "If fewer than two cards were discarded this way, you draw cards equal
 * to the difference.": a draw guarded by "the cards the discard right before reported are fewer than N", of N minus those cards.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function drawDifference(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'draw' || d.who.ref !== 'you' || d.as !== undefined || typeof d.count !== 'object' || d.count.q !== 'math' || d.count.op !== '-' || d.count.args.length !== 2) return null;
  const [n, got] = d.count.args;
  const g = d.guard;
  if (typeof n !== 'number' || g === undefined || g.cond !== 'compare' || g.op !== '<' || g.right !== n || !same(g.left, got)) return null;
  if (typeof got !== 'object' || got.q !== 'resultCount' || got.which?.isCard !== true || st.info.get(`r:${got.step}`)?.thisWay !== 'discarded this way') return null;
  return { clauses: [plain(`if fewer than ${numWord(n)} cards were discarded this way, you draw cards equal to the difference`, { standalone: true })], consumed: 1 };
}

/**
 * `tokensAtNextUpkeepWhereX` (CR 603.7, 503.1, 107.3, 608.2h; Hazezon Tamar, eff.edhv73.token.nextUpkeep.whereXThen): "create X 1/1 <Subtype> creature tokens that are red, green, and white at the
 * beginning of your next upkeep, where X is <a count> at that time.": a delayed trigger of your next upkeep that creates the tokens, the count read when it happens (the delay's body
 * reads the state then, CR 603.7c).
 */
function tokensAtNextUpkeepWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'delay' || d.guard !== undefined || d.as !== undefined || !same(d.when, { at: 'step', step: 'upkeep', whose: 'you', next: true }) || d.do.length !== 1) return null;
  const c = d.do[0]!;
  if (c.op !== 'createToken' || c.guard !== undefined || c.as !== undefined || !same(c.who, { ref: 'you' }) || typeof c.count !== 'object' || c.count.q === 'X') return null;
  const t = c.token as { colors?: string[]; types?: string[]; subtypes?: string[]; power?: unknown; toughness?: unknown };
  if (Object.keys(t).sort().join() !== 'colors,power,subtypes,toughness,types' || !same(t.colors, ['W', 'R', 'G']) || !same(t.types, ['Creature']) || t.subtypes === undefined || t.subtypes.length === 0 || t.power !== 1 || t.toughness !== 1) return null;
  const count = K.qty(c.count, st);
  return { clauses: [plain(`create X 1/1 ${t.subtypes.join(' ')} creature tokens that are red, green, and white at the beginning of your next upkeep, where X is ${count} at that time`, { standalone: true })], consumed: 1 };
}

/**
 * `damageTargetAndOthersSharingColor` (CR 120.3, 120.2b, 105.2; Wojek Embermage, eff.edhv73.damage.targetAndOthersSharingColor): "~ deals 1 damage to target creature and each other creature that
 * shares a color with it.": one damage event of the same amount to the target and to every creature but the target that shares a color with it (a colorless target shares none).
 */
function damageTargetAndOthersSharingColor(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'damage' || d.guard !== undefined || d.as !== undefined || d.to.ref !== 'target' || d.divided !== undefined || d.perSource === true || d.unpreventable === true) return null;
  if (typeof d.amount !== 'number' || d.also?.length !== 1) return null;
  const a = d.also[0]!;
  if (a.amount !== d.amount || a.to.ref !== 'each' || !('filter' in a.to) || !same(a.to.filter, { types: ['Creature'], sharesWith: { with: d.to, quality: 'color' }, not: { is: d.to } })) return null;
  const source = K.obj(d.source, st, 'subject').text;
  const target = K.obj(d.to, st, 'object').text;
  return { clauses: [plain(`${source} deals ${d.amount} damage to ${target} and each other creature that shares a color with it`, { standalone: true })], consumed: 1 };
}

export function foldEdhC73(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawDifference(list, i, st) ?? tokensAtNextUpkeepWhereX(list, i, st) ?? damageTargetAndOthersSharingColor(list, i, st);
}
