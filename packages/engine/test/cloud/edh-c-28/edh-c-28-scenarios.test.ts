/**
 * Commander effort (coordinator C), round edh-c-28: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Alice (p1) is the active player. Each test is named after the rule it checks and has its negative case. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 508.1h, 508.1d, 303.4         "Enchanted creature can't attack unless its controller pays {2}."
 *   CR 508.1h, 509.1d, 402.1         "Enchanted creature can't attack or block unless its controller pays {1} for each card in your hand."
 *   CR 205.1b, 611.2a, 613.1d        "Until end of turn, target land becomes a 3/3 creature that's still a land."
 *   CR 107.3, 608.2h, 613.4b         "Until end of turn, target Forest becomes an X/X Treefolk creature in addition to its other types, where X is the number of Elves you control."
 *   CR 305.7, 205.3i, 613.1d         "Enchanted land is an Island, Swamp, and Forest."
 *   CR 604.1, 611.3a                 "~ gets +1/+1 as long as you control another Merfolk or an Island."
 *   CR 603.1, 702.33d                "Whenever you cast a kicked spell, ..."
 *   CR 614.10, 503.1                 "All players skip their upkeep steps."
 *   CR 603.1, 608.2c, 119.1          "At the beginning of your upkeep, you lose 1 life unless an opponent has 10 or less life."
 *   CR 614.1a, 120.3, 406.2          "If damage would be dealt to a player, that player exiles that many cards from the top of that player's library instead."
 *   CR 614.15, 702.33d, 202.3        "Destroy target artifact if its mana value is 1 or less. If this spell was kicked, destroy that artifact if its mana value is 4 or less instead."
 *   CR 205.1a, 205.3d, 105.3         "Until end of turn, target artifact creature becomes red and isn't an artifact."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackTaxes, blockTaxes } from '../../../src/statics/combat-tax';
import { act, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { activate, target } from '../../m5/cr-examples/helpers';
import { drive, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
/** An Aura (or any attached object) of the card `name` that p1 controls, attached to `to`. */
const attach = (s: GameState, name: string, to: ObjectId, owner = 'p1'): GameState => tweak(s, (t) => { t.objects[put(t, owner, 'battlefield', name)]!.attachedTo = to; });
const tokensOf = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const HOLD = card('Test Hold', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack unless its controller pays {2}.");
const WISDOM = card('Test Wisdom', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block unless its controller pays {1} for each card in your hand.");

describe('CR 508.1h, 508.1d, 303.4: "Enchanted creature can\'t attack unless its controller pays {2}" (the tax of the enchanted creature, whatever it attacks)', () => {
  const board = (): { s: GameState; bear: ObjectId; other: ObjectId } => {
    const s0 = scenario([], { defs: [BEAR, HOLD], p1: { battlefield: ['Test Bear', 'Test Bear'] } });
    const [bear, other] = findAll(s0, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    return { s: attach(s0, 'Test Hold', bear), bear, other };
  };
  it('is automated', () => expect(full(HOLD)).toBe(true));
  it('the enchanted creature costs {2} to attack a player; the cost is the same for a planeswalker or any other defender (`any`)', () => {
    const { s, bear } = board();
    const t = attackTaxes(s, [{ attacker: bear, defender: 'p2' }]);
    expect(t).toHaveLength(1);
    expect(t[0]!.cost).toEqual({ mana: [{ kind: 'generic', amount: 2 }] });
  });
  it('the negative case: a creature the Aura is not attached to attacks free', () => {
    const { s, other } = board();
    expect(attackTaxes(s, [{ attacker: other, defender: 'p2' }])).toEqual([]);
  });
  it('the Aura taxes the attack only (a block costs nothing)', () => {
    const { s, bear } = board();
    expect(blockTaxes(s, [{ blocker: bear, attacker: bear }])).toEqual([]);
  });
});

describe('CR 508.1h, 509.1d, 402.1: "Enchanted creature can\'t attack or block unless its controller pays {1} for each card in your hand" (the Aura controller\'s hand)', () => {
  const board = (hand: string[]): { s: GameState; bear: ObjectId; other: ObjectId } => {
    const s0 = scenario([], { defs: [BEAR, WISDOM], p1: { hand }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    const [bear, other] = findAll(s0, 'Test Bear', 'battlefield', 'p2') as [ObjectId, ObjectId];
    return { s: attach(s0, 'Test Wisdom', bear, 'p1'), bear, other };
  };
  it('is automated', () => expect(full(WISDOM)).toBe(true));
  it('with two cards in the Aura controller\'s hand attacking and blocking each cost {2} (the amount is read as the declaration is made)', () => {
    const { s, bear } = board(['Plains', 'Plains']);
    const a = attackTaxes(s, [{ attacker: bear, defender: 'p1' }]);
    expect(a.map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 2 }] }]);
    const b = blockTaxes(s, [{ blocker: bear, attacker: bear }]);
    expect(b.map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 2 }] }]);
  });
  it('with an empty hand both cost nothing; the enchanted creature\'s own controller\'s hand does not count', () => {
    const { s, bear } = board([]);
    expect(attackTaxes(s, [{ attacker: bear, defender: 'p1' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 0 }] }]);
    const own = tweak(s, (t) => { put(t, 'p2', 'hand', 'Plains'); put(t, 'p2', 'hand', 'Plains'); });
    expect(attackTaxes(own, [{ attacker: bear, defender: 'p1' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 0 }] }]);
  });
  it('the negative case: the other creature is not taxed', () => {
    const { s, other } = board(['Plains']);
    expect(attackTaxes(s, [{ attacker: other, defender: 'p1' }])).toEqual([]);
    expect(blockTaxes(s, [{ blocker: other, attacker: other }])).toEqual([]);
  });
});

