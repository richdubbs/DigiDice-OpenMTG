/**
 * edh-players-10 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. The rulings of the cards were fetched from Scryfall in
 * the cloud session; the CR cites are from memory (unverified).
 *
 *   CR 115.1, 601.2c, 608.2b     "Choose any number of target opponents. ... the number of creatures those opponents control." (strive, 601.2f)
 *   CR 115.1, 601.2c, 601.2d     "For any number of opponents, destroy target nonland permanent that player controls."
 *   CR 603.12, 608.2c            "When ~ dies, you may exile it. When you do, for each opponent, exile up to one target creature that player controls."
 *   CR 202.3, 601.2h, 106.1      "For each opponent, exile up to one target permanent that player controls with an even mana value. Adamant: ... colorless mana ..."
 *   CR 119.3, 608.2h             "target opponent loses life equal to the amount of life they lost this turn" / "gain life equal to the life you've lost this turn"
 *   CR 608.2c, 603.3a            "At the beginning of your upkeep, target opponent loses life equal to the number of cards in their hand." (their: the target, never you)
 *   CR 121.1, 510.2              "Whenever ~ deals combat damage to a player, you and that player each draw that many cards."
 *   CR 608.2c, 107.3             "Choose an opponent. You and that player each create an X/X ... Choose an opponent. You and that player each create X 1/1 ..."
 *   CR 205.3m, 613.1d            "{T}: Target creature loses all creature types until end of turn."
 *   CR 509.1b, 611.2a            "Whenever you put one or more counters on a creature, until end of turn, that creature can't be blocked by creatures your opponents control."
 *   CR 122.1              "Each opponent loses all counters."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, put } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';

interface Script {
  yes?: boolean[];
  targets?: TargetChoice[][];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  options?: string[][];
  attackers?: { attacker: ObjectId; defender: PlayerId }[];
  blocks?: { blocker: ObjectId; attacker: ObjectId }[];
  numbers?: number[];
}
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attackers ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: script.blocks ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script, asked);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
const names = (s: GameState, p: PlayerId): string[] => namesOn(s, p).sort();
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');
const FIELD = card('Test Field', 'Land', '');

// ---- helpers ----------------------------------------------------------------------------------------------------------------------------------------------------------

const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
/** The `index`-th activated ability `player` can activate on `source`, as the action to apply. */
const activation = (s: GameState, player: PlayerId, source: ObjectId, index = 0) => legal(s, player, 'activate').filter((a) => a.action.type === 'activate' && a.action.source === source)[index]!.action;
/** Pass until the step begins (a trigger of the step may be waiting for a decision then: `settle` answers it). */
const toStep = (s: GameState, step: GameState['turn']['step'], turn = s.turn.number): GameState => passUntil(s, (t) => t.turn.number === turn && t.turn.step === step, `${step} of turn ${turn}`);
const DRAIN = card('Test Drain', 'Instant', 'Target player loses 3 life.');
const HEAL = card('Test Heal', 'Instant', 'Target player gains 5 life.');

// ---- Call the Coppercoats ----------------------------------------------------------------------------------------------------------------------------------------------

const MUSTER = card('Test Muster', 'Instant', "Strive — This spell costs {1}{W} more to cast for each target beyond the first.\nChoose any number of target opponents. Create X 1/1 white Human Soldier creature tokens, where X is the number of creatures those opponents control.", { cost: '{2}{W}' });

