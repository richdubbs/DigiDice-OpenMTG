/**
 * Generates packages/accounts/src/names/unicode-data.ts (M14-2, design 6.3): the tables of the canonical name key, from three Unicode data files:
 * CaseFolding.txt of the Unicode Character Database (statuses C and F: full case folding), confusables.txt of UTS #39 (each character to its
 * prototype) and IdentifierStatus.txt of UTS #39 (which characters are in modern use: read only to derive the table below, not shipped), plus two
 * things of OpenMTG's, written into the file's header: the supplement ("i" to "l") and a derived table (`deriveOverrides`). Unicode License v3; the
 * notice is in NOTICE.
 *
 *   npx tsx scripts/gen-unicode-data.ts                       read Unicode 17.0.0 from GitHub (unicode-org/unicodetools) and write the file
 *   npx tsx scripts/gen-unicode-data.ts --source <dir|URL>    read from a local directory, or from another URL base
 *   npx tsx scripts/gen-unicode-data.ts --unicode 18.0.0      another released version (never "dev": a key must not follow a draft)
 *   npx tsx scripts/gen-unicode-data.ts --check               exit 1 when the committed file differs from what the inputs produce
 *
 * Sources. A URL base (default DEFAULT_BASE, the data folder of unicode-org/unicodetools, since www.unicode.org may be out of reach) is read as
 * <base>/ucd/<version>/CaseFolding.txt and <base>/security/<version>/{confusables,IdentifierStatus}.txt. A local directory may have that layout, or
 * hold the three files directly. Each file's header must name the version asked for; the header of the generated file records each file's date and
 * SHA-256.
 *
 * The derived table (INTERFACE CHANGE: a refinement of 6.3, review of M14-2). Each entry replaces its character's case folding and prototype
 * (src/names/table.ts, applyOverrides), so the key's steps stay those of 6.3. It makes two repairs:
 *  - Letters (and marks) of a script other than Common, Inherited and Latin whose prototype is only separators keep themselves: Hebrew yod looks
 *    like an apostrophe, but it is a letter, and a key that drops it makes "שירה" and "שרה" one name. The Common and Latin apostrophe look-alikes
 *    (ʼ ʻ ˈ ꞌ ...) keep their prototype: they are apostrophes, dropped like the typed one.
 *  - The closure of case and look-alike. 6.3 folds before it maps, so a capital's own prototype is never read: "М" (Cyrillic) is folded to "м",
 *    whose prototype is "ʍ", while it looks like "M"; "Мах" and "Max" were two names. `deriveOverrides` joins every character to its case folding and
 *    its prototype (union-find over the links below, strongest first) and maps each class to one key, "Мах" = "Max". A link is not followed when it
 *    would make two different fixed keys one (basic Latin letters, digits and separators, and the targets of more than one character), or two
 *    letters of one script that IdentifierStatus.txt allows and the plain tables tell apart (so "в" and "ь", or "е" and "є", stay two letters), or
 *    two classes in use through a letter out of use; a look-alike between a capital and a non-basic capital ("Σ" to "Ʃ") is followed only when one
 *    side has no small letter yet. Where a capital and its small letter look like two different basic letters (Greek "Η" and "η"), or the capital's
 *    look-alike would join two letters of one script (Cyrillic "Н" would meet "һ"), the capital keeps its small letter's key; the word filter reads
 *    those capitals through the skeleton key (src/names/key.ts, skeletonKey). The links not followed are listed in the header.
 * The derivation reads letters, marks, scripts and normalization from the JavaScript engine that runs it, as the server's key does: run the
 * generator on the Node the server runs.
 *
 * Checks before anything is written: every source is one code point; every entry of the tables (and its NFKC form) settles within
 * KEY_ROUNDS_CHECKED rounds of the key, run by the server's own code (packages/accounts/src/names/key.ts); the key of every entry is a fixed point
 * (key(key(x)) = key(x)); every link the closure follows joins two characters of one key; no basic Latin character changes its key; and no two
 * letters of one script that IdentifierStatus.txt allows and the plain tables tell apart share a key.
 *
 * Versions. NAME_DATA_VERSION goes up by one whenever the tables (or the Unicode version) differ from the committed file's; the committed data then
 * moves to unicode-data-prev.ts, which a release keeps beside the new data while the operator runs `openmtg-accounts admin rekey` (6.3). When nothing
 * differs, nothing is rewritten and the version stays: stored keys need no rekey for a regeneration that changes no key.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACCOUNT_NAME_SEPARATORS, UNICODE_SCRIPTS } from '../packages/accounts/src/api/names';
import { canonicalKey, KEY_ROUNDS_CHECKED, settle, type KeyTables } from '../packages/accounts/src/names/key';
import { applyOverrides, encodeNameTable, keyTablesOf, type GeneratedNameData } from '../packages/accounts/src/names/table';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
export const NAMES_DIR = join(REPO, 'packages/accounts/src/names');
export const DATA_PATH = join(NAMES_DIR, 'unicode-data.ts');
export const PREV_PATH = join(NAMES_DIR, 'unicode-data-prev.ts');
export const DEFAULT_BASE = 'https://raw.githubusercontent.com/unicode-org/unicodetools/main/unicodetools/data';
export const DEFAULT_UNICODE = '17.0.0';
/** OpenMTG's supplement (6.3 step 2.6), applied last in every round. */
export const SUPPLEMENT: readonly (readonly [string, string])[] = [['i', 'l']];

