/**
 * WP5, parser front end step 3 (design 6.1 step 4, 6.2): tokens WORD NUM X MANA TAP PT MOD ROMAN SELF PUNCT BULLET QUOTE ERR. Synthetic wording only.
 */
import { describe, expect, it } from 'vitest';
import { tokenNorms, tokenize } from '../../../src/parser/tokenize';

const kinds = (s: string, opts = {}): string => tokenize(s, opts).map((t) => t.kind).join(' ');
const norms = (s: string, opts = {}): string => tokenNorms(tokenize(s, opts));

describe('words and numbers', () => {
  it('words are lower-cased in norm and remember their capital', () => {
    const [a, b] = tokenize('Draw cards');
    expect(a).toMatchObject({ kind: 'WORD', text: 'Draw', norm: 'draw', cap: true, range: [0, 4] });
    expect(b).toMatchObject({ kind: 'WORD', norm: 'cards', range: [5, 10] });
    expect(b!.cap).toBeUndefined();
  });

  it('apostrophes and hyphens inside a word stay: creature\'s, can\'t, face-down, Assembly-Worker', () => {
    expect(norms("creature's can't face-down Assembly-Worker")).toBe("creature's can't face-down assembly-worker");
  });

  it('a plural possessive keeps its apostrophe', () => {
    expect(norms("the players' hands")).toBe("the players' hands");
  });

  it('number words carry a value; digits are NUM', () => {
    const t = tokenize('three 12 twenty');
    expect(t.map((x) => [x.kind, x.value])).toEqual([['WORD', 3], ['NUM', 12], ['WORD', 20]]);
  });

  it('a lone X is an X, Roman numerals are ROMAN, "and/or" is one word', () => {
    expect(kinds('X II IV and/or')).toBe('X ROMAN ROMAN WORD');
    expect(tokenize('IV')[0]!.value).toBe(4);
    expect(tokenize('X')[0]).toMatchObject({ kind: 'X', norm: 'X' });
  });

  it('"non" is split off: non-Human, nonblack, noncreature, but not "none" or "nonsense"', () => {
    expect(norms('non-Human nonblack noncreature none nonsense')).toBe('non human non black non creature none nonsense');
    expect(tokenize('nonblack').every((t) => t.split)).toBe(true);
    expect(tokenize('nonblack').map((t) => t.range)).toEqual([[0, 3], [3, 8]]);
    expect(tokenize('non-Human').map((t) => t.range)).toEqual([[0, 4], [4, 9]]); // the hyphen belongs to "non"
  });

  it('the infinity symbol is a word (CR 702.186)', () => {
    expect(norms('∞ —')).toContain('∞');
  });
});

describe('symbols', () => {
  it('mana symbols are one MANA token each, norm in upper case', () => {
    expect(tokenize('{2}{R}{W/U}{2/W}{G/P}{X}{C}{S}{E}').map((t) => [t.kind, t.norm])).toEqual([
      ['MANA', '2'], ['MANA', 'R'], ['MANA', 'W/U'], ['MANA', '2/W'], ['MANA', 'G/P'], ['MANA', 'X'], ['MANA', 'C'], ['MANA', 'S'], ['MANA', 'E'],
    ]);
  });

  it('{T} and {Q} are TAP', () => {
    expect(tokenize('{T}, {Q}').map((t) => [t.kind, t.norm])).toEqual([['TAP', 'T'], ['PUNCT', ','], ['TAP', 'Q']]);
  });

  it('an unknown or unclosed brace group is an ERR, never a guess', () => {
    expect(tokenize('{what is this}')[0]).toMatchObject({ kind: 'ERR', reason: 'unknown symbol {what is this}' });
    expect(tokenize('{T')[0]).toMatchObject({ kind: 'ERR', reason: 'unclosed symbol' });
  });

  it('power/toughness pairs are PT, modifications are MOD, with their parts', () => {
    expect(tokenize('2/2 */* X/X 1+*/2+*')[0]).toMatchObject({ kind: 'PT', pt: { power: '2', toughness: '2' } });
    expect(tokenize('1+*/2+*')[0]).toMatchObject({ kind: 'PT', pt: { power: '1+*', toughness: '2+*' } });
    expect(tokenize('+1/+1')[0]).toMatchObject({ kind: 'MOD', mod: { power: '+1', toughness: '+1' } });
    expect(tokenize('-2/-0')[0]).toMatchObject({ kind: 'MOD', mod: { power: '-2', toughness: '-0' } });
    expect(tokenize('+X/+X')[0]).toMatchObject({ kind: 'MOD', mod: { power: '+X', toughness: '+X' } });
    expect(tokenize('+1/-1')[0]).toMatchObject({ kind: 'MOD', mod: { power: '+1', toughness: '-1' } });
  });

  it('a power/toughness inside a word or a date-like pair is not a PT', () => {
    expect(kinds('3/4s')).not.toContain('PT');
  });

  it('a sign without a slash is punctuation and a number', () => {
    expect(kinds('+2 -1')).toBe('PUNCT NUM PUNCT NUM');
  });

  it('bullets and the self reference', () => {
    expect(kinds('• ~ deals')).toBe('BULLET SELF WORD');
  });

  it('punctuation: period, comma, colon, dashes', () => {
    expect(tokenize('a. b, c: d -- e - f').map((t) => t.norm)).toEqual(['a', '.', 'b', ',', 'c', ':', 'd', '--', 'e', '-', 'f']);
  });

  it('a character with no meaning is an ERR with its code point (G2)', () => {
    expect(tokenize('a ☐ b')[1]).toMatchObject({ kind: 'ERR', reason: 'unknown character U+2610' });
    expect(tokenize('3x')[0]).toMatchObject({ kind: 'ERR', reason: 'number glued to letters' });
  });
});

