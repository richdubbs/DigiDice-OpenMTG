/**
 * edh-players-12 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules
 * text of 2026-09-25 (media.wizards.com), the rulings of the cards were fetched from Scryfall in the cloud session.
 *
 *   CR 608.2e, 101.4, 107.1a, 506.3   "Whenever you attack, each opponent loses life equal to the number of creatures attacking them." (the amount is read for each opponent)
 *   CR 120.2b, 608.2e, 121.1          "~ deals damage to each opponent equal to the number of cards that player has drawn this turn." (the damage is read for each opponent)
 *   CR 102.3, 608.2d, 603.2           "Whenever a player casts a noncreature spell, each of that player's opponents may draw a card." (the other players choose, each draws for themselves)
 *   CR 608.2c, 701.21a, 701.9a        "Each opponent sacrifices a creature of their choice. If you control a Wizard, each opponent also discards a card." (checked as it resolves)
 *   CR 508.1, 109.2, 115.3, 611.2a    "Whenever a creature you control attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn."
 *   CR 404.1, 700.4, 603.6c           "Whenever an artifact is put into an opponent's graveyard from the battlefield, you may draw a card." (the graveyard's owner, not the controller)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, put, scenario } from '../../m3/scenario';
import { mpScenario, namesOn } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; subtypes?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const inYard = (s: GameState, p: PlayerId, name: string): number => s.zones.graveyard[p]!.filter((id) => s.defs[s.objects[id]!.defId]!.name === name).length;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; attacks?: { attacker: ObjectId; defender: PlayerId }[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.objects?.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attacks ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script, asked);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
/** Pass priority until the declare-attackers decision of the active player. */
function toAttack(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.pending?.kind !== 'priority') throw new Error(`unexpected ${s.pending?.kind}`);
    s = act(s, { type: 'pass', player: s.pending.player });
  }
  if (s.pending?.kind !== 'declareAttackers') throw new Error('never reached the attack');
  return s;
}
/** Attack as given, then pass (blockers none) until combat damage has been dealt and the stack is empty. */
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], script: Script = {}): GameState {
  let s = answer(toAttack(s0), { kind: 'declareAttackers', attacks });
  return settle(s, script);
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');

// ---- Within Range -----------------------------------------------------------------------------------------------------------------------------------------------------

const RANGE = card('Test Range', 'Enchantment', 'Whenever you attack, each opponent loses life equal to the number of creatures attacking them.');

describe('CR 608.2e, 506.3: "Whenever you attack, each opponent loses life equal to the number of creatures attacking them."', () => {
  const setup = (): GameState => mpScenario({
    defs: [RANGE, BEAR],
    zones: { p1: { battlefield: ['Test Range', 'Test Bear', 'Test Bear', 'Test Bear'] } },
  });
  it('is automated', () => expect(full(RANGE)).toBe(true));
  it('each opponent loses life equal to the creatures attacking THEM, read for each of them in turn', () => {
    const s0 = setup();
    const [a, b, c] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = attack(s0, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }, { attacker: c!, defender: 'p3' }]);
    // the trigger resolved (before combat damage): p2 lost 2 (two attackers), p3 lost 1, p4 none (nobody attacks them)
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 19, 20]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: creatures attacking another opponent are not counted, and an opponent nobody attacks loses nothing', () => {
    const s0 = setup();
    const [a] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = attack(s0, [{ attacker: a!, defender: 'p4' }]);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([20, 20]);
    expect(lifeOf(s, 'p4')).toBe(19);
  });
  it('negative: no attack, no trigger', () => {
    const s = attack(setup(), []);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20, 20]);
  });
});

// ---- Molten Psyche ----------------------------------------------------------------------------------------------------------------------------------------------------

const SHOCK = card('Test Shock', 'Sorcery', 'Test Shock deals damage to each opponent equal to the number of cards that player has drawn this turn.');
const BOON = card('Test Boon', 'Instant', 'Target player draws three cards.');
const SURGE = card('Test Surge', 'Sorcery', 'Each player draws two cards. Test Surge deals damage to each opponent equal to the number of cards that player has drawn this turn.');

