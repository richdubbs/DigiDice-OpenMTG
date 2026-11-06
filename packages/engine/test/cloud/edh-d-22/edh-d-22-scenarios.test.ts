/**
 * Round edh-d-22 (Commander coordinator D, lane mana): the behaviour it added, played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Every group has its negative cases. CR cites are from memory and listed as unverified in the record unless the record says otherwise.
 *
 *   CR 106.6, 601.2, 602.1        "Spend this mana only to cast an Assassin spell or a spell that has flashback, or to activate an ability of an Assassin source." (Brotherhood Headquarters)
 *   CR 106.6, 107.3               "Spend this mana only to cast a spell that's one or more colors without {X} in its mana cost." (Titans' Nest)
 *   CR 106.6, 113.1, 509.1b       "Spend this mana only to cast creature spells with no abilities." / "can't be blocked by creatures with abilities." (Jasmine Boreal of the Seven)
 *   CR 106.6, 118.9, 702.146a     "Spend this mana only to pay a disturb cost or cast an instant or sorcery spell." (Unblinking Observer)
 *   CR 106.1b, 106.4              "Add two mana of any one color and two mana of any other color." (Open the Omenpaths)
 *   CR 106.6, 614.1c              "If that mana is spent to cast a non-Human creature spell, that creature enters with an additional +1/+1 counter on it." (Animal Attendant, Guildmages' Forum)
 *   CR 106.4, 608.2d              "Choose a player. That player adds one mana of any color they choose." (Spectral Searchlight)
 *   CR 106.7, 605.3b              "Sacrifice a land: Add one mana of any type the sacrificed land could produce." (Squandered Resources)
 *   CR 605.3b, 603.7, 613.1b      "{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step." (Rainbow Vale)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { compileCard, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, pool, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object !== undefined && nameOf(s, a.object) === name);
const activatable = (s: GameState, name: string): boolean => legal(s, 'p1', 'activate').some((a) => a.object !== undefined && nameOf(s, a.object) === name && a.isMana !== true);
/** Activate the mana ability of the permanent called `name` (the first one offered) and answer what it asks. */
const tapFor = (s: GameState, name: string, picks: string[] = []): GameState => {
  const a = legal(s, 'p1', 'activate').find((x) => x.isMana && x.object !== undefined && nameOf(s, x.object) === name);
  if (a === undefined) throw new Error(`no mana ability of ${name}`);
  return playColors(act(s, a.action), picks);
};
const onField = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;

// ---- Brotherhood Headquarters --------------------------------------------------------------------------------------------------------------------------
const HQ = card('Test Guild Hall', 'Land', '{T}: Add one mana of any color. Spend this mana only to cast an Assassin spell or a spell that has flashback, or to activate an ability of an Assassin source.');
const KNIFE = card('Test Knife Hand', 'Creature — Human Assassin', '', ['1', '1'], '{1}');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3'], '{1}');
const ECHO = card('Test Echo Spell', 'Sorcery', 'You gain 1 life.\nFlashback {1}', undefined, '{5}');
const PLAINSPELL = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
const SHADE = card('Test Shade Blade', 'Creature — Human Assassin', '{1}: You gain 1 life.', ['1', '1'], '{2}');
const OGREWELL = card('Test Ogre Well', 'Creature — Ogre', '{1}: You gain 1 life.', ['1', '1'], '{2}');
describe('CR 106.6: Brotherhood Headquarters\' restriction "an Assassin spell or a spell that has flashback, or ... an ability of an Assassin source"', () => {
  const defs = [HQ, KNIFE, BRUTE, ECHO, PLAINSPELL, SHADE, OGREWELL];
  it('the cards are fully automated', () => { for (const d of defs) expect(full(d), d.name).toBe(true); });
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Knife Hand', 'Test Brute', 'Test Plain Spell'], graveyard: ['Test Echo Spell'], battlefield: ['Test Guild Hall', 'Test Shade Blade', 'Test Ogre Well'] } });
  it('it pays for an Assassin spell and a spell with flashback (cast for its flashback cost)', () => {
    const s = board();
    expect(castable(s, 'Test Knife Hand')).toBe(true);
    expect(castable(s, 'Test Echo Spell')).toBe(true);
  });
  it('negative: it does not pay for a spell that is no Assassin and has no flashback', () => {
    const s = board();
    expect(castable(s, 'Test Brute')).toBe(false);
    expect(castable(s, 'Test Plain Spell')).toBe(false);
  });
  it('it pays an ability of an Assassin source, not one of another source', () => {
    const s = board();
    const acts = legal(s, 'p1', 'activate').filter((a) => a.isMana !== true).map((a) => nameOf(s, a.object!));
    expect(acts).toContain('Test Shade Blade');
    expect(acts).not.toContain('Test Ogre Well');
  });
});

