/**
 * WP6: TokenDesc, Keyword, Abilities, Color, CounterKind, ManaCost, PT, Name, ChoiceKind. Rules cited: CR 105.1 (colors), 107.4 (mana symbols), 111 (tokens),
 * 111.10 (predefined tokens), 122.1 (counters), 205 (types), 207.2 (ability words), 702 (keyword abilities), 702.16 (protection), 702.11 (hexproof).
 */
import { describe, expect, it } from 'vitest';
import type { HoleEnv, Tok } from '../../../src/parser/holes';
import { adaptTokens, lex, runHole } from '../../../src/parser/holes';
import { ENV, full, one, rejects, toks } from './env';

const quoted: HoleEnv = { ...ENV, subParser: (t: readonly Tok[]) => [{ kind: 'quoted', text: t.map((x) => x.text).join(' ') }] };

describe('WP6 TokenDesc (CR 111)', () => {
  it.each([
    ['1/1 white Soldier creature token', { colors: ['W'], types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1 }],
    ['2/2 black Zombie creature tokens', { colors: ['B'], types: ['Creature'], subtypes: ['Zombie'], power: 2, toughness: 2 }],
    ['3/3 green Beast creature token', { colors: ['G'], types: ['Creature'], subtypes: ['Beast'], power: 3, toughness: 3 }],
    ['X/X green Elemental creature token', { colors: ['G'], types: ['Creature'], subtypes: ['Elemental'], power: { q: 'X' }, toughness: { q: 'X' } }],
    ['white and blue Spirit creature token with flying', { colors: ['W', 'U'], types: ['Creature'], subtypes: ['Spirit'], keywords: ['flying'] }],
    ['4/4 red Dragon creature token with flying', { colors: ['R'], types: ['Creature'], subtypes: ['Dragon'], power: 4, toughness: 4, keywords: ['flying'] }],
    ['1/1 blue Bird creature token with flying and haste', { colors: ['U'], types: ['Creature'], subtypes: ['Bird'], power: 1, toughness: 1, keywords: ['flying', 'haste'] }],
    ['legendary 4/4 white Angel creature token with flying and vigilance', { colors: ['W'], supertypes: ['Legendary'], types: ['Creature'], subtypes: ['Angel'], power: 4, toughness: 4, keywords: ['flying', 'vigilance'] }],
    ['colorless Treasure artifact token', { colors: [], types: ['Artifact'], subtypes: ['Treasure'] }],
    ['2/2 black Zombie creature token named Zzz', { colors: ['B'], types: ['Creature'], subtypes: ['Zombie'], power: 2, toughness: 2, name: 'Zzz' }],
  ])('"%s"', (phrase, expected) => {
    expect(one('TokenDesc', phrase)).toEqual(expected);
  });

  it('CR 111.10: a predefined token is named only', () => {
    expect(one('TokenDesc', 'Treasure token')).toEqual({ predefined: 'Treasure' });
    expect(one('TokenDesc', 'Treasure tokens')).toEqual({ predefined: 'Treasure' });
    expect(one('TokenDesc', 'Food token')).toEqual({ predefined: 'Food' });
  });

  it('quoted abilities go to `abilities` through the caller-supplied sub-parser, and do not parse without one', () => {
    const phrase = '1/1 colorless Eldrazi Scion creature token with "Sacrifice this creature: Add {C}."';
    expect(one('TokenDesc', phrase, quoted)).toMatchObject({ subtypes: ['Eldrazi', 'Scion'], abilities: [{ kind: 'quoted' }] });
    expect(rejects('TokenDesc', phrase)).toBe(true);
  });

  it('G2: an unknown subtype, a token with no type and a lone "token" fail', () => {
    for (const bad of ['1/1 white Zzz creature token', '1/1 token', 'token', '1/1 white Soldier token']) expect(rejects('TokenDesc', bad), bad).toBe(true);
  });
});

