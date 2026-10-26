/**
 * pc-statics-1 (precon lane pc-statics: statics): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 613.4b-d            "Non-Ooze creatures have base power and toughness 3/3.": layer 7b for every creature but the Oozes, counters (7d) on top; the opponent's too
 *   CR 702.6a, 601.2f      "Equip {3}. This ability costs {2} less to activate if you have one or fewer cards in hand."
 *   CR 702.16a-e, 202.3    "Protection from mana value 3 or less / 3 or greater": the mana value of the source (a token's is 0)
 *   CR 404.1, 613.4c       "This creature gets +1/+1 for each creature card in your opponents' graveyards.": only the opponents' graveyards, only creature cards
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { advanceTo, find, scenario } from '../../m5/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { canBeTargeted, hasProtectionFrom } from '../../../src/index';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const ids = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((x) => s.objects[x]!.defId === name);
/** Whether the player is offered the activation of this object's ability (the cost is payable with the mana they have, CR 602.2b). */
const offered = (s: GameState, source: ObjectId): boolean => legalActions(s, 'p1').some((x) => x.kind === 'activate' && x.object === source && !x.isMana);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OOZE = card('Test Ooze', 'Creature — Ooze', '', { pt: ['4', '4'] });
const FILLER = card('Test Filler', 'Sorcery', '');

