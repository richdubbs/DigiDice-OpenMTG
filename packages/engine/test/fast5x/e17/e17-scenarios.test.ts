/**
 * FAST5X E17: resolution history and last-known control, played through the engine with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10).
 *
 *   CR 505.1b, 505.1a  "your second main phase" is the main phase numbered 2 in its turn: an additional main phase after an additional combat counts too
 *   CR 603.4           survival's intervening "if ~ is tapped"; CR 603.2h, 400.7 "This ability triggers only once" (once for the object)
 *   CR 608.2, 400.7    "the Nth time this ability has resolved this turn": per ability of the source object, this resolution included, a new turn and a new
 *                      object start again; an ability whose targets are all illegal does not resolve (CR 608.2b) and is not counted
 *   CR 608.2h          "if you controlled it": the controller as the object last existed on the battlefield (not its owner)
 *   CR 608.2c, 608.2h  "if a permanent you controlled or a token was destroyed this way": what the destroy step actually destroyed, as it last existed
 *   CR 601.2i          "if you controlled a Wizard as you cast ~": decided when the spell became cast, kept until it resolves
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]?.counters[kind] ?? 0;
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
const clone = (s: GameState): GameState => structuredClone(s);

interface Picks { objects?: ObjectId[]; yes?: boolean; targets?: TargetChoice[] }
/** Answer the decisions in front of us until a player has priority. */
function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending;
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.objects ?? (d as { options: ObjectId[] }).options.slice(0, (d as { min: number }).min) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: p.targets ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.yes ?? true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}
/** Pass (declaring no attackers or blockers) until `done` holds; triggered abilities that come up on the way are left on the stack only if `done` stops there. */
function until(s0: GameState, done: (s: GameState) => boolean, what: string, max = 200): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`the game ended while waiting for ${what}`);
    s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  }
  throw new Error(`never reached ${what}`);
}
function cast(s: GameState, name: string, p: Picks = {}, player = 'p1'): GameState {
  return settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), p);
}
const target = (id: ObjectId): TargetChoice[] => [{ kind: 'object', id }];
const activate = (s: GameState, id: ObjectId, p: Picks = {}): GameState => settle(act(s, legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana)!.action), p);

