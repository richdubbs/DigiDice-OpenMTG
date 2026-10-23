/**
 * M15-2: tiers and the badge (design 6.3, 7, 17.4): tierOf at each floor and one below; tierAfter with the 25-point buffer (Arc at 1530 stays, at
 * 1524 falls to Pulse; a fall from Laser to 1540 lands in Arc); badgeTier (the median of odd and even counts, no buffer, null below 5 ratings or 55
 * career games); a ladder's own floors, also closer than the buffer (M15-2 review).
 */
import { describe, expect, it } from 'vitest';
import { badgeTier, DEFAULT_TIER_FLOORS, TIER_IDS, tierAfter, tierOf, type TierId } from '@openmtg/ladder/api';

const CAREER = 55;

describe('M15-2: tierOf (6.3)', () => {
  it('each floor starts its tier and one below is the tier under it', () => {
    const want: [number, TierId][] = [
      [-5000, 'wire'], [0, 'wire'], [1299, 'wire'], [1300, 'circuit'], [1424, 'circuit'], [1425, 'pulse'], [1549, 'pulse'], [1550, 'arc'],
      [1674, 'arc'], [1675, 'laser'], [1799, 'laser'], [1800, 'prism'], [3000, 'prism'],
    ];
    for (const [display, tier] of want) expect(tierOf(display), String(display)).toBe(tier);
    expect(tierOf(1299.999)).toBe('wire');
  });

  it("a ladder's own floors (LadderConfig.tierFloors) replace the defaults", () => {
    const floors = [1350, 1450, 1525, 1600, 1700];
    expect(tierOf(1349, floors)).toBe('wire');
    expect(tierOf(1350, floors)).toBe('circuit');
    expect(tierOf(1600, floors)).toBe('laser');
    expect(tierOf(1700, floors)).toBe('prism');
    expect(tierOf(1700)).toBe('laser');
  });

  it('refuses floors that are not five strictly rising numbers, and a rating that is not a finite number', () => {
    for (const bad of [[], [1300, 1425, 1550, 1675], [1300, 1425, 1550, 1675, 1800, 1900], [1300, 1425, 1425, 1675, 1800], [1800, 1675, 1550, 1425, 1300], [1300, Number.NaN, 1550, 1675, 1800]]) {
      expect(() => tierOf(1500, bad), JSON.stringify(bad)).toThrow(RangeError);
    }
    expect(() => tierOf(Number.NaN)).toThrow(RangeError);
    expect(() => tierOf(Infinity)).toThrow(RangeError);
  });
});

describe('M15-2: tierAfter, the demotion buffer (6.3)', () => {
  it('an Arc player at 1530 stays Arc, at 1525 (the floor less 25) too, at 1524 becomes Pulse', () => {
    expect(tierAfter('arc', 1530)).toBe('arc');
    expect(tierAfter('arc', 1525)).toBe('arc');
    expect(tierAfter('arc', 1524)).toBe('pulse');
    expect(tierAfter('arc', 1524.5)).toBe('pulse');
  });

  it('a fall from Laser to 1540 lands in Arc (the highest tier whose floor less 25 is at or below it), not in Pulse', () => {
    expect(tierOf(1540)).toBe('pulse');
    expect(tierAfter('laser', 1540)).toBe('arc');
    expect(tierAfter('prism', 1300)).toBe('circuit');
    expect(tierAfter('prism', 1274)).toBe('wire');
    expect(tierAfter('prism', 1424)).toBe('pulse');
    expect(tierAfter('circuit', 1276)).toBe('circuit');
    expect(tierAfter('circuit', 1274)).toBe('wire');
  });

  it('promotion happens at once, also across several tiers; a higher rating never lowers the tier', () => {
    expect(tierAfter('pulse', 1550)).toBe('arc');
    expect(tierAfter('wire', 1800)).toBe('prism');
    expect(tierAfter('wire', 1299)).toBe('wire');
    expect(tierAfter('prism', 5000)).toBe('prism');
    // the defaults, and a ladder's own floors with gaps under the buffer (checkFloors accepts any five rising floors), where the buffer could reach
    // past prev's own tier: the bound below holds only because tierAfter never goes above prev on a fall
    for (const floors of [DEFAULT_TIER_FLOORS, [1300, 1310, 1550, 1675, 1800], [1300, 1301, 1302, 1303, 1304]]) {
      for (const prev of TIER_IDS) {
        let last = -1;
        for (let display = 1000; display <= 2000; display += 1) {
          const at = TIER_IDS.indexOf(tierAfter(prev, display, floors));
          const fresh = TIER_IDS.indexOf(tierOf(display, floors));
          expect(at, `${floors.join(',')}: ${prev} at ${display}`).toBeGreaterThanOrEqual(last);
          // never below the fresh tier, never above it except by the buffer's hold of prev
          expect(at, `${floors.join(',')}: ${prev} at ${display}`).toBeGreaterThanOrEqual(fresh);
          expect(at, `${floors.join(',')}: ${prev} at ${display}`).toBeLessThanOrEqual(Math.max(fresh, TIER_IDS.indexOf(prev)));
          last = at;
        }
      }
    }
  });

  it("floors closer than the buffer: a fall keeps prev at most, never a tier above it (Circuit at 1290 under floors 1300, 1310: Circuit, not Pulse)", () => {
    const floors = [1300, 1310, 1550, 1675, 1800];
    expect(tierAfter('circuit', 1290, floors)).toBe('circuit');
    expect(tierAfter('circuit', 1275, floors)).toBe('circuit');
    expect(tierAfter('circuit', 1274, floors)).toBe('wire');
    // Pulse falling to 1290: its floor less 25 is 1285, so it holds Pulse
    expect(tierAfter('pulse', 1290, floors)).toBe('pulse');
    expect(tierAfter('pulse', 1284, floors)).toBe('circuit');
  });

  it('`prev` null computes it fresh (placement\'s end, a season\'s reset); a ladder\'s own floors apply to the buffer too', () => {
    expect(tierAfter(null, 1540)).toBe('pulse');
    expect(tierAfter(null, 1525)).toBe('pulse');
    const floors = [1350, 1450, 1525, 1600, 1700];
    expect(tierAfter('laser', 1576, floors)).toBe('laser');
    expect(tierAfter('laser', 1574, floors)).toBe('arc');
  });

  it('refuses an unknown tier', () => {
    expect(() => tierAfter('gold' as TierId, 1500)).toThrow(RangeError);
  });
});

