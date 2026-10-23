/**
 * M11-2 (docs/design/m11-commander.md 5.2, 5.4): the command zone panel beside each player's piles and the commander damage on the life disc, drawn from the
 * views the engine sends (M11-0 contracts). A normal game draws neither.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GameState, LegalAction } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../../src/board';
import { commanderDamageLines, commanderInfos, commanderObject } from '../../src/board/commander';
import { smallConfig } from '../helpers';
import { GameSession, applyAction, legalActions, viewFor } from '@openmtg/engine';
import { commanderId, commanderState, view } from './fixtures';

afterEach(cleanup);

const player = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const zone = (name: string) => screen.getByRole('group', { name: `${name}'s command zone` });

describe('M11-2: the command zone panel (CR 408, 903.6, 903.8)', () => {
  it('CR 903.6: each player\'s commanders are shown in their command zone, with the tax; partners each have their own (CR 702.124d)', () => {
    const s = commanderState();
    render(<GameBoard view={view(s, 'p1')} />);
    const alice = within(zone('Alice'));
    expect(alice.getByRole('group', { name: 'Test Titania: In the command zone' })).toBeTruthy();
    expect(alice.getByText('Tax 0')).toBeTruthy();
    const bob = within(zone('Bob'));
    expect(bob.getByRole('group', { name: 'Test Kraum: In the command zone' })).toBeTruthy();
    expect(bob.getByRole('group', { name: 'Test Tymna: In the command zone' })).toBeTruthy();
    // The commanders' cards are the board's own card slots (zoom, highlights), not the plain command pile.
    expect(document.querySelector(`.command-zone .board-card[data-object-id="${commanderId(s, 'Test Titania')}"]`)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Alice's command: / })).toBeNull();
  });

  it('CR 903.8, 702.124d: the tax counts only that commander\'s own casts from the command zone', () => {
    const s = commanderState();
    player(s, 'p2').commanders![0]!.casts = 2; // Kraum cast twice: {4}; Tymna never
    const infos = commanderInfos(view(s, 'p1'), player(s, 'p2'));
    expect(infos.map((i) => [i.name, i.tax])).toEqual([['Test Kraum', 4], ['Test Tymna', 0]]);
    render(<GameBoard view={view(s, 'p1')} />);
    const kraum = within(within(zone('Bob')).getByRole('group', { name: 'Test Kraum: In the command zone' }));
    expect(kraum.getByRole('img', { name: '{4}' })).toBeTruthy();
  });

  it('a Cast button while the engine lists the cast, with the mana cost and the tax; it reports a click on the commander like the card itself', () => {
    const s = commanderState();
    player(s, 'p1').commanders![0]!.casts = 1;
    const titania = commanderId(s, 'Test Titania');
    const cast: LegalAction = { kind: 'cast', label: 'Cast Test Titania', isMana: false, object: titania, action: { type: 'cast', player: 'p1', card: titania } };
    const onObjectClick = vi.fn();
    const { rerender } = render(<GameBoard view={view(s, 'p1')} legalActions={[]} interaction={{ onObjectClick }} />);
    // Not listed: no button (CR 117.1: the engine says what can be done now).
    expect(within(zone('Alice')).queryByRole('button', { name: /^Cast/ })).toBeNull();
    rerender(<GameBoard view={view(s, 'p1')} legalActions={[cast]} interaction={{ onObjectClick }} />);
    const button = within(zone('Alice')).getByRole('button', { name: 'Cast {3}{G} + {2} tax' });
    fireEvent.click(button);
    expect(onObjectClick).toHaveBeenCalledWith(titania);
    // The card itself glows as playable, like a castable card in a hand.
    expect(document.querySelector(`.command-zone .board-card[data-object-id="${titania}"]`)!.getAttribute('data-highlight')).toBe('playable');
  });

  it('with the engine (M11-1): the cast from the command zone is listed and the button shows the cost and the tax', () => {
    let s = commanderState();
    for (let i = 0; i < 20 && !(s.turn.step === 'main1' && s.pending?.kind === 'priority' && s.pending.player === 'p1'); i++) {
      const r = applyAction(s, { type: 'pass', player: s.pending!.player });
      if (r.error) throw new Error(r.error.message);
      s = r.state;
    }
    expect(s.turn.step).toBe('main1');
    s = structuredClone(s);
    // Six untapped Forests for Alice (test setup), and one earlier cast of Titania: {3}{G} + {2}.
    const forests = s.zones.library.p1!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Forest').slice(0, 6);
    s.zones.library.p1 = s.zones.library.p1!.filter((id) => !forests.includes(id));
    for (const id of forests) s.objects[id] = { ...s.objects[id]!, zone: 'battlefield', tapped: false };
    s.zones.battlefield = [...s.zones.battlefield, ...forests];
    player(s, 'p1').commanders![0]!.casts = 1;
    const titania = commanderId(s, 'Test Titania');
    const legal = legalActions(s, 'p1');
    const cast = legal.filter((a) => a.object === titania && a.kind === 'cast');
    expect(cast.length).toBe(1);
    const onObjectClick = vi.fn();
    render(<GameBoard view={view(s, 'p1')} legalActions={legal} interaction={{ onObjectClick }} />);
    fireEvent.click(within(zone('Alice')).getByRole('button', { name: 'Cast {3}{G} + {2} tax' }));
    expect(onObjectClick).toHaveBeenCalledWith(titania);
  });

  it('CR 702.49d: another action of the commander there (commander ninjutsu) shows the engine\'s own label', () => {
    const s = commanderState();
    const titania = commanderId(s, 'Test Titania');
    const ninjutsu: LegalAction = { kind: 'activate', label: 'Test Titania: commander ninjutsu {1}{G}', isMana: false, object: titania, action: { type: 'activate', player: 'p1', source: titania, ability: 0 } as never };
    const onObjectClick = vi.fn();
    render(<GameBoard view={view(s, 'p1')} legalActions={[ninjutsu]} interaction={{ onObjectClick }} />);
    fireEvent.click(within(zone('Alice')).getByRole('button', { name: 'Test Titania: commander ninjutsu {1}{G}' }));
    expect(onObjectClick).toHaveBeenCalledWith(titania);
  });

  it('CR 400.2: a commander in a hidden zone is "out of sight" to everybody who cannot see it; its card (public, CR 903.6) still shows', () => {
    const s = commanderState();
    const titania = commanderId(s, 'Test Titania');
    // Titania went into its owner's library (CR 903.9b answered "no"): nobody may see it there.
    s.zones.command = s.zones.command.filter((id) => id !== titania);
    s.zones.library.p1 = [titania, ...s.zones.library.p1!];
    s.objects[titania] = { ...s.objects[titania]!, zone: 'library' };
    for (const viewer of ['p1', 'p2', null]) {
      const v = view(s, viewer);
      expect(commanderObject(v, player(s, 'p1').commanders![0]!.card)).toBeUndefined();
      expect(commanderInfos(v, player(s, 'p1'))[0]!.zone).toBeNull();
    }
    render(<GameBoard view={view(s, 'p2')} />);
    const slot = within(zone('Alice')).getByRole('group', { name: 'Test Titania: Out of sight' });
    expect(slot.querySelector('[data-object-id]')).toBeNull(); // no object linked: the card in the library stays a blank card
    expect(slot.textContent).toContain('Out of sight');
  });

  it('a commander in its owner\'s hand: "In your hand" for the owner, out of sight for the other player', () => {
    const s = commanderState();
    const titania = commanderId(s, 'Test Titania');
    s.zones.command = s.zones.command.filter((id) => id !== titania);
    s.zones.hand.p1 = [...s.zones.hand.p1!, titania];
    s.objects[titania] = { ...s.objects[titania]!, zone: 'hand' };
    expect(commanderInfos(view(s, 'p1'), player(s, 'p1'))[0]!.zone).toBe('hand');
    expect(commanderInfos(view(s, 'p2'), player(s, 'p1'))[0]!.zone).toBeNull();
    render(<GameBoard view={view(s, 'p1')} />);
    expect(within(zone('Alice')).getByRole('group', { name: 'Test Titania: In your hand' })).toBeTruthy();
  });

  it('a normal game draws no command zone panel and no commander damage', () => {
    const v = viewFor(new GameSession(smallConfig('m11-normal', { options: { skipMulligans: true, startingPlayer: 'p1' } })).state, 'p1');
    render(<GameBoard view={v} />);
    expect(document.querySelector('.command-zone')).toBeNull();
    expect(document.querySelector('.stat-commander-damage')).toBeNull();
  });
});

describe('M11-2: commander damage on the life disc (CR 903.10a, 704.6c)', () => {
  it('"N / 21" per commander that dealt combat damage to the player, highlighted from 15', () => {
    const s = commanderState();
    const kraum = player(s, 'p2').commanders![0]!.card;
    const tymna = player(s, 'p2').commanders![1]!.card;
    player(s, 'p1').commanderDamage = { [kraum]: 15, [tymna]: 4 };
    render(<GameBoard view={view(s, 'p1')} />);
    const disc = screen.getByRole('region', { name: 'Alice (you)' });
    const high = within(disc).getByLabelText('Commander damage from Test Kraum: 15 of 21');
    expect(high.textContent).toBe('Test Kraum 15 / 21');
    expect(high.classList.contains('is-high')).toBe(true);
    expect(high.getAttribute('data-commander-damage')).toBe(kraum); // the animator pops this line on a commanderDamage event
    const low = within(disc).getByLabelText('Commander damage from Test Tymna: 4 of 21');
    expect(low.classList.contains('is-high')).toBe(false);
    // Nothing on Bob's disc: no commander has damaged him.
    expect(within(screen.getByRole('region', { name: 'Bob' })).queryByLabelText(/Commander damage/)).toBeNull();
  });

  it('CR 903.12h: no line when the variant has no commander damage rule (driven by `damageLimit`, not by the variant\'s name)', () => {
    for (const variant of ['brawl', 'standardbrawl'] as const) {
      const s = commanderState(variant);
      player(s, 'p1').commanderDamage = { [player(s, 'p2').commanders![0]!.card]: 18 };
      expect(commanderDamageLines(view(s, 'p1'), player(s, 'p1'))).toEqual([]);
    }
    // Any variant whose data says null has none.
    const s = commanderState('commander');
    s.options.commander = { ...s.options.commander!, damageLimit: null };
    player(s, 'p1').commanderDamage = { [player(s, 'p2').commanders![0]!.card]: 18 };
    expect(commanderDamageLines(view(s, 'p1'), player(s, 'p1'))).toEqual([]);
    s.options.commander = { ...s.options.commander!, damageLimit: 21 };
    expect(commanderDamageLines(view(s, 'p1'), player(s, 'p1')).map((l) => [l.name, l.amount, l.limit, l.high])).toEqual([['Test Kraum', 18, 21, true]]);
  });
});
