/**
 * Commander lane edh-combat, round edh-combat-1: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules text of 2026-09-25 (rules/cr/ is not
 * in the cloud checkout).
 *
 *   CR 508.1b, 508.1c, 506.2    "~ can't attack a player it has already attacked this turn.": refused in the added combat phase, allowed in the first
 *   CR 604.1, 613.4c, 508.1d    "As long as there are four or more card types among cards in your graveyard, ~ gets +2/+2, has flying, and attacks each combat if able.": with four types in
 *                               the graveyard it is 4/4, flies and is required to attack; with three it is 2/2 and free
 *   CR 701.43a, 508.1, 603.12   "If this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase,
 *                               there is an additional combat phase.": offered in the first combat; once exerted it is not offered in the added combat; the other creature is untapped
 *   CR 508.5, 603.4, 118.12      "Whenever a creature an opponent controls attacks, if you're the defending player, create a 3/3 red Ogre creature token unless that creature's controller pays {3}.":
 *                               attacked, the opponent is asked to pay; unpaid, the Ogre is made for the defending player; an attack on a third player makes none
 *   CR 508.1d, 611.2a, 613.1f    "That token gains haste until end of turn and attacks this combat if able.": the new token must attack this combat and has haste; another creature and
 *                               the token in a later turn are not required
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';
import { answer, find, pass, reject, scenario } from '../../m3/scenario';
import { passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, full } from '../cmd3/helpers';

const attackAnswer = (ids: ObjectId[]): DecisionAnswer => ({ kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) });

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [KAZUUL, RAZER, BEAR, ARROW, WARBOSS, CHANNELER, CELEBRANT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const RAZER = card('Test Razer', 'Creature — Beast', "Whenever this creature deals combat damage to a player, untap each creature you control. After this phase, there is an additional combat phase.\nThis creature can't attack a player it has already attacked this turn.", ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const ARROW = card('Test Arrow', 'Creature — Archer', "Whenever this creature deals combat damage to a player, untap each creature you control. After this phase, there is an additional combat phase.", ['2', '2']);
const WARBOSS = card('Test Warboss', 'Creature — Goblin', 'At the beginning of combat on your turn, create a 1/1 red Goblin creature token. That token gains haste until end of turn and attacks this combat if able.', ['2', '2']);
const CHANNELER = card('Test Channeler', 'Creature — Human', 'As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.', ['2', '2']);
const SPELL_I = card('Test Instant', 'Instant', '');
const SPELL_S = card('Test Sorcery', 'Sorcery', '');
const LAND = card('Test Land', 'Land', '');
const CELEBRANT = card('Test Celebrant', 'Creature — Human Warrior', "Vigilance\nIf this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase.", ['2', '2']);
const KAZUUL = card('Test Ogre Lord', 'Creature — Ogre', "Whenever a creature an opponent controls attacks, if you're the defending player, create a 3/3 red Ogre creature token unless that creature's controller pays {3}.", ['5', '5']);
const DEFS: CardDef[] = [KAZUUL, RAZER, BEAR, ARROW, WARBOSS, CHANNELER, SPELL_I, SPELL_S, LAND, CELEBRANT];

/** Attack p2 with these creatures (p2 has no creature, so no blockers are asked), pass through combat damage until the next declare-attackers decision (the added combat phase). */
function toSecondCombat(s0: GameState, ids: ObjectId[]): GameState {
  let s = answer(toDeclareAttackers(s0), attackAnswer(ids));
  return passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the second declare attackers decision', 80);
}

