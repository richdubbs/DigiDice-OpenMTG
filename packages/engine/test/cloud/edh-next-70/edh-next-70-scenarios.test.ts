/**
 * edh-next-70 (Commander lane counters, second round): the round's readings played through applyAction with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] };
/** Answer the decisions that come up, in order, until priority (or nothing scripted is left). */
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), q), q);
}
/** Cast a card from where it is with the cast action legalActions offers for it (its method, if any), and resolve it. */
function castFrom(s0: GameState, id: ObjectId, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const offer = legal(s0, player, 'cast').find((a) => a.object === id);
  if (!offer) throw new Error(`no cast action for ${id}`);
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, offer.action), q), q);
}
function activate(s0: GameState, source: ObjectId, ability: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), q), q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}, max = 400): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
function onBattlefield(s: GameState, name: string): ObjectId | undefined { return s.zones.battlefield.find((id) => s.objects[id]!.defId === name); }
const countersOf = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const handSize = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => (s.zones.hand[p] ?? []).length;
const life = (s: GameState, id: 'p1' | 'p2'): number => s.players.find((p) => p.id === id)!.life;
const LANDS = (n: number): string[] => Array(n).fill('Plains');

describe('CR 614.1c, 614.12, 122.6, 202.3: "that creature enters with X additional +1/+1 counters on it, where X is its mana value minus 4" (Runadi, Behemoth Caller; castSpell.entersWith.mvMinus)', () => {
  const CALLER = card('Test Caller', 'Creature — Elf Shaman', 'Whenever you cast a creature spell with mana value 5 or greater, that creature enters with X additional +1/+1 counters on it, where X is its mana value minus 4.', ['1', '1']);
  const BIG = card('Test Big Ox', 'Creature — Ox', '', ['3', '3'], '{5}{W}');
  const MID = card('Test Mid Ox', 'Creature — Ox', '', ['3', '3'], '{4}{W}');
  const SMALL = card('Test Small Ox', 'Creature — Ox', '', ['3', '3'], '{2}{W}');
  const setup = (hand: string) => scenario([], { p1: { hand: [hand], battlefield: ['Test Caller', ...LANDS(7)] }, defs: [CALLER, BIG, MID, SMALL] });
  it('is automated', () => expect(automated(CALLER)).toBe(true));
  it('mana value 6 enters with 2 counters, mana value 5 with 1', () => {
    for (const [name, n] of [['Test Big Ox', 2], ['Test Mid Ox', 1]] as const) {
      const s = cast(setup(name), name);
      expect(countersOf(s, onBattlefield(s, name)!), name).toBe(n);
    }
  });
  it('mana value 3 (below the cast condition) gets none', () => {
    const s = cast(setup('Test Small Ox'), 'Test Small Ox');
    expect(countersOf(s, onBattlefield(s, 'Test Small Ox')!)).toBe(0);
  });
});

