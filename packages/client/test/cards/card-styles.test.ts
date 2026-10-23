/** Guarantees of cards.css that jsdom cannot lay out: readable tags (WCAG 1.4.3) and a zoom that fits the window. */
import { describe, expect, it } from 'vitest';
import { GLYPH_FILL } from '../../src/cards/ManaGlyph';
import { contrast, cssOf, declarations } from '../css-rules';

const css = cssOf('cards/cards.css');

describe('cards.css', () => {
  it('WCAG 1.4.3: the Token / Emblem tag (CR 111, 114) reads at 4.5:1 or more on every frame tone', () => {
    const tag = declarations(css, '.frame-tag');
    // A fixed chip, not the frame tone: white text on white or gold tones was unreadable.
    expect(tag.background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tag.background).not.toContain('var(--tone)');
    expect(contrast(tag.background!, tag.color!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the zoom never runs off the bottom of the window: its height is capped and its pictures shrink with the window height', () => {
    expect(declarations(css, '.card-zoom')['max-height']).toBe('calc(100vh - 32px)');
    expect(declarations(css, '.card-zoom-picture')['--card-w']).toMatch(/100vh/);
  });

  it('CR 710.2: a flipped card zooms turned around, so its active half reads upright', () => {
    expect(declarations(css, '.card-zoom-picture.is-flipped').transform).toBe('rotate(180deg)');
  });

  it('WCAG 1.4.3: the frame ink, the dimmed reminder text and the orb text read at 4.5:1 or more', () => {
    const frame = declarations(css, '.card-frame');
    for (const tone of ['W', 'U', 'B', 'R', 'G', 'multi', 'artifact', 'land', 'colorless']) {
      const light = declarations(css, `.tone-${tone}`)['--tone-light']!;
      expect(contrast(light, frame['--ink']!), `ink on tone ${tone}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light, frame['--ink-soft']!), `reminder text on tone ${tone}`).toBeGreaterThanOrEqual(4.5);
      // The text box and the bars are the tone's light color, lifted toward white: never darker than that.
    }
    for (const [color, { bg, fg }] of Object.entries(GLYPH_FILL)) expect(contrast(bg, fg), `mana orb ${color}`).toBeGreaterThanOrEqual(4.5);
    for (const chip of ['.loyalty-cost', '.saga-mark']) expect(declarations(css, chip).color).toBe('#fff');
  });

  it('small mode: the frame is a size container; below 120px the type line and rules text are clipped (not removed) so they stay readable by screen readers', () => {
    const frame = declarations(css, '.card-frame');
    expect(frame.container).toBe('card-frame / inline-size');
    const small = /@container card-frame \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/.exec(css);
    expect(small).not.toBeNull();
    expect(Number(small![1])).toBeGreaterThanOrEqual(100);
    expect(Number(small![1])).toBeLessThanOrEqual(130);
    const body = small![2]!;
    expect(body).toMatch(/\.frame-type,\s*\.frame-text/);
    expect(body).toContain('clip-path: inset(50%)');
    expect(body).not.toMatch(/display:\s*none/);
    // The corner emblem of the art box shows only here.
    expect(css).toMatch(/\n\.art-emblem \{\s*display: none/);
    expect(body).toMatch(/\.art-emblem \{\s*display: block/);
  });

  it('nothing in the stylesheet filters, blurs or blends: pictures are never touched (ARCHITECTURE.md "Card images" B)', () => {
    expect(css).not.toMatch(/(?:^|[\s;{])(?:backdrop-)?filter\s*:/);
    expect(css).not.toMatch(/mix-blend-mode|background-blend-mode|blur\(/);
    for (const sel of ['.card-image', '.card-back', '.card-box']) {
      const d = declarations(css, sel);
      expect(d.filter).toBeUndefined();
      expect(d.opacity).toBeUndefined();
    }
  });
});
