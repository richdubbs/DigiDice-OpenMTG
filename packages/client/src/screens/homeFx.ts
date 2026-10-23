/**
 * The title screen's living room (Home): the shell's neon floor grid (theme/styles.css `.app::before`) with light cycles running along its lines, leaving
 * light walls behind them and derezzing when they hit one, pulses rippling out across the grid, flares running along the horizon, streaks crossing the sky
 * and motes of light drifting up through the room. This module is the floor's geometry and the simulation, no DOM; HomeBackdrop.tsx draws it on a canvas.
 *
 * Floor coordinates ("local", CSS px) are the shell floor's own box before its 3D transform: x from the middle of the screen, y down from the floor's far
 * edge. The grid drifts toward the viewer by `phase` (0..CELL, the shell's `grid-drift`). Everything on the floor lives in the grid's own frame, where the
 * lines stay put, and is drawn at y + phase. Sparks, flares, streaks and motes are in screen px.
 */

/** The shell floor (theme/styles.css `.app::before` and `@keyframes grid-drift`). Keep these in step with it: Home's floor must line up with the others'. */
export const CELL = 64;
export const DRIFT_MS = 14_000;
const PERSPECTIVE = 520;
const TILT = (64 * Math.PI) / 180;
/** The floor box: bottom -8vh, height 62vh, so its far edge is at 46vh. */
const FLOOR_TOP = 0.46;
const FLOOR_HEIGHT = 0.62;
/** Its mask: fades in over the far 22% and out after 70%. */
const MASK_IN = 0.22;
const MASK_OUT = 0.7;
/** The horizon line (`.app::after`: top 38vh, 2px high). */
const HORIZON = 0.38;

/** How long a light cycle's wall takes to fade when it crashes, and a horizon flare's run, in seconds. */
export const DEREZ_S = 0.6;
export const FLARE_S = 2.4;
/** The chance a light cycle turns at a crossing of grid lines. */
const TURN = 0.3;

export interface View {
  width: number;
  height: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** 0 cyan, 1 magenta (the DigiDice colours), 2 amber (rare). */
export type Hue = 0 | 1 | 2;

/** The middle of a grid line, in the grid's frame: vertical lines are 1px wide from 64k - 32, horizontal ones fill the last pixel of each 64px tile. */
export const lineX = (k: number): number => CELL * k - CELL / 2 + 0.5;
export const lineY = (j: number): number => CELL * j + CELL - 0.5;

/** The floor in perspective: the shell's `perspective(520px) rotateX(64deg)` about the middle of its far edge. */
export class Floor {
  readonly cx: number;
  readonly top: number;
  /** The floor box's height in local px. */
  readonly depth: number;
  /** The nearest local y still on screen (the bottom of the view or the floor's near edge). */
  readonly near: number;
  /** The furthest a point may be projected: short of the camera plane. */
  readonly limit: number;
  /** The horizon line's middle, screen y. */
  readonly horizon: number;
  private readonly cos = Math.cos(TILT);
  private readonly sin = Math.sin(TILT);

  constructor(readonly view: View) {
    this.cx = view.width / 2;
    this.top = view.height * FLOOR_TOP;
    this.depth = view.height * FLOOR_HEIGHT;
    this.horizon = view.height * HORIZON + 1;
    this.limit = Math.min(this.depth, (PERSPECTIVE / this.sin) * 0.95);
    const below = Math.max(0, view.height - this.top);
    this.near = Math.min(this.limit, (below * PERSPECTIVE) / (this.cos * PERSPECTIVE + below * this.sin));
  }

  /** How much the floor is magnified at local depth y (1 at the far edge). */
  scale(y: number): number {
    return PERSPECTIVE / (PERSPECTIVE - y * this.sin);
  }

  /** The screen point of local (x, y), raised h px off the floor. */
  project(x: number, y: number, h = 0): Pt {
    const s = PERSPECTIVE / (PERSPECTIVE - y * this.sin - h * this.cos);
    return { x: this.cx + x * s, y: this.top + (y * this.cos - h * this.sin) * s };
  }

  /** The floor's mask at local depth y, 0..1. */
  mask(y: number): number {
    const u = y / this.depth;
    if (u <= 0 || u >= 1) return 0;
    if (u < MASK_IN) return u / MASK_IN;
    if (u > MASK_OUT) return (1 - u) / (1 - MASK_OUT);
    return 1;
  }

