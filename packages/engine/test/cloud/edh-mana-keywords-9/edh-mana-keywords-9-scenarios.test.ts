/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-9: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 607.2a, 605.1b, 106.12, 201.2   "Whenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana of any type that land produced." (Extraplanar Lens)
 *   CR 603.2h, 603.4, 106.4            "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number
 *                                      of Islands target opponent controls." (Carpet of Flowers): once through the ability each turn, counted when mana is added
 *   CR 605.1a, 605.3b, 706.2, 603.2c   "{T}: Add one mana of any color. Roll a d20." and "Whenever you roll one or more dice, put a number of charge counters on ~ equal to the result."
 *                                      (Vexing Puzzlebox): a mana ability that also rolls a die; the result is the total of the dice of the roll
 *   CR 115.1, 115.3, 601.2c, 702.33c   "Choose any target, then choose another target for each time ~ was kicked. ~ deals X damage to each of them." (Comet Storm)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, findAll, life, pass, pool, put, scenario } from '../../m3/scenario';
import { card, counters, full, settle, type Picks } from '../cmd3/helpers';

const tap = (s: GameState, name: string, player = 'p1', which = 0): GameState => {
  const ids = findAll(s, name, 'battlefield', player);
  const a = legalActions(s, player).find((l) => l.kind === 'activate' && l.isMana === true && l.object === ids[which]);
  if (!a) throw new Error(`no mana ability of ${name}`);
  return act(s, a.action);
};
/** Pass priority until the stack is empty, answering decisions with `picks`. */
const drain = (s0: GameState, picks: Picks = {}): GameState => {
  let s = settle(s0, picks);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = settle(pass(s), picks);
  return s;
};

// ---- Extraplanar Lens ----------------------------------------------------------------------------------------------------------------------------------------
const LENS = card('Test Lens', 'Artifact', 'Imprint -- When this artifact enters, you may exile target land you control.\nWhenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana of any type that land produced.');

describe('CR 607.2a, 605.1b, 201.2: "Whenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana of any type that land produced."', () => {
  const board = (p2: string[] = []): GameState => scenario(['Forest', 'Island'], { defs: [LENS], p1: { hand: ['Test Lens'], battlefield: ['Forest', 'Forest', 'Island'] }, p2: { battlefield: p2 } });
  const imprint = (s0: GameState, land: ObjectId, yes = true): GameState => {
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Lens', 'hand', 'p1') });
    return drain(s, { yes, targets: [{ kind: 'object' as const, id: land }] });
  };
  const exiledNames = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
  it('the card is fully automated', () => {
    expect(full(LENS), JSON.stringify(LENS.automation)).toBe(true);
  });
  it('another land of the exiled land\'s name adds one more mana of the type it produced', () => {
    const s0 = board();
    const exiledForest = findAll(s0, 'Forest', 'battlefield', 'p1')[0]!;
    const s1 = imprint(s0, exiledForest);
    expect(exiledNames(s1)).toEqual(['Forest']);
    const s2 = drain(tap(s1, 'Forest'));
    expect(pool(s2, 'p1')).toBe('GG');
  });
  it('negative: a land of another name adds nothing extra', () => {
    const s0 = board();
    const s1 = imprint(s0, findAll(s0, 'Forest', 'battlefield', 'p1')[0]!);
    const s2 = drain(tap(s1, 'Island'));
    expect(pool(s2, 'p1')).toBe('U');
  });
  it('negative: a mana ability without {T} is not "tapped for mana" (CR 106.12): no extra mana', () => {
    const VAULT = card('Test Vault', 'Land', 'Remove a storage counter from this land: Add {C}.');
    const s0 = scenario(['Forest'], { defs: [LENS, VAULT], p1: { hand: ['Test Lens'], battlefield: [{ name: 'Test Vault', counters: { storage: 2 } }, { name: 'Test Vault', counters: { storage: 2 } }] } });
    const [v1, v2] = findAll(s0, 'Test Vault', 'battlefield', 'p1');
    const s1 = imprint(s0, v1!);
    expect(exiledNames(s1)).toEqual(['Test Vault']);
    const a = legalActions(s1, 'p1').find((l) => l.kind === 'activate' && l.object === v2);
    expect(a, 'the second Vault has a mana ability').toBeDefined();
    const s2 = drain(act(s1, a!.action));
    expect(pool(s2, 'p1')).toBe('C');
  });
  it('negative: with no card exiled (the option declined) no land matches', () => {
    const s0 = board();
    const s1 = imprint(s0, findAll(s0, 'Forest', 'battlefield', 'p1')[0]!, false);
    expect(exiledNames(s1)).toEqual([]);
    const s2 = drain(tap(s1, 'Forest'));
    expect(pool(s2, 'p1')).toBe('G');
  });
  it('another player\'s land with that name adds its controller one more mana (its controller, not the Lens\'s)', () => {
    const s0 = board(['Forest']);
    const s1 = imprint(s0, findAll(s0, 'Forest', 'battlefield', 'p1')[0]!);
    // p2's Forest is tapped for mana by p2: p2 gets the extra mana (checked on the trigger's event in the log of the resolved trigger)
    const p2land = find(s1, 'Forest', 'battlefield', 'p2');
    const s2 = act(s1, { type: 'pass', player: 'p1' });
    const a = legalActions(s2, 'p2').find((l) => l.kind === 'activate' && l.isMana === true && l.object === p2land);
    expect(a, 'the opponent has priority and may tap their land').toBeDefined();
    const s3 = drain(act(s2, a!.action));
    expect(pool(s3, 'p2')).toBe('GG');
    expect(pool(s3, 'p1')).toBe('');
  });
});