describe('CR 205.1b, 611.2a, 613.1d, 613.4b: "Until end of turn, target land becomes a 3/3 creature that\'s still a land"', () => {
  const BOMB = card('Test Land Bomb', 'Artifact', '{1}{G}: Until end of turn, target land becomes a 3/3 creature that\'s still a land.');
  it('is automated', () => expect(full(BOMB)).toBe(true));
  it('the targeted land is a 3/3 Land Creature this turn; another land is not', () => {
    let s = scenario(['Forest'], { defs: [BOMB], p1: { battlefield: ['Test Land Bomb', 'Forest', 'Forest', 'Forest'] } });
    const [f1, f2] = findAll(s, 'Forest', 'battlefield', 'p1') as [ObjectId, ObjectId];
    s = activate(s, find(s, 'Test Land Bomb', 'battlefield'), [target(f1)]);
    s = resolveStack(s);
    const c = getChars(s, f1)!;
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(pt(s, f1)).toBe('3/3');
    expect(getChars(s, f2)!.types).not.toContain('Creature');
  });
});

describe('CR 205.1b, 107.3, 608.2h, 613.4b: "Until end of turn, target Forest becomes an X/X Treefolk creature in addition to its other types, where X is the number of Elves you control" (X counted once, as the ability resolves)', () => {
  const BENDER = card('Test Bender', 'Creature — Elf Druid', '{T}: Until end of turn, target Forest becomes an X/X Treefolk creature in addition to its other types, where X is the number of Elves you control.', ['1', '1']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  it('is automated', () => expect(full(BENDER)).toBe(true));
  it('with two Elves the Forest is a 2/2 Treefolk Forest Land Creature; an Elf arriving later does not change it; a Forest not targeted is unchanged', () => {
    let s = scenario(['Forest'], { defs: [BENDER, ELF], p1: { battlefield: ['Test Bender', 'Test Elf', 'Forest', 'Forest'] } });
    const [f1, f2] = findAll(s, 'Forest', 'battlefield', 'p1') as [ObjectId, ObjectId];
    s = activate(s, find(s, 'Test Bender', 'battlefield'), [target(f1)]);
    s = resolveStack(s);
    const c = getChars(s, f1)!;
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Treefolk']));
    expect(pt(s, f1)).toBe('2/2');
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Elf'); });
    expect(pt(s, f1)).toBe('2/2');
    expect(getChars(s, f2)!.types).not.toContain('Creature');
  });
  it('a Forest is the only target (a Plains is not a legal one)', () => {
    const s = scenario(['Plains'], { defs: [BENDER, ELF], p1: { battlefield: ['Test Bender', 'Plains'] } });
    const spec = s.defs['Test Bender']!.faces[0]!.abilities.find((a) => a.kind === 'activated')!;
    expect(JSON.stringify(spec)).toContain('"subtypes":["Forest"]');
  });
});

describe('CR 305.7, 205.3i, 303.4, 613.1d: "Enchanted land is an Island, Swamp, and Forest" (the land types are set: the old land types and the abilities of the rules text are lost)', () => {
  const GROWTH = card('Test Growth', 'Enchantment — Aura', 'Enchant land\nEnchanted land is an Island, Swamp, and Forest.');
  const TOWER = card('Test Tower', 'Land — Tower', '{T}: Add {C}.');
  it('is automated', () => expect(full(GROWTH)).toBe(true));
  it('the enchanted land has exactly those three land types and no longer has its own mana ability', () => {
    let s = scenario([], { defs: [GROWTH, TOWER], p1: { battlefield: ['Test Tower', 'Plains'] } });
    const tower = find(s, 'Test Tower', 'battlefield');
    const plains = find(s, 'Plains', 'battlefield');
    const before = getChars(s, tower)!;
    expect(before.abilities.some((a) => a.origin === 'printed')).toBe(true);
    s = attach(s, 'Test Growth', tower);
    const c = getChars(s, tower)!;
    expect([...c.subtypes].sort()).toEqual(['Forest', 'Island', 'Swamp']);
    expect(c.abilities.some((a) => a.origin === 'printed')).toBe(false);
    expect(getChars(s, plains)!.subtypes).toEqual(['Plains']);
  });
});

describe('CR 604.1, 611.3a: "~ gets +1/+1 as long as you control another Merfolk or an Island"', () => {
  const SPEAKER = card('Test Speaker', 'Creature — Merfolk Wizard', '~ gets +1/+1 as long as you control another Merfolk or an Island.', ['1', '1']);
  const FISH = card('Test Fish', 'Creature — Merfolk', '', ['1', '1']);
  const speakerOf = (...others: string[]): { s: GameState; id: ObjectId } => {
    const s = scenario(['Island', 'Plains'], { defs: [SPEAKER, FISH], p1: { battlefield: ['Test Speaker', ...others] } });
    return { s, id: find(s, 'Test Speaker', 'battlefield') };
  };
  it('is automated', () => expect(full(SPEAKER)).toBe(true));
  it('another Merfolk makes it 2/2; an Island makes it 2/2; both only +1/+1', () => {
    expect(pt(speakerOf('Test Fish').s, speakerOf('Test Fish').id)).toBe('2/2');
    expect(pt(speakerOf('Island').s, speakerOf('Island').id)).toBe('2/2');
    const both = speakerOf('Test Fish', 'Island');
    expect(pt(both.s, both.id)).toBe('2/2');
  });
  it('the negative cases: itself is a Merfolk but not "another"; a Plains is no Island', () => {
    const alone = speakerOf();
    expect(pt(alone.s, alone.id)).toBe('1/1');
    const plains = speakerOf('Plains');
    expect(pt(plains.s, plains.id)).toBe('1/1');
  });
  it('an opponent\'s Island does not count (you control)', () => {
    const s = scenario(['Island'], { defs: [SPEAKER], p1: { battlefield: ['Test Speaker'] }, p2: { battlefield: ['Island'] } });
    expect(pt(s, find(s, 'Test Speaker', 'battlefield'))).toBe('1/1');
  });
});

describe('CR 603.1, 702.33d: "Whenever you cast a kicked spell, ..." (the spell of the event was kicked)', () => {
  const ROOST = card('Test Roost', 'Enchantment', 'Whenever you cast a kicked spell, create a 1/1 white Spirit creature token with flying.');
  const BOON = card('Test Boon', 'Sorcery', 'Kicker {1}\nYou gain 1 life.');
  const board = (): GameState => scenario(['Plains'], { defs: [ROOST, BOON], p1: { hand: ['Test Boon'], battlefield: ['Test Roost', 'Plains'] } });
  it('is automated', () => expect(full(ROOST)).toBe(true));
  it('casting the spell kicked makes a token (once the trigger resolves)', () => {
    let s = board();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Boon', 'hand', 'p1') });
    s = resolveStack(drive(s, [yes]));
    expect(tokensOf(s)).toHaveLength(1);
  });
  it('the negative case: the same spell cast without kicker makes none', () => {
    let s = board();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Boon', 'hand', 'p1') });
    s = resolveStack(drive(s, [no]));
    expect(tokensOf(s)).toHaveLength(0);
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 614.10, 503.1: "All players skip their upkeep steps"', () => {
  const HUB = card('Test Hub', 'Artifact', 'All players skip their upkeep steps.');
  const PULSE = card('Test Pulse', 'Enchantment', 'At the beginning of each upkeep, you gain 1 life.');
  it('is automated', () => expect(full(HUB)).toBe(true));
  it('upkeep triggers never trigger while a Hub is on the battlefield; without it they do', () => {
    const run = (withHub: boolean): GameState => {
      let s = scenario([], { defs: [HUB, PULSE], p1: { battlefield: withHub ? ['Test Hub', 'Test Pulse'] : ['Test Pulse'] } });
      for (let i = 0; i < 80 && !(s.turn.number >= 2 && s.turn.step === 'draw'); i++) s = s.pending?.kind === 'priority' ? pass(s) : s;
      return s;
    };
    expect(life(run(false), 'p1')).toBeGreaterThan(20);
    expect(life(run(true), 'p1')).toBe(20);
  });
});

describe('CR 603.1, 608.2c, 119.1: "At the beginning of your upkeep, you lose 1 life unless an opponent has 10 or less life" (checked as the ability resolves)', () => {
  const LACE = card('Test Lacerator', 'Creature — Vampire', 'At the beginning of your upkeep, you lose 1 life unless an opponent has 10 or less life.', ['1', '1']);
  const upkeep = (oppLife: number): GameState => {
    let s = scenario([], { defs: [LACE], p1: { battlefield: ['Test Lacerator'] } });
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p2')!.life = oppLife; });
    for (let i = 0; i < 80 && !(s.turn.number >= 3 && s.turn.step === 'draw' && s.turn.activePlayer === 'p1'); i++) {
      if (s.pending?.kind === 'priority') s = pass(s);
      else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] } as never);
      else if (s.pending) s = answer(s, { kind: 'payCost', auto: true });
    }
    return s;
  };
  it('is automated', () => expect(full(LACE)).toBe(true));
  it('with an opponent at 11 life the controller loses 1; with an opponent at 10 life nothing is lost', () => {
    expect(life(upkeep(11), 'p1')).toBeLessThan(20); // 1 life at each of p1's upkeeps up to the third turn
    expect(life(upkeep(10), 'p1')).toBe(20);
  });
});

