/**
 * Commander lane edh-next, round edh-next-48 (EDHREC ranks 7,501-8,750, third pass): the round's readings played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory and
 * unverified (cloud session, no rules/cr; the full text was fetched from media.wizards.com where marked).
 *
 *   CR 107.3, 202.1, 601.2i, 603.2   "Whenever you cast your first spell with {X} in its mana cost each turn, put X +1/+1 counters on ~." (Nev) and "..., you may copy it." (Owlin Spiralmancer)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { applyAction, getChars } from '../../../src/index';
import { act, answerUntilPriority, card as card2, commanderScenario, forests, legend, tweak } from '../../m11/rules/helpers';
import { advanceTo, find, pass, scenario } from '../../m3/scenario';
import { card, cast, full, obj, resolveAll } from '../r4-cost/support';
import { mpScenario } from '../../m12/rules/helpers';

const onBf = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (p === undefined || s.objects[id]!.controller === p));
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
void find;

// ---- Nev / Owlin Spiralmancer: the first spell with {X} in its mana cost each turn ---------------------------------------------------------------------------------------------
const NEV = card('Test Nev', 'Creature — Merfolk Wizard', 'Whenever you cast your first spell with {X} in its mana cost each turn, put X +1/+1 counters on ~.', '{0}', ['1', '1']);
const WAVE = card('Test Wave', 'Sorcery', 'You gain 1 life.', '{X}');
const WAVE2 = card('Test Surge', 'Sorcery', 'You gain 1 life.', '{X}');
const PLAIN = card('Test Plain Rite', 'Sorcery', 'You gain 1 life.', '{0}');
describe('CR 107.3, 601.2i, 603.2: "Whenever you cast your first spell with {X} in its mana cost each turn, put X +1/+1 counters on ~." (Nev)', () => {
  const DEFS = [NEV, WAVE, WAVE2, PLAIN];
  it('is automated', () => expect(full(NEV)).toBe(true));
  it('the first spell with {X} cast for X = 3 puts three +1/+1 counters on it, a spell without {X} cast before it not counting as the first', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nev', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Plain Rite', 'Test Wave'] } });
    s = resolveAll(cast(s, 'Test Plain Rite'));
    expect(power(s, onBf(s, 'Test Nev')[0]!)).toBe(1);
    s = resolveAll(cast(s, 'Test Wave', { x: [3] }));
    expect(power(s, onBf(s, 'Test Nev')[0]!)).toBe(4);
  });
  it('negative: the second spell with {X} of the turn adds nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nev', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Wave', 'Test Surge'] } });
    s = resolveAll(cast(s, 'Test Wave', { x: [2] }));
    expect(power(s, onBf(s, 'Test Nev')[0]!)).toBe(3);
    s = resolveAll(cast(s, 'Test Surge', { x: [5] }));
    expect(power(s, onBf(s, 'Test Nev')[0]!)).toBe(3);
  });
  it('negative: an opponent casting a spell with {X} adds nothing (and does not use up the first-of-the-turn)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nev'] }, p2: { hand: ['Test Wave'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Wave', { x: [4] }, 'p2'));
    expect(power(s, onBf(s, 'Test Nev')[0]!)).toBe(1);
  });
});

const SPIRAL = card('Test Spiralmancer', 'Creature — Bird Wizard', 'Whenever you cast your first spell with {X} in its mana cost each turn, you may copy it. You may choose new targets for the copy.', '{0}', ['1', '1']);
const GAIN = card('Test Gain', 'Sorcery', 'You gain X life.', '{X}');
const GAIN2 = card('Test Gain Two', 'Sorcery', 'You gain X life.', '{X}');
describe('CR 107.3, 707.10, 707.2, 603.2: "Whenever you cast your first spell with {X} in its mana cost each turn, you may copy it." (Owlin Spiralmancer)', () => {
  const DEFS = [SPIRAL, GAIN, GAIN2, PLAIN];
  const LANDS = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  const life = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;
  it('is automated', () => expect(full(SPIRAL)).toBe(true));
  it('the first spell with {X} cast for X = 2 is copied, the copy has the same X (two gains of 2), a spell without {X} before it not counting', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spiralmancer', ...LANDS], hand: ['Test Plain Rite', 'Test Gain'] } });
    s = resolveAll(cast(s, 'Test Plain Rite'));
    const before = life(s);
    s = resolveAll(cast(s, 'Test Gain', { x: [2], yes: [true] }), { yes: [true] });
    expect(life(s)).toBe(before + 4);
  });
  it('the copy is optional: answering no leaves the one gain of 2', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spiralmancer', ...LANDS], hand: ['Test Gain'] } });
    const before = life(s);
    s = resolveAll(cast(s, 'Test Gain', { x: [2], yes: [false] }), { yes: [false] });
    expect(life(s)).toBe(before + 2);
  });
  it('negative: the second spell with {X} of the turn is not copied', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spiralmancer', ...LANDS], hand: ['Test Gain', 'Test Gain Two'] } });
    s = resolveAll(cast(s, 'Test Gain', { x: [1], yes: [true] }), { yes: [true] });
    const before = life(s);
    s = resolveAll(cast(s, 'Test Gain Two', { x: [3], yes: [true] }), { yes: [true] });
    expect(life(s)).toBe(before + 3);
  });
});

// ---- Aether Spike / Galvanic Discharge: "you may pay any amount of {E}" ---------------------------------------------------------------------------------------------------
const energyOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters.energy ?? 0;
const SPIKE = card('Test Spike', 'Instant', 'Choose target spell. You get {E}{E}, then you may pay any amount of {E}. Counter that spell unless its controller pays {1} for each {E} paid this way.');
const SHOCK = card('Test Discharge', 'Instant', 'Choose target creature or planeswalker. You get {E}{E}{E}, then you may pay any amount of {E}. ~ deals that much damage to that permanent.');
const SIX = card('Test Six', 'Creature — Beast', '', '{0}', ['2', '2']);
const GRIZZLY = card('Test Grizzly', 'Creature — Bear', '', '{0}', ['2', '4']);
describe('CR 107.14, 118.12a, 608.2c: "Choose target spell. You get {E}{E}, then you may pay any amount of {E}. Counter that spell unless its controller pays {1} for each {E} paid this way." (Aether Spike)', () => {
  const DEFS = [SPIKE, SIX];
  it('is automated', () => expect(full(SPIKE)).toBe(true));
  /** p2 casts a creature spell; in response p1 casts the Spike on it, paying `n` energy; p2 then may pay (declines unless `pays`). */
  const run = (n: number, p2Lands: number, pays: boolean): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Spike'] }, p2: { hand: ['Test Six'], battlefield: Array.from({ length: p2Lands }, () => 'Plains') } });
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'Test Six', {}, 'p2');
    const six = s.zones.stack[s.zones.stack.length - 1]!;
    s = pass(s); // Bob passes priority, Alice may respond
    s = cast(s, 'Test Spike', { targets: [[{ kind: 'object', id: six }]], x: [n], yes: [pays] }, 'p1');
    return resolveAll(s, { x: [n], yes: [pays] });
  };
  it('paying 2 energy counters the spell when its controller cannot pay {2}; the 2 energy are spent', () => {
    const s = run(2, 0, false);
    expect(onBf(s, 'Test Six').length).toBe(0);
    expect(energyOf(s, 'p1')).toBe(0);
  });
  it('negative: its controller who can pay {1} for each energy and does keeps the spell', () => {
    const s = run(2, 2, true);
    expect(onBf(s, 'Test Six').length).toBe(1);
  });
  it('negative: paying no energy leaves a cost of {0}, which its controller chooses to pay (ruling 2024-06-07): the spell resolves, and the 2 energy stay', () => {
    const s = run(0, 0, true);
    expect(onBf(s, 'Test Six').length).toBe(1);
    expect(energyOf(s, 'p1')).toBe(2);
  });
  it('a controller who declines even the {0} payment has the spell countered (the choice is theirs)', () => {
    const s = run(0, 0, false);
    expect(onBf(s, 'Test Six').length).toBe(0);
  });
});

