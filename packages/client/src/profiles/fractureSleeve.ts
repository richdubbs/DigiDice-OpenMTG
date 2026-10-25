/**
 * The Reality Fracture template's card sleeves (CardBack, the deck box). Like the DigiDice sleeves (branding/sleeves.ts) a deck's sleeve is the one of
 * its colors, never chosen; this look draws it its own way, as SVG, after the set's Shattered Mirror cards (shards of the original card breaking
 * through the new one), its Facet foil and Hexhaven's stairs:
 *
 * - underneath, the DigiDice card back: its dots, its glowing circuit lines and pads, its dice, in the colors the DigiDice sleeve of the deck's
 *   colors uses;
 * - over it a pane of smoky glass, broken: separate pieces lying a little apart (furthest apart round the hole), each moved and turned a little and
 *   casting its shadow on the card, each bending the card seen through it a few pixels out of line (so the circuit jumps at every crack), one cut
 *   edge of each lit in the deck's light and the edges facing away dark; a soft reflection across a few of the big pieces, a band of Facet foil in
 *   a few, some hairline cracks that held. Two big pieces are mirror, silver turning lilac with a hard streak of light; two show the echo world
 *   breaking through, the card back seen mirrored in violet. The first cracks the blow made are the brightest lines after the logo, lit along one
 *   side and dark along the other. In the middle the DigiDice logo broke through: a ragged hole, slivers round it and bigger pieces further out, the
 *   pieces round the hole lifted, a few small ones still in flight; two more pieces and their echoes fell out, a die where each was;
 * - the logo, large and single, recolored to the deck's colors the way the DigiDice sleeves recolor it (its blue to the first color, its magenta
 *   to the second, white kept), on its black chip, the split shown as light round the chip: the first color on the left, the second on the right;
 * - the frame: rules of metal in the deck's colors, the mirror's corners stepped like Hexhaven's stairs, split-diamond studs, and the serial
 *   DIGIDICE · RF-<colors> · ECHO at the top and upside down at the bottom, as the DigiDice sleeves carry theirs.
 *
 * Drawn small (a card in a hand or on a pile, SMALL_SLEEVE pixels wide or less) the fine detail would only blur: a media query inside the picture
 * (it follows the size the picture is drawn at) drops it, veils the circuit, and draws three of the first cracks and their echoes bold, with the two
 * mirror pieces lit.
 *
 * The pattern is the same when the card is turned round (the bottom half is the top half's echo), so the opponent's view of a back is the same back.
 * Each sleeve is two pictures, as the DigiDice ones are: the still card back, and its moving lights on a layer of their own (the hole's light
 * breathing, a light running round the edges of the lifted pieces, their sharp corners glinting, a foil sweep over the foil pieces, pulses along the
 * circuit where it shows, a light round the logo's border and one round the frame, the studs glinting; small, only the logo's and the frame's). The break is the same on every sleeve (one
 * seed), so every deck carries the same mirror in its own colors. The pictures are made once per sleeve; the page shows them through blob: URLs (data:
 * URLs where there is no URL.createObjectURL), which the page's img-src allows, and the only image inside them, the logo, is embedded, so nothing is
 * fetched.
 */
import type { Color } from '@openmtg/engine';
import markPng from '../../../../assets/brand/sleeves/fracture-mark.png?inline';
import { sleeveById } from '../branding/sleeves';
import { mix, seeded, type Pt } from './fracture';

export const SLEEVE_W = 745;
export const SLEEVE_H = 1040;
const RADIUS = 38;
const CX = SLEEVE_W / 2;
const CY = SLEEVE_H / 2;
/** The middle of the mirror, where it was struck and where the logo sits. */
export const IMPACT: Pt = { x: CX, y: CY };
/** The frame's outer rule: an octagon `inset` from the card's edge, its corners cut by `cut`. */
const OUTER = { inset: 20, cut: 54 };
/** The mirror inside the frame (wider bands at the top and bottom, for the serial); its corners are stairs of STEPS steps of STEP. */
const MIRROR = { left: 58, top: 86, right: SLEEVE_W - 58, bottom: SLEEVE_H - 86 };
const STEPS = 5;
const STEP = 17;
/** The logo's size (its chip is the middle 80% of it). */
const LOGO = 330;
/** The logo's own outer border, a rounded square (measured on its picture: 287 of its 360 pixels across, corners of 27), in sleeve units. */
const LOGO_BORDER = { half: (LOGO * 143.5) / 360, radius: (LOGO * 27) / 360 };
/** The widest a sleeve is drawn (in CSS pixels) to count as small: a card in a hand or on a pile. */
const SMALL_SLEEVE = 130;
/** The echo world's violet (the template's own echo), in which the echo pieces show the card back. */
const ECHO_VIOLET = '#b48cff';

function hsv(h: number, s: number, v = 1): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The five colors as light in the glass: the DigiDice sleeves' neons (scripts/brand/make-cardback.py MANA), so a deck reads the same in every look. */
export const MANA_LIGHT: Readonly<Record<Color, string>> = {
  W: hsv(45, 0.62),
  U: hsv(198, 0.9),
  B: hsv(272, 0.62),
  R: hsv(6, 0.82),
  G: hsv(145, 0.82),
};

/** A neighbouring light for a one-color sleeve's second tone (the same neighbours the DigiDice sleeves use). */
const MANA_NEIGHBOUR: Readonly<Record<Color, string>> = {
  W: hsv(56, 0.55),
  U: hsv(186, 0.8),
  B: hsv(255, 0.5),
  R: hsv(28, 0.85),
  G: hsv(90, 0.75),
};

/** The colorless sleeve: the template's own palette (theme/fracture.css), and the DigiDice blue and magenta for the circuit underneath. */
const CLASSIC = { light: '#ffc965', dark: '#a463ff', accents: ['#ffc965', '#4cb8ff', '#a463ff'], circuit: ['#1fb8ff', '#f500f5'] };

export interface SleevePalette {
  /** The left, lit half: the logo's blue becomes this. */
  light: string;
  /** The right, dark half: the logo's magenta becomes this. */
  dark: string;
  /** The colors of the glass, in their order round the mirror (left half first). */
  accents: string[];
  /** The colors of the DigiDice back underneath: those of the DigiDice sleeve of the same colors. */
  circuit: string[];
  /** Whether the logo keeps the DigiDice colors (the colorless sleeve). */
  brand: boolean;
}

export function sleevePalette(colors: readonly Color[]): SleevePalette {
  if (colors.length === 0) return { ...CLASSIC, accents: [...CLASSIC.accents], circuit: [...CLASSIC.circuit], brand: true };
  const first = MANA_LIGHT[colors[0]!];
  if (colors.length === 1) {
    const second = MANA_NEIGHBOUR[colors[0]!];
    return { light: first, dark: second, accents: [first, second], circuit: [first, second], brand: false };
  }
  const all = colors.map((c) => MANA_LIGHT[c]);
  return { light: first, dark: MANA_LIGHT[colors[1]!], accents: all, circuit: all, brand: false };
}

