#!/usr/bin/env node
/**
 * Prints the sound review's latest scores as a Markdown table (docs/audits/<date>-sound-review.md): for each group, the newest
 * .cache/sound/review/<group>/review-r<N>.json, plus the round each sound passed in and what it scored in round 1; a score from the newest
 * whole-set review (.cache/sound/review/all) replaces the group's (marked "(set)").
 *
 *   node scripts/sound/review-summary.mjs > table.md
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, '.cache', 'sound', 'review');
const ORDER = ['ui', 'flow', 'moments', 'spells', 'magic', 'combat', 'cards', 'zones'];
const NAMES = { ui: 'Interface', flow: 'Game flow', moments: 'Big moments', spells: 'Spells', magic: 'Mana and abilities', combat: 'Combat and life', cards: 'Cards', zones: 'Card states' };

// The whole-set review (.cache/sound/review/all/set-review-r<N>.json) re-scored some sounds in the context of the set: its newest scores win.
const setScores = new Map();
const allDir = path.join(dir, 'all');
if (existsSync(allDir)) {
  const n = readdirSync(allDir)
    .map((f) => /^set-review(?:-r(\d+))?\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1] ?? 1))
    .sort((a, b) => b - a)[0];
  if (n) {
    const file = path.join(allDir, n === 1 ? 'set-review.json' : `set-review-r${n}.json`);
    for (const r of JSON.parse(readFileSync(file, 'utf8')).scores ?? []) setScores.set(r.id, r);
  }
}

const lines = [];
let total = 0;
let passed = 0;
for (const group of ORDER) {
  const gdir = path.join(dir, group);
  if (!existsSync(gdir)) continue;
  const rounds = readdirSync(gdir)
    .map((f) => /^review-r(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  if (!rounds.length) continue;
  const byRound = new Map(rounds.map((r) => [r, JSON.parse(readFileSync(path.join(gdir, `review-r${r}.json`), 'utf8'))]));
  const last = byRound.get(rounds[rounds.length - 1]);
  lines.push(`### ${NAMES[group]} (${last.length} sounds, ${rounds.length} round${rounds.length > 1 ? 's' : ''})`, '');
  lines.push('| Sound | Purpose | Aesthetic | Pass | Round 1 | Passed in round |', '|---|---|---|---|---|---|');
  for (const groupRow of last) {
    const set = setScores.get(groupRow.id);
    const row = set ? { ...groupRow, purpose: set.purpose, aesthetic: set.aesthetic, pass: set.purpose >= 8 && set.aesthetic >= 7 } : groupRow;
    const first = byRound.get(rounds[0]).find((r) => r.id === row.id);
    const passRound = rounds.find((r) => byRound.get(r).find((x) => x.id === row.id)?.pass) ?? '-';
    total++;
    if (row.pass) passed++;
    lines.push(`| ${row.id} | ${row.purpose} | ${row.aesthetic}${set ? ' (set)' : ''} | ${row.pass ? 'yes' : 'NO'} | ${first ? `${first.purpose}/${first.aesthetic}` : '-'} | ${passRound} |`);
  }
  lines.push('');
}
console.log([`${passed} of ${total} sounds pass (purpose >= 8 and aesthetic >= 7).`, '', ...lines].join('\n'));
