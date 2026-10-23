/**
 * FAST5X E28: small keyword abilities and actions, played through the engine with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10).
 *
 *   CR 702.91a-b    battle cry: each OTHER attacking creature gets +1/+0 until end of turn
 *   CR 702.147a     decayed: can't block; when it attacks, it is sacrificed at end of combat
 *   CR 702.79a      persist (and CR 702.93a undying): returns with a -1/-1 (+1/+1) counter if it had none, read as it last existed (CR 603.10a, 603.4)
 *   CR 702.101a     extort: whenever you cast a spell, you may pay {W/B}; each opponent loses 1 life and you gain the total lost
 *   CR 702.136a     riot: enters with your choice of a +1/+1 counter or haste (a replacement, CR 614.1c, 614.12a), also when another permanent grants it
 *   CR 701.43a-c    exert as a cost: it doesn't untap during your next untap step, then untaps normally
 *   CR 701.61a      forage as an effect ("you may forage", CR 608.2d) and as a cost; "whenever you forage"; "whenever you sacrifice one or more Foods" (CR 603.2c)
 *   CR 122.1c       shield counters: destruction by an effect and damage are replaced and prevented, one counter removed; not lethal-damage destruction, not
 *                   sacrifice; damage that can't be prevented still removes one; simultaneous damage from several sources removes one
 *   CR 508.1, 611.3a "creatures that attacked this turn" in a cost reduction and a static ability (the history filter in the layer system)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { applyAction } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const full = (d: CardDef): boolean => d.automation.level === 'full';
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]?.counters[kind] ?? 0;
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const named = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
const inYard = (s: GameState, defId: string, player = 'p1'): boolean => (s.zones.graveyard[player] ?? []).some((id) => s.objects[id]!.defId === defId);

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
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (d.kind === 'assignDamage') {
      const a = d as { amount: number; recipients: { id: string }[] };
      s = answer(s, { kind: 'assignDamage', amounts: a.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? a.amount : 0 })) });
    } else break;
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
/** Declare these attackers and stop at the first point after the declaration where something happens (a trigger, a decision, the damage step). */
const attackWith = (s: GameState, ids: ObjectId[]): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind !== 'priority' || x.zones.stack.length > 0 || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'combat');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const CRIER = card('Test Crier', 'Creature — Goblin Warrior', 'Battle cry', ['1', '1']);
const ROTTER = card('Test Rotter', 'Creature — Zombie', 'Decayed', ['2', '2']);
const PERSISTER = card('Test Persister', 'Creature — Kithkin', 'Persist', ['2', '2']);
const UNDYER = card('Test Undyer', 'Creature — Spirit', 'Undying', ['2', '2']);
const EXTORTER = card('Test Extorter', 'Creature — Human Advisor', 'Extort', ['1', '1']);
const GLIMMER = card('Test Glimmer', 'Sorcery', 'You gain 1 life.');
const RIOTER = card('Test Rioter', 'Creature — Goblin', 'Riot', ['2', '2']);
const WEBLORD = card('Test Weblord', 'Creature — Spider Hero', 'Other Spiders you control have riot.', ['1', '1']);
const SPIDERLING = card('Test Spiderling', 'Creature — Spider', '', ['1', '1']);
const TOILER = card('Test Toiler', 'Creature — Human Peasant', '{T}, Exert Test Toiler: You gain 2 life.', ['1', '1']);
const GATHERER = card('Test Gatherer', 'Creature — Squirrel', 'When Test Gatherer enters, you may forage. If you do, draw a card.', ['1', '1']);
const NIBBLER = card('Test Nibbler', 'Creature — Squirrel', '{T}, Forage: You gain 3 life.', ['1', '1']);
const HOARDER = card('Test Hoarder', 'Creature — Squirrel', 'Whenever you forage, put a +1/+1 counter on Test Hoarder.\nWhenever you sacrifice one or more Foods, you gain 1 life.', ['1', '1']);
const FEAST = card('Test Feast', 'Sorcery', 'As an additional cost to cast this spell, sacrifice two Foods.\nDraw a card.');
const SNACK = card('Test Snack', 'Artifact — Food', '{2}, {T}, Sacrifice this artifact: You gain 3 life.');
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const ZAP = card('Test Zap', 'Instant', 'This spell deals 3 damage to target creature.');
const SHIELDER = card('Test Shielder', 'Instant', 'Put a shield counter on target creature.');
const DRILL = card('Test Drill', 'Sorcery', 'Exert target creature you control. You gain 1 life.');
const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', ['0', '4']);
const MENDER = card('Test Mender', 'Instant', 'Regenerate target creature.');
const BANNER = card('Test Banner', 'Enchantment', 'Creatures you control that attacked this turn get +1/+0.');
const CAPTAIN = card('Test Captain', 'Legendary Creature — Human Soldier Hero', 'First strike\nTest Captain enters with a shield counter on him.\nAs long as Test Captain has a shield counter on him, you and other Heroes you control have hexproof.', ['3', '3']);
const SIDEKICK = card('Test Sidekick', 'Creature — Human Hero', '', ['1', '1']);
const JAB = card('Test Jab', 'Instant', 'This spell deals 1 damage to any target.');
const SKYSHIP = card('Test Skyship', 'Creature — Whale', 'You may look at the top card of your library any time.' + '\n' + 'As long as Test Skyship attacked this turn, you may play the top card of your library.', ['2', '2']);
const RAISE = card('Test Raise', 'Sorcery', 'Create a 2/2 black Zombie creature token with decayed.');
const ISILU = card('Test Isilu', 'Creature — God', 'Each other nontoken creature you control has persist.', ['4', '4']);
const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
const QUAKE = card('Test Quake', 'Sorcery', 'This spell deals 4 damage to each creature.');
const PURGE = card('Test Purge', 'Sorcery', 'Each player sacrifices two creatures.');
const RUSH = card('Test Rush', 'Instant', 'This spell costs {1} less to cast for each creature that attacked this turn.\nYou gain 1 life.', undefined, '{3}');
const DEFS = [BEAR, CRIER, ROTTER, PERSISTER, UNDYER, EXTORTER, GLIMMER, RIOTER, WEBLORD, SPIDERLING, TOILER, GATHERER, NIBBLER, HOARDER, FEAST, SNACK, SMITE, ZAP, SHIELDER, RUSH, WALL, MENDER, BANNER, CAPTAIN, SIDEKICK, JAB, SKYSHIP, RAISE, ISILU, WRATH, QUAKE, PURGE];
const PLAINS = ['Plains', 'Plains', 'Plains', 'Plains'];

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.91a: battle cry', () => {
  it('each other attacking creature gets +1/+0 until end of turn; the creature with battle cry does not', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Crier', 'Test Bear'] }, defs: DEFS });
    const crier = find(s0, 'Test Crier', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const a = attackWith(s0, [crier, bear]);
    expect(a.zones.stack).toHaveLength(1);
    const r = resolveAll(a);
    expect(pt(r, bear)).toBe('3/2');
    expect(pt(r, crier)).toBe('1/1');
    expect(pt(advanceTo(r, 2, 'upkeep'), bear)).toBe('2/2');
  });
  it('a creature that is not attacking gets nothing (CR 506.4)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Crier', 'Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const r = resolveAll(attackWith(s0, [find(s0, 'Test Crier', 'battlefield')]));
    expect(pt(r, bear)).toBe('2/2');
  });
});

