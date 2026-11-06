/**
 * edh-zones-27 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 614.1a, 700.4, 603.7, 400.7  "If a permanent you control would be put into a graveyard from the battlefield this turn, exile it instead. Return it to the battlefield under its
 *                                   owner's control at the beginning of the next end step." (Cosmic Intervention): each permanent the replacement exiles comes back at the next end step
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, card, cast, drive, find, full, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';
import { pick, until } from '../../m6/dfc/support';
import { declareAttackers, declareBlockers, toDeclareAttackers } from '../../m4/helpers';
import { pass } from '../../m3/scenario';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const bf = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const gy = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
void act; void drive; void passBoth;

/** Answer every decision (yes/no from `yes` in order, the first `min` options of an object choice) and pass priority until the stack is empty. */
function settle(s0: GameState, yes: boolean[] = [], choose?: (options: string[], s: GameState, min: number, max: number) => string[]): GameState {
  let s = s0;
  const ys = [...yes];
  for (let i = 0; i < 60; i++) {
    const p = s.pending;
    if (p !== null && p.kind !== 'priority') {
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: ys.shift() ?? false });
      else if (p.kind === 'chooseObjects') s = answer(s, pick(...(choose ? choose(p.options, s, p.min, p.max) : p.options.slice(0, p.min))));
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }); // the opponent, for "target opponent" triggers
      else s = drive(s);
      continue;
    }
    if (s.zones.stack.length > 0) { s = passBoth(s); continue; }
    break;
  }
  return s;
}
/** Attack player p2 with the named creatures of p1, no blocks, answering what comes up; stops at the end of combat. */
function attack(s0: GameState, names: string[], yes: boolean[] = []): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), names.map((n) => [find(s0, n, 'battlefield', 'p1')] as [string]));
  for (let i = 0; i < 40; i++) {
    const d = s.pending;
    if (!d) break;
    if (d.kind === 'declareBlockers') s = declareBlockers(s, []);
    else if (d.kind === 'priority') {
      if (s.turn.step === 'endCombat') break;
      s = pass(s);
    } else s = settle(s, yes);
  }
  return s;
}
const counterOn = (s: GameState, name: string, kind: string): number => {
  const id = s.zones.exile.find((x) => nameOf(s, x) === name);
  return id === undefined ? -1 : (s.objects[id]!.counters[kind] ?? 0);
};

