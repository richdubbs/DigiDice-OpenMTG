/**
 * FAST5X E9: mobilize, job select, increment, blight and static abilities that read the turn's history, played through the engine with synthetic cards
 * compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 702.181a      mobilize N: N 1/1 red Warrior tokens enter tapped and attacking (CR 508.4) and are sacrificed at the beginning of the next end step
 *   CR 702.182a      job select: a 1/1 colorless Hero token, then the Equipment is attached to it (CR 301.5c)
 *   CR 702.191a-b    increment: "if the amount of mana spent to cast that spell is greater than this creature's power or toughness" (CR 601.2h, 603.4)
 *   CR 701.68a-b     blight N: N -1/-1 counters on a creature you control; a player who can't blight can't choose to (as an effect, a cost, a "you may")
 *   CR 118.8, 601.2b an optional additional cost recorded for "if this spell's additional cost was paid"; "blight N or pay {M}" as a choice of costs
 *   CR 611.3a, 613   "as long as ..." conditions that read the turn's history: the layer cache notices a history change (rules/characteristics.ts)
 *   CR 701.22d, 701.25d  "whenever you scry", "you've scried or surveilled this turn"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { makeHistoryEntry } from '../../../src/rules/history';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const full = (d: CardDef): boolean => d.automation.level === 'full';
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]?.counters[kind] ?? 0;
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const named = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);

interface Picks { objects?: ObjectId[]; option?: string; yes?: boolean; targets?: TargetChoice[] }
/** Answer the decisions in front of us until a player has priority. */
function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending;
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.objects ?? (d as { options: ObjectId[] }).options.slice(0, (d as { min: number }).min) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: p.targets ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.yes ?? true });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.option ?? (d as { options: { id: string }[] }).options[0]!.id] });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}
function cast(s: GameState, name: string, p: Picks = {}, player = 'p1'): GameState {
  return settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), p);
}
const activations = (s: GameState, id: ObjectId, player = 'p1') => legal(s, player, 'activate').filter((a) => a.object === id && !a.isMana);
const attackWith = (s: GameState, ids: ObjectId[]): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind !== 'priority' || x.zones.stack.length > 0 || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'combat');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BUTCHER = card('Test Butcher', 'Creature — Demon', 'Mobilize 2', ['3', '3']);
const ARMS = card('Test Arms', 'Artifact — Equipment', 'Job select\nEquipped creature gets +1/+1.\nEquip {2}');
const LECTURER = card('Test Lecturer', 'Creature — Human Wizard', 'Increment', ['1', '2']);
const ONE = card('Test One', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
const TWO = card('Test Two', 'Sorcery', 'You gain 1 life.', undefined, '{2}');
const FREE = card('Test Free', 'Sorcery', 'You gain 1 life.');
const URCHIN = card('Test Urchin', 'Creature — Ouphe', 'Whenever this creature attacks, blight 1.', ['3', '4']);
const MISCHIEF = card('Test Mischief', 'Enchantment', 'When this enchantment enters, you may blight 1. If you do, you gain 3 life.');
const PERFECT = card('Test Perfect', 'Creature — Elf Noble', 'When this creature enters, each opponent blights 1.', ['2', '2']);
const SLINGER = card('Test Slinger', 'Creature — Goblin Warrior', '{T}, Blight 1: You gain 2 life.', ['3', '3']);
const ROD = card('Test Rod', 'Artifact', '{1}, Blight 2: You gain 2 life.');
const EMBRACE = card('Test Embrace', 'Sorcery', 'As an additional cost to cast this spell, blight 1 or pay {3}.\nYou gain 5 life.', undefined, '{1}');
const HEX = card('Test Hex', 'Instant', "As an additional cost to cast this spell, you may blight 1.\nYou gain 1 life. If this spell's additional cost was paid, you gain 2 life.", undefined, '{1}');
const STRIKE = card('Test Strike', 'Sorcery', "As an additional cost to cast this spell, you may blight 1.\nThis spell deals 2 damage to target creature. It deals 4 damage to that creature instead if this spell's additional cost was paid.", undefined, '{1}');
const GUEST = card('Test Guest', 'Creature — Human Peasant', 'This creature gets +1/+1 and has trample as long as two or more nonland permanents entered the battlefield under your control this turn.', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '');
const MUSTER = card('Test Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
const WORDSMITH = card('Test Wordsmith', 'Creature — Vampire Sorcerer', 'As long as an opponent was dealt noncombat damage this turn, this creature has flying and haste.', ['3', '3']);
const ZAP = card('Test Zap', 'Instant', 'This spell deals 1 damage to target opponent.');
const PHANTASM = card('Test Phantasm', 'Creature — Bird Illusion', 'Defender\nAs long as you\'ve scried or surveilled this turn, this creature can attack as though it didn\'t have defender.', ['2', '3']);
const PEEK = card('Test Peek', 'Sorcery', 'Surveil 1.');
const GLIMPSE = card('Test Glimpse', 'Sorcery', 'Scry 1.');
const SEER = card('Test Seer', 'Creature — Human', 'Whenever you scry, you gain 1 life.', ['1', '1']);
const RESCUE = card('Test Rescue', 'Enchantment — Aura', 'Enchant creature you control\nAs long as this Aura entered this turn, enchanted creature has hexproof.\nEnchanted creature gets +1/+1.');
const DEFS = [BEAR, BUTCHER, ARMS, LECTURER, ONE, TWO, FREE, URCHIN, MISCHIEF, PERFECT, SLINGER, ROD, EMBRACE, HEX, STRIKE, GUEST, TRINKET, MUSTER, WORDSMITH, ZAP, PHANTASM, PEEK, GLIMPSE, SEER, RESCUE];
const LANDS = ['Mountain', 'Mountain', 'Mountain', 'Mountain'];

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.181a: mobilize', () => {
  it('creates N 1/1 red Warrior tokens tapped and attacking (CR 508.4) and sacrifices them at the beginning of the next end step', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Butcher'] }, defs: DEFS });
    const butcher = find(s0, 'Test Butcher', 'battlefield');
    const a = attackWith(s0, [butcher]);
    expect(a.zones.stack).toHaveLength(1);
    const r = resolveAll(a);
    const tokens = r.zones.battlefield.filter((id) => r.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const id of tokens) {
      const c = getChars(r, id)!;
      expect([Number(c.power), Number(c.toughness), c.colors, c.subtypes]).toEqual([1, 1, ['R'], ['Warrior']]);
      expect(r.objects[id]!.tapped).toBe(true);
      expect(r.combat?.attackers.some((x) => x.id === id)).toBe(true);
    }
    expect(life(r, 'p2')).toBe(20);
    const end = resolveAll(passUntil(r, (x) => x.turn.step === 'end' && x.zones.stack.length > 0, 'the end step trigger'));
    expect(end.zones.battlefield.filter((id) => end.objects[id]!.kind === 'token')).toEqual([]);
    expect(life(end, 'p2')).toBe(20 - 3 - 2); // the Demon and both Warriors were unblocked
    expect(end.zones.battlefield).toContain(butcher);
  });
});

