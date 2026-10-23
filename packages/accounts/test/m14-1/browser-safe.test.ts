/**
 * M14-1: `@openmtg/accounts/api` is browser-safe (design D1, 11.1, 13.2): api.ts and ./api/* (and everything they import) import nothing from `node:`
 * and no package at all, use no Node globals, and compile without Node's types (tsconfig.api.json, the same compile `npm run typecheck` runs).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const src = join(pkg, 'src');

/** Every module specifier of a file: static imports and exports (type-only ones too), side-effect imports, dynamic import(), require(). */
function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gms)) out.push(m[1]!);
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}

/** The files reachable from api.ts and ./api/* through relative imports. */
function reachable(): Map<string, string> {
  const start = ['api.ts', ...readdirSync(join(src, 'api')).filter((f) => f.endsWith('.ts')).map((f) => `api/${f}`)].map((f) => join(src, f));
  const seen = new Map<string, string>();
  const todo = [...start];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const s of specifiers(text)) {
      if (!s.startsWith('./') && !s.startsWith('../')) continue;
      const base = resolve(dirname(file), s);
      const target = [`${base}.ts`, join(base, 'index.ts'), base].find((p) => {
        try {
          return readFileSync(p) !== undefined;
        } catch {
          return false;
        }
      });
      expect(target, `${relative(src, file)} imports ${s}, which does not resolve`).toBeDefined();
      todo.push(target!);
    }
  }
  return seen;
}

describe('M14-1: the browser-safe contract', () => {
  it('api.ts, ./api/* and what they import use no package, no node: module and no Node global', () => {
    const files = reachable();
    const names = [...files.keys()].map((f) => relative(src, f).split('\\').join('/')).sort();
    for (const f of ['api.ts', 'api/limits.ts', 'api/names.ts', 'api/passwords.ts', 'api/email.ts']) expect(names).toContain(f);
    for (const [file, text] of files) {
      const f = relative(src, file);
      for (const s of specifiers(text)) expect(s.startsWith('./') || s.startsWith('../'), `${f} imports ${s}`).toBe(true);
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/['"]node:|\bprocess\.|\bBuffer\b|\b__dirname\b|\brequire\s*\(/);
    }
  });

  it('compiles without Node types, as the client compiles it (tsconfig.api.json)', () => {
    const configPath = join(pkg, 'tsconfig.api.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, pkg, undefined, configPath);
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.types).toEqual([]);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
    // the compile saw the api graph, and only files of this package
    const own = program.getSourceFiles().filter((s) => !s.isDeclarationFile).map((s) => relative(src, s.fileName).split('\\').join('/'));
    for (const f of ['api.ts', 'api/limits.ts', 'api/names.ts', 'api/passwords.ts', 'api/email.ts']) expect(own).toContain(f);
    for (const f of own) expect(f.startsWith('..'), f).toBe(false);
  }, 120_000);

  it('the package exports ./api as src/api.ts and has the openmtg-accounts bin entry', () => {
    const json = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as {
      name: string; exports: Record<string, string>; bin: Record<string, string>; dependencies?: unknown;
    };
    expect(json.name).toBe('@openmtg/accounts');
    expect(json.exports['./api']).toBe('./src/api.ts');
    expect(json.exports['.']).toBe('./src/index.ts');
    expect(json.bin['openmtg-accounts']).toBe('src/cli.ts');
    // D1: no workspace package and no npm package
    expect(json.dependencies).toBeUndefined();
  });
});
