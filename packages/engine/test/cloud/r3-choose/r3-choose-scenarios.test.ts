/**
 * Standard round 3, r3-choose (targets, choices and modes; CR 115.1, 601.2c, 603.3c, 608.2b-d, 700.2): the engine behavior of the sentences this slice reads, played
 * through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 * The template, lowering and render side is in r3-choose-templates.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { effectivePrograms } from '../../../src/actions/announce';
import { act, answer, find, findAll, legal, life, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

/** Answer the decisions of casting or activating: targets, automatic payment, `yes` to every yes/no question (default "no"), modes by `modes`. */
function settle(s0: GameState, targets: TargetChoice[], o: { yes?: boolean; modes?: string[][] } = {}): GameState {
  let s = s0;
  const modes = [...(o.modes ?? [])];
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes === true } as DecisionAnswer);
    else if (d.kind === 'chooseOption' && modes.length > 0) s = answer(s, { kind: 'chooseOption', ids: modes.shift()! });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], o: { yes?: boolean; modes?: string[][] } = {}): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, o);
/** Pass priority until the stack is empty, answering as `settle` does. */
function resolveAll(s0: GameState, o: { yes?: boolean; modes?: string[][] } = {}): GameState {
  let s = s0;
  const rest = { ...o, modes: [...(o.modes ?? [])] };
  for (let i = 0; i < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    if (s.pending?.kind === 'priority') { s = passBoth(s); continue; }
    s = settle(s, [], rest);
  }
  return s;
}
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

const UNLOAD = card('Test Unload', 'Sorcery', 'Discard two cards.', '{0}');
const SHRINE = card('Test Wish Shrine', 'Artifact', "Whenever you discard a card, choose one that hasn't been chosen this turn --\n• Draw a card.\n• You gain 2 life.\n• Each opponent loses 1 life.", '{0}');
const UNLOAD3 = card('Test Big Unload', 'Sorcery', 'Discard three cards.', '{0}');
const IDOL = card('Test Memory Idol', 'Artifact', "Whenever you discard a card, choose one that hasn't been chosen --\n• Draw a card.\n• You gain 2 life.", '{0}');
const BLINK = card('Test Quick Blink', 'Instant', "Exile target artifact you control, then return it to the battlefield under its owner's control.", '{0}');
const SAGE = card('Test Relic Sage', 'Creature — Human Wizard', "When this creature enters, choose up to X, where X is the number of artifact cards in your graveyard --\n• Draw a card.\n• You gain 2 life.\n• Each opponent loses 1 life.", '{0}', ['1', '1']);
const FEAST = card('Test Harvest Table', 'Enchantment', 'Whenever you gain life, choose up to that many target creatures you control. Put a +1/+1 counter on each of them.', '{0}');
const SNACK = card('Test Small Snack', 'Instant', 'You gain 2 life.', '{0}');
const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const MEDIC = card('Test Night Medic', 'Creature — Human Cleric', 'When this creature enters, choose target permanent card in your graveyard that was put there from anywhere this turn. Return it to your hand.', '{0}', ['1', '1']);
const TOLL = card('Test Toll Idol', 'Artifact', "Whenever you discard a card, choose one that hasn't been chosen and you lose 1 life --\n• Draw a card.\n• You gain 3 life.", '{0}');
const GLIMPSE = card('Test Glimpse', 'Sorcery', 'Exile the top three cards of your library. Choose one of them. You may play that card this turn.', '{0}');
const DEFS = [UNLOAD, SHRINE, UNLOAD3, IDOL, BLINK, SAGE, FEAST, SNACK, BEAR, MEDIC, TOLL, GLIMPSE];
const BASICS = ['Mountain', 'Island', 'Swamp'];

