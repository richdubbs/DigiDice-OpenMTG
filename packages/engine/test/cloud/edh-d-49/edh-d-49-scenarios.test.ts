/**
 * Round edh-d-49 (Commander lane dice, second pass): the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. The dice are the state's seeded generator; each test reads the results rolled from the game's log and checks what the rules do with THAT result, over many seeds, so
 * both sides of every choice are played (the negative cases are the choices and results that must do nothing).
 *
 *   CR 706.2, 118.12          "After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn." (Night Shift of the Living Dead)
 *   CR 706.2, 118.12          "After you roll a die, you may remove a +1/+1 counter from this creature. If you do, increase or decrease the result by 1." (Xenosquirrels)
 *   CR 706.2, 706.6           "Once each turn, you may pay {1} to reroll one or more dice you rolled." (Monitor Monitor)
 *   CR 607.2a, 706.2          "Roll a d10. Return up to X cards from among cards exiled with this artifact to their owners' hands, where X is the result." (Bag of Devouring)
 *   CR 603.12, 706.2          "Roll a six-sided die. When you do, ~ deals 1 damage to each of up to X target creatures, where X is the result." (Slight Malfunction)
 *   CR 603.2c, 706.2          "Whenever you roll one or more dice, ... If any of those results was 10 or higher, draw a card." (Farideh, Devil's Chosen)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { activatedAbilities } from '../../../src/rules/abilities';
import { act, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}

/** The natural results of the dice rolled, in order, from the game's log ("X rolls a d12: 7."). A rerolled die logs "rerolls a d6: N" (kept apart in `rerolled`). */
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const rerolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rerolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const SEEDS = Array.from({ length: 30 }, (_, i) => `s${i}`);
type Script = { yes?: boolean | ((prompt: string) => boolean); option?: (ids: { id: string; label: string }[]) => string; targets?: (s: GameState) => { kind: 'object' | 'player'; id: string }[]; objects?: (options: string[], min: number, max: number) => string[] };
const asked: string[] = [];
/** Answer the decisions in front of us (payment automatic, yes/no by `yes`, the option `option` picks among the given ones) until a player has priority. */
function settle(s0: GameState, o: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending as unknown as { kind: string; prompt?: string; options: { id: string; label: string }[] & string[]; min: number; max: number; items: { id: string }[] };
    asked.push(`${p.kind}: ${p.prompt ?? ''}`);
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: typeof o.yes === 'function' ? o.yes(p.prompt ?? '') : o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.objects ? o.objects(p.options as unknown as string[], p.min, p.max) : (p.options as unknown as string[]).slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [o.option ? o.option(p.options as unknown as { id: string; label: string }[]) : (p.options as unknown as { id: string }[])[0]!.id] });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ? o.targets(s) : [] } as never);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min } as never);
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
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
const activatedAbilitiesOf = (s: GameState, id: ObjectId): string[] => activatedAbilities(s, s.objects[id]!).filter((i) => i.def.isMana !== true).map((i) => i.key);
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const lifeOf = (s: GameState, p = 'p1'): number => life(s, p);

const ROLL = card('Test Roller', 'Sorcery', 'Roll a d6. You gain life equal to the result.');
const ROLL2 = card('Test Pair Roller', 'Sorcery', 'Roll two six-sided dice. You gain life equal to the total of those results.');
const WATCH = card('Test Sixer', 'Enchantment', 'Whenever you roll a 6, create a 2/2 black Zombie creature token.');

