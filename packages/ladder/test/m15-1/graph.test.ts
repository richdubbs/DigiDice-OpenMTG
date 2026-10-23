/**
 * M15-1: the import-graph reader the browser-safe, load and door tests stand on (test/m15-1/graph.ts). It must see every way a file names a module,
 * and whether that is erased at run time, or a file could reach a module around those tests: an import type (`import('@openmtg/accounts').T`) has
 * no import statement and is no call, and was once missed, so a file other than src/accounts.ts could name accounts' server root unseen.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { edges } from './graph';

const tmp = mkdtempSync(join(tmpdir(), 'openmtg-m15-1-graph-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The edges of a file with this text, as [spec, typeOnly, the file a relative spec leads to (its name) or null]. */
function edgesOf(text: string): [string, boolean, string | null][] {
  const file = join(tmp, 'probe.ts');
  writeFileSync(file, text, 'utf8');
  return edges(file).map((e) => [e.spec, e.typeOnly, e.to === null ? null : e.to.slice(tmp.length + 1)]);
}

writeFileSync(join(tmp, 'sibling.ts'), 'export type S = 1;\nexport const s = 1;\n', 'utf8');

describe('M15-1: the import-graph reader', () => {
  it('sees import types as type-only edges, in any type position', () => {
    expect(edgesOf("export type Probe = import('@openmtg/accounts').AccountId;\n")).toEqual([['@openmtg/accounts', true, null]]);
    expect(edgesOf("export type Mod = typeof import('@openmtg/accounts');\n")).toEqual([['@openmtg/accounts', true, null]]);
    expect(edgesOf("export function f(x: import('@openmtg/accounts/api').AccountId): void { void x; }\n")).toEqual([['@openmtg/accounts/api', true, null]]);
    expect(edgesOf("export interface I { s: import('./sibling').S }\n")).toEqual([['./sibling', true, 'sibling.ts']]);
  });

  it('sees declare module as a type-only edge', () => {
    expect(edgesOf("export {};\ndeclare module '@openmtg/accounts' { interface Extra { x: 1 } }\n")).toEqual([['@openmtg/accounts', true, null]]);
  });

  it('sees the static forms, with their erasure', () => {
    const text = [
      "import { s } from './sibling';",
      "import type { S } from './sibling';",
      "import { type S as T } from './sibling';",
      "import './sibling';",
      "export * from './sibling';",
      "export type { S as U } from './sibling';",
      "import x = require('node:fs');",
      "import type y = require('node:path');",
      'export const v: [S, T, number, unknown, unknown] = [1, 1, s, x, null as unknown as typeof y];',
    ].join('\n');
    expect(edgesOf(text)).toEqual([
      ['./sibling', false, 'sibling.ts'], ['./sibling', true, 'sibling.ts'], ['./sibling', true, 'sibling.ts'], ['./sibling', false, 'sibling.ts'],
      ['./sibling', false, 'sibling.ts'], ['./sibling', true, 'sibling.ts'], ['node:fs', false, null], ['node:path', true, null],
    ]);
  });

  it('sees dynamic import() and require() calls as run-time edges', () => {
    expect(edgesOf("export const a = () => import('@openmtg/accounts');\n")).toEqual([['@openmtg/accounts', false, null]]);
    expect(edgesOf("declare const require: (s: string) => unknown;\nexport const b = require('node:fs');\n")).toEqual([['node:fs', false, null]]);
  });
});
