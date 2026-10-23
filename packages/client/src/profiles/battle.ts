/**
 * The LCARS template's background scene (profiles/SpaceBattle.tsx): a skirmish behind the Home screen, our own art drawn on a canvas. Two
 * Federation-style starships (saucer, hull, two glowing nacelles) and two Romulan-style warbirds (green, wings spread) circle and strafe each other.
 * The starships fire orange phaser beams and photon torpedoes, the warbirds green disruptor beams and plasma torpedoes, and every hit lands on the
 * target's shield: the bubble flares up around the ship, brightest where it was struck, with ripples running out from the impact. Nobody is ever
 * destroyed, so the battle goes on as long as the screen is open.
 *
 * The simulation is deterministic for a seed (no Math.random), so a still frame (reduced motion) is always the same moment of the battle.
 */

export type Side = 'fed' | 'rom';

export interface Ship {
  id: number;
  side: Side;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Drawing scale: the ship's length is about 2 * size. */
  size: number;
  /** Turning to the left (-1) or right (+1) of the target when strafing; flips now and then. */
  orbit: number;
  target: number;
  beamCooldown: number;
  torpedoCooldown: number;
  retarget: number;
  /** The shield's glow (0 to 1) and where it was last struck, as an angle in the ship's own frame. */
  shield: number;
  impact: number;
  ripples: number[];
}

export interface Beam {
  from: number;
  to: number;
  /** Seconds left, and the whole duration. */
  life: number;
  total: number;
  /** Where on the shooter the emitter sits (an angle around its hull). */
  side: Side;
  /** A small sweep across the shield while the beam is on. */
  sweep: number;
}

