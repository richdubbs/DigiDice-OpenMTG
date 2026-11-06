/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-4: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 605.1a, 605.3b, 122.1, 701.21   a mana ability beside its mana: each opponent gains life (Grove of the Burnwillows); the source is sacrificed when it has no
 *                                      counters of the kind left (Gemstone Mine, the depletion lands)
 *   CR 120.3, 603.2, 701.21a          "Whenever a source deals damage to this creature, that source's controller sacrifices that many permanents of their choice." (Phyrexian
 *                                      Obliterator): any source (here a spell), its controller (not the Obliterator's), one permanent per damage dealt
 *   CR 106.6, 108.3                    "Spend this mana only to cast spells you don't own." (Thieving Varmint): a spell owned by another player, never one of your own
 *   CR 609.4b, 107.4c                  "You may spend mana as though it were mana of any color." / "Each player may spend ..." (Chromatic Orrery): for every cost,
 *                                      colored symbols only ({C} still needs colorless mana), only for the players the static names
 *   CR 106.6, 611.2a, 400.7a           "If that mana is spent on a creature spell, it gains haste." (Hall of the Bandit Lord): no duration, so the keyword stays with the permanent
 *                                      past the end of the turn; a creature paid for with other mana gets nothing
 *   CR 607.2a, 605.3b                  "{T}: Add {C}. If a card is exiled with this land, add {C}{C} instead." (Ugin's Labyrinth): the linked exile of the land's own enters ability, counted
 *                                      when the mana is added; a land with nothing exiled adds one
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { legalActions } from '../../../src/index';
import type { ManaRestriction } from '../../../src/types/ability';
import { spendAllows } from '../../../src/rules/sources';
import { controllerOf, getChars, hasKeyword } from '../../../src/rules/characteristics';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { act, advanceTo, answer, find, life, pass, passBoth, pool, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [] } as OracleCard);
}

const MINE = card('Test Mine', 'Land', '{T}, Remove a mining counter from this land: Add one mana of any color. If there are no mining counters on this land, sacrifice it.');
const GROVE = card('Test Grove', 'Land', '{T}: Add {C}.\n{T}: Add {R} or {G}. Each opponent gains 1 life.');
const DEFS = [MINE, GROVE];

const inPlay = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
const inYard = (s: GameState, name: string): boolean => (s.zones.graveyard['p1'] ?? []).some((id) => s.defs[s.objects[id]!.defId]!.name === name);

/** Activate the nth mana ability of a permanent of p1 (the order the card prints them), answering a color choice with `color`. */
function tap(s0: GameState, name: string, nth: number, color?: string): GameState {
  const source = find(s0, name, 'battlefield');
  const offers = legalActions(s0, 'p1').filter((l) => l.kind === 'activate' && l.isMana === true && l.object === source);
  const a = offers[nth];
  if (!a) throw new Error(`mana ability ${nth} of ${name} not offered (${offers.length} offered)`);
  let s = act(s0, a.action);
  for (let guard = 0; guard < 5 && s.pending && s.pending.kind === 'chooseColor'; guard++) s = answer(s, { kind: 'chooseColor', color: color as never });
  return s;
}

describe('CR 605.3b, 122.1, 701.21: "If there are no mining counters on this land, sacrifice it." after the mana', () => {
  it('with two counters the land makes its mana and stays, one counter left', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Mine', counters: { mining: 2 } }] }, defs: DEFS });
    const t = tap(s, 'Test Mine', 0, 'G');
    expect(pool(t, 'p1')).toBe('G');
    expect(inPlay(t, 'Test Mine')).toBe(true);
    expect(t.objects[find(t, 'Test Mine', 'battlefield')]!.counters['mining']).toBe(1);
  });
  it('removing the last counter makes the mana and then sacrifices the land', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Mine', counters: { mining: 1 } }] }, defs: DEFS });
    const t = tap(s, 'Test Mine', 0, 'G');
    expect(pool(t, 'p1')).toBe('G');
    expect(inPlay(t, 'Test Mine')).toBe(false);
    expect(inYard(t, 'Test Mine')).toBe(true);
  });
});

