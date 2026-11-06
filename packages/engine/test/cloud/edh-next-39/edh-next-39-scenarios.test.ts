/**
 * Commander round edh-next-39 (EDHREC ranks 5,001-6,250, second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler, in 4-player games (Alice, p1, is the active player of turn 1). Each test is named after the rule it checks, with its negative case. CR cites are from
 * the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read when the round ran.
 *
 *   CR 107.3c, 601.2c, 102.3          "return up to X target Zombie cards ..., where X is the number of opponents you have" (Rot Hulk): the number of targets is counted as they are announced
 *   CR 702.122e                       "Whenever this Vehicle becomes crewed, ..." (Mobilizer Mech, Ghost Ark): when a crew ability of that Vehicle resolves
 *   CR 602.2b, 601.2c, 608.2h         "..., where X is the number of Bobbleheads you control as you activate this ability" (Endurance Bobblehead)
 *   CR 107.14, 614.1a                 "If you would get one or more {E}, you get twice that many {E} instead." (Aether Refinery)
 *   CR 107.3, 608.2h                  "draw cards equal to A or B, whichever is greater" (Prophet of the Scarab)
 *   CR 601.2a, 702.51a                "The next spell you cast this turn has convoke." (Wand of the Worldsoul; the mechanism is played in std-rx26-scenarios.test.ts)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackTaxes, blockTaxes } from '../../../src/statics/combat-tax';
import { applyAction } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hand = (s: GameState, p: string): ObjectId[] => s.zones.hand[p] ?? [];
const yard = (s: GameState, p: string): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const lib = (s: GameState, p: string): string[] => (s.zones.library[p] ?? []).map((id) => s.objects[id]!.defId);
const inHand = (s: GameState, p: string, name: string): boolean => hand(s, p).some((id) => s.objects[id]!.defId === name);
const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const lost = (s: GameState, p: string): boolean => s.players.find((x) => x.id === p)!.hasLost;
/** An Aura (or any attached object) of the card `name` that `owner` controls, attached to a player or an object. */
const attach = (s: GameState, name: string, to: ObjectId, owner = 'p1'): GameState => tweak(s, (t) => { t.objects[put(t, owner, 'battlefield', name)]!.attachedTo = to; });

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] }
/** Answer what comes up (targets, object choices, then the answers); pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** Pass (declaring no attackers when asked) until turn `n` begins and its upkeep gives priority. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'upkeep' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}

const onField = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (p === undefined || s.objects[id]!.controller === p));
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const energy = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;

// ---- "up to X target ..., where X is the number of opponents you have" (CR 107.3c, 601.2c, 102.3)
const HULK = card('Test Gravewalker', 'Creature — Zombie', 'Menace\nWhen this creature enters, return up to X target Zombie cards from your graveyard to the battlefield, where X is the number of opponents you have.', ['2', '2']);
const ZOMBIE = card('Test Shambler', 'Creature — Zombie', '', ['1', '1']);
describe('CR 107.3c, 601.2c, 102.3: "return up to X target Zombie cards from your graveyard to the battlefield, where X is the number of opponents you have."', () => {
  const game = (players = 4) => mpScenario({ players, defs: [HULK, ZOMBIE], zones: { p1: { hand: ['Test Gravewalker'], graveyard: ['Test Shambler', 'Test Shambler', 'Test Shambler', 'Test Shambler'] } } });
  /** Cast the creature and stop at the choice of the trigger's targets. */
  const toChoice = (s0: GameState): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gravewalker', 'hand', 'p1') } as never), {});
    for (let i = 0; i < 10 && s.pending?.kind !== 'chooseTargets'; i++) s = settle(pass(s), {});
    return s;
  };
  it('is automated', () => expect(full(HULK), JSON.stringify(HULK.automation)).toBe(true));
  it('with three opponents the trigger takes up to three targets, and all three return', () => {
    const s0 = toChoice(game());
    expect(s0.pending?.kind).toBe('chooseTargets');
    const p = s0.pending as { max: number; min: number; objects: ObjectId[] };
    expect([p.min, p.max]).toEqual([0, 3]);
    const s = drain(answer(s0, { kind: 'chooseTargets', targets: p.objects.slice(0, 3).map(obj) }), {});
    expect(onField(s, 'Test Shambler', 'p1').length).toBe(3);
    expect(yard(s, 'p1')).toEqual(['Test Shambler']);
  });
  it('negative: in a three-player game the same card takes only two targets (the count follows the opponents)', () => {
    const s0 = toChoice(game(3));
    expect((s0.pending as { max: number }).max).toBe(2);
  });
  it('negative: an opponent who has left the game is no longer counted (CR 102.3, 800.4a)', () => {
    const s1 = tweak(game(), (t) => { t.players.find((x) => x.id === 'p4')!.hasLost = true; });
    const s0 = toChoice(s1);
    expect((s0.pending as { max: number }).max).toBe(2);
  });
});

