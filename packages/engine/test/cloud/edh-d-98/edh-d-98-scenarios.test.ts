/**
 * Must-finish round edh-d-98 (coordinator D, EDHREC ranks 5,001-10,000, group graveyard-exile-cast): the behaviour it added, played through the engine with
 * synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 *
 *   CR 106.4, 605.1a, 601.2a, 702.85a  'Enchanted permanent has "{T}: Target player adds two mana of any one color. The next spell they cast this turn has cascade."'
 *                                     (Bigger on the Inside): the TARGET player gets the mana and the cascade rider; the ability targets, so it is not a mana ability
 *   CR 107.3, 107.3b, 601.2b, 701.20a  "Each opponent reveals cards from the top of their library until they reveal X land cards, then puts all cards revealed this way into
 *                                     their graveyard. X can't be 0." (Mind Grind): X is announced from 1; cast without paying its mana cost it can't be cast (ruling 2013-01-24)
 *   CR 607.2a, 614.1a, 119.3, 608.2c   "If you would draw a card, exile the top card of your library face down instead." + "{B}: Return all cards exiled with ~ to their owner's hand
 *                                     and you lose that much life." (Asmodeus the Archfiend): the replacement is the linked instruction; the life lost is the number of cards returned
 *   CR 400.7, 608.2c, 608.2h           "Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its power to each
 *                                     other creature." (Too Greedily, Too Deep): "that creature" and "each other" name the permanent the card became (ruling 2023-06-16)
 *   CR 714.2b, 608.2d, 701.8a, 101.4   "III -- Each player chooses three nonland permanents they control. Destroy all other nonland permanents." (Fall of the First Civilization)
 *   CR 607.2a, 603.4, 205.2a, 305.1    "When this creature enters, exile a card from a graveyard." + "Whenever a player plays a land or casts a spell, if it shares a card type with the
 *                                     exiled card, this creature deals 2 damage to that player." (Cemetery Gatekeeper; ruling 2021-11-19: card types, not supertypes or subtypes)
 *   CR 702.29c, 113.6k, 614.15, 400.7  "When you cycle this card, shuffle it into your library from your graveyard. If you've cycled a card named ~ four or more times this game, put it
 *                                     onto the battlefield from your graveyard instead." (Yidaro, Wandering Monster; rulings 2020-04-17: any cards of that name count)
 *   CR 603.2, 113.6k, 113.6m            "At the beginning of your upkeep, ~ deals 2 damage to each opponent. This ability triggers only if ~ is on the battlefield or if ~ is in your
 *                                     graveyard and you control a Giant." (Quakebringer; ruling 2021-02-05: on the battlefield it triggers with no Giant)
 *   CR 614.1a, 121.2, 903.3            'Commander creatures you own have "The first time you would draw a card each turn, instead look at the top two cards of your library. Put one
 *                                     of them into your graveyard and the other back on top of your library. Then draw a card."' (Scion of Halaster): the first draw proposed in the
 *                                     turn is replaced; the replacement's own draw is the second, and is not
 *   CR 603.7c, 608.2h, 701.20a, 701.24a "Exile all creatures you control. At the beginning of the next end step, reveal cards from the top of your library until you reveal that many
 *                                     creature cards, put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library."
 *                                     (Synthetic Destiny; rulings 2015-11-04: tokens exiled count; the exiled cards stay exiled)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, pool, put, scenario } from '../../m3/scenario';
import { card, full, settle } from '../cmd3/helpers';
import { commanderOptions } from '../../../src/index';
import { legend } from '../../m11/rules/helpers';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { clone } from '../../../src/util/clone';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const lifeOf = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;

// ---- Bigger on the Inside --------------------------------------------------------------------------------------------------------------------------------
const PORTAL = card('Test Portal Charm', 'Enchantment — Aura', 'Enchant artifact or land\nEnchanted permanent has "{T}: Target player adds two mana of any one color. The next spell they cast this turn has cascade."', undefined, '{3}{R}{G}');
const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.', undefined, '{1}');
const FREEBIE = card('Test Freebie', 'Instant', 'You gain 3 life.');
const SPARK2 = card('Test Spark Too', 'Instant', 'You gain 2 life.', undefined, '{1}');

describe('CR 106.4, 605.1a, 702.85a: Enchanted permanent has "{T}: Target player adds two mana of any one color. The next spell they cast this turn has cascade." (Bigger on the Inside)', () => {
  it('the card is fully automated', () => {
    expect(full(PORTAL), JSON.stringify(PORTAL.automation)).toBe(true);
  });
  const board = (): GameState => {
    const s = scenario(['Mountain'], { defs: [PORTAL, BOLT, SPARK2, FREEBIE], p1: { hand: ['Test Spark', 'Test Spark Too', 'Test Freebie'], battlefield: ['Mountain'] }, p2: { hand: ['Test Spark'] } });
    s.objects[put(s, 'p1', 'battlefield', 'Test Portal Charm')]!.attachedTo = find(s, 'Mountain', 'battlefield');
    return s;
  };
  const activate = (s0: GameState, target: 'p1' | 'p2'): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object !== undefined && nameOf(s0, x.object) === 'Mountain' && /target player/i.test(x.label));
    expect(a, JSON.stringify(legal(s0, 'p1', 'activate').map((x) => x.label))).toBeDefined();
    expect(a!.isMana).not.toBe(true); // CR 605.1a: an ability with a target is not a mana ability
    let s = act(s0, a!.action);
    s = settle(s, { targets: [{ kind: 'player', id: target } as never] });
    return s;
  };
  /** Casting a spell with cascade puts the spell and its cascade trigger on the stack (CR 702.85a: "When you cast this spell"); one without, only the spell. */
  const cascades = (s: GameState): number => s.zones.stack.filter((id) => s.objects[id]!.kind === 'ability').length;
  /** Both pass; the ability resolves and the player who adds the mana picks its color (red). */
  const resolveTop = (s0: GameState, chooser: 'p1' | 'p2'): GameState => {
    const s = pass(pass(s0));
    expect(s.pending?.kind).toBe('chooseColor');
    expect(s.pending?.player).toBe(chooser); // CR 106.4: the player who adds the mana chooses its color
    return settle(answer(s, { kind: 'chooseColor', color: 'R' }));
  };
  it('the ability uses the stack (it targets); as it resolves the target player (you) adds two mana of one color and your next spell has cascade, the one after it not', () => {
    let s = activate(board(), 'p1');
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s, 'p1');
    expect(s.zones.stack.length).toBe(0);
    expect(pool(s, 'p1')).toBe('RR'); // two mana of ONE color
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand') });
    s = settle(s);
    expect(s.zones.stack).toHaveLength(2);
    expect(cascades(s)).toBe(1);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark Too', 'hand') });
    s = settle(s);
    expect(s.zones.stack).toHaveLength(3);
    expect(cascades(s)).toBe(1);
  });
  it('negative: targeting the opponent: THEY get the mana and the cascade rider; your own next spell has no cascade', () => {
    let s = activate(board(), 'p2');
    s = resolveTop(s, 'p2');
    expect(pool(s, 'p1')).toBe('');
    expect(pool(s, 'p2')).toBe('RR');
    expect(s.pending?.player).toBe('p1');
    // the opponent casts their instant with that mana once they get priority: it has cascade
    let t = settle(pass(s));
    expect(t.pending?.player).toBe('p2');
    t = settle(act(t, { type: 'cast', player: 'p2', card: find(t, 'Test Spark', 'hand', 'p2') }));
    expect(t.zones.stack).toHaveLength(2);
    expect(cascades(t)).toBe(1);
    // and your own spell (a free one: the Mountain is tapped) has none
    const u = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Freebie', 'hand') }));
    expect(u.zones.stack).toHaveLength(1);
    expect(cascades(u)).toBe(0);
  });
});

