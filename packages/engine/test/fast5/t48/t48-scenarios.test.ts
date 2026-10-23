/**
 * FAST5 T48 (T-MANA2): the shapes of parser/templates/zz-fast5/t48.json (mana-spend restrictions, four mana in any combination of colors, the Heartwood token,
 * "Add X {G} or X {W}", "for each color among permanents you control, add one mana of that color", "one mana of any of the exiled cards' colors") played through
 * applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 106.6, 601.2h, 602.2b   a spending restriction: the mana pays only for the spells and abilities it names (spell types, subtypes, sources, "the chosen type")
 *   CR 111.10x, 614.1c         the Heartwood token: a red and green Heartwood artifact with "{T}: Add {R} or {G}.", created untapped or tapped
 *   CR 106.1b, 106.4, 107.3    "X {G} or X {W}": one choice of the two types, X of it (also planned by the payment solver)
 *   CR 105.1, 105.4, 106.4     one mana of each color some permanent you control has
 *   CR 106.5, 607.2a           one mana of a color the cards an enters ability exiled have
 *   CR 613.1f                  "Each land and Ally you control has "{T}: Add one mana of any color.""
 */
import { describe, expect, it } from 'vitest';
import { compileCard, charsOfObject, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, labels, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const poolOf = (s: GameState, p = 'p1'): string => s.players.find((x) => x.id === p)!.manaPool.map((u) => u.type).sort().join('');

/** Pay the spell on the stack with whatever the automatic payer chooses and resolve everything on the way until the stack is empty. */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40; guard++) {
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}

describe('CR 106.6, 601.2h, 205.3: "Spend this mana only to cast a Ninja or Turtle spell"', () => {
  const DOJO = card('Test Dojo', 'Land', '{T}: Add one mana of any color. Spend this mana only to cast a Ninja or Turtle spell.');
  const ninja = card('Test Ninja', 'Creature — Human Ninja', '', '{1}{R}', ['2', '1']);
  const turtle = card('Test Turtle', 'Creature — Turtle', '', '{1}{G}', ['1', '3']);
  const goblin = card('Test Goblin', 'Creature — Goblin', '', '{1}{R}', ['2', '1']);
  const rite = card('Test Rite', 'Sorcery', '', '{1}{R}');
  it('the land is automated', () => expect(manualParts(DOJO)).toEqual([]));
  it('two such lands pay for a Ninja spell and a Turtle spell, not for a Goblin spell or a sorcery', () => {
    const s = scenario([], { p1: { hand: ['Test Ninja', 'Test Turtle', 'Test Goblin', 'Test Rite'], battlefield: ['Test Dojo', 'Test Dojo'] }, defs: [DOJO, ninja, turtle, goblin, rite] });
    const l = labels(s, 'p1');
    expect(l).toContain('Cast Test Ninja');
    expect(l).toContain('Cast Test Turtle');
    expect(l).not.toContain('Cast Test Goblin');
    expect(l).not.toContain('Cast Test Rite');
  });
});

describe('CR 106.6, 205.3: "Spend this mana only to cast Wizard or Cleric spells"', () => {
  const ACOLYTE = card('Test Acolyte', 'Creature — Human Druid', '{T}: Add two mana of any one color. Spend this mana only to cast Wizard or Cleric spells.', '{1}', ['1', '1']);
  const wizard = card('Test Wizard', 'Creature — Human Wizard', '', '{1}{U}', ['1', '1']);
  const cleric = card('Test Cleric', 'Creature — Human Cleric', '', '{1}{W}', ['1', '1']);
  const bear = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  it('is automated; the two mana pay for either subtype and for no other spell', () => {
    expect(manualParts(ACOLYTE)).toEqual([]);
    const s = scenario([], { p1: { hand: ['Test Wizard', 'Test Cleric', 'Test Bear'], battlefield: ['Test Acolyte'] }, defs: [ACOLYTE, wizard, cleric, bear] });
    const l = labels(s, 'p1');
    expect(l).toContain('Cast Test Wizard');
    expect(l).toContain('Cast Test Cleric');
    expect(l).not.toContain('Cast Test Bear');
  });
});

