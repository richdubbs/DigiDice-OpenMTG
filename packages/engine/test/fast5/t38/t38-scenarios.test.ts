/**
 * FAST5 T38: the shapes of parser/templates/zz-fast5/t38.json (and the engine, render and capability support they needed) played through the engine with
 * synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 701.51a            "open an Attraction": no Attraction deck, so nothing is opened (and the log says so)
 *   CR 106.3, 605.4a      "that player adds one mana of any type that land produced": a triggered mana ability reads the mana the tapped land produced
 *   CR 700.8              "~ costs {1} less to cast for each creature in your party": a creature fills one slot, as the party is as large as possible
 *   CR 702.166, 601.2f    "~ costs {2} less to cast if it's bargained": the bargain cost (sacrifice an artifact, enchantment or token) is chosen before the total cost
 *   CR 601.2f, 602.2b     "This ability costs {1} less to activate for each legendary creature you control": the ability's own cost, never below {0}
 *   CR 305.2, 611.2a      "You may play an additional land this turn."
 *   CR 707.9a, 205.1b     "You may have ~ enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types."
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type CardDef, type GameState, type ManaSymbol, type ObjectId } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { partySize } from '../../../src/statics/party';
import { act, find, scenario } from '../../m5/helpers';
import { activate, resolveAll } from '../../m5/cr-examples/helpers';
import { castWith, no, synthetic, yes } from '../../m6/costs/support';

const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` (a card in hand) for `player`, after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);
const tapped = (s: GameState, player = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.objects[id]!.tapped).length;

describe('CR 700.8: the size of a party (statics/party.ts)', () => {
  const c = (...types: string[]) => ({ all: false, set: new Set(types) });
  it('one creature of each of the four types is a full party; two of one type are one slot', () => {
    expect(partySize([c('Cleric'), c('Rogue'), c('Warrior'), c('Wizard')])).toBe(4);
    expect(partySize([c('Cleric'), c('Cleric'), c('Cleric')])).toBe(1);
    expect(partySize([])).toBe(0);
  });
  it('a creature of several types fills only one slot, and the slots are given out so the party is as large as possible', () => {
    expect(partySize([c('Cleric', 'Rogue', 'Warrior', 'Wizard')])).toBe(1);
    expect(partySize([c('Cleric', 'Rogue'), c('Cleric')])).toBe(2); // the Cleric Rogue is the Rogue
    expect(partySize([c('Cleric', 'Rogue'), c('Rogue', 'Warrior'), c('Warrior', 'Wizard'), c('Wizard')])).toBe(4);
  });
  it('a changeling is every creature type (CR 702.73a) and fills any one open slot', () => {
    expect(partySize([{ all: true, set: new Set() }, c('Cleric'), c('Rogue'), c('Warrior')])).toBe(4);
    expect(partySize([{ all: true, set: new Set() }, { all: true, set: new Set() }])).toBe(2);
  });
});

describe('CR 701.51a: "open an Attraction" with no Attraction deck', () => {
  const CLERK = synthetic('Test Clerk', 'Creature — Sloth Employee', '{1}', 'When this creature enters, open an Attraction.\nWhen this creature enters, you gain 1 life.', { power: '1', toughness: '1' });
  it('is automated, and resolving it does nothing but say so (the second enters ability still happens)', () => {
    expect(noManual(CLERK)).toEqual([]);
    const s0 = scenario([], { p1: { hand: ['Test Clerk'], battlefield: ['Plains'] }, defs: [CLERK] });
    const s = resolveAll(castWith(s0, 'Test Clerk'));
    expect(s.log.some((l) => /has no Attraction deck/.test(l.text) && l.rules?.includes('CR 701.51a'))).toBe(true);
    expect(s.players[0]!.life).toBe(s0.players[0]!.life + 1);
  });
});

describe('CR 106.3, 605.1b, 605.4a: "that player adds one mana of any type that land produced"', () => {
  const DICTATE = synthetic('Test Dictate', 'Enchantment', '{1}', 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.');
  it('is a full triggered mana ability, which resolves at once and adds one more mana of the type the land made', () => {
    expect(noManual(DICTATE)).toEqual([]);
    expect(DICTATE.automation.level).not.toBe('manual');
    for (const [land, ability, type] of [['Forest', 'r:basic:G', 'G'], ['Plains', 'r:basic:W', 'W']] as const) {
      const s0 = scenario([land], { p1: { battlefield: [land, 'Test Dictate'] }, defs: [DICTATE] });
      const s = act(s0, { type: 'activate', player: 'p1', source: find(s0, land, 'battlefield'), ability });
      expect(s.zones.stack, land).toEqual([]);
      expect(s.players[0]!.manaPool.map((u) => u.type), land).toEqual([type, type]);
      expect(s.log.filter((x) => x.level === 'manual')).toEqual([]);
    }
  });
  it('a land that makes colorless mana gives one more colorless mana (any type includes colorless, CR 106.1b)', () => {
    const s0 = scenario(['Wastes'], { p1: { battlefield: ['Wastes', 'Test Dictate'] }, defs: [DICTATE] });
    const wastes = find(s0, 'Wastes', 'battlefield');
    const tap = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === wastes && a.isMana)!;
    const s = act(s0, tap.action);
    expect(s.players[0]!.manaPool.map((u) => u.type)).toEqual(['C', 'C']);
  });
});

describe('CR 700.8, 601.2f: "~ costs {1} less to cast for each creature in your party"', () => {
  const ALLIANCE = synthetic('Test Alliance', 'Instant', '{3}{B}', 'This spell costs {1} less to cast for each creature in your party.\nDestroy target creature.', { colors: ['B'] });
  const cr = (name: string, type: string) => synthetic(name, `Creature — ${type}`, '{1}', '', { power: '1', toughness: '1' });
  const defs = [ALLIANCE, cr('Test Cleric', 'Human Cleric'), cr('Test Rogue', 'Elf Rogue'), cr('Test Warrior', 'Orc Warrior'), cr('Test Wizard', 'Human Wizard'), cr('Test Cleric Rogue', 'Human Cleric Rogue'), cr('Test Cat', 'Cat')];
  const cost = (mine: string[], theirs: string[] = []): string => {
    const s = scenario([], { p1: { hand: ['Test Alliance'], battlefield: mine }, p2: { battlefield: theirs }, defs });
    return costOf(s, find(s, 'Test Alliance', 'hand'), ALLIANCE);
  };
  it('is automated', () => {
    expect(noManual(ALLIANCE)).toEqual([]);
  });
  it('the party members you control, one per type: none {3}{B}, a Cat {3}{B}, a Cleric {2}{B}, all four {B}', () => {
    expect(cost([])).toBe('{3}{B}');
    expect(cost(['Test Cat'])).toBe('{3}{B}');
    expect(cost(['Test Cleric'])).toBe('{2}{B}');
    expect(cost(['Test Cleric', 'Test Cleric', 'Test Cat'])).toBe('{2}{B}');
    expect(cost(['Test Cleric', 'Test Rogue', 'Test Warrior', 'Test Wizard'])).toBe('{B}');
  });
  it('a creature of two party types fills one slot only; with a Cleric beside it the party has two', () => {
    expect(cost(['Test Cleric Rogue'])).toBe('{2}{B}');
    expect(cost(['Test Cleric Rogue', 'Test Cleric'])).toBe('{1}{B}');
  });
  it("an opponent's creatures are not in your party", () => {
    expect(cost(['Test Cleric'], ['Test Rogue', 'Test Warrior', 'Test Wizard'])).toBe('{2}{B}');
  });
});

describe("CR 702.166, 601.2b, 601.2f: Bargain and \"~ costs {2} less to cast if it's bargained\"", () => {
  const GLUTTON = synthetic('Test Glutton', 'Creature — Giant', '{3}{G}', "Bargain\nThis spell costs {2} less to cast if it's bargained.\nTrample", { colors: ['G'], power: '4', toughness: '4' });
  const GOLEM = synthetic('Test Golem', 'Artifact Creature — Golem', '{3}', '', { power: '3', toughness: '3' });
  const board = (lands: number): GameState =>
    scenario(['Forest'], { p1: { hand: ['Test Glutton'], battlefield: [...(Array(lands).fill('Forest') as string[]), 'Test Golem'] }, defs: [GLUTTON, GOLEM] });
  it('is automated: the keyword is advertised and the cost sentence is read', () => {
    expect(noManual(GLUTTON)).toEqual([]);
    expect(GLUTTON.automation.level).not.toBe('manual');
  });
  it('not bargained: the whole {3}{G} is paid (four lands tapped) and nothing is sacrificed', () => {
    const s = castWith(board(4), 'Test Glutton', [no]);
    expect(s.zones.stack).toHaveLength(1);
    expect(tapped(s)).toBe(4);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Golem')).toBe(true);
  });
  it('bargained (sacrificing an artifact): {1}{G}, two lands tapped, and the artifact is sacrificed (CR 702.166a)', () => {
    const s0 = board(4);
    const s = castWith(s0, 'Test Glutton', [yes, { kind: 'chooseObjects', ids: [find(s0, 'Test Golem', 'battlefield')] }]);
    expect(s.zones.stack).toHaveLength(1);
    expect(tapped(s)).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Golem')).toBe(false);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Golem')).toBe(true);
  });
  it('bargaining makes a spell with only two lands castable (the reduced cost is payable), and it is not castable without', () => {
    const castable = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === find(s, 'Test Glutton', 'hand'));
    expect(castable(board(2))).toBe(true);
    const noGolem = scenario(['Forest'], { p1: { hand: ['Test Glutton'], battlefield: ['Forest', 'Forest'] }, defs: [GLUTTON, GOLEM] });
    expect(castable(noGolem)).toBe(false);
  });
});

describe('CR 601.2f, 602.2b, 118.7: "This ability costs {1} less to activate for each legendary creature you control"', () => {
  const MIRROR = synthetic('Test Mirror', 'Artifact', '{2}', '{5}, {T}: Draw a card. This ability costs {1} less to activate for each legendary creature you control.');
  const KING = synthetic('Test King', 'Legendary Creature — Human Noble', '{1}', '', { power: '1', toughness: '1' });
  const QUEEN = synthetic('Test Queen', 'Legendary Creature — Human Noble', '{1}', '', { power: '1', toughness: '1' });
  const defs = [MIRROR, KING, QUEEN];
  const board = (lands: number, legends: string[]): GameState =>
    scenario(['Plains'], { p1: { battlefield: [...(Array(lands).fill('Plains') as string[]), 'Test Mirror', ...legends], library: Array(5).fill('Plains') as string[] }, defs });
  const mirrorOf = (s: GameState): ObjectId => find(s, 'Test Mirror', 'battlefield');
  const offered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === mirrorOf(s) && !a.isMana);
  it('is an automated activated ability with a cost change, and the capability is advertised', () => {
    expect(noManual(MIRROR)).toEqual([]);
    const a = MIRROR.faces[0]!.abilities.find((x) => x.kind === 'activated');
    expect(a && a.kind === 'activated' ? a.costChange?.kind : null).toBe('reduce');
    expect(MIRROR.automation.level).not.toBe('manual');
  });
  it('without legendary creatures it costs {5}; with two it costs {3}', () => {
    expect(offered(board(4, []))).toBe(false);
    expect(offered(board(5, []))).toBe(true);
    expect(offered(board(2, ['Test King', 'Test Queen']))).toBe(false);
    expect(offered(board(3, ['Test King', 'Test Queen']))).toBe(true);
  });
  it('a real activation with two legendary creatures taps exactly three Plains (and the artifact) and draws a card', () => {
    const s0 = board(4, ['Test King', 'Test Queen']);
    const hand0 = s0.zones.hand.p1!.length;
    let s = activate(s0, mirrorOf(s0));
    expect(s.zones.stack).toHaveLength(1);
    expect(s.objects[mirrorOf(s)]!.tapped).toBe(true);
    expect(tapped(s) - 1).toBe(3);
    s = resolveAll(s);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 1);
    expect(s.log.some((l) => /costs less to activate/.test(l.text))).toBe(true);
  });
});

describe('CR 601.2f, 602.2b, 113.6k: the cost change of an ability activated from the hand (channel)', () => {
  const SHRINE = synthetic('Test Shrine Land', 'Legendary Land', '', '{T}: Add {W}.\nChannel — {2}{W}, Discard this card: You gain 4 life. This ability costs {1} less to activate for each legendary creature you control.');
  const KING = synthetic('Test King', 'Legendary Creature — Human Noble', '{1}', '', { power: '1', toughness: '1' });
  const QUEEN = synthetic('Test Queen', 'Legendary Creature — Human Noble', '{1}', '', { power: '1', toughness: '1' });
  const offered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === find(s, 'Test Shrine Land', 'hand') && !a.isMana);
  it('is automated and discarding it from the hand costs one less per legendary creature', () => {
    expect(noManual(SHRINE)).toEqual([]);
    const board = (lands: number, kings: number): GameState =>
      scenario(['Plains'], { p1: { hand: ['Test Shrine Land'], battlefield: [...(Array(lands).fill('Plains') as string[]), ...['Test King', 'Test Queen'].slice(0, kings)] }, defs: [SHRINE, KING, QUEEN] });
    expect(offered(board(2, 0))).toBe(false); // {2}{W}
    expect(offered(board(3, 0))).toBe(true);
    expect(offered(board(2, 1))).toBe(true); // {1}{W}
    expect(offered(board(1, 1))).toBe(false);
    expect(offered(board(1, 2))).toBe(true); // {W}
    const s0 = board(2, 1);
    const s = resolveAll(activate(s0, find(s0, 'Test Shrine Land', 'hand')));
    expect(s.players[0]!.life).toBe(s0.players[0]!.life + 4);
    expect(tapped(s)).toBe(2);
    expect(s.zones.hand.p1!.length).toBe(0);
  });
});

describe('CR 305.2, 611.2a: "You may play an additional land this turn."', () => {
  const SPRINT = synthetic('Test Sprint', 'Sorcery', '{1}', 'Draw a card. You may play an additional land this turn.');
  it('after it resolves the player may play a second land the turn it was cast, and not a third', () => {
    expect(noManual(SPRINT)).toEqual([]);
    const s0 = scenario(['Forest', 'Plains'], { p1: { hand: ['Test Sprint', 'Forest', 'Forest', 'Forest'], battlefield: ['Plains'] }, defs: [SPRINT] });
    const canPlay = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'playLand');
    expect(canPlay(s0)).toBe(true);
    let s = resolveAll(castWith(s0, 'Test Sprint'));
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(canPlay(s)).toBe(true);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(canPlay(s)).toBe(false);
  });
  it('without it only one land can be played', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Forest', 'Forest'] } });
    const s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Forest', 'hand') });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand')).toBe(false);
  });
});

describe("CR 707.9a, 205.1b: \"enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types\"", () => {
  const MIMIC = synthetic('Test Mimic', 'Creature — Shapeshifter', '{1}', "You may have this creature enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types.", { power: '0', toughness: '0' });
  const BEAR = synthetic('Test Bear', 'Creature — Bear', '{1}', '', { power: '2', toughness: '2' });
  it("the copy has the copied creature's characteristics and both added types", () => {
    expect(noManual(MIMIC)).toEqual([]);
    const s0 = scenario([], { p1: { hand: ['Test Mimic'], battlefield: ['Plains', 'Test Bear'] }, defs: [MIMIC, BEAR] });
    let s = castWith(s0, 'Test Mimic');
    s = resolveAll(s, [{ kind: 'chooseObjects', ids: [find(s0, 'Test Bear', 'battlefield')] }, yes]);
    const copy = s.zones.battlefield.find((id) => id !== find(s0, 'Test Bear', 'battlefield') && s.objects[id]!.defId === 'Test Mimic');
    expect(copy).toBeDefined();
    const c = getChars(s, copy!);
    expect(c.name).toBe('Test Bear');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Shapeshifter', 'Rogue']));
    expect(c.power).toBe('2');
  });
});
