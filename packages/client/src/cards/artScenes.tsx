/**
 * The scenes of the frame's procedural art: one per color (fiery sky, deep water, forest canopy, smoke and moon, radiant dawn), brass plates for
 * artifacts, pale crystal for colorless cards, and landscape silhouettes for lands. All drawn from a seeded generator in a 100 x 70 box with plain SVG
 * shapes (a few dozen nodes, no filters, no animation); nothing here is official art.
 */
import type { ReactNode } from 'react';
import type { Color } from '@openmtg/engine';
import {
  between,
  ceiling,
  circlePath,
  cloudPath,
  dots,
  flamePath,
  gearPath,
  leafPath,
  n1,
  peaks,
  pines,
  raysPath,
  sparklePath,
  spiralPath,
  wavy,
  type Rng,
} from './artShapes';
import type { ArtType } from './artSeed';

export type Flavor = Color | 'steel' | 'crystal' | 'terra';

export interface Pal {
  /** Top, middle and bottom of the sky. */
  sky: [string, string, string];
  /** The light of the scene (sun, moon, flame core). */
  glow: string;
  /** Accent colors, dark to light. */
  acc: [string, string, string, string];
  light: string;
  mid: string;
  dark: string;
  deep: string;
}

const hsl = (h: number, s: number, l: number, a = 1): string => `hsl(${n1(h)} ${s}% ${l}%${a < 1 ? ` / ${a}` : ''})`;

/** The palette of a flavor, hue-shifted by `dh` degrees (seeded, so two cards of one color differ). */
export function paletteOf(f: Flavor, dh: number): Pal {
  switch (f) {
    case 'R':
      return {
        sky: [hsl(352 + dh, 62, 13), hsl(8 + dh, 78, 34), hsl(34 + dh, 95, 56)],
        glow: hsl(48, 100, 78),
        acc: [hsl(4 + dh, 82, 30), hsl(18 + dh, 95, 48), hsl(40 + dh, 100, 60), hsl(54, 100, 86)],
        light: hsl(42 + dh, 100, 64),
        mid: hsl(10 + dh, 80, 42),
        dark: hsl(350 + dh, 62, 16),
        deep: hsl(350 + dh, 55, 8),
      };
    case 'U':
      return {
        sky: [hsl(232 + dh, 65, 11), hsl(214 + dh, 72, 27), hsl(190 + dh, 70, 46)],
        glow: hsl(188, 90, 86),
        acc: [hsl(222 + dh, 70, 14), hsl(212 + dh, 70, 22), hsl(200 + dh, 70, 34), hsl(188 + dh, 80, 62)],
        light: hsl(186 + dh, 85, 74),
        mid: hsl(208 + dh, 70, 36),
        dark: hsl(226 + dh, 70, 16),
        deep: hsl(232 + dh, 70, 8),
      };
    case 'G':
      return {
        sky: [hsl(160 + dh, 45, 9), hsl(138 + dh, 42, 22), hsl(92 + dh, 52, 42)],
        glow: hsl(72, 95, 80),
        acc: [hsl(150 + dh, 48, 12), hsl(135 + dh, 45, 20), hsl(112 + dh, 48, 32), hsl(84 + dh, 62, 52)],
        light: hsl(84 + dh, 70, 62),
        mid: hsl(128 + dh, 42, 30),
        dark: hsl(150 + dh, 50, 11),
        deep: hsl(160 + dh, 55, 6),
      };
    case 'B':
      return {
        sky: [hsl(268 + dh, 45, 5), hsl(276 + dh, 38, 15), hsl(292 + dh, 32, 30)],
        glow: hsl(280, 60, 88),
        acc: [hsl(268 + dh, 45, 8), hsl(278 + dh, 36, 16), hsl(288 + dh, 32, 28), hsl(296 + dh, 40, 52)],
        light: hsl(288 + dh, 50, 66),
        mid: hsl(280 + dh, 34, 26),
        dark: hsl(268 + dh, 42, 9),
        deep: hsl(262 + dh, 50, 4),
      };
    case 'W':
      return {
        sky: [hsl(208 + dh, 58, 64), hsl(40 + dh, 78, 80), hsl(46 + dh, 95, 91)],
        glow: hsl(48, 100, 97),
        acc: [hsl(36 + dh, 45, 58), hsl(42 + dh, 60, 70), hsl(46 + dh, 80, 82), hsl(0, 0, 100)],
        light: hsl(48 + dh, 100, 94),
        mid: hsl(40 + dh, 55, 66),
        dark: hsl(34 + dh, 40, 46),
        deep: hsl(30 + dh, 35, 30),
      };
    case 'steel':
      return {
        sky: [hsl(215, 14, 12), hsl(28 + dh, 22, 20), hsl(34 + dh, 30, 30)],
        glow: hsl(44, 95, 76),
        acc: [hsl(30 + dh, 22, 30), hsl(32 + dh, 26, 42), hsl(36 + dh, 32, 54), hsl(42 + dh, 45, 72)],
        light: hsl(42 + dh, 50, 76),
        mid: hsl(30 + dh, 28, 40),
        dark: hsl(26 + dh, 26, 22),
        deep: hsl(24 + dh, 24, 12),
      };
    case 'crystal':
      return {
        sky: [hsl(250 + dh, 30, 20), hsl(218 + dh, 40, 44), hsl(192 + dh, 55, 72)],
        glow: hsl(190, 100, 96),
        acc: [hsl(236 + dh, 34, 36), hsl(214 + dh, 40, 56), hsl(196 + dh, 50, 74), hsl(184 + dh, 70, 92)],
        light: hsl(188 + dh, 80, 92),
        mid: hsl(218 + dh, 42, 52),
        dark: hsl(244 + dh, 34, 26),
        deep: hsl(250 + dh, 36, 14),
      };
    case 'terra':
      return {
        sky: [hsl(218, 30, 28), hsl(28 + dh, 42, 50), hsl(40 + dh, 62, 72)],
        glow: hsl(46, 100, 86),
        acc: [hsl(24 + dh, 38, 24), hsl(28 + dh, 38, 36), hsl(34 + dh, 42, 50), hsl(40 + dh, 55, 68)],
        light: hsl(44 + dh, 70, 76),
        mid: hsl(28 + dh, 36, 38),
        dark: hsl(22 + dh, 34, 20),
        deep: hsl(20 + dh, 34, 11),
      };
  }
}

