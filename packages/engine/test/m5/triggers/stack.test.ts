/**
 * WP8: triggered abilities go on the stack (CR 603.3): APNAP order (603.3b), modes (603.3c), targets (603.3d), the Fiend Hunter race, Blood Artist (603.10a),
 * Rancor (400.7e). Built through the real engine: cards on the battlefield, real actions, real decisions.
 */
import { describe, expect, it } from 'vitest';
import { type GameState } from '../../../src/index';
import { attackTrigger, castWatcher, damageTrigger, bloodArtist, fiendHunter, flametongue, modalTrigger, modalCreatureOnly, artifactHater, rancor, soulWarden, upkeepGainer, vanilla, watcherOf, trig } from './cards';
import { triggerNow } from '../../../src/triggers/stack';
import { act, answer, castAuto, declareAttackers, decisionOf, find, gameOf, move, passBoth, pass, passTo, reject, runCombat, scenario, settle, stackAbilities, toDeclareAttackers, tweak } from './helpers';
import { synth } from '../helpers';

const defs = [
  bloodArtist(), flametongue(), fiendHunter(), rancor(), soulWarden(), soulWarden('Test Soul Warden B'), vanilla(), vanilla('Test Big', ['4', '4']), modalTrigger(), modalCreatureOnly(),
  artifactHater(), upkeepGainer(), attackTrigger(), damageTrigger(), castWatcher(), watcherOf('Test Watcher B', [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }]),
  synth({ name: 'Test Trinket', cost: '{1}', type: 'Artifact', abilities: [] }),
];

/** Make an object die of lethal damage at the next state-based action check. */
const lethal = (s: GameState, id: string): GameState => tweak(s, (t) => { t.objects[id]!.damage = 99; });

describe('CR 603.10a: Blood Artist dies at the same time as another creature (look back in time)', () => {
  const start = scenario(['Plains'], { defs, p1: { battlefield: ['Test Blood Artist'] }, p2: { battlefield: ['Test Vanilla'] } });

  it('triggers once for itself (its own death, seen as it was) and once for the other creature', () => {
    let s = start;
    s = lethal(lethal(s, find(s, 'Test Blood Artist', 'battlefield')), find(s, 'Test Vanilla', 'battlefield'));
    s = pass(s); // p1 passes; state-based actions kill both creatures before p2 would receive priority
    // Two triggers of the same player with different events: p1 puts them on the stack in the order they choose (CR 603.3b).
    expect(s.pending!.kind).toBe('order');
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'order', ids: (s.pending as Extract<typeof s.pending, { kind: 'order' }>).items.map((i) => i.id) });
    for (let i = 0; i < 2; i++) {
      expect(s.pending!.kind).toBe('chooseTargets'); // "target player", chosen as the ability is put on the stack (CR 603.3d)
      s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    }
    expect(s.pending!.kind).toBe('priority');
    const onStack = stackAbilities(s);
    expect(onStack).toHaveLength(2);
    expect(onStack.every((a) => a.source === 'Test Blood Artist' && a.controller === 'p1')).toBe(true);
    expect(s.pendingTriggers).toEqual([]);
    // the two events: Blood Artist's own death and the other creature's, both as the creatures last were
    const subjects = onStack.map((a) => s.objects[a.id]!.stack!.event!.roles.subject);
    expect(new Set(subjects.map((r) => JSON.stringify(r))).size).toBe(2);
  });

  it('the state before the creatures died is what the ability looks at: a creature that left alone does not trigger the Artist twice', () => {
    let s = start;
    s = lethal(s, find(s, 'Test Vanilla', 'battlefield'));
    s = pass(s);
    expect(s.pending!.kind).toBe('chooseTargets'); // one trigger only: no order to choose
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(stackAbilities(s)).toHaveLength(1);
  });
});

