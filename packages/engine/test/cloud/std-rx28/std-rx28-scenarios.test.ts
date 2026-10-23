/**
 * std-rx28 (wave 2, Standard lane rx28: trigger filters and linked choices): the round's readings played through the engine with synthetic cards compiled by the
 * game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 202.3, 601.2i         "you may cast a permanent spell with equal or lesser mana value from your hand ...": at most the triggering spell's mana value;
 *                            "If you don't, you may put a land card ..." only when nothing was cast
 *   CR 120.1, 208.1          "deals noncombat damage to a creature equal to that creature's toughness": exactly its toughness, never less, never combat damage
 *   CR 115.9b, 120.1         "a spell you control that targets only a single creature deals damage to that creature": the damage to that target, not to another creature
 *   CR 115.9b, 608.2c        "a spell that targets one or more creatures, those creatures gain flying": the targeted creatures only
 *   CR 602.2, 115.9b         "whenever you activate an ability that targets a creature or player, copy that ability": a targeting ability only
 *   CR 614.12a, 205.2a       "choose a card type other than creature": creature is never offered
 *   CR 701.4a, 608.2h        "the power of the creature you chose or the card you revealed": the beheld object's power
 *   CR 702.188a, 608.2h      "where X is the mana value of the returned creature": web-slinging's returned creature
 *   CR 201.3, 601.2f, 605.1a "choose a nonland card name", "activated abilities of sources with the chosen name cost {2} more": a land name is refused; a named
 *                            source's mana ability is paid for; "choose a land card name", "lands with the chosen name have ..."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, find, legal, life, pass, reject, scenario } from '../../m3/scenario';
import { card, counters, full, settle } from '../cmd3/helpers';
import { getChars } from '../../../src/rules/characteristics';

const hand = (s: GameState, player = 'p1'): string[] => (s.zones.hand[player] ?? []).map((id) => s.objects[id]!.defId);
const onBattlefield = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);
/** The refusal of a name answer to the pending decision. */
const refuse = (s: GameState, name: string): string => reject(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'chooseName', name } }).message;
const castFrom = (s: GameState, name: string, method?: string, player = 'p1'): GameState =>
  settle(act(s, { type: 'cast', player, card: find(s, name, method === 'flashback' ? 'graveyard' : 'hand', player), ...(method ? { method } : {}) }));

// ---- equal or lesser mana value, "If you don't" -----------------------------------------------------------------------------------------------------------
const KID = card('Test Kid', 'Creature — Faerie', "Whenever you cast a spell from anywhere other than your hand, you may cast a permanent spell with equal or lesser mana value from your hand without paying its mana cost. If you don't, you may put a land card from your hand onto the battlefield.", ['1', '1']);
const ECHO = card('Test Echo', 'Sorcery', 'You gain 1 life.\nFlashback {0}', undefined, '{2}');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{2}');
const OX = card('Test Ox', 'Creature — Ox', '', ['3', '3'], '{3}');

