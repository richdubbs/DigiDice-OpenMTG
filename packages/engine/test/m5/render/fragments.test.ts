/**
 * WP2: the renderers of the expression nodes (design 2.3): object filters, quantities, conditions, durations, event patterns, costs, keywords. Each case is a
 * node and the Oracle wording it must print. Checked through the public per-node functions (display text).
 */
import { describe, expect, it } from 'vitest';
import type { Condition, CostDef, Duration, EventPattern, KeywordAbilityDef, ObjectFilter, Quantity } from '../../../src/types/ability';
import { renderCondition } from '../../../src/render/condition';
import { renderCost } from '../../../src/render/cost';
import { renderDuration } from '../../../src/render/duration';
import { renderEvent } from '../../../src/render/event';
import { renderFilter } from '../../../src/render/filter';
import { renderKeyword } from '../../../src/render/keyword';
import { renderQuantity } from '../../../src/render/quantity';

const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const fresh = () => ({ ...ctx });

describe('CR 109.1, 205.3, 700.7: renderFilter: object filters as noun phrases (plural, no determiner)', () => {
  const cases: [string, ObjectFilter, string][] = [
    ['types', { types: ['Creature'] }, 'creatures'],
    ['any of several types', { types: ['Artifact', 'Enchantment'] }, 'artifacts or enchantments'],
    ['all of several types', { allTypes: ['Artifact', 'Creature'] }, 'artifact creatures'],
    ['controller you', { types: ['Creature'], controller: 'you' }, 'creatures you control'],
    ['controller opponent', { types: ['Creature'], controller: 'opponent' }, 'creatures your opponents control'],
    ['not controlled by you', { types: ['Creature'], not: { controller: 'you' } }, "creatures you don't control"],
    ['subtype', { subtypes: ['Goblin'], controller: 'you' }, 'Goblins you control'],
    ['two land types', { subtypes: ['Plains', 'Island'] }, 'Plains or Islands'],
    ['keyword', { types: ['Creature'], keyword: 'flying' }, 'creatures with flying'],
    ['keyword alternatives', { types: ['Creature'], keyword: ['flying', 'reach'] }, 'creatures with flying or reach'],
    ['without a keyword', { types: ['Creature'], notKeyword: 'flying' }, 'creatures without flying'],
    ['power at least', { types: ['Creature'], power: { op: '>=', value: 4 } }, 'creatures with power 4 or greater'],
    ['toughness at most', { types: ['Creature'], toughness: { op: '<=', value: 2 } }, 'creatures with toughness 2 or less'],
    ['mana value', { types: ['Creature'], manaValue: { op: '<=', value: 3 } }, 'creatures with mana value 3 or less'],
    ['mana value equal', { manaValue: { op: '==', value: 0 } }, 'permanents with mana value 0'],
    ['basic', { types: ['Land'], supertypes: ['Basic'] }, 'basic lands'],
    ['nonbasic', { types: ['Land'], notSupertypes: ['Basic'] }, 'nonbasic lands'],
    ['nonland', { notTypes: ['Land'] }, 'nonland permanents'],
    ['nonblack', { types: ['Creature'], notColors: ['B'] }, 'nonblack creatures'],
    ['non-subtype', { types: ['Enchantment'], notSubtypes: ['Aura'] }, 'non-Aura enchantments'],
    ['colors', { types: ['Creature'], colors: ['R', 'G'] }, 'red or green creatures'],
    ['multicolored', { types: ['Creature'], multicolored: true }, 'multicolored creatures'],
    ['colorless', { colorless: true }, 'colorless permanents'],
    ['tapped', { types: ['Creature'], tapped: true }, 'tapped creatures'],
    ['untapped', { types: ['Creature'], tapped: false }, 'untapped creatures'],
    ['attacking', { types: ['Creature'], attacking: true }, 'attacking creatures'],
    ['attacking or blocking', { types: ['Creature'], anyOf: [{ attacking: true }, { blocking: true }] }, 'attacking or blocking creatures'],
    ['tokens', { types: ['Creature'], token: true }, 'creature tokens'],
    ['nontoken', { types: ['Creature'], token: false }, 'nontoken creatures'],
    ['legendary', { types: ['Creature'], supertypes: ['Legendary'] }, 'legendary creatures'],
    ['other', { types: ['Creature'], other: true }, 'other creatures'],
    ['in a graveyard', { zone: 'graveyard', types: ['Creature'], owner: 'you' }, 'creature cards from your graveyard'],
    ['in a hand', { zone: 'hand', owner: 'opponent' }, "cards from an opponent's hand"],
    ['named', { name: 'Island' }, 'permanents named Island'],
    ['counters', { types: ['Creature'], counters: { kind: '+1/+1' } }, 'creatures with a +1/+1 counter on them'], // FAST4 T33: a set says "on them" (CR 122.1)
    ['no counters', { types: ['Creature'], counters: { kind: '-1/-1', cmp: { op: '==', value: 0 } } }, 'creatures with no -1/-1 counters on them'], // p2-counters-state-1: a counted plural says "on them" (CR 122.1)
    ['dealt damage', { types: ['Creature'], dealtDamageThisTurn: true }, 'creatures that were dealt damage this turn'],
    ['entered', { types: ['Creature'], enteredThisTurn: true }, 'creatures that entered the battlefield this turn'],
    ['has an ability', { types: ['Creature'], hasAbility: 'activated' }, 'creatures with an activated ability'],
    ['chosen type', { types: ['Creature'], chosen: { link: 'type', quality: 'creatureType' } }, 'creatures of the chosen type'],
    ['spells', { stackKind: 'spell', types: ['Instant', 'Sorcery'] }, 'instant or sorcery spells'],
    ['noncreature spells', { stackKind: 'spell', notTypes: ['Creature'] }, 'noncreature spells'],
    ['abilities', { stackKind: 'activatedAbility' }, 'activated abilities'],
    ['face down', { types: ['Creature'], faceDown: true }, 'face-down creatures'],
  ];
  it.each(cases)('%s', (_name, filter, expected) => {
    expect(renderFilter(filter, fresh())).toBe(expected);
  });
});

