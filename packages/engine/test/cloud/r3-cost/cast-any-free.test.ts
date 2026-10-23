/**
 * r3-cost: "You may cast any number of spells [with mana value X or less] from among them without paying their mana costs." after cards were exiled from the top
 * of a library (zz-cloud/r3-cost.json eff.r3cost.cast.anyNumber.free.*; render/fold.ts#castAnyFromExiledFree), and Kotis's "exile the top X cards of their
 * library, where X is the amount of damage dealt" whose X the next sentence reads too (parser/lower/quantities.ts), played with synthetic cards (design 6.10).
 *
 *   CR 608.2g, 601.2   the player casts each chosen card while the effect resolves, in the order chosen; no priority in between
 *   CR 118.9           without paying their mana costs; CR 305.9: a land is never cast (nonland cards only)
 *   CR 202.3           "with mana value X or less": a card above the limit is not offered
 *   CR 107.3, 608.2h   the X defined by "where X is the amount of damage dealt" is the X of the next sentence too
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { answer, card, cast, find, full, passBoth, scenario } from './support';

const SPELUNK = card('Test Deep Delve', 'Sorcery', 'Exile the top three cards of your library. You may cast any number of spells from among them without paying their mana costs.', '{0}');
const PICKY = card('Test Picky Delve', 'Sorcery', 'Exile the top three cards of your library. You may cast any number of spells with mana value 2 or less from among them without paying their mana costs.', '{0}');
const FANG = card('Test Fang Keeper', 'Creature — Zombie Warrior', 'Whenever Test Fang Keeper deals combat damage to a player, exile the top X cards of their library, where X is the amount of damage dealt. You may cast any number of spells with mana value X or less from among them without paying their mana costs.', '{1}{U}{B}', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{2}{R}', ['3', '3']);
const DEFS = [SPELUNK, PICKY, FANG, BEAR, OGRE];

const onField = (s: GameState, name: string, p = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === p).length;
const exiled = (s: GameState, name: string): number => s.zones.exile.filter((id) => s.objects[id]!.defId === name).length;
/** Answer the choice of the cards to cast with every option offered (or none), then let the casts and the stack resolve. */
function castAll(s0: GameState, all: boolean): GameState {
  let s = s0;
  for (let guard = 0; guard < 30; guard++) {
    const p = s.pending;
    if (!p) break;
    if (p.kind === 'chooseObjects') { s = answer(s, { kind: 'chooseObjects', ids: all ? p.options : [] }); continue; }
    if (p.kind === 'order') { s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) }); continue; }
    if (p.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
    if (p.kind === 'priority' && s.zones.stack.length > 0) { s = passBoth(s); continue; }
    break;
  }
  return s;
}

describe('r3-cost: "You may cast any number of spells from among them without paying their mana costs" (CR 608.2g, 118.9)', () => {
  it('the cards are automated (the plain form is stable since r5-cost: Etali, Primal Storm)', () => {
    for (const d of [PICKY, FANG, BEAR, OGRE]) expect(full(d), d.name).toBe(true);
    expect(SPELUNK.faces[0]!.abilities.every((a) => a.kind !== 'manual') && !JSON.stringify(SPELUNK.faces).includes('"op":"manual"')).toBe(true);
  });
  it('the two creature cards exiled are both cast for free and resolve; the land stays in exile (CR 305.9)', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Deep Delve'], battlefield: ['Forest', 'Forest', 'Forest'], library: ['Test Bear', 'Forest', 'Test Ogre'] } });
    s = castAll(cast(s, 'Test Deep Delve'), true);
    expect(onField(s, 'Test Bear')).toBe(1);
    expect(onField(s, 'Test Ogre')).toBe(1);
    expect(exiled(s, 'Forest')).toBe(1);
  });
  it('choosing none casts nothing: the cards stay in exile', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Deep Delve'], battlefield: ['Forest', 'Forest', 'Forest'], library: ['Test Bear', 'Forest', 'Test Ogre'] } });
    s = castAll(cast(s, 'Test Deep Delve'), false);
    expect(onField(s, 'Test Bear') + onField(s, 'Test Ogre')).toBe(0);
    expect(exiled(s, 'Test Bear') + exiled(s, 'Test Ogre')).toBe(2);
  });
  it('CR 202.3: "with mana value 2 or less": the Bear is cast, the Ogre (mana value 3) is not offered', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Picky Delve'], battlefield: ['Forest', 'Forest', 'Forest'], library: ['Test Bear', 'Forest', 'Test Ogre'] } });
    s = castAll(cast(s, 'Test Picky Delve'), true);
    expect(onField(s, 'Test Bear')).toBe(1);
    expect(exiled(s, 'Test Ogre')).toBe(1);
  });
  it('CR 107.3, 608.2h: Kotis-like: 2 combat damage exiles the top two cards of the damaged player\'s library and lets you cast those with mana value 2 or less', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Fang Keeper'] }, p2: { library: ['Test Bear', 'Test Ogre', 'Test Bear'] } });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Fang Keeper', 'battlefield', 'p1')]]);
    for (let guard = 0; guard < 40 && !(s.zones.exile.length > 0 && s.zones.stack.length === 0 && s.pending?.kind === 'priority'); guard++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = passBoth(s);
      else s = castAll(s, true);
    }
    expect(exiled(s, 'Test Ogre')).toBe(1); // mana value 3: not castable
    expect(onField(s, 'Test Bear', 'p1')).toBe(1); // the opponent's Bear, cast by p1 (CR 608.2g)
    expect(s.zones.library.p2!.map((id) => s.objects[id]!.defId)[0]).toBe('Test Bear');
  });
});
