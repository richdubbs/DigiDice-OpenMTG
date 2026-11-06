/**
 * Pass 9, sequencing (design 6.5): "then", "and", commas and sentence boundaries produce steps in textual order (CR 608.2c: instructions are followed in
 * the order written; "then" orders, it never makes a step depend on the success of the previous one, that is "if you do", CR 608.2d). Owner: WP17.
 *
 * A sentence no template understood becomes ONE `manual` step at its place (design 6.6), so the steps before and after it still run automatically; the
 * taint pass (parser/taint.ts) then decides whether the manual island spreads. A rider that was folded (pass 4) and a "pay" follow-up that was folded
 * (pass 7) contribute nothing of their own. The modal options are sequenced separately (CR 700.2d: chosen modes run in printed order, then `steps`).
 */
import type { EffectStep } from '../../types/ability';
import type { Draft, LoweredProgram, LoweredSeq, Unit } from './types';
import { clone } from './util';

/** The manual step of a sentence (design 6.6 "an effect sentence in an otherwise understood ability"). */
export function manualStep(u: Unit): EffectStep {
  return { op: 'manual', text: u.text, reason: u.manual?.reason ?? 'not understood' };
}

/**
 * edh-next-91 (CR 608.2c; Tempt with Immortality): two sentences whose templates bind the same name ("Return a creature card ... Each opponent may return a creature card ...",
 * both `as: "returned"`) each mean their own binding: the later sentence's binding and the references after it get a fresh name, so a name is bound once on a path (the lint
 * refuses two). Walks each step in written order: a read of a name means the latest binding of it, a binding of a name an earlier step bound is renamed. `cur` maps each name to its latest form.
 */
function renameRebound(step: unknown, cur: Map<string, string>, taken: Set<string>): void {
  const BINDERS = new Set(['as', 'chosen', 'other', 'cantAs', 'hostAs']);
  const fresh = (x: string): string => {
    let k = 2;
    while (taken.has(`${x}${k}`)) k++;
    taken.add(`${x}${k}`);
    return `${x}${k}`;
  };
  // only a binder that always runs: the step itself, or a step directly in the body of a `repeat` (its `do`); a name bound inside an `if`, an option or an `else` may be bound again on the
  // path that does not run it (the lint reads that as bound once), and a process repeat binds the same name again in its copy on purpose
  const walk = (v: unknown, direct: boolean): void => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, direct)); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    for (const key of Object.keys(o)) {
      const x = o[key];
      if (typeof x === 'string' && BINDERS.has(key) && typeof o['op'] === 'string') {
        if (cur.has(x) && o['op'] === 'chooseObjects' && direct) { const f = fresh(x); cur.set(x, f); o[key] = f; } else if (direct && !cur.has(x)) { cur.set(x, x); taken.add(x); }
      } else if (typeof x === 'string' && (key === 'name' || key === 'step' || key === 'gather')) {
        if (cur.has(x)) o[key] = cur.get(x)!;
      } else if (key === 'capture' && Array.isArray(x)) {
        o[key] = x.map((c) => (typeof c === 'string' && cur.has(c) ? cur.get(c)! : c));
      } else walk(x, o['op'] === 'repeat' && key === 'do' && o['process'] !== true && o['again'] !== true && o['optional'] !== true);
    }
  };
  walk(step, true);
}

export function sequenceUnits(units: readonly Unit[]): LoweredSeq {
  const steps: EffectStep[] = [];
  const stepUnits: number[] = [];
  const cur = new Map<string, string>();
  const taken = new Set<string>();
  units.forEach((u, i) => {
    if (u.manual) { steps.push(manualStep(u)); stepUnits.push(i); return; }
    for (const s of u.steps) {
      const c = clone(s) as unknown as EffectStep;
      renameRebound(c, cur, taken);
      steps.push(c);
      stepUnits.push(i);
    }
  });
  return { steps, units: [...units], stepUnits };
}

/** Pass 9. */
export function lowerSequencing(d: Draft): LoweredProgram {
  return {
    targets: clone(d.targets),
    main: sequenceUnits(d.units),
    ...(d.modes ? { modes: { min: d.modes.min, max: d.modes.max, options: d.modes.options.map((o) => ({ text: o.text, ...(o.cost ? { cost: o.cost } : {}), ...sequenceUnits(o.units) })) } } : {}),
  };
}
