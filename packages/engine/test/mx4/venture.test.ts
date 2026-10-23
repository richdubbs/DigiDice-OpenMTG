/**
 * MX4: venture into the dungeon (CR 701.49), dungeons (CR 309, 704.5t), "if you've completed a dungeon" (CR 309.7) and the initiative (CR 726), played through
 * applyAction with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10) and the real dungeon cards (core/dungeons.json).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, dungeonByName, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../src/index';
import { charsOfObject } from '../../src/rules/characteristics';
import { act, advanceTo, answer, castAuto, find, findAll, life, pass, passBoth, scenario } from '../m3/scenario';

function compiled(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));

const DELVER = compiled('Test Delver', 'Creature — Human Rogue', '{0}: Venture into the dungeon.', '{0}', ['1', '1']);
const SCOUT = compiled('Test Scout', 'Creature — Elf Scout', 'When this creature enters, venture into the dungeon.', '{0}', ['1', '1']);
const PATHFINDER = compiled('Test Pathfinder', 'Creature — Human Warrior', 'When this creature enters, you take the initiative.', '{0}', ['2', '2']);
const RAIDER = compiled('Test Raider', 'Creature — Orc', 'Trample', '{0}', ['3', '3']);
const CHAMPION = compiled('Test Champion', 'Creature — Human Knight', "As long as you've completed a dungeon, this creature has double strike.", '{0}', ['2', '2']);
const WOLFCALLER = compiled('Test Wolfcaller', 'Enchantment', 'Whenever you complete a dungeon, create a 2/2 green Wolf creature token.');
const ARCHLICH = compiled('Test Archlich', 'Creature — Zombie Wizard', "When ~ enters, if you haven't completed Tomb of Annihilation, return ~ to its owner's hand and venture into the dungeon.", '{0}', ['5', '5']);
const KEEPER = compiled('Test Keeper', 'Creature — Human', 'At the beginning of your end step, if you have the initiative, you gain 2 life.', '{0}', ['1', '1']);
const DEFS = [DELVER, SCOUT, PATHFINDER, RAIDER, CHAMPION, WOLFCALLER, ARCHLICH, KEEPER];
const SEEKER = compiled('Test Ruin Seeker', 'Creature — Human', 'Room abilities of dungeons you own trigger an additional time.', '{0}', ['2', '2']);

/**
 * Answer every decision until a player has priority: a `chooseOption` takes the next entry of `picks` (an option id or the start of its label); other
 * decisions get the least they allow (no cards to the bottom, the first `min` objects or targets, the items in the order given).
 */
function drive(s0: GameState, picks: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 50 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending;
    switch (d.kind) {
      case 'chooseOption': {
        const want = picks.shift();
        const o = d.options.find((x) => x.id === want || (want !== undefined && x.label.startsWith(want)));
        if (!o) throw new Error(`no pick for "${d.prompt}" (${d.options.map((x) => x.label).join(' / ')})`);
        s = answer(s, { kind: 'chooseOption', ids: [o.id] });
        break;
      }
      case 'chooseObjects': s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) }); break;
      case 'order': s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) }); break;
      case 'chooseTargets': s = answer(s, { kind: 'chooseTargets', targets: [...d.players.map((id) => ({ kind: 'player' as const, id })), ...d.objects.map((id) => ({ kind: 'object' as const, id }))].slice(0, d.min) }); break;
      case 'payCost': s = answer(s, { kind: 'payCost', auto: true }); break;
      case 'yesNo': s = answer(s, { kind: 'yesNo', yes: true }); break;
      default: throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
    }
  }
  return s;
}

/** Pass until the stack is empty (answering what comes up with `picks`). */
function resolveAll(s0: GameState, picks: string[] = []): GameState {
  let s = drive(s0, picks);
  for (let guard = 0; guard < 40 && s.zones.stack.length > 0; guard++) s = drive(pass(s), picks);
  return s;
}

