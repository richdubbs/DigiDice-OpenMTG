/**
 * edh-next-131 (must-finish round, group copies): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative cases and the Scryfall rulings.
 *
 *   CR 707.2, 111.1, 115.1, 608.2c, 702.96a-b   March of Progress: "Choose target artifact creature you control. For each creature chosen this way, create a token that's a copy of it." with overload
 */
import { describe, expect, it } from 'vitest';
import { commanderOptions, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { mpScenario } from '../../m12/rules/helpers';
import { legend } from '../../m11/rules/helpers';
import { activatedAbilities } from '../../../src/rules/abilities';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; layout?: string } = {}): CardDef {
  return compileCard({ name, layout: opts.layout ?? 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

// ---- shared driver ---------------------------------------------------------------------------------------------------------------------------------------------------
interface Script { yes?: boolean[]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; targets?: TargetChoice[][]; numbers?: number[]; options?: string[][]; seen?: { kind: string; player: PlayerId; options?: ObjectId[] }[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.seen?.push({ kind: p.kind, player: p.player, ...(p.kind === 'chooseObjects' ? { options: [...p.options] } : p.kind === 'chooseTargets' ? { options: [...((p as { objects?: ObjectId[] }).objects ?? [])] } : {}) });
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] } as never);
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] } as never);
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', method?: string): GameState =>
  settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method ? { method } : {}) } as never), script), script);
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id } as TargetChoice);

