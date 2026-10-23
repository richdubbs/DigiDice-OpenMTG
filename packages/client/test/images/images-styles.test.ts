/** Guarantees of images.css that jsdom cannot lay out: visible keyboard focus on the file pickers (WCAG 2.4.7) and no sideways scrolling. */
import { describe, expect, it } from 'vitest';
import { cssOf, declarations } from '../css-rules';

const css = cssOf('images/images.css');

describe('images.css', () => {
  it('WCAG 2.4.7: a focused hidden file input draws the focus ring on its label', () => {
    expect(declarations(css, '.visually-hidden:focus-visible + label').outline).toMatch(/2px solid/);
  });

  it('WCAG 1.4.10: long file names wrap instead of making the page scroll sideways', () => {
    for (const sel of ['.review-file', '.slot-label', '.slot-file']) expect(declarations(css, sel)['overflow-wrap']).toBe('anywhere');
    expect(declarations(css, '.card-picker input')['min-width']).toBe('0');
  });

  it('WCAG 1.4.10: at phone width a slot row wraps its buttons onto their own line', () => {
    expect(declarations(css, '.slot-row')['flex-wrap']).toBe('wrap');
    expect(css).toMatch(/@media \(max-width: 560px\)\s*\{[^}]*\.slot-actions\s*\{[^}]*flex-basis: 100%/);
  });

  it('the library messages stay in view (a fixed toast near the bottom of the window)', () => {
    expect(declarations(css, '.images-toast').position).toBe('fixed');
  });
});
