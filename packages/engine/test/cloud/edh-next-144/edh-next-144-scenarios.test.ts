/**
 * Must-finish round edh-next-144 (library, draw and search; code edhn144): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (MagicCompRules 20260925.txt).
 *
 *   CR 608.2c, 400.7, 701.23a   "When this creature enters, you may search your library for an artifact card, reveal it, then shuffle. Put that card into your hand if you control an
 *                               Assassin. Otherwise, put that card on top of your library." (Loyal Inventor)
 *   CR 608.2c, 608.2d, 701.20a, 107.3, 401.4   "Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand
 *                               and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand
 *                               and the rest on the bottom of your library in a random order." (Green Sun's Twilight; ruling 2023-02-04)
 *   CR 614.12a, 119.1, 607.2d   "As this enchantment enters, note your life total. At the beginning of your upkeep, draw a card if your life total is greater than or equal to the last
 *                               noted life total for this enchantment. Then note your life total." (Sigarda's Splendor; ruling 2021-09-24)
 *   CR 701.20a, 121.2, 603.2, 607.2   "Reveal the first card you draw on each of your turns. Whenever you reveal a land card this way, draw a card. Whenever you reveal a nonland card
 *                               this way, Keranos deals 3 damage to any target." (Keranos, God of Storms; ruling 2014-04-26) and "Reveal the first card you draw each turn. ..." (Primitive Etchings)
 *   CR 601.2b, 701.4a, 614.15, 608.2h   "As an additional cost to cast this spell, you may reveal a Dragon card from your hand or choose a Dragon you control. Dragon's Fire deals 3 damage to
 *                               target creature or planeswalker. If you revealed a Dragon card or chose a Dragon as you cast this spell, Dragon's Fire deals damage equal to the power of
 *                               that card or creature instead." (Dragon's Fire; rulings 2021-07-23)
 *   CR 702.152a, 118.9, 601.2b, 601.2f, 903.8   "Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is equal to its mana cost. ... Blitz costs you pay cost {1}
 *                               less for each time you've cast your commander from the command zone this game." (Henzie "Toolbox" Torre; rulings 2022-04-29)
 *   CR 601.2, 118.9, 202.3, 109.2, 608.2c   "At the beginning of your upkeep, you may cast a permanent spell from your hand with mana value equal to 1 plus the greatest mana value among other
 *                               permanents you control without paying its mana cost. If you don't, scry 1." (In Search of Greatness; rulings 2021-02-05)
 *   CR 701.21a, 608.2c, 608.2d, 119.3   "Target opponent sacrifices a creature of their choice. If they can't, they lose 2 life and you draw a card. Then repeat this process for an
 *                               enchantment and a planeswalker." (Invoke Despair; rulings 2022-02-18)
 *   CR 701.23a, 303.4f, 201.2   "At the beginning of your upkeep, you may search your library for a Curse card that doesn't have the same name as a Curse attached to enchanted player, put it
 *                               onto the battlefield attached to that player, then shuffle." (Curse of Misfortunes; ruling 2011-01-22)
 *   CR 601.2b, 118.3, 205.2a, 608.2h   "{T}, Sacrifice up to three permanents: If there were three or more card types among the sacrificed permanents, each opponent loses 3 life, you
 *                               gain 3 life, and you draw three cards." (Baba Lysaga, Night Witch; rulings 2022-06-10)
 *   CR 701.21a, 701.20a, 202.3, 608.2h   "At the beginning of your end step, you may sacrifice another creature. If you do, reveal cards from the top of your library until you reveal a
 *                               nonlegendary creature card with lesser mana value, put it onto the battlefield, then put the rest on the bottom of your library in a random order." (Kethek)
 */
import { describe, expect, it } from 'vitest';
import { advanceTo, answer, card, cast, drive, full, lifeOf, named, passBoth, resolveAll, scenario } from '../r4-cost/support';
import { act, pass } from '../../m3/scenario';
import { answerUntilPriority, card as cmdCard, commanderRec, commanderScenario, find as cmdFind, findAll, forests, legend, pass as cmdPass, tweak } from '../../m11/rules/helpers';
import { applyAction, compileCard, getChars, type OracleCard } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { logHas } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import type { GameState } from '../../../src/index';

const top = (s: GameState, n: number, p = 'p1'): string[] => s.zones.library[p]!.slice(0, n).map((id) => s.objects[id]!.defId);
const hand = (s: GameState, p = 'p1'): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);

