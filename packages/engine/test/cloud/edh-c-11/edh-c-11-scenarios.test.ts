/**
 * Commander lane edh-c, round edh-c-11 (second pass of EDHREC ranks 16,876 to 17,500): the round's readings played through the engine with synthetic cards (invented
 * names), compiled by the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 509.1c, 611.2c     "Each creature your opponents control blocks this turn if able." (Predatory Rampage: creatures that enter later are bound too)
 *   CR 509.1a, 611.2a     "gets +2/+2 until end of turn and can block an additional creature this turn" (Act of Heroism: cumulative, ends with the turn)
 *   CR 615.1a, 510.1      "Prevent all combat damage that would be dealt to and dealt by those creatures this turn." (Energy Arc: only the targets)
 *   CR 611.2a, 613.1d     "target artifact or creature becomes an artifact creature with base power and toughness 5/5 and gains flying" (Iron Man: no duration)
 *   CR 613.4b, 205.1b     "{X}: Until end of turn, target creature you control has base power and toughness X/X and becomes a Giant in addition to its other types."
 *   CR 509.1c, 611.2a     "Until end of turn, target creature gets +6/+6 and gains trample, and all creatures able to block it this turn do so." (Revenge of the Hunted)
 *   CR 613.1d-f, 602.5    "It gains defender and becomes a colorless artifact in addition to its other types. Its activated abilities can't be activated." (Xathrid Gorgon)
 *   CR 603.5, 608.2d      "you may have Ally creatures you control get +1/+0 until end of turn" (Akoum Battlesinger)
 *   CR 120.3, 705.1       "If you lose the flip, ~ deals 2 damage to itself." (Goblin Bangchuckers)
 *   CR 608.2c, 701.9a     "Then that player discards a card if you control a Zombie." (Compelling Deterrence: checked after the return)
 *   CR 601.2f, 602.2b     "This ability costs {1} more to activate for each card in your hand." (Loreseeker's Stone)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { maxBlocks } from '../../../src/statics/hooks';
import { act, advanceTo, answer, find, findAll, labels, pass, put, scenario } from '../../m3/scenario';
import { declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, declareAttackers } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const rejected = (s: GameState, f: (s: GameState) => GameState): boolean => { try { f(s); return false; } catch (e) { return /rejected|not obeyed|509\.1c/i.test(String(e)); } };
const names = (s: GameState, zone: 'battlefield' | 'hand' | 'graveyard', p: string): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p) : s.zones[zone][p]!).map((id) => s.objects[id]!.defId);

/** A whole combat: attackers, blockers and the damage assignments by attacker/blocker; replacement orderings are answered with the first option. */
function combat(s0: GameState, attack: ObjectId[], block: [ObjectId, ObjectId][], assign: Record<ObjectId, { id: string; amount: number }[]>): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attack.map((id) => [id] as [ObjectId]));
  for (let i = 0; i < 80 && s.turn.step !== 'endCombat'; i++) {
    const d = s.pending as { kind: string; options?: { id: string }[]; attacker?: ObjectId; blocker?: ObjectId } | undefined;
    if (d?.kind === 'declareBlockers') s = declareBlockers(s, block);
    else if (d?.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: assign[(d.attacker ?? d.blocker)!] ?? [] });
    else if (d?.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: d.options![0]!.id });
    else s = pass(s);
  }
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{1}');
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');

describe('CR 509.1c, 611.2c: "Each creature your opponents control blocks this turn if able."', () => {
  const RAMPAGE = card('Test Rampage', 'Sorcery', 'Creatures you control get +3/+3 until end of turn. Each creature your opponents control blocks this turn if able.');
  const DEFS: CardDef[] = [RAMPAGE, BEAR, OGRE];
  it('is automated', () => expect(full(RAMPAGE)).toBe(true));
  it('every creature the opponent controls must block, a creature that enters later too; not blocking at all is refused', () => {
    let s = scenario([], { p1: { hand: ['Test Rampage'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Rampage'));
    put(s, 'p2', 'battlefield', 'Test Bear'); // enters after the spell resolved
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s, mine)).toBe('5/5');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[mine]]));
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const bear2 = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(true);
    expect(rejected(s, (x) => declareBlockers(x, [[ogre, mine]]))).toBe(true); // the creature that entered later must block as well
    expect(declareBlockers(s, [[ogre, mine], [bear2, mine]]).combat!.blockers).toHaveLength(2);
  });
  it('negative: without the spell nothing is required', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]));
    expect(declareBlockers(s, []).combat!.blockers).toHaveLength(0);
  });
});

