/**
 * Writes the data the Godot app ships with, from this repository's copies, so the two apps offer the same built-in decks and the same Home numbers:
 * `builtin-decks.json` (the practice decks and every Commander precon), `roadmap.json` (the Home roadmap) and `coverage-stats.json` (the measured
 * automation numbers). Run it when building a Godot release: `npx tsx scripts/export-godot-data.ts <the Godot app's data folder>`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRACTICE_DECKS } from '../packages/client/src/game/practiceDecks';
import { ROADMAP, STATUS_LABEL } from '../packages/client/src/screens/roadmap';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const out = process.argv[2];
if (!out) {
  console.error('Usage: npx tsx scripts/export-godot-data.ts <folder>');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const readJson = (rel: string): unknown => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const precons = readJson('packages/client/src/game/precons.generated.json') as { decks: unknown[] };

const files: [string, unknown][] = [
  ['builtin-decks.json', { practice: PRACTICE_DECKS, precons: precons.decks }],
  ['roadmap.json', { items: ROADMAP, labels: STATUS_LABEL }],
  ['coverage-stats.json', readJson('packages/client/src/screens/coverage-stats.json')],
];
for (const [name, data] of files) {
  writeFileSync(path.join(out, name), `${JSON.stringify(data)}\n`);
  console.log(`wrote ${path.join(out, name)}`);
}
