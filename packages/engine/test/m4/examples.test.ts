/**
 * The worked examples ("Example:" paragraphs) of the Comprehensive Rules for combat, damage, keywords and state-based actions that fall
 * inside milestone 4, plus the entering rules of battles. Each test is named after the rule that carries the example.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, type GameEvent } from '../../src/index';
import { Game } from '../../src/core/game';
import { moveObject as move } from '../../src/core/zones';
import { advanceTo } from '../m3/scenario';
import { act, answer, creature, declareAttackers, find, findAll, inGraveyard, lifeOf, passUntil, poisonOf, runCombat, scenario, toDeclareAttackers, tweak, pass, logHas } from './helpers';


describe('CR 120.5: damage does not destroy', () => {
  it('CR 120.5 example: Lightning Bolt deals 3 damage to a 2/2; the creature is destroyed by a state-based action, not by the Bolt', () => {
    const s0 = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }); // WP18: Bolt is automated (the compile pipeline)
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(s);
    // The spell resolves; the creature has the damage marked and is still on the battlefield until state-based actions are checked.
    const resolving = applyAction(s, { type: 'pass', player: s.pending!.player });
    expect(resolving.state.objects[bears]).toBeUndefined();
    expect(logHas(resolving.state, /Grizzly Bears is destroyed \(lethal damage\)/, 'CR 704.5g')).toBe(true);
    // The log shows the damage before the destruction.
    const texts = resolving.state.log.map((l) => l.text);
    expect(texts.findIndex((t) => /deals 3 damage to Grizzly Bears/.test(t))).toBeLessThan(texts.findIndex((t) => /Grizzly Bears is destroyed/.test(t)));
  });
});

describe('CR 120.4d: damage results (wither and lifelink together)', () => {
  it('CR 120.4d example (without Boon Reflection): a 3/3 with wither and lifelink blocked by a 2/2 puts three -1/-1 counters on it, gains 3 life, and takes 2 damage', () => {
    const wl = creature('Test Wither Lifelinker', ['3', '3'], 'Wither, lifelink', '{3}');
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Wither Lifelinker'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [wl] });
    const attacker = find(s0, 'Test Wither Lifelinker', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(s0, { attack: [[attacker]], block: [[bears, attacker]] });
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true); // 2/2 with three -1/-1 counters: toughness -1
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.objects[attacker]!.damage).toBe(2);
    expect(s.lki[bears]!.object.counters['-1/-1']).toBe(3);
  });
});

describe('CR 702.15e: simultaneous lifelink', () => {
  it('CR 702.15e example: two creatures with lifelink dealing combat damage together cause two separate life gain events', () => {
    const s0 = scenario(['Aardvark Sloth', 'Vampire Nighthawk'], { p1: { battlefield: ['Aardvark Sloth', 'Vampire Nighthawk'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Aardvark Sloth', 'battlefield')], [find(s0, 'Vampire Nighthawk', 'battlefield')]]);
    const events: GameEvent[] = [];
    while (s.turn.step !== 'endCombat') {
      const d = s.pending!;
      const r = applyAction(s, d.kind === 'declareBlockers' ? { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [] } } : { type: 'pass', player: d.player });
      s = r.state;
      events.push(...r.events);
    }
    const gains = events.filter((e) => e.type === 'lifeChanged' && e.player === 'p1');
    expect(gains).toEqual([
      { type: 'lifeChanged', player: 'p1', delta: 3, life: 23, cause: 'lifelink from Aardvark Sloth' },
      { type: 'lifeChanged', player: 'p1', delta: 2, life: 25, cause: 'lifelink from Vampire Nighthawk' },
    ]);
    expect(lifeOf(s, 'p2')).toBe(15);
  });
});

describe('CR 702.164b: total toxic value', () => {
  it('CR 702.164b example: toxic abilities add up: a creature with toxic 2 and toxic 1 gives 3 poison counters with its combat damage', () => {
    const c = creature('Test Toxic Three', ['2', '2'], 'Toxic 2\nToxic 1', '{2}');
    const s0 = scenario([], { p1: { battlefield: ['Test Toxic Three'] }, defs: [c] });
    const s = runCombat(s0, { attack: [[find(s0, 'Test Toxic Three', 'battlefield')]] });
    expect(poisonOf(s, 'p2')).toBe(3);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
});

describe('CR 704.8: last known information of simultaneous state-based actions', () => {
  it('CR 704.8 example: a creature with one +1/+1 counter and three -1/-1 counters dies as a state-based action; its last known information still has both kinds of counters', () => {
    const plain = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(plain, 'Grizzly Bears', 'battlefield');
    const s0 = tweak(plain, (x) => { x.objects[bears]!.counters = { '+1/+1': 1, '-1/-1': 3 }; });
    const s = pass(s0);
    expect(inGraveyard(s, 'Grizzly Bears', 'p1')).toBe(true);
    expect(s.lki[bears]!.object.counters).toEqual({ '+1/+1': 1, '-1/-1': 3 });
    expect(logHas(s, /Grizzly Bears is put into its owner's graveyard \(toughness 0 or less\)/)).toBe(true);
  });

  it('CR 704.4 example: state-based actions are checked only when a player would get priority, never in the middle of a resolution', () => {
    // A resolving effect that puts a creature at toughness 0 and then gives it back its toughness leaves it alive (the engine only looks at priority).
    const s0 = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] }, manual: ['Lightning Bolt'] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'counters', object: bears, counter: '-1/-1', delta: 2 }, { op: 'counters', object: bears, counter: '-1/-1', delta: -2 }] });
    expect(s.objects[bears]).toBeDefined();
    expect(s.zones.graveyard.p2).toEqual([]);
  });
});

describe('CR 310.9a, 310.12a: battles enter with a protector', () => {
  it('CR 310.12a: a Siege that enters the battlefield is protected by an opponent of its controller and has its defense counters (CR 310.4b)', () => {
    const siege = 'Invasion of Ergamon // Truga Cliffcharger';
    const s0 = scenario([siege], { p1: { hand: [siege] } });
    const g = new Game(cloneState(s0));
    const id = move(g, find(s0, siege, 'hand'), 'battlefield', { controller: 'p1' })!;
    const o = g.s.objects[id]!;
    expect(o.protector).toBe('p2');
    expect(o.counters.defense).toBeGreaterThan(0);
  });
});

describe('turn flow with combat (CR 500.1, 506.1)', () => {
  it('the steps of a turn with an attack are: beginning of combat, declare attackers, declare blockers, combat damage, end of combat', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = passUntil(s0, (x) => x.turn.step === 'beginCombat', 'beginning of combat');
    const steps: string[] = [s.turn.step];
    const done = (x: typeof s) => x.turn.step === 'main2';
    for (let i = 0; i < 40 && !done(s); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bears, attacker: giant }] });
      else s = pass(s);
      if (steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
    }
    expect(steps).toEqual(['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2']);
    expect(s.combat).toBeNull();
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toEqual([]);
    expect(advanceTo(s, 2, 'upkeep').turn.number).toBe(2);
  });
});
