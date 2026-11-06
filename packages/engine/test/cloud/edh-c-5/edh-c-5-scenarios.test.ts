/**
 * Commander EDHREC ranks 17,501-18,125, round edh-c-5: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 119.5, 103.4              "Your life total becomes equal to your starting life total." (the difference is gained or lost; Scryfall ruling 2017-07-14)
 *   CR 701.9a, 109.5             "Exile all permanents. You discard your hand." (only your hand)
 *   CR 604.3, 105.2, 613.1e     "~ is all colors." (a characteristic-defining ability: in every zone)
 *   CR 613.4c, 107.3             "All creatures get -X/-0, where X is the number of cards in your hand."
 *   CR 601.2f, 118.7, 611.3a     "During turns other than yours, ~ costs {3} more to cast."
 *   CR 508.1c, 506.2, 725.1      "As long as you're the monarch, creatures with power 2 or less can't attack you."
 *   CR 509.1b, 702.111b          "Each creature you control with menace can't be blocked except by three or more creatures."
 *   CR 205.3m, 611.3a            "As long as equipped creature is a Human or an Angel, it has vigilance."
 *   CR 604.1, 613.4c, 122.1f     "As long as an opponent has three or more poison counters, enchanted creature gets an additional +1/+0 and has first strike." (corrupted)
 *   CR 118.12a, 120.3, 701.8a    "Destroy target land unless its controller has ~ deal 2 damage to them." / "Counter target ... spell unless its controller has ~ deal 4 damage to them."
 *   CR 208.1, 107.3, 608.2h      "it gets +X/+X until end of turn, where X is the greatest power and/or toughness among other creatures you control."
 *   CR 701.21a, 608.2d, 101.4    "Each player sacrifices a land of their choice for each card in your hand."
 *   CR 120.3, 108.3, 303.4       "At the beginning of your upkeep, enchanted creature deals 1 damage to its owner."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, type GameState, type ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, tweak, toDeclareAttackers } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const inHand = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const onBf = (s: GameState, defId: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const colorsOf = (s: GameState, id: ObjectId): string => [...getChars(s, id)!.colors].sort().join('');

describe('CR 119.5, 103.4: "Your life total becomes equal to your starting life total."', () => {
  const MERCY = card('Test Restoring Rite', 'Sorcery', 'Your life total becomes equal to your starting life total. Lands you control don\'t untap during your next untap step.');
  const start = (mine: number, theirs = 20): GameState => tweak(scenario([], { defs: [MERCY], life: 20, p1: { hand: ['Test Restoring Rite'], battlefield: ['Plains'] } }), (s) => {
    s.players.find((p) => p.id === 'p1')!.life = mine;
    s.players.find((p) => p.id === 'p2')!.life = theirs;
  });
  it('is full', () => expect(full(MERCY)).toBe(true));
  it('gains the missing life from a low total (4 -> 20: 16 life gained, Scryfall ruling 2017-07-14)', () => {
    const s = resolveAll(cast(start(4), 'Test Restoring Rite'));
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('loses the extra life from a high total (25 -> 20)', () => {
    const s = resolveAll(cast(start(25), 'Test Restoring Rite'));
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: an opponent\'s life total is not touched', () => {
    const s = resolveAll(cast(start(4, 3), 'Test Restoring Rite'));
    expect(lifeOf(s, 'p2')).toBe(3);
  });
  it('the starting life total is the game\'s (30 in a game that starts at 30)', () => {
    const s0 = tweak(scenario([], { defs: [MERCY], life: 30, p1: { hand: ['Test Restoring Rite'] } }), (t) => { t.players.find((p) => p.id === 'p1')!.life = 2; });
    expect(lifeOf(resolveAll(cast(s0, 'Test Restoring Rite')), 'p1')).toBe(30);
  });
});

describe('CR 701.9a, 109.5: "Exile all permanents. You discard your hand."', () => {
  const WIPE = card('Test Final Wipe', 'Sorcery', 'Exile all permanents. You discard your hand.');
  const board = (): GameState => scenario([], {
    defs: [WIPE],
    p1: { hand: ['Test Final Wipe', 'Plains', 'Plains'], battlefield: ['Plains'] },
    p2: { hand: ['Plains', 'Plains', 'Plains'], battlefield: ['Plains'] },
  });
  it('is full', () => expect(full(WIPE)).toBe(true));
  it('exiles every permanent and discards your hand', () => {
    const s = resolveAll(cast(board(), 'Test Final Wipe'));
    expect(s.zones.battlefield.length).toBe(0);
    expect(inHand(s, 'p1')).toBe(0);
    expect(s.zones.graveyard['p1']!.length).toBe(3); // the spell and the two cards of the hand
  });
  it('negative: an opponent keeps their hand', () => {
    const s = resolveAll(cast(board(), 'Test Final Wipe'));
    expect(inHand(s, 'p2')).toBe(3);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
  });
});

describe('CR 604.3, 105.2: "~ is all colors." (a characteristic-defining ability, so in every zone; Scryfall ruling 2011-09-22)', () => {
  const COURIER = card('Test Prism Courier', 'Artifact Creature — Golem', 'Test Prism Courier is all colors.', ['3', '3']);
  const PLAIN = card('Test Plain Courier', 'Artifact Creature — Golem', '', ['3', '3']);
  const s0 = scenario([], { defs: [COURIER, PLAIN], p1: { battlefield: ['Test Prism Courier', 'Test Plain Courier'], hand: ['Test Prism Courier'] } });
  it('is full', () => expect(full(COURIER)).toBe(true));
  it('on the battlefield it is white, blue, black, red and green', () => expect(colorsOf(s0, onBf(s0, 'Test Prism Courier')[0]!)).toBe('BGRUW'));
  it('in the hand too (a characteristic-defining ability works in all zones)', () => expect(colorsOf(s0, find(s0, 'Test Prism Courier', 'hand', 'p1'))).toBe('BGRUW'));
  it('negative: a creature without the ability is colorless', () => expect(colorsOf(s0, onBf(s0, 'Test Plain Courier')[0]!)).toBe(''));
});

describe('CR 613.4c, 107.3: "All creatures get -X/-0, where X is the number of cards in your hand."', () => {
  const CAGE = card('Test Mind Prison', 'Legendary Enchantment', 'All creatures get -X/-0, where X is the number of cards in your hand.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['4', '4']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['5', '5']);
  const board = (mine: number, theirs: number): GameState => scenario([], {
    defs: [CAGE, BEAR, OGRE],
    p1: { battlefield: ['Test Mind Prison', 'Test Bear'], hand: Array(mine).fill('Plains') as string[] },
    p2: { battlefield: ['Test Ogre'], hand: Array(theirs).fill('Plains') as string[] },
  });
  it('is full', () => expect(full(CAGE)).toBe(true));
  it('every creature loses power equal to the cards in YOUR hand, toughness is untouched', () => {
    const s = board(3, 0);
    expect(pt(s, onBf(s, 'Test Bear')[0]!)).toBe('1/4');
    expect(pt(s, onBf(s, 'Test Ogre')[0]!)).toBe('2/5');
  });
  it('negative: an opponent\'s hand is not counted', () => {
    const s = board(1, 6);
    expect(pt(s, onBf(s, 'Test Bear')[0]!)).toBe('3/4');
    expect(pt(s, onBf(s, 'Test Ogre')[0]!)).toBe('4/5');
  });
  it('the count follows the hand as it changes (a card played leaves the hand: -2 -> -1)', () => {
    const s0 = board(2, 0);
    expect(pt(s0, onBf(s0, 'Test Bear')[0]!)).toBe('2/4');
    const s1 = tweak(s0, (t) => { t.zones.hand['p1']!.pop(); });
    expect(pt(s1, onBf(s1, 'Test Bear')[0]!)).toBe('3/4');
  });
});

describe('CR 601.2f, 118.7, 611.3a: "During turns other than yours, ~ costs {3} more to cast."', () => {
  const BACKLASH = card('Test Backlash', 'Instant', 'During turns other than yours, Test Backlash costs {3} more to cast.\nYou gain 1 life.');
  const base = (lands: number): GameState => scenario([], { defs: [BACKLASH], p1: { hand: ['Test Backlash'], battlefield: Array(lands).fill('Plains') as string[] } });
  const canCast = (s: GameState): boolean => applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Backlash', 'hand', 'p1') }).error === undefined;
  /** An opponent's turn where p1 holds priority. */
  const opponentsTurn = (s0: GameState): GameState => {
    let s = advanceTo(s0, 2, 'upkeep');
    for (let i = 0; i < 4 && s.pending?.player !== 'p1'; i++) s = pass(s);
    return s;
  };
  it('is full', () => expect(full(BACKLASH)).toBe(true));
  it('on your own turn it costs its printed {0}: castable with no mana', () => {
    expect(canCast(base(0))).toBe(true);
  });
  it('on an opponent\'s turn it costs {3}: not castable with two lands, castable with three', () => {
    const two = opponentsTurn(base(2));
    expect(two.turn.activePlayer).toBe('p2');
    expect(canCast(two)).toBe(false);
    const three = opponentsTurn(base(3));
    expect(canCast(three)).toBe(true);
    const paid = resolveAll(cast(three, 'Test Backlash')); // the cast taps exactly the three lands
    expect(paid.zones.battlefield.filter((id) => paid.objects[id]!.tapped).length).toBe(3);
    const own = resolveAll(cast(base(3), 'Test Backlash')); // on your own turn nothing is tapped
    expect(own.zones.battlefield.filter((id) => own.objects[id]!.tapped).length).toBe(0);
  });
});

