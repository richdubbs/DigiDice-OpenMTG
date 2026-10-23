/**
 * p2-attack-block-2 (lane p2-attack-block): block bans, defender permissions with conditions, "can't block unless", the defending player's graveyard and the
 * goaded group, played through the engine with synthetic cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after
 * the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 509.1b            "This creature can't block Humans."
 *   CR 609.4, 702.3b     "Defender. This creature can attack as though it didn't have defender as long as you have no cards in hand."
 *   CR 509.1b, 101.2     "This creature can't block unless you control another Bear."
 *   CR 508.1c, 506.2     "This creature can't attack unless defending player has two or more cards in their graveyard."
 *   CR 701.15a, 608.2c   "Goad all creatures your opponents control. Until your next turn, those creatures can't block."
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { act, advanceTo, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, full, resolveAll } from '../cmd3/helpers';

const GHOUL = card('Test Shy Ghoul', 'Creature — Zombie', "This creature can't block Humans.", ['2', '2']);
const SHADE = card('Test Empty Shade', 'Creature — Shade', "Defender\nThis creature can attack as though it didn't have defender as long as you have no cards in hand.", ['2', '2']);
const PACK = card('Test Pack Runt', 'Creature — Bear', "This creature can't block unless you control another Bear.", ['2', '2']);
const GARGOYLE = card('Test Grave Gargoyle', 'Creature — Gargoyle', "This creature can't attack unless defending player has two or more cards in their graveyard.", ['2', '2']);
const DARE = card('Test Rampart Dare', 'Sorcery', "Goad all creatures your opponents control. Until your next turn, those creatures can't block.");
const DEFS: CardDef[] = [GHOUL, SHADE, PACK, GARGOYLE, DARE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const on = (s: GameState, name: string, player: string): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === player)!;
const canBlock = (s: GameState, blocker: ObjectId, attacker: ObjectId): boolean => hookpoints.canBlock(gameOf(s), blocker, attacker) === null;
const canAttack = (s: GameState, attacker: ObjectId): boolean => hookpoints.canAttack(gameOf(s), attacker, 'p2') === null;
const withHand = (s: GameState, player: string, n: number): GameState => ({ ...s, zones: { ...s.zones, hand: { ...s.zones.hand, [player]: (s.zones.library[player] ?? []).slice(0, n) } } }) as GameState;
const withGraveyard = (s: GameState, player: string, n: number): GameState => ({ ...s, zones: { ...s.zones, graveyard: { ...s.zones.graveyard, [player]: (s.zones.library[player] ?? []).slice(-n) } } }) as GameState;

describe('CR 509.1b: "This creature can\'t block Humans."', () => {
  it('it can\'t block a Human; it can block a Bear', () => {
    let s = toDeclareAttackers(advanceTo(scenario(['Elite Vanguard', 'Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Elite Vanguard', 'Grizzly Bears'] }, p2: { battlefield: ['Test Shy Ghoul'] } }), 3, 'main1'));
    s = declareAttackers(s, [[on(s, 'Elite Vanguard', 'p1')], [on(s, 'Grizzly Bears', 'p1')]]);
    expect(canBlock(s, on(s, 'Test Shy Ghoul', 'p2'), on(s, 'Elite Vanguard', 'p1'))).toBe(false);
    expect(canBlock(s, on(s, 'Test Shy Ghoul', 'p2'), on(s, 'Grizzly Bears', 'p1'))).toBe(true);
  });
});

describe('CR 609.4, 702.3b: "This creature can attack as though it didn\'t have defender as long as you have no cards in hand."', () => {
  it('with no cards in hand it can attack; with a card in hand defender stops it', () => {
    const s0 = advanceTo(scenario([], { defs: DEFS, p1: { battlefield: ['Test Empty Shade'] } }), 3, 'main1');
    const empty = withHand(s0, 'p1', 0);
    expect(canAttack(empty, on(empty, 'Test Empty Shade', 'p1'))).toBe(true);
    const one = withHand(s0, 'p1', 1);
    expect(canAttack(one, on(one, 'Test Empty Shade', 'p1'))).toBe(false);
  });
});

describe('CR 509.1b, 101.2: "This creature can\'t block unless you control another Bear."', () => {
  it('alone it can\'t block; with another Bear it can', () => {
    let s = toDeclareAttackers(advanceTo(scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Test Pack Runt'] } }), 3, 'main1'));
    s = declareAttackers(s, [[on(s, 'Grizzly Bears', 'p1')]]);
    expect(canBlock(s, on(s, 'Test Pack Runt', 'p2'), on(s, 'Grizzly Bears', 'p1'))).toBe(false);
    let t = toDeclareAttackers(advanceTo(scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Test Pack Runt', 'Grizzly Bears'] } }), 3, 'main1'));
    t = declareAttackers(t, [[on(t, 'Grizzly Bears', 'p1')]]);
    expect(canBlock(t, on(t, 'Test Pack Runt', 'p2'), on(t, 'Grizzly Bears', 'p1'))).toBe(true);
  });
});

describe('CR 508.1c, 506.2: "This creature can\'t attack unless defending player has two or more cards in their graveyard."', () => {
  it('the defending player with one card in their graveyard: it can\'t attack them; with two it can (its controller\'s graveyard does not count)', () => {
    const s0 = advanceTo(scenario([], { defs: DEFS, p1: { battlefield: ['Test Grave Gargoyle'] } }), 3, 'main1');
    const one = withGraveyard(withGraveyard(s0, 'p2', 1), 'p1', 5);
    expect(canAttack(one, on(one, 'Test Grave Gargoyle', 'p1'))).toBe(false);
    const two = withGraveyard(s0, 'p2', 2);
    expect(canAttack(two, on(two, 'Test Grave Gargoyle', 'p1'))).toBe(true);
  });
});

describe('CR 701.15a, 608.2c: "Goad all creatures your opponents control. Until your next turn, those creatures can\'t block."', () => {
  it('the opponent\'s creatures are goaded and can\'t block; the caster\'s own creature is neither', () => {
    let s = advanceTo(scenario(['Grizzly Bears'], { defs: DEFS, p1: { hand: ['Test Rampart Dare'], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } }), 3, 'main1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => s.objects[id]!.defId === 'Test Rampart Dare')! }));
    const theirs = on(s, 'Grizzly Bears', 'p2');
    const mine = on(s, 'Grizzly Bears', 'p1');
    expect(s.objects[theirs]!.goaded?.map((g) => g.by)).toEqual(['p1']);
    expect(s.objects[mine]!.goaded).toBeUndefined();
    expect(canBlock(s, theirs, mine)).toBe(false);
    expect(canBlock(s, mine, theirs)).toBe(true);
  });
});