describe('WP6 Keyword / Abilities (CR 702)', () => {
  it.each([
    ['flying', { kind: 'keyword', keyword: 'flying', text: 'flying' }],
    ['first strike', { kind: 'keyword', keyword: 'first strike', text: 'first strike' }],
    ['protection from red', { kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'protection from red' }],
    ['protection from artifacts', { kind: 'keyword', keyword: 'protection', quality: 'type:Artifact', text: 'protection from artifacts' }],
    ['protection from Goblins', { kind: 'keyword', keyword: 'protection', quality: 'subtype:goblins', text: 'protection from Goblins' }],
    ['protection from everything', { kind: 'keyword', keyword: 'protection', quality: 'everything', text: 'protection from everything' }],
    ['hexproof', { kind: 'keyword', keyword: 'hexproof', text: 'hexproof' }],
    ['hexproof from blue', { kind: 'keyword', keyword: 'hexproof', quality: 'color:U', text: 'hexproof from blue' }],
    ['ward {2}', { kind: 'keyword', keyword: 'ward', cost: { mana: [{ kind: 'generic', amount: 2 }] }, text: 'ward {2}' }],
    ['ward--Pay 3 life', { kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'payLife', amount: 3 }] }, text: 'ward--Pay 3 life' }],
    ['toxic 2', { kind: 'keyword', keyword: 'toxic', amount: 2, text: 'toxic 2' }],
    ['kicker {1}{G}', { kind: 'keyword', keyword: 'kicker', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'G' }] }, text: 'kicker {1}{G}' }],
    ['suspend 3--{R}', { kind: 'keyword', keyword: 'suspend', amount: 3, cost: { mana: [{ kind: 'colored', color: 'R' }] }, text: 'suspend 3--{R}' }],
    ['enchant creature', { kind: 'keyword', keyword: 'enchant', filter: { types: ['Creature'] }, text: 'enchant creature' }],
    ['affinity for artifacts', { kind: 'keyword', keyword: 'affinity', filter: { types: ['Artifact'] }, text: 'affinity for artifacts' }],
  ])('Keyword "%s"', (phrase, expected) => {
    expect(one('Keyword', phrase)).toEqual(expected);
  });

  it('Abilities: lists with "and", commas and the Oxford comma; "protection from A and from B" is two abilities (CR 702.16b)', () => {
    expect((one('Abilities', 'flying and haste') as { keyword: string }[]).map((a) => a.keyword)).toEqual(['flying', 'haste']);
    expect((one('Abilities', 'flying, vigilance, and trample') as { keyword: string }[]).map((a) => a.keyword)).toEqual(['flying', 'vigilance', 'trample']);
    expect(one('Abilities', 'protection from red and from blue')).toEqual([
      { kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'protection from red' },
      { kind: 'keyword', keyword: 'protection', quality: 'color:U', text: 'protection from blue' },
    ]);
  });

  it('Abilities: a quoted ability needs the caller-supplied sub-parser', () => {
    const phrase = 'first strike and "Sacrifice this creature: Add {C}."';
    expect(one('Abilities', phrase, quoted)).toMatchObject([{ kind: 'keyword', keyword: 'first strike' }, { kind: 'quoted' }]);
    expect(rejects('Abilities', phrase)).toBe(true);
  });

  it('G2: an unregistered keyword fails, also inside a list', () => {
    expect(rejects('Keyword', 'zzz')).toBe(true);
    expect(rejects('Abilities', 'flying and zzz')).toBe(true);
  });
});

