/**
 * Round edh-next-128 (must-finish round "dice, coins and random", EDHREC 5,001-10,000): the behaviour it added, played through the engine with synthetic cards (invented
 * names, the printed wordings of the real cards), compiled by the game's default compiler, in four-player games. Random picks and dice are the state's seeded generator:
 * the tests read the results from the game's log and check what the rules do with THAT result, over many seeds.
 *
 *   CR 608.2d, 120.3, 306.8, 603.2   Vial Smasher the Fierce: "Whenever you cast your first spell each turn, choose an opponent at random. Vial Smasher deals damage equal to
 *                                     that spell's mana value to that player or a planeswalker that player controls." (rulings 2020-11-10: the opponent is chosen at random as
 *                                     the ability resolves, then YOU choose that player or one of their planeswalkers; no planeswalker: the player)
 *   CR 614.12a, 614.1c, 706.2, 107.3m Neverwinter Hydra: "As this creature enters, roll X d6. It enters with a number of +1/+1 counters on it equal to the total of those results."
 *                                     (the dice are rolled before it is on the battlefield, by the player it enters under; X of the spell; X = 0: no dice, a 0/0 that dies)
 *   CR 122.1, 122.1b, 608.2d          Crystalline Giant: "At the beginning of combat on your turn, choose a kind of counter at random that this creature doesn't have on it from among
 *                                     flying, first strike, ..., and +1/+1. Put a counter of that kind on this creature." (rulings 2020-04-17: all ten there: no counter; a keyword it has
 *                                     another way is still offered)
 *   CR 608.2d, 705.1, 705.2, 608.2c,  Yusri, Fortune's Flame: "Whenever Yusri attacks, choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. For each
 *   118.9, 611.2a                     flip you lose, Yusri deals 2 damage to you. If you won five flips this way, you may cast spells from your hand this turn without paying their mana
 *                                     costs." (every coin is flipped first, then each sentence in order; rulings 2021-06-18: additional costs still paid, X is 0)
 *   CR 706.2, 608.2c, 611.2a, 613.1f  Celebr-8000: "At the beginning of combat on your turn, roll two six-sided dice. For each result of 1, this creature gets +1/+1 until end of turn. For
 *                                     each other result, it gains the indicated ability until end of turn. If you rolled doubles, it also gains double strike until end of turn.
 *                                     • 2 -- menace • 3 -- vigilance • 4 -- lifelink • 5 -- flying • 6 -- indestructible" (rulings 2022-10-07: a result past 6 gives nothing; doubles of it still
 *                                     give double strike)
 *   CR 706.2, 122.1, 111.1, 608.2b    Attempted Murder: "Choose target creature. Roll X six-sided dice. For each even result, put two -1/-1 counters on that creature. For each odd result,
 *                                     create a 1/2 blue Bird creature token with flying named Storm Crow." (the counters as one put of twice the even results)
 *   CR 705.1, 608.2c, 120.2b          Mana Clash: "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until
 *                                     both players' coins come up heads on the same flip." (rulings 2004-10-04: the flips have no winner or loser; each run's damage is its own)
 *   CR 706.2, 706.3a, 608.2c, 400.7   Revivify: "Roll a d20 and add the number of creature cards in your graveyard that were put there from the battlefield this turn. 1-14 | Return all
 *                                     creature cards in your graveyard that were put there from the battlefield this turn to your hand. 15+ | Return those cards from your graveyard
 *                                     to the battlefield."
 *   CR 608.2d, 705.2, 608.2c          Squee's Revenge: "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two
 *                                     cards for each flip."
 *   CR 608.2d, 613.1b, 701.26b        Scrambleverse: "For each nonland permanent, choose a player at random. Then each player gains control of each permanent for which they were chosen.
 *                                     Untap those permanents." (rulings 2011-09-22: any player, the current controller included; every nonland permanent untaps; lands stay)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, legalActions, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, lifeOf, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, full } from '../cmd3/helpers';

const SEEDS = Array.from({ length: 24 }, (_, i) => `edhn128-${i}`);

interface Script {
  targets?: ObjectId[];
  yes?: (prompt: string, who: PlayerId) => boolean;
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId, max: number) => ObjectId[];
  option?: (options: { id: string; label: string }[], prompt: string, who: PlayerId) => string;
  until?: (state: GameState) => boolean;
  /** The answer to a number choice (X of a spell). */
  number?: number;
  /** Every prompt seen, in order, with who was asked. */
  asked?: { kind: string; prompt: string; who: PlayerId }[];
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 400; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind !== 'priority') sc.asked?.push({ kind: p.kind, prompt: d.prompt, who: d.player });
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [/^p\d$/.test(targets[0]!) ? { kind: 'player', id: targets.shift()! } : { kind: 'object', id: targets.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt, d.player) : true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player, d.max ?? o.length) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      a = { kind: 'chooseOption', ids: [sc.option ? sc.option(o, d.prompt, d.player) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: sc.number ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'declareAttackers') a = { kind: 'declareAttackers', attacks: [] } as DecisionAnswer;
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const bf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const loyalty = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['loyalty'] ?? 0;
const lives = (s: GameState): number[] => ['p1', 'p2', 'p3', 'p4'].map((p) => lifeOf(s, p));
const walker = (name: string): ReturnType<typeof compileCard> =>
  compileCard({ name, layout: 'normal', mana_cost: '{3}', type_line: 'Legendary Planeswalker — Testwalker', oracle_text: '+1: You gain 1 life.', loyalty: '6', colors: [] } as unknown as OracleCard);

describe('CR 608.2d, 120.3, 306.8: Vial Smasher the Fierce ("choose an opponent at random. ~ deals damage equal to that spell\'s mana value to that player or a planeswalker that player controls")', () => {
  const SMASHER = card('Test Vial Breaker', 'Legendary Creature — Goblin Berserker', "Whenever you cast your first spell each turn, choose an opponent at random. Test Vial Breaker deals damage equal to that spell's mana value to that player or a planeswalker that player controls.\nPartner", ['2', '3'], '{1}{B}{R}');
  const BOLT = card('Test Three Bolt', 'Sorcery', 'You gain 1 life.', undefined, '{2}{W}');
  const SPARK = card('Test One Spark', 'Sorcery', 'You gain 1 life.', undefined, '{W}');
  const WALKERS = ['p2', 'p3', 'p4'].map((p) => walker(`Test Walker ${p}`));
  const defs = [SMASHER, BOLT, SPARK, ...WALKERS];
  const game = (seed: string, walkers: PlayerId[] = []): GameState => mpScenario({
    defs, seed, zones: {
      p1: { battlefield: ['Test Vial Breaker', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Three Bolt', 'Test One Spark'] },
      ...Object.fromEntries(walkers.map((p) => [p, { battlefield: [{ name: `Test Walker ${p}`, counters: { loyalty: 6 } }] }])),
    },
  });
  const cast = (s: GameState, name: string, sc: Script = {}): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, name, 'hand', 'p1') }), sc);

  it('compiles full: a random opponent, then damage with `orPlaneswalker` to that player', () => {
    expect(full(SMASHER)).toBe(true);
    const steps = (SMASHER.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps.map((x) => x['op'])).toEqual(['chooseValue', 'damage']);
    expect(steps[0]).toMatchObject({ what: 'opponent', random: true });
    expect(steps[1]).toMatchObject({ to: { ref: 'bound', name: steps[0]!['as'] }, orPlaneswalker: true });
  });

  it('no opponent controls a planeswalker: the random opponent is dealt 3 (the spell\'s mana value), nobody is asked, the other two are not touched', () => {
    const hit = new Set<string>();
    for (const seed of SEEDS) {
      const asked: Script['asked'] = [];
      const s = cast(game(seed), 'Test Three Bolt', { asked });
      const l = lives(s);
      expect(l[0], `${seed}: the caster gains 1 from the spell`).toBe(21);
      expect(l.slice(1).sort(), seed).toEqual([17, 20, 20]);
      hit.add(['p2', 'p3', 'p4'][l.slice(1).indexOf(17)]!);
      expect(asked.filter((x) => x.kind === 'chooseOption'), `${seed}: nothing to choose`).toEqual([]);
    }
    expect([...hit].sort(), 'the pick is random among the opponents').toEqual(['p2', 'p3', 'p4']);
  });

  it('every opponent controls a planeswalker: the caster (never the opponent) chooses; choosing the planeswalker removes 3 loyalty from it and the player keeps their life', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const asked: Script['asked'] = [];
      const s = cast(game(seed, ['p2', 'p3', 'p4']), 'Test Three Bolt', { asked, option: (o) => o.find((x) => x.id.startsWith('object:'))!.id });
      const choice = asked.filter((x) => x.kind === 'chooseOption');
      expect(choice.length, seed).toBe(1);
      expect(choice[0]!.who, `${seed}: you choose (ruling 2020-11-10)`).toBe('p1');
      expect(lives(s).slice(1), seed).toEqual([20, 20, 20]);
      const loy = ['p2', 'p3', 'p4'].map((p) => loyalty(s, bf(s, `Test Walker ${p}`, p)[0]!));
      expect(loy.sort(), seed).toEqual([3, 6, 6]);
      // the planeswalker damaged is the random opponent's: the options were that player and their own planeswalker only
      const victim = ['p2', 'p3', 'p4'][['p2', 'p3', 'p4'].map((p) => loyalty(s, bf(s, `Test Walker ${p}`, p)[0]!)).indexOf(3)]!;
      expect(choice[0]!.prompt, seed).toContain(s.players.find((x) => x.id === victim)!.name);
    }
  });

  it('choosing the player deals the damage to the player; the planeswalker keeps its loyalty', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s = cast(game(seed, ['p2', 'p3', 'p4']), 'Test Three Bolt', { option: (o) => o.find((x) => x.id.startsWith('player:'))!.id });
      expect(lives(s).slice(1).sort(), seed).toEqual([17, 20, 20]);
      expect(['p2', 'p3', 'p4'].map((p) => loyalty(s, bf(s, `Test Walker ${p}`, p)[0]!)), seed).toEqual([6, 6, 6]);
    }
  });

  it('negative: only the first spell of the turn triggers (the second spell, mana value 1, deals nothing)', () => {
    let s = cast(game('edhn128-first'), 'Test Three Bolt');
    expect(lives(s).slice(1).reduce((a, b) => a + b), 'the first spell: 3 damage').toBe(57);
    s = cast(s, 'Test One Spark');
    expect(lives(s).slice(1).reduce((a, b) => a + b), 'the second spell: no trigger').toBe(57);
    expect(lifeOf(s, 'p1')).toBe(22);
  });

  it('the fixed-amount wording ("~ deals 2 damage to that player or a planeswalker they control") plays the same way', () => {
    const SHARD = card('Test Shard Hurler', 'Creature — Goblin', 'Whenever you cast your first spell each turn, choose an opponent at random. Test Shard Hurler deals 2 damage to that player or a planeswalker they control.', ['1', '1']);
    expect(full(SHARD)).toBe(true);
    const s0 = mpScenario({ defs: [SHARD, SPARK, ...WALKERS], seed: 'edhn128-shard', zones: { p1: { battlefield: ['Test Shard Hurler', 'Plains'], hand: ['Test One Spark'] }, p2: { battlefield: [{ name: 'Test Walker p2', counters: { loyalty: 6 } }] }, p3: { battlefield: [{ name: 'Test Walker p3', counters: { loyalty: 6 } }] }, p4: { battlefield: [{ name: 'Test Walker p4', counters: { loyalty: 6 } }] } } });
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test One Spark', 'hand', 'p1') }), { option: (o) => o.find((x) => x.id.startsWith('object:'))!.id });
    expect(['p2', 'p3', 'p4'].map((p) => loyalty(s, bf(s, `Test Walker ${p}`, p)[0]!)).sort()).toEqual([4, 6, 6]);
  });

  it('negative wordings stay out of this reading: a target player, a group of players, a creature instead of a planeswalker', () => {
    for (const text of [
      'Whenever you cast your first spell each turn, Test Odd One deals 2 damage to target player or a planeswalker that player controls.',
      'Whenever you cast your first spell each turn, Test Odd One deals 2 damage to each opponent or a planeswalker that player controls.',
      'Whenever you cast your first spell each turn, choose an opponent at random. Test Odd One deals 2 damage to that player or a creature that player controls.',
    ]) {
      const d = card('Test Odd One', 'Creature — Goblin', text, ['1', '1']);
      expect(JSON.stringify(d.faces[0]!.abilities), text).not.toContain('"orPlaneswalker":true');
    }
  });
});

