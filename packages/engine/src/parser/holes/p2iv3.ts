/**
 * p2-intervening-3 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms) for intervening "if" clauses (CR 603.4), third round of the lane
 * p2-intervening (rounds 1 and 2 are parser/holes/p2iv1.ts and p2iv2.ts, queued on their own branches). Each gives a value the engine already evaluates:
 *  - "it's attacking the player with the most life or tied for most life" (an attack trigger of the source: it attacks a player, not a planeswalker or battle,
 *    and no player has more life than the defending player; CR 506.2, 508.1b, 119.1);
 *  - "at least three mana of the same color was spent to cast it" (adamant of any one color; CR 601.2h, 106.1);
 *  - "a permanent was put into your hand from the battlefield this turn" (CR 400.3: a card goes to its owner's hand).
 */
import type { Condition } from '../../types/ability';
import type { Color } from '../../types/mana';
import type { Alt, HoleCtx } from './core';
import { NUMBER_WORDS, P, anaphorObj, phraseAt } from './core';

const it = (): never => anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as never;
const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

const W_ATTACKING_MOST_LIFE = [P("it's attacking the player with the most life or tied for most life"), P('it is attacking the player with the most life or tied for most life')];
const W_AT_LEAST = P('at least');
const W_MANA_OF_THE_SAME_COLOR = P('mana of the same color was spent to cast it');
const W_PERMANENT_TO_YOUR_HAND = P('a permanent was put into your hand from the battlefield this turn');

/** The value of "it's attacking the player with the most life or tied for most life" (render/p2iv3.ts says it). */
export const ATTACKING_MOST_LIFE: Condition = {
  cond: 'all',
  of: [
    { cond: 'matches', object: { ref: 'self' }, filter: { attacking: { defender: 'opponent' } } },
    { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, lifeVs: { op: '>', than: { ref: 'defending' } } }, op: '==', right: 0 },
  ],
};

export function p2iv3CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_ATTACKING_MOST_LIFE) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: JSON.parse(JSON.stringify(ATTACKING_MOST_LIFE)) as Condition });
  }
  // "at least three mana of the same color was spent to cast it": at least that much of one of the five colors (`wasCast.spent`, `$self` as adamant's)
  const al = phraseAt(ctx, pos, W_AT_LEAST);
  const n = al >= 0 ? NUMBER_WORDS[ctx.toks[al]?.norm ?? ''] : undefined;
  const sc = n !== undefined && n >= 2 ? phraseAt(ctx, al + 1, W_MANA_OF_THE_SAME_COLOR) : -1;
  if (sc >= 0) out.push({ end: sc, value: { cond: 'any', of: COLORS.map((color) => ({ cond: 'wasCast', spent: { color, atLeast: n }, $self: it() })) } as unknown as Condition });
  const h = phraseAt(ctx, pos, W_PERMANENT_TO_YOUR_HAND);
  if (h >= 0) out.push({ end: h, value: { cond: 'happened', event: { ev: 'zoneChange', subject: { owner: 'you' }, from: 'battlefield', to: 'hand' }, scope: 'turn' } as Condition });
  return out;
}
