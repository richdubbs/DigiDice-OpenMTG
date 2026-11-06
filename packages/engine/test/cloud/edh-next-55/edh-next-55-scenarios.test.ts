/**
 * Round edh-next-55 (Commander lane dice): the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * The dice are the state's seeded generator; each test reads the results rolled from the game's log and checks what the rules do with THAT result, over many seeds, so
 * every row of a table and both sides of every comparison are played (the negative cases are the rows and results that must do nothing).
 *
 *   CR 706.3a, 111.1, 706.2     "Roll a d20. 1-9 | Create a 1/1 red Goblin ... 10-19 | Create two of those tokens. 20 | Create three of those tokens." (Swarming Goblins)
 *   CR 706.3a, 614.1c, 611.2a   "Roll a d20. ... 20 | ... Until your next turn, creatures your opponents control enter tapped." (Cone of Cold)
 *   CR 706.3a, 701.23d          "... search ... for up to two basic land cards and reveal them, then roll a d20. 9 or less | ... 10-19 | ... 20+ | ..." (Druid of the Emerald Grove)
 *   CR 706.2, 608.2h            "Roll three six-sided dice. For each different result, create a 1/1 ... token." (Circuits Act)
 *   CR 706.2, 608.2d, 202.3     "Roll two six-sided dice. Return any number of cards with total mana value X or less from your graveyard to your hand, where X is the total of those results." (Pair o' Dice Lost)
 *   CR 706.2, 608.2h, 122.6     "Roll two d10 and choose one result. Return a creature card ... with a number of +1/+1 counters on it equal to that result. Then each opponent loses X life ..." (Grave Endeavor)
 *   CR 706.2, 701.23b           "Roll two d4 and choose one result. Create a number of 3/3 ... equal to that result. Then search ... a number of basic land cards equal to the other result" (Wild Endeavor)
 *   CR 706.2, 603.2c, 608.2h    "Whenever you roll a 3 or higher, ... If the roll was 4 or higher, ..." (Monoxa, Midway Manager)
 *   CR 706.2, 608.2h            "Roll a six-sided die. If the result is equal to or less than the number of Robots you control, ..." (Clowning Around)
 *   CR 706.3a, 115.1            "Choose target creature. Roll a six-sided die. 1 -- It has base toughness 1 ... 6 -- Exile it." (Six-Sided Die)
 *   CR 706.2, 120.3, 122.1      "Whenever equipped creature deals combat damage, roll a d12. If the result is greater than the damage dealt or the result is 12, double the number of +1/+1 counters" (Sword of Hours)
 *   CR 706.2, 208.1, 608.2c     "Whenever equipped creature attacks, roll a six-sided die. That creature gets +X/+0 ..., where X is the result. Then if it has the greatest power or is tied ..., draw a card." (Strength-Testing Hammer)
 *   CR 706.2, 603.2c            "Whenever you roll a die's highest natural result, draw a card." (Netherese Puzzle-Ward)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { activatedAbilities } from '../../../src/rules/abilities';
import { act, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const ptOf = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };

/** The natural results of the dice rolled, in order, from the game's log ("X rolls a d12: 7."), also for a roll that ignores dice. */
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const SEEDS = Array.from({ length: 40 }, (_, i) => `s${i}`);
type Script = { yes?: boolean; option?: (ids: { id: string; label: string }[]) => string; targets?: { kind: 'object' | 'player'; id: string }[]; objects?: (options: string[], min: number, max: number) => string[] };
/** Answer the decisions in front of us (payment automatic, `yes`, the first objects, the option `option` picks among the given ones, `targets`) until a player has priority. */
function settle(s0: GameState, o: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending as unknown as { kind: string; options: { id: string; label: string }[] & string[]; min: number; max: number; items: { id: string }[] };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.objects ? o.objects(p.options as unknown as string[], p.min, p.max) : (p.options as unknown as string[]).slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [o.option ? o.option(p.options as unknown as { id: string; label: string }[]) : (p.options as unknown as { id: string }[])[0]!.id] });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ?? [] } as never);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min } as never);
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, o: Script = {}): GameState => {
  let s = settle(s0, o);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, o);
  return s;
};
const cast = (s: GameState, name: string, o: Script = {}): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);
const tokens = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);
const names = (s: GameState, zone: 'hand' | 'graveyard', player = 'p1'): string[] => (s.zones[zone][player] ?? []).map((id) => s.defs[s.objects[id]!.defId]!.name);
const onBf = (s: GameState, name: string, player = 'p1'): ObjectId[] => findAll(s, name, 'battlefield', player);

