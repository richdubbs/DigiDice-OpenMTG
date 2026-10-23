/**
 * M11-0 (docs/design/m11-commander.md 4.3-4.6): the decision, event and ability-model contracts of milestone 11, their capability names, renderers and
 * validators. M11-1 turned the capabilities on (test/m11/rules/*; the M11-0 pin absent-m11-1.test.ts is deleted, the M6 pattern).
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_MODEL_VERSION, capabilitiesOf, ENGINE_CAPABILITIES, IllegalAnswer, missingCapabilities, renderAbility, renderGate, validateAbility,
  type AbilityDef, type CommanderZoneDecision, type DecisionAnswer, type GameEvent, type Quantity,
} from '../../../src/index';
import { DECISION_KINDS, validateAnswer } from '../../../src/core/validate';
import { evalQty } from '../../../src/effects/eval';
import { evaluable, STATIC_QUANTITY_KINDS } from '../../../src/statics/match';
import { FILTER_STATUS_FIELDS } from '../../../src/rules/registries';
import { cloneState } from '../../../src/util/clone';
import { startedGame } from '../../helpers';
import { ctxOn } from '../../m5/eval/helpers';

/** Command Tower and Arcane Signet (CR 903.4, 702.124c). */
const COMMAND_TOWER: AbilityDef = {
  kind: 'activated', text: "{T}: Add one mana of any color in your commander's color identity.", cost: { tap: true }, isMana: true,
  effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'commanderIdentity', count: 1 } }] },
};
/** Commander's Insignia (CR 903.8). */
const INSIGNIA: AbilityDef = {
  kind: 'static', text: "Creatures you control get +1/+1 for each time you've cast your commander from the command zone this game.",
  effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: { q: 'commanderCasts' }, toughness: { q: 'commanderCasts' } }] }],
};
/** A lieutenant ability ("As long as you control your commander, ~ gets +2/+2."; CR 903.3d). */
const LIEUTENANT: AbilityDef = {
  kind: 'static', text: 'As long as you control your commander, ~ gets +2/+2.',
  condition: { cond: 'exists', of: { ref: 'each', filter: { commander: true, owner: 'you', controller: 'you' } } },
  effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }],
};
/** An eminence ability (an ability that functions in the command zone and on the battlefield, CR 113.6). */
const EMINENCE: AbilityDef = {
  kind: 'triggered', text: 'Eminence — Whenever you cast a Dragon spell, if ~ is in the command zone or on the battlefield, you gain 1 life.', zone: ['command', 'battlefield'],
  trigger: { on: [{ ev: 'cast', player: 'you', spell: { subtypes: ['Dragon'] } }] },
  effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] },
};

describe('M11-0: the 903.9 decision (CR 903.9a-b, 704.6d)', () => {
  const s = startedGame();
  const d: CommanderZoneDecision = { id: 'd1', kind: 'commanderZone', player: 'p1', prompt: 'Put it into the command zone?', object: 'o1', card: 'c1', rule: '903.9b', zone: 'hand' };

  it('is a decision kind with a capability name and an answer the validator checks', () => {
    expect(DECISION_KINDS).toContain('commanderZone');
    expect(ENGINE_CAPABILITIES.has('decision:commanderZone')).toBe(true);
    expect(() => validateAnswer(s, d, { kind: 'commanderZone', command: true })).not.toThrow();
    expect(() => validateAnswer(s, d, { kind: 'commanderZone', command: false })).not.toThrow();
    expect(() => validateAnswer(s, d, { kind: 'commanderZone', command: 'yes' } as unknown as DecisionAnswer)).toThrow(IllegalAnswer);
    expect(() => validateAnswer(s, d, { kind: 'yesNo', yes: true })).toThrow(IllegalAnswer);
  });

  it('the commanderDamage event carries the commander card and the running total (CR 903.10a)', () => {
    const e: GameEvent = { type: 'commanderDamage', player: 'p2', commander: 'c7', source: 'o9', amount: 5, total: 21 };
    expect(e.type).toBe('commanderDamage');
  });
});

