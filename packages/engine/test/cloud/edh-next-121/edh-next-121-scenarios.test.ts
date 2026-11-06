/**
 * Round edh-next-121 (must-finish round "dice, coins and random"): the behaviour it added, played through the engine with synthetic cards (invented names, the printed
 * wordings of the real cards), compiled by the game's default compiler, in four-player games. The dice and coins are the state's seeded generator: each test reads the
 * results from the game's log and checks what the rules do with THAT result, over many seeds, so every row of a table (and the negative cases: the rows and answers that
 * must do nothing) is played.
 *
 *   CR 706.2, 706.3a, 608.2d, 707.2, 111.1   Delina, Wild Mage: "choose target creature you control, then roll a d20. 1-14 | Create a tapped and attacking token that's a copy of
 *                                             that creature, except ... 15-20 | Create one of those tokens. You may roll again." (rulings 2021-07-23: rolling again is optional)
 *   CR 706.3a, 107.3, 608.2h, 406.1, 701.24a,  Wand of Wonder: "Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then
 *   608.2g, 118.9                             shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying
 *                                             their mana costs. 1-9 | X is one. 10-19 | X is two. 20 | X is three."
 *   CR 706.2, 706.3a, 115.9a, 115.7d, 707.10,  Wyll's Reversal: "Choose target spell or ability with one or more targets. Roll a d20 and add the greatest power among creatures you
 *   707.10c                                   control. 1-14 | You may choose new targets for that spell or ability. 15+ | You may choose new targets for that spell or ability. Then copy
 *                                             it. You may choose new targets for the copy." (rulings 2022-06-10: you control the copy, it may get new targets, it resolves first)
 *   CR 705.2, 712.14a, 400.7, 614.1c, 306.5b,  Ral, Monsoon Mage // Ral, Leyline Prodigy: the won flip "you may exile Ral. If you do, return him to the battlefield transformed under his
 *   601.2f, 611.2a, 601.3, 118.9              owner's control"; "Ral enters with an additional loyalty counter on him for each instant and sorcery spell you've cast this turn"; "+1: Until
 *                                             your next turn, instant and sorcery spells you cast cost {1} less to cast"; "-8: ... You may cast instant and sorcery spells from among them this
 *                                             turn without paying their mana costs" (rulings 2024-06-07)
 *   CR 608.2d, 406.1, 101.4, 608.2g, 118.9,    Kefka, Dancing Mad: "At the beginning of your end step, exile a card at random from each opponent's graveyard. You may cast any number of spells
 *   400.7h, 119.3, 202.3                      from among cards exiled this way without paying their mana costs. Then each player who owns a spell you cast this way loses life equal to its
 *                                             mana value." (rulings 2025-06-06: cards not cast stay exiled; cast one at a time, as the ability resolves)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities } from '../../../src/rules/abilities';
import { getChars, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { compileCard, type OracleCard } from '../../../src/index';
import { passUntil } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const SEEDS = Array.from({ length: 30 }, (_, i) => `edhn121-${i}`);
/** The natural results of the dice rolled, in order, from the game's log ("X rolls a d20: 7."). */
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