  /** Depths from the far edge to `near` (with the mask's corners), for a screen-space gradient that follows the mask. */
  maskSamples(n = 20): number[] {
    const ys = Array.from({ length: n + 1 }, (_, i) => (this.near * i) / n);
    for (const m of [MASK_IN, MASK_OUT]) if (m * this.depth < this.near) ys.push(m * this.depth);
    return ys.sort((a, b) => a - b);
  }

  /** Half the floor's on-screen width at local depth y, in local px. */
  halfWidth(y: number): number {
    return this.cx / this.scale(y);
  }
}

/** A light cycle. */
export interface Cycle {
  /** Its light wall, oldest point first; the last point is the cycle itself. Every segment runs along a grid line. */
  wall: Pt[];
  /** 0 away from the viewer, 1 right, 2 toward the viewer, 3 left. */
  dir: number;
  /** Local px per second. */
  speed: number;
  /** Distance left to the next crossing of grid lines. */
  toNode: number;
  /** The wall's full length. */
  length: number;
  hue: Hue;
  /** ride: running; gone: rode off the view (its wall drains after it); derez: crashed (its wall flickers out); wait: before it rezzes again. */
  state: 'ride' | 'gone' | 'derez' | 'wait';
  /** 1 to 0 while derezzing. */
  fade: number;
  /** Seconds since it rezzed (ride), or left until it rezzes (wait). */
  clock: number;
}

/** A pulse spreading across the floor from a crossing (grid frame), lighting the lines as it passes. */
export interface Ripple {
  x: number;
  y: number;
  r: number;
  max: number;
  speed: number;
  hue: Hue;
}

/** A spark of a derezzed cycle (screen px). */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: Hue;
}

/** A flare running both ways along the horizon from screen x. */
export interface Flare {
  x: number;
  t: number;
  hue: Hue;
}

/** A streak of light crossing the sky (screen px). */
export interface Streak {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  t: number;
  life: number;
  hue: Hue;
}

/** A mote of light drifting up through the room (screen px). */
export interface Mote {
  x: number;
  y: number;
  vy: number;
  sway: number;
  ph: number;
  size: number;
  alpha: number;
  tw: number;
  hue: Hue;
}

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

const span = (a: Pt, b: Pt) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

/** Shortens a wall from its oldest end to `length` (its segments run along grid lines, so lengths add up exactly). */
export function trim(wall: Pt[], length: number): void {
  let total = 0;
  for (let i = 1; i < wall.length; i++) total += span(wall[i - 1]!, wall[i]!);
  let extra = total - Math.max(0, length);
  while (extra > 1e-9 && wall.length > 1) {
    const a = wall[0]!;
    const b = wall[1]!;
    const d = span(a, b);
    if (d <= extra) {
      wall.shift();
      extra -= d;
    } else {
      const t = extra / d;
      a.x += (b.x - a.x) * t;
      a.y += (b.y - a.y) * t;
      extra = 0;
    }
  }
}

/** Whether two axis-aligned segments touch (within tol). */
export function touches(a: Pt, b: Pt, p: Pt, q: Pt, tol: number): boolean {
  return (
    Math.max(a.x, b.x) + tol >= Math.min(p.x, q.x) &&
    Math.min(a.x, b.x) - tol <= Math.max(p.x, q.x) &&
    Math.max(a.y, b.y) + tol >= Math.min(p.y, q.y) &&
    Math.min(a.y, b.y) - tol <= Math.max(p.y, q.y)
  );
}

/** Removes the items `keep` rejects, in place. */
function prune<T>(items: T[], keep: (item: T) => boolean): void {
  let n = 0;
  for (const item of items) if (keep(item)) items[n++] = item;
  items.length = n;
}

export class HomeFx {
  floor: Floor;
  readonly cycles: Cycle[] = [];
  readonly ripples: Ripple[] = [];
  readonly sparks: Spark[] = [];
  readonly flares: Flare[] = [];
  readonly streaks: Streak[] = [];
  readonly motes: Mote[] = [];
  /** The grid's drift now, 0..CELL. */
  phase = 0;
  /** Seconds since the start. */
  time = 0;
  private synced = false;
  private nextRipple = 1.2;
  private nextFlare = 2;
  private nextStreak = 0.8;

  constructor(
    view: View,
    private readonly rand: () => number = Math.random,
  ) {
    this.floor = new Floor(view);
    const n = Math.max(5, Math.min(9, Math.round(view.width / 240)));
    for (let i = 0; i < n; i++) this.cycles.push(this.waiting(0.1 + i * 0.3));
    this.seedMotes();
  }

