/**
 * std-craft-1 (lane std-craft): the readings of the round played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 702.167c, 607.2a, 208.1, 604.3   "~'s power is equal to the total power of the exiled cards used to craft it." (a characteristic-defining ability over
 *                                       every card the craft cost exiled; a card that left exile is a new object and no longer counts, CR 400.7)
 *   CR 702.167c, 105.1, 604.3           "~'s power and toughness are each equal to the number of colors among the exiled cards used to craft it."
 *   CR 702.167c, 105.1, 106.4, 605.1a   "{T}: For each color among the exiled cards used to craft this creature, add one mana of that color."
 *   CR 702.167a, 118.3                  "Craft with a Goblin, an Elf, a Wizard, and a Rogue {0}": four different objects, one of each listed kind
 *   CR 702.167c, 607.2a, 508.4          "Then you may put an exiled creature card used to craft ~ onto the battlefield under your control tapped and attacking."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, passBoth, scenario } from '../../m3/scenario';

const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

function creature(name: string, type: string, cost: string, colors: string[], pt: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: '', colors, keywords: [], power: pt[0], toughness: pt[1] } as unknown as OracleCard);
}

/** A transform card whose front face crafts with `materials` for {0} and whose back face is `back`. */
function craftCard(front: string, materials: string, back: { name: string; type: string; text: string; pt: [string, string] }, reminder = materials): CardDef {
  return compileCard({
    name: `${front} // ${back.name}`, layout: 'transform', mana_cost: '', type_line: `Artifact // ${back.type}`, oracle_text: '', colors: [], keywords: [],
    card_faces: [
      { name: front, mana_cost: '{1}', type_line: 'Artifact', oracle_text: `Craft with ${materials} {0} ({0}, Exile this artifact, Exile ${reminder} you control and/or cards from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)` },
      { name: back.name, mana_cost: '', type_line: back.type, oracle_text: back.text, power: back.pt[0], toughness: back.pt[1] },
    ],
  } as unknown as OracleCard);
}

interface Script { objects?: ObjectId[][]; x?: number[] }
/** Answer the decisions of an activation or a resolution in order of kind; payment is automatic. Stops at the next priority decision. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { objects: [...(script.objects ?? [])], x: [...(script.x ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.x.shift() ?? p.min });
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
/** Activate p1's craft ability of `name`, exiling `materials` (ids), and resolve it. */
function craft(s0: GameState, name: string, materials: ObjectId[]): GameState {
  const source = find(s0, name, 'battlefield', 'p1');
  const [a] = legal(s0, 'p1', 'activate').filter((x) => x.object === source && !x.isMana);
  if (a === undefined) throw new Error(`no craft activation of ${name}`);
  return resolveAll(drive(act(s0, a.action), { x: [materials.length], objects: [materials] }));
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id); return `${c.power}/${c.toughness}`; };
/** Move an exiled card to its owner's graveyard by hand (some other effect did it): it is a new object there (CR 400.7). */
function leaveExile(s: GameState, id: ObjectId): void {
  s.zones.exile = s.zones.exile.filter((x) => x !== id);
  const o = s.objects[id]!;
  s.zones.graveyard[o.owner]!.push(id);
  o.zone = 'graveyard';
}

// ---- Mastercraft Raptor's shape -------------------------------------------------------------------------------------------------------------------------------

const LATTICE = craftCard('Test Trellis', 'one or more Dinosaurs', { name: 'Test Gearbeast', type: 'Artifact Creature — Dinosaur', text: "Test Gearbeast's power is equal to the total power of the exiled cards used to craft it.", pt: ['*', '4'] });
const REX = creature('Test Rex', 'Creature — Dinosaur', '{3}', ['G'], ['3', '3']);
const HATCHLING = creature('Test Hatchling', 'Creature — Dinosaur', '{1}', ['R'], ['2', '1']);
const HOUND = creature('Test Hound', 'Creature — Dog', '{4}', ['G'], ['4', '4']);

