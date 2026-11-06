/**
 * Commander lane edh-perms, round edh-perms-21: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 702.16c, 704.5m, 613.1f  "Enchanted creature has protection from black. This effect doesn't remove this Aura." (the granting Aura stays attached)
 *   CR 111.2, 707.2, 608.2d    "Create a token that's a copy of a nonlegendary enchantment you control." (a choice on resolution, no target)
 *   CR 115.9c, 707.2, 205.4a    "Whenever you cast a spell that targets only a single artifact or creature you control, create a token that's a copy of that artifact or creature, except it's not legendary."
 *   CR 707.2, 111.2, 607.2c    "Create a token that's a copy of that creature except it's an artifact in addition to its other types. Then exile all other tokens created with ~."
 *   CR 303.4f, 303.4g            "Return each Aura card from your graveyard to the battlefield. Only creatures can be enchanted this way."
 *   CR 614.1c, 205.1b, 613.4b    "As a historic permanent you control enters, it becomes a 7/7 Dinosaur creature in addition to its other types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { hasProtectionFrom } from '../../../src/rules/protection';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

const KEEPER = card('Test Black Keeper', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has protection from black. This effect doesn\'t remove this Aura.', { colors: ['B'] });
const PLAIN = card('Test Black Plain', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has protection from black.', { colors: ['B'] });
const OTHER = card('Test Black Other', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', { colors: ['B'] });
const WARD = card('Test Chosen Ward', 'Enchantment — Aura', 'Enchant creature\nAs this Aura enters, choose a color.\nEnchanted creature has protection from the chosen color. This effect doesn\'t remove this Aura.', { colors: ['G'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const SHADE = card('Test Shade', 'Creature — Shade', '', { pt: ['2', '2'], colors: ['B'] });
const DINOS = card('Test Displaced Dinos', 'Creature — Dinosaur', 'As a historic permanent you control enters, it becomes a 7/7 Dinosaur creature in addition to its other types.', { pt: ['7', '7'], colors: ['G'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const HERO = card('Test Hero', 'Legendary Creature — Human', '', { pt: ['1', '1'] });
const VASE = card('Test Vase', 'Enchantment', '');
const RETETHER = card('Test Reattach', 'Sorcery', 'Return each Aura card from your graveyard to the battlefield. Only creatures can be enchanted this way.');
const ANYWARD = card('Test Any Aura', 'Enchantment — Aura', 'Enchant permanent\nEnchanted permanent gets +0/+1.', { colors: ['W'] });
const LANDAURA = card('Test Land Aura', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add {G}."', { colors: ['G'] });
const BEARAURA = card('Test Bear Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', { colors: ['W'] });
const ARTISAN = card('Test Artisan', 'Creature — Faerie', 'Flying\nWhenever a nontoken creature an opponent controls enters, create a token that\'s a copy of that creature except it\'s an artifact in addition to its other types. Then exile all other tokens created with this creature.', { pt: ['2', '2'], colors: ['U'] });
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '3'], colors: ['G'] });
const DUPLI = card('Test Duplimancy', 'Enchantment', 'Whenever you cast a spell that targets only a single artifact or creature you control, create a token that\'s a copy of that artifact or creature, except it\'s not legendary.');
const BOOST = card('Test Boost', 'Instant', 'Target creature gets +1/+1 until end of turn.', { colors: ['G'] });
const CLONER = card('Test Cloner', 'Artifact', '{0}: Create a token that\'s a copy of a nonlegendary enchantment you control.');
const SHRINE = card('Test Shrine', 'Enchantment', '');
const LEGEND_SHRINE = card('Test Grand Shrine', 'Legendary Enchantment', '');
const PULSE = card('Test Pulse', 'Instant', 'Whenever you cast a noncreature spell this turn, create a token that\'s a copy of a non-Saga token you control.');
const SOLDIER_MAKER = card('Test Soldier Maker', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.');
const TREASURE_MAKER = card('Test Gold Maker', 'Artifact', '{0}: Create a Treasure token.');
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.', { colors: ['B'] });
const CURSE = card('Test Curse', 'Enchantment — Aura Curse', 'Enchant player\nAt the beginning of the upkeep of enchanted player, that player loses 1 life.', { colors: ['B'] });
const DEFS = [CURSE, SLAY, TREASURE_MAKER, PULSE, SOLDIER_MAKER, CLONER, SHRINE, LEGEND_SHRINE, DUPLI, BOOST, WOLF, ARTISAN, RETETHER, ANYWARD, LANDAURA, BEARAURA, KEEPER, PLAIN, OTHER, WARD, BEAR, SHADE, DINOS, TRINKET, HERO, VASE];

/** Answer every decision until the stack is empty; passes priority only while something is on the stack. */
function settle(s0: GameState, targets: TargetChoice[] = [], color = 'G'): GameState {
  let s = s0;
  for (let g = 0; g < 60; g++) {
    const p = s.pending;
    if (p === undefined || p === null) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color } as never);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const castOn = (s: GameState, name: string, target: ObjectId, player = 'p1', color = 'G'): GameState =>
  settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), [obj(target)], color);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name);
