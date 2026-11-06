/**
 * Top-rank part 6 (EDHREC ranks 12,001-13,500), round edh-next-90: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks, with its negative case. The Comprehensive Rules were fetched from the 2026-09-25 text for the round (see the record).
 *
 *   CR 701.21a, 118.3, 602.2b       "{G}, {T}, Sacrifice this creature and another green creature: Search ..." (Magus of the Order)
 *   CR 701.9a, 118.3, 201.2         "{1}{U}{U}, Discard three cards with different names: Draw five cards." (Ormos, Archive Keeper)
 *   CR 701.9a, 603.1, 603.12        "When you discard this card, you may pay {B}. When you do, return target creature card ..." (Edgar's Awakening)
 *   CR 701.23a, 614.15, 608.2c      "Search ..., put it into your hand, then shuffle. You may put that card onto the battlefield instead of putting it into your hand if a creature died this turn." (Caravan Vigil)
 *   CR 702.61a, 702.33d             "If this spell was kicked, it has split second." (Molten Disaster)
 *   CR 702.29a, 702.29f             "return any number of target permanent cards with cycling abilities from your graveyard to the battlefield" (Herald of the Forgotten)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, pool, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; yes/no from `yes` in order, then `yes`; picks: the first allowed, or the named cards). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean[]; pick?: string[]; x?: number; color?: 'R' | 'G' | 'W' | 'U' | 'B'; players?: PlayerId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  const yes = [...(o.yes ?? [])];
  const pick = [...(o.pick ?? [])];
  const nameOf = (id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const d = p as unknown as { players: PlayerId[]; objects: ObjectId[]; min: number };
      const obs = targets.filter((x) => d.objects.includes(x));
      if (obs.length > 0) { for (const ob of obs) targets.splice(targets.indexOf(ob), 1); s = answer(s, { kind: 'chooseTargets', targets: obs.map((id) => ({ kind: 'object' as const, id })) }); }
      else if ((o.players ?? []).some((x) => d.players.includes(x))) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: (o.players ?? []).find((x) => d.players.includes(x))! }] });
      else s = answer(s, { kind: 'chooseTargets', targets: d.min === 0 ? [] : d.players.length > 0 ? [{ kind: 'player', id: d.players[0]! }] : [{ kind: 'object', id: d.objects[0]! }] });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') {
      // (one object per named card, in the order of the names; the first allowed ones when no name is given)
      const named = pick.map((n) => p.options.find((id) => nameOf(id) === n)).filter((x): x is ObjectId => x !== undefined);
      const want = pick.length > 0 && named.length > 0 ? named.slice(0, p.max) : p.options.slice(0, p.max);
      s = answer(s, { kind: 'chooseObjects', ids: want });
    }
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: o.color ?? p.options[0]! });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes.length > 0 ? yes.shift()! : true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => chars(s, id).name).sort();
const bf = (s: GameState, p?: PlayerId): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => chars(s, id).name).sort();
const gy = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => chars(s, id).name).sort();
const lib = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const castC = (s: GameState, name: string, p: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player: p, card: find(s, name, 'hand', p) });
const activate = (s: GameState, name: string, p: PlayerId = 'p1'): GameState => {
  const a = legal(s, p, 'activate').find((x) => x.label.startsWith(`${name}:`));
  if (!a) throw new Error(`no activation of ${name}`);
  return act(s, a.action);
};
const canActivate = (s: GameState, name: string, p: PlayerId = 'p1'): boolean => legal(s, p, 'activate').some((x) => x.label.startsWith(`${name}:`));

const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
const ISLAND = card('Test Island', 'Basic Land — Island', '{T}: Add {U}.');
const SWAMP = card('Test Swamp', 'Basic Land — Swamp', '{T}: Add {B}.');
const MOUNTAIN = card('Test Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['W'] });

// ---- Magus of the Order -----------------------------------------------------------------------------------------------------------------------------------------------
const MAGUS = card('Test Magus', 'Creature — Human Wizard', '{G}, {T}, Sacrifice this creature and another green creature: Search your library for a green creature card, put it onto the battlefield, then shuffle.', { pt: ['2', '2'], cost: '{2}{G}{G}', colors: ['G'] });
const TITAN = card('Test Green Titan', 'Creature — Giant', '', { pt: ['5', '5'], colors: ['G'] });
describe('CR 701.21a, 118.3: "Sacrifice this creature and another green creature" is a cost of two permanents', () => {
  const defs = [MAGUS, ELF, BEAR, FOREST, TITAN];
  it('is fully automated', () => { expect(noManual(MAGUS) && MAGUS.automation.level === 'full').toBe(true); });
  it('with another green creature: both are sacrificed and the found green creature enters', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Magus', 'Test Elf', 'Test Forest'], library: ['Test Green Titan'] } });
    const s = resolveAll(activate(s0, 'Test Magus'));
    expect(bf(s, 'p1')).toEqual(['Test Forest', 'Test Green Titan']);
    expect(gy(s, 'p1')).toEqual(['Test Elf', 'Test Magus']);
  });
  it('the negative cases: no other creature, or another creature that is not green, leaves the ability unavailable (the source is never the "another" creature)', () => {
    const alone = scenario([], { defs, p1: { battlefield: ['Test Magus', 'Test Forest'], library: ['Test Green Titan'] } });
    expect(canActivate(alone, 'Test Magus')).toBe(false);
    const white = scenario([], { defs, p1: { battlefield: ['Test Magus', 'Test Plain Bear', 'Test Forest'], library: ['Test Green Titan'] } });
    expect(canActivate(white, 'Test Magus')).toBe(false);
  });
  it('an opponent\'s green creature is not a cost the controller can pay with', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Magus', 'Test Forest'] }, p2: { battlefield: ['Test Elf'] } });
    expect(canActivate(s0, 'Test Magus')).toBe(false);
  });
});

// ---- Ormos, Archive Keeper --------------------------------------------------------------------------------------------------------------------------------------------
const ORMOS = card('Test Archivist', 'Creature — Sphinx', '{1}{U}{U}, Discard three cards with different names: Draw five cards.', { pt: ['3', '3'], cost: '{4}{U}{U}', colors: ['U'] });
const CA = card('Test Card A', 'Sorcery', 'You gain 1 life.');
const CB = card('Test Card B', 'Sorcery', 'You gain 2 life.');
const CC = card('Test Card C', 'Sorcery', 'You gain 3 life.');
describe('CR 118.3, 701.9a, 201.2: "Discard three cards with different names"', () => {
  const defs = [ORMOS, ISLAND, CA, CB, CC];
  const lands = ['Test Island', 'Test Island', 'Test Island'];
  it('is fully automated', () => { expect(noManual(ORMOS) && ORMOS.automation.level === 'full').toBe(true); });
  it('three differently named cards: they are discarded and five cards are drawn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Archivist', ...lands], hand: ['Test Card A', 'Test Card B', 'Test Card C'], library: ['Test Card A', 'Test Card A', 'Test Card A', 'Test Card A', 'Test Card A', 'Test Card A'] } });
    const s = resolveAll(activate(s0, 'Test Archivist'));
    expect(gy(s, 'p1')).toEqual(['Test Card A', 'Test Card B', 'Test Card C']);
    expect(hand(s, 'p1')).toHaveLength(5);
  });
  it('the negative cases: two cards with one name and one other (two names), or three cards of one name, cannot pay', () => {
    const two = scenario([], { defs, p1: { battlefield: ['Test Archivist', ...lands], hand: ['Test Card A', 'Test Card A', 'Test Card B'], library: ['Test Card A'] } });
    expect(canActivate(two, 'Test Archivist')).toBe(false);
    const same = scenario([], { defs, p1: { battlefield: ['Test Archivist', ...lands], hand: ['Test Card A', 'Test Card A', 'Test Card A'], library: ['Test Card A'] } });
    expect(canActivate(same, 'Test Archivist')).toBe(false);
  });
  it('four cards with three names: the ability can be paid, and the three chosen have different names', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Archivist', ...lands], hand: ['Test Card A', 'Test Card A', 'Test Card B', 'Test Card C'], library: ['Test Card A', 'Test Card A', 'Test Card A', 'Test Card A', 'Test Card A', 'Test Card A'] } });
    expect(canActivate(s0, 'Test Archivist')).toBe(true);
    const s = resolveAll(activate(s0, 'Test Archivist'), { pick: ['Test Card A', 'Test Card B', 'Test Card C'] });
    expect(gy(s, 'p1')).toEqual(['Test Card A', 'Test Card B', 'Test Card C']);
    // the negative case of the choice: two cards of one name do not pay
    expect(() => drive(activate(s0, 'Test Archivist'), { pick: [] })).toThrow(/could not be paid/); // the first three cards are Card A, Card A, Card B
  });
});

// ---- Edgar's Awakening ------------------------------------------------------------------------------------------------------------------------------------------------
const EDGAR = card('Test Awakening', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.\nWhen you discard this card, you may pay {B}. When you do, return target creature card from your graveyard to your hand.', { cost: '{2}{B}', colors: ['B'] });
const ROT = card('Test Rot', 'Sorcery', 'Target player discards a card.');
describe('CR 701.9a, 603.1, 603.12: "When you discard this card, you may pay {B}. When you do, return target creature card from your graveyard to your hand."', () => {
  const defs = [EDGAR, ROT, SWAMP, BEAR];
  it('is fully automated', () => { expect(noManual(EDGAR) && EDGAR.automation.level === 'full').toBe(true); });
  const board = (swamps: number): GameState => scenario([], { defs, p1: { hand: ['Test Rot', 'Test Awakening'], battlefield: Array(swamps).fill('Test Swamp'), graveyard: ['Test Plain Bear'] } });
  it('discarded and paid: the creature card returns to the hand (the card itself is in the graveyard)', () => {
    const s = resolveAll(castC(board(1), 'Test Rot'), { yes: [true], pick: ['Test Awakening'] });
    expect(hand(s, 'p1')).toEqual(['Test Plain Bear']);
    expect(gy(s, 'p1')).toEqual(['Test Awakening', 'Test Rot']);
  });
  it('the negative cases: the payment declined, or no mana for it, returns nothing', () => {
    const declined = resolveAll(castC(board(1), 'Test Rot'), { yes: [false], pick: ['Test Awakening'] });
    expect(hand(declined, 'p1')).toEqual([]);
    expect(gy(declined, 'p1')).toContain('Test Plain Bear');
    const broke = resolveAll(castC(board(0), 'Test Rot'), { yes: [true], pick: ['Test Awakening'] });
    expect(hand(broke, 'p1')).toEqual([]);
    expect(gy(broke, 'p1')).toContain('Test Plain Bear');
  });
});

// ---- Caravan Vigil ----------------------------------------------------------------------------------------------------------------------------------------------------
const VIGIL = card('Test Vigil', 'Sorcery', 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.\nMorbid — You may put that card onto the battlefield instead of putting it into your hand if a creature died this turn.', { cost: '{G}', colors: ['G'] });
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
describe('CR 614.15, 701.23a: "You may put that card onto the battlefield instead of putting it into your hand if a creature died this turn."', () => {
  const defs = [VIGIL, SMITE, FOREST, ISLAND, BEAR];
  it('is fully automated', () => { expect(noManual(VIGIL) && VIGIL.automation.level === 'full').toBe(true); });
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Smite', 'Test Vigil'], battlefield: ['Test Forest', 'Test Forest'], library: ['Test Island'] }, p2: { battlefield: ['Test Plain Bear'] } });
  it('a creature died this turn: the land may enter the battlefield instead (accepted: it enters; declined: it goes to the hand)', () => {
    let s = resolveAll(castC(board(), 'Test Smite'), { targets: [find(board(), 'Test Plain Bear', 'battlefield', 'p2')] });
    expect(gy(s, 'p2')).toEqual(['Test Plain Bear']);
    const yes = resolveAll(castC(s, 'Test Vigil'), { yes: [true], pick: ['Test Island'] });
    expect(bf(yes, 'p1')).toContain('Test Island');
    expect(hand(yes, 'p1')).toEqual([]);
    s = resolveAll(castC(s, 'Test Vigil'), { yes: [false], pick: ['Test Island'] });
    expect(bf(s, 'p1')).not.toContain('Test Island');
    expect(hand(s, 'p1')).toEqual(['Test Island']);
  });
  it('the negative case: no creature died this turn, the land goes to the hand and nothing is asked', () => {
    const s = resolveAll(castC(board(), 'Test Vigil'), { yes: [true], pick: ['Test Island'] });
    expect(hand(s, 'p1')).toEqual(['Test Island', 'Test Smite']);
    expect(bf(s, 'p1')).not.toContain('Test Island');
  });
});

// ---- Molten Disaster --------------------------------------------------------------------------------------------------------------------------------------------------
const DISASTER = card('Test Disaster', 'Sorcery', 'Kicker {R}\nIf this spell was kicked, it has split second.\nTest Disaster deals X damage to each creature without flying and each player.', { cost: '{X}{R}{R}', colors: ['R'] });
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
describe('CR 702.61a, 702.33d: "If this spell was kicked, it has split second."', () => {
  const defs = [DISASTER, ZAP, MOUNTAIN, BEAR];
  it('is fully automated', () => { expect(noManual(DISASTER) && DISASTER.automation.level === 'full').toBe(true); });
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Disaster'], battlefield: ['Test Mountain', 'Test Mountain', 'Test Mountain'] }, p2: { hand: ['Test Zap'], battlefield: ['Test Plain Bear'] } });
  const castKicked = (yes: boolean): GameState => {
    let s = castC(board(), 'Test Disaster');
    s = drive(s, { yes: [yes], x: 0 });
    return s;
  };
  it('kicked: while it is on the stack the opponent cannot cast an instant', () => {
    const s = pass(castKicked(true));
    expect(s.zones.stack.length).toBeGreaterThan(0);
    expect(legal(s, 'p2', 'cast')).toEqual([]);
  });
  it('the negative case: not kicked, the opponent may respond with an instant', () => {
    const s = pass(castKicked(false));
    expect(s.zones.stack.length).toBeGreaterThan(0);
    expect(legal(s, 'p2', 'cast').length).toBeGreaterThan(0);
  });
});

// ---- Herald of the Forgotten ----------------------------------------------------------------------------------------------------------------------------------------
const HERALD = card('Test Herald', 'Creature — Cat', "When this creature enters, return any number of target permanent cards with cycling abilities from your graveyard to the battlefield.", { pt: ['3', '3'] });
const CYCLER = card('Test Cycler', 'Creature — Bird', 'Cycling {2}', { pt: ['1', '1'] });
const TYPECYCLER = card('Test Landcycler', 'Creature — Bird', 'Islandcycling {1}', { pt: ['1', '1'] });
describe('CR 702.29a, 702.29f: "permanent cards with cycling abilities"', () => {
  it('is fully automated', () => { expect(noManual(HERALD)).toBe(true); });
  it('the cards with cycling or typecycling return; a card without one stays in the graveyard', () => {
    const s0 = scenario([], { defs: [HERALD, CYCLER, TYPECYCLER, BEAR], p1: { hand: ['Test Herald'], graveyard: ['Test Cycler', 'Test Landcycler', 'Test Plain Bear'] } });
    const s = resolveAll(castC(s0, 'Test Herald'), { targets: ['Test Cycler', 'Test Landcycler', 'Test Plain Bear'].map((n) => find(s0, n, 'graveyard', 'p1')) });
    expect(bf(s, 'p1')).toEqual(['Test Cycler', 'Test Herald', 'Test Landcycler']);
    expect(gy(s, 'p1')).toEqual(['Test Plain Bear']);
  });
});

// ---- Prismatic Strands ------------------------------------------------------------------------------------------------------------------------------------------------
const STRANDS = card('Test Strands', 'Instant', 'Prevent all damage that sources of the color of your choice would deal this turn.', { cost: '{2}{W}', colors: ['W'] });
const RBOLT = card('Test Red Bolt', 'Instant', 'Test Red Bolt deals 3 damage to target player.', { colors: ['R'] });
const GBOLT = card('Test Green Bolt', 'Instant', 'Test Green Bolt deals 4 damage to target player.', { colors: ['G'] });
const PLAINS = card('Test Plains', 'Basic Land — Plains', '{T}: Add {W}.');
describe('CR 615.1, 609.7a, 105.1: "Prevent all damage that sources of the color of your choice would deal this turn."', () => {
  const defs = [STRANDS, RBOLT, GBOLT, PLAINS];
  it('is fully automated', () => { expect(noManual(STRANDS) && STRANDS.automation.level === 'full').toBe(true); });
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const start = (color: 'R' | 'G'): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Strands', 'Test Red Bolt', 'Test Green Bolt'], battlefield: ['Test Plains', 'Test Plains', 'Test Plains'] } });
    return resolveAll(castC(s0, 'Test Strands'), { color });
  };
  it('the chosen color\'s damage is prevented (whoever controls the source) and the other color\'s is not', () => {
    for (const [color, prevented, dealt, amount] of [['R', 'Test Red Bolt', 'Test Green Bolt', 4], ['G', 'Test Green Bolt', 'Test Red Bolt', 3]] as const) {
      let s = start(color);
      const l0 = lifeOf(s, 'p2');
      s = resolveAll(castC(s, prevented), { players: ['p2'] });
      expect(lifeOf(s, 'p2'), `${prevented} after choosing ${color}`).toBe(l0);
      s = resolveAll(castC(s, dealt), { players: ['p2'] });
      expect(lifeOf(s, 'p2'), `${dealt} after choosing ${color}`).toBe(l0 - amount);
    }
  });
  it('the negative case: without the spell the damage is dealt', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Red Bolt'] } });
    const s = resolveAll(castC(s0, 'Test Red Bolt'), { players: ['p2'] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
  });
});

// ---- Urza Assembles the Titans (chapter III) ---------------------------------------------------------------------------------------------------------------------------
const SURGE = card('Test Surge', 'Instant', 'You may activate the loyalty abilities of planeswalkers you control twice this turn rather than only once.', { colors: ['U'] });
const WALKER = card('Test Walker', 'Planeswalker — Test', '+1: You gain 1 life.\n-1: You gain 2 life.', { pt: undefined });
describe('CR 606.3, 602.5b: "You may activate the loyalty abilities of planeswalkers you control twice this turn rather than only once."', () => {
  const defs = [SURGE, WALKER];
  it('is fully automated', () => { expect(noManual(SURGE)).toBe(true); });
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const board = (hand: string[]): GameState => scenario([], { defs, p1: { hand, battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] } });
  const plusOne = (s: GameState): boolean => legal(s, 'p1', 'activate').some((x) => x.label.includes('+1'));
  it('without the spell the planeswalker is activated once a turn; with it twice, and not three times', () => {
    let s = board([]);
    expect(plusOne(s)).toBe(true);
    s = resolveAll(activate(s, 'Test Walker'));
    expect(plusOne(s)).toBe(false);
    s = resolveAll(castC(board(['Test Surge']), 'Test Surge'));
    const l0 = lifeOf(s, 'p1');
    s = resolveAll(activate(s, 'Test Walker'));
    expect(plusOne(s)).toBe(true);
    s = resolveAll(activate(s, 'Test Walker'));
    expect(lifeOf(s, 'p1')).toBe(l0 + 2);
    expect(plusOne(s)).toBe(false);
  });
});

// ---- Reckless Blaze ---------------------------------------------------------------------------------------------------------------------------------------------------
const BLAZE = card('Test Blaze', 'Sorcery', 'Test Blaze deals 5 damage to each creature. Whenever a creature you control dealt damage this way dies this turn, add {R}.', { colors: ['R'] });
const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '8'], colors: ['W'] });
const KILL = card('Test Kill', 'Sorcery', 'Destroy target creature.', { colors: ['B'] });
describe('CR 603.10a, 120.3, 608.2c: "Whenever a creature you control dealt damage this way dies this turn, add {R}."', () => {
  const defs = [BLAZE, WALL, KILL, BEAR];
  it('is fully automated', () => { expect(noManual(BLAZE) && BLAZE.automation.level === 'full').toBe(true); });
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Blaze', 'Test Kill'], battlefield: ['Test Plain Bear', 'Test Wall'] }, p2: { battlefield: ['Test Plain Bear'] } });
  it('each of your creatures dealt damage that dies adds {R} (the one that dies now, and the one that survives and dies later this turn); the opponent\'s creature adds nothing', () => {
    let s = resolveAll(castC(board(), 'Test Blaze'));
    expect(bf(s, 'p1')).toEqual(['Test Wall']);
    expect(bf(s, 'p2')).toEqual([]);
    expect(pool(s, 'p1')).toBe('R');
    s = resolveAll(castC(s, 'Test Kill'), { targets: [find(s, 'Test Wall', 'battlefield', 'p1')] });
    expect(bf(s, 'p1')).toEqual([]);
    expect(pool(s, 'p1')).toBe('RR');
  });
  it('the negative case: a creature that was not dealt damage by it (it came later) adds no mana when it dies', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Blaze', 'Test Plain Bear', 'Test Kill'] }, p2: { battlefield: ['Test Plain Bear'] } });
    let s = resolveAll(castC(s0, 'Test Blaze'));
    expect(pool(s, 'p1')).toBe('');
    s = resolveAll(castC(s, 'Test Plain Bear'));
    s = resolveAll(castC(s, 'Test Kill'), { targets: [find(s, 'Test Plain Bear', 'battlefield', 'p1')] });
    expect(bf(s, 'p1')).toEqual([]);
    expect(pool(s, 'p1')).toBe('');
  });
});
