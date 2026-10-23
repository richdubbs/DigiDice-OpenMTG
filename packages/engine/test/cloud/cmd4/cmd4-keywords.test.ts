/**
 * Commander batch, slice cmd4: keyword abilities implemented through their data (keywords/data/*.json, design 7.2), played through the engine with synthetic
 * cards compiled by the game's default compiler (invented names, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 702.156a  ravenous: "This permanent enters with X +1/+1 counters on it" and "When this permanent enters, if X is 5 or more, draw a card."
 *   CR 107.3m    the X of a permanent's enters replacement and enters trigger is the X of the spell it was; 0 when it was not cast
 *   CR 702.125a  undaunted: "This spell costs {1} less to cast for each opponent you have."
 *   CR 702.54a   bloodthirst N: "If an opponent was dealt damage this turn, this permanent enters with N +1/+1 counters on it."
 *   CR 400.7a    bloodthirst given to a creature spell on the stack still applies to the permanent it becomes
 *   CR 702.134a  mentor: "Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions until priority: payments automatic, X = `x`, the first options and the given targets. */
function drive(s0: GameState, x = 0, targets: ({ kind: 'object'; id: string } | { kind: 'player'; id: string })[][] = [], yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
type Tgt = { kind: 'object'; id: string } | { kind: 'player'; id: string };
function resolveAll(s0: GameState, yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), 0, [], yes);
  return s;
}
const castX = (s: GameState, name: string, x: number, targets: Tgt[][] = [], yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), x, targets, yes), yes);
const hand = (s: GameState): number => s.zones.hand['p1']!.length;
const plusOnes = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;

describe('CR 702.156a: ravenous', () => {
  const GAUNT = card('Test Gaunt', 'Creature — Tyranid', 'Ravenous\nTrample', { pt: ['0', '0'], cost: '{X}' });
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const forests = Array(6).fill('Forest') as string[];
  it('is implemented: the keyword is an engine capability and the card has nothing manual', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:ravenous')).toBe(true);
    expect(noManual(GAUNT)).toBe(true);
  });
  it('CR 702.156a, 107.3m: cast with X = 2, it enters with two +1/+1 counters and draws no card', () => {
    const s0 = scenario(['Forest'], { defs: [GAUNT], p1: { hand: ['Test Gaunt'], battlefield: forests } });
    const s = castX(s0, 'Test Gaunt', 2);
    expect(plusOnes(s, 'Test Gaunt')).toBe(2);
    expect(hand(s)).toBe(hand(s0) - 1);
  });
  it('CR 702.156a, 603.4: cast with X = 5, it enters with five +1/+1 counters and its controller draws a card', () => {
    const s0 = scenario(['Forest'], { defs: [GAUNT], p1: { hand: ['Test Gaunt'], battlefield: forests } });
    const s = castX(s0, 'Test Gaunt', 5);
    expect(plusOnes(s, 'Test Gaunt')).toBe(5);
    expect(hand(s)).toBe(hand(s0)); // the creature left the hand, the drawn card came in
  });
  it('CR 107.3m: put onto the battlefield without being cast, X is 0: no counters and no card (the 0/0 dies)', () => {
    const s0 = scenario(['Forest'], { defs: [GAUNT, RAISE], p1: { hand: ['Test Raise'], graveyard: ['Test Gaunt'] } });
    const s = castX(s0, 'Test Raise', 0, [[{ kind: 'object', id: find(s0, 'Test Gaunt', 'graveyard', 'p1') }]]);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Gaunt')).toBe(false);
    expect(hand(s)).toBe(hand(s0) - 1);
  });
});

describe('CR 702.125a: undaunted', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'Undaunted\nYou gain 3 life.', { cost: '{3}' });
  it('is implemented and the card has nothing manual', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:undaunted')).toBe(true);
    expect(noManual(RALLY)).toBe(true);
  });
  it('CR 702.125a, 601.2f: with one opponent the spell costs {1} less: two lands pay for it, and one stays untapped of three', () => {
    const s0 = scenario(['Forest'], { defs: [RALLY], p1: { hand: ['Test Rally'], battlefield: ['Forest', 'Forest', 'Forest'] } });
    const s = castX(s0, 'Test Rally', 0);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(s0.players.find((p) => p.id === 'p1')!.life + 3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Forest' && s.objects[id]!.tapped).length).toBe(2);
  });
});

