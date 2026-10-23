/**
 * Phase 2 lane p2-replace-events, round p2-replace-events-3: the event replacements of parser/templates/zz-cloud/p2-replace-events-3.json played through the
 * engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks,
 * with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.10, 500.7          "If a player would begin an extra turn, that player skips that turn instead." (the turn proposal's `extra`)
 *   CR 614.1a, 614.6          "If ~ would be put into a graveyard from the battlefield, instead exile it and take an extra turn after this one."
 *   CR 614.1a, 121.1          "If you would draw a card while you have no cards in hand, instead you draw two cards and you lose 1 life."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const poison = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.poison;
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters?.[kind] ?? 0;

function drive(s0: GameState, targets: TargetChoice[][] = [], yes: boolean[] = []): GameState {
  let s = s0;
  const t = [...targets];
  const y = [...yes];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: y.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], who = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), targets));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const TIME = card('Test Time Walk', 'Sorcery', 'Take an extra turn after this one.');
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');
/** Pass priority until the turn changes; returns the player whose turn it then is. */
function nextTurnPlayer(s0: GameState): string {
  let s = s0;
  const turn = s.turn.number;
  for (let i = 0; i < 200 && s.turn.number === turn; i++) s = s.pending && s.pending.kind !== 'priority' ? drive(s) : pass(s);
  return s.turn.activePlayer;
}

describe('p2-replace-events-3: "If a player would begin an extra turn, that player skips that turn instead." (CR 614.10, 500.7)', () => {
  const NEXUS = card('Test Nexus', 'Artifact', 'If a player would begin an extra turn, that player skips that turn instead.');
  it('is automated', () => expect(full(NEXUS)).toBe(true));
  it('CR 614.10: the extra turn is skipped, so the opponent takes the next turn; without it, the extra turn is taken', () => {
    let s = scenario([], { defs: [NEXUS, TIME], p1: { hand: ['Test Time Walk'], battlefield: ['Test Nexus'] } });
    s = cast(s, 'Test Time Walk');
    expect(nextTurnPlayer(s)).toBe('p2');
    let t = scenario([], { defs: [TIME], p1: { hand: ['Test Time Walk'] } });
    t = cast(t, 'Test Time Walk');
    expect(nextTurnPlayer(t)).toBe('p1');
  });
});

describe('p2-replace-events-3: "If ~ would be put into a graveyard from the battlefield, instead exile it and take an extra turn after this one." (CR 614.1a, 614.6)', () => {
  const NEXUS = card('Test Nexus', 'Artifact', 'If this artifact would be put into a graveyard from the battlefield, instead exile it and take an extra turn after this one.');
  it('is automated', () => expect(full(NEXUS)).toBe(true));
  it('CR 614.6: destroyed, it is exiled and its controller takes the next turn', () => {
    let s = scenario([], { defs: [NEXUS, SHATTER], p1: { battlefield: ['Test Nexus'] }, p2: { hand: ['Test Shatter'] } });
    s = pass(s);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Shatter', 'hand', 'p2') }), [[obj(find(s, 'Test Nexus', 'battlefield', 'p1'))]]));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Nexus']);
    expect(nextTurnPlayer(s)).toBe('p1');
  });
});

describe('p2-replace-events-3: "If you would draw a card while you have no cards in hand, instead you draw two cards and you lose 1 life." (CR 614.1a, 121.1)', () => {
  const SCRIVENER = card('Test Scrivener', 'Creature — Vampire Wizard', 'If you would draw a card while you have no cards in hand, instead you draw two cards and you lose 1 life.', { pt: ['1', '1'] });
  const PEEK = card('Test Peek', 'Instant', 'Draw a card.');
  it('is automated', () => expect(full(SCRIVENER)).toBe(true));
  it('CR 614.1a: with an empty hand one draw is two and 1 life; with a card in hand it is one draw', () => {
    let s = scenario([], { defs: [SCRIVENER, PEEK], p1: { hand: ['Test Peek'], battlefield: ['Test Scrivener'] } });
    s = cast(s, 'Test Peek');
    expect([s.zones.hand.p1!.length, life(s, 'p1')]).toEqual([2, 19]);
    let t = scenario([], { defs: [SCRIVENER, PEEK], p1: { hand: ['Test Peek', 'Plains'], battlefield: ['Test Scrivener'] } });
    t = cast(t, 'Test Peek');
    expect([t.zones.hand.p1!.length, life(t, 'p1')]).toEqual([2, 20]);
  });
});

describe('p2-replace-events-3: "If you would scry a number of cards, draw that many cards instead." (CR 701.22a, 614.1a, 614.6)', () => {
  const AUGUR = card('Test Augur', 'Creature — Human Wizard', 'If you would scry a number of cards, draw that many cards instead.', { pt: ['2', '3'] });
  const FORESEE = card('Test Foresee', 'Sorcery', 'Scry 2.');
  it('is automated', () => expect(full(AUGUR)).toBe(true));
  it('CR 614.6: scry 2 is two draws; without it, scry 2 draws nothing', () => {
    let s = scenario([], { defs: [AUGUR, FORESEE], p1: { hand: ['Test Foresee'], battlefield: ['Test Augur'] } });
    s = cast(s, 'Test Foresee');
    expect(s.zones.hand.p1).toHaveLength(2);
    let t = scenario([], { defs: [FORESEE], p1: { hand: ['Test Foresee'] } });
    t = cast(t, 'Test Foresee');
    expect(t.zones.hand.p1).toHaveLength(0);
  });
});