describe('CR 508.1c, 506.2: "As long as you\'re the monarch, creatures with power 2 or less can\'t attack you."', () => {
  const QUEEN = card('Test Warden Queen', 'Legendary Creature — Human Noble', 'As long as you\'re the monarch, creatures with power 2 or less can\'t attack you.', ['3', '5']);
  const SCOUT = card('Test Scout', 'Creature — Human', '', ['2', '2']);
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3']);
  const setup = (monarch: boolean): GameState => tweak(scenario([], { defs: [QUEEN, SCOUT, BRUTE], p1: { battlefield: ['Test Scout', 'Test Brute'] }, p2: { battlefield: ['Test Warden Queen'] } }), (s) => {
    if (monarch) s.designations.monarch = 'p2';
  });
  const attackError = (s0: GameState, name: string): string | undefined => {
    const s = toDeclareAttackers(s0);
    const id = find(s, name, 'battlefield', 'p1');
    return applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] } }).error?.message;
  };
  it('is full', () => expect(full(QUEEN)).toBe(true));
  it('while its controller is the monarch a 2/2 cannot attack them, a 3/3 can', () => {
    expect(attackError(setup(true), 'Test Scout')).toBeDefined();
    expect(attackError(setup(true), 'Test Brute')).toBeUndefined();
  });
  it('negative: when its controller is not the monarch (nobody is) the 2/2 attacks freely', () => {
    expect(attackError(setup(false), 'Test Scout')).toBeUndefined();
  });
});

