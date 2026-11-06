/**
 * edh-players-13 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites checked against MagicCompRules 20260925.
 *
 *   CR 608.2d, 101.4, 205.3m     "Each player chooses a creature type. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield."
 *   CR 608.2d, 101.4, 608.2f     "Each opponent chooses fame or fortune. For each player who chose fame, ..." (each player's own choice, kept by player)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';

interface Script { numbers?: number[]; attacks?: { attacker: ObjectId; defender: PlayerId }[]; names?: string[]; options?: string[]; asked?: string[]; objects?: (ObjectId[] | ((options: ObjectId[]) => ObjectId[]))[] }
/** Answer the decisions that come up until someone has priority: names for the type choices, option labels for the word choices (by chooser). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: script.names?.shift() ?? p.options![0]! });
    else if (p.kind === 'chooseOption') {
      const want = script.options?.shift();
      const id = want === undefined ? p.options[0]!.id : p.options.find((o) => o.label === want)!.id;
      s = answer(s, { kind: 'chooseOption', ids: [id] });
    } else if (p.kind === 'chooseObjects') {
      const pick = script.objects?.shift();
      s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options) : pick ?? p.options.slice(0, p.min) });
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attacks ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');

// ---- "Each player chooses a creature type. Each player returns all creature cards of a type chosen this way ..." ------------------------------------------------------------

const BIDDING = card('Test Bidding', 'Sorcery', 'Each player chooses a creature type. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield.');

describe('CR 608.2d, 101.4, 205.3m: "Each player chooses a creature type. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield."', () => {
  const setup = (): GameState => mpScenario({
    defs: [BIDDING, GOBLIN, ELF, BEAR, RELIC],
    zones: {
      p1: { hand: ['Test Bidding'], graveyard: ['Test Goblin', 'Test Elf', 'Test Bear', 'Test Relic'] },
      p2: { graveyard: ['Test Goblin', 'Test Bear'], battlefield: ['Test Elf'] },
      p3: { graveyard: ['Test Elf', 'Test Elf'] },
      p4: { graveyard: ['Test Bear'] },
    },
  });
  it('is automated', () => expect(full(BIDDING)).toBe(true));
  it('every player is asked, in turn order, and each one sees a closed list of creature types', () => {
    const asked: string[] = [];
    cast(setup(), 'Test Bidding', { names: ['Goblin', 'Goblin', 'Elf', 'Elf'], asked });
    expect(asked.filter((a) => a.startsWith('chooseName'))).toEqual(['chooseName:p1', 'chooseName:p2', 'chooseName:p3', 'chooseName:p4']);
  });
  it('returns the creature cards of ANY chosen type from EVERY graveyard (not only the type its owner chose), each under its owner\'s control', () => {
    const s = cast(setup(), 'Test Bidding', { names: ['Goblin', 'Goblin', 'Elf', 'Elf'] });
    expect(namesOn(s, 'p1').sort()).toEqual(['Test Elf', 'Test Goblin']);
    expect(namesOn(s, 'p2').sort()).toEqual(['Test Elf', 'Test Goblin']); // its Elf was already there; its Goblin came back
    expect(namesOn(s, 'p3').sort()).toEqual(['Test Elf', 'Test Elf']);
    expect(namesOn(s, 'p4')).toEqual([]);
  });
  it('a creature card of a type nobody chose, and a card that is no creature, stay in the graveyard (the negative case)', () => {
    const s = cast(setup(), 'Test Bidding', { names: ['Goblin', 'Goblin', 'Elf', 'Elf'] });
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Bear', 'Test Bidding', 'Test Relic']);
    expect(s.zones.graveyard['p4']!.length).toBe(1);
    expect(count(s, 'p2', 'Test Bear')).toBe(0);
  });
  it('one player choosing a type is enough for everyone\'s cards of it; with all four choosing Bear only the Bears return', () => {
    const s = cast(setup(), 'Test Bidding', { names: ['Bear', 'Bear', 'Bear', 'Bear'] });
    expect(namesOn(s, 'p1')).toEqual(['Test Bear']);
    expect(namesOn(s, 'p2').sort()).toEqual(['Test Bear', 'Test Elf']);
    expect(namesOn(s, 'p4')).toEqual(['Test Bear']);
    expect(zoneOf(s, find(setup(), 'Test Goblin', 'graveyard', 'p1'))).toBe('graveyard');
  });
});

// ---- "Each opponent chooses fame or fortune. For each player who chose fame, ..." ---------------------------------------------------------------------------------------

const CEREMONY = card('Test Ceremony', 'Sorcery', 'Each opponent chooses money, friends, or secrets. For each player who chose money, you and that player each create a Treasure token. For each player who chose friends, you and that player each create a 1/1 green and white Citizen creature token. For each player who chose secrets, you and that player each draw a card.');

describe('CR 608.2d, 101.4, 608.2f: "Each opponent chooses money, friends, or secrets. For each player who chose money, you and that player each create a Treasure token. ..."', () => {
  const setup = (): GameState => mpScenario({
    defs: [CEREMONY],
    zones: { p1: { hand: ['Test Ceremony'] }, p2: {}, p3: {}, p4: {} },
  });
  it('is automated', () => expect(full(CEREMONY)).toBe(true));
  it('only the opponents are asked, in turn order, each offered the three words', () => {
    const asked: string[] = [];
    cast(setup(), 'Test Ceremony', { options: ['money', 'money', 'money'], asked });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p2', 'chooseOption:p3', 'chooseOption:p4']);
  });
  it('you and EACH player who chose a word get that word\'s reward, and a player who chose another word gets nothing of it', () => {
    const s = cast(setup(), 'Test Ceremony', { options: ['money', 'friends', 'money'] });
    // money: p2 and p4 chose it: you get two Treasures, p2 and p4 one each; friends: p3 only
    expect(count(s, 'p1', 'Treasure Token')).toBe(2);
    expect(count(s, 'p2', 'Treasure Token')).toBe(1);
    expect(count(s, 'p4', 'Treasure Token')).toBe(1);
    expect(count(s, 'p3', 'Treasure Token')).toBe(0);
    expect(count(s, 'p1', 'Citizen Token')).toBe(1);
    expect(count(s, 'p3', 'Citizen Token')).toBe(1);
    expect(count(s, 'p2', 'Citizen Token') + count(s, 'p4', 'Citizen Token')).toBe(0);
  });
  it('secrets: you and that player each draw a card; nobody who chose another word draws', () => {
    const s0 = setup();
    const before = (p: PlayerId): number => handSize(s0, p);
    const s = cast(s0, 'Test Ceremony', { options: ['secrets', 'money', 'secrets'] });
    expect(handSize(s, 'p2') - before('p2')).toBe(1);
    expect(handSize(s, 'p3') - before('p3')).toBe(0);
    expect(handSize(s, 'p4') - before('p4')).toBe(1);
    expect(handSize(s, 'p1') - before('p1')).toBe(2 - 1); // two draws, minus the cast spell
  });
  it('a word nobody chose does nothing (the negative case)', () => {
    const s = cast(setup(), 'Test Ceremony', { options: ['money', 'money', 'money'] });
    expect(count(s, 'p1', 'Citizen Token') + count(s, 'p2', 'Citizen Token')).toBe(0);
    expect(count(s, 'p1', 'Treasure Token')).toBe(3);
  });
});


// ---- "For each player who chose fame, gain control of a creature that player controls until end of turn. Untap those creatures and they gain haste ..." ----------------------

const SPOTLIGHT = card('Test Spotlight', 'Sorcery', 'Each opponent chooses fame or fortune. For each player who chose fame, gain control of a creature that player controls until end of turn. Untap those creatures and they gain haste until end of turn. For each player who chose fortune, you draw a card and create a Treasure token.');

describe('CR 608.2d, 611.2a, 613.1b: "For each player who chose fame, gain control of a creature that player controls until end of turn. Untap those creatures and they gain haste until end of turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SPOTLIGHT, BEAR, GOBLIN, ELF],
    zones: {
      p1: { hand: ['Test Spotlight'], battlefield: ['Test Elf'] },
      p2: { battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Goblin', tapped: true }] },
      p3: { battlefield: ['Test Bear'] },
      p4: { battlefield: [{ name: 'Test Goblin', tapped: true }, 'Test Elf'] },
    },
  });
  const hasHaste = (s: GameState, id: ObjectId): boolean => getChars(s, id).keywords.some((k) => (k as unknown as { keyword?: string }).keyword === 'haste');
  it('is automated', () => expect(full(SPOTLIGHT)).toBe(true));
  it('you choose ONE creature of each player who chose fame; those creatures are yours, untapped, with haste, and nobody else\'s creature moves', () => {
    const s0 = setup();
    const goblin2 = find(s0, 'Test Goblin', 'battlefield', 'p2');
    const bear2 = find(s0, 'Test Bear', 'battlefield', 'p2');
    const bear3 = find(s0, 'Test Bear', 'battlefield', 'p3');
    const goblin4 = find(s0, 'Test Goblin', 'battlefield', 'p4');
    const s = cast(s0, 'Test Spotlight', { options: ['fame', 'fortune', 'fame'], objects: [[goblin2], [goblin4]] });
    expect(s.objects[goblin2]!.controller).toBe('p1');
    expect(s.objects[goblin4]!.controller).toBe('p1');
    expect(s.objects[bear2]!.controller).toBe('p2'); // the other creature of p2 stays
    expect(s.objects[bear3]!.controller).toBe('p3'); // p3 chose fortune
    for (const id of [goblin2, goblin4]) { expect(s.objects[id]!.tapped).toBe(false); expect(hasHaste(s, id)).toBe(true); }
    expect(hasHaste(s, bear2)).toBe(false);
    expect(hasHaste(s, find(s0, 'Test Elf', 'battlefield', 'p1'))).toBe(false);
    expect(s.objects[bear2]!.tapped).toBe(true); // only the creatures gained are untapped
  });
  it('the creature you choose for each player is that player\'s own: you are offered only their creatures, one player at a time', () => {
    const s0 = setup();
    let offered: ObjectId[][] = [];
    cast(s0, 'Test Spotlight', { options: ['fame', 'fortune', 'fame'], objects: [(o) => { offered.push(o); return [o[0]!]; }, (o) => { offered.push(o); return [o[0]!]; }] });
    expect(offered.map((o) => o.map((id) => s0.objects[id]!.owner).sort())).toEqual([['p2', 'p2'], ['p4', 'p4']]);
  });
  it('fortune: you draw a card and create a Treasure token for EACH player who chose it, and nothing is gained from those players', () => {
    const s0 = setup();
    const hand0 = handSize(s0, 'p1');
    const s = cast(s0, 'Test Spotlight', { options: ['fortune', 'fame', 'fortune'], objects: [[find(s0, 'Test Bear', 'battlefield', 'p3')]] });
    expect(count(s, 'p1', 'Treasure Token')).toBe(2);
    expect(handSize(s, 'p1') - hand0).toBe(2 - 1); // two draws, minus the cast spell
    expect(s.objects[find(s0, 'Test Bear', 'battlefield', 'p3')]!.controller).toBe('p1');
    expect(s.objects[find(s0, 'Test Goblin', 'battlefield', 'p4')]!.controller).toBe('p4'); // p4 chose fortune
  });
  it('a player who chose fame and controls no creature gives nothing; with nobody choosing fame none of your own creatures changes (the negative case)', () => {
    const s0 = mpScenario({ defs: [SPOTLIGHT, BEAR], zones: { p1: { hand: ['Test Spotlight'], battlefield: ['Test Bear'] }, p2: {}, p3: {}, p4: {} } });
    const s = cast(s0, 'Test Spotlight', { options: ['fame', 'fortune', 'fortune'] });
    expect(namesOn(s, 'p1')).toEqual(['Test Bear', 'Treasure Token', 'Treasure Token']);
    expect(count(s, 'p1', 'Test Bear')).toBe(1);
  });
  it('the control lasts until end of turn only (CR 611.2a): the creature goes back at the cleanup step', () => {
    const s0 = setup();
    const goblin2 = find(s0, 'Test Goblin', 'battlefield', 'p2');
    let s = cast(s0, 'Test Spotlight', { options: ['fame', 'fortune', 'fortune'], objects: [[goblin2]] });
    expect(s.objects[goblin2]!.controller).toBe('p1');
    for (let guard = 0; guard < 60 && s.turn.number === s0.turn.number; guard++) {
      s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    }
    expect(s.objects[goblin2]!.controller).toBe('p2');
  });
});


// ---- "For each evidence vote, ..." ------------------------------------------------------------------------------------------------------------------------------------------

const COUNCIL = card('Test Council', 'Sorcery', 'Starting with you, each player votes for evidence or bribery. For each evidence vote, draw a card. For each bribery vote, create a Treasure token.');

describe('CR 701.38a-b, 608.2c: "Starting with you, each player votes for evidence or bribery. For each evidence vote, draw a card. For each bribery vote, create a Treasure token."', () => {
  const setup = (): GameState => mpScenario({ defs: [COUNCIL], zones: { p1: { hand: ['Test Council'] }, p2: {}, p3: {}, p4: {} } });
  it('is automated', () => expect(full(COUNCIL)).toBe(true));
  it('does the instruction once for each vote of its word, whoever cast it (you act on every vote, not only your own)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Council', { options: ['evidence', 'bribery', 'bribery', 'evidence'] });
    expect(handSize(s, 'p1') - handSize(s0, 'p1')).toBe(2 - 1); // two evidence votes, minus the cast spell
    expect(count(s, 'p1', 'Treasure Token')).toBe(2);
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2'));
  });
  it('every player votes, starting with you, in turn order', () => {
    const asked: string[] = [];
    cast(setup(), 'Test Council', { options: ['evidence', 'evidence', 'evidence', 'evidence'], asked });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p1', 'chooseOption:p2', 'chooseOption:p3', 'chooseOption:p4']);
  });
  it('a word nobody voted for does nothing (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Council', { options: ['evidence', 'evidence', 'evidence', 'evidence'] });
    expect(handSize(s, 'p1') - handSize(s0, 'p1')).toBe(4 - 1);
    expect(count(s, 'p1', 'Treasure Token')).toBe(0);
  });
});


// ---- "Whenever one or more creatures you control deal combat damage to one or more players this turn, ..." ------------------------------------------------------------------------

const RALLY = card('Test Rally', 'Sorcery', 'Create X 2/2 red Human Knight creature tokens with trample and haste. Whenever one or more creatures you control deal combat damage to one or more players this turn, you draw a card.', { cost: '{X}' });
const RALLY_EACH = card('Test Rally Each', 'Sorcery', 'Create X 2/2 red Human Knight creature tokens with trample and haste. Whenever one or more creatures you control deal combat damage to a player this turn, you draw a card.', { cost: '{X}' });

describe('CR 603.2c, 603.7: "Whenever one or more creatures you control deal combat damage to one or more players this turn, ..." is ONE trigger for the whole combat damage step', () => {
  const setup = (card: CardDef): GameState => mpScenario({ defs: [card], zones: { p1: { hand: [card.name], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: {}, p3: {}, p4: {} } });
  /** Cast for X = 2, attack p2 with one token and p3 with the other, finish combat damage; the hand size of p1 against the start of the turn after the cast. */
  const attackTwo = (def: CardDef): { s: GameState; drawn: number } => {
    let s = cast(setup(def), def.name, { numbers: [2] });
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && s.defs[s.objects[id]!.defId]!.name === 'Human Knight Token');
    expect(tokens.length).toBe(2);
    const before = handSize(s, 'p1');
    s = passUntil(s, (t) => t.pending?.kind === 'declareAttackers', 'declare attackers');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: tokens[0]!, defender: 'p2' }, { attacker: tokens[1]!, defender: 'p3' }] }));
    for (let guard = 0; guard < 80 && s.turn.step !== 'main2'; guard++) s = settle(s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : s);
    return { s, drawn: handSize(s, 'p1') - before };
  };
  it('is automated, and so is the "to a player" wording', () => {
    expect(full(RALLY)).toBe(true);
    expect(full(RALLY_EACH)).toBe(true);
  });
  it('damage dealt to two different players in one combat damage step triggers it ONCE ("one or more players")', () => {
    const { s, drawn } = attackTwo(RALLY);
    expect(drawn).toBe(1);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(18);
  });
  it('the "to a player" wording triggers once for each player dealt damage (the contrast, so the two readings are not one)', () => {
    expect(attackTwo(RALLY_EACH).drawn).toBe(2);
  });
  it('no combat damage to a player, no trigger; and the delayed trigger ends with the turn (CR 603.7b)', () => {
    let s = cast(setup(RALLY), 'Test Rally', { numbers: [1] });
    const before = handSize(s, 'p1');
    s = passUntil(s, (t) => t.turn.step === 'main2', 'the second main phase'); // nobody attacks
    expect(handSize(s, 'p1') - before).toBe(0);
    s = passUntil(s, (t) => t.turn.number === 2 && t.turn.step === 'main2', 'the next turn');
    expect(handSize(s, 'p1') - before).toBe(0);
  });
});


