/**
 * Commander lane edh-c, round edh-c-57 (EDHREC ranks 21,501-22,000, second pass): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 614.1a, 120.3, 611.3a     "As long as you have no cards in hand, if a source you control would deal damage to a permanent or player, it deals double that damage ... instead."
 *   CR 615.1a, 615.7, 611.3a     "As long as ~ is untapped, if a creature would deal combat damage to you, prevent 1 of that damage."
 *   CR 101.4, 118.12             "Any player may sacrifice a land of their choice. If a player does, put ~ on top of its owner's library." / "... exile a card from their graveyard ..."
 *   CR 118.12a, 122.1            "return ~ to its owner's hand unless you remove two oil counters from it."
 *   CR 604.1, 611.3a, 613.1f     "~ has trample as long as it has two or fewer oil counters on it. Otherwise, it has hexproof."
 *   CR 609.4, 702.3b, 508.1b     "Enchanted Wall can attack as though it didn't have defender."
 *   CR 404.1, 401.1              "Then you may put an instant, sorcery, or battle card from your graveyard on top of your library."
 *   CR 702.37a, 701.40           "you may turn target creature with a morph ability face down."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

interface Opts { targets?: (ObjectId | PlayerId)[]; yes?: boolean[]; objects?: ObjectId[][] }
/** Answer the decisions that come up until priority (payments automatic; yes/no from `yes`, then yes; objects from `objects`, then the first allowed). */
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  const yes = [...(o.yes ?? [])];
  const objects = [...(o.objects ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => (id.startsWith('p') && id.length <= 3 ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) as never });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.length > 0 ? objects.shift()! : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes.length > 0 ? yes.shift()! : true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: p.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? p.amount : 0 })) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const byName = (s: GameState, name: string, p?: PlayerId): ObjectId[] => (p ? findAll(s, name, 'battlefield', p) : s.zones.battlefield.filter((id) => chars(s, id).name === name));
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const kws = (s: GameState, id: ObjectId): string[] => chars(s, id).keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const activate = (s0: GameState, source: ObjectId, o: Opts = {}, player: PlayerId = 'p1'): GameState => resolveAll(act(s0, { type: 'activate', player, source, ability: 'p:0:0' } as never), o);
const castFrom = (s0: GameState, name: string, o: Opts = {}, player: PlayerId = 'p1'): GameState => resolveAll(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), o);
/** The player's hand emptied (the active player of turn 1 has drawn a card by main phase). */
const emptyHand = (s: GameState, p: PlayerId): GameState => { const t = structuredClone(s); for (const id of t.zones.hand[p]!) delete t.objects[id]; t.zones.hand[p] = []; return t; };
const tapIt = (s: GameState, id: ObjectId): GameState => { const t = structuredClone(s); t.objects[id]!.tapped = true; return t; };
const declare = (s: GameState, attacks: [ObjectId, PlayerId | ObjectId][]): GameState => answer(s, { kind: 'declareAttackers', attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) });
function toAttackers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  throw new Error(`Never reached ${what}`);
}
const toTurn = (s: GameState, n: number): GameState => runUntil(s, (x) => x.turn.number >= n && x.turn.step === 'main1' && x.pending?.kind === 'priority', `turn ${n}`);

const PINGER = card('Test Pinger', 'Artifact Creature — Construct', '{T}: ~ deals 1 damage to target player.', { pt: ['1', '1'] });
const HELLBENT = card('Test Hellbent', 'Enchantment', 'As long as you have no cards in hand, if a source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.');
const STAFF = card('Test Staff', 'Artifact', 'As long as ~ is untapped, if a creature would deal combat damage to you, prevent 1 of that damage.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');

