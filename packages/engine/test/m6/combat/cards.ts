/**
 * R1 (M6-7a) test cards: the Oracle fields of real cards with combat requirements, copied from the local Scryfall index (`.cache/scryfall/cards.jsonl`) and
 * compiled by the default compile pipeline, so the tests run offline without adding them to the shared fixture file. `requirements-cards.test.ts` checks
 * that each still matches the index when the cache is present.
 */
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

export const ORACLE: Record<string, Omit<OracleCard, 'layout'>> = {
  'Goblin Brigand': { name: 'Goblin Brigand', mana_cost: '{1}{R}', type_line: 'Creature — Goblin Warrior', power: '2', toughness: '2', oracle_text: 'This creature attacks each combat if able.', colors: ['R'] },
  'Bloodrock Cyclops': { name: 'Bloodrock Cyclops', mana_cost: '{2}{R}', type_line: 'Creature — Cyclops', power: '3', toughness: '3', oracle_text: 'This creature attacks each combat if able.', colors: ['R'] },
  Juggernaut: { name: 'Juggernaut', mana_cost: '{4}', type_line: 'Artifact Creature — Juggernaut', power: '5', toughness: '3', oracle_text: "This creature attacks each combat if able.\nThis creature can't be blocked by Walls.", colors: [] },
  "Gaea's Protector": { name: "Gaea's Protector", mana_cost: '{3}{G}', type_line: 'Creature — Elemental Warrior', power: '4', toughness: '2', oracle_text: 'This creature must be blocked if able.', colors: ['G'] },
  'Inescapable Brute': { name: 'Inescapable Brute', mana_cost: '{5}{R}', type_line: 'Creature — Giant Warrior', power: '3', toughness: '3', oracle_text: 'Wither (This deals damage to creatures in the form of -1/-1 counters.)\nThis creature must be blocked if able.', colors: ['R'] },
  'Razorgrass Screen': { name: 'Razorgrass Screen', mana_cost: '{1}', type_line: 'Artifact Creature — Wall', power: '2', toughness: '1', oracle_text: 'Defender (This creature can\'t attack.)\nThis creature blocks each combat if able.', colors: [] },
  Watchdog: { name: 'Watchdog', mana_cost: '{3}', type_line: 'Artifact Creature — Dog', power: '1', toughness: '2', oracle_text: 'This creature blocks each combat if able.\nAs long as this creature is untapped, all creatures attacking you get -1/-0.', colors: [] },
  'Bloodshed Fever': { name: 'Bloodshed Fever', mana_cost: '{R}', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature attacks each combat if able.', colors: ['R'] },
  // Milestone 6 (M6-7): the other-creature forms (R1 kept them manual; M6-7 enforces them).
  Lure: { name: 'Lure', mana_cost: '{1}{G}{G}', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nAll creatures able to block enchanted creature do so.', colors: ['G'] },
  'Prized Unicorn': { name: 'Prized Unicorn', mana_cost: '{3}{G}', type_line: 'Creature — Unicorn', power: '2', toughness: '2', oracle_text: 'All creatures able to block this creature do so.', colors: ['G'] },
  'Hunt Down': { name: 'Hunt Down', mana_cost: '{G}', type_line: 'Sorcery', oracle_text: 'Target creature blocks target creature this turn if able.', colors: ['G'] },
  // M6-7: the other-creature forms and the resolved requirements with a duration (parser/templates/zz-m6/requirements.json).
  'Elvish Bard': { name: 'Elvish Bard', mana_cost: '{3}{G}{G}', type_line: 'Creature — Elf Shaman Bard', power: '2', toughness: '4', oracle_text: 'All creatures able to block this creature do so.', colors: ['G'] },
  'Rampant Elephant': { name: 'Rampant Elephant', mana_cost: '{3}{W}', type_line: 'Creature — Elephant', power: '2', toughness: '2', oracle_text: '{G}: Target creature blocks this creature this turn if able.', colors: ['W'] },
  'Trumpeting Armodon': { name: 'Trumpeting Armodon', mana_cost: '{3}{G}', type_line: 'Creature — Elephant', power: '3', toughness: '3', oracle_text: '{1}{G}: Target creature blocks this creature this turn if able.', colors: ['G'] },
  'Alluring Scent': { name: 'Alluring Scent', mana_cost: '{1}{G}{G}', type_line: 'Sorcery', oracle_text: 'All creatures able to block target creature this turn do so.', colors: ['G'] },
  Bloodscent: { name: 'Bloodscent', mana_cost: '{3}{G}', type_line: 'Instant', oracle_text: 'All creatures able to block target creature this turn do so.', colors: ['G'] },
  'Taunting Challenge': { name: 'Taunting Challenge', mana_cost: '{1}{G}{G}', type_line: 'Sorcery', oracle_text: 'All creatures able to block target creature this turn do so.', colors: ['G'] },
  'Boiling Blood': { name: 'Boiling Blood', mana_cost: '{2}{R}', type_line: 'Instant', oracle_text: 'Target creature attacks this turn if able.\nDraw a card.', colors: ['R'] },
  'Heckling Fiends': { name: 'Heckling Fiends', mana_cost: '{2}{R}', type_line: 'Creature — Devil', power: '2', toughness: '2', oracle_text: '{2}{R}: Target creature attacks this turn if able.', colors: ['R'] },
  'Courtly Provocateur': { name: 'Courtly Provocateur', mana_cost: '{2}{U}', type_line: 'Creature — Human Wizard', power: '1', toughness: '1', oracle_text: '{T}: Target creature attacks this turn if able.\n{T}: Target creature blocks this turn if able.', colors: ['U'] },
  'Culling Mark': { name: 'Culling Mark', mana_cost: '{2}{G}', type_line: 'Sorcery', oracle_text: 'Target creature blocks this turn if able.', colors: ['G'] },
  'Nacatl Hunt-Pride': { name: 'Nacatl Hunt-Pride', mana_cost: '{5}{W}', type_line: 'Creature — Cat Warrior', power: '5', toughness: '4', oracle_text: "Vigilance\n{R}, {T}: Target creature can't block this turn.\n{G}, {T}: Target creature blocks this turn if able.", colors: ['W'] },
  'Irresistible Prey': { name: 'Irresistible Prey', mana_cost: '{G}', type_line: 'Sorcery', oracle_text: 'Target creature must be blocked this turn if able.\nDraw a card.', colors: ['G'] },
  'Goldenhide Ox': { name: 'Goldenhide Ox', mana_cost: '{5}{G}', type_line: 'Enchantment Creature — Ox', power: '5', toughness: '4', oracle_text: 'Constellation — Whenever this creature or another enchantment you control enters, target creature must be blocked this turn if able.', colors: ['G'] },
  'Bident of Thassa': { name: 'Bident of Thassa', mana_cost: '{2}{U}{U}', type_line: 'Legendary Enchantment Artifact', oracle_text: 'Whenever a creature you control deals combat damage to a player, you may draw a card.\n{1}{U}, {T}: Creatures your opponents control attack this turn if able.', colors: ['U'] },
  // Restrictions and costs the engine leaves manual (CR 508.1d, 509.1c: they change which declarations are legal, so requirements are not enforced with them).
  'Ghostly Prison': { name: 'Ghostly Prison', mana_cost: '{2}{W}', type_line: 'Enchantment', oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.", colors: ['W'] },
  'Silent Arbiter': { name: 'Silent Arbiter', mana_cost: '{4}', type_line: 'Artifact Creature — Construct', power: '1', toughness: '5', oracle_text: 'No more than one creature can attack each combat.\nNo more than one creature can block each combat.', colors: [] },
  // FAST3 T12: Ironclaw Orcs is automated since rst.t12.cantblock.power.atleast; Hipparion (its "unless you pay {1}" form) stays manual
  'Ironclaw Orcs': { name: 'Ironclaw Orcs', mana_cost: '{1}{R}', type_line: 'Creature — Orc', power: '2', toughness: '2', oracle_text: "This creature can't block creatures with power 2 or greater.", colors: ['R'] },
  Hipparion: { name: 'Hipparion', mana_cost: '{1}{W}', type_line: 'Creature — Horse', power: '1', toughness: '3', oracle_text: "This creature can't block creatures with power 3 or greater unless you pay {1}.", colors: ['W'] },
  'Mogg Flunkies': { name: 'Mogg Flunkies', mana_cost: '{1}{R}', type_line: 'Creature — Goblin', power: '3', toughness: '3', oracle_text: "This creature can't attack or block alone.", colors: ['R'] },
};

const DEFS = new Map<string, CardDef>();

/** The compiled definition of one of the cards above (the default compile pipeline, as a game compiles it). */
export function card(name: keyof typeof ORACLE & string): CardDef {
  let d = DEFS.get(name);
  if (!d) DEFS.set(name, (d = compileCard({ layout: 'normal', ...ORACLE[name]! } as OracleCard)));
  return d;
}

export const cards = (...names: string[]): CardDef[] => names.map((n) => card(n));
