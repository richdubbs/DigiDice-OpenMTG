/**
 * WP14 adds the emitters of `countered`, `abilityCountered`, `attached`, `transformed` and `spellCopied` (design 4.1). The trigger normalizer (WP8) turns them into
 * the semantic events trigger patterns match, so the finer forms `feature:ev.action.counter`, `feature:ev.becomes.attached|unattached|transformed` and
 * `feature:ev.cast.orCopy` are capabilities now (triggers/forms.ts). These tests run the handlers and match the patterns against what they emitted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectProgram, EffectStep, EventPattern, GameState, TargetSpec } from '../../../src/index';
import type { SemEvent } from '../../../src/types/state';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { matchEvent } from '../../../src/triggers/match';
import { normalize } from '../../../src/triggers/normalize';
import { chosenObject } from '../eval/helpers';
import { find, scenario } from '../helpers';
import { pipeline } from './pipeline';
import { putOnStack, runProgram } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });

function board(): GameState {
  return scenario(['Lightning Bolt', 'Counterspell', 'Grizzly Bears', 'Hill Giant', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration'], {
    p1: { battlefield: ['Hill Giant', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration'] },
    p2: { battlefield: ['Grizzly Bears'] },
  });
}

/** Run a program and normalize everything it emitted as one batch (design 3.5). */
function semEvents(s: GameState, spec: Parameters<typeof runProgram>[1], program: EffectProgram): { sem: SemEvent[]; r: ReturnType<typeof runProgram> } {
  const r = runProgram(s, spec, program);
  return { sem: normalize(r.cx.g, r.cx.g.events, 1), r };
}

const matches = (sem: SemEvent[], p: EventPattern, r: ReturnType<typeof runProgram>, source: string): boolean =>
  sem.some((e) => matchEvent(p, e, { g: r.cx.g, source, controller: 'p1', lookBack: false }));

describe('the events WP14 emits are seen by trigger patterns (CR 603.2)', () => {
  it('CR 701.6a: "whenever a spell is countered" sees a `counter` action; the capability is advertised', () => {
    const s = structuredClone(board());
    const bolt = putOnStack(s, { name: 'Lightning Bolt', owner: 'p2' });
    const spell: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
    const { sem, r } = semEvents(s, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' } }], [spell]));
    expect(sem.some((e) => e.ev === 'action' && e.data['verb'] === 'counter')).toBe(true);
    expect(matches(sem, { ev: 'action', verb: 'counter' }, r, find(s, 'Hill Giant', 'battlefield'))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.counter')).toBe(true);
  });

  it('CR 701.3a: "whenever an Equipment becomes attached" sees the attach; unattaching is `unattached`', () => {
    const s = board();
    const eq = find(s, 'Bonesplitter', 'battlefield');
    const { sem, r } = semEvents(s, { name: 'Bonesplitter', kind: 'activated', sourceId: eq }, prog([
      { op: 'attach', what: { ref: 'self' }, to: { ref: 'each', filter: { name: 'Hill Giant' } } },
      { op: 'attach', what: { ref: 'self' }, to: null },
    ]));
    expect(matches(sem, { ev: 'becomes', what: 'attached', object: { name: 'Bonesplitter' } }, r, eq)).toBe(true);
    expect(matches(sem, { ev: 'becomes', what: 'unattached', object: { name: 'Bonesplitter' } }, r, eq)).toBe(true);
  });

  it('CR 701.27a: "whenever this creature transforms" sees the transformation', () => {
    const s = board();
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    const { sem, r } = semEvents(s, { name: 'Lightning Bolt' }, prog([{ op: 'changeFace', what: { ref: 'each', filter: { name: 'Delver of Secrets' } }, to: 'transform' }]));
    expect(matches(sem, { ev: 'becomes', what: 'transformed', object: { self: true } }, r, delver)).toBe(true);
  });

  it('CR 707.10: a copy of a spell is not cast; "whenever you cast or copy" (`orCopy`) sees it, "whenever you cast" doesn\'t', () => {
    const s = structuredClone(board());
    const bolt = putOnStack(s, { name: 'Lightning Bolt', owner: 'p2' });
    const spell: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
    const { sem, r } = semEvents(s, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [spell]));
    const watcher = find(s, 'Hill Giant', 'battlefield');
    expect(matches(sem, { ev: 'cast', player: 'you', orCopy: true }, r, watcher)).toBe(true);
    expect(matches(sem, { ev: 'cast', player: 'you' }, r, watcher)).toBe(false);
  });

  it('CR 111.1: tokens created by the handler are `createToken` events', () => {
    const s = board();
    const { sem } = semEvents(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 2, token: { name: 'Soldier', types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1 } }]));
    expect(sem.filter((e) => e.ev === 'createToken')).toHaveLength(2);
  });
});