describe('CR 202.3, 601.2i: "you may cast a permanent spell with equal or lesser mana value from your hand" after a spell cast from elsewhere', () => {
  const board = (): GameState => scenario(['Forest'], { defs: [KID, ECHO, CUB, OX], p1: { battlefield: ['Test Kid'], graveyard: ['Test Echo'], hand: ['Test Cub', 'Test Ox', 'Forest'] } });
  it('the choice offers the card of mana value 2 (equal) and not the one of mana value 3; the chosen card is cast for free', () => {
    expect(full(KID), JSON.stringify(KID.automation)).toBe(true);
    let s = castFrom(board(), 'Test Echo', 'flashback');
    s = pass(pass(s)); // the trigger resolves first (it is on top)
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    const opts = (s.pending as { options: ObjectId[] }).options;
    expect(opts).toContain(find(s, 'Test Cub', 'hand'));
    expect(opts).not.toContain(find(s, 'Test Ox', 'hand'));
    s = settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cub', 'hand')] }));
    expect(s.zones.stack.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(true);
    expect(onBattlefield(s, 'Forest')).toBe(false); // it cast a spell: "If you don't" does not happen
  });
  it('declining the cast: the land may be put onto the battlefield instead', () => {
    let s = castFrom(board(), 'Test Echo', 'flashback');
    s = pass(pass(s));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    expect((s.pending as { options: ObjectId[] }).options).toEqual([find(s, 'Forest', 'hand')]);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Forest', 'hand')] }));
    expect(onBattlefield(s, 'Forest')).toBe(true);
  });
  it('a spell cast from the hand does not trigger it', () => {
    const s = castFrom(scenario(['Island'], { defs: [KID, ECHO, CUB], p1: { battlefield: ['Test Kid', 'Island', 'Island'], hand: ['Test Echo', 'Test Cub'] } }), 'Test Echo');
    expect(s.zones.stack.length).toBe(1);
  });
});

// ---- damage equal to the toughness; damage to the target of its source ------------------------------------------------------------------------------------
const MARKSMAN = card('Test Marksman', 'Creature — Human Archer', "Whenever a source you control deals noncombat damage to a creature equal to that creature's toughness, draw a card.", ['1', '1']);
const PYRE = card('Test Pyre', 'Creature — Human Shaman', 'Whenever an instant or sorcery spell you control that targets only a single creature deals damage to that creature, Test Pyre deals that much damage to each opponent.', ['2', '2']);
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to target creature.');
const ARC = card('Test Arc', 'Sorcery', 'Test Arc deals 2 damage to target creature and 2 damage to target player.');
const SWEEP = card('Test Sweep', 'Sorcery', 'Test Sweep deals 2 damage to each creature.');

describe('CR 120.1, 208.1: "a source you control deals noncombat damage to a creature equal to that creature\'s toughness"', () => {
  const board = (): GameState => scenario(['Island'], { defs: [MARKSMAN, SHOCK, CUB, OX], p1: { battlefield: ['Test Marksman'], hand: ['Test Shock'], library: ['Island', 'Island'] }, p2: { battlefield: ['Test Cub', 'Test Ox'] } });
  const shock = (s0: GameState, at: string): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shock', 'hand') }), { targets: [{ kind: 'object', id: find(s0, at, 'battlefield', 'p2') }] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  it('2 damage to the 2/2 draws a card; 2 damage to the 3/3 does not', () => {
    expect(full(MARKSMAN), JSON.stringify(MARKSMAN.automation)).toBe(true);
    expect(hand(shock(board(), 'Test Cub')).length).toBe(1);
    expect(hand(shock(board(), 'Test Ox')).length).toBe(0);
  });
});

describe('CR 115.9b, 120.1: "an instant or sorcery spell you control that targets only a single creature deals damage to that creature"', () => {
  const board = (spell: string): GameState => scenario([], { defs: [PYRE, SHOCK, ARC, SWEEP, CUB, OX], p1: { battlefield: ['Test Pyre'], hand: [spell] }, p2: { battlefield: ['Test Cub', 'Test Ox'] } });
  const play = (spell: string, targets: (s: GameState) => { kind: 'object' | 'player'; id: string }[]): GameState => {
    const s0 = board(spell);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand') });
    for (const t of targets(s0)) if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [t] as never });
    s = settle(s);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  const ox = (s: GameState) => [{ kind: 'object' as const, id: find(s, 'Test Ox', 'battlefield', 'p2') }];
  it('the damage the spell deals to its one target is dealt to each opponent too', () => {
    expect(full(PYRE), JSON.stringify(PYRE.automation)).toBe(true);
    expect(life(play('Test Shock', ox), 'p2')).toBe(18);
  });
  it('a spell with a second target (a player) does not trigger it: only the spell\'s own 2 damage to the player', () => {
    expect(full(ARC), JSON.stringify(ARC.automation)).toBe(true);
    expect(life(play('Test Arc', (s) => [...ox(s), { kind: 'player', id: 'p2' }]), 'p2')).toBe(18);
  });
  it('a spell with no target does not trigger it', () => {
    expect(life(play('Test Sweep', () => []), 'p2')).toBe(20);
  });
});

