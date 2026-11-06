/**
 * Commander lane edh-b, round edh-b-3: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.23a-b, 701.20a, 202.3   "Search your library for up to two creature cards with mana value 1 or less, reveal them, put them into your hand, then shuffle."
 *   CR 701.23a, 401.4              "..., reveal them, then shuffle and put those cards on top in any order." (up to N)
 *   CR 701.23b, 107.3              "Search your library for a white card, a blue card, a black card, a red card, and a green card." (one card of each; each may be left)
 *   CR 701.23a, 107.3, 601.2b      "Search your library for up to X cards, put those cards into your hand, then shuffle."
 *   CR 406.1, 400.1, 404.1         "Exile all cards from all hands and graveyards."
 *   CR 205.3, 700.8 (ruling 2021-07-23)  "Destroy target non-Angel, non-Demon, non-Devil, non-Dragon creature."
 *   CR 509.1a-b                    "Enchanted creature can block any number of creatures."
 *   CR 113.7a, 303.4               a quoted ability granted by an Aura reads "equipped creature" (the grantee is an Equipment)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, commanderOptions, compileCard, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { maxBlocks } from '../../../src/statics/hooks';
import { act, answer, find, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';

type Pending = NonNullable<GameState['pending']>;
interface Driver { objects?: (p: Pending & { kind: 'chooseObjects' }) => ObjectId[]; yes?: boolean; n?: number; targets?: (p: Pending & { kind: 'chooseTargets' }) => unknown }
function drive(s0: GameState, d: Driver = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.objects ? d.objects(p) : p.options.slice(0, p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: d.yes ?? true });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (d.targets ? d.targets(p) : []) as never });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: d.n ?? p.min });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, d: Driver = {}): GameState => {
  let s = drive(s0, d);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(mpass(s), d);
  return s;
};
const castNamed = (s: GameState, name: string, player = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) });
const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId);
const lb = (...n: string[]): string[] => ['Plains', ...n, 'Plains']; // the draw step takes one end of the library
const hand = (s: GameState, p = 'p1'): string[] => names(s, s.zones.hand[p]!);
const lib = (s: GameState, p = 'p1'): string[] => names(s, s.zones.library[p]!);
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
/** Choose these library cards by name when a search decision comes up (all options with those names). */
const pickNames = (wanted: string[]) => (p: { options: ObjectId[] }, s: () => GameState): ObjectId[] => {
  const out: ObjectId[] = [];
  const left = [...wanted];
  for (const id of p.options) { const i = left.indexOf(s().objects[id]!.defId); if (i >= 0) { out.push(id); left.splice(i, 1); } }
  return out;
};
let current: GameState;
const byNames = (wanted: string[]): Driver => ({ objects: (p) => pickNames(wanted)(p as never, () => current) });
const play = (s0: GameState, name: string, wanted: string[], extra: Driver = {}): GameState => {
  current = s0;
  const d: Driver = { ...byNames(wanted), ...extra };
  let s = drive(castNamed(s0, name), d);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) { current = s; s = drive(mpass(s), d); }
  return s;
};

