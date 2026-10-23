/**
 * FXC, audit C2: the Siege defeat trigger (CR 310.12b). "When the last defense counter is removed from this permanent, exile it, then you may cast it
 * transformed without paying its mana cost." While that ability is pending or on the stack, the defense-0 state-based action waits (CR 310.7, 704.5v).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, inGraveyard, logHas, onBattlefield, pass, runCombat, scenario, tweak } from '../../m4/helpers';

const SIEGE = 'Invasion of Ergamon // Truga Cliffcharger';

/** Alice controls the Siege (Bob protects it, CR 310.12a) and attacks it with Hill Giant (3 power). */
function attackSiege(defense: number): { s: GameState; battle: string } {
  const s0 = scenario(['Hill Giant', SIEGE], { p1: { battlefield: ['Hill Giant', { name: SIEGE, counters: { defense } }] } });
  const battle = find(s0, SIEGE, 'battlefield');
  return { s: runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield'), battle]], until: 'combatDamage' }), battle };
}

/** Pass priority until a decision other than priority is pending (or the stack is empty). */
function resolveTop(s: GameState): GameState {
  for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
  return s;
}

describe('CR 310.12b: a Siege whose last defense counter is removed', () => {
  it('triggers once; the battle stays while the trigger waits (CR 310.7, 704.5v)', () => {
    const { s, battle } = attackSiege(3);
    expect(logHas(s, /Invasion of Ergamon triggers: When the last defense counter is removed/, 'CR 310.12b')).toBe(true);
    expect(s.zones.stack.length).toBe(1);
    expect(s.objects[battle]?.zone).toBe('battlefield');
    expect(inGraveyard(s, SIEGE, 'p1')).toBe(false);
    expect(s.zones.stack.map((id) => s.objects[id]!.stack!.sourceId)).toEqual([battle]);
  });

  it('exiles it, then its controller may cast it transformed for free: Truga Cliffcharger enters the battlefield', () => {
    let { s } = attackSiege(3);
    s = resolveTop(s);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending!.player).toBe('p1');
    expect(s.pending!.prompt).toMatch(/Cast Invasion of Ergamon transformed without paying its mana cost\?/);
    s = answer(s, { kind: 'yesNo', yes: true });
    // The spell is on the stack with its back face up (CR 712.11a).
    expect(s.zones.stack.length).toBe(1);
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.stack?.kind).toBe('spell');
    expect(spell.stack?.face).toBe(1);
    s = resolveTop(s);
    // Truga Cliffcharger's own enters trigger may ask; answer "no" to anything optional.
    for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
      else break;
      s = resolveTop(s);
    }
    const cliff = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === SIEGE);
    expect(cliff).toBeDefined();
    expect(s.objects[cliff!]!.face).toBe(1);
    expect(s.objects[cliff!]!.controller).toBe('p1');
    expect(inGraveyard(s, SIEGE, 'p1')).toBe(false);
  });

  it('declining the cast leaves the card in exile', () => {
    let { s } = attackSiege(3);
    s = resolveTop(s);
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === SIEGE)).toBe(true);
    expect(onBattlefield(s, SIEGE)).toBe(false);
    expect(inGraveyard(s, SIEGE, 'p1')).toBe(false);
  });

  it('does not trigger while defense counters remain', () => {
    const { s, battle } = attackSiege(4);
    expect(s.objects[battle]!.counters.defense).toBe(1);
    expect(logHas(s, /triggers: When the last defense counter/)).toBe(false);
  });

  it('a battle that simply has no defense counters (no removal event) still goes to the graveyard (CR 704.5v)', () => {
    const s0 = scenario([SIEGE], { p1: { battlefield: [{ name: SIEGE, counters: { defense: 1 } }] } });
    const s = pass(tweak(s0, (t) => { delete t.objects[find(t, SIEGE, 'battlefield')]!.counters.defense; }));
    expect(inGraveyard(s, SIEGE, 'p1')).toBe(true);
  });

  it('if the Siege left the battlefield before the trigger resolves, nothing is exiled or cast (CR 400.7, 608.2b)', () => {
    const bounce = compileCard({ name: 'Test Bounce', layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: "Return target nonland permanent to its owner's hand." } as OracleCard);
    expect(bounce.automation.level).toBe('full');
    const s0 = scenario(['Hill Giant', SIEGE], { p1: { battlefield: ['Hill Giant', { name: SIEGE, counters: { defense: 3 } }] }, p2: { hand: ['Test Bounce'] }, defs: [bounce] });
    const battle = find(s0, SIEGE, 'battlefield');
    let s = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield'), battle]], until: 'combatDamage' });
    expect(s.zones.stack.length).toBe(1);
    s = pass(s); // Bob gets priority with the Siege trigger on the stack
    expect(s.pending!.player).toBe('p2');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Bounce', 'hand', 'p2') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: battle }] });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s)); // Test Bounce resolves: the Siege goes to Alice's hand
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === SIEGE)).toBe(true);
    s = resolveTop(s); // the Siege trigger resolves: its source is a new object in a hidden zone
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.zones.exile.length).toBe(0);
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === SIEGE)).toBe(true);
  });
});