// ---- Carpet of Flowers ---------------------------------------------------------------------------------------------------------------------------------------
const CARPET = card('Test Carpet', 'Enchantment', "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.");
const OPP = { kind: 'player' as const, id: 'p2' };

/** Pass priority (answering the decisions on the way: the opponent as the target, `yes` for the option) until `turn`'s `step` has priority; the trigger of the step is then on the stack. */
function walk(s0: GameState, turn: number, step: GameState['turn']['step'], yes = true): GameState {
  let s = s0;
  for (let guard = 0; guard < 400; guard++) {
    if (s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority') return s;
    const d = s.pending;
    if (!d) throw new Error('no decision');
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [OPP] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d as { options: { id: string }[] }).options[0]!.id] });
    else if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'U' });
    else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else s = pass(s);
  }
  throw new Error(`never reached turn ${turn} ${step}`);
}
/** The trigger of the step is on the stack: resolve it (the option is taken when `yes`). */
const resolveTop = (s: GameState, yes: boolean): GameState => walkResolve(s, yes);
function walkResolve(s0: GameState, yes: boolean): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.zones.stack.length > 0; guard++) {
    const d = s.pending;
    if (!d) throw new Error('no decision');
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d as { options: { id: string }[] }).options[0]!.id] });
    else if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'U' });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [OPP] });
    else s = pass(s);
  }
  return s;
}

describe('CR 603.2h, 603.4: "At the beginning of each of your main phases, if you haven\'t added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls."', () => {
  /** Turn 3 (p1's second turn), first main phase: the Carpet's trigger is on the stack, the opponent chosen as its target. */
  const atMain1 = (oppLands: string[] = ['Island', 'Island', 'Island', 'Forest']): GameState => {
    const s0 = scenario(['Forest', 'Island'], { defs: [CARPET], p2: { battlefield: oppLands } });
    put(s0, 'p1', 'battlefield', 'Test Carpet');
    return walk(s0, 3, 'main1');
  };
  it('the card is fully automated', () => {
    expect(full(CARPET), JSON.stringify(CARPET.automation)).toBe(true);
  });
  it('taking the option in the first main phase adds one mana for each Island the opponent controls (three, of one color)', () => {
    const s = resolveTop(atMain1(), true);
    expect(pool(s, 'p1').length).toBe(3);
    expect(pool(s, 'p1')).toBe('UUU');
  });
  it('once mana was added through the ability this turn, the second main phase does not trigger it again', () => {
    let s = resolveTop(atMain1(), true);
    expect(pool(s, 'p1').length).toBe(3);
    s = walk(s, 3, 'main2');
    expect(s.zones.stack.length).toBe(0);
    expect(pool(s, 'p1')).toBe('');
  });
  it('negative: declining in the first main phase does not use it up: the second main phase triggers it and adds the mana', () => {
    let s = resolveTop(atMain1(), false);
    expect(pool(s, 'p1')).toBe('');
    s = walk(s, 3, 'main2', false);
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s, true);
    expect(pool(s, 'p1').length).toBe(3);
  });
  it('negative: only Islands count (none: no mana is added)', () => {
    const s = resolveTop(atMain1(['Forest']), true);
    expect(pool(s, 'p1')).toBe('');
  });
  it('adding no mana (no Islands) does not use it up: the second main phase triggers it again (CR 106.4, 603.4: no mana was added through the ability)', () => {
    let s = resolveTop(atMain1(['Forest']), true);
    expect(pool(s, 'p1')).toBe('');
    s = walk(s, 3, 'main2', true);
    expect(s.zones.stack.length).toBe(1);
  });
  it('the count is of the targeted opponent\'s Islands as the ability resolves (two Islands: two mana)', () => {
    const s = resolveTop(atMain1(['Island', 'Island']), true);
    expect(pool(s, 'p1').length).toBe(2);
  });
});

