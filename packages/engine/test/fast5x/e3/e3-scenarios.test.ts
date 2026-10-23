/**
 * FAST5X E3: saddle and the saddled designation (CR 702.171), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 702.171a      "Saddle N": tap any number of OTHER untapped creatures you control with total power N or greater; activate only as a sorcery
 *   CR 302.6         a creature with summoning sickness can be tapped for it (the cost has no {T} of the tapped creatures)
 *   CR 702.171b      the saddled designation: until end of turn (cleanup, CR 514.2) or until the permanent leaves the battlefield (CR 400.7: a new object has no designation)
 *   CR 702.171c      "a creature that saddled it this turn": the creatures tapped to pay the cost, even when the ability does not resolve
 *   CR 508.1, 603.2  "Whenever ~ attacks while saddled": the designation is read as it attacks
 *   CR 603.2e        "Whenever ~ becomes saddled for the first time each turn"
 *   CR 702.122a      "~ saddles Mounts and crews Vehicles as though its power were N greater" / "using its toughness rather than its power"; crew unchanged otherwise
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer the decisions of an activation: the creatures to tap (`picks`), costs automatically, targets; stop at priority. */
function settle(s0: GameState, picks: ObjectId[] = [], targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    const k = s.pending.kind;
    if (k === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: picks });
    else if (k === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (k === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (k === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, [], targets);
  return s;
}
const activations = (s: GameState, id: ObjectId, player = 'p1') => legal(s, player, 'activate').filter((a) => a.object === id && !a.isMana);
function activate(s: GameState, id: ObjectId, picks: ObjectId[], targets: TargetChoice[] = [], player = 'p1'): GameState {
  const la = activations(s, id, player)[0];
  if (!la) throw new Error('no activated ability');
  return settle(act(s, la.action), picks, targets);
}
const saddle = (s: GameState, mount: ObjectId, picks: ObjectId[]): GameState => resolveAll(activate(s, mount, picks));
const attackWith = (s: GameState, ids: ObjectId[]): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat' || x.zones.stack.length > 0, 'combat');

const JAGUAR = card('Test Jaguar', 'Creature — Cat Mount', 'Vigilance\nWhenever Test Jaguar attacks while saddled, it gets +2/+2 until end of turn.\nSaddle 2', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const MOUSE = card('Test Mouse', 'Creature — Mouse', '', ['1', '1']);
const PILOT = card('Test Pilot', 'Creature — Human Pilot', 'Test Pilot saddles Mounts and crews Vehicles as though its power were 2 greater.', ['1', '1']);
const ACE = card('Test Ace', 'Artifact Creature — Robot Pilot', 'Test Ace saddles Mounts and crews Vehicles using its toughness rather than its power.', ['0', '3']);
const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 3', ['4', '4']);
const BEAVER = card('Test Beaver', 'Creature — Beaver Mount', 'Whenever Test Beaver attacks while saddled, put a +1/+1 counter on target creature that saddled it this turn.\nSaddle 2', ['3', '3']);
const BURROW = card('Test Burrow', 'Creature — Badger Mount', 'Whenever Test Burrow becomes saddled for the first time each turn, you gain 3 life.\nSaddle 1', ['2', '2']);
const MATRIX = card('Test Matrix', 'Artifact', '{T}: Target Mount you control becomes saddled until end of turn. Activate only as a sorcery.');
const DEFS = [JAGUAR, BEAR, MOUSE, PILOT, ACE, CART, BEAVER, BURROW, MATRIX];

describe('the cards are automated (CR 702.171)', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.171a: the saddle ability', () => {
  it('taps other untapped creatures with total power N or greater (summoning sick ones too, CR 302.6), not the Mount; the Mount becomes saddled as it resolves', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', { name: 'Test Bear', since: 1 }] }, defs: DEFS });
    const jaguar = find(s0, 'Test Jaguar', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(s0.objects[bear]!.controlledSinceTurn).toBe(1); // it came under p1's control this turn
    const onStack = activate(s0, jaguar, [bear]);
    expect(onStack.zones.stack.length).toBe(1);
    expect(onStack.objects[bear]!.tapped).toBe(true);
    expect(onStack.objects[jaguar]!.tapped).toBe(false);
    expect(onStack.objects[jaguar]!.saddled).toBeUndefined(); // not yet: the ability is on the stack
    expect(onStack.objects[jaguar]!.saddledBy).toEqual([bear]); // CR 702.171c: it saddled the Jaguar as it was tapped
    const s = resolveAll(onStack);
    expect(s.objects[jaguar]!.saddled).toBe(true);
  });
  it('is not offered without enough other power; a creature that is not "other" never pays (the Mount\'s own power does not count)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Mouse'] }, defs: DEFS });
    expect(activations(s0, find(s0, 'Test Jaguar', 'battlefield'))).toEqual([]);
  });
  it('CR 602.5d, 307.1: only as a sorcery: not with something on the stack, not in combat, not on the opponent\'s turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Bear', 'Test Mouse', 'Test Mouse'] }, defs: DEFS });
    const jaguar = find(s0, 'Test Jaguar', 'battlefield');
    const mice = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Mouse');
    const pending = activate(s0, jaguar, [find(s0, 'Test Bear', 'battlefield')]);
    expect(pending.pending?.kind).toBe('priority');
    expect(activations(pending, jaguar)).toEqual([]); // the stack is not empty
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(activations(combat, jaguar)).toEqual([]);
    const theirTurn = advanceTo(s0, 2, 'main1');
    expect(activations(theirTurn, jaguar, 'p1')).toEqual([]);
    expect(mice.length).toBe(2);
  });
});