describe('WP6 small holes', () => {
  it('Color (CR 105.1)', () => {
    expect(one('Color', 'red')).toBe('R');
    expect(one('Color', 'blue')).toBe('U');
    expect(rejects('Color', 'flurb')).toBe(true);
  });
  it('ManaCost (CR 107.4): one maximal run of symbols; {E}, {T} and {Q} are not part of a mana cost', () => {
    expect(one('ManaCost', '{2}{W}{W}')).toEqual([{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'W' }, { kind: 'colored', color: 'W' }]);
    expect(one('ManaCost', '{X}{R}')).toEqual([{ kind: 'variable', name: 'X' }, { kind: 'colored', color: 'R' }]);
    expect(one('ManaCost', '{W/U}{G/P}')).toEqual([{ kind: 'hybrid', colors: ['W', 'U'] }, { kind: 'phyrexian', color: 'G' }]);
    expect(rejects('ManaCost', '{E}')).toBe(true);
    expect(rejects('ManaCost', '{T}')).toBe(true);
    expect(runHole('ManaCost', toks('{1}{G}'), 0, ENV)).toHaveLength(1);
  });
  it('PT: signed power/toughness changes (CR 613.4c); an unsigned P/T is not a modification', () => {
    expect(one('PT', '+2/+2')).toEqual({ p: 2, t: 2 });
    expect(one('PT', '-1/-1')).toEqual({ p: -1, t: -1 });
    expect(one('PT', '+1/-1')).toEqual({ p: 1, t: -1 });
    expect(one('PT', '+X/+X')).toEqual({ p: { q: 'X' }, t: { q: 'X' } });
    expect(one('PT', '+2/-X')).toEqual({ p: 2, t: { q: 'math', op: '*', args: [-1, { q: 'X' }] } });
    expect(rejects('PT', '3/3')).toBe(true);
  });
  it('CounterKind: a word before "counter(s)" only; unlisted words are weak', () => {
    const k = (text: string): { v: unknown; weak?: number }[] => runHole('CounterKind', toks(text), 0, ENV).map((a) => ({ v: a.value, ...(a.weak ? { weak: a.weak } : {}) }));
    expect(k('+1/+1 counter')).toEqual([{ v: '+1/+1' }]);
    expect(k('charge counters')).toEqual([{ v: 'charge' }]);
    expect(k('zzz counter')).toEqual([{ v: 'zzz', weak: 1 }]);
    expect(k('zzz creature')).toEqual([]);
    expect(k('+1/+1')).toEqual([]);
  });
  it('Name: an open class, weak, restricted to the card-name index when there is one', () => {
    expect(one('Name', 'Zzz Qqq')).toBe('Zzz Qqq');
    expect(full('Name', 'Zzz')[0]!.weak).toBe(1);
    const withNames: HoleEnv = { ...ENV, cardNames: new Set(['Real Card']) };
    expect(one('Name', 'Real Card', withNames)).toBe('Real Card');
    expect(rejects('Name', 'Zzz', withNames)).toBe(true);
  });
  it('ChoiceKind', () => {
    expect(one('ChoiceKind', 'creature type')).toBe('creatureType');
    expect(one('ChoiceKind', 'color')).toBe('color');
    expect(one('ChoiceKind', 'odd or even')).toBe('oddEven');
    expect(rejects('ChoiceKind', 'zzz')).toBe(true);
  });
});

describe('WP6 token contract: lex and adaptTokens produce the shape the grammars read', () => {
  it('lex: possessives split, contractions stay, mana symbols are one token each, P/T and signed numbers are single tokens, quotes nest', () => {
    const t = lex("creature's {T} {2}{W} +1/+1 -2 it's don't \"Draw a card.\"");
    expect(t.map((x) => `${x.kind}:${x.norm}`)).toEqual([
      'WORD:creature', "WORD:'s", 'TAP:{t}', 'MANA:{2}', 'MANA:{w}', 'PT:+1/+1', 'MOD:-2', "WORD:it's", "WORD:don't", 'QUOTE:"draw a card."',
    ]);
    expect(t[t.length - 1]!.sub!.map((x) => x.norm)).toEqual(['draw', 'a', 'card', '.']);
  });
  it('lex: the possessive after ~ and the plural possessive, and "Ward--Pay" is three tokens', () => {
    expect(lex("~'s power").map((x) => x.norm)).toEqual(['~', "'s", 'power']);
    expect(lex("opponents' graveyards").map((x) => x.norm)).toEqual(['opponents', "'", 'graveyards']);
    expect(lex('Ward--Pay 3 life').map((x) => x.norm)).toEqual(['ward', '--', 'pay', '3', 'life']);
  });
  it('adaptTokens fills norm, splits possessives and defaults offsets', () => {
    const t = adaptTokens([{ kind: 'WORD', text: 'Creature’s' }, { kind: 'WORD', text: 'Power' }, { kind: 'MANA', text: '{W}' }, { kind: 'TAP', text: '{T}' }]);
    expect(t.map((x) => `${x.kind}:${x.norm}`)).toEqual(['WORD:creature', "WORD:'s", 'WORD:power', 'MANA:{w}', 'TAP:{t}']);
    expect(one('Qty', 'its power')).toBeTruthy();
  });
});