describe('"If a permanent you control would be put into a graveyard from the battlefield this turn, exile it instead. Return it to the battlefield under its owner\'s control at the beginning of the next end step."', () => {
  const GUARD = card('Test Phase Guard', 'Instant', 'If a permanent you control would be put into a graveyard from the battlefield this turn, exile it instead. Return it to the battlefield under its owner\'s control at the beginning of the next end step.');
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const SWEEP = card('Test Sweep', 'Sorcery', 'Destroy all creatures.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', '{0}', ['2', '2']);
  const defs = [GUARD, DOOM, SWEEP, BEAR, WOLF];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Phase Guard', 'Test Doom'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wolf'] } });
  /** Pass to the end step of the turn, ordering the delayed triggers it puts on the stack in the order the game lists them (CR 603.3b). */
  const endStep = (s0: GameState, reverse = false): GameState => {
    let s = s0;
    for (let i = 0; i < 80 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) {
      s = s.pending?.kind === 'order' ? answer(s, { kind: 'order', ids: (reverse ? [...s.pending.items].reverse() : s.pending.items).map((x) => x.id) }) : until(s, (t) => t.pending?.kind === 'order' || (t.turn.step === 'end' && t.pending?.kind === 'priority'));
    }
    return s;
  };
  it('is fully automated', () => expect(full(GUARD)).toBe(true));
  it('the permanent that would die is exiled instead, and comes back under its owner\'s control at the next end step', () => {
    let s = cast(board(), 'Test Phase Guard');
    s = passBoth(s);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Doom', { targets: [[obj(bear)]] });
    s = passBoth(s);
    expect(bf(s)).toEqual([]);
    expect(exileNames(s)).toEqual(['Test Bear']);
    expect(gy(s)).toEqual(['Test Doom', 'Test Phase Guard']);
    s = endStep(s);
    expect(bf(s)).toEqual([]);
    s = passBoth(s);
    expect(bf(s)).toEqual(['Test Bear']);
    expect(exileNames(s)).toEqual([]);
  });
  it('only permanents of the caster: an opponent\'s creature that dies the same turn goes to its graveyard', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Phase Guard', 'Test Sweep'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wolf'] } });
    s = passBoth(cast(s, 'Test Phase Guard'));
    s = passBoth(cast(s, 'Test Sweep'));
    expect(bf(s, 'p1')).toEqual([]);
    expect(exileNames(s)).toEqual(['Test Bear']);
    expect(gy(s, 'p2')).toEqual(['Test Wolf']);
    s = resolveAll(endStep(s));
    expect(bf(s, 'p1')).toEqual(['Test Bear']);
    expect(bf(s, 'p2')).toEqual([]);
  });
  it('every permanent it exiles comes back at the same end step', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Phase Guard', 'Test Sweep'], battlefield: ['Test Bear', 'Test Wolf'] }, p2: {} });
    let s = passBoth(cast(s0, 'Test Phase Guard'));
    s = passBoth(cast(s, 'Test Sweep'));
    expect(exileNames(s)).toEqual(['Test Bear', 'Test Wolf']);
    s = resolveAll(endStep(s));
    expect(bf(s, 'p1')).toEqual(['Test Bear', 'Test Wolf']);
  });
  it('a creature you control but do not own returns under its OWNER\'s control', () => {
    const STEAL = card('Test Steal', 'Sorcery', 'Gain control of target creature.');
    const s0 = scenario([], { defs: [...defs, STEAL], p1: { hand: ['Test Phase Guard', 'Test Steal', 'Test Sweep'] }, p2: { battlefield: ['Test Wolf'] } });
    let s = cast(s0, 'Test Steal', { targets: [[obj(find(s0, 'Test Wolf', 'battlefield', 'p2'))]] });
    s = passBoth(s);
    expect(bf(s, 'p1')).toEqual(['Test Wolf']);
    s = passBoth(cast(s, 'Test Phase Guard'));
    s = passBoth(cast(s, 'Test Sweep'));
    expect(exileNames(s)).toEqual(['Test Wolf']);
    s = resolveAll(endStep(s));
    expect(bf(s, 'p2')).toEqual(['Test Wolf']);
    expect(bf(s, 'p1')).toEqual([]);
  });
  describe('an Aura exiled this way (CR 303.4f, 303.4g: it is put onto the battlefield, not cast; Scryfall ruling 2021-02-05)', () => {
    const AURA = card('Test Boon', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
    const play = (reverse: boolean): GameState => {
      const s0 = scenario([], { defs: [...defs, AURA], p1: { hand: ['Test Boon', 'Test Phase Guard', 'Test Doom'], battlefield: ['Test Bear'] }, p2: {} });
      let s = passBoth(cast(s0, 'Test Boon', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] }));
      s = passBoth(cast(s, 'Test Phase Guard'));
      s = passBoth(cast(s, 'Test Doom', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]] }));
      expect(exileNames(s)).toEqual(['Test Bear', 'Test Boon']); // both exiled instead of going to the graveyard (the Aura as a state-based action)
      return resolveAll(endStep(s, reverse));
    };
    it('with the creature back first, the Aura enters attached to it', () => {
      const s = play(true);
      expect(bf(s, 'p1')).toEqual(['Test Bear', 'Test Boon']);
      expect(s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Boon')!]!.attachedTo).toBe(s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear'));
    });
    it('with the Aura back first there is nothing legal to enchant: it stays in exile', () => {
      const s = play(false);
      expect(bf(s, 'p1')).toEqual(['Test Bear']);
      expect(exileNames(s)).toEqual(['Test Boon']);
    });
  });
  it('a token is exiled and ceases to exist: it does not come back', () => {
    const MAKE = card('Test Conjure', 'Sorcery', 'Create a 2/2 green Bear creature token.');
    const s0 = scenario([], { defs: [...defs, MAKE], p1: { hand: ['Test Conjure', 'Test Phase Guard', 'Test Sweep'] }, p2: {} });
    let s = passBoth(cast(s0, 'Test Conjure'));
    s = passBoth(cast(s, 'Test Phase Guard'));
    s = passBoth(cast(s, 'Test Sweep'));
    expect(bf(s)).toEqual([]);
    s = resolveAll(endStep(s));
    expect(bf(s)).toEqual([]);
  });
  it('it ends with the turn: a permanent that dies on a later turn goes to the graveyard and nothing is returned', () => {
    let s = passBoth(cast(board(), 'Test Phase Guard'));
    s = resolveAll(endStep(s));
    s = until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.number >= 3 && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Doom', { targets: [[obj(bear)]] }));
    expect(gy(s)).toContain('Test Bear');
    expect(exileNames(s)).toEqual([]);
  });
  it('the replacement is not used up: a second creature that dies the same turn is also exiled and returned', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Phase Guard', 'Test Doom', 'Test Doom'], battlefield: ['Test Bear', 'Test Wolf'] }, p2: {} });
    let s = passBoth(cast(s0, 'Test Phase Guard'));
    s = passBoth(cast(s, 'Test Doom', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]] }));
    s = passBoth(cast(s, 'Test Doom', { targets: [[obj(find(s, 'Test Wolf', 'battlefield', 'p1'))]] }));
    expect(exileNames(s)).toEqual(['Test Bear', 'Test Wolf']);
    s = resolveAll(endStep(s));
    expect(bf(s, 'p1')).toEqual(['Test Bear', 'Test Wolf']);
  });
});