// ---- Loyal Inventor ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 400.7: "Put that card into your hand if you control an Assassin. Otherwise, put that card on top of your library."', () => {
  const INV = card('Test Inventor', 'Creature — Human Artificer', 'Vigilance\nWhen this creature enters, you may search your library for an artifact card, reveal it, then shuffle. Put that card into your hand if you control an Assassin. Otherwise, put that card on top of your library.', '{0}', ['2', '3']);
  const ASSN = card('Test Assassin', 'Creature — Human Assassin', '', '{0}', ['1', '1']);
  const RELIC = card('Test Relic', 'Artifact', '', '{0}');
  const FILL = ['A', 'B', 'C', 'D', 'E'].map((c) => card(`Test Filler ${c}`, 'Sorcery', '', '{0}'));
  const defs = [INV, ASSN, RELIC, ...FILL];
  const LIB = ['Test Filler A', 'Test Filler B', 'Test Relic', 'Test Filler C', 'Test Filler D', 'Test Filler E'];
  const board = (bf: string[], p2bf: string[] = []): GameState => scenario([], { defs, p1: { hand: ['Test Inventor'], battlefield: bf, library: LIB }, p2: { battlefield: p2bf } });
  const pick = (s: GameState): GameState => {
    const relic = s.zones.library.p1!.find((id) => s.objects[id]!.defId === 'Test Relic')!;
    let t = cast(s, 'Test Inventor');
    t = resolveAll(t, { yes: [true], objects: [[relic]] });
    return t;
  };
  it('is full', () => expect(full(INV)).toBe(true));
  it('with an Assassin you control, the found artifact card goes to your hand', () => {
    const s = pick(board(['Test Assassin']));
    expect(hand(s)).toContain('Test Relic');
    expect(top(s, 40)).not.toContain('Test Relic');
  });
  it('negative: with no Assassin, the found artifact card goes on top of your library (after the shuffle)', () => {
    const s = pick(board([]));
    expect(hand(s)).not.toContain('Test Relic');
    expect(top(s, 1)).toEqual(['Test Relic']);
  });
  it('negative: an opponent\'s Assassin does not count ("you control")', () => {
    const s = pick(board([], ['Test Assassin']));
    expect(hand(s)).not.toContain('Test Relic');
    expect(top(s, 1)).toEqual(['Test Relic']);
  });
  it('negative: declining the search moves nothing', () => {
    const s0 = board(['Test Assassin']);
    let s = cast(s0, 'Test Inventor');
    s = resolveAll(s, { yes: [false] });
    expect(hand(s)).not.toContain('Test Relic');
    expect(s.zones.library.p1!.length).toBe(s0.zones.library.p1!.length);
    expect(named(s, 'Test Inventor').length).toBe(1);
  });
});

// ---- Green Sun's Twilight ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 608.2d, 107.3: "Choose a creature card and/or a land card from among them. ... If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand"', () => {
  const GST = card('Test Twilight', 'Sorcery', 'Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.', '{X}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const CUB = card('Test Cub', 'Creature — Bear', '', '{G}', ['1', '1']);
  const GROVE = card('Test Grove', 'Land', '');
  const ARBOR = card('Test Arbor', 'Land Creature — Forest Dryad', '', '', ['1', '1']);
  const FILL = ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => card(`Test Filler ${c}`, 'Sorcery', '', '{0}'));
  const defs = [GST, BEAR, CUB, GROVE, ARBOR, ...FILL];
  const lands = (n: number): string[] => Array(n).fill('Plains') as string[];
  const board = (lib: string[], x: number): GameState => scenario(['Plains'], { defs, p1: { hand: ['Test Twilight'], battlefield: lands(x), library: lib } });
  const id = (s: GameState, name: string): string => s.zones.library.p1!.find((i) => s.objects[i]!.defId === name)!;
  /** Cast with X and stop at the first choice of the resolution. */
  const toChoice = (s0: GameState, x: number): GameState => {
    let s = cast(s0, 'Test Twilight', { x: [x] });
    for (let k = 0; k < 4 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; k++) s = passBoth(s);
    return s;
  };
  const options = (s: GameState): string[] => (s.pending as { options: string[] }).options.map((i) => s.objects[i]!.defId).sort();
  it('is full', () => expect(full(GST)).toBe(true));
  it('X = 2: three cards are revealed; a creature card and a land card go to your hand, the third to the bottom', () => {
    const s0 = board(['Test Bear', 'Test Grove', 'Test Filler A', 'Test Filler B'], 2);
    let s = toChoice(s0, 2);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(options(s)).toEqual(['Test Bear']);
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Bear')] });
    expect(options(s)).toEqual(['Test Grove']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Grove')] }));
    expect(hand(s).sort()).toEqual(['Test Bear', 'Test Grove']);
    expect(top(s, 1)).toEqual(['Test Filler B']);
    expect(s.zones.library.p1!.slice(-1).map((i) => s.objects[i]!.defId)).toEqual(['Test Filler A']);
  });
  it('negative ("a creature card and/or a land card"): two creature cards can never both be chosen; the second choice offers land cards only', () => {
    const s0 = board(['Test Bear', 'Test Cub', 'Test Filler A'], 2);
    let s = toChoice(s0, 2);
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Bear')] });
    expect(s.pending?.kind === 'chooseObjects' ? options(s) : []).toEqual([]);
    s = resolveAll(s);
    expect(hand(s)).toEqual(['Test Bear']);
  });
  it('a land creature card is either the creature card or the land card, never both: chosen as the creature, the land choice offers the other land', () => {
    const s0 = board(['Test Arbor', 'Test Grove', 'Test Filler A'], 2);
    let s = toChoice(s0, 2);
    expect(options(s)).toEqual(['Test Arbor']);
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Arbor')] });
    expect(options(s)).toEqual(['Test Grove']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Grove')] }));
    expect(hand(s).sort()).toEqual(['Test Arbor', 'Test Grove']);
  });
  it('choosing nothing puts every revealed card on the bottom', () => {
    const s0 = board(['Test Bear', 'Test Grove', 'Test Filler A', 'Test Filler B'], 2);
    let s = toChoice(s0, 2);
    s = resolveAll(answer(answer(s, { kind: 'chooseObjects', ids: [] }), { kind: 'chooseObjects', ids: [] }));
    expect(hand(s)).toEqual([]);
    expect(top(s, 1)).toEqual(['Test Filler B']);
  });
  it('ruling 2023-02-04: with X = 5 you may put both chosen cards onto the battlefield (together)', () => {
    const s0 = board(['Test Filler A', 'Test Bear', 'Test Filler B', 'Test Grove', 'Test Filler C', 'Test Filler D', 'Test Filler E'], 5);
    let s = toChoice(s0, 5);
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Bear')] });
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Grove')] });
    expect(s.pending?.kind).toBe('yesNo');
    s = resolveAll(answer(s, { kind: 'yesNo', yes: true }));
    expect(named(s, 'Test Bear').length).toBe(1);
    expect(named(s, 'Test Grove').length).toBe(1);
    expect(hand(s)).toEqual([]);
    expect(top(s, 1)).toEqual(['Test Filler E']);
  });
  it('ruling 2023-02-04: with X = 5, declining puts both into your hand (never one each way)', () => {
    const s0 = board(['Test Filler A', 'Test Bear', 'Test Filler B', 'Test Grove', 'Test Filler C', 'Test Filler D', 'Test Filler E'], 5);
    let s = toChoice(s0, 5);
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Bear')] });
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Grove')] });
    s = resolveAll(answer(s, { kind: 'yesNo', yes: false }));
    expect(hand(s).sort()).toEqual(['Test Bear', 'Test Grove']);
    expect(named(s, 'Test Bear')).toEqual([]);
  });
  it('negative (X is 4): no choice of the battlefield is offered; the chosen cards go to your hand', () => {
    const s0 = board(['Test Filler A', 'Test Bear', 'Test Filler B', 'Test Grove', 'Test Filler C', 'Test Filler D'], 4);
    let s = toChoice(s0, 4);
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Bear')] });
    s = answer(s, { kind: 'chooseObjects', ids: [id(s, 'Test Grove')] });
    expect(s.pending?.kind).not.toBe('yesNo');
    s = resolveAll(s);
    expect(hand(s).sort()).toEqual(['Test Bear', 'Test Grove']);
    expect(top(s, 1)).toEqual(['Test Filler D']);
  });
});

