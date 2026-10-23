#!/usr/bin/env node
/**
 * OpenMTG's avatars (milestone 14, docs/design/m14-accounts.md 7.1): 48 pictures, 8 shapes in 6 tones, one file per id `<shape>-<tone>`, the ids of
 * AVATAR_IDS in @openmtg/accounts/api. They are OpenMTG's own art under the repository's MIT licence, drawn in the style of the deck sleeves
 * (scripts/brand/make-cardback.py): neon on black, a circuit board of traces and pads inside an octagonal chip frame, with the sleeves' depth (soft
 * shadows, bevels, domed pips). On the board sits a die (d4, d6, d8, d10, d12 or d20, with pips, never numbers), a chip or a comet. Never card art,
 * mana or set symbols, nothing of Wizards' or Arena's, no DigiDice logo, and no text at all: each file is plain shapes, gradients and filters, with
 * no script and no external reference, under 8 KB (packages/accounts/test/m14-9). The client reads them through
 * packages/client/src/branding/avatars.ts, which also names each one ("Magenta d20") for alt text.
 *
 *   node scripts/brand/gen-avatars.mjs              write assets/avatars/<id>.svg
 *   node scripts/brand/gen-avatars.mjs --out DIR    write them into DIR instead
 *   node scripts/brand/gen-avatars.mjs --check      write nothing; exit 1 if a committed file is missing, differs from what this script makes, or
 *                                                   is not one of the 48
 *
 * The output is deterministic (no randomness, fixed number formatting), so the committed files can always be checked against this script. The ids
 * are the contract: the art can be redrawn here at any time without changing them.
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** AVATAR_SHAPES and AVATAR_TONES of @openmtg/accounts/api, in their order (test/m14-9 checks that they agree). */
export const SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'chip', 'comet'];
export const TONES = ['blue', 'magenta', 'violet', 'cyan', 'amber', 'white'];
/** Every id, shape by shape, as AVATAR_IDS. */
export const IDS = SHAPES.flatMap((s) => TONES.map((t) => `${s}-${t}`));

/** The repository, from this file's real path (under --preserve-symlinks-main, `import.meta.url` is the linked path). */
const ROOT = path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), '..', '..');
export const AVATAR_DIR = path.join(ROOT, 'assets', 'avatars');

// ---- Numbers and colors ------------------------------------------------------------------------------------------------------------------------

/** A number with at most `places` decimals (a coordinate: one), short: "12", "12.5", ".5", "-.5". */
const n = (x, places = 1) => {
  const r = Math.round(x * 10 ** places) / 10 ** places;
  return String(Object.is(r, -0) ? 0 : r).replace(/^(-?)0\./, '$1.');
};
/** Numbers joined as path data and attribute lists join them: a space between, none before a minus sign. */
const nums = (xs) => xs.map((x) => n(x)).reduce((s, x, i) => (i === 0 || x.startsWith('-') ? s + x : `${s} ${x}`), '');

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
/** HSV to hex, as Python's colorsys.hsv_to_rgb (the sleeves' script). */
function hsv(h, s, v) {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return hex([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]);
}
function toHsv(h) {
  const [r, g, b] = rgb(h);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hue = 0;
  if (d > 0) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(((hue / 6) % 1) + 1) % 1, max === 0 ? 0 : d / max, max];
}
/** A neon color: full brightness, strongly saturated (the sleeves' `neon`). */
const neon = (hueDeg, sat) => hsv(hueDeg / 360, sat, 1);
/** `h` at full brightness with `keep` of its saturation: a lighter shade that stays colored (the sleeves' `shade`). */
const shade = (h, keep) => {
  const [hue, sat] = toHsv(h);
  return hsv(hue, sat * keep, 1);
};
/** A plain sRGB mix, for the dark tints of the die faces. */
const mix = (a, b, t) => hex(rgb(a).map((x, i) => x + (rgb(b)[i] - x) * t));
const BOARD_BLACK = '#03060C';

/**
 * The six tones: a main color (the frame, most traces, the emblem's outline) and an accent (the border, the other traces, the facet lines), the
 * sleeves' one-color two-tone. Blue, magenta and white are the brand's; violet is the sleeves' violet; white has a steel-blue accent.
 */
