/**
 * Commander lane edh-combat, round edh-combat-6: the round's cards played through the engine (the real cards of the fixture set, compiled by the game's default compiler) and the
 * round's readings with synthetic cards. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules text of 2026-09-25
 * (fetched from media.wizards.com; rules/cr/ is not in the cloud checkout).
 *
 *   CR 508.1, 506.3, 603.2c, 608.2c    Firemane Commando: "Whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you."
 *   CR 510.2, 603.2c, 122.1f, 506.2    Norn's Decree: a poison counter for the player whose creatures dealt the combat damage; "if one or more players being attacked are poisoned"
 *   CR 509.1b, 802.4, 101.2, 611.2a    Mirri, Weatherlight Duelist: each opponent can't block with more than one creature this combat (counted for each player on their own)
 *   CR 609.4, 702.3b, 508.1b, 500.1    Weathered Sentinels: attack the players who attacked you during their last turn as though it didn't have defender
 *   CR 701.14a, 509.3c, 603.2c         Neyith of the Dire Hunt: one or more creatures you control fight or become blocked (one draw for the event)
 *   CR 603.7, 511.3, 722.3a            Stensian Sanguinist: the target creature dealing combat damage to a player this combat makes it prepared
 *   CR 506.5, 508.1c, 509.1h, 510.1     Master of Cruelties: attacks alone, an unblocked attack on a player sets their life total to 1, and it assigns no combat damage this combat
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, findAll, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: p.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? p.amount : 0 })) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const byName = (s: GameState, name: string, p?: PlayerId): ObjectId[] => (p ? findAll(s, name, 'battlefield', p) : s.zones.battlefield.filter((id) => chars(s, id).name === name));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const poison = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.poison;
const poisoned = (s: GameState, p: PlayerId, n: number): GameState => ({ ...s, players: s.players.map((x) => (x.id === p ? { ...x, poison: n } : x)) });
/** Pass priority (answering decisions) until the next declare-attackers decision. */
function toAttackers(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.result) throw new Error('The game ended');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  }
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
const declare = (s: GameState, attacks: [ObjectId, PlayerId | ObjectId][]): GameState => answer(s, { kind: 'declareAttackers', attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) });
/** Pass until the declare blockers decision (or the end of the turn's combat), resolving what is on the stack. */
function toBlockers(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 80 && s.pending?.kind !== 'declareBlockers'; i++) {
    if (s.turn.step === 'main2') throw new Error('No declare blockers decision came');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  }
  return s;
}
/** Answer every declare blockers decision of the combat: each defending player blocks as `blocks` says (nothing when not listed). */
function blockAs(s0: GameState, blocks: Partial<Record<PlayerId, [ObjectId, ObjectId][]>>): GameState {
  let s = s0;
  while (s.pending?.kind === 'declareBlockers') {
    const who = s.pending.player as PlayerId;
    s = answer(s, { kind: 'declareBlockers', blocks: (blocks[who] ?? []).map(([blocker, attacker]) => ({ blocker, attacker })) });
  }
  return s;
}
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  }
  throw new Error(`Never reached ${what}`);
}

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const WALKER = card('Test Quiet Walker', 'Planeswalker — Test', '', { loyalty: '5' });
const bears = (n: number): { name: string; since: number }[] => Array.from({ length: n }, () => ({ name: 'Test Plain Bear', since: -1 }));

