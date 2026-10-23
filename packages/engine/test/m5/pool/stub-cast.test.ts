/**
 * WP24 review: a stub (contract C4) is never cast by the engine, not even by a "cast it without paying its mana cost" step while an effect resolves: its
 * characteristics are unknown, so the real card may be a land (CR 305.9: it can't be cast) or a permanent (CR 608.3: it would enter the battlefield).
 * Moving it is the players' job.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/index';
import { stubCardDef } from '../../../src/cards/pool';
import type { EffectProgram, EffectStep } from '../../../src/index';
import { find, scenario } from '../helpers';
import { pipeline } from '../zones/pipeline';
import { runProgram } from '../zones/support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const STUB = stubCardDef('Glimmerwing Of The New Set', 'decklist');
const prog = (steps: EffectStep[]): EffectProgram => ({ targets: [], steps });
const castFree = (name: string): EffectStep => ({ op: 'cast', who: { ref: 'you' }, what: { ref: 'each', filter: { zone: 'exile', name } }, free: true, as: 'spell' }) as EffectStep;

describe('WP24 review: a stub is never cast (contract C4)', () => {
  it('CR 118.6a, 305.9, 608.3: "cast it without paying its mana cost" does nothing for a stub; it stays where it is', () => {
    const s = scenario(['Twincast'], { defs: [STUB], p1: { hand: ['Twincast'], exile: [STUB.id] } });
    const stub = find(s, STUB.name, 'exile', 'p1');
    const r = runProgram(s, { name: 'Twincast' }, prog([castFree(STUB.name)]));
    expect(r.results[0]).toMatchObject({ performed: false });
    expect(r.state.zones.stack.some((id) => r.state.objects[id]!.defId === STUB.id)).toBe(false);
    expect(r.state.objects[stub]!.zone).toBe('exile');
  });
});
