/**
 * Wave 7 line review of r4-copy (PR #57): casting the copy of an exiled card (CR 707.12) with cards the slice's scenarios do not use.
 *
 *   CR 707.12, 707.10f, 608.3f  the cast copy of a permanent card resolves into a token; the card stays in exile
 *   CR 707.12, 107.3b           the copy of an X spell cast without paying its mana cost has X = 0
 *   CR 704.5e                   a copy of a card that is not cast ceases to exist (it is not left in exile)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

function resolveAll(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 80; guard++) {
    if (!s.pending) break;
    if (s.pending.kind === 'priority') s = pass(s);
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && tq.length > 0) s = answer(s, { kind: 'chooseTargets', targets: tq.shift()! });
    else if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 3 }) // would be wrong (CR 107.3b): an X asked for would deal 3;
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}

const BEAST = card('Test Beast', 'Creature — Beast', 'Trample', { pt: ['3', '3'], cost: '{0}' });
const BLAST = card('Test Blast', 'Instant', 'Test Blast deals X damage to any target.', { cost: '{X}{R}' });
const PUNISH = card('Test Punisher', 'Creature — Warlock', '{1}: Exile up to one target creature card from your graveyard and copy it. You may cast the copy. If you do, you lose 2 life.', { pt: ['2', '2'] });
const SAGE = card('Test Sage', 'Sorcery', 'Exile target instant card from your graveyard. Copy it. You may cast the copy without paying its mana cost.');
const defs = [BEAST, BLAST, PUNISH, SAGE];

function activatePunisher(s0: GameState, answers: DecisionAnswer[]): GameState {
  const punisher = find(s0, 'Test Punisher', 'battlefield', 'p1');
  const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === punisher)!;
  let s = act(s0, la.action);
  return resolveAll(s, answers, [[obj(find(s0, 'Test Beast', 'graveyard', 'p1'))]]);
}

describe('CR 707.12, 707.10f, 608.3f: the cast copy of an exiled permanent card becomes a token as it resolves', () => {
  it('cast: a token Test Beast enters; the card stays in exile; you lose 2 life', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Punisher', 'Plains'], graveyard: ['Test Beast'] }, defs });
    const s = activatePunisher(s0, [yes]);
    const beasts = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Beast');
    expect(beasts.length).toBe(1);
    expect(s.objects[beasts[0]!]!.kind).toBe('token');
    expect(s.objects[beasts[0]!]!.controller).toBe('p1');
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Beast']);
    expect(s.zones.exile.every((id) => s.objects[id]!.kind === 'card')).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
  });
  it('CR 704.5e: declined, the copy ceases to exist; only the card is in exile and no life is lost', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Punisher', 'Plains'], graveyard: ['Test Beast'] }, defs });
    const s = activatePunisher(s0, [no]);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Beast')).toBe(false);
    expect(s.zones.exile.length).toBe(1);
    expect(s.objects[s.zones.exile[0]!]!.kind).toBe('card');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
  });
});

describe('CR 707.12, 107.3b: the copy of an X spell cast without paying its mana cost has X = 0', () => {
  it('the free copy of Test Blast deals 0 damage', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sage'], graveyard: ['Test Blast'] }, defs });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sage', 'hand') });
    s = resolveAll(s, [yes], [[obj(find(s0, 'Test Blast', 'graveyard', 'p1'))], [{ kind: 'player', id: 'p2' }]]);
    expect(s.log.some((l) => /casts? .*Test Blast/i.test(l.text))).toBe(true);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
    expect(s.zones.stack.length).toBe(0);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Blast']);
    expect(s.log.some((l) => /by hand/.test(l.text))).toBe(false);
  });
});
