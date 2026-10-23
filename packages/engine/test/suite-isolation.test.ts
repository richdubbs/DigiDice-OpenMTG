/**
 * Package QT: the fast default suite. Checks the pieces vitest.config.ts relies on: which node test files run isolated (suite-isolation.ts), the guard
 * that fails a file leaving an engine table changed (shared-state-guard.ts), the slow-suite gate (slow.ts) and the `npm run test:all` script.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SLOW, SLOW_SKIP_REASON, slowTitle } from './slow';
import { codeOf, copyTables, isolatedTestFiles, needsIsolation, nodeTestSources, tableChanges } from './suite-isolation';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The sources below are built from V so that this file's own text holds no such call (it would put this file in the isolated set).
const V = ['v', 'i'].join('');

describe('which node test files run isolated', () => {
  it('a file that replaces modules, globals, timers or spies needs isolation', () => {
    for (const call of [`${V}.mock('../x', () => ({}));`, `${V}.doMock("y");`, `${V}.stubGlobal('fetch', f);`, `${V}.stubEnv('A', '1');`, `${V}.useFakeTimers();`, `${V}.spyOn(console, "log");`, `${V}.resetModules();`, `${V} .mock("z")`]) {
      expect(needsIsolation(`import { vi } from 'vitest';\n${call}\n`), call).toBe(true);
    }
  });

  it('a mock function and a mention in a comment do not', () => {
    expect(needsIsolation(`const f = ${V}.fn();\n// install with ${V}.mock('../x')\n/** ${V}.stubGlobal is not used here */\n`)).toBe(false);
    expect(codeOf(`a(); // ${V}.mock(b)\n/* ${V}.spyOn */ c();`)).not.toContain(`${V}.`);
    expect(codeOf(`const url = 'https://example.test/x'; ${V}.mock('y');`)).toContain(`${V}.mock('y')`); // "//" after a colon (a URL) is not a comment
  });

  it('the isolated set holds the files that mock modules and none that do not; never a client file (the client project is isolated anyway)', () => {
    const files = isolatedTestFiles(ROOT);
    for (const f of ['packages/engine/test/m5/zones/move.test.ts', 'packages/engine/test/m5/lasting/effect.test.ts', 'packages/server/test/contracts.test.ts', 'packages/cards/test/remote.test.ts']) {
      expect(files, f).toContain(f);
    }
    for (const f of ['packages/engine/test/m4/sba.test.ts', 'packages/engine/test/m5/skeleton/capabilities.test.ts', 'packages/engine/test/suite-isolation.test.ts']) {
      expect(files, f).not.toContain(f);
    }
    expect(files.every((f) => /^packages\/(?!client\/)[^/]+\/test\/.+\.test\.tsx?$/.test(f))).toBe(true);
  });

  it('no test helper replaces modules or globals itself (its importers would run unisolated): only *.test files may, and they are found above', () => {
    const helpers = nodeTestSources(ROOT).filter((f) => !/\.test\.tsx?$/.test(f) && needsIsolation(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(helpers).toEqual([]);
  });
});

describe('the shared-state guard', () => {
  it('names every added, removed and replaced entry of a table, a set included', () => {
    const f = (): string => 'f';
    const g = (): string => 'g';
    const table: Record<string, unknown> = { draw: f, tap: f };
    const set = new Set(['op:draw']);
    const before = copyTables({ T: table, S: set });
    delete table['tap'];
    table['draw'] = g;
    table['scry'] = f;
    set.add('op:scry');
    expect(tableChanges(before, copyTables({ T: table, S: set })).sort()).toEqual(['S.op:scry added', 'T.draw replaced', 'T.scry added', 'T.tap removed']);
  });

  it('a table put back exactly is unchanged (a restored key may come back in another order)', () => {
    const f = (): string => 'f';
    const table: Record<string, unknown> = { draw: f, tap: f };
    const before = copyTables({ T: table });
    delete table['draw'];
    table['draw'] = f;
    expect(tableChanges(before, copyTables({ T: table }))).toEqual([]);
  });
});

describe('the slow-suite gate', () => {
  it('follows OPENMTG_SLOW=1; a skipped test says why and how to run it, a run one keeps its title', () => {
    expect(SLOW).toBe(process.env['OPENMTG_SLOW'] === '1');
    expect(slowTitle('soak')).toBe(SLOW ? 'soak' : `soak [${SLOW_SKIP_REASON}]`);
    expect(SLOW_SKIP_REASON).toContain('npm run test:all');
    expect(SLOW_SKIP_REASON).toContain('OPENMTG_SLOW=1');
  });

  it('npm run test:all runs Vitest with OPENMTG_SLOW=1 and passes options through', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test']).toBe('vitest run');
    expect(pkg.scripts['test:all']).toBe('node scripts/test-all.mjs');
    const script = readFileSync(path.join(ROOT, 'scripts', 'test-all.mjs'), 'utf8');
    expect(script).toContain("OPENMTG_SLOW: '1'");
    expect(script).toContain("'run', ...process.argv.slice(2)");
  });
});
