/**
 * Cloud C7: conditions on what the instruction right before actually moved, in the `Cond` grammar (CR 608.2c, 608.2h): "a creature card was exiled this way",
 * "at least one creature card was exiled this way", "a Goblin is sacrificed this way", "a land card is discarded this way", "you exiled a land card this way",
 * "you put an artifact onto the battlefield this way", "you don't put a card onto the battlefield this way".
 *
 * The value is the `did` of "if you do" with the description of the objects (`which`, read as each last existed before it moved: effects/api.ts#
 * StepResult.before) and the kind of instruction (parser/holes/moved-words.ts): the destination of a move (`to`), or the marker `$op` of a sacrifice or a
 * discard. lower/conditions.ts resolves the `$step` marker to the instruction RIGHT BEFORE and insists on that kind; anything else is unresolved (manual).
 * A destroy has neither (FAST5X E17's reading: "a creature you controlled was destroyed this way" is the same value).
 */
import type { Condition, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';
import { npAlts, type NpAlt } from './filter';
import { MOVED_MARK, MOVED_OP, MOVED_TO, PASSIVE, type MovedKind } from './moved-words';

/** A description of the moved objects: one singular noun phrase (an "or" of two is one phrase too) that names no controller, owner or zone of its own. */
function plainNp(n: NpAlt, number: 'singular' | 'plural' = 'singular'): boolean {
  const f = n.filter as Record<string, unknown>;
  return n.number === number && !n.flags.some((x) => x !== 'zone-unstated') && f['controller'] === undefined && f['owner'] === undefined && f['zone'] === undefined && f[MOVED_MARK] === undefined;
}

const W_IS = [P('is'), P('was')];
const W_AT_LEAST_ONE = P('at least one');
const W_ONE_OR_MORE = P('one or more');
const W_YOU = P('you');
/** "you <verb> <np> <words>": the verb before the noun phrase, the words after it ("this way" included), the kind, and whether it is negated. */
const ACTIVE: readonly (readonly [readonly string[], readonly string[], MovedKind, boolean])[] = [
  [P('exiled'), P('this way'), 'exiled', false],
  [P('sacrificed'), P('this way'), 'sacrificed', false],
  [P('discarded'), P('this way'), 'discarded', false],
  // Cloud r3-moved (CR 603.12, 608.2c): the present tense of a reflexive trigger, "When you discard a nonland card this way, ..." (lower/conditions.ts#lowerReflexive)
  [P('discard'), P('this way'), 'discarded', false],
  [P('sacrifice'), P('this way'), 'sacrificed', false],
  [P('put'), P('onto the battlefield this way'), 'battlefield', false],
  [P("don't put"), P('onto the battlefield this way'), 'battlefield', true],
  [P('do not put'), P('onto the battlefield this way'), 'battlefield', true],
  [P("didn't put"), P('onto the battlefield this way'), 'battlefield', true],
  [P('did not put'), P('onto the battlefield this way'), 'battlefield', true],
];

/** The condition: the marker of the instruction right before, the description, and the kind (its destination, or the op of an action). */
function movedCond(which: ObjectFilter, kind: MovedKind, not: boolean, you = false): Condition {
  const to = MOVED_TO[kind];
  const op = MOVED_OP[kind];
  // Cloud C7 review: "you <verb>ed" names only what YOU moved. A player discards only cards from their own hand (CR 701.9a) and sacrifices only permanents they
  // control (CR 701.21a), so "if you discarded a card this way" after "each player discards a card" reads the cards you owned, and "if you sacrificed a creature
  // this way" after "each player sacrifices a creature" the creature you controlled as it last existed (CR 608.2h). A move names no such object, so
  // lower/conditions.ts insists that you performed it (`$actor`)
  const mine: ObjectFilter = !you ? which : kind === 'discarded' ? { ...which, owner: 'you' } : kind === 'sacrificed' ? { ...which, controller: 'you' } : which;
  return {
    cond: 'did', step: '', $step: 'previous', ...(not ? { not: true } : {}), which: mine, ...(to !== undefined ? { to } : {}), ...(op !== undefined ? { $op: op } : {}),
    ...(you && to !== undefined ? { $actor: 'you' } : {}),
  } as unknown as Condition;
}

/** Cond atoms. */
export function movedCondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // "a creature card was exiled this way", "at least one creature card was exiled this way" ("at least one" is "a": `did` asks for one or more)
  const art = ctx.toks[pos]?.norm;
  const least = phraseAt(ctx, pos, W_AT_LEAST_ONE);
  const start = least >= 0 ? least : art === 'a' || art === 'an' ? pos + 1 : -1;
  if (start >= 0) {
    for (const n of npAlts(ctx, start)) {
      if (!plainNp(n)) continue;
      for (const is of W_IS) {
        const v = phraseAt(ctx, n.end, is);
        if (v < 0) continue;
        for (const [ws, kind, adds] of PASSIVE) {
          const e = phraseAt(ctx, v, ws);
          if (e >= 0) out.push({ end: e, value: movedCond({ ...n.filter, ...adds }, kind, false) });
        }
      }
    }
  }
  // "you exiled a land card this way", "you put an artifact onto the battlefield this way", "you don't put a card onto the battlefield this way"
  const you = phraseAt(ctx, pos, W_YOU);
  if (you >= 0) {
    for (const [verb, after, kind, not] of ACTIVE) {
      const v = phraseAt(ctx, you, verb);
      if (v < 0) continue;
      const a = ctx.toks[v]?.norm;
      // std-ra (CR 603.12, 608.2c): "When you discard one or more nonland cards this way, ...": "one or more" and a plural noun phrase is the same `did` as "a"
      // and a singular one (it asks for one or more such objects); only after a positive verb ("you don't put one or more ..." is not English)
      const more = not ? -1 : phraseAt(ctx, v, W_ONE_OR_MORE);
      const start = a === 'a' || a === 'an' ? v + 1 : more;
      if (start < 0) continue;
      for (const n of npAlts(ctx, start)) {
        if (!plainNp(n, more >= 0 ? 'plural' : 'singular')) continue;
        const e = phraseAt(ctx, n.end, after);
        if (e >= 0) out.push({ end: e, value: movedCond(n.filter, kind, not, true) });
      }
    }
  }
  // std-library-3 (CR 608.2c, 608.2h): "if you exiled four or more cards this way" (Portent of Calamity): the number of such objects the ONE earlier instruction of that
  // kind moved is at least N: a count of the marked description (parser/lower/quantities.ts#movedCounts binds it to that instruction's `resultCount`, or the
  // sentence is manual); only "you" and the past tense of an exile, a sacrifice or a discard, with "N or more" and a plural description of cards
  if (you >= 0) {
    for (const [verb, kind] of COUNTED) {
      const v = phraseAt(ctx, you, verb);
      if (v < 0) continue;
      for (const q of ctx.call('Qty', v)) {
        if (typeof q.value !== 'number' || q.value < 2) continue;
        const om = phraseAt(ctx, q.end, W_OR_MORE);
        if (om < 0) continue;
        for (const n of npAlts(ctx, om)) {
          if (!plainNp(n, 'plural') || n.head !== 'card') continue;
          const e = phraseAt(ctx, n.end, W_THIS_WAY);
          if (e < 0) continue;
          const counted = { ref: 'each', filter: { ...n.filter, [MOVED_MARK]: kind } };
          out.push({ end: e, value: { cond: 'compare', left: { q: 'count', of: counted }, op: '>=', right: q.value } as unknown as Condition });
        }
      }
    }
  }
  return out;
}

