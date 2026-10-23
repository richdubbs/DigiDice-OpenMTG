/**
 * Lane p2-copy-perm, round p2-copy-perm-1, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10): the copy exceptions read by parser/holes/p2copyperm1.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 707.9b, 205.1b   "except it's an enchantment in addition to its other types": the copy keeps the copied types and adds the new one
 *   CR 707.9b, 205.4a   "its name is ~, it's legendary in addition to its other types, and it has flying": its own name, a supertype added, a keyword
 *   CR 707.9b, 613.4b   "except they're 1/1 and they aren't legendary": several token copies, each a 1/1 that is not legendary (no legend rule, CR 704.5j)
 *   CR 707.9b, 105.3    "except it's a 4/4 black Zombie in addition to its other colors and types": a color added, not set
 *   CR 707.9a, 611.2a   "you may have ~ become a copy of it until end of turn, except its name is ~ and it has this ability"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const KING = card('Test King', 'Legendary Creature — Human Noble', 'Vigilance', { pt: ['3', '3'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const GROVE = card('Test Grove', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });

const MIMIC = card('Test Mimic', 'Enchantment', 'You may have this enchantment enter as a copy of any artifact on the battlefield, except it\'s an enchantment in addition to its other types.');
const IMPOSTOR = card('Test Impostor', 'Legendary Creature — Shapeshifter', 'You may have Test Impostor enter as a copy of any creature on the battlefield, except its name is Test Impostor, it\'s legendary in addition to its other types, and it has flying.', { pt: ['0', '0'] });
const CLONES = card('Test Clones', 'Sorcery', 'Create two tokens that are copies of target creature you control, except they\'re 1/1 and they aren\'t legendary.');
const RAISER = card('Test Raiser', 'Creature — Zombie', 'You may have this creature enter as a copy of any creature card in a graveyard, except it\'s a 4/4 black Zombie in addition to its other colors and types.', { pt: ['4', '4'], colors: ['B'] });
const DRIFTER = card('Test Drifter', 'Creature — Shapeshifter', 'Whenever another creature you control enters, you may have this creature become a copy of it until end of turn, except its name is Test Drifter and it has this ability.', { pt: ['1', '1'] });
const defs = [BEAR, KING, TRINKET, GROVE, MIMIC, IMPOSTOR, CLONES, RAISER, DRIFTER];

describe('CR 707.9b, 205.1b: "enter as a copy of any artifact on the battlefield, except it\'s an enchantment in addition to its other types"', () => {
  it('is fully automated', () => expect(full(MIMIC)).toBe(true));
  it('it enters as a copy of the artifact: the artifact\'s name, an artifact AND an enchantment', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Mimic'], battlefield: ['Test Trinket'] } }), 'Test Mimic');
    const copies = onField(s, 'Test Trinket');
    expect(copies.length).toBe(2);
    const mimic = copies.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Mimic')!;
    expect([...chars(s, mimic).types].sort()).toEqual(['Artifact', 'Enchantment']);
  });
  it('the negative case: with no artifact on the battlefield it enters as itself, an enchantment only', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Mimic'], battlefield: ['Test Bear'] } }), 'Test Mimic');
    const mimic = onField(s, 'Test Mimic');
    expect(mimic.length).toBe(1);
    expect(chars(s, mimic[0]!).types).toEqual(['Enchantment']);
  });
});

describe('CR 707.9b, 205.4a: "except its name is ~, it\'s legendary in addition to its other types, and it has flying"', () => {
  it('is fully automated', () => expect(full(IMPOSTOR)).toBe(true));
  it('a copy of the Bear named Test Impostor: legendary, a 2/2 Bear with flying', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Impostor'], battlefield: ['Test Bear'] } }), 'Test Impostor');
    const imp = onField(s, 'Test Impostor');
    expect(imp.length).toBe(1);
    const c = chars(s, imp[0]!);
    expect(c.supertypes).toContain('Legendary');
    expect(c.subtypes).toEqual(['Bear']);
    expect([c.power, c.toughness]).toEqual(['2', '2']);
    expect(c.keywords.map((k) => k.keyword)).toContain('flying');
    expect(onField(s, 'Test Bear').length).toBe(1); // the original is not legendary: it keeps its own values
    expect(chars(s, onField(s, 'Test Bear')[0]!).supertypes).not.toContain('Legendary');
  });
});

describe('CR 707.9b, 613.4b, 205.4a: "two tokens that are copies of target creature you control, except they\'re 1/1 and they aren\'t legendary"', () => {
  it('is fully automated', () => expect(full(CLONES)).toBe(true));
  it('two 1/1 copies of the legendary King that are not legendary: all three stay (no legend rule), each copy has vigilance', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Clones'], battlefield: ['Test King'] } });
    const king = find(s, 'Test King', 'battlefield', 'p1');
    s = cast(s, 'Test Clones', { targets: [[king]] });
    const all = onField(s, 'Test King');
    expect(all.length).toBe(3);
    const tokens = all.filter((id) => id !== king);
    for (const t of tokens) {
      const c = chars(s, t);
      expect([c.power, c.toughness]).toEqual(['1', '1']);
      expect(c.supertypes).not.toContain('Legendary');
      expect(c.keywords.map((k) => k.keyword)).toContain('vigilance');
    }
    expect(chars(s, king).supertypes).toContain('Legendary'); // the negative case: the original keeps its supertype
    expect([chars(s, king).power, chars(s, king).toughness]).toEqual(['3', '3']);
  });
});

describe('CR 707.9b, 105.3: "enter as a copy of any creature card in a graveyard, except it\'s a 4/4 black Zombie in addition to its other colors and types"', () => {
  it('is fully automated', () => expect(full(RAISER)).toBe(true));
  it('a copy of the green Elf card in a graveyard: green AND black, an Elf Zombie, 4/4', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Raiser'] }, p2: { graveyard: ['Test Grove'] } }), 'Test Raiser');
    const r = onField(s, 'Test Grove');
    expect(r.length).toBe(1);
    const c = chars(s, r[0]!);
    expect([...c.colors].sort()).toEqual(['B', 'G']);
    expect([...c.subtypes].sort()).toEqual(['Elf', 'Zombie']);
    expect([c.power, c.toughness]).toEqual(['4', '4']);
  });
});

describe('CR 707.9a, 611.2a: "you may have ~ become a copy of it until end of turn, except its name is ~ and it has this ability"', () => {
  it('is fully automated', () => expect(full(DRIFTER)).toBe(true));
  it('when the Bear enters, the Drifter becomes a 2/2 Bear named Test Drifter that still has the trigger', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Drifter'] } });
    const drifter = find(s, 'Test Drifter', 'battlefield', 'p1');
    s = cast(s, 'Test Bear');
    const c = chars(s, drifter);
    expect(c.name).toBe('Test Drifter');
    expect(c.subtypes).toEqual(['Bear']);
    expect([c.power, c.toughness]).toEqual(['2', '2']);
    expect(c.abilities.some((a) => a.def.kind === 'triggered')).toBe(true);
  });
  it('the negative case: answering no leaves it a 1/1 Shapeshifter', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Drifter'] } });
    const drifter = find(s, 'Test Drifter', 'battlefield', 'p1');
    s = cast(s, 'Test Bear', { yes: false });
    expect(chars(s, drifter).subtypes).toEqual(['Shapeshifter']);
    expect([chars(s, drifter).power, chars(s, drifter).toughness]).toEqual(['1', '1']);
  });
});

describe('fail closed (guide section 9; CR 205.1a, 707.9a, 603.12): the readings the copy-exception list does not give', () => {
  it('a bare "except it\'s an artifact" (the new type replaces the others) is not automated', () => {
    expect(full(card('Test Effigy', 'Artifact', 'You may have this artifact enter as a copy of any creature on the battlefield, except it\'s an artifact.'))).toBe(false);
  });
  it('"loses all other card types" is not automated', () => {
    expect(full(card('Test Mech', 'Artifact — Vehicle', 'You may have this artifact enter as a copy of a creature you control, except it\'s an artifact and it loses all other card types.'))).toBe(false);
  });
  it('"this ability" inside a reflexive trigger (the resolving ability is not the printed one) is not automated', () => {
    expect(full(card('Test Shifter', 'Creature — Shapeshifter', 'At the beginning of combat on your turn, you may pay {1}. When you do, this creature becomes a copy of another target creature you control, except it has this ability.', { pt: ['1', '1'] }))).toBe(false);
  });
  it('a color with the "other types" tail (the color would be set, not added) is not automated', () => {
    expect(full(card('Test Raiser Two', 'Creature — Zombie', 'You may have this creature enter as a copy of any creature card in a graveyard, except it\'s a 4/4 black Zombie in addition to its other types.', { pt: ['4', '4'] }))).toBe(false);
  });
});