describe('CR 509.1b, 702.111b: "Each creature you control with menace can\'t be blocked except by three or more creatures."', () => {
  const BONDER = card('Test Howl Bonder', 'Creature — Human Warrior', 'Menace\nEach creature you control with menace can\'t be blocked except by three or more creatures.', ['2', '2']);
  const MENACER = card('Test Menacer', 'Creature — Human', 'Menace', ['3', '3']);
  const PLAINER = card('Test Plain Runner', 'Creature — Human', '', ['3', '3']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['2', '2']);
  const reply = (s: GameState, a: Parameters<typeof answer>[1]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });
  const board = (attacker: string, blockers: number, withBonder = true): { s: GameState; attacker: ObjectId } => {
    const s0 = scenario([], { defs: [BONDER, MENACER, PLAINER, OGRE], p1: { battlefield: [attacker, ...(withBonder ? ['Test Howl Bonder'] : [])] }, p2: { battlefield: Array(blockers).fill('Test Ogre') as string[] } });
    const a = find(s0, attacker, 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[a]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage');
    return { s, attacker: a };
  };
  const ogres = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
  it('is full', () => expect(full(BONDER)).toBe(true));
  it('a menace creature of yours is blocked by three: two blockers are not enough (menace alone would allow two), three are', () => {
    const { s, attacker } = board('Test Menacer', 3);
    const [a, b, c] = ogres(s);
    const blocks = (...ids: ObjectId[]) => reply(s, { kind: 'declareBlockers', blocks: ids.map((blocker) => ({ blocker, attacker })) });
    expect(applyAction(s, blocks(a!)).error).toBeDefined();
    expect(applyAction(s, blocks(a!, b!)).error?.message).toMatch(/three or more/);
    expect(applyAction(s, blocks(a!, b!, c!)).error).toBeUndefined();
  });
  it('negative: without the Bonder the same menace creature needs only two blockers', () => {
    const { s, attacker } = board('Test Menacer', 3, false);
    const [a, b] = ogres(s);
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [a!, b!].map((blocker) => ({ blocker, attacker })) })).error).toBeUndefined();
  });
  it('negative: a creature of yours without menace is blocked by one as usual', () => {
    const { s, attacker } = board('Test Plain Runner', 2);
    const [a] = ogres(s);
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: a!, attacker }] })).error).toBeUndefined();
  });
});