const W_OR_MORE = P('or more');
/** std-library-3: "you <verb> N or more cards this way": the verbs whose result is counted, and the kind of instruction they name. */
const COUNTED: readonly (readonly [readonly string[], MovedKind])[] = [[P('exiled'), 'exiled'], [P('sacrificed'), 'sacrificed'], [P('discarded'), 'discarded']];

const W_THIS_WAY = P('this way');

/**
 * r4-moved (CR 608.2c, 608.2f, 608.2h, 701.9a): the hole `NotMoved`, "<N> <cards> this way" after "for each opponent who didn't discard" (Garruk, Veiled Butcher: "Each
 * opponent discards two cards. For each opponent who didn't discard two nonland cards this way, you draw a card."): the opponent of the iteration (the `forEach`'s
 * binding `each`) discarded fewer than N such cards in the discard right before, read as each card was before it moved (C7's `$moved` count, with the owner: a player
 * discards only cards they own, CR 701.9a). The value is the condition; lower/quantities.ts binds the count to the ONE earlier discard, or the sentence is manual.
 */
export function notMoved(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const q of ctx.call('Qty', pos)) {
    if (typeof q.value !== 'number' || q.value < 1) continue;
    for (const n of npAlts(ctx, q.end)) {
      const f = n.filter as Record<string, unknown>;
      if (n.number !== 'plural' || n.head !== 'card' || n.flags.some((x) => x !== 'zone-unstated') || f['controller'] !== undefined || f['owner'] !== undefined || f['zone'] !== undefined || f[MOVED_MARK] !== undefined) continue;
      const e = phraseAt(ctx, n.end, W_THIS_WAY);
      if (e < 0) continue;
      const counted = { ref: 'each', filter: { anyOf: [n.filter], [MOVED_MARK]: 'discarded', owner: { ref: 'bound', name: 'each' } } };
      out.push({ end: e, value: { cond: 'compare', left: { q: 'count', of: counted }, op: '<', right: q.value } as unknown as Condition });
    }
  }
  return out;
}

