/**
 * M13-8: the word filter on names and table titles (design 4.2, 11) and the hosted text rules in front of it: fixed lists of bad and good input (no
 * randomized fuzzing), the list file's format, a refusal that never names the word, and names and titles through the real gateway.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLOSE_PROTOCOL } from '../../src/api';
import { moderationFromFile, NAME_REFUSED, TITLE_REFUSED, WORDS_FILE_MAX_BYTES, WordModeration } from '../../src/moderation';
import { Browser, createTable, freshPeer, guest } from '../m13-6/harness';
import { lobbyGateway } from './helpers';

const builtIn = new WordModeration();

/** Titles the built-in list refuses, by how they hide the word. */
const REFUSED_TITLES: readonly [string, string][] = [
  ['plain', 'Fuck this'],
  ['capitals', 'FUCK THIS'],
  ['inside a word', 'Mindfucker deck'],
  ['accents', 'Fücking good time'],
  ['full stops between letters', 'f.u.c.k club'],
  ['hyphens', 'f-u-c-k'],
  ['underscores', 'f_u_c_k'],
  ['spaces', 'f u c k'],
  ['commas', 'f,u,c,k'],
  ['slashes', 'f/u/c/k'],
  ['semicolons', 'f;u;c;k'],
  ['full-width letters', 'ＦＵＣＫ'],
  ['a Cyrillic letter in place of a Latin one', 'fuсk'],
  ['Cyrillic capitals', 'ЅНІТ'],
  ['a one in place of an i', 'b1tch'],
  ['an exclamation mark for an i', 'b!tch'],
  ['a seven for a t', 'bi7ch'],
  ['a dollar sign for an s', '$hithead'],
  ['an at sign for an a', 'f@ggot'],
  ['a zero for an o', 'wh0re'],
  ['a one in a longer word', 'bullsh1t'],
  ['another list word', 'Hitler fan club'],
  ['a list word with leet and breaks', 'H.1.7.l.e.r'],
  ['a word that stands alone in the title', 'Shit happens'],
  ['a whole-text entry', 'Slut'],
  ['a whole-text entry spaced out', 's l u t'],
  ['a word of several', 'Casual rape night'],
  ['symbols between words', '*** cunt ***'],
  ['bars for ls (the third reading only)', 'bu||shit'],
  ['exclamation marks between letters (the first reading only)', 'f!u!c!k'],
  // letters written as symbols (M13-8 review, finding 1): NFKC maps most; the boxed capitals it keeps are read as letters
  ['circled capitals', 'Ⓕⓤⓒⓚ'],
  ['circled small letters', 'ⓕⓤⓒⓚ this'],
  ['circled letters of another word', 'Ⓑⓘⓣⓒⓗ'],
  ['circled letters of a list name', 'Ⓗⓘⓣⓛⓔⓡ fan club'],
  ['parenthesized letters', '⒡⒰⒞⒦'],
  ['squared capitals', '🄵🅄🄲🄺'],
  ['negative circled capitals', '🅕🅤🅒🅚'],
  ['negative squared capitals', '🅵🆄🅲🅺'],
  ['regional indicator letters', '🇫🇺🇨🇰'],
  ['mathematical letters', '𝔽𝕦𝕔𝕜'],
];

/** Titles that look like some of the above and are not: the Scunthorpe problem, words inside longer words, other scripts. */
const ALLOWED_TITLES: readonly string[] = [
  'Friendly Modern game',
  'No netdecks please',
  'Standard BO1 - practice for Friday',
  'Fast & furious Pauper',
  'Scunthorpe FC fans',
  'Grape juice commander',
  'Slutsky vs Pomeroy',
  'Yoshito and Ashitaka',
  'Class of 2026',
  'Hancock and friends',
  'Therapist deck, be gentle',
  'Assassin tournament',
  'Cockatrice tribal',
  'Brass knuckles',
  '日本語のテーブル',
  'Пятничный дуэль',
  'Mon deck préféré',
  'Κυριακάτικο παιχνίδι',
  'Bring it! 🔥🔥',
  'Top 8 prep (1v1)',
  '1234',
  'Ⓐ team only',
  '🇯🇵 night 🇫🇷',
  '⑴ first table',
];

