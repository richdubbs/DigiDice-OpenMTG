/**
 * M14-3: the password policy (design 4.2) on fixed lists, rule by rule: what the browser checks (passwordShapeProblem, with the server's minimum)
 * and what the server adds (the name's canonical key, the blocklist: CredentialTools.passwordProblem). The browser and the server agree on every
 * rule but the two that need server data.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, passwordShapeProblem, type PasswordProblem } from '../../src/api';
import { passwordForm } from '../../src/api/passwords';
import { createCredentialTools } from '../../src/crypto/index';
import { serverPasswordProblem } from '../../src/crypto/policy';
import { constantTimeEqual } from '../../src/compose';
import { loadAccountsConfig } from '../../src/config';
import { fixedRandom } from '../m14-1/support';

const NONE = { name: null, emailLocal: null };
const shape = (pw: unknown, ctx: { name: string | null; emailLocal: string | null } = NONE, limits?: { passwordMin: number }) =>
  passwordShapeProblem(pw, ctx, limits);
const tools = createCredentialTools({ random: fixedRandom('m14-3 policy'), equal: constantTimeEqual, peppers: [], passwordMin: 12 });

/** Inputs every rule accepts (no blocklist hit either). */
const ACCEPTED = [
  'correct horse battery staple', 'Tr0ub4dor&3x is old', 'my dog rex is 7 years', 'I like turtles 42!', 'Ünïcödé pässwörd ok',
  '密码是一个很长的句子对吗', '🐉 dragons breathe fire 🔥', '   leading and trailing   ', 'tab-free text, with commas', 'wer werewolf howls',
  'openmtg is a fun project', 'digidice makes dice', 'aab bcc dde ff', 'Zebra-Quartz-Lantern', 'abcdeabcdeab',
];

