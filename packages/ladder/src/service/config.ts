/**
 * M15-3: the service's configuration defaults and their check (design 13.4 `LadderConfig`, 6.3, 7, 8.3, 8.6, 11.2).
 */
import { DEFAULT_TIER_FLOORS, isLadderId, isSeasonId, LADDER_IDS, tierOf, type LadderId } from '../api';
import type { LadderConfig } from './api';

const MINUTE = 60_000;

/** The design's values for everything but the first season and the secret (13.4), which hosted supplies. */
export const DEFAULT_LADDER_CONFIG: Readonly<Omit<LadderConfig, 'firstSeason' | 'secret'>> = Object.freeze({
  offered: LADDER_IDS,
  tierFloors: Object.freeze({}),
  closeGraceMs: 15 * MINUTE,
  reconcileAfterMs: 30 * MINUTE,
  cursorOverlapMs: 10 * MINUTE,
  sweepEveryMs: MINUTE,
  cooldowns: Object.freeze([5 * MINUTE, 15 * MINUTE, 60 * MINUTE]),
});

/** The HMAC key of the dedupe keys (11.2): the secret's bytes; a RangeError when it is not canonical base64url of at least 32 bytes. */
export function secretKey(secret: string): Buffer {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(secret)) throw new RangeError('LadderConfig.secret is not base64url');
  const key = Buffer.from(secret, 'base64url');
  if (key.toString('base64url') !== secret || key.length < 32) throw new RangeError('LadderConfig.secret must be base64url of at least 32 bytes');
  return key;
}

function duration(name: string, x: unknown): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) throw new RangeError(`LadderConfig.${name} must be a whole number of ms ≥ 0 (${String(x)})`);
  return x;
}

/** A RangeError naming the first problem, else the config (13.4); the floors are checked as tierOf checks them. */
export function checkLadderConfig(c: LadderConfig): LadderConfig {
  if (typeof c !== 'object' || c === null) throw new RangeError('LadderConfig is not an object');
  if (!Array.isArray(c.offered) || !c.offered.every(isLadderId)) throw new RangeError('LadderConfig.offered must list ladder ids');
  if (!isSeasonId(c.firstSeason)) throw new RangeError(`LadderConfig.firstSeason is not a season id (${String(c.firstSeason)})`);
  if (typeof c.tierFloors !== 'object' || c.tierFloors === null) throw new RangeError('LadderConfig.tierFloors is not an object');
  for (const [l, floors] of Object.entries(c.tierFloors)) {
    if (!isLadderId(l)) throw new RangeError(`LadderConfig.tierFloors: ${l} is not a ladder id`);
    tierOf(1500, floors as readonly number[]);
  }
  duration('closeGraceMs', c.closeGraceMs);
  duration('reconcileAfterMs', c.reconcileAfterMs);
  duration('cursorOverlapMs', c.cursorOverlapMs);
  duration('sweepEveryMs', c.sweepEveryMs);
  if (!Array.isArray(c.cooldowns) || c.cooldowns.length !== 3) throw new RangeError('LadderConfig.cooldowns must hold the 2nd, 3rd and 4th+ miss');
  c.cooldowns.forEach((d, i) => duration(`cooldowns[${i}]`, d));
  secretKey(c.secret);
  return c;
}

/** The floors a new season of `ladder` is recorded with (6.3): the configured ones, else DEFAULT_TIER_FLOORS. */
export function floorsFor(c: LadderConfig, ladder: LadderId): readonly number[] {
  return c.tierFloors[ladder] ?? DEFAULT_TIER_FLOORS;
}