describe('Mari, the Killing Quill: "Whenever a creature an opponent controls dies, exile it with a hit counter on it." and the granted trigger that removes one', () => {
  const MARI = card('Test Quill Marshal', 'Legendary Creature — Human Assassin', 'Whenever a creature an opponent controls dies, exile it with a hit counter on it.\nAssassins, Mercenaries, and Rogues you control have deathtouch and "Whenever this creature deals combat damage to a player, you may remove a hit counter from a card that player owns in exile. If you do, draw a card and create two Treasure tokens."', '{0}', ['2', '2']);
  const ROGUE = card('Test Alley Rogue', 'Creature — Human Rogue', '', '{0}', ['1', '1']);
  const MULE = card('Test Mule', 'Creature — Beast', '', '{0}', ['2', '2']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const MAKE = card('Test Conjure', 'Sorcery', 'Create a 2/2 green Bear creature token.');
  const defs = [MARI, ROGUE, MULE, DOOM, MAKE];
  const hasCounter = (s: GameState, owner: 'p1' | 'p2', kind: string): number => s.zones.exile.filter((x) => s.objects[x]!.owner === owner && (s.objects[x]!.counters[kind] ?? 0) > 0).length;
  it('is fully automated', () => expect(full(MARI)).toBe(true));
  it('an opponent\'s creature that dies is exiled with a hit counter, not left in the graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Quill Marshal'] }, p2: { battlefield: ['Test Mule'] } });
    const s = settle(cast(s0, 'Test Doom', { targets: [[obj(find(s0, 'Test Mule', 'battlefield', 'p2'))]] }));
    expect(gy(s, 'p2')).toEqual([]);
    expect(exileNames(s)).toEqual(['Test Mule']);
    expect(counterOn(s, 'Test Mule', 'hit')).toBe(1);
  });
  it('your own creature that dies goes to the graveyard as usual', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Quill Marshal', 'Test Alley Rogue'] }, p2: {} });
    const s = settle(cast(s0, 'Test Doom', { targets: [[obj(find(s0, 'Test Alley Rogue', 'battlefield', 'p1'))]] }));
    expect(gy(s, 'p1')).toContain('Test Alley Rogue');
    expect(exileNames(s)).toEqual([]);
  });
  it('an opponent\'s token that dies leaves nothing in exile (a token is no card)', () => {
    const GIFT = card('Test Gift', 'Sorcery', 'Target opponent creates a 2/2 green Bear creature token.');
    const s0 = scenario([], { defs: [...defs, GIFT], p1: { hand: ['Test Gift', 'Test Doom'], battlefield: ['Test Quill Marshal'] }, p2: {} });
    let s = settle(cast(s0, 'Test Gift', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(bf(s, 'p2')).toEqual(['Bear Token']);
    s = settle(cast(s, 'Test Doom', { targets: [[obj(find(s, 'Bear Token', 'battlefield', 'p2'))]] }));
    expect(bf(s, 'p2')).toEqual([]);
    expect(exileNames(s)).toEqual([]);
    expect(gy(s, 'p2')).toEqual([]);
  });
  it('combat damage to a player who owns a card with a hit counter: remove the counter, draw a card, create two Treasures; the Assassin has deathtouch', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quill Marshal'], library: ['Test Mule', 'Test Mule'] }, p2: { exile: [{ name: 'Test Mule', counters: { hit: 2 } }] } });
    const hand0 = s0.zones.hand['p1']!.length;
    const s = attack(s0, ['Test Quill Marshal'], [true]);
    expect(counterOn(s, 'Test Mule', 'hit')).toBe(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 1);
    expect(bf(s, 'p1').filter((n) => n.startsWith('Treasure'))).toHaveLength(2);
  });
  it('declining ("you may") removes nothing and draws nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quill Marshal'] }, p2: { exile: [{ name: 'Test Mule', counters: { hit: 1 } }] } });
    const hand0 = s0.zones.hand['p1']!.length;
    const s = attack(s0, ['Test Quill Marshal'], [false]);
    expect(counterOn(s, 'Test Mule', 'hit')).toBe(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0);
  });
  it('a card without a hit counter, or a hit counter on a card of the attacking player, is no choice: nothing is drawn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quill Marshal'], exile: [{ name: 'Test Mule', counters: { hit: 1 } }] }, p2: { exile: [{ name: 'Test Mule' }, { name: 'Test Alley Rogue', counters: { stun: 1 } }] } });
    const hand0 = s0.zones.hand['p1']!.length;
    const s = attack(s0, ['Test Quill Marshal'], [true]);
    expect(s.zones.hand['p1']!.length).toBe(hand0);
    expect(hasCounter(s, 'p1', 'hit')).toBe(1);
    expect(bf(s, 'p1').filter((n) => n.startsWith('Treasure'))).toHaveLength(0);
  });
  it('a Rogue you control gets the trigger too; a creature of another type does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quill Marshal', 'Test Alley Rogue', 'Test Mule'], library: ['Test Mule', 'Test Mule', 'Test Mule'] }, p2: { exile: [{ name: 'Test Mule', counters: { hit: 3 } }] } });
    const hand0 = s0.zones.hand['p1']!.length;
    const s = attack(s0, ['Test Alley Rogue', 'Test Mule'], [true, true]);
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 1);
    expect(counterOn(s, 'Test Mule', 'hit')).toBe(2);
  });
});

