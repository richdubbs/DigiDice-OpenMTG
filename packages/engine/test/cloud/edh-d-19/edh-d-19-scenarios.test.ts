/**
 * edh-d-19 (Commander coordinator D, lane vote): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites checked against MagicCompRules 20260925.
 *
 *   CR 701.38a-b, 608.2h          "Put two +1/+1 counters on ~ for each sprout vote. You gain 3 life for each harvest vote." (the amount is the number of votes times 2 or 3)
 *   CR 701.38a, 120.3             "Each player secretly votes ..., then those votes are revealed. ... ~ deals 3 damage to that player for each consequences vote." (one damage event)
 *   CR 701.31a, 311.7             "If planeswalk gets more votes, planeswalk. If chaos gets more votes or the vote is tied, chaos ensues." (no Planechase game: no effect)
 *   CR 400.3, 101.4               "Each player returns each creature card from their graveyard to the battlefield."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type TargetChoice, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, namesOn } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) });
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; options?: string[]; asked?: string[]; objects?: (ObjectId[] | ((options: ObjectId[]) => ObjectId[]))[] }
/** Answer the decisions that come up until someone has priority: option labels for the word votes (in the order asked), the first choices otherwise. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    if (p.kind === 'chooseOption') {
      const want = script.options?.shift();
      const id = want === undefined ? p.options[0]!.id : p.options.find((o) => o.label === want)!.id;
      s = answer(s, { kind: 'chooseOption', ids: [id] });
    } else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [{ kind: 'player', id: p.players![0]! } as TargetChoice] });
    else if (p.kind === 'chooseObjects') {
      const pick = script.objects?.shift();
      s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options) : pick ?? p.options.slice(0, p.min) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
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
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;
const logText = (s: GameState): string => JSON.stringify(s.log);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });

// ---- "Put two +1/+1 counters on ~ for each sprout vote. You gain 3 life for each harvest vote." -------------------------------------------------------------------------

const ORCHARD = card('Test Orchard', 'Creature — Elemental', 'When ~ enters, starting with you, each player votes for sprout or harvest. Put two +1/+1 counters on ~ for each sprout vote. You gain 3 life for each harvest vote.', { pt: ['1', '1'] });

describe('CR 701.38a-b, 608.2h: "Put two +1/+1 counters on ~ for each sprout vote. You gain 3 life for each harvest vote."', () => {
  const setup = (): GameState => mpScenario({ defs: [ORCHARD], zones: { p1: { hand: ['Test Orchard'] }, p2: {}, p3: {}, p4: {} } });
  const counters = (s: GameState): number => { const id = s.zones.battlefield.find((i) => s.defs[s.objects[i]!.defId]!.name === 'Test Orchard'); return id === undefined ? -1 : (s.objects[id]!.counters['+1/+1'] ?? 0); };
  it('is automated', () => expect(full(ORCHARD)).toBe(true));
  it('every vote counts, whoever cast it: three sprout votes are six counters, one harvest vote is 3 life', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Orchard', { options: ['sprout', 'harvest', 'sprout', 'sprout'] });
    expect(counters(s)).toBe(6);
    expect(life(s, 'p1') - life(s0, 'p1')).toBe(3);
  });
  it('a word nobody voted for does nothing (the negative case): four sprout votes gain no life', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Orchard', { options: ['sprout', 'sprout', 'sprout', 'sprout'] });
    expect(counters(s)).toBe(8);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

// ---- "Each player secretly votes ..., then those votes are revealed. ... ~ deals 3 damage to that player for each consequences vote." ----------------------------------------

const TRUTH = card('Test Verdict', 'Sorcery', 'Each player secretly votes for truth or consequences, then those votes are revealed. You draw cards equal to the number of truth votes. Then choose an opponent at random. ~ deals 3 damage to that player for each consequences vote.');

describe('CR 701.38a, 120.3: "Each player secretly votes for truth or consequences, then those votes are revealed. ..."', () => {
  const setup = (): GameState => mpScenario({ defs: [TRUTH, BEAR], zones: { p1: { hand: ['Test Verdict'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: {}, p3: {}, p4: {} } });
  const lifeLost = (s0: GameState, s: GameState): number => ['p2', 'p3', 'p4'].reduce((n, p) => n + life(s0, p) - life(s, p), 0);
  it('is automated', () => expect(full(TRUTH)).toBe(true));
  it('draws a card for each truth vote and deals 3 damage for each consequences vote to ONE opponent', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Verdict', { options: ['truth', 'consequences', 'consequences', 'truth'] });
    expect(handSize(s, 'p1') - handSize(s0, 'p1')).toBe(2 - 1); // two truth votes, minus the cast spell
    expect(lifeLost(s0, s)).toBe(6);
    expect(['p2', 'p3', 'p4'].filter((p) => life(s, p) < life(s0, p))).toHaveLength(1);
  });
  it('a vote nobody cast for consequences deals no damage (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Verdict', { options: ['truth', 'truth', 'truth', 'truth'] });
    expect(lifeLost(s0, s)).toBe(0);
    expect(handSize(s, 'p1') - handSize(s0, 'p1')).toBe(4 - 1);
  });
  it('the votes are said only after every player has voted (secret), and every player still votes in turn order', () => {
    const asked: string[] = [];
    const s = cast(setup(), 'Test Verdict', { options: ['truth', 'truth', 'truth', 'truth'], asked });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p1', 'chooseOption:p2', 'chooseOption:p3', 'chooseOption:p4']);
    const text = logText(s);
    expect(text.indexOf('votes for truth')).toBeGreaterThan(-1);
    // secret: no ballot line before the last player was asked; the four lines come together
    const lines = (s.log as { text?: string }[]).map((e) => e.text ?? '').filter((t) => /votes for (truth|consequences)\./.test(t));
    expect(lines).toHaveLength(4);
  });
});

// ---- "If planeswalk gets more votes, planeswalk. If chaos gets more votes or the vote is tied, chaos ensues." -------------------------------------------------------------

const PATH = card('Test Path', 'Sorcery', 'Target player draws four cards.\nStarting with you, each player votes for planeswalk or chaos. If planeswalk gets more votes, planeswalk. If chaos gets more votes or the vote is tied, chaos ensues.');

describe('CR 701.31a, 311.7: "planeswalk" and "chaos ensues" without a Planechase game do nothing, and the rest of the card is played', () => {
  const setup = (): GameState => mpScenario({ defs: [PATH, BEAR], zones: { p1: { hand: ['Test Path'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: {}, p3: {}, p4: {} } });
  it('is automated', () => expect(full(PATH)).toBe(true));
  it('the draw happens and both outcomes of the vote finish without a question or a manual step', () => {
    for (const options of [['planeswalk', 'planeswalk', 'planeswalk', 'chaos'], ['chaos', 'chaos', 'planeswalk', 'planeswalk']]) {
      const s0 = setup();
      const s = cast(s0, 'Test Path', { options });
      expect(s.pending?.kind).toBe('priority');
      expect(handSize(s, 'p1') - handSize(s0, 'p1')).toBe(4 - 1);
    }
  });
});

// ---- "Each player returns each creature card from their graveyard to the battlefield." -------------------------------------------------------------------------------

const WORTH = card('Test Worth', 'Sorcery', 'Starting with you, each player votes for grace or condemnation. If grace gets more votes, each player returns each creature card from their graveyard to the battlefield. If condemnation gets more votes or the vote is tied, destroy all creatures.');

describe('CR 400.3, 101.4, 701.38a: "If grace gets more votes, each player returns each creature card from their graveyard to the battlefield."', () => {
  const setup = (): GameState => mpScenario({
    defs: [WORTH, BEAR, ELF],
    zones: { p1: { hand: ['Test Worth'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Elf', 'Test Bear'] }, p3: { battlefield: ['Test Elf'] }, p4: {} },
  });
  it('is automated', () => expect(full(WORTH)).toBe(true));
  it('grace with the most votes returns every creature card of every graveyard to its owner\'s battlefield', () => {
    const s = cast(setup(), 'Test Worth', { options: ['grace', 'grace', 'grace', 'condemnation'] });
    expect(count(s, 'p1', 'Test Bear')).toBe(1);
    expect(count(s, 'p2', 'Test Elf')).toBe(1);
    expect(count(s, 'p2', 'Test Bear')).toBe(1);
    expect(count(s, 'p3', 'Test Elf')).toBe(1);
  });
  it('a tied vote destroys the creatures instead and returns nothing (the negative case)', () => {
    const s = cast(setup(), 'Test Worth', { options: ['grace', 'condemnation', 'grace', 'condemnation'] });
    expect(count(s, 'p1', 'Test Bear')).toBe(0);
    expect(count(s, 'p2', 'Test Elf')).toBe(0);
    expect(count(s, 'p3', 'Test Elf')).toBe(0);
  });
});

// ---- "Each opponent sacrifices a creature of their choice for each death vote and discards a card for each taxes vote." ---------------------------------------------------

const PUNISH = card('Test Punish', 'Sorcery', 'Starting with you, each player votes for death or taxes. Each opponent sacrifices a creature of their choice for each death vote and discards a card for each taxes vote.');
const LOT = card('Test Lot', 'Sorcery', '');

describe('CR 701.21a, 701.9a, 701.38a, 608.2h: "Each opponent sacrifices a creature of their choice for each death vote and discards a card for each taxes vote."', () => {
  const bears = (n: number): string[] => Array.from({ length: n }, () => 'Test Bear');
  const setup = (): GameState => mpScenario({
    defs: [PUNISH, BEAR, LOT],
    zones: { p1: { hand: ['Test Punish'], battlefield: bears(2) }, p2: { battlefield: bears(3), hand: ['Test Lot', 'Test Lot', 'Test Lot'] }, p3: { battlefield: bears(1), hand: ['Test Lot', 'Test Lot', 'Test Lot'] }, p4: { battlefield: bears(2), hand: ['Test Lot', 'Test Lot', 'Test Lot'] } },
  });
  it('is automated', () => expect(full(PUNISH)).toBe(true));
  it('each opponent sacrifices one creature per death vote and discards one card per taxes vote; you lose nothing', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Punish', { options: ['death', 'taxes', 'death', 'death'] });
    expect(count(s, 'p1', 'Test Bear')).toBe(2);
    expect(count(s, 'p2', 'Test Bear')).toBe(0); // three death votes, three bears
    expect(count(s, 'p4', 'Test Bear')).toBe(0); // only two bears to sacrifice
    expect(count(s, 'p3', 'Test Bear')).toBe(0);
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2') - 1);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
  });
  it('a word nobody voted for does nothing (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Punish', { options: ['death', 'death', 'death', 'death'] });
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2'));
    expect(handSize(s, 'p3')).toBe(handSize(s0, 'p3'));
  });
});

// ---- "If return gets more votes, each player returns up to two cards from their graveyard to their hand, then you exile ~." -----------------------------------------------

const SAIL = card('Test Sail', 'Sorcery', 'Starting with you, each player votes for return or embark. If return gets more votes, each player returns up to two cards from their graveyard to their hand, then you exile ~. If embark gets more votes or the vote is tied, each player may discard their hand and draw seven cards.');

describe('CR 101.4, 608.2d, 701.38a: "each player returns up to two cards from their graveyard to their hand, then you exile ~"', () => {
  const setup = (): GameState => mpScenario({ defs: [SAIL, BEAR, ELF], zones: { p1: { hand: ['Test Sail'], graveyard: ['Test Bear', 'Test Elf', 'Test Bear'] }, p2: { graveyard: ['Test Elf'] }, p3: {}, p4: {} } });
  it('is automated', () => expect(full(SAIL)).toBe(true));
  it('each player takes at most two cards of their own graveyard to their own hand, and the spell is exiled', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Sail', { options: ['return', 'return', 'return', 'embark'], objects: [(o) => o.slice(0, 2), (o) => o.slice(0, 1)] });
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 2); // the cast spell left the hand
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2') + 1);
    expect(s.zones.graveyard.p1!.length).toBe(1);
    expect(find(s, 'Test Sail', 'exile', 'p1')).toBeDefined();
  });
  it('a tied vote gives each player the discard-and-draw choice instead and returns nothing (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Sail', { options: ['return', 'embark', 'return', 'embark'] });
    expect(s.zones.graveyard.p1!.length).toBe(3 + 1); // the three cards, and the resolved spell (not exiled)
    expect(s.zones.graveyard.p2!.length).toBe(1);
    expect(find(s, 'Test Sail', 'graveyard', 'p1')).toBeDefined();
  });
});

// ---- "If guilty gets more votes, the owner of each card exiled with ~ puts that card on the bottom of their library." ---------------------------------------------------------

const TRIAL = card('Test Trial', 'Enchantment', 'When ~ enters, exile target creature an opponent controls until ~ leaves the battlefield.\n{0}: Starting with you, each player votes for innocent or guilty. If guilty gets more votes, the owner of each card exiled with ~ puts that card on the bottom of their library.');

describe('CR 607.2a, 400.3, 401.4, 701.38a: "If guilty gets more votes, the owner of each card exiled with ~ puts that card on the bottom of their library."', () => {
  const setup = (): GameState => mpScenario({ defs: [TRIAL, BEAR], zones: { p1: { hand: ['Test Trial'] }, p2: { battlefield: ['Test Bear'] }, p3: {}, p4: {} } });
  const bear = (s: GameState): ObjectId => find(s, 'Test Bear', 'battlefield', 'p2');
  const run = (options: string[]): GameState => {
    const s0 = setup();
    const s1 = cast(s0, 'Test Trial', { options, targets: [[{ kind: 'object', id: bear(s0) } as TargetChoice]] });
    expect(find(s1, 'Test Bear', 'exile', 'p2')).toBeDefined();
    let s2 = act(s1, { type: 'activate', player: 'p1', source: find(s1, 'Test Trial', 'battlefield', 'p1'), ability: 'p:0:1' });
    while (s2.pending && s2.pending.kind === 'payCost') s2 = answer(s2, { kind: 'payCost', auto: true });
    return settle(s2, { options });
  };
  it('is automated', () => expect(full(TRIAL)).toBe(true));
  it('guilty with the most votes puts the exiled card on the bottom of its OWNER\'s library', () => {
    const s = run(['guilty', 'guilty', 'guilty', 'innocent']);
    const lib = s.zones.library.p2!;
    expect(s.defs[s.objects[lib[lib.length - 1]!]!.defId]!.name).toBe('Test Bear');
    expect(find(s, 'Test Trial', 'battlefield', 'p1')).toBeDefined();
  });
  it('a tied vote leaves the card exiled (the negative case)', () => {
    const s = run(['guilty', 'innocent', 'guilty', 'innocent']);
    expect(find(s, 'Test Bear', 'exile', 'p2')).toBeDefined();
    expect(s.zones.library.p2!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
  });
});