describe('CR 613.4b-d: "Non-Ooze creatures have base power and toughness 3/3."', () => {
  const WARDEN = card('Test Warden', 'Creature — Wizard', 'Non-Ooze creatures have base power and toughness 3/3.', { pt: ['1', '1'] });
  it('is automated; every creature that is not an Ooze is 3/3 (the source and the opponent\'s too), an Ooze keeps its own, counters apply on top', () => {
    expect(full(WARDEN)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Warden', 'Test Bear', 'Test Ooze', { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, p2: { battlefield: ['Test Bear'] }, defs: [WARDEN, BEAR, OOZE] });
    s = advanceTo(s, 1, 'main1');
    const [plain, counted] = ids(s, 'Test Bear').filter((x) => s.objects[x]!.controller === 'p1').sort((a, b) => Object.keys(s.objects[a]!.counters).length - Object.keys(s.objects[b]!.counters).length);
    expect(pt(s, find(s, 'Test Warden', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, plain!)).toBe('3/3');
    expect(pt(s, counted!)).toBe('4/4');
    expect(pt(s, find(s, 'Test Ooze', 'battlefield', 'p1'))).toBe('4/4');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('3/3');
  });
  it('negative: without the source on the battlefield the creatures keep their own power and toughness', () => {
    const s = scenario([], { p1: { battlefield: ['Test Bear'] }, defs: [WARDEN, BEAR] });
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 702.6a, 601.2f: "Equip {3}. This ability costs {2} less to activate if you have one or fewer cards in hand."', () => {
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equip {3}. This ability costs {2} less to activate if you have one or fewer cards in hand.');
  it('is automated; with one card in hand equip costs {1}, with two cards in hand it costs {3}', () => {
    expect(full(BLADE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Blade', 'Test Bear', 'Plains'], hand: ['Test Filler'] }, defs: [BLADE, BEAR, FILLER] });
    expect(offered(s, find(s, 'Test Blade', 'battlefield', 'p1'))).toBe(true);
    s = scenario([], { p1: { battlefield: ['Test Blade', 'Test Bear', 'Plains'], hand: ['Test Filler', 'Test Filler'] }, defs: [BLADE, BEAR, FILLER] });
    expect(offered(s, find(s, 'Test Blade', 'battlefield', 'p1'))).toBe(false);
    s = scenario([], { p1: { battlefield: ['Test Blade', 'Test Bear', 'Plains', 'Plains', 'Plains'], hand: ['Test Filler', 'Test Filler'] }, defs: [BLADE, BEAR, FILLER] });
    expect(offered(s, find(s, 'Test Blade', 'battlefield', 'p1'))).toBe(true);
  });
});

describe('CR 702.16a-e, 202.3: "Protection from mana value 3 or less" and "protection from mana value 3 or greater"', () => {
  const LOW = card('Test Warder', 'Creature — Knight', 'Protection from mana value 3 or less', { pt: ['2', '2'] });
  const HIGH = card('Test Shade', 'Creature — Spirit', 'Protection from mana value 3 or greater', { pt: ['2', '2'] });
  const spell = (n: number): CardDef => card(`Test Spell ${n}`, 'Instant', '', { cost: `{${n}}` });
  it('are automated keywords with the quality of the mana value', () => {
    expect(full(LOW)).toBe(true);
    expect(full(HIGH)).toBe(true);
    expect(JSON.stringify(LOW.faces[0]!.abilities)).toContain('"mv:le:3"');
    expect(JSON.stringify(HIGH.faces[0]!.abilities)).toContain('"mv:ge:3"');
  });
  it('a source of mana value 3 or less is protected from, 3 included; 4 is not; a {0}-cost source (mana value 0, as a token has) is', () => {
    const defs = [LOW, spell(0), spell(3), spell(4)];
    const s = scenario([], { p1: { battlefield: ['Test Warder'], hand: ['Test Spell 0', 'Test Spell 3', 'Test Spell 4'] }, defs });
    const target = getChars(s, find(s, 'Test Warder', 'battlefield', 'p1'))!;
    const from = (n: number) => getChars(s, find(s, `Test Spell ${n}`, 'hand', 'p1'))!;
    expect(hasProtectionFrom(target, from(0))).toBe(true);
    expect(hasProtectionFrom(target, from(3))).toBe(true);
    expect(hasProtectionFrom(target, from(4))).toBe(false);
    expect(canBeTargeted(target, 'p1', from(3), 'p2')).toBe(false);
    expect(canBeTargeted(target, 'p1', from(4), 'p2')).toBe(true);
  });
  it('mana value 3 or greater: 2 is not protected from, 3 and 5 are', () => {
    const defs = [HIGH, spell(2), spell(3), spell(5)];
    const s = scenario([], { p1: { battlefield: ['Test Shade'], hand: ['Test Spell 2', 'Test Spell 3', 'Test Spell 5'] }, defs });
    const target = getChars(s, find(s, 'Test Shade', 'battlefield', 'p1'))!;
    const from = (n: number) => getChars(s, find(s, `Test Spell ${n}`, 'hand', 'p1'))!;
    expect(hasProtectionFrom(target, from(2))).toBe(false);
    expect(hasProtectionFrom(target, from(3))).toBe(true);
    expect(hasProtectionFrom(target, from(5))).toBe(true);
  });
  it('an X spell is still castable at the only creature protected from "mana value 1 or less": X is announced before targets (CR 601.2b-c, 202.3e)', () => {
    const warder = card('Test Lone Warder', 'Creature — Knight', 'Protection from mana value 1 or less', { pt: ['2', '2'] });
    const blast = card('Test Blast', 'Sorcery', 'Test Blast deals X damage to target creature.', { cost: '{X}{W}' });
    const s = scenario([], { p1: { hand: ['Test Blast'], battlefield: Array(8).fill('Plains') as string[] }, p2: { battlefield: ['Test Lone Warder'] }, defs: [warder, blast] });
    const id = find(s, 'Test Blast', 'hand', 'p1');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === id)).toBe(true);
  });
  it('negative: with no X in the cost, a spell of mana value 1 cannot target that creature, so it is not offered', () => {
    const warder = card('Test Lone Warder', 'Creature — Knight', 'Protection from mana value 1 or less', { pt: ['2', '2'] });
    const bolt = card('Test Bolt', 'Sorcery', 'Test Bolt deals 2 damage to target creature.', { cost: '{W}' });
    const s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Plains'] }, p2: { battlefield: ['Test Lone Warder'] }, defs: [warder, bolt] });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === find(s, 'Test Bolt', 'hand', 'p1'))).toBe(false);
  });
  it('the X that can be paid bounds the guess: with 3 lands X is at most 2 (mana value 3), so a creature protected from mana value 3 or less is not a target', () => {
    const warder = card('Test Lone Warder', 'Creature — Knight', 'Protection from mana value 3 or less', { pt: ['2', '2'] });
    const blast = card('Test Blast', 'Sorcery', 'Test Blast deals X damage to target creature.', { cost: '{X}{W}' });
    const mk = (n: number) => scenario([], { p1: { hand: ['Test Blast'], battlefield: Array(n).fill('Plains') as string[] }, p2: { battlefield: ['Test Lone Warder'] }, defs: [warder, blast] });
    const offeredWith = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === find(s, 'Test Blast', 'hand', 'p1'));
    expect(offeredWith(mk(3))).toBe(false);
    expect(offeredWith(mk(4))).toBe(true);
  });
  it('negative: an activated ability of a permanent with {X} in its mana cost is judged by the permanent\'s own mana value, not by a guessed X', () => {
    const warder = card('Test Lone Warder', 'Creature — Knight', 'Protection from mana value 3 or less', { pt: ['2', '2'] });
    const pinger = card('Test Pinger', 'Creature — Wizard', '{T}: Test Pinger deals 1 damage to target creature an opponent controls.', { pt: ['1', '1'], cost: '{X}{W}' });
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Pinger', since: 0 }] }, p2: { battlefield: ['Test Lone Warder'] }, defs: [warder, pinger] });
    expect(offered(s, find(s, 'Test Pinger', 'battlefield', 'p1'))).toBe(false);
  });
  it('negative: a "{1}, Discard this card" ability of a card in hand with {X} in its mana cost is not judged by a guessed X', () => {
    const warder = card('Test Lone Warder', 'Creature — Knight', 'Protection from mana value 3 or less', { pt: ['2', '2'] });
    const cycler = card('Test Channeler', 'Creature — Spirit', '{1}, Discard this card: It deals 1 damage to target creature an opponent controls.', { pt: ['1', '1'], cost: '{X}{W}' });
    const s = scenario([], { p1: { hand: ['Test Channeler'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Lone Warder'] }, defs: [warder, cycler] });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === find(s, 'Test Channeler', 'hand', 'p1'))).toBe(false);
  });
  it('an X spell whose target filter reads X ("with mana value X") is castable at a lone creature protected from mana value 1 or less (X = 2 makes the spell\'s mana value 3)', () => {
    const warder = card('Test Lone Warder', 'Creature — Knight', 'Protection from mana value 1 or less', { pt: ['2', '2'], cost: '{2}' });
    const doom = card('Test Doom', 'Sorcery', 'Destroy target creature with mana value X.', { cost: '{X}{W}' });
    const s = scenario([], { p1: { hand: ['Test Doom'], battlefield: Array(5).fill('Plains') as string[] }, p2: { battlefield: ['Test Lone Warder'] }, defs: [warder, doom] });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === find(s, 'Test Doom', 'hand', 'p1'))).toBe(true);
  });
  it('a permanent is judged by its mana value on the battlefield (a creature of mana value 2 cannot damage or target the Warder)', () => {
    const cheap = card('Test Cheap', 'Creature — Goblin', '', { pt: ['1', '1'], cost: '{2}' });
    const dear = card('Test Dear', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{6}' });
    const s = scenario([], { p1: { battlefield: ['Test Warder'] }, p2: { battlefield: ['Test Cheap', 'Test Dear'] }, defs: [LOW, cheap, dear] });
    const target = getChars(s, find(s, 'Test Warder', 'battlefield', 'p1'))!;
    expect(hasProtectionFrom(target, getChars(s, find(s, 'Test Cheap', 'battlefield', 'p2'))!)).toBe(true);
    expect(hasProtectionFrom(target, getChars(s, find(s, 'Test Dear', 'battlefield', 'p2'))!)).toBe(false);
  });
});

describe('CR 404.1, 613.4c: "This creature gets +1/+1 for each creature card in your opponents\' graveyards."', () => {
  const HOUND = card('Test Hound', 'Creature — Zombie', "This creature gets +1/+1 for each creature card in your opponents' graveyards.", { pt: ['1', '1'] });
  it('is automated; only creature cards in the opponent\'s graveyard count', () => {
    expect(full(HOUND)).toBe(true);
    const s = scenario([], {
      p1: { battlefield: ['Test Hound'], graveyard: ['Test Bear', 'Test Bear'] },
      p2: { graveyard: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Filler'] },
      defs: [HOUND, BEAR, FILLER],
    });
    expect(pt(s, find(s, 'Test Hound', 'battlefield', 'p1'))).toBe('4/4');
  });
  it('negative: with only the controller\'s own graveyard filled it stays 1/1', () => {
    const s = scenario([], { p1: { battlefield: ['Test Hound'], graveyard: ['Test Bear', 'Test Bear'] }, defs: [HOUND, BEAR] });
    expect(pt(s, find(s, 'Test Hound', 'battlefield', 'p1'))).toBe('1/1');
  });
});