type InputFile = 'CaseFolding.txt' | 'confusables.txt' | 'IdentifierStatus.txt';

/** A file's text and where it was read (for messages). */
export interface Source { text: string; where: string }

async function readSource(base: string, version: string, file: InputFile): Promise<Source> {
  const folder = file === 'CaseFolding.txt' ? 'ucd' : 'security';
  if (/^https?:\/\//.test(base)) {
    const url = `${base.replace(/\/+$/, '')}/${folder}/${version}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return { text: await res.text(), where: url };
  }
  for (const p of [join(base, folder, version, file), join(base, file)]) {
    if (existsSync(p)) return { text: readFileSync(p, 'utf8'), where: p };
  }
  throw new Error(`${file} not found in ${base} (as ${folder}/${version}/${file} or ${file})`);
}

/** The header's date ("# Date: 2025-07-22, 05:49:37 GMT"), and a check that the header names `version`. */
export function header(src: Source, version: string, file: InputFile): string {
  const head = src.text.split('\n').slice(0, 30).join('\n');
  const named = file === 'CaseFolding.txt' ? head.includes(`CaseFolding-${version}.txt`) : new RegExp(`^# Version: ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(head);
  if (!named) throw new Error(`${src.where}: the header does not name Unicode ${version}`);
  const date = /^# Date: (\d{4}-\d{2}-\d{2})/m.exec(head);
  if (!date) throw new Error(`${src.where}: no date in the header`);
  return date[1]!;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const cps = (field: string): number[] => field.trim().split(/\s+/).map((h) => {
  if (!/^[0-9A-Fa-f]{4,6}$/.test(h)) throw new Error(`not a code point: ${JSON.stringify(h)}`);
  return parseInt(h, 16);
});

/** CaseFolding.txt: "<code>; <status>; <mapping>; # <name>", statuses C (common) and F (full) only. */
export function parseCaseFolding(text: string): [string, string][] {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const body = line.replace(/#.*/, '').trim();
    if (body === '') continue;
    const [code, status, mapping] = body.split(';').map((f) => f.trim());
    if (code === undefined || status === undefined || mapping === undefined) throw new Error(`CaseFolding.txt: a malformed line: ${line}`);
    if (status !== 'C' && status !== 'F') continue;
    const source = String.fromCodePoint(...cps(code));
    if (out.has(source)) throw new Error(`CaseFolding.txt: two C/F mappings for ${code}`);
    out.set(source, String.fromCodePoint(...cps(mapping)));
  }
  return [...out];
}

/** confusables.txt: "<source> ; <target> ; MA # ...". Every source must be one code point. */
export function parseConfusables(text: string): [string, string][] {
  const out = new Map<string, string>();
  for (const line of text.replace(/^﻿/, '').split('\n')) {
    const body = line.replace(/#.*/, '').trim();
    if (body === '') continue;
    const [source, target] = body.split(';').map((f) => f.trim());
    if (source === undefined || target === undefined) throw new Error(`confusables.txt: a malformed line: ${line}`);
    const s = cps(source);
    if (s.length !== 1) throw new Error(`confusables.txt: a source of ${s.length} code points: ${source}`);
    const key = String.fromCodePoint(s[0]!);
    if (out.has(key)) throw new Error(`confusables.txt: two prototypes for ${source}`);
    out.set(key, String.fromCodePoint(...cps(target)));
  }
  return [...out];
}

/** IdentifierStatus.txt: "<code>[..<code>] ; Allowed # ...": the code points whose Identifier_Status is Allowed (every other one is Restricted). */
export function parseIdentifierStatus(text: string): Set<number> {
  const out = new Set<number>();
  for (const line of text.replace(/^﻿/, '').split('\n')) {
    const body = line.replace(/#.*/, '').trim();
    if (body === '') continue;
    const m = /^([0-9A-Fa-f]{4,6})(?:\.\.([0-9A-Fa-f]{4,6}))?\s*;\s*(\w+)$/.exec(body);
    if (!m) throw new Error(`IdentifierStatus.txt: a malformed line: ${line}`);
    if (m[3] !== 'Allowed') throw new Error(`IdentifierStatus.txt: an unknown status ${m[3]}: ${line}`);
    const from = parseInt(m[1]!, 16);
    const to = m[2] === undefined ? from : parseInt(m[2], 16);
    if (to < from || to > 0x10ffff) throw new Error(`IdentifierStatus.txt: a bad range: ${line}`);
    for (let cp = from; cp <= to; cp++) out.add(cp);
  }
  return out;
}

/** A string literal in the repository's style (single quotes). */
const q = (s: string): string => `'${JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
const u = (s: string): string => Array.from(s, (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

// ---- the derived table ---------------------------------------------------------------------------------------------------------------------

const LETTER = /^\p{L}$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const MARKS = /\p{M}/gu;
const COMMON_INHERITED_LATIN = /^[\p{Script=Zyyy}\p{Script=Zinh}\p{Script=Latn}]$/u;
const SEPARATOR_SET: ReadonlySet<string> = new Set(Array.from(ACCOUNT_NAME_SEPARATORS));
const BASIC_CAPITAL_OR_DIGIT = /^[A-Z0-9]$/;
const isBasic = (s: string): boolean => /^[\x20-\x7e]+$/.test(s);
const single = (s: string): boolean => s.length > 0 && String.fromCodePoint(s.codePointAt(0)!) === s;

let scriptTests: [string, RegExp][] | null = null;
const scriptCache = new Map<string, string>();
/** The Script property of a character as the running engine knows it ("Zzzz" when it knows none). */
function scriptOf(ch: string): string {
  const hit = scriptCache.get(ch);
  if (hit !== undefined) return hit;
  if (scriptTests === null) {
    scriptTests = [];
    for (const s of ['Zyyy', 'Zinh', ...UNICODE_SCRIPTS]) {
      try {
        scriptTests.push([s, new RegExp(`^\\p{Script=${s}}$`, 'u')]);
      } catch {
        // a script newer than this engine
      }
    }
  }
  const found = scriptTests.find(([, re]) => re.test(ch))?.[0] ?? 'Zzzz';
  scriptCache.set(ch, found);
  return found;
}

/**
 * The links of the closure, strongest first: a character to its case folding or its prototype, as one character after NFKD, or as a fixed key (a
 * target of more than one character, "ß" to "ss", "m" to "rn"):
 *   fold         the case folding of basic Latin, the supplement, and every folding of more than one character (a round applies them first)
 *   case         a capital and its small letter (a folding to the character's own upper or lower case)
 *   look         the prototype of a character without a case folding (one the plain key already follows), basic Latin once its marks are dropped
 *   capital      the prototype of a capital that is one basic Latin capital or digit ("М" to "M"): what folding first loses
 *   look2        the prototype of a character without a case folding, any other target
 *   variant      the prototype of a letter whose folding is not its case partner ("ſ" to "f")
 *   variantFold  that folding ("ſ" to "s")
 *   other        any other prototype ("Σ" to "Ʃ")
 * A link is not followed when it would join two classes with different fixed keys ('key'), allowed small letters of one script with different
 * plain keys ('script'), two classes that each hold an allowed letter through a letter out of use ('bridge'), or, for 'other', two classes that
 * each hold a small (unfolded) letter ('small'). Within a kind, links from letters in use go first, then by code point.
 */
export const LINK_KINDS = ['fold', 'case', 'look', 'capital', 'look2', 'variant', 'variantFold', 'other'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** A link of the closure: `from` to the character `to`, or to the fixed key of the string `exit`. */
interface Link { from: string; to: string | null; exit: string | null; kind: LinkKind }

/** What `deriveOverrides` found. */
export interface Derivation {
  /** The derived table's entries, sorted by source. */
  overrides: [string, string][];
  /** The letters and marks that keep themselves (the first repair). */
  kept: string[];
  /** The links not followed, and why. */
  refused: { from: string; to: string; kind: LinkKind; why: 'key' | 'script' | 'bridge' | 'small' }[];
  /** Problems found by the final checks (empty when the table is usable). */
  problems: string[];
}

/**
 * The derived table (see the file's header). `allowed` holds the code points that IdentifierStatus.txt allows. Iterates until the entries settle:
 * the fixed keys of the targets of several characters ("ƅl" for "ы") depend on the entries themselves.
 */
export function deriveOverrides(
  caseFolding: readonly (readonly [string, string])[], confusables: readonly (readonly [string, string])[],
  supplement: readonly (readonly [string, string])[], allowed: ReadonlySet<number>,
): Derivation {
  const byCp = (xs: readonly (readonly [string, string])[]) => new Map(xs.map(([s, t]) => [s.codePointAt(0)!, t]));
  const F = byCp(caseFolding);
  const P = byCp(confusables);
  const S = byCp(supplement);

  // The first repair: letters and marks of other scripts never vanish from a key. Their prototypes are no links of the closure; a small (unfolded)
  // one keeps itself (a capital is folded to its small letter first).
  const vanishing = new Set<number>();
  const kept = new Map<number, string>();
  for (const [cp, target] of P) {
    const c = String.fromCodePoint(cp);
    if (!LETTER_OR_MARK.test(c) || COMMON_INHERITED_LATIN.test(c) || !Array.from(target).every((x) => SEPARATOR_SET.has(x))) continue;
    vanishing.add(cp);
    if (!F.has(cp)) kept.set(cp, c);
  }
  const plain = applyOverrides(F, P, S, kept);
  const plainKey = (s: string): string => canonicalKey(plain, s);

  // The nodes are letters and basic Latin characters as the round meets them (NFKD), and one node per target of several characters.
  const node = (c: string): boolean => single(c) && c.normalize('NFKD') === c && (LETTER.test(c) || isBasic(c));
  const small = (c: string): boolean => LETTER.test(c) && !F.has(c.codePointAt(0)!);
  const caseOf = (c: string, d: string): boolean => d !== c && (d.toUpperCase() === c || d.toLowerCase() === c);
  const links: Link[] = [];
  // A target that is no node (a mark, a symbol) is a fixed key, like a target of several characters.
  const link = (from: string, target: string, kind: LinkKind): void => {
    const d = target.normalize('NFKD');
    if (single(d) && node(d)) links.push({ from, to: d, exit: null, kind });
    else if (d !== '') links.push({ from, to: null, exit: d, kind });
  };
  for (const [cp, f] of F) {
    const c = String.fromCodePoint(cp);
    if (!node(c)) continue;
    const d = f.normalize('NFKD');
    link(c, f, cp < 0x80 || !single(d) ? 'fold' : caseOf(c, d) ? 'case' : 'variantFold');
  }
  for (const [s, t] of supplement) link(s, t, 'fold');
  for (const [cp, p] of P) {
    const c = String.fromCodePoint(cp);
    if (!node(c) || vanishing.has(cp)) continue;
    const d = p.normalize('NFKD');
    const f = F.get(cp)?.normalize('NFKD');
    let kind: LinkKind;
    if (f === undefined) kind = isBasic(d.replace(MARKS, '')) ? 'look' : 'look2';
    else if (!single(f)) kind = 'other';
    else if (!caseOf(c, f)) kind = 'variant';
    else kind = BASIC_CAPITAL_OR_DIGIT.test(d) ? 'capital' : 'other';
    link(c, p, kind);
  }
  // Strongest kind first; within a kind, letters in modern use (Allowed) before the others, then by code point.
  const rank = new Map(LINK_KINDS.map((k, i) => [k, i]));
  const order = (l: Link): [number, number, number] => [rank.get(l.kind)!, allowed.has(l.from.codePointAt(0)!) ? 0 : 1, l.from.codePointAt(0)!];
  const ordered = links.map((l, i) => ({ l, i, o: order(l) }))
    .sort((a, b) => a.o[0] - b.o[0] || a.o[1] - b.o[1] || a.o[2] - b.o[2] || a.i - b.i).map((x) => x.l);
  const chars = new Set<string>();
  for (const l of links) {
    chars.add(l.from);
    if (l.to !== null) chars.add(l.to);
  }

  let overrides = new Map<number, string>(kept);
  let refused: Derivation['refused'] = [];
  const exitNode = (s: string): string => `\u0000${s}`;
  for (let iteration = 0; ; iteration++) {
    if (iteration === 10) throw new Error('the derived table does not settle in 10 iterations');
    const tables = applyOverrides(F, P, S, overrides);
    const key = (s: string): string => canonicalKey(tables, s);
    // Union-find over the nodes; a class knows its fixed key (if any), its allowed small letters by script, and whether it holds a small letter.
    interface Cls { fixed: string | null; scripts: Map<string, string>; small: boolean }
    const parent = new Map<string, string>();
    const cls = new Map<string, Cls>();
    const find = (x: string): string => {
      let r = x;
      while (parent.has(r)) r = parent.get(r)!;
      for (let y = x; y !== r;) {
        const next = parent.get(y)!;
        parent.set(y, r);
        y = next;
      }
      return r;
    };
    // A target of several characters joins the node of its key: one per key, and the character's own node when the key is one character. Its key
    // is fixed when it is basic Latin, longer than one character or no node (one letter of another script may still join a class: "ĸ" for "қ"). It
    // counts as a small letter (it stands for the small letters it keys to), so a look-alike between capitals never drags it in.
    const classOf = (n: string): Cls => {
      let c = cls.get(n);
      if (c === undefined) {
        const isExit = n.startsWith('\u0000');
        const ch = isExit ? '' : n;
        const scripts = new Map<string, string>();
        if (!isExit && small(ch) && allowed.has(ch.codePointAt(0)!)) scripts.set(scriptOf(ch), plainKey(ch));
        const fixedExit = isExit && (isBasic(n.slice(1)) || !single(n.slice(1)) || !chars.has(n.slice(1)));
        c = { fixed: fixedExit ? n.slice(1) : isBasic(ch) ? key(ch) : null, scripts, small: isExit || small(ch) };
        cls.set(n, c);
      }
      return c;
    };
    const exitKeys = new Map<string, string>();
    for (const l of links) if (l.exit !== null && !exitKeys.has(l.exit)) exitKeys.set(l.exit, key(l.exit));
    for (const k of new Set(exitKeys.values())) {
      if (!chars.has(k)) continue;
      const rk = find(k);
      const ck = classOf(rk);
      if (ck.fixed !== null && ck.fixed !== k) continue;
      parent.set(rk, exitNode(k));
      cls.set(exitNode(k), { fixed: ck.fixed, scripts: ck.scripts, small: true });
      cls.delete(rk);
    }
    refused = [];
    for (const l of ordered) {
      const a = l.from;
      const b = l.to ?? exitNode(exitKeys.get(l.exit!)!);
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) continue;
      const ca = classOf(ra);
      const cb = classOf(rb);
      let why: Derivation['refused'][number]['why'] | null = null;
      if (ca.fixed !== null && cb.fixed !== null && ca.fixed !== cb.fixed) why = 'key';
      else if ([...ca.scripts].some(([s, k]) => cb.scripts.has(s) && cb.scripts.get(s) !== k)) why = 'script';
      else if (!allowed.has(a.codePointAt(0)!) && ca.scripts.size > 0 && cb.scripts.size > 0) why = 'bridge';
      else if (l.kind === 'other' && ca.small && cb.small) why = 'small';
      if (why !== null) {
        refused.push({ from: a, to: l.to ?? l.exit!, kind: l.kind, why });
        continue;
      }
      parent.set(ra, rb);
      const scripts = new Map([...ca.scripts, ...cb.scripts]);
      cls.set(rb, { fixed: cb.fixed ?? ca.fixed, scripts, small: ca.small || cb.small });
      cls.delete(ra);
    }
    // Each class's key: its fixed key; else one of its own letters, so the key is the class's and a fixed point: the one most of its letters have as
    // their plain key, else its first small letter, else its first letter (by code point).
    const members = new Map<string, string[]>();
    for (const c of chars) {
      const r = find(c);
      const list = members.get(r);
      if (list === undefined) members.set(r, [c]);
      else list.push(c);
    }
    const next = new Map(overrides);
    let changed = false;
    for (const [r, list] of members) {
      let target = classOf(r).fixed;
      if (target === null) {
        const own = new Set(list);
        const letters = list.filter((c) => LETTER.test(c)).sort((x, y) => x.codePointAt(0)! - y.codePointAt(0)!);
        const votes = new Map<string, number>();
        for (const c of letters) if (own.has(plainKey(c))) votes.set(plainKey(c), (votes.get(plainKey(c)) ?? 0) + 1);
        const smallFirst = (x: string): number => (small(x) ? 0 : 1);
        const best = [...votes].sort((x, y) => y[1] - x[1] || smallFirst(x[0]) - smallFirst(y[0]) || x[0].codePointAt(0)! - y[0].codePointAt(0)!)[0]?.[0];
        target = best ?? letters.find(small) ?? letters[0] ?? null;
      }
      if (target === null || target === '') continue;
      for (const c of list) {
        if (!LETTER.test(c) || isBasic(c) || key(c) === target) continue;
        if (next.get(c.codePointAt(0)!) !== target) {
          next.set(c.codePointAt(0)!, target);
          changed = true;
        }
      }
    }
    if (!changed) break;
    overrides = next;
  }

  // The final checks, on the tables as they will ship.
  const tables = applyOverrides(F, P, S, overrides);
  const key = (s: string): string => canonicalKey(tables, s);
  const problems: string[] = [];
  const refusedSet = new Set(refused.map((r) => `${r.from}\u0001${r.to}`));
  for (const l of links) {
    if (refusedSet.has(`${l.from}\u0001${l.to ?? l.exit}`)) continue;
    const want = key(l.to ?? l.exit!);
    if (key(l.from) !== want) problems.push(`${u(l.from)} keys to ${u(key(l.from))} but its ${l.kind} link to ${u(l.to ?? l.exit!)} to ${u(want)}`);
  }
  for (let cp = 0x20; cp < 0x7f; cp++) {
    const c = String.fromCharCode(cp);
    if (key(c) !== plainKey(c)) problems.push(`${u(c)} changed its key, ${u(plainKey(c))} to ${u(key(c))}`);
  }
  const seen = new Map<string, [string, string]>();
  for (const cp of allowed) {
    const c = String.fromCodePoint(cp);
    if (!LETTER.test(c)) continue;
    const at = `${scriptOf(c)}\u0001${key(c)}`;
    const was = seen.get(at);
    if (was === undefined) seen.set(at, [c, plainKey(c)]);
    else if (was[1] !== plainKey(c)) problems.push(`${u(was[0])} and ${u(c)} (${scriptOf(c)}) now share the key ${u(key(c))}`);
  }
  const overridesOut = [...overrides].sort((a, b) => a[0] - b[0]).map(([cp, t]): [string, string] => [String.fromCodePoint(cp), t]);
  return { overrides: overridesOut, kept: [...kept.values()], refused, problems };
}

/** The settle and fixed-point checks over every entry; the problems found (empty when the tables are usable). */
export function checkTables(t: KeyTables): string[] {
  const problems: string[] = [];
  const sources = new Set<number>([...t.caseFolding.keys(), ...t.confusables.keys(), ...t.supplement.keys()]);
  for (const cp of sources) {
    const ch = String.fromCodePoint(cp);
    for (const x of new Set([ch, ch.normalize('NFKC')])) {
      const { rounds } = settle(t, x);
      if (rounds > KEY_ROUNDS_CHECKED) problems.push(`${u(x)} settles only after ${rounds} rounds`);
    }
    const k = canonicalKey(t, ch);
    const kk = canonicalKey(t, k);
    if (k !== kk) problems.push(`${u(ch)}: key ${u(k)} has the key ${u(kk)}`);
  }
  return problems;
}

/** The SHA-256 of the tables of `g` (supplement, derived table, case folding, prototypes, each followed by a newline): TABLES_SHA256. */
export function tablesSha256(g: GeneratedNameData): string {
  return sha256(`${g.supplement}\n${g.overrides ?? ''}\n${g.caseFolding}\n${g.confusables}\n`);
}

/** Text wrapped at `width` characters (code points), at spaces. */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/ +/)) {
    if (line !== '' && Array.from(`${line} ${word}`).length > width) {
      out.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') out.push(line);
  return out;
}
/** Comment text wrapped at about 140 columns, each line starting " * ". */
const wrap = (text: string): string[] => wrapText(text, 140).map((l) => ` * ${l}`);
/** A template literal's body: the characters a template would read escaped. */
const templateBody = (s: string): string => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/** The module text of ./unicode-data.ts or ./unicode-data-prev.ts. */
export function renderModule(kind: 'current' | 'previous', g: GeneratedNameData | null): string {
  const lines: string[] = [];
  const supplement = SUPPLEMENT.map(([a, b]) => `"${a}" (${u(a)}) to "${b}" (${u(b)})`).join(', ');
  lines.push('/**');
  lines.push(' * GENERATED by scripts/gen-unicode-data.ts: do not edit (design 6.3). Regenerate with `npx tsx scripts/gen-unicode-data.ts`.');
  if (kind === 'previous') {
    lines.push(' *');
    lines.push(' * The name data before the current one (./unicode-data.ts), kept for one release so keys stored under it still resolve while the operator');
    lines.push(' * runs `openmtg-accounts admin rekey`; null when there is none.');
  }
  if (g !== null) {
    const overrides = (g.overrides ?? '') === '' ? 0 : (g.overrides ?? '').split('\n').length;
    lines.push(' *');
    lines.push(...wrap(`Unicode ${g.unicodeVersion}, from ${g.sources}.`));
    lines.push(' * CaseFolding.txt gives full case folding (statuses C and F), confusables.txt (UTS #39) each character\'s prototype. Unicode data,');
    lines.push(' * (c) Unicode, Inc., under the Unicode License v3 (see NOTICE).');
    lines.push(` * NAME_DATA_VERSION ${g.version}: goes up whenever the tables change; every stored key records the version that made it (keyVersion).`);
    lines.push(' *');
    lines.push(` * OpenMTG supplement (not Unicode data), applied last in every round: ${supplement}. confusables.txt maps capital "I" to "l" but`);
    lines.push(' * leaves small "i" alone, so without it "ALICE" (key "allce") and "alice" (key "alice") would be different names.');
    lines.push(' *');
    lines.push(...wrap(`OpenMTG's derived table (not Unicode data), ${overrides} entries, each replacing its character's case folding and prototype ` +
      '(src/names/table.ts, applyOverrides; scripts/gen-unicode-data.ts, deriveOverrides, says how it is made).'));
    for (const line of (g.notes ?? '').split('\n')) if (line !== '') lines.push(` * ${line}`);
    lines.push(' *');
    lines.push(' * TABLES_SHA256, the SHA-256 of the four tables (supplement, overrides, caseFolding, confusables, each followed by a newline), so a hand');
    lines.push(` * edit of a table shows: ${tablesSha256(g)}.`);
    lines.push(' *');
    lines.push(' * Tables: one entry per line, the source code point, ">", the target code points, in lowercase hex (src/names/table.ts).');
  }
  lines.push(' */');
  lines.push("import type { GeneratedNameData } from './table';");
  lines.push('');
  const body = (x: GeneratedNameData, named: boolean): string[] => [
    named ? '  version: NAME_DATA_VERSION,' : `  version: ${x.version},`,
    named ? '  unicodeVersion: UNICODE_VERSION,' : `  unicodeVersion: ${q(x.unicodeVersion)},`,
    `  sources: ${q(x.sources)},`,
    ...(x.notes === undefined ? [] : [`  notes: \`${templateBody(x.notes)}\`,`]),
    `  supplement: \`${x.supplement}\`,`,
    ...(x.overrides === undefined ? [] : [`  overrides: \`${x.overrides}\`,`]),
    `  caseFolding: \`${x.caseFolding}\`,`,
    `  confusables: \`${x.confusables}\`,`,
  ];
  if (kind === 'current') {
    if (g === null) throw new Error('the current data cannot be null');
    lines.push(`export const NAME_DATA_VERSION = ${g.version};`);
    lines.push(`export const UNICODE_VERSION = ${q(g.unicodeVersion)};`);
    lines.push(`export const TABLES_SHA256 = '${tablesSha256(g)}';`);
    lines.push('');
    lines.push('export const UNICODE_DATA: GeneratedNameData = {');
    lines.push(...body(g, true));
    lines.push('};');
  } else if (g === null) {
    lines.push('export const PREVIOUS_UNICODE_DATA: GeneratedNameData | null = null;');
  } else {
    lines.push('export const PREVIOUS_UNICODE_DATA: GeneratedNameData | null = {');
    lines.push(...body(g, false));
    lines.push('};');
  }
  return `${lines.join('\n')}\n`;
}