// ---- March of Progress -----------------------------------------------------------------------------------------------------------------------------------------------
const MARCH = card('Test Forward Parade', 'Sorcery', "Choose target artifact creature you control. For each creature chosen this way, create a token that's a copy of it.\nOverload {0}", { cost: '{0}', colors: ['U'] });
const GOLEM = card('Test Brass Golem', 'Artifact Creature — Golem', '', { cost: '{3}', pt: ['3', '3'] });
const THOPTER = card('Test Tin Thopter', 'Artifact Creature — Thopter', 'Flying', { cost: '{1}', pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', pt: ['2', '2'], colors: ['G'] });
const SHROUDED = card('Test Veiled Construct', 'Artifact Creature — Construct', 'Hexproof', { cost: '{2}', pt: ['2', '2'] });

describe('CR 707.2, 111.1, 115.1, 608.2c, 702.96a-b: March of Progress, "Choose target artifact creature you control. For each creature chosen this way, create a token that\'s a copy of it." with overload', () => {
  const setup = (): GameState => mpScenario({
    defs: [MARCH, GOLEM, THOPTER, BEAR, SHROUDED],
    zones: { p1: { hand: ['Test Forward Parade'], battlefield: ['Test Brass Golem', 'Test Tin Thopter', 'Test Bear', 'Test Veiled Construct'] }, p2: { battlefield: ['Test Brass Golem'] }, p3: {}, p4: {} },
  });
  it('is automated', () => expect(full(MARCH)).toBe(true));
  it('cast normally: one target artifact creature you control (not a non-artifact creature, not an opponent\'s); one token copy of it, the copiable values only (ruling 2022-10-14)', () => {
    const s0 = setup();
    const golem = find(s0, 'Test Brass Golem', 'battlefield', 'p1');
    const s = cast(s0, 'Test Forward Parade', { targets: [[obj(golem)]] });
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(1);
    expect(getChars(s, toks[0]!).name).toBe('Test Brass Golem');
    expect(tokensOf(s, 'p2').length).toBe(0);
  });
  it('the target must be an artifact creature you control: a Bear and an opponent\'s Golem are refused (the negative case)', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Brass Golem', 'battlefield', 'p2');
    for (const bad of [bear, theirs]) {
      let threw = false;
      let s: GameState | undefined;
      try { s = cast(s0, 'Test Forward Parade', { targets: [[obj(bad)]] }); } catch { threw = true; }
      if (!threw) expect(tokensOf(s!, 'p1').length).toBe(0);
    }
  });
  it('cast for its overload cost: no target; one token copy of EACH artifact creature you control, hexproof ones too (ruling 2022-10-14); not of the Bear or the opponent\'s Golem', () => {
    const s0 = setup();
    const seen: NonNullable<Script['seen']> = [];
    const s = cast(s0, 'Test Forward Parade', { seen }, 'p1', 'overload');
    expect(seen.some((x) => x.kind === 'chooseTargets')).toBe(false);
    const names = tokensOf(s, 'p1').map((id) => getChars(s, id).name).sort();
    expect(names).toEqual(['Test Brass Golem', 'Test Tin Thopter', 'Test Veiled Construct']);
    expect(tokensOf(s, 'p2').length).toBe(0);
  });
});

// ---- Finale of Promise -----------------------------------------------------------------------------------------------------------------------------------------------
const FINALE = card('Test Closing Vow', 'Sorcery', "You may cast up to one target instant card and/or up to one target sorcery card from your graveyard each with mana value X or less without paying their mana costs. If a spell cast this way would be put into your graveyard, exile it instead. If X is 10 or more, copy each of those spells twice. You may choose new targets for the copies.", { cost: '{X}', colors: ['R'] });
const SALVE = card('Test Quick Salve', 'Instant', 'You gain 3 life.', { cost: '{1}{W}', colors: ['W'] });
const HEX = card('Test Slow Hex', 'Sorcery', 'Each opponent loses 2 life.', { cost: '{1}{B}', colors: ['B'] });
const BIGHEX = card('Test Grand Hex', 'Sorcery', 'Each opponent loses 5 life.', { cost: '{2}{B}', colors: ['B'] });
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const give = (s: GameState, n: number): GameState => { for (let k = 0; k < n; k++) s.players[0]!.manaPool.push({ type: 'C' } as never); return s; };

describe('CR 601.2, 115.1, 601.2c, 107.3, 608.2g, 614.1a, 707.10, 707.10c: Finale of Promise, "You may cast up to one target instant card and/or up to one target sorcery card from your graveyard each with mana value X or less ..."', () => {
  const setup = (): GameState => mpScenario({
    defs: [FINALE, SALVE, HEX, BIGHEX],
    zones: { p1: { hand: ['Test Closing Vow'], graveyard: ['Test Quick Salve', 'Test Slow Hex', 'Test Grand Hex'] }, p2: { graveyard: ['Test Slow Hex'] }, p3: {}, p4: {} },
  });
  it('is automated', () => expect(full(FINALE)).toBe(true));
  it('X = 2: both targets (an instant and a sorcery of your graveyard, mana value 2 or less) are cast free in the order you choose, then exiled instead of going to your graveyard; no copies (X < 10)', () => {
    const s0 = give(setup(), 2);
    const salve = find(s0, 'Test Quick Salve', 'graveyard', 'p1');
    const hex = find(s0, 'Test Slow Hex', 'graveyard', 'p1');
    const s = cast(s0, 'Test Closing Vow', { numbers: [2], targets: [[obj(salve)], [obj(hex)]], objects: [[hex, salve]] });
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Quick Salve')).toBe(true);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Slow Hex')).toBe(true);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Quick Salve' || s.objects[id]!.defId === 'Test Slow Hex')).toBe(false);
  });
  it('the targets are limited: mana value X or less, your own graveyard, one of each card type (the negative cases)', () => {
    const s0 = give(setup(), 2);
    const big = find(s0, 'Test Grand Hex', 'graveyard', 'p1');
    const theirs = find(s0, 'Test Slow Hex', 'graveyard', 'p2');
    const seen: NonNullable<Script['seen']> = [];
    cast(s0, 'Test Closing Vow', { seen, numbers: [2], targets: [[], []] });
    const asks = seen.filter((x) => x.kind === 'chooseTargets');
    expect(asks.length).toBe(2);
    const [instants, sorceries] = asks.map((a) => a.options ?? []);
    expect(instants).toEqual([find(s0, 'Test Quick Salve', 'graveyard', 'p1')]);
    expect(sorceries).toEqual([find(s0, 'Test Slow Hex', 'graveyard', 'p1')]);
    expect([...instants!, ...sorceries!]).not.toContain(big);
    expect([...instants!, ...sorceries!]).not.toContain(theirs);
  });
  it('"you may": casting none of them is allowed; the cards stay in the graveyard', () => {
    const s0 = give(setup(), 2);
    const salve = find(s0, 'Test Quick Salve', 'graveyard', 'p1');
    const s = cast(s0, 'Test Closing Vow', { numbers: [2], targets: [[obj(salve)], []], objects: [[]] });
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.graveyard.p1!.includes(salve)).toBe(true);
  });
  it('X = 10: each spell cast this way is copied twice (copies resolve first, are not cast); the originals still go to exile', () => {
    const s0 = give(setup(), 10);
    const salve = find(s0, 'Test Quick Salve', 'graveyard', 'p1');
    const hex = find(s0, 'Test Grand Hex', 'graveyard', 'p1');
    const s = cast(s0, 'Test Closing Vow', { numbers: [10], targets: [[obj(salve)], [obj(hex)]], objects: [[salve, hex]] });
    expect(lifeOf(s, 'p1')).toBe(29);
    expect(lifeOf(s, 'p2')).toBe(5);
    expect(s.zones.exile.filter((id) => ['Test Quick Salve', 'Test Grand Hex'].includes(s.objects[id]!.defId)).length).toBe(2);
  });
});

// ---- The Peregrine Dynamo --------------------------------------------------------------------------------------------------------------------------------------------
const DYNAMO = card('Test Wandering Engine', 'Legendary Artifact Creature — Construct', "Haste\n{1}, {T}: Copy target activated or triggered ability you control from another legendary source that's not a commander. You may choose new targets for the copy.\n{2}: You gain 1 life.", { cost: '{4}', pt: ['3', '3'] });
const SAGE = card('Test Elder Sage', 'Legendary Creature — Human', '{T}: You gain 2 life.', { cost: '{1}{W}', pt: ['1', '1'], colors: ['W'] });
const MONK = card('Test Plain Monk', 'Creature — Human Monk', '{T}: You gain 3 life.', { cost: '{1}{W}', pt: ['1', '1'], colors: ['W'] });
const activate = (s: GameState, name: string, k = 0, script: Script = {}, player: PlayerId = 'p1'): GameState => {
  const src = find(s, name, 'battlefield', player);
  return drive(act(s, { type: 'activate', player, source: src, ability: activatedAbilities(s, s.objects[src]!)[k]!.key } as never), script);
};
const stackAbilityOf = (s: GameState, name: string): ObjectId => s.zones.stack.find((id) => s.objects[id]!.kind === 'ability' && s.objects[s.objects[id]!.stack!.sourceId!]?.defId === name)!;