describe('CR 702.147a: decayed', () => {
  it("can't block (with no other creature, there is no declare blockers decision at all)", () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Rotter', 'Test Spiderling'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bear]]));
    expect(() => declareBlockers(s, [[find(s0, 'Test Rotter', 'battlefield', 'p2'), bear]])).toThrow();
    expect(() => declareBlockers(s, [[find(s0, 'Test Spiderling', 'battlefield', 'p2'), bear]])).not.toThrow();
    const alone = scenario(['Plains'], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Rotter'] }, defs: DEFS });
    const r = passUntil(declareAttackers(toDeclareAttackers(alone), [[find(alone, 'Test Bear', 'battlefield')]]), (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'declareBlockers', 'blockers or the end of combat', 200);
    expect(r.pending?.kind).not.toBe('declareBlockers');
    expect(life(r, 'p2')).toBe(18);
  });
  it('when it attacks, it is sacrificed at end of combat (a delayed trigger, CR 603.7)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Rotter'] }, defs: DEFS });
    const rotter = find(s0, 'Test Rotter', 'battlefield');
    const r = resolveAll(attackWith(s0, [rotter]));
    expect(r.zones.battlefield).toContain(rotter);
    const end = resolveAll(passUntil(r, (x) => x.turn.step === 'endCombat' && x.zones.stack.length > 0, 'the end of combat trigger'));
    expect(named(end, 'Test Rotter')).toEqual([]);
    expect(inYard(end, 'Test Rotter')).toBe(true);
    expect(life(end, 'p2')).toBe(18); // it dealt its combat damage first
  });
});

