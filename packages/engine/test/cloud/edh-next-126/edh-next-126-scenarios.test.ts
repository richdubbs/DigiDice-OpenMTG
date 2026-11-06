/**
 * Must-finish round edh-next-126 (library, manifest and the rest; code edhn126): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (MagicCompRules 20260925.txt).
 *
 *   CR 608.2c, 608.2d, 119.4, 401.4, 701.24a   "Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your
 *                                              library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on
 *                                              top in any order." (Lim-Dûl's Vault; rulings 2007-09-16)
 *   CR 603.4, 701.23a, 303.4f, 303.4g, 202.3, 201.2   "Whenever an Aura you control enters, if you cast it, you may search your library for an Aura card with mana value less than or equal to
 *                                              that Aura and with a different name than each Aura you control, put that card onto the battlefield attached to ~, then shuffle."
 *                                              (Light-Paws, Emperor's Voice; ruling 2022-02-18)
 *   CR 601.2i, 608.2h, 107.3, 702.143a   "Draw X cards, where X is the greatest power among creatures you controlled as you cast this spell. If this spell was cast from exile, you
 *                                              gain twice X life." (Lifestream's Blessing; ruling 2025-06-06)
 *   CR 115.1, 601.2c, 608.2b, 208.1, 702.61a   "Choose any number of target creatures with equal toughness. Destroy the chosen creatures." (V.A.T.S.; rulings 2024-03-08)
 *   CR 701.40a, 701.40e, 603.6, 113.6k, 608.2f "When you cast this spell, up to two target players each manifest two cards from their hands. For each card manifested this way,
 *                                              you draw a card." (Kozilek, the Broken Reality; rulings 2024-06-07)
 */
import { describe, expect, it } from 'vitest';
import { answer, card, cast, full, lifeOf, named, obj, passBoth, resolveAll, scenario } from '../r4-cost/support';
import { put } from '../../m3/scenario';
import { getChars, legalActions, type GameState } from '../../../src/index';
import { act, advanceTo, drive, find } from '../r3-cost/support';

const top = (s: GameState, n: number, p = 'p1'): string[] => s.zones.library[p]!.slice(0, n).map((id) => s.objects[id]!.defId);

// ---- Lim-Dûl's Vault ------------------------------------------------------------------------------------------------------------------------------------
describe("CR 608.2c, 608.2d, 119.4: \"as many times as you choose, you may pay 1 life, put those cards on the bottom ..., then look at the top five\" and \"the last cards you looked at this way\"", () => {
  const VAULT = card('Test Vault', 'Instant', 'Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.', '{0}');
  const LIB = 'ABCDEFGHIJKLMNO'.split('').map((c) => `Test Card ${c}`);
  const FILLERS = LIB.map((n) => card(n, 'Sorcery', '', '{0}'));
  const defs = [VAULT, ...FILLERS];
  const board = (life?: number): GameState => scenario([], { defs, ...(life !== undefined ? { life } : {}), p1: { hand: ['Test Vault'], library: LIB } });
  it('is full', () => expect(full(VAULT)).toBe(true));
  it('ruling 2007-09-16: paying no life keeps the first five cards on top (the rest shuffled under them)', () => {
    const s = resolveAll(cast(board(), 'Test Vault'), { yes: [false] });
    expect(new Set(top(s, 5))).toEqual(new Set(LIB.slice(0, 5)));
    expect(lifeOf(s)).toBe(20);
    expect(s.zones.library.p1!.length).toBe(35);
  });
  it('paying once: the first five go to the bottom, the next five are the last cards looked at and end on top; 1 life paid', () => {
    const s = resolveAll(cast(board(), 'Test Vault'), { yes: [true, false] });
    expect(new Set(top(s, 5))).toEqual(new Set(LIB.slice(5, 10)));
    expect(lifeOf(s)).toBe(19);
  });
  it('paying twice: the third group of five ends on top; 2 life paid', () => {
    const s = resolveAll(cast(board(), 'Test Vault'), { yes: [true, true, false] });
    expect(new Set(top(s, 5))).toEqual(new Set(LIB.slice(10, 15)));
    expect(lifeOf(s)).toBe(18);
  });
  it('negative (CR 119.4): with 1 life, a second run can\'t pay and does nothing: the cards of the first run stay the last ones looked at', () => {
    const s = resolveAll(cast(board(1), 'Test Vault'), { yes: [true, true, false] });
    expect(new Set(top(s, 5))).toEqual(new Set(LIB.slice(5, 10)));
    expect(lifeOf(s)).toBe(0);
  });
  it('ruling 2007-09-16: with five or fewer cards in the library, every run looks at the same cards', () => {
    const s0 = board();
    const lib = s0.zones.library.p1!;
    for (const id of lib.slice(3)) delete s0.objects[id];
    s0.zones.library.p1 = lib.slice(0, 3);
    const s = resolveAll(cast(s0, 'Test Vault'), { yes: [true, true, false] });
    expect(new Set(top(s, 3))).toEqual(new Set(LIB.slice(0, 3)));
    expect(s.zones.library.p1!.length).toBe(3);
    expect(lifeOf(s)).toBe(18);
  });
});