/** The natural results of the d6 rolled, in order, from the game's log ("Alice rolls a d6: 4."). */
const rolledD6 = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d6: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });

describe('CR 614.12a, 706.2, 107.3m: Neverwinter Hydra ("As this creature enters, roll X d6. It enters with a number of +1/+1 counters on it equal to the total of those results.")', () => {
  const HYDRA = card('Test Dice Hydra', 'Creature — Hydra', 'As this creature enters, roll X d6. It enters with a number of +1/+1 counters on it equal to the total of those results.\nTrample', ['0', '0'], '{X}');
  const game = (seed: string): GameState => mpScenario({ defs: [HYDRA], seed, zones: { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Dice Hydra'] } } });
  const cast = (s: GameState, x: number): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Dice Hydra', 'hand', 'p1') }), { number: x });

  it('compiles full: an enters replacement that rolls X d6 and gives counters equal to the total', () => {
    expect(full(HYDRA)).toBe(true);
    expect(JSON.stringify(HYDRA.faces[0]!.abilities[0])).toContain('"roll":{"sides":6,"count":{"q":"X"}}');
  });

  it('X = 3: three d6 are rolled as it enters, and it is on the battlefield with exactly their total of +1/+1 counters (no die rolled later)', () => {
    for (const seed of SEEDS) {
      const s = cast(game(seed), 3);
      const r = rolledD6(s);
      expect(r.length, seed).toBe(3);
      const h = bf(s, 'Test Dice Hydra', 'p1')[0]!;
      expect(h, seed).toBeDefined();
      expect(s.objects[h]!.counters['+1/+1'], seed).toBe(r.reduce((a, b) => a + b, 0));
    }
  });

  it('X = 1: one die; negative: X = 0 rolls nothing and the 0/0 is put into the graveyard (CR 704.5f)', () => {
    const one = cast(game('edhn128-hydra-1'), 1);
    expect(rolledD6(one).length).toBe(1);
    expect(one.objects[bf(one, 'Test Dice Hydra', 'p1')[0]!]!.counters['+1/+1']).toBe(rolledD6(one)[0]);
    const zero = cast(game('edhn128-hydra-0'), 0);
    expect(rolledD6(zero)).toEqual([]);
    expect(bf(zero, 'Test Dice Hydra')).toEqual([]);
    expect(zero.zones.graveyard['p1']!.some((id) => zero.defs[zero.objects[id]!.defId]!.name === 'Test Dice Hydra')).toBe(true);
  });

  it('negative: "When this creature enters, roll X d6 ..." (a trigger, not the replacement) is not read this way', () => {
    const d = card('Test Late Hydra', 'Creature — Hydra', 'When this creature enters, roll X d6. It enters with a number of +1/+1 counters on it equal to the total of those results.', ['0', '0'], '{X}');
    expect(JSON.stringify(d.faces[0]!.abilities)).not.toContain('"roll":{');
  });
});

describe('CR 122.1, 122.1b, 608.2d: Crystalline Giant ("choose a kind of counter at random that this creature doesn\'t have on it from among ... Put a counter of that kind on this creature.")', () => {
  const KINDS = ['flying', 'first strike', 'deathtouch', 'hexproof', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', '+1/+1'];
  const GIANT = card('Test Crystal Hulk', 'Artifact Creature — Giant', 'At the beginning of combat on your turn, choose a kind of counter at random that this creature doesn\'t have on it from among flying, first strike, deathtouch, hexproof, lifelink, menace, reach, trample, vigilance, and +1/+1. Put a counter of that kind on this creature.', ['3', '3'], '{3}');
  const FLYER = card('Test Sky Hulk', 'Artifact Creature — Giant', 'Flying\nAt the beginning of combat on your turn, choose a kind of counter at random that this creature doesn\'t have on it from among flying, first strike, deathtouch, hexproof, lifelink, menace, reach, trample, vigilance, and +1/+1. Put a counter of that kind on this creature.', ['3', '3'], '{3}');
  const toCombat = (s: GameState): GameState => run(s, { until: (x) => x.turn.step !== 'main1' });
  const game = (seed: string, counters: Record<string, number> = {}, name = 'Test Crystal Hulk'): GameState => mpScenario({ defs: [GIANT, FLYER], seed, zones: { p1: { battlefield: [{ name, counters }] } } });
  const kinds = (s: GameState, id: ObjectId): string[] => Object.entries(s.objects[id]!.counters).filter(([, n]) => n > 0).map(([k]) => k).sort();

  it('compiles full: a random counter kind among the ten that it has none of, then one counter of that kind on it', () => {
    expect(full(GIANT)).toBe(true);
    const steps = (GIANT.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'chooseValue', what: 'counterKind', random: true, options: KINDS, counterNotOn: { ref: 'self' } });
    expect(steps[1]).toMatchObject({ op: 'putCounters', on: { ref: 'self' }, count: 1, kindOfChoice: steps[0]!['link'] });
  });

  it('at the beginning of combat on its controller\'s turn: exactly one counter of one listed kind, which grants its keyword; over many seeds several kinds come up', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s = toCombat(game(seed));
      const g = bf(s, 'Test Crystal Hulk', 'p1')[0]!;
      const k = kinds(s, g);
      expect(k.length, seed).toBe(1);
      expect(KINDS, seed).toContain(k[0]);
      expect(s.objects[g]!.counters[k[0]!], seed).toBe(1);
      if (k[0] !== '+1/+1') expect(hasKeyword(getChars(s, g)!, k[0]!), `${seed}: the ${k[0]} counter grants ${k[0]}`).toBe(true);
      seen.add(k[0]!);
    }
    expect(seen.size, 'random among the kinds').toBeGreaterThanOrEqual(5);
  });

  it('never a kind it already has a counter of: with nine kinds there, the tenth; with all ten, nothing is put (ruling 2020-04-17)', () => {
    for (const missing of ['reach', '+1/+1', 'flying']) {
      const nine = Object.fromEntries(KINDS.filter((k) => k !== missing).map((k) => [k, 1]));
      for (const seed of SEEDS.slice(0, 4)) {
        const s = toCombat(game(seed, nine));
        const g = bf(s, 'Test Crystal Hulk', 'p1')[0]!;
        expect(s.objects[g]!.counters[missing], `${seed}: ${missing}`).toBe(1);
        for (const k of KINDS.filter((x) => x !== missing)) expect(s.objects[g]!.counters[k], `${seed}: ${k} stays 1`).toBe(1);
      }
    }
    const all = Object.fromEntries(KINDS.map((k) => [k, 1]));
    const s = toCombat(game('edhn128-all', all));
    const g = bf(s, 'Test Crystal Hulk', 'p1')[0]!;
    for (const k of KINDS) expect(s.objects[g]!.counters[k], k).toBe(1);
  });

  it('a keyword it has another way is still offered (ruling 2020-04-17): with every other kind there, a flyer gets a flying counter', () => {
    const others = Object.fromEntries(KINDS.filter((k) => k !== 'flying').map((k) => [k, 1]));
    const s = toCombat(game('edhn128-flyer', others, 'Test Sky Hulk'));
    expect(s.objects[bf(s, 'Test Sky Hulk', 'p1')[0]!]!.counters['flying']).toBe(1);
  });

  it('negative: not on an opponent\'s turn (no counter at p2\'s beginning of combat)', () => {
    let s = mpScenario({ defs: [GIANT], seed: 'edhn128-opp', zones: { p2: { battlefield: ['Test Crystal Hulk'] } } });
    s = toCombat(s);
    expect(kinds(s, bf(s, 'Test Crystal Hulk', 'p2')[0]!)).toEqual([]);
  });
});

describe('CR 608.2d, 705.2, 608.2c: Yusri, Fortune\'s Flame ("choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. ...")', () => {
  const YUSRI = card('Test Fortune Efreet', 'Legendary Creature — Efreet', "Flying\nWhenever Test Fortune Efreet attacks, choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. For each flip you lose, Test Fortune Efreet deals 2 damage to you. If you won five flips this way, you may cast spells from your hand this turn without paying their mana costs.", ['2', '3'], '{1}{U}{R}');
  const BIG = card('Test Costly Wish', 'Sorcery', 'You gain 7 life.', undefined, '{7}');
  const game = (seed: string): GameState => mpScenario({ defs: [YUSRI, BIG], seed, zones: { p1: { battlefield: ['Test Fortune Efreet'], hand: ['Test Costly Wish'] } } });
  const flips = (s: GameState): boolean[] => s.log.flatMap((l) => { const m = /flips (?:heads|tails): (wins|loses) the flip\./.exec(l.text); return m ? [m[1] === 'wins'] : []; });
  const attack = (s: GameState, n: number, asked: Script['asked'] = []): GameState => run(declareAttackers(toDeclareAttackers(s), [[bf(s, 'Test Fortune Efreet', 'p1')[0]!, 'p2']]), { number: n, asked, option: (o) => o.find((x) => x.id === 'heads')?.id ?? o[0]!.id, until: (x) => x.turn.step !== 'declareAttackers' });
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;

  it('compiles full: the number, a called flip of that many coins, then the wins and the losses counted, then the five-wins permission', () => {
    expect(full(YUSRI)).toBe(true);
    const steps = (YUSRI.faces[0]!.abilities[1] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps.map((x) => x['op'])).toEqual(['chooseValue', 'flipCoin', 'repeat', 'repeat', 'if']);
    expect(steps[1]).toMatchObject({ times: { q: 'chosenNumber' }, called: true });
  });

  it('the attacking player chooses the number (1 to 5); that many coins are flipped, each called; one card for each win, 2 damage for each loss', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      for (const n of [1, 3, 5]) {
        const asked: Script['asked'] = [];
        const s0 = game(seed);
        const h0 = hand(s0);
        const s = attack(s0, n, asked);
        const number = asked.find((x) => x.kind === 'chooseNumber');
        expect(number?.who, seed).toBe('p1');
        const f = flips(s);
        expect(f.length, `${seed}: ${n} coins`).toBe(n);
        const won = f.filter(Boolean).length;
        expect(hand(s) - h0, `${seed}: ${n}`).toBe(won);
        expect(lifeOf(s, 'p1'), `${seed}: ${n}`).toBe(20 - 2 * (n - won));
      }
    }
  });

  it('every coin is flipped before any card is drawn or any damage is dealt (CR 608.2c: the instructions in order)', () => {
    const s = attack(game('edhn128-order'), 5);
    const lines = s.log.map((l) => l.text);
    const lastFlip = Math.max(...lines.map((t, i) => (/the flip\./.test(t) ? i : -1)));
    const firstFlip = lines.findIndex((t) => /the flip\./.test(t));
    const firstAfter = lines.findIndex((t, i) => i > firstFlip && (/draws|deals 2 damage/.test(t)));
    if (firstAfter >= 0) expect(firstAfter).toBeGreaterThan(lastFlip);
  });

  it('five flips won: spells from the hand are cast this turn without paying their mana costs; fewer than five: they are not', () => {
    let five: GameState | undefined;
    let fewer: GameState | undefined;
    for (let i = 0; i < 400 && (five === undefined || fewer === undefined); i++) {
      const s = attack(game(`edhn128-five-${i}`), 5);
      const won = flips(s).filter(Boolean).length;
      if (won === 5 && five === undefined) five = s;
      if (won === 4 && fewer === undefined) fewer = s;
    }
    expect(five, 'a seed with five wins').toBeDefined();
    let s = run(five!, { until: (x) => x.turn.step === 'main2' });
    const wish = mfind(s, 'Test Costly Wish', 'hand', 'p1');
    const freeCast = legalActions(s, 'p1').find((a) => a.kind === 'cast' && (a.action as { card?: string }).card === wish && JSON.stringify(a.action).includes('grantedCost'));
    expect(freeCast, 'a free cast is offered').toBeDefined();
    s = run(mact(s, freeCast!.action));
    expect(lifeOf(s, 'p1'), 'cast for free with no land: 20 + 7').toBe(27);
    const t = run(fewer!, { until: (x) => x.turn.step === 'main2' });
    const wish2 = mfind(t, 'Test Costly Wish', 'hand', 'p1');
    expect(legalActions(t, 'p1').some((a) => a.kind === 'cast' && (a.action as { card?: string }).card === wish2), 'four wins: no permission, no mana').toBe(false);
  });

  it('the same reading for a fixed number of coins: "flip three coins. For each flip you win, draw a card." (three calls, one card per win)', () => {
    const D = card('Test Coin Sage', 'Creature — Human Wizard', 'Whenever Test Coin Sage attacks, flip three coins. For each flip you win, draw a card.', ['1', '1']);
    expect(full(D)).toBe(true);
    const s0 = mpScenario({ defs: [D], seed: 'edhn128-three', zones: { p1: { battlefield: ['Test Coin Sage'] } } });
    const s = run(declareAttackers(toDeclareAttackers(s0), [[bf(s0, 'Test Coin Sage', 'p1')[0]!, 'p2']]), { until: (x) => x.turn.step !== 'declareAttackers' });
    expect(flips(s).length).toBe(3);
    expect(hand(s) - hand(s0)).toBe(flips(s).filter(Boolean).length);
  });

  it('negative: "If you won five flips this way" after a single coin, or with no flip before it, is not read', () => {
    for (const text of [
      'Whenever Test Odd Seer attacks, flip a coin. If you won five flips this way, draw a card.',
      'Whenever Test Odd Seer attacks, draw a card. If you won five flips this way, draw a card.',
    ]) expect(full(card('Test Odd Seer', 'Creature — Human', text, ['1', '1'])), text).toBe(false);
  });
});

