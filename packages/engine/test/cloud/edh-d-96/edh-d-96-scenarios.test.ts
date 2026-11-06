/**
 * Commander coordinator D, round edh-d-96 (MUST-FINISH, EDHREC band 5,001-10,000, group graveyard-exile-cast part 1): the round's cards played through the engine with synthetic
 * cards (invented names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1, Bob (p2) the other. Each test is named after the rule it
 * checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { card, cast, drive, full, obj, resolveAll, scenario } from '../r3-cost/support';
import { act, advanceTo, answer, find, passBoth, put } from '../../m3/scenario';

/** Cast from hand and stop at the first target choice (the trigger's, after the spell's own payment); null when no target choice comes. */
function castToTargets(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'chooseTargets' && s.pending.kind !== 'priority'; i++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const offered = (s: GameState): string[] => (s.pending?.kind === 'chooseTargets' ? JSON.stringify(s.pending).match(/"o\d+"/g) ?? [] : []);

const names = (s: GameState, ids: readonly string[]) => ids.map((id) => s.objects[id]!.defId).sort();
/** Test set-up: one more card (a definition of the scenario) in Alice's hand. */
function scenarioAdd(s0: GameState, name: string): GameState {
  const s = structuredClone(s0);
  put(s, 'p1', 'hand', name);
  return s;
}

describe('Gale, Waterdeep Prodigy: "Whenever you cast an instant or sorcery spell from your hand, you may cast up to one target card of the other type from your graveyard. If a spell cast from your graveyard this way would be put into your graveyard, exile it instead." (CR 304.1, 307.1, 603.3d, 608.2g, 614.1a)', () => {
  const GALE = card('Test Prodigy', 'Legendary Creature — Human Wizard', 'Whenever you cast an instant or sorcery spell from your hand, you may cast up to one target card of the other type from your graveyard. If a spell cast from your graveyard this way would be put into your graveyard, exile it instead.', '{0}', ['1', '3']);
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const ZAP2 = card('Test Spark', 'Instant', 'You gain 2 life.');
  const PLAN = card('Test Plan', 'Sorcery', 'You gain 3 life.');
  const PLAN2 = card('Test Scheme', 'Sorcery', 'You gain 4 life.');
  const defs = [GALE, ZAP, ZAP2, PLAN, PLAN2];
  const start = (hand: string[], graveyard: string[]) => scenario([], { p1: { hand, graveyard, battlefield: ['Test Prodigy'] }, defs } as never);
  const lifeOf = (s: GameState) => s.players.find((p) => p.id === 'p1')!.life;
  it('has no manual part', () => expect(full(GALE)).toBe(true));
  it('casting an INSTANT from hand lets you target only a SORCERY card in your graveyard (the other type); the spell cast resolves and is exiled instead of going to your graveyard', () => {
    let s = start(['Test Zap'], ['Test Spark', 'Test Plan']);
    s = castToTargets(s, 'Test Zap');
    // the trigger is announced: its target choice offers the sorcery card only
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(offered(s)).toContain(`"${find(s, 'Test Plan', 'graveyard', 'p1')}"`);
    expect(offered(s)).not.toContain(`"${find(s, 'Test Spark', 'graveyard', 'p1')}"`);
    s = drive(s, { targets: [[obj(find(s, 'Test Plan', 'graveyard', 'p1'))]] });
    s = resolveAll(s, { yes: [true, true, true] });
    expect(lifeOf(s)).toBe(20 + 3 + 1);
    expect(names(s, s.zones.exile)).toEqual(['Test Plan']); // CR 614.1a: exiled instead of put into the graveyard
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Spark', 'Test Zap']); // the spell from hand goes to the graveyard as usual
  });
  it('casting a SORCERY from hand lets you cast an INSTANT card from your graveyard, not a sorcery one', () => {
    let s = start(['Test Plan'], ['Test Zap', 'Test Scheme']);
    s = castToTargets(s, 'Test Plan');
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(offered(s)).toContain(`"${find(s, 'Test Zap', 'graveyard', 'p1')}"`);
    expect(offered(s)).not.toContain(`"${find(s, 'Test Scheme', 'graveyard', 'p1')}"`);
    s = drive(s, { targets: [[obj(find(s, 'Test Zap', 'graveyard', 'p1'))]] });
    s = resolveAll(s, { yes: [true, true, true] });
    expect(lifeOf(s)).toBe(20 + 1 + 3);
    expect(names(s, s.zones.exile)).toEqual(['Test Zap']);
  });
  it('the negative cases: "up to one" (no target: nothing is cast), "you may" declined (the card stays in the graveyard), and with only a card of the same type no target is legal', () => {
    let s = start(['Test Zap'], ['Test Plan']);
    s = cast(s, 'Test Zap', { targets: [[]] });
    s = resolveAll(s, { yes: [false] });
    expect(lifeOf(s)).toBe(21);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Plan', 'Test Zap']);
    let t = start(['Test Zap'], ['Test Plan']);
    t = cast(t, 'Test Zap', { targets: [[obj(find(t, 'Test Plan', 'graveyard', 'p1'))]] });
    t = resolveAll(t, { yes: [false] });
    expect(lifeOf(t)).toBe(21);
    expect(names(t, t.zones.graveyard.p1!)).toEqual(['Test Plan', 'Test Zap']);
    let u = start(['Test Zap'], ['Test Spark']);
    u = castToTargets(u, 'Test Zap');
    expect(offered(u)).not.toContain(`"${find(u, 'Test Spark', 'graveyard', 'p1')}"`);
    u = resolveAll(drive(u, { targets: [[]] }), { yes: [true] });
    expect(lifeOf(u)).toBe(21);
    expect(names(u, u.zones.graveyard.p1!)).toEqual(['Test Spark', 'Test Zap']);
  });
  it('CR 608.2b, 113.7a: the spell that caused the trigger is countered before the trigger resolves: "the other type" is read from that spell as it last existed, so the target stays legal and is cast', () => {
    const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.');
    let s = scenario([], { p1: { hand: ['Test Zap'], graveyard: ['Test Plan'], battlefield: ['Test Prodigy'] }, p2: { hand: ['Test Negate'] }, defs: [...defs, NEGATE] } as never);
    s = cast(s, 'Test Zap', { targets: [[obj(find(s, 'Test Plan', 'graveyard', 'p1'))]] });
    s = act(s, { type: 'pass', player: 'p1' });
    const zap = s.zones.stack.find((id) => s.objects[id]!.defId === 'Test Zap')!;
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Negate', 'hand', 'p2') }), { targets: [[obj(zap)]] });
    s = drive(passBoth(s), {}); // Test Negate resolves: Test Zap is countered
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).not.toContain('Test Zap');
    s = resolveAll(s, { yes: [true, true] });
    expect(lifeOf(s)).toBe(23);
    expect(names(s, s.zones.exile)).toEqual(['Test Plan']);
  });
  it('the negative case: a spell cast from somewhere other than your hand (from the graveyard by Gale itself) does not trigger it again (CR 603.2)', () => {
    let s = start(['Test Zap'], ['Test Plan', 'Test Spark']);
    s = cast(s, 'Test Zap', { targets: [[obj(find(s, 'Test Plan', 'graveyard', 'p1'))]] });
    s = drive(passBoth(s), { yes: [true] }); // the trigger resolves: Test Plan is cast from the graveyard
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Zap', 'Test Plan']);
    s = resolveAll(s, { yes: [true] });
    expect(lifeOf(s)).toBe(24);
  });
});