// ---- Light-Paws, Emperor's Voice ----------------------------------------------------------------------------------------------------------------------------
describe('CR 603.4, 701.23a, 303.4f, 202.3, 201.2: "if you cast it, you may search for an Aura card with mana value less than or equal to that Aura and with a different name than each Aura you control, put that card onto the battlefield attached to ~"', () => {
  const PAWS = card('Test Paws', 'Legendary Creature — Fox Advisor', "Whenever an Aura you control enters, if you cast it, you may search your library for an Aura card with mana value less than or equal to that Aura and with a different name than each Aura you control, put that card onto the battlefield attached to Test Paws, then shuffle.", '{0}', ['2', '2']);
  const TWO = card('Test Two Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', '{1}{W}');
  const ONE = card('Test One Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+2.', '{W}');
  const BIG = card('Test Big Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+3.', '{2}{W}{W}');
  const ZERO = card('Test Zero Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has vigilance.', '{0}');
  const TWIN = card('Test Twin Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has lifelink.', '{W}{W}');
  const LAND = card('Test Land Aura', 'Enchantment — Aura', 'Enchant land\nEnchanted land is tapped.', '{W}');
  const defs = [PAWS, TWO, ONE, BIG, LAND, ZERO, TWIN];
  const board = (lib: string[]): GameState => scenario(['Plains'], { defs, p1: { hand: ['Test Two Aura'], battlefield: ['Test Paws', 'Plains', 'Plains', 'Plains'], library: lib } });
  /** Cast the Aura on Light-Paws and stop where the trigger asks whether to search (null: no such question). */
  const toTrigger = (s0: GameState): GameState => {
    const paws = named(s0, 'Test Paws')[0]!;
    let s = cast(s0, 'Test Two Aura', { targets: [[obj(paws)]] });
    for (let i = 0; i < 4 && s.pending?.kind === 'priority'; i++) s = passBoth(s);
    return s;
  };
  it('is full', () => expect(full(PAWS)).toBe(true));
  it('a cast Aura of mana value 2 finds an Aura of mana value 2 or less with another name; the same name and a greater mana value are not offered; it enters attached to ~', () => {
    const s0 = board(['Test Two Aura', 'Test Big Aura', 'Test One Aura', 'Test Twin Aura']);
    let s = toTrigger(s0);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as { options: string[] }).options.map((id) => s.objects[id]!.defId);
    expect(offered.sort()).toEqual(['Test One Aura', 'Test Twin Aura']); // mana value 1 and 2 (equal counts), another name
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: string[] }).options.find((id) => s.objects[id]!.defId === 'Test One Aura')!] }));
    const one = named(s, 'Test One Aura')[0]!;
    expect(s.objects[one]!.attachedTo).toBe(named(s, 'Test Paws')[0]);
  });
  it('negative (CR 603.4): the Aura it puts onto the battlefield was not cast, so it does not trigger again (no second search)', () => {
    const s0 = board(['Test One Aura', 'Test Zero Aura']);
    let s = toTrigger(s0);
    s = answer(s, { kind: 'yesNo', yes: true });
    const opts = (s.pending as { options: string[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: [opts.find((id) => s.objects[id]!.defId === 'Test One Aura')!] });
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack.length).toBe(0);
    expect(named(s, 'Test One Aura').length).toBe(1);
    expect(named(s, 'Test Zero Aura')).toEqual([]);
  });
  it('ruling 2022-02-18 (CR 303.4g): an Aura card found that can\'t be attached to ~ stays in the library', () => {
    const s0 = board(['Test Land Aura']);
    let s = toTrigger(s0);
    s = answer(s, { kind: 'yesNo', yes: true });
    const opts = (s.pending as { options: string[] }).options;
    expect(opts.map((id) => s.objects[id]!.defId)).toEqual(['Test Land Aura']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [opts[0]!] }));
    expect(named(s, 'Test Land Aura')).toEqual([]);
    expect(s.zones.library.p1!.some((id) => s.objects[id]!.defId === 'Test Land Aura')).toBe(true);
  });
});