describe('CR 614.1a, 120.3, 406.2: "If damage would be dealt to a player, that player exiles that many cards from the top of that player\'s library instead" (every player)', () => {
  const SANCT = card('Test Sanctuary', 'Artifact', 'If damage would be dealt to a player, that player exiles that many cards from the top of that player\'s library instead.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');
  const board = (): GameState => scenario(['Island'], { defs: [SANCT, BOLT], p1: { hand: ['Test Bolt'], battlefield: ['Test Sanctuary'] }, p2: { library: Array(10).fill('Island') as string[] } });
  it('is automated', () => expect(full(SANCT)).toBe(true));
  it('3 damage to a player exiles 3 cards from the top of THAT player\'s library and costs no life; the other library is untouched', () => {
    let s = board();
    const lib2 = s.zones.library['p2']!.length;
    const lib1 = s.zones.library['p1']!.length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bolt', 'hand', 'p1') });
    s = resolveStack(drive(s, [target('p2')]));
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.library['p2']!.length).toBe(lib2 - 3);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2')).toHaveLength(3);
    expect(s.zones.library['p1']!.length).toBe(lib1);
  });
  it('the negative case: damage to a creature is dealt as usual (the replacement is about players)', () => {
    const BEAR2 = card('Test Ox', 'Creature — Ox', '', ['4', '4']);
    let s = scenario(['Island'], { defs: [SANCT, BOLT, BEAR2], p1: { hand: ['Test Bolt'], battlefield: ['Test Sanctuary'] }, p2: { battlefield: ['Test Ox'], library: Array(10).fill('Island') as string[] } });
    const ox = find(s, 'Test Ox', 'battlefield');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bolt', 'hand', 'p1') });
    s = resolveStack(drive(s, [target(ox)]));
    expect(s.objects[ox]!.damage).toBe(3);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2')).toHaveLength(0);
  });
});

