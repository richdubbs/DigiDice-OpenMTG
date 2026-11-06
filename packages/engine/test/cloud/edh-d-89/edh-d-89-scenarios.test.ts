/**
 * Commander coordinator D, round edh-d-89 (EDHREC band 5,001-10,000, group combat): the round's cards played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1; Bob (p2), Carol (p3) and Dan (p4) are the others. Each test is named after the rule it checks, with its negative case.
 * CR cites checked against the Comprehensive Rules of 2026-09-25 (fetched from media.wizards.com); the Scryfall rulings of each card are cited by date.
 *
 *   CR 601.3, 508.1a-b, 509.1a, 723.1   Master Warcraft: "Cast this spell only before attackers are declared. You choose which creatures attack this turn. You choose which creatures block this turn and
 *                                        how those creatures block."
 *   CR 702.122c, 702.122e, 603.4         Mighty Servant of Leuk-o: "Whenever this Vehicle becomes crewed for the first time each turn, if it was crewed by exactly two creatures, it gains ..."
 *   CR 701.42a, 712.4a, 508.4, 608.2c    Mishra, Claimed by Gix: "... If ~ and a creature named <partner> are attacking, and you both own and control them, exile them, then meld them into <result>.
 *                                        It enters tapped and attacking."
 *   CR 506.3, 508.1b, 603.4, 700.2       Jin Sakai, Ghost of Tsushima: "Whenever a creature you control attacks a player, if no other creatures are attacking that player, choose one — ..."
 *   CR 111.2, 303.4f, 508.1b, 608.2c     Scriv, the Obligator: "Whenever Scriv enters or attacks, create a white Aura enchantment token named Contract attached to target creature an opponent controls. The
 *                                        token has enchant creature and \"Whenever enchanted creature attacks, it gets +2/+0 until end of turn if it's attacking one of your opponents. Otherwise, its
 *                                        controller loses 2 life.\""
 *   CR 122.1, 608.2c, 608.2d             Aven Courier: "Whenever this creature attacks, choose a counter on a permanent you control. Put a counter of that kind on target permanent you control if it
 *                                        doesn't have a counter of that kind on it."
 *   CR 712.14a, 701.28a, 701.39a, 603.7c Optimus Prime, Hero // Optimus Prime, Autobot Leader: "When ~ dies, return it to the battlefield converted under its owner's control."; "Whenever you
 *                                        attack, bolster 2. The chosen creature gains trample until end of turn. When that creature deals combat damage to a player this turn, convert ~."
 *   CR 701.26a, 508.1a, 303.4, 603.2c    Curse of Bounty: "Whenever enchanted player is attacked, untap all nonland permanents you control. Each opponent attacking that player untaps all nonland
 *                                        permanents they control."
 *   CR 701.17a, 701.17c, 608.2c-d       Eivor, Wolf-Kissed: "Whenever Eivor deals combat damage to a player, you mill that many cards. You may put a Saga card and/or a land card from among them onto
 *                                        the battlefield."
 *   CR 115.3, 109.2, 701.3a, 608.2h      Amy Rose: "Whenever ~ attacks, attach up to one target Equipment to her. Then up to one other target attacking creature gets +X/+0 until end of turn, where X is
 *                                        ~'s power."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, mayActAs, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { legal } from '../../m3/scenario';
import { card, full } from '../r3-cost/support';
import { act, answer, find, lifeOf, mpScenario, passUntil, resolveStack } from '../../m12/rules/helpers';

const onField = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
/** Pass priority (whoever holds it) until a decision of this kind is pending. */
function toDecision(s0: GameState, kind: string): GameState {
  let s = s0;
  for (let i = 0; i < 200; i++) {
    if (s.pending?.kind === kind) return s;
    if (s.pending?.kind !== 'priority') throw new Error(`waiting for ${kind}, a ${s.pending?.kind} decision is pending`);
    s = act(s, { type: 'pass', player: s.pending.player });
  }
  throw new Error(`never reached ${kind}`);
}
/** Answer the pending decision from this player's seat, as the server does (core/player-control.ts#mayActAs), and fail if the answer is refused. */
function seat(s: GameState, from: PlayerId, a: Parameters<typeof answer>[1]): GameState {
  const action = { type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a };
  expect(mayActAs(s, from, action), `${from} answers ${s.pending!.kind} of ${s.pending!.player}`).toBe(true);
  const r = applyAction(s, action);
  if (r.error) throw new Error(r.error.message);
  return r.state;
}