describe('CR 603.3b: triggers go on the stack in APNAP order', () => {
  const start = (): GameState => scenario(['Plains'], {
    defs,
    p1: { battlefield: ['Test Soul Warden'], hand: ['Test Vanilla'] },
    p2: { battlefield: ['Test Soul Warden B'] },
  });
  const enter = (s: GameState): ReturnType<typeof gameOf> => {
    const g = gameOf(s);
    move(g, find(s, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    return g;
  };

  it('the active player puts theirs on first, so the non-active player\'s ability is on top and resolves first', () => {
    const s = settle(enter(start()));
    expect(stackAbilities(s).map((a) => a.controller)).toEqual(['p1', 'p2']);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Soul Warden', 'Test Soul Warden B']);
  });

  it('with the other player active the order is reversed', () => {
    const s0 = tweak(start(), (t) => { t.turn.activePlayer = 'p2'; });
    const s = settle(enter(s0));
    expect(stackAbilities(s).map((a) => a.controller)).toEqual(['p2', 'p1']);
  });

  it('two triggers of one player that do the same thing need no order decision (nothing to decide)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Soul Warden', 'Test Soul Warden'], hand: ['Test Vanilla'] } });
    const s = settle(enter(s0)); // would throw NeedDecision if an `order` decision were raised
    expect(stackAbilities(s)).toHaveLength(2);
  });

  it('two different triggers of one player: the player orders them, and the first in the answer goes on the stack first (CR 603.3b)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Soul Warden', 'Test Watcher B'], hand: ['Test Vanilla'] } });
    const d = decisionOf(() => settle(enter(s0)));
    expect(d.kind).toBe('order');
    expect(d.player).toBe('p1');
    const items = (d as Extract<typeof d, { kind: 'order' }>).items;
    expect(items).toHaveLength(2);
    for (const order of [items, [...items].reverse()]) {
      const g = gameOf(s0, [{ kind: 'order', ids: order.map((i) => i.id) }]);
      move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
      const s = settle(g);
      // bottom to top: the order of the answer
      expect(stackAbilities(s).map((a) => a.source)).toEqual(order.map((i) => i.label.split(':')[0]));
    }
  });
});

describe('CR 603.3c: modal triggered abilities choose their mode as they are put on the stack', () => {
  const toEnd = (extra: Parameters<typeof scenario>[1] = {}): GameState => scenario(['Plains'], { defs, p1: { battlefield: ['Test Modal Trigger'] }, p2: { battlefield: [] }, ...extra });

  it('the controller announces the mode, then its target; the choice cannot be taken back', () => {
    let s = passTo(toEnd(), 1, 'end');
    expect(s.pending!.kind).toBe('chooseOption');
    expect(s.pending!.cancellable).toBeFalsy();
    expect(reject(s, { type: 'cancel', player: 'p1' }).message).toMatch(/nothing to cancel/i);
    const d = s.pending as Extract<typeof s.pending, { kind: 'chooseOption' }>;
    // mode 2 needs a creature and there is none: it is disabled (CR 603.3c, 700.2a)
    expect(d.options.map((o) => !!o.disabled)).toEqual([false, true, false]);
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    expect(s.pending!.kind).toBe('chooseTargets'); // target player (mode 0)
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] });
    const [a] = stackAbilities(s);
    expect(s.objects[a!.id]!.stack!.modes).toEqual([0]);
    expect(a!.targets).toEqual(['p1']);
  });

  it('a mode without targets needs none', () => {
    let s = passTo(toEnd(), 1, 'end');
    s = answer(s, { kind: 'chooseOption', ids: ['2'] });
    expect(s.pending!.kind).toBe('priority');
    expect(s.objects[stackAbilities(s)[0]!.id]!.stack!.modes).toEqual([2]);
  });

  it('if no mode can be chosen the ability is removed from the stack, with no decision at all (CR 603.3c)', () => {
    const s = passTo(scenario(['Plains'], { defs, p1: { battlefield: ['Test Modal Creatures'] } }), 1, 'end');
    expect(s.pending!.kind).toBe('priority');
    expect(stackAbilities(s)).toHaveLength(0);
    expect(s.log.some((l) => l.rules?.includes('CR 603.3c') && /removed from the stack/.test(l.text))).toBe(true);
  });
});

