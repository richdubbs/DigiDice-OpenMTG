/**
 * edh-players-9 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The rulings of the cards were fetched from Scryfall in the cloud session
 * (2026-10-28); the CR numbers cited are from the Comprehensive Rules of 2026-09-25 except where a test says otherwise.
 *
 *   CR 121.1, 102.3, 603.4, 608.2h   "draw a card for each opponent who drew two or more cards this turn, then create a Treasure token for each opponent who had two or more lands enter ..."
 *   CR 120.2a, 510.2, 800.4           "you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards." (Tymna the Weaver's ruling 2020-11-10)
 *   CR 102.1, 119.1, 402.1, 608.2c   "draw a card if that player has more cards in hand than each other player" (Battle Angels of Tyr)
 *   CR 903.3, 107.3, 608.2h          "You draw X cards and you lose X life, where X is the mana value of a commander you own on the battlefield or in the command zone." (Stinging Study)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, concede, drive, find, lifeOf, mpScenario, pass, passUntil, put, resolveStack } from '../../m12/rules/helpers';
import { commanderScenario, inCommand, legend } from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as unknown as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const count = (s: GameState, p: PlayerId, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === name).length;
const target = (p: PlayerId): DecisionAnswer => ({ kind: 'chooseTargets', targets: [{ kind: 'player', id: p }] });
/** `player` casts `name` from their hand (answers for the cast, then for the resolution) and everyone passes until the stack is empty. */
const cast = (s: GameState, name: string, answers: DecisionAnswer[] = [], player: PlayerId = 'p1', later: DecisionAnswer[] = []): GameState =>
  resolveStack(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers), later);
/** On to the end step of the turn and its triggers resolved. */
const endOfTurn = (s: GameState, answers: DecisionAnswer[] = []): GameState => resolveStack(passUntil(s, (x) => x.turn.step === 'end', 'the end step'), answers);

