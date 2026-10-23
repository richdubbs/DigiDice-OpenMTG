/**
 * WP13 against its real neighbors (design 15.1.7). Every other WP13 test replaces the proposal pipeline with a fake (./fakes.ts) and the spine with a harness
 * (./harness.ts). This file does NOT mock `effects/propose`: its tests are skipped while WP11's `propose` is a stub and run by themselves as soon as WP11
 * merges, so the merge checks what the fakes only assume (the real performer must hand `cause` to moveObject, WP13 INTERFACE CHANGE #1, or discard
 * triggers and madness would never match). The checks that need WP10's spine are listed as todos named by rule and package.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../../../src/core/game';
import { propose } from '../../../src/effects/propose';
import { resolveStackObject } from '../../../src/effects/run';
import type { GameEvent } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { scenario } from '../helpers';
import { hand, onStack, prog, runOn, sorcery } from './harness';

const SPELL = 'Test Pipeline Spell';
const s0 = scenario(['Island', 'Forest', 'Mountain', 'Grizzly Bears'], { p1: { library: ['Island', 'Forest', 'Mountain'], hand: ['Grizzly Bears'] }, defs: [sorcery(SPELL, prog([]))] });
const you = { ref: 'you' } as const;

/** Whether calling `f` hits a WP0 stub (`not implemented: WPn`). */
function stubbed(f: () => unknown): boolean {
  try {
    f();
    return false;
  } catch (e) {
    return e instanceof Error && e.message.startsWith('not implemented');
  }
}

const proposeIsStub = stubbed(() => propose(new Game(clone(s0)), { ev: 'draw', player: 'p1' }));
const zoneChanges = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { type: 'zoneChanged' }> => e.type === 'zoneChanged');

describe.skipIf(proposeIsStub)('with the real proposal pipeline and performers (WP11)', () => {
  it('CR 701.9a (WP11): the real perform carries cause "discard" onto zoneChanged', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'discard', who: you, count: 1 }]));
    expect(zoneChanges(out.events).map((e) => [e.from, e.to, e.cause])).toEqual([['hand', 'graveyard', 'discard']]);
  });

  it('CR 701.17a (WP11): the real perform carries cause "mill" onto zoneChanged', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'mill', who: you, count: 2 }]));
    expect(zoneChanges(out.events).map((e) => e.cause)).toEqual(['mill', 'mill']);
  });

  it('CR 701.25a (WP11): the real perform carries cause "surveil" onto zoneChanged', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const top = s.zones.library.p1![0]!;
    const out = runOn(s, id, prog([{ op: 'surveil', who: you, count: 1 }]), [{ kind: 'chooseObjects', ids: [top] }]);
    expect(zoneChanges(out.events).map((e) => e.cause)).toEqual(['surveil']);
  });

  it('CR 121.2 (WP11): each draw goes through the real pipeline and is a draw', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: 2 }]));
    expect(out.events.filter((e) => e.type === 'drew')).toHaveLength(2);
    expect(hand(out.s, 'p1')).toHaveLength(3);
  });
});

describe('through the real spine (WP10)', () => {
  // WP31 settled the four placeholders that stood here:
  //  - CR 608.2c, Fact or Fiction through resolveStackObject and WP14's move: test/m5/cards/wp31-spine.test.ts.
  //  - CR 605.3b, an activated mana ability resolved through addMana emits manaAdded with viaActivation (Paradise Plume tapped for mana):
  //    wp31-spine.test.ts. Before WP31 a mana ability decided as it resolves (`dynamic`) paid its costs and added NOTHING through the activation path;
  //    rules/mana.ts now runs its effect through the handlers (effects/mana-ability.ts).
  //  - CR 605.1b, 605.4a, a triggered mana ability adds mana that records its source and is not an activation: WP32 implements it,
  //    test/m5/triggers/wp32-mana-trigger.test.ts.
  //  - design 15.1.7, "every scenario passes again without ./harness.ts and ./fakes.ts": deleted. The harness scenarios stay unit tests of the handlers;
  //    the real-neighbor runs are the tests above (the pipeline) and wp31-spine.test.ts (the spine, end to end through applyAction).
  it('WP31: the real spine is in place (resolveStackObject is no stub)', () => {
    expect(stubbed(() => resolveStackObject(undefined as never, undefined as never))).toBe(false);
  });
});
