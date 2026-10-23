/**
 * M14-9: the avatar pictures (design 7.1, 13.2). assets/avatars holds 48 files whose names are AVATAR_IDS; each parses as SVG, has no external
 * reference, no script and no text, and is under 8 KB. Each is also exactly what scripts/brand/gen-avatars.mjs makes, so the art in the repository is
 * always the committed script's (OpenMTG's own), and the script's shapes and tones are the contract's.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_IDS, AVATAR_SHAPES, AVATAR_TONES } from '@openmtg/accounts/api';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module script without types
import { IDS, SHAPES, TONES, avatarSvg } from '../../../../scripts/brand/gen-avatars.mjs';
import { XmlError, elements, parseXml, type XmlElement } from './xml';

const DIR = fileURLToPath(new URL('../../../../assets/avatars/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../../scripts/brand/gen-avatars.mjs', import.meta.url));
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_BYTES = 8 * 1024;

/**
 * The elements a picture may use: shapes, groups, gradients, clipping, masks, patterns and filter primitives that draw only from their own input.
 * Everything else is refused, among them script, foreignObject, image, use, a, style, the text elements (text, tspan, textPath, title, desc),
 * animation and feImage.
 */
const ALLOWED = new Set([
  'svg', 'defs', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
  'filter', 'feGaussianBlur', 'feOffset', 'feFlood', 'feComposite', 'feColorMatrix', 'feBlend', 'feMerge', 'feMergeNode',
  'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
]);

const read = (id: string): string => readFileSync(path.join(DIR, `${id}.svg`), 'utf8');

/** The drawing elements and their attributes that carry coordinates (gradient stops and bounding-box fractions are not coordinates). */
const DRAWING = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline', 'g']);
const GEOMETRY = ['d', 'transform', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'];

/** Half the 256 viewBox: the board's center. */
const HALF = 128;
/** The board's eight symmetries about its center: the quarter turns, each with and without a mirror. */
const D4: ((u: number, v: number) => readonly [number, number])[] = [
  (u, v) => [u, v], (u, v) => [-u, v], (u, v) => [u, -v], (u, v) => [-u, -v],
  (u, v) => [v, u], (u, v) => [-v, u], (u, v) => [v, -u], (u, v) => [-v, -u],
];

/** The vertices of path data made of M, L, H and V steps, absolute or relative, and Z (as the board's traces are); any other command throws. */
function vertices(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: [number, number][] = [];
  let x = 0, y = 0, start: [number, number] = [0, 0], cmd = '';
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') [x, y] = start;
      continue;
    }
    const num = (): number => Number(tokens[i++]);
    switch (cmd) {
      case 'M': x = num(); y = num(); start = [x, y]; cmd = 'L'; break;
      case 'm': x += num(); y += num(); start = [x, y]; cmd = 'l'; break;
      case 'L': x = num(); y = num(); break;
      case 'l': x += num(); y += num(); break;
      case 'H': x = num(); break;
      case 'h': x += num(); break;
      case 'V': y = num(); break;
      case 'v': y += num(); break;
      default: throw new Error(`path command ${JSON.stringify(cmd)} in ${d.slice(0, 40)}`);
    }
    out.push([x, y]);
  }
  return out;
}

/** What is wrong with one picture, as readable lines (empty when nothing is). */
function problems(root: XmlElement): string[] {
  const out: string[] = [];
  if (root.name !== 'svg') out.push(`the root is <${root.name}>, not <svg>`);
  if (root.attrs.get('xmlns') !== SVG_NS) out.push('the root is not in the SVG namespace');
  if (!/^0 0 (\d+) \1$/.test(root.attrs.get('viewBox') ?? '')) out.push('no square viewBox from 0 0');
  const all = elements(root);
  const ids = new Set<string>();
  for (const e of all) {
    const id = e.attrs.get('id');
    if (id === undefined) continue;
    if (ids.has(id)) out.push(`the id ${id} twice`);
    ids.add(id);
  }
  for (const e of all) {
    if (!ALLOWED.has(e.name)) out.push(`<${e.name}>`);
    for (const c of e.children) {
      if ('text' in c && c.text.trim() !== '') out.push(`text in <${e.name}>: ${JSON.stringify(c.text.trim().slice(0, 40))}`);
      if ('comment' in c) out.push(`a comment in <${e.name}>`);
    }
    for (const [key, value] of e.attrs) {
      if (e === root && key === 'xmlns') continue;
      // No namespaced attribute (xlink:href, xml:base, a second namespace), no link, no event handler, no inline style sheet.
      if (key.includes(':') || key.startsWith('xmlns')) out.push(`<${e.name} ${key}>`);
      if (key === 'href' || key === 'src') out.push(`<${e.name} ${key}>: a reference`);
      if (/^on/i.test(key)) out.push(`<${e.name} ${key}>: a script`);
      if (key === 'style') out.push(`<${e.name} style>`);
      // No URL of any scheme (http:, data:, javascript:, ...): no value holds a colon at all.
      if (value.includes(':')) out.push(`<${e.name} ${key}="${value}">: a URL`);
      // Paint servers, clips and filters only by a fragment of this file.
      for (const m of value.matchAll(/url\(([^)]*)\)/g)) {
        const target = /^#([A-Za-z_][\w.-]*)$/.exec(m[1]!.trim());
        if (!target) out.push(`<${e.name} ${key}="${value}">: not a local reference`);
        else if (!ids.has(target[1]!)) out.push(`<${e.name} ${key}="${value}">: no element #${target[1]}`);
      }
    }
  }
  return out;
}

