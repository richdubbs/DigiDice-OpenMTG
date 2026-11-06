/**
 * Commander lane edh-c, round edh-c-48: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25 (702.100a evolve; "evolves" is defined by Renegade Krasis's rulings of 2013-04-15).
 *
 *   CR 509.3e, 509.1h, 506.3e   "Whenever a creature attacking one of your opponents becomes blocked by two or more creatures, that attacking creature gains deathtouch until end of turn." (Seifer, Balamb Rival)
 *   CR 702.100a, 122.6          "Whenever this creature evolves, put a +1/+1 counter on each other creature you control with a +1/+1 counter on it." (Renegade Krasis, ruling 2013-04-15)
 *   CR 701.53a, 107.3, 608.2c   "Incubate X twice, where X is the number of lands you control." (Glistening Dawn, ruling 2023-04-14)
 *   CR 702.24a, 121.2, 704.5b   "Cumulative upkeep--Draw a card." (Psychic Vortex, rulings 2008-04-01)
 *   CR 106.6, 116.2h, 702.143a  "{T}: Add {U}. Spend this mana only to foretell a card from your hand or cast an instant or sorcery spell." (Karfell Harbinger)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';
import { drive } from '../../m6/dfc/support';
import { card, cast, counters, full, named, resolveAll, tokens } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const hasDeathtouch = (s: GameState, id: ObjectId): boolean => getChars(s, id).keywords.some((k) => k.keyword === 'deathtouch');
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const byName = (s: GameState, name: string, p: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && s.objects[id]!.controller === p);

// ---- Seifer, Balamb Rival ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 509.3e: "Whenever a creature attacking one of your opponents becomes blocked by two or more creatures, that attacking creature gains deathtouch until end of turn."', () => {
  const RIVAL = card('Test Duel Rival', 'Creature — Human Soldier', 'Whenever a creature attacking one of your opponents becomes blocked by two or more creatures, that attacking creature gains deathtouch until end of turn.', ['2', '2']);
  const COUNTER = card('Test Duel Counter', 'Creature — Human Soldier', 'Whenever a creature attacking one of your opponents becomes blocked by two or more creatures, you gain 1 life.', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const GUARD = card('Test Gate Guard', 'Creature — Soldier', '', ['2', '2']);
  const CAT = card('Test Cat Guard', 'Creature — Cat', "Whenever this creature blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature.", ['2', '2']);
  const defs = [RIVAL, COUNTER, BEAR, GUARD, CAT];
  it('is automated', () => {
    expect(full(RIVAL), JSON.stringify(RIVAL.automation)).toBe(true);
    expect(full(COUNTER), JSON.stringify(COUNTER.automation)).toBe(true);
  });
  /** p1 attacks p2's board with the bear; p2 blocks with the named creatures. */
  const attackBlockedBy = (rival: string, blockers: string[], extra: Record<string, string[]> = {}): { s: GameState; bear: ObjectId } => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: [rival, 'Test Plain Bear'] }, p2: { battlefield: blockers.length > 0 ? [...new Set(blockers)].flatMap((n) => Array(blockers.filter((b) => b === n).length).fill(n) as string[]) : ['Test Gate Guard'], ...extra } }), 3, 'main1');
    const bear = byName(s0, 'Test Plain Bear', 'p1')[0]!;
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bear]]));
    const ids = blockers.map((n, i) => byName(s, n, 'p2')[blockers.slice(0, i).filter((b) => b === n).length]!);
    s = resolveAll(declareBlockers(s, ids.map((b) => [b, bear] as [ObjectId, ObjectId])));
    return { s, bear };
  };
  it('blocked by two creatures: the attacker gains deathtouch', () => {
    const { s, bear } = attackBlockedBy('Test Duel Rival', ['Test Gate Guard', 'Test Gate Guard']);
    expect(hasDeathtouch(s, bear)).toBe(true);
  });
  it('negative: blocked by one creature only: no deathtouch', () => {
    const { s, bear } = attackBlockedBy('Test Duel Rival', ['Test Gate Guard']);
    expect(hasDeathtouch(s, bear)).toBe(false);
  });
  it('negative: not blocked at all: no deathtouch', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Duel Rival', 'Test Plain Bear'] }, p2: { battlefield: ['Test Gate Guard'] } }), 3, 'main1');
    const bear = byName(s0, 'Test Plain Bear', 'p1')[0]!;
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bear]]));
    s = resolveAll(declareBlockers(s, []));
    expect(hasDeathtouch(s, bear)).toBe(false);
  });
  it('CR 603.2, 509.3c: three blockers are still one occurrence (it triggers once, when the number reaches two)', () => {
    const { s } = attackBlockedBy('Test Duel Counter', ['Test Gate Guard', 'Test Gate Guard', 'Test Gate Guard']);
    expect(lifeOf(s, 'p1')).toBe(20 + 1);
  });
  it('negative: an opponent\'s creature that attacks YOU is not "attacking one of your opponents": nothing happens', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Duel Rival', 'Test Gate Guard', 'Test Gate Guard'] }, p2: { battlefield: ['Test Plain Bear'] } }), 4, 'main1');
    const bear = byName(s0, 'Test Plain Bear', 'p2')[0]!;
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bear]]));
    const guards = byName(s, 'Test Gate Guard', 'p1');
    s = resolveAll(declareBlockers(s, guards.map((g) => [g, bear] as [ObjectId, ObjectId])));
    expect(hasDeathtouch(s, bear)).toBe(false);
  });
  it('CR 509.3e: a second blocker put onto the battlefield blocking an attacker with one blocker makes it blocked by two (the trigger waits for the number, not the declaration)', () => {
    const { s, bear } = attackBlockedBy('Test Duel Rival', ['Test Cat Guard']);
    expect(s.combat!.attackers.find((a) => a.id === bear)!.blockedBy.length).toBe(2);
    expect(hasDeathtouch(s, bear)).toBe(true);
  });
});

