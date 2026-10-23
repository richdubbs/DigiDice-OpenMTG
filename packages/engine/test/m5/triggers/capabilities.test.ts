/**
 * WP8 review fixes: the `ev:` capabilities are honest. A card whose trigger depends on an event this build never emits, or on a pattern field no matcher
 * evaluates, must NOT be classified full (design 5.2, D2): `ev:<ev>` exists only for kinds the engine can emit, and `triggers/forms.ts` names the finer forms.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DelayedWhen, EventPattern } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { delayedWhenForms, eventPatternForms } from '../../../src/triggers/forms';
import { EVENT_MATCHERS, NOT_EMITTED, matchEvent } from '../../../src/triggers/match';
import { SRC_ROOT } from '../helpers';
import { batchesOf, find, gameOf, scenario } from './helpers';
import { watcherOf, vanilla } from './cards';

/** The engine events each `ev` is derived from (normalize.ts). `state` is evaluated by triggers/state.ts, not derived from an event. */
const SOURCES: Record<EventPattern['ev'], string[] | 'evaluated'> = {
  zoneChange: ['zoneChanged'], cast: ['spellCast'], activate: ['abilityActivated', 'manaAdded'], attacks: ['attackersDeclared'], blocks: ['blockersDeclared'],
  becomesBlocked: ['blockersDeclared'], attacksUnblocked: ['blockersDeclared'] /* std-rx35 */, damage: ['damageDealt'], step: ['stepBegan'], life: ['lifeChanged'], draw: ['drew'], counters: ['countersChanged'],
  createToken: ['zoneChanged', 'tokenCreated'], dieRoll: ['dieRolled'], state: 'evaluated', beginTurn: ['turnBegan'], resolves: ['resolved'],
  phase: [], dayNight: ['dayNight'], // M6-0: phase is replacement-only (no GameEvent); dayNight is emitted from M6-4
  loseGame: ['playerLost'], // M12-3 (CR 603.9)
  coinFlip: ['coinFlipped'], // cloud r3-mech (CR 705.2)
  controlChange: ['controlChanged'], // Standard round 3, r3-trig (CR 108.4)
  abilityTriggered: 'evaluated', // std-copy-6: made by triggers/collect.ts#metaEvents from the triggers a batch caused (CR 603.2), not from a GameEvent
  becomes: ['tapped', 'untapped', 'transformed', 'turnedFaceUp', 'attached', 'becameTarget', 'actionPerformed'],
  action: ['zoneChanged', 'landPlayed', 'shuffled', 'countered', 'abilityCountered', 'actionPerformed'],
};

/** Every `type: '<name>'` that engine code outside types/ and triggers/ writes: an emitter of that GameEvent (or a decision/other record, which does not matter). */
function emittedTypes(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (p.endsWith('types') || p.endsWith('triggers')) continue;
        walk(p);
      } else if (p.endsWith('.ts')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/type: '([A-Za-z]+)'/g)) out.add(m[1]!);
      }
    }
  };
  walk(SRC_ROOT);
  return out;
}

describe('design 5.2, D2: `ev:<ev>` is a capability only for event kinds the engine emits', () => {
  const emitted = emittedTypes();

  it('NOT_EMITTED lists exactly the kinds none of whose events has an emitter (remove a kind when its emitter is added)', () => {
    const none = (Object.entries(SOURCES) as [EventPattern['ev'], string[] | 'evaluated'][])
      .filter(([, src]) => src !== 'evaluated' && !src.some((t) => emitted.has(t)))
      .map(([ev]) => ev);
    expect([...NOT_EMITTED].sort()).toEqual(none.sort());
    expect(none).not.toContain('dieRoll'); // WP15: the rollDie handler emits dieRolled
  });

  it('the registered kinds are the others, and ENGINE_CAPABILITIES says the same', () => {
    expect(Object.keys(EVENT_MATCHERS).sort()).toEqual(Object.keys(SOURCES).filter((k) => !(NOT_EMITTED as readonly string[]).includes(k)).sort());
    for (const ev of Object.keys(SOURCES)) expect(ENGINE_CAPABILITIES.has(`ev:${ev}`), ev).toBe(!(NOT_EMITTED as readonly string[]).includes(ev));
  });

  it('the matcher of a not-emitted kind still works on a hand-built event (it is ready for its emitter)', () => {
    const s0 = scenario(['Plains'], { defs: [vanilla()], p1: { battlefield: ['Test Vanilla'] } });
    const g = gameOf(s0);
    g.emit({ type: 'dieRolled', player: 'p1', sides: 6, result: 6 });
    const e = batchesOf(g).flat().find((x) => x.ev === 'dieRoll')!;
    expect(matchEvent({ ev: 'dieRoll', result: { op: '>=', value: 5 } }, e, { g, source: find(s0, 'Test Vanilla', 'battlefield'), controller: 'p1', lookBack: false })).toBe(true);
  });
});