const inYard = (s: GameState, name: string, owner = 'p1'): boolean => s.zones.graveyard[owner]!.some((id) => s.defs[s.objects[id]!.defId]?.name === name);

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('the Auras with the rider are fully automated', () => {
    for (const d of [KEEPER, WARD, PLAIN]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.16c, 704.5m: "Enchanted creature has protection from black. This effect doesn\'t remove this Aura."', () => {
  it('a black Aura that gives protection from black stays attached to the creature it enchants, which has the protection', () => {
    const s0 = scenario([], { p1: { hand: ['Test Black Keeper'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = castOn(s0, 'Test Black Keeper', bear);
    const aura = onField(s, 'Test Black Keeper')[0]!;
    expect(s.objects[aura]!.attachedTo).toBe(bear);
    expect(getChars(s, bear)!.keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:B')).toBe(true);
  });
  it('negative: without the sentence the same Aura is put into its owner\'s graveyard as a state-based action (the protection removes it)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Black Plain'], battlefield: ['Test Bear'] }, defs: DEFS });
    const s = castOn(s0, 'Test Black Plain', find(s0, 'Test Bear', 'battlefield'));
    expect(onField(s, 'Test Black Plain')).toHaveLength(0);
    expect(inYard(s, 'Test Black Plain')).toBe(true);
  });
  it('the exception names only the granting Aura: another black Aura can\'t enchant that creature (no legal target, CR 702.16c, 601.2c)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Black Keeper', 'Test Black Other'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = castOn(s0, 'Test Black Keeper', bear);
    expect(() => castOn(s1, 'Test Black Other', bear)).toThrow(/no legal one/);
  });
  it('the protection still works against everything else: the creature is protected from a black source (it can\'t be targeted by it, CR 702.16b), only its own Aura is kept', () => {
    const s0 = scenario([], { p1: { hand: ['Test Black Keeper'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Shade'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = castOn(s0, 'Test Black Keeper', bear);
    expect(hasProtectionFrom(getChars(s, bear)!, getChars(s, find(s, 'Test Shade', 'battlefield'))!)).toBe(true);
    const keeper = onField(s, 'Test Black Keeper')[0]!;
    const shade = find(s, 'Test Shade', 'battlefield');
    // the attach check: its own Aura is kept, a black permanent that is not the granting Aura is not (CR 702.16c)
    expect(hasProtectionFrom(getChars(s, bear)!, getChars(s, keeper)!, {}, keeper)).toBe(false);
    expect(hasProtectionFrom(getChars(s, bear)!, getChars(s, shade)!, {}, shade)).toBe(true);
  });
  it('"the chosen color": the Aura chooses green, a green Aura of its own stays attached; a color other than its own is not touched', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chosen Ward'], battlefield: ['Test Shade'] }, defs: DEFS });
    const shade = find(s0, 'Test Shade', 'battlefield');
    const s = castOn(s0, 'Test Chosen Ward', shade, 'p1', 'G');
    const aura = onField(s, 'Test Chosen Ward')[0]!;
    expect(s.objects[aura]!.attachedTo).toBe(shade);
    expect(getChars(s, shade)!.keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:G')).toBe(true);
  });
});

describe('CR 614.1c, 205.1b, 613.4b: "As a historic permanent you control enters, it becomes a 7/7 Dinosaur creature in addition to its other types."', () => {
  const put = (s: GameState, name: string, player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }));
  it('an artifact you cast enters as a 7/7 Dinosaur artifact creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trinket'], battlefield: ['Test Displaced Dinos'] }, defs: DEFS });
    const s = put(s0, 'Test Trinket');
    const id = onField(s, 'Test Trinket')[0]!;
    const c = getChars(s, id)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toContain('Dinosaur');
    expect([c.power, c.toughness]).toEqual(['7', '7']);
  });
  it('a legendary creature enters as a 7/7 Dinosaur (its own 1/1 base is replaced, its other types stay)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hero'], battlefield: ['Test Displaced Dinos'] }, defs: DEFS });
    const s = put(s0, 'Test Hero');
    const c = getChars(s, onField(s, 'Test Hero')[0]!)!;
    expect([c.power, c.toughness]).toEqual(['7', '7']);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Human', 'Dinosaur']));
  });
  it('a token enters through the same replacement: a Treasure token of mine enters as a 7/7 Dinosaur artifact creature', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Displaced Dinos', 'Test Gold Maker'] }, defs: DEFS });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Gold Maker', 'battlefield') && !x.isMana);
    const s = settle(act(s0, a!.action));
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks).toHaveLength(1);
    const c = getChars(s, toks[0]!)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect([c.power, c.toughness]).toEqual(['7', '7']);
  });
  it('negative: a permanent that is not historic (a plain enchantment, a plain creature) is unchanged', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vase', 'Test Bear'], battlefield: ['Test Displaced Dinos'] }, defs: DEFS });
    const s = put(put(s0, 'Test Vase'), 'Test Bear');
    expect(getChars(s, onField(s, 'Test Vase')[0]!)!.types).not.toContain('Creature');
    expect(getChars(s, onField(s, 'Test Bear')[0]!)!.power).toBe('2');
  });
  it('negative: only permanents of the controller of the Dinosaurs: an artifact I cast while an opponent controls the Dinosaurs is unchanged', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trinket'] }, p2: { battlefield: ['Test Displaced Dinos'] }, defs: DEFS });
    const s = put(s0, 'Test Trinket');
    expect(getChars(s, onField(s, 'Test Trinket')[0]!)!.types).not.toContain('Creature');
  });
});

