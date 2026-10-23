/**
 * Which node test files must run isolated (package QT). The fast default suite (`npm test`) runs the other node test files without per-file module
 * isolation (Vitest `isolate: false`): each worker loads the engine once instead of once per file, which is most of the default suite's time. A file
 * that replaces modules or globals (vi.mock, vi.doMock, vi.stubGlobal, vi.stubEnv, fake timers, vi.spyOn, vi.resetModules) could leak that into the
 * next file of its worker, so it runs in the isolated `node-isolated` project instead. `npm run test:all` (OPENMTG_SLOW=1) and OPENMTG_ISOLATE=1 run
 * every file isolated, as before QT.
 *
 * Read by vitest.config.ts (plain Node, no Vitest globals here) and checked by suite-isolation.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** A call that changes module or global state beyond the file that makes it. Comments do not count (see `codeOf`). */
export const ISOLATION_CALL = /\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|hoisted|stubGlobal|unstubAllGlobals|stubEnv|unstubAllEnvs|useFakeTimers|useRealTimers|setSystemTime|spyOn|resetModules|importActual|importMock)\b/;

/** The source without line and block comments (a rough strip: good enough for the call pattern above, which never appears in a string here). */
export function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

export function needsIsolation(source: string): boolean {
  return ISOLATION_CALL.test(codeOf(source));
}

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(?:ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every .ts/.tsx file under packages/<pkg>/test of the node project (the client package has its own jsdom project), as repo-relative POSIX paths. */
export function nodeTestSources(root: string): string[] {
  const packages = path.join(root, 'packages');
  return readdirSync(packages, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'client')
    .flatMap((d) => {
      try {
        return walk(path.join(packages, d.name, 'test'), []);
      } catch {
        return [];
      }
    })
    .map((p) => path.relative(root, p).split(path.sep).join('/'))
    .sort();
}

/** A copy of the entries of named tables (objects: own keys to values; sets: their values), for shared-state-guard.ts. */
export type TablesCopy = Map<string, Map<unknown, unknown>>;

export function copyTables(tables: Readonly<Record<string, object>>): TablesCopy {
  return new Map(
    Object.entries(tables).map(([name, t]) => [
      name,
      t instanceof Set ? new Map([...(t as Set<unknown>)].map((v) => [v, true])) : new Map(Reflect.ownKeys(t).map((k) => [k, (t as Record<PropertyKey, unknown>)[k]])),
    ]),
  );
}

/** The entries that differ between two copies, as "TABLE.key added | removed | replaced". */
export function tableChanges(before: TablesCopy, after: TablesCopy): string[] {
  const out: string[] = [];
  for (const [name, b] of before) {
    const a = after.get(name) ?? new Map<unknown, unknown>();
    for (const [k, v] of b) {
      if (!a.has(k)) out.push(`${name}.${String(k)} removed`);
      else if (!Object.is(a.get(k), v)) out.push(`${name}.${String(k)} replaced`);
    }
    for (const k of a.keys()) if (!b.has(k)) out.push(`${name}.${String(k)} added`);
  }
  return out;
}

/** The node test files (*.test.ts[x]) that must run isolated, as repo-relative POSIX paths (usable as Vitest include patterns). */
export function isolatedTestFiles(root: string): string[] {
  return nodeTestSources(root).filter((f) => /\.test\.tsx?$/.test(f) && needsIsolation(readFileSync(path.join(root, f), 'utf8')));
}