describe('M13-8 titles: the built-in list on fixed bad and good input', () => {
  it.each(REFUSED_TITLES)('refuses %s: %j', (_how, title) => {
    expect(builtIn.titleProblem(title), title).toBe(TITLE_REFUSED);
  });

  it.each(ALLOWED_TITLES.map((t) => [t]))('lets through %j', (title) => {
    expect(builtIn.titleProblem(title), title).toBeNull();
  });

  it('a refusal tells the player what to do and never repeats, hints at or spells the word that matched', () => {
    const matched: [string, string[]][] = [['Fuck this', ['fuck']], ['f.u.c.k', ['fuck', 'f.u.c.k']], ['Hitler fan club', ['hitler']], ['b1tch', ['bitch', 'b1tch']], ['Shit happens', ['shit']]];
    for (const [title, words] of matched) {
      const text = builtIn.titleProblem(title)!.toLowerCase();
      expect(text, title).toBe(TITLE_REFUSED.toLowerCase());
      for (const w of words) expect(text, `${title}: ${w}`).not.toContain(w);
    }
    expect(TITLE_REFUSED).toMatch(/reword/);
    expect(NAME_REFUSED).toMatch(/pick another/);
  });

  it('a title that has a word between spaces is judged by that word too, but a word that only holds one is not', () => {
    expect(builtIn.titleProblem('Not shit at all')).toBe(TITLE_REFUSED);
    expect(builtIn.titleProblem('Not Yoshito at all')).toBeNull();
    expect(builtIn.titleProblem('Not grape at all')).toBeNull();
  });

  it('what it cannot catch is a letter swapped for a symbol nobody reads as that letter, and spelling across two words is the player\'s to reword', () => {
    expect(builtIn.titleProblem('f*ck this')).toBeNull();
    expect(builtIn.titleProblem('Bit Chat')).toBe(TITLE_REFUSED);
  });
});

describe('M13-8 names: the same filter, its own message', () => {
  it('display names are filtered like titles: forms, scripts, exceptions', () => {
    for (const name of ['Fuckface', 'f.u.c.k', 'ЅНІТ', 'B1tch', 'Bullsh1t', 'Hitler', 'wh0re99', 'Slut']) expect(builtIn.nameProblem(name), name).toBe(NAME_REFUSED);
    for (const name of ['Alice', 'Bob', 'Scunthorpe', 'Yoshito', 'Grape', 'Jörg', 'Наташа', 'Ηλίας', '山田太郎', 'DarkLord99', 'Mr. Pomeroy']) expect(builtIn.nameProblem(name), name).toBeNull();
  });
});

describe('M13-8 input the filter must survive: a fixed list, never a throw', () => {
  const NASTY: readonly unknown[] = [
    '', ' ', '\n', '\u0000', '\u0000fuck', 'fu\u0000ck', '\ud800', 'fu\ud800ck', '\udc00\ud800', '‮fuck', 'f​u​c​k', '⠀', '🔥', '🔥'.repeat(100),
    'a'.repeat(256), 'a'.repeat(257), ' '.repeat(300), '́'.repeat(50), 'é'.normalize('NFD').repeat(100), 'ﷺ', '￿', '𝔽𝕦𝕔𝕜', 'ﬁ', '٠١٢٣', '\u{10FFFF}',
    null, undefined, 42, {}, [], ['fuck'],
  ];

  it('every one gets an answer (a refusal or none), for names and for titles', () => {
    for (const x of NASTY) {
      expect(() => builtIn.titleProblem(x as string), JSON.stringify(x)).not.toThrow();
      expect(() => builtIn.nameProblem(x as string), JSON.stringify(x)).not.toThrow();
    }
  });

  it('text longer than any name or title (256 UTF-16 units) and what is not text is refused, not passed unchecked', () => {
    expect(builtIn.titleProblem('a'.repeat(256))).toBeNull();
    for (const x of ['a'.repeat(257), 'Friendly game '.repeat(30), null, undefined, 42, {}, ['fuck']]) expect(builtIn.titleProblem(x as string), JSON.stringify(x)?.slice(0, 20)).toBe(TITLE_REFUSED);
  });

  it('a word spread across a long text is found, and a word that crosses the cut-off is not hidden by it', () => {
    expect(builtIn.titleProblem(`${'ok '.repeat(60)}fuck`)).toBe(TITLE_REFUSED);
    expect(builtIn.titleProblem(`${'ok '.repeat(80)}fu`)).toBeNull();
  });
});

