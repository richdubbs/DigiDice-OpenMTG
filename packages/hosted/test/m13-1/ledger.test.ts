/**
 * The results ledger's contract (design 7, review 7 and 11): loss codes, placements with shared places, the public projection (no session, account,
 * deck fingerprint or timing details), the HMAC deck fingerprint.
 */
import { describe, expect, it } from 'vitest';
import {
  asPlace, deckFingerprint, LOSS_CODES, normalizedDecklist, PUBLIC_PLACEMENT_KEYS, publicPlacement, publicPlacements, sharedPlaces, type Placement,
  type PublicPlacement,
} from '@openmtg/hosted';
import type { ResultMessage } from '@openmtg/hosted/api';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const pin = <T extends true>(_: T): void => {};
pin<Equal<PublicPlacement, Pick<Placement, 'seat' | 'name' | 'place' | 'loss' | 'lossRule' | 'outTurn'>>>(true);
pin<Equal<(typeof PUBLIC_PLACEMENT_KEYS)[number], keyof PublicPlacement>>(true);
pin<Equal<ResultMessage['placements'][number], PublicPlacement>>(true);

const SECRET = 'test-ledger-secret-0123456789abcdef';

const full = (over: Partial<Placement>): Placement => ({
  seat: 1, player: 'p1', session: '01JSESSIONSECRETID000000000', account: 'acct-42', name: 'Alice', deckHash: 'f'.repeat(64), place: 1, loss: null,
  lossRule: null, outTurn: null, outOrder: null, timeUsedMs: 61_000, timeouts: 0, disconnectedMs: 1_500, ...over,
});

describe('M13-1: ledger types', () => {
  it('lists the loss codes of design 7', () => {
    expect(LOSS_CODES).toEqual(['life', 'emptyLibrary', 'poison', 'commanderDamage', 'effect', 'opponentWon', 'concession', 'left', 'timeout', 'disconnect', 'draw']);
  });

  it('the public projection hides session, account, deck fingerprint, player id and timing (review 7)', () => {
    const p = full({ seat: 2, player: 'p2', place: 2, loss: 'timeout', lossRule: 'CR 104.3a', outTurn: 9, outOrder: 1, timeouts: 1 });
    const pub = publicPlacement(p);
    expect(pub).toEqual({ seat: 2, name: 'Alice', place: 2, loss: 'timeout', lossRule: 'CR 104.3a', outTurn: 9 });
    expect(Object.keys(pub)).toEqual([...PUBLIC_PLACEMENT_KEYS]);
    const text = JSON.stringify(publicPlacements([p]));
    for (const secret of [p.session, p.account!, p.deckHash, 'p2', 'outOrder', 'timeUsedMs', 'disconnectedMs', 'timeouts']) expect(text).not.toContain(secret);
  });

  it('extra fields smuggled onto a placement object are not copied', () => {
    const p = { ...full({}), token: 'a'.repeat(64), password: 'hunter22' } as Placement;
    expect(JSON.stringify(publicPlacement(p))).not.toMatch(/token|hunter22|aaaa/);
  });

  it('public placements come best place first, ties in seat order', () => {
    const ps = [full({ seat: 3, place: 3 }), full({ seat: 1, place: 2 }), full({ seat: 4, place: 3 }), full({ seat: 2, place: 1 })];
    expect(publicPlacements(ps).map((p) => [p.seat, p.place])).toEqual([[2, 1], [1, 2], [3, 3], [4, 3]]);
  });

  it('shared places: players out at the same time share one place (review 11)', () => {
    expect(sharedPlaces([0, 1])).toEqual([1, 2]);
    // four players, two of them out together first: 1, 2, 3, 3
    expect(sharedPlaces([0, 1, 3, 3])).toEqual([1, 2, 3, 3]);
    expect(sharedPlaces([3, 0, 2, 3])).toEqual([3, 1, 2, 3]);
    // a draw among the three still in, one out before: 1, 1, 1, 4
    expect(sharedPlaces([1, 1, 1, 2])).toEqual([1, 1, 1, 4]);
    expect(asPlace(3)).toBe(3);
    expect(() => asPlace(5)).toThrow();
  });

  it('the deck fingerprint: an HMAC of the normalized list, independent of order, dependent on the secret', () => {
    const deck = { main: ['Forest', 'Llanowar Elves', 'Forest'], sideboard: ['Naturalize'], commanders: [] as string[] };
    const shuffled = { main: ['Forest', 'Forest', 'Llanowar Elves'], sideboard: ['Naturalize'], commanders: [] as string[] };
    expect(normalizedDecklist(deck)).toBe('main\t2\tForest\nmain\t1\tLlanowar Elves\nsideboard\t1\tNaturalize');
    const h = deckFingerprint(SECRET, deck);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(deckFingerprint(SECRET, shuffled)).toBe(h);
    expect(deckFingerprint(`${SECRET}x`, deck)).not.toBe(h);
    expect(deckFingerprint(SECRET, { ...deck, sideboard: [] })).not.toBe(h);
    // a card moved between sections is a different deck
    expect(deckFingerprint(SECRET, { main: ['Forest', 'Forest'], sideboard: ['Naturalize', 'Llanowar Elves'], commanders: [] })).not.toBe(h);
    expect(() => deckFingerprint('short', deck)).toThrow(/at least 32/);
  });
});