describe('Enhanced Surveillance: "You may look at an additional two cards each time you surveil." (CR 701.25a, 609.3; rulings 2018-10-05)', () => {
  const EYE = card('Test Watchtower', 'Enchantment', 'You may look at an additional two cards each time you surveil.\nExile ~: Shuffle your graveyard into your library.');
  const PEEK = card('Test Peek', 'Sorcery', 'Surveil 1.');
  const defs = [EYE, PEEK];
  /** Cast Test Peek and answer the surveil: `yes` for each offer of additional cards; returns the number of cards offered to the graveyard choice and the state after binning all of them. */
  const run = (mine: number, theirs: number, yes: boolean[]): { looked: number; s: GameState } => {
    let s = scenario([], { p1: { hand: ['Test Peek'], battlefield: Array(mine).fill('Test Watchtower') }, p2: { battlefield: Array(theirs).fill('Test Watchtower') }, defs } as never);
    s = cast(s, 'Test Peek');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    const q = [...yes];
    let looked = -1;
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      const p = s.pending;
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.shift() ?? false });
      else if (p.kind === 'chooseObjects') { looked = p.options.length; s = answer(s, { kind: 'chooseObjects', ids: [...p.options] }); }
      else s = drive(s, {});
    }
    expect(q).toEqual([]); // every offer was asked
    return { looked, s };
  };
  it('has no manual part', () => expect(full(EYE)).toBe(true));
  it('with one, surveil 1 may look at three cards; all three may be put into the graveyard (the additional cards are part of what is surveiled)', () => {
    const { looked, s } = run(1, 0, [true]);
    expect(looked).toBe(3);
    expect(s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Plains').length).toBe(3);
  });
  it('with two, each adds its own two cards: surveil 1 looks at five (ruling: "an additional four cards")', () => {
    expect(run(2, 0, [true, true]).looked).toBe(5);
    expect(run(2, 0, [true, false]).looked).toBe(3);
  });
  it('the negative cases: "may" declined looks at one card only; an OPPONENT\'s Enhanced Surveillance does nothing for you (no offer)', () => {
    expect(run(1, 0, [false]).looked).toBe(1);
    expect(run(0, 1, []).looked).toBe(1);
  });
});