describe('M13-8 the list file: MODERATION_WORDS_FILE\'s format and its loading', () => {
  const LIST = '# a fixed list for the tests\ngoblin\n=elf\n!elfen\n\n  =  Dragon  \r\n#= commented\n';
  const custom = new WordModeration(LIST);

  it('a plain word matches anywhere, =word only the whole text, !word excepts, # comments; blank lines and CRLF are fine; the list replaces the built-in one', () => {
    for (const t of ['Goblin tribal', 'Hobgoblins', 'G.o.b.l.i.n', 'Elf', 'dragon', 'D r a g o n']) expect(custom.titleProblem(t), t).toBe(TITLE_REFUSED);
    for (const t of ['Elfen lied', 'Self care', 'Dragons are great', 'commented', 'Fuck this']) expect(custom.titleProblem(t), t).toBeNull();
  });

  it('an empty list filters nothing; null is the built-in list', () => {
    expect(new WordModeration('').titleProblem('Fuck this')).toBeNull();
    expect(new WordModeration('# only a comment\n').titleProblem('Fuck this')).toBeNull();
    expect(new WordModeration(null).titleProblem('Fuck this')).toBe(TITLE_REFUSED);
  });

  const dirs: string[] = [];
  const tmp = async () => {
    const d = await mkdtemp(join(tmpdir(), 'm13-8-words-'));
    dirs.push(d);
    return d;
  };
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('moderationFromFile reads the file (a byte order mark and all); null reads none', async () => {
    const file = join(await tmp(), 'words.txt');
    await writeFile(file, `﻿goblin\r\n=elf\r\n`, 'utf8');
    const m = await moderationFromFile(file);
    expect(m.titleProblem('Goblin tribal')).toBe(TITLE_REFUSED);
    expect(m.titleProblem('Elf')).toBe(TITLE_REFUSED);
    expect(m.titleProblem('Fuck this')).toBeNull();
    expect((await moderationFromFile(null)).titleProblem('Fuck this')).toBe(TITLE_REFUSED);
  });

  it('a file that is named and cannot be used stops the start: the message has the path and the reason, never the text', async () => {
    const dir = await tmp();
    const missing = await moderationFromFile(join(dir, 'nope.txt')).catch((e: Error) => e);
    expect(missing).toBeInstanceOf(Error);
    expect((missing as Error).message).toBe(`MODERATION_WORDS_FILE: cannot use ${join(dir, 'nope.txt')} (ENOENT).`);
    const asDir = await moderationFromFile(dir).catch((e: Error) => e);
    expect((asDir as Error).message).toContain(`cannot use ${dir}`);
    const big = join(dir, 'big.txt');
    await writeFile(big, `secretword\n${'x'.repeat(WORDS_FILE_MAX_BYTES)}`, 'utf8');
    const tooBig = await moderationFromFile(big).catch((e: Error) => e);
    expect((tooBig as Error).message).toBe(`MODERATION_WORDS_FILE: cannot use ${big} (too large).`);
    expect((tooBig as Error).message).not.toContain('secretword');
  });
});

