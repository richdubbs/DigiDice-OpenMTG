/** The priority prompt (CR 117): playable cards from legalActions, the per-card actions, mana sources collapsed, pass, keyboard shortcuts, the board bridge. */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '@openmtg/engine';
import { actionsByObject } from '../../src/prompts/PriorityPrompt';
import { act, click, clickEl, find, findAll, pendingKind, press, renderPrompt, scenario, tabTo } from './harness';

const board = () => scenario(['Forest', 'Grizzly Bears', 'Lightning Bolt'], { p1: { hand: ['Forest', 'Grizzly Bears', 'Lightning Bolt'], battlefield: ['Forest'] } });

/** A land with an ability that works from the hand (Otawara, Soaring City's shape, CR 113.6j; invented wording, design 6.10). */
const handLand = compileCard({
  name: 'Test Channel Land', oracle_id: '00000000-0000-4000-8000-0000000000c1', layout: 'normal', type_line: 'Legendary Land', mana_cost: '',
  oracle_text: '{T}: Add {U}.\n{1}{U}, Discard this card: Draw a card.',
} as OracleCard);
const handLandBoard = () => scenario(['Island'], { defs: [handLand], p1: { hand: ['Test Channel Land', 'Island'], battlefield: ['Island', 'Island'] } });

describe('priority prompt (CR 117.1)', () => {
  it('CR 117.1: lists exactly the cards the engine says can be played, and nothing unplayable; mana-only sources are behind one entry', async () => {
    const s = board();
    renderPrompt(s);
    const group = screen.getByRole('group', { name: 'Playable cards' });
    const names = [...group.querySelectorAll('button')].map((b) => b.textContent);
    // Forest (hand) can be played, Grizzly Bears costs {1}{G} with one Forest: not castable; the Forest on the battlefield can only tap for mana.
    expect(names.some((n) => n?.startsWith('Forest (in hand)'))).toBe(true);
    expect(names.some((n) => n?.startsWith('Grizzly Bears'))).toBe(false);
    expect(names.some((n) => n?.includes('mana'))).toBe(false);
    await click('Mana abilities (1)');
    const mana = screen.getByRole('group', { name: 'Mana abilities' });
    expect([...mana.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Forest · mana']);
  });

  it('CR 605.1a: thirty untapped lands are one "Mana abilities (30)" entry, and the Pass button comes before the card list', () => {
    const s = scenario(['Mountain', 'Lightning Bolt'], { p1: { hand: ['Lightning Bolt'], battlefield: Array<string>(30).fill('Mountain') } });
    renderPrompt(s);
    const playable = screen.getByRole('group', { name: 'Playable cards' });
    expect(within(playable).getAllByRole('button').map((b) => b.textContent)).toEqual(['Lightning Bolt (in hand)']);
    const toggle = screen.getByRole('button', { name: 'Mana abilities (30)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const pass = screen.getByRole('button', { name: 'Pass priority' });
    expect(pass.compareDocumentPosition(playable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The board still gets every source as clickable (it highlights them itself).
    expect(findAll(s, 'Mountain', 'battlefield').every((id) => screen.queryByRole('button', { name: `Board ${id}` }) !== null)).toBe(true);
  });

  it('CR 305.1: clicking a card lists its legal actions; choosing one sends exactly that action', async () => {
    const s = board();
    const { conn } = renderPrompt(s);
    const forest = find(s, 'Forest', 'hand', 'p1');
    await click(/^Forest \(in hand\)/);
    expect(screen.getByRole('group', { name: 'Actions of Forest' })).toBeTruthy();
    await click(/^Play Forest/);
    expect(conn.sent).toEqual([{ type: 'playLand', player: 'p1', card: forest }]);
    expect(conn.errors).toEqual([]);
    expect(conn.state.objects[forest]).toBeUndefined(); // CR 400.7: a new object on the battlefield
    expect(conn.state.zones.battlefield.length).toBe(2);
  });

  it('CR 601.2a: casting from the card\'s actions starts the cast (the next decision is asked)', async () => {
    const s = scenario(['Mountain', 'Lightning Bolt'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] } });
    const { conn } = renderPrompt(s);
    await click(/^Lightning Bolt/);
    await click(/^Cast Lightning Bolt/);
    expect(pendingKind(conn)).toBe('chooseTargets');
    expect(screen.getAllByText(/any target/).length).toBeGreaterThan(0);
  });

  it('ui/arena: a click on the board plays a card with one action at once (CR 305.1: the land is played), like Arena', async () => {
    const s = board();
    const { conn } = renderPrompt(s);
    const forest = find(s, 'Forest', 'hand', 'p1');
    await click(`Board ${forest}`);
    expect(conn.sent).toEqual([{ type: 'playLand', player: 'p1', card: forest }]);
    expect(conn.errors).toEqual([]);
    expect(screen.queryByRole('group', { name: 'Actions of Forest' })).toBeNull();
  });

  it('ui/arena: a click on the board opens the actions of a card with several (CR 715.3: the creature or its adventure), shown selected', async () => {
    const s = scenario(['Mountain', 'Bonecrusher Giant // Stomp'], { p1: { hand: ['Bonecrusher Giant // Stomp'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    const { conn } = renderPrompt(s);
    const giant = find(s, 'Bonecrusher Giant // Stomp', 'hand', 'p1');
    await click(`Board ${giant}`);
    expect(conn.sent).toEqual([]);
    expect(screen.getByRole('group', { name: /^Actions of / }).querySelectorAll('button').length).toBeGreaterThan(2);
    expect(screen.getByRole('button', { name: `Board ${giant}` }).getAttribute('data-selected')).toBe('true');
  });

  it('CR 305.1, 113.6j: a land with an ability from the hand opens its actions (play it or use the ability), never one of them at once', async () => {
    const s = handLandBoard();
    const { conn } = renderPrompt(s);
    const land = find(s, 'Test Channel Land', 'hand', 'p1');
    await click(`Board ${land}`);
    expect(conn.sent).toEqual([]);
    const menu = screen.getByRole('group', { name: 'Actions of Test Channel Land' });
    expect(within(menu).getByRole('button', { name: 'Play Test Channel Land' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: /Discard ~: Draw a card/ })).toBeTruthy();
    expect(within(menu).queryByText(/can't play it as a land/)).toBeNull();
    await clickEl(within(menu).getByRole('button', { name: 'Play Test Channel Land' }));
    expect(conn.sent).toEqual([{ type: 'playLand', player: 'p1', card: land }]);
  });

  it('CR 305.2: after the land drop, its ability from the hand (its only action) still opens the menu, which says why it can\'t be played', async () => {
    let s = handLandBoard();
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Island', 'hand', 'p1') });
    const { conn } = renderPrompt(s);
    const land = find(s, 'Test Channel Land', 'hand', 'p1');
    await click(`Board ${land}`);
    expect(conn.sent).toEqual([]);
    const menu = screen.getByRole('group', { name: 'Actions of Test Channel Land' });
    expect(within(menu).getByText(/can't play it as a land right now: you have already played a land this turn/)).toBeTruthy();
    expect(within(menu).queryByRole('button', { name: 'Play Test Channel Land' })).toBeNull();
    await clickEl(within(menu).getByRole('button', { name: /Discard ~: Draw a card/ }));
    expect(conn.sent[0]).toEqual({ type: 'activate', player: 'p1', source: land, ability: expect.any(String) });
    expect(conn.errors).toEqual([]);
  });

  it('CR 117.3d: the Pass button passes priority', async () => {
    const { conn } = renderPrompt(board());
    await click('Pass priority');
    expect(conn.sent).toEqual([{ type: 'pass', player: 'p1' }]);
    expect(conn.state.pending?.player).toBe('p2');
  });

  it('CR 117.3d: Space passes priority; Esc closes open card actions first', async () => {
    const s = board();
    const { conn } = renderPrompt(s);
    await click(/^Forest \(in hand\)/);
    await press('Escape');
    expect(screen.queryByRole('group', { name: 'Actions of Forest' })).toBeNull();
    expect(conn.sent).toEqual([]);
    await press(' ');
    expect(conn.sent).toEqual([{ type: 'pass', player: 'p1' }]);
    expect(conn.state.pending?.player).toBe('p2');
  });

  it('Space is left to a button focused with the keyboard (it activates that button, not the pass)', async () => {
    const s = board();
    const { conn } = renderPrompt(s);
    await tabTo(screen.getByRole('button', { name: /^Forest \(in hand\)/ }));
    await press(' ');
    expect(conn.sent).toEqual([]);
  });

  it('groups legal actions by object and leaves pass out', () => {
    const grouped = actionsByObject([
      { action: { type: 'pass', player: 'p1' }, kind: 'pass', label: 'Pass priority', isMana: false },
      { action: { type: 'playLand', player: 'p1', card: 'o1' }, kind: 'playLand', label: 'Play Forest', isMana: false, object: 'o1' },
      { action: { type: 'activate', player: 'p1', source: 'o2', ability: 'r:basic:G' }, kind: 'activate', label: 'Forest: add G', isMana: true, object: 'o2' },
      { action: { type: 'cast', player: 'p1', card: 'o1' }, kind: 'cast', label: 'Cast', isMana: false, object: 'o1' },
    ]);
    expect([...grouped.keys()]).toEqual(['o1', 'o2']);
    expect(grouped.get('o1')!.map((a) => a.label)).toEqual(['Play Forest', 'Cast']);
  });
});
