/**
 * Commander coordinator B, round edh-b-9: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.3a-b, 301.5c        "Attach all Equipment you control to ~." (Balan, Wandering Knight)
 *   CR 701.3a, 603.2, 201.5    "Whenever ~ enters or attacks, you may attach any number of target Equipment to it." (Armory Automaton)
 *   CR 120.2b, 107.3, 608.2h   "~ deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard." (Cavalier of Flame)
 *   CR 701.3a, 608.2c, 111.1   "Create a Food token, then create a 1/1 ... Halfling creature token and attach this Equipment to it." (Field-Tested Frying Pan)
 *   CR 122.1, 702.164c         "That player gets an additional poison counter." (Necrogen Rotpriest)
 *   CR 122.1, 608.2d           "Put a +1/+1 counter on each of up to two Soldiers you control." (SOLDIER Military Program)
 *   CR 119.1, 608.2c           "Two target players exchange life totals. You create an X/X ... token, where X is the difference between those players' life totals." (Profane Transfusion)
 *   CR 119.5, 608.2f           "Each player's life total becomes the number of creatures they control." (Shaman of Forgotten Ways)
 *   CR 205.3m, 613.1f          "Scions and Spawns you control gain indestructible and annihilator 1 until end of turn." (Azlask, the Swelling Scourge)
 *   CR 111.4, 608.2c, 122.1    "Create a number of 1/1 Pest tokens equal to the number of +1/+1 counters on ~. They have ..." (Ribtruss Roaster)
 *   CR 106.4, 605.1b           "Whenever enchanted land is tapped for mana, its controller adds an additional {G} for each Elf on the battlefield." (Elvish Guidance)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { mpScenario, lifeOf } from '../../m12/rules/helpers';
import { charsOfObject } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [...new Set(cost.match(/[WUBRG]/g) ?? [])], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

interface Script { targets?: TargetChoice[][]; objects?: ObjectId[][]; yes?: boolean }
/** Answer the decisions that come up until a player has priority with an empty stack: the script in order, else the fewest allowed; yes to an option. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let g = 0; g < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const p = s.pending;
    if (p?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? true });
    else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.max ?? p.options.length) });
    else if (p?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (p?.kind === 'priority') s = pass(s);
    else break;
  }
  return s;
}
/** Pass priority (declaring no attackers) until the step is reached with a player holding priority. */
function toStep(s0: GameState, step: GameState['turn']['step'], stackNotEmpty = false): GameState {
  let s = s0;
  for (let g = 0; g < 120 && !(s.turn.step === step && s.pending?.kind === 'priority' && (s.zones.stack.length > 0) === stackNotEmpty); g++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] } as never);
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = drive(s);
  }
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never), script);
const activate = (s: GameState, name: string, ability = 'p:0:0', script: Script = {}): GameState => drive(act(s, { type: 'activate', player: 'p1', source: find(s, name, 'battlefield', 'p1'), ability } as never), script);
const onBattlefield = (s: GameState, name: string, owner?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (owner === undefined || s.objects[id]!.controller === owner));
const attachedTo = (s: GameState, id: ObjectId): ObjectId | null | undefined => s.objects[id]?.attachedTo;
const nameOf = (s: GameState, id: ObjectId | null | undefined): string | undefined => (id ? s.defs[s.objects[id]!.defId]!.name : undefined);

