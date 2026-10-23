/**
 * p2-intervening-4 (lane p2-intervening): "When this creature dies, if it was blocked this turn, ..." (parser/holes/p2iv2.ts#selfDamageHistory, render/p2iv2.ts), played
 * through the engine with synthetic cards compiled by the game's default compiler (wordings invented, design 6.10), with its negative cases and near misses.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 509.1h, 603.10a  "if it was blocked this turn": a creature was declared as a blocker of the source this turn, read as the source last existed
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, find, life, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';
import { localIndex } from '../../m5/parser/support';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const RUNNER = card('Test Thicket Runner', 'Creature — Elf', 'When this creature dies, if it was blocked this turn, you gain 3 life.', ['2', '2']);
const WALL = card('Test Stone Wall', 'Creature — Wall', '', ['0', '4']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const DEFS: CardDef[] = [RUNNER, WALL, OGRE, DOOM];
const doom = (s: GameState): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [{ kind: 'object', id: find(s, 'Test Thicket Runner', 'battlefield', 'p1') }] }));

describe('CR 509.1h, 603.10a: "When this creature dies, if it was blocked this turn, ..."', () => {
  it('is automated with the blocks history of the source', () => {
    expect(RUNNER.automation.level).toBe('full');
    expect((RUNNER.faces[0]!.abilities[0] as { interveningIf?: unknown }).interveningIf).toEqual({ cond: 'happened', event: { ev: 'blocks', attacker: { self: true } }, scope: 'turn' });
  });
  const attack = (blocker: string): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Thicket Runner'], hand: ['Test Doom'] }, p2: { battlefield: [blocker] } });
    s = toDeclareAttackers(advanceTo(s, 3, 'main1'));
    s = declareAttackers(s, [[find(s, 'Test Thicket Runner', 'battlefield', 'p1'), 'p2']]);
    s = toDeclareBlockers(s);
    return declareBlockers(s, [[find(s, blocker, 'battlefield', 'p2'), find(s, 'Test Thicket Runner', 'battlefield', 'p1')]]);
  };
  it('blocked by a 3/3 and killed in combat: you gain 3 life', () => {
    const s = resolveAll(passUntil(attack('Test Ogre'), (x) => x.turn.step === 'main2', 'main2'));
    expect(life(s, 'p1')).toBe(23);
  });
  it('blocked by a 0/4 (survives), destroyed after combat: you gain 3 life (still this turn)', () => {
    const s = doom(passUntil(attack('Test Stone Wall'), (x) => x.turn.step === 'main2', 'main2'));
    expect(life(s, 'p1')).toBe(23);
  });
  it('destroyed without having been blocked: nothing; blocked on an earlier turn only: nothing', () => {
    expect(life(doom(scenario([], { defs: DEFS, p1: { battlefield: ['Test Thicket Runner'], hand: ['Test Doom'] } })), 'p1')).toBe(20);
    const s = resolveAll(advanceTo(passUntil(attack('Test Stone Wall'), (x) => x.turn.step === 'main2', 'main2'), 5, 'main1'));
    expect(life(doom(s), 'p1')).toBe(20);
  });
});

const NEAR_MISSES = ['Whenever another creature you control dies, if it was blocked this turn, you gain 4 life.', 'When this creature dies, if it was blocked this game, you gain 4 life.'];
describe('p2-intervening-4: near misses stay manual (fail closed)', () => {
  for (const text of NEAR_MISSES) it(`"${text}"`, () => expect(card('Test Vigil Keeper', 'Creature — Human', text, ['2', '2']).automation.level).not.toBe('full'));
});

const index = localIndex();
describe.skipIf(index === null)('p2-intervening-4 design 6.10 (local index): synthetic wordings', () => {
  it('no synthetic line is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
      if (typeof text === 'string') for (const l of text.split('\n')) { lines.add(l.trim()); lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim()); }
    }
    for (const l of [RUNNER.faces[0]!.abilities[0]!.text ?? '', ...NEAR_MISSES]) { expect(lines.has(l), l).toBe(false); expect(lines.has(l.replace(/\bthis creature\b/g, '~')), l).toBe(false); }
  });
});
