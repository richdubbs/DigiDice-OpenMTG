/**
 * M15-1: `@openmtg/ladder/api` is browser-safe (design D1, D21, 13.1, 17.1): api.ts and everything it imports (./api/*, ./accounts) import nothing at
 * run time but files of their own, use no `node:` module and no Node global, and compile without Node's types (tsconfig.api.json, the same compile
 * `npm run typecheck` runs). The one package they name is @openmtg/accounts/api, for types only, in src/accounts.ts.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API, apiParts, graph, PKG, rel, SRC } from './graph';

const PARTS = ['api/cap.ts', 'api/constants.ts', 'api/display.ts', 'api/glicko2.ts', 'api/ladders.ts', 'api/places.ts', 'api/season.ts', 'api/stakes.ts', 'api/tiers.ts', 'api/wenglin.ts'];

describe('M15-1: the browser-safe contract', () => {
  it('src/api/ holds exactly the leaf and M15-2\'s nine parts', () => {
    expect(apiParts().map(rel)).toEqual(PARTS);
  });

  it('api.ts, ./api/* and what they import load nothing at run time but files of their own, and no node: module', () => {
    const g = graph([API, ...apiParts()]);
    const files = [...g.keys()].map(rel).sort();
    expect(files).toEqual(['accounts.ts', 'api.ts', ...PARTS].sort());
    for (const [file, edges] of g) {
      for (const e of edges) {
        if (e.to !== null) continue;
        // a package or node: specifier: only @openmtg/accounts/api, only for types, only in src/accounts.ts
        expect(e.typeOnly, `${rel(file)}: "${e.text}" loads ${e.spec} at run time`).toBe(true);
        expect(e.spec, `${rel(file)}: ${e.text}`).toBe('@openmtg/accounts/api');
        expect(rel(file)).toBe('accounts.ts');
      }
      for (const e of edges) if (e.spec.startsWith('.')) expect(e.to, `${rel(file)}: ${e.spec} does not resolve`).not.toBeNull();
    }
  });

  it('no Node global in their code (comments aside)', () => {
    for (const file of graph([API, ...apiParts()]).keys()) {
      const text = readFileSync(file, 'utf8');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, rel(file)).not.toMatch(/['"]node:|\bprocess\.|\bBuffer\b|\b__dirname\b|\b__filename\b|\brequire\s*\(|\bglobalThis\b/);
    }
  });

  it('compiles without Node types, as the client compiles it (tsconfig.api.json)', () => {
    const configPath = join(PKG, 'tsconfig.api.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PKG, undefined, configPath);
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.types).toEqual([]);
    expect(parsed.fileNames.map((f) => relative(SRC, f).split('\\').join('/'))).toEqual(['api.ts']);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
    // the compile saw the api graph, and beyond this package only accounts' browser-safe contract (api.ts and its parts)
    const own = program.getSourceFiles().filter((s) => !s.isDeclarationFile).map((s) => s.fileName.split('\\').join('/'));
    const ladder = own.filter((f) => f.startsWith(`${SRC.split('\\').join('/')}/`)).map((f) => f.slice(SRC.length + 1)).sort();
    expect(ladder).toEqual(['accounts.ts', 'api.ts', ...PARTS].sort());
    // accounts' browser-safe contract: api.ts, its parts under api/, and text.ts (the text rules its name and password parts use; accounts
    // design 13.1, M14-1 and M14-2), which imports nothing
    for (const f of own.filter((x) => !x.startsWith(`${SRC.split('\\').join('/')}/`))) {
      expect(f, f).toMatch(/\/packages\/accounts\/src\/(api(\.ts|\/[a-z]+\.ts)|text\.ts)$/);
      if (f.endsWith('/packages/accounts/src/text.ts')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/^\s*import\s|\brequire\(/m);
    }
  }, 120_000);

  it('the package exports ./api as src/api.ts, has the openmtg-ladder bin entry and depends on @openmtg/accounts only', () => {
    const json = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      name: string; type: string; exports: Record<string, string>; bin: Record<string, string>; scripts: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(json.name).toBe('@openmtg/ladder');
    expect(json.type).toBe('module');
    expect(json.exports).toEqual({ '.': './src/index.ts', './api': './src/api.ts' });
    expect(json.bin).toEqual({ 'openmtg-ladder': 'src/cli.ts' });
    expect(json.scripts.typecheck).toBe('tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.api.json');
    // D1: at run time, types of @openmtg/accounts/api and nothing third-party (a later test-only tool, M15-7's PGlite, would be a devDependency)
    expect(json.dependencies).toEqual({ '@openmtg/accounts': '*' });
  });

  it('the root lockfile has the workspace with that dependency and bin entry', () => {
    const lock = JSON.parse(readFileSync(join(PKG, '..', '..', 'package-lock.json'), 'utf8')) as { packages: Record<string, unknown> };
    expect(lock.packages['packages/ladder']).toMatchObject({
      name: '@openmtg/ladder', version: '0.0.0', license: 'MIT', dependencies: { '@openmtg/accounts': '*' }, bin: { 'openmtg-ladder': 'src/cli.ts' },
    });
    expect(lock.packages['node_modules/@openmtg/ladder']).toEqual({ resolved: 'packages/ladder', link: true });
  });
});