describe("CR 707.10, 113.7a, 205.4a, 903.3, 109.2: The Peregrine Dynamo, \"Copy target activated or triggered ability you control from another legendary source that's not a commander.\"", () => {
  const setup = (): GameState => {
    const s = mpScenario({ defs: [DYNAMO, SAGE, MONK], zones: { p1: { battlefield: ['Test Wandering Engine', 'Test Elder Sage', 'Test Plain Monk'] }, p2: { battlefield: ['Test Elder Sage'] }, p3: {}, p4: {} } });
    for (const id of s.zones.battlefield) s.objects[id] = { ...s.objects[id]!, controlledSinceTurn: -1 };
    return s;
  };
  it('is automated', () => expect(full(DYNAMO)).toBe(true));
  it('copies the ability of your other legendary source: the copy resolves too (the source of the copy is the same, ruling 2022-09-09)', () => {
    let s = give(setup(), 1);
    s = activate(s, 'Test Elder Sage');
    const ab = stackAbilityOf(s, 'Test Elder Sage');
    const seen: NonNullable<Script['seen']> = [];
    s = settle(activate(s, 'Test Wandering Engine', 0, { seen, targets: [[obj(ab)]] }), {});
    expect(lifeOf(s, 'p1')).toBe(24);
  });
  it('only that ability is a legal target: not the ability of a nonlegendary source, not the Dynamo\'s own (another), not an opponent\'s (the negative cases)', () => {
    let s = give(setup(), 3);
    s = activate(s, 'Test Elder Sage');
    s = activate(s, 'Test Plain Monk');
    s = activate(s, 'Test Wandering Engine', 1);
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    s = activate(s, 'Test Elder Sage', 0, {}, 'p2');
    const mine = stackAbilityOf(s, 'Test Elder Sage');
    const seen: NonNullable<Script['seen']> = [];
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p1') s = drive(act(s, { type: 'pass', player: s.pending.player }));
    s = activate(s, 'Test Wandering Engine', 0, { seen, targets: [[obj(mine)]] });
    const ask = seen.find((x) => x.kind === 'chooseTargets');
    const sages = s.zones.stack.filter((id) => s.objects[id]!.kind === 'ability' && s.objects[s.objects[id]!.stack!.sourceId!]?.defId === 'Test Elder Sage');
    expect(sages.length).toBe(2);
    expect(ask?.options?.filter((id) => s.objects[id]?.kind === 'ability')).toEqual([s.zones.stack.find((id) => id === mine)]);
  });
  it('a commander is no such source (CR 903.3): your legendary commander\'s ability is not a legal target; outside a Commander game the same legend is', () => {
    const CAPTAIN = legend('Test Captain', '{1}{W}', ['3', '3'], ['W']);
    const capt = { ...CAPTAIN, faces: [{ ...CAPTAIN.faces[0]!, abilities: SAGE.faces[0]!.abilities }] } as CardDef;
    let s = mpScenario({
      defs: [DYNAMO], commanders: { p1: [capt], p2: [legend('Test Beta', '{1}{W}', ['3', '3'], ['W'])], p3: [legend('Test Gamma', '{1}{W}', ['3', '3'], ['W'])], p4: [legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])] },
      options: { commander: commanderOptions('commander') }, zones: { p1: { battlefield: ['Test Wandering Engine'] } },
      setup: (x) => {
        const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Test Captain')!;
        x.zones.command = x.zones.command.filter((o) => o !== id);
        x.zones.battlefield.push(id);
        x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
        for (const b of x.zones.battlefield) x.objects[b] = { ...x.objects[b]!, controlledSinceTurn: -1 };
      },
    });
    s = give(s, 1);
    s = activate(s, 'Test Captain');
    const before = lifeOf(s, 'p1');
    const r = (() => { try { const t = activate(s, 'Test Wandering Engine', 0, { targets: [[obj(stackAbilityOf(s, 'Test Captain'))]] }); return t.zones.stack.length > 1 && t.pending?.kind === 'priority' ? 'activated' : 'refused'; } catch { return 'refused'; } })();
    expect(stackAbilityOf(s, 'Test Captain')).toBeDefined();
    expect(r).toBe('refused');
    expect(before).toBe(40);
    // the same legend, not a commander (no Commander game): a legal target
    let t = mpScenario({ defs: [DYNAMO, capt], zones: { p1: { battlefield: ['Test Wandering Engine', 'Test Captain'] } }, setup: (x) => { for (const b of x.zones.battlefield) x.objects[b] = { ...x.objects[b]!, controlledSinceTurn: -1 }; } });
    t = give(t, 1);
    t = activate(t, 'Test Captain');
    t = settle(activate(t, 'Test Wandering Engine', 0, { targets: [[obj(stackAbilityOf(t, 'Test Captain'))]] }));
    expect(lifeOf(t, 'p1')).toBe(24);
  });
});

