/**
 * r4-cost: activation costs that read the ability's own target (statics/costmods.ts#targetValue, CostModHit.targets; actions/activate.ts announces the targets
 * before the total cost is determined; keywords/expand.ts gives a keyword's cost change to its activated ability), played with synthetic cards (design 6.10).
 *
 *   CR 601.2c, 601.2f, 602.2b, 702.6a   "Equip {5}. This ability costs {1} less to activate for each color of the creature it targets": a two-color creature
 *                                       makes it {3}; a colorless one leaves it {5}
 *   CR 122.1, 601.2f                    "... for each +1/+1 counter on the creature it targets"
 *   CR 601.2c, 601.2f                   "This ability costs {1} less to activate if it targets a creature with power 3 or less"
 *   CR 601.2c, 602.2b, 702.6a           "Equip abilities you activate that target ~ cost {2} less to activate": only an equip ability that targets this creature
 *   CR 601.2f                           before targets are chosen the ability is offered if SOME target could make it payable (never refused for a cost a
 *                                       target could still lower); once a target is chosen its own cost is charged
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, activations, card, drive, find, full, named, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const BLADE = card('Test Prism Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {5}. This ability costs {1} less to activate for each color of the creature it targets.', '{1}');
const SPURS = card('Test Growth Spurs', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {4}. This ability costs {1} less to activate for each +1/+1 counter on the creature it targets.', '{1}');
const WARDEN = card('Test Raft Warden', 'Creature — Human', '{2}, {T}: Tap target creature. This ability costs {1} less to activate if it targets a creature with power 3 or less.', '{1}', PT);
const MAULER = card('Test Dwarf Smith', 'Creature — Dwarf', 'Equip abilities you activate that target this creature cost {2} less to activate.', '{1}', PT);
const MACE = card('Test Plain Mace', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {3}', '{1}');
const DUO = card('Test Dual Knight', 'Creature — Human Knight', '', '{W}{U}', PT, ['W', 'U']);
const GREY = card('Test Grey Golem', 'Artifact Creature — Golem', '', '{2}', PT);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['4', '4']);
const HULKING = card('Test Gamma Brute', 'Creature — Mutant', 'Power-up abilities of other creatures you control cost {3} less to activate.', '{1}', PT);
const PUP = card('Test Pup Hero', 'Creature — Hero', 'Power-up — {4}: Put two +1/+1 counters on this creature.', '{0}', ['1', '1']);
const DEFS = [BLADE, SPURS, WARDEN, MAULER, MACE, DUO, GREY, OGRE, HULKING, PUP];

/** The refusal of an activation whose total cost, once its target is chosen, can't be paid (CR 601.2h). */
const UNPAYABLE = /payment is not possible/;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const equipOf = (s: GameState, name: string) => activations(s, name).find((a) => /^Equip|Attach/i.test(a.label) || /Equip/.test(a.label));
const attachedTo = (s: GameState, eq: string): ObjectId | undefined => s.objects[find(s, eq, 'battlefield', 'p1')]!.attachedTo ?? undefined;
const lands = (n: number): string[] => Array.from({ length: n }, () => 'Plains');