/** The CSS gradient of a palette's sky (the art box paints it as its background, so a single-colored card needs no gradient nodes). */
export function skyCss(p: Pal): string {
  return `linear-gradient(180deg, ${p.sky[0]} 0%, ${p.sky[1]} 55%, ${p.sky[2]} 100%)`;
}

/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */
/* Spell motifs                                                                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */

function fire(rng: Rng, p: Pal): ReactNode {
  const n = 4 + Math.floor(rng() * 3);
  const t = Array.from({ length: n }, (_, i) => {
    const x = 8 + (84 / (n - 1)) * i + between(rng, -4, 4);
    const centre = 1 - Math.abs(x - 50) / 70;
    return { x, h: between(rng, 20, 32) * (0.62 + 0.62 * centre), w: between(rng, 14, 22), l: between(rng, -6, 6) };
  });
  const layer = (s: number, base = 76) => t.map((q) => flamePath(q.x, base, q.w * s, q.h * s, q.l * s)).join('');
  return (
    <>
      <path d={ceiling(rng, 7, 4, 5)} fill={p.dark} opacity=".55" />
      <path d={layer(1.3, 78)} fill={p.acc[0]} opacity=".55" />
      <path d={layer(1)} fill={p.acc[0]} />
      <path d={layer(0.74)} fill={p.acc[1]} />
      <path d={layer(0.46)} fill={p.acc[2]} />
      <path d={layer(0.22, 74)} fill={p.acc[3]} />
      <path d={dots(rng, 12, 6, 94, 6, 52, 0.4, 1.1)} fill={p.acc[2]} opacity=".9" />
    </>
  );
}

function water(rng: Rng, p: Pal): ReactNode {
  const cx = between(rng, 38, 62);
  const cy = between(rng, 24, 32);
  const phase = between(rng, 0, 6.28);
  const w1 = wavy(rng, 47, 2.6, 6, 72);
  const w2 = wavy(rng, 55, 3, 5, 72);
  const w3 = wavy(rng, 62, 3, 4, 72);
  return (
    <>
      <ellipse cx="50" cy="44" rx="64" ry="7" fill="#fff" opacity=".12" />
      <path d={spiralPath(cx, cy, 2, 20, 2.4, phase)} fill="none" stroke={p.light} strokeWidth=".9" strokeLinecap="round" opacity=".85" />
      <path d={spiralPath(cx, cy, 5, 17, 1.6, phase + 2.4)} fill="none" stroke={p.glow} strokeWidth=".45" strokeLinecap="round" opacity=".55" />
      <circle cx={n1(cx)} cy={n1(cy)} r="2.2" fill={p.glow} />
      <path d={w1.area} fill={p.acc[2]} />
      <path d={w1.line} fill="none" stroke={p.light} strokeWidth=".6" opacity=".6" />
      <path d={w2.area} fill={p.acc[1]} />
      <path d={w3.area} fill={p.acc[0]} />
      <path d={dots(rng, 10, 8, 92, 20, 60, 0.4, 1)} fill={p.glow} opacity=".6" />
    </>
  );
}

function nature(rng: Rng, p: Pal): ReactNode {
  const sx = between(rng, 58, 90);
  let trunks = '';
  const nt = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < nt; i++) {
    const x = (100 / nt) * (i + 0.5) + between(rng, -9, 9);
    const w = between(rng, 3.5, 6.5);
    trunks += `M${n1(x - w)} 74L${n1(x - w * 0.45)} -4H${n1(x + w * 0.45)}L${n1(x + w)} 74Z`;
  }
  let leaves = '';
  for (let i = 0; i < 8; i++) leaves += leafPath(between(rng, 6, 94), between(rng, 12, 52), between(rng, 4, 7.5), between(rng, 0, 6.28));
  const vx = between(rng, 14, 86);
  const vines = `M${n1(vx)} -2C${n1(vx + 9)} 16 ${n1(vx - 9)} 32 ${n1(vx + 3)} 54M${n1(100 - vx)} -2C${n1(100 - vx - 7)} 12 ${n1(100 - vx + 8)} 26 ${n1(100 - vx - 2)} 42`;
  return (
    <>
      <path d={raysPath(sx, -10, 5, 100, 0.07, 1.57 - 0.5)} fill={p.glow} opacity=".16" />
      <path d={trunks} fill={p.deep} opacity=".85" />
      <path d={dots(rng, 11, 0, 100, 0, 10, 7, 11)} fill={p.acc[2]} />
      <path d={dots(rng, 10, 0, 100, -2, 6, 6, 10)} fill={p.acc[0]} />
      <path d={vines} fill="none" stroke={p.deep} strokeWidth="1" strokeLinecap="round" />
      <path d={leaves} fill={p.light} opacity=".85" />
      <path d={wavy(rng, 60, 3, 5, 72).area} fill={p.dark} />
      <path d={dots(rng, 12, 8, 92, 20, 56, 0.35, 0.9)} fill={p.glow} opacity=".8" />
    </>
  );
}

