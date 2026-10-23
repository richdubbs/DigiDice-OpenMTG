/**
 * FAST5X E19: the mana spent to cast a spell and the mana pool, played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 601.2h, 207.2c  opus: "if four or more mana was spent to cast that spell, ... instead" (the triggering spell's mana, fixed when it was cast)
 *   CR 614.15          "Y. If C, X instead." where X is another instruction: the condition is fixed before the ability triggers (render/self-replacement.ts)
 *   CR 603.4           "if at least four mana was spent to cast it": an intervening "if"
 *   CR 106.3           "mana from a Treasure": the subtypes of the mana's source as it produced it (a Treasure sacrificed for its mana is gone, CR 608.2h)
 *   CR 106.4, 500.5    "you don't lose unspent red mana as steps and phases end" (a static ability and a resolved effect "until end of turn", CR 514.2)
 *   CR 614.1           "if you would lose unspent mana, that mana becomes red instead"
 *   CR 106.4, 611.3a   "as long as you have three or more unspent mana"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const counters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const pool = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');
const hand = (s: GameState): number => s.zones.hand['p1']!.length;
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));

/** Answer the decisions in front of us until a player has priority (the first options of a choice). */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending;
    if (d.kind === 'chooseObjects') {
      // a Plains first (the discards keep the test's spells in hand)
      const opts = [...(d as { options: ObjectId[] }).options].sort((a, b) => Number(s.defs[s.objects[b]!.defId]!.name === 'Plains') - Number(s.defs[s.objects[a]!.defId]!.name === 'Plains'));
      s = answer(s, { kind: 'chooseObjects', ids: opts.slice(0, (d as { min: number }).min) });
    }
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = settle(s0);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s));
  return s;
}
const cast = (s: GameState, name: string): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }));
/** Activate the mana ability of a permanent of p1. */
function tapFor(s: GameState, id: ObjectId): GameState {
  const a = legal(s, 'p1', 'activate').find((y) => y.isMana && y.object === id);
  if (!a) throw new Error(`no mana ability of ${id}`);
  return settle(act(s, a.action));
}

