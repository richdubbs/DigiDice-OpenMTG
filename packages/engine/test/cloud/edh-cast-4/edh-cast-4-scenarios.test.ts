/**
 * edh-cast-4 scenarios (Commander lane edh-cast): the casting rules of the round, played through the engine with synthetic cards (invented names) compiled by the game's
 * default compiler. Rules (Comprehensive Rules 2026-09-25, cited from the real text):
 *   CR 202.3, 601.3, 101.2  "Your opponents can't cast spells with even mana values" (Void Winnower): zero is even; a spell with {X} has the value chosen for X (CR 202.3e)
 *   CR 509.1b, 101.2, 202.3         "Your opponents can't block with creatures with even mana values": a creature on the battlefield counts {X} as 0 (CR 202.3e)
 *   CR 601.3b, 702.8a, 609.4        "Any player may cast Sliver spells as though they had flash" (Quick Sliver, Tidal Barracuda)
 *   CR 401.5, 305.1, 601.3, 611.3a  "As long as you've cast a spell this turn, you may play cards from the top of your library" (Fortune Teller's Talent)
 *   CR 601.2f, 118.7               "This effect reduces only the amount of colored mana you pay" (Morophon, the Boundless): a reduction of colored mana never pays generic mana
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const give = (s: GameState, player: string, mana: string): void => { for (const t of mana) s.players.find((p) => p.id === player)!.manaPool.push({ type: t } as never); };
const canCast = (s: GameState, id: ObjectId, player = 'p1'): boolean => {
  try { return settle(act(s, { type: 'cast', player, card: id })).zones.stack.length > 0; } catch { return false; }
};
const hand = (s: GameState, name: string, player = 'p1'): ObjectId => find(s, name, 'hand', player);

describe('CR 202.3, 601.3: "Your opponents can\'t cast spells with even mana values"', () => {
  const WINNOWER = card('Test Winnower', 'Creature — Eldrazi', "Your opponents can't cast spells with even mana values.\nYour opponents can't block with creatures with even mana values.", { pt: ['3', '2'], cost: '{4}' });
  const ZERO = card('Test Zero', 'Artifact', '', { cost: '{0}' });
  const ONE = card('Test One', 'Artifact', '', { cost: '{1}' });
  const TWO = card('Test Two', 'Artifact', '', { cost: '{2}' });
  const THREE = card('Test Three', 'Artifact', '', { cost: '{3}' });
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', { cost: '{X}' });
  const defs = [WINNOWER, ZERO, ONE, TWO, THREE, SIP];
  const setup = (winnower: boolean): GameState => {
    const s = advanceTo(scenario([], { p1: { battlefield: winnower ? ['Test Winnower'] : [], hand: ['Test Two'] }, p2: { hand: ['Test Zero', 'Test One', 'Test Two', 'Test Three', 'Test Sip'] }, defs }), 2, 'main1');
    give(s, 'p2', 'GGGGGGG');
    return s;
  };
  it('an opponent casts the odd spells (mana value 1, 3) and not the even ones (0, 2); zero is even', () => {
    const s = setup(true);
    expect(canCast(s, hand(s, 'Test One', 'p2'), 'p2')).toBe(true);
    expect(canCast(s, hand(s, 'Test Three', 'p2'), 'p2')).toBe(true);
    expect(canCast(s, hand(s, 'Test Two', 'p2'), 'p2')).toBe(false);
    expect(canCast(s, hand(s, 'Test Zero', 'p2'), 'p2')).toBe(false);
  });
  it('without it the even spells are cast', () => {
    const s = setup(false);
    expect(canCast(s, hand(s, 'Test Two', 'p2'), 'p2')).toBe(true);
    expect(canCast(s, hand(s, 'Test Zero', 'p2'), 'p2')).toBe(true);
  });
  it('the controller is not restricted (only "your opponents"): they cast the even spell on their own turn', () => {
    const s = scenario([], { p1: { battlefield: ['Test Winnower'], hand: ['Test Two'] }, defs });
    give(s, 'p1', 'GG');
    expect(canCast(s, hand(s, 'Test Two'))).toBe(true);
  });
  it('a spell with {X} has the value chosen for X (CR 202.3e; the ruling of 2015-08-25): X = 5 is cast, X = 6 is not', () => {
    const s = setup(true);
    const start = (n: number): GameState => {
      const t = act(s, { type: 'cast', player: 'p2', card: hand(s, 'Test Sip', 'p2') });
      expect(t.pending).toMatchObject({ kind: 'chooseNumber' });
      return answer(t, { kind: 'chooseNumber', n });
    };
    const odd = settle(start(5));
    expect(odd.zones.stack.length).toBe(1);
    expect(() => start(6)).toThrow(/not allowed|can.t pay|not offered|not one of/i);
    expect(settle(start(3)).zones.stack.length).toBe(1);
    // and without the Winnower X = 6 is fine
    const free = setup(false);
    const t = answer(act(free, { type: 'cast', player: 'p2', card: hand(free, 'Test Sip', 'p2') }), { kind: 'chooseNumber', n: 6 });
    expect(settle(t).zones.stack.length).toBe(1);
  });
});

describe('CR 107.3b, 202.3e, 702.85a: a spell with {X} cast without announcing X (cascade) has X = 0, an even mana value', () => {
  const WINNOWER = card('Test Winnower', 'Creature — Eldrazi', "Your opponents can't cast spells with even mana values.", { pt: ['3', '2'], cost: '{4}' });
  const CASC = card('Test Cascader', 'Creature — Bear', 'Cascade', { pt: ['2', '2'], cost: '{3}' });
  const XBEAR = card('Test Xbear', 'Creature — Hydra', '', { pt: ['1', '1'], cost: '{X}' });
  const defs = [WINNOWER, CASC, XBEAR];
  const run = (winnower: boolean): GameState => {
    let s = scenario([], { p1: { battlefield: winnower ? ['Test Winnower'] : [] }, p2: { hand: ['Test Cascader'], library: ['Test Xbear', 'Test Xbear'] /* the first is drawn in the draw step of turn 2 */ }, defs });
    s = advanceTo(s, 2, 'main1');
    give(s, 'p2', 'GGG');
    return resolveAll(settle(act(s, { type: 'cast', player: 'p2', card: hand(s, 'Test Cascader', 'p2') })));
  };
  const xbearOnBattlefield = (s: GameState): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Xbear');
  it('the cascaded {X} creature is cast with X = 0 without the Winnower, and not with it (it goes to the bottom of the library)', () => {
    expect(xbearOnBattlefield(run(false))).toBe(true);
    const s = run(true);
    expect(xbearOnBattlefield(s)).toBe(false);
    expect(s.zones.library['p2']!.some((id) => s.objects[id]!.defId === 'Test Xbear')).toBe(true);
  });
});

