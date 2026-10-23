/**
 * WP14: the `cast` op (CR 701.5, 608.2g, 400.7h): a card is cast while an effect resolves, following CR 601.2a-i, through actions/cast.ts (reached by
 * effects/cast-hook.ts). Importing the engine index loads actions/cast.ts, which installs the caster.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/index';
import type { EffectProgram, EffectStep, GameState } from '../../../src/index';
import { find, scenario } from '../helpers';
import { pipeline } from '../zones/pipeline';
import { decisionOf, runProgram, withExamples } from '../zones/support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const prog = (steps: EffectStep[]): EffectProgram => ({ targets: [], steps });
const castFromExile = (name: string, over: Partial<Extract<EffectStep, { op: 'cast' }>> = {}): EffectStep =>
  ({ op: 'cast', who: { ref: 'you' }, what: { ref: 'each', filter: { zone: 'exile', name } }, free: true, as: 'spell', ...over }) as EffectStep;

function board(): GameState {
  return scenario(['Twincast', 'Wrath of God', 'Lightning Bolt', 'Doom Blade', 'Grizzly Bears', 'Mountain', 'Forest'], {
    p1: { hand: ['Twincast'], exile: ['Wrath of God', 'Lightning Bolt', 'Doom Blade', 'Forest'], battlefield: ['Mountain'] },
    p2: { battlefield: ['Grizzly Bears'] },
  });
}

describe('cast during a resolution (CR 608.2g)', () => {
  it('CR 608.2g, 118.9: a sorcery cast without paying its mana cost while a spell resolves: timing is ignored, it becomes the topmost object; the binding follows it (CR 400.7h)', () => {
    const s = board();
    const wrath = find(s, 'Wrath of God', 'exile');
    const r = runProgram(s, { name: 'Twincast' }, prog([castFromExile('Wrath of God')]));
    expect(r.results[0]).toEqual({ performed: true, count: 1 });
    const top = r.state.zones.stack[r.state.zones.stack.length - 1]!;
    expect(r.state.objects[top]!.defId).toBe('Wrath of God');
    expect(r.state.lki[wrath]!.newId).toBe(top);
    expect(r.state.objects[top]!.stack!.castFrom).toBe('exile');
    expect(r.cx.g.events.some((e) => e.type === 'spellCast' && e.objectId === top)).toBe(true); // it is cast (storm and "whenever you cast" see it)
    expect(r.cx.bindings.get('spell')!.objects).toEqual([{ id: top, zone: 'stack' }]);
    expect(r.state.log.some((l) => /casts Wrath of God without paying its mana cost while an effect resolves/.test(l.text))).toBe(true);
    expect(r.state.players[0]!.turnStats.spellsCast).toBe(1);
  });

  it('CR 601.2c: its targets are announced as it is cast (Lightning Bolt with its section 13 ability)', () => {
    const s = withExamples(board(), 'Lightning Bolt');
    const d = decisionOf(() => runProgram(s, { name: 'Twincast' }, prog([castFromExile('Lightning Bolt')])));
    expect(d.kind).toBe('chooseTargets');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = runProgram(s, { name: 'Twincast' }, prog([castFromExile('Lightning Bolt')]), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }]);
    const top = r.state.objects[r.state.zones.stack[r.state.zones.stack.length - 1]!]!;
    expect(top.stack!.targets).toEqual([[{ kind: 'object', id: bears }]]);
    expect(r.cx.g.events).toContainEqual({ type: 'becameTarget', objectId: bears, byStackId: top.id, byController: 'p1' });
  });

  it('CR 608.2d, 707.12a: "you may cast": the player decides, and declining casts nothing', () => {
    const s = board();
    const step = castFromExile('Wrath of God', { optional: true });
    const d = decisionOf(() => runProgram(s, { name: 'Twincast' }, prog([step])));
    expect(d.kind).toBe('yesNo');
    const r = runProgram(s, { name: 'Twincast' }, prog([step]), [{ kind: 'yesNo', yes: false }]);
    expect(r.results[0]!.performed).toBe(false);
    expect(r.state.zones.exile).toContain(find(s, 'Wrath of God', 'exile'));
  });

  it('CR 601.2a, 305.1: a land can\'t be cast; nothing happens and it is logged', () => {
    const s = board();
    const r = runProgram(s, { name: 'Twincast' }, prog([castFromExile('Forest')]));
    expect(r.results[0]!.performed).toBe(false);
    expect(r.state.log.some((l) => /can't cast Forest/.test(l.text) && l.rules?.includes('CR 608.2g'))).toBe(true);
  });

  it('CR 601.2g-h: without "free" the mana cost is paid as usual', () => {
    const s = withExamples(board(), 'Lightning Bolt');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const pick = { kind: 'chooseTargets' as const, targets: [{ kind: 'object' as const, id: bears }] };
    const d = decisionOf(() => runProgram(s, { name: 'Twincast' }, prog([castFromExile('Lightning Bolt', { free: false })]), [pick]));
    expect([d.kind, (d as { costText?: string }).costText]).toEqual(['payCost', '{R}']);
    const r = runProgram(s, { name: 'Twincast' }, prog([castFromExile('Lightning Bolt', { free: false })]), [pick, { kind: 'payCost', auto: true }]);
    expect(r.state.objects[find(s, 'Mountain', 'battlefield')]!.tapped).toBe(true);
    expect(r.results[0]!.performed).toBe(true);
  });

  it('CR 601.2f: a changed cost other than "free" is resolved by hand', () => {
    const s = board();
    runProgram(s, { name: 'Twincast' }, prog([castFromExile('Wrath of God', { costChange: { kind: 'reduce', generic: 2 } })]));
    expect(pipeline.manual).toHaveLength(1);
  });
});