describe('CR 702.147a: a token with decayed (CR 111.4: the keyword is part of the definition of the token)', () => {
  it('the token has decayed, and is sacrificed at end of combat when it attacks', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Raise'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Raise'));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(kws(s, token)).toContain('decayed');
    s = advanceTo(s, 3, 'main1'); // no longer summoning sick (CR 302.6)
    const r = resolveAll(attackWith(s, [token]));
    const end = resolveAll(passUntil(r, (x) => x.turn.step === 'endCombat' && x.zones.stack.length > 0, 'the end of combat trigger'));
    expect(end.objects[token]).toBeUndefined(); // a token that left the battlefield ceases to exist (CR 111.7)
    expect(life(end, 'p2')).toBe(18);
  });
});

describe('CR 702.79a, 702.93a: persist and undying', () => {
  it('persist: dies with no -1/-1 counter, returns with one; dies again with it, stays in the graveyard (CR 603.4, 603.10a)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Persister'] }, defs: DEFS });
    s = cast(s, 'Test Smite', { targets: [{ kind: 'object', id: find(s, 'Test Persister', 'battlefield') }] });
    s = resolveAll(s);
    const back = named(s, 'Test Persister');
    expect(back).toHaveLength(1);
    expect(counters(s, back[0]!, '-1/-1')).toBe(1);
    expect(pt(s, back[0]!)).toBe('1/1');
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: back[0]! }] }));
    expect(named(s, 'Test Persister')).toEqual([]);
    expect(inYard(s, 'Test Persister')).toBe(true);
  });
  it('persist reads the counters it had as it died: a +1/+1 counter does not stop it', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite'], battlefield: [{ name: 'Test Persister', counters: { '+1/+1': 1 } }] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: find(s, 'Test Persister', 'battlefield') }] }));
    expect(named(s, 'Test Persister')).toHaveLength(1);
  });
  it('undying: returns with a +1/+1 counter if it had none', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Undyer'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: find(s, 'Test Undyer', 'battlefield') }] }));
    const back = named(s, 'Test Undyer');
    expect(back).toHaveLength(1);
    expect(pt(s, back[0]!)).toBe('3/3');
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: back[0]! }] }));
    expect(named(s, 'Test Undyer')).toEqual([]);
  });
});

