/**
 * trek-14 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks, with its negative case. The Star Trek mechanics (face a dilemma, the Federation label) have no
 * Comprehensive Rules text of their own (the 2026-09-25 edition has none): their reminder text is the rule source; the other cites were checked against that text.
 *
 *   CR 205.3m, 107.1a, 121.1  "draw a card for every five creature types among non-Borg creatures you control": one card for each full five types, a type counted once
 *                             however many creatures have it, the types of Borg creatures not counted (Sarek, Federation Ambassador)
 *   CR 608.2c, 121.2          "if you draw three or more cards this way": the cards that draw drew (a library that ran short drew fewer)
 *   CR 614.1c, 614.12, 122.6  "Faeries you control enter with an additional +1/+1 counter on them for each creature type among non-Borg creatures you already control":
 *                             counted as the Faerie enters, so the Faerie is not among them (Jean-Luc, Mon Capitaine)
 *   CR 122.6, 400.7           "for each permanent you control that you've put a counter on this turn": counters of any kind, put by you, this turn (La Forge)
 *   CR 122.1, 608.2d          "choose a counter on target enchantment you control. Put another counter of that kind on it" (Dathon, His Heart Open)
 *   CR 208.1, 603.4           "if it has greater power than ~": checked when it triggers and again as the ability resolves by the engine (Ensign Harry Kim, Operations)
 *   CR 707.12, 707.10        "Copy that card X times ... You may cast the copies without paying their mana costs" (Infinite Diversity): X copies in exile, each cast or not
 *   CR 700.2                  "whenever you face a dilemma, put a +1/1 counter on ~" (Jett Reno, Problem Solver): the preview text's "+1/1" is the +1/+1 counter
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll } from '../../m3/scenario';
import { scenario } from '../../m3/scenario';
import { activate, drive, resolveAll } from '../../m5/cr-examples/helpers';
import { castWith, synthetic } from '../../m6/costs/support';
import { passUntil, resolveStack } from '../../m12/rules/helpers';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const mode = (id: string): DecisionAnswer => ({ kind: 'chooseOption', ids: [id] });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
const target = (id: string): DecisionAnswer => ({ kind: 'chooseTargets', targets: [{ kind: 'object', id }] });
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const handSize = (s: GameState, p: PlayerId = 'p1'): number => s.zones.hand[p]!.length;
const onField = (s: GameState, name: string, p: PlayerId = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.controller === p);
/** `n` creatures of the controller, each with these creature types (distinct cards). */
const creature = (name: string, types: string, p = '1', t = '1', text = ''): CardDef => synthetic(name, `Creature — ${types}`, '{0}', text, { power: p, toughness: t });

