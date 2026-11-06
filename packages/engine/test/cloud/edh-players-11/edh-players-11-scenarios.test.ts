/**
 * edh-players-11 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The rulings of the cards were fetched from Scryfall in the cloud session;
 * the CR cites are from memory (unverified).
 *
 *   CR 608.2c, 608.2d, 101.4      "Each player may draw a card, then each player who drew a card this way gains N life."
 *   CR 508.1b, 508.1c, 611.2a     "Each opponent who does can't attack you or permanents you control during their next turn." / "If a player does, creatures that player controls can't attack you ..."
 *   CR 122.1, 122.6, 603.2c       "Whenever you put one or more counters on a permanent or player, ~ deals that much damage to target opponent, creature an opponent controls, or planeswalker ..."
 *   CR 118.9, 601.2b, 607.2i      "You may pay {1}{B} rather than pay this spell's mana cost. If the {1}{B} cost was paid, an opponent draws a card."
 *   CR 701.13a, 608.2c            "Exile the top N cards of your library. Put all artifact cards from among them onto the battlefield."
 *   CR 608.2d, 613.4c, 114.4      "Target creature gets +X/+X or -X/-X ..." and an emblem that gives lands a mana ability
 *   CR 508.1, 903.3, 508.4        "Whenever you attack with ~ and/or your commander, for each opponent, create a token that's tapped and attacking that player."
 *   CR 602.2b, 608.2h             "{T}, Sacrifice another creature: Draw X cards, where X is that creature's power."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, commanderOptions, compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, life, pass, passBoth, put, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { legend } from '../../m11/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

interface Script {
  yes?: boolean[];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  targets?: TargetChoice[][];
  colors?: string[];
  options?: string[][];
  attackers?: ObjectId[];
  defender?: PlayerId;
  blocks?: { blocker: ObjectId; attacker: ObjectId }[];
}
/** Answer the decisions that come up until a player has priority; the decisions asked are listed in `asked`. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (script.colors?.shift() ?? p.options[0]) as never });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: (script.attackers ?? []).map((attacker) => ({ attacker, defender: script.defender ?? ('p2' as const) })) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: script.blocks ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes (in turn, all of them in a game of three or four) until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 120; guard++) s = drive(pass(s), script, asked);
  return s;
}
const castFree = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
/** p2's cast of `name` at `target`, as far as choosing the target: a throw means the target is not legal. */
const castAt = (s: GameState, name: string, target: TargetChoice) => answer(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }), { kind: 'chooseTargets', targets: [target] });
/** Whether `attacker` (of the player whose declaration is pending) may be declared as an attacker of `defender` (a player id) now. */
const attackOk = (s: GameState, attacker: ObjectId, defender: PlayerId): boolean => {
  const d = s.pending;
  if (!d || d.kind !== 'declareAttackers') throw new Error(`no declaration pending: ${d?.kind}`);
  return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker, defender }] } }).error === undefined;
};
/** Everyone passes (declaring no attackers and no blockers, declining optional effects) until `turn`'s declare attackers decision is asked. */
function toDeclaration(s0: GameState, turn: number): GameState {
  let s = s0;
  for (let guard = 0; guard < 600; guard++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers' && s.turn.number === turn) return s;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else s = pass(s);
  }
  throw new Error(`could not reach the attackers of turn ${turn}`);
}
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const BEAR = (n: string): CardDef => card(`Test Bear ${n}`, 'Creature — Bear', '', { pt: ['2', '2'] });

// ---- Kwain, Itinerant Meddler -----------------------------------------------------------------------------------------------------------------------------------------

const MEDDLER = card('Test Meddler', 'Sorcery', 'Each player may draw a card, then each player who drew a card this way gains 2 life.');