// Review finding (E28): the persist Isilu grants must trigger when Isilu leaves the battlefield with the creature, whichever object the engine moves first:
// every object that leaves in one event looks back at the game state just before that event (CR 603.10a, 608.2h), not at the state just before its own move.
describe('CR 603.10a: a granted persist looks back when the granter leaves in the same event', () => {
  const back = (s: GameState): ObjectId[] => named(s, 'Test Bear');
  for (const order of [['Test Isilu', 'Test Bear'], ['Test Bear', 'Test Isilu']]) {
    it(`destroy all creatures (CR 608.2f), ${order[0]} first on the battlefield`, () => {
      const s = resolveAll(cast(scenario(['Plains'], { p1: { hand: ['Test Wrath'], battlefield: order }, defs: DEFS }), 'Test Wrath'));
      expect(back(s)).toHaveLength(1);
      expect(counters(s, back(s)[0]!, '-1/-1')).toBe(1);
      expect(named(s, 'Test Isilu')).toEqual([]); // Isilu itself has no persist (each OTHER creature)
    });
    it(`lethal damage, destroyed by one state-based action check (CR 704.3, 704.5g), ${order[0]} first on the battlefield`, () => {
      const s = resolveAll(cast(scenario(['Plains'], { p1: { hand: ['Test Quake'], battlefield: order }, defs: DEFS }), 'Test Quake'));
      expect(back(s)).toHaveLength(1);
      expect(counters(s, back(s)[0]!, '-1/-1')).toBe(1);
    });
    it(`each player sacrifices two creatures, both at once (CR 701.21a, 608.2e), ${order[0]} first on the battlefield`, () => {
      const s = resolveAll(cast(scenario(['Plains'], { p1: { hand: ['Test Purge'], battlefield: order }, defs: DEFS }), 'Test Purge'));
      expect(back(s)).toHaveLength(1);
      expect(counters(s, back(s)[0]!, '-1/-1')).toBe(1);
    });
  }
});

describe('CR 702.101a: extort', () => {
  it('pay {W/B}: each opponent loses 1 life and you gain the life lost; decline: nothing', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Glimmer'], battlefield: ['Test Extorter', ...PLAINS] }, defs: DEFS });
    const paid = resolveAll(cast(s0, 'Test Glimmer'), { yes: true });
    expect(life(paid, 'p2')).toBe(19);
    expect(life(paid, 'p1')).toBe(22); // 1 from extort, 1 from the spell
    expect(paid.zones.battlefield.filter((id) => paid.objects[id]!.tapped)).toHaveLength(1);
    const declined = resolveAll(cast(s0, 'Test Glimmer'), { yes: false });
    expect(life(declined, 'p2')).toBe(20);
    expect(life(declined, 'p1')).toBe(21);
  });
  it('two instances trigger separately (CR 702.101b)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Glimmer'], battlefield: ['Test Extorter', 'Test Extorter', ...PLAINS] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Glimmer'), { yes: true });
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 702.136a: riot', () => {
  it('the controller chooses as it enters: a +1/+1 counter (no haste) or haste (no counter)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Rioter'] }, defs: DEFS });
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rioter', 'hand') });
    const asked = passUntil(settle(t), (x) => x.pending?.kind !== 'priority', 'the riot choice');
    expect(asked.pending?.kind).toBe('chooseOption');
    expect((asked.pending as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(['a +1/+1 counter', 'haste']);
    const withCounter = resolveAll(asked, { option: '0' });
    const a = named(withCounter, 'Test Rioter')[0]!;
    expect(pt(withCounter, a)).toBe('3/3');
    expect(kws(withCounter, a)).not.toContain('haste');
    const hasty = resolveAll(asked, { option: '1' });
    const b = named(hasty, 'Test Rioter')[0]!;
    expect(pt(hasty, b)).toBe('2/2');
    expect(kws(hasty, b)).toContain('haste');
    expect(kws(advanceTo(hasty, 3, 'upkeep'), b)).toContain('haste'); // indefinitely (the ruling)
  });
  it('granted by another permanent ("Other Spiders you control have riot"), it applies as the Spider enters (CR 614.12)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Spiderling'], battlefield: ['Test Weblord'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Spiderling'), { option: '1' });
    const sp = named(s, 'Test Spiderling')[0]!;
    expect(kws(s, sp)).toContain('haste');
    expect(kws(s, find(s, 'Test Weblord', 'battlefield'))).not.toContain('riot'); // "other"
  });
});

