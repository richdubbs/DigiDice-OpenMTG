/**
 * Standard round 4, slice r4-moved: "this way" results of an earlier instruction (the held-out units of r3-moved's family), played with invented cards.
 *
 *   CR 608.2c, 701.9a, 400.7   "Draw a card, then discard a card. If you discard a land card this way, put it from your graveyard onto the battlefield tapped."
 *   CR 608.2c, 400.7           "If you discarded a land card this way, put it onto the battlefield tapped." ("it" is the discarded card, not the creature)
 *   CR 603.12, 608.2h          "When you discard a card this way, target player mills cards equal to its mana value."
 *   CR 109.2, 608.2c, 608.2h   "Return a creature you control to its owner's hand. If another Elf was returned this way, ..."
 *   CR 608.2c, 701.23a         "you may search your library for ... If you don't put a card into your hand this way, ..." / "If you search your library this way, ..."
 *   CR 701.17a, 608.2c         "Each player mills three cards. For each creature card put into a graveyard this way, you create a tapped ... token."
 *   CR 608.2c                  "... create a token for each permanent returned to its owner's hand this way."
 *   CR 400.7, 603.7, 610.3     "Exile two target creatures. Return the exiled cards to the battlefield under their owners' control at the beginning of the next end step."
 *   CR 608.2c                  "If you control a Goblin or returned a Goblin card to your hand this way, ..."
 *   design 6.4 (fail closed)   a discard of two cards, a search of a graveyard, "another" after a target
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const json = (d: CardDef): string => JSON.stringify(d.faces);
const zone = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[z][p]!.map((id) => s.objects[id]!.defId);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
/** Pick the first option that is a card named `name` (read in the state of the decision). */
const named = (name: string): Pick => (options, _min, _max, st) => options.filter((id) => st.objects[id]!.defId === name).slice(0, 1);

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
type Pick = (options: ObjectId[], min: number, max: number, st: GameState) => ObjectId[];
/** Answer the decisions until priority: payments automatic, the targets in order, `pick` for object choices (default: the first allowed), `yes` to "may". */
function drive(s0: GameState, targets: Target[][] = [], pick?: Pick, yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options, p.min, p.max, s) : p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: Math.min(p.max, 3) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], pick?: Pick, yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, pick, yes);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = [], pick?: Pick, yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, pick, yes), targets, pick, yes);
const activate = (s: GameState, name: string, targets: Target[][] = [], pick?: Pick, yes = true): GameState => {
  const src = find(s, name, 'battlefield', 'p1');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), targets, pick, yes), targets, pick, yes);
};

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const IDOL = card('Test Idol', 'Artifact', '', { cost: '{1}' });
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.', { cost: '{2}{B}' });

