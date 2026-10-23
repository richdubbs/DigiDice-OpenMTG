/** Our own mana glyphs (docs/design/m8-client.md "Visual design": lettered circles, no Wizards symbols). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ManaCost, SymbolText } from '../../src/cards/ManaGlyph';
import { glyphOf, manaCostName, manaGlyphs, splitSymbols } from '../../src/cards/mana';

describe('glyphOf: every symbol kind of CR 107', () => {
  it.each([
    ['2', '2', ['none'], '2 generic mana'], // CR 107.4b
    ['G', 'G', ['G'], 'one green mana'], // CR 107.4a
    ['C', 'C', ['C'], 'one colorless mana'], // CR 107.4c
    ['W/U', 'W/U', ['W', 'U'], 'one white or blue mana'], // CR 107.4e hybrid
    ['2/W', '2/W', ['none', 'W'], '2 generic or one white mana'], // CR 107.4e monocolored hybrid
    ['C/R', 'C/R', ['C', 'R'], 'one colorless or red mana'],
    ['B/P', 'B', ['B'], 'one black Phyrexian mana'], // CR 107.4f
    ['G/U/P', 'G/U', ['G', 'U'], 'one green or blue Phyrexian mana'],
    ['X', 'X', ['none'], 'X generic mana'], // CR 107.3
    ['S', 'S', ['none'], 'one snow mana'], // CR 107.4h
    ['T', 'T', ['none'], 'tap'], // CR 107.5
    ['Q', 'Q', ['none'], 'untap'], // CR 107.6
    ['E', 'E', ['none'], 'one energy'], // CR 107.14
  ])('CR 107: {%s} is a "%s" circle', (body, label, colors, name) => {
    const g = glyphOf(body);
    expect(g.label).toBe(label);
    expect(g.colors).toEqual(colors);
    expect(g.name).toBe(name);
  });

  it('CR 107.18: {P} is the pawprint that marks a mode, not mana', () => {
    const g = glyphOf('P');
    expect(g.name).toBe('pawprint (marks a mode)');
    expect(g.name).not.toMatch(/mana|Phyrexian/);
    expect(g.phyrexian).toBe(false);
  });

  it('CR 107.4g: {H} is the generic Phyrexian symbol (any of the fifteen Phyrexian mana symbols)', () => {
    const g = glyphOf('H');
    expect(g.name).toBe('any Phyrexian mana symbol');
    expect(g.phyrexian).toBe(true);
  });

  it('CR 107.12: {CHAOS} is the chaos symbol', () => {
    expect(glyphOf('CHAOS').name).toBe('chaos');
  });

  it('marks Phyrexian symbols and shows an unknown symbol as written (never throws)', () => {
    expect(glyphOf('R/P').phyrexian).toBe(true);
    expect(glyphOf('R').phyrexian).toBe(false);
    expect(glyphOf('Z9').label).toBe('Z9');
  });
});

describe('costs and rules text', () => {
  it('CR 202.1b: a face without a mana cost has no glyphs, distinct from {0}', () => {
    expect(manaGlyphs(null)).toEqual([]);
    expect(manaGlyphs('')).toEqual([]);
    expect(manaGlyphs('{0}').map((g) => g.label)).toEqual(['0']);
    expect(manaCostName(null)).toBe('no mana cost');
    expect(manaCostName('{2}{G}')).toBe('2 generic mana, one green mana');
  });

  it('splits rules text into text and symbols', () => {
    const pieces = splitSymbols('{T}: Add {G}.');
    expect(pieces.map((p) => (p.kind === 'text' ? p.text : `[${p.glyph.label}]`))).toEqual(['[T]', ': Add ', '[G]', '.']);
  });

  it('renders a cost as labelled lettered circles (a "2" circle and a green "G" circle)', () => {
    render(<ManaCost cost="{2}{G}" />);
    const group = screen.getByRole('group', { name: 'Mana cost: 2 generic mana, one green mana' });
    const glyphs = group.querySelectorAll('.mana-glyph');
    expect([...glyphs].map((g) => g.textContent)).toEqual(['2', 'G']);
    expect(screen.getByRole('img', { name: 'one green mana' }).getAttribute('style')).toContain('background');
    // No image files: our glyphs are text in circles.
    expect(group.querySelector('img')).toBeNull();
  });

  it('renders nothing for no mana cost and symbols inside rules text', () => {
    const { container } = render(<ManaCost cost={null} />);
    expect(container.innerHTML).toBe('');
    render(<SymbolText text="{T}: Add {C}." />);
    expect(screen.getByRole('img', { name: 'tap' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'one colorless mana' })).toBeTruthy();
  });
});