describe('CR 107.1, 107.3, 208.1: renderQuantity', () => {
  const cases: [string, Quantity, string][] = [
    ['number', 3, '3'],
    ['X', { q: 'X' }, 'X'],
    ['count', { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, 'the number of creatures you control'],
    ['stat of self', { q: 'stat', stat: 'power', of: { ref: 'self' }, sum: false }, "Test Card's power"],
    ['stat total', { q: 'stat', stat: 'toughness', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, sum: true }, 'the total toughness of all creatures you control'],
    ['life', { q: 'life', of: { ref: 'you' } }, 'your life total'],
    ['cards in hand', { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, 'the number of cards in your hand'],
    ['counters', { q: 'counters', on: { ref: 'self' }, kind: 'charge' }, 'the number of charge counters on Test Card'],
    ['devotion', { q: 'devotion', to: ['G'], of: { ref: 'you' } }, 'your devotion to green'],
    ['devotion to two colors', { q: 'devotion', to: ['W', 'U'], of: { ref: 'you' } }, 'your devotion to white and blue'],
    ['creatures died', { q: 'happenedCount', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }, 'the number of creatures that died this turn'],
    ['spells you cast', { q: 'happenedCount', event: { ev: 'cast' }, scope: 'turn', by: 'you' }, "the number of spells you've cast this turn"],
    ['opponents', { q: 'countPlayers', of: { ref: 'each', who: 'opponent' } }, 'the number of opponents'],
    ['twice', { q: 'math', op: '*', args: [2, { q: 'stat', stat: 'power', of: { ref: 'self' } }] }, "twice Test Card's power"],
    ['three times', { q: 'math', op: '*', args: [3, { q: 'X' }] }, 'three times X'],
    ['half rounded down', { q: 'math', op: 'floorDiv', args: [{ q: 'life', of: { ref: 'you' } }, 2] }, 'half your life total, rounded down'],
    ['plus', { q: 'math', op: '+', args: [{ q: 'X' }, 1] }, 'X plus 1'],
    ['greater of', { q: 'math', op: 'max', args: [0, { q: 'X' }] }, 'the greater of 0 and X'],
    ['live', { q: 'live', value: { q: 'X' } }, 'X'],
    ['asked of the player', { q: 'ask', text: 'the number of cards in the revealed pile' }, 'the number of cards in the revealed pile'],
    ['speed', { q: 'speed' }, 'your speed'],
    ['distinct colors', { q: 'distinct', what: 'colors', among: { ref: 'each', filter: { controller: 'you' } } }, 'the number of colors among all permanents you control'],
  ];
  it.each(cases)('%s', (_name, q, expected) => {
    expect(renderQuantity(q, fresh())).toBe(expected);
  });
});

describe('CR 603.4, 608.2c, 700.5: renderCondition', () => {
  const youControl: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } };
  const cases: [string, Condition, string][] = [
    ['exists', youControl, 'you control a creature'],
    ['exists at least', { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, atLeast: 3 }, 'you control three or more creatures'],
    ['opponent controls', { cond: 'exists', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'opponent' } } }, 'an opponent controls an artifact'],
    ['does not exist', { cond: 'not', of: youControl }, 'you control no creatures'],
    ['all', { cond: 'all', of: [youControl, { cond: 'turnOf', whose: 'you' }] }, "you control a creature and it's your turn"],
    ['any', { cond: 'any', of: [youControl, { cond: 'turnOf', whose: 'you' }] }, "you control a creature or it's your turn"],
    ['turn of you', { cond: 'turnOf', whose: 'you' }, "it's your turn"],
    ['turn of opponent', { cond: 'turnOf', whose: 'opponent' }, "it's an opponent's turn"],
    ['not your turn', { cond: 'not', of: { cond: 'turnOf', whose: 'you' } }, "it's not your turn"],
    ['life at least', { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '>=', right: 10 }, 'you have 10 or more life'],
    ['life less', { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '<', right: 5 }, 'you have less than 5 life'],
    ['matches tapped', { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } }, 'Test Card is tapped'],
    ['matches type', { cond: 'matches', object: { ref: 'self' }, filter: { types: ['Creature'] } }, 'Test Card is a creature'],
    ['matches keyword', { cond: 'matches', object: { ref: 'self' }, filter: { keyword: 'flying' } }, 'Test Card has flying'],
    ['kicked', { cond: 'wasCast', kicked: true }, 'Test Card was kicked'],
    ['cast from', { cond: 'wasCast', from: 'graveyard' }, 'Test Card was cast from a graveyard'],
    ['happened', { cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }, 'a creature died this turn'],
    ['cast two spells', { cond: 'happened', event: { ev: 'cast' }, scope: 'turn', times: { op: '>=', value: 2 }, by: 'you' }, "you've cast 2 or more spells this turn"],
    ['monarch', { cond: 'designation', who: { ref: 'you' }, what: 'monarch' }, "you're the monarch"],
    ['initiative', { cond: 'designation', who: { ref: 'you' }, what: 'initiative' }, 'you have the initiative'],
    ['city blessing', { cond: 'designation', who: { ref: 'you' }, what: 'citysBlessing' }, "you have the city's blessing"],
    ['did', { cond: 'did', step: 'x' }, 'you do'],
    ['did not', { cond: 'did', step: 'x', not: true }, "you don't"],
    ['ask', { cond: 'ask', text: 'you control more lands than each other player' }, 'you control more lands than each other player'],
  ];
  it.each(cases)('%s', (_name, c, expected) => {
    expect(renderCondition(c, fresh())).toBe(expected);
  });
});