function smoke(rng: Rng, p: Pal): ReactNode {
  const mx = between(rng, 56, 76);
  const my = between(rng, 15, 23);
  const R = between(rng, 8, 11);
  const crescent = `M${n1(mx)} ${n1(my - R)}A${n1(R)} ${n1(R)} 0 0 0 ${n1(mx)} ${n1(my + R)}A${n1(R * 1.2)} ${n1(R * 1.2)} 0 0 1 ${n1(mx)} ${n1(my - R)}Z`;
  const wisp = (x0: number) => `M${n1(x0)} 76C${n1(x0 - 16)} 60 ${n1(x0 + 18)} 48 ${n1(x0 - 6)} 32S${n1(x0 + 12)} 14 ${n1(x0 + 2)} -4`;
  const x0 = between(rng, 14, 30);
  const x1 = between(rng, 42, 56);
  const x2 = between(rng, 70, 86);
  let thorns = '';
  for (let i = 0; i < 6; i++) {
    const x = 6 + i * 17 + between(rng, -4, 4);
    const h = between(rng, 10, 20);
    const lean = between(rng, -7, 7);
    thorns += `M${n1(x - 3)} 72Q${n1(x - 1)} ${n1(72 - h * 0.6)} ${n1(x + lean)} ${n1(72 - h)}Q${n1(x + 1.5)} ${n1(72 - h * 0.5)} ${n1(x + 3)} 72Z`;
  }
  return (
    <>
      <path d={dots(rng, 14, 4, 96, 3, 36, 0.3, 0.8)} fill={p.glow} opacity=".7" />
      <path d={crescent} fill={p.glow} />
      <path d={`${wisp(x0)}${wisp(x1)}${wisp(x2)}`} fill="none" stroke={p.acc[2]} strokeWidth="7" strokeLinecap="round" opacity=".3" />
      <path d={`${wisp(x0 + 4)}${wisp(x1 - 3)}${wisp(x2 + 3)}`} fill="none" stroke={p.light} strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
      <path d={cloudPath(mx - 12, my + R * 0.7, 9) + cloudPath(mx + 4, my + R * 1.1, 7)} fill={p.dark} opacity=".8" />
      <path d={thorns} fill={p.deep} />
      <path d={wavy(rng, 66, 2, 5, 72).area} fill={p.deep} />
    </>
  );
}

function radiant(rng: Rng, p: Pal): ReactNode {
  const sx = between(rng, 36, 64);
  const sy = between(rng, 26, 36);
  const phase = between(rng, 0, 1);
  const c1 = cloudPath(between(rng, 12, 26), between(rng, 44, 50), between(rng, 7, 10));
  const c2 = cloudPath(between(rng, 70, 86), between(rng, 40, 48), between(rng, 8, 11));
  const c3 = cloudPath(between(rng, 40, 60), between(rng, 52, 58), between(rng, 6, 9));
  let sparks = '';
  for (let i = 0; i < 4; i++) sparks += sparklePath(between(rng, 8, 92), between(rng, 6, 46), between(rng, 1.6, 3.2));
  return (
    <>
      <path d={raysPath(sx, sy, 16, 100, 0.05, phase)} fill={p.light} opacity=".5" />
      <circle cx={n1(sx)} cy={n1(sy)} r="7" fill="#fff" />
      <circle cx={n1(sx)} cy={n1(sy)} r="10" fill="none" stroke="#fff" strokeWidth=".8" opacity=".6" />
      <path d={wavy(rng, 50, 3, 5, 72).area} fill={p.acc[2]} opacity=".85" />
      <path d={c1 + c2 + c3} transform="translate(0 1.4)" fill={p.mid} opacity=".45" />
      <path d={c1 + c2 + c3} fill="#fff" opacity=".92" />
      <path d={wavy(rng, 62, 3, 4, 72).area} fill={p.acc[1]} />
      <path d={sparks} fill="#fff" />
    </>
  );
}