const BALAN = card('Test Knight Captain', 'Legendary Creature — Cat Knight', '{0}: Attach all Equipment you control to ~.', ['2', '2']);
const SWORD = card('Test Plain Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}');
const SHIELD = card('Test Plain Shield', 'Artifact — Equipment', 'Equipped creature gets +0/+1.\nEquip {1}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const AUTOMATON = card('Test Armory Golem', 'Artifact Creature — Construct', 'Whenever this creature enters or attacks, you may attach any number of target Equipment to it.', ['2', '2']);
const CAVALIER = card('Test Flame Knight', 'Creature — Elemental Knight', 'When this creature dies, it deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard.', ['1', '1']);
const WALKER = card('Test Walker', 'Planeswalker — Test', '', undefined, '{0}', '5');
const PAN = card('Test Frying Pan', 'Artifact — Equipment', 'When this Equipment enters, create a Food token, then create a 1/1 white Halfling creature token and attach this Equipment to it.\nEquipped creature gets +1/+1.\nEquip {2}');
const ROTPRIEST = card('Test Rot Priest', 'Creature — Zombie', 'When this creature enters, target opponent gets an additional poison counter.', ['2', '2']);
const PROGRAM = card('Test Soldier Program', 'Enchantment', 'At the beginning of combat on your turn, put a +1/+1 counter on each of up to two Soldiers you control.');
const SOLDIER = card('Test Soldier', 'Creature — Soldier', '', ['1', '1']);
const TRANSFUSION = card('Test Profane Draft', 'Sorcery', "Two target players exchange life totals. You create an X/X colorless Horror artifact creature token, where X is the difference between those players' life totals.");
const SHAMAN = card('Test Formidable Shaman', 'Creature — Human Shaman', "{0}: Each player's life total becomes the number of creatures they control.", ['1', '1']);
const AZLASK = card('Test Swelling Scourge', 'Creature — Eldrazi', '{0}: Scions and Spawns you control gain indestructible and annihilator 1 until end of turn.', ['3', '3']);
const SCION = card('Test Scion', 'Creature — Eldrazi Scion', '', ['1', '1']);
const SPAWN = card('Test Spawn', 'Creature — Eldrazi Spawn', '', ['0', '1']);
const ROASTER = card('Test Pest Roaster', 'Creature — Troll Druid', 'At the beginning of your end step, create a number of 1/1 black and green Pest creature tokens equal to the number of +1/+1 counters on this creature. They have "When this token dies, you gain 1 life."', ['0', '0']);
const GUIDANCE = card('Test Elvish Blessing', 'Enchantment — Aura', 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G} for each Elf on the battlefield.');
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const ALTAR = card('Test Altar', 'Artifact', '{0}, Sacrifice a creature: You gain 1 life.');
const DEFS = [ALTAR, BALAN, SWORD, SHIELD, BEAR, AUTOMATON, CAVALIER, WALKER, PAN, ROTPRIEST, PROGRAM, SOLDIER, TRANSFUSION, SHAMAN, AZLASK, SCION, SPAWN, ROASTER, GUIDANCE, ELF];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [BALAN, AUTOMATON, CAVALIER, PAN, ROTPRIEST, PROGRAM, TRANSFUSION, SHAMAN, AZLASK, ROASTER, GUIDANCE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.3a-b: "Attach all Equipment you control to ~."', () => {
  it('every Equipment its controller controls moves to the creature; an opponent\'s Equipment stays where it is', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Knight Captain', 'Test Plain Sword', 'Test Plain Shield', 'Test Bear'] }, p2: { battlefield: ['Test Plain Sword'] } } });
    const sword = onBattlefield(s, 'Test Plain Sword', 'p1')[0]!;
    const theirs = onBattlefield(s, 'Test Plain Sword', 'p2')[0]!;
    const bear = onBattlefield(s, 'Test Bear')[0]!;
    s.objects[sword]!.attachedTo = bear; // (setup: attached to another creature first)
    s = activate(s, 'Test Knight Captain');
    const knight = onBattlefield(s, 'Test Knight Captain')[0]!;
    expect(attachedTo(s, sword)).toBe(knight);
    expect(attachedTo(s, onBattlefield(s, 'Test Plain Shield')[0]!)).toBe(knight);
    expect(attachedTo(s, theirs) ?? null).toBe(null);
  });
  it('with no Equipment nothing happens (and the game goes on)', () => {
    const s = activate(mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Knight Captain', 'Test Bear'] } } }), 'Test Knight Captain');
    expect(onBattlefield(s, 'Test Knight Captain').length).toBe(1);
  });
});

describe('CR 701.3a, 603.2, 201.5: "Whenever ~ enters or attacks, you may attach any number of target Equipment to it."', () => {
  it('on entering, the Equipment chosen as targets are attached to ~ itself (the object of the trigger), not to another creature', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Armory Golem'], battlefield: ['Test Plain Sword', 'Test Bear'] } } });
    const sword = onBattlefield(s, 'Test Plain Sword')[0]!;
    s.objects[sword]!.attachedTo = onBattlefield(s, 'Test Bear')[0]!;
    s = cast(s, 'Test Armory Golem', { targets: [[{ kind: 'object', id: sword }]] });
    expect(nameOf(s, attachedTo(s, sword))).toBe('Test Armory Golem');
  });
  it('declining the "may" leaves the Equipment where it was', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Armory Golem'], battlefield: ['Test Plain Sword', 'Test Bear'] } } });
    const sword = onBattlefield(s, 'Test Plain Sword')[0]!;
    const bear = onBattlefield(s, 'Test Bear')[0]!;
    s.objects[sword]!.attachedTo = bear;
    s = cast(s, 'Test Armory Golem', { targets: [[{ kind: 'object', id: sword }]], yes: false });
    expect(attachedTo(s, sword)).toBe(bear);
  });
});

