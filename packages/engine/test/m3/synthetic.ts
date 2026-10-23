/**
 * Synthetic card definitions for rules the real cards cannot exercise yet (targets, modes, kicker,
 * flashback, non-mana activated abilities). Their abilities are hand-built AbilityDefs, i.e. what
 * the milestone 5 compiler will produce.
 */
import { compileCard, type AbilityDef, type CardDef, type CostDef, type EffectProgram, type TargetSpec, type ZoneKind } from '../../src/index';
import { schemaIssues } from '../../src/model';

interface Spec {
  name: string;
  cost?: string;
  type: string;
  pt?: [string, string];
  abilities: AbilityDef[];
  flash?: boolean;
}

export function synth(spec: Spec): CardDef {
  return compileCard(
    {
      name: spec.name, layout: 'normal', type_line: spec.type, oracle_text: '(synthetic)',
      ...(spec.cost !== undefined ? { mana_cost: spec.cost } : {}),
      ...(spec.pt ? { power: spec.pt[0], toughness: spec.pt[1] } : {}),
    },
    () => ({ abilities: spec.abilities, unsupported: [] }),
  );
}

export const targetPlayer: TargetSpec = { id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' };
export const targetCreature: TargetSpec = { id: 't1', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
export const targetOpponentCreature: TargetSpec = { id: 't2', kind: 'object', filter: { types: ['Creature'], controller: 'opponent' }, min: 1, max: 1, text: 'target creature an opponent controls' };

/**
 * Milestone 3/4 tests build placeholder steps such as `{ op: 'destroy' }` that the engine never runs (it asks the controller to resolve them by hand).
 * The final model (types/ability.ts) has a closed step union, so these placeholders are typed through this one cast. Since the milestone 5 handlers merged
 * (W2), a placeholder that is not a well-formed `EffectStep` keeps its fields but gets an op no handler has (`legacy.<op>`), so it is still resolved by hand
 * exactly as before instead of being run with missing fields; a well-formed step passes through unchanged and is run by the engine.
 */
export type LegacyStep = { op: string; [k: string]: unknown };
export const legacySteps = (steps: readonly LegacyStep[]): EffectProgram['steps'] =>
  steps.map((st) => (schemaIssues(st, 'EffectStep').length === 0 ? st : { ...st, op: `legacy.${st.op}` })) as unknown as EffectProgram['steps'];

export const spellAbility = (text: string, targets: TargetSpec[] = [], steps: readonly LegacyStep[] = []): AbilityDef => ({ kind: 'spell', text, effect: { targets, steps: legacySteps(steps) } });

/** `oncePerTurn` and a single `zone` are the milestone 3 spellings of `limit: {per: 'turn', max: 1}` and `zone: [zone]`. */
type ActivatedExtra = Omit<Partial<Extract<AbilityDef, { kind: 'activated' }>>, 'zone'> & { oncePerTurn?: boolean; zone?: ZoneKind | ZoneKind[] };

export const activated = (text: string, cost: CostDef, targets: TargetSpec[] = [], extra: ActivatedExtra = {}, steps: readonly LegacyStep[] = []): AbilityDef => {
  const { oncePerTurn, zone, ...rest } = extra;
  return {
    kind: 'activated', text, cost, effect: { targets, steps: legacySteps(steps) }, ...rest,
    ...(oncePerTurn ? { limit: { per: 'turn' as const, max: 1 } } : {}),
    ...(zone !== undefined ? { zone: Array.isArray(zone) ? zone : [zone] } : {}),
  };
};

export const keyword = (keywordName: string, cost?: CostDef): AbilityDef => ({ kind: 'keyword', text: keywordName, keyword: keywordName, ...(cost ? { cost } : {}) });

/** An instant that targets a creature and has no effect the engine runs. */
export const poke = (): CardDef => synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('Target creature.', [targetCreature])] });

/** An instant whose effect the engine cannot run: the controller resolves it by hand. */
export const smite = (): CardDef => synth({ name: 'Test Smite', cost: '{B}', type: 'Instant', abilities: [spellAbility('Destroy target creature.', [targetCreature], [{ op: 'destroy' }])] });

/** A sorcery with three modes: choose one or two. */
export const charm = (): CardDef => synth({
  name: 'Test Charm', cost: '{1}{U}', type: 'Sorcery',
  abilities: [{
    kind: 'spell', text: 'Choose one or two -',
    effect: {
      targets: [], steps: [],
      modes: {
        min: 1, max: 2,
        options: [
          { text: 'Target player draws.', program: { targets: [targetPlayer], steps: [] } },
          { text: 'Target creature.', program: { targets: [targetCreature], steps: [] } },
          { text: 'Nothing happens.', program: { targets: [], steps: [] } },
        ],
      },
    },
  }],
});

export const freeSpell = (): CardDef => synth({ name: 'Test Free', type: 'Sorcery', abilities: [spellAbility('Nothing.')] });
