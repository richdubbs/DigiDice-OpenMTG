/**
 * A reason why something is not allowed, with rule citations. Rule checks return `Denial | null`
 * so that the same check can raise an IllegalAction (cast, activate) or silently filter an option
 * out of legalActions().
 */
import { IllegalAction } from '../core/errors';

export interface Denial {
  message: string;
  rules: string[];
  /**
   * Set only on a denial that comes from a KEYWORD RULE itself ("defender can't attack", "flying can be blocked only by flying or reach"): the permission that
   * waives it (`PermissionDef.action` `attackAsThoughNoDefender` or `blockAsThough`, with `asThough` naming the evasion keyword the permission ignores).
   * rules/hookpoints.ts drops such a denial when a provider's `permits` answers yes for the matching query, and never drops any other denial (a "can't attack"
   * effect, protection CR 702.16f): a permission changes how one rule applies, it does not override a prohibition (CR 101.2, 609.4).
   */
  waivedBy?: { action: 'attackAsThoughNoDefender' | 'blockAsThough' | 'targetAsThoughNoHexproof'; asThough?: string }; // std-rx32: targetAsThoughNoHexproof (CR 702.11b)
}

export function deny(message: string, ...rules: string[]): Denial {
  return { message, rules };
}

/** `d`, marked as the denial that the given permission waives (see `Denial.waivedBy`). */
export function waivable(d: Denial, action: NonNullable<Denial['waivedBy']>['action'], asThough?: string): Denial {
  return { ...d, waivedBy: { action, ...(asThough !== undefined ? { asThough } : {}) } };
}

/** Throw the denial as an IllegalAction (CR 733.1: the whole action is reversed). */
export function throwDenial(d: Denial): never {
  throw new IllegalAction(d.message, d.rules);
}

export function assertAllowed(d: Denial | null): void {
  if (d) throwDenial(d);
}
