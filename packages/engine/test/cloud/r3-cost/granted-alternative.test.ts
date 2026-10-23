/**
 * r3-cost: alternative costs a static ability gives other spells (statics/play-permits.ts#isAltCostPermit / #grantedAlternatives, actions/cast.ts, core/legal.ts),
 * played through the engine with synthetic cards compiled from invented wordings (design 6.10).
 *
 *   CR 118.9, 601.2b      "You may pay {G} rather than pay the mana cost for creature spells you cast": a cast method of its own; the spell is paid with {G}
 *   CR 118.9, 601.2b      "You may cast creature spells from your hand without paying their mana costs": nothing to pay, from the hand only (CR 601.2a)
 *   CR 601.3              it permits nothing: a card in exile is cast this way only when another effect lets it be cast from there
 *   CR 118.9, 400.7       "Once each turn, ... for a spell you cast from exile": one spell each turn, again on the next turn
 *   CR 118.9d             additional costs and cost increases still apply; CR 107.3b: X is 0
 *   CR 113.6, 611.3a      without the source, or for an opponent, nothing is offered
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { isAltCostPermit, isGrantedAltMethod } from '../../../src/statics/play-permits';
import type { PermissionDef } from '../../../src/types/ability';
import { act, activations, advanceTo, card, drive, find, full, legal, named, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const GROVE = card('Test Verdant Shrine', 'Enchantment', 'You may pay {G} rather than pay the mana cost for creature spells you cast.', '{2}{G}');
const LIBRARY = card('Test Endless Library', 'Enchantment', 'You may cast creature spells from your hand without paying their mana costs.', '{7}{U}');
const ELFHALL = card('Test Elf Hall', 'Enchantment', 'You may cast Elf spells without paying their mana costs.', '{4}{G}');
const PORTAL = card('Test Exile Portal', 'Artifact', 'Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile.\n{T}: Exile the top card of your library. You may play that card this turn.', '{2}');
const GIANT = card('Test Hill Giant', 'Creature — Giant', '', '{5}', ['5', '5']);
const ELF = card('Test Elf Scout', 'Creature — Elf Scout', '', '{3}{G}', PT);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', '{4}{R}');
const HYDRA = card('Test Hydra', 'Creature — Hydra', 'Test Hydra enters with X +1/+1 counters on it.', '{X}{G}', ['0', '0']);
const RAVAGER = card('Test Ravager', 'Creature — Beast', 'As an additional cost to cast this spell, discard a card.', '{4}', ['4', '4']);
const TAXER = card('Test Taxer', 'Creature — Human', 'Creature spells cost {1} more to cast.', '{W}', PT);
const DEFS = [GROVE, LIBRARY, ELFHALL, PORTAL, GIANT, ELF, BOLT, HYDRA, RAVAGER, TAXER];

/** p1's cast actions for a card, by method (undefined: the normal cost). */
const castMethodsFor = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): (string | undefined)[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);
const granted = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): string | undefined => castMethodsFor(s, id, player).find((m) => isGrantedAltMethod(m));
const castWith = (s: GameState, id: ObjectId, method: string, player: PlayerId = 'p1', script?: Parameters<typeof drive>[1]): GameState =>
  drive(act(s, { type: 'cast', player, card: id, method }), script);