// ---- Sigarda's Splendor -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 614.12a, 119.1, 607.2d: "As this enchantment enters, note your life total." and "draw a card if your life total is greater than or equal to the last noted life total for ~. Then note your life total."', () => {
  const SPL = card('Test Splendor', 'Enchantment', 'As this enchantment enters, note your life total.\nAt the beginning of your upkeep, draw a card if your life total is greater than or equal to the last noted life total for this enchantment. Then note your life total.\nWhenever you cast a white spell, you gain 1 life.', '{0}');
  const defs = [SPL];
  const setLife = (s0: GameState, n: number, p = 'p1'): GameState => {
    const s = structuredClone(s0);
    s.players.find((x) => x.id === p)!.life = n;
    return s;
  };
  const upkeep = (s0: GameState, turn: number): GameState => resolveAll(advanceTo(s0, turn, 'upkeep'));
  const played = (life?: number): GameState => {
    const s0 = scenario([], { defs, ...(life !== undefined ? { life } : {}), p1: { hand: ['Test Splendor'] } });
    return resolveAll(cast(s0, 'Test Splendor'));
  };
  const noted = (s: GameState): unknown => s.objects[named(s, 'Test Splendor')[0]!]!.links?.['notedLife'];
  it('is full', () => expect(full(SPL)).toBe(true));
  it('CR 614.12a: the life total is noted as it enters', () => {
    expect(noted(played())).toEqual({ values: ['20'] });
  });
  it('equal life total: you draw at your upkeep, and the life total is noted again', () => {
    const s0 = played();
    const before = s0.zones.hand.p1!.length;
    const s = upkeep(s0, 3);
    expect(s.zones.hand.p1!.length).toBe(before + 1);
    expect(noted(s)).toEqual({ values: ['20'] });
  });
  it('negative: a lower life total draws nothing; ruling 2021-09-24: the new (lower) life total is noted anyway', () => {
    const s0 = setLife(played(), 15);
    const before = s0.zones.hand.p1!.length;
    const s = upkeep(s0, 3);
    expect(s.zones.hand.p1!.length).toBe(before);
    expect(noted(s)).toEqual({ values: ['15'] });
  });
  it('after a lower note, gaining life back to at least that total draws at the next upkeep (the last noted total, not the first)', () => {
    let s = upkeep(setLife(played(), 15), 3);
    s = advanceTo(setLife(s, 16), 5, 'upkeep');
    const before = s.zones.hand.p1!.length;
    s = resolveAll(s);
    expect(s.zones.hand.p1!.length).toBe(before + 1);
    expect(noted(s)).toEqual({ values: ['16'] });
  });
  it('negative: an opponent\'s life total plays no part ("your life total")', () => {
    const s0 = setLife(played(), 30, 'p2');
    const s = upkeep(setLife(s0, 19), 3);
    expect(noted(s)).toEqual({ values: ['19'] });
    expect(lifeOf(s, 'p2')).toBe(30);
  });
});

