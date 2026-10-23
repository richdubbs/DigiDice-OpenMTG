/** Owner list 2026-10-21: token copies are marked, choices are grouped by controller, mode costs are read, a revealed hand is recognised. */
import type { CardDef, GameObject, GameView } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { isTokenCopy } from '../src/board/model';
import { chipGroups } from '../src/prompts/Chips';
import { modeCost, revealedHand } from '../src/prompts/ChoicePrompts';

const def = (typeLine: string, layout = 'normal'): CardDef => ({ id: 'd', name: 'Bear', layout, faces: [{ name: 'Bear', typeLine }], isToken: false }) as unknown as CardDef;
const obj = (id: string, extra: Partial<GameObject>): GameObject => ({ id, kind: 'card', defId: 'd', owner: 'p1', controller: 'p1', zone: 'battlefield', ...extra }) as GameObject;

function viewOf(objects: GameObject[]): GameView {
  return {
    viewer: 'p1',
    players: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }],
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    lki: {},
    zones: { hand: { p1: [], p2: objects.filter((o) => o.zone === 'hand' && o.owner === 'p2').map((o) => o.id) } },
  } as unknown as GameView;
}

describe('owner list 2026-10-21', () => {
  it('CR 111.10: a token copying a card is a token copy; a token from a token definition is not', () => {
    expect(isTokenCopy(obj('o1', { kind: 'token' }), def('Creature — Bear'))).toBe(true);
    expect(isTokenCopy(obj('o2', { kind: 'token' }), def('Token Creature — Soldier'))).toBe(false);
    expect(isTokenCopy(obj('o3', { kind: 'card' }), def('Creature — Bear'))).toBe(false);
  });

  it('groups choices by controller, the viewer first, players apart', () => {
    const view = viewOf([obj('a', { controller: 'p2' }), obj('b', {}), obj('c', { controller: 'p2' })]);
    expect(chipGroups(view, ['a', 'b', 'p2', 'c'])).toEqual([
      { key: '', title: 'Players', ids: ['p2'] },
      { key: 'p1', title: 'Yours', ids: ['b'] },
      { key: 'p2', title: "Bob's", ids: ['a', 'c'] },
    ]);
  });

  it('CR 700.2h: reads the additional cost printed before a mode', () => {
    expect(modeCost('+ {1} — Counter target spell.')?.length).toBe(1);
    expect(modeCost('• Draw a card.')).toBeNull();
  });

  it('CR 701.20b: a choice among cards of one other player’s hand is a revealed hand', () => {
    const view = viewOf([obj('h1', { zone: 'hand', owner: 'p2', controller: 'p2' }), obj('h2', { zone: 'hand', owner: 'p2', controller: 'p2' }), obj('b1', {})]);
    expect(revealedHand(view, ['h1', 'h2'])).toBe('p2');
    expect(revealedHand(view, ['h1', 'b1'])).toBeNull();
  });
});
