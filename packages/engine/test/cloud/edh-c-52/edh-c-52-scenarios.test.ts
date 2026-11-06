/**
 * Commander effort (coordinator C), round edh-c-52 (EDHREC ranks 19,001-19,500): the round's readings played through the engine with synthetic cards (invented
 * wordings; two names are real because the text names them), compiled by the game's default compiler. Alice (p1) is the active player. CR cites are checked against
 * the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 205.1a, 205.3m, 613.1d, 613.4b  "This artifact becomes a Shapeshifter artifact creature with base power and toughness 3/3 until end of turn." (Mimic: still a Treasure)
 *   CR 205.1a, 613.4b, 122.1           "Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on it." (Bring to Life: no end)
 *   CR 105.3, 205.1b, 613.1e, 611.2a   "Until end of turn, that creature becomes a blue Crab in addition to its other types and gains hexproof." (Scuttling Sentinel)
 *   CR 205.1b, 205.4a, 613.4b          "Enchanted land becomes a legendary 8/12 Spirit creature with trample until end of turn. It's still a land." (Genju of the Realm)
 *   CR 603.10a, 704.5m, 400.7          "When enchanted land is put into a graveyard, you may return ~ from your graveyard to your hand."
 *   CR 201.2, 608.2c, 614.15           "Create five of those tokens instead if you control artifacts named A and B." (Throne of Empires: both, checked as the ability resolves)
 *   CR 509.1h, 611.2c, 611.2a          "Each unblocked creature has base power and toughness 4/1 until end of turn." (Inkfathom Witch: the set is fixed as it resolves)
 *   CR 509.1a, 611.2a                  "Target creature gets +2/+6 until end of turn and can block any number of creatures this turn." (Give No Ground)
 *   CR 608.2c, 608.2b, 701.21a         "(gain 2 life) if the sacrificed creature was red. Draw a card if the sacrificed creature was black." (Lyzolda)
 *   CR 508.4, 508.1, 101.4             "for each opponent, you create a 2/2 Boar token that's tapped and attacking that opponent" (Stampede Surfer, four players)
 *   CR 122.1, 115.1                    "put a +1/+1 counter on target creature you control that doesn't have a +1/+1 counter on it." (Coiling Stalker)
 *   CR 122.1, 608.2h, 608.2c            "For each creature card in your graveyard, put a +1/+1 counter on each creature you control." (Vraska, Regal Gorgon: once per card)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, getChars, type CardDef, type OracleCard, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { maxBlocks } from '../../../src/statics/hooks';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { drive, lifeOf, mpScenario } from '../../m12/rules/helpers';
import { card, cast, counters, full, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const onField = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const inYard = (s: GameState, name: string, p = 'p1'): boolean => (s.zones.graveyard[p] ?? []).some((id) => nameOf(s, id) === name);
const inHand = (s: GameState, name: string, p = 'p1'): boolean => (s.zones.hand[p] ?? []).some((id) => nameOf(s, id) === name);
const isCreature = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.types.includes('Creature');
/** Activate the nth ability of a permanent, paying costs automatically, then resolve the stack with these targets. */
function activate(s: GameState, source: ObjectId, n: number, targets: TargetChoice[] = []): GameState {
  const t = act(s, { type: 'activate', player: s.objects[source]!.controller, source, ability: activatedAbilities(s, s.objects[source]!)[n]!.key });
  return resolveAll(t, { targets });
}
const rejects = (s: GameState, f: (s: GameState) => GameState): boolean => { try { f(s); return false; } catch { return true; } };

const colored = (name: string, type: string, text: string, colors: string[], pt: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, power: pt[0], toughness: pt[1] } as OracleCard);
const BEAR = colored('Test Bear', 'Creature — Bear', '', ['G'], ['2', '2']);
const IMP = colored('Test Imp', 'Creature — Imp', '', ['B'], ['1', '1']);
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');

