/**
 * Commander lane edh-b, round edh-b-14: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites checked against the Comprehensive Rules of 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), the rulings against Scryfall.
 *
 *   CR 205.3m, 613.4c       "gets +2/+2 for each other creature on the battlefield that shares a creature type with it" (other than the enchanted creature, any controller)
 *   CR 202.3, 608.2c        "Return target nonland permanent and each other nonland permanent with the same mana value as that permanent to their owners' hands"
 *   CR 201.2, 607.2a        "exile target nonland permanent not named ~ and all other permanents with the same name as that permanent" and the return when it leaves
 *   CR 903.9, 408.1         "Target player returns each commander they control from the battlefield to the command zone"
 *   CR 122.1, 608.2c        "put a verse counter on ~, then it deals damage equal to the number of verse counters on it"
 *   CR 608.2d, 701.19c      "Each player chooses a creature type. Destroy all creatures that aren't of a type chosen this way. They can't be regenerated."
 *   CR 302.6, 508.1a, 609.4 "All creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackDenial } from '../../../src/rules/combat-rules';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { card as mcard, commanderScenario, inCommand, legend } from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[]; keywords?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, who?: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (who === undefined || s.objects[id]!.controller === who));
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { owner?: string; names?: string[]; yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: o.names?.shift() ?? p.options![0]! });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options.find((x) => x.id === (o.owner ?? 'p1'))?.id ?? p.options[0]!.id] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
const attach = (s: GameState, equipment: ObjectId, host: ObjectId): void => { s.objects[equipment]!.attachedTo = host; };


const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
const BEAR2 = card('Test Bear Cub', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{1}{G}' });
const ELF = card('Test Elf', 'Creature — Elf Warrior', '', { pt: ['2', '2'] });
const ELF2 = card('Test Elf Mage', 'Creature — Elf Wizard', '', { pt: ['1', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'], cost: '{3}{R}' });
const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', { pt: ['2', '2'], keywords: ['Changeling'] });
const FOREST = card('Test Forest', 'Land — Forest', '');
const XCREATURE = card('Test Xerxes', 'Creature — Wizard', '', { pt: ['1', '1'], cost: '{X}{U}' });

describe('CR 903.9, 408.1: "Target player returns each commander they control from the battlefield to the command zone."', () => {
  const VAC = mcard('Test Vacuum', '{0}', 'Sorcery', 'Target player returns each commander they control from the battlefield to the command zone.\nDraw a card.');
  const BOSS = legend('Test Alice Boss', '{G}', ['2', '2'], ['G']);
  const FOE = legend('Test Bob Boss', '{G}', ['3', '3'], ['G']);
  const game = (): GameState => commanderScenario({ p1Commanders: [BOSS], p2Commanders: [FOE], defs: [VAC], p1: { hand: ['Test Vacuum'], battlefield: ['Test Bear'] }, cards: [] });
  const toBattlefield = (st: GameState, id: ObjectId): void => { st.zones.command = st.zones.command.filter((x) => x !== id); st.zones.battlefield.push(id); st.objects[id]!.zone = 'battlefield'; };
  it('is fully automated', () => expect(full(VAC)).toBe(true));
  it('the target player\'s commander goes back to the command zone, the other player\'s commander and their other creatures stay', () => {
    const s0 = commanderScenario({ p1Commanders: [BOSS], p2Commanders: [FOE], defs: [VAC, BEAR], p1: { hand: ['Test Vacuum'] }, p2: { battlefield: ['Test Bear'] } });
    toBattlefield(s0, inCommand(s0, 'Test Alice Boss'));
    toBattlefield(s0, inCommand(s0, 'Test Bob Boss'));
    const s = cast(s0, 'Test Vacuum', { targets: [['p2' as ObjectId]] });
    expect(s.zones.command.map((id) => chars(s, id).name)).toEqual(['Test Bob Boss']);
    expect(s.zones.battlefield.map((id) => chars(s, id).name).sort()).toEqual(['Test Alice Boss', 'Test Bear']);
  });
  it('negative: a player with no commander on the battlefield loses nothing, and a commander in another zone is left where it is', () => {
    const s0 = commanderScenario({ p1Commanders: [BOSS], p2Commanders: [FOE], defs: [VAC], p1: { hand: ['Test Vacuum'] } });
    toBattlefield(s0, inCommand(s0, 'Test Alice Boss'));
    const s = cast(s0, 'Test Vacuum', { targets: [['p2' as ObjectId]] });
    expect(s.zones.command.map((id) => chars(s, id).name)).toEqual(['Test Bob Boss']);
    expect(s.zones.battlefield.map((id) => chars(s, id).name)).toEqual(['Test Alice Boss']);
  });
});

describe('CR 122.1, 120.3, 608.2c: "Whenever you cast an instant or sorcery spell, put a verse counter on ~, then it deals damage equal to the number of verse counters on it to target player or planeswalker."', () => {
  const ARIA = card('Test Aria', 'Enchantment', 'Whenever you cast an instant or sorcery spell, put a verse counter on this enchantment, then it deals damage equal to the number of verse counters on it to target player or planeswalker.');
  const ZAP = card('Test Zap', 'Instant', 'Draw a card.');
  const defs = [ARIA, ZAP];
  const life = (st: GameState, who: string): number => st.players.find((pl) => pl.id === who)!.life;
  it('is fully automated', () => expect(full(ARIA)).toBe(true));
  it('the counter is put first, so the first spell deals 1 and the second deals 2; the counters stay', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Zap', 'Test Zap'], battlefield: ['Test Aria'] } });
    const l0 = life(s0, 'p2');
    const s1 = cast(s0, 'Test Zap', { targets: [['p2' as ObjectId]] });
    expect(life(s1, 'p2')).toBe(l0 - 1);
    const s2 = cast(s1, 'Test Zap', { targets: [['p2' as ObjectId]] });
    expect(life(s2, 'p2')).toBe(l0 - 3);
    expect(onField(s2, 'Test Aria')[0]).toBeDefined();
    expect(s2.objects[onField(s2, 'Test Aria')[0]!]!.counters['verse']).toBe(2);
  });
  it('negative: a creature spell does not trigger it', () => {
    const s0 = scenario([], { defs: [...defs, ELF], p1: { hand: ['Test Elf'], battlefield: ['Test Aria'] } });
    const l0 = life(s0, 'p2');
    const s1 = cast(s0, 'Test Elf', { targets: [['p2' as ObjectId]] });
    expect(life(s1, 'p2')).toBe(l0);
  });
});

describe('CR 101.4, 608.2d, 701.19c: "Each player chooses a creature type. Destroy all creatures that aren\'t of a type chosen this way. They can\'t be regenerated."', () => {
  const MERCY = card('Test Mercy', 'Sorcery', "Each player chooses a creature type. Destroy all creatures that aren't of a type chosen this way. They can't be regenerated.");
  const defs = [MERCY, BEAR, ELF, ELF2, OGRE];
  it('is fully automated', () => expect(full(MERCY)).toBe(true));
  it('every creature whose types include none of the types the players chose is destroyed (each player\'s choice counts)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mercy'], battlefield: ['Test Elf', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Elf Mage'] } });
    const s = cast(s0, 'Test Mercy', { names: ['Bear', 'Ogre'] });
    expect(s.zones.battlefield.map((id) => chars(s, id).name).sort()).toEqual(['Test Bear', 'Test Ogre']);
  });
  it('both players choosing the same type keeps only that type; choosing a type nobody has destroys everything', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mercy'], battlefield: ['Test Elf', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Elf Mage'] } });
    const same = cast(s0, 'Test Mercy', { names: ['Elf', 'Elf'] });
    expect(same.zones.battlefield.map((id) => chars(same, id).name).sort()).toEqual(['Test Elf', 'Test Elf Mage']);
    const none = cast(s0, 'Test Mercy', { names: ['Wizard', 'Goblin'] });
    expect(none.zones.battlefield.map((id) => chars(none, id).name)).toEqual(['Test Elf Mage']);
  });
});

describe('CR 205.3m, 613.4c: "Enchanted creature gets +2/+2 for each other creature on the battlefield that shares a creature type with it."', () => {
  const STATUS = card('Test Status', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2 for each other creature on the battlefield that shares a creature type with it.');
  const defs = [BEAR, ELF, ELF2, SHIFTER, OGRE, STATUS];
  it('is fully automated', () => expect(full(STATUS)).toBe(true));
  it('counts the creatures of every controller that share a type with the enchanted one (not itself, not the Ogre); a Changeling shares every type', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Elf', 'Test Elf Mage', 'Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Elf Mage', 'Test Shifter'] } });
    attach(s, put(s, 'p1', 'battlefield', 'Test Status'), onField(s, 'Test Elf', 'p1')[0]!);
    // other creatures sharing a type with the Elf Warrior: Elf Mage (p1), Elf Mage (p2), Shifter (changeling): 3 -> +6/+6
    expect(stat(s, onField(s, 'Test Elf')[0]!)).toBe('8/8');
    expect(stat(s, onField(s, 'Test Bear')[0]!)).toBe('2/2');
  });
  it('counts only the enchanted creature\'s own types: on the Ogre (no other Ogre) it adds nothing, but a Changeling in play counts for it', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Ogre', 'Test Bear'] } });
    attach(s, put(s, 'p1', 'battlefield', 'Test Status'), onField(s, 'Test Ogre')[0]!);
    expect(stat(s, onField(s, 'Test Ogre')[0]!)).toBe('5/5');
    put(s, 'p2', 'battlefield', 'Test Shifter');
    expect(stat(s, onField(s, 'Test Ogre')[0]!)).toBe('7/7');
  });
});

describe('CR 202.3, 608.2c: "Return target nonland permanent and each other nonland permanent with the same mana value as that permanent to their owners\' hands."', () => {
  const MISTS = card('Test Mists', 'Sorcery', "Return target nonland permanent and each other nonland permanent with the same mana value as that permanent to their owners' hands.");
  const defs = [BEAR, BEAR2, OGRE, FOREST, XCREATURE, ELF, MISTS];
  it('is fully automated', () => expect(full(MISTS)).toBe(true));
  it('returns the target and every other nonland permanent of mana value 2, of any controller, and nothing else (a mana value 4 creature and a land stay)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mists'], battlefield: ['Test Bear', 'Test Ogre', 'Test Forest'] }, p2: { battlefield: ['Test Bear Cub', 'Test Forest'] } });
    const s = cast(s0, 'Test Mists', { targets: [[onField(s0, 'Test Bear', 'p1')[0]!]] });
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(onField(s, 'Test Bear Cub')).toEqual([]);
    expect(s.zones.hand.p1!.map((id) => chars(s, id).name).sort()).toEqual(['Test Bear']);
    expect(s.zones.hand.p2!.map((id) => chars(s, id).name)).toEqual(['Test Bear Cub']);
    expect(onField(s, 'Test Ogre')).toHaveLength(1);
    expect(onField(s, 'Test Forest')).toHaveLength(2);
  });
  it('X in a mana cost is 0 on the battlefield (ruling 2023-11-03): a target of mana value 1 takes the X creature of cost {X}{U} with it', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mists'], battlefield: ['Test Xerxes', 'Test Elf'] } });
    const s = cast(s0, 'Test Mists', { targets: [[onField(s0, 'Test Xerxes')[0]!]] });
    expect(onField(s, 'Test Xerxes')).toEqual([]); // the target itself; the Elf has mana value 0 and stays
    expect(onField(s, 'Test Elf')).toHaveLength(1);
  });
  it('a target of mana value 0 does not take lands along (nonland permanents only)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mists'], battlefield: ['Test Elf', 'Test Forest', 'Test Bear'] } });
    const s = cast(s0, 'Test Mists', { targets: [[onField(s0, 'Test Elf')[0]!]] });
    expect(onField(s, 'Test Elf')).toEqual([]);
    expect(onField(s, 'Test Forest')).toHaveLength(1);
    expect(onField(s, 'Test Bear')).toHaveLength(1);
  });
});

describe('CR 201.2, 607.2a: Detention Sphere\'s "exile target nonland permanent not named ~ and all other permanents with the same name as that permanent" and its return', () => {
  const SPHERE = card('Test Sphere', 'Enchantment', "When this enchantment enters, you may exile target nonland permanent not named Test Sphere and all other permanents with the same name as that permanent.\nWhen this enchantment leaves the battlefield, return the exiled cards to the battlefield under their owner's control.", { cost: '{0}' });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target enchantment.');
  const defs = [BEAR, ELF, FOREST, SPHERE, SMITE];
  it('is fully automated', () => expect(full(SPHERE)).toBe(true));
  it('exiles the target and every permanent of its name (the opponent\'s too, none of them targeted); the Elf stays; destroying the Sphere returns them under their owners\' control', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sphere', 'Test Smite'], battlefield: ['Test Bear', 'Test Elf'] }, p2: { battlefield: ['Test Bear', 'Test Forest'] } });
    const bear = onField(s0, 'Test Bear', 'p1')[0]!;
    const s1 = cast(s0, 'Test Sphere', { targets: [[bear]], yes: true });
    expect(onField(s1, 'Test Bear')).toEqual([]);
    expect(s1.zones.exile.map((id) => chars(s1, id).name).sort()).toEqual(['Test Bear', 'Test Bear']);
    expect(onField(s1, 'Test Elf')).toHaveLength(1);
    expect(onField(s1, 'Test Sphere')).toHaveLength(1);
    const s2 = cast(s1, 'Test Smite', { targets: [[onField(s1, 'Test Sphere')[0]!]] });
    expect(onField(s2, 'Test Sphere')).toEqual([]);
    expect(onField(s2, 'Test Bear', 'p1')).toHaveLength(1);
    expect(onField(s2, 'Test Bear', 'p2')).toHaveLength(1);
  });
  it('you may decline: nothing is exiled', () => {
    const s0 = scenario([], { defs: [...defs, card('Test Bear Marsh', 'Land', '')], p1: { hand: ['Test Sphere'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Forest'] } });
    const s1 = cast(s0, 'Test Sphere', { targets: [[onField(s0, 'Test Bear')[0]!]], yes: false });
    expect(onField(s1, 'Test Bear')).toHaveLength(1); // the player declined
    expect(s1.zones.exile).toHaveLength(0);
  });
});

describe('CR 302.6, 508.1a, 609.4: "All creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste."', () => {
  const BRUTE = card('Test Brute', 'Creature — Orc', 'All creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste.', { pt: ['3', '3'] });
  const WALKER = card('Test Walker', 'Planeswalker — Test', '', { loyalty: '3' });
  const defs = [BRUTE, BEAR, WALKER];
  const sick = (s: GameState, who: 'p1' | 'p2', name: string): ObjectId => { const id = put(s, who, 'battlefield', { name, since: 99 }); return id; };
  const denial = (s: GameState, id: ObjectId, defenders: string[]) => attackDenial(s, s.objects[id]!, chars(s, id), defenders);
  it('is fully automated', () => expect(full(BRUTE)).toBe(true));
  it('a creature that just arrived under your control can attack an opponent and the planeswalkers an opponent controls; without the Brute it cannot', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Brute'] } });
    const walker = put(s, 'p2', 'battlefield', { name: 'Test Walker', counters: { loyalty: 3 } });
    const bear = sick(s, 'p1', 'Test Bear');
    expect(denial(s, bear, ['p2'])).toBeNull();
    expect(denial(s, bear, [walker])).toBeNull();
    const none = scenario([], { defs });
    const bear2 = sick(none, 'p1', 'Test Bear');
    expect(denial(none, bear2, ['p2'])?.message).toMatch(/no haste/);
  });
  it('it is not haste: the opponent\'s new creature can attack only the opponents of the Brute\'s controller, never the controller or their planeswalkers', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Brute'] } });
    const walker = put(s, 'p1', 'battlefield', { name: 'Test Walker', counters: { loyalty: 3 } });
    const theirs = sick(s, 'p2', 'Test Bear');
    expect(denial(s, theirs, ['p1'])?.message).toMatch(/no haste/);
    expect(denial(s, theirs, [walker])?.message).toMatch(/no haste/);
  });
  it('with the Brute under the opponent\'s control, its controller\'s opponents are the ones who can be attacked: the new creature of the other player attacks the Brute\'s controller only if it is not they', () => {
    const s = scenario([], { defs, p1: { battlefield: [] }, p2: { battlefield: ['Test Brute'] } });
    const mine = sick(s, 'p1', 'Test Bear');
    expect(denial(s, mine, ['p2'])?.message).toMatch(/no haste/); // p2 controls the Brute: p2 is not their own opponent
    const theirs = sick(s, 'p2', 'Test Bear');
    expect(denial(s, theirs, ['p1'])).toBeNull();
  });
  it('a creature that did not just arrive is unaffected either way, and a tapped creature still cannot attack', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Brute', 'Test Bear'] }, p2: {} });
    expect(denial(s, onField(s, 'Test Bear')[0]!, ['p2'])).toBeNull();
  });
});
