/**
 * M14-11: the `AccountsSql` seam (design 11.5, 2.1, 13.2): accounts' own structural interface and hosted's `SqlClient` (m13 store/sql.ts) have exactly the same
 * shape, each assignable to the other (a type test: the typecheck gate fails on a difference, as m13 did for PGlite without importing it), and accounts
 * imports nothing of hosted, not even a type. The ladder's copy of the seam (m15) is pinned against this one by its own tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AccountsSql, AccountsSqlQueryable, AccountsSqlResult } from '@openmtg/accounts';
import type { SqlClient, SqlQueryable, SqlResult } from '../../../hosted/src/store/sql';

// ---- compile-time: each is assignable to the other, at every level of the seam ----------------------------------------------------------------------
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameClient: Same<SqlClient, AccountsSql> = true;
const sameQueryable: Same<SqlQueryable, AccountsSqlQueryable> = true;
const sameResult: Same<SqlResult<{ a: number }>, AccountsSqlResult<{ a: number }>> = true;
export const toAccounts = (s: SqlClient): AccountsSql => s;
export const toHosted = (s: AccountsSql): SqlClient => s;
export const queryableToAccounts = (s: SqlQueryable): AccountsSqlQueryable => s;
export const queryableToHosted = (s: AccountsSqlQueryable): SqlQueryable => s;

describe('M14-11 the AccountsSql seam', () => {
  it('hosted\'s SqlClient and accounts\' AccountsSql are each assignable to the other (checked by the compiler)', () => {
    expect([sameClient, sameQueryable, sameResult]).toEqual([true, true, true]);
    expect(typeof toAccounts).toBe('function');
    expect(typeof toHosted).toBe('function');
    expect(typeof queryableToAccounts).toBe('function');
    expect(typeof queryableToHosted).toBe('function');
  });

  it('accounts imports nothing of hosted in its source, not even a type', () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(50);
    const imports = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(imports)) {
        const target = m[1] ?? m[2] ?? m[3] ?? '';
        expect(target, `${f}: ${target}`).not.toMatch(/hosted|@openmtg\/(?!accounts)/);
      }
    }
  });
});
