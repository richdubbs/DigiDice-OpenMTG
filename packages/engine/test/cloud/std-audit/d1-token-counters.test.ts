/**
 * Merge wave 8, audit D1 (docs/audits/2026-10-18-STD.md): "Create a 0/0 ... token. Put N +1/+1 counters on it." put the N counters on the token AND on the
 * player who created it: effects/handlers/tokens-create.ts bound the creating players together with the tokens under the instruction's name, and the
 * counters step reads a binding's objects and players (effects/refs.ts#resolveRecipients). "It" is the token (CR 111.1, 608.2c); counters go only on the
 * objects the instruction names (CR 122.1, 122.6). Real cards (Oracle text from the card index).
 *
 *   CR 111.1, 608.2c   the name a token creation binds ("it", "them") stands for the tokens it created
 *   CR 122.1, 122.6    counters are put on the object the effect names; a player never gets +1/+1 counters this way
 *   CR 614.1a, 616.1   Hardened Scales: "that many plus one +1/+1 counters are put on it instead"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function oracle(name: string, mana_cost: string, type_line: string, oracle_text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost, type_line, oracle_text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const EMIL = oracle('Emil, Vastlands Roamer', '{2}{G}', 'Legendary Creature — Elf Druid',
  'Creatures you control with +1/+1 counters on them have trample.\n{4}{G}, {T}: Create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on it, where X is the number of differently named lands you control.', ['3', '3']);
const ADDITIVE = oracle('Additive Evolution', '{3}{G}{G}', 'Enchantment',
  'When this enchantment enters, create a 0/0 green and blue Fractal creature token. Put three +1/+1 counters on it.\nAt the beginning of combat on your turn, put a +1/+1 counter on target creature you control. It gains vigilance until end of turn.');
const FRACTAL_SUMMONING = oracle('Fractal Summoning', '{X}{G/U}{G/U}', 'Sorcery — Lesson', 'Create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on it.');
const DEFS = [EMIL, ADDITIVE, FRACTAL_SUMMONING];

const fractals = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
const playerCounters = (s: GameState): Record<string, number>[] => s.players.map((p) => ({ ...(p.counters ?? {}) }));

function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40; guard++) {
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 2 });
    else if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}

describe('audit D1: the counters of "create a token. Put N counters on it" go on the token only (CR 111.1, 122.1, 608.2c)', () => {
  it('Emil, Vastlands Roamer with Forest x3, Island and Plains: the Fractal gets 3 counters, no player gets any', () => {
    const s0 = scenario(['Forest', 'Island', 'Plains'], { p1: { battlefield: ['Emil, Vastlands Roamer', 'Forest', 'Forest', 'Forest', 'Island', 'Plains'] }, defs: DEFS });
    const emil = find(s0, 'Emil, Vastlands Roamer', 'battlefield');
    const ability = legal(s0, 'p1', 'activate').find((a) => a.object === emil && !a.isMana)!;
    expect(ability).toBeDefined();
    const s = resolveAll(act(s0, ability.action));
    const [token] = fractals(s);
    expect(token).toBeDefined();
    expect(s.objects[token!]!.counters['+1/+1']).toBe(3);
    expect(playerCounters(s)).toEqual([{}, {}]);
  });
  it('Additive Evolution with Hardened Scales: the Fractal gets 3 + 1 = 4 counters (CR 614.1a), no player gets any', () => {
    const s0 = scenario(['Forest', 'Island', 'Hardened Scales'], { p1: { hand: ['Additive Evolution'], battlefield: ['Hardened Scales', 'Forest', 'Forest', 'Forest', 'Island', 'Island'] }, defs: DEFS });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Additive Evolution', 'hand') }));
    const [token] = fractals(s);
    expect(token).toBeDefined();
    expect(s.objects[token!]!.counters['+1/+1']).toBe(4);
    expect(playerCounters(s)).toEqual([{}, {}]);
  });
  it('Fractal Summoning with X = 2: the Fractal gets 2 counters, the caster none', () => {
    const s0 = scenario(['Forest', 'Island'], { p1: { hand: ['Fractal Summoning'], battlefield: ['Forest', 'Forest', 'Island', 'Island'] }, defs: DEFS });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Fractal Summoning', 'hand') }));
    const [token] = fractals(s);
    expect(token).toBeDefined();
    expect(s.objects[token!]!.counters['+1/+1']).toBe(2);
    expect(playerCounters(s)).toEqual([{}, {}]);
  });
});
