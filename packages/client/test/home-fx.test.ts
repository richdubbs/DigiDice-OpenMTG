/** Home's living backdrop (screens/homeFx.ts): the floor lines up with the shell's CSS floor, and the light cycles stay on its grid lines. */
import { describe, expect, it } from 'vitest';
import { CELL, Floor, HomeFx, lineX, lineY, touches, trim, type Cycle } from '../src/screens/homeFx';
import { cssOf, declarations } from './css-rules';

const VIEW = { width: 1920, height: 1080 };

/** A small seeded generator, so runs repeat. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const onVertical = (x: number) => Math.abs(((x - lineX(0)) % CELL + CELL) % CELL) < 1e-6 || Math.abs(((x - lineX(0)) % CELL + CELL) % CELL - CELL) < 1e-6;
const onHorizontal = (y: number) => Math.abs(((y - lineY(0)) % CELL + CELL) % CELL) < 1e-6 || Math.abs(((y - lineY(0)) % CELL + CELL) % CELL - CELL) < 1e-6;

describe('the floor', () => {
  it('mirrors the shell floor in theme/styles.css (box, perspective, grid size, drift)', () => {
    const css = cssOf('theme/styles.css');
    const floor = declarations(css, '.app::before');
    expect(floor.bottom).toBe('-8vh');
    expect(floor.height).toBe('62vh');
    expect(floor.transform).toBe('perspective(520px) rotateX(64deg)');
    expect(floor['transform-origin']).toBe('50% 0');
    expect(floor.background).toContain(`/ ${CELL}px ${CELL}px`);
    expect(css).toContain('animation: grid-drift 14s linear infinite;');
    expect(css).toContain(`background-position: 50% 0, 50% ${CELL}px;`);
  });

  it('projects its far edge unmagnified at 46vh and reaches the bottom of the view at `near`', () => {
    const f = new Floor(VIEW);
    expect(f.project(0, 0)).toEqual({ x: 960, y: 1080 * 0.46 });
    expect(f.project(100, 0).x).toBeCloseTo(1060);
    expect(f.project(0, f.near).y).toBeCloseTo(1080);
    expect(f.scale(f.near)).toBeGreaterThan(3);
  });

  it('fades in from the far edge and out toward the near one, like the CSS mask', () => {
    const f = new Floor(VIEW);
    expect(f.mask(0)).toBe(0);
    expect(f.mask(f.depth * 0.11)).toBeCloseTo(0.5);
    expect(f.mask(f.depth * 0.5)).toBe(1);
    expect(f.mask(f.depth * 0.85)).toBeCloseTo(0.5);
  });
});

describe('light cycles', () => {
  it('ride only along grid lines, through the drift wrapping around, and keep their walls to length', () => {
    const fx = new HomeFx(VIEW, seeded(7));
    let rode = 0;
    for (let i = 0; i < 60 * 40; i++) {
      fx.step(1 / 60, ((i * 16.7) % 14_000) / (14_000 / CELL));
      for (const c of fx.cycles) {
        if (c.state !== 'ride') continue;
        rode++;
        for (let n = 1; n < c.wall.length; n++) {
          const a = c.wall[n - 1]!;
          const b = c.wall[n]!;
          // Each segment is straight along one line: a vertical line (same x) or a horizontal one (same y).
          if (Math.abs(a.x - b.x) < 1e-6) expect(onVertical(a.x)).toBe(true);
          else {
            expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6);
            expect(onHorizontal(a.y)).toBe(true);
          }
        }
        const length = c.wall.slice(1).reduce((sum, p, n) => sum + Math.abs(p.x - c.wall[n]!.x) + Math.abs(p.y - c.wall[n]!.y), 0);
        expect(length).toBeLessThanOrEqual(c.length + 1e-6);
      }
    }
    expect(rode).toBeGreaterThan(1000);
  });

  it('stay put on screen when the drift wraps around (they move one cell in the grid frame)', () => {
    const fx = new HomeFx(VIEW, () => 0.99);
    fx.step(0, 63);
    const c: Cycle = { wall: [{ x: lineX(0), y: lineY(4) }, { x: lineX(1), y: lineY(4) }], dir: 1, speed: 0, toNode: CELL, length: 999, hue: 0, state: 'ride', fade: 1, clock: 1 };
    fx.cycles.splice(0, fx.cycles.length, c);
    const before = c.wall[1]!.y + fx.phase;
    fx.step(0, 0);
    expect(c.wall[1]!.y + fx.phase).toBeCloseTo(before + 1);
  });

  it('derez when they run into another wall', () => {
    const fx = new HomeFx(VIEW, () => 0.99);
    fx.step(0, 0);
    const wall: Cycle = { wall: [{ x: lineX(1), y: lineY(2) }, { x: lineX(1), y: lineY(5) }], dir: 2, speed: 0, toNode: CELL, length: 999, hue: 1, state: 'ride', fade: 1, clock: 1 };
    const rider: Cycle = { wall: [{ x: lineX(-1), y: lineY(4) }, { x: lineX(0), y: lineY(4) }], dir: 1, speed: 120, toNode: CELL, length: 300, hue: 0, state: 'ride', fade: 1, clock: 1 };
    fx.cycles.splice(0, fx.cycles.length, wall, rider);
    for (let i = 0; i < 60 && rider.state === 'ride'; i++) fx.step(1 / 60, 0);
    expect(rider.state).toBe('derez');
    expect(wall.state).toBe('ride');
    expect(Math.abs(rider.wall.at(-1)!.x - lineX(1))).toBeLessThan(2);
    expect(fx.sparks.length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('trim shortens a wall from its oldest end', () => {
    const wall = [
      { x: 0, y: 0 },
      { x: 0, y: 64 },
      { x: 64, y: 64 },
    ];
    trim(wall, 80);
    expect(wall).toEqual([
      { x: 0, y: 48 },
      { x: 0, y: 64 },
      { x: 64, y: 64 },
    ]);
    trim(wall, 30);
    expect(wall).toEqual([
      { x: 34, y: 64 },
      { x: 64, y: 64 },
    ]);
  });

  it('touches finds crossing and head-on segments, not parallel ones a cell apart', () => {
    expect(touches({ x: -10, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 64 }, 1)).toBe(true);
    expect(touches({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 9 }, { x: 0, y: 30 }, 1)).toBe(true);
    expect(touches({ x: 0, y: 0 }, { x: 0, y: 64 }, { x: 64, y: 0 }, { x: 64, y: 64 }, 1)).toBe(false);
  });
});