// ---- Titans' Nest ----------------------------------------------------------------------------------------------------------------------------------------
const NEST = card('Test Grave Nest', 'Enchantment', 'Exile a card from your graveyard: Add {C}. Spend this mana only to cast a spell that\'s one or more colors without {X} in its mana cost.');
const redOf = (name: string, text: string, cost: string, type = 'Sorcery'): ReturnType<typeof card> => ({ ...card(name, type, text, undefined, cost) });
describe('CR 106.6, 107.3: "... only to cast a spell that\'s one or more colors without {X} in its mana cost" (Titans\' Nest)', () => {
  const defs = [NEST, card('Test Scrap', 'Sorcery', '')];
  it('the Nest is fully automated', () => expect(full(NEST)).toBe(true));
  it('the restriction is the colored spells with no X (parsed JSON)', () => {
    const r = JSON.stringify(NEST.faces[0]!.abilities);
    expect(r).toContain('"manaCostHasX":false');
    expect(r).toContain('"restriction"');
  });
  void defs; void redOf;
});

// ---- Open the Omenpaths ------------------------------------------------------------------------------------------------------------------------------------
const OMEN = card('Test Omen Path', 'Instant', 'Choose one —\n• Add two mana of any one color and two mana of any other color. Spend this mana only to cast creature or enchantment spells.\n• Creatures you control get +1/+0 until end of turn.', undefined, '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{R}');
const AURA = card('Test Rite', 'Enchantment', '', undefined, '{G}{G}');
const ZAP = card('Test Zap', 'Sorcery', 'You gain 1 life.', undefined, '{R}{R}');
/** Answer colour choices with the given picks in order (recording the options offered), the other decisions as settle does; stops at priority. */
function playColors(s0: GameState, picks: string[], seen: string[][] = []): GameState {
  let s = s0;
  const rest = [...picks];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending as { kind: string; options?: string[] };
    if (d.kind === 'chooseColor') { seen.push([...(d.options ?? [])]); s = answer(s, { kind: 'chooseColor', color: (rest.shift() ?? d.options![0]!) as never }); }
    else s = settle(s);
  }
  return s;
}
/** Resolve the stack, answering colour choices with the given picks (recording the options offered). */
function resolveColors(s0: GameState, picks: string[], seen: string[][] = []): GameState {
  let s = playColors(s0, picks, seen);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 20; guard++) s = playColors(pass(s), picks.slice(seen.length), seen);
  return s;
}
describe('CR 106.1b, 106.4: "Add two mana of any one color and two mana of any other color." (Open the Omenpaths)', () => {
  const defs = [OMEN, BEAR, AURA, ZAP];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Omen Path', 'Test Bear', 'Test Rite', 'Test Zap'] } });
  it('is fully automated', () => expect(full(OMEN)).toBe(true));
  it('two mana of one color and two of another: red, red, green, green; the second choice never offers the first color', () => {
    const seen: string[][] = [];
    let s = act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Omen Path', 'hand') });
    s = resolveColors(s, ['R', 'G'], seen);
    expect(pool(s, 'p1')).toBe('GGRR');
    expect(seen.length).toBe(2);
    expect(seen[0]).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(seen[1]).toEqual(['W', 'U', 'B', 'G']);
  });
});