// ---- Lifestream's Blessing ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 608.2h: "Draw X cards, where X is the greatest power among creatures you controlled as you cast this spell. If this spell was cast from exile, you gain twice X life."', () => {
  const BLESS = card('Test Lifestream', 'Instant', 'Draw X cards, where X is the greatest power among creatures you controlled as you cast this spell. If this spell was cast from exile, you gain twice X life.\nForetell {1}{G}', '{2}{G}');
  const SMALL = card('Test Small Beast', 'Creature — Beast', '', '{0}', ['3', '3']);
  const BIG = card('Test Big Beast', 'Creature — Beast', '', '{0}', ['5', '5']);
  const HUGE = card('Test Huge Beast', 'Creature — Beast', '', '{0}', ['7', '7']);
  const defs = [BLESS, SMALL, BIG, HUGE];
  const forests = Array(6).fill('Forest') as string[];
  const board = (extra: string[] = ['Test Small Beast', 'Test Big Beast'], p2: string[] = []): GameState => scenario(['Forest'], { defs, p1: { hand: ['Test Lifestream'], battlefield: [...forests, ...extra] }, p2: { battlefield: p2 } });
  const handSize = (s: GameState): number => s.zones.hand.p1!.length;
  /** Move a permanent to its owner's graveyard by hand (test setup only). */
  const bury = (s: GameState, id: string): void => {
    s.zones.battlefield = s.zones.battlefield.filter((x) => x !== id);
    s.objects[id]!.zone = 'graveyard';
    s.zones.graveyard[s.objects[id]!.owner]!.push(id);
  };
  it('is full', () => expect(full(BLESS)).toBe(true));
  it('cast from the hand: draws the greatest power among your creatures (5), gains no life (not cast from exile)', () => {
    const s0 = board();
    const h = handSize(s0);
    const s = resolveAll(cast(s0, 'Test Lifestream'));
    expect(handSize(s)).toBe(h - 1 + 5);
    expect(lifeOf(s)).toBe(20);
  });
  it('ruling 2025-06-06: X is read once, as the spell is cast: the 5-power creature leaving and a 7-power one arriving before it resolves change nothing', () => {
    const s0 = board();
    const h = handSize(s0);
    let s = cast(s0, 'Test Lifestream');
    bury(s, named(s, 'Test Big Beast')[0]!);
    put(s, 'p1', 'battlefield', 'Test Huge Beast');
    s = resolveAll(s);
    expect(handSize(s)).toBe(h - 1 + 5);
  });
  it('negative: an opponent\'s bigger creature is not counted; with no creature of yours, X is 0 and nothing is drawn', () => {
    const s0 = board([], ['Test Huge Beast']);
    const h = handSize(s0);
    const s = resolveAll(cast(s0, 'Test Lifestream'));
    expect(handSize(s)).toBe(h - 1);
    expect(lifeOf(s)).toBe(20);
  });
  it('CR 702.143a: foretold and cast from exile, it draws X and gains twice X life (X = 5: 10 life)', () => {
    let s = board();
    const special = legalActions(s, 'p1').find((a) => a.kind === 'special' && a.object !== undefined && s.objects[a.object]?.defId === 'Test Lifestream')!.action;
    s = drive(act(s, special));
    s = advanceTo(advanceTo(s, s.turn.number + 2, 'main1'), s.turn.number + 2, 'main1');
    const h = handSize(s);
    const a = legalActions(s, 'p1').find((l) => l.kind === 'cast' && l.object !== undefined && (l.action as { method?: string }).method === 'foretell')!.action;
    s = resolveAll(drive(act(s, a)));
    expect(handSize(s)).toBe(h + 5);
    expect(lifeOf(s)).toBe(30);
  });
});

