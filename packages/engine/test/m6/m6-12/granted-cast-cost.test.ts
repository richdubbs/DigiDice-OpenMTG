/**
 * M6-12: `feature:castCost.granted` (m6 design 3.8; tier S1's last card, The Fugitive Doctor: "target instant or sorcery card in your graveyard gains flashback
 * {2}{R}{G} until end of turn"): the cast path reads the additional and alternative costs of abilities GRANTED to the card where it is (CR 601.2b, 613.1f,
 * 702.34a), not only its printed face. The card is an invented one compiled by the default compiler from its text (design 6.10: synthetic wording), so the
 * template that grants the keyword is the game's own.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, find, scenario } from '../../m5/helpers';
import { cast, drive, resolveTop, target } from '../../m5/cr-examples/helpers';
import { lifeOf } from '../../m4/helpers';

const GRANTER: CardDef = compileCard({
  name: 'Test Second Chance', layout: 'normal', mana_cost: '{U}', type_line: 'Instant', colors: ['U'],
  oracle_text: 'Target instant or sorcery card in your graveyard gains flashback {1}{R} until end of turn.',
} as OracleCard);

const board = (): GameState =>
  scenario(['Shock', 'Island', 'Mountain'], { p1: { hand: ['Test Second Chance'], graveyard: ['Shock'], battlefield: ['Island', 'Mountain', 'Mountain'] }, defs: [GRANTER] });

const flashbackOffered = (s: GameState): boolean =>
  legalActions(s, 'p1').some((a) => a.kind === 'cast' && (a.action as { method?: string }).method === 'flashback');

describe('m6 design 3.8: cast costs granted to a card (feature:castCost.granted)', () => {
  it('feature:castCost.granted is a capability (feature:castCost.lasting is not), and the granting card is full', () => {
    expect(ENGINE_CAPABILITIES.has('feature:castCost.granted')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:castCost.lasting')).toBe(false);
    expect(GRANTER.automation.level).toBe('full');
  });

  it('CR 702.34a, 613.1f: Shock in the graveyard gains flashback {1}{R}: it is cast from the graveyard for that cost and exiled as it resolves', () => {
    let s = board();
    expect(flashbackOffered(s)).toBe(false); // Shock has no flashback of its own
    const shock = find(s, 'Shock', 'graveyard');
    s = resolveTop(cast(s, 'Test Second Chance', [target(shock)]));
    expect(flashbackOffered(s)).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'graveyard'), method: 'flashback' }), [target('p2')]);
    expect(s.objects[s.zones.stack[0]!]!.stack?.costsPaid.alternative).toBe('flashback'); // CR 118.9
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(3); // {U} and {1}{R}
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Shock']); // CR 702.34a: exiled instead
  });

  it('CR 514.2, 611.2a: the granted flashback ends with the turn', () => {
    let s = board();
    s = resolveTop(cast(s, 'Test Second Chance', [target(find(s, 'Shock', 'graveyard'))]));
    expect(flashbackOffered(s)).toBe(true);
    s = advanceTo(s, 3, 'main1'); // Alice's next turn
    expect(flashbackOffered(s)).toBe(false);
  });

  // Review fix: a grant from a permanent's STATIC ability (CR 604.1, 611.3a) is applied by the layer system without any entry in `s.continuousEffects`; the
  // cast path read granted costs only when that list was non-empty, so a full card with a static grant offered nothing (fail-closed broken).
  it('CR 604.1, 611.3a, 613.1f, 702.34a: a static ability grants flashback to cards in the graveyard; the cost is offered and paid while the source is there', () => {
    const STATIC: CardDef = compileCard({
      name: 'Test Ember Archive', layout: 'normal', mana_cost: '{2}{R}', type_line: 'Enchantment', colors: ['R'],
      oracle_text: 'Instant and sorcery cards in your graveyard have flashback {1}{R}.',
    } as OracleCard);
    expect(STATIC.automation.level).toBe('full');
    let s = scenario(['Shock', 'Mountain'], { p1: { graveyard: ['Shock'], battlefield: ['Test Ember Archive', 'Mountain', 'Mountain'] }, defs: [STATIC] });
    expect(s.continuousEffects).toHaveLength(0); // the grant is the permanent's static ability, not a resolved effect
    expect(flashbackOffered(s)).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'graveyard'), method: 'flashback' }), [target('p2')]);
    expect(s.objects[s.zones.stack[0]!]!.stack?.costsPaid.alternative).toBe('flashback'); // CR 118.9
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Shock']); // CR 702.34a
  });

  it('CR 611.3a: with no static source on the battlefield the card has no flashback', () => {
    const s = scenario(['Shock', 'Mountain'], { p1: { graveyard: ['Shock'], battlefield: ['Mountain', 'Mountain'] } });
    expect(flashbackOffered(s)).toBe(false);
  });
});