describe('CR 508.1b, 508.1c, 506.2: "~ can\'t attack a player it has already attacked this turn."', () => {
  it('it attacks the player in the first combat; in the added combat it is refused while a creature without the ban may attack that player again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Razer', 'Test Bear'] }, defs: DEFS });
    const razer = find(s0, 'Test Razer', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const d0 = toDeclareAttackers(s0).pending;
    if (d0?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d0.candidates.map((c) => c.id).sort()).toEqual([razer, bear].sort());
    const s = toSecondCombat(s0, [razer, bear]);
    const d = s.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d.candidates.map((c) => c.id)).toEqual([bear]);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: attackAnswer([razer]) });
    expect(err.rules.join(' ')).toMatch(/508/);
    const t = answer(s, attackAnswer([bear]));
    expect(t.combat!.attackers.map((a) => a.id)).toEqual([bear]);
  });
  it('a creature that did not attack in the first combat may attack in the added one (it has not attacked that player yet)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Razer', 'Test Arrow'] }, defs: DEFS });
    const razer = find(s0, 'Test Razer', 'battlefield');
    const arrow = find(s0, 'Test Arrow', 'battlefield');
    const s = toSecondCombat(s0, [arrow]);
    const d = s.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d.candidates.map((c) => c.id).sort()).toEqual([razer, arrow].sort());
    const t = answer(s, attackAnswer([razer, arrow]));
    expect(t.combat!.attackers.length).toBe(2);
  });
  it('another player is not "a player it has already attacked": in a three-player game it attacks the second player in the added combat, and still not the first', () => {
    const s0 = tweak(scenario([], { p1: { battlefield: ['Test Razer'] }, defs: DEFS }), (g) => { g.players.push({ ...structuredClone(g.players[1]!), id: 'p3', name: 'Carol' }); g.zones.library['p3'] = []; g.zones.hand['p3'] = []; g.zones.graveyard['p3'] = []; });
    const razer = find(s0, 'Test Razer', 'battlefield');
    const s = toSecondCombat(s0, [razer]);
    const d = s.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d.candidates.map((c) => c.id)).toEqual([razer]);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: razer, defender: 'p2' }] } });
    expect(err.rules.join(' ')).toMatch(/508/);
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: razer, defender: 'p3' }] });
    expect(t.combat!.attackers.map((a) => a.id)).toEqual([razer]);
  });
  it('it can attack again on the next turn (the restriction is for this turn only)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Razer'] }, defs: DEFS });
    const razer = find(s0, 'Test Razer', 'battlefield');
    let s = answer(toDeclareAttackers(s0), attackAnswer([razer]));
    // the added combat phase of the trigger: the creature may not attack again this turn; skip it by declaring no attackers
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the second declare attackers decision', 80);
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    // through the opponent's turn to the next declare attackers decision of p1 (p2's turn passes with no attackers)
    s = passUntil(s, (x) => x.turn.number >= 3 && x.pending?.kind === 'declareAttackers' && x.turn.activePlayer === 'p1', 'p1 declare attackers on turn 3', 400);
    expect(s.pending?.kind === 'declareAttackers' && s.pending.candidates.some((c) => c.id === razer)).toBe(true);
  });
});

describe('CR 508.1d, 611.2a, 613.1f: "That token gains haste until end of turn and attacks this combat if able."', () => {
  const atDeclare = (s0: GameState): GameState => toDeclareAttackers(s0);
  it('the token made at the beginning of combat has haste and must attack; the other creature is not required; declaring no attackers is refused', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Warboss', 'Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = atDeclare(s0);
    const d = s.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    const token = d.candidates.find((c) => s.objects[c.id]!.kind === 'token');
    expect(token, 'the token can attack the turn it is made (haste)').toBeDefined();
    expect(token!.mustAttack).toBe(true);
    expect(d.candidates.find((c) => c.id === bear)!.mustAttack).not.toBe(true);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [] } });
    expect(err.rules.join(' ')).toMatch(/508/);
    const t = answer(s, attackAnswer([token!.id]));
    expect(t.combat!.attackers.map((a) => a.id)).toEqual([token!.id]);
  });
  it('the requirement is for this combat only: next turn the old token may stay home (only the newest token must attack)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Warboss'] }, defs: DEFS });
    let s = answer(atDeclare(s0), { kind: 'declareAttackers', attacks: [{ attacker: (atDeclare(s0).pending as { candidates: { id: ObjectId; mustAttack?: boolean }[] }).candidates.find((c) => c.mustAttack === true)!.id, defender: 'p2' }] });
    const first = s.combat!.attackers[0]!.id;
    s = passUntil(s, (x) => x.turn.number >= 3 && x.pending?.kind === 'declareAttackers' && x.turn.activePlayer === 'p1', 'p1 declare attackers on turn 3', 400);
    const d = s.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d.candidates.find((c) => c.id === first)!.mustAttack).not.toBe(true);
    expect(d.candidates.filter((c) => c.mustAttack === true).length).toBe(1);
  });
});

describe('CR 604.1, 613.4c, 508.1d: "As long as there are four or more card types among cards in your graveyard, ~ gets +2/+2, has flying, and attacks each combat if able."', () => {
  const view = (yard: string[]) => {
    const s0 = scenario([], { p1: { battlefield: ['Test Channeler'], graveyard: yard }, defs: DEFS });
    const s = toDeclareAttackers(s0);
    const id = find(s0, 'Test Channeler', 'battlefield');
    const c = getChars(s, id)!;
    const d = s.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    return { p: c.power, t: c.toughness, flying: c.keywords.some((k) => k.keyword === 'flying'), must: d.candidates.find((x) => x.id === id)!.mustAttack === true };
  };
  it('four card types (creature, instant, sorcery, land) in the graveyard: 4/4, flying and it must attack', () => {
    expect(view(['Test Bear', 'Test Instant', 'Test Sorcery', 'Test Land'])).toEqual({ p: '4', t: '4', flying: true, must: true });
  });
  it('three card types (two cards of one type do not count twice) in the graveyard: 2/2, no flying, free to stay home', () => {
    expect(view(['Test Bear', 'Test Instant', 'Test Sorcery', 'Test Sorcery'])).toEqual({ p: '2', t: '2', flying: false, must: false });
  });
});

