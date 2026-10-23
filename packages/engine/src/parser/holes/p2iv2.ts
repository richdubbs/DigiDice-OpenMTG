/**
 * p2-intervening-2 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms) for intervening "if" clauses (CR 603.4), second round of the lane
 * p2-intervening (the first round's readings are parser/holes/p2iv1.ts, queued on its own branch). Each gives a value the engine already evaluates:
 *  - "this creature is enchanted" (CR 303.4);
 *  - "you didn't attack with a creature this turn" (CR 508.1);
 *  - "that player didn't cast a spell this turn" (CR 601.2i);
 *  - "that creature's power is greater than this creature's" (CR 208.1: "power" left unsaid the second time);
 *  - "it didn't have decayed" (the object as it last existed, CR 608.2h);
 *  - "all nonland permanents you control are white" (CR 105.2: none of them is of another color or colorless);
 *  - "you control no permanents other than this enchantment and have no cards in hand" (CR 402.1);
 *  - "it's the first time +1/+1 counters have been put on that permanent this turn" (CR 122.6; r5-trig's `firstTime` with a kind of counter);
 *  - "a +1/+1 counter was put on a permanent under your control this turn" (CR 122.6);
 *  - "it dealt combat damage to a player this turn", "4 or more damage was dealt to it this turn" (the turn's history of the source itself, CR 120.1, 510.2; "it" is the
 *    source: parser/lower/ability.ts#resolveCondAnaphors keeps the reading only when `$self` names it, so in a dies trigger the object as it last existed).
 */
import type { Condition, NumberCmp, ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, mergeFilter, phraseAt } from './core';
import { featureAt, npAlts } from './filter';

const exists = (filter: ObjectFilter): Condition => ({ cond: 'exists', of: { ref: 'each', filter } });
const compare = (left: Quantity, op: NumberCmp['op'], right: Quantity): Condition => ({ cond: 'compare', left, op, right });
const flagsOf = (f: readonly string[] | undefined): { flags?: string[] } => (f !== undefined && f.length > 0 ? { flags: [...f] } : {});
const isAnaphor = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && '$anaphor' in v;
const it = (): never => anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as never;

const W_IS_ENCHANTED = P('is enchanted');
const W_DIDNT_ATTACK_WITH_A_CREATURE = [P("you didn't attack with a creature this turn"), P('you did not attack with a creature this turn')];
const W_DIDNT_CAST_A_SPELL = [P("didn't cast a spell this turn"), P('did not cast a spell this turn')];
const W_POWER_GREATER_THAN = P("'s power is greater than");
const W_DIDNT_HAVE = [P("it didn't have"), P('it did not have')];
const W_ALL = P('all');
const W_ARE = P('are');
const W_NO_PERMANENTS_OTHER_THAN = P('you control no permanents other than');
const W_AND_HAVE_NO_CARDS_IN_HAND = P('and have no cards in hand');
const W_FIRST_TIME = [P("it's the first time"), P('it is the first time')];
const W_COUNTERS_HAVE_BEEN_PUT_ON = P('counters have been put on');
const W_THIS_TURN = P('this turn');
const W_A = P('a');
const W_COUNTER_PUT_ON_YOUR_PERMANENT = P('counter was put on a permanent under your control this turn');

/** "this creature is enchanted": an Aura is attached to the object itself. */
function selfEnchanted(ctx: HoleCtx, pos: number, out: Alt[]): void {
  if (ctx.toks[pos]?.kind !== 'SELF') return;
  const e = phraseAt(ctx, pos + 1, W_IS_ENCHANTED);
  if (e >= 0) out.push({ end: e, value: { cond: 'matches', object: { ref: 'self' }, filter: { enchanted: true } } });
}

/** "you didn't attack with a creature this turn"; "that player didn't cast a spell this turn" (the player an earlier part of the ability named). */
function notThisTurn(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const w of W_DIDNT_ATTACK_WITH_A_CREATURE) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'happened', event: { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' } }, scope: 'turn' } } as Condition });
  }
  for (const p of ctx.call('Player', pos)) {
    if (!isAnaphor(p.value)) continue;
    for (const w of W_DIDNT_CAST_A_SPELL) {
      const e = phraseAt(ctx, p.end, w);
      if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: p.value as never }, scope: 'turn' } } as Condition, ...flagsOf(p.flags) });
    }
  }
}

/** "that creature's power is greater than this creature's": the object named before against the source, power to power. */
function powerAgainstSelf(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const o of ctx.call('Obj', pos)) {
    if (!isAnaphor(o.value)) continue;
    const g = phraseAt(ctx, o.end, W_POWER_GREATER_THAN);
    if (g < 0 || ctx.toks[g]?.kind !== 'SELF' || ctx.toks[g + 1]?.norm !== "'s" || ctx.toks[g + 2]?.norm === 'power') continue;
    out.push({ end: g + 2, value: compare({ q: 'stat', stat: 'power', of: o.value as never }, '>', { q: 'stat', stat: 'power', of: { ref: 'self' } }), ...flagsOf(o.flags) });
  }
}

