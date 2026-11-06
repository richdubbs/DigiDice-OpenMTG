/**
 * Commander third pass over EDHREC ranks 9,001 to 10,000, round edh-b-13: the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 121.1, 701.9a, 608.2c  "Draw cards equal to the number of cards in your hand, then discard a card for each card drawn this way." (Ancient Excavation)
 *   CR 701.9a, 111.2, 101.4   "Each player discards all the cards in their hand, then creates that many 2/2 black Zombie creature tokens." (Awaken the Erstwhile)
 *   CR 107.3a-b, 702.143a     "Foretell {X}{X}{W}" with "If this spell was foretold, create X of those tokens instead." (Starnheim Unleashed)
 *   CR 121.1, 122.1, 608.2h   "Draw a card, then draw an additional card for each quest counter on ~." after "Sacrifice ~" (ED-E, Lonesome Eyebot; last known information)
 *   CR 119.3, 122.1, 608.2h   "Then you lose 3 life for each soul counter on ~." (Netherborn Altar; last known information)
 *   CR 707.10, 603.2          "Whenever you copy an instant spell, put a +1/+1 counter on ~." (Kalamax, the Stormsire)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, card, cast, drive, find, full, lifeOf, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const handSize = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.zones.hand[p]!.length;
const gyNames = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
const tokens = (s: GameState, p: 'p1' | 'p2', name?: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p && (name === undefined || nameOf(s, id) === name)).length;
const counters = (s: GameState, name: string, kind: string): number => s.objects[find(s, name, 'battlefield')]!.counters[kind] ?? 0;

describe('CR 121.1, 701.9a, 608.2c: "Draw cards equal to the number of cards in your hand, then discard a card for each card drawn this way."', () => {
  const DIG = card('Test Deep Dig', 'Instant', 'Draw cards equal to the number of cards in your hand, then discard a card for each card drawn this way.');
  const A = card('Test Card A', 'Sorcery', '');
  const B = card('Test Card B', 'Sorcery', '');
  const C = card('Test Card C', 'Sorcery', '');
  it('is automated', () => expect(full(DIG)).toBe(true));
  it('three other cards in hand (the spell is on the stack, not counted): draws three, discards three; library down by three, graveyard gets the spell and three cards', () => {
    const s0 = scenario([], { p1: { hand: ['Test Deep Dig', 'Test Card A', 'Test Card B', 'Test Card C'] }, p2: {}, defs: [DIG, A, B, C] });
    const lib = s0.zones.library.p1!.length;
    const s = resolveAll(cast(s0, 'Test Deep Dig'));
    expect(s.zones.library.p1!.length).toBe(lib - 3);
    expect(handSize(s)).toBe(3);
    expect(s.zones.graveyard.p1!.length).toBe(4);
    expect(gyNames(s)).toContain('Test Deep Dig');
  });
  it('negative: with no other card in hand nothing is drawn and nothing is discarded', () => {
    const s0 = scenario([], { p1: { hand: ['Test Deep Dig'] }, p2: {}, defs: [DIG] });
    const lib = s0.zones.library.p1!.length;
    const s = resolveAll(cast(s0, 'Test Deep Dig'));
    expect(s.zones.library.p1!.length).toBe(lib);
    expect(s.zones.graveyard.p1!.length).toBe(1);
  });
});

describe('CR 701.9a, 111.2, 101.4: "Each player discards all the cards in their hand, then creates that many 2/2 black Zombie creature tokens."', () => {
  const WAKE = card('Test Mass Wake', 'Sorcery', 'Each player discards all the cards in their hand, then creates that many 2/2 black Zombie creature tokens.');
  const A = card('Test Card A', 'Sorcery', '');
  it('is automated', () => expect(full(WAKE)).toBe(true));
  it('each player makes as many Zombies as THEY discarded, under their own control, and ends with an empty hand', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mass Wake', 'Test Card A', 'Test Card A'] }, p2: { hand: ['Test Card A', 'Test Card A', 'Test Card A'] }, defs: [WAKE, A] });
    const s = resolveAll(cast(s0, 'Test Mass Wake'));
    expect(tokens(s, 'p1', 'Zombie Token')).toBe(2);
    expect(tokens(s, 'p2', 'Zombie Token')).toBe(3);
    expect(handSize(s, 'p1')).toBe(0);
    expect(handSize(s, 'p2')).toBe(0);
  });
  it('negative: a player with an empty hand makes none', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mass Wake'] }, p2: { hand: ['Test Card A'] }, defs: [WAKE, A] });
    const s = resolveAll(cast(s0, 'Test Mass Wake'));
    expect(tokens(s, 'p1', 'Zombie Token')).toBe(0);
    expect(tokens(s, 'p2', 'Zombie Token')).toBe(1);
  });
});

describe('CR 107.3a-b, 702.143a, 614.15: "Foretell {X}{X}{W}" and "If this spell was foretold, create X of those tokens instead."', () => {
  const HOST = card('Test Star Host', 'Sorcery', 'Create a 4/4 white Angel Warrior creature token with flying and vigilance. If this spell was foretold, create X of those tokens instead.\nForetell {X}{X}{W}', '{3}{W}{W}', undefined, ['W']);
  const plains = Array(7).fill('Plains') as string[];
  const board = (): GameState => scenario([], { p1: { hand: ['Test Star Host'], battlefield: plains }, p2: {}, defs: [HOST] });
  const special = (s: GameState) => legalActions(s, 'p1').find((a) => a.kind === 'special' && a.object !== undefined && nameOf(s, a.object) === 'Test Star Host')?.action;
  const foretoldCast = (x: number): GameState => {
    let s = board();
    s = drive(act(s, special(s)!));
    s = advanceTo(advanceTo(s, s.turn.number + 2, 'main1'), s.turn.number + 2, 'main1');
    const a = legalActions(s, 'p1').find((l) => l.kind === 'cast' && l.object !== undefined && (l.action as { method?: string }).method === 'foretell')!.action;
    return resolveAll(drive(act(s, a), { x: [x] }));
  };
  it('is automated', () => expect(full(HOST)).toBe(true));
  it('cast from the hand for its mana cost: one Angel Warrior', () => {
    expect(tokens(resolveAll(cast(board(), 'Test Star Host')), 'p1', 'Angel Warrior Token')).toBe(1);
  });
  it('cast from exile for its foretell cost with X = 2 (pays {4}{W}): two Angel Warriors; X = 3 makes three', () => {
    expect(tokens(foretoldCast(2), 'p1', 'Angel Warrior Token')).toBe(2);
    expect(tokens(foretoldCast(3), 'p1', 'Angel Warrior Token')).toBe(3);
  });
});

describe('CR 121.1, 122.1, 608.2h, 400.7: "{2}, Sacrifice ~: Draw a card, then draw an additional card for each quest counter on ~." (the counters it had as it left)', () => {
  const BOT = card('Test Quest Bot', 'Artifact Creature — Robot', '{2}, Sacrifice ~: Draw a card, then draw an additional card for each quest counter on ~.', '{0}', ['1', '1']);
  const run = (n: number): { drew: number } => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Quest Bot', counters: n > 0 ? { quest: n } : {} }, 'Plains', 'Plains'] }, p2: {}, defs: [BOT] });
    const lib = s.zones.library.p1!.length;
    s = drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Quest Bot', 'battlefield'), ability: 'p:0:0' }));
    s = resolveAll(s);
    return { drew: lib - s.zones.library.p1!.length };
  };
  it('is automated', () => expect(full(BOT)).toBe(true));
  it('with two quest counters: one card, then two more (three in all)', () => expect(run(2).drew).toBe(3));
  it('negative: with no quest counter only the first card is drawn', () => expect(run(0).drew).toBe(1));
});

describe('CR 119.3, 122.1, 608.2h, 400.7: "{T}, Put a soul counter on ~: ... Then you lose 3 life for each soul counter on ~." (counted as it resolves)', () => {
  const ALTAR = card('Test Soul Altar', 'Artifact', '{T}, Put a soul counter on ~: You gain 1 life. Then you lose 3 life for each soul counter on ~.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target artifact.');
  const start = (soul: number): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Soul Altar', counters: soul > 0 ? { soul } : {} }] }, p2: { hand: ['Test Smite'], battlefield: ['Plains'] }, defs: [ALTAR, SMITE] });
  const activate = (s: GameState): GameState => drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Soul Altar', 'battlefield'), ability: 'p:0:0' }));
  it('is automated', () => expect(full(ALTAR)).toBe(true));
  it('one soul counter already there, one put as the cost: 3 x 2 = 6 life lost (and 1 gained first)', () => {
    const s = resolveAll(activate(start(1)));
    expect(lifeOf(s)).toBe(20 + 1 - 6);
  });
  it('first activation (counter put as the cost): 3 life lost', () => {
    expect(lifeOf(resolveAll(activate(start(0))))).toBe(20 + 1 - 3);
  });
  it('the altar destroyed in response: the count is what it had as it left the battlefield (two counters, six life)', () => {
    let s = activate(start(1));
    s = drive(act({ ...s }, { type: 'pass', player: 'p1' }));
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Smite', 'hand', 'p2') }), { targets: [[obj(find(s, 'Test Soul Altar', 'battlefield'))]] });
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Soul Altar')).toBe(false);
    expect(lifeOf(s)).toBe(20 + 1 - 6);
  });
});

describe('CR 707.10, 603.2: "Whenever you copy an instant spell, put a +1/+1 counter on ~." (a copy is not cast; only a copy of a spell)', () => {
  const MAGE = card('Test Storm Mage', 'Creature — Wizard', 'Whenever you copy an instant spell, put a +1/+1 counter on ~.', '{0}', ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const RITE = card('Test Rite', 'Sorcery', 'You gain 2 life.');
  const TWIN = card('Test Twin', 'Instant', 'Copy target spell. You may choose new targets for the copy.');
  const defs = [MAGE, SPARK, RITE, TWIN];
  const play = (spell: string, sorcerySpeed = false): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Storm Mage'], hand: [spell, 'Test Twin'] }, p2: {}, defs });
    s = cast(s, spell);
    if (sorcerySpeed) expect(s.zones.stack.length).toBe(1);
    expect(counters(s, 'Test Storm Mage', '+1/+1')).toBe(0); // casting the spell itself is not copying it
    s = cast(s, 'Test Twin', { targets: [[obj(find(s, spell, 'stack'))]] });
    return resolveAll(s);
  };
  it('is automated', () => expect(full(MAGE)).toBe(true));
  it('a copy of an instant spell puts a +1/+1 counter on the Mage', () => expect(counters(play('Test Spark'), 'Test Storm Mage', '+1/+1')).toBe(1));
  it('negative: a copy of a sorcery spell does not', () => expect(counters(play('Test Rite', true), 'Test Storm Mage', '+1/+1')).toBe(0));
  it('negative: casting an instant spell (no copy) does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Storm Mage'], hand: ['Test Spark'] }, p2: {}, defs });
    s = resolveAll(cast(s, 'Test Spark'));
    expect(counters(s, 'Test Storm Mage', '+1/+1')).toBe(0);
    void passBoth;
  });
});