describe('CR 303.4f, 303.4g: "Return each Aura card from your graveyard to the battlefield. Only creatures can be enchanted this way."', () => {
  const resolve = (s0: GameState, pick?: (o: ObjectId[]) => ObjectId[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reattach', 'hand', 'p1') });
    for (let g = 0; g < 60; g++) {
      const p = s.pending;
      if (p === undefined || p === null) break;
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (pick ?? ((o) => o.slice(0, p.min)))(p.options) });
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  it('an Aura that could enchant any permanent enchants a creature, never the land that is also a legal host', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reattach'], graveyard: ['Test Any Aura'], battlefield: ['Plains', 'Test Bear'] }, defs: DEFS });
    const seen: ObjectId[][] = [];
    const s = resolve(s0, (o) => { seen.push([...o]); return [o[0]!]; });
    const aura = onField(s, 'Test Any Aura')[0]!;
    expect(aura).toBeDefined();
    expect(s.objects[aura]!.attachedTo).toBe(find(s, 'Test Bear', 'battlefield'));
    for (const offered of seen) expect(offered).not.toContain(find(s, 'Plains', 'battlefield'));
  });
  it('an Aura that can enchant only a land stays in the graveyard (CR 303.4g); an Aura for creatures is put onto the battlefield', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reattach'], graveyard: ['Test Land Aura', 'Test Bear Aura'], battlefield: ['Plains', 'Test Bear'] }, defs: DEFS });
    const s = resolve(s0);
    expect(onField(s, 'Test Land Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Land Aura')).toBe(true);
    expect(s.objects[onField(s, 'Test Bear Aura')[0]!]!.attachedTo).toBe(find(s, 'Test Bear', 'battlefield'));
  });
  it('an Aura that enchants a player (a Curse) has no creature to enchant: it stays in the graveyard and the creature Aura still returns, no hand resolution', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reattach'], graveyard: ['Test Curse', 'Test Bear Aura'], battlefield: ['Test Bear'] }, defs: DEFS });
    const s = resolve(s0);
    expect(s.pending?.kind).not.toBe('manualResolve');
    expect(inYard(s, 'Test Curse')).toBe(true);
    expect(onField(s, 'Test Curse')).toHaveLength(0);
    expect(s.objects[onField(s, 'Test Bear Aura')[0]!]!.attachedTo).toBe(find(s, 'Test Bear', 'battlefield'));
  });
  it('negative: with no creature on the battlefield the Auras stay in the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reattach'], graveyard: ['Test Any Aura', 'Test Bear Aura'], battlefield: ['Plains'] }, defs: DEFS });
    const s = resolve(s0);
    expect(onField(s, 'Test Any Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Any Aura')).toBe(true);
    expect(inYard(s, 'Test Bear Aura')).toBe(true);
  });
});

