/**
 * The Reality Fracture template's background scene (profiles/FractureScene.tsx): the sky behind the Home screen, our own art drawn on a canvas after the
 * Reality Fracture set's Echoverse and its Shattered Mirror cards. The whole sky is a mirror the logo broke through: a ragged hole round the logo (its
 * hexagonal mirror frame stands in it, theme/fracture.css), the mirror broken into big pieces lying a little apart, the pieces round the hole pushed
 * back and turned, their cut edges lit (those facing the hole by its light), as the card sleeves of this look are broken (profiles/fractureSleeve.ts).
 * A line through the logo splits the sky into the warm "real" side and its echo, the same sky in the cold colors. Small pieces circle the logo and break
 * off the hole's rim to drift away, turning and catching the light (a slow glint, never a flash); motes of light leave the rim, rising on the real side
 * and falling on the echo side (gravity is mirrored too); the frame sends out echoes of itself, and now and then a light runs along a cut edge.
 *
 * Colors come from the profile's palette. The simulation is deterministic for a seed (no Math.random), so a still frame (reduced motion, or the
 * profile's backgrounds still) is always the same moment.
 */

export interface Pt {
  x: number;
  y: number;
}

/** The palette the scene is drawn in (#rrggbb): the template's slots that light the sky. */
export interface SceneColors {
  mind: string;
  echo: string;
  memory: string;
  void: string;
}

export type Side = 'real' | 'echo';

/** A piece of the broken mirror, in pixels. */
export interface Piece {
  poly: Pt[];
  /** Its middle. */
  c: Pt;
  /** How near the hole it lies (1 at the rim, pushed back the most; 0 far off, resting). */
  near: number;
  /** How much light its face catches (0 to 1). */
  shine: number;
}

export interface Shard {
  /** The outline around its middle, in units of `size`. */
  pts: Pt[];
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Turn in the screen's plane, and its speed. */
  rot: number;
  vrot: number;
  /** The turn about its own axis (the glass flips over), its speed, the axis's direction, and the turn at which it faces the light. */
  flip: number;
  vflip: number;
  axis: number;
  glintAt: number;
  /** 0 far (small, faint, slow parallax) to 1 near. */
  z: number;
  /** Seconds since it broke off (it fades in). */
  age: number;
  /** A shard circling the logo: its place on the orbit and the orbit. */
  orbit: { a: number; speed: number; rx: number; ry: number; tilt: number } | null;
}

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  total: number;
  size: number;
  side: Side;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  /** On the real side of the line (set by placeStars). */
  real: boolean;
}

export interface Scene {
  w: number;
  h: number;
  t: number;
  /** The logo's middle, in screen fractions: the hole, the orbit and the line between the worlds are centered on it. */
  center: Pt;
  /** The line the two worlds meet along runs through the logo, leaning this far from upright (radians, its top toward the right). */
  lean: number;
  pieces: Piece[];
  /** The hole's reach from the logo's middle (pixels), at HOLE_SAMPLES angles evenly round it from the right. */
  hole: number[];
  shards: Shard[];
  motes: Mote[];
  stars: Star[];
  /** Ages of the echoes the frame sends out, in seconds. */
  ripples: number[];
  nextRipple: number;
  /** A light running along a cut edge: the piece, the edge, how far it has run (0 to 1); and when the next one starts. */
  run: { piece: number; edge: number; k: number } | null;
  nextRun: number;
  /** Where the pointer is, -1 to 1 on each axis, and where the view has followed it to (parallax). */
  pointer: Pt;
  view: Pt;
  moteClock: number;
  seed: number;
  rand: () => number;
}

/** mulberry32: a small, good-enough seeded generator. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const SHARDS_FREE = 22;
const SHARDS_ORBIT = 16;
const MAX_MOTES = 80;
const RIPPLE_LIFE = 5.5;
const RUN_TIME = 1.6;
const HOLE_SAMPLES = 72;
const LEAN = 0.12;

// ---- The broken mirror -----------------------------------------------------------------------------------------------------------------

/** The part of a convex polygon where (p - a) · n <= 0. */
function clip(poly: Pt[], a: Pt, n: Pt): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (p.x - a.x) * n.x + (p.y - a.y) * n.y;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  });
  return out;
}

