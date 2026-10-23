/**
 * Home's living backdrop: a full-screen canvas behind the hero that draws the shell's neon floor grid itself, in the same place and drift, with the light
 * cycles, pulses, horizon flares, sky streaks and motes of homeFx.ts. While it runs the shell's CSS floor is hidden on Home (screens.css), so the grid is
 * drawn once. Its drift follows the shell's `grid-drift` animation when the browser exposes it, so leaving Home does not make the grid jump.
 *
 * Purely decorative: no pointer events, hidden from screen readers. With reduced motion asked for, or in a browser without matchMedia or a 2D canvas
 * (tests), it draws nothing and the CSS floor stays.
 */
import { useEffect, useRef, useState } from 'react';
import { CELL, DRIFT_MS, FLARE_S, HomeFx, lineX, type Cycle, type Floor, type Hue, type Ripple } from './homeFx';

const GLOW: Record<Hue, string> = { 0: '31,184,255', 1: '245,0,245', 2: '255,170,40' };
const CORE: Record<Hue, string> = { 0: '214,246,255', 1: '255,214,255', 2: '255,238,196' };
/** The height of a light wall, in local px. */
const WALL = 9;
/** Canvas pixels per CSS pixel at most: the glows need no more, and the canvas is the whole screen. */
const MAX_DPR = 1.5;