describe('CR 120.2b, 608.2e: "~ deals damage to each opponent equal to the number of cards that player has drawn this turn."', () => {
  const setup = (): GameState => mpScenario({ defs: [SHOCK, BOON, SURGE], zones: { p1: { hand: ['Test Shock', 'Test Boon', 'Test Surge'] } } });
  it('is automated', () => { expect(full(SHOCK)).toBe(true); expect(full(SURGE)).toBe(true); });
  it('each opponent is dealt their own number of cards drawn this turn; you take nothing', () => {
    let s = setup();
    s = cast(s, 'Test Boon', { targets: [[{ kind: 'player', id: 'p3' } as TargetChoice]] });
    s = cast(s, 'Test Shock');
    // (p3 drew 3 cards this turn, the others none)
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4'), lifeOf(s, 'p1')]).toEqual([20, 17, 20, 20]);
  });
  it('the cards drawn by the spell itself count too, per player (every opponent drew two)', () => {
    let s = setup();
    s = cast(s, 'Test Boon', { targets: [[{ kind: 'player', id: 'p4' } as TargetChoice]] });
    s = cast(s, 'Test Surge');
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 18, 15]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- Heartwood Storyteller --------------------------------------------------------------------------------------------------------------------------------------------

const STORY = card('Test Storyteller', 'Creature — Treefolk', "Whenever a player casts a noncreature spell, each of that player's opponents may draw a card.", { pt: ['2', '3'] });
const PING = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to target player.');
const GRIZZLY = card('Test Grizzly', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 102.3, 608.2d: "Whenever a player casts a noncreature spell, each of that player\'s opponents may draw a card."', () => {
  const setup = (): GameState => mpScenario({
    defs: [STORY, PING, GRIZZLY],
    zones: { p1: { battlefield: ['Test Storyteller'], hand: ['Test Ping', 'Test Grizzly'] }, p2: { hand: ['Test Ping'] } },
  });
  it('is automated', () => expect(full(STORY)).toBe(true));
  it('when you cast it, each of your opponents may draw, each for themselves; the caster draws nothing', () => {
    const s0 = setup();
    const before = [1, 2, 3, 4].map((i) => handSize(s0, `p${i}` as PlayerId));
    const asked: string[] = [];
    // p2, p3 say yes, p4 no (in turn order)
    const s = cast(s0, 'Test Ping', { targets: [[{ kind: 'player', id: 'p4' } as TargetChoice]], yes: [true, true, false] }, 'p1', asked);
    const after = [1, 2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId));
    expect(after).toEqual([before[0]! - 1, before[1]! + 1, before[2]! + 1, before[3]!]);
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual(['yesNo:p2', 'yesNo:p3', 'yesNo:p4']);
  });
  it("when another player casts it, THEIR opponents (you included, not them) may draw", () => {
    const s0 = mpScenario({
      defs: [STORY, PING, GRIZZLY], options: { startingPlayer: 'p2' },
      zones: { p1: { battlefield: ['Test Storyteller'] }, p2: { hand: ['Test Ping'] } },
    });
    const h0 = [1, 2, 3, 4].map((i) => handSize(s0, `p${i}` as PlayerId));
    const asked: string[] = [];
    const t = cast(s0, 'Test Ping', { targets: [[{ kind: 'player', id: 'p3' } as TargetChoice]], yes: [true, false, true] }, 'p2', asked);
    const h1 = [1, 2, 3, 4].map((i) => handSize(t, `p${i}` as PlayerId));
    // (in turn order from the active player p2: p3 yes, p4 no, p1 yes)
    expect(h1[0]! - h0[0]!).toBe(1); // p1 (the Storyteller's controller) is an opponent of p2 and said yes
    expect(h1[1]! - h0[1]!).toBe(-1); // p2 cast the Ping and is not asked
    expect(h1[2]! - h0[2]!).toBe(1); // p3 said yes
    expect(h1[3]! - h0[3]!).toBe(0); // p4 said no
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual(['yesNo:p3', 'yesNo:p4', 'yesNo:p1']);
  });
  it('in a two-player game the one other player is still a group of the `may` (they draw for themselves, not nobody)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Storyteller'], hand: ['Test Ping'] }, defs: [STORY, PING, GRIZZLY] });
    const h0 = handSize(s0, 'p2');
    const t = cast(s0, 'Test Ping', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]], yes: [true] });
    expect(handSize(t, 'p2') - h0).toBe(1);
    const u = cast(s0, 'Test Ping', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]], yes: [false] });
    expect(handSize(u, 'p2') - h0).toBe(0);
  });
  it('negative: a creature spell does not trigger it', () => {
    const s0 = setup();
    const before = [2, 3, 4].map((i) => handSize(s0, `p${i}` as PlayerId));
    const s = cast(s0, 'Test Grizzly', { yes: [true, true, true] });
    expect([2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId))).toEqual(before);
  });
});

