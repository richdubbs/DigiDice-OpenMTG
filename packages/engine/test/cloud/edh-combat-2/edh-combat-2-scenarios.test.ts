/**
 * Commander lane edh-combat, round edh-combat-2: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not
 * in the cloud checkout).
 *
 *   CR 303.4, 301.5, 508.1m, 603.2   "Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn."
 *   CR 303.4b, 301.5, 604.1          "Creatures you control that are enchanted or equipped have double strike."
 *   CR 506.2, 508.1a, 603.2c, 111.1  "Whenever a player attacks one or more of your opponents, that attacking player creates a Treasure token."
 *   CR 107.3, 608.2c, 111.1          "Create X ... tokens. If X is 5 or more, also create X ... tokens."
 *   CR 613.1f, 105.2, 604.1          "Each creature you control has flying if it's white, reach if it's blue, ..."
 *   CR 509.1g-h, 506.4, 702.7        "Equipped creature has first strike as long as it's blocking or blocked by a Goblin or Orc."
 *   CR 305.6, 613.1d, 702.14, 508.1  "All lands are Islands in addition to their other types." / "Creatures without flying or islandwalk can't attack."
 *   CR 301.5, 611.3a                 "~ has first strike as long as it's equipped."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const has = (s: GameState, id: ObjectId, keyword: string): boolean => chars(s, id).keywords.some((k) => k.keyword === keyword);
const keywordsOf = (s: GameState, id: ObjectId): string[] => chars(s, id).keywords.map((k) => k.keyword).sort();

/** Answer the decisions that come up until priority (payments automatic; numbers `x`; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { x?: number; yes?: boolean; targets?: ObjectId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o); // a decision first (the order of simultaneous triggers, CR 603.3b)
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const bearsOf = (s: GameState, name: string, p: PlayerId): ObjectId[] => findAll(s, name, 'battlefield', p);

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const BLADE = card('Test Plain Blade', 'Artifact — Equipment', '');
const CHARM = card('Test Plain Charm', 'Enchantment — Aura', 'Enchant creature');

/** Attach the Equipment `name` of the scenario to a creature (test setup only; the engine reads `attachedTo`). */
const attach = (s: GameState, name: string, to: ObjectId, p: PlayerId = 'p1'): void => { s.objects[find(s, name, 'battlefield', p)]!.attachedTo = to; };
/** p1 casts the Aura `name` from the hand onto a creature and it resolves (an Aura placed by hand would be put into the graveyard by the first state-based check, CR 704.5m). */
const enchant = (s: GameState, name: string, to: ObjectId): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), { targets: [to] }), { targets: [to] });