/** The three files' texts, already read. */
export interface UnicodeInputs { caseFolding: Source; confusables: Source; identifierStatus: Source }

/** The derivation's account for the header: what was kept, and the links not followed. */
function derivationNotes(d: Derivation): string {
  const kept = [...d.kept].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).map((c) => `${c} ${u(c)}`).join(', ');
  const kinds = new Map<string, string[]>();
  for (const r of d.refused) {
    const why = { key: 'two keys', script: 'two letters of one script', bridge: 'a letter out of use between two in use', small: 'two small letters' };
    const at = `${r.kind}, ${why[r.why]}`;
    const list = kinds.get(at) ?? [];
    list.push(`${r.from} ${u(r.from)} to ${r.to.length === 1 ? `${r.to} ${u(r.to)}` : `"${r.to}"`}`);
    kinds.set(at, list);
  }
  const parts = [...kinds].map(([at, list]) => `${at} (${list.length}): ${list.join('; ')}.`);
  return [
    ...wrapText(`Kept as themselves (letters and marks of other scripts whose prototype is only separators): ${kept === '' ? 'none' : kept}.`, 140),
    ...wrapText(`Links of the closure not followed (${d.refused.length}), by link and reason: ${parts.length === 0 ? 'none.' : parts.join(' ')}`, 140),
  ].join('\n');
}