describe('r4-cost: costs that read the ability\'s target', () => {
  it('the cards are automated', () => {
    for (const d of [BLADE, SPURS, WARDEN, MAULER]) expect(full(d), d.name).toBe(true);
  });

  it('CR 601.2c, 601.2f, 702.6a: equip {5} less one per color of its target: {3} onto a white-blue creature; not payable onto a colorless one', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [...lands(3), 'Test Prism Blade', 'Test Dual Knight', 'Test Grey Golem'] } });
    const eq = equipOf(s, 'Test Prism Blade');
    expect(eq).toBeDefined(); // some target makes it payable (CR 601.2f)
    const duo = find(s, 'Test Dual Knight', 'battlefield', 'p1');
    const done = resolveAll(drive(act(s, eq!.action), { targets: [[obj(duo)]] }));
    expect(attachedTo(done, 'Test Prism Blade')).toBe(duo);
    expect(done.zones.battlefield.filter((id) => done.objects[id]!.defId === 'Plains' && done.objects[id]!.tapped)).toHaveLength(3);
    const golem = find(s, 'Test Grey Golem', 'battlefield', 'p1');
    // {5} with three lands: the activation is refused once the colorless target is chosen (CR 601.2h: the total cost can't be paid)
    expect(() => drive(act(s, eq!.action), { targets: [[obj(golem)]] })).toThrow(UNPAYABLE);
  });

  it('CR 122.1, 601.2f: equip {4} less one per +1/+1 counter on its target: two counters make it {2}', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [...lands(2), 'Test Growth Spurs', { name: 'Test Grey Golem', counters: { '+1/+1': 2 } }] } });
    const eq = equipOf(s, 'Test Growth Spurs');
    expect(eq).toBeDefined();
    const golem = find(s, 'Test Grey Golem', 'battlefield', 'p1');
    const done = resolveAll(drive(act(s, eq!.action), { targets: [[obj(golem)]] }));
    expect(attachedTo(done, 'Test Growth Spurs')).toBe(golem);
    const none = scenario([], { defs: DEFS, p1: { battlefield: [...lands(2), 'Test Growth Spurs', 'Test Grey Golem'] } });
    expect(equipOf(none, 'Test Growth Spurs')).toBeUndefined(); // no creature with counters: {4} with two lands
  });

  it('CR 601.2c, 601.2f: "{1} less if it targets a creature with power 3 or less": {1} to tap a 2/2, {2} to tap a 4/4', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [...lands(1), 'Test Raft Warden'] }, p2: { battlefield: ['Test Grey Golem', 'Test Ogre'] } });
    const [tap] = activations(s, 'Test Raft Warden');
    expect(tap).toBeDefined();
    const golem = find(s, 'Test Grey Golem', 'battlefield', 'p2');
    const done = resolveAll(drive(act(s, tap!.action), { targets: [[obj(golem)]] }));
    expect(done.objects[golem]!.tapped).toBe(true);
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    expect(() => drive(act(s, tap!.action), { targets: [[obj(ogre)]] })).toThrow(UNPAYABLE);
  });

  it('CR 602.2b, 702.6a: "Equip abilities you activate that target ~ cost {2} less": equip {3} onto the Smith costs {1}; onto another creature, {3}', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [...lands(1), 'Test Plain Mace', 'Test Dwarf Smith', 'Test Grey Golem'] } });
    const eq = equipOf(s, 'Test Plain Mace');
    expect(eq).toBeDefined();
    const smith = find(s, 'Test Dwarf Smith', 'battlefield', 'p1');
    const done = resolveAll(drive(act(s, eq!.action), { targets: [[obj(smith)]] }));
    expect(attachedTo(done, 'Test Plain Mace')).toBe(smith);
    expect(() => drive(act(s, eq!.action), { targets: [[obj(find(s, 'Test Grey Golem', 'battlefield', 'p1'))]] })).toThrow(UNPAYABLE);
    const alone = scenario([], { defs: DEFS, p1: { battlefield: [...lands(1), 'Test Plain Mace', 'Test Grey Golem'] } });
    expect(equipOf(alone, 'Test Plain Mace')).toBeUndefined();
    expect(named(done, 'Test Dwarf Smith')).toHaveLength(1);
  });

  it('CR 602.2b, 702.193a: "Power-up abilities of other creatures you control cost {3} less": the {4} power-up costs {1}; the source\'s own would not be reduced', () => {
    expect(full(HULKING) && full(PUP)).toBe(true);
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Test Gamma Brute', 'Test Pup Hero'] } });
    const [pup] = activations(s, 'Test Pup Hero');
    expect(pup).toBeDefined();
    const done = resolveAll(drive(act(s, pup!.action)));
    expect(done.objects[find(done, 'Test Pup Hero', 'battlefield', 'p1')]!.counters?.['+1/+1']).toBe(2);
    const alone = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Test Pup Hero'] } });
    expect(activations(alone, 'Test Pup Hero')).toHaveLength(0);
  });
});