describe('CR 106.6, 601.2h, 602.2b: "cast an artifact spell or activate an ability of an artifact source"', () => {
  const SIREN = card('Test Siren', 'Artifact Creature — Siren', '{T}: Add {U}. Spend this mana only to cast an artifact spell or activate an ability of an artifact source.', '{1}', ['1', '1']);
  const trinket = card('Test Trinket', 'Artifact', '', '{U}');
  const cantrip = card('Test Cantrip', 'Instant', '', '{U}');
  const gadget = card('Test Gadget', 'Artifact', '{U}: You gain 1 life.');
  const totem = card('Test Totem', 'Enchantment', '{U}: You gain 1 life.');
  it('is automated', () => expect(manualParts(SIREN)).toEqual([]));
  it('the mana pays an artifact spell, not another spell', () => {
    const s = scenario([], { p1: { hand: ['Test Trinket', 'Test Cantrip'], battlefield: ['Test Siren'] }, defs: [SIREN, trinket, cantrip] });
    expect(labels(s, 'p1')).toContain('Cast Test Trinket');
    expect(labels(s, 'p1')).not.toContain('Cast Test Cantrip');
  });
  it('the mana pays an artifact\'s activated ability, not an enchantment\'s', () => {
    const s = scenario([], { p1: { battlefield: ['Test Siren', 'Test Gadget', 'Test Totem'] }, defs: [SIREN, gadget, totem] });
    const doable = legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.object);
    expect(doable).toEqual([find(s, 'Test Gadget', 'battlefield')]);
  });
});

describe('CR 106.6, 602.2b: "Spend this mana only to activate abilities" and "cast an artifact spell or activate an ability"', () => {
  const FORGE = card('Test Forge', 'Land', '{T}: Add {C}{C}. Spend this mana only to activate abilities.');
  const OPTIMIZER = card('Test Optimizer', 'Artifact Creature — Robot', '{T}: Add {U}. Spend this mana only to cast an artifact spell or activate an ability.', '{1}', ['1', '1']);
  const gadget = card('Test Gadget', 'Artifact', '{1}{1}: You gain 1 life.');
  const totem = card('Test Totem', 'Enchantment', '{U}: You gain 1 life.');
  const trinket = card('Test Trinket', 'Artifact', '', '{U}');
  const cantrip = card('Test Cantrip', 'Instant', '', '{U}');
  it('the forge pays an ability of any source (its cost is {2}) and no spell', () => {
    expect(manualParts(FORGE)).toEqual([]);
    const s = scenario([], { p1: { hand: ['Test Cantrip'], battlefield: ['Test Forge', 'Test Gadget'] }, defs: [FORGE, gadget, cantrip] });
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.object)).toEqual([find(s, 'Test Gadget', 'battlefield')]);
    expect(labels(s, 'p1')).not.toContain('Cast Test Cantrip');
  });
  it('the optimizer pays an artifact spell and any ability, not an instant', () => {
    expect(manualParts(OPTIMIZER)).toEqual([]);
    const s = scenario([], { p1: { hand: ['Test Trinket', 'Test Cantrip'], battlefield: ['Test Optimizer', 'Test Totem'] }, defs: [OPTIMIZER, trinket, cantrip, totem] });
    expect(labels(s, 'p1')).toContain('Cast Test Trinket');
    expect(labels(s, 'p1')).not.toContain('Cast Test Cantrip');
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.object)).toEqual([find(s, 'Test Totem', 'battlefield')]);
  });
});