const TONE_COLORS = {
  blue: { main: '#1FB8FF', accent: neon(214, 0.7) },
  magenta: { main: '#F500F5', accent: neon(322, 0.72) },
  violet: { main: neon(272, 0.62), accent: neon(250, 0.5) },
  cyan: { main: neon(184, 0.8), accent: neon(166, 0.68) },
  amber: { main: neon(38, 0.86), accent: neon(52, 0.66) },
  white: { main: '#E8E8F0', accent: neon(208, 0.3) },
};

// ---- Geometry ----------------------------------------------------------------------------------------------------------------------------------

const S = 256;
const C = S / 2;
const round = (p) => p.map((x) => Math.round(x * 10) / 10);
/** A polyline as short path data: each step as H, V or L (absolute) or h, v or l (relative), whichever is shorter. */
function line(pts) {
  const q = pts.map(round);
  let d = `M${nums(q[0])}`;
  for (let i = 1; i < q.length; i++) {
    const [x0, y0] = q[i - 1], [x, y] = q[i];
    const dx = x - x0, dy = y - y0;
    const options = dy === 0 ? [`H${n(x)}`, `h${n(dx)}`] : dx === 0 ? [`V${n(y)}`, `v${n(dy)}`] : [`L${nums([x, y])}`, `l${nums([dx, dy])}`];
    d += options.reduce((a, b) => (b.length < a.length ? b : a));
  }
  return d;
}
const closed = (pts) => line(pts) + 'Z';
const polar = (c, r, deg) => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ring = (c, r, start, count) => Array.from({ length: count }, (_, i) => polar(c, r, start + (360 / count) * i));
/** A quarter turn clockwise about the center. */
const turn = (p) => [S - p[1], p[0]];

/** The board's eight symmetries: four quarter turns about the center, each with and without a mirror. */
const SYMMETRIES = [0, 1, 2, 3].flatMap((q) =>
  [false, true].map((m) => (p) => {
    let r = m ? [S - p[0], p[1]] : p;
    for (let i = 0; i < q; i++) r = turn(r);
    return r;
  }),
);

/** The round socket the emblem sits on; the traces leave it like a chip's pins. */
const SOCKET = 56;
const onSocket = (x) => [x, C - Math.sqrt(SOCKET * SOCKET - (C - x) * (C - x))];
/**
 * One eighth of the board (above the center, left of the middle); the other seven are its symmetries. Each trace: points from the socket outward,
 * its color ('main' or 'accent') and its pad ('ring', 'dot' or 'via'), as on the card back. The first two leave the socket where the chip's pins
 * are (10 and 30 from the middle), so the chip's pins run on into them; the third leaves on the diagonal and forks.
 */
const TRACES = [
  { pts: [onSocket(118), [118, 50], [106, 38], [106, 30]], color: 'main', pad: 'ring' },
  { pts: [onSocket(98), [98, 62], [80, 44], [66, 44]], color: 'accent', pad: 'dot' },
  { pts: [[C - SOCKET / Math.SQRT2, C - SOCKET / Math.SQRT2], [74, 74], [74, 60]], color: 'main', pad: 'via' },
];
const BOARD = TRACES.flatMap((t) => SYMMETRIES.map((f) => ({ ...t, pts: t.pts.map(f) })));

/** An octagon: a square inset from the tile's edges with its corners cut (the card back's chip frame, the sleeves' die chips). */
const octagon = (inset, ch) => {
  const a = inset, b = S - inset;
  return [[a + ch, a], [b - ch, a], [b, a + ch], [b, b - ch], [b - ch, b], [a + ch, b], [a, b - ch], [a, a + ch]];
};
const FRAME = octagon(15, 34);

// ---- The emblems -------------------------------------------------------------------------------------------------------------------------------
// A die is its faces (polygons), its outline, the edges inside it, and its pips: [x, y, r] round, or [x, y, ux, uy, vx, vy] on a face seen at a
// slant (the unit circle mapped by the face's two directions). The light comes from the top left, as on the sleeves.

/** A die seen from straight above one corner (d4, d8): a face between each side of the outline and that corner, one pip on each. */
function fromCorner(outline, apex, pipR) {
  const faces = outline.map((p, i) => [p, outline[(i + 1) % outline.length], apex]);
  return { faces, outline, edges: outline.map((p) => [apex, p]), pips: faces.map((f) => [...centroid(f), pipR]) };
}

