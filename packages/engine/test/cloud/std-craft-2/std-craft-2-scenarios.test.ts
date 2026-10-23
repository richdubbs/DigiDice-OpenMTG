/**
 * std-craft-2 (lane std-craft): The Enigma Jewel's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 702.167a-b, 602.1          "Craft with two or more nonlands with activated abilities {0}": nonland permanents and cards that have an activated ability
 *   CR 702.167c, 613.1f, 602.5b   "~ has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each turn."
 *   CR 603.2, 707.10, 602.2       "Whenever you activate an ability that isn't a mana ability, copy it. You may choose new targets for the copy."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, passBoth, scenario } from '../../m3/scenario';

const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

function permanent(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{1}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}

const JEWEL = compileCard({
  name: 'Test Prism // Test Lens', layout: 'transform', mana_cost: '', type_line: 'Legendary Artifact // Legendary Artifact', oracle_text: '', colors: [], keywords: [],
  card_faces: [
    { name: 'Test Prism', mana_cost: '{U}', type_line: 'Legendary Artifact', oracle_text: "Craft with two or more nonlands with activated abilities {0} ({0}, Exile this artifact, Exile the two or more from among other permanents you control and/or cards in your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)" },
    { name: 'Test Lens', mana_cost: '', type_line: 'Legendary Artifact', oracle_text: 'Test Lens has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each turn.\nWhenever you activate an ability that isn\'t a mana ability, copy it. You may choose new targets for the copy.' },
  ],
} as unknown as OracleCard);
const HEALER = permanent('Test Healer', 'Creature — Human Cleric', '{0}: You gain 1 life.', ['1', '1']);
const SCROLL = permanent('Test Scroll', 'Artifact', '{0}: You gain 2 life.');
const DYNAMO = permanent('Test Dynamo', 'Artifact', '{T}: Add {C}.');
const FIELD = permanent('Test Field', 'Land', '{0}: You gain 3 life.');
const OAF = permanent('Test Oaf', 'Creature — Ogre', '', ['3', '3']);
const DEFS = [JEWEL, HEALER, SCROLL, DYNAMO, FIELD, OAF];

/** Answer an activation's or a resolution's decisions (materials in order, payment automatic, no new targets); stop at the next priority. */
function drive(s0: GameState, materials: ObjectId[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: materials.length > 0 ? materials.length : p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: materials.length > 0 ? materials.filter((id) => p.options.includes(id)) : p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
  return s;
}
const prism = (s: GameState): ObjectId => find(s, 'Test Prism // Test Lens', 'battlefield', 'p1');
const nonMana = (s: GameState) => legal(s, 'p1', 'activate').filter((a) => a.object === prism(s) && !a.isMana);
/** p1 crafts with the named graveyard cards (a list of ids), resolving everything. */
function crafted(graveyard: string[], materials: string[]): GameState {
  const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Prism // Test Lens'], graveyard } });
  const [a] = nonMana(s0);
  return resolveAll(drive(act(s0, a!.action), materials.map((n) => find(s0, n, 'graveyard', 'p1'))));
}

describe('CR 702.167a-b, 602.1: "Craft with two or more nonlands with activated abilities"', () => {
  it('is automated on both faces', () => expect(noManual(JEWEL)).toBe(true));
  it('two nonland cards with activated abilities are materials (a mana ability is one too); a land with one and a creature with none are not', () => {
    expect(nonMana(scenario([], { defs: DEFS, p1: { battlefield: ['Test Prism // Test Lens'], graveyard: ['Test Healer', 'Test Field', 'Test Oaf'] } }))).toHaveLength(0);
    const s = crafted(['Test Healer', 'Test Dynamo', 'Test Field', 'Test Oaf'], ['Test Healer', 'Test Dynamo']);
    expect(s.objects[prism(s)]!.face).toBe(1);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Dynamo', 'Test Healer']);
  });
});

describe('CR 702.167c, 613.1f, 602.5b: "~ has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each turn."', () => {
  it('the crafted permanent has the materials\' activated abilities, mana ability included; each may be activated once this turn, the others still', () => {
    let s = crafted(['Test Healer', 'Test Scroll', 'Test Dynamo'], ['Test Healer', 'Test Scroll', 'Test Dynamo']);
    expect(nonMana(s)).toHaveLength(2);
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === prism(s) && a.isMana)).toHaveLength(1);
    const before = life(s, 'p1');
    const healer = nonMana(s).find((a) => /1 life/.test(a.label))!;
    s = resolveAll(drive(act(s, healer.action)));
    // the ability and its copy (the triggered ability below): 1 life twice
    expect(life(s, 'p1')).toBe(before + 2);
    expect(nonMana(s).map((a) => a.label).some((l) => /1 life/.test(l))).toBe(false);
    expect(nonMana(s).map((a) => a.label).some((l) => /2 life/.test(l))).toBe(true);
  });
  it('a material that left exile no longer gives its ability (CR 400.7, 607.2a)', () => {
    const s = crafted(['Test Healer', 'Test Scroll'], ['Test Healer', 'Test Scroll']);
    const scroll = find(s, 'Test Scroll', 'exile', 'p1');
    s.zones.exile = s.zones.exile.filter((x) => x !== scroll);
    s.zones.graveyard['p1']!.push(scroll);
    s.objects[scroll]!.zone = 'graveyard';
    expect(nonMana(s).map((a) => a.label).some((l) => /2 life/.test(l))).toBe(false);
    expect(nonMana(s).map((a) => a.label).some((l) => /1 life/.test(l))).toBe(true);
  });
});

describe('CR 603.2, 707.10, 602.2: "Whenever you activate an ability that isn\'t a mana ability, copy it."', () => {
  it('a non-mana ability is copied (it resolves twice); a mana ability triggers nothing', () => {
    let s = crafted(['Test Scroll', 'Test Dynamo'], ['Test Scroll', 'Test Dynamo']);
    const before = life(s, 'p1');
    s = resolveAll(drive(act(s, nonMana(s)[0]!.action)));
    expect(life(s, 'p1')).toBe(before + 4);
    const mana = legal(s, 'p1', 'activate').find((a) => a.object === prism(s) && a.isMana)!;
    s = act(s, mana.action);
    expect(s.zones.stack).toHaveLength(0);
  });
});