describe('CR 702.182a: job select', () => {
  it('creates a 1/1 colorless Hero creature token, then attaches the Equipment to it', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Arms'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Arms'));
    const arms = find(s, 'Test Arms', 'battlefield');
    const hero = s.objects[arms]!.attachedTo!;
    expect(hero).toBeDefined();
    const c = getChars(s, hero)!;
    expect([c.colors, c.subtypes, c.types]).toEqual([[], ['Hero'], ['Creature']]);
    expect(pt(s, hero)).toBe('2/2'); // 1/1 equipped (+1/+1)
  });
});

describe('CR 702.191a: increment', () => {
  const board = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test One', 'Test Two', 'Test Free'], battlefield: ['Test Lecturer', ...LANDS] }, defs: DEFS });
  it('a spell cast with more mana than its power or toughness puts a +1/+1 counter on it; equal or less does not trigger (CR 603.4)', () => {
    let s = board();
    const lecturer = find(s, 'Test Lecturer', 'battlefield');
    s = cast(s, 'Test One'); // 1 mana: not greater than 1 or 2
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s);
    expect(counters(s, lecturer, '+1/+1')).toBe(0);
    s = cast(s, 'Test Two'); // 2 > 1 (its power)
    expect(s.zones.stack).toHaveLength(2);
    s = resolveAll(s);
    expect(counters(s, lecturer, '+1/+1')).toBe(1);
    expect(pt(s, lecturer)).toBe('2/3');
  });
  it('a spell cast without spending mana spent none (CR 601.2h)', () => {
    const s = cast(board(), 'Test Free');
    expect(s.zones.stack).toHaveLength(1);
  });
});

