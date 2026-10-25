/**
 * The board stylesheet's layout and accessibility rules (review of C4): nothing clips markers or attachments, hands never overlap card images and stay
 * reachable, attachments keep their own tapped state and highlight, nothing dims or covers a card image (ARCHITECTURE.md "Card images"), the zoom never
 * covers the stack, small windows wrap instead of spilling, and text and controls meet WCAG contrast.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { CARDS_CSS, contrast, cssRules, decl, injectBoardCss, over, removeBoardCss, resolveColor } from './css';
import { ALICE, editable, playGame } from './fixtures';

const game = playGame(5);
const main5 = () => game.captured.find((x) => x.turn === 5 && x.step === 'main1' && x.view.viewer === ALICE)!;

afterEach(() => removeBoardCss());

describe('CR 301.5, 303.4, 701.26: an attachment keeps its own tapped state and highlight', () => {
  it('an untapped attachment of a tapped, selectable host is drawn untapped and without the host\'s highlight', () => {
    const v = editable(main5().view);
    const bear = v.zones.battlefield.find((id) => v.objects[id]!.controller === ALICE && v.defs[v.objects[id]!.defId]!.name === 'Test Bear')!;
    const forest = v.zones.battlefield.find((id) => v.objects[id]!.controller === ALICE && v.defs[v.objects[id]!.defId]!.name === 'Forest')!;
    v.objects[bear] = { ...v.objects[bear]!, tapped: true };
    v.objects[forest] = { ...v.objects[forest]!, tapped: false, attachedTo: bear };
    injectBoardCss();
    const { container } = render(<GameBoard view={v} interaction={{ selectable: [bear], onObjectClick: () => {} }} />);
    const hostFrame = container.querySelector(`.board-card[data-object-id="${bear}"] > .board-card-image`)!;
    const attFrame = container.querySelector(`.board-card[data-object-id="${forest}"] > .board-card-image`)!;
    expect(getComputedStyle(hostFrame).transform).toContain('rotate(90deg)');
    // ui/arena: a highlight is the frame's ring (--ring), drawn with its depth shadow outside the picture; the attachment keeps the default (no ring).
    expect(getComputedStyle(hostFrame).getPropertyValue('--ring')).toContain('var(--hl-select)');
    expect(getComputedStyle(attFrame).transform).toBe('');
    expect(getComputedStyle(attFrame).getPropertyValue('--ring')).not.toContain('var(--hl-select)');
  });

  it('every tapped and highlight rule targets the slot\'s own frame (child combinator)', () => {
    for (const r of cssRules()) {
      for (const s of r.selectors) {
        if (/(is-tapped|hl-[a-z]+|is-phased)\b[^>]*\.board-card-image/.test(s)) expect(s, s).toMatch(/(is-tapped|hl-[a-z]+|is-phased) > \.board-card-image$/);
      }
    }
  });
});

describe('card images are never dimmed or covered (ARCHITECTURE.md "Card images")', () => {
  it('CR 702.26: a phased-out permanent is marked outside the image, not made transparent', () => {
    const v = editable(main5().view);
    const bear = v.zones.battlefield.find((id) => v.objects[id]!.controller === ALICE && v.defs[v.objects[id]!.defId]!.name === 'Test Bear')!;
    v.objects[bear] = { ...v.objects[bear]!, phasedOut: true };
    injectBoardCss();
    const { container } = render(<GameBoard view={v} />);
    const slotEl = container.querySelector<HTMLElement>(`.board-card[data-object-id="${bear}"]`)!;
    for (let el: HTMLElement | null = slotEl.querySelector<HTMLElement>('.board-card-image'); el; el = el.parentElement) {
      const o = getComputedStyle(el).opacity;
      expect(o === '' ? 1 : Number(o), el.className).toBe(1);
      expect(getComputedStyle(el).filter || 'none').toBe('none');
    }
    expect(getComputedStyle(slotEl.querySelector('.board-card-image')!).outlineStyle || getComputedStyle(slotEl.querySelector('.board-card-image')!).outline).toMatch(/dashed/);
  });

  it('CR 402: hand cards overlap only while card pictures may (no Scryfall images on screen), and then only to fit the hand', () => {
    for (const r of cssRules()) {
      if (!r.selectors.some((s) => s.includes('hand-card'))) continue;
      for (const [k, val] of Object.entries(r.decls)) {
        if (!k.startsWith('margin') || !/-/.test(val)) continue;
        for (const s of r.selectors) expect(s, `${s} ${k}`).toMatch(/^\.game-board\[data-overlap='yes'\] /);
      }
    }
    // the pull is the share of the hand's width the cards lack, never more (none while they fit)
    expect(decl(".game-board[data-overlap='yes'] .hand-card + .hand-card")['margin-left']).toMatch(/^min\(0px, .*100cqw.*var\(--hand-n/);
    expect(decl('.hand-own').gap).toBeDefined();
  });

  it('CR 208.3, 613.4: the current P/T and counters are drawn above every layer of our own text frame, so its printed P/T box never covers them', () => {
    // The frame's inline-size container does not keep its z-indexed parts to itself: they stack with the overlay in the card's image box.
    // (C2's own hover zoom, .card-zoom, is a fixed window of its own, not part of a card.)
    const frameLayers = cssRules(CARDS_CSS)
      .filter((r) => r.decls['z-index'] && !r.selectors.some((s) => s.includes('card-zoom')))
      .map((r) => Number(r.decls['z-index']));
    expect(frameLayers.length).toBeGreaterThan(0);
    expect(decl('.card-overlay').position).toBe('absolute');
    expect(Number(decl('.card-overlay')['z-index'])).toBeGreaterThan(Math.max(...frameLayers));
    // the zoom draws the same overlay on its picture (GameBoard.tsx Zoom)
    expect(decl('.zoom-card').position).toBe('relative');
  });
});

describe('CR 403, 405: rows, hands and the zoom never hide information', () => {
  it('battlefield rows never clip: their cards shrink to share the row and wrap below their smallest size; markers wrap', () => {
    const row = decl('.bf-row');
    // ui/arena: no scroll box (a lifted, attacking or animated card is never cut off at a row's edge).
    expect(row.overflow).toBeUndefined();
    expect(row['overflow-x']).toBeUndefined();
    expect(row['overflow-y']).toBeUndefined();
    expect(row['flex-wrap']).toBe('wrap');
    expect(row['container-type']).toBe('inline-size');
    expect(row.flex).toBe('none');
    expect(decl('.bf-creatures').flex).toBe('1 0 auto');
    // Each card's width: its share of the row (--units card widths, a tapped card counting as wide as it is tall), at most the full size.
    expect(decl('.bf-slot')['--row-cw']).toMatch(/100cqw.*var\(--units/);
    expect(decl('.marker')['white-space']).toBe('normal');
    const group = decl('.permanent-group');
    expect(group.display).toMatch(/flex/);
    expect(group['flex-direction'] ?? 'row').toBe('row');
  });

  it('CR 402: the own hand is centred safely, shrinks its cards to fit, and the main column never grows past its track', () => {
    expect(decl('.hand-own')['justify-content']).toBe('safe center');
    expect(decl('.hand-own')['container-type']).toBe('inline-size');
    expect(decl('.hand-own .board-card-image').width).toBe('var(--hand-cw)');
    expect(decl('.hand-card')['--hand-cw']).toMatch(/cqw/);
    expect(decl('.game-board')['grid-template-columns']).toBe('minmax(0, 1fr) var(--rail-w)');
    for (const s of ['.board-top', '.board-middle', '.board-bottom']) expect(decl(s)['min-width'], s).toBe('0');
    const c = main5();
    const { container } = render(<GameBoard view={c.view} />);
    const hand = container.querySelector<HTMLElement>('.hand-own')!;
    expect(hand.style.getPropertyValue('--hand-n')).toBe(String(c.view.zones.hand[ALICE]!.length));
  });

  it('CR 405: the zoom is drawn over the main board, never over the side column with the stack', () => {
    expect(decl('.board-main').position).toBe('relative');
    expect(decl('.zoom').position).toBe('absolute');
    // The rail sits in its own grid column, out of flow (a change inside it never lays the table out again): the zoom, inside .board-main, never reaches it.
    expect(decl('.board-side').position).toBe('absolute');
    expect(decl('.board-side')['grid-column']).toBe('2');
  });

  it('keyboard focus brings a hand card forward like hover; the focus a click or a drag leaves behind does not keep it up', () => {
    expect(decl('.hand-card:has(:focus-visible)')['z-index']).toBe('2');
    expect(decl('.hand-card:has(:focus-visible) .board-card')['--lift-y']).toBeDefined();
    expect(decl('.hand-card:focus-within')['z-index']).toBeUndefined();
    expect(decl('.hand-card:focus-within .board-card')['--lift-y']).toBeUndefined();
  });
});

describe('small windows (below 1200px) never spill under the side rail', () => {
  it('the rail narrows, and the steps in it use short labels (the full name stays for screen readers and in the tooltip)', () => {
    const narrow = cssRules().filter((r) => r.media?.includes('max-width: 1199px'));
    const get = (sel: string) => Object.assign({}, ...narrow.filter((r) => r.selectors.includes(sel)).map((r) => r.decls)) as Record<string, string>;
    expect(get('.game-board')['--rail-w']).toMatch(/clamp\(/);
    // ui/arena: the turn structure lives in the narrow rail at every width, so the short labels are always the visible ones.
    expect(decl('.phase-step .step-short').display).toBe('inline');
    expect(decl('.phase-step .step-long').position).toBe('absolute');
    // The seat strips are grids (cluster | hand) whose hand column may shrink; nothing in them forces the table wider than its track.
    expect(decl('.side-bar')['grid-template-columns']).toBe('auto minmax(0, 1fr)');
  });
});

describe('WCAG contrast', () => {
  const navy = resolveColor('var(--table-bg)');
  const surfaceOnNavy = over(resolveColor('var(--surface)'), navy);

  it('1.4.3: the Deciding/Priority badge and the game-over banner have 4.5:1 text', () => {
    for (const s of ['.badge-deciding', '.result-banner']) {
      const d = decl(s);
      expect(contrast(resolveColor(d.color!), resolveColor(d.background!)), s).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('1.4.11: an off stop toggle is a 3:1 ring of at least 1.5px against the phase bar, also when disabled', () => {
    const t = decl('.game-board .stop-toggle');
    const [width, , ...color] = t.border!.split(' ');
    expect(parseFloat(width!)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(over(resolveColor(color.join(' ')), surfaceOnNavy), surfaceOnNavy)).toBeGreaterThanOrEqual(3);
    expect(decl('.stop-toggle:disabled').opacity).toBeUndefined();
  });

  it('1.4.3: white mana glyph text has 4.5:1 on every coloured circle', () => {
    for (const c of ['u', 'b', 'r', 'g']) {
      const d = decl(`.mana-${c}`);
      expect(contrast(resolveColor(d.color!), resolveColor(d.background!)), c).toBeGreaterThanOrEqual(4.5);
    }
  });
});