describe('CR 702.167c, 607.2a, 208.1, 604.3: "~\'s power is equal to the total power of the exiled cards used to craft it"', () => {
  it('is automated on both faces', () => expect(noManual(LATTICE)).toBe(true));
  it('crafted with a 3-power and a 2-power Dinosaur it is 5/4; crafted with the 3-power one alone, 3/4; the Dog is never a material', () => {
    const base = (): GameState => scenario([], { defs: [LATTICE, REX, HATCHLING, HOUND], p1: { battlefield: ['Test Trellis // Test Gearbeast', 'Test Rex', 'Test Hound'], graveyard: ['Test Hatchling'] } });
    let s0 = base();
    let s = craft(s0, 'Test Trellis // Test Gearbeast', [find(s0, 'Test Rex', 'battlefield', 'p1'), find(s0, 'Test Hatchling', 'graveyard', 'p1')]);
    const beast = find(s, 'Test Trellis // Test Gearbeast', 'battlefield', 'p1');
    expect(s.objects[beast]!.face).toBe(1);
    expect(pt(s, beast)).toBe('5/4');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Hound')).toBe(true);
    s0 = base();
    s = craft(s0, 'Test Trellis // Test Gearbeast', [find(s0, 'Test Rex', 'battlefield', 'p1')]);
    expect(pt(s, find(s, 'Test Trellis // Test Gearbeast', 'battlefield', 'p1'))).toBe('3/4');
  });
  it('a card used to craft it that leaves exile no longer counts (CR 400.7, 607.2a)', () => {
    const s0 = scenario([], { defs: [LATTICE, REX, HATCHLING], p1: { battlefield: ['Test Trellis // Test Gearbeast', 'Test Rex'], graveyard: ['Test Hatchling'] } });
    const s = craft(s0, 'Test Trellis // Test Gearbeast', [find(s0, 'Test Rex', 'battlefield', 'p1'), find(s0, 'Test Hatchling', 'graveyard', 'p1')]);
    leaveExile(s, find(s, 'Test Rex', 'exile', 'p1'));
    expect(pt(s, find(s, 'Test Trellis // Test Gearbeast', 'battlefield', 'p1'))).toBe('2/4');
  });
});

// ---- Sunbird Effigy's shape ------------------------------------------------------------------------------------------------------------------------------------

const EFFIGY = craftCard('Test Pennant', 'one or more', {
  name: 'Test Idol', type: 'Artifact Creature — Bird Construct', pt: ['*', '*'],
  text: "Flying, vigilance, haste\nTest Idol's power and toughness are each equal to the number of colors among the exiled cards used to craft it.\n{T}: For each color among the exiled cards used to craft this creature, add one mana of that color.",
});
const EMBER = creature('Test Ember', 'Creature — Elemental', '{R}', ['R'], ['1', '1']);
const ENVOY = creature('Test Envoy', 'Creature — Human', '{W}{U}', ['W', 'U'], ['2', '2']);
const SPRITE = creature('Test Sprite', 'Creature — Faerie', '{U}', ['U'], ['1', '1']);
const GOLEM = creature('Test Cog', 'Artifact Creature — Golem', '{2}', [], ['2', '2']);
const poolOf = (s: GameState, p = 'p1'): string => s.players.find((x) => x.id === p)!.manaPool.map((u) => u.type).sort().join('');

describe('CR 702.167c, 105.1, 604.3: "~\'s power and toughness are each equal to the number of colors among the exiled cards used to craft it"', () => {
  const base = (): GameState => scenario([], { defs: [EFFIGY, EMBER, ENVOY, SPRITE, GOLEM], p1: { battlefield: ['Test Pennant // Test Idol', 'Test Cog'], graveyard: ['Test Ember', 'Test Envoy', 'Test Sprite'] } });
  it('is automated on both faces', () => expect(noManual(EFFIGY)).toBe(true));
  it('red, white-blue and blue materials are three colors: 3/3 (a color shared by two cards counts once, CR 105.1)', () => {
    const s0 = base();
    const s = craft(s0, 'Test Pennant // Test Idol', ['Test Ember', 'Test Envoy', 'Test Sprite'].map((n) => find(s0, n, 'graveyard', 'p1')));
    expect(pt(s, find(s, 'Test Pennant // Test Idol', 'battlefield', 'p1'))).toBe('3/3');
  });
  it('a colorless material alone is no color: the creature is 0/0 and is put into its owner\'s graveyard (CR 105.2c, 704.5f)', () => {
    const s0 = base();
    const s = craft(s0, 'Test Pennant // Test Idol', [find(s0, 'Test Cog', 'battlefield', 'p1')]);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Pennant // Test Idol')).toBe(false);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Pennant // Test Idol')).toBe(true);
  });
});

