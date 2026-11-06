/**
 * Commander effort, round edh-c-76 (EDHREC ranks 23,001-23,500, third pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) casts. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 608.2d, 701.9a           "Target player chooses a card in their hand and discards the rest."
 *   CR 611.2a, 601.3, 101.2     "Each opponent can't cast instant or sorcery spells during that player's next turn."
 *   CR 700.6, 115.3, 400.3      "When ~ enters, you may return another target historic permanent you control to its owner's hand."
 *   CR 604.1, 611.3a, 509.1b    "As long as you control enchanted creature, it gets +2/+2. Otherwise, it can't block."
 *   CR 608.2c, 208.1            "Return target creature card from your graveyard to your hand. ~ deals damage to any target equal to the power of the card returned this way."
 *   CR 701.20a, 701.20e         "You may reveal a creature card and/or a land card from among them and put the revealed cards into your hand."
 *   CR 406.1, 400.3             "Exile all creatures and planeswalkers with mana value 3 or less from the battlefield and all creature and planeswalker cards with mana value 3 or less from all graveyards."
 *   CR 603.7, 120.3             "This turn, whenever an attacking creature deals combat damage to you, it deals that much damage to its controller."
 *   CR 603.10a, 400.3           "Whenever ~ or another creature is returned to your hand from the battlefield, create a 1/1 white Soldier creature token."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, full, inYard, named, pt, resolveAll, settle, tokens, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
/** Resolve everything, answering the successive target decisions with the successive lists (other decisions as `settle`). */
function resolveWithTargets(s0: GameState, lists: TargetChoice[][], p: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60; guard++) {
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: lists.shift() ?? [] });
    else if (s.pending && s.pending.kind !== 'priority') s = settle(s, p);
    else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
/** Resolve everything, answering the successive object choices with the successive lists. */
function resolveWithObjects(s0: GameState, lists: ObjectId[][]): GameState {
  let s = s0;
  for (let guard = 0; guard < 60; guard++) {
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: lists.shift() ?? [] });
    else if (s.pending && s.pending.kind !== 'priority') s = settle(s);
    else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const castTargets = (s: GameState, name: string, lists: TargetChoice[][], p: Picks = {}, who = 'p1'): GameState => resolveWithTargets(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), lists, p);
const inHand = (s: GameState, name: string, who: string): boolean => s.zones.hand[who]!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
const onBattlefield = (s: GameState, name: string, who?: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name && (who === undefined || s.objects[id]!.controller === who));
const hand = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const yard = (s: GameState, p: string): number => s.zones.graveyard[p]!.length;
const castError = (s: GameState, name: string, who: string): string | undefined => applyAction(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }).error?.message;
void findAll; void getChars; void inYard; void named;