describe('CR 107.14, 118.12, 608.2c: "Choose target creature or planeswalker. You get {E}{E}{E}, then you may pay any amount of {E}. ~ deals that much damage to that permanent." (Galvanic Discharge)', () => {
  const DEFS = [SHOCK, GRIZZLY];
  it('is automated', () => expect(full(SHOCK)).toBe(true));
  const run = (n: number): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Discharge'] }, p2: { battlefield: ['Test Grizzly'] } });
    const bear = onBf(s, 'Test Grizzly')[0]!;
    s = cast(s, 'Test Discharge', { targets: [[{ kind: 'object', id: bear }]], x: [n] });
    return resolveAll(s, { x: [n] });
  };
  it('paying 3 energy deals 3 damage (the 2/4 survives), paying all of 4... 3 is the most there is; the energy is spent', () => {
    const s = run(3);
    expect(onBf(s, 'Test Grizzly').length).toBe(1);
    expect(s.objects[onBf(s, 'Test Grizzly')[0]!]!.damage).toBe(3);
    expect(energyOf(s, 'p1')).toBe(0);
  });
  it('negative: paying nothing deals no damage and keeps the 3 energy', () => {
    const s = run(0);
    expect(s.objects[onBf(s, 'Test Grizzly')[0]!]!.damage ?? 0).toBe(0);
    expect(energyOf(s, 'p1')).toBe(3);
  });
});