// ---- Swarming Goblins ---------------------------------------------------------------------------------------------------------------------------------------------
const SWARM = card('Test Swarm', 'Creature — Goblin', 'When this creature enters, roll a d20.\n1-9 | Create a 1/1 red Goblin creature token.\n10-19 | Create two of those tokens.\n20 | Create three of those tokens.', { pt: ['2', '2'] });
describe('CR 706.3a, 111.1: a result row that makes "N of those tokens" makes the tokens an earlier row makes (Swarming Goblins)', () => {
  const play = (seed: string): { s: GameState; roll: number } => {
    const s0 = scenario([], { seed, defs: [SWARM], p1: { hand: ['Test Swarm'] } });
    const s = cast(s0, 'Test Swarm');
    return { s, roll: rolled(s)[0]! };
  };
  it('is fully automated', () => expect(SWARM.automation.level).toBe('full'));
  it('1-9 makes one 1/1 red Goblin, 10-19 two, 20 three: every row is played and makes the tokens of the first row', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const { s, roll } = play(seed);
      const want = roll <= 9 ? 1 : roll <= 19 ? 2 : 3;
      seen.add(want);
      const ts = tokens(s);
      expect(ts, `${seed} ${roll}`).toHaveLength(want);
      for (const t of ts) { expect(ptOf(s, t), seed).toEqual([1, 1]); expect(getChars(s, t)!.subtypes, seed).toContain('Goblin'); expect(getChars(s, t)!.colors, seed).toEqual(['R']); }
    }
    expect(seen.size, 'the seeds play more than one row').toBeGreaterThan(1);
  });
  it('the negative case: a table whose later row says "of those tokens" with no earlier row that makes tokens is not automated', () => {
    expect(card('Test Bad Swarm', 'Creature — Goblin', 'When this creature enters, roll a d20.\n1-9 | Draw a card.\n10-20 | Create two of those tokens.', { pt: ['2', '2'] }).automation.level).not.toBe('full');
  });
});

// ---- Cone of Cold -------------------------------------------------------------------------------------------------------------------------------------------------
const FROST = card('Test Frost', 'Sorcery', "Roll a d20.\n1-9 | Tap all creatures your opponents control.\n10-19 | Tap all creatures your opponents control. Those creatures don't untap during their controllers' next untap steps.\n20 | Tap all creatures your opponents control. Those creatures don't untap during their controllers' next untap steps. Until your next turn, creatures your opponents control enter tapped.");
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FLASH_BEAR = card('Test Flash Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'] });
describe('CR 614.1c, 611.2a: "Until your next turn, creatures your opponents control enter tapped." (Cone of Cold)', () => {
  const play = (seed: string): { s: GameState; roll: number } => {
    const s0 = scenario([], { seed, defs: [FROST, BEAR, FLASH_BEAR], p1: { hand: ['Test Frost'] }, p2: { hand: ['Test Flash Bear'], battlefield: ['Test Bear'] } });
    const s1 = cast(s0, 'Test Frost');
    return { s: s1, roll: rolled(s1)[0]! };
  };
  /** p2 casts a flash creature after the spell: is it tapped as it enters? */
  const flashIn = (s0: GameState): boolean => {
    let s = s0;
    for (let guard = 0; guard < 6 && s.pending?.player !== 'p2'; guard++) s = pass(s);
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Bear', 'hand', 'p2') }));
    const ids = onBf(s, 'Test Flash Bear', 'p2');
    expect(ids).toHaveLength(1);
    return s.objects[ids[0]!]!.tapped;
  };
  it('is fully automated', () => expect(FROST.automation.level).toBe('full'));
  it('every roll taps the opponent\'s creatures; only a 20 makes the creatures they put onto the battlefield enter tapped', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { s, roll } = play(seed);
      expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.tapped, `${seed} ${roll}`).toBe(true);
      if (roll === 20 || roll < 10) { seen.add(roll === 20 ? 'twenty' : 'low'); expect(flashIn(s), `${seed} ${roll}`).toBe(roll === 20); }
      if (seen.size === 2) break;
    }
    expect([...seen].sort(), 'the seeds play a 20 and a low roll').toEqual(['low', 'twenty']);
  });
});

