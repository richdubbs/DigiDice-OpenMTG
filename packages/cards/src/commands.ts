/** CLI commands. Each returns a process exit code (0 = success). */
import { readFile } from 'node:fs/promises';
import type { OracleCard } from '@openmtg/engine';
import { CardDatabase, CardDatabaseError, type ResolvedEntry } from './database';
import { totalCount } from './decklist';
import { generateFixtures } from './fixtures';
import { INDEX_SCHEMA } from './index-store';
import { decodeText } from './text';
import { defaultCacheDir, defaultFixturesDir } from './paths';
import { COVERAGE_COMMANDS, COVERAGE_USAGE, coverageCommand } from './coverage/cli';
import { findFormat, formatListLines, reportLines, takeOption, validateDeck } from './formats';
import { PACK_COMMANDS, PACK_USAGE, packCommand } from './pack/cli';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Standard input as text (use decodeText on the raw bytes so UTF-16 and BOMs work). */
  readStdin: () => Promise<string>;
  /** Ask one question on the terminal (review --interactive); absent when there is no terminal. */
  prompt?: (question: string) => Promise<string>;
}

export const USAGE = `OpenMTG card tool (Scryfall Oracle data, cached locally)

Usage: npm run cards -- <command> [options]

Commands:
  refresh [--force|--reindex] [--include-unsanctioned]
                                Download the Oracle Cards bulk file and build the local index.
                                Skips if the last download is under 24 h old or Scryfall has nothing newer.
                                --reindex rebuilds the index from the cached bulk file without any network access.
                                --include-unsanctioned also keeps silver-border and acorn cards, as manual-only
                                cards outside format play (off by default; an index built with other options
                                is rebuilt from the cached file).
  lookup <name> [--json] [--no-fetch]
                                Show a card. Names missing locally are fetched once (POST /cards/collection) and cached.
  deck <file|-> [--no-fetch] [--format <format>]
                                Resolve a decklist (file, or - for stdin). Reports unknown names with suggestions.
                                --format checks it against a format (standard, pioneer, modern, legacy, vintage,
                                pauper, commander, duel, brawl, standardbrawl, historic, timeless, casual):
                                deck size, copies, sideboard, banned/restricted/not legal (Scryfall data from the
                                last refresh), commander (with Duel Commander's banned-as-commander list) and color
                                identity. Exit code 1 when the deck is not legal.
  fixtures                      Regenerate packages/engine/test/fixtures/cards.json from the *.txt name lists there.
  stats                         Show cache location, bulk file metadata and index counts.
${COVERAGE_USAGE}
${PACK_USAGE}


Cache directory: $OPENMTG_CACHE_DIR or <repo>/.cache/scryfall (git-ignored).`;

type FaceLike = { name: string; mana_cost?: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string; loyalty?: string; defense?: string };

function formatCard(card: OracleCard): string[] {
  const lines: string[] = [];
  const head = (c: FaceLike) => {
    lines.push(`${c.name}${c.mana_cost ? `   ${c.mana_cost}` : ''}`);
    if (c.type_line) lines.push(c.type_line);
    if (c.oracle_text) lines.push(...c.oracle_text.split('\n'));
    if (c.power !== undefined) lines.push(`${c.power}/${c.toughness}`);
    if (c.loyalty !== undefined) lines.push(`Loyalty: ${c.loyalty}`);
    if (c.defense !== undefined) lines.push(`Defense: ${c.defense}`);
  };
  lines.push(`[${card.layout}] mana value ${card.cmc ?? '?'}${card.keywords?.length ? `, keywords: ${card.keywords.join(', ')}` : ''}`);
  if (card.card_faces && card.card_faces.length > 1) {
    card.card_faces.forEach((f, i) => {
      lines.push(`--- face ${i + 1} ---`);
      head(f);
    });
  } else head(card);
  return lines;
}

function splitArgs(args: string[]): { positional: string[]; flags: Set<string> } {
  const positional: string[] = [];
  const flags = new Set<string>();
  for (const a of args) {
    if (a.startsWith('--')) flags.add(a);
    else positional.push(a);
  }
  return { positional, flags };
}