describe('CR 702.54a, 400.7a: bloodthirst', () => {
  const FIEND = card('Test Fiend', 'Creature — Vampire', 'Bloodthirst 2', { pt: ['1', '1'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target player.');
  const LORD = card('Test Lord', 'Creature — Vampire', 'Whenever you cast a Vampire creature spell, it gains bloodthirst 3.', { pt: ['2', '2'] });
  const PLAIN = card('Test Thrall', 'Creature — Vampire', '', { pt: ['1', '1'] });
  const DEFS = [FIEND, ZAP, LORD, PLAIN];
  it('is implemented and the cards have nothing manual', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:bloodthirst')).toBe(true);
    for (const d of [FIEND, LORD]) expect(noManual(d), d.name).toBe(true);
  });
  it('CR 702.54a: no opponent was dealt damage this turn: it enters without counters', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Fiend'] } });
    expect(plusOnes(castX(s0, 'Test Fiend', 0), 'Test Fiend')).toBe(0);
  });
  it('CR 702.54a: after an opponent was dealt damage this turn it enters with two +1/+1 counters', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Fiend', 'Test Zap'] } });
    const s1 = castX(s0, 'Test Zap', 0, [[{ kind: 'player', id: 'p2' }]]);
    expect(plusOnes(castX(s1, 'Test Fiend', 0), 'Test Fiend')).toBe(2);
  });
  it('CR 702.54a: damage dealt to its controller is not damage dealt to an opponent', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Fiend', 'Test Zap'] } });
    const s1 = castX(s0, 'Test Zap', 0, [[{ kind: 'player', id: 'p1' }]]);
    expect(plusOnes(castX(s1, 'Test Fiend', 0), 'Test Fiend')).toBe(0);
  });
  it('CR 400.7a: bloodthirst 3 given to the creature spell on the stack applies as the permanent it becomes enters', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Thrall', 'Test Zap'], battlefield: ['Test Lord'] } });
    const s1 = castX(s0, 'Test Zap', 0, [[{ kind: 'player', id: 'p2' }]]);
    expect(plusOnes(castX(s1, 'Test Thrall', 0), 'Test Thrall')).toBe(3);
  });
});

describe('CR 702.134a: mentor', () => {
  const SAGE = card('Test Sage', 'Creature — Human Soldier', 'Mentor', { pt: ['3', '3'] });
  const CUB = card('Test Cub', 'Creature — Cat', '', { pt: ['1', '1'] });
  const PEER = card('Test Peer', 'Creature — Cat', '', { pt: ['3', '1'] });
  it('is implemented and the card has nothing manual', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:mentor')).toBe(true);
    expect(noManual(SAGE)).toBe(true);
  });
  it('CR 702.134a: it puts a +1/+1 counter on an attacking creature with lesser power; one with equal power is not a legal target', () => {
    const s0 = scenario([], { defs: [SAGE, CUB, PEER], p1: { battlefield: ['Test Sage', 'Test Cub', 'Test Peer'] } });
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, [[find(s, 'Test Sage', 'battlefield', 'p1')], [find(s, 'Test Cub', 'battlefield', 'p1')], [find(s, 'Test Peer', 'battlefield', 'p1')]]);
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = JSON.stringify(s.pending);
    expect(options).toContain(find(s, 'Test Cub', 'battlefield', 'p1'));
    expect(options).not.toContain(`"${find(s, 'Test Peer', 'battlefield', 'p1')}"`);
    s = resolveAll(drive(s, 0, [[{ kind: 'object', id: find(s, 'Test Cub', 'battlefield', 'p1') }]]));
    expect(plusOnes(s, 'Test Cub')).toBe(1);
    expect(plusOnes(s, 'Test Peer')).toBe(0);
  });
});

describe('CR 702.105a: dethrone', () => {
  const USURPER = card('Test Usurper', 'Creature — Human Rogue', 'Dethrone', { pt: ['2', '2'] });
  const attack = (life: { p1: number; p2: number }): GameState => {
    let s = scenario([], { defs: [USURPER], p1: { battlefield: ['Test Usurper'] } });
    s = { ...s, players: s.players.map((p) => ({ ...p, life: life[p.id as 'p1' | 'p2'] })) };
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Usurper', 'battlefield', 'p1')]]);
    return resolveAll(drive(s));
  };
  it('is implemented and the card has nothing manual', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:dethrone')).toBe(true);
    expect(noManual(USURPER)).toBe(true);
  });
  it('CR 702.105a: attacking the player with the most life, it gets a +1/+1 counter', () => {
    expect(plusOnes(attack({ p1: 20, p2: 25 }), 'Test Usurper')).toBe(1);
  });
  it('CR 702.105a: tied for most life counts', () => {
    expect(plusOnes(attack({ p1: 20, p2: 20 }), 'Test Usurper')).toBe(1);
  });
  it('CR 702.105a: attacking a player with less life than another player, it does not trigger', () => {
    expect(plusOnes(attack({ p1: 20, p2: 12 }), 'Test Usurper')).toBe(0);
  });
});
