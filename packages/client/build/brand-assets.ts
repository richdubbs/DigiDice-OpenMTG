/**
 * Vite plugin: publishes the DigiDice brand assets (assets/brand/, NOT MIT licensed: see its README, which is published with them) under /brand/ and the
 * license files under /legal/, without copying them into the source tree. The dev server serves them from the repository; `vite build` emits them
 * into dist/.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface PublishedFile {
  /** Path in the built site, without a leading slash ("brand/card-back.svg"). */
  url: string;
  /** Absolute source path. */
  src: string;
}

const LEGAL: [string, string][] = [
  ['LICENSE', 'legal/LICENSE.txt'],
  ['NOTICE', 'legal/NOTICE.txt'],
  ['THIRD_PARTY_NOTICES.md', 'legal/THIRD_PARTY_NOTICES.md'],
];

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Every file the plugin publishes: all of assets/brand with its subfolders (the sleeves; the README notice included) plus the license files. */
export function publishedFiles(repoRoot: string): PublishedFile[] {
  const brand: PublishedFile[] = [];
  const walk = (dir: string, url: string) => {
    for (const f of readdirSync(dir).sort()) {
      const src = path.join(dir, f);
      if (statSync(src).isDirectory()) walk(src, `${url}${f}/`);
      else brand.push({ url: `${url}${f}`, src });
    }
  };
  walk(path.join(repoRoot, 'assets', 'brand'), 'brand/');
  return [...brand, ...LEGAL.map(([src, url]) => ({ url, src: path.join(repoRoot, src) }))];
}

/**
 * The dev-server middleware. It looks only at /brand/ and /legal/ paths (every other request, /api and module requests included, goes straight on to
 * Vite) and passes a URL it cannot decode on as well. The file list is read on the first brand request and again only when a brand file is missing
 * (a file added while the dev server runs), never per request.
 */
export function brandMiddleware(repoRoot: string): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  let files: Map<string, string> | null = null;
  const load = (): Map<string, string> => new Map(publishedFiles(repoRoot).map((f) => [f.url, f.src]));
  return (req, res, next) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
    } catch {
      return next(); // malformed percent-encoding: not a brand file
    }
    if (!url.startsWith('brand/') && !url.startsWith('legal/')) return next();
    files ??= load();
    let src = files.get(url);
    if (src === undefined && url.startsWith('brand/')) {
      files = load();
      src = files.get(url);
    }
    if (src === undefined) return next();
    res.setHeader('Content-Type', TYPES[path.extname(url)] ?? 'application/octet-stream');
    res.end(readFileSync(src));
  };
}

export function brandAssets(repoRoot: string): Plugin {
  return {
    name: 'openmtg-brand-assets',
    configureServer(server) {
      server.middlewares.use(brandMiddleware(repoRoot));
    },
    generateBundle() {
      for (const f of publishedFiles(repoRoot)) this.emitFile({ type: 'asset', fileName: f.url, source: readFileSync(f.src) });
    },
  };
}