describe('CR 702.171b: the saddled designation', () => {
  it('ends in the cleanup step with the record of the creatures that saddled it (CR 514.2)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Bear'] }, defs: DEFS });
    const jaguar = find(s0, 'Test Jaguar', 'battlefield');
    const s = saddle(s0, jaguar, [find(s0, 'Test Bear', 'battlefield')]);
    expect(s.objects[jaguar]!.saddled).toBe(true);
    const next = advanceTo(s, 2, 'upkeep');
    expect(next.objects[jaguar]!.saddled).toBeUndefined();
    expect(next.objects[jaguar]!.saddledBy).toBeUndefined();
  });
  it('CR 508.1, 603.2: "attacks while saddled" triggers only when it is saddled as it attacks', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Bear'] }, defs: DEFS });
    const jaguar = find(s0, 'Test Jaguar', 'battlefield');
    const plain = attackWith(s0, [jaguar]);
    expect(plain.zones.stack.length).toBe(0);
    const saddled = saddle(s0, jaguar, [find(s0, 'Test Bear', 'battlefield')]);
    const a = attackWith(saddled, [jaguar]);
    expect(a.zones.stack.length).toBe(1);
    const r = resolveAll(a);
    expect(pt(r, jaguar)).toBe('4/4');
    expect(r.objects[jaguar]!.tapped).toBe(false); // vigilance
  });
  it('an effect saddles a Mount ("Target Mount you control becomes saddled until end of turn"), and only a Mount you control is a target', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Matrix', 'Test Bear'] }, p2: { battlefield: ['Test Beaver'] }, defs: DEFS });
    const jaguar = find(s0, 'Test Jaguar', 'battlefield');
    const t = act(s0, activations(s0, find(s0, 'Test Matrix', 'battlefield'))[0]!.action);
    expect(t.pending?.kind).toBe('chooseTargets');
    expect((t.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>).objects).toEqual([jaguar]);
    const s = resolveAll(settle(t, [], [{ kind: 'object', id: jaguar }]));
    expect(s.objects[jaguar]!.saddled).toBe(true);
    expect(s.objects[jaguar]!.saddledBy).toBeUndefined(); // no creature saddled it (CR 702.171c)
    expect(resolveAll(attackWith(s, [jaguar])).objects[jaguar] && pt(resolveAll(attackWith(s, [jaguar])), jaguar)).toBe('4/4');
  });
});

