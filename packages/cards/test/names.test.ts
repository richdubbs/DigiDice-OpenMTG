import { describe, expect, it } from 'vitest';
import { getTokens, loadFixtureCards } from '../../engine/test/fixtures';
import { CardDatabase } from '../src/database';
import { normalizeName } from '../src/normalize';
import { card } from './helpers';

const fixtureDb = (extra: ReturnType<typeof card>[] = []) =>
  CardDatabase.fromCards([...Object.values(loadFixtureCards()), ...extra], { tokens: [...getTokens('Spirit'), ...getTokens('Soldier')] });

describe('name normalization', () => {
  it('folds case, whitespace, diacritics, quotes and dashes', () => {
    expect(normalizeName("  Lim-Dûl's   Vault ")).toBe("lim-dul's vault");
    expect(normalizeName('Lim-Dûl’s Vault')).toBe("lim-dul's vault");
    expect(normalizeName('Æther Vial')).toBe('aether vial');
    expect(normalizeName('Jötun Grunt')).toBe('jotun grunt');
    expect(normalizeName('Fire//Ice')).toBe('fire // ice');
    expect(normalizeName('Fire  //  Ice')).toBe('fire // ice');
    expect(normalizeName('Sol–Ring')).toBe('sol-ring');
  });

  it('looks up diacritic names with plain ASCII input', () => {
    const db = CardDatabase.fromCards([card("Lim-Dûl's Vault"), card('Æther Vial')]);
    expect(db.lookup("lim-dul's vault")?.name).toBe("Lim-Dûl's Vault");
    expect(db.lookup('LIM-DUL’S VAULT')?.name).toBe("Lim-Dûl's Vault");
    expect(db.lookup('aether vial')?.name).toBe('Æther Vial');
  });
});

describe('lookup against the engine fixture', () => {
  const db = fixtureDb();

  it('finds cards case-insensitively', () => {
    expect(db.lookup('lightning bolt')?.name).toBe('Lightning Bolt');
    expect(db.has('  LIGHTNING   BOLT ')).toBe(true);
    expect(db.has('Lightning Blot')).toBe(false);
  });

  it('resolves front-face and every-face aliases of multi-faced cards', () => {
    expect(db.lookup('Fire')?.name).toBe('Fire // Ice');
    expect(db.lookup('Ice')?.name).toBe('Fire // Ice');
    expect(db.lookup('Delver of Secrets')?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(db.lookup('Insectile Aberration')?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(db.lookup('Bonecrusher Giant')?.name).toBe('Bonecrusher Giant // Stomp');
    expect(db.lookup('Stomp')?.name).toBe('Bonecrusher Giant // Stomp');
  });

  it('accepts split cards written with one slash or no spaces', () => {
    expect(db.lookup('Fire // Ice')?.name).toBe('Fire // Ice');
    expect(db.lookup('fire/ice')?.name).toBe('Fire // Ice');
    expect(db.lookup('Fire / Ice')?.name).toBe('Fire // Ice');
  });

  it('lets a full name win over a face alias, whatever the insertion order', () => {
    const own = card('Fire');
    const withOwn = fixtureDb([own]);
    expect(withOwn.lookup('Fire')).toBe(own);
    expect(withOwn.lookup('Ice')?.name).toBe('Fire // Ice');
    const reversed = CardDatabase.fromCards([own, ...Object.values(loadFixtureCards())]);
    expect(reversed.lookup('Fire')).toBe(own);
  });

  it('keeps all token variants under one name', () => {
    expect(db.lookupTokens('spirit').length).toBeGreaterThan(1);
    expect(db.lookupTokens('Soldier')).toEqual(getTokens('Soldier')); // every Soldier variant under the one name: the 1/1 white one and Firebender Ascension's 2/2 red one with firebending 1
    expect(db.lookupTokens('Nonexistent token')).toEqual([]);
    expect(db.has('Soldier')).toBe(false); // tokens are not game cards
  });

  it('suggests close names from the local index only', () => {
    expect(db.suggest('Lightening Bolt')[0]).toBe('Lightning Bolt');
    expect(db.suggest('Serra Angle')[0]).toBe('Serra Angel');
    expect(db.suggest('Light')).toContain('Lightning Bolt');
    expect(db.suggest('Delver')).toContain('Delver of Secrets // Insectile Aberration');
    expect(db.suggest('zzzzzzzz qqqq')).toEqual([]);
    expect(db.suggest('Fireball', 5)).toContain('Fireball');
  });
});

describe('resolveDecklist (offline)', () => {
  it('resolves, merges duplicates, reports unknown names with suggestions and parse errors', async () => {
    const db = fixtureDb();
    const r = await db.resolveDecklist(
      ['4 Lightning Bolt (M10) 146', '4 Mountain', '2 Lightning Bolt', '1 Delver of Secrets', '1 Fire // Ice', '2 Lightening Bolt', '0 Fog', '', '2 Disenchant'].join('\n'),
    );
    expect(r.main.map((e) => [e.count, e.card.name])).toEqual([
      [6, 'Lightning Bolt'],
      [4, 'Mountain'],
      [1, 'Delver of Secrets // Insectile Aberration'],
      [1, 'Fire // Ice'],
    ]);
    expect(r.sideboard.map((e) => [e.count, e.card.name])).toEqual([[2, 'Disenchant']]);
    expect(r.unknown).toEqual([{ name: 'Lightening Bolt', line: 6, section: 'main', suggestions: expect.arrayContaining(['Lightning Bolt']) }]);
    expect(r.errors.map((e) => e.line)).toEqual([7]);
    expect(r.fetchError).toBeUndefined();
  });
});