describe('CR 303.4b, 301.5, 508.1m, 603.2: "Whenever a creature you control that\'s enchanted or equipped attacks, that creature gains double strike until end of turn."', () => {
  const DWARF = card('Test Forge Dwarf', 'Creature — Dwarf', "Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn.", { pt: ['1', '1'] });
  const defs = [DWARF, BEAR, BLADE, CHARM];
  const start = (): GameState => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Forge Dwarf', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Blade'], hand: ['Test Plain Charm'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Blade'] } });
    const [equipped, enchanted] = bearsOf(s, 'Test Plain Bear', 'p1');
    attach(s, 'Test Plain Blade', equipped!);
    return enchant(s, 'Test Plain Charm', enchanted!);
  };
  it('is understood', () => expect(noManual(DWARF)).toBe(true));
  it('the equipped attacker and the enchanted attacker gain double strike; the plain attacker does not', () => {
    const s0 = advanceTo(start(), 3, 'main1');
    const [equipped, enchanted, plain] = bearsOf(s0, 'Test Plain Bear', 'p1');
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[equipped!], [enchanted!], [plain!]]));
    expect(has(s, equipped!, 'double strike')).toBe(true);
    expect(has(s, enchanted!, 'double strike')).toBe(true);
    expect(has(s, plain!, 'double strike')).toBe(false);
  });
  it('it needs the creature to attack: before the declaration nobody has double strike', () => {
    const s0 = advanceTo(start(), 3, 'main1');
    for (const id of bearsOf(s0, 'Test Plain Bear', 'p1')) expect(has(s0, id, 'double strike')).toBe(false);
  });
  it('"a creature you control": an opponent\'s equipped creature that attacks gains nothing', () => {
    const s0 = start();
    attach(s0, 'Test Plain Blade', bearsOf(s0, 'Test Plain Bear', 'p2')[0]!, 'p2');
    const s1 = toDeclareAttackers(advanceTo(s0, 4, 'main1'));
    expect(s1.turn.activePlayer).toBe('p2');
    const theirs = bearsOf(s1, 'Test Plain Bear', 'p2')[0]!;
    const s = resolveAll(declareAttackers(s1, [[theirs]]));
    expect(has(s, theirs, 'double strike')).toBe(false);
  });
  it('the grant lasts until end of turn only', () => {
    const s0 = advanceTo(start(), 3, 'main1');
    const [equipped] = bearsOf(s0, 'Test Plain Bear', 'p1');
    let s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[equipped!]]));
    expect(has(s, equipped!, 'double strike')).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(has(s, equipped!, 'double strike')).toBe(false);
  });
});

describe('CR 303.4b, 301.5, 604.1: "Creatures you control that are enchanted or equipped have double strike."', () => {
  const HALL = card('Test Smith Hall', 'Enchantment', 'Creatures you control that are enchanted or equipped have double strike.');
  const defs = [HALL, BEAR, BLADE, CHARM];
  it('is understood', () => expect(noManual(HALL)).toBe(true));
  it('an equipped creature and an enchanted creature of yours have double strike, a plain one does not, and neither does an opponent\'s equipped creature', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Smith Hall', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Blade'], hand: ['Test Plain Charm'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Blade'] } });
    const [equipped, enchanted, plain] = bearsOf(s0, 'Test Plain Bear', 'p1');
    attach(s0, 'Test Plain Blade', equipped!);
    const s = enchant(s0, 'Test Plain Charm', enchanted!);
    const theirs = bearsOf(s, 'Test Plain Bear', 'p2')[0]!;
    attach(s, 'Test Plain Blade', theirs, 'p2');
    expect(has(s, equipped!, 'double strike')).toBe(true);
    expect(has(s, enchanted!, 'double strike')).toBe(true);
    expect(has(s, plain!, 'double strike')).toBe(false);
    expect(has(s, theirs, 'double strike')).toBe(false);
  });
  it('unattached again, the creature loses it (the condition is read continuously, CR 611.3a)', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Smith Hall', 'Test Plain Bear', 'Test Plain Blade'] } });
    const bear = bearsOf(s, 'Test Plain Bear', 'p1')[0]!;
    attach(s, 'Test Plain Blade', bear);
    expect(has(s, bear, 'double strike')).toBe(true);
    s.objects[find(s, 'Test Plain Blade', 'battlefield', 'p1')]!.attachedTo = undefined;
    expect(has(s, bear, 'double strike')).toBe(false);
  });
});