// ---- V.A.T.S. -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 115.1, 601.2c, 608.2b, 208.1: "Choose any number of target creatures with equal toughness. Destroy the chosen creatures."', () => {
  const VATS = card('Test Targeting System', 'Instant', 'Split second\nChoose any number of target creatures with equal toughness. Destroy the chosen creatures.', '{0}');
  const TWO = card('Test Two Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const TWO_B = card('Test Tall Bear', 'Creature — Bear', '', '{0}', ['1', '2']);
  const THREE = card('Test Three Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
  const defs = [VATS, TWO, TWO_B, THREE];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Targeting System'], battlefield: ['Test Two Bear'] }, p2: { battlefield: ['Test Tall Bear', 'Test Three Bear'] } });
  const ids = (s: GameState) => ({ two: named(s, 'Test Two Bear')[0]!, tall: named(s, 'Test Tall Bear')[0]!, three: named(s, 'Test Three Bear')[0]! });
  const toTargets = (s0: GameState): GameState => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Targeting System', 'hand', 'p1') });
  it('is full', () => expect(full(VATS)).toBe(true));
  it('two creatures of toughness 2 (one of each player, different powers) are both destroyed; the toughness 3 creature is not', () => {
    const s0 = board();
    const { two, tall, three } = ids(s0);
    const s = resolveAll(cast(s0, 'Test Targeting System', { targets: [[obj(two), obj(tall)]] }));
    expect(s.objects[two]).toBeUndefined();
    expect(s.objects[tall]).toBeUndefined();
    expect(s.objects[three]?.zone).toBe('battlefield');
  });
  it('negative (CR 601.2c): targets of different toughness are refused as the spell is cast', () => {
    const s0 = board();
    const { two, three } = ids(s0);
    const s = toTargets(s0);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [obj(two), obj(three)] })).toThrow(/must all have the same toughness/);
  });
  it('ruling 2024-03-08 (CR 608.2b): if the targets no longer all have equal toughness as it resolves, none is destroyed', () => {
    const s0 = board();
    const { two, tall } = ids(s0);
    const s1 = cast(s0, 'Test Targeting System', { targets: [[obj(two), obj(tall)]] });
    s1.objects[tall]!.counters['+1/+1'] = 1; // the toughness of one target changes in response (test setup)
    const s = resolveAll(s1);
    expect(s.objects[two]?.zone).toBe('battlefield');
    expect(s.objects[tall]?.zone).toBe('battlefield');
  });
  it('ruling 2024-03-08: a single target is destroyed even if its toughness changed', () => {
    const s0 = board();
    const { three } = ids(s0);
    const s1 = cast(s0, 'Test Targeting System', { targets: [[obj(three)]] });
    s1.objects[three]!.counters['+1/+1'] = 2;
    const s = resolveAll(s1);
    expect(s.objects[three]).toBeUndefined();
  });
  it('CR 702.61a: split second: while it is on the stack, the opponent has no spell or non-mana ability to use', () => {
    const s0 = board();
    const { two } = ids(s0);
    const s1 = cast(s0, 'Test Targeting System', { targets: [[obj(two)]] });
    expect(s1.zones.stack.length).toBe(1);
    expect(legalActions(s1, s1.pending!.player).filter((a) => a.kind === 'cast' || (a.kind === 'activate' && (a as { isMana?: boolean }).isMana !== true))).toEqual([]);
  });
});