// ---- Keranos, God of Storms ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a, 121.2, 607.2: "Reveal the first card you draw on each of your turns. Whenever you reveal a land card this way, draw a card. Whenever you reveal a nonland card this way, ~ deals 3 damage to any target."', () => {
  const KER = card('Test Storm God', 'Legendary Enchantment Creature — God', 'Indestructible\nAs long as your devotion to blue and red is less than seven, Test Storm God isn\'t a creature.\nReveal the first card you draw on each of your turns. Whenever you reveal a land card this way, draw a card. Whenever you reveal a nonland card this way, Test Storm God deals 3 damage to any target.', '{3}{U}{R}', ['6', '5']);
  const ETCH = card('Test Etchings', 'Enchantment', 'Reveal the first card you draw each turn. Whenever you reveal a creature card this way, draw a card.', '{0}');
  const PEEK = card('Test Peek', 'Instant', 'Draw a card.', '{0}');
  const GROVE = card('Test Grove', 'Land', '');
  const BOLT = card('Test Spark', 'Sorcery', '', '{R}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const FILL = ['A', 'B', 'C', 'D'].map((c) => card(`Test Filler ${c}`, 'Sorcery', '', '{0}'));
  const defs = [KER, ETCH, PEEK, GROVE, BOLT, BEAR, ...FILL];
  const P2 = { kind: 'player', id: 'p2' } as const;
  const board = (lib: string[], extra: Record<string, unknown> = {}): GameState => scenario([], { defs, p1: { battlefield: ['Test Storm God'], library: lib, hand: ['Test Peek'] }, ...extra });
  const drawStep = (s0: GameState, turn: number): GameState => advanceTo(s0, turn, 'draw');
  it('is full', () => expect(full(KER)).toBe(true));
  it('ruling 2014-04-26: a land card revealed this way draws another card (that second card is not revealed: only the first card of the turn)', () => {
    let s = drawStep(board(['Test Grove', 'Test Grove', 'Test Filler A']), 3);
    expect(s.zones.stack.length).toBe(1);
    s = resolveAll(s);
    expect(hand(s).filter((n) => n === 'Test Grove').length).toBe(2);
    expect(s.zones.stack.length).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('a nonland card revealed this way: ~ deals 3 damage to any target (the land trigger does not trigger)', () => {
    let s = drive(drawStep(board(['Test Spark', 'Test Filler A']), 3), { targets: [[P2]] });
    expect(s.zones.stack.length).toBe(1);
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(hand(s)).not.toContain('Test Filler A');
  });
  it('negative ("on each of your turns"): the first card you draw on an opponent\'s turn is not revealed and triggers nothing', () => {
    let s = pass(advanceTo(board(['Test Grove', 'Test Filler A']), 2, 'upkeep'));
    s = cast(s, 'Test Peek');
    s = resolveAll(s);
    expect(hand(s)).toContain('Test Grove');
    expect(hand(s)).not.toContain('Test Filler A');
    expect(s.zones.stack.length).toBe(0);
  });
  it('negative (CR 121.2): only the first card drawn in the turn: a second draw on your turn reveals nothing', () => {
    let s = resolveAll(drive(drawStep(board(['Test Filler B', 'Test Spark', 'Test Filler A']), 3), { targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(17);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Peek'));
    expect(hand(s)).toContain('Test Spark');
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative (CR 607.2): another player\'s draws are never revealed by ~', () => {
    let s = advanceTo(board([], { p2: { library: ['Test Spark', 'Test Filler A'] } }), 2, 'draw');
    expect(s.zones.stack.length).toBe(0);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('"each turn" (Primitive Etchings): the first card drawn on an opponent\'s turn is revealed too; a creature card draws another', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Etchings'], library: ['Test Bear', 'Test Filler A', 'Test Filler B'], hand: ['Test Peek'] } });
    let s = pass(advanceTo(s0, 2, 'upkeep'));
    s = resolveAll(cast(s, 'Test Peek'));
    expect(hand(s)).toContain('Test Bear');
    expect(hand(s)).toContain('Test Filler A');
  });
});

// ---- Dragon's Fire ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2b, 701.4a, 614.15: "you may reveal a Dragon card from your hand or choose a Dragon you control ... deals damage equal to the power of that card or creature instead"', () => {
  const FIRE = card('Test Wyrmfire', 'Instant', 'As an additional cost to cast this spell, you may reveal a Dragon card from your hand or choose a Dragon you control.\nTest Wyrmfire deals 3 damage to target creature or planeswalker. If you revealed a Dragon card or chose a Dragon as you cast this spell, Test Wyrmfire deals damage equal to the power of that card or creature instead.', '{0}');
  const WHELP = card('Test Whelp', 'Creature — Dragon', 'Flying', '{4}{R}', ['5', '5']);
  const DRAKE = card('Test Drake', 'Creature — Dragon', 'Flying', '{3}{R}', ['4', '4']);
  const NAMED = card("Test Dragon's Egg", 'Creature — Egg', '', '{2}', ['6', '6']);
  const HULK = card('Test Hulk', 'Creature — Giant', '', '{0}', ['10', '10']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [FIRE, WHELP, DRAKE, NAMED, HULK, DOOM];
  const board = (hand: string[], bf: string[] = []): GameState => scenario([], { defs, p1: { hand: ['Test Wyrmfire', ...hand], battlefield: bf }, p2: { battlefield: ['Test Hulk'] } });
  const dmg = (s: GameState): number => s.objects[named(s, 'Test Hulk')[0]!]!.damage ?? 0;
  const hulk = (s: GameState) => ({ kind: 'object', id: named(s, 'Test Hulk')[0]! }) as const;
  it('is full', () => expect(full(FIRE)).toBe(true));
  it('without the optional cost: 3 damage', () => {
    const s0 = board(['Test Whelp']);
    const s = resolveAll(cast(s0, 'Test Wyrmfire', { yes: [false], targets: [[hulk(s0)]] }));
    expect(dmg(s)).toBe(3);
  });
  it('a Dragon card revealed from your hand: damage equal to its power (5); the card stays in your hand', () => {
    const s0 = board(['Test Whelp']);
    const whelp = s0.zones.hand.p1!.find((i) => s0.objects[i]!.defId === 'Test Whelp')!;
    const s = resolveAll(cast(s0, 'Test Wyrmfire', { yes: [true], objects: [[whelp]], targets: [[hulk(s0)]] }));
    expect(dmg(s)).toBe(5);
    expect(hand(s)).toContain('Test Whelp');
  });
  it('a Dragon you control chosen: damage equal to its power as the spell resolves (4)', () => {
    const s0 = board([], ['Test Drake']);
    const drake = named(s0, 'Test Drake')[0]!;
    const s = resolveAll(cast(s0, 'Test Wyrmfire', { yes: [true], objects: [[drake]], targets: [[hulk(s0)]] }));
    expect(dmg(s)).toBe(4);
    expect(named(s, 'Test Drake')).toEqual([drake]);
  });
  it('ruling 2021-07-23: the chosen Dragon gone before the spell resolves: the power it had last on the battlefield', () => {
    const s0 = board(['Test Doom'], ['Test Drake']);
    const drake = named(s0, 'Test Drake')[0]!;
    let s = cast(s0, 'Test Wyrmfire', { yes: [true], objects: [[drake]], targets: [[hulk(s0)]] });
    s = cast(s, 'Test Doom', { targets: [[{ kind: 'object', id: drake }]] });
    s = resolveAll(s);
    expect(named(s, 'Test Drake')).toEqual([]);
    expect(dmg(s)).toBe(4);
  });
  it('ruling 2021-07-23: a card with "Dragon" in its name is no Dragon: it is never offered; with no Dragon at all, 3 damage', () => {
    const s0 = board(["Test Dragon's Egg"]);
    let s = cast(s0, 'Test Wyrmfire', { yes: [true], targets: [[hulk(s0)]] });
    s = resolveAll(s);
    expect(dmg(s)).toBe(3);
  });
});

// ---- Henzie "Toolbox" Torre --------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.152a, 118.9, 903.8: "Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is equal to its mana cost." and "Blitz costs you pay cost {1} less for each time you\'ve cast your commander"', () => {
  const HENZIE = cmdCard('Test Toolbox', '{B}{R}{G}', 'Legendary Creature — Devil Rogue', 'Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is equal to its mana cost. (You may choose to cast that spell for its blitz cost. If you do, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)\nBlitz costs you pay cost {1} less for each time you\'ve cast your commander from the command zone this game.', ['3', '3']);
  const BALOTH = cmdCard('Test Big Baloth', '{3}{G}', 'Creature — Beast', '', ['4', '4']);
  const BEAR = cmdCard('Test Small Bear', '{2}{G}', 'Creature — Bear', '', ['3', '3']);
  const SPELL = cmdCard('Test Big Growth', '{3}{G}', 'Sorcery', 'Draw a card.');
  const CMDR = legend('Test Captain', '{1}{G}', ['2', '2'], ['G']);
  const OTHER = legend('Test Other Captain', '{G}', ['1', '1'], ['G']);
  const board = (lands: number, hand: string[]): GameState => commanderScenario({ p1Commanders: [CMDR], p2Commanders: [OTHER], defs: [HENZIE, BALOTH, BEAR, SPELL], p1: { battlefield: [...forests(lands), 'Test Toolbox'], hand } });
  const blitz = (s: GameState, name: string): { state?: GameState; error?: string } => {
    const r = applyAction(s, { type: 'cast', player: 'p1', card: cmdFind(s, name, 'hand', 'p1'), method: 'blitz' });
    return r.error ? { error: r.error.message } : { state: answerUntilPriority(r.state) };
  };
  const settle = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = answerUntilPriority(cmdPass(cmdPass(s)));
    return s;
  };
  const toEndStep = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 80 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : s.pending?.kind === 'priority' ? cmdPass(s) : answerUntilPriority(s);
    }
    return s;
  };
  it('is full', () => expect(full(HENZIE)).toBe(true));
  it('CR 702.152a, 118.9: a creature spell of mana value 4 may be cast for its blitz cost, its mana cost: it has haste, is sacrificed at the next end step and its dies trigger draws', () => {
    const r = blitz(board(4, ['Test Big Baloth']), 'Test Big Baloth');
    expect(r.error).toBeUndefined();
    let s = settle(r.state!);
    const b = cmdFind(s, 'Test Big Baloth', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, b)!, 'haste')).toBe(true);
    const hand0 = s.zones.hand.p1!.length;
    s = settle(toEndStep(s));
    expect(findAll(s, 'Test Big Baloth', 'battlefield')).toHaveLength(0);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 1);
  });
  it('CR 400.7b, 611.3d: the blitz the permanent got as a spell stays: with Henzie gone, the creature still has haste', () => {
    let s = settle(blitz(board(4, ['Test Big Baloth']), 'Test Big Baloth').state!);
    const h = cmdFind(s, 'Test Toolbox', 'battlefield', 'p1');
    s = tweak(s, (t) => { t.zones.battlefield = t.zones.battlefield.filter((x) => x !== h); delete t.objects[h]; });
    expect(hasKeyword(getChars(s, cmdFind(s, 'Test Big Baloth', 'battlefield', 'p1'))!, 'haste')).toBe(true);
  });
  it('negative (CR 702.152a): cast for its mana cost, the creature has no haste (its blitz cost was not paid)', () => {
    const s0 = board(4, ['Test Big Baloth']);
    const r = applyAction(s0, { type: 'cast', player: 'p1', card: cmdFind(s0, 'Test Big Baloth', 'hand', 'p1') });
    expect(r.error).toBeUndefined();
    const s = settle(answerUntilPriority(r.state));
    expect(hasKeyword(getChars(s, cmdFind(s, 'Test Big Baloth', 'battlefield', 'p1'))!, 'haste')).toBe(false);
  });
  it('review finding (CR 702.152b): a creature with blitz of its own, cast for blitz with ~ out, draws ONE card when it dies (the granted blitz is not kept beside its own)', () => {
    const OWN = cmdCard('Test Own Blitzer', '{3}{G}', 'Creature — Devil', 'Blitz {1}{G} (If you cast this spell for its blitz cost, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)', ['4', '2']);
    const s0 = commanderScenario({ p1Commanders: [CMDR], p2Commanders: [OTHER], defs: [HENZIE, OWN], p1: { battlefield: [...forests(4), 'Test Toolbox'], hand: ['Test Own Blitzer'] } });
    const r = blitz(s0, 'Test Own Blitzer');
    expect(r.error).toBeUndefined();
    let s = settle(r.state!);
    const hand0 = s.zones.hand.p1!.length;
    s = settle(toEndStep(s));
    expect(findAll(s, 'Test Own Blitzer', 'battlefield')).toHaveLength(0);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 1);
  });
  it('negative: the blitz cost is the whole mana cost ({3}{G}): with three lands it can\'t be paid', () => {
    expect(blitz(board(3, ['Test Big Baloth']), 'Test Big Baloth').error).toBeDefined();
  });
  it('negative: a creature spell of mana value 3 has no blitz; nor has a noncreature spell of mana value 4', () => {
    expect(blitz(board(4, ['Test Small Bear']), 'Test Small Bear').error).toBeDefined();
    expect(blitz(board(4, ['Test Big Growth']), 'Test Big Growth').error).toBeDefined();
  });
  it('CR 903.8: with two casts of your commander from the command zone, the blitz cost is {2} less ({1}{G}: two lands pay it)', () => {
    const s0 = tweak(board(2, ['Test Big Baloth']), (t) => { commanderRec(t, 'p1', 'Test Captain').casts = 2; });
    const r = blitz(s0, 'Test Big Baloth');
    expect(r.error).toBeUndefined();
    const s = settle(r.state!);
    expect(findAll(s, 'Test Big Baloth', 'battlefield')).toHaveLength(1);
  });
  it('negative: the reduction is of blitz costs only: casting the same creature for its mana cost with two casts still needs four lands', () => {
    const s0 = tweak(board(2, ['Test Big Baloth']), (t) => { commanderRec(t, 'p1', 'Test Captain').casts = 2; });
    const r = applyAction(s0, { type: 'cast', player: 'p1', card: cmdFind(s0, 'Test Big Baloth', 'hand', 'p1') });
    expect(r.error).toBeDefined();
  });
});