const PURGE = card('Test Purge', 'Sorcery', 'Target player chooses a card in their hand and discards the rest.');
const CAGE = card('Test Cage', 'Sorcery', 'Each opponent can\'t cast instant or sorcery spells during that player\'s next turn.');
const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.');
const SORC = card('Test Tome', 'Sorcery', 'You gain 2 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BIG = card('Test Giant', 'Creature — Giant', '', ['5', '5']);
const GUARD = card('Test Sentinel', 'Artifact Creature — Construct', 'When this creature enters, you may return another target historic permanent you control to its owner\'s hand.', ['2', '2']);
const RING = card('Test Ring', 'Artifact', '');
const KING = card('Test King', 'Legendary Creature — Human', '', ['2', '2']);
const SAGA = card('Test Chapters', 'Enchantment — Saga', '');
const DOMINATION = card('Test Dominion', 'Enchantment — Aura', 'Enchant creature\nAs long as you control enchanted creature, it gets +2/+2. Otherwise, it can\'t block.');
const BURST = card('Test Burst', 'Sorcery', 'Return target creature card from your graveyard to your hand. Test Burst deals damage to any target equal to the power of the card returned this way.');
const GIFT = card('Test Gift', 'Sorcery', 'Look at the top four cards of your library. You may reveal a creature card and/or a land card from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order.');
const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{2}{U}', type_line: 'Planeswalker — Test', oracle_text: '', colors: [], loyalty: '3' } as OracleCard);
const QUAD = card('Test Quad', 'Creature — Beast', '', ['3', '3'], '{3}{G}');
const VERDICT = card('Test Verdict', 'Sorcery', 'Exile all creatures and planeswalkers with mana value 3 or less from the battlefield and all creature and planeswalker cards with mana value 3 or less from all graveyards.');
const MIRROR = card('Test Mirror', 'Instant', 'This turn, whenever an attacking creature deals combat damage to you, it deals that much damage to its controller.');
const RIDERS = card('Test Riders', 'Creature — Human Soldier', 'Flying\nWhen this creature enters, return two creatures you control to their owner\'s hand.\nWhenever this creature or another creature is returned to your hand from the battlefield, create a 1/1 white Soldier creature token.', ['3', '3']);
const BOUNCE = card('Test Bounce', 'Instant', 'Return target creature to its owner\'s hand.');
const DEFS: CardDef[] = [PURGE, CAGE, BOLT, SORC, BEAR, BIG, GUARD, RING, KING, SAGA, DOMINATION, BURST, GIFT, WALKER, VERDICT, MIRROR, RIDERS, BOUNCE, QUAD];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS.filter((x) => !['Test Bear', 'Test Giant', 'Test Ring', 'Test King', 'Test Chapters', 'Test Walker', 'Test Quad'].includes(x.name))) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 608.2d, 701.9a: "Target player chooses a card in their hand and discards the rest."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Purge'] }, p2: { hand: ['Test Bear', 'Test Giant', 'Test Spark'] }, defs: DEFS });
  it('the target keeps the one card they choose and discards the others', () => {
    const s0 = setup();
    const keep = find(s0, 'Test Giant', 'hand', 'p2');
    const picks = { targets: [player('p2')], objects: [keep] };
    const s = resolveAll(cast(s0, 'Test Purge', picks), picks);
    expect(s.zones.hand['p2']).toEqual([keep]);
    expect(yard(s, 'p2')).toBe(2);
  });
  it('negative: an empty hand discards nothing and the spell still resolves', () => {
    const s0 = scenario([], { p1: { hand: ['Test Purge'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Purge', { targets: [player('p2')] }));
    expect(hand(s, 'p2')).toBe(0);
    expect(yard(s, 'p2')).toBe(0);
  });
  it('each player (a wider wording) keeps their own choice from their own hand', () => {
    const e = card('Test Purge All', 'Sorcery', 'Each opponent chooses a card in their hand and discards the rest.');
    const s0 = scenario([], { p1: { hand: ['Test Purge All'] }, p2: { hand: ['Test Bear', 'Test Giant', 'Test Spark'] }, defs: [...DEFS, e] });
    const s = resolveAll(cast(s0, 'Test Purge All'));
    expect(hand(s, 'p2')).toBe(1);
    expect(yard(s, 'p2')).toBe(2);
  });
  it('negative: the caster\'s own hand is not touched when an opponent is the target', () => {
    const s0 = scenario([], { p1: { hand: ['Test Purge', 'Test Bear'] }, p2: { hand: ['Test Giant', 'Test Spark'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Purge', { targets: [player('p2')] }));
    expect(hand(s, 'p1')).toBe(1);
  });
});

describe('CR 611.2a, 601.3, 101.2: "Each opponent can\'t cast instant or sorcery spells during that player\'s next turn."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Cage'] }, p2: { hand: ['Test Spark', 'Test Tome', 'Test Bear'] }, defs: DEFS });
  it('negative: the rest of the turn it was cast in, the opponent can still cast instants', () => {
    const s = pass(cast(setup(), 'Test Cage')); // Alice passes with the spell on the stack: Bob has priority in Alice's turn
    expect(s.pending?.player).toBe('p2');
    expect(castError(s, 'Test Spark', 'p2')).toBeUndefined();
  });
  it('during the opponent\'s next turn: no instant, no sorcery, but a creature spell is fine', () => {
    const s = advanceTo(resolveAll(cast(setup(), 'Test Cage')), 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(castError(s, 'Test Tome', 'p2')).toBeDefined();
    expect(castError(s, 'Test Spark', 'p2')).toBeDefined();
    expect(castError(s, 'Test Bear', 'p2')).toBeUndefined();
  });
  it('negative: the turn after that, the opponent casts them again', () => {
    const s = advanceTo(resolveAll(cast(setup(), 'Test Cage')), 4, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(castError(s, 'Test Tome', 'p2')).toBeUndefined();
  });
  it('negative: the caster is not bound', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cage', 'Test Tome'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Cage'));
    expect(castError(s, 'Test Tome', 'p1')).toBeUndefined();
  });
});