describe('CR 614.15, 702.33d, 202.3: "Destroy target artifact if its mana value is 1 or less. If this spell was kicked, destroy that artifact if its mana value is 4 or less instead."', () => {
  const BLAST = card('Test Blast', 'Instant', 'Kicker {1}\nDestroy target artifact if its mana value is 1 or less. If this spell was kicked, destroy that artifact if its mana value is 4 or less instead.');
  const CHEAP = card('Test Cheap', 'Artifact', '', undefined, '{1}');
  const DEAR = card('Test Dear', 'Artifact', '', undefined, '{3}');
  const HUGE = card('Test Huge', 'Artifact', '', undefined, '{6}');
  const run = (victim: string, kicked: boolean): GameState => {
    let s = scenario([], { defs: [BLAST, CHEAP, DEAR, HUGE], p1: { hand: ['Test Blast'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: [victim] } });
    const v = find(s, victim, 'battlefield');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blast', 'hand', 'p1') });
    return resolveStack(drive(s, [kicked ? yes : no, target(v)]));
  };
  const alive = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => nameOf(s, id) === name);
  it('is automated', () => expect(full(BLAST)).toBe(true));
  it('not kicked: mana value 1 is destroyed, mana value 3 is not', () => {
    expect(alive(run('Test Cheap', false), 'Test Cheap')).toBe(false);
    expect(alive(run('Test Dear', false), 'Test Dear')).toBe(true);
  });
  it('kicked: mana value 3 is destroyed too, mana value 6 never (the limit is 4)', () => {
    expect(alive(run('Test Dear', true), 'Test Dear')).toBe(false);
    expect(alive(run('Test Huge', true), 'Test Huge')).toBe(true);
  });
});