describe('CR 106.6, 607.2d: "cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type"', () => {
  const COURT = card('Test Courtyard', 'Land', 'As ~ enters, choose a creature type.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.');
  const wizard = card('Test Wizard', 'Creature — Human Wizard', '', '{U}', ['1', '1']);
  const bear = card('Test Bear', 'Creature — Bear', '', '{U}', ['2', '2']);
  const rite = card('Test Rite', 'Sorcery', '', '{U}');
  const WIZ = card('Test Wizard Source', 'Creature — Human Wizard', '{U}: You gain 1 life.', '{0}', ['1', '1']);
  const BEAR = card('Test Bear Source', 'Creature — Bear', '{U}: You gain 1 life.', '{0}', ['1', '1']);
  it('is automated, and with Wizard chosen pays a Wizard creature spell and a Wizard\'s ability only', () => {
    expect(manualParts(COURT)).toEqual([]);
    const s = scenario([], { p1: { hand: ['Test Wizard', 'Test Bear', 'Test Rite'], battlefield: ['Test Courtyard', 'Test Wizard Source', 'Test Bear Source'] }, defs: [COURT, wizard, bear, rite, WIZ, BEAR] });
    s.objects[find(s, 'Test Courtyard', 'battlefield')]!.links = { type: { values: ['Wizard'] } };
    const l = labels(s, 'p1');
    expect(l).toContain('Cast Test Wizard');
    expect(l).not.toContain('Cast Test Bear');
    expect(l).not.toContain('Cast Test Rite');
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.object)).toEqual([find(s, 'Test Wizard Source', 'battlefield')]);
  });
});

describe('CR 106.6: "Spend this mana only to cast instant and sorcery spells"', () => {
  const TABLET = card('Test Tablet', 'Artifact', '{T}: Add {R}{R}. Spend this mana only to cast instant and sorcery spells.');
  const bolt = card('Test Bolt', 'Instant', '', '{R}{R}');
  const rite = card('Test Rite', 'Sorcery', '', '{R}{R}');
  const ogre = card('Test Ogre', 'Creature — Ogre', '', '{R}{R}', ['3', '3']);
  it('pays an instant and a sorcery, not a creature', () => {
    expect(manualParts(TABLET)).toEqual([]);
    const s = scenario([], { p1: { hand: ['Test Bolt', 'Test Rite', 'Test Ogre'], battlefield: ['Test Tablet'] }, defs: [TABLET, bolt, rite, ogre] });
    const l = labels(s, 'p1');
    expect(l).toContain('Cast Test Bolt');
    expect(l).toContain('Cast Test Rite');
    expect(l).not.toContain('Cast Test Ogre');
  });
});

describe('CR 106.1, 106.4: "Add four mana in any combination of colors"', () => {
  const BUILDING = card('Test Tower', 'Land', '{1}, {T}: Add four mana in any combination of colors.');
  it('is automated; four mana of the colors the player names come into the pool', () => {
    expect(manualParts(BUILDING)).toEqual([]);
    const s0 = scenario(['Forest'], { p1: { battlefield: ['Test Tower', 'Forest'] }, defs: [BUILDING] });
    const tower = find(s0, 'Test Tower', 'battlefield');
    let s = act(s0, { type: 'activate', player: 'p1', source: tower, ability: 'p:0:0' });
    for (let i = 0; i < 12 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (['W', 'U', 'B', 'R'] as const)[i % 4]! });
      else break;
    }
    expect(poolOf(s).length).toBe(4);
  });
});