describe('CR 120.2b, 107.3, 608.2h: "~ deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard."', () => {
  const dies = (): GameState => {
    let s = mpScenario({ defs: DEFS, cards: ['Island'], zones: { p1: { battlefield: ['Test Flame Knight', { name: 'Test Walker', counters: { loyalty: 5 } }], graveyard: ['Plains', 'Plains', 'Island', 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 5 } }], graveyard: ['Plains'] } } });
    // kill ~ with state-based actions: lethal damage
    s.objects[onBattlefield(s, 'Test Flame Knight')[0]!]!.damage = 1;
    return drive(pass(s));
  };
  it('3 land cards in your graveyard deal 3 to each opponent and to each planeswalker an opponent controls; your own planeswalker and the Bear card do not count or take damage', () => {
    const s = dies();
    expect([1, 2, 3, 4].map((i) => lifeOf(s, `p${i}`))).toEqual([20, 17, 17, 17]);
    const walkers = findAll(s, 'Test Walker', 'battlefield');
    const loyaltyOf = (owner: string): number | undefined => s.objects[walkers.find((id) => s.objects[id]!.controller === owner)!]?.counters['loyalty'];
    expect(loyaltyOf('p1')).toBe(5);
    expect(loyaltyOf('p2')).toBe(2);
  });
});

describe('CR 701.3a, 608.2c, 111.1: "Create a Food token, then create a 1/1 Halfling creature token and attach this Equipment to it."', () => {
  it('the Equipment is attached to the Halfling (the token made last), never left on the Food', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Frying Pan'] } } });
    s = cast(s, 'Test Frying Pan');
    const pan = onBattlefield(s, 'Test Frying Pan')[0]!;
    expect(nameOf(s, attachedTo(s, pan))).toBe('Halfling Token');
    expect(onBattlefield(s, 'Food Token').length).toBe(1);
    expect(attachedTo(s, onBattlefield(s, 'Food Token')[0]!) ?? null).toBe(null);
  });
});

describe('CR 122.1, 702.164c: "that player gets an additional poison counter."', () => {
  it('the target opponent gets one poison counter, no one else does', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Rot Priest'] } } });
    s = cast(s, 'Test Rot Priest', { targets: [[{ kind: 'player', id: 'p3' }]] });
    expect(s.players.map((p) => p.poison)).toEqual([0, 0, 1, 0]);
  });
});

describe('CR 122.1, 608.2d: "Put a +1/+1 counter on each of up to two Soldiers you control."', () => {
  const combat = (): GameState => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Soldier Program', 'Test Soldier', 'Test Soldier', 'Test Soldier', 'Test Bear'] }, p2: { battlefield: ['Test Soldier'] } } });
    s = toStep(s, 'beginCombat', true);
    return drive(s);
  };
  it('exactly two Soldiers you control get a counter (the third, the Bear and the opponent\'s Soldier do not)', () => {
    const s = combat();
    const counters = (id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
    const mine = onBattlefield(s, 'Test Soldier', 'p1').map(counters).sort();
    expect(s.log.some((l) => /Test Soldier Program/.test(l.text))).toBe(true);
    expect(mine).toEqual([0, 1, 1]);
    expect(counters(onBattlefield(s, 'Test Bear')[0]!)).toBe(0);
    expect(counters(onBattlefield(s, 'Test Soldier', 'p2')[0]!)).toBe(0);
  });
});

describe('CR 119.1, 608.2c: "Two target players exchange life totals. You create an X/X token, where X is the difference between those players\' life totals."', () => {
  const play = (a: number, b: number): GameState => {
    const s0 = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Profane Draft'] } }, setup: (g) => { g.players[1]!.life = a; g.players[2]!.life = b; } });
    return cast(s0, 'Test Profane Draft', { targets: [[{ kind: 'player', id: 'p2' }, { kind: 'player', id: 'p3' }]] });
  };
  it('the totals are exchanged and the Horror is as big as their difference (7 and 20: 13/13)', () => {
    const s = play(7, 20);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([20, 7]);
    const horrors = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Horror Token');
    expect(horrors.length).toBe(1);
    const c = charsOfObject(s, s.objects[horrors[0]!]!);
    expect([Number(c.power), Number(c.toughness)]).toEqual([13, 13]);
  });
  it('equal totals make an 0/0 token that dies at once (the difference is never negative)', () => {
    const s = play(12, 12);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Horror Token').length).toBe(0);
  });
});