describe('CR 702.171c: "a creature that saddled it this turn"', () => {
  it('only the creatures tapped for its saddle cost are such creatures', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Beaver', 'Test Bear', 'Test Mouse'] }, defs: DEFS });
    const beaver = find(s0, 'Test Beaver', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const mouse = find(s0, 'Test Mouse', 'battlefield');
    const s = saddle(s0, beaver, [bear]);
    const a = attackWith(s, [beaver]);
    expect(a.zones.stack.length).toBe(1);
    const asked = passUntil(a, (x) => x.pending?.kind === 'chooseTargets' || x.zones.stack.length === 0, 'the target of the trigger', 5);
    if (asked.pending?.kind === 'chooseTargets') {
      expect((asked.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>).objects).toEqual([bear]);
    }
    const r = resolveAll(a, [{ kind: 'object', id: bear }]);
    expect(r.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(r.objects[mouse]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('the creatures saddle it even when the ability does not resolve (they were tapped to pay its cost)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Beaver', 'Test Bear'] }, defs: DEFS });
    const beaver = find(s0, 'Test Beaver', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = activate(s0, beaver, [bear]);
    const countered = tweak(s, (t) => { const ab = t.zones.stack.pop()!; delete t.objects[ab]; });
    expect(countered.objects[beaver]!.saddled).toBeUndefined();
    expect(countered.objects[beaver]!.saddledBy).toEqual([bear]);
  });
});

describe('CR 603.2e: "becomes saddled for the first time each turn"', () => {
  it('triggers on the first saddling of the turn only', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Burrow', 'Test Mouse', 'Test Mouse'] }, defs: DEFS });
    const burrow = find(s0, 'Test Burrow', 'battlefield');
    const [m1, m2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Mouse');
    const once = saddle(s0, burrow, [m1!]);
    expect(life(once, 'p1')).toBe(23);
    const twice = saddle(once, burrow, [m2!]);
    expect(twice.objects[burrow]!.saddled).toBe(true);
    expect(life(twice, 'p1')).toBe(23);
    expect(twice.objects[burrow]!.saddledBy).toEqual([m1, m2]);
  });
});

describe('CR 702.122a, 702.171a: what a creature counts for crew and saddle costs', () => {
  it('"as though its power were 2 greater": a 1/1 Pilot alone saddles 3 (Saddle 2 here) and crews 3', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Pilot', 'Test Cart'] }, defs: DEFS });
    const pilot = find(s0, 'Test Pilot', 'battlefield');
    const cart = find(s0, 'Test Cart', 'battlefield');
    expect(activations(s0, cart).length).toBe(1); // crew 3 with a 1/1 counting 3
    const crewed = resolveAll(activate(s0, cart, [pilot]));
    expect(getChars(crewed, cart)!.types).toContain('Creature');
    const s1 = scenario([], { p1: { battlefield: ['Test Jaguar', 'Test Pilot'] }, defs: DEFS });
    const j = find(s1, 'Test Jaguar', 'battlefield');
    expect(resolveAll(activate(s1, j, [find(s1, 'Test Pilot', 'battlefield')])).objects[j]!.saddled).toBe(true);
  });
  it('without the static ability a 1/1 does not crew 3: crew is unchanged (G10)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mouse', 'Test Cart'] }, defs: DEFS });
    expect(activations(s0, find(s0, 'Test Cart', 'battlefield'))).toEqual([]);
    const s1 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Mouse', 'Test Cart'] }, defs: DEFS });
    expect(activations(s1, find(s1, 'Test Cart', 'battlefield')).length).toBe(1); // 2 + 1 = 3
  });
  it('"using its toughness rather than its power": a 0/3 crews 3 and saddles 2; the bonus applies to crew and saddle costs only', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ace', 'Test Cart', 'Test Jaguar'] }, defs: DEFS });
    expect(activations(s0, find(s0, 'Test Cart', 'battlefield')).length).toBe(1);
    expect(activations(s0, find(s0, 'Test Jaguar', 'battlefield')).length).toBe(1);
    expect(pt(s0, find(s0, 'Test Ace', 'battlefield'))).toBe('0/3'); // its power is unchanged
  });
});
