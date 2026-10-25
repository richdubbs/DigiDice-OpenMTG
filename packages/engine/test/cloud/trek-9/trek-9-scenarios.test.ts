/**
 * Lane trek, round trek-9 (Star Trek: library, graveyard and odd ones), played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 701.20e, 608.2c-d, 609.3   "Put a land card from among them onto the battlefield tapped and the rest into your graveyard.": exactly one land, tapped; none to put
 *                                 when there is no land; the rest of the cards looked at into the graveyard
 *   CR 701.20a, 202.3, 400.7      "You may reveal a Plains card or nonland permanent card with mana value 3 or less from among them and put it into your hand":
 *                                 the mana value belongs to the last description only (a Plains card is a land: mana value 0)
 *   CR 205.2a, 607.2a, 608.2c     a Saga: "If all cards exiled with this Saga share a card type, you gain 10 life.": the cards the chapters exiled, every one of them
 *   CR 701.24a, 400.3, 108.3      "Choose up to two target cards in graveyards. The owners of those cards shuffle them into their libraries."
 *   CR 118.3, 602.2b, 113.6j      "{2}, Put this card from your graveyard on the bottom of your library: You gain 2 life.": paid from the graveyard only
 *   CR 301.5, 303.4               "creatures you control with a Communicator attached to them": the attached permanent's subtype (rules/filter.ts, statics/match.ts)
 *   CR 122.1, 608.2c              "Then discard a card unless there are three or more quest counters on ~."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';
const namesIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', who: PlayerId): string[] => s.zones[zone][who]!.map((id) => s.objects[id]!.defId);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState, prompt: string) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s, p.prompt ?? '') : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);
/** Pass priority to the given turn's precombat main phase (answering attack and block declarations and the end of turn's discards), then resolve what triggered there. */
function toMain(s0: GameState, turn: number, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let guard = 0; !(s.turn.number === turn && s.turn.step === 'main1') && guard < 600; guard++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [d.options.find((id) => s.objects[id]!.defId === 'Plains') ?? d.options[0]!].slice(0, d.max) }); // the discard to the hand size
    else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s, o);
    else s = pass(s);
  }
  return resolveAll(s, o);
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FOREST = card('Test Grove', 'Land — Forest', '');
const RELIC = card('Test Relic', 'Artifact', '');

// ---- CR 701.20e, 608.2c-d, 609.3: Hit It! -----------------------------------------------------------------------------------------------------------------

describe('CR 701.20e, 608.2c-d, 609.3: "Put a land card from among them onto the battlefield tapped and the rest into your graveyard."', () => {
  const HIT = card('Test Hit', 'Enchantment', 'Creatures you control have haste.\nWhen this enchantment enters, look at the top five cards of your library. Put a land card from among them onto the battlefield tapped and the rest into your graveyard.');
  const defs = [HIT, BEAR, FOREST, RELIC];
  it('is fully automated', () => expect(full(HIT)).toBe(true));
  it('exactly one of two lands among the five enters tapped (the chosen one), the other land and the others go to the graveyard; the sixth card stays on top', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hit'], library: ['Test Bear', 'Test Grove', 'Test Relic', 'Plains', 'Test Bear', 'Test Relic'] } });
    const lands = [find(s, 'Test Grove', 'library', 'p1'), s.zones.library['p1']![3]!]; // the Grove and the Plains among the first five
    const sixth = s.zones.library['p1']![5]!;
    s = cast(s, 'Test Hit', { pick: (options) => [options.includes(lands[0]!) ? lands[0]! : options[0]!] });
    const onField = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && ['Test Grove', 'Plains'].includes(s.objects[id]!.defId));
    expect(onField.length).toBe(1);
    expect(s.objects[onField[0]!]!.tapped).toBe(true);
    expect(s.objects[onField[0]!]!.defId).toBe('Test Grove');
    expect(namesIn(s, 'graveyard', 'p1').sort()).toEqual(['Plains', 'Test Bear', 'Test Bear', 'Test Relic'].sort());
    expect(zoneOf(s, sixth)).toBe('library');
  });
  it('no land among the five: nothing enters, all five go to the graveyard (CR 609.3: the choice is clamped to what exists)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hit'], library: ['Test Bear', 'Test Bear', 'Test Relic', 'Test Relic', 'Test Bear', 'Test Grove'] } });
    s = cast(s, 'Test Hit');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1').map((id) => s.objects[id]!.defId)).toEqual(['Test Hit']);
    expect(namesIn(s, 'graveyard', 'p1').length).toBe(5);
    expect(namesIn(s, 'library', 'p1')[0]).toBe('Test Grove'); // a land below the fifth card is not among them
  });
  it('a land deeper than the fifth card is never put onto the battlefield; a single land among them is chosen without a question', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hit'], library: ['Test Bear', 'Test Bear', 'Test Relic', 'Test Grove', 'Test Bear', 'Test Grove'] } });
    s = cast(s, 'Test Hit');
    expect(findAll(s, 'Test Grove', 'battlefield', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Grove', 'library', 'p1').length).toBe(1);
    expect(s.objects[findAll(s, 'Test Grove', 'battlefield', 'p1')[0]!]!.tapped).toBe(true);
  });
  it('its static ability: creatures you control have haste', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hit'], battlefield: [{ name: 'Test Bear', since: 1 }] } });
    s = cast(s, 'Test Hit');
    expect(chars(s, find(s, 'Test Bear', 'battlefield', 'p1')).keywords.some((k) => k.keyword === 'haste')).toBe(true);
  });
});

