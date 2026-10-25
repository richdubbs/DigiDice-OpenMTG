/**
 * trek-10 (lane trek, Star Trek): an engine bug an audit confirmed in two cards that were already full, played through the engine with synthetic cards (invented
 * names, the wordings of the real cards, design 6.10), compiled by the game's default compiler. Nothing is mocked. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 *
 * The bug: the engine's list of creature types was CR 205.3m's of 2026-09-25, before the Star Trek set, so "Borg" (Klingon, Vulcan, Officer, Tribble...) was in
 * no list. A changeling got every LISTED type (layer 4, statics/mods.ts) and so was never a Borg: "the number of creature types among non-Borg creatures you
 * control" (Hoshi Sato, Exolinguist; Starfleet Academy) counted it, and counted every type it has (the whole list) on top of it.
 *
 *   CR 702.73a, 205.3m     a changeling is every creature type, Borg included, so a "non-Borg" count leaves it out: 2 types with a Borg drone, a changeling
 *                          and "Human Scientist", not the whole list; the same count for the library peek (Hoshi) and the mana ability (Academy)
 *   CR 702.73a, 205.3m     "creature types among creatures you control" with a changeling alone is the whole list, the printed types included
 *   CR 205.3m, 613.1d      "Non-Klingon creatures you control get +1/+1" leaves the changeling out; "Klingon creatures you control get +1/+1" includes it
 *   CR 205.3m, 614.12a     "choose a creature type" offers the printed types (Borg, Klingon, Vulcan, Officer, Tribble...), each once, and none that is only a
 *                          funny or playtest card's word or another class's subtype; "creatures of the chosen type" includes the changeling
 *   CR 205.3m, 613.1d      "loses all creature types" and "becomes a Klingon" leave a changeling with no creature type / only Klingon
 *   CR 205.3d, 702.103     a bestowed creature card is an Aura with no creature types: its Klingon goes too
 *   CR 702.73a, 613.1d     a changeling is every creature type because layer 4 gives it all of them, so a later layer 4 effect that sets or takes away its creature
 *                          types leaves it only what that effect says, and every reader sees it (Maskwood Nexus ruling, 2021-02-05: "If an effect causes a creature with
 *                          changeling to become a new creature type, it will be only that new creature type. It will still have changeling."): counts of creature
 *                          types, "creatures of the chosen type", the party. A changeling card in a graveyard is every type, and one that loses all abilities keeps them.
 *   CR 107.7, 205.3m       rewriting the creature type "Q" in a text leaves the {Q} untap symbol alone
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { ALL_CREATURE_TYPES } from '../../../src/rules/creature-types';
import { mentionsWord, rewriteText, wordChangeOf } from '../../../src/statics/text-change';
import { partyCreatureOf, partySize } from '../../../src/statics/party';
import { CREATURE_TYPES, CR_CREATURE_TYPES, hasEveryCreatureType, PRINTED_CREATURE_TYPES } from '../../../src/statics/subtypes';
import { act, advanceTo, answer, find, legal, life, pass, pool, scenario } from '../../m5/helpers';
import { drive, resolveTop, target } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const subtypes = (s: GameState, id: string): string[] => [...getChars(s, id)!.subtypes].sort();
const pt = (s: GameState, id: string): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

// Hoshi Sato, Exolinguist and Starfleet Academy, in invented names
const LINGUIST = card('Test Linguist', 'Legendary Creature — Human Scientist',
  'When Test Linguist enters, look at the top X cards of your library, where X is the number of creature types among non-Borg creatures you control. Put one of them into your hand and the rest on the bottom of your library in a random order.', ['1', '3']);
const ACADEMY = card('Test Academy', 'Land',
  '{T}: Add {C}.\n{5}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creature types among non-Borg creatures you control.');
const CENSUS = card('Test Census', 'Artifact', '{0}: You gain life equal to the number of creature types among creatures you control.');
const FED_CENSUS = card('Test Federation', 'Artifact', '{0}: You gain life equal to the number of creature types among non-Borg creatures you control.');
const YARD = card('Test Yard', 'Artifact', '{0}: You gain life equal to the number of creature types among creature cards in your graveyard.');
const MUTE = card('Test Mute', 'Artifact', '{0}: Target creature loses all abilities until end of turn.');
const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', ['1', '1']);
const DRONE = card('Test Drone', 'Artifact Creature — Borg', '', ['1', '1']);
const OFFICER = card('Test Officer', 'Creature — Human Officer', '', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const RAIDER = card('Test Raider', 'Creature — Klingon Warrior', '', ['2', '2']);
const RALLY = card('Test Rally', 'Enchantment', 'Non-Klingon creatures you control get +1/+1.');
const LODGE = card('Test Lodge', 'Enchantment', 'Klingon creatures you control get +1/+1.');
const STANDARD = card('Test Standard', 'Enchantment', 'As Test Standard enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.');
const UNMASK = card('Test Unmasking', 'Instant', 'Target creature gets +1/+1 and loses all creature types until end of turn.');
const DISGUISE = card('Test Disguise', 'Artifact', '{0}: Target creature becomes a Klingon until end of turn.');
const BESTOWER = card('Test Bestower', 'Enchantment Creature — Klingon Warrior', 'Bestow {1}\nEnchanted creature gets +1/+1.', ['1', '1'], '{1}');

describe('the synthetic cards compile fully automated', () => {
  it.each([LINGUIST, ACADEMY, CENSUS, FED_CENSUS, YARD, MUTE, RALLY, LODGE, STANDARD, UNMASK, DISGUISE, BESTOWER])('$name', (d) => expect(full(d), JSON.stringify(d.automation)).toBe(true));
});

describe('trek-10: the printed creature types are in the one list (statics/subtypes.ts)', () => {
  it('a changeling gets the rules\' types and the printed ones: Borg, Klingon, Vulcan, Officer are among its subtypes; the list has each type once', () => {
    const s = scenario(['Island'], { p1: { battlefield: ['Test Shifter'] }, defs: [SHIFTER] });
    const subs = new Set(getChars(s, find(s, 'Test Shifter', 'battlefield', 'p1')).subtypes);
    for (const t of ['Borg', 'Klingon', 'Vulcan', 'Officer', 'Tribble', 'Kelpien', 'Romulan', 'Goblin', 'Time Lord']) expect(subs.has(t), t).toBe(true);
    expect(subs.size).toBe(CREATURE_TYPES.length);
    expect(subs.size).toBe(CR_CREATURE_TYPES.length + PRINTED_CREATURE_TYPES.length);
    expect(CREATURE_TYPES.length).toBeGreaterThan(CR_CREATURE_TYPES.length);
  });
});

describe('CR 702.73a, 205.3m: "the number of creature types among non-Borg creatures you control" with a changeling (Hoshi Sato, Exolinguist; Starfleet Academy)', () => {
  /** Hoshi's wording: cast the creature, resolve it and its trigger; how many cards are looked at (the library has 20). */
  const peek = (others: string[], defs: CardDef[]): number => {
    let s = scenario(['Island'], { p1: { hand: ['Test Linguist'], battlefield: others }, defs: [LINGUIST, ...defs] });
    expect(s.zones.library['p1']!.length).toBe(20);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Linguist', 'hand', 'p1') }));
    s = resolveTop(resolveTop(s)); // the creature spell resolves; its trigger resolves
    expect(s.pending?.kind).toBe('chooseObjects');
    return (s.pending as unknown as { options: string[] }).options.length;
  };
  /** Starfleet Academy's wording: the mana added by its {5},{T} ability, red chosen. */
  const academy = (others: string[], defs: CardDef[], withLinguist = false): string => {
    let s = scenario(['Island'], { p1: { battlefield: ['Test Academy', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', ...(withLinguist ? ['Test Linguist'] : []), ...others] }, defs: [ACADEMY, LINGUIST, ...defs] });
    const land = find(s, 'Test Academy', 'battlefield', 'p1');
    const ability = legal(s, 'p1', 'activate').find((a) => a.object === land && a.label.includes('Choose a color'))!;
    s = drive(act(s, ability.action), [{ kind: 'payCost', auto: true }]);
    if (s.pending?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'R' });
    s = drive(s, [{ kind: 'payCost', auto: true }]);
    return pool(s, 'p1');
  };
  const DEFS = [SHIFTER, DRONE, OFFICER, BEAR];

  it('control: Human and Scientist (the Linguist itself) and a Human Officer: 3 types; a Borg drone adds none; a plain Bear adds Bear', () => {
    expect(peek([], DEFS)).toBe(2);
    expect(peek(['Test Drone'], DEFS)).toBe(2);
    expect(peek(['Test Drone', 'Test Officer'], DEFS)).toBe(3);
    expect(peek(['Test Drone', 'Test Bear'], DEFS)).toBe(3);
    expect(academy([], DEFS)).toBe('');
    expect(academy(['Test Drone', 'Test Officer'], DEFS)).toBe('RR');
    expect(academy(['Test Drone', 'Test Bear', 'Test Officer'], DEFS)).toBe('RRR'); // Bear, Human, Officer
  });

  it('THE BUG: a changeling is every creature type, Borg included, so it is left out: the count is the same with it as without it (not the whole list)', () => {
    expect(peek(['Test Drone', 'Test Shifter'], DEFS)).toBe(2);
    expect(peek(['Test Shifter'], DEFS)).toBe(2);
    expect(peek(['Test Drone', 'Test Shifter', 'Test Officer'], DEFS)).toBe(3);
    expect(academy(['Test Drone', 'Test Shifter', 'Test Officer'], DEFS)).toBe('RR');
    expect(academy(['Test Shifter'], DEFS)).toBe('');
  });

  it('the two cards agree: the same board gives the same count', () => {
    for (const board of [[], ['Test Shifter'], ['Test Drone', 'Test Shifter', 'Test Bear'], ['Test Officer', 'Test Shifter']]) {
      expect(academy(board, DEFS, true).length, board.join(',')).toBe(peek(board, DEFS)); // both read the board with the Linguist (Human, Scientist) on it
    }
  });

  it('a creature with no Borg type is counted whatever else it is: the printed types do not make everything a Borg', () => {
    expect(peek(['Test Bear', 'Test Officer'], DEFS)).toBe(4); // Human, Scientist, Bear, Officer
  });

  it('without the Borg filter a changeling is the whole list: "creature types among creatures you control" counts the rules\' types and the printed ones', () => {
    let s = scenario(['Island'], { p1: { battlefield: ['Test Census', 'Test Shifter'] }, defs: [CENSUS, SHIFTER] });
    const census = find(s, 'Test Census', 'battlefield', 'p1');
    const ability = legal(s, 'p1', 'activate').find((a) => a.object === census)!;
    s = drive(act(s, ability.action));
    s = drive(pass(pass(s)));
    expect(life(s, 'p1') - 20).toBe(ALL_CREATURE_TYPES.size);
    expect(ALL_CREATURE_TYPES.size).toBe(CR_CREATURE_TYPES.length + PRINTED_CREATURE_TYPES.length);
    expect(ALL_CREATURE_TYPES.has('Borg')).toBe(true);
  });
});

describe('CR 205.3m, 613.1d: "Non-Klingon creatures you control get +1/+1" and "Klingon creatures you control get +1/+1" with a changeling (a type newer than the rules)', () => {
  const board = (anthem: string): GameState => scenario(['Island'], { p1: { battlefield: [anthem, 'Test Shifter', 'Test Raider', 'Test Bear'] }, defs: [RALLY, LODGE, SHIFTER, RAIDER, BEAR] });
  const ids = (s: GameState) => ({ shifter: find(s, 'Test Shifter', 'battlefield', 'p1'), raider: find(s, 'Test Raider', 'battlefield', 'p1'), bear: find(s, 'Test Bear', 'battlefield', 'p1') });

  it('non-Klingon: the Bear gets it; the Klingon and the changeling (a Klingon too) do not', () => {
    const s = board('Test Rally');
    const { shifter, raider, bear } = ids(s);
    expect([pt(s, bear), pt(s, raider), pt(s, shifter)]).toEqual(['3/3', '2/2', '1/1']);
  });

  it('Klingon: the Klingon and the changeling get it; the Bear does not', () => {
    const s = board('Test Lodge');
    const { shifter, raider, bear } = ids(s);
    expect([pt(s, bear), pt(s, raider), pt(s, shifter)]).toEqual(['2/2', '3/3', '2/2']);
  });
});

describe('CR 205.3m, 614.12a: "As it enters, choose a creature type"', () => {
  const cast = (): GameState => {
    const s = scenario(['Island'], { p1: { hand: ['Test Standard'], battlefield: ['Test Shifter', 'Test Raider', 'Test Bear'] }, defs: [STANDARD, SHIFTER, RAIDER, BEAR] });
    return resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Standard', 'hand', 'p1') })));
  };
  const options = (s: GameState): string[] => {
    expect(s.pending?.kind).toBe('chooseName');
    expect((s.pending as unknown as { what: string }).what).toBe('creatureType');
    return (s.pending as unknown as { options: string[] }).options;
  };

  it('offers the rules\' creature types and the printed ones (Borg, Klingon, Vulcan, Officer, Tribble, Kelpien, Romulan...), each once', () => {
    const o = options(cast());
    for (const t of ['Goblin', 'Human', 'Time Lord', 'Borg', 'Klingon', 'Vulcan', 'Officer', 'Tribble', 'Kelpien', 'Romulan', 'Andorian', 'Ferengi', 'Cardassian']) expect(o, t).toContain(t);
    expect(new Set(o).size).toBe(o.length);
    expect(o.length).toBe(CREATURE_TYPES.length);
  });

  it('NEGATIVE: not a word that only a funny or playtest card prints, not an artifact, land or spell type, not a planeswalker or card type', () => {
    const o = options(cast());
    for (const t of ['Cow', 'Armored', 'Spuzzem', 'Champion', 'Chef', 'Judge', 'Autobot', 'Tree', 'Key', 'Cloud', 'Chorus', 'Communicator', 'Equipment', 'Forest', 'Aura', 'Creature', 'Gideon', 'Siege']) {
      expect(o, t).not.toContain(t);
    }
  });

  it('the chosen type is read by "creatures of the chosen type": a Klingon chosen, the Klingon and the changeling get +1/+1, the Bear does not', () => {
    let s = answer(cast(), { kind: 'chooseName', name: 'Klingon' });
    s = drive(s);
    expect([pt(s, find(s, 'Test Bear', 'battlefield', 'p1')), pt(s, find(s, 'Test Raider', 'battlefield', 'p1')), pt(s, find(s, 'Test Shifter', 'battlefield', 'p1'))]).toEqual(['2/2', '3/3', '2/2']);
  });

  it('a printed type nobody on the battlefield has can still be chosen (Borg): the changeling is one, the others are not', () => {
    const s = drive(answer(cast(), { kind: 'chooseName', name: 'Borg' }));
    expect([pt(s, find(s, 'Test Bear', 'battlefield', 'p1')), pt(s, find(s, 'Test Raider', 'battlefield', 'p1')), pt(s, find(s, 'Test Shifter', 'battlefield', 'p1'))]).toEqual(['2/2', '2/2', '2/2']);
  });
});

describe('CR 205.3m, 205.3d, 613.1d: type-setting with the printed types', () => {
  it('"loses all creature types": a changeling, every type it had (the printed ones too), until the end of the turn', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Unmasking'], battlefield: ['Test Shifter'] }, defs: [UNMASK, SHIFTER] });
    const shifter = find(s, 'Test Shifter', 'battlefield', 'p1');
    expect(subtypes(s, shifter)).toContain('Borg');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unmasking', 'hand', 'p1') }), [target(shifter)]));
    expect(subtypes(s, shifter)).toEqual([]);
    expect(pt(s, shifter)).toBe('2/2');
    s = advanceTo(s, 2, 'main1');
    expect(subtypes(s, shifter)).toContain('Borg');
  });

  it('"becomes a Klingon": a Bear and a changeling both end with Klingon alone, and come back at the end of the turn', () => {
    let s = scenario(['Island'], { p1: { battlefield: ['Test Disguise', 'Test Shifter', 'Test Bear'] }, defs: [DISGUISE, SHIFTER, BEAR] });
    const [shifter, bear] = [find(s, 'Test Shifter', 'battlefield', 'p1'), find(s, 'Test Bear', 'battlefield', 'p1')];
    const disguise = legal(s, 'p1', 'activate').find((a) => a.label.includes('Test Disguise'))!;
    for (const victim of [shifter, bear]) {
      s = resolveTop(drive(act(s, disguise.action), [target(victim)]));
      expect(subtypes(s, victim)).toEqual(['Klingon']);
    }
    s = advanceTo(s, 2, 'main1');
    expect(subtypes(s, bear)).toEqual(['Bear']);
    expect(subtypes(s, shifter)).toContain('Borg');
  });

  it('CR 205.3d: a creature card cast bestowed is an Aura with no creature types (the printed Klingon goes with the Warrior)', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Bestower'], battlefield: ['Island', 'Island', 'Test Bear'] }, defs: [BESTOWER, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bestower', 'hand', 'p1'), method: 'bestow' }), [target(bear)]));
    const aura = find(s, 'Test Bestower', 'battlefield', 'p1');
    expect(getChars(s, aura)!.types).toEqual(['Enchantment']);
    expect(subtypes(s, aura)).toEqual(['Aura']);
    expect(pt(s, bear)).toBe('3/3');
  });
});