function area(poly: Pt[]): number {
  let s = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  });
  return Math.abs(s) / 2;
}

function centroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  let s = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    const k = p.x * q.y - q.x * p.y;
    x += (p.x + q.x) * k;
    y += (p.y + q.y) * k;
    s += k;
  });
  return { x: x / (3 * s), y: y / (3 * s) };
}

/** A convex polygon's outward normal on each side (side i runs from point i to point i + 1). */
export function normals(poly: Pt[]): Pt[] {
  const c = centroid(poly);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const m = { x: (a.x + b.x) / 2 - c.x, y: (a.y + b.y) / 2 - c.y };
    return n.x * m.x + n.y * m.y < 0 ? { x: -n.x, y: -n.y } : n;
  });
}

/** A convex polygon drawn in by `d` on every side. */
function inset(poly: Pt[], d: number): Pt[] {
  const ns = normals(poly);
  return poly.map((v, i) => {
    const n0 = ns[(i - 1 + poly.length) % poly.length]!;
    const n1 = ns[i]!;
    const k = Math.min(3, 1 / Math.max(0.2, (1 + n0.x * n1.x + n0.y * n1.y) / 2));
    return { x: v.x - ((n0.x + n1.x) / 2) * d * k, y: v.y - ((n0.y + n1.y) / 2) * d * k };
  });
}

/**
 * A rectangle broken the way glass breaks: again and again the biggest piece (counting those near `focus`, where the blow fell, as bigger) is split by a
 * straight crack through somewhere near its middle at any angle, so the pieces come out as sharp, uneven triangles and slivers, and cracks end where
 * they meet older ones.
 */
export function breakGlass(w: number, h: number, focus: Pt, count: number, rand: () => number): Pt[][] {
  const m = 40;
  const pieces: Pt[][] = [
    [
      { x: -m, y: -m },
      { x: w + m, y: -m },
      { x: w + m, y: h + m },
      { x: -m, y: h + m },
    ],
  ];
  const reach = Math.min(w, h) * 0.45;
  const weight = (p: Pt[]) => {
    const c = centroid(p);
    return area(p) * (1 + 2.8 * Math.exp(-((Math.hypot(c.x - focus.x, c.y - focus.y) / reach) ** 2)));
  };
  for (let guard = 0; pieces.length < count && guard < 4000; guard++) {
    let best = 0;
    pieces.forEach((p, i) => {
      if (weight(p) > weight(pieces[best]!)) best = i;
    });
    const piece = pieces[best]!;
    const c = centroid(piece);
    const size = Math.sqrt(area(piece));
    const ang = rand() * Math.PI;
    const n = { x: Math.cos(ang), y: Math.sin(ang) };
    const off = (rand() - 0.5) * 0.5 * size;
    const at = { x: c.x + n.x * off, y: c.y + n.y * off };
    const a = clip(piece, at, n);
    const b = clip(piece, at, { x: -n.x, y: -n.y });
    const aa = area(a);
    const ab = area(b);
    if (a.length < 3 || b.length < 3 || Math.min(aa, ab) < 0.22 * (aa + ab)) continue;
    pieces.splice(best, 1, a, b);
  }
  return pieces;
}

/** How far the hole reaches from the logo's middle at `angle` (pixels). */
export function holeAt(s: Scene, angle: number): number {
  const k = ((((angle % TAU) + TAU) % TAU) / TAU) * HOLE_SAMPLES;
  const i = Math.floor(k) % HOLE_SAMPLES;
  const f = k - Math.floor(k);
  return s.hole[i]! * (1 - f) + s.hole[(i + 1) % HOLE_SAMPLES]! * f;
}

