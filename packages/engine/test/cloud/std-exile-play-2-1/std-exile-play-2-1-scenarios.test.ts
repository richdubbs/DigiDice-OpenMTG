/**
 * std-exile-play-2-1 (lane std-exile-play-2): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 118.9, 202.3, 611.2a  "You may play those cards this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost."
 *                            (rid.stdexile1.top.castThisWay.lifeCost, its "@oneOf" shape for named cards): a spell is cast for life, no mana; a land is played as a land play; the permission ends with the turn
 *   CR 202.3, 608.2c, 101.4  "Each opponent exiles cards from the top of their library until they have exiled cards with total mana value 4 or greater this
 *                            way. Until end of turn, you may cast cards exiled this way without paying their mana costs." (eff.sxp21.exileUntil.total.eachPlayer)
 *   CR 607.2a, 601.2f, 118.8 "During your turn, you may cast creature spells from among cards you own exiled with ~ by removing two counters from among
 *                            creatures you control in addition to paying their other costs." (sta.sxp21.permit.linked.cast.removeAmong)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, find, life, scenario } from '../../m3/scenario';
import { passUntil } from '../../m4/helpers';
import { card, counters, full, resolveAll, settle } from '../cmd3/helpers';

const INSIGHT = card('Test Insight', 'Sorcery',
  "Exile the top two cards of target opponent's library. You may play those cards this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
const REVERIE = card('Test Reverie', 'Sorcery',
  'Each opponent exiles cards from the top of their library until they have exiled cards with total mana value 4 or greater this way. Until end of turn, you may cast cards exiled this way without paying their mana costs.');
const WARDEN = card('Test Warden', 'Artifact',
  '{T}: Exile target card from a graveyard.\nDuring your turn, you may cast creature spells from among cards you own exiled with ~ by removing two counters from among creatures you control in addition to paying their other costs.');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5'], '{4}{R}');
const PUP = card('Test Pup', 'Creature — Dog', '', ['1', '1'], '{1}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', undefined, '{1}');
const DEFS = [INSIGHT, REVERIE, WARDEN, CUB, GIANT, PUP, BOLT];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const inExile = (s: GameState, defId: string): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === defId);
const castsOf = (s: GameState, id: ObjectId | undefined, player = 'p1') => legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id);
const onBattlefield = (s: GameState, defId: string, controller = 'p1'): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === controller);
const castSpell = (s: GameState, name: string, picks: Parameters<typeof settle>[1] = {}): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), picks), picks);

describe('CR 118.9, 202.3, 611.2a: "You may play those cards this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost."', () => {
  const exiled = (): GameState => {
    const s = scenario(['Plains'], { p1: { hand: ['Test Insight'] }, p2: { library: ['Test Giant', 'Plains'] }, defs: DEFS });
    return castSpell(s, 'Test Insight', { targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('a spell exiled this way is cast for life equal to its mana value, with no mana (CR 118.9: the alternative cost is not optional)', () => {
    const s0 = exiled();
    const giant = inExile(s0, 'Test Giant');
    expect(giant).toBeDefined();
    const casts = castsOf(s0, giant);
    expect(casts.length).toBe(1);
    const before = life(s0, 'p1');
    const s = resolveAll(settle(act(s0, casts[0]!.action)));
    expect(life(s, 'p1')).toBe(before - 5); // CR 202.3: {4}{R} is mana value 5; p1 controls no land, so nothing else paid for it
    expect(onBattlefield(s, 'Test Giant')).toBe(true);
  });
  it('a land exiled this way is played with a land play, for no life (CR 305.1: a land is played, not cast)', () => {
    const s0 = exiled();
    const land = s0.zones.exile.find((id) => s0.objects[id]!.defId === 'Plains' && s0.objects[id]!.owner === 'p2');
    expect(land).toBeDefined();
    const play = legalActions(s0, 'p1').find((a) => a.kind === 'playLand' && a.object === land);
    expect(play).toBeDefined();
    const before = life(s0, 'p1');
    const s = act(s0, play!.action);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1' && s.objects[id]!.owner === 'p2')).toBe(true);
    expect(s.zones.exile.includes(land!)).toBe(false);
    expect(life(s, 'p1')).toBe(before);
  });
  it('CR 611.2a: the permission ends with the turn: on the next turn of its controller the card is not offered', () => {
    const s0 = exiled();
    const giant = inExile(s0, 'Test Giant')!;
    let s = advanceTo(s0, 3, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 3');
    expect(castsOf(s, giant).length).toBe(0);
  });
  it('without enough life the spell is not offered (CR 119.4, 118.3)', () => {
    const s0 = exiled();
    const s = { ...s0, players: s0.players.map((p) => (p.id === 'p1' ? { ...p, life: 4 } : p)) } as GameState;
    expect(castsOf(s, inExile(s, 'Test Giant')).length).toBe(0);
  });
});

describe('CR 202.3, 608.2c, 101.4: each opponent exiles until their own total of mana values is 4 or greater; those cards are cast free this turn', () => {
  const exiled = (): GameState => {
    const s = scenario(['Plains'], { p1: { hand: ['Test Reverie'] }, p2: { library: ['Plains', 'Test Cub', 'Test Giant', 'Test Pup'] }, defs: DEFS });
    return castSpell(s, 'Test Reverie');
  };
  it('the opponent exiles the land (mana value 0), the Cub (2) and the Giant (2 + 5 = 7, the total reached); the Pup stays on top of their library', () => {
    const s = exiled();
    expect(inExile(s, 'Test Cub')).toBeDefined();
    expect(inExile(s, 'Test Giant')).toBeDefined();
    expect(inExile(s, 'Test Pup')).toBeUndefined();
    expect(s.objects[s.zones.library['p2']![0]!]!.defId).toBe('Test Pup');
  });
  it('CR 118.9: you may cast a card exiled this way without paying its mana cost (p1 has no mana), and it is yours', () => {
    const s0 = exiled();
    const giant = inExile(s0, 'Test Giant');
    const casts = castsOf(s0, giant);
    expect(casts.length).toBeGreaterThan(0);
    const s = resolveAll(settle(act(s0, casts[0]!.action)));
    expect(onBattlefield(s, 'Test Giant')).toBe(true);
  });
  it('the opponent may not cast them, and the permission ends with the turn (CR 611.2a)', () => {
    const s0 = exiled();
    const cub = inExile(s0, 'Test Cub')!;
    expect(castsOf(s0, cub, 'p2').length).toBe(0);
    let s = advanceTo(s0, 3, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 3');
    expect(castsOf(s, cub).length).toBe(0);
  });
});

describe('CR 607.2a, 601.2f, 118.8: creature spells from among cards you own exiled with ~, by removing two counters from among creatures you control', () => {
  const board = (counterCount: number, graveyard: { p1?: string[]; p2?: string[] } = { p1: ['Test Pup'] }): { s: GameState; exiled: ObjectId } => {
    let s = scenario(['Plains'], {
      p1: { battlefield: ['Test Warden', 'Plains', { name: 'Test Cub', counters: { '+1/+1': counterCount } }], graveyard: graveyard.p1 ?? [] },
      p2: { graveyard: graveyard.p2 ?? [] }, defs: DEFS,
    });
    const name = (graveyard.p1 ?? graveyard.p2)![0]!;
    const owner = graveyard.p1 !== undefined ? 'p1' : 'p2';
    const target = find(s, name, 'graveyard', owner);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && /Test Warden/.test(x.label));
    if (!a) throw new Error('no Warden activation');
    s = resolveAll(settle(act(s, a.action), { targets: [{ kind: 'object', id: target }] }), { targets: [{ kind: 'object', id: target }] });
    return { s, exiled: inExile(s, name)! };
  };
  it('the creature card is cast paying its mana cost and removing two counters from the creatures you control', () => {
    const { s: s0, exiled } = board(3);
    expect(exiled).toBeDefined();
    const casts = castsOf(s0, exiled);
    expect(casts.length).toBe(1);
    const cub = find(s0, 'Test Cub', 'battlefield');
    const s = resolveAll(settle(act(s0, casts[0]!.action), { objects: [cub, cub] }), { objects: [cub, cub] });
    expect(onBattlefield(s, 'Test Pup')).toBe(true);
    expect(counters(s, cub, '+1/+1')).toBe(1);
  });
  it('CR 118.3: with fewer than two counters among your creatures the spell is not offered', () => {
    const { s, exiled } = board(1);
    expect(castsOf(s, exiled).length).toBe(0);
  });
  it('only cards you own, only creature spells (CR 601.3e), and only during your turn', () => {
    const theirs = board(3, { p2: ['Test Pup'] });
    expect(castsOf(theirs.s, theirs.exiled).length).toBe(0);
    const instant = board(3, { p1: ['Test Bolt'] });
    expect(castsOf(instant.s, instant.exiled).length).toBe(0);
    const { s: s0, exiled } = board(3);
    let s = advanceTo(s0, 2, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 2');
    expect(castsOf(s, exiled).length).toBe(0);
  });
});
