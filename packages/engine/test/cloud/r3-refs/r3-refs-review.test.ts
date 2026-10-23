/**
 * Merge wave 6, line refs: the independent rules review's fixes of PR #48 (r3-refs), each played through applyAction with a synthetic card (invented wordings).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const lifeOf = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;

describe('CR 603.2, 603.6a, 400.7: a permanent that entered and left again within one resolution triggered on its own entering each time', () => {
  const ROUND = card('Test Round', 'Sorcery', "Exile any number of creatures you control, then return them to the battlefield under their owner's control. Then repeat this process X more times.", undefined, '{X}');
  const HERALD = card('Test Herald', 'Creature — Human', 'When this creature enters, you gain 1 life.', ['1', '1']);
  const FOREST = card('Test Forest', 'Basic Land — Forest', '({T}: Add {G}.)');
  it('with X = 2 and the Herald chosen each time, its enters ability triggers three times (one per object that entered)', () => {
    let s = scenario([], { p1: { hand: ['Test Round'], battlefield: ['Test Herald', 'Test Forest', 'Test Forest'] }, defs: [ROUND, HERALD, FOREST] });
    const life = lifeOf(s);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Round', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'priority'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : answer(s, { kind: 'chooseNumber', n: 2 });
    s = pass(pass(s));
    for (let i = 0; i < 3; i++) {
      expect(s.pending?.kind).toBe('chooseObjects');
      s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Herald', 'battlefield', 'p1')] });
    }
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || s.pending?.kind === 'order'); g++) {
      s = s.pending?.kind === 'order' ? answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) }) : pass(pass(s));
    }
    const triggered = (s.log as unknown as { text?: string }[]).filter((l) => /Test Herald triggers/.test(l.text ?? '')).length;
    expect(triggered).toBe(3);
    expect(lifeOf(s)).toBe(life + 3);
    expect(findAll(s, 'Test Herald', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('a creature returned once by one resolution still triggers once (no change)', () => {
    let s = scenario([], { p1: { hand: ['Test Round'], battlefield: ['Test Herald', 'Test Forest'] }, defs: [ROUND, HERALD, FOREST] });
    const life = lifeOf(s);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Round', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'priority'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : answer(s, { kind: 'chooseNumber', n: 0 });
    s = pass(pass(s));
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Herald', 'battlefield', 'p1')] });
    for (let g = 0; g < 20 && s.zones.stack.length > 0; g++) s = pass(pass(s));
    expect(lifeOf(s)).toBe(life + 1);
  });
});