// ---- In Search of Greatness -------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2, 118.9, 109.2: "you may cast a permanent spell from your hand with mana value equal to 1 plus the greatest mana value among other permanents you control without paying its mana cost. If you don\'t, scry 1."', () => {
  const ISOG = card('Test Greatness', 'Enchantment', "At the beginning of your upkeep, you may cast a permanent spell from your hand with mana value equal to 1 plus the greatest mana value among other permanents you control without paying its mana cost. If you don't, scry 1.", '{G}{G}{G}{G}');
  const TOTEM = card('Test Totem', 'Artifact', '', '{2}');
  const THREE = card('Test Three Bear', 'Creature — Bear', '', '{2}{G}', ['3', '3']);
  const TWO = card('Test Two Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const ONE = card('Test One Elf', 'Creature — Elf', '', '{G}', ['1', '1']);
  const FIVE = card('Test Five Beast', 'Creature — Beast', '', '{4}{G}', ['5', '5']);
  const SORC = card('Test Three Spell', 'Sorcery', 'Draw a card.', '{2}{G}');
  const defs = [ISOG, TOTEM, THREE, TWO, ONE, FIVE, SORC];
  const board = (bf: string[], hand: string[]): GameState => scenario(['Forest'], { defs, p1: { battlefield: ['Test Greatness', ...bf], hand } });
  const toChoice = (s0: GameState): GameState => advanceTo(s0, 3, 'upkeep');
  const offered = (s: GameState): string[] => (s.pending?.kind === 'chooseObjects' ? (s.pending as { options: string[] }).options.map((i) => s.objects[i]!.defId).sort() : []);
  it('is full', () => expect(full(ISOG)).toBe(true));
  it('with a mana value 2 artifact, only a permanent spell of mana value exactly 3 is offered (not 2, not a sorcery); cast free, no scry', () => {
    let s = toChoice(board(['Test Totem', 'Forest'], ['Test Three Bear', 'Test Two Bear', 'Test Three Spell']));
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Three Bear']);
    const bear = (s.pending as { options: string[] }).options[0]!;
    s = answer(s, { kind: 'chooseObjects', ids: [bear] });
    expect(s.pending?.kind).toBe('priority');
    s = resolveAll(s);
    expect(named(s, 'Test Three Bear').length).toBe(1);
    expect(s.log.filter((l) => /scr(y|ies)/i.test(l.text) && !/triggers:/.test(l.text)).map((l) => l.text)).toEqual([]);
  });
  it('ruling 2021-02-05: with only lands as other permanents (and ~ itself not counted), a spell of mana value 1 is offered', () => {
    let s = toChoice(board(['Forest'], ['Test One Elf', 'Test Five Beast']));
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test One Elf']);
  });
  it('negative: declining the cast scries 1', () => {
    let s = toChoice(board(['Test Totem'], ['Test Three Bear']));
    s = passBoth(s);
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.pending?.prompt ?? '').toMatch(/scry 1/i);
    s = resolveAll(drive(s));
    expect(hand(s)).toContain('Test Three Bear');
    expect(logHas(s, /scry/i)).toBe(true);
  });
});

