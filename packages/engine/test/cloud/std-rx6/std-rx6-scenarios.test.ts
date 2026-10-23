/**
 * std-rx6 (wave 2, slice s21): the round's templates played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 614.12a, 607.2d, 602.5, 605.3  "As ~ enters, choose a card name." + "Activated abilities of sources with the chosen name can't be activated unless
 *                                      they're mana abilities.": the chosen name's abilities are gone in every zone (a cycling card in hand too); its mana
 *                                      abilities stay; another name is untouched
 *   CR 614.12a, 402.3, 701.20e         "As ~ enters, look at an opponent's hand, then choose any card name.": its controller sees that hand, nobody else
 *   CR 508.1c, 506.2                   "Creatures with flying can't attack you.": a flyer can't attack the controller but can attack their planeswalker; a creature
 *                                      without flying can attack them
 *   CR 508.1c, 509.1b                  "Creatures with flying can't attack you or block creatures you control.": no attack on you, no block of your creatures
 */
import { describe, expect, it } from 'vitest';
import type { DeclareAttackersDecision, DeclareBlockersDecision, GameState, ObjectId } from '../../../src/index';
import { answer, find, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { card, cast, full, settle } from '../cmd3/helpers';

const NEEDLE = card('Test Needle', 'Artifact', "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.");
const GLASS = card('Test Glass', 'Artifact', "As this artifact enters, look at an opponent's hand, then choose any card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.");
const DRUID = card('Test Druid', 'Creature — Elf Druid', '{T}: Add {G}.\n{1}: This creature gets +1/+1 until end of turn.', ['1', '1']);
const PRISM = card('Test Prism', 'Artifact', '{0}: You gain 1 life.');
const SKETCH = card('Test Sketch', 'Sorcery', 'You gain 2 life.\nCycling {0}');
const SKYWARD = card('Test Skyward Field', 'Enchantment', "Creatures with flying can't attack you.");
const STORMWALL = card('Test Stormwall', 'Enchantment', "Creatures with flying can't attack you or block creatures you control.");
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.', undefined, '{3}');
const DEFS = [NEEDLE, GLASS, DRUID, PRISM, SKETCH, SKYWARD, STORMWALL, BIRD, BEAR, WALKER];

const attackers = (s: GameState): DeclareAttackersDecision => s.pending as DeclareAttackersDecision;
const activations = (s: GameState, id: ObjectId, player = 'p1') => legal(s, player, 'activate').filter((a) => a.object === id);

/** Cast `name` (a {0} artifact), let it resolve, and name `chosen` as it enters. */
function enterNaming(s0: GameState, name: string, chosen: string): GameState {
  let s = cast(s0, name);
  s = pass(s);
  s = pass(s);
  s = settle(s);
  expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardName' });
  return settle(answer(s, { kind: 'chooseName', name: chosen }));
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully (the attack-you-or-block template is stable since std-rx28)', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
    expect(JSON.stringify(STORMWALL.faces)).not.toContain('"kind":"manual"');
  });
});

describe('CR 614.12a, 607.2d, 602.5: "As ~ enters, choose a card name" and "activated abilities of sources with the chosen name can\'t be activated unless they\'re mana abilities"', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Needle', 'Test Sketch'], battlefield: ['Test Druid', 'Test Prism', 'Plains'] } });
  it('before it enters, every ability is offered', () => {
    const s = board();
    expect(activations(s, find(s, 'Test Druid', 'battlefield')).length).toBe(2);
    expect(activations(s, find(s, 'Test Prism', 'battlefield')).length).toBe(1);
  });
  it('naming the Druid: its mana ability stays (CR 605.3), its other ability is gone; the Prism, of another name, is untouched', () => {
    const s = enterNaming(board(), 'Test Needle', 'Test Druid');
    const druid = activations(s, find(s, 'Test Druid', 'battlefield'));
    expect(druid.length).toBe(1);
    expect(druid[0]!.isMana).toBe(true);
    expect(activations(s, find(s, 'Test Prism', 'battlefield')).length).toBe(1);
  });
  it('naming a card in hand: its cycling ability can\'t be activated there either (a source in any zone, CR 201.3)', () => {
    const s0 = board();
    const sketch = find(s0, 'Test Sketch', 'hand');
    expect(activations(s0, sketch).length).toBe(1);
    const s = enterNaming(s0, 'Test Needle', 'Test Sketch');
    expect(activations(s, find(s, 'Test Sketch', 'hand'))).toEqual([]);
    expect(activations(s, find(s, 'Test Prism', 'battlefield')).length).toBe(1);
  });
});