// ---- CR 701.20a, 202.3: There's Coffee in that Nebula --------------------------------------------------------------------------------------------------------

describe('CR 701.20a, 202.3, 400.7: "You may reveal a Plains card or nonland permanent card with mana value 3 or less from among them and put it into your hand."', () => {
  const BREW = card('Test Brew', 'Sorcery', 'Look at the top five cards of your library. You may reveal a Plains card or nonland permanent card with mana value 3 or less from among them and put it into your hand. Put the rest on the bottom in a random order.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'], cost: '{4}{R}' });
  const IMP = card('Test Imp', 'Creature — Imp', '', { pt: ['1', '1'], cost: '{1}{B}' });
  const MACE = card('Test Mace', 'Artifact', '', { cost: '{3}' });
  const SLAB = card('Test Slab', 'Artifact', '', { cost: '{4}' });
  const BOLT = card('Test Zap', 'Instant', 'Draw a card.', { cost: '{R}' });
  const defs = [BREW, OGRE, IMP, MACE, SLAB, BOLT, FOREST];
  const run = (library: string[], pick: (options: ObjectId[], s: GameState) => ObjectId[]) => {
    const seen: ObjectId[][] = [];
    let s = scenario([], { defs, p1: { hand: ['Test Brew'], library } });
    const top = [...s.zones.library['p1']!].slice(0, 5);
    s = cast(s, 'Test Brew', { pick: (options, st) => { seen.push([...options]); return pick(options, st); } });
    return { s, seen, top };
  };
  it('is fully automated', () => expect(full(BREW)).toBe(true));
  it('offers exactly the Plains card and the nonland permanent cards of mana value 3 or less: not the Forest, the mana value 5 creature or the instant', () => {
    const { s, seen, top } = run(['Test Ogre', 'Test Imp', 'Plains', 'Test Grove', 'Test Zap', 'Plains'], (options) => [options[0]!]);
    expect(seen.length).toBe(1);
    expect(new Set(seen[0]!)).toEqual(new Set([top[1]!, top[2]!])); // Test Imp (mana value 2) and Plains
    expect(s.zones.battlefield.length).toBe(0);
  });
  it('the chosen card goes to your hand (revealed), the other four to the bottom of your library; the card below the five is now on top', () => {
    const { s, top } = run(['Test Ogre', 'Test Imp', 'Plains', 'Test Grove', 'Test Zap', 'Test Mace'], (options, st) => [options.find((id) => st.objects[id]!.defId === 'Test Imp')!]);
    expect(namesIn(s, 'hand', 'p1')).toContain('Test Imp');
    const lib = namesIn(s, 'library', 'p1');
    expect(lib[0]).toBe('Test Mace');
    expect(lib.slice(-4).sort()).toEqual(['Plains', 'Test Grove', 'Test Ogre', 'Test Zap'].sort());
    expect(top.filter((id) => zoneOf(s, id) === 'library').length).toBe(0); // the five were re-created in new zones (CR 400.7)
  });
  it('the mana value limit is inclusive and belongs to the permanent description: a mana value 3 artifact may be taken, a mana value 4 artifact may not; a Plains card has no limit to meet', () => {
    const a = run(['Test Mace', 'Test Slab', 'Test Ogre', 'Test Zap', 'Test Grove', 'Plains'], (options) => options);
    expect(a.seen[0]!.length).toBe(1);
    expect(namesIn(a.s, 'hand', 'p1')).toContain('Test Mace');
    const b = run(['Test Slab', 'Test Ogre', 'Test Zap', 'Test Grove', 'Test Slab', 'Plains'], (options) => options);
    expect(b.seen.length).toBe(0); // nothing to choose among: no question is asked
    expect(namesIn(b.s, 'hand', 'p1').filter((n) => n !== 'Plains')).toEqual([]);
  });
  it('you may choose none: the hand is unchanged and all five cards go to the bottom', () => {
    const { s } = run(['Test Imp', 'Plains', 'Test Ogre', 'Test Zap', 'Test Grove', 'Test Mace'], () => []);
    expect(namesIn(s, 'hand', 'p1')).toEqual([]);
    expect(namesIn(s, 'library', 'p1')[0]).toBe('Test Mace');
    expect(namesIn(s, 'library', 'p1').slice(-5).sort()).toEqual(['Plains', 'Test Grove', 'Test Imp', 'Test Ogre', 'Test Zap']);
  });
});

