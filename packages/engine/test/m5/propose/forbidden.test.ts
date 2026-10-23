/**
 * WP11: CR 614.17 "can't" effects come before any replacement or prevention effect (design 8.5: `forbidden(g, e)` first). The statics provider is WP16's; this
 * file fakes it (design 15.1.7: develop against the stub): `staticEffectsFor` answers a "can't be dealt damage" / "can't be destroyed" restriction for one
 * permanent, and RULE_HOOK_ACTIONS says those two rule actions are wired.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RestrictionDef } from '../../../src/index';
import type { RuleQuery } from '../../../src/statics/api';

const PROTECTED = { id: '' };

vi.mock('../../../src/statics/hooks', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/statics/hooks')>();
  return {
    ...orig,
    RULE_HOOK_ACTIONS: { 'rule:receiveDamage': true, 'rule:beDestroyed': true },
    staticEffectsFor: (_s: unknown, q: RuleQuery): RestrictionDef[] =>
      q.subject === PROTECTED.id && (q.action === 'receiveDamage' || q.action === 'beDestroyed') ? [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: q.action }] : [],
    // WP31: the call-sites ask `ruleDenial` (the full evaluator), so the fake answers that question too.
    ruleDenial: (_s: unknown, q: RuleQuery) => (q.subject === PROTECTED.id && (q.action === 'receiveDamage' || q.action === 'beDestroyed') ? { message: 'a test restriction', rules: ['CR 614.17'] } : null),
  };
});

const { propose } = await import('../../../src/effects/propose');
const { destroy } = await import('../../../src/rules/destroy');
const { dealDamage } = await import('../../../src/rules/damage');
const { find, logHas, scenario, tweak } = await import('../helpers');
const { eventsOf, run, shieldRecord } = await import('./support');

describe('CR 614.17, 101.2: an event that can\'t happen is dropped before replacement and prevention effects are considered', () => {
  const board = () => scenario(['Hill Giant', 'Craw Wurm'], { p1: { battlefield: ['Craw Wurm'] }, p2: { battlefield: ['Hill Giant'] } });

  it('damage to a permanent that can\'t be dealt damage is not dealt, and a prevention shield on it is NOT used up (the event never reached it)', () => {
    const s0 = board();
    const [wurm, giant] = [find(s0, 'Craw Wurm', 'battlefield'), find(s0, 'Hill Giant', 'battlefield')];
    PROTECTED.id = giant;
    const s = tweak(s0, (t) => {
      t.continuousEffects.push(shieldRecord('e90', { s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] } } } }, body: { b: 'prevent', amount: 2 }, shield: { uses: 'all' } }));
    });
    const r = run(s, (g) => propose(g, { ev: 'damage', source: { id: wurm, zone: 'battlefield' }, to: { id: giant, zone: 'battlefield' }, amount: 3, combat: false, unpreventable: false }));
    expect(r.result).toBe(false);
    expect(r.g.s.objects[giant]!.damage).toBe(0);
    expect(r.g.s.continuousEffects[0]).not.toHaveProperty('usesLeft');
    expect(eventsOf(r.g, 'damageDealt')).toEqual([]);
    expect(logHas(r.g.s, /can't happen/, 'CR 614.17')).toBe(true);
    // The other creature is not protected: the same damage is dealt to it (combat or not, through the funnel of rules/damage.ts).
    expect(run(s, (g) => dealDamage(g, giant, wurm, 3)).result).toBe(3);
  });

  it('a state-based or effect destruction of a permanent that can\'t be destroyed does nothing (rules/destroy.ts goes through the pipeline)', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    PROTECTED.id = giant;
    const r = run(s0, (g) => destroy(g, giant, { reason: 'lethal damage' }));
    expect(r.result).toBe('none');
    expect(r.g.s.objects[giant]?.zone).toBe('battlefield');
  });
});
