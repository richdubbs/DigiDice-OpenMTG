/**
 * WP8: `matchEvent`, the one matcher (design 3.5): every event kind, every field of its pattern, with the cases that must NOT match next to the ones that must.
 * `lookBackKinds` (CR 603.10): decided from the pattern.
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern, GameEvent, ObjectId, SemEvent } from '../../../src/index';
import { moveObject } from '../../../src/core/zones';
import { addCounters } from '../../../src/rules/counters';
import { dealDamage } from '../../../src/rules/damage';
import { lookBackApplies, lookBackKinds } from '../../../src/triggers/lookback';
import { EVENT_MATCHERS, matchEvent } from '../../../src/triggers/match';
import { vanilla } from './cards';
import { batchesOf, find, gameOf, scenario } from './helpers';

const s0 = scenario(['Plains'], {
  defs: [vanilla(), vanilla('Test Other', ['3', '3'])],
  p1: { battlefield: ['Test Vanilla', 'Plains'], hand: ['Test Other'] },
  p2: { battlefield: ['Test Other'] },
});
const mine = find(s0, 'Test Vanilla', 'battlefield');
const theirs = find(s0, 'Test Other', 'battlefield', 'p2');
const land = find(s0, 'Plains', 'battlefield');

/** Does the pattern match any event the engine events produce, for an ability on `source` controlled by `controller`? */
function matches(p: EventPattern, events: GameEvent[], opts: { source?: ObjectId; controller?: string; setup?: (g: ReturnType<typeof gameOf>) => void } = {}): boolean {
  const g = gameOf(s0);
  opts.setup?.(g);
  for (const e of events) g.emit(e);
  const sems: SemEvent[] = batchesOf(g).flat();
  return sems.some((e) => matchEvent(p, e, { g, source: opts.source ?? mine, controller: opts.controller ?? 'p1', lookBack: false }));
}

