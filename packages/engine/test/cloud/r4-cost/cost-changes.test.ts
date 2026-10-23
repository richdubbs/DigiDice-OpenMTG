/**
 * r4-cost: cost changes under a condition or by a count (zz-cloud/r4-cost.json; statics/costmods.ts, actions/activate.ts#costChangeOf), played through the
 * engine with synthetic cards (design 6.10).
 *
 *   CR 601.2f, 500.1, 604.5   "~ costs {1} less to cast during your turn": less on your turn, the full cost on an opponent's turn
 *   CR 601.2f, 611.3a         "~ costs {2} less to cast as long as there are four or more card types among cards in your graveyard"
 *   CR 601.2f, 506.3          "~ costs {2} less to cast if a creature is attacking you": only while a creature attacks that player
 *   CR 601.2f, 400.3          "~ costs {2} less to cast if a creature card was put into your graveyard from anywhere this turn"
 *   CR 601.2f, 118.7          "~ costs {1} less to cast for each Cave you control and each Cave card in your graveyard": both sets counted
 *   CR 601.2f, 118.7a         "During your turn, spells you cast cost {1} less to cast for each creature you control with power 4 or greater"
 *   CR 601.2f, 602.2b         "This ability costs {1} less to activate during your turn" (`costChangeIf`): less on your turn only
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, PlayerId } from '../../../src/index';
import { answer, pass } from '../../m3/scenario';
import { act, activations, advanceTo, card, cast, drive, find, full, legal, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const QUICK = card('Test Quick Study', 'Instant', 'This spell costs {1} less to cast during your turn.\nDraw a card.', '{3}');
const ROOTS = card('Test Root Call', 'Sorcery', 'This spell costs {2} less to cast as long as there are four or more card types among cards in your graveyard.\nYou gain 3 life.', '{4}');
const SWAT = card('Test Swift Parry', 'Instant', 'This spell costs {2} less to cast if a creature is attacking you.\nYou gain 3 life.', '{4}');
const MACABRE = card('Test Grim Rite', 'Sorcery', 'This spell costs {2} less to cast if a creature card was put into your graveyard from anywhere this turn.\nYou gain 3 life.', '{4}');
const LEECH = card('Test Cave Leech', 'Creature — Leech', 'This spell costs {1} less to cast for each Cave you control and each Cave card in your graveyard.', '{4}', ['4', '4']);
const CRIER = card('Test War Crier', 'Creature — Human Warrior', 'During your turn, spells you cast cost {1} less to cast for each creature you control with power 4 or greater.', '{9}', PT);
const CROWN = card('Test Frost Crown', 'Artifact', '{3}, {T}: Draw a card. This ability costs {1} less to activate during your turn.', '{1}');
const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', '{0}');
const FROG = card('Test Pond Frog', 'Creature — Frog', '', '{0}', ['1', '1']);
const BRUTE = card('Test Big Brute', 'Creature — Giant', '', '{9}', ['4', '4']);
const RAIDER = card('Test Raider', 'Creature — Human', '', '{9}', PT);
const CAVE = card('Test Hollow', 'Land — Cave', '', '');
const GOLEM = card('Test Iron Golem', 'Artifact Creature — Golem', '', '{9}', PT);
const GLYPH = card('Test Ward Glyph', 'Enchantment', '', '{9}');
const BOOK = card('Test Blank Book', 'Sorcery', '', '{9}');
const DEFS = [QUICK, ROOTS, SWAT, MACABRE, LEECH, CRIER, CROWN, SPARK, FROG, BRUTE, RAIDER, CAVE, GOLEM, GLYPH, BOOK];

const castable = (s: GameState, name: string, player: PlayerId = 'p1'): boolean => {
  const id: ObjectId = find(s, name, 'hand', player);
  return legal(s, player, 'cast').some((a) => a.object === id);
};
/** Turn 2 (p2's), p1 holding priority in p2's first main phase. */
const onTheirTurn = (s: GameState): GameState => pass(advanceTo(s, 2, 'main1'));

