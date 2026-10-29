/**
 * Spell effects on a canvas (ui/arena): the one kind of prop the owner allows, drawn to feel like Magic: The Gathering (flame, lightning, arcane light,
 * shadow, leaves, radiance), never like the UI's neon grid. A small particle engine of our own (no library): soft glow sprites drawn additively, smoke drawn
 * normally, a few scripted shapes (bolts, beams, rings, rays). It only runs while something is alive, and everything is short.
 *
 * Coordinates are viewport (client) pixels; each call maps them onto this canvas, so one engine serves a canvas behind the cards and one above them. The
 * board keeps impacts on cards behind the cards (light spills around the card, never across its picture, ARCHITECTURE.md "Card images").
 */
import type { SpellStyle } from './plan';

export interface Pt {
  x: number;
  y: number;
}

type Rgb = readonly [number, number, number];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Acceleration (px/ms²): gravity and drift. */
  ax: number;
  ay: number;
  /** Fraction of velocity kept per 16 ms. */
  drag: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  /** Colours over the particle's life (first to last). */
  colors: readonly Rgb[];
  alpha: number;
  kind: 'glow' | 'smoke' | 'spark' | 'leaf';
  rot: number;
  spin: number;
  /** Curl: how fast the velocity turns (rad/ms), for shadow tendrils. */
  curl: number;
}

/** A scripted shape: drawn each frame until `update` returns false. */
interface Effect {
  update(dt: number): boolean;
  draw(ctx: CanvasRenderingContext2D): void;
  /** Drawn before particles (beams) or after (cores). */
  layer: 'under' | 'over';
}

const MAX_PARTICLES = 1800;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const PALETTE = {
  fire: [
    [255, 248, 220],
    [255, 196, 80],
    [240, 96, 28],
    [120, 30, 12],
  ],
  ember: [
    [255, 236, 170],
    [255, 140, 40],
  ],
  smoke: [
    [70, 52, 48],
    [32, 26, 30],
  ],
  // Red mana's lightning (Shock, Lightning Bolt): white-hot core, molten orange body, a red glow. Never the UI's cold neon.
  lightning: [
    [255, 255, 240],
    [255, 206, 110],
    [255, 92, 30],
  ],
  // Blue mana: deep sea-blue and indigo light, kept away from the UI's cyan.
  arcane: [
    [225, 236, 255],
    [96, 140, 255],
    [56, 46, 196],
  ],
  // Black mana: a sickly violet glow inside black smoke.
  shadow: [
    [214, 170, 255],
    [128, 52, 186],
    [40, 0, 54],
  ],
  shadowSmoke: [
    [34, 6, 44],
    [8, 0, 12],
  ],
  nature: [
    [230, 255, 190],
    [120, 220, 90],
    [30, 120, 50],
  ],
  radiant: [
    [255, 255, 245],
    [255, 226, 140],
    [230, 160, 60],
  ],
  force: [
    [255, 255, 255],
    [200, 210, 225],
    [120, 130, 150],
  ],
  dust: [
    [150, 160, 180],
    [80, 90, 110],
  ],
  heal: [
    [255, 255, 235],
    [190, 255, 200],
    [255, 220, 120],
  ],
} satisfies Record<string, readonly Rgb[]>;

function paletteOf(style: SpellStyle): readonly Rgb[] {
  return style === 'fire' ? PALETTE.fire : style === 'lightning' ? PALETTE.lightning : style === 'arcane' ? PALETTE.arcane : style === 'shadow' ? PALETTE.shadow : style === 'nature' ? PALETTE.nature : style === 'radiant' ? PALETTE.radiant : PALETTE.force;
}

const MANA_RGB: Record<string, Rgb> = { W: [255, 246, 208], U: [74, 168, 255], B: [176, 124, 255], R: [255, 106, 58], G: [76, 217, 100], C: [207, 214, 224] };

