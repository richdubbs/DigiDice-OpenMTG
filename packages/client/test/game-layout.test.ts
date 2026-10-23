/**
 * Layout rules of the game screens (C7) that jsdom cannot measure, checked in the stylesheet itself: the game fits one screen with the prompt bar
 * always visible, the New game screen never scrolls sideways at phone width, and a disabled Start button looks disabled.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssOf, declarations } from './css-rules';

const css = readFileSync(path.resolve(__dirname, '..', 'src', 'game', 'game.css'), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selectors = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    return Object.fromEntries(
      m[2]!
        .split(';')
        .map((d) => d.split(':').map((s) => s.trim()))
        .filter((d) => d.length >= 2 && d[0] !== '')
        .map(([k, ...v]) => [k!, v.join(':')]),
    );
  }
  return {};
}

describe('game screen layout (docs/design/m8-client.md screen 6: "bottom bar: the current prompt")', () => {
  it('fills exactly one screen; the board scrolls inside its slot and the prompt bar stays on screen', () => {
    expect(rule('.game-screen').height).toBe('100dvh');
    expect(rule('.game-table')['min-height']).toBe('0');
    expect(rule('.game-board-slot')['min-height']).toBe('0');
    expect(rule('.game-board-slot').overflow).toBe('auto');
    // ui/arena: the prompt sits in the board's rail; when the rail is full the slot shrinks and the prompt's list of choices scrolls in its own box (the
    // actions stay whole and in sight). The slot itself never scrolls.
    expect(rule('.game-prompt-slot')['min-height']).toBe('0');
    expect(rule('.game-prompt-slot').overflow).toBeUndefined();
  });

  it('the hot-seat pass cover covers the whole viewport', () => {
    expect(rule('.pass-cover').position).toBe('fixed');
    expect(rule('.pass-cover').inset).toBe('0');
  });
});

describe('New game layout', () => {
  it('never scrolls sideways at phone width: the fieldset may shrink and its controls fit it', () => {
    expect(rule('.new-game fieldset')['min-width']).toBe('0');
    expect(rule('.new-game select')['max-width']).toBe('100%');
    expect(rule('.new-game select').width).toBe('100%');
  });

  it('a disabled Start button looks disabled but stays a raised slab: dimmed colors and not-allowed, never faded or flattened', () => {
    const decl = (selector: string) => declarations(cssOf('theme/styles.css'), selector);
    expect(decl('button:disabled').cursor).toBe('not-allowed');
    // The dim is in the slab's own colors (face, side, rim, label); an opacity would also fade the side that gives it thickness.
    expect(decl('.button-primary:disabled')['--btn-face']).toBeTruthy();
    expect(decl('.button-primary:disabled')['--btn-side']).toBeTruthy();
    expect(decl('.button-primary:disabled').opacity).toBeUndefined();
    expect(decl('button:disabled:hover')['box-shadow']).toContain('var(--btn-side)');
    expect(rule('.new-game-start .button-primary:disabled').opacity).toBeUndefined();
  });
});
