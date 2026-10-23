/**
 * Lane std-copy, round std-copy-3: "{T}: Add {R}. When that mana is spent to cast a red instant or sorcery spell, copy that spell and you may choose new targets for the
 * copy." (addMana.whenSpent, template rid.stdcopy3.mana.whenSpent.copy) played through the engine with synthetic cards (design 6.10). CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 605.1a          the ability is still a mana ability: it doesn't target (the copy's new targets belong to the triggered ability the mana carries)
 *   CR 106.6, 603.2    the mana carries a triggered ability: it triggers when that mana is spent to cast a matching spell, and goes on the stack; mana spent on
 *                      another spell, or a spell paid with other mana, triggers nothing
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [] } as OracleCard);
}
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Cast a card from p1's hand paying automatically, then pass until the stack is empty (yes to every yes/no). */
function castAndResolve(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const d = s.pending!;
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

describe('CR 106.6, 603.2, 605.1a: "When that mana is spent to cast a red instant or sorcery spell, copy that spell ..." (rid.stdcopy3.mana.whenSpent.copy)', () => {
  const LENS = card('Test Ember Lens', 'Artifact', '{T}: Add {R}. When that mana is spent to cast a red instant or sorcery spell, copy that spell and you may choose new targets for the copy.');
  const RED = card('Test Red Tonic', 'Instant', 'You gain 3 life.', '{R}', ['R']);
  const GREEN = card('Test Green Tonic', 'Instant', 'You gain 3 life.', '{R}', ['G']);
  const defs = [LENS, RED, GREEN];
  it('is parsed and automated as a mana ability', () => {
    expect(JSON.stringify(LENS.faces).includes('"op":"manual"')).toBe(false);
    expect(LENS.faces[0]!.abilities[0]).toMatchObject({ kind: 'activated', isMana: true });
  });
  it('its mana spent on a red instant copies it: the spell resolves twice', () => {
    const s = castAndResolve(scenario([], { p1: { hand: ['Test Red Tonic'], battlefield: ['Test Ember Lens'] }, defs }), 'Test Red Tonic');
    expect(life(s, 'p1')).toBe(26);
  });
  it('its mana spent on a spell that is not red triggers nothing (the negative case)', () => {
    const s = castAndResolve(scenario([], { p1: { hand: ['Test Green Tonic'], battlefield: ['Test Ember Lens'] }, defs }), 'Test Green Tonic');
    expect(life(s, 'p1')).toBe(23);
  });
  it('a red instant paid with other mana triggers nothing (the negative case)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Red Tonic'], battlefield: ['Test Ember Lens', 'Mountain'] }, defs });
    s0.objects[find(s0, 'Test Ember Lens', 'battlefield', 'p1')]!.tapped = true;
    const s = castAndResolve(s0, 'Test Red Tonic');
    expect(life(s, 'p1')).toBe(23);
  });
});
