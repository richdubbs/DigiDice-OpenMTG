/**
 * R1 (M6-7a), M6-7: the combat requirements of static abilities and resolved effects (CR 508.1d, 509.1c), collected from the same functioning rule effects
 * the restrictions come from (statics/rule-sources.ts: static abilities the objects have now, CR 611.3a, and resolved effects in `continuousEffects`,
 * CR 611.2).
 *
 * A requirement is a `RestrictionDef` with `mode: 'mustIfAble'` and one of the combat actions:
 *   attack     "~ attacks each combat if able", "target creature attacks this turn if able"            (CR 508.1d)
 *   block      "~ blocks each combat if able", "target creature blocks this turn if able"              (CR 509.1c)
 *   beBlocked  "~ must be blocked if able"                (CR 509.1c: a requirement on the defending player's creatures as a group, obeyed by any blocker)
 * Its `subject` names the creature(s) it is about, relative to its source ("enchanted creature", "creatures you control"); `when` limits it ("as long as ...").
 *
 * M6-7 (design m6 3.9): `other` names the other creature of the action, matched by the statics' filter evaluator (statics/rule-match.ts) against the
 * objects the declaration could pair the subject with (`others`):
 *   attack     what it must attack: a planeswalker or a battle matching `other` (a player never matches an object filter, so "attacks that player" is not this);
 *   block      the attacker it must block: "blocks target creature this turn if able" (Hunt Down), and Lure's "All creatures able to block enchanted creature
 *              do so." (one requirement per creature that could block, CR 509.1c; never the plain `beBlocked`, which one blocker obeys);
 *   beBlocked  the blockers it must be blocked by ("must be blocked by a Dalek if able"): obeyed by one blocker matching it.
 * The hit carries the matching objects as `among`; a requirement whose `among` is empty can't be obeyed and is not returned (CR 508.1d, 509.1c count only
 * requirements that can be obeyed).
 *
 * What this module can't judge is never read as "does not apply" and never as "applies" (a wrong rejection): it is returned with `unenforced` set, and the
 * declaration code logs it for the players to settle by hand. The capability walker keeps such cards manual anyway (`feature:restrict.max`; an `other` or a
 * `when` it can't evaluate needs an `rfilter:` or `rcond:` capability that is not advertised), so only resolved effects built by hand or a future source can
 * reach that path.
 *
 * The legality of a whole declaration (the maximum number of obeyed requirements, CR 508.1d, 509.1c) is rules/requirements.ts.
 */
import type { RestrictionDef } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { GameState } from '../types/state';
import { evalCondition, playersOf } from './match';
import { objectMatches, ruleFilterEvaluable, staticallyEvaluable } from './rule-match';
import { numOf } from './live';
import { cxOf, refIncludes, ruleContext, staticGoaders, staticGoadPresent, type RuleSource } from './rule-sources';

/** The combat actions a requirement can be about (CR 508.1d, 509.1c). */
export type RequirementAction = 'attack' | 'block' | 'beBlocked';
export const REQUIREMENT_ACTIONS: readonly RequirementAction[] = ['attack', 'block', 'beBlocked'];
/** M6-12: the actions whose requirement may name a player (`otherPlayer`): "attacks that opponent this turn if able" (encore, CR 702.141a). */
export const REQUIREMENT_PLAYER_ACTIONS: readonly RequirementAction[] = ['attack'];

/** One requirement on one creature. */
export interface RequirementHit {
  action: RequirementAction;
  /** The creature it is about: the attacker (attack, beBlocked) or the potential blocker (block). */
  subject: ObjectId;
  /** Stable within a state: the source's order (statics/rule-sources.ts) and the subject. */
  key: string;
  sourceName: string;
  /** The text of the static ability, or '' for a resolved effect. */
  text: string;
  /**
   * M6-7: the objects of `others` that match the requirement's `other` (what it must attack, the attacker it must block, the creatures it must be blocked
   * by); absent when it has no `other` (anything obeys it). Never empty.
   */
  among?: ObjectId[];
  /** Set when part of it can't be evaluated (the declaration is not checked against it; the players settle it by hand). */
  unenforced?: string;
}