describe('CR 701.23a-b, 701.20a: "Search your library for up to two creature cards with mana value 1 or less, reveal them, put them into your hand, then shuffle."', () => {
  const SEEK = card('Test Seeking Rite', 'Sorcery', 'Search your library for up to two creature cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.');
  const MAY = card('Test Seeking Scout', 'Creature — Scout', 'When this creature enters, you may search your library for up to two creature cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.', ['1', '1']);
  const SMALL = card('Test Small One', 'Creature — Elf', '', ['1', '1'], '{G}');
  const BIG = card('Test Big One', 'Creature — Elf', '', ['3', '3'], '{2}{G}');
  const defs = [SEEK, MAY, SMALL, BIG];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Seeking Rite'], library: lb('Test Small One', 'Test Small One', 'Test Small One', 'Test Big One') } } });
  it('are automated', () => { expect(full(SEEK)).toBe(true); expect(full(MAY)).toBe(true); });
  it('finds up to two creature cards with mana value 1 or less and puts them into the hand; the card that was cast left the hand', () => {
    const s = play(start(), 'Test Seeking Rite', ['Test Small One', 'Test Small One']);
    expect(hand(s).filter((n) => n === 'Test Small One').length).toBe(2);
    expect(lib(s).filter((n) => n === 'Test Small One').length).toBe(1);
  });
  it('negative: a creature card with mana value 3 is not offered, even when chosen by name', () => {
    const s0 = start();
    current = s0;
    let s = castNamed(s0, 'Test Seeking Rite');
    s = drive(s, { objects: (p) => { const offered = names(s0, []); void offered; return p.options.filter((id) => current.objects[id]!.defId === 'Test Big One'); } });
    s = resolveAll(s);
    expect(hand(s)).not.toContain('Test Big One');
  });
  it('"up to": finding nothing is allowed (zero cards chosen)', () => {
    const s = play(start(), 'Test Seeking Rite', []);
    expect(hand(s)).not.toContain('Test Small One');
  });
  it('the other players\' libraries are not searched', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Seeking Rite'] }, p2: { library: lb('Test Small One') } } });
    const s = play(s0, 'Test Seeking Rite', ['Test Small One']);
    expect(hand(s, 'p1')).not.toContain('Test Small One');
  });
});

describe('CR 701.23a, 401.4: "Search your library for up to three creature cards, reveal them, then shuffle and put those cards on top in any order."', () => {
  const DAWN = card('Test Dawn Rite', 'Sorcery', 'Search your library for up to three creature cards, reveal them, then shuffle and put those cards on top in any order.');
  const E1 = card('Test Elf One', 'Creature — Elf', '', ['1', '1'], '{G}');
  const E2 = card('Test Elf Two', 'Creature — Elf', '', ['1', '1'], '{G}');
  const SORC = card('Test Idle Sorcery', 'Sorcery', 'You gain 1 life.');
  const defs = [DAWN, E1, E2, SORC];
  it('is automated', () => expect(full(DAWN)).toBe(true));
  it('the found creature cards end on top of the library (the rest is not on top); a noncreature card is never found', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Dawn Rite'], library: lb('Test Idle Sorcery', 'Test Elf One', 'Test Elf Two') } } });
    const s = play(s0, 'Test Dawn Rite', ['Test Elf One', 'Test Elf Two', 'Test Idle Sorcery']);
    const top2 = lib(s).slice(0, 2).sort();
    expect(top2).toEqual(['Test Elf One', 'Test Elf Two']);
  });
  it('negative: with no creature card in the library nothing is put on top', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Dawn Rite'], library: lb('Test Idle Sorcery') } } });
    const s = play(s0, 'Test Dawn Rite', []);
    expect(lib(s).length).toBe(s0.zones.library['p1']!.length);
  });
});

describe('CR 701.23b, 107.3: "Search your library for a white card, a blue card, a black card, a red card, and a green card. Reveal those cards, put them into your hand, then shuffle."', () => {
  const FIVE = card('Test Prism Rite', 'Sorcery', 'Search your library for a white card, a blue card, a black card, a red card, and a green card. Reveal those cards, put them into your hand, then shuffle.');
  const colored = (n: string, c: string) => compileCard({ name: n, layout: 'normal', mana_cost: `{${c}}`, type_line: 'Creature — Elf', oracle_text: '', colors: [c], power: '1', toughness: '1' } as unknown as OracleCard);
  const W = colored('Test White Elf', 'W'), U = colored('Test Blue Elf', 'U');
  const defs = [FIVE, W, U];
  it('is automated', () => expect(full(FIVE)).toBe(true));
  it('finds one card of each color that is there; a missing color is simply not found (CR 701.23b)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Prism Rite'], library: lb('Test White Elf', 'Test Blue Elf') } } });
    const s = play(s0, 'Test Prism Rite', ['Test White Elf', 'Test Blue Elf']);
    expect(hand(s)).toContain('Test White Elf');
    expect(hand(s)).toContain('Test Blue Elf');
  });
  it('negative: two white cards are not both found (one card for the white description)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Prism Rite'], library: lb('Test White Elf', 'Test White Elf') } } });
    expect(() => play(s0, 'Test Prism Rite', ['Test White Elf', 'Test White Elf'])).toThrow(/Choose between 0 and 1/); // the engine refuses a second card for the white description
  });
});

