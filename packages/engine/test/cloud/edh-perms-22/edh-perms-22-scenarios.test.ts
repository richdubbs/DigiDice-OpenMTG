/**
 * Commander lane edh-perms, round edh-perms-22: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 702.26b-c, 610.3   "... target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way."
 *   CR 601.2d, 603.3d     "... if you gained life this turn, distribute up to that many +1/+1 counters among any number of other target creatures."
 *   CR 608.2c, 608.2h     "... If you return three or more nontoken permanents you control this way, you may put a permanent card from your hand onto the battlefield."
 *   CR 208.1, 608.2h      "... If that creature has greater power than this creature, put a number of +1/+1 counters on this creature equal to the difference."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, reject, scenario } from '../../m3/scenario';
import { commanderScenario, legend, tweak } from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: string): TargetChoice => ({ kind: 'object', id });
const bad = (s: GameState, a: DecisionAnswer): { message: string; rules: string[] } => reject(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: a });

const HOLD = card('Test Hold', 'Enchantment', 'When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way.');
const LOOSE = card('Test Loose', 'Enchantment', 'When this enchantment enters, target creature phases out until this enchantment leaves the battlefield.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target enchantment.');
const COLLAR = card('Test Collar', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
const BAUBLE = card('Test Bauble', 'Artifact — Equipment', 'Equipped creature gets +1/+0.');
const MENTOR = card('Test Mentor', 'Creature — Cleric', 'Lifelink\nAt the beginning of your end step, if you gained life this turn, distribute up to that many +1/+1 counters among any number of other target creatures.', { pt: ['2', '2'] });
const TONIC = card('Test Tonic', 'Instant', 'You gain 3 life.');
const SCOUT = card('Test Scout', 'Creature — Scout', '', { pt: ['1', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const FLOOD = card('Test Flood', 'Sorcery', "Return all nonland permanents to their owners' hands. If you return three or more nontoken permanents you control this way, you may put a permanent card from your hand onto the battlefield.");
const TOKENMAKER = card('Test Tokenmaker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const SHURIKEN = card('Test Shuriken', 'Legendary Artifact — Equipment', 'Equipped creature has "Whenever this creature attacks, tap target creature defending player controls. If that creature has greater power than this creature, put a number of +1/+1 counters on this creature equal to the difference."\nEquip {2}');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['5', '3'] });
const DEFS = [SHURIKEN, BRUTE, FLOOD, TOKENMAKER, HOLD, LOOSE, BEAR, SMITE, COLLAR, BAUBLE, MENTOR, TONIC, OGRE, SCOUT];

interface Drive { targets?: TargetChoice[] }
/** Answer every decision until the stack is empty and nobody has a decision but priority. */
function settle(s0: GameState, d: Drive = {}): GameState {
  let s = s0;
  for (let g = 0; g < 60; g++) {
    const p = s.pending;
    if (p === undefined || p === null) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: d.targets ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseDivision') s = answer(s, { kind: 'chooseDivision', amounts: p.targets.map(() => 1) });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const castSpell = (s: GameState, name: string, d: Drive = {}): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), d);

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('every card with a rules text is fully automated', () => {
    for (const d of [HOLD, LOOSE, SMITE, COLLAR, MENTOR, TONIC, FLOOD, SHURIKEN]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.26b-c, 610.3: "target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Hold', 'Test Smite'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
  it('the creature phases out as the enchantment enters and stays out through the untap steps', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = castSpell(s0, 'Test Hold', { targets: [obj(bear)] });
    expect(s1.objects[bear]!.phasedOut).toBe(true);
    const s2 = advanceTo(s1, 3, 'upkeep'); // p2's turn: its untap step has passed
    expect(s2.objects[bear]!.phasedOut).toBe(true);
    const s3 = advanceTo(s2, 4, 'upkeep'); // p1's turn
    expect(s3.objects[bear]!.phasedOut).toBe(true);
  });
  it('when the enchantment leaves the battlefield the creature phases in tapped', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = castSpell(s0, 'Test Hold', { targets: [obj(bear)] });
    const hold = find(s1, 'Test Hold', 'battlefield');
    const s2 = castSpell(s1, 'Test Smite', { targets: [obj(hold)] });
    expect(s2.objects[bear]!.phasedOut).toBe(false);
    expect(s2.objects[bear]!.tapped).toBe(true);
    expect(s2.objects[bear]!.zone).toBe('battlefield');
    expect(s2.objects[bear]!.id).toBe(bear); // phasing is not a zone change: the same object (CR 702.26d)
  });
  it('without the second sentence it phases in untapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Loose', 'Test Smite'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = castSpell(s0, 'Test Loose', { targets: [obj(bear)] });
    const s2 = castSpell(s1, 'Test Smite', { targets: [obj(find(s1, 'Test Loose', 'battlefield'))] });
    expect(s2.objects[bear]!.phasedOut).toBe(false);
    expect(s2.objects[bear]!.tapped).toBe(false);
  });
  it('what is attached phases out with it and phases in with it (CR 702.26g)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hold', 'Test Smite'] }, p2: { battlefield: ['Test Bear', 'Test Bauble'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const collar = find(s0, 'Test Bauble', 'battlefield');
    s0.objects[collar]!.attachedTo = bear;
    const s1 = castSpell(s0, 'Test Hold', { targets: [obj(bear)] });
    expect(s1.objects[collar]!.phasedOut).toBe(true);
    const s2 = castSpell(s1, 'Test Smite', { targets: [obj(find(s1, 'Test Hold', 'battlefield'))] });
    expect(s2.objects[collar]!.phasedOut).toBe(false);
    expect(s2.objects[collar]!.attachedTo).toBe(bear);
    expect(s2.objects[collar]!.tapped).toBe(false); // only the creature is tapped
  });
});