export interface Torpedo {
  side: Side;
  target: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface Star {
  x: number;
  y: number;
  /** Parallax layer: 0 (far, slow, faint) to 2 (near). */
  layer: number;
  phase: number;
}

export interface Battle {
  w: number;
  h: number;
  t: number;
  ships: Ship[];
  beams: Beam[];
  torpedoes: Torpedo[];
  sparks: Spark[];
  stars: Star[];
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
const SPEED: Record<Side, number> = { fed: 64, rom: 76 };
const TURN: Record<Side, number> = { fed: 0.9, rom: 1.15 };
/** The shield bubble's radii, in units of the ship's size (the warbird's wings are wide). */
export const SHIELD: Record<Side, { rx: number; ry: number; cx: number }> = { fed: { rx: 1.02, ry: 0.66, cx: -0.08 }, rom: { rx: 0.98, ry: 1.0, cx: -0.02 } };
const BEAM_RANGE = 640;

function wrapAngle(a: number): number {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** The area the ships keep to: the upper part of the screen, clear of the Home screen's title and buttons. */
function bounds(b: Battle) {
  return { left: b.w * 0.05, right: b.w * 0.95, top: b.h * 0.1, bottom: b.h * 0.5 };
}

export function createBattle(w: number, h: number, seed = 1701): Battle {
  const rand = seeded(seed);
  const b: Battle = { w, h, t: 0, ships: [], beams: [], torpedoes: [], sparks: [], stars: [], rand };
  const area = bounds(b);
  // The Federation comes in from the left, the Romulans from the right.
  const plan: { side: Side; size: number }[] = [
    { side: 'fed', size: 60 },
    { side: 'rom', size: 64 },
    { side: 'fed', size: 44 },
    { side: 'rom', size: 48 },
  ];
  plan.forEach((p, id) => {
    const left = p.side === 'fed';
    b.ships.push({
      id,
      side: p.side,
      x: left ? area.left + (area.right - area.left) * (0.12 + rand() * 0.2) : area.right - (area.right - area.left) * (0.12 + rand() * 0.2),
      y: area.top + (area.bottom - area.top) * (0.2 + rand() * 0.6),
      heading: left ? rand() * 0.6 - 0.3 : Math.PI + rand() * 0.6 - 0.3,
      speed: SPEED[p.side] * (0.85 + rand() * 0.3),
      size: p.size,
      orbit: rand() < 0.5 ? -1 : 1,
      target: -1,
      beamCooldown: 0.6 + rand() * 1.6,
      torpedoCooldown: 3 + rand() * 4,
      retarget: 0,
      shield: 0,
      impact: 0,
      ripples: [],
    });
  });
  const stars = Math.round(Math.min(260, (w * h) / 5200));
  for (let i = 0; i < stars; i++) b.stars.push({ x: rand() * w, y: rand() * h, layer: rand() < 0.6 ? 0 : rand() < 0.75 ? 1 : 2, phase: rand() * TAU });
  return b;
}

/** Keep the ships and stars on screen after a resize. */
export function resizeBattle(b: Battle, w: number, h: number): void {
  const sx = w / (b.w || w);
  const sy = h / (b.h || h);
  for (const s of b.ships) {
    s.x *= sx;
    s.y *= sy;
  }
  for (const s of b.stars) {
    s.x *= sx;
    s.y *= sy;
  }
  b.w = w;
  b.h = h;
}

function enemiesOf(b: Battle, s: Ship): Ship[] {
  return b.ships.filter((o) => o.side !== s.side);
}

/** The point where a line from (x, y) toward the ship's middle meets its shield, and the angle of that point in the ship's own frame. */
export function shieldHit(target: Ship, fromX: number, fromY: number, sweep = 0): { x: number; y: number; angle: number } {
  const sh = SHIELD[target.side];
  const cos = Math.cos(target.heading);
  const sin = Math.sin(target.heading);
  // The shooter in the target's frame (the shield's centre at the origin).
  const dx = fromX - target.x;
  const dy = fromY - target.y;
  const lx = dx * cos + dy * sin - sh.cx * target.size;
  const ly = -dx * sin + dy * cos;
  const angle = Math.atan2(ly / sh.ry, lx / sh.rx) + sweep;
  const px = Math.cos(angle) * sh.rx * target.size + sh.cx * target.size;
  const py = Math.sin(angle) * sh.ry * target.size;
  return { x: target.x + px * cos - py * sin, y: target.y + px * sin + py * cos, angle };
}

/** Where a ship's beam leaves it: the saucer's rim toward the target for a starship, the beak for a warbird. */
export function emitter(s: Ship, toward: Ship): { x: number; y: number } {
  if (s.side === 'rom') return { x: s.x + Math.cos(s.heading) * s.size * 0.9, y: s.y + Math.sin(s.heading) * s.size * 0.9 };
  const sx = s.x + Math.cos(s.heading) * s.size * 0.38;
  const sy = s.y + Math.sin(s.heading) * s.size * 0.38;
  const a = Math.atan2(toward.y - sy, toward.x - sx);
  return { x: sx + Math.cos(a) * s.size * 0.42, y: sy + Math.sin(a) * s.size * 0.42 };
}

function strike(b: Battle, target: Ship, x: number, y: number, angle: number, color: string, strength: number): void {
  target.shield = Math.min(1, Math.max(target.shield, 0.55) + strength);
  target.impact = angle;
  if (target.ripples.length < 4) target.ripples.push(0);
  for (let i = 0; i < 5; i++) {
    const a = b.rand() * TAU;
    const v = 40 + b.rand() * 90;
    b.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + b.rand() * 0.35, color });
  }
}

/** Advance the battle by `dt` seconds. */
export function stepBattle(b: Battle, dt: number): void {
  b.t += dt;
  const area = bounds(b);
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;

  for (const s of b.ships) {
    // Pick (or now and then change) the enemy to fight: the nearest one.
    s.retarget -= dt;
    if (s.target < 0 || s.retarget <= 0) {
      const foes = enemiesOf(b, s);
      foes.sort((p, q) => Math.hypot(p.x - s.x, p.y - s.y) - Math.hypot(q.x - s.x, q.y - s.y));
      s.target = foes[b.rand() < 0.75 ? 0 : foes.length - 1]!.id;
      s.retarget = 6 + b.rand() * 6;
      if (b.rand() < 0.35) s.orbit = -s.orbit;
    }
    const t = b.ships[s.target]!;
    const dist = Math.hypot(t.x - s.x, t.y - s.y);
    const toTarget = Math.atan2(t.y - s.y, t.x - s.x);
    // Strafe: keep a fighting distance, swinging past the target on one side; break away when too close.
    const reach = s.size * 4.5;
    let desired = toTarget + s.orbit * (dist < reach ? 1.9 : dist < reach * 1.8 ? 1.15 : 0.45);
    // Keep clear of every other ship (friend or foe): turn away from one that comes too close.
    for (const o of b.ships) {
      if (o === s) continue;
      const gap = Math.hypot(o.x - s.x, o.y - s.y);
      const room = (o.size + s.size) * 1.6;
      if (gap < room) {
        const away = Math.atan2(s.y - o.y, s.x - o.x);
        desired = desired + wrapAngle(away - desired) * (1 - gap / room);
      }
    }
    // Stay in the area: steer back toward its middle near an edge.
    const margin = 70;
    if (s.x < area.left + margin || s.x > area.right - margin || s.y < area.top + margin || s.y > area.bottom - margin) {
      const home = Math.atan2(cy - s.y, cx - s.x);
      const push = s.x < area.left || s.x > area.right || s.y < area.top || s.y > area.bottom ? 1 : 0.6;
      desired = desired + wrapAngle(home - desired) * push;
    }
    const turn = wrapAngle(desired - s.heading);
    s.heading = wrapAngle(s.heading + Math.max(-TURN[s.side] * dt, Math.min(TURN[s.side] * dt, turn)));
    s.x += Math.cos(s.heading) * s.speed * dt;
    s.y += Math.sin(s.heading) * s.speed * dt;

    // Weapons.
    const facing = Math.abs(wrapAngle(toTarget - s.heading));
    s.beamCooldown -= dt;
    s.torpedoCooldown -= dt;
    // Phaser arrays fire in any direction; a warbird's disruptors fire forward.
    if (s.beamCooldown <= 0 && dist < BEAM_RANGE && (s.side === 'fed' || facing < 1.3)) {
      const total = s.side === 'fed' ? 0.9 + b.rand() * 0.6 : 0.5 + b.rand() * 0.4;
      b.beams.push({ from: s.id, to: t.id, life: total, total, side: s.side, sweep: (b.rand() - 0.5) * 0.5 });
      s.beamCooldown = (s.side === 'fed' ? 1.6 : 1.2) + b.rand() * 1.8;
    }
    if (s.torpedoCooldown <= 0 && dist < BEAM_RANGE * 1.2 && facing < 0.6) {
      const v = s.side === 'fed' ? 330 : 230;
      const a = s.heading + (b.rand() - 0.5) * 0.1;
      const nose = s.size * (s.side === 'fed' ? 0.6 : 0.95);
      b.torpedoes.push({ side: s.side, target: t.id, x: s.x + Math.cos(s.heading) * nose, y: s.y + Math.sin(s.heading) * nose, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 3 });
      s.torpedoCooldown = (s.side === 'fed' ? 4.5 : 6.5) + b.rand() * 4;
    }

    s.shield = Math.max(0, s.shield - dt * 1.1);
    s.ripples = s.ripples.map((r) => r + dt).filter((r) => r < 0.9);
  }

  // A beam keeps its target's shield lit where it touches it.
  for (const beam of b.beams) {
    beam.life -= dt;
    const target = b.ships[beam.to]!;
    const from = emitter(b.ships[beam.from]!, target);
    const progress = 1 - beam.life / beam.total;
    const hit = shieldHit(target, from.x, from.y, beam.sweep * (progress - 0.5));
    target.shield = Math.min(1, Math.max(target.shield, 0.7));
    target.impact = hit.angle;
    if (b.rand() < dt * 9) strike(b, target, hit.x, hit.y, hit.angle, beam.side === 'fed' ? '#ffd9a0' : '#c8ffd0', 0);
    if (progress < 0.05 && target.ripples.length < 4 && !target.ripples.some((r) => r < 0.12)) target.ripples.push(0);
  }
  b.beams = b.beams.filter((x) => x.life > 0);

  // Torpedoes home in a little and burst on the shield.
  for (const tp of b.torpedoes) {
    tp.life -= dt;
    const target = b.ships[tp.target]!;
    const want = Math.atan2(target.y - tp.y, target.x - tp.x);
    const speed = Math.hypot(tp.vx, tp.vy);
    const cur = Math.atan2(tp.vy, tp.vx);
    const next = cur + Math.max(-1.4 * dt, Math.min(1.4 * dt, wrapAngle(want - cur)));
    tp.vx = Math.cos(next) * speed;
    tp.vy = Math.sin(next) * speed;
    tp.x += tp.vx * dt;
    tp.y += tp.vy * dt;
    const hit = shieldHit(target, tp.x, tp.y);
    if (Math.hypot(target.x - tp.x, target.y - tp.y) <= Math.hypot(target.x - hit.x, target.y - hit.y) + 2) {
      strike(b, target, hit.x, hit.y, hit.angle, tp.side === 'fed' ? '#ffb070' : '#a8ffb8', 0.6);
      tp.life = 0;
    }
  }
  b.torpedoes = b.torpedoes.filter((x) => x.life > 0);

  for (const sp of b.sparks) {
    sp.life -= dt;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
    sp.vx *= 1 - dt * 2.2;
    sp.vy *= 1 - dt * 2.2;
  }
  b.sparks = b.sparks.filter((x) => x.life > 0);

  // The stars drift slowly past, the near ones faster.
  for (const st of b.stars) {
    st.x -= dt * [3, 7, 14][st.layer]!;
    if (st.x < 0) st.x += b.w;
  }
}

// ---- Drawing ----------------------------------------------------------------------------------------------------------------------

const SHIELD_RGB: Record<Side, string> = { fed: '120, 190, 255', rom: '110, 255, 170' };

function drawStarship(ctx: CanvasRenderingContext2D, t: number): void {
  // Nacelles on their pylons, behind the hull.
  ctx.strokeStyle = '#7d8696';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(-0.28, 0.07);
  ctx.lineTo(-0.5, 0.34);
  ctx.moveTo(-0.28, -0.07);
  ctx.lineTo(-0.5, -0.34);
  ctx.stroke();
  for (const side of [-1, 1]) {
    const y = side * 0.38;
    const body = ctx.createLinearGradient(0, y - 0.07, 0, y + 0.07);
    body.addColorStop(0, '#c9d1dc');
    body.addColorStop(1, '#7c8696');
    ctx.fillStyle = body;
    roundRect(ctx, -1.02, y - 0.065, 0.82, 0.13, 0.06);
    ctx.fill();
    // The glowing warp grille along each nacelle, pulsing gently.
    const pulse = 0.75 + 0.25 * Math.sin(t * 5 + side);
    ctx.fillStyle = `rgba(110, 190, 255, ${0.85 * pulse})`;
    roundRect(ctx, -0.95, y - 0.028, 0.66, 0.056, 0.028);
    ctx.fill();
    // The red collector at the front end.
    ctx.fillStyle = '#ff4a3a';
    ctx.beginPath();
    ctx.arc(-0.22, y, 0.05, 0, TAU);
    ctx.fill();
  }
  // Secondary hull and the neck to the saucer.
  const hull = ctx.createLinearGradient(0, -0.12, 0, 0.12);
  hull.addColorStop(0, '#d9dfe8');
  hull.addColorStop(1, '#8a94a5');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.ellipse(-0.3, 0, 0.34, 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(-0.02, -0.055, 0.16, 0.11);
  // The deflector's glow at the hull's front.
  ctx.fillStyle = 'rgba(255, 170, 80, 0.9)';
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.045, 0, TAU);
  ctx.fill();
  // The saucer: a disc with a rim line and the bridge dome.
  const saucer = ctx.createRadialGradient(0.32, -0.12, 0.05, 0.38, 0, 0.44);
  saucer.addColorStop(0, '#f1f4f8');
  saucer.addColorStop(1, '#8d97a8');
  ctx.fillStyle = saucer;
  ctx.beginPath();
  ctx.arc(0.38, 0, 0.42, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70, 80, 96, 0.8)';
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.arc(0.38, 0, 0.32, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#eef3fa';
  ctx.beginPath();
  ctx.arc(0.38, 0, 0.08, 0, TAU);
  ctx.fill();
  // Running lights on the saucer's rim.
  ctx.fillStyle = Math.sin(t * 3) > 0.6 ? '#ffffff' : 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath();
  ctx.arc(0.38, 0.4, 0.02, 0, TAU);
  ctx.arc(0.38, -0.4, 0.02, 0, TAU);
  ctx.fill();
}

function drawWarbird(ctx: CanvasRenderingContext2D, t: number): void {
  const green = ctx.createLinearGradient(-0.6, 0, 0.9, 0);
  green.addColorStop(0, '#1d4a35');
  green.addColorStop(1, '#3f8a63');
  // The wings, swept back, with a feathered trailing edge.
  for (const side of [-1, 1]) {
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.moveTo(0.22, side * 0.1);
    ctx.quadraticCurveTo(0.05, side * 0.75, -0.42, side * 0.92);
    ctx.lineTo(-0.5, side * 0.78);
    ctx.lineTo(-0.38, side * 0.7);
    ctx.lineTo(-0.52, side * 0.6);
    ctx.lineTo(-0.4, side * 0.5);
    ctx.lineTo(-0.56, side * 0.38);
    ctx.lineTo(-0.42, side * 0.28);
    ctx.lineTo(-0.5, side * 0.12);
    ctx.closePath();
    ctx.fill();
    // Panel lines along the wing.
    ctx.strokeStyle = 'rgba(140, 230, 175, 0.45)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0.1, side * 0.16);
    ctx.quadraticCurveTo(-0.05, side * 0.6, -0.4, side * 0.8);
    ctx.moveTo(0.02, side * 0.14);
    ctx.quadraticCurveTo(-0.15, side * 0.42, -0.42, side * 0.5);
    ctx.stroke();
  }
  // The body, the long neck and the beaked head.
  ctx.fillStyle = '#2f6e4f';
  ctx.beginPath();
  ctx.ellipse(-0.05, 0, 0.36, 0.15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3c855f';
  ctx.beginPath();
  ctx.moveTo(1.0, 0);
  ctx.lineTo(0.72, 0.09);
  ctx.lineTo(0.3, 0.055);
  ctx.lineTo(0.3, -0.055);
  ctx.lineTo(0.72, -0.09);
  ctx.closePath();
  ctx.fill();
  // The tail fan.
  ctx.fillStyle = '#24573f';
  ctx.beginPath();
  ctx.moveTo(-0.36, 0);
  ctx.lineTo(-0.66, 0.16);
  ctx.lineTo(-0.6, 0);
  ctx.lineTo(-0.66, -0.16);
  ctx.closePath();
  ctx.fill();
  // The glowing emitter in the beak and the engine glow at the tail.
  const pulse = 0.7 + 0.3 * Math.sin(t * 4);
  ctx.fillStyle = `rgba(120, 255, 160, ${pulse})`;
  ctx.beginPath();
  ctx.arc(0.84, 0, 0.045, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(90, 255, 150, ${0.55 * pulse})`;
  ctx.beginPath();
  ctx.ellipse(-0.42, 0, 0.06, 0.1, 0, 0, TAU);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** The shield: an ellipse around the ship, lit from the impact point, with ripples running out from it. Drawn in the ship's frame (unit = size). */
function drawShield(ctx: CanvasRenderingContext2D, s: Ship): void {
  if (s.shield <= 0.01 && s.ripples.length === 0) return;
  const sh = SHIELD[s.side];
  const rgb = SHIELD_RGB[s.side];
  const ix = sh.cx + Math.cos(s.impact) * sh.rx;
  const iy = Math.sin(s.impact) * sh.ry;
  const a = s.shield;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(sh.cx, 0, sh.rx, sh.ry, 0, 0, TAU);
  const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, sh.rx * 2);
  glow.addColorStop(0, `rgba(${rgb}, ${0.5 * a})`);
  glow.addColorStop(0.35, `rgba(${rgb}, ${0.16 * a})`);
  glow.addColorStop(1, `rgba(${rgb}, ${0.03 * a})`);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = `rgba(${rgb}, ${0.55 * a})`;
  ctx.stroke();
  // The ripples, kept inside the bubble.
  ctx.clip();
  for (const r of s.ripples) {
    const k = r / 0.9;
    ctx.strokeStyle = `rgba(${rgb}, ${0.6 * (1 - k)})`;
    ctx.lineWidth = 0.035 * (1 - k) + 0.01;
    ctx.beginPath();
    ctx.arc(ix, iy, 0.1 + k * 1.3, 0, TAU);
    ctx.stroke();
  }
  // The hot spot where the hit lands.
  const spot = ctx.createRadialGradient(ix, iy, 0, ix, iy, 0.28);
  spot.addColorStop(0, `rgba(255, 255, 255, ${0.85 * a})`);
  spot.addColorStop(0.4, `rgba(${rgb}, ${0.5 * a})`);
  spot.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = spot;
  ctx.fillRect(ix - 0.3, iy - 0.3, 0.6, 0.6);
  ctx.restore();
}

function drawBeam(ctx: CanvasRenderingContext2D, b: Battle, beam: Beam): void {
  const shooter = b.ships[beam.from]!;
  const target = b.ships[beam.to]!;
  const from = emitter(shooter, target);
  const progress = 1 - beam.life / beam.total;
  const hit = shieldHit(target, from.x, from.y, beam.sweep * (progress - 0.5));
  // Fade in and out over the first and last tenth of a second.
  const a = Math.min(1, (beam.total - beam.life) / 0.1, beam.life / 0.1);
  const outer = beam.side === 'fed' ? `rgba(255, 120, 30, ${0.35 * a})` : `rgba(60, 255, 110, ${0.32 * a})`;
  const core = beam.side === 'fed' ? `rgba(255, 226, 150, ${a})` : `rgba(210, 255, 210, ${a})`;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outer;
  ctx.lineWidth = beam.side === 'fed' ? 7 : 6;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(hit.x, hit.y);
  ctx.stroke();
  ctx.strokeStyle = core;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawTorpedo(ctx: CanvasRenderingContext2D, tp: Torpedo, t: number): void {
  const r = tp.side === 'fed' ? 6 : 9;
  const color = tp.side === 'fed' ? '255, 110, 60' : '90, 255, 140';
  const g = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, r * 2.4);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.25, `rgba(${color}, 0.9)`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, r * 2.4, 0, TAU);
  ctx.fill();
  // A twinkling star flare across it.
  const f = r * (2.6 + Math.sin(t * 30) * 0.6);
  ctx.strokeStyle = `rgba(${color}, 0.7)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tp.x - f, tp.y);
  ctx.lineTo(tp.x + f, tp.y);
  ctx.moveTo(tp.x, tp.y - f * 0.6);
  ctx.lineTo(tp.x, tp.y + f * 0.6);
  ctx.stroke();
}

/** A faint nebula behind the stars (drawn once into its own canvas by the component). */
export function drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const clouds: [string, number][] = [
    ['90, 60, 160', 0.16],
    ['40, 90, 170', 0.12],
    ['160, 70, 120', 0.08],
  ];
  for (const [rgb, alpha] of clouds) {
    const x = w * (0.15 + rand() * 0.7);
    const y = h * (0.1 + rand() * 0.45);
    const r = Math.max(w, h) * (0.25 + rand() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

export function drawBattle(ctx: CanvasRenderingContext2D, b: Battle, nebula: CanvasImageSource | null): void {
  if (nebula) ctx.drawImage(nebula, 0, 0, b.w, b.h);
  else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, b.w, b.h);
  }
  for (const st of b.stars) {
    const twinkle = 0.65 + 0.35 * Math.sin(b.t * (1.5 + st.layer) + st.phase);
    ctx.fillStyle = `rgba(230, 236, 255, ${[0.35, 0.6, 0.9][st.layer]! * twinkle})`;
    const size = [1, 1.4, 2][st.layer]!;
    ctx.fillRect(st.x, st.y, size, size);
  }
  // Beams under the ships, so a beam leaves from the hull's edge.
  for (const beam of b.beams) drawBeam(ctx, b, beam);
  for (const s of b.ships) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.heading);
    ctx.scale(s.size, s.size);
    if (s.side === 'fed') drawStarship(ctx, b.t + s.id);
    else drawWarbird(ctx, b.t + s.id);
    drawShield(ctx, s);
    ctx.restore();
  }
  for (const tp of b.torpedoes) drawTorpedo(ctx, tp, b.t);
  for (const sp of b.sparks) {
    ctx.globalAlpha = Math.min(1, sp.life * 2.5);
    ctx.fillStyle = sp.color;
    ctx.fillRect(sp.x - 1, sp.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}
