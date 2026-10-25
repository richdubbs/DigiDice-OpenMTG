/**
 * Lane trek, round trek-6 (Star Trek: counters, Spacecraft and station), played through the engine with the real cards (fixtures: trek-6-cards.txt) and synthetic
 * cards (invented names, design 6.10) compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 721.2a-b, 702.184a  a Station line printed without its reminder text: with exactly one station symbol the power and toughness box is in its striation; a
 *                          creature at the threshold (artifact creature, printed P/T, the row's abilities), a plain artifact below it
 *   CR 614.1a, 122.6       "If you would put one or more charge counters on an artifact you control, put twice that many ... instead" (Geordi La Forge); "... put
 *                          twice that many of each of those kinds of counters on that creature instead" (Dr. M'Benga): only counters YOU put, only on the
 *                          permanents described, only the kind named
 *   CR 603.4, 608.2c       "Whenever you cast a noncreature spell, if this Spacecraft isn't a creature, put two charge counters on it" (Romulan Bird-of-Prey)
 *   CR 701.23, 122.6       "Tap seven untapped Officers you control: Search your library for a Spacecraft card, put it onto the battlefield with seven charge counters
 *                          on it, then shuffle" (Captain Picard)
 *   CR 700.6, 603.6a       "Whenever another historic permanent you control with mana value 3 or greater enters, draw a card" (Jean-Luc Picard, Luminary); the
 *                          second-card trigger puts counters of two kinds on two targets
 *   CR 122.6, 608.2c       "If you put two or more +1/+1 counters on creatures this way, draw a card" (Guinan): the counters actually put, after replacements
 *   CR 607.2a, 608.2d      "assimilate a creature card exiled with it. If you can't, exile up to one target creature" (Borg Cube): the ability is its own linked
 *                          ability; the cards exiled by earlier resolutions are the cards to assimilate
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; mv?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const pt = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const hand = (s: GameState, who: 'p1' | 'p2'): number => s.zones.hand[who]!.length;

/** Answer what comes up: automatic payment, yes to every question, the first options for a choice of objects, the given targets in order. */
function settle(s0: GameState, o: { targets?: ObjectId[][]; yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending;
    let a: DecisionAnswer;
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: o.yes ?? true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) };
    else if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items.map((x) => x.id) };
    else throw new Error(`unexpected decision ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
/** Resolve the whole stack, answering as `settle` does. */
function resolveAll(s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, o);
  return s;
}
/** Activate the first non-mana activated ability of a permanent of p1 (or the one at `index` among them) and resolve it. */
function activate(s: GameState, name: string, o: Parameters<typeof settle>[1] & { index?: number; who?: 'p1' | 'p2' } = {}): GameState {
  const who = o.who ?? 'p1';
  const id = find(s, name, 'battlefield', who);
  const las = legal(s, who, 'activate').filter((a) => a.object === id && !a.isMana);
  const la = las[o.index ?? 0];
  if (!la) throw new Error(`no activated ability of ${name}`);
  return resolveAll(act(s, la.action), o);
}
const canActivate = (s: GameState, name: string, who: 'p1' | 'p2' = 'p1'): boolean => {
  const id = find(s, name, 'battlefield', who);
  return legal(s, who, 'activate').some((a) => a.object === id && !a.isMana);
};

// ---- CR 721.2: a Station line without its reminder text ------------------------------------------------------------------------------------------------

describe('CR 721.2a-b, 702.184a: Station printed without its reminder text (U.S.S. Discovery, Romulan Bird-of-Prey, Borg Cube)', () => {
  const SHIP = card('Test Plain Ship', 'Artifact — Spacecraft', 'Station\n6+ | Flying', { pt: ['5', '5'] });
  const PILOT = card('Test Pilot', 'Creature — Human', '', { pt: ['4', '4'] });
  it('is automated, and so are the real cards', () => {
    expect(full(SHIP)).toBe(true);
  });
  it('below the threshold it is a plain artifact; at the threshold it is an artifact creature with the printed 5/5 and the row\'s flying (CR 721.2a-b)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Plain Ship', 'Test Pilot'] }, defs: [SHIP, PILOT] });
    const ship = find(s, 'Test Plain Ship', 'battlefield', 'p1');
    expect(chars(s, ship).types).not.toContain('Creature');
    expect(chars(s, ship).keywords.some((k) => k.keyword === 'flying')).toBe(false);
    s = activate(s, 'Test Plain Ship'); // tap the 4/4: four charge counters
    expect(counters(s, ship, 'charge')).toBe(4);
    expect(chars(s, ship).types).not.toContain('Creature');
    s.objects[ship]!.counters['charge'] = 6; // the threshold
    expect(chars(s, ship).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(pt(s, ship)).toBe('5/5');
    expect(chars(s, ship).keywords.some((k) => k.keyword === 'flying')).toBe(true);
    s.objects[ship]!.counters['charge'] = 5;
    expect(chars(s, ship).types).not.toContain('Creature');
  });
  it('with two station symbols the box\'s striation cannot be told from the Oracle text: the rows stay manual (fail closed)', () => {
    const two = card('Test Two Symbol Ship', 'Artifact — Spacecraft', 'Station\n2+ | Other creatures you control get +1/+1.\n8+ | Flying', { pt: ['4', '4'] });
    expect(full(two)).toBe(false);
    expect(two.faces[0]!.abilities.filter((a) => a.kind === 'manual')).toHaveLength(2);
  });
  it('a reminder that names a threshold is never second-guessed: a different single row stays manual', () => {
    const named = card('Test Named Ship', 'Artifact — Spacecraft', "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n6+ | Flying", { pt: ['4', '4'] });
    expect(full(named)).toBe(false);
  });
  it('a card without a printed box (a Planet) is not given a creature row', () => {
    const planet = card('Test Quiet World', 'Land — Planet', 'Station\n12+ | {T}: Add {G}.');
    expect(full(planet)).toBe(true);
    const mods = JSON.stringify(planet.faces[0]!.abilities);
    expect(mods).not.toContain('"7b"');
  });
});

// ---- CR 614.1a, 122.6: doubling the counters you put ----------------------------------------------------------------------------------------------------

describe('CR 614.1a, 122.6: Lt. Cmdr. Geordi La Forge, "If you would put one or more charge counters on an artifact you control, put twice that many charge counters on that artifact instead."', () => {
  const SHIP = card('Test Plain Ship', 'Artifact — Spacecraft', 'Station\n6+ | Flying', { pt: ['5', '5'] });
  const PILOT = card('Test Pilot', 'Creature — Human', '', { pt: ['4', '4'] });
  const CHARGER = card('Test Charger', 'Artifact', '{T}: Put a charge counter on target permanent.');
  const PLUSSER = card('Test Plusser', 'Artifact', '{T}: Put a +1/+1 counter on target permanent.');
  const defs = [SHIP, PILOT, CHARGER, PLUSSER];
  const board = (extra: { p1?: string[]; p2?: string[] } = {}) =>
    scenario(['Lt. Cmdr. Geordi La Forge'], { p1: { battlefield: ['Lt. Cmdr. Geordi La Forge', 'Test Plain Ship', 'Test Pilot', 'Test Charger', 'Test Plusser', ...(extra.p1 ?? [])] }, p2: { battlefield: extra.p2 ?? [] }, defs });

  it('is automated (the real card)', () => {
    const s = board();
    expect(s.defs['Lt. Cmdr. Geordi La Forge']!.automation.level).toBe('full');
  });
  it('the charge counters Station puts on the Spacecraft you control are doubled: tapping a 4-power creature puts eight (CR 702.184a)', () => {
    let s = board();
    const ship = find(s, 'Test Plain Ship', 'battlefield', 'p1');
    const pilot = find(s, 'Test Pilot', 'battlefield', 'p1');
    s = activate(s, 'Test Plain Ship', { pick: () => [pilot] });
    expect(counters(s, ship, 'charge')).toBe(8);
  });
  it('without Geordi the same Station puts four', () => {
    let s = scenario([], { p1: { battlefield: ['Test Plain Ship', 'Test Pilot'] }, defs });
    const ship = find(s, 'Test Plain Ship', 'battlefield', 'p1');
    s = activate(s, 'Test Plain Ship');
    expect(counters(s, ship, 'charge')).toBe(4);
  });
  it('an artifact you control that is not a Spacecraft gets twice the charge counters too', () => {
    let s = board();
    const rock = find(s, 'Test Plusser', 'battlefield', 'p1');
    s = activate(s, 'Test Charger', { targets: [[rock]] });
    expect(counters(s, rock, 'charge')).toBe(2);
  });
  it('only charge counters: a +1/+1 counter on the same artifact is not doubled', () => {
    let s = board();
    const rock = find(s, 'Test Charger', 'battlefield', 'p1');
    s = activate(s, 'Test Plusser', { targets: [[rock]] });
    expect(counters(s, rock, '+1/+1')).toBe(1);
  });
  it('only an artifact: charge counters on a creature you control that is no artifact are not doubled', () => {
    let s = board();
    const pilot = find(s, 'Test Pilot', 'battlefield', 'p1');
    s = activate(s, 'Test Charger', { targets: [[pilot]] });
    expect(counters(s, pilot, 'charge')).toBe(1);
  });
  it('only an artifact YOU control: charge counters you put on an opponent\'s artifact are not doubled', () => {
    let s = board({ p2: ['Test Plusser'] });
    const theirs = find(s, 'Test Plusser', 'battlefield', 'p2');
    s = activate(s, 'Test Charger', { targets: [[theirs]] });
    expect(counters(s, theirs, 'charge')).toBe(1);
  });
  it('only the counters YOU put: an opponent putting charge counters on your artifact puts one (CR 122.6: the player whose instruction puts them)', () => {
    let s = board({ p2: ['Test Charger'] });
    const mine = find(s, 'Test Plusser', 'battlefield', 'p1');
    s = pass(s); // give p2 priority
    expect(canActivate(s, 'Test Charger', 'p2')).toBe(true);
    s = activate(s, 'Test Charger', { who: 'p2', targets: [[mine]] });
    expect(counters(s, mine, 'charge')).toBe(1);
  });
});

describe('CR 614.1a, 122.6: Dr. Joseph M\'Benga, "If you would put one or more counters on a creature you control, put twice that many of each of those kinds of counters on that creature instead."', () => {
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['5', '5'] });
  const GARDENER = card('Test Gardener', 'Artifact', '{T}: Put a +1/+1 counter on target permanent.');
  const WITHER = card('Test Wither', 'Artifact', '{T}: Put a -1/-1 counter on target permanent.');
  const FADER = card('Test Fader', 'Artifact', '{T}: Put a time counter on target permanent.');
  const defs = [BEAR, GARDENER, WITHER, FADER];
  const board = (p2: string[] = []) =>
    scenario(["Dr. Joseph M'Benga"], { p1: { battlefield: ["Dr. Joseph M'Benga", 'Test Bear', 'Test Gardener', 'Test Wither', 'Test Fader'] }, p2: { battlefield: p2 }, defs });

  it('is automated (the real card)', () => {
    expect(board().defs["Dr. Joseph M'Benga"]!.automation.level).toBe('full');
  });
  it('every kind is doubled: a +1/+1 counter on your creature is two, a -1/-1 counter is two, a time counter is two', () => {
    const bearOf = (s: GameState) => find(s, 'Test Bear', 'battlefield', 'p1');
    for (const [tool, kind] of [['Test Gardener', '+1/+1'], ['Test Wither', '-1/-1'], ['Test Fader', 'time']] as const) {
      const s0 = board();
      const s = activate(s0, tool, { targets: [[bearOf(s0)]] });
      expect(counters(s, bearOf(s), kind), kind).toBe(2);
    }
  });
  it('the creature may be M\'Benga himself', () => {
    let s = board();
    const doc = find(s, "Dr. Joseph M'Benga", 'battlefield', 'p1');
    s = activate(s, 'Test Gardener', { targets: [[doc]] });
    expect(counters(s, doc, '+1/+1')).toBe(2);
  });
  it('a permanent that is no creature gets one counter: the replacement is about a creature you control', () => {
    let s = board();
    const tool = find(s, 'Test Wither', 'battlefield', 'p1');
    s = activate(s, 'Test Gardener', { targets: [[tool]] });
    expect(counters(s, tool, '+1/+1')).toBe(1);
  });
  it('a creature an opponent controls gets one counter from you', () => {
    let s = board(['Test Bear']);
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = activate(s, 'Test Gardener', { targets: [[theirs]] });
    expect(counters(s, theirs, '+1/+1')).toBe(1);
  });
  it('a creature that enters the battlefield under your control with counters gets twice as many (CR 122.6a, 614.1c: you put them as it enters)', () => {
    const ENTERER = card('Test Enterer', 'Creature — Bear', 'This creature enters with two +1/+1 counters on it.', { pt: ['1', '1'] });
    let s = scenario(["Dr. Joseph M'Benga"], { p1: { battlefield: ["Dr. Joseph M'Benga"], hand: ['Test Enterer'] }, defs: [ENTERER] });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Enterer', 'hand', 'p1') }));
    expect(counters(s, find(s, 'Test Enterer', 'battlefield', 'p1'), '+1/+1')).toBe(4);
  });
  it('the counters an opponent puts on your creature are not doubled (it is "if YOU would put")', () => {
    let s = board(['Test Gardener']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = pass(s);
    s = activate(s, 'Test Gardener', { who: 'p2', targets: [[bear]] });
    expect(counters(s, bear, '+1/+1')).toBe(1);
  });
});

// ---- CR 603.4, 608.2c: Romulan Bird-of-Prey ---------------------------------------------------------------------------------------------------------------

describe('CR 603.4, 608.2c, 702.11: Romulan Bird-of-Prey, "Whenever you cast a noncreature spell, if this Spacecraft isn\'t a creature, put two charge counters on it."', () => {
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [ZAP, CUB];
  const board = () => scenario(['Romulan Bird-of-Prey'], { p1: { battlefield: ['Romulan Bird-of-Prey'], hand: ['Test Zap', 'Test Zap', 'Test Cub'] }, defs });
  const cast = (s: GameState, name: string): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }));

  it('is automated (the real card)', () => expect(board().defs['Romulan Bird-of-Prey']!.automation.level).toBe('full'));
  it('a noncreature spell puts two charge counters on it; a second puts two more', () => {
    let s = board();
    const ship = find(s, 'Romulan Bird-of-Prey', 'battlefield', 'p1');
    s = cast(s, 'Test Zap');
    expect(counters(s, ship, 'charge')).toBe(2);
    s = cast(s, 'Test Zap');
    expect(counters(s, ship, 'charge')).toBe(4);
  });
  it('a creature spell puts none', () => {
    let s = board();
    const ship = find(s, 'Romulan Bird-of-Prey', 'battlefield', 'p1');
    s = cast(s, 'Test Cub');
    expect(counters(s, ship, 'charge')).toBe(0);
  });
  it('the intervening "if": as a creature (eight or more charge counters) it gets none (CR 603.4)', () => {
    let s = board();
    const ship = find(s, 'Romulan Bird-of-Prey', 'battlefield', 'p1');
    s.objects[ship]!.counters['charge'] = 8;
    expect(chars(s, ship).types).toContain('Creature');
    s = cast(s, 'Test Zap');
    expect(counters(s, ship, 'charge')).toBe(8);
  });
  it('Cloaking Device: hexproof as long as it isn\'t a creature, none as a creature', () => {
    const s = board();
    const ship = find(s, 'Romulan Bird-of-Prey', 'battlefield', 'p1');
    const hexproof = (x: GameState): boolean => chars(x, ship).keywords.some((k) => k.keyword === 'hexproof');
    expect(hexproof(s)).toBe(true);
    s.objects[ship]!.counters['charge'] = 8;
    expect(hexproof(s)).toBe(false);
    expect(pt(s, ship)).toBe('4/4');
    expect(chars(s, ship).keywords.some((k) => k.keyword === 'flying')).toBe(true);
  });
});

// ---- CR 701.23, 122.6: Captain Jean-Luc Picard ------------------------------------------------------------------------------------------------------------

describe('CR 701.23, 110.2, 122.6: Captain Jean-Luc Picard, "Tap seven untapped Officers you control: Search your library for a Spacecraft card, put it onto the battlefield with seven charge counters on it, then shuffle."', () => {
  const OFFICER = card('Test Officer', 'Creature — Human Officer', '', { pt: ['1', '1'] });
  const SHIP = card('Test Plain Ship', 'Artifact — Spacecraft', 'Station\n12+ | Flying', { pt: ['5', '5'], cost: '{1}' });
  const defs = [OFFICER, SHIP];
  const board = (officers: number) => scenario(['Captain Jean-Luc Picard'], {
    p1: { battlefield: ['Captain Jean-Luc Picard', ...Array(officers).fill('Test Officer') as string[]], library: ['Test Plain Ship'], hand: [] }, defs,
  });
  const officerAbility = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.object === find(s, 'Captain Jean-Luc Picard', 'battlefield', 'p1') && !a.isMana);

  it('is automated (the real card)', () => expect(board(0).defs['Captain Jean-Luc Picard']!.automation.level).toBe('full'));
  it('seven untapped Officers (he is one) pay for it: the Spacecraft enters under your control with seven charge counters, and the Officers are tapped', () => {
    let s = board(6);
    expect(officerAbility(s)).toBeDefined();
    s = resolveAll(act(s, officerAbility(s)!.action));
    const ship = find(s, 'Test Plain Ship', 'battlefield', 'p1');
    expect(s.objects[ship]!.controller).toBe('p1');
    expect(counters(s, ship, 'charge')).toBe(7);
    expect(findAll(s, 'Test Officer', 'battlefield', 'p1').every((o) => s.objects[o]!.tapped)).toBe(true);
    expect(s.objects[find(s, 'Captain Jean-Luc Picard', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(s.zones.library['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Plain Ship')).toBe(false);
  });
  it('six Officers cannot pay for it (the cost is seven untapped Officers you control)', () => {
    const s = board(5);
    expect(officerAbility(s)).toBeUndefined();
  });
  it('a tapped Officer does not count', () => {
    const s = board(6);
    const one = findAll(s, 'Test Officer', 'battlefield', 'p1')[0]!;
    s.objects[one]!.tapped = true;
    expect(officerAbility(s)).toBeUndefined();
  });
  it('the other creatures you control get +1/+1, and casting a Spacecraft makes an Officer token', () => {
    let s = scenario(['Captain Jean-Luc Picard'], { p1: { battlefield: ['Captain Jean-Luc Picard', 'Test Officer', 'Plains'], hand: ['Test Plain Ship'] }, defs });
    expect(pt(s, find(s, 'Test Officer', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Captain Jean-Luc Picard', 'battlefield', 'p1'))).toBe('2/3');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plain Ship', 'hand', 'p1') }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect(chars(s, tokens[0]!).subtypes).toContain('Officer');
  });
});

// ---- CR 700.6, 603.6a: Jean-Luc Picard, Luminary ----------------------------------------------------------------------------------------------------------

describe('CR 700.6, 603.2, 122.1: Jean-Luc Picard, Luminary', () => {
  const GEM3 = card('Test Gem Three', 'Artifact', '', { cost: '{3}' });
  const GEM2 = card('Test Gem Two', 'Artifact', '', { cost: '{2}' });
  const HERO4 = card('Test Hero Four', 'Legendary Creature — Human', '', { pt: ['2', '2'], cost: '{4}' });
  const BEAR4 = card('Test Bear Four', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{4}' });
  const SAGA3 = card('Test Saga Three', 'Enchantment — Saga', 'I — You gain 1 life.\nII — You gain 1 life.\nIII — You gain 1 life.', { cost: '{3}' });
  const ROCK3 = card('Test Opposing Gem', 'Artifact', '', { cost: '{3}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SHIP = card('Test Plain Ship', 'Artifact — Spacecraft', 'Station\n12+ | Flying', { pt: ['5', '5'] });
  const STUDY = card('Test Study', 'Sorcery', 'Draw two cards.');
  const FLASH_GEM = card('Test Flash Gem', 'Artifact', 'Flash', { cost: '{3}' });
  const defs = [GEM3, GEM2, HERO4, BEAR4, SAGA3, ROCK3, BEAR, SHIP, STUDY];
  const lands = Array(5).fill('Plains') as string[];
  const board = (hand: string[], p2: string[] = []) => scenario(['Jean-Luc Picard, Luminary'], { p1: { battlefield: ['Jean-Luc Picard, Luminary', ...lands, 'Test Bear', 'Test Plain Ship'], hand }, p2: { battlefield: p2, hand: ['Test Opposing Gem'] }, defs });
  const cast = (s: GameState, name: string, o: Parameters<typeof settle>[1] = {}): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);

  it('is automated (the real card)', () => expect(board([]).defs['Jean-Luc Picard, Luminary']!.automation.level).toBe('full'));
  it('another historic permanent with mana value 3 or greater entering under your control draws a card: an artifact, a legendary creature, a Saga', () => {
    for (const name of ['Test Gem Three', 'Test Hero Four', 'Test Saga Three']) {
      const s0 = board([name]);
      const before = hand(s0, 'p1') - 1; // the spell leaves the hand
      const s = cast(s0, name);
      expect(hand(s, 'p1'), name).toBe(before + 1);
    }
  });
  it('mana value 2 does not, and a permanent that is not historic does not', () => {
    for (const name of ['Test Gem Two', 'Test Bear Four']) {
      const s0 = board([name]);
      const before = hand(s0, 'p1') - 1;
      const s = cast(s0, name);
      expect(hand(s, 'p1'), name).toBe(before);
    }
  });
  it('a historic permanent an opponent controls does not (it is "you control"): the opponent flashes in an artifact with mana value 3, you draw nothing', () => {
    let s = scenario(['Jean-Luc Picard, Luminary'], { p1: { battlefield: ['Jean-Luc Picard, Luminary'] }, p2: { battlefield: ['Plains', 'Plains', 'Plains'], hand: ['Test Flash Gem'] }, defs: [...defs, FLASH_GEM] });
    s = pass(s); // p2 gets priority in p1's main phase
    const before = hand(s, 'p1');
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Gem', 'hand', 'p2') }));
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Flash Gem' && s.objects[id]!.controller === 'p2')).toBe(true); // it did enter
    expect(hand(s, 'p1')).toBe(before);
  });
  it('"another": Picard himself entering does not draw (he is a legendary permanent with mana value 4)', () => {
    let s = scenario(['Jean-Luc Picard, Luminary', 'Island', 'Mountain'], { p1: { battlefield: ['Island', 'Mountain', 'Plains', 'Plains'], hand: ['Jean-Luc Picard, Luminary'] }, defs });
    const before = hand(s, 'p1') - 1; // the spell leaves the hand
    s = cast(s, 'Jean-Luc Picard, Luminary');
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Jean-Luc Picard, Luminary')).toBe(true);
    expect(hand(s, 'p1')).toBe(before);
  });
  it('the second card you draw each turn: a +1/+1 counter on up to one other target creature and two charge counters on up to one target Spacecraft', () => {
    let s = board(['Test Study']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ship = find(s, 'Test Plain Ship', 'battlefield', 'p1');
    s = cast(s, 'Test Study', { targets: [[bear], [ship]] }); // the draw of two cards: the second one triggers it
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(counters(s, ship, 'charge')).toBe(2);
  });
  it('up to one: with no targets chosen nothing gets a counter', () => {
    let s = board(['Test Study']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ship = find(s, 'Test Plain Ship', 'battlefield', 'p1');
    s = cast(s, 'Test Study', { targets: [[], []] });
    expect(counters(s, bear, '+1/+1')).toBe(0);
    expect(counters(s, ship, 'charge')).toBe(0);
  });
});

// ---- CR 122.6, 608.2c: Guinan, Ancient Advisor ------------------------------------------------------------------------------------------------------------

describe('CR 122.6, 608.2c: Guinan, Ancient Advisor, "{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card."', () => {
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  const OLD = card('Test Old Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [CUB, OLD];
  const board = (hand: string[], extra: string[] = []) => scenario(['Guinan, Ancient Advisor', "Dr. Joseph M'Benga"], { p1: { battlefield: ['Guinan, Ancient Advisor', 'Plains', 'Test Old Bear', ...extra], hand }, defs });
  const cast = (s: GameState, name: string): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }));

  it('is automated (the real card)', () => expect(board([]).defs['Guinan, Ancient Advisor']!.automation.level).toBe('full'));
  it('two creatures entered this turn: each gets a counter, two counters were put, you draw a card; the creature that did not enter this turn gets none', () => {
    let s = board(['Test Cub', 'Test Cub']);
    s = cast(cast(s, 'Test Cub'), 'Test Cub');
    const before = hand(s, 'p1');
    s = activate(s, 'Guinan, Ancient Advisor');
    for (const c of findAll(s, 'Test Cub', 'battlefield', 'p1')) expect(counters(s, c, '+1/+1')).toBe(1);
    expect(counters(s, find(s, 'Test Old Bear', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    expect(hand(s, 'p1')).toBe(before + 1);
  });
  it('one creature entered this turn: one counter, no card (the condition is two or more counters)', () => {
    let s = board(['Test Cub']);
    s = cast(s, 'Test Cub');
    const before = hand(s, 'p1');
    s = activate(s, 'Guinan, Ancient Advisor');
    expect(counters(s, find(s, 'Test Cub', 'battlefield', 'p1'), '+1/+1')).toBe(1);
    expect(hand(s, 'p1')).toBe(before);
  });
  it('no creature entered this turn: nothing is put and nothing is drawn', () => {
    let s = board([]);
    const before = hand(s, 'p1');
    s = activate(s, 'Guinan, Ancient Advisor');
    expect(hand(s, 'p1')).toBe(before);
  });
  it('the counters actually put: under a doubling effect ONE creature gets two, which is two or more (CR 122.6, 614.1a), so you draw', () => {
    let s = board(['Test Cub'], ["Dr. Joseph M'Benga"]);
    s = cast(s, 'Test Cub');
    const before = hand(s, 'p1');
    s = activate(s, 'Guinan, Ancient Advisor');
    expect(counters(s, find(s, 'Test Cub', 'battlefield', 'p1'), '+1/+1')).toBe(2);
    expect(hand(s, 'p1')).toBe(before + 1);
  });
});

// ---- CR 607.2a, 608.2d: Borg Cube ------------------------------------------------------------------------------------------------------------------------

describe('CR 607.2a, 608.2d: Borg Cube, "Whenever this Spacecraft enters or attacks, assimilate a creature card exiled with it. If you can\'t, exile up to one target creature."', () => {
  const BEAR = card('Test Bear', 'Creature — Elf Warrior', '', { pt: ['2', '2'] });
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
  const defs = [BEAR, WOLF];
  /** Turn 1, the Cube a 6/6 creature (twelve charge counters) that can attack. */
  const board = (p2: string[]) => {
    const s = scenario(['Borg Cube'], { p1: { battlefield: ['Borg Cube'] }, p2: { battlefield: p2 }, defs });
    s.objects[find(s, 'Borg Cube', 'battlefield', 'p1')]!.counters['charge'] = 12;
    return s;
  };
  const attack = (s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState => {
    let s = s0;
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
      if (guard > 30) throw new Error('no declare attackers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Borg Cube', 'battlefield', 'p1'), defender: 'p2' }] });
    return resolveAll(s, o);
  };

  /** p2's turn 2 passes; p1's turn 3 at its declare attackers decision, the Cube a creature again (twelve charge counters). */
  const toTurnThree = (s0: GameState): GameState => {
    let s = s0;
    for (let guard = 0; !(s.turn.number === 3 && s.pending?.kind === 'declareAttackers'); guard++) {
      if (guard > 100) throw new Error('turn 3');
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
    }
    s.objects[find(s, 'Borg Cube', 'battlefield', 'p1')]!.counters['charge'] = 12;
    return s;
  };

  it('is automated (the real card)', () => expect(board([]).defs['Borg Cube']!.automation.level).toBe('full'));
  it('at 12 or more charge counters it is a 6/6 artifact creature and gives artifact creatures you control flying (CR 721.2a-b)', () => {
    const s = board([]);
    const cube = find(s, 'Borg Cube', 'battlefield', 'p1');
    expect(pt(s, cube)).toBe('6/6');
    expect(chars(s, cube).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(chars(s, cube).keywords.some((k) => k.keyword === 'flying')).toBe(true);
  });
  it('attacking with no creature card exiled with it: "if you can\'t" exiles the target creature, remembered as exiled with the Cube', () => {
    const s0 = board(['Test Bear']);
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = attack(s0, { targets: [[bear]] });
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
    const cube = s.objects[find(s, 'Borg Cube', 'battlefield', 'p1')]!;
    expect(cube.links?.['exiled']?.objects).toHaveLength(1);
  });
  it('up to one: with no target chosen nothing is exiled', () => {
    const s0 = board(['Test Bear']);
    const s = attack(s0, { targets: [[]] });
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(true);
    expect(s.zones.exile).toHaveLength(0);
  });
  it('the next time it attacks it assimilates the creature card instead: under your control with a +1/+1 counter, a Borg artifact creature that lost its other creature types, and nothing else is exiled', () => {
    const s0 = board(['Test Bear', 'Test Wolf']);
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const wolf = find(s0, 'Test Wolf', 'battlefield', 'p2');
    let s = attack(s0, { targets: [[bear]] });
    // p2's turn 2, then p1's turn 3: the Cube attacks again; it names the Wolf as its target, but "if you can't" does not happen
    s = toTurnThree(s);
    expect(find(s, 'Test Wolf', 'battlefield', 'p2')).toBe(wolf);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Borg Cube', 'battlefield', 'p1'), defender: 'p2' }] });
    s = resolveAll(s, { targets: [[wolf]] });
    const assimilated = find(s, 'Test Bear', 'battlefield', 'p2'); // owned by p2 still (find looks at the owner)
    expect(s.objects[assimilated]!.owner).toBe('p2');
    expect(s.objects[assimilated]!.controller).toBe('p1');
    expect(counters(s, assimilated, '+1/+1')).toBe(1);
    expect(chars(s, assimilated).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(chars(s, assimilated).subtypes).toContain('Borg');
    expect(chars(s, assimilated).subtypes).not.toContain('Elf');
    expect(chars(s, assimilated).subtypes).not.toContain('Warrior');
    expect(pt(s, assimilated)).toBe('3/3');
    expect(s.zones.battlefield.includes(wolf)).toBe(true); // the Wolf was not exiled
    expect(s.zones.exile).toHaveLength(0);
  });
  it('a card that left exile is no longer exiled with it (CR 400.7): the next attack has nothing to assimilate, so it exiles the target instead', () => {
    const s0 = board(['Test Bear', 'Test Wolf']);
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const wolf = find(s0, 'Test Wolf', 'battlefield', 'p2');
    let s = attack(s0, { targets: [[bear]] });
    // the exiled card goes to its owner's graveyard (as another effect would send it): it is a new object there
    const exiledBear = s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')!;
    s.zones.exile.splice(s.zones.exile.indexOf(exiledBear), 1);
    s.zones.graveyard['p2']!.push(exiledBear);
    s.objects[exiledBear]!.zone = 'graveyard';
    s = toTurnThree(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Borg Cube', 'battlefield', 'p1'), defender: 'p2' }] });
    s = resolveAll(s, { targets: [[wolf]] });
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Wolf')).toBe(true);
  });
});
