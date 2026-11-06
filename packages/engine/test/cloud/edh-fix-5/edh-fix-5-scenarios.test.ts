/**
 * edh-fix-5 (fix round, not a card round): CR 605.1a of the 2026-09-25 Comprehensive Rules says an activated ability is a mana ability only if "its cost and effect don't
 * move any card to or from a library". Synthetic cards (invented names, design 6.10), compiled by the default compiler. CR cites checked against the 2026-09-25 text.
 *
 *   CR 605.1a, 121.1, 405.1   "{2}, {T}, Sacrifice this artifact: Add {W}{U}. Draw a card." is an ordinary activated ability: it uses the stack and can be responded to
 *   CR 605.1a, 701.17a        mill, and CR 701.22/701.25 scry and surveil, beside adding mana: not a mana ability either
 *   CR 605.1a, 118.3          a cost that moves a card to or from a library ("Mill a card" as a cost) makes it an ordinary ability too
 *   CR 605.1a                 a granted quoted ability is judged the same way
 *   CR 605.1a, 603.7, 119.3   still mana abilities: adding mana and gaining life; adding mana with a delayed draw (the delayed trigger is the one that draws)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type OracleCard } from '../../../src/index';
import { act, find, passBoth, pool, scenario, zoneNames } from '../../m3/scenario';
import { textMovesLibraryCards } from '../../../src/parser/lower/library-moves';
import { drive } from '../../m6/dfc/support';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [] } as OracleCard);
}
const activated = (d: CardDef) => d.faces[0]!.abilities.filter((a) => a.kind === 'activated' || (a.kind === 'manual' && (a as { mana?: boolean }).mana !== undefined));
const manaFlag = (d: CardDef): boolean[] => d.faces[0]!.abilities.map((a) => (a as { isMana?: boolean; mana?: boolean }).isMana === true || (a as { mana?: boolean }).mana === true);

describe('CR 605.1a: an ability that draws is no mana ability', () => {
  const EGG = card('Test Dawn Egg', 'Artifact', '{2}, {T}, Sacrifice this artifact: Add {W}{U}. Draw a card.');
  it('compiles fully as an ordinary activated ability', () => {
    expect(EGG.automation.level).toBe('full');
    expect(activated(EGG).length).toBe(1);
    expect(manaFlag(EGG)).toEqual([false]);
  });
  it('activating it puts it on the stack: no mana and no card yet, the opponent may respond; both passing resolves it', () => {
    const s0 = scenario(['Plains'], { defs: [EGG], p1: { battlefield: ['Test Dawn Egg', 'Plains', 'Plains'], library: ['Plains'] } });
    const egg = find(s0, 'Test Dawn Egg', 'battlefield', 'p1');
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === egg);
    expect(la, 'the ability is offered').toBeDefined();
    const hand0 = zoneNames(s0, 'hand', 'p1').length;
    const s1 = drive(act(s0, la!.action), []);
    expect(s1.zones.stack.length).toBe(1);
    expect(pool(s1, 'p1')).toBe('');
    expect(zoneNames(s1, 'hand', 'p1').length).toBe(hand0);
    expect(s1.pending?.kind).toBe('priority');
    expect(s1.pending && 'player' in s1.pending ? s1.pending.player : 'p1').toBe('p1'); // the active player gets priority first, then the opponent can respond
    const s2 = passBoth(s1);
    expect(s2.zones.stack.length).toBe(0);
    expect(pool(s2, 'p1')).toBe('UW');
    expect(zoneNames(s2, 'hand', 'p1').length).toBe(hand0 + 1);
  });
  it('an opponent draw beside the mana is an ordinary ability too (no longer fail-closed for lack of a mana path)', () => {
    const d = card('Test Gift Egg', 'Artifact', '{T}, Sacrifice this artifact: Add {W}. Each opponent draws a card.');
    expect(manaFlag(d)).toEqual([false]);
  });
});

describe('CR 605.1a: mill, scry, surveil, search and library cost parts', () => {
  it.each([
    ['mill', '{T}: Add {G}. Mill a card.'],
    ['scry', '{T}: Add {G}. Scry 1.'],
    ['surveil', '{T}: Add {B}. Surveil 1.'],
    ['search', '{T}, Sacrifice this land: Add {G}. Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'],
    ['mill cost', '{T}, Mill two cards: Add {U}{U}.'],
    ['a choice of costs with a mill (review: oneOf)', '{T}, Pay 1 life or mill a card: Add {B}.'],
    ['exile from the top until (review)', '{T}: Add {G}. Exile cards from the top of your library until you exile a land card.'],
    ['reveal the top card and put it into your hand (review)', "{T}: Add {G}. Reveal the top card of your library. If it's a land card, put it into your hand."],
    ['a keyword action that takes cards from the library (review)', '{T}: Add {C}. Explore.'],
    ['manifest the top card (review)', '{T}: Add {C}. Manifest the top card of your library.'],
    ['an effect the engine does not read, whose words scry (a manual ability)', '{T}, Say the secret word: Add one mana of any color. Scry 1. You gain 1 life.'],
    ['a mill cost the engine does not read, whose effect it cannot read (a manual ability)', "{T}, Mill a card: For each colored mana symbol in the milled card's mana cost, add one mana of that color."],
  ])('%s: not a mana ability', (_n, text) => {
    const d = card('Test Mana Thing', 'Artifact', text);
    expect(manaFlag(d)).toEqual([false]);
  });
});

describe('CR 605.1a: a granted quoted ability is judged the same way', () => {
  it('"{T}: Add {G}. Draw a card." granted to creatures is no mana ability; "{T}: Add {G}." still is', () => {
    const drawing = card('Test Grant A', 'Enchantment', 'Creatures you control have "{T}: Add {G}. Draw a card."');
    expect(JSON.stringify(drawing.faces[0]!.abilities)).not.toContain('"isMana":true');
    const plain = card('Test Grant B', 'Enchantment', 'Creatures you control have "{T}: Add {G}."');
    expect(JSON.stringify(plain.faces[0]!.abilities)).toContain('"isMana":true');
  });
});

describe('CR 605.1a: abilities that stay mana abilities', () => {
  it.each([
    ['life', '{T}: Add {C}. You gain 1 life.'],
    ['pain', '{T}: Add {W} or {B}. This land deals 1 damage to you.'],
    ['delayed draw (a delayed trigger draws, CR 603.7)', "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep."],
    ['a "when this mana is spent" trigger that scries (CR 106.6: a separate triggered ability)', '{T}: Add {U}. When you spend this mana to cast a Dragon creature spell, scry 2.'],
    ['a reflexive mill (CR 603.12)', '{T}: Add {C}. When you do, mill two cards.'],
    ['a delayed draw whose sentence says "at the beginning" (the words path, review)', "{1}, {T}, Sacrifice ~: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep."],
    ['counting a library', '{T}: Add {G} for each land card in your library.'],
  ])('%s', (_n, text) => {
    const d = card('Test Mana Thing', 'Artifact', text);
    expect(manaFlag(d)).toEqual([true]);
  });
});

describe('CR 605.1a: the words path (manual abilities) and the read-then-move reading', () => {
  it('words: a trigger sentence, a restriction and a library count are not instructions; a draw, a scry, a keyword action and a cost are', () => {
    expect(textMovesLibraryCards("{1}, {T}, Sacrifice ~: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep. Frobnicate the quux.")).toBe(false);
    expect(textMovesLibraryCards('{T}: Add {C}. When you do, mill two cards. Frobnicate the quux.')).toBe(false);
    expect(textMovesLibraryCards('{T}: Add {C}. Spend this mana only to cycle a card or to cast a spell with discover.')).toBe(false);
    expect(textMovesLibraryCards('{T}: Add {G} for each land card in your library. Frobnicate the quux.')).toBe(false);
    expect(textMovesLibraryCards('{T}: Add {C}. Draw a card. Frobnicate the quux.')).toBe(true);
    expect(textMovesLibraryCards('{T}, Mill a card: Add {C}. Frobnicate the quux.')).toBe(true);
    expect(textMovesLibraryCards('{T}: Add {C}. Explore. Frobnicate the quux.')).toBe(true);
  });
});