describe('CR 605.3b, 119.3: "Add {R} or {G}. Each opponent gains 1 life."', () => {
  it('the mana is added and the opponent (not the controller) gains 1 life', () => {
    const s = scenario([], { p1: { battlefield: ['Test Grove'] }, defs: DEFS });
    const t = tap(s, 'Test Grove', 1, 'R');
    expect(pool(t, 'p1')).toBe('R');
    expect(life(t, 'p2')).toBe(21);
    expect(life(t, 'p1')).toBe(20);
  });
  it('negative: the plain {C} ability gains the opponent nothing', () => {
    const s = scenario([], { p1: { battlefield: ['Test Grove'] }, defs: DEFS });
    const t = tap(s, 'Test Grove', 0);
    expect(pool(t, 'p1')).toBe('C');
    expect(life(t, 'p2')).toBe(20);
  });
});


describe('CR 120.3, 603.2, 701.21a: "Whenever a source deals damage to this creature, that source\'s controller sacrifices that many permanents of their choice."', () => {
  const OBLIT = card('Test Obliterator', 'Creature — Horror', "Whenever a source deals damage to this creature, that source's controller sacrifices that many permanents of their choice.");
  const BEAR = card('Test Bear', 'Creature — Bear', '');
  const BURN = card('Test Burn', 'Instant', 'Test Burn deals 3 damage to target creature.');
  const PEBBLE = card('Test Pebble', 'Artifact', '');
  const D = [OBLIT, BEAR, BURN, PEBBLE];
  const withPt = (d: CardDef, p: string, t: string): CardDef => ({ ...d, faces: d.faces.map((f) => ({ ...f, power: p, toughness: t })) }) as CardDef;
  const DEFS2 = [withPt(OBLIT, '5', '5'), withPt(BEAR, '2', '2'), BURN, PEBBLE];
  const targetOf = (s: GameState, name: string) => ({ kind: 'object' as const, id: find(s, name, 'battlefield') });
  const burnAt = (name: string, p1Pebbles: number): GameState => {
    const s0 = scenario([], { defs: DEFS2, p1: { hand: ['Test Burn'], battlefield: Array(p1Pebbles).fill('Test Pebble') }, p2: { battlefield: ['Test Obliterator', 'Test Bear', 'Test Pebble'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [targetOf(s0, name)] });
    for (let guard = 0; guard < 6 && s.pending && s.pending.kind === 'payCost'; guard++) s = answer(s, { kind: 'payCost', auto: true });
    for (let guard = 0; guard < 12 && s.zones.stack.length > 0; guard++) {
      s = passBoth(s);
      for (let g = 0; g < 8 && s.pending && s.pending.kind === 'chooseObjects'; g++) s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) });
    }
    return s;
  };
  const count = (s: GameState, owner: string, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === owner && s.defs[s.objects[id]!.defId]!.name === name).length;

  it('the synthetic cards are automated', () => {
    for (const d of D) expect(d.automation.level, d.name).toBe('full');
  });
  it('a burn spell of p1 deals 3 to the Obliterator of p2: p1 (the spell\'s controller) sacrifices 3 permanents, p2 sacrifices none', () => {
    const t = burnAt('Test Obliterator', 5);
    expect(count(t, 'p1', 'Test Pebble')).toBe(2);
    expect(count(t, 'p2', 'Test Pebble')).toBe(1);
    expect(count(t, 'p2', 'Test Obliterator')).toBe(1);
  });
  it('with fewer permanents than the damage it sacrifices what it has', () => {
    const t = burnAt('Test Obliterator', 2);
    expect(count(t, 'p1', 'Test Pebble')).toBe(0);
  });
  it('negative: damage dealt to another creature does not trigger it', () => {
    const t = burnAt('Test Bear', 5);
    expect(count(t, 'p1', 'Test Pebble')).toBe(5);
  });
});

