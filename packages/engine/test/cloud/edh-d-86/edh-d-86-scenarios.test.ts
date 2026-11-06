/**
 * edh-d-86 (EDHREC band 5,001-10,000, group combat): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. Scryfall rulings were
 * fetched in the cloud session; the CR cites were checked against the 2026-09-25 Comprehensive Rules text unless the record lists them as unverified.
 *
 *   CR 120.1, 120.8, 510.2, 201.2, 608.2c   "each opponent dealt combat damage this game by a creature named X" (Gollum, Obsessed Stalker)
 *   CR 305.1, 305.2, 601.3, 400.7           "Once during each of your turns, you may play a land or cast a permanent spell from among cards in your graveyard that were put there from
 *                                           your library this turn" (Kagha, Shadow Archdruid)
 *   CR 603.2, 305.1, 601.2a, 205.2a, 701.15  "When ~ enters and whenever you play a card with two or more card types, ..." (Rendmaw, Creaking Nest)
 *   CR 603.10a, 608.2h, 614.15, 113.2c      "If the creature had power 4 or greater, create two of those tokens instead." after a token with a quoted ability (Anax)
 *   CR 702.173a, 613.1f, 608.2c, 603.12     "Assassin spells you cast have freerunning {B}{B}." / "you may pay {W}{U}{B}{R}{G} if that player has 10 or less life. When you do, that player loses
 *                                           the game." (Ezio Auditore da Firenze)
 *   CR 603.12, 118.12a, 608.2h, 115.1      "When you do, ~ deals damage equal to ... to up to one target creature unless that creature's controller has ~ deal that much damage
 *                                           to them." (Craig Boone, Novac Guard)
 *   CR 608.2c, 603.7c, 510.2                "If you do, choose a creature. Whenever that creature deals combat damage to a player this turn, ..." (Azra Oddsmaker)
 *   CR 702.143c-d, 118.9                    "It becomes foretold. Its foretell cost is its mana cost reduced by {2}." (Ethereal Valkyrie)
 *   CR 608.2c, 502.3, 611.2a                "Whenever a Dragon you control attacks, tap target ... That permanent doesn't untap ...": the target, not the attacker (Ojutai, Soul of Winter)
 *   CR 614.1a, 614.6, 119.3-119.5, 701.27a  "If your life total would be reduced to 0 or less, instead transform ~ and your life total becomes 3. ..." (Enduring Angel)
 *   CR 701.21a, 701.20a, 701.24a, 608.2c    "Put that card onto the battlefield, then shuffle the rest ... If that creature is a Demon, it deals ..." (Aspiring Champion)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type GameState, type OracleCard, type ObjectId, type PlayerId } from '../../../src/index';
import { act as act5, find as find5, scenario as scenario5 } from '../../m5/helpers';
import { drive as driveM5, resolveAll as resolveAll5 } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';
import { drive as drive3 } from '../r3-cost/support';
import { activations, answer, card, cast, full, lifeOf, named, resolveAll } from '../r4-cost/support';
import { act, find, pass } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

/** From the main phase: attack with the given creatures (each at its defender), no blocks, and pass to the second main phase with the stack empty. */
function attack(s0: GameState, attacks: [ObjectId, PlayerId][]): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attacks);
  s = resolveAll(s);
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'main2', 'blockers or the second main phase', 40);
  while (s.pending?.kind === 'declareBlockers') { s = declareBlockers(s, []); s = resolveAll(s); s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'main2', 'the second main phase', 40); }
  return s;
}
/** Pass (declaring no attackers and no blockers) until `done`. */
function skipUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 800): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else throw new Error(`Waiting for ${what} but a ${s.pending?.kind} decision is pending`);
  }
  throw new Error(`Never reached ${what}`);
}
/** Pass until the active player's end step trigger has resolved (the stack empty in the end step). */
const throughEndStep = (s: GameState): GameState => resolveAll(skipUntil(s, (x) => x.turn.step === 'end' && x.zones.stack.length > 0, 'the end step trigger', 60));

// ---- Gollum, Obsessed Stalker -------------------------------------------------------------------------------------------------------------------------------------------

