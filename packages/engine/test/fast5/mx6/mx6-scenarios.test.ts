/**
 * FAST5 MX6: the keyword actions endure (CR 701.63), earthbend (CR 701.66), "empower Jace N" and the keyword firebending (CR 702.189), played through
 * applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, passBoth, scenario } from '../../m3/scenario';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions of casting or of putting a trigger on the stack: targets, then automatic payment. */
function settle(s0: GameState, targets: TargetChoice[]): GameState {
  let s = s0;
  const queue = [...targets];
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.splice(0, typeof d.max === 'number' ? d.max : queue.length) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = []): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets);
const pt = (s: GameState, id: ObjectId): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, id));
  return [n.power, n.toughness];
};
const tokensNamed = (s: GameState, name: string): ObjectId[] => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]?.name === name).map((o) => o.id);

describe('the capabilities: endure, earthbend and empower are advertised, and so is firebending\'s mana that lasts until end of combat', () => {
  it('action:endure, action:earthbend, action:empower, op:addMana.keepEndOfCombat, keyword:firebending', () => {
    for (const c of ['action:endure', 'action:earthbend', 'action:empower', 'op:addMana.keepEndOfCombat', 'keyword:firebending']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});

describe('CR 701.63a: "When this creature enters, it endures 2."', () => {
  const PUP = card('Test Enduring Pup', 'Creature — Dog Soldier', 'When this creature enters, it endures 2.', '{0}', ['1', '1']);
  const start = (): { s: GameState; pup: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test Enduring Pup'] }, defs: [PUP] });
    s = passBoth(cast(s, 'Test Enduring Pup')); // the creature resolves, its trigger goes on the stack
    const pup = find(s, 'Test Enduring Pup', 'battlefield', 'p1');
    s = passBoth(s); // the trigger resolves: the controller chooses
    return { s, pup };
  };
  it('is fully automated', () => {
    expect(manualParts(PUP)).toEqual([]);
    expect(PUP.automation.level).toBe('full');
  });
  it('its controller may put two +1/+1 counters on it', () => {
    let { s, pup } = start();
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((s.pending as { prompt: string }).prompt).toBe('Test Enduring Pup: put 2 +1/+1 counters on it rather than create a 2/2 white Spirit creature token (endure 2, CR 701.63a). Do you?');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.objects[pup]!.counters['+1/+1']).toBe(2);
    expect(tokensNamed(s, 'Spirit Token')).toEqual([]);
  });
  it('unless they do, they create a 2/2 white Spirit creature token', () => {
    let { s, pup } = start();
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.objects[pup]!.counters['+1/+1'] ?? 0).toBe(0);
    const [spirit] = tokensNamed(s, 'Spirit Token');
    expect(spirit).toBeDefined();
    const c = getChars(s, spirit!);
    expect([c.colors, c.types, c.subtypes, pt(s, spirit!)]).toEqual([['W'], ['Creature'], ['Spirit'], [2, 2]]);
    expect(s.objects[spirit!]!.controller).toBe('p1');
  });
});

describe('CR 701.63a: a permanent that left the battlefield can\'t get the counters: its controller creates the token', () => {
  const PUP = card('Test Enduring Pup', 'Creature — Dog Soldier', 'When this creature enters, it endures 3.', '{0}', ['1', '1']);
  const KILL = card('Test Quick End', 'Instant', 'Destroy target creature.');
  it('the creature is destroyed with the trigger on the stack: a 3/3 Spirit, no question', () => {
    let s = scenario([], { p1: { hand: ['Test Enduring Pup', 'Test Quick End'] }, defs: [PUP, KILL] });
    s = passBoth(cast(s, 'Test Enduring Pup'));
    const pup = find(s, 'Test Enduring Pup', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Quick End', [obj(pup)])); // the creature dies, the trigger is still on the stack
    expect(s.objects[pup]?.zone ?? 'gone').not.toBe('battlefield');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    const [spirit] = tokensNamed(s, 'Spirit Token');
    expect(spirit && pt(s, spirit)).toEqual([3, 3]);
  });
});

describe('CR 701.63b: endure 0 does nothing; "it endures X, where X is ..." checks X as it resolves', () => {
  const ACTION = card('Test Rally Banner', 'Artifact Creature — Golem', '{T}: This creature endures X, where X is the number of artifacts you control.', '{0}', ['1', '1']);
  it('X = 1 with one artifact: the choice is offered', () => {
    expect(manualParts(ACTION)).toEqual([]);
    let s = scenario([], { p1: { battlefield: ['Test Rally Banner'] }, defs: [ACTION] });
    const golem = find(s, 'Test Rally Banner', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((y) => y.object === golem && !y.isMana)!;
    s = passBoth(settle(act(s, a.action), []));
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.objects[golem]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 701.66a: "When this creature enters, earthbend 2."', () => {
  const MOLE = card('Test Burrow Mole', 'Creature — Mole', 'When this creature enters, earthbend 2.', '{0}', ['2', '2']);
  const KILL = card('Test Quick End', 'Instant', 'Destroy target creature.');
  const BANISH = card('Test Quick Banish', 'Instant', 'Exile target creature.');
  const start = (extra: string[] = []): { s: GameState; land: ObjectId } => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Burrow Mole', ...extra], battlefield: ['Forest'] }, defs: [MOLE, KILL, BANISH] });
    const land = find(s, 'Forest', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Burrow Mole'));
    s = settle(s, [obj(land)]); // the trigger targets "target land you control"
    s = passBoth(s);
    return { s, land };
  };
  it('announces one target, a land you control, and is fully automated', () => {
    expect(manualParts(MOLE)).toEqual([]);
    const a = MOLE.faces[0]!.abilities[0] as { effect: { targets: unknown[] } };
    expect(a.effect.targets).toEqual([{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target land you control', filter: { types: ['Land'], controller: 'you' } }]);
  });
  it('the land becomes a 0/0 land creature with haste with two +1/+1 counters (a 2/2)', () => {
    const { s, land } = start();
    const c = getChars(s, land);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toContain('Forest');
    expect(JSON.stringify(c.keywords).toLowerCase()).toContain('haste');
    expect(s.objects[land]!.counters['+1/+1']).toBe(2);
    expect(pt(s, land)).toEqual([2, 2]);
  });
  it('when that land dies, it returns to the battlefield tapped under its controller\'s control, as a new object that is only a land', () => {
    let { s, land } = start(['Test Quick End']);
    s = passBoth(cast(s, 'Test Quick End', [obj(land)])); // the land creature dies; the delayed trigger goes on the stack
    s = passBoth(s); // it resolves
    const back = find(s, 'Forest', 'battlefield', 'p1');
    expect(back).not.toBe(land);
    expect(s.objects[back]!.tapped).toBe(true);
    expect(s.objects[back]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(getChars(s, back).types).toEqual(['Land']);
    expect(s.zones.graveyard.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name)).not.toContain('Forest');
  });
  it('when that land is put into exile, it returns too; the delayed ability triggers only once (CR 603.7c)', () => {
    let { s, land } = start(['Test Quick Banish', 'Test Quick End']);
    s = passBoth(cast(s, 'Test Quick Banish', [obj(land)]));
    s = passBoth(s);
    const back = find(s, 'Forest', 'battlefield', 'p1');
    expect(s.objects[back]!.tapped).toBe(true);
    expect(s.delayedTriggers.filter((d) => (d.firedCount ?? 0) === 0 && d.when.at === 'event')).toHaveLength(1); // the other record waits for an object that no longer exists
    expect(getChars(s, back).types).toEqual(['Land']); // a new object: neither a creature nor targetable by the old delayed ability (CR 400.7)
  });
});

describe('CR 701.66a, 115.3: "earthbend 1, then earthbend 1" has two targets, and the same land may be both', () => {
  const AGENTS = card('Test Stone Agents', 'Creature — Human Soldier', 'When this creature enters, earthbend 1, then earthbend 1.', '{0}', ['1', '1']);
  it('both targets are the one land: it gets two counters', () => {
    expect(manualParts(AGENTS)).toEqual([]);
    const targets = (AGENTS.faces[0]!.abilities[0] as { effect: { targets: { id: string }[] } }).effect.targets.map((t) => t.id);
    expect(targets).toEqual(['t0', 't1']);
    let s = scenario(['Forest'], { p1: { hand: ['Test Stone Agents'], battlefield: ['Forest'] }, defs: [AGENTS] });
    const land = find(s, 'Forest', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Stone Agents'));
    s = settle(s, [obj(land), obj(land)]);
    s = passBoth(s);
    expect(pt(s, land)).toEqual([2, 2]);
  });
});

describe('empower Jace N (reminder text): put N loyalty counters on a Jace token you control, first creating one if you control none', () => {
  const PROXY = card('Test Study Proxy', 'Creature — Illusion', 'When this creature enters, empower Jace 3.', '{0}', ['1', '1']);
  const LESSON = card('Test Late Lesson', 'Sorcery', 'Empower Jace 2.');
  it('is fully automated', () => {
    expect(manualParts(PROXY)).toEqual([]);
    expect(manualParts(LESSON)).toEqual([]);
  });
  it('with no Jace token: a blue Jace planeswalker token with 3 loyalty; then a second empower adds to it instead of creating another', () => {
    let s = scenario([], { p1: { hand: ['Test Study Proxy', 'Test Late Lesson'] }, defs: [PROXY, LESSON] });
    s = passBoth(cast(s, 'Test Study Proxy'));
    s = passBoth(s);
    const [jace] = tokensNamed(s, 'Jace Token');
    expect(jace).toBeDefined();
    const c = getChars(s, jace!);
    expect([c.colors, c.types, c.subtypes, c.supertypes]).toEqual([['U'], ['Planeswalker'], ['Jace'], []]);
    expect(s.objects[jace!]!.counters['loyalty']).toBe(3);
    s = passBoth(cast(s, 'Test Late Lesson'));
    expect(tokensNamed(s, 'Jace Token')).toEqual([jace]);
    expect(s.objects[jace!]!.counters['loyalty']).toBe(5);
  });
  it('the token\'s loyalty abilities work: [-3]: Draw a card', () => {
    let s = scenario([], { p1: { hand: ['Test Study Proxy'] }, defs: [PROXY] });
    s = passBoth(passBoth(cast(s, 'Test Study Proxy')));
    const [jace] = tokensNamed(s, 'Jace Token');
    const hand = s.zones.hand.p1!.length;
    const draw = legal(s, 'p1', 'activate').filter((y) => y.object === jace && !y.isMana);
    expect(draw).toHaveLength(2);
    s = passBoth(settle(act(s, draw[1]!.action), []));
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
    expect(s.objects[jace!]?.zone ?? 'graveyard').not.toBe('battlefield'); // 0 loyalty: put into its owner's graveyard (CR 704.5i), then it ceases to exist
  });
});

describe('CR 702.189a: firebending N: "Whenever this creature attacks, add N {R}. Until end of combat, you don\'t lose this mana as steps and phases end."', () => {
  const SAGES = card('Test Ember Monk', 'Creature — Human Monk', 'Firebending 2', '{0}', ['2', '2']);
  it('the keyword is automated', () => {
    expect(manualParts(SAGES)).toEqual([]);
    expect(SAGES.automation.level).toBe('full');
  });
  it('the mana is added as the trigger resolves and stays through the combat steps; it is lost as the end of combat step ends', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ember Monk'] }, defs: [SAGES] });
    const monk = find(s, 'Test Ember Monk', 'battlefield', 'p1');
    let sawInBlockers = false;
    let sawInEndCombat = false;
    for (let i = 0; i < 80 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: monk, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else {
        const pool = s.players[0]!.manaPool.map((u) => u.type).join('');
        if (s.turn.step === 'declareBlockers' && pool === 'RR') sawInBlockers = true;
        if (s.turn.step === 'endCombat' && pool === 'RR') sawInEndCombat = true;
        s = pass(s);
      }
    }
    expect(sawInBlockers).toBe(true);
    expect(sawInEndCombat).toBe(true);
    expect(s.turn.step).toBe('main2');
    expect(s.players[0]!.manaPool).toEqual([]);
  });
  it('a granted firebending ("gains firebending 3 until end of turn") triggers too, with its own N (CR 702.189a, 613.1f)', () => {
    const BANNER = card('Test Flame Banner', 'Artifact', '{T}: Target creature you control gains firebending 3 until end of turn.');
    const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
    expect(manualParts(BANNER)).toEqual([]);
    let s = scenario([], { p1: { battlefield: ['Test Flame Banner', 'Test Hill Bear'] }, defs: [BANNER, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((y) => y.object === find(s, 'Test Flame Banner', 'battlefield', 'p1') && !y.isMana)!;
    s = passBoth(settle(act(s, a.action), [obj(bear)]));
    let seen = '';
    for (let i = 0; i < 80 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else {
        if (s.turn.step === 'combatDamage') seen = s.players[0]!.manaPool.map((u) => u.type).join('');
        s = pass(s);
      }
    }
    expect(seen).toBe('RRR');
  });
  it('mana without the mark still empties at the end of each step (CR 500.5)', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Mountain'] } });
    const mana = legal(s, 'p1', 'activate').find((y) => y.isMana)!;
    s = act(s, mana.action);
    expect(s.players[0]!.manaPool).toHaveLength(1);
    s = advanceTo(s, 1, 'beginCombat');
    expect(s.players[0]!.manaPool).toEqual([]);
  });
});
