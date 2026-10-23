/**
 * C10 on the wave-2 line: Exploration Broodship reads in full once "a permanent spell" is a filter (lines C and D). Its station 8+ ability grants
 * "Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs":
 * offered only at 8 charge counters, the land is sacrificed as an additional cost (CR 601.2f, 118.8), and the once-each-turn use is spent (CR 601.3).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, find, scenario } from '../../m5/helpers';
import { drive, resolveTop } from '../../m5/cr-examples/helpers';
import { localIndex } from '../../m5/parser/support';

const index = localIndex();
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
describe('C10 (local index): Exploration Broodship', () => {
  it.skipIf(index === null)('Broodship at 8 offers one permanent spell a turn from the graveyard for a land sacrifice', () => {
    const def = compileCard(index!.find((c) => c.name === 'Exploration Broodship')!);
    const board = (charge: number): GameState => scenario(['Grizzly Bears', 'Forest'], { p1: { battlefield: [{ name: 'Exploration Broodship', counters: { charge } } as unknown as string, 'Forest', 'Forest', 'Forest', 'Forest'], graveyard: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [def] });
    const gy = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard').map((a) => a.label);
    expect(gy(board(7))).toEqual([]);
    let s = board(8);
    expect(gy(s).length).toBe(2);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'graveyard', 'p1') }));
    while (s.pending && s.pending.kind !== 'priority') {
      const d = s.pending as unknown as { kind: string; options?: unknown[]; min?: number };
      if (d.kind === 'chooseObjects') s = act(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, d.min ?? 1) } });
      else s = drive(s);
    }
    s = resolveTop(s);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Forest').length).toBe(3);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Grizzly Bears')).toBe(true);
    expect(gy(s)).toEqual([]);
  });
});
