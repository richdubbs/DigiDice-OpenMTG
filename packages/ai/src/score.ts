/**
 * How much the bot wants to put a spell or ability on the stack right now: the best use of its targets (targets.ts) and of its other effects, weighed by the
 * moment (windows.ts). Zero means "not now". Instants wait for the moment they are best at (removal on attackers, tricks after blocks, the opponent's end
 * step); counterspells wait for a spell worth countering.
 */
import type { ObjectId, PlayerId } from '@openmtg/engine';
import { availableMana, controller, creatures, hand, isType, kw, LETHAL, lethalDamage, life, multi, safeToDraw, type Ctx } from './context';
import { ownDraws, qty, type Summary, type TargetUse } from './intent';
import { chooseFrom, estimatePool, wantOf, type Pick } from './targets';
import { value } from './value';
import { isCombatTrick, isMain, type Window } from './windows';

/** A spell worth a counterspell (targets.ts#stackThreat): a three-mana creature, or removal aimed at a real creature. */
const COUNTER_WORTH = 10;

export interface Timing {
  window: Window;
  /** Only at sorcery speed (CR 307.1): sorceries, most permanents, loyalty abilities. */
  sorcery: boolean;
  /** An ability the bot can use again next turn for free ({T}: deal 1 damage): worth using at the end of the opponent's turn for even a little. */
  repeatable?: boolean;
}

const HARM_THRESHOLD: Partial<Record<Window, number>> = { myMain1: 4.5, oppAttack: 3, oppEnd: 2 };

/** The score of a summarized effect, or 0 when the bot should not use it now. */
export function effectScore(ctx: Ctx, s: Summary, sourceId: ObjectId | null, t: Timing): number {
  if (s.manual && s.uses.length === 0 && s.draws + s.tokens + s.lifeGain + s.oppDamage + s.sweepDamage === 0) return 0; // nothing but text to resolve by hand
  if (!safeToDraw(ctx, ownDraws(s))) return 0; // never deck itself (CR 121.4, 704.5b), "each player draws" included
  const w = t.window;
  let score = 0;
  for (const u of s.uses) {
    const pick = bestPick(ctx, u, sourceId);
    if (pick === null) return 0;
    const sc = useScore(ctx, s, u, pick, t);
    if (sc >= LETHAL) return LETHAL;
    if (sc <= 0) return 0;
    score += sc;
  }
  // Effects without targets.
  if (s.draws > 0) {
    score +=s.draws * (t.sorcery ? (w === 'myMain2' || w === 'myMain1' ? 6 : 0) : (w === 'oppEnd' ? 6 : 0));
  }
  if (s.tokens > 0) {
    const each = 2 + s.tokenPower / Math.max(1, s.tokens) * 1.5;
    score += s.tokens * each * (t.sorcery ? 1 : (w === 'oppEnd' || w === 'oppAttack' ? 1 : 0));
  }
  if (s.lifeGain > 0) score += s.lifeGain * (life(ctx, ctx.me) <= 8 ? 0.6 : 0.2) * (t.sorcery || w === 'oppEnd' ? 1 : 0);
  if (s.oppDamage > 0 && multi(ctx)) {
    // M12-6 (A7): "each opponent" with several opponents: it wins only when it kills every one of them (CR 104.2a); each opponent hit counts
    if (ctx.opps.every((p) => s.oppDamage >= life(ctx, p))) return LETHAL;
    score += s.oppDamage * 0.6 * ctx.opps.length * (t.sorcery || w === 'oppEnd' ? 1 : 0);
  } else if (s.oppDamage > 0) {
    if (s.oppDamage >= life(ctx, ctx.opp)) return LETHAL;
    score += s.oppDamage * 0.6 * (t.sorcery || w === 'oppEnd' ? 1 : 0);
  }
  if (s.sweepDamage > 0) {
    const net = sweepNet(ctx, s.sweepDamage);
    if (net < 4) return 0;
    score += net;
  }
  if (s.other > 0 && s.uses.length === 0) score += 0.5 * (t.sorcery ? 1 : (w === 'oppEnd' ? 1 : 0));
  return score;
}

export function bestPick(ctx: Ctx, u: TargetUse, sourceId: ObjectId | null): Pick | null {
  const min = qty(u.spec.min);
  const maxRaw = u.spec.max === 'any' ? 99 : qty(u.spec.max);
  const pool = estimatePool(ctx, u.spec, sourceId);
  if (pool.objects.length + pool.players.length < min) return null;
  const pick = chooseFrom(ctx, wantOf(u), pool, min, Math.max(min, maxRaw));
  return pick.targets.length < min ? null : pick;
}