// ---- Renegade Krasis -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.100a: "Whenever this creature evolves, put a +1/+1 counter on each other creature you control with a +1/+1 counter on it."', () => {
  const BEAST = card('Test Mutant Beast', 'Creature — Beast', 'Evolve\nWhenever this creature evolves, put a +1/+1 counter on each other creature you control with a +1/+1 counter on it.', ['1', '1']);
  const CUB = card('Test Counter Cub', 'Creature — Beast', 'This creature enters with a +1/+1 counter on it.', ['2', '2']);
  const MOUSE = card('Test Small Mouse', 'Creature — Mouse', '', ['1', '1']);
  const BOOST = card('Test Growth Rite', 'Sorcery', 'Put a +1/+1 counter on target creature you control.');
  const defs = [BEAST, CUB, MOUSE, BOOST];
  it('is automated', () => expect(full(BEAST), JSON.stringify(BEAST.automation)).toBe(true));
  it('a bigger creature enters: evolve puts a counter on the Beast, the Beast evolves, and every OTHER creature with a +1/+1 counter gets one (the Beast\'s own counter is not doubled)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Counter Cub'], battlefield: ['Test Mutant Beast'] } });
    const s = cast(s0, 'Test Counter Cub');
    const settled = resolveAll(s);
    const beast = find(settled, 'Test Mutant Beast', 'battlefield', 'p1');
    const cub = find(settled, 'Test Counter Cub', 'battlefield', 'p1');
    expect(counters(settled, beast, '+1/+1')).toBe(1);
    expect(counters(settled, cub, '+1/+1')).toBe(2);
  });
  it('negative: a creature that is no bigger does not make it evolve, so nothing else gets a counter', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Small Mouse'], battlefield: ['Test Mutant Beast', 'Test Counter Cub'] } });
    const s = resolveAll(cast(s0, 'Test Small Mouse'));
    expect(counters(s, find(s, 'Test Mutant Beast', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    expect(counters(s, find(s, 'Test Counter Cub', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
  it('negative (ruling 2013-04-15): a counter put on the Beast by anything but its evolve ability is not evolving', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Growth Rite'], battlefield: ['Test Mutant Beast', 'Test Counter Cub'] } });
    const beast = find(s0, 'Test Mutant Beast', 'battlefield', 'p1');
    const s = resolveAll(cast(s0, 'Test Growth Rite', { targets: [{ kind: 'object', id: beast }] }));
    expect(counters(s, beast, '+1/+1')).toBe(1);
    expect(counters(s, find(s, 'Test Counter Cub', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
});

// ---- Glistening Dawn -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.53a, 107.3: "Incubate X twice, where X is the number of lands you control."', () => {
  const DAWN = card('Test Dawn Rite', 'Sorcery', 'Incubate X twice, where X is the number of lands you control.');
  it('is automated', () => expect(full(DAWN), JSON.stringify(DAWN.automation)).toBe(true));
  const run = (lands: number): GameState => resolveAll(cast(scenario(['Plains'], { defs: [DAWN], p1: { hand: ['Test Dawn Rite'], battlefield: Array(lands).fill('Plains') as string[] } }), 'Test Dawn Rite'));
  it('two Incubator tokens, each with X +1/+1 counters (X = three lands)', () => {
    const s = run(3);
    const inc = tokens(s).filter((id) => nameOf(s, id).startsWith('Incubator'));
    expect(inc.length).toBe(2);
    for (const id of inc) expect(counters(s, id, '+1/+1')).toBe(3);
  });
  it('CR 608.2h: X is fixed once, even when incubating changes what it counts (artifacts: the first Incubator is one)', () => {
    const ART = card('Test Dawn Gears', 'Sorcery', 'Incubate X twice, where X is the number of artifacts you control.');
    const CLOCK = card('Test Dull Clock', 'Artifact', '');
    const s = resolveAll(cast(scenario([], { defs: [ART, CLOCK], p1: { hand: ['Test Dawn Gears'], battlefield: ['Test Dull Clock'] } }), 'Test Dawn Gears'));
    const inc = tokens(s).filter((id) => nameOf(s, id).startsWith('Incubator'));
    expect(inc.map((id) => counters(s, id, '+1/+1'))).toEqual([1, 1]);
  });
  it('negative: X follows the lands (two lands: two counters each)', () => {
    const s = run(2);
    const inc = tokens(s).filter((id) => nameOf(s, id).startsWith('Incubator'));
    expect(inc.length).toBe(2);
    for (const id of inc) expect(counters(s, id, '+1/+1')).toBe(2);
  });
});

// ---- Psychic Vortex --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.24a, 121.2: "Cumulative upkeep--Draw a card."', () => {
  const VORTEX = card('Test Mind Spiral', 'Enchantment', 'Cumulative upkeep--Draw a card.');
  const library = Array(12).fill('Plains') as string[];
  const board = (lib = library): GameState => scenario(['Plains'], { defs: [VORTEX], p1: { battlefield: ['Test Mind Spiral'], library: lib } });
  const hand = (s: GameState): number => (s.zones.hand['p1'] ?? []).length;
  it('is automated', () => expect(full(VORTEX), JSON.stringify(VORTEX.automation)).toBe(true));
  it('each of your upkeeps: one more age counter, and as many cards drawn as there are age counters (1, then 2)', () => {
    const s0 = advanceTo(board(), 3, 'upkeep');
    const before = hand(s0);
    const s1 = resolveAll(s0);
    const spiral = find(s1, 'Test Mind Spiral', 'battlefield', 'p1');
    expect(counters(s1, spiral, 'age')).toBe(1);
    expect(hand(s1)).toBe(before + 1);
    const s2 = advanceTo(s1, 5, 'upkeep');
    const before2 = hand(s2);
    const s3 = resolveAll(s2);
    expect(counters(s3, spiral, 'age')).toBe(2);
    expect(hand(s3)).toBe(before2 + 2);
  });
  it('negative: it is not your upkeep (turn 2 is the opponent\'s): no age counter, no card', () => {
    const s0 = advanceTo(board(), 2, 'upkeep');
    const before = hand(s0);
    const s = resolveAll(s0);
    expect(counters(s, find(s, 'Test Mind Spiral', 'battlefield', 'p1'), 'age')).toBe(0);
    expect(hand(s)).toBe(before);
  });
  it('CR 121.2b: with "can\'t draw more than one card each turn" in play, a cost that draws two cards cannot be paid, so the Vortex is sacrificed', () => {
    const LIMIT = card('Test Draw Limiter', 'Enchantment', "Each opponent can't draw more than one card each turn.");
    const s0 = scenario(['Plains'], { defs: [VORTEX, LIMIT], p1: { battlefield: ['Test Mind Spiral'], library: library }, p2: { battlefield: ['Test Draw Limiter'] } });
    const s1 = resolveAll(advanceTo(s0, 3, 'upkeep'));
    const s2 = resolveAll(advanceTo(s1, 5, 'upkeep'), { yes: true });
    expect(named(s2, 'Test Mind Spiral')).toEqual([]);
  });
  it('ruling 2008-04-01: paying with an empty library is allowed, and the draw from it loses the game as a state-based action (CR 704.5b)', () => {
    const s = resolveAll(advanceTo(tweak(board(), (t) => { t.zones.library['p1'] = []; }), 3, 'upkeep'));
    expect(s.result?.winner ?? null).not.toBe('p1');
    expect(s.result).toBeTruthy();
  });
});

// ---- Karfell Harbinger -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 106.6, 116.2h, 702.143a: "{T}: Add {U}. Spend this mana only to foretell a card from your hand or cast an instant or sorcery spell."', () => {
  const SCOUT = card('Test Tide Scout', 'Creature — Wizard', '{T}: Add {U}. Spend this mana only to foretell a card from your hand or cast an instant or sorcery spell.', ['1', '1']);
  const TIDE = card('Test Tide Flare', 'Instant', 'You gain 2 life.\nForetell {U}', ['1', '1'], '{2}{U}');
  const SPELL = card('Test Tide Gain', 'Instant', 'You gain 1 life.', undefined, '{1}');
  const DRAKE = card('Test Blue Drake', 'Creature — Drake', '', ['1', '1'], '{1}');
  const defs = [SCOUT, TIDE, SPELL, DRAKE];
  it('is automated', () => expect(full(SCOUT), JSON.stringify(SCOUT.automation)).toBe(true));
  const hasAction = (s: GameState, kind: string, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === kind && a.object !== undefined && nameOf(s, a.object) === name);
  it('two of the mana can pay for the {2} of foretelling a card from your hand', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Tide Flare'], battlefield: ['Test Tide Scout', 'Test Tide Scout'] } });
    expect(hasAction(s, 'special', 'Test Tide Flare')).toBe(true);
  });
  it('negative: one of the mana is not enough for the {2}', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Tide Flare'], battlefield: ['Test Tide Scout'] } });
    expect(hasAction(s, 'special', 'Test Tide Flare')).toBe(false);
  });
  it('it can cast an instant, but negative: it cannot cast a creature spell', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Tide Gain', 'Test Blue Drake'], battlefield: ['Test Tide Scout'] } });
    expect(hasAction(s, 'cast', 'Test Tide Gain')).toBe(true);
    expect(hasAction(s, 'cast', 'Test Blue Drake')).toBe(false);
  });
  it('the foretell action pays with that mana: the card is exiled foretold and both Scouts are tapped', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Tide Flare'], battlefield: ['Test Tide Scout', 'Test Tide Scout'] } });
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'special' && x.object !== undefined && nameOf(s0, x.object) === 'Test Tide Flare')!;
    const s = drive(act(s0, a.action));
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Tide Flare')).toBe(true);
    expect(named(s, 'Test Tide Scout').every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

// ---- Infernal Genesis ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.17a, 608.2c, 608.2h: "At the beginning of each player\'s upkeep, that player mills a card. Then they create X 1/1 black Minion creature tokens, where X is the milled card\'s mana value."', () => {
  const GENESIS = card('Test Grave Engine', 'Enchantment', 'At the beginning of each player\'s upkeep, that player mills a card. Then they create X 1/1 black Minion creature tokens, where X is the milled card\'s mana value.');
  const THREE = card('Test Three Drop', 'Artifact', '', undefined, '{3}');
  const libraryOf = (p: string, names: string[]) => ({ [p]: { library: names } });
  it('is automated', () => expect(full(GENESIS), JSON.stringify(GENESIS.automation)).toBe(true));
  const minions = (s: GameState, p: string): number => tokens(s, p).filter((id) => nameOf(s, id).startsWith('Minion')).length;
  it('the player whose upkeep it is mills the top card and creates that many tokens (a three-drop: three tokens), under their own control', () => {
    const s0 = advanceTo(scenario([], { defs: [GENESIS, THREE], p1: { battlefield: ['Test Grave Engine'], ...libraryOf('p1', ['Test Three Drop']).p1 } }), 3, 'upkeep');
    const s = resolveAll(s0);
    expect(minions(s, 'p1')).toBe(3);
    expect(minions(s, 'p2')).toBe(0);
  });
  it('an opponent\'s upkeep: the OPPONENT mills and creates the tokens (that player and "they", not you)', () => {
    const s0 = advanceTo(scenario([], { defs: [GENESIS, THREE], p1: { battlefield: ['Test Grave Engine'] }, p2: { ...libraryOf('p2', ['Test Three Drop']).p2 } }), 2, 'upkeep');
    const s = resolveAll(s0);
    expect(minions(s, 'p2')).toBe(3);
    expect(minions(s, 'p1')).toBe(0);
  });
  it('negative: a land (mana value 0) makes no token', () => {
    const s0 = advanceTo(scenario(['Plains'], { defs: [GENESIS], p1: { battlefield: ['Test Grave Engine'], library: ['Plains'] } }), 3, 'upkeep');
    expect(minions(resolveAll(s0), 'p1')).toBe(0);
  });
});

// ---- Chandra's Phoenix -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 120.2, 603.2, 603.6: "Whenever an opponent is dealt damage by a red instant or sorcery spell you control or by a red planeswalker you control, return this card from your graveyard to your hand."', () => {
  const mk = (name: string, type: string, text: string, colors: string[], extra: Record<string, unknown> = {}) =>
    compileCard({ name, layout: 'normal', mana_cost: colors.includes('R') ? '{R}' : colors.includes('U') ? '{U}' : '{0}', type_line: type, oracle_text: text, colors, ...extra } as OracleCard);
  const PHOENIX = mk('Test Ember Bird', 'Creature — Phoenix', 'Whenever an opponent is dealt damage by a red instant or sorcery spell you control or by a red planeswalker you control, return this card from your graveyard to your hand.', ['R'], { power: '2', toughness: '2' });
  const BOLT = mk('Test Red Bolt', 'Instant', 'Test Red Bolt deals 2 damage to target opponent.', ['R']);
  const BLUE = mk('Test Blue Bolt', 'Instant', 'Test Blue Bolt deals 2 damage to target opponent.', ['U']);
  const CREATURE_BOLT = mk('Test Red Strike', 'Instant', 'Test Red Strike deals 2 damage to target creature.', ['R']);
  const WALKER = mk('Test Flame Walker', 'Legendary Planeswalker — Test', '+1: Test Flame Walker deals 1 damage to target opponent.', ['R'], { loyalty: '3' });
  const BEAR = mk('Test Bear', 'Creature — Bear', '', [], { power: '2', toughness: '2' });
  const defs = [PHOENIX, BOLT, BLUE, CREATURE_BOLT, WALKER, BEAR];
  const inHand = (s: GameState, name: string, p = 'p1'): boolean => (s.zones.hand[p] ?? []).some((id) => nameOf(s, id) === name);
  const board = (hand: string[], battlefield: (string | { name: string; counters: Record<string, number> })[] = ['Mountain', 'Island']): GameState => scenario(['Mountain', 'Island'], { defs, p1: { hand, graveyard: ['Test Ember Bird'], battlefield }, p2: { battlefield: ['Test Bear'] } });
  it('is automated', () => expect(full(PHOENIX), JSON.stringify(PHOENIX.automation)).toBe(true));
  it('a red instant you control that deals damage to an opponent returns the Phoenix from your graveyard to your hand', () => {
    const s = resolveAll(cast(board(['Test Red Bolt']), 'Test Red Bolt', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(inHand(s, 'Test Ember Bird')).toBe(true);
  });
  it('negative: a blue instant does the same damage and the Phoenix stays', () => {
    const s = resolveAll(cast(board(['Test Blue Bolt']), 'Test Blue Bolt', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(inHand(s, 'Test Ember Bird')).toBe(false);
  });
  it('negative: damage to a creature is not an opponent being dealt damage', () => {
    const s0 = board(['Test Red Strike']);
    const s = resolveAll(cast(s0, 'Test Red Strike', { targets: [{ kind: 'object', id: byName(s0, 'Test Bear', 'p2')[0]! }] }));
    expect(inHand(s, 'Test Ember Bird')).toBe(false);
  });
  it('a red planeswalker you control that deals damage to an opponent returns it too', () => {
    const s0 = board([], [{ name: 'Test Flame Walker', counters: { loyalty: 3 } }]);
    const walker = byName(s0, 'Test Flame Walker', 'p1')[0]!;
    const a = legalActions(s0, 'p1').find((x) => x.object === walker && x.kind !== 'playLand' && x.kind !== 'cast' && x.label.includes('+1'))!;
    const s = resolveAll(drive(act(s0, a.action)), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(inHand(s, 'Test Ember Bird')).toBe(true);
  });
  it('negative: a red instant an OPPONENT controls does not return it (the spell must be one you control)', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { graveyard: ['Test Ember Bird'] }, p2: { hand: ['Test Red Bolt'], battlefield: ['Mountain'] } });
    const s = resolveAll(cast(pass(s0), 'Test Red Bolt', { targets: [{ kind: 'player', id: 'p1' }] }, 'p2'));
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(inHand(s, 'Test Ember Bird')).toBe(false);
  });
});

// ---- Heart-Shaped Herb -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a, 400.7, 608.2c: "{2}, {T}, Sacrifice this artifact: You may sacrifice a creature. If you do, return that card to the battlefield under its owner\'s control with three +1/+1 counters on it and you become the monarch."', () => {
  const HERB = card('Test Verdant Charm', 'Artifact', '{2}, {T}, Sacrifice this artifact: You may sacrifice a creature. If you do, return that card to the battlefield under its owner\'s control with three +1/+1 counters on it and you become the monarch.');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '2']);
  const board = (): GameState => scenario(['Plains'], { defs: [HERB, OX], p1: { battlefield: ['Test Verdant Charm', 'Test Plain Ox', 'Plains', 'Plains'] } });
  const run = (yes: boolean): GameState => {
    const s0 = board();
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object !== undefined && nameOf(s0, x.object) === 'Test Verdant Charm')!;
    return resolveAll(drive(act(s0, a.action)), { yes });
  };
  const monarch = (s: GameState): string | null => s.designations?.monarch ?? null;
  it('is automated', () => expect(full(HERB), JSON.stringify(HERB.automation)).toBe(true));
  it('sacrifice the creature: it comes back as a new object with three +1/+1 counters, and you become the monarch', () => {
    const s = run(true);
    const ox = find(s, 'Test Plain Ox', 'battlefield', 'p1');
    expect(counters(s, ox, '+1/+1')).toBe(3);
    expect(monarch(s)).toBe('p1');
    expect(named(s, 'Test Verdant Charm')).toEqual([]); // the Herb itself was sacrificed as a cost
  });
  it('negative: decline the sacrifice and nothing returns, you are not the monarch', () => {
    const s = run(false);
    const ox = find(s, 'Test Plain Ox', 'battlefield', 'p1');
    expect(counters(s, ox, '+1/+1')).toBe(0);
    expect(monarch(s)).not.toBe('p1');
  });
});

