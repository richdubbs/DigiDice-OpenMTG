/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-6: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 602.5, 702.131c, 725.1  "Activate only if you have the city's blessing." / "if you're the monarch" (Arch of Orazca): read from the game state as the ability is activated
 *   CR 701.21a, 118.3, 607.2d   "Sacrifice a creature of the chosen type" (Etchings of the Chosen): only creatures of the type the permanent chose can pay
 *   CR 701.21a, 118.3, 602.2b   "Sacrifice a Swamp and a Forest" (Jarad, Golgari Lich Lord): two permanents, one for each description
 *   CR 105.2, 106.5, 605.1a     "{T}: Add one mana of any of ~'s colors." (Katilda, Dawnhart Prime, granted to Humans): the colors of the creature that has the ability
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, life, scenario } from '../../m3/scenario';
import { card, full, settle } from '../cmd3/helpers';

const activations = (s: GameState, name: string, player = 'p1') => legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === find(s, name, 'battlefield', player) && l.isMana !== true);
const run = (s: GameState, name: string, picks = {}): GameState => settle(act(s, activations(s, name)[0]!.action), picks);
const drain = (s0: GameState): GameState => { let s = s0; for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(act(s, { type: 'pass', player: s.pending!.player })); return s; };
const withDesignation = (s: GameState, f: (d: GameState['designations']) => void): GameState => { const t = structuredClone(s); f(t.designations); return t; };

// ---- "Activate only if you have the city's blessing" -------------------------------------------------------------------------------------------------------------
const GATE = card('Test Gate', 'Land', "{T}: You gain 1 life. Activate only if you have the city's blessing.");
const THRONE = card('Test Throne', 'Artifact', "{0}: You gain 2 life. Activate only if you're the monarch.");

describe("CR 602.5, 702.131c: \"Activate only if you have the city's blessing\" reads the designation as it is now", () => {
  const board = (name: string, def = GATE): GameState => scenario([], { defs: [def], p1: { battlefield: [name] } });
  it('the cards are fully automated', () => {
    expect(full(GATE), JSON.stringify(GATE.automation)).toBe(true);
    expect(full(THRONE), JSON.stringify(THRONE.automation)).toBe(true);
  });
  it('with the blessing the ability can be activated and resolves', () => {
    const s = drain(run(withDesignation(board('Test Gate'), (d) => { d.citysBlessing = ['p1']; }), 'Test Gate'));
    expect(life(s, 'p1')).toBe(21);
  });
  it('negative: without the blessing it is not offered', () => {
    expect(activations(board('Test Gate'), 'Test Gate')).toHaveLength(0);
  });
  it('negative: only an opponent has the blessing: not offered', () => {
    expect(activations(withDesignation(board('Test Gate'), (d) => { d.citysBlessing = ['p2']; }), 'Test Gate')).toHaveLength(0);
  });
  it("CR 725.1: \"if you're the monarch\" is offered to the monarch only", () => {
    const b = board('Test Throne', THRONE);
    expect(activations(b, 'Test Throne')).toHaveLength(0);
    expect(activations(withDesignation(b, (d) => { d.monarch = 'p2'; }), 'Test Throne')).toHaveLength(0);
    const s = drain(run(withDesignation(b, (d) => { d.monarch = 'p1'; }), 'Test Throne'));
    expect(life(s, 'p1')).toBe(22);
  });
});

// ---- "Sacrifice a creature of the chosen type" ---------------------------------------------------------------------------------------------------------------------
const ETCH = card('Test Etchings', 'Enchantment', 'As this enchantment enters, choose a creature type.\n{0}, Sacrifice a creature of the chosen type: You gain 3 life.');
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['1', '1']);

