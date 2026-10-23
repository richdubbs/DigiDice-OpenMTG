/**
 * FAST3 T15 (template family R2-A): the player rules, cast-as-though-flash permissions and enters-tapped / enters-with statics of
 * parser/templates/zz-fast3/t15.json and the readings render/ learned for them, played through applyAction with synthetic cards compiled by the game's
 * default compiler (wordings are invented, design 6.10).
 *
 *   CR 119.7, 101.2        "Your opponents can't gain life", "Players can't gain life", "Your opponents can't gain life this turn"
 *   CR 601.3, 500.1        "Your opponents can't cast spells during your turn"
 *   CR 702.11c, 115.1      "You have hexproof": not the target of an opponent's spell; your own spells may target you
 *   CR 702.18a             "You have shroud": nobody may target you
 *   CR 601.3b, 702.8a      "You may cast creature spells as though they had flash", the two-filter form, and the resolved "this turn" form
 *   CR 614.1d, 119.1       "~ enters tapped unless a player has 13 or less life"
 *   CR 614.1d, 502.3       "~ enters tapped and doesn't untap during your untap step"
 *   CR 614.1c, 601.2a      "~ enters with a divinity counter on it if you cast it from your hand"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, legal, life, pass, passBoth, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability automated (no manual ability, no manual step). */
const automatedAll = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** Every ability automated and the card full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && automatedAll(d);

const SALVE = card('Test Salve', 'Instant', 'You gain 3 life.');
const PING = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to any target.');
const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '2']);
const GADGET = card('Test Gadget', 'Artifact', '');
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');

/** Give priority to p2 in p1's first main phase (p1 passes with an empty stack). */
const toP2 = (s: GameState): GameState => act(s, { type: 'pass', player: 'p1' });
const castable = (s: GameState, player: PlayerId, name: string): boolean => {
  const ids = Object.values(s.zones.hand).flat().filter((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.owner === player);
  return legal(s, player, 'cast').some((a) => ids.includes((a.action as { card?: string }).card ?? ''));
};
const setLife = (s: GameState, p: PlayerId, n: number): GameState => tweak(s, (t) => { t.players.find((x) => x.id === p)!.life = n; });

describe('CR 119.7: "Your opponents can\'t gain life" and "Players can\'t gain life"', () => {
  const LEECH = card('Test Leech Totem', 'Enchantment', "Your opponents can't gain life.");
  const DROUGHT = card('Test Drought Totem', 'Enchantment', "Players can't gain life.");
  it('both cards are automated', () => {
    expect(full(LEECH)).toBe(true);
    expect(full(DROUGHT)).toBe(true);
  });
  it('the controller gains life; the opponent does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Leech Totem'], hand: ['Test Salve'] }, p2: { hand: ['Test Salve'] }, defs: [LEECH, SALVE] });
    s = passBoth(castAuto(s, 'Test Salve'));
    expect(life(s, 'p1')).toBe(23);
    s = passBoth(castAuto(toP2(s), 'Test Salve', { player: 'p2' }));
    expect(life(s, 'p2')).toBe(20);
  });
  it('"players": nobody gains life', () => {
    let s = scenario([], { p1: { battlefield: ['Test Drought Totem'], hand: ['Test Salve'] }, p2: { hand: ['Test Salve'] }, defs: [DROUGHT, SALVE] });
    s = passBoth(castAuto(s, 'Test Salve'));
    expect(life(s, 'p1')).toBe(20);
    s = passBoth(castAuto(toP2(s), 'Test Salve', { player: 'p2' }));
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 119.7, 611.2a, 514.2: "Your opponents can\'t gain life this turn"', () => {
  const CURSE = card('Test Parching Word', 'Sorcery', "Your opponents can't gain life this turn.");
  it('is full (eff.t15.player.cant.gainlife.dur promoted by FAST5 PROMO2, design 6.9); the opponent gains no life this turn and gains life again on the next turn', () => {
    expect(automatedAll(CURSE)).toBe(true);
    expect(CURSE.automation.level).toBe('full');
    let s = scenario([], { p1: { hand: ['Test Parching Word', 'Test Salve'] }, p2: { hand: ['Test Salve', 'Test Salve'] }, defs: [CURSE, SALVE] });
    s = passBoth(castAuto(s, 'Test Parching Word'));
    s = passBoth(castAuto(s, 'Test Salve'));
    expect(life(s, 'p1')).toBe(23); // the controller is not an opponent
    s = passBoth(castAuto(toP2(s), 'Test Salve', { player: 'p2' }));
    expect(life(s, 'p2')).toBe(20);
    s = advanceTo(s, 2, 'main1');
    s = passBoth(castAuto(s, 'Test Salve', { player: 'p2' }));
    expect(life(s, 'p2')).toBe(23);
  });
});

