/**
 * `@openmtg/hosted/api` is browser-safe (design D1): api.ts and api/* import nothing but engine types and each other. (`tsconfig.api.json` also compiles
 * api.ts without Node's types in `npm run typecheck`.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const files = ['api.ts', ...readdirSync(join(src, 'api')).map((f) => `api/${f}`)];

describe('M13-1: the browser-safe contract', () => {
  it('imports only engine types and its own api files', () => {
    expect(files).toContain('api/patch.ts');
    for (const f of files) {
      const text = readFileSync(join(src, f), 'utf8');
      const imports = [...text.matchAll(/^\s*(import|export)\b[^;]*?\bfrom\s+'([^']+)'/gms)].map((m) => ({ stmt: m[0].trim(), from: m[2]! }));
      for (const { stmt, from } of imports) {
        if (from.startsWith('./') || from.startsWith('../')) {
          expect(from, `${f}: ${stmt}`).toMatch(/^\.\/api\/|^\.\/patch$|^\.\.\/api$/);
          continue;
        }
        expect(from, `${f}: ${stmt}`).toBe('@openmtg/engine');
        expect(stmt, `${f}: engine imports are type-only`).toMatch(/^import type /);
      }
      expect(text, f).not.toMatch(/\brequire\(|['"]node:|\bprocess\.|\bBuffer\b/);
    }
  });

  it('the package exports ./api as src/api.ts', () => {
    const pkg = JSON.parse(readFileSync(join(src, '..', 'package.json'), 'utf8')) as { exports: Record<string, string> };
    expect(pkg.exports['./api']).toBe('./src/api.ts');
  });
});