describe('CR 611.2, 514.2: renderDuration', () => {
  const cases: [string, Duration, string][] = [
    ['end of turn', { d: 'endOfTurn' }, 'until end of turn'],
    ['end of combat', { d: 'endOfCombat' }, 'until end of combat'],
    ['permanent has no words', { d: 'permanent' }, ''],
    ['as long as it is tapped', { d: 'whileSource', as: 'tapped' }, 'for as long as Test Card remains tapped'],
    ['as long as you control it', { d: 'whileSource', as: 'controlled' }, 'for as long as you control Test Card'],
    ['as long as on the battlefield', { d: 'whileSource', as: 'onBattlefield' }, 'for as long as Test Card remains on the battlefield'],
    ['until it leaves', { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } }, 'until Test Card leaves the battlefield'],
    ['until your next turn', { d: 'untilNextTurn', whose: { ref: 'you' } }, 'until your next turn'],
    ['until your next upkeep', { d: 'untilNextStep', step: 'upkeep', whose: 'you' }, 'until your next upkeep'],
    ['as long as a condition holds', { d: 'asLongAs', cond: { cond: 'turnOf', whose: 'you' } }, "for as long as it's your turn"],
  ];
  it.each(cases)('%s', (_name, d, expected) => {
    expect(renderDuration(d, fresh())).toBe(expected);
  });
});

