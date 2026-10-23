/**
 * Does an overlay make a unit better than the parser's reading of it (design 11.1: LLM output overlays a unit the parser left manual; it must never make
 * play worse)? Pure.
 *
 * A unit gains when the overlay keeps every part the parser understood (trigger, each cost part such as a loyalty cost (CR 606.4), each target, each
 * automated step, keyword and static abilities) and adds to them, or has fewer manual nodes. An overlay that is only manual abilities, or that drops a
 * part the parser understood (a loyalty or sacrifice cost, a target), gives no gain: the parser keeps the unit.
 */
import { manualNodes, type AbilityDef } from '@openmtg/engine';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** The understood parts of abilities (stored or compiled form), counted by kind. */
export function understoodParts(defs: readonly unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  const program = (p: unknown): void => {
    if (!isRec(p)) return;
    const targets = Array.isArray(p['targets']) ? p['targets'].length : 0;
    for (let i = 0; i < targets; i++) bump(out, 'target');
    for (const st of Array.isArray(p['steps']) ? p['steps'] : []) if (isRec(st) && st['op'] !== 'manual') bump(out, 'step');
    const modes = p['modes'];
    if (isRec(modes) && Array.isArray(modes['options'])) for (const o of modes['options']) if (isRec(o)) program(o['program']);
  };
  for (const d of defs) {
    if (!isRec(d)) continue;
    if (d['kind'] === 'keyword' || d['kind'] === 'static') bump(out, String(d['kind']));
    if (d['trigger'] !== undefined) bump(out, 'trigger');
    const cost = d['cost'];
    if (isRec(cost)) {
      for (const [k, v] of Object.entries(cost)) {
        if (v === undefined) continue;
        if (k !== 'other' || !Array.isArray(v)) bump(out, `cost.${k}`);
        else for (const part of v) if (!isRec(part) || part['kind'] !== 'manual') bump(out, 'cost.other');
      }
    }
    program(d['effect']);
  }
  return out;
}

/** Manual nodes of abilities; a node only a missing engine capability made manual (`needs-engine`, design 10.1) does not count. */
export function manualCount(defs: readonly unknown[]): number {
  let n = 0;
  for (const d of defs) {
    try {
      n += manualNodes(d as AbilityDef).filter((m) => !/^needs-engine\b/.test(m.reason)).length;
    } catch {
      n += 1;
    }
  }
  return n;
}

export type UnitGain = { gain: true } | { gain: false; why: string };

/** Compare the overlay's abilities for one unit with the parser's abilities for the same lines. */
export function unitGain(parser: readonly unknown[], overlay: readonly unknown[]): UnitGain {
  const p = understoodParts(parser);
  const o = understoodParts(overlay);
  for (const [k, n] of p) if ((o.get(k) ?? 0) < n) return { gain: false, why: `it drops the ${k} the parser understood` };
  if (overlay.every((a) => isRec(a) && a['kind'] === 'manual') && o.size === 0) return { gain: false, why: 'every ability for the line is manual' };
  const more = [...o].some(([k, n]) => n > (p.get(k) ?? 0));
  if (!more && manualCount(overlay) >= manualCount(parser)) return { gain: false, why: 'it automates nothing the parser did not already understand' };
  return { gain: true };
}