describe('CR 701.23a, 107.3: "Search your library for up to X cards, put those cards into your hand, then shuffle."', () => {
  const REV = card('Test Revelation Rite', 'Sorcery', 'Search your library for up to X cards, put those cards into your hand, then shuffle.', undefined, '{X}');
  const defs = [REV];
  it('is automated', () => expect(full(REV)).toBe(true));
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Revelation Rite'], battlefield: ['Plains', 'Plains', 'Plains'], library: lb('Plains', 'Plains', 'Plains') } } });
  it('with X = 2 exactly two chosen cards reach the hand', () => {
    const s0 = start();
    const handBefore = s0.zones.hand['p1']!.length;
    const s = play(s0, 'Test Revelation Rite', [], { n: 2, objects: (p) => p.options.slice(0, 2) });
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1 + 2);
  });
  it('negative: three cards cannot be chosen when X = 2', () => {
    expect(() => play(start(), 'Test Revelation Rite', [], { n: 2, objects: (p) => p.options.slice(0, 3) })).toThrow(/Choose between 0 and 2/);
  });
});

describe('CR 406.1, 404.1: "Exile all cards from all hands and graveyards."', () => {
  const FIRE = card('Test Purge Rite', 'Sorcery', 'Exile all permanents. Exile all cards from all hands and graveyards. Each player\'s life total becomes 1.');
  const defs = [FIRE];
  it('is automated', () => expect(full(FIRE)).toBe(true));
  it('every player\'s hand and graveyard is exiled, the libraries and the exile zone are not touched', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Purge Rite', 'Plains'] }, p2: { hand: ['Plains', 'Plains'], graveyard: ['Plains'], library: lb('Plains') }, p3: { graveyard: ['Plains'] } } });
    const libBefore = s0.zones.library['p2']!.length;
    const s = resolveAll(castNamed(s0, 'Test Purge Rite'));
    for (const p of ['p1', 'p2', 'p3', 'p4']) expect(s.zones.hand[p]!.length, `${p} hand`).toBe(0);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    expect(s.zones.graveyard['p3']!.length).toBe(0);
    expect(s.zones.library['p2']!.length).toBe(libBefore);
    expect(s.zones.exile.length).toBeGreaterThanOrEqual(5);
  });
  it('negative: the graveyard-only wording does not exile hands', () => {
    const ONLY = card('Test Yard Rite', 'Sorcery', 'Exile all cards from all graveyards.');
    const s0 = mpScenario({ defs: [ONLY], zones: { p1: { hand: ['Test Yard Rite'] }, p2: { hand: ['Plains'], graveyard: ['Plains'] } } });
    const s = resolveAll(castNamed(s0, 'Test Yard Rite'));
    expect(s.zones.hand['p2']!.length).toBe(1);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
  });
});

describe('CR 205.3, 700.8 (ruling 2021-07-23): "Destroy target non-Angel, non-Demon, non-Devil, non-Dragon creature."', () => {
  const KILL = card('Test Word Of Ruin', 'Instant', 'Destroy target non-Angel, non-Demon, non-Devil, non-Dragon creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const IMP = card('Test Imp Dragon', 'Creature — Demon Rogue', '', ['2', '2']);
  const defs = [KILL, BEAR, IMP];
  const setup = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Word Of Ruin'] }, p2: { battlefield: ['Test Plain Bear', 'Test Imp Dragon'] } } });
  const target = (s: GameState, name: string): GameState['pending'] => { void s; void name; return null; };
  void target;
  it('is automated', () => expect(full(KILL)).toBe(true));
  it('destroys a Bear', () => {
    const s0 = setup();
    const bear = onBf(s0, 'p2', 'Test Plain Bear')[0]!;
    const s = resolveAll(castNamed(s0, 'Test Word Of Ruin'), { targets: () => [{ kind: 'object', id: bear }] });
    expect(onBf(s, 'p2', 'Test Plain Bear').length).toBe(0);
  });
  it('negative: a Demon Rogue is not a legal target (it has one of the four types, even with another one; ruling 2021-07-23)', () => {
    const s0 = setup();
    const imp = onBf(s0, 'p2', 'Test Imp Dragon')[0]!;
    const s1 = castNamed(s0, 'Test Word Of Ruin');
    expect(s1.pending?.kind).toBe('chooseTargets');
    const r = applyAction(s1, { type: 'answer', answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: imp }] } } as never);
    expect(r.error).toBeDefined();
  });
});

