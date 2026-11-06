/**
 * Commander coordinator D, round edh-d-44 (lane d-leftovers-3): scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (media.wizards.com text read in the session unless a test says otherwise).
 *
 *   CR 601.3b, 601.2b, 107.3a, 702.8a  "You may cast this spell as though it had flash if X is 3 or less" (PermissionDef.ifXAtMost)
 *   CR 601.3b, 601.2i, 702.8a          "You may cast the first creature spell you cast each turn as though it had flash" (PermissionDef.firstOfKind)
 *   CR 601.3b, 118.8, 702.8a           "You may cast this spell as though it had flash by tapping three untapped creatures you control with flying in addition to paying its other costs"
 *   CR 601.3b, 401.5, 702.8a           "You may cast noncreature spells from the top of your library. If you cast a spell this way, you may cast it as though it had flash."
 *   CR 702.11b, 115.1, 609.4           "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState, answers: DecisionAnswer[] = []): GameState => {
  let s = t;
  const queue = [...answers];
  for (let g = 0; g < 20 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'chooseTargets'; g++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
};
const castable = (s: GameState, player: 'p1' | 'p2' = 'p1'): string[] => legal(s, player, 'cast').map((a) => s.objects[(a as { object: ObjectId }).object]!.defId);
const stackNames = (s: GameState): string[] => s.zones.stack.map((id) => s.objects[id]!.defId);
const handSize = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === p).length;
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', { pt: ['1', '1'] });
const LAND = card('Test Land', 'Land', '{T}: Add {C}.');
const LANDS = ['Test Land', 'Test Land', 'Test Land', 'Test Land', 'Test Land'];
const LIB = ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'];

describe('CR 601.3b, 601.2b, 107.3a, 702.8a: "You may cast this spell as though it had flash if X is 3 or less."', () => {
  const SCRUT = card('Test Scrutiny', 'Sorcery', 'You may cast this spell as though it had flash if X is 3 or less.\nDraw X cards.', { cost: '{X}' });
  const start = (): GameState => {
    const s0 = scenario([], { defs: [SCRUT, FILLER, BEAR, LAND], p1: { hand: ['Test Scrutiny', 'Test Filler'], battlefield: LANDS, library: LIB } });
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') })); // a spell on the stack: only flash can be cast
  };
  it('is automated', () => expect(noManual(SCRUT)).toEqual([]));
  it('with a spell on the stack it can be begun; X = 3 is allowed and draws three cards', () => {
    const s = start();
    expect(castable(s)).toContain('Test Scrutiny');
    const before = handSize(s);
    let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrutiny', 'hand', 'p1') }), [{ kind: 'chooseNumber', n: 3 } as never]);
    expect(stackNames(t)).toContain('Test Scrutiny');
    t = settle(pass(pass(settle(pass(pass(t))))));
    expect(handSize(t)).toBe(before - 1 + 3);
  });
  it('X = 4 is not offered when the permission is what lets it be cast now (CR 601.3b: the X limit is part of the permission)', () => {
    const s = start();
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrutiny', 'hand', 'p1') });
    expect(t.pending?.kind).toBe('chooseNumber');
    const bad = reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseNumber', n: 4 } as never });
    expect(bad.message).toContain('0 to 3');
    expect(bad.rules).toContain('CR 601.2b');
  });
  it('at sorcery timing (empty stack, own main phase) any X is allowed: the permission limits only the flash cast', () => {
    const s0 = scenario([], { defs: [SCRUT, BEAR, LAND], p1: { hand: ['Test Scrutiny'], battlefield: LANDS, library: LIB } });
    const t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Scrutiny', 'hand', 'p1') }), [{ kind: 'chooseNumber', n: 5 } as never]);
    expect(stackNames(t)).toContain('Test Scrutiny');
  });
  it('a card without the permission is not castable with a spell on the stack', () => {
    const PLAIN = card('Test Plain', 'Sorcery', 'Draw X cards.', { cost: '{X}' });
    const s0 = scenario([], { defs: [PLAIN, FILLER, BEAR], p1: { hand: ['Test Plain', 'Test Filler'], library: LIB } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(castable(s)).not.toContain('Test Plain');
  });
});

describe('CR 601.3b, 601.2i, 702.8a: "You may cast the first creature spell you cast each turn as though it had flash."', () => {
  const SPIRIT = card('Test Spirit', 'Legendary Creature — Human', 'You may cast the first creature spell you cast each turn as though it had flash.\nWhenever a nontoken creature you control enters during combat, draw a card.', { pt: ['2', '2'] });
  const start = (): GameState => {
    const s0 = scenario([], { defs: [SPIRIT, FILLER, BEAR], p1: { hand: ['Test Bear', 'Test Bear', 'Test Filler'], battlefield: ['Test Spirit'] } });
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
  };
  it('is automated', () => expect(noManual(SPIRIT)).toEqual([]));
  it('the first creature spell can be cast with a spell on the stack; then the second cannot (it is no longer the first)', () => {
    const s = start();
    expect(castable(s)).toContain('Test Bear');
    const t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    expect(stackNames(t)).toContain('Test Bear');
    expect(castable(t)).not.toContain('Test Bear');
  });
  it('without the permission no creature spell is castable with a spell on the stack', () => {
    const s0 = scenario([], { defs: [FILLER, BEAR], p1: { hand: ['Test Bear', 'Test Filler'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(castable(s)).not.toContain('Test Bear');
  });
  it('a noncreature spell is not helped (the permission is for creature spells)', () => {
    const NIP = card('Test Nip', 'Sorcery', 'You gain 2 life.');
    const s0 = scenario([], { defs: [SPIRIT, FILLER, NIP], p1: { hand: ['Test Nip', 'Test Filler'], battlefield: ['Test Spirit'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(castable(s)).not.toContain('Test Nip');
  });
  it('the opponent does not get the permission', () => {
    const s0 = scenario([], { defs: [SPIRIT, FILLER, BEAR], p1: { hand: ['Test Filler'], battlefield: ['Test Spirit'] }, p2: { hand: ['Test Bear'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(castable(settle(pass(s)), 'p2')).not.toContain('Test Bear');
  });
});

describe('CR 601.3b, 118.8, 702.8a: "You may cast this spell as though it had flash by tapping three untapped creatures you control with flying in addition to paying its other costs."', () => {
  const SCOUR = card('Test Scouring', 'Sorcery', 'You may cast this spell as though it had flash by tapping two untapped creatures you control with flying in addition to paying its other costs.\nYou gain 5 life.');
  const start = (fliers: number): GameState => {
    const s0 = scenario([], { defs: [SCOUR, FILLER, FLIER, BEAR], p1: { hand: ['Test Scouring', 'Test Filler'], battlefield: [...Array(fliers).fill('Test Flier'), 'Test Bear'] } });
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
  };
  it('is automated', () => expect(noManual(SCOUR)).toEqual([]));
  it('with two untapped fliers it can be cast with a spell on the stack, and they become tapped', () => {
    const s = start(2);
    expect(castable(s)).toContain('Test Scouring');
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scouring', 'hand', 'p1') });
    t = settle(t);
    expect(stackNames(t)).toContain('Test Scouring');
    const fliers = t.zones.battlefield.filter((id) => t.objects[id]!.defId === 'Test Flier');
    expect(fliers.every((id) => t.objects[id]!.tapped)).toBe(true);
    expect(t.objects[find(t, 'Test Bear', 'battlefield', 'p1')]!.tapped).toBe(false); // the Bear has no flying: it was not the cost
  });
  it('with one flier only (the Bear does not count) it can not be cast at that time', () => {
    expect(castable(start(1))).not.toContain('Test Scouring');
  });
});

describe('CR 601.3b, 401.5, 702.8a: "You may cast noncreature spells from the top of your library. If you cast a spell this way, you may cast it as though it had flash."', () => {
  const SEER = card('Test Seer', 'Legendary Creature — Djinn', 'You may look at the top card of your library any time.\nYou may cast noncreature spells from the top of your library. If you cast a spell this way, you may cast it as though it had flash.', { pt: ['2', '2'] });
  const BOLT = card('Test Bolt', 'Sorcery', 'You gain 3 life.');
  it('is automated', () => expect(noManual(SEER)).toEqual([]));
  it('a noncreature spell on top of the library can be cast with a spell on the stack; a creature on top can not', () => {
    const s0 = scenario([], { defs: [SEER, FILLER, BOLT, BEAR], p1: { hand: ['Test Filler'], battlefield: ['Test Seer'], library: ['Test Bolt', 'Test Bear'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(castable(s)).toContain('Test Bolt');
    const t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bolt', 'library', 'p1') }));
    expect(stackNames(t)).toContain('Test Bolt');
    const s1 = scenario([], { defs: [SEER, FILLER, BOLT, BEAR], p1: { hand: ['Test Filler'], battlefield: ['Test Seer'], library: ['Test Bear', 'Test Bolt'] } });
    const u = settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Filler', 'hand', 'p1') }));
    expect(castable(u)).not.toContain('Test Bear');
  });
  it('without the rider (only "from the top") the spell is not castable at that time', () => {
    const PLAIN = card('Test Plain Seer', 'Legendary Creature — Djinn', 'You may cast noncreature spells from the top of your library.', { pt: ['2', '2'] });
    const s0 = scenario([], { defs: [PLAIN, FILLER, BOLT], p1: { hand: ['Test Filler'], battlefield: ['Test Plain Seer'], library: ['Test Bolt'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(castable(s)).not.toContain('Test Bolt');
  });
});

const methodsFor = (s: GameState, id: ObjectId, player: 'p1' | 'p2' = 'p1'): (string | undefined)[] =>
  legal(s, player, 'cast').filter((a) => (a as { object: ObjectId }).object === id).map((a) => (a.action as { method?: string }).method);
const grantedMethod = (s: GameState, id: ObjectId, player: 'p1' | 'p2' = 'p1'): string | undefined => methodsFor(s, id, player).find((m) => typeof m === 'string' && m.startsWith('grantedCost:'));

describe('CR 118.9, 601.3b, 102.1: "Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash."', () => {
  const ALUREN = card('Test Waystone', 'Enchantment', 'Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.', { cost: '{2}{G}{G}' });
  const SMALL = card('Test Small Elf', 'Creature — Elf', '', { cost: '{1}{G}', pt: ['1', '1'] });
  const BIG = card('Test Big Elf', 'Creature — Elf', '', { cost: '{3}{G}', pt: ['4', '4'] });
  const start = (): GameState => {
    const s0 = scenario([], { defs: [ALUREN, SMALL, BIG, FILLER, LAND], p1: { hand: ['Test Filler', 'Test Small Elf', 'Test Big Elf'], battlefield: ['Test Waystone', ...LANDS] }, p2: { hand: ['Test Small Elf', 'Test Big Elf'] } });
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') })); // p1's sorcery is on the stack
  };
  it('is automated', () => expect(noManual(ALUREN)).toEqual([]));
  it('the controller casts a mana value 2 creature for free with a spell on the stack; a mana value 4 creature is not offered', () => {
    const s = start();
    const small = find(s, 'Test Small Elf', 'hand', 'p1');
    expect(grantedMethod(s, small)).toBeDefined();
    expect(grantedMethod(s, find(s, 'Test Big Elf', 'hand', 'p1'))).toBeUndefined();
    const t = settle(act(s, { type: 'cast', player: 'p1', card: small, method: grantedMethod(s, small) } as never));
    expect(stackNames(t)).toContain('Test Small Elf');
    expect(t.objects[t.zones.stack[t.zones.stack.length - 1]!]!.stack?.costsPaid.alternative).toBe('granted');
  });
  it('the opponent (any player) casts it too, for free, with no land, when they receive priority', () => {
    const s = settle(pass(start()));
    const small = find(s, 'Test Small Elf', 'hand', 'p2');
    expect(grantedMethod(s, small, 'p2')).toBeDefined();
    const t = settle(act(s, { type: 'cast', player: 'p2', card: small, method: grantedMethod(s, small, 'p2') } as never));
    expect(stackNames(t)).toContain('Test Small Elf');
    expect(grantedMethod(s, find(s, 'Test Big Elf', 'hand', 'p2'), 'p2')).toBeUndefined();
  });
  it('the flash goes with the free cast only (2004-10-04 ruling): paying the mana cost the normal way with a spell on the stack is not offered', () => {
    const s = start();
    expect(methodsFor(s, find(s, 'Test Small Elf', 'hand', 'p1')).filter((m) => m === undefined)).toEqual([]);
  });
  it('without the enchantment nothing is offered', () => {
    const s0 = scenario([], { defs: [SMALL, FILLER], p1: { hand: ['Test Filler', 'Test Small Elf'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    expect(methodsFor(s, find(s, 'Test Small Elf', 'hand', 'p1'))).toEqual([]);
  });
});

describe('CR 118.9, 601.3b, 107.14, 702.8a: "You may cast creature spells with mana value 3 or less by paying {E} rather than paying their mana costs. If you cast a spell this way, you may cast it as though it had flash."', () => {
  const PRAYERS = card('Test Litany', 'Enchantment', 'You may cast creature spells with mana value 3 or less by paying {E} rather than paying their mana costs. If you cast a spell this way, you may cast it as though it had flash.', { cost: '{3}{G}' });
  const SMALL = card('Test Small Elf', 'Creature — Elf', '', { cost: '{1}{G}', pt: ['1', '1'] });
  const BIG = card('Test Big Elf', 'Creature — Elf', '', { cost: '{3}{G}', pt: ['4', '4'] });
  const start = (energy: number): GameState => {
    const s0 = scenario([], { defs: [PRAYERS, SMALL, BIG, FILLER], p1: { hand: ['Test Filler', 'Test Small Elf', 'Test Big Elf'], battlefield: ['Test Litany'] } });
    s0.players.find((p) => p.id === 'p1')!.counters['energy'] = energy;
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
  };
  it('is automated', () => expect(noManual(PRAYERS)).toEqual([]));
  it('with one energy a mana value 2 creature is cast with a spell on the stack, paying the energy; a mana value 4 creature is not offered', () => {
    const s = start(1);
    const small = find(s, 'Test Small Elf', 'hand', 'p1');
    expect(grantedMethod(s, small)).toBeDefined();
    expect(grantedMethod(s, find(s, 'Test Big Elf', 'hand', 'p1'))).toBeUndefined();
    const t = settle(act(s, { type: 'cast', player: 'p1', card: small, method: grantedMethod(s, small) } as never));
    expect(stackNames(t)).toContain('Test Small Elf');
    expect(t.players.find((p) => p.id === 'p1')!.counters['energy'] ?? 0).toBe(0);
  });
  it('with no energy it can not be cast that way, and with a spell on the stack not at all', () => {
    const s = start(0);
    expect(methodsFor(s, find(s, 'Test Small Elf', 'hand', 'p1'))).toEqual([]);
  });
  it('the flash goes with the alternative cost only: paying mana the normal way (no flash source) is not allowed with a spell on the stack', () => {
    const s = start(1);
    expect(methodsFor(s, find(s, 'Test Small Elf', 'hand', 'p1')).filter((m) => m === undefined)).toEqual([]);
  });
});

describe('CR 601.3b, 614.1c, 611.2a: "Until your next turn, you may cast creature spells as though they had flash, and each creature you control enters with an additional +1/+1 counter on it."', () => {
  const ARLINN = card('Test Packmaster', 'Legendary Planeswalker — Arlinn', '+1: Until your next turn, you may cast creature spells as though they had flash, and each creature you control enters with an additional +1/+1 counter on it.', { cost: '{2}{G}' });
  const SMALL = card('Test Small Elf', 'Creature — Elf', '', { cost: '{0}', pt: ['1', '1'] });
  it('is automated', () => expect(noManual(ARLINN)).toEqual([]));
  it('after the +1, a creature is cast with a spell on the stack and enters with a +1/+1 counter; before it, it could not be', () => {
    const before = scenario([], { defs: [ARLINN, SMALL, FILLER], p1: { hand: ['Test Filler', 'Test Small Elf'], battlefield: ['Test Packmaster'] } });
    const b = settle(act(before, { type: 'cast', player: 'p1', card: find(before, 'Test Filler', 'hand', 'p1') }));
    expect(castable(b)).not.toContain('Test Small Elf');
    let s = scenario([], { defs: [ARLINN, SMALL, FILLER], p1: { hand: ['Test Filler', 'Test Small Elf'], battlefield: [{ name: 'Test Packmaster', counters: { loyalty: 3 } }] } });
    const pw = find(s, 'Test Packmaster', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: pw, ability: 'p:0:0' } as never));
    s = settle(pass(pass(s)));
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Filler', 'hand', 'p1') }));
    expect(castable(s)).toContain('Test Small Elf');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Elf', 'hand', 'p1') }));
    s = settle(pass(pass(settle(pass(pass(s))))));
    const elf = find(s, 'Test Small Elf', 'battlefield', 'p1');
    expect(s.objects[elf]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 601.2f, 118.8, 401.5: "You may cast spells from the top of your library by sacrificing a nonland permanent in addition to paying their other costs."', () => {
  const PIT = card('Test Maw', 'Enchantment', 'You may look at the top card of your library any time.\nYou may cast spells from the top of your library by sacrificing a nonland permanent in addition to paying their other costs.', { cost: '{2}{B}' });
  const FALCO = card('Test Pactkeeper', 'Legendary Creature — Human', 'You may look at the top card of your library any time.\nYou may cast spells from the top of your library by removing a counter from a creature you control in addition to paying their other costs.', { cost: '{1}{G}', pt: ['2', '2'] });
  const SPELL = card('Test Gain', 'Sorcery', 'You gain 2 life.');
  it('are automated', () => { expect(noManual(PIT)).toEqual([]); expect(noManual(FALCO)).toEqual([]); });
  it('the top card is cast only with a nonland permanent to sacrifice, and the sacrifice is made', () => {
    const s0 = scenario([], { defs: [PIT, SPELL, BEAR, LAND], p1: { battlefield: ['Test Maw', 'Test Bear'], library: ['Test Gain', 'Test Bear'] } });
    expect(castable(s0)).toContain('Test Gain');
    const t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gain', 'library', 'p1') }), [{ kind: 'chooseObjects', ids: [find(s0, 'Test Bear', 'battlefield', 'p1')] } as never]);
    expect(stackNames(t)).toContain('Test Gain');
    expect(find(t, 'Test Bear', 'graveyard', 'p1')).toBeDefined();
  });
  it('with only lands to sacrifice (the Maw itself is a nonland permanent, so remove it) nothing is offered', () => {
    const s0 = scenario([], { defs: [PIT, SPELL, LAND], p1: { battlefield: ['Test Land'], library: ['Test Gain'] } });
    expect(castable(s0)).not.toContain('Test Gain');
  });
  it('the counter version needs a creature with a counter', () => {
    const none = scenario([], { defs: [FALCO, SPELL], p1: { battlefield: ['Test Pactkeeper'], library: ['Test Gain'] } });
    expect(castable(none)).not.toContain('Test Gain');
    const some = scenario([], { defs: [FALCO, SPELL], p1: { battlefield: [{ name: 'Test Pactkeeper', counters: { '+1/+1': 1 } }], library: ['Test Gain'] } });
    expect(castable(some)).toContain('Test Gain');
    const t = settle(act(some, { type: 'cast', player: 'p1', card: find(some, 'Test Gain', 'library', 'p1') }));
    expect(stackNames(t)).toContain('Test Gain');
    expect(t.objects[find(t, 'Test Pactkeeper', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 702.11b, 115.1, 609.4: "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn\'t have hexproof."', () => {
  const SPOT = card('Test Spotlight', 'Artifact', 'Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn\'t have hexproof.\n{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can\'t be blocked this turn.');
  const HEX = card('Test Hexer', 'Creature — Elf', 'Hexproof', { pt: ['2', '2'] });
  const SHOT = card('Test Shot', 'Instant', 'Test Shot deals 1 damage to target creature.');
  it('is automated', () => expect(noManual(SPOT)).toEqual([]));
  it('with the Spotlight the opponent\'s hexproof creature can be targeted by its spell; without it, it can not', () => {
    const withIt = scenario([], { defs: [SPOT, HEX, SHOT], p1: { hand: ['Test Shot'], battlefield: ['Test Spotlight'] }, p2: { battlefield: ['Test Hexer'] } });
    const t = settle(act(withIt, { type: 'cast', player: 'p1', card: find(withIt, 'Test Shot', 'hand', 'p1') }));
    expect(t.pending?.kind).toBe('chooseTargets');
    const ok = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Hexer', 'battlefield', 'p2') }] });
    expect(stackNames(ok)).toContain('Test Shot');
    const without = scenario([], { defs: [HEX, SHOT], p1: { hand: ['Test Shot'] }, p2: { battlefield: ['Test Hexer'] } });
    expect(castable(without)).not.toContain('Test Shot');
  });
  it('an opponent\'s Spotlight gives its controller the waiver, not you', () => {
    const s = scenario([], { defs: [SPOT, HEX, SHOT], p1: { hand: ['Test Shot'] }, p2: { battlefield: ['Test Spotlight', 'Test Hexer'] } });
    expect(castable(s)).not.toContain('Test Shot');
  });
});

describe('CR 702.80a, 120.3d, 122.6: "All damage is dealt as though its source had wither."', () => {
  const TORMENT = card('Test Blight', 'Enchantment', 'All damage is dealt as though its source had wither.');
  const SHOT = card('Test Shot', 'Instant', 'Test Shot deals 1 damage to target creature.');
  const BURN = card('Test Burn', 'Instant', 'Test Burn deals 2 damage to target player.');
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['3', '3'] });
  const run = (withBlight: boolean): GameState => {
    const s0 = scenario([], { defs: [TORMENT, SHOT, GIANT], p1: { hand: ['Test Shot'], battlefield: withBlight ? ['Test Blight'] : [] }, p2: { battlefield: ['Test Giant'] } });
    const t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shot', 'hand', 'p1') }));
    const u = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Giant', 'battlefield', 'p2') }] });
    return settle(pass(pass(settle(pass(pass(u))))));
  };
  it('is automated', () => expect(noManual(TORMENT)).toEqual([]));
  it('with it, damage to a creature puts -1/-1 counters on it instead of marking damage', () => {
    const s = run(true);
    const giant = s.objects[find(s, 'Test Giant', 'battlefield', 'p2')]!;
    expect(giant.counters['-1/-1']).toBe(1);
    expect(giant.damage).toBe(0);
  });
  it('without it, the same damage is marked on the creature, no counter', () => {
    const s = run(false);
    const giant = s.objects[find(s, 'Test Giant', 'battlefield', 'p2')]!;
    expect(giant.counters['-1/-1'] ?? 0).toBe(0);
    expect(giant.damage).toBe(1);
  });
  it('damage to a player is still life loss', () => {
    const s0 = scenario([], { defs: [TORMENT, BURN], p1: { hand: ['Test Burn'], battlefield: ['Test Blight'] } });
    const t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn', 'hand', 'p1') }));
    const u = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    const v = settle(pass(pass(settle(pass(pass(u))))));
    expect(v.players.find((p) => p.id === 'p2')!.life).toBe(18);
  });
});

describe('CR 611.2c, 613.1f, 509.1b: "{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can\'t be blocked this turn." (Glaring Spotlight, 2013-01-24 rulings)', () => {
  const SPOT = card('Test Spotlight', 'Artifact', '{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can\'t be blocked this turn.');
  const FLASHER = card('Test Flasher', 'Creature — Elf', 'Flash', { pt: ['1', '1'] });
  it('the creatures there gain hexproof until end of turn; one that arrives afterwards does not (a gain is locked in, CR 611.2c)', async () => {
    const { getChars, hasKeyword } = await import('../../../src/rules/characteristics');
    let s = scenario([], { defs: [SPOT, BEAR, FLASHER, LAND], p1: { hand: ['Test Flasher'], battlefield: ['Test Spotlight', 'Test Bear', ...LANDS] } });
    const spot = find(s, 'Test Spotlight', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: spot, ability: 'p:0:0' } as never));
    s = settle(pass(pass(s)));
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, bear), 'hexproof')).toBe(true);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flasher', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    const late = find(s, 'Test Flasher', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, late), 'hexproof')).toBe(false);
  });
});

describe('edh-d-44 review: two top-card permissions with added costs (Into the Pit and Falco Spara together)', () => {
  const PIT = card('Test Maw', 'Enchantment', 'You may look at the top card of your library any time.\nYou may cast spells from the top of your library by sacrificing a nonland permanent in addition to paying their other costs.');
  const FALCO = card('Test Pactkeeper', 'Legendary Creature — Human', 'You may cast spells from the top of your library by removing a counter from a creature you control in addition to paying their other costs.', { pt: ['2', '2'] });
  const SPELL = card('Test Gain', 'Sorcery', 'You gain 2 life.');
  it('a permission whose cost can not be paid does not hide the other: no counter anywhere, the sacrifice still works (either battlefield order)', () => {
    for (const order of [['Test Pactkeeper', 'Test Maw'], ['Test Maw', 'Test Pactkeeper']]) {
      const s0 = scenario([], { defs: [PIT, FALCO, SPELL], p1: { battlefield: order, library: ['Test Gain'] } });
      expect(castable(s0), order.join()).toContain('Test Gain');
    }
  });
});
