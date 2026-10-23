/**
 * std-mana-12 (lane std-mana, account B): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.2f, 118.7           "<spells> you cast cost {W}{U}{B}{R}{G} less to cast": each colored symbol takes that color off the cost, or one generic mana when the
 *                              cost has none of it; generic-only reductions keep their own reading
 *   CR 605.3b, 106.1, 611.2a   "{1}: Add one mana of any color. This creature becomes that color until end of turn.": the mana ability adds the mana and the
 *                              creature becomes its color at once, until end of turn; "Activate only once each turn"
 *   CR 603.2, 701.65b, 701.66, "Whenever you waterbend, earthbend, firebend, or airbend": each action triggers it, a firebending trigger as it resolves, an
 *   701.67c, 702.189, 608.2c   earthbend as it is done; "if you've done all four this turn": only with all four done this turn
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, attackWith, card, cast, drive, find, full, legal, lifeOf, named, obj, pool, resolveAll, scenario } from '../r4-cost/support';

const handSize = (s: GameState, p = 'p1'): number => (s.zones.hand[p] ?? []).length;

// ---- colored cost reductions ----------------------------------------------------------------------------------------------------------------------------------

const ELDER = card('Test Grove Elder', 'Creature — Elf', 'Elf spells you cast cost {1}{G} less to cast.', '{0}', ['1', '1']);
const PRISM = card('Test Prism Sage', 'Creature — Avatar', 'Spells you cast cost {W}{U}{B}{R}{G} less to cast.', '{0}', ['1', '1']);
const RANGER = card('Test Elf Ranger', 'Creature — Elf', '', '{2}{G}', ['2', '2']);
const BRUTE = card('Test Ogre Brute', 'Creature — Ogre', '', '{3}{G}', ['4', '4']);
const TROLL = card('Test Hill Troll', 'Creature — Troll', '', '{5}', ['5', '5']);
const RED_DEFS = [ELDER, PRISM, RANGER, BRUTE, TROLL];

describe('std-mana-12: colored cost reductions (CR 601.2f, 118.7)', () => {
  it('the cards are automated', () => {
    for (const d of [ELDER, PRISM]) expect(full(d), JSON.stringify(d.automation)).toBe(true);
  });

  it('CR 118.7: "{1}{G} less" makes a {2}{G} Elf cost {1}: one Forest pays it', () => {
    const s0 = scenario(['Forest'], { defs: RED_DEFS, p1: { hand: ['Test Elf Ranger'], battlefield: ['Test Grove Elder', 'Forest'] } });
    const s = resolveAll(cast(s0, 'Test Elf Ranger'));
    expect(named(s, 'Test Elf Ranger')).toHaveLength(1);
  });

  it('CR 601.2f: a non-Elf spell is not reduced: a {3}{G} Ogre can\'t be cast with one Forest', () => {
    const s0 = scenario(['Forest'], { defs: RED_DEFS, p1: { hand: ['Test Ogre Brute'], battlefield: ['Test Grove Elder', 'Forest'] } });
    expect(legal(s0, 'p1', 'cast').some((a) => a.object === find(s0, 'Test Ogre Brute', 'hand'))).toBe(false);
  });

  it('CR 118.7c: "{W}{U}{B}{R}{G} less" takes {G} off a {3}{G} spell and the other four symbols reduce its generic part: it costs nothing', () => {
    const s0 = scenario(['Forest'], { defs: RED_DEFS, p1: { hand: ['Test Ogre Brute'], battlefield: ['Test Prism Sage'] } });
    const s = resolveAll(cast(s0, 'Test Ogre Brute'));
    expect(named(s, 'Test Ogre Brute')).toHaveLength(1);
  });

  it('CR 118.7c: a {5} spell is reduced by five generic mana (no colored symbol to take): it costs nothing; with more than five it would not', () => {
    const s0 = scenario(['Forest'], { defs: RED_DEFS, p1: { hand: ['Test Hill Troll'], battlefield: ['Test Prism Sage'] } });
    expect(named(resolveAll(cast(s0, 'Test Hill Troll')), 'Test Hill Troll')).toHaveLength(1);
  });
});

// ---- a mana ability that also changes the creature's color ------------------------------------------------------------------------------------------------------

const SCARE = card('Test Rag Scarecrow', 'Artifact Creature — Scarecrow', '{1}: Add one mana of any color. This creature becomes that color until end of turn. Activate only once each turn.', '{2}', ['1', '1']);

describe('std-mana-12: "{1}: Add one mana of any color. This creature becomes that color until end of turn." (CR 605.3b, 106.1, 611.2a)', () => {
  it('is automated', () => expect(full(SCARE), JSON.stringify(SCARE.automation)).toBe(true));

  it('CR 605.3b, 106.1: activated for red, it adds {R} at once and the creature is red until end of turn; the next turn it is colorless again', () => {
    let s = scenario([], { defs: [SCARE], p1: { battlefield: ['Test Rag Scarecrow', 'Plains'] } });
    const id = find(s, 'Test Rag Scarecrow', 'battlefield', 'p1');
    expect(getChars(s, id)!.colors).toEqual([]);
    const [mana] = legal(s, 'p1', 'activate').filter((a) => a.isMana === true && a.object === id);
    expect(mana).toBeDefined();
    s = drive(act(s, mana!.action), { colors: ['R'] });
    expect(pool(s, 'p1')).toContain('R');
    expect(getChars(s, id)!.colors).toEqual(['R']);
    s = advanceTo(s, 2, 'upkeep');
    expect(getChars(s, id)!.colors).toEqual([]);
  });

  it('CR 602.5b: "Activate only once each turn": after one activation it is not offered again this turn', () => {
    let s = scenario([], { defs: [SCARE], p1: { battlefield: ['Test Rag Scarecrow', 'Plains', 'Plains'] } });
    const id = find(s, 'Test Rag Scarecrow', 'battlefield', 'p1');
    const [mana] = legal(s, 'p1', 'activate').filter((a) => a.isMana === true && a.object === id);
    s = drive(act(s, mana!.action), { colors: ['G'] });
    expect(getChars(s, id)!.colors).toEqual(['G']);
    expect(legal(s, 'p1', 'activate').filter((a) => a.isMana === true && a.object === id)).toEqual([]);
  });
});

// ---- whenever you waterbend, earthbend, firebend, or airbend -------------------------------------------------------------------------------------------------

const AVATAR = card('Test Wind Avatar', 'Legendary Creature — Avatar', "Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you've done all four this turn, you gain 10 life.", '{0}', ['2', '2']);
const FIRE = card('Test Ember Adept', 'Creature — Human', 'Firebending 1', '{0}', ['1', '1']);
const EARTH = card('Test Stone Lesson', 'Sorcery', 'Earthbend 1.');
const AIR = card('Test Gust Lesson', 'Sorcery', 'Airbend target creature.');
const WATER = card('Test Tide Basin', 'Artifact', 'Waterbend {1}: You gain 1 life.');
const BEND_DEFS = [AVATAR, FIRE, EARTH, AIR, WATER];

const board = (hand: string[], battlefield: string[] = []): GameState =>
  scenario(['Forest'], { defs: BEND_DEFS, p1: { hand, battlefield: ['Test Wind Avatar', ...battlefield], library: Array(10).fill('Plains') }, p2: { battlefield: ['Test Ember Adept'] } });

const earthbend = (s: GameState): GameState => resolveAll(cast(s, 'Test Stone Lesson', { targets: [[obj(find(s, 'Forest', 'battlefield', 'p1'))]] }));
const airbend = (s: GameState): GameState => resolveAll(cast(s, 'Test Gust Lesson', { targets: [[obj(find(s, 'Test Ember Adept', 'battlefield', 'p2'))]] }));
const waterbend = (s: GameState): GameState => {
  const id = find(s, 'Test Tide Basin', 'battlefield', 'p1');
  const [a] = legal(s, 'p1', 'activate').filter((x) => x.object === id && x.isMana !== true);
  return resolveAll(drive(act(s, a!.action)));
};
const firebend = (s: GameState): GameState => resolveAll(attackWith(s, [find(s, 'Test Ember Adept', 'battlefield', 'p1')]));

describe('std-mana-12: "Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you\'ve done all four this turn, ..." (CR 603.2, 608.2c)', () => {
  it('the cards are automated', () => {
    for (const d of BEND_DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });

  it('CR 701.66, 603.2: earthbending triggers it once: a card is drawn, no life is gained (one action of four)', () => {
    const s0 = board(['Test Stone Lesson'], ['Forest']);
    const s = earthbend(s0);
    expect(handSize(s)).toBe(handSize(s0) - 1 + 1);
    expect(lifeOf(s)).toBe(20);
  });

  it('CR 701.65b: airbending triggers it', () => {
    const s0 = board(['Test Gust Lesson']);
    const s = airbend(s0);
    expect(handSize(s)).toBe(handSize(s0) - 1 + 1);
  });

  it('CR 701.67c: paying a waterbend cost triggers it', () => {
    const s0 = board([], ['Test Tide Basin', 'Plains']);
    const s = waterbend(s0);
    expect(handSize(s)).toBe(handSize(s0) + 1);
    expect(lifeOf(s)).toBe(21);
  });

  it('CR 702.189: a firebending trigger of yours that resolves is "you firebend"; an opponent\'s is not', () => {
    const s0 = scenario(['Forest'], { defs: BEND_DEFS, p1: { battlefield: ['Test Wind Avatar', 'Test Ember Adept'], library: Array(10).fill('Plains') } });
    const s = firebend(s0);
    expect(handSize(s)).toBe(handSize(s0) + 1);
    const t0 = scenario(['Forest'], { defs: BEND_DEFS, p1: { battlefield: ['Test Wind Avatar'], library: Array(10).fill('Plains') }, p2: { battlefield: ['Test Ember Adept'] } });
    const t1 = advanceTo(t0, 2, 'main1');
    const t = resolveAll(attackWith(t1, [find(t1, 'Test Ember Adept', 'battlefield', 'p2')], 'p1'));
    expect(handSize(t)).toBe(handSize(t1));
  });

  it('CR 608.2c: with all four done this turn the fourth trigger also gains 10 life; three of them gain none', () => {
    const s0 = scenario(['Forest'], { defs: BEND_DEFS, p1: { hand: ['Test Stone Lesson', 'Test Gust Lesson'], battlefield: ['Test Wind Avatar', 'Test Ember Adept', 'Test Tide Basin', 'Forest', 'Plains'], library: Array(10).fill('Plains') }, p2: { battlefield: ['Test Ember Adept'] } });
    let s = earthbend(s0);
    s = airbend(s);
    s = waterbend(s);
    expect(lifeOf(s)).toBe(21); // the waterbend cost's own life; three actions: no 10 life
    s = firebend(s);
    expect(lifeOf(s)).toBe(31);
  });
});