// ---- Druid of the Emerald Grove ---------------------------------------------------------------------------------------------------------------------------------
const DRUID = card('Test Druid', 'Creature — Dwarf Druid', 'When this creature enters, search your library for up to two basic land cards and reveal them, then roll a d20.\n9 or less | Put those cards into your hand, then shuffle.\n10-19 | Put one of those cards onto the battlefield tapped and the other into your hand, then shuffle.\n20+ | Put those cards onto the battlefield tapped, then shuffle.', { pt: ['2', '2'] });
describe('CR 706.3a, 701.23d: "9 or less | ... 10-19 | ... 20+ | ..." after a search (Druid of the Emerald Grove)', () => {
  const play = (seed: string): { s: GameState; roll: number } => {
    const s0 = scenario([], { seed, defs: [DRUID], p1: { hand: ['Test Druid'] } });
    const s = cast(s0, 'Test Druid', { objects: (o, min, max) => o.slice(0, Math.max(min, Math.min(max, 2))) });
    return { s, roll: rolled(s)[0]! };
  };
  it('is fully automated', () => expect(DRUID.automation.level).toBe('full'));
  it('a roll of 9 or less puts both cards into the hand, 10-19 one onto the battlefield tapped and one into the hand, 20 both onto the battlefield tapped', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { s, roll } = play(seed);
      const lands = onBf(s, 'Plains');
      const tappedLands = lands.filter((id) => s.objects[id]!.tapped).length;
      const inHand = names(s, 'hand').filter((n) => n === 'Plains').length;
      const want = roll <= 9 ? { bf: 0, hand: 2 } : roll <= 19 ? { bf: 1, hand: 1 } : { bf: 2, hand: 0 };
      seen.add(`${want.bf}`);
      expect({ bf: lands.length, tapped: tappedLands, hand: inHand }, `${seed} ${roll}`).toEqual({ bf: want.bf, tapped: want.bf, hand: want.hand });
    }
    expect(seen.size, 'the seeds play all three rows').toBe(3);
  });
});

// ---- Circuits Act -------------------------------------------------------------------------------------------------------------------------------------------------
const CIRCUITS = card('Test Circuits', 'Sorcery', 'Roll three six-sided dice. For each different result, create a 1/1 white Clown Robot artifact creature token.');
describe('CR 706.2, 608.2h: "For each different result, create a 1/1 ... token." (Circuits Act)', () => {
  it('is fully automated', () => expect(CIRCUITS.automation.level).toBe('full'));
  it('one token for each different number the three dice show: three different numbers three tokens, a pair two, triples one', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400 && seen.size < 3; i++) {
      const s0 = scenario([], { seed: `c${i}`, defs: [CIRCUITS], p1: { hand: ['Test Circuits'] } });
      const s = cast(s0, 'Test Circuits');
      const dice = rolled(s);
      expect(dice, `c${i}`).toHaveLength(3);
      const want = new Set(dice).size;
      seen.add(want);
      expect(tokens(s), `c${i} ${dice}`).toHaveLength(want);
      for (const t of tokens(s)) expect(getChars(s, t)!.subtypes, `c${i}`).toEqual(expect.arrayContaining(['Clown', 'Robot']));
    }
    expect([...seen].sort(), 'one, two and three different results are all played').toEqual([1, 2, 3]);
  });
});