// Cloud C3: a static goad (`goad`) is a designation, not one requirement: `goadHits` makes its two requirements per goader
const isRequirement = (e: { s: string }, action: RequirementAction): e is RestrictionDef =>
  e.s === 'restrict' && (e as RestrictionDef).mode === 'mustIfAble' && (e as RestrictionDef).action === action && (e as RestrictionDef).goad !== true;

/**
 * M6-7: a resolved requirement that lasts "this turn" ("target creature attacks this turn if able", Hunt Down) is enforced in the turn's first combat
 * phase only. With an additional combat phase (CR 500.8) it is left to the players (`unenforced`): whether it still binds a creature that already obeyed it
 * in an earlier combat is not modeled, so the engine neither forces nor waives it.
 */
function thisTurnInLaterCombat(s: GameState, src: RuleSource): boolean {
  if ((s.turn.combats ?? 0) <= 1 || src.order[1] !== 1) return false; // order[1] = 1: a resolved effect (statics/rule-sources.ts)
  const rec = s.continuousEffects.find((c) => c.timestamp === src.order[0] && numOf(c.id) === src.order[2]);
  return rec === undefined || rec.duration.d === 'endOfTurn'; // not found: fail safe (left to the players)
}

/** Why the engine can't enforce this requirement, or undefined. */
function unenforcedWhy(r: RestrictionDef): string | undefined {
  if (r.other !== undefined && !ruleFilterEvaluable(r.other)) return "the creature it names can't be evaluated";
  // M6-12: a named player is read from a resolved effect (the player it fixed); any other reference has no reading here
  // r5-static (CR 102.3, 508.1d): or "a player other than you", read as each opponent of the effect's controller ("you", CR 109.5), who stay the same players
  // for the effect's duration (a player who left can't be attacked and is dropped below)
  const opponents = r.otherPlayer !== undefined && r.otherPlayer.ref === 'each' && 'who' in r.otherPlayer && r.otherPlayer.who === 'opponent' && Object.keys(r.otherPlayer).length === 2;
  if (r.otherPlayer !== undefined && (!(REQUIREMENT_PLAYER_ACTIONS as readonly string[]).includes(r.action) || (r.otherPlayer.ref !== 'fixed' && !opponents))) return "the player it names can't be evaluated";
  if (r.max !== undefined) return 'it has a limit';
  if (r.when !== undefined && !staticallyEvaluable(r.when)) return "its condition can't be evaluated";
  return undefined;
}

/**
 * The requirements of `action` that apply right now to each of `subjects` (CR 508.1d, 509.1c), in the order of their sources (timestamp order, CR 613.7).
 * A requirement whose `when` is false does not apply. `others`: the objects a requirement's `other` is matched against (the defenders that are objects for
 * attack, the attackers for block, the potential blockers for beBlocked); a requirement with `other` that matches none of them is not returned.
 */
export function requirementHits(s: GameState, action: RequirementAction, subjects: readonly ObjectId[], others: readonly ObjectId[] = []): RequirementHit[] {
  // M12-3: goad's requirements come after the rule effects' (their order is the creatures', CR 701.15b); they need no rule source on the battlefield
  return [...sourceHits(s, action, subjects, others), ...(action === 'attack' ? goadHits(s, subjects) : [])];
}

/**
 * M12-3 (m12 design D14), CR 701.15b-c: the two requirements of each goader of a goaded creature: "attacks each combat if able" (anything obeys it) and
 * "attacks a player other than <the goader> if able" (`among`: the players still in the game other than the goader and the creature's controller; a
 * planeswalker or a battle is not a player, so attacking one obeys only the first). Several goaders: each their own pair (CR 701.15c), so with two goaders
 * a creature that can attack a third player must attack that player (it obeys all four), and one that can attack only the goaders attacks one of them (it
 * obeys three); none of this is a restriction (CR 508.1d: only the number obeyed counts). A requirement no defender of the creature could obey is dropped
 * by rules/requirements.ts (CR 508.1d). Read from `GameObject.goaded` (written by effects/handlers/goad.ts, ended by core/durations.ts), never from a rule
 * source, so it needs no static ability on the battlefield. Nothing in a two-player game without a goad card has `goaded` (m12 design D16).
 *
 * Cloud C3 (batch 3): and from the static goads ("enchanted creature is goaded", `RestrictionDef.goad`; statics/rule-sources.ts#staticGoaders), whose goader is
 * the controller of the Aura, Equipment or permanent that has the ability (CR 109.5) for as long as it applies (CR 611.3a). The goaders of both kinds are one
 * list, the goad action's first, each player once: a creature goaded by the same player twice has one pair of requirements (CR 701.15d), by two players two
 * pairs (CR 701.15c). The keys of the goad action's entries are as before.
 */
