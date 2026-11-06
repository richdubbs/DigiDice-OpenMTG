/**
 * Round edh-next-129 (must-finish round "dice, coins and random", EDHREC 5,001-10,000): the behaviour it added, played through the engine with synthetic cards (invented names, the
 * printed wordings of the real cards), compiled by the game's default compiler, in four-player games. Random results come from the state's seeded generator: each test plays many seeds
 * and checks what the rules allow for each.
 *
 *   CR 115.7, 115.7d, 707.10, 608.2b   Chef's Kiss: "Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the
 *                                      spell and the copy. The new targets can't be you or a permanent you control." (rulings 2021-06-18: you must reselect at random when a legal
 *                                      target that is not you or yours exists; with none, the targets stay unchanged, and a spell that targeted "a creature you control" then does
 *                                      nothing; reselecting is not casting)
 *   CR 706.1, 706.2, 602.2b, 106.3,    Mr. House, President and CEO: "Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token. If you rolled 6 or higher,
 *   614.15, 111.1                      instead create that token and a Treasure token. {4}, {T}: Roll a six-sided die plus an additional six-sided die for each mana from Treasures spent
 *                                      to activate this ability." (rulings 2024-03-08: the rolls have no effect of their own; each die of 4 or more triggers)
 *   CR 705.1, 705.2, 608.2c            Fiery Gambit: "Flip a coin until you lose a flip or choose to stop flipping. If you lose a flip, Fiery Gambit has no effect. If you win one or
 *                                      more flips, ... 3 damage to target creature. If you win two or more flips, ... 6 damage to each opponent. If you win three or more flips, draw
 *                                      nine cards and untap all lands you control." (rulings 2004-12-01: after each flip you choose whether to continue; any lost flip, no effect)
 *   CR 506.1, 508.1, 508.1d, 608.2d    Territorial Hellkite: "At the beginning of combat on your turn, choose an opponent at random that this creature didn't attack during your last
 *                                      combat. This creature attacks that player this combat if able. If you can't choose an opponent this way, tap this creature." (rulings
 *                                      2017-08-25: if it didn't attack during your last combat, any opponent can be chosen)
 *   CR 705.2, 119.3, 608.2c            Game of Chaos: "Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you
 *                                      lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each
 *                                      flip." (ruling 2004-10-04: doubling the stakes doubles the life lost or gained)
 *   CR 700.2, 111.1, 603.3c            Outlaws' Merriment: "At the beginning of your upkeep, choose one at random. Create a red and white creature token with those characteristics. • 3/1
 *                                      Human Warrior with trample and haste. • 2/1 Human Cleric with lifelink and haste. • 1/2 Human Rogue with haste and "When this token enters,
 *                                      it deals 1 damage to any target."" (ruling 2019-10-04: the mode is chosen at random as the ability is put on the stack)
 *   CR 706.2, 608.2d, 608.2h, 613.1d,  Ebony Fly: "{4}: Roll a d6. Until end of turn, you may have this artifact become an X/X Insect artifact creature with flying, where X is the
 *   613.4b, 115.3, 109.2               result. Whenever this artifact attacks, another target attacking creature gains flying until end of turn." (ruling 2021-07-23: you choose after
 *                                      seeing the result; not later in the turn)
 *   CR 608.2d, 611.2c, 613.1f          Blitzwing, Adaptive Assailant: "At the beginning of combat on your turn, choose flying or indestructible at random. Blitzwing gains that ability
 *                                      until end of turn."
 *   CR 706.3a, 707.12, 118.9, 607.2a,  Wizard's Spellbook: "{T}: Exile target instant or sorcery card from a graveyard. Roll a d20. Activate only as a sorcery. 1-9 | Copy that card. You
 *   608.2g                             may cast the copy. 10-19 | Copy that card. You may cast the copy by paying {1} rather than paying its mana cost. 20 | Copy each card exiled with
 *                                      this artifact. You may cast any number of the copies without paying their mana costs." (rulings 2021-07-23: 1-9 pays all costs; 10-19 pays {1};
 *                                      20 is free; copies not cast cease to exist)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities } from '../../../src/rules/abilities';
import { type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, concede, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, full, pt } from '../cmd3/helpers';
import { getChars } from '../../../src/index';

const SEEDS = Array.from({ length: 30 }, (_, i) => `edhn129-${i}`);
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const P = (id: PlayerId) => ({ kind: 'player' as const, id });
const O = (id: ObjectId) => ({ kind: 'object' as const, id });
type T = { kind: 'player' | 'object'; id: string };
/** Answer the decisions in front of us (targets from the queue, the rest automatic) until a player has priority. */
function settle(s0: GameState, targets: T[][] = [], yes: boolean | ((prompt: string, who: PlayerId) => boolean) = true): GameState {
  let s = s0;
  for (let g = 0; g < 40 && s.pending && s.pending.kind !== 'priority'; g++) {
    const p = s.pending as unknown as { kind: string; prompt: string };
    if (p.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] } as DecisionAnswer);
    else if (p.kind === 'yesNo') s = manswer(s, { kind: 'yesNo', yes: typeof yes === 'function' ? yes(p.prompt, (p as unknown as { player: PlayerId }).player) : yes });
    else if (p.kind === 'chooseOption') s = manswer(s, { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] } as DecisionAnswer);
    else if (p.kind === 'order') s = manswer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) } as DecisionAnswer);
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
  }
  return s;
}
function resolveAll(s0: GameState, yes: boolean | ((prompt: string, who: PlayerId) => boolean) = true): GameState {
  let s = settle(s0, [], yes);
  for (let g = 0; g < 60 && s.zones.stack.length > 0; g++) s = settle(mpass(s), [], yes);
  return s;
}
const top = (s: GameState): ObjectId => s.zones.stack[s.zones.stack.length - 1]!;
const cast = (s: GameState, who: PlayerId, name: string, targets: T[][]): GameState => settle(mact(s, { type: 'cast', player: who, card: mfind(s, name, 'hand', who) }), targets);
/** p2 casts `spell` (with `targets`), then p1 gets priority and casts the Kiss on it. */
function kissOn(seed: string, spell: string, targets: (s: GameState) => T[][], extra: { p1?: string[]; p2?: string[] } = {}): { s: GameState; before: Record<string, number> } {
  const s0 = mpScenario({ defs: CK_DEFS, seed, zones: { p1: { hand: ['Test Kiss'], battlefield: extra.p1 ?? [] }, p2: { hand: [spell], battlefield: extra.p2 ?? [] } } });
  let s = mpass(s0); // p2 has priority
  s = cast(s, 'p2', spell, targets(s));
  for (let g = 0; g < 6 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); g++) s = mpass(s);
  s = cast(s, 'p1', 'Test Kiss', [[O(top(s))]]);
  const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
  return { s: resolveAll(s), before };
}