describe('CR 700.2, 603.3c: "choose one that hasn\'t been chosen this turn" (ModeSpec.unchosen)', () => {
  it('the ability is automated and its modes say so', () => {
    expect(manualParts(SHRINE)).toEqual([]);
    expect(JSON.stringify(SHRINE)).toContain('"unchosen":"turn"');
  });
  it('the mode chosen for the first trigger is not offered for the second one this turn', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Unload', 'Mountain', 'Island'], battlefield: ['Test Wish Shrine'] }, defs: DEFS });
    s = cast(s, 'Test Unload');
    s = passBoth(s); // Test Unload resolves: two cards discarded, two triggers (CR 603.2)
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) }); // CR 603.3b
    // the first trigger put on the stack: every mode is offered
    expect(s.pending?.kind).toBe('chooseOption');
    const first = s.pending as unknown as { options: { id: string; disabled?: string }[] };
    expect(first.options.filter((x) => x.disabled === undefined).map((x) => x.id)).toEqual(['0', '1', '2']);
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    // the second trigger: the mode chosen for the first one can't be chosen again this turn
    expect(s.pending?.kind).toBe('chooseOption');
    const second = s.pending as unknown as { options: { id: string; disabled?: string }[] };
    expect(second.options.find((x) => x.id === '1')?.disabled).toMatch(/chosen this turn/);
    expect(() => answer(s, { kind: 'chooseOption', ids: ['1'] })).toThrow();
    s = answer(s, { kind: 'chooseOption', ids: ['2'] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(22);
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 700.2, 603.3c, 400.7: "choose one that hasn\'t been chosen" (ModeSpec.unchosen: the object\'s own memory)', () => {
  const orderAll = (s: GameState): GameState => (s.pending?.kind === 'order' ? answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) }) : s);
  const enabled = (s: GameState): string[] => (s.pending as unknown as { options: { id: string; disabled?: string }[] }).options.filter((x) => x.disabled === undefined).map((x) => x.id);
  it('each mode is chosen once; with every mode used the third trigger chooses none and is removed from the stack (CR 603.3c)', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Big Unload', 'Mountain', 'Island', 'Swamp'], battlefield: ['Test Memory Idol'] }, defs: DEFS });
    s = cast(s, 'Test Big Unload');
    s = orderAll(passBoth(s));
    expect(enabled(s)).toEqual(['0', '1']);
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    expect(enabled(s)).toEqual(['1']); // the second trigger: the draw was chosen
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    // the third trigger has no mode left: nothing is asked and it is removed (two abilities on the stack)
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack.length).toBe(2);
    const hand = handSize(s, 'p1');
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(hand + 1);
    expect(life(s, 'p1')).toBe(22);
  });
  it('CR 400.7: the object that left and came back is a new object, which has chosen nothing yet', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Unload', 'Test Quick Blink', 'Mountain', 'Island'], battlefield: ['Test Memory Idol'] }, defs: DEFS });
    s = cast(s, 'Test Unload');
    s = passBoth(s);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Mountain', 'hand', 'p1'), find(s, 'Island', 'hand', 'p1')] } as DecisionAnswer);
    s = orderAll(s);
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    s = resolveAll(s);
    const before = find(s, 'Test Memory Idol', 'battlefield', 'p1');
    expect(s.objects[before]!.links?.[Object.keys(s.objects[before]!.links ?? {}).find((k) => k.startsWith('modes:')) ?? '']?.values?.sort()).toEqual(['0', '1']);
    s = cast(s, 'Test Quick Blink', [obj(before)]);
    s = resolveAll(s);
    expect(findAll(s, 'Test Memory Idol', 'battlefield', 'p1').length).toBe(1);
    // the new object remembers nothing: the old one's memory stayed with the object that left (CR 400.7)
    const id = find(s, 'Test Memory Idol', 'battlefield', 'p1');
    expect(JSON.stringify(s.objects[id]!.links ?? {})).not.toContain('modes:');
  });
});

describe('CR 700.2, 603.3c, 107.3a: "choose up to X, where X is ..." (a calculated number of modes, read as the ability is put on the stack)', () => {
  it('the ability is automated; its modes have a calculated maximum', () => {
    expect(manualParts(SAGE)).toEqual([]);
    expect(JSON.stringify(SAGE)).toContain('"min":0,"max":{"q":"count"');
  });
  it('two artifact cards in the graveyard: up to two modes', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Relic Sage'], graveyard: ['Test Wish Shrine', 'Test Memory Idol'] }, defs: DEFS });
    s = cast(s, 'Test Relic Sage');
    s = passBoth(s); // the creature resolves; its enters trigger is put on the stack (CR 603.3c)
    expect(s.pending?.kind).toBe('chooseOption');
    expect(s.pending).toMatchObject({ min: 0, max: 2 });
    expect(() => answer(s, { kind: 'chooseOption', ids: ['0', '1', '2'] })).toThrow();
    s = answer(s, { kind: 'chooseOption', ids: ['1', '2'] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(22);
    expect(life(s, 'p2')).toBe(19);
  });
  it('no artifact card in the graveyard: no mode can be chosen (up to zero), and nothing happens', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Relic Sage'] }, defs: DEFS });
    s = cast(s, 'Test Relic Sage');
    s = resolveAll(passBoth(s), { modes: [[]] });
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 603.3d, 601.2c: "choose up to that many target creatures" (the triggering event\'s amount as a number of targets)', () => {
  it('the ability is automated and its target count is the event amount', () => {
    expect(manualParts(FEAST)).toEqual([]);
    expect(JSON.stringify(FEAST)).toContain('"max":{"q":"eventAmount"}');
  });
  it('gaining 2 life: up to two of three creatures are chosen, each gets a counter', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Small Snack'], battlefield: ['Test Harvest Table', 'Test Grove Bear', 'Test Grove Bear', 'Test Grove Bear'] }, defs: DEFS });
    const bears = findAll(s, 'Test Grove Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Small Snack');
    s = passBoth(s); // the life is gained; the trigger is put on the stack and its targets are chosen (CR 603.3d)
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: bears.map(obj) } as DecisionAnswer)).toThrow();
    s = answer(s, { kind: 'chooseTargets', targets: [obj(bears[0]!), obj(bears[1]!)] } as DecisionAnswer);
    s = resolveAll(s);
    const counters = (id: ObjectId): number => (s.objects[id]!.counters?.['+1/+1'] ?? 0);
    expect(bears.map(counters)).toEqual([1, 1, 0]);
  });
});