// ---- CR 205.2a, 607.2a, 608.2c: All Good Things... ----------------------------------------------------------------------------------------------------------

describe('CR 205.2a, 607.2a, 608.2c: "IV -- If all cards exiled with this Saga share a card type, you gain 10 life."', () => {
  const chapters = (last: string): string => `(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III -- Draw two cards, then exile a card from your hand.\nIV -- ${last}`;
  const SAGA = card('Test Last Voyage', 'Enchantment — Saga', chapters('If all cards exiled with this Saga share a card type, you gain 10 life.'));
  const HUE = card('Test Last Colors', 'Enchantment — Saga', chapters('If all cards exiled with this Saga share a color, you gain 10 life.'));
  const GEAR = card('Test Gearbeast', 'Artifact Creature — Construct', '', { pt: ['1', '1'] });
  const REDMAN = card('Test Red Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['R'] });
  const REDRELIC = card('Test Red Idol', 'Artifact', '', { colors: ['R'] });
  const BLUEMAN = card('Test Blue Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['U'] });
  const defs = [SAGA, HUE, BEAR, RELIC, GEAR, FOREST, REDMAN, REDRELIC, BLUEMAN];
  /** Play the Saga through chapter IV exiling the named cards from hand, one per chapter, in order. */
  const play = (saga: string, exile: [string, string, string], hand: string[]): GameState => {
    const queue = [...exile];
    let s = scenario([], { defs, p1: { hand: [saga, ...hand] } });
    const o = { pick: (options: ObjectId[], st: GameState): ObjectId[] => { const want = queue[0]; const hit = options.find((id) => st.objects[id]!.defId === want); if (hit !== undefined) queue.shift(); return [hit ?? options[0]!]; } };
    s = cast(s, saga, o);
    s = toMain(s, 3, o);
    s = toMain(s, 5, o);
    expect(queue).toEqual([]);
    return s;
  };
  it('both wordings are fully automated', () => {
    expect(full(SAGA)).toBe(true);
    expect(full(HUE)).toBe(true);
  });
  it('chapters I to III exile a card each (three cards linked to the Saga); three creatures share the type Creature: chapter IV gains 10 life, then the Saga is sacrificed', () => {
    let s = play('Test Last Voyage', ['Test Bear', 'Test Bear', 'Test Bear'], ['Test Bear', 'Test Bear', 'Test Bear']);
    expect(s.zones.exile.length).toBe(3);
    const before = life(s, 'p1');
    s = toMain(s, 7);
    expect(life(s, 'p1')).toBe(before + 10);
    expect(findAll(s, 'Test Last Voyage', 'battlefield').length).toBe(0);
  });
  it('the type must be common to EVERY card, not to two of them: an artifact creature, an artifact and a creature (each pair shares a type) gain no life', () => {
    let s = play('Test Last Voyage', ['Test Gearbeast', 'Test Relic', 'Test Bear'], ['Test Gearbeast', 'Test Relic', 'Test Bear']);
    const before = life(s, 'p1');
    s = toMain(s, 7);
    expect(life(s, 'p1')).toBe(before);
  });
  it('a card type that every card has although it is not the only one: two artifact creatures and an artifact all are artifacts: 10 life', () => {
    let s = play('Test Last Voyage', ['Test Gearbeast', 'Test Relic', 'Test Gearbeast'], ['Test Gearbeast', 'Test Relic', 'Test Gearbeast']);
    const before = life(s, 'p1');
    s = toMain(s, 7);
    expect(life(s, 'p1')).toBe(before + 10);
  });
  it('a land and a creature share no type: no life', () => {
    let s = play('Test Last Voyage', ['Test Grove', 'Test Bear', 'Test Bear'], ['Test Grove', 'Test Bear', 'Test Bear']);
    const before = life(s, 'p1');
    s = toMain(s, 7);
    expect(life(s, 'p1')).toBe(before);
  });
  it('only the cards this Saga exiled count: a card another effect exiled earlier is no part of them', () => {
    const queue = ['Test Bear', 'Test Bear', 'Test Bear'];
    let s = scenario([], { defs, p1: { hand: ['Test Last Voyage', 'Test Bear', 'Test Bear', 'Test Bear'], exile: ['Test Grove'] } });
    const o = { pick: (options: ObjectId[], st: GameState): ObjectId[] => { const hit = options.find((id) => st.objects[id]!.defId === queue[0]); if (hit !== undefined) queue.shift(); return [hit ?? options[0]!]; } };
    s = cast(s, 'Test Last Voyage', o);
    s = toMain(s, 3, o);
    s = toMain(s, 5, o);
    const before = life(s, 'p1');
    s = toMain(s, 7);
    expect(life(s, 'p1')).toBe(before + 10); // the land exiled before is not "exiled with this Saga"
  });
  it('the color wording: three red cards of different types share red (10 life); a blue one among them does not', () => {
    let s = play('Test Last Colors', ['Test Red Imp', 'Test Red Idol', 'Test Red Imp'], ['Test Red Imp', 'Test Red Idol', 'Test Red Imp']);
    const before = life(s, 'p1');
    s = toMain(s, 7);
    expect(life(s, 'p1')).toBe(before + 10);
    let t = play('Test Last Colors', ['Test Red Imp', 'Test Blue Imp', 'Test Red Imp'], ['Test Red Imp', 'Test Blue Imp', 'Test Red Imp']);
    const b2 = life(t, 'p1');
    t = toMain(t, 7);
    expect(life(t, 'p1')).toBe(b2);
  });
});

// ---- CR 701.24a, 400.3, 108.3: Those Old Scientists ----------------------------------------------------------------------------------------------------------

describe('CR 701.24a, 400.3, 108.3: "Choose up to two target cards in graveyards. The owners of those cards shuffle them into their libraries."', () => {
  const RESHUFFLE = card('Test Reshuffle', 'Sorcery', 'Choose up to two target cards in graveyards. The owners of those cards shuffle them into their libraries.');
  const defs = [RESHUFFLE, BEAR, RELIC, FOREST];
  const shuffles = (s: GameState): string[] => s.log.filter((l) => /shuffles their library/.test(l.text)).map((l) => l.text);
  it('is fully automated', () => expect(full(RESHUFFLE)).toBe(true));
  it('two cards of different owners go to their own owners\' libraries, and each owner shuffles their library (two shuffles)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Reshuffle'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Relic'] } });
    const mine = find(s, 'Test Bear', 'graveyard', 'p1');
    const theirs = find(s, 'Test Relic', 'graveyard', 'p2');
    s = cast(s, 'Test Reshuffle', { targets: [[mine, theirs]] });
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Test Reshuffle']);
    expect(namesIn(s, 'graveyard', 'p2')).toEqual([]);
    expect(namesIn(s, 'library', 'p1')).toContain('Test Bear');
    expect(namesIn(s, 'library', 'p2')).toContain('Test Relic');
    expect(namesIn(s, 'library', 'p1')).not.toContain('Test Relic');
    expect(shuffles(s).length).toBe(2);
    expect(shuffles(s).map((t) => t.split(' ')[0]).sort()).toEqual(['Alice', 'Bob']);
  });
  it('two cards of one owner: both go to that owner\'s library, which is shuffled once; an opponent who owns none shuffles nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Reshuffle'], graveyard: ['Test Bear', 'Test Grove'] } });
    const a = find(s, 'Test Bear', 'graveyard', 'p1');
    const b = find(s, 'Test Grove', 'graveyard', 'p1');
    s = cast(s, 'Test Reshuffle', { targets: [[a, b]] });
    expect(namesIn(s, 'library', 'p1')).toEqual(expect.arrayContaining(['Test Bear', 'Test Grove']));
    expect(shuffles(s).length).toBe(1);
  });
  it('up to two: choosing no card moves nothing and shuffles nothing; a card that is not targeted stays', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Reshuffle'], graveyard: ['Test Bear', 'Test Grove'] }, p2: { graveyard: ['Test Relic'] } });
    const stays = find(s, 'Test Grove', 'graveyard', 'p1');
    s = cast(s, 'Test Reshuffle', { targets: [[]] });
    expect(shuffles(s)).toEqual([]);
    expect(namesIn(s, 'graveyard', 'p2')).toEqual(['Test Relic']);
    let t = scenario([], { defs, p1: { hand: ['Test Reshuffle'], graveyard: ['Test Bear', 'Test Grove'] } });
    const bear = find(t, 'Test Bear', 'graveyard', 'p1');
    t = cast(t, 'Test Reshuffle', { targets: [[bear]] });
    expect(zoneOf(t, find(t, 'Test Grove', 'graveyard', 'p1'))).toBe('graveyard');
    expect(shuffles(t).length).toBe(1);
    void stays;
  });
  it('a target in a library or on the battlefield is no target of it: only cards in graveyards are offered', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Reshuffle'], graveyard: ['Test Bear'], battlefield: ['Test Relic'] } });
    const bear = find(s, 'Test Bear', 'graveyard', 'p1');
    const relic = find(s, 'Test Relic', 'battlefield', 'p1');
    const cast1 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reshuffle', 'hand', 'p1') });
    expect(cast1.pending?.kind).toBe('chooseTargets');
    const options = (cast1.pending as { objects: ObjectId[] }).objects;
    expect(options).toContain(bear);
    expect(options).not.toContain(relic);
  });
});