// ---- Mind Grind ------------------------------------------------------------------------------------------------------------------------------------------
const GRIND = card('Test Grinder', 'Sorcery', "Each opponent reveals cards from the top of their library until they reveal X land cards, then puts all cards revealed this way into their graveyard. X can't be 0.", undefined, '{X}{U}{B}');
const BOMB = card('Test Bomb', 'Sorcery', 'Cascade\nYou gain 1 life.', undefined, '{4}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');

describe('CR 107.3, 601.2b: "... until they reveal X land cards, then puts all cards revealed this way into their graveyard. X can\'t be 0." (Mind Grind)', () => {
  it('the card is fully automated', () => {
    expect(full(GRIND), JSON.stringify(GRIND.automation)).toBe(true);
  });
  const board = (islands: number): GameState => scenario(['Island', 'Swamp'], {
    defs: [GRIND, BOMB, BEAR],
    p1: { hand: ['Test Grinder', 'Test Bomb'], library: ['Test Grinder'], battlefield: ['Swamp', ...(Array(islands - 1).fill('Island') as string[])] },
    p2: { library: ['Test Bear', 'Island', 'Test Bear', 'Test Bear', 'Island', 'Test Bear'] },
  });
  const yard = (s: GameState, p: string): string[] => (s.zones.graveyard[p] ?? []).map((id) => nameOf(s, id));
  it('X = 2: the opponent reveals until the second land card (five cards) and puts all five into their graveyard; the rest stays in the library', () => {
    const s0 = board(4);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grinder', 'hand') });
    expect(s.pending?.kind).toBe('chooseNumber');
    expect((s.pending as unknown as { min: number }).min).toBe(1); // X can't be 0
    s = settle(answer(s, { kind: 'chooseNumber', n: 2 } as never));
    s = settle(pass(pass(s)));
    expect(yard(s, 'p2')).toEqual(['Test Bear', 'Island', 'Test Bear', 'Test Bear', 'Island']);
    expect(nameOf(s, s.zones.library.p2![0]!)).toBe('Test Bear');
    expect(yard(s, 'p1')).toEqual(['Test Grinder']);
  });
  it('negative: with only {U}{B} available (X could only be 0) the spell is not offered; with one more land it is', () => {
    expect(legal(board(2), 'p1', 'cast').map((a) => a.label)).not.toContain('Cast Test Grinder');
    expect(legal(board(3), 'p1', 'cast').map((a) => a.label)).toContain('Cast Test Grinder');
  });
  it('ruling 2013-01-24: cast "without paying its mana cost" (cascade) X would be 0, so it can\'t be cast: the player is not even asked and it goes to the bottom', () => {
    const s0 = board(4);
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bomb', 'hand') }));
    s = pass(pass(s));
    expect(s.pending?.kind).not.toBe('yesNo');
    s = settle(s);
    expect(s.zones.stack.map((id) => nameOf(s, id))).toEqual(['Test Bomb']);
    expect(nameOf(s, s.zones.library.p1!.at(-1)!)).toBe('Test Grinder');
  });
});