// ---- "Whenever this Vehicle becomes crewed" (CR 702.122e)
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OXEN = card('Test Oxen', 'Creature — Ox', '', ['4', '4']);
const MECH = card('Test Skiff', 'Artifact — Vehicle', 'Whenever this Vehicle becomes crewed, you gain 1 life.\nCrew 1', ['3', '3']);
const MECH2 = card('Test Barge', 'Artifact — Vehicle', 'Whenever this Vehicle becomes crewed, you gain 10 life.\nCrew 1', ['3', '3']);
describe('CR 702.122e: "Whenever this Vehicle becomes crewed, you gain 1 life."', () => {
  const game = () => mpScenario({ defs: [MECH, MECH2, BEAR], zones: { p1: { battlefield: ['Test Skiff', 'Test Barge', 'Test Bear'] } } });
  const crew = (s0: GameState, name: string): GameState => {
    const src = find(s0, name, 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => /crew/i.test(x.label) && (x.action as { source?: string }).source === src);
    expect(a, 'a legal crew action').toBeDefined();
    const q = queued({});
    return drain(settle(act(s0, a!.action as never), q), q);
  };
  it('is automated', () => expect(full(MECH), JSON.stringify(MECH.automation)).toBe(true));
  it('crewing the Vehicle (its crew ability resolving) triggers it once; another Vehicle of the same player does not', () => {
    const s0 = game();
    const s = crew(s0, 'Test Skiff');
    expect(life(s, 'p1') - life(s0, 'p1')).toBe(1);
    expect(getChars(s, find(s, 'Test Skiff', 'battlefield', 'p1'))!.types).toContain('Creature');
  });
  it('negative: the trigger waits for the crew ability to resolve (nothing while it is on the stack), and the other Vehicle never triggers', () => {
    const s0 = game();
    const src = find(s0, 'Test Skiff', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => /crew/i.test(x.label) && (x.action as { source?: string }).source === src)!;
    const onStack = settle(act(s0, a.action as never), queued({}));
    expect(onStack.zones.stack.length).toBe(1);
    expect(life(onStack, 'p1')).toBe(life(s0, 'p1'));
    const s = drain(onStack, {});
    expect(life(s, 'p1') - life(s0, 'p1')).toBe(1); // not 11: Test Barge was not crewed
  });
});