// ---- Pair o' Dice Lost --------------------------------------------------------------------------------------------------------------------------------------------
const PAIR = card('Test Pair', 'Instant', 'Roll two six-sided dice. Return any number of cards with total mana value X or less from your graveyard to your hand, where X is the total of those results. Exile Test Pair.');
const TWO = card('Test Two', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{1}{G}' });
const THREE = card('Test Three', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{2}{G}' });
const FOUR = card('Test Four', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{3}{G}' });
describe('CR 706.2, 608.2d, 202.3: "Return any number of cards with total mana value X or less ..., where X is the total of those results." (Pair o\' Dice Lost)', () => {
  const MV: Record<string, number> = { 'Test Two': 2, 'Test Three': 3, 'Test Four': 4 };
  const start = (seed: string): GameState => scenario([], { seed, defs: [PAIR, TWO, THREE, FOUR], p1: { hand: ['Test Pair'], graveyard: ['Test Two', 'Test Three', 'Test Four'] } });
  /** Cast it and, when asked which cards to return, pick the cards of `pick` (by name) that are offered. */
  const cast1 = (seed: string, pick: string[]): GameState => {
    const s0 = start(seed);
    const chosen = (o: string[]): string[] => o.filter((id) => pick.includes(s0.defs[s0.objects[id]!.defId]!.name));
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pair', 'hand', 'p1') }), { objects: chosen });
  };
  it('is fully automated', () => expect(PAIR.automation.level).toBe('full'));
  it('the cards chosen may total at most the sum of the two dice: the largest group that fits comes back and the spell is exiled either way; choosing none returns none', () => {
    let lowSeen = false;
    let highSeen = false;
    for (const seed of SEEDS) {
      const none = cast1(seed, []);
      const dice = rolled(none);
      expect(dice, seed).toHaveLength(2);
      const total = dice[0]! + dice[1]!;
      expect(names(none, 'hand').filter((n) => n in MV), seed).toEqual([]);
      // the cheapest cards first, as many as fit
      const fits: string[] = [];
      let sum = 0;
      for (const n of ['Test Two', 'Test Three', 'Test Four']) if (sum + MV[n]! <= total) { fits.push(n); sum += MV[n]!; }
      const s = cast1(seed, fits);
      expect(names(s, 'hand').filter((n) => n in MV).sort(), `${seed} total ${total}`).toEqual([...fits].sort());
      expect(names(s, 'graveyard').filter((n) => n in MV).sort(), seed).toEqual(['Test Two', 'Test Three', 'Test Four'].filter((n) => !fits.includes(n)).sort());
      if (total >= 9) { highSeen = true; expect(fits, seed).toHaveLength(3); } else lowSeen = true;
      expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Pair'), seed).toBe(true);
    }
    expect(lowSeen && highSeen, 'the seeds play a total under 9 and one of 9 or more').toBe(true);
  });
  it('the negative case: a group of cards whose total mana value is over the total of the dice is refused', () => {
    for (const seed of SEEDS) {
      const probe = cast1(seed, []);
      const total = rolled(probe).reduce((a, b) => a + b, 0);
      if (total >= 9) continue;
      const s0 = start(seed);
      let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pair', 'hand', 'p1') });
      for (let guard = 0; guard < 20 && s.pending?.kind !== 'chooseObjects'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : answer(s, { kind: 'payCost', auto: true });
      const d = s.pending as unknown as { id: string; player: string; options: string[] };
      expect(d.options).toHaveLength(3);
      const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.options } } as never);
      expect(r.error?.message, seed).toMatch(/break the limit/);
      return;
    }
    throw new Error('no seed with a total under 9');
  });
});

// ---- Grave Endeavor, Wild Endeavor ------------------------------------------------------------------------------------------------------------------------------
const GRAVE = card('Test Grave Endeavor', 'Instant', 'Roll two d10 and choose one result. Return a creature card from your graveyard to the battlefield with a number of +1/+1 counters on it equal to that result. Then each opponent loses X life and you gain X life, where X is the other result.');
const CORPSE = card('Test Corpse', 'Creature — Zombie', '', { pt: ['1', '1'] });
const pickOf = (pick: 'high' | 'low') => (opts: { id: string; label: string }[]): string => (pick === 'high' ? opts.reduce((a, b) => (Number(b.label) > Number(a.label) ? b : a)) : opts.reduce((a, b) => (Number(b.label) < Number(a.label) ? b : a))).id;
describe('CR 706.2, 608.2h, 122.6: "Roll two d10 and choose one result. ... counters on it equal to that result. ... where X is the other result." (Grave Endeavor)', () => {
  const play = (seed: string, pick: 'high' | 'low'): { s: GameState; dice: number[] } => {
    const s0 = scenario([], { seed, defs: [GRAVE, CORPSE], p1: { hand: ['Test Grave Endeavor'], graveyard: ['Test Corpse'] } });
    const s = cast(s0, 'Test Grave Endeavor', { option: pickOf(pick) });
    return { s, dice: rolled(s) };
  };
  it('is fully automated', () => expect(GRAVE.automation.level).toBe('full'));
  it('the creature comes back with as many +1/+1 counters as the chosen result; each opponent loses, and you gain, the other result (either choice)', () => {
    let different = 0;
    for (const seed of SEEDS) for (const pick of ['high', 'low'] as const) {
      const { s, dice } = play(seed, pick);
      expect(dice, seed).toHaveLength(2);
      const chosen = pick === 'high' ? Math.max(...dice) : Math.min(...dice);
      const other = dice[0]! + dice[1]! - chosen;
      const back = onBf(s, 'Test Corpse');
      expect(back, `${seed} ${pick} ${dice}`).toHaveLength(1);
      expect(s.objects[back[0]!]!.counters['+1/+1'] ?? 0, `${seed} ${pick} ${dice}`).toBe(chosen);
      expect(life(s, 'p2'), `${seed} ${pick} ${dice}`).toBe(20 - other);
      expect(life(s, 'p1'), `${seed} ${pick} ${dice}`).toBe(20 + other);
      if (dice[0] !== dice[1]) different++;
    }
    expect(different, 'the seeds roll different dice').toBeGreaterThan(5);
  });
  it('the negative case: with no creature card in the graveyard nothing returns, yet the life is still lost and gained', () => {
    const s0 = scenario([], { seed: 's1', defs: [GRAVE], p1: { hand: ['Test Grave Endeavor'] } });
    const s = cast(s0, 'Test Grave Endeavor', { option: pickOf('high') });
    const dice = rolled(s);
    const other = dice[0]! + dice[1]! - Math.max(...dice);
    expect(tokens(s)).toHaveLength(0);
    expect(life(s, 'p2')).toBe(20 - other);
  });
});

const WILD = card('Test Wild Endeavor', 'Sorcery', 'Roll two d4 and choose one result. Create a number of 3/3 green Beast creature tokens equal to that result. Then search your library for a number of basic land cards equal to the other result, put them onto the battlefield tapped, then shuffle.');
describe('CR 706.2, 701.23b: "Search your library for a number of basic land cards equal to the other result" (Wild Endeavor)', () => {
  it('is fully automated', () => expect(WILD.automation.level).toBe('full'));
  it('as many Beasts as the chosen result, and as many tapped basic lands as the other result (either choice)', () => {
    for (const seed of SEEDS.slice(0, 20)) for (const pick of ['high', 'low'] as const) {
      const s0 = scenario([], { seed, defs: [WILD], p1: { hand: ['Test Wild Endeavor'] } });
      const s = cast(s0, 'Test Wild Endeavor', { option: pickOf(pick), objects: (o, min, max) => o.slice(0, Math.max(min, Math.min(max, 4))) });
      const dice = rolled(s);
      expect(dice, seed).toHaveLength(2);
      const chosen = pick === 'high' ? Math.max(...dice) : Math.min(...dice);
      const other = dice[0]! + dice[1]! - chosen;
      expect(tokens(s), `${seed} ${pick} ${dice}`).toHaveLength(chosen);
      for (const t of tokens(s)) expect(ptOf(s, t), seed).toEqual([3, 3]);
      const lands = onBf(s, 'Plains');
      expect(lands, `${seed} ${pick} ${dice}`).toHaveLength(other);
      expect(lands.every((id) => s.objects[id]!.tapped), seed).toBe(true);
    }
  });
});

// ---- Monoxa, Midway Manager ---------------------------------------------------------------------------------------------------------------------------------------
const MONOXA = card('Test Midway', 'Legendary Creature — Vampire Employee', 'Whenever you roll a 3 or higher, ~ gains first strike until end of turn. If the roll was 4 or higher, it gains menace until end of turn. If the roll was 5 or higher, it gains lifelink until end of turn.\n{6}: Roll a six-sided die.', { pt: ['3', '3'] });
describe('CR 706.2, 603.2c, 608.2h: "Whenever you roll a 3 or higher, ... If the roll was 4 or higher, ... If the roll was 5 or higher, ..." (Monoxa, Midway Manager)', () => {
  const play = (seed: string): { s: GameState; roll: number } => {
    const s0 = scenario([], { seed, defs: [MONOXA], p1: { battlefield: ['Test Midway', ...Array(6).fill('Plains')] } });
    const id = find(s0, 'Test Midway', 'battlefield', 'p1');
    const key = activatedAbilities(s0, s0.objects[id]!).find((i) => i.def.isMana !== true)!.key;
    const s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: id, ability: key }));
    return { s, roll: rolled(s)[0]! };
  };
  it('is fully automated', () => expect(MONOXA.automation.level).toBe('full'));
  it('first strike on a 3 or more, menace on a 4 or more, lifelink on a 5 or more; a roll of 1 or 2 gives nothing', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const { s, roll } = play(seed);
      seen.add(roll);
      const k = kws(s, find(s, 'Test Midway', 'battlefield', 'p1'));
      expect(k.includes('first strike'), `${seed} ${roll}`).toBe(roll >= 3);
      expect(k.includes('menace'), `${seed} ${roll}`).toBe(roll >= 4);
      expect(k.includes('lifelink'), `${seed} ${roll}`).toBe(roll >= 5);
    }
    expect(seen.size, 'the seeds play at least four different results').toBeGreaterThanOrEqual(4);
  });
});