const EMBLEMS = {
  d4: () => {
    const c = [C, 145];
    return fromCorner(ring(c, 88, -90, 3), [c[0] - 3, c[1] - 4], 7.5);
  },
  d6: () => {
    // A cube in oblique view: the front face, and the top and right faces going back up to the right. Five pips in front, one on top and three on
    // the right, as on a real die (1, 3 and 5 meet at a corner).
    const s = 88, k = 32;
    const x0 = C - (s + k) / 2, y0 = C - (s + k) / 2 + k;
    const a = [x0, y0], b = [x0 + s, y0], c = [x0 + s, y0 + s], d = [x0, y0 + s];
    const back = (p) => [p[0] + k, p[1] - k];
    const across = [s, 0], down = [0, s], away = [k, -k];
    const on = (o, u, v, fu, fv, r) => [o[0] + u[0] * fu + v[0] * fv, o[1] + u[1] * fu + v[1] * fv, ...[...u, ...v].map((x) => (x / s) * r)];
    const pips = [
      ...[[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]].map(([u, v]) => [x0 + s * u, y0 + s * v, 8.5]),
      on(a, across, away, 0.5, 0.5, 10),
      ...[0.22, 0.5, 0.78].map((t) => on(b, away, down, t, t, 9)),
    ];
    return {
      faces: [[a, b, c, d], [a, back(a), back(b), b], [b, back(b), back(c), c]],
      outline: [a, back(a), back(b), back(c), c, d],
      edges: [[back(b), b], [a, b, c]],
      pips,
    };
  },
  d8: () => fromCorner([[C, 48], [198, C], [C, 208], [58, C]], [C - 6, C - 7], 7.5),
  d10: () => {
    // The ten-sided die from the side: the front kite and the four faces around it, meeting at the top and at the bottom.
    const T = [C, 46], UL = [56, 112], LL = [66, 158], B = [C, 210], LR = [190, 158], UR = [200, 112];
    const FL = [95, 140], F = [C, 166], FR = [161, 140];
    const faces = [[T, FR, F, FL], [T, FL, LL, UL], [T, UR, LR, FR], [B, LL, FL, F], [B, F, FR, LR]];
    return { faces, outline: [T, UL, LL, B, LR, UR], edges: [[T, FL, F, FR, T], [FL, LL], [FR, LR], [F, B]], pips: [[...centroid(faces[0]), 9]] };
  },
  d12: () => {
    // Face on: the front pentagon, and five pentagons round it out to a ten-sided outline.
    const c = [C, C];
    const P = ring(c, 34, -90, 5), O = ring(c, 80, -90, 10);
    const faces = [P, ...P.map((p, i) => [p, O[2 * i], O[2 * i + 1], O[(2 * i + 2) % 10], P[(i + 1) % 5]])];
    return { faces, outline: O, edges: [[...P, P[0]], ...P.map((p, i) => [p, O[2 * i]])], pips: [[...c, 10]] };
  },
  d20: () => {
    // Face on: the front triangle, the three faces on its sides and the six in the corners of a hexagon.
    const c = [C, C + 2];
    const H = ring(c, 84, -90, 6), Fr = ring(c, 44, -90, 3);
    const faces = [
      Fr,
      [Fr[0], Fr[1], H[1]], [Fr[1], Fr[2], H[3]], [Fr[2], Fr[0], H[5]],
      [Fr[0], H[0], H[1]], [Fr[1], H[1], H[2]], [Fr[1], H[2], H[3]], [Fr[2], H[3], H[4]], [Fr[2], H[4], H[5]], [Fr[0], H[5], H[0]],
    ];
    const edges = [[...Fr, Fr[0]], ...Fr.map((f, i) => [f, H[2 * i]]), [H[5], Fr[0], H[1], Fr[1], H[3], Fr[2], H[5]]];
    const fc = centroid(Fr);
    return { faces, outline: H, edges, pips: [[fc[0], fc[1] + 2, 9]] };
  },
};

// ---- The picture -------------------------------------------------------------------------------------------------------------------------------

/** A face's tint: dark, in the tone, lighter for faces toward the top left (the light). */
function faceTint(face, center, main) {
  const c = centroid(face);
  const dx = c[0] - center[0], dy = c[1] - center[1];
  const len = Math.hypot(dx, dy);
  const lit = len < 1 ? 0 : ((-dx - dy) / (len * Math.SQRT2)) * Math.min(1, len / 30);
  return mix(BOARD_BLACK, main, 0.17 + 0.11 * lit);
}

