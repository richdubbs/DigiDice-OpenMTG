/**
 * FAST4 T28: the counter shapes of parser/templates/zz-fast4/t28.json (and the hole-grammar, lowering and renderer readings the package added) played through
 * the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 701.10e              "double the number of +1/+1 counters on each creature you control" / "on target creature": as many as each one has
 *   CR 608.2h, 603.10a      "put a number of +1/+1 counters on ~ equal to that creature's power": the power it had as it last existed on the battlefield
 *   CR 608.2c               "put two +1/+1 counters on it if you gained life this turn": checked as the ability resolves
 *   CR 608.2c               "Then put a +1/+1 counter on each creature you control" after creating tokens: the tokens get one too
 *   CR 608.2h               "put a +1/+1 counter on it for each Forest you control"
 *   CR 614.1c, 614.12       "~ enters with a +1/+1 counter on it for each creature card in your graveyard / creature that died this turn", "with X counters,
 *                           where X is the number of other creatures on the battlefield", "for each other creature and/or artifact you control"
 *   CR 614.1c, 122.6        "Each Elf you control enters with an additional +1/+1 counter on it" (static) and "This turn, each creature you control enters
 *                           with an additional +1/+1 counter on it" (a resolved replacement effect that ends with the turn, CR 611.2a, 514.2)
 *   CR 601.2d, 603.3d       "distribute three +1/+1 counters among one or two target creatures": the division announced on casting, or as a
 *                           triggered ability is put on the stack
 *   CR 608.2h               "counter target spell. Put X +1/+1 counters on ~, where X is that spell's mana value": the countered spell's mana value (last known information)
 *   CR 122.1b               "put a +1/+1 counter and a flying counter on target creature", "put a double strike counter on ~": keyword counters
 *   CR 608.2c               "put a +1/+1 counter on that creature and a +1/+1 counter on ~"
 *   CR 122.8                "When ~ dies, put its +1/+1 counters on target creature you control": as many as it had on the battlefield
 *   CR 107.3, 608.2h        "put X +1/+1 counters on each creature you control, where X is ~'s power": X fixed once; "where X is that spell's mana value"
 *   CR 109.2                "put a +1/+1 counter on each creature you control other than ~"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { advanceTo, answer, find, findAll, pass, scenario } from '../../m5/helpers';
import { activate, cast, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability or step) and the card full (the T28 templates are stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ctr = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '1']);
const RELIC = card('Test Relic', 'Artifact', '');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['1', '1']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const BALM = card('Test Balm', 'Instant', 'You gain 2 life.');

describe('CR 701.10e: "double the number of +1/+1 counters on ..."', () => {
  const SOWER = card('Test Spine Sower', 'Enchantment', '{0}: Double the number of +1/+1 counters on each creature you control.');
  const LENS = card('Test Doubling Lens', 'Artifact', '{0}: Double the number of +1/+1 counters on target creature.');
  it('each creature you control gets as many counters as it has; an opponent\'s creature and a creature without counters get none', () => {
    expect(full(SOWER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Spine Sower', { name: 'Test Elf', counters: { '+1/+1': 2 } }, 'Test Ogre'] }, p2: { battlefield: [{ name: 'Test Elf', counters: { '+1/+1': 3 } }] }, defs: [SOWER, ELF, OGRE] });
    s = resolveTop(activate(s, find(s, 'Test Spine Sower', 'battlefield')));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe(4);
    expect(ctr(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe(0);
    expect(ctr(s, find(s, 'Test Elf', 'battlefield', 'p2'))).toBe(3);
  });
  it('of one target creature', () => {
    expect(full(LENS)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Doubling Lens', { name: 'Test Elf', counters: { '+1/+1': 3 } }] }, defs: [LENS, ELF] });
    const elf = find(s, 'Test Elf', 'battlefield');
    s = resolveTop(activate(s, find(s, 'Test Doubling Lens', 'battlefield'), [target(elf)]));
    expect(ctr(s, elf)).toBe(6);
    expect(ptOf(s, elf)).toBe('8/8');
  });
});

describe('CR 608.2h, 603.10a: "put a number of +1/+1 counters on ~ equal to that creature\'s power"', () => {
  const VULTURE = card('Test Vulture', 'Creature — Bird', "Whenever a creature an opponent controls dies, put a number of +1/+1 counters on Test Vulture equal to that creature's power.", ['1', '1']);
  it('the power of the creature as it last existed on the battlefield (its counters included)', () => {
    expect(full(VULTURE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Vulture'] }, p2: { battlefield: [{ name: 'Test Ogre', counters: { '+1/+1': 2 } }] }, defs: [VULTURE, KILL, OGRE] });
    s = resolveTop(cast(s, 'Test Kill', [target(find(s, 'Test Ogre', 'battlefield', 'p2'))]));
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s);
    expect(ctr(s, find(s, 'Test Vulture', 'battlefield'))).toBe(5);
  });
});

describe('CR 608.2c: "put two +1/+1 counters on it if you gained life this turn"', () => {
  const SAPLING = card('Test Sapling', 'Creature — Plant', 'When Test Sapling enters, put two +1/+1 counters on it if you gained life this turn.', ['1', '1']);
  it('only when you gained life this turn, checked as the ability resolves', () => {
    expect(full(SAPLING)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sapling', 'Test Balm', 'Test Sapling'] }, defs: [SAPLING, BALM] });
    s = resolveAll(cast(s, 'Test Sapling'));
    expect(ctr(s, find(s, 'Test Sapling', 'battlefield'))).toBe(0);
    s = resolveAll(cast(s, 'Test Balm'));
    s = resolveAll(cast(s, 'Test Sapling'));
    const saplings = findAll(s, 'Test Sapling', 'battlefield');
    expect(saplings.map((id) => ctr(s, id)).sort()).toEqual([0, 2]);
  });
});

describe('CR 608.2c, 608.2h: "Then put a +1/+1 counter on each creature you control"; "for each Forest you control"', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'Create two 1/1 white Soldier creature tokens. Then put a +1/+1 counter on each creature you control.');
  const GROWTH = card('Test Grove Call', 'Sorcery', 'Create a 1/1 green Elf Warrior creature token. Put a +1/+1 counter on it for each Forest you control.');
  it('the tokens just created get a counter too; an opponent\'s creature does not', () => {
    expect(full(RALLY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rally'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Ogre'] }, defs: [RALLY, ELF, OGRE] });
    s = resolveAll(cast(s, 'Test Rally'));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(2);
    for (const t of tokens) expect(ctr(s, t)).toBe(1);
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(1);
    expect(ctr(s, find(s, 'Test Ogre', 'battlefield', 'p2'))).toBe(0);
  });
  it('the token gets one counter per Forest you control', () => {
    expect(full(GROWTH)).toBe(true);
    let s = scenario(['Forest'], { p1: { hand: ['Test Grove Call'], battlefield: ['Forest', 'Forest', 'Forest', 'Test Elf'] }, p2: { battlefield: ['Forest'] }, defs: [GROWTH, ELF] });
    s = resolveAll(cast(s, 'Test Grove Call'));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(ctr(s, token)).toBe(3);
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(0);
  });
});

describe('CR 614.1c, 614.12: "~ enters with ... counters on it" with a computed number', () => {
  const TROLL = card('Test Grave Troll', 'Creature — Troll', 'Test Grave Troll enters with a +1/+1 counter on it for each creature card in your graveyard.', ['0', '0']);
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', 'Test Ghoul enters with a +1/+1 counter on it for each creature that died this turn.', ['1', '1']);
  const BEETLE = card('Test Beetle', 'Creature — Insect', 'Test Beetle enters with X +1/+1 counters on it, where X is the number of other creatures on the battlefield.', ['0', '1']);
  const BREACHER = card('Test Breacher', 'Creature — Knight', 'Test Breacher enters with a +1/+1 counter on it for each other creature and/or artifact you control.', ['1', '1']);
  it('for each creature card in your graveyard (not an opponent\'s, not a land)', () => {
    expect(full(TROLL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Grave Troll'], graveyard: ['Test Elf', 'Test Ogre', 'Plains'] }, p2: { graveyard: ['Test Elf'] }, defs: [TROLL, ELF, OGRE] });
    s = resolveAll(cast(s, 'Test Grave Troll'));
    const troll = find(s, 'Test Grave Troll', 'battlefield');
    expect(ctr(s, troll)).toBe(2);
    expect(ptOf(s, troll)).toBe('2/2');
  });
  it('for each creature that died this turn (either player\'s)', () => {
    expect(full(GHOUL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill', 'Test Kill', 'Test Ghoul'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Ogre'] }, defs: [GHOUL, KILL, ELF, OGRE] });
    s = resolveAll(cast(s, 'Test Kill', [target(find(s, 'Test Elf', 'battlefield'))]));
    s = resolveAll(cast(s, 'Test Kill', [target(find(s, 'Test Ogre', 'battlefield'))]));
    s = resolveAll(cast(s, 'Test Ghoul'));
    expect(ctr(s, find(s, 'Test Ghoul', 'battlefield'))).toBe(2);
  });
  it('where X is the number of other creatures on the battlefield (both players\')', () => {
    expect(full(BEETLE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Beetle'], battlefield: ['Test Elf', 'Test Relic'] }, p2: { battlefield: ['Test Elf', 'Test Ogre'] }, defs: [BEETLE, ELF, OGRE, RELIC] });
    s = resolveAll(cast(s, 'Test Beetle'));
    expect(ctr(s, find(s, 'Test Beetle', 'battlefield'))).toBe(3);
  });
  it('for each other creature and/or artifact you control: an artifact creature counts once', () => {
    expect(full(BREACHER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Breacher'], battlefield: ['Test Elf', 'Test Relic', 'Test Golem'] }, p2: { battlefield: ['Test Ogre', 'Test Relic'] }, defs: [BREACHER, ELF, OGRE, RELIC, GOLEM] });
    s = resolveAll(cast(s, 'Test Breacher'));
    expect(ctr(s, find(s, 'Test Breacher', 'battlefield'))).toBe(3);
  });
});

describe('CR 614.1c, 122.6: "Each Elf you control enters with an additional +1/+1 counter on it"', () => {
  const GLOBE = card('Test Elf Globe', 'Artifact', 'Each Elf you control enters with an additional +1/+1 counter on it.');
  const PARAGON = card('Test Elf Paragon', 'Creature — Elf Warrior', 'Each other Elf creature you control enters with an additional +1/+1 counter on it.', ['2', '2']);
  const BIG_ELF = card('Test Big Elf', 'Creature — Elf', 'Test Big Elf enters with two +1/+1 counters on it.', ['1', '1']);
  it('an Elf you cast gets one more counter; a non-Elf does not; an Elf that enters with counters gets them all', () => {
    expect(full(GLOBE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Elf', 'Test Ogre', 'Test Big Elf'], battlefield: ['Test Elf Globe'] }, defs: [GLOBE, ELF, OGRE, BIG_ELF] });
    s = resolveAll(cast(s, 'Test Elf'));
    s = resolveAll(cast(s, 'Test Ogre'));
    s = resolveAll(cast(s, 'Test Big Elf'));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(1);
    expect(ctr(s, find(s, 'Test Ogre', 'battlefield'))).toBe(0);
    expect(ctr(s, find(s, 'Test Big Elf', 'battlefield'))).toBe(3);
  });
  it('not an Elf entering under an opponent\'s control; "each other" leaves out the object itself', () => {
    expect(full(PARAGON)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Elf', 'Test Elf Paragon', 'Test Elf'] }, p2: { battlefield: ['Test Elf Globe'] }, defs: [GLOBE, PARAGON, ELF] });
    s = resolveAll(cast(s, 'Test Elf'));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(0);
    s = resolveAll(cast(s, 'Test Elf Paragon'));
    expect(ctr(s, find(s, 'Test Elf Paragon', 'battlefield'))).toBe(0);
    s = resolveAll(cast(s, 'Test Elf'));
    expect(findAll(s, 'Test Elf', 'battlefield').map((id) => ctr(s, id)).sort()).toEqual([0, 1]);
  });
});

describe('CR 614.1c, 611.2a, 514.2: "This turn, each creature you control enters with an additional +1/+1 counter on it"', () => {
  const MAGE = card('Test Guildmage', 'Creature — Elf Wizard', '{0}: This turn, each creature you control enters with an additional +1/+1 counter on it.', ['2', '2']);
  it('creatures entering this turn get one; after the turn ends they do not', () => {
    expect(full(MAGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Elf', 'Test Ogre', 'Test Elf'], battlefield: ['Test Guildmage'] }, defs: [MAGE, ELF, OGRE] });
    s = resolveTop(activate(s, find(s, 'Test Guildmage', 'battlefield')));
    s = resolveAll(cast(s, 'Test Elf'));
    s = resolveAll(cast(s, 'Test Ogre'));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(1);
    expect(ctr(s, find(s, 'Test Ogre', 'battlefield'))).toBe(1);
    expect(ctr(s, find(s, 'Test Guildmage', 'battlefield'))).toBe(0);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Elf'));
    expect(findAll(s, 'Test Elf', 'battlefield').map((id) => ctr(s, id)).sort()).toEqual([0, 1]);
  });
});

describe('CR 601.2d: "Distribute three +1/+1 counters among one or two target creatures"', () => {
  const RITE = card('Test Rite', 'Sorcery', 'Distribute three +1/+1 counters among one or two target creatures.');
  it('the division announced on casting: one and two; a single target gets all three', () => {
    expect(full(RITE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rite', 'Test Rite'], battlefield: ['Test Elf', 'Test Ogre'] }, defs: [RITE, ELF, OGRE] });
    const elf = find(s, 'Test Elf', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = cast(s, 'Test Rite', [target(elf, ogre)]);
    expect(s.pending).toMatchObject({ kind: 'chooseDivision', what: 'counters', total: 3 });
    s = answer(s, { kind: 'chooseDivision', amounts: [1, 2] });
    s = resolveAll(s);
    expect([ctr(s, elf), ctr(s, ogre)]).toEqual([1, 2]);
    s = resolveAll(cast(s, 'Test Rite', [target(ogre)]));
    expect([ctr(s, elf), ctr(s, ogre)]).toEqual([1, 5]);
  });
  it('a triggered ability announces the division as it is put on the stack (CR 603.3d), among other creatures you control', () => {
    const CYCLE = card('Test Sky Cycle', 'Artifact Creature — Construct', 'When Test Sky Cycle enters, distribute two +1/+1 counters among one or two other target creatures you control.', ['1', '1']);
    expect(full(CYCLE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sky Cycle'], battlefield: ['Test Elf', 'Test Ogre'] }, defs: [CYCLE, ELF, OGRE] });
    const elf = find(s, 'Test Elf', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveTop(cast(s, 'Test Sky Cycle'), [target(elf, ogre), { kind: 'chooseDivision', amounts: [1, 1] }]);
    s = resolveAll(s);
    expect([ctr(s, elf), ctr(s, ogre), ctr(s, find(s, 'Test Sky Cycle', 'battlefield'))]).toEqual([1, 1, 0]);
  });
});

describe('CR 608.2h, 608.2b: "counter target spell. Put X +1/+1 counters on ~, where X is that spell\'s mana value"', () => {
  const WHELK = card('Test Whelk', 'Creature — Leech', "Flash\nWhen Test Whelk enters, counter target spell. Put X +1/+1 counters on Test Whelk, where X is that spell's mana value.", ['1', '1']);
  const BIG = card('Test Big Ogre', 'Creature — Ogre', '', ['4', '4'], '{3}');
  it('X is the mana value of the countered spell (as it last existed on the stack)', () => {
    expect(full(WHELK)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Big Ogre'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Whelk'] }, defs: [WHELK, BIG] });
    s = cast(s, 'Test Big Ogre');
    const spell = find(s, 'Test Big Ogre', 'stack');
    s = pass(s); // p2 gets priority with the Ogre on the stack
    s = cast(s, 'Test Whelk', [], 'p2');
    s = resolveTop(s, [target(spell)]); // the Whelk resolves; its enters trigger targets the Ogre spell
    s = resolveTop(s);
    expect(findAll(s, 'Test Big Ogre', 'graveyard', 'p1').length).toBe(1);
    expect(ctr(s, find(s, 'Test Whelk', 'battlefield'))).toBe(3);
  });
});

describe('CR 122.1b: keyword counters', () => {
  const FANGS = card('Test Fangs', 'Instant', 'Put a +1/+1 counter and a flying counter on target creature.');
  const BLADE = card('Test Blade Master', 'Creature — Human', '{0}: Put a double strike counter on Test Blade Master.', ['2', '2']);
  it('"put a +1/+1 counter and a flying counter on target creature": both counters, and the creature has flying', () => {
    expect(full(FANGS)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Fangs'], battlefield: ['Test Ogre'] }, defs: [FANGS, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveAll(cast(s, 'Test Fangs', [target(ogre)]));
    expect([ctr(s, ogre), ctr(s, ogre, 'flying')]).toEqual([1, 1]);
    expect(hasKeyword(getChars(s, ogre)!, 'flying')).toBe(true);
  });
  it('"put a double strike counter on ~": the counter, and the creature has double strike', () => {
    expect(full(BLADE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Blade Master'] }, defs: [BLADE] });
    const blade = find(s, 'Test Blade Master', 'battlefield');
    s = resolveTop(activate(s, blade));
    expect(ctr(s, blade, 'double strike')).toBe(1);
    expect(hasKeyword(getChars(s, blade)!, 'double strike')).toBe(true);
  });
});

describe('CR 608.2c: "put a +1/+1 counter on that creature and a +1/+1 counter on ~"', () => {
  const RANGER = card('Test Order Ranger', 'Creature — Human Ranger', 'Whenever another creature you control enters, put a +1/+1 counter on that creature and a +1/+1 counter on Test Order Ranger.', ['2', '2']);
  it('one counter on each', () => {
    expect(full(RANGER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Elf'], battlefield: ['Test Order Ranger'] }, defs: [RANGER, ELF] });
    s = resolveAll(cast(s, 'Test Elf'));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(1);
    expect(ctr(s, find(s, 'Test Order Ranger', 'battlefield'))).toBe(1);
  });
});

describe('CR 122.8: "put its +1/+1 counters on target creature you control"', () => {
  const CAPTAIN = card('Test Captain', 'Creature — Human Soldier', 'When Test Captain dies, put its +1/+1 counters on target creature you control.', ['1', '1']);
  const KEEPER = card('Test Keeper', 'Creature — Human Cleric', 'Whenever another creature you control dies, put its +1/+1 counters on target creature you control.', ['1', '1']);
  it('as many as the creature had as it last existed on the battlefield', () => {
    expect(full(CAPTAIN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Captain', counters: { '+1/+1': 3 } }, 'Test Elf'] }, defs: [CAPTAIN, KILL, ELF] });
    const elf = find(s, 'Test Elf', 'battlefield');
    s = resolveTop(cast(s, 'Test Kill', [target(find(s, 'Test Captain', 'battlefield'))]), [target(elf)]);
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s);
    expect(ctr(s, elf)).toBe(3);
  });
  it('"its" is the creature that died, not the object with the ability', () => {
    expect(full(KEEPER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Keeper', counters: { '+1/+1': 5 } }, { name: 'Test Elf', counters: { '+1/+1': 2 } }, 'Test Ogre'] }, defs: [KEEPER, KILL, ELF, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveTop(cast(s, 'Test Kill', [target(find(s, 'Test Elf', 'battlefield'))]), [target(ogre)]);
    s = resolveTop(s);
    expect(ctr(s, ogre)).toBe(2);
  });
});

describe('CR 107.3, 608.2h, 109.2: "where X is ~\'s power", "that spell\'s mana value", "other than ~"', () => {
  const SNAKE = card('Test Snake', 'Creature — Snake', "{0}: Put X +1/+1 counters on each creature you control, where X is Test Snake's power.", ['2', '2']);
  const DANCER = card('Test Dancer', 'Enchantment', "Whenever you cast a creature spell, put X +1/+1 counters on target creature you control, where X is that spell's mana value.");
  const BIG = card('Test Big Ogre', 'Creature — Ogre', '', ['4', '4'], '{3}');
  const VANGUARD = card('Test Vanguard', 'Creature — Human', '{0}: Put a +1/+1 counter on each creature you control other than Test Vanguard.', ['1', '1']);
  it('X is the power as the ability resolves, the same for every creature (the object\'s own counters do not raise it)', () => {
    expect(full(SNAKE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Snake', 'Test Elf'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SNAKE, ELF, OGRE] });
    s = resolveTop(activate(s, find(s, 'Test Snake', 'battlefield')));
    expect(ctr(s, find(s, 'Test Snake', 'battlefield'))).toBe(2);
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(2);
    expect(ctr(s, find(s, 'Test Ogre', 'battlefield', 'p2'))).toBe(0);
  });
  it('X is the mana value of the creature spell cast', () => {
    expect(full(DANCER)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Big Ogre'], battlefield: ['Test Dancer', 'Test Elf', 'Plains', 'Plains', 'Plains'] }, defs: [DANCER, BIG, ELF] });
    const elf = find(s, 'Test Elf', 'battlefield');
    s = cast(s, 'Test Big Ogre', [target(elf)]);
    s = resolveAll(s);
    expect(ctr(s, elf)).toBe(3);
  });
  it('"other than ~": every creature you control but the object itself', () => {
    expect(full(VANGUARD)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Vanguard', 'Test Elf'] }, defs: [VANGUARD, ELF] });
    s = resolveTop(activate(s, find(s, 'Test Vanguard', 'battlefield')));
    expect(ctr(s, find(s, 'Test Vanguard', 'battlefield'))).toBe(0);
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(1);
  });
});

