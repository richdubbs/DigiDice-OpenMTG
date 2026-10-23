/**
 * M6-12: madness (CR 702.35) as keyword data over the replacement loop (m6 design 3.2, "Keyword data that uses the loop"), with the cast op's changed cost
 * `op:cast.costChange` (an alternative cost paid while the madness trigger resolves, CR 118.9, 601.2b, 601.2f-h). Real fixture cards on the game path:
 * Fiery Temper ("Fiery Temper deals 3 damage to any target. Madness {R}") discarded by Faithless Looting ("Draw two cards, then discard two cards.").
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, compileCard, ENGINE_CAPABILITIES, type GameState } from '../../../src/index';
import { getCard } from '../../fixtures';
import { answer, find, scenario } from '../../m5/helpers';
import { cast, resolveTop, stackNames, target } from '../../m5/cr-examples/helpers';
import { lifeOf, logHas } from '../../m4/helpers';

const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const graveyard = (s: GameState): string[] => names(s, s.zones.graveyard.p1!);
const exile = (s: GameState): string[] => names(s, s.zones.exile);

/** Cast Faithless Looting and discard Fiery Temper and a Plains with it (CR 701.9a): Fiery Temper's madness applies. */
function loot(s0: GameState, answers: Parameters<typeof answer>[1][] = []): GameState {
  let s = resolveTop(cast(s0, 'Faithless Looting'));
  const temper = find(s, 'Fiery Temper', 'hand');
  const other = s.pending!.kind === 'chooseObjects' ? s.pending!.options.find((x) => x !== temper)! : '';
  s = answer(s, { kind: 'chooseObjects', ids: [temper, other] });
  for (const a of answers) s = answer(s, a);
  return s;
}

const board = (mountains: number, p2: string[] = []): GameState =>
  scenario(['Faithless Looting', 'Fiery Temper', 'Mountain', 'Leyline of the Void'], {
    p1: { hand: ['Faithless Looting', 'Fiery Temper'], battlefield: Array(mountains).fill('Mountain') as string[] },
    p2: { battlefield: p2 },
  });

describe('CR 702.35: madness', () => {
  it('keyword:madness and op:cast.costChange are capabilities, and Fiery Temper (game path) is full', () => {
    expect(ENGINE_CAPABILITIES.has('op:cast.costChange')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('body:modify.then')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:madness')).toBe(true);
    expect(compileCard(getCard('Fiery Temper')).automation.level).toBe('full');
  });

  it('CR 702.35a-b: discarded, Fiery Temper is exiled instead; when its trigger resolves, its owner casts it for {R} (an alternative cost, CR 118.9)', () => {
    let s = loot(board(2));
    expect(exile(s)).toContain('Fiery Temper');
    expect(graveyard(s)).not.toContain('Fiery Temper');
    expect(logHas(s, /Alice discards Fiery Temper/)).toBe(true); // CR 702.35a: "that player discards it" (CR 701.9a)
    expect(stackNames(s)).toEqual(['ability of Fiery Temper']); // CR 702.35a: the triggered ability, put on the stack (CR 603.3)
    s = resolveTop(s, [{ kind: 'yesNo', yes: true }, target('p2')]);
    expect(stackNames(s)).toEqual(['Fiery Temper']);
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.stack?.costsPaid.alternative).toBe('madness'); // CR 118.9, 702.35b
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(2); // {R} for Faithless Looting, {R} for the madness cost
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(graveyard(s)).toContain('Fiery Temper');
  });

  it('CR 702.35a: if its owner doesn\'t cast it, they put it into their graveyard', () => {
    const s = resolveTop(loot(board(2)), [{ kind: 'yesNo', yes: false }]);
    expect(graveyard(s)).toContain('Fiery Temper');
    expect(exile(s)).not.toContain('Fiery Temper');
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 702.35a, 601.2h: an owner who can\'t pay the madness cost doesn\'t cast it, and it is put into the graveyard', () => {
    const s = resolveTop(loot(board(1))); // the only Mountain paid for Faithless Looting
    expect(s.pending?.kind).toBe('priority'); // no question: the cast is impossible (CR 608.2g)
    expect(graveyard(s)).toContain('Fiery Temper');
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 616.1, 702.35a: with Leyline of the Void, the owner orders the effects; madness first exiles it "this way" and it triggers', () => {
    let s = loot(board(2, ['Leyline of the Void']));
    expect(s.pending?.kind).toBe('chooseReplacement');
    expect(s.pending!.player).toBe('p1'); // CR 616.1: the affected object's owner (a card in a hand)
    const madness = s.pending!.kind === 'chooseReplacement' ? s.pending!.options.find((o) => !/Leyline/.test(o.label))! : undefined;
    s = answer(s, { kind: 'chooseReplacement', id: madness!.id });
    expect(exile(s)).toContain('Fiery Temper');
    expect(stackNames(s)).toEqual(['ability of Fiery Temper']);
  });

  it('CR 616.1, 702.35a: with Leyline of the Void applied first, the card is exiled but not "this way": madness does not trigger', () => {
    let s = loot(board(2, ['Leyline of the Void']));
    const leyline = s.pending!.kind === 'chooseReplacement' ? s.pending!.options.find((o) => /Leyline/.test(o.label))! : undefined;
    s = answer(s, { kind: 'chooseReplacement', id: leyline!.id });
    expect(exile(s)).toContain('Fiery Temper');
    expect(s.zones.stack).toEqual([]);
  });

  it('op:cast.costChange is only the alternative-cost form: a reduced or increased cost of a cast step stays resolved by hand', () => {
    const step = (kind: 'reduce' | 'increase'): Parameters<typeof capabilitiesOf>[0] => ({
      kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'cast', who: { ref: 'you' }, what: { ref: 'self' }, costChange: { kind, generic: 2 } }] },
    });
    for (const k of ['reduce', 'increase'] as const) {
      expect(capabilitiesOf(step(k))).toContain(`op:cast.costChange.${k}`);
      expect(ENGINE_CAPABILITIES.has(`op:cast.costChange.${k}`)).toBe(false);
    }
  });
});