describe('CR 506.2, 508.1a, 603.2c: "Whenever a player attacks one or more of your opponents, that attacking player creates a Treasure token."', () => {
  const QUEEN = card('Test Coin Queen', 'Legendary Creature — Human', 'Whenever a player attacks one or more of your opponents, that attacking player creates a Treasure token.', { pt: ['2', '2'] });
  const defs = [QUEEN, BEAR];
  const treasures = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && chars(s, id).name.replace(/ Token$/, '') === 'Treasure').length;
  /** A game of three: p1 holds the Queen; `active` is the player whose turn it is; every player has two ready Bears. */
  const start = (active: PlayerId): GameState =>
    mpScenario({
      players: 3, defs, options: { startingPlayer: active },
      zones: {
        p1: { battlefield: ['Test Coin Queen', { name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Bear', since: -1 }] },
        p2: { battlefield: [{ name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Bear', since: -1 }] },
        p3: { battlefield: [{ name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Bear', since: -1 }] },
      },
    });
  function attackWith(s0: GameState, who: PlayerId, attacks: [number, PlayerId][]): GameState {
    let s = s0;
    for (let i = 0; i < 80 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.turn.activePlayer).toBe(who);
    const bears = bearsOf(s, 'Test Plain Bear', who);
    return resolveAll(drive(answer(s, { kind: 'declareAttackers', attacks: attacks.map(([i, defender]) => ({ attacker: bears[i]!, defender })) })));
  }
  it('is understood', () => expect(noManual(QUEEN)).toBe(true));
  it('you attack an opponent with two creatures: one trigger, you create one Treasure', () => {
    const s = attackWith(start('p1'), 'p1', [[0, 'p2'], [1, 'p2']]);
    expect(treasures(s, 'p1')).toBe(1);
    expect(treasures(s, 'p2')).toBe(0);
  });
  it('CR 603.2c: you attack both opponents: still one trigger ("one or more of your opponents")', () => {
    const s = attackWith(start('p1'), 'p1', [[0, 'p2'], [1, 'p3']]);
    expect(treasures(s, 'p1')).toBe(1);
  });
  it('an opponent attacks the other opponent: that attacking player (not the Queen\'s controller) creates the Treasure', () => {
    const s = attackWith(start('p2'), 'p2', [[0, 'p3'], [1, 'p3']]);
    expect(treasures(s, 'p2')).toBe(1);
    expect(treasures(s, 'p1')).toBe(0);
    expect(treasures(s, 'p3')).toBe(0);
  });
  it('an opponent attacks you and the other opponent: one trigger, the attacking player creates one Treasure', () => {
    const s = attackWith(start('p2'), 'p2', [[0, 'p1'], [1, 'p3']]);
    expect(treasures(s, 'p2')).toBe(1);
    expect(treasures(s, 'p1')).toBe(0);
  });
  it('negative: an opponent who attacks only you (not one of your opponents) creates nothing', () => {
    const s = attackWith(start('p2'), 'p2', [[0, 'p1'], [1, 'p1']]);
    expect(treasures(s, 'p2')).toBe(0);
    expect(treasures(s, 'p1')).toBe(0);
    expect(treasures(s, 'p3')).toBe(0);
  });
});

describe('CR 107.3, 608.2c, 111.1: "Create X 1/1 white Soldier creature tokens. If X is 5 or more, also create X 2/2 white Angel creature tokens."', () => {
  const RALLY = card('Test Rally Cry', 'Sorcery', 'Create X 1/1 white Soldier creature tokens. If X is 5 or more, also create X 2/2 white Angel creature tokens with flying.', { cost: '{X}{W}' });
  const defs = [RALLY];
  const play = (x: number): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Rally Cry'], battlefield: Array(x + 1).fill('Plains') as string[] } });
    return resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rally Cry', 'hand', 'p1') }), { x }), { x });
  };
  const count = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && chars(s, id).subtypes.includes(name)).length;
  it('is understood', () => expect(noManual(RALLY)).toBe(true));
  it('X = 5 is "5 or more": five Soldiers and five Angels (the number X again, not the number of Soldiers made)', () => {
    const s = play(5);
    expect(count(s, 'Soldier')).toBe(5);
    expect(count(s, 'Angel')).toBe(5);
  });
  it('X = 7: seven of each', () => {
    const s = play(7);
    expect(count(s, 'Soldier')).toBe(7);
    expect(count(s, 'Angel')).toBe(7);
  });
  it('negative: X = 4 makes only the four Soldiers', () => {
    const s = play(4);
    expect(count(s, 'Soldier')).toBe(4);
    expect(count(s, 'Angel')).toBe(0);
  });
});

describe('CR 613.1f, 105.2, 604.1: "Each creature you control has flying if it\'s white, reach if it\'s blue, menace if it\'s black, haste if it\'s red, and trample if it\'s green."', () => {
  const LORD = card('Test Prism Wyrm', 'Creature — Dragon', "Each creature you control has flying if it's white, reach if it's blue, menace if it's black, haste if it's red, and trample if it's green.", { pt: ['3', '3'] });
  const W = card('Test White Mite', 'Creature — Insect', '', { pt: ['1', '1'], colors: ['W'] });
  const U = card('Test Blue Mite', 'Creature — Insect', '', { pt: ['1', '1'], colors: ['U'] });
  const B = card('Test Black Mite', 'Creature — Insect', '', { pt: ['1', '1'], colors: ['B'] });
  const R = card('Test Red Mite', 'Creature — Insect', '', { pt: ['1', '1'], colors: ['R'] });
  const G = card('Test Green Mite', 'Creature — Insect', '', { pt: ['1', '1'], colors: ['G'] });
  const WU = card('Test Pale Mite', 'Creature — Insect', '', { pt: ['1', '1'], colors: ['W', 'U'] });
  const C = card('Test Gray Mite', 'Creature — Insect', '', { pt: ['1', '1'] });
  const defs = [LORD, W, U, B, R, G, WU, C];
  const names = ['Test White Mite', 'Test Blue Mite', 'Test Black Mite', 'Test Red Mite', 'Test Green Mite', 'Test Pale Mite', 'Test Gray Mite'];
  it('is understood', () => expect(noManual(LORD)).toBe(true));
  it('each color\'s creature has exactly its keyword; a two-color creature has both; a colorless one has none', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Prism Wyrm', ...names] } });
    const kw = (n: string) => keywordsOf(s, find(s, n, 'battlefield', 'p1'));
    expect(kw('Test White Mite')).toEqual(['flying']);
    expect(kw('Test Blue Mite')).toEqual(['reach']);
    expect(kw('Test Black Mite')).toEqual(['menace']);
    expect(kw('Test Red Mite')).toEqual(['haste']);
    expect(kw('Test Green Mite')).toEqual(['trample']);
    expect(kw('Test Pale Mite')).toEqual(['flying', 'reach']);
    expect(kw('Test Gray Mite')).toEqual([]);
  });
  it('negative: an opponent\'s creatures get nothing', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Prism Wyrm'] }, p2: { battlefield: ['Test White Mite', 'Test Green Mite'] } });
    expect(keywordsOf(s, find(s, 'Test White Mite', 'battlefield', 'p2'))).toEqual([]);
    expect(keywordsOf(s, find(s, 'Test Green Mite', 'battlefield', 'p2'))).toEqual([]);
  });
});

describe('CR 509.1g-h, 506.4, 702.7: "Equipped creature has first strike as long as it\'s blocking or blocked by a Goblin or Orc."', () => {
  const FANG = card('Test Gnash Fang', 'Artifact — Equipment', "Equipped creature has first strike as long as it's blocking or blocked by a Goblin or Orc.\nEquip {2}");
  const GOBLIN = card('Test Raid Goblin', 'Creature — Goblin', '', { pt: ['1', '1'], colors: ['R'] });
  const ORC = card('Test Raid Orc', 'Creature — Orc', '', { pt: ['1', '1'], colors: ['B'] });
  const ELF = card('Test Quiet Elf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });
  const defs = [FANG, GOBLIN, ORC, ELF, BEAR];
  it('is understood', () => expect(noManual(FANG)).toBe(true));
  for (const [blocker, expected] of [['Test Raid Goblin', true], ['Test Raid Orc', true], ['Test Quiet Elf', false]] as const) {
    it(`attacking with the equipped Bear, blocked by ${blocker}: first strike ${expected ? 'yes' : 'no'}`, () => {
      const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Bear', 'Test Gnash Fang'] }, p2: { battlefield: [blocker] } });
      attach(s0, 'Test Gnash Fang', find(s0, 'Test Plain Bear', 'battlefield', 'p1'));
      const s1 = toDeclareBlockers(declareAttackers(toDeclareAttackers(advanceTo(s0, 3, 'main1')), [[find(s0, 'Test Plain Bear', 'battlefield', 'p1')]]));
      const bear = find(s1, 'Test Plain Bear', 'battlefield', 'p1');
      expect(has(s1, bear, 'first strike')).toBe(false); // not yet blocked
      const s = declareBlockers(s1, [[find(s1, blocker, 'battlefield', 'p2'), bear]]);
      expect(has(s, bear, 'first strike')).toBe(expected);
    });
  }
  it('the equipped creature BLOCKING a Goblin has first strike too; blocking an Elf it does not', () => {
    for (const [attacker, expected] of [['Test Raid Goblin', true], ['Test Quiet Elf', false]] as const) {
      const s0 = scenario([], { defs, p1: { battlefield: [attacker] }, p2: { battlefield: ['Test Plain Bear', 'Test Gnash Fang'] } });
      attach(s0, 'Test Gnash Fang', find(s0, 'Test Plain Bear', 'battlefield', 'p2'), 'p2');
      const s1 = toDeclareBlockers(declareAttackers(toDeclareAttackers(advanceTo(s0, 3, 'main1')), [[find(s0, attacker, 'battlefield', 'p1')]]));
      const bear = find(s1, 'Test Plain Bear', 'battlefield', 'p2');
      const s = declareBlockers(s1, [[bear, find(s1, attacker, 'battlefield', 'p1')]]);
      expect(has(s, bear, 'first strike'), attacker).toBe(expected);
    }
  });
  it('negative: not in combat at all it has no first strike, and an unequipped Goblin-blocker pair gives none to the unequipped creature', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Bear', 'Test Gnash Fang'] }, p2: { battlefield: ['Test Raid Goblin'] } });
    attach(s0, 'Test Gnash Fang', find(s0, 'Test Plain Bear', 'battlefield', 'p1'));
    expect(has(s0, find(s0, 'Test Plain Bear', 'battlefield', 'p1'), 'first strike')).toBe(false);
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Plain Bear', 'Test Gnash Fang'] }, p2: { battlefield: ['Test Raid Goblin'] } });
    const bear = find(s1, 'Test Plain Bear', 'battlefield', 'p1'); // the Equipment is not attached
    const t0 = toDeclareBlockers(declareAttackers(toDeclareAttackers(advanceTo(s1, 3, 'main1')), [[bear]]));
    const t = declareBlockers(t0, [[find(t0, 'Test Raid Goblin', 'battlefield', 'p2'), bear]]);
    expect(has(t, bear, 'first strike')).toBe(false);
  });
});

describe('CR 305.6, 613.1d, 702.14, 508.1: "All lands are Islands in addition to their other types." and "Creatures without flying or islandwalk can\'t attack."', () => {
  const TIDE = card('Test Tide Serpent', 'Creature — Serpent', "Islandwalk\nAll lands are Islands in addition to their other types.\nCreatures without flying or islandwalk can't attack.", { pt: ['3', '3'], colors: ['U'] });
  const GULL = card('Test Gull', 'Creature — Bird', 'Flying', { pt: ['1', '1'], colors: ['U'] });
  const WADER = card('Test Wader', 'Creature — Merfolk', 'Islandwalk', { pt: ['1', '1'], colors: ['U'] });
  const defs = [TIDE, GULL, WADER, BEAR];
  it('is understood', () => expect(noManual(TIDE)).toBe(true));
  it('every land (an opponent\'s Forest too) is also an Island; the Forest is still a Forest', () => {
    const s = scenario(['Forest'], { defs, p1: { battlefield: ['Test Tide Serpent', 'Plains'] }, p2: { battlefield: ['Forest'] } });
    const theirs = find(s, 'Forest', 'battlefield', 'p2');
    expect([...chars(s, theirs).subtypes].sort()).toEqual(['Forest', 'Island']);
    expect([...chars(s, find(s, 'Plains', 'battlefield', 'p1')).subtypes].sort()).toEqual(['Island', 'Plains']);
  });
  it('a land that is an Island taps for {U} (the intrinsic mana ability of the land type, CR 305.6): a Forest pays for a {U} spell only while the Serpent is out', () => {
    const DEW = card('Test Dew Spell', 'Instant', 'Draw a card.', { cost: '{U}' });
    const withSerpent = scenario(['Forest'], { defs: [...defs, DEW], p1: { battlefield: ['Test Tide Serpent', 'Forest'], hand: ['Test Dew Spell'] } });
    const h0 = withSerpent.zones.hand.p1!.length;
    const s = resolveAll(drive(act(withSerpent, { type: 'cast', player: 'p1', card: find(withSerpent, 'Test Dew Spell', 'hand', 'p1') })));
    expect(s.zones.hand.p1!.length).toBe(h0); // cast (-1) and drew a card (+1)
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Dew Spell')).toBe(true);
    const without = scenario(['Forest'], { defs: [...defs, DEW], p1: { battlefield: ['Forest'], hand: ['Test Dew Spell'] } });
    expect(() => act(without, { type: 'cast', player: 'p1', card: find(without, 'Test Dew Spell', 'hand', 'p1') })).toThrow();
  });
  it('a creature without flying or islandwalk can\'t be declared as an attacker; flying, islandwalk and the Serpent itself (islandwalk) can', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Tide Serpent', 'Test Gull', 'Test Wader', 'Test Plain Bear'] } }), 3, 'main1');
    const s1 = toDeclareAttackers(s0);
    const bear = find(s1, 'Test Plain Bear', 'battlefield', 'p1');
    expect(() => declareAttackers(s1, [[bear]])).toThrow();
    const ok = [find(s1, 'Test Tide Serpent', 'battlefield', 'p1'), find(s1, 'Test Gull', 'battlefield', 'p1'), find(s1, 'Test Wader', 'battlefield', 'p1')];
    const s = declareAttackers(s1, ok.map((id) => [id] as [ObjectId]));
    expect(s.combat?.attackers.map((a) => a.id).sort()).toEqual([...ok].sort());
  });
  it('negative: without the Serpent the Bear attacks freely', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Plain Bear'] } }), 3, 'main1');
    const s1 = toDeclareAttackers(s0);
    const bear = find(s1, 'Test Plain Bear', 'battlefield', 'p1');
    expect(declareAttackers(s1, [[bear]]).combat?.attackers).toHaveLength(1);
  });
});

describe('CR 301.5, 611.3a: "~ has first strike as long as it\'s equipped." (the "it" is the object itself)', () => {
  const HOBBIT = card('Test Brave Hobbit', 'Creature — Halfling', "Test Brave Hobbit has first strike as long as it's equipped.", { pt: ['1', '1'] });
  const defs = [HOBBIT, BLADE, BEAR];
  it('is understood', () => expect(noManual(HOBBIT)).toBe(true));
  it('equipped it has first strike; unequipped it does not; another creature carrying the Equipment gets nothing', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Brave Hobbit', 'Test Plain Bear', 'Test Plain Blade'] } });
    const hobbit = find(s, 'Test Brave Hobbit', 'battlefield', 'p1');
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect(has(s, hobbit, 'first strike')).toBe(false);
    attach(s, 'Test Plain Blade', bear);
    expect(has(s, hobbit, 'first strike')).toBe(false);
    expect(has(s, bear, 'first strike')).toBe(false);
    attach(s, 'Test Plain Blade', hobbit);
    expect(has(s, hobbit, 'first strike')).toBe(true);
    expect(has(s, bear, 'first strike')).toBe(false);
  });
});
