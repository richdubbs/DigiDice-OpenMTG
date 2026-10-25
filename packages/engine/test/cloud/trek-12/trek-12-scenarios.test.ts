/**
 * trek-12 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Nothing is mocked. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 * The card made full is a legendary creature whose enters trigger shuffles its controller's library, exiles cards from the top until a nonland card is exiled and
 * gives THAT card, which stays in exile, an ability: "Exile a card from your hand: Create a copy of this card. You may cast the copy. Activate only during your turn and
 * only if this card is exiled." What the scenarios pin:
 *
 *   CR 701.20, 406.1, 608.2c   shuffle, then exile from the top until a nonland card: the lands exiled before it stay in exile and gain nothing; only the found card
 *                              gains the ability; a library with no nonland card exiles all of it and nothing gains
 *   CR 611.2a, 611.2c, 400.7   the grant has no duration (it outlasts the card that made it) and affects only that object: a card that leaves exile is a new object
 *                              without it, and the ability is no longer offered
 *   CR 113.6, 602.2, 602.5b    the ability of a card in exile is activated by its owner only, only during that player's turn and only while the card is exiled;
 *                              it needs a card in hand to exile for its cost; not by an opponent, not on an opponent's turn
 *   CR 707.12, 707.10, 608.2g  each activation exiles one card from the hand (the cost), creates one copy of the card in exile and lets the player cast it (or not): the
 *                              copy is a permanent spell that becomes a token, or an instant that resolves and ceases to exist; the original stays in exile and can be
 *                              activated again, the same turn and on later turns
 *   CR 608.2h, 113.7a          the ability on the stack resolves with its source's last known information when the card has left exile in response
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { activationDenial } from '../../../src/actions/activate';
import { announceCond } from '../../../src/actions/announce-cond';
import { findAbility, type ActivatedInfo } from '../../../src/rules/abilities';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability automated and the card full (an experimental template would cap it at partial). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

const Q_TEXT = 'When ~ enters, shuffle your library, then exile cards from the top of your library until you exile a nonland card. That nonland card gains "Exile a card from your hand: Create a copy of this card. You may cast the copy. Activate only during your turn and only if this card is exiled."';
const QUARTERMASTER = card('Test Quartermaster', 'Legendary Creature — Human', Q_TEXT, ['1', '1']);
const GADGET = card('Test Gadget', 'Artifact', '');
const COSTLY = card('Test Costly Beast', 'Creature — Beast', '', ['3', '3'], '{1}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');
const FODDER = card('Test Fodder', 'Artifact', '');
const RETRIEVER = card('Test Retriever', 'Artifact', '{0}: Return target card you own from exile to your hand.');
const OUTLET = card('Test Outlet', 'Artifact', 'Sacrifice a creature: You gain 1 life.');
const DEFS = [QUARTERMASTER, GADGET, COSTLY, BOLT, FODDER, RETRIEVER, OUTLET];

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const hand = (s: GameState, p = 'p1'): ObjectId[] => s.zones.hand[p]!;
const granted = (s: GameState, id: ObjectId) => getChars(s, id)!.abilities.filter((a) => a.origin === 'granted');
const activations = (s: GameState, p = 'p1') => legalActions(s, p).filter((a) => a.kind === 'activate' && a.label.includes('Create a copy of this card'));
const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.kind === 'card' && nameOf(s, id) === name);

/** Answer the decisions that come up: costs and targets as given, the rest from the queue; stop at priority. */
function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (answers.length > 0) s = answer(s, answers.shift()!);
    else break;
  }
  return s;
}

/** The quartermaster is cast and its enters trigger resolves: the card it found is in exile with its ability. */
function enter(opts: { hand?: string[]; battlefield?: string[]; library?: string[]; seed?: string } = {}): { s: GameState; found: ObjectId } {
  let s = scenario([], { p1: { hand: ['Test Quartermaster', ...(opts.hand ?? [])], battlefield: opts.battlefield ?? [], library: opts.library ?? ['Test Gadget'] }, defs: DEFS, ...(opts.seed ? { seed: opts.seed } : {}) });
  s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quartermaster', 'hand', 'p1') });
  s = pass(pass(s)); // the creature spell resolves, its enters trigger goes on the stack
  s = pass(pass(s)); // the trigger resolves
  const found = s.zones.exile.find((id) => granted(s, id).length > 0);
  return { s, found: found ?? '' };
}

/** The cost "Exile a card from your hand": with one card in the hand nothing is asked, with several the first one offered is exiled. */
function payCost(s: GameState): GameState {
  if (s.pending?.kind !== 'chooseObjects') return s;
  return answer(s, { kind: 'chooseObjects', ids: [(s.pending as unknown as { options: ObjectId[] }).options[0]!] });
}

