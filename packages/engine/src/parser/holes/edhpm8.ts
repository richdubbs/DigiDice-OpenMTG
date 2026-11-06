/**
 * edh-perms-8 ADDITIONS (Commander lane edh-perms), CR cites from memory unless noted.
 *   - `edhpm8QtyAt`: "the number of tokens you created this turn" (CR 111.1, 603.10; Thalisse, Reverent Medium): every token the controller of the ability created this turn, counted from
 *     the turn's history (one `createToken` entry per token, a token that has left the battlefield since still counts). Nothing else about the tokens is said.
 *   - `charStat` (hole `CharStat`): the word "power" or "toughness" (CR 208.1); value the stat name (the sacrificed creature's "power", "its toughness" of Momentous Fall).
 */
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, phraseAt, wordAt } from './core';

const W_TOKENS_YOU_CREATED = P('the number of tokens you created this turn');

export function edhpm8QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_TOKENS_YOU_CREATED);
  return e >= 0 ? [{ end: e, value: { q: 'happenedCount', event: { ev: 'createToken', player: 'you' }, scope: 'turn' } }] : [];
}

export const charStat: HoleFn = (ctx, pos) => {
  const w = wordAt(ctx, pos);
  return w === 'power' || w === 'toughness' ? [{ end: pos + 1, value: w } satisfies Alt] : [];
};
