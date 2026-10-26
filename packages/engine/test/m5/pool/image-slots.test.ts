/**
 * WP24: image slots per physical side (design 12.2), token variant keys and Art Series names. Images are independent of rules
 * automation (contract C3): the slots depend only on the layout, the names and (for tokens) the printed characteristics.
 */
import { describe, expect, it } from 'vitest';
import { artSeriesNames, imageSlots, oracleTokenVariantKeys, stubCardDef, tokenDefFor, tokenVariantKey } from '../../../src/cards/pool';
import { tokenCardDef } from '../../../src/effects/handlers/token-defs';
import { compileCard, noAbilityCompiler, type CardDef, type ImageSlot, type OracleCard } from '../../../src/index';
import { compiledDef, fixtureCardNames, getCard, getTokens, loadFixtureCards } from '../../fixtures';

const keys = (def: CardDef): string[] => imageSlots(def).map((s) => s.key);
const slotFor = (slots: ImageSlot[], name: string): ImageSlot[] => slots.filter((s) => s.names.includes(name));

/** [card, layout, expected slot keys]: one row per layout in the fixture set. */
const TABLE: [string, string, string[]][] = [
  ['Lightning Bolt', 'normal', ['Lightning Bolt']],
  ['History of Benalia', 'saga', ['History of Benalia']],
  ['Bard Class', 'class', ['Bard Class']],
  ['Case of the Locked Hothouse', 'case', ['Case of the Locked Hothouse']],
  ['Student of Warfare', 'leveler', ['Student of Warfare']],
  ['Gemrazer', 'mutate', ['Gemrazer']],
  ['Phyrexian Fleshgorger', 'prototype', ['Phyrexian Fleshgorger']],
  // CR 709.1: one card, one picture, two faces; CR 715 (adventure), 710.1 (flip), 722.1 (prepare) likewise.
  ['Fire // Ice', 'split', ['Fire // Ice']],
  ['Bonecrusher Giant // Stomp', 'adventure', ['Bonecrusher Giant // Stomp']],
  ['Akki Lavarunner // Tok-Tok, Volcano Born', 'flip', ['Akki Lavarunner // Tok-Tok, Volcano Born']],
  ['Strife Scholar // Awaken the Ages', 'prepare', ['Strife Scholar // Awaken the Ages']],
  // CR 712.1: a double-faced card has a card face on each side: two pictures.
  ['Delver of Secrets // Insectile Aberration', 'transform', ['Delver of Secrets', 'Insectile Aberration']],
  ["Agadeem's Awakening // Agadeem, the Undercrypt", 'modal_dfc', ["Agadeem's Awakening", 'Agadeem, the Undercrypt']],
  // CR 712.4: each meld card's back is half of the melded card's picture.
  ['Bruna, the Fading Light', 'meld', ['Bruna, the Fading Light', 'Brisela, Voice of Nightmares']],
  ['Gisela, the Broken Blade', 'meld', ['Gisela, the Broken Blade', 'Brisela, Voice of Nightmares']],
  ['Brisela, Voice of Nightmares', 'meld', ['Brisela, Voice of Nightmares']],
];

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('WP24 image slots (design 12.2): one per physical side', { timeout: 60_000 }, () => {
  it('the table covers every layout of the fixture cards', () => {
    const layouts = new Set(Object.values(loadFixtureCards()).map((c) => c.layout));
    expect([...layouts].filter((l) => !TABLE.some((r) => r[1] === l))).toEqual([]);
  });

  it.each(TABLE)('%s (%s)', (name, layout, expected) => {
    const def = compiledDef(name);
    expect(def.layout).toBe(layout);
    expect(keys(def)).toEqual(expected);
  });

  it('CR 709.1: every name of a split, adventure, flip or prepare card resolves to its one slot', () => {
    for (const name of ['Fire // Ice', 'Bonecrusher Giant // Stomp', 'Akki Lavarunner // Tok-Tok, Volcano Born', 'Strife Scholar // Awaken the Ages']) {
      const def = compiledDef(name);
      const [only] = imageSlots(def);
      expect(only!.names.sort()).toEqual([def.name, ...def.faces.map((f) => f.name)].sort());
    }
  });

  it('CR 712.1: a double-faced card has a slot per side; the full name resolves to the front', () => {
    const slots = imageSlots(compiledDef('Delver of Secrets // Insectile Aberration'));
    expect(slotFor(slots, 'Delver of Secrets // Insectile Aberration').map((s) => s.key)).toEqual(['Delver of Secrets']);
    expect(slotFor(slots, 'Insectile Aberration').map((s) => s.key)).toEqual(['Insectile Aberration']);
  });

  it('CR 712.4: a meld pair has three pictures in all (two fronts and the combined back)', () => {
    const all = ['Bruna, the Fading Light', 'Gisela, the Broken Blade', 'Brisela, Voice of Nightmares'].flatMap((n) => keys(compiledDef(n)));
    expect(new Set(all).size).toBe(3);
  });

  it('every fixture card: at least one slot, unique keys, every name of the card resolves to exactly one slot', () => {
    const problems: string[] = [];
    for (const name of fixtureCardNames()) {
      const def = compiledDef(name);
      const slots = imageSlots(def);
      if (slots.length === 0) problems.push(`${name}: no slot`);
      if (new Set(slots.map((s) => s.key)).size !== slots.length) problems.push(`${name}: duplicate keys`);
      for (const n of new Set([def.name, ...def.faces.map((f) => f.name)])) if (slotFor(slots, n).length !== 1) problems.push(`${name}: "${n}" resolves to ${slotFor(slots, n).length} slots`);
    }
    expect(problems).toEqual([]);
  }, 120_000); // every fixture card is compiled: the set grows with every package, so the default 5 s is not enough on a busy machine

  it('slots do not depend on rules automation (contract C3): the same slots with no abilities compiled', () => {
    for (const name of fixtureCardNames()) expect(imageSlots(compileCard(getCard(name), noAbilityCompiler))).toEqual(imageSlots(compiledDef(name)));
  });
});