describe('M11-0: the Commander nodes of the ability model (m11 design 4.5)', () => {
  it('ABILITY_MODEL_VERSION is 3 (4 since M12-1, m12 design 4.3): a pack that uses them is refused by an older engine', () => {
    expect(ABILITY_MODEL_VERSION).toBe(4);
  });

  it('each node is valid model JSON (schema regenerated) and renders to its Oracle wording (the render gate)', () => {
    const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
    for (const a of [COMMAND_TOWER, INSIGNIA, LIEUTENANT]) expect(validateAbility(a, {}), a.text).toEqual([]);
    expect(renderGate(COMMAND_TOWER, [COMMAND_TOWER.text], ctx).ok).toBe(true);
    expect(renderAbility(INSIGNIA, ctx).join(' ')).toMatch(/you've cast your commander from the command zone this game/);
    const two: AbilityDef = { ...COMMAND_TOWER, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'commanderIdentity', count: 2 } }] } };
    expect(renderAbility(two, ctx).join(' ')).toMatch(/two mana in any combination of colors in your commander's color identity/);
  });

  it('the walker names: feature:mana.commanderIdentity (not feature:mana.steps), q:commanderCasts and sq:, filter:commander and sfilter:, feature:zone.command', () => {
    expect(capabilitiesOf(COMMAND_TOWER)).toContain('feature:mana.commanderIdentity');
    expect(capabilitiesOf(COMMAND_TOWER)).not.toContain('feature:mana.steps');
    expect(capabilitiesOf(INSIGNIA)).toEqual(expect.arrayContaining(['q:commanderCasts', 'sq:commanderCasts']));
    expect(capabilitiesOf(LIEUTENANT)).toEqual(expect.arrayContaining(['filter:commander', 'sfilter:commander']));
    expect(capabilitiesOf(EMINENCE)).toContain('feature:zone.command');
    // abilities that already functioned everywhere (a characteristic-defining ability, CR 604.3) need nothing new
    const everywhere: AbilityDef = { ...LIEUTENANT, zone: ['battlefield', 'hand', 'library', 'graveyard', 'stack', 'exile', 'command'] };
    expect(capabilitiesOf(everywhere)).not.toContain('feature:zone.command');
    const fromHand: AbilityDef = { ...EMINENCE, zone: ['hand'] };
    expect(capabilitiesOf(fromHand)).not.toContain('feature:zone.command');
  });

  it('commanderCasts is evaluated and advertised at once: exact in every game (0 outside Commander, CR 903.8)', () => {
    expect(ENGINE_CAPABILITIES.has('q:commanderCasts')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('sq:commanderCasts')).toBe(true);
    expect(STATIC_QUANTITY_KINDS.has('commanderCasts')).toBe(true);
    const s = startedGame();
    const id = s.zones.library['p1']![0]!;
    const q: Quantity = { q: 'commanderCasts' };
    expect(evalQty(ctxOn(s, id), q)).toBe(0);
    const t = cloneState(s);
    t.options = { ...t.options, commander: { variant: 'commander', damageLimit: 21, tax: 2, freeMulligan: false } };
    t.players[0]!.commanders = [{ card: 'cX', defId: 'x', casts: 3, identity: ['G'] }, { card: 'cY', defId: 'y', casts: 1, identity: ['B'] }];
    expect(evalQty(ctxOn(t, id), q)).toBe(4); // CR 702.124: both partners' casts ("your commander" is either one)
  });

  it('`commander` is a status field: evaluated by the filter and the layer system, advertised through its part (M11-1 registered it)', () => {
    expect(FILTER_STATUS_FIELDS).toContain('commander');
    expect(evaluable({ commander: true, controller: 'you' })).toBe(true);
    expect(missingCapabilities(LIEUTENANT, ENGINE_CAPABILITIES)).toEqual([]); // M11-1: test/m11/rules/capabilities.test.ts
  });
});