describe('Epic Experiment: "Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren\'t cast into your graveyard." (CR 107.3, 608.2g, 601.2, 118.9; rulings 2021-03-19)', () => {
  const EPIC = card('Test Experiment', 'Sorcery', "Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.", '{X}');
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.', '{1}');
  const PLAN = card('Test Plan', 'Sorcery', 'You gain 3 life.', '{3}');
  const BIG = card('Test Big Plan', 'Sorcery', 'You gain 4 life.', '{4}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [EPIC, ZAP, PLAN, BIG, BEAR];
  const lifeOf = (s: GameState) => s.players.find((p) => p.id === 'p1')!.life;
  const start = (library: string[]) => scenario([], { p1: { hand: ['Test Experiment'], library, battlefield: ['Plains', 'Plains', 'Plains'] }, defs } as never);
  it('has no manual part', () => expect(full(EPIC)).toBe(true));
  it('X = 3: only the instant and sorcery cards with mana value 3 or less are offered; they are cast free (one at a time, the last cast resolves first); the rest of the exiled cards (a 4-mana sorcery, a creature) go to the graveyard', () => {
    let s = start(['Test Zap', 'Test Big Plan', 'Test Plan', 'Test Bear']);
    s = cast(s, 'Test Experiment', { x: [3] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as { options: string[] };
    expect(names(s, p.options)).toEqual(['Test Plan', 'Test Zap']);
    s = answer(s, { kind: 'chooseObjects', ids: [...p.options] });
    s = drive(s, {});
    expect(names(s, s.zones.stack)).toEqual(['Test Plan', 'Test Zap']); // both cast during the resolution, now on the stack
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Big Plan', 'Test Experiment']); // the uncast exiled card went to the graveyard; the fourth card was never exiled
    expect(s.zones.exile).toEqual([]);
    s = resolveAll(s);
    expect(lifeOf(s)).toBe(24);
    expect(s.zones.library.p1!.map((id) => s.objects[id]!.defId)[0]).toBe('Test Bear');
  });
  it('the negative case: casting none of them puts every exiled card into the graveyard', () => {
    let s = start(['Test Zap', 'Test Plan']);
    s = cast(s, 'Test Experiment', { x: [2] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = drive(s, {});
    expect(lifeOf(s)).toBe(20);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Experiment', 'Test Plan', 'Test Zap']);
    expect(s.zones.exile).toEqual([]);
  });
});

describe('Colfenor\'s Urn: "Whenever a creature with toughness 4 or greater is put into your graveyard from the battlefield, you may exile it. At the beginning of the end step, if three or more cards have been exiled with this artifact, sacrifice it. If you do, return those cards to the battlefield under their owner\'s control." (CR 607.2a, 603.4, 701.21a; rulings 2007-10-01)', () => {
  const URN = card('Test Urn', 'Artifact', "Whenever a creature with toughness 4 or greater is put into your graveyard from the battlefield, you may exile it.\nAt the beginning of the end step, if three or more cards have been exiled with ~, sacrifice it. If you do, return those cards to the battlefield under their owner's control.");
  const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['0', '4']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '5']);
  const ELK = card('Test Elk', 'Creature — Elk', '', '{0}', ['4', '4']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const defs = [URN, WALL, OX, ELK, BEAR, WRATH];
  const onBf = (s: GameState, name: string) => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name).length;
  /** Wrath the board, answering "exile it?" with `yes` for each trigger; then go to the end step and resolve its trigger. */
  const play = (creatures: string[], yes: boolean[]) => {
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Urn', ...creatures] }, defs } as never);
    s = cast(s, 'Test Wrath');
    s = resolveAll(s, { yes });
    return s;
  };
  it('has no manual part, and its exile is linked to it (CR 607.2a)', () => {
    expect(full(URN)).toBe(true);
    expect(JSON.stringify(URN.faces[0]!.abilities[0])).toContain('"link":"exiled"');
  });
  it('three creatures with toughness 4 or greater exiled: at the end step the Urn is sacrificed and all three return to the battlefield; a creature with toughness less than 4 is not offered', () => {
    let s = play(['Test Wall', 'Test Ox', 'Test Elk', 'Test Bear'], [true, true, true]);
    expect(names(s, s.zones.exile)).toEqual(['Test Elk', 'Test Ox', 'Test Wall']);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Bear', 'Test Wrath']);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s, {});
    expect(onBf(s, 'Test Urn')).toBe(0);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Bear', 'Test Urn', 'Test Wrath']);
    for (const n of ['Test Wall', 'Test Ox', 'Test Elk']) expect(onBf(s, n)).toBe(1);
    expect(s.zones.exile).toEqual([]);
  });
  it('the negative cases: with two cards exiled with it, the end step trigger does nothing (the intervening "if", CR 603.4); "you may" declined exiles nothing', () => {
    const none = play(['Test Wall'], [false]);
    expect(none.zones.exile.length).toBe(0);
    let s = play(['Test Wall', 'Test Ox', 'Test Bear'], [true]);
    expect(s.zones.exile.length).toBe(2);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s, {});
    expect(onBf(s, 'Test Urn')).toBe(1);
    expect(s.zones.exile.length).toBe(2);
  });
  it('ruling 2007-10-01: the count is over the whole game: a card exiled with it that has left exile still counts, but only the cards still in exile return', () => {
    let s = play(['Test Wall', 'Test Ox', 'Test Elk'], [true, true, true]);
    // another effect puts one exiled card into its owner's graveyard (test set-up: the card leaves exile)
    const gone = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Elk')!;
    s = { ...s, zones: { ...s.zones, exile: s.zones.exile.filter((id) => id !== gone), graveyard: { ...s.zones.graveyard, p1: [...s.zones.graveyard.p1!, gone] } }, objects: { ...s.objects, [gone]: { ...s.objects[gone]!, zone: 'graveyard' } } };
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s, {});
    expect(onBf(s, 'Test Urn')).toBe(0);
    expect(onBf(s, 'Test Wall') + onBf(s, 'Test Ox')).toBe(2);
    expect(onBf(s, 'Test Elk')).toBe(0);
  });
});

describe('Endless Detour: "The owner of target spell, nonland permanent, or card in a graveyard puts it on their choice of the top or bottom of their library." (CR 115.1, 400.1, 401.4, 608.2b; rulings 2024-04-12)', () => {
  const DETOUR = card('Test Detour', 'Instant', 'The owner of target spell, nonland permanent, or card in a graveyard puts it on their choice of the top or bottom of their library.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [DETOUR, BEAR, ZAP];
  const lib = (s: GameState, p: 'p1' | 'p2') => s.zones.library[p]!.map((id) => s.objects[id]!.defId);
  const castAt = (s0: GameState, target: string, choice: 'top' | 'bottom') => {
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Detour', 'hand', 'p1') }), { targets: [[obj(target)]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseOption');
    const who = s.pending!.player;
    const p = s.pending as { options: { id: string; label: string }[] };
    s = answer(s, { kind: 'chooseOption', ids: [p.options.find((o) => o.id === choice || o.label.toLowerCase().includes(choice))!.id] });
    return { s: drive(s, {}), who };
  };
  it('has no manual part', () => expect(full(DETOUR)).toBe(true));
  it('an opponent\'s nonland permanent: its OWNER (Bob) chooses, and it goes on the top of HIS library', () => {
    const s0 = scenario([], { p1: { hand: ['Test Detour'] }, p2: { battlefield: ['Test Bear'] }, defs } as never);
    const { s, who } = castAt(s0, find(s0, 'Test Bear', 'battlefield', 'p2'), 'top');
    expect(who).toBe('p2');
    expect(lib(s, 'p2')[0]).toBe('Test Bear');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
  });
  it('a card in a graveyard (any graveyard) goes to the bottom of its owner\'s library when they choose bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Detour'] }, p2: { graveyard: ['Test Zap'] }, defs } as never);
    const { s } = castAt(s0, find(s0, 'Test Zap', 'graveyard', 'p2'), 'bottom');
    const l = lib(s, 'p2');
    expect(l[l.length - 1]).toBe('Test Zap');
    expect(s.zones.graveyard.p2!.length).toBe(0);
  });
  it('a spell on the stack is put into its owner\'s library (not countered: it never resolves; ruling 2024-04-12)', () => {
    let s = scenario([], { p1: { hand: ['Test Detour'] }, p2: { hand: ['Test Zap'] }, defs } as never);
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Zap', 'hand', 'p2') }), {});
    const zap = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p2' });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Detour', 'hand', 'p1') }), { targets: [[obj(zap)]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    s = answer(s, { kind: 'chooseOption', ids: [(s.pending as { options: { id: string }[] }).options[0]!.id] });
    s = resolveAll(drive(s, {}));
    expect(s.zones.stack).toEqual([]);
    expect(lib(s, 'p2')).toContain('Test Zap');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
  });
  it('the negative case: a land on the battlefield is not a legal target (nonland permanent), but a land CARD in a graveyard is', () => {
    const s0 = scenario([], { p1: { hand: ['Test Detour'], battlefield: ['Plains'], graveyard: ['Plains'] }, defs } as never);
    const s = castToTargets(s0, 'Test Detour');
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(offered(s)).not.toContain(`"${find(s, 'Plains', 'battlefield', 'p1')}"`);
    expect(offered(s)).toContain(`"${find(s, 'Plains', 'graveyard', 'p1')}"`);
  });
});