describe('zoneChange (CR 603.6, 700.4)', () => {
  const dies = (p: Partial<Extract<EventPattern, { ev: 'zoneChange' }>> = {}): EventPattern => ({ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard', ...p });
  const kill = (id: ObjectId) => (g: ReturnType<typeof gameOf>) => { moveObject(g, id, 'graveyard'); };

  it('from and to, single or list; "from" excludes a creation, an absent "from" does not', () => {
    expect(matches(dies(), [], { setup: kill(mine) })).toBe(true);
    expect(matches(dies({ from: ['hand', 'battlefield'] }), [], { setup: kill(mine) })).toBe(true);
    expect(matches(dies({ from: 'hand' }), [], { setup: kill(mine) })).toBe(false);
    expect(matches(dies({ to: 'exile' }), [], { setup: kill(mine) })).toBe(false);
    expect(matches({ ev: 'zoneChange', subject: {}, to: 'battlefield' }, [], { setup: (g) => { moveObject(g, find(s0, 'Test Other', 'hand', 'p1'), 'battlefield'); } })).toBe(true);
  });

  it('the subject filter is judged as the creature was (look back): controller, types, self and other', () => {
    expect(matches(dies({ subject: { types: ['Creature'], controller: 'you' } }), [], { setup: kill(mine) })).toBe(true);
    expect(matches(dies({ subject: { types: ['Creature'], controller: 'opponent' } }), [], { setup: kill(mine) })).toBe(false);
    expect(matches(dies({ subject: { types: ['Land'] } }), [], { setup: kill(mine) })).toBe(false);
    expect(matches(dies({ subject: { self: true } }), [], { setup: kill(mine) })).toBe(true); // the watcher is the creature that died
    expect(matches(dies({ subject: { self: true } }), [], { source: theirs, setup: kill(mine) })).toBe(false);
    expect(matches(dies({ subject: { types: ['Creature'], other: true } }), [], { setup: kill(mine) })).toBe(false);
    expect(matches(dies({ subject: { types: ['Creature'], other: true } }), [], { source: theirs, setup: kill(mine) })).toBe(true);
    expect(matches(dies({ subject: { anyOf: [{ types: ['Land'] }, { types: ['Creature'] }] } }), [], { setup: kill(mine) })).toBe(true);
    expect(matches(dies({ subject: { not: { types: ['Creature'] } } }), [], { setup: kill(mine) })).toBe(false);
  });

  it('WP30: the reference forms of a filter are read like the interpreter reads them (they used to never match); what cannot be read still never matches', () => {
    // `is: self` is the creature that died when it is the source itself (as `self: true` is), and not when the source is another creature.
    expect(matches(dies({ subject: { is: { ref: 'self' } } }), [], { setup: kill(mine) })).toBe(true);
    expect(matches(dies({ subject: { is: { ref: 'self' } } }), [], { source: theirs, setup: kill(mine) })).toBe(false);
    // The test creatures are colorless: none shares a color with the source (CR 105.2c).
    expect(matches(dies({ subject: { sharesWith: { with: { ref: 'self' }, quality: 'color' } } }), [], { setup: kill(mine) })).toBe(false);
    // A name bound only while an effect resolves cannot be read when an event is matched: no match, never a wrong trigger.
    expect(matches(dies({ subject: { is: { ref: 'bound', name: 'it' } } }), [], { setup: kill(mine) })).toBe(false);
  });
});

describe('cast, activate (CR 601.2i, 602.2, 707.10)', () => {
  const castEv = (id: string, player = 'p1'): GameEvent => ({ type: 'spellCast', objectId: id, player });
  it('player and spell filter; a copy is not cast unless the pattern says so', () => {
    const spell = find(s0, 'Test Other', 'hand', 'p1');
    const setup = (g: ReturnType<typeof gameOf>) => { moveObject(g, spell, 'stack', { cause: 'cast' }); };
    const stackId = (g: ReturnType<typeof gameOf>): ObjectId => g.s.zones.stack[0]!;
    const run = (p: EventPattern, copy = false): boolean => {
      const g = gameOf(s0);
      setup(g);
      g.emit(copy ? { type: 'spellCopied', objectId: stackId(g), copyOf: stackId(g) } : castEv(stackId(g)));
      return batchesOf(g).flat().filter((e) => e.ev === 'cast').some((e) => matchEvent(p, e, { g, source: mine, controller: 'p1', lookBack: false }));
    };
    expect(run({ ev: 'cast', player: 'you' })).toBe(true);
    expect(run({ ev: 'cast', player: 'opponent' })).toBe(false);
    expect(run({ ev: 'cast', player: 'any', spell: { types: ['Creature'] } })).toBe(true);
    expect(run({ ev: 'cast', player: 'any', spell: { types: ['Instant'] } })).toBe(false);
    expect(run({ ev: 'cast', player: 'any', spell: { stackKind: 'spell' } })).toBe(true);
    expect(run({ ev: 'cast', player: 'any', from: 'hand' })).toBe(false); // castFrom is recorded by the cast action; this synthetic cast has none
    expect(run({ ev: 'cast' }, true)).toBe(false);
    expect(run({ ev: 'cast', orCopy: true }, true)).toBe(true);
  });

  it('an activated ability: the source filter; a mana ability (CR 605.3b) is seen only by a pattern that says manaAbility', () => {
    const act: GameEvent = { type: 'abilityActivated', objectId: 'o900', sourceId: land, player: 'p1' };
    expect(matches({ ev: 'activate', player: 'you', source: { types: ['Land'] } }, [act])).toBe(true);
    expect(matches({ ev: 'activate', source: { types: ['Creature'] } }, [act])).toBe(false);
    const mana: GameEvent = { type: 'manaAdded', player: 'p1', mana: ['G'], sourceId: land, viaActivation: true };
    expect(matches({ ev: 'activate', player: 'you', source: { types: ['Land'] }, manaAbility: true }, [mana])).toBe(true);
    expect(matches({ ev: 'activate', player: 'you', source: { types: ['Land'] } }, [mana])).toBe(false);
    expect(matches({ ev: 'activate', player: 'opponent', manaAbility: true }, [mana])).toBe(false);
    expect(matches({ ev: 'activate', manaAbility: true }, [{ type: 'manaAdded', player: 'p1', mana: ['G'] }])).toBe(false); // mana added by an effect, with no source, is no activation
    expect(matches({ ev: 'activate', manaAbility: true }, [{ type: 'manaAdded', player: 'p1', mana: ['G'], sourceId: land }])).toBe(false); // CR 605.1b, 106.3: mana with a source but not from an activation (a triggered mana ability, a spell) is no activation either
  });
});

describe('combat (CR 506-510)', () => {
  const attack = (...a: ObjectId[]): GameEvent => ({ type: 'attackersDeclared', attackers: a.map((x) => ({ attacker: x, defender: 'p2' })) });
  it('attacks: the attacker, alone, how many, and who is attacked', () => {
    expect(matches({ ev: 'attacks', attacker: { self: true } }, [attack(mine)])).toBe(true);
    expect(matches({ ev: 'attacks', attacker: { self: true } }, [attack(theirs)])).toBe(false);
    expect(matches({ ev: 'attacks', alone: true }, [attack(mine)])).toBe(true);
    expect(matches({ ev: 'attacks', alone: true }, [attack(mine, land)])).toBe(false);
    expect(matches({ ev: 'attacks', count: { op: '>=', value: 2 } }, [attack(mine, land)])).toBe(true);
    expect(matches({ ev: 'attacks', count: { op: '>=', value: 2 } }, [attack(mine)])).toBe(false);
    expect(matches({ ev: 'attacks', defender: 'opponent' }, [attack(mine)])).toBe(true);
    expect(matches({ ev: 'attacks', defender: 'you' }, [attack(mine)])).toBe(false);
    expect(matches({ ev: 'attacks', defender: 'planeswalker' }, [attack(mine)])).toBe(false);
  });

  it('blocks / becomes blocked: once per attacker unless "by" asks for the blocker', () => {
    const block: GameEvent = { type: 'blockersDeclared', blocks: [{ blocker: theirs, attacker: mine }, { blocker: land, attacker: mine }] };
    expect(matches({ ev: 'blocks', blocker: { controller: 'opponent' } }, [block])).toBe(true);
    expect(matches({ ev: 'blocks', attacker: { self: true } }, [block])).toBe(true);
    expect(matches({ ev: 'blocks', attacker: { types: ['Land'] } }, [block])).toBe(false);
    expect(matches({ ev: 'becomesBlocked', attacker: { self: true } }, [block])).toBe(true);
    expect(matches({ ev: 'becomesBlocked', attacker: { self: true }, by: { types: ['Creature'] } }, [block])).toBe(true);
    expect(matches({ ev: 'becomesBlocked', attacker: { self: true }, by: { types: ['Artifact'] } }, [block])).toBe(false);
  });

  it('damage: source, recipient (an object or a player), combat, amount', () => {
    const toPlayer = (g: ReturnType<typeof gameOf>) => { dealDamage(g, mine, 'p2', 2, { combat: true }); };
    const toCreature = (g: ReturnType<typeof gameOf>) => { dealDamage(g, mine, theirs, 1); };
    expect(matches({ ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'opponent' } }, [], { setup: toPlayer })).toBe(true);
    expect(matches({ ev: 'damage', source: { self: true }, combat: false }, [], { setup: toPlayer })).toBe(false);
    expect(matches({ ev: 'damage', recipient: { object: { types: ['Creature'] } } }, [], { setup: toPlayer })).toBe(false);
    expect(matches({ ev: 'damage', recipient: { object: { types: ['Creature'] } } }, [], { setup: toCreature })).toBe(true);
    expect(matches({ ev: 'damage', recipient: { player: 'any' } }, [], { setup: toCreature })).toBe(false);
    expect(matches({ ev: 'damage', amount: { op: '>=', value: 2 } }, [], { setup: toPlayer })).toBe(true);
    expect(matches({ ev: 'damage', amount: { op: '>=', value: 2 } }, [], { setup: toCreature })).toBe(false);
    expect(matches({ ev: 'damage', source: { controller: 'opponent' } }, [], { setup: toPlayer })).toBe(false);
  });
});

describe('turn structure, life, cards', () => {
  it('a step beginning: which step and whose (CR 603.2b)', () => {
    const up: GameEvent = { type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' };
    expect(matches({ ev: 'step', step: 'upkeep', whose: 'you' }, [up])).toBe(true);
    expect(matches({ ev: 'step', step: 'upkeep', whose: 'opponent' }, [up])).toBe(false);
    expect(matches({ ev: 'step', step: 'end' }, [up])).toBe(false);
    expect(matches({ ev: 'step', step: 'upkeep' }, [{ ...up, activePlayer: 'p2' }])).toBe(true);
    expect(matches({ ev: 'beginTurn', whose: 'you' }, [{ type: 'turnBegan', turn: 3, activePlayer: 'p1' }])).toBe(true);
    expect(matches({ ev: 'beginTurn', extra: true }, [{ type: 'turnBegan', turn: 3, activePlayer: 'p1' }])).toBe(false); // extra turns are not recorded yet
  });

  it('life gained or lost, with an amount', () => {
    const gain: GameEvent = { type: 'lifeChanged', player: 'p2', delta: 3, life: 23 };
    expect(matches({ ev: 'life', change: 'gain', player: 'opponent' }, [gain])).toBe(true);
    expect(matches({ ev: 'life', change: 'loss' }, [gain])).toBe(false);
    expect(matches({ ev: 'life', change: 'gain', amount: { op: '>=', value: 4 } }, [gain])).toBe(false);
    expect(matches({ ev: 'life', change: 'loss', player: 'you' }, [{ type: 'lifeChanged', player: 'p1', delta: -2, life: 18 }])).toBe(true);
  });

  it('drawing: whose card, and which one of the turn', () => {
    const draw = (n: number): GameEvent[] => Array.from({ length: n }, () => ({ type: 'drew', player: 'p1', objectId: 'o1' }) as GameEvent);
    const bump = (n: number) => (g: ReturnType<typeof gameOf>) => { g.player('p1').turnStats.cardsDrawn = n; };
    expect(matches({ ev: 'draw', player: 'you' }, draw(1), { setup: bump(1) })).toBe(true);
    expect(matches({ ev: 'draw', player: 'opponent' }, draw(1), { setup: bump(1) })).toBe(false);
    expect(matches({ ev: 'draw', nth: 2 }, draw(2), { setup: bump(2) })).toBe(true);
    expect(matches({ ev: 'draw', nth: 3 }, draw(2), { setup: bump(2) })).toBe(false);
  });
});

describe('becomes, counters, actions, tokens, dice, resolution', () => {
  it('becomes tapped / untapped / attached / unattached / transformed (CR 603.2e)', () => {
    expect(matches({ ev: 'becomes', what: 'tapped', object: { types: ['Land'] } }, [{ type: 'tapped', objectId: land }])).toBe(true);
    expect(matches({ ev: 'becomes', what: 'tapped', object: { types: ['Creature'] } }, [{ type: 'tapped', objectId: land }])).toBe(false);
    expect(matches({ ev: 'becomes', what: 'untapped', object: {} }, [{ type: 'tapped', objectId: land }])).toBe(false);
    expect(matches({ ev: 'becomes', what: 'attached', object: {} }, [{ type: 'attached', objectId: land, to: mine }])).toBe(true);
    expect(matches({ ev: 'becomes', what: 'unattached', object: {} }, [{ type: 'attached', objectId: land, to: null }])).toBe(true);
    expect(matches({ ev: 'becomes', what: 'transformed', object: { self: true } }, [{ type: 'transformed', objectId: mine }])).toBe(true);
    expect(matches({ ev: 'becomes', what: 'monstrous', object: {} }, [{ type: 'tapped', objectId: mine }])).toBe(false);
    expect(matches({ ev: 'becomes', what: 'monstrous', object: { self: true } }, [{ type: 'actionPerformed', verb: 'monstrosity', actor: 'p1', objectId: mine }])).toBe(true);
    expect(matches({ ev: 'becomes', what: 'renowned', object: { self: true } }, [{ type: 'actionPerformed', verb: 'monstrosity', actor: 'p1', objectId: mine }])).toBe(false);
  });

  it('becomes the target of a spell or ability: the object and what targets it', () => {
    const target: GameEvent = { type: 'becameTarget', objectId: mine, byStackId: 'o900', byController: 'p2' };
    expect(matches({ ev: 'becomes', what: 'targeted', object: { self: true } }, [target])).toBe(true);
    expect(matches({ ev: 'becomes', what: 'targeted', object: { types: ['Land'] } }, [target])).toBe(false);
    expect(matches({ ev: 'becomes', what: 'targeted', object: { self: true } }, [{ ...target, objectId: 'p1' }])).toBe(false); // a player is not an object
  });

  it('counters put or removed: the kind, the object or player, the Nth counter', () => {
    const put = (n: number, kind = '+1/+1') => (g: ReturnType<typeof gameOf>) => { addCounters(g, mine, kind, n); };
    expect(matches({ ev: 'counters', change: 'put', on: { self: true } }, [], { setup: put(1) })).toBe(true);
    expect(matches({ ev: 'counters', change: 'removed', on: { self: true } }, [], { setup: put(1) })).toBe(false);
    expect(matches({ ev: 'counters', change: 'put', kind: 'lore', on: { self: true } }, [], { setup: put(1) })).toBe(false);
    expect(matches({ ev: 'counters', change: 'put', on: { self: true }, atLeast: 3 }, [], { setup: put(3) })).toBe(true);
    expect(matches({ ev: 'counters', change: 'put', on: { self: true }, atLeast: 3 }, [], { setup: (g) => { put(2)(g); } })).toBe(false);
    expect(matches({ ev: 'counters', change: 'put', on: { self: true }, atLeast: 3 }, [], { setup: (g) => { put(3)(g); put(1)(g); } })).toBe(true); // crossed 3 once
    expect(matches({ ev: 'counters', change: 'put', on: { player: 'any' } }, [{ type: 'countersChanged', target: 'p2', counter: 'poison', delta: 1 }])).toBe(true);
    expect(matches({ ev: 'counters', change: 'put', on: { types: ['Creature'] } }, [{ type: 'countersChanged', target: 'p2', counter: 'poison', delta: 1 }])).toBe(false);
  });

  it('actions: the verb, who did it, and what it was done to (judged as it was for a sacrifice)', () => {
    const sac = (g: ReturnType<typeof gameOf>) => { moveObject(g, mine, 'graveyard', { cause: 'sacrifice' }); };
    expect(matches({ ev: 'action', verb: 'sacrifice', actor: 'you', object: { types: ['Creature'] } }, [], { setup: sac })).toBe(true);
    expect(matches({ ev: 'action', verb: 'sacrifice', actor: 'opponent' }, [], { setup: sac })).toBe(false);
    expect(matches({ ev: 'action', verb: 'discard' }, [], { setup: sac })).toBe(false);
    expect(matches({ ev: 'action', verb: 'scry', actor: 'you' }, [{ type: 'actionPerformed', verb: 'scry', actor: 'p1' }])).toBe(true);
    expect(matches({ ev: 'action', verb: 'playLand' }, [{ type: 'landPlayed', objectId: land, player: 'p1' }])).toBe(true);
  });

  it('tokens created, dice rolled, a spell or ability resolving', () => {
    expect(matches({ ev: 'createToken', player: 'you' }, [{ type: 'tokenCreated', player: 'p1', objectId: mine }])).toBe(true);
    expect(matches({ ev: 'createToken', player: 'opponent' }, [{ type: 'tokenCreated', player: 'p1', objectId: mine }])).toBe(false);
    expect(matches({ ev: 'dieRoll', result: { op: '>=', value: 5 } }, [{ type: 'dieRolled', player: 'p1', sides: 6, result: 5 }])).toBe(true);
    expect(matches({ ev: 'dieRoll', result: { op: '>=', value: 5 } }, [{ type: 'dieRolled', player: 'p1', sides: 6, result: 4 }])).toBe(false);
    expect(matches({ ev: 'resolves', what: {} }, [{ type: 'resolved', objectId: mine }])).toBe(true);
  });

  it('a state trigger is not an event: no event ever matches it (CR 603.8)', () => {
    expect(matches({ ev: 'state', cond: { cond: 'turnOf', whose: 'you' } }, [{ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' }])).toBe(false);
  });

  it('every kind the model has and the engine can emit is registered as a capability, and only those (`dieRoll` since the rollDie handler of WP15 emits `dieRolled`, see capabilities.test.ts)', () => {
    expect(Object.keys(EVENT_MATCHERS).sort()).toEqual(
      // M6-4: `dayNight` (core/designations.ts emits it, triggers/forms-dfc.ts#EMITS)
      ['action', 'attacks', 'attacksUnblocked' /* std-rx35 (CR 509.1h) */, 'activate', 'becomes', 'becomesBlocked', 'beginTurn', 'blocks', 'cast', 'coinFlip' /* cloud r3-mech (CR 705.2) */, 'counters', 'createToken', 'damage', 'dayNight', 'dieRoll', 'draw', 'life', 'loseGame' /* M12-3 (CR 603.9) */, 'controlChange' /* Standard round 3, r3-trig (CR 108.4) */, 'resolves', 'state', 'step', 'zoneChange', 'abilityTriggered' /* std-copy-6 (CR 603.2): triggers/collect.ts#metaEvents */].sort(),
    );
  });
});

describe('CR 603.10: lookBackKinds is decided from the pattern', () => {
  const k = (p: EventPattern) => lookBackKinds(p);
  it('leaves the battlefield, dies, is put into a graveyard from the battlefield: look back (603.10a, 603.6c)', () => {
    expect(k({ ev: 'zoneChange', subject: {}, from: 'battlefield' })).toContain('leavesBattlefield');
    expect(k({ ev: 'zoneChange', subject: {}, from: 'battlefield', to: 'graveyard' })).toContain('leavesBattlefield');
    expect(k({ ev: 'zoneChange', subject: {}, from: ['battlefield', 'hand'], to: 'graveyard' })).toContain('leavesBattlefield');
  });
  it('CR 603.6c: "is put into a graveyard from anywhere" is never a leaves-the-battlefield ability, so it does not look back', () => {
    expect(k({ ev: 'zoneChange', subject: {}, to: 'graveyard' })).toEqual([]);
    expect(k({ ev: 'zoneChange', subject: {}, to: 'exile' })).toEqual([]);
    expect(k({ ev: 'zoneChange', subject: {} })).not.toContain('leavesBattlefield');
    expect(k({ ev: 'zoneChange', subject: {} })).not.toContain('leavesGraveyard');
  });
  it('enters the battlefield does not look back', () => {
    expect(k({ ev: 'zoneChange', subject: {}, to: 'battlefield' })).toEqual([]);
    expect(k({ ev: 'zoneChange', subject: {}, from: 'hand', to: 'graveyard' })).toEqual([]);
  });
  it('leaves a graveyard, goes to a hand or library, is sacrificed, becomes unattached, is countered', () => {
    expect(k({ ev: 'zoneChange', subject: {}, from: 'graveyard' })).toContain('leavesGraveyard');
    expect(k({ ev: 'zoneChange', subject: {}, from: 'exile', to: 'hand' })).toEqual(['visibleToHandOrLibrary']);
    expect(k({ ev: 'zoneChange', subject: {}, to: 'library' })).toContain('visibleToHandOrLibrary');
    expect(k({ ev: 'action', verb: 'sacrifice' })).toEqual(['sacrifice']);
    expect(k({ ev: 'action', verb: 'counter' })).toEqual(['spellCountered']);
    expect(k({ ev: 'becomes', what: 'unattached', object: {} })).toEqual(['unattach']);
  });
  it('nothing else looks back', () => {
    expect(k({ ev: 'cast' })).toEqual([]);
    expect(k({ ev: 'damage' })).toEqual([]);
    expect(k({ ev: 'step', step: 'end' })).toEqual([]);
    expect(k({ ev: 'action', verb: 'discard' })).toEqual([]);
  });
  it('the event decides which leaving it was: a creature that went from hand to graveyard did not look back', () => {
    const g = gameOf(s0);
    moveObject(g, find(s0, 'Test Other', 'hand', 'p1'), 'graveyard', { cause: 'discard' });
    const e = batchesOf(g).flat().find((x) => x.ev === 'zoneChange')!;
    expect(lookBackApplies({ ev: 'zoneChange', subject: {}, from: ['hand', 'battlefield'], to: 'graveyard' }, e)).toBe(false);
    const h = gameOf(s0);
    moveObject(h, mine, 'graveyard');
    const fromBattlefield = batchesOf(h).flat().find((x) => x.ev === 'zoneChange')!;
    expect(lookBackApplies({ ev: 'zoneChange', subject: {}, from: ['hand', 'battlefield'], to: 'graveyard' }, fromBattlefield)).toBe(true);
    expect(lookBackApplies({ ev: 'zoneChange', subject: {}, to: 'graveyard' }, fromBattlefield)).toBe(false); // CR 603.6c: "from anywhere" never looks back
  });
});
