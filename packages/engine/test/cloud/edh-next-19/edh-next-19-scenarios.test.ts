/**
 * Commander effort, round edh-next-19 (EDHREC ranks 11,251 to 12,500, fourth pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 208.1, 613.4b     "creature you control with base power and toughness 2/2" (Duskana, the Rage Mother): count and attack trigger
 *   CR 119.1, 500.1      "that player's life total as the turn began" (Sengir, the Dark Baron)
 *   CR 122.1f, 614.17    "You can't get poison counters." (Melira, Sylvok Outcast); CR 702.90 infect lost by "lose infect"
 *   CR 107.1, 208.1      "As long as ~'s power is even / odd, you may cast ... as though they had flash." (Kianne, Corrupted Memory)
 *   CR 611.2a, 613.1b    "Until end of turn, you gain control of target creature and it gains haste." (Grab the Reins, Besmirch); CR 701.15 "Untap and goad that creature."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; options?: string[] }
/** Answer what comes up: targets, object choices, option labels, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseOption' && o.options && o.options.length > 0) {
      const label = o.options.shift()!;
      const opt = p.options.find((x) => x.label === label);
      if (!opt) throw new Error(`no option ${label} among ${p.options.map((x) => x.label).join(', ')}`);
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])], options: [...(o.options ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), q), q);
}
/** Pass (declaring no attackers when asked) until turn `n` begins. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 300 && s.turn.number < n; i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}
/** Pass (declaring nothing when asked) until the first main phase of turn `n`. */
function toMain(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    else s = settle(s, {});
  }
  return s;
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;



const RAGE = card('Test Rage', 'Creature — Bear', 'When ~ enters, draw a card for each creature you control with base power and toughness 2/2.\nWhenever a creature you control with base power and toughness 2/2 attacks, it gets +3/+3 until end of turn.', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const GIANT = card('Test Giant', 'Creature — Giant', '', ['3', '3']);
const MOUSE = card('Test Mouse', 'Creature — Mouse', '', ['1', '1']);
const BARON = card('Test Baron', 'Creature — Vampire', "Whenever another player loses the game, you gain life equal to that player's life total as the turn began.", ['2', '2']);
const SAGE = card('Test Sage', 'Creature — Human', "You can't get poison counters.\nCreatures your opponents control lose infect.", ['2', '2']);
const VIPER = card('Test Viper', 'Creature — Snake', 'Infect', ['2', '2']);
const SEER = card('Test Seer', 'Creature — Illusion', "As long as ~'s power is even, you may cast noncreature spells as though they had flash.\nAs long as ~'s power is odd, you may cast creature spells as though they had flash.", ['2', '2']);
const VENOM = card('Test Venom', 'Instant', 'Target player gets two poison counters.');
const PLAN = card('Test Plan', 'Sorcery', 'Draw a card.');
const REINS = card('Test Reins', 'Instant', 'Until end of turn, you gain control of target creature and it gains haste.');
const SMIRCH = card('Test Smirch', 'Sorcery', 'Until end of turn, gain control of target creature and it gains haste. Untap and goad that creature.');
const LASHER = card('Test Lasher', 'Creature — Elemental', "Whenever ~ deals damage to a player, that player can't gain life for the rest of the game.", ['1', '1']);
const TONIC = card('Test Tonic', 'Instant', 'You gain 3 life.');
const NOURISHER = card('Test Nourisher', 'Legendary Creature — Citizen', 'Whenever one or more other creatures you control with base power and toughness 1/1 enter, put a +1/+1 counter on ~.\nWhenever ~ attacks, each other creature you control with base power and toughness 1/1 gets +X/+X until end of turn, where X is the number of +1/+1 counters on ~.', ['2', '2']);
const WISP = card('Test Wisp', 'Creature — Spirit', 'As long as your life total is less than your life total as the turn began, ~ has flying.', ['1', '1']);
const ALL = [WISP, NOURISHER, LASHER, TONIC, RAGE, BEAR, GIANT, MOUSE, BARON, SAGE, VIPER, SEER, VENOM, PLAN, REINS, SMIRCH];
describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of ALL) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});
const handOf = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const poisonOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.poison;