describe('CR 119.5, 608.2f: "Each player\'s life total becomes the number of creatures they control."', () => {
  const play = (): GameState => {
    const s0 = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Formidable Shaman', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
    return activate(s0, 'Test Formidable Shaman');
  };
  it('each player\'s total becomes the number of creatures that player controls (3, 1, 5; a player with none would lose)', () => {
    const s = play();
    expect([1, 2, 3].map((i) => lifeOf(s, `p${i}`))).toEqual([3, 1, 5]);
  });
  it('a player with no creatures has 0 life and loses the game (CR 704.5a), the others go on', () => {
    const s = play();
    expect(s.players.find((p) => p.id === 'p4')!.life).toBe(0);
    expect(s.players.find((p) => p.id === 'p4')!.hasLost).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost ?? false).toBe(false);
  });
});

describe('CR 205.3m, 613.1f: "Scions and Spawns you control gain indestructible and annihilator 1 until end of turn."', () => {
  const has = (s: GameState, id: ObjectId, kw: string): boolean => charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === kw);
  it('Scions and Spawns you control gain both; a Bear and an opponent\'s Spawn do not', () => {
    const s = activate(mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Swelling Scourge', 'Test Scion', 'Test Spawn', 'Test Bear'] }, p2: { battlefield: ['Test Spawn'] } } }), 'Test Swelling Scourge');
    for (const [name, owner, yes] of [['Test Scion', 'p1', true], ['Test Spawn', 'p1', true], ['Test Bear', 'p1', false], ['Test Spawn', 'p2', false]] as const) {
      const id = onBattlefield(s, name, owner)[0]!;
      expect(has(s, id, 'indestructible'), `${name} ${owner} indestructible`).toBe(yes);
      expect(has(s, id, 'annihilator'), `${name} ${owner} annihilator`).toBe(yes);
    }
  });
});

describe('CR 111.4, 608.2c, 122.1: "Create a number of 1/1 Pest tokens equal to the number of +1/+1 counters on ~. They have ..."', () => {
  const endStep = (counters: number): GameState => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: [{ name: 'Test Pest Roaster', counters: { '+1/+1': counters } }] } } });
    s = toStep(s, 'end', true);
    return drive(s);
  };
  it('three +1/+1 counters make three Pests, each of which gains its controller 1 life when it dies', () => {
    const s = endStep(3);
    const pests = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Pest Token');
    expect(pests.length).toBe(3);
    const before = lifeOf(s, 'p1');
    s.objects[pests[0]!]!.damage = 1;
    expect(lifeOf(drive(pass(s)), 'p1')).toBe(before + 1);
  });
  it('if the Roaster left the battlefield before the ability resolves, the +1/+1 counters it had as it last existed set the number (Scryfall ruling 2026-03-20)', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: [{ name: 'Test Pest Roaster', counters: { '+1/+1': 2 } }, 'Test Altar'] } } });
    s = toStep(s, 'end', true);
    s = drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Altar', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { objects: [[find(s, 'Test Pest Roaster', 'battlefield', 'p1')]] });
    expect(onBattlefield(s, 'Test Pest Roaster').length).toBe(0);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Pest Token').length).toBe(2);
  });
  it('with no counter on it no token is made', () => {
    const s = endStep(0);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Pest Token').length).toBe(0);
  });
});

describe('CR 106.4, 605.1b: "Whenever enchanted land is tapped for mana, its controller adds an additional {G} for each Elf on the battlefield."', () => {
  const tap = (elves: { p1: number; p2: number }): GameState => {
    let s = mpScenario({ defs: DEFS, cards: ['Forest'], zones: { p1: { hand: [], battlefield: ['Forest', 'Test Elvish Blessing', ...Array(elves.p1).fill('Test Elf')] }, p2: { battlefield: Array(elves.p2).fill('Test Elf') } }, setup: (g) => {
      const aura = g.zones.battlefield.find((id) => g.defs[g.objects[id]!.defId]!.name === 'Test Elvish Blessing')!;
      const land = g.zones.battlefield.find((id) => g.defs[g.objects[id]!.defId]!.name === 'Forest')!;
      g.objects[aura]!.attachedTo = land;
    } });
    s = drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Forest', 'battlefield', 'p1'), ability: 'r:basic:G' } as never));
    return s;
  };
  it('tapping the land gives {G} plus one {G} for each Elf, yours and an opponent\'s (1 + 2 + 1)', () => {
    const s = tap({ p1: 2, p2: 1 });
    expect(s.players[0]!.manaPool.filter((u) => u.type === 'G').length).toBe(4);
  });
  it('with no Elf the land gives just its own {G}', () => {
    expect(tap({ p1: 0, p2: 0 }).players[0]!.manaPool.filter((u) => u.type === 'G').length).toBe(1);
  });
});
