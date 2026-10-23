import { describe, expect, it } from 'vitest';
import { seedRng, nextUint32, randomInt, shuffleInPlace } from '../../src/index';

describe('seeded RNG', () => {
  it('is deterministic for the same seed', () => {
    const a = seedRng('abc');
    const b = seedRng('abc');
    const xs = Array.from({ length: 50 }, () => nextUint32(a));
    const ys = Array.from({ length: 50 }, () => nextUint32(b));
    expect(xs).toEqual(ys);
  });

  it('differs for different seeds', () => {
    const a = seedRng('abc');
    const b = seedRng('abd');
    expect(Array.from({ length: 5 }, () => nextUint32(a))).not.toEqual(Array.from({ length: 5 }, () => nextUint32(b)));
  });

  it('state is plain serializable data and can be resumed', () => {
    const a = seedRng('resume');
    nextUint32(a);
    const copy = JSON.parse(JSON.stringify(a));
    expect(nextUint32(a)).toBe(nextUint32(copy));
  });

  it('randomInt stays in range and is roughly uniform', () => {
    const st = seedRng('uniform');
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) counts[randomInt(st, 6)]!++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });

  it('shuffle (CR 701.24) is a permutation and deterministic', () => {
    const arr = Array.from({ length: 60 }, (_, i) => i);
    const s1 = shuffleInPlace(seedRng('x'), [...arr]);
    const s2 = shuffleInPlace(seedRng('x'), [...arr]);
    expect(s1).toEqual(s2);
    expect([...s1].sort((a, b) => a - b)).toEqual(arr);
    expect(s1).not.toEqual(arr);
  });
});