describe('r4-cost: cost changes under a condition or by a count', () => {
  it('the cards are automated', () => {
    for (const d of [QUICK, ROOTS, SWAT, MACABRE, LEECH, CRIER, CROWN]) expect(full(d), d.name).toBe(true);
  });

  it('CR 601.2f, 500.1: "costs {1} less to cast during your turn": {3} is two mana on your turn, not on the opponent\'s', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains'], hand: ['Test Quick Study'], library: ['Plains', 'Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains', 'Plains'] } });
    expect(castable(s, 'Test Quick Study')).toBe(true);
    const theirs = onTheirTurn(s);
    expect(theirs.pending?.player).toBe('p1');
    expect(castable(theirs, 'Test Quick Study')).toBe(false);
  });

  it('CR 611.3a: "as long as there are four or more card types among cards in your graveyard": {4} for two lands only with four types', () => {
    const three = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains'], hand: ['Test Root Call'], graveyard: ['Test Iron Golem', 'Test Ward Glyph'] } });
    expect(castable(three, 'Test Root Call')).toBe(false);
    const four = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains'], hand: ['Test Root Call'], graveyard: ['Test Iron Golem', 'Test Ward Glyph', 'Test Blank Book'] } });
    expect(castable(four, 'Test Root Call')).toBe(true);
  });

  it('CR 506.3: "if a creature is attacking you": {4} for two lands only while an opponent\'s creature attacks you', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains'], hand: ['Test Swift Parry'], library: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Raider'], library: ['Plains', 'Plains'] } });
    expect(castable(s, 'Test Swift Parry')).toBe(false);
    s = advanceTo(s, 2, 'main1');
    for (let i = 0; i < 20 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Raider', 'battlefield', 'p2'), defender: 'p1' }] });
    for (let i = 0; i < 10 && s.pending?.player !== 'p1'; i++) s = pass(s);
    expect(s.turn.step).toBe('declareAttackers');
    expect(castable(s, 'Test Swift Parry')).toBe(true);
  });

  it('CR 400.3: "if a creature card was put into your graveyard from anywhere this turn": after your creature dies, {4} costs two', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grim Rite', 'Test Spark'], battlefield: ['Plains', 'Plains', 'Test Pond Frog'] } });
    expect(castable(s, 'Test Grim Rite')).toBe(false);
    s = resolveAll(cast(s, 'Test Spark', { targets: [[{ kind: 'object', id: find(s, 'Test Pond Frog', 'battlefield', 'p1') }]] }));
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Pond Frog')).toBe(true);
    expect(castable(s, 'Test Grim Rite')).toBe(true);
  });

  it('CR 601.2f: "for each Cave you control and each Cave card in your graveyard": one of each makes {4} cost two', () => {
    const one = scenario([], { defs: DEFS, p1: { hand: ['Test Cave Leech'], battlefield: ['Plains', 'Plains', 'Test Hollow'] } });
    expect(castable(one, 'Test Cave Leech')).toBe(false);
    const both = scenario([], { defs: DEFS, p1: { hand: ['Test Cave Leech'], battlefield: ['Plains', 'Plains', 'Test Hollow'], graveyard: ['Test Hollow'] } });
    expect(castable(both, 'Test Cave Leech')).toBe(true);
    const theirs = scenario([], { defs: DEFS, p1: { hand: ['Test Cave Leech'], battlefield: ['Plains', 'Plains', 'Test Hollow'] }, p2: { graveyard: ['Test Hollow'] } });
    expect(castable(theirs, 'Test Cave Leech')).toBe(false); // "your graveyard"
  });

  it('CR 601.2f, 118.7a: "During your turn, spells you cast cost {1} less ... for each creature you control with power 4 or greater"', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Root Call'], battlefield: ['Plains', 'Plains', 'Test War Crier', 'Test Big Brute', 'Test Big Brute'], library: ['Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains'] } });
    expect(castable(s, 'Test Root Call')).toBe(true); // {4} less 2
    const small = scenario([], { defs: DEFS, p1: { hand: ['Test Root Call'], battlefield: ['Plains', 'Plains', 'Test War Crier', 'Test Big Brute', 'Test Raider'] } });
    expect(castable(small, 'Test Root Call')).toBe(false); // a 2/2 does not count: {4} less 1
  });

  it('CR 602.2b: "This ability costs {1} less to activate during your turn": {3} is two mana on your turn only', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Test Frost Crown'], library: ['Plains', 'Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains', 'Plains'] } });
    expect(activations(s, 'Test Frost Crown')).toHaveLength(1);
    const drawn = resolveAll(drive(act(s, activations(s, 'Test Frost Crown')[0]!.action)));
    expect(drawn.zones.hand.p1!.length).toBe(s.zones.hand.p1!.length + 1);
    const theirs = onTheirTurn(s);
    expect(activations(theirs, 'Test Frost Crown')).toHaveLength(0);
  });
});
