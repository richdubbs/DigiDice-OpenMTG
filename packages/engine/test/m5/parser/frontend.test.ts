/**
 * WP5, the front end as a whole: face contexts of every layout, purity and determinism (the parser is pure, design 6.13), diagnostics, and a few golden token
 * streams. Synthetic wording only (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { faceContexts, ledgerProblems, preprocessFace, typeWords } from '../../../src/parser/preprocess';
import { frontEnd, segmentFace } from '../../../src/parser/segment';
import { tokenNorms, tokenize } from '../../../src/parser/tokenize';
import { GENERATED_LEXICON } from '../../../src/parser/front/lexicon-index';
import { getCard, loadFixtureCards } from '../../fixtures';
import { face, oracle, segment } from './support';

describe('faceContexts: one context per rules face (the layouts of cards/compile.ts)', () => {
  it('a normal card is one face, with types, supertypes and subtypes from its type line', () => {
    const [c] = faceContexts(getCard('Isamaru, Hound of Konda'));
    expect(c).toMatchObject({ name: 'Isamaru, Hound of Konda', types: ['creature'], supertypes: ['legendary'], subtypes: ['dog'], otherNames: [], isToken: false });
  });

  it('split, adventure, transform, flip and modal cards are several faces, each knowing the others\' names', () => {
    for (const [name, count] of [['Fire // Ice', 2], ['Bonecrusher Giant // Stomp', 2], ['Delver of Secrets // Insectile Aberration', 2], ['Akki Lavarunner // Tok-Tok, Volcano Born', 2], ["Agadeem's Awakening // Agadeem, the Undercrypt", 2]] as const) {
      const fs = faceContexts(getCard(name));
      expect(fs, name).toHaveLength(count);
      for (const f of fs) expect(f.otherNames, name).toEqual(fs.filter((o) => o !== f).map((o) => o.name));
    }
    const [fire, ice] = faceContexts(getCard('Fire // Ice'));
    expect(fire).toMatchObject({ name: 'Fire', types: ['instant'], layout: 'split' });
    expect(ice!.name).toBe('Ice');
  });

  it('the type line is read per face: a spell face of an adventure card is an instant (an Omen too)', () => {
    const [, stomp] = faceContexts(getCard('Bonecrusher Giant // Stomp'));
    expect(stomp).toMatchObject({ types: ['instant'], subtypes: ['adventure'] });
  });

  it('a type line with "Tribal" means kindred; "Basic Snow Land" has two supertypes', () => {
    expect(typeWords('Tribal Instant — Goblin', new Set(['basic']))).toMatchObject({ types: ['kindred', 'instant'], subtypes: ['goblin'] });
    expect(typeWords('Basic Snow Land — Forest', new Set(['basic', 'snow']))).toEqual({ types: ['land'], supertypes: ['basic', 'snow'], subtypes: ['forest'] });
    expect(typeWords('Instant', new Set())).toEqual({ types: ['instant'], supertypes: [], subtypes: [] });
  });

  it('tokens are flagged by layout or type line', () => {
    const t = faceContexts(oracle('token', [{ name: 'Spirit', type_line: 'Token Creature — Spirit', oracle_text: 'Flying' }]));
    expect(t[0]!.isToken).toBe(true);
  });

  it('a card without text has a face with empty text', () => {
    const [c] = faceContexts(getCard('Grizzly Bears'));
    expect(c!.text).toBe('');
  });
});

describe('the front end is pure and total', () => {
  it('a card without rules text has no abilities and an empty ledger', () => {
    const f = frontEnd(faceContexts(getCard('Grizzly Bears'))[0]!);
    expect(f.abilities).toEqual([]);
    expect(f.ledger).toEqual([]);
    expect(f.pre.lines.every((l) => l.blank)).toBe(true);
  });

  it('is deterministic: the same face gives deeply equal results, and the input is not mutated', () => {
    for (const card of Object.values(loadFixtureCards()).slice(0, 80)) {
      for (const ctx of faceContexts(card)) {
        const frozen = Object.freeze({ ...ctx, types: Object.freeze([...ctx.types]) as string[], subtypes: Object.freeze([...ctx.subtypes]) as string[], otherNames: Object.freeze([...ctx.otherNames]) as string[] });
        const a = frontEnd(frozen);
        const b = frontEnd(frozen);
        expect(JSON.stringify(a), ctx.name).toBe(JSON.stringify(b));
      }
    }
  });

  it('the result is plain JSON data (no classes, no functions, no undefined fields)', () => {
    const f = frontEnd(face('Test', 'Creature — Bear', 'Flying\nWhen ~ dies, draw a card.'));
    expect(JSON.parse(JSON.stringify(f))).toStrictEqual(f); // strict: a stray `undefined` field would not survive the round trip
    const g = frontEnd(face('Test', 'Planeswalker — Test', '+1: Draw a card.\n• Orphan\n1-9 | roll\nLEVEL 2-3\n4/4\nFlying (r)'));
    expect(JSON.parse(JSON.stringify(g))).toStrictEqual(g);
  });

  it('preprocess and segment can be run separately', () => {
    const ctx = face('Test', 'Creature — Bear', 'Flying (reminder)');
    const pre = preprocessFace(ctx);
    expect(segmentFace(pre).abilities[0]!.shape).toBe('keyword');
  });

  it('empty and whitespace-only text never throw', () => {
    for (const text of ['', ' ', '\n', '\n\n', '()', '(a)\n(b)', '"', '--', '•', '{', '~']) {
      const f = segment(face('Test', 'Creature — Bear', text));
      expect(ledgerProblems(f.pre.normalized, f.ledger), JSON.stringify(text)).toEqual([]);
    }
  });

  it('the default lexicon is the checked-in one; another lexicon can be passed', () => {
    const custom = { ...GENERATED_LEXICON, abilityWords: [...GENERATED_LEXICON.abilityWords, 'zorp'] };
    const text = 'Zorp — Whenever a land enters, draw.';
    expect(segment(face('T', 'Creature — Bear', text)).abilities[0]!.label?.kind).toBe('flavor-word');
    expect(segment(face('T', 'Creature — Bear', text), { lexicon: custom }).abilities[0]!.label?.kind).toBe('ability-word');
  });

  it('registry keywords (ParseOptions.keywords) extend the lexicon\'s keyword names', () => {
    const f = segment(face('T', 'Creature — Bear', 'Frobnicate {2}'), { keywords: [{ name: 'Frobnicate', aliases: [], params: ['cost'], reminder: '' }] });
    expect(f.abilities[0]!.shape).toBe('keyword');
    expect(f.abilities[0]!.keywordItems![0]!.name).toBe('Frobnicate');
    expect(segment(face('T', 'Creature — Bear', 'Frobnicate {2}')).abilities[0]!.shape).toBe('static');
  });
});

describe('diagnostics: what the front end could not read is said, never skipped (G2)', () => {
  it('an unknown character is a warning with its range, and the ability still exists as ordinary text', () => {
    const f = segment(face('T', 'Creature — Bear', 'Draw a card ☐ now.'));
    expect(f.diagnostics).toHaveLength(1);
    expect(f.diagnostics[0]).toMatchObject({ level: 'warning', code: 'unknown-word', message: 'unknown character U+2610' });
    expect(f.pre.normalized.slice(...f.diagnostics[0]!.range!)).toBe('☐');
    expect(f.abilities).toHaveLength(1);
  });

  it('an unmatched quote is reported once', () => {
    const f = segment(face('T', 'Instant', 'Target creature gains "flying until end of turn.'));
    expect(f.diagnostics.map((d) => d.message)).toEqual(['unmatched quote']);
  });

  it('an unknown symbol inside a quoted ability is found too', () => {
    const f = segment(face('T', 'Instant', 'Create a token with "{not a symbol}: Draw."'));
    expect(f.diagnostics.map((d) => d.message)).toEqual(['unknown symbol {not a symbol}']);
  });
});

describe('golden token streams (synthetic sentences)', () => {
  const ctx = (text: string) => frontEnd(face('Test Card', 'Instant', text));
  const sentenceNorms = (text: string): string[] => ctx(text).abilities.flatMap((a) => a.sentences.map((s) => tokenNorms(s.tokens)));

  it('a pump spell', () => {
    expect(sentenceNorms('Target creature gets +3/+3 and gains first strike until end of turn.')).toEqual(['target creature gets +3/+3 and gains first strike until end of turn .']);
  });

  it('a damage spell that names itself', () => {
    expect(sentenceNorms('Test Card deals X damage to target creature or planeswalker.')).toEqual(['~ deals X damage to target creature or planeswalker .']);
  });

  it('costs and symbols', () => {
    const f = frontEnd(face('Test Card', 'Artifact', '{2}{W/U}, {T}, Sacrifice ~: Add {C}{C}. Activate only as a sorcery.'));
    expect(tokenNorms(f.abilities[0]!.sentences[0]!.tokens)).toBe('2 W/U , T , sacrifice ~ : add C C .');
    expect(f.abilities[0]!.shape).toBe('activated');
  });

  it('a creature token description', () => {
    expect(sentenceNorms('Create a 1/1 white Spirit creature token with flying.')).toEqual(['create a 1/1 white spirit creature token with flying .']);
  });

  it('"nonblack", "non-Human" and number words', () => {
    expect(sentenceNorms('Destroy up to two target nonblack creatures that are non-Human.')).toEqual(['destroy up to two target non black creatures that are non human .']);
  });

  it('a quoted granted ability is one QUOTE token', () => {
    const t = ctx('Creatures you control gain "{T}: Add {G}." until end of turn.').abilities[0]!.sentences[0]!.tokens;
    expect(t.map((x) => x.kind)).toEqual(['WORD', 'WORD', 'WORD', 'WORD', 'QUOTE', 'WORD', 'WORD', 'WORD', 'WORD', 'PUNCT']);
    expect(t[4]!.sub!.map((x) => x.norm)).toEqual(['T', ':', 'add', 'G', '.']);
  });

  it('tokenize of a raw string needs no face', () => {
    expect(tokenNorms(tokenize('Draw two cards, then discard a card.'))).toBe('draw two cards , then discard a card .');
  });
});