describe('CR 601.2d, 603.3d: "if you gained life this turn, distribute up to that many +1/+1 counters among any number of other target creatures."', () => {
  const setup = (gain: boolean): { s: GameState; bear: ObjectId; ogre: ObjectId } => {
    const s0 = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Mentor', 'Test Bear', 'Test Ogre'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    return { s: gain ? settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tonic', 'hand', 'p1') })) : s0, bear, ogre };
  };
  /** Pass priority until the end-step trigger asks for its targets (or the turn moves past the end step). */
  const toTargets = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 80 && s.pending?.kind !== 'chooseTargets'; g++) {
      if (s.turn.number > 1) break;
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    return s;
  };
  const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
  it('gaining 3 life: the controller divides up to 3 counters among the targets, each at least one', () => {
    const { s: s0, bear, ogre } = setup(true);
    const s1 = toTargets(s0);
    expect(s1.pending?.kind).toBe('chooseTargets');
    const s2 = answer(s1, { kind: 'chooseTargets', targets: [obj(bear), obj(ogre)] });
    expect(s2.pending?.kind).toBe('chooseDivision');
    const s3 = answer(s2, { kind: 'chooseDivision', amounts: [1, 2] });
    const s = settle(s3);
    expect(counters(s, bear)).toBe(1);
    expect(counters(s, ogre)).toBe(2);
  });
  it('"up to": fewer counters than the life gained is legal, more is not', () => {
    const { s: s0, bear, ogre } = setup(true);
    const s2 = answer(toTargets(s0), { kind: 'chooseTargets', targets: [obj(bear), obj(ogre)] });
    expect(bad(s2, { kind: 'chooseDivision', amounts: [2, 2] }).message).toMatch(/at most 3/);
    expect(bad(s2, { kind: 'chooseDivision', amounts: [0, 1] }).message).toMatch(/at least 1/);
    const s = settle(answer(s2, { kind: 'chooseDivision', amounts: [1, 1] }));
    expect(counters(s, bear) + counters(s, ogre)).toBe(2);
  });
  it('one target may take any amount from 1 to the life gained', () => {
    const { s: s0, bear } = setup(true);
    const s2 = answer(toTargets(s0), { kind: 'chooseTargets', targets: [obj(bear)] });
    expect(s2.pending?.kind).toBe('chooseDivision');
    expect(counters(settle(answer(s2, { kind: 'chooseDivision', amounts: [3] })), bear)).toBe(3);
  });
  it('no targets at all is legal (any number includes none): no division is asked and no counters are put', () => {
    const { s: s0, bear } = setup(true);
    const s = settle(answer(toTargets(s0), { kind: 'chooseTargets', targets: [] }));
    expect(s.pending?.kind).not.toBe('chooseDivision');
    expect(counters(s, bear)).toBe(0);
  });
  it('no life gained this turn: the ability does not trigger', () => {
    const { s: s0 } = setup(false);
    const s1 = toTargets(s0);
    expect(s1.pending?.kind).not.toBe('chooseTargets');
  });
  it('"other" target creatures: the Mentor itself cannot be chosen', () => {
    const { s: s0, bear } = setup(true);
    const s1 = toTargets(s0);
    const mentor = find(s0, 'Test Mentor', 'battlefield');
    expect(bad(s1, { kind: 'chooseTargets', targets: [obj(mentor), obj(bear)] }).message).toBeTruthy();
  });
});

