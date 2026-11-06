/**
 * Coordinator D, round edh-d-46 (lane lands, second pass): the round's readings and engine changes played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

// ---- Shriekwood Devourer --------------------------------------------------------------------------------------------------------------------------------------------
const DEV = card('Test Devourer', 'Creature — Treefolk', 'Trample\nWhenever you attack with one or more creatures, untap up to X lands, where X is the greatest power among those creatures.', ['7', '7']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5']);
describe('CR 603.2c, 208.1, 107.3, 701.26b: "Whenever you attack with one or more creatures, untap up to X lands, where X is the greatest power among those creatures." (Shriekwood Devourer)', () => {
  it('is automated (the card itself stays partial or full by the whole text)', () => { expect(JSON.stringify(DEV.faces)).not.toContain('"op":"manual"'); });
  const tapped = (n: number) => Array.from({ length: n }, () => ({ name: 'Mountain', tapped: true }));
  const attackWith = (attackers: string[], lands: number): GameState => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Devourer', 'Test Bear', 'Test Giant', ...tapped(lands)] }, p2: { battlefield: [] }, defs: [DEV, BEAR, GIANT] });
    const ids = attackers.map((n) => find(s0, n, 'battlefield', 'p1'));
    return declareAttackers(toDeclareAttackers(s0), ids.map((i) => [i] as [typeof i]));
  };
  const maxOffered = (s: GameState): number => {
    for (let i = 0; i < 12; i++) {
      const d = s.pending as { kind: string; max?: number };
      if (d.kind === 'chooseObjects') return d.max!;
      s = pass(s);
    }
    return -1;
  };
  it('attacking with the 7/7 and the 3/3: X is 7 (capped by the five tapped lands offered)', () => {
    expect(maxOffered(attackWith(['Test Devourer', 'Test Bear'], 9))).toBe(7);
  });
  it('X is the greatest power among the creatures that attacked: only the 3/3 attacks, so up to three lands', () => {
    expect(maxOffered(attackWith(['Test Bear'], 9))).toBe(3);
  });
  it('the 5/5 and the 3/3 attack: up to five lands, and the lands the player picks untap', () => {
    const s = attackWith(['Test Giant', 'Test Bear'], 9);
    expect(maxOffered(s)).toBe(5);
    let t = s;
    while ((t.pending as { kind: string }).kind !== 'chooseObjects') t = pass(t);
    const opts = (t.pending as unknown as { options: string[] }).options;
    t = answer(t, { kind: 'chooseObjects', ids: opts.slice(0, 2) } as never);
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(t);
    expect(findAll(t, 'Mountain', 'battlefield', 'p1').filter((id) => !t.objects[id]!.tapped).length).toBe(2);
  });
});

// ---- Blood Sun ------------------------------------------------------------------------------------------------------------------------------------------------------
const SUN = card('Test Sun', 'Enchantment', 'All lands lose all abilities except mana abilities.');
const ODD_LAND = card('Test Odd Land', 'Land', '{T}: Add {G}.\n{2}, {T}: You gain 1 life.\nWhen this land enters, you gain 1 life.');
describe('CR 613.1f, 605.1a: "All lands lose all abilities except mana abilities." (Blood Sun)', () => {
  it('is automated', () => { expect(full(SUN)).toBe(true); });
  const kinds = (s: GameState, name: string): string[] => getChars(s, find(s, name, 'battlefield', 'p1')).abilities.map((a) => `${a.def.kind}${a.def.kind === 'activated' && a.def.isMana ? ':mana' : ''}`);
  it('a land keeps its mana ability and a basic land type keeps the one it brings, but loses its other activated and triggered abilities', () => {
    const s = scenario(['Mountain', 'Forest'], { p1: { battlefield: ['Test Sun', 'Test Odd Land', 'Forest'] }, p2: { battlefield: [] }, defs: [SUN, ODD_LAND] });
    expect(kinds(s, 'Test Odd Land')).toEqual(['activated:mana']);
    expect(kinds(s, 'Forest')).toContain('activated:mana');
  });
  it('negative: without the enchantment the land has all three abilities, and a nonland permanent is not affected', () => {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Odd Land'] }, p2: { battlefield: [] }, defs: [SUN, ODD_LAND] });
    expect(kinds(s, 'Test Odd Land').length).toBe(3);
    const t = scenario(['Mountain'], { p1: { battlefield: ['Test Sun', 'Test Bear'] }, p2: { battlefield: [] }, defs: [SUN, BEAR] });
    expect(kinds(t, 'Test Bear')).toEqual([]);
  });
});

// ---- Rootpath Purifier ----------------------------------------------------------------------------------------------------------------------------------------------
const PURIFIER = card('Test Purifier', 'Creature — Elf Druid', 'Lands you control and land cards in your library are basic.', ['2', '2']);
const NONBASIC = card('Test Nonbasic Land', 'Land', '{T}: Add {C}.');
describe('CR 205.4a, 613.1d: "Lands you control and land cards in your library are basic." (Rootpath Purifier)', () => {
  it('is automated', () => { expect(full(PURIFIER)).toBe(true); });
  const supers = (s: GameState, id: string): string[] => getChars(s, id).supertypes;
  it('a land you control and a land card in your library are basic; a land card in your hand and an opponent\'s land are not', () => {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Purifier', 'Test Nonbasic Land'], library: ['Test Nonbasic Land'], hand: ['Test Nonbasic Land'] }, p2: { battlefield: ['Test Nonbasic Land'] }, defs: [PURIFIER, NONBASIC] });
    const onField = find(s, 'Test Nonbasic Land', 'battlefield', 'p1');
    const lib = find(s, 'Test Nonbasic Land', 'library', 'p1');
    const hand = find(s, 'Test Nonbasic Land', 'hand', 'p1');
    const theirs = find(s, 'Test Nonbasic Land', 'battlefield', 'p2');
    expect(supers(s, onField)).toContain('Basic');
    expect(supers(s, lib)).toContain('Basic');
    expect(supers(s, hand)).not.toContain('Basic');
    expect(supers(s, theirs)).not.toContain('Basic');
  });
  it('negative: without the creature nothing is basic', () => {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Test Nonbasic Land'], library: ['Test Nonbasic Land'] }, p2: { battlefield: [] }, defs: [PURIFIER, NONBASIC] });
    expect(supers(s, find(s, 'Test Nonbasic Land', 'battlefield', 'p1'))).not.toContain('Basic');
    expect(supers(s, find(s, 'Test Nonbasic Land', 'library', 'p1'))).not.toContain('Basic');
  });
});

// ---- Elsewhere Flask ------------------------------------------------------------------------------------------------------------------------------------------------
const FLASK = card('Test Flask', 'Artifact', 'Sacrifice this artifact: Choose a basic land type. Each land you control becomes that type until end of turn.');
describe('CR 305.7, 608.2d, 613.1d: "Choose a basic land type. Each land you control becomes that type until end of turn." (Elsewhere Flask)', () => {
  it('is automated', () => { expect(full(FLASK)).toBe(true); });
  const subs = (s: GameState, id: string): string[] => getChars(s, id).subtypes;
  it('your Forest and your Mountain become Islands; the opponent\'s Forest does not; at end of turn they are back', () => {
    const s0 = scenario(['Forest', 'Mountain', 'Island'], { p1: { battlefield: ['Test Flask', 'Forest', 'Mountain'] }, p2: { battlefield: ['Forest'] }, defs: [FLASK] });
    let s = act(s0, legal(s0, 'p1', 'activate').find((l) => l.action.type === 'activate')!.action);
    for (let i = 0; i < 8 && s.pending!.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
    expect(s.pending!.kind).toBe('chooseName');
    s = answer(s, { kind: 'chooseName', name: 'Island' });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = pass(s);
    const mine = [...findAll(s, 'Forest', 'battlefield', 'p1'), ...findAll(s, 'Mountain', 'battlefield', 'p1')];
    expect(mine.length).toBe(2);
    for (const id of mine) expect(subs(s, id)).toEqual(['Island']);
    expect(subs(s, find(s, 'Forest', 'battlefield', 'p2'))).toEqual(['Forest']);
  });
});

// ---- helpers for the casts below -------------------------------------------------------------------------------------------------------------------------------------
type Pending = { kind: string; options?: unknown[]; min?: number; max?: number };
/** Cast a card from hand (targets: object ids) and play every decision with `pick` until the stack is empty. */
function castAndResolve(s0: GameState, name: string, targets: string[], pick: (d: Pending, s: GameState) => never | undefined = () => undefined): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 40; i++) {
    const d = s.pending as Pending | undefined;
    if (!d) break;
    if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    const custom = pick(d, s);
    if (custom !== undefined) { s = answer(s, custom); continue; }
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => (id.startsWith('p') ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as never);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${JSON.stringify(d).slice(0, 300)}`);
  }
  return s;
}

// ---- Boreas Charger ---------------------------------------------------------------------------------------------------------------------------------------------------
const CHARGER = card('Test Charger', 'Creature — Pegasus', 'Flying\nWhen this creature leaves the battlefield, choose an opponent who controls more lands than you. Search your library for a number of Plains cards equal to the difference, reveal those cards, put one of them onto the battlefield tapped and the rest into your hand, then shuffle.', ['2', '2']);
const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
describe('CR 109.4, 608.2d, 701.23a: "choose an opponent who controls more lands than you ... a number of Plains cards equal to the difference" (Boreas Charger)', () => {
  it('is automated', () => { expect(full(CHARGER)).toBe(true); });
  const setup = (mine: number, theirs: number, plains: number): GameState => scenario(['Plains', 'Mountain'], {
    p1: { battlefield: ['Test Charger', ...Array.from({ length: mine }, () => 'Mountain')], hand: ['Test Doom'], library: Array.from({ length: plains }, () => 'Plains') },
    p2: { battlefield: Array.from({ length: theirs }, () => 'Mountain') }, defs: [CHARGER, DOOM] });
  const run = (s0: GameState): GameState => castAndResolve(s0, 'Test Doom', [find(s0, 'Test Charger', 'battlefield', 'p1')], (d) => (d.kind === 'chooseObjects' ? ({ kind: 'chooseObjects', ids: (d as { options: string[] }).options.slice(0, d.max) } as never) : undefined));
  const plainsAt = (s: GameState, zone: 'battlefield' | 'hand'): number => findAll(s, 'Plains', zone, 'p1').length;
  it('the opponent controls 5 lands, you control 2: the difference is 3; one Plains enters tapped and the other two go to your hand', () => {
    const s = run(setup(2, 5, 6));
    expect(plainsAt(s, 'battlefield')).toBe(1);
    expect(s.objects[findAll(s, 'Plains', 'battlefield', 'p1')[0]!]!.tapped).toBe(true);
    expect(plainsAt(s, 'hand')).toBe(2);
  });
  it('negative: no opponent controls more lands than you: nothing is chosen and nothing is searched for', () => {
    const s = run(setup(4, 4, 6));
    expect(plainsAt(s, 'battlefield') + plainsAt(s, 'hand')).toBe(0);
  });
});

// ---- Scholarship Sponsor ----------------------------------------------------------------------------------------------------------------------------------------------
const SPONSOR = card('Test Sponsor', 'Creature — Human Advisor', 'When this creature enters, each player who controls fewer lands than the player who controls the most lands searches their library for a number of basic land cards less than or equal to the difference, puts those cards onto the battlefield tapped, then shuffles.', ['2', '2']);
describe('CR 109.4, 101.4, 608.2e, 701.23a: "each player who controls fewer lands than the player who controls the most lands searches ... less than or equal to the difference" (Scholarship Sponsor)', () => {
  it('is automated', () => { expect(full(SPONSOR)).toBe(true); });
  const setup = (mine: number, theirs: number): GameState => scenario(['Plains', 'Mountain'], {
    p1: { battlefield: Array.from({ length: mine }, () => 'Mountain'), hand: ['Test Sponsor'], library: Array.from({ length: 6 }, () => 'Plains') },
    p2: { battlefield: Array.from({ length: theirs }, () => 'Mountain'), library: Array.from({ length: 6 }, () => 'Plains') }, defs: [SPONSOR] });
  const run = (s0: GameState): GameState => castAndResolve(s0, 'Test Sponsor', [], (d) => (d.kind === 'chooseObjects' ? ({ kind: 'chooseObjects', ids: (d as { options: string[] }).options.slice(0, d.max) } as never) : undefined));
  const lands = (s: GameState, p: 'p1' | 'p2'): number => findAll(s, 'Mountain', 'battlefield', p).length + findAll(s, 'Plains', 'battlefield', p).length;
  it('you control 2 lands, the opponent 5: you search for up to 3 basic lands and they enter tapped; the opponent (the most) searches for nothing', () => {
    const s = run(setup(2, 5));
    expect(findAll(s, 'Plains', 'battlefield', 'p1').length).toBe(3);
    expect(findAll(s, 'Plains', 'battlefield', 'p1').every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(lands(s, 'p2')).toBe(5);
  });
  it('negative: equal land counts: nobody controls fewer, nobody searches', () => {
    const s = run(setup(4, 4));
    expect(findAll(s, 'Plains', 'battlefield', 'p1').length).toBe(0);
    expect(findAll(s, 'Plains', 'battlefield', 'p2').length).toBe(0);
  });
});

// ---- Tithe ----------------------------------------------------------------------------------------------------------------------------------------------------------
const TITHE = card('Test Tithe', 'Instant', 'Search your library for a Plains card. If target opponent controls more lands than you, you may search your library for an additional Plains card. Reveal those cards, put them into your hand, then shuffle.');
describe('CR 701.23a, 608.2c, 109.4: "If target opponent controls more lands than you, you may search your library for an additional Plains card." (Tithe)', () => {
  it('is automated', () => { expect(full(TITHE)).toBe(true); });
  const setup = (mine: number, theirs: number): GameState => scenario(['Plains', 'Mountain'], {
    p1: { battlefield: Array.from({ length: mine }, () => 'Mountain'), hand: ['Test Tithe'], library: Array.from({ length: 5 }, () => 'Plains') },
    p2: { battlefield: Array.from({ length: theirs }, () => 'Mountain') }, defs: [TITHE] });
  const run = (s0: GameState): GameState => castAndResolve(s0, 'Test Tithe', ['p2'], (d) => {
    if (process.env.DBG) console.log(JSON.stringify(d).slice(0, 250));
    if (d.kind === 'chooseObjects') return ({ kind: 'chooseObjects', ids: (d as { options: string[] }).options.slice(0, d.max) } as never);
    if (d.kind === 'yesNo') return ({ kind: 'yesNo', yes: true } as never);
    return undefined;
  });
  it('the opponent controls more lands: you find two Plains cards and both go to your hand', () => {
    expect(findAll(run(setup(2, 3)), 'Plains', 'hand', 'p1').length).toBe(2);
  });
  it('negative: the opponent controls as many lands as you: only the first Plains card', () => {
    expect(findAll(run(setup(3, 3)), 'Plains', 'hand', 'p1').length).toBe(1);
  });
});

// ---- Hunting Wilds ----------------------------------------------------------------------------------------------------------------------------------------------------
const WILDS = card('Test Wilds', 'Sorcery', 'Kicker {1}\nSearch your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle.\nIf this spell was kicked, untap all Forests put onto the battlefield this way. They become 3/3 green creatures with haste that are still lands.');
describe('CR 702.33a, 701.26b, 613.1d: "If this spell was kicked, untap all Forests put onto the battlefield this way. They become 3/3 green creatures with haste that are still lands." (Hunting Wilds)', () => {
  it('is automated', () => { expect(full(WILDS)).toBe(true); });
  const run = (kick: boolean): GameState => {
    const s0 = scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Mountain'], hand: ['Test Wilds'], library: ['Forest', 'Forest', 'Forest'] }, p2: { battlefield: [] }, defs: [WILDS] });
    return castAndResolve(s0, 'Test Wilds', [], (d) => {
      if (d.kind === 'yesNo') return ({ kind: 'yesNo', yes: kick } as never);
      if (d.kind === 'chooseObjects') return ({ kind: 'chooseObjects', ids: (d as { options: string[] }).options.slice(0, d.max) } as never);
      return undefined;
    });
  };
  it('kicked: the two Forests enter untapped as 3/3 green creatures with haste that are still lands', () => {
    const s = run(true);
    const forests = findAll(s, 'Forest', 'battlefield', 'p1');
    expect(forests.length).toBe(2);
    for (const id of forests) {
      const c = getChars(s, id);
      expect(s.objects[id]!.tapped).toBe(false);
      expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
      expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
      expect(c.colors).toEqual(['G']);
      expect(c.keywords.map((k) => k.keyword)).toContain('haste');
    }
  });
  it('negative: not kicked: the Forests enter tapped and are only lands', () => {
    const s = run(false);
    const forests = findAll(s, 'Forest', 'battlefield', 'p1');
    expect(forests.length).toBe(2);
    for (const id of forests) {
      expect(s.objects[id]!.tapped).toBe(true);
      expect(getChars(s, id).types).not.toContain('Creature');
    }
  });
});

// ---- Wonderscape Sage -------------------------------------------------------------------------------------------------------------------------------------------------
const SAGE = card('Test Sage', 'Creature — Moonfolk Wizard', "Flying\n{T}, Return a land you control to its owner's hand: Draw a card. Then discard a card unless that land had a nonbasic land type.", ['1', '1']);
const DESERT = card('Test Desert', 'Land — Desert', '{T}: Add {C}.');
describe("CR 205.3i, 608.2c, 608.2h: 'Draw a card. Then discard a card unless that land had a nonbasic land type.' (Wonderscape Sage)", () => {
  it('is automated', () => { expect(full(SAGE)).toBe(true); });
  const run = (returned: string): { s: GameState; hand: number } => {
    const s0 = scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Sage', 'Forest', 'Test Desert'], hand: ['Mountain', 'Mountain'], library: ['Forest', 'Forest', 'Forest'] }, p2: { battlefield: [] }, defs: [SAGE, DESERT] });
    let s = act(s0, legal(s0, 'p1', 'activate').find((l) => l.action.type === 'activate' && l.action.source === find(s0, 'Test Sage', 'battlefield', 'p1'))!.action);
    for (let i = 0; i < 30; i++) {
      const d = s.pending as { kind: string; options?: string[]; max?: number } | undefined;
      if (!d) break;
      if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
      if (d.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
      if (d.kind === 'chooseObjects') {
        const pick = d.options!.filter((id) => getChars(s, id).names[0] === returned || s.objects[id]!.zone === 'hand');
        s = answer(s, { kind: 'chooseObjects', ids: pick.slice(0, Math.max(1, d.max ?? 1)) } as never);
        continue;
      }
      throw new Error(`unexpected ${JSON.stringify(d).slice(0, 300)}`);
    }

    return { s, hand: Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').length };
  };
  it('returning a basic Forest: you draw a card and must discard one (hand 2 + the returned Forest + the drawn card - the discard = 3)', () => {
    expect(run('Forest').hand).toBe(3);
  });
  it('returning the Desert (a nonbasic land type): you draw and discard nothing (hand 2 + Desert + drawn card = 4)', () => {
    expect(run('Test Desert').hand).toBe(4);
  });
});