describe('CR 603.3d: targets are chosen as the triggered ability is put on the stack', () => {
  it('an enters trigger asks for its target when the permanent enters (Flametongue Kavu), and cannot be cancelled', () => {
    let s = scenario(['Plains', 'Mountain'], { defs, p1: { battlefield: ['Mountain'], hand: ['Test Flametongue'] }, p2: { battlefield: ['Test Vanilla'] } });
    s = castAuto(s, 'Test Flametongue');
    s = passBoth(s); // the creature spell resolves
    expect(s.pending!.kind).toBe('chooseTargets');
    expect(s.pending!.cancellable).toBeFalsy();
    const d = s.pending as Extract<typeof s.pending, { kind: 'chooseTargets' }>;
    const vanilla = find(s, 'Test Vanilla', 'battlefield');
    expect(d.objects).toContain(vanilla);
    expect(d.objects).toContain(find(s, 'Test Flametongue', 'battlefield')); // "target creature" may be itself
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: vanilla }] });
    const [a] = stackAbilities(s);
    expect(a).toMatchObject({ source: 'Test Flametongue', controller: 'p1', targets: [vanilla] });
    expect(s.objects[a!.id]!.stack!.kind).toBe('triggered');
    expect(s.objects[a!.id]!.stack!.event!.roles.subject).toEqual({ objects: [{ id: find(s, 'Test Flametongue', 'battlefield'), zone: 'battlefield' }] });
  });

  it('a required target with no legal choice removes the ability from the stack (and says so)', () => {
    const s = passTo(scenario(['Plains'], { defs, p1: { battlefield: ['Test Artifact Hater'] } }), 3, 'upkeep');
    expect(s.pending!.kind).toBe('priority');
    expect(stackAbilities(s)).toHaveLength(0);
    expect(s.log.some((l) => l.rules?.includes('CR 603.3d') && /removed from the stack/.test(l.text))).toBe(true);
  });

  it('with a legal target it goes on the stack with it chosen', () => {
    let s = passTo(scenario(['Plains'], { defs, p1: { battlefield: ['Test Artifact Hater'] }, p2: { battlefield: ['Test Trinket'] } }), 3, 'upkeep');
    expect(s.pending!.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Trinket', 'battlefield') }] });
    expect(stackAbilities(s)[0]).toMatchObject({ source: 'Test Artifact Hater', targets: [find(s, 'Test Trinket', 'battlefield')] });
  });

  it('an ability with no targets and no modes goes on the stack without any decision (Soul Warden style)', () => {
    const s = passTo(scenario(['Plains'], { defs, p1: { battlefield: ['Test Upkeep Gainer'] } }), 3, 'upkeep');
    expect(s.pending!.kind).toBe('priority');
    expect(stackAbilities(s)).toHaveLength(1);
    expect(s.zones.stack.length).toBe(1);
    expect(s.objects[s.zones.stack[0]!]!.controller).toBe('p1'); // CR 603.3a
  });
});