describe('the round\'s real cards are automated', () => {
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Anthem of Rakdos', 'Thunderstaff', 'Carrion Rats', 'Argothian Wurm', 'Magmatic Sprinter', 'Evolved Spinoderm', 'Animate Wall', 'Halo-Charged Skaab', 'Master of the Veil'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 614.1a, 120.3, 611.3a: "As long as you have no cards in hand, if a source you control would deal damage to a permanent or player, it deals double that damage ... instead."', () => {
  const game = (keep: string[]) => {
    const s = mpScenario({ players: 3, defs: [PINGER, HELLBENT, FILLER], zones: { p1: { battlefield: [{ name: 'Test Pinger', since: -1 } as never, 'Test Hellbent'], hand: keep }, p2: { battlefield: [{ name: 'Test Pinger', since: -1 } as never] } } });
    return keep.length === 0 ? emptyHand(s, 'p1') : s;
  };
  it('with an empty hand a source you control deals double damage to a player; the damage of another player\'s source is not doubled', () => {
    const s0 = game([]);
    expect(hand(s0, 'p1')).toBe(0);
    const s = activate(s0, byName(s0, 'Test Pinger', 'p1')[0]!, { targets: ['p3'] });
    expect(life(s, 'p3')).toBe(18);
    const u0 = emptyHand(mpScenario({ players: 3, options: { startingPlayer: 'p2' }, defs: [PINGER, HELLBENT, FILLER], zones: { p1: { battlefield: ['Test Hellbent'] }, p2: { battlefield: [{ name: 'Test Pinger', since: -1 } as never] } } }), 'p1');
    const u = activate(u0, byName(u0, 'Test Pinger', 'p2')[0]!, { targets: ['p3'] }, 'p2');
    expect(life(u, 'p3')).toBe(19);
  });
  it('negative: with a card in hand (the condition is false) the damage is dealt as it is', () => {
    const s0 = emptyHand(game(['Test Filler']), 'p1');
    const s1 = (() => { const t = mpScenario({ players: 3, defs: [PINGER, HELLBENT, FILLER], zones: { p1: { battlefield: [{ name: 'Test Pinger', since: -1 } as never, 'Test Hellbent'], hand: ['Test Filler'] }, p2: {} } }); return t; })();
    expect(hand(s1, 'p1')).toBeGreaterThan(0);
    const s = activate(s1, byName(s1, 'Test Pinger', 'p1')[0]!, { targets: ['p3'] });
    expect(life(s, 'p3')).toBe(19);
    expect(hand(s0, 'p1')).toBe(0);
  });
  it('the condition is read as the damage would be dealt: casting the last card in hand turns it on', () => {
    const s0 = mpScenario({ players: 3, defs: [PINGER, HELLBENT, FILLER], zones: { p1: { battlefield: [{ name: 'Test Pinger', since: -1 } as never, 'Test Hellbent'], hand: ['Test Filler'] } } });
    const one = structuredClone(s0);
    for (const id of one.zones.hand.p1!.filter((x) => one.objects[x]!.defId !== 'Test Filler')) delete one.objects[id];
    one.zones.hand.p1 = one.zones.hand.p1!.filter((x) => one.objects[x] !== undefined);
    expect(hand(one, 'p1')).toBe(1);
    const before = activate(one, byName(one, 'Test Pinger', 'p1')[0]!, { targets: ['p3'] });
    expect(life(before, 'p3')).toBe(19);
    const cast = castFrom(one, 'Test Filler');
    expect(hand(cast, 'p1')).toBe(0);
    const after = activate(cast, byName(cast, 'Test Pinger', 'p1')[0]!, { targets: ['p3'] });
    expect(life(after, 'p3')).toBe(18);
  });
});

describe('CR 615.1a, 615.7, 611.3a: "As long as ~ is untapped, if a creature would deal combat damage to you, prevent 1 of that damage."', () => {
  const start = (): GameState => mpScenario({ players: 3, defs: [BEAR, STAFF], zones: { p1: { battlefield: [{ name: 'Test Bear', since: -1 } as never, { name: 'Test Bear', since: -1 } as never] }, p2: { battlefield: ['Test Staff'] } } });
  it('each creature\'s combat damage to you is lowered by 1 (two attackers: 1 + 1 of 2 + 2), only while the Staff is untapped', () => {
    const s0 = toAttackers(start());
    const [a, b] = byName(s0, 'Test Bear', 'p1');
    const s = runUntil(declare(s0, [[a!, 'p2'], [b!, 'p2']]), (x) => x.turn.step === 'main2' || x.turn.number > 1, 'the end of combat');
    expect(life(s, 'p2')).toBe(18);
  });
  it('negative: tapped, it prevents nothing; and damage to another player is not prevented', () => {
    const tapped = (() => { const s = start(); return tapIt(s, byName(s, 'Test Staff', 'p2')[0]!); })();
    const s0 = toAttackers(tapped);
    const [a, b] = byName(s0, 'Test Bear', 'p1');
    const s = runUntil(declare(s0, [[a!, 'p2'], [b!, 'p3']]), (x) => x.turn.step === 'main2' || x.turn.number > 1, 'the end of combat');
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p3')).toBe(18);
    const u = toAttackers(start());
    const [c, d] = byName(u, 'Test Bear', 'p1');
    const t = runUntil(declare(u, [[c!, 'p2'], [d!, 'p3']]), (x) => x.turn.step === 'main2' || x.turn.number > 1, 'the end of combat');
    expect(life(t, 'p2')).toBe(19);
    expect(life(t, 'p3')).toBe(18);
  });
});

describe('CR 101.4, 118.12, 608.2c: "Any player may exile a card from their graveyard. If a player does, ~ assigns no combat damage this turn." (Carrion Rats)', () => {
  const RATS = card('Test Rats', 'Creature — Rat', 'Whenever ~ attacks or blocks, any player may exile a card from their graveyard. If a player does, ~ assigns no combat damage this turn.', { pt: ['2', '2'] });
  const start = (yards: Partial<Record<PlayerId, number>>): GameState => mpScenario({
    players: 3, defs: [RATS, BEAR],
    zones: { p1: { battlefield: [{ name: 'Test Rats', since: -1 } as never] }, p2: { graveyard: Array.from({ length: yards.p2 ?? 0 }, () => 'Test Bear') }, p3: { graveyard: Array.from({ length: yards.p3 ?? 0 }, () => 'Test Bear') } },
  });
  const attack = (s0: GameState, o: Opts): GameState => {
    const s = toAttackers(s0);
    return runUntil(resolveAll(declare(s, [[byName(s, 'Test Rats', 'p1')[0]!, 'p2']]), o), (x) => x.turn.step === 'main2' || x.turn.number > 1, 'the end of combat');
  };
  it('a player who exiles a card from their graveyard keeps the damage from being assigned; the other player who can pay is offered it as well (every player is, CR 101.4)', () => {
    const s = attack(start({ p2: 2, p3: 1 }), { yes: [true, true] });
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.graveyard.p2!.length).toBe(1);
    expect(s.zones.graveyard.p3!.length).toBe(0);
  });
  it('negative: when nobody exiles a card (or nobody has one) the Rats deal their damage', () => {
    expect(life(attack(start({ p2: 2, p3: 1 }), { yes: [false, false] }), 'p2')).toBe(18);
    expect(life(attack(start({}), {}), 'p2')).toBe(18);
  });
});