describe('CR 205.1a, 205.3d, 105.3, 613.1d-e: "Until end of turn, target artifact creature becomes red and isn\'t an artifact" (the artifact subtypes go with the type)', () => {
  const MORPH = card('Test Morph', 'Artifact Creature — Shapeshifter', '{R}: Until end of turn, target artifact creature becomes red and isn\'t an artifact.', ['1', '1']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Equipment Golem', '', ['2', '2']);
  it('is automated', () => expect(full(MORPH)).toBe(true));
  it('the target is red, a creature, no artifact, and loses the artifact subtype Equipment but keeps its creature type; another artifact creature is unchanged', () => {
    let s = scenario(['Mountain'], { defs: [MORPH, GOLEM], p1: { battlefield: ['Test Morph', 'Test Golem', 'Mountain'] } });
    const golem = find(s, 'Test Golem', 'battlefield');
    const morph = find(s, 'Test Morph', 'battlefield');
    s = activate(s, morph, [target(golem)]);
    s = resolveStack(s);
    const c = getChars(s, golem)!;
    expect(c.colors).toEqual(['R']);
    expect(c.types).toContain('Creature');
    expect(c.types).not.toContain('Artifact');
    expect(c.subtypes).not.toContain('Equipment');
    expect(c.subtypes).toContain('Golem');
    expect(getChars(s, morph)!.types).toContain('Artifact');
  });
});