// ---- a two-player game: one chooser is still a group of choosers ----------------------------------------------------------------------------------------------------------------

describe('CR 608.2d, 101.4: "Each opponent chooses ..." with ONE opponent (a two-player game) still keeps the choice by player', () => {
  it('Master of Ceremonies reading: the one opponent who chose money gives you and them a Treasure token each; one who chose another word does not', () => {
    const run = (word: string): GameState => cast(scenario([], { defs: [CEREMONY], p1: { hand: ['Test Ceremony'] }, p2: {} }), 'Test Ceremony', { options: [word] });
    const money = run('money');
    expect(count(money, 'p1', 'Treasure Token')).toBe(1);
    expect(count(money, 'p2', 'Treasure Token')).toBe(1);
    const secrets = run('secrets');
    expect(count(secrets, 'p1', 'Treasure Token') + count(secrets, 'p2', 'Treasure Token')).toBe(0);
  });
  it('Seize the Spotlight reading: the one creature of the opponent who chose fame is gained; with fortune nothing is gained and you draw and make a Treasure', () => {
    const base = (): GameState => scenario([], { defs: [SPOTLIGHT, BEAR], p1: { hand: ['Test Spotlight'] }, p2: { battlefield: ['Test Bear'] } });
    const fame = cast(base(), 'Test Spotlight', { options: ['fame'] });
    expect(namesOn(fame, 'p1')).toEqual(['Test Bear']);
    const fortune = cast(base(), 'Test Spotlight', { options: ['fortune'] });
    expect(namesOn(fortune, 'p1')).toEqual(['Treasure Token']);
    expect(namesOn(fortune, 'p2')).toEqual(['Test Bear']);
  });
});