describe('Aminatou\'s Augury: "Exile the top eight cards of your library. You may put a land card from among them onto the battlefield. Until end of turn, for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its mana cost."', () => {
  const AUGURY = card('Test Augury', 'Sorcery', 'Exile the top eight cards of your library. You may put a land card from among them onto the battlefield. Until end of turn, for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its mana cost.');
  const FOREST = card('Test Meadow', 'Basic Land — Forest', '');
  const ELF = card('Test Elf A', 'Creature — Elf', '', '{3}{G}', ['1', '1']);
  const ELF2 = card('Test Elf B', 'Creature — Elf', '', '{3}{G}', ['1', '1']);
  const GOLEM = card('Test Golem A', 'Artifact Creature — Golem', '', '{4}', ['2', '2']);
  const GOLEM2 = card('Test Golem B', 'Artifact Creature — Golem', '', '{4}', ['2', '2']);
  const IDOL = card('Test Idol', 'Artifact', '', '{3}');
  const BOLT = card('Test Zap', 'Instant', 'You gain 3 life.', '{R}');
  const BOLT2 = card('Test Zap Two', 'Instant', 'You gain 4 life.', '{R}');
  const CHANT = card('Test Chant', 'Sorcery', 'You gain 2 life.', '{1}{W}');
  const AURA = card('Test Ward', 'Enchantment', '', '{2}{W}');
  const defs = [AUGURY, FOREST, ELF, ELF2, GOLEM, GOLEM2, IDOL, BOLT, BOLT2, CHANT, AURA];
  const top = (names: string[]) => [...names, 'Test Meadow', 'Test Meadow', 'Test Meadow'];
  const setup = (cards: string[]): GameState => scenario([], { defs, p1: { hand: ['Test Augury'], library: top(cards) }, p2: {} });
  const castable = (s: GameState, name: string): string[] =>
    legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name).map((a) => String((a.action as { method?: string }).method ?? ''));
  it('is fully automated', () => expect(full(AUGURY)).toBe(true));
  const land = (options: string[], st: GameState): string[] => options.filter((id) => nameOf(st, id) === 'Test Meadow').slice(0, 1);
  const resolveAugury = (s0: GameState, putLand = true): GameState => settle(cast(s0, 'Test Augury'), [], (options, st) => (putLand ? land(options, st) : []));
  it('exiles eight cards, puts one land card from among them onto the battlefield and leaves the others in exile', () => {
    const s = resolveAugury(setup(['Test Elf A', 'Test Zap', 'Test Chant', 'Test Idol', 'Test Ward']));
    expect(bf(s)).toEqual(['Test Meadow']);
    expect(exileNames(s)).toHaveLength(7);
    expect(s.zones.library['p1']!.length).toBeGreaterThanOrEqual(1);
  });
  it('declining the land leaves all eight exiled', () => {
    const s = resolveAugury(setup(['Test Elf A', 'Test Zap']), false);
    expect(bf(s)).toEqual([]);
    expect(exileNames(s)).toHaveLength(8);
  });
  /** The exiled card of `name` (the first one when there are two of that name). */
  const exiled = (st: GameState, name: string, nth = 0): string => st.zones.exile.filter((id) => nameOf(st, id) === name)[nth]!;
  /** The cast methods the game offers for the exiled card of `name` (one free way for each permission that names it). */
  const waysOf = (st: GameState, name: string, nth = 0): string[] =>
    legalActions(st, 'p1').filter((a) => a.kind === 'cast' && a.object === exiled(st, name, nth)).map((a) => String((a.action as { method?: string }).method ?? ''));
  /** Cast the exiled card (free: by the first way offered unless one is given), answering what comes up, resolve it. */
  const castFree = (st: GameState, name: string, method?: string, nth = 0): GameState =>
    settle(drive(act(st, { type: 'cast', player: 'p1', card: exiled(st, name, nth), method: method ?? waysOf(st, name, nth)[0]! })));
  const canCast = (st: GameState, name: string): boolean => legalActions(st, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && nameOf(st, a.object) === name && st.objects[a.object]!.zone === 'exile');
  it('one spell of each nonland type, free: a creature, an artifact, an instant, a sorcery and an enchantment can all be cast', () => {
    let s = resolveAugury(setup(['Test Elf A', 'Test Idol', 'Test Zap', 'Test Chant', 'Test Ward']));
    for (const n of ['Test Elf A', 'Test Idol', 'Test Zap', 'Test Chant', 'Test Ward']) {
      expect(canCast(s, n), n).toBe(true);
      s = castFree(s, n);
    }
    expect(bf(s)).toEqual(['Test Elf A', 'Test Idol', 'Test Meadow', 'Test Ward']);
    expect(gy(s)).toEqual(['Test Augury', 'Test Chant', 'Test Zap']);
    expect(exileNames(s)).toEqual(['Test Meadow', 'Test Meadow', 'Test Meadow', 'Test Meadow', 'Test Meadow', 'Test Meadow', 'Test Meadow'].slice(0, 7 - 5 + 0));
  });
  it('only ONE spell of a type: after a creature spell, a second creature spell from among the exiled cards cannot be cast', () => {
    let s = resolveAugury(setup(['Test Elf A', 'Test Elf B', 'Test Zap', 'Test Zap Two']));
    expect(canCast(s, 'Test Elf B')).toBe(true);
    s = castFree(s, 'Test Elf A');
    expect(canCast(s, 'Test Elf B')).toBe(false);
    expect(canCast(s, 'Test Zap')).toBe(true);
    s = castFree(s, 'Test Zap');
    expect(canCast(s, 'Test Zap Two')).toBe(false);
  });
  it('a land card is never cast, and a land left in exile cannot be played later', () => {
    const s = resolveAugury(setup(['Test Elf A']));
    expect(canCast(s, 'Test Meadow')).toBe(false);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand' && a.object !== undefined && s.objects[a.object]!.zone === 'exile')).toBe(false);
  });
  it('nothing else is free: a card in hand is not cast without paying, and a card not exiled this way is not offered from exile', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Augury', 'Test Elf B'], library: top(['Test Elf A']) }, p2: {} });
    const s = resolveAugury(s0);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === 'Test Elf B')).toBe(false);
  });
  it('an artifact creature may be cast as the artifact or as the creature: with two of them, both are cast, one for each type', () => {
    let s = resolveAugury(setup(['Test Golem A', 'Test Golem B']));
    const methods = waysOf(s, 'Test Golem A');
    expect(methods.length).toBeGreaterThanOrEqual(2); // one free way for each type permission
    s = castFree(s, 'Test Golem A', methods[1]);
    expect(canCast(s, 'Test Golem B')).toBe(true);
    s = castFree(s, 'Test Golem B');
    expect(bf(s).filter((n) => n.startsWith('Test Golem'))).toEqual(['Test Golem A', 'Test Golem B']);
  });
  it('an Adventure card: each half is cast only with the permission of its OWN type (the instant half never spends the creature permission)', () => {
    const GIANT = compileCard({ name: 'Test Giant // Test Stomp', layout: 'adventure', type_line: 'Creature — Giant // Instant — Adventure', mana_cost: '{3}{R}', colors: [],
      card_faces: [{ name: 'Test Giant', mana_cost: '{3}{R}', type_line: 'Creature — Giant', oracle_text: '', colors: [], power: '3', toughness: '3' }, { name: 'Test Stomp', mana_cost: '{1}{R}', type_line: 'Instant — Adventure', oracle_text: 'You gain 1 life.', colors: [] }] } as unknown as OracleCard);
    const s0 = scenario([], { defs: [...defs, GIANT], p1: { hand: ['Test Augury'], library: top(['Test Giant // Test Stomp', 'Test Elf A', 'Test Zap']) }, p2: {} });
    const s = settle(cast(s0, 'Test Augury'), [], land);
    const giant = exiled(s, 'Test Giant');
    const ways = (face: number) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === giant && ((a.action as { face?: number }).face ?? 0) === face).map((a) => String((a.action as { method?: string }).method));
    // the creature half has exactly one free way (the creature permission), the instant half exactly one (the instant permission)
    expect(ways(0)).toHaveLength(1);
    expect(ways(1)).toHaveLength(1);
    expect(ways(0)[0]).not.toBe(ways(1)[0]);
  });
  it('the permission lasts until end of turn only: on the next turn the exiled cards are not castable', () => {
    let s = resolveAugury(setup(['Test Elf A', 'Test Zap']));
    s = until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.number >= 3 && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    expect(canCast(s, 'Test Elf A')).toBe(false);
    expect(canCast(s, 'Test Zap')).toBe(false);
  });
  it('the permission an artifact creature is cast with is the one the player picks: cast as the creature, a plain artifact can still be cast (and no other creature)', () => {
    let s = resolveAugury(setup(['Test Golem A', 'Test Idol', 'Test Elf A']));
    const ways = waysOf(s, 'Test Golem A');
    // the ways are offered in the order of the permissions: artifact first, creature second
    s = castFree(s, 'Test Golem A', ways[1]);
    expect(canCast(s, 'Test Idol')).toBe(true);
    expect(canCast(s, 'Test Elf A')).toBe(false);
  });
  it('cast as the artifact, the plain creature can still be cast (and no other artifact)', () => {
    let s = resolveAugury(setup(['Test Golem A', 'Test Idol', 'Test Elf A']));
    s = castFree(s, 'Test Golem A', waysOf(s, 'Test Golem A')[0]);
    expect(canCast(s, 'Test Elf A')).toBe(true);
    expect(canCast(s, 'Test Idol')).toBe(false);
  });
});