describe('CR 115.1, 601.2c, 608.2b: "Choose any number of target opponents. Create X tokens, where X is the number of creatures those opponents control."', () => {
  const setup = (plains = 8): GameState => mpScenario({
    defs: [MUSTER, BEAR],
    zones: {
      p1: { hand: ['Test Muster'], battlefield: [...Array(plains).fill('Plains'), 'Test Bear'] },
      p2: { battlefield: ['Test Bear', 'Test Bear'] }, p3: { battlefield: ['Test Bear'] }, p4: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] },
    },
  });
  const tokens = (s: GameState): number => count(s, 'p1', 'Human Soldier Token');
  it('is automated', () => expect(full(MUSTER)).toBe(true));
  it('makes one token for each creature of the chosen opponents, and only theirs (your own creature and the opponent not chosen are not counted)', () => {
    expect(tokens(cast(setup(), 'Test Muster', { targets: [[pl('p2'), pl('p4')]] }))).toBe(5);
    expect(tokens(cast(setup(), 'Test Muster', { targets: [[pl('p3')]] }))).toBe(1);
    expect(tokens(cast(setup(), 'Test Muster', { targets: [[pl('p2'), pl('p3'), pl('p4')]] }))).toBe(6);
  });
  it('with no targets it still resolves and makes no token (any number includes zero)', () => {
    const s = cast(setup(), 'Test Muster', { targets: [[]] });
    expect(tokens(s)).toBe(0);
    expect(s.zones.stack.length).toBe(0);
  });
  it('you can not choose yourself, nor the same opponent twice (the negative case)', () => {
    const s = setup();
    const c = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Muster', 'hand', 'p1') });
    expect(() => answer(c, { kind: 'chooseTargets', targets: [pl('p1')] })).toThrow();
    expect(() => answer(c, { kind: 'chooseTargets', targets: [pl('p2'), pl('p2')] })).toThrow();
  });
  it('strive: every target beyond the first costs {1}{W} more (CR 601.2f): three Plains pay for one target only', () => {
    expect(tokens(cast(setup(3), 'Test Muster', { targets: [[pl('p2')]] }))).toBe(2);
    expect(() => cast(setup(3), 'Test Muster', { targets: [[pl('p2'), pl('p4')]] })).toThrow();
    expect(tokens(cast(setup(5), 'Test Muster', { targets: [[pl('p2'), pl('p4')]] }))).toBe(5);
  });
  it('ruling 2020-04-17: an opponent who is no longer a legal target as it resolves has no creatures counted', () => {
    let s = drive(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Muster', 'hand', 'p1') }), { targets: [[pl('p2'), pl('p4')]] });
    // p4 gains hexproof in response: only p1's own opponents' hexproof, so give p4 a permanent that says so
    const AEGIS = card('Test Aegis', 'Enchantment', 'You have hexproof.');
    s = { ...s, defs: { ...s.defs, [AEGIS.id]: AEGIS } } as GameState;
    put(s, 'p4', 'battlefield', 'Test Aegis');
    s = settle(s);
    expect(tokens(s)).toBe(2);
  });
});

// ---- Windgrace's Judgment ------------------------------------------------------------------------------------------------------------------------------------------------

const VERDICT = card('Test Verdict', 'Instant', 'For any number of opponents, destroy target nonland permanent that player controls.');

describe('CR 115.1, 601.2c, 601.2d: "For any number of opponents, destroy target nonland permanent that player controls."', () => {
  const setup = (): GameState => mpScenario({
    defs: [VERDICT, BEAR, RELIC, FIELD],
    zones: { p1: { hand: ['Test Verdict'], battlefield: ['Test Bear', 'Test Relic'] }, p2: { battlefield: ['Test Bear', 'Test Field'] }, p3: { battlefield: ['Test Relic', 'Test Bear'] }, p4: { battlefield: ['Test Bear'] } },
  });
  const on = (s: GameState, p: PlayerId, name: string): ObjectId => find(s, name, 'battlefield', p);
  it('is automated', () => expect(full(VERDICT)).toBe(true));
  it('destroys one permanent of each opponent chosen, and nothing of an opponent who was not chosen', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Verdict', { targets: [[obj(on(s0, 'p2', 'Test Bear')), obj(on(s0, 'p3', 'Test Relic'))]] });
    expect(names(s, 'p2')).toEqual(['Test Field']);
    expect(names(s, 'p3')).toEqual(['Test Bear']);
    expect(names(s, 'p4')).toEqual(['Test Bear']);
    expect(names(s, 'p1')).toEqual(['Test Bear', 'Test Relic']);
  });
  it('any number includes none: the spell resolves and destroys nothing', () => {
    const s = cast(setup(), 'Test Verdict', { targets: [[]] });
    expect(namesOn(s).length).toBe(7);
  });
  it('is one target for each opponent: two targets of one opponent, a land, and your own permanent are refused (the negative cases)', () => {
    const s0 = setup();
    const c = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Verdict', 'hand', 'p1') });
    const refused = (...ids: ObjectId[]): boolean => { try { answer(c, { kind: 'chooseTargets', targets: ids.map(obj) }); return false; } catch { return true; } };
    expect(refused(on(s0, 'p3', 'Test Relic'), on(s0, 'p3', 'Test Bear'))).toBe(true);
    expect(refused(on(s0, 'p2', 'Test Field'))).toBe(true);
    expect(refused(on(s0, 'p1', 'Test Bear'))).toBe(true);
    expect(refused(on(s0, 'p2', 'Test Bear'), on(s0, 'p4', 'Test Bear'))).toBe(false);
  });
});

