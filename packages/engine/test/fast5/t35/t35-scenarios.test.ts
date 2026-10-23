/**
 * FAST5 T35: keyword-ability lines with costs and thresholds, played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 702.163a   "For Mirrodin!": when the Equipment enters, a 2/2 red Rebel creature token is created and the Equipment is attached to it
 *   CR 702.193a-b "Power-up -- {cost}: {effect}": activated once; on the turn the permanent entered, the cost is reduced by its mana cost
 *                 (generic by generic, colored by the same color, any excess by generic mana)
 *   CR 702.184a   "Station": tap another untapped creature you control, put charge counters equal to its power on the permanent, only as a sorcery
 *   CR 721.2a-b   "N+ | abilities": as long as it has N or more charge counters it has the abilities, and (the row with the power and toughness box) it is
 *                 a creature with base power and toughness in addition to its other types
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { reduceManaBy } from '../../../src/statics/costmods';
import { parseManaCost } from '../../../src/types/mana';
import { act, answer, battlefieldNames, find, findAll, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** No ability of the card is manual. */
const automated = (d: CardDef): boolean => d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer what comes up (automatic payment, the choices of `choose`), until priority returns. */
function settle(s0: GameState, choose: (s: GameState) => DecisionAnswer | undefined = () => undefined): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else {
      const a = choose(s);
      if (!a) break;
      s = answer(s, a);
    }
  }
  return s;
}
const resolve = (s: GameState): GameState => settle(pass(pass(s)));
function activate(s: GameState, name: string, pick?: (s: GameState) => DecisionAnswer | undefined): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), pick);
}
const canActivate = (s: GameState, name: string): boolean => {
  const id = find(s, name, 'battlefield', 'p1');
  return legal(s, 'p1', 'activate').some((a) => a.object === id && !a.isMana);
};
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id)!.keywords.some((a) => a.keyword === k);
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;

describe('CR 702.163a: For Mirrodin!', () => {
  const CHAIR = card('Test Rebel Chair', 'Artifact — Equipment', 'For Mirrodin!\nEquipped creature gets +2/+2.\nEquip {3}', undefined, '{1}{W}');
  it('is automated', () => expect(automated(CHAIR)).toBe(true));
  it('creates a 2/2 red Rebel creature token and attaches the Equipment to it when it enters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rebel Chair'], battlefield: ['Plains', 'Plains'] }, defs: [CHAIR] });
    const cast = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rebel Chair', 'hand', 'p1') }));
    const s = resolve(resolve(cast)); // the Equipment, then its enters trigger
    const tokenIds = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokenIds).toHaveLength(1);
    const token = tokenIds[0]!;
    const chair = find(s, 'Test Rebel Chair', 'battlefield', 'p1');
    // 2/2 plus the +2/+2 of the Equipment it carries
    expect(pt(s, token)).toBe('4/4');
    expect(types(s, token)).toContain('Creature');
    expect(getChars(s, token)!.subtypes).toContain('Rebel');
    expect(getChars(s, token)!.colors).toEqual(['R']);
    expect(s.objects[chair]!.attachedTo).toBe(token);
  });
});

