/**
 * Builders for the WP2 review-fix tests (test/m5/render/*.test.ts): small ability JSON constructors and the two checks every test uses.
 * The gate (CR-cited tests) is asked "does this JSON pass against this Oracle wording", so each case is one statement about what the renderer prints.
 */
import { expect } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern, ObjectFilter, ObjRef, PlayerRef, StaticEffect, TargetSpec } from '../../../src/types/ability';
import { renderAbility, renderGate } from '../../../src/index';

export const you = { ref: 'you' } as const;
export const self = { ref: 'self' } as const;
export const t = (id: string): { ref: 'target'; id: string } => ({ ref: 'target', id });
export const bound = (name: string): ObjRef => ({ ref: 'bound', name });
export const draw = (count = 1, who: PlayerRef = you): EffectStep => ({ op: 'draw', who, count });
export const mana = (n: number) => [{ kind: 'generic' as const, amount: n }];
export const objTarget = (id: string, filter: ObjectFilter = { types: ['Creature'] }, extra: Partial<TargetSpec> = {}): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: '', filter, ...extra });
export const playerTarget = (id: string): TargetSpec => ({ id, kind: 'player', min: 1, max: 1, text: '' });
export const spell = (steps: EffectStep[], targets: TargetSpec[] = []): AbilityDef => ({ kind: 'spell', text: '', effect: { targets, steps } });
export const trig = (on: EventPattern[], steps: EffectStep[], extra: Record<string, unknown> = {}, targets: TargetSpec[] = []): AbilityDef =>
  ({ kind: 'triggered', text: '', trigger: { on, ...(extra.batch === true ? { batch: true } : {}), ...(extra.wholeBatch === true ? { wholeBatch: true } : {}) }, effect: { targets, steps }, ...(extra.interveningIf ? { interveningIf: extra.interveningIf } : {}) }) as AbilityDef;
export const statics = (effects: StaticEffect[]): AbilityDef => ({ kind: 'static', text: '', effects });
export const effectStep = (effects: StaticEffect[], duration: { d: string } & Record<string, unknown>): EffectStep => ({ op: 'effect', effects, duration } as EffectStep);

export const CTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
export type Ctx = { selfNames: string[]; selfTypes?: string[] };

export const passes = (def: AbilityDef, text: string, ctx: Ctx = CTX): boolean => renderGate(def, [text], ctx).ok;
export const display = (def: AbilityDef, ctx: Ctx = CTX): string => renderAbility(def, ctx).join(' ');

export function accepts(def: AbilityDef, text: string, ctx: Ctx = CTX): void {
  const r = renderGate(def, [text], ctx);
  expect(r.ok, `should accept: ${text}\nrendered: ${r.rendered}`).toBe(true);
}
export function rejects(def: AbilityDef, text: string, ctx: Ctx = CTX): void {
  const r = renderGate(def, [text], ctx);
  expect(r.ok, `should reject: ${text}\nrendered: ${r.rendered}`).toBe(false);
}