describe('r3-cost: the permission form and its capability (fail closed)', () => {
  it('the cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });
  it('isAltCostPermit honors exactly the form the engine reads', () => {
    const p: PermissionDef = { s: 'permit', who: { ref: 'you' }, action: 'cast', of: { types: ['Creature'] }, costChange: { kind: 'set', cost: { mana: [{ kind: 'colored', color: 'G' }] } } };
    expect(isAltCostPermit(p)).toBe(true);
    expect(isAltCostPermit({ ...p, oncePerTurn: true })).toBe(true);
    expect(isAltCostPermit({ ...p, costChange: { kind: 'set', cost: {} } })).toBe(true);
    expect(isAltCostPermit({ ...p, from: 'graveyard' })).toBe(false); // a permission to cast from a zone too: another form
    expect(isAltCostPermit({ ...p, costChange: { kind: 'reduce', generic: 1 } })).toBe(false);
    expect(isAltCostPermit({ ...p, costChange: { kind: 'set', cost: {}, generic: 1 } })).toBe(false);
    expect(isAltCostPermit({ ...p, who: { ref: 'each' } as unknown as PermissionDef['who'] })).toBe(false);
    expect(isAltCostPermit({ ...p, anyManaType: true })).toBe(false);
    expect(isAltCostPermit({ ...p, of: { is: { ref: 'self' } } })).toBe(false);
  });
  it('a card\'s own second alternative cost named "alternative" (alternative:2) is not a granted method', () => {
    expect(isGrantedAltMethod('alternative:2')).toBe(false);
    expect(isGrantedAltMethod('grantedCost:o1:0:0')).toBe(true);
  });
});

describe('CR 118.9, 601.2b: "You may pay {G} rather than pay the mana cost for creature spells you cast"', () => {
  it('a {5} creature is cast for {G} with one Forest; without the shrine it is not castable', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Verdant Shrine', 'Forest'], hand: ['Test Hill Giant'] } });
    const giant = find(s, 'Test Hill Giant', 'hand', 'p1');
    expect(castMethodsFor(s, giant)).toEqual([granted(s, giant)]); // only the alternative cost is payable
    s = resolveAll(castWith(s, giant, granted(s, giant)!));
    expect(named(s, 'Test Hill Giant')).toHaveLength(1);
    const without = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Forest'], hand: ['Test Hill Giant'] } });
    expect(castMethodsFor(without, find(without, 'Test Hill Giant', 'hand', 'p1'))).toEqual([]);
  });
  it('a noncreature spell is not covered; an opponent\'s creature spell is not either', () => {
    const s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Verdant Shrine', 'Forest'], hand: ['Test Bolt'] }, p2: { hand: ['Test Hill Giant'], battlefield: ['Forest'] } });
    expect(granted(s, find(s, 'Test Bolt', 'hand', 'p1'))).toBeUndefined();
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p2'), 'p2')).toBeUndefined();
  });
  it('CR 107.3b: X is 0 for an X spell cast this way', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Verdant Shrine', 'Forest'], hand: ['Test Hydra'] } });
    const hydra = find(s, 'Test Hydra', 'hand', 'p1');
    s = resolveAll(castWith(s, hydra, granted(s, hydra)!));
    const [id] = named(s, 'Test Hydra');
    expect(id).toBeUndefined(); // a 0/0 with no counters dies (CR 704.5f)
  });
  it('CR 118.9d: a cost increase applies to the alternative cost: with "Creature spells cost {1} more", {G} becomes {1}{G}', () => {
    const one = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Verdant Shrine', 'Test Taxer', 'Forest'], hand: ['Test Hill Giant'] } });
    expect(granted(one, find(one, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
    const two = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Verdant Shrine', 'Test Taxer', 'Forest', 'Forest'], hand: ['Test Hill Giant'] } });
    expect(granted(two, find(two, 'Test Hill Giant', 'hand', 'p1'))).toBeDefined();
  });
});

describe('CR 118.9, 601.2a: "You may cast creature spells from your hand without paying their mana costs"', () => {
  it('a {5} creature is cast with no land at all; the spell records the alternative cost', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Endless Library'], hand: ['Test Hill Giant'] } });
    const giant = find(s, 'Test Hill Giant', 'hand', 'p1');
    s = castWith(s, giant, granted(s, giant)!);
    const top = s.objects[s.zones.stack[s.zones.stack.length - 1]!]!;
    expect(top.stack?.costsPaid.alternative).toBe('granted');
    s = resolveAll(s);
    expect(named(s, 'Test Hill Giant')).toHaveLength(1);
  });
  it('CR 118.9d: a mandatory additional cost is still paid: the Ravager needs a card to discard', () => {
    const none = scenario([], { defs: DEFS, p1: { battlefield: ['Test Endless Library'], hand: ['Test Ravager'] } });
    expect(granted(none, find(none, 'Test Ravager', 'hand', 'p1'))).toBeUndefined();
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Endless Library'], hand: ['Test Ravager', 'Test Bolt'] } });
    const ravager = find(s, 'Test Ravager', 'hand', 'p1');
    s = resolveAll(castWith(s, ravager, granted(s, ravager)!, 'p1', { objects: [[find(s, 'Test Bolt', 'hand', 'p1')]] }));
    expect(named(s, 'Test Ravager')).toHaveLength(1);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Bolt');
  });
  it('"Elf spells without paying their mana costs": an Elf is free, a Giant is not', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Elf Hall'], hand: ['Test Elf Scout', 'Test Hill Giant'] } });
    expect(granted(s, find(s, 'Test Elf Scout', 'hand', 'p1'))).toBeDefined();
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
  });
});

describe('CR 118.9, 601.3, 400.7: "Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile"', () => {
  const exileTop = (s0: GameState): GameState => {
    const [use] = activations(s0, 'Test Exile Portal').filter((a) => /Exile the top/.test(a.label));
    return resolveAll(drive(act(s0, use!.action)));
  };
  it('a card exiled with "you may play that card this turn" is cast for {0}; on the next turn another one is too', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Exile Portal'], library: ['Test Hill Giant', 'Test Hill Giant', 'Test Hill Giant'] } });
    s = exileTop(s);
    const first = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Hill Giant')!;
    const m = granted(s, first);
    expect(m).toBeDefined();
    s = resolveAll(castWith(s, first, m!));
    expect(named(s, 'Test Hill Giant')).toHaveLength(1);
    s = advanceTo(s, 3, 'main1'); // the Portal untaps; a new turn, a new use (CR 118.9: "once each turn")
    s = exileTop(s);
    const second = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Hill Giant')!;
    expect(granted(s, second)).toBeDefined();
    s = resolveAll(castWith(s, second, granted(s, second)!));
    expect(named(s, 'Test Hill Giant')).toHaveLength(2);
  });
  it('the limit is once each turn: after one spell for {0}, the next exiled card that turn is not offered for {0}', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Exile Portal', { name: 'Test Exile Portal' }], library: ['Test Hill Giant', 'Test Hill Giant'] } });
    s = exileTop(s);
    const first = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Hill Giant')!;
    // two Portals: each has its own once-each-turn use (CR 400.7: two objects); use the first one's
    const methods = castMethodsFor(s, first).filter((x) => isGrantedAltMethod(x));
    expect(methods).toHaveLength(2);
    s = resolveAll(castWith(s, first, methods[0]!));
    const [second] = legal(s, 'p1', 'activate').filter((a) => /Exile the top/.test(a.label)); // the other Portal's
    s = resolveAll(drive(act(s, second!.action)));
    const next = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Hill Giant')!;
    expect(castMethodsFor(s, next).filter((x) => isGrantedAltMethod(x))).toEqual([methods[1]]);
  });
  it('CR 601.3: it permits nothing: a card in the hand is not covered, and a card in exile with no permission is not castable', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Exile Portal'], hand: ['Test Hill Giant'], exile: ['Test Hill Giant'] } });
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
    const exiled = find(s, 'Test Hill Giant', 'exile', 'p1');
    expect(castMethodsFor(s, exiled)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: exiled, method: 'grantedCost:x:0:0' }).error).toBeDefined();
  });
});