/**
 * The tables of `version` from the three files: their headers checked (version and date), parsed, the derived table made, encoded, and checked
 * (`checkTables`, and the derivation's own checks). Throws with every problem when the tables are unusable.
 */
export function buildNameData(inputs: UnicodeInputs, version: string): Omit<GeneratedNameData, 'version'> {
  const foldDate = header(inputs.caseFolding, version, 'CaseFolding.txt');
  const confDate = header(inputs.confusables, version, 'confusables.txt');
  const statusDate = header(inputs.identifierStatus, version, 'IdentifierStatus.txt');
  const caseFolding = parseCaseFolding(inputs.caseFolding.text);
  const confusables = parseConfusables(inputs.confusables.text);
  const allowed = parseIdentifierStatus(inputs.identifierStatus.text);
  const derivation = deriveOverrides(caseFolding, confusables, SUPPLEMENT, allowed);
  const fresh: Omit<GeneratedNameData, 'version'> = {
    unicodeVersion: version,
    sources: `CaseFolding-${version}.txt (${foldDate}, ${caseFolding.length} entries, SHA-256 ${sha256(inputs.caseFolding.text)}), ` +
      `confusables.txt (Version ${version}, ${confDate}, ${confusables.length} entries, SHA-256 ${sha256(inputs.confusables.text)}) and ` +
      `IdentifierStatus.txt (Version ${version}, ${statusDate}, ${allowed.size} Allowed code points, SHA-256 ${sha256(inputs.identifierStatus.text)})`,
    notes: derivationNotes(derivation),
    supplement: encodeNameTable(SUPPLEMENT),
    overrides: encodeNameTable(derivation.overrides),
    caseFolding: encodeNameTable(caseFolding),
    confusables: encodeNameTable(confusables),
  };
  const problems = [...derivation.problems, ...checkTables(keyTablesOf({ ...fresh, version: 1 }))];
  if (problems.length > 0) {
    throw new Error(`The tables do not settle or fail a check (${problems.length} problems); nothing written:\n  ${problems.slice(0, 50).join('\n  ')}`);
  }
  return fresh;
}

