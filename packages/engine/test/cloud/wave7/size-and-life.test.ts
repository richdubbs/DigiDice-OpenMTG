/**
 * Wave 7 merge (r4-cost + r4-static), CR 602.5b, 402.1, 119.1: r4-cost reads a `countPlayers` with `sizeIs` ("a player has one or fewer cards in hand") when an
 * ability is announced; r4-static added `lifeIs` ("an opponent has 10 or less life") to the same quantity. A quantity with both says "a player whose hand AND
 * life compare so", which the sizeIs reading would count by the hand alone: it is not read (announceQty undefined) and its form is not the sizeIs one, so such
 * a condition fails closed instead of being misread. Each alone keeps its reading.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, Quantity } from '../../../src/index';
import { announceCondForms } from '../../../src/model/forms';
import { announceQty, type AnnounceEnv } from '../../../src/actions/announce-cond';
import { scenario } from '../../m3/scenario';

const each = { ref: 'each', who: 'player' } as const;
const sizeOnly = { q: 'countPlayers', of: each, sizeIs: { zone: 'hand', op: '<=', n: 1 } } as Quantity;
const both = { q: 'countPlayers', of: each, sizeIs: { zone: 'hand', op: '<=', n: 1 }, lifeIs: { op: '<=', n: 10 } } as Quantity;
const atLeastOne = (left: Quantity): Condition => ({ cond: 'compare', left, op: '>=', right: 1 }) as Condition;

describe('wave 7 merge: countPlayers with sizeIs and lifeIs together is not read as sizeIs (CR 602.5b, 402.1, 119.1)', () => {
  const s = scenario([], { p1: { hand: [] }, p2: { hand: [] } });
  const env: AnnounceEnv = { s, player: 'p1', sourceId: 'none', costsPaid: {} } as AnnounceEnv;
  it('sizeIs alone: every player with one or fewer cards in hand counts (both, here)', () => {
    expect(announceQty(env, sizeOnly)).toBe(2);
    expect(announceCondForms(atLeastOne(sizeOnly), 'activate')).toContain('feature:announce.qty.countPlayers.sizeIs');
  });
  it('sizeIs with lifeIs: not read at announcement (life 20 > 10, so no player matches both; the hand alone would say 2)', () => {
    expect(announceQty(env, both)).toBeUndefined();
    expect(announceCondForms(atLeastOne(both), 'activate')).not.toContain('feature:announce.qty.countPlayers.sizeIs');
  });
});
