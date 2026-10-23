import { describe, expect, it } from 'vitest';
import { NameIndex } from '../src/name-index';
import { looseName, normalizeName } from '../src/normalize';
import { classifyCard } from '../src/trim';
import { buildIndexData } from '../src/index-store';
import { card, rawCard } from './helpers';
import { Readable } from 'node:stream';

describe('looseName', () => {
  it('drops apostrophes and commas and treats hyphens as spaces', () => {
    expect(looseName("Smuggler's Copter")).toBe('smugglers copter');
    expect(looseName('Smugglers Copter')).toBe('smugglers copter');
    expect(looseName('Smuggler’s Copter')).toBe('smugglers copter');
    expect(looseName('Kroxa, Titan of Death’s Hunger')).toBe('kroxa titan of deaths hunger');
    expect(looseName("Lim-Dûl's Vault")).toBe('lim duls vault');
    expect(looseName("Will-o'-the-Wisp")).toBe('will o the wisp');
    expect(looseName('Fire//Ice')).toBe('fire // ice');
  });

  it('folds U+A789 (modifier letter colon) to a colon in both levels', () => {
    expect(normalizeName('Ratonhnhaké꞉ton')).toBe('ratonhnhake:ton');
    expect(looseName('Ratonhnhaké꞉ton')).toBe('ratonhnhake:ton');
    const idx = new NameIndex();
    const t = card('Ratonhnhaké꞉ton');
    idx.add(t);
    expect(idx.get('Ratonhnhaké:ton')).toBe(t);
    expect(idx.get('ratonhnhake:ton')).toBe(t);
  });
});

describe('NameIndex', () => {
  it('replaces a memorabilia card with a real card of the same name, including the face aliases', () => {
    const faces = [{ name: 'Foo' }, { name: 'Bar' }];
    const memo = card('Foo // Bar', { layout: 'transform', card_faces: faces, set_type: 'memorabilia' });
    const real = card('Foo // Bar', { layout: 'transform', card_faces: faces, set_type: 'expansion' });
    const idx = new NameIndex();
    idx.add(memo);
    idx.add(real);
    expect(idx.get('Foo // Bar')).toBe(real);
    expect(idx.get('Foo')).toBe(real);
    expect(idx.get('Bar')).toBe(real);
    expect(idx.size).toBe(1);
    // The other order keeps the real card too.
    const idx2 = new NameIndex();
    idx2.add(real);
    idx2.add(memo);
    expect(idx2.get('Bar')).toBe(real);
  });

  it('suggest skips face aliases that duplicate a real card name', () => {
    const idx = new NameIndex();
    idx.add(card('Lightning Bolt'));
    idx.add(card('Emeritus of Conflict // Lightning Bolt', { layout: 'prepare', card_faces: [{ name: 'Emeritus of Conflict' }, { name: 'Lightning Bolt' }] }));
    idx.add(card('Lightning Wolf'));
    const s = idx.suggest('Lightening Bolt');
    expect(s[0]).toBe('Lightning Bolt');
    expect(s).not.toContain('Emeritus of Conflict // Lightning Bolt');
  });

  it('suggest keeps the edit-distance window small for short names', () => {
    const idx = new NameIndex();
    for (const n of ['Fly', 'Fry', 'Web', 'Wax', 'Wry', 'Why Not']) idx.add(card(n));
    idx.add(card('Far // Away', { layout: 'split', card_faces: [{ name: 'Far' }, { name: 'Away' }] }));
    const s = idx.suggest('Why');
    expect(s).toContain('Why Not'); // prefix match
    for (const unrelated of ['Fly', 'Fry', 'Web', 'Far // Away']) expect(s).not.toContain(unrelated);
    expect(idx.suggest('ab')).toEqual([]); // two letters: no edit-distance guesses
  });

  it('indexes the face names of double-faced tokens', () => {
    const idx = new NameIndex();
    const role = card('Royal // Virtuous', { layout: 'flip', card_faces: [{ name: 'Royal' }, { name: 'Virtuous' }], set_type: 'token' });
    const role2 = card('Monster // Virtuous', { layout: 'flip', card_faces: [{ name: 'Monster' }, { name: 'Virtuous' }], set_type: 'token' });
    idx.addToken(role);
    idx.addToken(role2);
    expect(idx.tokens('Royal // Virtuous')).toEqual([role]);
    expect(idx.tokens('Royal')).toEqual([role]);
    expect(idx.tokens('virtuous')).toEqual([role, role2]);
    expect(idx.allTokens()).toHaveLength(2); // no duplicates through the aliases
    expect(idx.tokenNameCount).toBe(2);
  });
});

