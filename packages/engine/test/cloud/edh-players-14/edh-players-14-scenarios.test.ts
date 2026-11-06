/**
 * edh-players-14 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The rulings of the cards were fetched from Scryfall in the cloud session; the
 * CR numbers were checked against the text of the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.9a, 608.2c, 608.2d, 101.4   "Each player may discard their hand and draw five cards. Then ~ deals 5 damage to each opponent who discarded their hand this way."
 *   CR 701.9a, 608.2c, 608.2e, 119.3   "Each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life."
 *   CR 122.1, 608.2h, 603.10a          "When this creature dies, each opponent gets a number of rad counters equal to its power."
 *   CR 611.2a, 611.2c, 613.1f          "Whenever this creature attacks, it and Zombies you control gain deathtouch until end of turn."
 *   CR 506.3, 508.1, 603.4             "At end of combat on your turn, if you attacked this turn, create a Junk token for each opponent you attacked."
 *   CR 118.12, 701.21a, 119.4          "At the beginning of your upkeep, draw a card unless target opponent sacrifices a creature of their choice or pays 3 life."
 *   CR 700.6, 603.2                    "Whenever ~ or another nontoken historic permanent you control enters, ~ deals 1 damage to each opponent and you gain 1 life."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, commanderOptions, compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, life, pass, passBoth, put, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { legend } from '../../m11/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

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

const radOf = (s: GameState, p: PlayerId): number => (s.players.find((x) => x.id === p)!.counters as Record<string, number>)['rad'] ?? 0;
const CREATURE_LAND = card('Test Plain Land', 'Land', '');

// ---- Snort ----------------------------------------------------------------------------------------------------------------------------------------------------------

const SNORT = card('Test Snort', 'Sorcery', 'Each player may discard their hand and draw five cards. Then ~ deals 5 damage to each opponent who discarded their hand this way.');

describe('CR 701.9a, 608.2c, 608.2d: "Each player may discard their hand and draw five cards. Then ~ deals 5 damage to each opponent who discarded their hand this way."', () => {
  const setup = (): GameState => mpScenario({ players: 4, defs: [SNORT, BEAR('A'), BEAR('B')], zones: { p1: { hand: ['Test Snort'] }, p2: { hand: ['Test Bear A'] }, p3: { hand: [] }, p4: { hand: ['Test Bear B'] } } });
  it('is automated', () => expect(full(SNORT)).toBe(true));
  it('only the opponents who discarded their hand are dealt 5 damage; the one who declined and you are not (the negative case)', () => {
    const asked: string[] = [];
    const s = castFree(setup(), 'Test Snort', { yes: [true, true, false, true] }, 'p1', asked);
    expect(asked.slice(0, 4)).toEqual(['yesNo:p1', 'yesNo:p2', 'yesNo:p3', 'yesNo:p4']);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 15, 20, 15]);
    expect([handOf(s, 'p2'), handOf(s, 'p3'), handOf(s, 'p4')]).toEqual([5, 0, 5]);
  });
  it('nobody discarding means no damage', () => {
    const s = castFree(setup(), 'Test Snort', { yes: [false, false, false, false] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20, 20, 20]);
  });
  it('a player with an empty hand who chooses to discard it does discard their hand (ruling of Snort): 5 damage', () => {
    const s = castFree(setup(), 'Test Snort', { yes: [false, false, true, false] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20, 15, 20]);
  });
  it('you are not an opponent: you discarding your hand does not hurt you', () => {
    const s = castFree(setup(), 'Test Snort', { yes: [true, false, false, false] });
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- Kroxa ----------------------------------------------------------------------------------------------------------------------------------------------------------

const PIT = card('Test Pit', 'Sorcery', "Each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.");

describe('CR 701.9a, 608.2c, 608.2e: "Each opponent discards a card, then each opponent who didn\'t discard a nonland card this way loses 3 life."', () => {
  const setup = (): GameState => mpScenario({
    players: 4, defs: [PIT, BEAR('A'), BEAR('B'), CREATURE_LAND],
    zones: { p1: { hand: ['Test Pit', 'Test Plain Land'] }, p2: { hand: ['Test Plain Land'] }, p3: { hand: ['Test Bear A'] }, p4: { hand: [] } },
  });
  it('is automated', () => expect(full(PIT)).toBe(true));
  it('an opponent who discarded a land or had no card to discard loses 3 life; one who discarded a nonland card does not; you never do (ruling of Kroxa)', () => {
    const s = castFree(setup(), 'Test Pit');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 17, 20, 17]);
    expect([handOf(s, 'p2'), handOf(s, 'p3')]).toEqual([0, 0]);
  });
  it('an opponent with a land and a nonland card in hand chooses; discarding the nonland card keeps their life, discarding the land loses 3 (the choice is theirs)', () => {
    for (const [pick, expected] of [['Test Bear B', 20], ['Test Plain Land', 17]] as const) {
      const s0 = mpScenario({ players: 4, defs: [PIT, BEAR('B'), CREATURE_LAND], zones: { p1: { hand: ['Test Pit'] }, p2: { hand: ['Test Bear B', 'Test Plain Land'] } } });
      const s = castFree(s0, 'Test Pit', { objects: [(o, g) => [o.find((id) => g.defs[g.objects[id]!.defId]!.name === pick || g.objects[id]!.defId === pick)!]] });
      expect(lifeOf(s, 'p2')).toBe(expected);
    }
  });
});

// ---- Feral Ghoul ----------------------------------------------------------------------------------------------------------------------------------------------------

const GHOUL = card('Test Ghoul', 'Creature — Zombie Mutant', 'When this creature dies, each opponent gets a number of rad counters equal to its power.', { pt: ['3', '3'] });
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');

describe('CR 122.1, 608.2h, 603.10a: "When this creature dies, each opponent gets a number of rad counters equal to its power."', () => {
  const setup = (): GameState => mpScenario({ players: 4, defs: [GHOUL, SMITE, BEAR('A')], zones: { p1: { hand: ['Test Smite'], battlefield: ['Test Ghoul', 'Test Bear A'] } } });
  it('is automated', () => expect(full(GHOUL)).toBe(true));
  it('every opponent gets rad counters equal to its power as it last existed; you get none', () => {
    const s0 = setup();
    const s = castFree(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Ghoul', 'battlefield', 'p1'))]] });
    expect([radOf(s, 'p1'), radOf(s, 'p2'), radOf(s, 'p3'), radOf(s, 'p4')]).toEqual([0, 3, 3, 3]);
  });
  it('another creature dying gives no counters (the negative case); a +1/+1 counter on the Ghoul raises the number (last known power)', () => {
    const s0 = setup();
    const a = castFree(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Bear A', 'battlefield', 'p1'))]] });
    expect([radOf(a, 'p2'), radOf(a, 'p3'), radOf(a, 'p4')]).toEqual([0, 0, 0]);
    const s1 = mpScenario({ players: 4, defs: [GHOUL, SMITE], zones: { p1: { hand: ['Test Smite'], battlefield: [{ name: 'Test Ghoul', counters: { '+1/+1': 2 } }] } } });
    const b = castFree(s1, 'Test Smite', { targets: [[obj(find(s1, 'Test Ghoul', 'battlefield', 'p1'))]] });
    expect([radOf(b, 'p2'), radOf(b, 'p3'), radOf(b, 'p4')]).toEqual([5, 5, 5]);
  });
});

// ---- Wand of Orcus ------------------------------------------------------------------------------------------------------------------------------------------------

const WANDER = card('Test Wanderer', 'Creature — Zombie', 'Whenever this creature attacks, it and Zombies you control gain deathtouch until end of turn.', { pt: ['2', '2'] });
const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', { pt: ['2', '2'] });

describe('CR 611.2a, 611.2c, 613.1f: "Whenever this creature attacks, it and Zombies you control gain deathtouch until end of turn."', () => {
  const setup = (): GameState => mpScenario({ players: 4, defs: [WANDER, ZOMBIE, BEAR('A')], zones: { p1: { battlefield: ['Test Wanderer', 'Test Zombie', 'Test Bear A'] } } });
  const hasDeathtouch = (s: GameState, name: string): boolean => hasKeyword(getChars(s, find(s, name, 'battlefield', 'p1')), 'deathtouch');
  it('is automated', () => expect(full(WANDER)).toBe(true));
  it('the attacker and every Zombie you control gain deathtouch; a creature that is not a Zombie does not (the negative case)', () => {
    let s = advanceTo(setup(), 1, 'declareAttackers');
    s = drive(s, { attackers: [find(s, 'Test Wanderer', 'battlefield', 'p1')], defender: 'p2' });
    s = settle(s);
    expect([hasDeathtouch(s, 'Test Wanderer'), hasDeathtouch(s, 'Test Zombie'), hasDeathtouch(s, 'Test Bear A')]).toEqual([true, true, false]);
  });
});

// ---- Rose, Cutthroat Raider -------------------------------------------------------------------------------------------------------------------------------------------

const RAIDER = card('Test Raider', 'Creature — Robot', 'At end of combat on your turn, if you attacked this turn, create a Junk token for each opponent you attacked.', { pt: ['2', '2'] });

describe('CR 506.3, 508.1, 603.4: "At end of combat on your turn, if you attacked this turn, create a Junk token for each opponent you attacked."', () => {
  const setup = (): GameState => mpScenario({ players: 4, defs: [RAIDER, BEAR('A'), BEAR('B'), BEAR('C')], zones: { p1: { battlefield: ['Test Raider', 'Test Bear A', 'Test Bear B', 'Test Bear C'] } } });
  const junk = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && /junk/i.test(s.objects[id]!.defId)).length;
  /** Attack with the given creatures, each at its player (or planeswalker-less), then play on to the second main phase. */
  function attack(s0: GameState, attacks: [string, PlayerId][]): GameState {
    let s = advanceTo(s0, 1, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: attacks.map(([n, defender]) => ({ attacker: find(s0, n, 'battlefield', 'p1'), defender })) });
    for (let guard = 0; guard < 200 && s.turn.step !== 'main2'; guard++) {
      s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.pending && s.pending.kind !== 'priority' ? drive(s) : pass(s);
    }
    return s;
  }
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('one Junk token for each different opponent attacked, however many creatures attacked each', () => {
    expect(junk(attack(setup(), [['Test Bear A', 'p2'], ['Test Bear B', 'p3'], ['Test Bear C', 'p3']]))).toBe(2);
    expect(junk(attack(setup(), [['Test Bear A', 'p2'], ['Test Bear B', 'p2'], ['Test Bear C', 'p2']]))).toBe(1);
    expect(junk(attack(setup(), [['Test Bear A', 'p2'], ['Test Bear B', 'p3'], ['Test Raider', 'p4']]))).toBe(3);
  });
  it('no attack, no Junk (the intervening if, the negative case)', () => {
    expect(junk(attack(setup(), []))).toBe(0);
  });
});