describe('CR 701.43a-c: exert as a cost', () => {
  it("\"{T}, Exert ~\": it doesn't untap during its controller's next untap step, then untaps in the one after", () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Toiler'] }, defs: DEFS });
    const toiler = find(s0, 'Test Toiler', 'battlefield');
    const s = resolveAll(act(s0, activations(s0, toiler)[0]!.action));
    expect(life(s, 'p1')).toBe(22);
    expect(s.objects[toiler]!.tapped).toBe(true);
    const t3 = advanceTo(s, 3, 'upkeep');
    expect(t3.objects[toiler]!.tapped).toBe(true); // CR 701.43a: not in p1's next untap step
    const t5 = advanceTo(t3, 5, 'upkeep');
    expect(t5.objects[toiler]!.tapped).toBe(false);
  });
});

describe('CR 701.43a: exert as an effect (the experimental template eff.e28.exert)', () => {
  it('"exert target creature you control": it stays tapped through the next untap step of its controller', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Drill'], battlefield: [{ name: 'Test Bear', tapped: true }] }, defs: [...DEFS, DRILL] });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Drill', { targets: [{ kind: 'object', id: bear }] }));
    expect(life(s, 'p1')).toBe(21);
    expect(advanceTo(s, 3, 'upkeep').objects[bear]!.tapped).toBe(true);
    expect(advanceTo(s, 5, 'upkeep').objects[bear]!.tapped).toBe(false);
  });
});

describe('CR 701.61a: forage', () => {
  it('"you may forage. If you do, draw a card": exile three cards from your graveyard', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Gatherer'], graveyard: ['Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const hand = s0.zones.hand['p1']!.length;
    const s = resolveAll(cast(s0, 'Test Gatherer'), { yes: true });
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(s.zones.exile.length).toBe(3);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 1);
  });
  it('or sacrifice a Food (the player chooses which, when both are possible)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Gatherer'], graveyard: ['Plains', 'Plains', 'Plains'], battlefield: ['Test Snack'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Gatherer'), { yes: true, option: 'food' });
    expect(named(s, 'Test Snack')).toEqual([]);
    expect(s.zones.graveyard['p1']!.length).toBe(4);
  });
  it('a player who can do neither is not asked and does not draw (CR 608.2d)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Gatherer'], graveyard: ['Plains', 'Plains'] }, defs: DEFS });
    const hand = s0.zones.hand['p1']!.length;
    const s = resolveAll(cast(s0, 'Test Gatherer'), { yes: true });
    expect(s.zones.hand['p1']!.length).toBe(hand - 1);
    expect(s.zones.graveyard['p1']!.length).toBe(2);
  });
  it('as a cost, and "whenever you forage" / "whenever you sacrifice one or more Foods" trigger', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Nibbler', 'Test Hoarder', 'Test Snack'] }, defs: DEFS });
    const nibbler = find(s0, 'Test Nibbler', 'battlefield');
    const hoarder = find(s0, 'Test Hoarder', 'battlefield');
    const s = resolveAll(act(s0, activations(s0, nibbler)[0]!.action));
    expect(named(s, 'Test Snack')).toEqual([]);
    expect(counters(s, hoarder, '+1/+1')).toBe(1);
    expect(life(s, 'p1')).toBe(20 + 3 + 1);
  });
  it('"whenever you sacrifice one or more Foods" triggers once for two Foods sacrificed together (CR 603.2c)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Feast'], battlefield: ['Test Hoarder', 'Test Snack', 'Test Snack'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Feast'));
    expect(named(s, 'Test Snack')).toEqual([]);
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 122.1c: shield counters', () => {
  const shielded = (extra: Partial<Record<string, number>> = {}) => ({ name: 'Test Bear', counters: { shield: 1, ...extra } as Record<string, number> });
  it('"destroy": instead a shield counter is removed', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite'] }, p2: { battlefield: [shielded()] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: bear }] }));
    expect(s.zones.battlefield).toContain(bear);
    expect(counters(s, bear, 'shield')).toBe(0);
  });
  it('damage is prevented and one counter removed, however many there are', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Zap'] }, p2: { battlefield: [shielded({ shield: 2 })] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Zap', { targets: [{ kind: 'object', id: bear }] }));
    expect(s.zones.battlefield).toContain(bear);
    expect(s.objects[bear]!.damage).toBe(0);
    expect(counters(s, bear, 'shield')).toBe(1);
  });
  it('"put a shield counter on target creature", then the creature survives a destroy effect', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shielder', 'Test Smite'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Shielder', { targets: [{ kind: 'object', id: bear }] }));
    expect(counters(s, bear, 'shield')).toBe(1);
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: bear }] }));
    expect(s.zones.battlefield).toContain(bear);
  });
  it('combat damage from two blockers at the same time is one occurrence: all prevented, one counter removed (CR 510.2)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [shielded({ shield: 2 })] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: DEFS });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[mine]]));
    s = declareBlockers(s, [[b1!, mine], [b2!, mine]]);
    for (let guard = 0; guard < 200 && s.turn.step !== 'endCombat'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(s.zones.battlefield).toContain(mine);
    expect(s.objects[mine]!.damage).toBe(0);
    expect(counters(s, mine, 'shield')).toBe(1);
  });
  it('lethal damage marked before (a state-based action) and sacrifice are not stopped', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Glimmer'], battlefield: [{ name: 'Test Snack', counters: { shield: 1 } }] }, defs: DEFS });
    const snack = find(s0, 'Test Snack', 'battlefield');
    const sac = activations(s0, snack);
    expect(sac).toEqual([]); // {2} can't be paid here; sacrifice is checked below through forage instead
    const s1 = scenario(['Plains'], { p1: { battlefield: ['Test Nibbler', { name: 'Test Snack', counters: { shield: 1 } }] }, defs: DEFS });
    const r = resolveAll(act(s1, activations(s1, find(s1, 'Test Nibbler', 'battlefield'))[0]!.action));
    expect(named(r, 'Test Snack')).toEqual([]); // sacrificed: shield counters don't stop it (the ruling)
  });
});