describe('Fiend Hunter race (CR 607.2a, 603.10a, 400.7)', () => {
  it('the leaves-the-battlefield ability goes on top of the enters ability when the Hunter dies first, and its source snapshot has linked nothing yet', () => {
    let s = scenario(['Plains'], { defs, p1: { battlefield: ['Plains', 'Plains'], hand: ['Test Fiend Hunter'] }, p2: { battlefield: ['Test Vanilla'] } });
    s = castAuto(s, 'Test Fiend Hunter');
    s = passBoth(s);
    expect(s.pending!.kind).toBe('chooseTargets'); // "another target creature"
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Vanilla', 'battlefield') }] });
    const hunter = find(s, 'Test Fiend Hunter', 'battlefield');
    expect(stackAbilities(s)).toHaveLength(1);
    s = lethal(s, hunter);
    s = pass(s); // before p2 would receive priority, state-based actions kill the Hunter and its leaves ability triggers
    const abilities = stackAbilities(s);
    expect(abilities.map((a) => a.text)).toEqual([
      'When ~ enters, you may exile another target creature.',
      'When ~ leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.',
    ]);
    const leaves = s.objects[abilities[1]!.id]!.stack!;
    expect(leaves.sourceId).toBe(hunter); // the object as it was, not the card in the graveyard
    expect(s.lki[hunter]!.object.links).toBeUndefined(); // the enters ability has not resolved: nothing is linked (the "race")
    expect(leaves.event!.before[hunter]!.leftZone).toBe('battlefield');
    // the new object in the graveyard is what "~" is for effects that look for it afterwards (CR 400.7e)
    expect(leaves.event!.roles.subject).toEqual({ objects: [{ id: s.lki[hunter]!.newId!, zone: 'graveyard' }] });
  });
});

describe('CR 400.7e: Rancor returns itself (the trigger finds the new object in the graveyard)', () => {
  it('the event\'s subject is the card in the graveyard, not the permanent that no longer exists', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Rancor'] } });
    const old = find(s0, 'Test Rancor', 'battlefield');
    const g = gameOf(s0);
    const newId = move(g, old, 'graveyard', { cause: 'destroy' })!;
    const s = settle(g);
    expect(s.objects[old]).toBeUndefined();
    const [a] = stackAbilities(s);
    expect(a).toMatchObject({ source: 'Test Rancor', controller: 'p1' });
    const event = s.objects[a!.id]!.stack!.event!;
    expect(event.roles.subject).toEqual({ objects: [{ id: newId, zone: 'graveyard' }] });
    expect(s.objects[newId]!.zone).toBe('graveyard');
    expect(s.lki[old]!.newId).toBe(newId);
  });

  it('a card that goes somewhere nobody can see cannot be found there: the subject is the last known object (CR 603.6)', () => {
    const rancorHand = synth({ name: 'Test Hand Leaver', cost: '{1}', type: 'Creature — Test', pt: ['1', '1'], abilities: [trig('When ~ is put into a library from the battlefield, ...', [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'library' }], {})] });
    const s0 = scenario(['Plains'], { defs: [rancorHand], p1: { battlefield: ['Test Hand Leaver'] } });
    const old = find(s0, 'Test Hand Leaver', 'battlefield');
    const g = gameOf(s0);
    move(g, old, 'library');
    const s = settle(g);
    expect(s.objects[stackAbilities(s)[0]!.id]!.stack!.event!.roles.subject).toEqual({ objects: [{ id: old, zone: 'battlefield' }] });
  });
});

describe('CR 603.2: triggers fire during a real turn (upkeep, the stack, and the events of other triggers)', () => {
  it('the ability of an enchantment goes on the stack at the beginning of its controller\'s upkeep, not the opponent\'s', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Upkeep Gainer'] }, p2: { battlefield: ['Test Upkeep Gainer'] } });
    const s2 = passTo(s0, 2, 'upkeep'); // p2's upkeep: only p2's enchantment
    expect(stackAbilities(s2).map((a) => a.controller)).toEqual(['p2']);
    const s3 = passTo(tweak(s2, (t) => { t.zones.stack = []; for (const id of Object.keys(t.objects)) if (t.objects[id]!.kind === 'ability') delete t.objects[id]; }), 3, 'upkeep');
    expect(stackAbilities(s3).map((a) => a.controller)).toEqual(['p1']);
  });

  it('putting an ability on the stack emits abilityTriggered and gives the active player priority afterwards', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Upkeep Gainer'] } });
    const s = passTo(s0, 3, 'upkeep');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // the active player receives priority after the ability went on the stack (CR 117.3a)
    expect(s.zones.stack).toHaveLength(1);
    expect(act(s, { type: 'pass', player: 'p1' }).pending).toMatchObject({ kind: 'priority', player: 'p2' });
  });
});