describe('CR 121.1, 102.3, 603.4: "for each opponent who drew two or more cards this turn" (Smuggler\'s Share\'s shape), each opponent judged alone', () => {
  const SHARE = card('Test Smuggler Hoard', 'Enchantment', 'At the beginning of each end step, draw a card for each opponent who drew two or more cards this turn, then create a Treasure token for each opponent who had two or more lands enter the battlefield under their control this turn.');
  const GIFT2 = card('Test Gift Two', 'Sorcery', 'Target player draws two cards.');
  const GIFT1 = card('Test Gift One', 'Sorcery', 'Target player draws a card.');
  const LANDS2 = card('Test Fields Two', 'Sorcery', 'Target player creates two tapped Forest land tokens.');
  const LANDS1 = card('Test Fields One', 'Sorcery', 'Target player creates a tapped Forest land token.');
  const defs = [SHARE, GIFT2, GIFT1, LANDS2, LANDS1];
  const setup = (hand: string[]): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Smuggler Hoard'], hand } } });
  /** In a game of more than two players the starting player draws in the first turn (CR 103.8a): one card in hand before anything is cast. */
  const DRAW_STEP = handSize(setup([]), 'p1');
  it('is automated', () => expect(full(SHARE)).toBe(true));
  it('one opponent who drew two cards (another who drew one, another none): one card; the draws of the controller are not counted', () => {
    let s = setup(['Test Gift Two', 'Test Gift One', 'Test Gift Two']);
    s = cast(s, 'Test Gift Two', [target('p2')]);
    s = cast(s, 'Test Gift One', [target('p3')]);
    s = cast(s, 'Test Gift Two', [target('p1')]); // the controller drew two cards: an opponent of nobody
    const before = handSize(s, 'p1');
    expect(before).toBe(DRAW_STEP + 2); // the two cards it drew itself
    s = endOfTurn(s);
    expect(handSize(s, 'p1')).toBe(before + 1);
    expect(count(s, 'p1', 'Treasure Token')).toBe(0);
  });
  it('two opponents who each drew two cards: two cards', () => {
    let s = setup(['Test Gift Two', 'Test Gift Two']);
    s = cast(s, 'Test Gift Two', [target('p2')]);
    s = cast(s, 'Test Gift Two', [target('p4')]);
    s = endOfTurn(s);
    expect(handSize(s, 'p1')).toBe(DRAW_STEP + 2);
  });
  it('two separate draws of one card each add up for the same opponent (two cards drawn this turn)', () => {
    let s = setup(['Test Gift One', 'Test Gift One']);
    s = cast(s, 'Test Gift One', [target('p2')]);
    s = cast(s, 'Test Gift One', [target('p2')]);
    s = endOfTurn(s);
    expect(handSize(s, 'p1')).toBe(DRAW_STEP + 1);
  });
  it('no draws this turn: nothing', () => {
    const s = endOfTurn(setup([]));
    expect(handSize(s, 'p1')).toBe(DRAW_STEP);
    expect(count(s, 'p1', 'Treasure Token')).toBe(0);
  });
  it('lands: an opponent with two lands entering gives a Treasure; one land, and the controller\'s own lands, do not', () => {
    let s = setup(['Test Fields Two', 'Test Fields One', 'Test Fields Two']);
    s = cast(s, 'Test Fields Two', [target('p2')]);
    s = cast(s, 'Test Fields One', [target('p3')]);
    s = cast(s, 'Test Fields Two', [target('p1')]);
    s = endOfTurn(s);
    expect(count(s, 'p1', 'Treasure Token')).toBe(1);
    expect(handSize(s, 'p1')).toBe(DRAW_STEP);
  });
  it('both counts in one trigger: a card for the drawer and a Treasure for the lands', () => {
    let s = setup(['Test Gift Two', 'Test Fields Two']);
    s = cast(s, 'Test Gift Two', [target('p3')]);
    s = cast(s, 'Test Fields Two', [target('p4')]);
    s = endOfTurn(s);
    expect(handSize(s, 'p1')).toBe(DRAW_STEP + 1);
    expect(count(s, 'p1', 'Treasure Token')).toBe(1);
  });
  it('what happened on an earlier turn is not counted (the history of the turn only)', () => {
    let s = setup(['Test Gift Two']);
    s = cast(s, 'Test Gift Two', [target('p2')]);
    s = endOfTurn(s);
    expect(handSize(s, 'p1')).toBe(DRAW_STEP + 1);
    // the next turn's end step (Bob's): Bob drew his draw step's card only; nobody drew two this turn
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'end' && x.zones.stack.length > 0 && x.turn.activePlayer === 'p2', 'the end step of turn 2');
    const hand = handSize(s, 'p1');
    s = resolveStack(s);
    expect(handSize(s, 'p1')).toBe(hand);
  });
});

