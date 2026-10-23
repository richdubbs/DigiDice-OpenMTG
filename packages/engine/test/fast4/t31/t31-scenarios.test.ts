/**
 * FAST4 T31: the zone-move shapes of parser/templates/zz-fast4/t31.json (and the composed readings this package made possible) played through the engine with
 * synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 611.2a, 601.2a, 305.1, 400.7   "Exile the top card of your library. You may play that card this turn." (cast a spell or play a land from exile, this turn
 *                                     only, the card itself only); "Mill a card. You may play that card this turn." (from the graveyard)
 *   CR 611.2b                          "You may play that card for as long as you control ~." (ends when the source leaves)
 *   CR 406.3, 400.7, 610.3c, 110.2     flicker: "exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's
 *                                     control"; "you may exile target non-Elf creature you control, then return that card ... under your control"
 *   CR 701.23a, 208.1, 202.3           tutors: power N or less, mana value N exactly, "X card or a card with flash", "a Bird or basic land card", "up to two
 *                                     A, B, and/or C cards with mana value N or less", "shuffle and put the card on top", "put that card into your graveyard"
 *   CR 608.2c, 608.2e                  "If you do, search ..., reveal it, put it into your hand, then shuffle" (the whole sentence depends on "you do")
 *   CR 113.6m                          "{G}: Return ~ and target land card from your graveyard to the battlefield tapped" (activated from the graveyard)
 *   CR 107.3a, 602.2b                  "Pay X life: Return target creature card with mana value X from your graveyard to the battlefield" (X from the cost)
 *   CR 122.1, 608.2d                   "Remove up to three counters from target permanent" (each counter's kind, and when to stop)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, life, pass, reject, scenario, zoneNames } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (experimental templates cap the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions that come up: target groups from `targets` (one list per group, in order), then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), [], answers);
const castWith = (s0: GameState, name: string, targets: TargetChoice[][] = []): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
function activate(s: GameState, name: string, zone: 'battlefield' | 'graveyard' = 'battlefield', targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  const id = find(s, name, zone, 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets, answers);
}
/** The names of the cards in exile. */
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{W}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
const BIRD = card('Test Bird', 'Creature — Bird', '', ['1', '1'], '{1}');
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');
const BIG_ROCK = card('Test Big Rock', 'Artifact', '', undefined, '{3}');
const FLASHER = card('Test Flasher', 'Creature — Faerie', 'Flash', ['1', '1'], '{1}');
const SORCERY = card('Test Sorcery', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
const QUEEN = card('Test Queen', 'Legendary Creature — Elf', '', ['2', '2'], '{2}');

describe('CR 611.2a, 601.2a, 305.1: "Exile the top card of your library. You may play that card this turn."', () => {
  const ARK = card('Test Ember Ark', 'Artifact', '{T}: Exile the top card of your library. You may play that card this turn.');
  it('is automated: the exiled spell can be cast from exile this turn, with its normal cost and timing', () => {
    expect(automated(ARK)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Ember Ark', 'Plains'], library: ['Test Elf'] }, defs: [ARK, ELF] });
    let s = resolve(activate(s0, 'Test Ember Ark'));
    expect(exiled(s)).toContain('Test Elf');
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    const offer = legal(s, 'p1', 'cast').find((a) => a.object === elf);
    expect(offer?.label).toMatch(/from exile/);
    s = resolve(settle(act(s, offer!.action)));
    expect(battlefieldNames(s, 'p1')).toContain('Test Elf');
    // the opponent never gets the permission (CR 611.2a: "you")
    expect(legal(s0, 'p2').some((a) => a.object === elf)).toBe(false);
  });
  it('a land exiled this way is played from exile and uses the land play of the turn (CR 305.2)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ember Ark'], library: ['Plains'] }, defs: [ARK] });
    let s = resolve(activate(s0, 'Test Ember Ark'));
    const land = s.zones.exile.find((id) => s.objects[id]!.defId === 'Plains')!;
    const play = legal(s, 'p1', 'playLand').find((a) => a.object === land);
    expect(play).toBeDefined();
    s = act(s, play!.action);
    expect(s.objects[land]?.zone ?? 'gone').not.toBe('exile');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
  });
  it('the permission ends with the turn (CR 611.2a), and a card that is not the exiled one is never offered', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ember Ark', 'Plains'], library: ['Test Elf'], exile: ['Test Ogre'] }, defs: [ARK, ELF, OGRE] });
    let s = resolve(activate(s0, 'Test Ember Ark'));
    const ogre = find(s, 'Test Ogre', 'exile', 'p1');
    expect(legal(s, 'p1').some((a) => a.object === ogre)).toBe(false);
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    s = advanceTo(s, 3, 'main1');
    expect(legal(s, 'p1').some((a) => a.object === elf)).toBe(false);
    expect(() => act(s, { type: 'cast', player: 'p1', card: elf })).toThrow(/hand/);
  });
  it('"You may play it this turn" (the same permission, the pronoun)', () => {
    const SPEC = card('Test Diversion', 'Creature — Human', '{1}: Exile the top card of your library. You may play it this turn.', ['2', '2']);
    expect(automated(SPEC)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Diversion', 'Plains', 'Plains'], library: ['Test Elf'] }, defs: [SPEC, ELF] });
    const s = resolve(activate(s0, 'Test Diversion'));
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    expect(legal(s, 'p1', 'cast').some((a) => a.object === elf)).toBe(true);
  });
});

