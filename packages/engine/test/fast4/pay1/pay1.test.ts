/**
 * FAST4 PAY1 (FINAL6 audit notes, docs/audits/2026-10-13-FINAL6.md, "Not counted as card defects"):
 *
 *   CR 601.2g-h, 605.3a-b, 106.1   the automatic payment uses mana abilities whose amount is computed ("Add X mana of any one color, where X is ~'s power",
 *                                  Mona Lisa, Science Geek; "... where X is the number of Elves on the battlefield", Wirewood Channeler), with the amount
 *                                  they will add, and keeps "any one color" to one color (CR 106.1b)
 *   CR 608.2d                      a `may` without its own sentence names the action it asks about (Fatestitcher's "tap or untap")
 *
 * Synthetic cards with the Oracle wording of those cards, compiled by the game's default compiler (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, parseManaCost, type CardDef, type Color, type GameState, type ManaSymbol, type ManaType, type OracleCard } from '../../../src/index';
import { solve, solveBest } from '../../../src/rules/solver';
import type { Provider } from '../../../src/rules/sources';
import { act, answer, find, legal, pool, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}

const GEEK = card('Test Geek', 'Legendary Creature — Lizard Mutant', "Reach\n{T}: Add X mana of any one color, where X is this creature's power.", { cost: '{2}{G}', colors: ['G'], pt: ['3', '3'] });
const BIG_GEEK = card('Test Big Geek', 'Creature — Lizard Mutant', "{T}: Add X mana of any one color, where X is this creature's power.", { cost: '{4}{G}', colors: ['G'], pt: ['5', '5'] });
const ZERO_GEEK = card('Test Zero Geek', 'Creature — Lizard Mutant', "{T}: Add X mana of any one color, where X is this creature's power.", { cost: '{G}', colors: ['G'], pt: ['0', '2'] });
const CHANNELER = card('Test Channeler', 'Creature — Elf Druid', '{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.', { cost: '{3}{G}', colors: ['G'], pt: ['1', '3'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { cost: '{G}', colors: ['G'], pt: ['1', '1'] });
const STITCHER = card('Test Stitcher', 'Creature — Zombie Wizard', '{T}: You may tap or untap another target permanent.', { cost: '{1}{U}', colors: ['U'], pt: ['1', '2'] });
const WU = card('Test Pact', 'Sorcery', 'Draw a card.', { cost: '{1}{W}{U}', colors: ['W', 'U'] });
const FIVE = card('Test Five', 'Sorcery', 'Draw a card.', { cost: '{5}' });

const DEFS = [GEEK, BIG_GEEK, ZERO_GEEK, CHANNELER, ELF, STITCHER, WU, FIVE];

/** Start casting a p1 card: the state at its payCost decision. */
function toPayment(s: GameState, name: string): GameState {
  const t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  expect(t.pending?.kind).toBe('payCost');
  return t;
}
const autoPayable = (s: GameState): boolean => (s.pending as unknown as { autoPayable: boolean }).autoPayable;
/** The cast is refused up front: the mana can't be produced (CR 601.2h, 118.3). */
const unpayable = (s: GameState, name: string): string => reject(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }).message;
const onStack = (s: GameState, name: string): boolean => s.zones.stack.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('CR 601.2g-h, 605.3b, 106.1: the automatic payment uses "Add X mana of any one color, where X is ~\'s power"', () => {
  it('Serra Angel ({3}{W}{W}) with only a 5-power Geek: paid automatically, the Geek tapped, nothing left floating', () => {
    const s = scenario(['Serra Angel'], { p1: { hand: ['Serra Angel'], battlefield: ['Test Big Geek'] }, defs: DEFS });
    const pay = toPayment(s, 'Serra Angel');
    expect(autoPayable(pay)).toBe(true);
    const t = answer(pay, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Serra Angel')).toBe(true);
    expect(t.objects[find(t, 'Test Big Geek', 'battlefield')]!.tapped).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });

  it('a 3-power Geek and two Plains pay {3}{W}{W}: the Geek adds {W}{W}{W} (the color the cost asks for)', () => {
    const s = scenario(['Serra Angel'], { p1: { hand: ['Serra Angel'], battlefield: ['Test Geek', 'Plains', 'Plains'] }, defs: DEFS });
    const t = answer(toPayment(s, 'Serra Angel'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Serra Angel')).toBe(true);
    expect(t.log.some((l) => /taps Test Geek for \{W\}\{W\}\{W\}/.test(l.text))).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });

  it('the amount is known at payment time: a 3-power Geek can\'t pay {5}, a 0-power Geek offers nothing', () => {
    const s = scenario([], { p1: { hand: ['Test Five'], battlefield: ['Test Geek'] }, defs: DEFS });
    expect(unpayable(s, 'Test Five')).toMatch(/can't pay \{5\}/);
    const z = scenario([], { p1: { hand: ['Test Five'], battlefield: ['Test Zero Geek', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const pay = toPayment(z, 'Test Five');
    expect((pay.pending as unknown as { manaSources: { objectId: string }[] }).manaSources.map((m) => m.objectId)).not.toContain(find(z, 'Test Zero Geek', 'battlefield'));
    expect(onStack(answer(pay, { kind: 'payCost', auto: true }), 'Test Five')).toBe(true);
  });

  it('CR 106.1b: "any one color" is one color: a 3-power Geek alone can\'t pay {1}{W}{U}; with an Island it adds {W}{W}{W}', () => {
    const alone = scenario([], { p1: { hand: ['Test Pact'], battlefield: ['Test Geek'] }, defs: DEFS });
    expect(unpayable(alone, 'Test Pact')).toMatch(/can't pay/);
    const s = scenario(['Island'], { p1: { hand: ['Test Pact'], battlefield: ['Test Geek', 'Island'] }, defs: DEFS });
    const t = answer(toPayment(s, 'Test Pact'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Pact')).toBe(true);
    expect(t.log.some((l) => /taps Test Geek for \{W\}\{W\}\{W\}/.test(l.text))).toBe(true);
    expect(pool(t, 'p1')).toBe('W'); // three {W} from one activation, one {U}: the third {W} floats (CR 106.4)
  });

  it('CR 110.1: "the number of Elves on the battlefield" counts every player\'s Elves: three Elves and two Plains pay {3}{W}{W}', () => {
    const s = scenario(['Serra Angel'], { p1: { hand: ['Serra Angel'], battlefield: ['Test Channeler', 'Test Elf', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Elf'] }, defs: DEFS });
    const t = answer(toPayment(s, 'Serra Angel'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Serra Angel')).toBe(true);
    expect(t.log.some((l) => /taps Test Channeler for \{W\}\{W\}\{W\}/.test(l.text))).toBe(true);
    // without the opponent's Elf the Channeler adds two and the Plains can't make up the third generic
    const fewer = scenario(['Serra Angel'], { p1: { hand: ['Serra Angel'], battlefield: ['Test Channeler', 'Test Elf', 'Plains'] }, defs: DEFS });
    expect(unpayable(fewer, 'Serra Angel')).toMatch(/can't pay/);
  });

  it('CR 605.3a: paying by hand with a color still adds the computed amount of that color', () => {
    const s = scenario(['Island'], { p1: { hand: ['Test Pact'], battlefield: ['Test Geek', 'Island'] }, defs: DEFS });
    const pay = toPayment(s, 'Test Pact');
    const geek = find(s, 'Test Geek', 'battlefield');
    const src = (pay.pending as unknown as { manaSources: { objectId: string; abilityKey: string; produces: ManaType[] }[] }).manaSources.find((m) => m.objectId === geek)!;
    expect(src.produces.sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    const island = find(s, 'Island', 'battlefield');
    const islandKey = (pay.pending as unknown as { manaSources: { objectId: string; abilityKey: string }[] }).manaSources.find((m) => m.objectId === island)!.abilityKey;
    const t = answer(pay, { kind: 'payCost', auto: false, activations: [{ objectId: geek, abilityKey: src.abilityKey, color: 'W' }, { objectId: island, abilityKey: islandKey }] });
    expect(onStack(t, 'Test Pact')).toBe(true);
    expect(pool(t, 'p1')).toBe('W'); // {W}{W}{W} + {U} paid {1}{W}{U}: one {W} floats
  });

  it('activating it at priority still asks for the color and adds the computed amount (unchanged)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Geek'] }, defs: DEFS });
    const id = find(s, 'Test Geek', 'battlefield');
    let t = act(s, legal(s, 'p1', 'activate').find((x) => x.object === id)!.action);
    if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color: 'R' });
    expect(pool(t, 'p1')).toBe('RRR');
  });
});

describe('the solver keeps the units of an "any one color" source to one type (CR 106.1b)', () => {
  const cost = (text: string): ManaSymbol[] => parseManaCost(text)!;
  const oneColor = (n: number, objectId = 'geek'): Provider[] => Array.from({ length: n }, (_, i) => ({
    id: i, options: ['W', 'U', 'B', 'R', 'G'] as ManaType[], snow: false, cost: 155,
    source: { objectId, keyFor: { W: 'k', U: 'k', B: 'k', R: 'k', G: 'k' }, unitCount: n, activationCost: 155, unitIndex: i, allOptions: Array.from({ length: n }, () => ['W', 'U', 'B', 'R', 'G'] as ManaType[]), oneType: true },
  }));
  it('{W}{U} is not paid by one such source of two units; {W}{W} and {2} are', () => {
    expect(solve({ symbols: cost('{W}{U}'), providers: oneColor(2), life: 20 })).toBeNull();
    expect(solve({ symbols: cost('{W}{W}'), providers: oneColor(2), life: 20 })!.used.map((u) => u.type)).toEqual(['W', 'W']);
    expect(solve({ symbols: cost('{2}'), providers: oneColor(2), life: 20 })).not.toBeNull();
  });
  it('two such sources may choose different colors: {W}{W}{U}{U}', () => {
    const a = oneColor(2, 'a');
    const b = oneColor(2, 'b').map((p, i) => ({ ...p, id: 2 + i }));
    const sol = solveBest({ symbols: cost('{W}{W}{U}{U}'), providers: [...a, ...b], life: 20 })!;
    const byObject = new Map<string, Set<ManaType>>();
    for (const u of sol.used) {
      const o = [...a, ...b][u.providerId]!.source!.objectId;
      byObject.set(o, (byObject.get(o) ?? new Set()).add(u.type));
    }
    expect([...byObject.values()].map((x) => [...x].join('')).sort()).toEqual(['U', 'W']);
  });
  it('a Phyrexian symbol is still paid with mana when one color pays everything: {W/P}{W}', () => {
    const sol = solve({ symbols: cost('{W/P}{W}'), providers: oneColor(2), life: 20 })!;
    expect(sol.lifeSymbols).toEqual([]);
  });
});

describe('CR 608.2d: the optional part names what it does (Fatestitcher, "You may tap or untap another target permanent")', () => {
  const start = (tapped: boolean): { s: GameState; bears: string } => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Stitcher'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: DEFS });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    if (tapped) s0.objects[bears]!.tapped = true; // test setup: a tapped target
    const me = find(s0, 'Test Stitcher', 'battlefield');
    let s = act(s0, legal(s0, 'p1', 'activate').find((x) => x.object === me)!.action);
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    // resolve: both players pass
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = act(s, { type: 'pass', player: s.pending.player });
    return { s, bears };
  };
  const prompt = (s: GameState): string => (s.pending as unknown as { prompt: string }).prompt;

  it('an untapped target: "do you tap Grizzly Bears?", then, if not, "do you untap Grizzly Bears?" is skipped (it is untapped)', () => {
    const { s, bears } = start(false);
    expect(s.pending?.kind).toBe('yesNo');
    expect(prompt(s)).toBe('Test Stitcher: do you tap Grizzly Bears?');
    const t = answer(s, { kind: 'yesNo', yes: true });
    expect(t.objects[bears]!.tapped).toBe(true);
  });

  it('a tapped target: the tap is skipped and the question is "do you untap Grizzly Bears?"', () => {
    const { s, bears } = start(true);
    expect(s.pending?.kind).toBe('yesNo');
    expect(prompt(s)).toBe('Test Stitcher: do you untap Grizzly Bears?');
    const t = answer(s, { kind: 'yesNo', yes: true });
    expect(t.objects[bears]!.tapped).toBe(false);
  });
});
