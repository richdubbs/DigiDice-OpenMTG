/**
 * M6-0 (m6 design 2.1, 7, D2): the capability walker names every new node, the schema (regenerated) validates them, and the names the milestone 5 engine
 * already honors are registered in the same commit (G10: no formerly full card is demoted; the fixture gate pins it: coverage --fixtures --gate R1 --diff).
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, ENGINE_CAPABILITIES, missingCapabilities, validateAbility, type AbilityDef, type EventPattern, type ReplacementBody } from '../../../src/index';
import { expansionNeeds } from '../../../src/keywords/needs';

const self = { ref: 'self' } as const;
const replacement = (replaces: EventPattern, body: ReplacementBody = { b: 'prevent', amount: 'all' }, extra: Record<string, unknown> = {}): AbilityDef =>
  ({ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces, body, ...extra }] }) as AbilityDef;
const trigger = (on: EventPattern): AbilityDef => ({ kind: 'triggered', text: 'x', trigger: { on: [on] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } });

describe('M6-0, D2: a replacement pattern needs feature:replace.on.<ev>[.<verb>], not ev:<ev>', () => {
  it('the eight kinds the milestone 5 pipeline translates, and phases and turns (M6-1), are named and registered', () => {
    const cases: [EventPattern, string][] = [
      [{ ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, 'feature:replace.on.zoneChange'],
      [{ ev: 'damage', recipient: { object: { self: true } } }, 'feature:replace.on.damage'],
      [{ ev: 'life', change: 'gain', player: 'you' }, 'feature:replace.on.life'],
      [{ ev: 'draw', player: 'you' }, 'feature:replace.on.draw'],
      [{ ev: 'createToken', player: 'you' }, 'feature:replace.on.createToken'],
      [{ ev: 'counters', change: 'put', on: { self: true } }, 'feature:replace.on.counters'],
      [{ ev: 'step', step: 'draw', whose: 'you' }, 'feature:replace.on.step'],
      [{ ev: 'action', verb: 'destroy', object: { self: true } }, 'feature:replace.on.action.destroy'],
      // M6-1: phases and turns are proposed by core/turn.ts (CR 614.10)
      [{ ev: 'phase', phase: 'combat', whose: 'you' }, 'feature:replace.on.phase'],
      [{ ev: 'beginTurn', whose: 'you' }, 'feature:replace.on.turn'],
    ];
    for (const [p, name] of cases) {
      const caps = capabilitiesOf(replacement(p));
      expect(caps, name).toContain(name);
      expect(caps.some((c) => c.startsWith('ev:')), name).toBe(false);
      expect(ENGINE_CAPABILITIES.has(name), name).toBe(true);
    }
  });

  it('the kinds it does not translate are named and missing: the card is never classified automated while its replacement could never apply', () => {
    const cases: [EventPattern, string][] = [
      [{ ev: 'becomes', what: 'tapped', object: { self: true } }, 'feature:replace.on.becomes.tapped'],
      [{ ev: 'action', verb: 'sacrifice', object: { self: true } }, 'feature:replace.on.action.sacrifice'],
      [{ ev: 'cast', player: 'you' }, 'feature:replace.on.cast'],
    ];
    for (const [p, name] of cases) {
      const def = replacement(p);
      expect(capabilitiesOf(def), name).toContain(name);
      expect(missingCapabilities(def, ENGINE_CAPABILITIES), name).toContain(name);
    }
    // M6-3 translates turning face up (effects/proposal-kinds/turn-face-up.ts), M6-4 transforming (effects/proposal-kinds/transform.ts): named, and present
    const up = replacement({ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } });
    expect(capabilitiesOf(up)).toContain('feature:replace.on.turnFaceUp');
    expect(ENGINE_CAPABILITIES.has('feature:replace.on.turnFaceUp')).toBe(true);
    expect(capabilitiesOf(replacement({ ev: 'becomes', what: 'transformed', object: { self: true } }))).toContain('feature:replace.on.transform');
    expect(ENGINE_CAPABILITIES.has('feature:replace.on.transform')).toBe(true);
  });

  it('a trigger pattern still needs ev:<ev>; phase is emitted by nothing (NOT_EMITTED); dayNight since M6-4 (core/designations.ts)', () => {
    expect(capabilitiesOf(trigger({ ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }))).toContain('ev:zoneChange');
    expect(capabilitiesOf(trigger({ ev: 'dayNight', to: 'night' }))).toContain('ev:dayNight');
    expect(missingCapabilities(trigger({ ev: 'dayNight', to: 'night' }), ENGINE_CAPABILITIES)).not.toContain('ev:dayNight');
    expect(missingCapabilities(trigger({ ev: 'phase', phase: 'combat', whose: 'you' } as EventPattern), ENGINE_CAPABILITIES)).toContain('ev:phase');
    expect(capabilitiesOf(trigger({ ev: 'becomes', what: 'turnedFaceDown', object: { self: true } }))).toContain('feature:ev.becomes.turnedFaceDown');
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.turnedFaceDown')).toBe(true); // M6-3: emitted (rules/face-down.ts)
  });

  it('CR 614.16: byEffect is feature:replace.byEffect in a replacement (registered by M6-1) and feature:ev.byEffect elsewhere (missing)', () => {
    const byEffect: EventPattern = { ev: 'counters', change: 'put', on: { self: true }, byEffect: true };
    expect(capabilitiesOf(replacement(byEffect))).toContain('feature:replace.byEffect');
    expect(missingCapabilities(replacement(byEffect), ENGINE_CAPABILITIES)).not.toContain('feature:replace.byEffect'); // registered by M6-1
    expect(missingCapabilities(trigger(byEffect), ENGINE_CAPABILITIES)).toContain('feature:ev.byEffect');
  });

  it('a madness pattern\'s discard cause is the registered feature:replace.cause in a replacement (CR 702.35a), feature:ev.cause elsewhere', () => {
    const discard: EventPattern = { ev: 'zoneChange', subject: { self: true }, cause: 'discard' };
    expect(capabilitiesOf(replacement(discard, { b: 'modify', destination: { zone: 'exile' } }))).toContain('feature:replace.cause');
    expect(missingCapabilities(trigger(discard), ENGINE_CAPABILITIES)).toContain('feature:ev.cause');
  });

  it('keyword data name the same (keywords/needs.ts): a replacement in an expansion needs replace.on, a trigger ev', () => {
    const needs = expansionNeeds({ name: 'test', rule: '0', status: 'implemented', expand: [{ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces: { ev: 'phase', phase: 'combat' }, body: { b: 'skip' } }] }] } as never);
    expect(needs).toContain('feature:replace.on.phase');
    expect(needs).not.toContain('ev:phase');
  });
});

describe('M6-0, section 7: the walker names of the new nodes', () => {
  it('Case (CR 719), grouped additional costs (CR 601.2b), enters prepared (CR 722.3a), redirect with an amount (CR 614.9), the during body', () => {
    const caseDef: AbilityDef = { kind: 'case', text: 'x', solve: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } } }, solved: [{ kind: 'keyword', text: 'Flying', keyword: 'flying' }] };
    expect(capabilitiesOf(caseDef)).toContain('feature:case');
    expect(missingCapabilities(caseDef, ENGINE_CAPABILITIES)).toEqual([]); // M6-6: statics/levels.ts (LEVELS_FEATURES)
    const grouped: AbilityDef = { kind: 'static', text: 'x', zone: ['stack'], effects: [{ s: 'additionalCost', cost: { mana: [{ kind: 'generic', amount: 3 }] }, choiceGroup: 'a' }] };
    // M6-5 registers it (actions/cast-kinds.ts#CAST_COST_FEATURES; the choice is announced by actions/cast-costs.ts#announceGroupedCosts)
    expect(capabilitiesOf(grouped)).toContain('feature:additionalCost.choiceGroup');
    expect(missingCapabilities(grouped, ENGINE_CAPABILITIES)).not.toContain('feature:additionalCost.choiceGroup');
    const prepared = replacement({ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, { b: 'enters', prepared: true });
    expect(capabilitiesOf(prepared)).toContain('body:enters.prepared');
    expect(missingCapabilities(prepared, ENGINE_CAPABILITIES)).toEqual([]); // M6-6: effects/enters-parts/prepared.ts
    const redirect = replacement({ ev: 'damage', recipient: { object: { self: true } } }, { b: 'redirect', to: { ref: 'you' }, amount: 2 }, { shield: { uses: 1 } });
    expect(capabilitiesOf(redirect)).toEqual(expect.arrayContaining(['body:redirect', 'body:redirect.amount'])); // registered by M6-1 (effects/prevent.ts)
    const during = replacement({ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } }, { b: 'during', do: [{ op: 'putCounters', on: self, kind: '+1/+1', count: 1 }] });
    expect(capabilitiesOf(during)).toEqual(expect.arrayContaining(['body:during', 'feature:replace.on.turnFaceUp']));
    expect(missingCapabilities(during, ENGINE_CAPABILITIES)).toEqual([]); // M6-3: the during body and turning face up are run
  });

  it('feature:copy.asEntersPT (CR 707.2, 613.2a): a during body that sets P/T, and a static P/T setting read from a choice made as it entered', () => {
    const setsPT = { op: 'effect' as const, effects: [{ s: 'continuous' as const, affects: self, mods: [{ layer: '7b' as const, power: 3, toughness: 3 }] }], duration: { d: 'permanent' as const } };
    const during = replacement({ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } }, { b: 'during', do: [setsPT] });
    expect(capabilitiesOf(during)).toContain('feature:copy.asEntersPT');
    const chosenPT: AbilityDef = { kind: 'static', text: 'x', condition: { cond: 'chosen', link: 'pt', equals: '3/3' }, effects: [{ s: 'continuous', affects: self, mods: [{ layer: '7b', power: 3, toughness: 3 }] }] };
    expect(missingCapabilities(chosenPT, ENGINE_CAPABILITIES)).toContain('feature:copy.asEntersPT');
    const anthem: AbilityDef = { kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: self, mods: [{ layer: '7b', power: 3, toughness: 3 }] }] };
    expect(capabilitiesOf(anthem)).not.toContain('feature:copy.asEntersPT');
  });

  it('the status fields of a filter are filter:<field> and missing until their owners register them (rules/registries.ts#FILTER_PARTS)', () => {
    const solvedIf: AbilityDef = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'matches', object: self, filter: { solved: true } }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } };
    expect(capabilitiesOf(solvedIf)).toContain('filter:solved');
    expect(missingCapabilities(solvedIf, ENGINE_CAPABILITIES)).toEqual([]); // M6-6: rules/filter-parts/levels.ts (a Case sets it, CR 719.3b)
    const flippedIf: AbilityDef = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'matches', object: self, filter: { flipped: true } }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } };
    expect(capabilitiesOf(flippedIf)).toContain('filter:flipped'); // M6-4's field
  });
});

describe('M6-0: the regenerated schema validates the new nodes (model/schema.generated.json)', () => {
  it('a Case, a during body, copy exceptions (retain, if), a face-down profile and a history count per player have no schema issue', () => {
    const ok = (def: AbilityDef): void => expect(validateAbility(def).filter((i) => i.code === 'schema'), JSON.stringify(def)).toEqual([]);
    ok({ kind: 'case', text: 'x', solve: { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'cast' }, scope: 'lastTurn', per: 'player' }, op: '>=', right: 2 }, solved: [] });
    ok(replacement({ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } }, { b: 'during', do: [{ op: 'putCounters', on: self, kind: '+1/+1', count: { q: 'faceUpX' } }] }));
    ok({ kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: self, mods: [{ layer: '1a', copyOf: { ref: 'each', filter: { types: ['Creature'] } }, except: [{ retain: ['colors'] }, { if: { types: ['Creature'] }, then: [{ layer: 4, subtypes: { add: ['Illusion'] } }] }] }, { layer: '1b', faceDown: true, profile: 'ward2' }] }] });
    expect(validateAbility({ kind: 'case', text: 'x', solve: { cond: 'eventFlag', flag: 'nope' }, solved: [] } as unknown as AbilityDef).some((i) => i.code === 'schema')).toBe(true);
  });
});
