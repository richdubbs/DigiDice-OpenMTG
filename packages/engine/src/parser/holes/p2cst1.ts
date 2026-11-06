/**
 * p2-cost-statics-1 (Phase 2 lane p2-cost-statics): quantities of the turn's history that a cost reduction counts, read where a template wrote "for each" in front
 * of the Qty hole ("~ costs {1} less to cast for each spell your opponents have cast this turn", CR 601.2f, 118.7, 601.2i; "~ costs {1} less to cast for each
 * creature you attacked with this turn", CR 508.1), and the same counts after "the number of". Each is the `happenedCount` the turn's history answers
 * (rules/history.ts#countHistory: a creature that attacked in two combats is one creature you attacked with). CR cites from memory, unverified.
 */
import type { Condition, ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, cmpAt, phraseAt } from './core';
import { npAlts } from './filter';

const W_NUMBER_OF = P('the number of');
const W_SPELL_OPPONENTS_CAST = P('spell your opponents have cast this turn');
const W_SPELLS_OPPONENTS_CAST = P('spells your opponents have cast this turn');
const W_YOU_ATTACKED_WITH_THIS_TURN = P('you attacked with this turn');

/** The spells your opponents cast this turn (CR 601.2i), counted from the history relative to the controller of the ability. */
const OPPONENT_SPELLS: Quantity = { q: 'happenedCount', event: { ev: 'cast', player: 'opponent' }, scope: 'turn' };

/** Creatures of a description, nothing else said about who controls them or where they are: "creature", "Knight", "creatures with flying". */
const plainCreatures = (f: ObjectFilter): boolean => f.controller === undefined && f.owner === undefined && f.zone === undefined && f.is === undefined && (f.types ?? []).includes('Creature');

/** The quantities of this round at `pos`: after a template's "for each" (singular nouns) or after "the number of" (plural nouns). */
export function p2cst1QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const forEach = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
  const nOf = phraseAt(ctx, pos, W_NUMBER_OF);
  const start = forEach ? pos : nOf;
  if (start < 0) return out;
  const spells = phraseAt(ctx, start, forEach ? W_SPELL_OPPONENTS_CAST : W_SPELLS_OPPONENTS_CAST);
  if (spells >= 0) out.push({ end: spells, value: OPPONENT_SPELLS });
  for (const n of npAlts(ctx, start)) {
    if (n.number !== (forEach ? 'singular' : 'plural') || !plainCreatures(n.filter)) continue;
    const e = phraseAt(ctx, n.end, W_YOU_ATTACKED_WITH_THIS_TURN);
    if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'attacks', attacker: { ...n.filter, controller: 'you' } }, scope: 'turn' }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
  }
  return out;
}

const W_ARE_ATTACKING = P('are attacking');
const W_EXACTLY_ONE_CREATURE_IS_ATTACKING = P('exactly one creature is attacking');
const W_AN_OPPONENT_CAST = P('an opponent cast');
const W_SPELLS_THIS_TURN = P('spells this turn');
const W_AN_OPPONENT_GAINED_LIFE = P('an opponent gained life this turn'); // edh-c-30
const W_AN_OPPONENT_HAD = P('an opponent had'); // edh-c-30
const W_LANDS_ENTER_UNDER_THEIR = P('lands enter the battlefield under their control this turn'); // edh-c-30
const W_CREATURES_ENTER_UNDER_THEIR = P('creatures enter the battlefield under their control this turn'); // edh-c-86 (Whiplash Trap): the same reading for creatures

/**
 * p2-cost-statics-1 (CR 506.4, 508.1): how many creatures are attacking, as the traps' alternative costs say it ("If three or more creatures are attacking, you may pay
 * {U} rather than pay ~'s mana cost", "If exactly one creature is attacking, ..."; CR 118.9): the attacking creatures of every player on the battlefield as they are
 * now (the `attacking` filter), so the condition is read as the spell is announced too (actions/announce-cond.ts, `exists` and `count` over `each`). Only "N or more"
 * of a plain description of creatures and "exactly one creature".
 */
export function p2cst1CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
    for (const n of npAlts(ctx, c.end)) {
      if (n.number !== 'plural' || !plainCreatures(n.filter) || n.filter.attacking !== undefined) continue;
      const e = phraseAt(ctx, n.end, W_ARE_ATTACKING);
      if (e >= 0) out.push({ end: e, value: { cond: 'exists', of: { ref: 'each', filter: { ...n.filter, attacking: true } }, atLeast: c.cmp.value } as Condition, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  const one = phraseAt(ctx, pos, W_EXACTLY_ONE_CREATURE_IS_ATTACKING);
  if (one >= 0) out.push({ end: one, value: { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], attacking: true } } }, op: '==', right: 1 } });
  // "an opponent cast three or more spells this turn" (CR 601.2i; Mindbreak Trap): the most spells one opponent cast this turn (model/forms.ts#isOpponentSpellsPerPlayer)
  const oc = phraseAt(ctx, pos, W_AN_OPPONENT_CAST);
  if (oc >= 0) for (const c of cmpAt(ctx, oc)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
    const e = phraseAt(ctx, c.end, W_SPELLS_THIS_TURN);
    if (e >= 0) out.push({ end: e, value: { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'cast' }, scope: 'turn', per: 'player', by: 'opponent' }, op: '>=', right: c.cmp.value } });
  }
  // edh-c-30 (CR 119.3, 118.9; Needlebite Trap): "an opponent gained life this turn": a life gain by an opponent this turn (the history, read at announcement as an alternative cost's `when`)
  const og = phraseAt(ctx, pos, W_AN_OPPONENT_GAINED_LIFE);
  if (og >= 0) out.push({ end: og, value: { cond: 'happened', event: { ev: 'life', change: 'gain', player: 'opponent' }, scope: 'turn' } });
  // edh-c-30 (CR 305.1, 102.3, 118.9; Lavaball Trap): "an opponent had two or more lands enter the battlefield under their control this turn": at least one opponent, judged alone
  // (edh-players-9's `happenedPlayers`), has that many lands entering under their control in this turn's history (read at announcement: model/forms.ts#isOpponentsHappenedPlayers)
  const oh = phraseAt(ctx, pos, W_AN_OPPONENT_HAD);
  if (oh >= 0) for (const c of cmpAt(ctx, oh)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
    for (const [w, type] of [[W_LANDS_ENTER_UNDER_THEIR, 'Land'], [W_CREATURES_ENTER_UNDER_THEIR, 'Creature']] as const) {
      const e = phraseAt(ctx, c.end, w);
      if (e >= 0) out.push({ end: e, value: { cond: 'compare', left: { q: 'happenedPlayers', of: { ref: 'each', who: 'opponent' }, event: { ev: 'zoneChange', to: 'battlefield', subject: { types: [type], controller: 'you' } }, scope: 'turn', times: { op: '>=', n: c.cmp.value } }, op: '>=', right: 1 } as Condition });
    }
  }
  return out;
}
