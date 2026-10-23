/**
 * Lands the player may play from their graveyard ("You may play lands from your graveyard", Crucible of Worlds, CR 305.1) are shown in the hand with their own
 * glow: at the right end, marked as from the graveyard, playable like a hand card. Only the land plays the game offers count.
 */
import { fireEvent, render } from '@testing-library/react';
import type { GameView, LegalAction, ObjectId } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../../src/board';
import { graveyardLandPlays } from '../../src/board/Hand';
import { ALICE, BOB, editable, playGame } from './fixtures';

const game = playGame(3);
const main = () => game.captured.find((x) => x.turn === 3 && x.step === 'main1' && x.view.viewer === ALICE)!;
const nameOf = (view: GameView, id: ObjectId) => view.defs[view.objects[id]!.defId]!.name;

/** The view with one of Alice's hand Forests moved to her graveyard (as if it had been discarded), and the land play the game would offer for it. */
function withGraveyardForest(): { view: GameView; forest: ObjectId; legal: LegalAction[] } {
  const view = editable(main().view);
  const forest = view.zones.hand[ALICE]!.find((id) => nameOf(view, id) === 'Forest')!;
  view.zones.hand[ALICE] = view.zones.hand[ALICE]!.filter((id) => id !== forest);
  view.zones.graveyard[ALICE] = [...(view.zones.graveyard[ALICE] ?? []), forest];
  view.objects[forest]!.zone = 'graveyard';
  const legal: LegalAction[] = [
    { action: { type: 'pass', player: ALICE }, kind: 'pass', label: 'Pass', isMana: false },
    { action: { type: 'playLand', player: ALICE, card: forest }, kind: 'playLand', label: 'Play Forest', isMana: false, object: forest },
  ];
  return { view, forest, legal };
}

describe('lands playable from the graveyard are shown in the hand (CR 305.1)', () => {
  it('the land joins the hand at its right end, marked as from the graveyard and glowing as playable; a click plays it', () => {
    const { view, forest, legal } = withGraveyardForest();
    const onObjectClick = vi.fn();
    const { container } = render(<GameBoard view={view} legalActions={legal} interaction={{ onObjectClick }} />);
    const hand = container.querySelector<HTMLElement>('.hand-own')!;
    const cards = [...hand.querySelectorAll<HTMLElement>(':scope > .hand-card')];
    expect(cards).toHaveLength(view.zones.hand[ALICE]!.length + 1);
    const last = cards[cards.length - 1]!;
    expect(last.classList.contains('is-from-graveyard')).toBe(true);
    expect(last.getAttribute('data-from-zone')).toBe('graveyard');
    expect(cards.filter((c) => c.classList.contains('is-from-graveyard'))).toHaveLength(1);
    expect(hand.getAttribute('aria-label')).toBe(`${view.players.find((p) => p.id === ALICE)!.name}'s hand (${view.zones.hand[ALICE]!.length}) and 1 land you may play from your graveyard`);
    expect(hand.style.getPropertyValue('--hand-n')).toBe(String(cards.length));
    const slot = last.querySelector<HTMLElement>(`[data-object-id="${forest}"]`)!;
    expect(slot.getAttribute('data-highlight')).toBe('playable');
    fireEvent.click(slot);
    expect(onObjectClick).toHaveBeenCalledWith(forest);
  });

  it('a graveyard land the game offers no land play for stays in the graveyard only', () => {
    const { view, forest } = withGraveyardForest();
    const { container } = render(<GameBoard view={view} legalActions={[]} />);
    expect(container.querySelector('.hand-own .is-from-graveyard')).toBeNull();
    expect(container.querySelector(`.hand-own [data-object-id="${forest}"]`)).toBeNull();
  });

  it('only land plays from the player\'s own graveyard count', () => {
    const { view, forest, legal } = withGraveyardForest();
    expect(graveyardLandPlays(view, legal, ALICE)).toEqual([forest]);
    expect(graveyardLandPlays(view, legal, BOB)).toEqual([]);
    const castOnly: LegalAction[] = [{ action: { type: 'cast', player: ALICE, card: forest }, kind: 'cast', label: 'Cast', isMana: false, object: forest }];
    expect(graveyardLandPlays(view, castOnly, ALICE)).toEqual([]);
  });
});
