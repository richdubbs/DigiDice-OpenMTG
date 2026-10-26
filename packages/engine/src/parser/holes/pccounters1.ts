/**
 * pc-counters-1 (precon lane pc-counters): quantities that a counter instruction counts, read where a template wrote "for each" in front of the Qty hole ("put a
 * soul counter on ~ for each player who lost life this turn", CR 122.1, 119.3, 608.2h) and the same counts after "the number of". CR cites from memory, unverified.
 */
import type { PlayerRef } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_NUMBER_OF = P('the number of');
const W_OPPONENT_LOST_LIFE = P('opponent who lost life this turn');
const W_PLAYER_LOST_LIFE = P('player who lost life this turn');
const W_OPPONENTS_LOST_LIFE = P('opponents who lost life this turn');
const W_PLAYERS_LOST_LIFE = P('players who lost life this turn');

/**
 * The players who lost life this turn (CR 119.3, 120.3a; damage included: `countPlayers.lostLifeThisTurn`, each player's `turnStats.lifeLost`), counted from the
 * players of the controller's game: "for each player who lost life this turn" (every player, you too), "for each opponent who lost life this turn", and the plural
 * after "the number of". Weak (design 6.3 rule 2): std-mkm's template "investigate for each opponent who lost life this turn" keeps its sentence.
 */
export function pcc1QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const forEach = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
  const nOf = phraseAt(ctx, pos, W_NUMBER_OF);
  const start = forEach ? pos : nOf;
  if (start < 0) return out;
  const readings: [string[], PlayerRef][] = forEach
    ? [[W_OPPONENT_LOST_LIFE, { ref: 'each', who: 'opponent' }], [W_PLAYER_LOST_LIFE, { ref: 'each', who: 'player' }]]
    : [[W_OPPONENTS_LOST_LIFE, { ref: 'each', who: 'opponent' }], [W_PLAYERS_LOST_LIFE, { ref: 'each', who: 'player' }]];
  for (const [words, of] of readings) {
    const e = phraseAt(ctx, start, words);
    if (e >= 0) out.push({ end: e, value: { q: 'countPlayers', of, lostLifeThisTurn: true }, weak: 1 });
  }
  return out;
}
