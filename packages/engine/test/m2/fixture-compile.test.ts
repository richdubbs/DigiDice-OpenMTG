import { describe, expect, it } from 'vitest';
import { compileCard } from '../../src/index';
import { compiledDef, fixtureCardNames, getCard, getTokens, getTokensFor, loadFixtureCards } from '../fixtures';
import fixtureFile from '../fixtures/cards.json';

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('milestone 2 fixture: generated Oracle data compiles', { timeout: 60_000 }, () => {
  it('compiles every fixture card with compileCard without throwing', () => {
    const names = fixtureCardNames();
    expect(names.length).toBeGreaterThan(100);
    for (const name of names) {
      const def = compileCard(getCard(name));
      expect(def.name, name).toBe(name);
      expect(def.faces.length, name).toBeGreaterThanOrEqual(1);
      for (const face of def.faces) expect(face.typeLine, `${name} / ${face.name}`).not.toBe('');
    }
  }, 120_000); // every fixture card is compiled: the set grows with every package, so the default 5 s is not enough on a busy machine

  it('is sorted by name and has unique names', () => {
    const names = fixtureCardNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('CR 709/710/712/715: multi-faced layouts produce the right number of faces (prepare behaves like adventure)', () => {
    const expectedFaces: Record<string, number> = { split: 2, transform: 2, modal_dfc: 2, adventure: 2, prepare: 2, flip: 2, meld: 1 };
    const seen = new Set<string>();
    for (const card of Object.values(loadFixtureCards())) {
      const want = expectedFaces[card.layout];
      if (want === undefined) continue;
      seen.add(card.layout);
      expect(compileCard(card).faces.length, `${card.name} (${card.layout})`).toBe(want);
    }
    expect([...seen].sort()).toEqual(Object.keys(expectedFaces).sort());
  });

  it('known cards compile to the expected shape', () => {
    expect(compiledDef('Fire // Ice').faces.map((f) => f.name)).toEqual(['Fire', 'Ice']);
    const delver = compiledDef('Delver of Secrets // Insectile Aberration');
    expect(delver.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
    expect(delver.faces[1]!.colorIndicator).toEqual(['U']);
    expect(compiledDef('Bonecrusher Giant // Stomp').faces.map((f) => f.name)).toEqual(['Bonecrusher Giant', 'Stomp']);
    const bruna = compiledDef('Bruna, the Fading Light');
    expect(bruna.meld).toEqual({ isResult: false, result: 'Brisela, Voice of Nightmares', partner: 'Gisela, the Broken Blade' });
    expect(compiledDef('Brisela, Voice of Nightmares').meld?.isResult).toBe(true);
    expect(compiledDef('Lightning Bolt').faces[0]!.manaCost).toEqual([{ kind: 'colored', color: 'R' }]);
    expect(compiledDef('Wastes').faces[0]!.manaCost).toBeNull();
  });

  it('gives every half of multi-faced cards the right colors, types and mana cost', () => {
    // CR 709.3: each split half has its own colors.
    const fireIce = compiledDef('Fire // Ice');
    expect(fireIce.faces.map((f) => f.colors)).toEqual([['R'], ['U']]);
    // CR 715: the adventure half is its own spell (an instant with the Adventure subtype); the creature half keeps its colors.
    const bonecrusher = compiledDef('Bonecrusher Giant // Stomp');
    expect(bonecrusher.faces[0]!.types).toEqual(['Creature']);
    expect(bonecrusher.faces[1]!.types).toEqual(['Instant']);
    expect(bonecrusher.faces[1]!.subtypes).toEqual(['Adventure']);
    expect(bonecrusher.faces.map((f) => f.colors)).toEqual([['R'], ['R']]);
    // CR 204: Dryad Arbor is a green Land Creature because of its color indicator, and has no mana cost.
    const arbor = compiledDef('Dryad Arbor');
    expect(arbor.faces[0]!.types).toEqual(['Land', 'Creature']);
    expect(arbor.faces[0]!.subtypes).toEqual(['Forest', 'Dryad']);
    expect(arbor.faces[0]!.colors).toEqual(['G']);
    expect(arbor.faces[0]!.colorIndicator).toEqual(['G']);
    expect(arbor.faces[0]!.manaCost).toBeNull();
    // CR 204: the back face has a blue color indicator; the front face is blue from its mana cost.
    expect(compiledDef('Delver of Secrets // Insectile Aberration').faces.map((f) => f.colors)).toEqual([['U'], ['U']]);
  });

  it('CR 710.1c: the flipped half of a flip card keeps the color and mana cost of the card', () => {
    const tokTok = compiledDef('Akki Lavarunner // Tok-Tok, Volcano Born');
    expect(tokTok.faces.map((f) => f.colors)).toEqual([['R'], ['R']]);
    expect(tokTok.faces[1]!.manaCost).toEqual(tokTok.faces[0]!.manaCost);
    expect(tokTok.faces[1]!.manaCost).not.toBeNull();
    const kenzo = compiledDef('Bushi Tenderfoot // Kenzo the Hardhearted');
    expect(kenzo.faces.map((f) => f.colors)).toEqual([['W'], ['W']]);
    expect(kenzo.faces[1]!.manaCost).toEqual(kenzo.faces[0]!.manaCost);
  });

  it('keeps token names and the matching token objects', () => {
    expect(compiledDef('Raise the Alarm').tokenNames).toEqual(['Soldier']);
    expect(getTokens('Soldier')[0]?.type_line).toBe('Token Creature — Soldier');
    // Token names are not unique: several Spirit tokens exist.
    expect(getTokens('Spirit').length).toBeGreaterThan(1);
  });

  it('picks the token variant a card actually creates', () => {
    const doomed = getTokensFor('Doomed Traveler');
    expect(doomed).toHaveLength(1);
    expect(doomed[0]).toMatchObject({ type_line: 'Token Creature — Spirit', power: '1', toughness: '1', colors: ['W'], keywords: ['Flying'] });
    const scholar = getTokensFor('Strife Scholar // Awaken the Ages');
    expect(scholar).toHaveLength(1);
    expect(scholar[0]!.colors).toEqual(['R', 'W']);
    expect(scholar[0]!.power).toBe('2');
    expect(compiledDef('Doomed Traveler').tokenNames).toEqual(['Spirit']);
  });

  it('contains only rules fields (no images, prices or flavor)', () => {
    const allowed = new Set(['oracle_id', 'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'colors', 'color_indicator', 'keywords', 'produced_mana', 'card_faces', 'all_parts', 'color_identity' /* M11-4: Commander identity, CR 903.4, m11 design D5 */]);
    for (const card of Object.values(loadFixtureCards())) {
      for (const key of Object.keys(card)) expect(allowed.has(key), `${card.name}: ${key}`).toBe(true);
      for (const face of card.card_faces ?? []) expect(face).not.toHaveProperty('image_uris');
    }
    // The same check for the token variants: only rules fields (plus their creators' names).
    const tokens = (fixtureFile as { tokens: Array<Record<string, unknown>> }).tokens;
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      for (const key of Object.keys(token)) expect(allowed.has(key), `${String(token.name)}: ${key}`).toBe(true);
      for (const part of (token.all_parts ?? []) as Array<Record<string, unknown>>) expect(Object.keys(part).sort()).toEqual(['component', 'name']);
    }
  });
});
