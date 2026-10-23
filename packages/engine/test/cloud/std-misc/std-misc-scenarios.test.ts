/**
 * Cloud batch 2, slice std-misc (the Standard backlog of the small sets, tuning half): the templates of parser/templates/zz-cloud/std-misc.json and the
 * renderer, lowering and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2d, 607.2d, 603.7c   "Choose a card name. Whenever a creature with the chosen name deals combat damage to a player this turn, draw a card."
 *   CR 603.4, 603.10a, 608.2h   "Whenever a creature an opponent controls dies, if its toughness was less than 1, draw a card."
 *   CR 107.1a, 111.1            "When ~ enters, create half X Food tokens, rounded up."
 *   CR 603.2c, 701.9a           "Whenever one or more players discard one or more cards, ..." (once for the batch) / "Whenever a player discards one or more cards" (once each)
 *   CR 608.2d, 607.2d, 208.1    "Choose a number between 0 and 10. Destroy all creatures with power greater than or equal to the chosen number."
 *   CR 208.1, 603.4, 602.5b     coven: "if you control three or more creatures with different powers" (a trigger's condition, an activation restriction)
 *   CR 506.2, 508.1             "Whenever ~ attacks, it deals damage to defending player equal to the number of artifacts they control."
 *   CR 111.1, 110.5b            "Target opponent creates a tapped Treasure token."
 *   CR 603.2, 603.6a            "Creatures entering don't cause abilities to trigger."
 *   CR 707.9b, 707.10, 707.10f  "When you next cast a creature spell this turn, copy it, except the copy isn't legendary." / "..., except the copy is an artifact ..."
 *   CR 105.2, 603.2h            "Whenever you cast a spell that's one or more colors, you may gain 1 life for each of that spell's colors. Do this only once each turn."
 *   CR 701.23a, 201.2, 607.2a   "search ... for up to five land cards that have different names, exile them" / "choose a card at random exiled with ~ and put it onto the battlefield tapped"
 *   CR 701.21a, 603.10a, 603.7  "Whenever you sacrifice ~ or another artifact, you may pay {2}. If you do, at the beginning of the next end step, create a token that's a copy of that artifact."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

interface Answers {
  targets?: ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
  name?: string;
  /** The number chosen: also the X announced for a spell (CR 601.2b). */
  number?: number;
}
/** Answer the decisions that come up until priority (payments automatic; the targets in order; a name or number as given; other choices the first allowed). */
function drive(s0: GameState, a: Answers = {}): GameState {
  let s = s0;
  const q = [...(a.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: a.name ?? p.options?.[0] ?? 'Plains' });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: a.number ?? p.min });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, a?: Answers): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), a);
  return s;
}
const cast = (s: GameState, name: string, a?: Answers): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), a), a);

/** Pass priority to the declare-attackers decision (the steps before it have no stops), declare `attackers`, and stop with the attack declared and its triggers resolved. */
function attack(s0: GameState, attackers: ObjectId[], a?: Answers): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, a);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  return resolveAll(drive(s, a), a);
}
/** Play on until combat damage has been dealt and its triggers resolved (blocks: none). */
function toDamage(s0: GameState, a?: Answers): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending;
    if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? resolveAll(s, a) : pass(s);
    else s = drive(s, a);
  }
  return s;
}