/** Activate Test Delver's venture ability and let everything resolve. */
function venture(s0: GameState, picks: string[] = []): GameState {
  const delver = find(s0, 'Test Delver', 'battlefield', 'p1');
  const s = drive(act(s0, { type: 'activate', player: 'p1', source: delver, ability: 'p:0:0' }), picks);
  return resolveAll(s, picks);
}

const dungeonOf = (s: GameState, p: string): { name: string; room: number } | undefined => {
  const id = s.zones.command.find((x) => s.objects[x]?.owner === p && s.objects[x]!.defId.startsWith('dungeon:'));
  return id === undefined ? undefined : { name: s.defs[s.objects[id]!.defId]!.name, room: s.objects[id]!.ventureRoom ?? 0 };
};
const roomName = (s: GameState, p: string): string | undefined => {
  const d = dungeonOf(s, p);
  if (!d) return undefined;
  return dungeonByName(d.name)!.rooms[d.room]!.name;
};
const hand = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('MX4: the synthetic cards compile to automated abilities (venture, initiative, completed dungeons)', () => {
  it('no manual ability or step, and the level is full', () => {
    for (const d of DEFS) {
      expect(manualParts(d), d.name).toEqual([]);
      expect(d.automation.level, d.name).toBe('full');
    }
  });
  it('the step of "venture into the dungeon" and the condition of "you haven\'t completed Tomb of Annihilation"', () => {
    expect(JSON.stringify(SCOUT.faces[0]!.abilities[0])).toContain('{"op":"action","action":"venture","who":{"ref":"you"}}');
    expect(JSON.stringify(ARCHLICH.faces[0]!.abilities[0])).toContain('{"cond":"not","of":{"cond":"completedDungeon","who":{"ref":"you"},"name":"Tomb of Annihilation"}}');
  });
});

describe('CR 701.49a, 309.2a, 309.4a: venturing without a dungeon', () => {
  it('the player chooses one of the three dungeons (not Undercity), it goes to the command zone, and the top room ability triggers', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Delver'] } });
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Delver', 'battlefield'), ability: 'p:0:0' });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseOption');
    const offered = s.pending?.kind === 'chooseOption' ? s.pending.options.map((o) => o.id) : [];
    expect(offered).toEqual(['Dungeon of the Mad Mage', 'Lost Mine of Phandelver', 'Tomb of Annihilation']);
    s = resolveAll(s, ['Dungeon of the Mad Mage']);
    expect(dungeonOf(s, 'p1')).toEqual({ name: 'Dungeon of the Mad Mage', room: 0 });
    expect(life(s, 'p1')).toBe(21); // Yawning Portal: "You gain 1 life."
  });
});

describe('CR 701.49b, 309.5a: venturing moves the marker to the next room; with several arrows the player chooses', () => {
  it('Lost Mine of Phandelver: Cave Entrance, then Goblin Lair or Mine Tunnels', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Delver'] } });
    let s = venture(s0, ['Lost Mine of Phandelver']);
    expect(roomName(s, 'p1')).toBe('Cave Entrance');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Delver', 'battlefield'), ability: 'p:0:0' });
    s = passBoth(s);
    expect(s.pending?.kind === 'chooseOption' ? s.pending.options.map((o) => o.label.split(' — ')[0]) : []).toEqual(['Goblin Lair', 'Mine Tunnels']);
    s = resolveAll(s, ['Goblin Lair']);
    expect(roomName(s, 'p1')).toBe('Goblin Lair');
    expect(findAll(s, 'Goblin Token', 'battlefield', 'p1').length + findAll(s, 'Goblin', 'battlefield', 'p1').length).toBe(1);
  });
});