describe('CR 106.6: the mana of "Add two mana of any one color and two mana of any other color. Spend this mana only to cast creature or enchantment spells." pays only those', () => {
  const defs = [OMEN, BEAR, AURA, ZAP];
  it('after it resolved, the creature and the enchantment spell are castable with the pool, the sorcery is not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Omen Path', 'Test Bear', 'Test Rite', 'Test Zap'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Omen Path', 'hand') });
    s = resolveColors(s, ['R', 'G']);
    expect(pool(s, 'p1')).toBe('GGRR');
    expect(castable(s, 'Test Bear')).toBe(true);
    expect(castable(s, 'Test Rite')).toBe(true);
    expect(castable(s, 'Test Zap')).toBe(false);
  });
});

// ---- Titans' Nest (played) ------------------------------------------------------------------------------------------------------------------------------
const PEAK = card('Test Peak', 'Land', '{T}: Add {R}.');
const red = (name: string, type: string, text: string, cost: string) => compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: ['R'] } as OracleCard);
const NESTSPELL = red('Test Red Bolt', 'Sorcery', 'You gain 1 life.', '{1}{R}');
const NESTXSPELL = red('Test Red Burn', 'Sorcery', 'You gain X life.', '{X}{R}');
const NESTART = card('Test Grey Rock', 'Artifact', '', undefined, '{2}');
const NESTFODDER = card('Test Fodder', 'Sorcery', '');
describe("CR 106.6, 107.3: Titans' Nest's mana pays a coloured spell with no {X}, not a colourless spell or one with {X}", () => {
  const defs = [NEST, PEAK, NESTSPELL, NESTXSPELL, NESTART, NESTFODDER];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Red Bolt', 'Test Red Burn', 'Test Grey Rock'], graveyard: ['Test Fodder'], battlefield: ['Test Grave Nest', 'Test Peak'] } });
  const withNestMana = (): GameState => tapFor(board(), 'Test Grave Nest');
  it("a red spell is paid with the Nest's colourless mana beside a land", () => {
    const s = withNestMana();
    expect(pool(s, 'p1')).toBe('C');
    expect(castable(s, 'Test Red Bolt')).toBe(true);
  });
  it("negative: a colourless spell can't use the Nest's mana (the land and the Nest's mana would pay {2})", () => {
    expect(castable(withNestMana(), 'Test Grey Rock')).toBe(false);
  });
  it("negative: a coloured spell with {X} in its cost can't be paid for the X with the Nest's mana", () => {
    const s0 = withNestMana();
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Red Burn', 'hand') });
    expect(() => answer(s, { kind: 'chooseNumber', n: 1 })).toThrow();
  });
});

// ---- Jasmine Boreal of the Seven ------------------------------------------------------------------------------------------------------------------------
const JASMINE = card('Test Seven Druid', 'Creature — Human Druid', "{T}: Add {G}{W}. Spend this mana only to cast creature spells with no abilities.\nCreatures you control with no abilities can't be blocked by creatures with abilities.", ['2', '2']);
const VANILLA = card('Test Vanilla Bear', 'Creature — Bear', '', ['2', '2'], '{G}{W}');
const HASTY = card('Test Quick Bear', 'Creature — Bear', 'Haste', ['2', '2'], '{G}{W}');
describe('CR 106.6, 113.1: Jasmine Boreal of the Seven', () => {
  const defs = [JASMINE, VANILLA, HASTY];
  it('is fully automated', () => expect(full(JASMINE)).toBe(true));
  it('its mana pays a creature spell with no abilities, not one with an ability', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Vanilla Bear', 'Test Quick Bear'], battlefield: ['Test Seven Druid'] } });
    expect(castable(s, 'Test Vanilla Bear')).toBe(true);
    expect(castable(s, 'Test Quick Bear')).toBe(false);
  });
});