describe('CR 608.2d, 607.2d, 603.7c: "Choose a card name. Whenever a creature with the chosen name deals combat damage to a player this turn, draw a card."', () => {
  const OMEN = card('Test Omen', 'Sorcery', 'Choose a card name. Whenever a creature with the chosen name deals combat damage to a player this turn, draw a card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(OMEN)).toBe(true));
  it('a creature with the chosen name that deals combat damage to a player draws a card, after the spell itself is gone (CR 603.7c: the name is fixed as it resolves)', () => {
    const s0 = scenario([], { defs: [OMEN, BEAR, WOLF], p1: { hand: ['Test Omen'], battlefield: ['Test Bear', 'Test Wolf'] } });
    const s1 = cast(s0, 'Test Omen', { name: 'Test Bear' });
    expect(findAll(s1, 'Test Omen', 'graveyard', 'p1')).toHaveLength(1);
    const h1 = hand(s1, 'p1');
    const s = toDamage(attack(s1, [find(s1, 'Test Bear', 'battlefield')]));
    expect(hand(s, 'p1')).toBe(h1 + 1);
  });
  it('a creature with another name draws nothing', () => {
    const s0 = scenario([], { defs: [OMEN, BEAR, WOLF], p1: { hand: ['Test Omen'], battlefield: ['Test Bear', 'Test Wolf'] } });
    const s1 = cast(s0, 'Test Omen', { name: 'Test Bear' });
    const h1 = hand(s1, 'p1');
    const s = toDamage(attack(s1, [find(s1, 'Test Wolf', 'battlefield')]));
    expect(hand(s, 'p1')).toBe(h1);
  });
});

describe('CR 603.4, 603.10a, 608.2h: "Whenever a creature an opponent controls dies, if its toughness was less than 1, draw a card."', () => {
  const WATCHER = card('Test Watcher', 'Creature — Human', 'Whenever a creature an opponent controls dies, if its toughness was less than 1, draw a card.', { pt: ['1', '1'] });
  const SHRINK = card('Test Shrink', 'Instant', 'Target creature gets -2/-2 until end of turn.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(WATCHER)).toBe(true));
  it('a creature that died of toughness 0 (a state-based action) draws a card: the toughness it had as it last existed, also as the ability resolves', () => {
    const s0 = scenario([], { defs: [WATCHER, SHRINK, OGRE], p1: { hand: ['Test Shrink'], battlefield: ['Test Watcher'] }, p2: { battlefield: ['Test Ogre'] } });
    const h0 = hand(s0, 'p1');
    const s = cast(s0, 'Test Shrink', { targets: [[{ kind: 'object', id: find(s0, 'Test Ogre', 'battlefield') }]] });
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h0 - 1 + 1);
  });
  it('a creature destroyed with its toughness 2 draws nothing', () => {
    const s0 = scenario([], { defs: [WATCHER, SMITE, OGRE], p1: { hand: ['Test Smite'], battlefield: ['Test Watcher'] }, p2: { battlefield: ['Test Ogre'] } });
    const h0 = hand(s0, 'p1');
    const s = cast(s0, 'Test Smite', { targets: [[{ kind: 'object', id: find(s0, 'Test Ogre', 'battlefield') }]] });
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h0 - 1);
  });
});

describe('CR 107.1a, 111.1: "When ~ enters, create half X Food tokens, rounded up." / "..., rounded down."', () => {
  const GOOSE = card('Test Goose', 'Creature — Bird', 'When this creature enters, create half X Food tokens, rounded up.', { pt: ['1', '1'], cost: '{X}' });
  const GANDER = card('Test Gander', 'Creature — Bird', 'When this creature enters, create half X Food tokens, rounded down.', { pt: ['1', '1'], cost: '{X}' });
  it('is understood', () => {
    expect(noManual(GOOSE)).toBe(true);
    expect(noManual(GANDER)).toBe(true);
  });
  it('X = 3: two tokens rounded up, one rounded down', () => {
    for (const [def, want] of [[GOOSE, 2], [GANDER, 1]] as const) {
      const s0 = scenario([], { defs: [def], p1: { hand: [def.name], battlefield: ['Plains', 'Plains', 'Plains'] } });
      const s = cast(s0, def.name, { number: 3 });
      expect(findAll(s, def.name, 'battlefield', 'p1'), def.name).toHaveLength(1);
      expect(tokensOf(s, 'p1'), def.name).toHaveLength(want);
    }
  });
});

describe('CR 603.2c, 701.9a: "Whenever one or more players discard one or more cards, ..." triggers once for a batch in which several players discard', () => {
  const ALL = card('Test Listener', 'Creature — Human', 'Whenever one or more players discard one or more cards, you gain 1 life.', { pt: ['1', '1'] });
  const EACH = card('Test Counter', 'Creature — Human', 'Whenever a player discards one or more cards, you gain 1 life.', { pt: ['1', '1'] });
  const PURGE = card('Test Purge', 'Sorcery', 'Each player discards a card.');
  it('is understood', () => expect(noManual(ALL)).toBe(true));
  it('both players discard at once: "one or more players" gains 1 life, "a player" gains 1 life for each of them', () => {
    for (const [def, want] of [[ALL, 21], [EACH, 22]] as const) {
      const s0 = scenario([], { defs: [def, PURGE], p1: { hand: ['Test Purge', 'Plains'], battlefield: [def.name] }, p2: { hand: ['Plains'] } });
      const s = cast(s0, 'Test Purge');
      expect(hand(s, 'p2'), def.name).toBe(0);
      expect(life(s, 'p1'), def.name).toBe(want);
    }
  });
});

