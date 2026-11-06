/**
 * Commander lane edh-c, round edh-c-71 (second pass of EDHREC ranks 28,501 to 29,000): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 404.1, 102.3, 604.1   "gets +3/+0 as long as there are ten or more cards in a single graveyard" (Swimmer in Nightmares: one graveyard, never two added)
 *   CR 301.5, 701.3b         "~ can't be equipped." (Goblin Brawler: no Equipment can be attached to it)
 *   CR 508.1c, 303.4         "can't attack unless defending player controls an enchantment or an enchanted permanent." (Godhunter Octopus)
 *   CR 509.1c, 613.4c        "Equipped creature gets +3/+1 and must be blocked by an Eldrazi if able." (Slayer's Cleaver)
 *   CR 508.1, 603.2c         "Whenever ~ and at least one other Warrior attack, put a +1/+1 counter on ~." (Paired Tactician)
 *   CR 115.1, 702.146a       "Exile target Spirit, creature with disturb, or enchantment." (Thraben Exorcism)
 *   CR 615.1a, 510.1, 611.2a "Prevent all combat damage blue creatures and black creatures would deal this turn." (Radiant Kavu)
 *   CR 105.4, 701.8a         "Destroy all enchantments of the color of your choice." (Root Greevil)
 *   CR 506.1, 601.3, 602.5   "During combat, players can't cast instant spells or activate abilities that aren't mana abilities." (Hand to Hand)
 *   CR 602.2b, 608.2h        "Tap an untapped creature you control: ~ gets +X/+0 until end of turn, where X is the power of the creature tapped this way." (Keldon Battlewagon)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const throws = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{1}');
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');
const ELDRAZI = card('Test Eldrazi', 'Creature — Eldrazi', '', ['2', '2'], '{1}');

describe('CR 404.1, 102.3, 604.1: "gets +3/+0 as long as there are ten or more cards in a single graveyard"', () => {
  const SWIMMER = card('Test Swimmer', 'Creature — Horror', 'This creature gets +3/+0 as long as there are ten or more cards in a single graveyard.', ['2', '2'], '{1}');
  const DEFS: CardDef[] = [SWIMMER, ROCK];
  it('is automated', () => expect(full(SWIMMER)).toBe(true));
  it('nine cards in each of two graveyards: nothing (never added); ten in one graveyard (either player\'s): +3/+0; back to nine: nothing', () => {
    const s = scenario([], { p1: { battlefield: ['Test Swimmer'] }, defs: DEFS });
    const swimmer = find(s, 'Test Swimmer', 'battlefield', 'p1');
    expect(pt(s, swimmer)).toBe('2/2');
    for (let i = 0; i < 9; i++) { put(s, 'p1', 'graveyard', 'Test Rock'); put(s, 'p2', 'graveyard', 'Test Rock'); }
    expect(pt(s, swimmer)).toBe('2/2');
    const tenth = put(s, 'p2', 'graveyard', 'Test Rock');
    expect(pt(s, swimmer)).toBe('5/2');
    const t = tweak(s, (x) => { x.zones.graveyard['p2'] = x.zones.graveyard['p2']!.filter((id) => id !== tenth); delete x.objects[tenth]; });
    expect(pt(t, swimmer)).toBe('2/2');
  });
});

describe('CR 301.5, 701.3b: "~ can\'t be equipped."', () => {
  const BRAWLER = card('Test Brawler', 'Creature — Goblin', "First strike\nThis creature can't be equipped.", ['2', '1'], '{1}');
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {0}', undefined, '{1}');
  const DEFS: CardDef[] = [BRAWLER, BLADE, BEAR];
  it('is automated', () => expect(full(BRAWLER)).toBe(true));
  it('the Brawler is a legal target of equip but the Equipment is not attached to it (CR 301.5c: the ability does nothing); equipping the Bear works', () => {
    const s = scenario([], { p1: { battlefield: ['Test Blade', 'Test Brawler', 'Test Bear'] }, defs: DEFS });
    const blade = find(s, 'Test Blade', 'battlefield', 'p1');
    const brawler = find(s, 'Test Brawler', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const equip = (x: GameState, host: ObjectId): GameState => {
      const a = legalActions(x, 'p1').find((l) => l.kind === 'activate' && l.object === blade)!;
      return resolveAll(settle(act(x, a.action), { targets: [obj(host)] }), { targets: [obj(host)] });
    };
    const onBrawler = equip(s, brawler);
    expect(onBrawler.objects[blade]!.attachedTo).toBeUndefined();
    expect(pt(onBrawler, brawler)).toBe('2/1');
    const onBear = equip(s, bear);
    expect(onBear.objects[blade]!.attachedTo).toBe(bear);
    expect(pt(onBear, bear)).toBe('3/3');
  });
});

describe('CR 508.1c, 303.4: "can\'t attack unless defending player controls an enchantment or an enchanted permanent."', () => {
  const OCTOPUS = card('Test Octopus', 'Creature — Octopus', "This creature can't attack unless defending player controls an enchantment or an enchanted permanent.", ['5', '5'], '{1}');
  const IDOL = card('Test Idol', 'Enchantment', '', undefined, '{1}');
  const SHROUD = card('Test Shroud', 'Enchantment — Aura', 'Enchant creature', undefined, '{1}');
  const DEFS: CardDef[] = [OCTOPUS, IDOL, SHROUD, BEAR];
  const attackRejected = (s: GameState): boolean => throws(() => declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Octopus', 'battlefield', 'p1')]]));
  it('is automated', () => expect(full(OCTOPUS)).toBe(true));
  it('refused when the defender controls no enchantment and no enchanted permanent; allowed with an enchantment; allowed with a permanent enchanted by the attacker\'s Aura', () => {
    const none = scenario([], { p1: { battlefield: ['Test Octopus'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    expect(attackRejected(none)).toBe(true);
    const idol = scenario([], { p1: { battlefield: ['Test Octopus'] }, p2: { battlefield: ['Test Idol'] }, defs: DEFS });
    expect(attackRejected(idol)).toBe(false);
    const aura = scenario([], { p1: { battlefield: ['Test Octopus'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const enchanted = tweak(aura, (x) => { x.objects[put(x, 'p1', 'battlefield', 'Test Shroud')]!.attachedTo = find(x, 'Test Bear', 'battlefield', 'p2'); });
    expect(enchanted.zones.battlefield.some((id) => enchanted.objects[id]!.controller === 'p2' && enchanted.defs[enchanted.objects[id]!.defId]!.name === 'Test Shroud')).toBe(false);
    expect(attackRejected(enchanted)).toBe(false); // p2 controls the enchanted Bear though no enchantment of its own (the Aura is p1's)
  });
});

describe('CR 509.1c, 613.4c: "Equipped creature gets +3/+1 and must be blocked by an Eldrazi if able."', () => {
  const CLEAVER = card('Test Cleaver', 'Artifact — Equipment', 'Equipped creature gets +3/+1 and must be blocked by an Eldrazi if able.\nEquip {0}', undefined, '{1}');
  const DEFS: CardDef[] = [CLEAVER, BEAR, OGRE, ELDRAZI];
  const equipped = (zones2: string[]): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Cleaver', 'Test Bear'] }, p2: { battlefield: zones2 }, defs: DEFS });
    return tweak(s, (x) => { x.objects[find(x, 'Test Cleaver', 'battlefield', 'p1')]!.attachedTo = find(x, 'Test Bear', 'battlefield', 'p1'); });
  };
  it('is automated', () => expect(full(CLEAVER)).toBe(true));
  it('+3/+1; an able Eldrazi must block it (not blocking, or another blocker alone, is refused); that Eldrazi blocking is legal', () => {
    let s = equipped(['Test Ogre', 'Test Eldrazi']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s, bear)).toBe('5/3');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[bear]]));
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const eldrazi = find(s, 'Test Eldrazi', 'battlefield', 'p2');
    expect(throws(() => declareBlockers(s, []))).toBe(true);
    expect(throws(() => declareBlockers(s, [[ogre, bear]]))).toBe(true);
    expect(declareBlockers(s, [[eldrazi, bear]]).combat!.blockers).toHaveLength(1);
  });
  it('negative: the Eldrazi blocking only another, unequipped attacker does not obey the requirement', () => {
    const s0 = equipped(['Test Eldrazi']);
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const ogre = put(s0, 'p1', 'battlefield', 'Test Ogre');
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bear], [ogre]]));
    expect(throws(() => declareBlockers(s, [[find(s, 'Test Eldrazi', 'battlefield', 'p2'), ogre]]))).toBe(true);
  });
  it('negative: with no Eldrazi to block nothing is required; and an unattached Cleaver requires nothing', () => {
    let s = equipped(['Test Ogre']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[bear]]));
    expect(declareBlockers(s, []).combat!.blockers).toHaveLength(0);
    let t = scenario([], { p1: { battlefield: ['Test Cleaver', 'Test Bear'] }, p2: { battlefield: ['Test Eldrazi'] }, defs: DEFS });
    t = toDeclareBlockers(declareAttackers(toDeclareAttackers(t), [[find(t, 'Test Bear', 'battlefield', 'p1')]]));
    expect(declareBlockers(t, []).combat!.blockers).toHaveLength(0);
  });
});

describe('CR 508.1, 603.2c: "Whenever ~ and at least one other Warrior attack, put a +1/+1 counter on ~."', () => {
  const TACTICIAN = card('Test Tactician', 'Creature — Human Warrior', 'Whenever this creature and at least one other Warrior attack, put a +1/+1 counter on this creature.', ['2', '2'], '{1}');
  const WARRIOR = card('Test Warrior', 'Creature — Human Warrior', '', ['1', '1'], '{1}');
  const DEFS: CardDef[] = [TACTICIAN, WARRIOR, BEAR];
  it('is automated', () => expect(full(TACTICIAN)).toBe(true));
  it('attacking with another Warrior: one counter; with a non-Warrior or alone: none', () => {
    const base = (): GameState => scenario([], { p1: { battlefield: ['Test Tactician', 'Test Warrior', 'Test Bear'] }, defs: DEFS });
    const run = (others: string[]): number => {
      const s0 = base();
      const tac = find(s0, 'Test Tactician', 'battlefield', 'p1');
      const s = resolveAll(attackWith(s0, [tac, ...others.map((n) => find(s0, n, 'battlefield', 'p1'))]));
      return counters(s, tac, '+1/+1');
    };
    expect(run(['Test Warrior'])).toBe(1);
    expect(run(['Test Bear'])).toBe(0);
    expect(run([])).toBe(0);
    const s0 = base();
    const tac = find(s0, 'Test Tactician', 'battlefield', 'p1');
    const home = resolveAll(attackWith(s0, [find(s0, 'Test Warrior', 'battlefield', 'p1')]));
    expect(counters(home, tac, '+1/+1')).toBe(0); // the Warrior attacks without the Tactician
  });
});

describe('CR 115.1, 702.146a: "Exile target Spirit, creature with disturb, or enchantment."', () => {
  const EXORCISM = card('Test Exorcism', 'Sorcery', 'Exile target Spirit, creature with disturb, or enchantment.', undefined, '{0}');
  const GHOST = card('Test Ghost', 'Creature — Spirit', '', ['1', '1'], '{1}');
  const IDOL = card('Test Idol', 'Enchantment', '', undefined, '{1}');
  const DEFS: CardDef[] = [EXORCISM, GHOST, IDOL, BEAR];
  it('is automated', () => expect(full(EXORCISM)).toBe(true));
  it('a creature with the disturb keyword is a legal target and is exiled; a creature with flying is not (CR 702.146a: only a creature that has disturb)', () => {
    const DISTURBER = card('Test Disturber', 'Creature — Human', 'Disturb {2}{W}', ['2', '2'], '{1}');
    const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['1', '1'], '{1}');
    const s = scenario([], { p1: { hand: ['Test Exorcism', 'Test Exorcism'] }, p2: { battlefield: ['Test Disturber', 'Test Flier'] }, defs: [EXORCISM, DISTURBER, FLIER] });
    expect(throws(() => cast(s, 'Test Exorcism', { targets: [obj(find(s, 'Test Flier', 'battlefield', 'p2'))] }))).toBe(true);
    const t = resolveAll(cast(s, 'Test Exorcism', { targets: [obj(find(s, 'Test Disturber', 'battlefield', 'p2'))] }));
    expect(t.zones.exile.some((id) => t.objects[id]!.defId === 'Test Disturber')).toBe(true);
  });
  it('a Spirit and an enchantment are legal targets and are exiled; a plain Bear is not a legal target', () => {
    const s = scenario([], { p1: { hand: ['Test Exorcism', 'Test Exorcism', 'Test Exorcism'] }, p2: { battlefield: ['Test Ghost', 'Test Idol', 'Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(throws(() => cast(s, 'Test Exorcism', { targets: [obj(bear)] }))).toBe(true);
    let t = resolveAll(cast(s, 'Test Exorcism', { targets: [obj(find(s, 'Test Ghost', 'battlefield', 'p2'))] }));
    expect(t.zones.exile.some((id) => t.objects[id]!.defId === 'Test Ghost')).toBe(true);
    t = resolveAll(cast(t, 'Test Exorcism', { targets: [obj(find(t, 'Test Idol', 'battlefield', 'p2'))] }));
    expect(t.zones.exile.some((id) => t.objects[id]!.defId === 'Test Idol')).toBe(true);
    expect(t.objects[bear]!.zone).toBe('battlefield');
  });
});

describe('CR 105.4, 701.8a: "Destroy all enchantments of the color of your choice."', () => {
  const PURGE = card('Test Purge', 'Sorcery', 'Destroy all enchantments of the color of your choice.', undefined, '{0}');
  const colored = (name: string, cost: string, color: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Enchantment', oracle_text: '', colors: [color] } as OracleCard);
  const WHITE = colored('Test White Aura', '{W}', 'W');
  const BLACK = colored('Test Black Curse', '{B}', 'B');
  const GLASS = card('Test Glass', 'Artifact', '', undefined, '{1}');
  const DEFS: CardDef[] = [PURGE, WHITE, BLACK, GLASS];
  it('is automated', () => expect(full(PURGE)).toBe(true));
  it('only the enchantments of the chosen color are destroyed, whoever controls them; other colors and non-enchantments stay', () => {
    const s = scenario([], { p1: { hand: ['Test Purge'], battlefield: ['Test White Aura', 'Test Black Curse', 'Test Glass'] }, p2: { battlefield: ['Test White Aura'] }, defs: DEFS });
    let t = cast(s, 'Test Purge');
    for (let i = 0; i < 10 && t.pending?.kind === 'priority'; i++) t = pass(t);
    expect(t.pending?.kind).toBe('chooseColor');
    t = resolveAll(answer(t, { kind: 'chooseColor', color: 'W' }));
    const left = t.zones.battlefield.map((id) => t.objects[id]!.defId).sort();
    expect(left).toEqual(['Test Black Curse', 'Test Glass']);
  });
});

describe('CR 506.1, 601.3, 602.5: "During combat, players can\'t cast instant spells or activate abilities that aren\'t mana abilities."', () => {
  const HAND = card('Test Hand', 'Enchantment', "During combat, players can't cast instant spells or activate abilities that aren't mana abilities.", undefined, '{1}');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.', undefined, '{0}');
  const TOY = card('Test Toy', 'Artifact', '{0}: You gain 1 life.', undefined, '{1}');
  const FLASH = card('Test Flash', 'Creature — Test', 'Flash', ['1', '1'], '{0}');
  const DEFS: CardDef[] = [HAND, ZAP, TOY, BEAR, FLASH];
  it('is automated', () => expect(full(HAND)).toBe(true));
  it('the instant and the ability are available in the main phase and refused in combat (declare attackers); with no Hand in play both are available in combat', () => {
    const plays = (hand: boolean): { main: number; combat: number } => {
      let s = scenario([], { p1: { hand: ['Test Zap'], battlefield: [...(hand ? ['Test Hand'] : []), 'Test Toy', 'Test Bear'] }, defs: DEFS });
      const count = (x: GameState): number => legalActions(x, 'p1').filter((a) => (a.kind === 'cast' && x.objects[a.object!]?.defId === 'Test Zap') || (a.kind === 'activate' && x.objects[a.object!]?.defId === 'Test Toy')).length;
      const main = count(s);
      s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]);
      return { main, combat: count(s) };
    };
    expect(plays(true)).toEqual({ main: 2, combat: 0 });
    // a spell that is not an instant (a creature with flash) stays castable in combat: only instants are banned
    let f = scenario([], { p1: { hand: ['Test Flash'], battlefield: ['Test Hand', 'Test Bear'] }, defs: DEFS });
    f = declareAttackers(toDeclareAttackers(f), [[find(f, 'Test Bear', 'battlefield', 'p1')]]);
    expect(legalActions(f, 'p1').some((a) => a.kind === 'cast' && f.objects[a.object!]?.defId === 'Test Flash')).toBe(true);
    expect(plays(false)).toEqual({ main: 2, combat: 2 });
  });
});

describe('CR 602.2b, 608.2h: "Tap an untapped creature you control: ~ gets +X/+0 until end of turn, where X is the power of the creature tapped this way."', () => {
  const WAGON = card('Test Wagon', 'Creature — Vehicle', 'Tap an untapped creature you control: This creature gets +X/+0 until end of turn, where X is the power of the creature tapped this way.', ['2', '2'], '{1}');
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['4', '4'], '{1}');
  const DEFS: CardDef[] = [WAGON, GIANT, BEAR];
  it('is automated', () => expect(full(WAGON)).toBe(true));
  it('tapping the 4/4 gives +4/+0, tapping the 2/2 gives +2/+0; it lasts until end of turn', () => {
    const s = scenario([], { p1: { battlefield: ['Test Wagon', 'Test Giant', 'Test Bear'] }, defs: DEFS });
    const wagon = find(s, 'Test Wagon', 'battlefield', 'p1');
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const go = (x: GameState, victim: ObjectId): GameState => {
      const a = legalActions(x, 'p1').find((l) => l.kind === 'activate' && l.object === wagon)!;
      return resolveAll(settle(act(x, a.action), { objects: [victim] }), { objects: [victim] });
    };
    const t = go(s, giant);
    expect(pt(t, wagon)).toBe('6/2');
    expect(t.objects[giant]!.tapped).toBe(true);
    const u = go(go(s, bear), giant);
    expect(pt(u, wagon)).toBe('8/2'); // +2 then +4
    const next = advanceTo(u, u.turn.number + 1, 'upkeep');
    expect(pt(next, wagon)).toBe('2/2');
    expect(getChars(next, wagon)!.power).toBe('2');
  });
});

describe('CR 615.1a, 510.1, 611.2a: "Prevent all combat damage blue creatures and black creatures would deal this turn."', () => {
  const colored = (name: string, color: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{1}', type_line: 'Creature — Test', oracle_text: '', colors: [color], power: '2', toughness: '2' } as OracleCard);
  const BLUE = colored('Test Blue', 'U');
  const BLACK = colored('Test Black', 'B');
  const RED = colored('Test Red', 'R');
  const FOG = card('Test Fog', 'Instant', 'Prevent all combat damage blue creatures and black creatures would deal this turn.', undefined, '{0}');
  const DEFS: CardDef[] = [BLUE, BLACK, RED, FOG];
  it('is automated', () => expect(full(FOG)).toBe(true));
  it('the blue and the black attacker deal no combat damage; the red one does; without the spell all three do', () => {
    const life = (x: GameState): number => x.players.find((p) => p.id === 'p2')!.life;
    const run = (names: string[], fog: boolean): number => {
      let s = scenario([], { p1: { hand: ['Test Fog'], battlefield: names }, defs: DEFS });
      const ids = names.map((n) => find(s, n, 'battlefield', 'p1'));
      if (fog) s = resolveAll(cast(s, 'Test Fog'));
      const before = life(s);
      s = attackWith(s, ids);
      for (let i = 0; i < 30 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending ? settle(s.pending.kind === 'priority' ? pass(s) : s) : s;
      return before - life(s);
    };
    expect(run(['Test Blue', 'Test Black', 'Test Red'], true)).toBe(2);
    expect(run(['Test Blue', 'Test Black', 'Test Red'], false)).toBe(6);
    expect(run(['Test Blue', 'Test Black'], true)).toBe(0);
  });
});