// ---- Invoke Despair --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a, 608.2c: "Target opponent sacrifices a creature of their choice. If they can\'t, they lose 2 life and you draw a card. Then repeat this process for an enchantment and a planeswalker."', () => {
  const INV = card('Test Despair', 'Sorcery', "Target opponent sacrifices a creature of their choice. If they can't, they lose 2 life and you draw a card. Then repeat this process for an enchantment and a planeswalker.", '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const AURA = card('Test Field', 'Enchantment', '', '{1}{W}');
  const WALK = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{3}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '+1: You gain 1 life.', loyalty: '3', colors: [], keywords: [] } as OracleCard);
  const defs = [INV, BEAR, AURA, WALK];
  const P2 = { kind: 'player', id: 'p2' } as const;
  const run = (p2bf: (string | { name: string; counters: Record<string, number> })[], p1bf: string[] = []): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Despair'], battlefield: p1bf }, p2: { battlefield: p2bf } });
    return resolveAll(cast(s0, 'Test Despair', { targets: [[P2]] }));
  };
  const onBf = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId).sort();
  it('is full', () => expect(full(INV)).toBe(true));
  it('ruling 2022-02-18: the same opponent sacrifices one of each kind they have; for each kind they lack they lose 2 life and you draw', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Despair'] }, p2: { battlefield: ['Test Bear', 'Test Field'] } });
    const hand0 = s0.zones.hand.p1!.length - 1;
    const s = resolveAll(cast(s0, 'Test Despair', { targets: [[P2]] }));
    expect(onBf(s, 'p2')).toEqual([]);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 1);
  });
  it('ruling 2022-02-18: with nothing of any kind, three times 2 life and three cards', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Despair'] }, p2: {} });
    const hand0 = s0.zones.hand.p1!.length - 1;
    const s = resolveAll(cast(s0, 'Test Despair', { targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(14);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 3);
  });
  it('negative: your own permanents are never sacrificed, and the opponent who has all three loses no life', () => {
    const s = run(['Test Bear', 'Test Field', { name: 'Test Walker', counters: { loyalty: 3 } }], ['Test Bear', 'Test Field']);
    expect(onBf(s, 'p2')).toEqual([]);
    expect(onBf(s, 'p1')).toEqual(['Test Bear', 'Test Field']);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

// ---- Curse of Misfortunes --------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.23a, 303.4f, 201.2: "search your library for a Curse card that doesn\'t have the same name as a Curse attached to enchanted player, put it onto the battlefield attached to that player"', () => {
  const TEXT = "Enchant player\nAt the beginning of your upkeep, you may search your library for a Curse card that doesn't have the same name as a Curse attached to enchanted player, put it onto the battlefield attached to that player, then shuffle.";
  const MIS = card('Test Misfortunes', 'Enchantment — Aura Curse', TEXT, '{4}{B}');
  const CA = card('Test Curse of Gloom', 'Enchantment — Aura Curse', 'Enchant player', '{1}{B}');
  const CB = card('Test Curse of Dust', 'Enchantment — Aura Curse', 'Enchant player', '{1}{B}');
  const AURA = card('Test Plain Aura', 'Enchantment — Aura', 'Enchant player', '{1}{B}');
  const defs = [MIS, CA, CB, AURA];
  const board = (lib: string[], onP2: string[]): GameState => mpScenario({ players: 4, defs, zones: { p1: { battlefield: ['Test Misfortunes', ...onP2], library: lib } },
    setup: (t) => { for (const id of t.zones.battlefield) if (t.objects[id]!.controller === 'p1' && t.objects[id]!.defId !== 'Forest') t.objects[id]!.attachedTo = 'p2'; } });
  const attachedToP2 = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.attachedTo === 'p2').map((id) => s.objects[id]!.defId).sort();
  const toSearch = (s0: GameState): GameState => {
    let s = advanceTo(s0, 5, 'upkeep');
    for (let k = 0; k < 6 && s.pending?.kind === 'priority'; k++) s = pass(s);
    return answer(s, { kind: 'yesNo', yes: true });
  };
  const offered = (s: GameState): string[] => (s.pending as { options: string[] }).options.map((i) => s.objects[i]!.defId).sort();
  it('is full', () => expect(full(MIS)).toBe(true));
  it('ruling 2011-01-22: only Curse cards with a name no Curse on that player has are offered; the found one enters attached to the enchanted player', () => {
    let s = toSearch(board(['Test Misfortunes', 'Test Curse of Gloom', 'Test Curse of Dust', 'Test Plain Aura'], ['Test Curse of Dust']));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(offered(s)).toEqual(['Test Curse of Gloom']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: string[] }).options[0]!] }));
    expect(attachedToP2(s)).toEqual(['Test Curse of Dust', 'Test Curse of Gloom', 'Test Misfortunes']);
    expect(s.objects[named(s, 'Test Curse of Gloom')[0]!]!.controller).toBe('p1');
  });
  it('negative: a second copy of ~ is never offered (same name as a Curse on that player), nor an Aura that is no Curse', () => {
    const s = toSearch(board(['Test Misfortunes', 'Test Plain Aura'], []));
    expect(s.pending?.kind === 'chooseObjects' ? offered(s) : []).toEqual([]);
  });
});

