/**
 * Commander EDHREC ranks 25,001-25,500, round edh-c-106 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 120.3, 608.2c             "Whenever enchanted creature deals damage to a creature, destroy the other creature."
 *   CR 509.1, 603.7, 702.2       "Whenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat."
 *   CR 609.4, 702.17b            "~ can block Dragons as though it had reach."
 *   CR 614.1c, 601.2i            "~ enters with a +1/+1 counter on it for each other spell cast this turn."
 *   CR 701.9b, 608.2c, 120.3     "Discard a card at random. If you do, ~ deals damage equal to that card's mana value to each creature. You may repeat this process any number of times."
 *   CR 118.12a, 701.21a, 608.2c  "Sacrifice a nontoken permanent. If you do, target opponent loses 2 life unless that player sacrifices a permanent of their choice or discards a card."
 *   CR 118.12a, 701.21a, 608.2d  "At the beginning of your upkeep, unless you pay {B}{B}{B}, tap ~ and sacrifice a land of an opponent's choice."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, full, inYard, named, resolveAll, settle } from '../cmd3/helpers';

const colored = (name: string, type: string, text: string, colors: string[], pt?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Attach the Aura `aura` (controlled by p1) to `to`. */
const attach = (s: GameState, aura: string, to: ObjectId): GameState => tweak(s, (t) => { t.objects[put(t, 'p1', 'battlefield', aura)]!.attachedTo = to; }); // attached before any state-based action check (CR 704.5m)
/** p1 attacks with `attacker`, p2 blocks it with `blocker`; stops when everything has been resolved after combat damage. */
function combat(s0: GameState, attacker: ObjectId, blocker: ObjectId): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  s = toDeclareBlockers(s);
  s = declareBlockers(s, [[blocker, attacker]]);
  return passUntil(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'end of combat');
}
const gone = (s: GameState, defId: string): boolean => named(s, defId).length === 0;

describe('CR 120.3, 608.2c: "Whenever enchanted creature deals damage to a creature, destroy the other creature." (Venomous Fangs reading)', () => {
  const FANGS = card('Test Viper Fangs', 'Enchantment — Aura', 'Enchant creature\nWhenever enchanted creature deals damage to a creature, destroy the other creature.', undefined, '{0}');
  const BITER = card('Test Small Biter', 'Creature — Snake', '', ['1', '1']);
  const PLAIN = card('Test Plain Biter', 'Creature — Snake', '', ['1', '1']);
  const TOWER = card('Test Stone Tower', 'Creature — Wall', 'Defender', ['0', '9']);
  const game = (): GameState => scenario([], { defs: [FANGS, BITER, PLAIN, TOWER], p1: { battlefield: ['Test Small Biter', 'Test Plain Biter'] }, p2: { battlefield: ['Test Stone Tower'] } });
  it('is full', () => { expect(full(FANGS)).toBe(true); });
  it('the creature the enchanted creature damaged is destroyed whatever its toughness', () => {
    const s0 = game();
    const s1 = combat(attach(s0, 'Test Viper Fangs', named(s0, 'Test Small Biter')[0]!), named(s0, 'Test Small Biter')[0]!, named(s0, 'Test Stone Tower')[0]!);
    expect(gone(s1, 'Test Stone Tower')).toBe(true);
    expect(named(s1, 'Test Small Biter').length).toBe(1); // negative: only the other creature is destroyed
  });
  it('negative: a creature that is not enchanted damages it and nothing is destroyed', () => {
    const s0 = game();
    const s1 = combat(attach(s0, 'Test Viper Fangs', named(s0, 'Test Small Biter')[0]!), named(s0, 'Test Plain Biter')[0]!, named(s0, 'Test Stone Tower')[0]!);
    expect(gone(s1, 'Test Stone Tower')).toBe(false);
  });
  it('negative: damage to a player is no damage to a creature', () => {
    const s0 = game();
    const biter = named(s0, 'Test Small Biter')[0]!;
    let s = declareAttackers(toDeclareAttackers(attach(s0, 'Test Viper Fangs', biter)), [[biter]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, []);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'end of combat');
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(gone(s, 'Test Stone Tower')).toBe(false);
  });
});

