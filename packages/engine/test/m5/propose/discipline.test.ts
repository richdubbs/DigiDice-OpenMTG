/**
 * WP11 review: capability discipline (design 5.2, 10.2, 15.1.5). A replacement form is advertised only when the pipeline runs it end to end; a form it can't run
 * has a value-form name of its own that no table registers, so the ability is degraded (never "full" while it does something else at run time):
 *   - the fields of a new destination (CR 614.1a): random placement ("shuffle it into its owner's library", CR 701.24c) and face down (CR 406.3) run; transformed,
 *     attacking, attached, order, another player's zone and face down onto the battlefield do not;
 *   - a prevention effect's additional steps (CR 615.5) are not run by the pipeline;
 *   - shields made by a resolved effect are prevention shields only in milestone 5 (design 8.5, 14); a shielded `enters` or `modify` is milestone 6.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, ReplacementDef } from '../../../src/index';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import { classifyAbility } from '../../../src/model/classify';
import { applicable } from '../../../src/effects/propose';
import { staticAbility } from './support';

type Body = ReplacementDef['body'];
const instead = (body: Body): AbilityDef => staticAbility('If ~ would be put into a graveyard from anywhere, do something else instead.', [
  { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, body },
]);

describe('CR 614.1a: the fields of a new destination ("put it ... instead")', () => {
  it('CR 701.24c: "shuffle it into its owner\'s library instead" (Darksteel Colossus, position random) is automated', () => {
    const a = instead({ b: 'modify', destination: { zone: 'library', position: 'random' } });
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
    expect(classifyAbility(a, ENGINE_CAPABILITIES).level).toBe('full');
  });

  it('CR 406.3: "exile it face down instead" is automated', () => {
    const a = instead({ b: 'modify', destination: { zone: 'exile', faceDown: true } });
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('design 5.2: transformed, attacking, attached, order and another player\'s zone are value forms this build lacks (face down onto the battlefield: M6-3 has it)', () => {
    const cases: [Body, string[]][] = [
      [{ b: 'modify', destination: { zone: 'battlefield', controller: 'owner', attacking: true } }, ['body:modify.destination.attacking']],
      [{ b: 'modify', destination: { zone: 'battlefield', controller: 'owner', attachedTo: { ref: 'self' } } }, ['body:modify.destination.attachedTo']],
      [{ b: 'modify', destination: { zone: 'library', order: 'chosen' } }, ['body:modify.destination.order']],
      [{ b: 'modify', destination: { zone: 'graveyard', owner: { ref: 'you' } } }, ['body:modify.destination.owner']],
    ];
    for (const [body, caps] of cases) {
      const a = instead(body);
      expect(missingCapabilities(a, ENGINE_CAPABILITIES), JSON.stringify(body)).toEqual(expect.arrayContaining(caps));
      expect(classifyAbility(a, ENGINE_CAPABILITIES).level, JSON.stringify(body)).not.toBe('full');
    }
    // M6-4: CR 712.14a: transformed onto the battlefield (effects/destination-parts/transformed.ts)
    expect(missingCapabilities(instead({ b: 'modify', destination: { zone: 'battlefield', controller: 'owner', transformed: true } }), ENGINE_CAPABILITIES)).toEqual([]);
    // M6-3: CR 708.2a, 708.3: face down onto the battlefield needs layer:1b and the face-down destination part, both registered now
    const faceDown = instead({ b: 'modify', destination: { zone: 'battlefield', controller: 'owner', faceDown: true } });
    expect(missingCapabilities(faceDown, ENGINE_CAPABILITIES)).toEqual([]);
  });
});

describe('CR 615.5: a prevention effect with an additional effect', () => {
  it('the steps after the prevention ("draws cards equal to the damage prevented this way") need body:prevent.then (registered by M6-1: test/m6/replace/prevent.test.ts)', () => {
    const swans = staticAbility('If a source would deal damage to ~, prevent that damage. The source\'s controller draws cards equal to the damage prevented this way.', [{
      s: 'replace', replaces: { ev: 'damage', recipient: { object: { self: true } } },
      body: { b: 'prevent', amount: 'all', then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    }]);
    expect(missingCapabilities(swans, ENGINE_CAPABILITIES)).not.toContain('body:prevent.then');
    expect(classifyAbility(swans, ENGINE_CAPABILITIES).level).toBe('full');
  });
});

describe('design 8.5, 14: the shields of milestone 5 are prevention and regeneration shields', () => {
  const spellWith = (effect: ReplacementDef): AbilityDef => ({
    kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'effect', effects: [effect], duration: { d: 'endOfTurn' } }] },
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (feature:shield.modify / .enters)

  it('a prevention shield needs no such feature', () => {
    const fog = spellWith({ s: 'replace', replaces: { ev: 'damage', combat: true }, body: { b: 'prevent', amount: 'all' }, shield: { uses: 'all' } });
    expect(missingCapabilities(fog, ENGINE_CAPABILITIES).filter((c) => c.startsWith('feature:shield'))).toEqual([]);
  });
});

describe('design 14: the milestone 6 extension point is effects/propose.ts#applicable', () => {
  it('applicable is exported from effects/propose.ts', () => {
    expect(typeof applicable).toBe('function');
  });
});
