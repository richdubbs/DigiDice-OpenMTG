/**
 * Commander lane edh-c, round edh-c-81 (EDHREC ranks 15,001-15,500, later pass): scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 106.6, 702.136a, 614.12   "If that mana is spent on a creature spell, it gains riot." (Domri, Chaos Bringer): the permanent the spell becomes has riot and the
 *                                 controller chooses a +1/+1 counter or haste as it enters; a creature paid for with other mana has no riot
 *   CR 611.2a, 205.1b, 613.4b     "you may have target noncreature artifact you control become a 0/0 artifact creature. If you do, put four +1/+1 counters on it."
 *                                 (Workshop Elders): no duration, so it stays one; it keeps its other card types
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { legalActions } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}

describe('CR 106.6, 702.136a: "If that mana is spent on a creature spell, it gains riot."', () => {
  const HALL = card('Test Rally Hall', 'Land', '{T}: Add {C}. If that mana is spent on a creature spell, it gains riot.');
  const STONE = card('Test Stone', 'Artifact', '{T}: Add {C}.');
  const CUB = card('Test Cub', 'Creature — Bear', '', { cost: '{1}', pt: ['1', '1'] });
  const DEFS = [HALL, STONE, CUB];
  const tapFirst = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, name, 'battlefield', 'p1'));
    return act(s, a!.action);
  };
  const cast = (s0: GameState): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cub', 'hand', 'p1') });
    for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'chooseOption' && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
      s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    }
    return s;
  };
  it('the synthetic land is automated', () => {
    expect(HALL.automation.level).toBe('full');
  });
  it('a creature paid for with that mana enters with the controller\'s choice: a +1/+1 counter or haste', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Cub'], battlefield: ['Test Rally Hall'] } });
    s = cast(tapFirst(s, 'Test Rally Hall'));
    expect(s.pending?.kind).toBe('chooseOption');
    expect((s.pending as unknown as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(['a +1/+1 counter', 'haste']);
    const withCounter = answer(s, { kind: 'chooseOption', ids: ['0'] });
    const a = find(withCounter, 'Test Cub', 'battlefield', 'p1');
    expect(getChars(withCounter, a)!.power).toBe('2');
    expect(hasKeyword(getChars(withCounter, a)!, 'haste')).toBe(false);
    const hasty = answer(s, { kind: 'chooseOption', ids: ['1'] });
    const b = find(hasty, 'Test Cub', 'battlefield', 'p1');
    expect(getChars(hasty, b)!.power).toBe('1');
    expect(hasKeyword(getChars(hasty, b)!, 'haste')).toBe(true);
    expect(hasKeyword(getChars(advanceTo(hasty, 3, 'main1'), find(hasty, 'Test Cub', 'battlefield', 'p1'))!, 'haste')).toBe(true);
  });
  it('negative: the same creature paid for with mana from another source has no choice and no counter', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Cub'], battlefield: ['Test Stone', 'Test Rally Hall'] } });
    s = cast(tapFirst(s, 'Test Stone'));
    expect(s.pending?.kind).not.toBe('chooseOption');
    const c = find(s, 'Test Cub', 'battlefield', 'p1');
    expect(getChars(s, c)!.power).toBe('1');
    expect(hasKeyword(getChars(s, c)!, 'haste')).toBe(false);
  });
});

describe('CR 611.2a, 205.1b: "you may have target noncreature artifact you control become a 0/0 artifact creature. If you do, put four +1/+1 counters on it."', () => {
  const FORGE = card('Test Forge Elder', 'Creature — Human Artificer', 'At the beginning of combat on your turn, you may have target noncreature artifact you control become a 0/0 artifact creature. If you do, put four +1/+1 counters on it.', { pt: ['1', '1'] });
  const RELIC = card('Test Relic', 'Artifact', '');
  const ARTLAND = card('Test Vault Land', 'Artifact Land', '');
  const DEFS = [FORGE, RELIC, ARTLAND];
  const types = (s: GameState, name: string): string[] => [...getChars(s, find(s, name, 'battlefield', 'p1'))!.types];
  const toCombat = (s0: GameState, yes: boolean, name: string): GameState => {
    let s = advanceTo(s0, 1, 'beginCombat');
    for (let guard = 0; guard < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending as unknown as { kind: string };
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, name, 'battlefield', 'p1') }] });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (d.kind === 'priority') s = pass(s);
      else break;
    }
    return s;
  };
  it('the artifact becomes a 0/0 artifact creature with four +1/+1 counters, and stays one on the next turn', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forge Elder', 'Test Relic'] } });
    s = toCombat(s, true, 'Test Relic');
    const id = find(s, 'Test Relic', 'battlefield', 'p1');
    expect(types(s, 'Test Relic')).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(getChars(s, id)!.power).toBe('4');
    expect(getChars(s, id)!.toughness).toBe('4');
    s = advanceTo(s, 3, 'main1');
    expect(types(s, 'Test Relic')).toContain('Creature');
  });
  it('an artifact land keeps its land type: "artifact creature" keeps the other types (CR 205.1b)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forge Elder', 'Test Vault Land'] } });
    s = toCombat(s, true, 'Test Vault Land');
    expect(types(s, 'Test Vault Land').sort()).toEqual(['Artifact', 'Creature', 'Land']);
  });
  it('negative: declining the "may" changes nothing and puts no counters', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forge Elder', 'Test Relic'] } });
    s = toCombat(s, false, 'Test Relic');
    expect(types(s, 'Test Relic')).toEqual(['Artifact']);
    expect(s.objects[find(s, 'Test Relic', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
