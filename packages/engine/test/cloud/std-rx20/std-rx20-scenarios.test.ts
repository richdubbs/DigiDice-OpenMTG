/**
 * Card wave 2, Commander lane rx20 (std-rx20): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.23a, 107.3       "Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.": with X = 2 only an
 *                           artifact card of mana value 2 or less can be found (not one of mana value 3, not a creature card)
 *   CR 110.4, 701.23a       "Search your library for a permanent card, ...": a land or creature card can be found, an instant card cannot
 *   CR 614.1c, 614.12       "If you control two or more other lands, ~ enters tapped.": with one other land it enters untapped, with two it enters tapped
 *   CR 701.22a, 107.3       "Scry X, where X is the number of artifacts you control.": the scry looks at as many cards as you control artifacts
 *   CR 120.3, 608.2c, 615.1 "~ deals 3 damage to target creature. You gain life equal to the damage dealt this way.": 3 life; damage that was prevented was not
 *                           dealt, so no life
 *   CR 102.3, 608.2h        "Create a 1/1 ... token for each opponent you have.": one token in a two-player game
 *   CR 106.4, 608.2c        "At the beginning of each player's upkeep, that player adds {R}{R}.": the mana goes to the player whose upkeep it is, not to you
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, isTapped, life, passBoth, pool, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; numbers?: number[]; picks?: ((options: ObjectId[], s: GameState) => ObjectId[])[] }
/** The options of every chooseObjects decision met, in order (what a search or a scry offered). */
let seen: ObjectId[][] = [];
/** Answer the decisions that come up (targets, numbers, costs paid automatically) until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], numbers: [...(script.numbers ?? [])], picks: [...(script.picks ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.max });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'chooseObjects') {
      seen.push([...p.options]);
      const pick = q.picks.shift();
      s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options, s) : p.options.slice(0, p.min) });
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script?: Script): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const cast = (s: GameState, name: string, script?: Script): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script), script);
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId).sort();

describe('CR 701.23a, 107.3: "Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle."', () => {
  const TINKER = card('Test Gear Call', 'Sorcery', 'Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.', undefined, '{X}');
  const COG2 = card('Test Two Cog', 'Artifact', '', undefined, '{2}');
  const COG3 = card('Test Three Cog', 'Artifact', '', undefined, '{3}');
  const BEAR = card('Test Low Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
  const defs = [TINKER, COG2, COG3, BEAR];
  it('is automated', () => expect(full(TINKER)).toBe(true));
  it('with X = 2 only an artifact card of mana value 2 or less can be found, and it is put onto the battlefield under your control', () => {
    seen = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Gear Call'], library: ['Test Two Cog', 'Test Three Cog', 'Test Low Bear'] } });
    mana(s0, 'C', 'C');
    const s = cast(s0, 'Test Gear Call', { numbers: [2], picks: [(o) => o.slice(0, 1)] });
    const searched = seen.find((o) => o.length > 0) ?? [];
    expect(names(s0, searched)).toEqual(['Test Two Cog']);
    expect(battlefieldNames(s, 'p1')).toContain('Test Two Cog');
  });
  it('with X = 3 the artifact card of mana value 3 can be found too, never the creature card', () => {
    seen = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Gear Call'], library: ['Test Two Cog', 'Test Three Cog', 'Test Low Bear'] } });
    mana(s0, 'C', 'C', 'C');
    cast(s0, 'Test Gear Call', { numbers: [3] });
    const searched = seen.find((o) => o.length > 0) ?? [];
    expect(names(s0, searched)).toEqual(['Test Three Cog', 'Test Two Cog']);
  });
});

describe('CR 110.4, 701.23a: "Search your library for a permanent card, put it onto the battlefield, then shuffle."', () => {
  const BRIDGE = card('Test Plane Gate', 'Sorcery', 'Search your library for a permanent card, put it onto the battlefield, then shuffle.');
  const BEAR = card('Test Gate Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
  const ZAP = card('Test Gate Zap', 'Instant', 'Test Gate Zap deals 1 damage to any target.', undefined, '{R}');
  const defs = [BRIDGE, BEAR, ZAP];
  it('is automated', () => expect(full(BRIDGE)).toBe(true));
  it('a creature card or a land card can be found, an instant card cannot', () => {
    seen = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Plane Gate'], library: ['Test Gate Bear', 'Test Gate Zap', 'Plains'] } });
    cast(s0, 'Test Plane Gate');
    const searched = seen.find((o) => o.length > 0) ?? [];
    expect([...new Set(names(s0, searched))]).toEqual(['Plains', 'Test Gate Bear']); // the deck's Plains and the creature card, not the instant card
  });
});

describe('CR 614.1c, 614.12: "If you control two or more other lands, ~ enters tapped."', () => {
  const DEN = card('Test Frost Den', 'Land', 'If you control two or more other lands, this land enters tapped.\n{T}: Add {U}.');
  const play = (others: number): boolean => {
    const s0 = scenario([], { defs: [DEN], p1: { hand: ['Test Frost Den'], battlefield: Array(others).fill('Plains') as string[] } });
    const s = drive(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Frost Den', 'hand', 'p1') }));
    return isTapped(s, find(s, 'Test Frost Den', 'battlefield', 'p1'));
  };
  it('is automated', () => expect(full(DEN)).toBe(true));
  it('with one other land it enters untapped', () => expect(play(1)).toBe(false));
  it('with no other land it enters untapped (the land itself is not "other")', () => expect(play(0)).toBe(false));
  it('with two other lands it enters tapped', () => expect(play(2)).toBe(true));
});

describe('CR 701.22a, 107.3: "Scry X, where X is the number of artifacts you control."', () => {
  const GAZE = card('Test Cog Gaze', 'Sorcery', 'Scry X, where X is the number of artifacts you control.');
  const COG = card('Test Gaze Cog', 'Artifact', '', undefined, '{1}');
  const defs = [GAZE, COG];
  const looked = (cogs: number, opp: number): number => {
    seen = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Cog Gaze'], battlefield: Array(cogs).fill('Test Gaze Cog') as string[] }, p2: { battlefield: Array(opp).fill('Test Gaze Cog') as string[] } });
    cast(s0, 'Test Cog Gaze');
    return seen[0]?.length ?? 0;
  };
  it('is automated', () => expect(full(GAZE)).toBe(true));
  it('with two artifacts it looks at the top two cards', () => expect(looked(2, 0)).toBe(2));
  it("an opponent's artifacts are not counted: one artifact of yours, one card", () => expect(looked(1, 3)).toBe(1));
});

describe('CR 120.3, 608.2c, 615.1: "~ deals 3 damage to target creature or player. You gain life equal to the damage dealt this way."', () => {
  const DRAIN = card('Test Sap Drain', 'Sorcery', 'Test Sap Drain deals 3 damage to any target. You gain life equal to the damage dealt this way.');
  const WOLF = card('Test Sap Wolf', 'Creature — Wolf', '', ['4', '4']);
  const SHIELD = card('Test Sap Shield', 'Enchantment', 'Prevent all damage that would be dealt to creatures you control.');
  const defs = [DRAIN, WOLF, SHIELD];
  it('is automated', () => expect(full(DRAIN)).toBe(true));
  it('3 damage dealt to an opponent: you gain 3 life', () => {
    const s0 = scenario([], { defs, life: 20, p1: { hand: ['Test Sap Drain'] } });
    const s = cast(s0, 'Test Sap Drain', { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(23);
  });
  it('3 damage dealt to a creature with toughness 4: you gain 3 life', () => {
    const s0 = scenario([], { defs, life: 20, p1: { hand: ['Test Sap Drain'] }, p2: { battlefield: ['Test Sap Wolf'] } });
    const s = cast(s0, 'Test Sap Drain', { targets: [[{ kind: 'object', id: find(s0, 'Test Sap Wolf', 'battlefield', 'p2') }]] });
    expect(life(s, 'p1')).toBe(23);
  });
  it('the damage to the creature is prevented: none was dealt, you gain no life', () => {
    const s0 = scenario([], { defs, life: 20, p1: { hand: ['Test Sap Drain'] }, p2: { battlefield: ['Test Sap Wolf', 'Test Sap Shield'] } });
    const s = cast(s0, 'Test Sap Drain', { targets: [[{ kind: 'object', id: find(s0, 'Test Sap Wolf', 'battlefield', 'p2') }]] });
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 102.3, 608.2h: "Create a 1/1 black Rat creature token for each opponent you have."', () => {
  const RATS = card('Test Rat Call', 'Sorcery', 'Create a 1/1 black Rat creature token for each opponent you have.');
  it('is automated', () => expect(full(RATS)).toBe(true));
  it('one token in a two-player game (you are not your own opponent)', () => {
    const s0 = scenario([], { defs: [RATS], p1: { hand: ['Test Rat Call'] } });
    const s = cast(s0, 'Test Rat Call');
    expect(battlefieldNames(s, 'p1').length - battlefieldNames(s0, 'p1').length).toBe(1);
    expect(battlefieldNames(s, 'p2')).toEqual([]);
  });
});

describe('CR 106.4, 608.2c: "At the beginning of each player\'s upkeep, that player adds {R}{R}."', () => {
  const FONT = card('Test Ember Font', 'Enchantment', "At the beginning of each player's upkeep, that player adds {R}{R}.");
  it('is automated', () => expect(full(FONT)).toBe(true));
  it("on the opponent's upkeep the opponent gets the mana, you do not", () => {
    let s = scenario([], { defs: [FONT], p1: { battlefield: ['Test Ember Font'] } });
    s = advanceTo(s, 2, 'upkeep');
    s = resolveAll(drive(s));
    expect(s.turn.step).toBe('upkeep');
    expect(pool(s, 'p2')).toBe('RR');
    expect(pool(s, 'p1')).toBe('');
  });
});
