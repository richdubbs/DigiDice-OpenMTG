/** Our own mana symbols: lettered circles (mana.ts describes them; no Wizards symbols, docs/design/m8-client.md "Visual design"). */
import type { CSSProperties } from 'react';
import { manaCostName, manaGlyphs, splitSymbols, type Glyph, type GlyphColor } from './mana';

/**
 * Fill and text colors of our glyphs (our own palette, readable on the dark table and on light frames; text on fill is 4.5:1 or more, WCAG 1.4.3). The
 * gloss and the shading of the 3D orb are drawn by cards.css over this fill.
 */
export const GLYPH_FILL: Record<GlyphColor, { bg: string; fg: string }> = {
  W: { bg: '#f1e9c8', fg: '#2b2616' },
  U: { bg: '#2a6fb8', fg: '#ffffff' },
  B: { bg: '#3a2d48', fg: '#f2eef5' },
  R: { bg: '#c4372a', fg: '#ffffff' },
  G: { bg: '#26793f', fg: '#ffffff' },
  C: { bg: '#aeaaa5', fg: '#1b1a19' },
  none: { bg: '#bdbab5', fg: '#1b1a19' },
};

function glyphStyle(g: Glyph): CSSProperties {
  const [a, b] = g.colors.map((c) => GLYPH_FILL[c]);
  if (!a) return {};
  if (!b) return { background: a.bg, color: a.fg };
  // A hybrid: split fill, white text with a dark outline so it reads on both halves.
  return { background: `linear-gradient(135deg, ${a.bg} 0 50%, ${b.bg} 50% 100%)`, color: '#ffffff' };
}

export function ManaGlyph({ glyph }: { glyph: Glyph }) {
  const long = glyph.label.length > 2;
  return (
    <span
      className={`mana-glyph${long ? ' mana-glyph-long' : ''}${glyph.colors.length > 1 ? ' mana-glyph-split' : ''}${glyph.phyrexian ? ' mana-glyph-phyrexian' : ''}`}
      style={glyphStyle(glyph)}
      role="img"
      aria-label={glyph.name}
      title={glyph.name}
      data-symbol={glyph.symbol}
    >
      {glyph.label}
      {glyph.phyrexian && <span className="mana-glyph-p" aria-hidden="true">P</span>}
    </span>
  );
}

/** A mana cost as a row of glyphs; nothing when the face has no mana cost (CR 202.1b). */
export function ManaCost({ cost }: { cost: string | null | undefined }) {
  const glyphs = manaGlyphs(cost);
  if (glyphs.length === 0) return null;
  return (
    <span className="mana-cost" role="group" aria-label={`Mana cost: ${manaCostName(cost)}`} data-cost={cost ?? ''}>
      {glyphs.map((g, i) => (
        <ManaGlyph key={i} glyph={g} />
      ))}
    </span>
  );
}

/** Text with its {symbols} drawn as glyphs. */
export function SymbolText({ text }: { text: string }) {
  return (
    <>
      {splitSymbols(text).map((p, i) => (p.kind === 'text' ? <span key={i}>{p.text}</span> : <ManaGlyph key={i} glyph={p.glyph} />))}
    </>
  );
}