describe('CR 707.2, 111.2, 607.2c: "Create a token that\'s a copy of that creature except it\'s an artifact in addition to its other types. Then exile all other tokens created with ~."', () => {
  const tokensOf = (s: GameState, owner: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === owner);
  it('the card is fully automated', () => {
    expect(full(ARTISAN), JSON.stringify(ARTISAN.automation)).toBe(true);
  });
  it('the opponent casting a nontoken creature gives me an artifact token copy of it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'] }, p2: { battlefield: ['Test Artisan'] }, defs: DEFS });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }));
    const toks = tokensOf(s, 'p2');
    expect(toks).toHaveLength(1);
    const c = getChars(s, toks[0]!)!;
    expect(c.name).toBe('Test Bear');
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
  });
  it('the next copy exiles the earlier one: only the newest token created with the Artisan stays (the token just created is not "other")', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear', 'Test Wolf'] }, p2: { battlefield: ['Test Artisan'] }, defs: DEFS });
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }));
    expect(tokensOf(s1, 'p2')).toHaveLength(1);
    const s = settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Wolf', 'hand', 'p1') }));
    const toks = tokensOf(s, 'p2');
    expect(toks).toHaveLength(1);
    expect(getChars(s, toks[0]!)!.name).toBe('Test Wolf');
  });
  it('negative: its controller\'s own creature entering does not trigger it (an opponent controls the creature)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Artisan'] }, defs: DEFS });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }));
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
  it('ruling 2016-11-08: with two Artisans, each one only exiles the tokens created with its own ability', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear', 'Test Wolf'] }, p2: { battlefield: ['Test Artisan', 'Test Artisan'] }, defs: DEFS });
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }));
    expect(tokensOf(s1, 'p2').map((id) => getChars(s1, id)!.name)).toEqual(['Test Bear', 'Test Bear']);
    const s = settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Wolf', 'hand', 'p1') }));
    expect(tokensOf(s, 'p2').map((id) => getChars(s, id)!.name)).toEqual(['Test Wolf', 'Test Wolf']);
  });
});

describe('CR 115.9c, 707.2, 205.4a: "Whenever you cast a spell that targets only a single artifact or creature you control, create a token that\'s a copy of that artifact or creature, except it\'s not legendary."', () => {
  const cast = (s: GameState, name: string, target: ObjectId): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [obj(target)]);
  const tokensOf = (s: GameState, owner: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === owner);
  it('the card is fully automated', () => {
    expect(full(DUPLI), JSON.stringify(DUPLI.automation)).toBe(true);
  });
  it('a spell that targets only my legendary creature makes a token copy of that creature (not of the spell), which is not legendary', () => {
    const s0 = scenario([], { p1: { hand: ['Test Boost'], battlefield: ['Test Duplimancy', 'Test Hero'] }, defs: DEFS });
    const hero = find(s0, 'Test Hero', 'battlefield');
    const s = cast(s0, 'Test Boost', hero);
    const toks = tokensOf(s, 'p1');
    expect(toks).toHaveLength(1);
    const c = getChars(s, toks[0]!)!;
    expect(c.name).toBe('Test Hero');
    expect(c.supertypes).not.toContain('Legendary');
    expect(getChars(s, hero)!.supertypes).toContain('Legendary');
  });
  it('ruling 2022-09-09: the token is still made when the targeted creature is destroyed in response, copying it as it last existed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Boost'], battlefield: ['Test Duplimancy', 'Test Hero'] }, p2: { hand: ['Test Slay'] }, defs: DEFS });
    const hero = find(s0, 'Test Hero', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Boost', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(hero)] } as never);
    for (let g = 0; g < 10 && s.pending?.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
    s = pass(s); // p1 passes with the spell and the trigger on the stack; p2 may respond
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Slay', 'hand', 'p2') });
    s = settle(s, [obj(hero)]);
    expect(inYard(s, 'Test Hero')).toBe(true); // the original died
    const toks = tokensOf(s, 'p1');
    expect(toks).toHaveLength(1);
    expect(getChars(s, toks[0]!)!.name).toBe('Test Hero');
  });
  it('negative: a spell that targets a creature an opponent controls does not trigger it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Boost'], battlefield: ['Test Duplimancy'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const s = cast(s0, 'Test Boost', find(s0, 'Test Bear', 'battlefield'));
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
});

