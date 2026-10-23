/**
 * WP14 capability discipline (design 5.2, 15.1 rule 5): each of its 16 ops is a capability because it has a handler AND a renderer; the value forms its
 * handlers resolve by hand are named by the walker and are NOT capabilities, so a card that needs one is never classified automated; the section 13 cards
 * whose every node WP14 and the merged packages run classify as full; storm is advertised now that `op:copy` works (STATUS W1 open item f).
 */
import { describe, expect, it } from 'vitest';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { TOKENS_HANDLERS } from '../../../src/effects/handlers/tokens';
import { ZONES_HANDLERS } from '../../../src/effects/handlers/zones';
import { capabilitiesOf, classifyAbility, ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import { renderGate } from '../../../src/render/gate';
import { RENDERERS } from '../../../src/render/step';
import type { AbilityDef, EffectStep } from '../../../src/index';
import { EXAMPLES } from '../model/examples';

const WP14_OPS = ['move', 'destroy', 'sacrifice', 'sacrificeChoice', 'counter', 'tap', 'untap', 'attach', 'changeFace', 'phaseOut', 'regenerate', 'removeFromCombat', 'exchange', 'createToken', 'copy', 'cast'];
const ability = (steps: EffectStep[]): AbilityDef => ({ kind: 'spell', text: 'x', effect: { targets: [], steps } });
const example = (name: string): AbilityDef => EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities[0]!;

describe('WP14 capabilities (design 5.2)', () => {
  it('the zones and tokens tables hold exactly the 16 ops of design 15.2, and each is an engine capability (handler and renderer)', () => {
    expect([...Object.keys(ZONES_HANDLERS), ...Object.keys(TOKENS_HANDLERS)].sort()).toEqual([...WP14_OPS].sort());
    for (const op of WP14_OPS) {
      expect(Object.hasOwn(OP_HANDLERS, op), op).toBe(true);
      expect(Object.hasOwn(RENDERERS, op), op).toBe(true);
      expect(ENGINE_CAPABILITIES.has(`op:${op}`), op).toBe(true);
    }
  });

  it('the forms resolved by hand are named by the walker and missing from the engine (never falsely automated)', () => {
    const self = { ref: 'self' as const };
    const cases: [EffectStep, string][] = [
      // FAST4 MX1: "exile ... until ~ leaves the battlefield" runs (op:move.until, test/fast4/mx1); a move until another event does not
      [{ op: 'move', what: self, to: { zone: 'exile' }, until: { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' } } }, 'op:move.until.other'],
      [{ op: 'move', what: self, to: { zone: 'stack' } }, 'op:move.stack'],
      [{ op: 'exchange', a: self, b: self, what: 'powerToughness' }, 'op:exchange.powerToughness'],
      [{ op: 'regenerate', what: self, duration: { d: 'untilNextTurn', whose: { ref: 'you' } } }, 'op:regenerate.duration'],
      [{ op: 'cast', who: { ref: 'you' }, what: self, costChange: { kind: 'reduce', generic: 1 } }, 'op:cast.costChange.reduce'], // M6-12: only the alternative-cost form runs (madness)
      // M6-2: a token copy's exceptions run; CLOUD std-misc: a spell copy's types, colors and fixed P/T run too (effects/handlers/token-defs.ts#exceptedSpellDef), an
      // ability it would gain does not
      [{ op: 'copy', what: self, result: 'spell', who: { ref: 'you' }, except: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'haste' }] }] }, 'op:copy.spellExcept.other'],
    ];
    for (const [step, form] of cases) {
      const a = ability([step]);
      expect(capabilitiesOf(a), form).toContain(form);
      expect(missingCapabilities(a, ENGINE_CAPABILITIES), form).toContain(form);
    }
    // M6-3 (m6 design 3.4): face down (CR 406.3, 708.3) and turning face up (CR 708.7) are run now: still named by the walker, and present in the engine
    const faceForms: [EffectStep, string][] = [
      [{ op: 'move', what: self, to: { zone: 'exile', faceDown: true } }, 'layer:1b'],
      [{ op: 'changeFace', what: self, to: 'faceUp' }, 'op:changeFace.faceUp'],
    ];
    for (const [step, form] of faceForms) {
      expect(capabilitiesOf(ability([step])), form).toContain(form);
      expect(ENGINE_CAPABILITIES.has(form), form).toBe(true);
    }
    // ... while the forms WP14 runs need nothing more than the op
    for (const step of [
      { op: 'move', what: self, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true, attacking: true, counters: [{ kind: '+1/+1', count: 1 }] } },
      { op: 'exchange', a: { ref: 'you' }, b: { ref: 'each', who: 'opponent' }, what: 'life' },
      { op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Treasure' }, tapped: true, attacking: true },
      { op: 'copy', what: self, result: 'token', who: { ref: 'you' } },
      { op: 'copy', what: self, result: 'spell', who: { ref: 'you' }, except: [{ layer: 5, colors: { set: ['R'] } }] }, // CLOUD std-misc: "except that the copy is red" (CR 707.9b)
      { op: 'cast', who: { ref: 'you' }, what: self, free: true, optional: true },
    ] as EffectStep[]) expect(missingCapabilities(ability([step]), ENGINE_CAPABILITIES).filter((c) => c.startsWith('op:')), step.op).toEqual([]);
  });

  it('design 13: Doom Blade, Wrath of God, Raise the Alarm and Counterspell classify as full with this engine; each renders back to its Oracle text (WP2 gate)', () => {
    for (const name of ['Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Counterspell']) {
      const a = example(name);
      expect(missingCapabilities(a, ENGINE_CAPABILITIES), name).toEqual([]);
      expect(classifyAbility(a, ENGINE_CAPABILITIES).level, name).toBe('full');
      expect(renderGate(a, [a.text], { selfNames: [name] }).ok, name).toBe(true);
    }
  });

  it('Swords to Plowshares and Path to Exile wait only for the ops of their other packages (gainLife: WP12; may: WP10; search, shuffle: WP13)', () => {
    const others = (name: string): string[] => missingCapabilities(example(name), ENGINE_CAPABILITIES).filter((c) => c.startsWith('op:'));
    expect(others('Swords to Plowshares').every((c) => !WP14_OPS.includes(c.slice(3)))).toBe(true);
    expect(others('Path to Exile').every((c) => !WP14_OPS.includes(c.slice(3)))).toBe(true);
  });

  it('CR 702.40a: keyword:storm is advertised once op:copy exists (its expansion copies the spell for each spell cast before it)', () => {
    expect(ENGINE_CAPABILITIES.has('op:copy')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:storm')).toBe(true);
  });
});
