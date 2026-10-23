/**
 * CMDF item 4: "~ can be your commander" (CR 903.3a) is a deck-construction ability that functions before the game begins (CR 113.6n). The Commander and
 * Brawl deck checks (src/formats/commander.ts#canBeCommander) read it from the card's own line, never from reminder text about another card (CR 207.2).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { validateDeck, type DeckEntry } from '../src/formats';
import { canBeCommander, canBeYourCommanderAbility } from '../src/formats/commander';

const LEGAL = Object.fromEntries(['commander', 'duel', 'brawl', 'standardbrawl'].map((f) => [f, 'legal']));
const c = (name: string, extra: Partial<OracleCard> = {}): OracleCard => ({ name, layout: 'normal', type_line: 'Instant', oracle_text: '', color_identity: ['G'], legalities: LEGAL, ...extra }) as OracleCard;
const e = (count: number, card: OracleCard): DeckEntry => ({ count, card });

describe('CMDF: "~ can be your commander" (CR 903.3a, 113.6n)', () => {
  it('CR 903.3a: the card\'s name, its short name or "this card" before "can be your commander" on a line of its own', () => {
    expect(canBeYourCommanderAbility(c('Freya, the Fury', { type_line: 'Legendary Planeswalker — Freya', oracle_text: '+2: Draw a card.\nFreya, the Fury can be your commander.' }))).toBe(true);
    expect(canBeYourCommanderAbility(c('Svega, the Odd', { type_line: 'Legendary Planeswalker — Svega', oracle_text: 'Svega can be your commander.' }))).toBe(true);
    expect(canBeYourCommanderAbility(c('Bond of Ages', { type_line: 'Legendary Sorcery', oracle_text: 'Draw a card.\nBond of Ages can be your commander. If it is, ...' }))).toBe(true);
    expect(canBeYourCommanderAbility(c('Spell Card', { type_line: 'Sorcery', oracle_text: 'Spell commander (This card can be your commander.)\nDraw a card.' }))).toBe(true);
  });

  it('CR 207.2: reminder text about another card, or another card\'s name, is not the ability', () => {
    expect(canBeYourCommanderAbility(c('Wizard Background', { type_line: 'Legendary Enchantment — Background', oracle_text: 'Create a Character (Any nonlegendary creature can choose this as its Background. It becomes legendary and can be your commander.)' }))).toBe(false);
    expect(canBeYourCommanderAbility(c('Other Card', { type_line: 'Sorcery', oracle_text: 'Target creature can be your commander.' }))).toBe(false);
    expect(canBeCommander(c('Wizard Background', { type_line: 'Legendary Enchantment — Background', oracle_text: '(It becomes legendary and can be your commander.)' }), 'commander')).toBe(false);
  });

  it('CR 903.3a, 903.5: a deck led by a "can be your commander" planeswalker is a legal Commander deck', () => {
    const freya = c('Freya, the Fury', { type_line: 'Legendary Planeswalker — Freya', oracle_text: 'Freya, the Fury can be your commander.' });
    const main = Array.from({ length: 99 }, (_, i) => e(1, c(`Green Spell ${i + 1}`)));
    expect(validateDeck({ main, commander: [e(1, freya)] }, 'commander').problems.filter((p) => p.severity === 'error')).toEqual([]);
  });
});
