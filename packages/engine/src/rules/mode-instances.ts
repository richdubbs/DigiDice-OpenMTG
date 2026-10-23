/**
 * std-blb (CR 700.2d, 115.3): the chosen modes of a modal program as INSTANCES. A mode chosen more than once ("You may choose the same mode more than once.") is
 * that many separate modes, and each instance of the word "target" in it is its own target (CR 115.3: the same object may be chosen for each, or another).
 * The first instance is the mode's program itself; the k-th (k >= 2) has every target id the mode declares renamed `<id>~<k>`, in its specs (`id`,
 * `distinctFrom`) and in every reference to them (`{ref: 'target', id}`, `{q: 'targetCount', id}`), so the targets announced for each instance are kept apart
 * (design 3.6: the stack stores one list per spec id). References to the targets of other modes or of the program itself are left alone.
 *
 * The instances are in printed order: the order in which modes are announced and resolved (CR 700.2d, 608.2c): actions/announce.ts#effectivePrograms and
 * effects/run.ts#flattenProgram both use this, so `StackInfo.targets[i]` belongs to the i-th spec of the same list. Pure.
 */
import type { EffectProgram, ModeSpec } from '../types/ability';

export interface ModeInstance {
  /** The mode's index in `ModeSpec.options`. */
  index: number;
  option: ModeSpec['options'][number];
  /** The mode's program, its target ids renamed for every instance after the first. */
  program: EffectProgram;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `program` with the target ids it declares renamed `<id>~<k>` (deep copy of what changes; the rest is shared). */
function renamed(program: EffectProgram, k: number): EffectProgram {
  const own = new Set(program.targets.map((t) => t.id));
  if (own.size === 0) return program;
  const rn = (id: string): string => (own.has(id) ? `${id}~${k}` : id);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isRec(v)) return v;
    const out: Rec = {};
    for (const [key, x] of Object.entries(v)) out[key] = walk(x);
    if ((v['ref'] === 'target' || v['q'] === 'targetCount') && typeof v['id'] === 'string') out['id'] = rn(v['id']);
    return out;
  };
  return {
    ...(walk(program) as EffectProgram),
    targets: program.targets.map((t) => ({ ...(walk(t) as typeof t), id: rn(t.id), ...(t.distinctFrom ? { distinctFrom: t.distinctFrom.map(rn) } : {}) })),
  };
}

/** The instances of the chosen modes `modes` (indices into `p.modes.options`, any order, repeats allowed), in printed order; undefined for a missing mode. */
export function modeInstances(p: EffectProgram, modes: readonly number[] | undefined): (ModeInstance | undefined)[] {
  if (!p.modes) return [];
  const count = new Map<number, number>();
  return [...(modes ?? [])].sort((a, b) => a - b).map((m) => {
    const option = p.modes!.options[m];
    if (option === undefined) return undefined;
    const k = (count.get(m) ?? 0) + 1;
    count.set(m, k);
    return { index: m, option, program: k === 1 ? option.program : renamed(option.program, k) };
  });
}
