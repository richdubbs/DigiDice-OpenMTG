/**
 * Keyboard, focus and click safety of the prompt bar with a realistic focus model (a mouse click focuses the clicked element; keys go to the focused element):
 * Space = OK / pass after a mouse click, Space left to keyboard-focused controls, double clicks, focus after an action, the live region, stale errors.
 */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, clickEl, find, pendingKind, press, renderPrompt, scenario, tabTo } from './harness';

const bolt = () => {
  const s = scenario(['Mountain', 'Lightning Bolt', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
  return act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Space = OK after a mouse click (docs/design/m8-client.md "Visual design")', () => {
  it('CR 601.2c: Space after a mouse click on a target chip confirms the target; the chip is not toggled off', async () => {
    const s = bolt();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { conn } = renderPrompt(s);
    const chip = screen.getByRole('button', { name: /^Grizzly Bears/, pressed: false });
    await clickEl(chip);
    expect(document.activeElement).toBe(chip); // a real click leaves the focus on the chip
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    expect(conn.errors).toEqual([]);
    // The cost has only one way to pay (`onlyWay`): it is paid at once (auto pay), and the spell is on the stack.
    expect(conn.answers().at(-1)).toEqual({ kind: 'payCost', auto: true });
    expect(pendingKind(conn)).toBe('priority');
  });

  it("CR 601.2c: Space after a mouse click on a board card confirms (the card's own Space handler does not toggle it off)", async () => {
    const s = bolt();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { conn } = renderPrompt(s);
    const card = screen.getByRole('button', { name: `Board ${bears}` });
    await clickEl(card);
    expect(document.activeElement).toBe(card);
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
  });

  it('CR 700.2: Space after a mouse click while the prompt cannot be confirmed yet does nothing (the clicked mode stays chosen)', async () => {
    let s = scenario(["Kolaghan's Command", 'Mountain', 'Swamp'], { p1: { hand: ["Kolaghan's Command"], battlefield: ['Mountain', 'Swamp', 'Swamp', 'Mountain'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, "Kolaghan's Command", 'hand') });
    const { conn } = renderPrompt(s);
    const mode = screen.getAllByRole('button', { pressed: false }).find((b) => !(b as HTMLButtonElement).disabled && b.closest('.prompt-options'))!;
    await clickEl(mode);
    expect(mode.getAttribute('aria-pressed')).toBe('true');
    await press(' ');
    expect(mode.getAttribute('aria-pressed')).toBe('true');
    expect(conn.sent).toEqual([]);
  });

  it('Space on a button focused with the keyboard (Tab) is left to that button', async () => {
    const { conn } = renderPrompt(bolt());
    const chip = screen.getByRole('button', { name: /^Grizzly Bears/ });
    await tabTo(chip);
    await press(' ');
    expect(conn.sent).toEqual([]); // the browser activates the focused button itself (on keyup); the prompt does not confirm
  });
});

describe('double clicks (review finding: a double click on Pass passed twice)', () => {
  it("CR 117.3d: a double click on Pass priority passes once: a new prompt's buttons work only 300 ms after it appears", async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    const { conn } = renderPrompt(s, { armDelayMs: 300 });
    now.mockReturnValue(2_000);
    await click('Pass priority');
    expect(conn.sent).toEqual([{ type: 'pass', player: 'p1' }]);
    await click('Pass priority'); // the second click of the double click lands on the next prompt's Pass button
    expect(conn.sent).toHaveLength(1);
    now.mockReturnValue(2_400);
    await click('Pass priority');
    expect(conn.sent).toEqual([{ type: 'pass', player: 'p1' }, { type: 'pass', player: 'p2' }]);
  });
});

describe('focus and announcements', () => {
  it("after an action the focus moves to the new prompt's text, and the prompt text is in a polite live region", async () => {
    const { conn } = renderPrompt(bolt());
    await click('Bob');
    await click('Choose targets');
    expect(pendingKind(conn)).toBe('priority'); // the only way to pay was taken at once
    const focused = document.activeElement as HTMLElement;
    expect(focused.classList.contains('prompt-text')).toBe(true);
    expect(focused.textContent).toContain(conn.state.pending!.prompt);
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain(conn.state.pending!.prompt);
  });

  it("a card's actions are a plain group of buttons (no menu role without menu keyboard handling)", async () => {
    renderPrompt(scenario(['Forest'], { p1: { hand: ['Forest'] } }));
    await click(/^Forest \(in hand\)/);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.getByRole('group', { name: 'Actions of Forest' })).toBeTruthy();
  });

  it("CR 601.2h: a rejected action's message goes away at the next interaction with the prompt", async () => {
    const s = scenario(['Grizzly Bears', 'Forest', 'Mountain'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Mountain'] } });
    const { conn } = renderPrompt(act(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'hand') }));
    await click('Pay by hand');
    await click('Pay with chosen sources');
    expect(conn.errors).toHaveLength(1);
    expect(screen.getByRole('alert')).toBeTruthy();
    await click(/^Mountain/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