// ---- CR 118.3, 602.2b, 113.6j: Daniels, Temporal Agent --------------------------------------------------------------------------------------------------------

describe('CR 118.3, 602.2b, 113.6j, 401.4: "{2}, Put this card from your graveyard on the bottom of your library: You gain 2 life."', () => {
  const AGENT = card('Test Agent', 'Legendary Creature — Human Advisor', 'When this creature enters, return target creature card from your graveyard to your hand.\n{2}, Put this card from your graveyard on the bottom of your library: You gain 2 life.', { pt: ['3', '1'] });
  const defs = [AGENT, BEAR];
  const activations = (s: GameState, id: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.object === id);
  it('is fully automated and functions in the graveyard only', () => {
    expect(full(AGENT)).toBe(true);
    const ab = AGENT.faces[0]!.abilities.find((a) => a.kind === 'activated') as { zone?: string[]; cost: { other?: { kind: string }[] } };
    expect(ab.zone).toEqual(['graveyard']);
    expect(ab.cost.other?.map((p) => p.kind)).toEqual(['putIntoLibrary']);
  });
  it('from the graveyard, paying {2}: the card goes to the bottom of its owner\'s library (a new object, CR 400.7) and you gain 2 life', () => {
    let s = scenario([], { defs, p1: { graveyard: ['Test Agent'], battlefield: ['Plains', 'Plains'], library: ['Test Bear'] } });
    const id = find(s, 'Test Agent', 'graveyard', 'p1');
    expect(activations(s, id).length).toBe(1);
    const before = life(s, 'p1');
    s = resolveAll(act(s, activations(s, id)[0]!.action));
    expect(life(s, 'p1')).toBe(before + 2);
    expect(zoneOf(s, id)).not.toBe('graveyard');
    expect(namesIn(s, 'graveyard', 'p1')).toEqual([]);
    const lib = namesIn(s, 'library', 'p1');
    expect(lib[0]).toBe('Test Bear');
    expect(lib[lib.length - 1]).toBe('Test Agent');
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.defId === 'Plains' && !s.objects[x]!.tapped).length).toBe(0); // the {2} was paid
  });
  it('the negative cases: not from the battlefield, not from the hand, and not without the {2}', () => {
    const onField = scenario([], { defs, p1: { battlefield: ['Test Agent', 'Plains', 'Plains'] } });
    expect(activations(onField, find(onField, 'Test Agent', 'battlefield', 'p1')).length).toBe(0);
    const inHand = scenario([], { defs, p1: { hand: ['Test Agent'], battlefield: ['Plains', 'Plains'] } });
    expect(activations(inHand, find(inHand, 'Test Agent', 'hand', 'p1')).length).toBe(0);
    const broke = scenario([], { defs, p1: { graveyard: ['Test Agent'], battlefield: ['Plains'] } });
    expect(activations(broke, find(broke, 'Test Agent', 'graveyard', 'p1')).length).toBe(0);
  });
  it('it is the owner\'s graveyard: an opponent cannot activate it', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Plains', 'Plains'] }, p2: { graveyard: ['Test Agent'], battlefield: ['Plains', 'Plains'] } });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Agent', 'graveyard', 'p2')).length).toBe(0);
  });
});