describe('M14-9: the avatar pictures', () => {
  it('are 48 files, one per avatar id, named <id>.svg, beside the README', () => {
    expect(AVATAR_IDS).toHaveLength(48);
    const files = readdirSync(DIR).sort();
    expect(files.filter((f) => f !== 'README.md')).toEqual(AVATAR_IDS.map((id) => `${id}.svg`).sort());
    expect(files).toContain('README.md');
  });

  it.each(AVATAR_IDS)('%s: parses as SVG, with no external reference, no script and no text, under 8 KB', (id) => {
    const src = read(id);
    expect(Buffer.byteLength(src, 'utf8')).toBeLessThan(MAX_BYTES);
    const root = parseXml(src);
    expect(problems(root)).toEqual([]);
    // It draws something: more than its definitions.
    expect(elements(root).filter((e) => ['path', 'circle', 'rect'].includes(e.name)).length).toBeGreaterThan(20);
  });

  it('are exactly what scripts/brand/gen-avatars.mjs makes, for the contract\'s shapes and tones', () => {
    expect(SHAPES).toEqual([...AVATAR_SHAPES]);
    expect(TONES).toEqual([...AVATAR_TONES]);
    expect(IDS).toEqual([...AVATAR_IDS]);
    for (const id of AVATAR_IDS) expect(read(id), `${id}.svg (run node scripts/brand/gen-avatars.mjs)`).toBe(avatarSvg(id));
    expect(() => avatarSvg('d7-blue')).toThrow(/unknown avatar id/);
    expect(() => avatarSvg('d20-green')).toThrow(/unknown avatar id/);
  });

  it('differ from one another: no two ids share a picture', () => {
    expect(new Set(AVATAR_IDS.map(read)).size).toBe(48);
  });

  // Review of M14-9: the script once rounded each number of a list to as many decimals as its place in the list (x to none, y to one, a matrix's
  // values to two to five), which skewed the board's symmetry and the pips' ellipses.
  it.each(AVATAR_IDS)('%s: every coordinate has at most one decimal, and the board is drawn eight-fold symmetric', (id) => {
    const all = elements(parseXml(read(id)));
    const tooFine = all
      .filter((e) => DRAWING.has(e.name))
      .flatMap((e) => GEOMETRY.flatMap((k) => (/\.\d{2}/.test(e.attrs.get(k) ?? '') ? [`<${e.name} ${k}="${e.attrs.get(k)!.slice(0, 80)}">`] : [])));
    expect(tooFine).toEqual([]);
    // The board's shadow holds every trace of the board, each as its own subpath.
    const board = all.find((e) => e.name === 'path' && e.attrs.get('transform') === 'translate(1.5 2)');
    expect(board, "the board's shadow path").toBeDefined();
    const pts = vertices(board!.attrs.get('d')!);
    expect(pts.length).toBeGreaterThan(8 * 8);
    // Each vertex has its image under each of the board's eight symmetries, to the one decimal of the coordinates.
    const missing = pts.flatMap(([x, y]) =>
      D4.map((f) => f(x - HALF, y - HALF))
        .map(([u, v]) => [u + HALF, v + HALF] as const)
        .filter(([a, b]) => !pts.some(([p, q]) => Math.abs(p - a) <= 0.05 + 1e-6 && Math.abs(q - b) <= 0.05 + 1e-6))
        .map(([a, b]) => `${x},${y} -> ${a.toFixed(2)},${b.toFixed(2)}`),
    );
    expect(missing).toEqual([]);
  });
});