  resize(view: View): void {
    this.floor = new Floor(view);
    this.seedMotes();
  }

  /** Advances dt seconds; `phase` is the grid's drift now (0..CELL). */
  step(dt: number, phase: number): void {
    // When the drift wraps around, the grid has moved one whole cell: move everything on it one cell in its frame, so it stays where it is on screen.
    if (this.synced && phase < this.phase - CELL / 2) this.shift(CELL);
    else if (this.synced && phase > this.phase + CELL / 2) this.shift(-CELL);
    this.phase = phase;
    this.synced = true;
    this.time += dt;

    for (const c of this.cycles) this.ride(c, dt);
    this.stepRipples(dt);
    this.stepSky(dt);
  }

  private waiting(clock: number): Cycle {
    return { wall: [], dir: 0, speed: 0, toNode: CELL, length: 0, hue: 0, state: 'wait', fade: 1, clock };
  }

  private hue(cyan: number, magenta: number): Hue {
    const r = this.rand();
    return r < cyan ? 0 : r < cyan + magenta ? 1 : 2;
  }

  /** A crossing of grid lines somewhere on the visible floor (grid frame), or null when the view is too small for one. */
  private crossing(): Pt | null {
    const f = this.floor;
    const lo = f.depth * 0.26;
    const hi = Math.min(f.near, f.depth * MASK_OUT) - CELL / 2;
    if (hi <= lo) return null;
    const y = lineY(Math.round((lo + this.rand() * (hi - lo) - this.phase - (CELL - 0.5)) / CELL));
    const half = f.halfWidth(y + this.phase) - CELL;
    if (half <= 0) return null;
    const x = lineX(Math.round((-half + this.rand() * 2 * half + CELL / 2 - 0.5) / CELL));
    return { x, y };
  }

  private rez(c: Cycle): void {
    const at = this.crossing();
    if (!at) {
      c.clock = 1;
      return;
    }
    c.wall = [{ ...at }, { ...at }];
    c.dir = Math.floor(this.rand() * 4) % 4;
    c.speed = 120 + this.rand() * 110;
    c.length = 200 + this.rand() * 260;
    c.toNode = CELL;
    c.hue = this.hue(0.55, 0.35);
    c.state = 'ride';
    c.fade = 1;
    c.clock = 0;
  }

  private rest(c: Cycle): void {
    c.state = 'wait';
    c.wall = [];
    c.clock = 0.4 + this.rand() * 1.8;
  }

  private ride(c: Cycle, dt: number): void {
    switch (c.state) {
      case 'wait':
        c.clock -= dt;
        if (c.clock <= 0) this.rez(c);
        return;
      case 'derez':
        c.fade -= dt / DEREZ_S;
        if (c.fade <= 0) this.rest(c);
        return;
      case 'gone':
        c.length -= c.speed * 1.5 * dt;
        if (c.length <= 0) this.rest(c);
        else trim(c.wall, c.length);
        return;
      case 'ride':
        break;
    }
    c.clock += dt;
    const head = c.wall[c.wall.length - 1]!;
    let left = c.speed * dt;
    while (left > 0) {
      const d = Math.min(left, c.toNode);
      const from = { x: head.x, y: head.y };
      head.x += DX[c.dir]! * d;
      head.y += DY[c.dir]! * d;
      left -= d;
      c.toNode -= d;
      if (this.crashes(c, from, head)) {
        this.derez(c, head);
        return;
      }
      if (c.toNode <= 1e-6) this.cross(c, head);
    }
    trim(c.wall, c.length);
    if (!this.inView(head)) c.state = 'gone';
  }

  /** At a crossing: snap onto it (no drift from rounding) and maybe turn left or right, leaving a corner in the wall. */
  private cross(c: Cycle, head: Pt): void {
    c.toNode = CELL;
    if (c.dir % 2 === 0) head.y = lineY(Math.round((head.y - (CELL - 0.5)) / CELL));
    else head.x = lineX(Math.round((head.x - 0.5 + CELL / 2) / CELL));
    if (this.rand() >= TURN) return;
    c.dir = (c.dir + (this.rand() < 0.5 ? 1 : 3)) % 4;
    c.wall.splice(c.wall.length - 1, 0, { x: head.x, y: head.y });
  }

