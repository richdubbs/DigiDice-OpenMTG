/**
 * r5-cost: a granted keyword whose cost is the card's mana cost (keywords/expand.ts, `KeywordAbilityDef.costIsManaCost`), played with synthetic cards (design 6.10).
 *
 *   CR 702.180a, 118.9, 613.1f   "target sorcery card in your graveyard gains harmonize until end of turn. Its harmonize cost is equal to its mana cost.": the
 *                                card can be cast from the graveyard for its own mana cost, then is exiled; the permission ends with the turn
 *   CR 702.128a, 118.9           "... gains embalm until end of turn. The embalm cost is equal to its mana cost.": exile it and pay its mana cost: a token copy
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, legalActions, type GameState } from '../../../src/index';
import { act, activations, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const BARD = card('Test Song Bard', 'Creature — Human Bard', 'When this creature enters, target instant or sorcery card in your graveyard gains harmonize until end of turn. Its harmonize cost is equal to its mana cost.', '{0}', PT);
const SHROUD = card('Test Grave Shroud', 'Artifact', '{T}: Target creature card in your graveyard gains embalm until end of turn. The embalm cost is equal to its mana cost.', '{0}');
const BLAST = card('Test Blast', 'Sorcery', 'Test Blast deals 3 damage to target player.', '{1}{R}');
const BEAST = card('Test Beast', 'Creature — Beast', '', '{2}{G}', ['3', '3']);
const DEFS = [BARD, SHROUD, BLAST, BEAST];

const methods = (s: GameState, name: string): string[] =>
  legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name).map((a) => (a.action as { method?: string }).method ?? 'normal');

describe('r5-cost: a granted keyword whose cost is the card\'s mana cost', () => {
  it('the cards are automated', () => {
    for (const d of [BARD, SHROUD]) expect(full(d), d.name).toBe(true);
  });

  it('CR 702.180a, 118.9: the sorcery is cast from the graveyard for {1}{R} (its mana cost), then exiled', () => {
    const s0 = scenario(['Mountain', 'Forest'], { defs: DEFS, p1: { hand: ['Test Song Bard'], graveyard: ['Test Blast'], battlefield: ['Mountain', 'Mountain'] } });
    const blast = find(s0, 'Test Blast', 'graveyard', 'p1');
    const s1 = resolveAll(cast(s0, 'Test Song Bard'), { targets: [[obj(blast)]] });
    expect(methods(s1, 'Test Blast')).toEqual(['harmonize']);
    const s2 = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: blast, method: 'harmonize' }), { targets: [[{ kind: 'player', id: 'p2' }]], objects: [[]] }));
    expect(lifeOf(s2, 'p2')).toBe(17);
    expect(s2.zones.exile.map((id) => s2.objects[id]!.defId)).toContain('Test Blast'); // CR 702.180a: exiled as it leaves the stack
    expect(s2.zones.battlefield.filter((id) => s2.objects[id]!.tapped)).toHaveLength(2); // {1}{R} paid
  });

  it('CR 702.180a: with no land the {R} of the cost can\'t be paid (tapping the 2-power Bard pays generic mana only), so no harmonize cast is offered', () => {
    const s0 = scenario(['Mountain', 'Forest'], { defs: DEFS, p1: { hand: ['Test Song Bard'], graveyard: ['Test Blast'] } });
    const blast = find(s0, 'Test Blast', 'graveyard', 'p1');
    const s1 = resolveAll(cast(s0, 'Test Song Bard'), { targets: [[obj(blast)]] });
    expect(methods(s1, 'Test Blast')).toEqual([]);
  });

  it('CR 702.128a, 118.9: embalm for {2}{G} (the card\'s mana cost) makes a token copy and exiles the card', () => {
    const s0 = scenario(['Mountain', 'Forest'], { defs: DEFS, p1: { battlefield: ['Test Grave Shroud', 'Forest', 'Forest', 'Forest'], graveyard: ['Test Beast'] } });
    const beast = find(s0, 'Test Beast', 'graveyard', 'p1');
    const s1 = resolveAll(drive(act(s0, activations(s0, 'Test Grave Shroud')[0]!.action), { targets: [[obj(beast)]] }));
    const embalm = legalActions(s1, 'p1').filter((a) => a.kind === 'activate' && a.object === beast);
    expect(embalm).toHaveLength(1);
    const s2 = resolveAll(drive(act(s1, embalm[0]!.action)));
    const token = s2.zones.battlefield.filter((id) => !s1.zones.battlefield.includes(id));
    expect(token).toHaveLength(1); // the token copy, a white Zombie Beast (CR 702.128a)
    expect(charsOfObject(s2, s2.objects[token[0]!]!).subtypes).toEqual(expect.arrayContaining(['Beast', 'Zombie']));
    expect(s2.zones.exile.map((id) => s2.objects[id]!.defId)).toContain('Test Beast');
    expect(s2.zones.battlefield.filter((id) => s2.objects[id]!.tapped)).toHaveLength(4); // the Shroud and {2}{G}
  });
});