const KISS = card('Test Kiss', 'Instant', "Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the spell and the copy. The new targets can't be you or a permanent you control.", undefined, '{0}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{0}');
const PUMP = card('Test Pump', 'Instant', 'Target creature you control gets +2/+2 until end of turn.', undefined, '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '9']);
const CK_DEFS = [KISS, BOLT, PUMP, BEAR, OX];

describe("CR 115.7, 707.10: Chef's Kiss (gain control of the spell, copy it, reselect both spells' targets at random, never you or yours)", () => {
  it('compiles full', () => expect(full(KISS)).toBe(true));

  it("an opponent's 3-damage spell aimed at you: it and the copy each hit a random other player or a permanent you don't control; never you or your permanents", () => {
    const hit = new Set<string>();
    for (const seed of SEEDS) {
      const { s, before } = kissOn(seed, 'Test Bolt', () => [[P('p1')]], { p1: ['Test Ox'], p2: ['Test Ox'] });
      expect(lifeOf(s, 'p1'), `${seed}: never you`).toBe(before.p1);
      const myOx = bf(s, 'Test Ox', 'p1')[0]!;
      expect(s.objects[myOx]!.damage ?? 0, `${seed}: never a permanent you control`).toBe(0);
      const theirOx = bf(s, 'Test Ox', 'p2')[0]!;
      const lost = (['p2', 'p3', 'p4'] as PlayerId[]).reduce((n, p) => n + (before[p]! - lifeOf(s, p)), 0) + (s.objects[theirOx]!.damage ?? 0);
      expect(lost, `${seed}: two spells of 3 damage each`).toBe(6);
      for (const p of ['p2', 'p3', 'p4'] as PlayerId[]) if (lifeOf(s, p) < before[p]!) hit.add(p);
      if ((s.objects[theirOx]!.damage ?? 0) > 0) hit.add('ox');
      expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === BOLT.id), `${seed}: the original goes to its owner's graveyard`).toBe(true);
    }
    expect([...hit].sort(), 'every legal candidate is picked on some seed').toEqual(['ox', 'p2', 'p3', 'p4']);
  });

  it('a spell you cast is a legal target too: its targets are reselected away from you and yours', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s0 = mpScenario({ defs: CK_DEFS, seed, zones: { p1: { hand: ['Test Bolt', 'Test Kiss'], battlefield: ['Test Ox'] } } });
      const ox = bf(s0, 'Test Ox', 'p1')[0]!;
      let s = cast(s0, 'p1', 'Test Bolt', [[O(ox)]]);
      s = cast(s, 'p1', 'Test Kiss', [[O(top(s))]]);
      const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
      s = resolveAll(s);
      expect(s.objects[ox]!.damage ?? 0, seed).toBe(0);
      expect(lifeOf(s, 'p1')).toBe(before.p1);
      expect((['p2', 'p3', 'p4'] as PlayerId[]).reduce((n, p) => n + (before[p]! - lifeOf(s, p)), 0), seed).toBe(6);
    }
  });

  it('ruling: a spell aimed at "target creature you control" finds no new legal target (only your own creatures would be legal): the targets stay, and that spell and its copy do nothing', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const { s } = kissOn(seed, 'Test Pump', (st) => [[O(bf(st, 'Test Bear', 'p2')[0]!)]], { p1: ['Test Ox'], p2: ['Test Bear'] });
      expect(pt(s, bf(s, 'Test Bear', 'p2')[0]!), `${seed}: not a creature its new controller controls`).toBe('2/2');
      expect(pt(s, bf(s, 'Test Ox', 'p1')[0]!), `${seed}: never yours`).toBe('1/9');
      expect(s.log.some((l) => /no legal target can be selected at random/.test(l.text)), seed).toBe(true);
    }
  });

  it('a spell with two or more targets is not a legal target ("targets only a single permanent or player")', () => {
    const TWO = card('Test Twin Bolt', 'Instant', 'Test Twin Bolt deals 1 damage to each of two targets.', undefined, '{0}');
    const defs = [...CK_DEFS, TWO];
    const s0 = mpScenario({ defs, seed: SEEDS[0], zones: { p1: { hand: ['Test Kiss'] }, p2: { hand: ['Test Twin Bolt'] } } });
    let s = mpass(s0);
    s = cast(s, 'p2', 'Test Twin Bolt', [[P('p1'), P('p3')]]);
    for (let g = 0; g < 6 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); g++) s = mpass(s);
    expect(full(TWO)).toBe(true);
    expect(s.zones.stack.length).toBe(1);
    expect(() => mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Kiss', 'hand', 'p1') }), 'the only spell on the stack has two targets').toThrow(/no legal one/);
  });
});

