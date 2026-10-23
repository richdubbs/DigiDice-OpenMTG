/**
 * WP12 with its real neighbors (design 15.1 rule 7): the section 13 cards resolved by `applyAction` through WP10's `resolveStackObject` and WP11's
 * pipeline and performers. While either neighbor is still a stub these tests are skipped (the other WP12 tests fake them); they run by themselves once
 * WP10 and WP11 have merged, and must then pass unchanged.
 *
 * MERGE PRECONDITION: m5/wp12 advertises op:damage, op:fight, op:gainLife, op:loseLife, op:setLife, op:putCounters, op:removeCounters and
 * op:moveCounters, and every one of those handlers acts only through `propose` (WP11) and `askManual` (WP10). It must not merge before both WP10 and WP11
 * are on main (design 15.1 rule 7, STATUS.md "WP12-WP15 merge after WP10 and WP11"). The tripwire at the end of this file fails at that merge on purpose:
 * the integrator removes it after checking that the suite above it ran (it is no longer skipped) and passed unchanged.
 */
import { describe, expect, it } from 'vitest';
import { forbidden, propose } from '../../../src/effects/propose';
import { resolveStackObject } from '../../../src/effects/run';
import type { DecisionAnswer, GameState } from '../../../src/index';
import { drive, objectTarget, playerTarget } from '../announce/support';
import { act, advanceTo, find, inGraveyard, lifeOf, onBattlefield, passBoth, scenario, synth } from '../helpers';
import { EXAMPLES } from '../model/examples';
import { withExamples } from './support';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';

const isStub = (f: () => unknown, wp: string): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    return String(e).includes(`not implemented: ${wp}`);
  }
};
const stubbed = isStub(() => propose(undefined as never, undefined as never), 'WP11') || isStub(() => resolveStackObject(undefined as never, undefined as never), 'WP10');

/** Mana Vault (not a fixture card) with only its draw-step trigger: its upkeep "you may pay {4}" and its static ability are other packages' (WP10, WP16). */
const MANA_VAULT = synth({ name: 'Mana Vault', cost: '{1}', type: 'Artifact', abilities: [] });

function board(): GameState {
  const s = withExamples(scenario(['Lightning Bolt', 'Fireball', 'Fire // Ice', 'Mountain', 'Grizzly Bears', 'Hill Giant', 'Blood Artist', 'Flametongue Kavu'], {
    p1: { hand: ['Lightning Bolt', 'Fireball', 'Fire // Ice', 'Flametongue Kavu'], battlefield: [...Array(6).fill('Mountain'), 'Blood Artist', 'Mana Vault'] },
    p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] },
    defs: [MANA_VAULT],
  }), 'Lightning Bolt', 'Fireball', 'Fire // Ice', 'Blood Artist', 'Flametongue Kavu');
  const drawTrigger = EXAMPLES.find((e) => e.name === 'Mana Vault')!.faces[0]!.abilities.filter((a) => a.kind === 'triggered')[1]!;
  const vault = Object.keys(s.defs).find((k) => s.defs[k]!.name === 'Mana Vault')!;
  s.defs = { ...s.defs, [vault]: { ...s.defs[vault]!, faces: s.defs[vault]!.faces.map((f) => ({ ...f, abilities: [drawTrigger] })) } };
  return s;
}

const castAndResolve = (s: GameState, name: string, answers: DecisionAnswer[], face?: number): GameState =>
  passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand'), ...(face !== undefined ? { face } : {}) }), answers));

/** The object leaves the battlefield while the spell is on the stack (in response), so it is an illegal target (CR 608.2b, 400.7). */
function bounce(s: GameState, id: string): GameState {
  const t = structuredClone(s);
  moveObject(new Game(t), id, 'hand', { cause: 'test: returned in response' });
  return t;
}

describe.skipIf(stubbed)('WP12 through the real interpreter and pipeline (enabled when WP10 and WP11 merge)', () => {
  it('CR 120.3e, 704.5g: Lightning Bolt kills a 3-toughness creature and goes to the graveyard (CR 608.2n)', () => {
    const s = board();
    const t = castAndResolve(s, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield'))] }]);
    expect(onBattlefield(t, 'Hill Giant')).toBe(false);
    expect(inGraveyard(t, 'Hill Giant', 'p2')).toBe(true);
    expect(inGraveyard(t, 'Lightning Bolt', 'p1')).toBe(true);
  });

  it('Fireball X = 4 among a creature and a player deals 2 to each', () => {
    const s = board();
    const t = castAndResolve(s, 'Fireball', [{ kind: 'chooseNumber', n: 4 }, { kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield')), playerTarget('p2')] }]);
    expect(onBattlefield(t, 'Grizzly Bears')).toBe(false);
    expect(lifeOf(t, 'p2')).toBe(18);
  });

  it('pinned ruling 15.3 #1, CR 608.2b: Fireball X = 4 at two creatures, one gone in response: all 4 damage to the one still legal', () => {
    const s = board();
    const [bears, giant] = [find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const cast = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Fireball', 'hand') }), [{ kind: 'chooseNumber', n: 4 }, { kind: 'chooseTargets', targets: [objectTarget(bears), objectTarget(giant)] }]);
    const t = passBoth(bounce(cast, bears));
    expect(inGraveyard(t, 'Hill Giant', 'p2')).toBe(true); // 4 damage, not 2: the division involves only the targets still legal
  });

  it('CR 601.2d: Fire divided 1 and 1 between a creature and a player', () => {
    const s = board();
    const t = castAndResolve(s, 'Fire // Ice', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield')), playerTarget('p2')] }, { kind: 'chooseDivision', amounts: [1, 1] }], 0);
    expect(t.objects[find(t, 'Hill Giant', 'battlefield')]!.damage).toBe(1);
    expect(lifeOf(t, 'p2')).toBe(19);
  });

  it('CR 603.10a, 119.3: Blood Artist: a creature dies, target player loses 1 life and you gain 1 life', () => {
    const s = board();
    const killed = castAndResolve(s, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    const t = passBoth(drive(killed, [{ kind: 'chooseTargets', targets: [playerTarget('p2')] }]));
    expect([lifeOf(t, 'p1'), lifeOf(t, 'p2')]).toEqual([21, 19]);
  });

  it('CR 603.6a, 120.3e: Flametongue Kavu enters and deals 4 damage to target creature', () => {
    const s = board();
    const entered = castAndResolve(s, 'Flametongue Kavu', []);
    const t = passBoth(drive(entered, [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield'))] }]));
    expect(inGraveyard(t, 'Hill Giant', 'p2')).toBe(true);
  });

  it('CR 603.4, 120.3a: Mana Vault, tapped at the beginning of your draw step, deals 1 damage to you', () => {
    const upkeep = advanceTo(board(), 3, 'upkeep');
    upkeep.objects[find(upkeep, 'Mana Vault', 'battlefield')]!.tapped = true;
    const t = passBoth(advanceTo(upkeep, 3, 'draw'));
    expect(lifeOf(t, 'p1')).toBe(19);
  });
});

describe('the neighbors WP12 waits for (design 15.1 rule 7)', () => {
  it('forbidden is the WP11 stub until WP11 merges (INTERFACE CHANGE of WP12: effects/propose.ts#forbidden, CR 122.5, 614.17)', () => {
    expect(isStub(() => forbidden(undefined as never, undefined as never), 'WP11')).toBe(isStub(() => propose(undefined as never, undefined as never), 'WP11'));
  });
});
