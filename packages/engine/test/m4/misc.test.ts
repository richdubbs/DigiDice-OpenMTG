/**
 * Smaller checks around milestone 4: land creatures in combat, qualities of hexproof, concession and stop settings in the middle of a
 * combat decision, and what the other player sees of a combat decision.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, canBeTargeted, compileCard, getChars, viewFor, type OracleCard } from '../../src/index';
import { castAuto } from '../m3/scenario';
import { act, answer, creature, declareAttackers, find, lifeOf, pass, runCombat, scenario, toDeclareAttackers } from './helpers';

describe('creatures that are also other things', () => {
  it('CR 508.1a, 302.6: a land that is a creature can attack like any creature (Dryad Arbor) and becomes tapped', () => {
    const s0 = scenario(['Dryad Arbor'], { p1: { battlefield: ['Dryad Arbor'] } });
    const arbor = find(s0, 'Dryad Arbor', 'battlefield');
    const s = runCombat(s0, { attack: [[arbor]] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(s.objects[arbor]!.tapped).toBe(true);
  });

  it('CR 508.1a: a land creature that came under your control this turn is summoning sick', () => {
    const s0 = scenario(['Dryad Arbor'], { p1: { battlefield: [{ name: 'Dryad Arbor', since: 1 }] } });
    const s = pass(pass(pass(pass(s0)))); // main1 -> beginning of combat -> declare attackers: no decision
    expect(s.turn.step).toBe('declareAttackers');
    expect(s.pending!.kind).toBe('priority');
  });
});

describe('CR 702.11d: hexproof from a quality', () => {
  it('hexproof from red stops red sources of its controller\'s opponents only', () => {
    const def = creature('Test Hexproof From Red', ['1', '1'], 'Hexproof from red', '{1}{U}');
    const s = scenario(['Hill Giant', 'Serra Angel'], { p1: { battlefield: ['Hill Giant', 'Serra Angel'] }, p2: { battlefield: ['Test Hexproof From Red'] }, defs: [def] });
    const target = getChars(s, find(s, 'Test Hexproof From Red', 'battlefield'));
    const red = getChars(s, find(s, 'Hill Giant', 'battlefield'));
    const white = getChars(s, find(s, 'Serra Angel', 'battlefield'));
    expect(canBeTargeted(target, 'p2', red, 'p1')).toBe(false); // an opponent's red source
    expect(canBeTargeted(target, 'p2', white, 'p1')).toBe(true); // an opponent's white source
    expect(canBeTargeted(target, 'p2', red, 'p2')).toBe(true); // its controller's own red source
  });

  it('protection from everything: nothing can target it, block it or damage it (CR 702.16j)', () => {
    const def = creature('Test Untouchable', ['1', '1'], 'Protection from everything', '{3}');
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Test Untouchable'] }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] }, defs: [def] });
    const me = find(s0, 'Test Untouchable', 'battlefield');
    const s = runCombat(s0, { attack: [[me]] });
    expect(lifeOf(s, 'p2')).toBe(19); // it was not blocked (nothing can block it), and the player lost life
    const source = getChars(s0, find(s0, 'Grizzly Bears', 'battlefield'));
    expect(canBeTargeted(getChars(s0, me), 'p1', source, 'p2')).toBe(false);
  });
});

describe('a combat decision in the middle of an action', () => {
  const board = () => scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });

  it('CR 104.3a: a player can concede while a combat decision is pending; the other player wins', () => {
    const s = toDeclareAttackers(board());
    expect(s.pending!.kind).toBe('declareAttackers');
    const t = act(s, { type: 'concede', player: 'p1' });
    expect(t.result).toMatchObject({ winner: 'p2' });
    expect(t.pending).toBeNull();
  });

  it('changing stop settings while a combat decision is pending is kept when the decision is answered', () => {
    const s0 = board();
    let s = toDeclareAttackers(s0);
    const stops = { ownTurn: ['main2' as const], opponentTurn: [], fullControl: false };
    s = act(s, { type: 'setStops', player: 'p2', stops });
    expect(s.players[1]!.stops).toEqual(stops);
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    expect(s.players[1]!.stops).toEqual(stops);
  });

  it('the other player sees that a decision is pending but not what it is about (hidden information)', () => {
    const s = toDeclareAttackers(board());
    const mine = viewFor(s, 'p1');
    const theirs = viewFor(s, 'p2');
    expect(mine.pending).toMatchObject({ kind: 'declareAttackers' });
    expect(theirs.pending).toMatchObject({ kind: 'priority', player: 'p1', prompt: 'Waiting for the other player to decide.' });
    // After the declaration the combat is public.
    const t = declareAttackers(s, [[find(s, 'Hill Giant', 'battlefield')]]);
    expect(viewFor(t, 'p2').combat!.attackers).toHaveLength(1);
  });

  it('an unknown answer kind or a wrong player is rejected without changing the state', () => {
    const s = toDeclareAttackers(board());
    const r1 = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [] } });
    expect(r1.error?.message).toMatch(/Waiting for Alice/);
    expect(r1.state).toBe(s);
    const r2 = applyAction(s, { type: 'pass', player: 'p1' });
    expect(r2.error?.message).toMatch(/must first answer/);
    const r3 = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [] } });
    expect(r3.error).toBeDefined();
    expect(r3.state).toBe(s);
  });
});

describe('casting during combat', () => {
  it('Aura spells are sorcery-speed: casting Pacifism in the declare attackers step is refused, with flash it would not be', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Hill Giant', 'Grizzly Bears'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Grizzly Bears', 'battlefield')]]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Pacifism', 'hand') }).error?.rules).toContain('CR 117.1a');
    const flashy = compileCard({ name: 'Test Flash Aura', layout: 'normal', type_line: 'Enchantment — Aura', mana_cost: '{1}', oracle_text: 'Flash\nEnchant creature', colors: [] } as OracleCard);
    const t0 = scenario(['Plains', 'Hill Giant', 'Grizzly Bears'], { p1: { hand: ['Test Flash Aura'], battlefield: ['Plains', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [flashy] });
    s = declareAttackers(toDeclareAttackers(t0), [[find(t0, 'Grizzly Bears', 'battlefield')]]);
    s = castAuto(s, 'Test Flash Aura', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t0, 'Hill Giant', 'battlefield') }] }] });
    expect(s.zones.stack).toHaveLength(1);
  });
});
