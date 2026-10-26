/**
 * Overload (CR 702.96a): "You may cast this spell for its overload cost. If you do, change all instances of 'target' in its text to 'each'." The spell cast for
 * its overload cost has no targets (CR 702.96b: it is not a targeted spell, so nothing is chosen and hexproof / protection / "can't be the target" do not stop it);
 * every instruction that named a target applies to every object (or player) that the target's description fits, as the spell resolves.
 *
 * `overloadProgram` is the pure rewrite of one spell ability: each target spec becomes the `each` reference of the same filter, in the steps that named it. It
 * answers null when the program is not one it can rewrite faithfully (the engine then does not offer the overload cost: fail closed), so a spell is never
 * overloaded with a target left over or with an object where a single value was meant. Used by actions/cast.ts (announcement: no targets) and effects/run.ts
 * (resolution). CR cites written from memory in a cloud session (no rules/cr): unverified.
 */
import type { EffectProgram, EffectStep, ModeSpec, ObjRef, ObjectFilter, PlayerRef, TargetSpec } from '../types/ability';

/** The name of the alternative cost (`CostsPaid.alternative`, the cast method) that turns "target" into "each". */
export const OVERLOAD = 'overload';

/** The keys of a step under which a reference to a target names the thing the step acts on (or is acted on): the places an `each` reference is read the same way. */
const ACTED_ON_KEYS: ReadonlySet<string> = new Set(['what', 'to', 'who', 'player', 'affects', 'subject']);

type Replacement = { obj?: ObjRef; player?: PlayerRef };

/** The `each` references that stand for target spec `t` once "target" has become "each" (CR 702.96a), or null when the spec has no such reading. */
function eachFor(t: TargetSpec): Replacement | null {
  if (t.min !== 1 || t.max !== 1 || t.divide || t.groupLimit || t.distinctFrom || t.sameOwner || t.differentNames || t.perOpponent || t.perPlayer || t.chooser) return null;
  const filter: ObjectFilter = t.filter ?? {};
  switch (t.kind) {
    case 'object':
      return { obj: { ref: 'each', filter } };
    case 'spell': {
      // "each spell you don't control": the spell being resolved is the caster's, so the filter must leave the caster's spells out or it would counter itself
      const own = (filter.not as ObjectFilter | undefined)?.controller === 'you';
      return own ? { obj: { ref: 'each', filter: { ...filter, zone: 'stack', stackKind: 'spell' } } } : null;
    }
    case 'player': {
      const who = t.players?.who ?? 'any';
      return who === 'any' ? { player: { ref: 'each', who: 'player' } } : who === 'opponent' ? { player: { ref: 'each', who: 'opponent' } } : null;
    }
    default:
      return null;
  }
}

/** Rewrite the references to the targets in `node`; `failed` is set when one is in a place that is not an acted-on position (a quantity, a condition, ...). */
function rewrite(node: unknown, key: string | undefined, by: Map<string, Replacement>, state: { failed: boolean }): unknown {
  if (Array.isArray(node)) return node.map((x) => rewrite(x, key, by, state));
  if (typeof node !== 'object' || node === null) return node;
  const o = node as Record<string, unknown>;
  // an ability granted inside the spell ("gains '{T}: deals 1 damage to target creature'") has targets of its own: left as it is, and refused when it names one
  if (typeof o['kind'] === 'string' && ['activated', 'triggered', 'static', 'spell'].includes(o['kind']) && typeof o['text'] === 'string') {
    if (mentionsTarget(node) || JSON.stringify(node).includes('"targets":[{')) state.failed = true;
    return node;
  }
  if (o['op'] === 'manual') { state.failed = true; return node; } // a by-hand step would still say "target"
  if (o['ref'] === 'target' && typeof o['id'] === 'string') {
    const r = by.get(o['id']);
    if (!r) return node; // a target of another spec (not rewritten): left for the caller to refuse
    const out = key !== undefined && ACTED_ON_KEYS.has(key) ? r.obj ?? r.player : undefined;
    if (!out) { state.failed = true; return node; }
    // an object spec in a player position (or the reverse) is a different thing: refuse
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = rewrite(v, k, by, state);
  return out;
}

const mentionsTarget = (node: unknown): boolean => JSON.stringify(node).includes('"ref":"target"');

/** The program of an overloaded spell ability, or null when it can't be rewritten (no `targets` left in it, no reference to a target left in its steps). */
export function overloadProgram(p: EffectProgram): EffectProgram | null {
  const by = new Map<string, Replacement>();
  const specs: TargetSpec[] = [...p.targets];
  const collect = (m: ModeSpec | undefined): void => {
    for (const opt of m?.options ?? []) { specs.push(...opt.program.targets); collect(opt.program.modes); }
  };
  collect(p.modes);
  for (const t of specs) {
    const r = eachFor(t);
    if (!r) return null;
    by.set(t.id, r);
  }
  const state = { failed: false };
  const steps = rewrite(p.steps, undefined, by, state) as EffectStep[];
  let modes: ModeSpec | undefined;
  if (p.modes) {
    const options = p.modes.options.map((opt) => {
      const inner = overloadProgram(opt.program);
      return inner === null ? null : { ...opt, program: inner };
    });
    if (options.some((x) => x === null)) return null;
    modes = { ...p.modes, options: options as ModeSpec['options'] };
  }
  if (state.failed || mentionsTarget(steps)) return null;
  return { ...p, targets: [], ...(modes ? { modes } : {}), steps };
}

/** Does the spell (its spell abilities) offer overload at all: every spell ability can be rewritten, and at least one names a target. */
export function overloadablePrograms(programs: readonly EffectProgram[]): EffectProgram[] | null {
  if (programs.length === 0) return null; // no automated spell ability (a manual spell is resolved by hand and would still say "target")
  const out: EffectProgram[] = [];
  for (const p of programs) {
    const q = overloadProgram(p);
    if (q === null) return null;
    out.push(q);
  }
  return out;
}