describe('CR 309.4c, 603.3d: a room ability with a target is put on the stack with its target', () => {
  it('Lost Mine of Phandelver, Storeroom: "Put a +1/+1 counter on target creature."', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Delver'] } });
    let s = venture(s0, ['Lost Mine of Phandelver']);
    s = venture(s, ['Goblin Lair']);
    s = venture(s, ['Storeroom']);
    expect(roomName(s, 'p1')).toBe('Storeroom');
    const counters = s.zones.battlefield.reduce((n, id) => n + (s.objects[id]!.counters['+1/+1'] ?? 0), 0);
    expect(counters).toBe(1);
  });
});

describe('design 10: text the engine does not run that changes venturing makes the venture manual (fail closed)', () => {
  it('"Room abilities of dungeons you own trigger an additional time." on the battlefield: the venture is resolved by hand', () => {
    expect(SEEKER.automation.level).toBe('manual');
    const s0 = scenario([], { defs: [...DEFS, SEEKER], p1: { battlefield: ['Test Delver', 'Test Ruin Seeker'] } });
    const s = passBoth(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Delver', 'battlefield'), ability: 'p:0:0' }));
    expect(s.pending?.kind).toBe('manualResolve');
    expect(s.zones.command).toEqual([]);
  });
});

describe('CR 704.5t, 309.6, 309.7: the bottommost room, completing the dungeon, and what reads it', () => {
  function walkLostMine(extra: { battlefield?: string[] } = {}): GameState {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Delver', ...(extra.battlefield ?? [])] } });
    let s = venture(s0, ['Lost Mine of Phandelver']); // Cave Entrance: scry 1
    s = venture(s, ['Mine Tunnels']); // a Treasure
    s = venture(s, ['Dark Pool']); // each opponent loses 1 life and you gain 1 life
    return s;
  }
  it('the dungeon leaves the game once the last room ability has left the stack; the completion is recorded; "whenever you complete a dungeon" triggers', () => {
    let s = walkLostMine({ battlefield: ['Test Wolfcaller', 'Test Champion'] });
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(21);
    const champion = find(s, 'Test Champion', 'battlefield');
    expect(charsOfObject(s, s.objects[champion]!).keywords.some((k) => k.keyword === 'double strike')).toBe(false);
    const cards = hand(s, 'p1');
    // Temple of Dumathoin: the room ability triggers; while it is on the stack the dungeon stays (CR 704.5t)
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Delver', 'battlefield'), ability: 'p:0:0' });
    s = drive(passBoth(s));
    expect(s.zones.stack).toHaveLength(1);
    expect(dungeonOf(s, 'p1')?.name).toBe('Lost Mine of Phandelver');
    s = resolveAll(s);
    expect(hand(s, 'p1')).toBe(cards + 1); // "Draw a card."
    expect(dungeonOf(s, 'p1')).toBeUndefined();
    expect(s.designations.completedDungeons).toEqual({ p1: ['Lost Mine of Phandelver'] });
    expect(findAll(s, 'Wolf', 'battlefield', 'p1').length + findAll(s, 'Wolf Token', 'battlefield', 'p1').length).toBe(1);
    expect(charsOfObject(s, s.objects[champion]!).keywords.some((k) => k.keyword === 'double strike')).toBe(true);
  });
  it('CR 701.49c: venturing while the marker is on the bottommost room (its ability still on the stack) completes it and enters a new dungeon', () => {
    let s = walkLostMine();
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Delver', 'battlefield'), ability: 'p:0:0' });
    s = drive(passBoth(s)); // Temple of Dumathoin's ability is on the stack
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Delver', 'battlefield'), ability: 'p:0:0' });
    s = drive(passBoth(s), ['Tomb of Annihilation']);
    expect(s.designations.completedDungeons?.['p1']).toEqual(['Lost Mine of Phandelver']);
    expect(dungeonOf(s, 'p1')).toEqual({ name: 'Tomb of Annihilation', room: 0 });
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(18); // Dark Pool, then Trapped Entry: "Each player loses 1 life."
  });
  it('"if you haven\'t completed Tomb of Annihilation": the creature returns to hand and ventures; after completing it, it stays', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Archlich'] } });
    let s = resolveAll(castAuto(s0, 'Test Archlich'), ['Dungeon of the Mad Mage']);
    expect(findAll(s, 'Test Archlich', 'hand', 'p1')).toHaveLength(1);
    expect(dungeonOf(s, 'p1')?.name).toBe('Dungeon of the Mad Mage');
    const done = structuredClone(s);
    done.designations.completedDungeons = { p1: ['Tomb of Annihilation'] };
    s = resolveAll(castAuto(done, 'Test Archlich'));
    expect(findAll(s, 'Test Archlich', 'battlefield', 'p1')).toHaveLength(1);
    expect(dungeonOf(s, 'p1')).toEqual({ name: 'Dungeon of the Mad Mage', room: 0 });
  });
});

