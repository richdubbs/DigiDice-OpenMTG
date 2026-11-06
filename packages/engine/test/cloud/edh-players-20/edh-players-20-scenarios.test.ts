/**
 * edh-players-20 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 506.2, 508.1b, 603.2c        "Whenever an opponent attacks another one of your opponents, you and the attacking player each draw a card and lose 1 life.": once for each opponent attacked
 *   CR 510.2, 603.2c, 109.4         "Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card."
 *   CR 119.3, 120.3a, 603.2c        "Whenever one or more opponents each lose exactly 1 life, draw a card.": the total each opponent lost, one trigger for the batch
 *   CR 608.2h, 903.3, 121.2         "You may sacrifice another creature. If you do, draw two cards, then draw another card if the sacrificed creature was a commander."
 *   CR 611.2a, 608.2c               "Choose any number of target creatures. Each of those creatures gains haste until end of turn."
 *   CR 121.1, 109.2, 201.5          "you may draw a card for each other creature you control that shares a creature type with it"
 *   CR 508.1f, 603.4                "Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, pass, passUntil } from '../../m12/rules/helpers';
import { legend } from '../../m11/rules/helpers';
import { commanderOptions } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: '{0}', oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const EYE = card('Test Watching Eye', 'Creature — Beholder', 'Whenever an opponent attacks another one of your opponents, you and the attacking player each draw a card and lose 1 life.', ['1', '1']);
const ACCUSER = card('Test Quick Accuser', 'Creature — Human', 'Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card.', ['1', '1']);
const RAIDER = card('Test Hill Raider', 'Creature — Goblin', '', ['1', '1']);
const DRAINER = card('Test Thin Drainer', 'Creature — Demon', 'Whenever one or more opponents each lose exactly 1 life, draw a card.', ['1', '1']);
const PING = card('Test Quiet Ping', 'Instant', 'Target opponent loses 1 life.');
const PINGS = card('Test Rolling Ping', 'Instant', 'Each opponent loses 1 life.');
const MIXED = card('Test Uneven Ping', 'Instant', 'Target opponent loses 1 life. Target opponent loses 2 life.');
const TWICE = card('Test Twin Ping', 'Instant', 'Target opponent loses 1 life. Target opponent loses 1 life.');
const DEFS = [EYE, ACCUSER, RAIDER, DRAINER, PING, PINGS, MIXED, TWICE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

const onBattlefield = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

/** A four-player game on p2's turn 1: p1 controls `watcher`, p2 has two raiders. */
function game(watcher: string): GameState {
  return mpScenario({ defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: [watcher] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider'] } } });
}
function settle(s0: GameState, until: (s: GameState) => boolean = () => false): GameState {
  let s = s0;
  for (let i = 0; i < 100 && (s.zones.stack.length > 0 || s.pending?.kind === 'order') && !until(s); i++) {
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${s.pending?.kind}`);
  }
  return s;
}
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  return settle(s);
}
const raiders = (s: GameState): ObjectId[] => onBattlefield(s, 'Test Hill Raider', 'p2');

describe('CR 506.2, 508.1b, 603.2c: "Whenever an opponent attacks another one of your opponents, you and the attacking player each draw a card and lose 1 life."', () => {
  it('p2 attacks p3 with two creatures: one trigger; p1 and p2 each draw a card and lose 1 life, p3 and p4 nothing', () => {
    const s0 = game('Test Watching Eye');
    const h = [1, 2, 3, 4].map((n) => hand(s0, `p${n}` as PlayerId));
    const s = attack(s0, [{ attacker: raiders(s0)[0]!, defender: 'p3' }, { attacker: raiders(s0)[1]!, defender: 'p3' }]);
    expect([1, 2, 3, 4].map((n) => hand(s, `p${n}` as PlayerId) - h[n - 1]!)).toEqual([1, 1, 0, 0]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([19, 19, 20, 20]);
  });
  it('p2 attacks p3 and p4: one trigger for each opponent attacked, so p1 and p2 draw twice and lose 2', () => {
    const s0 = game('Test Watching Eye');
    const h1 = hand(s0, 'p1');
    const s = attack(s0, [{ attacker: raiders(s0)[0]!, defender: 'p3' }, { attacker: raiders(s0)[1]!, defender: 'p4' }]);
    expect(hand(s, 'p1') - h1).toBe(2);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([18, 18]);
  });
  it('negative: p2 attacks p1 (the controller, not "another one of your opponents"): no trigger', () => {
    const s0 = game('Test Watching Eye');
    const h1 = hand(s0, 'p1');
    const s = attack(s0, [{ attacker: raiders(s0)[0]!, defender: 'p1' }]);
    expect(hand(s, 'p1')).toBe(h1);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: the controller attacking an opponent is not an opponent attacking: no trigger', () => {
    const s0 = mpScenario({ defs: DEFS, options: { startingPlayer: 'p1' }, zones: { p1: { battlefield: ['Test Watching Eye', 'Test Hill Raider'] } } });
    const h1 = hand(s0, 'p1');
    const s = attack(s0, [{ attacker: onBattlefield(s0, 'Test Hill Raider', 'p1')[0]!, defender: 'p2' }]);
    expect(hand(s, 'p1')).toBe(h1);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 510.2, 603.2c, 109.4: "Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card."', () => {
  const toDamage = (s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): GameState => {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks });
    s = passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'combatDamage' || x.turn.step === 'end', 'the damage');
    return settle(s);
  };
  it("p2's two raiders hit p3 and p4: one trigger; p1 and p2 each draw one card", () => {
    const s0 = game('Test Quick Accuser');
    const h = [1, 2, 3, 4].map((n) => hand(s0, `p${n}` as PlayerId));
    const s = toDamage(s0, [{ attacker: raiders(s0)[0]!, defender: 'p3' }, { attacker: raiders(s0)[1]!, defender: 'p4' }]);
    expect(lifeOf(s, 'p3')).toBe(19);
    expect([1, 2, 3, 4].map((n) => hand(s, `p${n}` as PlayerId) - h[n - 1]!)).toEqual([1, 1, 0, 0]);
  });
  it('negative: damage to the controller itself is not damage to "your opponents": no trigger', () => {
    const s0 = game('Test Quick Accuser');
    const h = [1, 2].map((n) => hand(s0, `p${n}` as PlayerId));
    const s = toDamage(s0, [{ attacker: raiders(s0)[0]!, defender: 'p1' }]);
    expect(lifeOf(s, 'p1')).toBe(19);
    expect([1, 2].map((n) => hand(s, `p${n}` as PlayerId) - h[n - 1]!)).toEqual([0, 0]);
  });
});


describe('CR 119.3, 603.2c: "Whenever one or more opponents each lose exactly 1 life, draw a card."', () => {
  const setup = (spell: string): GameState => mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Thin Drainer'], hand: [spell] } } });
  const castIt = (s0: GameState, spell: string, targets: PlayerId[] = []): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') });
    for (let i = 0; i < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: targets.shift() ?? 'p2' }] as never });
      else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${s.pending?.kind}`);
    }
    return s;
  };
  it('exactly 1 life lost by one opponent: one trigger, one card', () => {
    const s0 = setup('Test Quiet Ping');
    const s = castIt(s0, 'Test Quiet Ping');
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1 + 1);
  });
  it('every opponent loses exactly 1 at once: still ONE trigger for the whole batch (CR 603.2c)', () => {
    const s0 = setup('Test Rolling Ping');
    const s = castIt(s0, 'Test Rolling Ping');
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([19, 19, 19]);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1 + 1);
  });
  it('review: two separate losses of 1 life in one resolution are not added up into 2 (CR 608.2c): the trigger still happens (known limit: once for the resolution, not once for each)', () => {
    const s0 = setup('Test Twin Ping');
    const s = castIt(s0, 'Test Twin Ping', ['p2', 'p2']);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(hand(s, 'p1')).toBeGreaterThanOrEqual(hand(s0, 'p1'));
  });
  it('negative: losing 2 life is not exactly 1', () => {
    const s0 = mpScenario({ defs: [...DEFS, card('Test Heavy Ping', 'Instant', 'Target opponent loses 2 life.')], zones: { p1: { battlefield: ['Test Thin Drainer'], hand: ['Test Heavy Ping'] } } });
    const s = castIt(s0, 'Test Heavy Ping');
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1);
  });
  it('negative: three creatures dealing 1 combat damage each to one opponent at once are 3 life lost (the ruling): no trigger', () => {
    const s0 = mpScenario({ defs: DEFS, options: { startingPlayer: 'p1' }, zones: { p1: { battlefield: ['Test Thin Drainer', 'Test Hill Raider', 'Test Hill Raider', 'Test Hill Raider'] } } });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: onBattlefield(s0, 'Test Hill Raider', 'p1').map((id) => ({ attacker: id, defender: 'p2' as PlayerId })) });
    s = passUntil(s, (x) => x.turn.step === 'combatDamage' || x.turn.step === 'end', 'the damage');
    s = settle(s);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1'));
  });
  it('a lone creature dealing 1 combat damage: exactly 1 life lost, one trigger', () => {
    const s0 = mpScenario({ defs: DEFS, options: { startingPlayer: 'p1' }, zones: { p1: { battlefield: ['Test Thin Drainer', 'Test Hill Raider'] } } });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onBattlefield(s0, 'Test Hill Raider', 'p1')[0]!, defender: 'p2' as PlayerId }] });
    s = passUntil(s, (x) => x.turn.step === 'combatDamage' || x.turn.step === 'end', 'the damage');
    s = settle(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') + 1);
  });
});