describe('CR 601.3, 500.1: "Your opponents can\'t cast spells during your turn"', () => {
  const WARDEN = card('Test Silent Warden', 'Creature — Dragon', "Flying\nYour opponents can't cast spells during your turn.", ['4', '4']);
  it('is automated; the opponent can\'t cast an instant on its controller\'s turn, can on their own, and the controller casts freely', () => {
    expect(full(WARDEN)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Silent Warden'], hand: ['Test Salve'] }, p2: { hand: ['Test Salve'] }, defs: [WARDEN, SALVE] });
    expect(castable(s, 'p1', 'Test Salve')).toBe(true);
    s = toP2(s);
    expect(s.pending?.player).toBe('p2');
    expect(castable(s, 'p2', 'Test Salve')).toBe(false);
    s = advanceTo(s, 2, 'main1');
    expect(castable(s, 'p2', 'Test Salve')).toBe(true);
  });
});

describe('CR 601.3, 611.2a: "Your opponents can\'t cast spells this turn" (an existing template, the new "your opponents" reading)', () => {
  const HUSH = card('Test Hush Word', 'Instant', "Your opponents can't cast spells this turn.");
  it('is automated; the opponent can\'t cast this turn and can on the next one', () => {
    expect(full(HUSH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Hush Word', 'Test Salve'] }, p2: { hand: ['Test Salve'] }, defs: [HUSH, SALVE] });
    s = passBoth(castAuto(s, 'Test Hush Word'));
    expect(castable(s, 'p1', 'Test Salve')).toBe(true);
    s = toP2(s);
    expect(castable(s, 'p2', 'Test Salve')).toBe(false);
    s = advanceTo(s, 2, 'main1');
    expect(castable(s, 'p2', 'Test Salve')).toBe(true);
  });
});

describe('CR 702.11c, 702.18a, 115.1: "You have hexproof", "You have shroud"', () => {
  const VEIL = card('Test Veil Charm', 'Enchantment', 'You have hexproof.');
  const CLOAK = card('Test Cloak Charm', 'Enchantment', 'You have shroud.');
  const targetsOf = (s: GameState): PlayerId[] => {
    expect(s.pending?.kind).toBe('chooseTargets');
    return (s.pending as unknown as { players: PlayerId[] }).players;
  };
  it('hexproof: an opponent\'s spell can\'t target you; your own spell can', () => {
    expect(full(VEIL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Veil Charm'], hand: ['Test Ping'] }, p2: { hand: ['Test Ping'] }, defs: [VEIL, PING] });
    const mine = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ping', 'hand', 'p1') });
    expect(targetsOf(mine).sort()).toEqual(['p1', 'p2']);
    const s1 = toP2(s0);
    const theirs = act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Ping', 'hand', 'p2') });
    expect(targetsOf(theirs)).toEqual(['p2']);
  });
  it('shroud: no spell can target you, your own included', () => {
    expect(full(CLOAK)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Cloak Charm'], hand: ['Test Ping'] }, p2: { hand: ['Test Ping'] }, defs: [CLOAK, PING] });
    const mine = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ping', 'hand', 'p1') });
    expect(targetsOf(mine)).toEqual(['p2']);
    const s1 = toP2(s0);
    const theirs = act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Ping', 'hand', 'p2') });
    expect(targetsOf(theirs)).toEqual(['p2']);
  });
});

describe('CR 601.3b, 702.8a: "You may cast creature spells as though they had flash"', () => {
  const ORRERY = card('Test Quick Orrery', 'Artifact', 'You may cast creature spells as though they had flash.');
  const PAIR = card('Test Twin Orrery', 'Artifact', 'You may cast creature spells and artifact spells as though they had flash.');
  /** p1 with a spell of its own on the stack (so only instant-speed casting is possible). */
  const busy = (perm: string, defs: CardDef[]): GameState =>
    castAuto(scenario([], { p1: { battlefield: [perm], hand: ['Test Salve', 'Test Bears', 'Test Gadget', 'Test Rite'] }, defs: [...defs, SALVE, BEARS, GADGET, RITE] }), 'Test Salve');
  it('is automated; a creature may be cast while a spell is on the stack, a sorcery may not', () => {
    expect(full(ORRERY)).toBe(true);
    const s = busy('Test Quick Orrery', [ORRERY]);
    expect(s.pending?.player).toBe('p1');
    expect(castable(s, 'p1', 'Test Bears')).toBe(true);
    expect(castable(s, 'p1', 'Test Rite')).toBe(false);
    expect(castable(s, 'p1', 'Test Gadget')).toBe(false);
  });
  it('the opponent gets no permission from it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Quick Orrery'] }, p2: { hand: ['Test Bears'] }, defs: [ORRERY, BEARS] });
    s = toP2(s);
    expect(castable(s, 'p2', 'Test Bears')).toBe(false);
  });
  it('"creature spells and artifact spells": both kinds, and nothing else', () => {
    expect(full(PAIR)).toBe(true);
    const s = busy('Test Twin Orrery', [PAIR]);
    expect(castable(s, 'p1', 'Test Bears')).toBe(true);
    expect(castable(s, 'p1', 'Test Gadget')).toBe(true);
    expect(castable(s, 'p1', 'Test Rite')).toBe(false);
  });
});

describe('CR 601.3b, 611.2a, 514.2: "You may cast creature spells this turn as though they had flash"', () => {
  const CANYON = card('Test Swift Canyon', 'Land', '{T}: You may cast creature spells this turn as though they had flash.');
  it('is automated; the permission lasts until the end of the turn', () => {
    expect(full(CANYON)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Swift Canyon'], hand: ['Test Salve', 'Test Bears', 'Test Rite'] }, defs: [CANYON, SALVE, BEARS, RITE] });
    const before = castAuto(s, 'Test Salve');
    expect(castable(before, 'p1', 'Test Bears')).toBe(false);
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Swift Canyon', 'battlefield') && !x.isMana)!;
    s = act(s, a.action);
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    s = castAuto(s, 'Test Salve');
    expect(castable(s, 'p1', 'Test Bears')).toBe(true);
    expect(castable(s, 'p1', 'Test Rite')).toBe(false);
    s = passBoth(s);
    s = advanceTo(s, 2, 'main1');
    s = pass(s); // p2 passes in their own main phase: p1 has priority with an empty stack on p2's turn
    expect(s.pending?.player).toBe('p1');
    expect(castable(s, 'p1', 'Test Bears')).toBe(false);
  });
});

describe('CR 614.1d, 119.1: "~ enters tapped unless a player has 13 or less life"', () => {
  const GATE = card('Test Dusk Gate', 'Land', 'Test Dusk Gate enters tapped unless a player has 13 or less life.\n{T}: Add {B}.');
  const play = (s: GameState): boolean => {
    const t = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Dusk Gate', 'hand', 'p1') });
    return t.objects[find(t, 'Test Dusk Gate', 'battlefield')]!.tapped;
  };
  const board = (): GameState => scenario([], { p1: { hand: ['Test Dusk Gate'] }, defs: [GATE] });
  it('is automated; tapped while every player has more than 13 life, untapped when either player has 13 or less', () => {
    expect(full(GATE)).toBe(true);
    expect(play(board())).toBe(true);
    expect(play(setLife(board(), 'p1', 14))).toBe(true);
    expect(play(setLife(setLife(board(), 'p1', 14), 'p2', 14))).toBe(true);
    expect(play(setLife(board(), 'p2', 13))).toBe(false);
    expect(play(setLife(board(), 'p1', 13))).toBe(false);
    expect(play(setLife(board(), 'p1', 5))).toBe(false);
  });
});

describe('CR 614.1d, 502.3: "~ enters tapped and doesn\'t untap during your untap step"', () => {
  const HULK = card('Test Sleeping Hulk', 'Creature — Giant', "Test Sleeping Hulk enters tapped and doesn't untap during your untap step.", ['7', '7']);
  it('is automated; it enters tapped and stays tapped through its controller\'s next untap step', () => {
    expect(full(HULK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sleeping Hulk'] }, defs: [HULK] });
    s = passBoth(castAuto(s, 'Test Sleeping Hulk'));
    const hulk = find(s, 'Test Sleeping Hulk', 'battlefield');
    expect(s.objects[hulk]!.tapped).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[hulk]!.tapped).toBe(true);
  });
});

describe('CR 614.1c, 601.2a: "~ enters with a divinity counter on it if you cast it from your hand"', () => {
  const IDOL = card('Test Hollow Idol', 'Creature — Spirit', 'Test Hollow Idol enters with a divinity counter on it if you cast it from your hand.', ['3', '3']);
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  it('is automated; cast from hand it has the counter', () => {
    expect(full(IDOL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Hollow Idol'] }, defs: [IDOL] });
    s = passBoth(castAuto(s, 'Test Hollow Idol'));
    expect(s.objects[find(s, 'Test Hollow Idol', 'battlefield')]!.counters).toEqual({ divinity: 1 });
  });
  it('put onto the battlefield without being cast, it has none', () => {
    expect(full(RAISE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Hollow Idol'] }, defs: [IDOL, RAISE] });
    s = castAuto(s, 'Test Raise', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Hollow Idol', 'graveyard') }] }] });
    s = passBoth(s);
    expect(s.objects[find(s, 'Test Hollow Idol', 'battlefield')]!.counters.divinity ?? 0).toBe(0);
  });
});
