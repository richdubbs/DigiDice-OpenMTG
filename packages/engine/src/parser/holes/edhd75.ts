/**
 * edh-d-75 (Commander lane attack-requirements, concept round, template code edhd75): readings of the `Qty` hole.
 *  - "for each creature goaded this way", "the number of creatures goaded this way", "the total power of creatures goaded this way" (CR 701.15a, 608.2c; Kaima, the Fractured Calm; Havoc Eater):
 *    the creatures the ONE goad instruction before it acted on (the set it binds, ruling 2022-02-18: locked in when it resolves). A number anaphor with the participle `goaded` and the head
 *    `creature`: the quantities pass (parser/lower/quantities.ts) binds it to the ONE goad step before it and reads the set that step bound (`count`, or the `sum` of the power), else the
 *    sentence stays manual (design 6.4).
 */
import type { Alt, HoleCtx } from './core';
import { P, anaphorQty, phraseAt } from './core';

const W_GOADED_THIS_WAY = P('goaded this way');
const W_NUMBER_OF = P('the number of');
const W_TOTAL_POWER_OF = P('the total power of');
const W_CREATURE = [P('creature'), P('creatures')];

export function edhd75QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const emit = (start: number, number: 'singular' | 'plural', text: string): void => {
    for (const noun of W_CREATURE) {
      const n = phraseAt(ctx, start, noun);
      if (n < 0 || (noun[0] === 'creature') !== (number === 'singular')) continue;
      const end = phraseAt(ctx, n, W_GOADED_THIS_WAY);
      if (end >= 0) out.push({ end, value: anaphorQty({ sort: 'number', number, participle: 'goaded', head: 'creature', text }) });
    }
  };
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') emit(pos, 'singular', 'creature goaded this way');
  const n = phraseAt(ctx, pos, W_NUMBER_OF);
  if (n >= 0) emit(n, 'plural', 'the number of creatures goaded this way');
  const t = phraseAt(ctx, pos, W_TOTAL_POWER_OF);
  if (t >= 0) emit(t, 'plural', 'the total power of creatures goaded this way');
  return out;
}