const SURVIVOR = card('Test Survivor', 'Creature — Elf Survivor', 'At the beginning of your second main phase, if this creature is tapped, you gain 2 life.', ['2', '2']);
const CHEER = card('Test Cheer', 'Creature — Human Survivor', 'At the beginning of your second main phase, if this creature is tapped, put a +1/+1 counter on it. This ability triggers only once.', ['1', '1']);
const PILGRIM = card('Test Pilgrim', 'Creature — Halfling', "Whenever a token you control enters, you gain 1 life if this is the first time this ability has resolved this turn. If it's the second time, draw a card. If it's the third time, put a +1/+1 counter on each creature you control.", ['2', '2']);
const MUSTER = card('Test Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
const SPROUT = card('Test Sprout', 'Sorcery', 'Create a 1/1 green Saproling creature token.');
const RECALL = card('Test Recall', 'Sorcery', "Return target nonland permanent to its owner's hand. If you controlled that permanent, draw a card.");
const UNSUMMON = card('Test Unsummon', 'Instant', "Return target creature to its owner's hand.");
const FOCUS = card('Test Focus', 'Artifact', '{0}: Target creature gets +1/+0 until end of turn. If this is the second time this ability has resolved this turn, draw a card.');
const SCOUT = card('Test Scout', 'Creature — Vedalken Detective', "When this creature enters, return up to one other target creature to its owner's hand. If you controlled it, investigate.", ['4', '4']);
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target enchantment. If a permanent you controlled or a token was destroyed this way, draw a card.');
const CHARM = card('Test Charm', 'Enchantment', '');
const BULWARK = card('Test Bulwark', 'Enchantment', 'Indestructible');
const STRIKE = card('Test Strike', 'Instant', 'This spell deals 2 damage to target creature. This spell deals 4 damage to that creature instead if you controlled a Wizard as you cast this spell.');
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', 'Flash', ['1', '1']);
const FENCING = card('Test Fencing', 'Instant', 'Target creature gets -1/-1 until end of turn. That creature gets an additional -2/-2 until end of turn if you controlled a Wizard as you cast this spell.');
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '6']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const DEFS = [FENCING, SURVIVOR, CHEER, PILGRIM, MUSTER, SPROUT, RECALL, UNSUMMON, FOCUS, SCOUT, SHATTER, CHARM, BULWARK, STRIKE, WIZARD, WALL, BEAR];

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 505.1b: "at the beginning of your second main phase" (survival, CR 207.2c)', () => {
  const atMain = (s: GameState, n: number): boolean => (s.turn.step === 'main1' || s.turn.step === 'main2') && s.turn.mains === n && s.pending?.kind === 'priority';
  it('triggers in the second main phase if the creature is tapped (CR 603.4), not in the first; an untapped one does not trigger', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Survivor', tapped: true }] }, defs: DEFS });
    expect([s0.turn.step, s0.turn.mains, s0.zones.stack.length]).toEqual(['main1', 1, 0]); // the first main phase: no trigger
    const m2 = until(s0, (x) => atMain(x, 2), 'the second main phase');
    expect(m2.zones.stack).toHaveLength(1);
    expect(life(resolveAll(m2), 'p1')).toBe(22);
    const untapped = scenario(['Mountain'], { p1: { battlefield: ['Test Survivor'] }, defs: DEFS });
    const u2 = until(untapped, (x) => atMain(x, 2), 'the second main phase');
    expect(u2.zones.stack).toHaveLength(0);
    expect(life(resolveAll(u2), 'p1')).toBe(20);
  });
  it('CR 505.1a-b: an additional main phase after an additional combat in the first main phase is the second main phase; the usual postcombat main phase is then the third', () => {
    const s0 = clone(scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Survivor', tapped: true }] }, defs: DEFS }));
    // CR 500.8: "after this main phase, there is an additional combat phase followed by an additional main phase" (core/turn-effects.ts#addExtraPhase, twice)
    s0.turn.extraPhases = [{ after: 'main', phase: 'main' }, { after: 'main', phase: 'combat' }];
    const m2 = until(s0, (x) => atMain(x, 2), 'the additional main phase');
    expect(m2.turn.combats).toBe(1); // after the additional combat
    expect(m2.zones.stack).toHaveLength(1);
    const r = resolveAll(m2);
    expect(life(r, 'p1')).toBe(22);
    const m3 = until(r, (x) => atMain(x, 3), 'the usual postcombat main phase');
    expect(m3.turn.combats).toBe(2);
    expect(m3.zones.stack).toHaveLength(0); // a postcombat main phase, but not the second one
    expect(life(resolveAll(m3), 'p1')).toBe(22);
  });
  it('CR 505.1a: an additional main phase after the second main phase is the third: no second trigger', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Survivor', tapped: true }] }, defs: DEFS });
    const m2 = clone(resolveAll(until(s0, (x) => atMain(x, 2), 'the second main phase')));
    expect(life(m2, 'p1')).toBe(22);
    m2.turn.extraPhases = [{ after: 'main', phase: 'main' }, { after: 'main', phase: 'combat' }];
    const m3 = until(m2, (x) => atMain(x, 3), 'the additional main phase');
    expect(m3.turn.step).toBe('main2');
    expect(m3.zones.stack).toHaveLength(0);
  });
  it('a new turn counts again: the next turn of the same player has its own second main phase', () => {
    const s0 = clone(scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Survivor', tapped: true }] }, defs: DEFS }));
    let s = resolveAll(until(s0, (x) => atMain(x, 2), 'the second main phase'));
    s = until(s, (x) => x.turn.number === 3 && atMain(x, 1), 'the next turn of p1');
    s = clone(s);
    s.objects[find(s, 'Test Survivor', 'battlefield')]!.tapped = true; // tapped again (it untapped in the untap step)
    s = until(s, (x) => atMain(x, 2), 'the second main phase of turn 3');
    expect(s.zones.stack).toHaveLength(1);
    expect(life(resolveAll(s), 'p1')).toBe(24);
  });
  it('CR 603.2h, 603.4: "This ability triggers only once": an untapped creature does not use it up; once it triggered, never again for this object', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Cheer'] }, defs: DEFS });
    const cheer = find(s0, 'Test Cheer', 'battlefield');
    let s = until(s0, (x) => atMain(x, 2), 'the second main phase');
    expect(s.zones.stack).toHaveLength(0); // untapped: it does not trigger (and does not count)
    s = clone(until(s, (x) => x.turn.number === 3 && atMain(x, 1), 'turn 3'));
    s.objects[cheer]!.tapped = true;
    s = until(s, (x) => atMain(x, 2), 'the second main phase of turn 3');
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s);
    expect(counters(s, cheer, '+1/+1')).toBe(1);
    s = clone(until(s, (x) => x.turn.number === 5 && atMain(x, 1), 'turn 5'));
    s.objects[cheer]!.tapped = true;
    s = until(s, (x) => atMain(x, 2), 'the second main phase of turn 5');
    expect(s.zones.stack).toHaveLength(0);
    expect(counters(resolveAll(s), cheer, '+1/+1')).toBe(1);
  });
});