describe('CR 726: the initiative', () => {
  function takeIt(): GameState {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Pathfinder'], battlefield: ['Test Keeper'] }, p2: { battlefield: ['Test Raider'] } });
    return resolveAll(castAuto(s0, 'Test Pathfinder'));
  }
  it('CR 726.2, 726.3, 701.49d: taking it ventures into Undercity (no choice of dungeon)', () => {
    const s = takeIt();
    expect(s.designations.initiative).toBe('p1');
    expect(dungeonOf(s, 'p1')).toEqual({ name: 'Undercity', room: 0 });
    expect(s.log.some((e) => e.text.includes('Secret Entrance'))).toBe(true);
  });
  it('"if you have the initiative" reads it; CR 726.2: at the beginning of its holder\'s upkeep, that player ventures into Undercity', () => {
    let s = takeIt();
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(22); // Test Keeper
    s = advanceTo(s, 3, 'upkeep');
    s = drive(s);
    expect(s.zones.stack.length + s.pendingTriggers.length).toBeGreaterThan(0);
    s = resolveAll(s, ['Lost Well']);
    expect(roomName(s, 'p1')).toBe('Lost Well');
  });
  it('CR 726.2: combat damage to its holder gives it to the attacking creatures\' controller, who ventures into Undercity', () => {
    let s = takeIt();
    s = advanceTo(s, 2, 'declareAttackers');
    expect(s.pending?.kind).toBe('declareAttackers');
    const raider = find(s, 'Test Raider', 'battlefield', 'p2');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender: 'p1' }] } as never);
    for (let i = 0; i < 20 && s.designations.initiative !== 'p2'; i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = drive(s);
    }
    expect(s.designations.initiative).toBe('p2');
    s = resolveAll(s);
    expect(dungeonOf(s, 'p2')).toEqual({ name: 'Undercity', room: 0 });
    expect(dungeonOf(s, 'p1')?.name).toBe('Undercity'); // p1 keeps their own dungeon (CR 309.3)
  });
  it('CR 726.5: taking the initiative again while having it ventures again', () => {
    let s = takeIt();
    const again = structuredClone(s);
    for (const id of again.zones.hand['p1']!) delete again.objects[id];
    again.zones.hand['p1'] = [];
    s = resolveAll(castAuto(withHand(again, 'Test Pathfinder'), 'Test Pathfinder'), ['Forge']);
    expect(s.designations.initiative).toBe('p1');
    expect(['Forge', 'Lost Well']).toContain(roomName(s, 'p1'));
  });
});

/** A copy of the state with one more card of that name in p1's hand. */
function withHand(s0: GameState, name: string): GameState {
  const s = structuredClone(s0);
  const def = Object.values(s.defs).find((d) => d.name === name)!;
  const id: ObjectId = `t-${name}`;
  s.objects[id] = { ...structuredClone(s.objects[Object.keys(s.objects).find((k) => s.objects[k]!.defId === def.id) ?? '']!), id, zone: 'hand', owner: 'p1', controller: 'p1' } as never;
  s.zones.hand['p1']!.push(id);
  return s;
}