describe('CR 111.2, 707.2, 608.2d: "Create a token that\'s a copy of a nonlegendary enchantment you control."', () => {
  const run = (s0: GameState, pick: (o: ObjectId[]) => ObjectId[], offered: ObjectId[][]): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Cloner', 'battlefield'));
    let s = act(s0, a!.action);
    for (let g = 0; g < 40; g++) {
      const p = s.pending;
      if (p === undefined || p === null) break;
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') { offered.push([...p.options]); s = answer(s, { kind: 'chooseObjects', ids: pick(p.options) }); }
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  const tokensOf = (s: GameState, owner: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === owner);
  it('the card is fully automated', () => {
    expect(full(CLONER), JSON.stringify(CLONER.automation)).toBe(true);
  });
  it('the choice offers only my nonlegendary enchantments (not a legendary one, not an opponent\'s), and a token copy of the chosen one is made', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cloner', 'Test Shrine', 'Test Vase', 'Test Grand Shrine'] }, p2: { battlefield: ['Test Shrine'] }, defs: DEFS });
    const offered: ObjectId[][] = [];
    const vase = find(s0, 'Test Vase', 'battlefield');
    const s = run(s0, () => [vase], offered);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toHaveLength(2);
    expect(offered[0]).not.toContain(find(s0, 'Test Grand Shrine', 'battlefield'));
    const toks = tokensOf(s, 'p1');
    expect(toks).toHaveLength(1);
    expect(getChars(s, toks[0]!)!.name).toBe('Test Vase');
  });
  it('negative: with no nonlegendary enchantment of mine, no token is made', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cloner', 'Test Grand Shrine'] }, p2: { battlefield: ['Test Shrine'] }, defs: DEFS });
    const s = run(s0, (o) => o.slice(0, 1), []);
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
});

describe('CR 603.7, 111.2, 707.2: "Whenever you cast a noncreature spell this turn, create a token that\'s a copy of a non-Saga token you control."', () => {
  const tokensOf = (s: GameState, owner: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === owner);
  it('the card is fully automated', () => {
    expect(full(PULSE), JSON.stringify(PULSE.automation)).toBe(true);
  });
  it('after it resolves, casting a noncreature spell copies a token I control; casting a creature spell does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Pulse', 'Test Boost', 'Test Wolf'], battlefield: ['Test Soldier Maker', 'Test Bear'] }, defs: DEFS });
    const maker = find(s0, 'Test Soldier Maker', 'battlefield');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === maker);
    let s = settle(act(s0, a!.action));
    expect(tokensOf(s, 'p1')).toHaveLength(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pulse', 'hand', 'p1') }));
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wolf', 'hand', 'p1') }));
    expect(tokensOf(s, 'p1')).toHaveLength(1); // a creature spell: no copy
    s = castOn(s, 'Test Boost', find(s, 'Test Bear', 'battlefield'));
    expect(tokensOf(s, 'p1')).toHaveLength(2); // a noncreature spell: a copy of the Soldier token
    expect(tokensOf(s, 'p1').map((id) => getChars(s, id)!.name)).toEqual(['Soldier Token', 'Soldier Token']);
  });
});