describe("CR 700.6, 115.3, 400.3: \"When ~ enters, you may return another target historic permanent you control to its owner's hand.\"", () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Sentinel'], battlefield: ['Test Ring', 'Test King', 'Test Chapters', 'Test Bear'] }, p2: { battlefield: ['Test Ring'] }, defs: DEFS });
  it("an artifact, a legendary permanent and a Saga you control are legal targets; a plain creature, the Sentinel itself and an opponent's artifact are not", () => {
    const s0 = setup();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sentinel', 'hand', 'p1') });
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseTargets'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const legal = (s.pending as { objects: ObjectId[] }).objects;
    const names = legal.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(names).toEqual(expect.arrayContaining(['Test Ring', 'Test King', 'Test Chapters']));
    expect(names).not.toContain('Test Bear');
    expect(names).not.toContain('Test Sentinel');
    expect(legal.filter((id) => s.objects[id]!.controller === 'p2')).toEqual([]);
  });
  it("accepted: the legendary creature returns to its owner's hand", () => {
    const s0 = setup();
    const king = find(s0, 'Test King', 'battlefield', 'p1');
    const s = castTargets(s0, 'Test Sentinel', [[obj(king)]], { yes: true });
    expect(inHand(s, 'Test King', 'p1')).toBe(true);
  });
  it('negative: declined, nothing returns', () => {
    const s0 = setup();
    const king = find(s0, 'Test King', 'battlefield', 'p1');
    const s = castTargets(s0, 'Test Sentinel', [[obj(king)]], { yes: false });
    expect(onBattlefield(s, 'Test King', 'p1')).toBe(true);
  });
});

describe("CR 604.1, 611.3a, 509.1b: \"As long as you control enchanted creature, it gets +2/+2. Otherwise, it can't block.\"", () => {
  const attach = (owner: string): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const id = find(s0, 'Test Bear', 'battlefield', owner);
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Dominion')]!.attachedTo = id; });
    return { s, id };
  };
  it('on your own creature: +2/+2', () => {
    const { s, id } = attach('p1');
    expect(pt(s, id)).toBe('4/4');
  });
  it("negative: on an opponent's creature: no bonus", () => {
    const { s, id } = attach('p2');
    expect(pt(s, id)).toBe('2/2');
  });
  it("an enchanted creature controlled by the opponent cannot block; negative: unenchanted, it can", () => {
    const blockError = (enchantBlocker: boolean): string | undefined => {
      const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
      const blocker = find(s0, 'Test Bear', 'battlefield', 'p2');
      const attacker = find(s0, 'Test Bear', 'battlefield', 'p1');
      const s1 = enchantBlocker ? tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Dominion')]!.attachedTo = blocker; }) : s0;
      let s = declareAttackers(toDeclareAttackers(s1), [[attacker]]);
      for (let i = 0; i < 30 && s.pending?.kind === 'priority' && s.turn.number === s0.turn.number; i++) s = pass(s);
      if (s.pending?.kind !== 'declareBlockers') return 'no blockers decision';
      return applyAction(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker }] } }).error?.message;
    };
    expect(blockError(true)).toBeDefined();
    expect(blockError(false)).toBeUndefined();
  });
});