describe('CR 702.167c, 105.1, 106.4, 605.1a: "{T}: For each color among the exiled cards used to craft this creature, add one mana of that color"', () => {
  /** Craft with the named graveyard cards (and the Cog when asked), then tap the crafted creature for mana. */
  function tapIdol(materials: string[]): string {
    const s0 = scenario([], { defs: [EFFIGY, EMBER, ENVOY, SPRITE, GOLEM], p1: { battlefield: ['Test Pennant // Test Idol', 'Test Cog'], graveyard: ['Test Ember', 'Test Envoy', 'Test Sprite'] } });
    const s = craft(s0, 'Test Pennant // Test Idol', materials.map((n) => find(s0, n, n === 'Test Cog' ? 'battlefield' : 'graveyard', 'p1')));
    const idol = find(s, 'Test Pennant // Test Idol', 'battlefield', 'p1');
    const mana = legal(s, 'p1', 'activate').filter((a) => a.object === idol && a.isMana);
    expect(mana).toHaveLength(1);
    return poolOf(act(s, mana[0]!.action));
  }
  it('red and white-blue materials add {R}, {W} and {U}, one each', () => expect(tapIdol(['Test Ember', 'Test Envoy'])).toBe('RUW'));
  it('blue and white-blue add {W} and {U} once each, never a second {U}; a colorless material adds nothing', () => {
    expect(tapIdol(['Test Sprite', 'Test Envoy'])).toBe('UW');
    expect(tapIdol(['Test Sprite', 'Test Cog'])).toBe('U');
  });
});

// ---- The Grim Captain's shape -----------------------------------------------------------------------------------------------------------------------------------

const THRONE = craftCard('Test Seat', 'a Goblin, an Elf, a Wizard, and a Rogue', {
  name: 'Test Corsair', type: 'Creature — Skeleton Pirate', pt: ['5', '5'],
  text: 'Haste\nWhenever Test Corsair attacks, each opponent sacrifices a nonland permanent of their choice. Then you may put an exiled creature card used to craft Test Corsair onto the battlefield under your control tapped and attacking.',
}, 'the four from among permanents');
const GOBLIN = creature('Test Goblin', 'Creature — Goblin', '{1}', ['R'], ['1', '1']);
const ELF = creature('Test Elf', 'Creature — Elf', '{1}', ['G'], ['2', '2']);
const WIZARD = creature('Test Wizard', 'Creature — Human Wizard', '{1}', ['U'], ['1', '1']);
const GOBLIN_WIZARD = creature('Test Gob Mage', 'Creature — Goblin Wizard', '{1}', ['R'], ['1', '1']);
const ROGUE_RELIC = compileCard({ name: 'Test Lockpick', layout: 'normal', mana_cost: '{1}', type_line: 'Kindred Artifact — Rogue', oracle_text: '', colors: [], keywords: [] } as unknown as OracleCard);
const ROCK = compileCard({ name: 'Test Rock', layout: 'normal', mana_cost: '{1}', type_line: 'Artifact', oracle_text: '', colors: [], keywords: [] } as unknown as OracleCard);
const ROGUE = creature('Test Rogue', 'Creature — Human Rogue', '{1}', ['B'], ['1', '1']);
const GRIM_DEFS = [THRONE, GOBLIN, ELF, WIZARD, GOBLIN_WIZARD, ROGUE_RELIC, ROCK, ROGUE];
const crafts = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => a.object === find(s, 'Test Seat // Test Corsair', 'battlefield', 'p1') && !a.isMana);