describe('CR 608.2d, 607.2d, 208.1: "Choose a number between 0 and 10. Destroy all creatures with power greater than or equal to the chosen number."', () => {
  const EXPEL = card('Test Expulsion', 'Sorcery', 'Choose a number between 0 and 10. Destroy all creatures with power greater than or equal to the chosen number.');
  const ONE = card('Test One', 'Creature — Elf', '', { pt: ['1', '1'] });
  const THREE = card('Test Three', 'Creature — Elf', '', { pt: ['3', '3'] });
  const FIVE = card('Test Five', 'Creature — Elf', '', { pt: ['5', '5'] });
  it('is understood', () => expect(noManual(EXPEL)).toBe(true));
  it('the number chosen as it resolves (3) destroys the creatures with power 3 or more, of every player', () => {
    const s0 = scenario([], { defs: [EXPEL, ONE, THREE, FIVE], p1: { hand: ['Test Expulsion'], battlefield: ['Test One', 'Test Three'] }, p2: { battlefield: ['Test Five'] } });
    expect(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Expulsion', 'hand', 'p1') }).zones.stack).toHaveLength(1);
    const s = cast(s0, 'Test Expulsion', { number: 3 });
    expect(findAll(s, 'Test One', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Three', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Five', 'battlefield')).toHaveLength(0);
  });
  it('the decision offers the stated range only (0 to 10)', () => {
    const s0 = scenario([], { defs: [EXPEL, ONE], p1: { hand: ['Test Expulsion'], battlefield: ['Test One'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Expulsion', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 10 });
  });
});

describe('CR 208.1, 603.4, 602.5b: coven, "if you control three or more creatures with different powers"', () => {
  const COVEN = card('Test Covenant', 'Creature — Human Warlock', 'When this creature enters, if you control three or more creatures with different powers, draw a card.', { pt: ['3', '3'] });
  const TOOL = card('Test Ritual Tool', 'Artifact', '{T}: You gain 1 life. Activate only if you control three or more creatures with different powers.');
  const ONE = card('Test One', 'Creature — Elf', '', { pt: ['1', '1'] });
  const TWO = card('Test Two', 'Creature — Elf', '', { pt: ['2', '2'] });
  it('is understood', () => {
    expect(noManual(COVEN)).toBe(true);
    expect(noManual(TOOL)).toBe(true);
  });
  it('powers 1, 2 and 3: the condition holds and a card is drawn; powers 1, 1 and 3 (two different powers): nothing', () => {
    for (const [others, want] of [[['Test One', 'Test Two'], 1], [['Test One', 'Test One'], 0]] as const) {
      const s0 = scenario([], { defs: [COVEN, ONE, TWO], p1: { hand: ['Test Covenant'], battlefield: [...others] } });
      const h0 = hand(s0, 'p1');
      const s = cast(s0, 'Test Covenant');
      expect(hand(s, 'p1'), others.join()).toBe(h0 - 1 + want);
    }
  });
  it('CR 602.5b: the activation is offered only while three different powers are on your side', () => {
    const offered = (bf: string[]): boolean => {
      const s0 = scenario([], { defs: [TOOL, ONE, TWO, COVEN], p1: { battlefield: ['Test Ritual Tool', ...bf] } });
      const tool = find(s0, 'Test Ritual Tool', 'battlefield', 'p1');
      return legal(s0, 'p1', 'activate').some((a) => a.object === tool);
    };
    expect(offered(['Test One', 'Test Two', 'Test Covenant'])).toBe(true);
    expect(offered(['Test One', 'Test One', 'Test Covenant'])).toBe(false);
  });
});

describe('CR 506.2, 508.1: "Whenever ~ attacks, it deals damage to defending player equal to the number of artifacts they control."', () => {
  const PLUNDERER = card('Test Plunderer', 'Creature — Human Rogue', 'Whenever this creature attacks, it deals damage to defending player equal to the number of artifacts they control.', { pt: ['2', '2'] });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  it('is understood', () => expect(noManual(PLUNDERER)).toBe(true));
  it('"they" is the defending player: two artifacts of theirs, two damage (yours do not count)', () => {
    const s0 = scenario([], { defs: [PLUNDERER, TRINKET], p1: { battlefield: ['Test Plunderer', 'Test Trinket', 'Test Trinket', 'Test Trinket'] }, p2: { battlefield: ['Test Trinket', 'Test Trinket'] } });
    const s = attack(s0, [find(s0, 'Test Plunderer', 'battlefield', 'p1')]);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });  it('CR 506.2, 508.5: attacking a planeswalker, the defending player is its controller: "they" still counts that player\'s artifacts', () => {
    const s0 = scenario(['Jace Beleren'], { defs: [PLUNDERER, TRINKET], p1: { battlefield: ['Test Plunderer'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }, 'Test Trinket', 'Test Trinket'] } });
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Plunderer', 'battlefield', 'p1'), defender: find(s, 'Jace Beleren', 'battlefield', 'p2') }] });
    s = resolveAll(drive(s));
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 111.1, 110.5b: "Target opponent creates a tapped Treasure token."', () => {
  const GIFT = card('Test Gift', 'Sorcery', 'Target opponent creates a tapped Treasure token.');
  it('is understood', () => expect(noManual(GIFT)).toBe(true));
  it('the opponent gets the token, and it is tapped', () => {
    const s0 = scenario([], { defs: [GIFT], p1: { hand: ['Test Gift'] } });
    const s = cast(s0, 'Test Gift', { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(tokensOf(s, 'p1')).toHaveLength(0);
    const theirs = tokensOf(s, 'p2');
    expect(theirs).toHaveLength(1);
    expect(s.objects[theirs[0]!]!.tapped).toBe(true);
  });
});

describe('CR 603.2, 603.6a: "Creatures entering don\'t cause abilities to trigger."', () => {
  const ORB = card('Test Stillness Orb', 'Artifact', "Creatures entering don't cause abilities to trigger.");
  const SCOUT = card('Test Scout', 'Creature — Elf', 'When this creature enters, draw a card.', { pt: ['1', '1'] });
  const GREETER = card('Test Greeter', 'Enchantment', 'Whenever a creature enters, you gain 1 life.\nWhenever an artifact enters, you gain 2 life.');
  const RELIC = card('Test Relic', 'Artifact', '');
  it('is understood', () => expect(noManual(ORB)).toBe(true));
  it('a creature entering triggers neither its own ability nor another permanent\'s; without the effect both trigger', () => {
    for (const [withOrb, draws, gain] of [[true, 0, 0], [false, 1, 1]] as const) {
      const s0 = scenario([], { defs: [ORB, SCOUT, GREETER], p1: { hand: ['Test Scout'], battlefield: ['Test Greeter', ...(withOrb ? ['Test Stillness Orb'] : [])] } });
      const h0 = hand(s0, 'p1');
      const s = cast(s0, 'Test Scout');
      expect(findAll(s, 'Test Scout', 'battlefield', 'p1'), String(withOrb)).toHaveLength(1);
      expect(hand(s, 'p1'), String(withOrb)).toBe(h0 - 1 + draws);
      expect(life(s, 'p1'), String(withOrb)).toBe(20 + gain);
    }
  });
  it('a noncreature permanent entering still causes abilities to trigger', () => {
    const s0 = scenario([], { defs: [ORB, GREETER, RELIC], p1: { hand: ['Test Relic'], battlefield: ['Test Greeter', 'Test Stillness Orb'] } });
    const s = cast(s0, 'Test Relic');
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 707.9b, 707.10, 707.10f: a copy of a spell with exceptions ("except the copy isn\'t legendary", "... is an artifact in addition to its other types")', () => {
  const ECHO = card('Test Echo', 'Sorcery', "When you next cast a creature spell this turn, copy it, except the copy isn't legendary.");
  const HERO = card('Test Hero', 'Legendary Creature — Human Knight', '', { pt: ['2', '2'] });
  const FORGE = card('Test Forge', 'Enchantment', 'Whenever you cast a creature spell, copy it, except the copy is an artifact in addition to its other types.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const MIRROR = card('Test Mirror', 'Enchantment', "Whenever you cast an instant spell, copy it, except the copy isn't legendary.");
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to each opponent.');
  it('is understood', () => {
    for (const d of [ECHO, FORGE, MIRROR]) expect(noManual(d), d.name).toBe(true);
  });
  it('the copy of a legendary creature spell becomes a token that is not legendary: both stay (no legend rule, CR 704.5j)', () => {
    const s0 = scenario([], { defs: [ECHO, HERO], p1: { hand: ['Test Echo', 'Test Hero'] } });
    const s1 = cast(s0, 'Test Echo');
    const s = cast(s1, 'Test Hero');
    const heroes = findAll(s, 'Test Hero', 'battlefield', 'p1');
    expect(heroes).toHaveLength(2);
    const token = heroes.find((id) => s.objects[id]!.kind === 'token')!;
    const card0 = heroes.find((id) => s.objects[id]!.kind !== 'token')!;
    expect(getChars(s, token)!.supertypes).not.toContain('Legendary');
    expect(getChars(s, card0)!.supertypes).toContain('Legendary');
    expect(getChars(s, token)!.subtypes).toEqual(['Human', 'Knight']);
  });
  it('CR 603.7b: the delayed ability copies only the next creature spell', () => {
    const s0 = scenario([], { defs: [ECHO, BEAR, HERO], p1: { hand: ['Test Echo', 'Test Bear', 'Test Hero'] } });
    const s = cast(cast(cast(s0, 'Test Echo'), 'Test Bear'), 'Test Hero');
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Test Hero', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('a type the exception adds: the token copy is an artifact creature with the original\'s other characteristics', () => {
    const s0 = scenario([], { defs: [FORGE, BEAR], p1: { hand: ['Test Bear'], battlefield: ['Test Forge'] } });
    const s = cast(s0, 'Test Bear');
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    expect(bears).toHaveLength(2);
    const token = bears.find((id) => s.objects[id]!.kind === 'token')!;
    expect([...getChars(s, token)!.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(getChars(s, token)!.power).toBe('2');
    const other = bears.find((id) => id !== token)!;
    expect(getChars(s, other)!.types).toEqual(['Creature']);
  });
  it('an instant copied with an exception still does what the instant does (its abilities are the spell\'s own)', () => {
    const s0 = scenario([], { defs: [MIRROR, ZAP], p1: { hand: ['Test Zap'], battlefield: ['Test Mirror'] } });
    const s = cast(s0, 'Test Zap');
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 105.2, 603.2h: "Whenever you cast a spell that\'s one or more colors, you may gain 1 life for each of that spell\'s colors. Do this only once each turn."', () => {
  const HORN = card('Test Horn', 'Artifact', "Whenever you cast a spell that's one or more colors, you may gain 1 life for each of that spell's colors. Do this only once each turn.");
  const DUO = card('Test Duo', 'Sorcery', 'Draw a card.', { colors: ['W', 'U'] });
  const DUO2 = card('Test Duo Again', 'Sorcery', 'Draw a card.', { colors: ['B', 'R'] });
  const GREY = card('Test Grey', 'Sorcery', 'Draw a card.');
  it('is understood', () => expect(noManual(HORN)).toBe(true));
  it('a two-colored spell gains 2 life; the second colored spell of the turn gains nothing; a colorless spell does not trigger', () => {
    const s0 = scenario([], { defs: [HORN, DUO, DUO2, GREY], p1: { hand: ['Test Duo', 'Test Duo Again'], battlefield: ['Test Horn'] } });
    const s1 = cast(s0, 'Test Duo');
    expect(life(s1, 'p1')).toBe(22);
    const s2 = cast(s1, 'Test Duo Again');
    expect(life(s2, 'p1')).toBe(22);
    const g0 = scenario([], { defs: [HORN, GREY], p1: { hand: ['Test Grey'], battlefield: ['Test Horn'] } });
    const g = cast(g0, 'Test Grey');
    expect(life(g, 'p1')).toBe(20);
    expect(g.zones.stack).toHaveLength(0);
  });
});

describe('CR 701.23a, 201.2, 607.2a: "search your library for up to five land cards that have different names, exile them" and "choose a card at random exiled with ~ and put it onto the battlefield tapped"', () => {
  const PATH = card('Test Pathway', 'Enchantment', "When this enchantment enters, search your library for up to five land cards that have different names, exile them, then shuffle.\nAt the beginning of your end step, choose a card at random exiled with this enchantment and put it onto the battlefield tapped.");
  it('is understood', () => expect(noManual(PATH)).toBe(true));
  it('the lands found have different names and are exiled; at your end step one of them enters tapped under your control', () => {
    const s0 = scenario(['Forest', 'Island', 'Swamp'], { defs: [PATH], p1: { hand: ['Test Pathway'], library: ['Forest', 'Forest', 'Island', 'Swamp'] } });
    const s1 = cast(s0, 'Test Pathway');
    const exiled = s1.zones.exile.filter((id) => s1.objects[id]!.owner === 'p1').map((id) => s1.objects[id]!.defId);
    expect(exiled.length).toBeGreaterThan(0);
    expect(new Set(exiled).size).toBe(exiled.length);
    const lands0 = s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1').length;
    const s = resolveAll(advanceTo(s1, 1, 'end'));
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(mine.length).toBe(lands0 + 1);
    const entered = mine.find((id) => exiled.includes(s.objects[id]!.defId) && s.objects[id]!.tapped);
    expect(entered).toBeDefined();
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1').length).toBe(exiled.length - 1);
  });
});

describe('CR 701.21a, 603.10a, 603.7, 707.2: "Whenever you sacrifice ~ or another artifact, you may pay {2}. If you do, at the beginning of the next end step, create a token that\'s a copy of that artifact."', () => {
  const DUP = card('Test Duplicator', 'Artifact — Clue', "Whenever you sacrifice this artifact or another artifact, you may pay {2}. If you do, at the beginning of the next end step, create a token that's a copy of that artifact.\n{2}, Sacrifice this artifact: Draw a card.");
  const RELIC = card('Test Relic', 'Artifact', '');
  const ALTAR = card('Test Altar', 'Enchantment', 'Sacrifice an artifact: You gain 1 life.');
  const activate = (s: GameState, name: string): GameState => {
    const src = find(s, name, 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
    if (a === undefined) throw new Error(`no activation of ${name}`);
    return resolveAll(drive(act(s, a.action)));
  };
  it('is understood', () => expect(noManual(DUP)).toBe(true));
  it('sacrificed itself (it looks back, CR 603.10a): paid, and a token copy of it is created at the next end step', () => {
    const s0 = scenario([], { defs: [DUP], p1: { battlefield: ['Test Duplicator', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    const s1 = activate(s0, 'Test Duplicator');
    expect(findAll(s1, 'Test Duplicator', 'battlefield', 'p1')).toHaveLength(0);
    const s = resolveAll(advanceTo(s1, 1, 'end'));
    const copies = findAll(s, 'Test Duplicator', 'battlefield', 'p1');
    expect(copies).toHaveLength(1);
    expect(s.objects[copies[0]!]!.kind).toBe('token');
  });
  it('another artifact sacrificed: the token is a copy of that artifact', () => {
    const s0 = scenario([], { defs: [DUP, RELIC, ALTAR], p1: { battlefield: ['Test Duplicator', 'Test Relic', 'Test Altar', 'Plains', 'Plains'] } });
    const altar = find(s0, 'Test Altar', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === altar)!;
    let s1 = act(s0, a.action);
    // the cost: sacrifice the Relic, not the Duplicator
    for (let g = 0; g < 10 && s1.pending && s1.pending.kind !== 'priority'; g++) {
      const p = s1.pending;
      if (p.kind === 'chooseObjects') s1 = answer(s1, { kind: 'chooseObjects', ids: [find(s1, 'Test Relic', 'battlefield', 'p1')] });
      else s1 = drive(s1);
    }
    s1 = resolveAll(s1);
    expect(findAll(s1, 'Test Relic', 'battlefield', 'p1')).toHaveLength(0);
    const s = resolveAll(advanceTo(s1, 1, 'end'));
    expect(findAll(s, 'Test Relic', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Duplicator', 'battlefield', 'p1')).toHaveLength(1);
  });
});