describe('CR 111.10x, 614.1c, 605.1a: the Heartwood token', () => {
  const MAKE = card('Test Weaving', 'Sorcery', 'Create a Heartwood token.');
  const MAKE2 = card('Test Weaving Two', 'Sorcery', 'Create two tapped Heartwood tokens.');
  const tokens = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('both spells are automated', () => {
    expect(manualParts(MAKE)).toEqual([]);
    expect(manualParts(MAKE2)).toEqual([]);
  });
  it('the token is a red and green Heartwood artifact that taps for {R} or {G}', () => {
    const s0 = scenario([], { p1: { hand: ['Test Weaving'] }, defs: [MAKE] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Weaving', 'hand', 'p1') });
    s = settle(s);
    const ids = tokens(s);
    expect(ids).toHaveLength(1);
    const o = s.objects[ids[0]!]!;
    const def = s.defs[o.defId]!;
    expect(def.name).toBe('Heartwood Token'); // CR 111.4: its subtype plus "Token"
    const c = charsOfObject(s, o);
    expect([...c.colors].sort()).toEqual(['G', 'R']);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Heartwood']);
    expect(o.tapped).toBe(false);
    const mana = legal(s, 'p1', 'activate').filter((a) => a.object === ids[0]);
    expect(mana).toHaveLength(1);
    const t = act(s, { type: 'activate', player: 'p1', source: ids[0]!, ability: 'p:0:0' });
    expect(t.pending).toMatchObject({ kind: 'chooseColor', options: ['R', 'G'] });
    expect(poolOf(answer(t, { kind: 'chooseColor', color: 'G' }))).toBe('G');
  });
  it('"two tapped Heartwood tokens" are two tapped tokens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Weaving Two'] }, defs: [MAKE2] });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Weaving Two', 'hand', 'p1') }));
    const ids = tokens(s);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => s.objects[id]!.tapped && s.defs[s.objects[id]!.defId]!.name === 'Heartwood Token')).toBe(true);
  });
});

describe('CR 106.1b, 106.4, 107.3: "Add X {G} or X {W}, where X is the number of other creatures you control"', () => {
  const PAIR = card('Test Pair', 'Creature — Kithkin', '{T}: Add X {G} or X {W}, where X is the number of other creatures you control.', '{1}', ['1', '1']);
  const twin = card('Test Twin Spell', 'Sorcery', '', '{G}{G}');
  const BEAR = 'Grizzly Bears';
  it('is automated and the payment solver plans it: with two other creatures it pays {G}{G}, with one it cannot', () => {
    expect(manualParts(PAIR)).toEqual([]);
    const two = scenario([BEAR], { p1: { hand: ['Test Twin Spell'], battlefield: ['Test Pair', BEAR, BEAR] }, defs: [PAIR, twin] });
    expect(labels(two, 'p1')).toContain('Cast Test Twin Spell');
    const one = scenario([BEAR], { p1: { hand: ['Test Twin Spell'], battlefield: ['Test Pair', BEAR] }, defs: [PAIR, twin] });
    expect(labels(one, 'p1')).not.toContain('Cast Test Twin Spell');
  });
  it('activated by hand it asks for the one type ({G} or {W}) and adds X of it', () => {
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Pair', BEAR, BEAR, BEAR] }, defs: [PAIR] });
    const t = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Pair', 'battlefield'), ability: 'p:0:0' });
    expect(t.pending).toMatchObject({ kind: 'chooseColor', options: ['G', 'W'] });
    expect(poolOf(answer(t, { kind: 'chooseColor', color: 'W' }))).toBe('WWW');
  });
});

