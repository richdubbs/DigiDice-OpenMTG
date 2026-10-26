/**
 * WP11 capability discipline (design 5.2, 15.1.5): the pipeline advertises exactly the replacement forms it runs end to end, through its own tables
 * (`REPLACEMENT_BODIES`, `STATIC_KINDS`, `FEATURES` of effects/propose.ts); everything milestone 6 adds stays missing, so such cards are never falsely automated.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/index';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import { classifyAbility } from '../../../src/model/classify';
import { FEATURES, REPLACEMENT_BODIES, STATIC_KINDS } from '../../../src/effects/propose';
import { entersSelf, staticAbility } from './support';

describe('design 5.2: the capabilities of the proposal pipeline come from its tables', () => {
  it('bodies, the static kind and the feature it registers are in ENGINE_CAPABILITIES', () => {
    for (const b of Object.keys(REPLACEMENT_BODIES)) expect(ENGINE_CAPABILITIES.has(`body:${b}`), b).toBe(true);
    for (const k of Object.keys(STATIC_KINDS)) expect(ENGINE_CAPABILITIES.has(`static:${k}`), k).toBe(true);
    for (const f of FEATURES) expect(ENGINE_CAPABILITIES.has(`feature:${f}`), f).toBe(true);
    // M6-1 (m6 design 3.2): instead, redirect (with a budget), skip, amounts, counts, another player and a prevention effect's additional steps
    expect(Object.keys(REPLACEMENT_BODIES).sort()).toEqual(['during' /* M6-3 */, 'enters', 'enters.attachTo', 'enters.attacking' /* trek-8: CR 508.4 */, 'enters.choice' /* FAST5X E28: riot */, 'enters.copy' /* M6-2 */, 'enters.copy.copiedCounters', 'enters.copy.duration' /* pc-tokens-2 */ /* trek-4: CR 614.1c */, 'enters.copy.then' /* r4-copy: CR 603.12 */, 'enters.countersIf' /* CMD3: sunburst, CR 702.44a, 614.12 */, 'enters.dayIfNeither' /* p2-misc-1: CR 731.1 */, 'enters.devour' /* std-rx15: CR 702.82a */, 'enters.exileCards' /* std-cardcopy-3: cards exiled as it enters, linked, CR 607.2a */, 'enters.faceDown' /* M6-3 */, 'enters.lookAtHand' /* std-rx6 */, 'enters.prepared' /* M6-6 */, 'enters.transformed' /* M6-4 */, 'enters.under', 'enters.untapped' /* r5-fxb */, 'healFirst' /* Cloud r5-repl */, 'instead', 'insteadThen' /* merge wave 8, audit D4: CR 614.1a, 614.6 */, 'insteadThen.if' /* p2-replace-events-1: the event goes on only if, else elsewhere (CR 614.1a, 614.6) */, 'modify', 'modify.amount', 'modify.count', 'modify.destination', 'modify.destination.faceDown', 'modify.destination.random', 'modify.destination.transformed' /* M6-4 */, 'modify.link' /* std-ru: CR 607.2a */, 'modify.then' /* M6-12 */, 'modify.to', 'prevent', 'prevent.as' /* std-library-2: CR 603.12 */, 'prevent.then', 'redirect', 'redirect.amount', 'regeneration', 'shieldCounter' /* FAST5X E28: CR 122.1c */, 'skip', 'umbraArmor' /* std-rx24: CR 702.89a */]);
  });

  // M6-1 registered the replacement loop's forms (foreign replacements, instead, redirect, skip, amounts and counts, shields of every body): test/m6/replace/
  it('design 14: what the later milestone 6 packages add is missing (the other destination fields; transformed: M6-4)', () => {
    for (const c of ['body:enters.transformed', 'body:modify.destination.transformed']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true); // M6-4 (test/m6/dfc/)
    for (const c of ['body:modify.destination.attacking', 'body:modify.destination.attachedTo', 'body:modify.destination.order', 'body:modify.destination.owner']) {
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    }
  });
});

describe('design 13: the self `enters` statics of the worked examples are automated; the M6 forms are not', () => {
  const kavu: AbilityDef = {
    kind: 'static', text: 'If ~ was kicked, it enters with three +1/+1 counters on it and with trample.', condition: { cond: 'wasCast', kicked: true },
    effects: [
      entersSelf({ counters: [{ kind: '+1/+1', count: 3 }] }),
      { s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', text: 'Trample', keyword: 'trample' }] }] },
    ],
  };
  const fountain = staticAbility('As ~ enters, you may pay 2 life. If you don\'t, it enters tapped.', [entersSelf({ tappedUnlessPay: { other: [{ kind: 'payLife', amount: 2 }] } })], { zone: ['stack', 'battlefield'] });
  const fortress = staticAbility('~ enters tapped unless you control a Plains or an Island.', [entersSelf({ tapped: true, tappedUnless: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Plains', 'Island'], controller: 'you' } } } })], { zone: ['stack', 'battlefield'] });
  const clone = staticAbility('You may have ~ enter as a copy of any creature on the battlefield.', [entersSelf({ copy: { of: { types: ['Creature'] }, optional: true } })], { zone: ['stack', 'battlefield'] });

  it('Kavu Titan (13.4), Hallowed Fountain and Glacial Fortress (13.6): full', () => {
    for (const a of [kavu, fountain, fortress]) {
      expect(missingCapabilities(a, ENGINE_CAPABILITIES), a.text).toEqual([]);
      expect(classifyAbility(a, ENGINE_CAPABILITIES).level, a.text).toBe('full');
    }
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-2.test.ts (Clone, design 13.6)
});
