/**
 * std-library-5 (account B lane std-library): Say Its Name's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 118.3, 113.6k, 201.2, 701.23a  "Exile this card and two other cards named ... from your graveyard: Search your graveyard, hand, and/or library for a card named
 *                                     <X, the Y> and put it onto the battlefield. ...": activated from the graveyard, the three copies exiled, the card found; with
 *                                     only one other copy in the graveyard it cannot be activated (the source is not one of the others)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, card, drive, find, full, legal, passBoth, scenario } from '../r5-cost/support';

const SUMMONS = card('Test Summons', 'Sorcery', 'Draw a card.\nExile this card and two other cards named Test Summons from your graveyard: Search your graveyard, hand, and/or library for a card named Test Beast, the Called and put it onto the battlefield. If you search your library this way, shuffle. Activate only as a sorcery.');
const BEAST = card('Test Beast, the Called', 'Legendary Creature — Beast', 'Trample', '{6}', ['6', '6']);
const DEFS = [SUMMONS, BEAST];
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const activations = (s: GameState) => legal(s, 'p1', 'activate').filter((a) => nameOf(s, a.object as ObjectId) === 'Test Summons');

describe('the synthetic card is automated', () => {
  it('plays fully', () => expect(full(SUMMONS), JSON.stringify(SUMMONS.automation)).toBe(true));
});

describe('CR 118.3, 113.6k, 201.2: "Exile this card and two other cards named Test Summons from your graveyard: Search ... for a card named Test Beast, the Called"', () => {
  it('from the graveyard, the three copies are exiled and the Beast is put onto the battlefield from the library', () => {
    let s = scenario([], { defs: DEFS, p1: { graveyard: ['Test Summons', 'Test Summons', 'Test Summons'], library: ['Plains', 'Test Beast, the Called'] } });
    const acts = activations(s);
    expect(acts.length).toBeGreaterThan(0);
    s = drive(act(s, acts[0]!.action));
    expect(s.zones.graveyard.p1).toHaveLength(0);
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Summons')).toHaveLength(3);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseOption'); // CR 701.23a: which of the zones ("and/or") are searched
    s = drive(s, { options: [['library']], objects: [[find(s, 'Test Beast, the Called', 'library', 'p1')]] });
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Beast, the Called')).toHaveLength(1);
  });
  it('with only one other copy in the graveyard it cannot be activated (the source does not count as one of the others)', () => {
    const s = scenario([], { defs: DEFS, p1: { graveyard: ['Test Summons', 'Test Summons'], library: ['Test Beast, the Called'] } });
    expect(activations(s)).toHaveLength(0);
  });
  it('the copies in hand do not count: two in the graveyard and one in hand, no activation', () => {
    const s = scenario([], { defs: DEFS, p1: { graveyard: ['Test Summons', 'Test Summons'], hand: ['Test Summons'], library: ['Test Beast, the Called'] } });
    expect(activations(s)).toHaveLength(0);
  });
});
