/**
 * Standard round P (std-rp, Commander precon cards, tuning half): the readings this round added, played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory,
 * unverified: rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.2a, 603.4     "When this creature enters, if you cast it from your hand, ...": a creature put onto the battlefield from a graveyard was not cast
 *   CR 700.8             "if you have a full party": a Cleric, a Rogue, a Warrior and a Wizard; three of them are not a full party
 *   CR 615.1             "Prevent all damage that would be dealt to artifact creatures you control.": a creature you control that is not an artifact is dealt damage
 *   CR 400.3, 700.4      "Whenever a creature is put into your graveyard from the battlefield": an opponent's creature goes to its owner's graveyard, not yours
 *   CR 119.3, 120.3a     "if an opponent lost 3 or more life this turn": 2 damage is not enough, 3 is
 *   CR 400.3, 601.2a     "Whenever you cast a spell from your graveyard": a flashback spell; the same spell cast from your hand is not
 *   CR 205.1b, 613.1d    "~ becomes a 2/2 blue Bird creature with flying until end of turn. It's still a land.": a land creature with flying, until end of turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { find, findAll, scenario } from '../../m5/helpers';
import { activate, cast, pt, resolveAll, target } from '../../m5/cr-examples/helpers';
import { advanceTo, castAuto, life } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt0?: [string, string], cost = '{0}', keywords: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords, ...(pt0 ? { power: pt0[0], toughness: pt0[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const hand = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

const HERALD = card('Test Hearth Herald', 'Creature — Spirit', 'When this creature enters, if you cast it from your hand, draw two cards.', ['1', '1']);
const RAISE = card('Test Raise Again', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
const PARTY_SAGE = card('Test Party Sage', 'Creature — Human', 'When this creature enters, if you have a full party, draw a card.', ['1', '1']);
const CLERIC = card('Test Cleric', 'Creature — Human Cleric', '', ['1', '1']);
const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', ['1', '1']);
const WARRIOR = card('Test Warrior', 'Creature — Human Warrior', '', ['1', '1']);
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
const WARDEN = card('Test Plate Warden', 'Enchantment', 'Prevent all damage that would be dealt to artifact creatures you control.');
const GOLEM = card('Test Tin Golem', 'Artifact Creature — Golem', '', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SINGE = card('Test Singe', 'Instant', 'Test Singe deals 1 damage to each creature.');
const KEEPER = card('Test Grave Keeper', 'Enchantment', 'Whenever a creature is put into your graveyard from the battlefield, you gain 1 life.');
const CULL = card('Test Cull', 'Sorcery', 'Destroy target creature.');
const TALLY = card('Test Pain Tally', 'Enchantment', 'At the beginning of your end step, if an opponent lost 3 or more life this turn, draw a card.');
const JAB = card('Test Jab', 'Instant', 'Test Jab deals 2 damage to target player.');
const ECHO = card('Test Grave Echo', 'Enchantment', 'Whenever you cast a spell from your graveyard, you gain 2 life.');
const RECALL = card('Test Recall', 'Sorcery', 'Draw a card.\nFlashback {0}', undefined, '{0}', ['Flashback']);
const ROOST = card('Test Roost', 'Land', '{0}: This land becomes a 2/2 blue Bird creature with flying until end of turn. It\'s still a land.');
const DEFS = [HERALD, RAISE, PARTY_SAGE, CLERIC, ROGUE, WARRIOR, WIZARD, WARDEN, GOLEM, BEAR, SINGE, KEEPER, CULL, TALLY, JAB, ECHO, RECALL, ROOST];
const LIBRARY = ['Plains', 'Plains', 'Plains', 'Plains'];

describe('std-rp cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [HERALD, PARTY_SAGE, WARDEN, KEEPER, TALLY, ECHO, ROOST]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 601.2a, 603.4: "if you cast it from your hand"', () => {
  it('cast from the hand, the enters trigger draws two cards', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Hearth Herald'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Hearth Herald'));
    expect(findAll(s, 'Test Hearth Herald', 'battlefield')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(2);
  });
  it('put onto the battlefield from the graveyard (not cast), it draws nothing', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Raise Again'], graveyard: ['Test Hearth Herald'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Raise Again', [target(find(s, 'Test Hearth Herald', 'graveyard', 'p1'))]));
    expect(findAll(s, 'Test Hearth Herald', 'battlefield')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(0);
  });
});

describe('CR 700.8: "if you have a full party"', () => {
  it('with a Cleric, a Rogue, a Warrior and a Wizard, the trigger draws a card', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Party Sage'], battlefield: ['Test Cleric', 'Test Rogue', 'Test Warrior', 'Test Wizard'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Party Sage'));
    expect(hand(s, 'p1')).toBe(1);
  });
  it('with three of the four, it does not', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Party Sage'], battlefield: ['Test Cleric', 'Test Rogue', 'Test Warrior'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Party Sage'));
    expect(hand(s, 'p1')).toBe(0);
  });
});

describe('CR 615.1: "Prevent all damage that would be dealt to artifact creatures you control."', () => {
  it('the artifact creature is dealt no damage; a creature that is not an artifact, and an opponent\'s artifact creature, are', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Singe'], battlefield: ['Test Plate Warden', 'Test Tin Golem', 'Test Bear'] }, p2: { battlefield: ['Test Tin Golem'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Singe'));
    const mine = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Tin Golem' && s.objects[id]!.controller === 'p1')!;
    const theirs = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Tin Golem' && s.objects[id]!.controller === 'p2')!;
    expect(s.objects[mine]!.damage).toBe(0);
    expect(s.objects[theirs]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Bear', 'battlefield')]!.damage).toBe(1);
  });
});

describe('CR 400.3, 700.4: "Whenever a creature is put into your graveyard from the battlefield"', () => {
  it('your creature dying gains 1 life; an opponent\'s creature dying (to its owner\'s graveyard) does not', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Cull', 'Test Cull'], battlefield: ['Test Grave Keeper', 'Test Bear'] }, p2: { battlefield: ['Test Tin Golem'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Cull', [target(find(s, 'Test Tin Golem', 'battlefield'))]));
    expect(findAll(s, 'Test Tin Golem', 'graveyard', 'p2')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(20);
    s = resolveAll(cast(s, 'Test Cull', [target(find(s, 'Test Bear', 'battlefield'))]));
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 119.3, 120.3a: "if an opponent lost 3 or more life this turn"', () => {
  it('after 2 damage to the opponent, the end step trigger draws nothing', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Jab'], battlefield: ['Test Pain Tally'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Jab', [target('p2')]));
    expect(life(s, 'p2')).toBe(18);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(hand(s, 'p1')).toBe(0);
  });
  it('after 2 + 2 damage (4 life lost in the turn), it draws a card', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Jab', 'Test Jab'], battlefield: ['Test Pain Tally'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Jab', [target('p2')]));
    s = resolveAll(cast(s, 'Test Jab', [target('p2')]));
    expect(life(s, 'p2')).toBe(16);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(hand(s, 'p1')).toBe(1);
  });
});

describe('CR 400.3, 601.2a: "Whenever you cast a spell from your graveyard"', () => {
  it('a flashback spell cast from your graveyard gains 2 life; the same spell cast from your hand does not', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Recall'], battlefield: ['Test Grave Echo'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Recall'));
    expect(life(s, 'p1')).toBe(20);
    expect(findAll(s, 'Test Recall', 'graveyard', 'p1')).toHaveLength(1);
    s = resolveAll(castAuto(s, 'Test Recall', { method: 'flashback' }));
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 205.1b, 613.1d, 611.2a: "~ becomes a 2/2 blue Bird creature with flying until end of turn. It\'s still a land."', () => {
  it('the land is a 2/2 blue Bird land creature with flying until end of turn', () => {
    let s = scenario(LIBRARY, { p1: { battlefield: ['Test Roost'] }, defs: DEFS });
    const roost = find(s, 'Test Roost', 'battlefield');
    s = resolveAll(activate(s, roost));
    const c = getChars(s, roost);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toContain('Bird');
    expect(c.colors).toEqual(['U']);
    expect(JSON.stringify(c.keywords)).toContain('"flying"');
    expect(pt(s, roost)).toEqual([2, 2]);
  });
});
