/**
 * edh-d-66 (Commander coordinator D, lane stack-marks, concept round): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites are from memory (unverified).
 *
 *   CR 607.2a, 601.3, 108.3, 609.4b   "During each player's turn, that player may cast a spell from among the cards they don't own exiled with ~, and mana of any type can be spent to cast it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const castable = (s: GameState, p: PlayerId): ObjectId[] => legal(s, p, 'cast').map((a) => a.object!);

const IAN = card('Test Chaotician', 'Creature — Human Scientist',
  "Whenever a player draws their second card each turn, that player exiles the top card of their library.\nDuring each player's turn, that player may cast a spell from among the cards they don't own exiled with Test Chaotician, and mana of any type can be spent to cast it.", { pt: ['1', '1'] });
const STUDY = card('Test Study', 'Instant', 'Draw two cards.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', pt: ['2', '2'] });

const exiledBears = (s: GameState): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Bear');

describe('CR 607.2a, 601.3, 108.3, 609.4b: Test Chaotician, a static permit for the active player', () => {
  const start = (): GameState => mpScenario({
    defs: [IAN, STUDY, BEAR],
    zones: {
      p1: { hand: ['Test Study'], battlefield: ['Test Chaotician', 'Plains', 'Plains'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] },
      p2: { battlefield: ['Plains', 'Plains'] }, p3: { battlefield: ['Plains', 'Plains'] }, p4: { battlefield: ['Plains', 'Plains'] },
    },
  });
  it('is automated', () => expect(full(IAN)).toBe(true));
  it('the player who drew their second card exiles their own top card; only the active player may cast a card he does not own, with Plains mana; never the owner, never an inactive player', () => {
    let s = start();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Study', 'hand', 'p1') });
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    const bear = exiledBears(s)[0]!;
    expect(bear).toBeDefined();
    expect(s.objects[bear]!.owner).toBe('p1');
    // p1's turn: p1 owns it, so p1 may not cast it; the others are not the active player
    for (const p of ['p1', 'p2', 'p3', 'p4'] as PlayerId[]) expect(castable(s, p)).not.toContain(bear);
    // p2's turn: p2 (active, not the owner) may cast it, paying with Plains (any type); p1 and p3 may not
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'main 1 of p2');
    expect(castable(s, 'p2')).toContain(bear);
    expect(castable(s, 'p1')).not.toContain(bear);
    expect(castable(s, 'p3')).not.toContain(bear);
    s = act(s, { type: 'cast', player: 'p2', card: bear });
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    const now = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear')!;
    expect(s.objects[now]!.controller).toBe('p2');
    expect(s.objects[now]!.owner).toBe('p1');
  });
  it('a card the active player owns is not castable on their own turn (the negative case)', () => {
    const s0 = mpScenario({
      defs: [IAN, STUDY, BEAR],
      zones: { p1: { battlefield: ['Test Chaotician', 'Plains', 'Plains'], library: ['Test Bear'] }, p2: { battlefield: ['Plains', 'Plains'] }, p3: {}, p4: {} },
    });
    expect(castable(s0, 'p1')).toEqual([]);
  });
  it('a card exiled by something else is not "exiled with" it (CR 607.2a): no one may cast it', () => {
    const s0 = mpScenario({
      defs: [IAN, BEAR],
      zones: { p1: { battlefield: ['Test Chaotician'] }, p2: { battlefield: ['Plains', 'Plains'], exile: ['Test Bear'] }, p3: { exile: ['Test Bear'] }, p4: {} },
    });
    for (const p of ['p1', 'p2', 'p3', 'p4'] as PlayerId[]) expect(castable(s0, p)).toEqual([]);
  });
});

// ---- shared driver ---------------------------------------------------------------------------------------------------------------------------------------------------
interface Script { yes?: boolean[]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; targets?: TargetChoice[][]; numbers?: number[]; options?: string[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

// ---- The Master, Formed Anew -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 603.2, 608.2c, 707.9: "When you cast this spell, you may exile a creature you control and put a takeover counter on it. You may have ~ enter as a copy of a creature card in exile with a takeover counter on it."', () => {
  const MASTER = card('Test Body Thief', 'Legendary Creature — Time Lord Rogue', 'When you cast this spell, you may exile a creature you control and put a takeover counter on it.\nYou may have Test Body Thief enter as a copy of a creature card in exile with a takeover counter on it.', { pt: ['3', '2'] });
  const DRAKE = card('Test Drake', 'Creature — Drake', 'Flying', { pt: ['2', '2'] });
  const setup = (): GameState => mpScenario({ defs: [MASTER, DRAKE, BEAR], zones: { p1: { hand: ['Test Body Thief'], battlefield: ['Test Drake', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: {}, p4: {} } });
  it('is automated', () => expect(full(MASTER)).toBe(true));
  it('the cast trigger exiles one of your creatures with a takeover counter on that card (never the spell, never another player\'s creature) and the spell enters as a copy of it', () => {
    const s0 = setup();
    const drake = find(s0, 'Test Drake', 'battlefield', 'p1');
    const s = cast(s0, 'Test Body Thief', { yes: [true, true], objects: [[drake], (options) => options.slice(0, 1)] });
    const ex = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Drake')!;
    // the exiled Drake is no longer on the battlefield; the Master entered as a copy of it (the copy's name, flying) and the other creatures stay
    expect(ex).toBeDefined();
    expect(s.objects[ex]!.counters['takeover']).toBe(1);
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && getChars(s, id).name === 'Test Drake');
    expect(copies.length).toBe(1);
    expect(onBf(s, 'Test Bear').length).toBe(2);
  });
  it('declining the cast trigger exiles nothing, and the Master has no card with a takeover counter to copy (the negative case)', () => {
    const s = cast(setup(), 'Test Body Thief', { yes: [false, false] });
    expect(s.zones.exile.length).toBe(0);
    expect(onBf(s, 'Test Body Thief').length).toBe(1);
  });
});

// ---- Dash Hopes ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 118.12, 101.4, 608.2c: "When you cast this spell, any player may pay 5 life. If a player does, counter ~."', () => {
  const HOPES = card('Test Hopeless', 'Instant', 'When you cast this spell, any player may pay 5 life. If a player does, counter Test Hopeless.\nTarget player gains 3 life.');
  const setup = (): GameState => mpScenario({ defs: [HOPES], zones: { p1: { hand: ['Test Hopeless'] }, p2: {}, p3: {}, p4: {} } });
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const target = (p: PlayerId): TargetChoice => ({ kind: 'player', id: p }) as TargetChoice;
  it('is automated', () => expect(full(HOPES)).toBe(true));
  it('a player who pays 5 life counters the spell when it is cast: it does nothing, and only the payer lost life', () => {
    const s0 = setup();
    const before = [...s0.players].map((p) => p.life);
    const s = cast(s0, 'Test Hopeless', { targets: [[target('p1')]], yes: [false, false, true, false] });
    expect(life(s, 'p1')).toBe(before[0]); // not gained
    expect(s.players.filter((p) => p.life === (before[0]! - 5)).map((p) => p.id).length).toBe(1);
    expect(s.zones.stack.length).toBe(0);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Hopeless')).toBe(true);
  });
  it('when nobody pays the spell resolves (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Hopeless', { targets: [[target('p1')]], yes: [false, false, false, false] });
    expect(life(s, 'p1')).toBe(s0.players.find((p) => p.id === 'p1')!.life + 3);
  });
  it('several players paying counter it once and each loses 5 life (every player is offered the payment, CR 101.4)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Hopeless', { targets: [[target('p1')]], yes: [true, false, true, true] });
    const start = s0.players[0]!.life;
    expect(s.players.filter((p) => p.life === start - 5).length).toBe(3);
    expect(life(s, 'p1')).toBe(start - 5); // the payer p1 lost life and did not gain 3
  });
});

// ---- Vile Redeemer ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 700.4, 608.2h, 118.12: "When you cast this spell, you may pay {C}. If you do, create a 1/1 Eldrazi Scion token for each nontoken creature that died under your control this turn."', () => {
  const REDEEMER = card('Test Redeemer', 'Creature — Eldrazi', 'Flash\nWhen you cast this spell, you may pay {C}. If you do, create a 1/1 colorless Eldrazi Scion creature token for each nontoken creature that died under your control this turn. Those tokens have "Sacrifice this token: Add {C}."', { pt: ['3', '2'] });
  const SWEEP = card('Test Sweep', 'Sorcery', 'Destroy all creatures.');
  const WASTE = card('Test Waste', 'Land', '{T}: Add {C}.');
  const setup = (): GameState => mpScenario({
    defs: [REDEEMER, SWEEP, WASTE, BEAR],
    zones: { p1: { hand: ['Test Sweep', 'Test Redeemer'], battlefield: ['Test Bear', 'Test Bear', 'Test Waste'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p3: { battlefield: ['Test Bear'] }, p4: {} },
  });
  const scions = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && s.objects[id]!.defId.includes('Eldrazi Scion')).length;
  it('is automated', () => expect(full(REDEEMER)).toBe(true));
  it('one Scion for each nontoken creature of yours that died this turn, never for the creatures of other players; paying {C} is optional', () => {
    const s1 = cast(setup(), 'Test Sweep');
    const s = cast(s1, 'Test Redeemer', { yes: [true] });
    expect(scions(s)).toBe(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Redeemer').length).toBe(1);
    const declined = cast(s1, 'Test Redeemer', { yes: [false] });
    expect(scions(declined)).toBe(0);
  });
  it('with no creature of yours dead this turn it makes none (the negative case)', () => {
    expect(scions(cast(setup(), 'Test Redeemer', { yes: [true] }))).toBe(0);
  });
});