describe('CR 611.3a, 614.12, 122.6: "As long as an opponent lost life this turn, each other Vampire you control enters with an additional +1/+1 counter on it" (Vampire Socialite; cond.others.enter.additionalCounter)', () => {
  const SOC = card('Test Socialite', 'Creature — Vampire', 'As long as an opponent lost life this turn, each other Vampire you control enters with an additional +1/+1 counter on it.', ['2', '2']);
  const BAT = card('Test Bat', 'Creature — Vampire', '', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  const DRAIN = card('Test Drain', 'Sorcery', 'Each opponent loses 1 life.');
  it('is automated', () => expect(automated(SOC)).toBe(true));
  it('with no life lost by an opponent this turn nothing is added; after an opponent lost life another Vampire enters with a counter, a non-Vampire does not, and the Socialite itself does not (other)', () => {
    let s = scenario([], { p1: { hand: ['Test Bat', 'Test Ox', 'Test Drain'], battlefield: ['Test Socialite'] }, defs: [SOC, BAT, OX, DRAIN] });
    s = cast(s, 'Test Bat');
    expect(countersOf(s, onBattlefield(s, 'Test Bat')!)).toBe(0);
    s = cast(s, 'Test Drain');
    expect(life(s, 'p2')).toBe(19);
    s = cast(s, 'Test Ox');
    expect(countersOf(s, onBattlefield(s, 'Test Ox')!)).toBe(0);
    const s2 = scenario([], { p1: { hand: ['Test Bat', 'Test Drain'], battlefield: ['Test Socialite'] }, defs: [SOC, BAT, DRAIN] });
    const s3 = cast(cast(s2, 'Test Drain'), 'Test Bat');
    expect(countersOf(s3, onBattlefield(s3, 'Test Bat')!)).toBe(1);
    expect(countersOf(s3, onBattlefield(s3, 'Test Socialite')!)).toBe(0);
  });
  it("an opponent's Vampire entering under their own control gets no counter (you control)", () => {
    const BACK = card('Test Back', 'Sorcery', "Return target creature card from a graveyard to the battlefield under its owner's control.");
    let s = scenario([], { p1: { hand: ['Test Drain', 'Test Back'], battlefield: ['Test Socialite'] }, p2: { graveyard: ['Test Bat'] }, defs: [SOC, DRAIN, BAT, BACK] });
    s = cast(s, 'Test Drain');
    const bat = find(s, 'Test Bat', 'graveyard', 'p2');
    s = cast(s, 'Test Back', { targets: [[obj(bat)]] });
    const nb = onBattlefield(s, 'Test Bat')!;
    expect(s.objects[nb]!.controller).toBe('p2');
    expect(countersOf(s, nb)).toBe(0);
  });
});

describe('CR 122.1, 608.2d, 603.10a: "When this creature dies, you may distribute a number of +1/+1 counters equal to the number of +1/+1 counters on this creature among any number of creatures you control" (Vastwood Hydra; distribute.numberEqual.anyNumber)', () => {
  const HYD = card('Test Hydra', 'Creature — Hydra', 'When this creature dies, you may distribute a number of +1/+1 counters equal to the number of +1/+1 counters on this creature among any number of creatures you control.', ['1', '1']);
  const A = card('Test Alpha', 'Creature — Ox', '', ['1', '1']);
  const B = card('Test Beta', 'Creature — Ox', '', ['1', '1']);
  const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
  it('is automated', () => expect(automated(HYD)).toBe(true));
  it('on dying with 3 counters, the 3 counters are shared among the creatures chosen, each at least one', () => {
    let s = scenario([], { p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Hydra', counters: { '+1/+1': 3 } }, 'Test Alpha', 'Test Beta'] }, defs: [HYD, A, B, DOOM] });
    const hyd = find(s, 'Test Hydra', 'battlefield', 'p1');
    const trace: string[] = [];
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(hyd)]] });
    for (let guard = 0; guard < 30 && s.pending; guard++) {
      const p = s.pending as unknown as { kind: string; prompt?: string; options?: { id: string }[] };
      trace.push(p.kind + ':' + (p.prompt ?? ''));
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Alpha', 'battlefield', 'p1'), find(s, 'Test Beta', 'battlefield', 'p1')] });
      else if (p.kind === 'chooseDivision') s = answer(s, { kind: 'chooseDivision', amounts: [2, 1] });
      else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 1 });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    const a = onBattlefield(s, 'Test Alpha')!;
    const b = onBattlefield(s, 'Test Beta')!;
    expect(onBattlefield(s, 'Test Hydra'), trace.join(' | ')).toBeUndefined();
    expect([countersOf(s, a), countersOf(s, b)], trace.join(' | ')).toEqual([2, 1]);
  });
  it('a Hydra with no counters distributes nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Hydra', counters: {} }, 'Test Alpha'] }, defs: [HYD, A, DOOM] });
    const hyd = find(s, 'Test Hydra', 'battlefield', 'p1');
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(hyd)]] }), { answers: [{ kind: 'yesNo', yes: true }] });
    expect(countersOf(s, onBattlefield(s, 'Test Alpha')!)).toBe(0);
  });
});

