/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-1: the round's engine concepts played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 113.6, 605.1a, 602.2    "Exile this card from your hand: Add {G}.": a mana ability that works in its owner's hand only
 *   CR 105.2, 106.5            "Add one mana of any color among legendary creatures you control": the colors those permanents have; none: no mana
 *   CR 702.6a, 702.6c, 205.4   "Equip legendary creature {1}": attaches only to a legendary creature its controller controls
 *   CR 607.2a, 106.5           "Add one mana of any of the exiled card's colors": the colors of the card this permanent exiled; none exiled or a colorless one: no mana
 *   CR 602.5d, 605.3a          "Discard your hand, Sacrifice ~: Add three mana of any one color. Activate only as an instant.": the whole cost, then one color
 *   CR 603.2d, 109.4           "If a triggered ability of a Goblin or another Elf you control triggers, that ability triggers an additional time"
 *   CR 106.1, 106.7, 614.15    "Add one mana of any type that a land you control could produce. If ~ has a +1/+1 counter on it, add three mana of that type instead."
 */
import { describe, expect, it } from 'vitest';
import { act, answer, castAuto, find, life, pass, scenario } from '../../m3/scenario';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const poolOf = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).sort().join('');

/** The mana ability activations offered to `player` for `source`. */
const manaActions = (s: GameState, source: ObjectId, player = 'p1') => legalActions(s, player).filter((l) => l.kind === 'activate' && l.isMana === true && l.object === source);

/** Activate `source`'s mana ability; each color question is answered from `colors` in turn; returns the state and the options of each question. */
function tapFor(s0: GameState, source: ObjectId, colors: string[] = []): { s: GameState; asked: string[][] } {
  const a = manaActions(s0, source)[0];
  if (!a) throw new Error('no mana ability offered');
  const asked: string[][] = [];
  let s = act(s0, a.action);
  for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending as unknown as { kind: string; options?: string[] };
    if (d.kind !== 'chooseColor') throw new Error(`unexpected decision ${d.kind}`);
    asked.push([...(d.options ?? [])].sort());
    s = answer(s, { kind: 'chooseColor', color: colors[asked.length - 1] as never });
  }
  expect(s.zones.stack.length).toBe(0); // a mana ability (CR 605.3a)
  return { s, asked };
}