// ---- Master Warcraft ---------------------------------------------------------------------------------------------------------------------------------------------
const WARCRAFT = card('Test Warcraft', 'Instant', 'Cast this spell only before attackers are declared.\nYou choose which creatures attack this turn.\nYou choose which creatures block this turn and how those creatures block.');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BRUTE = card('Test Brute', 'Creature — Ogre', 'This creature attacks each combat if able.', '{0}', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', '{0}', ['0', '4']);

describe('CR 601.3, 508.1a-b, 509.1a, 723.1: "You choose which creatures attack this turn. You choose which creatures block this turn and how those creatures block." (Master Warcraft)', () => {
  const defs = [WARCRAFT, BEAR, BRUTE, WALL];
  /** Four players, p1's turn: p1 has two Bears (and the extra cards), p3 and p4 a Wall each; Bob (p2) holds the instant. */
  const start = (p1: string[] = []) => mpScenario({ defs, zones: { p1: { battlefield: ['Test Bear', 'Test Bear', ...p1] }, p2: { hand: ['Test Warcraft'] }, p3: { battlefield: ['Test Wall'] }, p4: { battlefield: ['Test Wall'] } } });
  /** Bob casts it with priority in p1's first main phase, and everyone lets it resolve. */
  const bobCasts = (s0: GameState): GameState => {
    let s = act(s0, { type: 'pass', player: 'p1' });
    expect(s.pending!.player).toBe('p2');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Warcraft', 'hand', 'p2') });
    return resolveStack(s);
  };
  it('is full', () => expect(full(WARCRAFT)).toBe(true));
  it('CR 508.1a, 723.1: Bob chooses which of Alice\'s creatures attack: the decision is Alice\'s, answered from Bob\'s seat only', () => {
    const s = toDecision(bobCasts(start()), 'declareAttackers');
    expect(s.pending!.player).toBe('p1');
    expect(s.pending!.decidedBy).toBe('p2');
    const any = { type: 'answer' as const, player: 'p1' as const, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: [] } };
    expect(mayActAs(s, 'p2', any)).toBe(true);
    expect(mayActAs(s, 'p1', any)).toBe(false);
  });
  it('ruling 2008-04-01 (CR 508.1b): Bob chooses the group of attackers; then Alice chooses which player each of them attacks, and only the group Bob chose can attack', () => {
    let s = toDecision(bobCasts(start()), 'declareAttackers');
    const [b1, b2] = onField(s, 'Test Bear', 'p1');
    s = seat(s, 'p2', { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p3' }] });
    // Alice is asked what that Bear attacks (several opponents can be attacked); the group is fixed
    expect(s.pending!.kind).toBe('declareAttackers');
    expect(s.pending!.player).toBe('p1');
    expect(s.pending!.decidedBy).toBeUndefined();
    const d = s.pending as Extract<GameState['pending'], { kind: 'declareAttackers' }>;
    expect(d.allAttack).toBe(true);
    expect(d.candidates.map((c) => c.id)).toEqual([b1]);
    // the other Bear can't be added, and the chosen one can't be left out
    expect(applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p4' }, { attacker: b2!, defender: 'p4' }] } }).error).toBeDefined();
    expect(applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [] } }).error).toBeDefined();
    s = seat(s, 'p1', { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p4' }] });
    expect(s.combat!.attackers.map((a) => [a.id, a.defendingPlayer])).toEqual([[b1, 'p4']]);
    expect(s.objects[b2!]!.tapped).toBe(false);
  });
  it('CR 509.1a, 723.1: Bob also chooses the blocks of the player Alice attacks (Dan\'s Wall blocks because Bob says so)', () => {
    let s = toDecision(bobCasts(start()), 'declareAttackers');
    const [b1] = onField(s, 'Test Bear', 'p1');
    s = seat(s, 'p2', { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p4' }] });
    s = seat(s, 'p1', { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p4' }] });
    s = toDecision(s, 'declareBlockers');
    expect(s.pending!.player).toBe('p4');
    expect(s.pending!.decidedBy).toBe('p2');
    const wall = onField(s, 'Test Wall', 'p4')[0]!;
    expect(mayActAs(s, 'p4', { type: 'answer', player: 'p4', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [] } })).toBe(false);
    s = seat(s, 'p2', { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: b1! }] });
    expect(s.combat!.attackers[0]!.blockedBy).toEqual([wall]);
  });
  it('ruling 2005-10-01 (CR 508.1d): the choices must be legal: a creature that attacks each combat if able must be in Bob\'s group', () => {
    let s = toDecision(bobCasts(start(['Test Brute'])), 'declareAttackers');
    const brute = onField(s, 'Test Brute', 'p1')[0]!;
    expect(applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [] } }).error).toBeDefined();
    s = seat(s, 'p2', { kind: 'declareAttackers', attacks: [{ attacker: brute, defender: 'p2' }] });
    s = seat(s, 'p1', { kind: 'declareAttackers', attacks: [{ attacker: brute, defender: 'p3' }] });
    expect(s.combat!.attackers.map((a) => a.id)).toEqual([brute]);
  });
  it('the negative case: with only one player Alice can attack, Bob\'s declaration is the whole declaration (Alice is not asked again)', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { battlefield: ['Test Bear'] }, p2: { hand: ['Test Warcraft'] } }, setup: (x) => { x.players.find((p) => p.id === 'p3')!.hasLost = true; } });
    let s = toDecision(bobCasts(s0), 'declareAttackers');
    const bear = onField(s, 'Test Bear', 'p1')[0]!;
    s = seat(s, 'p2', { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    expect(s.pending?.kind).not.toBe('declareAttackers');
    expect(s.combat!.attackers.map((a) => [a.id, a.defendingPlayer])).toEqual([[bear, 'p2']]);
  });
  it('the negative case: without the spell Alice declares her own attackers and each defending player their own blockers', () => {
    let s = toDecision(start(), 'declareAttackers');
    expect(s.pending!.decidedBy).toBeUndefined();
    const [b1] = onField(s, 'Test Bear', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p3' }] });
    s = toDecision(s, 'declareBlockers');
    expect(s.pending!.decidedBy).toBeUndefined();
  });
  it('"this turn": the choice ends with the turn; in Bob\'s own next turn and Carol\'s nobody else chooses', () => {
    let s = toDecision(bobCasts(start()), 'declareAttackers');
    s = seat(s, 'p2', { kind: 'declareAttackers', attacks: [] });
    expect(s.turn.attacksBy).toBe('p2');
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1', "Bob's turn");
    expect(s.turn.attacksBy).toBeUndefined();
    expect(s.turn.blocksBy).toBeUndefined();
  });
  it('the caster is the active player: Alice casts it in her own turn and still declares her own attackers (no one else answers), and chooses the blocks of the player she attacks', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Bear'], hand: ['Test Warcraft'] }, p3: { battlefield: ['Test Wall'] } } });
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Warcraft', 'hand', 'p1') }));
    s = toDecision(s, 'declareAttackers');
    expect(s.pending!.decidedBy).toBeUndefined();
    const bear = onField(s, 'Test Bear', 'p1')[0]!;
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p3' }] });
    s = toDecision(s, 'declareBlockers');
    expect(s.pending!.player).toBe('p3');
    expect(s.pending!.decidedBy).toBe('p1');
  });
  it('CR 601.3, ruling 2013-09-20: it can be cast in the beginning of combat step, but not once attackers were declared (the declare blockers step, the second main phase)', () => {
    const s0 = start();
    const atBegin = passUntil(act(s0, { type: 'pass', player: 'p1' }), (x) => x.turn.step === 'beginCombat' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "Bob's priority in the beginning of combat");
    expect(applyAction(atBegin, { type: 'cast', player: 'p2', card: find(atBegin, 'Test Warcraft', 'hand', 'p2') }).error).toBeUndefined();
    let s = toDecision(s0, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onField(s, 'Test Bear', 'p1')[0]!, defender: 'p3' }] });
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "Bob's priority in the declare blockers step");
    expect(applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Warcraft', 'hand', 'p2') }).error).toBeDefined();
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "Bob's priority in the second main phase");
    expect(applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Warcraft', 'hand', 'p2') }).error).toBeDefined();
  });
});

// ---- Mighty Servant of Leuk-o -------------------------------------------------------------------------------------------------------------------------------------
const SERVANT = card('Test Servant', 'Artifact — Vehicle', 'Trample\nWard—Discard a card.\nWhenever this Vehicle becomes crewed for the first time each turn, if it was crewed by exactly two creatures, it gains "Whenever this creature deals combat damage to a player, draw two cards" until end of turn.\nCrew 4', '{3}', ['6', '6']);
const PUP = card('Test Pup', 'Creature — Dog', '', '{0}', ['1', '1']);