describe('CR 614.1c, 122.6, 608.2c: "Put up to two target creature cards from graveyards onto the battlefield under your control. Each of them enters with an additional -1/-1 counter on it." (Aberrant Return; rid.eachOfThem.entersWithAdditional)', () => {
  const RET = card('Test Return', 'Sorcery', 'Put up to two target creature cards from graveyards onto the battlefield under your control. Each of them enters with an additional -1/-1 counter on it.');
  const A = card('Test Alpha', 'Creature — Ox', '', ['3', '3']);
  const B = card('Test Beta', 'Creature — Ox', '', ['3', '3']);
  const C = card('Test Gamma', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(RET)).toBe(true));
  it('both chosen cards (yours and an opponent\'s) enter under your control with one -1/-1 counter each; a 1/1 with the counter dies', () => {
    let s = scenario([], { p1: { hand: ['Test Return'], graveyard: ['Test Alpha'] }, p2: { graveyard: ['Test Beta', 'Test Gamma'] }, defs: [RET, A, B, C] });
    const a = find(s, 'Test Alpha', 'graveyard', 'p1');
    const b = find(s, 'Test Beta', 'graveyard', 'p2');
    s = cast(s, 'Test Return', { targets: [[obj(a), obj(b)]] });
    const na = onBattlefield(s, 'Test Alpha')!;
    const nb = onBattlefield(s, 'Test Beta')!;
    expect(countersOf(s, na, '-1/-1')).toBe(1);
    expect(countersOf(s, nb, '-1/-1')).toBe(1);
    expect(s.objects[nb]!.controller).toBe('p1');
  });
  it('a card not chosen stays in the graveyard and gets nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Return'], graveyard: ['Test Alpha'] }, p2: { graveyard: ['Test Gamma'] }, defs: [RET, A, C] });
    const a = find(s, 'Test Alpha', 'graveyard', 'p1');
    s = cast(s, 'Test Return', { targets: [[obj(a)]] });
    expect(onBattlefield(s, 'Test Gamma')).toBeUndefined();
    expect(countersOf(s, onBattlefield(s, 'Test Alpha')!, '-1/-1')).toBe(1);
  });
});

describe('CR 603.2, 110.5: "Whenever Mira and Ode become tapped, draw a card. ... become untapped, put a +1/+1 counter on" (Tui and La; self-pair-become)', () => {
  const PAIR = card('Mira and Ode', 'Creature — Spirit', 'Whenever Mira and Ode become tapped, draw a card.\nWhenever Mira and Ode become untapped, put a +1/+1 counter on Mira and Ode.', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(PAIR)).toBe(true));
  it('attacking taps it: a card is drawn; another creature attacking does not draw', () => {
    let s = scenario([], { p1: { battlefield: ['Mira and Ode', 'Test Ox'] }, defs: [PAIR, OX] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    const pair = find(s, 'Mira and Ode', 'battlefield', 'p1');
    const before = handSize(s);
    s = advanceTo(s, 1, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: ox, defender: 'p2' }] } as never);
    s = drain(s);
    expect(handSize(s)).toBe(before);
    expect(s.objects[pair]!.tapped).toBe(false);
  });
  it('the creature attacking draws one', () => {
    let s = scenario([], { p1: { battlefield: ['Mira and Ode', 'Test Ox'] }, defs: [PAIR, OX] });
    const pair = find(s, 'Mira and Ode', 'battlefield', 'p1');
    const before = handSize(s);
    s = advanceTo(s, 1, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: pair, defender: 'p2' }] } as never);
    s = drain(s);
    expect(handSize(s)).toBe(before + 1);
  });
});