// ---- the creatures a spell targets ---------------------------------------------------------------------------------------------------------------------------
const GALE = card('Test Gale', 'Creature — Human Wizard', 'Whenever you cast a spell that targets one or more creatures, those creatures gain flying until end of turn.', ['1', '1']);
const BOOST = card('Test Boost', 'Instant', 'Target creature gets +1/+1 until end of turn.');

describe('CR 115.9b, 608.2c: "Whenever you cast a spell that targets one or more creatures, those creatures gain flying until end of turn"', () => {
  it('the creature the spell targets gains flying; another creature does not', () => {
    expect(full(GALE), JSON.stringify(GALE.automation)).toBe(true);
    const s0 = scenario([], { defs: [GALE, BOOST, CUB, OX], p1: { battlefield: ['Test Gale', 'Test Cub', 'Test Ox'], hand: ['Test Boost'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Boost', 'hand') }), { targets: [{ kind: 'object', id: find(s0, 'Test Cub', 'battlefield') }] });
    s = settle(pass(pass(s))); // the trigger resolves; the spell is still on the stack
    const flies = (n: string): boolean => (getChars(s, find(s, n, 'battlefield'))!.keywords as unknown[]).some((k) => JSON.stringify(k).includes('"flying"'));
    expect(flies('Test Cub')).toBe(true);
    expect(flies('Test Ox')).toBe(false);
  });
});

// ---- an activated ability described by what it targets --------------------------------------------------------------------------------------------------
const MENTOR = card('Test Mentor', 'Creature — Human Advisor', 'Whenever you activate an ability that targets a creature or player, copy that ability. You may choose new targets for the copy.', ['2', '2']);
const PINGER = card('Test Pinger', 'Creature — Goblin', '{1}: Test Pinger deals 1 damage to any target.', ['1', '1']);
const FONT = card('Test Font', 'Artifact', '{1}: You gain 1 life.');

describe('CR 602.2, 115.9b, 707.10: "Whenever you activate an ability that targets a creature or player, copy that ability"', () => {
  const board = (): GameState => scenario(['Island'], { defs: [MENTOR, PINGER, FONT], p1: { battlefield: ['Test Mentor', 'Test Pinger', 'Test Font', 'Island', 'Island'] } });
  const activate = (s0: GameState, name: string, targets: { kind: 'player'; id: string }[] = []): GameState => {
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, name, 'battlefield'), ability: 'p:0:0' });
    for (const t of targets) if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [t] });
    s = settle(s, { yes: false });
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = settle(pass(s), { yes: false });
    return s;
  };
  it('an ability that targets a player is copied: the player is dealt the damage twice', () => {
    expect(full(MENTOR), JSON.stringify(MENTOR.automation)).toBe(true);
    expect(life(activate(board(), 'Test Pinger', [{ kind: 'player', id: 'p2' }]), 'p2')).toBe(18);
  });
  it('an ability with no target is not copied', () => {
    expect(life(activate(board(), 'Test Font'), 'p1')).toBe(21);
  });
});

// ---- a card type other than creature -----------------------------------------------------------------------------------------------------------------------
const TOLL = card('Test Toll', 'Artifact', "As this artifact enters, look at an opponent's hand, then choose a card type other than creature.\nSpells of the chosen type cost {1} more to cast.");