describe('CR 702.122c, 702.122e, 603.4: "Whenever this Vehicle becomes crewed for the first time each turn, if it was crewed by exactly two creatures, it gains \"Whenever this creature deals combat damage to a player, draw two cards\" until end of turn." (Mighty Servant of Leuk-o, ruling 2022-06-10)', () => {
  const defs = [SERVANT, BEAR, PUP];
  const game = () => mpScenario({ defs, zones: { p1: { battlefield: ['Test Servant', 'Test Bear', 'Test Bear', 'Test Pup', 'Test Pup', 'Test Pup', 'Test Pup'] } } });
  /** Activate the Servant's crew ability, tapping exactly these creatures (it stays on the stack). */
  const crewWith = (s0: GameState, ids: ObjectId[]): GameState => {
    const src = onField(s0, 'Test Servant', 'p1')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => /crew/i.test(x.label) && (x.action as { source?: string }).source === src);
    expect(a, 'a legal crew action').toBeDefined();
    let s = act(s0, a!.action as never);
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`a ${s.pending.kind} decision while crewing`);
    }
    for (const id of ids) expect(s.objects[id]!.tapped, 'the chosen crewers are tapped').toBe(true);
    return s;
  };
  const hasDrawGrant = (s: GameState): boolean => getChars(s, onField(s, 'Test Servant', 'p1')[0]!)!.abilities.some((a) => a.def.kind === 'triggered' && /^Whenever this creature deals combat damage to a player, draw two cards/.test(a.def.text));
  it('is full', () => expect(full(SERVANT)).toBe(true));
  it('crewed by exactly two creatures (two Bears) it gains the ability: its combat damage to a player draws two cards', () => {
    const s0 = game();
    const bears = onField(s0, 'Test Bear', 'p1');
    let s = resolveStack(crewWith(s0, bears));
    expect(hasDrawGrant(s)).toBe(true);
    s = toDecision(s, 'declareAttackers');
    const servant = onField(s, 'Test Servant', 'p1')[0]!;
    const before = s.zones.hand['p1']!.length;
    const life0 = lifeOf(s, 'p2');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: servant, defender: 'p2' }] });
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(life0 - lifeOf(s, 'p2')).toBe(6);
    expect(s.zones.hand['p1']!.length - before).toBe(2);
  });
  it('the negative case: crewed by four creatures (four Pups) it gains nothing', () => {
    const s0 = game();
    const s = resolveStack(crewWith(s0, onField(s0, 'Test Pup', 'p1')));
    expect(hasDrawGrant(s)).toBe(false);
  });
  it('CR 702.122e: only the creatures tapped for THE crew ability that triggered it count: four Pups for a first activation, two Bears for a second one on top of it; the Bears\' one resolves first, so it is the first time and it gains the ability', () => {
    const s0 = game();
    let s = crewWith(s0, onField(s0, 'Test Pup', 'p1'));
    s = crewWith(s, onField(s, 'Test Bear', 'p1'));
    expect(s.zones.stack.length).toBe(2);
    s = resolveStack(s);
    expect(hasDrawGrant(s)).toBe(true);
  });
  it('the negative case, ruling 2022-06-10: "for the first time each turn": the first crew ability to resolve had four Pups; a later one with two Bears triggers nothing', () => {
    const s0 = game();
    let s = crewWith(s0, onField(s0, 'Test Bear', 'p1'));
    s = crewWith(s, onField(s, 'Test Pup', 'p1'));
    s = resolveStack(s);
    expect(hasDrawGrant(s)).toBe(false);
  });
});

// ---- Mishra, Claimed by Gix -----------------------------------------------------------------------------------------------------------------------------------------
/** An invented meld pair (CR 712.4): two meld cards and their result, related as Scryfall relates them (`all_parts`, cards/faces.ts). */
const MELD_PARTS = [{ component: 'meld_part', name: 'Test Warlord' }, { component: 'meld_part', name: 'Test Engine' }, { component: 'meld_result', name: 'Test Lost Warlord' }];
const meldCard = (name: string, type: string, text: string, pt: [string, string]): CardDef =>
  compileCard({ name, layout: 'meld', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], power: pt[0], toughness: pt[1], all_parts: MELD_PARTS } as unknown as OracleCard);
const WARLORD = meldCard('Test Warlord', 'Legendary Creature — Phyrexian Human Artificer', 'Whenever you attack, each opponent loses X life and you gain X life, where X is the number of attacking creatures. If Test Warlord and a creature named Test Engine are attacking, and you both own and control them, exile them, then meld them into Test Lost Warlord. It enters tapped and attacking.', ['3', '5']);
const ENGINE = meldCard('Test Engine', 'Artifact Creature — Phyrexian Dragon', 'Double strike', ['2', '2']);
const LOST = meldCard('Test Lost Warlord', 'Legendary Artifact Creature — Phyrexian Dragon', 'Flying, trample, haste', ['9', '7']);

describe('CR 701.42a, 712.4a, 508.4: "If ~ and a creature named <partner> are attacking, and you both own and control them, exile them, then meld them into <result>. It enters tapped and attacking." (Mishra, Claimed by Gix, rulings 2022-10-14)', () => {
  const defs = [WARLORD, ENGINE, LOST, BEAR];
  const game = (p1: (string | { name: string; tapped?: boolean })[] = ['Test Warlord', 'Test Engine'], setup?: (s: GameState) => void) => mpScenario({ defs, zones: { p1: { battlefield: p1 } }, ...(setup ? { setup } : {}) });
  /** Alice attacks Bob with these creatures, then the "whenever you attack" trigger resolves (what the melded permanent attacks: `aim`). */
  const attack = (s0: GameState, names: string[], aim: string = 'p2'): GameState => {
    let s = toDecision(s0, 'declareAttackers');
    const ids = names.map((n) => onField(s, n, 'p1').find((id) => !s.objects[id]!.tapped)!);
    s = answer(s, { kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) });
    for (let i = 0; i < 50 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [aim] });
      else break;
    }
    return s;
  };
  it('is full, and so is its meld result', () => { expect(full(WARLORD)).toBe(true); expect(full(LOST)).toBe(true); });
  it('both attacking: each opponent loses 2 and Alice gains 2 (X once, not per opponent); then the two are exiled and melded, and the result is tapped and attacking the player Alice chooses (Carol), never declared as an attacker', () => {
    const s0 = game();
    const s = attack(s0, ['Test Warlord', 'Test Engine'], 'p3');
    for (const p of ['p2', 'p3', 'p4'] as const) expect(lifeOf(s0, p) - lifeOf(s, p), p).toBe(2);
    expect(lifeOf(s, 'p1') - lifeOf(s0, 'p1')).toBe(2);
    const lost = onField(s, 'Test Lost Warlord', 'p1');
    expect(lost).toHaveLength(1);
    expect(s.objects[lost[0]!]!.components?.map((c) => c.defId).sort()).toEqual(['Test Engine', 'Test Warlord']);
    expect(s.objects[lost[0]!]!.tapped).toBe(true);
    expect(s.combat!.attackers.map((a) => [a.id, a.defendingPlayer])).toEqual([[lost[0], 'p3']]);
    expect(onField(s, 'Test Warlord')).toEqual([]);
    expect(onField(s, 'Test Engine')).toEqual([]);
  });
  it('the negative case: the Engine stays home: only the life drain happens (X = 1 attacking creature), nothing is exiled', () => {
    const s0 = game();
    const s = attack(s0, ['Test Warlord']);
    expect(lifeOf(s0, 'p2') - lifeOf(s, 'p2')).toBe(1);
    expect(onField(s, 'Test Lost Warlord')).toEqual([]);
    expect(onField(s, 'Test Warlord', 'p1')).toHaveLength(1);
    expect(onField(s, 'Test Engine', 'p1')).toHaveLength(1);
  });
  it('the negative case (CR 108.3, ruling 2022-10-14): an Engine Alice controls but Bob owns is attacking too: no meld', () => {
    const s0 = game(['Test Warlord', 'Test Engine'], (x) => { const id = x.zones.battlefield.find((i) => x.objects[i]!.defId === 'Test Engine')!; x.objects[id]!.owner = 'p2'; });
    const s = attack(s0, ['Test Warlord', 'Test Engine']);
    expect(onField(s, 'Test Lost Warlord')).toEqual([]);
    expect(onField(s, 'Test Warlord', 'p1')).toHaveLength(1);
  });
  it('two Engines, one attacking and one at home: the attacking one is the one melded (the condition named it), the other stays', () => {
    const s0 = game(['Test Warlord', 'Test Engine', 'Test Engine']);
    const [home, away] = onField(s0, 'Test Engine', 'p1');
    let s = toDecision(s0, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [onField(s, 'Test Warlord', 'p1')[0]!, away!].map((attacker) => ({ attacker, defender: 'p2' })) });
    for (let i = 0; i < 50 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['p2'] });
      else throw new Error(`a ${s.pending?.kind} decision: ${s.pending?.prompt}`);
    }
    expect(onField(s, 'Test Lost Warlord')).toHaveLength(1);
    expect(s.zones.battlefield).toContain(home);
    expect(s.zones.battlefield).not.toContain(away);
  });
});

