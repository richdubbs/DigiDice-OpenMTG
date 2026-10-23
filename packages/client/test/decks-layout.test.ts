/**
 * Layout rules of the deck screens that jsdom cannot measure (checked by hand in a browser at 1098x698, 1400x900 and 375x812): deck banners keep the
 * card name readable next to the cost, the deckbuilder uses the whole window and scrolls its lists inside it (nothing outside scrolls), the one-column
 * phone layout can shrink below its content (no sideways scroll), and nothing around a card picture can filter, tint, blur or fade it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '..', 'src', 'decks', 'decks.css'), 'utf8');

/** Declarations of a rule, by exact selector (outside or inside a media block). */
function rule(selector: string, within = css): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(within);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

function media(query: string): string {
  const start = css.indexOf(`@media (${query})`);
  if (start < 0) throw new Error(`no @media (${query})`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unclosed media block');
}

describe('deck screen layout', () => {
  it('a deck banner keeps the card name next to its cost: the name shrinks with an ellipsis, and the buttons overlay the cost on hover', () => {
    const name = rule('.deck-card-line .card-name');
    expect(name).toMatch(/min-width:\s*0/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.deck-card-actions')).toMatch(/position:\s*absolute/);
    // Buttons stay reachable by keyboard (not display: none) and appear on focus as well as on hover.
    expect(rule('.deck-card-actions')).not.toMatch(/display:\s*none/);
    expect(css).toContain('.deck-card:focus-within .deck-card-actions');
  });

  it('the deckbuilder is wider than the default screen (the app shell sets .screen to 960px)', () => {
    const max = /max-width:\s*(\d+)px/.exec(rule('.screen.deckbuilder-screen'));
    expect(Number(max?.[1])).toBeGreaterThanOrEqual(1600);
  });

  it('the builder body fills the window under the title and scrolls its pool and its deck list inside it', () => {
    expect(rule('.deck-build')).toMatch(/height:\s*max\(\d+px,\s*calc\(100vh - var\(--deck-chrome\)\)\)/);
    expect(rule('.deck-pool-scroll')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.deck-lists')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.deck-details')).toMatch(/height:\s*max\(\d+px,\s*calc\(100vh - var\(--deck-chrome\)\)\)/);
  });

  it('the card grid shows about seven cards per row on a wide screen: a 118px minimum and a 12px gap', () => {
    expect(rule('.search-results')).toMatch(/repeat\(auto-fill,\s*minmax\(118px,\s*1fr\)\)/);
    expect(rule('.search-results')).toMatch(/gap:\s*18px 12px/);
  });

  it('on narrow screens each view is one column that can shrink below its content, and the floating preview is left out', () => {
    const narrow = media('max-width: 900px');
    // .deck-build and .deck-details share one rule.
    expect(rule('.deck-details', narrow)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.deck-details', narrow)).toMatch(/height:\s*auto/);
    expect(narrow).toMatch(/\.deck-build,\s*\.deck-details\s*\{/);
    expect(rule('.deck-hover-preview', narrow)).toMatch(/display:\s*none/);
  });

  it('ARCHITECTURE.md "Card images": nothing around a card picture has a filter, blend, blur, mask or opacity, and the picture box keeps its aspect ratio', () => {
    // Every box a card picture can sit in: the grid cell, the button around it, its picture box, the lists around them, the preview and its modal.
    const around = [
      '.deck-pick',
      '.deck-pick-art',
      '.deck-pick-art:focus-visible',
      '.deck-pick-img',
      '.search-results',
      '.deck-pool-scroll',
      '.deck-pool',
      '.deck-search',
      '.deck-build',
      '.card-preview',
      '.card-preview-art',
      '.deck-hover-preview',
      '.deck-modal',
      '.deck-modal-layer',
      '.deckbuilder-screen',
    ];
    for (const sel of around) expect(rule(sel), sel).not.toMatch(/(^|[\s;])(filter|backdrop-filter|mix-blend-mode|opacity|mask|clip-path)\s*:/);
    expect(rule('.deck-pick-img')).toMatch(/aspect-ratio:\s*63\s*\/\s*88/);
    // The modal's pop-in animates a transform only.
    const pop = css.indexOf('@keyframes deck-pop');
    expect(css.slice(pop, pop + 170)).not.toMatch(/opacity|filter/);
  });
});