// ---- Clowning Around ----------------------------------------------------------------------------------------------------------------------------------------------
const CLOWN = card('Test Clowning', 'Sorcery', 'Create two 1/1 white Clown Robot artifact creature tokens, then roll a six-sided die. If the result is equal to or less than the number of Robots you control, create a 1/1 white Clown Robot artifact creature token.');
const ROBOT = card('Test Robot', 'Artifact Creature — Robot', '', { pt: ['1', '1'] });
describe('CR 706.2, 608.2h, 205.3m: "If the result is equal to or less than the number of Robots you control, create a ... token." (Clowning Around)', () => {
  it('is fully automated', () => expect(CLOWN.automation.level).toBe('full'));
  it('one more token when the die shows at most the Robots you control (the two new ones counted, a third Robot raises the limit); a higher result makes none', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) for (const extra of [0, 1]) {
      const s0 = scenario([], { seed, defs: [CLOWN, ROBOT], p1: { hand: ['Test Clowning'], battlefield: extra === 1 ? ['Test Robot'] : [] } });
      const s = cast(s0, 'Test Clowning');
      const roll = rolled(s)[0]!;
      const robots = 2 + extra;
      const want = roll <= robots ? 3 : 2;
      seen.add(`${extra}:${want}`);
      expect(tokens(s), `${seed} ${extra} ${roll}`).toHaveLength(want);
    }
    expect([...seen].sort(), 'both outcomes are played with and without the third Robot').toEqual(['0:2', '0:3', '1:2', '1:3']);
  });
});