describe('the round\'s cards are automated', () => {
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Firemane Commando', "Norn's Decree", 'Mirri, Weatherlight Duelist', 'Weathered Sentinels', 'Neyith of the Dire Hunt', 'Stensian Sanguinist // Exsanguinate', 'Master of Cruelties'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 508.1, 506.3, 603.2c, 608.2c: Firemane Commando, "Whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you."', () => {
  const start = (active: PlayerId = 'p2'): GameState => mpScenario({
    players: 3, cards: ['Firemane Commando'], defs: [BEAR, WALKER], options: { startingPlayer: active },
    zones: {
      p1: { battlefield: ['Firemane Commando', { name: 'Test Quiet Walker', counters: { loyalty: 5 } } as never, ...bears(2)] },
      p2: { battlefield: bears(3) },
      p3: { battlefield: bears(3) },
    },
  });
  const attackAs = (active: PlayerId, attacks: [number, PlayerId | 'walker'][]): GameState => {
    const s0 = toAttackers(start(active));
    expect(s0.turn.activePlayer).toBe(active);
    const mine = byName(s0, 'Test Plain Bear', active);
    const walker = byName(s0, 'Test Quiet Walker', 'p1')[0]!;
    return resolveAll(declare(s0, attacks.map(([i, d]) => [mine[i]!, d === 'walker' ? walker : d] as [ObjectId, PlayerId | ObjectId])));
  };
  it('two creatures attack the other player: the attacking player draws a card (not you, not the other player)', () => {
    const before = start();
    const s = attackAs('p2', [[0, 'p3'], [1, 'p3']]);
    expect(hand(s, 'p2') - hand(before, 'p2')).toBe(1);
    expect(hand(s, 'p1')).toBe(hand(before, 'p1'));
    expect(hand(s, 'p3')).toBe(hand(before, 'p3'));
  });
  it('negative: two creatures attack YOU: nothing is drawn', () => {
    const before = start();
    const s = attackAs('p2', [[0, 'p1'], [1, 'p1']]);
    expect(hand(s, 'p2')).toBe(hand(before, 'p2'));
  });
  it('negative: one of the attackers attacks you and the other the third player: nothing is drawn (none of THOSE creatures may have attacked you)', () => {
    const before = start();
    const s = attackAs('p2', [[0, 'p1'], [1, 'p3']]);
    expect(hand(s, 'p2')).toBe(hand(before, 'p2'));
  });
  it('negative: a single attacker is not "two or more creatures"', () => {
    const before = start();
    const s = attackAs('p2', [[0, 'p3']]);
    expect(hand(s, 'p2')).toBe(hand(before, 'p2'));
  });
  it('ruling 2023-04-14: attacking a planeswalker you control is not attacking you: they draw', () => {
    const before = start();
    const s = attackAs('p2', [[0, 'walker'], [1, 'walker']]);
    expect(hand(s, 'p2') - hand(before, 'p2')).toBe(1);
  });
  it('one card however many attack, and only the other player\'s attack triggers it (your own attack with two creatures draws you the other ability\'s card, not a second one)', () => {
    const before = start('p1');
    const s = attackAs('p1', [[0, 'p2'], [1, 'p3']]);
    expect(hand(s, 'p1') - hand(before, 'p1')).toBe(1); // "Whenever you attack with two or more creatures, draw a card."
    expect(hand(s, 'p2')).toBe(hand(before, 'p2'));
    expect(hand(s, 'p3')).toBe(hand(before, 'p3'));
  });
  it('three attackers on the third player: still one card', () => {
    const before = start();
    const s = attackAs('p2', [[0, 'p3'], [1, 'p3'], [2, 'p3']]);
    expect(hand(s, 'p2') - hand(before, 'p2')).toBe(1);
  });
});

