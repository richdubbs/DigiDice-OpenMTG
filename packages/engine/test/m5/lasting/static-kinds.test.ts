/**
 * Design 5.2: the `effect` handler stores a resolved effect of kind `s` exactly when the engine advertises `static:<s>`, whichever table registers the kind:
 * the layer system (statics/live.ts, `continuous`), the proposal pipeline (effects/propose.ts, WP11: `replace` and its shields) or the rule hooks
 * (statics/hooks.ts, WP16: `restrict`, `permit`, `rule`, `costMod`). Here WP16's registration is simulated, so the test shows that a kind another package registers
 * is stored (WP16's code reads it from `GameState.continuousEffects`) and that the handler's gate is the capability set itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storableKind } from '../../../src/effects/handlers/lasting';
import { CAST_STATIC_KINDS } from '../../../src/actions/cast-kinds';
import type { ContinuousEffectRec, GameState, StaticEffect } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import { find, scenario } from '../helpers';
import { neighbors } from './neighbors';
import { castAndResolve, creatureTarget, instant, objectTarget, setup, targets } from './support';

vi.mock('../../../src/effects/propose', async (o) => (await import('./neighbors')).proposeMock(await o()));
vi.mock('../../../src/effects/manual', async (o) => (await import('./neighbors')).manualMock(await o()));
vi.mock('../../../src/effects/run', async (o) => (await import('./neighbors')).runMock(await o()));
vi.mock('../../../src/core/resolve', async (o) => (await import('./neighbors')).resolveMock(await o()));
// WP16 registers its rule-modifying kinds in statics/hooks.ts (simulated: on this branch the table is still empty)
vi.mock('../../../src/statics/hooks', async (o) => {
  const orig = (await o()) as Record<string, unknown>;
  return { ...orig, RULE_HOOK_ACTIONS: { ...(orig['RULE_HOOK_ACTIONS'] as object), 'static:restrict': true } };
});

beforeEach(setup);

const records = (s: GameState): ContinuousEffectRec[] => s.continuousEffects;
const KINDS: StaticEffect['s'][] = ['continuous', 'costMod', 'restrict', 'replace', 'permit', 'rule', 'triggerMod', 'additionalCost', 'alternativeCost', 'pregame'];

describe('design 5.2: the effect handler stores the kinds the engine advertises (static:<s>), from any registering table', () => {
  it('its gate is the capability set: storableKind(s) === ENGINE_CAPABILITIES.has("static:" + s) for every StaticEffect kind but the cast costs', () => {
    expect(ENGINE_CAPABILITIES.has('static:restrict')).toBe(true); // the simulated WP16 registration reached the builder
    // M6-5a: additionalCost / alternativeCost are read by the cast path from a card's printed abilities only (actions/cast-kinds.ts); stored by a resolving spell
    // nothing reads them, so the handler never stores them and the walker asks for feature:castCost.lasting there (test/m6/costs/capabilities.test.ts)
    // M6-12: static:triggerMod is advertised for the static abilities of permanents (triggers/collect.ts); a stored record is never read (feature:triggerMod.lasting)
    // FAST4 MX1: static:pregame is advertised for the printed abilities of opening-hand cards (core/pregame.ts); a stored record is never read
    // (feature:pregame.lasting)
    for (const s of KINDS) expect(storableKind(s), s).toBe(ENGINE_CAPABILITIES.has(`static:${s}`) && !Object.hasOwn(CAST_STATIC_KINDS, s) && s !== 'triggerMod' && s !== 'pregame');
  });

  it('CR 611.2: "Target creature can\'t block this turn." is stored as a resolved effect once static:restrict is registered (WP16 reads it), with no manual prompt', () => {
    const NOBLOCK: StaticEffect = { s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'cant', action: 'block' };
    const STOP = instant('Stop Blocking', [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [NOBLOCK] }], [creatureTarget()]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Stop Blocking'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [STOP] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Stop Blocking', [targets(objectTarget(bears))]);
    expect(neighbors.manual).toEqual([]);
    expect(records(s).map((r) => r.effect)).toEqual([{ s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'cant', action: 'block' }]);
  });
});
