/**
 * Finding the ability model behind a card, a spell on the stack or an ability on the stack (CR 113, 601.2, 602.2, 603.3), as the view shows it.
 */
import { findAbility, type AbilityDef, type CardDef, type EffectProgram, type ObjectId, type TargetChoice } from '@openmtg/engine';
import { modePrograms, programOf, summarize, type Summary } from './intent';
import type { Ctx } from './context';

/** The spell ability of a card face (an instant's or sorcery's effect, CR 113.3a). */
export function spellAbilityOf(def: CardDef | undefined, face: number): AbilityDef | undefined {
  return def?.faces[face]?.abilities.find((a) => a.kind === 'spell' || (a.kind === 'manual' && a.shape === 'spell'));
}

/** The ability definition of a spell or ability on the stack. */
export function stackAbility(ctx: Ctx, id: ObjectId): AbilityDef | undefined {
  const o = ctx.view.objects[id];
  const info = o?.stack;
  if (!o || !info) return undefined;
  if (info.kind === 'spell') return spellAbilityOf(ctx.view.defs[o.defId], info.face ?? 0);
  if (info.inline) return info.inline;
  const ref = info.abilityRef;
  if (!ref) return undefined;
  if (ref.source === 'printed' && ref.index >= 0) {
    const def = ctx.view.defs[o.defId] ?? (info.sourceId ? ctx.view.defs[ctx.view.objects[info.sourceId]?.defId ?? ''] : undefined);
    const a = def?.faces[ref.face]?.abilities[ref.index];
    if (a) return a;
  }
  if (info.sourceId && ref.key !== undefined && ctx.view.objects[info.sourceId]) {
    try { return findAbility(ctx.state, info.sourceId, ref.key)?.def; } catch { return undefined; }
  }
  return undefined;
}

/** The effect program of a stack object, and the programs of its modes. */
export function stackPrograms(ctx: Ctx, id: ObjectId): EffectProgram[] {
  const p = programOf(stackAbility(ctx, id));
  return p ? [p, ...modePrograms(p)] : [];
}

/** What a stack object does, summarized over its program and the modes that were chosen (all modes when none are recorded yet). */
export function stackSummary(ctx: Ctx, id: ObjectId): Summary {
  const p = programOf(stackAbility(ctx, id));
  const x = ctx.view.objects[id]?.stack?.x ?? 0;
  const s = summarize(p, x);
  const modes = ctx.view.objects[id]?.stack?.modes;
  modePrograms(p).forEach((mp, i) => {
    if (modes && !modes.includes(i)) return;
    const m = summarize(mp, x);
    s.uses.push(...m.uses);
    s.draws += m.draws; s.eachDraws += m.eachDraws; s.mayDraws += m.mayDraws;
    s.tokens += m.tokens; s.lifeGain += m.lifeGain; s.oppDamage += m.oppDamage; s.other += m.other;
    s.sweepDamage = Math.max(s.sweepDamage, m.sweepDamage);
    s.manual ||= m.manual;
  });
  return s;
}

/** Damage the opponent's spells and abilities on the stack will deal to this object (CR 608.2). */
export function incomingDamage(ctx: Ctx, id: ObjectId): number {
  let n = 0;
  for (const sid of ctx.view.zones.stack) {
    const o = ctx.view.objects[sid];
    if (!o?.stack || o.controller === ctx.me) continue;
    const s = stackSummary(ctx, sid);
    for (const u of s.uses) {
      const chosen = chosenTargets(ctx, sid, u.spec.id);
      if (!chosen.some((t) => t.kind === 'object' && t.id === id)) continue;
      if (u.kind === 'damage') n += u.amount;
      if (u.kind === 'debuff') n += -u.amount;
      if (u.kind === 'destroy' || u.kind === 'exile') n += 1000;
    }
  }
  return n;
}

/** The targets chosen for one target spec of a stack object (CR 601.2c, 602.2b, 603.3d). */
export function chosenTargets(ctx: Ctx, sid: ObjectId, specId: string): TargetChoice[] {
  const idx = specIndex(ctx, sid, specId);
  return idx >= 0 ? ctx.view.objects[sid]?.stack?.targets[idx] ?? [] : [];
}

/** Index of a target spec among the specs of a stack object's programs (the order `StackInfo.targets` uses). */
function specIndex(ctx: Ctx, sid: ObjectId, specId: string): number {
  const specs = stackPrograms(ctx, sid).flatMap((p) => p.targets);
  const modes = ctx.view.objects[sid]?.stack?.modes;
  const p = programOf(stackAbility(ctx, sid));
  if (p?.modes && modes) {
    // CR 700.2: the targets of the chosen modes follow the main program's, in mode order.
    const ordered = [...p.targets, ...modes.flatMap((m) => p.modes!.options[m]?.program.targets ?? [])];
    return ordered.findIndex((t) => t.id === specId);
  }
  return specs.findIndex((t) => t.id === specId);
}
