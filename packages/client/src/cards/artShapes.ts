/** SVG path strings for the frame's procedural art and type emblems. Pure: numbers in, a path `d` out. */

/** Round to one decimal: keeps the markup short. */
export const n1 = (n: number): number => Math.round(n * 10) / 10;

export type Rng = () => number;
export const between = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);

/** A filled circle as a closed subpath (several of them in one path draw a union when filled). */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${n1(cx - r)} ${n1(cy)}a${n1(r)} ${n1(r)} 0 1 0 ${n1(2 * r)} 0a${n1(r)} ${n1(r)} 0 1 0 ${n1(-2 * r)} 0Z`;
}

/** A gear with a center hole (fill-rule evenodd). */
export function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number, hole: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const w = step * 0.2;
    const at = (ang: number, r: number) => `${n1(cx + Math.cos(ang) * r)} ${n1(cy + Math.sin(ang) * r)}`;
    pts.push(at(a - step * 0.5 + w * 0.4, inner), at(a - w, outer), at(a + w, outer), at(a + step * 0.5 - w * 0.4, inner));
  }
  return `M${pts.join('L')}Z${circlePath(cx, cy, hole)}`;
}

/** A four-pointed sparkle. */
export function sparklePath(x: number, y: number, s: number): string {
  const q = s * 0.12;
  return `M${n1(x)} ${n1(y - s)}Q${n1(x + q)} ${n1(y - q)} ${n1(x + s)} ${n1(y)}Q${n1(x + q)} ${n1(y + q)} ${n1(x)} ${n1(y + s)}Q${n1(x - q)} ${n1(y + q)} ${n1(x - s)} ${n1(y)}Q${n1(x - q)} ${n1(y - q)} ${n1(x)} ${n1(y - s)}Z`;
}

/** A flame tongue standing on `base`, leaning by `lean`. */
export function flamePath(cx: number, base: number, w: number, h: number, lean: number): string {
  const L = cx - w / 2;
  const R = cx + w / 2;
  return `M${n1(L)} ${n1(base)}C${n1(L - 1)} ${n1(base - h * 0.4)} ${n1(cx - w * 0.15 + lean * 0.4)} ${n1(base - h * 0.62)} ${n1(cx + lean)} ${n1(base - h)}C${n1(cx + w * 0.2 + lean * 0.5)} ${n1(base - h * 0.55)} ${n1(R + 1)} ${n1(base - h * 0.35)} ${n1(R)} ${n1(base)}Z`;
}

/** A leaf from (x, y) pointing at `angle` (radians), `s` long. */
export function leafPath(x: number, y: number, s: number, angle: number): string {
  const ex = x + Math.cos(angle) * s;
  const ey = y + Math.sin(angle) * s;
  const nx = -Math.sin(angle) * s * 0.35;
  const ny = Math.cos(angle) * s * 0.35;
  const mx = (x + ex) / 2;
  const my = (y + ey) / 2;
  return `M${n1(x)} ${n1(y)}Q${n1(mx + nx)} ${n1(my + ny)} ${n1(ex)} ${n1(ey)}Q${n1(mx - nx)} ${n1(my - ny)} ${n1(x)} ${n1(y)}Z`;
}

/** A puffy cloud: overlapping circles (fill them to draw the union). */
export function cloudPath(cx: number, cy: number, s: number): string {
  return [circlePath(cx, cy, s * 0.5), circlePath(cx - s * 0.6, cy + s * 0.12, s * 0.38), circlePath(cx + s * 0.62, cy + s * 0.14, s * 0.42), circlePath(cx + s * 0.1, cy - s * 0.3, s * 0.38), circlePath(cx - s * 0.25, cy + s * 0.2, s * 0.4)].join('');
}

/**
 * A wavy horizontal line across the art (x from -4 to 104) and the area under (or over) it. The line is one smooth chain of quadratic curves, so a
 * sea or a ridge reads as water or hills, not as a polyline.
 */
export function wavy(rng: Rng, y: number, amp: number, n: number, fillTo: number): { line: string; area: string } {
  const x0 = -4;
  const span = 108;
  const seg = span / n;
  let line = `M${x0} ${n1(y + between(rng, -amp, amp))}Q${n1(x0 + seg / 2)} ${n1(y + between(rng, -amp * 1.6, amp * 1.6))} ${n1(x0 + seg)} ${n1(y + between(rng, -amp, amp))}`;
  for (let i = 2; i <= n; i++) line += `T${n1(x0 + seg * i)} ${n1(y + between(rng, -amp, amp))}`;
  return { line, area: `${line}L104 ${fillTo}L${x0} ${fillTo}Z` };
}

/** A jagged mountain range: peaks between `hMin` and `hMax` above `base`. Returns the silhouette and the lit left faces of its peaks. */
export function peaks(rng: Rng, base: number, hMin: number, hMax: number, n: number): { shape: string; lit: string } {
  const seg = 112 / n;
  let shape = `M-6 72L-6 ${n1(base)}`;
  let lit = '';
  let vx = -6;
  let vy = base;
  for (let i = 0; i < n; i++) {
    const px = -6 + seg * (i + 0.5) + between(rng, -seg * 0.18, seg * 0.18);
    const py = base - between(rng, hMin, hMax);
    const nx = -6 + seg * (i + 1);
    const ny = base + between(rng, -2, 5);
    shape += `L${n1(px)} ${n1(py)}L${n1(nx)} ${n1(ny)}`;
    lit += `M${n1(px)} ${n1(py)}L${n1(vx)} ${n1(vy)}L${n1(px - 0.5)} ${n1(Math.max(vy, ny) + 2)}Z`;
    vx = nx;
    vy = ny;
  }
  return { shape: `${shape}L106 72Z`, lit };
}

/** A row of stacked-triangle pines. */
export function pines(rng: Rng, base: number, hMin: number, hMax: number, n: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = (100 / n) * (i + 0.5) + between(rng, -3, 3);
    const h = between(rng, hMin, hMax);
    const w = h * 0.42;
    for (let t = 0; t < 3; t++) {
      const top = base - h + t * h * 0.27;
      const bot = top + h * 0.42;
      const hw = w * (0.32 + 0.2 * t);
      d += `M${n1(x)} ${n1(top)}L${n1(x + hw)} ${n1(bot)}L${n1(x - hw)} ${n1(bot)}Z`;
    }
  }
  return d;
}

/** Small round dots (embers, bubbles, stars, fireflies). */
export function dots(rng: Rng, n: number, x0: number, x1: number, y0: number, y1: number, rMin: number, rMax: number): string {
  let d = '';
  for (let i = 0; i < n; i++) d += circlePath(between(rng, x0, x1), between(rng, y0, y1), between(rng, rMin, rMax));
  return d;
}

/** An Archimedean spiral around (cx, cy). */
export function spiralPath(cx: number, cy: number, r0: number, r1: number, turns: number, phase: number): string {
  const steps = Math.round(turns * 14);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = phase + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    d += `${i === 0 ? 'M' : 'L'}${n1(cx + Math.cos(a) * r)} ${n1(cy + Math.sin(a) * r * 0.78)}`;
  }
  return d;
}

/** Rays fanning from a point: `n` thin triangles. */
export function raysPath(sx: number, sy: number, n: number, len: number, halfWidth: number, phase: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = phase + (i * Math.PI * 2) / n;
    d += `M${n1(sx)} ${n1(sy)}L${n1(sx + Math.cos(a - halfWidth) * len)} ${n1(sy + Math.sin(a - halfWidth) * len)}L${n1(sx + Math.cos(a + halfWidth) * len)} ${n1(sy + Math.sin(a + halfWidth) * len)}Z`;
  }
  return d;
}

/** A lumpy mass hanging from the top edge (clouds, canopy, smoke). */
export function ceiling(rng: Rng, y: number, amp: number, n: number): string {
  const w = wavy(rng, y, amp, n, -4);
  return w.area;
}