const sameTables = (a: GeneratedNameData, b: Omit<GeneratedNameData, 'version'>): boolean =>
  a.unicodeVersion === b.unicodeVersion && a.supplement === b.supplement && (a.overrides ?? '') === (b.overrides ?? '') &&
  a.caseFolding === b.caseFolding && a.confusables === b.confusables;

/** What a run writes, given the committed data (null: none yet) and the fresh tables. */
export interface NameDataPlan {
  next: GeneratedNameData;
  /** The text of unicode-data.ts. */
  current: string;
  /** The text of unicode-data-prev.ts: the committed data when the tables changed; null data when there was none; undefined: leave the file. */
  previous: string | undefined;
  /** The tables (and Unicode version) are those of the committed data. */
  unchanged: boolean;
}

/** Version 1 for a first run; the committed version when nothing differs; else one more, the committed data moving to unicode-data-prev.ts. */
export function planNameData(old: GeneratedNameData | null, fresh: Omit<GeneratedNameData, 'version'>): NameDataPlan {
  const unchanged = old !== null && sameTables(old, fresh);
  const next: GeneratedNameData = { ...fresh, version: old === null ? 1 : unchanged ? old.version : old.version + 1 };
  const previous = old === null ? renderModule('previous', null) : unchanged ? undefined : renderModule('previous', old);
  return { next, current: renderModule('current', next), previous, unchanged };
}