describe('CR 101.4, 118.12, 701.21a: "Any player may sacrifice a land of their choice. If a player does, put ~ on top of its owner\'s library." (Argothian Wurm)', () => {
  const WURM = card('Test Wurm', 'Creature — Wurm', 'When ~ enters, any player may sacrifice a land of their choice. If a player does, put ~ on top of its owner\'s library.', { pt: ['6', '6'] });
  const LAND = card('Test Land', 'Land', '');
  const start = (): GameState => mpScenario({ players: 3, defs: [WURM, LAND], zones: { p1: { hand: ['Test Wurm'] }, p2: { battlefield: ['Test Land'] }, p3: { battlefield: ['Test Land', 'Test Land'] } } });
  it('one player sacrifices a land: the Wurm goes on top of its owner\'s library; the other players are still offered the sacrifice, in turn order (ruling 2007-02-01)', () => {
    const s = castFrom(start(), 'Test Wurm', { yes: [true, true] });
    expect(byName(s, 'Test Wurm').length).toBe(0);
    expect(chars(s, s.zones.library.p1![0]!).name).toBe('Test Wurm');
    expect(byName(s, 'Test Land', 'p2').length).toBe(0);
    expect(byName(s, 'Test Land', 'p3').length).toBe(1);
  });
  it('only the second player sacrifices: the Wurm still goes on top; a player with no land is not offered anything', () => {
    const s = castFrom(start(), 'Test Wurm', { yes: [false, true] });
    expect(chars(s, s.zones.library.p1![0]!).name).toBe('Test Wurm');
    expect(byName(s, 'Test Land', 'p2').length).toBe(1);
    expect(byName(s, 'Test Land', 'p3').length).toBe(1);
  });
  it('negative: when every player declines, the Wurm stays on the battlefield', () => {
    const s = castFrom(start(), 'Test Wurm', { yes: [false, false] });
    expect(byName(s, 'Test Wurm', 'p1').length).toBe(1);
    expect(byName(s, 'Test Land').length).toBe(3);
  });
});