describe('CR 614.12a, 205.2a: "choose a card type other than creature"', () => {
  it('the choice never offers creature; the chosen type\'s spells cost {1} more', () => {
    expect(full(TOLL), JSON.stringify(TOLL.automation)).toBe(true);
    let s = castFrom(scenario([], { defs: [TOLL, SHOCK], p1: { hand: ['Test Toll'] }, p2: { hand: ['Test Shock'] } }), 'Test Toll');
    s = settle(pass(pass(s)));
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardType' });
    const options = (s.pending as { options: string[] }).options;
    expect(options).toContain('Instant');
    expect(options).not.toContain('Creature');
    expect(refuse(s, 'Creature')).toMatch(/not one of the options/);
  });
});

// ---- what a cost beheld or returned ------------------------------------------------------------------------------------------------------------------------
const EMERGE = card('Test Emergence', 'Sorcery', 'As an additional cost to cast this spell, choose a creature you control or reveal a creature card from your hand.\nTest Emergence deals damage equal to the power of the creature you chose or the card you revealed to target creature.');

describe('CR 701.4a, 608.2h: "the power of the creature you chose or the card you revealed"', () => {
  const play = (p1: { hand: string[]; battlefield?: string[] }): GameState => {
    const s0 = scenario([], { defs: [EMERGE, CUB, OX], p1, p2: { battlefield: ['Test Ox'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Emergence', 'hand') });
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, 'Test Ox', 'battlefield', 'p2') }] }));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  it('the revealed 3-power card deals 3: the 3/3 dies', () => {
    expect(full(EMERGE), JSON.stringify(EMERGE.automation)).toBe(true);
    expect((play({ hand: ['Test Emergence', 'Test Ox'] }).zones.graveyard['p2'] ?? []).length).toBe(1);
  });
  it('the chosen 2-power creature deals 2: the 3/3 survives with 2 damage', () => {
    const s = play({ hand: ['Test Emergence'], battlefield: ['Test Cub'] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    expect(s.objects[ox]!.damage).toBe(2);
  });
});

const SPIDER = card('Test Spider', 'Creature — Spider Human', 'Web-slinging {0}\nIf Test Spider was cast using web-slinging, Test Spider enters with X +1/+1 counters on Test Spider, where X is the mana value of the returned creature.', ['1', '1'], '{4}');

describe('CR 702.188a, 608.2h: "where X is the mana value of the returned creature"', () => {
  it('cast using web-slinging, returning a tapped 3-mana creature: three counters; cast for its mana cost: none', () => {
    expect(full(SPIDER), JSON.stringify(SPIDER.automation)).toBe(true);
    const s0 = scenario(['Island'], { defs: [SPIDER, OX], p1: { hand: ['Test Spider'], battlefield: [{ name: 'Test Ox', tapped: true }, 'Island', 'Island', 'Island', 'Island'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spider', 'hand'), method: 'web-slinging' }));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(hand(s)).toContain('Test Ox');
    expect(counters(s, find(s, 'Test Spider', 'battlefield'), '+1/+1')).toBe(3);
    let t = castFrom(s0, 'Test Spider');
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = settle(pass(t));
    expect(counters(t, find(t, 'Test Spider', 'battlefield'), '+1/+1')).toBe(0);
  });
});

// ---- land and nonland card names --------------------------------------------------------------------------------------------------------------------------
const CHARIOT = card('Test Chariot', 'Artifact', 'As this artifact enters, choose a nonland card name.\nActivated abilities of sources with the chosen name cost {2} more to activate.');
const DRUID = card('Test Druid', 'Creature — Elf Druid', '{T}: Add {G}.', ['1', '1']);
const HAMLET = card('Test Hamlet', 'Land', "When this land enters, choose a land card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.\nLands with the chosen name have \"{T}: Add {C}.\"\n{T}: Add {C}.");
const ROCKS = card('Test Rocks', 'Land', '{T}: Add {R}.\n{1}, {T}: You gain 1 life.');

/** Cast or play `name`, let it (and its trigger) resolve, and stop at the name choice. */
function toNameChoice(s0: GameState, name: string, land = false): GameState {
  let s = land ? settle(act(s0, { type: 'playLand', player: 'p1', card: find(s0, name, 'hand') })) : castFrom(s0, name);
  for (let i = 0; i < 6 && s.pending?.kind !== 'chooseName'; i++) s = settle(pass(s));
  expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardName' });
  return s;
}
const activations = (s: GameState, name: string) => legal(s, 'p1', 'activate').filter((a) => (a as { object?: string }).object === find(s, name, 'battlefield'));

describe('CR 201.3, 601.2f, 602.2b: "choose a nonland card name" and "activated abilities of sources with the chosen name cost {2} more to activate"', () => {
  const board = (lands: number): GameState => scenario(['Forest', 'Island'], { defs: [CHARIOT, DRUID, FONT], p1: { hand: ['Test Chariot'], battlefield: ['Test Druid', 'Test Font', 'Forest', ...Array<string>(lands).fill('Island')] } });
  it('the decision asks for a nonland name, and a land of the game is refused', () => {
    expect(full(CHARIOT), JSON.stringify(CHARIOT.automation)).toBe(true);
    const s = toNameChoice(board(0), 'Test Chariot');
    expect(s.pending).toMatchObject({ cardKind: 'nonland' });
    expect(refuse(s, 'Forest')).toMatch(/land card/);
  });
  it('naming the {1} ability\'s source: with two mana sources it costs {3}, which they can\'t pay; with three it is offered', () => {
    expect(activations(board(0), 'Test Font').length).toBe(1);
    const two = settle(answer(toNameChoice(board(0), 'Test Chariot'), { kind: 'chooseName', name: 'Test Font' }));
    expect(activations(two, 'Test Font')).toEqual([]);
    const three = settle(answer(toNameChoice(board(1), 'Test Chariot'), { kind: 'chooseName', name: 'Test Font' }));
    expect(activations(three, 'Test Font').length).toBe(1);
  });
  it('CR 605.1a, 605.3a: naming a mana ability\'s source: its {T} ability now costs {2} and is not free; another name leaves it alone', () => {
    const named = settle(answer(toNameChoice(board(0), 'Test Chariot'), { kind: 'chooseName', name: 'Test Druid' }));
    expect(activations(named, 'Test Druid')).toEqual([]); // {2} more and only the Forest to pay it
    const paid = settle(answer(toNameChoice(board(1), 'Test Chariot'), { kind: 'chooseName', name: 'Test Druid' }));
    expect(activations(paid, 'Test Druid').length).toBe(1); // the Forest and the Island pay the {2}
    const other = settle(answer(toNameChoice(board(0), 'Test Chariot'), { kind: 'chooseName', name: 'Test Font' }));
    expect(activations(other, 'Test Druid').length).toBe(1);
  });
});

describe('CR 201.3, 607.2d, 602.5: "choose a land card name", "can\'t be activated unless they\'re mana abilities", "lands with the chosen name have ..."', () => {
  it('a nonland name is refused; the named land keeps only mana abilities and gains "{T}: Add {C}"', () => {
    expect(full(HAMLET), JSON.stringify(HAMLET.automation)).toBe(true);
    const s0 = scenario(['Island'], { defs: [HAMLET, ROCKS, DRUID], p1: { hand: ['Test Hamlet'], battlefield: ['Test Rocks', 'Island', 'Test Druid'] } });
    expect(activations(s0, 'Test Rocks').length).toBe(2);
    const s1 = toNameChoice(s0, 'Test Hamlet', true);
    expect(s1.pending).toMatchObject({ cardKind: 'land' });
    expect(refuse(s1, 'Test Druid')).toMatch(/land card/);
    const s = settle(answer(s1, { kind: 'chooseName', name: 'Test Rocks' }));
    const rocks = activations(s, 'Test Rocks');
    expect(rocks.every((a) => (a as { isMana?: boolean }).isMana === true)).toBe(true);
    expect(rocks.length).toBe(2); // {T}: Add {R} and the granted {T}: Add {C}
  });
});