// ---- Kumano Faces Kakkazan // Etching of Kumano ------------------------------------------------------------------------------------------------------------
describe('CR 120.1, 614.1a, 400.7: "If a creature dealt damage this turn by a source you controlled would die, exile it instead."', () => {
  const RULE = card('Test Burning Edict', 'Enchantment', 'If a creature dealt damage this turn by a source you controlled would die, exile it instead.');
  const PEBBLE = card('Test Pebble Toss', 'Instant', 'Test Pebble Toss deals 1 damage to target creature.');
  const KILL = card('Test Sharp Verdict', 'Instant', 'Destroy target creature.');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', ['4', '4']);
  const defs = [RULE, PEBBLE, KILL, OGRE];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Burning Edict'], hand: ['Test Pebble Toss', 'Test Sharp Verdict'] }, p2: { battlefield: ['Test Big Ogre'], hand: ['Test Pebble Toss'] } });
  const ogreIn = (s: GameState, zone: 'battlefield' | 'graveyard' | 'exile'): boolean => Object.values(s.objects).some((o) => o.zone === zone && o.owner === 'p2' && nameOf(s, o.id) === 'Test Big Ogre');
  it('is automated', () => expect(full(RULE), JSON.stringify(RULE.automation)).toBe(true));
  it('a creature your source dealt damage to this turn is exiled instead of dying', () => {
    const s0 = board();
    const ogre = byName(s0, 'Test Big Ogre', 'p2')[0]!;
    let s = resolveAll(cast(s0, 'Test Pebble Toss', { targets: [{ kind: 'object', id: ogre }] }));
    s = resolveAll(cast(s, 'Test Sharp Verdict', { targets: [{ kind: 'object', id: ogre }] }));
    expect(ogreIn(s, 'exile')).toBe(true);
    expect(ogreIn(s, 'graveyard')).toBe(false);
  });
  it('negative: a creature that was not dealt damage by your source this turn dies as usual', () => {
    const s0 = board();
    const ogre = byName(s0, 'Test Big Ogre', 'p2')[0]!;
    const s = resolveAll(cast(s0, 'Test Sharp Verdict', { targets: [{ kind: 'object', id: ogre }] }));
    expect(ogreIn(s, 'graveyard')).toBe(true);
    expect(ogreIn(s, 'exile')).toBe(false);
  });
  it('negative: damage from the creature\'s own controller\'s source is not damage by a source YOU controlled', () => {
    const s0 = board();
    const ogre = byName(s0, 'Test Big Ogre', 'p2')[0]!;
    let s = resolveAll(cast(pass(s0), 'Test Pebble Toss', { targets: [{ kind: 'object', id: ogre }] }, 'p2'));
    s = resolveAll(cast(s, 'Test Sharp Verdict', { targets: [{ kind: 'object', id: ogre }] }, 'p1'));
    expect(ogreIn(s, 'graveyard')).toBe(true);
    expect(ogreIn(s, 'exile')).toBe(false);
  });
});