/** Activate the ability of the found card, pay the cost with the first card offered, resolve it, answer the cast of the copy. */
function activateAndResolve(s0: GameState, found: ObjectId, cast: boolean, answers: DecisionAnswer[] = []): GameState {
  const a = activations(s0).find((x) => x.object === found)!;
  const s1 = payCost(act(s0, a.action));
  let s = pass(pass(s1)); // the ability resolves: the copy is created and the player is asked whether to cast it
  expect(s.pending?.kind).toBe('yesNo');
  s = settle(answer(s, { kind: 'yesNo', yes: cast }), answers);
  return s;
}

describe('the card is automated', () => {
  it('the enters trigger with the quoted ability of the card it gives is full, with no manual step', () => {
    expect(full(QUARTERMASTER)).toBe(true);
    expect(JSON.stringify(QUARTERMASTER.faces)).toContain('"copyIn":"exile"');
    expect(JSON.stringify(QUARTERMASTER.faces)).toContain('"zone":["exile"]');
  });
});

describe('CR 701.20, 406.1, 608.2c: "shuffle your library, then exile cards from the top of your library until you exile a nonland card. That nonland card gains ..."', () => {
  it('the lands exiled before the nonland card stay in exile and gain nothing; only the found card gains the ability; the library was shuffled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Quartermaster'], library: ['Test Gadget'] }, defs: DEFS });
    const libBefore = [...s0.zones.library['p1']!];
    const { s, found } = enter();
    expect(nameOf(s, found)).toBe('Test Gadget');
    expect(granted(s, found)).toHaveLength(1);
    const exiled = s.zones.exile.map((id) => nameOf(s, id));
    expect(exiled.filter((n) => n !== 'Plains' && n !== 'Test Gadget')).toEqual([]); // nothing else was exiled
    for (const id of s.zones.exile) if (id !== found) expect(granted(s, id), nameOf(s, id)).toEqual([]);
    expect(s.zones.library['p1']!.length + s.zones.exile.length).toBe(libBefore.length); // every card of the library is in the library or in exile
    expect(s.zones.library['p1']!.some((id) => libBefore.includes(id))).toBe(false); // shuffled: every card a new object (CR 400.7)
  });
  it('a library with no nonland card: all of it is exiled and nothing gains the ability (the stack is empty, nothing to do)', () => {
    let s = scenario([], { p1: { hand: ['Test Quartermaster'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quartermaster', 'hand', 'p1') });
    s = pass(pass(s));
    s = pass(pass(s));
    expect(s.zones.library['p1']).toHaveLength(0);
    expect(s.zones.exile.every((id) => nameOf(s, id) === 'Plains')).toBe(true);
    expect(s.zones.exile.some((id) => granted(s, id).length > 0)).toBe(false);
    expect(activations(s)).toEqual([]);
  });
  it('with several nonland cards in the library, exactly one card gains the ability: the first nonland card exiled (the others stay where they are)', () => {
    const { s, found } = enter({ library: ['Test Gadget', 'Test Costly Beast', 'Test Bolt'] });
    expect(granted(s, found)).toHaveLength(1);
    const gainers = s.zones.exile.filter((id) => granted(s, id).length > 0);
    expect(gainers).toEqual([found]);
    const nonlandInExile = s.zones.exile.filter((id) => nameOf(s, id) !== 'Plains');
    expect(nonlandInExile).toEqual([found]); // it stopped at the first nonland card: the other two nonland cards are still in the library
    expect(s.zones.library['p1']!.filter((id) => nameOf(s, id) !== 'Plains')).toHaveLength(2);
  });
});

describe('CR 113.6, 602.2, 602.5b: who may activate it, when, and from where', () => {
  it('its owner is offered it during their turn while the card is in exile and has a card in hand to exile; the opponent is not offered it and is denied it', () => {
    const { s, found } = enter({ hand: ['Test Fodder'] });
    expect(activations(s).map((a) => a.object)).toEqual([found]);
    const key = granted(s, found)[0]!.key;
    const info = findAbility(s, found, key) as ActivatedInfo;
    expect(activationDenial(s, 'p1', s.objects[found]!, info)).toBeNull();
    const denied = activationDenial(s, 'p2', s.objects[found]!, info);
    expect(denied?.rules).toContain('CR 602.2'); // only its owner, a card in exile having no controller
  });
  it('with no card in the hand the cost can not be paid: not offered', () => {
    const { s } = enter();
    expect(hand(s)).toEqual([]);
    expect(activations(s)).toEqual([]);
  });
  it('only during your turn: not on the opponent\'s turn (the same card, the same hand), again on your next turn', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'] });
    let s = advanceTo(s0, 2, 'upkeep');
    // the opponent has priority first, in their own turn: the owner's card in exile offers them nothing (and the ability is the owner's, not theirs, whose turn it is)
    expect(s.pending?.player).toBe('p2');
    expect(legalActions(s, 'p2').filter((a) => a.kind === 'activate')).toEqual([]);
    s = pass(s); // the opponent (the active player) passes: the owner has priority in the opponent's upkeep
    expect(s.pending?.player).toBe('p1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(activations(s)).toEqual([]);
    const info = findAbility(s, found, granted(s, found)[0]!.key) as ActivatedInfo;
    expect(activationDenial(s, 'p1', s.objects[found]!, info)?.rules).toContain('CR 602.5b');
    s = advanceTo(s, 3, 'main1');
    expect(s.turn.activePlayer).toBe('p1');
    expect(granted(s, found)).toHaveLength(1); // no duration: it is still there two turns later
    expect(activations(s).map((a) => a.object)).toEqual([found]);
  });
  it('only while the card is exiled: once it leaves exile it is a new object without the ability (CR 400.7), and the old ability is gone with it', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'], battlefield: ['Test Retriever'] });
    const retrieve = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === find(s0, 'Test Retriever', 'battlefield', 'p1'))!;
    let s = settle(act(s0, retrieve.action), [{ kind: 'chooseTargets', targets: [obj(found)] }]);
    s = pass(pass(s));
    expect(s.objects[found]?.zone).not.toBe('exile');
    const back = findAll(s, 'Test Gadget', 'hand', 'p1');
    expect(back).toHaveLength(1);
    expect(granted(s, back[0]!)).toEqual([]);
    expect(activations(s)).toEqual([]);
    expect(inExile(s, 'Test Gadget')).toEqual([]);
  });
  it('CR 611.2a: no duration: the ability stays when the card that gave it leaves the battlefield', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'], battlefield: ['Test Outlet'] });
    const q = find(s0, 'Test Quartermaster', 'battlefield', 'p1');
    const sac = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === find(s0, 'Test Outlet', 'battlefield', 'p1'))!;
    let s = settle(act(s0, sac.action), [{ kind: 'chooseObjects', ids: [q] }]);
    s = pass(pass(s));
    expect(s.zones.battlefield.includes(q)).toBe(false);
    expect(activations(s).map((a) => a.object)).toEqual([found]);
  });
});