// ---- Asmodeus the Archfiend ------------------------------------------------------------------------------------------------------------------------------
const FIEND = card('Test Fiend', 'Legendary Creature — Devil God', "If you would draw a card, exile the top card of your library face down instead.\n{B}{B}{B}: Draw seven cards.\n{B}: Return all cards exiled with this creature to their owner's hand and you lose that much life.", ['6', '6'], '{4}{B}{B}');

describe('CR 607.2a, 614.1a, 119.3: "If you would draw a card, exile the top card of your library face down instead." + "{B}: Return all cards exiled with ~ ... and you lose that much life." (Asmodeus the Archfiend)', () => {
  it('the card is fully automated; the draw replacement is the linked exiling instruction', () => {
    expect(full(FIEND), JSON.stringify(FIEND.automation)).toBe(true);
    expect(JSON.stringify(FIEND.faces[0]!.abilities[0])).toContain('"link":"exiled"');
  });
  const board = (): GameState => scenario(['Swamp'], { defs: [FIEND, BEAR], p1: { battlefield: ['Test Fiend', 'Swamp', 'Swamp', 'Swamp', 'Swamp'], library: ['Test Bear', 'Test Bear'] } });
  const activateWith = (s0: GameState, re: RegExp): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object !== undefined && nameOf(s0, x.object) === 'Test Fiend' && re.test(x.label));
    expect(a, JSON.stringify(legal(s0, 'p1', 'activate').map((x) => x.label))).toBeDefined();
    return settle(pass(pass(settle(act(s0, a!.action)))));
  };
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  it('drawing seven exiles seven cards face down instead (the hand stays empty); {B} returns all seven to the hand and you lose 7 life', () => {
    let s = activateWith(board(), /Draw seven/);
    expect(hand(s)).toBe(0);
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1');
    expect(exiled).toHaveLength(7);
    expect(exiled.every((id) => s.objects[id]!.faceDown)).toBe(true);
    const life = lifeOf(s);
    s = activateWith(s, /Return all cards/);
    expect(hand(s)).toBe(7);
    expect(lifeOf(s)).toBe(life - 7);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1')).toHaveLength(0);
  });
  it('negative: with no card exiled with it, {B} returns nothing and you lose no life; a card exiled by something else is not returned', () => {
    const s0 = board();
    const other = put(s0, 'p1', 'exile', 'Test Bear');
    const life = lifeOf(s0);
    const s = activateWith(s0, /Return all cards/);
    expect(hand(s)).toBe(0);
    expect(lifeOf(s)).toBe(life);
    expect(s.objects[other]!.zone).toBe('exile');
  });
});

