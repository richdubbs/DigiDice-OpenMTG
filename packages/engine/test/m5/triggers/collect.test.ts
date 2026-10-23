/**
 * WP8: collecting triggers from a batch of events (design 8.4): CR 603.2c (once per occurrence, batched), 603.2d (additional times), 603.2e (becomes), 603.2h (once
 * each turn), 603.4 (intervening if), 603.6a-b (enters), 603.10a (look back), 714.2 (chapters). The events come from real engine primitives on a real game.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { createToken } from '../../../src/core/zones';
import { addCounters } from '../../../src/rules/counters';
import { compileCard } from '../../../src/index';
import { collectPendingTriggers } from '../../../src/core/triggers';
import { interveningIfHolds } from '../../../src/triggers/cond';
import {
  batchWatcher, bloodArtist, creatureDies, flametongue, interveningDrawer, landWatcher, onceEachTurn, panharmonicon, saga, soulWarden, trig, vanilla, watcherOf,
} from './cards';
import { collectTriggers } from '../../../src/triggers/collect';
import { batchesOf, find, gameOf, move, put, scenario, settle, stackAbilities, tweak } from './helpers';
import { synth } from '../helpers';

const defs = [
  batchWatcher(), landWatcher(), bloodArtist(), panharmonicon(), soulWarden(), soulWarden('Test Soul Warden B'), vanilla(), vanilla('Test Other'), flametongue(), interveningDrawer(),
  onceEachTurn(), saga(),
  watcherOf('Test Tap Watcher', [{ ev: 'becomes', what: 'tapped', object: { types: ['Land', 'Creature'] } }]),
];

const pending = (g: Game): string[] => g.s.pendingTriggers.map((t) => t.sourceName);
const collect = (g: Game): Game => { collectPendingTriggers(g); return g; };

describe('CR 603.2c: an ability triggers once each time its trigger event occurs; "one or more" triggers once for the whole batch', () => {
  it('"Whenever a land is put into a graveyard from the battlefield" triggers once for each land that one event puts there', () => {
    const s0 = scenario(['Plains', 'Forest'], { defs, p1: { battlefield: ['Test Land Watcher', 'Plains', 'Forest'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Plains', 'battlefield'), 'graveyard', { cause: 'destroy' });
    move(g, find(s0, 'Forest', 'battlefield'), 'graveyard', { cause: 'destroy' });
    expect(pending(collect(g))).toEqual(['Test Land Watcher', 'Test Land Watcher']);
  });

  it('"Whenever one or more creatures die" triggers once when several die together', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Batch Watcher', 'Test Vanilla'] }, p2: { battlefield: ['Test Other'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Other', 'battlefield'), 'graveyard');
    const c = collect(g);
    expect(pending(c)).toEqual(['Test Batch Watcher']);
    // "that much" sees everything in the batch (two creatures)
    expect(c.s.pendingTriggers[0]!.context.amount).toBe(2);
    expect(c.s.pendingTriggers[0]!.context.roles.subject).toMatchObject({ objects: [{}, {}] });
  });

  it('events in different batches (the first spell resolved before the second) trigger it twice', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Batch Watcher', 'Test Vanilla'] }, p2: { battlefield: ['Test Other'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    g.emit({ type: 'resolved', objectId: 'x1' }); // a spell finished resolving: what follows is another event (CR 704.3)
    move(g, find(s0, 'Test Other', 'battlefield'), 'graveyard');
    expect(pending(collect(g))).toEqual(['Test Batch Watcher', 'Test Batch Watcher']);
  });

  it('collecting twice does not trigger twice: the events are consumed', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Land Watcher', 'Plains'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Plains', 'battlefield'), 'graveyard');
    collect(g);
    collect(g);
    expect(pending(g)).toHaveLength(1);
  });
});

describe('CR 603.2d: "triggers an additional time" (Panharmonicon)', () => {
  const start = (): GameState => scenario(['Plains'], { defs, p1: { battlefield: ['Test Panharmonicon', 'Test Soul Warden'], hand: ['Test Vanilla', 'Plains'] }, p2: { battlefield: ['Test Soul Warden B'], hand: ['Test Other'] } });

  it('a creature entering makes the controller\'s triggered ability trigger twice, and only theirs', () => {
    const s0 = start();
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(g)).sort()).toEqual(['Test Soul Warden', 'Test Soul Warden', 'Test Soul Warden B']);
  });

  it('it applies whoever controls the creature that entered ("an artifact or creature entering")', () => {
    const s0 = start();
    const g = gameOf(s0);
    move(g, find(s0, 'Test Other', 'hand', 'p2'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(g)).sort()).toEqual(['Test Soul Warden', 'Test Soul Warden', 'Test Soul Warden B']);
  });

  it('a land entering is not the event it is about: the ability triggers once (and here not at all, it is a creature ability)', () => {
    const lands = scenario(['Plains'], { defs: [...defs, synth({ name: 'Test Land Watcher B', cost: '{1}', type: 'Enchantment', abilities: [trig('Whenever a land enters, gain life.', [{ ev: 'zoneChange', subject: { types: ['Land'] }, to: 'battlefield' }], {})] })], p1: { battlefield: ['Test Panharmonicon', 'Test Land Watcher B'], hand: ['Plains'] } });
    const g = gameOf(lands);
    move(g, find(lands, 'Plains', 'hand', 'p1'), 'battlefield', { cause: 'play land' });
    expect(pending(collect(g))).toEqual(['Test Land Watcher B']);
  });

  it('it does not double delayed triggers (they are not abilities of the permanent, CR 603.2d)', () => {
    const s0 = start();
    const g = gameOf(s0);
    const watcher = find(s0, 'Test Soul Warden', 'battlefield');
    // a delayed trigger "when a creature enters" created by the Warden
    g.s.delayedTriggers.push({
      id: 'dX', source: { id: watcher, zone: 'battlefield' }, controller: 'p1', when: { at: 'event', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' } },
      do: [], captured: {}, vars: {}, createdTurn: 1, firedCount: 0,
    });
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    const c = collect(g);
    expect(c.s.pendingTriggers.filter((t) => t.abilityRef.source === 'delayed')).toHaveLength(1);
    expect(c.s.pendingTriggers.filter((t) => t.abilityRef.source === 'printed' && t.sourceId === watcher)).toHaveLength(2);
  });

  it('without the Panharmonicon on the battlefield nothing is doubled', () => {
    const s0 = start();
    const g = gameOf(s0);
    move(g, find(s0, 'Test Panharmonicon', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(g)).sort()).toEqual(['Test Soul Warden', 'Test Soul Warden B']);
  });
});

describe('CR 603.4: the intervening "if" is checked when the event happens and again as the ability resolves', () => {
  const upkeep = (g: Game): void => g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' });

  it('false when the event happens: the ability does not trigger', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Intervening Drawer'] } });
    const g = gameOf(s0);
    upkeep(g);
    expect(pending(collect(g))).toEqual([]);
  });

  it('true when the event happens: it triggers; and it is checked a second time on resolution with the same function', () => {
    const s0 = tweak(scenario(['Plains'], { defs, p1: { battlefield: ['Test Intervening Drawer'] } }), (t) => { t.objects[find(t, 'Test Intervening Drawer', 'battlefield')]!.tapped = true; });
    const g = gameOf(s0);
    upkeep(g);
    const s = settle(g);
    const [a] = stackAbilities(s);
    expect(a).toMatchObject({ source: 'Test Intervening Drawer' });
    const stack = s.objects[a!.id]!.stack!;
    const def = s.defs['Test Intervening Drawer']!.faces[0]!.abilities[0]!;
    if (def.kind !== 'triggered') throw new Error('not a triggered ability');
    const source = { id: stack.sourceId!, zone: 'battlefield' as const };
    const env = { source, controller: 'p1', event: stack.event! };
    expect(interveningIfHolds(gameOf(s), def.interveningIf, env)).toBe(true);
    // ... the Drawer untaps before the ability resolves: the condition is false the second time, and the ability would be removed (CR 603.4)
    const later = tweak(s, (t) => { t.objects[source.id]!.tapped = false; });
    expect(interveningIfHolds(gameOf(later), def.interveningIf, env)).toBe(false);
  });

  it('a condition this build cannot evaluate lets the ability trigger and says so in the log (never a silent wrong answer)', () => {
    const odd = synth({
      name: 'Test Unknowable', cost: '{1}', type: 'Enchantment',
      abilities: [trig('At the beginning of your upkeep, if the chosen thing, ...', [{ ev: 'step', step: 'upkeep', whose: 'you' }], {}, { interveningIf: { cond: 'madeUp' } as never })],
    });
    const s0 = scenario(['Plains'], { defs: [odd], p1: { battlefield: ['Test Unknowable'] } });
    const g = gameOf(s0);
    upkeep(g);
    expect(pending(collect(g))).toEqual(['Test Unknowable']);
    expect(g.s.log.some((l) => l.level === 'manual' && l.rules?.includes('CR 603.4'))).toBe(true);
  });
});

describe('CR 603.6a: enters-the-battlefield abilities check all permanents, the newcomers included', () => {
  it('Soul Wardens that enter together each trigger for the other, and for a third creature entering with them, but never for themselves', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Soul Warden', 'Test Soul Warden B', 'Test Vanilla'] } });
    const g = gameOf(s0);
    for (const n of ['Test Soul Warden', 'Test Soul Warden B', 'Test Vanilla']) move(g, find(s0, n, 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    const names = pending(collect(g)).sort();
    expect(names).toEqual(['Test Soul Warden', 'Test Soul Warden', 'Test Soul Warden B', 'Test Soul Warden B']);
  });

  it('an enters trigger on the permanent itself sees "this permanent entered" (Flametongue Kavu)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Flametongue'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Flametongue', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(g))).toEqual(['Test Flametongue']);
  });

  it('a token entering is a permanent entering', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Soul Warden'] } });
    const g = gameOf(s0);
    createToken(g, compileCard({ name: 'Test Token', layout: 'token', type_line: 'Token Creature — Test', power: '1', toughness: '1', oracle_text: '' }), 'p2');
    expect(pending(collect(g))).toEqual(['Test Soul Warden']);
  });
});

describe('CR 603.6b: abilities are looked for in the permanent as it enters, with its characteristics at that moment', () => {
  it('a permanent that enters face down has no abilities, so its own "when this enters" ability does not exist', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Flametongue'] } });
    const faceDown = gameOf(s0);
    move(faceDown, find(s0, 'Test Flametongue', 'hand', 'p1'), 'battlefield', { cause: 'resolve', faceDown: true }); // CR 708.2a: a face-down permanent is a 2/2 with no abilities
    expect(pending(collect(faceDown))).toEqual([]);
    const faceUp = gameOf(s0);
    move(faceUp, find(s0, 'Test Flametongue', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(faceUp))).toEqual(['Test Flametongue']);
  });
});

describe('CR 603.10a: abilities that look back in time', () => {
  it('a permanent that leaves the battlefield together with the creature it watches still triggers (Blood Artist and a Vanilla die together)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Blood Artist', 'Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Blood Artist', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    expect(pending(collect(g))).toEqual(['Test Blood Artist', 'Test Blood Artist']);
  });

  it('a token that dies is gone by the time triggers are collected (state-based action 704.5d) and still triggers the Artist, as it was', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Blood Artist'] } });
    const g = gameOf(s0);
    const token = createToken(g, compileCard({ name: 'Test Token', layout: 'token', type_line: 'Token Creature — Test', power: '1', toughness: '1', oracle_text: '' }), 'p2')!;
    g.s.pendingTriggers = [];
    collect(g);
    g.s.pendingTriggers = [];
    const dead = move(g, token, 'graveyard', { cause: 'lethal damage' })!;
    delete g.s.objects[dead]; // it ceases to exist: it is a token in a graveyard (CR 704.5d)
    g.s.zones.graveyard['p2'] = g.s.zones.graveyard['p2']!.filter((id) => id !== dead);
    const c = collect(g);
    expect(pending(c)).toEqual(['Test Blood Artist']);
    expect(c.s.pendingTriggers[0]!.context.roles.subject).toEqual({ objects: [{ id: token, zone: 'battlefield' }] }); // only the last known object remains
  });

  it('but only for events that look back: a permanent that left does not see a creature entering at the same time (CR 603.6a: it is gone)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Soul Warden'], hand: ['Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Soul Warden', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(g))).toEqual([]);
  });

  it('the creature is judged as it was: a creature card that went hand -> graveyard did not "die"', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Blood Artist'], hand: ['Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'graveyard', { cause: 'discard' });
    expect(pending(collect(g))).toEqual([]);
  });

  it('an ability of a card that left the graveyard looks back at the graveyard (leaves-a-graveyard, CR 603.10a)', () => {
    const lazarus = synth({
      name: 'Test Graveyard Leaver', cost: '{1}', type: 'Creature — Test', pt: ['1', '1'],
      abilities: [trig('When ~ leaves your graveyard, ...', [{ ev: 'zoneChange', subject: { self: true }, from: 'graveyard' }], {}, { zone: ['graveyard'] })],
    });
    const s0 = scenario(['Plains'], { defs: [lazarus], p1: { graveyard: ['Test Graveyard Leaver'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Graveyard Leaver', 'graveyard', 'p1'), 'exile');
    expect(pending(collect(g))).toEqual(['Test Graveyard Leaver']);
  });
});

describe('CR 603.6c: "put into a graveyard from anywhere" is never a leaves-the-battlefield ability (Planar Void)', () => {
  const planarVoid = watcherOf('Test Planar Void', [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'graveyard' }]);

  it('a Void that goes to the graveyard together with a creature does not see it: it is gone and does not look back', () => {
    const s0 = scenario(['Plains'], { defs: [planarVoid, ...defs], p1: { battlefield: ['Test Planar Void', 'Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Planar Void', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    expect(pending(collect(g))).toEqual([]);
  });

  it('control: a Void that stays sees the creature go to the graveyard, from the battlefield or from the hand', () => {
    const s0 = scenario(['Plains'], { defs: [planarVoid, ...defs], p1: { battlefield: ['Test Planar Void', 'Test Vanilla'], hand: ['Test Other'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Other', 'hand', 'p1'), 'graveyard', { cause: 'discard' });
    expect(pending(collect(g))).toEqual(['Test Planar Void', 'Test Planar Void']);
  });

  it('while "dies" (from the battlefield) still looks back: the same two creatures die with a Blood Artist and it sees both', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Blood Artist', 'Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Blood Artist', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    expect(pending(collect(g))).toEqual(['Test Blood Artist', 'Test Blood Artist']);
  });
});

describe('CR 603.2e: "becomes" abilities trigger at the time of the change only', () => {
  it('an untapped land that becomes tapped triggers; a token that enters tapped does not', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Tap Watcher', 'Plains'] } });
    const g = gameOf(s0);
    const plains = find(s0, 'Plains', 'battlefield');
    g.obj(plains).tapped = true;
    g.emit({ type: 'tapped', objectId: plains });
    expect(pending(collect(g))).toEqual(['Test Tap Watcher']);

    const g2 = gameOf(s0);
    createToken(g2, compileCard({ name: 'Test Token', layout: 'token', type_line: 'Token Creature — Test', power: '1', toughness: '1', oracle_text: '' }), 'p1', { tapped: true });
    expect(pending(collect(g2))).toEqual([]); // it was never untapped on the battlefield: no event of becoming tapped exists
  });
});

describe('CR 603.2h: "Do this only once each turn"', () => {
  it('the second creature entering in the same turn does not trigger it, even in the same batch', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Once Each Turn'], hand: ['Test Vanilla', 'Test Other'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    move(g, find(s0, 'Test Other', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(g))).toEqual(['Test Once Each Turn']);
  });

  it('across batches too, and again in the next turn', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Once Each Turn'], hand: ['Test Vanilla', 'Test Other'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    collect(g);
    move(g, find(s0, 'Test Other', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    collect(g);
    expect(g.s.pendingTriggers).toHaveLength(1);
    g.s.turnActivations = {}; // the start of the next turn (core/turn.ts#beginNextTurn)
    g.s.pendingTriggers = [];
    const other = gameOf(s0);
    other.s.turnActivations = g.s.turnActivations;
    move(other, find(s0, 'Test Other', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(pending(collect(other))).toEqual(['Test Once Each Turn']);
  });

  it('collectTriggers is not a dry run (triggers/api.ts): it consumes the limit and the effect counter, so asking twice about one batch answers differently', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Once Each Turn'], hand: ['Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    const [batch] = batchesOf(g);
    const effects = g.s.counters.effect;
    expect(collectTriggers(g, batch!)).toHaveLength(1);
    expect(g.s.counters.effect).toBe(effects + 1);
    expect(Object.values(g.s.turnActivations)).toEqual([1]);
    expect(collectTriggers(g, batch!)).toHaveLength(0); // the limit has been used by the first call
    expect(g.s.pendingTriggers).toEqual([]); // and neither call enqueued anything: collectPendingTriggers does
  });
});

describe('"triggers only once" (limit per game) is remembered by the object itself', () => {
  const once = watcherOf('Test Once Ever', [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }], { limit: { per: 'game', max: 1 } });

  it('it does not trigger a second time, however many turns later; a new object (it left and came back) triggers again (CR 400.7)', () => {
    const s0 = scenario(['Plains'], { defs: [once, ...defs], p1: { battlefield: ['Test Once Ever'], hand: ['Test Vanilla', 'Test Other'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    collect(g);
    g.s.turnActivations = {}; // a new turn
    move(g, find(s0, 'Test Other', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    collect(g);
    expect(pending(g)).toEqual(['Test Once Ever']);
    // it leaves and returns: a new object that has not triggered yet
    const back = move(g, find(g.s, 'Test Once Ever', 'battlefield'), 'hand')!;
    const again = move(g, back, 'battlefield', { cause: 'resolve' })!;
    g.s.pendingTriggers = [];
    g.emit({ type: 'zoneChanged', oldId: 'zz', newId: find(g.s, 'Test Vanilla', 'battlefield'), from: 'hand', to: 'battlefield', owner: 'p1', controller: 'p1', name: 'x' });
    collect(g);
    expect(g.s.pendingTriggers.map((t) => t.sourceId)).toEqual([again]);
  });
});

describe('CR 714.2: a Saga\'s chapter abilities trigger when lore counters reach their number', () => {
  /**
   * M6-6: the Saga is put onto the battlefield once the scenario is in its precombat main phase: a Saga already there as that phase began got a lore counter
   * from the turn-based action of CR 714.3c (core/lore.ts), and these tests count from none.
   */
  const sagaBoard = (counters?: Record<string, number>): GameState =>
    tweak(scenario(['Plains'], { defs }), (t) => { put(t, 'p1', 'battlefield', counters ? { name: 'Test Saga', counters } : 'Test Saga'); });

  it('chapter I on the first lore counter, chapter II on the second, neither on the third', () => {
    const s0 = sagaBoard();
    const g = gameOf(s0);
    const id = find(s0, 'Test Saga', 'battlefield');
    const run = (): number => { g.s.pendingTriggers = []; addCounters(g, id, 'lore', 1); collectPendingTriggers(g); return g.s.pendingTriggers.length; };
    expect([run(), run(), run()]).toEqual([1, 1, 0]);
  });

  it('CR 714.2b-c: "I, II --" is two chapter abilities: one event adding two lore counters (Doubling Season) triggers both', () => {
    const s0 = sagaBoard();
    const g = gameOf(s0);
    addCounters(g, find(s0, 'Test Saga', 'battlefield'), 'lore', 2); // 0 -> 2 in one event
    collectPendingTriggers(g);
    expect(pending(g)).toEqual(['Test Saga', 'Test Saga']);
  });

  it('CR 714.2b: a Saga whose lore counters jump past every chapter number of the ability triggers nothing', () => {
    const s0 = sagaBoard({ lore: 2 });
    const g = gameOf(s0);
    addCounters(g, find(s0, 'Test Saga', 'battlefield'), 'lore', 2); // 2 -> 4: neither chapter I nor II is reached
    collectPendingTriggers(g);
    expect(pending(g)).toEqual([]);
  });
});

describe('abilities outside the battlefield', () => {
  it('a triggered ability that works in the graveyard triggers from there, and one that does not, does not', () => {
    const back = synth({
      name: 'Test Graveyard Watcher', cost: '{1}', type: 'Creature — Test', pt: ['1', '1'],
      abilities: [trig('Whenever a creature dies, ... (from your graveyard)', [creatureDies], {}, { zone: ['graveyard'] })],
    });
    const s0 = scenario(['Plains'], { defs: [back, ...defs], p1: { graveyard: ['Test Graveyard Watcher'], battlefield: ['Test Vanilla'], hand: ['Test Blood Artist'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    expect(pending(collect(g))).toEqual(['Test Graveyard Watcher']); // not the Blood Artist in hand: its ability works on the battlefield only
  });
});