describe('CR 608.2, 400.7: "the Nth time this ability has resolved this turn"', () => {
  it('first, second, third: the count of this ability of this object, this resolution included; a fourth does nothing', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Muster', 'Test Sprout', 'Test Sprout'], battlefield: ['Test Pilgrim'] }, defs: DEFS });
    const pilgrim = find(s0, 'Test Pilgrim', 'battlefield');
    const hand0 = handSize(s0);
    let s = cast(s0, 'Test Muster');
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(21); // the first resolution
    expect(handSize(s)).toBe(hand0 - 1 + 1); // Muster left the hand; the second resolution drew a card
    expect(counters(s, pilgrim, '+1/+1')).toBe(0);
    s = resolveAll(cast(s, 'Test Sprout'));
    for (const id of [pilgrim, ...s.zones.battlefield.filter((x) => s.objects[x]!.kind === 'token')]) expect(counters(s, id, '+1/+1')).toBe(1); // the third
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.kind === 'token')).toHaveLength(3);
    const before = { life: life(s, 'p1'), hand: handSize(s) };
    s = resolveAll(cast(s, 'Test Sprout'));
    expect([life(s, 'p1'), handSize(s), counters(s, pilgrim, '+1/+1')]).toEqual([before.life, before.hand - 1, 1]); // the fourth: nothing
  });
  it('a new turn starts again', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Muster', 'Test Sprout'], battlefield: ['Test Pilgrim'] }, defs: DEFS });
    let s = resolveAll(cast(s0, 'Test Muster'));
    expect(life(s, 'p1')).toBe(21);
    s = until(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 3');
    s = resolveAll(cast(s, 'Test Sprout'));
    expect(life(s, 'p1')).toBe(22); // the first resolution of turn 3
  });
  it('CR 400.7: the source as a new object has resolved nothing', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Muster', 'Test Sprout', 'Test Unsummon'], battlefield: ['Test Pilgrim'] }, defs: DEFS });
    let s = resolveAll(cast(s0, 'Test Muster')); // two resolutions
    expect(life(s, 'p1')).toBe(21);
    s = resolveAll(cast(s, 'Test Unsummon', { targets: target(find(s, 'Test Pilgrim', 'battlefield')) }));
    s = resolveAll(cast(s, 'Test Pilgrim'));
    s = resolveAll(cast(s, 'Test Sprout'));
    expect(life(s, 'p1')).toBe(22); // the first time for the new Pilgrim: 1 life again, no counters
    expect(counters(s, find(s, 'Test Pilgrim', 'battlefield'), '+1/+1')).toBe(0);
  });
  it('CR 608.2b: an ability whose targets are all illegal does not resolve, so it is not counted; activated abilities count the same way', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Unsummon'], battlefield: ['Test Focus', 'Test Bear', 'Test Wall'] }, defs: DEFS });
    const focus = find(s0, 'Test Focus', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    const hand0 = handSize(s0);
    // activate targeting the Bear, then bounce the Bear in response: the ability does not resolve
    let s = activate(s0, focus, { targets: target(bear) });
    s = resolveAll(cast(s, 'Test Unsummon', { targets: target(bear) }));
    expect(s.zones.stack).toHaveLength(0);
    expect(handSize(s)).toBe(hand0); // Unsummon left, the Bear came back
    s = resolveAll(activate(s, focus, { targets: target(wall) })); // the first resolution
    expect(handSize(s)).toBe(hand0);
    s = resolveAll(activate(s, focus, { targets: target(wall) })); // the second: draw
    expect(handSize(s)).toBe(hand0 + 1);
    s = resolveAll(activate(s, focus, { targets: target(wall) })); // the third: nothing
    expect(handSize(s)).toBe(hand0 + 1);
  });
});

