/**
 * Commander lane edh-c, round edh-c-74 (fourth pass of EDHREC ranks 17,001 to 17,500): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.23a, 401.2     "Search ... for up to two basic land cards and reveal them. Put one into your hand and the other into your graveyard." (Fork in the Road)
 *   CR 115.1, 701.21a     "Choose two target creatures controlled by the same player. That player sacrifices one of them of their choice." (Incriminate)
 *   CR 701.20a, 401.4     "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom ..." (Psychotic Episode)
 *   CR 205.3m, 603.4      "When ~ enters, if you control three or more creatures that share a creature type, put a +1/+1 counter on ~, then scry 1." (Littjara Kinseekers)
 *   CR 614.15, 120.3      "... If you had a land enter the battlefield under your control this turn, ~ deals 3 damage to that player or planeswalker and 3 damage to that creature instead." (Searing Blaze)
 *   CR 701.9a, 202.3      "target player reveals their hand and discards all cards with that spell's mana value." (Infernal Kirin)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass, put, reject, scenario } from '../../m3/scenario';
import { card, cast, counters, full, pt } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id });

const zone = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: string): string[] => s.zones[z][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
type Pending = { kind: string; options: ObjectId[]; min?: number; max?: number };
/** Resolve the stack, answering each choice of objects with `pick(options, decision)` (default: the minimum, the first cards) and paying costs automatically. */
function play(s0: GameState, pick: (s: GameState, d: Pending) => ObjectId[] = (s, d) => d.options.slice(0, d.min ?? 0), targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 60; i++) {
    const d = s.pending as unknown as Pending | undefined;
    if (d === undefined) break;
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(s, d) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
    else break;
  }
  return s;
}


describe('CR 701.23a, 401.2: "Search your library for up to two basic land cards and reveal them. Put one into your hand and the other into your graveyard."', () => {
  const FORK = card('Test Fork', 'Sorcery', 'Search your library for up to two basic land cards and reveal them. Put one into your hand and the other into your graveyard. Then shuffle.');
  const DEFS: CardDef[] = [FORK];
  it('is automated', () => expect(full(FORK)).toBe(true));
  it('one of the two found cards goes to the hand (your choice), the other to the graveyard', () => {
    let s = scenario(['Forest', 'Island'], { p1: { hand: ['Test Fork'], library: ['Forest', 'Island'] }, defs: DEFS });
    s = cast(s, 'Test Fork');
    s = play(s, (st, d) => (d.max === 2 ? d.options.slice(0, 2) : [d.options.find((id) => nameOf(st, id) === 'Island')!]));
    expect(zone(s, 'hand', 'p1')).toContain('Island');
    expect(zone(s, 'graveyard', 'p1')).toContain('Forest');
    expect(zone(s, 'hand', 'p1')).not.toContain('Forest');
    expect(zone(s, 'graveyard', 'p1')).not.toContain('Island');
  });
  it('only one found: it goes to the hand, nothing to the graveyard (negative)', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Fork'], library: ['Forest'] }, defs: DEFS });
    s = cast(s, 'Test Fork');
    s = play(s, (st, d) => d.options.filter((id) => nameOf(st, id) === 'Forest').slice(0, 2));
    expect(zone(s, 'hand', 'p1')).toContain('Forest');
    expect(zone(s, 'graveyard', 'p1')).not.toContain('Forest');
  });
  it('a card that is not a basic land is not found (negative)', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Fork'], library: ['Test Bear', 'Forest'] }, defs: [FORK, card('Test Bear', 'Creature — Bear', '', ['2', '2'])] });
    s = cast(s, 'Test Fork');
    s = play(s, (st, d) => d.options.filter((id) => nameOf(st, id) === 'Forest').slice(0, 2));
    expect(zone(s, 'hand', 'p1')).toEqual(['Forest']);
    expect(zone(s, 'hand', 'p1')).not.toContain('Test Bear');
    expect(s.pending?.kind).toBe('priority');
  });
});

