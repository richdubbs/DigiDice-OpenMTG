/**
 * Generates packages/accounts/src/crypto/blocklist.ts (design 4.3; M14-3): the password blocklist the server checks (`common`, 4.2). Server only;
 * never sent to browsers.
 *
 *   npx tsx packages/accounts/scripts/gen-blocklist.ts                 download the pinned source, check its SHA-256, write the file
 *   npx tsx packages/accounts/scripts/gen-blocklist.ts --from FILE     the same from a local copy of the source (still checked against the pin)
 *   npx tsx packages/accounts/scripts/gen-blocklist.ts --check [...]   exit 1 when the committed file differs from what the source gives
 *
 * The source is pinned to one commit and one SHA-256 (SOURCE below), so the output is a function of that file alone: no clock, no ordering by hash.
 * To move to a newer list, change SOURCE (url, commit, sha256) on purpose, regenerate, and update the blocklist paragraph of the repository's NOTICE.
 *
 * Every line of the source is put in the policy's form (NFKC, lower case: ../src/api/passwords.ts passwordForm), and kept when it passes the text
 * rules and has from ENTRY_MIN to ACCOUNT_LIMITS.passwordMax code points: shorter entries fail on length under any minimum the server accepts
 * (4.3). ENTRY_MIN is the lowest PASSWORD_MIN that src/config.ts accepts (8, design 11.7), not the default of 12: with PASSWORD_MIN set to 8, the
 * most common passwords of 8 to 11 characters ("password1", "iloveyou") must still answer `common`. Entries of FULL_LIST_MIN (12) code points or
 * more are kept from every line of the source; entries of 8 to 11 only from its first SHORT_ENTRY_LINES (100,000) lines, the most common ones (the
 * source is ordered by frequency; the whole million would add some 430,000 entries). The context words of 4.2 (PASSWORD_CONTEXT_WORDS) are added
 * whatever their length. Entries are unique and sorted by UTF-16 code units. CredentialTools refuses a passwordMin below ENTRY_MIN
 * (BLOCKLIST_SOURCE.minLength), so a lower minimum can never run with a blocklist that silently misses its shortest passwords.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACCOUNT_LIMITS } from '../src/api/limits';
import { PASSWORD_CONTEXT_WORDS, passwordForm } from '../src/api/passwords';
import { hostedTextProblem } from '../src/text';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BLOCKLIST_PATH = resolve(HERE, '..', 'src', 'crypto', 'blocklist.ts');

/**
 * The list: the 1,000,000 most common passwords of the xato.net ten-million set (released by xato.net in 2015), as SecLists publishes it (MIT, SecLists'
 * LICENSE), at one commit. Its top 100,000 (the design's example) leave only 486 entries of 12 characters or more, and 37,968 of 8 to 11; the top
 * 1,000,000 leave 46,149 of 12 or more. The two together, with the context words, make 84,117 entries.
 */
export const SOURCE = {
  name: 'SecLists, Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt',
  repository: 'https://github.com/danielmiessler/SecLists',
  commit: '10a38f6cbe8ed6b89d55348756eff7486cd0f0ea',
  path: 'Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt',
  url:
    'https://raw.githubusercontent.com/danielmiessler/SecLists/10a38f6cbe8ed6b89d55348756eff7486cd0f0ea/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt',
  license: 'MIT (SecLists LICENSE, Copyright (c) 2018 Daniel Miessler)',
  sha256: '424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51',
} as const;

/**
 * The shortest entry kept: the lowest PASSWORD_MIN the server's configuration accepts (src/config.ts; design 11.7, "at least 8"). Design 4.3 keeps
 * entries of 12 or more, which covers only the default minimum. test/m14-3/blocklist.test.ts pins this against loadAccountsConfig.
 */
export const ENTRY_MIN = 8;
/** From this many code points (the default PASSWORD_MIN), entries are kept from every line of the source. */
export const FULL_LIST_MIN = ACCOUNT_LIMITS.passwordMin;
/** Entries shorter than FULL_LIST_MIN are kept only from the first this-many lines of the source (its most common passwords). */
export const SHORT_ENTRY_LINES = 100_000;

function codePoints(s: string): number {
  return Array.from(s).length;
}