describe('CR 509.1b, 202.3: "Your opponents can\'t block with creatures with even mana values"', () => {
  const WINNOWER = card('Test Winnower', 'Creature — Eldrazi', "Your opponents can't cast spells with even mana values.\nYour opponents can't block with creatures with even mana values.", { pt: ['3', '2'], cost: '{4}' });
  const RAIDER = card('Test Raider', 'Creature — Goblin', '', { pt: ['1', '1'], cost: '{1}' });
  const EVEN = card('Test Evenguard', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{2}' });
  const ODD = card('Test Oddguard', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{3}' });
  const FREE = card('Test Zeroguard', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{0}' });
  const XGUARD = card('Test Xguard', 'Creature — Hydra', '', { pt: ['1', '1'], cost: '{X}' });
  const defs = [WINNOWER, RAIDER, EVEN, ODD, FREE, XGUARD];
  const blockers = (winnower: boolean, name: string): GameState => {
    let s = scenario([], { p1: { battlefield: winnower ? ['Test Raider', 'Test Winnower'] : ['Test Raider'] }, p2: { battlefield: [name] }, defs });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Raider', 'battlefield', 'p1')]]);
    return toDeclareBlockers(s);
  };
  /** Can the named creature of p2 block the Raider? (no creature able to block: the game asks for no declaration at all) */
  const tryBlock = (name: string, winnower: boolean): boolean => {
    let s: GameState;
    try { s = blockers(winnower, name); } catch { return false; }
    try { return declareBlockers(s, [[find(s, name, 'battlefield', 'p2'), find(s, 'Test Raider', 'battlefield', 'p1')]]).pending?.kind !== 'declareBlockers'; } catch { return false; }
  };
  it('a creature with an odd mana value blocks; one with an even mana value (2, or 0) does not', () => {
    expect(tryBlock('Test Oddguard', true)).toBe(true);
    expect(tryBlock('Test Evenguard', true)).toBe(false);
    expect(tryBlock('Test Zeroguard', true)).toBe(false);
  });
  it('without it the even creature blocks', () => {
    expect(tryBlock('Test Evenguard', false)).toBe(true);
  });
  it('a creature on the battlefield with {X} in its mana cost has X = 0, so it is even and does not block (the ruling of 2015-08-25)', () => {
    expect(tryBlock('Test Xguard', true)).toBe(false);
    expect(tryBlock('Test Xguard', false)).toBe(true);
  });
  it('only the opponents\' creatures: the Winnower controller\'s own even creature still blocks on the other player\'s attack', () => {
    let s = scenario([], { p1: { battlefield: ['Test Winnower', 'Test Evenguard'] }, p2: { battlefield: ['Test Raider'] }, defs });
    s = advanceTo(s, 2, 'main1');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Raider', 'battlefield', 'p2')]]);
    s = toDeclareBlockers(s);
    expect(declareBlockers(s, [[find(s, 'Test Evenguard', 'battlefield', 'p1'), find(s, 'Test Raider', 'battlefield', 'p2')]]).pending?.kind).not.toBe('declareBlockers');
  });
});

describe('CR 601.3b, 702.8a, 609.4: "Any player may cast Sliver spells as though they had flash"', () => {
  const QUICK = card('Test Quick', 'Creature — Sliver', 'Any player may cast Sliver spells as though they had flash.', { pt: ['1', '1'], cost: '{1}' });
  const PUP = card('Test Pup', 'Creature — Sliver', '', { pt: ['1', '1'], cost: '{1}' });
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{1}' });
  const ANY = card('Test Anything', 'Artifact', 'Any player may cast spells as though they had flash.', { cost: '{1}' });
  const defs = [QUICK, PUP, CUB, ANY];
  const atP2Priority = (battlefield: string[], p1hand: string[] = []): GameState => {
    const s = pass(scenario([], { p1: { battlefield, hand: p1hand }, p2: { hand: ['Test Pup', 'Test Cub'] }, defs })); // p1 passes in their main phase: p2 has priority on p1's turn
    give(s, 'p2', 'GG');
    return s;
  };
  it('an opponent casts a Sliver creature spell on the controller\'s turn and not a Bear', () => {
    const s = atP2Priority(['Test Quick']);
    expect(s.pending!.player).toBe('p2');
    expect(canCast(s, hand(s, 'Test Pup', 'p2'), 'p2')).toBe(true);
    expect(canCast(s, hand(s, 'Test Cub', 'p2'), 'p2')).toBe(false);
  });
  it('without it neither is castable at that time', () => {
    const s = atP2Priority([]);
    expect(canCast(s, hand(s, 'Test Pup', 'p2'), 'p2')).toBe(false);
  });
  it('"any player" includes the controller: on the opponent\'s turn they cast their Sliver', () => {
    let s = scenario([], { p1: { battlefield: ['Test Quick'], hand: ['Test Pup', 'Test Cub'] }, defs });
    s = advanceTo(s, 2, 'main1');
    s = pass(s); // p2 (active) passes in their main phase: p1 has priority with an empty stack
    give(s, 'p1', 'GG');
    expect(s.pending!.player).toBe('p1');
    expect(canCast(s, hand(s, 'Test Pup'))).toBe(true);
    expect(canCast(s, hand(s, 'Test Cub'))).toBe(false);
  });
  it('the permission with no description lets every spell be cast at that time', () => {
    const s = atP2Priority(['Test Anything']);
    expect(canCast(s, hand(s, 'Test Cub', 'p2'), 'p2')).toBe(true);
  });
});

describe('CR 401.5, 305.1, 601.3, 611.3a: "As long as you\'ve cast a spell this turn, you may play cards from the top of your library"', () => {
  const TALENT = card('Test Talent', 'Enchantment', "You may look at the top card of your library any time.\nAs long as you've cast a spell this turn, you may play cards from the top of your library.");
  const SPELL = card('Test Cantrip', 'Instant', 'You gain 1 life.', { cost: '{0}' });
  const TOPSPELL = card('Test Topper', 'Artifact', '', { cost: '{0}' });
  const TOPLAND = card('Test Lair', 'Land', '');
  const defs = [TALENT, SPELL, TOPSPELL, TOPLAND];
  const mk = (top: string, talent = true): GameState => scenario([], { p1: { battlefield: talent ? [{ name: 'Test Talent', since: 1 }] : [], hand: ['Test Cantrip'], library: [top, 'Test Topper'] }, p2: { library: ['Test Topper', 'Test Topper'] }, defs });
  /** p1's legal actions about the card on top of the given player's library */
  const topActions = (s: GameState, who = 'p1'): string[] => legalActions(s, 'p1').filter((a) => a.object === s.zones.library[who]![0]).map((a) => a.label);
  const afterCantrip = (s: GameState): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: hand(s, 'Test Cantrip') })));
  it('before a spell is cast this turn the top card can\'t be cast or played; after one it can (a spell, then a land)', () => {
    const s = mk('Test Topper');
    expect(topActions(s).some((l) => /cast/i.test(l))).toBe(false);
    expect(topActions(afterCantrip(s)).some((l) => /cast/i.test(l))).toBe(true);
    const l = mk('Test Lair');
    expect(topActions(l).some((x) => /play/i.test(x))).toBe(false);
    expect(topActions(afterCantrip(l)).some((x) => /play/i.test(x))).toBe(true);
  });
  it('only your own library: the opponent\'s top card is not available even after you cast a spell', () => {
    const t = afterCantrip(mk('Test Topper'));
    expect(topActions(t, 'p2')).toEqual([]);
  });
  it('without the permanent nothing changes', () => {
    const t = afterCantrip(mk('Test Topper', false));
    expect(topActions(t)).toEqual([]);
  });
});