const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const HOUSE = card('Test House', 'Legendary Artifact Creature — Human', 'Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token. If you rolled 6 or higher, instead create that token and a Treasure token.\n{4}, {T}: Roll a six-sided die plus an additional six-sided die for each mana from Treasures spent to activate this ability.', ['2', '4']);
const VAULT = card('Test Vault', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');
const STONE = card('Test Stone', 'Artifact', '{T}: Add {C}.');
const HOUSE_DEFS = [HOUSE, VAULT, STONE];

describe('CR 706.1, 602.2b, 106.3, 614.15: Mr. House, President and CEO (one die plus one for each mana from Treasures spent; 4+ a Robot, 6+ a Robot and a Treasure)', () => {
  it('compiles full', () => expect(full(HOUSE)).toBe(true));
  const play = (seed: string, mana: string[]): GameState => {
    const s0 = mpScenario({ defs: HOUSE_DEFS, seed, zones: { p1: { battlefield: ['Test House', ...mana] } } });
    const house = bf(s0, HOUSE.id)[0]!;
    const s = settle(mact(s0, { type: 'activate', player: 'p1', source: house, ability: activatedAbilities(s0, s0.objects[house]!)[0]!.key } as never));
    return resolveAll(s);
  };
  const robots = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]!.name.includes('Robot')).length;
  const treasures = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]!.name.includes('Treasure')).length;
  it('two mana from Treasures: three dice; each 4 or 5 makes a Robot, each 6 a Robot and a Treasure, each 1-3 nothing', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const s = play(seed, ['Test Vault', 'Test Vault', 'Test Stone', 'Test Stone']);
      const r = rolled(s);
      expect(r.length, seed).toBe(3);
      r.forEach((x) => seen.add(x));
      expect(robots(s), `${seed}: ${r}`).toBe(r.filter((x) => x >= 4).length);
      expect(treasures(s), `${seed}: ${r}`).toBe(r.filter((x) => x >= 6).length);
      expect(bf(s, VAULT.id).length, 'both Treasures were sacrificed to pay').toBe(0);
    }
    expect([...seen].sort(), 'every result is seen').toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('no mana from Treasures (other artifacts pay): one die only', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s = play(seed, ['Test Stone', 'Test Stone', 'Test Stone', 'Test Stone']);
      expect(rolled(s).length, seed).toBe(1);
    }
  });
});