describe('CR 701.21a, 607.2d: "Sacrifice a creature of the chosen type"', () => {
  const resolved = (battlefield: string[]): GameState => {
    const s0 = scenario([], { defs: [ETCH, ELF, BEAR], p1: { hand: ['Test Etchings'], battlefield } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Etchings', 'hand', 'p1') }));
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || s.pending?.kind === 'chooseName'); i++) {
      s = s.pending?.kind === 'chooseName' ? answer(s, { kind: 'chooseName', name: 'Elf' }) : settle(act(s, { type: 'pass', player: s.pending!.player }));
    }
    return s;
  };
  it('the card is fully automated', () => {
    expect(full(ETCH), JSON.stringify(ETCH.automation)).toBe(true);
  });
  it('an Elf can be sacrificed when Elf was chosen (3 life); the Bear stays', () => {
    const s0 = resolved(['Test Elf', 'Test Bear']);
    const a = activations(s0, 'Test Etchings');
    expect(a).toHaveLength(1);
    const s = drain(settle(act(s0, a[0]!.action)));
    expect(life(s, 'p1')).toBe(23);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Elf')).toBe(false);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(true);
  });
  it('negative: with no creature of the chosen type the ability is not offered (a Bear cannot pay)', () => {
    expect(activations(resolved(['Test Bear']), 'Test Etchings')).toHaveLength(0);
  });
});

// ---- "Sacrifice a Swamp and a Forest" ---------------------------------------------------------------------------------------------------------------------------------
const RITE = card('Test Rite', 'Artifact', 'Sacrifice a Swamp and a Forest: You gain 4 life.');
const bog = (type: string) => compileCard({ name: `Test ${type}`, layout: 'normal', mana_cost: '', type_line: `Basic Land — ${type}`, oracle_text: '', colors: [] } as OracleCard);
const DUAL = compileCard({ name: 'Test Dual', layout: 'normal', mana_cost: '', type_line: 'Land — Swamp Forest', oracle_text: '', colors: [] } as OracleCard);
const LANDS = [RITE, bog('Swamp'), bog('Forest'), DUAL];

describe('CR 701.21a, 118.3: "Sacrifice a Swamp and a Forest" needs one permanent for each description', () => {
  const board = (...lands: string[]): GameState => scenario([], { defs: LANDS, p1: { battlefield: ['Test Rite', ...lands] } });
  it('the card is fully automated', () => {
    expect(full(RITE), JSON.stringify(RITE.automation)).toBe(true);
  });
  it('a Swamp and a Forest are both sacrificed (4 life)', () => {
    const s = drain(run(board('Test Swamp', 'Test Forest', 'Test Forest'), 'Test Rite'));
    expect(life(s, 'p1')).toBe(24);
    const left = s.zones.battlefield.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(left.filter((n) => n === 'Test Swamp')).toHaveLength(0);
    expect(left.filter((n) => n === 'Test Forest')).toHaveLength(1);
  });
  it('negative: two Swamps are not a Swamp and a Forest', () => {
    expect(activations(board('Test Swamp', 'Test Swamp'), 'Test Rite')).toHaveLength(0);
  });
  it('negative: one land that is both a Swamp and a Forest pays for only one of them', () => {
    expect(activations(board('Test Dual'), 'Test Rite')).toHaveLength(0);
  });
  it('a Swamp Forest and a Swamp together pay (the Swamp for the Swamp, the dual for the Forest)', () => {
    expect(activations(board('Test Dual', 'Test Swamp'), 'Test Rite').length).toBeGreaterThan(0);
  });
});

// ---- "{T}: Add one mana of any of ~'s colors." granted ----------------------------------------------------------------------------------------------------------------
const colored = (name: string, mana: string, colors: string[]) => compileCard({ name, layout: 'normal', mana_cost: mana, type_line: 'Creature — Human', oracle_text: '', colors, power: '1', toughness: '1' } as OracleCard);
const LORD = card('Test Lord', 'Artifact', 'Human creatures you control have "{T}: Add one mana of any of ~\'s colors."');
const GW = colored('Test GW Human', '{G}{W}', ['G', 'W']);
const NONE = colored('Test Blank Human', '', []);

