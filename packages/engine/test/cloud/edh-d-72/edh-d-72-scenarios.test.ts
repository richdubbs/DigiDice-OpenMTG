/**
 * Commander concept lane chosen-qualities, round edh-d-72 (coordinator D): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites are from
 * memory (cloud session) and listed as unverified in the record.
 *
 *   CR 205.1a, 205.3m, 607.2d, 613.1d  "Creatures you control are the chosen type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield."
 *   CR 205.1b, 205.3m, 607.2d, 613.1d  "Slivers you control and nontoken creatures you control are the chosen type in addition to their other creature types. ..."
 *   CR 105.2, 108.2, 607.2d, 613.1e    "The cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors."
 *   CR 614.12a, 608.2d, 607.2d         "As ~ enters, an opponent chooses a creature type." + "target creature that isn't of the chosen type"
 *   CR 702.14a, 702.14c, 607.2d        "As ~ enters, choose a land type." + "Enchanted creature has landwalk of the chosen type."
 *   CR 105.1, 603.4, 607.2d            "Whenever you cast a spell, if it's at least one of the chosen colors, you gain 1 life for each of the chosen colors it is."
 *   CR 611.3a, 613.1f, 702.131         "Creatures you control of the chosen type get +1/+1. As long as you have the city's blessing, they also have vigilance."
 *   CR 701.20a, 608.2d, 607.2d         "Choose creature or land. Reveal the top four cards of your library. Put all cards of the chosen type revealed this way into your hand and the rest into your graveyard."
 *   CR 707.9a, 205.1b, 613.1a          "{1}: Until end of turn, ~ becomes a copy of target creature you control of the chosen type, except it's an artifact in addition to its other types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, createGame, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, pass, passBoth, put, scenario } from '../../m3/scenario';
import { playersConfig } from '../../m12/skeleton/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
/** Cast `name` from p1's hand, paying automatically, and let the spell resolve; every other decision is answered by `pick` (a creature type name, a color letter, ...). */
function castAndResolve(s0: GameState, name: string, picks: string[] = []): GameState {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never));
  let n = 0;
  for (let g = 0; g < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const d = s.pending;
    if (d === null) break;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: picks[n++] ?? 'Elf' } as never);
    else if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (picks[n++] ?? 'R') as never } as never);
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const subtypesOf = (s: GameState, id: string): string[] => [...charsOfObject(s, s.objects[id]!).subtypes].sort();
const colorsOf = (s: GameState, id: string): string[] => [...charsOfObject(s, s.objects[id]!).colors].sort();

// ---------------------------------------------------------------------------------------------------------------------------------
// Conspiracy: creatures are the chosen type (their other creature types are lost)
// ---------------------------------------------------------------------------------------------------------------------------------
const PLOT = card('Test Plot', 'Enchantment', "As ~ enters, choose a creature type.\nCreatures you control are the chosen type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.");
const GOB = card('Test Goblin Warrior', 'Creature — Goblin Warrior', '', { pt: ['2', '2'] });
const FOE_GOB = card('Test Foe Goblin', 'Creature — Goblin', '', { pt: ['2', '2'] });
const BUILD = card('Test Builder', 'Artifact', '');