// ---- Vexing Puzzlebox -----------------------------------------------------------------------------------------------------------------------------------------
const BOX = card('Test Puzzlebox', 'Artifact', 'Whenever you roll one or more dice, put a number of charge counters on this artifact equal to the result.\n{T}: Add one mana of any color. Roll a d20.\n{T}, Remove 100 charge counters from this artifact: Search your library for an artifact card, put that card onto the battlefield, then shuffle.');
const DIE_ROLLER = card('Test Roller', 'Artifact', '{T}: Roll a d6.');
/** The results of the dice rolled so far, from the game log ("Alice rolls a d20: 13."). */
const rolls = (s: GameState): number[] => s.log.map((l) => /rolls a d\d+: (\d+)\./.exec(l.text)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));

describe('CR 605.1a, 605.3b, 706.2, 603.2c: "{T}: Add one mana of any color. Roll a d20." and "Whenever you roll one or more dice, put a number of charge counters on ~ equal to the result."', () => {
  const board = (): GameState => scenario([], { defs: [BOX, DIE_ROLLER], p1: { battlefield: ['Test Puzzlebox', 'Test Roller'] } });
  const chooseU = (s: GameState): GameState => (s.pending?.kind === 'chooseColor' ? answer(s, { kind: 'chooseColor', color: 'U' }) : s);
  it('the card is fully automated (and its tap ability is a mana ability)', () => {
    expect(full(BOX), JSON.stringify(BOX.automation)).toBe(true);
    const mana = BOX.automation.level === 'full' ? JSON.stringify(BOX) : '';
    expect(mana).toContain('"isMana":true');
  });
  it('tapping it adds the mana at once (no stack), rolls the die, and the trigger puts that many charge counters on it', () => {
    const s0 = board();
    const box = find(s0, 'Test Puzzlebox', 'battlefield', 'p1');
    const s1 = chooseU(tap(s0, 'Test Puzzlebox'));
    expect(pool(s1, 'p1')).toBe('U'); // the mana ability used no stack: the mana is there before anything resolves
    const s2 = drain(s1);
    const result = rolls(s2).filter((r) => r >= 1 && r <= 20);
    expect(result.length).toBe(1);
    expect(counters(s2, box, 'charge')).toBe(result[0]);
  });
  it('a die rolled by another effect also counts (the trigger is on any roll of its controller), with the result of that die', () => {
    const s0 = board();
    const box = find(s0, 'Test Puzzlebox', 'battlefield', 'p1');
    const roller = findAll(s0, 'Test Roller', 'battlefield', 'p1')[0]!;
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === roller);
    const s1 = drain(act(s0, a!.action));
    const result = rolls(s1);
    expect(result.length).toBe(1);
    expect(result[0]).toBeGreaterThanOrEqual(1);
    expect(result[0]).toBeLessThanOrEqual(6);
    expect(counters(s1, box, 'charge')).toBe(result[0]);
  });
  it('negative: an opponent\'s roll puts no counters on it', () => {
    const ROLLER2 = card('Test Roller', 'Artifact', '{T}: Roll a d6.');
    const s0 = scenario([], { defs: [BOX, ROLLER2], p1: { battlefield: ['Test Puzzlebox'] }, p2: { battlefield: ['Test Roller'] } });
    const box = find(s0, 'Test Puzzlebox', 'battlefield', 'p1');
    const s1 = act(s0, { type: 'pass', player: 'p1' });
    const roller = find(s1, 'Test Roller', 'battlefield', 'p2');
    const a = legalActions(s1, 'p2').find((l) => l.kind === 'activate' && l.object === roller);
    expect(a, 'the opponent has priority and may roll').toBeDefined();
    const s2 = drain(act(s1, a!.action));
    expect(rolls(s2).length).toBe(1);
    expect(counters(s2, box, 'charge')).toBe(0);
  });
});

