/**
 * M15-1: the package layout that no later package edits (design 13 intro, 16), checked where a mistake would only show later:
 *  - The `openmtg-ladder` bin target is committed executable (git mode 100755, as accounts' cli.ts). npm ci and npm install chmod a bin target to
 *    755, so a 100644 file leaves a tracked mode change in every checkout, and integrate.mjs's clean-tree check then refuses merge and train.
 *  - The package typecheck (tsconfig.json) covers src/, test/ and scripts/, where M15-6's scripts/simulate.ts lands (16), because M15-6 does not own
 *    tsconfig.json.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PKG } from './graph';

/** The git index entry of a package file ("<mode> <hash> <stage>\t<path>"; empty when untracked), or null outside a git checkout. */
function indexEntry(file: string): string | null {
  try {
    return execFileSync('git', ['-C', PKG, 'ls-files', '-s', '--', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
const inGit = indexEntry('package.json') !== null;

/** A path compared the same way on every platform. */
const norm = (p: string) => p.split('\\').join('/').replace(/\/$/, '').toLowerCase();

describe('M15-1: the package layout', () => {
  it.skipIf(!inGit)('every bin target is committed executable (100755), so npm ci leaves the checkout clean', () => {
    const json = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { bin: Record<string, string> };
    expect(Object.keys(json.bin)).toEqual(['openmtg-ladder']);
    for (const [name, target] of Object.entries(json.bin)) {
      const entry = indexEntry(target);
      expect(entry, `${name}: ${target} is tracked`).not.toBe('');
      expect(entry!.split(' ')[0], `${name}: ${target}'s committed mode`).toBe('100755');
      expect(readFileSync(join(PKG, target), 'utf8').split('\n')[0], `${name}: ${target}'s first line`).toBe('#!/usr/bin/env tsx');
    }
  });

  it('the package typecheck covers src/, test/ and scripts/ (M15-6\'s scripts/simulate.ts), with Node\'s types', () => {
    const configPath = join(PKG, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PKG, undefined, configPath);
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.types).toEqual(['node']);
    // the directories tsc reads .ts files from, whether or not a file exists there yet
    const dirs = Object.keys(parsed.wildcardDirectories ?? {}).map(norm);
    for (const d of ['src', 'test', 'scripts']) expect(dirs, d).toContain(norm(join(PKG, d)));
  });
});
