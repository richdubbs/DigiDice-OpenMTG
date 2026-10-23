/**
 * p2-refs-3 (Phase 2 lane p2-refs): the round's changes played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.3, 607.2d  "Spells with the chosen name can't be cast": a spell of that name can't be cast by any player; another one can
 *   CR 602.5, 113.7   "Activated abilities of sources with the chosen name can't be activated": none of that name's abilities; another source's can
 *   CR 613.1e, 105.3  "All creatures are the chosen color": every creature is that color; a land is not
 *   CR 608.2c         "put a +1/+1 counter on this creature and untap it": the object itself is untapped, not the spell that was cast
 *   CR 608.2c, 201.5  "If this enchantment isn't a creature, it becomes a 3/3 Angel creature ...": the enchantment becomes the creature
 */
import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, GameState } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { card, full, settle } from '../cmd3/helpers';
import { getChars } from '../../../src/rules/characteristics';

/** Answer a name or color choice with these, everything else with the defaults, until the stack is empty. */
function drain(s0: GameState, extra: { name?: string; color?: string } = {}): GameState {
  let s = s0;
  for (let i = 0; i < 80; i++) {
    const d = s.pending;
    if (d?.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: extra.name! } as DecisionAnswer);
    else if (d?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: extra.color! } as DecisionAnswer);
    else if (d && d.kind !== 'priority') s = settle(s);
    else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const castable = (s: GameState, name: string, player = 'p1'): boolean =>
  legal(s, player, 'cast').some((a) => JSON.stringify(a).includes(find(s, name, 'hand', player)));
const sideOf = (s: GameState, player: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player).map((id) => s.objects[id]!.defId);

const MAGE = card('Test Mage', 'Creature — Human Wizard', 'As this creature enters, choose a nonland card name.\nSpells with the chosen name can\'t be cast.\nActivated abilities of sources with the chosen name can\'t be activated.', ['2', '2']);
const SKY = card('Test Sky', 'Enchantment', 'As this enchantment enters, choose a color.\nAll creatures are the chosen color.');
const GWEN = card('Test Gwen', 'Creature — Elf', 'Whenever you cast a creature spell, put a +1/+1 counter on this creature and untap it.', ['1', '1']);
const PRAYER = card('Test Prayer', 'Enchantment', "Whenever a creature you control enters, you gain 1 life. If this enchantment isn't a creature, it becomes a 3/3 Angel creature with flying in addition to its other types until end of turn.");
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['3', '3']);
const TROLL = card('Test Troll', 'Creature — Troll', '{0}: Regenerate this creature.', ['2', '2']);
const DEFS = [MAGE, SKY, GWEN, PRAYER, BEAR, OX, TROLL];

describe('the synthetic p2-refs-3 cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [MAGE, SKY, GWEN, PRAYER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.3, 602.5, 607.2d: "Spells with the chosen name can\'t be cast" / "Activated abilities of sources with the chosen name can\'t be activated"', () => {
  const named = (name: string): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Mage', 'Test Bear', 'Test Ox'], battlefield: ['Test Troll'] } });
    return drain(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mage', 'hand', 'p1') }), { name });
  };
  it('naming Test Bear: Test Bear can\'t be cast, Test Ox can', () => {
    const s = named('Test Bear');
    expect(castable(s, 'Test Bear')).toBe(false);
    expect(castable(s, 'Test Ox')).toBe(true);
  });
  it('naming Test Troll: its ability can\'t be activated; naming Test Bear, it can', () => {
    const blocked = named('Test Troll');
    expect(() => act(blocked, { type: 'activate', player: 'p1', source: find(blocked, 'Test Troll', 'battlefield', 'p1'), ability: 'p:0:0' })).toThrow();
    const free = named('Test Bear');
    expect(() => act(free, { type: 'activate', player: 'p1', source: find(free, 'Test Troll', 'battlefield', 'p1'), ability: 'p:0:0' })).not.toThrow();
  });
});

describe('CR 613.1e, 105.3: "All creatures are the chosen color"', () => {
  it('choosing blue: every creature is blue, and only blue; a land is unchanged', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Sky'], battlefield: ['Test Bear', 'Plains'] }, p2: { battlefield: ['Test Ox'] } });
    const s = drain(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sky', 'hand', 'p1') }), { color: 'U' });
    expect(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!.colors).toEqual(['U']);
    expect(getChars(s, find(s, 'Test Ox', 'battlefield', 'p2'))!.colors).toEqual(['U']);
    expect(getChars(s, find(s, 'Plains', 'battlefield', 'p1'))!.colors).toEqual([]);
  });
});

describe('CR 608.2c: "put a +1/+1 counter on this creature and untap it"', () => {
  it('casting a creature spell: the tapped creature gets a counter and untaps', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Bear'], battlefield: [{ name: 'Test Gwen', tapped: true }] } });
    const s = drain(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }));
    const gwen = find(s, 'Test Gwen', 'battlefield', 'p1');
    expect(s.objects[gwen]!.counters['+1/+1']).toBe(1);
    expect(s.objects[gwen]!.tapped).toBe(false);
  });
});

describe('CR 608.2c, 201.5: "If this enchantment isn\'t a creature, it becomes a 3/3 Angel creature with flying ... until end of turn"', () => {
  it('a creature enters: 1 life, and the enchantment is a 3/3 flying Angel creature', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Bear'], battlefield: ['Test Prayer'] } });
    const s = drain(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }));
    expect(life(s, 'p1')).toBe(21);
    const c = getChars(s, find(s, 'Test Prayer', 'battlefield', 'p1'))!;
    expect(c.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
    expect(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!.types).toEqual(['Creature']);
    expect(sideOf(s, 'p1')).toContain('Test Bear');
  });
});