// ---- Night Shift of the Living Dead -----------------------------------------------------------------------------------------------------------------------------------
const NIGHT = card('Test Night Shift', 'Enchantment', 'After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn.\nWhenever you roll a 6, create a 2/2 black Zombie creature token.');
describe('CR 706.2, 118.12: "After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn." (Night Shift of the Living Dead)', () => {
  const start = (seed: string): GameState => scenario([], { seed, defs: [NIGHT, ROLL, ROLL2], p1: { hand: ['Test Roller', 'Test Roller', 'Test Pair Roller'], battlefield: ['Test Night Shift'] } });
  const up = (o: { id: string; label: string }[]): string => o.find((x) => x.label.startsWith('Increase'))!.id;
  const down = (o: { id: string; label: string }[]): string => o.find((x) => x.label.startsWith('Decrease'))!.id;
  it('is fully automated', () => { expect(NIGHT.automation.level).toBe('full'); expect(ROLL.automation.level).toBe('full'); expect(ROLL2.automation.level).toBe('full'); });
  it('paying 1 life raises or lowers the result by 1: the life gained is the changed result; declining changes nothing', () => {
    for (const seed of SEEDS) {
      const s0 = start(seed);
      const natural = rolled(cast(s0, 'Test Roller', { yes: false }))[0]!;
      const declined = cast(s0, 'Test Roller', { yes: false });
      expect(lifeOf(declined), `${seed} declined`).toBe(20 + natural);
      const raised = cast(s0, 'Test Roller', { option: up });
      expect(lifeOf(raised), `${seed} +1 of ${natural}`).toBe(20 - 1 + natural + 1);
      const lowered = cast(s0, 'Test Roller', { option: down });
      expect(lifeOf(lowered), `${seed} -1 of ${natural}`).toBe(20 - 1 + natural - 1);
    }
  });
  it('the triggered "whenever you roll a 6" sees the changed result: a 5 raised to 6 makes a Zombie, a 6 lowered to 5 does not', () => {
    let five = false;
    let six = false;
    for (let i = 0; i < 200 && !(five && six); i++) {
      const s0 = start(`n${i}`);
      const natural = rolled(cast(s0, 'Test Roller', { yes: false }))[0]!;
      if (natural === 5) { five = true; expect(tokens(cast(s0, 'Test Roller', { option: up })), `n${i}`).toHaveLength(1); expect(tokens(cast(s0, 'Test Roller', { yes: false })), `n${i} declined`).toHaveLength(0); }
      if (natural === 6) { six = true; expect(tokens(cast(s0, 'Test Roller', { option: down })), `n${i}`).toHaveLength(0); expect(tokens(cast(s0, 'Test Roller', { yes: false })), `n${i} declined`).toHaveLength(1); }
    }
    expect([five, six]).toEqual([true, true]);
  });
  it('only once each turn: a second roll the same turn is not offered the option (the used-up turn counts even when the result was not changed)', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      asked.length = 0;
      let s = cast(start(seed), 'Test Roller', { option: up });
      const first = asked.filter((a) => a.startsWith('yesNo') && /1 life/i.test(a)).length;
      asked.length = 0;
      const before = lifeOf(s);
      s = cast(s, 'Test Roller', { option: up });
      expect(first, seed).toBe(1);
      expect(asked.filter((a) => a.startsWith('yesNo') && /1 life/i.test(a)), `${seed} second roll`).toHaveLength(0);
      expect(lifeOf(s), seed).toBe(before + rolled(s)[1]!);
    }
  });
  it('with two dice rolled at once the option changes the result of only ONE die: the total is changed by exactly 1', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const s0 = start(seed);
      const dice = rolled(cast(s0, 'Test Pair Roller', { yes: false }));
      expect(dice, seed).toHaveLength(2);
      const raised = cast(s0, 'Test Pair Roller', { option: up });
      expect(lifeOf(raised), `${seed} ${dice}`).toBe(20 - 1 + dice[0]! + dice[1]! + 1);
    }
  });
});