const STALKER = card('Test Stalker', 'Legendary Creature — Horror', 'At the beginning of your end step, each opponent dealt combat damage this game by a creature named Test Stalker loses life equal to the amount of life you gained this turn.', '{1}', ['2', '2']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{1}', ['3', '3']);
const BALM = card('Test Balm', 'Instant', 'You gain 3 life.');
describe('CR 120.1, 510.2, 201.2: "each opponent dealt combat damage this game by a creature named X loses life equal to the life you gained this turn"', () => {
  const board = (): GameState => mpScenario({ defs: [STALKER, BRUTE, BALM], zones: { p1: { battlefield: ['Test Stalker', 'Test Brute'], hand: ['Test Balm', 'Test Balm'] } } });
  it('is full', () => expect(full(STALKER)).toBe(true));
  it('the opponent the named creature hit loses the life gained; the one only another creature hit, and the one not hit, lose nothing', () => {
    let s = board();
    s = attack(s, [[named(s, 'Test Stalker')[0]!, 'p2'], [named(s, 'Test Brute')[0]!, 'p3']]);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([18, 17]);
    s = resolveAll(cast(s, 'Test Balm'));
    s = throughEndStep(s);
    expect(lifeOf(s, 'p1')).toBe(23);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([15, 17, 20]);
  });
  it('negative: no life gained this turn: nobody loses life', () => {
    let s = board();
    s = attack(s, [[named(s, 'Test Stalker')[0]!, 'p2']]);
    s = throughEndStep(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('"this game": an opponent hit on an earlier turn still loses life on a later turn without a new attack', () => {
    let s = board();
    s = attack(s, [[named(s, 'Test Stalker')[0]!, 'p2']]);
    s = throughEndStep(s);
    s = skipUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's next main phase", 600);
    s = resolveAll(cast(s, 'Test Balm'));
    s = throughEndStep(s);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([15, 20, 20]);
  });
  it('blocked, the named creature dealt the player nothing: that player loses nothing (CR 120.8)', () => {
    const WALL = card('Test Wall', 'Creature — Wall', '', '{1}', ['0', '4']);
    let s = mpScenario({ defs: [STALKER, BALM, WALL], zones: { p1: { battlefield: ['Test Stalker'], hand: ['Test Balm'] }, p2: { battlefield: ['Test Wall'] } } });
    s = declareAttackers(toDeclareAttackers(s), [[named(s, 'Test Stalker')[0]!, 'p2']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers', 40);
    s = declareBlockers(s, [[named(s, 'Test Wall')[0]!, named(s, 'Test Stalker')[0]!]]);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase', 40);
    s = resolveAll(cast(s, 'Test Balm'));
    s = throughEndStep(s);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

// ---- Kagha, Shadow Archdruid ------------------------------------------------------------------------------------------------------------------------------------------

const ARCHDRUID = synthetic('Test Archdruid', 'Creature — Elf Druid', '{2}', 'Once during each of your turns, you may play a land or cast a permanent spell from among cards in your graveyard that were put there from your library this turn.', { power: '2', toughness: '2' });
const GRIND = synthetic('Test Grind', 'Sorcery', '{0}', 'Mill three cards.');
const CULL = synthetic('Test Cull', 'Sorcery', '{0}', 'Discard a card.');
const ELF = synthetic('Test Elf', 'Creature — Elf', '{1}', '', { power: '1', toughness: '1' });
const ZAP = synthetic('Test Zap', 'Instant', '{0}', 'You gain 1 life.');
const KDEFS = [ARCHDRUID, GRIND, CULL, ELF, ZAP];
const gyName = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const gyPlays = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => (a.kind === 'cast' || a.kind === 'playLand') && s.objects[a.object!]?.zone === 'graveyard').map((a) => `${a.kind}:${gyName(s, a.object!)}`).sort();
const castM5 = (s: GameState, name: string, zone: 'hand' | 'graveyard' = 'hand'): GameState => driveM5(act5(s, { type: 'cast', player: 'p1', card: find5(s, name, zone, 'p1') }));
describe('CR 305.1, 601.3, 400.7: "Once during each of your turns, you may play a land or cast a permanent spell from among cards in your graveyard that were put there from your library this turn"', () => {
  const start = (hand: string[] = ['Test Grind']): GameState => scenario5(['Forest'], { p1: { library: ['Test Elf', 'Forest', 'Test Zap'], battlefield: ['Test Archdruid', 'Forest', 'Forest'], hand, graveyard: ['Test Elf'] }, defs: KDEFS });
  it('is full', () => expect(full(ARCHDRUID)).toBe(true));
  it('offers the milled land and the milled permanent card, not the milled instant nor the card already there; one use for the two together', () => {
    let s = start();
    expect(gyPlays(s)).toEqual([]);
    s = resolveAll5(castM5(s, 'Test Grind'));
    expect(gyPlays(s)).toEqual(['cast:Test Elf', 'playLand:Forest']); // one Elf (the milled one); the instant is not a permanent spell
    s = act5(s, { type: 'playLand', player: 'p1', card: s.zones.graveyard.p1!.find((id) => gyName(s, id) === 'Forest')! });
    expect(s.zones.battlefield.filter((id) => gyName(s, id) === 'Forest').length).toBe(3);
    expect(gyPlays(s)).toEqual([]); // the once-each-turn use is spent (the land play)
  });
  it('the cast uses it up too: after the milled Elf is cast from the graveyard, the milled land is no longer offered', () => {
    let s = start();
    s = resolveAll5(castM5(s, 'Test Grind'));
    const milledElf = s.zones.graveyard.p1!.filter((id) => gyName(s, id) === 'Test Elf').find((id) => s.history.some((e) => e.ev === 'zoneChange' && e.subject === id && e.facts['from'] === 'library'))!;
    s = resolveAll5(driveM5(act5(s, { type: 'cast', player: 'p1', card: milledElf })));
    expect(s.zones.battlefield.filter((id) => gyName(s, id) === 'Test Elf').length).toBe(1);
    expect(gyPlays(s)).toEqual([]);
  });
  it('negative: a card discarded from the hand this turn is not offered (it came from the hand, not the library)', () => {
    let s = start(['Test Cull', 'Forest']);
    s = resolveAll5(castM5(s, 'Test Cull'));
    expect(s.zones.graveyard.p1!.map((id) => gyName(s, id))).toContain('Forest');
    expect(gyPlays(s)).toEqual([]);
  });
});

// ---- Rendmaw, Creaking Nest ------------------------------------------------------------------------------------------------------------------------------------------------

const NEST = card('Test Nest', 'Artifact Creature — Scarecrow', 'When this creature enters and whenever you play a card with two or more card types, each player creates a tapped 2/2 black Bird creature token with flying. The tokens are goaded for the rest of the game.', '{0}', ['5', '5']);
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{0}', ['1', '1']);
const BEAST = card('Test Beast', 'Creature — Beast', '', '{0}', ['1', '1']);
const VAULT = card('Test Vault', 'Artifact Land', '{T}: Add {C}.');
const birds = (s: GameState): number[] => ['p1', 'p2', 'p3', 'p4'].map((p) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token').length);
describe('CR 603.2, 305.1, 601.2a, 205.2a: "When ~ enters and whenever you play a card with two or more card types, each player creates a tapped 2/2 ... The tokens are goaded for the rest of the game."', () => {
  const board = (): GameState => mpScenario({ defs: [NEST, GOLEM, BEAST, VAULT], zones: { p1: { hand: ['Test Nest', 'Test Golem', 'Test Beast', 'Test Vault'] } } });
  it('is full', () => expect(full(NEST)).toBe(true));
  it('as it enters each of the four players creates a tapped Bird, goaded by its controller', () => {
    const s = resolveAll(cast(board(), 'Test Nest'));
    expect(birds(s)).toEqual([1, 1, 1, 1]);
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('casting an artifact creature spell (two card types) makes four more; a creature spell with one card type makes none (the negative case)', () => {
    let s = resolveAll(cast(board(), 'Test Nest'));
    s = resolveAll(cast(s, 'Test Beast'));
    expect(birds(s)).toEqual([1, 1, 1, 1]);
    s = resolveAll(cast(s, 'Test Golem'));
    expect(birds(s)).toEqual([2, 2, 2, 2]);
  });
  it('playing an artifact land (two card types) is playing a card: four more', () => {
    let s = resolveAll(cast(board(), 'Test Nest'));
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Vault', 'hand', 'p1') }));
    expect(birds(s)).toEqual([2, 2, 2, 2]);
  });
  it('the goaded Birds must attack: an opponent\'s untapped Bird is required to attack on its controller\'s turn (CR 701.15b)', () => {
    let s = resolveAll(cast(board(), 'Test Nest'));
    s = skipUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "p2's declare attackers", 400);
    const bird = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.kind === 'token')!;
    const r = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [] } });
    expect(r.error).toBeDefined(); // the goaded Bird must attack (CR 508.1d)
    const ok = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bird, defender: 'p3' }] } });
    expect(ok.error).toBeUndefined();
  });
});

// ---- Anax, Hardened in the Forge ----------------------------------------------------------------------------------------------------------------------------------------

const FORGE = card('Test Forgelord', 'Legendary Creature — Demigod', 'Whenever this creature or another nontoken creature you control dies, create a 1/1 red Satyr creature token with "This token can\'t block." If the creature had power 4 or greater, create two of those tokens instead.', '{0}', ['1', '1']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['4', '4']);
const IMP = card('Test Imp', 'Creature — Imp', '', '{0}', ['2', '2']);
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.');
const satyrs = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
describe('CR 603.10a, 608.2h, 614.15: "If the creature had power 4 or greater, create two of those tokens instead" (the dying creature, as it last existed)', () => {
  const board = (): GameState => mpScenario({ defs: [FORGE, OGRE, IMP, SLAY], zones: { p1: { battlefield: ['Test Forgelord', 'Test Ogre', 'Test Imp'], hand: ['Test Slay', 'Test Slay', 'Test Slay'] } } });
  it('is full', () => expect(full(FORGE)).toBe(true));
  it('a 4/4 dies: two Satyrs, each with "This token can\'t block."', () => {
    const s = resolveAll(cast(board(), 'Test Slay', { targets: [[{ kind: 'object', id: named(board(), 'Test Ogre')[0]! }]] }));
    expect(satyrs(s).length).toBe(2);
    expect(s.defs[s.objects[satyrs(s)[0]!]!.defId]!.faces[0]!.abilities.some((a) => JSON.stringify(a).includes('"action":"block"'))).toBe(true);
  });
  it('negative: a 2/2 dies: one Satyr; the source itself (1/1) dying: one Satyr', () => {
    let s = resolveAll(cast(board(), 'Test Slay', { targets: [[{ kind: 'object', id: named(board(), 'Test Imp')[0]! }]] }));
    expect(satyrs(s).length).toBe(1);
    s = resolveAll(cast(s, 'Test Slay', { targets: [[{ kind: 'object', id: named(s, 'Test Forgelord')[0]! }]] }));
    expect(satyrs(s).length).toBe(2);
  });
  it('negative: a token creature dying does not trigger it', () => {
    let s = resolveAll(cast(board(), 'Test Slay', { targets: [[{ kind: 'object', id: named(board(), 'Test Imp')[0]! }]] }));
    s = resolveAll(cast(s, 'Test Slay', { targets: [[{ kind: 'object', id: satyrs(s)[0]! }]] }));
    expect(satyrs(s).length).toBe(0);
  });
});

// ---- Ezio Auditore da Firenze ----------------------------------------------------------------------------------------------------------------------------------------------

const MENTOR = card('Test Mentor', 'Legendary Creature — Human Assassin', 'Menace\nRogue spells you cast have freerunning {B}{B}.\nWhenever this creature deals combat damage to a player, you may pay {W}{U}{B}{R}{G} if that player has 10 or less life. When you do, that player loses the game.', '{0}', ['2', '2']);
const PUPIL = card('Test Pupil', 'Creature — Human Rogue', '', '{0}', ['2', '2']);
const SHADE = card('Test Shade', 'Creature — Elf Rogue', '', '{5}{B}', ['3', '3']);
const OAF = card('Test Oaf', 'Creature — Ogre', '', '{5}{B}', ['3', '3']);
const PLAIN = card('Test Plainmaker', 'Legendary Creature — Human Knight', 'Rogue spells you cast have freerunning {B}{B}.', '{0}', ['2', '2']);
describe('CR 702.173a, 613.1f, 601.2b: "Rogue spells you cast have freerunning {B}{B}."', () => {
  const board = (bf: string[]): GameState => mpScenario({ defs: [MENTOR, PUPIL, SHADE, OAF, PLAIN], cards: ['Swamp'], zones: { p1: { battlefield: ['Swamp', 'Swamp', ...bf], hand: ['Test Shade', 'Test Oaf'] } } });
  const castFree = (s: GameState, name: string) => applyAction(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), method: 'freerunning' });
  it('is full', () => expect(full(MENTOR)).toBe(true));
  it('after an Assassin dealt combat damage to a player, a Rogue spell is cast for {B}{B}', () => {
    let s = board(['Test Mentor']);
    s = attack(s, [[named(s, 'Test Mentor')[0]!, 'p2']]);
    const r = castFree(s, 'Test Shade');
    expect(r.error).toBeUndefined();
    s = resolveAll(drive3(r.state));
    expect(named(s, 'Test Shade').length).toBe(1);
  });
  it('negative: a spell that is not a Rogue gets no freerunning; no combat damage by an Assassin or commander this turn: none either', () => {
    let s = board(['Test Mentor']);
    s = attack(s, [[named(s, 'Test Mentor')[0]!, 'p2']]);
    expect(castFree(s, 'Test Oaf').error).toBeDefined();
    let t = board(['Test Plainmaker', 'Test Pupil']);
    t = attack(t, [[named(t, 'Test Pupil')[0]!, 'p2']]); // a Rogue, not an Assassin, dealt the damage
    expect(castFree(t, 'Test Shade').error).toBeDefined();
  });
  it('negative: without the permanent that grants it, the Rogue spell has no freerunning cost', () => {
    let s = board(['Test Pupil']);
    s = mpScenario({ defs: [MENTOR, PUPIL, SHADE, OAF], cards: ['Swamp'], zones: { p1: { battlefield: ['Swamp', 'Swamp', 'Test Pupil'], hand: ['Test Shade'] } } });
    const ASSASSIN = named(s, 'Test Pupil')[0]!;
    s = attack(s, [[ASSASSIN, 'p2']]);
    expect(castFree(s, 'Test Shade').error).toBeDefined();
  });
});
describe('CR 608.2c, 603.12, 104.3a: "you may pay {W}{U}{B}{R}{G} if that player has 10 or less life. When you do, that player loses the game."', () => {
  const LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const board = (life: number): GameState => mpScenario({ defs: [MENTOR], cards: LANDS, zones: { p1: { battlefield: [...LANDS, 'Test Mentor'] } }, setup: (s) => { s.players.find((p) => p.id === 'p2')!.life = life; } });
  const hit = (s0: GameState, pay: boolean): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), [[named(s0, 'Test Mentor')[0]!, 'p2']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers', 40);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    return resolveAll(skipUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'main2', 'the trigger', 40), { yes: [pay] });
  };
  const lost = (s: GameState, p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost === true;
  it('the player is at 10 or less after the damage: you pay and they lose the game; the other players go on', () => {
    const s = hit(board(12), true);
    expect(lost(s, 'p2')).toBe(true);
    expect(lost(s, 'p3')).toBe(false);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped && s.objects[id]!.controller === 'p1').length).toBeGreaterThanOrEqual(5);
  });
  it('negative: you decline to pay: nobody loses', () => expect(lost(hit(board(12), false), 'p2')).toBe(false));
  it('negative: the player has more than 10 life after the damage: no payment is offered, they do not lose', () => {
    const s = hit(board(13), true);
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(11);
    expect(lost(s, 'p2')).toBe(false);
  });
});