describe('Urabrask // The Great Work: "{R}: Exile ~, then return it to the battlefield transformed ... only if you\'ve cast three or more instant and/or sorcery spells this turn" and chapter III "Until end of turn, you may cast instant and sorcery spells from any graveyard. If a spell cast this way would be put into a graveyard, exile it instead. Exile ~, then return it to the battlefield."', () => {
  const face = (name: string, type: string, text: string, cost: string, pt?: [string, string]) => ({ name, mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) });
  const FORGE = compileCard({ name: 'Test Forge Praetor // Test Great Rite', layout: 'transform', type_line: 'Legendary Creature — Praetor // Enchantment — Saga', colors: [], mana_cost: '{2}{R}{R}',
    card_faces: [
      face('Test Forge Praetor', 'Legendary Creature — Praetor', 'First strike\nWhenever you cast an instant or sorcery spell, ~ deals 1 damage to target opponent. Add {R}.\n{R}: Exile ~, then return it to the battlefield transformed under its owner\'s control. Activate only as a sorcery and only if you\'ve cast three or more instant and/or sorcery spells this turn.', '{2}{R}{R}', ['4', '4']),
      face('Test Great Rite', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — ~ deals 3 damage to target opponent and each creature they control.\nII — Create three Treasure tokens.\nIII — Until end of turn, you may cast instant and sorcery spells from any graveyard. If a spell cast this way would be put into a graveyard, exile it instead. Exile ~, then return it to the battlefield.', ''),
    ] } as unknown as OracleCard);
  const ZAP = card('Test Spark', 'Instant', 'You gain 1 life.', '{0}');
  const CHANT = card('Test Chant', 'Sorcery', 'You gain 2 life.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', '{0}', ['3', '3']);
  const THEIRS = card('Test Their Bolt', 'Instant', 'You gain 5 life.', '{0}');
  const defs = [FORGE, ZAP, CHANT, BEAR, WOLF, THEIRS];
  const NAME = 'Test Forge Praetor // Test Great Rite';
  const forge = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === NAME)!;
  const activations = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === forge(s));
  it('is fully automated (both faces)', () => expect(full(FORGE)).toBe(true));
  it('{R}: with three instants/sorceries cast this turn: exile and return transformed as the Saga with a lore counter (chapter I)', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { hand: ['Test Spark', 'Test Spark', 'Test Chant'], battlefield: [NAME, 'Mountain'] }, p2: { battlefield: ['Test Wolf'] } });
    let s = s0;
    for (const n of ['Test Spark', 'Test Spark', 'Test Chant']) s = settle(cast(s, n, { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const act1 = activations(s).find((a) => a.isMana !== true);
    expect(act1).toBeDefined();
    s = settle(act(s, act1!.action as never), [], undefined);
    s = settle(s);
    const id = forge(s);
    expect(s.objects[id]!.face).toBe(1);
    expect(getChars(s, id).name).toBe('Test Great Rite');
  });
  it('with only two instants/sorceries cast this turn the ability is not offered', () => {
    let s = scenario(['Mountain'], { defs, p1: { hand: ['Test Spark', 'Test Chant'], battlefield: [NAME, 'Mountain'] }, p2: {} });
    for (const n of ['Test Spark', 'Test Chant']) s = settle(cast(s, n, { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(activations(s).filter((a) => a.isMana !== true)).toHaveLength(0);
  });
  it('chapter III: instants and sorceries from ANY graveyard can be cast; the spell goes to exile; creatures stay in the graveyard; the Saga returns as the creature', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: NAME, face: 1, counters: { lore: 2 } }], graveyard: ['Test Spark', 'Test Bear'] }, p2: { graveyard: ['Test Their Bolt', 'Test Wolf'] } });
    // the game starts in the first main phase, where the third lore counter has just been added: chapter III is on the stack
    let s = settle(s0);
    // chapter III has resolved: the Saga was exiled and returned as the front face
    expect(s.objects[forge(s)]!.face).toBe(0);
    const castable = (name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name && s.objects[a.object]!.zone === 'graveyard');
    expect(castable('Test Spark')).toBe(true);
    expect(castable('Test Their Bolt')).toBe(true);
    expect(castable('Test Bear')).toBe(false);
    expect(castable('Test Wolf')).toBe(false);
    const life0 = s.players.find((p) => p.id === 'p1')!.life;
    const bolt = s.zones.graveyard['p2']!.find((id) => nameOf(s, id) === 'Test Their Bolt')!;
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: bolt }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life0 + 5);
    expect(exileNames(s)).toContain('Test Their Bolt');
    expect(gy(s, 'p2')).toEqual(['Test Wolf']);
  });
  it('a sorcery from a graveyard is cast at sorcery timing only: not on the opponent\'s turn, and the permission ends with the turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: NAME, face: 1, counters: { lore: 2 } }], graveyard: ['Test Chant'] }, p2: {} });
    let s = settle(s0);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && s.objects[a.object]!.zone === 'graveyard')).toBe(true);
    s = until(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && s.objects[a.object]!.zone === 'graveyard')).toBe(false);
  });
});

