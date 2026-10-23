/**
 * WP12 acceptance cards of design section 13 (design 15.2: "the section 13 cards that use them"). The spells (Lightning Bolt, Fireball, Fire // Ice, Rabid
 * Bite) are real fixture cards carrying the section 13 JSON, cast with real actions (WP7 announces the targets, X and the division) and resolved by the
 * WP10 stand-in of support.ts; the triggered abilities (Blood Artist, Flametongue Kavu, Mana Vault's draw-step trigger) are put on the stack by hand with
 * their targets and resolved by the same stand-in. Every step runs through the real handlers, with the WP11 pipeline faked by pipeline.ts (its performers
 * call rules/damage.ts#dealDamage and rules/life.ts exactly as design 8.5 says). The other section 13 cards that use a WP12 op also need an op of a
 * package that had not merged; WP31 moved those to test/m5/cards/wp31-spine.test.ts, which runs them end to end with the real neighbors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import type { DecisionAnswer, GameState } from '../../../src/index';
import { drive, objectTarget, playerTarget } from '../announce/support';
import { chosenObject, chosenPlayer, ctxOn, moveTo } from '../eval/helpers';
import { act, find, lifeOf, scenario, synth } from '../helpers';
import { pipeline } from './pipeline';
import { EXAMPLES } from '../model/examples';
import { resolveAbility, resolveTop, runOne, withExamples } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

/** Rabid Bite is not among the fixture cards: a synthetic sorcery with its cost and type, whose abilities withExamples fills in. */
const RABID_BITE = synth({ name: 'Rabid Bite', cost: '{1}{G}', type: 'Sorcery', abilities: [] });
/** Mana Vault is not among the fixture cards either: a synthetic artifact. */
const MANA_VAULT = synth({ name: 'Mana Vault', cost: '{1}', type: 'Artifact', abilities: [] });
const CARDS = ['Lightning Bolt', 'Fireball', 'Fire // Ice', 'Mountain', 'Forest', 'Grizzly Bears', 'Hill Giant', 'Craw Wurm', 'Garruk Wildspeaker', 'Blood Artist', 'Flametongue Kavu'];

