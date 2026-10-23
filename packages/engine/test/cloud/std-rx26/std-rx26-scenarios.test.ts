/**
 * std-rx26 (card wave 2, slice s10): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 601.2a, 601.2f, 611.2c, 702.41a  "The next noncreature spell you cast this turn has affinity for artifacts.": the spell has affinity while its cost is
 *                                       determined (castCheck lists it as castable for less); a creature spell does not; the rider is used up by that spell
 *   CR 702.51a, 601.2h                  "... has convoke": the creatures tapped pay for the next spell, only that one
 *   CR 702.170a, 601.2f, 118.7          "Plotting cards from your hand costs {2} less.": the plot action's cost, never below {0}; another player's plotting is not
 *   CR 701.57a, 603.2                   "Whenever you discover, discover again for the same value. This ability triggers only once each turn."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type Action, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, lands, pass, put, scenario } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const handNames = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id));
const yardNames = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const tappedCount = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
const castAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const activateAction = (s: GameState, name: string): Action | undefined =>
  legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const plotAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1') =>
  legalActions(s, player).find((a) => a.kind === 'special' && a.object !== undefined && nameOf(s, a.object) === name);

/** Answer every decision (yes, the first options, automatic payments; `objects` for the first object choice) until a player has priority. */
function settle(s0: GameState, o: { objects?: string[]; yes?: boolean } = {}): GameState {
  let s = s0;
  let objects = o.objects;
  for (let i = 0; i < 60 && s.pending && s.pending.kind !== 'priority'; i++) {
    const p = s.pending as unknown as { kind: string; options?: unknown[]; min?: number; items?: { id: string }[] };
    let a: DecisionAnswer;
    if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: o.yes ?? true };
    else if (p.kind === 'chooseObjects') { a = { kind: 'chooseObjects', ids: objects ?? (p.options as string[]).slice(0, p.min ?? 0) }; objects = undefined; }
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p.options as { id: string }[])[o.yes === false ? (p.options as unknown[]).length - 1 : 0] as unknown as string].map((x) => (x as unknown as { id: string }).id ?? x) };
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items!.map((x) => x.id) };
    else throw new Error(`settle: ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
function resolveAll(s0: GameState, o: { objects?: string[]; yes?: boolean } = {}): GameState {
  let s = settle(s0, o);
  for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = settle(pass(s), o);
  return s;
}

// ---- the next spell you cast this turn has a cost keyword ---------------------------------------------------------------------------------------------------

const WRENCH = card('Test Wrench', 'Artifact', '{T}: The next noncreature spell you cast this turn has affinity for artifacts.');
const COG = card('Test Cog', 'Artifact', '');
const NOTION = card('Test Notion', 'Sorcery', 'Draw a card.', { cost: '{3}' });
const IDEA = card('Test Idea', 'Sorcery', 'Draw a card.', { cost: '{3}' });
const GOLEM = card('Test Golem', 'Creature — Golem', '', { pt: ['3', '3'], cost: '{3}' });
const BANNER = card('Test Banner', 'Artifact', '{T}: The next spell you cast this turn has convoke.');
const SQUIRE = card('Test Squire', 'Creature — Human', '', { pt: ['1', '1'] });
const FORGE = card('Test Forge', 'Artifact', '{T}: The next spell you cast this turn has improvise.');
const KEYWORD_DEFS = [WRENCH, COG, NOTION, IDEA, GOLEM, BANNER, SQUIRE, FORGE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [WRENCH, PLOTTER, CURATOR, DIG]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
    // the convoke template is experimental (design 6.9: no usable evidence yet), which caps the card at partial; its ability itself is automated
    expect(BANNER.automation.level).toBe('partial');
    expect(BANNER.automation.faces![0]!.abilities.every((a) => a.level === 'full')).toBe(true);
  });
});

describe('CR 601.2a, 601.2f, 702.41a: "the next noncreature spell you cast this turn has affinity for artifacts"', () => {
  const board = (): GameState => scenario([], { defs: KEYWORD_DEFS, p1: { hand: ['Test Notion', 'Test Idea', 'Test Golem'], battlefield: ['Test Wrench', 'Test Cog', 'Test Cog'] } });
  it('before the ability, a {3} sorcery is not castable with no mana; after it, the sorcery costs {0} with three artifacts', () => {
    let s = board();
    expect(castAction(s, 'Test Notion')).toBeUndefined();
    s = resolveAll(act(s, activateAction(s, 'Test Wrench')!));
    expect(s.turn.nextSpell?.length).toBe(1);
    const c = castAction(s, 'Test Notion');
    expect(c).toBeDefined();
    s = resolveAll(act(s, c!));
    expect(yardNames(s)).toContain('Test Notion');
    expect(s.turn.nextSpell ?? []).toEqual([]);
  });
  it('a creature spell does not get affinity (the filter), and only the next noncreature spell does: the second sorcery is full price again', () => {
    let s = board();
    s = resolveAll(act(s, activateAction(s, 'Test Wrench')!));
    expect(castAction(s, 'Test Golem')).toBeUndefined();
    s = resolveAll(act(s, castAction(s, 'Test Notion')!));
    expect(castAction(s, 'Test Idea')).toBeUndefined();
  });
  it('CR 514.2, 611.2: the rider ends with the turn', () => {
    let s = board();
    s = resolveAll(act(s, activateAction(s, 'Test Wrench')!));
    for (let i = 0; i < 400 && s.turn.number === 1; i++) s = settle(pass(s));
    expect(s.turn.nextSpell).toBeUndefined();
  });
});

describe('CR 702.51a, 601.2h: "the next spell you cast this turn has convoke"', () => {
  it('three untapped creatures pay for a {3} sorcery; a second sorcery has no convoke', () => {
    let s = scenario([], { defs: KEYWORD_DEFS, p1: { hand: ['Test Notion', 'Test Idea'], battlefield: ['Test Banner', 'Test Squire', 'Test Squire', 'Test Squire'] } });
    expect(castAction(s, 'Test Notion')).toBeUndefined();
    s = resolveAll(act(s, activateAction(s, 'Test Banner')!));
    const squires = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Squire');
    s = resolveAll(act(s, castAction(s, 'Test Notion')!), { objects: squires });
    expect(yardNames(s)).toContain('Test Notion');
    expect(squires.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(castAction(s, 'Test Idea')).toBeUndefined();
  });
});

describe('CR 702.126a, 601.2h: "the next spell you cast this turn has improvise"', () => {
  it('two untapped artifacts pay {2} of a {3} sorcery, the tapped Forge pays nothing; with only one other artifact it stays uncastable', () => {
    let s = scenario(['Mountain'], { defs: KEYWORD_DEFS, p1: { hand: ['Test Notion'], battlefield: ['Test Forge', 'Test Cog', 'Test Cog', 'Mountain'] } });
    expect(castAction(s, 'Test Notion')).toBeUndefined();
    s = resolveAll(act(s, activateAction(s, 'Test Forge')!));
    const cogs = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Cog');
    s = resolveAll(act(s, castAction(s, 'Test Notion')!), { objects: cogs });
    expect(yardNames(s)).toContain('Test Notion');
    expect(cogs.every((id) => s.objects[id]!.tapped)).toBe(true);
    let t = scenario(['Mountain'], { defs: KEYWORD_DEFS, p1: { hand: ['Test Notion'], battlefield: ['Test Forge', 'Test Cog', 'Mountain'] } });
    t = resolveAll(act(t, activateAction(t, 'Test Forge')!));
    expect(castAction(t, 'Test Notion')).toBeUndefined();
  });
});

// ---- plotting costs less ----------------------------------------------------------------------------------------------------------------------------------

const PLOTTER = card('Test Plot Mentor', 'Creature — Human', 'Plotting cards from your hand costs {2} less.', { pt: ['2', '2'] });
const OUTLAW = card('Test Outlaw', 'Creature — Human Rogue', 'Plot {3}{R}', { pt: ['3', '3'], cost: '{3}{R}' });
const DRIFTER = card('Test Drifter', 'Creature — Human', 'Plot {1}', { pt: ['1', '1'], cost: '{1}' });

describe('CR 702.170a, 601.2f, 118.7: "Plotting cards from your hand costs {2} less."', () => {
  const board = (mentor: 'p1' | 'p2'): GameState => scenario(['Mountain'], {
    defs: [PLOTTER, OUTLAW, DRIFTER],
    p1: { hand: ['Test Outlaw', 'Test Drifter'], battlefield: [...lands('Mountain', 2), ...(mentor === 'p1' ? ['Test Plot Mentor'] : [])] },
    p2: { battlefield: mentor === 'p2' ? ['Test Plot Mentor'] : [] },
  });
  it('plot {3}{R} costs {1}{R}: listed and paid with two Mountains', () => {
    let s = board('p1');
    const pl = plotAction(s, 'Test Outlaw');
    expect(pl?.label).toBe('Plot Test Outlaw ({1}{R})');
    s = settle(act(s, pl!.action));
    expect(tappedCount(s)).toBe(2);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Outlaw')).toBe(true);
  });
  it('a reduction never takes the plot cost below {0} (CR 118.7): plot {1} costs nothing', () => {
    let s = board('p1');
    s = settle(act(s, plotAction(s, 'Test Drifter')!.action));
    expect(tappedCount(s)).toBe(0);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Drifter')).toBe(true);
  });
  it('another player\'s ability does not reduce your plotting ("from your hand", caster you): plot {3}{R} is not payable with two lands', () => {
    expect(plotAction(board('p2'), 'Test Outlaw')).toBeUndefined();
  });
});

// ---- whenever you discover ----------------------------------------------------------------------------------------------------------------------------------

const CURATOR = card('Test Curator', 'Creature — Human Artificer', 'Whenever you discover, discover again for the same value. This ability triggers only once each turn.', { pt: ['2', '2'] });
const DIG = card('Test Dig', 'Sorcery', 'Discover 2.');
const PEBBLE = card('Test Pebble', 'Sorcery', 'Draw a card.', { cost: '{1}' });
const BOULDER = card('Test Boulder', 'Sorcery', 'Draw a card.', { cost: '{3}' });

describe('CR 701.57a, 603.2: "Whenever you discover, discover again for the same value. This ability triggers only once each turn."', () => {
  /** p1's library is only these cards (in this order from the top, whichever end the engine reads as the top). */
  const board = (library: string[], curator = true): GameState => {
    const s = scenario([], { defs: [CURATOR, DIG, PEBBLE, BOULDER], p1: { hand: ['Test Dig', 'Test Dig'], battlefield: curator ? ['Test Curator'] : [] } });
    s.zones.library['p1'] = [];
    for (const n of library) put(s, 'p1', 'library', n);
    return s;
  };
  it('the second discover is for the same value: a {3} card is skipped by both, two {1} cards go to the hand', () => {
    let s = board(['Test Pebble', 'Test Boulder', 'Test Pebble', 'Test Boulder', 'Test Pebble']);
    s = resolveAll(act(s, castAction(s, 'Test Dig')!), { yes: false });
    expect(handNames(s).filter((n) => n === 'Test Pebble')).toHaveLength(2);
    expect(handNames(s)).not.toContain('Test Boulder');
  });
  it('it triggers only once each turn: a second discover that turn is not repeated', () => {
    let s = board(['Test Pebble', 'Test Pebble', 'Test Pebble', 'Test Pebble']);
    s = resolveAll(act(s, castAction(s, 'Test Dig')!), { yes: false });
    s = resolveAll(act(s, castAction(s, 'Test Dig')!), { yes: false });
    expect(handNames(s).filter((n) => n === 'Test Pebble')).toHaveLength(3);
  });
  it('without the creature, one discover finds one card', () => {
    let s = board(['Test Pebble', 'Test Pebble', 'Test Pebble'], false);
    s = resolveAll(act(s, castAction(s, 'Test Dig')!), { yes: false });
    expect(handNames(s).filter((n) => n === 'Test Pebble')).toHaveLength(1);
  });
});

// ---- distribute counters among objects chosen on resolution --------------------------------------------------------------------------------------------------

const WAVE = card('Test Undertow', 'Sorcery', 'Tap up to two target creatures, then distribute three stun counters among any number of tapped creatures your opponents control.');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['3', '3'] });
const IMP = card('Test Imp', 'Creature — Imp', '', { pt: ['1', '1'] });

/** Pass priority until the top of the stack resolves into a decision (or the stack is empty). */
function toDecision(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 10 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
  return s;
}

describe('CR 608.2d, 122.1: "distribute three stun counters among any number of tapped creatures your opponents control" (chosen and divided on resolution)', () => {
  const board = (): GameState => scenario([], { defs: [WAVE, BRUTE, IMP], p1: { hand: ['Test Undertow'], battlefield: ['Test Imp'] }, p2: { battlefield: ['Test Brute', 'Test Brute', 'Test Imp'] } });
  const stun = (s: GameState, id: string): number => s.objects[id]!.counters['stun'] ?? 0;
  it('the two creatures tapped by the spell get the counters as divided (2 and 1); an untapped creature of the opponent and your own tapped creature get none', () => {
    let s = board();
    const [b1, b2] = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Brute');
    const theirImp = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Imp' && s.objects[id]!.controller === 'p2')!;
    const myImp = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Imp' && s.objects[id]!.controller === 'p1')!;
    s.objects[myImp]!.tapped = true;
    s = act(s, castAction(s, 'Test Undertow')!);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: b1! }, { kind: 'object', id: b2! }] });
    s = toDecision(settle(s));
    const d = s.pending as unknown as { kind: string; options: string[]; max: number };
    expect(d.kind).toBe('chooseObjects');
    expect([...d.options].sort()).toEqual([b1!, b2!].sort()); // only the tapped creatures your opponents control
    expect(d.max).toBe(2);
    s = answer(s, { kind: 'chooseObjects', ids: [b1!, b2!] });
    expect(s.pending?.kind).toBe('chooseDivision');
    s = answer(s, { kind: 'chooseDivision', amounts: [2, 1] });
    s = settle(s);
    expect([stun(s, b1!), stun(s, b2!), stun(s, theirImp), stun(s, myImp)]).toEqual([2, 1, 0, 0]);
  });
  it('each chosen creature gets at least one counter, and the amounts add up to three (CR 601.2d\'s division rule)', () => {
    let s = board();
    const [b1, b2] = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Brute');
    s = act(s, castAction(s, 'Test Undertow')!);
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: b1! }, { kind: 'object', id: b2! }] }));
    s = answer(toDecision(s), { kind: 'chooseObjects', ids: [b1!, b2!] });
    const bad = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseDivision', amounts: [3, 0] } } as unknown as Action);
    expect(bad.error).toBeDefined();
  });
  it('one chosen creature gets all three; with no tapped creature of an opponent, nothing happens', () => {
    let s = board();
    const [b1] = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Brute');
    s = act(s, castAction(s, 'Test Undertow')!);
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: b1! }] }));
    s = settle(answer(toDecision(s), { kind: 'chooseObjects', ids: [b1!] }));
    expect(stun(s, b1!)).toBe(3);
    let t = board();
    t = act(t, castAction(t, 'Test Undertow')!);
    t = settle(answer(t, { kind: 'chooseTargets', targets: [] }));
    t = resolveAll(t);
    expect(t.zones.battlefield.every((id) => stun(t, id) === 0)).toBe(true);
  });
});

// ---- a player gains control of any number of target permanents; draw for each one they gained control of ----------------------------------------------------

const GIFT = card('Test Largesse', 'Sorcery', 'Target opponent gains control of any number of target permanents you control. Draw a card for each one they gained control of this way.');
const PET = card('Test Pet', 'Creature — Cat', '', { pt: ['1', '1'] });
const SHOO = card('Test Shoo', 'Instant', "Return target creature to its owner's hand.");

describe('CR 611.2c, 613.1b, 608.2c: "Target opponent gains control of any number of target permanents you control. Draw a card for each one they gained control of this way."', () => {
  const board = (): GameState => scenario([], { defs: [GIFT, PET, SHOO], p1: { hand: ['Test Largesse', 'Test Shoo'], battlefield: ['Test Pet', 'Test Pet', 'Test Pet'] } });
  const pets = (s: GameState): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Pet');
  it('two targets: the opponent controls both, you draw two cards; the third creature stays yours', () => {
    let s = board();
    const [a, b, c] = pets(s);
    const hand = s.zones.hand['p1']!.length;
    s = act(s, castAction(s, 'Test Largesse')!);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: a! }, { kind: 'object', id: b! }] });
    s = resolveAll(s);
    expect([s.objects[a!]!.controller, s.objects[b!]!.controller, s.objects[c!]!.controller]).toEqual(['p2', 'p2', 'p1']);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 2);
  });
  it('CR 608.2b: a target that left the battlefield is not gained: one card for the one creature they gained control of', () => {
    let s = board();
    const [a, b] = pets(s);
    s = act(s, castAction(s, 'Test Largesse')!);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: a! }, { kind: 'object', id: b! }] }));
    // in response, p1 bounces one of the targets
    s = act(s, castAction(s, 'Test Shoo')!);
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: b! }] }));
    const before = s.zones.hand['p1']!.length;
    s = resolveAll(s);
    expect(s.objects[a!]!.controller).toBe('p2');
    expect(s.zones.hand['p1']!.length).toBe(before + 1 + 1); // the bounced Pet, and one card drawn
  });
});