describe('CR 702.73a, 613.1d: a changeling is every creature type because layer 4 gave it all of them; a later layer 4 effect leaves it what that effect says', () => {
  /** The life gained by the artifact's {0} ability: the number its wording counts. */
  const gain = (s0: GameState, source: string): number => {
    const id = find(s0, source, 'battlefield', 'p1');
    const ability = legal(s0, 'p1', 'activate').find((a) => a.object === id)!;
    const before = life(s0, 'p1');
    const s = drive(pass(pass(drive(act(s0, ability.action)))));
    return life(s, 'p1') - before;
  };
  const DEFS = [SHIFTER, BEAR, CENSUS, FED_CENSUS, YARD, MUTE, UNMASK, DISGUISE, STANDARD];
  const cast = (s: GameState, name: string, victim: string): GameState => resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [target(victim)]));

  it('control: a changeling counts the whole list; with a Bear, one more only if the list lacked Bear (it has it)', () => {
    const s = scenario(['Island'], { p1: { battlefield: ['Test Census', 'Test Shifter', 'Test Bear'] }, defs: DEFS });
    expect(gain(s, 'Test Census')).toBe(CREATURE_TYPES.length);
  });

  it('"loses all creature types": the changeling is no type, so the count is 0 (with a Bear: 1), whether the Borg are left out or not; at the end of the turn it is every type again', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Unmasking'], battlefield: ['Test Census', 'Test Federation', 'Test Shifter'] }, defs: DEFS });
    const shifter = find(s, 'Test Shifter', 'battlefield', 'p1');
    s = cast(s, 'Test Unmasking', shifter);
    expect(subtypes(s, shifter)).toEqual([]);
    expect(getChars(s, shifter)!.keywords.map((k) => k.keyword)).toContain('changeling'); // it still has changeling
    expect(gain(s, 'Test Census')).toBe(0);
    expect(gain(s, 'Test Federation')).toBe(0);
    s = advanceTo(s, 3, 'main1'); // the effect ended at the end of turn 1; turn 3 is ours again
    expect(gain(s, 'Test Census')).toBe(CREATURE_TYPES.length);
  });

  it('"becomes a Klingon": the changeling is only a Klingon, so a Klingon and a Bear are 2 types, and "creatures of the chosen type" for Bear gives the Bear the bonus and the Klingon changeling none', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Standard'], battlefield: ['Test Census', 'Test Disguise', 'Test Shifter', 'Test Bear'] }, defs: DEFS });
    const [shifter, bear] = [find(s, 'Test Shifter', 'battlefield', 'p1'), find(s, 'Test Bear', 'battlefield', 'p1')];
    const disguise = legal(s, 'p1', 'activate').find((a) => a.label.includes('Test Disguise'))!;
    s = resolveTop(drive(act(s, disguise.action), [target(shifter)]));
    expect(subtypes(s, shifter)).toEqual(['Klingon']);
    expect(gain(s, 'Test Census')).toBe(2);
    s = drive(answer(resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Standard', 'hand', 'p1') }))), { kind: 'chooseName', name: 'Bear' }));
    expect([pt(s, bear), pt(s, shifter)]).toEqual(['3/3', '1/1']);
  });

  it('a changeling card in a graveyard is every creature type too (its own characteristics, layer 4 in every zone)', () => {
    const s = scenario(['Island'], { p1: { graveyard: ['Test Shifter'], battlefield: ['Test Yard'] }, defs: DEFS });
    expect(subtypes(s, find(s, 'Test Shifter', 'graveyard', 'p1')).length).toBe(CREATURE_TYPES.length);
    expect(gain(s, 'Test Yard')).toBe(CREATURE_TYPES.length);
    for (const zone of ['hand', 'library', 'exile'] as const) {
      const t = scenario(['Island'], { p1: { [zone]: ['Test Shifter'] }, defs: DEFS });
      expect(hasEveryCreatureType(getChars(t, find(t, 'Test Shifter', zone, 'p1')).subtypes), zone).toBe(true);
    }
  });

  it('"loses all abilities" takes changeling away but not the types layer 4 gave it before (layer 6 comes after layer 4): the count stays the whole list', () => {
    let s = scenario(['Island'], { p1: { battlefield: ['Test Census', 'Test Mute', 'Test Shifter'] }, defs: DEFS });
    const shifter = find(s, 'Test Shifter', 'battlefield', 'p1');
    const mute = legal(s, 'p1', 'activate').find((a) => a.label.includes('Test Mute'))!;
    s = resolveTop(drive(act(s, mute.action), [target(shifter)]));
    expect(getChars(s, shifter)!.keywords).toEqual([]);
    expect(subtypes(s, shifter).length).toBe(CREATURE_TYPES.length);
    expect(gain(s, 'Test Census')).toBe(CREATURE_TYPES.length);
  });

  it('hasEveryCreatureType: the whole list, in any order, and nothing less', () => {
    expect(hasEveryCreatureType(CREATURE_TYPES)).toBe(true);
    expect(hasEveryCreatureType([...CREATURE_TYPES].reverse())).toBe(true);
    expect(hasEveryCreatureType([...CREATURE_TYPES, 'Equipment'])).toBe(true);
    expect(hasEveryCreatureType(CREATURE_TYPES.slice(1))).toBe(false);
    expect(hasEveryCreatureType(['Klingon'])).toBe(false);
    expect(hasEveryCreatureType([])).toBe(false);
  });

  it('the party (CR 700.8): a changeling fills any slot; one that became a Klingon fills none', () => {
    const s = scenario(['Island'], { p1: { hand: [], battlefield: ['Test Disguise', 'Test Shifter'] }, defs: DEFS });
    const shifter = find(s, 'Test Shifter', 'battlefield', 'p1');
    expect(partySize([partyCreatureOf(getChars(s, shifter))])).toBe(1);
    const disguise = legal(s, 'p1', 'activate').find((a) => a.label.includes('Test Disguise'))!;
    const t = resolveTop(drive(act(s, disguise.action), [target(shifter)]));
    expect(partySize([partyCreatureOf(getChars(t, shifter))])).toBe(0);
  });
});

describe('CR 107.7, 205.3m: rewriting the creature type "Q" (printed on Star Trek cards) leaves the {Q} untap symbol alone', () => {
  const change = wordChangeOf({ kind: 'creatureType', from: 'Q', to: 'Elf' }, {} as GameState, null)!;
  it('the word is a creature type now', () => expect(change).toEqual({ kind: 'creatureType', from: 'Q', to: 'Elf' }));
  it('the untap symbol is no word to rewrite', () => {
    const text = '{2}, {Q}: Put a +1/+1 counter on this creature. ({Q} is the untap symbol.)';
    expect(mentionsWord(text, change)).toBe(false);
    expect(rewriteText(text, change)).toBe(text);
  });
  it('the word itself is rewritten, as before ("Q", "Qs", "non-Q")', () => {
    expect(mentionsWord('Q creatures you control get +1/+1.', change)).toBe(true);
    expect(rewriteText('Q creatures you control get +1/+1. {Q}: Untap target Q.', change)).toBe('Elf creatures you control get +1/+1. {Q}: Untap target Elf.');
    expect(rewriteText('Non-Q creatures', change)).toBe('Non-Elf creatures');
  });
});
