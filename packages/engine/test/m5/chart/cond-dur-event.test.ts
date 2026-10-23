/**
 * WP6: the Cond, Dur and Event hole grammars. Rules cited: CR 102.1 (turn), 118.12 (if you do), 122.7, 506.2 (defending player), 508 (attackers), 509 (blockers),
 * 510 (combat damage), 514.2 (end of turn), 603.2 (triggers), 603.2c (one or more), 603.4 (intervening if), 603.8 (state triggers), 607.2i (kicker),
 * 610.3 (until), 611.2b (for as long as), 700.4 (dies), 702.37 (face up), 711, 716.
 */
import { describe, expect, it } from 'vitest';
import { ENV, full, one, rejects, toks } from './env';
import { runHole } from '../../../src/parser/holes';

const creature = { types: ['Creature'] };
const you = { ref: 'you' };
const exists = (filter: unknown, atLeast?: unknown): unknown => ({ cond: 'exists', of: { ref: 'each', filter }, ...(atLeast !== undefined ? { atLeast } : {}) });
const itObj = { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', text: 'it' } };

describe('WP6 Cond (CR 603.4, 608.2, 118.12)', () => {
  it.each([
    ['you control a creature', exists({ ...creature, controller: 'you' })],
    ['you control no creatures', { cond: 'not', of: exists({ ...creature, controller: 'you' }) }],
    ['you control another creature', exists({ ...creature, controller: 'you', other: true })],
    ['you control two or more creatures', exists({ ...creature, controller: 'you' }, 2)],
    ['you control at least three Elves', exists({ subtypes: ['Elf'], controller: 'you' }, 3)],
    ["you don't control a creature", { cond: 'not', of: exists({ ...creature, controller: 'you' }) }],
    ['an opponent controls a creature', exists({ ...creature, controller: 'opponent' })],
    ['an opponent controls no lands', { cond: 'not', of: exists({ types: ['Land'], controller: 'opponent' }) }],
    ['there are seven or more cards in your graveyard', exists({ zone: 'graveyard', owner: 'you', isCard: true }, 7)],
    ['there are no creatures on the battlefield', { cond: 'not', of: exists({ ...creature, zone: 'battlefield' }) }],
    ['you have 5 or less life', { cond: 'compare', left: { q: 'life', of: you }, op: '<=', right: 5 }],
    ['you have no cards in hand', { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: you }, op: '==', right: 0 }],
    ['you have seven or more cards in hand', { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: you }, op: '>=', right: 7 }],
    ["it's your turn", { cond: 'turnOf', whose: 'you' }],
    ["it's not your turn", { cond: 'not', of: { cond: 'turnOf', whose: 'you' } }],
    ["it's an opponent's turn", { cond: 'turnOf', whose: 'opponent' }],
    ['~ was kicked', { cond: 'wasCast', kicked: true }],
    ["~ wasn't kicked", { cond: 'not', of: { cond: 'wasCast', kicked: true } }],
    ['~ was cast from your hand', { cond: 'wasCast', from: 'hand' }],
    ['you do', { cond: 'did', step: '', $step: 'previous' }],
    ["you don't", { cond: 'did', step: '', $step: 'previous', not: true }],
    ['~ is tapped', { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } }],
    ["it's tapped", { cond: 'matches', object: itObj, filter: { tapped: true } }],
    ["it's a creature card", { cond: 'matches', object: itObj, filter: { ...creature, isCard: true } }],
    ['that creature has flying', { cond: 'matches', object: { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', head: 'creature', text: 'that creature' } }, filter: { keyword: 'flying' } }],
    ['enchanted creature has power 4 or greater', { cond: 'matches', object: { ref: 'attachedTo' }, filter: { power: { op: '>=', value: 4 } } }],
    ['your life total is 5 or less', { cond: 'compare', left: { q: 'life', of: you }, op: '<=', right: 5 }],
    ['you gained life this turn', { cond: 'happened', event: { ev: 'life', change: 'gain', player: 'you' }, scope: 'turn' }],
    ["you've cast two or more spells this turn", { cond: 'happened', event: { ev: 'cast', player: 'you' }, scope: 'turn', times: { op: '>=', value: 2 } }],
    ['a creature died this turn', { cond: 'happened', event: { ev: 'zoneChange', subject: creature, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }],
    ['you attacked this turn', { cond: 'happened', event: { ev: 'attacks', attacker: { controller: 'you' } }, scope: 'turn' }],
    ["you're the monarch", { cond: 'designation', who: you, what: 'monarch' }],
  ])('"%s"', (phrase, expected) => {
    expect(one('Cond', phrase)).toEqual(expected);
  });

  it('chains of "and" or of "or" become all / any; a mixed chain has no parse', () => {
    expect(one('Cond', 'you control a creature and an opponent controls a creature')).toEqual({
      cond: 'all', of: [exists({ ...creature, controller: 'you' }), exists({ ...creature, controller: 'opponent' })],
    });
    expect(one('Cond', 'you control a Forest or you control an Island')).toMatchObject({ cond: 'any' });
    expect(rejects('Cond', 'you control a Forest and you control an Island or you control a Swamp')).toBe(true);
  });

  it('a bare number is never "at least": "you control three creatures" does not parse', () => {
    expect(rejects('Cond', 'you control three creatures')).toBe(true);
  });

  it('G2: unknown words fail', () => {
    for (const bad of ['you control a zzz', 'it is zzz', 'zzz', 'you control no']) expect(rejects('Cond', bad), bad).toBe(true);
  });
});

describe('WP6 Dur (CR 514.2, 611.2, 610.3)', () => {
  it.each([
    ['until end of turn', { d: 'endOfTurn' }],
    ['until the end of the turn', { d: 'endOfTurn' }],
    ['this turn', { d: 'endOfTurn' }],
    ['until end of combat', { d: 'endOfCombat' }],
    ['this combat', { d: 'endOfCombat' }],
    ['until your next turn', { d: 'untilNextTurn', whose: you }],
    ['until your next upkeep', { d: 'untilNextStep', step: 'upkeep', whose: 'you' }],
    ['for as long as ~ remains on the battlefield', { d: 'whileSource', as: 'onBattlefield' }],
    ['for as long as you control ~', { d: 'whileSource', as: 'controlled' }],
    ['for as long as ~ is attached to it', { d: 'whileSource', as: 'attached' }],
    ['for as long as ~ remains tapped', { d: 'whileSource', as: 'tapped' }],
    ['for as long as you control a Forest', { d: 'asLongAs', cond: exists({ subtypes: ['Forest'], controller: 'you' }) }],
    ['until ~ leaves the battlefield', { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } }],
    ['for the rest of the game', { d: 'permanent' }],
  ])('"%s"', (phrase, expected) => {
    expect(one('Dur', phrase)).toEqual(expected);
  });
  it('"until end of combat" is one reading (the step event is not a second one)', () => {
    expect(full('Dur', 'until end of combat')).toHaveLength(1);
  });
  it('an unknown word fails', () => {
    expect(rejects('Dur', 'until zzz')).toBe(true);
    expect(rejects('Dur', 'for as long as zzz')).toBe(true);
  });
});

describe('WP6 Event: the event shapes of model section 3.5 (CR 603.2, 603.6, 700.4)', () => {
  const sub = (f: unknown): unknown => f;
  void sub;
  it.each([
    // step
    ['the beginning of your upkeep', [{ ev: 'step', step: 'upkeep', whose: 'you' }]],
    ['the beginning of each upkeep', [{ ev: 'step', step: 'upkeep' }]],
    ["the beginning of each player's upkeep", [{ ev: 'step', step: 'upkeep' }]],
    ["the beginning of each opponent's upkeep", [{ ev: 'step', step: 'upkeep', whose: 'opponent' }]],
    ['the beginning of your end step', [{ ev: 'step', step: 'end', whose: 'you' }]],
    ['the beginning of combat on your turn', [{ ev: 'step', step: 'beginCombat', whose: 'you' }]],
    ['the beginning of your first main phase', [{ ev: 'step', step: 'main1', whose: 'you' }]],
    ['the beginning of the end step', [{ ev: 'step', step: 'end' }]],
    ['end of combat', [{ ev: 'step', step: 'endCombat' }]],
    // zone changes
    ['~ enters', [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }]],
    ['~ enters the battlefield', [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }]],
    ['a creature enters', [{ ev: 'zoneChange', subject: creature, to: 'battlefield' }]],
    ['another creature you control enters', [{ ev: 'zoneChange', subject: { ...creature, controller: 'you', other: true }, to: 'battlefield' }]],
    ['~ dies', [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }]],
    ['a creature you control dies', [{ ev: 'zoneChange', subject: { ...creature, controller: 'you' }, from: 'battlefield', to: 'graveyard' }]],
    ['another creature dies', [{ ev: 'zoneChange', subject: { ...creature, other: true }, from: 'battlefield', to: 'graveyard' }]],
    ['~ leaves the battlefield', [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }]],
    ['~ is put into a graveyard from the battlefield', [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }]],
    ['~ is exiled', [{ ev: 'zoneChange', subject: { self: true }, to: 'exile' }]],
    ['~ enters the battlefield under your control', [{ ev: 'zoneChange', subject: { self: true, controller: 'you' }, to: 'battlefield' }]],
    ['enchanted creature dies', [{ ev: 'zoneChange', subject: { ...creature, attachedToSource: true }, from: 'battlefield', to: 'graveyard' }]],
    // coordinated subjects and predicates
    ['~ or another creature you control enters', [
      { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
      { ev: 'zoneChange', subject: { ...creature, controller: 'you', other: true }, to: 'battlefield' },
    ]],
    ['~ enters or attacks', [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, { ev: 'attacks', attacker: { self: true } }]],
    // combat
    ['~ attacks', [{ ev: 'attacks', attacker: { self: true } }]],
    ['a creature you control attacks', [{ ev: 'attacks', attacker: { ...creature, controller: 'you' } }]],
    ['~ attacks alone', [{ ev: 'attacks', attacker: { self: true }, alone: true }]],
    ['~ attacks or blocks', [{ ev: 'attacks', attacker: { self: true } }, { ev: 'blocks', blocker: { self: true } }]],
    ['equipped creature attacks', [{ ev: 'attacks', attacker: { ...creature, attachedToSource: true } }]],
    ['~ blocks', [{ ev: 'blocks', blocker: { self: true } }]],
    ['~ blocks a creature', [{ ev: 'blocks', blocker: { self: true }, attacker: creature }]],
    ['~ becomes blocked', [{ ev: 'becomesBlocked', attacker: { self: true } }]],
    ['~ becomes blocked by a creature', [{ ev: 'becomesBlocked', attacker: { self: true }, by: creature }]],
    ['you attack', [{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 } }]],
    ['you attack with two or more creatures', [{ ev: 'attacks', attacker: { ...creature, controller: 'you' }, count: { op: '>=', value: 2 } }]],
    // damage
    ['~ deals combat damage to a player', [{ ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }]],
    ['~ deals damage', [{ ev: 'damage', source: { self: true } }]],
    ['a creature you control deals combat damage to a player', [{ ev: 'damage', source: { ...creature, controller: 'you' }, combat: true, recipient: { player: 'any' } }]],
    ['~ is dealt damage', [{ ev: 'damage', recipient: { object: { self: true } } }]],
    // becomes
    ['~ becomes tapped', [{ ev: 'becomes', what: 'tapped', object: { self: true } }]],
    ['~ is turned face up', [{ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } }]],
    ['~ transforms', [{ ev: 'becomes', what: 'transformed', object: { self: true } }]],
    ['~ becomes the target of a spell', [{ ev: 'becomes', what: 'targeted', object: { self: true }, by: { stackKind: 'spell' } }]],
    // players
    ['you cast a creature spell', [{ ev: 'cast', player: 'you', spell: creature }]],
    ['you cast a spell', [{ ev: 'cast', player: 'you' }]],
    ['you cast a noncreature spell', [{ ev: 'cast', player: 'you', spell: { notTypes: ['Creature'] } }]],
    ['you cast ~', [{ ev: 'cast', player: 'you', spell: { self: true } }]],
    ['a player casts a spell', [{ ev: 'cast', player: 'any' }]],
    ['an opponent casts a spell', [{ ev: 'cast', player: 'opponent' }]],
    ['you cast or copy a creature spell', [{ ev: 'cast', player: 'you', spell: creature, orCopy: true }]],
    ['you cast a spell that targets ~', [{ ev: 'cast', player: 'you', spell: { targets: { ref: 'self' } } }]],
    ['you draw a card', [{ ev: 'draw', player: 'you' }]],
    ['you draw your second card each turn', [{ ev: 'draw', player: 'you', nth: 2 }]],
    ['you gain life', [{ ev: 'life', change: 'gain', player: 'you' }]],
    ['an opponent loses life', [{ ev: 'life', change: 'loss', player: 'opponent' }]],
    ['you sacrifice a creature', [{ ev: 'action', verb: 'sacrifice', actor: 'you', object: creature }]],
    ['you discard a card', [{ ev: 'action', verb: 'discard', actor: 'you', object: { isCard: true } }]],
    ['you cycle ~', [{ ev: 'action', verb: 'cycle', actor: 'you', object: { self: true } }]],
    ['you play a land', [{ ev: 'action', verb: 'playLand', actor: 'you' }]],
    ['you roll a die', [{ ev: 'dieRoll', player: 'you' }]],
    // counters and state
    ['a +1/+1 counter is put on ~', [{ ev: 'counters', change: 'put', kind: '+1/+1', on: { self: true } }]],
    ['you control no Islands', [{ ev: 'state', cond: { cond: 'not', of: exists({ subtypes: ['Island'], controller: 'you' }) } }]],
  ])('"%s"', (phrase, expected) => {
    expect(one('Event', phrase)).toEqual(expected);
  });

  it('CR 603.2c: "one or more" subjects and "you attack" set the batch flag; the template puts batch:true on the trigger', () => {
    for (const phrase of ['one or more creatures you control deal combat damage to a player', 'you attack', 'you create one or more tokens']) {
      const alts = full('Event', phrase);
      expect(alts).toHaveLength(1);
      expect(alts[0]!.flags, phrase).toContain('batch');
    }
    expect(full('Event', '~ attacks')[0]!.flags ?? []).not.toContain('batch');
  });

  it('every prefix is offered: the trigger template can take the event and leave the comma and the effect to itself', () => {
    const t = toks('~ dies, draw a card');
    expect(runHole('Event', t, 0, ENV).map((a) => a.end)).toEqual([2]);
  });

  it('G2: unknown words and unsupported shapes fail (nothing is guessed)', () => {
    for (const bad of ['~ zzz', 'a zzz dies', '~ attacks and is not blocked', 'the beginning of zzz', 'you zzz a card']) expect(rejects('Event', bad), bad).toBe(true);
  });
});