interface Script {
  targets?: ObjectId[];
  yes?: (prompt: string, who: PlayerId) => boolean;
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId, max: number) => ObjectId[];
  option?: (options: { id: string; label: string }[], prompt: string) => string;
  /** Keeps passing priority (and declares no blockers) until this holds, as well as emptying the stack. */
  until?: (state: GameState) => boolean;
  /** Every yes/no prompt seen, in order. */
  asked?: string[];
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
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') { sc.asked?.push(d.prompt); a = { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt, d.player) : true }; }
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player, d.max ?? o.length) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      a = { kind: 'chooseOption', ids: [sc.option ? sc.option(o, d.prompt) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const attack = (s: GameState, id: ObjectId, defender: PlayerId): GameState => declareAttackers(toDeclareAttackers(s), [[id, defender]]);
const supertypes = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.supertypes as string[];

describe('CR 706.3a, 706.2, 608.2d, 707.2: Delina, Wild Mage ("choose target creature you control, then roll a d20 ... You may roll again.")', () => {
  const MAGE = card('Test Wild Mage', 'Legendary Creature — Elf Shaman', 'Whenever Test Wild Mage attacks, choose target creature you control, then roll a d20.\n1—14 | Create a tapped and attacking token that\'s a copy of that creature, except it\'s not legendary and it has "At end of combat, exile this token."\n15—20 | Create one of those tokens. You may roll again.', ['3', '2'], '{3}{R}');
  const HERO = card('Test Legend Hero', 'Legendary Creature — Human Knight', '', ['2', '2']);
  const defs = [MAGE, HERO];
  /** p1 attacks p2 with the mage, its trigger targets the legendary hero; `again` answers "roll again?". Stops in the declare blockers step (tokens on the battlefield). */
  const play = (seed: string, again: boolean, asked: string[] = []): GameState => {
    const s0 = mpScenario({ defs, seed, zones: { p1: { battlefield: ['Test Wild Mage', 'Test Legend Hero'] } } });
    const hero = bf(s0, 'Test Legend Hero')[0]!;
    return run(attack(s0, bf(s0, 'Test Wild Mage')[0]!, 'p2'), { targets: [hero], yes: (pr) => (/again/i.test(pr) ? again : true), asked, until: (x) => x.turn.step !== 'declareAttackers' });
  };

  it('compiles full (the roll, both rows, the copy with its exceptions, "one of those tokens" and "you may roll again")', () => {
    expect(full(MAGE)).toBe(true);
    const roll = (MAGE.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; table: { again?: string; do: { op: string; count?: number }[] }[] }[] } }).effect.steps[0]!;
    expect(roll.op).toBe('rollDie');
    expect(roll.table.map((r) => r.again ?? null)).toEqual([null, 'may']);
    expect(roll.table.map((r) => r.do.map((x) => x.op))).toEqual([['copy'], ['copy']]);
  });

  it('rolls once per token, again only after a 15-20 and only when its controller says so; the last roll of a chain is 1-14 (or declined)', () => {
    let rerolled = 0;
    for (const seed of SEEDS) {
      for (const again of [true, false]) {
        const asked: string[] = [];
        const s = play(seed, again, asked);
        const r = rolled(s);
        const toks = tokensOf(s, 'p1');
        expect(r.length, seed).toBeGreaterThan(0);
        expect(toks.length, `${seed}: one token for each roll`).toBe(r.length);
        const offers = asked.filter((x) => /again/i.test(x)).length;
        // every roll but the last is a 15-20 (the reroll is offered only on that row)
        r.slice(0, -1).forEach((x) => expect(x, seed).toBeGreaterThanOrEqual(15));
        if (again) {
          expect(r[r.length - 1]!, `${seed}: the chain ends on a 1-14`).toBeLessThanOrEqual(14);
          expect(offers).toBe(r.length - 1);
          if (r.length > 1) rerolled++;
        } else {
          expect(r.length, `${seed}: declined, one roll`).toBe(1);
          expect(offers, seed).toBe(r[0]! >= 15 ? 1 : 0); // the offer exists only on 15-20
        }
      }
    }
    expect(rerolled, 'some seed rolled again').toBeGreaterThan(0);
  });

  it('each token is a tapped and attacking copy of the target that is not legendary (the legend rule keeps them all) and is exiled at end of combat', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      let s = play(seed, true);
      const toks = tokensOf(s, 'p1');
      const hero = bf(s, 'Test Legend Hero')[0]!;
      expect(hero, 'the original stays').toBeDefined();
      for (const t of toks) {
        expect(s.objects[t]!.tapped, seed).toBe(true);
        expect(s.combat?.attackers.some((a) => a.id === t), `${seed}: attacking`).toBe(true);
        expect(getChars(s, t)!.name).toBe('Test Legend Hero');
        expect(supertypes(s, t)).not.toContain('Legendary');
        expect(supertypes(s, hero)).toContain('Legendary');
      }
      s = run(s, { until: (x) => x.turn.step === 'main2' });
      expect(tokensOf(s, 'p1'), `${seed}: exiled at end of combat`).toEqual([]);
      expect(bf(s, 'Test Legend Hero').length).toBe(1);
    }
  });

  it('the token copies the chosen creature, not the mage (ruling: it attacks a player of your choice, not necessarily the one the mage attacks)', () => {
    const s = play(SEEDS[0]!, false);
    const t = tokensOf(s, 'p1')[0]!;
    expect(getChars(s, t)!.name).toBe('Test Legend Hero');
    expect(s.combat?.attackers.find((a) => a.id === t)?.defender).toBeDefined();
  });
});