// ---- Indulgent Tormentor ----------------------------------------------------------------------------------------------------------------------------------------------

const TORMENT = card('Test Tormentor', 'Creature — Demon', 'At the beginning of your upkeep, draw a card unless target opponent sacrifices a creature of their choice or pays 3 life.', { pt: ['2', '2'] });

describe('CR 118.12, 701.21a, 119.4: "At the beginning of your upkeep, draw a card unless target opponent sacrifices a creature of their choice or pays 3 life."', () => {
  const setup = (): GameState => mpScenario({ players: 4, defs: [TORMENT, BEAR('A'), BEAR('B')], zones: { p1: { battlefield: ['Test Tormentor'] }, p2: { battlefield: ['Test Bear B'] } } });
  const toUpkeep = (s: GameState, script: Script, asked: string[] = []): GameState => {
    let t = advanceTo(s, 5, 'upkeep');
    t = drive(t, script, asked);
    return settle(t, script, asked);
  };
  it('is automated', () => expect(full(TORMENT)).toBe(true));
  it('the opponent may sacrifice a creature: then you do not draw', () => {
    const s0 = setup();
    const before = handOf(s0, 'p1');
    const asked: string[] = [];
    const s = toUpkeep(s0, { targets: [[pl('p2')]], yes: [true], objects: [(o) => o.slice(0, 1)] }, asked);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear B')).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(handOf(s, 'p1') - before).toBe(0); // (the turn's draw step has not come yet) the upkeep draw did not happen
  });
  it('or pay 3 life: then you do not draw, and the creature stays', () => {
    const s0 = setup();
    const before = handOf(s0, 'p1');
    const s = toUpkeep(s0, { targets: [[pl('p2')]], yes: [false, true] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear B')).toBe(true);
    expect(handOf(s, 'p1') - before).toBe(0);
  });
  it('an opponent with 2 life and no creature can do neither, so you draw (CR 119.4: life is paid only if the total is at least the amount)', () => {
    const s0 = mpScenario({ players: 4, defs: [TORMENT], zones: { p1: { battlefield: ['Test Tormentor'] } }, life: 2 });
    const before = handOf(s0, 'p1');
    const s = toUpkeep(s0, { targets: [[pl('p2')]], yes: [true, true] });
    expect(lifeOf(s, 'p2')).toBe(2);
    expect(handOf(s, 'p1') - before).toBe(1);
  });
  it('if they do neither you draw a card (the negative case)', () => {
    const s0 = setup();
    const before = handOf(s0, 'p1');
    const s = toUpkeep(s0, { targets: [[pl('p2')]], yes: [false, false] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(handOf(s, 'p1') - before).toBe(1);
  });
});

// ---- Arbaaz Mir -------------------------------------------------------------------------------------------------------------------------------------------------------

const MIR = card('Test Historian', 'Legendary Creature — Human', 'Whenever ~ or another nontoken historic permanent you control enters, ~ deals 1 damage to each opponent and you gain 1 life.', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');
const LEGEND = card('Test Legend', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });
const MAKER = card('Test Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token. Create a Treasure token.');

describe('CR 700.6, 603.2: "Whenever ~ or another nontoken historic permanent you control enters, ~ deals 1 damage to each opponent and you gain 1 life."', () => {
  const setup = (hand: string[], opp: string[] = []): GameState => mpScenario({ players: 4, defs: [MIR, RELIC, LEGEND, BEAR('A'), MAKER], zones: { p1: { hand, battlefield: ['Test Historian'] }, p2: { hand: opp } } });
  const lifes = (s: GameState): number[] => ['p1', 'p2', 'p3', 'p4'].map((p) => lifeOf(s, p as PlayerId));
  it('is automated', () => expect(full(MIR)).toBe(true));
  it('a nontoken artifact or legendary permanent you control entering deals 1 damage to each opponent and gains you 1 life', () => {
    expect(lifes(castFree(setup(['Test Relic']), 'Test Relic'))).toEqual([21, 19, 19, 19]);
    expect(lifes(castFree(setup(['Test Legend']), 'Test Legend'))).toEqual([21, 19, 19, 19]);
  });
  it('a nonhistoric permanent, a token (Treasure is an artifact token) and an opponent\'s historic permanent do nothing (the negative cases)', () => {
    expect(lifes(castFree(setup(['Test Bear A']), 'Test Bear A'))).toEqual([20, 20, 20, 20]);
    expect(lifes(castFree(setup(['Test Maker']), 'Test Maker'))).toEqual([20, 20, 20, 20]);
    const s0 = advanceTo(setup([], ['Test Relic']), 2, 'main1');
    expect(lifes(castFree(s0, 'Test Relic', {}, 'p2'))).toEqual([20, 20, 20, 20]);
  });
});
