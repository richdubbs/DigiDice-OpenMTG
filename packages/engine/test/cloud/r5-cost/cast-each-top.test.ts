/**
 * r5-cost: "exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs" (Etali,
 * Primal Storm: the cards of several libraries are one group, parser/lower/mentions.ts; zz-cloud/r3-cost.json eff.r3cost.cast.anyNumber.free.fromAmong, stable).
 *
 *   CR 406.1, 608.2c          the top card of each player's library is exiled; "those cards" are all of them
 *   CR 608.2g, 118.9, 305.9   the player casts any of the nonland ones, an opponent's card too, without paying their mana costs; they control those spells
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { answer, card, cast, full, passBoth, scenario } from './support';

const STORM = card('Test Primal Gale', 'Sorcery', "Exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.", '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{2}{R}', ['3', '3']);
const DEFS = [STORM, BEAR, OGRE];

function castChosen(s0: GameState, all: boolean): GameState {
  let s = s0;
  for (let guard = 0; guard < 30 && s.pending; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: all ? p.options : [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'priority' && s.zones.stack.length > 0) s = passBoth(s);
    else break;
  }
  return s;
}
const mine = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === 'p1').length;

describe('r5-cost: the top card of each player\'s library, then free casts among them', () => {
  it('the card is automated', () => expect(full(STORM)).toBe(true));

  it('CR 608.2g, 118.9: both exiled creature cards (one of each library) are cast for free; p1 controls both', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Primal Gale'], library: ['Test Bear'] }, p2: { library: ['Test Ogre'] } });
    const s = castChosen(cast(s0, 'Test Primal Gale'), true);
    expect(mine(s, 'Test Bear')).toBe(1);
    expect(mine(s, 'Test Ogre')).toBe(1);
  });

  it('CR 305.9: a land among them is not cast; choosing none leaves them exiled', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Primal Gale'], library: ['Forest'] }, p2: { library: ['Test Ogre'] } });
    const none = castChosen(cast(s0, 'Test Primal Gale'), false);
    expect(none.zones.exile.map((id) => none.objects[id]!.defId).sort()).toEqual(['Forest', 'Test Ogre']);
    const all = castChosen(cast(s0, 'Test Primal Gale'), true);
    expect(mine(all, 'Test Ogre')).toBe(1);
    expect(all.zones.exile.map((id) => all.objects[id]!.defId)).toEqual(['Forest']);
  });
});