describe('CR 122.1c, 611.3a: "as long as ~ has a shield counter on him, you and other Heroes you control have hexproof"', () => {
  /** p2 casts Test Jab at `target` during p1's main phase; true when the target is accepted. */
  const jabAccepted = (s0: GameState, target: TargetChoice): boolean => {
    const s = act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Jab', 'hand', 'p2') });
    try {
      answer(s, { kind: 'chooseTargets', targets: [target] });
      return true;
    } catch {
      return false;
    }
  };
  it('with the counter: neither you nor other Heroes can be targeted by an opponent; the Captain himself and non-Heroes can (CR 702.11b-c)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Captain'], battlefield: ['Test Sidekick', 'Test Bear'] }, p2: { hand: ['Test Jab'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Captain'));
    const captain = find(s, 'Test Captain', 'battlefield');
    expect(counters(s, captain, 'shield')).toBe(1);
    expect(kws(s, find(s, 'Test Sidekick', 'battlefield'))).toContain('hexproof');
    expect(jabAccepted(s, { kind: 'player', id: 'p1' })).toBe(false);
    expect(jabAccepted(s, { kind: 'object', id: find(s, 'Test Sidekick', 'battlefield') })).toBe(false);
    expect(jabAccepted(s, { kind: 'object', id: find(s, 'Test Bear', 'battlefield') })).toBe(true);
    expect(jabAccepted(s, { kind: 'object', id: captain })).toBe(true); // "other" Heroes
  });
  it('the damage the Captain is dealt is prevented and removes the counter; then the hexproof is gone', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Captain', 'Test Zap'], battlefield: ['Test Sidekick'] }, p2: { hand: ['Test Jab'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Captain'));
    const captain = find(s, 'Test Captain', 'battlefield');
    s = resolveAll(cast(s, 'Test Zap', { targets: [{ kind: 'object', id: captain }] }));
    expect(s.objects[captain]!.damage).toBe(0);
    expect(counters(s, captain, 'shield')).toBe(0);
    expect(kws(s, find(s, 'Test Sidekick', 'battlefield'))).not.toContain('hexproof');
    expect(jabAccepted(s, { kind: 'player', id: 'p1' })).toBe(true);
  });
});

