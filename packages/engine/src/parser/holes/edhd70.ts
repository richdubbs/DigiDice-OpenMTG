/**
 * edh-d-70 (lane player-counters, template code edhd70): readings of the `Qty` hole (parser/holes/qty.ts) about counters on players.
 *  - "{E} you've paid or lost this turn" (CR 107.14, 122.1; Blaster Hulk: "This spell costs {1} less to cast for each {E} you've paid or lost this turn."): the energy counters removed
 *  - "for each player who discarded a card this turn" (CR 701.9a, 122.1; Azula, Ruthless Firebender): the players whose own history of the turn holds a discard (`happenedPlayers`, each player judged alone
 *    as edhp9.ts), with "opponent" for the opponents. Weak, as edhp9's readings.
 *  - (above) the energy counters removed
 *    from you this turn added up (a payment removes them, CR 107.14; the same count as cond.ts#paidOrLostEnergy, the history's `counters` entries).
 */
import type { PlayerRef } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorQty, anyPhraseAt, phraseAt } from './core';

const W_PAID_OR_LOST_ENERGY = [P("{e} you've paid or lost this turn"), P('{e} you have paid or lost this turn')];

const NUMBERS: [string, number][] = [['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6]];

export function edhd70QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const e = anyPhraseAt(ctx, pos, W_PAID_OR_LOST_ENERGY);
    if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'counters', change: 'removed', kind: 'energy', on: { player: 'you' } }, scope: 'turn', sum: 'amount' } as never });
  }
  // "the number of opponents who have three or more poison counters", "for each opponent with three or more poison counters" (CR 122.1f; corrupted)
  const forEach = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
  const lead = forEach ? phraseAt(ctx, pos, P('opponent with')) : phraseAt(ctx, pos, P('the number of opponents who have'));
  if (lead >= 0) {
    for (const [w, n] of NUMBERS) {
      const e = phraseAt(ctx, lead, P(`${w} or more poison counters`));
      if (e >= 0) out.push({ end: e, value: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, poisonIs: { op: '>=', n } } as never });
    }
  }
  // "twice that many" (CR 107.1, 608.2h; Struggle for Project Purity: "that player gets twice that many rad counters"): two times the amount "that many" names (the unique-candidate rule resolves it)
  const twice = phraseAt(ctx, pos, P('twice that many'));
  if (twice >= 0) out.push({ end: twice, value: { q: 'math', op: '*', args: [2, anaphorQty({ sort: 'number', number: 'singular', text: 'that many' })] } as never });
  // "for each player/opponent who discarded a card this turn"
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const groups: [string, PlayerRef][] = [['player', { ref: 'each', who: 'player' }], ['opponent', { ref: 'each', who: 'opponent' }]];
    for (const [noun, of] of groups) {
      const e = anyPhraseAt(ctx, pos, [P(`${noun} who discarded a card this turn`)]);
      if (e >= 0) out.push({ end: e, value: { q: 'happenedPlayers', of, event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' } as never, weak: 1 });
    }
  }
  return out;
}