describe('M14-3: the policy, rule by rule (the browser\'s check)', () => {
  it('type: not a string', () => {
    for (const x of [undefined, null, 42, {}, ['correct horse battery'], true]) expect(shape(x), String(x)).toBe('type');
  });

  it('long: more than 512 UTF-16 units as typed, or more than 128 code points after NFKC', () => {
    expect(shape('x1'.repeat(256) + 'y')).toBe('long'); // 513 units
    expect(shape('a sentence of words '.repeat(7))).toBe('long'); // 140 code points
    expect(shape('ﷺ'.repeat(8))).toBe('long'); // 8 code points as typed, 144 after NFKC
    expect(shape('🐉'.repeat(128))).toBe('repeated'); // 256 units, 128 code points: long enough, not too long
    expect(shape(`${'correct horse battery staple '.repeat(4)}abcdefghij`.slice(0, 128))).toBeNull();
  });

  it('character: NUL, an unpaired surrogate, control and bidi characters (m13\'s text rules)', () => {
    for (const bad of ['\u0000', '\ud800', '\udc00x', '\u0007', '\u001b', '\u007f', '\u0085', ' ', '‮', '‏', '⁦', '\n', '\t']) {
      expect(shape(`correct horse ${bad} battery`), JSON.stringify(bad)).toBe('character');
    }
  });

  it('short: fewer code points than the minimum after NFKC; the server\'s minimum wins over the constant', () => {
    expect(ACCOUNT_LIMITS.passwordMin).toBe(12);
    expect(shape('Tr0ub4dor&3')).toBe('short'); // 11
    expect(shape('Tr0ub4dor&3x')).toBeNull(); // 12
    expect(shape('🐉🔥🐉🔥🐉🔥🐉🔥🐉🔥🐉')).toBe('short'); // 11 code points, 22 units
    expect(shape('Tr0ub4dor&3x', NONE, { passwordMin: 15 })).toBe('short');
    expect(shape('Tr0ub4dor&3x!!', NONE, { passwordMin: 15 })).toBe('short');
    expect(shape('Tr0ub4dor&3x!?.', NONE, { passwordMin: 15 })).toBeNull();
    expect(shape('Tr0ub4dor', NONE, { passwordMin: 8 })).toBeNull();
    // a minimum that makes no sense falls back to ACCOUNT_LIMITS.passwordMin
    for (const m of [0, -1, 1.5, 129, Number.NaN]) expect(shape('Tr0ub4dor&3', NONE, { passwordMin: m }), String(m)).toBe('short');
  });

  it('short counts what was typed too: a character NFKC expands is still one character (review of M14-3)', () => {
    // U+FDFA is 18 code points after NFKC, U+FDFB 8, U+3316 and U+33AF 6 each
    expect(Array.from('ﷺ'.normalize('NFKC'))).toHaveLength(18);
    for (const x of ['ﷺ', '㌖㌖', 'ﷻﷻ', '㎯㎯', 'ﷺﷻ', `${'ﷺ'}abc`, `ﷺ${'x'.repeat(10)}`]) {
      expect(shape(x), x).toBe('short');
      expect(tools.passwordProblem(x, { name: 'Zed', key: 'zed', emailLocal: null }), x).toBe('short');
    }
    expect(shape(`ﷺ${'xyz'.repeat(3)}ab`)).toBeNull(); // 12 typed
    expect(shape('ﷺ', NONE, { passwordMin: 8 })).toBe('short');
    // the smaller count wins the other way as well: combining marks that NFKC joins count once
    const decomposed = 'café crème!'.normalize('NFD') + 'x'; // 14 code points typed, 12 after NFKC
    expect(Array.from(decomposed)).toHaveLength(14);
    expect(shape(decomposed)).toBeNull();
    expect(shape('café crème!')).toBe('short'); // 13 typed, 11 after NFKC
  });

  it('accepts any characters, spaces and emoji, without trimming or composition rules', () => {
    for (const ok of ACCEPTED) expect(shape(ok, { name: 'Alice', emailLocal: 'jane.doe' }), ok).toBeNull();
  });

  it('repeated: one character, or a block of up to 4, repeated', () => {
    for (const x of ['aaaaaaaaaaaa', 'AAAAaaaaAAAA', '            ', '111111111111', 'abababababab', 'abcabcabcabc', 'abcdabcdabcd', 'xy!.xy!.xy!.',
      '🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂', 'asdgasdgasdg', 'aaaaaabbbbbb', 'aaaa1111bbbb', '111222333444']) {
      expect(shape(x), x).toBe('repeated');
    }
    // a block of 5 is no longer "repeated" (and these runs do not cover it: e to a is no step)
    expect(shape('abcdeabcdeab')).toBeNull();
  });

  it('sequence: made of runs through the alphabet or the digits, up or down, wrapping', () => {
    for (const x of ['123456789012', 'abcdefghijkl', 'lkjihgfedcba', '987654321098', 'xyzabcdefghi', 'abc123def456', 'abcxyz789mno', 'ＡＢＣＤＥＦＧＨＩＪＫＬ',
      'αβγδεζηθικλμ', 'абвгдежзийкл', '0123456789abc', 'zyxwvu987654', 'abcdefabcdef', 'aaa123456789']) {
      expect(shape(x), x).toBe('sequence');
    }
  });

  it('keyboard: made of walks along one keyboard row, shifted symbols as their keys', () => {
    for (const x of ['qwertyuiop[]', 'qwerty123456', '!@#$%^&*()_+', "asdfghjkl;'zxc", 'mnbvcxzlkjhg', 'azertyuiopqsd', 'qwertzuiopasd',
      'poiuytrewqasd', 'QWERTYUIOPasd', 'aaaaaaaqwert']) {
      expect(shape(x), x).toBe('keyboard');
    }
  });

  it('containsName: the name or its separator-free form anywhere (4 characters or more), a shorter name with only padding added', () => {
    const cases: [string, string][] = [
      ['Alice', 'alice in wonderland'], ['Alice', 'ALICE12345678'], ['Alice', 'wonderland ALICE'], ['Ann Lee', 'annlee forever and ever'],
      ['Ann-Lee', 'my name is ann-lee ok'], ['Bob', 'bob123456789'], ['Bob', '!!!!!!!!!bob'], ['José', 'josé 2026 2027'], ['Ｊｏｓｅ', 'jose jose jose x'],
      // the name with other separators where it has them; a short name with only separators and digits around it
      ['Ann Lee', 'i am ann-lee forever'], ['Ann Lee', 'ann__lee all the way'], ['Bob', 'bob 1234 5678'],
      // exactly 4 characters, inside ordinary text (review of M14-3: the boundary of "4 characters or more")
      ['Mike', 'mike likes long walks'], ['Mike', 'long walks with MIKE'],
    ];
    for (const [name, pw] of cases) expect(shape(pw, { name, emailLocal: null }), `${name}: ${pw}`).toBe('containsName');
    // a 3-character name inside a longer password is fine
    expect(shape('bobsleigh in winter', { name: 'Bob', emailLocal: null })).toBeNull();
    expect(shape('bob likes long walks', { name: 'Bob', emailLocal: null })).toBeNull();
    expect(shape('planning a long trip', { name: 'Ann', emailLocal: null })).toBeNull();
    expect(shape('alice in wonderland', NONE)).toBeNull();
    // the password's own separators are kept: a name is never found across two of its words (review of M14-3)
    const passphrases: [string, string][] = [
      ['Sean', 'the sea nymph sang softly'], ['Theo', 'go to the ocean in summer'], ['Alice', 'a pal ice skates'],
    ];
    for (const [name, pw] of passphrases) {
      expect(shape(pw, { name, emailLocal: null }), `${name}: ${pw}`).toBeNull();
      expect(tools.passwordProblem(pw, { name, key: passwordForm(name).replace(/\s/gu, ''), emailLocal: null }), `${name}: ${pw}`).toBeNull();
    }
  });

  it('containsEmail: the local part (and its part before a "+tag")', () => {
    const ctx = (emailLocal: string) => ({ name: 'Zed', emailLocal });
    expect(shape('janedoe forever!', ctx('jane.doe'))).toBe('containsEmail');
    expect(shape('i am jane.doe ok', ctx('jane.doe'))).toBe('containsEmail');
    expect(shape('superjane forever', ctx('superjane+openmtg'))).toBe('containsEmail');
    expect(shape('al1234567890', ctx('al'))).toBe('containsEmail');
    expect(shape('the walrus and the carpenter', ctx('al'))).toBeNull();
    expect(shape('janedoe forever!', ctx(''))).toBeNull();
    expect(shape('janedoe forever!', NONE)).toBeNull();
  });

  it('context: openmtg, digidice or magicthegathering with only digits or one repeated character added', () => {
    for (const x of ['openmtg12345', 'OpenMTG 2026 2027', '2026openmtg2026', 'Magic: The Gathering', 'magicthegathering', 'digidice!!!!!', '!!!!!digidice',
      'openmtgopenmtg', 'open-mtg 123456']) {
      expect(shape(x), x).toBe('context');
    }
    for (const x of ['openmtg is a fun project', 'openmtg2026 rocks', 'digidice makes dice', 'magic the gathering is fun']) expect(shape(x), x).toBeNull();
  });
});