// ---- Six-Sided Die ------------------------------------------------------------------------------------------------------------------------------------------------
const SIXDIE = card('Test Die Spell', 'Instant', 'Choose target creature. Roll a six-sided die.\n1 — It has base toughness 1 until end of turn.\n2 — Put two -1/-1 counters on it.\n3 — Test Die Spell deals 3 damage to it and you gain 3 life.\n4 — It gets -4/-4 until end of turn.\n5 — Destroy it.\n6 — Exile it.');
const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['2', '6'] });
describe('CR 706.3a, 115.1: result rows printed with a dash, over the target chosen before the roll (Six-Sided Die)', () => {
  const play = (seed: string): { s: GameState; roll: number; wall: ObjectId } => {
    const s0 = scenario([], { seed, defs: [SIXDIE, WALL], p1: { hand: ['Test Die Spell'] }, p2: { battlefield: ['Test Wall'] } });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Die Spell', 'hand', 'p1') }), { targets: [{ kind: 'object', id: wall }] });
    return { s, roll: rolled(s)[0]!, wall };
  };
  it('is fully automated', () => expect(SIXDIE.automation.level).toBe('full'));
  it('each result does its own row to the target: 1 base toughness 1, 2 two -1/-1 counters, 3 damage and life, 4 -4/-4, 5 destroy, 6 exile', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 120 && seen.size < 6; i++) {
      const { s, roll, wall } = play(`d${i}`);
      seen.add(roll);
      const o = s.objects[wall] ?? s.objects[Object.keys(s.objects)[0]!]!;
      if (roll === 1) expect(ptOf(s, wall), `${roll}`).toEqual([2, 1]);
      else if (roll === 2) { expect(o.counters['-1/-1'], `${roll}`).toBe(2); expect(ptOf(s, wall)).toEqual([0, 4]); }
      else if (roll === 3) { expect(o.damage, `${roll}`).toBe(3); expect(life(s, 'p1'), `${roll}`).toBe(23); }
      else if (roll === 4) expect(ptOf(s, wall), `${roll}`).toEqual([-2, 2]);
      else if (roll === 5) { expect(s.zones.battlefield.includes(wall), `${roll}`).toBe(false); expect(s.zones.graveyard['p2']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Wall'), `${roll}`).toBe(true); }
      else { expect(s.zones.battlefield.includes(wall), `${roll}`).toBe(false); expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Wall'), `${roll}`).toBe(true); }
      if (roll !== 3) expect(life(s, 'p1'), `${roll} gains no life`).toBe(20);
    }
    expect([...seen].sort(), 'all six results are played').toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ---- Sword of Hours, Strength-Testing Hammer --------------------------------------------------------------------------------------------------------------------------
const SWORD = card('Test Hourglass Sword', 'Artifact — Equipment', 'Whenever equipped creature attacks, put a +1/+1 counter on it.\nWhenever equipped creature deals combat damage, roll a d12. If the result is greater than the damage dealt or the result is 12, double the number of +1/+1 counters on that creature.\nEquip {2}');
const FIGHTER = card('Test Fighter', 'Creature — Human', '', { pt: ['1', '1'] });
const HAMMER = card('Test Hammer', 'Artifact — Equipment', 'Whenever equipped creature attacks, roll a six-sided die. That creature gets +X/+0 until end of turn, where X is the result. Then if it has the greatest power or is tied for greatest power among creatures on the battlefield, draw a card.\nEquip {3}');
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['6', '6'] });
/** p1 attacks p2 with the creature and nobody blocks; every ability that triggers resolves. */
function attackWith(s0: GameState, attacker: ObjectId): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] } as never);
  for (let guard = 0; guard < 80 && s.turn.step !== 'end' && s.turn.step !== 'main2'; guard++) {
    s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : settle(s);
  }
  return s;
}
describe('CR 706.2, 120.3, 122.1: "If the result is greater than the damage dealt or the result is 12, double the number of +1/+1 counters" (Sword of Hours)', () => {
  const play = (seed: string): { s: GameState; id: ObjectId; roll: number } => {
    const s0 = scenario([], { seed, defs: [SWORD, FIGHTER], p1: { battlefield: ['Test Hourglass Sword', { name: 'Test Fighter', counters: { '+1/+1': 2 } }] } });
    const id = find(s0, 'Test Fighter', 'battlefield', 'p1');
    s0.objects[find(s0, 'Test Hourglass Sword', 'battlefield', 'p1')]!.attachedTo = id;
    const s = attackWith(s0, id);
    return { s, id, roll: rolled(s)[0]! };
  };
  it('is fully automated', () => expect(SWORD.automation.level).toBe('full'));
  it('the attack adds a counter (2 to 3, damage 4); a roll above 4 or exactly 12 doubles them to 6, any other roll leaves 3', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { s, id, roll } = play(seed);
      const doubled = roll > 4 || roll === 12;
      seen.add(doubled ? 'doubled' : 'kept');
      expect(s.objects[id]!.counters['+1/+1'], `${seed} ${roll}`).toBe(doubled ? 6 : 3);
      expect(life(s, 'p2'), `${seed} ${roll}`).toBe(16); // 1 base power + 3 counters
    }
    expect([...seen].sort(), 'both outcomes are played').toEqual(['doubled', 'kept']);
  });
});

