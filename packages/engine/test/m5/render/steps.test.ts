/**
 * WP2: one case per effect op (design 2.3 `EffectStep`, 8.7): the step inside a spell ability prints the Oracle wording, and the gate accepts exactly that
 * wording. The expected strings are what the printed cards say.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, ObjRef, TargetSpec } from '../../../src/types/ability';
import { renderAbility, renderGate } from '../../../src/index';
import { RENDERERS } from '../../../src/render/step';

const ctx = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
const you = { ref: 'you' } as const;
const t = (id: string) => ({ ref: 'target', id }) as const;
const creature = (id: string, extra: Partial<TargetSpec> = {}): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: '', filter: { types: ['Creature'] }, ...extra });
const player = (id: string): TargetSpec => ({ id, kind: 'player', min: 1, max: 1, text: '' });
const spell = (steps: EffectStep[], targets: TargetSpec[] = []): AbilityDef => ({ kind: 'spell', text: '', effect: { targets, steps } });
const mana = (n: number) => [{ kind: 'generic' as const, amount: n }];
const eachCreature: ObjRef = { ref: 'each', filter: { types: ['Creature'] } };

type Case = [string, AbilityDef, string];

const cases: Case[] = [
  // --- control flow
  ['if', spell([{ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'draw', who: you, count: 1 }], else: [{ op: 'gainLife', who: you, amount: 1 }] }]),
    "If it's your turn, draw a card. Otherwise, gain 1 life."],
  ['may', spell([{ op: 'may', who: you, do: [{ op: 'draw', who: you, count: 1 }] }]), 'You may draw a card.'],
  ['may with otherwise', spell([{ op: 'may', who: you, do: [{ op: 'draw', who: you, count: 1 }], otherwise: [{ op: 'loseLife', who: you, amount: 1 }] }]), "You may draw a card. If you don't, lose 1 life."],
  ['may by another player', spell([{ op: 'may', who: t('p'), do: [{ op: 'draw', who: t('p'), count: 1 }] }], [player('p')]), 'Target player may draw a card.'],
  ['may have a source deal damage', spell([{ op: 'may', who: you, do: [{ op: 'damage', source: { ref: 'self' }, to: t('c'), amount: 2 }] }], [creature('c')]), 'You may have Test Card deal 2 damage to target creature.'],
  ['pay then', spell([{ op: 'pay', who: you, cost: { mana: mana(2) }, then: [{ op: 'draw', who: you, count: 1 }] }]), 'You may pay {2}. If you do, draw a card.'],
  ['pay life', spell([{ op: 'pay', who: you, cost: { other: [{ kind: 'payLife', amount: 2 }] }, mandatory: true }]), 'Pay 2 life.'],
  ['forEach', spell([{ op: 'forEach', over: eachCreature, as: 'c', do: [{ op: 'tap', what: { ref: 'bound', name: 'c' } }] }]), 'For each creature, tap it.'],
  ['repeat', spell([{ op: 'repeat', times: 3, do: [{ op: 'draw', who: you, count: 1 }] }]), 'Do the following three times: Draw a card.'],
  ['chooseObjects', spell([{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, min: 1, max: 1, as: 'c' }]), 'Choose a creature you control.'],
  ['choose up to two', spell([{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 0, max: 2, as: 'c' }]), 'Choose up to two creatures.'],
  ['chooseValue color', spell([{ op: 'chooseValue', who: you, what: 'color', as: 'x' }]), 'Choose a color.'],
  ['chooseValue creature type', spell([{ op: 'chooseValue', who: you, what: 'creatureType', as: 'x' }]), 'Choose a creature type.'],
  ['chooseValue opponent', spell([{ op: 'chooseValue', who: you, what: 'opponent', as: 'x' }]), 'Choose an opponent.'],
  ['manual', spell([{ op: 'manual', text: 'Do something unusual.', reason: 'test' }]), 'Do something unusual.'],
  // --- damage and life
  ['damage to each creature', spell([{ op: 'damage', source: { ref: 'self' }, to: eachCreature, amount: 2 }]), 'Test Card deals 2 damage to each creature.'],
  ['damage unpreventable', spell([{ op: 'damage', source: { ref: 'self' }, to: t('c'), amount: 3, unpreventable: true }], [creature('c')]), "Test Card deals 3 damage to target creature. That damage can't be prevented."],
  ['damage to you', spell([{ op: 'damage', source: { ref: 'self' }, to: you, amount: 1 }]), 'Test Card deals 1 damage to you.'],
  ['damage X', spell([{ op: 'damage', source: { ref: 'self' }, to: t('c'), amount: { q: 'X' } }], [creature('c')]), 'Test Card deals X damage to target creature.'],
  ['gain life', spell([{ op: 'gainLife', who: you, amount: 3 }]), 'Gain 3 life.'],
  ['gain life equal to', spell([{ op: 'gainLife', who: you, amount: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } }]), 'Gain life equal to the number of creatures you control.'],
  ['lose life', spell([{ op: 'loseLife', who: t('p'), amount: 2 }], [player('p')]), 'Target player loses 2 life.'],
  ['each opponent loses life', spell([{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 1 }]), 'Each opponent loses 1 life.'],
  ['set life', spell([{ op: 'setLife', who: t('p'), value: 1 }], [player('p')]), "Target player's life total becomes 1."],
  ['fight', spell([{ op: 'fight', a: t('a'), b: t('b') }], [creature('a', { filter: { types: ['Creature'], controller: 'you' } }), creature('b', { filter: { types: ['Creature'], not: { controller: 'you' } } })]),
    "Target creature you control fights target creature you don't control."],
  ['two players in one sentence', spell([{ op: 'loseLife', who: t('p'), amount: 1 }, { op: 'gainLife', who: you, amount: 1 }], [player('p')]), 'Target player loses 1 life and you gain 1 life.'],
  ['one player twice', spell([{ op: 'draw', who: t('p'), count: 1 }, { op: 'loseLife', who: t('p'), amount: 1 }], [player('p')]), 'Target player draws a card and loses 1 life.'],
  ['gain life per creature', spell([{ op: 'gainLife', who: you, amount: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } }]), 'Gain life equal to the number of creatures you control.'],
  // --- cards
  ['draw', spell([{ op: 'draw', who: you, count: 2 }]), 'Draw two cards.'],
  ['draw X', spell([{ op: 'draw', who: you, count: { q: 'X' } }]), 'Draw X cards.'],
  ['each player draws', spell([{ op: 'draw', who: { ref: 'each', who: 'player' }, count: 1 }]), 'Each player draws a card.'],
  ['discard', spell([{ op: 'discard', who: t('p'), count: 1 }], [player('p')]), 'Target player discards a card.'],
  ['discard hand', spell([{ op: 'discard', who: you, count: 'hand' }]), 'Discard your hand.'],
  ['discard at random', spell([{ op: 'discard', who: t('p'), count: 1, mode: 'random' }], [player('p')]), 'Target player discards a card at random.'],
  ['discard a creature card', spell([{ op: 'discard', who: you, count: 1, filter: { types: ['Creature'] } }]), 'Discard a creature card.'],
  ['mill', spell([{ op: 'mill', who: t('p'), count: 3 }], [player('p')]), 'Target player mills three cards.'],
  ['scry', spell([{ op: 'scry', who: you, count: 2 }]), 'Scry 2.'],
  ['surveil', spell([{ op: 'surveil', who: you, count: 1 }]), 'Surveil 1.'],
  ['reveal the top cards', spell([{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 3 } }]), 'Reveal the top three cards of your library.'],
  ['reveal your hand', spell([{ op: 'reveal', who: t('p'), what: { ref: 'each', filter: { zone: 'hand', owner: t('p') } } }], [player('p')]), 'Target player reveals their hand.'],
  ['look', spell([{ op: 'look', who: you, at: { ref: 'topCards', player: you, count: 1 } }]), 'Look at the top card of your library.'],
  ['search', spell([{ op: 'search', who: you, zone: 'library', filter: { zone: 'library', types: ['Creature'] }, max: 1, as: 'c' }]), 'Search your library for a creature card.'],
  ['search and reveal', spell([{ op: 'search', who: you, zone: 'library', filter: { zone: 'library', types: ['Land'] }, max: 2, reveal: true, as: 'c' }]), 'Search your library for up to two land cards, reveal them.'],
  ['search a graveyard', spell([{ op: 'search', who: you, zone: 'graveyard', filter: { zone: 'graveyard' }, max: 1, as: 'c' }]), 'Search your graveyard for a card.'],
  ['shuffle', spell([{ op: 'shuffle', who: you }]), 'Shuffle.'],
  // --- moving
  ['exile', spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } }], [creature('c')]), 'Exile target creature.'],
  ['exile all', spell([{ op: 'move', what: eachCreature, to: { zone: 'exile' } }]), 'Exile all creatures.'],
  ['return to hand', spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [creature('c')]), "Return target creature to its owner's hand."],
  ['put on top', spell([{ op: 'move', what: t('c'), to: { zone: 'library', position: 'top' } }], [creature('c')]), "Put target creature on top of its owner's library."],
  ['put on the bottom', spell([{ op: 'move', what: t('c'), to: { zone: 'library', position: 'bottom' } }], [creature('c')]), "Put target creature on the bottom of its owner's library."],
  ['put into a graveyard', spell([{ op: 'move', what: t('c'), to: { zone: 'graveyard' } }], [creature('c', { filter: { types: ['Creature'], zone: 'hand' } })]), "Put target creature card from a hand into its owner's graveyard."],
  ['onto the battlefield', spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you, tapped: true } }], [creature('c', { filter: { types: ['Creature'], zone: 'graveyard', owner: 'you' } })]), 'Return target creature card from your graveyard to the battlefield tapped under your control.'],
  ['until', spell([{ op: 'move', what: t('c'), to: { zone: 'exile' }, until: { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } } }], [creature('c')]), 'Exile target creature until Test Card leaves the battlefield.'],
  ['destroy', spell([{ op: 'destroy', what: t('c') }], [creature('c')]), 'Destroy target creature.'],
  ['destroy cant regenerate', spell([{ op: 'destroy', what: t('c'), regeneration: 'cant' }], [creature('c')]), "Destroy target creature. It can't be regenerated."],
  ['sacrifice', spell([{ op: 'sacrifice', what: { ref: 'self' } }]), 'Sacrifice Test Card.'],
  ['each player sacrifices', spell([{ op: 'sacrificeChoice', who: { ref: 'each', who: 'player' }, filter: { types: ['Creature'] }, count: 1 }]), 'Each player sacrifices a creature.'],
  ['counter', spell([{ op: 'counter', what: t('s') }], [{ id: 's', kind: 'spell', min: 1, max: 1, text: '' }]), 'Counter target spell.'],
  ['counter an ability', spell([{ op: 'counter', what: t('s') }], [{ id: 's', kind: 'ability', min: 1, max: 1, text: '' }]), 'Counter target ability.'],
  ['create a token', spell([{ op: 'createToken', who: you, count: 1, token: { name: 'Zombie', colors: ['B'], types: ['Creature'], subtypes: ['Zombie'], power: 2, toughness: 2 } }]), 'Create a 2/2 black Zombie creature token.'],
  ['create tokens with flying', spell([{ op: 'createToken', who: you, count: 3, token: { name: 'Spirit', colors: ['W'], types: ['Creature'], subtypes: ['Spirit'], power: 1, toughness: 1, keywords: ['flying'] } }]), 'Create three 1/1 white Spirit creature tokens with flying.'],
  ['create a Treasure', spell([{ op: 'createToken', who: you, count: 2, token: { predefined: 'Treasure' } }]), 'Create two Treasure tokens.'],
  ['create a colorless token', spell([{ op: 'createToken', who: you, count: 1, token: { name: 'Construct', types: ['Artifact', 'Creature'], subtypes: ['Construct'], power: 0, toughness: 0 } }]), 'Create a 0/0 colorless Construct artifact creature token.'],
  ['create a tapped and attacking token', spell([{ op: 'createToken', who: you, count: 1, tapped: true, attacking: true, token: { name: 'Soldier', colors: ['W'], types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1 } }]), "Create a 1/1 white Soldier creature token that's tapped and attacking."],
  ['copy a spell', spell([{ op: 'copy', what: t('s'), result: 'spell', who: you, newTargets: 'may' }], [{ id: 's', kind: 'spell', min: 1, max: 1, text: '', filter: { types: ['Instant', 'Sorcery'] } }]), 'Copy target instant or sorcery spell. You may choose new targets for the copy.'],
  ['token copy', spell([{ op: 'copy', what: t('c'), result: 'token', who: you }], [creature('c', { filter: { types: ['Creature'], controller: 'you' } })]), "Create a token that's a copy of target creature you control."],
  ['tap', spell([{ op: 'tap', what: t('c') }], [creature('c')]), 'Tap target creature.'],
  ['untap', spell([{ op: 'untap', what: { ref: 'self' } }]), 'Untap Test Card.'],
  ['attach', spell([{ op: 'attach', what: { ref: 'self' }, to: t('c') }], [creature('c', { filter: { types: ['Creature'], controller: 'you' } })]), 'Attach Test Card to target creature you control.'],
  ['transform', spell([{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }]), 'Transform Test Card.'],
  ['turn face up', spell([{ op: 'changeFace', what: t('c'), to: 'faceUp' }], [creature('c')]), 'Turn target creature face up.'],
  ['phase out', spell([{ op: 'phaseOut', what: t('c') }], [creature('c')]), 'Phase out target creature.'],
  ['regenerate', spell([{ op: 'regenerate', what: t('c') }], [creature('c')]), 'Regenerate target creature.'],
  ['remove from combat', spell([{ op: 'removeFromCombat', what: t('c') }], [creature('c')]), 'Remove target creature from combat.'],
  ['exchange control', spell([{ op: 'exchange', a: t('a'), b: t('b'), what: 'control' }], [creature('a'), creature('b', { distinctFrom: ['a'] })]), 'Exchange control of target creature and another target creature.'],
  ['exchange life totals', spell([{ op: 'exchange', a: you, b: t('p'), what: 'life' }], [player('p')]), 'You and target player exchange life totals.'],
  ['cast', spell([{ op: 'cast', who: you, what: t('c'), free: true }], [{ id: 'c', kind: 'object', min: 1, max: 1, text: '', filter: { types: ['Instant'], zone: 'graveyard', owner: 'you' } }]), 'Cast target instant card from your graveyard without paying its mana cost.'],
  ['may cast', spell([{ op: 'cast', who: you, what: t('c'), optional: true }], [{ id: 'c', kind: 'object', min: 1, max: 1, text: '', filter: { zone: 'exile' } }]), 'You may cast target card in exile.'],
  // --- counters
  ['put counters', spell([{ op: 'putCounters', on: t('c'), kind: '+1/+1', count: 2 }], [creature('c')]), 'Put two +1/+1 counters on target creature.'],
  ['put a counter', spell([{ op: 'putCounters', on: { ref: 'self' }, kind: 'charge', count: 1 }]), 'Put a charge counter on Test Card.'],
  ['poison counters', spell([{ op: 'putCounters', on: t('p'), kind: 'poison', count: 3 }], [player('p')]), 'Target player gets three poison counters.'],
  ['energy', spell([{ op: 'putCounters', on: you, kind: 'energy', count: 2 }]), 'Get {E}{E}.'],
  ['remove counters', spell([{ op: 'removeCounters', from: t('c'), kind: '-1/-1', count: 1 }], [creature('c')]), 'Remove a -1/-1 counter from target creature.'],
  ['remove all counters', spell([{ op: 'removeCounters', from: t('c'), kind: 'any', count: 'all' }], [creature('c')]), 'Remove all counters from target creature.'],
  ['move counters', spell([{ op: 'moveCounters', from: t('a'), to: t('b'), kind: '+1/+1', count: 1 }], [creature('a'), creature('b', { distinctFrom: ['a'] })]), 'Move a +1/+1 counter from target creature onto another target creature.'],
  // --- mana
  ['add one color', spell([{ op: 'addMana', who: you, units: [['R']] }]), 'Add {R}.'],
  ['add two', spell([{ op: 'addMana', who: you, units: [['R'], ['R']] }]), 'Add {R}{R}.'],
  ['add a choice', spell([{ op: 'addMana', who: you, units: [['R', 'G']] }]), 'Add {R} or {G}.'],
  ['add any color', spell([{ op: 'addMana', who: you, units: [['W', 'U', 'B', 'R', 'G']] }]), 'Add one mana of any color.'],
  ['add any one color', spell([{ op: 'addMana', who: you, dynamic: { kind: 'anyOneColor', count: 3 } }]), 'Add three mana of any one color.'],
  ['add chosen color', spell([{ op: 'addMana', who: you, dynamic: { kind: 'chosen', link: 'c', count: 1 } }]), 'Add one mana of the chosen color.'],
  // --- lasting effects
  ['gets +X', spell([{ op: 'effect', effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 1, toughness: -1 }] }], duration: { d: 'endOfTurn' } }], [creature('c')]), 'Target creature gets +1/-1 until end of turn.'],
  ['gains flying', spell([{ op: 'effect', effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 6, add: [{ kind: 'keyword', text: '', keyword: 'flying' }] }] }], duration: { d: 'endOfTurn' } }], [creature('c')]), 'Target creature gains flying until end of turn.'],
  ['gets and gains', spell([{ op: 'effect', effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 2, toughness: 2 }, { layer: 6, add: [{ kind: 'keyword', text: '', keyword: 'trample' }] }] }], duration: { d: 'endOfTurn' } }], [creature('c')]), 'Target creature gets +2/+2 and gains trample until end of turn.'],
  ['team pump', spell([{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }], duration: { d: 'endOfTurn' } }]), 'Creatures you control get +1/+1 until end of turn.'],
  ['gain control', spell([{ op: 'effect', effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 2, controller: you }] }], duration: { d: 'endOfTurn' } }], [creature('c')]), 'Gain control of target creature until end of turn.'],
  ['cant block', spell([{ op: 'effect', effects: [{ s: 'restrict', subject: t('c'), mode: 'cant', action: 'block' }], duration: { d: 'endOfTurn' } }], [creature('c')]), "Target creature can't block until end of turn."],
  ['delayed trigger', spell([{ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [{ op: 'sacrifice', what: { ref: 'self' } }] }]), 'Sacrifice Test Card at the beginning of the next end step.'],
  ['delayed draw', spell([{ op: 'delay', when: { at: 'step', step: 'upkeep', whose: 'you', next: true }, do: [{ op: 'draw', who: you, count: 1 }, { op: 'gainLife', who: you, amount: 1 }] }]), 'At the beginning of your next upkeep, draw a card and gain 1 life.'],
  ['reflexive', spell([{ op: 'may', who: you, as: 'd', do: [{ op: 'sacrifice', what: { ref: 'self' } }] }, { op: 'reflexive', when: { did: 'd' }, targets: [creature('c')], do: [{ op: 'destroy', what: t('c') }] }]), 'You may sacrifice Test Card. When you do, destroy target creature.'],
  // --- the game
  ['extra turn', spell([{ op: 'extraTurn', who: you, count: 1 }]), 'Take an extra turn after this one.'],
  ['extra phase', spell([{ op: 'extraPhase', phase: 'combat' }]), 'After this phase, there is an additional combat phase.'],
  ['end the turn', spell([{ op: 'endTurn' }]), 'End the turn.'],
  ['win the game', spell([{ op: 'winGame', who: you }]), 'Win the game.'],
  ['lose the game', spell([{ op: 'loseGame', who: t('p') }], [player('p')]), 'Target player loses the game.'],
  ['emblem', spell([{ op: 'createEmblem', who: you, abilities: [{ kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }] }]),
    'Get an emblem with "Creatures you control get +1/+1."'],
  ['roll a die', spell([{ op: 'rollDie', who: you, sides: 20 }]), 'Roll a d20.'],
  ['flip a coin', spell([{ op: 'flipCoin', who: you, onWin: [{ op: 'draw', who: you, count: 1 }], onLose: [{ op: 'loseLife', who: you, amount: 1 }] }]), 'Flip a coin. If you win the flip, draw a card. If you lose the flip, lose 1 life.'],
  ['monarch', spell([{ op: 'designate', who: you, what: 'monarch' }]), 'Become the monarch.'],
  ['initiative', spell([{ op: 'designate', who: you, what: 'initiative' }]), 'Take the initiative.'],
  ['investigate', spell([{ op: 'action', action: 'investigate', who: you }]), 'Investigate.'],
  ['proliferate', spell([{ op: 'action', action: 'proliferate', who: you }]), 'Proliferate.'],
  ['amass', spell([{ op: 'action', action: 'amass', who: you, n: 2, arg: 'Orc' }]), 'Amass Orcs 2.'], // PUSH1 T1: `arg` is the singular subtype the macro gives the Army (CR 701.47a)
  ['explore', spell([{ op: 'action', action: 'explore', who: you, subject: t('c') }], [creature('c')]), 'Target creature explores.'],
  ['goad', spell([{ op: 'action', action: 'goad', who: you, subject: t('c') }], [creature('c')]), 'Goad target creature.'],
  ['connive', spell([{ op: 'action', action: 'connive', who: you, subject: { ref: 'self' } }]), 'Test Card connives.'],
  ['venture', spell([{ op: 'action', action: 'venture', who: you }]), 'Venture into the dungeon.'],
];

describe('CR 608.2c, 701, 119, 121, 400, 111, 120: every op prints its Oracle wording, and the gate accepts exactly that wording', () => {
  it.each(cases)('%s', (_name, def, expected) => {
    expect(renderAbility(def, ctx).join(' ')).toBe(expected);
    const r = renderGate(def, [expected], ctx);
    expect(r.ok, `${r.rendered}\n${r.expected}`).toBe(true);
  });
});

describe('design 5.2: RENDERERS covers every op of the model', () => {
  const OPS = [
    'if', 'may', 'pay', 'forEach', 'repeat', 'let', 'chooseObjects', 'chooseValue', 'manual', 'damage', 'gainLife', 'loseLife', 'setLife', 'draw', 'discard', 'mill', 'scry', 'surveil',
    'reveal', 'look', 'search', 'shuffle', 'piles', 'move', 'destroy', 'sacrifice', 'sacrificeChoice', 'counter', 'createToken', 'copy', 'tap', 'untap', 'attach', 'changeFace',
    'phaseOut', 'regenerate', 'removeFromCombat', 'fight', 'exchange', 'cast', 'putCounters', 'removeCounters', 'moveCounters', 'addMana', 'effect', 'delay', 'reflexive',
    'extraTurn', 'extraPhase', 'endTurn', 'winGame', 'loseGame', 'createEmblem', 'rollDie', 'flipCoin', 'designate', 'action',
    'designateObject', // M6-6 (CR 716.2a, 719.3b, 722.3a-b)
    'exileUntil', // Cloud std-eoe (CR 406.1, 608.2c)
    'revealUntil', // r3-dig (CR 701.20a, 608.2c)
    'fromOutside', // cloud r3-mech (CR 400.11b)
    'changeTarget', 'extraStep', // Cloud r4-fxb (CR 115.7a, 500.9)
    'chooseNewTargets', // E3XP (CR 115.7d)
    'nextSpell', // Standard round 10 (CR 601.2i, 611.2)
    'reportAction', // std-mana-12: earthbend and firebending report their action (CR 701.66a, 702.189)
    'clash', // p2-player-rules-2 (CR 701.30)
    'controlPlayer', // std-control-3: you control a player during their next turn or combat phase (CR 723.1)
    'becomeBlocked', // p2-combat-flow-2: an unblocked attacking creature becomes blocked (CR 509.1h)
    'removeDamage', // trek-8: all damage marked on a permanent is removed (CR 120.6)
  ];
  it('has a renderer for each of the ops', () => {
    expect(Object.keys(RENDERERS).sort()).toEqual([...OPS].sort());
  });
  it('a step renderer prints a sentence', () => {
    const r = RENDERERS.draw!({ op: 'draw', who: you, count: 3 }, ctx);
    expect(r).toBe('Draw three cards.');
  });
});