describe('CR 510.2, 603.2c, 122.1f, 506.2: Norn\'s Decree', () => {
  const start = (active: PlayerId = 'p2', extra: Record<string, unknown[]> = {}): GameState => mpScenario({
    players: 3, cards: ["Norn's Decree"], defs: [BEAR, WALKER], options: { startingPlayer: active },
    zones: {
      p1: { battlefield: ["Norn's Decree", { name: 'Test Quiet Walker', counters: { loyalty: 5 } } as never, ...bears(2)], ...extra },
      p2: { battlefield: bears(3) },
      p3: { battlefield: bears(3) },
    },
  });
  it('combat damage dealt to you by an opponent\'s creatures: that opponent gets one poison counter, once however many creatures', () => {
    let s = toAttackers(start());
    const mine = byName(s, 'Test Plain Bear', 'p2');
    s = declare(s, [[mine[0]!, 'p1'], [mine[1]!, 'p1']]);
    s = runUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    s = resolveAll(s);
    expect(poison(s, 'p2'), 'two creatures dealt damage at once: one counter').toBe(1);
    expect(poison(s, 'p3')).toBe(0);
    expect(poison(s, 'p1')).toBe(0);
  });
  it('negative: damage dealt to ANOTHER player, or blocked damage, gives no counter', () => {
    let s = toAttackers(start());
    const mine = byName(s, 'Test Plain Bear', 'p2');
    s = declare(s, [[mine[0]!, 'p3'], [mine[1]!, 'p1']]);
    s = toBlockers(s);
    s = blockAs(s, { p1: [[byName(s, 'Test Plain Bear', 'p1')[0]!, mine[1]!]] });
    s = runUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    s = resolveAll(s);
    expect(poison(s, 'p2'), 'the creature that attacked you was blocked; the other attacked p3').toBe(0);
  });
  it('"Whenever a player attacks, if one or more players being attacked are poisoned, the attacking player draws a card.": a poisoned defending player makes the attacking player draw', () => {
    const before = start();
    let s = start();
    s = { ...s, players: s.players.map((p) => (p.id === 'p3' ? { ...p, poison: 1 } : p)) };
    s = toAttackers(s);
    const mine = byName(s, 'Test Plain Bear', 'p2');
    s = resolveAll(declare(s, [[mine[0]!, 'p3']]));
    expect(hand(s, 'p2') - hand(before, 'p2')).toBe(1);
  });
  it('negative: nobody attacked is poisoned (the attacker\'s own poison does not count): no card', () => {
    const before = start();
    let s = start();
    s = poisoned(s, 'p2', 3);
    s = toAttackers(s);
    const mine = byName(s, 'Test Plain Bear', 'p2');
    s = resolveAll(declare(s, [[mine[0]!, 'p3']]));
    expect(hand(s, 'p2')).toBe(hand(before, 'p2'));
  });
  it('one of two players attacked is poisoned: one card (not two); the poisoned player only controlling an attacked planeswalker is not "being attacked"', () => {
    const before = start();
    let s = start();
    s = poisoned(s, 'p3', 2);
    s = toAttackers(s);
    const mine = byName(s, 'Test Plain Bear', 'p2');
    s = resolveAll(declare(s, [[mine[0]!, 'p1'], [mine[1]!, 'p3']]));
    expect(hand(s, 'p2') - hand(before, 'p2')).toBe(1);
    // the poisoned player is p1, who controls the planeswalker the creatures attack: p1 is not attacked
    let t = start();
    t = poisoned(t, 'p1', 2);
    t = toAttackers(t);
    const theirs = byName(t, 'Test Plain Bear', 'p2');
    const walker = byName(t, 'Test Quiet Walker', 'p1')[0]!;
    t = resolveAll(declare(t, [[theirs[0]!, walker], [theirs[1]!, 'p3']]));
    expect(hand(t, 'p2')).toBe(hand(before, 'p2'));
  });
});