/** Breaks the mirror for the scene's size and logo: the same break for the same seed, size and logo. */
function breakMirror(s: Scene): void {
  const r = seeded(s.seed * 13 + 5);
  const { w, h } = s;
  const cx = s.center.x * w;
  const cy = s.center.y * h;
  const base = Math.min(w, h) * 0.215;
  const p1 = r() * TAU;
  const p2 = r() * TAU;
  const p3 = r() * TAU;
  s.hole = Array.from({ length: HOLE_SAMPLES }, (_, i) => {
    const a = (i / HOLE_SAMPLES) * TAU;
    return base * (1 + 0.14 * Math.sin(2 * a + p1) + 0.09 * Math.sin(3 * a + p2) + 0.06 * Math.sin(5 * a + p3));
  });
  const count = Math.round(Math.max(22, Math.min(42, (w * h) / 38000)));
  const cells = breakGlass(w, h, { x: cx, y: cy }, count, r);
  const fade = Math.min(w, h) * 0.3;
  s.pieces = [];
  for (const cell of cells) {
    const c = centroid(cell);
    const d = Math.hypot(c.x - cx, c.y - cy);
    const rim = holeAt(s, Math.atan2(c.y - cy, c.x - cx));
    if (d < rim) continue;
    const near = Math.max(0, 1 - (d - rim) / fade);
    // Pushed back from the hole and turned, the more the nearer it lies.
    const push = near * 11;
    const turn = ((r() - 0.5) * near * 7 * Math.PI) / 180;
    const ox = ((c.x - cx) / (d || 1)) * push;
    const oy = ((c.y - cy) / (d || 1)) * push;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const poly = inset(cell, 3).map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin + ox, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos + oy }));
    s.pieces.push({ poly, c: centroid(poly), near, shine: r() });
  }
}

/** Which world a point (pixels) is in: left of the line through the logo is the real side, right of it the echo. */
export function sideOf(s: Scene, p: Pt): Side {
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  return p.x < cx + (cy - p.y) * Math.tan(s.lean) ? 'real' : 'echo';
}