function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The inverse of a 3x3 matrix (rows). */
function inverse3(m: number[][]): number[][] {
  const [a, b, c] = m[0]!;
  const [d, e, f] = m[1]!;
  const [g, h, i] = m[2]!;
  const A = e! * i! - f! * h!;
  const B = -(d! * i! - f! * g!);
  const C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  return [
    [A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
    [B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
    [C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det],
  ];
}

/** The logo's three colors: its blue, its magenta border and the white of "Dice". */
const LOGO_BLUE = '#1fb8ff';
const LOGO_MAGENTA = '#f500f5';
const LOGO_WHITE = '#f2f4ff';

/**
 * The color matrix that recolors the logo (feColorMatrix values, sRGB): its blue to `first`, its magenta to `second`, its white to white, every
 * other color in between as it was (the matrix is linear, so the logo's glow and soft edges keep their shape).
 */
export function logoMatrix(first: string, second: string): string {
  const src = [rgb01(LOGO_BLUE), rgb01(LOGO_MAGENTA), rgb01(LOGO_WHITE)];
  const dst = [rgb01(first), rgb01(second), rgb01('#ffffff')];
  // M * S = T, with the source and target colors as columns: M = T * S^-1.
  const S = [0, 1, 2].map((row) => src.map((col) => col[row]!));
  const T = [0, 1, 2].map((row) => dst.map((col) => col[row]!));
  const Si = inverse3(S);
  const M = T.map((row) => [0, 1, 2].map((j) => row.reduce((sum, v, k) => sum + v * Si[k]![j]!, 0)));
  return [...M.map((row) => [...row.map((v) => v.toFixed(4)), '0', '0']), ['0', '0', '0', '1', '0']].map((r) => r.join(' ')).join(' ');
}

// ---- Geometry ----

type Poly = Pt[];

/** One piece of the broken mirror, as drawn. */
export interface SleeveShard {
  /** Its outline where it lies now: drawn in a little from its neighbours and moved where the blow left it. */
  poly: Poly;
  /** The piece as it was cut, before it moved: the pieces cut from the mirror tile it exactly. */
  cell: Poly;
  /** Its middle, where it lies now. */
  c: Pt;
  /** Facet foil. */
  foil: boolean;
  /** What it shows: clear smoky glass, a mirror catching the light, or the echo world (the card back seen mirrored, in violet). */
  kind: 'glass' | 'mirror' | 'echo';
  /** How far it stands off the card underneath (its shadow's reach): resting in the frame, lifted at the edge of the hole, or in flight. */
  lift: number;
  /** How far the glass bends the card seen through it out of line. */
  dx: number;
  dy: number;
  /** Which way its face tilts (degrees) and how much light it catches (0 to 1). */
  tilt: number;
  lit: number;
}

interface Geometry {
  /** The glass left in the frame, the pieces round the hole lifted. */
  shards: SleeveShard[];
  /** The pieces that are gone: the hole the logo broke through, and a few more that fell out. */
  gone: Poly[];
  /** Small pieces in flight out of the hole. */
  flying: SleeveShard[];
  /** Cracks across some pieces that did not come apart. */
  hairlines: Pt[][];
  /** The longest cracks, the first ones the blow made: lit along one side and dark along the other, so the break reads when the card is small. */
  cracks: Pt[][];
  /** The DigiDice back's circuit: lines (each with its color's index) ending in pads, and dice. */
  traces: { pts: Pt[]; color: number }[];
  dice: { x: number; y: number; face: number; turn: number }[];
  /** Sharp corners of the glass that glint. */
  glints: Pt[];
}

/** A rectangle whose corners are stairs, clockwise from the top left: `steps` steps of `size` on each corner. */
function stepped(left: number, top: number, right: number, bottom: number, steps: number, size: number): Poly {
  const corner: Pt[] = [{ x: left, y: top + steps * size }];
  for (let k = 1; k <= steps; k++) corner.push({ x: left + k * size, y: top + (steps - k + 1) * size }, { x: left + k * size, y: top + (steps - k) * size });
  const mx = (p: Pt) => ({ x: left + right - p.x, y: p.y });
  const my = (p: Pt) => ({ x: p.x, y: top + bottom - p.y });
  const rot = (p: Pt) => ({ x: left + right - p.x, y: top + bottom - p.y });
  return [...corner, ...[...corner].reverse().map(mx), ...corner.map(rot), ...[...corner].reverse().map(my)];
}

/** An octagon: a rectangle with its corners cut by `cut`, clockwise from the top left. */
function octagon(left: number, top: number, right: number, bottom: number, cut: number): Poly {
  return [
    { x: left, y: top + cut },
    { x: left + cut, y: top },
    { x: right - cut, y: top },
    { x: right, y: top + cut },
    { x: right, y: bottom - cut },
    { x: right - cut, y: bottom },
    { x: left + cut, y: bottom },
    { x: left, y: bottom - cut },
  ];
}

const MIRROR_POLY = stepped(MIRROR.left, MIRROR.top, MIRROR.right, MIRROR.bottom, STEPS, STEP);
/** The convex outline round the mirror's stairs, in which the pieces are cut. */
const MIRROR_HULL = octagon(MIRROR.left, MIRROR.top, MIRROR.right, MIRROR.bottom, STEPS * STEP);
const OUTER_POLY = octagon(OUTER.inset, OUTER.inset, SLEEVE_W - OUTER.inset, SLEEVE_H - OUTER.inset, OUTER.cut);
/** The backing of the logo's chip: the chip is the middle 80% of the logo picture. */
const CHIP = LOGO * 0.39;

/** The part of a convex polygon where (p - a) · n <= 0. */
function clip(poly: Poly, a: Pt, n: Pt): Poly {
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

function area(poly: Poly): number {
  let s = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  });
  return s / 2;
}

function centroid(poly: Poly): Pt {
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

/** The point turned half round the middle: the shards' echo. */
const turned = (p: Pt): Pt => ({ x: 2 * CX - p.x, y: 2 * CY - p.y });

/** The area of a polygon (the mirror and its shards), for tests. */
export const polygonArea = (poly: readonly Pt[]): number => Math.abs(area([...poly]));

/** A convex polygon's outward normal on each side (side i runs from point i to point i + 1). */
function normals(poly: Poly): Pt[] {
  const c = centroid(poly);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const m = { x: (a.x + b.x) / 2 - c.x, y: (a.y + b.y) / 2 - c.y };
    return n.x * m.x + n.y * m.y < 0 ? { x: -n.x, y: -n.y } : n;
  });
}

/** A convex polygon drawn in by `d` on every side (its corners kept sharp, within reason). */
function inset(poly: Poly, d: number): Poly {
  const ns = normals(poly);
  return poly.map((v, i) => {
    const n0 = ns[(i - 1 + poly.length) % poly.length]!;
    const n1 = ns[i]!;
    const k = Math.min(3, 1 / Math.max(0.2, (1 + n0.x * n1.x + n0.y * n1.y) / 2));
    return { x: v.x - ((n0.x + n1.x) / 2) * d * k, y: v.y - ((n0.y + n1.y) / 2) * d * k };
  });
}

/** A convex polygon cut in two by the line through `a` with normal `n`. */
function split(poly: Poly, a: Pt, n: Pt): [Poly, Poly] {
  return [clip(poly, a, n), clip(poly, a, { x: -n.x, y: -n.y })];
}

/** Moved by dx, dy and turned by `turn` degrees round `c`. */
function place(poly: Poly, c: Pt, dx: number, dy: number, turn: number): Poly {
  const a = (turn * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin + dx, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos + dy }));
}

/** How far the hole reaches from the middle at `angle`: ragged, and the same turned half round. */
const holeAt = (angle: number) => 200 + 30 * Math.sin(2 * angle + 0.7) + 20 * Math.sin(4 * angle + 1.9) + 12 * Math.sin(6 * angle + 0.4);

/**
 * A convex polygon broken into `count` pieces the way glass breaks from a blow at the middle: again and again the biggest piece (counting pieces near
 * the middle as bigger, so they break smaller) is split by a straight crack. Near the blow most cracks run out from it, so the pieces there are slivers
 * pointing at it; further out they run any way through the piece, so the pieces there are big, sharp, uneven triangles. Cracks end where they meet
 * older ones.
 */
function breakUp(start: Poly, count: number, r: () => number): { pieces: Poly[]; cracks: Pt[][] } {
  const pieces: Poly[] = [start];
  const cracks: Pt[][] = [];
  const weight = (p: Poly) => {
    const c = centroid(p);
    const d = Math.hypot((c.x - CX) / 0.8, c.y - CY);
    return Math.abs(area(p)) * (1 + 9 * Math.exp(-((d / 215) ** 2)));
  };
  for (let guard = 0; pieces.length < count && guard < 5000; guard++) {
    let best = 0;
    pieces.forEach((p, i) => {
      if (weight(p) > weight(pieces[best]!)) best = i;
    });
    const piece = pieces[best]!;
    const c = centroid(piece);
    const size = Math.sqrt(Math.abs(area(piece)));
    const d = Math.hypot(c.x - CX, c.y - CY);
    const radial = r() < 0.15 + 0.7 * Math.exp(-((d / 240) ** 2));
    // A radial crack runs through the piece toward the blow (a little off it); any other runs through the piece at any angle.
    const ang = radial ? Math.atan2(c.y - CY, c.x - CX) + Math.PI / 2 + (r() - 0.5) * 0.35 : r() * Math.PI;
    const n = { x: Math.cos(ang), y: Math.sin(ang) };
    const off = (r() - 0.5) * (radial ? 0.3 : 0.5) * size;
    const [a, b] = split(piece, { x: c.x + n.x * off, y: c.y + n.y * off }, n);
    const aa = Math.abs(area(a));
    const ab = Math.abs(area(b));
    if (a.length < 3 || b.length < 3 || Math.min(aa, ab) < 0.2 * (aa + ab)) continue;
    pieces.splice(best, 1, a, b);
    // The crack itself: the two corners the cut made, the ends of the line through the piece.
    const at = { x: c.x + n.x * off, y: c.y + n.y * off };
    cracks.push(a.filter((q) => Math.abs((q.x - at.x) * n.x + (q.y - at.y) * n.y) < 1e-6 * size));
  }
  return { pieces, cracks };
}

