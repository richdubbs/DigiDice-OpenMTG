/**
 * pc-counters-3 (precon lane pc-counters): quantities about the creature that died, read in a dies trigger ("put X +1/+1 counters on target creature you control, where
 * X is the power of the creature that died", CR 603.10a, 700.4, 608.2h). The statistic is the dying creature's as it last existed on the battlefield (last known
 * information); the anaphora pass binds "the creature that died" to the trigger's subject (the mention's verbs include `died`, lower/scope.ts#roleObject). CR cites
 * from memory, unverified.
 */
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';

const STATS: [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('the power of'), 'power'], [P('the toughness of'), 'toughness'], [P('the mana value of'), 'manaValue']];
const W_CREATURE_THAT_DIED = P('the creature that died');

/** "the power of the creature that died", "the toughness of ...", "the mana value of ...". */
export function pcc3QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const [words, stat] of STATS) {
    const s = phraseAt(ctx, pos, words);
    if (s < 0) continue;
    const e = phraseAt(ctx, s, W_CREATURE_THAT_DIED);
    if (e >= 0) out.push({ end: e, value: { q: 'stat', stat, of: anaphorObj({ sort: 'object', number: 'singular', head: 'creature', participle: 'died', text: 'the creature that died' }) } });
  }
  return out;
}
