/** The dev-server middleware of the brand-assets Vite plugin: serves /brand/ and /legal/ only, survives malformed URLs, and does not scan the disk per request. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { brandMiddleware } from '../build/brand-assets';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function request(mw: ReturnType<typeof brandMiddleware>, url: string): { next: boolean; type?: string; body?: string } {
  const out: { next: boolean; type?: string; body?: string } = { next: false };
  const res = {
    setHeader: (k: string, v: string) => {
      if (k.toLowerCase() === 'content-type') out.type = v;
    },
    end: (b: Buffer) => {
      out.body = b.toString('utf8');
    },
  };
  mw({ url } as IncomingMessage, res as unknown as ServerResponse, () => {
    out.next = true;
  });
  return out;
}

describe('brand-assets dev middleware', () => {
  it('passes malformed percent-encoding on to the next handler instead of failing the request', () => {
    const mw = brandMiddleware(repoRoot);
    for (const url of ['/%E0%A4%A', '/brand/%E0%A4%A', '/api/cards/%E0%A4%A']) expect(() => request(mw, url), url).not.toThrow();
    for (const url of ['/%E0%A4%A', '/brand/%E0%A4%A', '/api/cards/%E0%A4%A']) expect(request(mw, url).next, url).toBe(true);
  });

  it('serves the brand files and the license files, and nothing else', () => {
    const mw = brandMiddleware(repoRoot);
    const readme = request(mw, '/brand/README.md?import');
    expect(readme.next).toBe(false);
    expect(readme.body).toMatch(/not covered by OpenMTG's MIT License/);
    expect(readme.type).toMatch(/text\/plain/);
    expect(request(mw, '/legal/LICENSE.txt').body).toMatch(/MIT License/);
    const sleeve = request(mw, '/brand/sleeves/sleeve-wu.svg');
    expect(sleeve.type).toBe('image/svg+xml');
    expect(sleeve.body).toMatch(/White-Blue sleeve/);
    expect(request(mw, '/src/main.tsx').next).toBe(true);
    expect(request(mw, '/brand/no-such-file.png').next).toBe(true);
  });

  it('does not scan the disk for requests outside /brand/ and /legal/ (module requests)', () => {
    const missing = brandMiddleware(path.join(tmpdir(), 'openmtg-no-such-repo'));
    for (let i = 0; i < 5; i++) expect(request(missing, `/src/module-${i}.ts`).next).toBe(true);
  });

  it('serves a brand file added while the dev server runs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'openmtg-brand-'));
    try {
      mkdirSync(path.join(root, 'assets', 'brand'), { recursive: true });
      for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) writeFileSync(path.join(root, f), f);
      writeFileSync(path.join(root, 'assets', 'brand', 'a.txt'), 'first');
      const mw = brandMiddleware(root);
      expect(request(mw, '/brand/a.txt').body).toBe('first');
      writeFileSync(path.join(root, 'assets', 'brand', 'b.txt'), 'added');
      expect(request(mw, '/brand/b.txt').body).toBe('added');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
