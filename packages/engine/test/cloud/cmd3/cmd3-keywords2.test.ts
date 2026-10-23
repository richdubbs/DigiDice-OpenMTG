/**
 * CMD3 (commander batch): more expansion keywords, played through the engine with synthetic cards (wordings invented, design 6.10).
 *
 *   CR 702.25a   flanking: whenever it becomes blocked by a creature without flanking, the blocking creature gets -1/-1 until end of turn
 *   CR 702.23a   rampage N: +N/+N until end of turn for each creature blocking it beyond the first (figured as it resolves, CR 702.23b)
 *   CR 702.100a  evolve: a creature entering under your control with greater power and/or toughness gives it a +1/+1 counter (intervening if, CR 603.4)
 *   CR 702.98a   unleash: you may have it enter with a +1/+1 counter; it can't block as long as it has a +1/+1 counter
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { advanceTo, find, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, pt, resolveAll } from './helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const LANCER = card('Test Lancer', 'Creature — Human Knight', 'Flanking', ['2', '2']);
const RIDER = card('Test Rider', 'Creature — Human Knight', 'Flanking', ['2', '2']);
const BRUTE = card('Test Brute', 'Creature — Beast', 'Rampage 2', ['3', '3']);
const PUP = card('Test Pup', 'Creature — Dog', '', ['1', '1']);
const OOZE = card('Test Ooze', 'Creature — Ooze', 'Evolve', ['1', '1']);
const WALLISH = card('Test Wallish', 'Creature — Plant', '', ['1', '3']);
const FIEND = card('Test Fiend', 'Creature — Devil', 'Unleash', ['2', '2']);
const DEFS = [BEAR, LANCER, RIDER, BRUTE, PUP, OOZE, WALLISH, FIEND];

/** p1 attacks with `attacker`, p2 blocks with `blockers`; returns the state after the triggers of the block resolved (still in the declare blockers step). */
function blockedBy(s0: GameState, attacker: ObjectId, blockers: ObjectId[]): GameState {
  const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[attacker]]));
  const b = declareBlockers(s, blockers.map((id) => [id, attacker] as [ObjectId, ObjectId]));
  return resolveAll(b); // the triggers of the block are put on the stack (ordered by their controller) before anyone gets priority (CR 509.4, 603.3b)
}

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.25a: flanking', () => {
  it('a blocking creature without flanking gets -1/-1 until end of turn', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Lancer', since: -1 }] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = blockedBy(s0, find(s0, 'Test Lancer', 'battlefield'), [bear]);
    expect(pt(s, bear)).toBe('1/1');
  });
  it('blocked by two creatures without flanking: it triggers for each of them (each gets -1/-1)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Lancer', since: -1 }] }, p2: { battlefield: ['Test Bear', 'Test Pup'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const pup = find(s0, 'Test Pup', 'battlefield', 'p2');
    const s = blockedBy(s0, find(s0, 'Test Lancer', 'battlefield'), [bear, pup]);
    expect(pt(s, bear)).toBe('1/1');
    expect(s.objects[pup]).toBeUndefined(); // 0/0: put into its owner's graveyard (CR 704.5f)
  });
  it('a blocking creature with flanking gets nothing', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Lancer', since: -1 }] }, p2: { battlefield: ['Test Rider'] }, defs: DEFS });
    const rider = find(s0, 'Test Rider', 'battlefield', 'p2');
    const s = blockedBy(s0, find(s0, 'Test Lancer', 'battlefield'), [rider]);
    expect(pt(s, rider)).toBe('2/2');
  });
});

describe('CR 702.23a: rampage', () => {
  it('blocked by two creatures: +2/+2 (one beyond the first)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Brute', since: -1 }] }, p2: { battlefield: ['Test Bear', 'Test Pup'] }, defs: DEFS });
    const brute = find(s0, 'Test Brute', 'battlefield');
    const s = blockedBy(s0, brute, [find(s0, 'Test Bear', 'battlefield', 'p2'), find(s0, 'Test Pup', 'battlefield', 'p2')]);
    expect(pt(s, brute)).toBe('5/5');
  });
  it('blocked by one creature: no bonus', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Brute', since: -1 }] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const brute = find(s0, 'Test Brute', 'battlefield');
    const s = blockedBy(s0, brute, [find(s0, 'Test Bear', 'battlefield', 'p2')]);
    expect(pt(s, brute)).toBe('3/3');
  });
});

describe('CR 702.100a: evolve', () => {
  it('greater power or toughness gives a counter; equal power and toughness gives none', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Bear', 'Test Bear', 'Test Wallish'], battlefield: ['Test Ooze'] }, defs: DEFS });
    const ooze = find(s, 'Test Ooze', 'battlefield');
    s = resolveAll(cast(s, 'Test Bear'));
    expect(pt(s, ooze)).toBe('2/2'); // 2/2 > 1/1
    s = resolveAll(cast(s, 'Test Bear'));
    expect(pt(s, ooze)).toBe('2/2'); // 2/2 is not greater than 2/2
    s = resolveAll(cast(s, 'Test Wallish'));
    expect(pt(s, ooze)).toBe('3/3'); // toughness 3 > 2
  });
});

describe('CR 702.98a: unleash', () => {
  const blockable = (s0: GameState, fiend: ObjectId): boolean => {
    const attacked = declareAttackers(toDeclareAttackers(advanceTo(s0, 2, 'main1')), [[find(s0, 'Test Bear', 'battlefield', 'p2')]]);
    // with no creature that could block, there is no declare blockers decision at all
    const s = passUntil(attacked, (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'declareBlockers', 'blockers or the end of combat', 200);
    if (s.pending?.kind !== 'declareBlockers') return false;
    try {
      declareBlockers(s, [[fiend, find(s0, 'Test Bear', 'battlefield', 'p2')]]);
      return true;
    } catch {
      return false;
    }
  };
  it('with the counter it can\'t block', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Fiend'] }, p2: { battlefield: [{ name: 'Test Bear', since: -1 }] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Fiend'), { option: '0' });
    const fiend = find(s, 'Test Fiend', 'battlefield');
    expect(counters(s, fiend, '+1/+1')).toBe(1);
    expect(blockable(s, fiend)).toBe(false);
  });
  it('without it, it can block', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Fiend'] }, p2: { battlefield: [{ name: 'Test Bear', since: -1 }] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Fiend'), { option: '1' });
    const fiend = find(s, 'Test Fiend', 'battlefield');
    expect(counters(s, fiend, '+1/+1')).toBe(0);
    expect(blockable(s, fiend)).toBe(true);
  });
});