describe('CR 614.1c, 614.12, 122.6: "Creatures you control enter with a flying counter on them" (Veiled Ascension; group.enter.withCounter)', () => {
  const ASC = card('Test Ascension', 'Enchantment', 'Creatures you control enter with a flying counter on them.');
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  const FD = card('Test Fog', 'Enchantment', 'Face-down creatures you control enter with a flying counter on them.');
  it('is automated', () => { expect(automated(ASC)).toBe(true); expect(automated(FD)).toBe(true); });
  it("your creature enters with the counter; one returning under its owner's control (an opponent's) does not", () => {
    const BACK = card('Test Back', 'Sorcery', "Return target creature card from a graveyard to the battlefield under its owner's control.");
    const s = scenario([], { p1: { hand: ['Test Ox', 'Test Back'], battlefield: ['Test Ascension'] }, p2: { graveyard: ['Test Ox'] }, defs: [ASC, OX, BACK] });
    const t = cast(s, 'Test Ox');
    expect(countersOf(t, onBattlefield(t, 'Test Ox')!, 'flying')).toBe(1);
    const oxg = find(t, 'Test Ox', 'graveyard', 'p2');
    const u = cast(t, 'Test Back', { targets: [[obj(oxg)]] });
    const theirs = u.zones.battlefield.find((id) => u.objects[id]!.controller === 'p2')!;
    expect(countersOf(u, theirs, 'flying')).toBe(0);
  });
  it('face-down creatures only: a manifested card enters with the counter, a face-up creature does not', () => {
    const MAN = card('Test Manifest', 'Sorcery', 'Manifest the top card of your library.');
    let s = scenario([], { p1: { hand: ['Test Manifest', 'Test Ox'], battlefield: ['Test Fog'], library: ['Test Ox'] }, defs: [FD, OX, MAN] });
    s = cast(s, 'Test Ox');
    expect(countersOf(s, onBattlefield(s, 'Test Ox')!, 'flying')).toBe(0);
    s = cast(s, 'Test Manifest');
    const down = s.zones.battlefield.find((id) => s.objects[id]!.faceDown);
    expect(down).toBeDefined();
    expect(countersOf(s, down!, 'flying')).toBe(1);
  });
});

describe('CR 122.1, 603.12, 608.2c: "destroy up to one target creature with mana value less than or equal to the number of counters among permanents you control" (Dimension X Pizzasaur; "you control" belongs to the permanents, not to the target)', () => {
  const DINO = card('Test Dino', 'Creature — Dinosaur', 'When this creature enters, put two +1/+1 counters on target creature. When you do, destroy up to one target creature with mana value less than or equal to the number of counters among permanents you control.', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  const TWO = card('Test Two Drop', 'Creature — Ox', '', ['2', '2'], '{1}{W}');
  const THREE = card('Test Three Drop', 'Creature — Ox', '', ['2', '2'], '{2}{W}');
  it('is automated', () => expect(automated(DINO)).toBe(true));
  it('two counters among your permanents destroy an opponent\'s mana value 2 creature; a mana value 3 creature and the opponent\'s own counters do not count', () => {
    for (const [victim, dies, oppCounters] of [['Test Two Drop', true, 0], ['Test Three Drop', false, 0], ['Test Three Drop', false, 5]] as const) {
      let s = scenario([], { p1: { hand: ['Test Dino'], battlefield: ['Test Ox'] }, p2: { battlefield: [{ name: victim, counters: oppCounters > 0 ? { charge: oppCounters } : {} }] }, defs: [DINO, OX, TWO, THREE] });
      const ox = find(s, 'Test Ox', 'battlefield', 'p1');
      const target = find(s, victim, 'battlefield', 'p2');
      if (dies) {
        s = cast(s, 'Test Dino', { targets: [[obj(ox)], [obj(target)]] });
        expect(countersOf(s, ox)).toBe(2);
        expect(has2(s, target), victim).toBe(false);
      } else {
        // the mana value 3 creature is not a legal target with two counters among your permanents (the opponent's own counters never count)
        expect(() => cast(s, 'Test Dino', { targets: [[obj(ox)], [obj(target)]] }), `${victim} ${oppCounters}`).toThrow(/not a legal target/);
      }
    }
  });
});
function has2(s: GameState, id: ObjectId): boolean { return s.zones.battlefield.includes(id); }

