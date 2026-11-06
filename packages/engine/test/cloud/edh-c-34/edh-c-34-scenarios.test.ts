/**
 * Commander EDHREC ranks 25,001-25,500, round edh-c-34 (first pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 702.9, 613.1f, 613.7        "All creatures lose flying." (Gravity Sphere) / "... and islandwalk." (Mystic Decree)
 *   CR 603.4, 608.2c, 111.2        "At the beginning of each player's upkeep, if that player controls more lands than each other player, the player creates a ... token."
 *   CR 201.5, 608.2b, 122.1        "When ~ dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two ... instead."
 *   CR 105.2, 608.2h               "Destroy target artifact or enchantment. If that permanent was blue or black, draw a card."
 *   CR 608.2c, 701.9a              "At the beginning of your upkeep, target opponent discards a card if you control the creature with the greatest power or tied for the greatest power."
 *   CR 601.2f, 602.2b, 118.7       "White spells cost {3} more to cast. Activated abilities of white enchantments cost {3} more to activate."
 *   CR 509.1g-h, 601.2c, 601.2h    "{B}, Sacrifice ~: Destroy target creature ~ is blocking."
 *   CR 115.1, 119.3, 608.2b        "{B}{R}: Target player who lost life this turn loses 1 life."
 *   CR 611.2c, 702.36              "Whenever ~ attacks, each other attacking creature gains fear until end of turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { card, counters, full, inYard, named, resolveAll, settle, tokens } from '../cmd3/helpers';

/** A synthetic card with colors (the shared `card` helper makes colorless ones). */
function colored(name: string, type: string, text: string, colors: string[], pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const keywordsOf = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.abilities.filter((a) => a.def.kind === 'keyword').map((a) => (a.def.kind === 'keyword' ? `${a.def.keyword}${a.def.quality !== undefined ? `:${a.def.quality}` : ''}` : ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('CR 702.9, 613.1f: "All creatures lose flying." / "All creatures lose flying and islandwalk."', () => {
  const SPHERE = card('Test Calm Sphere', 'World Enchantment', 'All creatures lose flying.');
  const DECREE = card('Test Still Decree', 'World Enchantment', 'All creatures lose flying and islandwalk.');
  const IMP = card('Test Sky Imp', 'Creature — Imp', 'Flying, trample, islandwalk', ['1', '1']);
  const WALKER = card('Test Marsh Walker', 'Creature — Imp', 'Swampwalk', ['1', '1']);
  const GIVE = card('Test Wind Gift', 'Instant', 'Target creature gains flying until end of turn.');
  const base = (world: CardDef): GameState => scenario([], { defs: [world, IMP, WALKER, GIVE], p1: { battlefield: [world.name, IMP.name] }, p2: { battlefield: [WALKER.name] } });
  it('are full', () => { for (const d of [SPHERE, DECREE]) expect(full(d)).toBe(true); });
  it('Sphere: every creature of every player loses flying and keeps its other keywords', () => {
    const s = base(SPHERE);
    const imp = named(s, 'Test Sky Imp')[0]!;
    expect(keywordsOf(s, imp)).not.toContain('flying');
    expect(keywordsOf(s, imp)).toContain('trample');
    expect(keywordsOf(s, imp)).toContain('landwalk:island'); // negative: only flying goes
  });
  it('Sphere: a creature that gains flying afterwards (a later timestamp) has it (the 2004 ruling)', () => {
    const s0 = tweak(base(SPHERE), (t) => { put(t, 'p1', 'hand', 'Test Wind Gift'); });
    const imp = named(s0, 'Test Sky Imp')[0]!;
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wind Gift', 'hand', 'p1') }), { targets: [{ kind: 'object', id: imp }] }));
    expect(keywordsOf(s1, imp)).toContain('flying');
  });
  it('Sphere: without it the creature has flying (negative)', () => {
    const s = tweak(base(SPHERE), (t) => { t.zones.battlefield = t.zones.battlefield.filter((id) => t.objects[id]!.defId !== 'Test Calm Sphere'); });
    expect(keywordsOf(s, named(s, 'Test Sky Imp')[0]!)).toContain('flying');
  });
  it('Decree: flying and the island landwalk go; trample stays and another landwalk stays', () => {
    const s = base(DECREE);
    const imp = named(s, 'Test Sky Imp')[0]!;
    expect(keywordsOf(s, imp)).not.toContain('flying');
    expect(keywordsOf(s, imp)).not.toContain('landwalk:island');
    expect(keywordsOf(s, imp)).toContain('trample');
    expect(keywordsOf(s, named(s, 'Test Marsh Walker')[0]!)).toContain('landwalk:swamp'); // negative: swampwalk is not islandwalk
  });
});

/** The state when the upkeep triggers of the last `throughUpkeep` were on the stack. */
let upkeepBefore: GameState;
/** Pass until `player`'s next upkeep (after the current turn) has priority (the triggers of it are on the stack), then resolve everything. Attackers are never declared. */
function throughUpkeep(s0: GameState, player: string, p: Parameters<typeof resolveAll>[1] = { targets: [{ kind: 'player', id: player === 'p1' ? 'p2' : 'p1' }] }): GameState {
  let s = s0;
  const from = s.turn.number;
  for (let i = 0; i < 400; i++) {
    if (s.turn.number > from && s.turn.activePlayer === player && s.turn.step === 'upkeep' && s.pending?.kind === 'priority') { upkeepBefore = s; return resolveAll(s, p); }
    const d = s.pending!;
    if (d.kind === 'declareAttackers') s = declareAttackers(s, []);
    else if (d.kind === 'declareBlockers') s = declareBlockers(s, []);
    else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else s = settle(s, p);
  }
  throw new Error(`no upkeep of ${player}`);
}

describe('CR 603.4, 608.2c, 111.2: "At the beginning of each player\'s upkeep, if that player controls more lands than each other player, the player creates a 1/1 green Saproling creature token."', () => {
  const PASTURES = card('Test Lush Meadow', 'Enchantment', "At the beginning of each player's upkeep, if that player controls more lands than each other player, the player creates a 1/1 green Saproling creature token.");
  const game = (lands: Record<string, number>): GameState =>
    mpScenario({ players: 4, seed: 'c34-pastures', defs: [PASTURES], zones: { p1: { battlefield: ['Test Lush Meadow', ...Array(lands['p1'] ?? 0).fill('Plains')] }, p2: { battlefield: Array(lands['p2'] ?? 0).fill('Plains') }, p3: { battlefield: Array(lands['p3'] ?? 0).fill('Plains') }, p4: { battlefield: Array(lands['p4'] ?? 0).fill('Plains') } } });
  const mine = (s: GameState, p: string): number => tokens(s, p).filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Saproling' || s.objects[id]!.defId.includes('Saproling')).length;
  it('is full', () => { expect(full(PASTURES)).toBe(true); });
  it('the player with strictly more lands creates the token, under their own control, on their own upkeep (the card is not theirs)', () => {
    const s = throughUpkeep(game({ p1: 1, p2: 3, p3: 2, p4: 2 }), 'p2');
    expect(tokens(s, 'p2').length).toBe(1);
    expect(tokens(s, 'p1').length).toBe(0); // negative: not the controller of the enchantment
  });
  it('negative: a tie for the most lands makes no token, nor does having fewer', () => {
    expect(tokens(throughUpkeep(game({ p1: 1, p2: 3, p3: 3, p4: 2 }), 'p2'), 'p2').length).toBe(0);
    expect(tokens(throughUpkeep(game({ p1: 1, p2: 2, p3: 3, p4: 2 }), 'p2'), 'p2').length).toBe(0);
  });
  it('checked again on resolution (the 2004 ruling): losing the lead before it resolves makes no token', () => {
    let s = game({ p1: 1, p2: 3, p3: 2, p4: 2 });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep' && x.pending?.kind === 'priority', "p2's upkeep", 120);
    expect(s.zones.stack.length).toBe(1); // the trigger is on the stack
    s = tweak(s, (t) => { put(t, 'p3', 'battlefield', 'Plains'); put(t, 'p3', 'battlefield', 'Plains'); });
    s = resolveAll(s);
    expect(tokens(s, 'p2').length).toBe(0);
  });
});

describe('CR 201.5, 608.2b, 122.1: "When ~ dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two +1/+1 counters on it instead."', () => {
  const CATHAR = card('Test Elder Warden', 'Creature — Human Soldier', 'When this creature dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two +1/+1 counters on it instead.', ['1', '1']);
  const HUMAN = card('Test Plain Villager', 'Creature — Human Peasant', '', ['1', '1']);
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const DOOM = card('Test Doom Word', 'Instant', 'Destroy target creature.');
  const game = (others: string[]): GameState => scenario([], { defs: [CATHAR, HUMAN, OGRE, DOOM], p1: { battlefield: ['Test Elder Warden', ...others], hand: ['Test Doom Word'] } });
  const kill = (s: GameState, target: ObjectId, onto?: ObjectId): GameState =>
    resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom Word', 'hand', 'p1') }), { targets: [{ kind: 'object', id: target }] }), onto === undefined ? {} : { targets: [{ kind: 'object', id: onto }] });
  it('is full', () => { expect(full(CATHAR)).toBe(true); });
  it('a Human target gets two counters', () => {
    const s0 = game(['Test Plain Villager']);
    const human = named(s0, 'Test Plain Villager')[0]!;
    const s1 = kill(s0, named(s0, 'Test Elder Warden')[0]!, human);
    expect(counters(s1, human, '+1/+1')).toBe(2);
  });
  it('a non-Human target gets one counter (negative)', () => {
    const s0 = game(['Test Plain Ogre']);
    const ogre = named(s0, 'Test Plain Ogre')[0]!;
    const s1 = kill(s0, named(s0, 'Test Elder Warden')[0]!, ogre);
    expect(counters(s1, ogre, '+1/+1')).toBe(1);
  });
  it('negative: with no other creature to target nothing happens, and the dead creature is no target', () => {
    const s0 = game([]);
    const s1 = kill(s0, named(s0, 'Test Elder Warden')[0]!);
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.counters['+1/+1'] !== undefined && s1.objects[id]!.counters['+1/+1']! > 0).length).toBe(0);
  });
});

describe('CR 105.2, 608.2h: "Destroy target artifact or enchantment. If that permanent was blue or black, draw a card."', () => {
  const PRY = card('Test Pry Loose', 'Instant', 'Destroy target artifact or enchantment. If that permanent was blue or black, draw a card.');
  const BLUE = colored('Test Blue Trinket', 'Artifact', '', ['U']);
  const BLACK = colored('Test Black Rune', 'Enchantment', '', ['B']);
  const GREEN = colored('Test Green Charm', 'Enchantment', '', ['G']);
  const OPAL = card('Test Plain Cog', 'Artifact', '');
  const play = (target: string): { s0: GameState; s1: GameState } => {
    const s0 = scenario([], { defs: [PRY, BLUE, BLACK, GREEN, OPAL], p1: { hand: ['Test Pry Loose'], library: ['Plains', 'Plains'] }, p2: { battlefield: [target] } });
    const id = named(s0, target)[0]!;
    return { s0, s1: resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pry Loose', 'hand', 'p1') }), { targets: [{ kind: 'object', id }] })) };
  };
  it('is full', () => { expect(full(PRY)).toBe(true); });
  it('a blue or a black permanent: destroyed, and the caster draws a card', () => {
    for (const t of ['Test Blue Trinket', 'Test Black Rune']) {
      const { s0, s1 } = play(t);
      expect(named(s1, t).length).toBe(0);
      expect(handOf(s1, 'p1')).toBe(handOf(s0, 'p1') - 1 + 1); // the spell leaves the hand, one card is drawn
    }
  });
  it('negative: a green or a colorless permanent is destroyed and nothing is drawn', () => {
    for (const t of ['Test Green Charm', 'Test Plain Cog']) {
      const { s0, s1 } = play(t);
      expect(named(s1, t).length).toBe(0);
      expect(handOf(s1, 'p1')).toBe(handOf(s0, 'p1') - 1);
    }
  });
});

describe('CR 608.2c, 701.9a: "At the beginning of your upkeep, target opponent discards a card if you control the creature with the greatest power or tied for the greatest power."', () => {
  const TRIUMPH = card('Test Proud Edict', 'Enchantment', 'At the beginning of your upkeep, target opponent discards a card if you control the creature with the greatest power or tied for the greatest power.');
  const BIG = card('Test Big Ogre', 'Creature — Ogre', '', ['4', '4']);
  const SMALL = card('Test Small Ogre', 'Creature — Ogre', '', ['2', '2']);
  const game = (mine: string[], theirs: string[]): GameState =>
    scenario([], { defs: [TRIUMPH, BIG, SMALL], p1: { battlefield: ['Test Proud Edict', ...mine] }, p2: { battlefield: theirs, hand: ['Plains', 'Plains'] } });
  it('is full', () => { expect(full(TRIUMPH)).toBe(true); });
  it('the greatest power or tied: the opponent discards a card', () => {
    const lost = (s0: GameState): number => { const s = throughUpkeep(s0, 'p1'); return handOf(upkeepBefore, 'p2') - handOf(s, 'p2'); };
    expect(lost(game(['Test Big Ogre'], ['Test Small Ogre']))).toBe(1);
    expect(lost(game(['Test Big Ogre'], ['Test Big Ogre']))).toBe(1); // tied
  });
  it('negative: an opponent\'s bigger creature, or no creature at all, and no discard', () => {
    const lost = (s0: GameState): number => { const s = throughUpkeep(s0, 'p1'); return handOf(upkeepBefore, 'p2') - handOf(s, 'p2'); };
    expect(lost(game(['Test Small Ogre'], ['Test Big Ogre']))).toBe(0);
    expect(lost(game([], []))).toBe(0);
  });
});

const tappedLands = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped).length;
/** Activate the first activated ability of an object that has one (by the legal actions), paying automatically. */
function activate(s: GameState, player: string, source: ObjectId, p: Parameters<typeof settle>[1] = {}): GameState {
  const a = legalActions(s, player).find((x) => x.action.type === 'activate' && (x.action as { source: ObjectId }).source === source);
  if (a === undefined) throw new Error('no activation is legal');
  return settle(act(s, a.action), p);
}

describe('CR 601.2f, 602.2b, 118.7: "White spells cost {3} more to cast. Activated abilities of white enchantments cost {3} more to activate."', () => {
  const GLOOM = card('Test Pale Gloom', 'Enchantment', 'White spells cost {3} more to cast.\nActivated abilities of white enchantments cost {3} more to activate.');
  const WHITE_SPELL = colored('Test White Ray', 'Instant', 'You gain 1 life.', ['W'], undefined, '{1}');
  const GREEN_SPELL = colored('Test Green Ray', 'Instant', 'You gain 1 life.', ['G'], undefined, '{1}');
  const WHITE_ENCH = colored('Test White Font', 'Enchantment', '{1}: You gain 1 life.', ['W']);
  const BLUE_ENCH = colored('Test Blue Font', 'Enchantment', '{1}: You gain 1 life.', ['U']);
  const game = (hand: string[], battlefield: string[]): GameState => scenario([], { defs: [GLOOM, WHITE_SPELL, GREEN_SPELL, WHITE_ENCH, BLUE_ENCH], p1: { hand, battlefield: ['Test Pale Gloom', ...battlefield, 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  it('is full', () => { expect(full(GLOOM)).toBe(true); });
  it('a white spell costs {3} more (4 of the 5 lands), a green one does not', () => {
    const w = resolveAll(settle(act(game(['Test White Ray'], []), { type: 'cast', player: 'p1', card: find(game(['Test White Ray'], []), 'Test White Ray', 'hand', 'p1') })));
    expect(tappedLands(w, 'p1')).toBe(4);
    const g0 = game(['Test Green Ray'], []);
    expect(tappedLands(resolveAll(settle(act(g0, { type: 'cast', player: 'p1', card: find(g0, 'Test Green Ray', 'hand', 'p1') }))), 'p1')).toBe(1);
  });
  it('the opponent pays it too: a white spell of another player costs {3} more', () => {
    const s0 = scenario([], { defs: [GLOOM, WHITE_SPELL], p1: { battlefield: ['Test Pale Gloom'] }, p2: { hand: ['Test White Ray'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    const s1 = act(s0, { type: 'pass', player: 'p1' });
    const w = resolveAll(settle(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test White Ray', 'hand', 'p2') })), {});
    expect(tappedLands(w, 'p2')).toBe(4);
  });
  it('an activated ability of a white enchantment costs {3} more, one of a blue enchantment does not', () => {
    const s0 = game([], ['Test White Font', 'Test Blue Font']);
    const white = activate(s0, 'p1', named(s0, 'Test White Font')[0]!);
    expect(tappedLands(resolveAll(white), 'p1')).toBe(4);
    const blue = activate(s0, 'p1', named(s0, 'Test Blue Font')[0]!);
    expect(tappedLands(resolveAll(blue), 'p1')).toBe(1);
  });
  it('negative: without Gloom both cost their printed cost', () => {
    const s0 = tweak(game(['Test White Ray'], ['Test White Font']), (t) => { t.zones.battlefield = t.zones.battlefield.filter((id) => t.objects[id]!.defId !== 'Test Pale Gloom'); });
    expect(tappedLands(resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test White Ray', 'hand', 'p1') }))), 'p1')).toBe(1);
    expect(tappedLands(resolveAll(activate(s0, 'p1', named(s0, 'Test White Font')[0]!)), 'p1')).toBe(1);
  });
});

describe('CR 509.1g-h, 601.2c, 601.2h: "{B}, Sacrifice ~: Destroy target creature ~ is blocking."', () => {
  const WALL = card('Test Bone Wall', 'Creature — Wall', 'Defender\n{B}, Sacrifice this creature: Destroy target creature this creature is blocking.', ['0', '4']);
  const RAIDER = card('Test Plain Raider', 'Creature — Ogre', '', ['2', '2']);
  const OTHER = card('Test Other Raider', 'Creature — Ogre', '', ['2', '2']);
  const game = (): GameState => scenario(['Swamp'], { defs: [WALL, RAIDER, OTHER], p1: { battlefield: ['Test Plain Raider', 'Test Other Raider'] }, p2: { battlefield: ['Test Bone Wall', 'Swamp'] } });
  const blocked = (): { s: GameState; raider: ObjectId; other: ObjectId; wall: ObjectId } => {
    const s0 = game();
    const raider = named(s0, 'Test Plain Raider')[0]!;
    const other = named(s0, 'Test Other Raider')[0]!;
    const wall = named(s0, 'Test Bone Wall')[0]!;
    let s = declareAttackers(toDeclareAttackers(s0), [[raider], [other]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[wall, raider]]);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'p2 has priority after blockers');
    return { s, raider, other, wall };
  };
  it('is full', () => { expect(full(WALL)).toBe(true); });
  it('destroys the creature it blocks, with the sacrifice paid first (the target stays legal)', () => {
    const { s, raider, other, wall } = blocked();
    const s1 = resolveAll(activate(s, 'p2', wall, { targets: [{ kind: 'object', id: raider }] }));
    expect(inYard(s1, 'Test Bone Wall', 'p2')).toBe(true);
    expect(inYard(s1, 'Test Plain Raider', 'p1')).toBe(true);
    expect(named(s1, 'Test Other Raider').length).toBe(1); // negative: the creature it did not block
    void wall; void raider; void other;
  });
  it('negative: the creature it does not block is no legal target', () => {
    const { s, other, wall } = blocked();
    expect(() => activate(s, 'p2', wall, { targets: [{ kind: 'object', id: other }] })).toThrow();
  });
});

describe('CR 115.1, 119.3, 608.2b: "{B}{R}: Target player who lost life this turn loses 1 life."', () => {
  const GUILD = card('Test Gutter Mage', 'Creature — Human Shaman', '{B}{R}: Target player who lost life this turn loses 1 life.', ['2', '2']);
  const ZAP = card('Test Small Zap', 'Instant', 'This spell deals 1 damage to target player.');
  const game = (): GameState => scenario(['Swamp', 'Mountain'], { defs: [GUILD, ZAP], p1: { battlefield: ['Test Gutter Mage', 'Swamp', 'Mountain'], hand: ['Test Small Zap'] } });
  it('is full', () => { expect(full(GUILD)).toBe(true); });
  it('a player who has not lost life this turn is no legal target', () => {
    const s = game();
    expect(() => activate(s, 'p1', named(s, 'Test Gutter Mage')[0]!, { targets: [{ kind: 'player', id: 'p2' }] })).toThrow();
  });
  it('after the player lost life this turn it is legal and they lose 1 more', () => {
    const s0 = game();
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Small Zap', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s1, 'p2')).toBe(19);
    const s2 = resolveAll(activate(s1, 'p1', named(s1, 'Test Gutter Mage')[0]!, { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s2, 'p2')).toBe(18);
  });
  it('negative: the controller who lost no life is not a legal target either', () => {
    const s0 = game();
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Small Zap', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(() => activate(s1, 'p1', named(s1, 'Test Gutter Mage')[0]!, { targets: [{ kind: 'player', id: 'p1' }] })).toThrow();
  });
});

describe('CR 611.2c, 702.36: "Whenever ~ attacks, each other attacking creature gains fear until end of turn."', () => {
  const RIDER = card('Test Fog Rider', 'Creature — Human Wizard', 'Whenever this creature attacks, each other attacking creature gains fear until end of turn.', ['2', '2']);
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const game = (): GameState => scenario([], { defs: [RIDER, OGRE], p1: { battlefield: ['Test Fog Rider', 'Test Plain Ogre', 'Test Plain Ogre'] } });
  it('is full', () => { expect(full(RIDER)).toBe(true); });
  it('the other attacking creatures gain fear; the rider and a creature that does not attack do not', () => {
    const s0 = game();
    const rider = named(s0, 'Test Fog Rider')[0]!;
    const [a, b] = named(s0, 'Test Plain Ogre') as [ObjectId, ObjectId];
    const s1 = resolveAll(declareAttackers(toDeclareAttackers(s0), [[rider], [a]]));
    expect(keywordsOf(s1, a)).toContain('fear');
    expect(keywordsOf(s1, rider)).not.toContain('fear');
    expect(keywordsOf(s1, b)).not.toContain('fear'); // negative: not attacking
  });
});

describe('CR 105.2, 608.2h: "Destroy target creature with flying. If that creature was blue or black, create a 1/2 green Spider creature token with reach." (Gloomwidow\'s Feast reading)', () => {
  const FEAST = card('Test Web Feast', 'Instant', 'Destroy target creature with flying. If that creature was blue or black, create a 1/2 green Spider creature token with reach.');
  const BLUE = colored('Test Blue Flier', 'Creature — Bird', 'Flying', ['U'], ['1', '1']);
  const GREEN = colored('Test Green Flier', 'Creature — Bird', 'Flying', ['G'], ['1', '1']);
  const run = (target: string): GameState => {
    const s0 = scenario([], { defs: [FEAST, BLUE, GREEN], p1: { hand: ['Test Web Feast'] }, p2: { battlefield: [target] } });
    return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Web Feast', 'hand', 'p1') }), { targets: [{ kind: 'object', id: named(s0, target)[0]! }] }));
  };
  it('a blue flier is destroyed and the Spider is made; a green one is destroyed with no Spider (negative)', () => {
    expect(full(FEAST)).toBe(true);
    expect(tokens(run('Test Blue Flier')).length).toBe(1);
    expect(tokens(run('Test Green Flier')).length).toBe(0);
  });
});