// ---- Kozilek, the Broken Reality ----------------------------------------------------------------------------------------------------------------------------
describe('CR 701.40a, 603.6, 608.2f: "When you cast this spell, up to two target players each manifest two cards from their hands. For each card manifested this way, you draw a card."', () => {
  const KOZ = card('Test Broken Titan', 'Legendary Creature — Eldrazi', 'When you cast this spell, up to two target players each manifest two cards from their hands. For each card manifested this way, you draw a card.\nOther colorless creatures you control get +3/+2.', '{0}', ['9', '9']);
  const A = card('Test Card Alpha', 'Sorcery', '', '{1}');
  const B = card('Test Card Beta', 'Sorcery', '', '{1}');
  const defs = [KOZ, A, B];
  const P1 = { kind: 'player' as const, id: 'p1' as const };
  const P2t = { kind: 'player' as const, id: 'p2' as const };
  const board = (p1Hand: string[], p2Hand: string[]): GameState => scenario([], { defs, p1: { hand: ['Test Broken Titan', ...p1Hand] }, p2: { hand: p2Hand } });
  const faceDown = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.faceDown && s.objects[id]!.controller === p);
  it('is full', () => expect(full(KOZ)).toBe(true));
  it('two target players: the opponent manifests two of three cards, you manifest the only card you have (ruling: one card); you draw three; your colorless face-down creature gets +3/+2', () => {
    const s0 = board(['Test Card Alpha'], ['Test Card Alpha', 'Test Card Beta', 'Test Card Beta']);
    const lib = s0.zones.library.p1!.length;
    const s = resolveAll(cast(s0, 'Test Broken Titan', { targets: [[P2t, P1]] }));
    expect(faceDown(s, 'p2').length).toBe(2);
    expect(faceDown(s, 'p1').length).toBe(1);
    expect(s.zones.hand.p2!.length).toBe(1);
    expect(lib - s.zones.library.p1!.length).toBe(3);
    expect(named(s, 'Test Broken Titan').length).toBe(1);
    const mine = faceDown(s, 'p1')[0]!;
    expect([getChars(s, mine)!.power, getChars(s, mine)!.toughness]).toEqual(['5', '4']);
    const theirs = faceDown(s, 'p2')[0]!;
    expect([getChars(s, theirs)!.power, getChars(s, theirs)!.toughness]).toEqual(['2', '2']);
  });
  it('ruling 2024-06-07: the trigger resolves before ~ and still resolves if ~ left the stack in response', () => {
    const s0 = board([], ['Test Card Alpha', 'Test Card Beta']);
    const s1 = cast(s0, 'Test Broken Titan', { targets: [[P2t]] });
    expect(s1.zones.stack.length).toBe(2);
    const titan = s1.zones.stack.find((id) => s1.objects[id]!.defId === 'Test Broken Titan')!;
    s1.zones.stack = s1.zones.stack.filter((id) => id !== titan);
    s1.objects[titan]!.zone = 'graveyard';
    s1.zones.graveyard.p1!.push(titan);
    const lib = s1.zones.library.p1!.length;
    const s = resolveAll(s1);
    expect(faceDown(s, 'p2').length).toBe(2);
    expect(lib - s.zones.library.p1!.length).toBe(2);
  });
  it('negative: with no target player nothing is manifested and nothing is drawn; a player with an empty hand manifests nothing', () => {
    const s0 = board([], []);
    const lib = s0.zones.library.p1!.length;
    const s = resolveAll(cast(s0, 'Test Broken Titan', { targets: [[P2t]] }));
    expect(faceDown(s, 'p2').length).toBe(0);
    expect(lib - s.zones.library.p1!.length).toBe(0);
    const none = resolveAll(cast(board(['Test Card Alpha'], ['Test Card Beta']), 'Test Broken Titan', { targets: [[]] }));
    expect(none.zones.battlefield.filter((id) => none.objects[id]!.faceDown).length).toBe(0);
  });
});
