/**
 * Coordinator D, round edh-d-37 (lane lands): the round's readings and engine changes played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites are from memory (no rules/cr in a cloud session) and listed as unverified in the round's record.
 *
 *   CR 701.8a, 608.2c, 608.2h, 701.23a   "Destroy all nonbasic lands. For each land destroyed this way, its controller may search ..." (From the Ashes)
 *   CR 701.21a, 608.2c, 608.2h           "Each player sacrifices all artifacts, enchantments, and nonbasic lands they control. For each land sacrificed this way, ..." (Wave of Vitriol)
 *   CR 406.2, 400.7                      "Exile all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands." (Decree of Annihilation)
 *   CR 603.4, 305.1, 400.7               "if that player had another land enter the battlefield under their control this turn" (Tunnel Ignus, Confounding Conundrum)
 *   CR 102.3, 608.2h                     "the number of players who control at least two more lands than you" (Surveyor's Scope)
 *   CR 603.2, 608.3a                     "Whenever a player puts a nontoken creature onto the battlefield, that player returns a land they control ..." (Overburden)
 *   CR 613.1d, 205.1b                    "Those lands become 4/4 Elemental creatures with trample. They're still lands." (Nissa, Worldwaker)
 *   CR 701.8a, 701.23a                   "If a land was destroyed this way, its controller may search ... up to two ... Otherwise ..." (Dire-Strain Rampage)
 *   CR 305.6, 105.1, 104.2b              "You win the game if you control a land of each basic land type and a creature of each color." (Coalition Victory)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: opts.cost ?? '{0}', colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const bf = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();

/** Answer every pending decision the way `answers` says (yes to a "may" unless 'no'; the first options of a choice) until priority returns with an empty stack. */
function settle(s0: GameState, opts: { may?: 'yes' | 'no'; pick?: (options: ObjectId[], min: number, max: number, s: GameState) => ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && !s.result && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending;
    if (p && p.kind !== 'priority') {
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: opts.may !== 'no' });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') {
        const ids = opts.pick ? opts.pick(p.options, p.min, p.max, s) : p.options.slice(0, Math.max(p.min, Math.min(p.max, p.options.length)));
        s = answer(s, { kind: 'chooseObjects', ids });
      } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj((p as unknown as { objects: ObjectId[] }).objects[0]!)] });
      else throw new Error(`unexpected decision ${p.kind}`);
    } else s = pass(s);
  }
  return s;
}
/** Cast a card of `player` and answer its decisions (targets by `pick`, payment automatic) until it is on the stack. */
function castWith(s0: GameState, name: string, player: 'p1' | 'p2', pick: (offered: ObjectId[]) => TargetChoice[] = () => []): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick(s.pending.objects) });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

