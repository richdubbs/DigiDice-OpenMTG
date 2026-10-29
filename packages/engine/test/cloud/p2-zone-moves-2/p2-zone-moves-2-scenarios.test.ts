/**
 * p2-zone-moves-2 (Phase 2 lane p2-zone-moves): after a reveal until, "put that card into your hand and the rest (all other cards revealed this way) into your graveyard"
 * and "... and exile all other cards revealed this way", played through the engine with synthetic cards (wordings invented, design 6.10). CR cites from memory, unverified.
 *
 *   CR 701.20a, 608.2c, 400.7   the card the reveal stopped at goes to your hand; the other revealed cards to the graveyard (or exile); the unrevealed cards stay
 *   CR 701.20b                  no such card: every card of the library is revealed and all of them go to the other zone (the hand gets nothing)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, card, drive, full, legal, passBoth, scenario } from '../r5-cost/support';

const DIGGER = card('Test Grove Digger', 'Creature — Human Druid', '{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.', '{0}', ['1', '1']);
const SEEKER = card('Test Dark Seeker', 'Instant', 'Reveal cards from the top of your library until you reveal an artifact card. Put that card into your hand and exile all other cards revealed this way.');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const RELIC = card('Test Relic', 'Artifact', '', '{2}');
const DEFS = [DIGGER, SEEKER, BEAR, RELIC];
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id)).sort();

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [DIGGER, SEEKER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('CR 701.20a, 608.2c: "Put that card into your hand and all other cards revealed this way into your graveyard."', () => {
  it('two Bears revealed before the Forest: the Forest to the hand, the Bears to the graveyard, the card under the Forest stays', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Grove Digger', 'Forest'], library: ['Test Bear', 'Test Bear', 'Forest', 'Test Relic'] } });
    s = drive(act(s, legal(s, 'p1', 'activate').find((a) => a.object !== undefined && nameOf(s, a.object) === 'Test Grove Digger' && !a.isMana)!.action));
    s = drive(passBoth(s));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Forest']);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Bear', 'Test Bear']);
    expect(nameOf(s, s.zones.library.p1![0]!)).toBe('Test Relic');
  });
});

describe('CR 701.20a, 701.20b, 406.1: "Put that card into your hand and exile all other cards revealed this way."', () => {
  it('the Relic to the hand, the Bear before it exiled', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Dark Seeker'], library: ['Test Bear', 'Test Relic', 'Test Bear'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Dark Seeker')! }));
    s = drive(passBoth(s));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Relic']);
    expect(names(s, s.zones.exile)).toEqual(['Test Bear']);
  });
  it('no artifact in the library: every card is revealed and exiled, nothing goes to the hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Dark Seeker'], library: ['Test Bear'] } });
    const libSize = s.zones.library.p1!.length; // the scenario keeps the library filled with Plains
    s = drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Dark Seeker')! }));
    s = drive(passBoth(s));
    expect(s.zones.hand.p1).toHaveLength(0);
    expect(s.zones.exile).toHaveLength(libSize);
  });
});