// ---- Xenosquirrels ---------------------------------------------------------------------------------------------------------------------------------------------------------
const SQUIRREL = card('Test Squirrel', 'Creature — Alien Squirrel', 'This creature enters with two +1/+1 counters on it.\nAfter you roll a die, you may remove a +1/+1 counter from this creature. If you do, increase or decrease the result by 1.', { pt: ['1', '1'] });
describe('CR 706.2, 118.12: "After you roll a die, you may remove a +1/+1 counter from this creature. If you do, increase or decrease the result by 1." (Xenosquirrels)', () => {
  const start = (seed: string, counters: number): GameState => scenario([], { seed, defs: [SQUIRREL, ROLL], p1: { hand: ['Test Roller', 'Test Roller'], battlefield: [{ name: 'Test Squirrel', counters: { '+1/+1': counters } }] } });
  const up = (o: { id: string; label: string }[]): string => o.find((x) => x.label.startsWith('Increase'))!.id;
  const counters = (s: GameState): number => s.objects[find(s, 'Test Squirrel', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  it('is fully automated', () => expect(SQUIRREL.automation.level).toBe('full'));
  it('removing a counter changes the result by 1 and costs the counter; it is offered every roll (no once-each-turn limit) until the counters run out', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      let s = cast(start(seed, 2), 'Test Roller', { option: up });
      const dice = rolled(s);
      expect(lifeOf(s), seed).toBe(20 + dice[0]! + 1);
      expect(counters(s), seed).toBe(1);
      s = cast(s, 'Test Roller', { option: up });
      expect(counters(s), `${seed} second roll`).toBe(0);
      expect(lifeOf(s), seed).toBe(20 + dice[0]! + 1 + rolled(s)[1]! + 1);
    }
  });
  it('with no counter left the option cannot be paid: the roll is as rolled, nothing is asked to change it', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      asked.length = 0;
      const s = cast(start(seed, 0), 'Test Roller', { option: up });
      expect(lifeOf(s), seed).toBe(20 + rolled(s)[0]!);
      expect(asked.filter((a) => a.startsWith('chooseOption')), seed).toHaveLength(0);
    }
  });
  it('declining leaves the counter and the result', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const s = cast(start(seed, 2), 'Test Roller', { yes: false });
      expect(counters(s), seed).toBe(2);
      expect(lifeOf(s), seed).toBe(20 + rolled(s)[0]!);
    }
  });
});