/** Domed pips with a soft shadow down and to the right. */
function pipsSvg(pips) {
  const at = (p, dx, dy) =>
    p.length > 3 ? `r="1" transform="matrix(${nums([...p.slice(2), p[0] + dx, p[1] + dy])})"` : `cx="${n(p[0] + dx)}" cy="${n(p[1] + dy)}" r="${n(p[2])}"`;
  return [
    `<g fill="#000" fill-opacity=".7">${pips.map((p) => `<circle ${at(p, 1.5, 2)}/>`).join('')}</g>`,
    `<g fill="url(#pip)" filter="url(#glow)">${pips.map((p) => `<circle ${at(p, 0, 0)}/>`).join('')}</g>`,
  ];
}

/** An outline's deep shadow (the emblem stands highest off the board) and its bevel, a lit edge toward the light and a shaded one away from it. */
const shadow = (outline) => `<path d="${closed(outline)}" fill-opacity=".85" transform="translate(6 9)" filter="url(#deep)"/>`;
const bevel = (outline, k) => {
  const c = centroid(outline);
  return `<path d="${closed(outline.map((p) => lerp(c, p, k)))}" fill="none" stroke="url(#bevel)" stroke-width="2" stroke-linejoin="round"/>`;
};

function dieSvg(e, t) {
  const center = centroid(e.outline);
  return [
    shadow(e.outline),
    ...e.faces.map((f) => `<path d="${closed(f)}" fill="${faceTint(f, center, t.main)}"/>`),
    `<g fill="none" stroke-linejoin="round" stroke-linecap="round" filter="url(#glow)">`,
    `<path d="${e.edges.map(line).join('')}" stroke="${t.accent}" stroke-width="2"/>`,
    `<path d="${closed(e.outline)}" stroke="${t.main}" stroke-width="4"/>`,
    '</g>',
    bevel(e.outline, 0.93),
    ...pipsSvg(e.pips),
  ];
}

function chipSvg(t) {
  // A chip with four pins on each side (they run on into the board's first two traces), a pin-one mark, and a die face of four pips on its core.
  const half = 54;
  const pins = [-30, -10, 10, 30].flatMap((off) => {
    let seg = [[C + off, C - half], [C + off, C - half - 14]];
    return [0, 1, 2, 3].map(() => (seg = seg.map(turn)));
  });
  const body = octagon(C - half, 15);
  const d = pins.map(line).join('');
  return [
    `<path d="${d}" stroke="#000" stroke-opacity=".8" stroke-width="6" stroke-linecap="round" transform="translate(2 3)" filter="url(#soft)"/>`,
    `<path d="${d}" stroke="${t.main}" stroke-width="5" stroke-linecap="round" filter="url(#glow)"/>`,
    shadow(body),
    `<path d="${closed(body)}" fill="url(#body)" stroke="${t.main}" stroke-width="4" stroke-linejoin="round" filter="url(#glow)"/>`,
    bevel(body, 0.92),
    `<path d="${closed(octagon(C - 32, 10))}" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linejoin="round" filter="url(#glow)"/>`,
    `<circle cx="${C - 40}" cy="${C - 40}" r="3.5" fill="${t.accent}" filter="url(#glow)"/>`,
    ...pipsSvg([[C - 14, C - 14, 8], [C + 14, C - 14, 8], [C - 14, C + 14, 8], [C + 14, C + 14, 8]]),
  ];
}

