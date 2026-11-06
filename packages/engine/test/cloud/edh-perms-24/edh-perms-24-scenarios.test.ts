/**
 * Commander lane edh-perms, round edh-perms-24: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 702.33a, 107.3, 601.2b    "Kicker {X}. X can't be 0." (X is announced only when the kicker is paid, and from 1 up)
 *   CR 608.2d, 122.1            "Choose a counter on target permanent or suspended card. Remove that counter from that permanent or card or put another of those counters on it."
 *   CR 614.1a, 614.5, 608.2d     "If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance."
 *   CR 608.2d, 701.26a-b         "Choose artifact, creature, or land. Tap all untapped permanents of the chosen type target player controls, or untap all tapped permanents of that type that player controls."
 *   CR 614.1c, 614.12, 205.1b    "Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~'s power and as a Mutant in addition to its other types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

const DIVER = card('Test Sky Thief', 'Creature — Merfolk Rogue',
  'Kicker {X}. X can\'t be 0.\nFlying\nWhen this creature enters, if it was kicked, gain control of target artifact with mana value X or less. If that artifact is an Equipment, attach it to this creature.',
  { pt: ['1', '1'], cost: '{1}{W}', colors: ['W'] });
const GADGET = card('Test Gadget', 'Artifact', '');
const BIG_GADGET = card('Test Big Gadget', 'Artifact', '', { cost: '{3}' });
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}', { cost: '{1}' });
const MANCER = card('Test Mutagen Keeper', 'Creature — Elf Wizard', 'Each other creature you control enters with a number of additional +1/+1 counters on it equal to this creature\'s power and as a Mutant in addition to its other types.', { pt: ['3', '3'], cost: '{3}', colors: ['G'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}', colors: ['G'] });
const SPINNER = card('Test Clockwork', 'Instant', 'Choose a counter on target permanent or suspended card. Remove that counter from that permanent or card or put another of those counters on it.', { cost: '{0}', colors: ['U'] });
const TURNABOUT = card('Test Turnabout', 'Instant', 'Choose artifact, creature, or land. Tap all untapped permanents of the chosen type target player controls, or untap all tapped permanents of that type that player controls.', { cost: '{0}', colors: ['U'] });
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '3'], cost: '{2}', colors: ['G'] });
const FELINE = card('Test Beast Caller', 'Legendary Creature — Elf Druid', 'If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.', { pt: ['2', '2'], cost: '{0}', colors: ['G'] });
const MAKER = card('Test Token Maker', 'Artifact', '{0}: Create two 1/1 white Soldier creature tokens.');
const TAPPER = card('Test Tapped Maker', 'Artifact', '{0}: Create a tapped 1/1 white Soldier creature token.');
const TREASURER = card('Test Gold Maker', 'Artifact', '{0}: Create a Treasure token.');
const DEFS = [FELINE, MAKER, TAPPER, TREASURER, DIVER, GADGET, BIG_GADGET, BLADE, MANCER, BEAR, SPINNER, TURNABOUT, WOLF];

/** Answer every decision until the stack is empty. `kick`: pay the kicker; `x`: the value announced for X; `targets`: the targets chosen. */
function settle(s0: GameState, o: { kick?: boolean; x?: number; targets?: TargetChoice[]; picks?: string[] } = {}): GameState {
  let s = s0;
  const picks = [...(o.picks ?? [])];
  for (let g = 0; g < 60; g++) {
    const p = s.pending;
    if (p === undefined || p === null) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? 0 } as never);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') { const want = picks.shift() ?? 'first'; s = answer(s, { kind: 'chooseOption', ids: [String((p.options as { id: string; label: string }[]).findIndex((x) => x.label === want))] } as never); }
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: picks.shift() ?? 'Creature' } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.kick !== false });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);
const onField = (s: GameState, name: string, who?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name && (who === undefined || s.objects[id]!.controller === who));
const PLAINS = (n: number): string[] => Array(n).fill('Plains') as string[];

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('the kicker card and the counter-giving creature are fully automated', () => {
    for (const d of [DIVER, MANCER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.33a, 107.3, 601.2b: "Kicker {X}. X can\'t be 0." and "gain control of target artifact with mana value X or less"', () => {
  it('kicked with X = 2: the artifact with mana value 2 changes control', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(6) }, p2: { battlefield: ['Test Gadget'] }, defs: DEFS });
    const gadget = find(s0, 'Test Gadget', 'battlefield', 'p2');
    // the gadget has mana value 0: give the kicker X = 1 (the least) and take it
    const s = cast(s0, 'Test Sky Thief', { kick: true, x: 1, targets: [obj(gadget)] });
    expect(s.objects[gadget]!.controller).toBe('p1');
  });
  it('X is the value announced: an artifact with mana value 3 is a legal target with X = 3 and not with X = 2', () => {
    const base = { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(6) }, p2: { battlefield: ['Test Big Gadget'] }, defs: DEFS };
    const s0 = scenario([], base);
    const big = find(s0, 'Test Big Gadget', 'battlefield', 'p2');
    expect(cast(s0, 'Test Sky Thief', { kick: true, x: 3, targets: [obj(big)] }).objects[big]!.controller).toBe('p1');
    expect(cast(scenario([], base), 'Test Sky Thief', { kick: true, x: 2, targets: [obj(big)] }).objects[big]!.controller).toBe('p2');
  });
  it('negative: not kicked, the trigger does not happen (X is 0 and the intervening "if" fails)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(6) }, p2: { battlefield: ['Test Gadget'] }, defs: DEFS });
    const gadget = find(s0, 'Test Gadget', 'battlefield', 'p2');
    const s = cast(s0, 'Test Sky Thief', { kick: false, targets: [obj(gadget)] });
    expect(onField(s, 'Test Sky Thief', 'p1')).toHaveLength(1);
    expect(s.objects[gadget]!.controller).toBe('p2');
  });
  it('X can\'t be 0: with only 2 mana (the cost of the spell) the kicker can\'t be paid, so it is cast unkicked', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(2) }, p2: { battlefield: ['Test Gadget'] }, defs: DEFS });
    const gadget = find(s0, 'Test Gadget', 'battlefield', 'p2');
    const s = cast(s0, 'Test Sky Thief', { kick: true, x: 0, targets: [obj(gadget)] });
    expect(onField(s, 'Test Sky Thief', 'p1')).toHaveLength(1);
    expect(s.objects[gadget]!.controller).toBe('p2');
  });
  it('X can\'t be 0: with 3 mana the kicker is paid with X = 1, and the announcement refuses X = 0', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(3) }, p2: { battlefield: ['Test Gadget'] }, defs: DEFS });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sky Thief', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    // only X = 1 can be paid (3 mana: {1}{W} and X = 1): no choice of X is offered, the next decision is the target
    expect(s.pending?.kind).not.toBe('chooseNumber');
  });
  it('an Equipment taken this way is attached to the creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(6) }, p2: { battlefield: ['Test Blade'] }, defs: DEFS });
    const blade = find(s0, 'Test Blade', 'battlefield', 'p2');
    const s = cast(s0, 'Test Sky Thief', { kick: true, x: 1, targets: [obj(blade)] });
    expect(s.objects[blade]!.controller).toBe('p1');
    expect(s.objects[blade]!.attachedTo).toBe(onField(s, 'Test Sky Thief', 'p1')[0]);
  });
  it('negative: a plain artifact is not attached to anything', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sky Thief'], battlefield: PLAINS(6) }, p2: { battlefield: ['Test Gadget'] }, defs: DEFS });
    const gadget = find(s0, 'Test Gadget', 'battlefield', 'p2');
    const s = cast(s0, 'Test Sky Thief', { kick: true, x: 1, targets: [obj(gadget)] });
    expect(s.objects[gadget]!.attachedTo ?? null).toBeNull();
  });
});