describe('design 5.2, D2: the finer event forms are named, and only the ones the engine emits are capabilities', () => {
  const supported = ['feature:ev.action.sacrifice', 'feature:ev.action.discard', 'feature:ev.action.destroy', 'feature:ev.action.exile', 'feature:ev.action.playLand', 'feature:ev.action.shuffle', 'feature:ev.becomes.tapped', 'feature:ev.becomes.untapped',
    // WP14 added the emitters of these (effects/handlers/zones*.ts, tokens*.ts): test/m5/zones/events.test.ts
    'feature:ev.action.counter', 'feature:ev.becomes.attached', 'feature:ev.becomes.transformed', 'feature:ev.cast.orCopy',
    // WP32: triggered abilities emit becameTarget too (spells, activated abilities and copies already did): test/m5/triggers/wp32-ward.test.ts
    'feature:ev.becomes.targeted',
    // M6-3: turned face up / face down (rules/face-down.ts emits them; triggers/forms-face.ts)
    'feature:ev.becomes.turnedFaceUp', 'feature:ev.becomes.turnedFaceDown',
    // FAST5 T37: monstrosity and cycling emit them (effects/handlers/actions-native-counters.ts, actions/activate.ts)
    'feature:ev.becomes.monstrous', 'feature:ev.action.cycle',
    // FAST5X E9: scry and surveil (effects/handlers/cards-library.ts emits them, CR 701.22d, 701.25d)
    'feature:ev.action.scry', 'feature:ev.action.surveil',
    'feature:ev.action.search']; // Standard round 4, r4-trig (CR 701.23a): effects/handlers/cards-library.ts emits it for every zone searched
  const missing = [
    // CR 701.3d: leaving the battlefield and the 704.5m-n state-based actions don't emit "unattached" yet (WP14 review)
    'feature:ev.becomes.unattached',
    'feature:ev.action.mill', // FAST5X E9: scry and surveil are emitted and advertised (Standard round 4, r4-trig: search too)
    'feature:ev.becomes.crewed', 'feature:ev.beginTurn.extra', 'feature:ev.becomes.by', 'feature:ev.cmp.quantity',
  ];

  it('the verbs and changes with an emitter are capabilities', () => {
    for (const n of supported) expect(ENGINE_CAPABILITIES.has(n), n).toBe(true);
  });

  it('everything else is missing, so a card that depends on it is not classified full', () => {
    for (const n of missing) expect(ENGINE_CAPABILITIES.has(n), n).toBe(false);
  });

  it('eventPatternForms names them from the pattern', () => {
    const f = eventPatternForms;
    expect(f({ ev: 'action', verb: 'sacrifice' })).toEqual(['feature:ev.action.sacrifice']);
    expect(f({ ev: 'action', verb: 'scry' })).toEqual(['feature:ev.action.scry']);
    expect(f({ ev: 'becomes', what: 'tapped', object: {} })).toEqual(['feature:ev.becomes.tapped']);
    expect(f({ ev: 'becomes', what: 'targeted', object: {}, by: { types: ['Spell'] } })).toEqual(['feature:ev.becomes.targeted']);
    expect(f({ ev: 'becomes', what: 'tapped', object: {}, by: {} })).toEqual(['feature:ev.becomes.tapped', 'feature:ev.becomes.by']);
    expect(f({ ev: 'cast', orCopy: true })).toEqual(['feature:ev.cast.orCopy']);
    expect(f({ ev: 'cast' })).toEqual([]);
    expect(f({ ev: 'beginTurn', extra: true })).toEqual(['feature:ev.beginTurn.extra']);
    expect(f({ ev: 'beginTurn', whose: 'you' })).toEqual([]);
    expect(f({ ev: 'damage', amount: { op: '>=', value: { q: 'count', of: { ref: 'each', filter: {} } } as never } })).toEqual(['feature:ev.cmp.quantity']);
    expect(f({ ev: 'damage', amount: { op: '>=', value: 3 } })).toEqual([]);
    expect(f({ ev: 'counters', change: 'put', on: {}, atLeast: { q: 'X' } as never })).toEqual(['feature:ev.cmp.quantity']);
    expect(f({ ev: 'counters', change: 'put', on: {}, atLeast: 3 })).toEqual([]);
    expect(f({ ev: 'zoneChange', subject: {}, to: 'battlefield' })).toEqual([]);
  });

  it('delayedWhenForms: an event pattern as above; a step trigger is "the next such step" (CR 603.7a), `next: false` has no meaning this build knows', () => {
    const d = (w: DelayedWhen) => delayedWhenForms(w);
    expect(d({ at: 'event', event: { ev: 'action', verb: 'scry' } })).toEqual(['feature:ev.action.scry']);
    expect(d({ at: 'step', step: 'end' })).toEqual([]);
    expect(d({ at: 'step', step: 'end', next: true })).toEqual([]);
    expect(d({ at: 'step', step: 'end', next: false })).toEqual(['feature:delayed.step.notNext']);
    expect(d({ at: 'endOfCombat' })).toEqual([]);
    expect(ENGINE_CAPABILITIES.has('feature:delayed.step.notNext')).toBe(false);
  });
});