// ---- Baba Lysaga, Night Witch ------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2b, 118.3, 205.2a, 608.2h: "{T}, Sacrifice up to three permanents: If there were three or more card types among the sacrificed permanents, ..."', () => {
  const BABA = card('Test Night Witch', 'Legendary Creature — Human Warlock', '{T}, Sacrifice up to three permanents: If there were three or more card types among the sacrificed permanents, each opponent loses 3 life, you gain 3 life, and you draw three cards.', '{2}{B}{G}', ['3', '3']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{2}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const FIELD = card('Test Field', 'Enchantment', '', '{1}{W}');
  const defs = [BABA, GOLEM, BEAR, FIELD];
  const board = (bf: string[]): GameState => scenario(['Forest'], { defs, p1: { battlefield: ['Test Night Witch', ...bf] } });
  const activate = (s0: GameState, sacs: string[]): GameState => {
    const all = sacs.map((n, k) => s0.zones.battlefield.filter((i) => s0.objects[i]!.defId === n && s0.objects[i]!.controller === 'p1')[sacs.slice(0, k).filter((m) => m === n).length]!);
    let s = act(s0, { type: 'activate', player: 'p1', source: named(s0, 'Test Night Witch')[0]!, ability: 'p:0:0' } as never);
    s = drive(s, { x: [sacs.length], objects: [all] });
    return resolveAll(s);
  };
  it('is full', () => expect(full(BABA)).toBe(true));
  it('ruling 2022-06-10: an artifact creature and a land are three card types (as they last existed): each opponent loses 3, you gain 3 and draw three', () => {
    const s0 = board(['Test Golem', 'Forest']);
    const hand0 = s0.zones.hand.p1!.length;
    const s = activate(s0, ['Test Golem', 'Forest']);
    expect(named(s, 'Test Golem')).toEqual([]);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 3);
  });
  it('three permanents of three card types work too', () => {
    const s = activate(board(['Test Bear', 'Test Field', 'Forest']), ['Test Bear', 'Test Field', 'Forest']);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative (ruling 2022-06-10): two creatures and a land are two card types: the permanents are sacrificed and nothing else happens', () => {
    const s = activate(board(['Test Bear', 'Test Golem', 'Forest']), ['Test Bear', 'Test Golem', 'Forest'].filter((n) => n !== 'Test Golem'));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(named(s, 'Test Bear')).toEqual([]);
  });
  it('negative ("up to three"): no more than three may be sacrificed; none at all is allowed and does nothing', () => {
    const s0 = board(['Test Bear', 'Test Golem', 'Test Field', 'Forest']);
    let s = act(s0, { type: 'activate', player: 'p1', source: named(s0, 'Test Night Witch')[0]!, ability: 'p:0:0' } as never);
    expect(s.pending?.kind).toBe('chooseNumber');
    expect((s.pending as { max: number }).max).toBe(3);
    s = resolveAll(drive(s, { x: [0] }));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(named(s, 'Test Bear').length).toBe(1);
  });
});