describe('CR 701.17c, 611.2a: "Mill a card. You may play that card this turn."', () => {
  const HUNGER = card('Test Hungry Ark', 'Artifact', '{T}: Mill a card. You may play that card this turn.');
  it('the milled card can be cast from the graveyard this turn, and only it', () => {
    expect(automated(HUNGER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hungry Ark', 'Plains'], library: ['Test Elf'], graveyard: ['Test Ogre'] }, defs: [HUNGER, ELF, OGRE] });
    let s = resolve(activate(s0, 'Test Hungry Ark'));
    const elf = find(s, 'Test Elf', 'graveyard', 'p1');
    const ogre = find(s, 'Test Ogre', 'graveyard', 'p1');
    expect(legal(s, 'p1', 'cast').some((a) => a.object === ogre)).toBe(false);
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: elf })));
    expect(battlefieldNames(s, 'p1')).toContain('Test Elf');
  });
});

describe('CR 611.2b: "You may play that card for as long as you control ~."', () => {
  const GWEN = card('Test Web Hero', 'Creature — Human Hero', 'When Test Web Hero enters, exile the top card of your library. You may play that card for as long as you control Test Web Hero.', ['2', '2'], '{1}');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('lasts beyond the turn while the source stays under your control, and ends when it leaves', () => {
    expect(automated(GWEN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Web Hero'], battlefield: ['Plains', 'Plains'], library: ['Test Elf'] }, p2: { hand: ['Test Kill'] }, defs: [GWEN, ELF, KILL] });
    let s = resolve(resolve(castWith(s0, 'Test Web Hero')));
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    s = advanceTo(s, 3, 'main1');
    expect(legal(s, 'p1', 'cast').some((a) => a.object === elf)).toBe(true);
    // the source leaves the battlefield: the duration is over (CR 611.2b)
    s = tweak(s, (t) => {
      const hero = t.zones.battlefield.find((id) => t.objects[id]!.defId === 'Test Web Hero')!;
      t.zones.battlefield = t.zones.battlefield.filter((id) => id !== hero);
      t.zones.graveyard['p1']!.push(hero);
      t.objects[hero]!.zone = 'graveyard';
    });
    expect(legal(s, 'p1', 'cast').some((a) => a.object === elf)).toBe(false);
  });
});

describe('CR 406.3, 400.7, 610.3c: flicker', () => {
  const KITTEN = card('Test Blink Kitten', 'Creature — Cat', 'Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner\'s control.', ['2', '2']);
  const ANGEL = card('Test Blink Angel', 'Creature — Angel', 'When Test Blink Angel enters, you may exile target non-Elf creature you control, then return that card to the battlefield under your control.', ['3', '4']);
  const GREETER = card('Test Greeter', 'Creature — Human', 'When Test Greeter enters, you gain 2 life.', ['1', '1']);
  it('"exile up to one target ..., then return that card ... under its owner\'s control": the card comes back as a new object and its enters trigger triggers', () => {
    expect(automated(KITTEN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Blink Kitten', 'Test Greeter', 'Plains'], hand: ['Test Sorcery'] }, defs: [KITTEN, GREETER, SORCERY] });
    const greeter = find(s0, 'Test Greeter', 'battlefield', 'p1');
    let s = castWith(s0, 'Test Sorcery');
    s = settle(s, [[obj(greeter)]]);
    s = resolve(s); // the trigger: exile and return
    s = resolve(s); // the Greeter's enters trigger
    expect(battlefieldNames(s, 'p1')).toContain('Test Greeter');
    expect(s.zones.battlefield).not.toContain(greeter); // CR 400.7: a new object
    expect(life(s, 'p1')).toBe(22);
  });
  it('"you may exile target non-Elf creature you control, then return that card to the battlefield under your control": both or neither', () => {
    expect(automated(ANGEL)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Blink Angel'], battlefield: ['Test Greeter', 'Plains'] }, defs: [ANGEL, GREETER] });
    const greeter = find(s0, 'Test Greeter', 'battlefield', 'p1');
    let s = resolve(castWith(s0, 'Test Blink Angel'));
    s = settle(s, [[obj(greeter)]]);
    s = resolve(s, [{ kind: 'yesNo', yes: true }]);
    s = resolve(s);
    expect(battlefieldNames(s, 'p1')).toContain('Test Greeter');
    expect(s.zones.battlefield).not.toContain(greeter);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 701.23a: library searches', () => {
  const RECRUITER = card('Test Recruiter', 'Creature — Human', 'When Test Recruiter enters, search your library for a creature card with power 2 or less, reveal it, put it into your hand, then shuffle.', ['3', '1']);
  const TROPHY = card('Test Trophy Mage', 'Creature — Human Wizard', 'When Test Trophy Mage enters, you may search your library for an artifact card with mana value 3, reveal it, put it into your hand, then shuffle.', ['2', '2']);
  const TRINKET = card('Test Trinket Mage', 'Creature — Human Wizard', 'When Test Trinket Mage enters, you may search your library for an artifact card with mana value 1 or less, reveal that card, put it into your hand, then shuffle.', ['2', '2']);
  const TEACH = card('Test Teachings', 'Instant', 'Search your library for a sorcery card or a card with flash, reveal it, put it into your hand, then shuffle.');
  const SAZH = card('Test Bird Keeper', 'Creature — Human', 'When Test Bird Keeper enters, you may search your library for a Bird or basic land card, reveal it, put it into your hand, then shuffle.', ['2', '2']);
  const GEARHULK = card('Test Glass Hulk', 'Artifact Creature — Construct', 'When Test Glass Hulk enters, you may search your library for up to two artifact, creature, and/or sorcery cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.', ['4', '4']);
  const WORLDLY = card('Test Worldly Lesson', 'Instant', 'Search your library for a creature card, reveal it, then shuffle and put the card on top.');
  const GRAVE = card('Test Open Grave', 'Instant', 'Search your library for a nonlegendary card, put that card into your graveyard, then shuffle.');
  const SHEPHERD = card('Test Star Shepherd', 'Creature — Angel', 'When Test Star Shepherd enters, search your library for a basic Plains card or a creature card with mana value 1 or less, reveal it, put it into your hand, then shuffle.', ['3', '2']);
  const PIA = card('Test Ascetic', 'Creature — Human', 'When Test Ascetic enters, you may discard a card. If you do, search your library for an artifact card, reveal it, put it into your hand, then shuffle.', ['2', '2']);
  const opts = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? [...s.pending.options] : []);
  const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId).sort();
  const lib = ['Test Elf', 'Test Ogre', 'Test Bird', 'Test Rock', 'Test Big Rock', 'Test Flasher', 'Test Sorcery', 'Test Queen'];
  const defs = [ELF, OGRE, BIRD, ROCK, BIG_ROCK, FLASHER, SORCERY, QUEEN];
  const upTo = (s0: GameState, enter: string, yes: boolean): GameState => {
    const s = resolve(castWith(s0, enter));
    return resolve(s, yes ? [{ kind: 'yesNo', yes: true }] : []);
  };
  it('CR 208.1: "a creature card with power 2 or less" offers only those (printed power of a card in the library)', () => {
    expect(automated(RECRUITER)).toBe(true);
    const s = upTo(scenario([], { p1: { hand: ['Test Recruiter'], library: lib }, defs: [RECRUITER, ...defs] }), 'Test Recruiter', false);
    expect(names(s, opts(s))).toEqual(['Test Bird', 'Test Elf', 'Test Flasher', 'Test Queen']);
  });
  it('CR 202.3: "mana value 3" is exactly 3; "mana value 1 or less" with "reveal that card"', () => {
    expect(automated(TROPHY)).toBe(true);
    expect(automated(TRINKET)).toBe(true);
    let s = upTo(scenario([], { p1: { hand: ['Test Trophy Mage'], library: lib }, defs: [TROPHY, ...defs] }), 'Test Trophy Mage', true);
    expect(names(s, opts(s))).toEqual(['Test Big Rock']);
    s = upTo(scenario([], { p1: { hand: ['Test Trinket Mage'], library: lib }, defs: [TRINKET, ...defs] }), 'Test Trinket Mage', true);
    expect(names(s, opts(s))).toEqual(['Test Rock']);
  });
  it('"a sorcery card or a card with flash"; "a Bird or basic land card"; "a basic Plains card or a creature card with mana value 1 or less"', () => {
    for (const d of [TEACH, SAZH, SHEPHERD]) expect(automated(d), d.name).toBe(true);
    let s = settle(castWith(scenario([], { p1: { hand: ['Test Teachings'], library: lib }, defs: [TEACH, ...defs] }), 'Test Teachings'));
    s = resolve(s);
    expect(names(s, opts(s))).toEqual(['Test Flasher', 'Test Sorcery']);
    s = upTo(scenario([], { p1: { hand: ['Test Bird Keeper'], library: [...lib, 'Plains'] }, defs: [SAZH, ...defs] }), 'Test Bird Keeper', true);
    expect(names(s, opts(s)).filter((n) => n !== 'Plains')).toEqual(['Test Bird']);
    expect(names(s, opts(s))).toContain('Plains');
    s = upTo(scenario([], { p1: { hand: ['Test Star Shepherd'], library: lib }, defs: [SHEPHERD, ...defs] }), 'Test Star Shepherd', false);
    expect(names(s, opts(s)).filter((n) => n !== 'Plains')).toEqual(['Test Bird', 'Test Elf', 'Test Flasher']);
  });
  it('"up to two artifact, creature, and/or sorcery cards with mana value 1 or less": at most two, each of one of the types', () => {
    expect(automated(GEARHULK)).toBe(true);
    let s = upTo(scenario([], { p1: { hand: ['Test Glass Hulk'], library: lib }, defs: [GEARHULK, ...defs] }), 'Test Glass Hulk', true);
    expect(names(s, opts(s))).toEqual(['Test Bird', 'Test Elf', 'Test Flasher', 'Test Rock', 'Test Sorcery']);
    if (s.pending?.kind === 'chooseObjects') expect(s.pending.max).toBe(2);
    const pick = opts(s).filter((id) => ['Test Elf', 'Test Rock'].includes(s.objects[id]!.defId));
    s = settle(s, [], [{ kind: 'chooseObjects', ids: pick }]);
    expect(zoneNames(s, 'hand', 'p1').sort()).toEqual(['Test Elf', 'Test Rock']);
  });
  it('CR 701.24a, 401.2: "then shuffle and put the card on top": the found card is the top card after the shuffle', () => {
    expect(automated(WORLDLY)).toBe(true);
    let s = settle(castWith(scenario([], { p1: { hand: ['Test Worldly Lesson'], library: lib }, defs: [WORLDLY, ...defs] }), 'Test Worldly Lesson'));
    s = resolve(s);
    const ogre = opts(s).find((id) => s.objects[id]!.defId === 'Test Ogre')!;
    s = settle(s, [], [{ kind: 'chooseObjects', ids: [ogre] }]);
    const top = s.zones.library['p1']![0]!;
    expect(s.objects[top]!.defId).toBe('Test Ogre');
  });
  it('"a nonlegendary card, put that card into your graveyard": a legendary card is not offered', () => {
    expect(automated(GRAVE)).toBe(true);
    let s = settle(castWith(scenario([], { p1: { hand: ['Test Open Grave'], library: ['Test Queen', 'Test Elf'] }, defs: [GRAVE, ...defs] }), 'Test Open Grave'));
    s = resolve(s);
    expect(names(s, opts(s))).not.toContain('Test Queen');
    const elf = opts(s).find((id) => s.objects[id]!.defId === 'Test Elf')!;
    s = settle(s, [], [{ kind: 'chooseObjects', ids: [elf] }]);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Elf');
  });
  it('CR 608.2c: "If you do, search ...": no search when nothing was discarded; a search when a card was', () => {
    expect(automated(PIA)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Ascetic', 'Test Ogre'], library: lib }, defs: [PIA, ...defs] });
    let s = resolve(castWith(s0, 'Test Ascetic'));
    s = resolve(s, [{ kind: 'yesNo', yes: false }]);
    expect(s.pending?.kind).toBe('priority');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Ogre']);
    s = resolve(castWith(s0, 'Test Ascetic'));
    s = resolve(s, [{ kind: 'yesNo', yes: true }]); // the only card in hand is discarded
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Ogre');
    expect(names(s, opts(s))).toEqual(['Test Big Rock', 'Test Rock']);
  });
});

describe('CR 113.6m: "Return ~ and target land card from your graveyard to the battlefield tapped"', () => {
  const SANDMAN = card('Test Sand Walker', 'Creature — Elemental', '{G}: Return this card and target land card from your graveyard to the battlefield tapped.', ['2', '2']);
  it('is activated from the graveyard and returns both, tapped', () => {
    expect(automated(SANDMAN)).toBe(true);
    const s0 = scenario(['Forest'], { p1: { graveyard: ['Test Sand Walker', 'Plains'], battlefield: ['Forest'] }, defs: [SANDMAN] });
    const land = find(s0, 'Plains', 'graveyard', 'p1');
    let s = activate(s0, 'Test Sand Walker', 'graveyard', [[obj(land)]]);
    s = resolve(s);
    const back = s.zones.battlefield.filter((id) => ['Test Sand Walker', 'Plains'].includes(s.objects[id]!.defId));
    expect(back).toHaveLength(2);
    expect(back.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('is not offered from the battlefield', () => {
    const s0 = scenario(['Forest'], { p1: { battlefield: ['Test Sand Walker', 'Forest'], graveyard: ['Plains'] }, defs: [SANDMAN] });
    const walker = find(s0, 'Test Sand Walker', 'battlefield', 'p1');
    expect(legal(s0, 'p1', 'activate').some((a) => a.object === walker && !a.isMana)).toBe(false);
  });
});

describe('CR 107.3a, 602.2b: X announced in a non-mana cost part ("Pay X life: ... mana value X ...")', () => {
  const NIGHT = card('Test Night Altar', 'Enchantment', 'Pay X life: Return target creature card with mana value X from your graveyard to the battlefield. Activate only as a sorcery.');
  it('is automated; the target must have mana value X', () => {
    expect(automated(NIGHT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Night Altar'], graveyard: ['Test Ogre', 'Test Elf'] }, defs: [NIGHT, OGRE, ELF] });
    let s = activate(s0, 'Test Night Altar', 'battlefield', [], [{ kind: 'chooseNumber', n: 3 }]);
    expect(s.pending?.kind).toBe('chooseTargets');
    if (s.pending?.kind === 'chooseTargets') {
      expect(s.pending.objects).toEqual([find(s0, 'Test Ogre', 'graveyard', 'p1')]);
    }
    s = settle(s, [[obj(find(s0, 'Test Ogre', 'graveyard', 'p1'))]]);
    s = resolve(s);
    expect(battlefieldNames(s, 'p1')).toContain('Test Ogre');
    expect(life(s, 'p1')).toBe(17);
  });
});

describe('CR 122.1, 608.2d: "Remove up to three counters from target permanent."', () => {
  const RENDER = card('Test Render Null', 'Sorcery', 'Remove up to three counters from target permanent.');
  it('is automated; the controller picks the kind of each counter and may stop early (even before the first)', () => {
    expect(automated(RENDER)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Render Null'] }, p2: { battlefield: [{ name: 'Test Ogre', counters: { '+1/+1': 2, charge: 2 } }] }, defs: [RENDER, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    let s = resolve(castWith(s0, 'Test Render Null', [[obj(ogre)]]));
    expect(s.pending?.kind).toBe('chooseOption');
    if (s.pending?.kind === 'chooseOption') expect(s.pending.options.map((o) => o.id)).toEqual(['+1/+1', 'charge', '__stop']);
    s = settle(s, [], [{ kind: 'chooseOption', ids: ['charge'] }, { kind: 'chooseOption', ids: ['charge'] }, { kind: 'chooseOption', ids: ['__stop'] }]);
    expect(s.objects[ogre]!.counters).toEqual({ '+1/+1': 2 });
    // stopping at once removes nothing
    s = resolve(castWith(s0, 'Test Render Null', [[obj(ogre)]]), [{ kind: 'chooseOption', ids: ['__stop'] }]);
    expect(s.objects[ogre]!.counters).toEqual({ '+1/+1': 2, charge: 2 });
  });
  it('never more than three', () => {
    const s0 = scenario([], { p1: { hand: ['Test Render Null'] }, p2: { battlefield: [{ name: 'Test Ogre', counters: { charge: 5 } }] }, defs: [RENDER, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const pick = { kind: 'chooseOption', ids: ['charge'] } as DecisionAnswer;
    const s = resolve(castWith(s0, 'Test Render Null', [[obj(ogre)]]), [pick, pick, pick, pick]);
    expect(s.objects[ogre]!.counters['charge']).toBe(2);
  });
});

describe('reject', () => {
  it('a card in exile without a permission still cannot be cast (CR 601.3)', () => {
    const s0 = scenario([], { p1: { exile: ['Test Elf'], battlefield: ['Plains'] }, defs: [ELF] });
    expect(reject(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Elf', 'exile', 'p1') }).message).toMatch(/hand/);
  });
});