describe('M14-3: the server\'s policy (CredentialTools.passwordProblem)', () => {
  it('adds the name\'s canonical key to rule 6', () => {
    expect(tools.passwordProblem('rnlke is my handle', { name: 'MIKE', key: 'rnlke', emailLocal: null })).toBe('containsName');
    expect(shape('rnlke is my handle', { name: 'MIKE', emailLocal: null })).toBeNull();
    expect(tools.passwordProblem('allce1234567', { name: 'ALICE', key: 'allce', emailLocal: null })).toBe('containsName');
  });

  it('common: a blocklist hit, compared in the policy\'s form', () => {
    for (const x of ['iloveyou1234', 'PASSWORD1234', 'ManchesterUnited', 'qazwsxedcrfv', '1qaz2wsx3edc', 'ｉｌｏｖｅｙｏｕ１２３４']) {
      expect(shape(x), x).toBeNull(); // the browser has no blocklist
      expect(tools.passwordProblem(x, { name: 'Zed', key: 'zed', emailLocal: null }), x).toBe('common');
    }
    expect(serverPasswordProblem('my own phrase here', { name: 'Zed', key: 'zed', emailLocal: null }, 12, new Set([passwordForm('MY OWN phrase here')]))).toBe('common');
  });

  it('common at the lowest minimum the configuration accepts (8); a lower minimum is refused when the tools are made', () => {
    // review of M14-3: the blocklist held only entries of 12 or more, so with PASSWORD_MIN 8 the commonest passwords of 8 to 11 characters passed
    const low = loadAccountsConfig({ ACCOUNTS: '1', PASSWORD_MIN: '8' });
    expect(low.ok && low.config.passwordMin).toBe(8);
    const at8 = createCredentialTools({ random: fixedRandom('m14-3 min 8'), equal: constantTimeEqual, peppers: [], passwordMin: 8 });
    const zed = { name: 'Zed', key: 'zed', emailLocal: null };
    for (const x of ['password', 'baseball', 'football', 'superman', 'trustno1', 'sunshine', 'iloveyou', 'princess', 'password1', 'iloveyou1',
      'iloveyou12', 'princess1', 'football1', 'sunshine1', 'PassWord1', 'ＩＬＯＶＥＹＯＵ']) {
      expect(shape(x, NONE, { passwordMin: 8 }), x).toBeNull(); // the browser has no blocklist
      expect(at8.passwordProblem(x, zed), x).toBe('common');
    }
    expect(at8.passwordProblem('Tr0ub4dor', zed)).toBeNull();
    expect(tools.passwordProblem('password1', zed)).toBe('short');
    expect(() => createCredentialTools({ random: fixedRandom('x'), equal: constantTimeEqual, peppers: [], passwordMin: 7 })).toThrow(RangeError);
  });

  it('the server agrees with the browser on every other rule, with its own minimum', () => {
    const lists: unknown[] = [...ACCEPTED, 'aaaaaaaaaaaa', '123456789012', 'qwertyuiop[]', 'alice in wonderland', 'janedoe forever!', 'openmtg12345', 'Tr0ub4dor&3', 42, 'a\u0000bcdefghijklmn'];
    const empty = new Set<string>();
    for (const x of lists) {
      const browser = shape(x, { name: 'Alice', emailLocal: 'jane.doe' });
      const server = serverPasswordProblem(x, { name: 'Alice', key: 'allce', emailLocal: 'jane.doe' }, 12, empty);
      expect(server, String(x)).toBe(browser);
    }
    const strict = createCredentialTools({ random: fixedRandom('m14-3 strict'), equal: constantTimeEqual, peppers: [], passwordMin: 16 });
    expect(strict.passwordProblem('Tr0ub4dor&3x is', { name: 'Zed', key: 'zed', emailLocal: null })).toBe('short');
    expect(() => createCredentialTools({ random: fixedRandom('x'), equal: constantTimeEqual, peppers: [], passwordMin: 0 })).toThrow(RangeError);
  });

  it('accepts what every rule accepts', () => {
    const problems: (PasswordProblem | null)[] = ACCEPTED.map((x) => tools.passwordProblem(x, { name: 'Somebody', key: 'sornebody', emailLocal: null }));
    expect(problems).toEqual(ACCEPTED.map(() => null));
  });
});
