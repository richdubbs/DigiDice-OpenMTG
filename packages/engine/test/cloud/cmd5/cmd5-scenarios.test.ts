/**
 * Cloud commander batch, slice cmd5: the shapes of parser/templates/zz-cloud/cmd5.json played through the engine with synthetic cards compiled by the game's default
 * compiler (wordings are invented, design 6.10).
 *
 *   CR 701.21a, 109.4    "sacrifice another permanent": the controller chooses one of their permanents other than the source; with none, nothing happens
 *   CR 107.3, 608.2h     "you draw X cards and you lose X life, where X is ..." / "you gain X life and draw X cards, where X is ...": one X for both instructions,
 *                        determined once as the effect is applied (a draw that changes the count does not change the life lost)
 *   CR 608.2h            "where X is the number of counters on that creature" after the creature was destroyed: its last known information
 *   CR 506.1, 604.1      "Players can't cast spells during combat" / "Each opponent can't cast spells during combat": every step of the combat phase, only there
 *   CR 601.2c, 601.2f    "Spells you cast that target ~ cost {2} less to cast": only a spell whose chosen targets include it
 *   CR 111.1, 111.2      "Create a Treasure token and a 1/1 green Squirrel creature token": both tokens
 *   CR 122.1, 107.14     "Whenever you gain life, you get that many {E}": the amount of the event; "{T}, Pay six {E}: Draw two cards" removes six
 *   CR 608.2c, 608.2d    "If it was a creature card, put a +1/+1 counter on ~ and you gain 1 life": the condition governs both instructions (parser/chart.ts#leadInIfCutShort);
 *                        "Sacrifice another artifact. If you can't, tap ~ and you lose 3 life": "can't" after a sacrifice of the player's choice
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, life, pass, reject, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability understood (no manual node); an experimental template caps the card at partial (design 6.9), so `full` is asked of the stable ones only. */
const understood = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Cast the named spell from p1's hand at the given targets and let it (and what it triggers) resolve. */
function castAt(s0: GameState, name: string, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 6; guard++) s = settle(pass(pass(s)), [], answers);
  return s;
}
const options = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? [...s.pending.options] : []);
const handSize = (s: GameState): number => s.zones.hand.p1!.length;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);