const W_INTO_YOUR_GRAVEYARD_THIS_WAY = P('into your graveyard this way');

/**
 * r5-moved (CR 701.25a, 608.2c, 400.7): the hole `SurveilledCard`, "a <card>" right before "into your graveyard this way" in "If you put a land card into your graveyard this
 * way, put that card into your hand" (Enlightened Confidant): one singular CARD description that names no controller, owner or zone of its own (the zone is the graveyard
 * the words say, so the noun phrase's `zone-unstated` flag goes). The value is the filter; the template reads the card the surveil right before put there (the
 * participle-only mention `surveilled` of lower/mentions.ts, a surveil 1 of yours only), so anything else leaves the sentence manual.
 */
export function surveilledCard(ctx: HoleCtx, pos: number): Alt[] {
  const art = ctx.toks[pos]?.norm;
  if (art !== 'a' && art !== 'an') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.head !== 'card' || !plainNp(n)) continue;
    if (phraseAt(ctx, n.end, W_INTO_YOUR_GRAVEYARD_THIS_WAY) < 0) continue;
    out.push({ end: n.end, value: n.filter as unknown as Alt['value'] });
  }
  return out;
}

const W_RETURNED_THIS_WAY = P('returned this way');

/**
 * r5-moved (CR 608.2c, 608.2f, 608.2h, 400.3): the hole `ControlledMoved`, "a <permanent> returned this way" after "for each opponent who controlled" (Faerie Slumber Party:
 * "Return all creatures to their owners' hands. For each opponent who controlled a creature returned this way, you create two ... tokens"): the opponent of the iteration
 * (the `forEach`'s binding `each`) controlled at least one such permanent of what the move to the hand right before moved, read as each permanent last existed on the
 * battlefield (C7's `$moved` count with `which`, the controller then). One singular description with no controller, owner or zone of its own; lower/quantities.ts binds
 * the count to the ONE earlier move to a hand, or the sentence is manual (r4-moved's `NotMoved` for a discard, the same reading).
 */
export function controlledMoved(ctx: HoleCtx, pos: number): Alt[] {
  const art = ctx.toks[pos]?.norm;
  if (art !== 'a' && art !== 'an') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos + 1)) {
    const f = n.filter as Record<string, unknown>;
    if (!plainNp(n) || f['isCard'] !== undefined || n.head === 'card') continue;
    const e = phraseAt(ctx, n.end, W_RETURNED_THIS_WAY);
    if (e < 0) continue;
    const counted = { ref: 'each', filter: { anyOf: [n.filter], [MOVED_MARK]: 'hand', controller: { ref: 'bound', name: 'each' } } };
    out.push({ end: e, value: { cond: 'compare', left: { q: 'count', of: counted }, op: '>=', right: 1 } as unknown as Condition });
  }
  return out;
}