describe('M15-2: badgeTier, the season badge (7)', () => {
  it('the tier of the median of the post-placement ratings (odd count: the middle one), fresh', () => {
    expect(badgeTier([1810, 1500, 1690, 1700, 1400], CAREER)).toBe('laser');
    expect(badgeTier([1801, 1802, 1803, 1300, 1350, 1400, 1804], CAREER)).toBe('prism');
  });

  it('even count: the mean of the two middle values', () => {
    // middle values 1670 and 1680: the median 1675 is Laser; with 1670 and 1679 it is 1674.5, Arc
    expect(badgeTier([1600, 1670, 1680, 1700, 1500, 1900], CAREER)).toBe('laser');
    expect(badgeTier([1600, 1670, 1679, 1700, 1500, 1900], CAREER)).toBe('arc');
  });

  it('no demotion buffer: a median just under a floor is the tier below, whatever came before', () => {
    expect(badgeTier([1549, 1549, 1549, 1549, 1549], CAREER)).toBe('pulse');
    expect(badgeTier([1549, 1549, 1549, 1600, 1600], CAREER)).toBe('pulse');
  });

  it('the median, not the end: a player who stops right after a lucky streak keeps the streak\'s end but not its median', () => {
    const season = [1560, 1570, 1565, 1580, 1600, 1640, 1690, 1720];
    expect(tierOf(season[season.length - 1]!)).toBe('laser');
    expect(badgeTier(season, CAREER)).toBe('arc');
  });

  it('null with fewer than 5 ratings or fewer than 55 career games; given at 5 and 55', () => {
    expect(badgeTier([1700, 1700, 1700, 1700], CAREER)).toBeNull();
    expect(badgeTier([], 500)).toBeNull();
    expect(badgeTier([1700, 1700, 1700, 1700, 1700], 54)).toBeNull();
    expect(badgeTier([1700, 1700, 1700, 1700, 1700], 55)).toBe('laser');
  });

  it("a ladder's own floors; malformed input refused with a RangeError", () => {
    expect(badgeTier([1700, 1700, 1700, 1700, 1700], CAREER, [1350, 1450, 1525, 1600, 1700])).toBe('prism');
    expect(badgeTier([1700, 1700, 1700, 1700, 1700], CAREER, DEFAULT_TIER_FLOORS)).toBe('laser');
    expect(() => badgeTier([1700, Number.NaN, 1700, 1700, 1700], CAREER)).toThrow(RangeError);
    expect(() => badgeTier([1700, 1700, 1700, 1700, 1700], 30.5)).toThrow(RangeError);
    expect(() => badgeTier([1700, 1700, 1700, 1700, 1700], CAREER, [1, 2, 3])).toThrow(RangeError);
  });

  it('leaves its argument alone', () => {
    const ratings = [1900, 1500, 1700, 1600, 1800];
    badgeTier(ratings, CAREER);
    expect(ratings).toEqual([1900, 1500, 1700, 1600, 1800]);
  });
});