describe('CR 702.167a, 118.3: "Craft with a Goblin, an Elf, a Wizard, and a Rogue {0}"', () => {
  it('is automated on both faces', () => expect(noManual(THRONE)).toBe(true));
  it('exiles four different objects, one of each kind, from the battlefield and the graveyard, and returns the card transformed', () => {
    const s0 = scenario([], { defs: GRIM_DEFS, p1: { battlefield: ['Test Seat // Test Corsair', 'Test Goblin', 'Test Wizard'], graveyard: ['Test Elf', 'Test Lockpick'] } });
    expect(crafts(s0)).toBe(true);
    const s = resolveAll(drive(act(s0, legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Seat // Test Corsair', 'battlefield', 'p1') && !a.isMana)!.action)));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Elf', 'Test Goblin', 'Test Lockpick', 'Test Wizard']);
    expect(s.objects[find(s, 'Test Seat // Test Corsair', 'battlefield', 'p1')]!.face).toBe(1);
  });
  it('one Goblin Wizard can\'t be both the Goblin and the Wizard: with no other Wizard the craft is not offered; with one, it is (CR 118.3)', () => {
    expect(crafts(scenario([], { defs: GRIM_DEFS, p1: { battlefield: ['Test Seat // Test Corsair', 'Test Gob Mage'], graveyard: ['Test Elf', 'Test Lockpick'] } }))).toBe(false);
    expect(crafts(scenario([], { defs: GRIM_DEFS, p1: { battlefield: ['Test Seat // Test Corsair', 'Test Gob Mage', 'Test Wizard'], graveyard: ['Test Elf', 'Test Lockpick'] } }))).toBe(true);
  });
});

describe('CR 702.167c, 607.2a, 508.4: "Then you may put an exiled creature card used to craft ~ onto the battlefield under your control tapped and attacking"', () => {
  /** Craft the Seat with Goblin, Elf, Wizard and the Rogue `rogue` (a creature or a noncreature card), then attack with the Corsair and stop at p1's choice. */
  function attackAfterCraft(rogue: 'Test Lockpick' | 'Test Rogue'): GameState {
    const s0 = scenario([], { defs: GRIM_DEFS, p1: { battlefield: ['Test Seat // Test Corsair', 'Test Goblin', 'Test Wizard'], graveyard: ['Test Elf', rogue] }, p2: { battlefield: ['Test Rock', 'Plains'] } });
    let s = resolveAll(drive(act(s0, legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Seat // Test Corsair', 'battlefield', 'p1') && !a.isMana)!.action)));
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Seat // Test Corsair', 'battlefield', 'p1'), defender: 'p2' }] } as never);
    for (let i = 0; i < 20 && !(s.pending?.kind === 'chooseObjects' && s.pending.player === 'p1'); i++) {
      const p = s.pending!;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else if (p.kind === 'priority') s = pass(s);
      else s = drive(s);
    }
    return s;
  }
  it('the opponent sacrifices a nonland permanent; then the creature cards used to craft it, and only those, are offered; the chosen one enters under your control tapped and attacking', () => {
    let s = attackAfterCraft('Test Lockpick');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Rock')).toBe(false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p2')).toBe(true);
    const p = s.pending as { kind: 'chooseObjects'; options: ObjectId[]; min: number; max: number };
    expect(p.options.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Elf', 'Test Goblin', 'Test Wizard']); // not the noncreature Rogue (a Kindred artifact)
    expect([p.min, p.max]).toEqual([0, 1]);
    const elf = p.options.find((id) => s.objects[id]!.defId === 'Test Elf')!;
    s = answer(s, { kind: 'chooseObjects', ids: [elf] });
    const back = find(s, 'Test Elf', 'battlefield', 'p1');
    expect(s.objects[back]!.controller).toBe('p1');
    expect(s.objects[back]!.tapped).toBe(true);
    expect(JSON.stringify(s.combat ?? {})).toContain(back);
  });
  it('you may choose none: every exiled card stays in exile', () => {
    let s = attackAfterCraft('Test Rogue');
    expect((s.pending as { options: ObjectId[] }).options).toHaveLength(4);
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Elf', 'Test Goblin', 'Test Rogue', 'Test Wizard']);
  });
});