// ---- Jin Sakai, Ghost of Tsushima -------------------------------------------------------------------------------------------------------------------------------------
const GHOST = card('Test Ghost', 'Legendary Creature — Human Samurai', 'Whenever Test Ghost deals combat damage to a player, draw a card.\nWhenever a creature you control attacks a player, if no other creatures are attacking that player, choose one —\n• Standoff — It gains double strike until end of turn.\n• Ghost — It can\'t be blocked this turn.', '{0}', ['2', '4']);
const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.', '{0}');

describe('CR 506.3, 508.1b, 603.4, 700.2: "Whenever a creature you control attacks a player, if no other creatures are attacking that player, choose one — • Standoff — It gains double strike until end of turn. • Ghost — It can\'t be blocked this turn." (Jin Sakai, Ghost of Tsushima)', () => {
  const defs = [GHOST, BEAR, WALL, WALKER];
  const game = () => mpScenario({ defs, zones: { p1: { battlefield: ['Test Ghost', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Wall', { name: 'Test Walker', counters: { loyalty: 3 } } as never] } } });
  /** Declare these attacks, then let every trigger resolve choosing the mode whose label has `mode` (counting the mode choices). */
  const attack = (s0: GameState, attacks: { attacker: ObjectId; defender: string }[], mode = 'Standoff'): { s: GameState; chosen: number } => {
    let s = toDecision(s0, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks });
    let chosen = 0;
    for (let i = 0; i < 80 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else if (s.pending?.kind === 'chooseOption') { const o = (s.pending as { options: { id: string; label: string }[] }).options; chosen++; const pick = o.find((x) => x.label.includes(mode === 'Standoff' ? 'double strike' : "can't be blocked")); if (!pick) throw new Error(JSON.stringify(o)); s = answer(s, { kind: 'chooseOption', ids: [pick.id] }); }
      else if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as { items: { id: string }[] }).items.map((x) => x.id) });
      else throw new Error(`a ${s.pending?.kind} decision: ${s.pending?.prompt}`);
    }
    return { s, chosen };
  };
  it('is full', () => expect(full(GHOST)).toBe(true));
  it('a Bear attacks Bob alone: Standoff gives that Bear double strike (not Jin, not the other Bear)', () => {
    const s0 = game();
    const [b1, b2] = onField(s0, 'Test Bear', 'p1');
    const { s, chosen } = attack(s0, [{ attacker: b1!, defender: 'p2' }]);
    expect(chosen).toBe(1);
    expect(hasKeyword(getChars(s, b1!)!, 'double strike')).toBe(true);
    expect(hasKeyword(getChars(s, b2!)!, 'double strike')).toBe(false);
    expect(hasKeyword(getChars(s, onField(s, 'Test Ghost', 'p1')[0]!)!, 'double strike')).toBe(false);
  });
  it('Ghost: the Bear attacking Bob can\'t be blocked this turn: Bob\'s Wall is not offered to block it (with Standoff it is)', () => {
    const toBlocks = (mode: string): GameState => {
      const s0 = game();
      const [b1] = onField(s0, 'Test Bear', 'p1');
      let { s } = attack(s0, [{ attacker: b1!, defender: 'p2' }], mode);
      for (let i = 0; i < 50 && s.pending?.kind !== 'declareBlockers' && s.turn.step !== 'combatDamage'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
      return s;
    };
    const ghost = toBlocks('Ghost');
    expect(ghost.pending?.kind).not.toBe('declareBlockers');
    const standoff = toBlocks('Standoff');
    expect(standoff.pending?.kind).toBe('declareBlockers');
    expect((standoff.pending as { candidates: { id: ObjectId }[] }).candidates.map((c) => c.id)).toEqual(onField(standoff, 'Test Wall', 'p2'));
  });
  it('the negative case (CR 603.4): two creatures attack Bob: neither trigger does anything (each sees the other attacking that player)', () => {
    const s0 = game();
    const [b1, b2] = onField(s0, 'Test Bear', 'p1');
    const { s, chosen } = attack(s0, [{ attacker: b1!, defender: 'p2' }, { attacker: b2!, defender: 'p2' }]);
    expect(chosen).toBe(0);
    expect(hasKeyword(getChars(s, b1!)!, 'double strike')).toBe(false);
  });
  it('one Bear attacks Bob and Jin attacks Carol: each is alone at its player, both get the mode (Jin\'s own attack too: "a creature you control")', () => {
    const s0 = game();
    const [b1] = onField(s0, 'Test Bear', 'p1');
    const jin = onField(s0, 'Test Ghost', 'p1')[0]!;
    const { s, chosen } = attack(s0, [{ attacker: b1!, defender: 'p2' }, { attacker: jin, defender: 'p3' }]);
    expect(chosen).toBe(2);
    expect(hasKeyword(getChars(s, b1!)!, 'double strike')).toBe(true);
    expect(hasKeyword(getChars(s, jin)!, 'double strike')).toBe(true);
  });
  it('the negative case (CR 506.3, 508.1b): a Bear attacks Bob\'s planeswalker and the other Bob himself: the planeswalker attack is not "attacks a player" and does not stop the other one', () => {
    const s0 = game();
    const [b1, b2] = onField(s0, 'Test Bear', 'p1');
    const walker = onField(s0, 'Test Walker', 'p2')[0]!;
    const { s, chosen } = attack(s0, [{ attacker: b1!, defender: walker }, { attacker: b2!, defender: 'p2' }]);
    expect(chosen).toBe(1);
    expect(hasKeyword(getChars(s, b1!)!, 'double strike')).toBe(false);
    expect(hasKeyword(getChars(s, b2!)!, 'double strike')).toBe(true);
  });
});

// ---- Scriv, the Obligator ---------------------------------------------------------------------------------------------------------------------------------------------
const SCRIV = card('Test Scrivener', 'Legendary Creature — Inkling Bird', 'Flying, deathtouch\nWhenever Test Scrivener enters or attacks, create a white Aura enchantment token named Contract attached to target creature an opponent controls. The token has enchant creature and "Whenever enchanted creature attacks, it gets +2/+0 until end of turn if it\'s attacking one of your opponents. Otherwise, its controller loses 2 life."', '{0}', ['2', '3']);

describe('CR 111.2, 303.4f, 508.1b, 608.2c: Scriv, the Obligator\'s Contract: "Whenever enchanted creature attacks, it gets +2/+0 until end of turn if it\'s attacking one of your opponents. Otherwise, its controller loses 2 life."', () => {
  const defs = [SCRIV, BEAR, WALKER];
  /** Alice casts the Scrivener; its enters trigger makes a Contract on Bob's Bear; then the game goes on to Bob's declare attackers step. */
  const contracted = (): { s: GameState; bear: ObjectId } => {
    let s = mpScenario({ defs, zones: { p1: { hand: ['Test Scrivener'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } } as never] } } });
    const bear = onField(s, 'Test Bear', 'p2')[0]!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrivener', 'hand', 'p1') });
    s = resolveStack(s);
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as never);
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else throw new Error(`a ${s.pending?.kind} decision: ${s.pending?.prompt}`);
    }
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "Bob's declare attackers step");
    return { s, bear };
  };
  const contractOf = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id)!.name === 'Contract');
  const resolveAttack = (s0: GameState, attacker: ObjectId, defender: string): GameState => {
    let s = answer(s0, { kind: 'declareAttackers', attacks: [{ attacker, defender }] });
    for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  };
  it('is full', () => expect(full(SCRIV)).toBe(true));
  it('the token: a white Aura enchantment named Contract, Alice\'s, attached to Bob\'s Bear, with enchant creature', () => {
    const { s, bear } = contracted();
    const c = contractOf(s);
    expect(c).toHaveLength(1);
    const o = s.objects[c[0]!]!;
    expect(o.controller).toBe('p1');
    expect(o.attachedTo).toBe(bear);
    const ch = getChars(s, c[0]!)!;
    expect(ch.colors).toEqual(['W']);
    expect(ch.subtypes).toContain('Aura');
  });
  it('Bob\'s Bear attacks Carol (one of Alice\'s opponents): it gets +2/+0; Bob loses nothing', () => {
    const { s: s0, bear } = contracted();
    const s = resolveAttack(s0, bear, 'p3');
    expect(String(getChars(s, bear)!.power)).toBe('4');
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
  });
  it('the other branch: Bob\'s Bear attacks Alice: no bonus, and Bob (its controller, not the Contract\'s) loses 2 life', () => {
    const { s: s0, bear } = contracted();
    const s = resolveAttack(s0, bear, 'p1');
    expect(String(getChars(s, bear)!.power)).toBe('2');
    expect(lifeOf(s0, 'p2') - lifeOf(s, 'p2')).toBe(2);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  for (const [defender, loss] of [['p3', 0], ['p1', 2]] as const) it(`CR 608.2h (review): the Bear attacking ${defender === 'p3' ? 'Carol' : 'Alice'} is destroyed with the trigger on the stack: judged as it last existed, so Bob loses ${loss}`, () => {
    const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.', '{0}');
    let s = mpScenario({ defs: [...defs, SMITE], zones: { p1: { hand: ['Test Scrivener', 'Test Smite'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } } as never] } } });
    const bear = onField(s, 'Test Bear', 'p2')[0]!;
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrivener', 'hand', 'p1') }));
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as never);
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "Bob's declare attackers step");
    const life0 = lifeOf(s, 'p2');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender }] });
    expect(s.zones.stack.length).toBe(1);
    for (let i = 0; i < 10 && s.pending?.kind === 'priority' && s.pending.player !== 'p1'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
    s = resolveStack(s);
    expect(s.zones.battlefield).not.toContain(bear);
    expect(life0 - lifeOf(s, 'p2')).toBe(loss);
  });
  it('the other branch (CR 506.3, 508.1b): attacking Carol\'s planeswalker is not attacking one of Alice\'s opponents: Bob loses 2 life', () => {
    const { s: s0, bear } = contracted();
    const s = resolveAttack(s0, bear, onField(s0, 'Test Walker', 'p3')[0]!);
    expect(String(getChars(s, bear)!.power)).toBe('2');
    expect(lifeOf(s0, 'p2') - lifeOf(s, 'p2')).toBe(2);
  });
});