// ---- CR 301.5, 303.4, 608.2h: Starfleet Communicator --------------------------------------------------------------------------------------------------------

describe('CR 301.5, 303.4, 608.2h: "Equipped creature has "Whenever this creature attacks, draw X cards, then you may put up to X land cards from your hand onto the battlefield tapped, where X is the number of other creatures you control with a Communicator attached to them.""', () => {
  const LINK = card('Test Link', 'Artifact — Communicator Equipment', 'Equipped creature has "Whenever this creature attacks, draw X cards, then you may put up to X land cards from your hand onto the battlefield tapped, where X is the number of other creatures you control with a Communicator attached to them."\nEquip {1}');
  const PLAIN_GEAR = card('Test Sword', 'Artifact — Equipment', 'Equip {1}');
  const HAND_LANDS = ['Test Grove', 'Test Grove', 'Test Grove'];
  const defs = [LINK, PLAIN_GEAR, BEAR, FOREST];

  /** Attach `gear[i]` (a name) to the creature with index `to[i]`; the creatures are three Bears; p2 has one Bear. */
  function board(gear: [string, number | null][]): { s: GameState; bears: ObjectId[] } {
    const s = scenario([], { defs, p1: { hand: HAND_LANDS, battlefield: ['Test Bear', 'Test Bear', 'Test Bear', ...gear.map(([n]) => n)] }, p2: { battlefield: ['Test Bear'] } });
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const items = s.zones.battlefield.filter((id) => ['Test Link', 'Test Sword'].includes(s.objects[id]!.defId));
    gear.forEach(([, to], i) => { if (to !== null) s.objects[items[i]!]!.attachedTo = bears[to]!; });
    return { s, bears };
  }
  /** Attack with the given creatures and resolve every trigger, choosing the lands to put by `pick` (the first by default). */
  function attack(s0: GameState, who: ObjectId[], o: Parameters<typeof drive>[1] = {}): GameState {
    let s = s0;
    for (let guard = 0; guard < 80 && s.pending?.kind !== 'declareAttackers'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
    s = answer(s, { kind: 'declareAttackers', attacks: who.map((attacker) => ({ attacker, defender: 'p2' as PlayerId })) });
    return resolveAll(s, o);
  }
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  const lands = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Grove' && s.objects[id]!.owner === 'p1');

  it('is fully automated', () => expect(full(LINK)).toBe(true));
  it('X counts the OTHER creatures you control with a Communicator attached: two equipped creatures, one attacks: X = 1 (draw a card, put one land onto the battlefield tapped)', () => {
    const { s, bears } = board([['Test Link', 0], ['Test Link', 1]]);
    const t = attack(s, [bears[0]!]);
    expect(handSize(t)).toBe(3 + 1 - 1); // three lands, one drawn, one put onto the battlefield
    expect(lands(t).length).toBe(1);
    expect(t.objects[lands(t)[0]!]!.tapped).toBe(true);
  });
  it('the attacker itself is never counted: the only equipped creature attacks, X = 0: nothing is drawn, no land is put', () => {
    const { s, bears } = board([['Test Link', 0]]);
    const t = attack(s, [bears[0]!]);
    expect(handSize(t)).toBe(3);
    expect(lands(t).length).toBe(0);
  });
  it('three equipped creatures attack together: each trigger counts the two others, X = 2 for each (the draws add up; two lands are put by each, up to what the hand holds)', () => {
    const { s, bears } = board([['Test Link', 0], ['Test Link', 1], ['Test Link', 2]]);
    const t = attack(s, bears);
    expect(lands(t).length).toBe(3); // the three lands of the hand, all of them tapped
    expect(lands(t).every((id) => t.objects[id]!.tapped)).toBe(true);
    expect(handSize(t)).toBe(3 * 2 + 3 - 3); // 2 cards from each of three triggers, minus nothing else: the lands left the hand
  });
  it('X = 2 (three equipped creatures, one attacks): draw two cards and put up to two land cards, never three', () => {
    const { s, bears } = board([['Test Link', 0], ['Test Link', 1], ['Test Link', 2]]);
    const t = attack(s, [bears[0]!], { pick: (options) => options.slice(0, 2) });
    expect(handSize(t)).toBe(3 + 2 - 2);
    expect(lands(t).length).toBe(2);
    expect(() => attack(s, [bears[0]!], { pick: (options) => options.slice(0, 3) })).toThrow(); // more than X is no legal choice
  });
  it('the negative cases: an Equipment that is not a Communicator, and a Communicator attached to nothing, count for no creature', () => {
    const { s, bears } = board([['Test Link', 0], ['Test Sword', 1], ['Test Link', null]]);
    const t = attack(s, [bears[0]!]);
    expect(handSize(t)).toBe(3);
    expect(lands(t).length).toBe(0);
  });
  it('"you may": the lands are optional (declining puts none), and an opponent\'s equipped creature is not counted', () => {
    const { s, bears } = board([['Test Link', 0], ['Test Link', 1]]);
    const t = attack(s, [bears[0]!], { pick: () => [] });
    expect(lands(t).length).toBe(0);
    expect(handSize(t)).toBe(3 + 1); // the card was drawn all the same
    const u = scenario([], { defs, p1: { hand: HAND_LANDS, battlefield: ['Test Bear', 'Test Link'] }, p2: { battlefield: ['Test Bear', 'Test Link'] } });
    const mine = find(u, 'Test Bear', 'battlefield', 'p1');
    u.objects[find(u, 'Test Link', 'battlefield', 'p1')]!.attachedTo = mine;
    u.objects[find(u, 'Test Link', 'battlefield', 'p2')]!.attachedTo = find(u, 'Test Bear', 'battlefield', 'p2');
    const v = attack(u, [mine]);
    expect(handSize(v)).toBe(3);
  });
});

// ---- CR 301.5, 303.4: the filter field attachedWith, as the layer system reads it ---------------------------------------------------------------------------------

describe('CR 301.5, 303.4, 611.3a: "Creatures you control with an Equipment attached to them get +1/+1." (statics/match.ts) and the same description counted (rules/filter.ts)', () => {
  const BANNER = card('Test Banner', 'Enchantment', 'Creatures you control with a Communicator attached to them get +1/+1.');
  const GAIN = card('Test Tally', 'Sorcery', 'You gain life equal to the number of creatures you control with an Equipment attached to them.');
  const LINK = card('Test Link', 'Artifact — Communicator Equipment', 'Equip {1}');
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equip {1}');
  const defs = [BANNER, GAIN, LINK, SWORD, BEAR];
  it('both are fully automated', () => {
    expect(full(BANNER)).toBe(true);
    expect(full(GAIN)).toBe(true);
  });
  it('the static reads the attachment now: +1/+1 for a creature with a Communicator attached, none for one with another Equipment or none; it ends when the Communicator is unattached', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Banner', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Link', 'Test Sword'] } });
    const [a, b, c] = findAll(s, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId, ObjectId];
    s.objects[find(s, 'Test Link', 'battlefield', 'p1')]!.attachedTo = a;
    s.objects[find(s, 'Test Sword', 'battlefield', 'p1')]!.attachedTo = b;
    expect([a, b, c].map((id) => chars(s, id).power)).toEqual(['3', '2', '2']);
    delete s.objects[find(s, 'Test Link', 'battlefield', 'p1')]!.attachedTo;
    expect(chars(s, a).power).toBe('2');
  });
  it('the count of creatures you control with an Equipment attached: two of three; an Equipment of an opponent\'s creature does not count', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Tally'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Link', 'Test Sword'] }, p2: { battlefield: ['Test Bear', 'Test Sword'] } });
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[find(s, 'Test Link', 'battlefield', 'p1')]!.attachedTo = bears[0]!;
    s.objects[find(s, 'Test Sword', 'battlefield', 'p1')]!.attachedTo = bears[1]!;
    s.objects[find(s, 'Test Sword', 'battlefield', 'p2')]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p2');
    const before = life(s, 'p1');
    s = cast(s, 'Test Tally');
    expect(life(s, 'p1')).toBe(before + 2);
  });
});