describe('CR 205.3m, 107.1a, 121.1, 608.2c: "draw a card for every five creature types among non-Borg creatures you control. If you draw three or more cards this way, put two +1/+1 counters on each creature you control." (Sarek, Federation Ambassador)', () => {
  const SAREK = creature('Test Ambassador', 'Human', '0', '5', 'At the beginning of combat on your turn, draw a card for every five creature types among non-Borg creatures you control. If you draw three or more cards this way, put two +1/+1 counters on each creature you control.');
  const FIVE = creature('Test Five Types', 'Elf Wizard Goblin Merfolk Zombie'); // 5 types beside the Human of the ambassador: 6 types in all
  const TEN = creature('Test Ten Types', 'Soldier Cleric Rogue Warrior Knight');
  const FIFTEEN = creature('Test Fifteen Types', 'Dragon Angel Demon Vampire Beast');
  const DRONE = creature('Test Drone', 'Borg Drone Elf Wizard');
  const ELF = creature('Test Plain Elf', 'Elf');
  const DEFS = [SAREK, FIVE, TEN, FIFTEEN, DRONE, ELF];
  const library = Array.from({ length: 6 }, () => 'Plains');
  const combat = (battlefield: string[], libSize = 99): GameState => {
    const start = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Ambassador', ...battlefield], library } });
    start.zones.library['p1'] = start.zones.library['p1']!.slice(0, libSize); // (the scenario adds its own deck below the cards it is given)
    const s = advanceTo(start, 1, 'beginCombat');
    return s.zones.stack.length > 0 ? resolveAll(s) : s;
  };
  const before = (battlefield: string[]): number => handSize(scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Ambassador', ...battlefield], library } }));

  it('the card is automated; the quantities are capabilities', () => {
    expect(full(SAREK), JSON.stringify(SAREK.automation)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('q:resultCount'), 'q:resultCount').toBe(true);
  });
  it('six types (the ambassador is a Human, the other creature has five more): one card, and no counters (one card is not three)', () => {
    const s = combat(['Test Five Types']);
    expect(handSize(s) - before(['Test Five Types'])).toBe(1);
    expect(counters(s, onField(s, 'Test Ambassador')[0]!)).toBe(0);
  });
  it('eleven types: two cards, no counters (two cards are fewer than three)', () => {
    const s = combat(['Test Five Types', 'Test Ten Types']);
    expect(handSize(s) - before(['Test Five Types', 'Test Ten Types'])).toBe(2);
    expect(counters(s, onField(s, 'Test Five Types')[0]!)).toBe(0);
  });
  it('sixteen types: three cards, and two +1/+1 counters on each creature the controller controls, the ambassador included', () => {
    const names = ['Test Five Types', 'Test Ten Types', 'Test Fifteen Types'];
    const s = combat(names);
    expect(handSize(s) - before(names)).toBe(3);
    for (const n of ['Test Ambassador', ...names]) expect(counters(s, onField(s, n)[0]!), n).toBe(2);
  });
  it('negative: fewer than five types draws no card, and a creature type is counted once however many creatures have it', () => {
    const s = combat(['Test Plain Elf', 'Test Plain Elf', 'Test Plain Elf']);
    expect(handSize(s) - before(['Test Plain Elf', 'Test Plain Elf', 'Test Plain Elf'])).toBe(0); // Human and Elf: two types
  });
  it('negative: the types of a Borg creature are not counted (non-Borg creatures only): Borg, Drone, Elf and Wizard add nothing to the Human', () => {
    const s = combat(['Test Drone']);
    expect(handSize(s) - before(['Test Drone'])).toBe(0); // 1 type (Human) among the non-Borg creatures
    const t = combat(['Test Drone', 'Test Five Types']); // Human + five types of the other creature = 6 types, the drone's Borg Drone Elf Wizard (Elf, Wizard again) add none
    expect(handSize(t) - before(['Test Drone', 'Test Five Types'])).toBe(1);
  });
  it('negative: an opponent\'s creatures are not counted, and it happens on the controller\'s turn only', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Ambassador'], library }, p2: { battlefield: ['Test Five Types', 'Test Ten Types', 'Test Fifteen Types'] } });
    s = advanceTo(s, 1, 'beginCombat');
    if (s.zones.stack.length > 0) s = resolveAll(s);
    expect(handSize(s)).toBe(handSize(scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Ambassador'], library }, p2: {} }))); // one type of its own: no card
  });
  it('CR 121.2, 608.2c: the library ran short: the cards drawn are the ones that count (a library of one card draws one card: no counters even with sixteen types)', () => {
    const names = ['Test Five Types', 'Test Ten Types', 'Test Fifteen Types'];
    const s = combat(names, 1);
    expect(counters(s, onField(s, 'Test Ambassador')[0]!)).toBe(0);
  });
});

describe('CR 614.1c, 614.12, 122.6, 205.3m: "Faeries you control enter with an additional +1/+1 counter on them for each creature type among non-Borg creatures you already control." (Jean-Luc, Mon Capitaine)', () => {
  const CAPTAIN = creature('Test Captain', 'Human Officer', '5', '3', 'Flying\nFaeries you control enter with an additional +1/+1 counter on them for each creature type among non-Borg creatures you already control.');
  const FAERIE = synthetic('Test Sprite', 'Creature — Faerie', '{0}', '', { power: '1', toughness: '1' });
  const OTHER = creature('Test Bystander', 'Elf Wizard');
  const DRONE = creature('Test Cube Drone', 'Borg Drone');
  const TOKEN = creature('Test Faerie Maker', 'Human', '1', '1', '{0}: Create a 1/1 blue Faerie creature token with flying.');
  const DEFS = [CAPTAIN, FAERIE, OTHER, DRONE, TOKEN];
  const cast = (battlefield: string[]): { s: GameState; sprite: ObjectId } => {
    let s = scenario([], { defs: DEFS, p1: { battlefield, hand: ['Test Sprite'] } });
    s = resolveAll(castWith(s, 'Test Sprite'));
    return { s, sprite: onField(s, 'Test Sprite')[0]! };
  };
  it('the card is automated', () => expect(full(CAPTAIN), JSON.stringify(CAPTAIN.automation)).toBe(true));
  it('Human, Officer, Elf and Wizard are four types: the Faerie enters with four +1/+1 counters; the Faerie itself is not among the creatures yet (not a fifth type)', () => {
    const { s, sprite } = cast(['Test Captain', 'Test Bystander']);
    expect(counters(s, sprite)).toBe(4);
  });
  it('negative: the types of a Borg creature are not counted (Borg and Drone add nothing)', () => {
    const { s, sprite } = cast(['Test Captain', 'Test Cube Drone']);
    expect(counters(s, sprite)).toBe(2); // Human, Officer
  });
  it('negative: without the Captain nothing is added, and the creature that is not a Faerie gets none', () => {
    const { s, sprite } = cast(['Test Bystander']);
    expect(counters(s, sprite)).toBe(0);
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Captain', 'Test Bystander'], hand: ['Test Bystander'] } });
    t = resolveAll(castWith(t, 'Test Bystander'));
    for (const id of onField(t, 'Test Bystander')) expect(counters(t, id)).toBe(0);
  });
  it('a Faerie token enters with the counters too (a creature entering, whether cast or created)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Captain', 'Test Faerie Maker'] } });
    s = resolveAll(activate(s, onField(s, 'Test Faerie Maker')[0]!));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(counters(s, token)).toBe(2); // Human, Officer (the Faerie Maker is a Human too, the token itself not yet among them)
  });
  it('CR 614.12: Faeries entering together do not count each other (two tokens at once: the same number of counters, not one more for the second)', () => {
    const TWINS = synthetic('Test Twin Sprites', 'Sorcery', '{0}', 'Create two 1/1 blue Faerie creature tokens with flying.');
    let s = scenario([], { defs: [...DEFS, TWINS], p1: { battlefield: ['Test Captain', 'Test Bystander'], hand: ['Test Twin Sprites'] } });
    s = resolveAll(castWith(s, 'Test Twin Sprites'));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.map((id) => counters(s, id))).toEqual([4, 4]); // Human, Officer, Elf, Wizard
  });
  it('an opponent\'s Faerie is not one "you control": no counters', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Captain'] }, p2: { hand: ['Test Sprite'] } });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(castWith(s, 'Test Sprite', [], undefined, 'p2'));
    expect(counters(s, onField(s, 'Test Sprite', 'p2')[0]!)).toBe(0);
  });
});