// ---- Amy Rose ------------------------------------------------------------------------------------------------------------------------------------------------------------
const AMY = card('Test Hedgehog', 'Legendary Creature — Hedgehog Warrior', "Haste\nWhenever Test Hedgehog attacks, attach up to one target Equipment to her. Then up to one other target attacking creature gets +X/+0 until end of turn, where X is Test Hedgehog's power.", '{0}', ['3', '3']);
const HAMMER = card('Test Hammer', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {3}', '{0}');

describe('CR 115.3, 109.2, 701.3a, 608.2h: "Whenever ~ attacks, attach up to one target Equipment to her. Then up to one other target attacking creature gets +X/+0 until end of turn, where X is ~\'s power." (Amy Rose)', () => {
  const defs = [AMY, HAMMER, BEAR];
  const game = () => mpScenario({ defs, zones: { p1: { battlefield: ['Test Hedgehog', 'Test Hammer', 'Test Bear', 'Test Bear'] } } });
  /** Alice attacks Bob with the Hedgehog and these Bears; each target group of the trigger is answered with `pick[i]` (the offered objects of each group are kept in `seen`). */
  const attack = (s0: GameState, bears: ObjectId[], pick: ObjectId[][], seen: ObjectId[][] = []): GameState => {
    let s = toDecision(s0, 'declareAttackers');
    const amy = onField(s, 'Test Hedgehog', 'p1')[0]!;
    s = answer(s, { kind: 'declareAttackers', attacks: [amy, ...bears].map((attacker) => ({ attacker, defender: 'p2' })) });
    let group = 0;
    for (let i = 0; i < 60 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseTargets') {
        seen.push([...(s.pending as unknown as { objects: ObjectId[] }).objects]);
        s = answer(s, { kind: 'chooseTargets', targets: (pick[group++] ?? []).map((id) => ({ kind: 'object' as const, id })) });
      } else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else throw new Error(`a ${s.pending?.kind} decision: ${s.pending?.prompt}`);
    }
    return s;
  };
  it('is full', () => expect(full(AMY)).toBe(true));
  it('the Hammer is attached to her first, then the other attacking Bear gets +X/+0 with X her power after that (3 + 2 = 5)', () => {
    const s0 = game();
    const [b1, b2] = onField(s0, 'Test Bear', 'p1');
    const hammer = onField(s0, 'Test Hammer', 'p1')[0]!;
    const amy = onField(s0, 'Test Hedgehog', 'p1')[0]!;
    const s = attack(s0, [b1!], [[hammer], [b1!]]);
    expect(s.objects[hammer]!.attachedTo).toBe(amy);
    expect(String(getChars(s, amy)!.power)).toBe('5');
    expect(String(getChars(s, b1!)!.power)).toBe('7');
    expect(String(getChars(s, b2!)!.power)).toBe('2');
  });
  it('CR 115.3, 109.2: "other" target attacking creature: she is not offered as that target, nor is a creature that is not attacking', () => {
    const s0 = game();
    const [b1, b2] = onField(s0, 'Test Bear', 'p1');
    const hammer = onField(s0, 'Test Hammer', 'p1')[0]!;
    const amy = onField(s0, 'Test Hedgehog', 'p1')[0]!;
    const seen: ObjectId[][] = [];
    attack(s0, [b1!], [[hammer], [b1!]], seen);
    expect(seen[0]).toEqual([hammer]);
    expect(seen[1]).toContain(b1);
    expect(seen[1]).not.toContain(amy);
    expect(seen[1]).not.toContain(b2);
    expect(() => attack(s0, [b1!], [[hammer], [amy]])).toThrow();
  });
  it('"up to one": with no targets nothing is attached and nobody gets a bonus', () => {
    const s0 = game();
    const [b1] = onField(s0, 'Test Bear', 'p1');
    const s = attack(s0, [b1!], [[], []]);
    expect(s.objects[onField(s0, 'Test Hammer', 'p1')[0]!]!.attachedTo).toBeUndefined();
    expect(String(getChars(s, b1!)!.power)).toBe('2');
  });
});