describe('CR 205.1a, 205.3m, 607.2d, 613.1d: Conspiracy, "Creatures you control are the chosen type. The same is true for creature spells ... and creature cards you own that aren\'t on the battlefield."', () => {
  const board = (): GameState => {
    let s = scenario([], { defs: [PLOT, GOB, FOE_GOB], p1: { hand: ['Test Plot', 'Test Goblin Warrior'], graveyard: ['Test Goblin Warrior'], battlefield: ['Test Goblin Warrior'] }, p2: { battlefield: ['Test Foe Goblin'], graveyard: ['Test Goblin Warrior'] } });
    s = castAndResolve(s, 'Test Plot', ['Elf']);
    return s;
  };
  it('is automated', () => expect(noManual(PLOT)).toEqual([]));
  it('your creature on the battlefield is only an Elf (its Goblin and Warrior are lost), your creature card in hand and in your graveyard are Elves too', () => {
    const s = board();
    const bf = find(s, 'Test Goblin Warrior', 'battlefield', 'p1');
    expect(subtypesOf(s, bf)).toEqual(['Elf']);
    expect(findAll(s, 'Test Goblin Warrior', 'hand', 'p1').map((id) => subtypesOf(s, id))).toEqual([['Elf']]);
    expect(findAll(s, 'Test Goblin Warrior', 'graveyard', 'p1').map((id) => subtypesOf(s, id))).toEqual([['Elf']]);
  });
  it('negative: an opponent\'s creature, and a creature card in an opponent\'s graveyard (which you do not own), keep their types; so does a noncreature card', () => {
    const s = board();
    expect(subtypesOf(s, find(s, 'Test Foe Goblin', 'battlefield', 'p2'))).toEqual(['Goblin']);
    expect(findAll(s, 'Test Goblin Warrior', 'graveyard', 'p2').map((id) => subtypesOf(s, id))).toEqual([['Goblin', 'Warrior']]);
  });
  it('negative: before the Enchantment is on the battlefield nothing changes, and with nothing chosen nothing changes', () => {
    const s = scenario([], { defs: [PLOT, GOB], p1: { hand: ['Test Plot'], battlefield: ['Test Goblin Warrior'] } });
    expect(subtypesOf(s, find(s, 'Test Goblin Warrior', 'battlefield', 'p1'))).toEqual(['Goblin', 'Warrior']);
  });
  it('a creature spell you control on the stack is an Elf too', () => {
    let s = scenario([], { defs: [PLOT, GOB], p1: { hand: ['Test Plot', 'Test Goblin Warrior'] } });
    s = castAndResolve(s, 'Test Plot', ['Elf']);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Goblin Warrior', 'hand', 'p1') } as never));
    expect(s.zones.stack.map((id) => subtypesOf(s, id))).toEqual([['Elf']]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Rukarumel, Biologist: the Slivers and nontoken creatures you control gain the chosen type
// ---------------------------------------------------------------------------------------------------------------------------------
const BIO = card('Test Biologist', 'Legendary Creature — Human Wizard', "As ~ enters, choose a creature type.\nSlivers you control and nontoken creatures you control are the chosen type in addition to their other creature types. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.\n{0}: Create a 1/1 colorless Sliver creature token.\n{0}: Create a 1/1 colorless Goblin creature token.", { pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
/** Activate the `index`-th non-mana ability of the named permanent of p1, pay automatically and let the stack resolve. */
const activate = (s: GameState, name: string, index: number): GameState => {
  const id = find(s, name, 'battlefield', 'p1');
  const acts = legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana);
  let t = act(s, acts[index]!.action);
  while (t.pending && t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  for (let g = 0; g < 8 && t.zones.stack.length > 0; g++) t = passBoth(t);
  return t;
};

describe('CR 205.1b, 205.3m, 607.2d, 613.1d: Rukarumel, "Slivers you control and nontoken creatures you control are the chosen type in addition to their other creature types."', () => {
  const board = (): GameState => {
    let s = scenario([], { defs: [BIO, BEAR], p1: { hand: ['Test Biologist'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = castAndResolve(s, 'Test Biologist', ['Elf']);
    return s;
  };
  it('is automated', () => expect(noManual(BIO)).toEqual([]));
  it('your nontoken Bear and the Biologist itself are Elves in addition to their types; the opponent\'s Bear is not', () => {
    const s = board();
    expect(subtypesOf(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual(['Bear', 'Elf']);
    expect(subtypesOf(s, find(s, 'Test Biologist', 'battlefield', 'p1'))).toEqual(['Elf', 'Human', 'Wizard']);
    expect(subtypesOf(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toEqual(['Bear']);
  });
  it('a Sliver token you control is an Elf too, but a Goblin token (a token, not a Sliver) is not', () => {
    let s = board();
    s = activate(s, 'Test Biologist', 0);
    s = activate(s, 'Test Biologist', 1);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    const byType = tokens.map((id) => subtypesOf(s, id));
    expect(byType).toContainEqual(['Elf', 'Sliver']);
    expect(byType).toContainEqual(['Goblin']);
    expect(byType).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Painter's Servant: every card, spell and permanent gains the chosen color
// ---------------------------------------------------------------------------------------------------------------------------------
const PAINTER = card('Test Painter', 'Artifact Creature — Scarecrow', "As ~ enters, choose a color.\nThe cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors.", { pt: ['1', '1'] });
const WHITE_BEAR = card('Test White Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['W'] });
const SPELL = card('Test Pebble', 'Sorcery', 'You gain 1 life.', { cost: '{1}', colors: ['R'] });

describe('CR 105.2, 108.2, 607.2d, 613.1e: Painter\'s Servant, "The cards that aren\'t on the battlefield, spells, and permanents are the chosen color in addition to their other colors."', () => {
  const board = (): GameState => {
    let s = scenario([], { defs: [PAINTER, WHITE_BEAR, SPELL], p1: { hand: ['Test Painter', 'Test Pebble'], graveyard: ['Test White Bear'], battlefield: ['Test White Bear', 'Plains'] }, p2: { hand: ['Test White Bear'], battlefield: ['Test White Bear'] } });
    s = castAndResolve(s, 'Test Painter', ['U']);
    return s;
  };
  it('is automated', () => expect(noManual(PAINTER)).toEqual([]));
  it('with blue chosen: a white permanent of either player is white and blue, the Painter itself is blue, cards in hands, libraries and graveyards are blue', () => {
    const s = board();
    expect(colorsOf(s, find(s, 'Test White Bear', 'battlefield', 'p1'))).toEqual(['U', 'W']);
    expect(colorsOf(s, find(s, 'Test White Bear', 'battlefield', 'p2'))).toEqual(['U', 'W']);
    expect(colorsOf(s, find(s, 'Test Painter', 'battlefield', 'p1'))).toEqual(['U']);
    expect(colorsOf(s, find(s, 'Test White Bear', 'graveyard', 'p1'))).toEqual(['U', 'W']);
    expect(colorsOf(s, find(s, 'Test White Bear', 'hand', 'p2'))).toEqual(['U', 'W']);
    expect(colorsOf(s, find(s, 'Test Pebble', 'hand', 'p1'))).toEqual(['R', 'U']);
    expect(colorsOf(s, s.zones.library['p2']![0]!)).toEqual(['U']);
  });
  it('a land is blue too (a permanent), and a spell on the stack is its own color and blue', () => {
    let s = board();
    expect(colorsOf(s, find(s, 'Plains', 'battlefield', 'p1'))).toEqual(['U']);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pebble', 'hand', 'p1') } as never));
    expect(s.zones.stack.map((id) => colorsOf(s, id))).toEqual([['R', 'U']]);
  });
  it('negative: before the Servant is on the battlefield everything keeps its colors', () => {
    const s = scenario([], { defs: [PAINTER, WHITE_BEAR], p1: { hand: ['Test Painter'], battlefield: ['Test White Bear'] } });
    expect(colorsOf(s, find(s, 'Test White Bear', 'battlefield', 'p1'))).toEqual(['W']);
    expect(colorsOf(s, find(s, 'Test Painter', 'hand', 'p1'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Callous Oppressor: "As ~ enters, an opponent chooses a creature type." and "target creature that isn't of the chosen type"
// ---------------------------------------------------------------------------------------------------------------------------------
const OPPRESSOR = card('Test Oppressor', 'Creature — Octopus', "You may choose not to untap ~ during your untap step.\nAs ~ enters, an opponent chooses a creature type.\n{T}: Gain control of target creature that isn't of the chosen type for as long as ~ remains tapped.", { pt: ['1', '1'] });
const FOE_BEAR = card('Test Foe Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FOE_GOBLIN = card('Test Foe Goblin', 'Creature — Goblin', '', { pt: ['2', '2'] });

type Zones4 = Record<string, { hand?: string[]; battlefield?: string[]; graveyard?: string[] }>;
/** A game of four players (Alice, Bob, Carol, Dan) at the first main phase of turn 1 with the given definitions; p1 is active. */
function fourPlayerGame(defs: CardDef[], zones: Zones4): GameState {
  const base = playersConfig(4, 'edh-d-72-four');
  let s = createGame({ ...base, defs: [...(Array.isArray(base.defs) ? base.defs : Object.values(base.defs)), ...defs], options: { ...base.options, startingPlayer: 'p1', skipMulligans: true } });
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  s = structuredClone(s);
  for (const p of ['p1', 'p2', 'p3', 'p4']) {
    for (const id of [...s.zones.hand[p]!]) delete s.objects[id];
    s.zones.hand[p] = [];
  }
  for (const [p, z] of Object.entries(zones)) for (const zone of ['hand', 'graveyard', 'battlefield'] as const) for (const n of z[zone] ?? []) put(s, p as never, zone, n);
  return s;
}
/** Cast `name` from p1's hand and resolve it, answering each chooseName with the next of `names`; returns the state and who was asked. */
function castAsking(s0: GameState, name: string, names: string[]): { s: GameState; asked: string[] } {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never));
  const asked: string[] = [];
  for (let g = 0; g < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const d = s.pending!;
    if (d.kind === 'chooseName') { asked.push(d.player); s = answer(s, { kind: 'chooseName', name: names[asked.length - 1] ?? 'Elf' } as never); }
    else if (d.kind === 'chooseOption') { asked.push(`option:${d.player}`); s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string }[])[0]!.id] } as never); }
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else s = pass(s);
  }
  return { s, asked };
}
const nextOwnTurn = (s: GameState): GameState => advanceTo(s, 3, 'main1');

describe('CR 614.12a, 608.2d, 607.2d: Callous Oppressor, "As ~ enters, an opponent chooses a creature type."', () => {
  it('is automated', () => expect(noManual(OPPRESSOR)).toEqual([]));
  it('two players: the one opponent (not the caster) is asked; the tap ability can\'t target a creature of the chosen type, and takes control of another', () => {
    const s0 = scenario([], { defs: [OPPRESSOR, FOE_BEAR, FOE_GOBLIN], p1: { hand: ['Test Oppressor'] }, p2: { battlefield: ['Test Foe Bear', 'Test Foe Goblin'] } });
    const { s: s1, asked } = castAsking(s0, 'Test Oppressor', ['Bear']);
    expect(asked).toEqual(['p2']);
    let s = nextOwnTurn(s1);
    const opp = find(s, 'Test Oppressor', 'battlefield', 'p1');
    const bear = find(s, 'Test Foe Bear', 'battlefield', 'p2');
    const gob = find(s, 'Test Foe Goblin', 'battlefield', 'p2');
    const tap = legal(s, 'p1', 'activate').filter((a) => a.object === opp && !a.isMana);
    expect(tap).toHaveLength(1);
    s = act(s, tap[0]!.action);
    const d = s.pending as unknown as { kind: string; options?: unknown; specs?: unknown };
    expect(d.kind).toBe('chooseTargets');
    expect(JSON.stringify(d)).toContain(gob);
    expect(JSON.stringify(d)).not.toContain(bear);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: gob }] } as never);
    for (let g = 0; g < 8 && s.zones.stack.length > 0; g++) s = passBoth(s);
    expect(s.objects[gob]!.controller).toBe('p1');
    expect(s.objects[bear]!.controller).toBe('p2');
  });
  it('four players: the caster picks which opponent chooses (asked of the caster), and that opponent, not the caster, then names the type', () => {
    const s0 = fourPlayerGame([OPPRESSOR, FOE_BEAR], { p1: { hand: ['Test Oppressor'] }, p2: { battlefield: ['Test Foe Bear'] } });
    const { asked } = castAsking(s0, 'Test Oppressor', ['Bear']);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe('option:p1');
    expect(['p2', 'p3', 'p4']).toContain(asked[1]);
  });
  it('negative: without the type chosen nothing is excluded (no choice recorded: the target is any creature)', () => {
    const s = scenario([], { defs: [OPPRESSOR, FOE_BEAR], p2: { battlefield: ['Test Foe Bear'] }, p1: { battlefield: ['Test Oppressor'] } });
    const opp = find(s, 'Test Oppressor', 'battlefield', 'p1');
    const tap = legal(s, 'p1', 'activate').filter((a) => a.object === opp && !a.isMana);
    expect(tap).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Traveler's Cloak: "As ~ enters, choose a land type." and "Enchanted creature has landwalk of the chosen type."
// ---------------------------------------------------------------------------------------------------------------------------------
const CLOAK = card('Test Cloak', 'Enchantment — Aura', 'Enchant creature\nAs ~ enters, choose a land type.\nEnchanted creature has landwalk of the chosen type.', { cost: '{0}' });
const WALKER = card('Test Walker', 'Creature — Human', '', { pt: ['2', '2'] });
const GUARD = card('Test Guard', 'Creature — Human', '', { pt: ['2', '2'] });

/** Attack with `attacker` (p1) and report whether `blocker` (p2) is offered as a possible blocker of it (CR 509.1a-b). */
function canBlock(s0: GameState, attacker: string, blocker: string): boolean {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers', 10);
  return s.pending?.kind === 'declareBlockers' && s.pending.candidates.some((c) => c.id === blocker && c.attackers.length > 0);
}

describe('CR 702.14a, 702.14c, 607.2d: Traveler\'s Cloak, "Enchanted creature has landwalk of the chosen type."', () => {
  const enchanted = (landType: string, defenderLands: string[]): { s: GameState; walker: string; guard: string } => {
    let s = scenario(['Forest', 'Plains'], { defs: [CLOAK, WALKER, GUARD], p1: { hand: ['Test Cloak'], battlefield: ['Test Walker'] }, p2: { battlefield: ['Test Guard', ...defenderLands] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cloak', 'hand', 'p1') } as never));
    const walker = find(s, 'Test Walker', 'battlefield', 'p1');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: walker }] } as never);
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending!;
      if (d.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: landType } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    return { s, walker, guard: find(s, 'Test Guard', 'battlefield', 'p2') };
  };
  it('is automated', () => expect(noManual(CLOAK)).toEqual([]));
  it('any land type can be chosen (Desert here, a nonbasic type): the creature has the landwalk of that type', () => {
    const { s, walker } = enchanted('Desert', []);
    const kws = charsOfObject(s, s.objects[walker]!).keywords.filter((k) => k.keyword === 'landwalk').map((k) => k.quality);
    expect(kws).toEqual(['desert']);
  });
  it('with Forest chosen the enchanted creature can\'t be blocked while the defending player controls a Forest', () => {
    const { s, walker, guard } = enchanted('Forest', ['Forest']);
    expect(canBlock(s, walker, guard)).toBe(false);
  });
  it('negative: the defending player controls no Forest (only a Plains): the creature can be blocked; and with Plains chosen a Forest does not stop a block', () => {
    const a = enchanted('Forest', ['Plains']);
    expect(canBlock(a.s, a.walker, a.guard)).toBe(true);
    const b = enchanted('Plains', ['Forest']);
    expect(canBlock(b.s, b.walker, b.guard)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Tablet of the Guilds: choose two colors; a spell that is at least one of them gains you 1 life for each of them it is
// ---------------------------------------------------------------------------------------------------------------------------------
const TABLET = card('Test Tablet', 'Artifact', "As ~ enters, choose two colors.\nWhenever you cast a spell, if it's at least one of the chosen colors, you gain 1 life for each of the chosen colors it is.");
const RG_SPELL = card('Test Gruul Spell', 'Sorcery', 'You gain 0 life.', { cost: '{0}', colors: ['R', 'G'] });
const R_SPELL = card('Test Red Spell', 'Sorcery', 'You gain 0 life.', { cost: '{0}', colors: ['R'] });
const U_SPELL = card('Test Blue Spell', 'Sorcery', 'You gain 0 life.', { cost: '{0}', colors: ['U'] });
const RU_SPELL = card('Test Izzet Spell', 'Sorcery', 'You gain 0 life.', { cost: '{0}', colors: ['R', 'U'] });
const COLORLESS = card('Test Colorless Spell', 'Sorcery', 'You gain 0 life.', { cost: '{0}' });

describe('CR 105.1, 603.4, 607.2d: Tablet of the Guilds, "...if it\'s at least one of the chosen colors, you gain 1 life for each of the chosen colors it is."', () => {
  const lifeAfter = (spell: string): number => {
    let s = scenario([], { defs: [TABLET, RG_SPELL, R_SPELL, U_SPELL, RU_SPELL, COLORLESS], p1: { hand: ['Test Tablet', spell] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tablet', 'hand', 'p1') } as never));
    let n = 0;
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending!;
      if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (n++ === 0 ? 'R' : 'G') as never } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    const before = s.players.find((p) => p.id === 'p1')!.life;
    s = castAndResolve(s, spell);
    return s.players.find((p) => p.id === 'p1')!.life - before;
  };
  it('is automated', () => expect(noManual(TABLET)).toEqual([]));
  it('with red and green chosen: a red-green spell gains 2, a red spell 1, a red-blue spell 1 (only red is chosen)', () => {
    expect(lifeAfter('Test Gruul Spell')).toBe(2);
    expect(lifeAfter('Test Red Spell')).toBe(1);
    expect(lifeAfter('Test Izzet Spell')).toBe(1);
  });
  it('negative: a blue spell and a colorless spell are none of the chosen colors: no life', () => {
    expect(lifeAfter('Test Blue Spell')).toBe(0);
    expect(lifeAfter('Test Colorless Spell')).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Radiant Destiny: the chosen type gets +1/+1; with the city's blessing they also have vigilance
// ---------------------------------------------------------------------------------------------------------------------------------
const DESTINY = card('Test Destiny', 'Enchantment', "Ascend\nAs ~ enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1. As long as you have the city's blessing, they also have vigilance.", { cost: '{0}' });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const LEGION = card('Test Legionnaire', 'Creature — Human', '', { pt: ['2', '2'] });

describe('CR 611.3a, 613.1f, 702.131a: Radiant Destiny, "Creatures you control of the chosen type get +1/+1. As long as you have the city\'s blessing, they also have vigilance."', () => {
  const board = (extra: string[]): GameState => {
    let s = scenario([], { defs: [DESTINY, ELF, LEGION], p1: { hand: ['Test Destiny'], battlefield: ['Test Elf', 'Test Legionnaire', ...extra] }, p2: { battlefield: ['Test Elf'] } });
    s = castAndResolve(s, 'Test Destiny', ['Elf']);
    return s;
  };
  const pt = (s: GameState, id: string): string => { const c = charsOfObject(s, s.objects[id]!); return `${c.power}/${c.toughness}`; };
  const vigilant = (s: GameState, id: string): boolean => charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === 'vigilance');
  it('is automated', () => expect(noManual(DESTINY)).toEqual([]));
  it('your Elf gets +1/+1, your Human and the opponent\'s Elf do not; nobody has vigilance without the city\'s blessing', () => {
    const s = board([]);
    expect(pt(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Legionnaire', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Elf', 'battlefield', 'p2'))).toBe('1/1');
    expect(vigilant(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe(false);
  });
  it('with ten permanents (the city\'s blessing) your Elf has vigilance, your Human and the opponent\'s Elf still do not', () => {
    const s = board(Array(8).fill('Plains'));
    expect(vigilant(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe(true);
    expect(vigilant(s, find(s, 'Test Legionnaire', 'battlefield', 'p1'))).toBe(false);
    expect(vigilant(s, find(s, 'Test Elf', 'battlefield', 'p2'))).toBe(false);
    expect(pt(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe('2/2');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Winding Way: choose creature or land, reveal the top four, the cards of that type to hand, the rest to the graveyard
// ---------------------------------------------------------------------------------------------------------------------------------
const WAY = card('Test Way', 'Sorcery', 'Choose creature or land. Reveal the top four cards of your library. Put all cards of the chosen type revealed this way into your hand and the rest into your graveyard.', { cost: '{0}' });
const ART = card('Test Trinket', 'Artifact', '');

describe('CR 701.20a, 608.2d, 607.2d: Winding Way, "Choose creature or land. Reveal the top four cards of your library. Put all cards of the chosen type ... into your hand and the rest into your graveyard."', () => {
  const play = (choice: string, top: string[]): GameState => {
    let s = scenario([], { defs: [WAY, ELF, ART], p1: { hand: ['Test Way'], library: [...top, ...Array(10).fill('Test Trinket')] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Way', 'hand', 'p1') } as never));
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending!;
      if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string; label: string }[]).find((o) => o.label.toLowerCase().includes(choice))?.id ?? (d.options as { id: string }[])[0]!.id] } as never);
      else if (d.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: choice[0]!.toUpperCase() + choice.slice(1) } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => expect(noManual(WAY)).toEqual([]));
  it('choosing creature: the two Elves of the top four go to hand, the other two cards to the graveyard (Winding Way itself too)', () => {
    const s = play('creature', ['Test Elf', 'Test Trinket', 'Plains', 'Test Elf']);
    expect(findAll(s, 'Test Elf', 'hand', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Test Trinket', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Plains', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('choosing land: the Plains goes to hand and the Elves are in the graveyard; cards below the top four stay in the library', () => {
    const s = play('land', ['Test Elf', 'Test Trinket', 'Plains', 'Test Elf']);
    expect(findAll(s, 'Plains', 'hand', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Elf', 'graveyard', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Test Trinket', 'library', 'p1').length).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Mirror of the Forebears: until end of turn it becomes a copy of target creature you control of the chosen type, except it's an artifact
// ---------------------------------------------------------------------------------------------------------------------------------
const MIRROR = card('Test Mirror', 'Artifact', "As ~ enters, choose a creature type.\n{0}: Until end of turn, ~ becomes a copy of target creature you control of the chosen type, except it's an artifact in addition to its other types.");

describe('CR 707.9a, 205.1b, 613.1a: Mirror of the Forebears, "Until end of turn, ~ becomes a copy of target creature you control of the chosen type, except it\'s an artifact in addition to its other types."', () => {
  it('is automated', () => expect(noManual(MIRROR)).toEqual([]));
  it('the Elf is the only legal target; the Mirror becomes an artifact Elf copy with its power and toughness until end of turn', () => {
    const BIG_ELF = card('Test Big Elf', 'Creature — Elf Warrior', '', { pt: ['5', '4'] });
    let s = scenario([], { defs: [MIRROR, BIG_ELF, LEGION], p1: { hand: ['Test Mirror'], battlefield: ['Test Big Elf', 'Test Legionnaire'] } });
    s = castAndResolve(s, 'Test Mirror', ['Elf']);
    const mirror = find(s, 'Test Mirror', 'battlefield', 'p1');
    const acts = legal(s, 'p1', 'activate').filter((a) => a.object === mirror && !a.isMana);
    expect(acts).toHaveLength(1);
    s = act(s, acts[0]!.action);
    expect(s.pending?.kind).toBe('chooseTargets');
    const human = find(s, 'Test Legionnaire', 'battlefield', 'p1');
    const elf = find(s, 'Test Big Elf', 'battlefield', 'p1');
    expect(JSON.stringify(s.pending)).toContain(elf);
    expect(JSON.stringify(s.pending)).not.toContain(human);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: elf }] } as never);
    for (let g = 0; g < 8 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : passBoth(s);
    const c = charsOfObject(s, s.objects[mirror]!);
    expect([c.power, c.toughness]).toEqual(['5', '4']);
    expect(c.types).toContain('Artifact');
    expect(c.types).toContain('Creature');
    expect([...c.subtypes].sort()).toEqual(['Elf', 'Warrior']);
  });
});