/** The point (pixels) reflected across the line between the worlds: where the echo of something on the other side is. */
export function mirrorPoint(s: Scene, p: Pt): Pt {
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  // The line's direction, from the bottom up: up and a little to the right.
  const dx = Math.sin(s.lean);
  const dy = -Math.cos(s.lean);
  const k = (p.x - cx) * dx + (p.y - cy) * dy;
  const fx = cx + dx * k;
  const fy = cy + dy * k;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

function shardOutline(rand: () => number): Pt[] {
  const n = 3 + Math.floor(rand() * 3);
  const stretch = 1.2 + rand() * 1.1;
  const angles = Array.from({ length: n }, (_, i) => (i / n) * TAU + (rand() - 0.5) * (TAU / n) * 0.7).sort((p, q) => p - q);
  return angles.map((a) => {
    const r = 0.55 + rand() * 0.45;
    return { x: Math.cos(a) * r * stretch, y: Math.sin(a) * r };
  });
}

/** A free shard just broken off the hole's rim, thrown outward; `fresh` scatters it anywhere (the scene starts mid-flight). */
function breakShard(s: Scene, sh: Shard | null, fresh: boolean): Shard {
  const r = s.rand;
  const a = r() * TAU;
  const rim = holeAt(s, a);
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  const z = r();
  const speed = 6 + r() * 14 + z * 10;
  const out = sh ?? ({} as Shard);
  Object.assign(out, {
    pts: shardOutline(r),
    size: 6 + z * 26 + r() * 9,
    x: fresh ? r() * s.w : cx + Math.cos(a) * (rim + 4),
    y: fresh ? r() * s.h : cy + Math.sin(a) * (rim + 4),
    vx: Math.cos(a) * speed + (r() - 0.5) * 4,
    vy: Math.sin(a) * speed + (r() - 0.5) * 4,
    rot: r() * TAU,
    vrot: (r() - 0.5) * 0.5,
    flip: r() * TAU,
    vflip: (0.3 + r() * 0.9) * (r() < 0.5 ? -1 : 1),
    axis: r() * TAU,
    glintAt: r() * TAU,
    z,
    age: fresh ? 3 + r() * 6 : 0,
    orbit: null,
  });
  return out;
}

function orbitShard(s: Scene, i: number): Shard {
  const r = s.rand;
  const z = r();
  return {
    pts: shardOutline(r),
    size: 6 + r() * 15,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: r() * TAU,
    vrot: (r() - 0.5) * 0.7,
    flip: r() * TAU,
    vflip: (0.5 + r() * 1.1) * (r() < 0.5 ? -1 : 1),
    axis: r() * TAU,
    glintAt: r() * TAU,
    z,
    age: 10,
    orbit: { a: (i / SHARDS_ORBIT) * TAU + r() * 0.3, speed: (0.07 + r() * 0.05) * (i % 3 === 0 ? 0.8 : 1), rx: 0.2 + r() * 0.06, ry: 0.07 + r() * 0.03, tilt: -0.16 + r() * 0.06 },
  };
}

/** Where an orbiting shard is (pixels) and how near it is (0 behind the logo, 1 in front). */
export function orbitPlace(s: Scene, sh: Shard): { x: number; y: number; depth: number } {
  const o = sh.orbit!;
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  const span = Math.min(s.w, s.h * 1.6);
  const ex = Math.cos(o.a) * o.rx * span;
  const ey = Math.sin(o.a) * o.ry * span;
  return { x: cx + ex * Math.cos(o.tilt) - ey * Math.sin(o.tilt), y: cy + ex * Math.sin(o.tilt) + ey * Math.cos(o.tilt), depth: (Math.sin(o.a) + 1) / 2 };
}

export function createScene(w: number, h: number, seed = 2026, center: Pt = { x: 0.5, y: 0.33 }): Scene {
  const rand = seeded(seed);
  const s: Scene = {
    w,
    h,
    t: 0,
    center,
    lean: LEAN,
    pieces: [],
    hole: [],
    shards: [],
    motes: [],
    stars: [],
    ripples: [],
    nextRipple: 0.6,
    run: null,
    nextRun: 1.4,
    pointer: { x: 0, y: 0 },
    view: { x: 0, y: 0 },
    moteClock: 0,
    seed,
    rand,
  };
  breakMirror(s);
  for (let i = 0; i < SHARDS_FREE; i++) s.shards.push(breakShard(s, null, true));
  for (let i = 0; i < SHARDS_ORBIT; i++) s.shards.push(orbitShard(s, i));
  const stars = Math.round(Math.min(200, (w * h) / 7000));
  for (let i = 0; i < stars; i++) s.stars.push({ x: rand() * w, y: rand() * h, size: rand() < 0.85 ? 1 : 1.8, phase: rand() * TAU, speed: 0.4 + rand() * 1.4, real: true });
  placeStars(s);
  return s;
}

/** Which side of the line each star is on (its color). */
function placeStars(s: Scene): void {
  for (const st of s.stars) st.real = sideOf(s, st) === 'real';
}

/** Keep everything in place after a resize (or after the logo moved): the mirror is broken again from its own seed for the new size. */
export function resizeScene(s: Scene, w: number, h: number, center: Pt = s.center): void {
  const sx = w / (s.w || w);
  const sy = h / (s.h || h);
  for (const sh of s.shards) {
    sh.x *= sx;
    sh.y *= sy;
  }
  for (const m of s.motes) {
    m.x *= sx;
    m.y *= sy;
  }
  for (const st of s.stars) {
    st.x *= sx;
    st.y *= sy;
  }
  s.w = w;
  s.h = h;
  s.center = center;
  s.run = null;
  breakMirror(s);
  placeStars(s);
}

/** Advance the scene by `dt` seconds. */
export function stepScene(s: Scene, dt: number): void {
  s.t += dt;
  const r = s.rand;
  // The view follows the pointer slowly (parallax).
  const follow = Math.min(1, dt * 2.2);
  s.view.x += (s.pointer.x - s.view.x) * follow;
  s.view.y += (s.pointer.y - s.view.y) * follow;

  const margin = 80;
  for (const sh of s.shards) {
    sh.age += dt;
    sh.rot += sh.vrot * dt;
    sh.flip += sh.vflip * dt;
    if (sh.orbit) {
      sh.orbit.a += sh.orbit.speed * dt;
      continue;
    }
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    if (sh.x < -margin || sh.x > s.w + margin || sh.y < -margin || sh.y > s.h + margin) breakShard(s, sh, false);
  }

  // Motes leave the rim of the hole: up on the real side, down on the echo side.
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  s.moteClock += dt * 14;
  while (s.moteClock >= 1) {
    s.moteClock -= 1;
    if (s.motes.length >= MAX_MOTES) continue;
    const a = r() * TAU;
    const rim = holeAt(s, a);
    const at = { x: cx + Math.cos(a) * rim, y: cy + Math.sin(a) * rim };
    const side = sideOf(s, at);
    const v = 6 + r() * 16;
    const total = 3 + r() * 4;
    s.motes.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: (side === 'real' ? -1 : 1) * (2 + r() * 6), life: total, total, size: 0.8 + r() * 1.6, side });
  }
  for (const m of s.motes) {
    m.life -= dt;
    m.vy += (m.side === 'real' ? -9 : 9) * dt;
    m.vx *= 1 - dt * 0.4;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
  }
  s.motes = s.motes.filter((m) => m.life > 0);

  // The frame's echoes.
  s.ripples = s.ripples.map((x) => x + dt).filter((x) => x < RIPPLE_LIFE);
  s.nextRipple -= dt;
  if (s.nextRipple <= 0) {
    s.ripples.push(0);
    s.nextRipple = 5.5 + r() * 2;
  }

  // A light running along the cut edge of a piece near the hole.
  if (s.run) {
    s.run.k += dt / RUN_TIME;
    if (s.run.k >= 1) s.run = null;
  } else {
    s.nextRun -= dt;
    if (s.nextRun <= 0) {
      const near = s.pieces.map((p, i) => ({ p, i })).filter(({ p }) => p.near > 0.25);
      if (near.length) {
        const { p, i } = near[Math.floor(r() * near.length)]!;
        s.run = { piece: i, edge: Math.floor(r() * p.poly.length), k: 0 };
      }
      s.nextRun = 2.6 + r() * 3;
    }
  }
}

