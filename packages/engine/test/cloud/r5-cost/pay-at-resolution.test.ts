/**
 * r5-cost: costs paid while an ability resolves, then a reflexive trigger (CR 603.12), played with synthetic cards (design 6.10).
 *
 *   CR 118.12, 601.2b, 603.12   "you may discard a card or pay {2}. When you do, ...": one of the two costs, the player's choice; either one makes the trigger,
 *                               declining makes none (zz-fast5/t44.json, a one-of cost)
 *   CR 107.3, 118.12, 603.12    "you may pay {X}. When you do, put X +1/+1 counters on ...": the player chooses X as they pay (CR 107.3f); the
 *                               reflexive trigger reads that X; X can be no more than they can pay
 */
import { describe, expect, it } from 'vitest';
import { answer, card, cast, find, full, named, obj, passBoth, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const DIGGER = card('Test Tunnel Digger', 'Creature — Insect', 'When this creature enters, you may discard a card or pay {2}. When you do, destroy target artifact.', '{0}', PT);
const KEEPER = card('Test Grove Keeper', 'Creature — Elf Druid', 'Whenever another creature you control enters, you may pay {X}. When you do, put X +1/+1 counters on this creature.', '{0}', PT);
const SAGE = card('Test Tide Sage', 'Creature — Merfolk Wizard', 'When this creature enters, you may pay {X}. If you do, draw X cards.', '{0}', PT);
const RELIC = card('Test Relic', 'Artifact', '', '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
const DEFS = [DIGGER, KEEPER, SAGE, RELIC, OGRE];

describe('r5-cost: a cost paid while an ability resolves, then a reflexive trigger', () => {
  it('the cards are automated', () => {
    for (const d of [DIGGER, KEEPER, SAGE]) expect(full(d), d.name).toBe(true);
  });

  it('CR 118.12, 601.2b, 603.12: with no card in hand, paying {2} makes the trigger, which destroys the artifact', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Tunnel Digger'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Relic'] } });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Tunnel Digger'), { yes: [true], targets: [[obj(relic)]] });
    expect(named(s, 'Test Relic')).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(2); // {2} paid
  });

  it('CR 118.12, 601.2b: with a card and no mana, the card is discarded instead, and the trigger destroys the artifact', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Tunnel Digger', 'Plains'] }, p2: { battlefield: ['Test Relic'] } });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Tunnel Digger'), { yes: [true], targets: [[obj(relic)]] });
    expect(named(s, 'Test Relic')).toHaveLength(0);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Plains');
  });

  it('CR 603.12: declining both makes no trigger', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Tunnel Digger'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Relic'] } });
    const s = resolveAll(cast(s0, 'Test Tunnel Digger'), { yes: [false] });
    expect(named(s, 'Test Relic')).toHaveLength(1);
  });

  it('CR 107.3, 603.12: paying {X} with X = 2 puts two counters; X can be at most the mana available', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ogre'], battlefield: ['Test Grove Keeper', 'Plains', 'Plains', 'Plains'] } });
    const keeper = find(s0, 'Test Grove Keeper', 'battlefield', 'p1');
    const s2 = resolveAll(passBoth(cast(s0, 'Test Ogre')), { yes: [true], x: [2] });
    expect(s2.objects[keeper]!.counters?.['+1/+1']).toBe(2);
    expect(s2.zones.battlefield.filter((id) => s2.objects[id]!.tapped)).toHaveLength(2);
  });

  it('CR 107.3: the largest X offered is the mana the player can pay; declining puts no counter', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ogre'], battlefield: ['Test Grove Keeper', 'Plains', 'Plains', 'Plains'] } });
    const keeper = find(s0, 'Test Grove Keeper', 'battlefield', 'p1');
    // the Ogre resolves, the Keeper triggers; as its trigger resolves: pay? yes; then X, from 0 to the three Plains
    let s = passBoth(passBoth(cast(s0, 'Test Ogre')));
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind === 'chooseNumber' ? [s.pending.min, s.pending.max] : s.pending?.kind).toEqual([0, 3]);
    const no = resolveAll(passBoth(cast(s0, 'Test Ogre')), { yes: [false] });
    expect(no.objects[keeper]!.counters?.['+1/+1'] ?? 0).toBe(0);
    const all = resolveAll(passBoth(cast(s0, 'Test Ogre')), { yes: [true], x: [3] });
    expect(all.objects[keeper]!.counters?.['+1/+1']).toBe(3);
  });

  it('CR 107.3, 118.12: "If you do, draw X cards" reads the X chosen as {X} was paid', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Tide Sage'], battlefield: ['Plains', 'Plains'], library: ['Plains', 'Plains', 'Plains'] } });
    const s = resolveAll(cast(s0, 'Test Tide Sage'), { yes: [true], x: [2] });
    expect(s.zones.hand.p1).toHaveLength(2);
    expect(s.zones.library.p1).toHaveLength(s0.zones.library.p1!.length - 2);
  });

  it('CR 603.3d, 107.3: a target that reads X is chosen before X is paid, so "you may pay {X}. If you do, return target card with mana value X" stays manual', () => {
    const dead = card('Test Grave Caller', 'Creature — Zombie', 'When this creature dies, you may pay {X}. If you do, return another target Zombie creature card with mana value X from your graveyard to the battlefield.', '{0}', PT);
    expect(full(dead)).toBe(false);
  });
});