// ---- Too Greedily, Too Deep ------------------------------------------------------------------------------------------------------------------------------
const DEEP = card('Test Deep Delve', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its power to each other creature.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4'], '{3}{R}');
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5'], '{2}');

describe('CR 400.7, 608.2c: "Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its power to each other creature." (Too Greedily, Too Deep)', () => {
  it('the card is fully automated', () => {
    expect(full(DEEP), JSON.stringify(DEEP.automation)).toBe(true);
  });
  const board = (): GameState => scenario([], { defs: [DEEP, OGRE, WALL, BEAR], p1: { hand: ['Test Deep Delve'], battlefield: ['Test Bear'] }, p2: { graveyard: ['Test Ogre'], battlefield: ['Test Wall'] } });
  it("the opponent's 4/4 card enters under your control and deals 4 damage to each other creature (your 2/2 dies, the 0/5 survives), none to itself", () => {
    const s0 = board();
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Deep Delve', 'hand') }), { targets: [{ kind: 'object', id: ogre } as never] });
    s = settle(pass(pass(s)));
    const entered = find(s, 'Test Ogre', 'battlefield');
    expect(s.objects[entered]!.controller).toBe('p1');
    expect(s.objects[entered]!.damage).toBe(0);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Bear')).toBe(false);
    expect(s.objects[find(s, 'Test Wall', 'battlefield')]!.damage).toBe(4);
  });
  it('negative: the target card left the graveyard before the spell resolved: nothing enters and no creature is dealt damage (CR 608.2b)', () => {
    const s0 = board();
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Deep Delve', 'hand') }), { targets: [{ kind: 'object', id: ogre } as never] });
    const yard = s.zones.graveyard.p2!;
    yard.splice(yard.indexOf(ogre), 1);
    s.objects[ogre]!.zone = 'exile';
    s.zones.exile.push(ogre);
    s = settle(pass(pass(s)));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Ogre')).toBe(false);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Bear')).toBe(true);
    expect(s.objects[find(s, 'Test Wall', 'battlefield')]!.damage).toBe(0);
  });
});

// ---- Fall of the First Civilization ---------------------------------------------------------------------------------------------------------------------
const FALL = card('Test First Fall', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — You and target opponent each draw two cards.\nII — Exile target artifact an opponent controls.\nIII — Each player chooses three nonland permanents they control. Destroy all other nonland permanents.', undefined, '{2}{W}');

describe('CR 714.2b, 608.2d, 701.8a: "III — Each player chooses three nonland permanents they control. Destroy all other nonland permanents." (Fall of the First Civilization)', () => {
  it('the card is fully automated', () => {
    expect(full(FALL), JSON.stringify(FALL.automation)).toBe(true);
  });
  it('chapter III: you keep three of your five nonland permanents, the opponent keeps all three of theirs; every other nonland permanent is destroyed, lands are not', () => {
    const s0 = scenario(['Forest'], { defs: [FALL, BEAR, WALL], p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Forest'] }, p2: { battlefield: ['Test Wall', 'Test Wall', 'Test Wall', 'Forest'] } });
    put(s0, 'p1', 'battlefield', { name: 'Test First Fall', counters: { lore: 2 } });
    let s = advanceTo(s0, 3, 'main1');
    s = settle(s);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)));
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id) !== 'Forest');
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && nameOf(s, id) !== 'Forest');
    expect(mine.length).toBeLessThanOrEqual(3);
    expect(mine.filter((id) => nameOf(s, id) === 'Test Bear').length).toBeGreaterThanOrEqual(2);
    expect(theirs).toHaveLength(3);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Forest')).toHaveLength(2);
  });
});

// ---- Cemetery Gatekeeper ---------------------------------------------------------------------------------------------------------------------------------
const KEEPER = card('Test Gate Warden', 'Creature — Vampire', 'First strike\nWhen this creature enters, exile a card from a graveyard.\nWhenever a player plays a land or casts a spell, if it shares a card type with the exiled card, this creature deals 2 damage to that player.', ['2', '1']);
const ARTBEAR = card('Test Clockwork Bear', 'Artifact Creature — Bear', '', ['2', '2']);
const CUB = card('Test Cub', 'Creature — Bear', '', ['1', '1']);
const SORC = card('Test Thought', 'Sorcery', 'You gain 1 life.');