// ---- Kethek, Crucible Goliath -----------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a, 701.20a, 202.3, 608.2h: "you may sacrifice another creature. If you do, reveal cards ... until you reveal a nonlegendary creature card with lesser mana value, put it onto the battlefield"', () => {
  const KET = card('Test Goliath', 'Legendary Creature — Phyrexian Beast', 'At the beginning of your end step, you may sacrifice another creature. If you do, reveal cards from the top of your library until you reveal a nonlegendary creature card with lesser mana value, put it onto the battlefield, then put the rest on the bottom of your library in a random order.', '{1}{B}{R}{G}', ['6', '5']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{2}{G}', ['3', '3']);
  const BIG = card('Test Big Beast', 'Creature — Beast', '', '{4}{G}', ['5', '5']);
  const LEG = card('Test Legend Elf', 'Legendary Creature — Elf', '', '{G}', ['1', '1']);
  const ELF = card('Test Elf', 'Creature — Elf', '', '{1}', ['1', '1']);
  const SPELL = card('Test Spell', 'Sorcery', '', '{0}');
  const defs = [KET, OX, BIG, LEG, ELF, SPELL];
  const board = (lib: string[]): GameState => scenario([], { defs, p1: { battlefield: ['Test Goliath', 'Test Ox'], library: lib } });
  const toEnd = (s0: GameState): GameState => {
    let s = advanceTo(s0, 1, 'end');
    for (let k = 0; k < 4 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; k++) s = passBoth(s);
    return s;
  };
  it('is full', () => expect(full(KET)).toBe(true));
  it('sacrificing a mana value 3 creature: the first nonlegendary creature card of lesser mana value enters; the others revealed go to the bottom', () => {
    const s0 = board(['Test Big Beast', 'Test Spell', 'Test Legend Elf', 'Test Elf', 'Test Spell']);
    let s = toEnd(s0);
    const ox = named(s, 'Test Ox')[0]!;
    s = resolveAll(drive(s, { yes: [true], objects: [[ox]] }));
    expect(named(s, 'Test Ox')).toEqual([]);
    expect(named(s, 'Test Elf').length).toBe(1);
    expect(named(s, 'Test Legend Elf')).toEqual([]);
    expect(named(s, 'Test Big Beast')).toEqual([]);
    expect(top(s, 1)).toEqual(['Test Spell']);
    const bottom = s.zones.library.p1!.slice(-3).map((i) => s.objects[i]!.defId).sort();
    expect(bottom).toEqual(['Test Big Beast', 'Test Legend Elf', 'Test Spell']);
  });
  it('negative: ~ itself is never offered for the sacrifice ("another creature")', () => {
    let s = toEnd(board(['Test Elf']));
    s = drive(s, { yes: [true] });
    if (s.pending?.kind === 'chooseObjects') expect((s.pending as { options: string[] }).options.map((i) => s.objects[i]!.defId)).toEqual(['Test Ox']);
    expect(named(s, 'Test Goliath').length).toBe(1);
  });
  it('negative: declining the sacrifice reveals nothing', () => {
    const s0 = board(['Test Elf', 'Test Spell']);
    const s = resolveAll(drive(toEnd(s0), { yes: [false] }));
    expect(named(s, 'Test Ox').length).toBe(1);
    expect(top(s, 2)).toEqual(['Test Elf', 'Test Spell']);
  });
});