describe('CR 601.2f, 118.7: "This effect reduces only the amount of colored mana you pay"', () => {
  const MORPH = card('Test Reducer', 'Enchantment', 'Creature spells you cast cost {W}{U} less to cast. This effect reduces only the amount of colored mana you pay.');
  const HYBRID = card('Test Pair', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}{W}{U}', colors: ['W', 'U'] });
  const BIGCOLOR = card('Test Zealot', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{W}{W}', colors: ['W'] });
  const COLORLESS = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'], cost: '{4}' });
  const RED = card('Test Imp', 'Creature — Imp', '', { pt: ['2', '2'], cost: '{3}{R}', colors: ['R'] });
  const defs = [MORPH, HYBRID, BIGCOLOR, COLORLESS, RED];
  const mk = (withReducer: boolean): GameState => scenario([], { p1: { battlefield: withReducer ? ['Test Reducer'] : [], hand: ['Test Pair', 'Test Zealot', 'Test Golem', 'Test Imp'] }, defs });
  it('{2}{W}{U} costs {2}: the colored part is gone, the generic part is not', () => {
    const s = mk(true);
    give(s, 'p1', 'GG');
    expect(canCast(s, hand(s, 'Test Pair'))).toBe(true);
    const t = mk(false);
    give(t, 'p1', 'GG');
    expect(canCast(t, hand(t, 'Test Pair'))).toBe(false);
  });
  it('{W}{W} costs {W}: only the colored symbols of the colors named are reduced, once each', () => {
    const s = mk(true);
    give(s, 'p1', 'W');
    expect(canCast(s, hand(s, 'Test Zealot'))).toBe(true);
    const t = mk(true);
    expect(canCast(t, hand(t, 'Test Zealot'))).toBe(false);
  });
  it('a colorless artifact creature is not reduced ({4} stays {4}), nor is the red part of {3}{R}', () => {
    const s = mk(true);
    give(s, 'p1', 'GGG');
    expect(canCast(s, hand(s, 'Test Golem'))).toBe(false);
    expect(canCast(s, hand(s, 'Test Imp'))).toBe(false);
    give(s, 'p1', 'G');
    expect(canCast(s, hand(s, 'Test Golem'))).toBe(true);
  });
});
