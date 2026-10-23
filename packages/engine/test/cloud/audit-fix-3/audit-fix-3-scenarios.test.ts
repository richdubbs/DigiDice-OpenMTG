/**
 * audit-fix-3 (stacked on audit-fix-2): suspend's "When the last is removed, they may PLAY it without paying its mana cost" (the current reminder text of
 * Taigam, Master Opportunist, Delay and Gandalf of the Secret Fire; CR 702.62a as revised, from memory, unverified): a modal double-faced card whose back face
 * is a land may be played as that land (CR 712.12, 305.9), and a land played this way gets no haste (it is not a creature spell). Synthetic cards, invented
 * names (design 6.10); each test is named after the rule it checks, with its negative case.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { answer, drive, lands, next, scenario } from '../../m6/dfc/support';

const MDFC = compileCard({
  name: 'Test Waking Grove // Test Sleeping Glade', layout: 'modal_dfc', mana_cost: '', type_line: 'Creature — Treefolk // Land', oracle_text: '', colors: [], keywords: [],
  card_faces: [
    { name: 'Test Waking Grove', mana_cost: '{4}{G}', type_line: 'Creature — Treefolk', oracle_text: 'Suspend 1—{G}', power: '4', toughness: '4' },
    { name: 'Test Sleeping Glade', mana_cost: '', type_line: 'Land', oracle_text: '{T}: Add {G}.' },
  ],
} as unknown as OracleCard) as CardDef;
const NAME = 'Test Waking Grove // Test Sleeping Glade';

/** Step forward (passing priority, declaring nothing) until `done` holds or a yes/no or option question is asked. */
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t) && t.pending?.kind !== 'yesNo' && t.pending?.kind !== 'chooseOption'; i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => upTo(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const settle = (s: GameState): GameState => upTo(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority');
const mine = (s: GameState): string | undefined => s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === NAME);
const hasKw = (s: GameState, id: string, kw: string): boolean => charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === kw);

/** p1 suspends the card from the hand; on p1's next upkeep the last time counter is removed and p1 is asked how to play it. */
function toPlay(landsOnBattlefield = 1): GameState {
  let s = scenario(['Forest'], { defs: [MDFC], p1: { hand: [NAME], battlefield: lands('Forest', landsOnBattlefield) } });
  const sp = legalActions(s, 'p1').find((a) => a.kind === 'special')!;
  const r = applyAction(s, sp.action);
  if (r.error) throw new Error(r.error.message);
  s = drive(r.state);
  return upTo(mainOf(s, 'p2'), () => false);
}

describe('CR 702.62a, 712.12, 305.9: when the last time counter is removed, its owner may PLAY the card', () => {
  it('the synthetic card is automated', () => expect(MDFC.automation.level).toBe('full'));
  it('a modal double-faced card with a land back face may be played as that land; the land gets no haste (not a creature spell)', () => {
    let s = toPlay();
    expect(s.pending?.kind).toBe('chooseOption');
    const ids = (s.pending as { options: { id: string }[] }).options.map((o) => o.id);
    expect(ids).toEqual(['land', 'cast']);
    s = settle(drive(answer(s, { kind: 'chooseOption', ids: ['land'] } as DecisionAnswer)));
    const id = mine(s)!;
    expect(id).toBeDefined();
    expect(charsOfObject(s, s.objects[id]!).types).toEqual(['Land']);
    expect(hasKw(s, id, 'haste')).toBe(false);
    expect(s.continuousEffects.some((e) => e.duration.d === 'whileObject')).toBe(false);
  });
  it('negative: choosing to cast it gives the creature face, cast with suspend, with haste', () => {
    let s = toPlay();
    s = settle(drive(answer(s, { kind: 'chooseOption', ids: ['cast'] } as DecisionAnswer)));
    const id = mine(s)!;
    expect(charsOfObject(s, s.objects[id]!).types).toContain('Creature');
    expect(hasKw(s, id, 'haste')).toBe(true);
  });
});