describe('CR 120.2a, 510.2, 800.4: "the number of opponents that were dealt combat damage this turn" (Tymna the Weaver\'s shape)', () => {
  const WEAVER = card('Test Weaver', 'Legendary Creature — Human Cleric', 'At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.', { pt: ['2', '2'] });
  it('is automated', () => expect(full(WEAVER)).toBe(true));
  const setup = (): GameState => mpScenario({ defs: [WEAVER], cards: ['Grizzly Bears', 'Hill Giant', 'Gray Ogre'], zones: { p1: { battlefield: ['Test Weaver', 'Grizzly Bears', 'Hill Giant', 'Gray Ogre'] } } });
  /** Attack with the creatures named (each at the player given) and on to the postcombat main phase. */
  function combat(s0: GameState, attacks: { name: string; at: PlayerId }[]): GameState {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: attacks.map((a) => ({ attacker: find(s, a.name, 'battlefield', 'p1'), defender: a.at })) });
    return passUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length > 0, 'the postcombat main phase');
  }
  it('two opponents dealt combat damage (the third not): pay 2 life, draw 2 cards', () => {
    let s = combat(setup(), [{ name: 'Grizzly Bears', at: 'p2' }, { name: 'Hill Giant', at: 'p3' }, { name: 'Gray Ogre', at: 'p3' }]);
    const hand = handSize(s, 'p1');
    s = resolveStack(s, [{ kind: 'yesNo', yes: true }]);
    expect(handSize(s, 'p1')).toBe(hand + 2);
    expect(lifeOf(s, 'p1')).toBe(18);
  });
  it('declined: nothing is paid and nothing is drawn (you must pay exactly X life or none)', () => {
    let s = combat(setup(), [{ name: 'Grizzly Bears', at: 'p2' }, { name: 'Hill Giant', at: 'p3' }]);
    const hand = handSize(s, 'p1');
    s = resolveStack(s, [{ kind: 'yesNo', yes: false }]);
    expect(handSize(s, 'p1')).toBe(hand);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('no combat damage dealt to an opponent: X is 0 and paying draws nothing', () => {
    let s = passUntil(setup(), (x) => x.turn.step === 'main2' && x.zones.stack.length > 0, 'the postcombat main phase');
    const hand = handSize(s, 'p1');
    s = resolveStack(s, [{ kind: 'yesNo', yes: true }]);
    expect(handSize(s, 'p1')).toBe(hand);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('an opponent dealt combat damage who then loses the game is still counted (the 2020-11-10 ruling)', () => {
    let s = combat(setup(), [{ name: 'Grizzly Bears', at: 'p2' }, { name: 'Hill Giant', at: 'p3' }]);
    const hand = handSize(s, 'p1');
    s = concede(s, 'p3').state;
    expect(s.pending?.kind).toBe('priority');
    s = resolveStack(s, [{ kind: 'yesNo', yes: true }]);
    expect(handSize(s, 'p1')).toBe(hand + 2);
    expect(lifeOf(s, 'p1')).toBe(18);
  });
  it('damage to a creature (the attacker was blocked) is not damage dealt to an opponent: X is 0', () => {
    const s0 = mpScenario({ defs: [WEAVER], cards: ['Grizzly Bears', 'Hill Giant'], zones: { p1: { battlefield: ['Test Weaver', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } } });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p2' }] });
    while (s.pending?.kind !== 'declareBlockers' || s.pending.player !== 'p2') s = pass(s);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Hill Giant', 'battlefield', 'p2'), attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1') }] });
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length > 0, 'the postcombat main phase');
    const hand = handSize(s, 'p1');
    s = resolveStack(s, [{ kind: 'yesNo', yes: true }]);
    expect(handSize(s, 'p1')).toBe(hand);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 102.1, 119.1, 402.1, 608.2c: "that player has more cards in hand / controls more lands / has more life than each other player" (Battle Angels of Tyr\'s shape)', () => {
  const ANGEL = card('Test Tyr Angel', 'Creature — Angel', 'Whenever ~ deals combat damage to a player, draw a card if that player has more cards in hand than each other player. Then you create a Treasure token if that player controls more lands than each other player. Then you gain 3 life if that player has more life than each other player.', { pt: ['2', '2'] });
  it('is automated', () => expect(full(ANGEL)).toBe(true));
  /** p1 attacks the player with the Angel; hands, lands and life are set by the caller before the attack. */
  function hit(setup: (s: GameState) => void, at: PlayerId = 'p2'): GameState {
    const s0 = mpScenario({ defs: [ANGEL], cards: ['Forest'], zones: { p1: { battlefield: ['Test Tyr Angel'] } }, setup });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Tyr Angel', 'battlefield', 'p1'), defender: at }] });
    return passUntil(s, (x) => x.turn.step === 'main2', 'the postcombat main phase');
  }
  const lead = (s: GameState): void => {
    for (let i = 0; i < 6; i++) { /* Bob's hand: six more cards than anyone */ }
    void s;
  };
  void lead;
  const withHand = (n: number, who: PlayerId) => (s: GameState): void => { for (let i = 0; i < n; i++) put(s, who, 'hand', 'Forest'); };
  const withLands = (n: number, who: PlayerId) => (s: GameState): void => { for (let i = 0; i < n; i++) put(s, who, 'battlefield', 'Forest'); };
  const withLife = (n: number, who: PlayerId) => (s: GameState): void => { s.players.find((p) => p.id === who)!.life = n; };
  it('the player with more of each than every other player: a card, a Treasure and 3 life', () => {
    const s = hit((st) => { withHand(5, 'p2')(st); withLands(3, 'p2')(st); withLife(30, 'p2')(st); });
    // p1: the draw step's card + the Angel's draw; p2 also was dealt 2 combat damage
    expect(handSize(s, 'p1')).toBe(2);
    expect(count(s, 'p1', 'Treasure Token')).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('tied with another player for the most of each: nothing (more than EACH other player)', () => {
    const s = hit((st) => { withHand(5, 'p2')(st); withHand(5, 'p3')(st); withLands(3, 'p2')(st); withLands(3, 'p4')(st); withLife(30, 'p2')(st); withLife(30, 'p3')(st); });
    expect(handSize(s, 'p1')).toBe(1);
    expect(count(s, 'p1', 'Treasure Token')).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('the attacking player counts as one of the other players (a controller with more hand and life than the defender)', () => {
    const s = hit((st) => { withHand(9, 'p1')(st); withLife(60, 'p1')(st); withHand(2, 'p2')(st); });
    expect(handSize(s, 'p1')).toBe(10);
    expect(lifeOf(s, 'p1')).toBe(60);
  });
  it('each condition is judged by itself: more life only gives only the life (the conditions are separate, checked as the ability resolves)', () => {
    const s = hit((st) => { withLife(40, 'p2')(st); });
    expect(handSize(s, 'p1')).toBe(1);
    expect(count(s, 'p1', 'Treasure Token')).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});

describe('CR 903.3, 107.3, 608.2h: Stinging Study\'s shape - the mana value of a commander you own on the battlefield or in the command zone, chosen among partners', () => {
  const STUDY = card('Test Study', 'Instant', 'You draw X cards and you lose X life, where X is the mana value of a commander you own on the battlefield or in the command zone.');
  const small = legend('Test Small Partner', '{2}{G}', ['2', '2'], ['G'], 'Partner');
  const big = legend('Test Big Partner', '{3}{G}{G}', ['4', '4'], ['G'], 'Partner');
  it('is automated', () => expect(full(STUDY)).toBe(true));
  const setup = (cmds = [small, big]): GameState => commanderScenario({ p1Commanders: cmds, p2Commanders: [legend('Test Foe Chief', '{2}{R}', ['2', '2'], ['R'])], defs: [STUDY], p1: { hand: ['Test Study'] } });
  const study = (s: GameState, later: DecisionAnswer[] = []): GameState => resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Study', 'hand', 'p1') })), later);
  it('two commanders: the player chooses one as it resolves (the 2021-04-16 ruling): the five-mana one draws five and loses five life', () => {
    const s0 = setup();
    const before = handSize(s0, 'p1');
    const s = study(s0, [{ kind: 'chooseObjects', ids: [inCommand(s0, 'Test Big Partner')] }]);
    expect(handSize(s, 'p1')).toBe(before - 1 + 5);
    expect(lifeOf(s, 'p1')).toBe(40 - 5);
  });
  it('the other choice draws three: the choice is the controller\'s', () => {
    const s0 = setup();
    const before = handSize(s0, 'p1');
    const s = study(s0, [{ kind: 'chooseObjects', ids: [inCommand(s0, 'Test Small Partner')] }]);
    expect(handSize(s, 'p1')).toBe(before - 1 + 3);
    expect(lifeOf(s, 'p1')).toBe(40 - 3);
  });
  it('one commander: no choice is asked', () => {
    const s0 = setup([big]);
    const before = handSize(s0, 'p1');
    const s = study(s0);
    expect(handSize(s, 'p1')).toBe(before - 1 + 5);
    expect(lifeOf(s, 'p1')).toBe(40 - 5);
  });
  it('a commander that is in neither zone (in the graveyard) is not counted: X is 0', () => {
    const s0 = setup([big]);
    const rec = s0.players.find((p) => p.id === 'p1')!.commanders![0]!;
    const obj = s0.zones.command.find((x) => s0.objects[x]!.cardId === rec.card)!;
    const t = structuredClone(s0);
    t.zones.command = t.zones.command.filter((x) => x !== obj);
    t.zones.graveyard.p1!.push(obj);
    t.objects[obj]!.zone = 'graveyard';
    const before = handSize(t, 'p1');
    const s = study(t);
    expect(handSize(s, 'p1')).toBe(before - 1);
    expect(lifeOf(s, 'p1')).toBe(40);
  });
});

describe('CR 120.1, 510.2, 701.21a, 608.2d: "each opponent sacrifices a creature of their choice that dealt combat damage to you this turn" (Witch-king of Angmar\'s shape): "you" is the controller of the ability', () => {
  const KING = card('Test Wraith Lord', 'Creature — Wraith', 'Whenever one or more creatures deal combat damage to you, each opponent sacrifices a creature of their choice that dealt combat damage to you this turn.', { pt: ['3', '3'] });
  it('is automated', () => expect(full(KING)).toBe(true));
  const creatures = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name);
  /** p2 attacks p1 with Grizzly Bears (p1 does not block) while p3 and p4 have creatures that did not hit p1. */
  function setup(): GameState {
    return mpScenario({ defs: [KING], cards: ['Grizzly Bears', 'Hill Giant', 'Gray Ogre'], zones: { p1: { battlefield: ['Test Wraith Lord'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] }, p3: { battlefield: ['Gray Ogre'] } } });
  }
  function attackFrom(s0: GameState, who: PlayerId, attacks: { name: string; at: PlayerId }[]): GameState {
    let s = passUntil(s0, (x) => x.turn.activePlayer === who && x.pending?.kind === 'declareAttackers' && x.pending.player === who, `${who}'s attack`);
    s = answer(s, { kind: 'declareAttackers', attacks: attacks.map((a) => ({ attacker: find(s, a.name, 'battlefield', who), defender: a.at })) });
    return passUntil(s, (x) => x.zones.stack.length > 0, 'the trigger');
  }
  it('only creatures that hit the controller can be sacrificed, and each opponent sacrifices from their own', () => {
    let s = attackFrom(setup(), 'p2', [{ name: 'Grizzly Bears', at: 'p1' }, { name: 'Hill Giant', at: 'p3' }]);
    s = resolveStack(s, [{ kind: 'chooseObjects', ids: [find(s, 'Grizzly Bears', 'battlefield', 'p2')] }]);
    expect(creatures(s, 'p2')).toEqual(['Hill Giant']); // the creature that hit p1 was sacrificed, the one that hit p3 was not
    expect(creatures(s, 'p3')).toEqual(['Gray Ogre']);  // p3 has no creature that dealt combat damage to p1: nothing to sacrifice
  });
  it('a second opponent with no creature that hit the controller (and none of their creatures hit) sacrifices nothing; the one that hit another player stays', () => {
    let s = attackFrom(setup(), 'p2', [{ name: 'Grizzly Bears', at: 'p1' }, { name: 'Hill Giant', at: 'p3' }]);
    // p3's Gray Ogre did not hit anybody this turn; the answers are asked in turn order (p2 first)
    s = resolveStack(s, [{ kind: 'chooseObjects', ids: [find(s, 'Grizzly Bears', 'battlefield', 'p2')] }]);
    expect(creatures(s, 'p2')).not.toContain('Grizzly Bears');
    expect(creatures(s, 'p2')).toContain('Hill Giant');
    expect(creatures(s, 'p4')).toEqual([]);
  });
});