describe('CR 509.1b, 802.4, 101.2, 611.2a: Mirri, Weatherlight Duelist, "Whenever Mirri attacks, each opponent can\'t block with more than one creature this combat."', () => {
  const FLASH = card('Test Flash Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'], colors: ['G'] });
  const start = (): GameState => mpScenario({
    players: 3, cards: ['Mirri, Weatherlight Duelist'], defs: [BEAR, FLASH], options: { startingPlayer: 'p1' },
    zones: {
      p1: { battlefield: [{ name: 'Mirri, Weatherlight Duelist', since: -1 }, ...bears(2)] },
      p2: { battlefield: bears(3), hand: ['Test Flash Bear'] },
      p3: { battlefield: bears(3) },
    },
  });
  /** p1 attacks p2 with Mirri and one bear, p3 with the other bear; stops at the first declare blockers decision after the trigger resolved. */
  function attacked(): { s: GameState; mirri: ObjectId; a: ObjectId; b: ObjectId } {
    let s = toAttackers(start());
    const mirri = byName(s, 'Mirri, Weatherlight Duelist', 'p1')[0]!;
    const [a, b] = byName(s, 'Test Plain Bear', 'p1') as [ObjectId, ObjectId];
    s = declare(s, [[mirri, 'p2'], [a, 'p2'], [b, 'p3']]);
    s = toBlockers(resolveAll(s));
    return { s, mirri, a, b };
  }
  it('is a resolved restriction on the creatures every opponent controls: more than one blocker of a player is refused, one is fine, and each player is counted on their own', () => {
    const { s, mirri, a, b } = attacked();
    expect(s.pending?.kind).toBe('declareBlockers');
    const p2 = s.pending!.player as PlayerId;
    expect(p2).toBe('p2');
    const [x, y] = byName(s, 'Test Plain Bear', 'p2') as [ObjectId, ObjectId];
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: x, attacker: mirri }, { blocker: y, attacker: a }] }), 'two blockers of one player').toThrow(/No more than 1 of these creatures can block/);
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: x, attacker: mirri }, { blocker: y, attacker: mirri }] }), 'two blockers on one attacker').toThrow(/No more than 1 of these creatures can block/);
    let t = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: x, attacker: mirri }] });
    // the next defending player is p3: one more blocker, although two creatures block in all
    expect(t.pending?.kind).toBe('declareBlockers');
    expect(t.pending!.player).toBe('p3');
    const [u, v] = byName(t, 'Test Plain Bear', 'p3') as [ObjectId, ObjectId];
    expect(() => answer(t, { kind: 'declareBlockers', blocks: [{ blocker: u, attacker: b }, { blocker: v, attacker: b }] }), 'p3 is limited too').toThrow(/No more than 1 of these creatures can block/);
    t = answer(t, { kind: 'declareBlockers', blocks: [{ blocker: u, attacker: b }] });
    expect(t.pending?.kind === 'declareBlockers').toBe(false);
  });
  it('a creature an opponent puts onto the battlefield after the trigger resolved (flash) is limited too: the player still blocks with one creature', () => {
    let s = toAttackers(start());
    const mirri = byName(s, 'Mirri, Weatherlight Duelist', 'p1')[0]!;
    s = declare(s, [[mirri, 'p2']]);
    s = resolveAll(s);
    // priority goes round in the declare attackers step: p2 flashes in a creature once the trigger has resolved
    for (let i = 0; i < 12 && !(s.pending?.kind === 'priority' && s.pending.player === 'p2' && s.zones.stack.length === 0); i++) s = pass(s);
    expect(s.turn.step).toBe('declareAttackers');
    expect(s.pending?.kind === 'priority' && s.pending.player === 'p2').toBe(true);
    const flash = s.zones.hand['p2']!.find((id) => chars(s, id).name === 'Test Flash Bear')!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: flash })));
    s = toBlockers(s);
    const p2s = byName(s, 'Test Plain Bear', 'p2').concat(byName(s, 'Test Flash Bear', 'p2'));
    expect(p2s.length).toBe(4);
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: p2s[0]!, attacker: mirri }, { blocker: p2s[3]!, attacker: mirri }] })).toThrow(/No more than 1 of these creatures can block/);
    expect(answer(s, { kind: 'declareBlockers', blocks: [{ blocker: p2s[3]!, attacker: mirri }] }).pending?.kind).not.toBe('declareBlockers');
  });
  it('the restriction ends with the combat: nothing of it is left in the second main phase', () => {
    const { s } = attacked();
    const t = runUntil(blockAs(s, {}), (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(JSON.stringify(t.continuousEffects)).not.toContain('"perPlayer":true');
  });
  it('"As long as Mirri is tapped, no more than one creature can attack you each combat.": on an opponent\'s turn, two creatures at Mirri\'s controller are refused, two at another player are not', () => {
    let { s } = attacked();
    s = runUntil(blockAs(s, {}), (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'the opponent\'s declare attackers decision');
    const mirri = byName(s, 'Test Plain Bear', 'p1').length > 0 ? byName(s, 'Mirri, Weatherlight Duelist', 'p1')[0]! : '';
    expect(s.objects[mirri]!.tapped, 'Mirri is still tapped from her attack').toBe(true);
    const mine = byName(s, 'Test Plain Bear', 'p2');
    expect(() => declare(s, [[mine[0]!, 'p1'], [mine[1]!, 'p1']]), 'two attackers at Mirri\'s controller').toThrow();
    expect(declare(s, [[mine[0]!, 'p3'], [mine[1]!, 'p3']]).pending?.kind, 'two attackers at the third player').not.toBe('declareAttackers');
    expect(declare(s, [[mine[0]!, 'p1']]).pending?.kind, 'one attacker at Mirri\'s controller').not.toBe('declareAttackers');
  });
});

describe('CR 609.4, 702.3b, 508.1b, 500.1: Weathered Sentinels, "~ can attack players who attacked you during their last turn as though it didn\'t have defender."', () => {
  const start = (): GameState => mpScenario({
    players: 3, cards: ['Weathered Sentinels'], defs: [BEAR, WALKER], options: { startingPlayer: 'p1' },
    zones: {
      p1: { battlefield: [{ name: 'Weathered Sentinels', since: -1 }, { name: 'Test Quiet Walker', counters: { loyalty: 5 } } as never] },
      p2: { battlefield: bears(2) },
      p3: { battlefield: bears(2) },
    },
  });
  const atDeclare = (s: GameState, who: PlayerId): GameState => runUntil(s, (x) => x.turn.activePlayer === who && x.pending?.kind === 'declareAttackers', `the declare attackers decision of ${who}`);
  /** The players Sentinels may be declared as an attacker of, from the declaration decision of p1 (none when it is not offered). */
  const targetsOf = (s: GameState, id: ObjectId): (string)[] => {
    const p = s.pending;
    if (p?.kind !== 'declareAttackers') return [];
    return (p.candidates.find((c) => c.id === id)?.defenders ?? []).filter((d) => s.players.some((x) => x.id === d));
  };
  const history = (att: Partial<Record<PlayerId, PlayerId | 'walker'>>): GameState => {
    let s = start();
    const sentinels = byName(s, 'Weathered Sentinels', 'p1')[0]!;
    s = atDeclare(s, 'p2');
    expect(targetsOf(atDeclare(start(), 'p2'), sentinels), 'it is not offered on another player\'s turn').toEqual([]);
    for (const who of ['p2', 'p3'] as const) {
      s = atDeclare(s, who);
      const target = att[who];
      const walker = byName(s, 'Test Quiet Walker', 'p1')[0]!;
      const mine = byName(s, 'Test Plain Bear', who);
      s = declare(s, target === undefined ? [] : [[mine[0]!, target === 'walker' ? walker : target]]);
    }
    return toP1Combat(s);
  };
  /** p1's declare attackers decision, or (nothing to declare: the creature with defender can't attack) the second main phase. */
  const toP1Combat = (s: GameState): GameState => runUntil(s, (x) => x.turn.activePlayer === 'p1' && (x.pending?.kind === 'declareAttackers' || x.turn.step === 'main2'), 'the combat of p1');
  it('a player who attacked you on their last turn can be attacked by it; one who attacked someone else cannot (and nothing else can: it has defender)', () => {
    const s = history({ p2: 'p1', p3: 'p2' });
    const sentinels = byName(s, 'Weathered Sentinels', 'p1')[0]!;
    expect(s.turn.number).toBe(4);
    expect(targetsOf(s, sentinels)).toEqual(['p2']);
    expect(() => declare(s, [[sentinels, 'p3']]), 'p3 did not attack you').toThrow();
    expect(declare(s, [[sentinels, 'p2']]).pending?.kind, 'p2 did').not.toBe('declareAttackers');
  });
  it('both players attacked you: both can be attacked, either one', () => {
    const s = history({ p2: 'p1', p3: 'p1' });
    const sentinels = byName(s, 'Weathered Sentinels', 'p1')[0]!;
    expect(targetsOf(s, sentinels).sort()).toEqual(['p2', 'p3']);
  });
  it('negative: attacking a planeswalker you control is not attacking you, and neither attacked anyone: nothing is offered (without the permission it has defender)', () => {
    const s = history({ p2: 'walker' });
    const sentinels = byName(s, 'Weathered Sentinels', 'p1')[0]!;
    expect(s.pending?.kind, 'no attacker to declare at all').not.toBe('declareAttackers');
    expect(targetsOf(s, sentinels)).toEqual([]);
  });
  it('"their last turn" is the player\'s own most recent turn, not the turn before this one: p2 attacked you on turn 2; p3 attacks someone else on turn 3; p2 can still be attacked on turn 4, and p3 cannot', () => {
    const s = history({ p2: 'p1', p3: 'p2' });
    const sentinels = byName(s, 'Weathered Sentinels', 'p1')[0]!;
    expect(s.turn.number, 'turn 4: the previous turn was p3\'s').toBe(4);
    expect(targetsOf(s, sentinels)).toContain('p2');
    expect(targetsOf(s, sentinels)).not.toContain('p3');
  });
  it('the history is of the last turn only: a player who attacked you on turn 2 but not on turn 5 cannot be attacked on turn 7', () => {
    let s = history({ p2: 'p1', p3: 'p1' });
    const sentinels = byName(s, 'Weathered Sentinels', 'p1')[0]!;
    // turn 4 (p1) no attack; turn 5 (p2) attacks nobody; turn 6 (p3) attacks p1; turn 7 (p1)
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    s = atDeclare(s, 'p2');
    s = declare(s, []);
    s = atDeclare(s, 'p3');
    s = declare(s, [[byName(s, 'Test Plain Bear', 'p3')[0]!, 'p1']]);
    s = toP1Combat(s);
    expect(s.turn.number).toBe(7);
    expect(targetsOf(s, sentinels)).toEqual(['p3']);
  });
});

describe('CR 701.14a, 509.3c, 603.2c: Neyith of the Dire Hunt, "Whenever one or more creatures you control fight or become blocked, draw a card."', () => {
  const DUEL = card('Test Duel Sorcery', 'Sorcery', "Target creature you control fights target creature you don't control.");
  const BRAWL = card('Test Brawl Sorcery', 'Sorcery', 'Target creature fights another target creature.');
  const start = (): GameState => mpScenario({
    players: 3, cards: ['Neyith of the Dire Hunt'], defs: [BEAR, DUEL, BRAWL], options: { startingPlayer: 'p1' },
    zones: {
      p1: { battlefield: ['Neyith of the Dire Hunt', ...bears(2)], hand: ['Test Duel Sorcery', 'Test Brawl Sorcery'] },
      p2: { battlefield: bears(2) },
      p3: { battlefield: bears(1) },
    },
  });
  const cast = (s: GameState, name: string, player: PlayerId, targets: ObjectId[]): GameState => {
    const id = s.zones.hand[player]!.find((x) => chars(s, x).name === name)!;
    return resolveAll(drive(act(s, { type: 'cast', player, card: id }), { targets }));
  };
  it('is understood: the synthetic fight spells play fully', () => {
    expect(noManual(DUEL)).toBe(true);
    expect(noManual(BRAWL)).toBe(true);
  });
  it('a creature you control fights: one card for you', () => {
    const s0 = start();
    const [mine] = byName(s0, 'Test Plain Bear', 'p1') as [ObjectId];
    const [theirs] = byName(s0, 'Test Plain Bear', 'p2') as [ObjectId];
    const s = cast(s0, 'Test Duel Sorcery', 'p1', [mine, theirs]);
    expect(hand(s, 'p1') - (hand(s0, 'p1') - 1), 'one card for the fight').toBe(1);
  });
  it('two creatures you control fight each other: still one card (one event, one trigger)', () => {
    const s0 = start();
    const [a, b] = byName(s0, 'Test Plain Bear', 'p1') as [ObjectId, ObjectId];
    const s = cast(s0, 'Test Brawl Sorcery', 'p1', [a, b]);
    expect(hand(s, 'p1') - (hand(s0, 'p1') - 1)).toBe(1);
  });
  it('negative: two creatures an opponent controls fight each other: nothing for you', () => {
    let s0 = start();
    s0 = { ...s0, turn: { ...s0.turn } };
    const [a, b] = byName(s0, 'Test Plain Bear', 'p2') as [ObjectId, ObjectId];
    const s = cast(s0, 'Test Brawl Sorcery', 'p1', [a, b]);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1);
  });
  it('negative: combat damage is not fighting (ruling 2020-06-23), and an unblocked attacker is not blocked', () => {
    const o = { yes: false, targets: Array<ObjectId>(8).fill(byName(start(), 'Test Plain Bear', 'p2')[0]!) };
    let s = toAttackers(start(), o);
    const mine = byName(s, 'Test Plain Bear', 'p1');
    const before = hand(s, 'p1');
    s = declare(s, [[mine[0]!, 'p3']]);
    s = blockAs(toBlockers(resolveAll(s, o), o), {});
    s = runUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 400, o);
    expect(hand(resolveAll(s, o), 'p1')).toBe(before);
  });
  it('creatures you control become blocked: one card however many are blocked, none for the blockers', () => {
    const o = { yes: false, targets: Array<ObjectId>(8).fill(byName(start(), 'Test Plain Bear', 'p3')[0]!) };
    let s = toAttackers(start(), o);
    const mine = byName(s, 'Test Plain Bear', 'p1');
    const before = hand(s, 'p1');
    s = declare(s, [[mine[0]!, 'p2'], [mine[1]!, 'p2']]);
    s = toBlockers(resolveAll(s, o), o);
    const theirs = byName(s, 'Test Plain Bear', 'p2');
    s = blockAs(s, { p2: [[theirs[0]!, mine[0]!], [theirs[1]!, mine[1]!]] });
    s = resolveAll(s, o);
    expect(hand(s, 'p1') - before, 'two attackers blocked at once').toBe(1);
  });
});