describe('CR 118.12a, 122.1: "At the beginning of your end step, return ~ to its owner\'s hand unless you remove two oil counters from it." (Magmatic Sprinter)', () => {
  const SPRINT = card('Test Sprinter', 'Creature — Warrior', 'At the beginning of your end step, return ~ to its owner\'s hand unless you remove two oil counters from it.', { pt: ['3', '3'] });
  const run = (n: number, yes: boolean): GameState => {
    const s0 = mpScenario({ players: 3, defs: [SPRINT], zones: { p1: { battlefield: [{ name: 'Test Sprinter', counters: { oil: n } } as never] } } });
    const end = runUntil(s0, (x) => x.turn.step === 'end', 'the end step');
    return resolveAll(end, { yes: [yes] });
  };
  const oil = (s: GameState): number => (s.objects[byName(s, 'Test Sprinter')[0]!]!.counters as Record<string, number>).oil ?? 0;
  it('with two or more counters you may pay: it stays and loses two counters', () => {
    const s = run(3, true);
    expect(byName(s, 'Test Sprinter').length).toBe(1);
    expect(oil(s)).toBe(1);
  });
  it('negative: declining the payment, or having fewer than two counters (they can\'t be removed), returns it to its owner\'s hand', () => {
    expect(byName(run(3, false), 'Test Sprinter').length).toBe(0);
    expect(hand(run(3, false), 'p1')).toBeGreaterThan(0);
    const few = run(1, true);
    expect(byName(few, 'Test Sprinter').length).toBe(0);
    expect(find(few, 'Test Sprinter', 'hand', 'p1')).toBeDefined();
  });
});

describe('CR 604.1, 611.3a, 613.1f: "~ has trample as long as it has two or fewer oil counters on it. Otherwise, it has hexproof." (Evolved Spinoderm)', () => {
  const SPIN = card('Test Spinoderm', 'Creature — Beast', '~ has trample as long as it has two or fewer oil counters on it. Otherwise, it has hexproof.', { pt: ['5', '5'] });
  const withOil = (n: number): GameState => mpScenario({ players: 3, defs: [SPIN], zones: { p1: { battlefield: [{ name: 'Test Spinoderm', counters: { oil: n } } as never] } } });
  it('with more than two counters it has hexproof and no trample; with two or fewer (even none) it has trample and no hexproof', () => {
    const many = withOil(4);
    expect(kws(many, byName(many, 'Test Spinoderm')[0]!)).toContain('hexproof');
    expect(kws(many, byName(many, 'Test Spinoderm')[0]!)).not.toContain('trample');
    for (const n of [2, 1, 0]) {
      const few = withOil(n);
      expect(kws(few, byName(few, 'Test Spinoderm')[0]!)).toContain('trample');
      expect(kws(few, byName(few, 'Test Spinoderm')[0]!)).not.toContain('hexproof');
    }
    const three = withOil(3);
    expect(kws(three, byName(three, 'Test Spinoderm')[0]!)).toContain('hexproof');
  });
});