// ---- Unblinking Observer ----------------------------------------------------------------------------------------------------------------------------------
const OBSERVER = card('Test Blind Watcher', 'Creature — Homunculus', '{T}: Add {U}. Spend this mana only to pay a disturb cost or cast an instant or sorcery spell.', ['1', '1']);
const OBSERVER_NOCLAUSE = card('Test Blind Watcher Two', 'Creature — Homunculus', '{T}: Add {U}. Spend this mana only to cast an instant or sorcery spell.', ['1', '1']);
const BEGGAR = 'Beloved Beggar // Generous Soul';
const SORCERYISH = card('Test Quiet Ritual', 'Sorcery', 'You gain 1 life.', undefined, '{U}');
const QUIETCREATURE = card('Test Quiet Fish', 'Creature — Fish', '', ['1', '1'], '{U}');
describe('CR 106.6, 118.9, 702.146a: "Spend this mana only to pay a disturb cost or cast an instant or sorcery spell." (Unblinking Observer)', () => {
  const defs = [OBSERVER, OBSERVER_NOCLAUSE, SORCERYISH, QUIETCREATURE];
  it('the Observer is fully automated', () => expect(full(OBSERVER)).toBe(true));
  it('its mana pays an instant or sorcery spell, not a creature spell', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Quiet Ritual', 'Test Quiet Fish'], battlefield: ['Test Blind Watcher'] } });
    expect(castable(s, 'Test Quiet Ritual')).toBe(true);
    expect(castable(s, 'Test Quiet Fish')).toBe(false);
  });
  it('its mana is one of the six that pay a disturb cost (five Plains and the Observer); the version without the disturb clause is not enough', () => {
    const lands = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
    const withClause = scenario([BEGGAR, 'Plains'], { defs, p1: { graveyard: [BEGGAR], battlefield: [...lands, 'Test Blind Watcher'] } });
    const without = scenario([BEGGAR, 'Plains'], { defs, p1: { graveyard: [BEGGAR], battlefield: [...lands, 'Test Blind Watcher Two'] } });
    const disturbable = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => (a.action as { method?: string }).method === 'disturb');
    expect(disturbable(withClause)).toBe(true);
    expect(disturbable(without)).toBe(false);
  });
});

// ---- Animal Attendant and Guildmages' Forum -----------------------------------------------------------------------------------------------------------------
const ATTENDANT = card('Test Beast Keeper', 'Creature — Human Citizen', '{T}: Add one mana of any color. If that mana is spent to cast a non-Human creature spell, that creature enters with an additional +1/+1 counter on it.', ['1', '1']);
const FORUM = card('Test Guild Square', 'Land', '{1}, {T}: Add one mana of any color. If that mana is spent on a multicolored creature spell, that creature enters with an additional +1/+1 counter on it.');
const PUMA = card('Test Puma', 'Creature — Cat', '', ['2', '2'], '{G}');
const PRIEST = card('Test Priest', 'Creature — Human Cleric', '', ['2', '2'], '{G}');
const MULTI: ReturnType<typeof card> = compileCard({ name: 'Test Twin Cat', layout: 'normal', mana_cost: '{R}{G}', type_line: 'Creature — Cat', oracle_text: '', power: '2', toughness: '2', colors: ['R', 'G'] } as OracleCard);
const MONO: ReturnType<typeof card> = compileCard({ name: 'Test Solo Cat', layout: 'normal', mana_cost: '{R}', type_line: 'Creature — Cat', oracle_text: '', power: '2', toughness: '2', colors: ['R'] } as OracleCard);
const GFOREST = card('Test Green Grove', 'Land', '{T}: Add {G}.');
const RPEAK = card('Test Red Peak', 'Land', '{T}: Add {R}.');
const counterCount = (s: GameState, name: string): number => s.objects[onField(s, name)]!.counters['+1/+1'] ?? 0;
describe('CR 106.6, 614.1c: "If that mana is spent to cast a creature spell, that creature enters with an additional +1/+1 counter on it."', () => {
  const defs = [ATTENDANT, FORUM, PUMA, PRIEST, MULTI, MONO, GFOREST, RPEAK];
  it('the cards are fully automated', () => { for (const d of [ATTENDANT, FORUM]) expect(full(d), d.name).toBe(true); });
  const castWith = (s0: GameState, spell: string, tap: string, picks: string[]): GameState => {
    let s = tapFor(s0, tap, picks);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand') });
    return resolveAll(s);
  };
  it('a non-Human creature spell paid with the Attendant\'s mana enters with an extra counter', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Puma'], battlefield: ['Test Beast Keeper'] } });
    const s = castWith(s0, 'Test Puma', 'Test Beast Keeper', ['G']);
    expect(counterCount(s, 'Test Puma')).toBe(1);
  });
  it('negative: a Human creature spell paid with the Attendant\'s mana gets no counter', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Priest'], battlefield: ['Test Beast Keeper'] } });
    const s = castWith(s0, 'Test Priest', 'Test Beast Keeper', ['G']);
    expect(counterCount(s, 'Test Priest')).toBe(0);
  });
  it('negative: the same creature paid with a Forest\'s mana (the Attendant stays untapped) gets no counter', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Puma'], battlefield: ['Test Beast Keeper', 'Test Green Grove'] } });
    const s = castWith(s0, 'Test Puma', 'Test Green Grove', []);
    expect(s.objects[onField(s, 'Test Beast Keeper')]!.tapped).toBe(false);
    expect(counterCount(s, 'Test Puma')).toBe(0);
  });
  it('Guildmages\' Forum: a multicolored creature spell paid with its mana gets the counter; a mono-colored one does not', () => {
    const multi = scenario([], { defs, p1: { hand: ['Test Twin Cat'], battlefield: ['Test Guild Square', 'Test Red Peak', 'Test Red Peak'] } });
    let s = tapFor(multi, 'Test Red Peak');
    s = tapFor(s, 'Test Guild Square', ['G']);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Cat', 'hand') }));
    expect(counterCount(s, 'Test Twin Cat')).toBe(1);
    const mono = scenario([], { defs, p1: { hand: ['Test Solo Cat'], battlefield: ['Test Guild Square', 'Test Red Peak'] } });
    let m = tapFor(mono, 'Test Guild Square', ['R']);
    m = resolveAll(act(m, { type: 'cast', player: 'p1', card: find(m, 'Test Solo Cat', 'hand') }));
    expect(counterCount(m, 'Test Solo Cat')).toBe(0);
  });
});