describe('CR 607.2a, 603.4: "Whenever a player plays a land or casts a spell, if it shares a card type with the exiled card, this creature deals 2 damage to that player." (Cemetery Gatekeeper)', () => {
  it('the card is fully automated; the enters trigger is the linked exiling instruction', () => {
    expect(full(KEEPER), JSON.stringify(KEEPER.automation)).toBe(true);
  });
  /** The Gatekeeper enters (cast for free) and exiles the one card in a graveyard: a land (Forest) or a creature (Bear). */
  const board = (exiled: 'Forest' | 'Test Bear'): GameState => {
    const s0 = scenario(['Forest'], { defs: [KEEPER, BEAR, ARTBEAR, SORC, CUB], p1: { hand: ['Test Gate Warden', 'Test Thought'] }, p2: { graveyard: [exiled], hand: ['Forest', 'Test Clockwork Bear', 'Test Cub'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gate Warden', 'hand') }));
    s = settle(pass(pass(s))); // the creature resolves; its enters trigger goes on the stack
    s = settle(pass(pass(s)), { objects: [find(s, exiled, 'graveyard', 'p2')] });
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual([exiled]);
    return s;
  };
  /** Pass the turn to the opponent's first main phase. */
  const toOpponent = (s: GameState): GameState => advanceTo(s, 2, 'main1');
  it('a land exiled: the opponent playing a land is dealt 2 damage; casting a creature spell is not', () => {
    let s = toOpponent(board('Forest'));
    const life = lifeOf(s, 'p2');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Forest', 'hand', 'p2') } as never);
    s = settle(s);
    expect(s.zones.stack).toHaveLength(1); // the trigger
    s = settle(pass(pass(s)));
    expect(lifeOf(s, 'p2')).toBe(life - 2);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Cub', 'hand', 'p2') }));
    expect(s.zones.stack.map((id) => s.objects[id]!.kind)).toEqual(['card']); // no trigger: a creature spell shares no card type with a land
  });
  it('a creature exiled: an artifact creature spell shares the creature type (damage to its caster); a land play does not trigger', () => {
    let s = toOpponent(board('Test Bear'));
    const life = lifeOf(s, 'p2');
    s = settle(act(s, { type: 'playLand', player: 'p2', card: find(s, 'Forest', 'hand', 'p2') } as never));
    expect(s.zones.stack).toHaveLength(0);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Clockwork Bear', 'hand', 'p2') }));
    expect(s.zones.stack).toHaveLength(2);
    s = settle(pass(pass(s)));
    expect(lifeOf(s, 'p2')).toBe(life - 2);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- Yidaro, Wandering Monster ---------------------------------------------------------------------------------------------------------------------------
const WANDER = card('Test Wanderer, Big Beast', 'Legendary Creature — Dinosaur Turtle', "Trample, haste\nCycling {0}\nWhen you cycle this card, shuffle it into your library from your graveyard. If you've cycled a card named Test Wanderer, Big Beast four or more times this game, put it onto the battlefield from your graveyard instead.", ['8', '8']);

describe('CR 702.29c, 614.15: "When you cycle this card, shuffle it into your library from your graveyard. If you\'ve cycled a card named ~ four or more times this game, put it onto the battlefield ... instead." (Yidaro, Wandering Monster)', () => {
  it('the card is fully automated', () => {
    expect(full(WANDER), JSON.stringify(WANDER.automation)).toBe(true);
  });
  const cycleOne = (s0: GameState): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object !== undefined && nameOf(s0, x.object) === 'Test Wanderer, Big Beast' && /ycling/.test(x.label));
    expect(a, JSON.stringify(legal(s0, 'p1', 'activate').map((x) => x.label))).toBeDefined();
    let s = settle(act(s0, a!.action));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)));
    return s;
  };
  const where = (s: GameState): string[] => Object.values(s.objects).filter((o) => o.kind === 'card' && s.defs[o.defId]!.name === 'Test Wanderer, Big Beast').map((o) => o.zone).sort();
  it('cycles one to three (any cards of that name count): each is shuffled into the library; the fourth cycling puts that card onto the battlefield instead', () => {
    let s = scenario([], { defs: [WANDER], p1: { hand: ['Test Wanderer, Big Beast', 'Test Wanderer, Big Beast', 'Test Wanderer, Big Beast', 'Test Wanderer, Big Beast'] } });
    for (let n = 1; n <= 3; n++) {
      s = cycleOne(s);
      // each cycled card went back into the library (the cycling draw may have drawn one of them again): none in the graveyard, none on the battlefield
      expect(where(s).filter((z) => z === 'library' || z === 'hand')).toHaveLength(4);
      expect(where(s).filter((z) => z === 'library').length).toBeGreaterThanOrEqual(1);
    }
    s = cycleOne(s);
    expect(where(s).filter((z) => z === 'battlefield')).toHaveLength(1);
    expect(where(s)).not.toContain('graveyard');
  });
  it('ruling 2020-04-17: the cycled card is not in the graveyard as the trigger resolves: it is not moved (the library is still shuffled)', () => {
    const s0 = scenario([], { defs: [WANDER], p1: { hand: ['Test Wanderer, Big Beast'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object !== undefined && /ycling/.test(x.label))!;
    let s = settle(act(s0, a.action));
    expect(s.zones.stack).toHaveLength(2); // the cycling ability and, above it, the cycle trigger (CR 702.29c: it resolves first)
    const card = s.zones.graveyard.p1!.find((id) => nameOf(s, id) === 'Test Wanderer, Big Beast')!;
    // exile the card from the graveyard before the trigger resolves
    s.zones.graveyard.p1!.splice(s.zones.graveyard.p1!.indexOf(card), 1);
    s.objects[card]!.zone = 'exile';
    s.zones.exile.push(card);
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)));
    expect(where(s)).toEqual(['exile']);
  });
});

// ---- Quakebringer ----------------------------------------------------------------------------------------------------------------------------------------
const QUAKE = card('Test Rumbler', 'Creature — Giant Berserker', "Your opponents can't gain life.\nAt the beginning of your upkeep, this creature deals 2 damage to each opponent. This ability triggers only if this creature is on the battlefield or if this creature is in your graveyard and you control a Giant.\nForetell {2}{R}{R}", ['5', '4'], '{3}{R}{R}');
const GIANT = card('Test Hill Giant', 'Creature — Giant', '', ['3', '3']);

describe('CR 603.2, 113.6k, 113.6m: "... This ability triggers only if ~ is on the battlefield or if ~ is in your graveyard and you control a Giant." (Quakebringer)', () => {
  it('the card is fully automated; the ability functions on the battlefield and in the graveyard', () => {
    expect(full(QUAKE), JSON.stringify(QUAKE.automation)).toBe(true);
    expect((QUAKE.faces[0]!.abilities[1] as { zone?: string[] }).zone).toEqual(['battlefield', 'graveyard']);
  });
  const upkeep = (p1: { battlefield?: string[]; graveyard?: string[] }): GameState => {
    let s = scenario([], { defs: [QUAKE, GIANT], p1 });
    s = advanceTo(s, 3, 'upkeep');
    return settle(s);
  };
  const resolve = (s0: GameState): GameState => { let s = s0; for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s))); return s; };
  it('ruling 2021-02-05: on the battlefield it triggers with no Giant (it is a Giant itself either way): 2 damage to the opponent', () => {
    const s = upkeep({ battlefield: ['Test Rumbler'] });
    expect(s.zones.stack).toHaveLength(1);
    expect(lifeOf(resolve(s), 'p2')).toBe(18);
  });
  it('in your graveyard while you control a Giant: it triggers; 2 damage to the opponent', () => {
    const s = upkeep({ graveyard: ['Test Rumbler'], battlefield: ['Test Hill Giant'] });
    expect(s.zones.stack).toHaveLength(1);
    expect(lifeOf(resolve(s), 'p2')).toBe(18);
  });
  it('negative: in your graveyard with no Giant: no trigger', () => {
    const s = upkeep({ graveyard: ['Test Rumbler'] });
    expect(s.zones.stack).toHaveLength(0);
    expect(lifeOf(resolve(s), 'p2')).toBe(20);
  });
  it('CR 603.2: the restriction is part of the trigger, judged as the step begins only (not an intervening "if", CR 603.4): the Giant leaving before the ability resolves does not stop it', () => {
    let s = upkeep({ graveyard: ['Test Rumbler'], battlefield: ['Test Hill Giant'] });
    const g = find(s, 'Test Hill Giant', 'battlefield');
    s.zones.battlefield.splice(s.zones.battlefield.indexOf(g), 1);
    s.objects[g]!.zone = 'graveyard';
    s.zones.graveyard.p1!.push(g);
    expect(lifeOf(resolve(s), 'p2')).toBe(18);
  });
});