function useScore(ctx: Ctx, s: Summary, u: TargetUse, pick: Pick, t: Timing): number {
  const w = t.window;
  if (pick.score >= LETHAL) return LETHAL;
  if (u.kind === 'counter') {
    if (w !== 'response' || pick.score < COUNTER_WORTH) return 0; // hold counterspells for spells that matter
    if (s.unlessPay !== undefined && availableMana(ctx, payer(ctx, pick)) >= s.unlessPay) return 0; // they would just pay (CR 118.12a)
    return 200 + pick.score;
  }
  if (u.polarity === 'help') {
    if (u.kind === 'pump' || u.kind === 'grant') {
      // A temporary boost is a combat trick, or saves a creature from damage on the stack.
      return isCombatTrick(w) && pick.score >= 2 ? 100 + pick.score : 0;
    }
    if (u.kind === 'return' || u.kind === 'reanimate') return pick.score > 1 && (t.sorcery || w === 'oppEnd') ? 15 + pick.score : 0;
    if (u.kind === 'attach' || u.kind === 'counters') return (t.sorcery || isMain(w)) && pick.score > 0.5 ? 20 + pick.score : 0;
    return pick.score > 0 && (t.sorcery || w === 'oppEnd' || isMain(w)) ? 3 + pick.score : 0;
  }
  // Harm: aimed at the opponent's best thing.
  const hitsObject = pick.targets.some((x) => x.kind === 'object');
  if (!hitsObject) {
    // Only players: burn to the face, discard. Instants wait for the end step.
    if (pick.score <= 0) return 0;
    if (t.sorcery) return 5 + pick.score;
    return w === 'oppEnd' && pick.score >= (t.repeatable ? 0.1 : 2.5) ? 5 + pick.score : 0;
  }
  if (t.sorcery) return pick.score >= 2.5 ? 30 + pick.score : 0;
  if (w === 'oppAttack') {
    // Prefer the attackers: removal is best spent on a creature that is about to hit. M12-6: with several opponents, about to hit the bot (CR 506.2).
    const hitsMe = (a: { defendingPlayer: string }): boolean => !multi(ctx) || a.defendingPlayer === ctx.me;
    const attacking = pick.targets.some((x) => x.kind === 'object' && ctx.view.combat?.attackers.some((a) => a.id === x.id && hitsMe(a)));
    return attacking && pick.score >= 3 ? 40 + pick.score : 0;
  }
  const threshold = HARM_THRESHOLD[w];
  if (threshold === undefined) return 0;
  // A full hand at the end of the opponent's turn: use it rather than discard it.
  const relaxed = w === 'oppEnd' && hand(ctx, ctx.me).length >= 7 ? 0.5 : threshold;
  return pick.score >= relaxed ? 25 + pick.score : 0;
}

/** Net value of a board sweep: the opponent's creatures it kills minus the bot's own (CR 704.5g; Infinity = destroy all). */
export function sweepNet(ctx: Ctx, damage: number): number {
  const dies = (id: string): boolean => !kw(ctx, id, 'indestructible') && (damage === Infinity || lethalDamage(ctx, id) <= damage);
  const sum = (ids: string[]): number => ids.filter(dies).reduce((n, id) => n + value(ctx, id), 0);
  // M12-6 (A9): with several opponents, every opponent's creatures it kills
  const theirs = multi(ctx) ? ctx.opps.flatMap((p) => creatures(ctx, p)) : creatures(ctx, ctx.opp);
  return sum(theirs) - sum(creatures(ctx, ctx.me)) * 1.2;
}

/**
 * M12-6 (A8): who would pay an "unless" cost of a counterspell (CR 118.12a): two-player, the opponent; with several opponents, the controller of the
 * targeted spell, or the opponent with the most mana when the bot can't tell.
 */
function payer(ctx: Ctx, pick: Pick): PlayerId {
  if (!multi(ctx)) return ctx.opp;
  for (const t of pick.targets) {
    const c = t.kind === 'object' ? controller(ctx, t.id) : null;
    if (c !== null && ctx.opps.includes(c)) return c;
  }
  return [...ctx.opps].sort((a, b) => availableMana(ctx, b) - availableMana(ctx, a))[0]!;
}

export const isCreatureId = (ctx: Ctx, id: ObjectId): boolean => isType(ctx, id, 'Creature');