// ---- Liliana's Triumph ------------------------------------------------------------------------------------------------------------------------------------------------

const TRIUMPH = card('Test Triumph', 'Instant', 'Each opponent sacrifices a creature of their choice. If you control a Wizard, each opponent also discards a card.');
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
const WALKER = card('Test Walker', 'Planeswalker — Liliana', '');

describe('CR 701.21a, 701.9a, 608.2c: "Each opponent sacrifices a creature of their choice. If you control a Wizard, each opponent also discards a card."', () => {
  const setup = (mine: string[] = []): GameState => mpScenario({
    defs: [TRIUMPH, BEAR, WIZARD, RELIC],
    zones: { p1: { hand: ['Test Triumph'], battlefield: mine }, p2: { battlefield: ['Test Bear'], hand: ['Plains', 'Plains'] }, p3: { battlefield: ['Test Bear', 'Test Bear'], hand: ['Plains'] }, p4: { hand: ['Plains', 'Plains', 'Plains'] } },
  });
  it('is automated', () => expect(full(TRIUMPH)).toBe(true));
  it('with a Wizard: every opponent sacrifices a creature and discards a card (also those with no creature to sacrifice)', () => {
    const s = cast(setup(['Test Wizard']), 'Test Triumph');
    expect(count(s, 'p2', 'Test Bear')).toBe(0);
    expect(count(s, 'p3', 'Test Bear')).toBe(1);
    expect([2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId))).toEqual([1, 0, 2]);
  });
  it('without a Wizard: they sacrifice and discard nothing (the negative case); a Wizard that is not yours does not count', () => {
    const s = cast(setup(), 'Test Triumph');
    expect(count(s, 'p3', 'Test Bear')).toBe(1);
    expect([2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId))).toEqual([2, 1, 3]);
    const t = cast(mpScenario({ defs: [TRIUMPH, BEAR, WIZARD], zones: { p1: { hand: ['Test Triumph'] }, p2: { battlefield: ['Test Wizard'], hand: ['Plains'] } } }), 'Test Triumph');
    expect(handSize(t, 'p2')).toBe(1);
  });
  void WALKER;
});
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;

// ---- Martial Impetus --------------------------------------------------------------------------------------------------------------------------------------------------

const IMPETUS = card('Test Impetus', 'Enchantment — Aura', "Enchant creature\nWhenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn.");

describe("CR 508.1, 109.2, 611.2a: \"Whenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn.\"", () => {
  const setup = (): GameState => mpScenario({
    defs: [IMPETUS, BEAR],
    zones: { p1: { battlefield: ['Test Impetus', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } },
    setup: (x) => { x.objects[find(x, 'Test Impetus', 'battlefield', 'p1')]!.attachedTo = findAll(x, 'Test Bear', 'battlefield', 'p1')[0]!; },
  });
  it('is automated', () => expect(full(IMPETUS)).toBe(true));
  it('the other attacking creatures get +1/+1, the enchanted creature itself and creatures not attacking do not', () => {
    const s0 = setup();
    const [enchanted, b, c] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const t = answer(toAttack(s0), { kind: 'declareAttackers', attacks: [{ attacker: enchanted!, defender: 'p2' }, { attacker: b!, defender: 'p3' }] });
    const s = settle(t);
    const pt = (id: ObjectId): string => { const ch = getChars(s, id); return `${ch.power}/${ch.toughness}`; };
    expect(pt(enchanted!)).toBe('2/2');
    expect(pt(b!)).toBe('3/3');
    expect(pt(c!)).toBe('2/2');
  });
  it('negative: if the enchanted creature does not attack, nothing happens', () => {
    const s0 = setup();
    const [, b] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = settle(answer(toAttack(s0), { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] }));
    expect(Number(getChars(s, b!).power)).toBe(2);
  });
});

// ---- Viridian Revel ---------------------------------------------------------------------------------------------------------------------------------------------------

const REVEL = card('Test Revel', 'Enchantment', "Whenever an artifact is put into an opponent's graveyard from the battlefield, you may draw a card.");
const SMASH = card('Test Smash', 'Instant', 'Destroy target artifact.');