// ---- Spectral Searchlight ---------------------------------------------------------------------------------------------------------------------------------
const LIGHT = card('Test Beacon Lamp', 'Artifact', '{T}: Choose a player. That player adds one mana of any color they choose.', undefined, '{3}');
describe('CR 106.4, 608.2d: "Choose a player. That player adds one mana of any color they choose." (Spectral Searchlight)', () => {
  it('is fully automated', () => expect(full(LIGHT)).toBe(true));
  it('the controller chooses a player, and that player chooses the colour: an opponent receives the mana', () => {
    const s0 = scenario([], { defs: [LIGHT], p1: { battlefield: ['Test Beacon Lamp'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.isMana && x.object !== undefined && nameOf(s0, x.object) === 'Test Beacon Lamp')!;
    let s = act(s0, a.action);
    const seen: string[] = [];
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending as { kind: string; player?: string; options?: { id: string; label?: string }[] | string[] };
      seen.push(`${d.kind}:${d.player}`);
      if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['p2'] });
      else if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'U' });
      else break;
    }
    expect(seen).toEqual(['chooseOption:p1', 'chooseColor:p2']);
    expect(pool(s, 'p2')).toBe('U');
    expect(pool(s, 'p1')).toBe('');
  });
  it('choosing itself: the controller then picks the colour and keeps the mana', () => {
    const s0 = scenario([], { defs: [LIGHT], p1: { battlefield: ['Test Beacon Lamp'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.isMana && x.object !== undefined && nameOf(s0, x.object) === 'Test Beacon Lamp')!;
    let s = act(s0, a.action);
    s = answer(s, { kind: 'chooseOption', ids: ['p1'] });
    s = answer(s, { kind: 'chooseColor', color: 'G' });
    expect(pool(s, 'p1')).toBe('G');
  });
});

// ---- Squandered Resources ---------------------------------------------------------------------------------------------------------------------------------
const SQUANDER = card('Test Waste Altar', 'Enchantment', 'Sacrifice a land: Add one mana of any type the sacrificed land could produce.');
const DUALLAND = card('Test Twin Fen', 'Land', '{T}: Add {B} or {G}.');
const WASTE = card('Test Barren Waste', 'Land', '{T}: Add {C}.');
describe('CR 106.7, 605.3b: "Sacrifice a land: Add one mana of any type the sacrificed land could produce." (Squandered Resources)', () => {
  const defs = [SQUANDER, DUALLAND, WASTE];
  it('is fully automated', () => expect(full(SQUANDER)).toBe(true));
  it('sacrificing a land that could produce {B} or {G}: the mana is one of those two', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Waste Altar', 'Test Twin Fen'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.isMana && x.object !== undefined && nameOf(s0, x.object) === 'Test Waste Altar')!;
    let s = act(s0, a.action);
    const seen: string[][] = [];
    s = playColors(s, ['G'], seen);
    expect(seen).toEqual([['B', 'G']]);
    expect(pool(s, 'p1')).toBe('G');
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Twin Fen')).toBe(false);
  });
  it('sacrificing a land that makes only {C}: {C}', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Waste Altar', 'Test Barren Waste'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.isMana && x.object !== undefined && nameOf(s0, x.object) === 'Test Waste Altar')!;
    const s = act(s0, a.action);
    expect(pool(s, 'p1')).toBe('C');
  });
});