// ---- Mirage Phalanx --------------------------------------------------------------------------------------------------------------------------------------------------
const PHALANX = card('Test Echo Squad', 'Creature — Human Soldier', "Soulbond\nAs long as Test Echo Squad is paired with another creature, each of those creatures has \"At the beginning of combat on your turn, create a token that's a copy of this creature, except it has haste and loses soulbond. Exile it at end of combat.\"", { cost: '{4}{R}{R}', pt: ['4', '4'], colors: ['R'] });
/** Pass priority (driving decisions with the script) until the game is at `step` of the current turn with the stack empty. */
function toStep(s0: GameState, step: string, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; guard < 80 && !(s.turn.step === step && s.zones.stack.length === 0); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }), script);
  return s;
}
const pairUp = (s0: GameState, a: string, b: string): GameState => {
  const s = structuredClone(s0);
  const x = s.objects[find(s, a, 'battlefield', 'p1')]!;
  const y = s.objects[find(s, b, 'battlefield', 'p1')]!;
  x.pairedWith = y.id; y.pairedWith = x.id; x.pairedBy = y.pairedBy = 'p1';
  return s;
};
const kw = (s: GameState, id: ObjectId, k: string): boolean => JSON.stringify(getChars(s, id).abilities ?? []).toLowerCase().includes(`"keyword":"${k}"`);

describe('CR 702.95, 613.1f, 707.2, 707.9b, 702.10, 603.7: Mirage Phalanx, paired creatures each have "At the beginning of combat on your turn, create a token that\'s a copy of this creature, except it has haste and loses soulbond. Exile it at end of combat."', () => {
  const setup = (): GameState => mpScenario({ defs: [PHALANX, BEAR], zones: { p1: { battlefield: ['Test Echo Squad', 'Test Bear'] }, p2: {}, p3: {}, p4: {} } });
  it('is automated', () => expect(full(PHALANX)).toBe(true));
  it('paired: at the beginning of combat each of the two makes a token copy of ITSELF with haste and without soulbond; both tokens are exiled at end of combat', () => {
    let s = toStep(pairUp(setup(), 'Test Echo Squad', 'Test Bear'), 'beginCombat');
    const toks = tokensOf(s, 'p1');
    expect(toks.map((id) => getChars(s, id).name).sort()).toEqual(['Test Bear', 'Test Echo Squad']);
    for (const id of toks) expect(kw(s, id, 'haste')).toBe(true);
    const squad = toks.find((id) => getChars(s, id).name === 'Test Echo Squad')!;
    expect(kw(s, squad, 'soulbond')).toBe(false);
    expect(s.objects[squad]!.pairedWith).toBeUndefined();
    s = toStep(s, 'main2');
    expect(tokensOf(s, 'p1').length).toBe(0);
    expect(s.zones.exile.length).toBe(0); // tokens cease to exist in exile (CR 111.7)
  });
  it('unpaired: neither creature has the ability, no token (the negative case)', () => {
    const s = toStep(setup(), 'beginCombat');
    expect(tokensOf(s, 'p1').length).toBe(0);
  });
  it('"on your turn": an opponent\'s beginning of combat makes no token', () => {
    let s = pairUp(setup(), 'Test Echo Squad', 'Test Bear');
    s = toStep(s, 'main2');
    for (let guard = 0; guard < 300 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'beginCombat'); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    s = settle(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(tokensOf(s, 'p1').filter((id) => s.objects[id]!.zone === 'battlefield').length).toBe(0);
  });
});

// ---- Blue Mage's Cane ------------------------------------------------------------------------------------------------------------------------------------------------
const CANE = card('Test Azure Rod', 'Artifact — Equipment', "Equipped creature gets +0/+2, is a Wizard in addition to its other types, and has \"Whenever this creature attacks, exile up to one target instant or sorcery card from defending player's graveyard. If you do, copy it. You may cast the copy by paying {3} rather than paying its mana cost.\"\nEquip {2}", { cost: '{2}{U}' });
const BIGSALVE = card('Test Deep Salve', 'Instant', 'You gain 5 life.', { cost: '{4}{W}{W}', colors: ['W'] });
/** Declare `attacker` attacking `defender` (from main1), then resolve its attack trigger with the script. */
function attackWith(s0: GameState, attacker: ObjectId, defender: PlayerId, script: Script = {}, _mana = 0): GameState {
  let s = s0;
  for (let guard = 0; guard < 20 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender }] } as never);
  return settle(s, script);
}