const BASICS = ['Island', 'Swamp', 'Mountain', 'Forest'];
const SHRINE = card('Test Shrine', 'Land', '{T}: Add {C}.');
const CHAPEL = card('Test Chapel', 'Land — Plains Island', '{T}: Add {W} or {U}.');
const TRINKET = card('Test Trinket', 'Artifact', '');
const IDOL = card('Test Idol', 'Enchantment', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'] });
const COMMON = [SHRINE, CHAPEL, TRINKET, IDOL, BEAR, GOLEM];

const ASHES = card('Test Ashes', 'Sorcery', 'Destroy all nonbasic lands. For each land destroyed this way, its controller may search their library for a basic land card and put it onto the battlefield. Then each player who searched their library this way shuffles.');
const FLOOD = card('Test Flood', 'Sorcery', 'Each player sacrifices all artifacts, enchantments, and nonbasic lands they control. For each land sacrificed this way, its controller may search their library for a basic land card and put it onto the battlefield tapped. Then each player who searched their library this way shuffles.');
const WIPE = card('Test Wipe', 'Sorcery', 'Exile all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands.');

describe('the synthetic cards are automated', () => {
  it('every card of this file compiles to full automation', () => {
    for (const d of [ASHES, FLOOD, WIPE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.8a, 608.2c, 608.2h, 701.23a: "For each land destroyed this way, its controller may search ..." (From the Ashes)', () => {
  const start = () => scenario(BASICS, {
    p1: { hand: ['Test Ashes'], battlefield: ['Test Shrine', 'Plains'], library: ['Forest', 'Forest'] },
    p2: { battlefield: ['Test Shrine', 'Test Chapel', 'Island'], library: ['Swamp', 'Swamp', 'Swamp'] },
    defs: [...COMMON, ASHES],
  });
  it('every nonbasic land is destroyed and each of its controllers finds one basic land for each (two for the player who lost two)', () => {
    const s = settle(castWith(start(), 'Test Ashes', 'p1'));
    expect(bf(s, 'p1')).toEqual(['Forest', 'Plains']);
    expect(bf(s, 'p2')).toEqual(['Island', 'Swamp', 'Swamp']);
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Test Chapel', 'Test Shrine']);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Shrine');
  });
  it('negative: a player who declines searches for nothing, and a basic land is never destroyed', () => {
    const s = settle(castWith(start(), 'Test Ashes', 'p1'), { may: 'no' });
    expect(bf(s, 'p1')).toEqual(['Plains']);
    expect(bf(s, 'p2')).toEqual(['Island']);
  });
});

describe('CR 701.21a, 608.2c, 608.2h: "For each land sacrificed this way, its controller may search ..." (Wave of Vitriol)', () => {
  const start = () => scenario(BASICS, {
    p1: { hand: ['Test Flood'], battlefield: ['Test Shrine', 'Test Trinket', 'Test Idol', 'Plains'], library: ['Forest', 'Forest'] },
    p2: { battlefield: ['Test Trinket', 'Test Shrine', 'Test Chapel', 'Island'], library: ['Forest', 'Forest', 'Forest'] },
    defs: [...COMMON, FLOOD],
  });
  it('the artifacts, enchantments and nonbasic lands are sacrificed; a basic land arrives tapped for each land only, never for an artifact or an enchantment', () => {
    const s = settle(castWith(start(), 'Test Flood', 'p1'));
    expect(bf(s, 'p1')).toEqual(['Forest', 'Plains']);
    expect(bf(s, 'p2')).toEqual(['Forest', 'Forest', 'Island']);
    for (const id of findAll(s, 'Forest', 'battlefield')) expect(s.objects[id]!.tapped, 'entered tapped').toBe(true);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Flood', 'Test Idol', 'Test Shrine', 'Test Trinket']);
  });
  it('negative: with no nonbasic land nobody searches', () => {
    const s0 = scenario(BASICS, { p1: { hand: ['Test Flood'], battlefield: ['Test Trinket', 'Plains'], library: ['Forest'] }, p2: { battlefield: ['Island'], library: ['Forest'] }, defs: [...COMMON, FLOOD] });
    const s = settle(castWith(s0, 'Test Flood', 'p1'));
    expect(bf(s, 'p1')).toEqual(['Plains']);
    expect(bf(s, 'p2')).toEqual(['Island']);
  });
});

describe('CR 406.2, 400.7: "Exile all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands." (Decree of Annihilation)', () => {
  const start = () => scenario(BASICS, {
    p1: { hand: ['Test Wipe', 'Test Bear'], graveyard: ['Test Trinket'], battlefield: ['Test Golem', 'Test Idol', 'Plains'] },
    p2: { hand: ['Test Chapel'], graveyard: ['Test Bear'], battlefield: ['Test Bear', 'Test Shrine'] },
    defs: [...COMMON, WIPE],
  });
  it('exiles the artifact creature, the creature, the lands, every graveyard card and every hand card; the enchantment stays', () => {
    const s = settle(castWith(start(), 'Test Wipe', 'p1'));
    expect(bf(s, 'p1')).toEqual(['Test Idol']);
    expect(bf(s, 'p2')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Wipe']);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p2')).toEqual([]);
    expect(exileNames(s)).toEqual(['Test Bear', 'Test Bear', 'Test Bear', 'Test Chapel', 'Test Golem', 'Test Shrine', 'Test Trinket', 'Plains'].sort());
  });
});

const IGNUS = card('Test Ignus', 'Creature — Elemental', 'Whenever a land enters under an opponent\'s control, if that player had another land enter the battlefield under their control this turn, ~ deals 3 damage to that player.', { pt: ['2', '2'] });
const CONUNDRUM = card('Test Conundrum', 'Enchantment', 'Whenever a land an opponent controls enters, if that player had another land enter the battlefield under their control this turn, they return a land they control to its owner\'s hand.');
const FETCH = card('Test Fetch', 'Instant', 'Search your library for a basic land card and put it onto the battlefield.');
const TWIN = card('Test Twin Fetch', 'Instant', 'Search your library for up to two basic land cards and put them onto the battlefield.');
const MY_FETCH = card('Test Own Fetch', 'Instant', 'Search your library for a basic land card and put it onto the battlefield.');

describe('CR 603.4, 305.1: "if that player had another land enter the battlefield under their control this turn" (Tunnel Ignus, Confounding Conundrum)', () => {
  it('are automated', () => { expect(full(IGNUS)).toBe(true); expect(full(CONUNDRUM)).toBe(true); });
  /** p1 passes priority so p2 may cast instants; p2 casts each given instant in turn (p1 passes back). */
  const p2Casts = (s0: GameState, names: string[]): GameState => {
    let s = s0;
    for (const n of names) {
      s = pass(s); // p1 passes: p2 gets priority
      s = settle(castWith(s, n, 'p2'));
    }
    return s;
  };
  it('Ignus: the first land an opponent has enter this turn is free, the second costs them 3 life, and a land under its own controller never does', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Ignus'], hand: ['Test Own Fetch'], library: ['Forest', 'Forest'] }, p2: { hand: ['Test Fetch', 'Test Fetch'], library: ['Forest', 'Forest', 'Forest'] }, defs: [...COMMON, IGNUS, FETCH, MY_FETCH] });
    let s = p2Casts(s0, ['Test Fetch']);
    expect(lifeOf(s, 'p2')).toBe(20);
    s = p2Casts(s, ['Test Fetch']);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('Ignus: two lands entering at once (a twin search) trigger it for each land, as the ruling says', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Ignus'] }, p2: { hand: ['Test Twin Fetch'], library: ['Forest', 'Forest', 'Forest'] }, defs: [...COMMON, IGNUS, TWIN] });
    const s = p2Casts(s0, ['Test Twin Fetch']);
    expect(lifeOf(s, 'p2')).toBe(14);
  });
  it('Ignus negative: the controller\'s own lands (any number) never hurt them, and a creature entering does not count as a land', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Ignus'], hand: ['Test Own Fetch', 'Test Own Fetch'], library: ['Forest', 'Forest'] }, defs: [...COMMON, IGNUS, MY_FETCH] });
    let s = settle(castWith(s0, 'Test Own Fetch', 'p1'));
    s = settle(castWith(s, 'Test Own Fetch', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('Conundrum: the second land of an opponent sends one of their lands back to their hand (their choice); the first does not', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Conundrum'] }, p2: { hand: ['Test Fetch', 'Test Fetch'], library: ['Forest', 'Forest', 'Forest'], battlefield: ['Test Shrine'] }, defs: [...COMMON, CONUNDRUM, FETCH] });
    let s = p2Casts(s0, ['Test Fetch']);
    expect(bf(s, 'p2')).toEqual(['Forest', 'Test Shrine']);
    s = p2Casts(s, ['Test Fetch']);
    expect(bf(s, 'p2').length).toBe(2); // three lands, one returned to its owner's hand
    expect(zoneNames(s, 'hand', 'p2').filter((n) => n !== 'Test Fetch').length).toBe(1);
    expect(bf(s, 'p1')).toEqual(['Test Conundrum']);
  });
});

const SCOPE = card('Test Scope', 'Artifact', '{T}, Exile this artifact: Search your library for up to X basic land cards, where X is the number of players who control at least two more lands than you. Put those cards onto the battlefield, then shuffle.');
describe('CR 102.3, 608.2h: "the number of players who control at least two more lands than you" (Surveyor\'s Scope)', () => {
  it('is automated', () => expect(full(SCOPE)).toBe(true));
  const play = (mine: number, theirs: number): GameState => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Scope', ...Array(mine).fill('Plains') as string[]], library: ['Forest', 'Forest', 'Forest'] }, p2: { battlefield: Array(theirs).fill('Island') as string[] }, defs: [...COMMON, SCOPE] });
    const id = find(s0, 'Test Scope', 'battlefield');
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    s = settle(s);
    return s;
  };
  it('an opponent with two more lands than you gives X = 1: one basic land arrives', () => {
    const s = play(3, 5);
    expect(findAll(s, 'Forest', 'battlefield').length).toBe(1);
    expect(findAll(s, 'Test Scope', 'battlefield').length).toBe(0);
  });
  it('negative: an opponent with only one more land than you gives X = 0 (the Scope is still exiled)', () => {
    const s = play(3, 4);
    expect(findAll(s, 'Forest', 'battlefield').length).toBe(0);
    expect(findAll(s, 'Test Scope', 'battlefield').length).toBe(0);
  });
});

const BURDEN = card('Test Burden', 'Enchantment', 'Whenever a player puts a nontoken creature onto the battlefield, that player returns a land they control to its owner\'s hand.');
const TOKENMAKER = card('Test Muster', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const RAISE = card('Test Raise', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control.');
describe('CR 603.2, 608.3a: "Whenever a player puts a nontoken creature onto the battlefield, that player returns a land they control to its owner\'s hand." (Overburden)', () => {
  it('is automated', () => expect(full(BURDEN)).toBe(true));
  it('the player whose creature enters returns one of their own lands; a token does not trigger it', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Burden', 'Plains', 'Plains'], hand: ['Test Bear', 'Test Muster'] }, defs: [...COMMON, BURDEN, TOKENMAKER] });
    let s = settle(castWith(s0, 'Test Muster', 'p1'));
    expect(bf(s, 'p1').filter((n) => n === 'Plains').length).toBe(2);
    s = settle(castWith(s, 'Test Bear', 'p1'));
    expect(bf(s, 'p1').filter((n) => n === 'Plains').length).toBe(1);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Plains');
  });
  it('a creature that enters under your control from another player\'s graveyard makes YOU return a land (the player who puts it onto the battlefield), not its owner', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Burden', 'Plains', 'Plains'], hand: ['Test Raise'] }, p2: { graveyard: ['Test Bear'], battlefield: ['Island', 'Island'] }, defs: [...COMMON, BURDEN, RAISE] });
    const s = settle(castWith(s0, 'Test Raise', 'p1', (o) => [obj(o[0]!)]));
    expect(bf(s, 'p1').filter((n) => n === 'Plains').length).toBe(1);
    expect(bf(s, 'p2').filter((n) => n === 'Island').length).toBe(2);
  });
  it('negative: a land entering does not trigger it', () => {
    const s0 = scenario(BASICS, { p1: { battlefield: ['Test Burden', 'Plains'], hand: ['Test Own Fetch'], library: ['Forest'] }, defs: [...COMMON, BURDEN, MY_FETCH] });
    const s = settle(castWith(s0, 'Test Own Fetch', 'p1'));
    expect(bf(s, 'p1')).toEqual(['Forest', 'Plains', 'Test Burden']);
  });
});

const WORLDWAKE = card('Test Worldwake', 'Sorcery', 'Search your library for any number of basic land cards, put them onto the battlefield, then shuffle. Those lands become 4/4 Elemental creatures with trample. They\'re still lands.');
describe('CR 613.1d, 205.1b: "Those lands become 4/4 Elemental creatures with trample. They\'re still lands." (Nissa, Worldwaker)', () => {
  it('is automated', () => expect(full(WORLDWAKE)).toBe(true));
  it('the lands that were put onto the battlefield are 4/4 Elemental land creatures with trample for good; the lands already there are not', () => {
    const s0 = scenario(BASICS, { p1: { hand: ['Test Worldwake'], battlefield: ['Plains'], library: ['Forest', 'Forest'] }, defs: [...COMMON, WORLDWAKE] });
    const s = settle(castWith(s0, 'Test Worldwake', 'p1'));
    const forests = findAll(s, 'Forest', 'battlefield');
    expect(forests.length).toBe(2);
    for (const id of forests) {
      const c = getChars(s, id);
      expect([...c.types].sort()).toEqual(['Creature', 'Land']);
      expect(c.subtypes).toContain('Elemental');
      expect(c.subtypes).toContain('Forest');
      expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
      expect(c.keywords?.map?.((k: unknown) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword)) ?? []).toContain('trample');
    }
    const plains = getChars(s, find(s, 'Plains', 'battlefield', 'p1'));
    expect([...plains.types]).toEqual(['Land']);
  });
});

const RAMPAGE = card('Test Rampage', 'Sorcery', 'Destroy target artifact, enchantment, or land. If a land was destroyed this way, its controller may search their library for up to two basic land cards, put them onto the battlefield tapped, then shuffle. Otherwise, its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.');
describe('CR 701.8a, 701.23a: "If a land was destroyed this way, its controller may search ... up to two ... Otherwise, ..." (Dire-Strain Rampage)', () => {
  it('is automated', () => expect(full(RAMPAGE)).toBe(true));
  const start = () => scenario(BASICS, { p1: { hand: ['Test Rampage'] }, p2: { battlefield: ['Test Shrine', 'Test Trinket'], library: ['Forest', 'Forest', 'Forest'] }, defs: [...COMMON, RAMPAGE] });
  it('destroying a land: its controller (not the caster) may search for up to two basic lands, which enter tapped', () => {
    const s0 = start();
    const shrine = find(s0, 'Test Shrine', 'battlefield');
    const s = settle(castWith(s0, 'Test Rampage', 'p1', () => [obj(shrine)]));
    expect(bf(s, 'p2')).toEqual(['Forest', 'Forest', 'Test Trinket']);
    for (const id of findAll(s, 'Forest', 'battlefield')) expect(s.objects[id]!.tapped).toBe(true);
    expect(bf(s, 'p1')).toEqual([]);
  });
  it('destroying a nonland permanent: its controller may search for ONE basic land', () => {
    const s0 = start();
    const trinket = find(s0, 'Test Trinket', 'battlefield');
    const s = settle(castWith(s0, 'Test Rampage', 'p1', () => [obj(trinket)]));
    expect(bf(s, 'p2')).toEqual(['Forest', 'Test Shrine']);
  });
  it('negative: declining the search finds nothing', () => {
    const s0 = start();
    const shrine = find(s0, 'Test Shrine', 'battlefield');
    const s = settle(castWith(s0, 'Test Rampage', 'p1', () => [obj(shrine)]), { may: 'no' });
    expect(bf(s, 'p2')).toEqual(['Test Trinket']);
  });
});

const VICTORY = card('Test Victory', 'Sorcery', 'You win the game if you control a land of each basic land type and a creature of each color.');
const RAINBOW = ['W', 'U', 'B', 'R', 'G'].map((c, i) => card(`Test Hue ${i}`, 'Creature — Spirit', '', { pt: ['1', '1'], colors: [c] }));
describe('CR 305.6, 105.1, 104.2b: "You win the game if you control a land of each basic land type and a creature of each color." (Coalition Victory)', () => {
  it('is automated', () => expect(full(VICTORY)).toBe(true));
  const start = (lands: string[], creatures: string[]) => scenario(BASICS, { p1: { hand: ['Test Victory'], battlefield: [...lands, ...creatures] }, defs: [...COMMON, ...RAINBOW, VICTORY] });
  it('wins with five basic land types (one dual land counts for two) and five colors of creatures', () => {
    const s = settle(castWith(start(['Test Chapel', 'Swamp', 'Mountain', 'Forest'], RAINBOW.map((d) => d.name)), 'Test Victory', 'p1'));
    expect(s.result?.winner).toBe('p1');
  });
  it('negative: four basic land types, or four colors, do not win', () => {
    const a = settle(castWith(start(['Plains', 'Island', 'Swamp', 'Mountain'], RAINBOW.map((d) => d.name)), 'Test Victory', 'p1'));
    expect(a.result).toBeFalsy();
    const b = settle(castWith(start(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'], RAINBOW.slice(0, 4).map((d) => d.name)), 'Test Victory', 'p1'));
    expect(b.result).toBeFalsy();
  });
  it('negative: the opponent\'s lands and creatures are not yours', () => {
    const s0 = scenario(BASICS, { p1: { hand: ['Test Victory'], battlefield: ['Plains'] }, p2: { battlefield: ['Island', 'Swamp', 'Mountain', 'Forest', ...RAINBOW.map((d) => d.name)] }, defs: [...COMMON, ...RAINBOW, VICTORY] });
    expect(settle(castWith(s0, 'Test Victory', 'p1')).result).toBeFalsy();
  });
});
