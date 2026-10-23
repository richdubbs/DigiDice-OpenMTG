/**
 * FAST5X E6: the plot special action in the priority prompt (CR 116.2k, 702.170a): a click on a card with plot in the hand opens its menu (a special action is
 * never taken by one click), whose hint says what plotting does; the button sends the special action. Real engine state (the prompts harness).
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { click, find, renderPrompt, scenario } from '../prompts/harness';

describe('CR 116.2k, 702.170a: plotting a card from the hand', () => {
  it('a click on the card opens its menu with the plot hint; the button sends the special action', async () => {
    const s = scenario(['Djinn of Fool\'s Fall', 'Island'], { p1: { hand: ['Djinn of Fool\'s Fall'], battlefield: Array(5).fill('Island') as string[] } });
    const id = find(s, "Djinn of Fool's Fall", 'hand', 'p1');
    const { conn } = renderPrompt(s);
    await click(`Board ${id}`);
    expect(conn.sent).toEqual([]); // cast or plot: the menu opened
    const group = screen.getByRole('group', { name: 'Plot' });
    expect(group.textContent).toContain('Plotting is a special action');
    expect(group.textContent).toContain('CR 116.2k, 702.170a, 702.170d');
    await click("Plot Djinn of Fool's Fall ({3}{U})");
    expect(conn.sent[0]).toEqual({ type: 'special', player: 'p1', kind: 'plot', object: id });
    expect(conn.errors).toEqual([]);
  });
});