function steel(rng: Rng, p: Pal): ReactNode {
  const rows = [0, between(rng, 17, 23), between(rng, 40, 48), 70];
  const buckets: string[] = ['', '', ''];
  let edges = '';
  let rivets = '';
  for (let r = 0; r < 3; r++) {
    const y0 = rows[r]!;
    const y1 = rows[r + 1]!;
    const cols = 2 + Math.floor(rng() * 3);
    let x = 0;
    for (let c = 0; c < cols; c++) {
      const w = c === cols - 1 ? 100 - x : (100 / cols) * between(rng, 0.7, 1.3);
      const x1 = Math.min(100, x + w);
      const rect = `M${n1(x + 0.5)} ${n1(y0 + 0.5)}H${n1(x1 - 0.5)}V${n1(y1 - 0.5)}H${n1(x + 0.5)}Z`;
      buckets[Math.floor(rng() * 3)] += rect;
      edges += `M${n1(x + 0.8)} ${n1(y0 + 0.9)}H${n1(x1 - 0.8)}`;
      for (const [rx, ry] of [[x + 2.6, y0 + 2.6], [x1 - 2.6, y0 + 2.6], [x + 2.6, y1 - 2.6], [x1 - 2.6, y1 - 2.6]] as const) rivets += circlePath(rx, ry, 0.95);
      x = x1;
    }
  }
  const gx = between(rng, 66, 90);
  const gy = between(rng, 20, 50);
  return (
    <>
      <path d={buckets[0]} fill={p.acc[0]} />
      <path d={buckets[1]} fill={p.acc[1]} />
      <path d={buckets[2]} fill={p.acc[2]} />
      <path d={edges} fill="none" stroke={p.light} strokeWidth=".6" opacity=".7" />
      <circle cx={n1(gx)} cy={n1(gy)} r="17" fill={p.deep} opacity=".5" />
      <path d={gearPath(gx, gy, 16, 12, 10, 5)} fill={p.mid} stroke={p.light} strokeWidth=".6" fillRule="evenodd" />
      <circle cx={n1(gx)} cy={n1(gy)} r="3" fill={p.glow} />
      <path d={rivets} fill={p.light} opacity=".85" />
    </>
  );
}

function crystal(rng: Rng, p: Pal): ReactNode {
  const n = 3 + Math.floor(rng() * 3);
  let left = '';
  let right = '';
  let caps = '';
  for (let i = 0; i < n; i++) {
    const x = 14 + (72 / Math.max(1, n - 1)) * i + between(rng, -5, 5);
    const centre = 1 - Math.abs(x - 50) / 60;
    const h = between(rng, 22, 36) * (0.6 + 0.7 * centre);
    const w = between(rng, 5, 9);
    const top = 74 - h;
    const lean = between(rng, -3, 3);
    const tipY = top - w * 1.1;
    const sx = x + w * 0.15;
    left += `M${n1(x - w)} 74V${n1(top)}L${n1(x + lean)} ${n1(tipY)}L${n1(sx)} ${n1(top + 4)}V74Z`;
    right += `M${n1(sx)} 74V${n1(top + 4)}L${n1(x + lean)} ${n1(tipY)}L${n1(x + w)} ${n1(top)}V74Z`;
    caps += `M${n1(x - w)} ${n1(top)}L${n1(x + lean)} ${n1(tipY)}L${n1(x + w)} ${n1(top)}L${n1(sx)} ${n1(top + 4)}Z`;
  }
  let sparks = '';
  for (let i = 0; i < 4; i++) sparks += sparklePath(between(rng, 8, 92), between(rng, 6, 44), between(rng, 1.8, 3.6));
  return (
    <>
      <ellipse cx="50" cy="64" rx="46" ry="10" fill={p.glow} opacity=".35" />
      <path d={left} fill={p.acc[2]} />
      <path d={right} fill={p.acc[0]} />
      <path d={caps} fill={p.acc[3]} opacity=".9" />
      <path d={sparks} fill="#fff" />
    </>
  );
}

/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */
/* Land scenery (CR 305.6: Plains, Island, Swamp, Mountain, Forest)                                                                                      */
/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */

function mountain(rng: Rng, p: Pal): ReactNode {
  const far = peaks(rng, 42, 8, 18, 6);
  const near = peaks(rng, 58, 10, 24, 5);
  const crack = `M${n1(between(rng, 20, 40))} 54l3 5-3 4 4 6M${n1(between(rng, 58, 78))} 52l-3 5 3 4-3 6`;
  return (
    <>
      <path d={cloudPath(between(rng, 30, 70), 14, 9) + cloudPath(between(rng, 20, 80), 20, 6)} fill={p.dark} opacity=".55" />
      <path d={far.shape} fill={p.mid} opacity=".9" />
      <path d={far.lit} fill={p.light} opacity=".22" />
      <path d={near.shape} fill={p.dark} />
      <path d={near.lit} fill={p.mid} opacity=".6" />
      <path d={crack} fill="none" stroke={p.acc[2]} strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round" />
      <path d={dots(rng, 10, 20, 80, 8, 44, 0.4, 1)} fill={p.acc[2]} opacity=".9" />
      <path d={wavy(rng, 68, 1.5, 4, 72).area} fill={p.deep} />
    </>
  );
}

function forest(rng: Rng, p: Pal): ReactNode {
  const sx = between(rng, 58, 90);
  return (
    <>
      <path d={raysPath(sx, -8, 5, 100, 0.06, 1.57 - 0.45)} fill={p.glow} opacity=".15" />
      <path d={pines(rng, 52, 14, 24, 11)} fill={p.acc[1]} />
      <ellipse cx="50" cy="50" rx="62" ry="6" fill={p.glow} opacity=".16" />
      <path d={pines(rng, 64, 24, 40, 6)} fill={p.acc[0]} />
      <path d={wavy(rng, 66, 2, 5, 72).area} fill={p.deep} />
      <path d={dots(rng, 10, 8, 92, 36, 62, 0.35, 0.9)} fill={p.glow} opacity=".85" />
    </>
  );
}

