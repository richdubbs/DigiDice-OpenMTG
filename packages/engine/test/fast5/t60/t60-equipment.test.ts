/**
 * FAST5 T60: Equipment and Auras whose static ability gives the attached creature more than a bonus, played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 613.1f, 613.4c            "Equipped creature gets +3/+3 and loses flying"
 *   CR 613.1d, 613.1f, 603.2     "... has \"Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent,\" and is a Wizard in addition to its other types"
 *   CR 603.2, 510.2              "... has \"Whenever this creature deals combat damage to a player, draw a card,\" and is a Rogue in addition to its other types"
 *   CR 107.3, 122.1, 613.4c      "Equipped creature gets +X/+0, where X is the number of rev counters on ~"
 *   CR 613.4b, 119.1             "Equipped creature has base power and toughness X/X, where X is your life total"
 *   CR 105.3, 607.2d, 613.1e     "Enchanted land is the chosen color"
 *   CR 510.1a, 611.3a            "As long as equipped creature's toughness is greater than its power, it assigns combat damage equal to its toughness rather than its power"
 */
import { describe, expect, it } from 'vitest';
import { hasKeyword } from '../../../src/rules/characteristics';
import { getChars } from '../../../src/rules/characteristics';
import { find, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { castCard } from '../../m5/announce/support';
import { attach, automated, card, colors, pt, resolveAll, settle, subtypes } from './support';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{0}');

describe('CR 613.1f, 613.4c: "Equipped creature gets +3/+3 and loses flying."', () => {
  const ANCHOR = card('Test Anchor', 'Artifact — Equipment', 'Equipped creature gets +3/+3 and loses flying.\nEquip {0}');
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
  it('is automated; the equipped bird is a 4/4 without flying, an unequipped one keeps it', () => {
    expect(automated(ANCHOR)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Anchor', 'Test Bird'] }, defs: [ANCHOR, BIRD] });
    const bird = find(s0, 'Test Bird', 'battlefield');
    expect(hasKeyword(getChars(s0, bird)!, 'flying')).toBe(true);
    const s = attach(s0, 'Test Anchor', 'Test Bird');
    expect(pt(s, bird)).toBe('4/4');
    expect(hasKeyword(getChars(s, bird)!, 'flying')).toBe(false);
  });
});

describe('CR 613.1d, 613.1f, 603.2: "Equipped creature gets +1/+0, has \\"Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent,\\" and is a Wizard in addition to its other types."', () => {
  const ROD = card('Test Rod', 'Artifact — Equipment', 'Equipped creature gets +1/+0, has "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent," and is a Wizard in addition to its other types.\nEquip {0}');
  it('is automated; the equipped bear is a 3/2 Bear Wizard and each noncreature spell its controller casts costs the opponent 1 life', () => {
    expect(automated(ROD)).toBe(true);
    let s = attach(scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Rod', 'Test Bear'] }, defs: [ROD, BEAR, TONIC] }), 'Test Rod', 'Test Bear');
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(pt(s, bear)).toBe('3/2');
    expect(subtypes(s, bear)).toEqual(expect.arrayContaining(['Bear', 'Wizard']));
    const before = life(s, 'p2');
    s = resolveAll(castCard(s, 'Test Tonic'));
    expect(life(s, 'p2')).toBe(before - 1);
  });
  it('unequipped, the bear is a plain 2/2 Bear and casting costs the opponent nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Rod', 'Test Bear'] }, defs: [ROD, BEAR, TONIC] });
    const before = life(s, 'p2');
    s = resolveAll(castCard(s, 'Test Tonic'));
    expect(life(s, 'p2')).toBe(before);
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toBe('2/2');
    expect(subtypes(s, find(s, 'Test Bear', 'battlefield'))).toEqual(['Bear']);
  });
});

