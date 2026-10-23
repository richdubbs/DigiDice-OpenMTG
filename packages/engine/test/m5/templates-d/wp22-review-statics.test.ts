/**
 * WP22 review, finding 1 (design 5.2, 15.1.5, the never-silently-wrong rule): a static ability is evaluated by the layer system and the rule hooks with
 * statics/match.ts, not with the general evaluators, so its condition and the nodes of its continuous effects need what THOSE can evaluate
 * (`scond:` / `sq:` / `sref:` / `sfilter:`, model/capabilities.ts). Before the fix the walker asked only for the general names, and a static ability
 * whose condition or affected set needs the turn's history (CR 611.3a re-evaluates it continuously, which statics/match.ts cannot do for history) was
 * classified full while the engine never applied it. Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { classifyAbility } from '../../../src/model/classify';
import { card, face, options } from './support';

const opts = options([], { capabilities: ENGINE_CAPABILITIES });
const abilitiesOf = (type: string, text: string): AbilityDef[] => face(card('Test Review Golem', type, text), opts).abilities;
const levels = (type: string, text: string): string[] => abilitiesOf(type, text).map((a) => classifyAbility(a, ENGINE_CAPABILITIES).level);

describe('CR 611.3a, 604.1: a static ability the layers cannot evaluate is never classified full (WP22 review finding 1)', () => {
  it.each([
    // FAST5X E9: `happened` conditions are evaluated by statics/match.ts now (the test below): "as long as you gained life this turn" is full
    ['Enchantment', 'Creatures you control that entered this turn have double strike.'], // filter enteredThisTurn (sta.grant.each)
    ['Enchantment', 'Creatures you control that blocked this turn have lifelink.'], // filter blockedThisTurn (FAST5X E28: attackedThisTurn is evaluated now)
    ['Enchantment', 'Each creature that was dealt damage this turn has defender.'], // filter dealtDamageThisTurn (sta.each.grant)
    ['Creature — Golem', '~ gets +1/+1 for each creature that entered this turn.'], // a counted set the layers never match (sta.obj.pump.foreach)
    // CLOUD std-ecl: q:happenedCount is evaluated by statics/match.ts now (the test below): "the number of creatures that died this turn" is full
  ])('%s "%s" is not full', (type, text) => {
    const ls = levels(type, text);
    expect(ls.length).toBeGreaterThan(0);
    expect(ls).not.toContain('full');
  });

  it('FAST5X E9, CR 611.3a: a history condition the statics evaluate is full ("as long as you gained life this turn", "you have cast two or more spells this turn")', () => {
    expect(levels('Creature — Golem', '~ gets +2/+0 as long as you gained life this turn.')).toEqual(['full']);
    expect(levels('Creature — Golem', "As long as you've cast two or more spells this turn, ~ has double strike.")).toEqual(['full']);
  });

  it('CLOUD std-ecl, CR 611.3a, 604.3: a count of the history the statics evaluate is full ("the number of creatures that died this turn", q:happenedCount)', () => {
    expect(levels('Creature — Golem', "~'s power and toughness are each equal to the number of creatures that died this turn.")).toEqual(['full']);
  });

  it('CR 611.3a: a static ability the layers DO evaluate stays full ("As long as you control a Swamp, ~ gets +3/+0.", "Creatures you control get +1/+1.")', () => {
    expect(levels('Creature — Golem', 'As long as you control a Swamp, ~ gets +3/+0.')).toEqual(['full']);
    expect(levels('Enchantment', 'Creatures you control get +1/+1.')).toEqual(['full']);
    expect(levels('Creature — Golem', '~ gets +1/+1 for each artifact you control.')).toEqual(['full']);
  });
});

describe('design 5.2: the walker names what statics/match.ts evaluates inside a static ability (INTERFACE CHANGE of model/cap-walk.ts)', () => {
  const happened = { cond: 'happened', event: { ev: 'lifeGained', player: 'you' }, when: 'thisTurn' };
  const pump = { s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 0 }] };
  it('CR 611.3a: the condition of a static ability with a continuous or rule effect needs `scond:<cond>`', () => {
    const caps = capabilitiesOfDef({ kind: 'static', text: 'x', condition: happened, effects: [pump] });
    expect(caps).toContain('scond:happened');
    // FAST5X E9: statics/match.ts evaluates `happened` (the layer cache keys on the history), so it is no longer missing
    expect(missingCapabilities({ kind: 'static', text: 'x', condition: happened, effects: [pump] } as unknown as AbilityDef, ENGINE_CAPABILITIES)).not.toContain('scond:happened');
    expect(ENGINE_CAPABILITIES.has('scond:happened')).toBe(true);
  });
  it('CR 613.1: a filter, quantity and object reference inside a static continuous effect need `sfilter:` / `sq:` / `sref:`', () => {
    // FAST5X-4: `speed` is evaluated by the statics since then (CR 702.179f); `faceUpX` is not (it is the interpreter's only)
    const def = { kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], enteredThisTurn: true } }, mods: [{ layer: '7c', power: { q: 'faceUpX' }, toughness: 0 }] }] };
    const caps = capabilitiesOfDef(def);
    expect(caps).toEqual(expect.arrayContaining(['sfilter:types', 'sfilter:enteredThisTurn', 'sref:each', 'sq:faceUpX']));
    expect(missingCapabilities(def as unknown as AbilityDef, ENGINE_CAPABILITIES)).toEqual(expect.arrayContaining(['sfilter:enteredThisTurn', 'sq:faceUpX']));
  });
  it('CR 611.2c: a resolved continuous effect (an `effect` step) fixes its set and numbers at resolution, so it needs no `s...` name', () => {
    const def = { kind: 'spell', text: 'x', effect: { steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }] } };
    expect(capabilitiesOfDef(def).filter((c) => /^s(filter|q|ref|cond):/.test(c))).toEqual([]);
  });
  it('CR 613.1f: an ability granted by a static (layer 6 `add`) is walked as its own ability, without the granting static\'s `s...` names', () => {
    const granted = { kind: 'triggered', text: 'y', trigger: { event: { ev: 'lifeGained', player: 'you' } }, effect: { steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } };
    const def = { kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [granted] }] }] };
    expect(capabilitiesOfDef(def).filter((c) => /^s(filter|q|ref|cond):/.test(c))).toEqual(['sref:self']);
  });
  it('CR 614.1: the condition of a static with only a replacement effect is read by the replacement pipeline\'s evaluator, so it needs no `scond:`', () => {
    const def = { kind: 'static', text: 'x', condition: happened, effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', tapped: true } }] };
    expect(capabilitiesOfDef(def).filter((c) => c.startsWith('scond:'))).toEqual([]);
  });
});

describe('CR 113.1c, 611.3a: a quoted static ability built by an ability-level template keeps its condition and zones (WP22 review finding 3)', () => {
  const granted = (type: string, text: string): AbilityDef[] => {
    const a = abilitiesOf(type, text)[0]!;
    expect(a.kind, JSON.stringify(a)).toBe('static');
    const mod = (a as { effects: { mods: { layer: unknown; add?: AbilityDef[] }[] }[] }).effects[0]!.mods.find((m) => m.layer === 6)!;
    return mod.add!;
  };
  it('"Creatures you control have \\"This creature gets +2/+1 as long as you control a Mountain.\\"" grants a conditional static (not a schema-invalid nested value)', () => {
    const [g] = granted('Enchantment', 'Creatures you control have "This creature gets +2/+1 as long as you control a Mountain."');
    expect(g).toMatchObject({ kind: 'static', condition: { cond: 'exists' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 1 }] }] });
  });
  it('the Aura form "Enchanted creature has \\"As long as you control an Island, this creature gets +1/+3.\\"" grants a conditional static', () => {
    const [g] = granted('Enchantment — Aura', 'Enchanted creature has "As long as you control an Island, this creature gets +1/+3."');
    expect(g).toMatchObject({ kind: 'static', condition: { cond: 'exists' }, effects: [{ s: 'continuous', mods: [{ layer: '7c', power: 1, toughness: 3 }] }] });
  });
});