describe('the entry is the hook milestone 3 left', () => {
  it('core/triggers re-exports the real implementation', async () => {
    const core = await import('../../../src/core/triggers');
    const real = await import('../../../src/triggers/stack');
    expect(core.putPendingTriggersOnStack).toBe(real.putPendingTriggersOnStack);
  });
});

describe('the events of a real turn trigger abilities at the moment CR 603.2 says', () => {
  it('casting a spell triggers "whenever you cast a spell" above the spell on the stack (CR 601.2i, 603.3)', () => {
    let s = scenario(['Plains'], { defs, p1: { battlefield: ['Test Cast Watcher', 'Plains', 'Plains'], hand: ['Test Vanilla'] } });
    s = castAuto(s, 'Test Vanilla');
    const abilities = stackAbilities(s);
    expect(abilities).toHaveLength(1);
    expect(s.zones.stack).toHaveLength(2);
    expect(s.zones.stack[1]).toBe(abilities[0]!.id); // the trigger is on top: it resolves before the spell
    const event = s.objects[abilities[0]!.id]!.stack!.event!;
    expect(event.ev).toBe('cast');
    expect(event.roles.spell).toEqual({ objects: [{ id: s.zones.stack[0]!, zone: 'stack' }] });
    expect(event.roles.player).toEqual({ players: ['p1'] });
  });

  it('"When you cast this spell" triggers from the stack, once, and only for the spell itself (CR 601.2i, 113.6)', () => {
    const cascade = synth({
      name: 'Test Self Cast', cost: '{1}', type: 'Creature — Test', pt: ['1', '1'],
      abilities: [trig('When you cast this spell, you gain 1 life.', [{ ev: 'cast', spell: { self: true } }], { steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] }, { zone: ['stack'] })],
    });
    let s = scenario(['Plains'], { defs: [cascade, ...defs], p1: { battlefield: ['Plains'], hand: ['Test Self Cast'] } });
    s = castAuto(s, 'Test Self Cast');
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Self Cast', controller: 'p1' }]);
    expect(s.zones.stack).toHaveLength(2);
  });

  it('declaring an attacker triggers "whenever ~ attacks" in the declare attackers step', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Attack Trigger'] }, p2: { battlefield: [] } });
    const attacker = find(s0, 'Test Attack Trigger', 'battlefield');
    const s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
    expect(s.turn.step).toBe('declareAttackers');
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Attack Trigger', controller: 'p1' }]);
    expect(s.objects[stackAbilities(s)[0]!.id]!.stack!.event!.roles.attacker).toEqual({ objects: [{ id: attacker, zone: 'battlefield' }] });
  });

  it('combat damage to a player triggers "whenever ~ deals combat damage to a player" in the combat damage step (CR 510.2), with the damage as "that much"', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Damage Trigger'] }, p2: { battlefield: [] } });
    const attacker = find(s0, 'Test Damage Trigger', 'battlefield');
    const s = runCombat(s0, { attack: [[attacker]], until: 'combatDamage' });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    const [a] = stackAbilities(s);
    expect(a).toMatchObject({ source: 'Test Damage Trigger', controller: 'p1' });
    expect(s.objects[a!.id]!.stack!.event).toMatchObject({ ev: 'damage', amount: 2, roles: { recipient: { players: ['p2'] } } });
  });
});

