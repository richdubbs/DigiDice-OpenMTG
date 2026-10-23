/**
 * Card wave 2, slice s15 (std-rx12): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by
 * the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2h, 202.3        "If it's a creature card with mana value 3 or less, put it into your hand": a creature card of mana value 3 goes to the hand; one
 *                           of mana value 4, and a noncreature card of mana value 2, stay on top of the library
 *   CR 102.3, 108.4         "Draw a card for each opponent who controls an artifact": counts the opponents with an artifact on the battlefield, each counted
 *                           once (two artifacts are one opponent); an artifact you control is not counted
 *   CR 120.1, 400.7, 611.3a "~ has hexproof as long as it hasn't dealt damage yet": hexproof until the creature deals damage; it stays lost on later turns;
 *                           damage dealt to the creature does not remove it
 *   CR 107.3a, 602.2b       "X can't be 0.": the ability is not offered with no mana for X = 1; with mana it is activated with X at least 1; the base power and
 *                           toughness X/X apply to creatures you control only (CR 613.4b), until end of turn (CR 514.2)
 *   CR 122.6, 611.3a        "Each creature you control that you've put one or more +1/+1 counters on this turn has hexproof": only the creature you put a
 *                           counter on this turn, not another; not an opponent's creature; not on the next turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, passBoth, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; numbers?: number[] }
/** Answer the decisions that come up (targets, numbers, costs paid automatically) until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], numbers: [...(script.numbers ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.max });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
  return s;
};
const cast = (s: GameState, name: string, script?: Script): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const hexproof = (s: GameState, id: ObjectId): boolean => getChars(s, id).keywords.some((k) => k.keyword === 'hexproof');
const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id); return [Number(c.power), Number(c.toughness)]; };

describe('CR 608.2h, 202.3: "Reveal the top card of your library. If it\'s a creature card with mana value 3 or less, put it into your hand."', () => {
  const PEEK = card('Test Lantern Peek', 'Sorcery', "Reveal the top card of your library. If it's a creature card with mana value 3 or less, put it into your hand.");
  const BEAR3 = card('Test Ridge Bear', 'Creature — Bear', '', ['3', '3'], '{2}{G}');
  const BEAR4 = card('Test Ridge Giant', 'Creature — Giant', '', ['4', '4'], '{3}{G}');
  const TOME = card('Test Small Tome', 'Artifact', '', undefined, '{2}');
  const defs = [PEEK, BEAR3, BEAR4, TOME];
  const run = (top: string): GameState => cast(scenario([], { defs, p1: { hand: ['Test Lantern Peek'], library: [top] } }), 'Test Lantern Peek');
  it('is automated', () => expect(full(PEEK)).toBe(true));
  it('a creature card of mana value 3 is put into your hand', () => {
    const s = run('Test Ridge Bear');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Ridge Bear']);
  });
  it('a creature card of mana value 4 stays on top of the library (the comparison)', () => {
    const s = run('Test Ridge Giant');
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'library', 'p1')[0]).toBe('Test Ridge Giant');
  });
  it('a noncreature card of mana value 2 stays on top of the library (the card type)', () => {
    const s = run('Test Small Tome');
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'library', 'p1')[0]).toBe('Test Small Tome');
  });
});

describe('CR 102.3, 108.4: "Draw a card for each opponent who controls an artifact." (countPlayers.controlsIs)', () => {
  const SURVEY = card('Test Tinker Survey', 'Sorcery', 'Draw a card for each opponent who controls an artifact.');
  const COG = card('Test Brass Cog', 'Artifact', '');
  const defs = [SURVEY, COG];
  const drawn = (p2: string[], p1: string[] = []): number => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Tinker Survey'], battlefield: p1 }, p2: { battlefield: p2 } }), 'Test Tinker Survey');
    return zoneNames(s, 'hand', 'p1').length;
  };
  it('is automated', () => expect(full(SURVEY)).toBe(true));
  it('an opponent who controls an artifact is counted: one card', () => expect(drawn(['Test Brass Cog'])).toBe(1));
  it('an opponent with two artifacts is still one opponent: one card', () => expect(drawn(['Test Brass Cog', 'Test Brass Cog'])).toBe(1));
  it('an opponent with no artifact is not counted, and your own artifact is not either: no card', () => expect(drawn([], ['Test Brass Cog'])).toBe(0));
  it('"one plus the number of opponents who control an artifact" (Journey On\'s count) parses to the same quantity plus one', () => {
    const MAPS = card('Test Chart Course', 'Sorcery', 'Create X Map tokens, where X is one plus the number of opponents who control an artifact.');
    expect(full(MAPS)).toBe(true);
    expect(JSON.stringify(MAPS.faces)).toContain('"controlsIs":{"filter":{"types":["Artifact"]},"op":">=","n":1}');
  });
});

describe('CR 120.1, 400.7, 611.3a: "~ has hexproof as long as it hasn\'t dealt damage yet."', () => {
  const WARDEN = card('Test Shy Warden', 'Creature — Elemental', "This creature has hexproof as long as it hasn't dealt damage yet.\n{T}: This creature deals 1 damage to target player.", ['2', '2']);
  const SPARK = card('Test Spark Flick', 'Instant', 'Test Spark Flick deals 1 damage to target creature.');
  const defs = [WARDEN, SPARK];
  const start = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Shy Warden'], hand: ['Test Spark Flick'] } });
  const ping = (s0: GameState): GameState => {
    const w = find(s0, 'Test Shy Warden', 'battlefield', 'p1');
    return resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: w, ability: 'p:0:1' }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
  };
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('has hexproof before it has dealt damage', () => {
    const s = start();
    expect(hexproof(s, find(s, 'Test Shy Warden', 'battlefield', 'p1'))).toBe(true);
  });
  it('loses hexproof once it has dealt damage, and does not get it back on a later turn', () => {
    let s = ping(start());
    const w = find(s, 'Test Shy Warden', 'battlefield', 'p1');
    expect(hexproof(s, w)).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(hexproof(s, w)).toBe(false);
  });
  it('damage dealt TO it is not damage it dealt: it keeps hexproof', () => {
    const s = start();
    const w = find(s, 'Test Shy Warden', 'battlefield', 'p1');
    // hexproof stops only an opponent's targeting (CR 702.11b): its controller targets it
    const s2 = cast(s, 'Test Spark Flick', { targets: [[obj(w)]] });
    expect(s2.objects[w]?.damage).toBe(1);
    expect(hexproof(s2, w)).toBe(true);
  });
});

describe('CR 107.3a, 602.2b, 613.4b: "{X}: Creatures you control have base power and toughness X/X until end of turn. X can\'t be 0."', () => {
  const TIDE = card('Test Tide Caller', 'Creature — Merfolk', "{X}: Creatures you control have base power and toughness X/X until end of turn. X can't be 0. Activate only during your turn.", ['1', '1']);
  const OGRE = card('Test Hill Ogre', 'Creature — Ogre', '', ['5', '5']);
  const defs = [TIDE, OGRE];
  const start = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Tide Caller'] }, p2: { battlefield: ['Test Hill Ogre'] } });
  const offered = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => (a.action as { source?: string }).source === find(s, 'Test Tide Caller', 'battlefield', 'p1'));
  it('is automated, with xMin 1', () => {
    expect(full(TIDE)).toBe(true);
    expect(JSON.stringify(TIDE.faces)).toContain('"xMin":1');
  });
  it('with no mana the ability is not offered (X = 0 is the only payable value, and X can\'t be 0)', () => {
    expect(offered(start())).toBe(false);
  });
  it('with mana for X = 1 it is offered; X is 1 and your creatures are 1/1 until end of turn, the opponent\'s Ogre is not', () => {
    const s0 = start();
    mana(s0, 'C');
    expect(offered(s0)).toBe(true);
    const tide = find(s0, 'Test Tide Caller', 'battlefield', 'p1');
    let s = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: tide, ability: 'p:0:0' })));
    expect(pt(s, tide)).toEqual([1, 1]);
    expect(pt(s, find(s, 'Test Hill Ogre', 'battlefield', 'p2'))).toEqual([5, 5]);
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, tide)).toEqual([1, 1]); // its printed 1/1
  });
  it('with mana for X = 3 the choice starts at 1: X = 3 makes your creatures 3/3', () => {
    const s0 = start();
    mana(s0, 'C', 'C', 'C');
    const tide = find(s0, 'Test Tide Caller', 'battlefield', 'p1');
    const s1 = act(s0, { type: 'activate', player: 'p1', source: tide, ability: 'p:0:0' });
    expect(s1.pending).toMatchObject({ kind: 'chooseNumber', min: 1, max: 3 });
    const s = resolveAll(drive(s1, { numbers: [3] }));
    expect(pt(s, tide)).toEqual([3, 3]);
  });
});

describe('CR 122.6, 611.3a: "Each creature you control that you\'ve put one or more +1/+1 counters on this turn has hexproof."', () => {
  const MENTOR = card('Test Ward Mentor', 'Creature — Human', "Each creature you control that you've put one or more +1/+1 counters on this turn has hexproof.", ['1', '1']);
  const BOOST = card('Test Quick Boost', 'Instant', 'Put a +1/+1 counter on target creature.');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [MENTOR, BOOST, BEAR];
  it('is automated', () => expect(full(MENTOR)).toBe(true));
  it('the creature you put a counter on this turn has hexproof; another creature you control does not; not on the next turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Ward Mentor', 'Test Grove Bear'], hand: ['Test Quick Boost'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    const mentor = find(s0, 'Test Ward Mentor', 'battlefield', 'p1');
    expect(hexproof(s0, bear)).toBe(false);
    let s = cast(s0, 'Test Quick Boost', { targets: [[obj(bear)]] });
    expect(s.objects[bear]?.counters['+1/+1']).toBe(1);
    expect(hexproof(s, bear)).toBe(true);
    expect(hexproof(s, mentor)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(hexproof(s, bear)).toBe(false); // the counter is still on it, but it was put there last turn
  });
  it('an opponent\'s creature you put a counter on is not a creature you control: no hexproof', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Ward Mentor'], hand: ['Test Quick Boost'] }, p2: { battlefield: ['Test Grove Bear'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Quick Boost', { targets: [[obj(bear)]] });
    expect(s.objects[bear]?.counters['+1/+1']).toBe(1);
    expect(hexproof(s, bear)).toBe(false);
  });
});