function island(rng: Rng, p: Pal): ReactNode {
  const ix = between(rng, 56, 82);
  const isle = `M${n1(ix - 16)} 40Q${n1(ix - 8)} 28 ${n1(ix)} 31Q${n1(ix + 8)} 26 ${n1(ix + 16)} 40Z`;
  const bands = [wavy(rng, 41, 1.2, 6, 72), wavy(rng, 48, 1.8, 6, 72), wavy(rng, 56, 2.2, 5, 72), wavy(rng, 64, 2.6, 4, 72)];
  let glints = '';
  for (let i = 0; i < 9; i++) {
    const y = 43 + i * 2.8;
    glints += `M${n1(between(rng, 20, 70))} ${n1(y)}h${n1(between(rng, 3, 9))}`;
  }
  return (
    <>
      <path d={cloudPath(between(rng, 14, 36), 16, 8) + cloudPath(between(rng, 60, 86), 12, 7)} fill="#fff" opacity=".22" />
      <path d={isle} fill={p.deep} opacity=".8" />
      <path d={bands[0]!.area} fill={p.acc[3]} />
      <path d={bands[1]!.area} fill={p.acc[2]} />
      <path d={bands[2]!.area} fill={p.acc[1]} />
      <path d={bands[3]!.area} fill={p.acc[0]} />
      <path d={bands[0]!.line} fill="none" stroke="#fff" strokeWidth=".5" opacity=".45" />
      <path d={glints} fill="none" stroke={p.glow} strokeWidth=".7" strokeLinecap="round" opacity=".75" />
    </>
  );
}

function swamp(rng: Rng, p: Pal): ReactNode {
  let trunks = '';
  let twigs = '';
  const xs = [between(rng, 10, 24), between(rng, 44, 58), between(rng, 76, 90)];
  for (const x of xs) {
    const top = between(rng, 14, 30);
    const lean = between(rng, -6, 6);
    trunks += `M${n1(x)} 70C${n1(x - 3)} 56 ${n1(x + 3)} 46 ${n1(x + lean)} ${n1(top)}`;
    twigs += `M${n1(x + lean * 0.3)} 44q-8 -3 -10 -11M${n1(x + lean * 0.6)} 36q8 -3 11 -11M${n1(x + lean)} ${n1(top + 4)}q-5 -2 -6 -8`;
  }
  let reeds = '';
  for (let i = 0; i < 18; i++) {
    const x = between(rng, 2, 98);
    reeds += `M${n1(x)} 72l${n1(between(rng, -2, 2))} ${n1(-between(rng, 6, 12))}`;
  }
  const wx = [between(rng, 24, 40), between(rng, 56, 72), between(rng, 40, 60)];
  const wy = [between(rng, 48, 56), between(rng, 44, 52), between(rng, 58, 62)];
  const wisps = wx.map((x, i) => circlePath(x, wy[i]!, 0.9)).join('');
  const halos = wx.map((x, i) => circlePath(x, wy[i]!, 3.2)).join('');
  return (
    <>
      <ellipse cx="50" cy="46" rx="66" ry="7" fill={p.light} opacity=".14" />
      <path d={trunks} fill="none" stroke={p.deep} strokeWidth="2.8" strokeLinecap="round" />
      <path d={twigs} fill="none" stroke={p.deep} strokeWidth="1.1" strokeLinecap="round" />
      <path d={wavy(rng, 57, 1.2, 6, 72).area} fill={p.dark} />
      <ellipse cx="50" cy="60" rx="60" ry="5" fill={p.light} opacity=".12" />
      <path d={halos} fill="hsl(130 80% 62%)" opacity=".2" />
      <path d={wisps} fill="hsl(120 90% 80%)" />
      <path d={reeds} fill="none" stroke={p.deep} strokeWidth=".9" strokeLinecap="round" />
    </>
  );
}

function plains(rng: Rng, p: Pal): ReactNode {
  const sx = between(rng, 40, 64);
  const h1 = wavy(rng, 46, 2.6, 5, 72);
  const h2 = wavy(rng, 54, 3, 5, 72);
  const h3 = wavy(rng, 62, 3, 4, 72);
  let wheat = '';
  for (let i = 0; i < 34; i++) {
    const x = between(rng, 2, 98);
    const y = between(rng, 58, 72);
    wheat += `M${n1(x)} ${n1(y)}l${n1(between(rng, -1.5, 1.5))} -5`;
  }
  return (
    <>
      <path d={raysPath(sx, 38, 12, 80, 0.05, between(rng, 0, 1))} fill="#fff" opacity=".3" />
      <circle cx={n1(sx)} cy="38" r="5" fill="#fff" />
      <path d={cloudPath(between(rng, 14, 30), 16, 7) + cloudPath(between(rng, 70, 88), 22, 8)} fill="#fff" opacity=".85" />
      <path d={h1.area} fill="hsl(78 38% 70%)" />
      <path d={h2.area} fill="hsl(62 44% 62%)" />
      <path d={`M${n1(between(rng, 30, 50))} 72Q${n1(between(rng, 44, 56))} 60 ${n1(between(rng, 56, 70))} 52`} fill="none" stroke="hsl(40 40% 82%)" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      <path d={h3.area} fill="hsl(50 52% 52%)" />
      <path d={wheat} fill="none" stroke="hsl(44 90% 72%)" strokeWidth=".7" strokeLinecap="round" />
    </>
  );
}

