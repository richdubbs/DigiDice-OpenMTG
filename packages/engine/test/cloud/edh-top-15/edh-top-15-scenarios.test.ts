/**
 * Commander lane edh-top, round edh-top-15: the unattach family played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.3d, 608.2c, 608.2d  "You may unattach an Equipment from a creature you control. If you do, tap that creature and it gains indestructible until end of turn."
 *   CR 701.3d, 118.3, 602.2    "Unattach ~" as a cost (it must be attached to something: Scryfall ruling 2020-08-07); search, then cast that card without paying its mana cost
 *   CR 701.3d, 118.3, 201.5a   "Equipped creature has "{1}{R}, {T}, Unattach <Equipment>: It deals 3 damage to any target. Return <Equipment> to its owner's hand.""
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  const colors = ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`));
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const has = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === kw);
function resolve(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 20 && s.zones.stack.length > 0; guard++) s = pass(pass(s));
  return s;
}
/** Answer whatever the engine asks: pay automatically, pick the first option of a choice (or the given ones), yes to a "may", the given targets. */
function settle(s0: GameState, o: { targets?: { kind: 'player' | 'object'; id: string }[]; pick?: (opts: string[]) => string[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options as string[]) : (p.options as string[]).slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else break;
  }
  return s;
}
/** Resolve the stack, answering every question on the way. */
function finish(s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, o);
  for (let guard = 0; guard < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending && s.pending.kind !== 'priority' ? settle(s, o) : pass(s);
  return s;
}
const activatable = (s: GameState, source: ObjectId): { ability?: string }[] => legal(s, 'p1', 'activate').map((x) => x.action as { source?: string; ability?: string }).filter((x) => x.source === source);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const VOYAGER = card('Test Voyager', 'Creature — Kor', '{W}: You may unattach an Equipment from a creature you control. If you do, tap that creature and it gains indestructible until end of turn.', ['2', '2']);
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}');
const SUNBLADE = card('Test Sunblade', 'Artifact — Equipment', 'Equipped creature gets +4/+0.\n{R}{W}, Unattach ~: Search your library for a red or white instant card with mana value 4 or less and cast that card without paying its mana cost. Then shuffle.\nEquip {3}');
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.', undefined, '{R}');
const BIGBOLT = card('Test Big Bolt', 'Instant', '~ deals 5 damage to any target.', undefined, '{3}{R}{R}');
const BLUE = card('Test Blue Trick', 'Instant', 'You gain 2 life.', undefined, '{U}');
const HAMMER = card('Test Hammer', 'Artifact — Equipment', 'Equipped creature has "{1}{R}, {T}, Unattach Test Hammer: It deals 3 damage to any target. Return Test Hammer to its owner\'s hand."\nEquip {1}{R}');