// ---- Scion of Halaster -----------------------------------------------------------------------------------------------------------------------------------
const SCION = card('Test Scion of Archives', 'Legendary Enchantment — Background', 'Commander creatures you own have "The first time you would draw a card each turn, instead look at the top two cards of your library. Put one of them into your graveyard and the other back on top of your library. Then draw a card."');
const BOSS = legend('Test Boss Captain', '{1}{B}', ['3', '3'], ['B']);
const RIVALS = ['Beta', 'Gamma', 'Delta'].map((n) => legend(`Test ${n} Rival`, '{1}{W}', ['2', '2'], ['W']));
const DRAW2 = card('Test Two Thoughts', 'Instant', 'Draw two cards.');
const DRAW1 = card('Test One Thought', 'Instant', 'Draw a card.');
const CARD_A = card('Test Card Alpha', 'Sorcery', 'You gain 1 life.');
const CARD_B = card('Test Card Beta', 'Sorcery', 'You gain 2 life.');

describe('CR 614.1a, 121.2: Commander creatures you own have "The first time you would draw a card each turn, instead look at the top two cards ..." (Scion of Halaster)', () => {
  it('the card is fully automated', () => {
    expect(full(SCION), JSON.stringify(SCION.automation)).toBe(true);
  });
  /** A four-player Commander game at Alice's first main phase (her draw step already drew Alpha, with her commander still in the command zone); with `commanderOut`
   * the commander is then put onto the battlefield, and the game goes on to her next turn's draw step (turn 5), where the first draw of that turn is proposed. */
  const game = (commanderOut: boolean): GameState => {
    let s = mpScenario({
      defs: [SCION, DRAW2, DRAW1, CARD_A, CARD_B], commanders: { p1: [BOSS], p2: [RIVALS[0]!], p3: [RIVALS[1]!], p4: [RIVALS[2]!] }, options: { commander: commanderOptions('commander') },
      zones: { p1: { battlefield: ['Test Scion of Archives'], hand: ['Test Two Thoughts', 'Test One Thought'], library: ['Plains', 'Test Card Alpha', 'Test Card Beta'] } },
    });
    if (!commanderOut) return s;
    s = clone(s);
    const id = s.zones.command.find((o) => s.objects[o]!.defId === 'Test Boss Captain')!;
    s.zones.command = s.zones.command.filter((o) => o !== id);
    s.zones.battlefield.push(id);
    s.objects[id] = { ...s.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
    return passUntil(s, (x) => x.pending?.kind === 'chooseObjects' || (x.turn.number === 5 && x.turn.step === 'main1'), "Alice's next draw", 2000);
  };
  const names = (s: GameState, z: 'hand' | 'graveyard'): string[] => (s.zones[z].p1 ?? []).map((id) => nameOf(s, id)).sort();
  /** The draw step's draw (a multiplayer game: the starting player draws, CR 103.8a) is the first of the turn; answered with `pick`, then on to the main phase. */
  const toMain = (s0: GameState, pick: string): GameState => {
    let s = s0;
    expect(s.pending?.kind).toBe('chooseObjects');
    const opts = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(opts.map((id) => nameOf(s, id)).sort()).toEqual(['Test Card Alpha', 'Test Card Beta']); // the top two cards
    s = answer(s, { kind: 'chooseObjects', ids: [opts.find((id) => nameOf(s, id) === pick)!] });
    expect(s.turn.number).toBe(5);
    for (let i = 0; i < 20 && s.turn.step !== 'main1'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    return s;
  };
  const castAndResolve = (s0: GameState, name: string): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') }));
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  it('the first draw of the turn (the draw step): look at the top two, Alpha into the graveyard, Beta back on top, then draw it', () => {
    const s = toMain(game(true), 'Test Card Alpha');
    expect(names(s, 'graveyard')).toEqual(['Test Card Alpha']);
    expect(names(s, 'hand')).toEqual(['Plains', 'Test Card Beta', 'Test One Thought', 'Test Two Thoughts']);
  });
  it('negative: later draws the same turn ("draw two cards") are ordinary draws: no look, nothing into the graveyard but the spell', () => {
    let s = toMain(game(true), 'Test Card Beta');
    expect(names(s, 'hand')).toEqual(['Plains', 'Test Card Alpha', 'Test One Thought', 'Test Two Thoughts']);
    s = castAndResolve(s, 'Test Two Thoughts');
    expect(s.pending?.kind).not.toBe('chooseObjects');
    expect(names(s, 'graveyard')).toEqual(['Test Card Beta', 'Test Two Thoughts']);
    expect(names(s, 'hand')).toEqual(['Plains', 'Plains', 'Plains', 'Test Card Alpha', 'Test One Thought']);
  });
  it('negative: the commander is in the command zone (no commander creature you own on the battlefield): the draw step draws as usual', () => {
    const s = game(false);
    expect(s.turn.step).toBe('main1');
    expect(names(s, 'hand')).toEqual(['Plains', 'Test One Thought', 'Test Two Thoughts']);
  });
});

// ---- Synthetic Destiny -----------------------------------------------------------------------------------------------------------------------------------
const DESTINY = card('Test Rebuilt Fate', 'Instant', 'Exile all creatures you control. At the beginning of the next end step, reveal cards from the top of your library until you reveal that many creature cards, put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.');
const TOKENER = card('Test Token Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');

describe('CR 603.7c, 701.20a: "Exile all creatures you control. At the beginning of the next end step, reveal ... until you reveal that many creature cards ..." (Synthetic Destiny)', () => {
  it('the card is fully automated', () => {
    expect(full(DESTINY), JSON.stringify(DESTINY.automation)).toBe(true);
  });
  it('two creatures exiled (one a token, ruling 2015-11-04): at the next end step two creature cards from the library enter; the exiled card stays exiled; nothing else moves', () => {
    let s = scenario([], { defs: [DESTINY, TOKENER, BEAR, OGRE, WALL, SORC], p1: { hand: ['Test Rebuilt Fate', 'Test Token Maker'], battlefield: ['Test Bear'], library: ['Test Thought', 'Test Ogre', 'Test Thought', 'Test Wall', 'Test Ogre'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Token Maker', 'hand') }));
    s = settle(pass(pass(s)));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rebuilt Fate', 'hand') }));
    s = settle(pass(pass(s)));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(0);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Bear']);
    s = advanceTo(s, 1, 'end');
    s = settle(s);
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)));
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => nameOf(s, id)).sort();
    expect(mine).toEqual(['Test Ogre', 'Test Wall']);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Bear']);
    const lib = s.zones.library.p1!.map((id) => nameOf(s, id));
    expect(lib.filter((n) => n === 'Test Thought')).toHaveLength(2); // the revealed noncreature cards were shuffled back in
    expect(lib.filter((n) => n === 'Test Ogre')).toHaveLength(1);
  });
  it('negative: nothing exiled (no creature): at the end step no creature card is put onto the battlefield', () => {
    let s = scenario([], { defs: [DESTINY, OGRE], p1: { hand: ['Test Rebuilt Fate'], library: ['Test Ogre'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rebuilt Fate', 'hand') }));
    s = settle(pass(pass(s)));
    s = settle(advanceTo(s, 1, 'end'));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(0);
  });
});

// ---- Cemetery Protector (the same reading, "you" as the player) -------------------------------------------------------------------------------------------
const PROTECTOR = card('Test Grave Guard', 'Creature — Human Soldier', 'Flash\nWhen this creature enters, exile a card from a graveyard.\nWhenever you play a land or cast a spell, if it shares a card type with the exiled card, create a 1/1 white Human creature token.', ['3', '4']);

describe('CR 607.2a, 603.4: "Whenever you play a land or cast a spell, if it shares a card type with the exiled card, create a 1/1 white Human creature token." (Cemetery Protector)', () => {
  it('the card is fully automated', () => {
    expect(full(PROTECTOR), JSON.stringify(PROTECTOR.automation)).toBe(true);
  });
  it('a land exiled: your land play makes a token; your creature spell does not', () => {
    const s0 = scenario(['Forest'], { defs: [PROTECTOR, CUB], p1: { hand: ['Test Grave Guard', 'Forest', 'Test Cub'] }, p2: { graveyard: ['Forest'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Guard', 'hand') }));
    s = settle(pass(pass(s)));
    s = settle(pass(pass(s)), { objects: [find(s, 'Forest', 'graveyard', 'p2')] });
    const tokens = (x: GameState): number => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token').length;
    s = settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') } as never));
    s = settle(pass(pass(s)));
    expect(tokens(s)).toBe(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cub', 'hand') }));
    expect(s.zones.stack).toHaveLength(1); // no trigger
  });
});