// ---- The Balrog of Moria -------------------------------------------------------------------------------------------------------------------------------------------------

const TITAN = card('Test Titan', 'Creature — Demon', 'When ~ dies, you may exile it. When you do, for each opponent, exile up to one target creature that player controls.', { pt: ['5', '5'] });
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');

describe('CR 603.12, 608.2c, 115.1: "When ~ dies, you may exile it. When you do, for each opponent, exile up to one target creature that player controls."', () => {
  const setup = (): GameState => mpScenario({
    defs: [TITAN, SMITE, BEAR, RELIC],
    zones: { p1: { hand: ['Test Smite'], battlefield: ['Test Titan', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Relic'] }, p3: { battlefield: ['Test Bear'] }, p4: { battlefield: ['Test Relic'] } },
  });
  it('is automated', () => expect(full(TITAN)).toBe(true));
  it('exiling it makes the reflexive trigger: one creature of each opponent that has one is exiled, and the Titan is exiled too', () => {
    const s0 = setup();
    const titan = find(s0, 'Test Titan', 'battlefield', 'p1');
    const t = (p: PlayerId) => obj(find(s0, 'Test Bear', 'battlefield', p));
    const s = cast(s0, 'Test Smite', { targets: [[obj(titan)], [t('p2'), t('p3')]], yes: [true] });
    expect(findAll(s, 'Test Titan', 'exile').length).toBe(1);
    expect(zoneOf(s, titan)).not.toBe('graveyard');
    expect(findAll(s, 'Test Bear', 'exile').length).toBe(2);
    expect(names(s, 'p2')).toEqual(['Test Relic']);
    expect(names(s, 'p3')).toEqual([]);
    expect(names(s, 'p1')).toEqual(['Test Bear']);
  });
  it("declining the exile gives no reflexive trigger: nothing is exiled and no target is asked (the negative case)", () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Titan', 'battlefield', 'p1'))]], yes: [false] }, 'p1', asked);
    expect(zoneOf(s, find(s, 'Test Titan', 'graveyard', 'p1'))).toBe('graveyard');
    expect(findAll(s, 'Test Bear', 'exile').length).toBe(0);
    expect(asked.filter((a) => a.startsWith('chooseTargets'))).toHaveLength(1); // only the Smite's own target
  });
  it('an opponent without a creature is left out, and a creature of one opponent can not be picked for another', () => {
    const s0 = setup();
    const c = cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Titan', 'battlefield', 'p1'))], []], yes: [true] });
    expect(findAll(c, 'Test Bear', 'exile').length).toBe(0);
    expect(zoneOf(c, find(c, 'Test Titan', 'exile'))).toBe('exile');
  });
});

// ---- Desecrate Reality -----------------------------------------------------------------------------------------------------------------------------------------------------

const PURGE = card('Test Purge', 'Instant', "For each opponent, exile up to one target permanent that player controls with an even mana value.\nAdamant — If at least three colorless mana was spent to cast ~, return a permanent card with an odd mana value from your graveyard to the battlefield.", { cost: '{3}' });
const EVEN = card('Test Even', 'Creature — Bear', '', { cost: '{2}', pt: ['2', '2'] });
const ODD = card('Test Odd', 'Creature — Bear', '', { cost: '{3}', pt: ['3', '3'] });
const PRISM = card('Test Prism', 'Artifact', '{T}: Add {C}{C}{C}.');

describe('CR 202.3, 601.2h, 106.1: "For each opponent, exile up to one target permanent that player controls with an even mana value. Adamant: colorless mana"', () => {
  const setup = (rock: 'Plains' | 'Test Prism'): GameState => mpScenario({
    defs: [PURGE, EVEN, ODD, PRISM, BEAR, FIELD],
    zones: {
      p1: { hand: ['Test Purge'], battlefield: rock === 'Plains' ? ['Plains', 'Plains', 'Plains'] : ['Test Prism'], graveyard: ['Test Odd', 'Test Even'] },
      p2: { battlefield: ['Test Even', 'Test Odd', 'Test Field'] }, p3: { battlefield: ['Test Odd'] }, p4: { battlefield: ['Test Bear'] },
    },
  });
  const on = (s: GameState, p: PlayerId, name: string): ObjectId => find(s, name, 'battlefield', p);
  it('is automated', () => expect(full(PURGE)).toBe(true));
  it('an even mana value is a legal target (zero is even), an odd one is not; one target for each opponent', () => {
    const s0 = setup('Plains');
    const c = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Purge', 'hand', 'p1') });
    const refused = (...ids: ObjectId[]): boolean => { try { answer(c, { kind: 'chooseTargets', targets: ids.map(obj) }); return false; } catch { return true; } };
    expect(refused(on(s0, 'p2', 'Test Odd'))).toBe(true);
    expect(refused(on(s0, 'p3', 'Test Odd'))).toBe(true);
    expect(refused(on(s0, 'p2', 'Test Even'), on(s0, 'p2', 'Test Field'))).toBe(true);
    expect(refused(on(s0, 'p2', 'Test Even'), on(s0, 'p4', 'Test Bear'))).toBe(false);
    expect(refused(on(s0, 'p2', 'Test Field'))).toBe(false);
  });
  it('colorless mana spent: the odd card of your graveyard returns (the even one is not offered); white mana spent: it does not', () => {
    const s0 = setup('Test Prism');
    const s = cast(s0, 'Test Purge', { targets: [[obj(on(s0, 'p2', 'Test Even'))]] });
    expect(names(s, 'p1')).toEqual(['Test Odd', 'Test Prism']);
    expect(findAll(s, 'Test Even', 'graveyard', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Even', 'exile').length).toBe(1);
    const w0 = setup('Plains');
    const w = cast(w0, 'Test Purge', { targets: [[obj(on(w0, 'p2', 'Test Even'))]] });
    expect(names(w, 'p1')).toEqual(['Plains', 'Plains', 'Plains']);
    expect(findAll(w, 'Test Odd', 'graveyard', 'p1').length).toBe(1);
    expect(findAll(w, 'Test Even', 'exile').length).toBe(1);
  });
});

// ---- Astarion, the Decadent --------------------------------------------------------------------------------------------------------------------------------------------

const VAMPIRE = card('Test Vampire', 'Creature — Vampire', "At the beginning of your end step, choose one —\n• Feed — Target opponent loses life equal to the amount of life they lost this turn.\n• Friends — You gain life equal to the amount of life you gained this turn.", { pt: ['3', '3'] });

describe('CR 119.3, 608.2h: "target opponent loses life equal to the amount of life they lost this turn" / "you gain life equal to the amount of life you gained this turn"', () => {
  const setup = (): GameState => mpScenario({
    defs: [VAMPIRE, DRAIN, HEAL],
    zones: { p1: { hand: ['Test Drain', 'Test Drain', 'Test Heal'], battlefield: ['Test Vampire'] } },
  });
  const drainP = (s: GameState, p: PlayerId): GameState => cast(s, 'Test Drain', { targets: [[pl(p)]] });
  const healP = (s: GameState, p: PlayerId): GameState => cast(s, 'Test Heal', { targets: [[pl(p)]] });
  it('is automated', () => expect(full(VAMPIRE)).toBe(true));
  it('Feed: the targeted opponent loses as much as THEY lost this turn, damage and loss alike, whatever they gained since (not the net)', () => {
    let s = drainP(setup(), 'p2');
    s = healP(s, 'p2'); // 20 - 3 + 5
    expect(lifeOf(s, 'p2')).toBe(22);
    s = settle(toStep(s, 'end'), { options: [['0']], targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('Feed: an opponent who lost nothing this turn loses nothing, and the other opponents are untouched (the negative case)', () => {
    let s = drainP(setup(), 'p2');
    s = settle(toStep(s, 'end'), { options: [['0']], targets: [[pl('p3')]] });
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p4')).toBe(20);
  });
  it('Friends: you gain as much life as you gained this turn; with none gained, none', () => {
    let s = healP(setup(), 'p1');
    expect(lifeOf(s, 'p1')).toBe(25);
    s = settle(toStep(s, 'end'), { options: [['1']] });
    expect(lifeOf(s, 'p1')).toBe(30);
    const n = settle(toStep(setup(), 'end'), { options: [['1']] });
    expect(lifeOf(n, 'p1')).toBe(20);
  });
});

// ---- Children of Korlis --------------------------------------------------------------------------------------------------------------------------------------------------

const CLERIC = card('Test Cleric', 'Creature — Cleric', "Sacrifice this creature: You gain life equal to the life you've lost this turn.", { pt: ['1', '1'] });

describe('CR 119.3, 608.2h: "You gain life equal to the life you\'ve lost this turn."', () => {
  const setup = (): GameState => mpScenario({ defs: [CLERIC, DRAIN, HEAL], zones: { p1: { hand: ['Test Drain', 'Test Heal'], battlefield: ['Test Cleric'] } } });
  const sacrifice = (s: GameState): GameState => settle(act(s, activation(s, 'p1', find(s, 'Test Cleric', 'battlefield', 'p1'))));
  it('is automated', () => expect(full(CLERIC)).toBe(true));
  it('ruling 2021-03-19: the life gained is the total lost this turn, not the difference from the start of the turn', () => {
    let s = cast(setup(), 'Test Drain', { targets: [[pl('p1')]] });
    s = cast(s, 'Test Heal', { targets: [[pl('p1')]] }); // 20 - 3 + 5 = 22
    s = sacrifice(s);
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(findAll(s, 'Test Cleric', 'graveyard', 'p1').length).toBe(1);
  });
  it('with no life lost this turn it gains nothing, and life lost by another player does not count (the negative case)', () => {
    let s = cast(setup(), 'Test Drain', { targets: [[pl('p2')]] });
    s = sacrifice(s);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- "their" is the target, never you (At the beginning of your end step) ------------------------------------------------------------------------------------------

const WARDEN = card('Test Warden', 'Creature — Bear', 'At the beginning of your end step, target opponent loses life equal to the number of cards in their hand.', { pt: ['1', '1'] });

describe('CR 608.2c, 603.3a: "At the beginning of your end step, target opponent loses life equal to the number of cards in their hand."', () => {
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it("their hand is the target's hand, not yours: p3 holds 4 cards and p1 holds 1, p3 loses 4", () => {
    const s0 = mpScenario({ defs: [WARDEN, BEAR], zones: { p1: { hand: ['Test Bear'], battlefield: ['Test Warden'] }, p2: { hand: ['Test Bear'] }, p3: { hand: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
    const s = settle(toStep(s0, 'end'), { targets: [[pl('p3')]] });
    expect(lifeOf(s, 'p3')).toBe(16);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- Xyris, the Writhing Storm ------------------------------------------------------------------------------------------------------------------------------------------

const HYDRA = card('Test Hydra', 'Creature — Hydra', 'Whenever ~ deals combat damage to a player, you and that player each draw that many cards.', { pt: ['3', '3'] });

describe('CR 121.1, 510.2, 603.2: "Whenever ~ deals combat damage to a player, you and that player each draw that many cards."', () => {
  /** p1 attacks `defender` with the Hydra and nobody blocks; the damage trigger resolves. */
  const attack = (defender: PlayerId): GameState => {
    let s = mpScenario({ defs: [HYDRA], zones: { p1: { battlefield: ['Test Hydra'] } } });
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Hydra', 'battlefield', 'p1'), defender }] });
    for (let guard = 0; guard < 60 && s.turn.step !== 'combatDamage' && s.turn.step !== 'end'; guard++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : act(s, { type: 'pass', player: s.pending!.player });
    return settle(s);
  };
  const base = mpScenario({ defs: [HYDRA], zones: { p1: { battlefield: ['Test Hydra'] } } });
  it('is automated', () => expect(full(HYDRA)).toBe(true));
  it('you and the player dealt the damage each draw as many cards as the damage; the other players draw nothing', () => {
    const s = attack('p3');
    expect(lifeOf(s, 'p3')).toBe(17);
    expect(handSize(s, 'p1')).toBe(handSize(base, 'p1') + 3);
    expect(handSize(s, 'p3')).toBe(handSize(base, 'p3') + 3);
    expect(handSize(s, 'p2')).toBe(handSize(base, 'p2'));
    expect(handSize(s, 'p4')).toBe(handSize(base, 'p4'));
  });
});

// ---- Sylvan Offering -----------------------------------------------------------------------------------------------------------------------------------------------------

const OFFERING = card('Test Offering', 'Sorcery', 'Choose an opponent. You and that player each create an X/X green Treefolk creature token.\nChoose an opponent. You and that player each create X 1/1 green Elf Warrior creature tokens.', { cost: '{X}{G}', colors: ['G'] });

describe('CR 608.2c, 107.3: "Choose an opponent. You and that player each create an X/X ... Choose an opponent. You and that player each create X 1/1 ..."', () => {
  const setup = (): GameState => mpScenario({ defs: [OFFERING], cards: ['Forest'], zones: { p1: { hand: ['Test Offering'], battlefield: ['Forest', 'Forest', 'Forest'] } } });
  it('is automated', () => expect(full(OFFERING)).toBe(true));
  it('each choice names its own opponent (ruling 2014-11-07): p2 gets the Treefolk with you, p3 the Elves; the fourth player gets nothing', () => {
    const s = cast(setup(), 'Test Offering', { numbers: [2], options: [['p2'], ['p3']] });
    expect(names(s, 'p1').filter((n) => n.includes('Token')).sort()).toEqual(['Elf Warrior Token', 'Elf Warrior Token', 'Treefolk Token']);
    expect(names(s, 'p2')).toEqual(['Treefolk Token']);
    expect(names(s, 'p3')).toEqual(['Elf Warrior Token', 'Elf Warrior Token']);
    expect(names(s, 'p4')).toEqual([]);
    const treefolk = find(s, 'Treefolk Token', 'battlefield', 'p2');
    expect([getChars(s, treefolk).power, getChars(s, treefolk).toughness].map(Number)).toEqual([2, 2]);
  });
  it('the same opponent may be chosen twice: they get both', () => {
    const s = cast(setup(), 'Test Offering', { numbers: [1], options: [['p4'], ['p4']] });
    expect(names(s, 'p4')).toEqual(['Elf Warrior Token', 'Treefolk Token']);
    expect(names(s, 'p2')).toEqual([]);
  });
});

// ---- Amoeboid Changeling -------------------------------------------------------------------------------------------------------------------------------------------------

const AMOEBA = card('Test Amoeba', 'Creature — Shapeshifter', 'Changeling\n{T}: Target creature gains all creature types until end of turn.\n{T}: Target creature loses all creature types until end of turn.', { pt: ['1', '1'] });

describe('CR 205.3m, 613.1d: "{T}: Target creature loses all creature types until end of turn."', () => {
  const setup = (): GameState => mpScenario({ defs: [AMOEBA, BEAR], zones: { p1: { battlefield: ['Test Amoeba'] }, p2: { battlefield: ['Test Bear'] } } });
  const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id).subtypes].sort();
  const use = (s: GameState, index: number, target: ObjectId): GameState => {
    const amoeba = find(s, 'Test Amoeba', 'battlefield', 'p1');
    // the Amoeba untaps for each use here: a new turn is not needed to test the layers
    s.objects[amoeba]!.tapped = false;
    return settle(drive(act(s, activation(s, 'p1', amoeba, index)), { targets: [[obj(target)]] }));
  };
  it('is automated', () => expect(full(AMOEBA)).toBe(true));
  it('the creature loses its creature types (a Bear is no longer a Bear) and is still a creature; at end of turn it has them again', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = use(s0, 1, bear);
    expect(types(s, bear)).toEqual([]);
    expect(getChars(s, bear).types).toContain('Creature');
    const e = settle(toStep(s, 'end'));
    const next = passUntil(e, (t) => t.turn.number === 2, 'the next turn');
    expect(types(next, bear)).toEqual(['Bear']);
  });
  it('ruling 2007-10-01: types gained after losing them all are kept; types gained before are lost (timestamp order)', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const loseThenGain = use(use(s0, 1, bear), 0, bear);
    expect(types(loseThenGain, bear).length).toBeGreaterThan(50);
    const gainThenLose = use(use(s0, 0, bear), 1, bear);
    expect(types(gainThenLose, bear)).toEqual([]);
  });
  it('a creature with changeling that loses all creature types has none either (Maskwood Nexus ruling 2021-02-05)', () => {
    const s0 = setup();
    const amoeba = find(s0, 'Test Amoeba', 'battlefield', 'p1');
    expect(getChars(s0, amoeba).subtypes.length).toBeGreaterThan(50);
    const s = use(s0, 1, amoeba);
    expect(types(s, amoeba)).toEqual([]);
  });
});

// ---- Rikku, Resourceful Guardian -----------------------------------------------------------------------------------------------------------------------------------------

const GUARD = card('Test Guard', 'Creature — Human', "Whenever you put one or more counters on a creature, until end of turn, that creature can't be blocked by creatures your opponents control.", { pt: ['1', '1'] });
const BOOST = card('Test Boost', 'Instant', 'Put a +1/+1 counter on target creature.');

describe('CR 509.1b, 611.2a: "Whenever you put one or more counters on a creature, until end of turn, that creature can\'t be blocked by creatures your opponents control."', () => {
  const setup = (): GameState => mpScenario({ defs: [GUARD, BOOST, BEAR, DRAIN], zones: { p1: { hand: ['Test Boost', 'Test Drain'], battlefield: ['Test Guard', 'Test Bear'] }, p2: { hand: ['Test Boost'], battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  /** Does p2 get to block p1's `attacker` with its bear? */
  const canBlock = (s0: GameState, attacker: ObjectId): boolean => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' as PlayerId }] });
    for (let guard = 0; guard < 40 && s.pending?.kind === 'priority' && s.turn.step !== 'end'; guard++) s = act(s, { type: 'pass', player: s.pending.player });
    const d = s.pending;
    if (!d || d.kind !== 'declareBlockers') return false;
    return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Bear', 'battlefield', d.player), attacker }] } }).error === undefined;
  };
  it('is automated', () => expect(full(GUARD)).toBe(true));
  it('the creature you put counters on can not be blocked by your opponents\' creatures this turn; a creature that got none can be', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Boost', { targets: [[obj(bear)]] });
    expect(canBlock(s, bear)).toBe(false);
    expect(canBlock(s0, bear)).toBe(true);
  });
  it('counters an opponent puts on your creature do not trigger it (the negative case: "you put")', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    // p1 casts a spell of its own and passes; p2 responds, putting a counter on p1's bear
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Drain', 'hand', 'p1') }), { targets: [[pl('p4')]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Boost', 'hand', 'p2') }), { targets: [[obj(bear)]] });
    s = settle(s);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(canBlock(s, bear)).toBe(true);
  });
});

// ---- Final Act -----------------------------------------------------------------------------------------------------------------------------------------------------------

const ACT = card('Test Finale', 'Sorcery', 'Choose one or more —\n• Destroy all creatures.\n• Exile all graveyards.\n• Each opponent loses all counters.');

describe('CR 122.1, 700.2d: "Each opponent loses all counters."', () => {
  const setup = (): GameState => {
    const s = mpScenario({ defs: [ACT, BEAR], zones: { p1: { hand: ['Test Finale'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2 } }] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } } });
    const set = (p: PlayerId, c: Record<string, number>, poison = 0): void => { const pp = s.players.find((x) => x.id === p)!; pp.counters = c as never; pp.poison = poison; };
    set('p1', { energy: 3 }, 2);
    set('p2', { energy: 4, rad: 2 }, 5);
    set('p3', { experience: 1 });
    return s;
  };
  const counters = (s: GameState, p: PlayerId): string => { const pp = s.players.find((x) => x.id === p)!; return JSON.stringify([pp.counters, pp.poison]); };
  it('is automated', () => expect(full(ACT)).toBe(true));
  it('every kind of counter, poison included, goes from each opponent; your own counters and the counters on permanents stay', () => {
    const s = cast(setup(), 'Test Finale', { options: [['2']] });
    expect(counters(s, 'p2')).toBe(JSON.stringify([{}, 0]));
    expect(counters(s, 'p3')).toBe(JSON.stringify([{}, 0]));
    expect(counters(s, 'p1')).toBe(JSON.stringify([{ energy: 3 }, 2]));
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.counters['+1/+1']).toBe(1);
  });
  it('an unchosen mode does nothing: with only "destroy all creatures" the counters stay (the negative case)', () => {
    const s = cast(setup(), 'Test Finale', { options: [['0']] });
    expect(counters(s, 'p2')).toBe(JSON.stringify([{ energy: 4, rad: 2 }, 5]));
    expect(namesOn(s).filter((n) => n === 'Test Bear').length).toBe(0);
  });
});