describe('"Trigger now": a triggered ability the engine cannot detect, with an understood effect, goes through normal announcement', () => {
  const manualTrigger = synth({
    name: 'Test Manual Trigger', cost: '{1}', type: 'Enchantment',
    abilities: [{
      kind: 'manual', text: 'Whenever something odd happens, target player gains 2 life.', reason: 'no template for the trigger', shape: 'triggered',
      effect: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], steps: [{ op: 'gainLife', who: { ref: 'target', id: 't0' }, amount: 2 }] },
    }],
  });

  it('its controller puts it on the stack by hand; targets are chosen as for any trigger, and it is logged as manual', () => {
    const s0 = scenario(['Plains'], { defs: [manualTrigger], p1: { battlefield: ['Test Manual Trigger'] } });
    const id = find(s0, 'Test Manual Trigger', 'battlefield');
    const g = gameOf(s0, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(triggerNow(g, 'p1', id, 'p:0:0')).not.toBeNull();
    expect(stackAbilities(g.s)).toMatchObject([{ source: 'Test Manual Trigger', controller: 'p1', targets: ['p2'] }]);
    expect(g.s.log.some((l) => l.level === 'manual' && /by hand/.test(l.text))).toBe(true);
    expect(() => triggerNow(gameOf(s0), 'p2', id, 'p:0:0')).toThrow(/control/);
    expect(() => triggerNow(gameOf(s0), 'p1', id, 'p:0:7')).toThrow(/triggered/);
  });

  it('manual triggered abilities are never collected from events', () => {
    const s0 = scenario(['Plains'], { defs: [manualTrigger, ...defs], p1: { battlefield: ['Test Manual Trigger'], hand: ['Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(settle(g).zones.stack).toEqual([]);
  });
});

describe('an ability that has triggered stays triggered even if its source lost the ability since (CR 603.3)', () => {
  it('the printed ability is found when the characteristics no longer list it', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Upkeep Gainer'] } });
    const id = find(s0, 'Test Upkeep Gainer', 'battlefield');
    const g = gameOf(s0);
    g.s.pendingTriggers.push({ id: 't1', sourceId: id, sourceName: 'Test Upkeep Gainer', controller: 'p1', abilityRef: { source: 'printed', face: 0, index: 0, key: 'p:0:0' }, context: { ev: 'step', roles: {}, before: {} } });
    g.obj(id).faceDown = true; // a face-down permanent has no abilities (CR 708.2a)
    expect(stackAbilities(settle(g))).toHaveLength(1);
  });
});

describe('CR 514.3a: triggers caused by the discard in the cleanup step make players receive priority', () => {
  it('"whenever you discard a card" goes on the stack during cleanup, and another cleanup step follows', () => {
    const watcher = watcherOf('Test Discard Watcher', [{ ev: 'action', verb: 'discard', actor: 'you' }]);
    let s = scenario(['Plains'], { defs: [...defs, watcher], p1: { battlefield: ['Test Discard Watcher'], hand: Array(8).fill('Plains') as string[] } });
    s = passTo(s, 1, 'end');
    s = pass(pass(s)); // the end step is over: cleanup, hand size 8 > 7
    expect(s.pending!.kind).toBe('chooseObjects');
    const d = s.pending as Extract<typeof s.pending, { kind: 'chooseObjects' }>;
    s = answer(s, { kind: 'chooseObjects', ids: [d.options[0]!] });
    expect(s.turn.step).toBe('cleanup');
    expect(s.pending!.kind).toBe('priority'); // CR 514.3a: a trigger is waiting, so players get priority in the cleanup step
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Discard Watcher', controller: 'p1' }]);
  });
});

describe('determinism: the same actions on the same state give the same state (replay, saves, a future server)', () => {
  it('Blood Artist and a Vanilla dying together, with the same answers, twice', () => {
    const play = (): string => {
      let s = scenario(['Plains'], { defs, p1: { battlefield: ['Test Blood Artist'] }, p2: { battlefield: ['Test Vanilla'] } });
      s = lethal(lethal(s, find(s, 'Test Blood Artist', 'battlefield')), find(s, 'Test Vanilla', 'battlefield'));
      s = pass(s);
      s = answer(s, { kind: 'order', ids: (s.pending as Extract<typeof s.pending, { kind: 'order' }>).items.map((i) => i.id) });
      s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] });
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });
});