describe('CR 608.2c, 608.2d, 101.4: "Each player may draw a card, then each player who drew a card this way gains 2 life."', () => {
  const setup = (): GameState => mpScenario({ players: 4, defs: [MEDDLER], zones: { p1: { hand: ['Test Meddler'] } } });
  it('is automated', () => expect(full(MEDDLER)).toBe(true));
  it('exactly the players who chose to draw draw a card and gain the life; the others neither (the negative case)', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = castFree(s0, 'Test Meddler', { yes: [true, false, true, false] }, 'p1', asked);
    expect(asked).toEqual(['yesNo:p1', 'yesNo:p2', 'yesNo:p3', 'yesNo:p4']);
    // p1 cast the spell from hand (-1) and drew one
    expect([handOf(s, 'p1'), handOf(s, 'p2'), handOf(s, 'p3'), handOf(s, 'p4')]).toEqual([handOf(s0, 'p1') - 1 + 1, handOf(s0, 'p2'), handOf(s0, 'p3') + 1, handOf(s0, 'p4')]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([22, 20, 22, 20]);
  });
  it('nobody drawing means nobody gains life', () => {
    const s = castFree(setup(), 'Test Meddler', { yes: [false, false, false, false] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20, 20, 20]);
  });
  it('a player whose library is empty draws no card, so gains no life, however they chose (review: "who drew a card this way")', () => {
    const s0 = mpScenario({ players: 4, defs: [MEDDLER], zones: { p1: { hand: ['Test Meddler'] } }, setup: (g) => { for (const id of g.zones.library['p2']!) delete g.objects[id]; g.zones.library['p2'] = []; } });
    const s = castFree(s0, 'Test Meddler', { yes: [true, true, true, true] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([22, 20, 22, 22]);
  });
  it('everyone drawing: everyone gains it', () => {
    const s = castFree(setup(), 'Test Meddler', { yes: [true, true, true, true] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([22, 22, 22, 22]);
  });
});

// ---- Orzhov Advokist ------------------------------------------------------------------------------------------------------------------------------------------------

const ADVOCATE = card('Test Advocate', 'Sorcery', "Each player may put two +1/+1 counters on a creature they control. If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn.");

describe("CR 608.2c, 508.1b, 611.2a: \"Each player may put two +1/+1 counters on a creature they control. If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn.\"", () => {
  const defs = [ADVOCATE, BEAR('A'), BEAR('B'), BEAR('C'), BEAR('D')];
  const setup = (): GameState => mpScenario({
    players: 4, defs,
    zones: { p1: { hand: ['Test Advocate'], battlefield: ['Test Bear A'] }, p2: { battlefield: ['Test Bear B'] }, p3: { battlefield: ['Test Bear C'] }, p4: { battlefield: ['Test Bear D'] } },
  });
  const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(ADVOCATE)).toBe(true));
  it('each player who put the counters can not attack you with any creature on their next turn, even one that came later; the player who declined can (the negative case)', () => {
    const asked: string[] = [];
    let s = castFree(setup(), 'Test Advocate', { yes: [true, true, false, true], objects: [(o) => o.slice(0, 1), (o) => o.slice(0, 1), (o) => o.slice(0, 1)] }, 'p1', asked);
    expect([counters(s, 'Test Bear A'), counters(s, 'Test Bear B'), counters(s, 'Test Bear C'), counters(s, 'Test Bear D')]).toEqual([2, 2, 0, 2]);
    put(s, 'p2', 'battlefield', 'Test Bear A'); // a creature that came after the effect began (CR 611.2c): the restriction is on creatures the player controls, whenever they came
    s = toDeclaration(s, 2);
    expect(s.pending?.player).toBe('p2');
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p1')).toBe(false);
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p3')).toBe(true); // it only keeps them from attacking the Advokist's controller (and planeswalkers)
    s = toDeclaration(s, 3);
    expect(s.pending?.player).toBe('p3');
    expect(attackOk(s, find(s, 'Test Bear C', 'battlefield'), 'p1')).toBe(true);
    s = toDeclaration(s, 4);
    expect(attackOk(s, find(s, 'Test Bear D', 'battlefield'), 'p1')).toBe(false);
  });
  it('it lasts until your next turn: on the turn after, the player may attack you again', () => {
    let s = castFree(setup(), 'Test Advocate', { yes: [false, true, false, false], objects: [(o) => o.slice(0, 1)] });
    s = toDeclaration(s, 6);
    expect(s.pending?.player).toBe('p2');
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p1')).toBe(true);
  });
  it('a player with no creature to put the counters on does not do it, so is not kept from attacking (the negative case)', () => {
    const s0 = mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Advocate'], battlefield: ['Test Bear A'] }, p2: { battlefield: [] }, p3: { battlefield: ['Test Bear C'] }, p4: { battlefield: [] } } });
    let s = castFree(s0, 'Test Advocate', { yes: [false, true, false, false], objects: [] });
    put(s, 'p2', 'battlefield', 'Test Bear B');
    s = toDeclaration(s, 2);
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p1')).toBe(true);
  });
});

// ---- The Second Doctor ----------------------------------------------------------------------------------------------------------------------------------------------

const DOCTOR = card('Test Time Lord', 'Creature — Time Lord', "At the beginning of your end step, each player may draw a card. Each opponent who does can't attack you or permanents you control during their next turn.", { pt: ['3', '3'] });

describe("CR 508.1b, 611.2a, 101.4: \"At the beginning of your end step, each player may draw a card. Each opponent who does can't attack you or permanents you control during their next turn.\"", () => {
  const defs = [DOCTOR, BEAR('A'), BEAR('B'), BEAR('C'), BEAR('D')];
  const setup = (): GameState => mpScenario({
    players: 4, defs,
    zones: { p1: { battlefield: ['Test Time Lord', 'Test Bear A'] }, p2: { battlefield: ['Test Bear B'] }, p3: { battlefield: ['Test Bear C'] }, p4: { battlefield: ['Test Bear D'] } },
  });
  it('is automated', () => expect(full(DOCTOR)).toBe(true));
  it('an opponent who drew can not attack you during their next turn (and then may again); one who did not, and you, are not kept from it', () => {
    const asked: string[] = [];
    let s = settle(advanceTo(setup(), 1, 'end'), { yes: [true, true, false, true] }, asked);
    expect(asked).toEqual(['yesNo:p1', 'yesNo:p2', 'yesNo:p3', 'yesNo:p4']);
    s = toDeclaration(s, 2);
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p1')).toBe(false);
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p3')).toBe(true);
    s = toDeclaration(s, 3);
    expect(attackOk(s, find(s, 'Test Bear C', 'battlefield'), 'p1')).toBe(true); // declined: not kept
    s = toDeclaration(s, 4);
    expect(attackOk(s, find(s, 'Test Bear D', 'battlefield'), 'p1')).toBe(false);
    // their NEXT turn only: the turn after that, p2 may attack again (turn 6)
    s = toDeclaration(s, 6);
    expect(s.pending?.player).toBe('p2');
    expect(attackOk(s, find(s, 'Test Bear B', 'battlefield'), 'p1')).toBe(true);
  });
  it("your own draw is not an opponent's: the controller is never kept from anything", () => {
    const s = settle(advanceTo(setup(), 1, 'end'), { yes: [true, false, false, false] });
    expect(handOf(s, 'p1')).toBeGreaterThan(0);
    // the controller's own creatures may of course attack at their next turn
    const t = toDeclaration(s, 5);
    expect(t.pending?.player).toBe('p1');
    expect(attackOk(t, find(t, 'Test Bear A', 'battlefield'), 'p2')).toBe(true);
  });
});

// ---- All Will Be One ------------------------------------------------------------------------------------------------------------------------------------------------

const AWBO = card('Test Fuse', 'Enchantment', 'Whenever you put one or more counters on a permanent or player, ~ deals that much damage to target opponent, creature an opponent controls, or planeswalker an opponent controls.');
const BOOST = card('Test Boost', 'Sorcery', 'Put three +1/+1 counters on target creature you control.');
const TAINT = card('Test Taint', 'Sorcery', 'Target opponent gets two poison counters.');
const GROW = card('Test Grow', 'Sorcery', 'Put two +1/+1 counters on target creature you control.');

describe('CR 122.1, 122.6, 603.2c: "Whenever you put one or more counters on a permanent or player, ~ deals that much damage to target opponent, creature an opponent controls, or planeswalker an opponent controls."', () => {
  const defs = [AWBO, BOOST, TAINT, GROW, BEAR('A'), BEAR('B')];
  const setup = (): GameState => mpScenario({
    players: 3, defs,
    zones: { p1: { hand: ['Test Boost', 'Test Taint'], battlefield: ['Test Fuse', 'Test Bear A'] }, p2: { hand: ['Test Grow'], battlefield: ['Test Bear B'] } },
  });
  it('is automated', () => expect(full(AWBO)).toBe(true));
  it('+1/+1 counters you put on a permanent deal that much damage to the target chosen: an opponent, or a creature an opponent controls', () => {
    let s = setup();
    s = castFree(s, 'Test Boost', { targets: [[obj(find(s, 'Test Bear A', 'battlefield'))], [pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(20);
    s = setup();
    s = castFree(s, 'Test Boost', { targets: [[obj(find(s, 'Test Bear A', 'battlefield'))], [obj(find(s, 'Test Bear B', 'battlefield'))]] });
    expect(find(s, 'Test Bear B', 'graveyard')).toBeDefined(); // 3 damage kills a 2/2
  });
  it('poison counters you put on a player trigger it too, for the number of counters', () => {
    let s = setup();
    s = castFree(s, 'Test Taint', { targets: [[pl('p2')], [pl('p3')]] });
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it("your own creature or yourself is not a target; counters an opponent puts do not trigger it (the negative cases)", () => {
    let s = setup();
    s = answer(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Boost', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(find(s, 'Test Bear A', 'battlefield'))] });
    for (let guard = 0; guard < 12 && s.pending?.kind === 'priority'; guard++) s = pass(s); // the spell resolves; the trigger then waits for its target
    const d = s.pending;
    expect(d?.kind).toBe('chooseTargets');
    expect(applyAction(s, { type: 'answer', player: 'p1', decisionId: d!.id, answer: { kind: 'chooseTargets', targets: [pl('p1')] } }).error).toBeDefined();
    expect(applyAction(s, { type: 'answer', player: 'p1', decisionId: d!.id, answer: { kind: 'chooseTargets', targets: [obj(find(s, 'Test Bear A', 'battlefield'))] } }).error).toBeDefined();
    // p2's own +1/+1 counters (at p2's turn) do not trigger it: nothing is asked, nobody loses life
    let t = advanceTo(setup(), 2, 'main1');
    t = castFree(t, 'Test Grow', { targets: [[obj(find(t, 'Test Bear B', 'battlefield'))]] }, 'p2');
    expect(lifeOf(t, 'p1')).toBe(20);
    expect(lifeOf(t, 'p2')).toBe(20);
    expect(t.pending?.kind === 'chooseTargets').toBe(false);
  });
  it("counters another player puts with an effect of yours are theirs (Orzhov Advokist's ruling of 2020-11-10): only the ones you put trigger it", () => {
    const OFFER = card('Test Offer', 'Sorcery', 'Each player may put two +1/+1 counters on a creature they control.');
    const build = (): GameState => mpScenario({ players: 3, defs: [AWBO, OFFER, BEAR('A'), BEAR('B')], zones: { p1: { hand: ['Test Offer'], battlefield: ['Test Fuse', 'Test Bear A'] }, p2: { battlefield: ['Test Bear B'] } } });
    const pick = (o: ObjectId[]): ObjectId[] => o.slice(0, 1);
    const theirs: string[] = [];
    castFree(build(), 'Test Offer', { yes: [false, true, false], objects: [pick] }, 'p1', theirs);
    expect(theirs.filter((x) => x.startsWith('chooseTargets'))).toEqual([]); // p2 put them
    const mine: string[] = [];
    castFree(build(), 'Test Offer', { yes: [true, false, false], objects: [pick], targets: [[pl('p3')]] }, 'p1', mine);
    expect(mine.filter((x) => x.startsWith('chooseTargets'))).toEqual(['chooseTargets:p1']); // p1 put them
  });
  it('two creatures with toxic dealing combat damage to a player at the same time put the counters as one event: the ability triggers one time (ruling 2023-02-04)', () => {
    const TOX = card('Test Toxic', 'Creature — Insect', 'Toxic 1', { pt: ['1', '1'] });
    let s = mpScenario({ players: 3, defs: [AWBO, TOX], zones: { p1: { battlefield: ['Test Fuse', 'Test Toxic', 'Test Toxic'] } } });
    s = toDeclaration(s, 1);
    const [a, b] = findAll(s, 'Test Toxic', 'battlefield', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }] });
    const asked: string[] = [];
    s = settle(s, { targets: [[pl('p3')]] }, asked);
    for (let guard = 0; guard < 40 && s.turn.step !== 'main2'; guard++) s = drive(s.pending?.kind === 'priority' ? pass(s) : s, { targets: [[pl('p3')]] }, asked);
    expect(asked.filter((x) => x.startsWith('chooseTargets'))).toHaveLength(1); // one trigger
    expect(s.players.find((p) => p.id === 'p2')!.poison).toBe(2);
    expect(lifeOf(s, 'p3')).toBe(18); // that much: both creatures' counters together
  });
});

// ---- Baleful Mastery ------------------------------------------------------------------------------------------------------------------------------------------------

const MASTERY = card('Test Mastery', 'Instant', "You may pay {1}{B} rather than pay this spell's mana cost.\nIf the {1}{B} cost was paid, an opponent draws a card.\nExile target creature or planeswalker.", { cost: '{3}{B}' });
const SWAMP = card('Test Swamp', 'Basic Land — Swamp', '{T}: Add {B}.');

describe("CR 118.9, 601.2b, 607.2i: 'You may pay {1}{B} rather than pay this spell's mana cost. If the {1}{B} cost was paid, an opponent draws a card. Exile target creature or planeswalker.'", () => {
  const defs = [MASTERY, SWAMP, BEAR('B')];
  const setup = (lands: number): GameState => scenario([], { defs, p1: { hand: ['Test Mastery'], battlefield: Array(lands).fill('Test Swamp') as string[] }, p2: { battlefield: ['Test Bear B'] } });
  const cast = (s0: GameState, method?: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mastery', 'hand', 'p1'), ...(method ? { method } : {}) });
    s = drive(s, { targets: [[obj(find(s0, 'Test Bear B', 'battlefield'))]] });
    return settle(s);
  };
  it('is automated', () => expect(full(MASTERY)).toBe(true));
  it('paying the alternative cost: the opponent draws a card and the creature is exiled', () => {
    const s0 = setup(2);
    const s = cast(s0, 'alternative');
    expect(handOf(s, 'p2')).toBe(handOf(s0, 'p2') + 1);
    expect(findAll(s, 'Test Bear B', 'exile')).toHaveLength(1);
  });
  it('paying the mana cost: the creature is exiled and the opponent does not draw (the negative case)', () => {
    const s0 = setup(4);
    const s = cast(s0);
    expect(handOf(s, 'p2')).toBe(handOf(s0, 'p2'));
    expect(findAll(s, 'Test Bear B', 'exile')).toHaveLength(1);
  });
});

// ---- Tezzeret, Master of the Bridge ---------------------------------------------------------------------------------------------------------------------------------

const RELIC_A = card('Test Relic A', 'Artifact', '');
const RELIC_B = card('Test Relic B', 'Artifact', '');
const GRAIL = card('Test Grail', 'Sorcery', 'Exile the top four cards of your library. Put all artifact cards from among them onto the battlefield.');
const BRIDGE = card('Test Bridge', 'Sorcery', '~ deals X damage to each opponent, where X is the number of artifacts you control. You gain X life.');

describe('CR 701.13a, 608.2c, 400.7j: "Exile the top four cards of your library. Put all artifact cards from among them onto the battlefield."', () => {
  const defs = [GRAIL, RELIC_A, RELIC_B, BEAR('A')];
  it('is automated', () => expect(full(GRAIL)).toBe(true));
  it('every artifact among the exiled cards enters; the others stay exiled; an artifact below them stays in the library (the negative cases)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Grail'], library: ['Test Relic A', 'Test Bear A', 'Test Relic B', 'Plains', 'Test Relic A'] } });
    const s = castFree(s0, 'Test Grail');
    expect(findAll(s, 'Test Relic A', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Relic B', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear A', 'exile')).toHaveLength(1);
    expect(findAll(s, 'Plains', 'exile')).toHaveLength(1);
    expect(findAll(s, 'Test Relic A', 'library', 'p1')).toHaveLength(1); // the fifth card
  });
});

describe('CR 608.2h, 107.3: "~ deals X damage to each opponent, where X is the number of artifacts you control. You gain X life."', () => {
  const defs = [BRIDGE, RELIC_A];
  it('is automated, and deals and gains the number of artifacts', () => {
    expect(full(BRIDGE)).toBe(true);
    const s = castFree(mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Bridge'], battlefield: ['Test Relic A', 'Test Relic A', 'Test Relic A'] } } }), 'Test Bridge');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([23, 17, 17]);
  });
  it('with no artifact: nothing happens (the negative case)', () => {
    const s = castFree(mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Bridge'] } } }), 'Test Bridge');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([20, 20, 20]);
  });
});

// ---- Liliana of the Dark Realms ---------------------------------------------------------------------------------------------------------------------------------------

const SHRINK = card('Test Withering', 'Sorcery', 'Target creature gets +X/+X or -X/-X until end of turn, where X is the number of Swamps you control.');
const ELEMENTAL = card('Test Swampcaller', 'Sorcery', 'You get an emblem with "Swamps you control have \'{T}: Add {B}{B}{B}{B}.\'"');

describe('CR 608.2d, 613.4c: "Target creature gets +X/+X or -X/-X until end of turn, where X is the number of Swamps you control."', () => {
  const defs = [SHRINK, SWAMP, BEAR('B')];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Withering'], battlefield: ['Test Swamp', 'Test Swamp', 'Test Swamp'] }, p2: { battlefield: ['Test Bear B'] } });
  it('is automated', () => expect(full(SHRINK)).toBe(true));
  it('the controller chooses the sign as it resolves: +3/+3 or -3/-3', () => {
    for (const [pick, pt] of [['0', '5/5'], ['1', 'dies']] as const) { // (the option ids: 0 = +X/+X, 1 = -X/-X)
      let s = setup();
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Withering', 'hand', 'p1') });
      s = drive(s, { targets: [[obj(find(s, 'Test Bear B', 'battlefield'))]] });
      s = settle(s, { options: [[pick]] });
      if (pt === 'dies') expect(findAll(s, 'Test Bear B', 'graveyard', 'p2')).toHaveLength(1);
      else expect(Number(getChars(s, find(s, 'Test Bear B', 'battlefield')).power)).toBe(5);
    }
  });
});

describe('CR 114.4, 113.6, 605.1: an emblem that gives Swamps a mana ability', () => {
  const defs = [ELEMENTAL, SWAMP];
  it('is automated, and each Swamp you control then taps for {B}{B}{B}{B}', () => {
    expect(full(ELEMENTAL)).toBe(true);
    let s = scenario([], { defs, p1: { hand: ['Test Swampcaller'], battlefield: ['Test Swamp'] } });
    s = castFree(s, 'Test Swampcaller');
    const swamp = find(s, 'Test Swamp', 'battlefield', 'p1');
    const pools = legalActions(s, 'p1').filter((a) => a.action.type === 'activate' && (a.action as { source?: string }).source === swamp)
      .map((a) => applyAction(s, a.action)).filter((r) => r.error === undefined).map((r) => r.state.players.find((p) => p.id === 'p1')!.manaPool.length);
    // the Swamp's own ability makes one mana, the one the emblem gives it four (the engine lists both; the player chooses)
    expect(pools.sort()).toEqual([1, 1, 4]);
  });
});

// ---- Ainok Strike Leader ----------------------------------------------------------------------------------------------------------------------------------------------

const AINOK = card('Test Pack Leader', 'Creature — Dog Warrior', "Whenever you attack with ~ and/or your commander, for each opponent, create a 1/1 red Goblin creature token that's tapped and attacking that player.", { pt: ['2', '1'] });

describe("CR 508.1, 508.4, 603.2c: \"Whenever you attack with ~ and/or your commander, for each opponent, create a 1/1 red Goblin creature token that's tapped and attacking that player.\"", () => {
  const defs = [AINOK, BEAR('A')];
  const setup = (): GameState => mpScenario({ players: 4, defs, zones: { p1: { battlefield: ['Test Pack Leader', 'Test Bear A'] } } });
  const goblins = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:Goblin'));
  it('is automated', () => expect(full(AINOK)).toBe(true));
  it('attacking with it creates one tapped Goblin attacking each opponent', () => {
    let s = toDeclaration(setup(), 1);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Pack Leader', 'battlefield'), defender: 'p2' }] });
    s = settle(s);
    const g = goblins(s);
    expect(g).toHaveLength(3);
    expect(g.every((id) => s.objects[id]!.tapped === true)).toBe(true);
    expect(g.map((id) => s.combat?.attackers.find((a) => a.id === id)?.defender).sort()).toEqual(['p2', 'p3', 'p4']); // one for each opponent, attacking that player
  });
  it('attacking with your commander alone creates them too, once for the declaration; both attacking is still one trigger', () => {
    const CAPTAIN = legend('Test Captain', '{1}{W}', ['3', '3'], ['W', 'R']);
    const withCommander = (): GameState => mpScenario({
      players: 4, defs, commanders: { p1: [CAPTAIN], p2: [legend('Test Beta', '{1}{W}', ['3', '3'], ['W'])], p3: [legend('Test Gamma', '{1}{W}', ['3', '3'], ['W'])], p4: [legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])] }, options: { commander: commanderOptions('commander') },
      zones: { p1: { battlefield: ['Test Pack Leader'] } },
      setup: (x) => {
        const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Test Captain')!;
        x.zones.command = x.zones.command.filter((o) => o !== id);
        x.zones.battlefield.push(id);
        x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
      },
    });
    let s = toDeclaration(withCommander(), 1);
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Captain', 'battlefield'), defender: 'p2' }] }));
    expect(goblins(s)).toHaveLength(3);
    let t = toDeclaration(withCommander(), 1);
    t = settle(answer(t, { kind: 'declareAttackers', attacks: [{ attacker: find(t, 'Test Captain', 'battlefield'), defender: 'p2' }, { attacker: find(t, 'Test Pack Leader', 'battlefield'), defender: 'p3' }] }));
    expect(goblins(t)).toHaveLength(3);
  });
  it('attacking with another creature only creates nothing (the negative case)', () => {
    let s = toDeclaration(setup(), 1);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear A', 'battlefield'), defender: 'p2' }] });
    s = settle(s);
    expect(goblins(s)).toHaveLength(0);
  });
});

// ---- Shadowheart, Dark Justiciar ------------------------------------------------------------------------------------------------------------------------------------

const HEART = card('Test Heart', 'Creature — Elf', '{T}, Sacrifice another creature: Draw X cards, where X is that creature\'s power.', { pt: ['1', '1'] });
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['4', '4'] });

