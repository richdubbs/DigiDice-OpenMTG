/**
 * WP18: cards/pack.ts, loading and validating pack and LLM-cache entries (design 11.4, 11.5, 12.5). An entry is validated before it is used and never
 * executed; a bad entry is a reported problem, never an exception.
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_MODEL_VERSION, compileCard, hydrateEntryFace, isHighRisk, loadEntries, readCompiledEntry, stripAbility, textHash, trusted, unusableReason,
  type CompiledCardEntry,
} from '../../../src/index';
import { card } from './helpers';

const stored = stripAbility(compileCard(card('Draw a card.')).faces[0]!.abilities[0]!);
const HASH = textHash(['Draw a card.']);
const good = (): CompiledCardEntry => ({ oracleId: 'o-1', textHash: HASH, modelVersion: ABILITY_MODEL_VERSION, faces: [{ abilities: [{ ...stored, src: [0] }] }], review: 'reviewed', source: 'llm', flags: [] });

describe('readCompiledEntry: shape, hash, version, schema and lint of every stored ability', () => {
  it('design 11.4: accepts a well-formed entry and copies it', () => {
    const r = readCompiledEntry(good());
    expect('entry' in r && r.entry).toEqual(good());
  });

  const bad: [string, unknown, RegExp][] = [
    ['not an object', 42, /not an object/],
    ['no oracleId', { ...good(), oracleId: '' }, /oracleId/],
    ['a hash that is not SHA-256 hex', { ...good(), textHash: 'abc' }, /textHash/],
    ['a model version that is not a positive integer', { ...good(), modelVersion: 0 }, /modelVersion/],
    ['an unknown review state', { ...good(), review: 'maybe' }, /review/],
    ['an unknown source', { ...good(), source: 'web' }, /source/],
    ['flags that are not strings', { ...good(), flags: [1] }, /flags/],
    ['no faces', { ...good(), faces: [] }, /faces/],
    ['a face without abilities', { ...good(), faces: [{}] }, /abilities/],
    ['covers that are not {line, sentence}', { ...good(), faces: [{ abilities: [], covers: [{ line: 'x' }] }] }, /covers/],
    ['an op the model does not have (schema)', { ...good(), faces: [{ abilities: [{ kind: 'spell', src: [0], effect: { targets: [], steps: [{ op: 'win' }] } }] }] }, /schema/],
    ['a lint error (unbound reference)', { ...good(), faces: [{ abilities: [{ kind: 'spell', src: [0], effect: { targets: [], steps: [{ op: 'destroy', what: { ref: 'target', id: 't9' } }] } }] }] }, /ability 0/],
  ];
  it.each(bad)('design 11.3 steps 1-3: rejects %s with a problem, never an exception', (_name, value, why) => {
    const r = readCompiledEntry(value);
    expect('problem' in r).toBe(true);
    if ('problem' in r) expect(r.problem.reason).toMatch(why);
  });

  it('design 12.5: an entry for a newer model version is kept unvalidated (the pipeline lists it in requiresEngine and never uses it)', () => {
    const r = readCompiledEntry({ ...good(), modelVersion: ABILITY_MODEL_VERSION + 1, faces: [{ abilities: [{ kind: 'future', whatever: true }] }] });
    expect('entry' in r).toBe(true);
  });
});

describe('loadEntries', () => {
  it('design 12.5: reads an array or a pack\'s `cards` object, keys by oracle_id, reports the problems', () => {
    const a = good();
    const b = { ...good(), oracleId: 'o-2' };
    const fromArray = loadEntries([a, b, { nonsense: true }, null]);
    expect([...fromArray.entries.keys()]).toEqual(['o-1', 'o-2']);
    expect(fromArray.problems).toHaveLength(2);
    const fromPack = loadEntries({ 'o-1': a, 'o-2': { ...b, textHash: 'nope' } });
    expect([...fromPack.entries.keys()]).toEqual(['o-1']);
    expect(fromPack.problems).toEqual([{ oracleId: 'o-2', reason: expect.stringMatching(/textHash/) }]);
  });
});

describe('design 11.5: the trust policy', () => {
  const e = (over: Partial<CompiledCardEntry>): CompiledCardEntry => ({ ...good(), ...over });
  it('design 11.5: LLM-cache entries follow the llmTrust setting (off: none; reviewed: reviewed only; autoverified: also autoverified without high risk)', () => {
    expect(trusted(e({ review: 'reviewed' }), 'off', 'llm')).toBe(false);
    expect(trusted(e({ review: 'reviewed' }), 'reviewed', 'llm')).toBe(true);
    expect(trusted(e({ review: 'autoverified' }), 'reviewed', 'llm')).toBe(false);
    expect(trusted(e({ review: 'autoverified' }), 'autoverified', 'llm')).toBe(true);
    expect(trusted(e({ review: 'autoverified', flags: ['highRisk:layers'] }), 'autoverified', 'llm')).toBe(false);
    expect(trusted(e({ review: 'unreviewed' }), 'autoverified', 'llm')).toBe(false);
    expect(trusted(e({ review: 'rejected' }), 'autoverified', 'llm')).toBe(false);
  });
  it('design 11.5, 12.5: pack entries: hand data is trusted unless rejected; LLM data in a pack follows the player\'s llmTrust setting like the LLM cache', () => {
    expect(trusted(e({ source: 'hand', review: 'unreviewed' }), 'off', 'pack')).toBe(true);
    expect(trusted(e({ source: 'hand', review: 'rejected' }), 'off', 'pack')).toBe(false);
    expect(trusted(e({ source: 'llm', review: 'reviewed' }), 'off', 'pack')).toBe(false);
    expect(trusted(e({ source: 'llm', review: 'reviewed' }), 'reviewed', 'pack')).toBe(true);
    expect(trusted(e({ source: 'llm', review: 'autoverified' }), 'reviewed', 'pack')).toBe(false);
    expect(trusted(e({ source: 'llm', review: 'autoverified' }), 'autoverified', 'pack')).toBe(true);
    expect(trusted(e({ source: 'llm', review: 'unreviewed' }), 'autoverified', 'pack')).toBe(false);
  });
  it('isHighRisk reads the highRisk:* flags of design 11.3 step 9', () => {
    expect(isHighRisk(['usesManual', 'highRisk:copy'])).toBe(true);
    expect(isHighRisk(['usesManual'])).toBe(false);
  });
  it('design 11.4, 11.5: unusableReason: hash before model before faces before trust', () => {
    expect(unusableReason(good(), HASH, 1, 'reviewed', 'llm')).toBeNull();
    expect(unusableReason(good(), textHash(['other']), 1, 'reviewed', 'llm')).toBe('hash');
    expect(unusableReason({ ...good(), modelVersion: 99 }, HASH, 1, 'reviewed', 'llm')).toBe('model');
    expect(unusableReason(good(), HASH, 2, 'reviewed', 'llm')).toBe('faces');
    expect(unusableReason(good(), HASH, 1, 'off', 'llm')).toBe('trust');
  });
});

describe('hydrateEntryFace (design 11.4): text comes back from the player\'s own lines, or the face is discarded', () => {
  const lines = { lines: ['Draw a card.'], sentences: [['Draw a card.']] };
  it('design 11.4: restores the display text from the player\'s own lines', () => {
    expect(hydrateEntryFace(good(), 0, lines, HASH)).toMatchObject([{ kind: 'spell', text: 'Draw a card.' }]);
  });
  it('design 11.4: refuses another wording (errata), a missing face, and a src outside the lines', () => {
    expect(hydrateEntryFace(good(), 0, lines, textHash(['Draw two cards.']))).toBeNull();
    expect(hydrateEntryFace(good(), 1, lines, HASH)).toBeNull();
    expect(hydrateEntryFace({ ...good(), faces: [{ abilities: [{ ...stored, src: [3] }] }] }, 0, lines, HASH)).toBeNull();
  });
});