let geometry: Geometry | null = null;

/**
 * The broken mirror, the same on every sleeve. The top half is broken up and the bottom half is its echo, turned half round (so the card is the same
 * card from either end). Where the logo broke through, the glass is gone in a ragged hole; the pieces round it are lifted and pushed back, a few small
 * ones are still in flight; two more pieces and their echoes fell out; the rest lie a little apart, each moved and turned a little.
 */
function shatter(): Geometry {
  if (geometry) return geometry;
  const r = seeded(4242);
  // The two halves meet along a crack through the middle, a little off level.
  const tilt = -0.14;
  const top = clip(MIRROR_HULL, IMPACT, { x: -Math.sin(tilt), y: Math.cos(tilt) });
  const broken = breakUp(top, 22, r);
  const halfCells = broken.pieces;
  const cells = [...halfCells, ...halfCells.map((cell) => cell.map(turned))];
  const half = halfCells.length;
  const mids = cells.map(centroid);
  const dist = (p: Pt) => Math.hypot(p.x - CX, p.y - CY);
  const angle = (p: Pt) => Math.atan2(p.y - CY, p.x - CX);
  const inHole = mids.map((m) => dist(m) < holeAt(angle(m)));
  /** How far a piece is from a sliver: its area over its perimeter squared (a square's is 1/16, a long sliver's near 0). */
  const compact = (cell: Poly) => {
    let around = 0;
    cell.forEach((q, i) => (around += Math.hypot(cell[(i + 1) % cell.length]!.x - q.x, cell[(i + 1) % cell.length]!.y - q.y)));
    return Math.abs(area(cell)) / (around * around);
  };
  // Two more pieces (and their echoes) fell out: a middling one up on the left and one beside the hole on the right.
  const fallen = new Set<number>();
  const pickFallen = (want: (m: Pt) => boolean) => {
    const i = halfCells.findIndex((cell, k) => !inHole[k] && !fallen.has(k) && want(mids[k]!) && Math.abs(area(cell)) > 4000 && Math.abs(area(cell)) < 16000);
    if (i >= 0) fallen.add(i).add(i + half);
  };
  const cornerDie = { x: MIRROR.left + 74, y: MIRROR.top + 132 };
  pickFallen((m) => m.x < CX - 100 && m.y < CY - 150 && Math.hypot(m.x - cornerDie.x, m.y - cornerDie.y) > 130);
  pickFallen((m) => m.x > CX + 150 && m.y < CY && m.y > CY - 260);
  const foil = new Set<number>();
  const pickFoil = (want: (m: Pt) => boolean) => {
    const i = halfCells.findIndex((cell, k) => !inHole[k] && !fallen.has(k) && !foil.has(k) && compact(cell) > 0.04 && want(mids[k]!));
    if (i >= 0) foil.add(i).add(i + half);
  };
  pickFoil((m) => m.x > CX + 60 && m.y < MIRROR.top + 190);
  pickFoil((m) => m.x < CX - 150 && m.y > CY - 200);
  pickFoil((m) => m.x > CX - 80 && m.x < CX + 80 && m.y < CY - 260);
  // Two big pieces are mirror, catching the light (the biggest up on the left, and its echo); two show the echo world breaking through (the biggest
  // up on the right, and its echo).
  const kinds = new Map<number, 'mirror' | 'echo'>();
  const pickKind = (kind: 'mirror' | 'echo', want: (m: Pt) => boolean) => {
    let best = -1;
    halfCells.forEach((cell, k) => {
      if (inHole[k] || fallen.has(k) || foil.has(k) || kinds.has(k) || !want(mids[k]!)) return;
      if (best < 0 || Math.abs(area(cell)) > Math.abs(area(halfCells[best]!))) best = k;
    });
    if (best >= 0) kinds.set(best, kind).set(best + half, kind);
  };
  pickKind('mirror', (m) => m.x < CX - 40 && m.y < CY - 120);
  pickKind('echo', (m) => m.x > CX + 40 && m.y < CY - 120);

  // The glass left: drawn in from its neighbours, pushed out from the hole and turned a little, the more the nearer it lies to the hole.
  const shards: SleeveShard[] = [];
  const moves: { dx: number; dy: number; turn: number; lift: number }[] = [];
  halfCells.forEach((_, k) => {
    const m = mids[k]!;
    const near = Math.max(0, 1 - (dist(m) - holeAt(angle(m))) / 170);
    const lift = 3 + near * 12 + r() * 2;
    const push = near * 7 + r() * 1.5;
    const out = { x: (m.x - CX) / dist(m), y: (m.y - CY) / dist(m) };
    moves.push({ dx: out.x * push, dy: out.y * push, turn: (r() - 0.5) * (1 + near * 7), lift });
  });
  cells.forEach((cell, i) => {
    if (inHole[i] || fallen.has(i)) return;
    const k = i % half;
    const mv = moves[k]!;
    // The echo moves the same way turned round, with a little of its own.
    const echo = i >= half;
    const dx = echo ? -mv.dx + (r() - 0.5) * 1.2 : mv.dx;
    const dy = echo ? -mv.dy + (r() - 0.5) * 1.2 : mv.dy;
    const turn = echo ? mv.turn + (r() - 0.5) * 0.8 : mv.turn;
    const m = mids[i]!;
    // The pieces round the hole stand further apart: the gaps there are the widest.
    const near = Math.max(0, Math.min(1, (mv.lift - 3) / 12));
    const poly = place(inset(cell, 2.4 + 2.2 * near), m, dx, dy, turn);
    shards.push({
      poly,
      cell,
      c: centroid(poly),
      foil: foil.has(i),
      kind: kinds.get(i) ?? 'glass',
      lift: mv.lift,
      dx: (r() - 0.5) * 20,
      dy: (r() - 0.5) * 20,
      tilt: r() * 360,
      lit: 0.2 + r() * 0.8,
    });
  });

  // Small pieces still in flight: the most compact pieces of the hole, made small and thrown out into the gap between the logo's chip and the
  // hole's edge, up on the left, on the right and at the top (their echoes down on the right, on the left and at the bottom).
  const flying: SleeveShard[] = [];
  const thrown = halfCells
    .map((_, k) => k)
    .filter((k) => inHole[k] && Math.abs(area(cells[k]!)) > 1500)
    .sort((a, b) => compact(cells[b]!) - compact(cells[a]!));
  const aims = [-2, -0.35, -1.25];
  thrown.slice(0, aims.length).forEach((k, n) => {
    for (const echo of [false, true]) {
      const cell = echo ? cells[k + half]! : cells[k]!;
      const m = mids[echo ? k + half : k]!;
      const a = aims[n]! + (echo ? Math.PI : 0);
      const chipEdge = CHIP / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const reach = Math.max(chipEdge + 40, (chipEdge + holeAt(a)) / 2 + 10);
      const to = { x: CX + Math.cos(a) * reach, y: CY + Math.sin(a) * reach };
      const scale = (24 + n * 6) / Math.max(...cell.map((q) => Math.hypot(q.x - m.x, q.y - m.y)));
      const small = cell.map((q) => ({ x: m.x + (q.x - m.x) * scale, y: m.y + (q.y - m.y) * scale }));
      const turn = (n % 2 ? 1 : -1) * (24 + n * 9) + (echo ? 6 : 0);
      const poly = place(small, m, to.x - m.x, to.y - m.y, turn);
      flying.push({ poly, cell, c: centroid(poly), foil: n === 1, kind: 'glass', lift: 22, dx: (r() - 0.5) * 20, dy: (r() - 0.5) * 20, tilt: r() * 360, lit: 0.6 + r() * 0.4 });
    }
  });

  // Cracks across some big pieces that held together: from a point on one side partway across.
  const hairlines: Pt[][] = [];
  shards
    .filter((s) => polygonArea(s.poly) > 9000)
    .slice(0, 9)
    .forEach((s) => {
      const p = s.poly;
      const i = Math.floor(r() * p.length);
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      const k = 0.3 + r() * 0.4;
      const from = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      const toward = { x: s.c.x - from.x, y: s.c.y - from.y };
      const len = 0.6 + r() * 0.7;
      const bend = (r() - 0.5) * 0.5;
      const mid = { x: from.x + toward.x * len * 0.5 - toward.y * bend * 0.3, y: from.y + toward.y * len * 0.5 + toward.x * bend * 0.3 };
      hairlines.push([from, mid, { x: from.x + toward.x * len, y: from.y + toward.y * len }]);
    });

  // The DigiDice back's circuit, as on the DigiDice sleeves: lines leaving the chip straight from its sides, bending away by an eighth of a turn, running
  // on and ending in a pad; the bottom and right sides are the top and left turned round.
  const traces: Geometry['traces'] = [];
  const chipTop = CY - CHIP;
  for (let k = 0; k < 7; k++) {
    const x = CX + (k - 3) * 30;
    const away = k === 3 ? (r() < 0.5 ? -1 : 1) : Math.sign(x - CX);
    const l1 = 18 + r() * 40;
    const l2 = 30 + r() * 70 + Math.abs(k - 3) * 12;
    const a = { x, y: chipTop };
    const b = { x, y: chipTop - l1 };
    const c = { x: b.x + away * l2 * 0.7071, y: b.y - l2 * 0.7071 };
    const d = { x: c.x, y: Math.max(MIRROR.top + 30, c.y - 40 - r() * 140) };
    traces.push({ pts: [a, b, c, d], color: k });
  }
  const chipLeft = CX - CHIP;
  for (let k = 0; k < 5; k++) {
    const y = CY + (k - 2) * 34;
    const away = k === 2 ? 1 : Math.sign(y - CY);
    const l1 = 16 + r() * 24;
    const l2 = 24 + r() * 40;
    const a = { x: chipLeft, y };
    const b = { x: chipLeft - l1, y };
    const c = { x: b.x - l2 * 0.7071, y: b.y + away * l2 * 0.7071 };
    const d = { x: Math.max(MIRROR.left + 24, c.x - 30 - r() * 60), y: c.y };
    traces.push({ pts: [a, b, c, d], color: k + 1 });
  }
  // Buses of three lines along the sides, as on the DigiDice back, and longer runs to the corners.
  for (const y of [CY - 250, CY - 214]) {
    for (let k = 0; k < 3; k++) traces.push({ pts: [{ x: MIRROR.left + 10, y: y + k * 12 }, { x: MIRROR.left + 64, y: y + k * 12 }], color: k });
  }
  for (const side of [-1, 1]) {
    const a = { x: CX + side * 110, y: chipTop };
    const b = { x: a.x, y: chipTop - 30 };
    const c = { x: a.x + side * 150, y: b.y - 150 };
    traces.push({ pts: [a, b, c, { x: c.x, y: MIRROR.top + 60 }], color: side > 0 ? 1 : 0 });
  }
  const echoed = traces.map((t) => ({ pts: t.pts.map(turned), color: t.color + 1 }));
  traces.push(...echoed);
  // The DigiDice back's dice, one near each corner of the mirror, and one where each fallen piece was.
  const dice: Geometry['dice'] = [
    { ...cornerDie, face: 6, turn: -6 },
    { x: MIRROR.right - 74, y: MIRROR.top + 132, face: 5, turn: 7 },
  ];
  dice.push(...dice.map((d) => ({ ...turned(d), face: d.face === 6 ? 4 : 3, turn: -d.turn })));
  [...fallen].filter((i) => i < half).forEach((i, n) => {
    const m = mids[i]!;
    const d = { x: m.x, y: m.y, face: n ? 2 : 1, turn: n ? 9 : -8 };
    dice.push(d, { ...turned(d), face: n ? 2 : 1, turn: -d.turn });
  });
  // The sharpest corners of the pieces round the hole glint.
  const glints: Pt[] = [];
  for (const s of shards.filter((x) => x.lift > 9)) {
    let best: Pt | null = null;
    let sharp = 0;
    s.poly.forEach((v, i) => {
      const a = s.poly[(i - 1 + s.poly.length) % s.poly.length]!;
      const b = s.poly[(i + 1) % s.poly.length]!;
      const u = { x: a.x - v.x, y: a.y - v.y };
      const w = { x: b.x - v.x, y: b.y - v.y };
      const cos = (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y));
      if (cos > sharp) (sharp = cos), (best = v);
    });
    // Never on the logo's chip.
    const onChip = (q: Pt) => Math.abs(q.x - CX) < CHIP + 24 && Math.abs(q.y - CY) < CHIP + 24;
    if (best && sharp > 0.3 && !onChip(best)) glints.push(best);
  }
  // The first cracks of the top half and their echoes, kept to where the glass is (outside the hole's reach).
  const cracks = broken.cracks
    .slice(0, 5)
    .filter((c) => c.length === 2)
    .flatMap((c) => [c, c.map(turned)]);
  geometry = { shards, gone: cells.filter((_, i) => inHole[i] || fallen.has(i)), flying, hairlines, cracks, traces, dice, glints: glints.slice(0, 10) };
  return geometry;
}