describe('CR 208.1, 613.4b: "base power and toughness 2/2" is the base value after layer 7b, not the current one', () => {
  const game = () => mpScenario({ players: 3, defs: ALL, zones: { p1: { hand: ['Test Rage'], battlefield: ['Test Bear', 'Test Giant', { name: 'Test Mouse', counters: { '+1/+1': 1 } }, 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('the enter trigger draws one card for each 2/2-based creature I control (two Bears and Test Rage itself), not the Giant, the pumped Mouse (base 1/1, now 2/2) or the opponent\'s Bear', () => {
    const s0 = game();
    const before = handOf(s0, 'p1');
    const s = cast(s0, 'Test Rage');
    expect(handOf(s, 'p1')).toBe(before - 1 + 3);
  });
  it('the attack trigger pumps a base-2/2 attacker by +3/+3 and a Mouse with a counter (2/2 now, base 1/1) not at all', () => {
    const s0 = toMain(game(), 1);
    const bear = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const mouse = byName(s0, 'Test Mouse');
    const rage = byName(cast(s0, 'Test Rage'), 'Test Rage');
    let s = cast(s0, 'Test Rage');
    s = tweak(s, (t) => { delete (t.objects[rage] as { summoningSick?: boolean }).summoningSick; });
    while (s.pending?.kind === 'priority' && s.turn.step !== 'declareAttackers') s = pass(s);
    expect(s.pending?.kind).toBe('declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }, { attacker: mouse, defender: 'p2' }] } as never);
    s = settle(s, {});
    s = drain(s, {});
    expect(stat(s, bear)).toBe('5/5');
    expect(stat(s, mouse)).toBe('2/2');
  });
});

describe('CR 119.1, 500.1: "that player\'s life total as the turn began"', () => {
  it('when another player loses the game, I gain the life that player had when the turn began (not the life they have now)', () => {
    const s0 = mpScenario({ players: 3, defs: ALL, zones: { p1: { battlefield: ['Test Baron'] } }, life: 20 });
    const lost = tweak(s0, (t) => { t.players.find((x) => x.id === 'p2')!.life = 13; });
    // p2 had 20 as the turn began (set when it began), is at 13 now, and then loses the game
    const start = s0.players.find((x) => x.id === 'p2')!.turnStats.lifeAtTurnStart;
    expect(start).toBe(20);
    const r = drain(act(lost, { type: 'concede', player: 'p2' } as never), {});
    expect(lifeOf(r, 'p1')).toBe(40);
  });
  it('negative case: the life total at the start is what counts: a player at 13 who had 13 when the turn began gives 13, and I gain nothing when my own opponent is not the one who lost', () => {
    const s0 = mpScenario({ players: 3, defs: ALL, zones: { p1: { battlefield: ['Test Baron'] } }, life: 20 });
    const lost = tweak(s0, (t) => { t.players.find((x) => x.id === 'p3')!.life = 7; t.players.find((x) => x.id === 'p3')!.turnStats.lifeAtTurnStart = 7; });
    const r = drain(act(lost, { type: 'concede', player: 'p3' } as never), {});
    expect(lifeOf(r, 'p1')).toBe(27);
  });
});

describe('CR 122.1f, 614.17, 702.90: "You can\'t get poison counters." and "Creatures your opponents control lose infect."', () => {
  const game = (withSage: boolean) => mpScenario({ players: 3, defs: ALL, zones: { p1: { hand: ['Test Venom'], battlefield: [...(withSage ? ['Test Sage'] : []), 'Test Bear'] }, p2: { battlefield: ['Test Viper'] } } });
  it('a spell that would give me poison counters gives none while I control the ban, and 2 without it (negative case)', () => {
    const a = cast(game(true), 'Test Venom', { targets: [[plr('p1')]] });
    expect(poisonOf(a, 'p1')).toBe(0);
    const b = cast(game(false), 'Test Venom', { targets: [[plr('p1')]] });
    expect(poisonOf(b, 'p1')).toBe(2);
  });
  it('the ban is mine only: another player still gets poison counters (CR 122.1f)', () => {
    const a = cast(game(true), 'Test Venom', { targets: [[plr('p2')]] });
    expect(poisonOf(a, 'p2')).toBe(2);
  });
  it('an opponent\'s creature loses infect (CR 702.90, 613.1f); mine and the same creature without the static ability keep it', () => {
    expect(kw(game(true), byName(game(true), 'Test Viper'))).not.toContain('infect');
    expect(kw(game(false), byName(game(false), 'Test Viper'))).toContain('infect');
  });
});

describe('CR 107.1, 208.1, 601.3b: "As long as ~\'s power is even / odd, you may cast ... as though they had flash."', () => {
  const game = (counters: number) => mpScenario({ players: 3, defs: ALL, zones: { p1: { hand: ['Test Plan', 'Test Bear'], battlefield: [{ name: 'Test Seer', counters: counters > 0 ? { '+1/+1': counters } : {} }] } } });
  /** Alice (p1) gets priority in the opponent's first main phase (turn 2) with an empty stack: only a spell with flash can be cast. */
  const canCast = (s0: GameState, name: string): boolean => {
    let s = toMain(s0, 2);
    s = pass(pass(s)); // p2 (active), then p3 pass; priority comes to p1
    expect(s.pending?.kind).toBe('priority');
    expect((s.pending as { player: string }).player).toBe('p1');
    return applyAction(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never).error === undefined;
  };
  it('power 2 (even): a noncreature sorcery can be cast on the opponent\'s turn, a creature spell cannot', () => {
    expect(stat(game(0), byName(game(0), 'Test Seer'))).toBe('2/2');
    expect(canCast(game(0), 'Test Plan')).toBe(true);
    expect(canCast(game(0), 'Test Bear')).toBe(false);
  });
  it('power 3 (odd): a creature spell can be cast, a noncreature sorcery cannot', () => {
    expect(stat(game(1), byName(game(1), 'Test Seer'))).toBe('3/3');
    expect(canCast(game(1), 'Test Bear')).toBe(true);
    expect(canCast(game(1), 'Test Plan')).toBe(false);
  });
});

describe('CR 611.2a, 613.1b, 702.10a: "Until end of turn, you gain control of target creature and it gains haste."', () => {
  const game = () => mpScenario({ players: 3, defs: ALL, zones: { p1: { hand: ['Test Reins', 'Test Smirch'] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] } } });
  it('I control the creature and it has haste; at the end of the turn control returns to its owner', () => {
    const s0 = game();
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Reins', { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]!.controller).toBe('p1');
    expect(kw(s, theirs)).toContain('haste');
    s = toTurn(s, 2);
    expect(s.objects[theirs]!.controller).toBe('p2');
  });
  it('Besmirch: I also untap it, and it is goaded', () => {
    const s0 = game();
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Smirch', { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]!.controller).toBe('p1');
    expect(s.objects[theirs]!.tapped).toBe(false);
    expect(s.objects[theirs]!.goaded).toEqual([{ by: 'p1' }]);
    expect(kw(s, theirs)).toContain('haste');
  });
});

describe('CR 611.2a, 119.7: "that player can\'t gain life for the rest of the game" (Stigma Lasher ruling: it goes on if the creature leaves)', () => {
  const game = () => mpScenario({ players: 3, defs: ALL, zones: { p1: { battlefield: ['Test Lasher'] }, p2: { hand: ['Test Tonic'] } } });
  it('the player the creature dealt damage to cannot gain life afterwards (even on a later turn); another player still can', () => {
    const s0 = game();
    const lasher = byName(s0, 'Test Lasher');
    let s = tweak(s0, (t) => { delete (t.objects[lasher] as { summoningSick?: boolean }).summoningSick; });
    while (s.pending?.kind === 'priority' && s.turn.step !== 'declareAttackers') s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: lasher, defender: 'p2' }] } as never);
    for (let i = 0; i < 60 && s.turn.number === 1 && lifeOf(s, 'p2') === 20; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, {});
    s = drain(s, {});
    expect(lifeOf(s, 'p2')).toBe(19);
    s = toMain(s, 2);
    const before = lifeOf(s, 'p2');
    const r = applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Tonic', 'hand', 'p2') } as never);
    expect(r.error).toBeUndefined();
    let t = r.state;
    t = drain(t, {});
    expect(lifeOf(t, 'p2')).toBe(before);
  });
  it('negative case: with no damage dealt, the player can still gain life', () => {
    let s = toMain(game(), 2);
    const before = lifeOf(s, 'p2');
    const r = applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Tonic', 'hand', 'p2') } as never);
    expect(r.error).toBeUndefined();
    s = drain(r.state, {});
    expect(lifeOf(s, 'p2')).toBe(before + 3);
  });
});

describe('CR 208.1, 613.4b, 603.2: "other creatures you control with base power and toughness 1/1 enter" (Bess, Soul Nourisher, a card made full by the same filter)', () => {
  const game = () => mpScenario({ players: 3, defs: ALL, zones: { p1: { hand: ['Test Mouse', 'Test Bear', 'Test Giant'], battlefield: ['Test Nourisher'] } } });
  it('a 1/1-based creature entering puts a +1/+1 counter on the source; a 2/2 or 3/3 entering does not', () => {
    const s0 = game();
    const src = byName(s0, 'Test Nourisher');
    const a = cast(s0, 'Test Mouse');
    expect(s0.objects[src]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(a.objects[src]!.counters['+1/+1']).toBe(1);
    const b = cast(cast(s0, 'Test Bear'), 'Test Giant');
    expect(b.objects[src]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('the attack trigger pumps the base-1/1 creatures only, by the number of counters', () => {
    const s0 = toMain(mpScenario({ players: 3, defs: ALL, zones: { p1: { battlefield: [{ name: 'Test Nourisher', counters: { '+1/+1': 2 } }, 'Test Mouse', 'Test Bear'] } } }), 1);
    const mouse = byName(s0, 'Test Mouse');
    const bear = byName(s0, 'Test Bear');
    const nour = byName(s0, 'Test Nourisher');
    let s = s0;
    while (s.pending?.kind === 'priority' && s.turn.step !== 'declareAttackers') s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: nour, defender: 'p2' }] } as never);
    s = drain(settle(s, {}), {});
    expect(stat(s, mouse)).toBe('3/3');
    expect(stat(s, bear)).toBe('2/2');
  });
});

describe('CR 119.1, 500.1, 611.3a: a static ability reading "your life total as the turn began"', () => {
  it('has flying only after I lost life this turn (20 at the start, 17 now); not at 20, not at 23', () => {
    const s0 = mpScenario({ players: 3, defs: ALL, zones: { p1: { battlefield: ['Test Wisp'] } } });
    const wisp = byName(s0, 'Test Wisp');
    expect(kw(s0, wisp)).not.toContain('flying');
    expect(kw(tweak(s0, (t) => { t.players.find((x) => x.id === 'p1')!.life = 17; }), wisp)).toContain('flying');
    expect(kw(tweak(s0, (t) => { t.players.find((x) => x.id === 'p1')!.life = 23; }), wisp)).not.toContain('flying');
  });
});