// ---- Aven Courier --------------------------------------------------------------------------------------------------------------------------------------------------------
const COURIER = card('Test Courier', 'Creature — Bird Advisor', "Flying\nWhenever this creature attacks, choose a counter on a permanent you control. Put a counter of that kind on target permanent you control if it doesn't have a counter of that kind on it.", '{0}', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '', '{0}');

describe('CR 122.1, 608.2c, 608.2d: "Whenever this creature attacks, choose a counter on a permanent you control. Put a counter of that kind on target permanent you control if it doesn\'t have a counter of that kind on it." (Aven Courier, ruling 2022-04-29)', () => {
  const defs = [COURIER, BEAR, RELIC];
  type Spec = string | { name: string; counters?: Record<string, number> };
  const game = (mine: Spec[], bobs: Spec[] = []) => mpScenario({ defs, zones: { p1: { battlefield: ['Test Courier', ...mine] as never }, p2: { battlefield: bobs as never } } });
  /** The Courier attacks Bob; the target (announced as the trigger is put on the stack) is `target`; the kind is chosen as it resolves (`kind`, a label), `offered` collects the kinds offered. */
  const attack = (s0: GameState, target: ObjectId, kind?: string, offered: string[][] = []): GameState => {
    let s = toDecision(s0, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onField(s, 'Test Courier', 'p1')[0]!, defender: 'p2' }] });
    for (let i = 0; i < 60 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
      else if (s.pending?.kind === 'chooseOption') { const o = (s.pending as { options: { id: string; label: string }[] }).options; offered.push(o.map((x) => x.label)); s = answer(s, { kind: 'chooseOption', ids: [o.find((x) => x.label === kind)!.id] }); }
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else throw new Error(`a ${s.pending?.kind} decision: ${s.pending?.prompt}`);
    }
    return s;
  };
  const counters = (s: GameState, id: ObjectId): Record<string, number> => s.objects[id]!.counters;
  it('is full', () => expect(full(COURIER)).toBe(true));
  it('a +1/+1 counter on Alice\'s Bear (the only kind): the Courier, its target, gets one', () => {
    const s0 = game([{ name: 'Test Bear', counters: { '+1/+1': 1 } }]);
    const courier = onField(s0, 'Test Courier', 'p1')[0]!;
    const s = attack(s0, courier);
    expect(counters(s, courier)['+1/+1']).toBe(1);
    expect(counters(s, onField(s, 'Test Bear', 'p1')[0]!)['+1/+1']).toBe(1);
  });
  it('the negative case: the target already has a counter of that kind: nothing is put on it', () => {
    const s0 = game([{ name: 'Test Bear', counters: { '+1/+1': 1 } }]);
    const bear = onField(s0, 'Test Bear', 'p1')[0]!;
    const s = attack(s0, bear);
    expect(counters(s, bear)['+1/+1']).toBe(1);
  });
  it('ruling 2022-04-29: the kind is chosen as it resolves among the kinds on Alice\'s permanents (not Bob\'s): charge on her Relic', () => {
    const s0 = game([{ name: 'Test Bear', counters: { '+1/+1': 2 } }, { name: 'Test Relic', counters: { charge: 3 } }], [{ name: 'Test Bear', counters: { shield: 1 } }]);
    const courier = onField(s0, 'Test Courier', 'p1')[0]!;
    const offered: string[][] = [];
    const s = attack(s0, courier, 'charge', offered);
    expect(offered).toEqual([['+1/+1', 'charge']]);
    expect(counters(s, courier)).toEqual({ charge: 1 });
  });
  it('the negative case: no counter on any permanent Alice controls: nothing is chosen and nothing is put', () => {
    const s0 = game(['Test Bear'], [{ name: 'Test Bear', counters: { '+1/+1': 1 } }]);
    const courier = onField(s0, 'Test Courier', 'p1')[0]!;
    const s = attack(s0, courier);
    expect(counters(s, courier)).toEqual({});
  });
});