describe('CR 113.6, 605.1a, 602.2: "Exile this card from your hand: Add {G}." (a mana ability that works in the hand)', () => {
  const GUIDE = card('Test Spirit Guide', 'Creature — Spirit', 'Exile this card from your hand: Add {G}.', { pt: ['2', '2'], cost: '{2}{G}', colors: ['G'] });
  it('is automated; in your hand it is offered and exiling the card adds {G}', () => {
    expect(automated(GUIDE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Spirit Guide'] }, defs: [GUIDE] });
    const id = find(s0, 'Test Spirit Guide', 'hand', 'p1');
    expect(manaActions(s0, id).length).toBe(1);
    const { s } = tapFor(s0, id);
    expect(poolOf(s)).toBe('G');
    expect(s.objects[id]?.zone === 'exile' || find(s, 'Test Spirit Guide', 'exile', 'p1') !== undefined).toBe(true);
    expect(() => find(s, 'Test Spirit Guide', 'hand', 'p1')).toThrow();
  });
  it('not on the battlefield, not in the graveyard, and not in the opponent\'s hand (it works in its owner\'s hand only)', () => {
    const s1 = scenario([], { p1: { battlefield: ['Test Spirit Guide'] }, defs: [GUIDE] });
    expect(manaActions(s1, find(s1, 'Test Spirit Guide', 'battlefield', 'p1')).length).toBe(0);
    const s2 = scenario([], { p1: { graveyard: ['Test Spirit Guide'] }, defs: [GUIDE] });
    expect(manaActions(s2, find(s2, 'Test Spirit Guide', 'graveyard', 'p1')).length).toBe(0);
    const s3 = scenario([], { p2: { hand: ['Test Spirit Guide'] }, defs: [GUIDE] });
    expect(manaActions(s3, find(s3, 'Test Spirit Guide', 'hand', 'p2'), 'p1').length).toBe(0);
  });
});

describe('CR 105.2, 106.5: "Add one mana of any color among legendary creatures you control" (colorsOf each)', () => {
  const MOX = card('Test Saga Mox', 'Artifact', '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.');
  const LAND = card('Test Saga Plaza', 'Land', '{T}: Add one mana of any color among legendary permanents you control.');
  const YARD = card('Test Saga Haven', 'Land', '{T}: Add one mana of any color among legendary creature cards in your graveyard.');
  const BLUE = card('Test Blue Hero', 'Legendary Creature — Human', '', { pt: ['1', '1'], cost: '{U}', colors: ['U'] });
  const RED = card('Test Red Hero', 'Legendary Creature — Human', '', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
  const GREEN = card('Test Green Elf', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{G}', colors: ['G'] });
  const GATE = card('Test Saga Gate', 'Legendary Artifact', '');
  const defs = [MOX, LAND, YARD, BLUE, RED, GREEN, GATE];
  it('the colors of the legendary creatures you control (not the nonlegendary Elf\'s, not an opponent\'s hero)', () => {
    expect(automated(MOX) && automated(LAND) && automated(YARD)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Saga Mox', 'Test Blue Hero', 'Test Green Elf'] }, p2: { battlefield: ['Test Red Hero'] }, defs });
    const r = tapFor(s0, find(s0, 'Test Saga Mox', 'battlefield', 'p1'));
    expect(r.asked).toEqual([]); // one color only: no question (CR 106.5)
    expect(poolOf(r.s)).toBe('U');
    const s1 = scenario([], { p1: { battlefield: ['Test Saga Mox', 'Test Blue Hero', 'Test Red Hero'] }, defs });
    const r1 = tapFor(s1, find(s1, 'Test Saga Mox', 'battlefield', 'p1'), ['R']);
    expect(r1.asked).toEqual([['R', 'U']]);
    expect(poolOf(r1.s)).toBe('R');
  });
  it('no legendary creature, or only a colorless one: no mana', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Saga Mox', 'Test Green Elf'] }, defs });
    expect(poolOf(tapFor(s0, find(s0, 'Test Saga Mox', 'battlefield', 'p1')).s)).toBe('');
    const s1 = scenario([], { p1: { battlefield: ['Test Saga Plaza', 'Test Saga Gate'] }, defs });
    expect(poolOf(tapFor(s1, find(s1, 'Test Saga Plaza', 'battlefield', 'p1')).s)).toBe('');
  });
  it('legendary permanents: a colored legendary creature counts, the Elf does not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Saga Plaza', 'Test Red Hero', 'Test Green Elf'] }, defs });
    expect(poolOf(tapFor(s0, find(s0, 'Test Saga Plaza', 'battlefield', 'p1')).s)).toBe('R');
  });
  it('legendary creature cards in your graveyard: only your own graveyard\'s, not the battlefield\'s', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Saga Haven', 'Test Red Hero'], graveyard: ['Test Blue Hero'] }, p2: { graveyard: ['Test Green Elf'] }, defs });
    const r = tapFor(s0, find(s0, 'Test Saga Haven', 'battlefield', 'p1'));
    expect(poolOf(r.s)).toBe('U');
  });
});

