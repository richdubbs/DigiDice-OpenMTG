/**
 * FAST5 T60: static abilities that grant types, base power and toughness, abilities and cost changes, played through the engine with synthetic cards compiled
 * by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 205.1b, 613.1d              "Nontoken artifacts you control are creatures in addition to their other types"
 *   CR 205.1b, 613.1d, 613.1f      "Artifacts you control are Foods in addition to their other types and have \"{2}, {T}, Sacrifice this artifact: You gain 3 life.\""
 *   CR 613.4b, 107.3               "Creatures you control have base power and toughness each equal to the number of creatures you control"
 *   CR 702.41a, 700.12             "Affinity for outlaws"
 *   CR 103.4, 119.1, 611.3a        "As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2"
 *   CR 607.2a, 611.3a, 613.4c      "As long as there are three or more cards exiled with ~, it gets +3/+3 and has hexproof"
 *   CR 601.2f, 602.2b, 702.177a    "Exhaust abilities of other permanents you control cost {2} less to activate"
 *   CR 702.66a, 613.1f             "Spells you cast have delve" (the keyword is granted; cloud std-tdm made the engine play delve)
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { advanceTo, find, labels, legal, life, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { activate, automated, card, obj, pt, resolveAll, types } from './support';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('CR 205.1b, 613.1d: "Nontoken artifacts you control are creatures in addition to their other types."', () => {
  const SMITH = card('Test Smith', 'Creature — Human Artificer', 'Nontoken artifacts you control are creatures in addition to their other types.', ['1', '1']);
  const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
  const TREASURE = card('Test Trinket', 'Artifact', '', undefined, '{1}');
  it('is automated; a nontoken artifact of its controller becomes an artifact creature, an opponent\'s and a token do not', () => {
    expect(automated(SMITH)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Smith', 'Test Relic', 'Test Trinket'] }, p2: { battlefield: ['Test Relic'] }, defs: [SMITH, RELIC, TREASURE] });
    const mine = find(s0, 'Test Relic', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Relic', 'battlefield', 'p2');
    expect(types(s0, mine)).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(types(s0, theirs)).toEqual(['Artifact']);
    const token = tweak(s0, (t) => { t.objects[find(t, 'Test Trinket', 'battlefield', 'p1')]!.kind = 'token'; });
    expect(types(token, find(token, 'Test Trinket', 'battlefield', 'p1'))).toEqual(['Artifact']);
  });
  it('the lands version: an artifact is an artifact land in addition (CR 205.1b)', () => {
    const TOPH = card('Test Toph', 'Legendary Creature — Human Monk', 'Nontoken artifacts you control are lands in addition to their other types.', ['2', '2']);
    expect(automated(TOPH)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Toph', 'Test Relic'] }, defs: [TOPH, RELIC] });
    expect(types(s0, find(s0, 'Test Relic', 'battlefield', 'p1'))).toEqual(expect.arrayContaining(['Artifact', 'Land']));
  });
});

describe('CR 205.1b, 613.1f, 602.2: "Artifacts you control are Foods in addition to their other types and have \\"{2}, {T}, Sacrifice this artifact: You gain 3 life.\\""', () => {
  const GASTRONAUT = card('Test Gastronaut', 'Legendary Creature — Human Chef', 'Artifacts you control are Foods in addition to their other types and have "{2}, {T}, Sacrifice this artifact: You gain 3 life."', ['2', '2']);
  const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
  it('is automated; an artifact is a Food and can be sacrificed for 3 life, and the opponent\'s artifact cannot', () => {
    expect(automated(GASTRONAUT)).toBe(true);
    const s0 = scenario(['Island', 'Island'], { p1: { battlefield: ['Test Gastronaut', 'Test Relic', 'Island', 'Island'] }, p2: { battlefield: ['Test Relic'] }, defs: [GASTRONAUT, RELIC] });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p1');
    expect(getChars(s0, relic)!.subtypes).toContain('Food');
    expect(getChars(s0, find(s0, 'Test Relic', 'battlefield', 'p2'))!.subtypes).not.toContain('Food');
    const before = life(s0, 'p1');
    const s = resolveAll(activate(s0, 'Test Relic'));
    expect(life(s, 'p1')).toBe(before + 3);
    expect(s.zones.battlefield).not.toContain(relic);
  });
});

describe('CR 613.4b, 107.3: "Creatures you control have base power and toughness each equal to the number of creatures you control."', () => {
  const GALLERY = card('Test Gallery', 'Enchantment', 'Creatures you control have base power and toughness each equal to the number of creatures you control.', undefined, '{2}');
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  it('is automated; three creatures are 3/3 each, a +1/+1 counter still adds, an opponent\'s creature is unchanged, and it follows the count', () => {
    expect(automated(GALLERY)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Gallery', 'Test Bear', { name: 'Test Elf', counters: { '+1/+1': 1 } }, 'Test Elf'] }, p2: { battlefield: ['Test Bear'] }, defs: [GALLERY, BEAR, ELF] });
    const [elfWithCounter, plainElf] = [find(s0, 'Test Elf', 'battlefield', 'p1'), s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Elf')[1]!];
    expect(pt(s0, find(s0, 'Test Bear', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s0, elfWithCounter)).toBe('4/4');
    expect(pt(s0, plainElf)).toBe('3/3');
    expect(pt(s0, find(s0, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
    const fewer = tweak(s0, (t) => { t.zones.battlefield = t.zones.battlefield.filter((id) => id !== plainElf); });
    expect(pt(fewer, find(fewer, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 702.41a, 700.12: "Affinity for outlaws"', () => {
  const BRUTE = card('Test Brute', 'Creature — Minotaur Mercenary', 'Affinity for outlaws\nTrample', ['5', '4'], '{4}{R}');
  const THIEF = card('Test Thief', 'Creature — Human Rogue', '', ['1', '1']);
  it('is automated; each Rogue, Mercenary, Assassin, Pirate or Warlock its caster controls takes {1} off, other creatures and the opponent\'s outlaws do not', () => {
    expect(automated(BRUTE)).toBe(true);
    const lands = ['Mountain', 'Mountain', 'Mountain'];
    const with2 = scenario(['Mountain'], { p1: { hand: ['Test Brute'], battlefield: [...lands, 'Test Thief', 'Test Thief'] }, defs: [BRUTE, THIEF] });
    expect(labels(with2, 'p1')).toContain('Cast Test Brute'); // {4}{R} - 2 = {2}{R}
    const with1 = scenario(['Mountain'], { p1: { hand: ['Test Brute'], battlefield: [...lands, 'Test Thief'] }, defs: [BRUTE, THIEF] });
    expect(labels(with1, 'p1')).not.toContain('Cast Test Brute');
    const bears = scenario(['Mountain'], { p1: { hand: ['Test Brute'], battlefield: [...lands, 'Test Bear', 'Test Bear'] }, defs: [BRUTE, BEAR] });
    expect(labels(bears, 'p1')).not.toContain('Cast Test Brute');
    const theirs = scenario(['Mountain'], { p1: { hand: ['Test Brute'], battlefield: lands }, p2: { battlefield: ['Test Thief', 'Test Thief'] }, defs: [BRUTE, THIEF] });
    expect(labels(theirs, 'p1')).not.toContain('Cast Test Brute');
  });
});

describe('CR 103.4, 119.1, 611.3a: "As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2."', () => {
  const LEYLINE = card('Test Leyline', 'Enchantment', 'As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2.', undefined, '{2}');
  const at = (life0: number, startingLife = 20) => {
    const s = scenario([], { p1: { battlefield: ['Test Leyline', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [LEYLINE, BEAR] });
    return tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.life = life0; t.options.startingLife = startingLife; });
  };
  it('is automated; 27 life or more is the threshold with a starting life total of 20, 47 with 40 (Commander)', () => {
    expect(automated(LEYLINE)).toBe(true);
    const bear = (s: ReturnType<typeof at>): string => pt(s, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(bear(at(26))).toBe('2/2');
    expect(bear(at(27))).toBe('4/4');
    expect(bear(at(60))).toBe('4/4');
    expect(bear(at(40, 40))).toBe('2/2');
    expect(bear(at(47, 40))).toBe('4/4');
    expect(pt(at(30), find(at(30), 'Test Bear', 'battlefield', 'p2'))).toBe('2/2'); // "creatures you control"
  });
});

describe('CR 103.4, 602.5b, 603.4: the starting life total in an activation restriction and in an intervening "if"', () => {
  const SPEAKER = card('Test Speaker', 'Creature — Angel', '{T}: You gain 1 life. Activate only if you have at least 7 life more than your starting life total.', ['2', '2']);
  const at = (life0: number) => tweak(scenario([], { p1: { battlefield: ['Test Speaker'] }, defs: [SPEAKER] }), (t) => { t.players.find((p) => p.id === 'p1')!.life = life0; });
  it('is automated; the ability is offered at 27 life and not at 26 (starting life 20)', () => {
    expect(automated(SPEAKER)).toBe(true);
    const offered = (s: ReturnType<typeof at>): boolean => legal(s, 'p1', 'activate').some((a) => a.object === find(s, 'Test Speaker', 'battlefield') && !a.isMana);
    expect(offered(at(26))).toBe(false);
    expect(offered(at(27))).toBe(true);
  });
  it('the intervening if of a triggered ability reads the same total: at the beginning of the upkeep, with 27 life or more, gain 1 life', () => {
    const SAGE = card('Test Sage', 'Creature — Human Cleric', 'At the beginning of your upkeep, if you have at least 7 life more than your starting life total, you gain 1 life.', ['1', '1']);
    expect(automated(SAGE)).toBe(true);
    const run = (life0: number): number => {
      const s0 = tweak(scenario([], { p1: { battlefield: ['Test Sage'] }, defs: [SAGE] }), (t) => { t.players.find((p) => p.id === 'p1')!.life = life0; });
      return life(resolveAll(advanceTo(s0, 3, 'upkeep')), 'p1');
    };
    expect(run(30)).toBe(31);
    expect(run(20)).toBe(20);
  });
});

describe('CR 607.2a, 611.3a, 613.4c: "As long as there are three or more cards exiled with ~, it gets +3/+3 and has hexproof."', () => {
  const SURVIVOR = card('Test Survivor', 'Creature — Human Survivor', '{0}: Exile target card from a graveyard.\nAs long as there are three or more cards exiled with ~, it gets +3/+3 and has hexproof.', ['1', '1']);
  it('is automated; it is a 1/1 until the third card it exiled, then a 4/4 with hexproof; cards exiled by something else do not count', () => {
    expect(automated(SURVIVOR)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Survivor'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [SURVIVOR, BEAR] });
    const survivor = find(s, 'Test Survivor', 'battlefield');
    const graveyard = [...s.zones.graveyard['p1']!];
    for (let i = 0; i < 2; i++) {
      s = resolveAll(activate(s, 'Test Survivor', [obj(graveyard[i]!)]));
      expect(pt(s, survivor)).toBe('1/1');
    }
    expect(hasKeyword(getChars(s, survivor)!, 'hexproof')).toBe(false);
    s = resolveAll(activate(s, 'Test Survivor', [obj(graveyard[2]!)]));
    expect(pt(s, survivor)).toBe('4/4');
    expect(hasKeyword(getChars(s, survivor)!, 'hexproof')).toBe(true);
    // a card another effect exiled is not linked to it (CR 607.2a): a fresh Survivor with two of its own and one put there by hand stays 1/1
    let t = scenario([], { p1: { battlefield: ['Test Survivor'], graveyard: ['Test Bear', 'Test Bear'], exile: ['Test Bear'] }, defs: [SURVIVOR, BEAR] });
    const gy = [...t.zones.graveyard['p1']!];
    for (const id of gy) t = resolveAll(activate(t, 'Test Survivor', [obj(id)]));
    expect(pt(t, find(t, 'Test Survivor', 'battlefield'))).toBe('1/1');
  });
});

describe('CR 601.2f, 602.2b, 702.177a: "Exhaust abilities of other permanents you control cost {2} less to activate."', () => {
  const SCHOLAR = card('Test Scholar', 'Creature — Goblin Advisor', 'Exhaust abilities of other permanents you control cost {2} less to activate.', ['3', '3'], '{1}{R}{G}');
  const ENGINE = card('Test Engine', 'Artifact', 'Exhaust — {2}{R}: You gain 4 life. (Activate each exhaust ability only once.)\n{2}{R}: You gain 1 life.', undefined, '{3}');
  it('is automated; an exhaust ability of another permanent costs {2} less (so {R} is enough), an ordinary ability and the opponent\'s do not', () => {
    expect(automated(SCHOLAR)).toBe(true);
    expect(automated(ENGINE)).toBe(true);
    const lands = ['Mountain'];
    const withR = scenario(['Mountain'], { p1: { battlefield: ['Test Scholar', 'Test Engine', ...lands] }, defs: [SCHOLAR, ENGINE] });
    const before = life(withR, 'p1');
    const exhaust = resolveAll(activate(withR, 'Test Engine', [], 0));
    expect(life(exhaust, 'p1')).toBe(before + 4);
    expect(() => activate(withR, 'Test Engine', [], 1)).toThrow(/no activated ability/); // {2}{R} is not payable with one Mountain
    const without = scenario(['Mountain'], { p1: { battlefield: ['Test Engine', ...lands] }, defs: [ENGINE] });
    expect(() => activate(without, 'Test Engine', [], 0)).toThrow(/no activated ability/);
    const theirs = scenario(['Mountain'], { p1: { battlefield: ['Test Scholar'] }, p2: { battlefield: ['Test Engine', ...lands] }, defs: [SCHOLAR, ENGINE] });
    expect(() => activate(theirs, 'Test Engine', [], 0, 'p2')).toThrow(/no activated ability/);
  });
  it('the scholar\'s own exhaust ability is not reduced ("other permanents")', () => {
    const SELF = card('Test Self', 'Creature — Goblin', 'Exhaust abilities of other permanents you control cost {2} less to activate.\nExhaust — {2}{R}: You gain 4 life.', ['3', '3'], '{1}{R}');
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Self', 'Mountain'] }, defs: [SELF] });
    expect(() => activate(s, 'Test Self', [], 0)).toThrow(/no activated ability/);
  });
});

describe('CR 702.66a, 613.1f: "Spells you cast have delve."', () => {
  const TEVAL = card('Test Dragon', 'Creature — Spirit Dragon', 'Spells you cast have delve.', ['6', '6'], '{2}{B}{G}{U}');
  it('compiles to the grant of a layer-6 keyword to the spells its controller casts; the engine plays delve (cloud std-tdm), so the card is full', () => {
    expect(TEVAL.automation.level).toBe('full');
    expect(JSON.stringify(TEVAL.faces)).not.toContain('needs-engine: keyword:delve');
    expect(JSON.stringify(TEVAL.faces)).toContain('"controller":"you"');
  });
});
