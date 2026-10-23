/**
 * M14-1: `@openmtg/accounts/api` loads, whichever of its files a loader or a bundle reaches first. api.ts re-exports the parts in ./api/*, so a part
 * that read a value of ../api at its top level (ACCOUNT_LIMITS.emailMax, say) would find it undefined, or in its temporal dead zone, while that
 * cycle loads, and loading the contract would throw in Node and in the browser bundle (review of M14-1, finding 1).
 *  - Statically: no module that api.ts loads takes a value from api.ts (`import type` only); values come from the leaf ./api/limits.ts, which
 *    imports nothing.
 *  - By loading, each in a fresh process: an esbuild bundle for the browser, and Node with tsx (the development loader), once per first file.
 * Both keep working after the owners fill the stubs (M14-2, M14-3, M14-8): they load the files and never call the parts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const src = join(pkg, 'src');
const API = join(src, 'api.ts');
const LEAF = join(src, 'api', 'limits.ts');
/** api.ts first, then each file of ./api/* first. */
const FIRSTS = ['api.ts', ...readdirSync(join(src, 'api')).filter((f) => f.endsWith('.ts')).sort().map((f) => `api/${f}`)];
const PART_FUNCTIONS = ['checkAccountName', 'passwordShapeProblem', 'normalizeRecoveryCode', 'formatRecoveryCode', 'emailProblem'];

/** esbuild is a dependency of tsx and vitest, not of the project: the bundle test is skipped when it cannot be imported. */
const esbuild = await import('esbuild').catch(() => null);

const tmp = mkdtempSync(join(tmpdir(), 'openmtg-m14-1-load-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Edge { from: string; to: string; typeOnly: boolean; text: string }

/** The file a relative specifier names (bundler resolution: the .ts file before a directory's index.ts). */
function target(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const p of [base.endsWith('.ts') ? base : `${base}.ts`, join(base, 'index.ts')]) {
    try {
      readFileSync(p);
      return p;
    } catch {
      // not this one
    }
  }
  return null;
}

/** Every static import and re-export of a file, and whether it is erased at run time (`import type`, or only `type` names). */
function edges(file: string): Edge[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const out: Edge[] = [];
  const push = (spec: ts.Expression | undefined, typeOnly: boolean, node: ts.Node) => {
    if (spec === undefined || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) return;
    const to = target(file, spec.text);
    expect(to, `${relative(src, file)} imports ${spec.text}, which does not resolve`).not.toBeNull();
    out.push({ from: file, to: to!, typeOnly, text: node.getText(sf).split('\n')[0]! });
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const c = st.importClause;
      const named = c?.namedBindings !== undefined && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      const typeOnly = c !== undefined && (c.isTypeOnly || (c.name === undefined && named !== null && named.length > 0 && named.every((e) => e.isTypeOnly)));
      push(st.moduleSpecifier, typeOnly, st);
    } else if (ts.isExportDeclaration(st)) {
      const named = st.exportClause !== undefined && ts.isNamedExports(st.exportClause) ? st.exportClause.elements : null;
      push(st.moduleSpecifier, st.isTypeOnly || (named !== null && named.length > 0 && named.every((e) => e.isTypeOnly)), st);
    }
  }
  return out;
}

/** The files api.ts loads, with their edges. */
function graph(): Map<string, Edge[]> {
  const seen = new Map<string, Edge[]>();
  const todo = [API];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    const e = edges(file);
    seen.set(file, e);
    for (const x of e) todo.push(x.to);
  }
  return seen;
}

let runs = 0;
function runNode(args: string[], script: string): unknown {
  const file = join(tmp, `run-${++runs}.mjs`);
  writeFileSync(file, script, 'utf8');
  return JSON.parse(execFileSync(process.execPath, [...args, file], { cwd: pkg, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** What every load prints: the contract's exports as seen after `first` loaded first. */
const REPORT = `
const fns = ${JSON.stringify(PART_FUNCTIONS)};
console.log(JSON.stringify({
  firstExports: Object.keys(first).length > 0,
  sameLimits: api.ACCOUNT_LIMITS === leaf.ACCOUNT_LIMITS,
  limits: [api.ACCOUNT_LIMITS.nameMax, api.ACCOUNT_LIMITS.passwordMin, api.ACCOUNT_LIMITS.emailMax],
  parts: fns.map((f) => typeof api[f]),
  status: api.accountStatus([], null, '2026-10-21T00:00:00.000Z'),
}));
`;
const WANT = { firstExports: true, sameLimits: true, limits: [20, 12, 254], parts: PART_FUNCTIONS.map(() => 'function'), status: 'active' };

describe('M14-1: the contract has no load-order hazard (finding 1)', () => {
  it('no module api.ts loads takes a value from api.ts; ./api/limits.ts is a leaf and api.ts re-exports it by name', () => {
    const g = graph();
    const files = [...g.keys()].map((f) => relative(src, f).split('\\').join('/'));
    for (const f of ['api.ts', 'api/limits.ts', 'api/names.ts', 'api/passwords.ts', 'api/email.ts']) expect(files).toContain(f);
    for (const [file, e] of g) {
      if (file === API) continue;
      for (const x of e.filter((y) => y.to === API)) {
        expect(x.typeOnly, `${relative(src, file)}: "${x.text}" takes a value from ../api (a cycle: take values from ./limits, types with import type)`).toBe(true);
      }
    }
    expect(g.get(LEAF), 'api/limits.ts imports nothing').toEqual([]);
    const text = readFileSync(API, 'utf8');
    expect(text).toMatch(/^export \{ ACCOUNT_LIMITS \} from '\.\/api\/limits';$/m);
    expect(text).not.toMatch(/^export \*/m);
  });

  it.skipIf(esbuild === null)('an esbuild bundle for the browser loads, whichever file comes first', async () => {
    for (const first of FIRSTS) {
      const out = await esbuild!.build({
        stdin: {
          contents: `import * as first from './${first}'; import * as api from './api.ts'; import * as leaf from './api/limits.ts';\n${REPORT}`,
          resolveDir: src, sourcefile: 'load-entry.ts', loader: 'ts',
        },
        bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
      });
      const file = join(tmp, `bundle-${first.replace(/\W/g, '_')}.mjs`);
      writeFileSync(file, out.outputFiles[0]!.text, 'utf8');
      expect(JSON.parse(execFileSync(process.execPath, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })), first).toEqual(WANT);
    }
  }, 60_000);

  it('Node with tsx loads it, whichever file comes first', () => {
    for (const first of FIRSTS) {
      const url = (f: string) => JSON.stringify(pathToFileURL(join(src, f)).href);
      const script = `const first = await import(${url(first)}); const api = await import(${url('api.ts')}); const leaf = await import(${url('api/limits.ts')});\n${REPORT}`;
      expect(runNode(['--import', 'tsx'], script), first).toEqual(WANT);
    }
  }, 60_000);
});
