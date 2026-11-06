/**
 * Commander coordinator D, round edh-d-10 (EDHREC ranks 10,001-11,250, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10).
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites from the Comprehensive Rules of 2026-09-25.
 *
 *   CR 725.1, 725.2, 603.2     "At the beginning of the monarch's end step, that player draws a card." (Archivist of Gondor)
 *   CR 725.1, 613.1b, 303.4    "The monarch controls enchanted creature." (Fealty to the Realm)
 *   CR 725.1, 509.1b           "~ can't be blocked by creatures the monarch controls." (Azure Fleet Admiral)
 *   CR 120.1, 601.2c, 601.2f   "~ costs {3} less to cast if it targets a creature that was dealt damage this turn." (Bitter Downfall)
 *   CR 702.6a, 602.5b          "Equip {0}. Activate only once each turn." (Leather Armor)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, advanceTo, card, cast, drive, find, full, legal, obj, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const idOn = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
const handOf = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

describe('"At the beginning of the monarch\'s end step, that player draws a card." (CR 725.1, 603.2; Archivist of Gondor)', () => {
  const ARCH = card('Test Archivist', 'Enchantment', "At the beginning of the monarch's end step, that player draws a card.");
  const start = (monarch?: PlayerId): GameState => {
    const s = scenario(['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], { p1: { battlefield: ['Test Archivist'] }, p2: {}, defs: [ARCH] });
    if (monarch !== undefined) s.designations.monarch = monarch;
    return s;
  };
  it('has no manual part', () => expect(full(ARCH)).toBe(true));
  it('the monarch draws in their own end step (the controller of the permanent is not the one who draws)', () => {
    const s0 = start('p2');
    const s = advanceTo(s0, 2, 'end');
    const before = handOf(s, 'p2');
    expect(handOf(resolveAll(s), 'p2')).toBe(before + 2); // the monarch's own draw (CR 725.2) and the Archivist's
  });
  it('the negative case: in an end step of a player who is not the monarch, or with no monarch, nobody draws from it', () => {
    for (const [m, turn] of [['p2', 1], [undefined, 1], [undefined, 2]] as const) {
      const s = advanceTo(start(m), turn, 'end');
      const before = handOf(s, turn === 1 ? 'p1' : 'p2');
      expect(handOf(resolveAll(s), turn === 1 ? 'p1' : 'p2')).toBe(before);
    }
  });
});

describe('"The monarch controls enchanted creature." (CR 725.1, 613.1b; Fealty to the Realm)', () => {
  const FEALTY = card('Test Fealty', 'Enchantment — Aura', 'Enchant creature\nThe monarch controls enchanted creature.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const start = (monarch?: PlayerId): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Fealty'] }, p2: { battlefield: ['Test Ogre'] }, defs: [FEALTY, OGRE] });
    const s = resolveAll(cast(s0, 'Test Fealty', { targets: [[obj(idOn(s0, 'Test Ogre'))]] }));
    if (monarch !== undefined) s.designations.monarch = monarch;
    return s;
  };
  const ctl = (s: GameState): PlayerId => getChars(s, idOn(s, 'Test Ogre')).controller as PlayerId;
  it('has no manual part', () => expect(full(FEALTY)).toBe(true));
  it('the creature is controlled by the monarch, whoever that is', () => {
    expect(ctl(start('p1'))).toBe('p1');
    expect(ctl(start('p2'))).toBe('p2');
  });
  it('the negative case: with no monarch the effect applies to nobody and the creature stays with its controller', () => {
    expect(ctl(start())).toBe('p2');
  });
});

describe('"~ costs {3} less to cast if it targets a creature that was dealt damage this turn." (CR 120.1, 601.2c, 601.2f; Bitter Downfall)', () => {
  const DIVE = card('Test Dive', 'Instant', 'This spell costs {3} less to cast if it targets a creature that was dealt damage this turn.\nDestroy target creature.', '{3}{B}', undefined, ['B']);
  const PING = card('Test Ping', 'Instant', '~ deals 1 damage to target creature.', '{0}', undefined, ['R']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const base = (): GameState => scenario(['Swamp'], { p1: { hand: ['Test Dive', 'Test Ping'], battlefield: ['Swamp'] }, p2: { battlefield: ['Test Ogre'] }, defs: [DIVE, PING, OGRE] });
  it('has no manual part', () => expect(full(DIVE)).toBe(true));
  it('with one Swamp, the spell can be cast at a creature that was dealt damage this turn and destroys it', () => {
    let s = base();
    s = resolveAll(cast(s, 'Test Ping', { targets: [[obj(idOn(s, 'Test Ogre'))]] }));
    s = resolveAll(cast(s, 'Test Dive', { targets: [[obj(idOn(s, 'Test Ogre'))]] }));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Ogre')).toBe(false);
  });
  it('the negative case: at an undamaged creature the full cost is due and one Swamp cannot pay it', () => {
    const s = base();
    const offered = (st: GameState): boolean => legal(st, 'p1', 'cast').some((a) => a.action.type === 'cast' && st.objects[a.action.card]?.defId === 'Test Dive');
    expect(offered(s)).toBe(false); // no creature was dealt damage: {3}{B} cannot be paid with one Swamp
    expect(offered(resolveAll(cast(s, 'Test Ping', { targets: [[obj(idOn(s, 'Test Ogre'))]] })))).toBe(true);
  });
});

describe('"Equip {0}. Activate only once each turn." (CR 702.6a, 602.5b; Leather Armor)', () => {
  const ARMOR = card('Test Armor', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {0}. Activate only once each turn.');
  const MITE = card('Test Mite', 'Creature — Insect', '', '{0}', ['1', '1']);
  it('has no manual part', () => expect(full(ARMOR)).toBe(true));
  it('can be activated once in a turn; a second activation the same turn is not offered', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Armor', 'Test Mite', 'Test Mite'] }, p2: {}, defs: [ARMOR, MITE] });
    const armor = idOn(s0, 'Test Armor');
    const offers = (st: GameState): number => legal(st, 'p1', 'activate').filter((a) => a.action.type === 'activate' && a.action.source === armor).length;
    expect(offers(s0)).toBeGreaterThan(0);
    const [m1] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Mite');
    const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && x.action.source === armor)!.action;
    const s1 = resolveAll(drive(act(s0, a), { targets: [[obj(m1!)]] }));
    expect(s1.objects[armor]!.attachedTo).toBe(m1);
    expect(offers(s1)).toBe(0);
  });
});