// ---- Monitor Monitor -------------------------------------------------------------------------------------------------------------------------------------------------------
const MONITOR = card('Test Monitor', 'Creature — Human Employee', 'Once each turn, you may pay {1} to reroll one or more dice you rolled.', { pt: ['1', '1'] });
describe('CR 706.2, 706.6: "Once each turn, you may pay {1} to reroll one or more dice you rolled." (Monitor Monitor)', () => {
  const start = (seed: string, extra: string[] = []): GameState => scenario([], { seed, defs: [MONITOR, ROLL, ROLL2, WATCH], p1: { hand: ['Test Roller', 'Test Roller', 'Test Pair Roller'], battlefield: ['Test Monitor', 'Plains', 'Plains', 'Plains', ...extra] } });
  it('is fully automated', () => expect(MONITOR.automation.level).toBe('full'));
  it('paying {1} rerolls the die: the result that counts is the new one, the original roll never happened (a rerolled 6 triggers nothing)', () => {
    let sixes = 0;
    for (let i = 0; i < 200 && sixes < 3; i++) {
      const s0 = start(`m${i}`, ['Test Sixer']);
      const declined = cast(s0, 'Test Roller', { yes: false });
      const natural = rolled(declined)[0]!;
      expect(lifeOf(declined), `m${i}`).toBe(20 + natural);
      const again = cast(s0, 'Test Roller', { yes: true });
      const fresh = rerolled(again);
      expect(fresh, `m${i}`).toHaveLength(1);
      expect(lifeOf(again), `m${i} ${natural} -> ${fresh[0]}`).toBe(20 + fresh[0]!);
      expect(tokens(again).length, `m${i}`).toBe(fresh[0] === 6 ? 1 : 0); // only the die that stays is rolled, whatever the first one showed
      if (natural === 6) sixes++;
    }
    expect(sixes, 'a natural 6 that was rerolled was played').toBeGreaterThan(0);
  });
  it('once each turn: the second roll of the turn is not offered the reroll; a Monitor of the opponent does not apply to my rolls', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      asked.length = 0;
      let s = cast(start(seed), 'Test Roller', { yes: true });
      expect(asked.filter((a) => a.startsWith('yesNo') && /pay \{1\}/.test(a)).length, seed).toBe(1);
      asked.length = 0;
      s = cast(s, 'Test Roller', { yes: true });
      expect(asked.filter((a) => a.startsWith('yesNo') && /pay \{1\}/.test(a)), `${seed} second`).toHaveLength(0);
      expect(rerolled(s), seed).toHaveLength(1);
    }
    const theirs = scenario([], { seed: 'opp', defs: [MONITOR, ROLL], p1: { hand: ['Test Roller'] }, p2: { battlefield: ['Test Monitor', 'Plains'] } });
    asked.length = 0;
    const s = cast(theirs, 'Test Roller', { yes: true });
    expect(rerolled(s)).toHaveLength(0);
    expect(asked.filter((a) => /pay \{1\}/.test(a))).toHaveLength(0);
  });
  it('one payment rerolls any of the dice rolled together: two dice, choose one to reroll, the other keeps its result', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s0 = start(seed);
      const first = rolled(cast(s0, 'Test Pair Roller', { yes: false }));
      const s = cast(s0, 'Test Pair Roller', { yes: true, option: (o) => o.find((x) => x.label.startsWith('Die 1'))!.id });
      const fresh = rerolled(s);
      expect(fresh, seed).toHaveLength(1);
      expect(lifeOf(s), seed).toBe(20 + fresh[0]! + first[1]!);
    }
  });
  it('without {1} to pay nothing is offered', () => {
    const s0 = scenario([], { seed: 'broke', defs: [MONITOR, ROLL], p1: { hand: ['Test Roller'], battlefield: ['Test Monitor'] } });
    asked.length = 0;
    const s = cast(s0, 'Test Roller', { yes: true });
    expect(rerolled(s)).toHaveLength(0);
    expect(lifeOf(s)).toBe(20 + rolled(s)[0]!);
  });
});