function terra(rng: Rng, p: Pal): ReactNode {
  let stones = '';
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const x = 14 + (72 / (n - 1)) * i + between(rng, -4, 4);
    const w = between(rng, 5, 9);
    const h = between(rng, 18, 34);
    stones += `M${n1(x - w)} 66L${n1(x - w * 0.8)} ${n1(66 - h)}L${n1(x + w * 0.1)} ${n1(66 - h - 3)}L${n1(x + w * 0.8)} ${n1(66 - h + 2)}L${n1(x + w)} 66Z`;
  }
  return (
    <>
      <path d={peaks(rng, 46, 4, 10, 7).shape} fill={p.mid} opacity=".6" />
      <path d={stones} fill={p.dark} />
      <path d={wavy(rng, 64, 1.5, 5, 72).area} fill={p.deep} />
      <path d={dots(rng, 8, 8, 92, 8, 40, 0.3, 0.8)} fill={p.glow} opacity=".7" />
    </>
  );
}

/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */

export function motifOf(flavor: Flavor, land: boolean, rng: Rng, p: Pal): ReactNode {
  switch (flavor) {
    case 'R':
      return land ? mountain(rng, p) : fire(rng, p);
    case 'U':
      return land ? island(rng, p) : water(rng, p);
    case 'G':
      return land ? forest(rng, p) : nature(rng, p);
    case 'B':
      return land ? swamp(rng, p) : smoke(rng, p);
    case 'W':
      return land ? plains(rng, p) : radiant(rng, p);
    case 'steel':
      return steel(rng, p);
    case 'crystal':
      return crystal(rng, p);
    case 'terra':
      return terra(rng, p);
  }
}

/** Where the scene's light sits (fractions of the box): the sun or moon of a land, the heart of a spell. */
export function glowAt(flavor: Flavor, land: boolean, rng: Rng): { x: number; y: number; r: number } {
  const x = between(rng, 32, 68);
  if (flavor === 'steel') return { x: 80, y: 30, r: 34 };
  if (land) return { x, y: between(rng, 28, 36), r: 34 };
  if (flavor === 'R') return { x, y: between(rng, 44, 52), r: 40 };
  if (flavor === 'B') return { x: between(rng, 56, 76), y: 19, r: 28 };
  if (flavor === 'G') return { x: between(rng, 58, 90), y: 6, r: 38 };
  if (flavor === 'W') return { x, y: 31, r: 38 };
  return { x, y: between(rng, 24, 34), r: 32 };
}

/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */
/* Type overlays: what the spell is, drawn over the scene                                                                                              */
/* ---------------------------------------------------------------------------------------------------------------------------------------------------- */

/** The kinds of creature the overlay can draw: picked from the creature subtypes (CR 205.3m), otherwise at random. */
export type Arch = 'human' | 'cloaked' | 'winged' | 'beast' | 'horned' | 'construct' | 'tentacled' | 'shambler' | 'arachnid' | 'treefolk' | 'serpent';

const ARCH_WORDS: ReadonlyArray<readonly [Arch, RegExp]> = [
  ['cloaked', /(Rogue|Assassin|Ninja|Warlock|Witch|Cleric|Monk|Shaman|Druid|Cultist|Necromancer|Mystic)/],
  ['winged', /\b(Dragon|Drake|Angel|Bird|Phoenix|Sphinx|Wyvern|Griffin|Pegasus|Bat|Harpy|Gargoyle|Avatar|Archon|Eagle|Hawk|Owl|Thopter|Seraph|Faerie|Fairy|Pixie)\b/],
  ['construct', /\b(Construct|Golem|Robot|Myr|Juggernaut|Scarecrow|Servo|Automaton|Assembly-Worker)\b/],
  ['serpent', /\b(Snake|Serpent|Basilisk|Naga|Worm|Wurm|Hydra|Eel|Leech|Slug|Lamia)\b/],
  ['tentacled', /\b(Kraken|Octopus|Leviathan|Horror|Squid|Jellyfish|Eldrazi|Elder|Beholder|Fish|Shark|Whale|Crab)\b/],
  ['arachnid', /\b(Spider|Insect|Scorpion|Beetle|Wasp|Ant|Scarab|Hornet|Drone|Mite|Locust)\b/],
  ['treefolk', /\b(Treefolk|Plant|Fungus|Dryad|Saproling|Ent|Mushroom)\b/],
  ['shambler', /\b(Zombie|Skeleton|Wraith|Spirit|Ghost|Specter|Spectre|Shade|Vampire|Lich|Ghoul|Nightmare|Mummy|Phantom|Shadow|Revenant|Wight|Elemental|Incarnation)\b/],
  ['horned', /\b(Demon|Devil|Ogre|Giant|Goblin|Minotaur|Troll|Imp|Orc|Gremlin|Kobold|Satyr|Cyclops|Oni|Hellion|Efreet|Djinn|Berserker|Rhino)\b/],
  ['beast', /\b(Wolf|Dog|Cat|Elk|Bear|Boar|Lion|Hound|Beast|Rat|Horse|Elephant|Ape|Deer|Ox|Bull|Hyena|Jackal|Fox|Tiger|Panther|Mammoth|Turtle|Lizard|Crocodile|Dinosaur|Rabbit|Unicorn|Goat|Ram|Squirrel|Badger|Mouse|Hippo|Camel|Yeti|Cow|Pig|Mount)\b/],
];
const STAFF = /\b(Wizard|Cleric|Shaman|Druid|Advisor|Monk|Sage|Mystic|Warlock|Witch|Priest|Mage|Artificer|Illusionist)\b/;
const BLADE = /\b(Knight|Warrior|Soldier|Samurai|Rogue|Assassin|Archer|Berserker|Pirate|Mercenary|Paladin|Ninja|Scout|Rebel|Gladiator)\b/;

