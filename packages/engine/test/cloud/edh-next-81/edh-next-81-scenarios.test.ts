/**
 * edh-next-81 (small clusters of the repeated failing sentences, EDHREC top 20,000; code edhn81): played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). CR cites written from memory in a cloud session (no rules/cr/): unverified.
 *
 *   CR 702.62a, 107.3a, 107.3b   "Suspend X--{X}{R}. X can't be 0.": X is chosen as the suspend action is taken; the card gets X time counters; X is at least 1
 *   CR 113.6k, 702.62a, 603.2    "Whenever a time counter is removed from ~ while it's exiled, ...": works from exile, once per removal event (one counter at a time, as the upkeep removes it; a removal of several counters at once is one trigger, an engine limit of all counter triggers, recorded), and only there
 *   CR 118.12, 608.2d, 603.12   "You may pay {M} any number of times. When you pay this cost one or more times, ... that many": the number of payments is the count of the reflexive trigger
 *   CR 122.2, 400.7              "Counters remain on ~ as it moves to any zone other than a player's hand or library.": the counters go with it, except to a hand or a library
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type Action, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, cast, drive, find, lands, next, resolveAll, resolveTop, scenario, target } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string | null } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost === null ? '' : o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const special = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'special' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name)?.action;
const inExile = (s: GameState, name: string): string | undefined => s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === name);
/** Resolve the creature spell (it enters); the enter trigger is put on the stack and resolved: the first decision it asks. */
function resolveTopTrigger(s: GameState): GameState {
  let t = resolveTop(s);
  if (t.pending?.kind === 'priority' && t.zones.stack.length > 0) t = resolveTop(t);
  return t;
}
const tappedCount = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t) && t.pending?.kind !== 'yesNo'; i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => upTo(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);

describe('CR 702.62a, 107.3a: Suspend X--{X}{R}. X can\'t be 0.', () => {
  const MIND = card('Test Slow Mind', 'Creature — Wizard', 'Suspend X--{X}{R}. X can\'t be 0.\nWhenever a time counter is removed from this card while it\'s exiled, you gain 1 life.', { pt: ['1', '1'], cost: '{5}{R}' });
  const board = (n: number): GameState => scenario(['Mountain'], { defs: [MIND], p1: { hand: ['Test Slow Mind'], battlefield: lands('Mountain', n) }, p2: { battlefield: lands('Mountain', 1) } });
  const xAnswer = (n: number): DecisionAnswer => ({ kind: 'chooseNumber', n } as DecisionAnswer);

  it('the card compiles full (keyword with X and xMin 1, trigger from exile)', () => {
    expect(full(MIND)).toBe(true);
  });
  it('X is chosen as the action is taken; the cost is paid with it and the card gets X time counters (CR 702.62a, 107.3a)', () => {
    let s = board(4);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'special' && /Suspend Test Slow Mind \(X time counters/.test(a.label))).toBe(true);
    s = act(s, special(s, 'Test Slow Mind')!);
    expect(s.pending?.kind).toBe('chooseNumber');
    s = drive(answer(s, xAnswer(3)));
    expect(tappedCount(s)).toBe(4); // {3}{R}
    const id = inExile(s, 'Test Slow Mind')!;
    expect(s.objects[id]!.counters['time']).toBe(3);
    expect(s.zones.stack).toEqual([]);
  });
  it('the most X the mana can pay is the cap: 2 lands allow X = 1 only', () => {
    let s = board(2);
    s = act(s, special(s, 'Test Slow Mind')!);
    // only one value of X can be paid ({1}{R}), so none is asked: the card is suspended with 1 time counter
    s = s.pending?.kind === 'chooseNumber' ? drive(answer(s, xAnswer(1))) : drive(s);
    expect(s.objects[inExile(s, 'Test Slow Mind')!]!.counters['time']).toBe(1);
    expect(tappedCount(s)).toBe(2);
  });
  it('a value of X above what can be paid is refused (CR 601.2h-style, 107.3a)', () => {
    let s = board(3);
    s = act(s, special(s, 'Test Slow Mind')!);
    expect(s.pending?.kind).toBe('chooseNumber');
    const bad = applyAction(s, { type: 'answer', player: 'p1', answer: xAnswer(5) } as never);
    expect(bad.error).toBeDefined();
  });
  it('X can\'t be 0: with one land ({R} alone would be X = 0) the suspend action is not offered (CR 107.3a, 702.62b)', () => {
    const s = board(1);
    expect(special(s, 'Test Slow Mind')).toBeUndefined();
  });
  it('the upkeep removal triggers the card in exile once per counter; the trigger gains life (CR 702.62a, 113.6k, 603.2)', () => {
    let s = board(3);
    s = act(s, special(s, 'Test Slow Mind')!);
    s = drive(answer(s, xAnswer(2)));
    const life = lifeOf(s, 'p1');
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(s.objects[inExile(s, 'Test Slow Mind')!]!.counters['time']).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(life + 1);
  });
});

