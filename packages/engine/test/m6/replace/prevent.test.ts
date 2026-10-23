/**
 * M6-1: prevention for every source (m6 design 3.1.10, 3.2; CR 615): a prevention effect's additional effect (615.5), unpreventable damage (615.12), the
 * `damagePrevented` event (615.13), static "prevent N" per event (615.10, unchanged), and Fog, whose effect is not a shield but lasts this turn.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ReplacementDef } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import { compileCard } from '../../../src/index';
import { find, runCombat, scenario } from '../../m5/helpers';
import { cast, resolveTop } from '../../m5/cr-examples/helpers';
import { getCard } from '../../fixtures';
import { enchantment, eventsOf, run, shieldRecord } from './support';

const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

/** "The next time a source would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way." */
const healer: ReplacementDef = {
  s: 'replace', replaces: { ev: 'damage', recipient: { player: 'you' } }, shield: { uses: 1 },
  body: { b: 'prevent', amount: 'all', then: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'preventedAmount' } }] },
};

describe('CR 615.5: a prevention effect\'s additional effect', () => {
  it('CR 615.5: "You gain life equal to the damage prevented this way": 3 damage prevented, 3 life gained, immediately after', () => {
    const s = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = structuredClone(s);
    t.continuousEffects.push(shieldRecord('e60', healer));
    const r = run(t, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 3, combat: false, unpreventable: false }));
    expect(r.result).toBeNull();
    expect(lifeOf(r.g.s, 'p1')).toBe(23);
    expect(r.g.s.continuousEffects.find((x) => x.id === 'e60')).toBeUndefined(); // "the next time": used
  });

  it('CR 615.12: unpreventable damage: the prevention effect prevents nothing, its additional effect still happens (with 0 prevented), the shield is not used up', () => {
    const s = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const drawsOnPrevent: ReplacementDef = {
      s: 'replace', replaces: { ev: 'damage', recipient: { player: 'you' } }, shield: { uses: 1 },
      body: { b: 'prevent', amount: 'all', then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    };
    const t = structuredClone(s);
    t.continuousEffects.push(shieldRecord('e61', drawsOnPrevent));
    const r = run(t, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 3, combat: false, unpreventable: true }));
    expect(lifeOf(r.g.s, 'p1')).toBe(17);
    expect(handSize(r.g.s, 'p1')).toBe(handSize(s, 'p1') + 1); // CR 615.12a: applied once, not repeatedly
    expect(r.g.s.continuousEffects.find((x) => x.id === 'e61')).toBeDefined();
  });

  it('CR 615.13: one damagePrevented event per application, with the effect, the amount and who dealt and would have been dealt the damage', () => {
    const s = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = structuredClone(s);
    t.continuousEffects.push(shieldRecord('e62', healer));
    const r = run(t, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 2, combat: false, unpreventable: false }));
    const ev = eventsOf(r.g, 'damagePrevented');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ effect: 'shield:e62', amount: 2, source: [bears], target: ['p1'] });
  });

  it('CR 615.10: a static "prevent 1 of that damage" of another object applies to each damage event separately', () => {
    const ward = enchantment('Test Ward', [{ s: 'replace', replaces: { ev: 'damage', recipient: { object: { types: ['Creature'], controller: 'you' } } }, body: { b: 'prevent', amount: 1 } }]);
    const s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Test Ward', 'Grizzly Bears', 'Hill Giant'] }, defs: [ward] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const r = run(s, (g) => {
      proposeResult(g, { ev: 'damage', source: { id: giant, zone: 'battlefield' }, to: { id: bears, zone: 'battlefield' }, amount: 1, combat: false, unpreventable: false });
      proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: { id: giant, zone: 'battlefield' }, amount: 2, combat: false, unpreventable: false });
    });
    expect(r.g.s.objects[bears]!.damage).toBe(0);
    expect(r.g.s.objects[giant]!.damage).toBe(1);
  });
});

describe('Fog: a replacement effect of a resolved spell that is not a shield lasts this turn (CR 615.1, 611.2a)', () => {
  it('Fog (game path) is full, and prevents all combat damage this turn', () => {
    expect(compileCard(getCard('Fog')).automation.level).toBe('full');
    let s = scenario(['Fog', 'Forest', 'Grizzly Bears'], { p1: { hand: ['Fog'], battlefield: ['Grizzly Bears', 'Forest'] } });
    expect(lifeOf(runCombat(s, { attack: [[find(s, 'Grizzly Bears', 'battlefield')]] }), 'p2')).toBe(18); // without Fog
    s = resolveTop(cast(s, 'Fog'));
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const after = runCombat(s, { attack: [[bears]] });
    expect(lifeOf(after, 'p2')).toBe(20);
  });
});