const GAMBIT = card('Test Gambit', 'Sorcery', 'Flip a coin until you lose a flip or choose to stop flipping. If you lose a flip, Test Gambit has no effect. If you win one or more flips, Test Gambit deals 3 damage to target creature. If you win two or more flips, Test Gambit deals 6 damage to each opponent. If you win three or more flips, draw nine cards and untap all lands you control.', undefined, '{0}');
const GAMBIT_DEFS = [GAMBIT, OX];
describe('CR 705.2, 608.2c: Fiery Gambit (flip until you lose or stop; a lost flip, no effect; 1+, 2+, 3+ wins)', () => {
  it('compiles full', () => expect(full(GAMBIT)).toBe(true));
  const flips = (s: GameState): ('won' | 'lost')[] => s.log.flatMap((l) => (/wins the flip|win the flip|wins a coin flip/i.test(l.text) ? ['won' as const] : /loses the flip|lose the flip|loses a coin flip/i.test(l.text) ? ['lost' as const] : []));
  const play = (seed: string, stopAfter: number) => {
    const s0 = mpScenario({ defs: GAMBIT_DEFS, seed, zones: { p1: { hand: ['Test Gambit'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Ox'] } } });
    const ox = bf(s0, OX.id, 'p2')[0]!;
    for (const id of bf(s0, 'Plains', 'p1')) s0.objects[id]!.tapped = true;
    let s = cast(s0, 'p1', 'Test Gambit', [[O(ox)]]);
    const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(s, (prompt) => { const m = /won (\d+) flip/.exec(prompt); return m === null ? true : Number(m[1]) < stopAfter; });
    return { s, ox, before, drew: s.zones.hand.p1!.length - hand };
  };
  it('the flips stop at the first loss or when you stop; each count of wins does what its sentence says, and a lost flip does nothing at all', () => {
    const seen = new Set<string>();
    for (const stopAfter of [1, 2, 3, 99]) {
      for (const seed of SEEDS) {
        const { s, ox, before, drew } = play(seed, stopAfter);
        const f = flips(s);
        const lost = f.includes('lost');
        const wins = f.filter((x) => x === 'won').length;
        expect(f.length, `${seed}: some flip`).toBeGreaterThan(0);
        if (lost) expect(f[f.length - 1], 'the loss is the last flip').toBe('lost');
        else expect(wins, `${seed}: stopped after ${stopAfter} wins`).toBe(stopAfter);
        const n = lost ? 0 : wins;
        seen.add(lost ? 'lost' : `won${n}`);
        expect(s.objects[ox]?.damage ?? 0, `${seed} ${f}`).toBe(n >= 1 ? 3 : 0);
        for (const p of ['p2', 'p3', 'p4'] as PlayerId[]) expect(lifeOf(s, p), `${seed} ${f}`).toBe(before[p]! - (n >= 2 ? 6 : 0));
        expect(lifeOf(s, 'p1'), 'never you').toBe(before.p1);
        expect(drew, `${seed} ${f}`).toBe(n >= 3 ? 9 : 0);
        expect(bf(s, 'Plains', 'p1').every((id) => s.objects[id]!.tapped === (n < 3)), `${seed}: lands untapped only on 3+`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(['lost', 'won1', 'won2', 'won3']);
  });
});

const HELLKITE = card('Test Hellkite', 'Creature — Dragon', "Flying, haste\nAt the beginning of combat on your turn, choose an opponent at random that this creature didn't attack during your last combat. This creature attacks that player this combat if able. If you can't choose an opponent this way, tap this creature.", ['6', '5']);
describe("CR 506.1, 508.1d, 608.2d: Territorial Hellkite (a random opponent it didn't attack during your last combat; none: tap it)", () => {
  it('compiles full', () => expect(full(HELLKITE)).toBe(true));
  /** Passes to your next declaration of attackers and returns the player the Hellkite is required to attack (the decision's obeying example), or null when it is not required. */
  const toAttack = (s0: GameState): { s: GameState; must: PlayerId | null } => {
    const s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' || (x.turn.step === 'endCombat' && x.turn.activePlayer === 'p1'), 'the declaration of attackers');
    if (s.pending?.kind !== 'declareAttackers') return { s, must: null };
    const ob = (s.pending as unknown as { obeying?: { attacker: ObjectId; defender: string }[] }).obeying ?? [];
    return { s, must: (ob[0]?.defender as PlayerId | undefined) ?? null };
  };
  /** Declares the Hellkite's attack on `who`, then plays on to the next turn of p1. */
  const attackAndPass = (s0: GameState, kite: ObjectId, who: PlayerId): GameState => {
    let s = manswer(s0, { kind: 'declareAttackers', attacks: [{ attacker: kite, defender: who }] } as DecisionAnswer);
    const turn = s.turn.number;
    s = passUntil(s, (x) => x.turn.number > turn && x.turn.activePlayer === 'p1' && x.turn.step === 'main1', "p1's next turn", 2000);
    return s;
  };
  it("each turn it must attack a random opponent, never the one it attacked during your last combat", () => {
    const firsts = new Set<string>();
    for (const seed of SEEDS.slice(0, 12)) {
      let s = mpScenario({ defs: [HELLKITE], seed, zones: { p1: { battlefield: ['Test Hellkite'] } } });
      const kite = bf(s, HELLKITE.id, 'p1')[0]!;
      let r = toAttack(s);
      expect(r.must, `${seed}: some opponent`).not.toBeNull();
      expect(r.must).not.toBe('p1');
      firsts.add(r.must!);
      let last = r.must!;
      for (let k = 0; k < 3; k++) {
        s = attackAndPass(r.s, kite, last);
        r = toAttack(s);
        expect(r.must, `${seed}: turn ${s.turn.number}`).not.toBeNull();
        expect(r.must, `${seed}: never the one attacked last combat`).not.toBe(last);
        expect(r.must).not.toBe('p1');
        last = r.must!;
      }
    }
    expect(firsts.size, 'the first pick is random among the three opponents').toBe(3);
  });
  it("ruling: when it didn't attack during your last combat (it was tapped), every opponent may be chosen, the one chosen then too", () => {
    const seen = new Set<string>();
    const names = (st: GameState): Record<string, PlayerId> => Object.fromEntries(st.players.map((p) => [p.name, p.id]));
    for (const seed of SEEDS.slice(0, 16)) {
      let s = mpScenario({ defs: [HELLKITE], seed, zones: { p1: { battlefield: ['Test Hellkite'] } }, setup: (st) => { for (const id of bf(st, HELLKITE.id, 'p1')) st.objects[id]!.tapped = true; } });
      s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the end of the first combat');
      const chose = [...s.log].reverse().map((l) => /^Alice chooses (\w+)\.$/.exec(l.text)).find((m) => m !== null);
      expect(chose, `${seed}: a pick was made`).toBeDefined();
      const first = names(s)[chose![1]!]!;
      const turn = s.turn.number;
      s = passUntil(s, (x) => x.turn.number > turn && x.turn.activePlayer === 'p1' && x.turn.step === 'main1', "p1's next turn", 2000);
      const r = toAttack(s);
      expect(r.must, seed).not.toBeNull();
      seen.add(r.must === first ? 'same' : 'other');
    }
    expect(seen.has('same'), 'the opponent chosen the turn before can be chosen again (it did not attack)').toBe(true);
  });
  it("no opponent left to choose (the only opponent was attacked last combat): it is tapped and attacks nobody", () => {
    let s = mpScenario({ defs: [HELLKITE], players: 3, seed: SEEDS[0], zones: { p1: { battlefield: ['Test Hellkite'] } } });
    const kite = bf(s, HELLKITE.id, 'p1')[0]!;
    const r = toAttack(s);
    const other = (['p2', 'p3'] as PlayerId[]).find((p) => p !== r.must)!;
    s = manswer(r.s, { kind: 'declareAttackers', attacks: [{ attacker: kite, defender: r.must! }] } as DecisionAnswer);
    s = concede(s, other).state;
    const turn = s.turn.number;
    s = passUntil(s, (x) => x.turn.number > turn && x.turn.activePlayer === 'p1' && x.turn.step === 'main1', "p1's next turn", 2000);
    s = passUntil(s, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length === 0 && x.pending?.kind === 'priority' && s.log.length < x.log.length && x.log.some((l) => /taps|tapped/i.test(l.text)) || x.pending?.kind === 'declareAttackers' || x.turn.step === 'declareAttackers', 'the beginning of combat', 400);
    expect(s.objects[kite]!.tapped, 'tapped: no opponent could be chosen').toBe(true);
  });
});

const CHAOS = card('Test Chaos', 'Sorcery', 'Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.', undefined, '{0}');
describe('CR 705.2, 119.3: Game of Chaos (repeated flips, the winner of each decides whether to go on, the life stakes doubling)', () => {
  it('compiles full', () => expect(full(CHAOS)).toBe(true));
  const results = (s: GameState): boolean[] => s.log.flatMap((l) => (/wins the flip|win the flip/i.test(l.text) ? [true] : /loses the flip|lose the flip/i.test(l.text) ? [false] : []));
  it('each flip moves 1, 2, 4, ... life between you and the target; you decide after a win, the opponent after a loss; the others are untouched', () => {
    const seen = new Set<string>();
    for (const [winAgain, loseAgain] of [[true, false], [false, true], [true, true], [false, false]] as const) {
      for (const seed of SEEDS.slice(0, 15)) {
        const s0 = mpScenario({ defs: [CHAOS], seed, zones: { p1: { hand: ['Test Chaos'] } } });
        let s = cast(s0, 'p1', 'Test Chaos', [[P('p2')]]);
        const before = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
        const asked: PlayerId[] = [];
        let n = 0;
        s = resolveAll(s, (prompt, who) => { if (!/Flip again/.test(prompt)) return true; asked.push(who); n++; return n < 5 && (who === 'p1' ? winAgain : loseAgain); });
        const r = results(s);
        expect(r.length, seed).toBeGreaterThan(0);
        let delta = 0;
        r.forEach((won, k) => { delta += (won ? 1 : -1) * 2 ** k; });
        expect(lifeOf(s, 'p1') - before.p1!, `${seed} ${r}`).toBe(delta);
        expect(lifeOf(s, 'p2') - before.p2!, `${seed} ${r}`).toBe(-delta);
        expect(lifeOf(s, 'p3')).toBe(before.p3);
        expect(lifeOf(s, 'p4')).toBe(before.p4);
        expect(asked, `${seed}: who decided`).toEqual(r.slice(0, asked.length).map((won) => (won ? 'p1' : 'p2')));
        seen.add(String(r.length));
      }
    }
    expect(seen.size, 'chains of several lengths').toBeGreaterThan(2);
  });
});

const MERRIMENT = card('Test Merriment', 'Enchantment', 'At the beginning of your upkeep, choose one at random. Create a red and white creature token with those characteristics.\n• 3/1 Human Warrior with trample and haste.\n• 2/1 Human Cleric with lifelink and haste.\n• 1/2 Human Rogue with haste and "When this token enters, it deals 1 damage to any target."', undefined, '{0}');
describe("CR 700.2, 111.1: Outlaws' Merriment (one of three red and white Human tokens, chosen at random)", () => {
  it('compiles full', () => expect(full(MERRIMENT)).toBe(true));
  it('each upkeep makes exactly one of the three tokens, red and white, with its own size, types and abilities; every one is made on some seed', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      let s = mpScenario({ defs: [MERRIMENT], seed, zones: { p1: { battlefield: ['Test Merriment'] } } });
      const lives = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, lifeOf(s, p)]));
      s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, "p1's next upkeep trigger", 2000);
      s = settle(s, [[P('p2')]]);
      for (let g = 0; g < 20 && s.zones.stack.length > 0; g++) s = settle(mpass(s), [[P('p2')]]);
      const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
      expect(toks.length, seed).toBe(1);
      const c = getChars(s, toks[0]!)!;
      expect([...c.colors].sort(), seed).toEqual(['R', 'W']);
      expect(c.types).toEqual(['Creature']);
      const kind = (c.subtypes as string[]).filter((x) => x !== 'Human')[0]!;
      expect(c.subtypes as string[]).toContain('Human');
      const kw = (k: string): boolean => c.abilities.some((a) => a.def.kind === 'keyword' && (a.def as { keyword: string }).keyword === k);
      expect(kw('haste'), seed).toBe(true);
      if (kind === 'Warrior') { expect(`${c.power}/${c.toughness}`).toBe('3/1'); expect(kw('trample')).toBe(true); }
      else if (kind === 'Cleric') { expect(`${c.power}/${c.toughness}`).toBe('2/1'); expect(kw('lifelink')).toBe(true); }
      else if (kind === 'Rogue') { expect(`${c.power}/${c.toughness}`).toBe('1/2'); expect(lifeOf(s, 'p2'), `${seed}: the Rogue's enters trigger`).toBe(lives.p2! - 1); }
      else throw new Error(`unexpected token ${kind}`);
      seen.add(kind);
    }
    expect([...seen].sort()).toEqual(['Cleric', 'Rogue', 'Warrior']);
  });
});

const FLY = card('Test Fly', 'Artifact', 'This artifact enters tapped.\n{T}: Add {C}.\n{4}: Roll a d6. Until end of turn, you may have this artifact become an X/X Insect artifact creature with flying, where X is the result.\nWhenever this artifact attacks, another target attacking creature gains flying until end of turn.', undefined, '{2}');
describe('CR 706.2, 608.2d, 613.4b, 115.3: Ebony Fly (a d6; you may have it become an X/X flier; another attacking creature gains flying)', () => {
  it('compiles full', () => expect(full(FLY)).toBe(true));
  const activate = (seed: string, yes: boolean) => {
    const s0 = mpScenario({ defs: [FLY, BEAR, STONE], seed, zones: { p1: { battlefield: ['Test Fly', 'Test Stone', 'Test Stone', 'Test Stone', 'Test Stone', 'Test Bear'] } }, setup: (st) => { for (const id of st.zones.battlefield) st.objects[id]!.tapped = false; } });
    const fly = bf(s0, FLY.id, 'p1')[0]!;
    const ab = activatedAbilities(s0, s0.objects[fly]!).find((a) => !/Add/.test(JSON.stringify(a)))!;
    let s = settle(mact(s0, { type: 'activate', player: 'p1', source: fly, ability: ab.key } as never));
    s = resolveAll(s, yes);
    return { s, fly };
  };
  it('yes: it is an X/X Insect artifact creature with flying where X is the result, until end of turn; no: it stays a noncreature artifact', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS.slice(0, 20)) {
      const { s, fly } = activate(seed, true);
      const x = rolled(s)[0]!;
      seen.add(x);
      const c = getChars(s, fly)!;
      expect(c.types, seed).toEqual(['Artifact', 'Creature']);
      expect(c.subtypes).toEqual(['Insect']);
      expect(`${c.power}/${c.toughness}`, seed).toBe(`${x}/${x}`);
      expect(c.abilities.some((a) => a.def.kind === 'keyword' && (a.def as { keyword: string }).keyword === 'flying')).toBe(true);
      const no = activate(seed, false);
      expect(getChars(no.s, no.fly)!.types, `${seed}: declined`).toEqual(['Artifact']);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
  it('another target attacking creature: the Fly itself is never a legal target of its own attack trigger, the other attacker is', () => {
    const { s: s1, fly } = activate(SEEDS[0]!, true);
    const s0 = { ...s1 } as GameState;
    for (const id of s0.zones.battlefield) { s0.objects[id]!.controlledSinceTurn = 0; s0.objects[id]!.tapped = false; } // (the payment may have tapped the Fly for mana)
    const bear = bf(s0, BEAR.id, 'p1')[0]!;
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the declaration of attackers');
    s = manswer(s, { kind: 'declareAttackers', attacks: [{ attacker: fly, defender: 'p2' }, { attacker: bear, defender: 'p2' }] } as DecisionAnswer);
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseTargets'; g++) s = mpass(s);
    const p = s.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(p.kind).toBe('chooseTargets');
    expect(p.objects).toContain(bear);
    expect(p.objects).not.toContain(fly);
    s = settle(s, [[O(bear)]]);
    for (let g = 0; g < 10 && s.zones.stack.length > 0; g++) s = settle(mpass(s));
    expect(getChars(s, bear)!.abilities.some((a) => a.def.kind === 'keyword' && (a.def as { keyword: string }).keyword === 'flying')).toBe(true);
  });
});

const WING = card('Test Wing', 'Legendary Artifact Creature — Robot', 'At the beginning of combat on your turn, choose flying or indestructible at random. Test Wing gains that ability until end of turn.', ['3', '5']);
describe('CR 608.2d, 611.2c: Blitzwing, Adaptive Assailant (flying or indestructible, picked at random, until end of turn)', () => {
  it('compiles full', () => expect(full(WING)).toBe(true));
  const has = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id)!.abilities.some((a) => a.def.kind === 'keyword' && (a.def as { keyword: string }).keyword === k);
  it('exactly one of the two, nobody chooses it (no decision asked), both seen over the seeds; gone at the next turn', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      let s = mpScenario({ defs: [WING], seed, zones: { p1: { battlefield: ['Test Wing'] } } });
      const w = bf(s, WING.id, 'p1')[0]!;
      s = passUntil(s, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the trigger');
      expect(s.pending?.kind).toBe('priority');
      s = mpass(s);
      for (let g = 0; g < 6 && s.zones.stack.length > 0; g++) s = mpass(s);
      expect(s.pending?.kind === 'chooseOption', 'no choice is asked').toBe(false);
      const f = has(s, w, 'flying');
      const i = has(s, w, 'indestructible');
      expect(f !== i, seed).toBe(true);
      seen.add(f ? 'flying' : 'indestructible');
      const t = s.turn.number;
      s = passUntil(s, (x) => x.turn.number > t, 'the next turn', 2000);
      expect(has(s, w, 'flying') || has(s, w, 'indestructible'), `${seed}: until end of turn`).toBe(false);
    }
    expect([...seen].sort()).toEqual(['flying', 'indestructible']);
  });
});

const BOOK = card('Test Book', 'Artifact', "{T}: Exile target instant or sorcery card from a graveyard. Roll a d20. Activate only as a sorcery.\n1—9 | Copy that card. You may cast the copy.\n10—19 | Copy that card. You may cast the copy by paying {1} rather than paying its mana cost.\n20 | Copy each card exiled with this artifact. You may cast any number of the copies without paying their mana costs.", undefined, '{0}');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', undefined, '{3}');
describe("CR 706.3a, 707.12, 118.9: Wizard's Spellbook (exile an instant or sorcery card, roll a d20, cast a copy: full cost, {1}, or free with every card it exiled)", () => {
  it('compiles full', () => expect(full(BOOK)).toBe(true));
  it('each row: 1-9 the copy costs its mana cost, 10-19 it costs {1}, 20 it is free (and every card exiled with the Book is copied); the card stays exiled', () => {
    const seen = new Set<string>();
    for (const seed of Array.from({ length: 60 }, (_, i) => `edhn129-book-${i}`)) {
      const s0 = mpScenario({ defs: [BOOK, SHOCK, STONE], seed, zones: { p1: { battlefield: ['Test Book', 'Test Stone', 'Test Stone', 'Test Stone'] }, p2: { graveyard: ['Test Shock'] } } });
      const book = bf(s0, BOOK.id, 'p1')[0]!;
      const shock = s0.zones.graveyard.p2![0]!;
      const life = lifeOf(s0, 'p3');
      let s = settle(mact(s0, { type: 'activate', player: 'p1', source: book, ability: activatedAbilities(s0, s0.objects[book]!)[0]!.key } as never), [[O(shock)]]);
      // the copy, if cast, targets p3
      s = settle(s, [[P('p3')]]);
      for (let g = 0; g < 20 && s.zones.stack.length > 0; g++) s = settle(mpass(s), [[P('p3')]]);
      const r = rolled(s)[0]!;
      const tapped = bf(s, STONE.id, 'p1').filter((id) => s.objects[id]!.tapped).length;
      expect(s.zones.exile.some((id) => s.objects[id]!.defId === SHOCK.id), `${seed}: the card stays exiled`).toBe(true);
      expect(lifeOf(s, 'p3'), `${seed}: roll ${r}, the copy was cast`).toBe(life - 2);
      if (r <= 9) { expect(tapped, `${seed}: ${r}: its mana cost {3}`).toBe(3); seen.add('full'); }
      else if (r <= 19) { expect(tapped, `${seed}: ${r}: {1} instead`).toBe(1); seen.add('one'); }
      else { expect(tapped, `${seed}: ${r}: free`).toBe(0); seen.add('free'); }
    }
    expect([...seen].sort()).toEqual(['free', 'full', 'one']);
  });
  it('only as a sorcery: not during an opponent\'s turn', () => {
    const s0 = mpScenario({ defs: [BOOK, SHOCK, STONE], seed: 'x', zones: { p2: { battlefield: ['Test Book'], graveyard: ['Test Shock'] } } });
    const book = bf(s0, BOOK.id, 'p2')[0]!;
    const s = mpass(s0);
    expect(() => mact(s, { type: 'activate', player: 'p2', source: book, ability: activatedAbilities(s, s.objects[book]!)[0]!.key } as never)).toThrow();
  });
});

describe('CR 707.10, 602.2b: activationManaFrom reads the activation itself (review of edh-next-129)', () => {
  it('a copy of the ability was not activated: it counts no mana from Treasures (one die)', async () => {
    const { evalQty } = await import('../../../src/effects/eval');
    const base = { stack: { kind: 'activated', isCopy: true, costsPaid: { manaSpent: [{ type: 'C', sourceSubtypes: ['Treasure'] }] } } } as never;
    expect(evalQty(base, { q: 'activationManaFrom', subtype: 'Treasure' })).toBe(0);
    const orig = { stack: { kind: 'activated', costsPaid: { manaSpent: [{ type: 'C', sourceSubtypes: ['Treasure'] }, { type: 'C' }] } } } as never;
    expect(evalQty(orig, { q: 'activationManaFrom', subtype: 'Treasure' })).toBe(1);
    const trig = { stack: { kind: 'triggered', costsPaid: {} } } as never;
    expect(evalQty(trig, { q: 'activationManaFrom', subtype: 'Treasure' }), 'not an activated ability: undetermined').toBeUndefined();
  });
});