describe('CR 400.7, 601.2c: "target permanent card in your graveyard that was put there from anywhere this turn" (ObjectFilter.putThereThisTurn)', () => {
  it('the ability is automated and its target filter says so', () => {
    expect(manualParts(MEDIC)).toEqual([]);
    expect(JSON.stringify(MEDIC)).toContain('"putThereThisTurn":true');
  });
  it('a card discarded this turn can be chosen; a card that was in the graveyard before this turn cannot', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Unload', 'Test Night Medic', 'Test Grove Bear', 'Mountain'], graveyard: ['Test Wish Shrine'] }, defs: DEFS });
    s = cast(s, 'Test Unload');
    s = passBoth(s);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Grove Bear', 'hand', 'p1'), find(s, 'Mountain', 'hand', 'p1')] } as DecisionAnswer);
    s = resolveAll(s);
    const old = find(s, 'Test Wish Shrine', 'graveyard', 'p1');
    const bear = find(s, 'Test Grove Bear', 'graveyard', 'p1');
    s = cast(s, 'Test Night Medic');
    s = passBoth(s); // the creature resolves; its enters trigger is put on the stack and its target is chosen (CR 603.3d)
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [obj(old)] } as DecisionAnswer)).toThrow();
    s = answer(s, { kind: 'chooseTargets', targets: [obj(bear)] } as DecisionAnswer);
    s = resolveAll(s);
    expect(findAll(s, 'Test Grove Bear', 'hand', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Wish Shrine', 'graveyard', 'p1').length).toBe(1);
  });
});

describe('CR 700.2, 608.2c: "choose one that hasn\'t been chosen and you lose 1 life --" (the ability\'s own instruction in the header)', () => {
  it('the ability is automated; its own instruction is followed first, as written, then the chosen mode', () => {
    expect(manualParts(TOLL)).toEqual([]);
    const trig = TOLL.faces[0]!.abilities.find((a) => a.kind === 'triggered')!;
    const programs = effectivePrograms([(trig as unknown as { effect: Parameters<typeof effectivePrograms>[0][number] }).effect], [1]);
    expect(programs.map((p) => p.steps.map((st) => (st as { op: string }).op))).toEqual([['loseLife'], ['gainLife']]);
  });
  it('two triggers: each loses 1 life and does a different mode', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Unload', 'Mountain', 'Island'], battlefield: ['Test Toll Idol'] }, defs: DEFS });
    s = cast(s, 'Test Unload');
    s = passBoth(s);
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    const hand = handSize(s, 'p1');
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(21);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

describe('CR 608.2c, 608.2d, 400.7: "Exile the top three cards of your library. Choose one of them. You may play that card this turn."', () => {
  it('the spell is automated; the choice is among the exiled cards and "that card" is the chosen one', () => {
    expect(manualParts(GLIMPSE)).toEqual([]);
    const steps = JSON.stringify(GLIMPSE.faces[0]!.abilities[0]);
    expect(steps).toContain('"op":"chooseObjects"');
    expect(steps).toContain('"zone":"any"');
  });
  it('only the chosen card may be played from exile this turn', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Glimpse'], library: ['Mountain', 'Test Grove Bear', 'Island'] }, defs: DEFS });
    s = cast(s, 'Test Glimpse');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const exiled = (s.pending as unknown as { options: string[] }).options;
    expect(exiled.map((id) => s.objects[id]!.defId).sort()).toEqual(['Island', 'Mountain', 'Test Grove Bear']);
    const bear = exiled.find((id) => s.objects[id]!.defId === 'Test Grove Bear')!;
    s = answer(s, { kind: 'chooseObjects', ids: [bear] } as DecisionAnswer);
    s = resolveAll(s);
    expect(s.zones.exile.filter((id) => ['Island', 'Mountain', 'Test Grove Bear'].includes(s.objects[id]!.defId)).length).toBe(3);
    // the chosen creature card can be cast from exile ({0}); the two lands that were not chosen can't be played (CR 305.1: a land play needs a permission from exile)
    expect(legal(s, 'p1', 'cast').some((a) => a.object === bear)).toBe(true);
    const lands = s.zones.exile.filter((id) => ['Island', 'Mountain'].includes(s.objects[id]!.defId));
    expect(legal(s, 'p1', 'playLand').filter((a) => a.object !== undefined && lands.includes(a.object))).toEqual([]);
  });
});