describe('CR 105.1, 105.4, 106.4: "For each color among permanents you control, add one mana of that color"', () => {
  const TENDER = card('Test Tender', 'Creature — Elf Druid', '{T}: For each color among permanents you control, add one mana of that color.', '{1}{G}', ['1', '1']);
  it('is automated; a mono-colored and a two-colored permanent give one mana of each of their colors, a colorless one none, an opponent\'s none', () => {
    expect(manualParts(TENDER)).toEqual([]);
    const s0 = scenario(['Grizzly Bears', 'Boros Swiftblade', 'Sol Ring', "Galina's Knight"], {
      p1: { battlefield: [{ name: 'Test Tender', since: 0 }, 'Grizzly Bears', 'Boros Swiftblade', 'Sol Ring'] }, p2: { battlefield: ["Galina's Knight"] }, defs: [TENDER],
    });
    const tender = find(s0, 'Test Tender', 'battlefield');
    // the Tender itself is colorless here (a synthetic card with no color); the rest: green, red and white
    expect(poolOf(act(s0, { type: 'activate', player: 'p1', source: tender, ability: 'p:0:0' }))).toBe('GRW');
  });
  it('with no colored permanent it adds nothing (colorless is not a color)', () => {
    const s0 = scenario(['Sol Ring'], { p1: { battlefield: ['Test Tender', 'Sol Ring'] }, defs: [TENDER] });
    expect(poolOf(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Tender', 'battlefield'), ability: 'p:0:0' }))).toBe('');
  });
});

describe("CR 106.5, 607.2a: \"Add one mana of any of the exiled cards' colors\"", () => {
  const PIT = card('Test Pit', 'Land — Cave', "When ~ enters, exile up to three target cards from graveyards.\n{T}: Add one mana of any of the exiled cards' colors.");
  /** Play the land with the given cards of the opponent's graveyard as the targets of its enters ability, resolve it, untap the land and tap it for mana. */
  function tapPit(exile: string[], answers: ('R' | 'G' | 'U')[] = []): { s: GameState; asked: unknown } {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears', 'Sol Ring'], { p1: { hand: ['Test Pit'] }, p2: { graveyard: ['Hill Giant', 'Grizzly Bears', 'Sol Ring'] }, defs: [PIT] });
    let s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Pit', 'hand', 'p1') });
    for (let i = 0; i < 12 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: exile.map((n) => ({ kind: 'object', id: find(s, n, 'graveyard', 'p2') })) } as never);
      else if (s.pending?.kind === 'priority') s = pass(s);
      else break;
    }
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual([...exile].sort());
    const pit = find(s, 'Test Pit', 'battlefield');
    s.objects[pit]!.tapped = false;
    let t = act(s, { type: 'activate', player: 'p1', source: pit, ability: 'p:0:1' });
    const asked = t.pending?.kind === 'chooseColor' ? (t.pending as { options: string[] }).options : null;
    for (const c of answers) if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color: c });
    return { s: t, asked };
  }
  it('is automated', () => expect(manualParts(PIT)).toEqual([]));
  it('one exiled color gives that color with no question; a colorless card gives none', () => {
    const one = tapPit(['Hill Giant', 'Sol Ring']);
    expect(one.asked).toBeNull();
    expect(poolOf(one.s)).toBe('R');
    expect(poolOf(tapPit(['Sol Ring']).s)).toBe(''); // CR 106.5: no color, no mana
  });
  it('two exiled colors: the player picks one of exactly those two', () => {
    const two = tapPit(['Hill Giant', 'Grizzly Bears', 'Sol Ring'], ['G']);
    expect(two.asked).toEqual(['R', 'G']);
    expect(poolOf(two.s)).toBe('G');
  });
});

describe('CR 613.1f, 604.1: "Each land and Ally you control has "{T}: Add one mana of any color.""', () => {
  const GUIDE = card('Test Guide', 'Creature — Human Scout Ally', 'Each land and Ally you control has "{T}: Add one mana of any color."', '{1}{G}', ['1', '1']);
  const spell = card('Test Pairing', 'Sorcery', '', '{W}{U}');
  it('is automated; the lands and the Ally (itself) make mana of any color', () => {
    expect(manualParts(GUIDE)).toEqual([]);
    const without = scenario(['Island'], { p1: { hand: ['Test Pairing'], battlefield: ['Island'] }, defs: [spell] });
    expect(labels(without, 'p1')).not.toContain('Cast Test Pairing');
    const withGuide = scenario(['Island'], { p1: { hand: ['Test Pairing'], battlefield: ['Island', 'Test Guide'] }, defs: [GUIDE, spell] });
    expect(labels(withGuide, 'p1')).toContain('Cast Test Pairing');
  });
});
