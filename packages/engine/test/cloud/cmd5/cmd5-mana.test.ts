/**
 * CLOUD cmd5 (Commander backlog, two or more colors): mana abilities whose source also deals damage to its controller ("{T}: Add {W} or {B}. This land
 * deals 1 damage to you.": the pain lands, the Talismans, "{T}: Add {C}{C}. This land deals 2 damage to you."), played through the engine with synthetic
 * cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 605.1a, 605.3b   the ability is a mana ability: it resolves at once (no stack), the mana first, then the damage
 *   CR 120.3, 120.3a    the damage is dealt by the source (the land or the artifact) and makes its controller lose that much life
 *   CR 605.3a, 601.2g   the player may activate it while paying a cost; the automatic payer plans it too (owner 2026-10-21), after painless mana
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, pool, scenario } from '../../m3/scenario';
import { extraManaModes, manaSources } from '../../../src/rules/sources';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

const PAIN = card('Test Ache Marsh', 'Land', '{T}: Add {C}.\n{T}: Add {W} or {B}. This land deals 1 damage to you.');
const TOMB = card('Test Old Crypt', 'Land', '{T}: Add {C}{C}. This land deals 2 damage to you.');
const CHARM = card('Test Sore Charm', 'Artifact', '{T}: Add {C}.\n{T}: Add {U} or {R}. This artifact deals 1 damage to you.', undefined, '{2}');
const RAINBOW = card('Test Burnt Spire', 'Land', '{T}: Add {C}.\n{T}: Add one mana of any color. This land deals 3 damage to you.');
const ELF = card('Test Gloom Elf', 'Creature — Elf Druid', '{T}: Add {B}. This creature deals 1 damage to you.', ['1', '1'], '{B}');
const SAC = card('Test Brittle Spire', 'Land', '{T}, Sacrifice this land: Add one mana of any color. This land deals 3 damage to you.');
const KNIGHT = card('Test Night Squire', 'Creature — Human Knight', '', ['2', '1'], '{B}');
const GRAY = card('Test Gray Squire', 'Artifact Creature — Construct', '', ['1', '1'], '{1}');
const SHIELD = card('Test Kind Ward', 'Enchantment', 'Prevent all damage that would be dealt to you.');

const game = (battlefield: string[], hand: string[] = []): GameState =>
  scenario([], { defs: [PAIN, TOMB, CHARM, RAINBOW, ELF, SAC, KNIGHT, GRAY, SHIELD], p1: { battlefield, hand } });

describe('CR 605.1a, 605.3b: a mana ability with "This land deals 1 damage to you." is automated', () => {
  it.each([PAIN, TOMB, CHARM, RAINBOW, ELF].map((d) => [d.name, d] as const))('%s is full', (_n, d) => expect(full(d)).toBe(true));
  it('the colored ability is a mana ability (no stack, CR 605.1a)', () => {
    const a = PAIN.faces[0]!.abilities[1]!;
    expect(a.kind === 'activated' && a.isMana).toBe(true);
  });
  it('after "Sacrifice this land" as a cost the source is gone before the damage: kept manual (the engine does not guess the source)', () => expect(full(SAC)).toBe(false));
});

describe('CR 605.3b, 120.3: tapping a pain land for colored mana deals 1 damage to its controller', () => {
  it('{T}: Add {W} or {B}: the player chooses {B}; the pool has {B}, the land is tapped, life 20 -> 19', () => {
    const s0 = game(['Test Ache Marsh']);
    const land = find(s0, 'Test Ache Marsh', 'battlefield', 'p1');
    const asked = act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:1' });
    expect(asked.pending?.kind).toBe('chooseColor');
    expect(asked.pending?.kind === 'chooseColor' ? [...asked.pending.options].sort() : []).toEqual(['B', 'W']);
    const s = answer(asked, { kind: 'chooseColor', color: 'B' });
    expect(pool(s, 'p1')).toBe('B');
    expect(s.objects[land]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(19);
    expect(s.zones.stack).toEqual([]); // CR 605.3b: nothing went on the stack
  });
  it('{T}: Add {C}: no damage', () => {
    const s0 = game(['Test Ache Marsh']);
    const land = find(s0, 'Test Ache Marsh', 'battlefield', 'p1');
    const s = act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:0' });
    expect(pool(s, 'p1')).toBe('C');
    expect(life(s, 'p1')).toBe(20);
  });
  it('{T}: Add {C}{C}. This land deals 2 damage to you.: two {C}, life 18, no question', () => {
    const s0 = game(['Test Old Crypt']);
    const land = find(s0, 'Test Old Crypt', 'battlefield', 'p1');
    const s = act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:0' });
    expect(pool(s, 'p1')).toBe('CC');
    expect(life(s, 'p1')).toBe(18);
  });
  it('an artifact: "This artifact deals 1 damage to you."', () => {
    const s0 = game(['Test Sore Charm']);
    const rock = find(s0, 'Test Sore Charm', 'battlefield', 'p1');
    const s = answer(act(s0, { type: 'activate', player: 'p1', source: rock, ability: 'p:0:1' }), { kind: 'chooseColor', color: 'R' });
    expect(pool(s, 'p1')).toBe('R');
    expect(life(s, 'p1')).toBe(19);
  });
  it('"one mana of any color. This land deals 3 damage to you.": any color, life 17', () => {
    const s0 = game(['Test Burnt Spire']);
    const land = find(s0, 'Test Burnt Spire', 'battlefield', 'p1');
    const s = answer(act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:1' }), { kind: 'chooseColor', color: 'G' });
    expect(pool(s, 'p1')).toBe('G');
    expect(life(s, 'p1')).toBe(17);
  });
  it('a creature: "This creature deals 1 damage to you."', () => {
    const s0 = game(['Test Gloom Elf']);
    const elf = find(s0, 'Test Gloom Elf', 'battlefield', 'p1');
    const s = act(s0, { type: 'activate', player: 'p1', source: elf, ability: 'p:0:0' });
    expect(pool(s, 'p1')).toBe('B');
    expect(life(s, 'p1')).toBe(19);
  });
});

describe('CR 120.3a, 615.1: the damage is damage dealt by the source (a prevention effect applies to it)', () => {
  it('with "Prevent all damage that would be dealt to you." the player keeps 20 life and still gets the mana', () => {
    const s0 = game(['Test Ache Marsh', 'Test Kind Ward']);
    const land = find(s0, 'Test Ache Marsh', 'battlefield', 'p1');
    const s = answer(act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:1' }), { kind: 'chooseColor', color: 'W' });
    expect(pool(s, 'p1')).toBe('W');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 605.3a, 601.2g: paying a cost', () => {
  it('owner 2026-10-21: the automatic payer plans both abilities, the colored one marked as painful (used after painless mana)', () => {
    const s0 = game(['Test Ache Marsh']);
    const land = find(s0, 'Test Ache Marsh', 'battlefield', 'p1');
    const src = manaSources(s0, 'p1').find((x) => x.objectId === land);
    expect(src?.modes.map((m) => [m.key, m.pain === true])).toEqual([['p:0:0', false], ['p:0:1', true]]);
    expect(extraManaModes(s0, 'p1').byHand).toEqual([]); // no longer only by hand
  });
  it('owner 2026-10-21: a black card is playable with only the pain land, and paying automatically taps it for {B} (1 damage)', () => {
    const s0 = game(['Test Ache Marsh'], ['Test Night Squire']);
    const knight = find(s0, 'Test Night Squire', 'hand', 'p1');
    expect(legal(s0, 'p1', 'cast').some((a) => a.object === knight)).toBe(true);
    let s = act(s0, { type: 'cast', player: 'p1', card: knight });
    expect(s.pending?.kind === 'payCost' && s.pending.autoPayable).toBe(true);
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Night Squire']);
    expect(life(s, 'p1')).toBe(19);
  });
  it('owner 2026-10-21: a generic cost is paid with the painless {C} (no damage)', () => {
    const s0 = game(['Test Ache Marsh'], ['Test Gray Squire']);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gray Squire', 'hand', 'p1') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Gray Squire']);
    expect(life(s, 'p1')).toBe(20);
  });
  it('owner 2026-10-21: with a painless {B} source too, the payer taps that one, not the pain land', () => {
    const s0 = scenario(['Swamp'], { defs: [PAIN, KNIGHT], p1: { battlefield: ['Test Ache Marsh', 'Swamp'], hand: ['Test Night Squire'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Night Squire', 'hand', 'p1') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Night Squire']);
    expect(life(s, 'p1')).toBe(20);
    expect(s.objects[find(s, 'Test Ache Marsh', 'battlefield', 'p1')]!.tapped).toBe(false);
  });
  it('the player taps the pain land for {B} first (CR 605.3a), then casts a black spell with that mana: cast, 1 damage taken', () => {
    const s0 = game(['Test Ache Marsh'], ['Test Night Squire']);
    const land = find(s0, 'Test Ache Marsh', 'battlefield', 'p1');
    const tapped = answer(act(s0, { type: 'activate', player: 'p1', source: land, ability: 'p:0:1' }), { kind: 'chooseColor', color: 'B' });
    let s = act(tapped, { type: 'cast', player: 'p1', card: find(tapped, 'Test Night Squire', 'hand', 'p1') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Night Squire']);
    expect(pool(s, 'p1')).toBe('');
    expect(life(s, 'p1')).toBe(19);
  });
  it('while paying a cost the payment decision lists the colored ability; activated there, the color is asked, the cost is paid, 1 damage taken (CR 601.2g)', () => {
    const s0 = game(['Test Ache Marsh'], ['Test Gray Squire']);
    const land = find(s0, 'Test Ache Marsh', 'battlefield', 'p1');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gray Squire', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('payCost');
    expect(s.pending?.kind === 'payCost' ? s.pending.manaSources.map((m) => m.abilityKey).sort() : []).toEqual(['p:0:0', 'p:0:1']);
    s = answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: land, abilityKey: 'p:0:1', color: 'W' }] });
    if (s.pending?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'W' });
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Gray Squire']);
    expect(life(s, 'p1')).toBe(19);
    expect(s.objects[land]!.tapped).toBe(true);
  });
});