/** The creature kind of a type line (its subtypes decide) and the thing its figure carries. */
export function archOf(typeLine: string, rng: Rng): { arch: Arch; carries: 'staff' | 'blade' | null } {
  const subtypes = typeLine.split('—')[1] ?? '';
  const hit = ARCH_WORDS.find(([, re]) => re.test(subtypes))?.[0];
  const pick = (): Arch => (['human', 'horned', 'shambler', 'beast'] as const)[Math.floor(rng() * 4)]!;
  const arch = hit ?? (subtypes.trim() === '' ? pick() : rng() < 0.75 ? 'human' : pick());
  return { arch, carries: arch !== 'human' && arch !== 'cloaked' ? null : STAFF.test(subtypes) ? 'staff' : BLADE.test(subtypes) ? 'blade' : null };
}

interface Figure {
  d: string;
  /** Strokes (limbs, tentacles) drawn thick in the silhouette color. */
  line?: string;
  lw?: number;
  eyes: readonly (readonly [number, number])[];
  eyeR?: number;
}

const FIGURES: Record<Arch, Figure> = {
  human: {
    d: `${circlePath(50, 30, 6.4)}M46 33H54V47H46ZM44 45C36 47 30 50 27 54C24 58 22 64 22 72H78C78 64 76 58 73 54C70 50 64 47 56 45Z`,
    eyes: [[47.7, 29.6], [52.3, 29.6]],
    eyeR: 0.8,
  },
  cloaked: {
    d: 'M26 72C28 58 34 49 42 45C40 36 43 25 50 25C57 25 60 36 58 45C66 49 72 58 74 72Z',
    eyes: [[47.6, 33], [52.4, 33]],
    eyeR: 0.9,
  },
  winged: {
    d: 'M50 44C42 28 24 16 4 16C12 24 14 32 12 42C18 38 24 38 28 46C32 40 38 40 42 48C44 46 47 46 50 48C53 46 56 46 58 48C62 40 68 40 72 46C76 38 82 38 88 42C86 32 88 24 96 16C76 16 58 28 50 44ZM46 46H54L53 60C52 66 51 70 50 74C49 70 48 66 47 60ZM45 44C45 34 47 28 50 24C53 28 55 34 55 44ZM46 30L43 20L48 27ZM54 30L57 20L52 27Z',
    eyes: [[48.4, 33], [51.6, 33]],
    eyeR: 0.8,
  },
  beast: {
    d: 'M10 62C10 51 21 46 33 46C41 46 49 46 55 42C57 36 59 30 63 26L65 19L69 26C72 25 76 27 78 31L85 36L78 38C76 42 72 44 68 45C66 49 66 53 66 58L67 72H62L60 60C56 58 50 58 44 60L43 72H38L37 60C30 60 26 62 24 66L22 72H17L19 66C13 66 10 65 10 62Z',
    eyes: [[72.5, 31]],
    eyeR: 1.2,
  },
  horned: {
    d: 'M44 52C34 54 26 57 22 62C18 66 16 70 16 72H84C84 70 82 66 78 62C74 57 66 54 56 52ZM38 72C38 58 41 50 43 43C46 38 54 38 57 43C59 50 62 58 62 72ZM42 41C34 41 27 35 25 24C31 31 38 33 46 36ZM58 41C66 41 73 35 75 24C69 31 62 33 54 36Z',
    eyes: [[47, 45], [53, 45]],
  },
  construct: {
    d: 'M31 72V47H24V37H35V31H41V23H59V31H65V37H76V47H69V72H56V58H44V72Z',
    eyes: [[45.5, 30], [54.5, 30]],
    eyeR: 1.3,
  },
  tentacled: {
    d: 'M30 46C30 22 70 22 70 46C70 50 66 52 62 50C60 54 56 54 54 50C52 56 48 56 46 50C44 54 40 54 38 50C34 52 30 50 30 46Z',
    line: 'M34 50C26 58 36 64 26 72M44 54C42 62 50 66 42 72M56 54C58 62 50 66 58 72M66 50C74 58 64 64 74 72',
    lw: 3.2,
    eyes: [[43.5, 38], [56.5, 38]],
    eyeR: 1.5,
  },
  shambler: {
    d: 'M26 72L30 50L18 44L22 40L34 44C36 36 42 28 44 26C44 20 48 16 50 16C52 16 56 20 56 26C58 28 64 36 66 44L78 40L82 44L70 50L74 72L66 66L62 72L56 66L50 72L44 66L38 72L34 66Z',
    eyes: [[48, 26], [52, 26]],
    eyeR: 0.9,
  },
  arachnid: {
    d: `${circlePath(50, 53, 11)}${circlePath(50, 37, 6)}`,
    line: 'M44 48L26 38L14 52L12 72M43 52L22 52L12 66M57 48L74 38L86 52L88 72M57 52L78 52L88 66M45 40L34 28L22 30M55 40L66 28L78 30',
    lw: 1.7,
    eyes: [[48.3, 35.6], [51.7, 35.6], [47.6, 38.2], [52.4, 38.2]],
    eyeR: 0.7,
  },
  treefolk: {
    d: 'M40 72C42 60 40 52 38 44C34 40 30 34 35 30C33 24 39 17 45 19C47 12 56 12 58 19C64 17 71 24 67 30C72 34 68 40 62 44C60 52 58 60 60 72Z',
    line: 'M40 58L22 48M60 58L78 48',
    lw: 2.6,
    eyes: [[46.5, 50], [53.5, 50]],
    eyeR: 1.1,
  },
  serpent: {
    d: 'M51 21C57 17 66 21 67 26C63 29 57 30 52 28Z',
    line: 'M20 72C24 58 44 62 50 52C56 42 38 40 44 31C45 28 48 26 53 26',
    lw: 6,
    eyes: [[60, 23.6]],
    eyeR: 1.1,
  },
};