// ---- the sacrificed permanent was a commander ----------------------------------------------------------------------------------------------------------------------

const ALTAR = card('Test Grim Altar', 'Artifact', '{0}: You may sacrifice a creature. If you do, draw two cards, then draw another card if the sacrificed creature was a commander.');
describe('CR 608.2h, 903.3, 121.2: "If you do, draw two cards, then draw another card if the sacrificed creature was a commander."', () => {
  it('is automated', () => expect(ALTAR.automation.level).toBe('full'));
  const CAPTAIN = legend('Test Captain', '{1}{W}', ['3', '3'], ['W']);
  const game = (): GameState => mpScenario({
    players: 4, defs: [ALTAR, RAIDER, CAPTAIN, legend('Test Beta', '{1}{W}', ['3', '3'], ['W']), legend('Test Gamma', '{1}{W}', ['3', '3'], ['W']), legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])],
    commanders: { p1: [CAPTAIN], p2: [legend('Test Beta', '{1}{W}', ['3', '3'], ['W'])], p3: [legend('Test Gamma', '{1}{W}', ['3', '3'], ['W'])], p4: [legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])] },
    options: { commander: commanderOptions('commander') },
    zones: { p1: { battlefield: ['Test Grim Altar', 'Test Hill Raider'] } },
    setup: (x) => {
      const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Test Captain')!;
      x.zones.command = x.zones.command.filter((o) => o !== id);
      x.zones.battlefield.push(id);
      x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
    },
  });
  const sacrifice = (victim: string): { before: number; after: number } => {
    const s0 = game();
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Grim Altar', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let i = 0; i < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      const d = s.pending;
      if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === victim && s.objects[id]!.controller === 'p1')!] });
      else if (d?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d?.kind === 'commanderZone') s = answer(s, { kind: 'commanderZone', command: false });
      else if (d?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d?.kind}`);
    }
    return { before: s0.zones.hand['p1']!.length, after: s.zones.hand['p1']!.length };
  };
  it('sacrificing a commander you own draws three cards', () => {
    const r = sacrifice('Test Captain');
    expect(r.after - r.before).toBe(3);
  });
  it('negative: sacrificing an ordinary creature draws only two', () => {
    const r = sacrifice('Test Hill Raider');
    expect(r.after - r.before).toBe(2);
  });
});

// ---- Choose any number of target creatures. Each of those creatures gains ... ----------------------------------------------------------------------------------------

const CAULDRON = card('Test Brew Pot', 'Artifact', '{T}: Choose any number of target creatures. Each of those creatures gains haste until end of turn.');
describe('CR 611.2a, 608.2c: "Choose any number of target creatures. Each of those creatures gains haste until end of turn."', () => {
  const hasHaste = (s: GameState, id: ObjectId): boolean => (getChars(s, id)!.abilities ?? []).some((a) => JSON.stringify(a).includes('haste'));
  it('is automated', () => expect(CAULDRON.automation.level).toBe('full'));
  it('every chosen creature gains haste, an unchosen one does not', () => {
    const s0 = mpScenario({ defs: [CAULDRON, RAIDER], zones: { p1: { battlefield: ['Test Brew Pot', 'Test Hill Raider', 'Test Hill Raider', 'Test Hill Raider'] } } });
    const [a, b, c] = onBattlefield(s0, 'Test Hill Raider', 'p1');
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Brew Pot', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let i = 0; i < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      const d = s.pending;
      if (d?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: a! }, { kind: 'object', id: b! }] as never });
      else if (d?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d?.kind}`);
    }
    expect([hasHaste(s, a!), hasHaste(s, b!), hasHaste(s, c!)]).toEqual([true, true, false]);
  });
});