describe('CR 603.7, 511.3, 722.3a: Stensian Sanguinist, "Whenever you attack, target creature gains deathtouch until end of turn. Whenever that creature deals combat damage to a player this combat, this creature becomes prepared."', () => {
  const NAME = 'Stensian Sanguinist // Exsanguinate';
  const start = (): GameState => mpScenario({
    players: 3, cards: [NAME], defs: [BEAR], options: { startingPlayer: 'p1' },
    zones: { p1: { battlefield: [{ name: NAME, since: -1 }, ...bears(2)] }, p2: { battlefield: bears(2) }, p3: { battlefield: bears(1) } },
  });
  const sang = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === NAME)!;
  /** p1 attacks with both bears (one at p2, one at p3), the trigger targets `target(bears)`; blockers as given; runs to the second main phase. */
  function play(target: (b: ObjectId[]) => ObjectId, blocks: (s: GameState, b: ObjectId[]) => Partial<Record<PlayerId, [ObjectId, ObjectId][]>> = () => ({})): GameState {
    const s0 = start();
    const b = byName(s0, 'Test Plain Bear', 'p1');
    const o = { targets: Array<ObjectId>(6).fill(target(b)) };
    let s = toAttackers(s0, o);
    s = declare(s, [[b[0]!, 'p2'], [b[1]!, 'p3']]);
    s = toBlockers(resolveAll(s, o), o);
    s = blockAs(s, blocks(s, b));
    return resolveAll(runUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 400, o), o);
  }
  it('the creature it targeted deals combat damage to a player this combat: Sanguinist becomes prepared (and the target had deathtouch)', () => {
    const s = play((b) => b[0]!);
    expect(s.objects[sang(s)]!.prepared).toBe(true);
    expect(s.zones.exile.filter((id) => s.objects[id]!.kind === 'spellCopy'), 'a copy of its prepare spell waits in exile (ruling 2026-03-20)').toHaveLength(1);
  });
  it('negative: the targeted creature is blocked (it deals its damage to a creature): not prepared', () => {
    const s = play((b) => b[0]!, (x, b) => ({ p2: [[byName(x, 'Test Plain Bear', 'p2')[0]!, b[0]!]] }));
    expect(s.objects[sang(s)]!.prepared).toBeUndefined();
  });
  it('negative: another attacker (not the target) deals the combat damage: not prepared', () => {
    const s0 = start();
    const b = byName(s0, 'Test Plain Bear', 'p1');
    const sg = sang(s0);
    const o = { targets: Array<ObjectId>(6).fill(sg) };
    let s = toAttackers(s0, o);
    s = declare(s, [[b[0]!, 'p2'], [b[1]!, 'p3']]);
    s = toBlockers(resolveAll(s, o), o);
    s = blockAs(s, {});
    s = resolveAll(runUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 400, o), o);
    expect(s.objects[sang(s)]!.prepared, 'the target (Sanguinist itself) did not attack').toBeUndefined();
  });
  it('"this combat": damage a creature deals in a later combat of the turn does not prepare it (the delayed trigger ended with the first combat)', () => {
    // the delayed trigger is gone from the state once the combat ends
    const s = play((b) => b[0]!);
    expect(JSON.stringify(s.delayedTriggers)).not.toContain('"endOfCombat"');
  });
});