describe('CR 122.6, 400.7: "For each permanent you control that you\'ve put a counter on this turn, create a 1/1 blue Faerie creature token with flying." (La Forge, Thoughtful as Ever)', () => {
  const FORGE = creature('Test Engineer', 'Human Artificer', '2', '4', "{T}: For each permanent you control that you've put a counter on this turn, create a 1/1 blue Faerie creature token with flying.");
  const GROWER = synthetic('Test Grower', 'Sorcery', '{0}', 'Put a +1/+1 counter on target creature you control.');
  const GRUDGE = synthetic('Test Curse', 'Sorcery', '{0}', 'Put a -1/-1 counter on target creature.');
  const LOYAL = synthetic('Test Banner', 'Artifact', '{0}', '{0}: Put a charge counter on target artifact you control.');
  const BEAR = creature('Test Bear', 'Bear', '2', '2');
  const DEFS = [FORGE, GROWER, GRUDGE, LOYAL, BEAR];
  const faeries = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id)!.subtypes.includes('Faerie')).length;
  const tapForge = (s: GameState): GameState => resolveAll(activate(s, onField(s, 'Test Engineer')[0]!));
  it('the card is automated; the filter is a capability', () => {
    expect(full(FORGE), JSON.stringify(FORGE.automation)).toBe(true);
  });
  it('two permanents you put counters on this turn (a +1/+1 counter and a charge counter): two Faeries', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Engineer', 'Test Bear', 'Test Banner'], hand: ['Test Grower'] } });
    s = resolveAll(castWith(s, 'Test Grower', [target(onField(s, 'Test Bear')[0]!)]));
    s = resolveAll(activate(s, onField(s, 'Test Banner')[0]!, [target(onField(s, 'Test Banner')[0]!)]));
    expect(counters(s, onField(s, 'Test Bear')[0]!)).toBe(1);
    s = tapForge(s);
    expect(faeries(s)).toBe(2);
  });
  it('a permanent counts once however many counters you put on it', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Engineer', 'Test Bear'], hand: ['Test Grower', 'Test Grower'] } });
    s = resolveAll(castWith(s, 'Test Grower', [target(onField(s, 'Test Bear')[0]!)]));
    s = resolveAll(castWith(s, 'Test Grower', [target(onField(s, 'Test Bear')[0]!)]));
    s = tapForge(s);
    expect(faeries(s)).toBe(1);
  });
  it('negative: no counter put this turn: no Faerie; a permanent that already had counters (placed before the turn) does not count', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Engineer', { name: 'Test Bear', counters: { '+1/+1': 2 } }] } });
    s = tapForge(s);
    expect(faeries(s)).toBe(0);
  });
  it('negative: counters put on an opponent\'s permanent are not on a permanent you control; a counter of any other kind on your own creature counts', () => {
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Engineer', 'Test Bear'], hand: ['Test Curse'] }, p2: { battlefield: ['Test Bear'] } });
    t = resolveAll(castWith(t, 'Test Curse', [target(onField(t, 'Test Bear', 'p2')[0]!)]));
    t = tapForge(t);
    expect(faeries(t)).toBe(0); // the counter is on an opponent's creature
    let u = scenario([], { defs: DEFS, p1: { battlefield: ['Test Engineer', 'Test Bear'], hand: ['Test Curse'] } });
    u = resolveAll(castWith(u, 'Test Curse', [target(onField(u, 'Test Bear')[0]!)]));
    u = tapForge(u);
    expect(faeries(u)).toBe(1); // a -1/-1 counter is a counter of a kind: "a counter", any kind
  });
  it('"this turn": the next turn it counts nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Engineer', 'Test Bear'], hand: ['Test Grower'] } });
    s = resolveAll(castWith(s, 'Test Grower', [target(onField(s, 'Test Bear')[0]!)]));
    s = advanceTo(s, 3, 'main1');
    s = tapForge(s);
    expect(faeries(s)).toBe(0);
  });
});