describe('Intellect Devourer: "When this creature enters, each opponent exiles a card from their hand until this creature leaves the battlefield." / "You may play lands and cast spells from among cards exiled with this creature. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it." (CR 610.3, 610.3c, 607.2a, 305.1, 609.4b; rulings 2022-06-10)', () => {
  const DEVOURER = card('Test Devourer', 'Creature — Horror', "When ~ enters, each opponent exiles a card from their hand until ~ leaves the battlefield.\nYou may play lands and cast spells from among cards exiled with ~. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.", '{0}', ['2', '2']);
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', '{R}', undefined, ['R']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const defs = [DEVOURER, BOLT, DOOM];
  const enter = (bobHand: string[], pick: string) => {
    let s = scenario([], { p1: { hand: ['Test Devourer'], battlefield: ['Plains'] }, p2: { hand: bobHand }, defs } as never);
    s = cast(s, 'Test Devourer');
    s = resolveAll(s, { objects: [[find(s, pick, 'hand', 'p2')]] });
    return s;
  };
  it('has no manual part', () => expect(full(DEVOURER)).toBe(true));
  it('the opponent (Bob) chooses the card; Alice may cast it paying with mana of any color (a red spell with white mana); a card cast this way leaves exile for good (it does not return)', () => {
    let s = enter(['Test Bolt', 'Plains'], 'Test Bolt');
    expect(names(s, s.zones.exile)).toEqual(['Test Bolt']);
    const bolt = s.zones.exile[0]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: bolt }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Test Bolt']); // its owner's graveyard
  });
  it('a land exiled this way may be played by Alice (normal land timing, ruling 2022-06-10); Bob cannot play or cast from among them', () => {
    let s = enter(['Plains'], 'Plains');
    const land = s.zones.exile[0]!;
    expect(() => act(s, { type: 'playLand', player: 'p2', card: land })).toThrow();
    s = act(s, { type: 'playLand', player: 'p1', card: land });
    expect(s.objects[land] === undefined || s.objects[land]!.zone !== 'exile').toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1').length).toBe(2);
  });
  it('CR 610.3: when the Devourer leaves the battlefield, the card still exiled returns to its owner\'s HAND', () => {
    let s = enter(['Test Bolt'], 'Test Bolt');
    s = scenarioAdd(s, 'Test Doom');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(find(s, 'Test Devourer', 'battlefield', 'p1'))]] });
    s = resolveAll(s);
    expect(s.zones.exile).toEqual([]);
    expect(names(s, s.zones.hand.p2!)).toEqual(['Test Bolt']);
  });
  it('CR 610.3c (ruling 2022-06-10): if the Devourer has left the battlefield before its ability resolves, no card is exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Devourer', 'Test Doom'] }, p2: { hand: ['Test Bolt'] }, defs } as never);
    s = cast(s, 'Test Devourer');
    s = resolveAll(s); // fails to resolve? no: the creature spell resolves, its trigger goes on the stack
    // (the trigger has resolved by resolveAll; redo: hold priority with the trigger on the stack)
    let t = scenario([], { p1: { hand: ['Test Devourer', 'Test Doom'] }, p2: { hand: ['Test Bolt'] }, defs } as never);
    t = cast(t, 'Test Devourer');
    t = drive(passBoth(t), {}); // the creature resolves; its enters trigger is on the stack
    expect(t.zones.stack.length).toBe(1);
    t = drive(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(find(t, 'Test Devourer', 'battlefield', 'p1'))]] });
    t = resolveAll(t, { objects: [[find(t, 'Test Bolt', 'hand', 'p2')]] });
    expect(t.zones.exile).toEqual([]);
    expect(names(t, t.zones.hand.p2!)).toEqual(['Test Bolt']);
    expect(s.zones.exile.length).toBe(1); // (without the removal the card is exiled)
  });
});

