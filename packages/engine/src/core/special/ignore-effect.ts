/**
 * edh-next-143: the "pay to ignore this effect" special action (CR 116.2d; Leonin Arbiter: "Players can't search libraries. Any player may pay {2} for that player to ignore this
 * effect until end of turn.", rulings 2011-01-01).
 *
 * "Some effects from static abilities allow a player to take an action to ignore the effect from that ability for a duration. Doing so is a special action. A player can take such an
 * action any time they have priority." (CR 116.2d). Listed (core/legal.ts) for the player with priority, once for each object on the battlefield whose functioning static restriction
 * has `ignoreFor` (RestrictionDef.ignoreFor) and whose effect that player has not already paid to ignore this turn, while the cost can be paid now. The action names that object:
 * `{type:'special', kind:'ignoreEffect', object}`. Performing it pays the cost (cancellable, CR 733.1) and records the player for that object and turn (`GameState.ignoredEffects`,
 * read by statics/hooks.ts#restrictionHits): only that player ignores it (ruling: "that enables only them"), every library, as many times as they search that turn; each object is paid
 * for separately (ruling: "a player must pay {2} for each one"), and a new object is a new one (CR 400.7).
 *
 * The payment is performed by effects/handlers/ignore-effect-ops.ts, which installs itself here when it loads (as core/special/companion.ts).
 */
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { ruleContext } from '../../statics/rule-sources';
import { ignoringNow } from '../../statics/hooks';
import { IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** What performs the action (installed by effects/handlers/ignore-effect-ops.ts). */
export interface IgnoreEffectImpl {
  payable(s: GameState, player: PlayerId, cost: CostDef): boolean;
  perform(g: Game, player: PlayerId, source: ObjectId, cost: CostDef): void;
}
let impl: IgnoreEffectImpl | null = null;
export function installIgnoreEffect(f: IgnoreEffectImpl | null): void {
  impl = f;
}

/** The objects whose effect `player` may pay to ignore now, with the cost; none when the game has no such effect. Pure. */
export function ignorableSources(s: GameState, player: PlayerId): { source: ObjectId; cost: CostDef; name: string }[] {
  if (impl === null) return []; // fail closed
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: { source: ObjectId; cost: CostDef; name: string }[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'restrict' || e.ignoreFor === undefined || src.source === null || s.objects[src.source]?.zone !== 'battlefield') continue;
    if (out.some((x) => x.source === src.source) || ignoringNow(s, src.source, player)) continue;
    if (!impl.payable(s, player, e.ignoreFor)) continue;
    out.push({ source: src.source, cost: e.ignoreFor, name: src.name });
  }
  return out;
}

/** CR 116.2d: record that `player` ignores the effect of `source` for the rest of this turn (an entry of an earlier turn has ended and is dropped). */
export function recordIgnored(g: Game, source: ObjectId, player: PlayerId): void {
  const turn = g.s.turn.number;
  g.s.ignoredEffects = [...(g.s.ignoredEffects ?? []).filter((x) => x.turn === turn), { source, player, turn }];
}

export const IGNORE_EFFECT_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'ignoreEffect',
    list: (g, player) => ignorableSources(g.s, player).map((x) => ({ object: x.source, label: `Pay to ignore ${x.name}'s effect until end of turn`, cost: x.cost })),
    perform: (g, action) => {
      const hit = action.object === undefined ? undefined : ignorableSources(g.s, action.player).find((x) => x.source === action.object);
      if (hit === undefined) throw new IllegalAction('No effect of that object can be ignored by paying now (CR 116.2d).', ['CR 116.1', 'CR 116.2d']);
      impl!.perform(g, action.player, hit.source, hit.cost);
    },
  },
];