function checkFlags(flags: Set<string>, allowed: string[], io: Io): boolean {
  const bad = [...flags].filter((f) => !allowed.includes(f));
  if (bad.length) io.err(`Unknown option(s): ${bad.join(', ')}`);
  return bad.length === 0;
}

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  const extra = (PACK_COMMANDS as readonly string[]).includes(command ?? '') ? packCommand : null;
  if (extra !== null || (COVERAGE_COMMANDS as readonly string[]).includes(command ?? '')) {
    try {
      return await (extra ?? coverageCommand)(command!, rest, io);
    } catch (e) {
      io.err(e instanceof CardDatabaseError ? e.message : `Error: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  const formatOpt = command === 'deck' ? takeOption(rest, '--format') : { rest, present: false };
  const { positional, flags } = splitArgs(formatOpt.rest);
  const log = (m: string) => io.err(m);
  try {
    switch (command) {
      case 'refresh': {
        if (!checkFlags(flags, ['--force', '--reindex', '--include-unsanctioned'], io)) return 2;
        const index = flags.has('--include-unsanctioned') ? { includeUnsanctioned: true } : {};
        const db = await CardDatabase.open({ allowEmpty: true, log });
        if (flags.has('--reindex')) {
          const meta = await db.reindex(index);
          io.out(`Rebuilt the index from ${meta.file} (no network).`);
          const s = await db.stats();
          io.out(`Index: ${s.cards} cards, ${s.aliases} face aliases, ${s.tokenVariants} token/emblem variants (${s.tokenNames} names)`);
          return 0;
        }
        const r = await db.refresh({ force: flags.has('--force'), index });
        io.out(`${r.action}: ${r.reason}`);
        const s = await db.stats();
        io.out(`Bulk file: ${r.meta.file} (${(r.meta.size / 1048576).toFixed(1)} MiB, ${r.meta.format}), Scryfall updated_at ${r.meta.updated_at}`);
        io.out(`Index: ${s.cards} cards, ${s.aliases} face aliases, ${s.tokenVariants} token/emblem variants (${s.tokenNames} names)`);
        return 0;
      }
      case 'lookup': {
        if (!checkFlags(flags, ['--json', '--no-fetch'], io)) return 2;
        const name = positional.join(' ').trim();
        if (!name) {
          io.err('Usage: lookup <name>');
          return 2;
        }
        const db = await CardDatabase.open({ log });
        const { resolved, fetchError } = await db.resolveNames([name], { fetchMissing: !flags.has('--no-fetch') });
        const hit = resolved[0];
        if (fetchError) io.err(`Could not ask Scryfall: ${fetchError}`);
        if (!hit?.card) {
          if (hit?.ambiguous) {
            io.err(`Ambiguous face name "${name}": it could be ${hit.ambiguous.join('; ')}. Use the full card name.`);
            return 1;
          }
          const sug = db.suggest(name);
          io.err(`Unknown card "${name}".${sug.length ? ` Did you mean: ${sug.join(', ')}?` : ''}`);
          return 1;
        }
        if (flags.has('--json')) io.out(JSON.stringify(hit.card, null, 2));
        else {
          io.out(`(${hit.source === 'fetched' ? 'fetched from Scryfall' : 'local index'})`);
          formatCard(hit.card).forEach(io.out);
        }
        return 0;
      }
      case 'deck': {
        if (!checkFlags(flags, ['--no-fetch'], io)) return 2;
        const src = positional[0];
        if (!src) {
          io.err('Usage: deck <file|-> [--format <format>]');
          return 2;
        }
        const format = formatOpt.present ? findFormat(formatOpt.value ?? '') : undefined;
        if (formatOpt.present && !format) {
          io.err(`${formatOpt.value ? `Unknown format "${formatOpt.value}"` : 'Missing format name after --format'}. Formats:\n${formatListLines().join('\n')}`);
          return 2;
        }
        const text = src === '-' ? await io.readStdin() : decodeText(await readFile(src));
        const db = await CardDatabase.open({ log });
        const d = await db.resolveDecklist(text, { fetchMissing: !flags.has('--no-fetch') });
        const section = (title: string, entries: ResolvedEntry[]) => {
          if (!entries.length) return;
          io.out(`${title}: ${totalCount(entries)} cards (${entries.length} distinct)`);
          for (const e of entries) io.out(`  ${e.count} ${e.card.name}`);
        };
        section('Main deck', d.main);
        section('Sideboard', d.sideboard);
        section('Commander', d.commander);
        section('Companion', d.companion);
        if (d.ignoredMaybeboard) io.out(`(ignored ${d.ignoredMaybeboard} maybeboard line(s))`);
        for (const u of d.unknown) {
          if (u.ambiguous) io.err(`Ambiguous face name on line ${u.line}: "${u.name}" (${u.section}) could be ${u.ambiguous.join('; ')}. Use the full card name.`);
          else io.err(`Unknown card on line ${u.line}: "${u.name}" (${u.section})${u.suggestions.length ? `. Did you mean: ${u.suggestions.join(', ')}?` : ''}`);
        }
        for (const e of d.errors) io.err(`Line ${e.line}: ${e.message}: ${e.text.trim()}`);
        if (d.fetchError) io.err(`Could not ask Scryfall: ${d.fetchError}`);
        const report = format ? validateDeck(d, format) : undefined;
        if (report) reportLines(report).forEach((l) => io.out(l));
        return d.unknown.length || d.errors.length || d.fetchError || (report && !report.valid) ? 1 : 0;
      }
      case 'fixtures': {
        if (!checkFlags(flags, [], io)) return 2;
        const db = await CardDatabase.open({ log });
        const dir = defaultFixturesDir();
        const r = await generateFixtures(db, dir);
        for (const w of r.warnings) io.err(`warning: ${w}`);
        for (const p of r.problems) {
          const hint = p.suggestions.length && p.message === 'unknown card name' ? `. Did you mean: ${p.suggestions.join(', ')}?` : '';
          io.err(`${p.file}:${p.line}: "${p.name}": ${p.message}${hint}`);
        }
        if (r.problems.length) {
          io.err(`Fixture NOT written: ${r.problems.length} problem(s).`);
          return 1;
        }
        io.out(`Wrote ${dir}/cards.json from ${r.listFiles.join(', ')}: ${r.fixture.cards.length} cards, ${r.fixture.tokens.length} token variants.`);
        return 0;
      }
      case 'stats': {
        if (!checkFlags(flags, [], io)) return 2;
        const db = await CardDatabase.open({ allowEmpty: true });
        const s = await db.stats();
        io.out(`Cache directory: ${s.cacheDir}${process.env.OPENMTG_CACHE_DIR ? ' (OPENMTG_CACHE_DIR)' : ` (default: ${defaultCacheDir()})`}`);
        if (s.meta) {
          io.out(`Bulk file: ${s.meta.file}, ${(s.meta.size / 1048576).toFixed(1)} MiB (${s.meta.format}), downloaded ${s.meta.downloaded_at}`);
          io.out(`Scryfall updated_at: ${s.meta.updated_at}; source: ${s.meta.source_uri}`);
          if (s.meta.index) {
            const ix = s.meta.index;
            io.out(`Bulk lines: ${ix.lines}; excluded: ${ix.excludedArtSeries} art_series, ${ix.excludedFrontCard ?? 0} front_card, ${ix.excludedFunny} silver-border/acorn${ix.includedUnsanctioned !== undefined ? ` (${ix.includedUnsanctioned} kept as unsanctioned)` : ''}; parse errors: ${ix.parseErrors}`);
            io.out(`Index schema ${ix.schema ?? 1}${ix.schema === INDEX_SCHEMA ? '' : ` (current: ${INDEX_SCHEMA}; the next refresh rebuilds it)`}; flagged unsanctioned (CR 100.7): ${ix.flaggedPlaytest ?? 0} playtest${ix.includedUnsanctioned !== undefined ? `, ${ix.includedUnsanctioned} silver-border/acorn` : ''}; ${ix.unsanctionedVariants ?? 0} indexed as "Name (SET number)" (same-name variants)`);
          }
        } else io.out('No bulk data yet. Run: npm run cards -- refresh');
        io.out(`Index: ${s.cards} cards, ${s.aliases} face aliases (${s.sharedAliases} shared by several cards), ${s.tokenVariants} token/emblem variants (${s.tokenNames} names)`);
        io.out(`One-off lookups cached: ${s.lookups.found} found, ${s.lookups.notFound} not found`);
        return 0;
      }
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        io.out(USAGE);
        return command === undefined ? 2 : 0;
      default:
        io.err(`Unknown command "${command}".\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof CardDatabaseError) io.err(e.message);
    else io.err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