describe('CR 509.1a, 611.2a: "gets +2/+2 until end of turn and can block an additional creature this turn"', () => {
  const HEROISM = card('Test Heroism', 'Instant', 'Untap target creature. It gets +2/+2 until end of turn and can block an additional creature this turn.');
  const DEFS: CardDef[] = [HEROISM, BEAR, OGRE];
  it('is automated', () => expect(full(HEROISM)).toBe(true));
  it('the target blocks two creatures, a second copy makes it three (cumulative); the others still block one; it ends with the turn', () => {
    let s = scenario([], { p1: { hand: ['Test Heroism', 'Test Heroism'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s.objects[bear]!.tapped = true;
    s = resolveAll(cast(s, 'Test Heroism', { targets: [obj(bear)] }));
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(pt(s, bear)).toBe('4/4');
    expect(maxBlocks(s, bear)).toBe(2);
    expect(maxBlocks(s, ogre)).toBe(1);
    s = resolveAll(cast(s, 'Test Heroism', { targets: [obj(bear)] }));
    expect(maxBlocks(s, bear)).toBe(3);
    expect(pt(s, bear)).toBe('6/6');
    s = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(maxBlocks(s, bear)).toBe(1);
    expect(pt(s, bear)).toBe('2/2');
  });
});

describe('CR 615.1a, 510.1: "Prevent all combat damage that would be dealt to and dealt by those creatures this turn."', () => {
  const ARC = card('Test Arc', 'Instant', 'Untap any number of target creatures. Prevent all combat damage that would be dealt to and dealt by those creatures this turn.');
  const DEFS: CardDef[] = [ARC, BEAR, OGRE];
  it('is automated', () => expect(full(ARC)).toBe(true));
  it('damage to and from the targeted creatures is prevented, the other creatures deal and take damage as usual', () => {
    let s = scenario([], { p1: { hand: ['Test Arc'], battlefield: ['Test Ogre', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const myOgre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const myBear = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirOgre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const theirBear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Arc', { targets: [obj(myOgre), obj(theirBear)] }));
    // my targeted Ogre is blocked by their targeted Bear (nothing happens); my untargeted Bear is blocked by their untargeted Ogre (the Bear dies, the Ogre takes 2)
    const blocks: [ObjectId, ObjectId][] = [[theirBear, myOgre], [theirOgre, myBear]];
    s = combat(s, [myOgre, myBear], blocks, { [myOgre]: [{ id: theirBear, amount: 3 }], [myBear]: [{ id: theirOgre, amount: 2 }], [theirBear]: [{ id: myOgre, amount: 2 }], [theirOgre]: [{ id: myBear, amount: 3 }] });
    expect(s.objects[theirBear]!.damage).toBe(0);
    expect(s.objects[myOgre]!.damage).toBe(0);
    expect(s.zones.battlefield).toContain(theirBear);
    expect(s.zones.battlefield).not.toContain(myBear);
    expect(s.objects[theirOgre]!.damage).toBe(2);
  });
});

describe('CR 611.2a, 613.1d, 613.4b: "target artifact or creature becomes an artifact creature with base power and toughness 5/5 and gains flying" (no duration)', () => {
  const IRON = card('Test Ironclad', 'Legendary Artifact Creature — Human Hero', 'Flying\nAt the beginning of combat on your turn, target artifact or creature becomes an artifact creature with base power and toughness 5/5 and gains flying.', ['4', '4'], '{0}');
  const DEFS: CardDef[] = [IRON, ROCK, BEAR];
  it('is automated', () => expect(full(IRON)).toBe(true));
  it('a noncreature artifact becomes a 5/5 flying artifact creature for good (still there next turn); an opposing Bear can be the target too (5/5, still a Bear)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ironclad', 'Test Rock'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const rock = find(s, 'Test Rock', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.pending?.kind === 'chooseTargets', 'the trigger target');
    s = resolveAll(s, { targets: [obj(rock)] });
    const c = getChars(s, rock)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(pt(s, rock)).toBe('5/5');
    expect(c.keywords.map((k) => k.keyword)).toContain('flying');
    for (let i = 0; i < 200 && !(s.turn.number >= 3 && s.pending?.kind === 'chooseTargets'); i++) {
      const d = s.pending?.kind;
      s = d === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : d === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : d === 'chooseTargets' ? settle(s, { targets: [obj(rock)] }) : pass(s);
    }
    expect(getChars(s, rock)!.types).toContain('Creature'); // still a creature a turn later
    expect(pt(s, rock)).toBe('5/5');
    // a creature target: its base becomes 5/5 and it gains the Artifact type; the Bear keeps its own subtype
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(pt(s, bear)).toBe('2/2');
    s = resolveAll(s, { targets: [obj(bear)] });
    expect(pt(s, bear)).toBe('5/5');
    expect(getChars(s, bear)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(getChars(s, bear)!.subtypes).toContain('Bear');
    expect(getChars(s, bear)!.keywords.map((k) => k.keyword)).toContain('flying');
  });
});

describe('CR 613.4b, 205.1b: "{X}: Until end of turn, target creature you control has base power and toughness X/X and becomes a Giant in addition to its other types."', () => {
  const MINSC = card('Test Ranger', 'Legendary Creature — Human Ranger', '{X}: Until end of turn, target creature you control has base power and toughness X/X and becomes a Giant in addition to its other types. Activate only as a sorcery.', ['3', '3'], '{0}');
  const DEFS: CardDef[] = [MINSC, BEAR];
  it('is automated', () => expect(full(MINSC)).toBe(true));
  it('X = 4: the Bear is a 4/4 Giant Bear until end of turn, then a 2/2 Bear again; a +1/+1 counter still applies', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Ranger', 'Test Bear', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[bear]!.counters['+1/+1'] = 1;
    s = advanceTo(s, 3, 'main1');
    expect(pt(s, bear)).toBe('3/3');
    const ranger = find(s, 'Test Ranger', 'battlefield', 'p1');
    let t = act(s, { type: 'activate', player: 'p1', source: ranger, ability: activatedAbilities(s, s.objects[ranger]!)[0]!.key });
    if (t.pending?.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: 4 });
    s = resolveAll(t, { targets: [obj(bear)] });
    expect(pt(s, bear)).toBe('5/5');
    expect(getChars(s, bear)!.subtypes).toEqual(expect.arrayContaining(['Bear', 'Giant']));
    s = advanceTo(s, 5, 'main1');
    expect(pt(s, bear)).toBe('3/3');
    expect(getChars(s, bear)!.subtypes).not.toContain('Giant');
  });
});

describe('CR 509.1c, 611.2a: "Until end of turn, target creature gets +6/+6 and gains trample, and all creatures able to block it this turn do so."', () => {
  const REVENGE = card('Test Hunt', 'Sorcery', 'Until end of turn, target creature gets +6/+6 and gains trample, and all creatures able to block it this turn do so.');
  const DEFS: CardDef[] = [REVENGE, BEAR, OGRE];
  it('is automated', () => expect(full(REVENGE)).toBe(true));
  it('the target is 8/8 with trample and every creature able to block it must block it; the other attacker is not lured', () => {
    let s = scenario([], { p1: { hand: ['Test Hunt'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Hunt', { targets: [obj(bear)] }));
    expect(pt(s, bear)).toBe('8/8');
    expect(getChars(s, bear)!.keywords.map((k) => k.keyword)).toContain('trample');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[bear], [ogre]]));
    const [a, b] = [find(s, 'Test Ogre', 'battlefield', 'p2'), find(s, 'Test Bear', 'battlefield', 'p2')];
    expect(rejected(s, (x) => declareBlockers(x, [[a, ogre]]))).toBe(true); // both must block the lured creature
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(true);
    expect(declareBlockers(s, [[a, bear], [b, bear]]).combat!.blockers).toHaveLength(2);
  });
});

describe('CR 613.1d-f, 602.5, 611.2a: "It gains defender and becomes a colorless artifact in addition to its other types. Its activated abilities can\'t be activated."', () => {
  const GORGON = card('Test Gorgon', 'Creature — Gorgon', '{0}: Put a petrification counter on target creature. It gains defender and becomes a colorless artifact in addition to its other types. Its activated abilities can\'t be activated.', ['2', '2']);
  const MAGE = card('Test Mage', 'Creature — Wizard', '{0}: You gain 1 life.', ['1', '1']);
  const DEFS: CardDef[] = [GORGON, MAGE, BEAR];
  it('is automated', () => expect(full(GORGON)).toBe(true));
  it('the target is a colorless artifact creature with defender that can\'t activate its abilities, a turn later too and without the counter; its subtypes stay', () => {
    let s = scenario([], { p1: { battlefield: ['Test Gorgon'] }, p2: { battlefield: ['Test Mage', 'Test Mage', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const [mage, control] = findAll(s, 'Test Mage', 'battlefield', 'p2') as [ObjectId, ObjectId];
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const gorgon = find(s, 'Test Gorgon', 'battlefield', 'p1');
    expect(activatedAbilities(s, s.objects[mage]!).length).toBeGreaterThan(0);
    let t = act(s, { type: 'activate', player: 'p1', source: gorgon, ability: activatedAbilities(s, s.objects[gorgon]!)[0]!.key });
    s = resolveAll(t, { targets: [obj(mage)] });
    const c = getChars(s, mage)!;
    expect(counters(s, mage, 'petrification')).toBe(1);
    expect(c.types).toEqual(expect.arrayContaining(['Creature', 'Artifact']));
    expect(c.subtypes).toContain('Wizard');
    expect(c.colors).toEqual([]);
    expect(c.keywords.map((k) => k.keyword)).toContain('defender');
    const at4 = advanceTo(s, 4, 'main1');
    expect(rejected(at4, (x) => act(x, { type: 'activate', player: 'p2', source: mage, ability: activatedAbilities(x, x.objects[mage]!)[0]!.key }))).toBe(true);
    expect(rejected(at4, (x) => act(x, { type: 'activate', player: 'p2', source: control, ability: activatedAbilities(x, x.objects[control]!)[0]!.key }))).toBe(false); // the other Mage still can
    // the other creature is untouched
    expect(getChars(s, bear)!.types).not.toContain('Artifact');
    // it stays so when the counter is gone and on later turns
    s.objects[mage]!.counters = {};
    s = advanceTo(s, 6, 'main1');
    expect(getChars(s, mage)!.types).toContain('Artifact');
    expect(rejected(s, (x) => act(x, { type: 'activate', player: 'p2', source: mage, ability: activatedAbilities(x, x.objects[mage]!)[0]!.key }))).toBe(true);
  });
});

describe('CR 603.5, 608.2d: "you may have Ally creatures you control get +1/+0 until end of turn"', () => {
  const SINGER = card('Test Singer', 'Creature — Kor Ally', 'Haste\nWhenever this creature or another Ally you control enters, you may have Ally creatures you control get +1/+0 until end of turn.', ['2', '2'], '{0}');
  const SCOUT = card('Test Scout', 'Creature — Kor Ally', '', ['1', '1'], '{0}');
  const DEFS: CardDef[] = [SINGER, SCOUT, BEAR];
  it('is automated', () => expect(full(SINGER)).toBe(true));
  it('accepted: every Ally you control gets +1/+0, a non-Ally does not; declined: nobody does', () => {
    for (const yes of [true, false]) {
      let s = scenario([], { p1: { hand: ['Test Scout'], battlefield: ['Test Singer', 'Test Bear'] }, defs: DEFS });
      s = advanceTo(s, 3, 'main1');
      s = resolveAll(cast(s, 'Test Scout'), { yes });
      const scout = find(s, 'Test Scout', 'battlefield', 'p1');
      const singer = find(s, 'Test Singer', 'battlefield', 'p1');
      expect(pt(s, scout)).toBe(yes ? '2/1' : '1/1');
      expect(pt(s, singer)).toBe(yes ? '3/2' : '2/2');
      expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    }
  });
});

describe('CR 120.3, 705.1: "If you win the flip, ~ deals 2 damage to any target. If you lose the flip, ~ deals 2 damage to itself."', () => {
  const BANG = card('Test Bangchucker', 'Creature — Goblin', '{0}: Flip a coin. If you win the flip, this creature deals 2 damage to any target. If you lose the flip, this creature deals 2 damage to itself.', ['1', '3']);
  const DEFS: CardDef[] = [BANG, BEAR];
  it('is automated', () => expect(full(BANG)).toBe(true));
  it('a lost flip hurts only the creature itself, a won flip only the target (both outcomes found by seed)', () => {
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      let s = scenario([], { seed, p1: { battlefield: ['Test Bangchucker'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
      s = advanceTo(s, 3, 'main1');
      const bang = find(s, 'Test Bangchucker', 'battlefield', 'p1');
      const bear = find(s, 'Test Bear', 'battlefield', 'p2');
      s = resolveAll(act(s, { type: 'activate', player: 'p1', source: bang, ability: activatedAbilities(s, s.objects[bang]!)[0]!.key }), { targets: [obj(bear)] });
      const mine = s.objects[bang]?.damage ?? 0;
      const theirs = s.objects[bear]?.zone === 'battlefield' ? s.objects[bear]!.damage : 99;
      if (mine === 2) { seen.add('lost'); expect(theirs).toBe(0); }
      else { seen.add('won'); expect(mine).toBe(0); expect(theirs === 99 || theirs === 2).toBe(true); }
    }
    expect([...seen].sort()).toEqual(['lost', 'won']);
  });
});

describe('CR 608.2c, 701.9a: "Return target nonland permanent to its owner\'s hand. Then that player discards a card if you control a Zombie."', () => {
  const DETER = card('Test Deter', 'Instant', 'Return target nonland permanent to its owner\'s hand. Then that player discards a card if you control a Zombie.');
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', ['2', '2'], '{1}');
  const DEFS: CardDef[] = [DETER, GHOUL, BEAR, OGRE];
  it('is automated', () => expect(full(DETER)).toBe(true));
  const play = (zombie: boolean, target: string, hand2: string[] = ['Test Ogre']): GameState => {
    let s = scenario([], { p1: { hand: ['Test Deter'], battlefield: zombie ? ['Test Ghoul'] : [] }, p2: { battlefield: ['Test Bear'], hand: hand2 }, defs: DEFS });
    s = advanceTo(s, 1, 'main1'); // before anyone draws
    const tgt = find(s, target, 'battlefield', target === 'Test Ghoul' ? 'p1' : 'p2');
    return resolveAll(cast(s, 'Test Deter', { targets: [obj(tgt)] }));
  };
  it('with a Zombie the owner discards a card (their choice) after the return', () => {
    const s = play(true, 'Test Bear');
    expect(s.zones.hand.p2!.length + s.zones.graveyard.p2!.length).toBe(2);
    expect(s.zones.graveyard.p2!.length).toBe(1);
  });
  it('the returned card may be the one discarded when it is the only card in hand', () => {
    const s = play(true, 'Test Bear', []);
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Bear']);
  });
  it('negative: no Zombie, no discard; and returning your only Zombie (checked after the return) discards nothing', () => {
    const s = play(false, 'Test Bear');
    expect(s.zones.graveyard.p2!.length).toBe(0);
    const t = play(true, 'Test Ghoul');
    expect(t.zones.graveyard.p1!.map((id) => t.objects[id]!.defId)).toEqual(['Test Deter']);
  });
});

describe('CR 601.2f, 602.2b: "This ability costs {1} more to activate for each card in your hand."', () => {
  const STONE = card('Test Stone', 'Artifact', '{3}, {T}: Draw three cards. This ability costs {1} more to activate for each card in your hand.', undefined, '{0}');
  const DEFS: CardDef[] = [STONE, BEAR];
  it('is automated', () => expect(full(STONE)).toBe(true));
  it('with two other cards in hand it costs {5}: four lands are not enough, five are; with an empty hand {3} do', () => {
    const can = (lands: number, hand: number): boolean => {
      const s = scenario(['Plains'], { p1: { battlefield: ['Test Stone', ...Array(lands).fill('Plains')], hand: Array(hand).fill('Test Bear') }, defs: DEFS });
      const stone = find(s, 'Test Stone', 'battlefield', 'p1');
      const key = activatedAbilities(s, s.objects[stone]!).find((i) => i.def.isMana !== true)!.key;
      try {
        let t = act(s, { type: 'activate', player: 'p1', source: stone, ability: key });
        t = settle(t, {});
        return s.zones.hand.p1!.length + 3 <= resolveAll(t).zones.hand.p1!.length || t.zones.stack.length > 0;
      } catch { return false; }
    };
    expect(can(3, 0)).toBe(true);
    expect(can(4, 2)).toBe(false);
    expect(can(5, 2)).toBe(true);
  });
});