describe("CR 106.6, 108.3: \"Spend this mana only to cast spells you don't own.\"", () => {
  const VARMINT = card('Test Varmint', 'Artifact', "{T}: Add two mana of any one color. Spend this mana only to cast spells you don't own.");
  const TRINKET = card('Test Trinket', 'Instant', 'Draw a card.', { cost: '{1}' });
  const restrictionOf = (): ManaRestriction => {
    const ab = VARMINT.faces[0]!.abilities.find((a) => a.kind === 'activated') as unknown as { effect: { steps: { restriction?: ManaRestriction }[] } };
    return ab.effect.steps[0]!.restriction!;
  };
  it('the synthetic card is automated', () => {
    expect(VARMINT.automation.level).toBe('full');
    expect(restrictionOf()).toEqual({ spells: { not: { owner: 'you' } } });
  });
  it('the mana pays for a spell p2 owns, not for a spell p1 owns', () => {
    const s = scenario([], { defs: [VARMINT, TRINKET], p1: { battlefield: ['Test Varmint'], hand: ['Test Trinket'] } });
    const mine = find(s, 'Test Trinket', 'hand', 'p1');
    const theirs = put(s, 'p2', 'hand', 'Test Trinket');
    const source = find(s, 'Test Varmint', 'battlefield', 'p1');
    expect(spendAllows(s, 'p1', { kind: 'spell', id: theirs })(restrictionOf(), source)).toBe(true);
    expect(spendAllows(s, 'p1', { kind: 'spell', id: mine })(restrictionOf(), source)).toBe(false);
    expect(spendAllows(s, 'p1', { kind: 'ability', id: source })(restrictionOf(), source)).toBe(false);
  });
  it("negative: with only that mana available, p1 can't cast a spell p1 owns", () => {
    const s = scenario([], { defs: [VARMINT, TRINKET], p1: { battlefield: ['Test Varmint'], hand: ['Test Trinket'] } });
    expect(legalActions(s, 'p1').some((l) => l.kind === 'cast' && l.object === find(s, 'Test Trinket', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 609.4b, 107.4c: "You may spend mana as though it were mana of any color." / "Players may spend mana as though it were mana of any color."', () => {
  const PRISM = card('Test Prism', 'Artifact', 'You may spend mana as though it were mana of any color.');
  const COMMON = card('Test Commons', 'Artifact', 'Each player may spend mana as though it were mana of any color.');
  const RED2 = card('Test Ember', 'Instant', 'Draw a card.', { cost: '{R}{R}' });
  const VOID = card('Test Void', 'Sorcery', 'Draw a card.', { cost: '{C}' });
  const WELL = card('Test Well', 'Artifact', '{R}, {T}: Draw a card.');
  const D3 = [PRISM, COMMON, RED2, VOID, WELL];
  const castable = (s: GameState, player: 'p1' | 'p2', name: string): boolean => legalActions(s, player).some((l) => l.kind === 'cast' && l.object === find(s, name, 'hand', player));
  const activatable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.isMana !== true && l.object === find(s, name, 'battlefield', 'p1'));
  it('the synthetic cards are automated', () => {
    for (const d of [PRISM, COMMON]) expect(d.automation.level, d.name).toBe('full');
  });
  it('with the Prism, two Plains pay {R}{R}; without it they do not', () => {
    const base = { hand: ['Test Ember'], battlefield: ['Plains', 'Plains'] };
    expect(castable(scenario(['Plains'], { defs: D3, p1: { ...base, battlefield: [...base.battlefield, 'Test Prism'] } }), 'p1', 'Test Ember')).toBe(true);
    expect(castable(scenario(['Plains'], { defs: D3, p1: base }), 'p1', 'Test Ember')).toBe(false);
  });
  it('the permission covers an activation cost too: {R}, {T} is paid with a Plains', () => {
    const base = { battlefield: ['Plains', 'Test Well'] };
    expect(activatable(scenario(['Plains'], { defs: D3, p1: { ...base, battlefield: [...base.battlefield, 'Test Prism'] } }), 'Test Well')).toBe(true);
    expect(activatable(scenario(['Plains'], { defs: D3, p1: base }), 'Test Well')).toBe(false);
  });
  it('negative: colored mana still cannot pay a {C} cost', () => {
    const s = scenario(['Plains'], { defs: D3, p1: { hand: ['Test Void'], battlefield: ['Plains', 'Test Prism'] } });
    expect(castable(s, 'p1', 'Test Void')).toBe(false);
  });
  it("negative: the Prism's controller alone has it: p2's Plains still cannot pay {R}{R}", () => {
    const s = scenario(['Plains'], { defs: D3, p1: { battlefield: ['Test Prism'] }, p2: { hand: ['Test Ember'], battlefield: ['Plains', 'Plains'] } });
    const t = act(s, { type: 'pass', player: 'p1' }); // p2 gets priority in p1's main phase
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(castable(t, 'p2', 'Test Ember')).toBe(false);
  });
  it('"Each player may" gives it to the opponent too', () => {
    const s = scenario(['Plains'], { defs: D3, p1: { battlefield: ['Test Commons'] }, p2: { hand: ['Test Ember'], battlefield: ['Plains', 'Plains'] } });
    const t = act(s, { type: 'pass', player: 'p1' });
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(castable(t, 'p2', 'Test Ember')).toBe(true);
  });
});

describe('CR 106.6, 611.2a: "If that mana is spent on a creature spell, it gains haste." has no duration', () => {
  const HALL = card('Test Hall', 'Land', '{T}: Add {C}. If that mana is spent on a creature spell, it gains haste.');
  const STONE = card('Test Stone', 'Artifact', '{T}: Add {C}.');
  const CUB = card('Test Cub', 'Creature — Bear', '', { cost: '{1}' });
  const D4 = [HALL, STONE, CUB].map((d) => (d.name === 'Test Cub' ? ({ ...d, faces: d.faces.map((f) => ({ ...f, power: '1', toughness: '1' })) } as CardDef) : d));
  const cast = (s0: GameState, name: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
      s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    }
    return s;
  };
  const tapFirst = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, name, 'battlefield', 'p1'));
    return act(s, a!.action);
  };
  it('the synthetic land is automated, the rider says it stays', () => {
    expect(D4[0]!.automation.level).toBe('full');
    expect(JSON.stringify(D4[0]!.faces[0]!.abilities)).toContain('"gains":{"kind":"keyword","keyword":"haste","text":"haste"},"permanent":true');
  });
  it('a creature paid for with that mana has haste, and still has it on p1\'s next turn', () => {
    let s = scenario([], { defs: D4, p1: { hand: ['Test Cub'], battlefield: ['Test Hall'] } });
    s = cast(tapFirst(s, 'Test Hall'), 'Test Cub');
    const cub = find(s, 'Test Cub', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, cub)!, 'haste')).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(hasKeyword(getChars(s, find(s, 'Test Cub', 'battlefield', 'p1'))!, 'haste')).toBe(true);
  });
  it('negative: the same creature paid for with mana from another source does not have haste', () => {
    let s = scenario([], { defs: D4, p1: { hand: ['Test Cub'], battlefield: ['Test Stone', 'Test Hall'] } });
    s = cast(tapFirst(s, 'Test Stone'), 'Test Cub');
    expect(hasKeyword(getChars(s, find(s, 'Test Cub', 'battlefield', 'p1'))!, 'haste')).toBe(false);
  });
});