// ---- "..., where X is the number of Bobbleheads you control as you activate this ability" (CR 602.2b, 601.2c, 608.2h)
const WOBBLER = card('Test Wobbler', 'Artifact — Bobblehead', '{T}: Add {C}.\n{1}, {T}: Up to X target creatures you control get +1/+0 until end of turn, where X is the number of Bobbleheads you control as you activate this ability.');
describe('CR 602.2b, 601.2c: "Up to X target creatures you control get +1/+0 until end of turn, where X is the number of Bobbleheads you control as you activate this ability."', () => {
  const game = (totems: number) => mpScenario({ defs: [WOBBLER, BEAR, OXEN], zones: { p1: { battlefield: [...Array(totems).fill('Test Wobbler') as string[], 'Test Bear', 'Test Oxen', 'Test Bear', 'Plains'] } } });
  const ability = (s: GameState) => {
    const src = find(s, 'Test Wobbler', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => (x.action as { source?: string }).source === src && !/add/i.test(x.label));
    expect(a, 'the second ability is legal').toBeDefined();
    return a!.action as never;
  };
  it('is automated', () => expect(full(WOBBLER), JSON.stringify(WOBBLER.automation)).toBe(true));
  it('with two Bobbleheads the ability takes up to two targets and each gets +1/+0', () => {
    const s0 = game(2);
    const s1 = settle(act(s0, ability(s0)), {});
    expect(s1.pending?.kind).toBe('chooseTargets');
    const p = s1.pending as unknown as { min: number; max: number; objects: ObjectId[] };
    expect([p.min, p.max]).toEqual([0, 2]);
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = drain(settle(answer(s1, { kind: 'chooseTargets', targets: bears.map(obj) }), {}), {});
    for (const b of bears) expect(pt(s, b)).toBe('3/2');
    expect(pt(s, find(s0, 'Test Oxen', 'battlefield', 'p1'))).toBe('4/4');
  });
  it('negative: with one Bobblehead the same ability takes at most one target', () => {
    const s0 = game(1);
    const s1 = settle(act(s0, ability(s0)), {});
    expect((s1.pending as unknown as { max: number }).max).toBe(1);
  });
});

// ---- "If you would get one or more {E}, you get twice that many {E} instead." (CR 107.14, 614.1a)
const REFINER = card('Test Energizer', 'Artifact', 'If you would get one or more {E}, you get twice that many {E} instead.');
const SURGE = card('Test Surge', 'Sorcery', 'You get {E}{E}{E}.');
const GIFT = card('Test Boon', 'Sorcery', 'Target opponent gets {E}{E}{E}.');
describe('CR 107.14, 614.1a: "If you would get one or more {E}, you get twice that many {E} instead."', () => {
  const game = (withRefiner: boolean) => mpScenario({ defs: [REFINER, SURGE, GIFT], zones: { p1: { hand: ['Test Surge', 'Test Boon'], battlefield: withRefiner ? ['Test Energizer'] : [] } } });
  it('is automated', () => { for (const d of [REFINER, SURGE, GIFT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  it('three energy become six', () => expect(energy(cast(game(true), 'Test Surge'), 'p1')).toBe(6));
  it('negative: without the replacement three stay three', () => expect(energy(cast(game(false), 'Test Surge'), 'p1')).toBe(3));
  it('negative: an opponent\'s energy is not doubled (the replacement is for "you")', () => {
    const s = cast(game(true), 'Test Boon', { targets: [[plr('p2')]] });
    expect(energy(s, 'p2')).toBe(3);
    expect(energy(s, 'p1')).toBe(0);
  });
});

// ---- "draw cards equal to A or B, whichever is greater" (CR 107.3, 608.2h)
const REAPER = card('Test Reaper', 'Creature — Elf', 'When this creature enters, draw cards equal to the number of Elves you control or the number of Elf cards in your graveyard, whichever is greater.', ['1', '1']);
const SPRITE = card('Test Sprite', 'Creature — Elf', '', ['1', '1']);
describe('CR 107.3, 608.2h: "draw cards equal to the number of Elves you control or the number of Elf cards in your graveyard, whichever is greater."', () => {
  const game = (yardElves: number, fieldElves: number) => mpScenario({ defs: [REAPER, SPRITE], zones: { p1: { hand: ['Test Reaper'], graveyard: Array(yardElves).fill('Test Sprite') as string[], battlefield: Array(fieldElves).fill('Test Sprite') as string[] } } });
  const drawn = (s0: GameState): number => hand(cast(s0, 'Test Reaper'), 'p1').length - (hand(s0, 'p1').length - 1);
  it('is automated', () => expect(full(REAPER), JSON.stringify(REAPER.automation)).toBe(true));
  it('the larger count is drawn: three Elf cards in the graveyard beat two Elves on the battlefield (the Reaper itself is one)', () => expect(drawn(game(3, 1))).toBe(3));
  it('negative: the other way round, the battlefield\'s count is drawn (not the sum, not the smaller)', () => expect(drawn(game(1, 3))).toBe(4));
});