describe('M13-8 names and titles through the real gateway', () => {
  /** A refused hello: the connection closes with 4002 and a `bye` that says why. */
  async function refusedHello(t: ReturnType<typeof lobbyGateway>, name: string): Promise<{ code: number; bye: string | undefined; welcomed: boolean }> {
    const b = Browser.connect(t, { peer: freshPeer() });
    b.client.send({ t: 'hello', protocol: 1, name });
    await b.client.until(() => b.client.closed !== null);
    return { code: b.client.closed!.code, bye: b.of('bye')[0]?.reason, welcomed: b.of('welcome').length > 0 };
  }

  it('a name the filter refuses is refused at hello (closed 4002 with the reason, no session made); a good one is welcomed', async () => {
    const t = lobbyGateway();
    for (const name of ['Fuckface', 'f.u.c.k', 'B1tch', 'ЅНІТ']) {
      const r = await refusedHello(t, name);
      expect(r, name).toEqual({ code: CLOSE_PROTOCOL, bye: NAME_REFUSED, welcomed: false });
    }
    expect(t.gateway.connections).toBe(0);
    const ok = await guest(t, 'Scunthorpe');
    expect(ok.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a title the filter refuses is notAllowed and makes no table; the same words in the creator\'s name never get that far', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    for (const title of ['Fuck this', 'f.u.c.k club', 'b1tch please', '$hithead', 'Shit happens']) {
      expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title, deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] } }), title)
        .toMatchObject({ ok: false, error: { code: 'notAllowed', message: TITLE_REFUSED } });
      t.clock.advance(10_000);
    }
    expect(t.gateway.tables.counts().lobby).toBe(0);
    expect(t.lobby.stats().visible).toBe(0);
    await createTable(a, { title: 'Grape juice commander' });
    expect(t.lobby.stats().visible).toBe(1);
  });

  it('private tables have titles too, and the filter applies to them', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', title: 'f.u.c.k', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] } }))
      .toMatchObject({ ok: false, error: { code: 'notAllowed' } });
  });

  it('the hosted text rules come first: a fixed list of titles that are not text a player could read', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const BAD: [string, string][] = [
      ['too short', 'ab'], ['too short once collapsed', '  a   '], ['blank', '   '], ['too long', 'a'.repeat(61)], ['a line break', 'Line\nbreak'], ['a tab', 'Tab\there'],
      ['NUL', 'nul\u0000title'], ['a bidirectional control', 'bidi ‮title'], ['an unpaired surrogate', 'lone \ud800 surrogate'], ['a zero-width space', 'zero​width'],
      ['an invisible braille pattern', '⠀⠀⠀'], ['a private-use character', 'private  use'], ['stacked combining marks', 'Ź̂̃̄̅algo'], ['no letter at all', '   .'],
    ];
    for (const [why, title] of BAD) {
      const r = await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title, deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] } });
      expect(r, why).toMatchObject({ ok: false, error: { code: 'badMessage' } });
      t.clock.advance(10_000);
    }
    expect(t.gateway.tables.counts().lobby).toBe(0);
  });

  it('a title that passes is shown as the player wrote it with its white space collapsed; 3 and 60 characters are the limits; text in any script is fine', async () => {
    const t = lobbyGateway();
    const players = [await guest(t, 'Alice'), await guest(t, 'Bob'), await guest(t, 'Carol'), await guest(t, 'Dave'), await guest(t, 'Erin')];
    const titles = ['  Spaced   out  　 title ', 'abc', 'a'.repeat(60), '日本語のテーブル', '🔥🔥 Burn 🔥🔥'];
    for (const [i, title] of titles.entries()) await createTable(players[i]!, { title });
    expect(t.lobby.browse({ t: 'browse', id: 1, filter: {}, sort: 'newest', page: 0 }, 0).tables.map((l) => l.title).sort()).toEqual(
      ['Spaced out title', 'abc', 'a'.repeat(60), '日本語のテーブル', '🔥🔥 Burn 🔥🔥'].sort(),
    );
  });
});