// ---- the pronoun in the count of a draw ----------------------------------------------------------------------------------------------------------------------------

const TITAN = card('Test Kindred Giant', 'Creature — Giant Warrior', 'Whenever ~ attacks, you may draw a card for each other creature you control that shares a creature type with it. If you do, discard a card.', ['2', '2']);
const KIN = card('Test Giant Kin', 'Creature — Giant', '', ['1', '1']);
const STRANGER = card('Test Plain Stranger', 'Creature — Elf', '', ['1', '1']);
describe('CR 121.1, 109.2, 201.5: "you may draw a card for each other creature you control that shares a creature type with it"', () => {
  it('is automated', () => expect(TITAN.automation.level).toBe('full'));
  it('draws for each OTHER creature of yours sharing a type (not itself, not an Elf), then discards a card', () => {
    const s0 = mpScenario({ defs: [TITAN, KIN, STRANGER], options: { startingPlayer: 'p1' }, zones: { p1: { battlefield: ['Test Kindred Giant', 'Test Giant Kin', 'Test Giant Kin', 'Test Plain Stranger'] } } });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s0, 'Test Kindred Giant', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    for (let i = 0; i < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      const d = s.pending;
      if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: ObjectId[] }).options.slice(0, 1) });
      else if (d?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d?.kind}`);
    }
    expect(hand(s, 'p1') - hand(s0, 'p1')).toBe(2 - 1); // two Giants drawn, one card discarded
  });
});


// ---- becomes tapped, if it isn't being declared as an attacker ----------------------------------------------------------------------------------------------------------

const CIRCLE = card('Test Quiet Ring', 'Enchantment', "Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card.");
const TAPPER = card('Test Cold Touch', 'Instant', 'Tap target creature.');
describe("CR 508.1f, 603.4: \"Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card.\"", () => {
  it('is automated', () => expect(CIRCLE.automation.level).toBe('full'));
  const run = (s0: GameState, until: (s: GameState) => boolean): GameState => {
    let s = s0;
    for (let i = 0; i < 60 && !until(s); i++) {
      const d = s.pending;
      if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d?.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
      else if (d?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d?.kind}`);
    }
    return s;
  };
  it("p2's creature declared as an attacker becomes tapped by the declaration: no trigger", () => {
    const s0 = mpScenario({ defs: [CIRCLE, RAIDER], options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: ['Test Quiet Ring'] }, p2: { battlefield: ['Test Hill Raider'] } } });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onBattlefield(s0, 'Test Hill Raider', 'p2')[0]!, defender: 'p1' as PlayerId }] });
    expect(s.zones.stack.length).toBe(0);
    expect(s.objects[onBattlefield(s, 'Test Hill Raider', 'p2')[0]!]!.tapped).toBe(true);
    expect(hand(settle(s), 'p1')).toBe(hand(s0, 'p1'));
  });
  it("a spell that taps p2's creature outside the declaration triggers it: p1 may draw", () => {
    const s0 = mpScenario({ defs: [CIRCLE, RAIDER, TAPPER], zones: { p1: { battlefield: ['Test Quiet Ring'], hand: ['Test Cold Touch'] }, p2: { battlefield: ['Test Hill Raider'] } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cold Touch', 'hand', 'p1') });
    s = run(s, (x) => x.pending?.kind === 'chooseTargets') ;
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: onBattlefield(s0, 'Test Hill Raider', 'p2')[0]! }] as never });
    s = run(s, (x) => x.pending?.kind === 'priority' && x.zones.stack.length === 0);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1 + 1);
  });
  it("negative: p1's own creature becoming tapped is not an opponent's creature: no trigger", () => {
    const s0 = mpScenario({ defs: [CIRCLE, RAIDER, TAPPER], zones: { p1: { battlefield: ['Test Quiet Ring', 'Test Hill Raider'], hand: ['Test Cold Touch'] } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cold Touch', 'hand', 'p1') });
    s = run(s, (x) => x.pending?.kind === 'chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: onBattlefield(s0, 'Test Hill Raider', 'p1')[0]! }] as never });
    s = run(s, (x) => x.pending?.kind === 'priority' && x.zones.stack.length === 0);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1);
  });
});