describe('CR 122.1, 608.2d: "{2}: Choose a counter on target enchantment you control. Put another counter of that kind on it. Activate only as a sorcery." (Dathon, His Heart Open)', () => {
  const DATHON = creature('Test Counter Doubler', 'Tamarian Officer', '3', '3', '{0}: Choose a counter on target enchantment you control. Put another counter of that kind on it. Activate only as a sorcery.');
  const SHRINE = synthetic('Test Shrine', 'Enchantment', '{0}', '');
  const DEFS = [DATHON, SHRINE];
  const run = (counterSet: Record<string, number>, answers: DecisionAnswer[] = []): { s: GameState; shrine: ObjectId } => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Counter Doubler', { name: 'Test Shrine', counters: counterSet }] } });
    const shrine = onField(s, 'Test Shrine')[0]!;
    s = resolveAll(activate(s, onField(s, 'Test Counter Doubler')[0]!, [target(shrine), ...answers]), answers);
    return { s, shrine };
  };
  it('the card is automated', () => expect(full(DATHON), JSON.stringify(DATHON.automation)).toBe(true));
  it('one kind of counter on it: one more counter of that kind', () => {
    const { s, shrine } = run({ lore: 2 });
    expect(counters(s, shrine, 'lore')).toBe(3);
  });
  it('two kinds: the chosen kind gets the counter, the other does not', () => {
    const { s, shrine } = run({ lore: 1, charge: 2 }, [{ kind: 'chooseOption', ids: ['0'] }] /* the kinds as the engine lists them: charge, lore */);
    expect([counters(s, shrine, 'charge'), counters(s, shrine, 'lore')]).toEqual([3, 1]);
  });
  it('negative: no counter on it: nothing is chosen, nothing is put', () => {
    const { s, shrine } = run({});
    expect(Object.values(s.objects[shrine]!.counters).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('negative: sorcery speed (not on the opponent\'s turn, not with something on the stack)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Counter Doubler', { name: 'Test Shrine', counters: { lore: 1 } }] } });
    s = advanceTo(s, 2, 'main1');
    expect(() => activate(s, onField(s, 'Test Counter Doubler')[0]!, [target(onField(s, 'Test Shrine')[0]!)])).toThrow();
  });
});