const COMET_HEAD = [160, 96];
const COMET_END = [46, 210];
function cometSvg(t) {
  // A comet crossing the socket from the bottom left to the top right: a tapering tail in its own color, fading out, two thin streaks beside it, a
  // little dust, and a bright head (a glowing halo and a core a shade lighter, never white), like the sleeves' moving lights.
  const [hx, hy] = COMET_HEAD, [ex, ey] = COMET_END;
  const len = Math.hypot(ex - hx, ey - hy);
  const d = [(ex - hx) / len, (ey - hy) / len], nrm = [-d[1], d[0]];
  const at = (w, along) => [hx + nrm[0] * w + d[0] * along, hy + nrm[1] * w + d[1] * along];
  return [
    `<path d="${closed([at(19, 0), COMET_END, at(-19, 0)])}" fill="url(#tail)" filter="url(#glow)"/>`,
    `<path d="${line([at(27, 14), at(27, 96)])}${line([at(-27, 14), at(-27, 96)])}" stroke="url(#tail)" stroke-width="3.5" stroke-linecap="round"/>`,
    `<g fill="${t.accent}" filter="url(#glow)">${[[38, 44, 2.5], [-33, 78, 2], [12, 132, 2]].map(([w, a, r]) => `<circle cx="${n(at(w, a)[0])}" cy="${n(at(w, a)[1])}" r="${r}"/>`).join('')}</g>`,
    `<circle cx="${hx}" cy="${hy}" r="38" fill="url(#coma)"/>`,
    `<circle cx="${hx}" cy="${hy}" r="19" fill="${t.main}" filter="url(#glow)"/>`,
    `<circle cx="${hx - 2}" cy="${hy - 2}" r="11" fill="${shade(t.main, 0.45)}"/>`,
  ];
}