describe('CR 706.2, 608.2c, 611.2a: Celebr-8000 ("roll two six-sided dice. For each result of 1, ... +1/+1 ... For each other result, it gains the indicated ability ... doubles ...")', () => {
  const TABLE: Record<number, string> = { 2: 'menace', 3: 'vigilance', 4: 'lifelink', 5: 'flying', 6: 'indestructible' };
  const BOT = card('Test Party Bot', 'Artifact Creature — Clown Robot', 'At the beginning of combat on your turn, roll two six-sided dice. For each result of 1, this creature gets +1/+1 until end of turn. For each other result, it gains the indicated ability until end of turn. If you rolled doubles, it also gains double strike until end of turn.\n• 2 — menace\n• 3 — vigilance\n• 4 — lifelink\n• 5 — flying\n• 6 — indestructible', ['1', '1'], '{2}');
  const toCombat = (s: GameState): GameState => run(s, { until: (x) => x.turn.step !== 'main1' });
  const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d6: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });

  it('compiles full: the roll, the +1/+1 for each 1, one keyword for each other result, double strike on doubles', () => {
    expect(full(BOT)).toBe(true);
    const steps = (BOT.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps.map((x) => x['op'])).toEqual(['rollDie', 'repeat', 'if', 'if', 'if', 'if', 'if', 'if']);
  });

  it('over many seeds: +1/+1 per 1 rolled, each other result gives its keyword, doubles give double strike, nothing else; it all ends with the turn', () => {
    let doubles = 0;
    for (const seed of Array.from({ length: 40 }, (_, k) => `edhn128-bot-${k}`)) {
      const s = toCombat(mpScenario({ defs: [BOT], seed, zones: { p1: { battlefield: ['Test Party Bot'] } } }));
      const r = rolled(s);
      expect(r.length, seed).toBe(2);
      const bot = bf(s, 'Test Party Bot', 'p1')[0]!;
      const c = getChars(s, bot)!;
      const ones = r.filter((x) => x === 1).length;
      expect(`${c.power}/${c.toughness}`, `${seed}: ${r}`).toBe(`${1 + ones}/${1 + ones}`);
      for (const [n, kw] of Object.entries(TABLE)) expect(hasKeyword(c, kw), `${seed}: ${r} ${kw}`).toBe(r.includes(Number(n)));
      expect(hasKeyword(c, 'double strike'), `${seed}: ${r}`).toBe(r[0] === r[1]);
      if (r[0] === r[1]) doubles++;
      const later = run(s, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
      const c2 = getChars(later, bot)!;
      expect(`${c2.power}/${c2.toughness}`, `${seed}: until end of turn`).toBe('1/1');
      expect(hasKeyword(c2, 'double strike') || Object.values(TABLE).some((k) => hasKeyword(c2, k)), seed).toBe(false);
    }
    expect(doubles, 'some seed rolled doubles').toBeGreaterThan(0);
  });

  it('negative: bullets out of order, a missing roll or a one-die roll keep the ability manual', () => {
    const bad = (text: string): boolean => full(card('Test Odd Bot', 'Artifact Creature — Robot', text, ['1', '1']));
    expect(bad('At the beginning of combat on your turn, roll two six-sided dice. For each other result, it gains the indicated ability until end of turn.\n• 3 — menace\n• 2 — vigilance\n• 4 — lifelink\n• 5 — flying\n• 6 — indestructible')).toBe(false);
    expect(bad('At the beginning of combat on your turn, roll a d6. For each other result, it gains the indicated ability until end of turn.\n• 2 — menace\n• 3 — vigilance\n• 4 — lifelink\n• 5 — flying\n• 6 — indestructible')).toBe(false);
    expect(bad('At the beginning of combat on your turn, draw a card. For each other result, it gains the indicated ability until end of turn.\n• 2 — menace\n• 3 — vigilance\n• 4 — lifelink\n• 5 — flying\n• 6 — indestructible')).toBe(false);
  });
});