describe('CR 608.2c, 608.2h, 400.7: "If you return three or more nontoken permanents you control this way, you may put a permanent card from your hand onto the battlefield."', () => {
  const run = (mine: string[], theirs: string[], hand: string[] = []): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Flood', ...hand], battlefield: mine }, p2: { battlefield: theirs }, defs: DEFS });
    return castSpell(s0, 'Test Flood');
  };
  const onField = (s: GameState): string[] => s.zones.battlefield.map((id) => s.defs[s.objects[id]!.defId]!.name);
  it('three nontoken permanents of yours come back to hand: you may put a permanent card from your hand onto the battlefield', () => {
    const s = run(['Test Bear', 'Test Ogre', 'Test Scout'], ['Test Bear'], ['Test Bauble']);
    expect(onField(s)).toEqual(['Test Bauble']);
  });
  it('the count is of YOUR permanents: two of yours and three of theirs is not enough', () => {
    const s = run(['Test Bear', 'Test Ogre'], ['Test Bear', 'Test Ogre', 'Test Scout'], ['Test Bauble']);
    expect(onField(s)).toEqual([]);
  });
  it('a token of yours returned to hand ceases to exist and is not a nontoken permanent', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tokenmaker', 'Test Flood', 'Test Bauble'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    const s = castSpell(castSpell(s0, 'Test Tokenmaker'), 'Test Flood');
    expect(onField(s)).toEqual([]);
  });
});

describe('CR 208.1, 608.2h: "If that creature has greater power than this creature, put a number of +1/+1 counters on this creature equal to the difference."', () => {
  const attackInto = (opp: string): { s: GameState; bear: ObjectId; victim: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Shuriken'] }, p2: { battlefield: [opp] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    s0.objects[find(s0, 'Test Shuriken', 'battlefield')]!.attachedTo = bear;
    let s = s0;
    for (let g = 0; g < 40 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    return { s: settle(s, { targets: [obj(find(s, opp, 'battlefield'))] }), bear, victim: find(s, opp, 'battlefield') };
  };
  it('the target has 5 power against the attacker\'s 2: it is tapped and the attacker gets 3 counters', () => {
    const { s, bear, victim } = attackInto('Test Brute');
    expect(s.objects[victim]!.tapped).toBe(true);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(3);
  });
  it('the target has less power than the attacker (the Equipment adds nothing here): tapped, no counters', () => {
    const { s, bear, victim } = attackInto('Test Scout');
    expect(s.objects[victim]!.tapped).toBe(true);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('Flood of Tears ruling 2019-07-12: a commander that goes to the command zone instead of the hand is still counted (CR 903.9b, 608.2c)', () => {
  const TITANIA = legend('Test Titania', '{G}', ['2', '2'], ['G']);
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const board = (): GameState => {
    const s0 = commanderScenario({
      p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [FLOOD, BEAR, OGRE, BAUBLE],
      p1: { battlefield: ['Test Titania', 'Test Bear', 'Test Ogre'], hand: ['Test Flood', 'Test Bauble'] },
    });
    // the scenario puts the commander onto the battlefield directly: give that card the designation (a scenario object is a new card)
    return tweak(s0, (t) => {
      const id = t.zones.battlefield.find((x) => t.objects[x]!.defId === TITANIA.id)!;
      const rec = t.players[0]!.commanders![0]!;
      t.zones.command = t.zones.command.filter((x) => t.objects[x]!.defId !== TITANIA.id);
      for (const x of Object.keys(t.objects)) if (t.objects[x]!.defId === TITANIA.id && x !== id) delete t.objects[x];
      t.objects[id]!.cardId = rec.card;
    });
  };
  const play = (commandZone: boolean): GameState => {
    let s = act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Flood', 'hand', 'p1') });
    for (let g = 0; g < 40; g++) {
      const p = s.pending;
      if (p === undefined || p === null) break;
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'commanderZone') s = answer(s, { kind: 'commanderZone', command: commandZone });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  const names = (s: GameState): string[] => s.zones.battlefield.map((id) => s.defs[s.objects[id]!.defId]!.name);
  it('the commander put into the command zone instead is one of the three permanents returned: you may put the permanent card', () => {
    const s = play(true);
    expect(Object.values(s.objects).find((o) => o.defId === TITANIA.id)!.zone).toBe('command');
    expect(names(s)).toEqual(['Test Bauble']);
  });
  it('the commander left in hand: still three permanents returned', () => {
    expect(names(play(false))).toEqual(['Test Bauble']);
  });
});