describe('CR 607.2a, 605.3b: "{T}: Add {C}. If a card is exiled with this land, add {C}{C} instead."', () => {
  const VAULT = card('Test Vault', 'Land', 'Imprint — When this land enters, you may exile a card from your hand.\n{T}: Add {C}. If a card is exiled with this land, add {C}{C} instead.\n{T}: Return the exiled card to its owner\'s hand.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const D5 = [VAULT, TRINKET];
  const settle1 = (s: GameState, yes: boolean): GameState => {
    const d = s.pending as unknown as { kind: string; options?: string[]; min?: number };
    if (d.kind === 'yesNo') return answer(s, { kind: 'yesNo', yes });
    if (d.kind === 'chooseObjects') return answer(s, { kind: 'chooseObjects', ids: (d.options ?? []).slice(0, Math.max(d.min ?? 0, 1)) });
    throw new Error(`unexpected decision ${d.kind}`);
  };
  /** Answer the decisions that come up (yes, or no, to a "you may"; the first card offered), then let the stack resolve. */
  const settle = (s0: GameState, yes: boolean): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && ((s.pending && s.pending.kind !== 'priority') || s.zones.stack.length > 0); guard++) {
      s = s.pending && s.pending.kind !== 'priority' ? settle1(s, yes) : passBoth(s);
    }
    return s;
  };
  const play = (yes: boolean): GameState => {
    const s0 = scenario([], { defs: D5, p1: { hand: ['Test Vault', 'Test Trinket'] } });
    return settle(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Vault', 'hand', 'p1') }), yes);
  };
  const manaOf = (s0: GameState, nth: number): GameState => {
    const offers = legalActions(s0, 'p1').filter((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s0, 'Test Vault', 'battlefield', 'p1'));
    return act(s0, offers[nth]!.action);
  };
  it('the synthetic land is automated', () => {
    expect(VAULT.automation.level).toBe('full');
  });
  it('with a card exiled with it the land adds {C}{C}', () => {
    const s = play(true);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Trinket')).toBe(true);
    expect(pool(manaOf(s, 0), 'p1')).toBe('CC');
  });
  it('negative: when nothing was exiled it adds {C}', () => {
    const s = play(false);
    expect(s.zones.exile.length).toBe(0);
    expect(pool(manaOf(s, 0), 'p1')).toBe('C');
  });
});