describe('SELF', () => {
  it('its range covers the words it replaced (position of "~" -> range)', () => {
    const text = '        ~ deals 1 damage.';
    const [self] = tokenize(text, { selfExtents: new Map([[8, [0, 9]]]) });
    expect(self).toMatchObject({ kind: 'SELF', norm: '~', range: [0, 9] });
  });

  it('~\'s is SELF then a possessive word', () => {
    expect(tokenize("~'s power").map((t) => t.norm)).toEqual(['~', "'s", 'power']);
  });
});

describe('quoted abilities are sub-streams (design 6.1 step 4)', () => {
  it('a quote is one QUOTE token holding the tokens of the quoted ability, periods included', () => {
    const t = tokenize('gains "{T}: Add {C}. Draw." now');
    expect(t.map((x) => x.kind)).toEqual(['WORD', 'QUOTE', 'WORD']);
    const q = t[1]!;
    expect(q).toMatchObject({ quote: '"', range: [6, 27] });
    expect(q.sub!.map((x) => x.norm)).toEqual(['T', ':', 'add', 'C', '.', 'draw', '.']);
    expect(q.sub![0]!.range).toEqual([7, 10]);
  });

  it('a single-quoted ability nests inside a double-quoted one', () => {
    const t = tokenize('"Create a token with \'It can\'t block.\' Then draw."');
    const outer = t[0]!;
    expect(t).toHaveLength(1);
    const inner = outer.sub!.find((x) => x.kind === 'QUOTE')!;
    expect(inner.quote).toBe("'");
    expect(inner.sub!.map((x) => x.norm)).toEqual(['it', "can't", 'block', '.']);
    expect(tokenNorms(t)).toBe('"create a token with "it can\'t block ." then draw ."');
  });

  it('an apostrophe inside a double quote is not an opener', () => {
    const t = tokenize('"This creature\'s power is 3."');
    expect(t).toHaveLength(1);
    expect(t[0]!.sub!.map((x) => x.norm)).toEqual(['this', "creature's", 'power', 'is', '3', '.']);
  });

  it('a quote that never closes is an ERR, and so is a stray closer', () => {
    expect(tokenize('gains "never closed')[1]).toMatchObject({ kind: 'ERR', reason: 'unmatched quote' });
    expect(kinds('a "b" c "d')).toBe('WORD QUOTE WORD ERR WORD');
  });

  it('only the range that is asked for is tokenized, with absolute ranges', () => {
    const text = 'abc def ghi';
    expect(tokenize(text, { from: 4, to: 7 }).map((t) => [t.norm, t.range])).toEqual([['def', [4, 7]]]);
  });
});

describe('card names', () => {
  const names = new Set(['Bruna, the Fading Light', 'Sol Ring', 'Pia Nalaar']);

  it('after "named" a card name is one token, comma and all, and the longest name wins', () => {
    const t = tokenize('creature named Bruna, the Fading Light and more', { cardNames: names });
    expect(t.map((x) => x.norm)).toEqual(['creature', 'named', 'Bruna, the Fading Light', 'and', 'more']);
    expect(t[2]).toMatchObject({ kind: 'WORD', name: true, cap: true });
  });

  it('a name with a comma is one token wherever it appears, so the comma never splits it', () => {
    const t = tokenize('then meld them into Bruna, the Fading Light. Draw.', { cardNames: names });
    expect(t.map((x) => x.norm)).toEqual(['then', 'meld', 'them', 'into', 'Bruna, the Fading Light', '.', 'draw', '.']);
    expect(tokenize('Bruna, the Fading Lights', { cardNames: names }).map((x) => x.norm)).toEqual(['bruna', ',', 'the', 'fading', 'lights']); // whole words only
    expect(tokenize('Bruna attacks', { cardNames: names }).map((x) => x.norm)).toEqual(['bruna', 'attacks']);
  });

  it('after "partner with" too', () => {
    const t = tokenize('Partner with Pia Nalaar', { cardNames: names });
    expect(t.map((x) => x.norm)).toEqual(['partner', 'with', 'Pia Nalaar']);
  });

  it('a name that is not in the index is ordinary words, and so is a name without "named"', () => {
    expect(norms('named Nobody Special', { cardNames: names })).toBe('named nobody special');
    expect(norms('Sol Ring', { cardNames: names })).toBe('sol ring');
  });

  it('without a name index nothing is treated as a name', () => {
    expect(norms('named Bruna, the Fading Light')).toBe('named bruna , the fading light');
  });
});

describe('totality', () => {
  it('never throws on any text, and tokens never overlap and stay inside the range', () => {
    const nasty = ['', ' ', '"', "'", '{', '}', '((', '\u0000', '😀', '~~~', '+/+', '-/-', '1/', '/1', 'X/', '"""', "''''", '{{}}', 'a--b---c', '••', 'IIII', '3.5', '{T}{T'];
    for (const s of nasty) {
      const t = tokenize(s);
      let at = 0;
      for (const x of t) {
        expect(x.range[0]).toBeGreaterThanOrEqual(at);
        expect(x.range[1]).toBeGreaterThan(x.range[0]);
        expect(x.range[1]).toBeLessThanOrEqual(s.length);
        at = x.range[1];
      }
    }
  });

  it('every non-space character of a sentence is inside exactly one token', () => {
    const s = 'Target creature gets +2/+2 and gains "{T}: Add {C}." until end of turn.';
    const covered = new Uint8Array(s.length);
    for (const t of tokenize(s)) for (let i = t.range[0]; i < t.range[1]; i++) covered[i]! += 1;
    for (let i = 0; i < s.length; i++) expect(s[i] === ' ' ? covered[i]! <= 1 : covered[i] === 1, `char ${i} ${JSON.stringify(s[i])}`).toBe(true);
  });
});