describe('CR 701.68a-b: blight N', () => {
  it('as an effect: the player chooses a creature they control and puts N -1/-1 counters on it', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Urchin', 'Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const a = attackWith(s0, [find(s0, 'Test Urchin', 'battlefield')]);
    const r = resolveAll(a, { objects: [bear] });
    expect(counters(r, bear, '-1/-1')).toBe(1);
    expect(pt(r, bear)).toBe('1/1');
  });
  it('"you may blight 1. If you do, ...": asked only when the player controls a creature (CR 701.68b, 608.2d)', () => {
    const none = scenario(['Mountain'], { p1: { hand: ['Test Mischief'] }, defs: DEFS });
    const r0 = resolveAll(cast(none, 'Test Mischief'));
    expect(life(r0, 'p1')).toBe(20);
    expect(r0.log.some((l) => /can't do it/.test(l.text))).toBe(true);
    const some = scenario(['Mountain'], { p1: { hand: ['Test Mischief'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(some, 'Test Bear', 'battlefield');
    const r1 = resolveAll(cast(some, 'Test Mischief'), { yes: true, objects: [bear] });
    expect(counters(r1, bear, '-1/-1')).toBe(1);
    expect(life(r1, 'p1')).toBe(23);
  });
  it('"each opponent blights 1": the opponent chooses one of their own creatures (CR 608.2e)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Perfect'] }, p2: { battlefield: ['Test Bear', 'Test Slinger'] }, defs: DEFS });
    const slinger = find(s0, 'Test Slinger', 'battlefield', 'p2');
    let s = cast(s0, 'Test Perfect');
    for (let guard = 0; guard < 20 && !(s.pending?.kind === 'chooseObjects'); guard++) s = pass(s);
    expect(s.pending?.player).toBe('p2');
    expect((s.pending as { options: ObjectId[] }).options.sort()).toEqual([find(s0, 'Test Bear', 'battlefield', 'p2'), slinger].sort());
    s = resolveAll(s, { objects: [slinger] });
    expect(counters(s, slinger, '-1/-1')).toBe(1);
    expect(named(s, 'Test Perfect').every((id) => counters(s, id, '-1/-1') === 0)).toBe(true);
  });
  it('as a cost: "{T}, Blight 1" can put the counter on the creature itself; with no creature the cost can\'t be paid (CR 118.3)', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Slinger'] }, defs: DEFS });
    const slinger = find(s0, 'Test Slinger', 'battlefield');
    const s = resolveAll(settle(act(s0, activations(s0, slinger)[0]!.action), { objects: [slinger] }));
    expect(counters(s, slinger, '-1/-1')).toBe(1);
    expect(life(s, 'p1')).toBe(22);
    const lone = scenario(['Mountain'], { p1: { battlefield: ['Test Rod', ...LANDS] }, defs: DEFS });
    expect(activations(lone, find(lone, 'Test Rod', 'battlefield'))).toEqual([]);
  });
  it('"blight 1 or pay {3}": a choice of additional costs (CR 601.2b); without a creature only {3} can be paid', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Embrace'], battlefield: ['Test Bear', ...LANDS] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Embrace', 'hand') });
    expect(t.pending?.kind).toBe('chooseOption');
    expect((t.pending as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(['Blight 1 (put a -1/-1 counter on a creature you control)', '{3}']);
    const r = resolveAll(settle(t, { option: '0', objects: [bear] }));
    expect(counters(r, bear, '-1/-1')).toBe(1);
    expect(life(r, 'p1')).toBe(25);
    expect(r.zones.battlefield.filter((id) => r.objects[id]!.tapped)).toHaveLength(1); // only {1}
    const lone = scenario(['Mountain'], { p1: { hand: ['Test Embrace'], battlefield: LANDS }, defs: DEFS });
    const r2 = resolveAll(cast(lone, 'Test Embrace'));
    expect(life(r2, 'p1')).toBe(25);
    expect(r2.zones.battlefield.filter((id) => r2.objects[id]!.tapped)).toHaveLength(4); // {1} plus {3}
  });
  it('"you may blight 1" as an optional additional cost, and "if this spell\'s additional cost was paid" (CR 118.8, 601.2b)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Hex'], battlefield: ['Test Bear', ...LANDS] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const paid = resolveAll(cast(s0, 'Test Hex', { yes: true, objects: [bear] }));
    expect(counters(paid, bear, '-1/-1')).toBe(1);
    expect(life(paid, 'p1')).toBe(23);
    const unpaid = resolveAll(cast(s0, 'Test Hex', { yes: false }));
    expect(counters(unpaid, bear, '-1/-1')).toBe(0);
    expect(life(unpaid, 'p1')).toBe(21);
    const lone = scenario(['Mountain'], { p1: { hand: ['Test Hex'], battlefield: LANDS }, defs: DEFS });
    const t = act(lone, { type: 'cast', player: 'p1', card: find(lone, 'Test Hex', 'hand') });
    expect(t.pending?.kind).not.toBe('yesNo'); // CR 701.68b: not offered without a creature
    expect(life(resolveAll(settle(t)), 'p1')).toBe(21);
  });
  it('"It deals 4 damage to that creature instead if this spell\'s additional cost was paid" (CR 614.15)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Strike'], battlefield: ['Test Slinger', ...LANDS] }, p2: { battlefield: ['Test Urchin'] }, defs: DEFS });
    const urchin = find(s0, 'Test Urchin', 'battlefield', 'p2');
    const slinger = find(s0, 'Test Slinger', 'battlefield');
    const target = [{ kind: 'object' as const, id: urchin }];
    expect(resolveAll(cast(s0, 'Test Strike', { yes: false, targets: target })).objects[urchin]!.damage).toBe(2);
    const big = resolveAll(cast(s0, 'Test Strike', { yes: true, objects: [slinger], targets: target }));
    expect(big.zones.battlefield).not.toContain(urchin); // 4 damage to a 3/4
    expect(counters(big, slinger, '-1/-1')).toBe(1);
  });
});