describe('WP24 image slots of layouts outside the fixture set (synthetic definitions)', { timeout: 60_000 }, () => {
  const twoFaced = (name: string, layout: string, faces: [string, string]): CardDef =>
    compileCard({
      name, layout, card_faces: faces.map((n) => ({ name: n, type_line: 'Creature — Test', oracle_text: '', power: '1', toughness: '1', colors: [] })),
    } as OracleCard, noAbilityCompiler);

  it('a reversible card with the same card on both sides gets a unique key per side; the bare name resolves to the front', () => {
    const slots = imageSlots(twoFaced('Bruvac // Bruvac', 'reversible_card', ['Bruvac', 'Bruvac']));
    expect(slots.map((s) => s.key)).toEqual(['Bruvac (front)', 'Bruvac (back)']);
    expect(slotFor(slots, 'Bruvac').map((s) => s.key)).toEqual(['Bruvac (front)']);
  });

  it('a reversible card with two different cards has a slot per name', () => {
    expect(imageSlots(twoFaced('A Thing // B Thing', 'reversible_card', ['A Thing', 'B Thing'])).map((s) => s.key)).toEqual(['A Thing', 'B Thing']);
  });

  it('a double-faced token has a slot per side, keyed by token variant (Soldier // Soldier)', () => {
    const def = compileCard({
      name: 'Soldier // Soldier', layout: 'double_faced_token',
      card_faces: [
        { name: 'Soldier', type_line: 'Token Creature — Soldier', oracle_text: '', power: '1', toughness: '1', colors: ['W'] },
        { name: 'Soldier', type_line: 'Token Creature — Soldier', oracle_text: 'Vigilance', power: '2', toughness: '2', colors: ['W'] },
      ],
    } as OracleCard, noAbilityCompiler);
    expect(keys(def)).toEqual(['Soldier (1/1 W Creature — Soldier)', 'Soldier (2/2 W Creature — Soldier; Vigilance)']);
  });

  it.each(['planar', 'scheme', 'vanguard', 'augment', 'host', 'battle', 'some_future_layout'])('%s: one slot', (layout) => {
    const def = compileCard({ name: 'Odd Object', layout, type_line: 'Plane — Somewhere', oracle_text: '' } as OracleCard, noAbilityCompiler);
    expect(keys(def)).toEqual(['Odd Object']);
  });

  it('a flip-layout Role token (two Roles printed on one card, one per half): one slot per Role, labelled by name; a flip card has no back face', () => {
    const def = compileCard({
      name: 'Monster // Sorcerer', layout: 'flip', type_line: 'Token Enchantment — Aura Role // Token Enchantment — Aura Role', colors: [],
      card_faces: [
        { name: 'Monster', type_line: 'Token Enchantment — Aura Role', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has trample.' },
        { name: 'Sorcerer', type_line: 'Token Enchantment — Aura Role', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has "Whenever this creature attacks, scry 1."' },
      ],
    } as OracleCard, noAbilityCompiler);
    const slots = imageSlots(def);
    expect(slots.map((s) => s.label)).toEqual(['Monster token', 'Sorcerer token']);
    // Each half is the token the engine creates as that Role (CR 111.10b-h), so it binds to the engine's Monster Role.
    expect(slots[0]!.key).toBe(imageSlots(tokenDefFor('Monster Role')!)[0]!.key);
  });

  it('an emblem has one slot keyed by its variant', () => {
    const def = compileCard({ name: 'Ajani Emblem', layout: 'emblem', type_line: 'Emblem — Ajani', oracle_text: 'Creatures you control get +1/+1.' } as OracleCard, noAbilityCompiler);
    expect(keys(def)).toEqual(['Ajani Emblem (C Emblem — Ajani; Creatures you control get +1/+1.)']);
  });

  it('a stub has one slot keyed by the name as given (contract C4)', () => {
    expect(imageSlots(stubCardDef('Totally New Card', 'image'))).toEqual([{ key: 'Totally New Card', label: 'Totally New Card', names: ['Totally New Card'] }]);
  });
});

describe('WP24 token variants: the interpreter\'s token and the index\'s token share a slot key', { timeout: 60_000 }, () => {
  it('fixture tokens: the key from the compiled definition equals the key from the index card; same-name variants differ', () => {
    for (const t of ['Angel', 'Beast', 'Goblin', 'Knight', 'Soldier', 'Spirit', 'Treasure', 'Wolf']) {
      expect(getTokens(t).length, t).toBeGreaterThan(0);
      for (const card of getTokens(t)) expect(keys(compileCard(card, noAbilityCompiler))).toEqual(oracleTokenVariantKeys(card));
    }
    const spirits = getTokens('Spirit').flatMap(oracleTokenVariantKeys);
    expect(spirits).toHaveLength(7); // FAST5 MX6: the endure cards' white Spirit tokens (1/1, 2/2, 3/3, X/X) joined the fixture set; std-cardcopy-5: Kaya, Spirits' Justice's white-black 1/1; pc-tokens-1: Ceaseless Conflict's red-white 3/2
    expect(new Set(spirits).size).toBe(7);
    expect(spirits).toContain('Spirit (1/1 W Creature — Spirit; Flying)');
  });

  it('CR 111.10a: the predefined Treasure ("Treasure Token", CR 111.4) binds to the index\'s Treasure token', () => {
    const def = tokenDefFor('Treasure')!;
    expect(def.faces[0]!.name).toBe('Treasure Token');
    expect(keys(def)).toEqual(oracleTokenVariantKeys(getTokens('Treasure')[0]!));
  });

  it('CR 111.3: an inline token (Doomed Traveler\'s 1/1 white Spirit with flying) binds to the index variant', () => {
    const made = tokenCardDef({ name: 'Spirit', colors: ['W'], types: ['Creature'], subtypes: ['Spirit'], power: 1, toughness: 1, keywords: ['flying'] });
    if ('reason' in made) throw new Error(made.reason);
    expect(tokenVariantKey(made.faces[0]!)).toBe('Spirit (1/1 W Creature — Spirit; Flying)');
  });

  it('CR 111.3: an inline token with several keywords binds to the printed token whose keywords share one line ("Flying, vigilance")', () => {
    const made = tokenDefFor({ colors: ['W'], types: ['Creature'], subtypes: ['Angel'], power: 4, toughness: 4, keywords: ['flying', 'vigilance'] })!;
    const printed = { name: 'Angel', layout: 'token', type_line: 'Token Creature — Angel', oracle_text: 'Flying, vigilance', power: '4', toughness: '4', colors: ['W'] } as OracleCard;
    expect(keys(made)).toEqual(oracleTokenVariantKeys(printed));
    expect(keys(made)).toEqual(['Angel (4/4 W Creature — Angel; Flying; Vigilance)']);
  });

  it('CR 207.2, 111.10: reminder text and the way a token names itself ("this artifact", "this Aura") do not split a variant', () => {
    const printedShard = { name: 'Shard', layout: 'token', type_line: 'Token Enchantment — Shard', oracle_text: '{2}, Sacrifice this enchantment: Scry 1, then draw a card.', colors: [] } as OracleCard;
    expect(keys(tokenDefFor('Shard')!)).toEqual(oracleTokenVariantKeys(printedShard));
    const printedCat = { name: 'Cat', layout: 'token', type_line: 'Token Creature — Cat', oracle_text: 'Lifelink (Damage dealt by this creature also causes you to gain that much life.)', power: '1', toughness: '1', colors: ['W'] } as OracleCard;
    expect(keys(tokenDefFor({ colors: ['W'], types: ['Creature'], subtypes: ['Cat'], power: 1, toughness: 1, keywords: ['lifelink'] })!)).toEqual(oracleTokenVariantKeys(printedCat));
    // A different ability is still a different variant.
    const other = { ...printedShard, oracle_text: '{2}, Sacrifice this enchantment: Draw a card.' } as OracleCard;
    expect(oracleTokenVariantKeys(other)).not.toEqual(oracleTokenVariantKeys(printedShard));
  });
});

describe('WP24 Art Series names resolve to the cards they depict (images only)', { timeout: 60_000 }, () => {
  it.each([
    ['Gigantosaurus // Gigantosaurus', ['Gigantosaurus']],
    ['Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', ['Ajani, Nacatl Pariah', 'Ajani, Nacatl Avenger']],
    ['Lightning Bolt Art Card', ['Lightning Bolt']],
    ['  Fire  ', ['Fire']],
    ['', []],
  ])('%s', (name, expected) => {
    expect(artSeriesNames(name)).toEqual(expected);
  });
});
