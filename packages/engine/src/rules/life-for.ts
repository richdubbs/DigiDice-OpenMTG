/**
 * edhc5 (CR 118.1, 119.4, 107.4f): paying 2 life for a symbol of a cost that asks for mana of a color. Two printed statics give a player this:
 *   - "For each {B} in a cost, you may pay 2 life rather than pay that mana." (K'rrik, Son of Yawgmoth): every payment of the player, whatever it is for;
 *   - "As an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {G} less to cast if you paid life this way. This effect reduces only the
 *     amount of green mana you pay." (Defiler of Vigor): the spells its filter describes, for one symbol of the color ("You may only pay the additional cost once per
 *     permanent spell", ruling of 2022-09-09). The reduction of one green mana is the same payment as paying 2 life for one {G} of the cost, and is read as that:
 *     the solver (rules/solver.ts `SolveInput.lifeFor`) offers the life for such a symbol like a Phyrexian symbol's, and the player pays no more than they would have.
 * Both are `{s:'permit', action:'spendMana', lifeFor}` of a static ability of an object (a resolved effect with this form is not read: fail closed).
 * Pure on GameState.
 */
import type { PermissionDef } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { ManaType } from '../types/mana';
import type { GameState } from '../types/state';
import { cxOf, overlayZone, refIncludes, ruleContext, type CharsView } from '../statics/rule-sources';
import { objectMatches, spellActor } from '../statics/rule-match';
import type { EvalCx } from '../statics/match';
import { charsOfObject } from './characteristics';
import { spendTarget, type SpendContext } from './sources';

/** The exact form honored: `{s:'permit', who, action:'spendMana', lifeFor, of?}` and no other field (anything more fails closed). */
export function isLifeForPermit(p: PermissionDef): boolean {
  return p.action === 'spendMana' && p.lifeFor !== undefined && p.asThough === undefined && Object.keys(p).every((k) => ['s', 'who', 'action', 'lifeFor', 'of'].includes(k));
}

/**
 * The colors `player` may pay 2 life for in the payment `spend` describes, with how many symbols of the color at most (Infinity: each), because of the static
 * abilities of objects; undefined when there is none. A permission with `of` is for spells (a spell being cast, read as the spell it is or would be, CR 601.3e, as
 * statics/play-permits.ts#staticAnyManaType does) and for no other payment; a filter the hooks can't evaluate matches nothing.
 */
export function lifeForColors(s: GameState, player: PlayerId, spend: SpendContext | undefined): ReadonlyMap<ManaType, number> | undefined {
  const ctx = ruleContext(s);
  if (!ctx) return undefined;
  let out: Map<ManaType, number> | undefined;
  let view: CharsView | undefined;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isLifeForPermit(e) || src.source === null || src.order[1] !== 0 || !refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.of !== undefined) {
      if (spend?.kind !== 'spell') continue;
      const t = spendTarget(s, player, spend);
      if (t === undefined) continue;
      view ??= ctx.view.with(overlayZone(s, spend.id, 'stack'), new Map([[spend.id, t.chars ?? charsOfObject(s, t.o)]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (objectMatches(cx, spend.id, e.of, spellActor(t.o)) !== true) continue;
    }
    const n = e.lifeFor!.once === true ? 1 : Number.POSITIVE_INFINITY;
    out ??= new Map();
    out.set(e.lifeFor!.color, Math.max(out.get(e.lifeFor!.color) ?? 0, n));
  }
  return out;
}