describe('CR 603.2, 700.4, 614.1: renderEvent', () => {
  const cases: [string, EventPattern, string][] = [
    ['enters', { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, 'Test Card enters'],
    ['a creature you control enters', { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' }, 'a creature you control enters'],
    ['dies', { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }, 'a creature you control dies'],
    ['leaves', { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }, 'Test Card leaves the battlefield'],
    ['is exiled', { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'exile' }, 'a creature is put into exile from the battlefield'],
    ['put into a graveyard', { ev: 'zoneChange', subject: { types: ['Artifact'] }, from: 'battlefield', to: 'graveyard' }, 'an artifact is put into a graveyard from the battlefield'],
    ['cast', { ev: 'cast', player: 'you' }, 'you cast a spell'],
    ['opponent casts a noncreature spell', { ev: 'cast', player: 'opponent', spell: { notTypes: ['Creature'] } }, 'an opponent casts a noncreature spell'],
    ['cast from graveyard', { ev: 'cast', player: 'you', from: 'graveyard' }, 'you cast a spell from a graveyard'],
    ['attacks', { ev: 'attacks', attacker: { self: true } }, 'Test Card attacks'],
    ['attacks alone', { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' }, alone: true }, 'a creature you control attacks alone'],
    ['attacks you', { ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'you' }, 'a creature attacks you'],
    ['blocks', { ev: 'blocks', blocker: { self: true } }, 'Test Card blocks'],
    ['becomes blocked', { ev: 'becomesBlocked', attacker: { self: true } }, 'Test Card becomes blocked'],
    ['combat damage to a player', { ev: 'damage', source: { self: true }, recipient: { player: 'any' }, combat: true }, 'Test Card deals combat damage to a player'],
    ['damage to you', { ev: 'damage', source: { types: ['Creature'] }, recipient: { player: 'you' } }, 'a creature deals damage to you'],
    ['is dealt damage', { ev: 'damage', recipient: { object: { self: true } } }, 'Test Card is dealt damage'],
    ['upkeep', { ev: 'step', step: 'upkeep', whose: 'you' }, 'the beginning of your upkeep'],
    ['each end step', { ev: 'step', step: 'end' }, 'the beginning of each end step'],
    ['beginning of combat', { ev: 'step', step: 'beginCombat', whose: 'you' }, 'the beginning of combat on your turn'],
    ['gain life', { ev: 'life', change: 'gain', player: 'you' }, 'you gain life'],
    ['opponent loses life', { ev: 'life', change: 'loss', player: 'opponent' }, 'an opponent loses life'],
    ['draw', { ev: 'draw', player: 'you' }, 'you draw a card'],
    ['second card each turn', { ev: 'draw', player: 'you', nth: 2 }, 'you draw your second card each turn'],
    ['becomes tapped', { ev: 'becomes', what: 'tapped', object: { self: true } }, 'Test Card becomes tapped'],
    ['becomes the target', { ev: 'becomes', what: 'targeted', object: { self: true } }, 'Test Card becomes the target of a spell or ability'],
    ['counters put', { ev: 'counters', change: 'put', kind: '+1/+1', on: { types: ['Creature'], controller: 'you' } }, 'a +1/+1 counter is put on a creature you control'],
    ['sacrifice', { ev: 'action', verb: 'sacrifice', actor: 'you', object: { types: ['Creature'] } }, 'you sacrifice a creature'],
    ['discard', { ev: 'action', verb: 'discard', actor: 'opponent' }, 'an opponent discards a card'],
    ['create a token', { ev: 'createToken', player: 'you' }, 'you create a token'],
    ['roll a die', { ev: 'dieRoll', player: 'you' }, 'you roll a die'],
    ['explores', { ev: 'action', verb: 'explore', object: { self: true } }, 'Test Card explores'],
    ['state trigger', { ev: 'state', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } }, 'you control no creatures'],
    ['resolves', { ev: 'resolves', what: { self: true } }, 'Test Card resolves'],
  ];
  it.each(cases)('%s', (_name, ev, expected) => {
    expect(renderEvent(ev, fresh())).toBe(expected);
  });
});

describe('CR 118.1, 601.2f, 602.2: renderCost', () => {
  const cases: [string, CostDef, string][] = [
    ['mana and tap', { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'R' }], tap: true }, '{2}{R}, {T}'],
    ['untap symbol', { untap: true }, '{Q}'],
    ['loyalty plus', { loyalty: 2 }, '+2'],
    ['loyalty minus', { loyalty: -3 }, '-3'],
    ['loyalty zero', { loyalty: 0 }, '0'],
    ['sacrifice a creature', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'], controller: 'you' }, count: 1 }] }, 'Sacrifice a creature'],
    ['sacrifice another', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'], other: true }, count: 1 }] }, 'Sacrifice another creature'],
    ['sacrifice two', { other: [{ kind: 'sacrifice', filter: { subtypes: ['Goblin'] }, count: 2 }] }, 'Sacrifice two Goblins'],
    ['sacrifice self', { other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, 'Sacrifice Test Card'],
    ['pay life', { other: [{ kind: 'payLife', amount: 2 }] }, 'Pay 2 life'],
    ['discard a card', { other: [{ kind: 'discard', count: 1 }] }, 'Discard a card'],
    ['discard at random', { other: [{ kind: 'discard', count: 1, random: true }] }, 'Discard a card at random'],
    ['discard your hand', { other: [{ kind: 'discard', count: 'any', hand: true }] }, 'Discard your hand'],
    ['exile from graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', filter: { types: ['Creature'] }, count: 1 }] }, 'Exile a creature card from your graveyard'],
    ['exile self from graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }] }, 'Exile Test Card from your graveyard'],
    ['tap an untapped creature', { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'], controller: 'you' }, count: 1 }] }, 'Tap an untapped creature you control'],
    ['crew', { other: [{ kind: 'tapPower', filter: { types: ['Creature'], controller: 'you' }, power: 3 }] }, 'Tap any number of untapped creatures you control with total power 3 or greater'],
    ['remove a counter', { other: [{ kind: 'removeCounters', counter: '+1/+1', count: 1, self: true }] }, 'Remove a +1/+1 counter from Test Card'],
    ['remove counters', { other: [{ kind: 'removeCounters', counter: 'charge', count: 3, self: true }] }, 'Remove three charge counters from Test Card'],
    ['put a counter', { other: [{ kind: 'putCounters', counter: '-1/-1', count: 1, self: true }] }, 'Put a -1/-1 counter on Test Card'],
    ['return to hand', { other: [{ kind: 'returnToHand', filter: { types: ['Land'], controller: 'you' }, count: 1 }] }, "Return a land you control to its owner's hand"],
    ['reveal a card', { other: [{ kind: 'reveal', zone: 'hand', filter: { colors: ['R'] }, count: 1 }] }, 'Reveal a red card from your hand'],
    ['mill', { other: [{ kind: 'mill', count: 2 }] }, 'Mill two cards'],
    ['energy', { other: [{ kind: 'payEnergy', amount: 2 }] }, 'Pay {E}{E}'],
    ['exert', { other: [{ kind: 'action', action: 'exert' }] }, 'Exert Test Card'],
    ['collect evidence', { other: [{ kind: 'action', action: 'collectEvidence', arg: 4 }] }, 'Collect evidence 4'],
    ['manual', { other: [{ kind: 'manual', text: 'Put a rock on a stick' }] }, 'Put a rock on a stick'],
    ['several parts', { mana: [{ kind: 'generic', amount: 1 }], tap: true, other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, '{1}, {T}, Sacrifice Test Card'],
  ];
  it.each(cases)('%s', (_name, c, expected) => {
    expect(renderCost(c, fresh())).toBe(expected);
  });
});

describe('CR 702, 207.2: renderKeyword', () => {
  const kw = (k: Partial<KeywordAbilityDef> & { keyword: string }): KeywordAbilityDef => ({ kind: 'keyword', text: '', ...k });
  const cases: [string, KeywordAbilityDef, string][] = [
    ['flying', kw({ keyword: 'flying' }), 'Flying'],
    ['first strike', kw({ keyword: 'first strike' }), 'First strike'],
    ['kicker', kw({ keyword: 'kicker', cost: { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'G' }] } }), 'Kicker {2}{G}'],
    ['equip', kw({ keyword: 'equip', cost: { mana: [{ kind: 'generic', amount: 1 }] } }), 'Equip {1}'],
    ['ward mana', kw({ keyword: 'ward', cost: { mana: [{ kind: 'generic', amount: 2 }] } }), 'Ward {2}'],
    ['ward life', kw({ keyword: 'ward', cost: { other: [{ kind: 'payLife', amount: 3 }] } }), 'Ward--Pay 3 life.'],
    ['amount', kw({ keyword: 'annihilator', amount: 2 }), 'Annihilator 2'],
    ['protection', kw({ keyword: 'protection', quality: 'color:R' }), 'Protection from red'],
    ['protection from creature types', kw({ keyword: 'protection', quality: 'subtype:goblins' }), 'Protection from Goblins'],
    ['protection from everything', kw({ keyword: 'protection', quality: 'everything' }), 'Protection from everything'],
    ['hexproof from', kw({ keyword: 'hexproof', quality: 'color:B' }), 'Hexproof from black'],
    ['enchant', kw({ keyword: 'enchant', filter: { types: ['Creature'] } }), 'Enchant creature'],
    ['enchant player', kw({ keyword: 'enchant', player: 'any' }), 'Enchant player'],
    ['landwalk', kw({ keyword: 'landwalk', quality: 'swamp' }), 'Swampwalk'],
    ['snow landwalk', kw({ keyword: 'landwalk', quality: 'snow forest' }), 'Snow forestwalk'],
    ['cycling', kw({ keyword: 'cycling', cost: { mana: [{ kind: 'generic', amount: 2 }] } }), 'Cycling {2}'],
    ['escape', kw({ keyword: 'escape', cost: { mana: [{ kind: 'generic', amount: 3 }, { kind: 'colored', color: 'R' }], other: [{ kind: 'exileFrom', zone: 'graveyard', count: 4, filter: {} }] } }), 'Escape--{3}{R}, Exile four cards from your graveyard.'],
  ];
  it.each(cases)('%s', (_name, k, expected) => {
    expect(renderKeyword(k, fresh())).toBe(expected);
  });
});