describe('CR 607.2a, 106.5: "Add one mana of any of the exiled card\'s colors." (imprint)', () => {
  const MOX = card('Test Imprint Mox', 'Artifact', 'Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card\'s colors.', { cost: '{1}' });
  const BLUE = card('Test Blue Spell', 'Sorcery', '', { cost: '{U}', colors: ['U'] });
  const GOLD = card('Test Gold Spell', 'Sorcery', '', { cost: '{R}{G}', colors: ['R', 'G'] });
  const ROCK = card('Test Grey Rock', 'Artifact', '', { cost: '{2}' });
  const defs = [MOX, BLUE, GOLD, ROCK];
  /** Cast the mox with mana from the pool; its trigger asks whether to exile a card: exile `exile` (or decline when null). Returns the state after the trigger resolved. */
  const imprinted = (exile: string | null, hand: string[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Imprint Mox', ...hand] }, defs });
    s.players[0]!.manaPool.push({ type: 'C' } as never);
    const cast = legalActions(s, 'p1').find((l) => l.kind === 'cast' && l.object === find(s, 'Test Imprint Mox', 'hand', 'p1'));
    if (!cast) throw new Error('the mox is not castable');
    s = act(s, cast.action);
    for (let guard = 0; guard < 12; guard++) {
      const d = s.pending as unknown as { kind: string };
      if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
      if (d.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
      if (d.kind === 'chooseObjects' && exile !== null) s = answer(s, { kind: 'chooseObjects', ids: [find(s, exile, 'hand', 'p1')] } as never);
      else if (d.kind === 'chooseYesNo' || d.kind === 'confirm' || d.kind === 'yesNo') s = answer(s, { kind: d.kind, yes: exile !== null } as never);
      else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
    }
    return s;
  };
  it('is automated; a two-colored imprinted card gives a choice of its two colors', () => {
    expect(automated(MOX)).toBe(true);
    const s = imprinted('Test Gold Spell', ['Test Gold Spell']);
    const r = tapFor(s, find(s, 'Test Imprint Mox', 'battlefield', 'p1'), ['G']);
    expect(r.asked).toEqual([['G', 'R']]);
    expect(poolOf(r.s)).toBe('G');
  });
  it('a one-colored card: that color without a question; a colorless card or nothing exiled: no mana (CR 106.5)', () => {
    const s = imprinted('Test Blue Spell', ['Test Blue Spell', 'Test Gold Spell']);
    const r = tapFor(s, find(s, 'Test Imprint Mox', 'battlefield', 'p1'));
    expect(r.asked).toEqual([]);
    expect(poolOf(r.s)).toBe('U');
    const none = imprinted(null, ['Test Blue Spell']);
    expect(poolOf(tapFor(none, find(none, 'Test Imprint Mox', 'battlefield', 'p1')).s)).toBe('');
  });
});

describe('CR 702.6a, 702.6c, 205.4: "Equip legendary creature {1}"', () => {
  const BLADE = card('Test Hero Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip legendary creature {1}');
  const HERO = card('Test Legend', 'Legendary Creature — Human', '', { pt: ['2', '2'], cost: '{1}{W}', colors: ['W'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const defs = [BLADE, HERO, BEAR];
  /** The creatures `p1` can target with the equip ability, found by trying each. */
  const equipTargets = (s: GameState): string[] => {
    const a = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === find(s, 'Test Hero Blade', 'battlefield', 'p1'));
    if (!a) return [];
    const d = act(s, a.action).pending as unknown as { kind: string; objects: string[] };
    return d.objects.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
  };
  it('is automated; the legendary creature is a target of the equip ability, the Bear is not', () => {
    expect(automated(BLADE)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Hero Blade', 'Test Legend', 'Test Plain Bear'] }, defs });
    s.players[0]!.manaPool.push({ type: 'C' } as never);
    expect(equipTargets(s)).toEqual(['Test Legend']);
  });
  it('a lone nonlegendary creature, or the opponent\'s legendary creature: nothing to equip (the ability is not offered)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Hero Blade', 'Test Plain Bear'] }, p2: { battlefield: ['Test Legend'] }, defs });
    s.players[0]!.manaPool.push({ type: 'C' } as never);
    expect(equipTargets(s)).toEqual([]);
  });
});