function lerpColor(colors: readonly Rgb[], t: number): Rgb {
  if (colors.length === 1) return colors[0]!;
  const x = Math.min(0.9999, Math.max(0, t)) * (colors.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = colors[i]!;
  const b = colors[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Soft round glow sprites, one per quantized colour, white-hot in the middle. */
const spriteCache = new Map<string, HTMLCanvasElement>();
function sprite(c: Rgb, hot = true): HTMLCanvasElement {
  const key = `${Math.round(c[0] / 8)}-${Math.round(c[1] / 8)}-${Math.round(c[2] / 8)}-${hot ? 1 : 0}`;
  let s = spriteCache.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const [r, gg, b] = c.map((v) => Math.round(v));
    if (hot) grad.addColorStop(0, `rgba(255,255,255,1)`);
    grad.addColorStop(hot ? 0.18 : 0, `rgba(${r},${gg},${b},${hot ? 0.95 : 0.9})`);
    grad.addColorStop(0.5, `rgba(${r},${gg},${b},0.35)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  if (spriteCache.size > 400) spriteCache.clear();
  spriteCache.set(key, s);
  return s;
}

function quad(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/** A control point that bows the path upward (toward the top of the screen), so flights arc like thrown things. */
function arcControl(a: Pt, b: Pt, bow: number): Pt {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mx + nx * len * bow, y: my + ny * len * bow };
}

function jagged(a: Pt, b: Pt, depth: number, spread: number): Pt[] {
  let pts: Pt[] = [a, b];
  let s = spread;
  for (let d = 0; d < depth; d++) {
    const next: Pt[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = rand(-s, s);
      next.push({ x: (p.x + q.x) / 2 + (-dy / len) * off, y: (p.y + q.y) / 2 + (dx / len) * off });
      next.push(q);
    }
    pts = next;
    s *= 0.55;
  }
  return pts;
}

/**
 * One animation frame loop for every canvas that has something to draw (the canvas behind the cards and the one above them used to run a loop each): it
 * runs only while a canvas is drawing, and a canvas with nothing to draw costs nothing (ui/arena perf).
 */
const drawing = new Set<Vfx>();
let ticking = 0;
function tick(now: number): void {
  ticking = 0;
  for (const v of [...drawing]) if (!v.step(now)) drawing.delete(v);
  if (drawing.size > 0) ticking = requestAnimationFrame(tick);
}

export class Vfx {
  private readonly ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  private effects: Effect[] = [];
  private last = 0;
  private dpr = 1;
  private rect = { left: 0, top: 0, width: 0, height: 0 };
  /** The canvas size fit() measured, set on the canvas when it next draws (null: it has it). */
  private size: { w: number; h: number } | null = null;
  /** The fireball's flame tongue (unit length, scaled when drawn) and the blast waves' bands by colour and inner radius: made once, not on every frame. */
  private tongue: CanvasGradient | null = null;
  private readonly bands = new Map<string, CanvasGradient>();
  /** Animation time scale: > 1 slower. */
  scale = 1;

  /**
   * `maxDpr`: the most canvas pixels per CSS pixel. The canvas behind the cards draws only soft light (1 is enough); the one above them, sparks and
   * bolts too (1.5). Each canvas covers the whole board, so this is most of what drawing a frame costs on a high-density screen.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly maxDpr = canvas.dataset['fx'] === 'under' ? 1 : 1.5,
  ) {
    this.ctx = canvas.getContext('2d');
  }

  /**
   * Measure the canvas's box (call before a batch of effects). It only reads the page, so the animator measures everything in one pass before it writes
   * anything: the canvas is resized when it next draws (step), not here.
   */
  fit(): void {
    const r = this.canvas.getBoundingClientRect();
    this.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    this.dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    this.size = { w: Math.max(1, Math.round(r.width * this.dpr)), h: Math.max(1, Math.round(r.height * this.dpr)) };
  }

  private local(p: Pt): Pt {
    return { x: p.x - this.rect.left, y: p.y - this.rect.top };
  }

  clear(): void {
    this.particles = [];
    this.effects = [];
    drawing.delete(this);
    if (drawing.size === 0 && ticking) {
      cancelAnimationFrame(ticking);
      ticking = 0;
    }
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private start(): void {
    if (drawing.has(this) || !this.ctx) return;
    this.last = performance.now();
    drawing.add(this);
    if (!ticking) ticking = requestAnimationFrame(tick);
  }

  /** One frame of this canvas; false when it has nothing left to draw (it is then cleared once and leaves the loop). */
  step(now: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const dt = Math.min(1000, now - this.last) / this.scale;
    this.last = now;
    if (this.size) {
      if (this.canvas.width !== this.size.w || this.canvas.height !== this.size.h) {
        this.canvas.width = this.size.w;
        this.canvas.height = this.size.h;
      }
      this.size = null;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.effects = this.effects.filter((e) => e.update(dt));
    for (const e of this.effects) if (e.layer === 'under') e.draw(ctx);
    this.drawParticles(ctx, dt);
    for (const e of this.effects) if (e.layer === 'over') e.draw(ctx);
    if (this.particles.length > 0 || this.effects.length > 0) return true;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    return false;
  }

  private drawParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.pow(p.drag, dt / 16);
      p.vx = (p.vx + p.ax * dt) * k;
      p.vy = (p.vy + p.ay * dt) * k;
      if (p.curl !== 0) {
        const a = p.curl * dt;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const vx = p.vx * c - p.vy * s;
        p.vy = p.vx * s + p.vy * c;
        p.vx = vx;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      alive.push(p);
    }
    this.particles = alive;
    // Smoke first (normal blending), then light (additive).
    ctx.globalCompositeOperation = 'source-over';
    for (const p of alive) {
      if (p.kind !== 'smoke') continue;
      const t = p.age / p.life;
      const c = lerpColor(p.colors, t);
      const size = p.size0 + (p.size1 - p.size0) * t;
      ctx.globalAlpha = p.alpha * (1 - t) * Math.min(1, p.age / 60);
      const s = sprite(c, false);
      ctx.drawImage(s, p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of alive) {
      if (p.kind === 'smoke') continue;
      const t = p.age / p.life;
      const c = lerpColor(p.colors, t);
      const size = p.size0 + (p.size1 - p.size0) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      ctx.globalAlpha = Math.max(0, p.alpha * fade);
      if (p.kind === 'glow') {
        ctx.drawImage(sprite(c), p.x - size / 2, p.y - size / 2, size, size);
      } else if (p.kind === 'spark') {
        const len = Math.max(2, Math.hypot(p.vx, p.vy) * 26);
        const a = Math.atan2(p.vy, p.vx);
        ctx.strokeStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.lineWidth = Math.max(1, size * 0.35);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
        ctx.stroke();
      } else {
        // a glowing leaf
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.drawImage(sprite(c), p.x - size, p.y - size, size * 2, size * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private emit(p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'life' | 'colors'>): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      vx: 0, vy: 0, ax: 0, ay: 0, drag: 1, age: 0, size0: 8, size1: 2, alpha: 1, kind: 'glow', rot: 0, spin: 0, curl: 0,
      ...p,
    });
  }

  private add(e: Effect): void {
    this.effects.push(e);
    this.start();
  }

  /** Radial burst of particles. */
  private burst(at: Pt, n: number, o: { speed: [number, number]; life: [number, number]; size: [number, number]; colors: readonly Rgb[]; kind?: Particle['kind']; gravity?: number; drag?: number; alpha?: number; curl?: number }): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(o.speed[0], o.speed[1]);
      this.emit({
        x: at.x + rand(-4, 4), y: at.y + rand(-4, 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: o.gravity ?? 0, drag: o.drag ?? 0.94,
        life: rand(o.life[0], o.life[1]), size0: rand(o.size[0], o.size[1]), size1: 0, colors: o.colors, kind: o.kind ?? 'glow', alpha: o.alpha ?? 1,
        rot: rand(0, 6.28), spin: rand(-0.02, 0.02), curl: o.curl ? rand(-o.curl, o.curl) : 0,
      });
    }
    this.start();
  }

  private flash(at: Pt, size: number, color: Rgb, dur: number): void {
    let age = 0;
    const life = dur;
    this.add({
      layer: 'over',
      update: (dt) => (age += dt) < life,
      draw: (ctx) => {
        const t = age / life;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - t) * (1 - t);
        const s = size * (0.7 + 0.5 * t);
        ctx.drawImage(sprite(color), at.x - s / 2, at.y - s / 2, s, s);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  /** A soft colour painted over (normal blending, not light added): warms what it covers for a moment. */
  private tint(at: Pt, size: number, color: Rgb, dur: number, alpha: number): void {
    let age = 0;
    this.add({
      layer: 'under',
      update: (dt) => (age += dt) < dur,
      draw: (ctx) => {
        const t = age / dur;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha * (1 - t);
        ctx.drawImage(sprite(color, false), at.x - size / 2, at.y - size / 2, size, size);
        ctx.globalAlpha = 1;
      },
    });
  }

  /** A wide, soft light (no white-hot middle): the glow of a blast, never a hard disc. */
  private glow(at: Pt, size: number, color: Rgb, dur: number, alpha = 0.75): void {
    let age = 0;
    this.add({
      layer: 'over',
      update: (dt) => (age += dt) < dur,
      draw: (ctx) => {
        const t = age / dur;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * (1 - t) * (1 - t);
        const s = size * (0.75 + 0.45 * t);
        ctx.drawImage(sprite(color, false), at.x - s / 2, at.y - s / 2, s, s);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  /** A blast wave: a soft band of light racing outward and fading (squashed onto the floor when `squash` < 1). */
  private shockwave(at: Pt, radius: number, color: Rgb, dur: number, squash = 1): void {
    let age = 0;
    this.add({
      layer: 'over',
      update: (dt) => (age += dt) < dur,
      draw: (ctx) => {
        const t = age / dur;
        const e = 1 - Math.pow(1 - t, 2.4);
        const r = Math.max(4, radius * e);
        const w = Math.max(6, radius * 0.34 * (1 - t * 0.5));
        const outer = r + w * 0.45;
        ctx.save();
        ctx.translate(at.x, at.y);
        // Drawn on a unit circle scaled to the band's outer radius, its fading as the canvas's alpha: one gradient per colour and band width.
        ctx.scale(outer, outer * squash);
        ctx.globalAlpha = 1 - t;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = this.band(color, Math.max(0, r - w) / outer);
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  /** A blast wave's band (shockwave) on a unit circle, from `inner` (0 to 1) out: clear, lit at 0.62, clear. Kept by colour and inner radius (to 1/64). */
  private band(color: Rgb, inner: number): CanvasGradient | string {
    const ctx = this.ctx;
    if (!ctx) return 'transparent';
    const q = Math.round(Math.min(1, inner) * 64);
    const [cr, cg, cb] = color;
    const key = `${cr},${cg},${cb}:${q}`;
    let g = this.bands.get(key);
    if (!g) {
      g = ctx.createRadialGradient(0, 0, q / 64, 0, 0, 1);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
      g.addColorStop(0.62, `rgba(${cr},${cg},${cb},0.6)`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      this.bands.set(key, g);
    }
    return g;
  }

  /** The fireball's flame tongue, from its white-hot root (0) to its dark red tip (1). */
  private flameTongue(ctx: CanvasRenderingContext2D): CanvasGradient {
    if (!this.tongue) {
      const g = ctx.createLinearGradient(0, 0, 1, 0);
      g.addColorStop(0, 'rgba(255,244,210,0.85)');
      g.addColorStop(0.28, 'rgba(255,176,64,0.7)');
      g.addColorStop(0.65, 'rgba(232,72,22,0.42)');
      g.addColorStop(1, 'rgba(120,20,8,0)');
      this.tongue = g;
    }
    return this.tongue;
  }

  private ring(at: Pt, radius: number, color: Rgb, dur: number, width = 6, squash = 1): void {
    let age = 0;
    this.add({
      layer: 'over',
      update: (dt) => (age += dt) < dur,
      draw: (ctx) => {
        const t = age / dur;
        const e = 1 - (1 - t) * (1 - t);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.lineWidth = Math.max(0.5, width * (1 - t));
        ctx.beginPath();
        ctx.ellipse(at.x, at.y, Math.max(1, radius * e), Math.max(1, radius * e * squash), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  // ---- projectiles --------------------------------------------------------------------------------------------------------------

  /** A spell effect flying from `fromC` to `toC` (client points); resolves when it arrives (the caller then plays the impact). `power` 0..1 (the damage) makes it bigger. */
  projectile(style: SpellStyle, fromC: Pt, toC: Pt, power = 0.3): Promise<void> {
    const a = this.local(fromC);
    const b = this.local(toC);
    switch (style) {
      case 'lightning':
        return this.lightning(a, b, power);
      case 'radiant':
        return this.beam(a, b);
      case 'nature':
        return this.volley(a, b);
      default:
        return this.orb(style, a, b, power);
    }
  }

  private orb(style: SpellStyle, a: Pt, b: Pt, power = 0.3): Promise<void> {
    const fire = style === 'fire';
    // A fireball is a real ball of flame, bigger with the damage; it climbs on a clear arc and comes down on its target.
    const big = fire ? 1.3 + power * 1.2 : 1 + power * 0.9;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const dur = fire ? Math.min(660, Math.max(360, dist / 0.95)) : Math.min(560, Math.max(260, dist / 1.05));
    const ctrl = arcControl(a, b, style === 'arcane' ? 0.22 : fire ? 0.26 : 0.16);
    let age = 0;
    let emitAcc = 0;
    let head = a;
    let orbit = 0;
    let dir = Math.atan2(b.y - a.y, b.x - a.x);
    /** Where the head has been lately (newest last): the fireball's tail is drawn along it, one continuous stream. */
    const hist: Pt[] = [a];
    const tailLen = 170 * big;
    return new Promise((resolve) => {
      this.add({
        layer: 'over',
        update: (dt) => {
          age += dt;
          const t = Math.min(1, age / dur);
          const e = Math.pow(t, 1.2);
          let p = quad(a, ctrl, b, e);
          if (style === 'arcane') {
            const wob = Math.sin(t * Math.PI * 3) * 10 * (1 - t);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            p = { x: p.x + (-dy / len) * wob, y: p.y + (dx / len) * wob };
          }
          const prev = head;
          head = p;
          orbit += dt * 0.025;
          emitAcc += dt;
          const dirx = head.x - prev.x;
          const diry = head.y - prev.y;
          if (dirx * dirx + diry * diry > 0.01) dir = Math.atan2(diry, dirx);
          if (fire) {
            hist.push(head);
            let len = 0;
            for (let i = hist.length - 1; i > 0; i--) {
              len += Math.hypot(hist[i]!.x - hist[i - 1]!.x, hist[i]!.y - hist[i - 1]!.y);
              if (len > tailLen) {
                hist.splice(0, i - 1);
                break;
              }
            }
          }
          while (emitAcc > 4) {
            emitAcc -= 4;
            this.trail(style, head, dirx, diry, big);
          }
          if (t >= 1) {
            resolve();
            return false;
          }
          return true;
        },
        draw: (ctx) => {
          ctx.globalCompositeOperation = 'lighter';
          const pal = style === 'fire' ? PALETTE.fire : style === 'arcane' ? PALETTE.arcane : style === 'shadow' ? PALETTE.shadow : PALETTE.force;
          const flick = 1 + Math.sin(age * 0.09) * 0.12;
          if (style === 'fire') {
            // The tail: one continuous stream of fire along the path it took, thick and hot at the ball, thin and red at its end.
            let dist = 0;
            for (let i = hist.length - 1; i > 0; i--) {
              const p0 = hist[i]!;
              const p1 = hist[i - 1]!;
              const seg = Math.hypot(p0.x - p1.x, p0.y - p1.y);
              for (let s = 0; s < seg; s += 5) {
                const k = (dist + s) / tailLen;
                if (k >= 1) break;
                const x = p0.x + ((p1.x - p0.x) * s) / Math.max(1, seg);
                const y = p0.y + ((p1.y - p0.y) * s) / Math.max(1, seg);
                const size = (44 - 34 * k) * big;
                ctx.globalAlpha = 0.5 * (1 - k);
                ctx.drawImage(sprite(lerpColor(PALETTE.fire, 0.2 + 0.75 * k), false), x - size / 2, y - size / 2, size, size);
              }
              dist += seg;
              if (dist >= tailLen) break;
            }
            ctx.globalAlpha = 1;
            // Flames streaming back from the ball as it flies: three tongues, white-hot at the root, orange, then a dark red tip.
            ctx.save();
            ctx.translate(head.x, head.y);
            ctx.rotate(dir + Math.PI);
            for (let k = 0; k < 3; k++) {
              const len = (70 + k * 22) * big * (0.88 + Math.random() * 0.24);
              const wid = (24 - k * 6) * big;
              const sway = Math.sin(age * 0.03 + k * 2.1) * wid * 0.5;
              // Drawn one unit long and stretched to its length, so the one gradient fits every tongue.
              ctx.save();
              ctx.scale(len, 1);
              ctx.fillStyle = this.flameTongue(ctx);
              ctx.beginPath();
              ctx.moveTo(0, -wid);
              ctx.bezierCurveTo(0.35, -wid * 1.15 + sway, 0.72, -wid * 0.35 + sway * 1.4, 1, sway * 1.8);
              ctx.bezierCurveTo(0.72, wid * 0.35 + sway * 1.4, 0.35, wid * 1.15 + sway, 0, wid);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            ctx.restore();
            // A roiling ball of flame: a heat halo, tongues of fire licking around a molten body, a white-hot heart.
            const halo = 130 * big;
            ctx.globalAlpha = 0.55;
            ctx.drawImage(sprite(PALETTE.fire[3]!, false), head.x - halo / 2, head.y - halo / 2, halo, halo);
            ctx.globalAlpha = 1;
            for (let i = 0; i < 6; i++) {
              const r = (12 + i * 3.5) * big;
              const s = (44 + i * 8) * big * (0.85 + Math.random() * 0.3);
              const ox = Math.cos(age * 0.02 + i * 1.7) * r * 0.45 + rand(-3, 3);
              const oy = Math.sin(age * 0.026 + i * 2.3) * r * 0.45 + rand(-3, 3);
              ctx.drawImage(sprite(PALETTE.fire[i % 2 ? 2 : 3]!), head.x + ox - s / 2, head.y + oy - s / 2, s, s);
            }
            const core = 62 * big * flick;
            ctx.drawImage(sprite(PALETTE.fire[1]!), head.x - core / 2, head.y - core / 2, core, core);
            ctx.drawImage(sprite(PALETTE.fire[0]!), head.x - 17 * big, head.y - 17 * big, 34 * big, 34 * big);
            ctx.globalCompositeOperation = 'source-over';
            return;
          }
          ctx.drawImage(sprite(pal[2]!), head.x - 34 * flick * big, head.y - 34 * flick * big, 68 * flick * big, 68 * flick * big);
          ctx.drawImage(sprite(pal[1]!), head.x - 20 * big, head.y - 20 * big, 40 * big, 40 * big);
          if (style === 'shadow') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(sprite([20, 0, 30], false), head.x - 13, head.y - 13, 26, 26);
            ctx.globalCompositeOperation = 'lighter';
          } else {
            ctx.drawImage(sprite(pal[0]!), head.x - 10, head.y - 10, 20, 20);
          }
          if (style === 'arcane') {
            for (let i = 0; i < 3; i++) {
              const ang = orbit + (i * Math.PI * 2) / 3;
              const ox = head.x + Math.cos(ang) * 16;
              const oy = head.y + Math.sin(ang) * 16;
              ctx.drawImage(sprite(PALETTE.arcane[0]!), ox - 6, oy - 6, 12, 12);
            }
          }
          ctx.globalCompositeOperation = 'source-over';
        },
      });
    });
  }

  private trail(style: SpellStyle, at: Pt, dx: number, dy: number, big = 1): void {
    const back = { x: -dx * 0.02, y: -dy * 0.02 };
    switch (style) {
      case 'fire':
        for (let i = 0; i < 4; i++)
          this.emit({ x: at.x + rand(-6, 6) * big, y: at.y + rand(-6, 6) * big, vx: back.x + rand(-0.05, 0.05), vy: back.y + rand(-0.08, 0.02), drag: 0.9, life: rand(220, 420), size0: rand(16, 32) * big, size1: 2, colors: PALETTE.fire, alpha: 0.9 });
        for (let i = 0; i < 2; i++) this.emit({ x: at.x + rand(-6, 6) * big, y: at.y + rand(-6, 6) * big, vx: back.x * 0.6 + rand(-0.14, 0.14), vy: back.y * 0.6 + rand(-0.16, 0.04), ay: 0.0005, drag: 0.98, life: rand(450, 900), size0: rand(2, 4.5), size1: 1, colors: PALETTE.ember, kind: 'spark' });
        if (Math.random() < 0.45) this.emit({ x: at.x, y: at.y, vx: back.x, vy: -0.025, drag: 0.97, life: rand(650, 1000), size0: 16 * big, size1: 46 * big, colors: PALETTE.smoke, kind: 'smoke', alpha: 0.38 });
        break;
      case 'arcane':
        for (let i = 0; i < 2; i++) this.emit({ x: at.x + rand(-8, 8), y: at.y + rand(-8, 8), vx: rand(-0.03, 0.03), vy: rand(-0.04, 0.02), drag: 0.95, life: rand(300, 650), size0: rand(4, 9), size1: 0, colors: PALETTE.arcane });
        break;
      case 'shadow':
        this.emit({ x: at.x, y: at.y, vx: back.x + rand(-0.03, 0.03), vy: back.y + rand(-0.03, 0.03), drag: 0.96, life: rand(500, 800), size0: 18, size1: 44, colors: PALETTE.shadowSmoke, kind: 'smoke', alpha: 0.55 });
        if (Math.random() < 0.7) this.emit({ x: at.x, y: at.y, vx: rand(-0.06, 0.06), vy: rand(-0.06, 0.06), drag: 0.93, curl: rand(-0.012, 0.012), life: rand(300, 500), size0: rand(6, 12), size1: 0, colors: PALETTE.shadow });
        break;
      default:
        this.emit({ x: at.x, y: at.y, vx: back.x, vy: back.y, drag: 0.9, life: rand(150, 260), size0: rand(6, 10), size1: 0, colors: PALETTE.force, kind: 'spark' });
    }
  }

  /**
   * A bolt of red mana: the card crackles, the strike tears from it to the target in a few frames (a fat white-hot core in a molten orange body and a red
   * glow, forking as it goes), then flickers and dies. Resolves when the strike reaches the target.
   */
  private lightning(a: Pt, b: Pt, power = 0.3): Promise<void> {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const grow = Math.min(150, Math.max(70, dist / 6));
    const hold = 300;
    const life = grow + hold;
    const width = 1 + power * 0.7;
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    let age = 0;
    let since = 0;
    let path: Pt[] = [];
    let forks: { at: number; pts: Pt[] }[] = [];
    const regen = () => {
      path = jagged(a, b, 7, dist * 0.15);
      forks = [];
      for (let i = 0; i < 5; i++) {
        const at = Math.floor(rand(0.12, 0.85) * path.length);
        const p = path[at]!;
        const ang = dir + rand(0.35, 1.1) * (i % 2 ? 1 : -1);
        const len = rand(26, 64) + dist * 0.06;
        forks.push({ at, pts: jagged(p, { x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len }, 4, len * 0.35) });
      }
    };
    regen();
    // The card lets go: a hot flash and a spray of sparks where the bolt leaves it.
    this.flash(a, 120 * width, [255, 196, 110], 240);
    this.burst(a, 16, { speed: [0.12, 0.45], life: [160, 340], size: [2, 4], colors: [[255, 255, 230], [255, 160, 60]], kind: 'spark', drag: 0.9 });
    let arrived = false;
    return new Promise((resolve) => {
      this.add({
        layer: 'over',
        update: (dt) => {
          age += dt;
          since += dt;
          if (since > 38) {
            since = 0;
            regen();
          }
          if (!arrived && age >= grow) {
            arrived = true;
            resolve();
          }
          return age < life;
        },
        draw: (ctx) => {
          const reach = Math.min(1, age / grow);
          const t = age < grow ? 0 : (age - grow) / hold;
          const flicker = age < grow ? 1 : 0.7 + Math.random() * 0.3;
          const alpha = (t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7) * flicker;
          const n = Math.max(2, Math.ceil(path.length * reach));
          const pts = path.slice(0, n);
          const strokePath = (p: readonly Pt[], w: number, color: string) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(p[0]!.x, p[0]!.y);
            for (let i = 1; i < p.length; i++) ctx.lineTo(p[i]!.x, p[i]!.y);
            ctx.stroke();
          };
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = alpha * 0.26;
          strokePath(pts, 30 * width, 'rgb(255,64,18)');
          ctx.globalAlpha = alpha * 0.5;
          strokePath(pts, 14 * width, 'rgb(255,128,36)');
          for (const f of forks) {
            if (f.at >= n) continue;
            ctx.globalAlpha = alpha * 0.45;
            strokePath(f.pts, 6 * width, 'rgb(255,120,40)');
            ctx.globalAlpha = alpha * 0.9;
            strokePath(f.pts, 1.8 * width, 'rgb(255,236,170)');
          }
          ctx.globalAlpha = alpha * 0.95;
          strokePath(pts, 6.5 * width, 'rgb(255,214,120)');
          ctx.globalAlpha = alpha;
          strokePath(pts, 2.8 * width, 'rgb(255,255,245)');
          if (reach < 1) {
            const tip = pts[pts.length - 1]!;
            ctx.globalAlpha = 1;
            ctx.drawImage(sprite(PALETTE.lightning[1]!), tip.x - 28 * width, tip.y - 28 * width, 56 * width, 56 * width);
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        },
      });
    });
  }

  /** Short arcs crackling out of a lightning strike's impact. */
  private crackle(at: Pt, len: number, dur: number): void {
    let age = 0;
    let since = 99;
    let arcs: Pt[][] = [];
    this.add({
      layer: 'over',
      update: (dt) => {
        age += dt;
        since += dt;
        if (since > 40) {
          since = 0;
          arcs = Array.from({ length: 4 }, () => {
            const ang = rand(0, Math.PI * 2);
            const l = rand(0.5, 1) * len;
            return jagged(at, { x: at.x + Math.cos(ang) * l, y: at.y + Math.sin(ang) * l }, 4, l * 0.35);
          });
        }
        return age < dur;
      },
      draw: (ctx) => {
        const fade = 1 - age / dur;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const arc of arcs) {
          ctx.globalAlpha = fade * 0.5;
          ctx.strokeStyle = 'rgb(255,120,40)';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(arc[0]!.x, arc[0]!.y);
          for (const p of arc) ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.globalAlpha = fade;
          ctx.strokeStyle = 'rgb(255,244,200)';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  private beam(a: Pt, b: Pt): Promise<void> {
    const grow = (110);
    const life = (420);
    let age = 0;
    let arrived = false;
    let emitAcc = 0;
    return new Promise((resolve) => {
      this.add({
        layer: 'under',
        update: (dt) => {
          age += dt;
          emitAcc += dt;
          const t = Math.min(1, age / grow);
          while (emitAcc > 10 && age < life * 0.8) {
            emitAcc -= 10;
            const k = Math.random() * t;
            this.emit({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, vx: rand(-0.02, 0.02), vy: rand(-0.07, -0.02), drag: 0.97, life: rand(400, 700), size0: rand(3, 7), size1: 0, colors: PALETTE.radiant });
          }
          if (!arrived && age >= grow) {
            arrived = true;
            resolve();
          }
          return age < life;
        },
        draw: (ctx) => {
          const t = Math.min(1, age / grow);
          const fade = age < life * 0.55 ? 1 : 1 - (age - life * 0.55) / (life * 0.45);
          const ex = a.x + (b.x - a.x) * t;
          const ey = a.y + (b.y - a.y) * t;
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          const line = (w: number, color: string, al: number) => {
            ctx.globalAlpha = al * fade;
            ctx.strokeStyle = color;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          };
          line(26, 'rgb(230,160,60)', 0.22);
          line(12, 'rgb(255,226,140)', 0.55);
          line(4, 'rgb(255,255,245)', 1);
          ctx.globalAlpha = fade;
          ctx.drawImage(sprite(PALETTE.radiant[1]!), ex - 30, ey - 30, 60, 60);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        },
      });
    });
  }

  private volley(a: Pt, b: Pt): Promise<void> {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const dur = (Math.min(560, Math.max(300, dist / 0.95)));
    const leaves = Array.from({ length: 6 }, (_, i) => ({ delay: i * (28), ctrl: arcControl(a, b, rand(0.05, 0.32) * (i % 2 ? 1 : -1)), rot: rand(0, 6), off: { x: rand(-10, 10), y: rand(-10, 10) } }));
    let age = 0;
    let arrived = false;
    let emitAcc = 0;
    return new Promise((resolve) => {
      this.add({
        layer: 'over',
        update: (dt) => {
          age += dt;
          emitAcc += dt;
          for (const l of leaves) l.rot += dt * 0.02;
          if (emitAcc > 12) {
            emitAcc = 0;
            for (const l of leaves) {
              const t = Math.min(1, Math.max(0, (age - l.delay) / dur));
              if (t <= 0 || t >= 1) continue;
              const p = quad(a, l.ctrl, b, t);
              this.emit({ x: p.x, y: p.y, vx: rand(-0.02, 0.02), vy: rand(-0.02, 0.02), drag: 0.95, life: rand(260, 420), size0: rand(3, 6), size1: 0, colors: PALETTE.nature });
            }
          }
          if (!arrived && age >= dur) {
            arrived = true;
            resolve();
          }
          return age < dur + leaves[leaves.length - 1]!.delay;
        },
        draw: (ctx) => {
          ctx.globalCompositeOperation = 'lighter';
          for (const l of leaves) {
            const t = Math.min(1, Math.max(0, (age - l.delay) / dur));
            if (t <= 0 || t >= 1) continue;
            const p = quad({ x: a.x + l.off.x, y: a.y + l.off.y }, l.ctrl, b, t);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(l.rot);
            ctx.fillStyle = 'rgb(140,230,110)';
            ctx.beginPath();
            ctx.ellipse(0, 0, 9, 3.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            ctx.drawImage(sprite(PALETTE.nature[1]!), p.x - 14, p.y - 14, 28, 28);
          }
          ctx.globalCompositeOperation = 'source-over';
        },
      });
    });
  }

  // ---- impacts and auras ---------------------------------------------------------------------------------------------------------

  /** The burst where a spell effect lands; `power` 0..1 from the damage. */
  impact(style: SpellStyle | 'physical', atC: Pt, power: number): void {
    const at = this.local(atC);
    const p = style === 'fire' ? 0.95 + power * 1.1 : 0.8 + power * 0.9;
    switch (style) {
      case 'fire':
        // An explosion: a brief white-hot heart, a ball of fire blooming outward and burning to red, a blast wave, embers raining, smoke rolling up.
        this.flash(at, 64 * p, [255, 246, 220], 110);
        this.glow(at, 190 * p, PALETTE.fire[2]!, 320, 0.7);
        this.bloom(at, 150 * p, 600);
        this.ring(at, 84 * p, [255, 236, 200], 200, 5);
        this.shockwave(at, 150 * p, [255, 150, 70], 440);
        this.shockwave(at, 220 * p, [255, 100, 40], 560, 0.42);
        this.burst(at, Math.round(12 * p), { speed: [0.2, 0.55], life: [500, 900], size: [5, 10], colors: PALETTE.ember, gravity: 0.0007, drag: 0.97 });
        this.burst(at, Math.round(70 * p), { speed: [0.2, 0.75], life: [320, 620], size: [16, 36], colors: PALETTE.fire, drag: 0.935 });
        this.burst(at, Math.round(34 * p), { speed: [0.15, 0.55], life: [450, 900], size: [2, 4], colors: PALETTE.ember, kind: 'spark', gravity: 0.0006, drag: 0.97 });
        this.burst(at, 12, { speed: [0.02, 0.09], life: [700, 1200], size: [28, 54], colors: PALETTE.smoke, kind: 'smoke', alpha: 0.45, drag: 0.95, gravity: -0.00004 });
        break;
      case 'lightning':
        // The strike lands: a white-hot flash, arcs crackling out, sparks and a scorch of smoke.
        this.flash(at, 190 * p, [255, 200, 110], 220);
        this.flash(at, 76 * p, [255, 255, 240], 120);
        this.ring(at, 80 * p, [255, 150, 60], 300, 6);
        this.crackle(at, 44 * p, 200);
        this.burst(at, Math.round(50 * p), { speed: [0.3, 0.95], life: [170, 380], size: [3, 6], colors: [[255, 255, 230], [255, 190, 90], [255, 90, 30]], kind: 'spark', drag: 0.9, gravity: 0.0004 });
        this.burst(at, 8, { speed: [0.02, 0.07], life: [600, 1000], size: [22, 40], colors: PALETTE.smoke, kind: 'smoke', alpha: 0.4, drag: 0.95 });
        break;
      case 'arcane':
        this.flash(at, 160 * p, PALETTE.arcane[1]!, 240);
        this.ring(at, 80 * p, [110, 150, 255], 380, 5);
        this.ring(at, 52 * p, [150, 110, 255], 320, 3);
        this.burst(at, Math.round(46 * p), { speed: [0.08, 0.36], life: [320, 680], size: [4, 10], colors: PALETTE.arcane, drag: 0.92, curl: 0.004 });
        break;
      case 'shadow':
        this.flash(at, 160 * p, PALETTE.shadow[1]!, 260);
        this.burst(at, Math.round(30 * p), { speed: [0.08, 0.32], life: [500, 900], size: [20, 40], colors: PALETTE.shadowSmoke, kind: 'smoke', alpha: 0.65, drag: 0.93 });
        this.burst(at, Math.round(38 * p), { speed: [0.1, 0.38], life: [380, 700], size: [6, 12], colors: PALETTE.shadow, drag: 0.93, curl: 0.01 });
        break;
      case 'nature':
        this.flash(at, 120 * p, PALETTE.nature[1]!, (220));
        this.ring(at, 64 * p, [120, 220, 90], (320), 4);
        this.burst(at, Math.round(16 * p), { speed: [0.1, 0.32], life: [500, 900], size: [6, 10], colors: PALETTE.nature, kind: 'leaf', gravity: 0.0003, drag: 0.95 });
        this.burst(at, Math.round(24 * p), { speed: [0.05, 0.25], life: [300, 600], size: [4, 8], colors: PALETTE.nature, drag: 0.93 });
        break;
      case 'radiant':
        this.flash(at, 160 * p, PALETTE.radiant[1]!, (240));
        this.rays(at, 70 * p, (340));
        this.burst(at, Math.round(30 * p), { speed: [0.05, 0.24], life: [400, 800], size: [3, 7], colors: PALETTE.radiant, gravity: -0.0002, drag: 0.95 });
        break;
      case 'force':
        this.flash(at, 110 * p, PALETTE.force[1]!, (160));
        this.burst(at, Math.round(28 * p), { speed: [0.25, 0.7], life: [150, 300], size: [3, 6], colors: PALETTE.force, kind: 'spark', drag: 0.9 });
        break;
      default:
        // A physical blow (combat): a white-hot crack, a shockwave, sparks flying and dust thrown along the table.
        this.flash(at, 170 * p, [255, 232, 196], 170);
        this.flash(at, 64 * p, [255, 255, 245], 90);
        this.ring(at, 76 * p, [255, 226, 186], 300, 7);
        this.ring(at, 120 * p, [255, 196, 140], 420, 3, 0.45);
        this.burst(at, Math.round(40 * p), { speed: [0.28, 0.9], life: [170, 380], size: [3, 6], colors: [[255, 255, 230], [255, 176, 80]], kind: 'spark', drag: 0.9, gravity: 0.0004 });
        this.burst(at, 14, { speed: [0.04, 0.14], life: [520, 860], size: [20, 36], colors: PALETTE.dust, kind: 'smoke', alpha: 0.4 });
    }
  }

  /**
   * A spell touching what it targets without damage (destroy, exile, bounce, pump, tap...): a smaller landing in the spell's colours, sized to the target
   * (behind a card, never over its picture).
   */
  touch(style: SpellStyle, atC: Pt, size: number): void {
    const at = this.local(atC);
    const pal = paletteOf(style);
    this.flash(at, size * 2.3, pal[1]!, 300);
    this.ring(at, size * 0.95, pal[1]!, 420, 4);
    switch (style) {
      case 'nature':
        this.burst(at, 16, { speed: [0.08, 0.3], life: [500, 900], size: [6, 10], colors: PALETTE.nature, kind: 'leaf', gravity: 0.0003, drag: 0.95 });
        break;
      case 'radiant':
        this.rays(at, size * 1.1, 380);
        break;
      case 'shadow':
        this.burst(at, 16, { speed: [0.06, 0.24], life: [500, 900], size: [18, 34], colors: PALETTE.shadowSmoke, kind: 'smoke', alpha: 0.6, drag: 0.93 });
        break;
      case 'fire':
        this.burst(at, 24, { speed: [0.1, 0.36], life: [260, 520], size: [12, 24], colors: PALETTE.fire, drag: 0.9 });
        break;
      case 'lightning':
        this.crackle(at, size * 0.7, 180);
        break;
      default:
        break;
    }
    this.burst(at, 22, { speed: [0.05, 0.26], life: [360, 720], size: [3, 8], colors: pal, drag: 0.93 });
  }

  /** A ball of fire swelling out of a blast and burning away: puffs of flame thrown outward around a white-hot heart that cools to red. */
  private bloom(at: Pt, radius: number, dur: number): void {
    let age = 0;
    const puffs = Array.from({ length: 10 }, (_, i) => ({ ang: (i / 10) * Math.PI * 2 + rand(-0.3, 0.3), d: rand(0.3, 0.65), s: rand(0.5, 0.85) }));
    this.add({
      layer: 'over',
      update: (dt) => (age += dt) < dur,
      draw: (ctx) => {
        const t = age / dur;
        const e = 1 - Math.pow(1 - t, 3);
        const fade = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
        ctx.globalCompositeOperation = 'lighter';
        for (const p of puffs) {
          const r = radius * e * p.d;
          const s = radius * p.s * (0.5 + e * 0.8);
          ctx.globalAlpha = fade * 0.8;
          ctx.drawImage(sprite(lerpColor(PALETTE.fire, 0.3 + t * 0.65), false), at.x + Math.cos(p.ang) * r - s / 2, at.y + Math.sin(p.ang) * r - s / 2, s, s);
        }
        const core = radius * (0.55 + e * 0.45);
        ctx.globalAlpha = fade * 0.85;
        ctx.drawImage(sprite(lerpColor(PALETTE.fire, 0.12 + t * 0.6), false), at.x - core / 2, at.y - core / 2, core, core);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  private rays(at: Pt, len: number, dur: number): void {
    let age = 0;
    const n = 12;
    const base = rand(0, Math.PI);
    this.add({
      layer: 'over',
      update: (dt) => (age += dt) < dur,
      draw: (ctx) => {
        const t = age / dur;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = 'rgb(255,226,140)';
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const ang = base + (i / n) * Math.PI * 2 + t * 0.4;
          const r0 = len * 0.25 * (1 + t);
          const r1 = len * (0.6 + t * 0.8) * (i % 2 ? 0.7 : 1);
          ctx.lineWidth = 3 * (1 - t);
          ctx.beginPath();
          ctx.moveTo(at.x + Math.cos(ang) * r0, at.y + Math.sin(ang) * r0);
          ctx.lineTo(at.x + Math.cos(ang) * r1, at.y + Math.sin(ang) * r1);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      },
    });
  }

  /** Life gained: warm light rising around a disc. */
  heal(atC: Pt, radius: number): void {
    const at = this.local(atC);
    this.flash(at, radius * 3, PALETTE.heal[1]!, (320));
    this.ring(at, radius * 1.6, [200, 255, 210], (500), 4);
    for (let i = 0; i < 34; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(radius * 0.4, radius * 1.3);
      this.emit({ x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r, vx: rand(-0.015, 0.015), vy: rand(-0.09, -0.035), drag: 0.985, life: rand(600, 1000), size0: rand(4, 9), size1: 0, colors: PALETTE.heal });
    }
    this.start();
  }

  /** Light around a card or disc: a spell or ability coming to life (resolving, activated, triggered). */
  flare(atC: Pt, size: number, style: SpellStyle | 'trigger'): void {
    const at = this.local(atC);
    const color: Rgb = style === 'trigger' ? [255, 214, 110] : paletteOf(style)[1]!;
    this.flash(at, size * 1.8, color, (360));
    this.burst(at, 18, { speed: [0.04, 0.16], life: [300, 600], size: [3, 7], colors: [[255, 255, 255], color], drag: 0.95 });
  }

  /** Counters put on or removed from a permanent: motes swirling up around it. */
  motes(atC: Pt, size: number, good: boolean): void {
    const at = this.local(atC);
    const colors: readonly Rgb[] = good ? [[255, 255, 220], [150, 240, 120], [250, 210, 90]] : [[255, 220, 255], [220, 80, 120], [120, 30, 90]];
    for (let i = 0; i < 22; i++) {
      const a = rand(0, Math.PI * 2);
      this.emit({ x: at.x + Math.cos(a) * size * 0.5, y: at.y + Math.sin(a) * size * 0.6, vx: -Math.sin(a) * 0.06, vy: Math.cos(a) * 0.06 - 0.04, curl: 0.004, drag: 0.97, life: rand(450, 750), size0: rand(4, 8), size1: 0, colors });
    }
    this.start();
  }

  /** A permanent landing on the table: dust thrown out along the floor. */
  dust(atC: Pt, width: number, heavy: number): void {
    const at = this.local(atC);
    this.ring(at, width * (0.8 + heavy * 0.6), [140, 190, 255], (380), 3, 0.35);
    for (let i = 0; i < 18 + heavy * 18; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.emit({ x: at.x + rand(-width / 2, width / 2), y: at.y + rand(-4, 4), vx: dir * rand(0.04, 0.18) * (1 + heavy), vy: rand(-0.05, -0.005), drag: 0.93, life: rand(400, 750), size0: rand(10, 20), size1: rand(26, 40), colors: PALETTE.dust, kind: 'smoke', alpha: 0.3 });
    }
    this.start();
  }

  /** The instant a card breaks: a white-hot flash and a spray of sparks, gone in a blink. */
  breakFlash(atC: Pt, size: number): void {
    const at = this.local(atC);
    this.flash(at, size * 1.9, [255, 246, 226], 120);
    this.burst(at, 34, { speed: [0.3, 0.95], life: [160, 380], size: [2.5, 5], colors: [[255, 255, 236], [255, 196, 110], [255, 110, 40]], kind: 'spark', drag: 0.9, gravity: 0.0005 });
  }

  /**
   * The heart of a hit on a player's disc (our own art), drawn over the disc and kept to its size: a flash, a small ball of flame for fire, sparks. The
   * rest of the blast goes on the canvas behind the cards, so it spills over the floor and behind the cards near the disc, never over their pictures.
   */
  core(style: SpellStyle | 'physical', atC: Pt, size: number): void {
    const at = this.local(atC);
    const pal: readonly Rgb[] = style === 'physical' ? [[255, 255, 240], [255, 226, 186], [255, 170, 90]] : paletteOf(style);
    // Light added over the disc's deep blue turns pink: a warm glow painted over it first keeps the hit the spell's own colour.
    this.tint(at, size * 1.4, pal[1]!, 560, 0.8);
    this.flash(at, size * 1.2, [255, 250, 235], 110);
    this.flash(at, size * 1.4, pal[1]!, 200);
    this.ring(at, size * 0.85, [255, 244, 214], 220, 4);
    if (style === 'fire') {
      this.bloom(at, size * 0.6, 460);
      this.burst(at, 10, { speed: [0.18, 0.45], life: [500, 850], size: [5, 9], colors: PALETTE.ember, gravity: 0.0007, drag: 0.97 });
    }
    this.burst(at, 18, { speed: [0.15, 0.5], life: [160, 340], size: [2, 4], colors: pal, kind: 'spark', drag: 0.9, gravity: 0.0004 });
  }

  /** A card destroyed: a hot flash, a shockwave along the table, black smoke rolling out and embers raining where it stood. */
  destroy(atC: Pt, size: number): void {
    const at = this.local(atC);
    this.flash(at, size * 2.8, [255, 190, 130], 240);
    this.flash(at, size * 1.1, [255, 248, 225], 120);
    this.ring(at, size * 1.25, [255, 170, 110], 440, 5, 0.5);
    this.burst(at, 26, { speed: [0.05, 0.24], life: [600, 1100], size: [26, 54], colors: PALETTE.smoke, kind: 'smoke', alpha: 0.55, drag: 0.94, gravity: -0.00003 });
    this.burst(at, 22, { speed: [0.1, 0.4], life: [260, 520], size: [10, 22], colors: PALETTE.fire, drag: 0.9 });
    this.burst(at, 44, { speed: [0.14, 0.5], life: [420, 900], size: [2, 4], colors: PALETTE.ember, kind: 'spark', gravity: 0.0006, drag: 0.97 });
  }

  /** Exiled: white light drawn into the card, then a flash. */
  banish(atC: Pt, size: number): void {
    const at = this.local(atC);
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(size * 0.7, size * 1.3);
      const life = rand(260, 380);
      this.emit({ x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r) / life, life, size0: rand(4, 8), size1: 2, colors: [[255, 255, 255], [200, 220, 255]] });
    }
    this.flash(at, size * 2.4, [235, 240, 255], (420));
    this.ring(at, size * 1.1, [220, 230, 255], (420), 3);
    this.start();
  }

  /** A token appears: motes gather and flash. */
  materialize(atC: Pt, size: number): void {
    const at = this.local(atC);
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(size * 0.8, size * 1.4);
      const life = rand(240, 340);
      this.emit({ x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r) / life, life, size0: rand(4, 8), size1: 2, colors: PALETTE.radiant });
    }
    this.flash(at, size * 2, PALETTE.radiant[1]!, (380));
    this.start();
  }

  /** Sparkles in a spell's colours trailing behind a card that flies along an arc from `fromC` to `toC` in about `dur` ms (a card being cast). */
  castTrail(style: SpellStyle, fromC: Pt, toC: Pt, dur: number, lift = -50): void {
    const a = this.local(fromC);
    const b = this.local(toC);
    const ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + lift * 2 };
    const pal = paletteOf(style);
    let age = 0;
    let acc = 0;
    this.add({
      layer: 'under',
      update: (dt) => {
        age += dt;
        acc += dt;
        const t = Math.min(1, age / dur);
        const e = 1 - Math.pow(1 - t, 2.2);
        const p = quad(a, ctrl, b, e);
        while (acc > 6) {
          acc -= 6;
          this.emit({ x: p.x + rand(-10, 10), y: p.y + rand(-14, 14), vx: rand(-0.03, 0.03), vy: rand(-0.05, 0.01), drag: 0.96, life: rand(260, 520), size0: rand(4, 9), size1: 0, colors: pal });
        }
        return t < 1;
      },
      draw: () => {},
    });
  }

  /** A mana orb flying from a source to what it pays for; resolves on arrival. */
  manaOrb(fromC: Pt, toC: Pt, mana: string): Promise<void> {
    const a = this.local(fromC);
    const b = this.local(toC);
    const color = MANA_RGB[mana] ?? MANA_RGB.C!;
    const dur = (Math.min(420, Math.max(220, Math.hypot(b.x - a.x, b.y - a.y) / 1.6)));
    const ctrl = arcControl(a, b, 0.25);
    let age = 0;
    let head = a;
    return new Promise((resolve) => {
      this.add({
        layer: 'over',
        update: (dt) => {
          age += dt;
          const t = Math.min(1, age / dur);
          head = quad(a, ctrl, b, t * t * (3 - 2 * t));
          this.emit({ x: head.x, y: head.y, vx: rand(-0.01, 0.01), vy: rand(-0.01, 0.01), life: rand(160, 260), size0: 7, size1: 0, colors: [color] });
          if (t >= 1) {
            resolve();
            return false;
          }
          return true;
        },
        draw: (ctx) => {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(sprite(color), head.x - 13, head.y - 13, 26, 26);
          ctx.globalCompositeOperation = 'source-over';
        },
      });
    });
  }
}