describe('CR 608.2c, 701.9a, 400.7: "If you discard a land card this way, put it from your graveyard onto the battlefield tapped." (the card the condition names)', () => {
  const REVELER = card('Test Reveler', 'Creature — Elf', 'When this creature enters, draw a card, then discard a card. If you discard a land card this way, put it from your graveyard onto the battlefield tapped.', { pt: ['2', '2'] });
  it('is understood: "it" is the discarded card, read only while it is in your graveyard', () => {
    expect(noManual(REVELER)).toBe(true);
    expect(json(REVELER)).toContain('"what":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"zone":"graveyard","owner":"you"}}');
  });
  it('a land discarded: it enters tapped; the creature stays', () => {
    let s = scenario([], { defs: [REVELER, RITE], p1: { hand: ['Test Reveler', 'Plains'] } });
    s = cast(s, 'Test Reveler', [], named('Plains'));
    expect(onField(s, 'Test Reveler')).toHaveLength(1);
    const lands = onField(s, 'Plains');
    expect(lands).toHaveLength(1);
    expect(s.objects[lands[0]!]!.tapped).toBe(true);
  });
  it('a nonland card discarded: nothing enters', () => {
    let s = scenario([], { defs: [REVELER, RITE], p1: { hand: ['Test Reveler', 'Test Rite'] } });
    s = cast(s, 'Test Reveler', [], named('Test Rite'));
    expect(onField(s, 'Test Rite')).toEqual([]);
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Rite');
  });
  it('CR 400.7: "If you discarded a land card this way, put it onto the battlefield tapped." puts the discarded land, never the creature itself', () => {
    const OLD = card('Test Old Reveler', 'Creature — Elf', 'When this creature enters, draw a card, then discard a card. If you discarded a land card this way, put it onto the battlefield tapped.', { pt: ['2', '2'] });
    expect(noManual(OLD)).toBe(true);
    expect(json(OLD)).not.toContain('"what":{"ref":"self"}');
    let s = scenario([], { defs: [OLD], p1: { hand: ['Test Old Reveler', 'Plains'] } });
    s = cast(s, 'Test Old Reveler', [], named('Plains'));
    expect(onField(s, 'Plains')).toHaveLength(1);
    expect(onField(s, 'Test Old Reveler')).toHaveLength(1);
  });
  it('design 6.4: after a discard of two cards, "it" names no one card and stays manual', () => {
    const TWO = card('Test Two Reveler', 'Creature — Elf', 'When this creature enters, draw two cards, then discard two cards. If you discard a land card this way, put it from your graveyard onto the battlefield tapped.', { pt: ['2', '2'] });
    expect(noManual(TWO)).toBe(false);
  });
});

describe('CR 603.12, 608.2h: "When you discard a card this way, target player mills cards equal to its mana value." (the discarded card)', () => {
  const ONE = card('Test Ancient', 'Creature — Spirit', '{0}: Draw a card, then discard a card. When you discard a card this way, target player mills cards equal to its mana value.', { pt: ['2', '2'] });
  it('is understood: "its" is the discarded card', () => expect(noManual(ONE)).toBe(true));
  it('a mana value 3 card discarded: the target player mills three', () => {
    let s = scenario([], { defs: [ONE, RITE], p1: { battlefield: ['Test Ancient'], hand: ['Test Rite'] } });
    const before = s.zones.graveyard.p2!.length;
    s = activate(s, 'Test Ancient', [[{ kind: 'player', id: 'p2' }]], named('Test Rite'));
    expect(s.zones.graveyard.p2!.length).toBe(before + 3);
  });
  it('a land discarded: mana value 0, nothing milled', () => {
    let s = scenario([], { defs: [ONE], p1: { battlefield: ['Test Ancient'], hand: ['Plains'] } });
    const before = s.zones.graveyard.p2!.length;
    s = activate(s, 'Test Ancient', [[{ kind: 'player', id: 'p2' }]], named('Plains'));
    expect(s.zones.graveyard.p2!.length).toBe(before);
  });
});