describe('CR 706.2, 208.1, 608.2c: "gets +X/+0 until end of turn, where X is the result. Then if it has the greatest power or is tied for greatest power ... draw a card." (Strength-Testing Hammer)', () => {
  const play = (seed: string, giant: boolean): { s: GameState; id: ObjectId; roll: number; handBefore: number } => {
    const s0 = scenario([], { seed, defs: [HAMMER, FIGHTER, GIANT], p1: { battlefield: ['Test Hammer', 'Test Fighter'] }, p2: { battlefield: giant ? ['Test Giant'] : [] } });
    const id = find(s0, 'Test Fighter', 'battlefield', 'p1');
    s0.objects[find(s0, 'Test Hammer', 'battlefield', 'p1')]!.attachedTo = id;
    const handBefore = s0.zones.hand['p1']!.length;
    const s = attackWith(s0, id);
    return { s, id, roll: rolled(s)[0]!, handBefore };
  };
  it('is fully automated', () => expect(HAMMER.automation.level).toBe('full'));
  it('the attacker gets +X/+0 for X the result, kept to the damage step; it draws only when its power is the greatest (a 6 power Giant needs a result of 5 or more to be matched)', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) for (const giant of [false, true]) {
      const { s, id, roll, handBefore } = play(seed, giant);
      expect(ptOf(s, id)[0], `${seed} ${roll}`).toBe(1 + roll);
      expect(life(s, 'p2'), `${seed} ${roll}`).toBe(20 - (1 + roll)); // the +X/+0 stays through the damage step
      const drew = (s.zones.hand['p1']!.length - handBefore) === 1;
      expect(drew, `${seed} giant=${giant} ${roll}`).toBe(giant ? 1 + roll >= 6 : true);
      seen.add(`${giant}:${drew}`);
    }
    expect([...seen].sort(), 'draws and no draws are both played against the Giant').toEqual(['false:true', 'true:false', 'true:true']);
  });
});