// ---- design 6.4: the antecedent of "other" -----------------------------------------------------------------------------------------------------------------

describe('design 6.4: "other" counted for the size of an instruction that takes cards from a hand is other than ~; anything else the sentence names stays a candidate (fail closed)', () => {
  const manual = (name: string, type: string, text: string): void => {
    it(`stays manual: ${text}`, () => expect(full(card(name, type, text, { pt: ['1', '1'] }))).toBe(false));
  };
  it('"draw X cards, then you may put up to X land cards from your hand onto the battlefield tapped, where X is the number of other creatures you control": the cards are in the hand when X is counted; "other" is other than ~ (fully automated)', () => {
    const c = card('Test Settler', 'Creature — Human', 'Whenever this creature attacks, draw X cards, then you may put up to X land cards from your hand onto the battlefield tapped, where X is the number of other creatures you control.', { pt: ['1', '1'] });
    expect(full(c)).toBe(true);
  });
  // review of trek-9: a subtype of a card type, or a card type another type can combine with, is no disjoint kind (the first version compared the words)
  manual('Test Sweeper', 'Creature — Human', 'When this creature enters, destroy all Zombies, then tap all other creatures.');
  manual('Test Sweeper', 'Creature — Human', 'When this creature enters, destroy all Equipment, then tap all other artifacts.');
  manual('Test Sweeper', 'Creature — Human', 'When this creature enters, destroy all artifacts, then tap all other creatures.');
  // the cards put onto the battlefield could be among the creatures an "other" that is acted on afterwards, or counted afterwards, refers to
  manual('Test Settler', 'Creature — Human', 'Whenever this creature attacks, put a land card from your hand onto the battlefield tapped, then tap all other creatures you control.');
  manual('Test Settler', 'Creature — Human', 'Whenever this creature attacks, you may put up to X land cards from your hand onto the battlefield tapped, where X is the number of other creatures you control. Tap all other creatures you control.');
  manual('Test Settler', 'Creature — Human', 'Whenever this creature attacks, tap all other creatures you control, then you may put up to X land cards from your hand onto the battlefield tapped, where X is the number of other creatures you control.');
});