describe('CR 608.2c, 208.1: "Return target creature card from your graveyard to your hand. ~ deals damage to any target equal to the power of the card returned this way."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Burst'], graveyard: ['Test Giant', 'Test Bear'] }, defs: DEFS });
  it('returns the chosen creature and deals damage equal to its power to the target player', () => {
    const s0 = setup();
    const s = castTargets(s0, 'Test Burst', [[obj(find(s0, 'Test Giant', 'graveyard', 'p1'))], [player('p2')]]);
    expect(inHand(s, 'Test Giant', 'p1')).toBe(true);
    expect(life(s, 'p2')).toBe(15);
  });
  it('a 2-power creature deals 2', () => {
    const s0 = setup();
    const s = castTargets(s0, 'Test Burst', [[obj(find(s0, 'Test Bear', 'graveyard', 'p1'))], [player('p2')]]);
    expect(inHand(s, 'Test Bear', 'p1')).toBe(true);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('Morgue Burst ruling 2013-04-15: an illegal creature target means no card returned and no damage', () => {
  it('the creature card exiled in response: nothing returns and the other target is not damaged', () => {
    const s0 = scenario([], { p1: { hand: ['Test Burst'], graveyard: ['Test Giant'] }, defs: DEFS });
    const giant = find(s0, 'Test Giant', 'graveyard', 'p1');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burst', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(giant)] });
    s = answer(s, { kind: 'chooseTargets', targets: [player('p2')] });
    s = tweak(s, (t) => { t.zones.graveyard['p1'] = t.zones.graveyard['p1']!.filter((id) => id !== giant); t.zones.exile.push(giant); t.objects[giant]!.zone = 'exile'; });
    s = resolveAll(s);
    expect(inHand(s, 'Test Giant', 'p1')).toBe(false);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 701.20a, 701.20e: "You may reveal a creature card and/or a land card from among them and put the revealed cards into your hand."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Gift'], library: ['Test Bear', 'Test Giant', 'Plains', 'Test Spark', 'Test Tome'] }, defs: DEFS });
  it('one creature and one land among the top four: both go to your hand, the other two go to the bottom', () => {
    const s0 = setup();
    // the top four cards of the library are the first four listed (Bear, Giant, Plains, Spark) or the last four; the scenario puts the listed cards first
    const top = s0.zones.library['p1']!.slice(0, 4).map((id) => s0.defs[s0.objects[id]!.defId]!.name);
    expect(top).toEqual(['Test Bear', 'Test Giant', 'Plains', 'Test Spark']);
    const s = resolveWithObjects(cast(s0, 'Test Gift'), [[find(s0, 'Test Giant', 'library', 'p1')], [s0.zones.library['p1']![2]!]]);
    expect(inHand(s, 'Test Giant', 'p1')).toBe(true);
    expect(inHand(s, 'Plains', 'p1')).toBe(true);
    expect(hand(s, 'p1')).toBe(2);
    const lib = s.zones.library['p1']!;
    const bottom = lib.slice(-2).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
    expect(bottom).toEqual(['Test Bear', 'Test Spark']);
  });
  it('negative: two creatures are not both taken (one card of each description at most)', () => {
    const s0 = setup();
    let s = cast(s0, 'Test Gift');
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseObjects'; i++) s = pass(s);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s0, 'Test Bear', 'library', 'p1')] }); // the creature choice
    expect(s.pending?.kind).toBe('chooseObjects');
    const second = s.pending as { options: ObjectId[]; id: string; player: string };
    expect(second.options).not.toContain(find(s0, 'Test Giant', 'library', 'p1')); // the land choice offers no creature
    expect(second.options).toContain(s0.zones.library['p1']![2]!);
    const err = applyAction(s, { type: 'answer', player: second.player, decisionId: second.id, answer: { kind: 'chooseObjects', ids: [find(s0, 'Test Giant', 'library', 'p1')] } }).error;
    expect(err).toBeDefined();
  });
  it('negative: a card below the top four is not looked at (Test Tome stays out of reach)', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Gift'), { objects: [] });
    expect(hand(s, 'p1')).toBe(0);
    expect(inHand(s, 'Test Tome', 'p1')).toBe(false);
  });
});

describe('CR 406.1, 400.3: "Exile all creatures and planeswalkers with mana value 3 or less from the battlefield and all creature and planeswalker cards with mana value 3 or less from all graveyards."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Verdict'], battlefield: ['Test Bear', 'Test Ring'], graveyard: ['Test Bear', 'Test Spark'] }, p2: { battlefield: ['Test Bear', 'Test Quad', { name: 'Test Walker', counters: { loyalty: 3 } }], graveyard: ['Test Bear', 'Test Quad', 'Test Tome'] }, defs: DEFS });
  it('exiles the small creatures and planeswalkers of both players and the small creature cards of both graveyards', () => {
    const s = resolveAll(cast(setup(), 'Test Verdict'));
    expect(onBattlefield(s, 'Test Bear')).toBe(false);
    expect(onBattlefield(s, 'Test Walker')).toBe(false);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
    expect(s.zones.graveyard['p2']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
    expect(s.zones.exile.length).toBe(5);
  });
  it('negative: a creature with mana value 4, a noncreature permanent, and noncreature cards stay', () => {
    const s = resolveAll(cast(setup(), 'Test Verdict'));
    expect(onBattlefield(s, 'Test Quad', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Test Ring', 'p1')).toBe(true);
    expect(s.zones.graveyard['p2']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Quad')).toBe(true);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Spark')).toBe(true);
    expect(s.zones.graveyard['p2']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Tome')).toBe(true);
  });
});

describe('CR 603.7, 120.3: "This turn, whenever an attacking creature deals combat damage to you, it deals that much damage to its controller."', () => {
  // Bob attacks Alice with his Bear; Alice casts the mirror once attackers are declared; the Bear's combat damage to Alice is dealt back to Bob
  const bobAttacks = (castMirror: boolean, turnsLater = 0): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    let s = advanceTo(s0, 2, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    if (castMirror) s = resolveAll(act(pass(s), { type: 'cast', player: 'p1', card: find(s, 'Test Mirror', 'hand', 'p1') })); // Bob (active) passes first
    for (let i = 0; i < 40 && s.turn.number === 2 && s.turn.step !== 'endCombat'; i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    void turnsLater;
    return s;
  };
  it('Alice takes 2 and Bob takes 2 from his own creature', () => {
    const s = bobAttacks(true);
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(18);
  });
  it('negative: without the spell, only Alice loses life', () => {
    const s = bobAttacks(false);
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(20);
  });
  it('negative: it lasts this turn only (the next turn\'s attack reflects nothing)', () => {
    let s = bobAttacks(true);
    s = advanceTo(s, 4, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    for (let i = 0; i < 40 && s.turn.number === 4 && s.turn.step !== 'endCombat'; i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    expect(life(s, 'p1')).toBe(16);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 603.10a, 400.3: "Whenever ~ or another creature is returned to your hand from the battlefield, create a 1/1 white Soldier creature token."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Riders', 'Test Bounce'], battlefield: ['Test Bear', 'Test Giant'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
  it('its own enter trigger returns two creatures you control, and each return makes a Soldier token (two tokens)', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Riders'), { objects: [find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Giant', 'battlefield', 'p1')] });
    expect(tokens(s).length).toBe(2);
  });
  it("a creature you own bounced by an opponent's spell also triggers; negative: an opponent's creature bounced does not", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Riders', 'Test Bear'] }, p2: { hand: ['Test Bounce'], battlefield: ['Test Bear'] }, defs: DEFS });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = castTargets(advanceTo(s0, 2, 'main1'), 'Test Bounce', [[obj(mine)]], {}, 'p2');
    expect(tokens(s1).length).toBe(1);
    const theirs = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Bear' && s0.objects[id]!.controller === 'p2')!;
    const s2 = castTargets(advanceTo(s0, 2, 'main1'), 'Test Bounce', [[obj(theirs)]], {}, 'p2');
    expect(tokens(s2).length).toBe(0);
  });
  it('ruling 2021-03-19: a token you own that is returned to your hand also triggers it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Riders', 'Test Bear'] }, p2: { hand: ['Test Bounce'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const withToken = tweak(s0, (t) => { t.objects[bear]!.kind = 'token'; });
    const s = castTargets(advanceTo(withToken, 2, 'main1'), 'Test Bounce', [[obj(bear)]], {}, 'p2');
    expect(tokens(s).filter((id) => s.objects[id]!.defId !== 'Test Bear').length).toBe(1);
  });
  it('the Riders returned to hand triggers itself (look back, CR 603.10a)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Riders'] }, p2: { hand: ['Test Bounce'] }, defs: DEFS });
    const riders = find(s0, 'Test Riders', 'battlefield', 'p1');
    const s = castTargets(advanceTo(s0, 2, 'main1'), 'Test Bounce', [[obj(riders)]], {}, 'p2');
    expect(tokens(s).length).toBe(1);
    expect(inHand(s, 'Test Riders', 'p1')).toBe(true);
  });
});