// ---- Netherese Puzzle-Ward ----------------------------------------------------------------------------------------------------------------------------------------
const WARD = card('Test Puzzle Ward', 'Enchantment', "Whenever you roll a die's highest natural result, draw a card.");
const SIXTH = card('Test Roller', 'Artifact', '{1}: Roll a six-sided die.\n{2}: Roll a d20.');
describe('CR 706.2, 603.2c: "Whenever you roll a die\'s highest natural result, draw a card." (Netherese Puzzle-Ward)', () => {
  const roll = (seed: string, which: 0 | 1): { s: GameState; r: number; sides: number; drew: number } => {
    const s0 = scenario([], { seed, defs: [WARD, SIXTH], p1: { battlefield: ['Test Puzzle Ward', 'Test Roller', 'Plains', 'Plains'] } });
    const id = find(s0, 'Test Roller', 'battlefield', 'p1');
    const key = activatedAbilities(s0, s0.objects[id]!).filter((i) => i.def.isMana !== true)[which]!.key;
    const handBefore = s0.zones.hand['p1']!.length;
    const s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: id, ability: key }));
    return { s, r: rolled(s)[0]!, sides: which === 0 ? 6 : 20, drew: s.zones.hand['p1']!.length - handBefore };
  };
  it('is fully automated', () => expect(WARD.automation.level).toBe('full'));
  it('a card is drawn when the die shows its highest number (a 6 on a six-sided die, a 20 on a d20) and not for a lower result', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 160 && seen.size < 3; i++) for (const which of [0, 1] as const) {
      const { r, sides, drew } = roll(`w${i}`, which);
      expect(drew, `w${i} d${sides} ${r}`).toBe(r === sides ? 1 : 0);
      if (r === sides) seen.add(`top${sides}`); else if (r === 6 && sides === 20) seen.add('six-on-d20');
    }
    expect(seen.has('top6'), 'a 6 on the six-sided die is played').toBe(true);
    expect(seen.has('six-on-d20'), 'a 6 on a d20 is played and draws nothing').toBe(true);
  });
});