/** The overlay of a spell's main type. The planeswalker's pillar uses the linear gradient `gradId` (CardArt draws it). */
export function overlayOf(type: ArtType, typeLine: string, rng: Rng, p: Pal, gradId: string): ReactNode {
  switch (type) {
    case 'creature': {
      const { arch, carries } = archOf(typeLine, rng);
      const fig = FIGURES[arch];
      const s = between(rng, 0.9, 1.12);
      const tx = between(rng, -9, 9);
      const sx = rng() < 0.5 ? -1 : 1;
      // The figure's feet are at y = 72 in its own box; they stand at 66 on the scene, so a wide, short art box still shows the whole figure.
      const tf = `translate(${n1(50 + tx)} 66) scale(${n1(sx * s)} ${n1(s)}) translate(-50 -72)`;
      const eyes = fig.eyes.map(([x, y]) => circlePath(x, y, fig.eyeR ?? 1.1)).join('');
      return (
        <g transform={tf}>
          {fig.line ? <path d={fig.line} fill="none" stroke={p.deep} strokeWidth={fig.lw} strokeLinecap="round" strokeLinejoin="round" /> : null}
          <path d={fig.d} fill="none" stroke={p.glow} strokeOpacity=".45" strokeWidth="1.3" strokeLinejoin="round" />
          <path d={fig.d} fill={p.deep} />
          {carries === 'staff' ? (
            <>
              <path d="M75 72V26" stroke={p.deep} strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="75" cy="23.5" r="3" fill={p.glow} />
            </>
          ) : null}
          {carries === 'blade' ? (
            <>
              <path d="M22.5 60L24 26L25.5 60Z" fill={p.light} stroke={p.deep} strokeWidth=".6" />
              <path d="M20 60H28M24 60V68" stroke={p.deep} strokeWidth="1.6" strokeLinecap="round" />
            </>
          ) : null}
          <path d={eyes} fill={p.glow} />
        </g>
      );
    }
    case 'instant': {
      const x = between(rng, 40, 64);
      const pts = [
        [x + 8, -4],
        [x + 1, 14],
        [x + 6, 19],
        [x - 5, 38],
        [x, 42],
        [x - 12, 74],
      ];
      const d = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${n1(px!)} ${n1(py!)}`).join('');
      return (
        <>
          <path d={d} fill="none" stroke={p.light} strokeWidth="7" strokeLinejoin="round" opacity=".28" />
          <path d={d} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="miter" />
        </>
      );
    }
    case 'sorcery': {
      let runes = '';
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        runes += circlePath(50 + Math.cos(a) * 36, 58 + Math.sin(a) * 7.4, 0.75);
      }
      return (
        <>
          <ellipse cx="50" cy="58" rx="40" ry="8.4" fill="none" stroke={p.light} strokeWidth=".9" opacity=".85" />
          <ellipse cx="50" cy="58" rx="28" ry="5.8" fill="none" stroke={p.glow} strokeWidth=".6" opacity=".6" />
          <path d={runes} fill={p.glow} opacity=".9" />
        </>
      );
    }
    case 'enchantment': {
      const cy = between(rng, 24, 30);
      return (
        <>
          <path d={raysPath(50, cy, 14, 34, 0.03, between(rng, 0, 1))} fill={p.glow} opacity=".35" />
          <circle cx="50" cy={n1(cy)} r="16" fill="none" stroke={p.glow} strokeWidth="1" opacity=".85" />
          <circle cx="50" cy={n1(cy)} r="11.5" fill="none" stroke={p.light} strokeWidth=".5" opacity=".6" />
          <path d={sparklePath(50, cy, 4.5) + sparklePath(70, cy - 14, 2.2) + sparklePath(31, cy + 12, 2)} fill="#fff" />
        </>
      );
    }
    case 'planeswalker':
      return (
        <>
          <rect x="43" y="-2" width="14" height="76" fill={`url(#${gradId})`} opacity=".7" />
          <path d="M50 17 59 28 50 46 41 28Z" fill={p.glow} stroke="#fff" strokeWidth=".6" />
          <path d="M41 28H59L50 46Z" fill="#000" opacity=".22" />
          <path d={sparklePath(30, 20, 3) + sparklePath(72, 34, 2.4) + sparklePath(62, 12, 2)} fill="#fff" />
        </>
      );
    case 'battle':
      return (
        <>
          <path d="M20 72 68 6M80 72 32 6" fill="none" stroke={p.deep} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M68 6 62 17 70 14ZM32 6 30 18 38 12Z" fill={p.light} stroke={p.deep} strokeWidth=".5" />
          <path d="M45 30 66 25 62 32 66 39 45 41Z" fill={p.mid} stroke={p.deep} strokeWidth=".6" />
        </>
      );
    case 'artifact': {
      const gx = between(rng, 76, 90);
      return <path d={gearPath(gx, 56, 15, 11, 9, 4.5)} fill={p.deep} fillOpacity=".62" fillRule="evenodd" stroke={p.light} strokeOpacity=".5" strokeWidth=".6" />;
    }
    case 'land':
      return null;
  }
}