// ---- Comet Storm ---------------------------------------------------------------------------------------------------------------------------------------------
const STORM = card('Test Storm', 'Instant', 'Multikicker {1}\nChoose any target, then choose another target for each time this spell was kicked. Test Storm deals X damage to each of them.', undefined, '{X}');
const TOUGH = card('Test Rock', 'Creature — Golem', '', ['0', '9']);
type Pick = { kind: 'object'; id: ObjectId } | { kind: 'player'; id: string };

describe('CR 115.1, 115.3, 601.2c, 702.33c: "Choose any target, then choose another target for each time ~ was kicked. ~ deals X damage to each of them."', () => {
  const board = (): GameState => scenario([], { defs: [STORM, TOUGH], p1: { hand: ['Test Storm'], battlefield: Array(6).fill('Plains') as string[] }, p2: { battlefield: ['Test Rock', 'Test Rock'] } });
  /** Cast and answer the announcement: the kicks, then X, then the targets of each spec in turn (the first: any target; the second: one more for each kick). */
  function announce(s0: GameState, kicks: number, x: number): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Storm', 'hand', 'p1') });
    const numbers = [kicks, x];
    for (let g = 0; g < 5 && s.pending?.kind === 'chooseNumber'; g++) s = answer(s, { kind: 'chooseNumber', n: numbers.shift()! });
    return s;
  }
  function castStorm(s0: GameState, kicks: number, x: number, picks: Pick[][]): GameState {
    let s = announce(s0, kicks, x);
    const queue = [...picks];
    for (let g = 0; g < 30 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
    }
    return drain(s);
  }
  const rocks = (s: GameState): ObjectId[] => findAll(s, 'Test Rock', 'battlefield', 'p2');
  it('the card is fully automated', () => {
    expect(full(STORM), JSON.stringify(STORM.automation)).toBe(true);
  });
  it('kicked twice: three different targets (a creature, another creature and the opponent) each take X damage', () => {
    const s0 = board();
    const [r1, r2] = rocks(s0);
    const s = castStorm(s0, 2, 2, [[{ kind: 'object', id: r1! }], [{ kind: 'object', id: r2! }, { kind: 'player', id: 'p2' }]]);
    expect(s.objects[r1!]!.damage).toBe(2);
    expect(s.objects[r2!]!.damage).toBe(2);
    expect(life(s, 'p2')).toBe(18);
  });
  it('not kicked: exactly one target takes the damage', () => {
    const s0 = board();
    const [r1, r2] = rocks(s0);
    const s = castStorm(s0, 0, 3, [[{ kind: 'object', id: r1! }]]);
    expect(s.objects[r1!]!.damage).toBe(3);
    expect(s.objects[r2!]!.damage).toBe(0);
    expect(life(s, 'p2')).toBe(20);
  });
  it('negative: the second set of targets has as many targets as the spell was kicked (kicked once: one more target, not two)', () => {
    const s0 = board();
    const [r1, r2] = rocks(s0);
    let s = announce(s0, 1, 1);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: r1! }] });
    expect((s.pending as unknown as { min: number; max: number }).min).toBe(1);
    expect((s.pending as unknown as { min: number; max: number }).max).toBe(1);
    expect(() => answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: r2! }, { kind: 'player', id: 'p2' }] })).toThrow();
  });
  it('negative: every target must be different (CR 115.3): the first target cannot be chosen again for the others', () => {
    const s0 = board();
    const [r1] = rocks(s0);
    let s = announce(s0, 1, 1);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: r1! }] });
    expect(() => answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: r1! }] })).toThrow();
  });
});