/** The pieces of the mirror still in it, the same on every sleeve (for tests). */
export function sleeveShards(): readonly SleeveShard[] {
  return shatter().shards;
}

/** The pieces that are gone (for tests). */
export function sleeveGone(): readonly (readonly Pt[])[] {
  return shatter().gone;
}

/** The mirror's outline, stairs and all (for tests). */
export const MIRROR_OUTLINE: readonly Pt[] = MIRROR_POLY;
/** The convex outline the pieces are cut in (for tests). */
export const MIRROR_BOUNDS: readonly Pt[] = MIRROR_HULL;

// ---- Drawing ----

const f1 = (n: number) => n.toFixed(1);
const pt = (p: Pt) => `${f1(p.x)},${f1(p.y)}`;
const path = (poly: readonly Pt[]) => `M${poly.map(pt).join(' L')} Z`;
const line = (pts: readonly Pt[]) => `M${pts.map(pt).join(' L')}`;

/** The color of the glass at an angle from the middle: the accents in arcs round it, the first starting straight down and running up the left side. */
function accentAt(p: SleevePalette, angle: number): string {
  const turn = (((angle - Math.PI / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return p.accents[Math.min(p.accents.length - 1, Math.floor((turn / (Math.PI * 2)) * p.accents.length))]!;
}

/** A diamond split down the middle, its left half `left`, its right half `right`, centered on x, y. */
function stud(x: number, y: number, w: number, h: number, left: string, right: string): string {
  return (
    `<path d="M${f1(x)},${f1(y - h - 3)} L${f1(x + w + 3)},${f1(y)} L${f1(x)},${f1(y + h + 3)} L${f1(x - w - 3)},${f1(y)} Z" fill="#07060c"/>` +
    `<path d="M${f1(x)},${f1(y - h)} L${f1(x)},${f1(y + h)} L${f1(x - w)},${f1(y)} Z" fill="${left}"/>` +
    `<path d="M${f1(x)},${f1(y - h)} L${f1(x + w)},${f1(y)} L${f1(x)},${f1(y + h)} Z" fill="${right}"/>` +
    `<path d="M${f1(x)},${f1(y - h)} L${f1(x)},${f1(y + h)}" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1"/>`
  );
}

/** A four-pointed star centered on the origin. */
function star(r: number): string {
  const k = r * 0.2;
  return `M0,${f1(-r)} L${f1(k)},${f1(-k)} L${f1(r)},0 L${f1(k)},${f1(k)} L0,${f1(r)} L${f1(-k)},${f1(k)} L${f1(-r)},0 L${f1(-k)},${f1(-k)} Z`;
}

/** The serial on a sleeve: the DigiDice sleeves' own form, "DIGIDICE · DD-WU · 1D6", here "DIGIDICE · RF-WU · ECHO". */
export function sleeveSerial(colors: readonly Color[]): string {
  return `DIGIDICE · RF-${colors.length ? colors.join('') : 'C'} · ECHO`;
}

/** The still card back of a sleeve. */
export function fractureSleeveSvg(colors: readonly Color[], name: string): string {
  const p = sleevePalette(colors);
  const g = shatter();
  const o: string[] = [];
  const lightHi = mix(p.light, '#ffffff', 0.45);
  const darkHi = mix(p.dark, '#ffffff', 0.35);
  const stops = (list: string[]) => list.map((c, i) => `<stop offset="${(i / Math.max(1, list.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('');
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SLEEVE_W}" height="${SLEEVE_H}" viewBox="0 0 ${SLEEVE_W} ${SLEEVE_H}">`);
  o.push(`<title>Reality Fracture card back, ${name} sleeve</title>`);
  // Drawn small (in a hand, on a pile) the fine detail would only blur: there it is dropped, and the break is drawn bold instead.
  o.push(`<style>.small{display:none}@media (max-width: ${SMALL_SLEEVE}px){.fine{display:none}.small{display:inline}}</style>`);
  o.push(`<defs>
  <clipPath id="card"><rect width="${SLEEVE_W}" height="${SLEEVE_H}" rx="${RADIUS}"/></clipPath>
  <clipPath id="mirror"><path d="${path(MIRROR_POLY)}"/></clipPath>
  <radialGradient id="bg" cx="50%" cy="50%" r="72%">
    <stop offset="0" stop-color="${mix(mix(p.light, p.dark, 0.5), '#07060d', 0.88)}"/><stop offset="0.7" stop-color="#06050b"/><stop offset="1" stop-color="#020104"/>
  </radialGradient>
  <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r="1.4" fill="${p.circuit[0]}" fill-opacity="0.22"/></pattern>
  <radialGradient id="breach" cx="50%" cy="50%" r="50%">
    <stop offset="0.3" stop-color="${lightHi}" stop-opacity="0.55"/><stop offset="0.62" stop-color="${p.light}" stop-opacity="0.18"/><stop offset="1" stop-color="${p.dark}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="vignette" cx="50%" cy="50%" r="62%">
    <stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
  </radialGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">${stops([lightHi, '#ffffff', p.light, mix(p.light, p.dark, 0.5), p.dark, darkHi, mix(p.dark, '#000000', 0.3)])}</linearGradient>
  <linearGradient id="metal-v" x1="0" y1="0" x2="0" y2="1">${stops([lightHi, p.light, '#ffffff', p.dark, mix(p.dark, '#000000', 0.35)])}</linearGradient>
  <linearGradient id="holo" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="190" y2="110" spreadMethod="repeat">
    <stop offset="0.25" stop-color="#7ff7ff" stop-opacity="0"/><stop offset="0.36" stop-color="#7ff7ff" stop-opacity="0.2"/>
    <stop offset="0.48" stop-color="#ff8af2" stop-opacity="0.24"/><stop offset="0.6" stop-color="#fff38a" stop-opacity="0.22"/>
    <stop offset="0.7" stop-color="#8aa8ff" stop-opacity="0.18"/><stop offset="0.78" stop-color="#8aa8ff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="chip-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(p.light, '#04040b', 0.9)}"/><stop offset="1" stop-color="${mix(p.light, '#04040b', 0.96)}"/></linearGradient>
  <linearGradient id="chip-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(p.dark, '#04040b', 0.93)}"/><stop offset="1" stop-color="${mix(p.dark, '#04040b', 0.97)}"/></linearGradient>
  <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f6f7ff" stop-opacity="0.62"/><stop offset="0.45" stop-color="#cfd2f0" stop-opacity="0.42"/>
    <stop offset="0.8" stop-color="#b9a6ff" stop-opacity="0.5"/><stop offset="1" stop-color="${mix(p.dark, '#b9a6ff', 0.5)}" stop-opacity="0.58"/>
  </linearGradient>
  <linearGradient id="seam" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.2" stop-color="${lightHi}" stop-opacity="0.9"/>
    <stop offset="0.5" stop-color="#ffffff"/><stop offset="0.8" stop-color="${darkHi}" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <filter id="trace-glow" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4.5"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
  <filter id="logo" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    ${p.brand ? '<feOffset dx="0" dy="0" result="c"/>' : `<feColorMatrix type="matrix" values="${logoMatrix(p.light, p.dark)}" result="c"/>`}
    <feGaussianBlur in="c" stdDeviation="2.4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="c"/></feMerge>
  </filter>
  <image id="mark" x="${-LOGO / 2}" y="${-LOGO / 2}" width="${LOGO}" height="${LOGO}" xlink:href="${markPng}"/>
</defs>`);

  // ---- The DigiDice back: drawn once with its glow where nothing covers it, and again, plain and shifted, inside every piece of glass ----
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  const circuit: string[] = [];
  for (const t of g.traces) {
    const color = p.circuit[t.color % p.circuit.length]!;
    const end = t.pts[t.pts.length - 1]!;
    circuit.push(`<path d="${line(t.pts)}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    circuit.push(`<circle cx="${f1(end.x)}" cy="${f1(end.y)}" r="6.5" fill="#02040b" stroke="${color}" stroke-width="3"/>`);
  }
  for (const d of g.dice) {
    circuit.push(
      `<g transform="translate(${f1(d.x)} ${f1(d.y)}) rotate(${d.turn})"><rect x="-27" y="-27" width="54" height="54" rx="10" fill="#0b1426" stroke="${p.circuit[0]}" stroke-width="3"/>` +
        (pips[d.face] ?? []).map(([px, py]) => `<circle cx="${px * 13}" cy="${py * 13}" r="5" fill="#f2f4ff"/>`).join('') +
        '</g>',
    );
  }
  o.push(`<defs><g id="circuit">${circuit.join('')}</g>`);
  // The echo world's card back: the same circuit in its violet, to be shown mirrored.
  const echoCircuit = g.traces.map((t) => `<path d="${line(t.pts)}" fill="none" stroke="${ECHO_VIOLET}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  o.push(`<g id="circuit-echo">${echoCircuit.join('')}</g></defs>`);

  o.push('<g clip-path="url(#card)">');
  // The card round the frame, the frame's band, and the frame's outer rule.
  o.push(`<rect width="${SLEEVE_W}" height="${SLEEVE_H}" fill="url(#bg)"/>`);
  o.push(`<path d="${path(OUTER_POLY)}" fill="#08070f" stroke="url(#metal)" stroke-width="3.5"/>`);
  o.push(`<path d="${path(octagon(OUTER.inset + 8, OUTER.inset + 8, SLEEVE_W - OUTER.inset - 8, SLEEVE_H - OUTER.inset - 8, OUTER.cut - 3))}" fill="none" stroke="${lightHi}" stroke-opacity="0.3" stroke-width="1"/>`);

  o.push('<g clip-path="url(#mirror)">');
  o.push(`<path d="${path(MIRROR_POLY)}" fill="#02040b"/><path d="${path(MIRROR_POLY)}" fill="url(#dots)"/>`);
  o.push('<use xlink:href="#circuit" filter="url(#trace-glow)"/>');
  // The light of the breakthrough, spilling out from the logo over the card underneath.
  o.push(`<ellipse cx="${CX}" cy="${CY}" rx="290" ry="310" fill="url(#breach)"/>`);

  // ---- The glass: smoky and clear, each piece bending the card under it a little out of line, one edge lit, the other dark ----
  const glass = (s: SleeveShard, i: string) => {
    const d = path(s.poly);
    const rad = (s.tilt * Math.PI) / 180;
    const tint = s.kind === 'echo' ? ECHO_VIOLET : accentAt(p, Math.atan2(s.c.y - CY, s.c.x - CX));
    const dark = s.c.x > CX;
    o.push(`<clipPath id="s${i}"><path d="${d}"/></clipPath>`);
    o.push(
      `<linearGradient id="t${i}" x1="${f1(50 - Math.cos(rad) * 50)}%" y1="${f1(50 - Math.sin(rad) * 50)}%" x2="${f1(50 + Math.cos(rad) * 50)}%" y2="${f1(50 + Math.sin(rad) * 50)}%">` +
        `<stop offset="0" stop-color="${mix(tint, '#ffffff', 0.6)}" stop-opacity="${(0.1 + 0.16 * s.lit).toFixed(3)}"/><stop offset="0.5" stop-color="${tint}" stop-opacity="0.05"/>` +
        `<stop offset="1" stop-color="#000000" stop-opacity="${(0.18 + 0.22 * (1 - s.lit)).toFixed(3)}"/></linearGradient>`,
    );
    o.push(`<g clip-path="url(#s${i})">`);
    if (s.kind === 'mirror') {
      // A mirror: the card behind it only a ghost, its face silver turning lilac, a hard streak of light across it.
      o.push(`<path d="${d}" fill="#0b0a14"/><use xlink:href="#circuit" transform="translate(${f1(s.dx)} ${f1(s.dy)})" opacity="0.18"/>`);
      o.push(`<path d="${d}" fill="url(#silver)"/>`);
      const w = Math.sqrt(polygonArea(s.poly));
      const a1 = { x: s.c.x - w * 0.9, y: s.c.y + w * 0.62 };
      const b1 = { x: s.c.x + w * 0.9, y: s.c.y - w * 0.62 };
      o.push(`<path d="M${pt(a1)} L${pt(b1)}" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${f1(w * 0.05)}" stroke-linecap="butt"/>`);
      o.push(`<path d="M${f1(a1.x)},${f1(a1.y + w * 0.12)} L${f1(b1.x)},${f1(b1.y + w * 0.12)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${f1(w * 0.018)}"/>`);
    } else if (s.kind === 'echo') {
      // The echo world breaking through: the card back seen mirrored, in its violet.
      o.push(`<path d="${d}" fill="#0b0618"/><path d="${d}" fill="url(#dots)"/>`);
      o.push(`<use xlink:href="#circuit-echo" transform="translate(${f1(2 * CX + s.dx)} ${f1(s.dy)}) scale(-1 1)" opacity="0.85"/>`);
      o.push(`<path d="${d}" fill="${ECHO_VIOLET}" fill-opacity="0.1"/><path d="${d}" fill="url(#t${i})"/>`);
    } else {
      // The card seen through the glass: shifted a few pixels (the glass bends it), dimmed by the smoke in the glass, the dark half's smoke darker.
      o.push(`<path d="${d}" fill="#02040b"/><path d="${d}" fill="url(#dots)"/>`);
      o.push(`<use xlink:href="#circuit" transform="translate(${f1(s.dx)} ${f1(s.dy)})" opacity="${dark ? 0.5 : 0.62}"/>`);
      o.push(`<path d="${d}" fill="#04030c" fill-opacity="${dark ? 0.42 : 0.32}"/>`);
      o.push(`<path d="${d}" fill="url(#t${i})"/>`);
      if (s.foil) o.push(`<path d="${d}" fill="url(#holo)"/>`);
    }
    o.push('</g>');
    // The cut edges: the one facing the light at the top left (or the hole's light) bright and fine, those facing away dark.
    const poly = s.poly;
    const ns = normals(poly);
    const out = { x: (s.c.x - CX) / Math.hypot(s.c.x - CX, s.c.y - CY), y: (s.c.y - CY) / Math.hypot(s.c.x - CX, s.c.y - CY) };
    const lit = poly.map((_, k) => {
      const n = ns[k]!;
      const hole = s.lift > 8 ? -(n.x * out.x + n.y * out.y) : -1;
      return Math.max(-0.6 * n.x - 0.8 * n.y, hole);
    });
    const brightest = lit.indexOf(Math.max(...lit));
    poly.forEach((a, k) => {
      const b = poly[(k + 1) % poly.length]!;
      const n = ns[k]!;
      // One hair inside the edge, so the light sits on the glass.
      const ia = { x: a.x - n.x * 1.2, y: a.y - n.y * 1.2 };
      const ib = { x: b.x - n.x * 1.2, y: b.y - n.y * 1.2 };
      if (k === brightest) o.push(`<path d="M${pt(ia)} L${pt(ib)}" stroke="${mix(tint, '#ffffff', 0.5)}" stroke-width="1.8" stroke-opacity="0.95" stroke-linecap="round"/>`);
      else if (lit[k]! > 0.25) o.push(`<path d="M${pt(ia)} L${pt(ib)}" stroke="${mix(tint, '#ffffff', 0.3)}" stroke-width="1" stroke-opacity="${(0.2 + 0.4 * lit[k]!).toFixed(2)}" stroke-linecap="round"/>`);
      else o.push(`<path d="M${pt(ia)} L${pt(ib)}" stroke="#000000" stroke-width="1.6" stroke-opacity="0.6" stroke-linecap="round"/>`);
    });
  };
  // Shadows under the glass, longer under the pieces lifted round the hole.
  o.push(`<g filter="url(#shadow)">${g.shards.map((s) => `<path d="${path(s.poly)}" fill="#000000" fill-opacity="0.5" transform="translate(${f1(s.lift * 0.45)} ${f1(s.lift * 0.8)})"/>`).join('')}</g>`);
  g.shards.forEach((s, i) => glass(s, String(i)));
  // A reflection across a few of the biggest pieces on the lit side: a soft band of light running up to the right, its leading edge sharp, and a
  // thin second band behind it.
  const reflected = g.shards
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.c.x < CX + 60 && s.kind === 'glass')
    .sort((x, y) => polygonArea(y.s.poly) - polygonArea(x.s.poly))
    .slice(0, 4);
  const along = { x: 0.8, y: -0.6 };
  const across = { x: 0.6, y: 0.8 };
  for (const { s, i } of reflected) {
    const w = Math.sqrt(polygonArea(s.poly));
    const shift = ((s.tilt % 50) / 50 - 0.5) * 0.5 * w;
    const bands: [number, number, number][] = [
      [shift, w * 0.3, 0.22],
      [shift + w * 0.42, w * 0.07, 0.14],
    ];
    o.push(`<g class="fine" clip-path="url(#s${i})">`);
    bands.forEach(([off, width, strength], b) => {
      const c = { x: s.c.x + across.x * off, y: s.c.y + across.y * off };
      const from = { x: c.x - (across.x * width) / 2, y: c.y - (across.y * width) / 2 };
      const to = { x: c.x + (across.x * width) / 2, y: c.y + (across.y * width) / 2 };
      const corner = (u: number, v: number) => ({ x: c.x + along.x * u * w + (across.x * v * width) / 2, y: c.y + along.y * u * w + (across.y * v * width) / 2 });
      o.push(
        `<linearGradient id="r${i}-${b}" gradientUnits="userSpaceOnUse" x1="${f1(from.x)}" y1="${f1(from.y)}" x2="${f1(to.x)}" y2="${f1(to.y)}">` +
          `<stop offset="0" stop-color="#ffffff" stop-opacity="${strength}"/><stop offset="0.2" stop-color="#ffffff" stop-opacity="${(strength * 0.6).toFixed(3)}"/>` +
          `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`,
      );
      o.push(`<path d="${path([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)])}" fill="url(#r${i}-${b})"/>`);
    });
    o.push('</g>');
  }
  // Cracks across some pieces that held.
  const hair = g.hairlines.map(line).join(' ');
  o.push(`<g class="fine"><path d="${hair}" fill="none" stroke="#04030a" stroke-opacity="0.7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  o.push(`<path d="${hair}" fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></g>`);
  // The first cracks the blow made, the brightest lines after the logo: lit along the side that faces the light, dark along the other. They run where
  // the glass is (the hole and the fallen pieces cut them).
  o.push(`<clipPath id="kept">${g.shards.map((s) => `<path d="${path(s.cell)}"/>`).join('')}</clipPath>`);
  const crackPair = (c: Pt[], light: number, darkW: number, gap: number) => {
    const [a, b] = c as [Pt, Pt];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    if (-0.6 * n.x - 0.8 * n.y < 0) n = { x: -n.x, y: -n.y };
    const at = (q: Pt, k: number) => `${f1(q.x + n.x * k)},${f1(q.y + n.y * k)}`;
    return (
      `<path d="M${at(a, -gap)} L${at(b, -gap)}" stroke="#03020a" stroke-opacity="0.85" stroke-width="${darkW}" stroke-linecap="round"/>` +
      `<path d="M${at(a, gap)} L${at(b, gap)}" stroke="${mix(p.light, '#ffffff', 0.7)}" stroke-opacity="0.95" stroke-width="${light}" stroke-linecap="round"/>`
    );
  };
  o.push(`<g clip-path="url(#kept)">${g.cracks.map((c) => crackPair(c, 3, 2, 1.5)).join('')}</g>`);
  // The pieces in flight, over everything, with their long shadows.
  o.push(`<g filter="url(#shadow)">${g.flying.map((s) => `<path d="${path(s.poly)}" fill="#000000" fill-opacity="0.5" transform="translate(${f1(s.lift * 0.45)} ${f1(s.lift * 0.8)})"/>`).join('')}</g>`);
  g.flying.forEach((s, i) => glass(s, `f${i}`));
  for (const q of g.glints.slice(0, 6)) o.push(`<g class="fine" transform="translate(${pt(q)})"><path d="${star(10)}" fill="#ffffff" fill-opacity="0.9"/></g>`);
  o.push(`<path d="${path(MIRROR_POLY)}" fill="url(#vignette)"/>`);
  // Small: the detail dimmed under a veil, the two mirror pieces lit again over it, and three of the first cracks (and their echoes), running three
  // ways, drawn bold.
  o.push(`<g class="small"><path d="${path(MIRROR_POLY)}" fill="#04030a" fill-opacity="0.5"/>`);
  for (const s of g.shards.filter((x) => x.kind === 'mirror')) o.push(`<path d="${path(s.poly)}" fill="url(#silver)"/><path d="${path(s.poly)}" fill="#ffffff" fill-opacity="0.18"/>`);
  o.push(`<g clip-path="url(#kept)">${[0, 1, 4, 5, 8, 9].map((k) => (g.cracks[k] ? crackPair(g.cracks[k]!, 11, 8, 5) : '')).join('')}</g></g>`);
  o.push('</g>');

  // The mirror's edge: a dark lip, the metal rule, a fine line outside; its stairs at the corners.
  o.push(`<path d="${path(MIRROR_POLY)}" fill="none" stroke="#05040a" stroke-width="10"/>`);
  o.push(`<path d="${path(MIRROR_POLY)}" fill="none" stroke="url(#metal)" stroke-width="3.6"/>`);
  o.push(
    `<path d="${path(stepped(MIRROR.left - 9, MIRROR.top - 9, MIRROR.right + 9, MIRROR.bottom + 9, STEPS, STEP))}" fill="none" stroke="url(#metal-v)" stroke-opacity="0.55" stroke-width="1.2"/>`,
  );

  // ---- The logo, broken through: its chip backed light on the left and dark on the right along a seam, the chip's echo a frame offset into the
  // dark half, and the logo itself, single and sharp ----
  const chipRect = (dx = 0, dy = 0) => `x="${f1(CX - CHIP + dx)}" y="${f1(CY - CHIP + dy)}" width="${f1(2 * CHIP)}" height="${f1(2 * CHIP)}" rx="${f1(LOGO * 0.075)}"`;
  o.push(`<rect ${chipRect(6, 12)} fill="#000000" fill-opacity="0.7" filter="url(#soft)"/>`);
  // The split as light round the chip: the light half's color on the left, the dark half's on the right.
  o.push(`<clipPath id="chip-left"><rect x="0" y="0" width="${CX}" height="${SLEEVE_H}"/></clipPath><clipPath id="chip-right"><rect x="${CX}" y="0" width="${CX}" height="${SLEEVE_H}"/></clipPath>`);
  o.push(`<rect ${chipRect()} fill="none" stroke="${p.light}" stroke-opacity="0.75" stroke-width="7" filter="url(#soft)" clip-path="url(#chip-left)"/>`);
  o.push(`<rect ${chipRect()} fill="none" stroke="${p.dark}" stroke-opacity="0.75" stroke-width="7" filter="url(#soft)" clip-path="url(#chip-right)"/>`);
  o.push(`<clipPath id="chip"><rect ${chipRect()}/></clipPath>`);
  o.push(`<g clip-path="url(#chip)"><rect x="${f1(CX - CHIP)}" y="${f1(CY - CHIP)}" width="${f1(CHIP)}" height="${f1(2 * CHIP)}" fill="url(#chip-l)"/>`);
  o.push(`<rect x="${CX}" y="${f1(CY - CHIP)}" width="${f1(CHIP)}" height="${f1(2 * CHIP)}" fill="url(#chip-r)"/>`);
  o.push(`<path d="M${CX},${f1(CY - CHIP)} V${f1(CY + CHIP)}" stroke="url(#seam)" stroke-opacity="0.7" stroke-width="1.2"/></g>`);
  o.push(`<use xlink:href="#mark" filter="url(#logo)" transform="translate(${f1(CX)} ${f1(CY)})"/>`);

  // ---- The frame's studs and the serial ----
  o.push(stud(OUTER.inset + 19, CY, 9, 15, lightHi, mix(p.dark, '#000000', 0.2)));
  o.push(stud(SLEEVE_W - OUTER.inset - 19, CY, 9, 15, lightHi, mix(p.dark, '#000000', 0.2)));
  const serial = sleeveSerial(colors);
  const font = `font-family="'Palatino Linotype', Palatino, 'URW Palladio L', P052, 'Book Antiqua', Georgia, serif" font-size="17" font-weight="600" letter-spacing="5"`;
  const band = (OUTER.inset + MIRROR.top) / 2;
  o.push(`<g class="fine"><text x="${CX}" y="${f1(band + 6)}" text-anchor="middle" ${font} fill="${lightHi}" fill-opacity="0.9">${serial}</text>`);
  o.push(`<text x="${CX}" y="${f1(band + 6)}" text-anchor="middle" ${font} fill="${darkHi}" fill-opacity="0.8" transform="rotate(180 ${CX} ${CY})">${serial}</text>`);
  for (const sx of [CX - 232, CX + 232]) {
    o.push(stud(sx, band, 6, 9, lightHi, mix(p.dark, '#000000', 0.2)));
    o.push(stud(sx, SLEEVE_H - band, 6, 9, lightHi, mix(p.dark, '#000000', 0.2)));
  }
  o.push('</g>');
  o.push('</g></svg>');
  return o.join('\n');
}

/**
 * The moving lights of a sleeve: the light of the hole breathing, a light running round the edge of some of the pieces round it, their sharp corners
 * glinting in turn, a foil sweep over the foil pieces, pulses along the circuit where it shows, a light round the logo's chip and one round the frame,
 * the studs glinting. Slow and eased: nothing blinks.
 */
export function fractureLightsSvg(colors: readonly Color[], name: string): string {
  const p = sleevePalette(colors);
  const g = shatter();
  const o: string[] = [];
  const lightHi = mix(p.light, '#ffffff', 0.55);
  const darkHi = mix(p.dark, '#ffffff', 0.45);
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SLEEVE_W}" height="${SLEEVE_H}" viewBox="0 0 ${SLEEVE_W} ${SLEEVE_H}">`);
  o.push(`<title>Reality Fracture card back, ${name} sleeve, moving lights</title>`);
  // Small (a card in a hand, on a pile), only the lights of the logo and the frame run: the rest would only flicker.
  o.push(`<style>@media (max-width: ${SMALL_SLEEVE}px){.fine{display:none}}</style>`);
  o.push(`<defs>
  <clipPath id="card"><rect width="${SLEEVE_W}" height="${SLEEVE_H}" rx="${RADIUS}"/></clipPath>
  <clipPath id="mirror"><path d="${path(MIRROR_POLY)}"/></clipPath>
  <clipPath id="foil">${[...g.shards, ...g.flying].filter((s) => s.foil).map((s) => `<path d="${path(s.poly)}"/>`).join('')}</clipPath>
  <clipPath id="gone">${g.gone.map((cell) => `<path d="${path(cell)}"/>`).join('')}</clipPath>
  <clipPath id="open"><path clip-rule="evenodd" d="${path(MIRROR_POLY)} M${f1(CX - CHIP - 4)},${f1(CY - CHIP - 4)} h${f1(2 * CHIP + 8)} v${f1(2 * CHIP + 8)} h${f1(-2 * CHIP - 8)} Z"/></clipPath>
  <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#7ff7ff" stop-opacity="0"/><stop offset="0.25" stop-color="#7ff7ff" stop-opacity="0.45"/>
    <stop offset="0.45" stop-color="#ff8af2" stop-opacity="0.55"/><stop offset="0.6" stop-color="#fff38a" stop-opacity="0.6"/>
    <stop offset="0.78" stop-color="#8aa8ff" stop-opacity="0.45"/><stop offset="1" stop-color="#8aa8ff" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%">
    <stop offset="0.42" stop-color="${lightHi}" stop-opacity="0"/><stop offset="0.66" stop-color="${lightHi}" stop-opacity="0.4"/>
    <stop offset="1" stop-color="${p.dark}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="spark" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="${lightHi}" stop-opacity="0"/></radialGradient>
</defs>`);
  o.push('<g clip-path="url(#card)" fill="none" stroke-linecap="round" stroke-linejoin="round">');
  o.push('<g clip-path="url(#mirror)">');
  // The light of the hole, breathing.
  o.push(
    `<ellipse cx="${CX}" cy="${CY}" rx="330" ry="350" fill="url(#halo)" stroke="none" opacity="0.2">` +
      `<animate attributeName="opacity" values="0.15;0.75;0.15" dur="6.4s" repeatCount="indefinite"/></ellipse>`,
  );
  // Pulses along the circuit, where it shows through.
  o.push('<g clip-path="url(#gone)">');
  g.traces.forEach((t, i) => {
    if (i % 2) return;
    let length = 0;
    for (let k = 1; k < t.pts.length; k++) length += Math.hypot(t.pts[k]!.x - t.pts[k - 1]!.x, t.pts[k]!.y - t.pts[k - 1]!.y);
    const total = Math.ceil(length + 50);
    o.push(
      `<path d="${line(t.pts)}" stroke="${mix(p.circuit[t.color % p.circuit.length]!, '#ffffff', 0.6)}" stroke-width="4" stroke-dasharray="36 ${total + 36}" stroke-dashoffset="36">` +
        `<animate attributeName="stroke-dashoffset" values="36;${-total};${-total}" keyTimes="0;0.5;1" dur="${(3.6 + (i % 5) * 0.4).toFixed(1)}s" begin="${((i * 0.37) % 3).toFixed(2)}s" repeatCount="indefinite"/></path>`,
    );
  });
  o.push('</g></g>');
  // The lights on the glass stay off the logo's chip.
  o.push('<g class="fine" clip-path="url(#open)">');
  // A light running round the edge of the lifted pieces, one after another.
  g.shards
    .filter((s) => s.lift > 9)
    .slice(0, 10)
    .forEach((s, i) => {
      let length = 0;
      s.poly.forEach((a, k) => {
        const b = s.poly[(k + 1) % s.poly.length]!;
        length += Math.hypot(b.x - a.x, b.y - a.y);
      });
      const total = Math.ceil(length);
      o.push(
        `<path d="${path(s.poly)}" stroke="${i % 2 ? darkHi : lightHi}" stroke-width="2.6" stroke-opacity="0.95" stroke-dasharray="46 ${total}" stroke-dashoffset="0" opacity="0">` +
          `<animate attributeName="stroke-dashoffset" values="0;${-total - 46}" dur="${(3 + (i % 3) * 0.6).toFixed(1)}s" begin="${(i * 1.1).toFixed(1)}s" repeatCount="indefinite"/>` +
          `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.8;1" dur="${(3 + (i % 3) * 0.6).toFixed(1)}s" begin="${(i * 1.1).toFixed(1)}s" repeatCount="indefinite"/></path>`,
      );
    });
  // The foil sweep: a band of rainbow light crossing the foil pieces, then a rest.
  o.push(`<g clip-path="url(#foil)"><g transform="rotate(-30 ${CX} ${CY})"><rect x="-500" y="-300" width="300" height="${SLEEVE_H + 600}" fill="url(#sweep)" stroke="none">`);
  o.push(`<animate attributeName="x" values="-500;${SLEEVE_W + 260};${SLEEVE_W + 260}" keyTimes="0;0.5;1" dur="8s" begin="0.8s" repeatCount="indefinite"/></rect></g></g>`);
  // The sharp corners glinting, in turn.
  g.glints.forEach((q, i) => {
    o.push(
      `<g class="fine" transform="translate(${pt(q)})"><path d="${star(15)}" fill="#ffffff" stroke="none" opacity="0">` +
        `<animate attributeName="opacity" values="0;0.95;0" keyTimes="0;0.5;1" dur="${(4.2 + (i % 4) * 0.7).toFixed(1)}s" begin="${(i * 0.9).toFixed(1)}s" repeatCount="indefinite"/></path></g>`,
    );
  });
  o.push('</g>');
  // A light running round the logo's own outer border (a rounded square, in the logo's second color), and one round the frame.
  const h = LOGO_BORDER.half;
  const rr = LOGO_BORDER.radius;
  const chip =
    `M${f1(CX - h + rr)},${f1(CY - h)} H${f1(CX + h - rr)} A${rr},${rr} 0 0 1 ${f1(CX + h)},${f1(CY - h + rr)} V${f1(CY + h - rr)} ` +
    `A${rr},${rr} 0 0 1 ${f1(CX + h - rr)},${f1(CY + h)} H${f1(CX - h + rr)} A${rr},${rr} 0 0 1 ${f1(CX - h)},${f1(CY + h - rr)} V${f1(CY - h + rr)} ` +
    `A${rr},${rr} 0 0 1 ${f1(CX - h + rr)},${f1(CY - h)} Z`;
  const around = Math.ceil(8 * h - (8 - 2 * Math.PI) * rr);
  const border = mix(p.brand ? LOGO_MAGENTA : p.dark, '#ffffff', 0.35);
  o.push(
    `<path d="${chip}" stroke="${border}" stroke-width="3" stroke-opacity="0.95" stroke-dasharray="70 ${around}" stroke-dashoffset="0">` +
      `<animate attributeName="stroke-dashoffset" values="0;${-around - 70}" dur="7s" repeatCount="indefinite"/></path>`,
  );
  o.push(
    `<path d="${path(OUTER_POLY)}" stroke="${lightHi}" stroke-width="3.4" stroke-opacity="0.8" stroke-dasharray="110 3300" stroke-dashoffset="0">` +
      `<animate attributeName="stroke-dashoffset" values="0;-3410" dur="14s" repeatCount="indefinite"/></path>`,
  );
  // The studs glinting, one after another.
  const band = (OUTER.inset + MIRROR.top) / 2;
  [
    [SLEEVE_W - OUTER.inset - 19, CY],
    [OUTER.inset + 19, CY],
    [CX - 232, band],
    [CX + 232, SLEEVE_H - band],
  ].forEach(([x, y], i) => {
    o.push(
      `<circle cx="${f1(x!)}" cy="${f1(y!)}" r="22" fill="url(#spark)" stroke="none" opacity="0">` +
        `<animate attributeName="opacity" values="0;0.7;0" dur="5.2s" begin="${(i * 1.3).toFixed(2)}s" repeatCount="indefinite"/></circle>`,
    );
  });
  o.push('</g></svg>');
  return o.join('\n');
}

const cache = new Map<string, { back: string; lights: string }>();

/** A picture's URL: a blob: URL where the browser makes them (short, so the page does not carry the whole picture in every card back), else data:. */
function pictureUrl(svg: string): string {
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
      return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    }
  } catch {
    // fall back to a data: URL below
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A sleeve's two pictures (made on first use and kept). An unknown id or none is the colorless sleeve. */
function pictures(id: string | null | undefined): { back: string; lights: string } {
  const sleeve = sleeveById(id);
  const key = sleeve?.id ?? 'classic';
  let got = cache.get(key);
  if (!got) {
    const colors = sleeve?.colors ?? [];
    const name = sleeve?.name ?? 'Colorless';
    got = { back: pictureUrl(fractureSleeveSvg(colors, name)), lights: pictureUrl(fractureLightsSvg(colors, name)) };
    cache.set(key, got);
  }
  return got;
}

/** The still picture of a sleeve in this look. */
export function fractureSleeveUrl(id: string | null | undefined): string {
  return pictures(id).back;
}

/** Its moving lights. */
export function fractureLightsUrl(id: string | null | undefined): string {
  return pictures(id).lights;
}