describe('CR 208.1, 603.4: "Whenever another creature you control enters, if it has greater power than ~, put a +1/+1 counter on ~." (Ensign Harry Kim, Operations; the engine rechecks the intervening "if" as the ability resolves, played by the reviewer)', () => {
  const KIM = creature('Test Ensign', 'Human Officer', '2', '2', 'Whenever another creature you control enters, if it has greater power than Test Ensign, put a +1/+1 counter on Test Ensign.\n{0}, Remove two +1/+1 counters from among creatures you control: Draw a card.');
  const BIG = creature('Test Bigger', 'Beast', '3', '3');
  const SAME = creature('Test Same', 'Beast', '2', '2');
  const SMALL = creature('Test Smaller', 'Beast', '1', '1');
  const DEFS = [KIM, BIG, SAME, SMALL];
  const enter = (name: string, p: PlayerId = 'p1'): { s: GameState; kim: ObjectId } => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ensign'], hand: p === 'p1' ? [name] : [] }, p2: { hand: p === 'p2' ? [name] : [] } });
    if (p === 'p2') s = advanceTo(s, 2, 'main1');
    s = resolveAll(castWith(s, name, [], undefined, p));
    return { s, kim: onField(s, 'Test Ensign')[0]! };
  };
  it('the card is automated, and "Ensign Kim" is itself (the short name of a legendary card with a title)', () => {
    const real = synthetic('Ensign Harry Kim, Operations', 'Legendary Creature — Human Officer', '{1}{W}', 'Whenever another creature you control enters, if it has greater power than Ensign Kim, put a +1/+1 counter on Ensign Kim.', { power: '1', toughness: '2' });
    expect(full(real), JSON.stringify(real.automation)).toBe(true);
    expect(full(KIM), JSON.stringify(KIM.automation)).toBe(true);
  });
  it('a creature with greater power enters: one +1/+1 counter', () => {
    const { s, kim } = enter('Test Bigger');
    expect(counters(s, kim)).toBe(1);
  });
  it('negative: equal power and lesser power: no counter', () => {
    expect(counters(enter('Test Same').s, enter('Test Same').kim)).toBe(0);
    const { s, kim } = enter('Test Smaller');
    expect(counters(s, kim)).toBe(0);
  });
  it('negative: a creature an opponent controls entering is not "a creature you control"', () => {
    const { s, kim } = enter('Test Bigger', 'p2');
    expect(counters(s, kim)).toBe(0);
  });
  it('the ensign itself entering is not "another creature"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Ensign'] } });
    s = resolveAll(castWith(s, 'Test Ensign'));
    expect(counters(s, onField(s, 'Test Ensign')[0]!)).toBe(0);
  });
  it('the second ability removes two +1/+1 counters from among creatures you control, as the cost: the card is drawn; without two counters it cannot be activated', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Ensign', counters: { '+1/+1': 2 } }], library: ['Plains'] } });
    const kim = onField(s, 'Test Ensign')[0]!;
    const hand = handSize(s);
    s = resolveAll(activate(s, kim));
    expect(counters(s, kim)).toBe(0);
    expect(handSize(s) - hand).toBe(1);
    const t = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Ensign', counters: { '+1/+1': 1 } }], library: ['Plains'] } });
    expect(() => activate(t, onField(t, 'Test Ensign')[0]!)).toThrow();
  });
});