describe("M14-9: the script's command line", () => {
  // Review of M14-9: Node resolves symbolic links in import.meta.url but not in process.argv[1], and the script once compared the two as given, so
  // called through a linked path it did nothing and exited 0 (a --check that passed without checking).
  it.skipIf(process.platform === 'win32')('runs when called through a symbolic link, and --check then still checks', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'openmtg-m14-9-'));
    try {
      const fileLink = path.join(tmp, 'gen-avatars.mjs');
      symlinkSync(SCRIPT, fileLink, 'file');
      const repoLink = path.join(tmp, 'repo');
      symlinkSync(path.resolve(path.dirname(SCRIPT), '..', '..'), repoLink, 'dir');
      const empty = path.join(tmp, 'empty');
      mkdirSync(empty);
      const run = (...args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8' });
      for (const args of [
        [fileLink, '--check'],
        [path.join(repoLink, 'scripts', 'brand', 'gen-avatars.mjs'), '--check'],
        ['--preserve-symlinks-main', fileLink, '--check'],
      ]) {
        const r = run(...args);
        expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(0);
        expect(r.stdout, args.join(' ')).toContain('ok: the 48 avatars match');
      }
      const bad = run(fileLink, '--check', '--out', empty);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('d4-blue.svg: missing');
      expect(bad.stdout).toContain('48 problem(s)');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('M14-9: the checks themselves', () => {
  const svg = (body: string, attrs = ''): string => `<svg xmlns="${SVG_NS}" viewBox="0 0 256 256"${attrs}>${body}<path d="M0 0h1"/></svg>`;

  it('the XML reader refuses documents that are not well-formed', () => {
    const broken = [
      '<svg><g></svg>', // mismatched
      '<svg><g>', // unclosed
      '<svg a=1/>', // unquoted value
      '<svg a="1" a="2"/>', // an attribute twice
      '<svg a="x<y"/>', // '<' in a value
      '<svg>&nbsp;</svg>', // a named entity XML does not define
      '<svg>a & b</svg>', // a bare ampersand
      '<svg>&#0;</svg>', // a reference to a character XML does not allow
      '<svg/><svg/>', // two roots
      '<svg/>text', // text after the root
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', // a document type
      '<svg><![CDATA[x]]></svg>', // CDATA
      '<svg><?pi x?></svg>', // a processing instruction
      '<svg><!-- a -- b --></svg>', // '--' in a comment
      '<svg>\u0001</svg>', // a control character
      '<svg ab/>', // an attribute without a value
      '<svg a="1"b="2"/>', // no space between attributes
      '', // nothing
    ];
    for (const doc of broken) expect(() => parseXml(doc), doc).toThrow(XmlError);
    const ok = parseXml(`<?xml version="1.0"?>\n<!-- x --><svg a='1' b="&amp;&#65;&#x42;"><g/>t</svg>\n`);
    expect(ok.attrs.get('b')).toBe('&AB');
    expect(ok.children).toHaveLength(2);
  });

  it('the path reader follows absolute and relative steps, short numbers and closes', () => {
    expect(vertices('M1 2h3v-1l-.5.5L10 10ZM20 20H25V21')).toEqual([[1, 2], [4, 2], [4, 1], [3.5, 1.5], [10, 10], [20, 20], [25, 20], [25, 21]]);
    expect(vertices('M1 2L3 4 5 6')).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(() => vertices('M0 0C1 1 2 2 3 3')).toThrow(/path command "C"/);
  });

  it('finds scripts, text, references, styles and foreign namespaces', () => {
    const found = (doc: string): string[] => problems(parseXml(doc));
    expect(found(svg(''))).toEqual([]);
    expect(found(svg('<script>alert(1)</script>'))).toContain('<script>');
    expect(found(svg('<text>Hi</text>')).join('\n')).toMatch(/<text>[\s\S]*text in <text>/);
    expect(found(svg('<title>A</title>'))).toContain('<title>');
    expect(found(svg('<g>words</g>'))).toEqual(['text in <g>: "words"']);
    expect(found(svg('<image href="https://example.com/a.png"/>')).join('\n')).toMatch(/<image>[\s\S]*a reference[\s\S]*a URL/);
    expect(found(svg('<use href="#x"/>')).join('\n')).toMatch(/<use>[\s\S]*a reference/);
    expect(found(svg('<path d="M0 0" onclick="x()"/>'))).toContain('<path onclick>: a script');
    expect(found(svg('<path d="M0 0" style="fill:red"/>')).join('\n')).toMatch(/<path style>/);
    expect(found(svg('<path d="M0 0" fill="url(https://example.com/x#p)"/>')).join('\n')).toMatch(/not a local reference/);
    expect(found(svg('<path d="M0 0" fill="url(#nowhere)"/>'))).toEqual(['<path fill="url(#nowhere)">: no element #nowhere']);
    expect(found(svg('<linearGradient id="g"/><path d="M0 0" fill="url(#g)"/>'))).toEqual([]);
    expect(found(svg('<g id="a"/><g id="a"/>'))).toEqual(['the id a twice']);
    expect(found(svg('', ' xmlns:xlink="http://www.w3.org/1999/xlink"')).join('\n')).toMatch(/xmlns:xlink/);
    expect(found(svg('<!-- note -->'))).toEqual(['a comment in <svg>']);
    expect(found('<svg viewBox="0 0 256 256"/>')).toContain('the root is not in the SVG namespace');
  });
});