describe('CR 205.3m, 611.3a: "As long as equipped creature is a Human or an Angel, it has vigilance."', () => {
  const BRACERS = card('Test Gilded Bracers', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nAs long as equipped creature is a Human or an Angel, it has vigilance.\nEquip {2}');
  const equipped = (type: string): { s: GameState; id: ObjectId } => {
    const CREATURE = card('Test Wearer', type, '', ['2', '2']);
    const s0 = scenario([], { defs: [BRACERS, CREATURE], p1: { battlefield: ['Test Wearer'] } });
    const id = find(s0, 'Test Wearer', 'battlefield', 'p1');
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Gilded Bracers')]!.attachedTo = id; });
    return { s, id };
  };
  it('is full', () => expect(full(BRACERS)).toBe(true));
  it('a Human has vigilance, an Angel has vigilance, a Goblin does not (the +1/+1 applies to all)', () => {
    for (const [type, vig] of [['Creature — Human', true], ['Creature — Angel', true], ['Creature — Goblin', false], ['Creature — Human Goblin', true]] as const) {
      const { s, id } = equipped(type);
      expect(hasKeyword(getChars(s, id)!, 'vigilance'), type).toBe(vig);
      expect(pt(s, id), type).toBe('3/3');
    }
  });
});

describe('CR 604.1, 613.4c, 122.1f: "Corrupted -- As long as an opponent has three or more poison counters, enchanted creature gets an additional +1/+0 and has first strike."', () => {
  const GRACE = card('Test Zeal Aura', 'Enchantment — Aura', 'Flash\nEnchant creature\nEnchanted creature gets +1/+1.\nAs long as an opponent has three or more poison counters, enchanted creature gets an additional +1/+0 and has first strike.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const enchanted = (poison: number, who = 'p2'): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [GRACE, BEAR], p1: { battlefield: ['Test Bear'] } });
    const id = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = tweak(s0, (t) => {
      t.objects[put(t, 'p1', 'battlefield', 'Test Zeal Aura')]!.attachedTo = id;
      t.players.find((p) => p.id === who)!.poison = poison;
    });
    return { s, id };
  };
  it('is full', () => expect(full(GRACE)).toBe(true));
  it('with three poison counters on an opponent the creature is 4/3 with first strike', () => {
    const { s, id } = enchanted(3);
    expect(pt(s, id)).toBe('4/3');
    expect(hasKeyword(getChars(s, id)!, 'first strike')).toBe(true);
  });
  it('negative: with two poison counters it is only 3/3 without first strike', () => {
    const { s, id } = enchanted(2);
    expect(pt(s, id)).toBe('3/3');
    expect(hasKeyword(getChars(s, id)!, 'first strike')).toBe(false);
  });
  it('negative: poison on its own controller does not count ("an opponent")', () => {
    const { s, id } = enchanted(5, 'p1');
    expect(pt(s, id)).toBe('3/3');
  });
});

/** Pass priority until a yes/no decision is pending; the player it is put to. */
const drive1 = (s0: GameState): string | undefined => {
  let s = s0;
  for (let i = 0; i < 6 && s.pending !== null && s.pending.kind !== 'yesNo'; i++) s = pass(s);
  return s.pending?.kind === 'yesNo' ? s.pending.player : undefined;
};

describe('CR 118.12a, 120.3, 701.8a: "Destroy target land unless its controller has ~ deal 2 damage to them." and the counter form', () => {
  const DRILLER = card('Test Quake Dwarf', 'Creature — Dwarf', '{T}: Destroy target land unless its controller has Test Quake Dwarf deal 2 damage to them.', ['2', '2']);
  const DENIAL = card('Test Sting Denial', 'Instant', 'Counter target instant or sorcery spell unless its controller has Test Sting Denial deal 4 damage to them.');
  const BOLT = card('Test Small Rite', 'Sorcery', 'You gain 1 life.');
  it('are full', () => { expect(full(DRILLER)).toBe(true); expect(full(DENIAL)).toBe(true); });
  it('the land\'s controller may take 2 damage to keep the land', () => {
    const s0 = scenario([], { defs: [DRILLER], p1: { battlefield: ['Test Quake Dwarf'] }, p2: { battlefield: ['Plains'] } });
    const land = find(s0, 'Plains', 'battlefield', 'p2');
    const s1 = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Quake Dwarf', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [{ kind: 'object', id: land }] });
    const asked = drive1(s1);
    expect(asked).toBe('p2'); // the land's controller decides, not the Dwarf's
    const s = resolveAll(s1, { yes: true, targets: [{ kind: 'object', id: land }] });
    expect(s.zones.battlefield).toContain(land);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('declining destroys the land and no damage is dealt', () => {
    const s0 = scenario([], { defs: [DRILLER], p1: { battlefield: ['Test Quake Dwarf'] }, p2: { battlefield: ['Plains'] } });
    const land = find(s0, 'Plains', 'battlefield', 'p2');
    const s1 = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Quake Dwarf', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [{ kind: 'object', id: land }] });
    const s = resolveAll(s1, { yes: false, targets: [{ kind: 'object', id: land }] });
    expect(s.zones.battlefield).not.toContain(land);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('a spell countered unless its controller takes 4: its controller decides (takes 4 and the spell resolves, or it is countered)', () => {
    for (const [yes, dmg] of [[true, 16], [false, 20]] as const) {
      const s0 = scenario([], { defs: [DENIAL, BOLT], p1: { hand: ['Test Sting Denial'] }, p2: { hand: ['Test Small Rite'] } });
      // p1 (the active player) holds the denial; p2's sorcery is stood in by an instant-speed copy: p2 casts nothing, so the denial targets a spell p1 cast itself
      const s1 = tweak(s0, (t) => { put(t, 'p1', 'hand', 'Test Small Rite'); });
      let s = settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Small Rite', 'hand', 'p1') }));
      s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sting Denial', 'hand', 'p1') }), { targets: [{ kind: 'object', id: s.zones.stack.find((id) => s.objects[id]!.defId === 'Test Small Rite')! }] });
      s = resolveAll(s, { yes });
      expect(lifeOf(s, 'p1'), `yes=${yes}`).toBe(yes ? dmg + 1 : 20);
    }
  });
});

describe('CR 208.1, 107.3, 608.2h: "it gets +X/+X until end of turn, where X is the greatest power and/or toughness among other creatures you control."', () => {
  const MUSCLE = card('Test Rhino Muscle', 'Creature — Rhino Warrior', 'Whenever Test Rhino Muscle attacks or blocks, it gets +X/+X until end of turn, where X is the greatest power and/or toughness among other creatures you control.', ['4', '4']);
  const WALL = card('Test Wall', 'Creature — Wall', '', ['1', '7']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['6', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['9', '9']);
  const attack = (mine: string[], theirs: string[] = []): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [MUSCLE, WALL, BEAR, OGRE], p1: { battlefield: ['Test Rhino Muscle', ...mine] }, p2: { battlefield: theirs } });
    const id = find(s0, 'Test Rhino Muscle', 'battlefield', 'p1');
    const s = settle(declareAttackers(toDeclareAttackers(s0), [[id]]));
    return { s: resolveAll(s), id };
  };
  it('is full', () => expect(full(MUSCLE)).toBe(true));
  it('X is the larger of the greatest power (6) and the greatest toughness (7) of the others: +7/+7', () => {
    const { s, id } = attack(['Test Wall', 'Test Bear']);
    expect(pt(s, id)).toBe('11/11');
  });
  it('X is fixed as the trigger resolves (CR 608.2h): losing the larger creature afterwards changes nothing', () => {
    const { s, id } = attack(['Test Wall', 'Test Bear']);
    const t = tweak(s, (x) => { x.zones.battlefield = x.zones.battlefield.filter((o) => x.objects[o]!.defId !== 'Test Wall'); });
    expect(pt(t, id)).toBe('11/11');
  });
  it('negative: creatures an opponent controls are not counted', () => {
    const { s, id } = attack(['Test Bear'], ['Test Ogre']);
    expect(pt(s, id)).toBe('10/10'); // X = 6 (the Bear's power), not 9
  });
  it('negative: with no other creature X is 0 (its own stats are not counted)', () => {
    const { s, id } = attack([]);
    expect(pt(s, id)).toBe('4/4');
  });
});

describe('CR 701.21a, 608.2d, 101.4: "Each player sacrifices a land of their choice for each card in your hand."', () => {
  const RUIN = card('Test Ruin Rite', 'Sorcery', 'Each player sacrifices a land of their choice for each card in your hand.');
  const board = (handSize: number): GameState => scenario([], {
    defs: [RUIN],
    p1: { hand: ['Test Ruin Rite', ...(Array(handSize).fill('Plains') as string[])], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] },
    p2: { hand: ['Plains'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] },
  });
  const lands = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).length;
  it('is full', () => expect(full(RUIN)).toBe(true));
  it('every player sacrifices one land per card in the caster\'s hand (the spell itself is no longer in the hand): 2 cards -> 2 lands each', () => {
    const s = resolveAll(cast(board(2), 'Test Ruin Rite'));
    expect(lands(s, 'p1')).toBe(2);
    expect(lands(s, 'p2')).toBe(2);
  });
  it('negative: the number is the CASTER\'s hand, not the opponent\'s (opponent holds 1, caster holds 3)', () => {
    const s = resolveAll(cast(board(3), 'Test Ruin Rite'));
    expect(lands(s, 'p2')).toBe(1);
  });
  it('negative: an empty hand sacrifices nothing', () => {
    const s = resolveAll(cast(board(0), 'Test Ruin Rite'));
    expect(lands(s, 'p1')).toBe(4);
    expect(lands(s, 'p2')).toBe(4);
  });
});

describe('CR 120.3, 108.3: "At the beginning of your upkeep, enchanted creature deals 1 damage to its owner."', () => {
  const SLAVE = card('Test Bond Aura', 'Enchantment — Aura', 'Enchant creature\nYou control enchanted creature.\nAt the beginning of your upkeep, enchanted creature deals 1 damage to its owner.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(SLAVE)).toBe(true));
  it('the creature (owned by p2, enchanted by p1) deals 1 damage to p2, its owner, never to the Aura\'s controller', () => {
    const s0 = scenario([], { defs: [SLAVE, BEAR], p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = tweak(s0, (t) => {
      t.objects[put(t, 'p1', 'battlefield', 'Test Bond Aura')]!.attachedTo = bear;
      t.objects[bear]!.controller = 'p1';
    });
    let s = advanceTo(s1, 3, 'upkeep');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(life(s, 'p1')).toBe(20);
  });
});
