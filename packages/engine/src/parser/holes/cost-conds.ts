/**
 * Standard round 4, r4-cost: conditions of activation restrictions and cost changes ("Activate only if ...", "This spell costs {2} less to cast if ...") that
 * the Cond hole (parser/holes/cond.ts) did not read. Each is one reading with the model's existing nodes; render/cond.ts says each back.
 *
 *  - "an opponent has been dealt noncombat damage this turn": FAST5X E9's "was dealt" in the present perfect (CR 120.1a, 120.2b).
 *  - "an opponent was dealt combat damage by a legendary creature this turn": a combat damage event to an opponent whose source matched the description as it
 *    dealt the damage (CR 510.2, 120.1; rules/history.ts records the source's facts).
 *  - "a player has one or fewer cards in hand": at least one player whose hand size compares so (CR 402.1, 102.1; `countPlayers.sizeIs`).
 *  - "there are four or more permanent types among cards in your graveyard": the different permanent types (CR 110.4: artifact, battle, creature, enchantment,
 *    land, planeswalker) among the cards (`distinct permanentTypes`).
 *  - "a creature is attacking you": a creature attacking that player now (CR 506.3, 508.1; the filter's `attacking.defender`).
 *  - "a creature card was put into your graveyard from anywhere this turn": a card of the description that you own went to your graveyard this turn from any
 *    zone (CR 400.3, 404.1; a token is no card, CR 111.1).
 */
import type { Condition, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, cmpAt, mergeFilter, phraseAt } from './core';
import { npAlts } from './filter';

const W_OPP_HAS_BEEN_DEALT_NONCOMBAT = P('an opponent has been dealt noncombat damage this turn');
const W_OPP_DEALT_COMBAT_BY = P('an opponent was dealt combat damage by');
const W_THIS_TURN = P('this turn');
const W_A_PLAYER_HAS = P('a player has');
const W_CARDS_IN_HAND = [P('cards in hand'), P('card in hand')];
const W_THERE_ARE = [P('there are'), P('there is')];
const W_PERMANENT_TYPES_AMONG = P('permanent types among');
const W_IS_ATTACKING_YOU = P('is attacking you');
const W_PUT_INTO_YOUR_GRAVEYARD = P('was put into your graveyard from anywhere this turn');

const flagsOf = (f: readonly string[] | undefined): { flags?: string[] } => (f !== undefined && f.length > 0 ? { flags: [...f] } : {});

/** The conditions above, each read in one way. */
export function costCondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const nd = phraseAt(ctx, pos, W_OPP_HAS_BEEN_DEALT_NONCOMBAT);
  if (nd >= 0) out.push({ end: nd, value: { cond: 'happened', event: { ev: 'damage', combat: false, recipient: { player: 'opponent' } }, scope: 'turn' } satisfies Condition });
  const by = phraseAt(ctx, pos, W_OPP_DEALT_COMBAT_BY);
  const art = by >= 0 ? ctx.toks[by]?.norm : undefined;
  if (art === 'a' || art === 'an') for (const n of npAlts(ctx, by + 1)) {
    // a permanent's description only: no zone, owner or controller (the facts of the source answer types, colors, supertypes, subtypes and the like)
    if (n.number !== 'singular' || n.filter.zone !== undefined || n.filter.owner !== undefined || n.filter.controller !== undefined || n.filter.isCard !== undefined) continue;
    if (Object.keys(n.filter).length === 0) continue;
    const th = phraseAt(ctx, n.end, W_THIS_TURN);
    if (th >= 0) out.push({ end: th, value: { cond: 'happened', event: { ev: 'damage', combat: true, recipient: { player: 'opponent' }, source: n.filter }, scope: 'turn' } satisfies Condition, ...flagsOf(n.flags) });
  }
  const ph = phraseAt(ctx, pos, W_A_PLAYER_HAS);
  if (ph >= 0) for (const c of cmpAt(ctx, ph)) {
    if (typeof c.cmp.value !== 'number' || (c.cmp.op !== '<=' && c.cmp.op !== '>=')) continue;
    for (const w of W_CARDS_IN_HAND) {
      const e = phraseAt(ctx, c.end, w);
      if (e < 0) continue;
      const players = { q: 'countPlayers' as const, of: { ref: 'each' as const, who: 'player' as const }, sizeIs: { zone: 'hand' as const, op: c.cmp.op, n: c.cmp.value } };
      out.push({ end: e, value: { cond: 'compare', left: players, op: '>=', right: 1 } satisfies Condition });
    }
  }
  for (const w of W_THERE_ARE) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=') continue;
      const among = phraseAt(ctx, c.end, W_PERMANENT_TYPES_AMONG);
      if (among >= 0) for (const n of npAlts(ctx, among)) {
        if (n.number !== 'plural') continue;
        out.push({ end: n.end, value: { cond: 'compare', left: { q: 'distinct', what: 'permanentTypes', among: { ref: 'each', filter: n.filter } }, op: '>=', right: c.cmp.value } satisfies Condition, ...flagsOf(n.flags) });
      }
    }
  }
  const t = ctx.toks[pos]?.norm;
  if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular') continue;
    const att = phraseAt(ctx, n.end, W_IS_ATTACKING_YOU);
    if (att >= 0 && n.head !== 'mods' && n.filter.attacking === undefined && n.filter.zone === undefined && n.filter.isCard === undefined) {
      const f = mergeFilter(n.filter, { attacking: { defender: 'you' } } as ObjectFilter);
      if (f) out.push({ end: att, value: { cond: 'exists', of: { ref: 'each', filter: f } } satisfies Condition, ...flagsOf(n.flags) });
    }
    const put = phraseAt(ctx, n.end, W_PUT_INTO_YOUR_GRAVEYARD);
    const g = n.filter;
    if (put >= 0 && n.head === 'card' && g.zone === undefined && g.owner === undefined && g.controller === undefined && Object.keys(g).some((k) => k !== 'isCard')) {
      out.push({ end: put, value: { cond: 'happened', event: { ev: 'zoneChange', subject: { ...g, isCard: true, owner: 'you' }, to: 'graveyard' }, scope: 'turn' } satisfies Condition, ...flagsOf(n.flags) });
    }
  }
  return out;
}
