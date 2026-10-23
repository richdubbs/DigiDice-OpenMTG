/**
 * GET /api/status: versions and the card-data date for the About screen (branding slot 8). Reads only the cache's bulk-meta.json; never the network.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { COMPILER_VERSION } from '@openmtg/engine';
import type { StatusResponse } from './api';
import { coverageCounts } from './cache';
import type { Handler, ServerContext } from './context';
import { installedPackVersion } from './update';

interface BulkMetaFile {
  updated_at?: unknown;
  downloaded_at?: unknown;
  index?: { cards?: unknown };
}

async function readCardData(ctx: ServerContext): Promise<StatusResponse['cardData']> {
  let meta: BulkMetaFile;
  try {
    meta = JSON.parse(await readFile(path.join(ctx.cacheDir, 'bulk-meta.json'), 'utf8')) as BulkMetaFile;
  } catch {
    return null; // no download yet, or an unreadable file: the About screen says "not downloaded"
  }
  if (typeof meta.updated_at !== 'string' || typeof meta.downloaded_at !== 'string') return null;
  const cards = meta.index?.cards;
  return { updatedAt: meta.updated_at, downloadedAt: meta.downloaded_at, ...(typeof cards === 'number' ? { cards } : {}) };
}

export const getStatus: Handler<'GET /api/status'> = async (_req, ctx) => ({
  status: 200,
  body: {
    app: { name: 'OpenMTG', version: ctx.version },
    compilerVersion: COMPILER_VERSION,
    cardData: await readCardData(ctx),
    rulesPack: await installedPackVersion(ctx), // UPD1: the installed rules pack (docs/design/updates.md), from its install record
    coverage: await coverageCounts(ctx), // C1 fills this in inside cache.ts
    ...(ctx.hostedUrl ? { hostedUrl: ctx.hostedUrl } : {}), // M13-11: the hosted game server this page may offer (absent: none configured)
  },
});
