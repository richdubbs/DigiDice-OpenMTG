/**
 * WP2: the normalizer on the whole local Oracle index (skipped when `.cache/` is absent; set OPENMTG_CACHE_DIR to the cache folder of the main checkout when
 * running from a worktree). Normalization must be total, idempotent, and must not lose the text it keeps: every line normalizes to something that tokenizes
 * back to itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeForGate } from '../../../src/index';
import { gateTokens } from '../../../src/render/equivalence';
import { SLOW, slowTitle } from '../../slow';

const dir = process.env['OPENMTG_CACHE_DIR'] ?? join(process.cwd(), '.cache', 'scryfall');
const file = join(dir, 'cards.jsonl');

// QT: a slow suite (npm run test:all); the index is read only when the suite runs (Vitest runs a skipped describe's body to list its tests).
describe.skipIf(!SLOW || !existsSync(file))(slowTitle('the normalizer on the local Oracle index'), () => {
  const lines: { name: string; text: string }[] = [];
  if (SLOW && existsSync(file)) {
    for (const l of readFileSync(file, 'utf8').split('\n')) {
      if (!l) continue;
      const c = JSON.parse(l) as { name: string; oracle_text?: string; card_faces?: { name: string; oracle_text?: string }[] };
      for (const f of c.card_faces ?? [c]) if (f.oracle_text) lines.push({ name: f.name, text: f.oracle_text });
    }
  }

  it('is idempotent and its tokens join back to the text', () => {
    let checked = 0;
    for (const { name, text } of lines) {
      const names = [name, ...(name.includes(',') ? [name.split(',')[0]!] : [])];
      const once = normalizeForGate(text, names);
      expect(normalizeForGate(once, names), name).toBe(once);
      // tokens carry every character of the normalized text apart from the spaces
      expect(gateTokens(once).join(''), name).toBe(once.replace(/\s+/g, ''));
      checked++;
    }
    expect(checked).toBeGreaterThan(30000);
  }, 60_000); // merge wave 7: about 5 s alone over the whole index with 2,126 templates (4.6 s on main), over the 5 s default

  it('turns the object into ~ in the vast majority of cards that name themselves', () => {
    let named = 0;
    let replaced = 0;
    for (const { name, text } of lines) {
      const bare = text.replace(/\([^()]*\)/g, ' '); // reminder text is dropped before anything else
      if (!bare.toLowerCase().includes(name.toLowerCase()) && !/\bthis (creature|artifact|enchantment|land|spell|permanent)\b/.test(bare)) continue;
      named++;
      if (normalizeForGate(text, [name]).includes('~')) replaced++;
    }
    expect(replaced / named).toBeGreaterThan(0.99);
  });
});
