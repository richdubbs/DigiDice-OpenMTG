/**
 * std-freecast-3 (lane std-freecast): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 702.188a, 118.9, 613.1f, 105.2  "Each legendary spell you cast that's one or more colors has web-slinging {G}.": a legendary green creature card in hand is
 *                                      offered web-slinging (pay {G} and return a tapped creature you control); a colorless legendary spell and a nonlegendary
 *                                      green spell are not; an opponent's legendary spell is not
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, card, drive, find, full, named, resolveAll, scenario } from '../r3-cost/support';

const WEAVER = card('Test Web Weaver', 'Creature — Spider', "Each legendary spell you cast that's one or more colors has web-slinging {G}.", '{1}{G}', ['1', '1'], ['G']);
const HERO = card('Test Grove Hero', 'Legendary Creature — Elf', '', '{5}{G}', ['5', '5'], ['G']);
const RELIC = card('Test Old Relic', 'Legendary Artifact', '', '{5}');
const BRUTE = card('Test Grove Brute', 'Creature — Beast', '', '{5}{G}', ['5', '5'], ['G']);
const DEFS = [WEAVER, HERO, RELIC, BRUTE];

const methods = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): (string | undefined)[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);

describe('std-freecast-3: the synthetic cards are automated', () => {
  it('every synthetic card but the experimental-capped one is full; the Weaver\'s ability is automated', () => {
    for (const d of [HERO, RELIC, BRUTE]) expect(full(d), d.name).toBe(true);
    expect(WEAVER.automation.faces![0]!.abilities.every((a) => a.level === 'full')).toBe(true);
  });
});

describe('CR 702.188a, 118.9, 613.1f, 105.2: "Each legendary spell you cast that\'s one or more colors has web-slinging {G}."', () => {
  const board = (): GameState => {
    const s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Web Weaver', 'Forest'], hand: ['Test Grove Hero', 'Test Old Relic', 'Test Grove Brute'] }, p2: { hand: ['Test Grove Hero'], battlefield: ['Forest'] } });
    const weaver = find(s, 'Test Web Weaver', 'battlefield', 'p1');
    s.objects[weaver]!.tapped = true; // a tapped creature to return
    return s;
  };
  it('a legendary green creature spell is cast for {G} by returning the tapped Weaver to its owner\'s hand', () => {
    let s = board();
    const hero = find(s, 'Test Grove Hero', 'hand', 'p1');
    expect(methods(s, hero)).toEqual(['web-slinging']); // one Forest: only web-slinging is payable
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: hero, method: 'web-slinging' }), { objects: [[find(s, 'Test Web Weaver', 'battlefield', 'p1')]] }));
    expect(named(s, 'Test Grove Hero')).toHaveLength(1);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Web Weaver');
  });
  it('a colorless legendary spell, a nonlegendary green spell and the opponent\'s legendary spell are not offered web-slinging', () => {
    const s = board();
    expect(methods(s, find(s, 'Test Old Relic', 'hand', 'p1'))).not.toContain('web-slinging');
    expect(methods(s, find(s, 'Test Grove Brute', 'hand', 'p1'))).not.toContain('web-slinging');
    expect(methods(s, find(s, 'Test Grove Hero', 'hand', 'p2'), 'p2')).not.toContain('web-slinging');
  });
});
