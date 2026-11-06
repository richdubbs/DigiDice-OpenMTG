/**
 * edh-d-92 (Commander coordinator D, band 5,001-10,000, group counters): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. Scryfall rulings were fetched in the cloud
 * session; CR cites were checked against the 2026-09-25 Comprehensive Rules text unless the record lists them as unverified.
 *
 *   CR 608.2d, 406.1, 101.4             "Exile an instant or sorcery card from each graveyard." (Summon: Esper Valigarmanda): you choose one card from each graveyard
 *   CR 607.2a, 608.2g, 601.2, 609.4b    "You may cast an instant or sorcery card exiled with this Saga, and mana of any type can be spent to cast that spell." (the same card)
 *   CR 607.2a, 714.2b, 400.7            "the exiled card" of a chapter that exiles nothing itself: the card chapter I exiled (The Aesir Escape Valhalla)
 *   CR 122.1, 701.10e, 608.2c, 119.3    "double the number of +1/+1 counters on ~ if its power is 16 or less. Otherwise, remove all but one +1/+1 counter from it, then you gain 1 life
 *                                       for each +1/+1 counter removed this way." (Lily Bowen, Raging Grandma)
 *   CR 701.47a, 701.47c, 120.3, 608.2h "Amass Zombies 2, then the Army you amassed deals damage equal to its power to each non-Army creature." (Widespread Brutality)
 *   CR 208.1, 700.4, 701.55a, 608.2h    "... each of your opponents loses life equal to the total power of Daleks that died this turn" (Genesis of the Daleks: the powers as they last existed)
 *   CR 701.26a, 608.2d, 608.2h, 702.32a "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this
 *                                       artifact." (Tangle Wire: that player chooses; all of them when they have fewer)
 *   CR 115.1, 702.62b, 122.1, 608.2d    "Choose target permanent you control or suspended card you own. If that permanent or card has a time counter on it, you may remove a time counter
 *                                       from it or put another time counter on it." (Jhoira's Timebug)
 *   CR 115.9b, 603.2, 120.3             "Whenever you cast a spell that targets a creature you don't control, ~ deals damage equal to its power to up to one target creature." (Legolas,
 *                                       Master Archer: the controller phrase belongs to the targeted creature; one trigger per spell)
 *   CR 406.1, 608.2c, 122.1, 702.62a-b  "Exile the top five cards of your library. For each nonland card exiled this way, put a number of time counters on that card equal to its mana
 *                                       value. If it doesn't have suspend, it gains suspend." (The Parting of the Ways)
 *   CR 611.3a, 613.1d, 613.1f, 205.1b  "During your turn, artifacts you control are Foods in addition to their other types and have "..."" (Gourmand's Talent)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, listLegalActions, type CardDef, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id)).sort();

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; options?: string[][]; objects?: (string[] | ((options: string[], s: GameState) => string[]))[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options as string[], s) : pick ?? (p.options as string[]).slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
/** The options of a choice whose card has this name. */
const named = (n: string) => (options: string[], s: GameState): string[] => options.filter((id) => nameOf(s, id) === n).slice(0, 1);
/** p1's next precombat main phase, after its draw step (the Saga gets its next lore counter and its chapter triggers). */
const nextMain = (s: GameState): GameState => passUntil(act(s, { type: 'pass', player: s.pending!.player }), (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && (t.zones.stack.length > 0 || t.pending?.kind !== 'priority'), "p1's next main phase");

// ---- Summon: Esper Valigarmanda ---------------------------------------------------------------------------------------------------------------------------------------------

const TIDE = card('Test Tide Drake', 'Enchantment Creature — Saga Drake', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Exile an instant or sorcery card from each graveyard.\nII, III — Add {R} for each lore counter on this Saga. You may cast an instant or sorcery card exiled with this Saga, and mana of any type can be spent to cast that spell.\nFlying', { pt: ['3', '3'] });
const MEND = card('Test Mend', 'Instant', 'You gain 3 life.', { cost: '{U}{U}', colors: ['U'] });
const SPARK = card('Test Spark', 'Sorcery', 'You gain 2 life.', { cost: '{B}', colors: ['B'] });
const HULK = card('Test Hulk', 'Creature — Giant', '', { cost: '{1}', pt: ['4', '4'] });
const RELIC = card('Test Relic', 'Artifact', '', { cost: '{1}' });

describe('CR 608.2d, 406.1, 101.4: "Exile an instant or sorcery card from each graveyard." (Summon: Esper Valigarmanda)', () => {
  const setup = (): GameState => mpScenario({
    defs: [TIDE, MEND, SPARK, HULK, RELIC],
    zones: { p1: { hand: ['Test Tide Drake'], graveyard: ['Test Relic'] }, p2: { graveyard: ['Test Hulk', 'Test Mend', 'Test Spark'] }, p3: { graveyard: ['Test Spark'] }, p4: { graveyard: [] } },
  });
  it('is automated', () => expect(full(TIDE)).toBe(true));
  it('the controller chooses ONE instant or sorcery card of each graveyard: a graveyard with two gives one, one without (only an artifact, or empty) gives none; creatures stay', () => {
    const s = cast(setup(), 'Test Tide Drake', { objects: [named('Test Mend')] });
    expect(names(s, s.zones.exile)).toEqual(['Test Mend', 'Test Spark']);
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Test Hulk', 'Test Spark']);
    expect(s.zones.graveyard.p3!.length).toBe(0);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Relic']);
  });
});

describe('CR 607.2a, 608.2g, 609.4b: "You may cast an instant or sorcery card exiled with this Saga, and mana of any type can be spent to cast that spell."', () => {
  const setup = (): GameState => mpScenario({
    defs: [TIDE, MEND, SPARK, HULK],
    zones: { p1: { hand: ['Test Tide Drake'] }, p2: { graveyard: ['Test Mend'] }, p3: { exile: ['Test Spark'] } },
  });
  it('while chapter II resolves the controller casts the exiled instant with the red mana it added ({U}{U} paid with {R}{R}); it is the owner\'s card and goes to its owner\'s graveyard', () => {
    let s = cast(setup(), 'Test Tide Drake');
    expect(names(s, s.zones.exile)).toEqual(['Test Mend', 'Test Spark']);
    s = nextMain(s);
    s = settle(s, { objects: [named('Test Mend')] });
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Test Mend']);
    expect(names(s, s.zones.exile)).toEqual(['Test Spark']);
  });
  it('a card in exile that this Saga did not exile can\'t be cast with it (CR 607.2a), and declining leaves the exiled card in exile (the "may")', () => {
    let s = cast(setup(), 'Test Tide Drake');
    s = nextMain(s);
    let offered: string[] = [];
    s = settle(s, { objects: [(options, t) => { offered = names(t, options); return []; }] });
    expect(offered).toEqual(['Test Mend']);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(names(s, s.zones.exile)).toEqual(['Test Mend', 'Test Spark']);
  });
});

// ---- Gourmand's Talent ------------------------------------------------------------------------------------------------------------------------------------------------------

const PANTRY = card('Test Pantry', 'Enchantment', 'During your turn, artifacts you control are Foods in addition to their other types and have "{2}, {T}, Sacrifice this artifact: You gain 3 life."');
const COG = card('Test Cog', 'Artifact', '', { cost: '{1}' });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { cost: '{2}', pt: ['2', '2'] });

describe('CR 611.3a, 613.1d, 613.1f: "During your turn, artifacts you control are Foods in addition to their other types and have \"{2}, {T}, Sacrifice this artifact: You gain 3 life.\""', () => {
  const setup = (): GameState => mpScenario({
    defs: [PANTRY, COG, GOLEM],
    zones: { p1: { battlefield: ['Test Pantry', 'Test Cog', 'Test Golem', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Cog'] } },
  });
  const mine = (s: GameState, n: string, p: PlayerId = 'p1'): string => s.zones.battlefield.find((id) => nameOf(s, id) === n && s.objects[id]!.controller === p)!;
  const eat = (s: GameState, p: PlayerId, source: string) => listLegalActions(s, p).filter((a) => a.kind === 'activate' && a.object === source && a.label.includes('gain 3 life'));
  it('is automated', () => expect(full(PANTRY)).toBe(true));
  it('during your turn your artifacts (an artifact creature too) are Foods with the ability, keeping their other types; an opponent\'s artifact is not', () => {
    const s = setup();
    expect(getChars(s, mine(s, 'Test Cog')).subtypes).toContain('Food');
    expect(getChars(s, mine(s, 'Test Golem')).subtypes).toEqual(expect.arrayContaining(['Food', 'Golem']));
    expect(getChars(s, mine(s, 'Test Golem')).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(getChars(s, mine(s, 'Test Cog', 'p2')).subtypes).not.toContain('Food');
    expect(eat(s, 'p1', mine(s, 'Test Cog')).length).toBe(1);
  });
  it('the granted ability works: pay {2}, tap and sacrifice the artifact, gain 3 life', () => {
    const s0 = setup();
    const cog = mine(s0, 'Test Cog');
    const s = settle(drive(act(s0, eat(s0, 'p1', cog)[0]!.action as never)));
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.battlefield.includes(cog)).toBe(false);
  });
  it("during an opponent's turn the artifacts are not Foods and have no such ability (the negative case)", () => {
    const s = passUntil(act(setup(), { type: 'pass', player: 'p1' }), (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1', "p2's main phase");
    expect(getChars(s, mine(s, 'Test Cog')).subtypes).not.toContain('Food');
    expect(eat(s, 'p1', mine(s, 'Test Cog')).length).toBe(0);
  });
});

// ---- The Aesir Escape Valhalla ----------------------------------------------------------------------------------------------------------------------------------------------

const ESCAPE = card('Test Long Escape', 'Enchantment — Saga', "(As this Saga enters and after your draw step, add a lore counter.)\nI — Exile a permanent card from your graveyard. You gain life equal to its mana value.\nII — Put a number of +1/+1 counters on target creature you control equal to the mana value of the exiled card.\nIII — Return this Saga and the exiled card to their owner's hand.");
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { cost: '{2}{R}', pt: ['3', '3'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}', pt: ['2', '2'] });
const obj = (id: string): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

describe('CR 607.2a: "the exiled card" of a later chapter is the card chapter I exiled (The Aesir Escape Valhalla)', () => {
  const setup = (): GameState => mpScenario({
    defs: [ESCAPE, OGRE, BEAR, SPARK],
    zones: { p1: { hand: ['Test Long Escape'], graveyard: ['Test Ogre', 'Test Spark'], battlefield: ['Test Bear'], exile: ['Test Bear'] } },
  });
  const bear = (s: GameState): string => s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear')!;
  it('is automated', () => expect(full(ESCAPE)).toBe(true));
  it('chapter I exiles a permanent card (never the sorcery) and gains its mana value; II puts that many counters on the target; III returns the Saga and that card to the hand', () => {
    let s = cast(setup(), 'Test Long Escape', { objects: [named('Test Ogre')] });
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(names(s, s.zones.exile)).toEqual(['Test Bear', 'Test Ogre']);
    s = settle(nextMain(s), { targets: [[obj(bear(s))]] });
    expect(s.objects[bear(s)]!.counters['+1/+1']).toBe(3);
    s = settle(nextMain(s));
    expect(names(s, s.zones.hand.p1!.filter((id) => nameOf(s, id) !== 'Plains'))).toEqual(['Test Long Escape', 'Test Ogre']);
    expect(names(s, s.zones.exile)).toEqual(['Test Bear']); // a card the Saga did not exile stays in exile (the negative case)
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Long Escape')).toBe(false);
  });
  it('with no permanent card in the graveyard chapter I exiles nothing: chapter II puts no counters and III returns only the Saga', () => {
    const base = mpScenario({ defs: [ESCAPE, BEAR, SPARK], zones: { p1: { hand: ['Test Long Escape'], graveyard: ['Test Spark'], battlefield: ['Test Bear'] } } });
    let s = cast(base, 'Test Long Escape');
    expect(lifeOf(s, 'p1')).toBe(20);
    s = settle(nextMain(s), { targets: [[obj(bear(s))]] });
    expect(s.objects[bear(s)]!.counters['+1/+1'] ?? 0).toBe(0);
    s = settle(nextMain(s));
    expect(names(s, s.zones.hand.p1!.filter((id) => nameOf(s, id) !== 'Plains'))).toEqual(['Test Long Escape']);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Spark']);
  });
});

// ---- Lily Bowen, Raging Grandma -----------------------------------------------------------------------------------------------------------------------------------------------

const GRANNY = card('Test Granny', 'Creature — Human Warrior', 'Vigilance\nThis creature enters with two +1/+1 counters on it.\nAt the beginning of your upkeep, double the number of +1/+1 counters on this creature if its power is 16 or less. Otherwise, remove all but one +1/+1 counter from it, then you gain 1 life for each +1/+1 counter removed this way.', { pt: ['1', '1'] });

describe('CR 122.1, 701.10e, 608.2c: "double the number of +1/+1 counters on ~ if its power is 16 or less. Otherwise, remove all but one +1/+1 counter from it, then you gain 1 life for each ..."', () => {
  const upkeep = (counters: number): { s: GameState; id: string } => {
    const s0 = mpScenario({ defs: [GRANNY], zones: { p1: { battlefield: [{ name: 'Test Granny', counters: { '+1/+1': counters } }] } } });
    const turn = s0.turn.number;
    const s = passUntil(act(s0, { type: 'pass', player: 'p1' }), (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && t.turn.number > turn, "p1's next main phase");
    return { s, id: s.zones.battlefield.find((x) => nameOf(s, x) === 'Test Granny')! };
  };
  it('is automated', () => expect(full(GRANNY)).toBe(true));
  it('enters with two counters', () => {
    const s = cast(mpScenario({ defs: [GRANNY], zones: { p1: { hand: ['Test Granny'] } } }), 'Test Granny');
    expect(s.objects[s.zones.battlefield.find((x) => nameOf(s, x) === 'Test Granny')!]!.counters['+1/+1']).toBe(2);
  });
  it('power 3 (two counters): the counters double to four; no life is gained', () => {
    const { s, id } = upkeep(2);
    expect(s.objects[id]!.counters['+1/+1']).toBe(4);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('power exactly 16 (fifteen counters) still doubles, to thirty (the boundary)', () => {
    const { s, id } = upkeep(15);
    expect(s.objects[id]!.counters['+1/+1']).toBe(30);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('power 17 (sixteen counters): otherwise, all but one counter come off and the controller gains 1 life for each of the fifteen removed (the negative case)', () => {
    const { s, id } = upkeep(16);
    expect(s.objects[id]!.counters['+1/+1']).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(35);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

// ---- Widespread Brutality -----------------------------------------------------------------------------------------------------------------------------------------------------

const RAMPAGE = card('Test Rampage', 'Sorcery', 'Amass Zombies 2, then the Army you amassed deals damage equal to its power to each non-Army creature.', { cost: '{0}' });
const LEGION = card('Test Legion', 'Creature — Zombie Army', '', { pt: ['0', '0'] });
const TOAD = card('Test Toad', 'Creature — Frog', '', { pt: ['2', '2'] });
const TROLL = card('Test Troll', 'Creature — Troll', '', { pt: ['4', '4'] });

describe('CR 701.47a, 701.47c, 120.3: "Amass Zombies 2, then the Army you amassed deals damage equal to its power to each non-Army creature."', () => {
  const onField = (s: GameState, n: string): number => s.zones.battlefield.filter((id) => nameOf(s, id) === n).length;
  it('is automated', () => expect(full(RAMPAGE)).toBe(true));
  it('with no Army: a 0/0 Zombie Army token is made and gets two counters; it deals 2 to each non-Army creature (any controller), not to itself', () => {
    const s = cast(mpScenario({ defs: [RAMPAGE, TOAD, TROLL], zones: { p1: { hand: ['Test Rampage'], battlefield: ['Test Toad'] }, p2: { battlefield: ['Test Toad', 'Test Troll'] } } }), 'Test Rampage');
    expect(onField(s, 'Test Toad')).toBe(0);
    expect(onField(s, 'Test Troll')).toBe(1);
    const army = s.zones.battlefield.find((id) => getChars(s, id).subtypes.includes('Army'))!;
    expect(s.objects[army]!.counters['+1/+1']).toBe(2);
    expect(s.objects[army]!.damage ?? 0).toBe(0);
    expect(s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Troll')!]!.damage).toBe(2);
  });
  it('an Army you already control gets the counters and deals damage equal to its new power (3 + 2 = 5): the 4/4 dies too; no new token', () => {
    const s = cast(mpScenario({ defs: [RAMPAGE, LEGION, TROLL], zones: { p1: { hand: ['Test Rampage'], battlefield: [{ name: 'Test Legion', counters: { '+1/+1': 3 } }] }, p3: { battlefield: ['Test Troll'] } } }), 'Test Rampage');
    expect(onField(s, 'Test Troll')).toBe(0);
    expect(s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Army')).length).toBe(1);
    expect(s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Legion')!]!.counters['+1/+1']).toBe(5);
  });
  it("another Army creature (an opponent's) is not dealt damage: it is not a non-Army creature (the negative case)", () => {
    const s = cast(mpScenario({ defs: [RAMPAGE, LEGION], zones: { p1: { hand: ['Test Rampage'] }, p2: { battlefield: [{ name: 'Test Legion', counters: { '+1/+1': 1 } }] } } }), 'Test Rampage');
    const theirs = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Legion')!;
    expect(s.objects[theirs]!.damage ?? 0).toBe(0);
  });
});

// ---- Genesis of the Daleks ----------------------------------------------------------------------------------------------------------------------------------------------------

const GENESIS = card('Test Genesis', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — Create a 3/3 black Dalek artifact creature token with menace for each lore counter on this Saga.\nII — Target opponent faces a villainous choice — Destroy all Dalek creatures and each of your opponents loses life equal to the total power of Daleks that died this turn, or destroy all non-Dalek creatures.');
const DRONE = card('Test Drone', 'Artifact Creature — Dalek', '', { cost: '{2}', pt: ['2', '2'] });

describe('CR 208.1, 700.4, 701.55a: "Destroy all Dalek creatures and each of your opponents loses life equal to the total power of Daleks that died this turn, or destroy all non-Dalek creatures."', () => {
  const setup = (): GameState => mpScenario({ defs: [GENESIS, DRONE, BEAR], zones: { p1: { hand: ['Test Genesis'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Test Drone', counters: { '+1/+1': 1 } }, 'Test Bear'] } } });
  const daleks = (s: GameState): number => s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Dalek')).length;
  const bears = (s: GameState): number => s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Bear').length;
  /** chapter II, the target opponent p2 choosing the first option (`first`) or the second. */
  const chapterTwo = (first: boolean): GameState => {
    let s = cast(setup(), 'Test Genesis');
    expect(daleks(s)).toBe(2); // the token of chapter I and p2's Drone
    s = nextMain(s);
    return settle(s, { targets: [[pl('p2')]], yes: [first], options: [first ? ['0'] : ['1']] });
  };
  it('is automated', () => expect(full(GENESIS)).toBe(true));
  it('the first option: every Dalek dies (the 3/3 token and the 3/3 Drone with its counter, as they last existed); each opponent of the Saga\'s controller loses 6, the controller nothing', () => {
    const s = chapterTwo(true);
    expect(daleks(s)).toBe(0);
    expect(bears(s)).toBe(2);
    for (const p of ['p2', 'p3', 'p4'] as const) expect(lifeOf(s, p)).toBe(14);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('the second option: the non-Dalek creatures die, the Daleks stay, nobody loses life (the negative case)', () => {
    const s = chapterTwo(false);
    expect(daleks(s)).toBe(2);
    expect(bears(s)).toBe(0);
    for (const p of ['p1', 'p2', 'p3', 'p4'] as const) expect(lifeOf(s, p)).toBe(20);
  });
});

// ---- Tangle Wire ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const SNARE = card('Test Snare', 'Artifact', "Fading 4 (This artifact enters with four fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nAt the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.");
const CHARM = card('Test Charm', 'Enchantment', '');

describe("CR 701.26a, 608.2d, 608.2h: \"that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact\" (Tangle Wire)", () => {
  const setup = (): GameState => mpScenario({
    defs: [SNARE, BEAR, CHARM, COG],
    zones: { p1: { battlefield: [{ name: 'Test Snare', counters: { fade: 4 } }] }, p2: { battlefield: ['Plains', 'Test Bear', 'Test Charm'] }, p3: { battlefield: ['Plains', 'Plains', 'Plains', 'Test Cog', 'Plains', 'Plains'] } },
  });
  const tappedOf = (s: GameState, p: PlayerId): string[] => names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.tapped === true));
  const untappedOf = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.tapped !== true).length;
  const upkeepOf = (p: PlayerId): GameState => {
    let s = act(setup(), { type: 'pass', player: 'p1' });
    for (let g = 0; g < 10; g++) {
      s = passUntil(s, (t) => (t.turn.activePlayer === p && t.turn.step === 'main1') || t.pending?.kind === 'chooseObjects', `${p}'s main phase`);
      if (s.pending?.kind !== 'chooseObjects') return s;
      s = drive(s);
    }
    return s;
  };
  it('is automated', () => expect(full(SNARE)).toBe(true));
  it('a player with fewer than four (a land and a creature) taps all of them; the enchantment is not an artifact, creature or land and stays untapped', () => {
    const s = upkeepOf('p2');
    expect(tappedOf(s, 'p2')).toEqual(['Plains', 'Test Bear']);
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.tapped !== true))).toEqual(['Test Charm']);
  });
  it('a player with six taps exactly four of them (their choice; an artifact counts), two stay untapped; the other players are not touched at that upkeep', () => {
    const s = upkeepOf('p3');
    expect(tappedOf(s, 'p3').length).toBe(4);
    expect(untappedOf(s, 'p3')).toBe(2);
    expect(s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Snare')!]!.counters['fade']).toBe(4);
  });
});

// ---- Jhoira's Timebug ---------------------------------------------------------------------------------------------------------------------------------------------------------

const TIMEPIECE = card('Test Timepiece', 'Artifact Creature — Insect', '{T}: Choose target permanent you control or suspended card you own. If that permanent or card has a time counter on it, you may remove a time counter from it or put another time counter on it.', { pt: ['1', '2'] });
const HOURGLASS = card('Test Hourglass', 'Artifact', '');
const COMET = card('Test Comet', 'Sorcery', 'Suspend 3—{R} (Rather than cast this card from your hand, you may pay {R} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\nYou gain 5 life.', { cost: '{4}{R}', colors: ['R'] });

describe('CR 115.1, 702.62b, 122.1: "Choose target permanent you control or suspended card you own. If that permanent or card has a time counter on it, you may remove a time counter from it or put another ..."', () => {
  const setup = (): GameState => mpScenario({
    defs: [TIMEPIECE, HOURGLASS, COMET, COG],
    zones: { p1: { battlefield: ['Test Timepiece', { name: 'Test Hourglass', counters: { time: 2 } }, 'Test Cog'], exile: [{ name: 'Test Comet', counters: { time: 2 } }] }, p2: { battlefield: [{ name: 'Test Hourglass', counters: { time: 2 } }], exile: [{ name: 'Test Comet', counters: { time: 2 } }] } },
  });
  const idOf = (s: GameState, n: string, zone: 'battlefield' | 'exile', owner: PlayerId): string => (zone === 'battlefield' ? s.zones.battlefield : s.zones.exile).find((id) => nameOf(s, id) === n && s.objects[id]!.owner === owner)!;
  const start = (s: GameState): GameState => act(s, { type: 'activate', player: 'p1', source: idOf(s, 'Test Timepiece', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
  /** Activate with this target; `pick` answers the "may" (undefined = decline) and the choice by its label. */
  const run = (s0: GameState, target: string, pick?: 'remove' | 'put'): GameState => {
    let t = start(s0);
    for (let g = 0; g < 40 && t.pending && (t.pending.kind !== 'priority' || t.zones.stack.length > 0); g++) {
      const d = t.pending;
      if (d.kind === 'priority') t = act(t, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [obj(target)] } as never);
      else if (d.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes: pick !== undefined });
      else if (d.kind === 'chooseOption') t = answer(t, { kind: 'chooseOption', ids: [(d.options as { id: string; label: string }[]).find((o) => o.label === pick)!.id] } as never);
      else if (d.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return t;
  };
  const targetsOffered = (s0: GameState): string[] => {
    const t = start(s0);
    if (t.pending?.kind !== 'chooseTargets') throw new Error(`no target choice: ${t.pending?.kind}`);
    return [...t.pending.objects];
  };
  it('is automated', () => expect(full(TIMEPIECE)).toBe(true));
  it('a permanent you control with time counters: remove takes one off, put adds one, declining the "may" changes nothing', () => {
    const s = setup();
    const glass = idOf(s, 'Test Hourglass', 'battlefield', 'p1');
    expect(run(s, glass, 'remove').objects[glass]!.counters['time']).toBe(1);
    expect(run(s, glass, 'put').objects[glass]!.counters['time']).toBe(3);
    expect(run(s, glass).objects[glass]!.counters['time']).toBe(2);
  });
  it('a suspended card you own in exile: put adds a time counter, remove takes one off', () => {
    const s = setup();
    const comet = idOf(s, 'Test Comet', 'exile', 'p1');
    expect(run(s, comet, 'put').objects[comet]!.counters['time']).toBe(3);
    expect(run(s, comet, 'remove').objects[comet]!.counters['time']).toBe(1);
  });
  it('removing the LAST time counter of a suspended card triggers suspend: its owner may cast it without paying its mana cost (CR 702.62a; ruling: whatever removed it)', () => {
    const s0 = mpScenario({ defs: [TIMEPIECE, COMET], zones: { p1: { battlefield: ['Test Timepiece'], exile: [{ name: 'Test Comet', counters: { time: 1 } }] } } });
    const s = run(s0, idOf(s0, 'Test Comet', 'exile', 'p1'), 'remove');
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Comet']);
  });
  it('a permanent you control without a time counter is a legal target, but nothing happens; an opponent\'s permanent or suspended card is no legal target (the negative cases)', () => {
    const s = setup();
    const cog = idOf(s, 'Test Cog', 'battlefield', 'p1');
    const t = run(s, cog, 'put');
    expect(t.objects[cog]!.counters['time'] ?? 0).toBe(0);
    const offered = targetsOffered(s);
    expect(offered).toEqual(expect.arrayContaining([idOf(s, 'Test Comet', 'exile', 'p1'), idOf(s, 'Test Hourglass', 'battlefield', 'p1'), cog]));
    expect(offered).not.toContain(idOf(s, 'Test Hourglass', 'battlefield', 'p2'));
    expect(offered).not.toContain(idOf(s, 'Test Comet', 'exile', 'p2'));
  });
});

// ---- Legolas, Master Archer -------------------------------------------------------------------------------------------------------------------------------------------------

const ARCHER = card('Test Archer', 'Creature — Elf Archer', "Reach\nWhenever you cast a spell that targets this creature, put a +1/+1 counter on this creature.\nWhenever you cast a spell that targets a creature you don't control, this creature deals damage equal to its power to up to one target creature.", { pt: ['3', '3'] });
const NUDGE = card('Test Nudge', 'Instant', 'Tap target creature.', { cost: '{0}' });
const DOUBLE_NUDGE = card('Test Double Nudge', 'Instant', 'Tap two target creatures.', { cost: '{0}' });

describe("CR 115.9b, 603.2: \"Whenever you cast a spell that targets a creature you don't control, ~ deals damage equal to its power to up to one target creature.\" (Legolas, Master Archer)", () => {
  const setup = (): GameState => mpScenario({ defs: [ARCHER, NUDGE, DOUBLE_NUDGE, BEAR, TROLL], zones: { p1: { hand: ['Test Nudge', 'Test Double Nudge'], battlefield: ['Test Archer', 'Test Bear'] }, p2: { battlefield: ['Test Troll', 'Test Bear'] } } });
  const idOf = (s: GameState, n: string, p: PlayerId): string => s.zones.battlefield.find((id) => nameOf(s, id) === n && s.objects[id]!.controller === p)!;
  it('is automated', () => expect(full(ARCHER)).toBe(true));
  it("a spell of yours that targets an opponent's creature: the creature deals 3 to up to one target creature (the opponent's Troll)", () => {
    const s0 = setup();
    const s = cast(s0, 'Test Nudge', { targets: [[obj(idOf(s0, 'Test Bear', 'p2'))], [obj(idOf(s0, 'Test Troll', 'p2'))]] });
    expect(s.objects[idOf(s0, 'Test Troll', 'p2')]!.damage).toBe(3);
  });
  it('a spell with two such targets triggers it once (the ruling): 3 damage, not 6', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Double Nudge', { targets: [[obj(idOf(s0, 'Test Bear', 'p2')), obj(idOf(s0, 'Test Troll', 'p2'))], [obj(idOf(s0, 'Test Troll', 'p2'))], [obj(idOf(s0, 'Test Troll', 'p2'))]] });
    expect(s.objects[idOf(s0, 'Test Troll', 'p2')]!.damage).toBe(3);
  });
  it('a spell that targets your own creature does not trigger the damage (the negative case); one that targets the Archer itself puts a +1/+1 counter on it', () => {
    const s0 = setup();
    let s = cast(s0, 'Test Nudge', { targets: [[obj(idOf(s0, 'Test Bear', 'p1'))], [obj(idOf(s0, 'Test Troll', 'p2'))]] });
    expect(s.objects[idOf(s0, 'Test Troll', 'p2')]!.damage ?? 0).toBe(0);
    s = cast(s0, 'Test Nudge', { targets: [[obj(idOf(s0, 'Test Archer', 'p1'))], [obj(idOf(s0, 'Test Troll', 'p2'))]] });
    expect(s.objects[idOf(s0, 'Test Archer', 'p1')]!.counters['+1/+1']).toBe(1);
    expect(s.objects[idOf(s0, 'Test Troll', 'p2')]!.damage ?? 0).toBe(0);
  });
});

// ---- The Parting of the Ways ------------------------------------------------------------------------------------------------------------------------------------------------

const PARTING = card('Test Parting', 'Enchantment — Saga', "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — Exile the top five cards of your library. For each nonland card exiled this way, put a number of time counters on that card equal to its mana value. If it doesn't have suspend, it gains suspend.\nII — You gain 1 life.");

describe('CR 406.1, 608.2c, 702.62a: "Exile the top five cards of your library. For each nonland card exiled this way, put ... time counters on that card equal to its mana value. If it doesn\'t have suspend, it gains suspend."', () => {
  const setup = (): GameState => mpScenario({ defs: [PARTING, BEAR, OGRE, COMET], zones: { p1: { hand: ['Test Parting'], library: ['Plains', 'Test Bear', 'Test Ogre', 'Test Comet', 'Plains', 'Plains'] } } });
  const exiled = (s: GameState, n: string): string => s.zones.exile.find((id) => nameOf(s, id) === n)!;
  it('is automated', () => expect(full(PARTING)).toBe(true));
  it('five cards are exiled; each nonland one gets time counters equal to its mana value and has suspend (a card that already had it keeps it); the lands get none', () => {
    const s = cast(setup(), 'Test Parting');
    expect(s.zones.exile.length).toBe(5);
    expect(names(s, s.zones.exile)).toEqual(['Plains', 'Plains', 'Test Bear', 'Test Comet', 'Test Ogre']);
    for (const [n, mv] of [['Test Bear', 1], ['Test Ogre', 3], ['Test Comet', 5]] as const) {
      expect(s.objects[exiled(s, n)]!.counters['time']).toBe(mv);
      expect(getChars(s, exiled(s, n)).keywords.map((k) => k.keyword)).toContain('suspend');
    }
    for (const id of s.zones.exile.filter((x) => nameOf(s, x) === 'Plains')) {
      expect(s.objects[id]!.counters['time'] ?? 0).toBe(0);
      expect(getChars(s, id).keywords.map((k) => k.keyword)).not.toContain('suspend');
    }
  });
  it('they are suspended: at the next upkeep a time counter comes off each; the one with its last counter removed is cast without paying its mana cost', () => {
    let s = cast(setup(), 'Test Parting');
    const turn = s.turn.number;
    s = act(s, { type: 'pass', player: 'p1' });
    for (let g = 0; g < 20; g++) {
      s = passUntil(s, (t) => (t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && t.turn.number > turn) || (t.pending?.kind !== 'priority' && t.pending?.kind !== 'declareAttackers' && t.pending?.kind !== 'declareBlockers'), "p1's next main phase");
      if (s.pending?.kind === 'priority' || s.pending === undefined) break;
      s = drive(s, { yes: [true, true, true, true] });
    }
    s = settle(s, { yes: [true, true] });
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Bear')).toBe(true);
    expect(s.objects[exiled(s, 'Test Ogre')]!.counters['time']).toBe(2);
    expect(s.objects[exiled(s, 'Test Comet')]!.counters['time']).toBe(4);
  });
});
