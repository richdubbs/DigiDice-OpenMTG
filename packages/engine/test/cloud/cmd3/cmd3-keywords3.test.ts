/**
 * CMD3 (commander batch): keywords whose abilities work from the hand or the graveyard,(wordings invented, design 6.10).
 *
 *   CR 702.77a   reinforce N--[cost]: [cost], discard this card: N +1/+1 counters on target creature (an ability of a card in hand, CR 113.6b)
 *   CR 702.53a   transmute [cost]: [cost], discard this card: search for a card with the same mana value, reveal it, put it into your hand, shuffle; sorcery speed
 *   CR 702.97a   scavenge [cost]: [cost], exile this card from your graveyard: +1/+1 counters equal to its power on target creature; sorcery speed
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, advanceTo, find, legal, scenario } from '../../m3/scenario';
import { card, counters, full, inYard, resolveAll, settle } from './helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BRACER = card('Test Bracer', 'Instant', 'Reinforce 2—{0}\nYou gain 1 life.', undefined, '{1}{W}');
const SEEKER = card('Test Seeker', 'Sorcery', 'Transmute {0}\nDraw a card.', undefined, '{1}{U}');
const TWO = card('Test Two', 'Creature — Bear', '', ['2', '2'], '{1}{U}');
const THREE = card('Test Three', 'Creature — Bear', '', ['3', '3'], '{2}{U}');
const SCAVENGER = card('Test Scavenger', 'Creature — Ooze', 'Scavenge {0}', ['3', '3'], '{2}{G}');
const DEFS = [BEAR, BRACER, SEEKER, TWO, THREE, SCAVENGER];

const abilityOf = (s: GameState, id: string) => legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana);

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.77a: reinforce', () => {
  it('discarded from the hand: two +1/+1 counters on target creature', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Bracer'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bracer = find(s0, 'Test Bracer', 'hand');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const acts = abilityOf(s0, bracer);
    expect(acts).toHaveLength(1);
    const s = resolveAll(settle(act(s0, acts[0]!.action), { targets: [{ kind: 'object', id: bear }] }));
    expect(counters(s, bear, '+1/+1')).toBe(2);
    expect(inYard(s, 'Test Bracer')).toBe(true);
  });
});

describe('CR 702.53a: transmute', () => {
  it('only a card with the same mana value is found; it goes to the hand', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Seeker'], library: ['Test Two', 'Test Three'] }, defs: DEFS });
    const seeker = find(s0, 'Test Seeker', 'hand');
    const acts = abilityOf(s0, seeker);
    expect(acts).toHaveLength(1);
    let s = act(s0, acts[0]!.action);
    s = settle(s);
    s = act(act(s, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = (s.pending as { options: string[] }).options.map((id) => s.objects[id]!.defId);
    expect(options).toEqual(['Test Two']);
    s = resolveAll(s, { objects: (s.pending as { options: string[] }).options });
    expect((s.zones.hand['p1'] ?? []).map((id) => s.objects[id]!.defId)).toEqual(['Test Two']);
    expect(inYard(s, 'Test Seeker')).toBe(true);
  });
  it('only as a sorcery', () => {
    const s0 = advanceTo(scenario(['Plains'], { p1: { hand: ['Test Seeker'] }, defs: DEFS }), 2, 'main1');
    expect(abilityOf(s0, find(s0, 'Test Seeker', 'hand'))).toHaveLength(0);
  });
});

describe('CR 702.97a: scavenge', () => {
  it('exiled from the graveyard: +1/+1 counters equal to its power (3) on target creature', () => {
    const s0 = scenario(['Plains'], { p1: { graveyard: ['Test Scavenger'], battlefield: ['Test Bear'] }, defs: DEFS });
    const scav = find(s0, 'Test Scavenger', 'graveyard');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const acts = abilityOf(s0, scav);
    expect(acts).toHaveLength(1);
    const s = resolveAll(settle(act(s0, acts[0]!.action), { targets: [{ kind: 'object', id: bear }] }));
    expect(counters(s, bear, '+1/+1')).toBe(3);
    expect(inYard(s, 'Test Scavenger')).toBe(false);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Scavenger');
  });
  it('only as a sorcery', () => {
    const s0 = advanceTo(scenario(['Plains'], { p1: { graveyard: ['Test Scavenger'], battlefield: ['Test Bear'] }, defs: DEFS }), 2, 'main1');
    expect(abilityOf(s0, find(s0, 'Test Scavenger', 'graveyard'))).toHaveLength(0);
  });
});
