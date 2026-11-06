/**
 * edh-next-72 (Commander lane each-player, second round): the folds of its templates (parser/templates/zz-cloud/edh-next-72.json), called from render/steps.ts#clausesOf (they print
 * other steps through the renderer, handed in as `deps`: render/steps.ts imports render/fold.ts, so a value import of either here would make an import cycle). Each applies only when
 * every part is exactly what the idiom says.
 *
 * `exileForEachOpponentGainLife` (CR 102.3, 115.1, 601.2c, 608.2c, 608.2h, 119.1; Luminate Primordial): "For each opponent, exile up to one target creature that player controls and
 * that player gains life equal to its power.": the exile of a target spec with at most one target for each opponent, then, for each permanent it exiled, its (last known) controller
 * gains life equal to its (last known) power. Exactly the two steps of template eff.edhn72.forEachOpponent.exile.thatPlayerGainsLifePower.
 */
import type { EffectStep } from '../types/ability';
import { plain, type Clause } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

/** The renderer's own functions, handed in by render/steps.ts. */
export interface FoldDeps {
  foldAt: (list: EffectStep[], i: number, st: RenderState) => Folded | null;
  clause: (step: EffectStep, st: RenderState) => Clause;
  clausesOf: (list: EffectStep[], st: RenderState) => Clause[];
}

const EACH_MOVED = { ref: 'bound', name: 'eachMoved' };

function exileForEachOpponentGainLife(list: EffectStep[], i: number, st: RenderState, { clause }: FoldDeps): Folded | null {
  const [m, f] = [list[i], list[i + 1]];
  if (m?.op !== 'move' || f?.op !== 'forEach' || m.guard !== undefined || f.guard !== undefined || m.as === undefined || m.until !== undefined || m.link !== undefined) return null;
  if (m.what.ref !== 'target' || !same(m.to, { zone: 'exile' })) return null;
  const spec = st.specs.get(m.what.id);
  if (spec?.perOpponent !== true || spec.min !== 0 || spec.max !== 1) return null;
  if (!same(f.over, { ref: 'bound', name: m.as }) || f.as !== 'eachMoved' || f.do.length !== 1 || f.gather !== undefined) return null;
  const g = f.do[0]!;
  if (g.op !== 'gainLife' || g.guard !== undefined || g.as !== undefined) return null;
  if (!same(g.who, { ref: 'controllerOf', object: EACH_MOVED }) || !same(g.amount, { q: 'stat', stat: 'power', of: EACH_MOVED })) return null;
  const first = clause(m, st);
  const tail = ' and that player gains life equal to its power';
  return { clauses: [{ ...first, imp: `${first.imp}${tail}`, sub: `${first.sub}${tail}`, ...(first.have !== undefined ? { have: `${first.have}${tail}` } : {}) }], consumed: 2 };
}

/**
 * `eachPlayerMayPutThenOpponentsWhoDidntDraw` (CR 101.4, 608.2c, 608.2d, 110.2a, 121.1; Kynaios and Tiro of Meletis): "Each player may put a land card from their hand onto the battlefield, then
 * each opponent who didn't draws a card.": the choice and the move of template eff.edhn1.eachPlayer.may.put.fromHand.bf, then each opponent who owns none of the cards put draws a card. Exactly
 * the three steps of template eff.edhn72.eachPlayer.may.put.fromHand.bf.thenOpponentsWhoDidntDraw.
 */
function eachPlayerMayPutThenOpponentsWhoDidntDraw(list: EffectStep[], i: number, st: RenderState, { clausesOf }: FoldDeps): Folded | null {
  const [c, m, d] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || d?.op !== 'draw' || d.guard !== undefined || d.as !== undefined || d.count !== 1) return null;
  const owners = { ref: 'ownerOf', object: { ref: 'bound', name: c.as } };
  if (!same(d.who, { ref: 'otherOf', of: { ref: 'each', who: 'opponent' }, than: owners })) return null;
  const first = clausesOf([c, m], st);
  if (first.length !== 1 || first[0]!.empty === true) return null;
  const tail = ', then each opponent who didn\'t draws a card';
  return { clauses: [{ ...first[0]!, imp: `${first[0]!.imp}${tail}`, sub: `${first[0]!.sub}${tail}`, ...(first[0]!.have !== undefined ? { have: `${first[0]!.have}${tail}` } : {}) }], consumed: 3 };
}