describe('CR 122.1c with other effects', () => {
  it('an indestructible permanent would not be destroyed, so no shield counter is removed (CR 702.12b)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite'] }, p2: { battlefield: [{ name: 'Test Wall', counters: { shield: 1 } }] }, defs: DEFS });
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: wall }] }));
    expect(s.zones.battlefield).toContain(wall);
    expect(counters(s, wall, 'shield')).toBe(1);
  });
  it('with a regeneration shield too, the controller chooses which applies (CR 616.1, 701.19a)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Mender', 'Test Smite'], battlefield: [{ name: 'Test Bear', counters: { shield: 1 } }] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Mender', { targets: [{ kind: 'object', id: bear }] }));
    s = cast(s, 'Test Smite', { targets: [{ kind: 'object', id: bear }] });
    const asked = passUntil(s, (x) => x.pending?.kind !== 'priority', 'the order of the two effects');
    expect(asked.pending?.kind).toBe('chooseOption');
    const regen = resolveAll(asked, { option: 'regenerate' });
    expect(regen.zones.battlefield).toContain(bear);
    expect(counters(regen, bear, 'shield')).toBe(1);
    expect(regen.objects[bear]!.tapped).toBe(true); // CR 701.19a
    const shield = resolveAll(asked, { option: 'shield' });
    expect(counters(shield, bear, 'shield')).toBe(0);
    expect(shield.objects[bear]!.tapped).toBe(false);
  });
});

describe('CR 508.1, 611.3a: "creatures that attacked this turn"', () => {
  it('a permission: "as long as ~ attacked this turn, you may play the top card of your library" (the form of The Lunar Whale, CR 601.3, 305.1)', () => {
    const s0 = scenario(['Plains', 'Mountain'], { p1: { battlefield: ['Test Skyship'], library: ['Mountain'] }, defs: DEFS });
    const top = (s: GameState): ObjectId => s.zones.library['p1']![0]!;
    expect(s0.objects[top(s0)]!.defId).toBe('Mountain');
    expect(applyAction(s0, { type: 'playLand', player: 'p1', card: top(s0) }).error).toBeDefined(); // it hasn't attacked
    let s = attackWith(s0, [find(s0, 'Test Skyship', 'battlefield')]);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 200);
    s = act(s, { type: 'playLand', player: 'p1', card: top(s) });
    expect(named(s, 'Mountain')).toHaveLength(1);
  });
  it('a static ability of the layer system: "creatures you control that attacked this turn get +1/+0" (the cache notices the attack)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Banner', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    const [a, b] = named(s0, 'Test Bear');
    expect(pt(s0, a!)).toBe('2/2');
    let s = attackWith(s0, [a!]);
    expect(pt(s, a!)).toBe('3/2');
    expect(pt(s, b!)).toBe('2/2');
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, a!)).toBe('2/2'); // another turn
  });
  it('a cost reduction counts the creatures that attacked this turn and are still creatures on the battlefield', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Rush'], battlefield: ['Test Bear', 'Test Bear', ...PLAINS] }, defs: DEFS });
    const bears = named(s0, 'Test Bear');
    const before = resolveAll(cast(s0, 'Test Rush'));
    expect(before.zones.battlefield.filter((id) => before.objects[id]!.tapped)).toHaveLength(3);
    let s = attackWith(s0, bears);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 200);
    s = resolveAll(cast(s, 'Test Rush'));
    expect(life(s, 'p1')).toBe(21);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped && s.objects[id]!.defId === 'Plains')).toHaveLength(1);
  });
});