// ---- Drawing ------------------------------------------------------------------------------------------------------------------------

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `hex` with an alpha, as rgba(). */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** `a` mixed toward `b` by `k` (0 to 1), as #rrggbb. */
export function mix(a: string, b: string, k: number): string {
  const p = hexRgb(a);
  const q = hexRgb(b);
  const c = p.map((v, i) => Math.round(v + (q[i]! - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The two halves of the window, each as a path: the real side left of the line through the logo, the echo side right of it. */
function halfPath(ctx: CanvasRenderingContext2D, s: Scene, side: Side): void {
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  const xAt = (y: number) => cx + (cy - y) * Math.tan(s.lean);
  const edge = side === 'real' ? -20 : s.w + 20;
  ctx.beginPath();
  ctx.moveTo(edge, -20);
  ctx.lineTo(xAt(-20), -20);
  ctx.lineTo(xAt(s.h + 20), s.h + 20);
  ctx.lineTo(edge, s.h + 20);
  ctx.closePath();
}

/** The still sky (drawn once per size and palette into its own canvas): the void, the two worlds' washes, and nebulae with their mirror images. */
export function paintSky(ctx: CanvasRenderingContext2D, s: Scene, c: SceneColors): void {
  const { w, h } = s;
  ctx.fillStyle = c.void;
  ctx.fillRect(0, 0, w, h);
  // The real side, washed in warm light from the top left; the echo side in its own color from the bottom right.
  ctx.save();
  halfPath(ctx, s, 'real');
  const warm = ctx.createLinearGradient(0, 0, w * 0.6, h);
  warm.addColorStop(0, rgba(c.memory, 0.13));
  warm.addColorStop(0.55, rgba(c.mind, 0.04));
  warm.addColorStop(1, rgba(c.void, 0));
  ctx.fillStyle = warm;
  ctx.fill();
  ctx.restore();
  ctx.save();
  halfPath(ctx, s, 'echo');
  const cold = ctx.createLinearGradient(w, h, w * 0.4, 0);
  cold.addColorStop(0, rgba(c.echo, 0.22));
  cold.addColorStop(0.6, rgba(c.echo, 0.05));
  cold.addColorStop(1, rgba(c.void, 0));
  ctx.fillStyle = cold;
  ctx.fill();
  ctx.restore();
  // Nebulae on the real side, each with its echo across the line in the other world's color.
  const r = seeded(91);
  const big = Math.max(w, h);
  for (let i = 0; i < 6; i++) {
    let p: Pt = { x: r() * w * 0.5, y: r() * h };
    for (let tries = 0; tries < 8 && sideOf(s, p) !== 'real'; tries++) p = { x: r() * w * 0.5, y: r() * h };
    const radius = big * (0.12 + r() * 0.2);
    const alpha = 0.05 + r() * 0.06;
    const warmColor = i % 2 === 0 ? c.memory : c.mind;
    const echoColor = i % 2 === 0 ? c.echo : mix(c.mind, c.echo, 0.6);
    for (const [q, color] of [
      [p, warmColor],
      [mirrorPoint(s, p), echoColor],
    ] as [Pt, string][]) {
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, radius);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
  // Dark edges, so the light gathers in the middle.
  const v = ctx.createRadialGradient(w * 0.5, h * 0.4, Math.min(w, h) * 0.3, w * 0.5, h * 0.45, big * 0.78);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/**
 * The broken mirror (drawn once per size and palette into its own canvas, then laid over the sky with a breathing alpha): the light of the hole, each
 * piece's face catching a little of its world's light, and its cut edges, lit where they face the light at the top left or the hole, dark elsewhere.
 */
export function paintMirror(ctx: CanvasRenderingContext2D, s: Scene, c: SceneColors): void {
  const cx = s.center.x * s.w;
  const cy = s.center.y * s.h;
  const base = s.hole[0] ?? 100;
  // The light of the breakthrough, round the logo: pale, so over the dark it reads as light, not as a brown wash.
  const g = ctx.createRadialGradient(cx, cy, base * 0.4, cx, cy, base * 1.9);
  g.addColorStop(0, rgba(mix(c.memory, '#ffffff', 0.68), 0.3));
  g.addColorStop(0.45, rgba(mix(c.memory, '#ffffff', 0.3), 0.08));
  g.addColorStop(1, rgba(c.echo, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - base * 2, cy - base * 2, base * 4, base * 4);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of s.pieces) {
    const real = sideOf(s, p.c) === 'real';
    const tint = real ? c.memory : c.echo;
    // The face: clear glass catching a faint sheet of light, brighter on one side the way the piece tilts: the pale of the mind's light on the real side
    // (gold on the dark would go brown; the gold is kept for the edges), the echo's lilac on its side.
    const sheen = real ? mix(c.mind, '#ffffff', 0.72) : mix(c.echo, '#ffffff', 0.4);
    ctx.beginPath();
    p.poly.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    const box = p.poly.reduce((b, q) => ({ x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const face = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    face.addColorStop(0, rgba(sheen, 0.035 + 0.06 * p.shine + 0.05 * p.near));
    face.addColorStop(1, rgba(sheen, 0.01));
    ctx.fillStyle = face;
    ctx.fill();
    // The cut edges.
    const ns = normals(p.poly);
    const out = { x: (p.c.x - cx) / (Math.hypot(p.c.x - cx, p.c.y - cy) || 1), y: (p.c.y - cy) / (Math.hypot(p.c.x - cx, p.c.y - cy) || 1) };
    p.poly.forEach((a, i) => {
      const b = p.poly[(i + 1) % p.poly.length]!;
      const n = ns[i]!;
      const sun = -0.6 * n.x - 0.8 * n.y;
      const hole = p.near > 0.2 ? -(n.x * out.x + n.y * out.y) : 0;
      let color: string;
      let width: number;
      if (hole > 0.4) {
        color = rgba(mix(c.memory, '#ffffff', 0.55), 0.35 + 0.5 * hole * p.near);
        width = 1.6;
      } else if (sun > 0) {
        // Lit edges: on the real side warm gold light, brighter than the echo side's.
        color = real ? rgba(mix(c.memory, '#ffffff', 0.35), 0.22 + 0.5 * sun) : rgba(mix(tint, '#ffffff', 0.55), 0.14 + 0.38 * sun);
        width = real ? 1.5 : 1.2;
      } else {
        color = rgba(tint, 0.1);
        width = 1;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
  }
  // The real side's warmth: amber light from the top left, added as light (so over the dark it glows instead of going brown).
  const warm = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(s.w, s.h) * 0.75);
  warm.addColorStop(0, rgba(c.memory, 0.14));
  warm.addColorStop(0.55, rgba(c.memory, 0.05));
  warm.addColorStop(1, rgba(c.memory, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, s.w, s.h);
  ctx.restore();
}

/** A hexagon standing on its point (the logo's frame), `r` from the middle to its top. */
function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r * 0.9;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The frame's echoes: hexagons growing out from the logo and fading, each with a violet copy just behind it. */
function drawRipples(ctx: CanvasRenderingContext2D, s: Scene, c: SceneColors, ox: number, oy: number): void {
  const cx = s.center.x * s.w + ox;
  const cy = s.center.y * s.h + oy;
  const r0 = Math.min(s.w, s.h) * 0.175;
  for (const age of s.ripples) {
    const k = age / RIPPLE_LIFE;
    const grow = r0 * (1.05 + k * 2.2);
    const alpha = (1 - k) * (1 - k) * 0.4;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgba(c.memory, alpha);
    hexagon(ctx, cx, cy, grow);
    ctx.stroke();
    ctx.strokeStyle = rgba(c.echo, alpha * 0.8);
    hexagon(ctx, cx + 6, cy + 4, grow * 1.02);
    ctx.stroke();
  }
}

function drawShard(ctx: CanvasRenderingContext2D, s: Scene, sh: Shard, c: SceneColors, x: number, y: number, scale: number, fade: number): void {
  // Flipping over: the glass narrows across its axis; it catches the light when it faces it.
  const face = Math.cos(sh.flip);
  const glint = Math.pow(Math.max(0, Math.cos(sh.flip - sh.glintAt)), 14);
  // A shard of the mirror shows the other world: on the real side it holds the echo's color, and the other way round.
  const real = sideOf(s, { x, y }) === 'real';
  const [c1, c2] = real ? [c.echo, c.memory] : [c.memory, c.echo];
  const size = sh.size * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sh.axis);
  ctx.scale(1, 0.18 + 0.82 * Math.abs(face));
  ctx.rotate(sh.rot - sh.axis);
  ctx.scale(size, size);
  ctx.beginPath();
  sh.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  // Its face a pale wash of that color (a deep one would go muddy over the dark), its cut edge bright.
  const base = (0.07 + 0.13 * sh.z) * fade;
  ctx.globalAlpha = Math.min(1, base + glint * 0.45);
  ctx.fillStyle = mix(face >= 0 ? c1 : c2, '#ffffff', 0.55);
  ctx.fill();
  ctx.globalAlpha = Math.min(1, (0.38 + 0.4 * sh.z + glint * 0.6) * fade);
  ctx.lineWidth = 1.1 / size;
  ctx.strokeStyle = mix(face >= 0 ? c1 : c2, '#ffffff', 0.5);
  ctx.stroke();
  if (glint > 0.05) {
    // The glint: a streak of light across the glass.
    ctx.clip();
    ctx.globalAlpha = glint * 0.75 * fade;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(-1.6, -0.5);
    ctx.lineTo(1.6, 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** The light running along a cut edge: it gathers, runs and fades out instead of blinking on. */
function drawRun(ctx: CanvasRenderingContext2D, s: Scene, c: SceneColors, ox: number, oy: number): void {
  const run = s.run;
  const piece = run ? s.pieces[run.piece] : undefined;
  if (!run || !piece) return;
  const a = piece.poly[run.edge % piece.poly.length]!;
  const b = piece.poly[(run.edge + 1) % piece.poly.length]!;
  const strength = Math.sin(Math.PI * run.k);
  const at = (k: number) => ({ x: a.x + (b.x - a.x) * k + ox, y: a.y + (b.y - a.y) * k + oy });
  const head = at(run.k);
  const tail = at(Math.max(0, run.k - 0.3));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  g.addColorStop(0, rgba(c.memory, 0));
  g.addColorStop(1, rgba(mix(c.memory, '#ffffff', 0.6), 0.85 * strength));
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();
  const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 20);
  halo.addColorStop(0, rgba('#ffffff', 0.5 * strength));
  halo.addColorStop(0.4, rgba(c.memory, 0.2 * strength));
  halo.addColorStop(1, rgba(c.memory, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(head.x - 20, head.y - 20, 40, 40);
  ctx.restore();
}

/** Draws one frame. `sky` and `mirrorLayer` are the canvases paintSky and paintMirror drew (null: drawn here, slower). */
export function drawScene(ctx: CanvasRenderingContext2D, s: Scene, c: SceneColors, sky: CanvasImageSource | null, mirrorLayer: CanvasImageSource | null): void {
  const { w, h } = s;
  const px = s.view.x;
  const py = s.view.y;
  // The sky moves least, the near shards most.
  if (sky) ctx.drawImage(sky, -px * 6 - 8, -py * 4 - 6, w + 16, h + 12);
  else paintSky(ctx, s, c);
  const realStar = mix(c.memory, '#ffffff', 0.6);
  const echoStar = mix(c.echo, '#ffffff', 0.5);
  for (const st of s.stars) {
    ctx.globalAlpha = 0.55 * (0.55 + 0.45 * Math.sin(s.t * st.speed + st.phase));
    ctx.fillStyle = st.real ? realStar : echoStar;
    ctx.fillRect(st.x - px * 3, st.y - py * 2, st.size, st.size);
  }
  ctx.globalAlpha = 1;
  // Shards far away and those behind the logo.
  const placed = s.shards.map((sh) => {
    if (sh.orbit) {
      const o = orbitPlace(s, sh);
      return { sh, x: o.x - px * 12, y: o.y - py * 8, scale: 0.6 + o.depth * 0.55, fade: 0.45 + o.depth * 0.55, front: o.depth > 0.5 };
    }
    const fade = Math.min(1, sh.age / 2);
    return { sh, x: sh.x - px * (6 + sh.z * 20), y: sh.y - py * (4 + sh.z * 12), scale: 1, fade, front: sh.z > 0.6 };
  });
  for (const p of placed) if (!p.front) drawShard(ctx, s, p.sh, c, p.x, p.y, p.scale, p.fade);
  // The broken mirror breathes slowly.
  ctx.globalAlpha = Math.min(1, 0.8 + 0.18 * Math.sin((s.t * TAU) / 8));
  if (mirrorLayer) ctx.drawImage(mirrorLayer, -px * 8, -py * 5, w, h);
  else {
    ctx.save();
    ctx.translate(-px * 8, -py * 5);
    paintMirror(ctx, s, c);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  drawRipples(ctx, s, c, -px * 10, -py * 7);
  drawRun(ctx, s, c, -px * 8, -py * 5);
  // Motes, glowing additively.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const realMote = c.memory;
  const echoMote = mix(c.mind, c.echo, 0.6);
  for (const m of s.motes) {
    ctx.globalAlpha = Math.sin(Math.PI * (1 - m.life / m.total)) * 0.85;
    ctx.fillStyle = m.side === 'real' ? realMote : echoMote;
    ctx.beginPath();
    ctx.arc(m.x - px * 9, m.y - py * 6, m.size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  for (const p of placed) if (p.front) drawShard(ctx, s, p.sh, c, p.x, p.y, p.scale, p.fade);
}