describe("CR 105.2, 106.5, 605.1a: \"Add one mana of any of ~'s colors\" is the colors of the creature that has the ability", () => {
  const manaOptions = (s: GameState, name: string) => legalActions(s, 'p1').filter((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s, name, 'battlefield', 'p1'));
  it('the card is fully automated', () => {
    expect(full(LORD), JSON.stringify(LORD.automation)).toBe(true);
  });
  it('a green-white Human taps for one mana of its own colors', () => {
    const s0 = scenario([], { defs: [LORD, GW], p1: { battlefield: ['Test Lord', 'Test GW Human'] } });
    const a = manaOptions(s0, 'Test GW Human');
    expect(a.length).toBeGreaterThan(0);
    const t = act(s0, a[0]!.action);
    expect(t.pending?.kind).toBe('chooseColor');
    expect((t.pending as unknown as { options: string[] }).options.sort()).toEqual(['G', 'W']); // exactly the creature's own colors
    const s = answer(t, { kind: 'chooseColor', color: 'W' });
    const pool = s.players.find((p) => p.id === 'p1')!.manaPool;
    expect(pool).toHaveLength(1);
    expect(pool[0]!.type).toBe('W');
  });
  it('negative: a colorless Human adds no mana of any of its colors (CR 106.5)', () => {
    const s0 = scenario([], { defs: [LORD, NONE], p1: { battlefield: ['Test Lord', 'Test Blank Human'] } });
    const a = manaOptions(s0, 'Test Blank Human');
    expect(a.length).toBeGreaterThan(0); // the ability is there (offered by hand), it just adds nothing
    const s = settle(act(s0, a[0]!.action));
    expect(s.players.find((p) => p.id === 'p1')!.manaPool).toHaveLength(0);
  });
  it('negative: a Human of the opponent does not get the ability', () => {
    const s0 = scenario([], { defs: [LORD, GW], p1: { battlefield: ['Test Lord'] }, p2: { battlefield: ['Test GW Human'] } });
    expect(manaOptions(s0, 'Test GW Human').length).toBe(0);
  });
});

// ---- "That creature's owner can't cast spells with the same name as that creature until your next turn" ----------------------------------------------------------------
const MAGE = card('Test Mage', 'Creature — Wizard', "When this creature enters, return target creature an opponent controls to its owner's hand. That creature's owner can't cast spells with the same name as that creature until your next turn.", ['2', '2']);
const KRILL = card('Test Krill', 'Creature — Fish', 'Flash', ['1', '1']);
const GULL = card('Test Gull', 'Creature — Bird', 'Flash', ['1', '1']);

describe('CR 201.2, 608.2h, 611.2c: "can\'t cast spells with the same name as that creature" names the creature as it last existed', () => {
  const bounced = (): GameState => {
    const s0 = scenario([], { defs: [MAGE, KRILL, GULL], p1: { hand: ['Test Mage'] }, p2: { battlefield: ['Test Krill'], hand: ['Test Krill', 'Test Gull'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mage', 'hand', 'p1') }));
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      s = settle(act(s, { type: 'pass', player: s.pending!.player }), { targets: [{ kind: 'object', id: find(s0, 'Test Krill', 'battlefield', 'p2') }] });
    }
    return s;
  };
  const castable = (s: GameState, player: string): string[] => legalActions(s, player).filter((l) => l.kind === 'cast').map((l) => l.label);
  it('the card is fully automated', () => {
    expect(full(MAGE), JSON.stringify(MAGE.automation)).toBe(true);
  });
  it('the owner can no longer cast the bounced creature or another card with its name, but can cast a card with another name', () => {
    let s = bounced();
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Krill')).toBe(false);
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    const labels = castable(s, 'p2');
    expect(labels.some((l) => l.includes('Test Gull'))).toBe(true);
    expect(labels.some((l) => l.includes('Test Krill'))).toBe(false);
  });
  it('negative: the restriction is on the owner only (the caster still casts a spell with that name)', () => {
    const s0 = scenario([], { defs: [MAGE, KRILL, GULL], p1: { hand: ['Test Mage', 'Test Krill'] }, p2: { battlefield: ['Test Krill'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mage', 'hand', 'p1') }));
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      s = settle(act(s, { type: 'pass', player: s.pending!.player }), { targets: [{ kind: 'object', id: find(s0, 'Test Krill', 'battlefield', 'p2') }] });
    }
    expect(castable(s, 'p1').some((l) => l.includes('Test Krill'))).toBe(true);
  });
});