function goadHits(s: GameState, subjects: readonly ObjectId[]): RequirementHit[] {
  const out: RequirementHit[] = [];
  const ctx = staticGoadPresent(s) ? ruleContext(s) : null; // Cloud C3: the rule effects once for all the subjects
  for (const id of subjects) {
    const o = s.objects[id];
    if (!o || o.zone !== 'battlefield' || o.phasedOut) continue;
    const stored = (o.goaded ?? []).map((x) => x.by);
    const goaders = [...stored, ...(ctx ? staticGoaders(ctx.view, ctx.sources, id) : []).filter((p) => !stored.includes(p))];
    if (goaders.length === 0) continue;
    const name = s.defs[o.defId]?.name ?? id;
    goaders.forEach((by, n) => {
      const goader = s.players.find((p) => p.id === by)?.name ?? by;
      const sourceName = `${goader}'s goad`;
      out.push({ action: 'attack', subject: id, key: `goad.${n}.${by}.each:${id}`, sourceName, text: `${name} is goaded by ${goader}: it attacks each combat if able (CR 701.15b).` });
      // CR 802.2, 800.4a: the players still in the game (a player who left can't be attacked), never the goader or the creature's own controller
      const among = s.players.filter((p) => !p.hasLost && p.id !== by && p.id !== o.controller).map((p) => p.id);
      if (among.length === 0) return; // CR 508.1d: a requirement that can't be obeyed is not counted
      out.push({ action: 'attack', subject: id, key: `goad.${n}.${by}.other:${id}`, sourceName, text: `${name} is goaded by ${goader}: it attacks a player other than ${goader} if able (CR 701.15b).`, among });
    });
  }
  return out;
}

/** The requirements of the functioning rule effects (statics/rule-sources.ts). */
function sourceHits(s: GameState, action: RequirementAction, subjects: readonly ObjectId[], others: readonly ObjectId[]): RequirementHit[] {
  const ctx = ruleContext(s);
  if (!ctx || subjects.length === 0) return [];
  const out: RequirementHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (!isRequirement(e, action)) continue;
    const cx = cxOf(ctx, src);
    const why = unenforcedWhy(e) ?? (thisTurnInLaterCombat(s, src) ? 'it lasts this turn and this is not the first combat of the turn' : undefined);
    if (why === undefined && e.when !== undefined && !evalCondition(cx, e.when)) continue; // "as long as ..." (CR 611.3a)
    for (const id of subjects) {
      if (!refIncludes(cx, e.subject, id)) continue;
      let among: ObjectId[] | undefined;
      if (e.other !== undefined && why === undefined) {
        // the other creature of the action (M6-7): an object only; never the subject itself (a creature does not attack or block itself)
        among = others.filter((o) => o !== id && objectMatches(cx, o, e.other!) === true);
      }
      if (e.otherPlayer !== undefined && why === undefined) {
        // M6-12: the player it must attack (CR 508.1d: "attacks that opponent"), one still in the game (CR 800.4a: a player who left can't be attacked)
        among = [...(among ?? []), ...playersOf(cx, e.otherPlayer).filter((p) => s.players.some((x) => x.id === p && !x.hasLost))];
      }
      if (among !== undefined && among.length === 0) continue; // CR 508.1d, 509.1c: a requirement that can't be obeyed is not counted
      out.push({
        action, subject: id, key: `${src.order.join('.')}:${id}`, sourceName: src.name, text: src.text,
        ...(among !== undefined ? { among } : {}), ...(why !== undefined ? { unenforced: why } : {}),
      });
    }
  }
  return out;
}