describe('CR 603.2d, 109.4: "If a triggered ability of a Goblin or another Elf you control triggers, that ability triggers an additional time."', () => {
  const DOUBLER = card('Test Echo Sage', 'Creature — Elf Wizard', 'If a triggered ability of a Goblin or another Elf you control triggers, that ability triggers an additional time.', { pt: ['1', '1'], cost: '{1}{G}', colors: ['G'] });
  const GOBLIN = card('Test Pinger', 'Creature — Goblin', 'Whenever you cast a spell, you gain 1 life.', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
  const ELF = card('Test Elf Pinger', 'Creature — Elf', 'Whenever you cast a spell, you gain 1 life.', { pt: ['1', '1'], cost: '{G}', colors: ['G'] });
  const SPIRIT = card('Test Spirit Pinger', 'Creature — Spirit', 'Whenever you cast a spell, you gain 1 life.', { pt: ['1', '1'], cost: '{W}', colors: ['W'] });
  const SPELL = card('Test Cheap Spell', 'Sorcery', '', { cost: '{1}' });
  const defs = [DOUBLER, GOBLIN, ELF, SPIRIT, SPELL];
  /** The life `p1` gains by casting a spell while `field` (p1) and `theirs` (p2) are on the battlefield. */
  const gained = (field: string[], theirs: string[] = []): number => {
    const s0 = scenario([], { p1: { battlefield: field, hand: ['Test Cheap Spell'] }, p2: { battlefield: theirs }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    let s = castAuto(s0, 'Test Cheap Spell');
    for (let i = 0; i < 8 && s.zones.stack.length > 1; i++) s = pass(s);
    // resolve everything
    for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = pass(s);
    return life(s, 'p1') - life(s0, 'p1');
  };
  it('is automated; a Goblin you control triggers twice, so does another Elf', () => {
    expect(automated(DOUBLER)).toBe(true);
    expect(gained(['Test Echo Sage', 'Test Pinger'])).toBe(2);
    expect(gained(['Test Echo Sage', 'Test Elf Pinger'])).toBe(2);
  });
  it('a Spirit does not, the doubler itself (an Elf, but not "another") does not, and an opponent\'s Goblin does not', () => {
    expect(gained(['Test Echo Sage', 'Test Spirit Pinger'])).toBe(1);
    expect(gained(['Test Pinger'])).toBe(1);
    expect(gained(['Test Echo Sage'], ['Test Pinger'])).toBe(0);
  });
});

describe('CR 106.1, 106.7, 614.15: "{T}: Add one mana of any type that a land you control could produce. If ~ has a +1/+1 counter on it, add three mana of that type instead."', () => {
  const DRUID = card('Test Incubator', 'Creature — Elf Druid', '{T}: Add one mana of any type that a land you control could produce. If this creature has a +1/+1 counter on it, add three mana of that type instead.', { pt: ['0', '2'], cost: '{1}{G}', colors: ['G'] });
  const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
  const ISLAND = card('Test Island', 'Basic Land — Island', '{T}: Add {U}.');
  const WASTES = card('Test Wastes', 'Basic Land', '{T}: Add {C}.');
  const defs = [DRUID, FOREST, ISLAND, WASTES];
  it('is automated; with no counter: one mana of a type your lands could produce', () => {
    expect(automated(DRUID)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Incubator', 'Test Forest', 'Test Island'] }, defs });
    const r = tapFor(s0, find(s0, 'Test Incubator', 'battlefield', 'p1'), ['U']);
    expect(r.asked).toEqual([['G', 'U']]);
    expect(poolOf(r.s)).toBe('U');
  });
  it('with a +1/+1 counter: three mana of ONE type (one question), never a mix', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Incubator', counters: { '+1/+1': 3 } }, 'Test Forest', 'Test Island'] }, defs });
    const r = tapFor(s0, find(s0, 'Test Incubator', 'battlefield', 'p1'), ['G']);
    expect(r.asked).toEqual([['G', 'U']]);
    expect(poolOf(r.s)).toBe('GGG');
  });
  it('only your lands count (not an opponent\'s Island); no land: no mana', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Incubator', 'Test Forest'] }, p2: { battlefield: ['Test Island'] }, defs });
    const r = tapFor(s0, find(s0, 'Test Incubator', 'battlefield', 'p1'));
    expect(r.asked).toEqual([]);
    expect(poolOf(r.s)).toBe('G');
    const none = scenario([], { p1: { battlefield: [{ name: 'Test Incubator', counters: { '+1/+1': 1 } }] }, defs });
    expect(poolOf(tapFor(none, find(none, 'Test Incubator', 'battlefield', 'p1')).s)).toBe('');
  });
});