// ---- Mimic ------------------------------------------------------------------------------------------------------------------------------------------------
const MIMIC = card('Test Mimic', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.\n{2}: This artifact becomes a Shapeshifter artifact creature with base power and toughness 3/3 until end of turn.');

describe('CR 205.1a, 613.4b: "This artifact becomes a Shapeshifter artifact creature with base power and toughness 3/3 until end of turn."', () => {
  it('is automated; for {2} it is a 3/3 Shapeshifter artifact creature that is still a Treasure (ruling 2021-07-23), and an artifact again on the next turn', () => {
    expect(full(MIMIC)).toBe(true);
    let s = scenario([], { defs: [MIMIC], p1: { battlefield: ['Test Mimic', 'Plains', 'Plains'] } });
    const mimic = find(s, 'Test Mimic', 'battlefield');
    expect(isCreature(s, mimic)).toBe(false);
    s = activate(s, mimic, 1);
    const c = getChars(s, mimic)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Shapeshifter', 'Treasure']));
    expect(pt(s, mimic)).toBe('3/3');
    s = advanceTo(s, 3, 'main1');
    expect(isCreature(s, mimic)).toBe(false);
    expect(getChars(s, mimic)!.subtypes).toEqual(['Treasure']);
  });
  it('the negative case: without the {2} nothing happens (the ability can\'t be paid)', () => {
    const s = scenario([], { defs: [MIMIC], p1: { battlefield: [{ name: 'Test Mimic', tapped: true }, 'Plains'] } }); // tapped: its own mana ability can't pay
    const mimic = find(s, 'Test Mimic', 'battlefield');
    let t = s;
    try { t = activate(s, mimic, 1); } catch { /* the payment is refused */ }
    expect(isCreature(t, mimic)).toBe(false);
  });
});

// ---- Bring to Life ---------------------------------------------------------------------------------------------------------------------------------------
const FAERIE = card('Test Animator', 'Sorcery', 'Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on it.');

describe('CR 205.1a, 613.4b: "Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on it."', () => {
  it('is automated; the artifact is a 4/4 artifact creature and stays one across turns (no duration), a creature artifact is not a legal target', () => {
    expect(full(FAERIE)).toBe(true);
    let s = scenario([], { defs: [FAERIE, ROCK, BEAR], p1: { hand: ['Test Animator'], battlefield: ['Test Rock', 'Test Bear'] } });
    const rock = find(s, 'Test Rock', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(rejects(s, (x) => cast(x, 'Test Animator', { targets: [obj(bear)] }))).toBe(true); // not an artifact
    s = resolveAll(cast(s, 'Test Animator', { targets: [obj(rock)] }));
    expect(isCreature(s, rock)).toBe(true);
    expect(getChars(s, rock)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(counters(s, rock, '+1/+1')).toBe(4);
    expect(pt(s, rock)).toBe('4/4');
    s = advanceTo(s, 3, 'main1');
    expect(pt(s, rock)).toBe('4/4');
    expect(s.objects[rock]!.zone).toBe('battlefield');
  });
  it('the artifact keeps its other card types (CR 205.1b): an artifact land is still a land', () => {
    const LAND = card('Test Vault', 'Artifact Land', '');
    let s = scenario([], { defs: [FAERIE, LAND], p1: { hand: ['Test Animator'], battlefield: ['Test Vault'] } });
    const vault = find(s, 'Test Vault', 'battlefield');
    s = resolveAll(cast(s, 'Test Animator', { targets: [obj(vault)] }));
    expect(getChars(s, vault)!.types).toEqual(expect.arrayContaining(['Artifact', 'Land', 'Creature']));
  });
  it('the negative case: an artifact creature already is a creature, so it is not a legal target', () => {
    const ANIMATED = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
    const s = scenario([], { defs: [FAERIE, ANIMATED], p1: { hand: ['Test Animator'], battlefield: ['Test Golem'] } });
    expect(rejects(s, (x) => cast(x, 'Test Animator', { targets: [obj(find(x, 'Test Golem', 'battlefield'))] }))).toBe(true);
  });
});

// ---- Scuttling Sentinel ----------------------------------------------------------------------------------------------------------------------------------
const SENTINEL = card('Test Crabber', 'Creature — Wizard', 'When this creature enters, put a +1/+1 counter on another target creature you control. Until end of turn, that creature becomes a blue Crab in addition to its other types and gains hexproof.', ['2', '2'], '{0}');

describe('CR 105.3, 205.1b, 613.1e, 611.2a: "Until end of turn, that creature becomes a blue Crab in addition to its other types and gains hexproof."', () => {
  it('is automated; the target is blue (only blue, ruling 2024-02-02), a Crab as well as a Bear, hexproof and 3/3 now; on the next turn it is green and a Bear again with its counter', () => {
    expect(full(SENTINEL)).toBe(true);
    let s = scenario([], { defs: [SENTINEL, BEAR], p1: { hand: ['Test Crabber'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(getChars(s, bear)!.colors).toEqual(['G']);
    s = resolveAll(cast(s, 'Test Crabber'), { targets: [obj(bear)] });
    const c = getChars(s, bear)!;
    expect(c.colors).toEqual(['U']);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Crab']));
    expect(hasKeyword(c, 'hexproof')).toBe(true);
    expect(pt(s, bear)).toBe('3/3');
    s = advanceTo(s, 3, 'main1');
    const later = getChars(s, bear)!;
    expect(later.colors).toEqual(['G']);
    expect(later.subtypes).toEqual(['Bear']);
    expect(hasKeyword(later, 'hexproof')).toBe(false);
    expect(pt(s, bear)).toBe('3/3');
  });
  it('the negative case: with no other creature the trigger has no target and nothing changes', () => {
    let s = scenario([], { defs: [SENTINEL], p1: { hand: ['Test Crabber'] } });
    s = resolveAll(cast(s, 'Test Crabber'));
    const sentinel = find(s, 'Test Crabber', 'battlefield');
    expect(getChars(s, sentinel)!.subtypes).toEqual(['Wizard']);
    expect(counters(s, sentinel, '+1/+1')).toBe(0);
  });
});

// ---- Genju of the Realm ----------------------------------------------------------------------------------------------------------------------------------
const GENJU = card('Test Genju', 'Legendary Enchantment — Aura', 'Enchant land\n{2}: Enchanted land becomes a legendary 8/12 Spirit creature with trample until end of turn. It\'s still a land.\nWhen enchanted land is put into a graveyard, you may return ~ from your graveyard to your hand.');
const DOOM = card('Test Doom', 'Instant', 'Destroy target land.');

describe('CR 205.1b, 205.4a, 613.4b: "Enchanted land becomes a legendary 8/12 Spirit creature with trample until end of turn. It\'s still a land."', () => {
  const board = (): GameState => {
    const s = scenario([], { defs: [GENJU, DOOM, BEAR], p1: { hand: ['Test Doom'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    const lands = onField(s, 'Plains', 'p1');
    return tweak(s, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Genju')]!.attachedTo = lands[0]!; }); // an Aura put in the scenario setup would be put into the graveyard at once (CR 704.5m)
  };
  it('is automated; the enchanted land is an 8/12 legendary Spirit creature with trample that is still a land, until end of turn', () => {
    expect(full(GENJU)).toBe(true);
    let s = board();
    const genju = find(s, 'Test Genju', 'battlefield');
    const land = s.objects[genju]!.attachedTo!;
    s = activate(s, genju, 0);
    const c = getChars(s, land)!;
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.supertypes).toContain('Legendary');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Spirit', 'Plains']));
    expect(hasKeyword(c, 'trample')).toBe(true);
    expect(pt(s, land)).toBe('8/12');
    s = advanceTo(s, 3, 'main1');
    expect(isCreature(s, land)).toBe(false);
  });
  it('when the enchanted land is destroyed, Genju may return from the graveyard to its owner\'s hand; declining leaves it there; another land dying does not trigger it', () => {
    let s = board();
    const genju = find(s, 'Test Genju', 'battlefield');
    const land = s.objects[genju]!.attachedTo!;
    const other = onField(s, 'Plains', 'p1').find((id) => id !== land)!;
    const elsewhere = resolveAll(cast(s, 'Test Doom', { targets: [obj(other)] }));
    expect(s.objects[genju]!.zone).toBe('battlefield');
    expect(elsewhere.objects[genju]!.zone).toBe('battlefield');
    const yes = resolveAll(cast(s, 'Test Doom', { targets: [obj(land)] }), { yes: true });
    expect(inHand(yes, 'Test Genju')).toBe(true);
    expect(inYard(yes, 'Test Genju')).toBe(false);
    const no = resolveAll(cast(s, 'Test Doom', { targets: [obj(land)] }), { yes: false });
    expect(inYard(no, 'Test Genju')).toBe(true);
    expect(inHand(no, 'Test Genju')).toBe(false);
  });
});

// ---- Throne of Empires -----------------------------------------------------------------------------------------------------------------------------------
const THRONE = card('Test Throne', 'Artifact', '{1}, {T}: Create a 1/1 white Soldier creature token. Create five of those tokens instead if you control artifacts named Crown of Empires and Scepter of Empires.');
const CROWN = card('Crown of Empires', 'Artifact', '');
const SCEPTER = card('Scepter of Empires', 'Artifact', '');

describe('CR 201.2, 608.2c, 614.15: "Create five of those tokens instead if you control artifacts named Crown of Empires and Scepter of Empires."', () => {
  const play = (extra: string[]): number => {
    const s = scenario([], { defs: [THRONE, CROWN, SCEPTER], p1: { battlefield: ['Test Throne', 'Plains', ...extra] } });
    return tokens(activate(s, find(s, 'Test Throne', 'battlefield'), 0)).length;
  };
  it('is automated; with both named artifacts five Soldiers, otherwise one', () => {
    expect(full(THRONE)).toBe(true);
    expect(play(['Crown of Empires', 'Scepter of Empires'])).toBe(5);
    expect(play([])).toBe(1);
  });
  it('the negative cases: one of the two is not enough', () => {
    expect(play(['Crown of Empires'])).toBe(1);
    expect(play(['Scepter of Empires'])).toBe(1);
  });
  it('the artifacts must be yours: an opponent\'s Crown and Scepter do not count', () => {
    const s = scenario([], { defs: [THRONE, CROWN, SCEPTER], p1: { battlefield: ['Test Throne', 'Plains', 'Crown of Empires'] }, p2: { battlefield: ['Scepter of Empires'] } });
    expect(tokens(activate(s, find(s, 'Test Throne', 'battlefield'), 0)).length).toBe(1);
  });
});

// ---- Inkfathom Witch -------------------------------------------------------------------------------------------------------------------------------------
const WITCH = card('Test Witch', 'Creature — Merfolk Wizard', '{2}: Each unblocked creature has base power and toughness 4/1 until end of turn.', ['1', '1']);
const OGRE = colored('Test Ogre', 'Creature — Ogre', '', ['R'], ['3', '3']);

describe('CR 509.1h, 611.2c, 613.4b: "Each unblocked creature has base power and toughness 4/1 until end of turn."', () => {
  const afterBlocks = (): { s: GameState; bear: ObjectId; ogre: ObjectId; blocker: ObjectId; idle: ObjectId } => {
    let s = scenario([], { defs: [WITCH, BEAR, OGRE], p1: { battlefield: ['Test Witch', 'Test Bear', 'Test Ogre', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const blocker = find(s, 'Test Bear', 'battlefield', 'p2');
    const idle = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[bear], [ogre]]));
    s = declareBlockers(s, [[blocker, bear]]);
    return { s, bear, ogre, blocker, idle };
  };
  it('is automated; only the unblocked attacker becomes 4/1: the blocked attacker, the blocker and a creature that is not in combat keep their size', () => {
    expect(full(WITCH)).toBe(true);
    const b = afterBlocks();
    expect(b.s.turn.step).toBe('declareBlockers');
    const s = activate(b.s, find(b.s, 'Test Witch', 'battlefield'), 0);
    expect(pt(s, b.ogre)).toBe('4/1');
    expect(pt(s, b.bear)).toBe('2/2');
    expect(pt(s, b.blocker)).toBe('2/2');
    expect(pt(s, b.idle)).toBe('3/3');
  });
  it('the set is fixed as the ability resolves (CR 611.2c): the Ogre stays 4/1 after combat is over, and is 3/3 again on the next turn', () => {
    const b = afterBlocks();
    let s = activate(b.s, find(b.s, 'Test Witch', 'battlefield'), 0);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(pt(s, b.ogre)).toBe('4/1');
    expect(s.objects[b.ogre]!.zone).toBe('battlefield'); // 4/1 dealt 2 damage by nothing: it was never blocked
    s = advanceTo(s, 3, 'main1');
    expect(pt(s, b.ogre)).toBe('3/3');
  });
  it('the negative case: before blockers are declared no creature is unblocked (CR 509.1h), so nothing changes, and a creature that attacks later is not affected', () => {
    let s = scenario([], { defs: [WITCH, BEAR, OGRE], p1: { battlefield: ['Test Witch', 'Test Bear', 'Test Ogre', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = activate(s, find(s, 'Test Witch', 'battlefield'), 0);
    expect(pt(s, ogre)).toBe('3/3');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[ogre]]));
    expect(pt(s, ogre)).toBe('3/3');
  });
});

// ---- Give No Ground --------------------------------------------------------------------------------------------------------------------------------------
const GROUND = card('Test Stand', 'Instant', 'Target creature gets +2/+6 until end of turn and can block any number of creatures this turn.');

describe('CR 509.1a, 611.2a: "Target creature gets +2/+6 until end of turn and can block any number of creatures this turn."', () => {
  const attacked = (): { s: GameState; wall: ObjectId; attackers: ObjectId[] } => {
    let s = scenario([], { defs: [GROUND, BEAR, OGRE], p1: { battlefield: ['Test Bear', 'Test Ogre', 'Test Bear'] }, p2: { hand: ['Test Stand'], battlefield: ['Test Bear'] } });
    const attackers = findAll(s, 'Test Bear', 'battlefield', 'p1').concat(find(s, 'Test Ogre', 'battlefield', 'p1'));
    const wall = find(s, 'Test Bear', 'battlefield', 'p2');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, attackers.map((id) => [id] as [ObjectId]));
    return { s, wall, attackers };
  };
  it('is automated; the target is +2/+6 and may block all three attackers, where it could block one without the spell', () => {
    expect(full(GROUND)).toBe(true);
    let { s, wall, attackers } = attacked();
    // p2 gets priority in the declare attackers step and casts the spell on the Bear it will block with
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p2') s = pass(s);
    s = resolveAll(cast(s, 'Test Stand', { targets: [obj(wall)] }, 'p2'));
    expect(pt(s, wall)).toBe('4/8');
    expect(maxBlocks(s, wall)).toBe(Infinity);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, attackers.map((a) => [wall, a] as [ObjectId, ObjectId]));
    expect(s.combat!.blockers.find((b) => b.id === wall)!.blocking.length).toBe(3);
  });
  it('the negative cases: without the spell one block is the limit, and the effect is over on the next turn', () => {
    let { s, wall, attackers } = attacked();
    expect(maxBlocks(s, wall)).toBe(1);
    s = toDeclareBlockers(s);
    expect(rejects(s, (x) => declareBlockers(x, [[wall, attackers[0]!], [wall, attackers[1]!]]))).toBe(true);
    const t = attacked();
    let u = t.s;
    while (u.pending?.kind === 'priority' && u.pending.player !== 'p2') u = pass(u);
    u = resolveAll(cast(u, 'Test Stand', { targets: [obj(t.wall)] }, 'p2'));
    u = advanceTo(u, 3, 'main1');
    expect(maxBlocks(u, t.wall)).toBe(1);
    expect(pt(u, t.wall)).toBe('2/2');
  });
});

// ---- Lyzolda ---------------------------------------------------------------------------------------------------------------------------------------------
const WITCHDOC = card('Test Blood Witch', 'Creature — Human Wizard', '{2}, Sacrifice a creature: You gain 2 life if the sacrificed creature was red. Draw a card if the sacrificed creature was black.', ['1', '1']);
const ZOMBIE = colored('Test Zombie', 'Creature — Zombie', '', ['B'], ['2', '2']);
const GOBLIN = colored('Test Goblin', 'Creature — Goblin', '', ['R'], ['2', '2']);
const VAMPIRE = colored('Test Vampire', 'Creature — Vampire', '', ['B', 'R'], ['2', '2']);

describe('CR 608.2c, 701.21a: "~ deals 2 damage to any target if the sacrificed creature was red. Draw a card if the sacrificed creature was black."', () => {
  const sacrifice = (name: string): GameState => {
    const s = scenario([], { defs: [WITCHDOC, BEAR, ZOMBIE, GOBLIN, VAMPIRE], p1: { battlefield: ['Test Blood Witch', name, 'Plains', 'Plains'] } });
    const witch = find(s, 'Test Blood Witch', 'battlefield');
    const t = act(s, { type: 'activate', player: 'p1', source: witch, ability: activatedAbilities(s, s.objects[witch]!)[0]!.key });
    return resolveAll(t, { objects: [find(s, name, 'battlefield')] });
  };
  const result = (name: string): { life: number; hand: number; yard: boolean } => {
    const s = sacrifice(name);
    return { life: lifeOf(s, 'p1'), hand: handSize(s, 'p1'), yard: inYard(s, name) };
  };
  it('is automated (the damage half of Lyzolda is the reading of edh-c-39); a red creature: 2 life and no card; a black one: a card and no life; a red and black one: both; a green one: neither', () => {
    expect(full(WITCHDOC)).toBe(true);
    const base = handSize(scenario([], { defs: [WITCHDOC], p1: {} }), 'p1');
    expect(result('Test Goblin')).toEqual({ life: 22, hand: base, yard: true });
    expect(result('Test Zombie')).toEqual({ life: 20, hand: base + 1, yard: true });
    expect(result('Test Vampire')).toEqual({ life: 22, hand: base + 1, yard: true });
    expect(result('Test Bear')).toEqual({ life: 20, hand: base, yard: true });
  });
  it('the negative case: a colorless creature (the Witch sacrificing itself) gives neither life nor a card', () => {
    const s0 = scenario([], { defs: [WITCHDOC], p1: { battlefield: ['Test Blood Witch', 'Plains', 'Plains'] } });
    const witch = find(s0, 'Test Blood Witch', 'battlefield');
    const t = act(s0, { type: 'activate', player: 'p1', source: witch, ability: activatedAbilities(s0, s0.objects[witch]!)[0]!.key });
    const s = resolveAll(t, { objects: [witch] });
    expect(inYard(s, 'Test Blood Witch')).toBe(true);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1'));
  });
});

// ---- Stampede Surfer -------------------------------------------------------------------------------------------------------------------------------------
const SURFER = card('Test Surfer', 'Creature — Merfolk', 'Haste\nWhenever this creature attacks, for each opponent, you create a 2/2 green Boar creature token that\'s tapped and attacking that opponent.', ['2', '2']);

describe('CR 508.4, 101.4: "for each opponent, you create a 2/2 green Boar creature token that\'s tapped and attacking that opponent" (four players)', () => {
  it('is automated; each of the three opponents gets one tapped Boar that attacks that opponent (the tokens were never declared as attackers)', () => {
    expect(full(SURFER)).toBe(true);
    let s = mpScenario({ defs: [SURFER], zones: { p1: { battlefield: ['Test Surfer'] } } });
    const surfer = find(s, 'Test Surfer', 'battlefield');
    s = toDeclareAttackers(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: surfer, defender: 'p2' }] });
    s = drive(s);
    s = resolveAll(s);
    const boars = tokens(s, 'p1');
    expect(boars.length).toBe(3);
    const defenders = boars.map((id) => s.combat!.attackers.find((a) => a.id === id)?.defender).sort();
    expect(defenders).toEqual(['p2', 'p3', 'p4']);
    for (const id of boars) { expect(s.objects[id]!.tapped).toBe(true); expect(pt(s, id)).toBe('2/2'); }
  });
});

// ---- Coiling Stalker -------------------------------------------------------------------------------------------------------------------------------------
const STALKER = card('Test Stalker', 'Creature — Snake', 'Whenever this creature deals combat damage to a player, put a +1/+1 counter on target creature you control that doesn\'t have a +1/+1 counter on it.', ['2', '2']);

describe('CR 122.1, 115.1: "put a +1/+1 counter on target creature you control that doesn\'t have a +1/+1 counter on it."', () => {
  it('is automated; only a creature with no +1/+1 counter is a legal target: the one with a counter and the opponent\'s creature are not', () => {
    expect(full(STALKER)).toBe(true);
    let s = scenario([], { defs: [STALKER, BEAR, OGRE], p1: { battlefield: ['Test Stalker', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] } });
    const stalker = find(s, 'Test Stalker', 'battlefield');
    const withCounter = find(s, 'Test Bear', 'battlefield', 'p1');
    const bare = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = toDeclareDamage(s, stalker);
    const d = s.pending as { kind: string } | undefined;
    expect(d?.kind).toBe('chooseTargets');
    const stalkerId = stalker;
    for (const bad of [withCounter, find(s, 'Test Bear', 'battlefield', 'p2')]) {
      expect(rejects(s, (x) => answer(x, { kind: 'chooseTargets', targets: [obj(bad)] }))).toBe(true);
    }
    expect(rejects(s, (x) => answer(x, { kind: 'chooseTargets', targets: [obj(stalkerId)] }))).toBe(false); // the Stalker itself has no counter
    s = resolveAll(s, { targets: [obj(bare)] });
    expect(counters(s, bare, '+1/+1')).toBe(1);
    expect(counters(s, withCounter, '+1/+1')).toBe(1);
  });
});
function toDeclareDamage(s0: GameState, attacker: ObjectId): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  for (let i = 0; i < 40 && s.zones.stack.length === 0; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : pass(s);
  return s;
}

// ---- Vraska, Regal Gorgon --------------------------------------------------------------------------------------------------------------------------------
const GORGON = card('Test Gorgon', 'Legendary Planeswalker — Test', '-1: For each creature card in your graveyard, put a +1/+1 counter on each creature you control.');

describe('CR 122.1, 608.2h, 608.2c: "For each creature card in your graveyard, put a +1/+1 counter on each creature you control."', () => {
  it('is automated; with three creature cards in the graveyard every creature you control gets three counters, the opponent\'s creature none', () => {
    expect(full(GORGON)).toBe(true);
    let s = scenario([], { defs: [GORGON, BEAR, OGRE, ROCK], p1: { battlefield: ['Test Bear', 'Test Ogre'], graveyard: ['Test Bear', 'Test Bear', 'Test Ogre', 'Test Rock'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    let gorgon = '';
    s = tweak(s, (t) => { gorgon = put(t, 'p1', 'battlefield', { name: 'Test Gorgon', counters: { loyalty: 5 } }); }); // a planeswalker with no loyalty would be put into the graveyard at once (CR 704.5i)
    s = activate(s, gorgon, 0);
    expect(counters(s, mine, '+1/+1')).toBe(3);
    expect(counters(s, ogre, '+1/+1')).toBe(3);
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p2'), '+1/+1')).toBe(0);
    expect(pt(s, mine)).toBe('5/5');
  });
  it('the negative case: an empty graveyard (or one of noncreature cards) puts no counters', () => {
    let s = scenario([], { defs: [GORGON, BEAR, ROCK], p1: { battlefield: ['Test Bear'], graveyard: ['Test Rock'] } });
    let gorgon = '';
    s = tweak(s, (t) => { gorgon = put(t, 'p1', 'battlefield', { name: 'Test Gorgon', counters: { loyalty: 5 } }); });
    s = activate(s, gorgon, 0);
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
});

// ---- Stormwild Capridor ----------------------------------------------------------------------------------------------------------------------------------
const GOAT = card('Test Goat', 'Creature — Goat', 'If noncombat damage would be dealt to this creature, prevent that damage. Put a time counter on this creature for each 1 damage prevented this way.', ['2', '2']);
const SPARK = card('Test Spark', 'Instant', '~ deals 3 damage to target creature.');

describe('CR 615.1, 615.5, 120.2, 122.1: "If noncombat damage would be dealt to ~, prevent that damage. Put a counter on ~ for each 1 damage prevented this way."', () => {
  it('is automated; 3 noncombat damage is prevented and puts three counters on it (the damage is not marked), another creature takes the damage as usual with no counters', () => {
    expect(full(GOAT)).toBe(true);
    let s = scenario(['Mountain'], { defs: [GOAT, SPARK, BEAR], p1: { hand: ['Test Spark', 'Test Spark'], battlefield: ['Test Goat', 'Test Bear'] } });
    const goat = find(s, 'Test Goat', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Spark', { targets: [obj(goat)] }));
    expect(s.objects[goat]!.zone).toBe('battlefield');
    expect(s.objects[goat]!.damage).toBe(0);
    expect(counters(s, goat, 'time')).toBe(3);
    s = resolveAll(cast(s, 'Test Spark', { targets: [obj(bear)] }));
    expect(inYard(s, 'Test Bear')).toBe(true);
    expect(counters(s, goat, 'time')).toBe(3);
  });
  it('the negative case: combat damage is not prevented, it marks damage and kills the 2/2 with no counters', () => {
    let s = scenario([], { defs: [GOAT, OGRE], p1: { battlefield: ['Test Goat'] }, p2: { battlefield: ['Test Ogre'] } });
    const goat = find(s, 'Test Goat', 'battlefield');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[goat]]));
    s = declareBlockers(s, [[find(s, 'Test Ogre', 'battlefield', 'p2'), goat]]);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(inYard(s, 'Test Goat')).toBe(true);
  });
});

// ---- Screams from Within (made full by the Aura-trigger graveyard wording) --------------------------------------------------------------------------------
const SCREAM = card('Test Scream', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-1.\nWhen enchanted creature dies, return ~ from your graveyard to the battlefield.');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 303.4g, 704.5m, 603.10a: "When enchanted creature dies, return ~ from your graveyard to the battlefield." (an Aura that returns is attached to something it can enchant)', () => {
  it('is automated; the returned Aura enters attached to a creature and stays on the battlefield (not put back into the graveyard)', () => {
    expect(full(SCREAM)).toBe(true);
    let s = scenario([], { defs: [SCREAM, KILL, OGRE, BEAR], p1: { hand: ['Test Kill'], battlefield: ['Test Ogre', 'Test Bear', 'Plains'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = tweak(s, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Scream')]!.attachedTo = ogre; });
    s = resolveAll(cast(s, 'Test Kill', { targets: [obj(ogre)] }), { objects: [find(s, 'Test Bear', 'battlefield')] });
    const aura = onField(s, 'Test Scream');
    expect(aura.length).toBe(1);
    expect(s.objects[aura[0]!]!.attachedTo).toBe(find(s, 'Test Bear', 'battlefield'));
  });
});