/**
 * `eachOpponentMayInvestigateThenYouInvestigate` (CR 101.4, 102.3, 608.2c, 608.2d, 701.16a; Wernog, Rider's Chaplain): "Each opponent may investigate. Each opponent who doesn't loses 1
 * life. You investigate X times, where X is one plus the number of opponents who investigated this way.": a `may` of each opponent whose option is investigating and whose "otherwise"
 * (for each opponent who declined) is losing life, then the controller investigates one plus the number of the opponents who did it (the count of that step). Exactly the two steps of the
 * templates eff.edhn72.eachOpponent.mayInvestigate.otherwiseLoseLife and eff.edhn72.youInvestigatePlusOpponentsWhoInvestigated.
 */
function eachOpponentMayInvestigateThenYouInvestigate(list: EffectStep[], i: number): Folded | null {
  const [m, a] = [list[i], list[i + 1]];
  if (m?.op !== 'may' || m.guard !== undefined || m.as === undefined || m.anyOne !== undefined || m.villainous !== undefined || m.gather !== undefined) return null;
  if (!same(m.who, { ref: 'each', who: 'opponent' }) || m.do.length !== 1 || m.otherwise?.length !== 1) return null;
  const inv = m.do[0]!;
  const lose = m.otherwise[0]!;
  if (inv.op !== 'action' || inv.action !== 'investigate' || inv.guard !== undefined || inv.as !== undefined || inv.n !== undefined || !same(inv.who, ITERATING)) return null;
  if (lose.op !== 'loseLife' || lose.guard !== undefined || lose.as !== undefined || !same(lose.who, ITERATING) || typeof lose.amount !== 'number') return null;
  const first = [plain('each opponent may investigate', { standalone: true }), plain(`each opponent who doesn't loses ${lose.amount} life`, { standalone: true })];
  // the sentence that counts the opponents who did it (template eff.edhn72.youInvestigatePlusOpponentsWhoInvestigated) follows, or the two sentences stand alone
  if (a?.op !== 'action' || a.guard !== undefined || a.action !== 'investigate' || a.as !== undefined || !same(a.who, { ref: 'you' }) || !same(a.n, { q: 'math', op: '+', args: [1, { q: 'resultCount', step: m.as }] })) {
    return { clauses: first, consumed: 1 };
  }
  return { clauses: [...first, plain('you investigate x times, where x is 1 plus the number of opponents who investigated this way', { standalone: true })], consumed: 2 };
}

/**
 * `eachPlayerExactlyLifeLosesGame` (CR 101.4, 104.3b, 104.4a, 119.1, 608.2c, 608.2h; Triskaidekaphobia): "Each player with exactly 13 life loses the game, then each player gains (loses) 1 life.":
 * every player whose life total is exactly the number as the instruction is performed loses the game, all of them together (so every player at once is a draw), then every player gains (loses)
 * the life. Exactly the two steps of templates eff.edhn72.eachPlayerExactlyLife.losesGame.thenGainLife / .thenLoseLife.
 */
function eachPlayerExactlyLifeLosesGame(list: EffectStep[], i: number, st: RenderState, { clause }: FoldDeps): Folded | null {
  const [l, g] = [list[i], list[i + 1]];
  if (l?.op !== 'loseGame' || l.guard !== undefined || l.who.ref !== 'withLife' || l.who.who !== 'player' || l.who.op !== '==') return null;
  if ((g?.op !== 'gainLife' && g?.op !== 'loseLife') || g.guard !== undefined || g.as !== undefined || !same(g.who, { ref: 'each', who: 'player' })) return null;
  const second = clause(g, st);
  return { clauses: [plain(`each player with exactly ${l.who.n} life loses the game, then ${second.sub}`, { standalone: true })], consumed: 2 };
}

/**
 * `eachPlayerMayDrawUpToTwoGainLife` (CR 101.4, 608.2c, 608.2d, 121.1, 119.1; Truce, Temporary Truce): "Each player may draw up to two cards. For each card less than two a player
 * draws this way, that player gains 2 life.": every player chooses how many cards (up to two) to draw and gains the life for each card less than two it drew, a player who declines
 * having drawn none. Exactly the one `may` of template eff.edhn72.eachPlayerMayDrawUpToTwo.gainLifePerCardLess.
 */