/** The committed current data, or null when there is no file yet. */
async function committed(): Promise<GeneratedNameData | null> {
  if (!existsSync(DATA_PATH)) return null;
  const mod = (await import(pathToFileURL(DATA_PATH).href)) as { UNICODE_DATA?: GeneratedNameData };
  return mod.UNICODE_DATA ?? null;
}

async function main(argv: string[]): Promise<number> {
  let base = DEFAULT_BASE;
  let version = DEFAULT_UNICODE;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--source') base = argv[++i] ?? '';
    else if (a === '--unicode') version = argv[++i] ?? '';
    else if (a === '--check') check = true;
    else {
      console.error(`unknown argument: ${a}\nusage: npx tsx scripts/gen-unicode-data.ts [--source <dir|URL base>] [--unicode <version>] [--check]`);
      return 2;
    }
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`--unicode needs a released version such as ${DEFAULT_UNICODE}, not ${JSON.stringify(version)}`);
    return 2;
  }
  if (base === '') {
    console.error('--source needs a directory or a URL base');
    return 2;
  }
  if (!/^https?:\/\//.test(base)) base = resolve(base);

  const inputs: UnicodeInputs = {
    caseFolding: await readSource(base, version, 'CaseFolding.txt'),
    confusables: await readSource(base, version, 'confusables.txt'),
    identifierStatus: await readSource(base, version, 'IdentifierStatus.txt'),
  };
  const fresh = buildNameData(inputs, version);
  const old = await committed();
  const plan = planNameData(old, fresh);
  const { next } = plan;
  if (check) {
    const ok = existsSync(DATA_PATH) && readFileSync(DATA_PATH, 'utf8') === plan.current;
    const engine = process.versions.unicode ?? '?';
    console.log(ok ? `unicode-data.ts is up to date (NAME_DATA_VERSION ${next.version}, Unicode ${version})`
      : `unicode-data.ts differs from what the inputs produce (the derived table reads letters and scripts from this engine's Unicode ${engine})`);
    return ok ? 0 : 1;
  }
  if (plan.unchanged && readFileSync(DATA_PATH, 'utf8') === plan.current) {
    console.log(`Unchanged: NAME_DATA_VERSION ${next.version}, Unicode ${version}.`);
    return 0;
  }
  if (plan.previous !== undefined && (old !== null || !existsSync(PREV_PATH))) writeFileSync(PREV_PATH, plan.previous);
  writeFileSync(DATA_PATH, plan.current);
  console.log(`Wrote ${DATA_PATH}: NAME_DATA_VERSION ${next.version}, Unicode ${version}` +
    `${old !== null && !plan.unchanged ? `; version ${old.version} moved to unicode-data-prev.ts` : ''}.`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
