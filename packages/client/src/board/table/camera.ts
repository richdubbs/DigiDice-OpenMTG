/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1 "The camera follows the mouse"): the shared table's camera, as pure math plus a small rig with an injected
 * clock, so every limit is tested without a browser.
 *
 * The scene is drawn with CSS 3D transforms on the existing DOM board (5.1 "Rendering approach"): the table plane is one flat element under
 *
 *   scene:  translate(pan)                                    (2D, applied to the projected picture: a pan is a pure screen shift)
 *   camera: scale(zoom * fit) rotateX(pitch) rotateZ(yaw)     (the plane turned round its normal, tilted away, then scaled)
 *
 * with the scene's `perspective` P and its origin at the scene's centre. A point (x, y) of the plane (from its centre, y down) lands on screen at
 * pan + s * (x', y') * P / (P - z') where (x', y', z') is the point turned by yaw then tilted by pitch: the zoom is an exact 2D scale of the picture
 * about the centre, which is what makes "zoom around the pointer" exact (zoomAt).
 *
 * Limits (5.1): yaw within ±14°, pitch between 24° and 46° (the plane's tilt: the far side comes forward, "looking further across", as the pointer goes
 * up; the viewer's own side comes forward as it goes down), zoom 0.8x to 1.6x, a small pan toward the pointed quadrant; a dead zone in the middle third
 * of the table keeps the camera still in normal play. The camera eases toward its target with a critically damped spring that settles in about 250 ms
 * and never overshoots, and holds still while a card is dragged, an animation job runs or a card zoom is open.
 */

export interface CameraPose {
  /** Degrees round the table's normal (rotateZ); positive brings the right side of the far seats toward the camera. */
  yaw: number;
  /** The table's tilt away from the camera, degrees (rotateX). */
  pitch: number;
  zoom: number;
  /** Screen pan as a fraction of the scene's width and height. */
  panX: number;
  panY: number;
}

export const CAMERA_LIMITS = {
  yaw: 14,
  pitchMin: 24,
  pitchMax: 46,
  zoomMin: 0.8,
  zoomMax: 1.6,
  /** The pan, as a fraction of the scene's size, either way. */
  panX: 0.32,
  panY: 0.26,
  /** The middle third of the table (a half-width of 1/3 in pointer units -1..1) keeps the camera still. */
  deadZone: 1 / 3,
  /** How far the pointer's follow pans toward the pointed quadrant (fraction of the scene). */
  followPanX: 0.07,
  followPanY: 0.06,
} as const;

/** The resting tilt: the whole table framed, both sides readable. */
export const REST_PITCH = 34;
export const REST_POSE: CameraPose = { yaw: 0, pitch: REST_PITCH, zoom: 1, panX: 0, panY: 0 };

/** About 250 ms to settle within 2% (critically damped: (1 + wt) e^-wt = 0.02 at wt = 5.83). */
export const SETTLE_MS = 250;
export const SPRING_OMEGA = 5.83 / (SETTLE_MS / 1000);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampPose(p: CameraPose): CameraPose {
  const L = CAMERA_LIMITS;
  return {
    yaw: clamp(p.yaw, -L.yaw, L.yaw),
    pitch: clamp(p.pitch, L.pitchMin, L.pitchMax),
    zoom: clamp(p.zoom, L.zoomMin, L.zoomMax),
    panX: clamp(p.panX, -L.panX, L.panX),
    panY: clamp(p.panY, -L.panY, L.panY),
  };
}

/** One pointer coordinate (-1..1 across the table) with the dead zone taken out: 0 in the middle third, then linear to ±1 at the edge. */
export function deadZone(v: number): number {
  const a = Math.abs(v);
  const dz = CAMERA_LIMITS.deadZone;
  if (!Number.isFinite(v) || a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** What the pointer adds to the camera's framing: `nx`, `ny` from -1 (left, top) to 1 (right, bottom) over the table. */
export function followOffsets(nx: number, ny: number): Omit<CameraPose, 'zoom'> {
  const L = CAMERA_LIMITS;
  const ex = deadZone(nx);
  const ey = deadZone(ny);
  return {
    yaw: ex * L.yaw,
    // Up: the far side tilts toward the camera (down to 24°); down: the near side comes forward (up to 46°).
    pitch: ey < 0 ? ey * (REST_PITCH - L.pitchMin) : ey * (L.pitchMax - REST_PITCH),
    // The pointed quadrant moves toward the middle of the screen.
    panX: -ex * L.followPanX,
    panY: -ey * L.followPanY,
  };
}

/**
 * One step of a critically damped spring toward `target` (exact for any `dt`, seconds), clamped so it never overshoots: a step that would cross the
 * target stops on it.
 */
export function springStep(x: number, v: number, target: number, dt: number, omega = SPRING_OMEGA): [number, number] {
  const d = x - target;
  if (d === 0 && v === 0) return [x, 0];
  const e = Math.exp(-omega * dt);
  const c = v + omega * d;
  let nx = target + (d + c * dt) * e;
  let nv = (v - omega * c * dt) * e;
  if (d !== 0 && Math.sign(nx - target) !== Math.sign(d)) {
    nx = target;
    nv = 0;
  }
  return [nx, nv];
}

// ---- projection -----------------------------------------------------------------------------------------------------------------

/** The scene's sizes in CSS pixels and the camera's fit (the scale and shift that frame the whole table at rest). */
export interface TableGeometry {
  /** The scene (the table area above the HUD strip). */
  w: number;
  h: number;
  /** The table plane (centred in the scene before the camera). */
  planeW: number;
  planeH: number;
  /** CSS perspective distance. */
  perspective: number;
  fit: { s: number; dx: number; dy: number };
}

/** A plane point turned by yaw then tilted by pitch (CSS rotateZ then rotateX, y down, z toward the viewer). */
function turn(pose: CameraPose, x: number, y: number): [number, number, number] {
  const a = (pose.yaw * Math.PI) / 180;
  const b = (pose.pitch * Math.PI) / 180;
  const x1 = x * Math.cos(a) - y * Math.sin(a);
  const y1 = x * Math.sin(a) + y * Math.cos(a);
  return [x1, y1 * Math.cos(b), y1 * Math.sin(b)];
}

/** The unscaled perspective picture of a plane point (relative to the scene's centre), and the local scale there. */
function picture(pose: CameraPose, perspective: number, x: number, y: number): { x: number; y: number; f: number } {
  const [px, py, pz] = turn(pose, x, y);
  const f = perspective / Math.max(1, perspective - pz);
  return { x: px * f, y: py * f, f };
}

/** The table's geometry for a scene of `w` x `h`: the plane is the scene's width and a little taller (the tilt shortens it), framed at rest. */
export function tableGeometry(w: number, h: number): TableGeometry {
  const planeW = Math.max(1, w);
  const planeH = Math.max(1, h * 1.12);
  const perspective = Math.max(600, 1.3 * Math.max(w, h));
  const corners = [
    picture(REST_POSE, perspective, -planeW / 2, -planeH / 2),
    picture(REST_POSE, perspective, planeW / 2, -planeH / 2),
    picture(REST_POSE, perspective, -planeW / 2, planeH / 2),
    picture(REST_POSE, perspective, planeW / 2, planeH / 2),
  ];
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  const s = Math.min((w * 0.985) / Math.max(1, maxX - minX), (h * 0.985) / Math.max(1, maxY - minY));
  // The tilted plane's picture sits low (its near edge is magnified): shift it so its box is centred.
  return { w, h, planeW, planeH, perspective, fit: { s, dx: -((minX + maxX) / 2) * s, dy: -((minY + maxY) / 2) * s } };
}

/** Where a plane point (from the plane's centre, CSS pixels) is drawn on screen, relative to the scene's centre, and the local scale there. */
export function projectPoint(pose: CameraPose, g: TableGeometry, x: number, y: number): { x: number; y: number; scale: number } {
  const p = picture(pose, g.perspective, x, y);
  const s = pose.zoom * g.fit.s;
  return { x: g.fit.dx + pose.panX * g.w + s * p.x, y: g.fit.dy + pose.panY * g.h + s * p.y, scale: s * p.f };
}

/** The projected rectangle (bounding box, scene-centre coordinates) of a plane rectangle: what `getBoundingClientRect` reports for an element on the table. */
export function projectRect(pose: CameraPose, g: TableGeometry, r: { x: number; y: number; w: number; h: number }): { left: number; top: number; right: number; bottom: number } {
  const pts = [
    projectPoint(pose, g, r.x, r.y),
    projectPoint(pose, g, r.x + r.w, r.y),
    projectPoint(pose, g, r.x, r.y + r.h),
    projectPoint(pose, g, r.x + r.w, r.y + r.h),
  ];
  return { left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), top: Math.min(...pts.map((p) => p.y)), bottom: Math.max(...pts.map((p) => p.y)) };
}

/** The projected width of a card `w` wide whose centre is at plane point (x, y). */
export function projectedWidth(pose: CameraPose, g: TableGeometry, x: number, y: number, w: number): number {
  const a = projectPoint(pose, g, x - w / 2, y);
  const b = projectPoint(pose, g, x + w / 2, y);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Compact faces below about 70 projected pixels (5.1 "Readability"), with a little hysteresis so a seat does not flicker between the two. */
export const COMPACT_BELOW = 70;
export const FULL_ABOVE = 78;
export function nextCompact(wasCompact: boolean, projected: number): boolean {
  if (!(projected > 0)) return wasCompact;
  return wasCompact ? projected < FULL_ABOVE : projected < COMPACT_BELOW;
}

/** The CSS transforms of the pose: the scene's 2D pan, and the camera on the plane. */
export function cameraTransforms(pose: CameraPose, g: TableGeometry): { scene: string; camera: string } {
  const px = (g.fit.dx + pose.panX * g.w).toFixed(2);
  const py = (g.fit.dy + pose.panY * g.h).toFixed(2);
  return {
    scene: `translate(${px}px, ${py}px)`,
    camera: `scale(${(pose.zoom * g.fit.s).toFixed(4)}) rotateX(${pose.pitch.toFixed(3)}deg) rotateZ(${pose.yaw.toFixed(3)}deg)`,
  };
}

// ---- the measured fallback ------------------------------------------------------------------------------------------------------

/** Frames the camera times while it moves before it decides how to follow on this machine. */
export const PERF_SAMPLES = 90;

/**
 * 5.1 "Performance": the measured fallback. From the frame intervals (ms) timed while the camera moved: 'full' at 45 fps or better (median), 'half' (the
 * camera is drawn every other frame) below that, 'off' (following is turned off; zoom and pan by wheel, keys and chips stay) below 30 fps. Too few samples:
 * 'full' (nothing measured yet).
 */
export function cameraPerfMode(intervals: readonly number[]): 'full' | 'half' | 'off' {
  if (intervals.length < PERF_SAMPLES) return 'full';
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (median > 1000 / 30) return 'off';
  if (median > 1000 / 45) return 'half';
  return 'full';
}

// ---- the rig ----------------------------------------------------------------------------------------------------------------------

/** Why the camera holds still (5.1): a card being dragged, an animation job running, a card zoom open. */
export interface HoldReasons {
  dragging: boolean;
  animating: boolean;
  zoomOpen: boolean;
}
export function cameraHeld(r: HoldReasons): boolean {
  return r.dragging || r.animating || r.zoomOpen;
}

const POSE_KEYS = ['yaw', 'pitch', 'zoom', 'panX', 'panY'] as const;
const EPS: Record<(typeof POSE_KEYS)[number], number> = { yaw: 0.01, pitch: 0.01, zoom: 0.0005, panX: 0.0002, panY: 0.0002 };

/**
 * The camera's state: where it is (`pose`), and what it aims at: the seat's framing (`base`: rest, or a seat view), the pointer's follow offsets and the
 * player's own zoom and pan (wheel, keys). `step` moves it; nothing here touches the DOM or reads a clock (the driver passes the elapsed time).
 */
export class CameraRig {
  pose: CameraPose = { ...REST_POSE };
  private vel: CameraPose = { yaw: 0, pitch: 0, zoom: 0, panX: 0, panY: 0 };
  private base: CameraPose = { ...REST_POSE };
  private follow: Omit<CameraPose, 'zoom'> = { yaw: 0, pitch: 0, panX: 0, panY: 0 };
  private user = { zoom: 1, panX: 0, panY: 0 };
  /** F toggles it; off: the camera stays on the seat's framing (plus the player's own zoom and pan). */
  following = true;
  /** Reduced motion (prefers-reduced-motion, or Settings "Camera follows the mouse: off"): a static camera, every change applied without easing. */
  reduced = false;

  target(): CameraPose {
    const f = this.following && !this.reduced ? this.follow : { yaw: 0, pitch: 0, panX: 0, panY: 0 };
    return clampPose({
      yaw: this.base.yaw + f.yaw,
      pitch: this.base.pitch + f.pitch,
      zoom: this.base.zoom * this.user.zoom,
      panX: this.base.panX + f.panX + this.user.panX,
      panY: this.base.panY + f.panY + this.user.panY,
    });
  }

  /** The pointer over the table, -1..1 each way from its centre. */
  pointer(nx: number, ny: number): void {
    if (!this.following || this.reduced) return;
    this.follow = followOffsets(nx, ny);
  }

  /** The seat's framing (rest, or looking from another seat). */
  setBase(p: Partial<CameraPose>): void {
    this.base = { ...REST_POSE, ...p };
    this.snapIfReduced();
  }

  /** Zoom by `factor` keeping the screen point `at` (pixels from the scene's centre) where it is; at the centre without `at`. */
  zoomAt(factor: number, g: TableGeometry, at?: { x: number; y: number }): void {
    const now = this.target();
    const zoom = clamp(now.zoom * factor, CAMERA_LIMITS.zoomMin, CAMERA_LIMITS.zoomMax);
    const k = zoom / now.zoom;
    this.user.zoom = zoom / this.base.zoom;
    if (at && k !== 1) {
      // picture = pan + s * u: keep u under the pointer (q = pan + s u = pan' + s' u)
      const panPx = { x: g.fit.dx + now.panX * g.w, y: g.fit.dy + now.panY * g.h };
      const nx = at.x - k * (at.x - panPx.x);
      const ny = at.y - k * (at.y - panPx.y);
      this.user.panX += (nx - panPx.x) / g.w;
      this.user.panY += (ny - panPx.y) / g.h;
    }
    this.clampUser();
    this.snapIfReduced();
  }

  /** Pan by a fraction of the scene (keys, buttons). */
  panBy(dx: number, dy: number): void {
    this.user.panX += dx;
    this.user.panY += dy;
    this.clampUser();
    this.snapIfReduced();
  }

  /** Home / the Recentre chip: back to the seat's framing (the player's zoom and pan and the pointer's follow are dropped). */
  recentre(): void {
    this.user = { zoom: 1, panX: 0, panY: 0 };
    this.follow = { yaw: 0, pitch: 0, panX: 0, panY: 0 };
    this.snapIfReduced();
  }

  toggleFollow(): boolean {
    this.following = !this.following;
    if (!this.following) this.follow = { yaw: 0, pitch: 0, panX: 0, panY: 0 };
    return this.following;
  }

  setReduced(on: boolean): void {
    this.reduced = on;
    if (on) this.follow = { yaw: 0, pitch: 0, panX: 0, panY: 0 };
    this.snapIfReduced();
  }

  /** Whether the camera is where it aims (within a hair) and at rest. */
  settled(): boolean {
    const t = this.target();
    return POSE_KEYS.every((k) => Math.abs(this.pose[k] - t[k]) < EPS[k] && Math.abs(this.vel[k]) < EPS[k] * 10);
  }

  /**
   * Advance `dtMs` milliseconds. Held (dragging, an animation, a zoom open): the camera stays exactly where it is. Returns whether it still moves.
   */
  step(dtMs: number, held = false): boolean {
    if (held) {
      this.vel = { yaw: 0, pitch: 0, zoom: 0, panX: 0, panY: 0 };
      return false;
    }
    const t = this.target();
    if (this.reduced) {
      this.pose = t;
      return false;
    }
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    const pose = { ...this.pose };
    const vel = { ...this.vel };
    for (const k of POSE_KEYS) [pose[k], vel[k]] = springStep(this.pose[k], this.vel[k], t[k], dt);
    this.pose = pose;
    this.vel = vel;
    if (this.settled()) {
      this.pose = t;
      this.vel = { yaw: 0, pitch: 0, zoom: 0, panX: 0, panY: 0 };
      return false;
    }
    return true;
  }

  private clampUser(): void {
    const L = CAMERA_LIMITS;
    this.user.zoom = clamp(this.base.zoom * this.user.zoom, L.zoomMin, L.zoomMax) / this.base.zoom;
    this.user.panX = clamp(this.user.panX, -L.panX - this.base.panX, L.panX - this.base.panX);
    this.user.panY = clamp(this.user.panY, -L.panY - this.base.panY, L.panY - this.base.panY);
  }

  private snapIfReduced(): void {
    if (this.reduced) {
      this.pose = this.target();
      this.vel = { yaw: 0, pitch: 0, zoom: 0, panX: 0, panY: 0 };
    }
  }
}
