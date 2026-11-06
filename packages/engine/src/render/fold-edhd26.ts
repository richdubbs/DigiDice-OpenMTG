/**
 * Commander lane name-hand, round edh-d-26 (coordinator D): the fold of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD26` after the other slices'
 * own folds). A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Each player with fewer cards in hand than the player with the most cards in hand draws cards equal to the difference." (Tales of the Ancestors; CR 402.1, 121.1, 608.2c):
 * every player draws as many cards as the largest hand has more than their own (a player with the largest hand draws none). Only that exact shape.
 */
function eachFewerHandDrawsDifference(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'draw' || a.guard !== undefined || a.as !== undefined || !same(a.who, { ref: 'each', who: 'player' })) return null;
  const want = { q: 'math', op: '-', args: [{ q: 'zoneSize', zone: 'hand', of: { ref: 'each', who: 'player' }, agg: 'max' }, { q: 'zoneSize', zone: 'hand', of: { ref: 'iterating' } }] };
  if (!same(a.count, want) || Object.keys(a).some((k) => !['op', 'who', 'count'].includes(k))) return null;
  return { clauses: [plain('each player with fewer cards in hand than the player with the most cards in hand draws cards equal to the difference', { standalone: true })], consumed: 1 };
}

/**
 * "That player reveals the chosen card, puts it on the bottom of their library, then draws a card." (Vendilion Clique; CR 701.20a, 401.4, 121.1, 608.2c): the player reveals the card
 * a `chooseObjects` step chose in their hand, puts it on the bottom of their library, then draws N cards. Only those three steps, naming the same card and player.
 */
function revealChosenBottomDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, m, d] = [list[i], list[i + 1], list[i + 2]];
  if (r?.op !== 'reveal' || m?.op !== 'move' || d?.op !== 'draw') return null;
  if (r.guard !== undefined || m.guard !== undefined || d.guard !== undefined || r.as !== undefined || m.as !== undefined || d.as !== undefined || r.to !== undefined) return null;
  const bound = r.what.ref === 'bound' ? r.what.name : undefined;
  if (bound === undefined || !same(m.what, r.what) || !same(d.who, r.who) || typeof d.count !== 'number' || d.count < 1) return null;
  if (!same(m.to, { zone: 'library', position: 'bottom' }) || Object.keys(m).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(d).some((k) => !['op', 'who', 'count'].includes(k))) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${bound}"`))) return null;
  const who = K.player(r.who, st, 'subject');
  const cards = d.count === 1 ? 'a card' : `${numWord(d.count)} cards`;
  const verbs = who.person === 'pl' ? ['reveal', 'put', 'draw'] : ['reveals', 'puts', 'draws'];
  const card = alt('the chosen card', 'that card');
  const tail = `${verbs[0]} ${card}, ${verbs[1]} it on the bottom of their library, then ${verbs[2]} ${cards}`;
  return { clauses: [acting(who.text, tail, `${who.text} ${tail}`, { standalone: true })], consumed: 3 };
}

/**
 * "Each opponent with no cards in hand loses 10 life." (Tinybones, Trinket Thief; CR 402.1, 119.3, 608.2c): every opponent whose hand is empty as the instruction resolves loses
 * the life, each judged alone. Only that exact shape (an if with one life loss inside a loop over the opponents).
 */
function eachOpponentNoHandLosesLife(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.guard !== undefined || !same(a.over, { ref: 'each', who: 'opponent' }) || typeof a.as !== 'string' || a.do.length !== 1) return null;
  const inner = a.do[0];
  if (inner?.op !== 'if' || inner.else !== undefined || inner.guard !== undefined || inner.then.length !== 1) return null;
  if (!same(inner.cond, { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'bound', name: a.as } }, op: '==', right: 0 })) return null;
  const lose = inner.then[0];
  if (lose?.op !== 'loseLife' || lose.guard !== undefined || !same(lose.who, { ref: 'bound', name: a.as }) || typeof lose.amount !== 'number' || Object.keys(lose).some((k) => !['op', 'who', 'amount'].includes(k))) return null;
  if (Object.keys(a).some((k) => !['op', 'over', 'as', 'do'].includes(k)) || Object.keys(inner).some((k) => !['op', 'cond', 'then'].includes(k))) return null;
  return { clauses: [plain(`each opponent with no cards in hand loses ${lose.amount} life`, { standalone: true })], consumed: 1 };
}

/**
 * "Choose X cards in your hand and discard the rest." (Breakthrough; CR 701.9a, 608.2d, 402.1): you choose a number of cards in your hand, then discard every other card of it.
 * Only those two steps, the second reading the first one's binding and nothing else.
 */
function chooseInHandDiscardRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, d] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || d?.op !== 'discard' || typeof c.as !== 'string') return null;
  if (c.guard !== undefined || d.guard !== undefined || c.random === true || c.distinct !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.startingWith !== undefined || c.link !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || !same(c.from, { ref: 'each', filter: { zone: 'hand', owner: 'you' } }) || !same(c.min, c.max) || c.max === 'any' || (typeof c.max === 'number' && c.max < 1)) return null;
  if (!same(d.who, { ref: 'you' }) || d.count !== 'hand' || d.mode !== undefined || d.cantAs !== undefined || !same(d.filter, { not: { is: { ref: 'bound', name: c.as } } })) return null;
  if (Object.keys(c).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k)) || Object.keys(d).some((k) => !['op', 'who', 'count', 'filter'].includes(k))) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${c.as}"`))) return null;
  const n = typeof c.max === 'number' ? numWord(c.max) : K.qty(c.max, st);
  const text = `choose ${n} cards in your hand and discard the rest`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/** The folds of edh-d-26 (render/fold.ts#foldAt). */
export function foldEdhD26(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachFewerHandDrawsDifference(list, i, st) ?? revealChosenBottomDraw(list, i, st) ?? eachOpponentNoHandLosesLife(list, i, st) ?? chooseInHandDiscardRest(list, i, st);
}