const FORCE = card('Test Banner Order', 'Enchantment', 'Creatures you control attack each combat if able.');
describe('CR 506.5, 508.1c, 509.1h, 510.1: Master of Cruelties, "This creature can only attack alone. Whenever this creature attacks a player and isn\'t blocked, that player\'s life total becomes 1. This creature assigns no combat damage this combat."', () => {
  const NAME = 'Master of Cruelties';
  const start = (forced = false): GameState => mpScenario({
    players: 3, cards: [NAME], defs: [BEAR, WALKER, FORCE], options: { startingPlayer: 'p1' },
    zones: {
      p1: { battlefield: [{ name: NAME, since: -1 }, ...bears(1), ...(forced ? ['Test Banner Order'] : [])] },
      p2: { battlefield: [...bears(1), { name: 'Test Quiet Walker', counters: { loyalty: 5 } } as never] },
      p3: { battlefield: bears(1) },
    },
  });
  const master = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === NAME)!;
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const toMain2 = (s: GameState): GameState => resolveAll(runUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase'));
  it('is offered alone only: with another attacker the declaration is refused, alone (or the other alone) it is fine', () => {
    const s = toAttackers(start());
    const bear = byName(s, 'Test Plain Bear', 'p1')[0]!;
    const cand = s.pending?.kind === 'declareAttackers' ? s.pending.candidates.find((c) => c.id === master(s)) : undefined;
    expect(cand?.onlyAlone, 'the candidate says it can only attack alone').toBe(true);
    expect(() => declare(s, [[master(s), 'p2'], [bear, 'p2']])).toThrow(/can only attack alone/);
    expect(declare(s, [[master(s), 'p2']]).pending?.kind).not.toBe('declareAttackers');
    expect(declare(s, [[bear, 'p2']]).pending?.kind).not.toBe('declareAttackers');
  });
  it('review fix: when every creature must attack, a declaration of Master with the bear is still refused and the lone Master (or the lone bear) is accepted', () => {
    const s = toAttackers(start(true));
    const bear = byName(s, 'Test Plain Bear', 'p1')[0]!;
    expect(() => declare(s, [[master(s), 'p2'], [bear, 'p2']])).toThrow(/can only attack alone/);
    expect(declare(s, [[bear, 'p2']]).pending?.kind, 'the bear alone obeys its own requirement').not.toBe('declareAttackers');
    expect(declare(s, [[master(s), 'p2']]).pending?.kind).not.toBe('declareAttackers');
  });
  it('unblocked on a player: that player\'s life total becomes 1 (the one attacked, not the others), and it deals no combat damage', () => {
    let s = toAttackers(start());
    s = declare(s, [[master(s), 'p3']]);
    s = resolveAll(s);
    s = blockAs(toBlockers(s), {});
    s = toMain2(s);
    expect(lifeOf(s, 'p3'), 'life total 1: it lost 19 life, and the damage it would have dealt was not assigned').toBe(1);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.result, 'the player did not lose the game (one point of damage would have)').toBeNull();
    expect(JSON.stringify(s.continuousEffects), 'the rule ended with the combat').not.toContain('assignsNoCombatDamage');
  });
  it('negative: blocked, the last ability does not trigger and Master deals its combat damage to the blocker', () => {
    let s = toAttackers(start());
    const m = master(s);
    s = declare(s, [[m, 'p2']]);
    s = toBlockers(resolveAll(s));
    const blocker = byName(s, 'Test Plain Bear', 'p2')[0]!;
    s = blockAs(s, { p2: [[blocker, m]] });
    s = toMain2(s);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.battlefield.includes(blocker), 'the blocker died to its damage').toBe(false);
  });
  it('ruling 2024-01-12: attacking a planeswalker, it does not trigger: the player\'s life stays, the planeswalker takes the damage', () => {
    let s = toAttackers(start());
    const walker = byName(s, 'Test Quiet Walker', 'p2')[0]!;
    s = declare(s, [[master(s), walker]]);
    s = blockAs(toBlockers(resolveAll(s)), {});
    s = toMain2(s);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.objects[walker]!.counters['loyalty'], 'the planeswalker (5 loyalty) took its 1 damage').toBe(4);
  });
  it('the rule lasts this combat only: in a later combat, blocked, it deals its combat damage again (deathtouch kills the blocker)', () => {
    let s = toAttackers(start());
    s = declare(s, [[master(s), 'p3']]);
    s = blockAs(toBlockers(resolveAll(s)), {});
    s = toMain2(s);
    expect(lifeOf(s, 'p3')).toBe(1);
    s = runUntil(s, (x) => x.turn.number >= 4 && x.turn.activePlayer === 'p1' && x.pending?.kind === 'declareAttackers', 'the next declare attackers decision of p1');
    s = declare(s, [[master(s), 'p2']]);
    s = toBlockers(resolveAll(s));
    const blocker = byName(s, 'Test Plain Bear', 'p2')[0]!;
    s = toMain2(blockAs(s, { p2: [[blocker, master(s)]] }));
    expect(s.zones.battlefield.includes(blocker), 'the blocker died: damage was assigned this combat').toBe(false);
  });
});
