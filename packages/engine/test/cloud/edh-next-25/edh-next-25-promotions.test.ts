/**
 * Commander lane edh-next, round edh-next-25: two experimental templates promoted to stable on a hand-verified held-out card each (design 6.9, "Narrow wordings";
 * both cards are of the EDHREC top 20,000, opened by the owner: commander request 2026-10-27, more cards 2026-10-30), played through the engine with synthetic cards.
 *
 *   CR 121.1, 107.3, 903.8   "Target player draws X cards plus an additional card for each time they've cast a commander from the command zone this game." (Commander's Insight)
 *   CR 122.1b, 608.2d        "Put your choice of a menace, trample, or lifelink counter on it." (T-45 Power Armor)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { card, commanderRec, commanderScenario, find, forests, legend, tweak } from '../../m11/rules/helpers';
import { cast, resolveTop, target } from '../../m5/cr-examples/helpers';

const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

describe('CR 121.1, 107.3, 903.8: "Target player draws X cards plus an additional card for each time they\'ve cast a commander from the command zone this game."', () => {
  const INSIGHT = card('Test Insight', '{X}{G}', 'Sorcery', 'Target player draws X cards plus an additional card for each time they\'ve cast a commander from the command zone this game.');
  const draws = (who: 'p1' | 'p2', p1Casts: number, p2Casts: number): number => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [INSIGHT], p1: { battlefield: forests(4), hand: ['Test Insight'] } });
    s = tweak(s, (t) => { commanderRec(t, 'p1', 'Test Titania').casts = p1Casts; commanderRec(t, 'p2', 'Test Bob Commander').casts = p2Casts; });
    const before = s.zones.hand[who]!.length;
    s = cast(s, 'Test Insight', [{ kind: 'chooseNumber', n: 2 }, target(who)]);
    s = resolveTop(s);
    return s.zones.hand[who]!.length - before + (who === 'p1' ? 1 : 0); // the spell itself left your hand
  };
  it('is automated', () => { expect(JSON.stringify(INSIGHT.faces)).not.toContain('"op":"manual"'); });
  it('draws X cards plus one for each time the TARGET player cast their commander from the command zone (yourself, or an opponent)', () => {
    expect(draws('p1', 2, 0)).toBe(4);
    expect(draws('p2', 2, 1)).toBe(3);
  });
  it('with no commander cast this game the target draws exactly X; the caster\'s own casts do not count for an opponent', () => {
    expect(draws('p1', 0, 3)).toBe(2);
    expect(draws('p2', 3, 0)).toBe(2);
  });
});

describe('CR 122.1b, 608.2d: "Put your choice of a menace, trample, or lifelink counter on target creature you control."', () => {
  const GIFT = card('Test Gift', '{0}', 'Sorcery', 'Put your choice of a menace, trample, or lifelink counter on target creature you control.');
  const BEAR = card('Test Bear', '{1}{G}', 'Creature — Bear', '', ['2', '2']);
  const run = (kind: string): { s: GameState; bear: ObjectId } => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [GIFT, BEAR], p1: { hand: ['Test Gift'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Gift', [target(bear)]);
    s = resolveTop(s, [{ kind: 'chooseOption', ids: [String(['menace', 'trample', 'lifelink'].indexOf(kind))] }]);
    return { s, bear };
  };
  it('is automated', () => { expect(JSON.stringify(GIFT.faces)).not.toContain('"op":"manual"'); });
  it('puts exactly ONE counter of the kind you chose (CR 122.1b: a keyword counter gives the keyword)', () => {
    for (const kw of ['menace', 'trample', 'lifelink']) {
      const { s, bear } = run(kw);
      expect(hasKeyword(getChars(s, bear)!, kw), kw).toBe(true);
      expect(Object.keys(s.objects[bear]!.counters ?? {}), kw).toEqual([kw]);
      expect(Object.values(s.objects[bear]!.counters ?? {}).reduce((a, b) => a + (b as number), 0), kw).toBe(1);
      expect(getChars(s, bear)!.name).toBe('Test Bear');
    }
  });
});