// ---- Craig Boone, Novac Guard -------------------------------------------------------------------------------------------------------------------------------------------------

const GUARD = card('Test Guard', 'Legendary Creature — Human Soldier', 'Whenever you attack with two or more creatures, put two quest counters on this creature. When you do, this creature deals damage equal to the number of quest counters on it to up to one target creature unless that creature\'s controller has this creature deal that much damage to them.', '{0}', ['1', '1']);
const MULE = card('Test Mule', 'Creature — Horse', '', '{0}', ['1', '1']);
const BRUISER = card('Test Bruiser', 'Creature — Giant', '', '{0}', ['1', '5']);
describe('CR 603.12, 118.12a, 608.2h: "When you do, ~ deals damage equal to the number of quest counters on it to up to one target creature unless that creature\'s controller has ~ deal that much damage to them."', () => {
  const board = (): GameState => mpScenario({ defs: [GUARD, MULE, BRUISER], zones: { p1: { battlefield: ['Test Guard', 'Test Mule'] }, p2: { battlefield: ['Test Bruiser'] } } });
  const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;
  const quest = (s: GameState): number => s.objects[named(s, 'Test Guard')[0]!]!.counters['quest'] ?? 0;
  const declare = (s0: GameState, both: boolean, script: { targets?: { kind: 'object'; id: ObjectId }[][]; yes?: boolean[] }): GameState => {
    const atk: [ObjectId, PlayerId][] = [[named(s0, 'Test Guard')[0]!, 'p3']];
    if (both) atk.push([named(s0, 'Test Mule')[0]!, 'p3']);
    const s = declareAttackers(toDeclareAttackers(s0), atk);
    return resolveAll(s, script as never);
  };
  it('is full', () => expect(full(GUARD)).toBe(true));
  it('two attackers: two quest counters; the target\'s controller declines, so the creature is dealt 2 damage', () => {
    const s0 = board();
    const s = declare(s0, true, { targets: [[{ kind: 'object', id: named(s0, 'Test Bruiser')[0]! }]], yes: [false] });
    expect(quest(s)).toBe(2);
    expect(dmg(s, named(s, 'Test Bruiser')[0]!)).toBe(2);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('the target\'s controller (not the attacker) chooses to take it: they lose 2 life and the creature is unharmed', () => {
    const s0 = board();
    const s = declare(s0, true, { targets: [[{ kind: 'object', id: named(s0, 'Test Bruiser')[0]! }]], yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(dmg(s, named(s, 'Test Bruiser')[0]!)).toBe(0);
  });
  it('negative: up to one target, none chosen: nothing is dealt (the counters stay); one attacker: no counters at all', () => {
    const s0 = board();
    const s = declare(s0, true, { targets: [[]], yes: [true] });
    expect(quest(s)).toBe(2);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(dmg(s, named(s, 'Test Bruiser')[0]!)).toBe(0);
    expect(quest(declare(board(), false, {}))).toBe(0);
  });
});

// ---- Azra Oddsmaker ----------------------------------------------------------------------------------------------------------------------------------------------------------

const ODDS = card('Test Oddsmaker', 'Legendary Creature — Azra Warrior', 'At the beginning of combat on your turn, you may discard a card. If you do, choose a creature. Whenever that creature deals combat damage to a player this turn, you draw two cards.', '{0}', ['2', '2']);
const RUNNER = card('Test Runner', 'Creature — Human', '', '{0}', ['1', '1']);
const WATCHER = card('Test Watcher', 'Creature — Human', '', '{0}', ['1', '1']);
describe('CR 608.2c, 603.7c, 510.2: "you may discard a card. If you do, choose a creature. Whenever that creature deals combat damage to a player this turn, you draw two cards."', () => {
  const board = (): GameState => mpScenario({ defs: [ODDS, RUNNER, WATCHER], zones: { p1: { battlefield: ['Test Oddsmaker', 'Test Runner'], hand: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Watcher'] } } });
  /** To p1's beginning of combat, answer the trigger (discard or not, the chosen creature), then attack p2 with the Runner and finish combat. */
  const h0 = board().zones.hand.p1!.length;
  const run = (discard: boolean, pick: (s: GameState) => ObjectId): GameState => {
    let s = board();
    s = skipUntil(s, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the beginning of combat trigger', 40);
    s = resolveAll(s, { yes: [discard], objects: [[s.zones.hand.p1![0]!], [pick(s)]] });
    s = declareAttackers(passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers', 20), [[named(s, 'Test Runner')[0]!, 'p2']]);
    s = skipUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0, 'the second main phase', 60);
    return s;
  };
  it('is full', () => expect(full(ODDS)).toBe(true));
  it('discard, choose the attacking Runner: it hits p2, so you draw two cards', () => {
    const s = run(true, (x) => named(x, 'Test Runner')[0]!);
    expect(s.zones.hand.p1!.length).toBe(h0 + 1); // one card discarded, two drawn
  });
  it('negative: you choose an opponent\'s creature (any creature may be chosen); the Runner hits, nothing is drawn', () => {
    const s = run(true, (x) => named(x, 'Test Watcher')[0]!);
    expect(s.zones.hand.p1!.length).toBe(h0 - 1);
  });
  it('negative: you decline to discard: no creature is chosen and nothing is drawn', () => {
    const s = run(false, (x) => named(x, 'Test Runner')[0]!);
    expect(s.zones.hand.p1!.length).toBe(h0);
  });
});

// ---- Ethereal Valkyrie ----------------------------------------------------------------------------------------------------------------------------------------------------

const VALKYRIE = card('Test Valkyrie', 'Creature — Spirit Angel', 'Flying\nWhenever this creature enters or attacks, draw a card, then exile a card from your hand face down. It becomes foretold. Its foretell cost is its mana cost reduced by {2}.', '{0}', ['2', '3']);
const BIGFOOT = card('Test Bigfoot', 'Creature — Beast', '', '{4}{G}', ['5', '5']);
const SEER = card('Test Seer', 'Creature — Human', 'Foretell {G}', '{4}{G}', ['1', '1']);
describe('CR 702.143d, 118.9: "It becomes foretold. Its foretell cost is its mana cost reduced by {2}." (a card without foretell, cast on a later turn)', () => {
  const board = (hand: string[]): GameState => mpScenario({ defs: [VALKYRIE, BIGFOOT, SEER], cards: ['Forest'], zones: { p1: { battlefield: ['Forest', 'Forest', 'Forest'], hand: ['Test Valkyrie', ...hand] } } });
  const exiled = (s: GameState, name: string): ObjectId | undefined => s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === name);
  const enter = (hand: string[], name: string): GameState => {
    const s0 = board(hand);
    return resolveAll(cast(s0, 'Test Valkyrie'), { objects: [[find(s0, name, 'hand', 'p1')]] });
  };
  const nextTurn = (s: GameState): GameState => skipUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's next main phase", 800);
  const ways = (s: GameState, id: ObjectId): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === id).map((a) => String((a.action as { method?: string }).method ?? 'normal')).sort();
  it('is full', () => expect(full(VALKYRIE)).toBe(true));
  it('the card is exiled face down and foretold; on a later turn it is cast for {2}{G} (its mana cost {4}{G} reduced by {2}), not this turn', () => {
    let s = enter(['Test Bigfoot'], 'Test Bigfoot');
    const id = exiled(s, 'Test Bigfoot')!;
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(ways(s, id)).toEqual([]); // CR 702.143d: only after the turn it became foretold
    s = nextTurn(s);
    const id2 = exiled(s, 'Test Bigfoot')!;
    expect(ways(s, id2)).toEqual(['foretell']);
    s = resolveAll(drive3(act(s, { type: 'cast', player: 'p1', card: id2, method: 'foretell' })));
    expect(named(s, 'Test Bigfoot').length).toBe(1); // three Forests paid {2}{G}
  });
  it('a card that prints foretell has both foretell costs: its own {G} and the {2}{G} the effect gave it (ruling 2021-02-05)', () => {
    let s = enter(['Test Seer'], 'Test Seer');
    s = nextTurn(s);
    expect(ways(s, exiled(s, 'Test Seer')!)).toEqual(['foretell', 'foretell:granted']);
  });
});

// ---- Ojutai, Soul of Winter ---------------------------------------------------------------------------------------------------------------------------------------------

const WINTER = card('Test Winter Wyrm', 'Legendary Creature — Dragon', 'Flying, vigilance\nWhenever a Dragon you control attacks, tap target nonland permanent an opponent controls. That permanent doesn\'t untap during its controller\'s next untap step.', '{0}', ['5', '6']);
const WHELP = card('Test Whelp', 'Creature — Dragon', '', '{0}', ['1', '1']);
const MULE2 = card('Test Packmule', 'Creature — Horse', '', '{0}', ['1', '1']);
const STATUE = card('Test Statue', 'Artifact', '');
describe('CR 608.2c, 502.3, 611.2a: "Whenever a Dragon you control attacks, tap target nonland permanent an opponent controls. That permanent doesn\'t untap during its controller\'s next untap step."', () => {
  const board = (): GameState => mpScenario({ defs: [WINTER, WHELP, MULE2, STATUE], zones: { p1: { battlefield: ['Test Winter Wyrm', 'Test Whelp', 'Test Packmule'] }, p2: { battlefield: ['Test Statue'] } } });
  it('is full', () => expect(full(WINTER)).toBe(true));
  it('another Dragon attacks: the target (not the attacking Dragon) is tapped and stays tapped through its controller\'s next untap step only', () => {
    const s0 = board();
    const statue = named(s0, 'Test Statue')[0]!;
    let s = declareAttackers(toDeclareAttackers(s0), [[named(s0, 'Test Whelp')[0]!, 'p3']]);
    s = resolveAll(drive3(s, { targets: [[{ kind: 'object', id: statue }]] }));
    expect(s.objects[statue]!.tapped).toBe(true);
    expect(s.objects[named(s, 'Test Whelp')[0]!]!.tapped).toBe(true); // the Whelp attacked (no vigilance): tapped by the attack, not untapped by the trigger
    s = skipUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's main phase", 400);
    expect(s.objects[statue]!.tapped).toBe(true); // p2's next untap step: it does not untap
    s = skipUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.number > 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's second main phase", 1600);
    expect(s.objects[statue]!.tapped).toBe(false); // the one after: it untaps as usual
  });
  it('negative: a creature that is not a Dragon attacks: nothing is tapped', () => {
    const s0 = board();
    let s = declareAttackers(toDeclareAttackers(s0), [[named(s0, 'Test Packmule')[0]!, 'p3']]);
    s = resolveAll(s);
    expect(s.objects[named(s, 'Test Statue')[0]!]!.tapped).toBe(false);
  });
});

// ---- Enduring Angel // Angelic Enforcer --------------------------------------------------------------------------------------------------------------------------------

const GUARDIAN_TEXT = "If your life total would be reduced to 0 or less, instead transform this creature and your life total becomes 3. Then if this creature didn't transform this way, you lose the game.";
const GUARDIAN = compileCard({ name: 'Test Guardian // Test Avenger', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Angel // Creature — Angel', colors: [], card_faces: [
  { name: 'Test Guardian', mana_cost: '{0}', type_line: 'Creature — Angel', oracle_text: `Flying\n${GUARDIAN_TEXT}`, power: '3', toughness: '3', colors: [] },
  { name: 'Test Avenger', mana_cost: '', type_line: 'Creature — Angel', oracle_text: 'Flying', power: '5', toughness: '5', colors: [] },
] } as unknown as OracleCard);
const MIMIC = card('Test Mimic', 'Creature — Angel', GUARDIAN_TEXT, '{0}', ['3', '3']); // single-faced: it can't transform (ruling 2021-09-24)
const DRAIN = card('Test Drain', 'Instant', 'Target player loses 6 life.');
const SCORCH = card('Test Scorch', 'Instant', 'Test Scorch deals 6 damage to target player.');
const NICK = card('Test Nick', 'Instant', 'Target player loses 2 life.');
const SHRINE = card('Test Shrine', 'Artifact', 'Pay 5 life: Draw a card.');
describe('CR 614.1a, 614.6, 119.3, 119.4, 701.27a: "If your life total would be reduced to 0 or less, instead transform ~ and your life total becomes 3. Then if ~ didn\'t transform this way, you lose the game."', () => {
  const board = (bf: string[] = ['Test Guardian // Test Avenger']): GameState => mpScenario({ defs: [GUARDIAN, MIMIC, DRAIN, SCORCH, NICK, SHRINE], zones: { p1: { battlefield: bf, hand: ['Test Shrine', 'Test Drain', 'Test Scorch', 'Test Nick', 'Test Drain'] } }, setup: (s) => { s.players.find((p) => p.id === 'p1')!.life = 5; } });
  const angel = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name.startsWith('Test Guardian'))!;
  const hit = (s: GameState, spell: string): GameState => resolveAll(cast(s, spell, { targets: [[{ kind: 'player', id: 'p1' } as never]] }));
  const lost = (s: GameState, p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost === true;
  it('is full', () => expect(full(GUARDIAN)).toBe(true));
  it('a loss of 6 at 5 life is replaced: the Angel transforms and the life total becomes 3; nobody loses', () => {
    const s = hit(board(), 'Test Drain');
    expect(lifeOf(s, 'p1')).toBe(3);
    expect(s.objects[angel(s)]!.face ?? 0).toBe(1);
    expect(lost(s, 'p1')).toBe(false);
  });
  it('damage that would reduce it to 0 or less is replaced the same way (the loss of life damage causes, CR 120.3a)', () => {
    const s = hit(board(), 'Test Scorch');
    expect([lifeOf(s, 'p1'), s.objects[angel(s)]!.face ?? 0]).toEqual([3, 1]);
  });
  it('negative: a loss that leaves 3 life is not replaced (no transform)', () => {
    const s = hit(board(), 'Test Nick');
    expect([lifeOf(s, 'p1'), s.objects[angel(s)]!.face ?? 0]).toEqual([3, 0]);
  });
  it('once transformed the back face has no such ability: the next lethal loss loses the game', () => {
    let s = hit(board(), 'Test Drain');
    s = hit(s, 'Test Drain');
    expect(lost(s, 'p1')).toBe(true);
  });
  it('a permanent that can\'t transform (single-faced) still replaces the loss: life becomes 3, then its controller loses the game (ruling 2021-09-24)', () => {
    const s = hit(board(['Test Mimic']), 'Test Drain');
    expect(lost(s, 'p1')).toBe(true);
  });
  it('combat damage from three attackers at once is ONE reduction of the life total (CR 510.2, 120.3a): life becomes 3, the Angel transforms, its controller lives (review)', () => {
    const OGRES = card('Test Raider', 'Creature — Ogre', '', '{0}', ['3', '3']);
    let s = mpScenario({ defs: [GUARDIAN, OGRES], zones: { p1: { battlefield: ['Test Guardian // Test Avenger'] }, p2: { battlefield: ['Test Raider', 'Test Raider', 'Test Raider'] } }, setup: (x) => { x.players.find((p) => p.id === 'p1')!.life = 5; } });
    s = skipUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "p2's declare attackers", 400);
    s = answer(s, { kind: 'declareAttackers', attacks: named(s, 'Test Raider').map((attacker) => ({ attacker, defender: 'p1' })) });
    s = skipUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0, "p2's second main phase", 80);
    expect(lost(s, 'p1')).toBe(false);
    expect([lifeOf(s, 'p1'), s.objects[angel(s)]!.face ?? 0]).toEqual([3, 1]);
  });
  it('negative (review): a batch the replacement would not apply to keeps one loss per source, for its controller and for every other player', () => {
    const OGRES = card('Test Raider', 'Creature — Ogre', '', '{0}', ['3', '3']);
    const s0 = mpScenario({ defs: [GUARDIAN, OGRES], zones: { p1: { battlefield: ['Test Guardian // Test Avenger'] }, p2: { battlefield: ['Test Raider', 'Test Raider', 'Test Raider'] } } });
    const losses = (x: GameState, p: PlayerId): number => x.history.filter((e) => e.ev === 'life' && e.facts['change'] === 'loss' && e.actor === p).length;
    for (const victim of ['p1', 'p3'] as PlayerId[]) {
      let s = skipUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "p2's declare attackers", 400);
      s = answer(s, { kind: 'declareAttackers', attacks: named(s, 'Test Raider').map((attacker) => ({ attacker, defender: victim })) });
      s = skipUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0, "p2's second main phase", 80);
      expect(lifeOf(s, victim), victim).toBe(11);
      expect(losses(s, victim), victim).toBe(3);
      expect(s.objects[angel(s)]!.face ?? 0).toBe(0);
    }
  });
  it('paying life that would leave 0 is a loss of life too (CR 119.4): replaced, the card is still drawn', () => {
    let s = resolveAll(cast(board(), 'Test Shrine'));
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(drive3(act(s, activations(s, 'Test Shrine')[0]!.action)));
    expect([lifeOf(s, 'p1'), s.objects[angel(s)]!.face ?? 0, s.zones.hand.p1!.length]).toEqual([3, 1, hand + 1]);
  });
});

// ---- Aspiring Champion --------------------------------------------------------------------------------------------------------------------------------------------------

const CHAMPION = card('Test Champion', 'Creature — Human Cleric', 'Menace\nWhen this creature deals combat damage to a player, sacrifice it. If you do, reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield, then shuffle the rest into your library. If that creature is a Demon, it deals damage equal to its power to each opponent.', '{0}', ['2', '2']);
const FIEND = card('Test Fiend', 'Creature — Demon', '', '{6}', ['4', '4']);
const HOUND = card('Test Hound', 'Creature — Dog', '', '{6}', ['4', '4']);
describe('CR 701.21a, 608.2c, 701.20a, 701.24a: "sacrifice it. If you do, reveal ... until you reveal a creature card. Put that card onto the battlefield, then shuffle the rest ... If that creature is a Demon, it deals damage equal to its power to each opponent."', () => {
  const board = (top: string): GameState => mpScenario({ defs: [CHAMPION, FIEND, HOUND], zones: { p1: { battlefield: ['Test Champion'], library: ['Plains', top] } } });
  const hit = (s0: GameState): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), [[named(s0, 'Test Champion')[0]!, 'p2']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers', 40);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    return skipUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0, 'the second main phase', 80);
  };
  it('is full', () => expect(full(CHAMPION)).toBe(true));
  it('it hits: it is sacrificed, the Demon revealed enters, and the Demon deals 4 damage to each opponent (2 + 4 to the player it hit)', () => {
    const s = hit(board('Test Fiend'));
    expect(named(s, 'Test Champion').length).toBe(0);
    expect(named(s, 'Test Fiend').length).toBe(1);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4'), lifeOf(s, 'p1')]).toEqual([14, 16, 16, 20]);
    expect(s.zones.library.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')).toBe(true); // the revealed Plains went back
  });
  it('negative: the creature revealed is not a Demon: it enters, nobody else is dealt damage', () => {
    const s = hit(board('Test Hound'));
    expect(named(s, 'Test Hound').length).toBe(1);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 20, 20]);
  });
});