function eachPlayerMayDrawUpToTwoGainLife(list: EffectStep[], i: number): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || m.guard !== undefined || m.as !== undefined || m.anyOne !== undefined || m.villainous !== undefined || m.gather !== undefined || !same(m.who, { ref: 'each', who: 'player' })) return null;
  const [d, g] = m.do;
  const o = m.otherwise?.[0];
  if (m.do.length !== 2 || m.otherwise?.length !== 1 || d?.op !== 'draw' || g?.op !== 'gainLife' || o?.op !== 'gainLife') return null;
  if (d.guard !== undefined || d.as !== 'drewUpTo' || d.count !== 2 || d.upTo !== true || !same(d.who, ITERATING) || g.guard !== undefined || g.as !== undefined || !same(g.who, ITERATING)) return null;
  if (o.guard !== undefined || o.as !== undefined || !same(o.who, ITERATING)) return null;
  const a = g.amount;
  if (typeof a !== 'object' || a.q !== 'math' || a.op !== '*' || typeof a.args[0] !== 'number') return null;
  const life = a.args[0];
  if (!same(a, { q: 'math', op: '*', args: [life, { q: 'math', op: '-', args: [2, { q: 'resultCount', step: 'drewUpTo' }] }] }) || !same(o.amount, { q: 'math', op: '*', args: [life, 2] })) return null;
  return {
    clauses: [plain('each player may draw up to two cards', { standalone: true }), plain(`for each card less than two a player draws this way, that player gains ${life} life`, { standalone: true })],
    consumed: 1,
  };
}

/**
 * `eachPlayerMayDiscardUpToThreeDamage` (CR 101.4, 608.2c, 608.2d, 701.9a, 120.3, 608.2h; Mind Bomb): "Each player may discard up to three cards. ~ deals damage to each player equal to 3 minus
 * the number of cards they discarded this way.": every player chooses up to three cards of their hand and discards them, then is dealt 3 minus the number discarded (a player who declines is dealt 3).
 * Exactly the one `may` of template eff.edhn72.eachPlayerMayDiscardUpToThree.damageThreeMinus.
 */
function eachPlayerMayDiscardUpToThreeDamage(list: EffectStep[], i: number): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || m.guard !== undefined || m.as !== undefined || m.anyOne !== undefined || m.villainous !== undefined || m.gather !== undefined || !same(m.who, { ref: 'each', who: 'player' })) return null;
  if (m.do.length !== 3 || m.otherwise?.length !== 1) return null;
  const [c, d, x] = m.do;
  const o = m.otherwise[0];
  const handOfIterating = { ref: 'each', filter: { zone: 'hand', owner: ITERATING } };
  if (c?.op !== 'chooseObjects' || c.guard !== undefined || c.as !== 'toDiscard' || c.min !== 0 || c.max !== 3 || !same(c.who, ITERATING) || !same(c.from, handOfIterating) || c.perPlayer !== undefined || c.startingWith !== undefined || c.link !== undefined) return null;
  if (d?.op !== 'discard' || d.guard !== undefined || d.as !== 'discarded' || !same(d.who, ITERATING) || !same(d.count, { q: 'count', of: { ref: 'bound', name: 'toDiscard' } }) || !same(d.filter, { is: { ref: 'bound', name: 'toDiscard' } }) || d.mode !== undefined) return null;
  const self = { ref: 'self' };
  if (x?.op !== 'damage' || x.guard !== undefined || x.as !== undefined || !same(x.source, self) || !same(x.to, ITERATING)) return null;
  if (!same(x.amount, { q: 'math', op: '-', args: [3, { q: 'resultCount', step: 'discarded', which: { isCard: true } }] })) return null;
  if (o?.op !== 'damage' || o.guard !== undefined || o.as !== undefined || !same(o.source, self) || !same(o.to, ITERATING) || o.amount !== 3) return null;
  return {
    clauses: [plain('each player may discard up to three cards', { standalone: true }), plain('~ deals damage to each player equal to 3 minus the number of cards they discarded this way', { standalone: true })],
    consumed: 1,
  };
}

export function foldEdhN72(list: EffectStep[], i: number, st: RenderState, deps: FoldDeps): Folded | null {
  return exileForEachOpponentGainLife(list, i, st, deps) ?? eachPlayerMayPutThenOpponentsWhoDidntDraw(list, i, st, deps) ?? eachOpponentMayInvestigateThenYouInvestigate(list, i) ?? eachPlayerExactlyLifeLosesGame(list, i, st, deps) ?? eachPlayerMayDrawUpToTwoGainLife(list, i) ?? eachPlayerMayDiscardUpToThreeDamage(list, i);
}