describe('CR 707.12, 707.10, 608.2g: "Create a copy of this card. You may cast the copy."', () => {
  it('each activation exiles one card from the hand and creates one copy that is cast (a permanent spell: it becomes a token); the original stays in exile; a second activation works at once', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder', 'Test Fodder'] });
    expect(hand(s0)).toHaveLength(2);
    let s = activateAndResolve(s0, found, true);
    expect(s.zones.stack).toHaveLength(1); // the copy spell
    expect(s.objects[s.zones.stack[0]!]!.kind).toBe('spellCopy');
    s = pass(pass(s)); // it resolves
    expect(hand(s)).toHaveLength(1);
    expect(inExile(s, 'Test Fodder')).toHaveLength(1); // the cost
    expect(inExile(s, 'Test Gadget')).toEqual([found]); // the original stays in exile
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Gadget' && s.objects[id]!.kind === 'token')).toHaveLength(1);
    expect(activations(s).map((a) => a.object)).toEqual([found]);
    s = pass(pass(activateAndResolve(s, found, true)));
    expect(hand(s)).toHaveLength(0);
    expect(inExile(s, 'Test Fodder')).toHaveLength(2);
    expect(inExile(s, 'Test Gadget')).toEqual([found]);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Gadget' && s.objects[id]!.kind === 'token')).toHaveLength(2);
    expect(activations(s)).toEqual([]); // no card left to exile
  });
  it('the cast is optional: declining leaves the cost paid, no copy anywhere (a copy that is not cast ceases to exist) and the original in exile', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'] });
    let s = activateAndResolve(s0, found, false);
    expect(s.zones.stack).toHaveLength(0);
    s = pass(pass(s)); // state-based actions have run
    expect(Object.values(s.objects).filter((o) => o.kind === 'spellCopy' && o.zone !== 'stack')).toEqual([]);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Gadget')).toBe(false);
    expect(hand(s)).toHaveLength(0);
    expect(inExile(s, 'Test Fodder')).toHaveLength(1);
    expect(inExile(s, 'Test Gadget')).toEqual([found]);
  });
  it('the copy is cast for its mana cost: a creature copy with cost {1} needs the mana (a Plains) and enters as a token copy; the original creature stays in exile', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'], battlefield: ['Plains'], library: ['Test Costly Beast'] });
    expect(nameOf(s0, found)).toBe('Test Costly Beast');
    let s = activateAndResolve(s0, found, true);
    expect(s.zones.stack).toHaveLength(1);
    expect(s.objects[s.zones.stack[0]!]!.kind).toBe('spellCopy');
    expect(s.objects[find(s, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(true); // {1} paid by tapping the Plains
    s = pass(pass(s));
    const token = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Costly Beast' && s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    expect(`${getChars(s, token)!.power}/${getChars(s, token)!.toughness}`).toBe('3/3');
    expect(getChars(s, token)!.subtypes).toContain('Beast');
    expect(granted(s, token)).toEqual([]); // the copy has the card's copiable values only: the ability this card was given is no part of them (CR 707.2)
    expect(inExile(s, 'Test Costly Beast')).toEqual([found]);
  });
  it('with no mana for the cost {1} the copy can not be cast: nothing is cast, the cost stays paid, the copy ceases to exist', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'], library: ['Test Costly Beast'] });
    const a = activations(s0).find((x) => x.object === found)!;
    let s = payCost(act(s0, a.action));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('priority'); // not even asked: the copy can't be cast with no mana
    expect(s.zones.stack).toHaveLength(0);
    expect(inExile(s, 'Test Fodder')).toHaveLength(1);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Costly Beast')).toBe(false);
  });
  it('an instant card: the copy is cast with its targets and resolves, then ceases to exist; the original card stays in exile and can be copied again', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder', 'Test Fodder'], library: ['Test Bolt'] });
    expect(nameOf(s0, found)).toBe('Test Bolt');
    let s = activateAndResolve(s0, found, true, [{ kind: 'chooseTargets', targets: [player('p2')] }]);
    expect(s.zones.stack).toHaveLength(1);
    s = pass(pass(s));
    expect(life(s, 'p2')).toBe(17);
    expect(Object.values(s.objects).filter((o) => o.kind === 'spellCopy' && o.zone !== 'stack')).toEqual([]);
    expect(inExile(s, 'Test Bolt')).toEqual([found]);
    s = pass(pass(activateAndResolve(s, found, true, [{ kind: 'chooseTargets', targets: [player('p2')] }])));
    expect(life(s, 'p2')).toBe(14);
  });
  it('CR 608.2h, 113.7a: the card leaves exile in response: the ability still resolves, with the card as it last existed (its last known information)', () => {
    const { s: s0, found } = enter({ hand: ['Test Fodder'], battlefield: ['Test Retriever'] });
    const a = activations(s0).find((x) => x.object === found)!;
    let s = payCost(act(s0, a.action));
    // in response: the retriever returns the card to its owner's hand
    const retrieve = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Retriever', 'battlefield', 'p1'))!;
    s = settle(act(s, retrieve.action), [{ kind: 'chooseTargets', targets: [obj(found)] }]);
    s = pass(pass(s)); // the retriever's ability resolves: the card is in the hand
    expect(findAll(s, 'Test Gadget', 'hand', 'p1')).toHaveLength(1);
    s = pass(pass(s)); // the ability of the card resolves
    expect(s.pending?.kind).toBe('yesNo');
    s = settle(answer(s, { kind: 'yesNo', yes: true }));
    s = pass(pass(s));
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Gadget' && s.objects[id]!.kind === 'token')).toHaveLength(1);
  });
});

