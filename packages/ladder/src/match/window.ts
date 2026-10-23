/**
 * M15-4: the rated matcher's window rule (design 9.2, 9.3, D14) and the policy check, pure. Server only (src/match/*), though nothing here needs Node.
 *
 *   window(wait) = 'everyone'                                                   if wait ≥ everyoneAfterMs (5 minutes)
 *                = min(cap, windowStart + windowStep · floor(wait / windowEveryMs))   otherwise
 *   cap = windowCap1v1 (400) in 1v1, windowCapPod (500) in pods
 *
 * With DEFAULT_RANKED_POLICY: 0 s 100, 15 s 150, 30 s 200, ..., 90 s and later 400 in 1v1 (pods go on to 500 at 120 s), 5 minutes 'everyone'.
 */
import { DEFAULT_RANKED_POLICY, type RankedMatchPolicy } from './api';

const POLICY_FIELDS = [
  'windowStart', 'windowStep', 'windowEveryMs', 'windowCap1v1', 'windowCapPod', 'everyoneAfterMs', 'rematchGames', 'rematchRelaxMs',
  'placementMixCost', 'repeatedPairCost', 'podThreeAfterMs', 'podCandidates', 'perAddress',
] as const satisfies readonly (keyof RankedMatchPolicy)[];
/** Counts, not amounts: whole numbers. */
const WHOLE: ReadonlySet<keyof RankedMatchPolicy> = new Set(['rematchGames', 'podCandidates', 'perAddress']);

/**
 * A copy of `p` once every field is a finite number ≥ 0 (counts whole), `windowEveryMs` above 0 and `perAddress` at least 1; a RangeError naming the
 * field otherwise. The matcher keeps the copy, so a policy object changed later changes nothing.
 */
export function checkPolicy(p: Readonly<RankedMatchPolicy>): Readonly<RankedMatchPolicy> {
  if (typeof p !== 'object' || p === null) throw new RangeError('rated matcher: the policy is not an object');
  const out = {} as RankedMatchPolicy;
  for (const k of POLICY_FIELDS) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (WHOLE.has(k) && !Number.isInteger(v))) {
      throw new RangeError(`rated matcher: policy.${k} must be a finite ${WHOLE.has(k) ? 'whole ' : ''}number ≥ 0 (${String(v)})`);
    }
    out[k] = v;
  }
  if (out.windowEveryMs === 0) throw new RangeError('rated matcher: policy.windowEveryMs must be above 0');
  if (out.perAddress < 1) throw new RangeError('rated matcher: policy.perAddress must be at least 1');
  return Object.freeze(out);
}

/** The window without the 'everyone' rule: the widening steps up to the cap. A negative wait counts as 0. */
export function cappedWindow(waitMs: number, pod: boolean, p: Readonly<RankedMatchPolicy>): number {
  const steps = Math.floor(Math.max(0, waitMs) / p.windowEveryMs);
  return Math.min(pod ? p.windowCapPod : p.windowCap1v1, p.windowStart + p.windowStep * steps);
}

/**
 * The pure window rule of 9.2 and 9.3, in shown points: 'everyone' once `waitMs` reaches `everyoneAfterMs`, else the widening window up to the 1v1
 * or pod cap (a negative wait counts as 0). `p` defaults to DEFAULT_RANKED_POLICY; a bad policy or a NaN wait is a RangeError.
 */
export function rankedWindow(waitMs: number, pod: boolean, p: Readonly<RankedMatchPolicy> = DEFAULT_RANKED_POLICY): number | 'everyone' {
  if (typeof waitMs !== 'number' || Number.isNaN(waitMs)) throw new RangeError(`rankedWindow: the wait is not a number (${String(waitMs)})`);
  const policy = p === DEFAULT_RANKED_POLICY ? p : checkPolicy(p);
  if (waitMs >= policy.everyoneAfterMs) return 'everyone';
  return cappedWindow(waitMs, pod, policy);
}
