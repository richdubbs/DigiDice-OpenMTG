/**
 * std-library-1 (account B lane std-library: library and graveyard sequences): the round's readings played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 208.1, 608.2d          "Put any number of creature and/or Vehicle cards with different powers from among them into your hand": the cards are taken one at
 *                             a time, a card whose power was already taken is not offered; the rest go to the bottom
 *   CR 115.1, 601.2c, 603.12  "you may pay {X}. When you do, put any number of target creature cards with total mana value X or less from that player's
 *                             graveyard onto the battlefield under your control": the total is the X paid; a set over it is refused; cards of your own
 *                             graveyard are not offered
 *   CR 603.7, 603.7b, 603.3d  "At the beginning of the next combat phase this turn, target creature you control deals damage equal to its power to up to one
 *                             target creature you don't control": no target is chosen as the spell is cast; the delayed trigger chooses them at the
 *                             beginning of combat; created after combat, it never triggers (this turn only)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, card, cast, drive, find, full, legal, named, obj, passBoth, resolveAll, scenario } from '../r5-cost/support';
import { attackWith } from '../r4-cost/support';
import { pass } from '../../m3/scenario';

const PT = (p: string, t: string): [string, string] => [p, t];
const SEEKER = card('Test Spawn Seeker', 'Creature — Human Scout', 'When this creature enters, reveal the top X cards of your library, where X is its power. Put any number of creature and/or Vehicle cards with different powers from among them into your hand. Put the rest on the bottom of your library in a random order.', '{0}', PT('4', '4'));
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', PT('2', '2'));
const CUB = card('Test Cub', 'Creature — Bear', '', '{1}', PT('2', '1'));
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{2}', PT('3', '3'));
const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 1', '{2}', PT('3', '2'));
const GIANT = card('Test Giant', 'Creature — Giant', '', '{3}', PT('5', '5'));
const LORD = card('Test Fire Warden', 'Creature — Human Noble', 'Whenever this creature deals combat damage to a player, you may pay {X}. When you do, put any number of target creature cards with total mana value X or less from that player\'s graveyard onto the battlefield under your control.', '{0}', PT('3', '3'));
const HUNT = card('Test Wild Hunt', 'Sorcery', 'Look at the top five cards of your library. You may exile a creature card from among them. Put the rest on the bottom of your library in a random order. You may cast the exiled card this turn. At the beginning of the next combat phase this turn, target creature you control deals damage equal to its power to up to one target creature you don\'t control.');
const DEFS = [SEEKER, BEAR, CUB, OGRE, CART, GIANT, LORD, HUNT];

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const handNames = (s: GameState): string[] => s.zones.hand.p1!.map((id) => nameOf(s, id)).sort();
const optionNames = (s: GameState): string[] => (s.pending as unknown as { options: ObjectId[] }).options.map((id) => nameOf(s, id)).sort();

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [SEEKER, LORD, HUNT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 208.1, 608.2d: "any number of creature and/or Vehicle cards with different powers from among them"', () => {
  const start = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Spawn Seeker'], library: ['Test Bear', 'Test Cub', 'Plains', 'Test Cart', 'Test Ogre'] } });
  it('X is its power (4): four cards revealed; after the Bear (power 2) the Cub (power 2) is not offered; after the Cart (power 3) the Ogre is not either', () => {
    let s = cast(start(), 'Test Spawn Seeker');
    s = passBoth(s); // the creature spell resolves; its enters trigger goes on the stack
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(optionNames(s)).toEqual(['Test Bear', 'Test Cart', 'Test Cub']); // the fifth card (Ogre) is not revealed, Plains is no creature or Vehicle
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'library', 'p1')] });
    expect(optionNames(s)).toEqual(['Test Cart']);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cart', 'library', 'p1')] });
    s = drive(s);
    expect(handNames(s)).toEqual(['Test Bear', 'Test Cart']);
    const lib = s.zones.library.p1!.map((id) => nameOf(s, id));
    expect(lib[0]).toBe('Test Ogre'); // the unrevealed card is now on top
    expect(lib.slice(-2).sort()).toEqual(['Plains', 'Test Cub']); // the rest at the bottom
  });
  it('none is a choice too: declining puts every revealed card on the bottom', () => {
    let s = passBoth(passBoth(cast(start(), 'Test Spawn Seeker')));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = drive(s);
    expect(handNames(s)).toEqual([]);
    expect(s.zones.library.p1!.map((id) => nameOf(s, id))[0]).toBe('Test Ogre');
  });
});

describe('CR 115.1, 601.2c, 603.12: "put any number of target creature cards with total mana value X or less from that player\'s graveyard"', () => {
  const start = (): GameState => scenario([], {
    defs: DEFS,
    p1: { battlefield: ['Test Fire Warden', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Bear'] },
    p2: { graveyard: ['Test Ogre', 'Test Cub', 'Test Giant'] },
  });
  it('X = 3 paid: the Ogre (2) and the Cub (1) enter under your control; the cards of your own graveyard are not offered', () => {
    const s0 = start();
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p2');
    const cub = find(s0, 'Test Cub', 'graveyard', 'p2');
    const s = attackWith(s0, [find(s0, 'Test Fire Warden', 'battlefield', 'p1')], 'p2', { yes: [true], x: [3], targets: [[obj(ogre), obj(cub)]] });
    expect(named(s, 'Test Ogre').map((id) => s.objects[id]!.controller)).toEqual(['p1']);
    expect(named(s, 'Test Cub').map((id) => s.objects[id]!.controller)).toEqual(['p1']);
    expect(nameOf(s, s.zones.graveyard.p1![0]!)).toBe('Test Bear');
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id))).toEqual(['Test Giant']);
  });
  it('a set over the total (the Ogre and the Giant, 5 > 3) is refused', () => {
    const s0 = start();
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p2');
    const giant = find(s0, 'Test Giant', 'graveyard', 'p2');
    expect(() => attackWith(s0, [find(s0, 'Test Fire Warden', 'battlefield', 'p1')], 'p2', { yes: [true], x: [3], targets: [[obj(ogre), obj(giant)]] })).toThrow();
  });
  it('a card of your own graveyard is no legal target', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    expect(() => attackWith(s0, [find(s0, 'Test Fire Warden', 'battlefield', 'p1')], 'p2', { yes: [true], x: [3], targets: [[obj(bear)]] })).toThrow();
  });
});

describe('CR 603.7, 603.7b, 603.3d: "At the beginning of the next combat phase this turn, target creature you control deals damage equal to its power to ..."', () => {
  const start = (): GameState => scenario([], {
    defs: DEFS,
    p1: { hand: ['Test Wild Hunt'], battlefield: ['Test Ogre', 'Plains', 'Plains'], library: ['Test Bear', 'Plains', 'Plains', 'Plains', 'Plains'] },
    p2: { battlefield: ['Test Giant'] },
  });
  it('no target as the spell is cast; the Bear is exiled and cast this turn; at the beginning of combat the Ogre deals 3 damage to the Giant', () => {
    let s = act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Test Wild Hunt', 'hand', 'p1') });
    expect(s.pending?.kind).not.toBe('chooseTargets');
    s = drive(s);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const bear = find(s, 'Test Bear', 'library', 'p1');
    s = drive(s, { objects: [[bear]] });
    const exiled = s.zones.exile.filter((id) => nameOf(s, id) === 'Test Bear');
    expect(exiled).toHaveLength(1);
    expect(legal(s, 'p1', 'cast').some((a) => a.object === exiled[0])).toBe(true); // CR 601.3: castable from exile this turn
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    for (let i = 0; i < 20 && s.pending?.kind !== 'chooseTargets'; i++) s = pass(s);
    expect(s.turn.step).toBe('beginCombat');
    s = drive(s, { targets: [[obj(ogre)], [obj(giant)]] });
    s = resolveAll(s);
    expect(s.objects[giant]!.damage).toBe(3);
  });
  it('cast after combat, the delayed trigger never triggers: not in this turn\'s end step, not in the next turn\'s combat', () => {
    let s = start();
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    s = resolveAll(cast(s, 'Test Wild Hunt', { objects: [[]] }));
    for (let i = 0; i < 80 && !(s.turn.number === 2 && s.turn.step === 'main2'); i++) {
      expect(s.pending?.kind, `step ${s.turn.step} of turn ${s.turn.number}`).not.toBe('chooseTargets');
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = drive(s);
    }
    expect(s.turn.number).toBe(2);
    expect(s.delayedTriggers).toHaveLength(0);
  });
});