describe('CR 603.2, 510.2: "Equipped creature gets +1/+1, has \\"Whenever this creature deals combat damage to a player, draw a card,\\" and is a Rogue in addition to its other types."', () => {
  const KNIFE = card('Test Knife', 'Artifact — Equipment', 'Equipped creature gets +1/+1, has "Whenever this creature deals combat damage to a player, draw a card," and is a Rogue in addition to its other types.\nEquip {0}');
  it('is automated; the equipped bear is a Rogue and draws its controller a card when it connects', () => {
    expect(automated(KNIFE)).toBe(true);
    const s0 = attach(scenario([], { p1: { battlefield: ['Test Knife', 'Test Bear'], library: ['Test Bear', 'Test Bear'] }, defs: [KNIFE, BEAR] }), 'Test Knife', 'Test Bear');
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(subtypes(s0, bear)).toContain('Rogue');
    const hand = s0.zones.hand['p1']!.length;
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    for (let i = 0; i < 30 && s.turn.step !== 'main2' && s.pending; i++) s = settle(pass(s));
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(20 - 3);
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
});

describe('CR 613.1d, 613.1f, 603.2: "Equipped creature has \\"Whenever you cast a noncreature spell, this creature gets +2/+0 until end of turn\\" and is a Wizard in addition to its other types."', () => {
  const RAPIER = card('Test Rapier', 'Artifact — Equipment', 'Equipped creature has "Whenever you cast a noncreature spell, this creature gets +2/+0 until end of turn" and is a Wizard in addition to its other types.\nEquip {0}');
  it('is automated; casting a noncreature spell makes the equipped bear a 4/2 until end of turn', () => {
    expect(automated(RAPIER)).toBe(true);
    let s = attach(scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Rapier', 'Test Bear'] }, defs: [RAPIER, BEAR, TONIC] }), 'Test Rapier', 'Test Bear');
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(subtypes(s, bear)).toContain('Wizard');
    expect(pt(s, bear)).toBe('2/2');
    s = resolveAll(castCard(s, 'Test Tonic'));
    expect(pt(s, bear)).toBe('4/2');
  });
});

describe('CR 107.3, 122.1, 613.4c: "Equipped creature gets +X/+0, where X is the number of rev counters on ~."', () => {
  const SAW = card('Test Saw', 'Artifact — Equipment', 'Equipped creature gets +X/+0, where X is the number of rev counters on ~.\nEquip {0}');
  it('is automated; the bonus follows the counters on the Equipment as they change', () => {
    expect(automated(SAW)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Saw', counters: { rev: 2 } }, 'Test Bear'] }, defs: [SAW, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(pt(s0, bear)).toBe('2/2'); // not equipped yet
    const s1 = attach(s0, 'Test Saw', 'Test Bear');
    expect(pt(s1, bear)).toBe('4/2');
    const s2 = tweak(s1, (t) => { t.objects[find(t, 'Test Saw', 'battlefield')]!.counters['rev'] = 5; });
    expect(pt(s2, bear)).toBe('7/2');
  });
});

describe('CR 613.4b, 119.1: "Equipped creature has base power and toughness X/X, where X is your life total."', () => {
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature has base power and toughness X/X, where X is your life total.\nEquip {0}');
  it('is automated; the equipped bear is as big as its controller\'s life total, base only (a +1/+1 counter still adds)', () => {
    expect(automated(BLADE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Blade', { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs: [BLADE, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = attach(s0, 'Test Blade', 'Test Bear');
    expect(pt(s1, bear)).toBe('21/21'); // 20 life + the counter
    const s2 = tweak(s1, (t) => { t.players.find((p) => p.id === 'p1')!.life = 7; });
    expect(pt(s2, bear)).toBe('8/8');
  });
});

describe('CR 105.3, 607.2d, 613.1e: "As ~ enters, choose a color. Enchanted land is the chosen color."', () => {
  const GROWTH = card('Test Growth', 'Enchantment — Aura', 'Enchant land\nAs ~ enters, choose a color.\nEnchanted land is the chosen color.', undefined, '{0}', ['G']);
  const PLAINS = card('Test Plains', 'Land', '', undefined, '{0}');
  it('is automated; the enchanted land becomes the color chosen as the Aura entered, and another land does not', () => {
    expect(automated(GROWTH)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Plains', 'Test Plains'] }, defs: [GROWTH, PLAINS] });
    const [enchanted, other] = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Plains');
    expect(colors(s0, enchanted!)).toEqual([]);
    const aura = put(s0, 'p1', 'battlefield', 'Test Growth');
    s0.objects[aura]!.attachedTo = enchanted!; // test setup: the Aura on the first land (CR 303.4)
    s0.objects[aura]!.links = { color: { values: ['red'] } } as never; // test setup: red was chosen as it entered (CR 607.2d)
    expect(colors(s0, enchanted!)).toEqual(['R']);
    expect(colors(s0, other!)).toEqual([]);
  });
});

describe("CR 510.1a, 611.3a: As long as equipped creature's toughness is greater than its power, it assigns combat damage equal to its toughness rather than its power", () => {
  const BARK = card('Test Bark', 'Artifact — Equipment', "Equipped creature gets +0/+2.\nAs long as equipped creature's toughness is greater than its power, it assigns combat damage equal to its toughness rather than its power.\nEquip {0}");
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '2']);
  const BRUISER = card('Test Bruiser', 'Creature — Ogre', '', ['3', '1']);
  const damage = (name: string, equipped: boolean): number => {
    let s0 = scenario([], { p1: { battlefield: ['Test Bark', name] }, defs: [BARK, WALL, BRUISER] });
    if (equipped) s0 = attach(s0, 'Test Bark', name);
    const id = find(s0, name, 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[id]]);
    for (let i = 0; i < 30 && s.turn.step !== 'main2' && s.pending; i++) s = settle(pass(s));
    return 20 - life(s, 'p2');
  };
  it('is automated', () => expect(automated(BARK)).toBe(true));
  it('an equipped 0/2 is a 0/4 and hits for 4; an equipped 3/1 is a 3/3 (toughness not greater) and hits for 3; unequipped, the 0/2 hits for 0', () => {
    expect(damage('Test Wall', true)).toBe(4);
    expect(damage('Test Bruiser', true)).toBe(3);
    expect(damage('Test Wall', false)).toBe(0);
  });
});