describe('March of Reckless Joy: "Exile the top X cards of your library. You may play up to two of those cards until the end of your next turn." (CR 601.3, 305.1, 611.2a, 400.7; ruling 2022-02-18: the cards are chosen as they are played)', () => {
  const MARCH = card('Test March', 'Instant', 'Exile the top X cards of your library. You may play up to two of those cards until the end of your next turn.', '{X}');
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const PLAN = card('Test Plan', 'Sorcery', 'You gain 3 life.');
  const SPARK = card('Test Spark', 'Instant', 'You gain 2 life.');
  const defs = [MARCH, ZAP, PLAN, SPARK];
  const lifeOf = (s: GameState) => s.players.find((p) => p.id === 'p1')!.life;
  const start = () => {
    let s = scenario([], { p1: { hand: ['Test March'], library: ['Test Zap', 'Test Plan', 'Test Spark'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs } as never);
    s = cast(s, 'Test March', { x: [3] });
    return resolveAll(s);
  };
  const castFromExile = (s: GameState, name: string) => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === name)! }), {}));
  it('has no manual part', () => expect(full(MARCH)).toBe(true));
  it('any two of the exiled cards may be played (chosen as they are played); the third may not', () => {
    let s = start();
    expect(names(s, s.zones.exile)).toEqual(['Test Plan', 'Test Spark', 'Test Zap']);
    s = castFromExile(s, 'Test Zap');
    s = castFromExile(s, 'Test Plan');
    expect(lifeOf(s)).toBe(24);
    expect(() => act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Spark')! })).toThrow();
  });
  it('the limit is two in all over the whole duration, not two per turn: one played now and one in your next turn uses it up; it still allows the second card in your next turn', () => {
    let s = start();
    s = castFromExile(s, 'Test Zap');
    s = advanceTo(s, 3, 'main1');
    s = castFromExile(s, 'Test Plan');
    expect(lifeOf(s)).toBe(24);
    expect(() => act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Spark')! })).toThrow();
  });
  it('a land played this way spends the same limit (CR 305.1: playing a land is playing a card): a land and a spell use it up', () => {
    let s = scenario([], { p1: { hand: ['Test March'], library: ['Plains', 'Test Zap', 'Test Plan'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs } as never);
    s = resolveAll(cast(s, 'Test March', { x: [3] }));
    s = act(s, { type: 'playLand', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Plains')! });
    s = castFromExile(s, 'Test Zap');
    expect(() => act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Plan')! })).toThrow();
  });
  it('the negative case: after the end of your next turn no card exiled this way may be played', () => {
    let s = start();
    s = advanceTo(s, 5, 'main1');
    expect(() => act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Zap')! })).toThrow();
  });
});

describe('The Temporal Anchor: "Whenever you choose to put one or more cards on the bottom of your library while scrying, exile that many cards from the bottom of your library." / "During your turn, you may play cards exiled with The Temporal Anchor." (CR 701.22a, 603.2, 607.2a, 611.3a; ruling 2022-10-14)', () => {
  const ANCHOR = card('Test Anchor', 'Legendary Artifact', 'At the beginning of your upkeep, scry 2.\nWhenever you choose to put one or more cards on the bottom of your library while scrying, exile that many cards from the bottom of your library.\nDuring your turn, you may play cards exiled with ~.');
  const PEEK = card('Test Peek', 'Instant', 'Scry 2.');
  const LOOK = card('Test Look', 'Instant', 'Surveil 2.');
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const PLAN = card('Test Plan', 'Sorcery', 'You gain 3 life.');
  const defs = [ANCHOR, PEEK, LOOK, ZAP, PLAN];
  const lifeOf = (s: GameState) => s.players.find((p) => p.id === 'p1')!.life;
  /** Cast Test Peek and put `bottom` (names) on the bottom of the library. */
  const scry = (bottom: string[]) => {
    let s = scenario([], { p1: { hand: ['Test Peek'], library: ['Test Zap', 'Test Plan'], battlefield: ['Test Anchor'] }, defs } as never);
    s = cast(s, 'Test Peek');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const opts = (s.pending as { options: string[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: opts.filter((id) => bottom.includes(s.objects[id]!.defId)) });
    return resolveAll(drive(s, {}));
  };
  it('has no manual part', () => expect(full(ANCHOR)).toBe(true));
  it('two cards put on the bottom while scrying: that many cards are exiled from the bottom (those two), and they may be played during your turn', () => {
    let s = scry(['Test Zap', 'Test Plan']);
    expect(names(s, s.zones.exile)).toEqual(['Test Plan', 'Test Zap']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Plan')! }), {}));
    expect(lifeOf(s)).toBe(23);
  });
  it('one card on the bottom exiles one card (that many); the card kept on top stays', () => {
    const s = scry(['Test Plan']);
    expect(names(s, s.zones.exile)).toEqual(['Test Plan']);
    expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe('Test Zap');
  });
  it('the negative cases: no card put on the bottom does not trigger it; the exiled cards cannot be played during an opponent\'s turn', () => {
    const none = scry([]);
    expect(none.zones.exile).toEqual([]);
    let s = scry(['Test Zap', 'Test Plan']);
    s = advanceTo(s, 2, 'main1');
    expect(() => act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Zap')! })).toThrow();
  });
  it('the negative case: surveiling (putting cards into the graveyard) does not trigger it', () => {
    let s = scenario([], { p1: { hand: ['Test Look'], library: ['Test Zap', 'Test Plan'], battlefield: ['Test Anchor'] }, defs } as never);
    s = cast(s, 'Test Look');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    s = answer(s, { kind: 'chooseObjects', ids: [...(s.pending as { options: string[] }).options] });
    s = resolveAll(drive(s, {}));
    expect(s.zones.exile).toEqual([]);
  });
});

describe('Geth\'s Summons: "Return up to one target creature card from your graveyard to the battlefield. Corrupted — For each opponent who has three or more poison counters as you cast this spell, put up to one target creature card from that player\'s graveyard onto the battlefield under your control." (CR 115.1, 601.2c, 122.1f, 608.2b, 404.1)', () => {
  const SUMMONS = card('Test Summons', 'Sorcery', "Return up to one target creature card from your graveyard to the battlefield.\nCorrupted — For each opponent who has three or more poison counters as you cast ~, put up to one target creature card from that player's graveyard onto the battlefield under your control.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '5']);
  const defs = [SUMMONS, BEAR, OX];
  const withPoison = (s0: GameState, n: number): GameState => ({ ...s0, players: s0.players.map((p) => (p.id === 'p2' ? { ...p, poison: n } : p)) });
  const start = (poison: number) => withPoison(scenario([], { p1: { hand: ['Test Summons'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Ox'] }, defs } as never), poison);
  /** Cast and collect the object ids offered at each target choice, answering with all of them. */
  const castAll = (s0: GameState) => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Summons', 'hand', 'p1') });
    const offers: string[][] = [];
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseTargets') { const ids = (s.pending as { objects: string[] }).objects; offers.push([...ids]); s = answer(s, { kind: 'chooseTargets', targets: ids.map((id) => obj(id)) }); }
      else s = drive(s, {});
    }
    return { s, offers };
  };
  const mine = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => s.objects[id]!.defId).sort();
  it('has no manual part', () => expect(full(SUMMONS)).toBe(true));
  it('an opponent with three poison counters: a creature card from THEIR graveyard is also put onto the battlefield under YOUR control', () => {
    const { s, offers } = castAll(start(3));
    expect(offers.length).toBe(2);
    const r = resolveAll(s);
    expect(mine(r)).toEqual(['Test Bear', 'Test Ox']);
    expect(r.objects[r.zones.battlefield.find((id) => r.objects[id]!.defId === 'Test Ox')!]!.owner).toBe('p2');
  });
  it('the negative case: an opponent with two poison counters gets no target (their creature card is not offered); your own card still returns', () => {
    const { s, offers } = castAll(start(2));
    expect(offers.flat().map((id) => s.objects[id]!.defId)).not.toContain('Test Ox');
    const r = resolveAll(s);
    expect(mine(r)).toEqual(['Test Bear']);
    expect(names(r, r.zones.graveyard.p2!)).toEqual(['Test Ox']);
  });
  it('"as you cast this spell": the count is judged when the targets are chosen; losing poison counters before it resolves does not make the target illegal (CR 608.2b reads only the target\'s own words)', () => {
    const { s } = castAll(start(3));
    const r = resolveAll(withPoison(s, 0));
    expect(mine(r)).toEqual(['Test Bear', 'Test Ox']);
  });
});

describe('Illuna, Apex of Wishes: "Whenever this creature mutates, exile cards from the top of your library until you exile a nonland permanent card. Put that card onto the battlefield or into your hand." (CR 702.140a, 702.140d, 608.2d, 110.2; rulings 2020-04-17)', () => {
  const ILLUNA = card('Test Wishbeast', 'Legendary Creature — Beast Elemental Dinosaur', 'Mutate {0}\nFlying, trample\nWhenever ~ mutates, exile cards from the top of your library until you exile a nonland permanent card. Put that card onto the battlefield or into your hand.', '{0}', ['6', '6']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '5']);
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [ILLUNA, BEAR, OX, ZAP];
  /** Cast the Wishbeast mutating onto the Bear, then answer the place choice with `place` ("battlefield" or "hand"). */
  const mutate = (place: 'battlefield' | 'hand', library = ['Test Zap', 'Plains', 'Test Ox']) => {
    let s = scenario([], { p1: { hand: ['Test Wishbeast'], battlefield: ['Test Bear'], library }, defs } as never);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wishbeast', 'hand', 'p1'), method: 'mutate' });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [obj(bear)] }) : answer(s, { kind: 'payCost', auto: true });
    }
    let asked: string[] = [];
    for (let k = 0; k < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); k++) {
      if (s.pending?.kind === 'chooseOption') { asked = (s.pending as { options: { id: string }[] }).options.map((o) => o.id); s = answer(s, { kind: 'chooseOption', ids: [asked.find((x) => x.includes(place)) ?? asked[place === 'battlefield' ? 0 : 1]!] }); continue; }
      if (s.pending && s.pending.kind !== 'priority') { s = drive(s, {}); continue; }
      s = passBoth(s);
    }
    return { s, asked };
  };
  it('has no manual part', () => expect(full(ILLUNA)).toBe(true));
  it('mutating triggers it: the instant and land exiled first stay in exile; the first nonland permanent card is put onto the battlefield (your choice)', () => {
    const { s, asked } = mutate('battlefield');
    expect(asked.length).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ox' && s.objects[id]!.controller === 'p1')).toBe(true);
    expect(names(s, s.zones.exile)).toEqual(['Plains', 'Test Zap']); // ruling: land, instant and sorcery cards exiled this way remain in exile
  });
  it('or into your hand', () => {
    const { s } = mutate('hand');
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Ox']);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ox')).toBe(false);
  });
  it('the negative case: cast without mutating (a plain creature spell), it does not trigger', () => {
    let s = scenario([], { p1: { hand: ['Test Wishbeast'], library: ['Test Ox'] }, defs } as never);
    s = resolveAll(cast(s, 'Test Wishbeast'));
    expect(s.zones.exile).toEqual([]);
    expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe('Test Ox');
  });
});