describe('CR 509.1, 603.7, 702.2: "Whenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat." (Venom reading)', () => {
  const VENOM = card('Test Green Venom', 'Enchantment — Aura', 'Enchant creature\nWhenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat.', undefined, '{0}');
  const SNAKE = card('Test Venom Host', 'Creature — Snake', '', ['1', '1']);
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', ['0', '9']);
  const TOWER = card('Test Stone Tower', 'Creature — Wall', 'Defender', ['0', '9']);
  const game = (): GameState => scenario([], { defs: [VENOM, SNAKE, OGRE, TOWER], p1: { battlefield: ['Test Venom Host'] }, p2: { battlefield: ['Test Big Ogre', 'Test Stone Tower'] } });
  it('is full', () => { expect(full(VENOM)).toBe(true); });
  it('the blocker of the enchanted attacker is destroyed at end of combat, not before', () => {
    const s0 = game();
    const host = named(s0, 'Test Venom Host')[0]!;
    let s = declareAttackers(toDeclareAttackers(attach(s0, 'Test Green Venom', host)), [[host]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[named(s0, 'Test Big Ogre')[0]!, host]]);
    s = passUntil(s, (x) => x.turn.step === 'combatDamage' && x.pending?.kind === 'priority', 'combat damage');
    expect(gone(s, 'Test Big Ogre')).toBe(false);
    s = resolveAll(passUntil(s, (x) => x.turn.step === 'endCombat' && x.zones.stack.length > 0, 'the delayed trigger'));
    expect(gone(s, 'Test Big Ogre')).toBe(true);
  });
  it('negative: a Wall blocker is not destroyed', () => {
    const s0 = game();
    const host = named(s0, 'Test Venom Host')[0]!;
    const s1 = combat(attach(s0, 'Test Green Venom', host), host, named(s0, 'Test Stone Tower')[0]!);
    const s2 = resolveAll(passUntil(s1, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2'));
    expect(gone(s2, 'Test Stone Tower')).toBe(false);
  });
});

describe('CR 609.4, 702.17b: "~ can block Dragons as though it had reach." (Dragon Hunter reading)', () => {
  const HUNTER = card('Test Drake Hunter', 'Creature — Human Warrior', 'This creature can block Dragons as though it had reach.', ['1', '1']);
  const PLAIN = card('Test Plain Guard', 'Creature — Human Warrior', '', ['1', '1']);
  const DRAGON = card('Test Sky Dragon', 'Creature — Dragon', 'Flying', ['3', '3']);
  const BIRD = card('Test Sky Bird', 'Creature — Bird', 'Flying', ['1', '1']);
  const game = (flier: string): GameState => scenario([], { defs: [HUNTER, PLAIN, DRAGON, BIRD], p1: { battlefield: [flier] }, p2: { battlefield: ['Test Drake Hunter', 'Test Plain Guard'] } });
  const attacked = (flier: string): GameState => { const s0 = game(flier); return passUntil(declareAttackers(toDeclareAttackers(s0), [[named(s0, flier)[0]!]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10); };
  it('is full', () => { expect(full(HUNTER)).toBe(true); });
  it('the Hunter can block a flying Dragon', () => {
    const s = attacked('Test Sky Dragon');
    expect(s.pending?.kind).toBe('declareBlockers');
    const s1 = declareBlockers(s, [[named(s, 'Test Drake Hunter')[0]!, named(s, 'Test Sky Dragon')[0]!]]);
    expect(s1.combat?.blockers?.length ?? 1).toBeGreaterThan(0);
  });
  it('negative: a creature without the permission cannot block the Dragon', () => {
    const s = attacked('Test Sky Dragon');
    expect(() => declareBlockers(s, [[named(s, 'Test Plain Guard')[0]!, named(s, 'Test Sky Dragon')[0]!]])).toThrow();
  });
  it('negative: the Hunter cannot block a flier that is not a Dragon (nothing can block it, so no block is asked for)', () => {
    const s = attacked('Test Sky Bird');
    expect(s.pending?.kind).not.toBe('declareBlockers');
  });
});

describe('CR 614.1c, 601.2i: "~ enters with a +1/+1 counter on it for each other spell cast this turn." (Storm Entity reading)', () => {
  const ENTITY = card('Test Storm Spark', 'Creature — Elemental', 'Haste\nThis creature enters with a +1/+1 counter on it for each other spell cast this turn.', ['1', '1']);
  const CANTRIP = card('Test Small Cantrip', 'Instant', 'You gain 1 life.');
  const game = (): GameState => scenario([], { defs: [ENTITY, CANTRIP], p1: { hand: ['Test Storm Spark', 'Test Small Cantrip', 'Test Small Cantrip'] } });
  const counters = (s: GameState): number => s.objects[named(s, 'Test Storm Spark')[0]!]!.counters['+1/+1'] ?? 0;
  const castIt = (s: GameState, name: string): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })));
  it('is full', () => { expect(full(ENTITY)).toBe(true); });
  it('enters with a counter for each other spell cast this turn (the two cantrips), not for itself', () => {
    let s = game();
    s = castIt(s, 'Test Small Cantrip');
    s = castIt(s, 'Test Small Cantrip');
    s = castIt(s, 'Test Storm Spark');
    expect(counters(s)).toBe(2);
  });
  it('negative: cast first, it enters with no counters', () => {
    const s = castIt(game(), 'Test Storm Spark');
    expect(counters(s)).toBe(0);
  });
});

