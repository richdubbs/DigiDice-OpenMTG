/**
 * edh-combat-5 (Commander lane edh-combat): the folds of its templates (parser/templates/zz-cloud/edh-combat-5.json), called from render/fold.ts#foldAt.
 *
 * `grantNoDefenderToughnessDamage` (CR 611.2a, 702.3b, 510.1a; eff.edhcb5.dur.gains.noDefender.toughnessDamage; Walking Bulwark): "Until end of turn, target
 * creature with defender gains haste, can attack as though it didn't have defender, and assigns combat damage equal to its toughness rather than its power.":
 * one lasting effect of three parts on ONE object (the grant, the attack permission of every player's attackers of it, the damage rule; the object's controller attacks, not the ability's, CR 702.3b, 508.1), said with the subject once. Only that shape.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function grantNoDefenderToughnessDamage(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.effects.length !== 3 || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const [g, p, r] = a.effects as unknown[];
  const grant = g as { s: string; mods: { layer: unknown; add?: unknown }[]; affects: ObjRef; cda?: boolean };
  const permit = p as { s: string; who: { ref: string; who?: string }; action: string; of?: { is?: ObjRef }; asThough?: unknown };
  const rule = r as { s: string; rule: string; of?: { is?: ObjRef }; onlyIf?: unknown };
  if (grant.s !== 'continuous' || grant.cda === true || grant.mods.length !== 1 || grant.mods[0]!.layer !== 6 || grant.mods[0]!.add === undefined) return null;
  if (permit.s !== 'permit' || permit.action !== 'attackAsThoughNoDefender' || permit.who.ref !== 'each' || permit.who.who !== 'player' || permit.asThough !== undefined || permit.of?.is === undefined || Object.keys(permit.of).length !== 1) return null;
  if (rule.s !== 'rule' || rule.rule !== 'combatDamageUsesToughness' || rule.onlyIf !== undefined || rule.of?.is === undefined || Object.keys(rule.of).length !== 1) return null;
  const same = JSON.stringify(grant.affects);
  if (JSON.stringify(permit.of.is) !== same || JSON.stringify(rule.of.is) !== same) return null;
  const clause = K.clause({ op: 'effect', duration: a.duration, effects: [a.effects[0]!] } as EffectStep, st);
  return { clauses: [plain(`${clause.sub}, can attack as though it didn't have defender, and assigns combat damage equal to its toughness rather than its power`, { standalone: true })], consumed: 1 };
}

export function foldEdhCb5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return grantNoDefenderToughnessDamage(list, i, st);
}
