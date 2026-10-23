/**
 * W3 integration (WP31 + WP32): a mana ability decided as it resolves (WP31's resolver, rules/mana.ts) is an activation that triggers triggered mana
 * abilities once (WP32, CR 605.1b, 605.4a), like a mana ability with fixed units.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, EffectStep, EventPattern, GameState } from '../../../src/index';
import { trig } from './cards';
import { act, scenario, stackAbilities, synth } from './helpers';

const tapsLand: EventPattern = { ev: 'activate', source: { types: ['Land'] }, manaAbility: true };
const add = (m: 'G' | 'R'): EffectStep => ({ op: 'addMana', who: { ref: 'event', role: 'player' }, units: [[m]] });

/** "Whenever a player taps a land for mana, that player adds an additional {G}." */
const flare = synth({
  name: 'Test W3 Flare', cost: '{2}{R}', type: 'Enchantment',
  abilities: [trig('Whenever a player taps a land for mana, that player adds an additional {G}.', [tapsLand], { steps: [add('G')] })],
});
/** "{T}: Add {R}. You gain 1 life." A mana ability (CR 605.1a) whose program is not only fixed units: WP31's resolver runs it. */
const dynamicLand = synth({
  name: 'Test W3 Dynamic Land', type: 'Land',
  abilities: [{ kind: 'activated', text: '{T}: Add {R}. You gain 1 life.', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [
    { op: 'addMana', who: { ref: 'you' }, units: [['R']] },
    { op: 'gainLife', who: { ref: 'you' }, amount: 1 },
  ] } } as AbilityDef],
});

const DEFS: CardDef[] = [flare, dynamicLand];
const pool = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');

describe('CR 605.3b, 605.4a (W3 integration): a resolver-run mana ability triggers triggered mana abilities once', () => {
  it('tapping the dynamic land adds {R} and gains 1 life; the Flare adds exactly one extra {G}, without the stack', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test W3 Dynamic Land', 'Test W3 Flare'] } });
    const land = s0.zones.battlefield.find((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test W3 Dynamic Land')!;
    const life = s0.players[0]!.life;
    const s = act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:0' });
    expect(s.objects[land]!.tapped).toBe(true);
    expect(s.players[0]!.life).toBe(life + 1);
    expect(pool(s)).toBe('GR');
    expect(stackAbilities(s)).toEqual([]);
    expect(s.pendingTriggers).toEqual([]);
  });
});