describe('classifyCard', () => {
  it('sends tokens to the token index by layout, set_type or type line, whatever the layout', () => {
    expect(classifyCard(rawCard('Spirit', { layout: 'token' }))).toBe('token');
    expect(classifyCard(rawCard('Royal // Virtuous', { layout: 'flip', set_type: 'token', type_line: 'Token Enchantment — Aura Role // Token Enchantment — Aura Role' }))).toBe('token');
    expect(classifyCard(rawCard('Poison Counter', { layout: 'normal', set_type: 'token', type_line: 'Card' }))).toBe('token');
    expect(classifyCard(rawCard('Wicked // Cursed', { layout: 'flip', set_type: 'masters', type_line: 'Token Enchantment — Aura Role // Token Enchantment — Aura Role' }))).toBe('token');
    expect(classifyCard(rawCard('Dungeon of the Mad Mage', { layout: 'normal', set_type: 'token', type_line: 'Dungeon' }))).toBe('token');
    expect(classifyCard(rawCard('Emblem Thing', { layout: 'emblem', set_type: 'token' }))).toBe('token');
  });

  it('excludes only silver-border and acorn-stamped cards, not every card of a funny set', () => {
    expect(classifyCard(rawCard('Unglued Thing', { set_type: 'funny', border_color: 'silver' }))).toBe('funny');
    expect(classifyCard(rawCard('Acorn Thing', { set_type: 'funny', border_color: 'black', security_stamp: 'acorn' }))).toBe('funny');
    expect(classifyCard(rawCard('Silver Thing', { set_type: 'expansion', border_color: 'silver' }))).toBe('funny');
    expect(classifyCard(rawCard('Celebr-8000', { set_type: 'funny', border_color: 'black', security_stamp: 'oval' }))).toBe('card');
    expect(classifyCard(rawCard('Black Hole', { set_type: 'funny', border_color: 'black' }))).toBe('card');
  });

  it('keeps legal black-border funny-set cards in the built index and splits the rest', async () => {
    const raws = [
      rawCard('Black Hole', { set_type: 'funny', border_color: 'black' }),
      rawCard('Acorn Thing', { set_type: 'funny', border_color: 'black', security_stamp: 'acorn' }),
      rawCard('Royal // Virtuous', { layout: 'flip', set_type: 'token', type_line: 'Token Enchantment — Aura Role // Token Enchantment — Aura Role', card_faces: [{ name: 'Royal' }, { name: 'Virtuous' }] }),
      rawCard('Monster // Virtuous', { layout: 'flip', set_type: 'token', type_line: 'Token Enchantment — Aura Role // Token Enchantment — Aura Role', card_faces: [{ name: 'Monster' }, { name: 'Virtuous' }] }),
    ];
    const built = await buildIndexData(Readable.from(raws.map((r) => JSON.stringify(r))), 'jsonl.gz');
    expect(built.cards.map((c) => c.name)).toEqual(['Black Hole']);
    expect(built.tokens.map((c) => c.name)).toEqual(['Monster // Virtuous', 'Royal // Virtuous']);
    expect(built.stats).toMatchObject({ cards: 1, tokenVariants: 2, excludedFunny: 1 });
  });
});