  /** Whether moving from `a` to `b` runs into another cycle's wall. */
  private crashes(c: Cycle, a: Pt, b: Pt): boolean {
    for (const o of this.cycles) {
      if (o === c || (o.state !== 'ride' && o.state !== 'gone')) continue;
      for (let i = 1; i < o.wall.length; i++) if (touches(a, b, o.wall[i - 1]!, o.wall[i]!, 1.2)) return true;
    }
    return false;
  }

  private derez(c: Cycle, head: Pt): void {
    c.state = 'derez';
    c.fade = 1;
    const ly = head.y + this.phase;
    const at = this.floor.project(head.x, ly, 3);
    const s = Math.sqrt(this.floor.scale(ly));
    for (let i = 0; i < 26; i++) {
      const a = this.rand() * Math.PI * 2;
      const v = (60 + this.rand() * 260) * s;
      const max = 0.45 + this.rand() * 0.65;
      this.sparks.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 40 * s, life: max, max, size: (0.8 + this.rand() * 1.4) * s, hue: c.hue });
    }
    this.ripples.push({ x: head.x, y: head.y, r: 0, max: 150, speed: 260, hue: c.hue });
  }

  private inView(p: Pt): boolean {
    const f = this.floor;
    const ly = p.y + this.phase;
    if (ly < f.depth * 0.08 || ly > f.near + 4) return false;
    return Math.abs(p.x) * f.scale(ly) <= f.cx + 30;
  }

  private shift(dy: number): void {
    for (const c of this.cycles) for (const p of c.wall) p.y += dy;
    for (const r of this.ripples) r.y += dy;
  }

  private stepRipples(dt: number): void {
    for (const r of this.ripples) r.r += r.speed * dt;
    prune(this.ripples, (r) => r.r < r.max);
    this.nextRipple -= dt;
    if (this.nextRipple > 0) return;
    this.nextRipple = 4 + this.rand() * 5;
    const at = this.crossing();
    if (at) this.ripples.push({ ...at, r: 0, max: 300 + this.rand() * 280, speed: 200 + this.rand() * 80, hue: this.hue(0.7, 0.3) });
  }

  private stepSky(dt: number): void {
    const { width, height } = this.floor.view;
    for (const s of this.sparks) {
      const drag = Math.exp(-2.6 * dt);
      s.vx *= drag;
      s.vy = s.vy * drag + 90 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    prune(this.sparks, (s) => s.life > 0);

    for (const f of this.flares) f.t += dt;
    prune(this.flares, (f) => f.t < FLARE_S);
    this.nextFlare -= dt;
    if (this.nextFlare <= 0) {
      this.nextFlare = 5 + this.rand() * 6;
      this.flares.push({ x: width / 2 + (this.rand() - 0.5) * width * 0.5, t: 0, hue: this.hue(0.5, 0.5) });
    }

    for (const s of this.streaks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.t += dt;
    }
    prune(this.streaks, (s) => s.t < s.life);
    this.nextStreak -= dt;
    if (this.nextStreak <= 0) {
      this.nextStreak = 2.2 + this.rand() * 4;
      const dir = this.rand() < 0.5 ? 1 : -1;
      const speed = 650 + this.rand() * 500;
      this.streaks.push({
        x: this.rand() * width,
        y: height * (0.04 + this.rand() * 0.26),
        vx: dir * speed,
        vy: speed * (0.03 + this.rand() * 0.09),
        len: 80 + this.rand() * 140,
        t: 0,
        life: 0.9 + this.rand() * 0.8,
        hue: this.hue(0.6, 0.3),
      });
    }

    for (const m of this.motes) {
      m.y += m.vy * dt;
      if (m.y < -10) {
        m.y = height + 10;
        m.x = this.rand() * width;
      }
    }
  }

  private seedMotes(): void {
    const { width, height } = this.floor.view;
    const n = Math.max(24, Math.min(90, Math.round((width * height) / 24_000)));
    this.motes.length = 0;
    for (let i = 0; i < n; i++) {
      this.motes.push({
        x: this.rand() * width,
        y: this.rand() * height,
        vy: -(6 + this.rand() * 16),
        sway: 4 + this.rand() * 10,
        ph: this.rand() * Math.PI * 2,
        size: 0.6 + this.rand() * 1.6,
        alpha: 0.12 + this.rand() * 0.45,
        tw: 0.6 + this.rand() * 2.2,
        hue: this.hue(0.6, 0.32),
      });
    }
  }
}