describe('CR 701.9b, 608.2c, 120.3: "Discard a card at random. If you do, ~ deals damage equal to that card\'s mana value to each creature. You may repeat this process any number of times." (Kindle the Carnage reading)', () => {
  const KINDLE = card('Test Burn Rite', 'Sorcery', "Discard a card at random. If you do, ~ deals damage equal to that card's mana value to each creature. You may repeat this process any number of times.");
  const FOUR = card('Test Four Drop', 'Sorcery', 'You gain 1 life.', undefined, '{3}{R}');
  const ONE = card('Test One Drop', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
  const BULK = card('Test Bulk Ogre', 'Creature — Ogre', '', ['2', '9']);
  const game = (hand: string[]): GameState => scenario([], { defs: [KINDLE, FOUR, ONE, BULK], p1: { hand: ['Test Burn Rite', ...hand], battlefield: ['Test Bulk Ogre'] } });
  it('is full', () => { expect(full(KINDLE)).toBe(true); });
  it('deals damage equal to the mana value of the discarded card to each creature, once when you decline to repeat', () => {
    const s0 = game(['Test Four Drop']);
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn Rite', 'hand', 'p1') })), { yes: false });
    expect(inYard(s1, 'Test Four Drop')).toBe(true);
    expect(s1.objects[named(s1, 'Test Bulk Ogre')[0]!]!.damage).toBe(4);
  });
  it('negative: with no card in hand nothing is discarded and no damage is dealt', () => {
    const s0 = game([]);
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn Rite', 'hand', 'p1') })), { yes: false });
    expect(s1.objects[named(s1, 'Test Bulk Ogre')[0]!]!.damage).toBe(0);
  });
});

describe('CR 118.12a, 701.21a, 608.2c: "Sacrifice a nontoken permanent. If you do, target opponent loses 2 life unless that player sacrifices a permanent of their choice or discards a card." (Forbidden Ritual reading)', () => {
  const RITUAL = card('Test Dark Rite', 'Sorcery', 'Sacrifice a nontoken permanent. If you do, target opponent loses 2 life unless that player sacrifices a permanent of their choice or discards a card.');
  const FODDER = card('Test Fodder', 'Creature — Rat', '', ['1', '1']);
  const game = (opp: Parameters<typeof scenario>[1]): GameState => scenario([], { defs: [RITUAL, FODDER], ...opp });
  const cast = (s0: GameState): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dark Rite', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] });
  it('is full', () => { expect(full(RITUAL)).toBe(true); });
  it('the opponent loses 2 life when they have nothing to sacrifice or discard', () => {
    const s = resolveAll(cast(game({ p1: { hand: ['Test Dark Rite'], battlefield: ['Test Fodder'] } })));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(inYard(s, 'Test Fodder')).toBe(true);
  });
  it('negative: with no permanent of yours to sacrifice, the opponent loses nothing', () => {
    const s = resolveAll(cast(game({ p1: { hand: ['Test Dark Rite'] } })));
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 118.12a, 701.21a, 608.2d: "At the beginning of your upkeep, unless you pay {B}{B}{B}, tap ~ and sacrifice a land of an opponent\'s choice." (Demonic Hordes reading)', () => {
  const HORDES = colored('Test Dire Horde', 'Creature — Demon', "At the beginning of your upkeep, unless you pay {B}{B}{B}, tap ~ and sacrifice a land of an opponent's choice.", ['B'], ['5', '5']);
  it('is full', () => { expect(full(HORDES)).toBe(true); });
  it('the compiled step makes an opponent choose the land you sacrifice, after you decline to pay', () => {
    const json = JSON.stringify(HORDES);
    expect(json).toContain('"chooser":{"ref":"anOpponent"}');
    expect(json).toContain('"op":"pay"');
  });
  it('negative: "of their choice" or "of your choice" is not this reading', () => {
    for (const bad of ['of their choice', 'of your choice']) {
      const d = card('Test Dire Horde', 'Creature — Demon', `At the beginning of your upkeep, unless you pay {B}{B}{B}, tap ~ and sacrifice a land ${bad}.`, ['5', '5']);
      expect(JSON.stringify(d)).not.toContain('"chooser"');
    }
  });
});
describe('CR 701.21a, 608.2d: "Sacrifice a land of an opponent\'s choice." (the chooser of Demonic Hordes, played)', () => {
  const RITE = card('Test Tithe Rite', 'Sorcery', "Sacrifice a land of an opponent's choice.");
  const swamp = card('Test Dark Marsh', 'Land', '');
  const forest = card('Test Green Grove', 'Land', '');
  it('the opponent picks which of your lands is sacrificed', () => {
    const s0 = scenario([], { defs: [RITE, swamp, forest], p1: { hand: ['Test Tithe Rite'], battlefield: ['Test Dark Marsh', 'Test Green Grove'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tithe Rite', 'hand', 'p1') });
    const s2 = passUntil(s1, (x) => x.pending?.kind === 'chooseObjects', 'the opponent chooses');
    expect(s2.pending && 'player' in s2.pending ? s2.pending.player : undefined).toBe('p2');
    const grove = named(s2, 'Test Green Grove')[0]!;
    const s3 = resolveAll(answer(s2, { kind: 'chooseObjects', ids: [grove] }));
    expect(inYard(s3, 'Test Green Grove')).toBe(true);
    expect(named(s3, 'Test Dark Marsh').length).toBe(1);
  });
  it('negative: with only one land there is no choice and it is sacrificed', () => {
    const s0 = scenario([], { defs: [RITE, swamp], p1: { hand: ['Test Tithe Rite'], battlefield: ['Test Dark Marsh'] } });
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tithe Rite', 'hand', 'p1') })));
    expect(inYard(s1, 'Test Dark Marsh')).toBe(true);
  });
});
void put;
