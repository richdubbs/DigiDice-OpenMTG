/**
 * WP6: the 60 most frequent target phrases of the corpus (docs/design/m5-corpus-analysis.md section 8.1) parse to the expected filters, and the quantifier
 * forms of section 8.2 parse to the expected counts (CR 115.1, 601.2c). Placeholders of the corpus table are replaced by invented words: SUBTYPE is
 * "Goblin", COLOR is "red", N is a number. Phrases that the table cuts out of a larger construction are tested in that construction and said so.
 */
import { describe, expect, it } from 'vitest';
import type { HoleType } from '../../../src/parser/types';
import { canonicalJson } from '../../../src/parser/holes';
import { full, one, rejects, target } from './env';

type Spec = Record<string, unknown>;
const creature = { types: ['Creature'] };

interface Row { n: number; phrase: string; hole?: HoleType; spec: Spec }
/** `phrase` is also the `text` of the spec. */
const rows: Row[] = [
  { n: 1, phrase: 'target creature', spec: { kind: 'object', filter: creature, min: 1, max: 1 } },
  { n: 2, phrase: 'target creature you control', spec: { kind: 'object', filter: { ...creature, controller: 'you' }, min: 1, max: 1 } },
  { n: 3, phrase: 'any target', hole: 'Recipient', spec: { kind: 'anyTarget', min: 1, max: 1 } },
  { n: 4, phrase: 'target player', hole: 'Player', spec: { kind: 'player', players: { who: 'any' }, min: 1, max: 1 } },
  { n: 5, phrase: 'target opponent', hole: 'Player', spec: { kind: 'player', players: { who: 'opponent' }, min: 1, max: 1 } },
  { n: 6, phrase: 'target creature an opponent controls', spec: { kind: 'object', filter: { ...creature, controller: 'opponent' }, min: 1, max: 1 } },
  { n: 7, phrase: 'target creature card', spec: { kind: 'object', filter: { ...creature, isCard: true }, min: 1, max: 1 } },
  { n: 9, phrase: 'target spell', spec: { kind: 'spell', min: 1, max: 1 } },
  { n: 10, phrase: 'target artifact', spec: { kind: 'object', filter: { types: ['Artifact'] }, min: 1, max: 1 } },
  { n: 11, phrase: 'target permanent', spec: { kind: 'object', min: 1, max: 1 } },
  { n: 12, phrase: 'target card', spec: { kind: 'object', filter: { isCard: true }, min: 1, max: 1 } },
  { n: 13, phrase: 'target creature or planeswalker', spec: { kind: 'object', filter: { types: ['Creature', 'Planeswalker'] }, min: 1, max: 1 } },
  { n: 14, phrase: 'target land', spec: { kind: 'object', filter: { types: ['Land'] }, min: 1, max: 1 } },
  { n: 15, phrase: 'target nonland permanent', spec: { kind: 'object', filter: { notTypes: ['Land'] }, min: 1, max: 1 } },
  { n: 16, phrase: 'target attacking creature', spec: { kind: 'object', filter: { ...creature, attacking: true }, min: 1, max: 1 } },
  { n: 17, phrase: 'target Goblin', spec: { kind: 'object', filter: { subtypes: ['Goblin'] }, min: 1, max: 1 } },
  { n: 18, phrase: 'target artifact or enchantment', spec: { kind: 'object', filter: { types: ['Artifact', 'Enchantment'] }, min: 1, max: 1 } },
  { n: 19, phrase: 'target player or planeswalker', hole: 'Recipient', spec: { kind: 'objectOrPlayer', filter: { types: ['Planeswalker'] }, players: { who: 'any' }, min: 1, max: 1 } },
  { n: 20, phrase: "target creature you don't control", spec: { kind: 'object', filter: { ...creature, not: { controller: 'you' } }, min: 1, max: 1 } },
  { n: 21, phrase: 'target Goblin you control', spec: { kind: 'object', filter: { subtypes: ['Goblin'], controller: 'you' }, min: 1, max: 1 } },
  { n: 22, phrase: 'target enchantment', spec: { kind: 'object', filter: { types: ['Enchantment'] }, min: 1, max: 1 } },
  { n: 23, phrase: 'target instant or sorcery card', spec: { kind: 'object', filter: { types: ['Instant', 'Sorcery'], isCard: true }, min: 1, max: 1 } },
  { n: 24, phrase: 'target attacking or blocking creature', spec: { kind: 'object', filter: { ...creature, anyOf: [{ attacking: true }, { blocking: true }] }, min: 1, max: 1 } },
  { n: 25, phrase: 'target creature with flying', spec: { kind: 'object', filter: { ...creature, keyword: 'flying' }, min: 1, max: 1 } },
  { n: 28, phrase: 'target artifact or creature', spec: { kind: 'object', filter: { types: ['Artifact', 'Creature'] }, min: 1, max: 1 } },
  { n: 29, phrase: 'target creature that player controls', spec: { kind: 'object', filter: { ...creature, controller: { ref: 'bound', name: '', $anaphor: { sort: 'player', number: 'singular', head: 'player', text: 'that player' } } }, min: 1, max: 1 } },
  { n: 32, phrase: 'target permanent you control', spec: { kind: 'object', filter: { controller: 'you' }, min: 1, max: 1 } },
  { n: 33, phrase: 'target Goblin card', spec: { kind: 'object', filter: { subtypes: ['Goblin'], isCard: true }, min: 1, max: 1 } },
  { n: 34, phrase: 'target creature card with mana value 3 or less', spec: { kind: 'object', filter: { ...creature, isCard: true, manaValue: { op: '<=', value: 3 } }, min: 1, max: 1 } },
  { n: 35, phrase: 'target nonblack creature', spec: { kind: 'object', filter: { ...creature, notColors: ['B'] }, min: 1, max: 1 } },
  { n: 37, phrase: 'target artifact card', spec: { kind: 'object', filter: { types: ['Artifact'], isCard: true }, min: 1, max: 1 } },
  { n: 38, phrase: 'target nonland permanent an opponent controls', spec: { kind: 'object', filter: { notTypes: ['Land'], controller: 'opponent' }, min: 1, max: 1 } },
  { n: 39, phrase: 'target creature defending player controls', spec: { kind: 'object', filter: { ...creature, controller: { ref: 'defending' } }, min: 1, max: 1 } },
  { n: 40, phrase: 'target tapped creature', spec: { kind: 'object', filter: { ...creature, tapped: true }, min: 1, max: 1 } },
  { n: 41, phrase: 'target Goblin creature', spec: { kind: 'object', filter: { ...creature, subtypes: ['Goblin'] }, min: 1, max: 1 } },
  { n: 42, phrase: 'target land you control', spec: { kind: 'object', filter: { types: ['Land'], controller: 'you' }, min: 1, max: 1 } },
  { n: 43, phrase: 'target creature with power 3 or less', spec: { kind: 'object', filter: { ...creature, power: { op: '<=', value: 3 } }, min: 1, max: 1 } },
  { n: 44, phrase: 'target instant or sorcery spell', spec: { kind: 'spell', filter: { types: ['Instant', 'Sorcery'] }, min: 1, max: 1 } },
  { n: 46, phrase: 'target opponent or planeswalker', hole: 'Recipient', spec: { kind: 'objectOrPlayer', filter: { types: ['Planeswalker'] }, players: { who: 'opponent' }, min: 1, max: 1 } },
  { n: 47, phrase: 'target creature with power 3 or greater', spec: { kind: 'object', filter: { ...creature, power: { op: '>=', value: 3 } }, min: 1, max: 1 } },
  { n: 49, phrase: 'target red creature', spec: { kind: 'object', filter: { ...creature, colors: ['R'] }, min: 1, max: 1 } },
  { n: 50, phrase: 'target permanent card', spec: { kind: 'object', filter: { types: ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'], isCard: true }, min: 1, max: 1 } },
  { n: 54, phrase: 'target noncreature spell', spec: { kind: 'spell', filter: { notTypes: ['Creature'] }, min: 1, max: 1 } },
  { n: 56, phrase: 'target creature or planeswalker an opponent controls', spec: { kind: 'object', filter: { types: ['Creature', 'Planeswalker'], controller: 'opponent' }, min: 1, max: 1 } },
  { n: 57, phrase: 'target artifact you control', spec: { kind: 'object', filter: { types: ['Artifact'], controller: 'you' }, min: 1, max: 1 } },
  { n: 58, phrase: 'target creature spell', spec: { kind: 'spell', filter: creature, min: 1, max: 1 } },
  { n: 59, phrase: 'target land card', spec: { kind: 'object', filter: { types: ['Land'], isCard: true }, min: 1, max: 1 } },
];

describe('WP6 the top 60 target phrases of the corpus (analysis 8.1)', () => {
  for (const r of rows) {
    it(`#${r.n} "${r.phrase}" parses to the expected target phrase`, () => {
      expect(one(r.hole ?? 'Objs', r.phrase)).toEqual(target({ ...r.spec, text: r.phrase }));
    });
  }

  // phrases of the table that are quantified or are fragments of a larger construction in the corpus
  it('#8 "target creatures" is "two target creatures" / "up to two ..." / "any number of ..." (CR 115.1: the count is stated)', () => {
    expect(one('Objs', 'two target creatures')).toEqual(target({ kind: 'object', filter: creature, min: 2, max: 2, text: 'two target creatures' }));
    expect(one('Objs', 'up to two target creatures')).toEqual(target({ kind: 'object', filter: creature, min: 0, max: 2, text: 'up to two target creatures' }));
    expect(one('Objs', 'any number of target creatures')).toEqual(target({ kind: 'object', filter: creature, min: 0, max: 'any', text: 'any number of target creatures' }));
    expect(rejects('Objs', 'target creatures')).toBe(true); // no count: not a legal phrase
  });
  it('#27 #30 #31 #53 #60 plural forms: cards, creature cards, creatures you control, artifacts, players', () => {
    expect(one('Objs', 'two target cards')).toEqual(target({ kind: 'object', filter: { isCard: true }, min: 2, max: 2, text: 'two target cards' }));
    expect(one('Objs', 'up to three target creature cards')).toEqual(target({ kind: 'object', filter: { ...creature, isCard: true }, min: 0, max: 3, text: 'up to three target creature cards' }));
    expect(one('Objs', 'up to two target creatures you control')).toEqual(target({ kind: 'object', filter: { ...creature, controller: 'you' }, min: 0, max: 2, text: 'up to two target creatures you control' }));
    expect(one('Objs', 'two target artifacts')).toEqual(target({ kind: 'object', filter: { types: ['Artifact'] }, min: 2, max: 2, text: 'two target artifacts' }));
    expect(one('Player', 'two target players')).toEqual(target({ kind: 'player', players: { who: 'any' }, min: 2, max: 2, text: 'two target players' }));
  });
  it('#26 #45 "target player controls" / "target opponent controls" are post-modifiers with the target as controller', () => {
    expect(one('Objs', 'creatures target player controls')).toEqual({
      ref: 'each', filter: { ...creature, controller: target({ kind: 'player', players: { who: 'any' }, min: 1, max: 1, text: 'target player' }) },
    });
    expect(one('Objs', 'lands target opponent controls')).toEqual({
      ref: 'each', filter: { types: ['Land'], controller: target({ kind: 'player', players: { who: 'opponent' }, min: 1, max: 1, text: 'target opponent' }) },
    });
  });
  it("#48 #51 #52 \"target opponent's library\", \"target player's graveyard\", \"target player's library\" are zones with a target owner", () => {
    const tp = target({ kind: 'player', players: { who: 'any' }, min: 1, max: 1, text: 'target player' });
    expect(one('Zone', "target player's graveyard")).toEqual({ zone: 'graveyard', owner: tp });
    expect(one('Zone', "target player's library")).toEqual({ zone: 'library', owner: tp });
    expect(one('Zone', "target opponent's library")).toEqual({ zone: 'library', owner: target({ kind: 'player', players: { who: 'opponent' }, min: 1, max: 1, text: 'target opponent' }) });
  });
  it('#36 #55 "target of a spell or ability" is the event "becomes the target of ..." (with "an opponent controls")', () => {
    expect(one('Event', '~ becomes the target of a spell or ability')).toEqual([{ ev: 'becomes', what: 'targeted', object: { self: true } }]);
    expect(one('Event', '~ becomes the target of a spell or ability an opponent controls')).toEqual([{ ev: 'becomes', what: 'targeted', object: { self: true }, by: { controller: 'opponent' } }]);
  });
  it('the 60 phrases are covered: 49 table rows here plus the grouped tests above', () => {
    const covered = new Set(rows.map((r) => r.n));
    for (const n of [8, 27, 30, 31, 53, 60, 26, 45, 48, 51, 52, 36, 55]) covered.add(n);
    for (let n = 1; n <= 60; n++) expect(covered.has(n), `#${n} is tested`).toBe(true);
  });
});

describe('WP6 quantifier forms before "target" (analysis 8.2)', () => {
  const t = (text: string, min: unknown, max: unknown, extra: Spec = {}): unknown => target({ kind: 'object', filter: creature, min, max, text, ...extra });
  it.each([
    ['up to one target creature', 0, 1, {}],
    ['another target creature', 1, 1, { another: true }],
    ['up to two target creatures', 0, 2, {}],
    ['any number of target creatures', 0, 'any', {}],
    ['up to one other target creature', 0, 1, { another: true }],
    ['two target creatures', 2, 2, {}],
    ['up to three target creatures', 0, 3, {}],
    ['one or two target creatures', 1, 2, {}],
    ['up to X target creatures', 0, { q: 'X' }, {}],
    ['three target creatures', 3, 3, {}],
    ['one or more target creatures', 1, 'any', {}],
    ['up to two other target creatures', 0, 2, { another: true }],
    ['any number of other target creatures', 0, 'any', { another: true }],
    ['two other target creatures', 2, 2, { another: true }],
  ] as [string, unknown, unknown, Spec][])('"%s"', (phrase, min, max, extra) => {
    expect(one('Objs', phrase)).toEqual(t(phrase, min, max, extra));
  });
  it('singular and plural must agree with the determiner', () => {
    expect(rejects('Objs', 'two target creature')).toBe(true);
    expect(rejects('Objs', 'up to one target creatures')).toBe(true);
  });
});

describe('WP6 unions of target phrases', () => {
  it('"target artifact and target creature" is a union of two phrases (two specs, CR 115.3)', () => {
    const alts = full('Objs', 'target artifact and target creature');
    expect(alts).toHaveLength(1);
    const v = alts[0]!.value as { ref: string; of: unknown[] };
    expect(v.ref).toBe('union');
    expect(v.of).toHaveLength(2);
  });
  it('is deterministic: the same phrase gives the same canonical JSON twice', () => {
    expect(canonicalJson(one('Objs', 'target creature you control'))).toBe(canonicalJson(one('Objs', 'target creature you control')));
  });
});