/** The SVG of one avatar, by id. */
export function avatarSvg(id) {
  const cut = id.lastIndexOf('-');
  const shape = id.slice(0, cut), tone = id.slice(cut + 1);
  if (!SHAPES.includes(shape) || !TONES.includes(tone)) throw new Error(`unknown avatar id: ${id}`);
  const t = TONE_COLORS[tone];
  const stops = (list) => list.map(([o, c, a]) => `<stop offset="${n(o, 2)}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${n(a, 2)}"`}/>`).join('');
  const lin = (id, list, extra = 'x2="1" y2="1"') => `<linearGradient id="${id}" ${extra}>${stops(list)}</linearGradient>`;
  const paths = (color) => BOARD.filter((b) => !color || b.color === color).map((b) => line(b.pts)).join('');
  // Ring pads and vias keep the default black fill: a hole in the pad.
  const pads = (pad, r, attrs) =>
    `<g ${attrs}>${BOARD.filter((b) => b.pad === pad).map((b) => `<circle cx="${n(b.pts.at(-1)[0])}" cy="${n(b.pts.at(-1)[1])}" r="${r}"/>`).join('')}</g>`;
  const o = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    '<defs>',
    `<clipPath id="tile"><rect width="${S}" height="${S}" rx="30"/></clipPath>`,
    `<radialGradient id="halo">${stops([[0, t.main, 0.3], [0.6, t.accent, 0.08], [1, t.accent, 0]])}</radialGradient>`,
    lin('body', [[0, mix(BOARD_BLACK, t.main, 0.24)], [1, BOARD_BLACK]]),
    lin('bevel', [[0, '#FFF', 0.7], [0.45, '#FFF', 0], [1, '#000', 0.7]]),
    lin('edge', [[0, '#FFF', 0.42], [0.5, '#FFF', 0.06], [1, '#000', 0.75]]),
    `<radialGradient id="pip" cx=".36" cy=".32" r=".75">${stops([[0, '#FFF'], [0.5, '#E8E8F0'], [1, '#8A91A8']])}</radialGradient>`,
  ];
  if (shape === 'comet') {
    o.push(lin('tail', [[0, t.main, 0.95], [0.5, t.main, 0.6], [1, t.accent, 0]], `gradientUnits="userSpaceOnUse" x1="${COMET_HEAD[0]}" y1="${COMET_HEAD[1]}" x2="${COMET_END[0]}" y2="${COMET_END[1]}"`));
    o.push(`<radialGradient id="coma">${stops([[0, t.main, 0.6], [0.5, t.main, 0.18], [1, t.main, 0]])}</radialGradient>`);
  }
  o.push(
    '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2" result="a"/><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="w"/><feComponentTransfer in="w" result="b"><feFuncA type="linear" slope=".6"/></feComponentTransfer><feMerge><feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    '<filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.4"/></filter>',
    '<filter id="deep" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>',
    '</defs>',
    '<g clip-path="url(#tile)">',
    `<rect width="${S}" height="${S}"/>`,
    `<circle cx="${C}" cy="${C}" r="104" fill="url(#halo)"/>`,
    // The board: the traces stand off it with a soft shadow and glow in their colors, the main ones rounded wires with a lit ridge; then the pads.
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
    `<path d="${paths()}" stroke="#000" stroke-opacity=".8" stroke-width="4" transform="translate(1.5 2)" filter="url(#soft)"/>`,
    `<g stroke-width="2.6" filter="url(#glow)"><path d="${paths('main')}" stroke="${t.main}"/><path d="${paths('accent')}" stroke="${t.accent}"/></g>`,
    `<path d="${paths('main')}" stroke="${shade(t.main, 0.6)}" stroke-opacity=".9" stroke-width="1" transform="translate(-.5 -.6)"/>`,
    '</g>',
    '<g filter="url(#glow)">',
    pads('ring', 4.5, `stroke="${t.main}" stroke-width="2.4"`),
    pads('dot', 3.6, `fill="${t.accent}"`),
    pads('via', 3, `stroke="${t.main}" stroke-width="2"`),
    '</g>',
    // The frame, standing off the board and bevelled; the thin border outside it in the accent.
    '<g fill="none" stroke-linejoin="round">',
    `<path d="${closed(FRAME)}" stroke="#000" stroke-opacity=".8" stroke-width="7" transform="translate(2 3)" filter="url(#soft)"/>`,
    `<path d="${closed(FRAME)}" stroke="${t.main}" stroke-width="4.5" filter="url(#glow)"/>`,
    `<path d="${closed(FRAME)}" stroke="#000" stroke-opacity=".5" stroke-width="1.2" transform="translate(.8 1)"/>`,
    `<path d="${closed(FRAME)}" stroke="#FFF" stroke-opacity=".5" stroke-width="1.2" transform="translate(-.7 -.9)"/>`,
    `<rect x="7" y="7" width="${S - 14}" height="${S - 14}" rx="24" stroke="${t.accent}" stroke-width="1.5" filter="url(#glow)"/>`,
    '</g>',
    // The socket.
    `<circle cx="${C}" cy="${C}" r="${SOCKET}" fill="url(#body)" stroke="${t.main}" stroke-opacity=".7" stroke-width="2"/>`,
    `<circle cx="${C}" cy="${C}" r="${SOCKET - 7}" fill="none" stroke="${t.accent}" stroke-opacity=".35"/>`,
  );
  // The emblem.
  if (shape === 'chip') o.push(...chipSvg(t));
  else if (shape === 'comet') o.push(...cometSvg(t));
  else o.push(...dieSvg(EMBLEMS[shape](), t));
  // The tile's rounded edge, as the sleeves'.
  o.push(`<rect x="1.5" y="1.5" width="${S - 3}" height="${S - 3}" rx="28.5" fill="none" stroke="url(#edge)" stroke-width="3"/>`, '</g>', '</svg>');
  return o.join('\n') + '\n';
}

// ---- Command line ------------------------------------------------------------------------------------------------------------------------------

function main(argv) {
  const check = argv.includes('--check');
  const outAt = argv.indexOf('--out');
  if (outAt >= 0 && !argv[outAt + 1]) throw new Error('--out needs a directory');
  const dir = outAt >= 0 ? path.resolve(argv[outAt + 1]) : AVATAR_DIR;
  if (!check) {
    mkdirSync(dir, { recursive: true });
    for (const id of IDS) writeFileSync(path.join(dir, `${id}.svg`), avatarSvg(id), 'utf8');
    console.log(`ok: ${IDS.length} avatars in ${dir}`);
    return 0;
  }
  const problems = [];
  for (const id of IDS) {
    let have;
    try {
      have = readFileSync(path.join(dir, `${id}.svg`), 'utf8');
    } catch {
      problems.push(`${id}.svg: missing`);
      continue;
    }
    if (have !== avatarSvg(id)) problems.push(`${id}.svg: differs from what the script makes`);
  }
  const known = new Set(IDS.map((id) => `${id}.svg`));
  for (const f of readdirSync(dir)) if (f.endsWith('.svg') && !known.has(f)) problems.push(`${f}: not an avatar id`);
  for (const p of problems) console.error(p);
  console.log(problems.length === 0 ? `ok: the ${IDS.length} avatars match` : `${problems.length} problem(s): run node scripts/brand/gen-avatars.mjs`);
  return problems.length === 0 ? 0 : 1;
}

/**
 * Whether Node runs this file as its main script. Node resolves symbolic links in `import.meta.url` but not in `process.argv[1]`, so the two are
 * compared as real paths: called through a linked path, the script still runs (and --check still checks) instead of exiting 0 having done nothing.
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
