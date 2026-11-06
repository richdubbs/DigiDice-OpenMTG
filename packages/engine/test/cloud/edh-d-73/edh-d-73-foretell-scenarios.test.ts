/**
 * Round edh-d-73 (lane face-down): "Each nonland card in your hand without foretell has foretell. Its foretell cost is equal to its mana cost reduced by {2}." and "Whenever you foretell a card,
 * ~ gets +2/+0 until end of turn." (Dream Devourer; CR 702.143a-b, 116.2h, 118.9, 107.4, 613.1f), played through the engine with synthetic cards (invented names, design 6.10).
 * Rulings (2021-02-05): the foretell cost is the mana cost with generic mana reduced only; the card keeps that cost in exile although it no longer has foretell and although the
 * Devourer is gone; the trigger is for foretelling, not for casting a foretold card.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type Action, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, drive, lands, resolveTop, scenario, until } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const DEV = card('Test Dream Eater', 'Creature — Demon', 'Each nonland card in your hand without foretell has foretell. Its foretell cost is equal to its mana cost reduced by {2}.\nWhenever you foretell a card, ~ gets +2/+0 until end of turn.', { pt: ['2', '2'], cost: '{1}{B}' });
const BEAR = card('Test Wild Bear', 'Creature — Bear', 'Trample', { pt: ['3', '3'], cost: '{3}{G}{G}' });
const OWN = card('Test Own Comet', 'Sorcery', 'You gain 5 life.\nForetell {1}{R}', { cost: '{3}{R}{R}' });
const FIELD = card('Test Wide Field', 'Land', '{T}: Add {G}.');
const special = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'special' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name)?.action;
const castVia = (s: GameState, name: string, method: string): { action: Action; label: string } | undefined => {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'cast' && x.object !== undefined && s.defs[s.objects[x.object]!.defId]!.name === name && (x.action as { method?: string }).method === method);
  return a === undefined ? undefined : { action: a.action, label: a.label };
};
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => until(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
const board = (extra: string[] = []): GameState => scenario(['Forest', 'Mountain'], { defs: [DEV, BEAR, OWN, FIELD], p1: { hand: ['Test Wild Bear', 'Test Own Comet', 'Test Wide Field', ...extra], battlefield: ['Test Dream Eater', ...lands('Forest', 6), ...lands('Mountain', 3)] }, p2: { battlefield: lands('Forest', 2) } });
const id = (s: GameState, name: string): string => s.zones.battlefield.concat(s.zones.exile, s.zones.hand.p1!, s.zones.graveyard.p1!).find((x) => s.defs[s.objects[x]!.defId]!.name === name)!;

describe('Dream Devourer: foretell granted to the cards in your hand, with the cost "mana cost reduced by {2}"', () => {
  it('is automated', () => expect(DEV.automation.level, JSON.stringify(DEV.automation)).toBe('full'));
  it('a nonland card without foretell may be foretold for {2}; a land may not; a card that prints foretell keeps its own', () => {
    const s = board();
    expect(special(s, 'Test Wild Bear')).toBeDefined();
    expect(special(s, 'Test Wide Field')).toBeUndefined();
    expect(special(s, 'Test Own Comet')).toBeDefined(); // its own foretell, not the granted one
    expect(getChars(s, id(s, 'Test Wild Bear'))!.abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === 'foretell')).toBe(true);
  });
  it('negative: without the Devourer no such card has foretell', () => {
    const s0 = scenario(['Forest'], { defs: [BEAR], p1: { hand: ['Test Wild Bear'], battlefield: lands('Forest', 6) } });
    expect(special(s0, 'Test Wild Bear')).toBeUndefined();
  });
  it('foretold: exiled face down, and the Devourer gets +2/+0 until end of turn; negative: nothing triggers for casting it later', () => {
    let s = board();
    const dev = id(s, 'Test Dream Eater');
    expect(getChars(s, dev)!.power).toBe('2');
    s = drive(act(s, special(s, 'Test Wild Bear')!));
    s = until(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority');
    expect(getChars(s, dev)!.power).toBe('4');
    expect(s.zones.exile.some((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Wild Bear' && s.objects[x]!.faceDown)).toBe(true);
    s = drive(act(s, special(s, 'Test Own Comet')!)); // a second foretell: +2/+0 again
    s = until(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority');
    expect(getChars(s, dev)!.power).toBe('6');
  });
  it('cast on a later turn for the mana cost reduced by {2} ({3}{G}{G} -> {1}{G}{G}), even though the Devourer is gone and the card no longer has foretell', () => {
    let s = drive(act(board(), special(board(), 'Test Wild Bear')!));
    expect(castVia(s, 'Test Wild Bear', 'foretell')).toBeUndefined(); // the turn it was foretold
    const bear = s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Wild Bear')!;
    expect(s.objects[bear]!.chosen?.['foretellLess']).toBe(2);
    s = mainOf(mainOf(s, 'p2'), 'p1');
    // the Devourer leaves the battlefield
    const dev = id(s, 'Test Dream Eater');
    s.zones.battlefield = s.zones.battlefield.filter((x) => x !== dev);
    s.zones.graveyard.p1!.push(dev);
    s.objects[dev]!.zone = 'graveyard';
    const via = castVia(s, 'Test Wild Bear', 'foretell');
    expect(via).toBeDefined();
    const before = tapped(s);
    s = drive(act(s, via!.action));
    expect(tapped(s) - before).toBe(3); // {1}{G}{G}
  });
  it('only generic mana is reduced: {G}{G} stays {G}{G}, a cost of {1}{G} becomes {G}', () => {
    const TWO = card('Test Twin Wolf', 'Creature — Wolf', 'Haste', { pt: ['2', '2'], cost: '{G}{G}' });
    const ONE = card('Test Lone Wolf', 'Creature — Wolf', 'Haste', { pt: ['2', '2'], cost: '{1}{G}' });
    const s0 = scenario(['Forest'], { defs: [DEV, TWO, ONE], p1: { hand: ['Test Twin Wolf', 'Test Lone Wolf'], battlefield: ['Test Dream Eater', ...lands('Forest', 8)] }, p2: { battlefield: lands('Forest', 2) } });
    let s = drive(act(s0, special(s0, 'Test Twin Wolf')!));
    s = drive(act(s, special(s, 'Test Lone Wolf')!));
    s = mainOf(mainOf(s, 'p2'), 'p1');
    const before = tapped(s);
    s = drive(act(s, castVia(s, 'Test Twin Wolf', 'foretell')!.action));
    expect(tapped(s) - before).toBe(2);
    const mid = tapped(s);
    s = resolveTop(s);
    s = drive(act(s, castVia(s, 'Test Lone Wolf', 'foretell')!.action));
    expect(tapped(s) - mid).toBe(1);
  });
  it('review: the cost is fixed when the card is foretold, even if the Devourer is sacrificed to pay the {2}; a card with {X} or two faces is not offered', () => {
    const ALTAR = card('Test Bone Altar', 'Artifact', 'Sacrifice a creature: Add {C}{C}.');
    const FIRE = card('Test Big Fire', 'Sorcery', 'You gain 1 life.', { cost: '{X}{R}' });
    const s0 = scenario(['Forest', 'Mountain'], { defs: [DEV, BEAR, ALTAR, FIRE], p1: { hand: ['Test Wild Bear', 'Test Big Fire'], battlefield: ['Test Dream Eater', 'Test Bone Altar', ...lands('Forest', 2)] }, p2: { battlefield: lands('Forest', 2) } });
    expect(special(s0, 'Test Big Fire')).toBeUndefined(); // {X}: fail closed
    expect(special(s0, 'Test Wild Bear')).toBeDefined();
  });
  it('review: casting the foretold card does not trigger the Devourer; the printed foretell cost of a card that has one is the cost paid', () => {
    let s = drive(act(board(), special(board(), 'Test Own Comet')!));
    const comet = s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Own Comet')!;
    expect(s.objects[comet]!.chosen?.['foretellLess']).toBeUndefined();
    s = mainOf(mainOf(s, 'p2'), 'p1');
    const dev = id(s, 'Test Dream Eater');
    expect(getChars(s, dev)!.power).toBe('2');
    const before = tapped(s);
    s = drive(act(s, castVia(s, 'Test Own Comet', 'foretell')!.action));
    expect(tapped(s) - before).toBe(2); // {1}{R}, the printed cost, not {1}{R}{R}
    expect(getChars(s, dev)!.power).toBe('2'); // no trigger
  });
});
