/**
 * pc-exile-play-4 (precon lane pc-exile-play): "You may cast spells from among those cards this turn. If you cast a spell this way, pay life equal to that spell's mana value
 * rather than pay its mana cost." and "Cast any number of cards exiled with ~ without paying their mana costs." played through the engine with synthetic cards (design 6.10).
 * CR cites from memory, unverified (no rules/cr in the cloud checkout).
 *
 *   CR 118.9, 202.3, 601.3   the exiled spells are cast by paying life equal to their mana value instead of mana; only the exiled cards; only this turn; a land is not cast
 *   CR 607.2a, 118.9, 305.9  any number of the cards exiled with ~ are cast free; a card exiled by something else is not offered
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../../../src/index';
import { act, advanceTo, answer, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const PACT = card('Test Pact', 'Artifact', "{T}: Each opponent exiles the top card of their library. You may cast spells from among those cards this turn. If you cast a spell this way, pay life equal to that spell's mana value rather than pay its mana cost.");
const HOARD = card('Test Hoard', 'Artifact', '{T}: Exile target instant card from a graveyard.\n{2}, {T}, Sacrifice Test Hoard: Cast any number of cards exiled with Test Hoard without paying their mana costs.');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3'], '{R}{R}');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', undefined, '{0}');
const CHARM = card('Test Charm', 'Instant', 'You gain 5 life.', undefined, '{3}');
const DEFS = [PACT, HOARD, BRUTE, SIP, CHARM];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const castAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const activations = (s: GameState, name: string): Action[] =>
  legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object !== undefined && nameOf(s, a.object) === name).map((a) => a.action);

describe('CR 118.9, 202.3: spells from among the exiled cards are cast for life equal to their mana value', () => {
  const opp = { targets: [{ kind: 'player' as const, id: 'p2' }] };
  it('the exiled {R}{R} creature is cast with no mana at all and costs 2 life; the card under it stays in the library', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pact'] }, p2: { library: ['Test Brute', 'Test Sip'] } });
    let s = resolveAll(act(s0, activations(s0, 'Test Pact')[0]!), opp);
    const l0 = life(s, 'p1');
    expect(castAction(s, 'Test Brute')).toBeDefined();
    expect(castAction(s, 'Test Sip')).toBeUndefined();
    expect(s.zones.library['p2']!.map((id) => nameOf(s, id))).toContain('Test Sip'); expect(s.zones.library['p2']!.map((id) => nameOf(s, id))).not.toContain('Test Brute'); // the card under the exiled one stays in the library
    s = resolveAll(settle(act(s, castAction(s, 'Test Brute')!)));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Brute')).toBe(true);
    expect(life(s, 'p1')).toBe(l0 - 2);
  });
  it('a card exiled by the ability is not castable next turn (this turn only)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pact'] }, p2: { library: ['Test Brute', 'Test Sip'] } });
    const s = resolveAll(act(s0, activations(s0, 'Test Pact')[0]!), opp);
    const later = advanceTo(s, 3, 'main1');
    expect(later.pending?.player).toBe('p1');
    expect(castAction(later, 'Test Brute')).toBeUndefined();
  });
  it('with only 1 life left a spell of mana value 2 cannot be cast for life (you cannot pay more life than you have)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pact'] }, p2: { library: ['Test Brute', 'Test Sip'] } });
    let s = resolveAll(act(s0, activations(s0, 'Test Pact')[0]!), opp);
    s = { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, life: 1 } : p)) } as GameState;
    expect(castAction(s, 'Test Brute')).toBeUndefined();
  });
});

describe('CR 607.2a, 118.9, 305.9: cast any number of cards exiled with ~ without paying their mana costs', () => {
  it('both cards exiled with it are cast free ({3} + {3} spells with no mana for them); a card exiled otherwise is not offered', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hoard', 'Plains', 'Plains'], graveyard: ['Test Charm', 'Test Charm'], exile: ['Test Sip'] } });
    for (const [what, owner] of [['Test Charm', 'p1'], ['Test Charm', 'p1']] as const) {
      const a = activations(s, 'Test Hoard')[0]!;
      s = resolveAll(settle(act(s, a), { targets: [{ kind: 'object', id: s.zones.graveyard[owner]!.find((id) => nameOf(s, id) === what)! }] }), { targets: [{ kind: 'object', id: s.zones.graveyard[owner]!.find((id) => nameOf(s, id) === what)! }] });
      s = { ...s, objects: { ...s.objects, [find(s, 'Test Hoard', 'battlefield', 'p1')]: { ...s.objects[find(s, 'Test Hoard', 'battlefield', 'p1')]!, tapped: false } } } as GameState;
    }
    const l0 = life(s, 'p1');
    const cast = activations(s, 'Test Hoard').at(-1)!;
    const exiled = s.zones.exile.filter((id) => nameOf(s, id) === 'Test Charm');
    expect(exiled.length).toBe(2);
    // pay the cost (the Hoard is sacrificed: its linked cards are read from its last known information), then the choice is asked among the linked cards only
    let asked = act(s, cast);
    while (asked.pending?.kind === 'payCost') asked = answer(asked, { kind: 'payCost', auto: true });
    let passed = asked;
    for (let i = 0; i < 5 && passed.pending?.kind !== 'chooseObjects'; i++) passed = act(passed, { type: 'pass', player: passed.pending!.player });
    const pending = passed.pending as unknown as { kind: string; options: string[] };
    expect(pending.kind).toBe('chooseObjects');
    expect([...pending.options].sort()).toEqual([...exiled].sort()); // the Test Sip exiled by something else is not offered
    s = resolveAll(settle(passed, { objects: exiled }), { objects: exiled });
    expect(life(s, 'p1')).toBe(l0 + 10);
  });
});
