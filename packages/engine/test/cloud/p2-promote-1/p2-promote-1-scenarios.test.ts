/**
 * Phase 2 lane p2-promote, round p2-promote-1: the wordings of the templates this round promotes as narrow wordings (design 6.9 deviation, named in the round's
 * record), played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named
 * after the rule it checks, with its negative case. The two promoted wordings their own rounds already play are not repeated here (std-misc: a copy of a creature
 * spell that is an artifact in addition, test/cloud/std-misc; cmd5: "Spells you cast that target ~ cost {2} less", test/cloud/cmd5). CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 106.6, 601.2h, 611.2c   rid.stdmana1.spent.any.gains.eot: "If any of that mana is spent on a creature spell, it gains haste until end of turn"
 *   CR 608.2c, 118.12, 608.2h  eff.stdspm.if.compound.whereX.and: "you may sacrifice another creature. If you do, you gain X life and draw X cards, where X is
 *                              that creature's power"; "exile up to one target creature card ... If you do, you lose X life and create X Clue tokens, where X is
 *                              that card's mana value"
 *   CR 615.1a, 510.1, 615.5    sta.stdspm.combatDamageToSelf.prevent.then: "If combat damage would be dealt to ~, prevent that damage and exile that many cards
 *                              from the top of your library"; noncombat damage is not prevented
 *   CR 106.12, 605.1b, 605.4a  eff.mana.additional.two.player: "Whenever enchanted land is tapped for mana, its controller adds an additional two mana in any
 *                              combination of colors"; eff.mana.additional.any: "... while you're the monarch, add an additional one mana of any color"
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, life, pool, put, scenario } from '../../m5/helpers';
import { card, full, resolveAll, settle, tokens } from '../cmd3/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

const zoneSize = (s: GameState, zone: 'hand' | 'library' | 'exile' | 'graveyard', p = 'p1'): number => (zone === 'exile' ? s.zones.exile.filter((id) => s.objects[id]!.owner === p).length : s.zones[zone][p]!.length);
const answerColors = (s0: GameState, colors: string[]): GameState => {
  let s = s0;
  for (const c of colors) if (s.pending?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: c } as never);
  return s;
};
function tapForMana(s: GameState, source: ObjectId): GameState {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === source);
  if (!a) throw new Error(`no mana ability of ${source}`);
  return act(s, a.action);
}

describe('CR 106.6, 601.2h: "If any of that mana is spent on a creature spell, it gains haste until end of turn" (rid.stdmana1.spent.any.gains.eot)', () => {
  const BATTERY = card('Test Spark Battery', 'Artifact', '{T}, Sacrifice this artifact: Add {C}{C}. If any of that mana is spent on a creature spell, it gains haste until end of turn.');
  const PUP = card('Test Hasty Pup', 'Creature — Dog', '', ['1', '1'], '{1}');
  const IDOL = card('Test Plain Idol', 'Artifact', '', undefined, '{1}');
  const DEFS: CardDef[] = [BATTERY, PUP, IDOL];
  const castWithBattery = (name: string): GameState => {
    let s = scenario([], { p1: { hand: [name], battlefield: ['Test Spark Battery'] }, defs: DEFS });
    s = tapForMana(s, find(s, 'Test Spark Battery', 'battlefield', 'p1'));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
    return resolveAll(s);
  };
  it('the card is fully automated', () => expect(full(BATTERY)).toBe(true));
  it('CR 106.6: one of the two mana pays for a creature spell ("any of that mana"): it enters with haste', () => {
    const s = castWithBattery('Test Hasty Pup');
    expect(hasKeyword(getChars(s, find(s, 'Test Hasty Pup', 'battlefield', 'p1'))!, 'haste')).toBe(true);
  });
  it('CR 106.6: a noncreature spell paid with it gains nothing', () => {
    const s = castWithBattery('Test Plain Idol');
    expect(hasKeyword(getChars(s, find(s, 'Test Plain Idol', 'battlefield', 'p1'))!, 'haste')).toBe(false);
  });
});

describe('CR 608.2c, 608.2h: "If you do, you gain X life and draw X cards, where X is that creature\'s power" (eff.stdspm.if.compound.whereX.and)', () => {
  const DISCIPLE = card('Test Grove Disciple', 'Creature — Elf Druid', 'When this creature enters, you may sacrifice another creature. If you do, you gain X life and draw X cards, where X is that creature\'s power.', ['1', '1']);
  const OX = card('Test Old Ox', 'Creature — Ox', '', ['3', '2']);
  const DEFS: CardDef[] = [DISCIPLE, OX];
  const enter = (yes: boolean): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Grove Disciple'], battlefield: ['Test Old Ox'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grove Disciple', 'hand', 'p1') });
    return resolveAll(s, { yes, objects: [find(s, 'Test Old Ox', 'battlefield', 'p1')] });
  };
  it('the card is fully automated', () => expect(full(DISCIPLE)).toBe(true));
  it('CR 608.2h: sacrificing the 3-power Ox gains 3 life and draws 3 cards (its power as it last existed)', () => {
    const before = scenario(['Plains'], { p1: { hand: ['Test Grove Disciple'], battlefield: ['Test Old Ox'] }, defs: DEFS });
    const s = enter(true);
    expect(life(s, 'p1')).toBe(life(before, 'p1') + 3);
    expect(zoneSize(s, 'hand')).toBe(zoneSize(before, 'hand') - 1 + 3);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === OX.id)).toBe(false);
  });
  it('CR 608.2c: declining the sacrifice does neither', () => {
    const before = scenario(['Plains'], { p1: { hand: ['Test Grove Disciple'], battlefield: ['Test Old Ox'] }, defs: DEFS });
    const s = enter(false);
    expect(life(s, 'p1')).toBe(life(before, 'p1'));
    expect(zoneSize(s, 'hand')).toBe(zoneSize(before, 'hand') - 1);
  });
});

describe('CR 608.2c, 400.7: "exile up to one target creature card from your graveyard. If you do, you lose X life and create X Clue tokens, where X is that card\'s mana value"', () => {
  const SLEUTH = card('Test Grave Sleuth', 'Creature — Ferret', 'When this creature enters, exile up to one target creature card from your graveyard. If you do, you lose X life and create X Clue tokens, where X is that card\'s mana value.', ['2', '2']);
  const HULK = card('Test Bog Hulk', 'Creature — Beast', '', ['3', '3'], '{2}{G}');
  const DEFS: CardDef[] = [SLEUTH, HULK];
  const setup = (): GameState => scenario(['Forest'], { p1: { hand: ['Test Grave Sleuth'], graveyard: ['Test Bog Hulk'] }, defs: DEFS });
  it('the card is fully automated', () => expect(full(SLEUTH)).toBe(true));
  it('CR 400.7, 608.2h: exiling the mana value 3 card loses 3 life and makes 3 Clues (the card read in exile)', () => {
    let s = setup();
    const start = life(s, 'p1');
    const hulk = find(s, 'Test Bog Hulk', 'graveyard', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Sleuth', 'hand', 'p1') });
    s = resolveAll(s, { targets: [{ kind: 'object', id: hulk }] });
    expect(life(s, 'p1')).toBe(start - 3);
    expect(tokens(s).length).toBe(3);
    expect(zoneSize(s, 'graveyard')).toBe(0);
  });
  it('CR 608.2c: with no target chosen ("up to one"), nothing is exiled, no life is lost and no Clue is made', () => {
    let s = setup();
    const start = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Sleuth', 'hand', 'p1') });
    s = resolveAll(s, { targets: [] });
    expect(life(s, 'p1')).toBe(start);
    expect(tokens(s).length).toBe(0);
    expect(zoneSize(s, 'graveyard')).toBe(1);
  });
});

describe('CR 615.1a, 510.1: "If combat damage would be dealt to ~, prevent that damage and exile that many cards from the top of your library"', () => {
  const SURGEON = card('Test Hollow Surgeon', 'Creature — Human Rogue', 'If combat damage would be dealt to this creature, prevent that damage and exile that many cards from the top of your library.', ['2', '1']);
  const BRUTE = card('Test Big Brute', 'Creature — Giant', '', ['3', '3']);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  const DEFS: CardDef[] = [SURGEON, BRUTE, ZAP];
  it('the card is fully automated', () => expect(full(SURGEON)).toBe(true));
  it('CR 615.1a, 510.1: blocked by a 3/3, the 3 combat damage is prevented and 3 cards of its controller\'s library are exiled; it survives', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Hollow Surgeon'] }, p2: { battlefield: ['Test Big Brute'] }, defs: DEFS });
    const surgeon = find(s, 'Test Hollow Surgeon', 'battlefield', 'p1');
    const lib = zoneSize(s, 'library');
    s = declareAttackers(toDeclareAttackers(s), [[surgeon]]);
    s = declareBlockers(toDeclareBlockers(s), [[find(s, 'Test Big Brute', 'battlefield', 'p2'), surgeon]]);
    s = settle(passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the end of combat'));
    expect(s.zones.battlefield).toContain(surgeon);
    expect(s.objects[surgeon]!.damage ?? 0).toBe(0);
    expect(zoneSize(s, 'exile')).toBe(3);
    expect(zoneSize(s, 'library')).toBe(lib - 3);
  });
  it('CR 615.1a: noncombat damage is not prevented and exiles nothing', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Hollow Surgeon'], hand: ['Test Zap'] }, defs: DEFS });
    const surgeon = find(s, 'Test Hollow Surgeon', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') });
    s = resolveAll(s, { targets: [{ kind: 'object', id: surgeon }] });
    expect(s.zones.battlefield).not.toContain(surgeon);
    expect(zoneSize(s, 'exile')).toBe(0);
  });
});

describe('CR 106.12, 605.1b, 605.4a: additional mana when a land is tapped for mana (eff.mana.additional.two.player, eff.mana.additional.any)', () => {
  const FESTIVAL = card('Test Harvest Fair', 'Enchantment — Aura', 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional two mana in any combination of colors.');
  const REGENT = card('Test Crowned Ox', 'Creature — Ox', 'When this creature enters, you become the monarch.\nWhenever you tap a land for mana while you\'re the monarch, add an additional one mana of any color.', ['3', '3']);
  const DEFS: CardDef[] = [FESTIVAL, REGENT];
  it('the cards are fully automated', () => {
    expect(full(FESTIVAL)).toBe(true);
    expect(full(REGENT)).toBe(true);
  });
  it('CR 605.4a: the enchanted Forest makes {G} and two more of the chosen colors at once; another Forest makes {G} only', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest', 'Forest'] }, defs: DEFS });
    const [enchanted, other] = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Forest');
    s.objects[put(s, 'p1', 'battlefield', 'Test Harvest Fair')]!.attachedTo = enchanted!; // test setup: the Aura on the first Forest (CR 303.4)
    s = answerColors(tapForMana(s, enchanted!), ['R', 'U']);
    expect(s.zones.stack).toEqual([]);
    expect([...pool(s, 'p1')].sort().join('')).toBe('GRU');
    s = tapForMana(s, other!);
    expect(pool(s, 'p1').length).toBe(4);
  });
  it('CR 605.1b: while you are the monarch, each land you tap adds one more mana of the chosen color', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Crowned Ox'], battlefield: ['Forest'] }, defs: DEFS });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Crowned Ox', 'hand', 'p1') }));
    s = answerColors(tapForMana(s, find(s, 'Forest', 'battlefield', 'p1')), ['B']);
    expect([...pool(s, 'p1')].sort().join('')).toBe('BG');
  });
  it('CR 605.1b: not the monarch (the creature put onto the battlefield without entering-trigger), the land adds {G} only', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest', 'Test Crowned Ox'] }, defs: DEFS });
    s = tapForMana(s, find(s, 'Forest', 'battlefield', 'p1'));
    expect(pool(s, 'p1')).toBe('G');
  });
});