// ---- Slight Malfunction ----------------------------------------------------------------------------------------------------------------------------------------------
const MALFUNCTION = card('Test Malfunction', 'Sorcery', 'Choose one —\n• Destroy target artifact.\n• Roll a six-sided die. When you do, ~ deals 1 damage to each of up to X target creatures, where X is the result.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
describe('CR 603.12, 706.2: "Roll a six-sided die. When you do, ~ deals 1 damage to each of up to X target creatures, where X is the result." (Slight Malfunction)', () => {
  const start = (seed: string): GameState => scenario([], { seed, defs: [MALFUNCTION, BEAR], p1: { hand: ['Test Malfunction'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
  /** Cast the second mode and choose, for the reflexive trigger, as many targets as the announcement allows (or `take` of them) among the creatures offered. */
  const play = (seed: string, take?: number): { s: GameState; offered: number; roll: number; chosen: number } => {
    let offered = -1;
    let chosen = 0;
    let s = act(start(seed), { type: 'cast', player: 'p1', card: find(start(seed), 'Test Malfunction', 'hand', 'p1') });
    s = resolveAll(s, {
      option: (o) => o.find((x) => x.label.startsWith('Roll'))!.id,
      targets: (st) => {
        const p = st.pending as unknown as { objects: string[]; max: number };
        offered = p.max;
        const picks = p.objects.slice(0, Math.min(p.max, take ?? p.max));
        chosen = picks.length;
        return picks.map((id) => ({ kind: 'object' as const, id }));
      },
    });
    return { s, offered, roll: rolled(s)[0]!, chosen };
  };
  it('is fully automated', () => expect(MALFUNCTION.automation.level).toBe('full'));
  it('the number of targets that may be chosen is the result of the roll, and each creature chosen is dealt exactly 1 damage', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const { s, offered, roll, chosen } = play(seed);
      seen.add(roll);
      expect(offered, `${seed} rolled ${roll}`).toBe(roll);
      const damaged = s.zones.battlefield.filter((id) => s.objects[id]!.damage > 0);
      expect(damaged, `${seed} rolled ${roll}`).toHaveLength(chosen);
      for (const id of damaged) expect(s.objects[id]!.damage, seed).toBe(1);
    }
    expect(seen.size, 'the seeds roll several different results').toBeGreaterThanOrEqual(4);
  });
  it('choosing fewer targets than the result damages only those; the unchosen creatures are untouched', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const { s, roll, chosen } = play(seed, 1);
      expect(chosen, seed).toBe(1);
      expect(s.zones.battlefield.filter((id) => s.objects[id]!.damage > 0), `${seed} rolled ${roll}`).toHaveLength(1);
    }
  });
});

// ---- Farideh, Devil's Chosen ---------------------------------------------------------------------------------------------------------------------------------------
const FARIDEH = card('Test Warlock', 'Legendary Creature — Tiefling Warlock', 'Whenever you roll one or more dice, ~ gains flying and menace until end of turn. If any of those results was 10 or higher, draw a card.', { pt: ['2', '2'] });
const D20 = card('Test D20', 'Sorcery', 'Roll a d20.');
const THREE_D6 = card('Test Three Dice', 'Sorcery', 'Roll three six-sided dice.');
describe('CR 603.2c, 706.2: "If any of those results was 10 or higher, draw a card." (Farideh, Devil\'s Chosen)', () => {
  const start = (seed: string): GameState => scenario([], { seed, defs: [FARIDEH, D20, THREE_D6], p1: { hand: ['Test D20', 'Test Three Dice'], battlefield: ['Test Warlock'] } });
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is fully automated', () => expect(FARIDEH.automation.level).toBe('full'));
  it('a d20 of 10 or more draws a card, a lower one does not; flying and menace come either way', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = start(seed);
      const before = handSize(s0) - 1; // the roller leaves the hand as it is cast
      const s = cast(s0, 'Test D20');
      const roll = rolled(s)[0]!;
      seen.add(roll >= 10 ? 'high' : 'low');
      expect(handSize(s), `${seed} rolled ${roll}`).toBe(before + (roll >= 10 ? 1 : 0));
      expect(kws(s, find(s, 'Test Warlock', 'battlefield', 'p1')), seed).toEqual(expect.arrayContaining(['flying', 'menace']));
    }
    expect([...seen].sort(), 'high and low rolls are played').toEqual(['high', 'low']);
  });
  it('three dice that all show less than 10 never draw (the dice are summed only for the amount, never for this comparison)', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s0 = start(seed);
      const before = handSize(s0) - 1;
      const s = cast(s0, 'Test Three Dice');
      const dice = rolled(s);
      expect(dice, seed).toHaveLength(3);
      expect(handSize(s), `${seed} ${dice}`).toBe(before);
    }
  });
});