describe('CR 118.12a, 701.21a, 120.3: "~ deals 5 damage to target opponent unless that player sacrifices a creature of their choice." (Demanding Dragon)', () => {
  const DRAGON = card('Test Dragon', 'Creature — Dragon', 'When this creature enters, it deals 5 damage to target opponent unless that player sacrifices a creature of their choice.', '{0}', ['3', '3']);
  const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  it('an opponent with a creature may sacrifice it to avoid the 5 damage', () => {
    let s = scenario([], { defs: [DRAGON, SIX], p1: { hand: ['Test Dragon'] }, p2: { battlefield: ['Test Six'] } });
    const p2 = { kind: 'player', id: 'p2' } as const;
    s = resolveAll(cast(s, 'Test Dragon'), { targets: [[p2]], yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(onBf(s, 'Test Six').length).toBe(0);
  });
  it('negative: declining the sacrifice takes 5 damage and keeps the creature; with no creature the 5 damage is dealt', () => {
    let s = scenario([], { defs: [DRAGON, SIX], p1: { hand: ['Test Dragon'] }, p2: { battlefield: ['Test Six'] } });
    const p2 = { kind: 'player', id: 'p2' } as const;
    s = resolveAll(cast(s, 'Test Dragon'), { targets: [[p2]], yes: [false] });
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(onBf(s, 'Test Six').length).toBe(1);
    let t = scenario([], { defs: [DRAGON], p1: { hand: ['Test Dragon'] } });
    t = resolveAll(cast(t, 'Test Dragon'), { targets: [[p2]], yes: [true] });
    expect(lifeOf(t, 'p2')).toBe(15);
  });
});

// ---- Moldgraf Monstrosity: "return two creature cards at random from your graveyard to the battlefield" -------------------------------------------------------------------------
const MOLD = card('Test Mold', 'Creature — Insect', 'Trample\nWhen this creature dies, exile it, then return two creature cards at random from your graveyard to the battlefield.', '{0}', ['6', '6']);
const ELK = card('Test Elk', 'Creature — Elk', '', '{0}', ['1', '1']);
const FOX = card('Test Fox', 'Creature — Fox', '', '{0}', ['1', '1']);
const OWL = card('Test Owl', 'Creature — Bird', '', '{0}', ['1', '1']);
const RITE2 = card('Test Rite Two', 'Sorcery', 'Return target creature card from your graveyard to your hand.');
describe('CR 608.2d, 404.1, 400.7: "When this creature dies, exile it, then return two creature cards at random from your graveyard to the battlefield." (Moldgraf Monstrosity)', () => {
  const DEFS = [MOLD, ELK, FOX, OWL, RITE2];
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const inYard2 = (s: GameState, name: string, p = 'p1'): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === name);
  const run = (yard: string[]): GameState => {
    let s = scenario([], { defs: [...DEFS, KILL], p1: { battlefield: ['Test Mold'], graveyard: yard, hand: ['Test Kill'] } });
    s = cast(s, 'Test Kill', { targets: [[obj(onBf(s, 'Test Mold')[0]!)]] });
    return resolveAll(s);
  };
  it('is automated', () => expect(full(MOLD)).toBe(true));
  it('with three creature cards in the graveyard exactly two come back, ~ itself is exiled first (never returned)', () => {
    const s = run(['Test Elk', 'Test Fox', 'Test Owl']);
    const back = ['Test Elk', 'Test Fox', 'Test Owl'].filter((n) => onBf(s, n, 'p1').length === 1);
    expect(back.length).toBe(2);
    expect(onBf(s, 'Test Mold').length).toBe(0);
    expect(inYard2(s, 'Test Mold').length).toBe(0);
  });
  it('negative: with one creature card only that one comes back, and with none nothing does', () => {
    const one = run(['Test Elk']);
    expect(onBf(one, 'Test Elk', 'p1').length).toBe(1);
    const none = run([]);
    expect(none.zones.battlefield.filter((id) => none.objects[id]!.controller === 'p1').length).toBe(0);
  });
});

// ---- Visions of Dominance: "Flashback {8}{G}{G}. This spell costs {X} less to cast this way, where X is the greatest mana value of a commander you own ..." ------------------------------
describe('CR 702.34a, 601.2f, 903.3d: the flashback line with a cost change by the greatest mana value of your commanders (Visions of Dominance)', () => {
  const VISION = card2('Test Vision', '{3}{G}', 'Sorcery', 'You gain 1 life.\nFlashback {8}{G}{G}. This spell costs {X} less to cast this way, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.');
  const TITANIA2 = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
  const BOB2 = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const game = (lands: number, where: 'graveyard' | 'hand'): GameState => commanderScenario({ p1Commanders: [TITANIA2], p2Commanders: [BOB2], defs: [VISION], p1: { battlefield: forests(lands), [where]: ['Test Vision'] } });
  const lifeNow = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  const flash = (s: GameState): { error?: { message: string } } & { state?: GameState } => applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Vision', 'graveyard', 'p1'), method: 'flashback' });
  it('is automated', () => expect(full(VISION)).toBe(true));
  it('with a commander of mana value 2 the flashback costs {6}{G}{G}: 8 lands pay it, 7 do not', () => {
    expect(flash(game(7, 'graveyard')).error).toBeDefined();
    const s0 = game(8, 'graveyard');
    const before = lifeNow(s0);
    let s = answerUntilPriority(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Vision', 'graveyard', 'p1'), method: 'flashback' }));
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = answerUntilPriority(pass(s));
    expect(lifeNow(s)).toBe(before + 1);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Vision')).toBe(true);
  });
  it('negative: no commander, no reduction (the full {8}{G}{G}: 9 lands are not enough)', () => {
    const s = commanderScenario({ p1Commanders: [BOB2], p2Commanders: [BOB2], defs: [VISION], p1: { battlefield: forests(9), graveyard: ['Test Vision'] } });
    const cmd = tweak(s, (t) => { const id = t.zones.command.find((x) => t.objects[x]!.owner === 'p1')!; t.zones.command = t.zones.command.filter((x) => x !== id); t.objects[id]!.zone = 'exile'; t.zones.exile.push(id); });
    expect(flash(cmd).error).toBeDefined(); // the only commander is in exile: it does not count
  });
  it('negative: cast from the hand the reduction does not apply ({3}{G}: 3 lands cannot, 4 can)', () => {
    const three = game(3, 'hand');
    expect(applyAction(three, { type: 'cast', player: 'p1', card: find(three, 'Test Vision', 'hand', 'p1') }).error).toBeDefined();
    const four = game(4, 'hand');
    expect(applyAction(four, { type: 'cast', player: 'p1', card: find(four, 'Test Vision', 'hand', 'p1') }).error).toBeUndefined();
  });
});

// ---- Visions of Ruin: "Each opponent sacrifices an artifact. For each artifact sacrificed this way, you create a Treasure token." ------------------------------------------------
describe('CR 701.21a, 608.2c, 111.1: "Each opponent sacrifices an artifact. For each artifact sacrificed this way, you create a Treasure token." (Visions of Ruin)', () => {
  const RUIN = card('Test Ruin', 'Sorcery', 'Each opponent sacrifices an artifact. For each artifact sacrificed this way, you create a Treasure token.');
  const ROCK = card('Test Rock', 'Artifact', '');
  const treasures = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId.startsWith('token:Treasure')).length;
  it('is automated', () => expect(full(RUIN)).toBe(true));
  it('one Treasure for each artifact an opponent sacrificed, none for an opponent without an artifact', () => {
    const s0 = mpScenario({ defs: [RUIN, ROCK], zones: { p1: { hand: ['Test Ruin'] }, p2: { battlefield: ['Test Rock'] }, p3: { battlefield: ['Test Rock'] }, p4: { battlefield: [] } } });
    let s = resolveAll(cast(s0, 'Test Ruin'));
    expect(onBf(s, 'Test Rock').length).toBe(0);
    expect(treasures(s, 'p1')).toBe(2);
  });
  it('negative: no opponent controls an artifact: no Treasure', () => {
    const s0 = mpScenario({ defs: [RUIN, ROCK], zones: { p1: { hand: ['Test Ruin'], battlefield: ['Test Rock'] } } });
    const s = resolveAll(cast(s0, 'Test Ruin'));
    expect(onBf(s, 'Test Rock', 'p1').length).toBe(1);
    expect(treasures(s, 'p1')).toBe(0);
  });
});