// ---- Optimus Prime, Hero // Optimus Prime, Autobot Leader ---------------------------------------------------------------------------------------------------------------
const PRIME = compileCard({
  name: 'Test Prime // Test Leader', layout: 'transform', mana_cost: '{0}', type_line: 'Legendary Artifact Creature — Robot // Legendary Artifact — Vehicle', colors: [],
  card_faces: [
    { name: 'Test Prime', mana_cost: '{0}', type_line: 'Legendary Artifact Creature — Robot', power: '4', toughness: '8', colors: [], oracle_text: "At the beginning of each end step, bolster 1.\nWhen Test Prime dies, return it to the battlefield converted under its owner's control." },
    { name: 'Test Leader', mana_cost: '', type_line: 'Legendary Artifact — Vehicle', power: '6', toughness: '8', colors: [], oracle_text: 'Living metal\nTrample\nWhenever you attack, bolster 2. The chosen creature gains trample until end of turn. When that creature deals combat damage to a player this turn, convert Test Leader.' },
  ],
} as unknown as OracleCard);
const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.', '{0}');

describe('CR 712.14a, 701.28a, 701.39a, 603.7c: Optimus Prime, Hero // Optimus Prime, Autobot Leader (rulings 2022-10-14)', () => {
  const NAME = 'Test Prime // Test Leader';
  const defs = [PRIME, BEAR, WALL, DOOM];
  const prime = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === NAME)!;
  it('both faces are full', () => expect(full(PRIME)).toBe(true));
  it('CR 712.14a: when the front face dies it returns converted: back face up, under its owner\'s control', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [NAME], hand: ['Test Doom'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: prime(s) }] });
    s = resolveStack(s);
    const back = prime(s);
    expect(back).toBeDefined();
    expect(s.objects[back]!.face).toBe(1);
    expect(s.objects[back]!.controller).toBe('p1');
    expect(getChars(s, back)!.name).toBe('Test Leader');
  });
  /** p1 controls the Leader (back face up) and a Bear; Bob a Wall. Alice attacks Bob with these; returns the state after the attack trigger resolved. */
  const attackWith = (who: ('leader' | 'bear')[]): { s: GameState; leader: ObjectId; bear: ObjectId } => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: NAME, face: 1 } as never, 'Test Bear'] }, p2: { battlefield: ['Test Wall'] } } });
    const leader = prime(s);
    const bear = onField(s, 'Test Bear', 'p1')[0]!;
    s = toDecision(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: who.map((w) => ({ attacker: w === 'leader' ? leader : bear, defender: 'p2' })) });
    for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return { s, leader, bear };
  };
  it('CR 701.39a: whenever you attack, bolster 2 chooses the creature with the least toughness (the Bear); the chosen creature gains trample until end of turn', () => {
    const { s, leader, bear } = attackWith(['leader', 'bear']);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
    expect(s.objects[leader]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('CR 603.7c: when the chosen creature deals combat damage to a player this turn, the Leader converts (front face up)', () => {
    let { s, leader } = attackWith(['leader', 'bear']);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(s.objects[leader]!.face ?? 0).toBe(0);
    expect(getChars(s, leader)!.name).toBe('Test Prime');
  });
  it('the negative case: the chosen Bear did not attack, so it deals no combat damage: the Leader stays as it is even though it dealt combat damage itself', () => {
    let { s, leader } = attackWith(['leader']);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(s.objects[leader]!.face).toBe(1);
  });
  it('the negative case: the chosen Bear is blocked by the Wall: no combat damage to a player, no conversion', () => {
    let { s, leader, bear } = attackWith(['bear']);
    s = toDecision(s, 'declareBlockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: onField(s, 'Test Wall', 'p2')[0]!, attacker: bear }] });
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(s.objects[leader]!.face).toBe(1);
  });
});

// ---- Curse of Bounty ---------------------------------------------------------------------------------------------------------------------------------------------------
const BOUNTY = card('Test Bounty', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player is attacked, untap all nonland permanents you control. Each opponent attacking that player untaps all nonland permanents they control.', '{0}');
const GROVE = card('Test Grove', 'Land', '{T}: Add {G}.', '{0}');

describe('CR 701.26a, 508.1a, 303.4, 603.2c: "Whenever enchanted player is attacked, untap all nonland permanents you control. Each opponent attacking that player untaps all nonland permanents they control." (Curse of Bounty, rulings 2017-08-25)', () => {
  const defs = [BOUNTY, GROVE, BEAR, RELIC, WALKER];
  const tapped = (name: string) => ({ name, tapped: true });
  /** Carol (p3) is the active player; Alice's Curse is on Bob (p2). Everyone has a tapped Relic and a tapped Grove; Carol has two Bears, Dan (p4) a Bear. */
  const game = () => mpScenario({
    defs, options: { startingPlayer: 'p3' },
    zones: {
      p1: { battlefield: ['Test Bounty', tapped('Test Relic'), tapped('Test Grove')] as never },
      p2: { battlefield: [tapped('Test Relic'), { name: 'Test Walker', counters: { loyalty: 3 } }] as never },
      p3: { battlefield: ['Test Bear', 'Test Bear', tapped('Test Relic'), tapped('Test Grove')] as never },
      p4: { battlefield: [tapped('Test Relic')] as never },
    },
    setup: (x) => { x.objects[x.zones.battlefield.find((id) => x.objects[id]!.defId === 'Test Bounty')!]!.attachedTo = 'p2'; },
  });
  const isTapped = (s: GameState, name: string, p: PlayerId): boolean => s.objects[onField(s, name, p)[0]!]!.tapped;
  const attack = (s0: GameState, attacks: (s: GameState) => { attacker: ObjectId; defender: string }[], onStack?: (n: number) => void): GameState => {
    let s = toDecision(s0, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: attacks(s) });
    onStack?.(s.zones.stack.length);
    for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  };
  it('is full', () => expect(full(BOUNTY)).toBe(true));
  it('Carol attacks Bob with both Bears: Alice untaps her nonland permanents, Carol untaps hers (the attacking Bears too, still attacking); lands and the others\' permanents stay tapped; it triggers once', () => {
    let triggered = -1;
    const s = attack(game(), (x) => onField(x, 'Test Bear', 'p3').map((attacker) => ({ attacker, defender: 'p2' })), (n) => { triggered = n; });
    expect(triggered).toBe(1); // ruling 2017-08-25: once, however many creatures attack the enchanted player
    expect(isTapped(s, 'Test Relic', 'p1')).toBe(false);
    expect(isTapped(s, 'Test Grove', 'p1')).toBe(true);
    expect(isTapped(s, 'Test Relic', 'p3')).toBe(false);
    expect(isTapped(s, 'Test Grove', 'p3')).toBe(true);
    for (const b of onField(s, 'Test Bear', 'p3')) expect(s.objects[b]!.tapped).toBe(false);
    expect(s.combat!.attackers).toHaveLength(2);
    expect(isTapped(s, 'Test Relic', 'p2')).toBe(true);
    expect(isTapped(s, 'Test Relic', 'p4')).toBe(true);
  });
  it('the negative case: Carol attacks Dan, not Bob: nothing untaps', () => {
    const s = attack(game(), (x) => [{ attacker: onField(x, 'Test Bear', 'p3')[0]!, defender: 'p4' }]);
    expect(isTapped(s, 'Test Relic', 'p1')).toBe(true);
    expect(isTapped(s, 'Test Relic', 'p3')).toBe(true);
  });
  it('the negative case (ruling 2017-08-25): only Bob\'s planeswalker is attacked: it does not trigger', () => {
    const s = attack(game(), (x) => [{ attacker: onField(x, 'Test Bear', 'p3')[0]!, defender: onField(x, 'Test Walker', 'p2')[0]! }]);
    expect(isTapped(s, 'Test Relic', 'p1')).toBe(true);
    expect(isTapped(s, 'Test Relic', 'p3')).toBe(true);
  });
});

// ---- Eivor, Wolf-Kissed -----------------------------------------------------------------------------------------------------------------------------------------------
const EIVOR = card('Test Wolfkin', 'Legendary Creature — Human Assassin Warrior', 'Trample, haste\nWhenever Test Wolfkin deals combat damage to a player, you mill that many cards. You may put a Saga card and/or a land card from among them onto the battlefield.', '{0}', ['7', '6']);
const SAGA = card('Test Chronicle', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — You gain 1 life.\nII — You gain 1 life.\nIII — You gain 1 life.', '{0}');

describe('CR 701.17a, 701.17c, 608.2c-d: "Whenever Eivor deals combat damage to a player, you mill that many cards. You may put a Saga card and/or a land card from among them onto the battlefield." (Eivor, Wolf-Kissed)', () => {
  const defs = [EIVOR, SAGA, GROVE, BEAR, WALL];
  /** Alice's library starts Saga, Grove, Bear, Saga (then Plains); she draws the first Saga in her draw step (CR 103.8c: four players, nobody skips it); Eivor attacks Bob unblocked (7 damage:
   * seven cards milled: Grove, Bear, Saga and four Plains). Each choice is answered from `picks` by card name (none: decline). */
  const play = (picks: (string | null)[], offered: string[][] = []): GameState => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Wolfkin'], library: ['Test Chronicle', 'Test Grove', 'Test Bear', 'Test Chronicle'] } } });
    s = toDecision(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onField(s, 'Test Wolfkin', 'p1')[0]!, defender: 'p2' }] });
    let k = 0;
    for (let i = 0; i < 200 && s.turn.step !== 'main2'; i++) {
      if (s.pending?.kind === 'chooseObjects') {
        const d = s.pending as unknown as { options: ObjectId[] };
        offered.push(d.options.map((id) => s.defs[s.objects[id]!.defId]!.name));
        const want = picks[k++] ?? null;
        s = answer(s, { kind: 'chooseObjects', ids: want === null ? [] : [d.options.find((id) => s.defs[s.objects[id]!.defId]!.name === want)!] });
      } else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as { items: { id: string }[] }).items.map((x) => x.id) });
      else throw new Error(`a ${s.pending?.kind} decision: ${s.pending?.prompt}`);
    }
    return s;
  };
  const yard = (s: GameState) => (s.zones.graveyard['p1'] ?? []).map((id) => s.defs[s.objects[id]!.defId]!.name);
  it('is full', () => expect(full(EIVOR)).toBe(true));
  it('seven damage mills seven cards; a Saga card and a land card among them go onto the battlefield, the rest stay in the graveyard', () => {
    const offered: string[][] = [];
    const s = play(['Test Chronicle', 'Test Grove'], offered);
    expect(offered[0]).toEqual(['Test Chronicle']);
    expect(offered[1]).toContain('Test Grove');
    expect(offered[1]).not.toContain('Test Bear');
    expect(onField(s, 'Test Chronicle', 'p1')).toHaveLength(1);
    expect(onField(s, 'Test Grove', 'p1')).toHaveLength(1);
    expect(yard(s)).toContain('Test Bear');
    expect(yard(s).filter((n) => n === 'Test Chronicle')).toHaveLength(0);
    expect(yard(s)).toHaveLength(5); // the Bear and four Plains
  });
  it('"and/or": a land card only (no Saga chosen) is fine, and so is nothing at all', () => {
    const one = play([null, 'Test Grove']);
    expect(onField(one, 'Test Chronicle', 'p1')).toHaveLength(0);
    expect(onField(one, 'Test Grove', 'p1')).toHaveLength(1);
    const none = play([null, null]);
    expect(onField(none, 'Test Grove', 'p1')).toHaveLength(0);
    expect(yard(none)).toHaveLength(7);
  });
});

