/**
 * Generates the built-in Commander precon decks that the New game screen offers (packages/client/src/game/precons.generated.json) from
 * docs/decks/commander-precons.md (every preconstructed Commander deck MTGJSON lists, with the printings in the box).
 *
 *   npx tsx scripts/gen-precons.ts            write the file
 *   npx tsx scripts/gen-precons.ts --check    exit 1 when the checked-in file differs from what the decklists produce (test/precons.test.ts does the same)
 *
 * Output: per deck its name, set, release date, color identity, commander(s) and the other cards, as Oracle names with counts (the printing columns are
 * not copied: a game deck is names, the local server compiles them from the card index). Several printings of one card are one entry. A reversible card
 * listed as "Name // Name" (Secret Lair) is its one Oracle name, and a meld card listed as "Front // Meld result" (MTGJSON's name; a meld result is the
 * back half of two different fronts, CR 712.4) is its front's Oracle name. Planechase planes and Archenemy schemes that come with a deck are not part of the 100
 * cards and are left out. Each deck's commander and other cards must add up to its "Cards" line, or the generator stops. Newest deck first (the order the
 * picker shows), then the order of the decklists. Deterministic: no clock.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const PRECONS_MD = join(REPO_ROOT, 'docs/decks/commander-precons.md');
export const PRECONS_PATH = join(REPO_ROOT, 'packages/client/src/game/precons.generated.json');

/** One precon deck: [count, Oracle name] rows. */
export interface PreconDeck {
  id: string;
  name: string;
  set: string;
  released: string;
  colors: string;
  commander: [number, string][];
  main: [number, string][];
}

export interface PreconFile {
  _comment: string;
  source: string;
  decks: PreconDeck[];
}

/**
 * "Okaun, Eye of Chaos // Okaun, Eye of Chaos" (a reversible card) is "Okaun, Eye of Chaos"; "Bruna, the Fading Light // Brisela, Voice of Nightmares" is
 * "Bruna, the Fading Light" when Brisela is in `meldResults`; any other name ("Fire // Ice") is kept as written.
 */
export function oracleName(name: string, meldResults: ReadonlySet<string> = new Set()): string {
  const m = /^(.+) \/\/ (.+)$/.exec(name);
  return m && (m[1] === m[2] || meldResults.has(m[2]!)) ? m[1]! : name;
}

/** The back halves "X" of "A // X" names that follow two or more different fronts in the document: meld results (CR 712.4: two cards meld into one). */
export function meldResultsOf(md: string): Set<string> {
  const fronts = new Map<string, Set<string>>();
  for (const m of md.matchAll(/^\| \d+ \| ([^|]+?) \/\/ ([^|]+?) \|/gm)) {
    if (m[1] === m[2]) continue;
    fronts.set(m[2]!, (fronts.get(m[2]!) ?? new Set<string>()).add(m[1]!));
  }
  return new Set([...fronts].filter(([, f]) => f.size > 1).map(([back]) => back));
}

function addRow(rows: [number, string][], count: number, name: string): void {
  const have = rows.find((r) => r[1] === name);
  if (have) have[0] += count;
  else rows.push([count, name]);
}

/** The decks of the decklist document, in its order. Throws on a deck whose cards do not add up to its "Cards" line. */
export function parsePrecons(md: string): { source: string; decks: PreconDeck[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const src = /Data: (MTGJSON [^)]*\))/.exec(md);
  const meld = meldResultsOf(lines.join('\n'));
  const decks: (PreconDeck & { cards: number })[] = [];
  let deck: (PreconDeck & { cards: number }) | undefined;
  let section: 'commander' | 'main' | 'other' | undefined;
  for (const line of lines) {
    const head = /^## (.+) \(([A-Z0-9]+)\) <a id="([^"]+)"><\/a>$/.exec(line);
    if (head) {
      deck = { id: `precon:${head[3]}`, name: head[1]!, set: head[2]!, released: '', colors: '', commander: [], main: [], cards: 0 };
      decks.push(deck);
      section = undefined;
      continue;
    }
    if (!deck) continue;
    const bullet = /^- \*\*(Released|Color identity|Cards):\*\* (.*)$/.exec(line);
    if (bullet) {
      if (bullet[1] === 'Released') deck.released = bullet[2]!.trim();
      else if (bullet[1] === 'Color identity') deck.colors = bullet[2]!.trim();
      else deck.cards = Number(bullet[2]);
      continue;
    }
    const sub = /^### (.+)$/.exec(line);
    if (sub) {
      section = sub[1] === 'Commander' ? 'commander' : sub[1] === 'Deck' ? 'main' : 'other';
      continue;
    }
    if (section === 'commander' || section === 'main') {
      const cells = line.startsWith('|') ? line.split('|').slice(1, -1).map((c) => c.trim()) : [];
      if (cells.length < 2 || !/^\d+$/.test(cells[0]!)) continue; // header and divider rows
      addRow(deck[section], Number(cells[0]), oracleName(cells[1]!, meld));
    }
  }
  for (const d of decks) {
    const total = [...d.commander, ...d.main].reduce((n, r) => n + r[0], 0);
    if (d.commander.length === 0 || total !== d.cards) throw new Error(`gen-precons: ${d.name} (${d.set}): ${d.commander.length} commander(s), ${total} cards, the list says ${d.cards}`);
  }
  return { source: src ? src[1]! : 'MTGJSON', decks: decks.map(({ cards: _cards, ...d }) => d) };
}

/** Newest first, then the document's order (Array.prototype.sort is stable). */
export function generatePrecons(md: string): PreconFile {
  const { source, decks } = parsePrecons(md);
  return {
    _comment:
      'GENERATED by scripts/gen-precons.ts from docs/decks/commander-precons.md. Do not edit: run `npx tsx scripts/gen-precons.ts`. A test fails if this file is stale. Card names and counts only.',
    source,
    decks: [...decks].sort((a, b) => (a.released < b.released ? 1 : a.released > b.released ? -1 : 0)),
  };
}

/** One deck per line, so a changed decklist is a one-line diff. */
export function serializePrecons(f: PreconFile): string {
  const decks = f.decks.map((d) => `    ${JSON.stringify(d)}`).join(',\n');
  return `{\n  "_comment": ${JSON.stringify(f._comment)},\n  "source": ${JSON.stringify(f.source)},\n  "decks": [\n${decks}\n  ]\n}\n`;
}

function main(): void {
  const text = serializePrecons(generatePrecons(readFileSync(PRECONS_MD, 'utf8')));
  if (process.argv.includes('--check')) {
    const have = existsSync(PRECONS_PATH) ? readFileSync(PRECONS_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
    if (have !== text) {
      console.error('gen-precons: packages/client/src/game/precons.generated.json is stale. Run: npx tsx scripts/gen-precons.ts');
      process.exit(1);
    }
    console.log('gen-precons: up to date');
    return;
  }
  writeFileSync(PRECONS_PATH, text);
  console.log(`gen-precons: wrote ${PRECONS_PATH} (${(JSON.parse(text) as PreconFile).decks.length} decks)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
