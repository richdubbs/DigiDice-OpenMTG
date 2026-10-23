/**
 * Valid phrases per hole, shared by the nonsense-word mutation test (guard G2). Wordings are minimal and invented (design 6.10): no verbatim card text.
 */
import type { HoleType } from '../../../src/parser/types';

export const PHRASES: [HoleType, string][] = [
  // Filter / Obj / Objs / Player / Recipient
  ['Filter', 'creature'], ['Filter', 'another creature you control'], ['Filter', 'nonland permanent'], ['Filter', 'red or green creature'], ['Filter', 'creature with flying or reach'],
  ['Filter', 'creature with power 4 or greater'], ['Filter', 'creature card in your graveyard'], ['Filter', 'creature of the chosen type'], ['Filter', "creature you don't control"],
  ['Filter', 'creature that was dealt damage this turn'], ['Filter', 'artifact, creature, or enchantment'], ['Filter', 'creature with a +1/+1 counter on it'],
  ['Filter', 'creature named Zzz'], ['Filter', 'noncreature spell'], ['Filter', 'Goblin or Elf'], ['Filter', 'creature that shares a creature type with ~'],
  ['Objs', 'target creature you control'], ['Objs', 'up to two target creatures'], ['Objs', 'target nonland permanent an opponent controls'], ['Objs', 'each other creature you control'],
  ['Objs', 'all creatures'], ['Objs', 'the top three cards of your library'], ['Objs', 'those creatures'], ['Objs', 'target artifact and target creature'], ['Objs', 'target instant or sorcery spell'],
  ['Obj', 'that creature'], ['Obj', 'enchanted creature'], ['Obj', 'the exiled card'], ['Obj', 'another target creature'],
  ['Player', 'target opponent'], ['Player', 'each opponent'], ['Player', "that creature's controller"], ['Player', 'the active player'], ['Player', 'two target players'],
  ['Recipient', 'any target'], ['Recipient', 'target player or planeswalker'], ['Recipient', 'target creature or player'],
  ['Zone', 'your graveyard'], ['Zone', "an opponent's hand"], ['Zone', "target player's library"], ['Lib', 'on top of your library'],
  // Qty / Count
  ['Qty', 'twice X'], ['Qty', 'half X, rounded down'], ['Qty', 'the number of creatures you control'], ['Qty', 'the number of cards in your hand'], ['Qty', 'its power'],
  ['Qty', 'the total power of creatures you control'], ['Qty', 'your life total'], ['Qty', 'the number of +1/+1 counters on ~'], ['Qty', 'your devotion to green'],
  ['Qty', 'X plus 1'], ['Qty', 'for each creature you control'], ['Qty', "target creature's toughness"], ['Count', 'any number of'],
  // Cost
  ['Cost', '{2}{W}, {T}, sacrifice ~'], ['Cost', 'sacrifice another creature'], ['Cost', 'discard a card at random'], ['Cost', 'pay 3 life'], ['Cost', 'exile a creature card from your graveyard'],
  ['Cost', 'tap two untapped Elves you control'], ['Cost', 'remove a +1/+1 counter from ~'], ["Cost", "return ~ to its owner's hand"], ['Cost', 'reveal ~ from your hand'],
  ['Cost', 'mill two cards'], ['Cost', 'tap any number of untapped creatures you control with total power 4 or greater'],
  // Cond
  ['Cond', 'you control no creatures'], ['Cond', 'you control two or more creatures'], ['Cond', 'there are seven or more cards in your graveyard'], ['Cond', 'you have 5 or less life'],
  ['Cond', "it's your turn"], ['Cond', '~ was kicked'], ['Cond', "you don't"], ['Cond', 'that creature has flying'], ['Cond', 'your life total is 5 or less'],
  ['Cond', "you've cast two or more spells this turn"], ['Cond', 'a creature died this turn'], ["Cond", "you're the monarch"],
  ['Cond', 'you control a creature and an opponent controls a creature'],
  // Dur
  ['Dur', 'until end of turn'], ['Dur', 'until your next turn'], ['Dur', 'for as long as ~ remains on the battlefield'], ['Dur', 'until ~ leaves the battlefield'],
  ['Dur', 'for as long as you control a Forest'], ['Dur', 'until your next upkeep'],
  // Event
  ['Event', 'the beginning of your upkeep'], ['Event', 'the beginning of combat on your turn'], ['Event', '~ enters'], ['Event', 'another creature you control dies'],
  ['Event', '~ or another creature you control enters'], ['Event', '~ attacks alone'], ['Event', '~ becomes blocked by a creature'], ['Event', '~ deals combat damage to a player'],
  ['Event', '~ is dealt damage'], ['Event', '~ becomes the target of a spell or ability'], ['Event', 'you cast a creature spell'], ['Event', 'you draw your second card each turn'],
  ['Event', 'an opponent loses life'], ['Event', 'you sacrifice a creature'], ['Event', 'a +1/+1 counter is put on ~'], ['Event', 'you attack with two or more creatures'],
  ['Event', 'one or more creatures you control deal combat damage to a player'], ['Event', 'enchanted creature dies'], ['Event', 'you roll a die'], ['Event', 'you control no Islands'],
  // TokenDesc / Keyword / Abilities
  ['TokenDesc', '1/1 white Soldier creature token'], ['TokenDesc', '4/4 red Dragon creature token with flying'], ['TokenDesc', 'Treasure token'],
  ['Keyword', 'protection from red'], ['Keyword', 'ward {2}'], ['Keyword', 'toxic 2'], ['Keyword', 'enchant creature'], ['Keyword', 'first strike'],
  ['Abilities', 'flying, vigilance, and trample'], ['Abilities', 'protection from red and from blue'],
  // small holes
  ['Color', 'red'], ['ManaCost', '{2}{W}'], ['PT', '+2/+2'], ['ChoiceKind', 'creature type'],
];

/**
 * Positions where an arbitrary word is legitimate because the grammar has an open class there (design 6.11): a card name after "named", and a counter kind in front
 * of "counter(s)". The mutation test skips replacing the token at these positions.
 */
export function openClassIndex(toks: { norm: string }[], i: number): boolean {
  const next = toks[i + 1]?.norm;
  return toks[i - 1]?.norm === 'named' || next === 'counter' || next === 'counters';
}
