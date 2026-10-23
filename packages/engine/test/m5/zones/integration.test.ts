/**
 * WP14 with its real neighbors (design 15.1 rule 7): the section 13 cards resolved by `applyAction` through WP10's `resolveStackObject` and WP11's pipeline and
 * performers. While either neighbor is still a stub these tests are skipped (the other WP14 tests fake them); they run by themselves once WP10 and WP11 have
 * merged, and must then pass unchanged.
 */
import { describe, expect, it } from 'vitest';
import { propose } from '../../../src/effects/propose';
import { resolveStackObject } from '../../../src/effects/run';
import type { AbilityDef, DecisionAnswer, GameState } from '../../../src/index';
import { drive, objectTarget, playerTarget } from '../announce/support';
import { act, find, keyword, passBoth, scenario, synth } from '../helpers';
import { withExamples } from './support';

const isStub = (f: () => unknown, wp: string): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    return String(e).includes(`not implemented: ${wp}`);
  }
};
const stubbed = isStub(() => propose(undefined as never, undefined as never), 'WP11') || isStub(() => resolveStackObject(undefined as never, undefined as never), 'WP10');

const LANDS = ['Plains', 'Plains', 'Island', 'Island', 'Swamp', 'Swamp', 'Mountain', 'Mountain'];

function board(): GameState {
  return withExamples(scenario(['Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Counterspell', 'Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Plains', 'Island', 'Swamp', 'Mountain'], {
    p1: { hand: ['Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Counterspell'], battlefield: [...LANDS, 'Plains', 'Plains', 'Island', 'Island', 'Hill Giant'] },
    p2: { hand: ['Lightning Bolt'], battlefield: ['Grizzly Bears', 'Mountain'] },
  }), 'Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Counterspell', 'Lightning Bolt');
}

const castAndResolve = (s: GameState, name: string, answers: DecisionAnswer[]): GameState => passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), answers));
const named = (s: GameState, zone: 'battlefield' | 'exile', name: string): boolean => s.zones[zone].some((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe.skipIf(stubbed)('WP14 through the real interpreter and pipeline (enabled when WP10 and WP11 merge)', () => {
  it('CR 701.8a: Doom Blade destroys the target and goes to the graveyard (CR 608.2n)', () => {
    const s = board();
    const t = castAndResolve(s, 'Doom Blade', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    expect(named(t, 'battlefield', 'Grizzly Bears')).toBe(false);
    expect(t.zones.graveyard['p1']!.some((id) => t.objects[id]!.defId === 'Doom Blade')).toBe(true);
  });

  it('CR 701.8a, 701.19c: Wrath of God destroys every creature', () => {
    const t = castAndResolve(board(), 'Wrath of God', []);
    expect(named(t, 'battlefield', 'Grizzly Bears') || named(t, 'battlefield', 'Hill Giant')).toBe(false);
  });

  it('CR 111.2: Raise the Alarm creates two 1/1 white Soldiers', () => {
    const t = castAndResolve(board(), 'Raise the Alarm', []);
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token')).toHaveLength(2);
  });

  it('CR 701.6a: Counterspell counters Lightning Bolt', () => {
    const s = board();
    const p2 = act(s, { type: 'pass', player: 'p1' });
    const bolted = drive(act(p2, { type: 'cast', player: 'p2', card: find(p2, 'Lightning Bolt', 'hand', 'p2') }), [{ kind: 'chooseTargets', targets: [playerTarget('p1')] }]);
    const back = act(bolted, { type: 'pass', player: 'p2' });
    const t = castAndResolve(back, 'Counterspell', [{ kind: 'chooseTargets', targets: [objectTarget(bolted.zones.stack[0]!)] }]);
    expect(t.zones.graveyard['p2']!.some((id) => t.objects[id]!.defId === 'Lightning Bolt')).toBe(true);
    expect(t.players[0]!.life).toBe(20);
  });
});

// WP14 review: storm (keyword:storm is advertised now that op:copy runs) and a card cast while an effect resolves, both through the real interpreter.
const SOLDIERS: AbilityDef = {
  kind: 'spell', text: 'Create a 1/1 white Soldier creature token.',
  effect: { targets: [], steps: [{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { name: 'Soldier', colors: ['W'], types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1 } }] },
};
const stormSoldiers = synth({ name: 'Test Storm Soldiers', cost: '{W}', type: 'Sorcery', abilities: [SOLDIERS, keyword('storm')] });
const freeCaster = synth({
  name: 'Test Free Caster', cost: '{W}', type: 'Sorcery',
  abilities: [{ kind: 'spell', text: 'You may cast Raise the Alarm from exile without paying its mana cost.', effect: { targets: [], steps: [{ op: 'cast', who: { ref: 'you' }, what: { ref: 'each', filter: { zone: 'exile', name: 'Raise the Alarm' } }, free: true }] } }],
});

function board2(): GameState {
  return withExamples(scenario(['Raise the Alarm', 'Plains'], {
    defs: [stormSoldiers, freeCaster],
    p1: { hand: ['Raise the Alarm', 'Test Storm Soldiers', 'Test Free Caster'], exile: ['Raise the Alarm'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] },
  }), 'Raise the Alarm');
}

/** Pass priority until the stack is empty, answering nothing else; fails on any decision other than priority. */
function resolveAll(s: GameState): GameState {
  let t = s;
  for (let i = 0; i < 20 && t.zones.stack.length > 0; i++) {
    expect(t.pending?.kind ?? 'priority', JSON.stringify(t.pending)).toBe('priority');
    t = passBoth(t);
  }
  return t;
}

const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;

describe.skipIf(stubbed)('WP14 review: storm and casting during a resolution through the real interpreter', () => {
  it('CR 702.40a, 707.10: storm copies the spell once for each spell cast before it this turn (the copies are not cast)', () => {
    const one = resolveAll(drive(act(board2(), { type: 'cast', player: 'p1', card: find(board2(), 'Raise the Alarm', 'hand') }), []));
    expect(tokens(one)).toBe(2);
    const t = resolveAll(drive(act(one, { type: 'cast', player: 'p1', card: find(one, 'Test Storm Soldiers', 'hand') }), []));
    expect(tokens(t)).toBe(4); // the storm spell and its one copy
    expect(t.players[0]!.turnStats.spellsCast).toBe(2);
  });

  it('CR 608.2g: a card cast while an effect resolves goes on the stack, then resolves; none of its decisions can be cancelled', () => {
    const s = board2();
    let t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Free Caster', 'hand') }), []);
    t = passBoth(t); // Test Free Caster resolves: Raise the Alarm is cast from exile
    expect(t.pending?.cancellable).not.toBe(true);
    expect(t.zones.stack.map((id) => t.objects[id]!.defId)).toEqual(['Raise the Alarm']);
    t = resolveAll(t);
    expect(tokens(t)).toBe(2);
  });
});