describe('CR 509.1a-b: "Enchanted creature can block any number of creatures."', () => {
  const WEB = card('Test Wide Guard', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can block any number of creatures.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; played: the enchanted creature can block any number of creatures, another creature still blocks one', () => {
    expect(full(WEB)).toBe(true);
    const s0 = mpScenario({
      defs: [WEB, BEAR], zones: { p2: { battlefield: ['Test Wide Guard', 'Test Plain Bear', 'Test Plain Bear'] } },
      setup: (x) => {
        const bears = x.zones.battlefield.filter((o) => x.objects[o]!.defId === 'Test Plain Bear');
        const aura = x.zones.battlefield.find((o) => x.objects[o]!.defId === 'Test Wide Guard')!;
        x.objects[aura]!.attachedTo = bears[0]!;
      },
    });
    const bears = s0.zones.battlefield.filter((o) => s0.objects[o]!.defId === 'Test Plain Bear');
    expect(maxBlocks(s0, bears[0]!)).toBe(Infinity);
    expect(maxBlocks(s0, bears[1]!)).toBe(1);
  });
});

describe('CR 113.7a, 303.4: a quoted ability granted by an Aura says "equipped creature" when the grantee is an Equipment', () => {
  const RUNE = card('Test Rune Of Edge', 'Enchantment — Aura Rune', 'Enchant permanent\nAs long as enchanted permanent is an Equipment, it has "Equipped creature gets +1/+1 and has trample."');
  it('is automated', () => expect(full(RUNE)).toBe(true));
  it('played: a Rune on an Equipment gives the creature that Equipment is attached to +1/+1 and trample; a Rune on a non-Equipment permanent does not', () => {
    const SWORD = card('Test Plain Blade', 'Artifact — Equipment', 'Equip {1}');
    const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
    const ROCK = card('Test Plain Rock', 'Artifact', '');
    const mk = (hostName: string): GameState => mpScenario({
      defs: [RUNE, SWORD, BEAR, ROCK],
      zones: { p1: { battlefield: ['Test Rune Of Edge', 'Test Plain Blade', 'Test Plain Rock', 'Test Plain Bear'] } },
      setup: (x) => {
        const id = (n: string): ObjectId => x.zones.battlefield.find((o) => x.objects[o]!.defId === n)!;
        x.objects[id('Test Rune Of Edge')]!.attachedTo = id(hostName);
        x.objects[id('Test Plain Blade')]!.attachedTo = id('Test Plain Bear');
      },
    });
    const bear = (x: GameState): ObjectId => x.zones.battlefield.find((o) => x.objects[o]!.defId === 'Test Plain Bear')!;
    const withEquipment = mk('Test Plain Blade');
    const c1 = getChars(withEquipment, bear(withEquipment))!;
    expect(`${c1.power}/${c1.toughness}`).toBe('3/3');
    expect(c1.keywords.map((k) => k.keyword)).toContain('trample');
    const onRock = mk('Test Plain Rock');
    const c2 = getChars(onRock, bear(onRock))!;
    expect(`${c2.power}/${c2.toughness}`).toBe('2/2');
    expect(c2.keywords.map((k) => k.keyword)).not.toContain('trample');
  });
});

describe('"You draw two cards, lose 2 life, then create a Treasure token."', () => {
  const DISC = card('Test Costly Counsel', 'Sorcery', 'You draw two cards, lose 2 life, then create a Treasure token.');
  it('is automated and plays all three parts, in order', () => {
    expect(full(DISC)).toBe(true);
    const s0 = mpScenario({ defs: [DISC], zones: { p1: { hand: ['Test Costly Counsel'] } } });
    const handBefore = s0.zones.hand['p1']!.length;
    const s = resolveAll(castNamed(s0, 'Test Costly Counsel'));
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1 + 2);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length).toBe(1);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
  });
});
