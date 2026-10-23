/**
 * FXH (audit 2026-10-12, C3): the Oracle fields of the FULL search-to-hand cards the audit names, copied from the local Scryfall index
 * (`.cache/scryfall/cards.jsonl`) and compiled by the default compile pipeline, so the tests run offline without adding them to the shared fixture file.
 * `tutor-log.test.ts` checks that each still matches the index when the cache is present.
 */
import { compileCard, type CardDef, type OracleCard } from '../../src/index';

export const TUTORS: Record<string, Omit<OracleCard, 'layout'>> = {
  'Demonic Tutor': { name: 'Demonic Tutor', mana_cost: '{1}{B}', type_line: 'Sorcery', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.', colors: ['B'] },
  'Diabolic Tutor': { name: 'Diabolic Tutor', mana_cost: '{2}{B}{B}', type_line: 'Sorcery', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.', colors: ['B'] },
  'Grim Tutor': { name: 'Grim Tutor', mana_cost: '{1}{B}{B}', type_line: 'Sorcery', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle. You lose 3 life.', colors: ['B'] },
  Gamble: { name: 'Gamble', mana_cost: '{R}', type_line: 'Sorcery', oracle_text: 'Search your library for a card, put that card into your hand, discard a card at random, then shuffle.', colors: ['R'] },
  'Demonic Bargain': {
    name: 'Demonic Bargain', mana_cost: '{2}{B}', type_line: 'Sorcery', colors: ['B'],
    oracle_text: 'Exile the top thirteen cards of your library, then search your library for a card. Put that card into your hand, then shuffle.',
  },
  'Demonic Collusion': {
    name: 'Demonic Collusion', mana_cost: '{3}{B}{B}', type_line: 'Sorcery', colors: ['B'],
    oracle_text: 'Buyback—Discard two cards. (You may discard two cards in addition to any other costs as you cast this spell. If you do, put this card into your hand as it resolves.)\nSearch your library for a card, put that card into your hand, then shuffle.',
  },
  'Diabolic Intent': {
    name: 'Diabolic Intent', mana_cost: '{1}{B}', type_line: 'Sorcery', colors: ['B'],
    oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a card, put that card into your hand, then shuffle.',
  },
  'Planar Portal': { name: 'Planar Portal', mana_cost: '{6}', type_line: 'Artifact', oracle_text: '{6}, {T}: Search your library for a card, put that card into your hand, then shuffle.', colors: [] },
  "Razaketh's Rite": {
    name: "Razaketh's Rite", mana_cost: '{3}{B}{B}', type_line: 'Sorcery', colors: ['B'],
    oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.\nCycling {B} ({B}, Discard this card: Draw a card.)',
  },
  'Razaketh, the Foulblooded': {
    name: 'Razaketh, the Foulblooded', mana_cost: '{5}{B}{B}{B}', type_line: 'Legendary Creature — Demon', power: '8', toughness: '8', colors: ['B'],
    oracle_text: 'Flying, trample\nPay 2 life, Sacrifice another creature: Search your library for a card, put that card into your hand, then shuffle.',
  },
  'Ring of Three Wishes': {
    name: 'Ring of Three Wishes', mana_cost: '{5}', type_line: 'Artifact', colors: [],
    oracle_text: 'This artifact enters with three wish counters on it.\n{5}, {T}, Remove a wish counter from this artifact: Search your library for a card, put that card into your hand, then shuffle.',
  },
};

const DEFS = new Map<string, CardDef>();

/** The compiled definition of one of the cards above (the default compile pipeline, as a game compiles it). */
export function tutor(name: string): CardDef {
  let d = DEFS.get(name);
  if (!d) DEFS.set(name, (d = compileCard({ layout: 'normal', ...TUTORS[name]! } as OracleCard)));
  return d;
}
