/**
 * FAST5 T54: Station rows with full abilities (spacecraft and planets), played through the engine with synthetic cards compiled by the game's default
 * compiler (wordings are invented, design 6.10).
 *
 *   CR 721.2a   "N+ | abilities": as long as the permanent has N or more charge counters on it, it has those abilities, whatever they are (triggered, activated,
 *               static, mana abilities); the lines printed under the symbol are abilities of the same striation
 *   CR 721.2b   only the symbol the reminder text names makes the permanent a creature (the power and toughness box); a Planet has no box and never becomes one
 *   CR 605.1a   an ability granted by a row that could add mana, has no target and is not a loyalty ability is a mana ability: it does not use the stack
 *   CR 707.9b   "except it's legendary" on the token copy
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, pool, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** No ability of the card is manual and no step inside one is manual. */
const automated = (d: CardDef): boolean => d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual' && !JSON.stringify(a).includes('"op":"manual"')));
const REM = 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.';
const SHIP_REM = `${REM} It's an artifact creature at 8+.)`;
const PLANET_REM = 'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)';

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
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id)!.keywords.some((a) => a.keyword === k);
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const target = (id: ObjectId) => (st: GameState): DecisionAnswer | undefined => (st.pending?.kind === 'chooseTargets' ? ({ kind: 'chooseTargets', targets: [{ kind: 'object', id }] } as DecisionAnswer) : undefined);
const BEAR = card('Test Station Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const ELF = card('Test Station Elf', 'Creature — Elf', '', ['1', '1'], '{1}');

describe('CR 721.2a: a row of abilities that are not keywords', () => {
  it('a static ability of a row affects the other creatures only while the permanent has the counters (CR 604.2, 721.2a)', () => {
    const FRIGATE = card('Test Frigate', 'Artifact — Spacecraft', `${SHIP_REM}\n2+ | Other creatures you control get +1/+1.\n8+ | Flying, lifelink`, ['3', '5'], '{1}{W}');
    expect(automated(FRIGATE)).toBe(true);
    const board = (n: number): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Frigate', counters: { charge: n } }, 'Test Station Bear'] }, defs: [FRIGATE, BEAR] });
    const low = board(1);
    expect(pt(low, find(low, 'Test Station Bear', 'battlefield', 'p1'))).toBe('2/2');
    const mid = board(2);
    expect(pt(mid, find(mid, 'Test Station Bear', 'battlefield', 'p1'))).toBe('3/3');
    expect(types(mid, find(mid, 'Test Frigate', 'battlefield', 'p1'))).not.toContain('Creature'); // the creature row is 8+
    // "other": it never pumps itself, even as a creature
    const high = board(8);
    const f = find(high, 'Test Frigate', 'battlefield', 'p1');
    expect(types(high, f)).toContain('Creature');
    expect(pt(high, f)).toBe('3/5');
    expect(pt(high, find(high, 'Test Station Bear', 'battlefield', 'p1'))).toBe('3/3');
    expect(hasKeyword(high, f, 'flying')).toBe(true);
  });

  it('the row that is not the creature row is understood without the box: its abilities work, the permanent is not a creature (CR 721.2b)', () => {
    const SHIP = card('Test Banner Ship', 'Artifact — Spacecraft', `${SHIP_REM}\n3+ | Other tapped creatures you control have indestructible.\n8+ | Flying`, ['2', '6'], '{2}');
    expect(automated(SHIP)).toBe(true);
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Banner Ship', counters: { charge: 3 } }, { name: 'Test Station Bear', tapped: true }, 'Test Station Elf'] }, defs: [SHIP, BEAR, ELF] });
    expect(types(s, find(s, 'Test Banner Ship', 'battlefield', 'p1'))).not.toContain('Creature');
    expect(hasKeyword(s, find(s, 'Test Station Bear', 'battlefield', 'p1'), 'indestructible')).toBe(true);
    expect(hasKeyword(s, find(s, 'Test Station Elf', 'battlefield', 'p1'), 'indestructible')).toBe(false);
  });

  it('a triggered ability granted by a row triggers only with the counters: "whenever you attack" at 2+ (CR 603.2, 721.2a)', () => {
    const CRUSHER = card('Test Crusher', 'Artifact — Spacecraft', `${SHIP_REM}\n2+ | Whenever you attack, ~ deals 2 damage to up to one target creature or planeswalker.\n8+ | Flying`, ['1', '5'], '{3}');
    expect(automated(CRUSHER)).toBe(true);
    const run = (n: number): GameState => {
      const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Crusher', counters: { charge: n } }, 'Test Station Bear'] }, p2: { battlefield: ['Test Station Elf'] }, defs: [CRUSHER, BEAR, ELF] });
      const bear = find(s0, 'Test Station Bear', 'battlefield', 'p1');
      const elf = find(s0, 'Test Station Elf', 'battlefield', 'p2');
      return settle(declareAttackers(toDeclareAttackers(s0), [[bear]]), target(elf));
    };
    const none = run(1);
    expect(none.zones.stack).toHaveLength(0);
    const some = run(2);
    expect(some.zones.stack.length).toBe(1);
    const done = passUntil(some, (x) => x.zones.stack.length === 0, 'the trigger resolves', 4);
    expect(findAll(done, 'Test Station Elf', 'battlefield', 'p2')).toHaveLength(0); // 2 damage kills the 1/1
  });

  it('a mana ability granted by a row is a mana ability: no stack, the mana is added at once, one per creature (CR 605.1a, 721.2a)', () => {
    const MOON = card('Test Verdant Moon', 'Land — Planet', `This land enters tapped.\n{T}: Add {G}.\n${PLANET_REM}\n12+ | {G}, {T}: Add {G} for each creature you control.`);
    expect(automated(MOON)).toBe(true);
    const mk = (n: number): GameState => scenario(['Forest'], { p1: { battlefield: [{ name: 'Test Verdant Moon', counters: { charge: n } }, 'Forest', 'Test Station Bear', 'Test Station Elf'] }, defs: [MOON, BEAR, ELF] });
    // below 12 only the printed {T}: Add {G}
    const low = mk(11);
    const moonLow = find(low, 'Test Verdant Moon', 'battlefield', 'p1');
    expect(legal(low, 'p1', 'activate').filter((a) => a.object === moonLow && a.isMana)).toHaveLength(1);
    const s0 = mk(12);
    const moon = find(s0, 'Test Verdant Moon', 'battlefield', 'p1');
    expect(types(s0, moon)).not.toContain('Creature'); // a Planet has no power and toughness box
    const mana = legal(s0, 'p1', 'activate').filter((a) => a.object === moon && a.isMana);
    expect(mana).toHaveLength(2);
    const granted = mana.find((a) => /\{G\}, \{T\}/i.test(a.label));
    expect(granted, mana.map((a) => a.label).join(' | ')).toBeDefined();
    const s = settle(act(s0, granted!.action));
    expect(s.zones.stack).toHaveLength(0);
    expect(s.objects[moon]!.tapped).toBe(true);
    // {G} paid by the Forest, then two creatures: two {G}
    expect(pool(s, 'p1')).toBe('GG');
  });
});

describe('CR 721.2: the lines printed under the symbol belong to its row', () => {
  it('an activated ability under the symbol is had only from the threshold (a pump, 8+)', () => {
    const SHIP = card('Test Pump Ship', 'Artifact — Spacecraft', `${SHIP_REM}\n8+ | Flying\n{1}{R}: This Spacecraft gets +2/+0 until end of turn.`, ['1', '5'], '{2}');
    expect(automated(SHIP)).toBe(true);
    const mk = (n: number): GameState => scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Pump Ship', counters: { charge: n } }, 'Mountain', 'Mountain'] }, defs: [SHIP] });
    const pump = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.object === find(s, 'Test Pump Ship', 'battlefield', 'p1') && !a.isMana);
    expect(pump(mk(7))).toBeUndefined();
    const s0 = mk(8);
    const ship = find(s0, 'Test Pump Ship', 'battlefield', 'p1');
    const s = resolve(settle(act(s0, pump(s0)!.action)));
    expect(pt(s, ship)).toBe('3/5');
    expect(hasKeyword(s, ship, 'flying')).toBe(true);
  });

  it('a triggered ability under the symbol: "whenever this Spacecraft attacks" works once it is a creature (8+)', () => {
    const SHIP = card('Test Seed Ship', 'Artifact — Spacecraft', `${SHIP_REM}\n8+ | Flying\nWhenever this Spacecraft attacks, you gain 3 life.`, ['4', '5'], '{3}');
    expect(automated(SHIP)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Seed Ship', counters: { charge: 8 } }] }, defs: [SHIP] });
    const ship = find(s0, 'Test Seed Ship', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[ship]]);
    s = passUntil(s, (x) => life(x, 'p1') === 23 || x.pending?.kind === 'declareBlockers', 'the trigger resolves');
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 603.2, 613.1d: a row that animates another artifact (beginning of combat)', () => {
  it('"up to one other target artifact you control becomes an artifact creature with base power and toughness 2/2 and gains flying until end of turn"', () => {
    const LABSHIP = card('Test Lab Ship', 'Artifact — Spacecraft', `${SHIP_REM}\n2+ | At the beginning of combat on your turn, up to one other target artifact you control becomes an artifact creature with base power and toughness 2/2 and gains flying until end of turn.\n8+ | Flying, vigilance`, ['4', '4'], '{U}');
    const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');
    expect(automated(LABSHIP)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Lab Ship', counters: { charge: 2 } }, 'Test Rock'] }, defs: [LABSHIP, ROCK] });
    const rock = find(s0, 'Test Rock', 'battlefield', 'p1');
    let s = passUntil(s0, (x) => x.turn.step === 'beginCombat' || x.pending?.kind === 'chooseTargets', 'the beginning of combat');
    s = settle(s, target(rock));
    s = passUntil(s, (x) => x.zones.stack.length === 0 && types(x, rock).includes('Creature'), 'the effect resolves', 6);
    expect(types(s, rock)).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(pt(s, rock)).toBe('2/2');
    expect(hasKeyword(s, rock, 'flying')).toBe(true);
    // the ship itself is not a creature below 8 and the trigger says "other"
    expect(types(s, find(s, 'Test Lab Ship', 'battlefield', 'p1'))).not.toContain('Creature');
  });
});

describe("CR 707.9b, 205.4a: \"create a token that's a copy of target artifact or enchantment you control, except it's legendary\"", () => {
  it('the token is a copy and is legendary; the original is not', () => {
    const MOON = card('Test Copy Moon', 'Land — Planet', `This land enters tapped.\n{T}: Add {W}.\n${PLANET_REM}\n12+ | {T}: Create a token that's a copy of target artifact or enchantment you control, except it's legendary. Activate only as a sorcery.`);
    const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');
    expect(automated(MOON)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Copy Moon', counters: { charge: 12 } }, 'Test Rock'] }, defs: [MOON, ROCK] });
    const moon = find(s0, 'Test Copy Moon', 'battlefield', 'p1');
    const rock = find(s0, 'Test Rock', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === moon && !x.isMana);
    expect(a).toBeDefined();
    const s = resolve(settle(act(s0, a!.action), target(rock)));
    const copies = findAll(s, 'Test Rock', 'battlefield', 'p1');
    expect(copies).toHaveLength(2);
    const token = copies.find((id) => id !== rock)!;
    expect(s.objects[token]!.kind).toBe('token');
    expect(getChars(s, token)!.supertypes).toContain('Legendary');
    expect(getChars(s, rock)!.supertypes).not.toContain('Legendary');
  });
});

describe('CR 721.2a: more rows of the planets and the Elevator', () => {
  it('a row with a sacrifice cost and a token: "{1}{R}, {T}, Sacrifice a land: Create a 2/2 ..., then creatures you control get +1/+0 and gain haste until end of turn"', () => {
    const MOON = card('Test Ember Moon', 'Land — Planet', `This land enters tapped.\n{T}: Add {R}.\n${PLANET_REM}\n12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.`);
    expect(automated(MOON)).toBe(true);
    const mk = (n: number): GameState => scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Ember Moon', counters: { charge: n } }, 'Mountain', 'Mountain', 'Mountain', 'Test Station Bear'] }, defs: [MOON, BEAR] });
    const ability = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.object === find(s, 'Test Ember Moon', 'battlefield', 'p1') && !a.isMana && !/station/i.test(a.label));
    expect(ability(mk(11))).toBeUndefined();
    const s0 = mk(12);
    const s1 = resolve(settle(act(s0, ability(s0)!.action), (st) => (st.pending?.kind === 'chooseObjects' ? ({ kind: 'chooseObjects', ids: [(st.pending as unknown as { options: ObjectId[] }).options[0]!] } as DecisionAnswer) : undefined)));
    const robots = s1.zones.battlefield.filter((id) => s1.objects[id]!.kind === 'token');
    expect(robots).toHaveLength(1);
    expect(pt(s1, robots[0]!)).toBe('3/2'); // 2/2 and the +1/+0 of the same resolution (CR 608.2c: the token exists when the second effect is applied)
    expect(hasKeyword(s1, find(s1, 'Test Station Bear', 'battlefield', 'p1'), 'haste')).toBe(true);
    expect(pt(s1, find(s1, 'Test Station Bear', 'battlefield', 'p1'))).toBe('3/2');
  });

  it('the Elevator\'s row: "{T}: Add X mana of any one color, where X is the number of charge counters on ~" is a mana ability', () => {
    const ELEVATOR = card('Test Lift', 'Legendary Artifact', `{T}: Add {C}{C}{C}.\n${PLANET_REM.replace('Planet', 'permanent')}\n20+ | {T}: Add X mana of any one color, where X is the number of charge counters on ~.`);
    expect(automated(ELEVATOR)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Lift', counters: { charge: 21 } }] }, defs: [ELEVATOR] });
    const lift = find(s0, 'Test Lift', 'battlefield', 'p1');
    const mana = legal(s0, 'p1', 'activate').filter((a) => a.object === lift && a.isMana);
    expect(mana).toHaveLength(2);
    const granted = mana.find((a) => /any one color/i.test(a.label))!;
    expect(granted, mana.map((a) => a.label).join(' | ')).toBeDefined();
    let s = act(s0, granted.action);
    for (let i = 0; i < 5 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending as unknown as { kind: string; options?: unknown[] };
      s = answer(s, d.kind === 'chooseColor' ? ({ kind: 'chooseColor', color: 'U' } as unknown as DecisionAnswer) : ({ kind: 'chooseOption', index: 0 } as unknown as DecisionAnswer));
    }
    expect(s.zones.stack).toHaveLength(0);
    expect(pool(s, 'p1')).toBe('U'.repeat(21));
    const fewer = scenario([], { p1: { battlefield: [{ name: 'Test Lift', counters: { charge: 19 } }] }, defs: [ELEVATOR] });
    expect(legal(fewer, 'p1', 'activate').filter((a) => a.object === find(fewer, 'Test Lift', 'battlefield', 'p1') && a.isMana)).toHaveLength(1);
  });
});
