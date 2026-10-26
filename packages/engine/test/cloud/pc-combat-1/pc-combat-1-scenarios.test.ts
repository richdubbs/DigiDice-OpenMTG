/**
 * pc-combat-1 (Commander precon lane pc-combat): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not
 * in the cloud checkout).
 *
 *   CR 508.1b, 303.4, 603.2c  "Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card. If the player does, they draw a card."
 *   CR 508.1b, 303.4, 608.2c  "Whenever enchanted player is attacked, you gain 2 life. Each opponent attacking that player does the same."
 *   CR 506.3, 508.5, 603.2    "Whenever a creature attacks one of your opponents or a planeswalker an opponent controls, that creature gets +2/+0 until end of turn."
 *   CR 603.2c, 506.3          "Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain menace until end of turn."
 *   CR 111.1, 608.2d          "that player may create a tapped 2/2 black Zombie creature token."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { cast } from '../cmd3/helpers';
import { answer, find, lifeOf, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: '{0}', oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const HEX_CHAOS = card('Test Hex of Chaos', 'Enchantment — Aura Curse', 'Enchant player\nWhenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card. If the player does, they draw a card.');
const HEX_GRAVES = card('Test Hex of Graves', 'Enchantment — Aura Curse', 'Enchant player\nWhenever a player attacks enchanted player with one or more creatures, that attacking player may create a tapped 2/2 black Zombie creature token.');
const HEX_VITAL = card('Test Hex of Vigor', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player is attacked, you gain 2 life. Each opponent attacking that player does the same.');
const HEX_GOLD = card('Test Hex of Plenty', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player is attacked, create a Gold token. Each opponent attacking that player does the same.');
const HEX_DRAW = card('Test Hex of Lore', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player is attacked, you draw a card. Each opponent attacking that player does the same.');
const FURY = card('Test Fury Banner', 'Artifact', 'Whenever a creature attacks one of your opponents or a planeswalker an opponent controls, that creature gets +2/+0 until end of turn.');
const MARSHAL = card('Test Raid Marshal', 'Creature — Human Soldier', 'Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain menace until end of turn.', ['1', '1']);
const WALKER = card('Test Oath Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const RAIDER = card('Test Hill Raider', 'Creature — Goblin', '', ['1', '1']);
const KILL = card('Test Quick Smite', 'Instant', 'Destroy target creature.');
const DEFS = [KILL, HEX_CHAOS, HEX_GRAVES, HEX_VITAL, HEX_GOLD, HEX_DRAW, FURY, MARSHAL, WALKER, RAIDER];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

const onBattlefield = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

/** A four-player game on p2's turn 1 (p2 attacks), the Aura of p1 attached to `enchanted`; the raiders are p2's. */
function curseGame(aura: string, enchanted: PlayerId, extra: { p1?: string[]; p3?: (string | { name: string; counters: Record<string, number> })[]; p2hand?: string[] } = {}): GameState {
  return mpScenario({
    defs: DEFS, options: { startingPlayer: 'p2' },
    zones: { p1: { battlefield: [aura, ...(extra.p1 ?? [])] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider'], hand: extra.p2hand ?? [] }, p3: { battlefield: extra.p3 ?? [] } },
    setup: (x) => { x.objects[find(x, aura, 'battlefield', 'p1')]!.attachedTo = enchanted; },
  });
}

/** Declare attackers (the active player's), then resolve the stack answering "yes" to every optional effect; returns the state at the end of the declare attackers step. */
function attackThenResolve(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId | ObjectId }[]): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 100 && (s.zones.stack.length > 0 || s.pending?.kind === 'order'); i++) {
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, 1) });
    else if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
    else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${s.pending?.kind}`);
  }
  return s;
}
/** How many triggers the declaration put on the stack (the controller is first asked to order several, CR 603.3b). */
const triggers = (s: GameState): number => (s.pending?.kind === 'order' ? s.pending.items.length : s.zones.stack.length);
const raiders = (s: GameState): ObjectId[] => onBattlefield(s, 'Test Hill Raider', 'p2');

describe('CR 508.1b, 303.4, 603.2c: "Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card. If the player does, they draw a card."', () => {
  it('p2 attacks the enchanted p3 with two creatures: one trigger, p2 (the attacking player, not the Aura\'s controller) discards a card and draws one', () => {
    let s = curseGame('Test Hex of Chaos', 'p3', { p2hand: ['Plains', 'Plains'] });
    const [a, b] = raiders(s);
    const before = { p1: hand(s, 'p1'), p2: hand(s, 'p2') };
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p3' }, { attacker: b!, defender: 'p3' }]);
    expect(s.zones.graveyard['p2']).toHaveLength(1);
    expect(hand(s, 'p2')).toBe(before.p2); // one discard, one draw: once, not once for each creature
    expect(hand(s, 'p1')).toBe(before.p1);
  });
  it('negative: p2 attacks p4 (not enchanted): no trigger, nothing discarded', () => {
    let s = curseGame('Test Hex of Chaos', 'p3', { p2hand: ['Plains', 'Plains'] });
    const [a, b] = raiders(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p4' }, { attacker: b!, defender: 'p4' }]);
    expect(s.zones.graveyard['p2']).toHaveLength(0);
  });
  it('negative: p2 attacks a planeswalker p3 controls: p3 is not attacked (CR 506.3), no trigger', () => {
    let s = curseGame('Test Hex of Chaos', 'p3', { p2hand: ['Plains'], p3: [{ name: 'Test Oath Walker', counters: { loyalty: 3 } }] });
    const walker = onBattlefield(s, 'Test Oath Walker', 'p3')[0]!;
    s = attackThenResolve(s, [{ attacker: raiders(s)[0]!, defender: walker }]);
    expect(s.zones.graveyard['p2']).toHaveLength(0);
  });
  it('the Aura\'s controller attacking the enchanted player is "a player" too: p1 discards and draws', () => {
    let s = mpScenario({
      defs: DEFS, zones: { p1: { battlefield: ['Test Hex of Chaos', 'Test Hill Raider'], hand: ['Plains'] } },
      setup: (x) => { x.objects[find(x, 'Test Hex of Chaos', 'battlefield', 'p1')]!.attachedTo = 'p3'; },
    });
    s = attackThenResolve(s, [{ attacker: onBattlefield(s, 'Test Hill Raider', 'p1')[0]!, defender: 'p3' }]);
    expect(s.zones.graveyard['p1']).toHaveLength(1);
  });
});

describe('CR 111.1, 608.2d: "that attacking player may create a tapped 2/2 black Zombie creature token."', () => {
  it('p2 attacking the enchanted p3 creates a tapped Zombie under p2\'s control; attacking p4 creates none', () => {
    let s = attackThenResolve(curseGame('Test Hex of Graves', 'p3'), [{ attacker: raiders(curseGame('Test Hex of Graves', 'p3'))[0]!, defender: 'p3' }]);
    const zombies = (x: GameState, p: PlayerId): ObjectId[] => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token' && x.objects[id]!.controller === p);
    expect(zombies(s, 'p2')).toHaveLength(1);
    expect(zombies(s, 'p1')).toHaveLength(0);
    expect(s.objects[zombies(s, 'p2')[0]!]!.tapped).toBe(true);
    s = curseGame('Test Hex of Graves', 'p3');
    s = attackThenResolve(s, [{ attacker: raiders(s)[0]!, defender: 'p4' }]);
    expect(zombies(s, 'p2')).toHaveLength(0);
  });
});

const lives = (s: GameState): number[] => ['p1', 'p2', 'p3', 'p4'].map((p) => lifeOf(s, p));
const goldOf = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name.startsWith('Gold')).length;

describe('CR 508.1b, 303.4, 608.2c: "Whenever enchanted player is attacked, you gain 2 life. Each opponent attacking that player does the same."', () => {
  it('p2 attacks the enchanted p3 with two creatures: the Aura\'s controller p1 gains 2 life once, and so does p2 (the opponent attacking); p3 and p4 gain nothing', () => {
    let s = curseGame('Test Hex of Vigor', 'p3');
    const [a, b] = raiders(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p3' }, { attacker: b!, defender: 'p3' }]);
    expect(lives(s)).toEqual([22, 22, 20, 20]);
  });
  it('negative: p2 attacks p4 (not enchanted): nobody gains life', () => {
    let s = curseGame('Test Hex of Vigor', 'p3');
    s = attackThenResolve(s, [{ attacker: raiders(s)[0]!, defender: 'p4' }]);
    expect(lives(s)).toEqual([20, 20, 20, 20]);
  });
  it('negative: p2 attacks a planeswalker p3 controls: p3 is not attacked, nobody gains life', () => {
    let s = curseGame('Test Hex of Vigor', 'p3', { p3: [{ name: 'Test Oath Walker', counters: { loyalty: 3 } }] });
    s = attackThenResolve(s, [{ attacker: raiders(s)[0]!, defender: onBattlefield(s, 'Test Oath Walker', 'p3')[0]! }]);
    expect(lives(s)).toEqual([20, 20, 20, 20]);
  });
  it('the Aura\'s controller p1 attacking the enchanted p3 gains 2 life once: "each opponent" never includes the controller', () => {
    let s = mpScenario({
      defs: DEFS, zones: { p1: { battlefield: ['Test Hex of Vigor', 'Test Hill Raider'] } },
      setup: (x) => { x.objects[find(x, 'Test Hex of Vigor', 'battlefield', 'p1')]!.attachedTo = 'p3'; },
    });
    s = attackThenResolve(s, [{ attacker: onBattlefield(s, 'Test Hill Raider', 'p1')[0]!, defender: 'p3' }]);
    expect(lives(s)).toEqual([22, 20, 20, 20]);
  });
  it('the enchanted player attacking someone else is not "attacking that player": p3 attacks p4, nothing happens', () => {
    let s = mpScenario({
      defs: DEFS, options: { startingPlayer: 'p3' }, zones: { p1: { battlefield: ['Test Hex of Vigor'] }, p3: { battlefield: ['Test Hill Raider'] } },
      setup: (x) => { x.objects[find(x, 'Test Hex of Vigor', 'battlefield', 'p1')]!.attachedTo = 'p3'; },
    });
    s = attackThenResolve(s, [{ attacker: onBattlefield(s, 'Test Hill Raider', 'p3')[0]!, defender: 'p4' }]);
    expect(lives(s)).toEqual([20, 20, 20, 20]);
  });
  it('a Gold token is created for the Aura\'s controller and for the opponent attacking, and only for them', () => {
    let s = curseGame('Test Hex of Plenty', 'p3');
    s = attackThenResolve(s, [{ attacker: raiders(s)[0]!, defender: 'p3' }]);
    expect([goldOf(s, 'p1'), goldOf(s, 'p2'), goldOf(s, 'p3'), goldOf(s, 'p4')]).toEqual([1, 1, 0, 0]);
  });
  it('cards: "you draw a card. Each opponent attacking that player does the same." draws for p1 and p2 only', () => {
    let s = curseGame('Test Hex of Lore', 'p3');
    const before = ['p1', 'p2', 'p3', 'p4'].map((p) => hand(s, p));
    s = attackThenResolve(s, [{ attacker: raiders(s)[0]!, defender: 'p3' }]);
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => hand(s, p))).toEqual([before[0]! + 1, before[1]! + 1, before[2]!, before[3]!]);
  });
});

/** A four-player game on p1's turn with the given cards of p1, two Raiders of p1. */
function myTurn(extra: string[], p1Extra: string[] = []): GameState {
  return mpScenario({ defs: DEFS, zones: { p1: { battlefield: [...extra, 'Test Hill Raider', 'Test Hill Raider', ...p1Extra] }, p3: { battlefield: [{ name: 'Test Oath Walker', counters: { loyalty: 3 } }] } } });
}
const mine = (s: GameState): ObjectId[] => onBattlefield(s, 'Test Hill Raider', 'p1');
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const hasMenace = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'menace');

describe('CR 506.3, 508.5, 603.2: "Whenever a creature attacks one of your opponents or a planeswalker an opponent controls, that creature gets +2/+0 until end of turn."', () => {
  it('my creature attacking an opponent gets +2/+0; the other creature attacking another opponent too, each by its own trigger', () => {
    let s = myTurn(['Test Fury Banner']);
    const [a, b] = mine(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p4' }]);
    expect(power(s, a!)).toBe(3);
    expect(power(s, b!)).toBe(3);
  });
  it('a creature attacking a planeswalker an opponent controls gets +2/+0', () => {
    let s = myTurn(['Test Fury Banner']);
    const [a, b] = mine(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: onBattlefield(s, 'Test Oath Walker', 'p3')[0]! }]);
    expect(power(s, a!)).toBe(3);
    expect(power(s, b!)).toBe(1);
  });
  it('negative: an opponent\'s creature attacking me (or a planeswalker I control) is not an attack on one of my opponents: no bonus', () => {
    let s = mpScenario({
      defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: ['Test Fury Banner', { name: 'Test Oath Walker', counters: { loyalty: 3 } }] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider'] } },
    });
    const [a, b] = raiders(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p1' }, { attacker: b!, defender: onBattlefield(s, 'Test Oath Walker', 'p1')[0]! }]);
    expect(power(s, a!)).toBe(1);
    expect(power(s, b!)).toBe(1);
  });
  it('an opponent\'s creature attacking another of my opponents does get it (the Banner\'s controller names the opponents)', () => {
    let s = mpScenario({ defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: ['Test Fury Banner'] }, p2: { battlefield: ['Test Hill Raider'] } } });
    const [a] = raiders(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p3' }]);
    expect(power(s, a!)).toBe(3);
  });
});

describe('CR 603.2c, 506.3, 508.5: "Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain menace until end of turn."', () => {
  it('two creatures attack p2 and one attacks p4: one trigger for each opponent attacked, and each group of attackers gains menace', () => {
    let s = myTurn(['Test Raid Marshal'], ['Test Hill Raider']);
    const [a, b, c] = mine(s);
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }, { attacker: c!, defender: 'p4' }] });
    expect(triggers(s)).toBe(2);
  });
  it('all attackers attack the same opponent: one trigger', () => {
    let s = myTurn(['Test Raid Marshal']);
    const [a, b] = mine(s);
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }] });
    expect(triggers(s)).toBe(1);
  });
  it('the attackers of the triggering opponent gain menace; the creature attacking nobody does not', () => {
    let s = myTurn(['Test Raid Marshal'], ['Test Hill Raider']);
    const [a, b, c] = mine(s);
    s = attackThenResolve(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: onBattlefield(s, 'Test Oath Walker', 'p3')[0]! }]);
    expect(hasMenace(s, a!)).toBe(true);
    expect(hasMenace(s, b!)).toBe(true);
    expect(hasMenace(s, c!)).toBe(false);
  });
  it('negative: an opponent attacking me: no trigger', () => {
    let s = mpScenario({ defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: ['Test Raid Marshal'] }, p2: { battlefield: ['Test Hill Raider'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raiders(s)[0]!, defender: 'p1' }] });
    expect(triggers(s)).toBe(0);
  });
});

describe('CR 508.1, 506.4, 608.2c: "Each opponent attacking that player" is read as the trigger resolves (the Curse of Opulence ruling)', () => {
  it('the only attacker is destroyed with the trigger on the stack: only the Aura\'s controller gains the life', () => {
    let s = mpScenario({
      defs: DEFS, options: { startingPlayer: 'p2' },
      zones: { p1: { battlefield: ['Test Hex of Vigor'], hand: ['Test Quick Smite'] }, p2: { battlefield: ['Test Hill Raider'] } },
      setup: (x) => { x.objects[find(x, 'Test Hex of Vigor', 'battlefield', 'p1')]!.attachedTo = 'p3'; },
    });
    const raider = raiders(s)[0]!;
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender: 'p3' }] });
    for (let i = 0; i < 10 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); i++) s = pass(s);
    s = cast(s, 'Test Quick Smite', { targets: [{ kind: 'object', id: raider }] }, 'p1');
    for (let i = 0; i < 100 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    expect(lives(s)).toEqual([22, 20, 20, 20]);
  });
});