describe('CR 701.43a, 508.1, 603.12: "If this creature hasn\'t been exerted this turn, you may exert it as it attacks. When you do, ..."', () => {
  it('it is offered in the first combat; exerted, the other creature untaps and an added combat follows in which it is not offered again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Celebrant', 'Test Bear'] }, defs: DEFS });
    const celebrant = find(s0, 'Test Celebrant', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = answer(toDeclareAttackers(s0), attackAnswer([celebrant, bear]));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: ObjectId[] }).options).toEqual([celebrant]);
    s = answer(s, { kind: 'chooseObjects', ids: [celebrant] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the added combat declare attackers decision', 80);
    expect(s.objects[bear]!.tapped, 'the other attacker was untapped by the trigger').toBe(false);
    const t = answer(s, attackAnswer([celebrant, bear]));
    expect(t.pending?.kind, 'no second exert offer: it was exerted this turn').not.toBe('chooseObjects');
    expect(t.combat!.attackers.length).toBe(2);
  });
  it('declining the exert gives no added combat', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Celebrant'] }, defs: DEFS });
    const celebrant = find(s0, 'Test Celebrant', 'battlefield');
    let s = answer(toDeclareAttackers(s0), attackAnswer([celebrant]));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'declareAttackers', 'the end of combat', 80);
    expect(s.pending?.kind === 'declareAttackers').toBe(false);
  });
});

describe('CR 508.5, 603.4, 118.12: "Whenever a creature an opponent controls attacks, if you\'re the defending player, create a 3/3 ... unless that creature\'s controller pays {3}."', () => {
  const ogres = (g: GameState, p: string): number => g.zones.battlefield.filter((id) => g.objects[id]!.kind === 'token' && g.objects[id]!.controller === p).length;
  /** p2's turn: its Bear attacks `defender`; returns the state once the attack is declared and the trigger (if any) is on the stack. */
  const p2Attacks = (g0: GameState, defender: string): GameState => {
    let g = passUntil(g0, (x) => x.pending?.kind === 'declareAttackers', 'p1 declare attackers', 400);
    g = answer(g, { kind: 'declareAttackers', attacks: [] }); // p1 stays home
    g = passUntil(g, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'p2 declare attackers', 400);
    const bear = find(g, 'Test Bear', 'battlefield', 'p2');
    g = answer(g, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender }] });
    return g;
  };
  it('the opponent attacks the Ogre Lord\'s controller and does not pay: that controller gets the token', () => {
    let g = p2Attacks(scenario([], { p1: { battlefield: ['Test Ogre Lord'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS }), 'p1');
    expect(g.zones.stack.length, 'the trigger is on the stack').toBe(1);
    g = pass(pass(g)); // both pass: it resolves; p2 has no mana to pay {3} with
    expect(ogres(g, 'p1')).toBe(1);
    expect(ogres(g, 'p2')).toBe(0);
  });
  it('the opponent who can pay {3} is asked, and paying prevents the token', () => {
    let g = p2Attacks(scenario([], { p1: { battlefield: ['Test Ogre Lord'] }, p2: { battlefield: ['Test Bear', 'Plains', 'Plains', 'Plains'] }, defs: DEFS }), 'p1');
    g = pass(pass(g));
    expect(g.pending?.player).toBe('p2');
    expect(g.pending?.kind).toBe('yesNo');
    g = answer(g, { kind: 'yesNo', yes: true });
    g = answer(g, { kind: 'payCost', auto: true });
    g = passUntil(g, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the trigger to be done', 20);
    expect(ogres(g, 'p1'), 'paid: no token').toBe(0);
  });
  it('a third player is attacked instead: the Ogre Lord is not the defending player, nothing triggers', () => {
    const base = scenario([], { p1: { battlefield: ['Test Ogre Lord'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const g0 = tweak(base, (x) => { x.players.push({ ...structuredClone(x.players[1]!), id: 'p3', name: 'Carol' }); x.zones.library['p3'] = []; x.zones.hand['p3'] = []; x.zones.graveyard['p3'] = []; });
    const g = p2Attacks(g0, 'p3');
    expect(g.zones.stack.length).toBe(0);
    expect(ogres(g, 'p1')).toBe(0);
  });
});
void pass;