describe('CR 701.3d, 608.2c: "You may unattach an Equipment from a creature you control. If you do, tap that creature and it gains indestructible until end of turn." (the Akiri reading)', () => {
  it('the cards are automated', () => {
    expect(full(VOYAGER)).toBe(true);
    expect(JSON.stringify(VOYAGER.faces)).toContain('"hostAs"');
  });
  function setup(): { s: GameState; voyager: ObjectId; bear: ObjectId; sword: ObjectId } {
    const s = scenario([], { p1: { battlefield: ['Test Voyager', 'Test Bear', 'Test Sword', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: [VOYAGER, BEAR, SWORD] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const sword = find(s, 'Test Sword', 'battlefield', 'p1');
    s.objects[sword]!.attachedTo = bear;
    return { s, voyager: find(s, 'Test Voyager', 'battlefield', 'p1'), bear, sword };
  }
  it('the Equipment lets go, the creature it was attached to (not the Voyager) becomes tapped and gains indestructible', () => {
    const { s: s0, voyager, bear, sword } = setup();
    const s = finish(act(s0, { type: 'activate', player: 'p1', source: voyager, ability: 'p:0:0' }));
    expect(s.objects[sword]!.attachedTo ?? null).toBeNull();
    expect(s.objects[sword]!.zone).toBe('battlefield');
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(has(s, bear, 'indestructible')).toBe(true);
    expect(s.objects[voyager]!.tapped).toBe(false);
    expect(has(s, voyager, 'indestructible')).toBe(false);
  });
  it('a creature that is already tapped just gains indestructible (Scryfall ruling 2020-09-25)', () => {
    const { s: s0, voyager, bear } = setup();
    s0.objects[bear]!.tapped = true;
    const s = finish(act(s0, { type: 'activate', player: 'p1', source: voyager, ability: 'p:0:0' }));
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(has(s, bear, 'indestructible')).toBe(true);
  });
  it('negative: no Equipment attached to a creature you control, nothing happens ("if you do" is false)', () => {
    const { s: s0, voyager, bear, sword } = setup();
    delete s0.objects[sword]!.attachedTo;
    const s = finish(act(s0, { type: 'activate', player: 'p1', source: voyager, ability: 'p:0:0' }));
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(has(s, bear, 'indestructible')).toBe(false);
    expect(s.objects[voyager]!.tapped).toBe(false);
  });
  it('negative: an Equipment on a creature an opponent controls is not chosen', () => {
    const { s: s0, voyager, bear, sword } = setup();
    const foe = find(s0, 'Test Bear', 'battlefield', 'p2');
    s0.objects[sword]!.attachedTo = foe;
    const s = finish(act(s0, { type: 'activate', player: 'p1', source: voyager, ability: 'p:0:0' }));
    expect(s.objects[sword]!.attachedTo).toBe(foe);
    expect(s.objects[foe]!.tapped).toBe(false);
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('the Voyager itself carrying the Equipment: it is the one tapped (the host is whatever creature carried it)', () => {
    const { s: s0, voyager, sword, bear } = setup();
    s0.objects[sword]!.attachedTo = voyager;
    const s = finish(act(s0, { type: 'activate', player: 'p1', source: voyager, ability: 'p:0:0' }));
    expect(s.objects[voyager]!.tapped).toBe(true);
    expect(s.objects[bear]!.tapped).toBe(false);
  });
});

describe('CR 701.3d, 118.3, 602.2: "{R}{W}, Unattach ~: Search your library for a red or white instant card with mana value 4 or less and cast that card without paying its mana cost."', () => {
  it('is automated and the cost is the unattach part', () => {
    expect(full(SUNBLADE)).toBe(true);
    expect(JSON.stringify(SUNBLADE.faces)).toContain('"kind":"unattach"');
  });
  function setup(attached: boolean): { s: GameState; blade: ObjectId; bear: ObjectId } {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Bear', 'Test Sunblade', 'Mountain', 'Plains'] }, p2: { battlefield: [] }, defs: [BEAR, SUNBLADE, BOLT, BIGBOLT, BLUE] });
    for (const n of ['Test Big Bolt', 'Test Blue Trick', 'Test Bolt']) put(s, 'p1', 'library', n);
    const blade = find(s, 'Test Sunblade', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    if (attached) s.objects[blade]!.attachedTo = bear;
    return { s, blade, bear };
  }
  it('attached: unattaches it as the cost, then casts the found instant for free (the red one with mana value 4 or less, never the mana value 5 or the blue one)', () => {
    const { s: s0, blade } = setup(true);
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: blade, ability: 'p:0:1' }));
    expect(s.objects[blade]!.attachedTo ?? null).toBeNull(); // cost paid at activation (CR 602.2b)
    s = finish(s, { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(17); // Test Bolt: 3 damage
    expect(life(s, 'p1')).toBe(20); // the blue instant was not found
  });
  it('negative: not attached to anything, the ability can not be activated (Scryfall ruling 2020-08-07)', () => {
    const { s, blade } = setup(false);
    expect(activatable(s, blade).filter((a) => a.ability === 'p:0:1')).toEqual([]);
  });
  it('attached: it can be activated (control for the negative)', () => {
    const { s, blade } = setup(true);
    expect(activatable(s, blade).some((a) => a.ability === 'p:0:1')).toBe(true);
  });
});

describe('CR 701.3d, 118.3, 201.5a: the Equipment-granted "{1}{R}, {T}, Unattach <Equipment>: It deals 3 damage to any target. Return <Equipment> to its owner\'s hand." (the Toralf\'s Hammer reading)', () => {
  it('is automated; the damage source and the cost are the granting object', () => {
    expect(full(HAMMER)).toBe(true);
    const json = JSON.stringify(HAMMER.faces);
    expect(json).toContain('"kind":"unattach"');
    expect(json).toContain('"source":{"ref":"grantor"}');
  });
  function setup(): { s: GameState; bear: ObjectId; hammer: ObjectId } {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Bear', 'Test Hammer', 'Mountain', 'Mountain'] }, p2: { battlefield: [] }, defs: [BEAR, HAMMER] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const hammer = find(s, 'Test Hammer', 'battlefield', 'p1');
    s.objects[hammer]!.attachedTo = bear;
    s.objects[bear]!.controlledSinceTurn = -1;
    return { s, bear, hammer };
  }
  const grantedOf = (s: GameState, source: ObjectId): string => activatable(s, source).find((a) => a.ability?.startsWith('g:'))!.ability!;
  it('unattaches as the cost, deals 3 damage (the Hammer is the source), and returns the Hammer to its owner\'s hand; the creature stays and is tapped by {T}', () => {
    const { s: s0, bear, hammer } = setup();
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: bear, ability: grantedOf(s0, bear) }), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(s.objects[hammer]!.attachedTo ?? null).toBeNull();
    expect(s.objects[bear]!.tapped).toBe(true);
    s = resolve(s);
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Hammer')).toBe(true);
    expect(s.objects[bear]!.zone).toBe('battlefield');
  });
  it('negative: not equipped, no granted ability to activate', () => {
    const { s, bear, hammer } = setup();
    delete s.objects[hammer]!.attachedTo;
    expect(activatable(s, bear).filter((a) => a.ability?.startsWith('g:'))).toEqual([]);
  });
});

const FLAME = card('Test Flameblade', 'Legendary Artifact — Equipment', 'Equipped creature gets +3/+1.\nWhenever equipped creature attacks, create two tapped 1/1 white Spirit creature tokens with flying. If that creature is legendary, instead create two of those tokens that are tapped and attacking.\nEquip {2}');
const HERO = card('Test Hero', 'Legendary Creature — Human', '', ['2', '2']);

describe('CR 614.15, 508.4, 608.2c: "Create two tapped 1/1 ... tokens. If that creature is legendary, instead create two of those tokens that are tapped and attacking." (the Andúril reading)', () => {
  it('is automated', () => expect(full(FLAME)).toBe(true));
  function attackWith(creature: string, owner: 'p1' | 'p2' = 'p1'): { s: GameState; tokens: ObjectId[] } {
    let s = scenario([], { p1: { battlefield: ['Test Flameblade', 'Test Bear', 'Test Hero'] }, p2: { battlefield: ['Test Bear'] }, defs: [FLAME, BEAR, HERO] });
    const flame = find(s, 'Test Flameblade', 'battlefield', 'p1');
    const who = find(s, creature, 'battlefield', owner);
    s.objects[flame]!.attachedTo = who;
    for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = -1;
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
      if (guard > 20) throw new Error('no declare attackers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: who, defender: 'p2' }] });
    s = finish(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    return { s, tokens };
  }
  it('a legendary equipped creature attacks: the two Spirits are tapped and attacking', () => {
    const { s, tokens } = attackWith('Test Hero');
    expect(tokens.length).toBe(2);
    for (const t of tokens) {
      expect(s.objects[t]!.tapped).toBe(true);
      expect(s.combat?.attackers.some((a) => a.id === t)).toBe(true);
    }
  });
  it('negative: a nonlegendary equipped creature attacks: two tapped Spirits that are not attacking', () => {
    const { s, tokens } = attackWith('Test Bear');
    expect(tokens.length).toBe(2);
    for (const t of tokens) {
      expect(s.objects[t]!.tapped).toBe(true);
      expect(s.combat?.attackers.some((a) => a.id === t) ?? false).toBe(false);
    }
  });
  it('an opponent\'s legendary creature wears it and attacks: the controller of the blade still makes two tapped Spirits, but they do not enter attacking (Scryfall ruling 2023-06-16)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Flameblade'] }, p2: { battlefield: ['Test Hero'] }, defs: [FLAME, BEAR, HERO] });
    const flame = find(s, 'Test Flameblade', 'battlefield', 'p1');
    const hero = find(s, 'Test Hero', 'battlefield', 'p2');
    s.objects[flame]!.attachedTo = hero;
    for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = -1;
    s = advanceTo(s, 2, 'beginCombat');
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
      if (guard > 20) throw new Error('no declare attackers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: hero, defender: 'p1' }] });
    s = finish(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(2);
    for (const t of tokens) {
      expect(s.objects[t]!.controller).toBe('p1');
      expect(s.combat?.attackers.some((a) => a.id === t) ?? false).toBe(false);
    }
  });
});

const GOD = card('Test Thunderer', 'Legendary Creature — God', 'Whenever a creature or planeswalker an opponent controls is dealt excess noncombat damage, ~ deals damage equal to the excess to any target other than that permanent.', ['4', '4']);
const SHOCK = card('Test Shock', 'Instant', '~ deals 5 damage to target creature.', undefined, '{R}');
const NICK = card('Test Nick', 'Instant', '~ deals 2 damage to target creature.', undefined, '{R}');
const TOAD = card('Test Toad', 'Creature — Frog', '', ['2', '2']);

describe('CR 120.10, 603.2, 608.2b: "Whenever a creature or planeswalker an opponent controls is dealt excess noncombat damage, ~ deals damage equal to the excess to any target other than that permanent." (the Toralf reading)', () => {
  it('is automated, with the excess as the amount', () => {
    expect(full(GOD)).toBe(true);
    expect(JSON.stringify(GOD.faces)).toContain('"q":"eventExcess"');
  });
  function shock(victimOwner: 'p1' | 'p2', damage = 5): { s: GameState; toad: ObjectId; god: ObjectId } {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Thunderer', 'Mountain'], hand: ['Test Shock'] }, p2: { battlefield: ['Test Toad'] }, defs: [GOD, SHOCK, TOAD, BEAR] });
    const toad = victimOwner === 'p2' ? find(s, 'Test Toad', 'battlefield', 'p2') : put(s, 'p1', 'battlefield', 'Test Toad');
    const god = find(s, 'Test Thunderer', 'battlefield', 'p1');
    void damage;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shock', 'hand', 'p1') }), { targets: [{ kind: 'object', id: toad }] });
    return { s, toad, god };
  }
  it('5 damage to a 2/2 an opponent controls: 3 is excess, so Thunderer deals 3 damage to the target of its trigger (never the damaged creature)', () => {
    const { s: s0, toad } = shock('p2');
    let s = s0;
    // the spell resolves, the trigger asks for its target: the damaged creature is not offered, the opponent is
    for (let guard = 0; guard < 20 && s.pending?.kind !== 'chooseTargets'; guard++) s = s.pending && s.pending.kind !== 'priority' ? settle(s) : pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    if (s.pending?.kind !== 'chooseTargets') return;
    expect(s.pending.objects).not.toContain(toad);
    expect(s.zones.graveyard['p2']!.length).toBe(1); // the damaged creature is gone (state-based actions): the next test keeps one alive
    expect(s.pending.players).toContain('p2');
    s = finish(s, { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(17);
  });
  it('the damaged creature is never offered while it is still on the battlefield (an indestructible 0/2 dealt 5), another creature of the opponent is', () => {
    const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', ['0', '2']);
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Thunderer', 'Mountain'], hand: ['Test Shock'] }, p2: { battlefield: ['Test Wall', 'Test Toad'] }, defs: [GOD, SHOCK, TOAD, WALL] });
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    const toad = find(s, 'Test Toad', 'battlefield', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shock', 'hand', 'p1') }), { targets: [{ kind: 'object', id: wall }] });
    for (let guard = 0; guard < 20 && s.pending?.kind !== 'chooseTargets'; guard++) s = s.pending && s.pending.kind !== 'priority' ? settle(s) : pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    if (s.pending?.kind !== 'chooseTargets') return;
    expect(s.objects[wall]!.zone).toBe('battlefield');
    expect(s.pending.objects).not.toContain(wall);
    expect(s.pending.objects).toContain(toad);
  });
  it('negative: exactly lethal damage (2 to a 2/2) has no excess, no trigger', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Thunderer', 'Mountain'], hand: ['Test Nick'] }, p2: { battlefield: ['Test Toad'] }, defs: [GOD, NICK, TOAD] });
    s = finish(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Nick', 'hand', 'p1') }), { targets: [{ kind: 'object', id: find(s, 'Test Toad', 'battlefield', 'p2') }] }), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.graveyard['p2']!.length).toBe(1);
  });
  it('negative: your own creature dealt excess damage does not trigger it ("an opponent controls")', () => {
    const { s: s0 } = shock('p1');
    const s = finish(s0, { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(20);
  });
});