/** The entries of the blocklist from the source's text: the rules of the header. */
export function blocklistEntries(sourceText: string): string[] {
  const out = new Set<string>();
  const lines = sourceText.split(/\r?\n/u);
  lines.forEach((raw, i) => {
    if (raw === '' || hostedTextProblem(raw) !== null) return;
    const form = passwordForm(raw);
    if (hostedTextProblem(form) !== null) return;
    const n = codePoints(form);
    const least = i < SHORT_ENTRY_LINES ? ENTRY_MIN : FULL_LIST_MIN;
    if (n >= least && n <= ACCOUNT_LIMITS.passwordMax) out.add(form);
  });
  for (const w of PASSWORD_CONTEXT_WORDS) out.add(passwordForm(w));
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The generated module's text. */
export function blocklistModule(entries: readonly string[], source: { sha256: string; lines: number } = { sha256: SOURCE.sha256, lines: 0 }): string {
  const head = [
    '/**',
    ' * GENERATED by packages/accounts/scripts/gen-blocklist.ts: do not edit by hand (design 4.3; M14-3). Server only.',
    ' *',
    ` * Source: ${SOURCE.name}`,
    ` *   ${SOURCE.repository} at commit ${SOURCE.commit}`,
    ` *   SHA-256 ${source.sha256}, ${source.lines} lines`,
    ` * Licence: ${SOURCE.license}; recorded in the repository's NOTICE.`,
    ` * Kept: entries in the policy's form (NFKC, lower case) that pass the text rules, of ${FULL_LIST_MIN} to ${ACCOUNT_LIMITS.passwordMax} code points from`,
    ` * every line, of ${ENTRY_MIN} to ${FULL_LIST_MIN - 1} from the first ${SHORT_ENTRY_LINES} lines; and the context words of 4.2. Unique, sorted by UTF-16`,
    ' * code units. `minLength` is the shortest entry kept: CredentialTools refuses a passwordMin below it.',
    ' */',
    '',
    `export const BLOCKLIST_SOURCE = ${JSON.stringify({ url: SOURCE.url, commit: SOURCE.commit, sha256: source.sha256, license: SOURCE.license, entries: entries.length, minLength: ENTRY_MIN, fullListMinLength: FULL_LIST_MIN, shortEntryLines: SHORT_ENTRY_LINES })} as const;`,
    '',
    '/** The entries in the policy\'s form: CredentialTools.passwordProblem answers `common` for a password whose form is one of them. */',
    'const ENTRIES: readonly string[] = [',
  ];
  const body = entries.map((e) => `  ${JSON.stringify(e)},`);
  return [...head, ...body, '];', '', 'export const BLOCKLIST: ReadonlySet<string> = new Set(ENTRIES);', ''].join('\n');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readSource(from: string | null): Promise<Uint8Array> {
  if (from !== null) return new Uint8Array(readFileSync(from));
  const res = await fetch(SOURCE.url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${SOURCE.url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The module for the source's bytes; refuses bytes that do not match the pin (unless `pin` is false, which prints the hash to pin). */
export function generate(bytes: Uint8Array, pin = true): string {
  const digest = sha256(bytes);
  if (pin && digest !== SOURCE.sha256) throw new Error(`the source's SHA-256 is ${digest}, not the pinned ${SOURCE.sha256}`);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const lines = text.split(/\r?\n/u).filter((l) => l !== '').length;
  return blocklistModule(blocklistEntries(text), { sha256: digest, lines });
}

async function main(argv: string[]): Promise<number> {
  const check = argv.includes('--check');
  const fi = argv.indexOf('--from');
  const from = fi >= 0 ? (argv[fi + 1] ?? null) : null;
  if (fi >= 0 && from === null) throw new Error('--from needs a file');
  const pin = !argv.includes('--unpinned');
  const text = generate(await readSource(from), pin);
  if (check) {
    const now = readFileSync(BLOCKLIST_PATH, 'utf8');
    if (now !== text) {
      console.error(`${BLOCKLIST_PATH} differs from what the source gives: run the generator`);
      return 1;
    }
    console.log('blocklist.ts is up to date');
    return 0;
  }
  writeFileSync(BLOCKLIST_PATH, text, 'utf8');
  console.log(`wrote ${BLOCKLIST_PATH}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}