describe('CR 609.4, 702.3b, 508.1b: "Enchanted Wall can attack as though it didn\'t have defender." (Animate Wall)', () => {
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', { pt: ['0', '4'] });
  const AURA = card('Test Animator', 'Enchantment — Aura', 'Enchant Wall\nEnchanted Wall can attack as though it didn\'t have defender.');
  const attackers = (s: GameState): ObjectId[] => (s.pending as unknown as { candidates?: { id: ObjectId }[] }).candidates?.map((c) => c.id) ?? [];
  const start = (): GameState => mpScenario({ players: 3, defs: [WALL, AURA], zones: { p1: { battlefield: [{ name: 'Test Wall', since: -1 } as never, { name: 'Test Wall', since: -1 } as never], hand: ['Test Animator'] } } });
  it('the enchanted Wall may be declared as an attacker; the other Wall (it still has defender) may not', () => {
    const s0 = start();
    const [w1, w2] = byName(s0, 'Test Wall', 'p1');
    const aura = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Animator', 'hand', 'p1') } as never), { targets: [w1!] });
    expect(s0.zones.battlefield.length).toBeLessThan(aura.zones.battlefield.length);
    const atk = toAttackers(aura);
    const ids = attackers(atk);
    expect(ids).toContain(w1);
    expect(ids).not.toContain(w2);
  });
  it('the Aura of another player works for the Wall\'s controller: Bob\'s enchanted Wall may attack on Bob\'s turn (CR 303.4e, 609.4)', () => {
    const s0 = mpScenario({ players: 3, options: { startingPlayer: 'p2' }, defs: [WALL, AURA], zones: { p1: { hand: ['Test Animator'] }, p2: { battlefield: [{ name: 'Test Wall', since: -1 } as never] } } });
    const wall = byName(s0, 'Test Wall', 'p2')[0]!;
    // p1 holds the Aura; put it on the battlefield attached to Bob's Wall (a played cast needs p1's priority in p1's main phase)
    const attached = structuredClone(s0);
    const auraId = find(attached, 'Test Animator', 'hand', 'p1');
    attached.zones.hand.p1 = attached.zones.hand.p1!.filter((x) => x !== auraId);
    attached.zones.battlefield.push(auraId);
    Object.assign(attached.objects[auraId]!, { zone: 'battlefield', attachedTo: wall, since: -1 });
    const atk = toAttackers(attached);
    expect(atk.turn.activePlayer).toBe('p2');
    expect(attackers(atk)).toContain(wall);
  });
  it('negative: without the Aura neither Wall can attack', () => {
    let s = start();
    for (let i = 0; i < 40 && s.turn.step !== 'end'; i++) {
      expect(s.pending?.kind, 'no declare attackers decision comes with only Walls that have defender').not.toBe('declareAttackers');
      s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    expect(s.turn.step).toBe('end');
  });
});

describe('CR 404.1, 401.1: "Each player mills two cards. Then you may put an instant, sorcery, or battle card from your graveyard on top of your library." (Halo-Charged Skaab)', () => {
  const SKAAB = card('Test Skaab', 'Creature — Zombie', 'When ~ enters, each player mills two cards. Then you may put an instant, sorcery, or battle card from your graveyard on top of your library.', { pt: ['2', '2'] });
  const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.');
  const start = (grave: string[]): GameState => mpScenario({ players: 3, defs: [SKAAB, BOLT, BEAR], zones: { p1: { hand: ['Test Skaab'], graveyard: grave } } });
  it('you may put an instant card of your graveyard on top of your library (not a creature card); the top card of the library is then that card', () => {
    const s0 = start(['Test Spark', 'Test Bear']);
    const spark = findAll(s0, 'Test Spark', 'graveyard', 'p1')[0]!;
    const s = castFrom(s0, 'Test Skaab', { objects: [[spark]] });
    expect(chars(s, s.zones.library.p1![0]!).name).toBe('Test Spark');
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
    expect(s.zones.graveyard.p1!.length).toBe(1 + 2); // the Bear and the two milled cards (the Spark left)
  });
  it('negative: declining the may puts nothing back; with no instant, sorcery or battle card in the graveyard there is nothing to choose', () => {
    const s0 = start(['Test Spark']);
    const s = castFrom(s0, 'Test Skaab', { yes: [false] });
    expect(findAll(s, 'Test Spark', 'graveyard', 'p1').length).toBe(1);
    const t = castFrom(start(['Test Bear']), 'Test Skaab');
    expect(findAll(t, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
  });
});

describe('CR 702.37a, 701.40: "you may turn target creature with a morph ability face down." (Master of the Veil)', () => {
  const MORPH = card('Test Morpher', 'Creature — Wizard', 'Morph {1}', { pt: ['1', '1'] });
  const FLIP = card('Test Flipper', 'Instant', 'Turn target creature with a morph ability face down.');
  it('only a creature with a morph ability can be chosen; the other creature can\'t', () => {
    const MEGA = card('Test Megamorpher', 'Creature — Wizard', 'Megamorph {1}', { pt: ['1', '1'] });
    const s0 = mpScenario({ players: 3, defs: [MORPH, MEGA, BEAR, FLIP], zones: { p1: { battlefield: ['Test Morpher', 'Test Megamorpher', 'Test Bear'], hand: ['Test Flipper'] } } });
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Flipper', 'hand', 'p1') } as never) as GameState;
    const p = s.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(p.kind).toBe('chooseTargets');
    expect([...p.objects].sort()).toEqual([...byName(s0, 'Test Morpher'), ...byName(s0, 'Test Megamorpher')].sort()); // (CR 702.37b: megamorph is a variant of morph)
  });
});