describe('CR 614.12a, 402.3, 701.20e: "As ~ enters, look at an opponent\'s hand, then choose any card name"', () => {
  it('the opponent\'s hand is seen by the artifact\'s controller only, before the name is chosen; the named ability is then gone', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Glass'], battlefield: ['Plains'] }, p2: { hand: ['Test Sketch', 'Test Bear'], battlefield: ['Test Prism'] } });
    const hand = s0.zones.hand['p2']!;
    expect(hand.every((id) => !(s0.objects[id]!.revealedTo ?? []).includes('p1'))).toBe(true);
    let s = cast(s0, 'Test Glass');
    s = settle(pass(pass(s)));
    expect(s.pending).toMatchObject({ kind: 'chooseName' });
    for (const id of s.zones.hand['p2']!) expect(s.objects[id]!.revealedTo ?? []).toEqual(['p1']);
    s = settle(answer(s, { kind: 'chooseName', name: 'Test Prism' }));
    const prism = find(s, 'Test Prism', 'battlefield', 'p2');
    expect(activations(s, prism, 'p2')).toEqual([]);
  });
});

describe('CR 508.1c, 506.2: "Creatures with flying can\'t attack you."', () => {
  it('the flyer can attack the controller\'s planeswalker but not the controller; the creature without flying can attack both', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bird', 'Test Bear'] }, p2: { battlefield: ['Test Skyward Field', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: DEFS });
    const s = toDeclareAttackers(s0);
    const walker = find(s, 'Test Walker', 'battlefield');
    const of = (n: string) => attackers(s).candidates.find((c) => c.id === find(s, n, 'battlefield'))!.defenders.sort();
    expect(of('Test Bird')).toEqual([walker]);
    expect(of('Test Bear')).toEqual(['p2', walker].sort());
  });
  it('without the enchantment the flyer can attack the player', () => {
    const s = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Bird'] }, defs: DEFS }));
    expect(attackers(s).candidates.find((c) => c.id === find(s, 'Test Bird', 'battlefield'))!.defenders).toContain('p2');
  });
});

describe('CR 508.1c, 509.1b: "Creatures with flying can\'t attack you or block creatures you control."', () => {
  it('the opponent\'s flyer can\'t attack the controller', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bird', 'Test Bear'] }, p2: { battlefield: ['Test Stormwall'] }, defs: DEFS });
    const ids = attackers(toDeclareAttackers(s0)).candidates.map((c) => c.id);
    expect(ids).not.toContain(find(s0, 'Test Bird', 'battlefield'));
    expect(ids).toContain(find(s0, 'Test Bear', 'battlefield'));
  });
  it('the opponent\'s flyer can\'t block the controller\'s attacker; their creature without flying can', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Stormwall', 'Test Bear'] }, p2: { battlefield: ['Test Bird', 'Test Bear'] }, defs: DEFS });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[mine]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers');
    const cands = (s.pending as DeclareBlockersDecision).candidates;
    expect(cands.some((c) => c.id === find(s, 'Test Bird', 'battlefield', 'p2'))).toBe(false);
    expect(cands.some((c) => c.id === find(s, 'Test Bear', 'battlefield', 'p2') && c.attackers.includes(mine))).toBe(true);
  });
});