describe('CR 115.1, 701.21a: "Choose two target creatures controlled by the same player. That player sacrifices one of them of their choice."', () => {
  const INCRIM = card('Test Incrim', 'Sorcery', 'Choose two target creatures controlled by the same player. That player sacrifices one of them of their choice.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const DEFS: CardDef[] = [INCRIM, BEAR, OGRE];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Incrim'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
  it('is automated', () => expect(full(INCRIM)).toBe(true));
  it('the controller of the two targets chooses which one to sacrifice (not the caster)', () => {
    let s = start();
    const [a, b] = [find(s, 'Test Bear', 'battlefield', 'p2'), find(s, 'Test Ogre', 'battlefield', 'p2')];
    s = cast(s, 'Test Incrim', { targets: [obj(a), obj(b)] });
    let chooser = '';
    s = play(s, (st, d) => { chooser = (st.pending as { player: string }).player; return [b]; });
    expect(chooser).toBe('p2');
    expect(s.zones.battlefield).toContain(a);
    expect(s.zones.battlefield).not.toContain(b);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1);
  });
  it('two targets with different controllers are refused (negative)', () => {
    const s = start();
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Incrim', 'hand', 'p1') });
    expect(t.pending?.kind).toBe('chooseTargets');
    reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(mine), obj(theirs)] } }); // the answer breaks the one-controller rule (CR 115.1, 601.2c)
  });
  it('one target changes hands before it resolves: the targets no longer share a controller, so the spell does nothing (CR 608.2b; never two players sacrificing)', () => {
    const STEAL = card('Test Steal', 'Instant', 'Gain control of target creature until end of turn.');
    let s = scenario([], { p1: { hand: ['Test Incrim', 'Test Steal'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: [...DEFS, STEAL] });
    const [a, b] = [find(s, 'Test Bear', 'battlefield', 'p2'), find(s, 'Test Ogre', 'battlefield', 'p2')];
    s = cast(s, 'Test Incrim', { targets: [obj(a), obj(b)] });
    s = cast(s, 'Test Steal', { targets: [obj(a)] });
    s = play(s);
    expect(s.zones.battlefield).toContain(a);
    expect(s.zones.battlefield).toContain(b);
  });
  it('you may choose two of your own creatures: you then sacrifice one of them', () => {
    let s = scenario([], { p1: { hand: ['Test Incrim'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const [a, b] = [find(s, 'Test Bear', 'battlefield', 'p1'), find(s, 'Test Ogre', 'battlefield', 'p1')];
    s = cast(s, 'Test Incrim', { targets: [obj(a), obj(b)] });
    let chooser = '';
    s = play(s, (st) => { chooser = (st.pending as { player: string }).player; return [a]; });
    expect(chooser).toBe('p1');
    expect(s.zones.battlefield).not.toContain(a);
    expect(s.zones.battlefield).toContain(b);
  });
});

describe('CR 701.20a, 401.4, 608.2d: "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom of their library."', () => {
  const EPISODE = card('Test Episode', 'Sorcery', 'Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on the bottom of their library.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const DEFS: CardDef[] = [EPISODE, BEAR, OGRE];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Episode'] }, p2: { hand: ['Test Bear'], library: ['Test Ogre'] }, defs: DEFS });
  it('is automated', () => expect(full(EPISODE)).toBe(true));
  it('you choose a card of their hand: it goes to the bottom of their library', () => {
    let s = start();
    s = cast(s, 'Test Episode', { targets: [plr('p2')] });
    let offered: string[] = [];
    s = play(s, (st, d) => { offered = d.options.map((id) => nameOf(st, id)); return [d.options.find((id) => nameOf(st, id) === 'Test Bear')!]; });
    expect(offered.sort()).toEqual(['Test Bear', 'Test Ogre']);
    expect(zone(s, 'hand', 'p2')).toEqual([]);
    const lib = zone(s, 'library', 'p2');
    expect(lib[lib.length - 1]).toBe('Test Bear');
    expect(lib[0]).toBe('Test Ogre');
  });
  it('you choose the top card: it goes to the bottom, the hand is kept', () => {
    let s = start();
    s = cast(s, 'Test Episode', { targets: [plr('p2')] });
    s = play(s, (st, d) => [d.options.find((id) => nameOf(st, id) === 'Test Ogre')!]);
    expect(zone(s, 'hand', 'p2')).toEqual(['Test Bear']);
    const lib = zone(s, 'library', 'p2');
    expect(lib[lib.length - 1]).toBe('Test Ogre');
    expect(lib[0]).toBe('Plains');
  });
});

describe('CR 205.3m, 702.73a, 603.4: "When ~ enters, if you control three or more creatures that share a creature type, put a +1/+1 counter on ~, then scry 1."', () => {
  const KIN = card('Test Kin', 'Creature — Shapeshifter', 'Changeling\nWhen this creature enters, if you control three or more creatures that share a creature type, put a +1/+1 counter on this creature, then scry 1.', ['2', '2']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
  const DEFS: CardDef[] = [KIN, ELF, GOBLIN];
  const run = (battlefield: string[]): number => {
    let s = scenario([], { p1: { hand: ['Test Kin'], battlefield }, defs: DEFS });
    s = cast(s, 'Test Kin');
    s = play(s);
    return counters(s, find(s, 'Test Kin', 'battlefield', 'p1'), '+1/+1');
  };
  it('is automated', () => expect(full(KIN)).toBe(true));
  it('two Elves and the changeling itself (an Elf too) share a type: it enters with a counter', () => expect(run(['Test Elf', 'Test Elf'])).toBe(1));
  it('an Elf and a Goblin and the changeling: no type is shared by three (negative)', () => expect(run(['Test Elf', 'Test Goblin'])).toBe(0));
  it('two Elves and a Goblin and the changeling: three Elves share a type', () => expect(run(['Test Elf', 'Test Elf', 'Test Goblin'])).toBe(1));
  it('only the changeling alone: no counter (negative)', () => expect(run([])).toBe(0));
});

describe('CR 614.15, 120.3: "~ deals 1 damage to target player or planeswalker and 1 damage to target creature that player or that planeswalker\'s controller controls. If you had a land enter the battlefield under your control this turn, ~ deals 3 damage to that player or planeswalker and 3 damage to that creature instead."', () => {
  const BLAZE = card('Test Blaze', 'Instant', "Test Blaze deals 1 damage to target player or planeswalker and 1 damage to target creature that player or that planeswalker's controller controls. If you had a land enter the battlefield under your control this turn, Test Blaze deals 3 damage to that player or planeswalker and 3 damage to that creature instead.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [BLAZE, OGRE, BEAR];
  /** The two targets are announced one after the other (a player or planeswalker, then a creature that player controls). */
  const blaze = (s: GameState, first: TargetChoice, second: TargetChoice): GameState => {
    let t = answer(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blaze', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [first] });
    t = answer(t, { kind: 'chooseTargets', targets: [second] });
    return play(t);
  };
  const start = (): GameState => scenario(['Forest'], { p1: { hand: ['Test Blaze', 'Forest'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
  it('is automated', () => expect(full(BLAZE)).toBe(true));
  it('with no land entered this turn it deals 1 and 1', () => {
    let s = start();
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = blaze(s, plr('p2'), obj(ogre));
    expect(life(s, 'p2')).toBe(19);
    expect(s.objects[ogre]!.damage).toBe(1);
  });
  it('after playing a land this turn it deals 3 and 3 (the Ogre dies)', () => {
    let s = start();
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') });
    s = blaze(s, plr('p2'), obj(ogre));
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.battlefield).not.toContain(ogre);
  });
  it('if the creature is gone by the time it resolves, the player is still dealt the damage (ruling 2010-03-01; CR 608.2b)', () => {
    const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
    let s = scenario(['Forest'], { p1: { hand: ['Test Blaze'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Doom'], battlefield: ['Test Ogre'] }, defs: [...DEFS, DOOM] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = answer(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blaze', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [plr('p2')] });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(ogre)] });
    s = pass(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Doom', 'hand', 'p2') });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(ogre)] });
    s = play(s);
    expect(s.zones.battlefield).not.toContain(ogre);
    expect(life(s, 'p2')).toBe(19);
  });
  it('the creature must be one the targeted player controls: your own Bear is refused (negative)', () => {
    const s = start();
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const t = answer(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blaze', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [plr('p2')] });
    expect(t.pending?.kind).toBe('chooseTargets');
    reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(mine)] } }); // a creature p2 does not control is not a legal second target (CR 601.2c)
  });
});

describe('CR 701.20a, 701.9a, 202.3: "Whenever you cast a Spirit or Arcane spell, target player reveals their hand and discards all cards with that spell\'s mana value."', () => {
  const KIRIN = card('Test Kirin', 'Creature — Spirit', "Flying\nWhenever you cast a Spirit or Arcane spell, target player reveals their hand and discards all cards with that spell's mana value.", ['2', '2']);
  const SPIRIT = card('Test Spirit', 'Creature — Spirit', '', ['1', '1'], '{2}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{2}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
  const DEFS: CardDef[] = [KIRIN, SPIRIT, BEAR, OGRE];
  it('is automated', () => expect(full(KIRIN)).toBe(true));
  it('every card of their hand with the cast spell\'s mana value is discarded; other mana values stay', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Spirit'], battlefield: ['Test Kirin', 'Plains', 'Plains'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Spirit', { targets: [plr('p2')] });
    s = play(s, undefined, [plr('p2')]);
    expect(zone(s, 'graveyard', 'p2').sort()).toEqual(['Test Bear', 'Test Bear']);
    expect(zone(s, 'hand', 'p2')).toEqual(['Test Ogre']);
  });
  it('an {X} spell counts the X chosen for it on the stack (ruling 2005-06-01)', () => {
    const XSPIRIT = card('Test X Spirit', 'Sorcery — Arcane', 'You gain 1 life.', undefined, '{X}{W}');
    let s = scenario(['Plains'], { p1: { hand: ['Test X Spirit'], battlefield: ['Test Kirin', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Ogre', 'Test Bear'] }, defs: [...DEFS, XSPIRIT] });
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test X Spirit', 'hand', 'p1') });
    expect(t.pending?.kind).toBe('chooseNumber');
    s = answer(t, { kind: 'chooseNumber', n: 2 });
    s = play(s, undefined, [plr('p2')]);
    expect(zone(s, 'graveyard', 'p2')).toEqual(['Test Ogre']); // mana value {X}{W} with X = 2 is 3
    expect(zone(s, 'hand', 'p2')).toEqual(['Test Bear']);
  });
  it('a spell that is not a Spirit or Arcane does not trigger it (negative)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Bear'], battlefield: ['Test Kirin', 'Plains', 'Plains'] }, p2: { hand: ['Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Bear');
    s = play(s, undefined, [plr('p2')]);
    expect(zone(s, 'hand', 'p2')).toEqual(['Test Bear']);
    expect(zone(s, 'graveyard', 'p2')).toEqual([]);
  });
});