function animated(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    typeof requestAnimationFrame === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The shell's `grid-drift` animation (on `.app::before`), to keep Home's grid in step with it. */
function shellDrift(): Animation | undefined {
  if (typeof document.getAnimations !== 'function') return undefined;
  return document.getAnimations().find((a) => (a as CSSAnimation).animationName === 'grid-drift');
}

const rgba = (rgb: string, a: number) => `rgba(${rgb},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Gradients that depend on the view only: the floor's mask, as a screen-space vertical gradient in a colour. */
class Paints {
  readonly grid: CanvasGradient;
  readonly lit: CanvasGradient;
  readonly ring: Record<Hue, CanvasGradient>;

  constructor(ctx: CanvasRenderingContext2D, floor: Floor) {
    const masked = (rgb: string, alpha: number) => {
      const top = floor.project(0, 0).y;
      const bottom = Math.max(top + 1, floor.project(0, floor.near).y);
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      for (const y of floor.maskSamples()) g.addColorStop(Math.max(0, Math.min(1, (floor.project(0, y).y - top) / (bottom - top))), rgba(rgb, alpha * floor.mask(y)));
      return g;
    };
    this.grid = masked('31,184,255', 0.16);
    this.lit = masked('150,228,255', 0.85);
    this.ring = { 0: masked(GLOW[0], 1), 1: masked(GLOW[1], 1), 2: masked(GLOW[2], 1) };
  }
}

/** The grid's lines as one path of thin quads (1 local px wide, like the CSS floor's gradient lines), so it fills in one go. */
function gridPath(f: Floor, phase: number): Path2D {
  const path = new Path2D();
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    const a = f.project(x0, y0);
    const b = f.project(x1, y0);
    const c = f.project(x1, y1);
    const d = f.project(x0, y1);
    path.moveTo(a.x, a.y);
    path.lineTo(b.x, b.y);
    path.lineTo(c.x, c.y);
    path.lineTo(d.x, d.y);
    path.closePath();
  };
  const k = Math.ceil((f.cx + CELL) / CELL);
  for (let i = -k; i <= k; i++) quad(lineX(i) - 0.5, 0, lineX(i) + 0.5, f.near);
  const wide = f.cx + CELL;
  for (let y = (phase % CELL) - 1 - CELL; y < f.near; y += CELL) {
    const y0 = Math.max(0, y);
    const y1 = Math.min(f.near, y + 1);
    if (y1 > y0) quad(-wide, y0, wide, y1);
  }
  return path;
}

/** A circle on the floor (grid frame) as a projected polygon, kept on the floor's drawable part. */
function addRing(path: Path2D, f: Floor, phase: number, cx: number, cy: number, r: number): void {
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const y = Math.max(0, Math.min(f.limit, cy + phase + Math.sin(a) * r));
    const p = f.project(cx + Math.cos(a) * r, y);
    if (i === 0) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
  }
  path.closePath();
}

function drawRipple(ctx: CanvasRenderingContext2D, fx: HomeFx, r: Ripple, grid: Path2D, paints: Paints): void {
  const f = fx.floor;
  const a = Math.pow(1 - r.r / r.max, 1.4);
  const band = 22;
  // The wave lights the grid lines it passes over.
  const clip = new Path2D();
  addRing(clip, f, fx.phase, r.x, r.y, r.r + band);
  addRing(clip, f, fx.phase, r.x, r.y, Math.max(0.5, r.r - band));
  ctx.save();
  ctx.clip(clip, 'evenodd');
  ctx.globalAlpha = a;
  ctx.fillStyle = paints.lit;
  ctx.fill(grid);
  ctx.restore();
  // Its front.
  const front = new Path2D();
  addRing(front, f, fx.phase, r.x, r.y, r.r);
  ctx.strokeStyle = paints.ring[r.hue];
  ctx.globalAlpha = a * 0.5;
  ctx.lineWidth = 1.6;
  ctx.stroke(front);
  ctx.globalAlpha = a * 0.14;
  ctx.lineWidth = 8;
  ctx.stroke(front);
  ctx.globalAlpha = 1;
}

function drawCycle(ctx: CanvasRenderingContext2D, fx: HomeFx, c: Cycle): void {
  if (c.state === 'wait' || c.wall.length < 2) return;
  const f = fx.floor;
  const phase = fx.phase;
  // A crashed cycle's wall flickers as it fades.
  const fade = c.state === 'derez' ? c.fade * (Math.sin(fx.time * 70) > 0 ? 1 : 0.45) : 1;
  const glow = GLOW[c.hue];
  const core = CORE[c.hue];
  let behind = 0;
  for (let i = c.wall.length - 1; i > 0; i--) {
    const b = c.wall[i]!;
    const a = c.wall[i - 1]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const pieces = Math.max(1, Math.ceil(len / 12));
    for (let n = 0; n < pieces; n++) {
      const t0 = n / pieces;
      const t1 = (n + 1) / pieces;
      const x0 = b.x + (a.x - b.x) * t0;
      const y0 = b.y + (a.y - b.y) * t0 + phase;
      const x1 = b.x + (a.x - b.x) * t1;
      const y1 = b.y + (a.y - b.y) * t1 + phase;
      const mid = (y0 + y1) / 2;
      const alpha = fade * Math.pow(Math.max(0, 1 - (behind + (len * (t0 + t1)) / 2) / c.length), 1.3) * f.mask(mid);
      if (alpha < 0.01) continue;
      const s = f.scale(mid);
      const p0 = f.project(x0, y0);
      const p1 = f.project(x1, y1);
      const q0 = f.project(x0, y0, WALL);
      const q1 = f.project(x1, y1, WALL);
      // The wall standing on the line, its glow on the floor, and its bright foot and top edge.
      ctx.fillStyle = rgba(glow, alpha * 0.2);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.lineTo(q0.x, q0.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(glow, alpha * 0.28);
      ctx.lineWidth = 6 * s;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.strokeStyle = rgba(core, alpha);
      ctx.lineWidth = 1.3 * s;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }
    behind += len;
  }
  if (c.state !== 'ride') return;
  const head = c.wall[c.wall.length - 1]!;
  const ly = head.y + phase;
  const m = f.mask(ly);
  if (m <= 0) return;
  const s = f.scale(ly);
  const p = f.project(head.x, ly, WALL / 2);
  const r = 16 * s;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, rgba('255,255,255', 0.95 * m));
  g.addColorStop(0.2, rgba(core, 0.75 * m));
  g.addColorStop(0.5, rgba(glow, 0.22 * m));
  g.addColorStop(1, rgba(glow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  // Rezzing in: a beam of light from the floor and a ring spreading from its foot.
  if (c.clock < 0.5) {
    const k = c.clock / 0.5;
    const foot = f.project(head.x, ly);
    const tip = f.project(head.x, ly, 140 * (1 - k * 0.5));
    ctx.strokeStyle = rgba(core, (1 - k) * 0.8 * m);
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    const ring = new Path2D();
    addRing(ring, f, phase, head.x, head.y, 6 + 54 * k);
    ctx.strokeStyle = rgba(glow, (1 - k) * 0.7 * m);
    ctx.lineWidth = 1.5 * s;
    ctx.stroke(ring);
  }
}

function drawSky(ctx: CanvasRenderingContext2D, fx: HomeFx): void {
  const f = fx.floor;
  for (const s of fx.sparks) {
    const a = s.life / s.max;
    ctx.strokeStyle = rgba(CORE[s.hue], a);
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
    ctx.stroke();
  }

  const y = f.horizon;
  for (const fl of fx.flares) {
    const env = Math.sin(Math.PI * Math.min(1, fl.t / FLARE_S));
    const run = fl.t * 560;
    for (const dir of [-1, 1]) {
      const hx = fl.x + dir * run;
      const tail = hx - dir * 220;
      const g = ctx.createLinearGradient(tail, 0, hx, 0);
      g.addColorStop(0, rgba(GLOW[fl.hue], 0));
      g.addColorStop(1, rgba(CORE[fl.hue], env));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tail, y);
      ctx.lineTo(hx, y);
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const r = 28;
      const h = ctx.createRadialGradient(hx, y, 0, hx, y, r);
      h.addColorStop(0, rgba('255,255,255', 0.8 * env));
      h.addColorStop(0.3, rgba(GLOW[fl.hue], 0.35 * env));
      h.addColorStop(1, rgba(GLOW[fl.hue], 0));
      ctx.fillStyle = h;
      ctx.fillRect(hx - r, y - r, r * 2, r * 2);
    }
    // A pillar of light where it starts.
    const k = Math.max(0, 1 - fl.t / 0.9);
    if (k > 0) {
      const top = y - f.view.height * 0.22 * (1 - k * 0.4);
      const g = ctx.createLinearGradient(0, y, 0, top);
      g.addColorStop(0, rgba(CORE[fl.hue], 0.7 * k));
      g.addColorStop(1, rgba(GLOW[fl.hue], 0));
      ctx.fillStyle = g;
      ctx.fillRect(fl.x - 1.5, top, 3, y - top);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(fl.x - 7, top, 14, y - top);
      ctx.globalAlpha = 1;
    }
  }

  for (const s of fx.streaks) {
    const env = Math.sin(Math.PI * (s.t / s.life));
    const v = Math.hypot(s.vx, s.vy);
    const tx = s.x - (s.vx / v) * s.len;
    const ty = s.y - (s.vy / v) * s.len;
    const g = ctx.createLinearGradient(tx, ty, s.x, s.y);
    g.addColorStop(0, rgba(GLOW[s.hue], 0));
    g.addColorStop(1, rgba(CORE[s.hue], 0.75 * env));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
  }

  for (const m of fx.motes) {
    const a = m.alpha * (0.55 + 0.45 * Math.sin(fx.time * m.tw + m.ph));
    ctx.fillStyle = rgba(m.hue === 0 ? CORE[0] : GLOW[m.hue], a);
    ctx.beginPath();
    ctx.arc(m.x + Math.sin(fx.time * 0.5 + m.ph) * m.sway, m.y, m.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw(ctx: CanvasRenderingContext2D, fx: HomeFx, paints: Paints, dpr: number): void {
  const { width, height } = fx.floor.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  const grid = gridPath(fx.floor, fx.phase);
  ctx.fillStyle = paints.grid;
  ctx.fill(grid);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  for (const r of fx.ripples) drawRipple(ctx, fx, r, grid, paints);
  for (const c of fx.cycles) drawCycle(ctx, fx, c);
  drawSky(ctx, fx);
}

export function HomeBackdrop() {
  const [on] = useState(animated);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const view = () => ({ width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight });
    const fx = new HomeFx(view());
    let paints = new Paints(ctx, fx.floor);
    let dpr = 1;
    const resize = () => {
      const v = view();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(v.width * dpr);
      canvas.height = Math.round(v.height * dpr);
      fx.resize(v);
      paints = new Paints(ctx, fx.floor);
    };
    resize();

    const drift = shellDrift();
    const start = performance.now();
    const phaseAt = (now: number) => {
      const t = drift?.currentTime;
      const ms = typeof t === 'number' ? t : now - start;
      return ((ms % DRIFT_MS) / DRIFT_MS) * CELL;
    };
    let last = start;
    let frame = 0;
    const tick = (now: number) => {
      fx.step(Math.min(0.05, Math.max(0, (now - last) / 1000)), phaseAt(now));
      last = now;
      draw(ctx, fx, paints, dpr);
      frame = requestAnimationFrame(tick);
    };
    fx.step(0, phaseAt(start));
    draw(ctx, fx, paints, dpr);
    canvas.classList.add('is-live');
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      canvas.classList.remove('is-live');
    };
  }, [on]);

  if (!on) return null;
  return <canvas ref={ref} className="home-backdrop" aria-hidden="true" />;
}
