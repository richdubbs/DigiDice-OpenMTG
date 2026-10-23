/**
 * FAST4 T30: the shapes of parser/templates/zz-fast4/t30.json played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 115.3, 120.3      "~ deals 2 damage to any target and 1 damage to any other target": two different targets, one damage event
 *   CR 120.3             "~ deals 2 damage to any target and 3 damage to itself": the source is dealt damage too
 *   CR 107.3, 107.1b     "~ deals X damage to target player, where X is 3 minus the number of cards in their hand" (a negative X deals no damage)
 *   CR 107.1a, 119.3     "target opponent loses half their life, rounded up"; CR 701.17a "target opponent mills half their library, rounded up"
 *   CR 119.3, 109.2      "you gain 1 life for each other creature you control" (not the creature itself)
 *   CR 608.2d            "you may have target player mill two cards": you choose, that player mills
 *   CR 700.4, 608.2c     "Destroy target creature. Then draw a card for each creature that died this turn"
 *   CR 603.10a, 608.2h   "When ~ dies, draw a card for each -1/-1 counter on it" (last known information)
 *   CR 608.2d            "return another creature you control to its owner's hand"; "target opponent returns a creature they control ..." (their choice)
 *   CR 614.1c, 616.1     "return ... to the battlefield with two additional +1/+1 counters on it" (besides its own enters-with counters)
 *   CR 701.23a, 202.3    "you may search your library for a creature card with mana value 6 or greater, reveal it, put it into your hand, then shuffle"
 *   CR 121.1             "you and target opponent each draw a card"
 *   CR 608.2d            "target opponent exiles an enchantment they control" (that player chooses among their own)
 *   CR 701.17a, 701.17c  "mill four cards, then put up to two land cards from among them into your hand" (only the milled cards)
 *   CR 508.1, 603.2c     "whenever one or more creatures you control attack, search your library for up to that many basic land cards, put them onto the
 *                        battlefield tapped, then shuffle"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, battlefieldNames, find, findAll, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (experimental templates cap the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });

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
function activate(s: GameState, name: string, targets: TargetChoice[][] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}
const setLife = (s: GameState, p: string, n: number): GameState => tweak(s, (t) => { t.players.find((x) => x.id === p)!.life = n; });

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
const ROCK = card('Test Rock', 'Artifact', '');
const AURA_LIKE = card('Test Ward Stone', 'Enchantment', '');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 115.3, 120.3: "~ deals 2 damage to any target and 1 damage to any other target"', () => {
  const DASH = card('Test Rock Toss', 'Sorcery', 'Test Rock Toss deals 2 damage to any target and 1 damage to any other target.');
  it('is automated; the second target differs from the first, and each gets its amount', () => {
    expect(automated(DASH)).toBe(true);
    expect(JSON.stringify(DASH.faces)).toContain('"distinctFrom"');
    const s0 = scenario([], { p1: { hand: ['Test Rock Toss'] }, p2: { battlefield: ['Test Elf'] }, defs: [DASH, ELF] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p2');
    const s = resolve(castWith(s0, 'Test Rock Toss', [[player('p2')], [obj(elf)]]));
    expect(life(s, 'p2')).toBe(18);
    expect(s.objects[elf]!.damage).toBe(1);
    // the same player twice is not a legal choice for "any other target" (CR 115.3)
    const cast = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rock Toss', 'hand', 'p1') });
    const first = answer(cast, { kind: 'chooseTargets', targets: [player('p2')] });
    expect(first.pending?.kind).toBe('chooseTargets');
    if (first.pending?.kind !== 'chooseTargets') return;
    expect(first.pending.players).not.toContain('p2');
  });
});

describe('CR 120.3: "{0}: ~ deals 2 damage to any target and 3 damage to itself"', () => {
  const ENTITY = card('Test Mind Wisp', 'Creature — Illusion', '{0}: Test Mind Wisp deals 2 damage to any target and 3 damage to itself.', ['2', '4']);
  it('is automated, and the source is dealt the second amount', () => {
    expect(automated(ENTITY)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Mind Wisp'] }, defs: [ENTITY] });
    const wisp = find(s0, 'Test Mind Wisp', 'battlefield', 'p1');
    const s = resolve(activate(s0, 'Test Mind Wisp', [[player('p2')]]));
    expect(life(s, 'p2')).toBe(18);
    expect(s.objects[wisp]!.damage).toBe(3);
  });
});

describe('CR 107.3, 107.1b: "~ deals X damage to target player, where X is 3 minus the number of cards in their hand"', () => {
  const RACK = card('Test Rack Spirit', 'Creature — Spirit', '{0}: Test Rack Spirit deals X damage to target player, where X is 3 minus the number of cards in their hand.', ['1', '1']);
  it('deals 3 minus that player\'s hand size, and nothing (never life) when that is negative', () => {
    expect(automated(RACK)).toBe(true);
    const one = scenario([], { p1: { battlefield: ['Test Rack Spirit'] }, p2: { hand: ['Test Rock'] }, defs: [RACK, ROCK] });
    expect(life(resolve(activate(one, 'Test Rack Spirit', [[player('p2')]])), 'p2')).toBe(18);
    const five = scenario([], { p1: { battlefield: ['Test Rack Spirit'] }, p2: { hand: ['Test Rock', 'Test Rock', 'Test Rock', 'Test Rock', 'Test Rock'] }, defs: [RACK, ROCK] });
    expect(life(resolve(activate(five, 'Test Rack Spirit', [[player('p2')]])), 'p2')).toBe(20);
  });
});

describe('CR 107.1a, 119.3, 701.17a: "half their life, rounded up" and "half their library, rounded up"', () => {
  const HALF = card('Test Halving Idol', 'Artifact', '{0}: Target opponent loses half their life, rounded up.');
  const MILL = card('Test Tide Idol', 'Artifact', '{0}: Target opponent mills half their library, rounded up.');
  it('a player at 15 life loses 8', () => {
    expect(automated(HALF)).toBe(true);
    const s0 = setLife(scenario([], { p1: { battlefield: ['Test Halving Idol'] }, defs: [HALF] }), 'p2', 15);
    expect(life(resolve(activate(s0, 'Test Halving Idol', [[player('p2')]])), 'p2')).toBe(7);
  });
  it('a library of 23 cards loses 12 to the graveyard', () => {
    expect(automated(MILL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Tide Idol'] }, p2: { library: ['Test Rock', 'Test Rock', 'Test Rock'] }, defs: [MILL, ROCK] });
    expect(s0.zones.library['p2']).toHaveLength(23);
    const s = resolve(activate(s0, 'Test Tide Idol', [[player('p2')]]));
    expect(s.zones.graveyard['p2']).toHaveLength(12);
    expect(s.zones.library['p2']).toHaveLength(11);
  });
});

describe('CR 119.3, 109.2: "When ~ enters, you gain 1 life for each other creature you control"', () => {
  const SERVER = card('Test Tavern Host', 'Creature — Human', 'When Test Tavern Host enters, you gain 1 life for each other creature you control.', ['1', '1']);
  it('counts the other creatures, not the one that entered', () => {
    expect(automated(SERVER)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Tavern Host'], battlefield: ['Test Elf', 'Test Ogre'] }, p2: { battlefield: ['Test Elf'] }, defs: [SERVER, ELF, OGRE] });
    const s = resolve(resolve(castWith(s0, 'Test Tavern Host')));
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 608.2d: "{0}: You may have target player mill two cards" (you choose, the target mills)', () => {
  const DEMON = card('Test Grave Siphon', 'Artifact', '{0}: You may have target player mill two cards.');
  it('yes mills two cards of that player; no does nothing', () => {
    expect(automated(DEMON)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Grave Siphon'] }, defs: [DEMON] });
    const asked = pass(pass(activate(s0, 'Test Grave Siphon', [[player('p2')]])));
    expect(asked.pending?.kind).toBe('yesNo');
    expect(asked.pending?.player).toBe('p1');
    expect(settle(asked, [], [{ kind: 'yesNo', yes: true }]).zones.graveyard['p2']).toHaveLength(2);
    expect(settle(asked, [], [{ kind: 'yesNo', yes: false }]).zones.graveyard['p2']).toHaveLength(0);
  });
});

describe('CR 700.4, 608.2c: "Destroy target creature an opponent controls. Then draw a card for each creature that died this turn"', () => {
  const EMBRACE = card('Test Final Hug', 'Sorcery', 'Destroy target creature an opponent controls. Then draw a card for each creature that died this turn.');
  it('counts the creature it destroyed and the ones that died before in the turn', () => {
    expect(automated(EMBRACE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill', 'Test Final Hug'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Ogre'] }, defs: [EMBRACE, KILL, ELF, OGRE] });
    s = resolve(castWith(s, 'Test Kill', [[obj(find(s, 'Test Elf', 'battlefield', 'p1'))]]));
    const hand = zoneNames(s, 'hand', 'p1').length;
    s = resolve(castWith(s, 'Test Final Hug', [[obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]]));
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand - 1 + 2);
  });
});

describe('CR 603.10a, 608.2h: "When ~ dies, draw a card for each -1/-1 counter on it" reads the counters it had', () => {
  const URCHIN = card('Test Dusk Imp', 'Creature — Imp', 'When Test Dusk Imp dies, draw a card for each -1/-1 counter on it.', ['4', '4']);
  it('draws two for two counters (last known information: the card in the graveyard has none)', () => {
    expect(automated(URCHIN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Dusk Imp', counters: { '-1/-1': 2 } }] }, defs: [URCHIN, KILL] });
    s = resolve(castWith(s, 'Test Kill', [[obj(find(s, 'Test Dusk Imp', 'battlefield', 'p1'))]]));
    const hand = zoneNames(s, 'hand', 'p1').length;
    s = resolve(s);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand + 2);
  });
});

describe('CR 608.2d: bounce by choice: "return another creature you control"; "target opponent returns a creature they control"', () => {
  const SKAAB = card('Test Tide Skaab', 'Creature — Zombie', '{0}: Return another creature you control to its owner\'s hand.', ['3', '3']);
  const HOPE = card('Test Low Tide', 'Enchantment', '{0}: Target opponent returns a creature they control to its owner\'s hand.');
  it('"another": you choose among your other creatures, never this one', () => {
    expect(automated(SKAAB)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Tide Skaab', 'Test Elf'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SKAAB, ELF, OGRE] });
    const s = pass(pass(activate(s0, 'Test Tide Skaab')));
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    if (s.pending?.kind === 'chooseObjects') {
      expect(s.pending.options).toEqual([elf]);
      expect(zoneNames(settle(s, [], [{ kind: 'chooseObjects', ids: [elf] }]), 'hand', 'p1')).toContain('Test Elf');
    } else {
      // a choice of exactly one option may be made for the player
      expect(zoneNames(s, 'hand', 'p1')).toContain('Test Elf');
    }
    expect(battlefieldNames(settle(s, [], [{ kind: 'chooseObjects', ids: [elf] }]), 'p1')).toContain('Test Tide Skaab');
  });
  it('"they control": that player chooses among their own creatures', () => {
    expect(automated(HOPE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Low Tide', 'Test Elf'] }, p2: { battlefield: ['Test Ogre', 'Test Elf'] }, defs: [HOPE, ELF, OGRE] });
    const s = pass(pass(activate(s0, 'Test Low Tide', [[player('p2')]])));
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.player).toBe('p2');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    expect([...s.pending.options].sort()).toEqual([ogre, find(s0, 'Test Elf', 'battlefield', 'p2')].sort());
    const done = settle(s, [], [{ kind: 'chooseObjects', ids: [ogre] }]);
    expect(zoneNames(done, 'hand', 'p2')).toEqual(['Test Ogre']);
    expect(battlefieldNames(done, 'p1')).toContain('Test Elf');
  });
});

describe('CR 614.1c, 616.1: "with two additional +1/+1 counters on it"', () => {
  const REAWAKEN = card('Test Grave Wake', 'Sorcery', 'Return target creature card from your graveyard to the battlefield with two additional +1/+1 counters on it.');
  const HATCH = card('Test Hatchling', 'Creature — Lizard', 'Test Hatchling enters with a +1/+1 counter on it.', ['0', '0']);
  it('the creature enters with those counters besides its own', () => {
    expect(automated(REAWAKEN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Grave Wake'], graveyard: ['Test Hatchling'] }, defs: [REAWAKEN, HATCH] });
    const s = resolve(castWith(s0, 'Test Grave Wake', [[obj(find(s0, 'Test Hatchling', 'graveyard', 'p1'))]]));
    const id = find(s, 'Test Hatchling', 'battlefield', 'p1');
    expect(automated(HATCH)).toBe(true);
    expect(s.objects[id]!.counters['+1/+1']).toBe(3);
  });
});

describe('CR 701.23a, 202.3: "you may search your library for a creature card with mana value 6 or greater, reveal it, put it into your hand, then shuffle"', () => {
  const EMPATH = card('Test Big Finder', 'Creature — Elf', 'When Test Big Finder enters, you may search your library for a creature card with mana value 6 or greater, reveal it, put it into your hand, then shuffle.', ['1', '1']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['6', '6'], '{6}');
  it('only a card of mana value 6 or more can be found', () => {
    expect(automated(EMPATH)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Big Finder'], library: ['Test Ogre', 'Test Giant', 'Test Elf'] }, defs: [EMPATH, GIANT, OGRE, ELF] });
    let s = resolve(resolve(castWith(s0, 'Test Big Finder')), [{ kind: 'yesNo', yes: true }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    const giant = find(s, 'Test Giant', 'library', 'p1');
    expect(s.pending.options).toEqual([giant]);
    s = settle(s, [], [{ kind: 'chooseObjects', ids: [giant] }]);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Giant');
  });
});

describe('CR 121.1: "{0}: You and target opponent each draw a card"', () => {
  const ADEPT = card('Test Far Sage', 'Artifact', '{0}: You and target opponent each draw a card.');
  it('both players draw one card', () => {
    expect(automated(ADEPT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Far Sage'] }, defs: [ADEPT] });
    const s = resolve(activate(s0, 'Test Far Sage', [[player('p2')]]));
    expect(s.zones.hand['p1']).toHaveLength(1);
    expect(s.zones.hand['p2']).toHaveLength(1);
  });
});

describe('CR 608.2d: "{0}: Target opponent exiles an enchantment they control" (their choice, not a target)', () => {
  const WINTER = card('Test Hard Frost', 'Artifact', '{0}: Target opponent exiles an enchantment they control.');
  it('that player chooses one of their own enchantments', () => {
    expect(automated(WINTER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hard Frost', 'Test Ward Stone'] }, p2: { battlefield: ['Test Ward Stone', 'Test Ward Stone'] }, defs: [WINTER, AURA_LIKE] });
    const s = pass(pass(activate(s0, 'Test Hard Frost', [[player('p2')]])));
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.player).toBe('p2');
    const theirs = findAll(s0, 'Test Ward Stone', 'battlefield', 'p2');
    expect([...s.pending.options].sort()).toEqual([...theirs].sort());
    const done = settle(s, [], [{ kind: 'chooseObjects', ids: [theirs[0]!] }]);
    expect(done.zones.exile).toHaveLength(1);
    expect(battlefieldNames(done, 'p1')).toContain('Test Ward Stone');
  });
});

describe('CR 701.17a, 701.17c: "Mill four cards, then put up to two land cards from among them into your hand"', () => {
  const RALLY = card('Test Silvan Muster', 'Sorcery', 'Mill four cards, then put up to two land cards from among them into your hand.');
  it('only the milled land cards can be chosen (not a land card already in the graveyard)', () => {
    expect(automated(RALLY)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Silvan Muster'], graveyard: ['Plains'], library: ['Test Elf', 'Plains', 'Test Rock', 'Plains'] }, defs: [RALLY, ELF, ROCK] });
    const old = find(s0, 'Plains', 'graveyard', 'p1');
    const s = resolve(castWith(s0, 'Test Silvan Muster'));
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(0);
    expect(s.pending.max).toBe(2);
    expect(s.pending.options).toHaveLength(2);
    expect(s.pending.options).not.toContain(old);
    const done = settle(s, [], [{ kind: 'chooseObjects', ids: [s.pending.options[0]!] }]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Plains']);
    expect(zoneNames(done, 'graveyard', 'p1')).toHaveLength(5); // the old Plains, three milled cards and the sorcery
  });
});

describe('CR 508.1, 603.2c: "whenever one or more creatures you control attack, search your library for up to that many basic land cards, put them onto the battlefield tapped"', () => {
  const KING = card('Test Earth Ruler', 'Enchantment', 'Whenever one or more creatures you control attack, search your library for up to that many basic land cards, put them onto the battlefield tapped, then shuffle.');
  it('two attackers: up to two basic lands, put onto the battlefield tapped', () => {
    expect(automated(KING)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Earth Ruler', 'Test Elf', 'Test Ogre'] }, defs: [KING, ELF, OGRE] });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Elf', 'battlefield', 'p1')], [find(s, 'Test Ogre', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'chooseObjects', 'the search', 20);
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.max).toBe(2);
    const picks = s.pending.options.slice(0, 2);
    s = settle(answer(s, { kind: 'chooseObjects', ids: picks }));
    const lands = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1');
    expect(lands).toHaveLength(2);
    expect(lands.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});