describe('CR 706.3a, 107.3, 608.2h, 406.1, 701.24a, 608.2g: Wand of Wonder (rows that define X; each opponent exiles until an instant or sorcery, shuffles the rest)', () => {
  const WAND = card('Test Wonder Wand', 'Artifact', '{4}, {T}: Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.\n1—9 | X is one.\n10—19 | X is two.\n20 | X is three.', undefined, '{3}{R}');
  const HEAL = card('Test Quick Heal', 'Instant', 'You gain 3 life.', undefined, '{5}{W}');
  const ROCK = card('Test Garden Rock', 'Artifact', '', undefined, '{1}');
  const defs = [WAND, HEAL, ROCK];
  const OPPS: PlayerId[] = ['p2', 'p3', 'p4'];
  const lib = { library: ['Test Garden Rock', 'Test Garden Rock', 'Test Quick Heal', 'Test Garden Rock'] };
  const start = (seed: string): GameState => mpScenario({ defs, seed, zones: { p1: { battlefield: ['Test Wonder Wand', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: lib, p3: lib, p4: lib } });
  const activate = (s0: GameState, sc: Script): GameState => {
    const wand = bf(s0, 'Test Wonder Wand')[0]!;
    return run(mact(s0, { type: 'activate', player: 'p1', source: wand, ability: activatedAbilities(s0, s0.objects[wand]!)[0]!.key } as never), sc);
  };
  const libSize = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
  const exiled = (s: GameState, owner: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === owner).map((id) => s.objects[id]!.defId);
  const yard = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const xOf = (r: number): number => (r <= 9 ? 1 : r <= 19 ? 2 : 3);

  it('compiles full: the rows fix X, the instructions between the roll and the rows read it', () => {
    expect(full(WAND)).toBe(true);
    const steps = (WAND.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; table?: { do: { op: string; value?: number }[] }[] }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['rollDie', 'exileUntil', 'move', 'shuffle', 'chooseObjects', 'cast']);
    expect(steps[0]!.table!.map((r) => r.do.map((x) => `${x.op}=${x.value}`))).toEqual([['let=1'], ['let=2'], ['let=3']]);
  });

  it('each opponent exiles down to their first instant or sorcery card and shuffles the rest back; you cast up to X of them (X from the roll), the others stay exiled', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 120 && seen.size < 3; k++) {
      const s0 = start(`edhn121-wand-${k}`);
      const before = Object.fromEntries(OPPS.map((p) => [p, libSize(s0, p)]));
      const s = activate(s0, { objects: (options, _pr, _st, who, max) => (who === 'p1' ? options.slice(0, max) : []) });
      const r = rolled(s);
      expect(r.length).toBe(1);
      const x = xOf(r[0]!);
      seen.add(x);
      let cast = 0;
      for (const p of OPPS) {
        expect(libSize(s, p), `${p}: every card but the hit back in the library`).toBe(before[p]! - 1);
        const inYard = yard(s, p).filter((n) => n === 'Test Quick Heal').length;
        const inExile = exiled(s, p);
        expect(inYard + inExile.filter((n) => n === 'Test Quick Heal').length, `${p}: the hit was exiled`).toBe(1);
        expect(inExile.filter((n) => n !== 'Test Quick Heal'), `${p}: no other card stays in exile`).toEqual([]);
        cast += inYard;
      }
      expect(cast, `roll ${r[0]}: up to X (=${x}) spells cast`).toBe(Math.min(x, 3));
      expect(lifeOf(s, 'p1'), 'each cast spell is yours (you gain the life)').toBe(lifeOf(s0, 'p1') + 3 * cast);
      OPPS.forEach((p) => expect(lifeOf(s, p)).toBe(lifeOf(s0, p)));
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('casting is optional: choosing none casts nothing and every hit stays in exile', () => {
    const s0 = start('edhn121-wand-none');
    const s = activate(s0, { objects: () => [] });
    for (const p of OPPS) expect(exiled(s, p)).toEqual(['Test Quick Heal']);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe("CR 706.2, 706.3a, 115.9a, 115.7d, 707.10: Wyll's Reversal (target spell or ability with one or more targets; d20 + the greatest power; new targets, then a copy)", () => {
  const WYLL = card("Test Reversal", 'Instant', 'Choose target spell or ability with one or more targets. Roll a d20 and add the greatest power among creatures you control.\n1—14 | You may choose new targets for that spell or ability.\n15+ | You may choose new targets for that spell or ability. Then copy it. You may choose new targets for the copy.', undefined, '{0}');
  const DRAIN = card('Test Life Siphon', 'Instant', 'Target player loses 2 life and you gain 2 life.', undefined, '{0}');
  const BLESS = card('Test Small Blessing', 'Instant', 'You gain 1 life.', undefined, '{0}');
  const PINGER = card('Test Pinger', 'Artifact', '{T}: Target player loses 1 life.', undefined, '{0}');
  const TITAN = card('Test Titan', 'Creature — Giant', '', ['14', '14']);
  const SPROUT = card('Test Sprout', 'Creature — Plant', '', ['0', '1']);
  const defs = [WYLL, DRAIN, BLESS, PINGER, TITAN, SPROUT];
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  /** Answer the decisions in front of us (targets from the queue, the rest automatic) until a player has priority. */
  const settle = (s0: GameState, targets: { kind: 'player' | 'object'; id: string }[][] = [], yes = true): GameState => {
    let s = s0;
    for (let g = 0; g < 40 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as unknown as { kind: string; prompt: string };
      if (p.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] } as DecisionAnswer);
      else if (p.kind === 'yesNo') s = manswer(s, { kind: 'yesNo', yes });
      else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  /** Pass priority (answering with `targets`) until the stack is empty. */
  const resolveAll = (s0: GameState, targets: { kind: 'player' | 'object'; id: string }[][] = [], yes = true): GameState => {
    let s = settle(s0, targets, yes);
    for (let g = 0; g < 60 && s.zones.stack.length > 0; g++) s = settle(mpass(s), targets, yes);
    return s;
  };
  const top = (s: GameState): ObjectId => s.zones.stack[s.zones.stack.length - 1]!;
  const P = (id: PlayerId) => ({ kind: 'player' as const, id });
  const O = (id: ObjectId) => ({ kind: 'object' as const, id });
  const cast = (s: GameState, who: PlayerId, name: string, targets: { kind: 'player' | 'object'; id: string }[][]): GameState => settle(mact(s, { type: 'cast', player: who, card: mfind(s, name, 'hand', who) }), targets);

  it('compiles full', () => expect(full(WYLL)).toBe(true));

  it('15+ (a 14-power creature: always): new targets for your own spell, then a copy you control with new targets; the copy resolves first', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const s0 = mpScenario({ defs, seed, zones: { p1: { hand: ['Test Life Siphon', 'Test Reversal'], battlefield: ['Test Titan'] } } });
      let s = cast(s0, 'p1', 'Test Life Siphon', [[P('p2')]]);
      const siphon = top(s);
      s = cast(s, 'p1', 'Test Reversal', [[O(siphon)]]);
      const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
      s = resolveAll(s, [[P('p3')], [P('p4')]]);
      expect(rolled(s).length).toBe(1);
      expect(lifeOf(s, 'p2'), seed).toBe(before.p2);
      expect(lifeOf(s, 'p3'), `${seed}: the original's new target`).toBe(before.p3! - 2);
      expect(lifeOf(s, 'p4'), `${seed}: the copy's new target`).toBe(before.p4! - 2);
      expect(lifeOf(s, 'p1'), `${seed}: you gain twice`).toBe(before.p1! + 4);
    }
  });

  it("an opponent's spell: the original keeps its controller (they gain), the copy is yours (you gain); declining new targets keeps them", () => {
    const s0 = mpScenario({ defs, seed: SEEDS[1], zones: { p1: { hand: ['Test Reversal'], battlefield: ['Test Titan'] }, p2: { hand: ['Test Life Siphon'] } } });
    let s = mpass(s0); // p2 has priority
    s = cast(s, 'p2', 'Test Life Siphon', [[P('p1')]]);
    for (let g = 0; g < 6 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); g++) s = mpass(s);
    const siphon = top(s);
    s = cast(s, 'p1', 'Test Reversal', [[O(siphon)]]);
    const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
    // the original is turned on p3; the copy (yours) on p4
    s = resolveAll(s, [[P('p3')], [P('p4')]]);
    expect(lifeOf(s, 'p3')).toBe(before.p3! - 2);
    expect(lifeOf(s, 'p4')).toBe(before.p4! - 2);
    expect(lifeOf(s, 'p2'), 'the original is still theirs').toBe(before.p2! + 2);
    expect(lifeOf(s, 'p1'), 'the copy is yours, it does not hit you').toBe(before.p1! + 2);
  });

  it('an activated ability is a legal target and is copied too (15+)', () => {
    const s0 = mpScenario({ defs, seed: SEEDS[2], zones: { p1: { hand: ['Test Reversal'], battlefield: ['Test Titan', 'Test Pinger'] } } });
    const pinger = bf(s0, 'Test Pinger')[0]!;
    let s = settle(mact(s0, { type: 'activate', player: 'p1', source: pinger, ability: activatedAbilities(s0, s0.objects[pinger]!)[0]!.key } as never), [[P('p2')]]);
    const ping = top(s);
    s = cast(s, 'p1', 'Test Reversal', [[O(ping)]]);
    const before = Object.fromEntries((['p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
    s = resolveAll(s, [[P('p3')], [P('p4')]]);
    expect(lifeOf(s, 'p2')).toBe(before.p2);
    expect(lifeOf(s, 'p3')).toBe(before.p3! - 1);
    expect(lifeOf(s, 'p4')).toBe(before.p4! - 1);
  });

  it('1-14 (no creatures, natural results only): new targets, never a copy; 15-20: both. The modifier is the greatest power (a 0-power creature adds 0)', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = mpScenario({ defs, seed, zones: { p1: { hand: ['Test Life Siphon', 'Test Reversal'], battlefield: ['Test Sprout'] } } });
      let s = cast(s0, 'p1', 'Test Life Siphon', [[P('p2')]]);
      s = cast(s, 'p1', 'Test Reversal', [[O(top(s))]]);
      const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
      s = resolveAll(s, [[P('p3')], [P('p4')]]);
      const r = rolled(s)[0]!;
      const copied = r >= 15;
      seen.add(copied ? 'copy' : 'retarget');
      expect(lifeOf(s, 'p2'), seed).toBe(before.p2);
      expect(lifeOf(s, 'p3'), seed).toBe(before.p3! - 2);
      expect(lifeOf(s, 'p4'), `${seed} rolled ${r}`).toBe(before.p4! - (copied ? 2 : 0));
      expect(lifeOf(s, 'p1')).toBe(before.p1! + (copied ? 4 : 2));
    }
    expect([...seen].sort()).toEqual(['copy', 'retarget']);
  });

  it('NEGATIVE: a spell with no targets is not a legal target (with nothing else on the stack it cannot be cast)', () => {
    const s0 = mpScenario({ defs, seed: SEEDS[3], zones: { p1: { hand: ['Test Small Blessing', 'Test Reversal'] } } });
    const s = cast(s0, 'p1', 'Test Small Blessing', []);
    expect(() => mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Reversal', 'hand', 'p1') })).toThrow();
  });

  it('CR 115.9a, the same reading of the target count: "target spell or ability with a single target" (Bolt Bend) now takes an ability with one target, never one with none', () => {
    const BEND = card('Test Bend', 'Instant', 'Change the target of target spell or ability with a single target.', undefined, '{0}');
    const GLOW = card('Test Glow Stone', 'Artifact', '{T}: You gain 1 life.', undefined, '{0}');
    const s0 = mpScenario({ defs: [...defs, BEND, GLOW], seed: SEEDS[5], zones: { p1: { hand: ['Test Bend'], battlefield: ['Test Pinger', 'Test Glow Stone'] } } });
    const pinger = bf(s0, 'Test Pinger')[0]!;
    let s = settle(mact(s0, { type: 'activate', player: 'p1', source: pinger, ability: activatedAbilities(s0, s0.objects[pinger]!)[0]!.key } as never), [[P('p2')]]);
    s = cast(s, 'p1', 'Test Bend', [[O(top(s))]]);
    const before = lifeOf(s, 'p3');
    s = resolveAll(s, [[P('p3')]]);
    expect(lifeOf(s, 'p3'), 'the ping was turned on p3').toBe(before - 1);
    // an ability with no target is no legal target
    const glow = bf(s0, 'Test Glow Stone')[0]!;
    const t = settle(mact(s0, { type: 'activate', player: 'p1', source: glow, ability: activatedAbilities(s0, s0.objects[glow]!)[0]!.key } as never));
    expect(() => mact(t, { type: 'cast', player: 'p1', card: mfind(t, 'Test Bend', 'hand', 'p1') })).toThrow();
  });

  it('declining new targets keeps the original target; the copy may keep it too', () => {
    const s0 = mpScenario({ defs, seed: SEEDS[4], zones: { p1: { hand: ['Test Life Siphon', 'Test Reversal'], battlefield: ['Test Titan'] } } });
    let s = cast(s0, 'p1', 'Test Life Siphon', [[P('p2')]]);
    s = cast(s, 'p1', 'Test Reversal', [[O(top(s))]]);
    const before = lifeOf(s, 'p2');
    s = resolveAll(s, [], false);
    expect(lifeOf(s, 'p2'), 'hit twice: the original and the copy both keep p2').toBe(before - 4);
  });
});

describe('CR 705.2, 712.14a, 614.1c, 306.5b, 601.2f, 601.3: Ral, Monsoon Mage // Ral, Leyline Prodigy', () => {
  const RAL = compileCard({
    name: 'Test Storm Mage // Test Storm Prodigy', layout: 'transform', mana_cost: '', type_line: 'Legendary Creature — Human Wizard // Legendary Planeswalker — Ral', oracle_text: '', colors: ['R'], keywords: [],
    card_faces: [
      { name: 'Test Storm Mage', mana_cost: '{1}{R}', type_line: 'Legendary Creature — Human Wizard', power: '1', toughness: '3', oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.\nWhenever you cast an instant or sorcery spell during your turn, flip a coin. If you lose the flip, Test Storm Mage deals 1 damage to you. If you win the flip, you may exile Test Storm Mage. If you do, return him to the battlefield transformed under his owner\'s control.' },
      { name: 'Test Storm Prodigy', mana_cost: '', type_line: 'Legendary Planeswalker — Ral', loyalty: '2', color_indicator: ['U', 'R'], oracle_text: 'Test Storm Prodigy enters with an additional loyalty counter on him for each instant and sorcery spell you\'ve cast this turn.\n+1: Until your next turn, instant and sorcery spells you cast cost {1} less to cast.\n\u22122: Test Storm Prodigy deals 2 damage divided as you choose among one or two targets. Draw a card if you control a blue permanent other than Test Storm Prodigy.\n\u22128: Exile the top eight cards of your library. You may cast instant and sorcery spells from among them this turn without paying their mana costs.' },
    ],
  } as unknown as OracleCard);
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', undefined, '{1}');
  const STUDY = card('Test Late Study', 'Sorcery', 'You gain 2 life.', undefined, '{6}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
  const defs = [RAL, SPARK, STUDY, BEAR];
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const ralOf = (s: GameState): ObjectId | undefined => s.zones.battlefield.find((id) => s.objects[id]!.defId === RAL.id);
  const loyalty = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;
  const flips = (s: GameState): string[] => s.log.flatMap((l) => (/flip/i.test(l.text) ? [l.text] : []));
  /** p1, in its main phase, casts the named spells in order (holding priority), answering yes/no with `yes`; then everything resolves. */
  /** Answer the decisions in front of us (never passing priority). */
  const decide = (s0: GameState, yes: boolean): GameState => {
    let s = s0;
    for (let g = 0; g < 40 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as unknown as { kind: string; options: { id: string }[]; prompt: string };
      if (p.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'yesNo') s = manswer(s, { kind: 'yesNo', yes });
      else if (p.kind === 'chooseOption') s = manswer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
      else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  const castAll = (s0: GameState, names: string[], yes: boolean): GameState => {
    let s = s0;
    for (const n of names) s = decide(mact(s, { type: 'cast', player: 'p1', card: mfind(s, n, 'hand', 'p1') }), yes);
    return run(s, { yes: () => yes });
  };

  it('both faces compile full', () => expect(full(RAL)).toBe(true));

  it('the front face makes a {1} instant free, and each flip either deals 1 damage to you or (won, exiled) returns him transformed with 2 + 1 loyalty', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = mpScenario({ defs, seed, zones: { p1: { battlefield: [RAL.id], hand: ['Test Spark'] } } });
      const life0 = lifeOf(s0, 'p1');
      const s = castAll(s0, ['Test Spark'], true);
      const ral = ralOf(s);
      expect(ral, seed).toBeDefined();
      if (s.objects[ral!]!.face === 1) {
        seen.add('won');
        expect(getChars(s, ral!)!.name).toBe('Test Storm Prodigy');
        expect(loyalty(s, ral!), `${seed}: printed 2 plus the one instant cast this turn`).toBe(3);
        expect(lifeOf(s, 'p1')).toBe(life0 + 1);
      } else {
        expect(lifeOf(s, 'p1'), `${seed}: 1 damage from the lost flip, then the spell's 1 life`).toBe(life0 - 1 + 1);
        seen.add('lost');
      }
    }
    expect([...seen].sort()).toEqual(['lost', 'won']);
  });

  it('NEGATIVE: declining the exile after a won flip keeps him as he is (no damage either)', () => {
    let won = 0;
    for (const seed of SEEDS) {
      const s0 = mpScenario({ defs, seed, zones: { p1: { battlefield: [RAL.id], hand: ['Test Spark'] } } });
      const life0 = lifeOf(s0, 'p1');
      const s = castAll(s0, ['Test Spark'], false);
      const ral = ralOf(s)!;
      expect(s.objects[ral]!.face, seed).toBe(0);
      if (lifeOf(s, 'p1') === life0 + 1) won++;
    }
    expect(won).toBeGreaterThan(0);
  });

  it('two spells: each counts for the loyalty (2 + 2); a second won flip after he transformed does nothing (ruling: the object is gone)', () => {
    let both = 0;
    for (const seed of SEEDS) {
      const s0 = mpScenario({ defs, seed, zones: { p1: { battlefield: [RAL.id], hand: ['Test Spark', 'Test Spark'] } } });
      const s = castAll(s0, ['Test Spark', 'Test Spark'], true);
      const ral = ralOf(s);
      expect(ral, seed).toBeDefined();
      expect(s.zones.exile.some((id) => s.objects[id]!.defId === RAL.id), `${seed}: never left in exile`).toBe(false);
      if (s.objects[ral!]!.face === 1) {
        both++;
        expect(loyalty(s, ral!), seed).toBe(4);
      }
    }
    expect(both).toBeGreaterThan(0);
  });

  it("NEGATIVE: an instant cast during an opponent's turn makes no flip", () => {
    const s0 = mpScenario({ defs, seed: SEEDS[0], zones: { p1: { battlefield: [RAL.id], hand: ['Test Spark'] } } });
    let s = passUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's main phase");
    s = mpass(s); s = mpass(s); s = mpass(s);
    expect(s.pending?.player).toBe('p1');
    const n = flips(s).length;
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Spark', 'hand', 'p1') }), {});
    expect(flips(s).length).toBe(n);
    expect(s.objects[ralOf(s)!]!.face).toBe(0);
  });

  const prodigy = (seed: string, loyal: number, zones: Record<string, unknown> = {}, setup?: (s: GameState) => void): GameState =>
    mpScenario({ defs, seed, zones: { p1: { battlefield: [{ name: RAL.id, face: 1, counters: { loyalty: loyal } }], ...zones } }, ...(setup ? { setup } : {}) });
  const activateN = (s0: GameState, n: number): GameState => {
    const ral = ralOf(s0)!;
    return run(mact(s0, { type: 'activate', player: 'p1', source: ral, ability: activatedAbilities(s0, s0.objects[ral]!)[n]!.key } as never), {});
  };

  it('+1: until your next turn, an instant costs {1} less (a {1} instant with no mana becomes castable); before it, it is not', () => {
    const s0 = prodigy(SEEDS[0]!, 3, { hand: ['Test Spark'] });
    expect(() => mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Spark', 'hand', 'p1') })).toThrow();
    const s = activateN(s0, 0);
    expect(loyalty(s, ralOf(s)!)).toBe(4);
    const life0 = lifeOf(s, 'p1');
    const t = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Spark', 'hand', 'p1') }), {});
    expect(lifeOf(t, 'p1')).toBe(life0 + 1);
  });

  it("+1: the reduction still applies on an opponent's turn and ends as your next turn begins", () => {
    const s0 = prodigy(SEEDS[2]!, 3, { hand: ['Test Spark', 'Test Spark'] });
    let s = activateN(s0, 0);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's main phase");
    s = mpass(s); s = mpass(s); s = mpass(s);
    expect(s.pending?.player).toBe('p1');
    const life0 = lifeOf(s, 'p1');
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Spark', 'hand', 'p1') }), {});
    expect(lifeOf(s, 'p1'), "cast for {0} on p2's turn").toBe(life0 + 1);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1', "p1's next main phase");
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.controller === 'p1' && s.objects[x]!.defId === 'Plains')) delete s.objects[id];
    s.zones.battlefield = s.zones.battlefield.filter((x) => s.objects[x] !== undefined);
    s.players[0]!.manaPool = [];
    expect(() => mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Spark', 'hand', 'p1') }), 'the reduction ended').toThrow();
  });

  it('-8: the instants and sorceries among the eight exiled cards may be cast this turn for free (a sorcery at sorcery speed); a creature card is not castable', () => {
    const setup = (s: GameState): void => {
      for (const id of [...s.zones.library.p1!]) if (s.objects[id]!.defId === 'Plains') { delete s.objects[id]; }
      s.zones.library.p1 = s.zones.library.p1!.filter((id) => s.objects[id] !== undefined);
    };
    const s0 = prodigy(SEEDS[1]!, 9, { library: ['Test Spark', 'Test Late Study', 'Test Plain Bear', 'Test Spark', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, setup);
    let s = activateN(s0, 2);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1').length).toBe(8);
    const exiledNamed = (n: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === n);
    const cards = legalActions(s, 'p1');
    const castable = (id: ObjectId): boolean => cards.some((a) => a.kind === 'cast' && a.object === id);
    for (const id of exiledNamed('Test Plain Bear')) expect(castable(id), 'a creature card is not covered').toBe(false);
    const study = exiledNamed('Test Late Study')[0];
    if (study !== undefined) expect(castable(study), 'a {6} sorcery, free, in the main phase').toBe(true);
    const life0 = lifeOf(s, 'p1');
    for (const id of exiledNamed('Test Spark')) s = run(mact(s, legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === id)!.action), {});
    expect(lifeOf(s, 'p1')).toBe(life0 + exiledNamed('Test Spark').length + (s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Test Spark').length));
  });
});

describe('CR 608.2d, 101.4, 608.2g, 400.7h, 119.3: Kefka, Dancing Mad', () => {
  const KEFKA = card('Test Mad Clown', 'Legendary Creature — Human Wizard', "During your turn, Test Mad Clown has indestructible.\nAt the beginning of your end step, exile a card at random from each opponent's graveyard. You may cast any number of spells from among cards exiled this way without paying their mana costs. Then each player who owns a spell you cast this way loses life equal to its mana value.", ['6', '6'], '{5}{B}{R}');
  const GIFT = card('Test Gift of Two', 'Sorcery', 'You gain 2 life.', undefined, '{1}{W}');
  const TRIO = card('Test Trio Charm', 'Instant', 'You gain 1 life.', undefined, '{2}{U}');
  const ZAP = card('Test Rust Zap', 'Instant', 'Destroy target artifact.', undefined, '{1}{R}');
  const defs = [KEFKA, GIFT, TRIO, ZAP];
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const OPPS: PlayerId[] = ['p2', 'p3', 'p4'];
  const exiledOf = (s: GameState, owner: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === owner).map((id) => s.objects[id]!.defId);
  const yardOf = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);
  const toEnd = (s0: GameState, sc: Script): GameState => run(passUntil(s0, (x) => x.turn.step === 'end' && x.zones.stack.length > 0, 'the end step trigger'), { ...sc, until: (x) => x.turn.step === 'end' });

  it('compiles full', () => expect(full(KEFKA)).toBe(true));

  it('one card at random from each opponent\'s graveyard; every spell you cast is yours (you gain), its owner loses its mana value; a land card is never cast and stays exiled', () => {
    const picked = new Set<string>();
    for (const seed of SEEDS.slice(0, 12)) {
      const yard = { graveyard: ['Test Gift of Two', 'Test Trio Charm', 'Plains'] };
      const s0 = mpScenario({ defs, seed, zones: { p1: { battlefield: ['Test Mad Clown'] }, p2: yard, p3: yard, p4: yard } });
      const before = Object.fromEntries((['p1', ...OPPS] as PlayerId[]).map((p) => [p, lifeOf(s0, p)]));
      const s = toEnd(s0, { objects: (o, _p, _s, who, max) => (who === 'p1' ? o.slice(0, max) : []) });
      let gained = 0;
      for (const p of OPPS) {
        const ex = exiledOf(s, p);
        const lost = before[p]! - lifeOf(s, p);
        const castName = lost === 2 ? 'Test Gift of Two' : lost === 3 ? 'Test Trio Charm' : undefined;
        expect([0, 2, 3], `${seed} ${p}: loses the mana value of the spell of theirs that was cast, or nothing`).toContain(lost);
        if (castName === undefined) expect(ex, `${seed} ${p}: the land card stays exiled (a spell exiled would have been cast)`).toEqual(['Plains']);
        else {
          expect(ex, `${seed} ${p}: the cast card left exile`).toEqual([]);
          expect(yardOf(s, p).filter((n) => n === castName).length, `${seed} ${p}: the spell resolved into its owner's graveyard`).toBe(1);
        }
        expect(yardOf(s, p).length + ex.length, `${seed} ${p}: one card was exiled, from the three`).toBe(3);
        picked.add(castName ?? 'Plains');
        gained += castName === 'Test Gift of Two' ? 2 : castName === 'Test Trio Charm' ? 1 : 0;
      }
      expect(lifeOf(s, 'p1'), seed).toBe(before.p1! + gained);
    }
    expect(picked.size, 'the random pick varies').toBeGreaterThan(1);
  });

  it('casting is optional: none cast, the exiled cards stay exiled and nobody loses life', () => {
    const yard = { graveyard: ['Test Gift of Two'] };
    const s0 = mpScenario({ defs, seed: SEEDS[2], zones: { p1: { battlefield: ['Test Mad Clown'] }, p2: yard, p3: yard, p4: yard } });
    const s = toEnd(s0, { objects: () => [] });
    for (const p of OPPS) { expect(exiledOf(s, p)).toEqual(['Test Gift of Two']); expect(lifeOf(s, p)).toBe(lifeOf(s0, p)); }
  });

  it('NEGATIVE: a chosen spell that cannot be cast (no legal target) is not "a spell you cast this way": its owner loses nothing and it stays exiled; an empty graveyard gives nothing', () => {
    const s0 = mpScenario({ defs, seed: SEEDS[3], zones: { p1: { battlefield: ['Test Mad Clown'] }, p2: { graveyard: ['Test Rust Zap'] }, p3: { graveyard: ['Test Gift of Two'] } } });
    const s = toEnd(s0, { objects: (o, _p, _s, who, max) => (who === 'p1' ? o.slice(0, max) : []) });
    expect(lifeOf(s, 'p3'), 'the gift was cast').toBe(lifeOf(s0, 'p3') - 2);
    expect(lifeOf(s, 'p2'), 'the zap had no artifact to target: not cast, no loss').toBe(lifeOf(s0, 'p2'));
    expect(exiledOf(s, 'p2')).toEqual(['Test Rust Zap']);
    expect(lifeOf(s, 'p4')).toBe(lifeOf(s0, 'p4'));
  });
});
