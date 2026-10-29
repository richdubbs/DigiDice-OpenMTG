/**
 * `npm run sounds -- --out <dir> [--workers <n>]` (Godot plan phase 3, step 4): renders every sound of the catalog, every variant, into `<dir>` as the
 * server's endpoints give them (sounds/api.ts): `<dir>/<id>#<variant>.wav` (16-bit PCM stereo, 48 kHz) and `<dir>/manifest.json` (the manifest, with the
 * catalog's hash). For packaging the sounds with the Godot table, or listening to them. Uses the server's render threads (pool.ts), all the cores but one.
 */
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { SoundService } from './service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = arg('out');
if (!out) {
  console.error('Usage: npm run sounds -- --out <dir> [--workers <n>]');
  process.exit(2);
}
const workers = Number(arg('workers') ?? Math.max(1, availableParallelism() - 1));
if (!Number.isInteger(workers) || workers < 1) {
  console.error(`Invalid --workers ${arg('workers') ?? ''}`);
  process.exit(2);
}

const dir = path.resolve(out);
const work = await mkdtemp(path.join(tmpdir(), 'openmtg-sounds-'));
const service = new SoundService({ dir: work, size: workers });
const t0 = Date.now();
try {
  const manifest = await service.manifest();
  await mkdir(dir, { recursive: true });
  const rendered = path.join(work, manifest.hash);
  let files = 0;
  for (const f of await readdir(rendered)) {
    if (!f.endsWith('.wav')) continue;
    await copyFile(path.join(rendered, f), path.join(dir, f));
    files++;
  }
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${files} sound files of ${manifest.sounds.length} sounds (catalog ${manifest.hash}, render version ${manifest.version}) in ${dir}, ${((Date.now() - t0) / 1000).toFixed(1)} s with ${workers} render threads.`);
} finally {
  await service.close();
  await rm(work, { recursive: true, force: true });
}