describe('CR 700.2: "Whenever you face a dilemma, put a +1/1 counter on ~." (Jett Reno, Problem Solver)', () => {
  const RENO = creature('Test Tinkerer', 'Human Artificer', '1', '2', 'Whenever Test Tinkerer becomes tapped, surveil 1. If its power is 4 or greater, instead draw a card.\nWhenever you face a dilemma, put a +1/1 counter on Test Tinkerer.');
  const CHARM = synthetic('Test Twin Charm', 'Instant', '{0}', 'Choose one —\n• You gain 2 life.\n• You gain 3 life.');
  const SALVE = synthetic('Test Plain Salve', 'Instant', '{0}', 'You gain 1 life.');
  const DEFS = [RENO, CHARM, SALVE];
  it('the card is automated', () => expect(full(RENO), JSON.stringify(RENO.automation)).toBe(true));
  it('choosing modes for a spell is facing a dilemma: one +1/+1 counter, power 2 (a +1/+1 counter raises power and toughness)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tinkerer'], hand: ['Test Twin Charm', 'Test Twin Charm'] } });
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('0')]));
    const reno = onField(s, 'Test Tinkerer')[0]!;
    expect(counters(s, reno)).toBe(1);
    expect(Number(getChars(s, reno)!.power)).toBe(2);
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('1')]));
    expect(counters(s, reno)).toBe(2);
  });
  it('negative: a spell without modes is no dilemma; neither is an opponent\'s modal spell', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tinkerer'], hand: ['Test Plain Salve'] } });
    s = resolveAll(castWith(s, 'Test Plain Salve'));
    expect(counters(s, onField(s, 'Test Tinkerer')[0]!)).toBe(0);
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tinkerer'] }, p2: { hand: ['Test Twin Charm'] } });
    t = advanceTo(t, 2, 'main1');
    t = resolveAll(castWith(t, 'Test Twin Charm', [mode('0')], undefined, 'p2'));
    expect(counters(t, onField(t, 'Test Tinkerer')[0]!)).toBe(0);
  });
});

describe('CR 707.12, 707.10, 608.2g, 107.3: "Exile target instant or sorcery card from your graveyard. Copy that card X times, where X is the number of creature types among non-Borg creatures you control. You may cast the copies without paying their mana costs. Exile ~." (Infinite Diversity)', () => {
  const DIVERSITY = synthetic('Test Infinite Variety', 'Sorcery', '{0}', 'Exile target instant or sorcery card from your graveyard. Copy that card X times, where X is the number of creature types among non-Borg creatures you control. You may cast the copies without paying their mana costs. Exile Test Infinite Variety.');
  const GAIN = synthetic('Test Small Gain', 'Instant', '{5}', 'You gain 2 life.');
  const MIX = creature('Test Mixed Crew', 'Elf Wizard Goblin');
  const DRONE = creature('Test Borg Crew', 'Borg Drone Human');
  const DEFS = [DIVERSITY, GAIN, MIX, DRONE];
  const lifeOf = (s: GameState, p: PlayerId = 'p1'): number => s.players.find((x) => x.id === p)!.life;
  const play = (battlefield: string[], answers: DecisionAnswer[]): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield, graveyard: ['Test Small Gain'], hand: ['Test Infinite Variety'] } });
    s = castWith(s, 'Test Infinite Variety', [target(find(s, 'Test Small Gain', 'graveyard', 'p1'))]);
    return resolveAll(s, answers);
  };
  it('the card is automated; `op:cast.copyCount` is a capability', () => {
    expect(full(DIVERSITY), JSON.stringify(DIVERSITY.automation)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:cast.copyCount')).toBe(true);
  });
  it('three creature types: three copies, each cast without paying its {5} (+2 life each); the original card stays exiled and the spell itself is exiled', () => {
    const s = play(['Test Mixed Crew'], [yes, yes, yes]);
    expect(lifeOf(s)).toBe(20 + 6);
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Infinite Variety', 'Test Small Gain']);
    expect(s.zones.graveyard.p1!.length).toBe(0);
  });
  it('each copy may be cast or not: two of three cast', () => {
    const s = play(['Test Mixed Crew'], [yes, no, yes]);
    expect(lifeOf(s)).toBe(20 + 4);
  });
  it('negative: the types of a Borg creature are not counted (Borg, Drone and Human): no creature but the Borg: X is 0, no copy', () => {
    const s = play(['Test Borg Crew'], []);
    expect(lifeOf(s)).toBe(20);
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Infinite Variety', 'Test Small Gain']);
  });
  it('negative: without a creature X is 0: nothing is cast, the card is still exiled and the spell exiled too', () => {
    const s = play([], []);
    expect(lifeOf(s)).toBe(20);
    expect(s.zones.exile.length).toBe(2);
  });
  it('negative: no target card (an empty graveyard): the spell is not cast', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mixed Crew'], hand: ['Test Infinite Variety'] } });
    expect(() => castWith(s, 'Test Infinite Variety')).toThrow();
  });
});
