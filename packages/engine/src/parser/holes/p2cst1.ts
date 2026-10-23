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
  return out;
}