describe('CR 109.2, 608.2c, 608.2h: "Return a creature you control to its owner\'s hand. If another Elf was returned this way, ..." (other than the object itself)', () => {
  const PATH = card('Test Elf Path', 'Creature — Elf', "When this creature enters, return a creature you control to its owner's hand. If another Elf was returned this way, you gain 3 life.", { pt: ['1', '1'] });
  it('is understood', () => {
    expect(noManual(PATH)).toBe(true);
    expect(json(PATH)).toContain('"which":{"subtypes":["Elf"],"other":true,"zone":"battlefield"}');
  });
  it('another Elf returned: 3 life', () => {
    let s = scenario([], { defs: [PATH, ELF], p1: { hand: ['Test Elf Path'], battlefield: ['Test Elf'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Elf Path', [], named('Test Elf'));
    expect(zone(s, 'hand', 'p1')).toContain('Test Elf');
    expect(life(s, 'p1')).toBe(before + 3);
  });
  it('the creature returns itself: it is no other Elf, no life', () => {
    let s = scenario([], { defs: [PATH, ELF], p1: { hand: ['Test Elf Path'], battlefield: ['Test Elf'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Elf Path', [], named('Test Elf Path'));
    expect(zone(s, 'hand', 'p1')).toContain('Test Elf Path');
    expect(life(s, 'p1')).toBe(before);
  });
  it('a Bear returned: no life', () => {
    let s = scenario([], { defs: [PATH, BEAR], p1: { hand: ['Test Elf Path'], battlefield: ['Test Bear'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Elf Path', [], named('Test Bear'));
    expect(life(s, 'p1')).toBe(before);
  });
  it('design 6.4: after a target, "another" may mean other than the target and stays manual', () => {
    const T = card('Test Target Path', 'Creature — Elf', "When this creature enters, tap target creature. Return a creature you control to its owner's hand. If another Elf was returned this way, you gain 3 life.", { pt: ['1', '1'] });
    expect(noManual(T)).toBe(false);
  });
});

describe('CR 608.2c, 701.23a: "If you don\'t put a card into your hand this way, ..." and "If you search your library this way, ..." after an optional search', () => {
  const COURIER = card('Test Courier', 'Creature — Human', "When this creature enters, you may search your library for an artifact card, reveal it, put it into your hand, then shuffle. If you don't put a card into your hand this way, you gain 2 life.", { pt: ['1', '1'] });
  const MERCHANT = card('Test Merchant', 'Creature — Human', 'When this creature enters, you may search your library for a basic land card and put it onto the battlefield tapped. If you search your library this way, you lose 2 life.', { pt: ['1', '1'] });
  it('both are understood', () => {
    expect(noManual(COURIER)).toBe(true);
    expect(noManual(MERCHANT)).toBe(true);
  });
  it('the search declined: 2 life (nothing was put into your hand)', () => {
    let s = scenario([], { defs: [COURIER, IDOL], p1: { hand: ['Test Courier'], library: ['Test Idol'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Courier', [], undefined, false);
    expect(life(s, 'p1')).toBe(before + 2);
  });
  it('an artifact found and put into your hand: no life', () => {
    let s = scenario([], { defs: [COURIER, IDOL], p1: { hand: ['Test Courier'], library: ['Test Idol'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Courier', [], named('Test Idol'));
    expect(zone(s, 'hand', 'p1')).toContain('Test Idol');
    expect(life(s, 'p1')).toBe(before);
  });
  it('you searched: 2 life lost; you declined: none', () => {
    let s = scenario([], { defs: [MERCHANT], p1: { hand: ['Test Merchant'] } });
    let before = life(s, 'p1');
    s = cast(s, 'Test Merchant');
    expect(life(s, 'p1')).toBe(before - 2);
    let t = scenario([], { defs: [MERCHANT], p1: { hand: ['Test Merchant'] } });
    before = life(t, 'p1');
    t = cast(t, 'Test Merchant', [], undefined, false);
    expect(life(t, 'p1')).toBe(before);
  });
  it('design 6.4: "If you search your library this way" after a draw, or after a search of your graveyard, stays manual', () => {
    expect(noManual(card('Test Draw Merchant', 'Creature — Human', 'When this creature enters, you may draw a card. If you search your library this way, you lose 2 life.', { pt: ['1', '1'] }))).toBe(false);
    expect(noManual(card('Test Grave Merchant', 'Creature — Human', 'When this creature enters, you may search your graveyard for a creature card, reveal it, and put it into your hand. If you search your library this way, you lose 2 life.', { pt: ['1', '1'] }))).toBe(false);
  });
});

describe('CR 701.17a, 608.2c: "For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token." (the subject said, the token tapped)', () => {
  const SUMMONS = card('Test Summons', 'Sorcery', 'Each player mills three cards. For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token.');
  it('is understood', () => expect(noManual(SUMMONS)).toBe(true));
  it('two creature cards milled (one each): two tapped Zombies', () => {
    let s = scenario([], { defs: [SUMMONS, BEAR], p1: { hand: ['Test Summons'], library: ['Test Bear'] }, p2: { library: ['Test Bear'] } });
    s = cast(s, 'Test Summons');
    const milledBears = [...s.zones.graveyard.p1!, ...s.zones.graveyard.p2!].filter((id) => s.objects[id]!.defId === 'Test Bear').length;
    const zombies = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(zombies).toHaveLength(milledBears);
    expect(zombies.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

describe('CR 608.2c: "Create a 1/1 blue Bird creature token for each permanent returned to its owner\'s hand this way." (the words of one owner\'s hand)', () => {
  const FAREWELL = card('Test Farewell', 'Sorcery', "Return up to two target creatures to their owners' hands. Create a 1/1 blue Bird creature token for each permanent returned to its owner's hand this way.");
  it('is understood', () => expect(noManual(FAREWELL)).toBe(true));
  it('two creatures returned: two Birds', () => {
    let s = scenario([], { defs: [FAREWELL, BEAR, GOBLIN], p1: { hand: ['Test Farewell'] }, p2: { battlefield: ['Test Bear', 'Test Goblin'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p2');
    s = cast(s, 'Test Farewell', [[{ kind: 'object', id: bear }, { kind: 'object', id: goblin }]]);
    expect(zone(s, 'hand', 'p2')).toEqual(expect.arrayContaining(['Test Bear', 'Test Goblin']));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });
});

describe('CR 400.7, 603.7: "Exile two target creatures. Return the exiled cards to the battlefield under their owners\' control at the beginning of the next end step."', () => {
  const HIDE = card('Test Hide', 'Instant', "Exile two target creatures. Return the exiled cards to the battlefield under their owners' control at the beginning of the next end step.");
  it('is understood: "the exiled cards" are what the exile moved', () => expect(noManual(HIDE)).toBe(true));
  it('both creatures come back at the end step', () => {
    let s = scenario([], { defs: [HIDE, BEAR, GOBLIN], p1: { hand: ['Test Hide'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Goblin'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p2');
    s = cast(s, 'Test Hide', [[{ kind: 'object', id: bear }, { kind: 'object', id: goblin }]]);
    expect(onField(s, 'Test Bear')).toEqual([]);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(onField(s, 'Test Bear')).toHaveLength(1);
    expect(onField(s, 'Test Goblin')).toHaveLength(1);
    expect(s.objects[onField(s, 'Test Goblin')[0]!]!.controller).toBe('p2');
  });
});

describe('CR 608.2c: "If you control a Goblin or returned a Goblin card to your hand this way, ..." (the subject of the second condition left out)', () => {
  const GRAB = card('Test Grab', 'Instant', 'Mill four cards. You may put a creature card from among the cards milled this way into your hand. If you control a Goblin or returned a Goblin card to your hand this way, you gain 3 life.');
  it('is understood', () => expect(noManual(GRAB)).toBe(true));
  it('a Goblin card returned: 3 life', () => {
    let s = scenario([], { defs: [GRAB, GOBLIN], p1: { hand: ['Test Grab'], library: ['Test Goblin'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grab', [], named('Test Goblin'));
    expect(zone(s, 'hand', 'p1')).toContain('Test Goblin'); // the top of the library (the scenario's first library card) was milled
    expect(life(s, 'p1')).toBe(before + 3);
  });
  it('a Goblin you control, nothing returned: 3 life; neither: none', () => {
    let s = scenario([], { defs: [GRAB, GOBLIN], p1: { hand: ['Test Grab'], battlefield: ['Test Goblin'] } });
    let before = life(s, 'p1');
    s = cast(s, 'Test Grab', [], undefined, false);
    expect(life(s, 'p1')).toBe(before + 3);
    let t = scenario([], { defs: [GRAB], p1: { hand: ['Test Grab'] } });
    before = life(t, 'p1');
    t = cast(t, 'Test Grab', [], undefined, false);
    expect(life(t, 'p1')).toBe(before);
  });
});

describe('CR 701.6a, 608.2c: "Create a 1/1 ... token for each spell and ability countered this way." (what the counter step countered)', () => {
  const ANSWER = card('Test Answer', 'Instant', 'Counter target spell. Create a 1/1 green Saproling creature token for each spell and ability countered this way.');
  it('is understood: the count is the result of the counter step', () => {
    expect(noManual(ANSWER)).toBe(true);
    expect(json(ANSWER)).toMatch(/"count":\{"q":"resultCount","step":"[a-z0-9]+"\}/);
  });
  it('one spell countered: one Saproling; the countered spell does nothing', () => {
    const GIFT = card('Test Gift', 'Sorcery', 'You gain 1 life.');
    let s = scenario([], { defs: [ANSWER, GIFT], p1: { hand: ['Test Answer', 'Test Gift'] } });
    const before = life(s, 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gift', 'hand', 'p1') }));
    const rite = s.zones.stack[s.zones.stack.length - 1]!;
    s = cast(s, 'Test Answer', [[{ kind: 'object', id: rite }]]);
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Gift');
    expect(life(s, 'p1')).toBe(before);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(1);
  });
});

describe('CR 608.2f, 608.2h, 701.9a: "For each opponent who didn\'t discard two nonland cards this way, you draw a card." (per opponent, what that opponent discarded)', () => {
  const RANSACK = card('Test Ransack', 'Sorcery', "Each opponent discards two cards. For each opponent who didn't discard two nonland cards this way, you draw a card.");
  const HYMN = card('Test Hymn', 'Sorcery', 'You gain 2 life.', { cost: '{1}{B}' });
  it('is understood: the count of that opponent\'s discarded cards, read as they were', () => {
    expect(json(RANSACK)).toContain('"owner":{"ref":"bound","name":"each"}');
    expect(JSON.stringify(RANSACK.faces)).not.toContain('"op":"manual"');
  });
  it('the opponent discards a land and a nonland card: you draw one', () => {
    let s = scenario([], { defs: [RANSACK, RITE], p1: { hand: ['Test Ransack'] }, p2: { hand: ['Plains', 'Test Rite'] } });
    const cards = s.zones.hand.p1!.length;
    s = cast(s, 'Test Ransack');
    expect(s.zones.hand.p2).toHaveLength(0);
    expect(s.zones.hand.p1!.length).toBe(cards - 1 + 1);
  });
  it('the opponent discards two nonland cards: you draw none', () => {
    let s = scenario([], { defs: [RANSACK, RITE, HYMN], p1: { hand: ['Test Ransack'] }, p2: { hand: ['Test Hymn', 'Test Rite'] } });
    const cards = s.zones.hand.p1!.length;
    s = cast(s, 'Test Ransack');
    expect(s.zones.hand.p1!.length).toBe(cards - 1);
  });
  it('the opponent has one nonland card only: you draw one', () => {
    let s = scenario([], { defs: [RANSACK, RITE], p1: { hand: ['Test Ransack'] }, p2: { hand: ['Test Rite'] } });
    const cards = s.zones.hand.p1!.length;
    s = cast(s, 'Test Ransack');
    expect(s.zones.hand.p1!.length).toBe(cards);
  });
});

describe('CR 607.2a, 205.2a: "As long as there are four or more card types among cards exiled with ~, it gets +4/+4 and has trample." (the linked exile)', () => {
  const CURATOR = card('Test Curator', 'Creature — Raccoon', '{0}: Exile target card from a graveyard.\nAs long as there are four or more card types among cards exiled with this creature, it gets +4/+4 and has trample.', { pt: ['3', '3'] });
  it('is understood: the distinct card types among the cards its own ability exiled', () => {
    expect(noManual(CURATOR)).toBe(true);
    expect(json(CURATOR)).toContain('"among":{"ref":"linked","link":"exiled"}');
  });
  it('three card types exiled: 3/3; a fourth: 7/7 with trample', () => {
    let s = scenario([], { defs: [CURATOR, BEAR, RITE, IDOL], p1: { battlefield: ['Test Curator'] }, p2: { graveyard: ['Test Bear', 'Test Rite', 'Plains', 'Test Idol'] } });
    const cur = find(s, 'Test Curator', 'battlefield', 'p1');
    for (const n of ['Test Bear', 'Test Rite', 'Plains']) s = activate(s, 'Test Curator', [[{ kind: 'object', id: find(s, n, 'graveyard', 'p2') }]]);
    expect(ptNumbers(getChars(s, cur))).toEqual({ power: 3, toughness: 3 });
    expect(getChars(s, cur).keywords.map((k) => k.keyword)).not.toContain('trample');
    s = activate(s, 'Test Curator', [[{ kind: 'object', id: find(s, 'Test Idol', 'graveyard', 'p2') }]]);
    expect(ptNumbers(getChars(s, cur))).toEqual({ power: 7, toughness: 7 });
    expect(getChars(s, cur).keywords.map((k) => k.keyword)).toContain('trample');
  });
});

describe('CR 601.2, 611.3a, 614.1c: "During your turn, you may cast creature spells with power 1 or less from your graveyard. If you cast a spell this way, that creature enters with a finality counter on it."', () => {
  const SAMURAI = card('Test Samurai', 'Creature — Turtle', 'During your turn, you may cast creature spells with power or toughness 1 or less from your graveyard. If you cast a spell this way, that creature enters with a finality counter on it.', { pt: ['2', '2'] });
  it('is understood: one static, the permission during your turn with its counter', () => {
    expect(noManual(SAMURAI)).toBe(true);
    expect(json(SAMURAI)).toContain('"condition":{"cond":"turnOf","whose":"you"}');
    expect(json(SAMURAI)).toContain('"entersWith":[{"kind":"finality","count":1}]');
  });
  it('a 1/1 cast from your graveyard on your turn enters with a finality counter', () => {
    let s = scenario([], { defs: [SAMURAI, GOBLIN], p1: { battlefield: ['Test Samurai'], graveyard: ['Test Goblin'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Goblin', 'graveyard', 'p1') })));
    const g = onField(s, 'Test Goblin');
    expect(g).toHaveLength(1);
    expect(s.objects[g[0]!]!.counters['finality']).toBe(1);
  });
});

describe('CR 607.2a, 400.7, 608.2c: "Put each card exiled with this artifact into its owner\'s graveyard, then create a token for each card put into a graveyard this way. Sacrifice this artifact."', () => {
  const CAGE = card('Test Cage', 'Artifact', "When this artifact enters, exile all creatures with mana value 2 or less until this artifact leaves the battlefield.\n{0}: Put each card exiled with this artifact into its owner's graveyard, then create a 2/2 colorless Robot artifact creature token for each card put into a graveyard this way. Sacrifice this artifact.");
  it('is understood: the linked exile moved to the graveyards, then counted', () => {
    expect(noManual(CAGE)).toBe(true);
    expect(json(CAGE)).toContain('"what":{"ref":"linked","link":"exiled"},"to":{"zone":"graveyard"}');
  });
  it('two creatures exiled: both go to graveyards, two Robots, and neither returns when the artifact leaves', () => {
    let s = scenario([], { defs: [CAGE, BEAR, GOBLIN], p1: { hand: ['Test Cage'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Goblin'] } });
    s = cast(s, 'Test Cage');
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(onField(s, 'Test Goblin')).toEqual([]);
    s = activate(s, 'Test Cage');
    expect(onField(s, 'Test Cage')).toEqual([]);
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Bear');
    expect(zone(s, 'graveyard', 'p2')).toContain('Test Goblin');
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });
});