describe('CR 608.2h: "if you controlled it" reads the controller as the object last existed', () => {
  it('your own permanent: draw; an opponent\'s: no card', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Recall', 'Test Recall'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const hand0 = handSize(s0);
    let s = resolveAll(cast(s0, 'Test Recall', { targets: target(find(s0, 'Test Bear', 'battlefield')) }));
    expect(handSize(s)).toBe(hand0 - 1 + 1 + 1); // Recall left; the Bear and a card came
    s = resolveAll(cast(s, 'Test Recall', { targets: target(find(s, 'Test Wall', 'battlefield', 'p2')) }));
    expect(handSize(s)).toBe(hand0 + 1 - 1); // no card
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2') + 1);
  });
  it('a permanent you control but an opponent owns: it goes to its owner\'s hand and you draw (controller, not owner)', () => {
    const s0 = clone(scenario(['Mountain'], { p1: { hand: ['Test Recall'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS }));
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    s0.objects[wall]!.controller = 'p1';
    const hand0 = handSize(s0);
    const s = resolveAll(cast(s0, 'Test Recall', { targets: target(wall) }));
    expect(handSize(s)).toBe(hand0); // Recall left, a card came
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2') + 1);
  });
  it('an enters trigger: "If you controlled it" never means the source itself; no target chosen, no Clue', () => {
    const clues = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && /Clue/.test(s.defs[s.objects[id]!.defId]!.name)).length;
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Scout'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const mine = resolveAll(cast(s0, 'Test Scout'), { targets: target(find(s0, 'Test Bear', 'battlefield')) });
    expect(clues(mine)).toBe(1);
    const theirs = resolveAll(cast(s0, 'Test Scout'), { targets: target(find(s0, 'Test Wall', 'battlefield', 'p2')) });
    expect(clues(theirs)).toBe(0);
    expect(theirs.zones.hand['p2']).toHaveLength(s0.zones.hand['p2']!.length + 1);
    const none = resolveAll(cast(s0, 'Test Scout'), { targets: [] });
    expect(clues(none)).toBe(0);
  });
});

describe('CR 608.2c, 608.2h: "if a permanent you controlled or a token was destroyed this way"', () => {
  it('your enchantment destroyed: draw; an opponent\'s nontoken one: no card; an indestructible one of yours is not destroyed: no card', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Shatter', 'Test Shatter', 'Test Shatter'], battlefield: ['Test Charm', 'Test Bulwark'] }, p2: { battlefield: ['Test Charm'] }, defs: DEFS });
    const hand0 = handSize(s0);
    let s = resolveAll(cast(s0, 'Test Shatter', { targets: target(find(s0, 'Test Charm', 'battlefield', 'p1')) }));
    expect(handSize(s)).toBe(hand0); // one Shatter out, one card in
    s = resolveAll(cast(s, 'Test Shatter', { targets: target(find(s, 'Test Charm', 'battlefield', 'p2')) }));
    expect(handSize(s)).toBe(hand0 - 1);
    expect(named(s, 'Test Charm')).toHaveLength(0);
    s = resolveAll(cast(s, 'Test Shatter', { targets: target(find(s, 'Test Bulwark', 'battlefield')) }));
    expect(named(s, 'Test Bulwark')).toHaveLength(1); // indestructible (CR 702.12b)
    expect(handSize(s)).toBe(hand0 - 2);
  });
});

describe('CR 601.2i: "if you controlled a Wizard as you cast ~"', () => {
  it('a Wizard when the spell was cast: 4 damage, even if the Wizard has left before it resolves; none: 2', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Strike', 'Test Unsummon'], battlefield: ['Test Wizard'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    let s = cast(s0, 'Test Strike', { targets: target(wall) });
    s = resolveAll(cast(s, 'Test Unsummon', { targets: target(find(s, 'Test Wizard', 'battlefield')) }));
    expect(s.objects[wall]!.damage).toBe(4);
    const none = scenario(['Mountain'], { p1: { hand: ['Test Strike'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    expect(resolveAll(cast(none, 'Test Strike', { targets: target(find(none, 'Test Wall', 'battlefield', 'p2')) })).objects[find(none, 'Test Wall', 'battlefield', 'p2')]!.damage).toBe(2);
  });
  it('a Wizard that arrives after the spell was cast does not count', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Strike', 'Test Wizard'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    let s = cast(s0, 'Test Strike', { targets: target(wall) });
    s = cast(s, 'Test Wizard'); // flash, in response
    s = resolveAll(s);
    expect(named(s, 'Test Wizard')).toHaveLength(1);
    expect(s.objects[wall]!.damage).toBe(2);
  });
  it('"that creature gets an additional -2/-2 until end of turn if ...": a second change of power and toughness, applied only if the condition held as the spell was cast (CR 613.4c)', () => {
    const pt = (st: GameState, id: ObjectId): string => { const c = getChars(st, id)!; return `${c.power}/${c.toughness}`; };
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Fencing'], battlefield: ['Test Wizard'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    expect(pt(resolveAll(cast(s0, 'Test Fencing', { targets: target(wall) })), wall)).toBe('-3/3');
    const none = scenario(['Mountain'], { p1: { hand: ['Test Fencing'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall2 = find(none, 'Test Wall', 'battlefield', 'p2');
    expect(pt(resolveAll(cast(none, 'Test Fencing', { targets: target(wall2) })), wall2)).toBe('-1/5');
  });
});