// ---- Bag of Devouring ----------------------------------------------------------------------------------------------------------------------------------------------
const BAG = card('Test Bag', 'Artifact', "Whenever you sacrifice another nontoken artifact or creature, exile it.\n{2}, {T}, Sacrifice another artifact or creature: Draw a card.\n{3}, {T}, Sacrifice this artifact: Roll a d10. Return up to X cards from among cards exiled with this artifact to their owners' hands, where X is the result.");
describe('CR 607.2a, 706.2: "Return up to X cards from among cards exiled with this artifact to their owners\' hands, where X is the result." (Bag of Devouring)', () => {
  const start = (seed: string): GameState => scenario([], { seed, defs: [BAG, BEAR], p1: { battlefield: ['Test Bag', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
  const abilityKey = (s: GameState, which: number): string => activatedAbilitiesOf(s, find(s, 'Test Bag', 'battlefield', 'p1'))[which]!;
  it('is fully automated', () => expect(BAG.automation.level).toBe('full'));
  it('returns as many of the exiled cards as the result allows (at most the cards there are), to their owners\' hands, and a card exiled with it stays exiled when not chosen', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      let s = start(seed);
      // sacrifice two Bears to the draw ability: each is exiled with the Bag by its trigger (two activations need {2} and the Bag untapped: untap between)
      for (let k = 0; k < 2; k++) {
        const bag = find(s, 'Test Bag', 'battlefield', 'p1');
        s.objects[bag]!.tapped = false;
        const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
        s = resolveAll(act(s, { type: 'activate', player: 'p1', source: bag, ability: abilityKey(s, 0) }), { objects: (o) => [o.find((id) => bears.includes(id)) ?? o[0]!] });
      }
      expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1'), seed).toHaveLength(2);
      const bag = find(s, 'Test Bag', 'battlefield', 'p1');
      s.objects[bag]!.tapped = false;
      const handBefore = s.zones.hand['p1']!.length;
      s = resolveAll(act(s, { type: 'activate', player: 'p1', source: bag, ability: abilityKey(s, 1) }), { objects: (o, _min, max) => o.slice(0, max) });
      const roll = rolled(s).at(-1)!;
      const back = Math.min(roll, 2);
      seen.add(`${back}`);
      expect(s.zones.hand['p1']!.length - handBefore, `${seed} rolled ${roll}`).toBe(back);
      expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1'), `${seed} rolled ${roll}`).toHaveLength(2 - back);
    }
    expect([...seen].sort(), 'results of 1, and of 2 or more are played').toEqual(['1', '2']);
  });
});

// ---- Clay Golem ------------------------------------------------------------------------------------------------------------------------------------------------------
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '{6}, Roll a d8: Monstrosity X, where X is the result. (If this creature isn\'t monstrous, put X +1/+1 counters on it and it becomes monstrous.)\nBerserk — When this creature becomes monstrous, destroy target permanent.', { pt: ['4', '4'] });
describe('CR 706.2, 602.2b, 701.37a: "{6}, Roll a d8: Monstrosity X, where X is the result." (Clay Golem)', () => {
  const start = (seed: string, extra: string[] = []): GameState => scenario([], { seed, defs: [GOLEM, BEAR, NIGHT], p1: { battlefield: ['Test Golem', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', ...extra] }, p2: { battlefield: ['Test Bear'] } });
  const activate = (s: GameState, o: Script = {}): GameState => {
    const id = find(s, 'Test Golem', 'battlefield', 'p1');
    return resolveAll(act(s, { type: 'activate', player: 'p1', source: id, ability: activatedAbilitiesOf(s, id)[0]! }), { targets: (st) => { const p = st.pending as unknown as { objects: string[] }; return [{ kind: 'object', id: p.objects.includes(find(st, 'Test Bear', 'battlefield', 'p2')) ? find(st, 'Test Bear', 'battlefield', 'p2') : p.objects[0]! }]; }, ...o });
  };
  const counters = (s: GameState): number => s.objects[find(s, 'Test Golem', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  it('is fully automated', () => expect(GOLEM.automation.level).toBe('full'));
  it('the die is rolled as the cost is paid and its result is X: that many +1/+1 counters, the Golem becomes monstrous and its trigger destroys the target', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const s = activate(start(seed));
      const roll = rolled(s)[0]!;
      seen.add(roll);
      expect(counters(s), `${seed} rolled ${roll}`).toBe(roll);
      expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear' && s.objects[id]!.owner === 'p2'), seed).toBe(false);
    }
    expect(seen.size, 'several results are played').toBeGreaterThanOrEqual(5);
  });
  it('a Golem that is already monstrous still rolls the die as the cost, but gets no counters and its trigger does not happen again', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const once = activate(start(seed));
      const before = counters(once);
      let again = once;
      again.objects[find(again, 'Test Golem', 'battlefield', 'p1')]!.tapped = false;
      put(again, 'p2', 'battlefield', 'Test Bear');
      again = activate(again);
      expect(rolled(again), seed).toHaveLength(2);
      expect(counters(again), seed).toBe(before);
    }
  });
  it('the roller\'s after-roll options apply to the die of a cost: Night Shift raises the result of the roll, so X is one more', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s0 = start(seed, ['Test Night Shift']);
      const s = activate(s0, { option: (o) => o.find((x) => x.label.startsWith('Increase'))!.id });
      const roll = rolled(s)[0]!;
      expect(counters(s), `${seed} rolled ${roll}`).toBe(roll + 1);
    }
  });
});

// ---- Iron Mastiff ----------------------------------------------------------------------------------------------------------------------------------------------------
const MASTIFF = card('Test Mastiff', 'Artifact Creature — Dog', 'Whenever this creature attacks, roll a d20 for each player being attacked and ignore all but the highest roll.\n1-9 | This creature deals damage equal to its power to you.\n10-19 | This creature deals damage equal to its power to defending player.\n20 | This creature deals damage equal to its power to each opponent.', { pt: ['3', '3'] });
describe('CR 706.2, 706.6, 506.3: "roll a d20 for each player being attacked and ignore all but the highest roll" (Iron Mastiff)', () => {
  const setup = (seed: string): GameState => mpScenario({ players: 3, seed, defs: [MASTIFF, BEAR], zones: { p1: { battlefield: ['Test Mastiff', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  const toAttack = (s0: GameState): GameState => { let s = s0; for (let guard = 0; guard < 80 && s.pending?.kind !== 'declareAttackers'; guard++) s = s.pending!.kind === 'priority' ? pass(s) : settle(s); return s; };
  /** Attack with the Mastiff at p2 (and the Bear at p3 when `both`), resolve the trigger; the dice rolled by it, kept and not. */
  const play = (seed: string, both: boolean): { s: GameState; rolls: number[]; kept: number } => {
    let s = toAttack(setup(seed));
    const m = find(s, 'Test Mastiff', 'battlefield', 'p1');
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: m, defender: 'p2' }, ...(both ? [{ attacker: b, defender: 'p3' }] : [])] });
    s = resolveAll(s);
    const line = s.log.map((l) => l.text).find((t) => /rolls (\d+) d20 \(([\d, ]+)\) and ignores/.test(t));
    if (line) {
      const m2 = /rolls (\d+) d20 \(([\d, ]+)\) and ignores .*: (\d+)\./.exec(line)!;
      return { s, rolls: m2[2]!.split(', ').map(Number), kept: Number(m2[3]) };
    }
    const r = rolled(s);
    return { s, rolls: r, kept: r[0]! };
  };
  it('is fully automated', () => expect(MASTIFF.automation.level).toBe('full'));
  it('one player attacked: one die; two players attacked: two dice and only the highest counts, which picks the row', () => {
    let twoSeen = false;
    for (const seed of SEEDS) {
      const one = play(seed, false);
      expect(one.rolls, `${seed} one player`).toHaveLength(1);
      const two = play(seed, true);
      expect(two.rolls, `${seed} two players`).toHaveLength(2);
      expect(two.kept, seed).toBe(Math.max(...two.rolls));
      twoSeen = twoSeen || two.rolls[0] !== two.rolls[1];
      for (const { s, kept } of [{ s: one.s, kept: one.kept }, { s: two.s, kept: two.kept }]) {
        const dmg = [life(s, 'p1'), life(s, 'p2'), life(s, 'p3')].map((l) => 20 - l);
        expect(dmg, `${seed} kept ${kept}`).toEqual(kept <= 9 ? [3, 0, 0] : kept <= 19 ? [0, 3, 0] : [0, 3, 3]);
      }
    }
    expect(twoSeen).toBe(true);
  });
  it('no player attacked: no die is rolled', () => {
    let s = toAttack(setup('none'));
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    s = resolveAll(s);
    expect(rolled(s)).toHaveLength(0);
  });
});