describe('CR 614.1c, 614.12, 205.1b: "Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~\'s power and as a Mutant in addition to its other types."', () => {
  it('another creature enters with counters equal to the power of the source and is a Mutant', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Mutagen Keeper', ...PLAINS(2)] }, defs: DEFS });
    const s = cast(s0, 'Test Bear');
    const bear = onField(s, 'Test Bear', 'p1')[0]!;
    expect(s.objects[bear]!.counters['+1/+1']).toBe(3);
    const c = getChars(s, bear)!;
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Mutant']));
    expect([c.power, c.toughness]).toEqual(['5', '5']);
  });
  it('a creature token that enters is a creature that enters: it gets the counters and is a Mutant too', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mutagen Keeper', 'Test Token Maker'] }, defs: DEFS });
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Token Maker', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let i = 0; i < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks).toHaveLength(2);
    for (const id of toks) {
      expect(s.objects[id]!.counters['+1/+1']).toBe(3);
      expect(getChars(s, id)!.subtypes).toContain('Mutant');
    }
  });
  it('negative: the source itself is not "other" (no counters, no Mutant), and an opponent\'s creature is not touched', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mutagen Keeper'], battlefield: PLAINS(3) }, p2: { hand: [], battlefield: [] }, defs: DEFS });
    const s = cast(s0, 'Test Mutagen Keeper');
    const keeper = onField(s, 'Test Mutagen Keeper', 'p1')[0]!;
    expect(s.objects[keeper]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(getChars(s, keeper)!.subtypes).not.toContain('Mutant');
  });
  it('negative: the count is the power of the source as the creature enters (a pumped source gives more)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: [{ name: 'Test Mutagen Keeper', counters: { '+1/+1': 2 } }, ...PLAINS(2)] }, defs: DEFS });
    const s = cast(s0, 'Test Bear');
    expect(s.objects[onField(s, 'Test Bear', 'p1')[0]!]!.counters['+1/+1']).toBe(5);
  });
});