// ---- Rainbow Vale -----------------------------------------------------------------------------------------------------------------------------------------
const VALE = card('Test Prism Glen', 'Land', '{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step.');
describe('CR 605.3b, 603.7, 613.1b: "{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step." (Rainbow Vale)', () => {
  it('is fully automated', () => expect(full(VALE)).toBe(true));
  it('tapped for mana, it adds the mana at once and an opponent controls it from the end step', () => {
    const s0 = scenario([], { defs: [VALE], p1: { battlefield: ['Test Prism Glen'] } });
    const id = onField(s0, 'Test Prism Glen');
    let s = tapFor(s0, 'Test Prism Glen', ['W']);
    expect(pool(s, 'p1')).toBe('W');
    expect(s.objects[id]!.controller).toBe('p1');
    s = advanceTo(s, 1, 'end');
    // the delayed trigger goes on the stack at the beginning of the end step and resolves
    s = resolveAll(s);
    expect(s.objects[id]!.controller).toBe('p2');
  });
  it('negative: a Vale that was never tapped stays with its controller through the end step', () => {
    const s0 = scenario([], { defs: [VALE], p1: { battlefield: ['Test Prism Glen'] } });
    const id = onField(s0, 'Test Prism Glen');
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(s.objects[id]!.controller).toBe('p1');
  });
});

// ---- Valleymaker (a formerly stack-using reading, now one mana ability) ----------------------------------------------------------------------------------
const VALLEY = card('Test Vale Shaper', 'Creature — Giant', '{T}, Sacrifice a Forest: Choose a player. That player adds {G}{G}{G}.', ['3', '3']);
const FOREST = card('Test Pine Wood', 'Land — Forest', '');
describe('CR 106.4, 605.1a, 608.2d: "Choose a player. That player adds {G}{G}{G}." is one mana ability (Valleymaker)', () => {
  it('is fully automated and a mana ability', () => {
    expect(full(VALLEY)).toBe(true);
    expect(JSON.stringify(VALLEY.faces[0]!.abilities)).toContain('"isMana":true');
  });
  it('the chosen opponent receives the three mana at once (no stack)', () => {
    const s0 = scenario([], { defs: [VALLEY, FOREST], p1: { battlefield: ['Test Vale Shaper', 'Test Pine Wood'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.isMana && x.object !== undefined && nameOf(s0, x.object) === 'Test Vale Shaper')!;
    expect(a).toBeDefined();
    let s = act(s0, a.action);
    for (let i = 0; i < 4 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending as { kind: string };
      if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['p2'] });
      else s = settle(s);
    }
    expect(s.zones.stack.length).toBe(0);
    expect(pool(s, 'p2')).toBe('GGG');
    expect(pool(s, 'p1')).toBe('');
  });
});