/** "it didn't have decayed": the object the pronoun names, as it last existed, had no such keyword (one keyword). */
function didntHave(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const w of W_DIDNT_HAVE) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) for (const f of featureAt(ctx, e, false)) {
      if (typeof f.frag.keyword !== 'string' || Object.keys(f.frag).length !== 1) continue;
      out.push({ end: f.end, value: { cond: 'not', of: { cond: 'matches', object: it(), filter: f.frag } } });
    }
  }
}

/** "all nonland permanents you control are white"; "you control no permanents other than this enchantment and have no cards in hand". */
function allAndNone(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const all = phraseAt(ctx, pos, W_ALL);
  if (all >= 0) for (const n of npAlts(ctx, all)) {
    if (n.number !== 'plural' || n.filter.controller !== 'you' || n.filter.notColors !== undefined) continue;
    const are = phraseAt(ctx, n.end, W_ARE);
    if (are >= 0) for (const c of ctx.call('Color', are)) {
      const f = mergeFilter(n.filter, { notColors: [c.value as never] });
      if (f) out.push({ end: c.end, value: { cond: 'not', of: exists(f) }, ...flagsOf(n.flags) });
    }
  }
  const np0 = phraseAt(ctx, pos, W_NO_PERMANENTS_OTHER_THAN);
  if (np0 >= 0 && ctx.toks[np0]?.kind === 'SELF') {
    const e = phraseAt(ctx, np0 + 1, W_AND_HAVE_NO_CARDS_IN_HAND);
    if (e >= 0) out.push({ end: e, value: { cond: 'all', of: [{ cond: 'not', of: exists({ other: true, controller: 'you' }) }, compare({ q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, '==', 0)] } });
  }
}

/** "it's the first time +1/+1 counters have been put on that permanent this turn"; "a +1/+1 counter was put on a permanent under your control this turn". */
function countersPut(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const w of W_FIRST_TIME) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) for (const k of ctx.call('CounterKind', e)) {
      const on = phraseAt(ctx, k.end, W_COUNTERS_HAVE_BEEN_PUT_ON);
      if (on >= 0) for (const o of ctx.call('Obj', on)) {
        if (!isAnaphor(o.value)) continue;
        const end = phraseAt(ctx, o.end, W_THIS_TURN);
        if (end >= 0) out.push({ end, value: { cond: 'firstTime', object: o.value as never, event: { ev: 'counters', change: 'put', kind: k.value as string, on: {} } } as unknown as Condition });
      }
    }
  }
  const a = phraseAt(ctx, pos, W_A);
  if (a >= 0) for (const k of ctx.call('CounterKind', a)) {
    const e = phraseAt(ctx, k.end, W_COUNTER_PUT_ON_YOUR_PERMANENT);
    if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'counters', change: 'put', kind: k.value as string, on: { controller: 'you' } }, scope: 'turn' } as Condition });
  }
}

const W_IT_DEALT_COMBAT_DAMAGE_TO_A_PLAYER = P('it dealt combat damage to a player this turn');
const W_DAMAGE_WAS_DEALT_TO_IT = P('damage was dealt to it this turn');
const W_OR_MORE = P('or more');
const W_IT_WAS_BLOCKED = P('it was blocked this turn'); // p2-intervening-4

/** "it dealt combat damage to a player this turn"; "4 or more damage was dealt to it this turn": the source's own history this turn. */
function selfDamageHistory(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const d = phraseAt(ctx, pos, W_IT_DEALT_COMBAT_DAMAGE_TO_A_PLAYER);
  if (d >= 0) out.push({ end: d, value: { cond: 'happened', event: { ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }, scope: 'turn', $self: it() } as unknown as Condition });
  const n = ctx.toks[pos]?.kind === 'NUM' ? Number(ctx.toks[pos]!.norm) : NaN;
  const more = Number.isInteger(n) && n >= 1 ? phraseAt(ctx, pos + 1, W_OR_MORE) : -1;
  const e = more >= 0 ? phraseAt(ctx, more, W_DAMAGE_WAS_DEALT_TO_IT) : -1;
  if (e >= 0) out.push({ end: e, value: { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'damage', recipient: { object: { self: true } } }, scope: 'turn', sum: 'amount' }, op: '>=', right: n, $self: it() } as unknown as Condition });
  // p2-intervening-4 (CR 509.1h, 603.10a): "it was blocked this turn": a creature was declared as a blocker of the source this turn (the `blocks` history with the
  // source as the attacker; "blocked" of the source itself, not "it blocked")
  const b = phraseAt(ctx, pos, W_IT_WAS_BLOCKED);
  if (b >= 0) out.push({ end: b, value: { cond: 'happened', event: { ev: 'blocks', attacker: { self: true } }, scope: 'turn', $self: it() } as unknown as Condition });
}

export function p2iv2CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  selfEnchanted(ctx, pos, out);
  notThisTurn(ctx, pos, out);
  powerAgainstSelf(ctx, pos, out);
  didntHave(ctx, pos, out);
  allAndNone(ctx, pos, out);
  countersPut(ctx, pos, out);
  selfDamageHistory(ctx, pos, out);
  return out;
}