describe('CR 608.2d, 122.1: "Choose a counter on target permanent or suspended card. Remove that counter from that permanent or card or put another of those counters on it."', () => {
  const base = (counters: Record<string, number>) => scenario([], { p1: { hand: ['Test Clockwork'] }, p2: { battlefield: [{ name: 'Test Bear', counters }] }, defs: DEFS });
  const run = (counters: Record<string, number>, picks: string[]) => {
    const s0 = base(counters);
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    return { s: cast(s0, 'Test Clockwork', { kick: false, targets: [obj(bear)], picks }), bear };
  };
  it('the first option removes one counter of the chosen kind', () => {
    const { s, bear } = run({ '+1/+1': 2, charge: 1 }, ['+1/+1', 'first']);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(s.objects[bear]!.counters['charge']).toBe(1);
  });
  it('the second option puts another counter of the chosen kind on it', () => {
    const { s, bear } = run({ '+1/+1': 2, charge: 1 }, ['charge', 'second']);
    expect(s.objects[bear]!.counters['charge']).toBe(2);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
  });
  it('negative: a permanent with no counters is left alone (nothing is chosen)', () => {
    const { s, bear } = run({}, []);
    expect(Object.values(s.objects[bear]!.counters).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('CR 608.2d, 701.26: "Choose artifact, creature, or land. Tap all untapped permanents of the chosen type target player controls, or untap all tapped permanents of that type that player controls."', () => {
  const board = () => scenario([], { p1: { hand: ['Test Turnabout'] }, p2: { battlefield: ['Test Bear', { name: 'Test Bear', tapped: true }, 'Test Gadget', 'Plains', { name: 'Plains', tapped: true }] }, defs: DEFS });
  const tappedOf = (s: GameState, name: string): boolean[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name && s.objects[id]!.controller === 'p2').map((id) => s.objects[id]!.tapped).sort();
  const run = (picks: string[]): GameState => {
    const s0 = board();
    return cast(s0, 'Test Turnabout', { kick: false, targets: [{ kind: 'player', id: 'p2' } as TargetChoice], picks });
  };
  it('the first option taps every untapped permanent of the chosen type and no other', () => {
    const s = run(['Creature', 'first']);
    expect(tappedOf(s, 'Test Bear')).toEqual([true, true]);
    expect(tappedOf(s, 'Test Gadget')).toEqual([false]);
    expect(tappedOf(s, 'Plains')).toEqual([false, true]);
  });
  it('the second option untaps every tapped permanent of the chosen type and no other', () => {
    const s = run(['Land', 'second']);
    expect(tappedOf(s, 'Plains')).toEqual([false, false]);
    expect(tappedOf(s, 'Test Bear')).toEqual([false, true]);
  });
  it('negative: it affects only the target player\'s permanents (the caster\'s are untouched)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Turnabout'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const s = cast(s0, 'Test Turnabout', { kick: false, targets: [{ kind: 'player', id: 'p2' } as TargetChoice], picks: ['Creature', 'first'] });
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Bear' && s.objects[id]!.controller === 'p1').map((id) => s.objects[id]!.tapped)).toEqual([false]);
  });
});

