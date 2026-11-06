/**
 * edh-d-37 (Commander lane lands) ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms).
 *  - "that player had another land enter the battlefield under their control this turn" (Tunnel Ignus, Confounding Conundrum; CR 603.4, 305.1, 400.7): the history of this turn
 *    holds at least two lands entering under the control of the player an earlier part of the ability named (the land that caused the trigger and another one: the rulings
 *    of both cards count lands that entered at the same time, and lands that have left since). The player is the anaphor "that player", which the trigger lowering resolves to
 *    the player of the event; it stays unresolved (the ability manual) anywhere else. CR cites are from memory (no rules/cr in a cloud session), listed as unverified.
 */
import type { Condition } from '../../types/ability';
import { EACH_LAND_TYPE_AND_EACH_COLOR } from '../../model/edhd37';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_HAD_ANOTHER_LAND_ENTER = P('had another land enter the battlefield under their control this turn');

/** The player an earlier part of the ability named (an anaphor the lowering resolves); never "you" or a group. */
function namedPlayers(ctx: HoleCtx, pos: number): { end: number; value: Record<string, unknown>; flags?: string[] }[] {
  const out: { end: number; value: Record<string, unknown>; flags?: string[] }[] = [];
  for (const p of ctx.call('Player', pos)) {
    const v = p.value as Record<string, unknown> | null;
    if (v !== null && typeof v === 'object' && '$anaphor' in v) out.push({ end: p.end, value: v, ...(p.flags !== undefined && p.flags.length > 0 ? { flags: [...p.flags] } : {}) });
  }
  return out;
}

export function edhd37CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const p of namedPlayers(ctx, pos)) {
    const e = phraseAt(ctx, p.end, W_HAD_ANOTHER_LAND_ENTER);
    if (e < 0) continue;
    const value: Condition = {
      cond: 'compare',
      left: { q: 'happenedPlayers', of: p.value as never, event: { ev: 'zoneChange', to: 'battlefield', subject: { types: ['Land'], controller: 'you' } }, scope: 'turn', times: { op: '>=', n: 2 } },
      op: '>=', right: 1,
    };
    out.push({ end: e, value, ...(p.flags !== undefined ? { flags: p.flags } : {}) });
  }
  return out;
}

const W_A_LAND_OF_EACH_AND_A_CREATURE_OF_EACH = P('you control a land of each basic land type and a creature of each color');

/**
 * "you control a land of each basic land type and a creature of each color" (Coalition Victory; CR 305.6, 105.1, 104.2b): each of the five basic land types is a subtype of a land
 * you control and each of the five colors is a color of a creature you control (one permanent may count for several). Exactly those words.
 */
export function edhd37EachTypeColorCondAt(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_A_LAND_OF_EACH_AND_A_CREATURE_OF_EACH);
  return e < 0 ? [] : [{ end: e, value: EACH_LAND_TYPE_AND_EACH_COLOR }];
}