describe("CR 120.3, 603.10a, 109.4: the Obliterator's trigger uses the last known controller of a source that died in the same combat damage", () => {
  const OBLIT = card('Test Obliterator', 'Creature — Horror', "Trample\nWhenever a source deals damage to this creature, that source's controller sacrifices that many permanents of their choice.");
  const BEAR = card('Test Bear', 'Creature — Bear', '');
  const PEBBLE = card('Test Pebble', 'Artifact', '');
  const withPt = (d: CardDef, p: string, t: string): CardDef => ({ ...d, faces: d.faces.map((f) => ({ ...f, power: p, toughness: t })) }) as CardDef;
  const DEFS3 = [withPt(OBLIT, '5', '5'), withPt(BEAR, '2', '2'), PEBBLE];
  it("p1's Bear attacks into p2's Obliterator, is blocked and dies: p1 (the Bear's controller) sacrifices 2 permanents, p2 none", () => {
    const s0 = scenario([], { defs: DEFS3, p1: { battlefield: ['Test Bear', 'Test Pebble', 'Test Pebble', 'Test Pebble'] }, p2: { battlefield: ['Test Obliterator', 'Test Pebble'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = toDeclareBlockers(declareAttackers(toDeclareAttackers(advanceTo(s0, 3, 'main1')), [[bear]]));
    let s = declareBlockers(s1, [[find(s1, 'Test Obliterator', 'battlefield', 'p2'), bear]]);
    for (let guard = 0; guard < 40 && !(s.turn.step === 'endCombat' && s.pending?.kind === 'priority'); guard++) {
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, Math.max(s.pending.min, 1)) });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${s.pending?.kind}`);
    }
    const left = (owner: string, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === owner && s.defs[s.objects[id]!.defId]!.name === name).length;
    expect(left('p1', 'Test Bear')).toBe(0);
    expect(left('p1', 'Test Pebble') + left('p1', 'Test Bear')).toBe(1);
    expect(left('p2', 'Test Pebble')).toBe(1);
    expect(left('p2', 'Test Obliterator')).toBe(1);
  });
});

describe('CR 120.3, 603.10a, 613.2: "Whenever a source deals damage to this creature, that source\'s controller gains control of this creature." keeps the player it resolved with', () => {
  const SAURIAN = card('Test Saurian', 'Creature — Lizard', "Whenever a source deals damage to this creature, that source's controller gains control of this creature.");
  const BURN = card('Test Burn', 'Instant', 'Test Burn deals 2 damage to target creature.');
  const withPt = (d: CardDef, p: string, t: string): CardDef => ({ ...d, faces: d.faces.map((f) => ({ ...f, power: p, toughness: t })) }) as CardDef;
  const DEFS4 = [withPt(SAURIAN, '3', '4'), BURN];
  it("p1's burn spell damages p2's Saurian: p1 gains control of it, and keeps it on later turns", () => {
    const s0 = scenario([], { defs: DEFS4, p1: { hand: ['Test Burn'] }, p2: { battlefield: ['Test Saurian'] } });
    const saurian = find(s0, 'Test Saurian', 'battlefield', 'p2');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: saurian }] });
    for (let guard = 0; guard < 6 && s.pending && s.pending.kind === 'payCost'; guard++) s = answer(s, { kind: 'payCost', auto: true });
    for (let guard = 0; guard < 12 && s.zones.stack.length > 0; guard++) s = passBoth(s);
    expect(controllerOf(s, saurian)).toBe('p1');
    s = advanceTo(s, 3, 'main1');
    expect(controllerOf(s, saurian)).toBe('p1');
  });
  it('negative: damage dealt to another creature does not change who controls the Saurian', () => {
    const bear = withPt(card('Test Cub', 'Creature — Bear', ''), '2', '4');
    const s0 = scenario([], { defs: [...DEFS4, bear], p1: { hand: ['Test Burn'] }, p2: { battlefield: ['Test Saurian', 'Test Cub'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, 'Test Cub', 'battlefield', 'p2') }] });
    for (let guard = 0; guard < 6 && s.pending && s.pending.kind === 'payCost'; guard++) s = answer(s, { kind: 'payCost', auto: true });
    for (let guard = 0; guard < 12 && s.zones.stack.length > 0; guard++) s = passBoth(s);
    expect(controllerOf(s, find(s, 'Test Saurian', 'battlefield', 'p2'))).toBe('p2');
  });
});
