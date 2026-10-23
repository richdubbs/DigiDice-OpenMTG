/**
 * p2-refs-1 (Phase 2 lane p2-refs): the round's engine changes played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 607.2a, 110.2   "return the exiled cards to the battlefield under their owners' control": what the linked exile exiled, nothing another effect exiled
 *   CR 406.3, 121.1, 607.2a  "target player exiles all cards from their hand face down, then draws that many cards" ... "return the exiled cards to their owner's hand"
 *   CR 601.2b, 701.20a, 608.2h  "As an additional cost to cast this spell, reveal a creature card from your hand. ... the revealed card's mana value": the card the
 *                    cost revealed; no creature card in hand, no cast; without such a cost the words name nothing (manual)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const handOf = (s: GameState, player: string): string[] => (s.zones.hand[player] ?? []).map((id) => s.objects[id]!.defId);
const sideOf = (s: GameState, player: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player).map((id) => s.objects[id]!.defId);

const RELIC = card('Test Relic', 'Artifact', '');
const IDOL = card('Test Idol', 'Artifact', '');
const OX = card('Test Ox', 'Creature — Ox', '', ['3', '3'], '{3}');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{2}');
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature or enchantment.');
const SHATTER = card('Test Shatter', 'Instant', 'Exile target artifact.');
const WARDEN = card('Test Warden', 'Creature — Golem', "When this creature enters, exile up to two target artifacts.\nWhen this creature leaves the battlefield, return the exiled cards to the battlefield under their owners' control.", ['1', '1']);
const AMNESIA = card('Test Amnesia', 'Enchantment', "When this enchantment enters, target player exiles all cards from their hand face down, then draws that many cards.\nWhen this enchantment is put into a graveyard from the battlefield, return the exiled cards to their owner's hand.");
const DESTINY = card('Test Destiny', 'Instant', "As an additional cost to cast this spell, reveal a creature card from your hand.\nYou gain life equal to the revealed card's mana value.");
const RADIUS = card('Test Radius', 'Sorcery', "As an additional cost to cast this spell, reveal a creature card from your hand.\nTest Radius deals damage to target creature equal to the revealed card's power.");
const DEFS = [RELIC, IDOL, OX, CUB, SLAY, SHATTER, WARDEN, AMNESIA, DESTINY, RADIUS];

describe('the synthetic p2-refs-1 cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [WARDEN, AMNESIA, DESTINY, RADIUS]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('CR 601.2b: without a reveal cost on the face, "the revealed card" names nothing: the spell is not automated', () => {
    const bare = card('Test Bare', 'Instant', "You gain life equal to the revealed card's mana value.");
    expect(full(bare)).toBe(false);
  });
});

describe('CR 607.2a, 110.2: "return the exiled cards to the battlefield under their owners\' control"', () => {
  const warden = (): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Warden', 'Test Slay', 'Test Shatter'] }, p2: { battlefield: ['Test Relic', 'Test Idol'] } });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const idol = find(s0, 'Test Idol', 'battlefield', 'p2');
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warden', 'hand') }), { targets: [{ kind: 'object', id: relic }, { kind: 'object', id: idol }] });
  };
  it('both artifacts the enter trigger exiled come back under their owner\'s control when it dies', () => {
    let s = warden();
    expect(sideOf(s, 'p2')).toEqual([]);
    expect(s.zones.exile.length).toBe(2);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand') }), { targets: [{ kind: 'object', id: find(s, 'Test Warden', 'battlefield', 'p1') }] });
    expect(sideOf(s, 'p2').sort()).toEqual(['Test Idol', 'Test Relic']);
    expect(s.zones.exile.length).toBe(0);
  });
  it('an artifact another spell exiled stays in exile', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Warden', 'Test Slay', 'Test Shatter'] }, p2: { battlefield: ['Test Relic', 'Test Idol'] } });
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shatter', 'hand') }), { targets: [{ kind: 'object', id: find(s0, 'Test Idol', 'battlefield', 'p2') }] });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Warden', 'hand') }), { targets: [{ kind: 'object', id: find(s, 'Test Relic', 'battlefield', 'p2') }] });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand') }), { targets: [{ kind: 'object', id: find(s, 'Test Warden', 'battlefield', 'p1') }] });
    expect(sideOf(s, 'p2')).toEqual(['Test Relic']);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Idol']);
  });
});

describe('CR 406.3, 121.1, 607.2a: "target player exiles all cards from their hand face down, then draws that many cards" ... "return the exiled cards to their owner\'s hand"', () => {
  const amnesia = (p2hand: string[]): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Amnesia', 'Test Slay'] }, p2: { hand: p2hand } });
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Amnesia', 'hand') }), { targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('the hand goes to exile face down and as many cards are drawn; when it goes to the graveyard, the exiled cards come back', () => {
    let s = amnesia(['Test Ox', 'Test Cub', 'Test Relic']);
    expect(s.zones.exile.length).toBe(3);
    expect(s.zones.exile.every((id) => s.objects[id]!.faceDown === true)).toBe(true);
    expect(handOf(s, 'p2').length).toBe(3);
    expect(handOf(s, 'p2')).not.toContain('Test Ox');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand') }), { targets: [{ kind: 'object', id: find(s, 'Test Amnesia', 'battlefield', 'p1') }] });
    expect(handOf(s, 'p2').length).toBe(6);
    expect(handOf(s, 'p2')).toEqual(expect.arrayContaining(['Test Ox', 'Test Cub', 'Test Relic']));
    expect(s.zones.exile.length).toBe(0);
  });
  it('an empty hand: nothing is exiled and nothing is drawn', () => {
    const s = amnesia([]);
    expect(s.zones.exile.length).toBe(0);
    expect(handOf(s, 'p2')).toEqual([]);
  });
});

describe('CR 601.2b, 701.20a, 608.2h: "reveal a creature card from your hand. ... the revealed card\'s mana value"', () => {
  it('revealing a three-mana creature card: 3 life; the card stays in the hand', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Destiny', 'Test Ox'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Destiny', 'hand') }));
    expect(life(s, 'p1')).toBe(23);
    expect(handOf(s, 'p1')).toEqual(['Test Ox']);
  });
  it('the card chosen among two is the one read: the two-mana card gives 2', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Destiny', 'Test Ox', 'Test Cub'] } });
    const cub = find(s0, 'Test Cub', 'hand', 'p1');
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Destiny', 'hand') }), { objects: [cub] });
    expect(life(s, 'p1')).toBe(22);
  });
  it('the revealed card\'s power: a revealed 3/3 card deals 3 to the target', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Radius', 'Test Ox'] }, p2: { battlefield: ['Test Ox'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Radius', 'hand') });
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, 'Test Ox', 'battlefield', 'p2') }] }));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(sideOf(s, 'p2')).toEqual([]);
  });
  it('no creature card in the hand: the spell can\'t be cast', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Destiny', 'Test Relic'] } });
    expect(legal(s0, 'p1', 'cast').some((a) => JSON.stringify(a).includes(find(s0, 'Test Destiny', 'hand', 'p1')))).toBe(false);
  });
});
