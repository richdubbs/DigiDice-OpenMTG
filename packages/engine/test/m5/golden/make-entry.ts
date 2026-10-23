/**
 * Helper (not a test): print golden-file lines for cards, from the game's own parse. Usage (from the repository root):
 *   npx tsx packages/engine/test/m5/golden/make-entry.ts <spec.json> <golden-file.json>
 * where spec.json is [{ "card": "<Oracle name>", "verified": "<text>" }]. The ability JSON must then be read against the Oracle text by hand; the entry
 * is appended to the golden file only when the card parses fully automated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCard } from '../../../src/index';
import { behavior, goldenCard, goldenOptions, partial, understood } from './harness';

const [, , specFile, outFile] = process.argv;
const spec = JSON.parse(readFileSync(specFile!, 'utf8')) as { card: string; verified: string }[];
const opts = goldenOptions();
const lines: string[] = [];
for (const s of spec) {
  const card = goldenCard(s.card);
  if (!card) throw new Error(`not in the local index: ${s.card}`);
  const parsed = parseCard(card, opts);
  const abilities = parsed.faces.map((f) => f.abilities);
  for (const f of abilities) for (const a of f) if (!understood(a) || partial(a)) throw new Error(`${s.card}: not fully understood`);
  const faces = abilities.map((f) => ({ abilities: f.map((a) => JSON.parse(behavior(a)) as unknown) }));
  lines.push(JSON.stringify({ card: s.card, expect: 'full', verified: s.verified, faces }));
}
const text = readFileSync(outFile!, 'utf8').replace(/\s+$/, '');
if (!text.endsWith(']')) throw new Error('golden file does not end with ]');
const body = text.slice(0, -1).replace(/\s+$/, '');
writeFileSync(outFile!, `${body}${body.endsWith('[') ? '' : ','}\n${lines.join(',\n')}\n]\n`);
console.log(`appended ${lines.length} entries to ${outFile}`);