describe("CR 301.5, 613.1f, 707.12, 601.2b, 118.9, 608.2c, 508.1: Blue Mage's Cane, \"exile up to one target instant or sorcery card from defending player's graveyard. If you do, copy it. You may cast the copy by paying {3} rather than paying its mana cost.\"", () => {
  const setup = (): GameState => {
    const s = mpScenario({ defs: [CANE, BEAR, BIGSALVE, SALVE], zones: { p1: { battlefield: ['Test Azure Rod', 'Test Bear', 'Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Deep Salve'] }, p3: { graveyard: ['Test Quick Salve'] }, p4: {} } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const cane = find(s, 'Test Azure Rod', 'battlefield', 'p1');
    s.objects[cane] = { ...s.objects[cane]!, attachedTo: bear };
    for (const id of s.zones.battlefield) s.objects[id] = { ...s.objects[id]!, controlledSinceTurn: -1 };
    return s;
  };
  it('is automated', () => expect(full(CANE)).toBe(true));
  it('the equipped creature is a Wizard with +0/+2', () => {
    const s = setup();
    const ch = getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(ch.subtypes).toEqual(expect.arrayContaining(['Bear', 'Wizard']));
    expect(ch.toughness).toBe('4');
  });
  it('attacking: a card of the DEFENDING player\'s graveyard is exiled, its copy cast for {3} (not its mana cost of six); the card stays in exile, its owner\'s (ruling 2025-06-06)', () => {
    const s0 = setup();
    const deep = find(s0, 'Test Deep Salve', 'graveyard', 'p2');
    const seen: NonNullable<Script['seen']> = [];
    const s = attackWith(s0, find(s0, 'Test Bear', 'battlefield', 'p1'), 'p2', { seen, targets: [[obj(deep)]], yes: [true] }, 3);
    const ask = seen.find((x) => x.kind === 'chooseTargets');
    expect(ask?.options).toEqual([deep]);
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped).length).toBe(3);
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Deep Salve');
    expect(exiled.length).toBe(1);
    expect(s.objects[exiled[0]!]!.owner).toBe('p2');
  });
  it('the copy may be declined: no life, the card stays exiled; and nothing exiled means no copy (the negative cases)', () => {
    const s0 = setup();
    const deep = find(s0, 'Test Deep Salve', 'graveyard', 'p2');
    const s = attackWith(s0, find(s0, 'Test Bear', 'battlefield', 'p1'), 'p2', { targets: [[obj(deep)]], yes: [false] }, 3);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Deep Salve').length).toBe(1);
    const t = attackWith(setup(), find(s0, 'Test Bear', 'battlefield', 'p1'), 'p2', { targets: [[]], yes: [true] }, 3);
    expect(lifeOf(t, 'p1')).toBe(20);
    expect(t.zones.graveyard.p2!.length).toBe(1);
  });
  it('attacking another player: that player\'s graveyard is the one (p3\'s card, not p2\'s)', () => {
    const s0 = setup();
    const seen: NonNullable<Script['seen']> = [];
    const quick = find(s0, 'Test Quick Salve', 'graveyard', 'p3');
    const s = attackWith(s0, find(s0, 'Test Bear', 'battlefield', 'p1'), 'p3', { seen, targets: [[obj(quick)]], yes: [true] }, 3);
    expect(seen.find((x) => x.kind === 'chooseTargets')?.options).toEqual([quick]);
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});

// ---- Arna Kennerüd, Skycaptain ---------------------------------------------------------------------------------------------------------------------------------------
const ARNA = card('Test Sky Marshal', 'Legendary Creature — Human Knight', "Flying, lifelink\nWhenever a modified creature you control attacks, double the number of each kind of counter on it. Then for each nontoken permanent attached to it, create a token that's a copy of that permanent attached to that creature.", { cost: '{2}{W}{U}', pt: ['4', '4'], colors: ['W', 'U'] });
const BLADE = card('Test Iron Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}', { cost: '{1}' });
const WARD = card('Test Gleam Ward', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+1.', { cost: '{W}', colors: ['W'] });

describe('CR 700.9, 707.2, 111.1, 303.4f, 301.5c, 608.2c: Arna Kennerüd, "Then for each nontoken permanent attached to it, create a token that\'s a copy of that permanent attached to that creature."', () => {
  const setup = (attach: string[], opts: { tokenBlade?: boolean; counters?: number; theirWard?: boolean } = {}): GameState => mpScenario({
    defs: [ARNA, BEAR, BLADE, WARD], zones: { p1: { battlefield: ['Test Sky Marshal', 'Test Bear', ...attach] }, p2: { battlefield: opts.theirWard ? ['Test Gleam Ward'] : [] }, p3: {}, p4: {} },
    setup: (s) => {
      const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear')!;
      for (const id of s.zones.battlefield) {
        const o = s.objects[id]!;
        if (o.defId === 'Test Iron Blade' || o.defId === 'Test Gleam Ward') s.objects[id] = { ...o, attachedTo: bear, ...(opts.tokenBlade && o.defId === 'Test Iron Blade' ? { kind: 'token' as const } : {}) };
        s.objects[id] = { ...s.objects[id]!, controlledSinceTurn: -1 };
      }
      if (opts.counters) s.objects[bear] = { ...s.objects[bear]!, counters: { '+1/+1': opts.counters } } as never;
    },
  });
  const attachedTo = (s: GameState, host: ObjectId, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name && s.objects[id]!.attachedTo === host);
  it('is automated', () => expect(full(ARNA)).toBe(true));
  it('an equipped and enchanted creature attacks: its counters double, then a token copy of the Equipment and of the Aura enter attached to IT', () => {
    const s0 = setup(['Test Iron Blade', 'Test Gleam Ward'], { counters: 2 });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = attackWith(s0, bear, 'p2');
    expect((s.objects[bear]!.counters as Record<string, number>)['+1/+1']).toBe(4);
    const blades = attachedTo(s, bear, 'Test Iron Blade');
    const wards = attachedTo(s, bear, 'Test Gleam Ward');
    expect(blades.length).toBe(2);
    expect(wards.length).toBe(2);
    expect(blades.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
    expect(wards.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
    expect(getChars(s, bear).power).toBe('8'); // 2 + 4 counters + 1 + 1
  });
  it('a TOKEN attached is not copied (nontoken permanents only): the negative case', () => {
    const s0 = setup(['Test Iron Blade'], { tokenBlade: true });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = attackWith(s0, bear, 'p2');
    expect(attachedTo(s, bear, 'Test Iron Blade').length).toBe(1);
  });
  it('an unmodified creature does not trigger it; an Aura of another player makes it no modified creature (ruling 2024-06-07)', () => {
    const s0 = setup([], { theirWard: true });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Gleam Ward', 'battlefield', 'p2');
    const s = attackWith(s0, bear, 'p2');
    expect(s.objects[theirs]!.attachedTo).toBe(bear);
    expect(tokensOf(s, 'p1').length).toBe(0);
  });
});

// ---- Eumidian Wastewaker ---------------------------------------------------------------------------------------------------------------------------------------------
const WASTER = card('Test Dust Reaver', 'Creature — Insect Cleric', 'Whenever this creature attacks, you and defending player each discard a card or sacrifice a permanent. You draw a card for each land card put into a graveyard this way.', { cost: '{2}{B}', pt: ['3', '3'], colors: ['B'] });
const LANDTOKEN = card('Test Map Land', 'Land', '{T}: Add {C}.', { cost: '' });

describe('CR 101.4, 608.2d, 701.9a, 701.21a, 111.7: Eumidian Wastewaker, "you and defending player each discard a card or sacrifice a permanent. You draw a card for each land card put into a graveyard this way."', () => {
  const setup = (p1: { hand?: string[]; battlefield?: string[] }, p2: { hand?: string[]; battlefield?: string[] }, tokenLand = false): GameState => mpScenario({
    defs: [WASTER, BEAR, SALVE, LANDTOKEN],
    zones: { p1: { hand: p1.hand ?? [], battlefield: ['Test Dust Reaver', ...(p1.battlefield ?? [])] }, p2: { hand: p2.hand ?? [], battlefield: p2.battlefield ?? [] }, p3: { hand: ['Plains'] }, p4: {} },
    setup: (s) => {
      for (const id of s.zones.battlefield) {
        s.objects[id] = { ...s.objects[id]!, controlledSinceTurn: -1 };
        if (tokenLand && s.objects[id]!.defId === 'Test Map Land') s.objects[id] = { ...s.objects[id]!, kind: 'token' as const };
      }
    },
  });
  const reaver = (s: GameState): ObjectId => find(s, 'Test Dust Reaver', 'battlefield', 'p1');
  const handOf = (s: GameState, p: PlayerId): number => (s.zones.hand[p] ?? []).length;
  it('is automated', () => expect(full(WASTER)).toBe(true));
  it('you discard a land card; defending player, with no hand, must sacrifice (a land): two land cards, you draw two (rulings 2025-07-25)', () => {
    const s0 = setup({ hand: ['Plains', 'Test Quick Salve'] }, { battlefield: ['Plains', 'Test Bear'] });
    const myPlains = find(s0, 'Plains', 'hand', 'p1');
    const theirPlains = find(s0, 'Plains', 'battlefield', 'p2');
    const seen: NonNullable<Script['seen']> = [];
    const s = attackWith(s0, reaver(s0), 'p2', { seen, options: [['discard']], objects: [[myPlains], [theirPlains]] });
    expect(seen.filter((x) => x.kind === 'chooseOption').map((x) => x.player)).toEqual(['p1']); // p2 had no choice: an empty hand
    expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === 'Plains')).toBe(true);
    expect(handOf(s, 'p1')).toBe(handOf(s0, 'p1') - 1 + 2);
    expect(handOf(s, 'p3')).toBe(handOf(s0, 'p3')); // the third player is not involved
  });
  it('nonland cards count nothing: you sacrifice a creature and defending player discards an instant: no draw', () => {
    const s0 = setup({ hand: ['Plains'], battlefield: ['Test Bear'] }, { hand: ['Test Quick Salve'], battlefield: ['Plains'] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = attackWith(s0, reaver(s0), 'p2', { options: [['sacrifice'], ['discard']], objects: [[bear], [find(s0, 'Test Quick Salve', 'hand', 'p2')]] });
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === 'Test Quick Salve')).toBe(true);
    expect(handOf(s, 'p1')).toBe(handOf(s0, 'p1'));
  });
  it('a sacrificed land TOKEN is no land card in a graveyard (ruling 2025-07-25); a player with neither a card nor a permanent does nothing', () => {
    const s0 = setup({ hand: ['Plains'] }, { battlefield: ['Test Map Land'] }, true);
    const s = attackWith(s0, reaver(s0), 'p2', { options: [['discard']], objects: [[find(s0, 'Plains', 'hand', 'p1')]] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Map Land')).toBe(false);
    expect(handOf(s, 'p1')).toBe(handOf(s0, 'p1') - 1 + 1); // only your discarded Plains counts
    const t0 = setup({ hand: ['Plains'] }, {});
    const t = attackWith(t0, reaver(t0), 'p2', { options: [['discard']], objects: [[find(t0, 'Plains', 'hand', 'p1')]] });
    expect(handOf(t, 'p1')).toBe(handOf(t0, 'p1') - 1 + 1);
    expect(t.zones.graveyard.p2!.length).toBe(0);
  });
});

// ---- Jacob Frye ------------------------------------------------------------------------------------------------------------------------------------------------------
const JACOB = card('Test Twin Blade', 'Legendary Creature — Human Assassin', 'Whenever one or more Assassins you control deal combat damage to a player, exile up to one target Assassin card or card with freerunning from your graveyard. If you do, copy it. You may cast the copy.', { cost: '{1}{U}{B}', pt: ['2', '2'], colors: ['U', 'B'] });
const RUNNER = card('Test Rooftop Dash', 'Instant', 'Freerunning {B}\nYou gain 3 life.', { cost: '{1}{W}', colors: ['W'] });
const KNIFE = card('Test Hired Knife', 'Creature — Human Assassin', '', { cost: '{1}', pt: ['1', '1'], colors: ['B'] });

describe('CR 510.3a, 603.2, 707.12, 702.173a, 608.2c: Jacob Frye, "exile up to one target Assassin card or card with freerunning from your graveyard. If you do, copy it. You may cast the copy."', () => {
  const setup = (gy: string[]): GameState => mpScenario({
    defs: [JACOB, RUNNER, KNIFE, SALVE],
    zones: { p1: { battlefield: ['Test Twin Blade', 'Plains', 'Plains'], graveyard: gy }, p2: {}, p3: {}, p4: {} },
    setup: (s) => { for (const id of s.zones.battlefield) s.objects[id] = { ...s.objects[id]!, controlledSinceTurn: -1 }; },
  });
  const hit = (s0: GameState, script: Script): GameState => toStep(attackWith(s0, find(s0, 'Test Twin Blade', 'battlefield', 'p1'), 'p2'), 'combatDamage', script);
  it('is automated', () => expect(full(JACOB)).toBe(true));
  it('combat damage to a player: a card with freerunning is exiled, its copy cast (its costs paid): you gain 3; the card stays in exile', () => {
    const s0 = setup(['Test Rooftop Dash', 'Test Quick Salve']);
    const dash = find(s0, 'Test Rooftop Dash', 'graveyard', 'p1');
    const seen: NonNullable<Script['seen']> = [];
    const s = hit(s0, { seen, targets: [[obj(dash)]], yes: [true] });
    const ask = seen.find((x) => x.kind === 'chooseTargets');
    expect(ask?.options).toEqual([dash]); // not the plain instant (the negative case)
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Rooftop Dash')).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped).length).toBe(2);
  });
  it('an Assassin creature card: its copy becomes a token Assassin (a copy of a permanent spell); with no target chosen nothing is copied', () => {
    const s0 = setup(['Test Hired Knife']);
    const knife = find(s0, 'Test Hired Knife', 'graveyard', 'p1');
    const s = hit(s0, { targets: [[obj(knife)]], yes: [true] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token' && getChars(s, id).name === 'Test Hired Knife')).toBe(true);
    const t = hit(setup(['Test Hired Knife']), { targets: [[]], yes: [true] });
    expect(t.zones.graveyard.p1!.length).toBe(1);
    expect(t.zones.battlefield.some((id) => s.objects[id]?.kind === 'token')).toBe(false);
  });
});

// ---- God-Pharaoh's Gift ----------------------------------------------------------------------------------------------------------------------------------------------
const GIFT = card('Test Pharaoh Boon', 'Artifact', "At the beginning of combat on your turn, you may exile a creature card from your graveyard. If you do, create a token that's a copy of that card, except it's a 4/4 black Zombie. It gains haste until end of turn.", { cost: '{7}' });
const ELF = card('Test Grove Elf', 'Creature — Elf Druid', '{T}: You gain 1 life.', { cost: '{G}', pt: ['1', '1'], colors: ['G'] });

describe("CR 118.12, 400.7j, 707.2, 707.9b, 613.1d-e, 608.2c: God-Pharaoh's Gift, \"you may exile a creature card from your graveyard. If you do, create a token that's a copy of that card, except it's a 4/4 black Zombie. It gains haste until end of turn.\"", () => {
  const setup = (gy: string[]): GameState => mpScenario({ defs: [GIFT, ELF, SALVE], zones: { p1: { battlefield: ['Test Pharaoh Boon'], graveyard: gy }, p2: {}, p3: {}, p4: {} } });
  it('is automated', () => expect(full(GIFT)).toBe(true));
  it('exiled: the token copies that card (its name, mana cost, abilities) except it is a 4/4 black Zombie creature only; it has haste this turn (rulings 2017-07-14)', () => {
    const s0 = setup(['Test Grove Elf', 'Test Quick Salve']);
    const elf = find(s0, 'Test Grove Elf', 'graveyard', 'p1');
    const seen: NonNullable<Script['seen']> = [];
    const s = toStep(s0, 'beginCombat', { seen, yes: [true], objects: [[elf]] });
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(1);
    const ch = getChars(s, toks[0]!);
    expect(ch.name).toBe('Test Grove Elf');
    expect([ch.power, ch.toughness]).toEqual(['4', '4']);
    expect(ch.colors).toEqual(['B']);
    expect(ch.types).toEqual(['Creature']);
    expect(ch.subtypes).toEqual(['Zombie']);
    expect(kw(s, toks[0]!, 'haste')).toBe(true);
    expect(JSON.stringify(ch.abilities)).toContain('You gain 1 life');
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Grove Elf')).toBe(true);
    const pick = seen.find((x) => x.kind === 'chooseObjects');
    if (pick) expect(pick.options).not.toContain(find(s0, 'Test Quick Salve', 'graveyard', 'p1')); // a creature card only
  });
  it('"you may": declined, nothing is exiled and no token; with no creature card nothing happens (the negative cases)', () => {
    const s = toStep(setup(['Test Grove Elf']), 'beginCombat', { yes: [false] });
    expect(tokensOf(s, 'p1').length).toBe(0);
    expect(s.zones.graveyard.p1!.length).toBe(1);
    const t = toStep(setup(['Test Quick Salve']), 'beginCombat', { yes: [true] });
    expect(tokensOf(t, 'p1').length).toBe(0);
    expect(t.zones.graveyard.p1!.length).toBe(1);
  });
  it('the haste lasts until end of turn only: on the next turn of yours the token has no haste', () => {
    let s = toStep(setup(['Test Grove Elf']), 'beginCombat', { yes: [true] });
    const tok = tokensOf(s, 'p1')[0]!;
    s = toStep(s, 'main2');
    for (let guard = 0; guard < 300 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'main1'); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }), { yes: [false] });
    expect(kw(s, tok, 'haste')).toBe(false);
  });
});

// ---- Krothuss, Lord of the Deep (Runo Stromkirk's back face) ------------------------------------------------------------------------------------------------------------
const KROTHUSS = card('Test Abyss Lord', 'Legendary Creature — Kraken Horror', "Flying\nWhenever Test Abyss Lord attacks, create a tapped and attacking token that's a copy of another target attacking creature. If that creature is a Kraken, Leviathan, Octopus, or Serpent, create two of those tokens instead.", { cost: '{4}{U}{B}', pt: ['3', '5'], colors: ['U', 'B'] });
const OCTO = card('Test Reef Octopus', 'Creature — Octopus', '', { cost: '{1}{U}', pt: ['2', '2'], colors: ['U'] });

describe('CR 508.4, 707.2, 111.1, 608.2c, 614.15: Krothuss, "create a tapped and attacking token that\'s a copy of another target attacking creature. If that creature is a Kraken, Leviathan, Octopus, or Serpent, create two of those tokens instead."', () => {
  const setup = (): GameState => mpScenario({
    defs: [KROTHUSS, OCTO, BEAR], zones: { p1: { battlefield: ['Test Abyss Lord', 'Test Reef Octopus', 'Test Bear', 'Test Bear'] }, p2: {}, p3: {}, p4: {} },
    setup: (s) => { for (const id of s.zones.battlefield) s.objects[id] = { ...s.objects[id]!, controlledSinceTurn: -1 }; },
  });
  /** Declare the attacks, then resolve the attack trigger with the script. */
  function attackMany(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], script: Script): GameState {
    let s = s0;
    for (let guard = 0; guard < 20 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks } as never);
    return settle(s, script);
  }
  const attackingTokens = (s: GameState): ObjectId[] => tokensOf(s, 'p1').filter((id) => s.combat?.attackers.some((a) => a.id === id) === true);
  it('is automated', () => expect(full(KROTHUSS)).toBe(true));
  it('another attacking creature that is no Kraken, Leviathan, Octopus or Serpent: ONE token copy, tapped and attacking; only attacking creatures other than itself are targets', () => {
    const s0 = setup();
    const lord = find(s0, 'Test Abyss Lord', 'battlefield', 'p1');
    const [bear, bear2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    const seen: NonNullable<Script['seen']> = [];
    const s = attackMany(s0, [{ attacker: lord, defender: 'p2' }, { attacker: bear!, defender: 'p3' }], { seen, targets: [[obj(bear!)]] });
    const ask = seen.find((x) => x.kind === 'chooseTargets');
    expect(ask?.options).toEqual([bear]); // not itself (another), not the non-attacking Octopus or second Bear
    expect(ask?.options).not.toContain(bear2);
    const toks = attackingTokens(s);
    expect(toks.length).toBe(1);
    expect(getChars(s, toks[0]!).name).toBe('Test Bear');
    expect(s.objects[toks[0]!]!.tapped).toBe(true);
  });
  it('an attacking Octopus: TWO token copies instead, both tapped and attacking', () => {
    const s0 = setup();
    const lord = find(s0, 'Test Abyss Lord', 'battlefield', 'p1');
    const octo = find(s0, 'Test Reef Octopus', 'battlefield', 'p1');
    const s = attackMany(s0, [{ attacker: lord, defender: 'p2' }, { attacker: octo, defender: 'p2' }], { targets: [[obj(octo)]] });
    const toks = attackingTokens(s);
    expect(toks.length).toBe(2);
    expect(toks.every((id) => getChars(s, id).name === 'Test Reef Octopus' && s.objects[id]!.tapped)).toBe(true);
  });
});
