/**
 * Verifying, installing and loading rules packs (updates.md, design 12.5, WP27). Installed packs live in `.cache/packs/` (git-ignored; override with
 * $OPENMTG_PACKS_DIR):
 *
 *   .cache/packs/openmtg-rules-pack.json            the pack, byte for byte as verified
 *   .cache/packs/openmtg-rules-pack.manifest.json   its manifest (SHA-256 and size), written by the installer when the source had none
 *   .cache/packs/installed.json                     { packVersion, sha256, source, installedAt, verifiedBy }
 *
 * The SHA-256 is checked on install (against the published manifest) and again on every load (tamper detection of the installed file).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonIfExists, writeFileAtomic } from '../fsutil';
import { repoRoot } from '../paths';
import { decodeText } from '../text';
import { MANIFEST_FORMAT, PACK_FORMAT_VERSION, validateManifest, validatePack, type PackManifest, type ValidatedPack } from './format';

export const PACK_FILE = 'openmtg-rules-pack.json';
export const MANIFEST_FILE = 'openmtg-rules-pack.manifest.json';
export const INSTALLED_FILE = 'installed.json';

export function defaultPacksDir(env: Record<string, string | undefined> = process.env): string {
  const o = env['OPENMTG_PACKS_DIR']?.trim();
  return o ? path.resolve(o) : path.join(repoRoot(), '.cache', 'packs');
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface InstalledRecord {
  packVersion: string;
  sha256: string;
  size: number;
  source: string;
  installedAt: string;
  /** 'manifest': the published manifest's hash matched; 'none': a local file installed without a manifest (the owner's own file). */
  verifiedBy: 'manifest' | 'none';
}

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

/** Check pack bytes against a manifest (size and SHA-256). Throws PackError on any difference: a tampered or truncated download is never installed. */
export function verifyAgainstManifest(bytes: Uint8Array, manifest: PackManifest): void {
  if (bytes.length !== manifest.size) throw new PackError(`the pack is ${bytes.length} bytes; the manifest says ${manifest.size}: download damaged or tampered with, not installed`);
  const h = sha256(bytes);
  if (h !== manifest.sha256) throw new PackError(`the pack's SHA-256 is ${h}; the manifest says ${manifest.sha256}: download damaged or tampered with, not installed`);
}

function parsePack(bytes: Uint8Array): ValidatedPack {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    throw new PackError(`the pack is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const v = validatePack(json);
  if ('fatal' in v) throw new PackError(v.fatal);
  return v;
}

/**
 * Install a pack: verify (manifest, then format and every entry), then write it. A pack is data, never code: nothing in it is executed. Returns the
 * validated pack (rejected entries listed in `problems`, the rest installed as published).
 */
export async function installPack(bytes: Uint8Array, manifest: PackManifest | null, dir: string, source: string, now: Date): Promise<{ validated: ValidatedPack; record: InstalledRecord }> {
  if (manifest) verifyAgainstManifest(bytes, manifest);
  const validated = parsePack(bytes);
  const hash = sha256(bytes);
  const m: PackManifest = manifest ?? { format: MANIFEST_FORMAT, formatVersion: PACK_FORMAT_VERSION, packVersion: validated.pack.packVersion, file: PACK_FILE, sha256: hash, size: bytes.length };
  const record: InstalledRecord = { packVersion: validated.pack.packVersion, sha256: hash, size: bytes.length, source, installedAt: now.toISOString(), verifiedBy: manifest ? 'manifest' : 'none' };
  await writeFileAtomic(path.join(dir, PACK_FILE), bytes);
  await writeFileAtomic(path.join(dir, MANIFEST_FILE), `${JSON.stringify({ ...m, file: PACK_FILE }, null, 2)}\n`);
  await writeFileAtomic(path.join(dir, INSTALLED_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return { validated, record };
}

export interface LoadedPack extends ValidatedPack {
  record: InstalledRecord;
}

/** The installed pack, re-verified (its SHA-256 against the install record), or null when none is installed. Throws PackError when it was altered. */
export async function loadInstalledPack(dir: string): Promise<LoadedPack | null> {
  const record = await readJsonIfExists<InstalledRecord>(path.join(dir, INSTALLED_FILE));
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path.join(dir, PACK_FILE));
  } catch {
    return null;
  }
  if (!record) throw new PackError(`${path.join(dir, PACK_FILE)} has no install record: install it again with npm run cards -- update --file <pack>`);
  const h = sha256(bytes);
  if (h !== record.sha256) throw new PackError(`the installed pack was changed after it was installed (SHA-256 ${h}, installed ${record.sha256}): install it again`);
  return { ...parsePack(bytes), record };
}

/** A manifest file, validated. */
export async function readManifestFile(file: string): Promise<PackManifest> {
  let json: unknown;
  try {
    json = JSON.parse(decodeText(await readFile(file)));
  } catch (e) {
    throw new PackError(`cannot read the manifest ${file} (${e instanceof Error ? e.message : String(e)})`);
  }
  const m = validateManifest(json);
  if (typeof m === 'string') throw new PackError(m);
  return m;
}