// ---- CR 122.1, 608.2c: Coastal Ren Faire --------------------------------------------------------------------------------------------------------------------

describe('CR 122.1, 608.2c: "Whenever you cast a noncreature spell, put a quest counter on ~. Draw a card. Then discard a card unless there are three or more quest counters on ~."', () => {
  const FAIRE = card('Test Faire', 'Enchantment', 'Whenever you cast a noncreature spell, put a quest counter on this enchantment. Draw a card. Then discard a card unless there are three or more quest counters on this enchantment.');
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [FAIRE, ZAP, BEAR];
  it('is fully automated', () => expect(full(FAIRE)).toBe(true));
  it('with fewer than three counters after the new one you discard a card; from the third counter on you do not; a creature spell is no trigger', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Zap', 'Test Zap', 'Test Zap', 'Test Bear', 'Plains', 'Plains', 'Plains'], battlefield: ['Test Faire'] } });
    const faire = find(s, 'Test Faire', 'battlefield', 'p1');
    const cast = (st: GameState, name: string): GameState => resolveAll(act(st, { type: 'cast', player: 'p1', card: find(st, name, 'hand', 'p1') }), { pick: (options, x) => [options.find((id) => x.objects[id]!.defId === 'Plains') ?? options[0]!] }); // discards a Plains
    s = cast(s, 'Test Bear'); // a creature spell: nothing happens
    expect(s.objects[faire]!.counters['quest'] ?? 0).toBe(0);
    expect(s.zones.hand['p1']!.length).toBe(6);
    s = cast(s, 'Test Zap'); // 1 counter: draw, discard (cast -1, draw +1, discard -1)
    expect(s.objects[faire]!.counters['quest']).toBe(1);
    expect(s.zones.hand['p1']!.length).toBe(5);
    s = cast(s, 'Test Zap'); // 2 counters: draw, discard
    expect(s.objects[faire]!.counters['quest']).toBe(2);
    expect(s.zones.hand['p1']!.length).toBe(4);
    s = cast(s, 'Test Zap'); // 3 counters: draw, no discard
    expect(s.objects[faire]!.counters['quest']).toBe(3);
    expect(s.zones.hand['p1']!.length).toBe(4); // one Zap cast (-1), one card drawn (+1), nothing discarded
  });
  it('the counter is put before the count is read: with two counters already on it, the third spell draws without discarding', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Zap'], battlefield: [{ name: 'Test Faire', counters: { quest: 2 } }] } });
    s = cast(s, 'Test Zap');
    expect(s.zones.hand['p1']!.length).toBe(1); // cast one, drew one
  });
});