describe('CR 702.193a-b: Power-up', () => {
  const SNAKE = card('Test Power Snake', 'Creature — Snake', 'Power-up -- {1}{W}: Put two +1/+1 counters on this creature.', ['1', '1'], '{W}');
  const GIANT = card('Test Power Giant', 'Creature — Giant', 'Power-up -- {2}{W}{W}: Put two +1/+1 counters on this creature.', ['2', '2'], '{1}{W}');
  it('are automated', () => { expect(automated(SNAKE)).toBe(true); expect(automated(GIANT)).toBe(true); });

  it('reduceManaBy (CR 702.193b, 118.7): generic by generic, colored by the same color, the excess by generic mana; never below zero; null for an {X}', () => {
    const m = (t: string) => parseManaCost(t)!;
    expect(reduceManaBy(m('{3}{G}'), m('{2}{G}'))).toEqual(m('{1}'));
    expect(reduceManaBy(m('{1}{W}'), m('{W}{W}'))).toEqual([]);
    expect(reduceManaBy(m('{4}{R}'), m('{G}'))).toEqual(m('{3}{R}'));
    expect(reduceManaBy(m('{2}{U}{U}'), m('{1}{U}'))).toEqual(m('{1}{U}'));
    expect(reduceManaBy(m('{C}{C}'), m('{C}'))).toEqual(m('{C}'));
    expect(reduceManaBy(m('{2}'), m('{5}'))).toEqual([]);
    expect(reduceManaBy(m('{X}{U}'), m('{1}'))).toBeNull();
  });

  it('costs its printed cost when the permanent has been on the battlefield since an earlier turn, and can be activated once', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Power Snake', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [SNAKE] });
    const snake = find(s0, 'Test Power Snake', 'battlefield', 'p1');
    expect(canActivate(s0, 'Test Power Snake')).toBe(true);
    // {1}{W}: two lands pay it, two stay untapped
    const s1 = resolve(activate(s0, 'Test Power Snake'));
    expect(counters(s1, snake, '+1/+1')).toBe(2);
    expect(pt(s1, snake)).toBe('3/3');
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Plains' && s1.objects[id]!.tapped)).toHaveLength(2);
    // "Activate this ability only once": a second activation is not offered even with mana left
    expect(canActivate(s1, 'Test Power Snake')).toBe(false);
  });

  it('on the turn it entered, the cost is reduced by the permanent\'s mana cost: {2}{W}{W} less {1}{W} is {1}{W}', () => {
    const s0 = scenario([], { p1: { hand: ['Test Power Giant'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: [GIANT] });
    // cast it ({1}{W}, two lands), leaving two lands: the full {2}{W}{W} could not be paid, the reduced {1}{W} can
    const cast = resolve(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Power Giant', 'hand', 'p1') })));
    const giant = find(cast, 'Test Power Giant', 'battlefield', 'p1');
    expect(cast.zones.battlefield.filter((id) => cast.objects[id]!.defId === 'Plains' && !cast.objects[id]!.tapped)).toHaveLength(2);
    expect(canActivate(cast, 'Test Power Giant')).toBe(true);
    const s = resolve(activate(cast, 'Test Power Giant'));
    expect(counters(s, giant, '+1/+1')).toBe(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && !s.objects[id]!.tapped)).toHaveLength(0);
  });

  it('is not reduced when the permanent did not enter this turn: {2}{W}{W} needs four lands', () => {
    const three = scenario([], { p1: { battlefield: ['Test Power Giant', 'Plains', 'Plains', 'Plains'] }, defs: [GIANT] });
    expect(canActivate(three, 'Test Power Giant')).toBe(false);
    const four = scenario([], { p1: { battlefield: ['Test Power Giant', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [GIANT] });
    expect(canActivate(four, 'Test Power Giant')).toBe(true);
  });
});

describe('CR 702.184a, 721.2: Station', () => {
  const SHIP = card('Test Star Skiff', 'Artifact — Spacecraft', "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 5+.)\n5+ | Flying, vigilance", ['3', '4'], '{3}');
  const NOBOX = card('Test Star Lantern', 'Artifact — Spacecraft', 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)\n2+ | Lifelink', undefined, '{2}');
  const OGRE = card('Test Station Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
  const ELF = card('Test Station Elf', 'Creature — Elf', '', ['2', '2'], '{1}');

  it('are automated', () => { expect(automated(SHIP)).toBe(true); expect(automated(NOBOX)).toBe(true); });

  it('Station taps another untapped creature and puts charge counters equal to its power; only as a sorcery; the ship itself cannot pay', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Star Skiff', 'Test Station Ogre'] }, defs: [SHIP, OGRE] });
    const ship = find(s0, 'Test Star Skiff', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Station Ogre', 'battlefield', 'p1');
    expect(canActivate(s0, 'Test Star Skiff')).toBe(true);
    const s1 = resolve(activate(s0, 'Test Star Skiff', (s) => (s.pending?.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [ogre] } : undefined)));
    expect(s1.objects[ogre]!.tapped).toBe(true);
    expect(counters(s1, ship, 'charge')).toBe(3);
    // the Ogre is tapped now and the ship is not a creature: nothing is left to tap
    expect(canActivate(s1, 'Test Star Skiff')).toBe(false);
  });

  it('a creature that came under your control this turn can still be tapped for it (it is not a {T} cost, CR 302.6); a tapped one cannot', () => {
    const fresh = scenario([], { p1: { battlefield: ['Test Star Skiff', { name: 'Test Station Ogre', since: 1 }] }, defs: [SHIP, OGRE] });
    expect(canActivate(fresh, 'Test Star Skiff')).toBe(true);
    const tapped = scenario([], { p1: { battlefield: ['Test Star Skiff', { name: 'Test Station Ogre', tapped: true }] }, defs: [SHIP, OGRE] });
    expect(canActivate(tapped, 'Test Star Skiff')).toBe(false);
  });

  it('only as a sorcery: not offered with something on the stack', () => {
    const s0 = scenario([], { p1: { hand: ['Test Station Elf'], battlefield: ['Test Star Skiff', 'Test Station Ogre', 'Plains'] }, defs: [SHIP, OGRE, ELF] });
    const withSpell = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Station Elf', 'hand', 'p1') }));
    expect(withSpell.zones.stack.length).toBeGreaterThan(0);
    expect(canActivate(withSpell, 'Test Star Skiff')).toBe(false);
  });

  it('below the threshold it is a plain artifact; at the threshold it is an artifact creature with the printed power and toughness and the abilities (CR 721.2b)', () => {
    const lowOnes = scenario([], { p1: { battlefield: [{ name: 'Test Star Skiff', counters: { charge: 4 } }] }, defs: [SHIP] });
    const low = find(lowOnes, 'Test Star Skiff', 'battlefield', 'p1');
    expect(types(lowOnes, low)).not.toContain('Creature');
    expect(hasKeyword(lowOnes, low, 'flying')).toBe(false);
    const highOnes = scenario([], { p1: { battlefield: [{ name: 'Test Star Skiff', counters: { charge: 5 } }] }, defs: [SHIP] });
    const high = find(highOnes, 'Test Star Skiff', 'battlefield', 'p1');
    expect(types(highOnes, high)).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(getChars(highOnes, high)!.subtypes).toContain('Spacecraft');
    expect(pt(highOnes, high)).toBe('3/4');
    expect(hasKeyword(highOnes, high, 'flying')).toBe(true);
    expect(hasKeyword(highOnes, high, 'vigilance')).toBe(true);
  });

  it('a row without a power and toughness box only gives its abilities (CR 721.2a): it never becomes a creature', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Star Lantern', counters: { charge: 9 } }] }, defs: [NOBOX] });
    const lantern = find(s, 'Test Star Lantern', 'battlefield', 'p1');
    expect(types(s, lantern)).not.toContain('Creature');
    expect(hasKeyword(s, lantern, 'lifelink')).toBe(true);
    const none = scenario([], { p1: { battlefield: [{ name: 'Test Star Lantern', counters: { charge: 1 } }] }, defs: [NOBOX] });
    expect(hasKeyword(none, find(none, 'Test Star Lantern', 'battlefield', 'p1'), 'lifelink')).toBe(false);
  });

  it('two stations reach the threshold: 3 + 2 charge counters turn the ship into a 3/4 flyer', () => {
    let s = scenario([], { p1: { battlefield: ['Test Star Skiff', 'Test Station Ogre', 'Test Station Elf'] }, defs: [SHIP, OGRE, ELF] });
    const ship = find(s, 'Test Star Skiff', 'battlefield', 'p1');
    const pick = (name: string) => (st: GameState): DecisionAnswer | undefined => (st.pending?.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [find(st, name, 'battlefield', 'p1')] } : undefined);
    s = resolve(activate(s, 'Test Star Skiff', pick('Test Station Ogre')));
    expect(counters(s, ship, 'charge')).toBe(3);
    expect(types(s, ship)).not.toContain('Creature');
    s = resolve(activate(s, 'Test Star Skiff', pick('Test Station Elf')));
    expect(counters(s, ship, 'charge')).toBe(5);
    expect(pt(s, ship)).toBe('3/4');
    expect(hasKeyword(s, ship, 'flying')).toBe(true);
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Test Star Skiff')).toHaveLength(1);
    expect(findAll(s, 'Test Star Skiff', 'battlefield', 'p1')).toHaveLength(1);
  });
});