describe('CR 113.6, 602.5b, 400.7: "only if ~ is exiled" is read at announcement against the zone the source is in now', () => {
  const inZone = (zone: string) => ({ cond: 'matches', object: { ref: 'self' }, filter: { zone } }) as never;
  it('true for a card in exile, false for the same condition about another zone, false for a card that is not in exile', () => {
    const { s, found } = enter({ hand: ['Test Fodder'] });
    const env = (id: ObjectId) => ({ s, player: 'p1', sourceId: id, costsPaid: {} });
    expect(announceCond(env(found), inZone('exile'))).toBe(true);
    expect(announceCond(env(found), inZone('graveyard'))).toBe(false);
    expect(announceCond(env(found), inZone('battlefield'))).toBe(false);
    expect(announceCond(env(find(s, 'Test Quartermaster', 'battlefield', 'p1')), inZone('exile'))).toBe(false); // a permanent is not exiled
    expect(announceCond(env(hand(s)[0]!), inZone('exile'))).toBe(false); // nor a card in the hand
    // and a condition with no zone (every earlier use) still reads the object wherever it is: "Activate only if ~ is untapped"
    expect(announceCond(env(find(s, 'Test Quartermaster', 'battlefield', 'p1')), { cond: 'matches', object: { ref: 'self' }, filter: { tapped: false } } as never)).toBe(true);
  });
});