// ---- G10 change (Estrid, the Masked's -1): "The token has <abilities>" completes it -------------------------------------------------------------------------------------
const MASKED = card('Test Masked', 'Legendary Planeswalker — Test', '−1: Create a white Aura enchantment token named Mask attached to another target permanent. The token has enchant permanent and umbra armor.', '{0}');

describe('CR 111.2, 303.4f, 702.89a: "Create a white Aura enchantment token named Mask attached to another target permanent. The token has enchant permanent and umbra armor." (Estrid, the Masked\'s −1; G10 change by the owner\'s standing rule 2026-10-27)', () => {
  it('the Mask is created attached to the target, with enchant permanent and umbra armor; the Bear it enchants is saved from destruction and the Mask is destroyed instead', () => {
    let s = mpScenario({ defs: [MASKED, BEAR, DOOM], zones: { p1: { battlefield: [{ name: 'Test Masked', counters: { loyalty: 3 } } as never, 'Test Bear'], hand: ['Test Doom'] } } });
    const bear = onField(s, 'Test Bear', 'p1')[0]!;
    const src = onField(s, 'Test Masked', 'p1')[0]!;
    const a = legal(s, 'p1', 'activate').find((x) => (x.action as { source?: string }).source === src)!;
    s = act(s, a.action as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
    s = resolveStack(s);
    const mask = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(getChars(s, mask)!.name).toBe('Mask');
    expect(s.objects[mask]!.attachedTo).toBe(bear);
    expect(hasKeyword(getChars(s, mask)!, 'umbra armor')).toBe(true);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
    s = resolveStack(s);
    expect(s.zones.battlefield).toContain(bear);
    expect(s.zones.battlefield).not.toContain(mask);
  });
});