describe('CR 706.2, 122.1, 111.1: Attempted Murder ("Roll X six-sided dice. For each even result, put two -1/-1 counters on that creature. For each odd result, create ... Storm Crow.")', () => {
  const MURDER = card('Test Botched Hit', 'Sorcery', 'Choose target creature. Roll X six-sided dice. For each even result, put two -1/-1 counters on that creature. For each odd result, create a 1/2 blue Bird creature token with flying named Storm Crow.', undefined, '{X}');
  const OX = card('Test Huge Ox', 'Creature — Ox', '', ['20', '20']);
  const game = (seed: string): GameState => mpScenario({ defs: [MURDER, OX], seed, zones: { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Botched Hit'] }, p2: { battlefield: ['Test Huge Ox'] } } });
  const cast = (s: GameState, x: number): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Botched Hit', 'hand', 'p1') }), { number: x, targets: [bf(s, 'Test Huge Ox', 'p2')[0]!] });
  const crows = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');

  it('compiles full', () => expect(full(MURDER)).toBe(true));
  it('X = 4: two -1/-1 counters on the target for each even result, one Storm Crow (1/2 blue Bird, flying) for each odd result', () => {
    for (const seed of SEEDS) {
      const s = cast(game(seed), 4);
      const r = rolledD6(s);
      expect(r.length, seed).toBe(4);
      const even = r.filter((x) => x % 2 === 0).length;
      expect(s.objects[bf(s, 'Test Huge Ox', 'p2')[0]!]!.counters['-1/-1'] ?? 0, `${seed}: ${r}`).toBe(2 * even);
      const c = crows(s);
      expect(c.length, `${seed}: ${r}`).toBe(4 - even);
      for (const id of c) {
        const ch = getChars(s, id)!;
        expect([ch.name, `${ch.power}/${ch.toughness}`, hasKeyword(ch, 'flying'), ch.colors], seed).toEqual(['Storm Crow', '1/2', true, ['U']]);
      }
    }
  });
  it('negative: X = 0 rolls no die, puts no counter and creates no Storm Crow', () => {
    const s = cast(game('edhn128-murder-0'), 0);
    expect(rolledD6(s)).toEqual([]);
    expect(s.objects[bf(s, 'Test Huge Ox', 'p2')[0]!]!.counters['-1/-1'] ?? 0).toBe(0);
    expect(crows(s)).toEqual([]);
  });
});

describe('CR 705.1, 608.2c, 120.2b: Mana Clash ("You and target opponent each flip a coin. ... Repeat this process until both players\' coins come up heads on the same flip.")', () => {
  const CLASH = card('Test Coin Quarrel', 'Sorcery', "You and target opponent each flip a coin. Test Coin Quarrel deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.", undefined, '{1}');
  const sides = (s: GameState, who: string): ('heads' | 'tails')[] => s.log.flatMap((l) => { const m = new RegExp(`^${who} flips a coin: (heads|tails)\\.`).exec(l.text); return m ? [m[1] as 'heads' | 'tails'] : []; });
  it('compiles full', () => expect(full(CLASH)).toBe(true));
  it('each run: both flip (nobody calls), each tails costs its player 1 life; it stops on the first run where both came up heads; the other opponents are not touched', () => {
    let long = 0;
    for (const seed of SEEDS) {
      const s0 = mpScenario({ defs: [CLASH], seed, zones: { p1: { battlefield: ['Plains'], hand: ['Test Coin Quarrel'] } } });
      const asked: Script['asked'] = [];
      const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Coin Quarrel', 'hand', 'p1') }), { targets: ['p2'], asked });
      const a = sides(s, 'Alice');
      const b = sides(s, 'Bob');
      expect(a.length, seed).toBe(b.length);
      expect(a.length, seed).toBeGreaterThan(0);
      for (let k = 0; k < a.length - 1; k++) expect(a[k] === 'heads' && b[k] === 'heads', `${seed}: run ${k} was not the last`).toBe(false);
      expect([a[a.length - 1], b[b.length - 1]], seed).toEqual(['heads', 'heads']);
      expect(lifeOf(s, 'p1'), seed).toBe(20 - a.filter((x) => x === 'tails').length);
      expect(lifeOf(s, 'p2'), seed).toBe(20 - b.filter((x) => x === 'tails').length);
      expect([lifeOf(s, 'p3'), lifeOf(s, 'p4')], seed).toEqual([20, 20]);
      expect(asked.some((x) => /call/i.test(x.prompt)), `${seed}: no call`).toBe(false);
      if (a.length > 2) long++;
    }
    expect(long, 'some seed ran three or more times').toBeGreaterThan(0);
  });
});

describe('CR 706.2, 706.3a, 608.2c: Revivify ("Roll a d20 and add the number of creature cards ... 1-14 | ... to your hand. 15+ | Return those cards from your graveyard to the battlefield.")', () => {
  const REVIVE = card('Test Second Wind', 'Instant', 'Roll a d20 and add the number of creature cards in your graveyard that were put there from the battlefield this turn.\n1—14 | Return all creature cards in your graveyard that were put there from the battlefield this turn to your hand.\n15+ | Return those cards from your graveyard to the battlefield.', undefined, '{0}');
  const WRATH = card('Test Clean Slate', 'Sorcery', 'Destroy all creatures.', undefined, '{0}');
  const LOOT = card('Test Shed Card', 'Sorcery', 'Discard a card.', undefined, '{0}');
  const BEAR = card('Test Grave Bear', 'Creature — Bear', '', ['2', '2']);
  const OLD = card('Test Old Bones', 'Creature — Zombie', '', ['2', '2']);
  const roll = (s: GameState): { natural: number; result: number } | undefined => { for (const l of s.log) { const m = /rolls a d20: (\d+)\./.exec(l.text); if (m) return { natural: Number(m[1]), result: Number(m[1]) }; } return undefined; };
  it('compiles full', () => expect(full(REVIVE)).toBe(true));
  it('three creatures died this turn: the d20 plus 3 picks the row; 1-14 returns them to the hand, 15+ to the battlefield; a creature card discarded this turn and one there from before stay', () => {
    const seen = new Set<string>();
    for (const seed of Array.from({ length: 40 }, (_, k) => `edhn128-revive-${k}`)) {
      let s = mpScenario({ defs: [REVIVE, WRATH, LOOT, BEAR, OLD], seed, zones: { p1: { battlefield: ['Test Grave Bear', 'Test Grave Bear', 'Test Grave Bear'], hand: ['Test Clean Slate', 'Test Second Wind', 'Test Shed Card', 'Test Old Bones'], graveyard: ['Test Old Bones'] } } });
      s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Clean Slate', 'hand', 'p1') }));
      s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Shed Card', 'hand', 'p1') }), { objects: (o, _p, st) => o.filter((id) => st.defs[st.objects[id]!.defId]!.name === 'Test Old Bones').slice(0, 1) });
      expect(s.zones.graveyard['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Old Bones').length, seed).toBe(2);
      s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Second Wind', 'hand', 'p1') }));
      const r = roll(s)!;
      const result = r.natural + 3;
      const where = result >= 15 ? 'battlefield' : 'hand';
      seen.add(where);
      const bears = (z: 'battlefield' | 'hand'): number => (z === 'battlefield' ? s.zones.battlefield : s.zones.hand['p1']!).filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Grave Bear').length;
      expect(bears(where), `${seed}: ${result}`).toBe(3);
      expect(s.zones.graveyard['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Old Bones').length, `${seed}: the discarded and the old card stay`).toBe(2);
    }
    expect([...seen].sort()).toEqual(['battlefield', 'hand']);
  });
  it('negative: "Return those cards ..." after a roll that adds nothing about the graveyard stays manual', () => {
    expect(full(card('Test Odd Wind', 'Instant', 'Roll a d20.\n1—14 | Draw a card.\n15+ | Return those cards from your graveyard to the battlefield.', undefined, '{0}'))).toBe(false);
  });
});

describe('CR 608.2d, 705.2, 608.2c: Squee\'s Revenge ("Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, ...")', () => {
  const SQ = card('Test Goblin Payback', 'Sorcery', 'Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.', undefined, '{0}');
  const results = (s: GameState): boolean[] => s.log.flatMap((l) => { const m = /flips (?:heads|tails): (wins|loses) the flip\./.exec(l.text); return m ? [m[1] === 'wins'] : []; });
  it('compiles full', () => expect(full(SQ)).toBe(true));
  it('the caster chooses N; the flips stop at the first loss or after N; all N won: 2N cards, else none', () => {
    let allWon = 0;
    let lostOne = 0;
    for (const seed of Array.from({ length: 40 }, (_, k) => `edhn128-squee-${k}`)) {
      for (const n of [1, 2, 3]) {
        const s0 = mpScenario({ defs: [SQ], seed, zones: { p1: { hand: ['Test Goblin Payback'] } } });
        const h0 = s0.zones.hand['p1']!.length;
        const asked: Script['asked'] = [];
        const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Goblin Payback', 'hand', 'p1') }), { number: n, asked, option: (o) => o.find((x) => x.id === 'heads')?.id ?? o[0]!.id });
        expect(asked.find((x) => x.kind === 'chooseNumber')?.who, seed).toBe('p1');
        const r = results(s);
        const firstLoss = r.indexOf(false);
        expect(r.length, `${seed}: ${n}`).toBe(firstLoss < 0 ? n : firstLoss + 1);
        const drawn = s.zones.hand['p1']!.length - (h0 - 1);
        if (firstLoss < 0) { expect(drawn, `${seed}: ${n} all won`).toBe(2 * n); allWon++; } else { expect(drawn, `${seed}: ${n} lost`).toBe(0); lostOne++; }
      }
    }
    expect(allWon).toBeGreaterThan(0);
    expect(lostOne).toBeGreaterThan(0);
  });
  it('negative: zero flips for 0 (nothing drawn); "until you win a flip" is not read this way', () => {
    const s0 = mpScenario({ defs: [SQ], seed: 'edhn128-squee-0', zones: { p1: { hand: ['Test Goblin Payback'] } } });
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Goblin Payback', 'hand', 'p1') }), { number: 0 });
    expect(results(s)).toEqual([]);
    expect(s.zones.hand['p1']!.length, 'nothing drawn').toBe(s0.zones.hand['p1']!.length - 1);
    expect(full(card('Test Odd Payback', 'Sorcery', 'Choose a number. Flip a coin that many times or until you win a flip, whichever comes first. If you win all the flips, draw two cards for each flip.', undefined, '{0}'))).toBe(false);
  });
});

describe('CR 608.2d, 613.1b, 701.26b: Scrambleverse ("For each nonland permanent, choose a player at random. Then each player gains control ... Untap those permanents.")', () => {
  const SCR = card('Test Shuffled Worlds', 'Sorcery', 'For each nonland permanent, choose a player at random. Then each player gains control of each permanent for which they were chosen. Untap those permanents.', undefined, '{0}');
  const BEAR = card('Test Tame Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Plain Rock', 'Artifact', '');
  const game = (seed: string): GameState => mpScenario({ defs: [SCR, BEAR, ROCK], seed, zones: {
    p1: { battlefield: [{ name: 'Test Tame Bear', tapped: true }, 'Test Plain Rock', { name: 'Plains', tapped: true }], hand: ['Test Shuffled Worlds'] },
    p2: { battlefield: ['Test Tame Bear', { name: 'Test Plain Rock', tapped: true }] }, p3: { battlefield: ['Test Tame Bear'] }, p4: { battlefield: ['Test Plain Rock'] } } });
  it('compiles full', () => expect(full(SCR)).toBe(true));
  it('every nonland permanent goes to a random player (any of the four, the old controller included), stays there after the turn, and untaps; lands keep their controller and stay tapped', () => {
    const gotBy = new Set<string>();
    let stayed = 0;
    for (const seed of SEEDS) {
      const s0 = game(seed);
      const nonland = s0.zones.battlefield.filter((id) => !getChars(s0, id)!.types.includes('Land'));
      const before = Object.fromEntries(nonland.map((id) => [id, s0.objects[id]!.controller]));
      const plains = s0.zones.battlefield.find((id) => getChars(s0, id)!.types.includes('Land'))!;
      let s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Shuffled Worlds', 'hand', 'p1') }));
      for (const id of nonland) {
        expect(s.objects[id]!.tapped, `${seed}: untapped`).toBe(false);
        gotBy.add(s.objects[id]!.controller);
        if (s.objects[id]!.controller === before[id]) stayed++;
      }
      expect(s.objects[plains]!.controller, seed).toBe('p1');
      expect(s.objects[plains]!.tapped, `${seed}: a land is not untapped`).toBe(true);
      const after = Object.fromEntries(nonland.map((id) => [id, s.objects[id]!.controller]));
      s = run(s, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
      for (const id of nonland) expect(s.objects[id]!.controller, `${seed}: the control change lasts`).toBe(after[id]);
    }
    expect([...gotBy].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(stayed, 'sometimes the old controller is chosen').toBeGreaterThan(0);
  });
});

describe('review fixes (CR 705.2, 614.1a): a capped run of flips under "the first time you flip one or more coins each turn, those coins come up heads and you win those flips"', () => {
  const SQ = card('Test Goblin Payback', 'Sorcery', 'Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.', undefined, '{0}');
  const SQ2 = card('Test Goblin Payback Two', 'Sorcery', 'Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.', undefined, '{0}');
  const LUCK = card('Test Lucky Charm', 'Artifact', 'The first time you flip one or more coins each turn, those coins come up heads and you win those flips.');
  const rigged = (s: GameState): number => s.log.filter((l) => /flips a coin: heads, and wins the flip\./.test(l.text)).length;
  const called = (s: GameState): number => s.log.filter((l) => /calls (?:heads|tails) and flips/.test(l.text)).length;
  it('only the first flip of the run is forced; the next ones are flipped as usual (one at a time)', () => {
    let sawLoss = 0;
    for (const seed of Array.from({ length: 20 }, (_, k) => `edhn128-luck-${k}`)) {
      const s0 = mpScenario({ defs: [SQ, LUCK], seed, zones: { p1: { battlefield: ['Test Lucky Charm'], hand: ['Test Goblin Payback'] } } });
      const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Goblin Payback', 'hand', 'p1') }), { number: 4, option: (o) => o.find((x) => x.id === 'heads')?.id ?? o[0]!.id });
      expect(rigged(s), seed).toBe(1);
      expect(called(s), seed).toBeGreaterThanOrEqual(1);
      if (s.log.some((l) => /loses the flip/.test(l.text))) sawLoss++;
    }
    expect(sawLoss, 'a later flip can be lost').toBeGreaterThan(0);
  });
  it('a run of zero flips does not use up the first time: the next run that turn still starts with a forced win', () => {
    let s = mpScenario({ defs: [SQ, SQ2, LUCK], seed: 'edhn128-luck-zero', zones: { p1: { battlefield: ['Test Lucky Charm'], hand: ['Test Goblin Payback', 'Test Goblin Payback Two'] } } });
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Goblin Payback', 'hand', 'p1') }), { number: 0 });
    expect(rigged(s)).toBe(0);
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Goblin Payback Two', 'hand', 'p1') }), { number: 2, option: (o) => o.find((x) => x.id === 'heads')?.id ?? o[0]!.id });
    expect(rigged(s)).toBe(1);
  });
});