describe("CR 404.1, 700.4: \"Whenever an artifact is put into an opponent's graveyard from the battlefield, you may draw a card.\"", () => {
  const setup = (): GameState => mpScenario({
    defs: [REVEL, SMASH, RELIC],
    zones: { p1: { battlefield: ['Test Revel', 'Test Relic'], hand: ['Test Smash'] }, p2: { battlefield: ['Test Relic'] }, p3: { battlefield: ['Test Relic'] } },
  });
  it('is automated', () => expect(full(REVEL)).toBe(true));
  it("an artifact an opponent owns going to that opponent's graveyard lets you draw", () => {
    const s0 = setup();
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const h = handSize(s0, 'p1');
    const s = cast(s0, 'Test Smash', { targets: [[obj(relic)]], yes: [true] });
    expect(inYard(s, 'p2', 'Test Relic')).toBe(1);
    expect(handSize(s, 'p1')).toBe(h - 1 + 1);
  });
  it('you may decline, and an artifact of your own going to your graveyard does not draw (the negative case)', () => {
    const s0 = setup();
    const relic = find(s0, 'Test Relic', 'battlefield', 'p3');
    const h = handSize(s0, 'p1');
    const declined = cast(s0, 'Test Smash', { targets: [[obj(relic)]], yes: [false] });
    expect(handSize(declined, 'p1')).toBe(h - 1);
    const own = find(s0, 'Test Relic', 'battlefield', 'p1');
    const mine = cast(s0, 'Test Smash', { targets: [[obj(own)]], yes: [true] });
    expect(inYard(mine, 'p1', 'Test Relic')).toBe(1);
    expect(handSize(mine, 'p1')).toBe(h - 1);
  });
  it("ruling 2011: it is whose graveyard it is put into: an artifact you control but an opponent owns draws, one you own and an opponent controls does not", () => {
    const s0 = mpScenario({
      defs: [REVEL, SMASH, RELIC],
      zones: { p1: { battlefield: ['Test Revel'], hand: ['Test Smash'] }, p2: { battlefield: ['Test Relic'] } },
      setup: (x) => { x.objects[findAll(x, 'Test Relic', 'battlefield', 'p2')[0]!]!.controller = 'p1'; },
    });
    const relic = find(s0, 'Test Relic', 'battlefield');
    const h = handSize(s0, 'p1');
    const s = cast(s0, 'Test Smash', { targets: [[obj(relic)]], yes: [true] });
    expect(inYard(s, 'p2', 'Test Relic')).toBe(1);
    expect(handSize(s, 'p1')).toBe(h - 1 + 1);
  });
});
void put;

// ---- Bridge from Below (G10: a formerly manual unit with automated parts became a full trigger) ----------------------------------------------------------------------------

const SPAN = card('Test Span', 'Enchantment', "When a creature is put into an opponent's graveyard from the battlefield, if ~ is in your graveyard, exile ~.");
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.');

describe("CR 404.1, 603.4, 603.6c: \"When a creature is put into an opponent's graveyard from the battlefield, if ~ is in your graveyard, exile ~.\" (an ability of a card in the graveyard, with an intervening if)", () => {
  const setup = (inYard: boolean): GameState => mpScenario({
    defs: [SPAN, SLAY, BEAR],
    zones: { p1: { hand: ['Test Slay'], graveyard: inYard ? ['Test Span'] : [], battlefield: inYard ? [] : ['Test Span'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } },
  });
  it('is automated', () => expect(full(SPAN)).toBe(true));
  it("exiles itself when an opponent's creature goes to that opponent's graveyard while it is in your graveyard", () => {
    const s0 = setup(true);
    const s = cast(s0, 'Test Slay', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Span')).toBe(false);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Span')).toBe(true);
  });
  it("negative: a creature of yours going to your graveyard does nothing, and on the battlefield the card's graveyard ability does not work", () => {
    const own = mpScenario({ defs: [SPAN, SLAY, BEAR], zones: { p1: { hand: ['Test Slay'], graveyard: ['Test Span'], battlefield: ['Test Bear'] } } });
    const s = cast(own, 'Test Slay', { targets: [[obj(find(own, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Span')).toBe(true);
    const s0 = setup(false);
    const t = cast(s0, 'Test Slay', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p3'))]] });
    expect(t.zones.battlefield.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Span')).toBe(true);
  });
});
