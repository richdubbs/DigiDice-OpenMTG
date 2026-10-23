/**
 * T6 (FAST1 wave, family C): the one-shot effect templates of parser/templates/zz-fast1/t6.json played through applyAction with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks. The templates are experimental, so the
 * cards are `partial` (design 6.9): their automated steps still run, which is what these tests check.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, passBoth, scenario } from '../../m3/scenario';

function spell(name: string, text: string, type = 'Sorcery'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [] } as OracleCard);
}
const zone = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): ObjectId[] => s.zones[z][p]!;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');

/** Cast a p1 spell with the given targets and pay automatically; the spell is on the stack. */
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

/** The automated steps of a card are not manual nodes (the templates' JSON runs, design 6.6). */
function automatedSteps(d: CardDef): boolean {
  return !JSON.stringify(d.faces).includes('"op":"manual"') && d.automation.level !== 'manual';
}

describe('CR 701.21a: "sacrifices a creature of their choice"', () => {
  const EDICT = spell('Test Grim Decree', 'Target player sacrifices a creature of their choice.');
  it('CR 701.21a: the targeted player chooses which of their creatures to sacrifice', () => {
    expect(automatedSteps(EDICT)).toBe(true);
    const s0 = scenario(['Grizzly Bears', 'Llanowar Elves'], { p1: { hand: ['Test Grim Decree'], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, defs: [EDICT] });
    let s = passBoth(cast(s0, 'Test Grim Decree', [{ kind: 'player', id: 'p2' }]));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    const elves = find(s, 'Llanowar Elves', 'battlefield', 'p2');
    s = answer(s, { kind: 'chooseObjects', ids: [elves] });
    expect(findAll(s, 'Llanowar Elves', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toHaveLength(2);
  });
});

describe('CR 111.1, 110.5b: "create a tapped ... token"', () => {
  const MUSTER = spell('Test Sleepy Muster', 'Create two tapped 1/1 white Soldier creature tokens.');
  it('CR 110.5b: the tokens enter the battlefield tapped', () => {
    expect(automatedSteps(MUSTER)).toBe(true);
    const s = passBoth(cast(scenario([], { p1: { hand: ['Test Sleepy Muster'] }, defs: [MUSTER] }), 'Test Sleepy Muster'));
    const made = tokens(s);
    expect(made).toHaveLength(2);
    for (const id of made) expect(s.objects[id]!.tapped).toBe(true);
  });
});

describe('CR 701.26a: "you may tap or untap target creature"', () => {
  const TOGGLE = spell('Test Toggle', 'You may tap or untap target creature.', 'Instant');
  const setup = (tapped: boolean): { s: GameState; bears: ObjectId } => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Toggle'] }, p2: { battlefield: [{ name: 'Grizzly Bears', tapped }] }, defs: [TOGGLE] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    return { s: passBoth(cast(s0, 'Test Toggle', [{ kind: 'object', id: bears }])), bears };
  };
  it('CR 701.26a: "yes" to tapping taps it', () => {
    expect(automatedSteps(TOGGLE)).toBe(true);
    const { s: s1, bears } = setup(false);
    expect(s1.pending?.kind).toBe('yesNo');
    const s = answer(s1, { kind: 'yesNo', yes: true });
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(s.pending?.kind).toBe('priority');
  });
  it('CR 701.26a, 608.2d: a tapped creature can\'t be tapped, so the only question is untapping; "yes" untaps it', () => {
    const { s: s1, bears } = setup(true);
    expect(s1.pending?.kind).toBe('yesNo');
    const s = answer(s1, { kind: 'yesNo', yes: true });
    expect(s.objects[bears]!.tapped).toBe(false);
    expect(s.pending?.kind).toBe('priority');
  });
  it('CR 608.2d: declining leaves it as it was', () => {
    const { s: s1, bears } = setup(true);
    const s = answer(s1, { kind: 'yesNo', yes: false });
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(s.pending?.kind).toBe('priority');
  });
  it('CR 608.2d: an untapped creature, "no" to tapping: untapping it changes nothing either way', () => {
    const { s: s1, bears } = setup(false);
    let s = answer(s1, { kind: 'yesNo', yes: false });
    while (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.objects[bears]!.tapped).toBe(false);
    expect(s.pending?.kind).toBe('priority');
  });
});

describe('CR 121.1, 119.3: "target player draws two cards and loses 2 life"', () => {
  const PACT = spell('Test Grim Study', 'Target player draws two cards and loses 2 life.');
  it('CR 121.1, 119.3: the same player draws and loses life', () => {
    expect(automatedSteps(PACT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Grim Study'] }, defs: [PACT] });
    const s1 = cast(s0, 'Test Grim Study', [{ kind: 'player', id: 'p2' }]);
    const before = zone(s1, 'hand', 'p2').length;
    const s = passBoth(s1);
    expect(zone(s, 'hand', 'p2').length).toBe(before + 2);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 701.9a, 121.1: draw-and-discard and wheel shapes', () => {
  const LOOT = spell('Test Tide Sift', 'Target player draws three cards, then discards two cards.');
  const WHEEL = spell('Test Fresh Hands', 'Each player discards their hand, then draws three cards.');
  const WINDS = spell('Test Hand Swap', 'Discard all the cards in your hand, then draw that many cards.');
  it('CR 701.9a: the targeted player draws, then discards', () => {
    expect(automatedSteps(LOOT)).toBe(true);
    const s1 = cast(scenario([], { p1: { hand: ['Test Tide Sift'] }, defs: [LOOT] }), 'Test Tide Sift', [{ kind: 'player', id: 'p2' }]);
    const before = zone(s1, 'hand', 'p2').length;
    let s = passBoth(s1);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    s = answer(s, { kind: 'chooseObjects', ids: zone(s, 'hand', 'p2').slice(0, 2) });
    expect(zone(s, 'hand', 'p2').length).toBe(before + 1);
    expect(zone(s, 'graveyard', 'p2').length).toBe(2);
  });
  it('CR 701.9a, 121.1: each player discards their own hand, then draws three', () => {
    expect(automatedSteps(WHEEL)).toBe(true);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Fresh Hands', 'Grizzly Bears'] }, p2: { hand: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [WHEEL] });
    const s = passBoth(cast(s0, 'Test Fresh Hands'));
    expect(zone(s, 'hand', 'p1').length).toBe(3);
    expect(zone(s, 'hand', 'p2').length).toBe(3);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p2')).toHaveLength(2);
  });
  it('CR 608.2c, 608.2h: "draw that many cards" draws as many as were discarded', () => {
    expect(automatedSteps(WINDS)).toBe(true);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Hand Swap', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, defs: [WINDS] });
    const s = passBoth(cast(s0, 'Test Hand Swap'));
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p1')).toHaveLength(3);
    expect(zone(s, 'hand', 'p1').length).toBe(3);
  });
});

describe('CR 406.1, 404.1: exiling graveyards', () => {
  const ONE = spell('Test Ash Sweep', "Exile target player's graveyard.");
  const ALL = spell('Test Grand Ash Sweep', 'Exile all graveyards.');
  it("CR 406.1: \"exile target player's graveyard\" exiles that graveyard only", () => {
    expect(automatedSteps(ONE)).toBe(true);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Ash Sweep'], graveyard: ['Grizzly Bears'] }, p2: { graveyard: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [ONE] });
    const s = passBoth(cast(s0, 'Test Ash Sweep', [{ kind: 'player', id: 'p2' }]));
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Grizzly Bears', 'exile', 'p2')).toHaveLength(2);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('CR 406.1: "exile all graveyards" exiles every graveyard', () => {
    expect(automatedSteps(ALL)).toBe(true);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Grand Ash Sweep'], graveyard: ['Grizzly Bears'] }, p2: { graveyard: ['Grizzly Bears'] }, defs: [ALL] });
    const s = passBoth(cast(s0, 'Test Grand Ash Sweep'));
    expect(findAll(s, 'Grizzly Bears', 'graveyard')).toHaveLength(0);
    expect(findAll(s, 'Grizzly Bears', 'exile')).toHaveLength(2);
  });
});

describe('CR 701.24a, 400.3: "target player shuffles their graveyard into their library"', () => {
  const RENEW = spell('Test Fresh Start', 'Target player shuffles their graveyard into their library.');
  it('CR 400.3: the cards go into their owner\'s library, which is then shuffled; the other graveyard stays', () => {
    expect(automatedSteps(RENEW)).toBe(true);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Fresh Start'], graveyard: ['Grizzly Bears'] }, p2: { graveyard: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [RENEW] });
    const libBefore = zone(s0, 'library', 'p2').length;
    const s = passBoth(cast(s0, 'Test Fresh Start', [{ kind: 'player', id: 'p2' }]));
    expect(zone(s, 'graveyard', 'p2')).toHaveLength(0);
    expect(zone(s, 'library', 'p2').length).toBe(libBefore + 2);
    expect(findAll(s, 'Grizzly Bears', 'library', 'p2')).toHaveLength(2);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 608.2d, 400.7: "return a creature you control to its owner\'s hand" (a choice, not a target)', () => {
  const RECALL = spell('Test Quiet Recall', "Return a creature you control to its owner's hand.", 'Instant');
  it('CR 608.2d: the controller chooses one of their own creatures on resolution; other creatures stay', () => {
    expect(automatedSteps(RECALL)).toBe(true);
    const s0 = scenario(['Grizzly Bears', 'Llanowar Elves'], { p1: { hand: ['Test Quiet Recall'], battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [RECALL] });
    let s = passBoth(cast(s0, 'Test Quiet Recall'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    const pending = s.pending as { options: ObjectId[] };
    expect(pending.options).toHaveLength(2);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Llanowar Elves', 'battlefield', 'p1')] });
    expect(findAll(s, 'Llanowar Elves', 'hand', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toHaveLength(2);
  });
});

describe('CR 121.1, 401.4: "draw three cards, then put two cards from your hand on top of your library in any order"', () => {
  const STORM = spell('Test Think Twice Over', 'Draw three cards, then put two cards from your hand on top of your library in any order.', 'Instant');
  it('CR 401.4: the two chosen cards end on top of the library', () => {
    expect(automatedSteps(STORM)).toBe(true);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Think Twice Over', 'Grizzly Bears'] }, defs: [STORM] });
    const s1 = passBoth(cast(s0, 'Test Think Twice Over'));
    expect(s1.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 2, max: 2 });
    const bears = find(s1, 'Grizzly Bears', 'hand', 'p1');
    const other = zone(s1, 'hand', 'p1').find((id) => id !== bears)!;
    let s = answer(s1, { kind: 'chooseObjects', ids: [bears, other] });
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    expect(s.pending?.kind).toBe('priority');
    expect(zone(s, 'hand', 'p1').length).toBe(2);
    // index 0 is the top (types/state.ts); a card that changes zones is a new object (CR 400.7), so the top two are read by name
    const top2 = zone(s, 'library', 'p1').slice(0, 2).map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(top2).toContain('Grizzly Bears');
    expect(findAll(s, 'Grizzly Bears', 'hand', 'p1')).toHaveLength(0);
  });
});