describe('CR 113.6k, 603.2: "while it\'s exiled" works from exile only', () => {
  const DINO = card('Test Slow Dino', 'Creature — Dinosaur', 'Suspend 2--{R}\nWhenever a time counter is removed from this card while it\'s exiled, you gain 2 life.', { pt: ['1', '1'], cost: '{5}{R}' });
  const REMOVE = card('Test Unwind', 'Instant', 'Remove a time counter from target permanent.', { cost: '{0}' });
  it('both cards compile full', () => {
    expect(full(DINO)).toBe(true);
    expect(full(REMOVE)).toBe(true);
  });
  it('a time counter removed from the same card on the battlefield does not trigger it (negative)', () => {
    const s0 = scenario(['Mountain'], { defs: [DINO, REMOVE], p1: { hand: ['Test Unwind'], battlefield: ['Test Slow Dino', ...lands('Mountain', 1)] } });
    const id = find(s0, 'Test Slow Dino', 'battlefield', 'p1');
    s0.objects[id]!.counters['time'] = 2;
    expect(s0.objects[id]!.counters['time']).toBe(2);
    const life = lifeOf(s0, 'p1');
    let s = resolveAll(cast(s0, 'Test Unwind', [target(id)]));
    expect(s.objects[id]!.counters['time']).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(life);
  });
  it('from exile the same removal triggers it: a suspended card loses a counter at upkeep and its controller gains 2 (CR 702.62a)', () => {
    let s = scenario(['Mountain'], { defs: [DINO], p1: { hand: ['Test Slow Dino'], battlefield: lands('Mountain', 1) } });
    s = drive(act(s, special(s, 'Test Slow Dino')!));
    const life = lifeOf(s, 'p1');
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(s.objects[inExile(s, 'Test Slow Dino')!]!.counters['time']).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
});

describe('CR 122.2, 400.7: counters remain on ~ as it moves to any zone other than a player\'s hand or library', () => {
  const BEAR = card('Test Hardy Bear', 'Creature — Bear', 'Counters remain on this creature as it moves to any zone other than a player\'s hand or library.', { pt: ['1', '1'], cost: '{0}' });
  const PLAIN = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{0}' });
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const BOUNCE_IT = card('Test Gust', 'Instant', 'Return target creature to its owner\'s hand.', { cost: '{0}' });
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.', { cost: '{0}' });
  const setup = (extra: string[] = []): { s: GameState; bear: string; plain: string } => {
    const s0 = scenario(['Mountain'], { defs: [BEAR, PLAIN, KILL, BOUNCE_IT, RAISE], p1: { hand: ['Test Smite', 'Test Gust', 'Test Raise', ...extra], battlefield: ['Test Hardy Bear', 'Test Plain Bear'] } });
    const bear = find(s0, 'Test Hardy Bear', 'battlefield', 'p1');
    const plain = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    s0.objects[bear]!.counters['+1/+1'] = 2;
    s0.objects[bear]!.counters['charge'] = 1;
    s0.objects[plain]!.counters['+1/+1'] = 2;
    return { s: s0, bear, plain };
  };
  const inYard = (s: GameState, name: string): string | undefined => (s.zones.graveyard['p1'] ?? []).find((x) => s.defs[s.objects[x]!.defId]!.name === name);
  it('the cards compile full', () => {
    for (const d of [BEAR, KILL, BOUNCE_IT, RAISE]) expect(full(d), d.name).toBe(true);
  });
  it('dies: the new object in the graveyard has all its counters, of every kind (CR 122.2 exception, 400.7)', () => {
    const { s, bear } = setup();
    const t = resolveAll(cast(s, 'Test Smite', [target(bear)]));
    const g = inYard(t, 'Test Hardy Bear')!;
    expect(g).toBeDefined();
    expect(t.objects[g]!.counters).toEqual({ '+1/+1': 2, charge: 1 });
  });
  it('negative: a creature without the ability loses its counters as it dies', () => {
    const { s, plain } = setup();
    const t = resolveAll(cast(s, 'Test Smite', [target(plain)]));
    const g = inYard(t, 'Test Plain Bear')!;
    expect(g).toBeDefined();
    expect(t.objects[g]!.counters).toEqual({});
  });
  it('negative: returned to its owner\'s hand it loses the counters (the destination is a hand)', () => {
    const { s, bear } = setup();
    const t = resolveAll(cast(s, 'Test Gust', [target(bear)]));
    const h = (t.zones.hand['p1'] ?? []).find((x) => t.defs[t.objects[x]!.defId]!.name === 'Test Hardy Bear')!;
    expect(h).toBeDefined();
    expect(t.objects[h]!.counters).toEqual({});
  });
  it('from the graveyard back to the battlefield it still has them (the ability works in the zone it moves from, CR 113.6)', () => {
    const { s, bear } = setup();
    let t = resolveAll(cast(s, 'Test Smite', [target(bear)]));
    const g = inYard(t, 'Test Hardy Bear')!;
    t = resolveAll(cast(t, 'Test Raise', [target(g)]));
    const b = t.zones.battlefield.find((x) => t.defs[t.objects[x]!.defId]!.name === 'Test Hardy Bear')!;
    expect(b).toBeDefined();
    expect(t.objects[b]!.counters).toEqual({ '+1/+1': 2, charge: 1 });
  });
});

describe('CR 118.12, 608.2d, 603.12: you may pay {M} any number of times; when you pay this cost one or more times', () => {
  const VALOR = card('Test Valor Guard', 'Creature — Human', 'When this creature enters, you may pay {1}{W} any number of times. When you pay this cost one or more times, put that many valor counters on this creature.\nCreatures you control get +1/+1 for each valor counter on this creature.', { pt: ['1', '1'], cost: '{0}' });
  const GRAVE = card('Test Grave Guard', 'Creature — Zombie', 'When this creature enters, you may pay {2}{B} any number of times. When you pay this cost one or more times, put that many +1/+1 counters on this creature, then create twice that many 2/2 black Zombie creature tokens with decayed.', { pt: ['1', '1'], cost: '{0}' });
  const PHASE = card('Test Phase Guard', 'Creature — Spirit', 'When this creature enters, you may pay {1}{U} any number of times. When you pay this cost one or more times, put that many +1/+1 counters on this creature, then up to that many other target artifacts, creatures, and/or enchantments phase out.', { pt: ['1', '1'], cost: '{0}' });
  const BEAR = card('Test Bystander', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{0}' });
  const n = (k: number): DecisionAnswer => ({ kind: 'chooseNumber', n: k } as DecisionAnswer);
  const countersOf = (s: GameState, name: string): Record<string, number> => {
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === name)!;
    return s.objects[id]!.counters;
  };
  it('the cards compile full', () => {
    for (const d of [VALOR, GRAVE, PHASE]) expect(full(d), d.name).toBe(true);
  });
  it('paying twice puts two counters (the count is the number of payments, not the mana) and costs {1}{W} twice (CR 118.12, 608.2d)', () => {
    const s0 = scenario(['Plains'], { defs: [VALOR], p1: { hand: ['Test Valor Guard'], battlefield: lands('Plains', 5) } });
    const s = resolveAll(cast(s0, 'Test Valor Guard'), [n(2)]);
    expect(countersOf(s, 'Test Valor Guard')['valor']).toBe(2);
    expect(tappedCount(s)).toBe(4);
  });
  it('paying zero times does not trigger the reflexive trigger (CR 603.12): no counters, nothing tapped', () => {
    const s0 = scenario(['Plains'], { defs: [VALOR], p1: { hand: ['Test Valor Guard'], battlefield: lands('Plains', 5) } });
    const s = resolveAll(cast(s0, 'Test Valor Guard'), [n(0)]);
    expect(countersOf(s, 'Test Valor Guard')['valor']).toBeUndefined();
    expect(tappedCount(s)).toBe(0);
  });
  it('only as many times as the mana allows: 5 lands can pay {1}{W} twice, so the most offered is 2 (negative: 3 is refused)', () => {
    const s0 = scenario(['Plains'], { defs: [VALOR], p1: { hand: ['Test Valor Guard'], battlefield: lands('Plains', 5) } });
    const s1 = cast(s0, 'Test Valor Guard');
    let s = resolveTopTrigger(s1);
    expect(s.pending?.kind).toBe('chooseNumber');
    const bad = applyAction(s, { type: 'answer', player: 'p1', answer: n(3) } as never);
    expect(bad.error).toBeDefined();
    s = drive(answer(s, n(2)));
    expect(s.pending).toBeDefined();
  });
  it('twice that many tokens: paying three times makes three +1/+1 counters and six decayed Zombie tokens', () => {
    const s0 = scenario(['Swamp'], { defs: [GRAVE], p1: { hand: ['Test Grave Guard'], battlefield: lands('Swamp', 9) } });
    const s = resolveAll(cast(s0, 'Test Grave Guard'), [n(3)]);
    expect(countersOf(s, 'Test Grave Guard')['+1/+1']).toBe(3);
    const zombies = s.zones.battlefield.filter((x) => s.objects[x]!.kind === 'token');
    expect(zombies.length).toBe(6);
  });
  it('up to that many targets phase out: paying twice allows up to two targets (negative: a third is refused)', () => {
    const s0 = scenario(['Island'], { defs: [PHASE, BEAR], p1: { hand: ['Test Phase Guard'], battlefield: [...lands('Island', 4), 'Test Bystander', 'Test Bystander', 'Test Bystander'] } });
    const ids = s0.zones.battlefield.filter((x) => s0.defs[s0.objects[x]!.defId]!.name === 'Test Bystander');
    let s = resolveAll(cast(s0, 'Test Phase Guard'), [n(2), target(ids[0]!, ids[1]!)]);
    expect(s.objects[ids[0]!]!.phasedOut).toBe(true);
    expect(s.objects[ids[1]!]!.phasedOut).toBe(true);
    expect(s.objects[ids[2]!]!.phasedOut).toBeFalsy();
    expect(countersOf(s, 'Test Phase Guard')['+1/+1']).toBe(2);
    // negative: a third target is refused after two payments, and a second after one (the maximum is the number of payments)
    const s1 = resolveAll(cast(s0, 'Test Phase Guard'), [n(2)]);
    expect(s1.pending?.kind).toBe('chooseTargets');
    expect(applyAction(s1, { type: 'answer', player: 'p1', answer: target(ids[0]!, ids[1]!, ids[2]!) } as never).error).toBeDefined();
    const s2 = resolveAll(cast(s0, 'Test Phase Guard'), [n(1)]);
    expect(s2.pending?.kind).toBe('chooseTargets');
    expect(applyAction(s2, { type: 'answer', player: 'p1', answer: target(ids[0]!, ids[1]!) } as never).error).toBeDefined();
  });
});