function board(): GameState {
  return withExamples(scenario(CARDS, {
    p1: { hand: ['Lightning Bolt', 'Fireball', 'Fire // Ice', 'Rabid Bite'], battlefield: [...Array(6).fill('Mountain'), 'Forest', 'Craw Wurm', 'Blood Artist', 'Flametongue Kavu', { name: 'Mana Vault', tapped: true }] },
    p2: { battlefield: ['Grizzly Bears', 'Hill Giant', { name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] },
    defs: [RABID_BITE, MANA_VAULT],
  }), 'Lightning Bolt', 'Fireball', 'Fire // Ice', 'Rabid Bite', 'Blood Artist', 'Flametongue Kavu', 'Mana Vault');
}

function cast(s: GameState, name: string, answers: DecisionAnswer[], face?: number): GameState {
  const t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand'), ...(face !== undefined ? { face } : {}) }), answers);
  expect(t.pending?.kind, `${name} is on the stack with priority`).toBe('priority');
  return t;
}

/** The object leaves the battlefield before the spell resolves (in response), so it is an illegal target (CR 608.2b, 400.7). */
function bounce(s: GameState, id: string): GameState {
  const t = structuredClone(s);
  moveObject(new Game(t), id, 'hand', { cause: 'test: returned in response' });
  return t;
}

describe('Lightning Bolt: "~ deals 3 damage to any target." (CR 115.4, 120.3)', () => {
  it('CR 120.3e: 3 damage is marked on target creature; the spell is the source', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const t = cast(s, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [objectTarget(giant)] }]);
    const bolt = t.zones.stack[t.zones.stack.length - 1]!;
    const r = resolveTop(t);
    expect(r.state.objects[giant]!.damage).toBe(3);
    expect(r.results).toMatchObject([{ performed: true, count: 1 }]); // one recipient dealt damage (design 8.3)
    expect(pipeline.proposals).toEqual([{ ev: 'damage', source: { id: bolt, zone: 'stack' }, to: { id: giant, zone: 'battlefield' }, amount: 3, combat: false, unpreventable: false }]);
  });

  it('CR 120.3a: a player dealt 3 damage loses 3 life', () => {
    const t = cast(board(), 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [playerTarget('p2')] }]);
    expect(lifeOf(resolveTop(t).state, 'p2')).toBe(17);
  });

  it('CR 120.3c: damage to a planeswalker removes that many loyalty counters', () => {
    const s = board();
    const garruk = find(s, 'Garruk Wildspeaker', 'battlefield');
    const t = cast(s, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [objectTarget(garruk)] }]);
    expect(resolveTop(t).state.objects[garruk]!.counters['loyalty'] ?? 0).toBe(0); // 3 loyalty, 3 damage
  });

  it('CR 608.2b: its only target gone, Lightning Bolt does not resolve and deals no damage', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = resolveTop(bounce(cast(s, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]), bears));
    expect(r.resolved).toBe(false);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('Fireball: "~ deals X damage divided evenly, rounded down, among any number of targets." (pinned ruling 15.3 #1)', () => {
  const fireball = (s: GameState, x: number, targets: ReturnType<typeof objectTarget | typeof playerTarget>[]) =>
    cast(s, 'Fireball', [{ kind: 'chooseNumber', n: x }, { kind: 'chooseTargets', targets }]);

  it('X = 4 among a creature and a player: 2 damage each', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const r = resolveTop(fireball(s, 4, [objectTarget(giant), playerTarget('p2')]));
    expect(r.state.objects[giant]!.damage).toBe(2);
    expect(lifeOf(r.state, 'p2')).toBe(18);
    expect(r.results).toMatchObject([{ performed: true, count: 2 }]); // two recipients dealt damage
  });

  it('X = 4 among three targets is rounded down: 1 damage each, the remainder is not dealt', () => {
    const s = board();
    const [bears, giant] = [find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    // W2 merge: WP16's cost increase is real, so three targets cost {2} more (CR 601.2f): X = 4 uses all seven lands.
    const r = resolveTop(fireball(s, 4, [objectTarget(bears), objectTarget(giant), playerTarget('p2')]));
    expect([r.state.objects[bears]!.damage, r.state.objects[giant]!.damage, 20 - lifeOf(r.state, 'p2')]).toEqual([1, 1, 1]);
  });

  it('CR 608.2b, ruling 15.3 #1: the division involves only targets still legal as it resolves (the Gatherer ruling)', () => {
    const s = board();
    const [bears, giant] = [find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const t = bounce(fireball(s, 4, [objectTarget(bears), objectTarget(giant)]), bears);
    const r = resolveTop(t);
    expect(r.resolved).toBe(true);
    expect(r.state.objects[giant]!.damage).toBe(4); // 4 divided by ONE legal target, not by the two announced
    expect(pipeline.proposals.map((p) => p.ev === 'damage' && p.amount)).toEqual([4]);
  });

  it('more legal targets than X: none of them is dealt any damage (rounded down to 0, CR 120.8)', () => {
    const s = board();
    const [bears, giant] = [find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const r = resolveTop(fireball(s, 1, [objectTarget(bears), objectTarget(giant)]));
    expect(pipeline.proposals).toEqual([]);
    expect(r.results).toMatchObject([{ performed: false, count: 0 }]);
  });

  it('cast with zero targets it is not a targeted spell: it resolves and deals no damage', () => {
    const r = resolveTop(fireball(board(), 3, []));
    expect(r.resolved).toBe(true);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('Fire // Ice, Fire: "~ deals 2 damage divided as you choose among one or two targets." (CR 601.2d)', () => {
  const fire = (s: GameState, answers: DecisionAnswer[]) => cast(s, 'Fire // Ice', answers, 0);

  it('CR 601.2d: the division announced on casting is the division dealt', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = fire(s, [{ kind: 'chooseTargets', targets: [objectTarget(bears), playerTarget('p2')] }, { kind: 'chooseDivision', amounts: [1, 1] }]);
    expect(t.objects[t.zones.stack[t.zones.stack.length - 1]!]!.stack!.division).toEqual({ t0: [1, 1] });
    const r = resolveTop(t);
    expect(r.state.objects[bears]!.damage).toBe(1);
    expect(lifeOf(r.state, 'p2')).toBe(19);
  });

  it('one target gets all of it', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = resolveTop(fire(s, [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]));
    expect(r.state.objects[bears]!.damage).toBe(2);
  });

  it('CR 608.2b: the share of a target that became illegal is lost, not given to the other target', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = bounce(fire(s, [{ kind: 'chooseTargets', targets: [objectTarget(bears), playerTarget('p2')] }, { kind: 'chooseDivision', amounts: [1, 1] }]), bears);
    const r = resolveTop(t);
    expect(lifeOf(r.state, 'p2')).toBe(19);
    expect(r.results).toMatchObject([{ performed: true, count: 1 }]);
    expect(r.state.log.some((l) => l.rules?.includes('CR 601.2d') && /divided as announced/.test(l.text))).toBe(true);
  });
});

describe('Rabid Bite: "Target creature you control deals damage equal to its power to target creature you don\'t control." (design 13.1)', () => {
  it('the source is a TARGET creature, not the spell: Craw Wurm deals 6 to Hill Giant', () => {
    const s = board();
    const [wurm, giant] = [find(s, 'Craw Wurm', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const r = resolveTop(cast(s, 'Rabid Bite', [{ kind: 'chooseTargets', targets: [objectTarget(wurm)] }, { kind: 'chooseTargets', targets: [objectTarget(giant)] }]));
    expect(r.state.objects[giant]!.damage).toBe(6);
    expect(pipeline.proposals[0]).toMatchObject({ ev: 'damage', source: { id: wurm, zone: 'battlefield' }, amount: 6 });
  });

  it('CR 608.2b: if the creature that would deal the damage is gone, its power fails to determine and no damage is dealt', () => {
    const s = board();
    const [wurm, giant] = [find(s, 'Craw Wurm', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const t = bounce(cast(s, 'Rabid Bite', [{ kind: 'chooseTargets', targets: [objectTarget(wurm)] }, { kind: 'chooseTargets', targets: [objectTarget(giant)] }]), wurm);
    const r = resolveTop(t);
    expect(r.resolved).toBe(true); // one target is still legal
    expect(r.state.objects[giant]!.damage).toBe(0);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('Blood Artist: "Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life." (design 13)', () => {
  it('CR 119.3: target player loses 1 life and you gain 1 life', () => {
    const r = resolveAbility(board(), 'triggered', { name: 'Blood Artist', targets: [[chosenPlayer('p2')]] });
    expect([lifeOf(r.state, 'p1'), lifeOf(r.state, 'p2')]).toEqual([21, 19]);
    expect(r.results).toMatchObject([{ performed: true, count: 1 }, { performed: true, count: 1 }]);
    expect(pipeline.proposals).toEqual([{ ev: 'life', change: 'loss', player: 'p2', amount: 1 }, { ev: 'life', change: 'gain', player: 'p1', amount: 1 }]);
  });

  it('CR 603.10a, 113.7a: when Blood Artist itself died, its ability still resolves and "you" is its controller', () => {
    const s = board();
    const artist = find(s, 'Blood Artist', 'battlefield');
    moveTo(ctxOn(s, artist), artist, 'graveyard');
    const r = resolveAbility(s, 'triggered', { name: 'Blood Artist', sourceId: artist, targets: [[chosenPlayer('p2')]] });
    expect([lifeOf(r.state, 'p1'), lifeOf(r.state, 'p2')]).toEqual([21, 19]);
  });
});

describe('Flametongue Kavu: "When this creature enters, it deals 4 damage to target creature." (design 13)', () => {
  it('CR 120.3e, 113.7a: 4 damage to target creature, dealt by the Kavu (the source of the ability)', () => {
    const s = board();
    const [kavu, giant] = [find(s, 'Flametongue Kavu', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const r = resolveAbility(s, 'triggered', { name: 'Flametongue Kavu', targets: [[chosenObject(giant)]] });
    expect(r.state.objects[giant]!.damage).toBe(4);
    expect(pipeline.proposals).toEqual([expect.objectContaining({ ev: 'damage', source: { id: kavu, zone: 'battlefield' }, amount: 4 })]);
  });

  it('CR 608.2h, 113.7a: if the Kavu has left the battlefield, it still deals the damage, using its last known information', () => {
    const s = board();
    const [kavu, giant] = [find(s, 'Flametongue Kavu', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    moveTo(ctxOn(s, kavu), kavu, 'hand');
    const r = resolveAbility(s, 'triggered', { name: 'Flametongue Kavu', sourceId: kavu, targets: [[chosenObject(giant)]] });
    expect(r.state.objects[giant]!.damage).toBe(4);
    expect(r.state.log.some((l) => /Flametongue Kavu deals 4 damage to Hill Giant/.test(l.text))).toBe(true);
  });

  it('CR 608.2b: its only target gone, the ability does not resolve', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    moveTo(ctxOn(s, giant), giant, 'hand');
    expect(resolveAbility(s, 'triggered', { name: 'Flametongue Kavu', targets: [[chosenObject(giant)]] }).resolved).toBe(false);
    expect(pipeline.proposals).toEqual([]);
  });
});

describe('Mana Vault: "At the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you." (design 13)', () => {
  it('CR 120.3a: it deals 1 damage to its controller (the intervening "if" is WP10\'s, CR 603.4)', () => {
    const s = board();
    const vault = find(s, 'Mana Vault', 'battlefield');
    const r = resolveAbility(s, 'triggered', { name: 'Mana Vault' }, 1); // its second triggered ability: the first is the upkeep "you may pay {4}" (WP10)
    expect(lifeOf(r.state, 'p1')).toBe(19);
    expect(pipeline.proposals).toEqual([{ ev: 'damage', source: { id: vault, zone: 'battlefield' }, to: 'p1', amount: 1, combat: false, unpreventable: false }]);
  });
});

describe('section 13 cards whose effects also need an op of a package that has not merged (design 15.2)', () => {
  it('design 8.10 #2, CR 608.2h (Swords to Plowshares, its gainLife step after the exile): life equal to its power on the battlefield, counter included', () => {
    const s = withExamples(scenario(['Swords to Plowshares', 'Plains', 'Grizzly Bears'], {
      p1: { hand: ['Swords to Plowshares'], battlefield: ['Plains'] },
      p2: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 1 } }] },
    }), 'Swords to Plowshares');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = cast(s, 'Swords to Plowshares', [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]);
    const spell = EXAMPLES.find((e) => e.name === 'Swords to Plowshares')!.faces[0]!.abilities[0]!;
    if (spell.kind !== 'spell') throw new Error('Swords to Plowshares is a spell');
    const cx = ctxOn(t, t.zones.stack[t.zones.stack.length - 1]!, spell.effect);
    moveTo(cx, bears, 'exile'); // what the move step (WP14) does
    expect(runOne(cx, spell.effect.steps[1]!)).toMatchObject({ performed: true, count: 1 });
    expect(lifeOf(t, 'p2')).toBe(23); // a 2/2 with a +1/+1 counter had power 3
  });
  // WP31: Swords to Plowshares as a whole, Magma Spray (with its manual reminder), Sword of Fire and Ice and Paradise Plume's "may gain 1 life" run end
  // to end through applyAction, the real spine and the real pipeline in test/m5/cards/wp31-spine.test.ts (this file fakes the pipeline, so it
  // can't hold them).
});