describe('the matchers fail closed for the forms that are missing: a pattern that asks never matches, it is never half-evaluated', () => {
  const s0 = scenario(['Plains'], { defs: [vanilla(), watcherOf('Test W', [{ ev: 'life', change: 'gain' }])], p1: { battlefield: ['Test Vanilla'] } });
  const src = find(s0, 'Test Vanilla', 'battlefield');
  const run = (p: EventPattern, ev: (g: ReturnType<typeof gameOf>) => void): boolean => {
    const g = gameOf(s0);
    ev(g);
    const all = batchesOf(g).flat();
    return all.some((e) => matchEvent(p, e, { g, source: src, controller: 'p1', lookBack: false }));
  };
  const quantity = { op: '>=', value: { q: 'count', of: { ref: 'each', filter: {} } } } as never;

  it('a NumberCmp whose value is a quantity matches nothing', () => {
    expect(run({ ev: 'life', change: 'gain', amount: quantity }, (g) => g.emit({ type: 'lifeChanged', player: 'p1', delta: 3, life: 23 }))).toBe(false);
    expect(run({ ev: 'life', change: 'gain', amount: { op: '>=', value: 3 } }, (g) => g.emit({ type: 'lifeChanged', player: 'p1', delta: 3, life: 23 }))).toBe(true);
    expect(run({ ev: 'damage', amount: quantity }, (g) => g.emit({ type: 'damageDealt', source: src, target: 'p2', amount: 2, combat: false }))).toBe(false);
    expect(run({ ev: 'attacks', count: quantity }, (g) => g.emit({ type: 'attackersDeclared', attackers: [{ attacker: src, defender: 'p2' }] }))).toBe(false);
  });

  it('counters.atLeast as a quantity matches nothing', () => {
    expect(run({ ev: 'counters', change: 'put', on: {}, atLeast: { q: 'X' } as never }, (g) => { g.s.objects[src]!.counters['charge'] = 2; g.emit({ type: 'countersChanged', target: src, counter: 'charge', delta: 2 }); })).toBe(false);
  });

  it('becomes.by for a change that has no source to filter matches nothing', () => {
    expect(run({ ev: 'becomes', what: 'tapped', object: {}, by: {} }, (g) => g.emit({ type: 'tapped', objectId: src }))).toBe(false);
    expect(run({ ev: 'becomes', what: 'tapped', object: {} }, (g) => g.emit({ type: 'tapped', objectId: src }))).toBe(true);
  });

  it('a copy of a spell is not cast (CR 707.10): only a pattern with orCopy sees a (hand-built) spellCopied event; the engine emits none, hence `feature:ev.cast.orCopy` is missing', () => {
    const copy = (g: ReturnType<typeof gameOf>): void => { g.emit({ type: 'spellCopied', objectId: src, copyOf: src }); };
    expect(run({ ev: 'cast' }, copy)).toBe(false);
    expect(run({ ev: 'cast', orCopy: true }, copy)).toBe(true);
  });
});