describe('CR 611.3a: static abilities that read the turn\'s history (the layer cache notices it)', () => {
  it('"as long as two or more nonland permanents entered the battlefield under your control this turn": on with the second one, off next turn', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Trinket', 'Test Bear'], battlefield: ['Test Guest', 'Mountain'] }, defs: DEFS });
    const guest = find(s, 'Test Guest', 'battlefield');
    expect(pt(s, guest)).toBe('2/2');
    s = resolveAll(cast(s, 'Test Trinket'));
    expect(pt(s, guest)).toBe('2/2'); // one so far
    s = resolveAll(cast(s, 'Test Bear'));
    expect(pt(s, guest)).toBe('3/3');
    expect(kws(s, guest)).toContain('trample');
    const next = advanceTo(s, 2, 'upkeep');
    expect(pt(next, guest)).toBe('2/2');
    expect(kws(next, guest)).not.toContain('trample');
  });
  it('the cache key holds the history: an entry added to a state whose other layer inputs are unchanged is seen at once (rules/characteristics.ts)', () => {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Wordsmith'] }, defs: DEFS });
    const smith = find(s, 'Test Wordsmith', 'battlefield');
    expect(kws(s, smith)).not.toContain('flying'); // computed and cached
    s.history.push(Object.freeze(makeHistoryEntry(s, { ev: 'damage', facts: { toPlayer: true, recipientPlayer: 'p2', combat: false, amount: 1 } })));
    expect(kws(s, smith)).toEqual(expect.arrayContaining(['flying', 'haste']));
    s.history.push(Object.freeze(makeHistoryEntry(s, { ev: 'damage', facts: { toPlayer: true, recipientPlayer: 'p2', combat: true, amount: 1 } })));
    expect(kws(s, smith)).toContain('flying');
    const combatOnly = scenario(['Mountain'], { p1: { battlefield: ['Test Wordsmith'] }, defs: DEFS });
    combatOnly.history.push(Object.freeze(makeHistoryEntry(combatOnly, { ev: 'damage', facts: { toPlayer: true, recipientPlayer: 'p2', combat: true, amount: 3 } })));
    expect(kws(combatOnly, find(combatOnly, 'Test Wordsmith', 'battlefield'))).not.toContain('flying'); // combat damage is not noncombat damage (CR 120.1a)
  });
  it('celebration counts tokens too: two tokens entering are two nonland permanents (CR 111.1, 603.6a)', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Muster'], battlefield: ['Test Guest'] }, defs: DEFS });
    const guest = find(s, 'Test Guest', 'battlefield');
    s = resolveAll(cast(s, 'Test Muster'));
    expect(pt(s, guest)).toBe('3/3');
  });
  it('"as long as an opponent was dealt noncombat damage this turn, ~ has flying and haste"', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Zap'], battlefield: ['Test Wordsmith'] }, defs: DEFS });
    const smith = find(s, 'Test Wordsmith', 'battlefield');
    expect(kws(s, smith)).not.toContain('flying');
    s = resolveAll(cast(s, 'Test Zap', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(life(s, 'p2')).toBe(19);
    expect(kws(s, smith)).toEqual(expect.arrayContaining(['flying', 'haste']));
  });
  it('"as long as you\'ve scried or surveilled this turn, ~ can attack as though it didn\'t have defender"', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Peek'], battlefield: ['Test Phantasm'], library: ['Mountain', 'Mountain'] }, defs: DEFS });
    const phantasm = find(s, 'Test Phantasm', 'battlefield');
    expect(() => toDeclareAttackers(s)).toThrow(); // no creature can attack: no declare attackers decision (CR 702.3b, 508.1a)
    s = resolveAll(cast(s, 'Test Peek'), { objects: [] });
    const after = attackWith(s, [phantasm]);
    expect(after.combat?.attackers.some((a) => a.id === phantasm)).toBe(true);
  });
  it('"as long as this Aura entered this turn, enchanted creature has hexproof" (CR 400.7)', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Rescue'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Rescue', { targets: [{ kind: 'object', id: bear }] }));
    expect(pt(s, bear)).toBe('3/3');
    expect(kws(s, bear)).toContain('hexproof');
    const next = advanceTo(s, 2, 'upkeep');
    expect(kws(next, bear)).not.toContain('hexproof');
    expect(pt(next, bear)).toBe('3/3');
  });
});

describe('CR 701.22d: "whenever you scry" triggers (the action event is advertised now)', () => {
  it('scry 1 triggers it once, after the scry', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Glimpse'], battlefield: ['Test Seer'], library: ['Mountain', 'Mountain'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Glimpse'), { objects: [] });
    expect(life(s, 'p1')).toBe(21);
  });
});