describe("CR 602.2b, 608.2h: '{T}, Sacrifice another creature: Draw X cards, where X is that creature's power.'", () => {
  const defs = [HEART, BRUTE, BEAR('A')];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Heart', 'Test Brute', 'Test Bear A'] } });
  it('is automated', () => expect(full(HEART)).toBe(true));
  it('draws as many cards as the power of the creature sacrificed, as it last existed', () => {
    for (const [name, n] of [['Test Brute', 4], ['Test Bear A', 2]] as const) {
      const s0 = setup();
      const heart = find(s0, 'Test Heart', 'battlefield', 'p1');
      const act0 = legalActions(s0, 'p1').find((a) => a.action.type === 'activate' && (a.action as { source?: string }).source === heart)!;
      let s = act(s0, act0.action);
      s = drive(s, { objects: [[find(s0, name, 'battlefield', 'p1')]] });
      s = settle(s);
      expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length + n);
    }
  });
  it('the creature itself can not be sacrificed (another creature), so a lone Heart can not use it (the negative case)', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Heart'] } });
    const heart = find(s, 'Test Heart', 'battlefield', 'p1');
    const usable = legalActions(s, 'p1').filter((a) => a.action.type === 'activate' && (a.action as { source?: string }).source === heart);
    expect(usable.length).toBe(0);
  });
});
