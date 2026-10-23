/**
 * Helpers for the WP7 tests (announcement, casting, costs): synthetic spells whose abilities are hand-built `AbilityDef`s (what the milestone 5 compiler produces),
 * and a driver that answers decisions in order.
 */
import type { AbilityDef, CostDef, EffectProgram, ModeSpec, StaticEffect, TargetSpec } from '../../../src/index';
import type { DecisionAnswer, GameState } from '../../../src/index';
import { act, answer, find, synth } from '../helpers';

export const spec = (over: Partial<TargetSpec> = {}): TargetSpec => ({ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature', ...over });

export const spellDef = (text: string, targets: TargetSpec[], modes?: ModeSpec): AbilityDef => ({
  kind: 'spell', text, effect: { targets, steps: [], ...(modes ? { modes } : {}) } as EffectProgram,
});

/** An instant or sorcery with one spell ability. */
export const spell = (name: string, cost: string, targets: TargetSpec[], opts: { type?: string; modes?: ModeSpec; abilities?: AbilityDef[] } = {}) =>
  synth({ name, cost, type: opts.type ?? 'Instant', abilities: [...(opts.abilities ?? []), spellDef('x', targets, opts.modes)] });

/** A static ability with the given effects (the shape the keyword library expands kicker, flashback, ... into, design 7.2). */
export const staticAbility = (text: string, effects: StaticEffect[], zone: ('stack' | 'hand' | 'graveyard' | 'battlefield')[] = ['stack']): AbilityDef => ({ kind: 'static', text, effects, zone });

export const additionalCost = (name: string | undefined, cost: CostDef, over: { optional?: boolean; repeatable?: boolean } = {}): StaticEffect => ({
  s: 'additionalCost', cost, ...(name !== undefined ? { name } : {}), ...(over.optional ? { optional: true } : {}), ...(over.repeatable ? { repeatable: true } : {}),
});

export const alternativeCost = (name: string, cost: CostDef, over: { from?: 'graveyard' | 'hand' | 'exile'; when?: Extract<StaticEffect, { s: 'alternativeCost' }>['when'] } = {}): StaticEffect => ({
  s: 'alternativeCost', name, cost, ...(over.from ? { from: over.from } : {}), ...(over.when ? { when: over.when } : {}),
});

export const mana = (text: string): NonNullable<CostDef['mana']> => {
  const out: NonNullable<CostDef['mana']> = [];
  for (const m of text.matchAll(/\{([^}]+)\}/g)) {
    const t = m[1]!;
    out.push(/^\d+$/.test(t) ? { kind: 'generic', amount: Number(t) } : t === 'X' ? { kind: 'variable', name: 'X' } : { kind: 'colored', color: t as 'W' | 'U' | 'B' | 'R' | 'G' });
  }
  return out;
};

/** Answer the pending decisions in order, paying automatically; stops at the first decision that is not given, at priority, or when nothing is pending. */
export function drive(s: GameState, answers: DecisionAnswer[]): GameState {
  let t = s;
  let i = 0;
  while (t.pending && t.pending.kind !== 'priority') {
    if (t.pending.kind === 'payCost' && (answers[i] === undefined || answers[i]!.kind !== 'payCost')) { t = answer(t, { kind: 'payCost', auto: true }); continue; }
    const a = answers[i++];
    if (!a) break;
    t = answer(t, a);
  }
  return t;
}

export const castCard = (s: GameState, name: string, opts: { player?: 'p1' | 'p2'; method?: string; face?: number; zone?: 'hand' | 'graveyard' | 'exile' } = {}): GameState =>
  act(s, { type: 'cast', player: opts.player ?? 'p1', card: find(s, name, opts.zone ?? 'hand'), ...(opts.method ? { method: opts.method } : {}), ...(opts.face !== undefined ? { face: opts.face } : {}) });

export const objectTarget = (id: string) => ({ kind: 'object' as const, id });
export const playerTarget = (id: string) => ({ kind: 'player' as const, id });
