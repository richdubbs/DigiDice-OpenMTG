/**
 * Searching a library on the board's stage: the search opens by itself, shows only the cards it can find (CR 701.23a-b) left to
 * right with the rightmost on top, and a click chooses a card. Marshals' Pathcruiser: "When this Vehicle enters, search your library for a basic land card,
 * reveal it, put it into your hand, then shuffle."
 */
import { act as reactAct, fireEvent, render, within } from '@testing-library/react';
import { viewFor, type GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { useGameView } from '../../src/connection/useGame';
import { searchedLibrary, searchOrder } from '../../src/prompts/ChoicePrompts';
import { PromptBar } from '../../src/prompts/PromptBar';
import { PromptSelectionProvider, SelectionStore } from '../../src/prompts/selection';
import { castAuto, find, passUntil, scenario, StateConnection } from './harness';

function Board({ conn }: { conn: StateConnection }) {
  const view = useGameView(conn);
  return <GameBoard view={view} prompt={<PromptBar connection={conn} armDelayMs={0} />} />;
}

function renderOnBoard(state: GameState) {
  const conn = new StateConnection(state);
  const utils = render(
    <PromptSelectionProvider store={new SelectionStore()}>
      <Board conn={conn} />
    </PromptSelectionProvider>,
  );
  return { conn, ...utils };
}

/** The Pathcruiser's enters trigger asking which basic land to find; the library also holds cards the search can't find. */
function searching(): GameState {
  let s = scenario(["Marshals' Pathcruiser", 'Forest', 'Island', 'Grizzly Bears', 'Lightning Bolt'], {
    p1: { hand: ["Marshals' Pathcruiser"], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Grizzly Bears', 'Island', 'Lightning Bolt', 'Forest'] },
  });
  s = castAuto(s, "Marshals' Pathcruiser");
  return passUntil(s, (x) => x.pending?.kind === 'chooseObjects', 'the search');
}

const stage = () => document.querySelector<HTMLElement>('.prompt-stage')!;
const slots = () => [...stage().querySelectorAll<HTMLElement>('.prompt-search .prompt-search-slot')];

describe('searching a library (CR 701.23)', () => {
  it('opens by itself and shows only the cards the search can find, by name, left to right', () => {
    const s = searching();
    renderOnBoard(s);
    const st = stage();
    expect(st.getAttribute('aria-label')).toBe('Search your library');
    const names = slots().map((el) => el.getAttribute('aria-label'));
    // Every basic land of the library (the scenario's library also holds 20 Plains), never Grizzly Bears or Lightning Bolt.
    expect(names[0]).toBe('Forest');
    expect(names[1]).toBe('Island');
    expect(names.slice(2).every((n) => n === 'Plains')).toBe(true);
    expect(names).not.toContain('Grizzly Bears');
    expect(names).not.toContain('Lightning Bolt');
    const library = s.zones.library.p1!.length;
    expect(st.querySelector('.prompt-stage-sub')!.textContent).toBe(`Choose up to 1 (0 chosen). ${names.length} of the ${library} cards in your library can be chosen.`);
    // The fan knows how many cards it lays out (the CSS overlaps them to fit; later cards are on top).
    expect(st.querySelector<HTMLElement>('.prompt-search')!.style.getPropertyValue('--search-n')).toBe(String(names.length));
    // No stage card is a board card.
    expect(st.querySelector('[data-object-id]')).toBeNull();
  });

  it('a click chooses a card (a second click takes it back); OK puts it into the hand', async () => {
    const s = searching();
    const { conn } = renderOnBoard(s);
    const forest = slots()[0]!;
    await reactAct(async () => {
      fireEvent.click(forest);
    });
    expect(forest.getAttribute('aria-pressed')).toBe('true');
    expect(within(forest).getByText('Chosen')).toBeTruthy();
    expect(stage().querySelector('.prompt-stage-sub')!.textContent).toContain('(1 chosen)');
    await reactAct(async () => {
      fireEvent.click(forest);
    });
    expect(forest.getAttribute('aria-pressed')).toBe('false');
    await reactAct(async () => {
      fireEvent.click(forest);
    });
    await reactAct(async () => {
      fireEvent.click(within(stage()).getByRole('button', { name: 'OK' }));
    });
    expect(conn.errors).toEqual([]);
    expect(find(conn.state, 'Forest', 'hand', 'p1')).toBeTruthy();
  });

  it('only a choice among cards of one library is a search', () => {
    const s = searching();
    const view = viewFor(s, 'p1');
    const options = (s.pending as { options: string[] }).options;
    expect(searchedLibrary(view, options)).toBe('p1');
    expect(searchedLibrary(view, [...options, find(s, 'Plains', 'battlefield')])).toBeNull();
    expect(searchOrder(view, options).slice(0, 2).map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Forest', 'Island']);
  });
});
