/**
 * Serves the built client (packages/client/dist). Paths are resolved inside the root only; a path without a file extension that is not a file gets
 * index.html (the client navigates by state, so this only matters for reloads of odd URLs).
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export interface StaticFile {
  body: Buffer;
  type: string;
  /** Vite's hashed build output under /assets/ never changes: cache it; everything else is revalidated. */
  immutable: boolean;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** The file for a URL path, or null (404). Never reads outside `root`. */
export async function resolveStatic(root: string, urlPath: string): Promise<StaticFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = path.resolve(root);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null; // traversal ("/../", "..\\", absolute paths)
  let file = full;
  if (!(await isFile(file))) {
    if (path.extname(rel) !== '') return null;
    file = path.join(base, 'index.html');
    if (!(await isFile(file))) return null;
  }
  const ext = path.extname(file).toLowerCase();
  return { body: await readFile(file), type: TYPES[ext] ?? 'application/octet-stream', immutable: rel.startsWith('assets/') };
}