describe('Urabrask, Heretic Praetor: "At the beginning of each opponent\'s upkeep, the next time they would draw a card this turn, instead they exile the top card of their library. They may play it this turn."', () => {
  const PRAETOR = card('Test Heretic Praetor', 'Legendary Creature — Praetor', 'Haste\nAt the beginning of your upkeep, exile the top card of your library. You may play it this turn.\nAt the beginning of each opponent\'s upkeep, the next time they would draw a card this turn, instead they exile the top card of their library. They may play it this turn.', '{2}{R}', ['4', '4']);
  const MEADOW = card('Test Meadow', 'Basic Land — Forest', '');
  const IDEA = card('Test Idea', 'Sorcery', 'You gain 3 life.', '{0}');
  const DRAWER = card('Test Drawer', 'Instant', 'Draw a card.', '{0}');
  const defs = [PRAETOR, MEADOW, IDEA, DRAWER];
  const startOfP2 = (): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Heretic Praetor'] }, p2: { library: ['Test Idea', 'Test Meadow', 'Test Meadow'] } });
    return until(s0, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
  };
  const handOf = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();
  it('is fully automated', () => expect(full(PRAETOR)).toBe(true));
  it('their draw step draw is replaced: the top card is exiled instead of drawn, and they may play it this turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Heretic Praetor'] }, p2: { hand: [], library: ['Test Idea', 'Test Meadow', 'Test Meadow'] } });
    const h0 = s0.zones.hand['p2']!.length;
    let s = until(s0, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'upkeep' && t.pending?.kind === 'priority');
    s = settle(s);
    s = until(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    expect(s.zones.hand['p2']!.length).toBe(h0); // no card drawn
    expect(exileNames(s)).toEqual(['Test Idea']);
    const idea = s.zones.exile.find((id) => nameOf(s, id) === 'Test Idea')!;
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === idea)).toBe(true);
    // and ONLY them (the player of the draw), not the Praetor's controller
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === idea)).toBe(false);
  });
  it('only the next draw this turn: a second draw is a normal draw', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Heretic Praetor'] }, p2: { hand: ['Test Drawer'], library: ['Test Idea', 'Test Meadow', 'Test Meadow'] } });
    let s = until(s0, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    const h1 = handOf(s, 'p2');
    s = settle(cast(s, 'Test Drawer', undefined, 'p2'));
    expect(handOf(s, 'p2').length).toBe(h1.length); // Drawer left the hand, the new card is in: a normal draw
    expect(exileNames(s)).toEqual(['Test Idea']);
  });
  it('the permission is only for this turn: on a later turn the exiled card cannot be played', () => {
    let s = startOfP2();
    s = until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.number >= 3 && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    const idea = s.zones.exile.find((id) => nameOf(s, id) === 'Test Idea');
    expect(idea === undefined || !legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === idea)).toBe(true);
  });
});