describe('CR 701.21a, 109.4: "When this creature enters, sacrifice another permanent."', () => {
  const WYRM = card('Test Hungry Wyrm', 'Creature — Dragon', 'When this creature enters, sacrifice another permanent.', ['6', '6']);
  it('is automated', () => expect(full(WYRM)).toBe(true));
  it('the controller chooses among their other permanents (never the Wyrm, never an opponent\'s); the chosen one is sacrificed', () => {
    const s0 = scenario([], { defs: [WYRM, BEAR, ELF], p1: { hand: ['Test Hungry Wyrm'], battlefield: ['Test Bear', 'Test Elf'] }, p2: { battlefield: ['Test Bear'] } });
    let s = castAt(s0, 'Test Hungry Wyrm');
    const wyrm = find(s, 'Test Hungry Wyrm', 'battlefield', 'p1');
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(options(s).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Elf']);
    expect(options(s)).not.toContain(wyrm);
    expect(options(s).every((id) => s.objects[id]!.controller === 'p1')).toBe(true);
    s = answer(s, { kind: 'chooseObjects', ids: [options(s).find((id) => s.objects[id]!.defId === 'Test Elf')!] });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Elf']);
    expect(battlefieldNames(s, 'p1').sort()).toEqual(['Test Bear', 'Test Hungry Wyrm']);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Bear']);
  });
  it('with no other permanent nothing is sacrificed (the Wyrm itself is not "another permanent")', () => {
    const s0 = scenario([], { defs: [WYRM], p1: { hand: ['Test Hungry Wyrm'] } });
    const s = castAt(s0, 'Test Hungry Wyrm');
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Hungry Wyrm']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
  });
});

describe('CR 107.3, 608.2h: one X for the draw and the loss or gain of life', () => {
  const SEER = card('Test Elf Seer', 'Creature — Elf', 'When this creature enters, you draw X cards and you lose X life, where X is the number of Elves you control.', ['1', '1']);
  const RALLY = card('Test Rally', 'Sorcery', 'You gain X life and draw X cards, where X is the number of creatures you control.');
  it.each([['Test Elf Seer', SEER], ['Test Rally', RALLY]] as const)('%s is automated', (_n, d) => expect(full(d)).toBe(true));
  it('two Elves and the Seer itself: X is 3, the player draws three cards and loses 3 life', () => {
    const s0 = scenario([], { defs: [SEER, ELF], p1: { hand: ['Test Elf Seer'], battlefield: ['Test Elf', 'Test Elf'] } });
    const before = handSize(s0) - 1;
    const s = castAt(s0, 'Test Elf Seer');
    expect(handSize(s)).toBe(before + 3);
    expect(life(s, 'p1')).toBe(17);
  });
  it('three creatures: the player gains 3 life and draws three cards', () => {
    const s0 = scenario([], { defs: [RALLY, BEAR, ELF], p1: { hand: ['Test Rally'], battlefield: ['Test Bear', 'Test Elf', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const before = handSize(s0) - 1;
    const s = castAt(s0, 'Test Rally');
    expect(life(s, 'p1')).toBe(23);
    expect(handSize(s)).toBe(before + 3);
  });
  it('CR 608.2h: X is determined once: "where X is the number of cards in your hand" with the draw first, the life lost is the X counted before the draw', () => {
    const STUDY = card('Test Deep Study', 'Sorcery', 'You draw X cards and you lose X life, where X is the number of cards in your hand.');
    expect(full(STUDY)).toBe(true);
    const s0 = scenario([], { defs: [STUDY, BEAR], p1: { hand: ['Test Deep Study', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    const s = castAt(s0, 'Test Deep Study'); // three cards in hand as it resolves: draw three (six in hand), lose 3, not 6
    expect(handSize(s)).toBe(6);
    expect(life(s, 'p1')).toBe(17);
  });
  it('CR 608.2h: the same for "you gain X life and draw X cards": X fixed before either instruction', () => {
    const SIP = card('Test Long Sip', 'Sorcery', 'You gain X life and draw X cards, where X is the number of cards in your hand.');
    expect(full(SIP)).toBe(true);
    const s0 = scenario([], { defs: [SIP, BEAR], p1: { hand: ['Test Long Sip', 'Test Bear', 'Test Bear'] } });
    const s = castAt(s0, 'Test Long Sip');
    expect(life(s, 'p1')).toBe(22);
    expect(handSize(s)).toBe(4);
  });
  it('CR 608.2h: "the number of counters on that creature" after it is destroyed is read from its last known information', () => {
    const PARTING = card('Test Last Words', 'Instant', 'Destroy target creature. You draw X cards and you lose X life, where X is the number of counters on that creature.');
    expect(full(PARTING)).toBe(true);
    const s0 = scenario([], { defs: [PARTING, BEAR], p1: { hand: ['Test Last Words'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2 } }] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const before = handSize(s0) - 1;
    const s = castAt(s0, 'Test Last Words', [obj(bear)]);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
    expect(handSize(s)).toBe(before + 2);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 506.1, 604.1: "can\'t cast spells during combat"', () => {
  const SERAPH = card('Test Calm Seraph', 'Creature — Angel', "Players can't cast spells during combat.", ['4', '4']);
  const WARDEN = card('Test Strict Warden', 'Creature — Human', "Each opponent can't cast spells during combat.", ['2', '2']);
  const SHOCK = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  it.each([['Test Calm Seraph', SERAPH], ['Test Strict Warden', WARDEN]] as const)('%s is understood (experimental template: partial)', (_n, d) => expect(understood(d)).toBe(true));
  it('players: an instant can be cast in the main phase, not in the beginning of combat step (either player)', () => {
    const s0 = scenario([], { defs: [SERAPH, SHOCK], p1: { hand: ['Test Zap'], battlefield: ['Test Calm Seraph'] }, p2: { hand: ['Test Zap'] } });
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') })).not.toThrow();
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(reject(combat, { type: 'cast', player: 'p1', card: find(combat, 'Test Zap', 'hand', 'p1') }).message).toBeTruthy();
  });
  it('each opponent: the controller may still cast an instant during combat; the opponent may not', () => {
    const s0 = scenario([], { defs: [WARDEN, SHOCK], p1: { hand: ['Test Zap'], battlefield: ['Test Strict Warden'] }, p2: { hand: ['Test Zap'] } });
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(() => act(combat, { type: 'cast', player: 'p1', card: find(combat, 'Test Zap', 'hand', 'p1') })).not.toThrow();
    const theirs = pass(combat); // p2 has priority in the same step
    expect(theirs.turn.step).toBe('beginCombat');
    expect(reject(theirs, { type: 'cast', player: 'p2', card: find(theirs, 'Test Zap', 'hand', 'p2') }).message).toBeTruthy();
  });
});

describe('CR 601.2c, 601.2f: "Spells you cast that target this creature cost {2} less to cast."', () => {
  const SCION = card('Test Kind Scion', 'Creature — Elemental', 'Spells you cast that target this creature cost {2} less to cast.', ['3', '3']);
  const GROWTH = card('Test Big Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.', undefined, '{2}{G}');
  it('is understood (experimental template: partial)', () => expect(understood(SCION)).toBe(true));
  it('with one Forest: the spell that targets the Scion costs {G}; the same spell at another creature can\'t be paid', () => {
    const s0 = scenario(['Forest'], { defs: [SCION, GROWTH, BEAR], p1: { hand: ['Test Big Growth'], battlefield: ['Test Kind Scion', 'Forest', 'Test Bear'] } });
    const scion = find(s0, 'Test Kind Scion', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Big Growth', [obj(scion)]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Big Growth']);
    expect(s.objects[find(s, 'Forest', 'battlefield', 'p1')]!.tapped).toBe(true);
    // at the Bear the total cost stays {2}{G} (CR 601.2f): the payment asks for it and one Forest can't pay it automatically
    const at = answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Big Growth', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(bear)] });
    expect(at.pending).toMatchObject({ kind: 'payCost', costText: '{2}{G}', autoPayable: false });
    expect(() => answer(at, { kind: 'payCost', auto: true })).toThrow(/not possible/);
  });
});

describe('CR 111.1, 111.2: "Create a Treasure token and a 1/1 green Squirrel creature token."', () => {
  const STASH = card('Test Odd Stash', 'Sorcery', 'Create a Treasure token and a 1/1 green Squirrel creature token.');
  it('is automated', () => expect(full(STASH)).toBe(true));
  it('both tokens are created', () => {
    const s0 = scenario([], { defs: [STASH], p1: { hand: ['Test Odd Stash'] } });
    const s = castAt(s0, 'Test Odd Stash');
    const names = battlefieldNames(s, 'p1');
    expect(names.filter((n) => n.startsWith('token:Treasure'))).toHaveLength(1);
    expect(names.filter((n) => n.includes('Squirrel'))).toHaveLength(1);
    expect(names).toHaveLength(2);
  });
});

describe('CR 608.2c, 608.2d: "If <condition>, A and B" makes both conditional (parser/chart.ts#leadInIfCutShort)', () => {
  const OOZE = card('Test Grave Slime', 'Creature — Ooze', '{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.', ['2', '2']);
  const RUSTY = card('Test Rusty Golem', 'Artifact Creature — Golem', "At the beginning of your upkeep, sacrifice another artifact. If you can't, tap this creature and you lose 3 life.", ['4', '4']);
  const ROCK = card('Test Pebble', 'Artifact', '');
  it.each([['Test Grave Slime', OOZE], ['Test Rusty Golem', RUSTY]] as const)('%s is automated', (_n, d) => expect(full(d)).toBe(true));
  const slime = (yard: string): GameState => scenario(['Forest'], { defs: [OOZE, BEAR, ROCK], p1: { battlefield: ['Test Grave Slime', 'Forest'] }, p2: { graveyard: [yard] } });
  const activate = (s0: GameState): GameState => {
    const target = s0.zones.graveyard.p2![0]!;
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Grave Slime', 'battlefield', 'p1'), ability: 'p:0:0' }), [obj(target)]);
    for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 4; guard++) s = settle(pass(pass(s)));
    return s;
  };
  it('a creature card: exiled, then BOTH the +1/+1 counter and 1 life', () => {
    const s = activate(slime('Test Bear'));
    const ooze = find(s, 'Test Grave Slime', 'battlefield', 'p1');
    expect(s.objects[ooze]!.counters['+1/+1']).toBe(1);
    expect(life(s, 'p1')).toBe(21);
  });
  it('a noncreature card: exiled, and NEITHER the counter nor the life (the life gain is not outside the condition)', () => {
    const s = activate(slime('Test Pebble'));
    const ooze = find(s, 'Test Grave Slime', 'battlefield', 'p1');
    expect(s.objects[ooze]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(life(s, 'p1')).toBe(20);
  });
  const upkeep = (battlefield: string[]): GameState => {
    const s0 = scenario([], { defs: [RUSTY, ROCK], p1: { battlefield } });
    let s = advanceTo(s0, 3, 'upkeep'); // p1's next turn (turn 2 is p2's)
    for (let guard = 0; s.zones.stack.length > 0 && guard < 4; guard++) s = settle(pass(pass(s)));
    return s;
  };
  it('another artifact to sacrifice: it is sacrificed; the Golem stays untapped and no life is lost', () => {
    const s = upkeep(['Test Rusty Golem', 'Test Pebble']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Pebble']);
    expect(s.objects[find(s, 'Test Rusty Golem', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(life(s, 'p1')).toBe(20);
  });
  it('no other artifact: the Golem (never "another artifact" itself) is tapped AND the player loses 3 life', () => {
    const s = upkeep(['Test Rusty Golem']);
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Rusty Golem']);
    expect(s.objects[find(s, 'Test Rusty Golem', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(17);
  });
});

describe('CR 122.1, 107.14: energy', () => {
  const SPRITE = card('Test Glow Sprite', 'Creature — Faerie', 'Whenever you gain life, you get that many {E}.\n{T}, Pay six {E}: Draw two cards.', ['1', '1']);
  const BALM = card('Test Balm', 'Instant', 'You gain 4 life.');
  const energy = (s: GameState): number => ((s.players[0]! as unknown as { counters?: Record<string, number> }).counters?.['energy'] ?? 0);
  it('is automated', () => expect(full(SPRITE)).toBe(true));
  it('gaining 4 life gives 4 {E}; the six-energy ability can\'t be activated with 4 and can with 6 (six counters removed, two cards drawn)', () => {
    const s0 = scenario([], { defs: [SPRITE, BALM], p1: { hand: ['Test Balm', 'Test Balm'], battlefield: ['Test Glow Sprite'] } });
    const sprite = find(s0, 'Test Glow Sprite', 'battlefield', 'p1');
    let s = castAt(s0, 'Test Balm');
    expect(life(s, 'p1')).toBe(24);
    expect(energy(s)).toBe(4);
    expect(() => act(s, { type: 'activate', player: 'p1', source: sprite, ability: 'p:0:1' })).toThrow();
    s = castAt(s, 'Test Balm');
    expect(energy(s)).toBe(8);
    const before = handSize(s);
    s = settle(act(s, { type: 'activate', player: 'p1', source: sprite, ability: 'p:0:1' }));
    for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 4; guard++) s = settle(pass(pass(s)));
    expect(energy(s)).toBe(2);
    expect(handSize(s)).toBe(before + 2);
  });
});