const SPARK = card('Test Spark', 'Sorcery', 'You gain 1 life.', undefined, '{R}');
const BLAZE = card('Test Blaze', 'Sorcery', 'You gain 1 life.', undefined, '{3}{R}');
const HOARD = card('Test Hoard', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add {R}.');
const GROTTO = card('Test Grotto', 'Land — Cave', '{T}: Add {C}.');
const BRUTE = card('Test Brute', 'Creature — Orc Warrior', 'Whenever you cast an instant or sorcery spell, put a +1/+1 counter on this creature. If four or more mana was spent to cast that spell, put two +1/+1 counters on this creature instead.', ['1', '1']);
const WHALE = card('Test Whale', 'Creature — Whale', 'Whenever you cast an instant or sorcery spell, this creature gets +2/+0 until end of turn. If four or more mana was spent to cast that spell, put three +1/+1 counters on this creature instead.', ['1', '1']);
const SAGE = card('Test Sage', 'Creature — Elf Wizard', 'Whenever you cast an instant or sorcery spell, draw a card. Then discard a card unless four or more mana was spent to cast that spell.', ['1', '1']);
const BOMB = card('Test Bomb', 'Creature — Elemental', 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, you gain 2 life.', ['1', '1']);
const MISER = card('Test Miser', 'Creature — Dragon', 'Whenever you cast a spell, if mana from a Treasure was spent to cast it, you gain 3 life.', ['2', '2']);
const COLONY = card('Test Colony', 'Enchantment', 'When this enchantment enters, create a 1/1 black Bat creature token with flying for each mana from a Cave spent to cast it.', undefined, '{2}');
const BATTERY = card('Test Battery', 'Creature — Human', "You don't lose unspent red mana as steps and phases end.", ['2', '2']);
const KINDLE = card('Test Kindle', 'Sorcery', "Add {R}{R}. Until end of turn, you don't lose unspent red mana as steps and phases end.");
const PHOENIX = card('Test Phoenix', 'Creature — Human Noble', 'If you would lose unspent mana, that mana becomes red instead.\nThis creature has flying as long as you have three or more unspent mana.', ['2', '2']);

const DEFS = [SPARK, BLAZE, HOARD, GROTTO, BRUTE, WHALE, SAGE, BOMB, MISER, COLONY, BATTERY, KINDLE, PHOENIX];
const LANDS = ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'];

describe('the cards are automated', () => {
  it('every synthetic card is fully understood (experimental E19 templates cap a card at partial: only the parse is checked there)', () => {
    for (const d of [SPARK, BLAZE, HOARD, GROTTO, BRUTE, WHALE, BOMB, MISER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
    for (const d of [SAGE, COLONY, BATTERY, KINDLE, PHOENIX]) expect(d.automation.autoRatio, `${d.name}: ${JSON.stringify(d.automation)}`).toBe(1);
  });
});

describe('CR 601.2h, 207.2c: opus, the mana spent to cast the triggering spell', () => {
  const board = (who: string): GameState => scenario(['Mountain'], { p1: { hand: ['Test Spark', 'Test Blaze', 'Plains', 'Plains'], battlefield: [who, ...LANDS] }, defs: DEFS });
  it('one mana: the base instruction; four mana: the other amount instead (CR 614.15)', () => {
    let s = board('Test Brute');
    const brute = find(s, 'Test Brute', 'battlefield');
    s = resolveAll(cast(s, 'Test Spark'));
    expect(counters(s, brute)).toBe(1);
    s = resolveAll(cast(s, 'Test Blaze'));
    expect(counters(s, brute)).toBe(3);
  });
  it('"instead" may replace another instruction: four mana gives counters and no +2/+0 (the condition is fixed before the ability triggers)', () => {
    let s = board('Test Whale');
    const whale = find(s, 'Test Whale', 'battlefield');
    s = resolveAll(cast(s, 'Test Spark'));
    expect([counters(s, whale), pt(s, whale)]).toEqual([0, '3/1']);
    s = resolveAll(cast(s, 'Test Blaze'));
    expect([counters(s, whale), pt(s, whale)]).toEqual([3, '6/4']); // 1/1 + three counters + the earlier +2/+0
  });
  it('"then discard a card unless four or more mana was spent": one mana draws and discards, four mana only draws', () => {
    let s = board('Test Sage');
    const h0 = hand(s);
    s = resolveAll(cast(s, 'Test Spark'));
    expect(hand(s)).toBe(h0 - 1); // the Spark left; one drawn, one discarded
    s = resolveAll(cast(s, 'Test Blaze'));
    expect(hand(s)).toBe(h0 - 1); // the Blaze left; one drawn, none discarded
  });
  it('CR 603.4: the intervening "if" — a one-mana spell does not trigger it, a four-mana spell does', () => {
    let s = board('Test Bomb');
    s = cast(s, 'Test Spark');
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(21);
    s = cast(s, 'Test Blaze');
    expect(s.zones.stack).toHaveLength(2);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20 + 1 + 1 + 2);
  });
});

describe('CR 106.3: mana from a source of a subtype, as the source was when it produced the mana', () => {
  it('"if mana from a Treasure was spent to cast it": the Treasure sacrificed for the mana counts (CR 608.2h); a Mountain does not', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Spark', 'Test Spark'], battlefield: ['Test Miser', 'Test Hoard', 'Mountain'] }, defs: DEFS });
    s = tapFor(s, find(s, 'Mountain', 'battlefield'));
    s = cast(s, 'Test Spark');
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(21);
    s = tapFor(s, find(s, 'Test Hoard', 'battlefield'));
    expect(s.players[0]!.manaPool[0]!.sourceSubtypes).toEqual(['Treasure']);
    s = cast(s, 'Test Spark');
    expect(s.zones.stack).toHaveLength(2);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(21 + 1 + 3);
  });
  it('"for each mana from a Cave spent to cast it": a Cave and a Mountain pay {2}, one token', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Colony'], battlefield: ['Test Grotto', 'Mountain'] }, defs: DEFS });
    s = tapFor(s, find(s, 'Test Grotto', 'battlefield'));
    s = tapFor(s, find(s, 'Mountain', 'battlefield'));
    s = resolveAll(cast(s, 'Test Colony'));
    const bats = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(bats).toHaveLength(1);
    expect(kws(s, bats[0]!)).toContain('flying');
  });
});

describe('CR 106.4, 500.5: unspent mana as steps and phases end', () => {
  it('"you don\'t lose unspent red mana": the red mana stays, the other mana is lost', () => {
    let s = scenario(['Mountain', 'Forest'], { p1: { battlefield: ['Test Battery', 'Mountain', 'Forest'] }, defs: DEFS });
    s = tapFor(s, find(s, 'Mountain', 'battlefield'));
    s = tapFor(s, find(s, 'Forest', 'battlefield'));
    expect(pool(s)).toBe('GR');
    s = advanceTo(s, 1, 'beginCombat');
    expect(pool(s)).toBe('R');
    s = advanceTo(s, 2, 'upkeep');
    expect(pool(s)).toBe('R'); // through the turn's end too, as long as the creature is there
  });
  it('a resolved "until end of turn" effect keeps red mana through the turn; it ends in the cleanup step and the mana is lost as that step ends (CR 514.2)', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Kindle'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Kindle'));
    expect(pool(s)).toBe('RR');
    s = advanceTo(s, 1, 'beginCombat');
    expect(pool(s)).toBe('RR');
    s = advanceTo(s, 2, 'upkeep');
    expect(pool(s)).toBe('');
  });
  it('CR 614.1: "if you would lose unspent mana, that mana becomes red instead"; and "as long as you have three or more unspent mana" (CR 611.3a)', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Phoenix', 'Forest', 'Forest', 'Forest'] }, defs: DEFS });
    const phoenix = find(s, 'Test Phoenix', 'battlefield');
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.defId === s.objects[find(s, 'Forest', 'battlefield')]!.defId)) s = tapFor(s, id);
    expect(pool(s)).toBe('GGG');
    expect(kws(s, phoenix)).toContain('flying');
    s = advanceTo(s, 1, 'beginCombat');
    expect(pool(s)).toBe('RRR');
    expect(kws(s, phoenix)).toContain('flying');
  });
  it('"+1/+1 for each unspent green mana you have" follows the mana pool as it changes (CR 613.4c, 106.4)', () => {
    const GROVE = card('Test Grove Spirit', 'Creature — Elemental', "You don't lose unspent green mana as steps and phases end.\nThis creature gets +1/+1 for each unspent green mana you have.", ['1', '1']);
    expect(GROVE.automation.autoRatio).toBe(1);
    let s = scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Grove Spirit', 'Forest', 'Forest', 'Mountain'] }, defs: [...DEFS, GROVE] });
    const spirit = find(s, 'Test Grove Spirit', 'battlefield');
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.controller === 'p1' && x !== spirit)) s = tapFor(s, id);
    expect([pool(s), pt(s, spirit)]).toEqual(['GGR', '3/3']);
    s = advanceTo(s, 1, 'beginCombat');
    expect([pool(s), pt(s, spirit)]).toEqual(['GG', '3/3']);
  });
  it('without such an effect the mana is lost (CR 500.5); with fewer than three unspent mana there is no flying', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Phoenix', 'Forest'] }, defs: DEFS });
    const phoenix = find(s, 'Test Phoenix', 'battlefield');
    s = tapFor(s, find(s, 'Forest', 'battlefield'));
    expect(kws(s, phoenix)).not.toContain('flying');
    const plain = scenario(['Forest'], { p1: { battlefield: ['Forest'] }, defs: DEFS });
    expect(pool(advanceTo(tapFor(plain, find(plain, 'Forest', 'battlefield')), 1, 'beginCombat'))).toBe('');
  });
});
