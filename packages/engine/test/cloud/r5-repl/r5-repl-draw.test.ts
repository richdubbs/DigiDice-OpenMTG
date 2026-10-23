/**
 * Cloud r5-repl (Standard round 5: replacement and prevention effects): "If you would draw a card except the first one you draw in each of your draw steps,
 * draw two cards instead." (EventPattern draw `exceptFirstInDrawStep`), played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 504.1, 614.1a          the first card drawn in your draw step is drawn as usual; every other draw is replaced
 *   CR 614.6, 121.2           the replacing draws are not replaced again (one replacement per event)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
function activate(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, name, 'battlefield'), ability: 'p:0:0' });
  for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) s = answer(s, { kind: 'payCost', auto: true });
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = pass(pass(s));
  return s;
}

const ARCHIVE = card('Test Archive', 'Artifact', 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.');
const WELL = card('Test Well', 'Artifact', '{T}: Draw a card.');

describe('Cloud r5-repl: "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead." (CR 504.1, 614.1a)', () => {
  it('is automated', () => expect(full(ARCHIVE)).toBe(true));
  it('CR 614.1a, 614.6: a draw outside the draw step is two cards (and those two are not replaced again)', () => {
    let s = scenario([], { defs: [ARCHIVE, WELL], p1: { battlefield: ['Test Archive', 'Test Well'] } });
    const before = handSize(s);
    s = activate(s, 'Test Well');
    expect(handSize(s)).toBe(before + 2);
  });
  it('CR 504.1: the first card drawn in your draw step is one card; a second draw in that step is two', () => {
    let s = scenario([], { defs: [ARCHIVE, WELL], p1: { battlefield: ['Test Archive', 'Test Well'] } });
    s = advanceTo(s, 3, 'draw');
    expect(s.turn.activePlayer).toBe('p1');
    const after = handSize(s);
    s = advanceTo(s, 3, 'main1');
    expect(handSize(s)).toBe(after);
    const drawn = s.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn;
    expect(drawn).toBe(1); // the draw step's draw was not replaced
    s = activate(s, 'Test Well');
    expect(handSize(s)).toBe(after + 2);
  });
  it('CR 504.1: in the draw step, after the first card, a draw is replaced', () => {
    let s = scenario([], { defs: [ARCHIVE, WELL], p1: { battlefield: ['Test Archive', 'Test Well'] } });
    s = advanceTo(s, 3, 'draw');
    expect(s.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn).toBe(1);
    s = activate(s, 'Test Well');
    expect(s.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn).toBe(3);
  });
  it('CR 504.1: another player\'s draw step is not yours: a draw there is replaced', () => {
    let s = scenario([], { defs: [ARCHIVE, WELL], p1: { battlefield: ['Test Archive', 'Test Well'] } });
    s = advanceTo(s, 2, 'draw');
    expect(s.turn.activePlayer).toBe('p2');
    while (s.pending?.player !== 'p1') s = pass(s);
    const before = handSize(s);
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Well', 'battlefield'), ability: 'p:0:0' });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) s = answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = pass(pass(s));
    expect(handSize(s)).toBe(before + 2);
  });
});

describe('Cloud r5-repl: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card." (CR 504.1, 614.6)', () => {
  const THIEF = card('Test Thief', 'Creature — Human Rogue', 'If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.', { pt: ['2', '1'] });
  const STUDY = card('Test Study', 'Sorcery', 'Each player draws a card.');
  it('is automated', () => expect(full(THIEF)).toBe(true));
  it('CR 614.6: an opponent\'s draw outside their draw step is yours instead; your own draw is unchanged', () => {
    let s = scenario([], { defs: [THIEF, STUDY], p1: { hand: ['Test Study'], battlefield: ['Test Thief'] } });
    const mine = handSize(s) - 1;
    const theirs = handSize(s, 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Study', 'hand') });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) s = answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = pass(pass(s));
    expect(handSize(s, 'p2')).toBe(theirs);
    expect(handSize(s)).toBe(mine + 2);
  });
  it('CR 504.1: the first card an opponent draws in their draw step is theirs', () => {
    let s = scenario([], { defs: [THIEF], p1: { battlefield: ['Test Thief'] } });
    const theirs = handSize(s, 'p2');
    s = advanceTo(s, 2, 'draw');
    expect(handSize(s, 'p2')).toBe(theirs + 1);
  });
});
